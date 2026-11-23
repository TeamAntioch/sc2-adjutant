// Cliff and ramp brushes on Kept ground (spec #247), on the generator's own cliff and ramp code
// (src/terrain/cliffs.ts, src/terrain/ramps.ts). A cliff level lives at the corners of the 2-cell
// cliff grid, the vertex cliff levels (r2) on Kept ground follow them by the generator's rule, and
// so do the sync cliff levels, the cell flags and the cliff cells: an edit changes the corners,
// works the rest out from the old and new corners by that rule, and writes it only where the two
// differ, so whatever the Editor keeps off the rule elsewhere (round a terrain object) stays.
//
// - raise-cliff / lower-cliff: one level up or down at every corner of the cliff grid inside the
//   area (a corner of a cell inside it). The cliff layer (r1) moves by the level's height and keeps
//   the Editor's small offset per vertex. New cliff cells wear the cliff set already painted on
//   the cell (its <cc cid>), or the one named, from the map's cliff sets.
// - add-ramp: one of the generator's stock ramps (straight, wide diagonal, narrow diagonal),
//   stamped by stampRamp where validateRamp finds the two levels it needs.
// - remove-ramp: a stock ramp taken out, its cells back to plain cliff by the rule above.

import { z } from "zod";

import { getTilesetCliffSets, isKnownCliffSet } from "../catalog/tileset-cliff-sets.js";
import { CELL_FLAG_CLIFF, CELL_FLAG_GROUND, CLIFF_HEIGHTS, type CornerGrid, cliffHeight, MAX_CLIFF_LEVEL, cliffVariation, hasCliffMesh, isCliffCell, syncCellLevels, vertexLevels } from "../terrain/cliffs.js";
import { CLIFF_VARIATION_SEED } from "../terrain/rasterize.js";
import { isDiagonal, type Ramp, type RampDirection, rampOutline, rampXml, stampRamp, validateRamp } from "../terrain/ramps.js";
import type { AreaMask } from "./area.js";
import { type CliffCellEntry, type CliffsChange, type KeptCliffs, rampAttrs } from "./kept-cliffs.js";
import type { GroundChange, KeptGround } from "./kept-ground.js";

const UPHILL = ["south", "north", "west", "east", "south-west", "south-east", "north-west", "north-east"] as const;
const CliffSetName = z.string().min(1).describe("A cliff set from the map's own (t3Terrain.xml's <cliffSetList>); by default the set painted on each cell");
const Vertex = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).strict();

export const CliffBrushSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("raise-cliff"), cliffSet: CliffSetName.optional() }).strict(),
  z.object({ op: z.literal("lower-cliff"), cliffSet: CliffSetName.optional() }).strict(),
  z
    .object({
      op: z.literal("add-ramp"),
      at: Vertex.describe("A straight ramp's top: the middle of its top edge, a corner of the cliff grid (both even). A diagonal ramp's base, the corner it cuts (even; odd for a narrow one)"),
      uphill: z.enum(UPHILL).describe("The way the ramp climbs"),
      low: z.number().int().min(1).max(MAX_CLIFF_LEVEL - 1).describe("The cliff level at its foot"),
      high: z.number().int().min(2).max(MAX_CLIFF_LEVEL).describe("The cliff level at its top: one above low"),
      narrow: z.boolean().optional().describe("A diagonal ramp's narrow form, the ladder main ramp"),
      cliffSet: CliffSetName.optional(),
    })
    .strict(),
  z.object({ op: z.literal("remove-ramp"), at: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().describe("A point on the ramp") }).strict(),
]);
export type CliffBrush = z.input<typeof CliffBrushSchema>;
export type ParsedCliffBrush = z.output<typeof CliffBrushSchema>;
export const isCliffBrush = (brush: { readonly op: string }): brush is ParsedCliffBrush => ["raise-cliff", "lower-cliff", "add-ramp", "remove-ramp"].includes(brush.op);
export const isRampBrush = (brush: { readonly op: string }): boolean => brush.op === "add-ramp" || brush.op === "remove-ramp";

