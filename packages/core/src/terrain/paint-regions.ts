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
//   are scaled to fill it. A region naming a texture the set of a cell it paints lacks is refused.
// - **Area shares** (#135) are the variety painter's patches (variety-patches.ts): a wash over
//   PATCH_FEATHER of noise above a threshold, to a core holding all the weights leave, broken by
//   the mottle. A stark texture gets noise up to STARK_SCALE times finer and a shorter fade; its
//   core stays whole, since the author asked for that amount of it. Patches fade out over
//   SET_EDGE_FADE cells beside a block of another texture set. Two shares' washes share the ground
//   where they overlap. The blend weights hold under and around the patches, which take their
//   ground from what the weights leave.
// - **Calibration.** A share is measured as the texture's mean weight over the region's texels past
//   its falloff (paint-region-usage.ts reports it so): with no weights, the fraction of the ground
//   its patches cover, soft edges counting part. Each region's thresholds are found by bisection
//   so that measure meets the shares, on the texels past the falloff (every texel of a region with
//   none). So the weights, the shares and the rest add up to the region's paint, as the mix's
//   "at most 1" rule reads them. A share the ground can't hold (most of its core beside another
//   set) gets the most it can.
// - **Weights.** A painted texel's shares are rounded to 15 by quantizeDithered, so a weight of 0.15
//   (2.25 of 15) comes out as 2 in some texels and 3 in others, and the cell holds 15% on average.

import { textureStarkness } from "../catalog/tileset-textures.js";
import type { MissionBlueprint, PaintRegion } from "../domain/mission-blueprint.js";
import { containsPoint } from "./polygon.js";
import { CELLS_PER_BLOCK, distanceToCell, feather, FULL_WEIGHT as FULL, LAYERS, TEXELS_PER_CELL } from "./texture-grid.js";
import { hashString } from "./value-noise.js";
import { blockLineGap, MOTTLE_DEPTH, MOTTLE_PERIOD, MOTTLE_SEED, patchNoise, SET_EDGE_FADE, setEdgeFadeAt, starkFeather, starkPeriod, valueNoise } from "./variety-patches.js";

/** A region's default falloff, in cells. */
export const DEFAULT_FALLOFF = 2;
/** An area share's patch period (cells) when the Style Pack gives no `varietyPatches`: the Antioch pack's. */
export const DEFAULT_PATCH_PERIOD = 12;
/** The most texels a region's calibration samples, evenly spread over those past its falloff. */
const CALIBRATION_SAMPLES = 1 << 16;
/**
 * An area share's patch noise index (patchNoise's seed): past the palette's variety (0-3), from its
 * region's id, so two regions' patches don't line up, and its place among the mix's shares.
 */
const shareNoiseIndex = (regionId: string, place: number): number => 8 + 8 * (hashString(regionId) % 4096) + place;

/** A region's mix on one texture set's 8 layers. */
export type SetMix = {
  /** The blend weight on each layer, NaN for a layer the mix gives none. */
  readonly weights: Float64Array;
  /** The layer of each area share, in the mix's order: `shares[k]` is painted by the region's `patches[k]`. */
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
  /** Each area share's patches, in the mix's order. */
  readonly patches: readonly SharePatches[];
  /** Over the bounds' texels, as `strength`: what a patch keeps beside a block of another set; undefined when no cell is near one. */
  readonly setFade: Float32Array | undefined;
};

/** One area share's patches over a region: the noise at each texel (as `strength`), the threshold calibrated to the share, and the wash's fade. */
export type SharePatches = {
  readonly noise: Float32Array;
  readonly threshold: number;
  readonly feather: number;
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
  /** An area share's patch period (cells): the Style Pack's `varietyPatches` period, DEFAULT_PATCH_PERIOD when left out. */
  readonly patchPeriod?: number | undefined;
};

/**
 * The Blueprint's Paint Regions rasterised, in order, leaving out a region that paints no cell. A
 * region naming a texture one of its cells' sets lacks is refused, naming the set and its textures.
 * `patches: false` leaves the area shares' patches out (no noise, no calibration), for a caller
 * that only checks or measures the regions.
 */
