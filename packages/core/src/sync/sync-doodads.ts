// Syncs doodads back from an Editor-saved Objects file into the blueprint (ADR-0001). Each compiled
// doodad has a stable Id, so an Editor doodad is matched to what made it:
//
// - a doodad anchor: its fields are updated, or it is removed (kept, with a note, if anything
//   refers to it);
// - a set-piece or cliff-pile doodad: the change is recorded as an edit keyed by its seed, on its
//   set piece or on `dressing.cliffs`, so the dressing stays procedural and the edit survives
//   param changes; a deleted one becomes `removed: true`;
// - a set piece's hand-added doodad: updated or dropped in its `added` list;
// - a doodad the compiler didn't make: inside a set piece's circle it joins that set piece's
//   `added`; anywhere else it becomes a doodad anchor in the zone it stands in.
//
// Sync from a map compiled from this blueprint: a doodad the blueprint makes but the map lacks
// counts as deleted.

import { type DoodadEdit, isPlaced, type MissionBlueprint, missionBlueprintSchema } from "../domain/mission-blueprint.js";
import { namedAnchorIds } from "../domain/reference-graph.js";
import type { Workspace } from "../plugins/workspace.js";
import { getDoodad } from "../catalog/stock-catalog.js";
import { addedDoodadId, type PlacedDoodad } from "../dressing/expand-dressing.js";
import type { ObjectsFile, PlacedDoodad as EditorDoodad } from "../map/read-objects-xml.js";
import { anchorObjectId, stableObjectId } from "../map/stable-object-id.js";
import { anchorDoodadDefaults } from "../map/anchor-doodad-defaults.js";
import {
  ANGLE_TOLERANCE,
  angleApart,
  clone,
  freshId,
  generatedGround,
  HEIGHT_TOLERANCE,
  POSITION_TOLERANCE,
  round,
  scaleChanged,
  scaleValue,
  slugOf,
  type SyncGround,
  vector,
  zoneAt,
} from "./sync-shared.js";

export type SyncReport = {
  /** Doodad anchors whose fields changed. */
  readonly anchorsChanged: string[];
  readonly anchorsRemoved: string[];
  /** Deleted in the Editor but referred to elsewhere in the blueprint, so kept. */
  readonly anchorsKept: string[];
  readonly anchorsAdded: string[];
  /** Generated doodads edited or deleted, by id. */
  readonly dressingEdited: string[];
  readonly dressingRemoved: string[];
  /** New doodads that joined a set piece, as `<set piece>: <type>`. */
  readonly setPieceAdded: string[];
  /** Doodads the author placed on a generating Zone's ground, now Anchors at their own Editor Id. */
  readonly adopted: string[];
  /** Those left Kept, since the compile can't write their type (`<type> <Editor Id>`): one the catalog lacks, or a variation it doesn't have. */
  readonly notAdopted: string[];
};

/** What a compiled doodad looks like, to compare with the Editor's. */
type Compiled = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotation: number;
  readonly pitch: number;
  readonly roll: number;
  readonly scale: readonly [number, number, number];
  readonly type: string;
  readonly variation: number;
  readonly tint: string | undefined;
  readonly forcePlacement: boolean;
};

type Source = { readonly kind: "anchor"; readonly anchorId: string } | { readonly kind: "dressing"; readonly doodad: PlacedDoodad };

/** "r,g,b" from the Editor's "r,g,b" or "r,g,b,a"; undefined for none or plain white. */
const tintOf = (tintColor: string | undefined): string | undefined => {
  const rgb = tintColor?.split(",").slice(0, 3).join(",");
  return rgb && rgb !== "255,255,255" ? rgb : undefined;
};