export type CliffEdit = {
  readonly ground: GroundChange;
  readonly cliffs: CliffsChange;
  /** Cliff cells whose entry changed. */
  readonly cliffCells: number;
  /** 1 for each cell a value of which may change: the cells to check against the compile record. */
  readonly touched: Uint8Array;
  readonly done: string;
  readonly would: string;
};

const FOOT = "Nothing was written";

/** How far from remove-ramp's point a stock ramp's centre may be. */
export const RAMP_REACH = 6;

/** Where a removed ramp was, once it is gone: the square remove-ramp searched round its point. */
export function removedRampArea(at: { readonly x: number; readonly y: number }): { polygon: { x: number; y: number }[] } {
  const r = RAMP_REACH;
  return { polygon: [{ x: at.x - r, y: at.y - r }, { x: at.x + r, y: at.y - r }, { x: at.x + r, y: at.y + r }, { x: at.x - r, y: at.y + r }] };
}

/**
 * A ramp brush's footprint, as the area it renders and refuses by: its outline's corners. A removed
 * ramp is found in `cliffs`; with none given (after the edit, when it is gone) its area is the
 * square remove-ramp searched round its point (removedRampArea).
 */
export function rampArea(brush: ParsedCliffBrush, cliffs: KeptCliffs | undefined): { polygon: { x: number; y: number }[] } {
  if (brush.op === "add-ramp") return { polygon: [...rampOutline(rampOf(brush)).corners] };
  if (brush.op === "remove-ramp") return cliffs ? { polygon: [...rampOutline(findRamp(cliffs, brush.at).ramp).corners] } : removedRampArea(brush.at);
  throw new Error(`${brush.op} has an area of its own`);
}

/** Applies a cliff or ramp brush, as above. `mask` is the area, for raise-cliff and lower-cliff. */
export function applyCliffBrush(ground: KeptGround, cliffs: KeptCliffs, brush: ParsedCliffBrush, mask: AreaMask): CliffEdit {
  if (brush.op === "raise-cliff" || brush.op === "lower-cliff") return cliffLevel(ground, cliffs, brush, mask);
  if (brush.op === "add-ramp") return addRamp(ground, cliffs, brush);
  return removeRamp(ground, cliffs, brush);
}

/** The set index for `name`, adding it to the list when the map has no cliff sets yet. */
function cliffSetIndex(cliffs: KeptCliffs, sets: string[], name: string | undefined): number | undefined {
  if (name === undefined) {
    if (sets.length === 0) {
      const natural = getTilesetCliffSets(cliffs.catalog, cliffs.tilesetId)[0];
      if (!natural) throw new Error(`The map has no cliff sets and none is known for its tileset ${cliffs.tilesetId}: name one. ${FOOT}`);
      sets.push(natural);
    }
    return undefined;
  }
  const index = sets.indexOf(name);
  if (index >= 0) return index;
  if (sets.length === 0 && isKnownCliffSet(cliffs.catalog, name)) return sets.push(name) - 1;
  throw new Error(`${name} isn't one of the map's cliff sets (${sets.join(", ") || "none"}): name one of those, or add it in the Editor first. ${FOOT}`);
}

