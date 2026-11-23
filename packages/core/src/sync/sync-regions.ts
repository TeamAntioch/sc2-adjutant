// Syncs regions back from an Editor-saved Regions file (ADR-0001). The compiler numbers regions in
// order (missionRegions): zones, then Waves' warning circles, then set pieces, then the author's own. An Editor region is
// matched to what made it by that number:
//
// - a zone's region redrawn becomes the zone's `region` (its trigger area; the terrain still
//   follows the polygon); drawn back to the polygon's bounds, the override goes;
// - a set piece's region is a label: an edit is reported and dropped (edit the set piece instead);
// - a Beat's bounds region (ADR-0015) redrawn as one rectangle becomes that Beat's area as a
//   rectangle (its `playable`, `camera.bounds` or `camera.transition`); any other shape is reported
//   and dropped, as bounds are rectangles;
// - one of the author's own regions is updated, or removed when deleted;
// - a region the compiler didn't make joins the blueprint's `regions`.
//
// A zone's region can't be deleted (triggers use it): it comes back at the next compile.
// Sync from a map compiled from this blueprint, before changing it.
//
// With a compile record (ADR-0010), a Compiled region is found by the id the record lists for its
// place (the compile renumbers one past a Kept region holding its number), and a region not on the
// record is Kept Content: it stays in the package, edited where it lies, and doesn't join the
// Blueprint, whose copy would be compiled beside it.

import { type MissionBlueprint, missionBlueprintSchema, rectOnMap, type RegionLook, type RegionShape } from "../domain/mission-blueprint.js";
import type { Workspace } from "../plugins/workspace.js";
import { type EditorRegion, regionBounds } from "../map/read-regions-xml.js";
import { boundsShape, missionRegions } from "../map/write-regions-xml.js";
import { boundsRegions } from "../triggers/beat-bounds.js";
import { waveWarningRegions } from "../triggers/wave-triggers.js";
import { clone, freshId, generatedGround, POSITION_TOLERANCE, round, slugOf, type SyncGround } from "./sync-shared.js";

export type RegionSyncReport = {
  /** Zones whose trigger area the Editor redrew (or drew back to the polygon's bounds). */
  readonly zonesRedrawn: string[];
  /** Beats whose bounds regions the Editor redrew, as `<beat id> <role>`. */
  readonly boundsRedrawn: string[];
  readonly added: string[];
  readonly changed: string[];
  readonly removed: string[];
  /** Edits the blueprint doesn't keep: set-piece regions, zone renames, deleted zone regions. */
  readonly ignored: string[];
};

const close = (a: number, b: number): boolean => Math.abs(a - b) <= POSITION_TOLERANCE;

function sameShape(a: RegionShape, b: RegionShape): boolean {
  if (a.type !== b.type || Boolean(a.negative) !== Boolean(b.negative)) return false;
  if (a.type === "rect" && b.type === "rect") return a.quad.every((value, index) => close(value, b.quad[index]!));
  if (a.type === "circle" && b.type === "circle") return close(a.center.x, b.center.x) && close(a.center.y, b.center.y) && close(a.radius, b.radius);
  if (a.type === "diamond" && b.type === "diamond") {
    return close(a.center.x, b.center.x) && close(a.center.y, b.center.y) && close(a.width, b.width) && close(a.height, b.height);
  }
  return false;
}

const sameLook = (a: RegionLook, b: RegionLook): boolean =>
  a.color === b.color && Boolean(a.invisible) === Boolean(b.invisible) && a.shapes.length === b.shapes.length && a.shapes.every((shape, index) => sameShape(shape, b.shapes[index]!));

/** The Editor's region as a blueprint look, its numbers rounded as the other syncs do. */
function lookOf(region: EditorRegion): RegionLook {
  const shapes = region.shapes.map((shape): RegionShape => {
    const negative = shape.negative ? { negative: true } : {};
    if (shape.type === "rect") return { type: "rect", quad: shape.quad.map((value) => round(value)) as [number, number, number, number], ...negative };
    const center = { x: round(shape.center.x), y: round(shape.center.y) };
    if (shape.type === "circle") return { type: "circle", center, radius: round(shape.radius), ...negative };
    return { type: "diamond", center, width: round(shape.width), height: round(shape.height), ...negative };
  });
  return { shapes, ...(region.color ? { color: region.color } : {}), ...(region.invisible ? { invisible: true } : {}) };
}

/**
 * The blueprint (as written, unparsed) with the Editor's regions synced in, and what changed.
 * `regions` is the Regions file of a map compiled from this blueprint and saved by the Editor.
 */
