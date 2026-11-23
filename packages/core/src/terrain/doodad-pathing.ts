// No-pathing under placed doodads (CellAttribute_Pnp). Most doodads' data gives them no footprint,
// so units walk through them (docs/reference/doodad-pathing.md). The
// compile paints the Editor's sub-cells under each solid piece's ground outline
// (catalog/doodad-outlines.ts) at its position, turn, scale and variation, over the dug pools'
// paint, and then the author's own paint (`pathingPaint`), which sync brings back from the Editor:
// what they erase stays erased, what they paint stays painted. Painting over a footprint the
// doodad has anyway changes nothing.
//
// The Editor's grid: each cell is 2 sub-cells across and 4 high (pathingBit), so a sub-cell is half
// a cell wide and a quarter high. Sub-cell (sx, sy) of a map W cells wide is index sy × 2W + sx.

import { type Catalog, EMPTY_CATALOG } from "../catalog/catalog-layer.js";
import { getDoodadDescription } from "../catalog/mod-doodad-index.js";
import { bundledDoodadOutlines, type DoodadOutlines, OUTLINE_STEP, outlineCovers } from "../catalog/doodad-outlines.js";
import { getDoodad } from "../catalog/stock-catalog.js";
import type { PathingPaint } from "../domain/mission-blueprint.js";
import { pathingBit } from "./write-cell-attribute.js";

/** Sub-cells a cell, across and up. */
export const SUB_X = 2;
export const SUB_Y = 4;
/** Catalog roles painted by default: pieces that stand up solid. */
const SOLID_ROLES = new Set(["structure", "prop", "cliff"]);
/** Rings of a set piece painted by default: its anchor and props, and the pieces added by hand. */
const SOLID_RINGS = new Set(["anchor", "props", "added"]);
/** Of a sub-cell's 4 sample points, how many the outline must cover for it to be painted: half. */
const COVERED = 2;
/**
 * Cells above the ground a doodad's origin may stand and still be painted: its outline is cut 0.25
 * to 1 above its origin, so raised further it stands clear of a unit's height (an overhead pipe).
 */
const RAISED = 0.75;
/** Cells from a doodad's paint (or its origin) within which an Editor stroke is taken as its own. */
const NEAR = 2;

/** A placed doodad, as the compile writes it, with where it came from. */
export type PathingDoodad = {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  /** Radians, counterclockwise from east. */
  readonly rotation: number;
  readonly scale: number | readonly [number, number, number];
  readonly variation: number;
  /** Its set piece's ring, `added`, or `anchor-object` for a doodad Anchor; undefined for other dressing. */
  readonly ring?: "anchor" | "props" | "clutter" | "added" | "anchor-object";
  readonly pathing?: "block" | "walk";
  /** Cells its origin stands above the ground there: a composite's raised member, a piece set up by hand. */
  readonly raised?: number;
};

/** Whether the compile paints under this doodad: its own `pathing`, else a solid ring and catalog role, standing on the ground. */
export function paintsPathing(doodad: Pick<PathingDoodad, "type" | "ring" | "pathing" | "raised">, catalog: Catalog): boolean {
  if (doodad.pathing) return doodad.pathing === "block";
  if ((doodad.raised ?? 0) > RAISED) return false;
  if (!doodad.ring || !(SOLID_RINGS.has(doodad.ring) || doodad.ring === "anchor-object")) return false;
  const role = getDoodadDescription(catalog, doodad.type)?.role;
  return role !== undefined && SOLID_ROLES.has(role);
}

/** The sub-cell index of (sx, sy) on a map `width` cells wide. */
const subIndex = (sx: number, sy: number, width: number): number => sy * width * SUB_X + sx;

/** Whether sub-cell `index` is painted in a byte-a-cell layer. */
export function hasSub(cells: Uint8Array, index: number, width: number): boolean {
  const sx = index % (width * SUB_X);
  const sy = Math.floor(index / (width * SUB_X));
  return (cells[Math.floor(sy / SUB_Y) * width + Math.floor(sx / SUB_X)]! & pathingBit(sx % SUB_X, sy % SUB_Y)) !== 0;
}

function setSub(cells: Uint8Array, index: number, width: number, on: boolean): void {
  const sx = index % (width * SUB_X);
  const sy = Math.floor(index / (width * SUB_X));
  const cell = Math.floor(sy / SUB_Y) * width + Math.floor(sx / SUB_X);
  const bit = pathingBit(sx % SUB_X, sy % SUB_Y);
  cells[cell] = on ? cells[cell]! | bit : cells[cell]! & ~bit;
}