function cliffLevel(ground: KeptGround, cliffs: KeptCliffs, brush: Extract<ParsedCliffBrush, { op: "raise-cliff" | "lower-cliff" }>, mask: AreaMask): CliffEdit {
  const by = brush.op === "raise-cliff" ? 1 : -1;
  const before = cornerGrid(ground);
  const after: CornerGrid = { ...before, levels: Uint8Array.from(before.levels) };
  let moved = 0;
  for (let cy = 0; cy < before.rows; cy++) {
    for (let cx = 0; cx < before.columns; cx++) {
      if (mask.vertexWeight[2 * cy * ground.columns + 2 * cx] !== 1) continue;
      const level = before.levels[cy * before.columns + cx]! + by;
      if (level < 0 || level >= CLIFF_HEIGHTS.length) {
        throw new Error(`The corner at (${2 * cx}, ${2 * cy}) is at cliff level ${level - by}, and levels run 0 to ${CLIFF_HEIGHTS.length - 1}: ${brush.op === "raise-cliff" ? "raise" : "lower"} a smaller area. ${FOOT}`);
      }
      after.levels[cy * before.columns + cx] = level;
      moved++;
    }
  }
  if (moved === 0) throw new Error(`${mask.label} holds no corner of the 2-cell cliff grid (both coordinates even): make it at least 2 cells across. ${FOOT}`);

  const sets = [...cliffs.cliffSets];
  const named = cliffSetIndex(cliffs, sets, brush.cliffSet);
  const edit = setCornerLevels(ground, cliffs, before, after, { cliffSet: named, cliffSets: sets });
  const word = brush.op === "raise-cliff" ? ["Raised", "raise"] : ["Lowered", "lower"];
  const wearing = edit.used.size ? ` (${[...edit.used].map((index) => sets[index]).join(", ")})` : "";
  return {
    ground: edit.ground,
    cliffs: edit.cliffs,
    cliffCells: edit.cliffCells,
    touched: edit.touched,
    done: `${word[0]} the cliff level of ${mask.label} by one, ${edit.cliffCells} cliff cells changed${wearing}`,
    would: `Would ${word[1]} the cliff level of ${mask.label} by one, ${edit.cliffCells} cliff cells changed${wearing}`,
  };
}

/** The corners of the 2-cell cliff grid on Kept ground: the vertex levels at even vertices. */
export function cornerGrid(ground: KeptGround, levels: Uint8Array = ground.levels): CornerGrid {
  const columns = ground.width / 2 + 1;
  const rows = ground.height / 2 + 1;
  const corners = new Uint8Array(columns * rows);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < columns; cx++) corners[cy * columns + cx] = levels[2 * cy * ground.columns + 2 * cx]!;
  return { columns, rows, levels: corners };
}

/**
 * The ground and cliffs after the cliff grid's corners go from `before` to `after`: the vertex
 * levels, cliff layer, sync cliff levels, cell flags and cliff cells by the generator's rule, written
 * only where the rule's answer changes. A new cliff wears `cliffSet` (an index into `cliffSets`, the
 * map's sets after any the edit adds), else the set painted on its cell. A cliff cell that is part
 * of a ramp or round a terrain object is refused, ending the message with `foot`.
 */
export function setCornerLevels(
  ground: KeptGround,
  cliffs: KeptCliffs,
  before: CornerGrid,
  after: CornerGrid,
  { cliffSet, cliffSets = cliffs.cliffSets, foot = FOOT }: { readonly cliffSet?: number | undefined; readonly cliffSets?: readonly string[]; readonly foot?: string },
): { ground: GroundChange; cliffs: CliffsChange; cliffCells: number; touched: Uint8Array; used: Set<number> } {
  const { levels, cliff } = levelsFrom(ground, before, after);
  const syncCliff = syncCliffFrom(ground, cliffs, levels);
  const cells = new Map(cliffs.cells);
  const cellFlags = Uint8Array.from(cliffs.cellFlags);
  const cliffColumns = ground.width / 2;
  let changed = 0;
  const used = new Set<number>();
  for (let cy = 0; cy < before.rows - 1; cy++) {
    for (let cx = 0; cx < cliffColumns; cx++) {
      const index = cy * cliffColumns + cx;
      const corners = [cy * before.columns + cx, cy * before.columns + cx + 1, (cy + 1) * before.columns + cx, (cy + 1) * before.columns + cx + 1];
      if (corners.every((corner) => after.levels[corner] === before.levels[corner])) continue;
      const entry = cells.get(index);
      if (entry && entry.f & 2) throw new Error(`The cliff cell at (${2 * cx}, ${2 * cy}) is part of a ramp: remove the ramp first (remove-ramp). ${foot}`);
      if (entry && entry.f & 12) throw new Error(`The cliff cell at (${2 * cx}, ${2 * cy}) is round a terrain object (t3Terrain.xml's <cliffDoodadList>), whose cliffs come from its model: keep the area clear of it. ${foot}`);
      const cliffAfter = hasCliffMesh(after, cx, cy);
      // A named set goes on the cliffs; flat cells keep the set painted on them.
      const cid = (cliffAfter ? cliffSet : undefined) ?? entry?.cid ?? 0;
      const f = cliffAfter ? (entry?.f ?? 0) | 1 : (entry?.f ?? 0) & ~1;
      const next: CliffCellEntry = { f, cid, cvar: entry?.cvar ?? cliffVariation(index, CLIFF_VARIATION_SEED) };
      if (cliffAfter) used.add(cid);
      if (f === 0 && cid === 0) cells.delete(index);
      else cells.set(index, next);
      if ((entry?.f ?? 0) !== f || (entry?.cid ?? 0) !== cid) changed++;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const cell = (2 * cy + dy) * ground.width + 2 * cx + dx;
        cellFlags[cell] = isCliffCell(cliffAfter, syncCliff[cell]!, cliffs.hidesLowestLevel) ? cellFlags[cell]! | CELL_FLAG_CLIFF : cellFlags[cell]! & ~CELL_FLAG_CLIFF;
      }
    }
  }
  const touched = touchedCells(ground, levels, cliff, syncCliff, cellFlags, cliffs);
  return { ground: { levels, cliff }, cliffs: { cliffSets, cells, syncCliff, cellFlags }, cliffCells: changed, touched, used };
}

