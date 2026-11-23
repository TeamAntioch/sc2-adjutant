// Banks along a water pool's edge (DL-13, the author's review: "waterlines are rarely fully
// static, so a bit of height variation at the edge is important", and "water areas should never
// be exact polygons"). Within a pool's zone, the floor near the edge rises toward a bank top that
// wanders along the shore between `dip` below the surface and `rise` above it, so stretches of
// shallows, little banks breaking the surface and water against the cliff alternate. The bank is
// full height up to the cliff's foot (the cliff mesh covers the 2 cells inside a pit's edge) and
// falls away over 0.4-1.8 × `width` cells, wandering along the shore.

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { distanceToPolygon } from "./polygon.js";
import { raggedAmplitude } from "./ragged-outlines.js";
import { pathingBit } from "./write-cell-attribute.js";

type Point = { readonly x: number; readonly y: number };

/** Along-shore wavelength of the bank's top, in cells. */
const WAVELENGTH = 5;
/** The cliff mesh's cells inside a pit's edge, plus a cell of bank top before it slopes away. */
const CLIFF_FOOT = 3;
/** Value noise bunches round 0.5; stretched so the bank's top reaches both `dip` and `rise`. */
const CONTRAST = 2.4;

function hash(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Smooth value noise in [0, 1]. */
function noise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const sx = x - x0;
  const sy = y - y0;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const [u, v] = [ease(sx), ease(sy)];
  const a = hash(x0, y0, seed) * (1 - u) + hash(x0 + 1, y0, seed) * u;
  const b = hash(x0, y0 + 1, seed) * (1 - u) + hash(x0 + 1, y0 + 1, seed) * u;
  return a * (1 - v) + b * v;
}

function inside(polygon: readonly Point[], x: number, y: number): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

/**
 * Raises `heights` (vertex heights, row-major, width + 1 per row) into each pool's banks, in place.
 * Given the vertex cliff levels, a pool in a pit measures its banks from the foot of the cliff as
 * it was drawn (a ragged natural cliff wanders off the polygon), not from the polygon's side.
 */
export function raiseShoreBanks(blueprint: MissionBlueprint, heights: Float32Array, levels?: Uint8Array): void {
  const { width, height } = blueprint.mapSize;
  // Hand-built test blueprints may skip the schema's default.
  (blueprint.water ?? []).forEach((pool, poolIndex) => {
    if (pool.bank === false || pool.dig) return;
    const { width: bankWidth, rise, dip } = pool.bank;
    const zone = blueprint.zones.find((candidate) => candidate.id === pool.zoneId);
    if (!zone) return;
    const xs = zone.polygon.map((point) => point.x);
    const ys = zone.polygon.map((point) => point.y);
    const bankReach = CLIFF_FOOT + bankWidth * 1.8;
    const levelAt = (x: number, y: number): number | undefined => (x < 0 || y < 0 || x > width || y > height ? undefined : levels?.[y * (width + 1) + x]);
    // Cells from (x, y) to the nearest vertex above the pool's level, past the cliff's own first
    // cell (a polygon side's vertex is a cell from the cliff), or undefined beyond the bank's reach.
    const search = Math.ceil(bankReach) + 1;
    const toCliff = (x: number, y: number): number | undefined => {
      let best: number | undefined;
      for (let dy = -search; dy <= search; dy++) {
        for (let dx = -search; dx <= search; dx++) {
          const d = Math.hypot(dx, dy);
          if ((best === undefined || d < best) && (levelAt(x + dx, y + dy) ?? -1) > zone.elevation) best = d;
        }
      }
      return best === undefined ? undefined : best - 1;
    };
    // A ragged cliff can stand back past the polygon's bounds.
    const pad = levels ? Math.ceil(raggedAmplitude(blueprint)) : 0;
    const [x0, x1] = [Math.max(0, Math.floor(Math.min(...xs)) - pad), Math.min(width, Math.ceil(Math.max(...xs)) + pad)];
    const [y0, y1] = [Math.max(0, Math.floor(Math.min(...ys)) - pad), Math.min(height, Math.ceil(Math.max(...ys)) + pad)];
    // A pool in a pit banks against its cliff; one level with the ground round it, against its polygon.
    let pit = false;
    for (let vy = y0; vy <= y1 && !pit && levels; vy++) for (let vx = x0; vx <= x1 && !pit; vx++) pit = levelAt(vx, vy)! > zone.elevation;
    for (let vy = y0; vy <= y1; vy++) {
      for (let vx = x0; vx <= x1; vx++) {
        const edge = distanceToPolygon(zone.polygon, { x: vx, y: vy });
        const within = inside(zone.polygon, vx, vy) || edge === 0;
        const level = levelAt(vx, vy);
        if (level !== undefined && level > zone.elevation) continue;
        if (!pit && !within) continue;
        // In a pit, the pool's floor runs to its cliff, on or off the polygon.
        const d = pit ? (toCliff(vx, vy) ?? Infinity) : edge;
        if (d > bankReach) continue;
        const idx = vy * (width + 1) + vx;
        const floor = heights[idx];
        if (floor === undefined) continue;
        const n = Math.max(0, Math.min(1, (noise(vx / WAVELENGTH, vy / WAVELENGTH, poolIndex + 1) - 0.5) * CONTRAST + 0.5));
        const top = pool.height - dip + (rise + dip) * n;
        // The bank's width wanders too, so the waterline weaves in and out instead of tracing the zone's edge.
        const reach = bankWidth * (0.4 + 1.4 * noise(vx / (WAVELENGTH * 1.3), vy / (WAVELENGTH * 1.3), poolIndex + 101));
        const t = Math.min(1, Math.max(0, d - CLIFF_FOOT) / reach);
        const falloff = 1 - t * t * (3 - 2 * t);
        heights[idx] = floor + Math.max(0, top - floor) * falloff;
      }
    }
  });
}

