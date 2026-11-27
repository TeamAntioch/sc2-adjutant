// Paint Regions rasterised (ADR-0028, #134): each region's polygon becomes the cells it paints and a
// strength per texel, and its mix becomes each texture set's layers. The painters (paint-textures.ts
// on a generated map, paint-brushes.ts beside Kept ground) lay the regions, in order, over the
// Zones' paint, texel by texel, with applyPaintRegions.
//
// - **Cells.** A region paints the cells whose centre its outline holds, at its `levels` (a cell's
//   level is its Zone's elevation), and, beside Kept ground, only the generating Zones' cells.
// - **Feather.** Over `falloff` cells inward from the edge of those cells a texel's strength rises
//   from 0 to 1 by the Kept-ground stroke's smoothstep (texture-grid.ts's `feather`, measured from
//   the texel's middle at the masks' 8 texels per cell). It never reaches past them.
// - **Mix.** At full strength a texture with a blend weight holds that fraction of the texel's
//   layers. A texture with no amount takes what's left; with none, the ground's other textures
//   are scaled to fill it. A texture with an area share keeps its palette strength for now (#135).
//   A region naming a texture the set of a cell it paints lacks is refused.
// - **Weights.** A painted texel's shares are rounded to 15 by quantizeDithered, so a weight of 0.15
//   (2.25 of 15) comes out as 2 in some texels and 3 in others, and the cell holds 15% on average.

import type { MissionBlueprint, PaintRegion } from "../domain/mission-blueprint.js";
import { containsPoint } from "./polygon.js";
import { distanceToCell, feather, LAYERS, TEXELS_PER_CELL } from "./texture-grid.js";

/** A region's default falloff, in cells. */
export const DEFAULT_FALLOFF = 2;
const FULL = 15;

/** A region's mix on one texture set's 8 layers. */
export type SetMix = {
  /** The blend weight on each layer, NaN for a layer the mix gives none. */
  readonly weights: Float64Array;
  /** Layers with an area share: painted at their palette strength until #135. */
  readonly shares: readonly number[];
  /** The layer taking what the others leave, -1 for none (the ground's other textures share it). */
  readonly rest: number;
  /** 1 for each layer the mix names. */
  readonly named: Uint8Array;
};

/** One region, rasterised: its cells, each texel's strength over the cells' bounds, and its mix by set. */
export type RasterisedRegion = {
  readonly id: string;
  /** 1 for each cell it paints: [y * width + x]. */
  readonly cells: Uint8Array;
  /** The bounds of its cells, in cells. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Each texel's strength, 0..1, over the bounds: [(ty - y·8) * width·8 + tx - x·8]. */
  readonly strength: Float32Array;
  /** The mix on each set its cells are on, by set index. */
  readonly mixBySet: ReadonlyMap<number, SetMix>;
};

/** What rasterisePaintRegions needs of the map it paints. */
export type PaintRegionGround = {
  readonly width: number;
  readonly height: number;
  /** Each cell's Zone (an index into `zones`), -1 for none: a region's `levels` read its elevation. */
  readonly owner: Int16Array;
  readonly zones: readonly { readonly id: string; readonly elevation: number; readonly polygon: MissionBlueprint["zones"][number]["polygon"] }[];
  /** The texture set a cell is on. */
  readonly setOf: (x: number, y: number) => number;
  /** A set's 8 textures, by layer. */
  readonly setTextures: (set: number) => readonly string[];
  /** How a refusal names a set: "the map's textures (set 0)", "texture set cave". */
  readonly setLabel: (set: number) => string;
  /** Whether a region may paint a cell at all (beside Kept ground, a generating Zone's); every cell when left out. */
  readonly paints?: (cell: number) => boolean;
};

/**
 * The Blueprint's Paint Regions rasterised, in order, leaving out a region that paints no cell. A
 * region naming a texture one of its cells' sets lacks is refused, naming the set and its textures.
 */
export function rasterisePaintRegions(regions: readonly PaintRegion[] | undefined, ground: PaintRegionGround): RasterisedRegion[] {
  return (regions ?? []).flatMap((region) => {
    const rasterised = rasteriseRegion(region, ground);
    return rasterised ? [rasterised] : [];
  });
}

