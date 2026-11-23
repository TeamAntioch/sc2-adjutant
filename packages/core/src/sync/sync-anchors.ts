// Syncs units, points and cameras back from an Editor-saved Objects file into the blueprint's
// anchors (ADR-0001), as syncDoodads does for doodads. Each compiled object's Id is its anchor's
// stable id, so:
//
// - an anchor's object moved or edited in the Editor updates the anchor;
// - one deleted is removed, or kept with a note if anything refers to it (an objective, a cue);
// - an object the compiler didn't make becomes a new anchor in the zone it stands in.
//
// What the Editor keeps that the blueprint can't (AI rebuild settings, a unit's texture, a point's
// pathing radius) is reported, not kept. Sync from a map compiled from this blueprint.

import { missionBlueprintSchema } from "../domain/mission-blueprint.js";
import { namedAnchorIds } from "../domain/reference-graph.js";
import type { Workspace } from "../plugins/workspace.js";
import type { ObjectsFile, PlacedCamera, PlacedPoint, PlacedUnit, Vec3 } from "../map/read-objects-xml.js";
import { stableObjectId } from "../map/stable-object-id.js";
import { DEFAULT_CAMERA_VALUES } from "../map/write-objects-xml.js";
import {
  ANGLE_TOLERANCE,
  angleApart,
  clone,
  freshId,
  HEIGHT_TOLERANCE,
  POSITION_TOLERANCE,
  round,
  scaleChanged,
  scaleValue,
  slugOf,
  zoneAt,
} from "./sync-shared.js";
import { sameList } from "../util/same-list.js";

export type AnchorSyncReport = {
  readonly changed: string[];
  readonly added: string[];
  readonly removed: string[];
  /** Deleted in the Editor but referred to elsewhere in the blueprint, so kept. */
  readonly kept: string[];
  /** "<anchor>: <what>" for Editor settings the blueprint can't hold. */
  readonly notKept: string[];
};

type RawAnchor = Record<string, unknown> & { id: string; kind: string; position: { x: number; y: number; z?: number } };
type EditorObject = { readonly kind: "unit"; readonly object: PlacedUnit } | { readonly kind: "point"; readonly object: PlacedPoint } | { readonly kind: "camera"; readonly object: PlacedCamera };

const VALUE_TOLERANCE = 0.001;
const otherFlags = (flags: readonly string[]): string[] => flags.filter((flag) => flag !== "ForcePlacement").sort();

/** Sets `key` on the anchor to `value`, or removes it when `value` is undefined; true when that changed it. */
function assign(anchor: RawAnchor, key: string, value: unknown): boolean {
  const before = JSON.stringify(anchor[key]);
  if (value === undefined) delete anchor[key];
  else anchor[key] = value;
  return JSON.stringify(anchor[key]) !== before;
}

/**
 * The blueprint (as written, unparsed) with the Editor's units, points and cameras synced into its
 * anchors, and what changed. `objects` is the Objects file of a map compiled from this blueprint.
 */
