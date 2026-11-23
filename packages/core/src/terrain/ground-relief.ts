// The gentle rise and fall generated natural ground gets, so it doesn't lie dead flat. Smooth
// rolls, not a random height per vertex: independent heights made every vertex a spike or a dent
// against its neighbours, which read as angular and too strong (the author's review, 2026-11-11).
// Coherent noise at the same strength steps about a ninth as much from one vertex to the next.

import { type Rot180, symmetricNoise } from "./symmetry.js";
import { valueNoise } from "./value-noise.js";

/** The most the ground rises or falls from its level. */
export const GROUND_RELIEF = 0.3;
/** Cells between the rolls' lattice points, and each scale's share of the relief: broad rolls with a little finer variation on them. */
const ROLLS = { period: 8, share: 0.75 };
const RIPPLES = { period: 4, share: 0.25 };
/** The ripples' lattice sits off the rolls', so the two don't crease along the same lines. */
const RIPPLE_SHIFT = { x: 2.5, y: 1.5 };

/** One seed for every map, so a generating Zone beside ground this generator made continues its rolls. */
const SEED = 0x3c6ef372;

/**
 * A vertex's offset from its level, within ±GROUND_RELIEF. On a melee map it keeps to the rotation
 * with no seam between the sides (symmetricNoise, which keeps the spread, so a rare vertex passes
 * GROUND_RELIEF there).
 */
export function groundRelief(symmetry?: Rot180): (x: number, y: number) => number {
  const relief = (x: number, y: number): number =>
    GROUND_RELIEF *
    (ROLLS.share * valueNoise(x / ROLLS.period, y / ROLLS.period, SEED) +
      RIPPLES.share * valueNoise((x + RIPPLE_SHIFT.x) / RIPPLES.period, (y + RIPPLE_SHIFT.y) / RIPPLES.period, SEED ^ 0x9e3779b9));
  return symmetricNoise(relief, symmetry, 1);
}