function rasteriseRegion(region: PaintRegion, ground: PaintRegionGround): RasterisedRegion | undefined {
  const { width, height, owner, zones } = ground;
  const outline = region.polygon ?? zones.find((zone) => zone.id === region.zone)?.polygon;
  if (!outline) throw new Error(`Paint Region ${region.id}'s Zone ${region.zone} isn't one of the Blueprint's`);
  const cells = new Uint8Array(width * height);
  const xs = outline.map((point) => point.x);
  const ys = outline.map((point) => point.y);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(height, Math.ceil(Math.max(...ys))); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(width, Math.ceil(Math.max(...xs))); x++) {
      const cell = y * width + x;
      if (!containsPoint(outline, { x: x + 0.5, y: y + 0.5 })) continue;
      if (ground.paints && !ground.paints(cell)) continue;
      if (region.levels && (owner[cell]! < 0 || !region.levels.includes(zones[owner[cell]!]!.elevation))) continue;
      cells[cell] = 1;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
  }
  if (x0 === Infinity) return undefined;
  const bounds = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  const mixBySet = new Map<number, SetMix>();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!cells[y * width + x]) continue;
      const set = ground.setOf(x, y);
      if (!mixBySet.has(set)) mixBySet.set(set, setMix(region, ground.setTextures(set), ground.setLabel(set)));
    }
  }
  return { id: region.id, cells, ...bounds, strength: regionStrength(cells, width, height, bounds, region.falloff ?? DEFAULT_FALLOFF), mixBySet };
}

/** A region's mix on a set's layers, refused when the set lacks one of its textures. */
function setMix(region: PaintRegion, textures: readonly string[], label: string): SetMix {
  const weights = new Float64Array(LAYERS).fill(Number.NaN);
  const shares: number[] = [];
  const named = new Uint8Array(LAYERS);
  let rest = -1;
  for (const entry of region.mix) {
    const layer = textures.indexOf(entry.texture);
    if (layer < 0 || layer >= LAYERS) {
      throw new Error(`Paint Region ${region.id} paints cells on ${label}, which doesn't hold ${entry.texture}: ${textures.filter(Boolean).join(", ")}`);
    }
    named[layer] = 1;
    if (entry.weight !== undefined) weights[layer] = entry.weight;
    else if (entry.share !== undefined) shares.push(layer);
    else rest = layer;
  }
  return { weights, shares, rest, named };
}

/**
 * Each texel's strength over the cells' bounds: 1 from `falloff` cells in from the edge of the
 * cells, fading to 0 at it, by `1 − feather(d, falloff)` of the distance d from the texel's middle to
 * the nearest cell the region doesn't paint. The map's own edge isn't an edge of the region.
 */
function regionStrength(cells: Uint8Array, width: number, height: number, bounds: { x: number; y: number; width: number; height: number }, falloff: number): Float32Array {
  const strengthWidth = bounds.width * TEXELS_PER_CELL;
  const strength = new Float32Array(strengthWidth * bounds.height * TEXELS_PER_CELL);
  const inside = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height || cells[y * width + x] === 1;
  // The cells just outside the region: only they can be nearest to a texel inside it.
  const bucket = Math.max(1, Math.ceil(falloff));
  const buckets = new Map<string, [number, number][]>();
  if (falloff > 0) {
    for (let y = Math.max(0, bounds.y - 1); y <= Math.min(height - 1, bounds.y + bounds.height); y++) {
      for (let x = Math.max(0, bounds.x - 1); x <= Math.min(width - 1, bounds.x + bounds.width); x++) {
        if (inside(x, y)) continue;
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1 && !edge; dx++) edge = x + dx >= 0 && y + dy >= 0 && x + dx < width && y + dy < height && cells[(y + dy) * width + x + dx] === 1;
        if (!edge) continue;
        const key = `${Math.floor(x / bucket)},${Math.floor(y / bucket)}`;
        (buckets.get(key) ?? buckets.set(key, []).get(key)!).push([x, y]);
      }
    }
  }
  for (let cy = bounds.y; cy < bounds.y + bounds.height; cy++) {
    for (let cx = bounds.x; cx < bounds.x + bounds.width; cx++) {
      if (!cells[cy * width + cx]) continue;
      const near = falloff > 0 ? [-1, 0, 1].flatMap((by) => [-1, 0, 1].flatMap((bx) => buckets.get(`${Math.floor(cx / bucket) + bx},${Math.floor(cy / bucket) + by}`) ?? [])) : [];
      for (let ty = 0; ty < TEXELS_PER_CELL; ty++) {
        for (let tx = 0; tx < TEXELS_PER_CELL; tx++) {
          const px = cx + (tx + 0.5) / TEXELS_PER_CELL;
          const py = cy + (ty + 0.5) / TEXELS_PER_CELL;
          let d = Infinity;
          for (const [ix, iy] of near) d = Math.min(d, distanceToCell(px, py, ix, iy));
          strength[((cy - bounds.y) * TEXELS_PER_CELL + ty) * strengthWidth + (cx - bounds.x) * TEXELS_PER_CELL + tx] = 1 - feather(d, falloff);
        }
      }
    }
  }
  return strength;
}