/** The Editor's changes to a compiled doodad, leaving out height (synced separately). */
function changesOf(editor: EditorDoodad, compiled: Compiled): Omit<DoodadEdit, "heightOffset" | "removed"> {
  const change: Omit<DoodadEdit, "heightOffset" | "removed"> = {};
  if (Math.abs(editor.position.x - compiled.x) > POSITION_TOLERANCE || Math.abs(editor.position.y - compiled.y) > POSITION_TOLERANCE) {
    change.x = round(editor.position.x);
    change.y = round(editor.position.y);
  }
  if (angleApart(editor.yaw, compiled.rotation) > ANGLE_TOLERANCE) change.rotation = round(editor.yaw, 4);
  if (angleApart(editor.pitch, compiled.pitch) > ANGLE_TOLERANCE) change.pitch = round(editor.pitch, 4);
  if (angleApart(editor.roll, compiled.roll) > ANGLE_TOLERANCE) change.roll = round(editor.roll, 4);
  if (scaleChanged(editor.scale, compiled.scale)) change.scale = scaleValue(editor.scale);
  if (editor.type !== compiled.type) change.type = editor.type;
  if ((editor.variation ?? 0) !== compiled.variation) change.variation = editor.variation ?? 0;
  if (tintOf(editor.tintColor) !== compiled.tint) change.tint = tintOf(editor.tintColor) ?? "255,255,255";
  if (editor.flags.includes("ForcePlacement") !== compiled.forcePlacement) change.forcePlacement = editor.flags.includes("ForcePlacement");
  return change;
}


/**
 * A doodad's Editor flags an Anchor keeps in `flags`: all but ForcePlacement (its own field) and
 * HeightAbsolute, which an Editor save sets on every doodad (normalObject).
 */
const otherFlags = (editor: EditorDoodad): string[] => editor.flags.filter((flag) => flag !== "ForcePlacement" && flag !== "HeightAbsolute");

type RawAnchor = Record<string, unknown> & { id: string; position: { x: number; y: number; z?: number } };
type RawPlacement = Record<string, unknown> & { id: string; kind: string; params: Record<string, unknown> };

/**
 * The blueprint (as written, unparsed) with the Editor's doodads synced in, and what changed.
 * `objects` is the Objects file of a map compiled from this blueprint and saved by the Editor.
 */