export function rasterisePaintRegions(regions: readonly PaintRegion[] | undefined, ground: PaintRegionGround, { patches = true }: { readonly patches?: boolean } = {}): RasterisedRegion[] {
  return (regions ?? []).flatMap((region) => {
    const rasterised = rasteriseRegion(region, ground, patches);
    return rasterised ? [rasterised] : [];
  });
}

function rasteriseRegion(region: PaintRegion, ground: PaintRegionGround, withPatches: boolean): RasterisedRegion | undefined {
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
  const strength = regionStrength(cells, width, height, bounds, region.falloff ?? DEFAULT_FALLOFF);
  const shared = withPatches && region.mix.some((entry) => entry.share !== undefined);
  const setFade = shared ? shareSetFade(cells, bounds, ground) : undefined;
  const patches = shared ? sharePatches(region, { cells, width, bounds }, strength, setFade, ground.patchPeriod ?? DEFAULT_PATCH_PERIOD) : [];
  return { id: region.id, cells, ...bounds, strength, mixBySet, patches, setFade };
}

type Bounds = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
/** A region's cells on the map (`width` cells wide), and their bounds. */
type Footprint = { readonly cells: Uint8Array; readonly width: number; readonly bounds: Bounds };

/** Calls `visit` for each texel of the region's cells: its index over the bounds, and its middle in map cells. */
function eachTexel({ cells, width, bounds }: Footprint, visit: (local: number, px: number, py: number) => void): void {
  const strengthWidth = bounds.width * TEXELS_PER_CELL;
  for (let cy = bounds.y; cy < bounds.y + bounds.height; cy++) {
    for (let cx = bounds.x; cx < bounds.x + bounds.width; cx++) {
      if (!cells[cy * width + cx]) continue;
      for (let ty = 0; ty < TEXELS_PER_CELL; ty++) {
        const row = ((cy - bounds.y) * TEXELS_PER_CELL + ty) * strengthWidth + (cx - bounds.x) * TEXELS_PER_CELL;
        for (let tx = 0; tx < TEXELS_PER_CELL; tx++) visit(row + tx, cx + (tx + 0.5) / TEXELS_PER_CELL, cy + (ty + 0.5) / TEXELS_PER_CELL);
      }
    }
  }
}

/**
 * What a patch keeps at each texel beside a block of another set, as the variety painter's
 * setEdgeFade does per cell: by the distance from the texel's middle to the nearest line of a
 * neighbouring block (sides and corners) on another set. Undefined when no cell's block has one.
 */
function shareSetFade(cells: Uint8Array, bounds: Bounds, ground: PaintRegionGround): Float32Array | undefined {
  const { width, height } = ground;
  // Each block's neighbours on another set, as [dx, dy].
  const others = new Map<number, [number, number][]>();
  const blocksPerRow = Math.ceil(width / CELLS_PER_BLOCK);
  const otherNeighbours = (bx: number, by: number): [number, number][] => {
    const key = by * blocksPerRow + bx;
    let found = others.get(key);
    if (found) return found;
    found = [];
    const set = ground.setOf(bx * CELLS_PER_BLOCK, by * CELLS_PER_BLOCK);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = (bx + dx) * CELLS_PER_BLOCK;
        const ny = (by + dy) * CELLS_PER_BLOCK;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (ground.setOf(nx, ny) !== set) found.push([dx, dy]);
      }
    }
    others.set(key, found);
    return found;
  };
  const fade = new Float32Array(bounds.width * TEXELS_PER_CELL * bounds.height * TEXELS_PER_CELL).fill(1);
  let any = false;
  eachTexel({ cells, width, bounds }, (local, px, py) => {
    const bx = Math.floor(px / CELLS_PER_BLOCK);
    const by = Math.floor(py / CELLS_PER_BLOCK);
    const near = otherNeighbours(bx, by);
    if (near.length === 0) return;
    let nearest = SET_EDGE_FADE;
    for (const [dx, dy] of near) nearest = Math.min(nearest, blockLineGap(px, py, bx, by, dx, dy, CELLS_PER_BLOCK));
    fade[local] = setEdgeFadeAt(nearest);
    any ||= fade[local]! < 1;
  });
  return any ? fade : undefined;
}