/** The sub-cell under a doodad's origin, (sx, sy), which its `pathingPaint` offsets are from. */
export const originSub = (doodad: { readonly x: number; readonly y: number }): readonly [number, number] => [Math.floor(doodad.x * SUB_X), Math.floor(doodad.y * SUB_Y)];

/**
 * The sub-cells a doodad's outline covers on a `width` × `height` map, as indices; undefined when
 * its type or variation has no outline recorded, empty when nothing of it is solid at a unit's height.
 */
export function doodadSubCells(doodad: PathingDoodad, width: number, height: number, outlines: ReadonlyMap<string, DoodadOutlines> = bundledDoodadOutlines()): number[] | undefined {
  const variations = outlines.get(doodad.type)?.variations;
  if (!variations || doodad.variation >= variations.length) return undefined;
  const outline = variations[doodad.variation];
  if (!outline) return [];
  const [sx, sy] = typeof doodad.scale === "number" ? [doodad.scale, doodad.scale] : [doodad.scale[0], doodad.scale[1]];
  const cos = Math.cos(doodad.rotation);
  const sin = Math.sin(doodad.rotation);
  // The outline's corners on the map, for the sub-cells to look at.
  const corners = [
    [outline.x, outline.y],
    [outline.x + outline.width * OUTLINE_STEP, outline.y],
    [outline.x, outline.y + outline.height * OUTLINE_STEP],
    [outline.x + outline.width * OUTLINE_STEP, outline.y + outline.height * OUTLINE_STEP],
  ].map(([mx, my]) => [doodad.x + (mx! * sx * cos - my! * sy * sin), doodad.y + (mx! * sx * sin + my! * sy * cos)] as const);
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])) * SUB_X));
  const x1 = Math.min(width * SUB_X - 1, Math.floor(Math.max(...corners.map((c) => c[0])) * SUB_X));
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])) * SUB_Y));
  const y1 = Math.min(height * SUB_Y - 1, Math.floor(Math.max(...corners.map((c) => c[1])) * SUB_Y));
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let covered = 0;
      for (const fy of [0.25, 0.75]) {
        for (const fx of [0.25, 0.75]) {
          // The sample point back in the model's frame: unturned, then unscaled.
          const dx = (x + fx) / SUB_X - doodad.x;
          const dy = (y + fy) / SUB_Y - doodad.y;
          if (outlineCovers(outline, (dx * cos + dy * sin) / sx, (-dx * sin + dy * cos) / sy)) covered++;
        }
      }
      if (covered >= COVERED) out.push(subIndex(x, y, width));
    }
  }
  return out;
}

export type DoodadPaint = {
  /** A byte a cell, as CellAttribute_Pnp holds it: the doodads' paint alone. */
  readonly cells: Uint8Array;
  /** Each painting doodad's sub-cells, by id. */
  readonly byDoodad: ReadonlyMap<string, readonly number[]>;
  /** Types (with their variations) the compile would paint under but has no outline for. */
  readonly missing: ReadonlyMap<string, ReadonlySet<number>>;
};

/** The paint under every doodad `paintsPathing` picks. */
export function paintDoodads(doodads: readonly PathingDoodad[], width: number, height: number, catalog: Catalog, outlines?: ReadonlyMap<string, DoodadOutlines>): DoodadPaint {
  const cells = new Uint8Array(width * height);
  const byDoodad = new Map<string, number[]>();
  const missing = new Map<string, Set<number>>();
  for (const doodad of doodads) {
    if (!paintsPathing(doodad, catalog)) continue;
    const subs = doodadSubCells(doodad, width, height, outlines);
    if (!subs) {
      missing.set(doodad.type, (missing.get(doodad.type) ?? new Set()).add(doodad.variation));
      continue;
    }
    byDoodad.set(doodad.id, subs);
    for (const index of subs) setSub(cells, index, width, true);
  }
  return { cells, byDoodad, missing };
}

/**
 * A warning naming the doodads the compile would paint under but has no outline for; undefined for
 * none. A game doodad's outline can be recorded; a mod's or the Blueprint's own can't yet
 * (record-doodad-outlines.ts reads the game's catalog), so for those the warning says to paint
 * the pathing in the Editor instead.
 */
