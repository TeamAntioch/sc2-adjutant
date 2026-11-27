// The variety painter's patches (#117), shared by the Zone palettes' variety (paint-textures.ts)
// and a Paint Region's area shares (paint-regions.ts): the noise that shapes them and the rules
// of their wash.
//
// A variety patch is a wash, not a swap. Its texture fades in over PATCH_FEATHER of noise above
// the threshold to a core at full strength, and a finer noise (MOTTLE_PERIOD cells) moves the
// threshold by up to MOTTLE_DEPTH, so the edge is soft and broken while the core still reads in
// dim light. Measured on the Antioch pack's natural-ground Exemplar Maps, half to nine tenths of
// open cells hold two or more textures.
//
// A stark texture (pebbles, lumpy moss, pitted creep, roots: textureStarkness, from its picture's
// contrast and the catalog's accent note) reads at full strength long before its weight gets
// there, so it gets less ground and smaller spots. At full starkness its noise is STARK_SCALE times
// finer, its threshold STARK_RARITY higher, its fade STARK_FEATHER and its core only STARK_STRENGTH
// of a texel, so the zone's own texture shows through it; a texture part-way stark is part-way
// there.
//
// Beside a block of another texture set every patch fades out over SET_EDGE_FADE cells: a set's
// edge is a cut along the block line, and a wash cut there shows as a step in its own texture.

export const PATCH_FEATHER = 0.25;
export const MOTTLE_PERIOD = 3;
export const MOTTLE_DEPTH = 0.12;
export const STARK_SCALE = 2;
export const STARK_RARITY = 0.18;
export const STARK_FEATHER = 0.12;
export const STARK_STRENGTH = 0.5;
export const SET_EDGE_FADE = 2;
/** The mottle's noise seed. */
export const MOTTLE_SEED = 977;

/** A patch's fade beside a block of another texture set, `d` cells from its line: 0 within half a cell, 1 from SET_EDGE_FADE on. */
export const setEdgeFadeAt = (d: number): number => Math.max(0, Math.min(1, (d - 0.5) / (SET_EDGE_FADE - 0.5)));

/**
 * How far (cells) a point (px, py) in block (bx, by) is from the line of its neighbouring block
 * (dx, dy), each in -1..1: the larger of its gaps across and along, so a corner block counts from its corner.
 */
export function blockLineGap(px: number, py: number, bx: number, by: number, dx: number, dy: number, cellsPerBlock: number): number {
  const gapX = dx === 0 ? 0 : dx < 0 ? px - bx * cellsPerBlock : (bx + 1) * cellsPerBlock - px;
  const gapY = dy === 0 ? 0 : dy < 0 ? py - by * cellsPerBlock : (by + 1) * cellsPerBlock - py;
  return Math.max(gapX, gapY);
}

/** A texture's patch period (cells) by its starkness: STARK_SCALE times finer at full starkness. */
export const starkPeriod = (period: number, stark: number): number => period / (1 + (STARK_SCALE - 1) * stark);
/** A texture's wash fade (of noise) by its starkness: PATCH_FEATHER, down to STARK_FEATHER at full starkness. */
export const starkFeather = (stark: number): number => PATCH_FEATHER + (STARK_FEATHER - PATCH_FEATHER) * stark;

/**
 * Noise shaping variety patches: three scales, each on a lattice turned to its own angle, so the
 * patches' edges don't follow the square grid value noise is built on.
 */
export function patchNoise(x: number, y: number, index: number, period: number): number {
  return PATCH_OCTAVES.reduce((sum, { weight, scale, angle }, octave) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const u = ((x * cos - y * sin) * scale) / period;
    const v = ((x * sin + y * cos) * scale) / period;
    return sum + weight * valueNoise(u, v, 300 + 10 * index + octave);
  }, 0);
}
const PATCH_OCTAVES = [
  { weight: 0.45, scale: 1, angle: 0.5 },
  { weight: 0.35, scale: 2.6, angle: 1.3 },
  { weight: 0.2, scale: 6, angle: 2.2 },
];

/** Smooth value noise in [-1, 1]: bilinear between hashed lattice values, smoothstep-eased. */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const salt = Math.imul(seed, 2147483647);
  const v00 = latticeValue(x0, y0, salt);
  const v01 = latticeValue(x0, y0 + 1, salt);
  const top = v00 + (latticeValue(x0 + 1, y0, salt) - v00) * sx;
  const bottom = v01 + (latticeValue(x0 + 1, y0 + 1, salt) - v01) * sx;
  return top + (bottom - top) * sy;
}

/** A lattice point's hashed value in [-1, 1]; `salt` is the seed, hashed (Math.imul(seed, 2147483647)). */
export function latticeValue(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}
