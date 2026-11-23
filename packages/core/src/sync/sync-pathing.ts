// The author's pathing paint back into the Blueprint (`pathingPaint`): what they painted or erased
// in CellAttribute_Pnp with the Editor's pathing brush, over what the compile paints (dug pools and
// solid doodads, map/compiled-pathing.ts). A generated map's only: beside Kept ground the file is
// the package's.
//
// The strokes are told on the Blueprint as it was compiled, before this sync moves any doodad,
// since the Editor's layer is still painted where the compile put it. They're then laid over what
// the Blueprint as synced paints, so paint left behind by a doodad the author moved isn't an edit
// (erasing it changes nothing), and a stroke beside a doodad where it now stands goes with it there.
// A stroke near a doodad is kept as offsets from it, so it moves with it too.
//
// Only a layer the Editor saved is read: one whose bytes aren't those the compile record has. A
// package compiled before doodads were painted holds only the pools' paint, so the author's strokes
// are told from that, and the doodads' paint is added under them. Once sync has the strokes, the
// record takes the Editor's layer as the compile's (recordAs), so the next compile writes over it
// without stopping.
//
// The entries the strokes don't touch stay as they're written, one the author wrote by hand
// included; those they touch are made again from the layer.

import { blueprintCatalog } from "../catalog/catalog-layer.js";
import { type CompileRecord, fingerprint } from "../domain/compile-record.js";
import type { MissionBlueprint, PathingPaint } from "../domain/mission-blueprint.js";
import { expandDressing } from "../dressing/expand-dressing.js";
import { compiledPathing } from "../map/compiled-pathing.js";
import { applyPathingPaint, countSubs, hasSub, paintEntrySubs, pathingPaintFrom } from "../terrain/doodad-pathing.js";
import { rasterizeTerrain } from "../terrain/rasterize.js";
import { cellAttributeFits, PATHING_FILE, readCellAttribute, writeCellAttribute } from "../terrain/write-cell-attribute.js";

export type PathingSyncResult = {
  readonly blueprint: Record<string, unknown>;
  readonly changed: string[];
  readonly notes: string[];
  /**
   * What the compile record's CellAttribute_Pnp is to say once the strokes are in the Blueprint:
   * the Editor's layer's fingerprint, or null for none (the Editor removed the file). Undefined
   * when sync didn't take them (nothing saved, or strokes it can't tell apart).
   */
  readonly recordAs?: string | null;
};

/** The bytes a compile writes for a layer, or undefined for none (it removes the file). */
const written = (cells: Uint8Array): Buffer | undefined => (cells.some((value) => value !== 0) ? writeCellAttribute(cells) : undefined);

/**
 * `raw` (the Blueprint as stored, which the package was compiled from) with `pathingPaint` made
 * from the package's CellAttribute_Pnp (`file`, undefined when it has none), onto `target` (the
 * Blueprint as the rest of sync left it). `record` is the Mission's compile record when the package
 * is its own; without one any layer is taken as the Editor's.
 */