/** The region's area shares' patches: each texel's noise, and the thresholds calibrated so each share's measure meets it (see the file's head). */
function sharePatches(region: PaintRegion, footprint: Footprint, strength: Float32Array, setFade: Float32Array | undefined, period: number): SharePatches[] {
  const entries = region.mix.filter((entry) => entry.share !== undefined);
  const mottle = new Float32Array(strength.length);
  const texels: number[] = [];
  eachTexel(footprint, (local, px, py) => {
    mottle[local] = MOTTLE_DEPTH * valueNoise(px / MOTTLE_PERIOD, py / MOTTLE_PERIOD, MOTTLE_SEED);
    texels.push(local);
  });
  const shapes = entries.map((entry, k) => {
    const stark = textureStarkness(entry.texture);
    const own = starkPeriod(period, stark);
    const index = shareNoiseIndex(region.id, k);
    const noise = new Float32Array(strength.length);
    eachTexel(footprint, (local, px, py) => {
      noise[local] = patchNoise(px, py, index, own) + mottle[local]!;
    });
    return { noise, feather: starkFeather(stark) };
  });
  const core = texels.filter((local) => strength[local]! >= 1 - 1e-6);
  const pool = core.length > 0 ? core : texels;
  // Past the cap, a hashed pick rather than every n-th, which would keep to some of a cell's texel columns.
  const keep = Math.min(1, CALIBRATION_SAMPLES / pool.length);
  const samples = keep === 1 ? pool : pool.filter((local) => (Math.imul(local, 2654435761) >>> 0) / 4294967296 < keep);
  const thresholds = calibrate(
    entries.map((entry) => entry.share!),
    availableTo(region),
    shapes.map(({ noise, feather }) => ({ noise: Float64Array.from(samples, (local) => noise[local]!), feather })),
    Float64Array.from(samples, (local) => setFade?.[local] ?? 1),
  );
  return shapes.map((shape, k) => ({ ...shape, threshold: thresholds[k]! }));
}

/** What a region's blend weights leave, for its shares and the rest. */
const availableTo = (region: PaintRegion): number => Math.max(0, 1 - region.mix.reduce((sum, entry) => sum + (entry.weight ?? 0), 0));

/** A patch's wash at a texel: 0 at the threshold, rising by smoothstep over its fade to its core, times its fade beside another set. */
function wash(noise: number, threshold: number, fade: number, setFade: number): number {
  if (noise <= threshold) return 0;
  const rise = Math.min(1, (noise - threshold) / fade);
  return setFade * rise * rise * (3 - 2 * rise);
}

/**
 * The thresholds putting each share's mean (over the samples) at its target, where a texel holds
 * `available` × its wash, the washes scaled down to share the ground where they sum past 1, as
 * mixInto paints them. Each threshold by bisection, the others held, a few rounds for washes that overlap.
 */