/** How far a dug pool's rim wanders in and out of its zone's edge, in cells. */
const RIM_WANDER = 1.5;

/**
 * Sinks each dug pool's zone into a bowl, in place (DL-13: water on a play level, as on 1-8 and as
 * the author dug a test pit in the Editor). The rim wanders `RIM_WANDER` cells either side of the
 * zone's edge; the slope down to the full depth takes 0.6-1.4 × max(3, 1.5 × depth) cells, and the
 * floor varies by ±15%, so neither the waterline nor the bottom traces the polygon.
 */
export function digPools(blueprint: MissionBlueprint, heights: Float32Array): void {
  const { width } = blueprint.mapSize;
  (blueprint.water ?? []).forEach((pool, poolIndex) => {
    if (!pool.dig) return;
    const { depth } = pool.dig;
    const zone = blueprint.zones.find((candidate) => candidate.id === pool.zoneId);
    if (!zone) return;
    const xs = zone.polygon.map((point) => point.x);
    const ys = zone.polygon.map((point) => point.y);
    const pad = Math.ceil(RIM_WANDER) + 1;
    const seed = poolIndex + 201;
    for (let vy = Math.max(0, Math.floor(Math.min(...ys)) - pad); vy <= Math.ceil(Math.max(...ys)) + pad; vy++) {
      for (let vx = Math.max(0, Math.floor(Math.min(...xs)) - pad); vx <= Math.ceil(Math.max(...xs)) + pad; vx++) {
        const idx = vy * (width + 1) + vx;
        if (vx > width || heights[idx] === undefined) continue;
        const edge = distanceToPolygon(zone.polygon, { x: vx, y: vy });
        const d = (inside(zone.polygon, vx, vy) ? edge : -edge) + (noise(vx / WAVELENGTH, vy / WAVELENGTH, seed) - 0.5) * 2 * RIM_WANDER;
        if (d <= 0) continue;
        const slope = Math.max(3, depth * 1.5) * (0.6 + 0.8 * noise(vx / (WAVELENGTH * 1.3), vy / (WAVELENGTH * 1.3), seed + 100));
        const t = Math.min(1, d / slope);
        const floor = 0.85 + 0.3 * noise(vx / 3, vy / 3, seed + 200);
        heights[idx] = heights[idx]! - depth * t * t * (3 - 2 * t) * floor;
      }
    }
  });
}

/**
 * The Editor's "no pathing" paint (CellAttribute_Pnp), one byte per cell. Each cell is 2 sub-cells
 * wide and 4 high (0.5 × 0.25 cells); sub-cell (column, row), row 0 at the bottom, is bit
 * `(row < 2 ? 4 : 0) + 2 × column + row % 2`, so the high nibble is the cell's bottom half and 255
 * a whole cell. A sub-cell is painted when the ground at its centre is under a dug pool's surface.
 * The layout is read from 1-8's painted ponds and the author's Editor test pit (2026-10-28).
 */
export function dugPoolPathing(blueprint: MissionBlueprint, heights: Float32Array): Uint8Array {
  const { width, height } = blueprint.mapSize;
  const cells = new Uint8Array(width * height);
  const groundAt = (x: number, y: number): number => {
    const [vx, vy] = [Math.floor(x), Math.floor(y)];
    const [fx, fy] = [x - vx, y - vy];
    const at = (dx: number, dy: number) => heights[(vy + dy) * (width + 1) + vx + dx]!;
    return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
  };
  for (const pool of blueprint.water ?? []) {
    if (!pool.dig) continue;
    const zone = blueprint.zones.find((candidate) => candidate.id === pool.zoneId);
    if (!zone) continue;
    const pad = Math.ceil(RIM_WANDER) + 1;
    const x0 = Math.max(0, Math.floor(Math.min(...zone.polygon.map((point) => point.x))) - pad);
    const x1 = Math.min(width - 1, Math.ceil(Math.max(...zone.polygon.map((point) => point.x))) + pad);
    const y0 = Math.max(0, Math.floor(Math.min(...zone.polygon.map((point) => point.y))) - pad);
    const y1 = Math.min(height - 1, Math.ceil(Math.max(...zone.polygon.map((point) => point.y))) + pad);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let bits = cells[y * width + x]!;
        for (let row = 0; row < 4; row++) {
          for (let column = 0; column < 2; column++) {
            if (groundAt(x + (column + 0.5) / 2, y + (row + 0.5) / 4) < pool.height) bits |= pathingBit(column, row);
          }
        }
        cells[y * width + x] = bits;
      }
    }
  }
  return cells;
}