export function syncPathing(
  raw: Record<string, unknown>,
  target: Record<string, unknown>,
  parse: (raw: Record<string, unknown>) => MissionBlueprint,
  file: Buffer | undefined,
  record: CompileRecord | undefined,
): PathingSyncResult {
  const unchanged = { blueprint: target, changed: [], notes: [] };
  if ((record?.kept ?? []).some((entry) => entry.kind === "file" && entry.path === PATHING_FILE)) return unchanged;
  const entry = record?.entries.find((candidate) => candidate.kind === "file" && candidate.path === PATHING_FILE);
  const print = entry && "fingerprint" in entry ? entry.fingerprint : undefined;
  // Not saved by the Editor since the compile.
  if (record && (file ? print !== undefined && fingerprint(file) === print : print === undefined)) return unchanged;
  // Without a record, a package with no layer says nothing: it may never have had one (a copy, a package from before doodads were painted).
  if (!record && !file) return unchanged;

  let blueprint: MissionBlueprint;
  try {
    blueprint = parse(raw);
  } catch (error) {
    return { ...unchanged, notes: [`Pathing paint, as the Blueprint doesn't validate (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`] };
  }
  const { width, height } = blueprint.mapSize;
  if (file && !cellAttributeFits(file, width, height)) return { ...unchanged, notes: [`Pathing paint, as ${PATHING_FILE} isn't a layer of ${width}×${height} cells`] };
  const editor = file ? readCellAttribute(file, width, height) : new Uint8Array(width * height);

  const terrain = rasterizeTerrain(blueprint, { limitCliffSets: true });
  const compiledFor = (bp: MissionBlueprint, ground: ReturnType<typeof rasterizeTerrain>) => compiledPathing(bp, ground, expandDressing(bp, ground).doodads, blueprintCatalog(bp));
  const compiled = compiledFor(blueprint, terrain);
  // What the last compile may have written: this Blueprint's paint; the pools' with the author's (compiled
  // before doodads were painted); or the pools' with the author's absolute paint (written without objects, generate_terrain's).
  const candidates = [compiled.cells, compiled.withoutDoodads, compiledPathing(blueprint, terrain, [], blueprintCatalog(blueprint), { includeDoodads: false }).cells];
  const matches = (cells: Uint8Array): boolean => {
    const bytes = written(cells);
    return bytes ? print !== undefined && fingerprint(bytes) === print : print === undefined;
  };
  // Without a record nothing says which: the one the Editor's layer is nearest, so its strokes are the fewest.
  const apart = (cells: Uint8Array): number => countSubs(Uint8Array.from(cells, (value, cell) => value ^ editor[cell]!));
  const last = record ? candidates.find(matches) : candidates.reduce((best, cells) => (apart(cells) < apart(best) ? cells : best));
  if (!last) {
    return {
      ...unchanged,
      notes: [`Pathing paint: ${PATHING_FILE} was saved by the Editor, but over a layer the Blueprint no longer compiles (it changed since the compile, or the Editor saved again after a sync that moved doodads, before a compile), so the strokes can't be told apart: keep or discard file:${PATHING_FILE} when you compile`],
    };
  }
  const recordAs = file ? fingerprint(file) : null;
  // The author's strokes since the last compile.
  const added = Uint8Array.from(editor, (value, cell) => value & ~last[cell]!);
  const erased = Uint8Array.from(last, (value, cell) => value & ~editor[cell]!);

  // Laid over what the Blueprint as synced paints: its doodads where they now stand.
  let synced: MissionBlueprint;
  try {
    synced = JSON.stringify(target) === JSON.stringify(raw) ? blueprint : parse(target);
  } catch (error) {
    return { ...unchanged, notes: [`Pathing paint, as the synced Blueprint doesn't validate (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`] };
  }
  const now = synced === blueprint ? compiled : compiledFor(synced, sameGround(blueprint, synced) ? terrain : rasterizeTerrain(synced, { limitCliffSets: true }));
  const wanted = Uint8Array.from(now.cells, (value, cell) => (value & ~erased[cell]!) | added[cell]!);
  const touched = Uint8Array.from(wanted, (value, cell) => value ^ now.cells[cell]!);
  if (!touched.some(Boolean)) return { ...unchanged, recordAs };

  // The entries the strokes miss stay as written; those they touch are made again, each sub-cell staying with the entry's doodad.
  const placedNow = new Map(now.doodads.map((doodad) => [doodad.id, doodad]));
  const before = synced.pathingPaint ?? [];
  const kept: PathingPaint[] = [];
  const prefer = new Map<number, string>();
  for (const entry of before) {
    const subs = paintEntrySubs(entry, width, height, placedNow);
    // One for a doodad that isn't placed stays too: the compile warns about it.
    if (!subs || ![...subs.block, ...subs.clear].some((index) => hasSub(touched, index, width))) {
      kept.push(entry);
      continue;
    }
    for (const index of [...subs.block, ...subs.clear]) if (!prefer.has(index)) prefer.set(index, entry.doodad ?? "");
  }
  const keptLayer = applyPathingPaint(now.base, kept, width, height, placedNow).cells;
  const owners = now.doodads.filter((doodad) => doodad.ring !== undefined).map((doodad) => ({ id: doodad.id, x: doodad.x, y: doodad.y, subs: now.paint.byDoodad.get(doodad.id) ?? [] }));
  const paint = [...kept, ...pathingPaintFrom(keptLayer, wanted, width, height, owners, prefer)];

  const { pathingPaint: _, ...rest } = target;
  return { blueprint: paint.length ? { ...rest, pathingPaint: paint } : rest, changed: describeChanges(now.cells, wanted, width), notes: [], recordAs };
}

/**
 * Whether two Blueprints rasterize to the same ground: they differ only where doodad sync writes
 * (Anchors, set-piece placements, the dressing's edits), which the ground doesn't read but for
 * the built edges' style (rasterize.ts).
 */
function sameGround(a: MissionBlueprint, b: MissionBlueprint): boolean {
  const ground = ({ anchors: _a, placements: _p, dressing, ...rest }: MissionBlueprint) => JSON.stringify({ ...rest, edges: dressing?.edges?.built });
  return ground(a) === ground(b);
}

/** What changed, as the report lists it: the sub-cells painted and erased, and where. */
function describeChanges(from: Uint8Array, to: Uint8Array, width: number): string[] {
  const added = Uint8Array.from(to, (value, cell) => value & ~from[cell]!);
  const removed = Uint8Array.from(from, (value, cell) => value & ~to[cell]!);
  const box = (cells: Uint8Array): string => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let cell = 0; cell < cells.length; cell++) {
      if (!cells[cell]) continue;
      const [x, y] = [cell % width, Math.floor(cell / width)];
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
    return x0 === x1 && y0 === y1 ? `cell (${x0}, ${y0})` : `cells x ${x0}-${x1}, y ${y0}-${y1}`;
  };
  const out: string[] = [];
  if (added.some(Boolean)) out.push(`${countSubs(added)} sub-cells painted at ${box(added)}`);
  if (removed.some(Boolean)) out.push(`${countSubs(removed)} sub-cells erased at ${box(removed)}`);
  return out;
}