export function missingOutlineWarning(missing: ReadonlyMap<string, ReadonlySet<number>>): string | undefined {
  if (missing.size === 0) return undefined;
  const types = [...missing.keys()].sort();
  const named = (list: readonly string[]): string => list.map((type) => `${type} (variation ${[...missing.get(type)!].sort((a, b) => a - b).join(", ")})`).join(", ");
  const game = types.filter((type) => getDoodad(EMPTY_CATALOG, type) !== undefined);
  const own = types.filter((type) => !game.includes(type));
  const them = (list: readonly string[]): string => (list.length === 1 ? "it" : "them");
  const parts = [
    ...(game.length ? [`record ${game.length === 1 ? "the outline" : "the outlines"} of ${game.join(", ")} with \`npm run doodad-outlines -- ${game.join(" ")}\` in sc2-adjutant`] : []),
    ...(own.length ? [`${own.join(", ")} ${own.length === 1 ? "isn't a game doodad, whose outline" : "aren't game doodads, whose outlines"} can't be recorded yet: paint the pathing under ${them(own)} in the Editor and sync`] : []),
  ];
  return `No ground outline is recorded for ${named(types)}, so units walk through ${them(types)}: ${parts.join("; ")}; or set pathing: "walk" on ${them(types)}`;
}

/** The sub-cells of a `pathingPaint` rectangle, offset by `origin` (in sub-cells), inside the map. */
function rectSubs([x, y, w, h]: readonly [number, number, number, number], origin: readonly [number, number], width: number, height: number): number[] {
  const out: number[] = [];
  const sx0 = origin[0] + Math.round(x * SUB_X);
  const sy0 = origin[1] + Math.round(y * SUB_Y);
  for (let sy = Math.max(0, sy0); sy < Math.min(height * SUB_Y, sy0 + Math.round(h * SUB_Y)); sy++) {
    for (let sx = Math.max(0, sx0); sx < Math.min(width * SUB_X, sx0 + Math.round(w * SUB_X)); sx++) out.push(subIndex(sx, sy, width));
  }
  return out;
}

/** Where a `pathingPaint` entry's rectangles fall: the sub-cells it blocks and clears; undefined for a doodad that isn't placed. */
export function paintEntrySubs(entry: PathingPaint, width: number, height: number, doodads: ReadonlyMap<string, { readonly x: number; readonly y: number }>): { readonly block: number[]; readonly clear: number[] } | undefined {
  const doodad = entry.doodad === undefined ? undefined : doodads.get(entry.doodad);
  if (entry.doodad !== undefined && !doodad) return undefined;
  const origin = doodad ? originSub(doodad) : ([0, 0] as const);
  const subs = (rects: PathingPaint["block"]): number[] => (rects ?? []).flatMap((rect) => rectSubs(rect, origin, width, height));
  return { block: subs(entry.block), clear: subs(entry.clear) };
}

/**
 * `base` with the author's paint applied: every entry's `clear` erased, then every `block` painted,
 * a doodad's at offsets from its origin sub-cell. An entry for a doodad that isn't placed is left
 * out, with a warning.
 */
export function applyPathingPaint(base: Uint8Array, paint: readonly PathingPaint[], width: number, height: number, doodads: ReadonlyMap<string, { readonly x: number; readonly y: number }>): { readonly cells: Uint8Array; readonly warnings: readonly string[] } {
  const cells = Uint8Array.from(base);
  const warnings: string[] = [];
  const placed = paint.flatMap((entry) => {
    const subs = paintEntrySubs(entry, width, height, doodads);
    if (!subs) warnings.push(`pathingPaint for doodad ${entry.doodad} is left out: no doodad of that id is placed (its set piece or Anchor changed). Paint it again in the Editor and sync, or remove the entry`);
    return subs ? [subs] : [];
  });
  for (const { clear } of placed) for (const index of clear) setSub(cells, index, width, false);
  for (const { block } of placed) for (const index of block) setSub(cells, index, width, true);
  return { cells, warnings };
}

/**
 * The fewest-ish rectangles covering `subs` exactly, greedily, bottom row first, each as wide as it
 * runs and then as tall as the rows above repeat it: the same sub-cells give the same rectangles.
 * Each is [sx, sy, w, h] in sub-cells.
 */
export function subRects(subs: Iterable<number>, width: number): [number, number, number, number][] {
  const rowWidth = width * SUB_X;
  const left = new Set(subs);
  const out: [number, number, number, number][] = [];
  for (const start of [...left].sort((a, b) => a - b)) {
    if (!left.has(start)) continue;
    const sx = start % rowWidth;
    const sy = Math.floor(start / rowWidth);
    let w = 1;
    while (sx + w < rowWidth && left.has(start + w)) w++;
    let h = 1;
    while (Array.from({ length: w }, (_, i) => start + h * rowWidth + i).every((index) => left.has(index))) h++;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) left.delete(start + dy * rowWidth + dx);
    out.push([sx, sy, w, h]);
  }
  return out;
}

/** A doodad sync may give the author's strokes to: where it stands, and what the compile paints under it. */
export type PaintOwner = { readonly id: string; readonly x: number; readonly y: number; readonly subs: readonly number[] };