/** The vertex levels and cliff layer after a change of corners: by the generator's rule, written only where the rule's answer changes. */
function levelsFrom(ground: KeptGround, before: CornerGrid, after: CornerGrid): { levels: Uint8Array; cliff: Float64Array } {
  const was = vertexLevels(before, ground.width, ground.height);
  const is = vertexLevels(after, ground.width, ground.height);
  const levels = Uint8Array.from(ground.levels);
  const cliff = Float64Array.from(ground.cliff);
  for (let v = 0; v < levels.length; v++) {
    if (was[v] === is[v]) continue;
    levels[v] = is[v]!;
    // The cliff layer moves by the level's height in whole quantization steps, keeping the Editor's
    // offset at the vertex to the byte, so a level raised and lowered again comes back as it was.
    const steps = Math.round((CLIFF_HEIGHTS[is[v]!]! - CLIFF_HEIGHTS[ground.levels[v]!]!) / ground.quantizeScale);
    cliff[v] = ground.cliff[v]! + steps * ground.quantizeScale;
  }
  return { levels, cliff };
}

/**
 * How far the vertex's cliff layer sits from its level's height: the Editor leaves a few
 * thousandths at many vertices (on a 256×256 Kept map: -0.001 to -0.005). Within a quantization step it's
 * rounding, and taken as none, so a level's height comes back to the same bytes.
 */
function offsetAt(ground: KeptGround, v: number): number {
  const offset = ground.cliff[v]! - CLIFF_HEIGHTS[ground.levels[v]!]!;
  return Math.abs(offset) <= ground.quantizeScale ? 0 : offset;
}

/** t3SyncCliffLevel after the vertex levels change, by the generator's rule where its answer changes. */
function syncCliffFrom(ground: KeptGround, cliffs: KeptCliffs, levels: Uint8Array): Uint16Array {
  const was = syncCellLevels(ground.levels, ground.width, ground.height);
  const is = syncCellLevels(levels, ground.width, ground.height);
  const syncCliff = Uint16Array.from(cliffs.syncCliff);
  for (let cell = 0; cell < syncCliff.length; cell++) if (was[cell] !== is[cell]) syncCliff[cell] = is[cell]! * 64;
  return syncCliff;
}

/** Cells with a corner whose level or cliff layer changes, or whose own sync cliff level or flags do. */
function touchedCells(ground: KeptGround, levels: Uint8Array, cliff: Float64Array, syncCliff: Uint16Array, cellFlags: Uint8Array, cliffs: KeptCliffs): Uint8Array {
  const { width, height, columns } = ground;
  const touched = new Uint8Array(width * height);
  const vertex = (v: number) => levels[v] !== ground.levels[v] || cliff[v] !== ground.cliff[v];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      if (syncCliff[cell] !== cliffs.syncCliff[cell] || cellFlags[cell] !== cliffs.cellFlags[cell] || [y * columns + x, y * columns + x + 1, (y + 1) * columns + x, (y + 1) * columns + x + 1].some(vertex)) touched[cell] = 1;
    }
  }
  return touched;
}