export function syncRegions(
  raw: Record<string, unknown>,
  regions: readonly EditorRegion[],
  /** What the Blueprint is validated against: its Workspace's Plugins, and its Mission's catalog (missionWorkspace). */
  workspace: Pick<Workspace, "registry" | "catalog">,
  /** The region ids on the compile record, in the order the compile wrote them; without a record, regions are numbered by place. */
  recorded?: readonly number[],
  /** Regions the author kept from the compile (compile-map --keep): Kept Content, neither synced nor deleted. */
  keptIds: ReadonlySet<number> = new Set(),
  /**
   * Compiled regions the Editor hasn't changed since the compile (their fingerprints match the
   * record): a bounds region among them is as compiled, though the Blueprint's Zones may have moved since.
   */
  untouched: ReadonlySet<number> = new Set(),
  /** The ground the compile stands the set pieces on; the Blueprint's own terrain by default. */
  ground: (blueprint: MissionBlueprint) => SyncGround = generatedGround,
): { blueprint: Record<string, unknown>; report: RegionSyncReport } {
  const blueprint = missionBlueprintSchema(workspace.registry, workspace.catalog).parse(raw);
  const out = clone(raw);
  const zones = out["zones"] as (Record<string, unknown> & { id: string })[];
  const own = ((out["regions"] as (Record<string, unknown> & { id: string })[] | undefined) ?? []).slice();
  const report: RegionSyncReport = { zonesRedrawn: [], boundsRedrawn: [], added: [], changed: [], removed: [], ignored: [] };
  const compiled = missionRegions(blueprint, ground(blueprint).dressing(blueprint).setPieces, waveWarningRegions(blueprint), boundsRegions(blueprint));

  // Each Editor region's place in the compiled list (1-based), or undefined when the compile didn't write it.
  const placeOf = (id: number): number | undefined => {
    if (!recorded) return id >= 1 && id <= compiled.length ? id : undefined;
    const index = recorded.indexOf(id);
    return index < 0 ? undefined : index + 1;
  };
  const seen = new Set<number>();
  for (const editor of regions) {
    // A region with no shapes the Editor can draw holds nothing.
    if (editor.shapes.length === 0) continue;
    const place = placeOf(editor.id);
    if (place !== undefined && keptIds.has(editor.id)) {
      seen.add(place);
      continue;
    }
    const before = place === undefined ? undefined : compiled[place - 1];
    if (!before) {
      // Kept Content: the package's own.
      if (recorded) continue;
      // Named as the author named it, numbered only when two share a name.
      const slug = slugOf(editor.name);
      const stem = /^[a-z]/.test(slug) ? slug : `region-${slug}`;
      const taken = (id: string) => own.some((r) => r.id === id);
      const id = taken(stem) ? freshId(stem, taken) : stem;
      own.push({ id, name: editor.name, ...lookOf(editor) });
      report.added.push(id);
      continue;
    }
    seen.add(place!);
    const look = lookOf(editor);
    const { source } = before;
    if (source.kind === "zone") {
      const zone = zones.find((z) => z.id === source.zoneId)!;
      if (editor.name !== before.name) report.ignored.push(`zone ${zone.id}: renamed "${editor.name}" in the Editor (rename the zone instead)`);
      if (sameLook(look, before)) continue;
      const polygon = blueprint.zones.find((z) => z.id === zone.id)!.polygon;
      if (sameLook(look, { shapes: [boundsShape(polygon)] })) delete zone["region"];
      else zone["region"] = look;
      report.zonesRedrawn.push(zone.id);
    } else if (source.kind === "set-piece") {
      if (!sameLook(look, before) || editor.name !== before.name) report.ignored.push(`set piece ${source.setPieceId}: its region is a label (edit the set piece instead)`);
    } else if (source.kind === "bounds") {
      if (sameLook(look, before) || untouched.has(editor.id)) continue;
      const [shape, ...others] = look.shapes;
      if (shape?.type !== "rect" || shape.negative || others.length > 0) {
        report.ignored.push(`beat ${source.beatId}: its ${source.role} bounds are a rectangle, so a region drawn with other shapes isn't kept (draw one rectangle)`);
        continue;
      }
      const rect = regionBounds([shape]);
      const { width, height } = blueprint.mapSize;
      if (!rectOnMap(rect, blueprint.mapSize)) {
        report.ignored.push(`beat ${source.beatId}: its ${source.role} bounds were redrawn as [${rect.join(", ")}], which has no area or runs off the ${width}×${height} map, so they aren't kept`);
        continue;
      }
      const beat = (out["beats"] as Record<string, unknown>[]).find((candidate) => candidate["id"] === source.beatId)!;
      if (source.role === "playable") beat["playable"] = rect;
      else {
        const camera = beat["camera"] as Record<string, unknown>;
        camera[source.role === "camera" ? "bounds" : "transition"] = rect;
      }
      report.boundsRedrawn.push(`${source.beatId} ${source.role}`);
    } else if (source.kind === "wave-warning") {
      if (!sameLook(look, before) || editor.name !== before.name) {
        report.ignored.push(`wave ${source.waveId}: its warning circle at ${source.zoneId} is compiled from its warning (change warning.seconds or the wave's speed instead)`);
      }
    } else {
      const entry = own.find((r) => r.id === source.regionId)!;
      if (sameLook(look, before) && editor.name === before.name) continue;
      for (const key of ["shapes", "color", "invisible"]) delete entry[key];
      Object.assign(entry, { name: editor.name, ...look });
      report.changed.push(entry.id);
    }
  }

  // Compiled regions the Editor no longer has.
  const removed = new Set<string>();
  compiled.forEach((region, index) => {
    if (seen.has(index + 1)) return;
    const { source } = region;
    if (source.kind === "zone") report.ignored.push(`zone ${source.zoneId}: its region was deleted, but triggers use it, so it comes back`);
    else if (source.kind === "wave-warning") report.ignored.push(`wave ${source.waveId}: its warning circle at ${source.zoneId} was deleted, but triggers use it, so it comes back`);
    else if (source.kind === "bounds") report.ignored.push(`beat ${source.beatId}: its ${source.role} bounds region was deleted, but triggers use it, so it comes back`);
    else if (source.kind === "region") {
      removed.add(source.regionId);
      report.removed.push(source.regionId);
    }
  });
  const kept = own.filter((r) => !removed.has(r.id));
  if (kept.length > 0) out["regions"] = kept;
  else delete out["regions"];
  return { blueprint: out, report };
}