function calibrate(targets: readonly number[], available: number, shapes: readonly { readonly noise: Float64Array; readonly feather: number }[], setFade: Float64Array): number[] {
  const count = setFade.length;
  const thresholds = shapes.map(() => Number.POSITIVE_INFINITY);
  if (count === 0 || available <= 0) return thresholds;
  const washes = shapes.map(() => new Float64Array(count));
  /** Share k's wash at each sample, at its threshold now. */
  const washAt = (k: number) => {
    const { noise, feather } = shapes[k]!;
    for (let i = 0; i < count; i++) washes[k]![i] = wash(noise[i]!, thresholds[k]!, feather, setFade[i]!);
  };
  /** Share k's mean over the samples, as mixInto paints it. */
  const meanOf = (k: number): number => {
    let sum = 0;
    for (let i = 0; i < count; i++) {
      let total = 0;
      for (const w of washes) total += w[i]!;
      sum += total > 1 ? washes[k]![i]! / total : washes[k]![i]!;
    }
    return (available * sum) / count;
  };
  const rounds = shapes.length === 1 ? 1 : 6;
  for (let round = 0; round < rounds; round++) {
    shapes.forEach(({ noise, feather }, k) => {
      let [lo, hi] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
      for (const n of noise) [lo, hi] = [Math.min(lo, n), Math.max(hi, n)];
      // At lo every sample is at its core; at hi none has any.
      lo -= feather;
      for (let step = 0; step < 40; step++) {
        thresholds[k] = (lo + hi) / 2;
        washAt(k);
        if (meanOf(k) > targets[k]!) lo = thresholds[k]!;
        else hi = thresholds[k]!;
      }
      thresholds[k] = (lo + hi) / 2;
      washAt(k);
    });
  }
  return thresholds;
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

/** A map texel's index over a region's bounds (into `strength`, `setFade` and a patch's `noise`), -1 outside them. */
function localTexel(region: RasterisedRegion, tx: number, ty: number): number {
  const lx = tx - region.x * TEXELS_PER_CELL;
  const ly = ty - region.y * TEXELS_PER_CELL;
  const strengthWidth = region.width * TEXELS_PER_CELL;
  if (lx < 0 || ly < 0 || lx >= strengthWidth || ly >= region.height * TEXELS_PER_CELL) return -1;
  return ly * strengthWidth + lx;
}

/** A region's strength at a map texel, 0 outside its cells. */
export function regionStrengthAt(region: RasterisedRegion, tx: number, ty: number): number {
  const local = localTexel(region, tx, ty);
  return local < 0 ? 0 : region.strength[local]!;
}

/** Scratch for mixInto: the texel's mix at full strength, and each share's wash. */
const TARGET = new Float64Array(LAYERS);
const WASHES = new Float64Array(LAYERS);

/**
 * Lays the regions, in order, over a texel's shares (8 layers of its cell's set, summing to 1), in
 * place, each moved towards its mix by its strength there. `set` is the texel's cell's set. Whether any region painted it.
 */
export function applyPaintRegions(regions: readonly RasterisedRegion[], shares: Float64Array, tx: number, ty: number, set: number): boolean {
  let painted = false;
  for (const region of regions) {
    const local = localTexel(region, tx, ty);
    if (local < 0) continue;
    const strength = region.strength[local]!;
    if (strength <= 0) continue;
    mixInto(shares, region.mixBySet.get(set)!, strength, region, local);
    painted = true;
  }
  return painted;
}

/** The shares moved `strength` of the way to the mix over them, at the region's texel `local` (see the file's head). */
function mixInto(shares: Float64Array, mix: SetMix, strength: number, region: RasterisedRegion, local: number): void {
  const target = TARGET;
  let fixed = 0;
  for (let layer = 0; layer < LAYERS; layer++) {
    const weight = mix.weights[layer]!;
    target[layer] = Number.isNaN(weight) ? 0 : weight;
    fixed += target[layer]!;
  }
  // Each area share's wash, of what the weights leave; overlapping washes share it (calibrate's arithmetic).
  const avail = Math.max(0, 1 - fixed);
  const setFade = region.setFade ? region.setFade[local]! : 1;
  let washed = 0;
  for (let k = 0; k < mix.shares.length; k++) {
    const patches = region.patches[k]!;
    WASHES[k] = wash(patches.noise[local]!, patches.threshold, patches.feather, setFade);
    washed += WASHES[k]!;
  }
  const scale = washed > 1 ? avail / washed : avail;
  let kept = 0;
  for (let k = 0; k < mix.shares.length; k++) {
    target[mix.shares[k]!] = WASHES[k]! * scale;
    kept += WASHES[k]! * scale;
  }
  const left = Math.max(0, avail - kept);
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