const rampKind = (ramp: Ramp): string => (isDiagonal(ramp.direction) ? (ramp.narrow ? "narrow diagonal" : "diagonal") : "straight");

function rampOf(brush: Extract<ParsedCliffBrush, { op: "add-ramp" }>): Ramp {
  const direction = UPHILL.indexOf(brush.uphill) as RampDirection;
  if (brush.narrow && !isDiagonal(direction)) throw new Error(`Only a diagonal ramp has a narrow form; ${brush.uphill} is straight. ${FOOT}`);
  return { direction, edge: brush.at, lowLevel: brush.low, ...(brush.narrow ? { narrow: true as const } : {}) };
}

/** Where a ramp's stamp writes: its vertices, cells and cliff cells. */
function footprint(ramp: Ramp, ground: KeptGround): { vertices: number[]; cells: number[]; cliffCells: number[] } {
  const cliffHeights = new Float32Array(ground.levels.length).fill(Number.NaN);
  const syncCliff = new Uint16Array(ground.width * ground.height).fill(0xffff);
  const cellFlags = new Uint8Array(ground.width * ground.height).fill(0xff);
  const cliffCellFlags = new Map<number, number>();
  const vertexCliffLevels = new Uint8Array(ground.levels.length).fill(0xff);
  stampRamp(ramp, { width: ground.width, height: ground.height, cliffHeights, syncCliff, cellFlags, cliffCellFlags, vertexCliffLevels });
  const vertices: number[] = [];
  for (let v = 0; v < cliffHeights.length; v++) if (!Number.isNaN(cliffHeights[v]!) || vertexCliffLevels[v] !== 0xff) vertices.push(v);
  const cells: number[] = [];
  for (let cell = 0; cell < syncCliff.length; cell++) if (syncCliff[cell] !== 0xffff || cellFlags[cell] !== 0xff) cells.push(cell);
  return { vertices, cells, cliffCells: [...cliffCellFlags.keys()] };
}