/** A region's strength at a map texel, 0 outside its cells. */
export function regionStrengthAt(region: RasterisedRegion, tx: number, ty: number): number {
  const lx = tx - region.x * TEXELS_PER_CELL;
  const ly = ty - region.y * TEXELS_PER_CELL;
  const strengthWidth = region.width * TEXELS_PER_CELL;
  if (lx < 0 || ly < 0 || lx >= strengthWidth || ly >= region.height * TEXELS_PER_CELL) return 0;
  return region.strength[ly * strengthWidth + lx]!;
}

/** Scratch for mixInto: the texel's mix at full strength. */
const TARGET = new Float64Array(LAYERS);

/**
 * Lays the regions, in order, over a texel's shares (8 layers of its cell's set, summing to 1), in
 * place, each moved towards its mix by its strength there. `set` is the texel's cell's set. Whether any region painted it.
 */
export function applyPaintRegions(regions: readonly RasterisedRegion[], shares: Float64Array, tx: number, ty: number, set: number): boolean {
  let painted = false;
  for (const region of regions) {
    const strength = regionStrengthAt(region, tx, ty);
    if (strength <= 0) continue;
    mixInto(shares, region.mixBySet.get(set)!, strength);
    painted = true;
  }
  return painted;
}

/** The shares moved `strength` of the way to the mix over them (see the file's head). */
function mixInto(shares: Float64Array, mix: SetMix, strength: number): void {
  const target = TARGET;
  let fixed = 0;
  for (let layer = 0; layer < LAYERS; layer++) {
    const weight = mix.weights[layer]!;
    target[layer] = Number.isNaN(weight) ? 0 : weight;
    fixed += target[layer]!;
  }
  // An area share keeps its palette strength, within what the weights leave.
  let kept = 0;
  for (const layer of mix.shares) kept += shares[layer]!;
  const keep = kept > 1 - fixed ? Math.max(0, 1 - fixed) / kept : 1;
  for (const layer of mix.shares) target[layer] = shares[layer]! * keep;
  const left = Math.max(0, 1 - fixed - kept * keep);
  if (mix.rest >= 0) target[mix.rest] = left;
  else {
    // The ground's other textures fill what's left, each in proportion; with none (the ground is the
    // mix's own textures), the mix's textures do, as the ground has them.
    let others = 0;
    for (let layer = 0; layer < LAYERS; layer++) if (!mix.named[layer]) others += shares[layer]!;
    if (others > 1e-9) {
      for (let layer = 0; layer < LAYERS; layer++) if (!mix.named[layer]) target[layer] = (shares[layer]! * left) / others;
    } else {
      for (let layer = 0; layer < LAYERS; layer++) target[layer]! += shares[layer]! * left;
    }
  }
  for (let layer = 0; layer < LAYERS; layer++) shares[layer] = shares[layer]! + strength * (target[layer]! - shares[layer]!);
}

/** An 8×8 ordered-dither threshold (Bayer), 0..1, at a texel: each cell's 64 texels take each of 64 steps once. */
export function ditherThreshold(tx: number, ty: number): number {
  let value = 0;
  for (let bit = 0; bit < 3; bit++) {
    const xb = (tx >> bit) & 1;
    const yb = (ty >> bit) & 1;
    value = (value << 2) | (((xb ^ yb) << 1) | yb);
  }
  return (value + 0.5) / 64;
}

/** quantizeDithered's scratch. */
const FLOORS = new Int32Array(LAYERS);

/**
 * Weights summing to 15 from shares summing to 1, the remainders handed out by systematic sampling at
 * `threshold` (ditherThreshold): a layer short of a whole weight by r gains one at r of the thresholds,
 * so over a cell its mean is its share's exactly, to a 64th of a weight.
 */
export function quantizeDithered(shares: ArrayLike<number>, out: Uint8Array, offset: number, threshold: number): void {
  let left = FULL;
  for (let layer = 0; layer < LAYERS; layer++) {
    FLOORS[layer] = Math.floor(shares[layer]! * FULL + 1e-9);
    left -= FLOORS[layer]!;
  }
  // The remainders laid end to end: a layer gains one for each of threshold, threshold + 1, … in its stretch.
  let start = 0;
  let next = threshold;
  for (let layer = 0; layer < LAYERS && left > 0; layer++) {
    const end = start + Math.max(0, shares[layer]! * FULL - FLOORS[layer]!);
    if (next < end) {
      FLOORS[layer]!++;
      next++;
      left--;
    }
    start = end;
  }
  // Rounding can leave the last whole weight unplaced: it goes to the largest layer.
  if (left > 0) FLOORS[FLOORS.indexOf(Math.max(...FLOORS))]! += left;
  for (let layer = 0; layer < LAYERS; layer++) out[offset + layer] = FLOORS[layer]!;
}