export function syncDoodads(
  raw: Record<string, unknown>,
  objects: ObjectsFile,
  /** What the Blueprint is validated against: its Workspace's Plugins, and its Mission's catalog (missionWorkspace). */
  workspace: Pick<Workspace, "registry" | "catalog">,
  /** Doodads the author kept from the compile (compile-map --keep): Kept Content, neither synced nor deleted. */
  kept: ReadonlySet<number> = new Set(),
  {
    ground: given,
    adopted = new Set(),
    recorded = new Set(),
  }: {
    /** The ground the compile stands them on and the dressing it writes; the Blueprint's own terrain by default. */
    readonly ground?: (blueprint: MissionBlueprint) => SyncGround;
    /**
     * Kept doodads in the Mission's own package that become Anchors at their own Editor Id
     * (editorId): those the author placed on a generating Zone's ground.
     */
    readonly adopted?: ReadonlySet<number>;
    /**
     * The objects the last compile wrote, in the Mission's own package (its record): one the
     * Blueprint no longer makes comes back as an Anchor at its own Id, so the compile writes it
     * there again rather than beside it.
     */
    readonly recorded?: ReadonlySet<number>;
  } = {},
): { blueprint: Record<string, unknown>; report: SyncReport } {
  const schema = missionBlueprintSchema(workspace.registry, workspace.catalog);
  const blueprint = schema.parse(raw);
  const ground = (given ?? generatedGround)(blueprint);
  const groundAt = ground.groundAt;
  const out = clone(raw);
  const anchors = ((out["anchors"] as RawAnchor[] | undefined) ?? []).slice();
  const placements = (out["placements"] as RawPlacement[] | undefined) ?? [];
  const report: SyncReport = { anchorsChanged: [], anchorsRemoved: [], anchorsKept: [], anchorsAdded: [], dressingEdited: [], dressingRemoved: [], setPieceAdded: [], adopted: [], notAdopted: [] };

  // What the blueprint compiles to, by object Id.
  const { doodads: dressing, setPieces } = ground.dressing(blueprint);
  const sources = new Map<number, Source>();
  const compiled = new Map<number, Compiled>();
  for (const anchor of blueprint.anchors.filter(isPlaced)) {
    if (anchor.kind !== "doodad") continue;
    const id = anchorObjectId(anchor);
    const defaults = anchorDoodadDefaults(anchor.id);
    sources.set(id, { kind: "anchor", anchorId: anchor.id });
    compiled.set(id, {
      x: anchor.position.x,
      y: anchor.position.y,
      z: anchor.position.z ?? groundAt(anchor.position.x, anchor.position.y),
      rotation: anchor.rotation ?? defaults.rotation,
      pitch: anchor.pitch ?? 0,
      roll: anchor.roll ?? 0,
      scale: vector(anchor.scale ?? defaults.scale),
      type: anchor.doodadType ?? "Unknown",
      variation: anchor.variation ?? 0,
      tint: anchor.tint,
      forcePlacement: anchor.forcePlacement ?? false,
    });
  }
  for (const doodad of dressing) {
    const id = stableObjectId(doodad.id);
    sources.set(id, { kind: "dressing", doodad });
    compiled.set(id, {
      ...doodad,
      pitch: doodad.pitch ?? 0,
      roll: doodad.roll ?? 0,
      scale: vector(doodad.scale),
      tint: doodad.tint,
      forcePlacement: doodad.forcePlacement ?? false,
    });
  }

  // Where a dressing doodad's edits live: its set piece's params, or `dressing.cliffs`, `dressing.shores` or `dressing.edges` by its id's prefix.
  const editsFor = (doodad: PlacedDoodad): { edits: Record<string, DoodadEdit>; key: string } => {
    if (doodad.setPieceId) {
      const params = placements.find((p) => p.id === doodad.setPieceId)!.params;
      params["edits"] ??= {};
      return { edits: params["edits"] as Record<string, DoodadEdit>, key: doodad.id.slice(doodad.setPieceId.length + 1) };
    }
    const kind = doodad.id.split("/")[0]!;
    const holder = (out["dressing"] as Record<string, unknown>)[kind] as Record<string, unknown>;
    holder["edits"] ??= {};
    return { edits: holder["edits"] as Record<string, DoodadEdit>, key: doodad.id.slice(kind.length + 1) };
  };
  const addedOf = (setPieceId: string): Record<string, unknown>[] => {
    const params = placements.find((p) => p.id === setPieceId)!.params;
    params["added"] ??= [];
    return params["added"] as Record<string, unknown>[];
  };
  /** A set piece's hand-added doodad's index in `added`, from its id. */
  const addedIndex = (doodad: PlacedDoodad): number | undefined => {
    if (!doodad.setPieceId) return undefined;
    const n = Number(doodad.id.slice(addedDoodadId(doodad.setPieceId, 0).length - 1));
    return doodad.id === addedDoodadId(doodad.setPieceId, n) ? n - 1 : undefined;
  };
  const droppedAdded = new Map<string, Set<number>>();
  /** Dressing doodads whose height to resync once their other edits are in. */
  const heights: { doodad: PlacedDoodad; z: number }[] = [];

  const seen = new Set<number>();
  for (const editor of objects.doodads) {
    const source = sources.get(editor.id);
    if (source && kept.has(editor.id)) {
      seen.add(editor.id);
      continue;
    }
    if (!source) {
      addNew(editor);
      continue;
    }
    seen.add(editor.id);
    const before = compiled.get(editor.id)!;
    const change = changesOf(editor, before);
    if (source.kind === "anchor") {
      const anchor = anchors.find((a) => a.id === source.anchorId)!;
      const moved = change.x !== undefined;
      const zChanged = Math.abs(editor.position.z - before.z) > HEIGHT_TOLERANCE;
      if (moved) anchor.position = { ...anchor.position, x: change.x!, y: change.y! };
      if (moved || zChanged) {
        const position = { ...anchor.position };
        if (Math.abs(editor.position.z - groundAt(position.x, position.y)) > HEIGHT_TOLERANCE) position.z = round(editor.position.z);
        else delete position.z;
        anchor.position = position;
      }
      if (change.rotation !== undefined) anchor["rotation"] = change.rotation;
      if (change.pitch !== undefined) anchor["pitch"] = change.pitch;
      if (change.roll !== undefined) anchor["roll"] = change.roll;
      if (change.scale !== undefined) anchor["scale"] = change.scale;
      if (change.type !== undefined) anchor["doodadType"] = change.type;
      if (change.variation !== undefined) anchor["variation"] = change.variation;
      if (change.tint !== undefined) {
        if (change.tint === "255,255,255") delete anchor["tint"];
        else anchor["tint"] = change.tint;
      }
      if (change.forcePlacement !== undefined) {
        if (change.forcePlacement) anchor["forcePlacement"] = true;
        else delete anchor["forcePlacement"];
      }
      // Its other Editor flags (HeightOffset, NoDoodadFootprint …), which the compile writes as listed.
      const flags = otherFlags(editor);
      // HeightAbsolute, which every Editor save sets, is no change either way, so an Anchor listing it keeps it.
      const listed = ((anchor["flags"] as string[] | undefined) ?? []).filter((flag) => flag !== "HeightAbsolute");
      const flagsChanged = [...flags].sort().join() !== [...listed].sort().join();
      if (flagsChanged) {
        if (flags.length > 0) anchor["flags"] = flags;
        else delete anchor["flags"];
      }
      if (moved || zChanged || flagsChanged || Object.keys(change).length > 0) report.anchorsChanged.push(anchor.id);
      continue;
    }
    const { doodad } = source;
    const index = addedIndex(doodad);
    if (index !== undefined) {
      // A hand-added doodad: rewrite its entry as the Editor has it.
      const entry = addedOf(doodad.setPieceId!)[index]!;
      Object.assign(entry, change);
      if (change.tint === "255,255,255") delete entry["tint"];
      if (change.forcePlacement === false) delete entry["forcePlacement"];
      const offset = editor.position.z - groundAt(editor.position.x, editor.position.y);
      if (Math.abs(offset) > HEIGHT_TOLERANCE) entry["heightOffset"] = round(offset);
      else delete entry["heightOffset"];
      if (Object.keys(change).length > 0 || Math.abs(editor.position.z - before.z) > HEIGHT_TOLERANCE) report.dressingEdited.push(doodad.id);
      continue;
    }
    if (Object.keys(change).length > 0) {
      const { edits, key } = editsFor(doodad);
      edits[key] = { ...edits[key], ...change };
      report.dressingEdited.push(doodad.id);
    }
    if (Math.abs(editor.position.z - before.z) > HEIGHT_TOLERANCE || doodad.heightOffset !== undefined || change.x !== undefined) {
      heights.push({ doodad, z: editor.position.z });
    }
  }

  // Compiled doodads the Editor no longer has: deleted.
  const removedAnchors = new Set<string>();
  const named = namedAnchorIds(out);
  for (const [id, source] of sources) {
    if (seen.has(id)) continue;
    if (source.kind === "anchor") {
      if (named.has(source.anchorId)) report.anchorsKept.push(source.anchorId);
      else {
        removedAnchors.add(source.anchorId);
        report.anchorsRemoved.push(source.anchorId);
      }
      continue;
    }
    const { doodad } = source;
    const index = addedIndex(doodad);
    if (index !== undefined) {
      droppedAdded.set(doodad.setPieceId!, (droppedAdded.get(doodad.setPieceId!) ?? new Set()).add(index));
    } else {
      const { edits, key } = editsFor(doodad);
      edits[key] = { removed: true };
    }
    report.dressingRemoved.push(doodad.id);
  }
  for (const [setPieceId, indices] of droppedAdded) {
    const params = placements.find((p) => p.id === setPieceId)!.params;
    params["added"] = addedOf(setPieceId).filter((_, n) => !indices.has(n));
  }
  out["anchors"] = anchors.filter((a) => !removedAnchors.has(a.id));

  // Heights last: re-expand with the other edits in, then each edited doodad's offset is the
  // Editor's height above where the compiler would now stand it.
  if (heights.length > 0) {
    const again = ground.dressing(schema.parse(out)).doodads;
    for (const { doodad, z } of heights) {
      const now = again.find((d) => d.id === doodad.id);
      if (!now) continue;
      const offset = z - (now.z - (now.heightOffset ?? 0));
      const { edits, key } = editsFor(doodad);
      const edit = { ...edits[key] };
      if (Math.abs(offset) > HEIGHT_TOLERANCE) edit.heightOffset = round(offset);
      else delete edit.heightOffset;
      if (Object.keys(edit).length > 0) edits[key] = edit;
      else delete edits[key];
      if ((edit.heightOffset ?? 0) !== (doodad.heightOffset ?? 0) && !report.dressingEdited.includes(doodad.id)) report.dressingEdited.push(doodad.id);
    }
  }
  // Drop edit maps the sync emptied.
  const outDressing = out["dressing"] as Record<string, Record<string, unknown>> | undefined;
  const holders = [outDressing?.["cliffs"], outDressing?.["shores"], outDressing?.["edges"]].filter((holder) => holder !== undefined);
  for (const holder of [...placements.map((p) => p.params), ...holders]) {
    if (holder["edits"] && Object.keys(holder["edits"] as object).length === 0) delete holder["edits"];
    if (Array.isArray(holder["added"]) && holder["added"].length === 0) delete holder["added"];
  }
  return { blueprint: out, report };

  /** Whether the compile can write an Editor doodad as an Anchor: its type in the catalog, with its variation (checkDoodad). */
  function writable(editor: EditorDoodad): boolean {
    const info = getDoodad(workspace.catalog, editor.type);
    return info !== undefined && (editor.variation ?? 0) < info.variations;
  }

  /** A doodad the compiler didn't make: into the set piece it stands in, else a new anchor. */
  function addNew(editor: EditorDoodad): void {
    const { x, y, z } = editor.position;
    const home = setPieces
      .filter((piece) => Math.hypot(piece.x - x, piece.y - y) <= piece.radius)
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    const offset = z - groundAt(x, y);
    const tint = tintOf(editor.tintColor);
    const look = {
      rotation: round(editor.yaw, 4),
      ...(Math.abs(editor.pitch) > ANGLE_TOLERANCE ? { pitch: round(editor.pitch, 4) } : {}),
      ...(Math.abs(editor.roll) > ANGLE_TOLERANCE ? { roll: round(editor.roll, 4) } : {}),
      scale: scaleValue(editor.scale),
      variation: editor.variation ?? 0,
      ...(tint ? { tint } : {}),
      ...(editor.flags.includes("ForcePlacement") ? { forcePlacement: true } : {}),
    };
    // An adopted doodad keeps its Editor Id, which only an Anchor carries: a set piece's would be made from its seed.
    const adopt = adopted.has(editor.id) || recorded.has(editor.id);
    if (adopt && !writable(editor)) {
      report.notAdopted.push(`${editor.type} ${editor.id}`);
      return;
    }
    if (home && !adopt) {
      addedOf(home.id).push({
        type: editor.type,
        x: round(x),
        y: round(y),
        ...(Math.abs(offset) > HEIGHT_TOLERANCE ? { heightOffset: round(offset) } : {}),
        ...look,
      });
      report.setPieceAdded.push(`${home.id}: ${editor.type}`);
      return;
    }
    const zone = zoneAt(blueprint, x, y);
    const id = freshId(`${zone}-${slugOf(editor.type)}`, (taken) => anchors.some((a) => a.id === taken));
    anchors.push({
      id,
      name: editor.type,
      zoneId: zone,
      kind: "doodad",
      position: { x: round(x), y: round(y), ...(Math.abs(offset) > HEIGHT_TOLERANCE ? { z: round(z) } : {}) },
      doodadType: editor.type,
      ...look,
      ...(otherFlags(editor).length > 0 ? { flags: otherFlags(editor) } : {}),
      ...(adopt ? { editorId: editor.id } : {}),
    });
    (adopted.has(editor.id) ? report.adopted : report.anchorsAdded).push(id);
  }
}