function addRamp(ground: KeptGround, cliffs: KeptCliffs, brush: Extract<ParsedCliffBrush, { op: "add-ramp" }>): CliffEdit {
  if (brush.high !== brush.low + 1) throw new Error(`A stock ramp climbs one cliff level, from ${brush.low} to ${brush.low + 1}, not to ${brush.high}. ${FOOT}`);
  const ramp = rampOf(brush);
  try {
    validateRamp(ramp, cornerGrid(ground));
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}, so a ramp from level ${brush.low} to ${brush.high} doesn't fit there. ${FOOT}`, { cause: error });
  }
  const at = footprint(ramp, ground);
  for (const index of at.cliffCells) {
    const entry = cliffs.cells.get(index);
    const where = `(${(index % (ground.width / 2)) * 2}, ${Math.floor(index / (ground.width / 2)) * 2})`;
    if (entry && entry.f & 2) throw new Error(`The ramp would overlap another ramp at the cliff cell ${where}. ${FOOT}`);
    if (entry && entry.f & 12) throw new Error(`The ramp would cut into a terrain object's cliffs at the cliff cell ${where}. ${FOOT}`);
  }
  const sets = [...cliffs.cliffSets];
  // The ramp wears the set of the cliff it cuts through, as the generator's does: the most of its cliff cells'.
  let cid = cliffSetIndex(cliffs, sets, brush.cliffSet);
  if (cid === undefined) {
    const counts = new Map<number, number>();
    for (const index of at.cliffCells) {
      const entry = cliffs.cells.get(index);
      if (entry && entry.f & 1) counts.set(entry.cid, (counts.get(entry.cid) ?? 0) + 1);
    }
    cid = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
    if (sets[cid] === undefined) {
      throw new Error(`The cliff the ramp cuts wears cliff set ${cid}, which t3Terrain.xml's <cliffSetList> doesn't have (${sets.join(", ") || "none"}): name one of those with cliffSet. ${FOOT}`);
    }
  }
  const placed: Ramp = cid === 0 ? ramp : { ...ramp, cliffSet: cid };

  // Stamped over the map's own values, then written where the stamp changed them.
  const nominal = Float32Array.from(ground.levels, cliffHeight);
  const cliffHeights = Float32Array.from(nominal);
  const syncCliff = Uint16Array.from(cliffs.syncCliff);
  const stampedFlags = Uint8Array.from(cliffs.cellFlags, (flags) => flags & 0x03);
  const cliffCellFlags = new Map([...cliffs.cells].map(([index, entry]) => [index, entry.f]));
  const levels = Uint8Array.from(ground.levels);
  stampRamp(placed, { width: ground.width, height: ground.height, cliffHeights, syncCliff, cellFlags: stampedFlags, cliffCellFlags, vertexCliffLevels: levels });
  const cliff = Float64Array.from(ground.cliff);
  for (const v of at.vertices) {
    if (cliffHeights[v] === nominal[v] && levels[v] === ground.levels[v]) continue;
    cliff[v] = cliffHeights[v]! + offsetAt(ground, v);
  }
  const cellFlags = Uint8Array.from(cliffs.cellFlags);
  for (const cell of at.cells) cellFlags[cell] = (cliffs.cellFlags[cell]! & ~0x03) | stampedFlags[cell]!;
  const cells = new Map(cliffs.cells);
  let changed = 0;
  for (const index of at.cliffCells) {
    const entry = cliffs.cells.get(index);
    // A named set goes on the ramp's cliff cells too; else each keeps the set painted on it.
    const next = { f: ((entry?.f ?? 0) & ~0x03) | cliffCellFlags.get(index)!, cid: brush.cliffSet === undefined ? (entry?.cid ?? cid) : cid, cvar: entry?.cvar ?? cliffVariation(index, CLIFF_VARIATION_SEED) };
    cells.set(index, next);
    if (!entry || entry.f !== next.f || entry.cid !== next.cid) changed++;
  }
  const touched = touchedCells(ground, levels, cliff, syncCliff, cellFlags, cliffs);
  const what = `a ${rampKind(ramp)} ramp up ${brush.uphill} from level ${brush.low} to ${brush.high} at (${brush.at.x}, ${brush.at.y})`;
  return {
    ground: { levels, cliff },
    cliffs: { cliffSets: sets, cells, syncCliff, cellFlags, ramps: [...cliffs.ramps.map((kept) => kept.text), rampXml(placed)] },
    cliffCells: changed,
    touched,
    done: `Added ${what} (${sets[cid]})`,
    would: `Would add ${what} (${sets[cid]})`,
  };
}

/** A <ramp>'s pieces with the Editor's -0 written as 0, for comparing one with the generator's. */
const pieces = (attrs: Readonly<Record<string, string>>): string =>
  ["dir", "hi", "lo", "leftLo", "rightLo", "base", "mid"].map((name) => (attrs[name] ?? "").replaceAll("-0.000000e+00", "0.000000e+00")).join("|");

/** The stock ramp a <ramp> is, when it is one: the generator's rampXml writes the same pieces. */
function stockRamp(kept: { readonly attrs: Readonly<Record<string, string>> }): Ramp | undefined {
  const direction = Number(kept.attrs.dir) as RampDirection;
  const lowLevel = Number(kept.attrs.lo);
  const centre = /c=\(([^,]+),\s*([^)]+)\)/.exec(kept.attrs.base ?? "");
  if (!centre || !(direction >= 0 && direction <= 7)) return undefined;
  const c = { x: Number(centre[1]), y: Number(centre[2]) };
  const candidates: Ramp[] = isDiagonal(direction)
    ? [false, true].map((narrow) => ({ direction, lowLevel, edge: { x: Math.round(c.x), y: Math.round(c.y) }, ...(narrow ? { narrow: true as const } : {}) }))
    : [{ direction, lowLevel, edge: { x: Math.round(c.x + [0, 0, -1, 1][direction]!), y: Math.round(c.y + [-1, 1, 0, 0][direction]!) } }];
  return candidates.find((ramp) => pieces(rampAttrs(rampXml(ramp))) === pieces(kept.attrs));
}