/**
 * The `pathingPaint` that turns `base` (what the compile paints: dug pools and doodads) into
 * `editor` (the package's CellAttribute_Pnp), each sub-cell given to a doodad where it can be, so it
 * moves with it: an erased sub-cell to the first doodad (by id) whose paint it was, a painted one to
 * the nearest doodad within NEAR cells of its paint or origin. The rest stand where they are.
 * `prefer` gives a sub-cell to an owner first (a doodad's id, or "" for none): the one whose entry
 * had it already. Entries come without a doodad first, then by doodad id; none when the two agree.
 */
export function pathingPaintFrom(base: Uint8Array, editor: Uint8Array, width: number, height: number, owners: readonly PaintOwner[], prefer: ReadonlyMap<number, string> = new Map()): PathingPaint[] {
  const sorted = [...owners].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const paintedBy = new Map<number, string>();
  for (const owner of sorted) for (const index of owner.subs) if (!paintedBy.has(index)) paintedBy.set(index, owner.id);
  // Each owner's reach: its paint's (or origin's) box, NEAR cells wider, in sub-cells.
  const reach = sorted.map((owner) => {
    let [x0, y0, x1, y1] = owner.subs.length ? [Infinity, Infinity, -Infinity, -Infinity] : [...originSub(owner), ...originSub(owner)];
    for (const index of owner.subs) {
      const [sx, sy] = [index % (width * SUB_X), Math.floor(index / (width * SUB_X))];
      [x0, y0, x1, y1] = [Math.min(x0, sx), Math.min(y0, sy), Math.max(x1, sx), Math.max(y1, sy)];
    }
    return { owner, x0: x0 - NEAR * SUB_X, x1: x1 + NEAR * SUB_X, y0: y0 - NEAR * SUB_Y, y1: y1 + NEAR * SUB_Y };
  });
  const known = new Set(sorted.map((owner) => owner.id));
  const nearest = (sx: number, sy: number): string | undefined => {
    let best: { id: string; distance: number } | undefined;
    for (const { owner, x0, x1, y0, y1 } of reach) {
      if (sx < x0 || sx > x1 || sy < y0 || sy > y1) continue;
      const distance = Math.hypot((sx + 0.5) / SUB_X - owner.x, (sy + 0.5) / SUB_Y - owner.y);
      if (!best || distance < best.distance) best = { id: owner.id, distance };
    }
    return best?.id;
  };
  const blocks = new Map<string, number[]>();
  const clears = new Map<string, number[]>();
  const ABSOLUTE = "";
  for (let cell = 0; cell < width * height; cell++) {
    if (base[cell] === editor[cell]) continue;
    const cx = cell % width;
    const cy = Math.floor(cell / width);
    for (let dy = 0; dy < SUB_Y; dy++) {
      for (let dx = 0; dx < SUB_X; dx++) {
        const sx = cx * SUB_X + dx;
        const sy = cy * SUB_Y + dy;
        const index = subIndex(sx, sy, width);
        const was = hasSub(base, index, width);
        const now = hasSub(editor, index, width);
        if (was === now) continue;
        const preferred = prefer.get(index);
        const owner = preferred !== undefined && (preferred === ABSOLUTE || known.has(preferred)) ? preferred : was ? (paintedBy.get(index) ?? ABSOLUTE) : (nearest(sx, sy) ?? ABSOLUTE);
        const into = was ? clears : blocks;
        const list = into.get(owner);
        if (list) list.push(index);
        else into.set(owner, [index]);
      }
    }
  }
  const origins = new Map(sorted.map((owner) => [owner.id, originSub(owner)]));
  const ids = [...new Set([...blocks.keys(), ...clears.keys()])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ids.map((id) => {
    const [ox, oy] = id === ABSOLUTE ? [0, 0] : origins.get(id)!;
    const rects = (subs: number[] | undefined) => subRects(subs ?? [], width).map(([sx, sy, w, h]): [number, number, number, number] => [(sx - ox) / SUB_X, (sy - oy) / SUB_Y, w / SUB_X, h / SUB_Y]);
    const block = rects(blocks.get(id));
    const clear = rects(clears.get(id));
    return { ...(id === ABSOLUTE ? {} : { doodad: id }), ...(block.length ? { block } : {}), ...(clear.length ? { clear } : {}) };
  });
}

/** Painted sub-cells in a layer. */
export function countSubs(cells: Uint8Array): number {
  let count = 0;
  for (const byte of cells) for (let bits = byte; bits; bits &= bits - 1) count++;
  return count;
}
