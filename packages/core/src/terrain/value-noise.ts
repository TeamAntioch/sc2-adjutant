// Coherent value noise for the terrain's generated choices: random values on a lattice, eased
// between, so neighbouring points get neighbouring values. Seeded, so the same blueprint compiles
// the same terrain.

/** A string's FNV-1a hash. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

/** A lattice point's value in [-1, 1]. */
function lattice(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x7fffffff - 1;
}

/** Smooth value noise in [-1, 1], one lattice point per unit. */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const ease = (t: number) => t * t * (3 - 2 * t);
  const u = ease(x - x0);
  const v = ease(y - y0);
  const south = lattice(x0, y0, seed) * (1 - u) + lattice(x0 + 1, y0, seed) * u;
  const north = lattice(x0, y0 + 1, seed) * (1 - u) + lattice(x0 + 1, y0 + 1, seed) * u;
  return south * (1 - v) + north * v;
}