function findRamp(cliffs: KeptCliffs, point: { x: number; y: number }): { ramp: Ramp; index: number } {
  let best: { ramp: Ramp; index: number; distance: number } | undefined;
  let other = false;
  cliffs.ramps.forEach((kept, index) => {
    const ramp = stockRamp(kept);
    if (!ramp) {
      other ||= true;
      return;
    }
    const { corners } = rampOutline(ramp);
    const cx = corners.reduce((sum, corner) => sum + corner.x, 0) / corners.length;
    const cy = corners.reduce((sum, corner) => sum + corner.y, 0) / corners.length;
    const distance = Math.hypot(point.x - cx, point.y - cy);
    if (distance <= RAMP_REACH && (!best || distance < best.distance)) best = { ramp, index, distance };
  });
  if (!best) {
    const others = other ? ": the map's other ramps aren't the generator's stock ramps, so remove those in the Editor" : "";
    throw new Error(`No stock ramp is within ${RAMP_REACH} cells of (${point.x}, ${point.y})${others}. ${FOOT}`);
  }
  return best;
}

function removeRamp(ground: KeptGround, cliffs: KeptCliffs, brush: Extract<ParsedCliffBrush, { op: "remove-ramp" }>): CliffEdit {
  const { ramp, index } = findRamp(cliffs, brush.at);
  const at = footprint(ramp, ground);
  const corners = cornerGrid(ground);
  // Back to plain cliff by the generator's rule, over the footprint.
  const plain = vertexLevels(corners, ground.width, ground.height);
  const levels = Uint8Array.from(ground.levels);
  const cliff = Float64Array.from(ground.cliff);
  for (const v of at.vertices) {
    levels[v] = plain[v]!;
    const height = CLIFF_HEIGHTS[plain[v]!]!;
    // A vertex the ramp left at its level's height keeps its own cliff layer.
    if (levels[v] !== ground.levels[v] || Math.abs(ground.cliff[v]! - height) > 0.01) cliff[v] = height;
  }
  const sync = syncCellLevels(levels, ground.width, ground.height);
  const syncCliff = Uint16Array.from(cliffs.syncCliff);
  const cellFlags = Uint8Array.from(cliffs.cellFlags);
  const cliffColumns = ground.width / 2;
  const meshAt = (cx: number, cy: number) => hasCliffMesh(corners, cx, cy);
  for (const cell of at.cells) {
    syncCliff[cell] = sync[cell]! * 64;
    const x = cell % ground.width;
    const y = Math.floor(cell / ground.width);
    cellFlags[cell] = (cliffs.cellFlags[cell]! & ~0x03) | CELL_FLAG_GROUND | (isCliffCell(meshAt(x >> 1, y >> 1), syncCliff[cell]!, cliffs.hidesLowestLevel) ? CELL_FLAG_CLIFF : 0);
  }
  const cells = new Map(cliffs.cells);
  let changed = 0;
  for (const cliffIndex of at.cliffCells) {
    const entry = cliffs.cells.get(cliffIndex);
    if (!entry) continue;
    const f = (entry.f & ~0x03) | (meshAt(cliffIndex % cliffColumns, Math.floor(cliffIndex / cliffColumns)) ? 1 : 0);
    if (f === 0 && entry.cid === 0) cells.delete(cliffIndex);
    else cells.set(cliffIndex, { ...entry, f });
    if (f !== entry.f || (f === 0 && entry.cid === 0)) changed++;
  }
  const touched = touchedCells(ground, levels, cliff, syncCliff, cellFlags, cliffs);
  const what = `the ${rampKind(ramp)} ramp up ${UPHILL[ramp.direction]} from level ${ramp.lowLevel} to ${ramp.lowLevel + 1} at (${ramp.edge.x}, ${ramp.edge.y})`;
  return {
    ground: { levels, cliff },
    cliffs: { cells, syncCliff, cellFlags, ramps: cliffs.ramps.filter((_, i) => i !== index).map((kept) => kept.text) },
    cliffCells: changed,
    touched,
    done: `Removed ${what}`,
    would: `Would remove ${what}`,
  };
}