export function syncAnchors(
  raw: Record<string, unknown>,
  objects: ObjectsFile,
  /** What the Blueprint is validated against: its Workspace's Plugins, and its Mission's catalog (missionWorkspace). */
  workspace: Pick<Workspace, "registry" | "catalog">,
  /** Objects the author kept from the compile (compile-map --keep): Kept Content, neither synced nor deleted. */
  kept: ReadonlySet<number> = new Set(),
): { blueprint: Record<string, unknown>; report: AnchorSyncReport } {
  const blueprint = missionBlueprintSchema(workspace.registry, workspace.catalog).parse(raw);
  const out = clone(raw);
  const anchors = ((out["anchors"] as RawAnchor[] | undefined) ?? []).slice();
  const report: AnchorSyncReport = { changed: [], added: [], removed: [], kept: [], notKept: [] };
  // A Wave's unit's Anchor has no position and no object: its send creates the unit (waveUnitAnchors).
  const byObjectId = new Map(anchors.filter((a) => (a.kind === "unit" || a.kind === "point" || a.kind === "camera") && a.position !== undefined).map((a) => [stableObjectId(a.id), a]));

  const editorObjects: EditorObject[] = [
    ...objects.units.map((object) => ({ kind: "unit" as const, object })),
    ...objects.points.map((object) => ({ kind: "point" as const, object })),
    ...objects.cameras.map((object) => ({ kind: "camera" as const, object })),
  ];
  const seen = new Set<string>();
  for (const editor of editorObjects) {
    const anchor = byObjectId.get(editor.object.id);
    if (anchor && kept.has(editor.object.id)) {
      seen.add(anchor.id);
      continue;
    }
    if (!anchor || anchor.kind !== editor.kind) {
      const added = addNew(editor);
      anchors.push(added);
      report.added.push(added.id);
      noteExtras(added.id, editor.object.extras);
      continue;
    }
    seen.add(anchor.id);
    if (update(anchor, editor)) report.changed.push(anchor.id);
    noteExtras(anchor.id, editor.object.extras);
  }

  // Anchors whose object the Editor no longer has: deleted.
  const removed = new Set<string>();
  const named = namedAnchorIds(out);
  for (const anchor of byObjectId.values()) {
    if (seen.has(anchor.id)) continue;
    if (named.has(anchor.id)) report.kept.push(anchor.id);
    else {
      removed.add(anchor.id);
      report.removed.push(anchor.id);
    }
  }
  out["anchors"] = anchors.filter((a) => !removed.has(a.id));
  return { blueprint: out, report };

  function noteExtras(anchorId: string, extras: readonly string[]): void {
    if (extras.length > 0) report.notKept.push(`${anchorId}: ${extras.join(", ")}`);
  }

  /** Moves and edits an anchor to match its Editor object; true when anything changed. */
  function update(anchor: RawAnchor, editor: EditorObject): boolean {
    const { object } = editor;
    let changed = syncPosition(anchor, object.position);
    // A camera's Rotation is written from its Yaw value, so only the value syncs.
    if (editor.kind !== "camera" && angleApart(object.yaw, (anchor["rotation"] as number | undefined) ?? 0) > ANGLE_TOLERANCE) {
      changed = assign(anchor, "rotation", round(object.yaw, 4)) || changed;
    }
    const flags = object.flags;
    const other = otherFlags(flags);
    if (!sameList(other, otherFlags((anchor["flags"] as string[] | undefined) ?? []))) changed = assign(anchor, "flags", other.length > 0 ? other : undefined) || changed;
    if (editor.kind === "camera") {
      const camera = editor.object;
      changed = assign(anchor, "name", camera.name) || changed;
      const target = anchor["cameraTarget"] as { x: number; y: number } | undefined;
      if (camera.target && (!target || Math.abs(target.x - camera.target.x) > POSITION_TOLERANCE || Math.abs(target.y - camera.target.y) > POSITION_TOLERANCE)) {
        changed = assign(anchor, "cameraTarget", { x: round(camera.target.x), y: round(camera.target.y) }) || changed;
      }
      // The compiler writes the default game camera's values with the anchor's on top; the anchor
      // keeps only those the Editor leaves different from the defaults.
      const own = (anchor["cameraValues"] as { index: string; value: number }[] | undefined) ?? [];
      const written = new Map([...DEFAULT_CAMERA_VALUES, ...own.map((v): [string, number] => [v.index, v.value])]);
      const differs = camera.values.some((v) => !written.has(v.index) || Math.abs(written.get(v.index)! - v.value) > VALUE_TOLERANCE);
      if (differs) {
        const defaults = new Map(DEFAULT_CAMERA_VALUES);
        const kept = camera.values.filter((v) => !defaults.has(v.index) || Math.abs(defaults.get(v.index)! - v.value) > VALUE_TOLERANCE);
        changed = assign(anchor, "cameraValues", kept.length > 0 ? kept.map((v) => ({ index: v.index, value: round(v.value, 4) })) : undefined) || changed;
      }
      return changed;
    }
    if (scaleChanged(editor.object.scale, (anchor["scale"] as number | [number, number, number] | undefined) ?? 1)) {
      const scale = scaleValue(editor.object.scale);
      changed = assign(anchor, "scale", scale === 1 ? undefined : scale) || changed;
    }
    changed = assign(anchor, "forcePlacement", flags.includes("ForcePlacement") ? true : undefined) || changed;
    if (editor.kind === "unit") {
      const unit = editor.object;
      changed = assign(anchor, "unitType", unit.type) || changed;
      changed = assign(anchor, "player", unit.player > 0 ? unit.player : undefined) || changed;
      changed = assign(anchor, "variation", unit.variation) || changed;
      changed = assign(anchor, "resources", unit.resources) || changed;
    } else {
      const point = editor.object;
      if (point.name !== undefined) changed = assign(anchor, "name", point.name) || changed;
      changed = assign(anchor, "pointType", point.type === undefined || point.type === "Normal" ? undefined : point.type) || changed;
    }
    return changed;
  }

  /** Units, points and cameras are written at height 0 unless the anchor gives one. */
  function syncPosition(anchor: RawAnchor, position: Vec3): boolean {
    const before = anchor.position;
    const moved = Math.abs(position.x - before.x) > POSITION_TOLERANCE || Math.abs(position.y - before.y) > POSITION_TOLERANCE;
    const raised = Math.abs(position.z - (before.z ?? 0)) > HEIGHT_TOLERANCE;
    if (!moved && !raised) return false;
    const next: RawAnchor["position"] = moved ? { x: round(position.x), y: round(position.y) } : { x: before.x, y: before.y };
    if (Math.abs(position.z) > HEIGHT_TOLERANCE) next.z = round(position.z);
    anchor.position = next;
    return true;
  }

  /** A new anchor for an object the compiler didn't make, in the zone it stands in. */
  function addNew(editor: EditorObject): RawAnchor {
    const { object } = editor;
    const zone = zoneAt(blueprint, object.position.x, object.position.y);
    const label = editor.kind === "unit" ? editor.object.type : (editor.object.name ?? editor.kind);
    const id = freshId(`${zone}-${slugOf(label)}`, (taken) => anchors.some((a) => a.id === taken));
    const { x, y, z } = object.position;
    const position = { x: round(x), y: round(y), ...(Math.abs(z) > HEIGHT_TOLERANCE ? { z: round(z) } : {}) };
    const anchor: RawAnchor = { id, name: label, zoneId: zone, kind: editor.kind, position };
    update(anchor, editor);
    return anchor;
  }
}
