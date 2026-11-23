// Ragged natural cliff outlines (#188; the author's review of a generated map, 2026-10-31: a long
// straight polygon side became a long straight cliff, which looks artificial). Natural zones'
// polygons are sampled through a smooth, deterministic warp: the point a natural zone tests for
// "inside" is the real point moved up to `raggedCliffs` cells by coherent noise seeded from the
// blueprint's `terrainSeed` (its id when unset), so each natural edge wobbles a few cells in and
// out along its length. Built zones test the real point, so their sides (and the cliffs under
// them) stay straight. The warp fades to nothing near what must stay put: the corners a ramp,
// bridge or terrain object sets, a connection's `at`, the outline of every built zone and every
// natural polygon's own corners.
//
// On a melee map (#214) the warp keeps to the rotation: its noise is odd about the centre, so an
// outline wobbles the same way on both sides with no seam between them, and each point off the
// source side takes its partner's warp turned round, so the two sides match exactly.

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { containsPoint, type Point } from "./rasterize.js";
import { onSourceSide, type Rot180, rotatePoint, symmetricNoise } from "./symmetry.js";
import { hashString, valueNoise } from "./value-noise.js";

/** How far, in cells, a natural outline wobbles when the blueprint doesn't say. */
export const DEFAULT_RAGGED_CLIFFS = 4;
/** Lattice spacing of the wobble's main octave, per cell of amplitude (a gentle wave, not salt). */
const WAVELENGTH_PER_CELL = 8;
const MIN_WAVELENGTH = 8;
/** Cells round a pinned point (a ramp's corner, a crossing) kept exactly where the polygon puts them. */
const PIN_RADIUS = 4;
/** Cells kept straight beyond a built zone's outline. */
const BUILT_MARGIN = 1;
/** Cells, per cell of amplitude, over which the wobble fades in away from what's pinned. */
const FADE_PER_CELL = 4;

/** Cells, per cell of amplitude, over which the wobble fades in away from a natural polygon's corner. */
const CORNER_FADE_PER_CELL = 2;
/** Value noise bunches round 0; stretched so the wobble reaches its amplitude along an edge. */
const CONTRAST = 1.6;

/** Moves a point to where natural zones sample their polygons. */
export type OutlineWarp = (point: Point) => Point;

/** The blueprint's wobble amplitude in cells; 0 turns ragged outlines off. */
export function raggedAmplitude(blueprint: MissionBlueprint): number {
  return blueprint.raggedCliffs ?? DEFAULT_RAGGED_CLIFFS;
}

const identity: OutlineWarp = (point) => point;

/** Two octaves, normalised back to [-1, 1]. */
function wobble(x: number, y: number, wavelength: number, seed: number): number {
  return (valueNoise(x / wavelength, y / wavelength, seed) + 0.5 * valueNoise((2 * x) / wavelength, (2 * y) / wavelength, seed ^ 0x9e3779b9)) / 1.5;
}

/** Distance from `point` to the segment a–b. */
function segmentDistance(a: Point, b: Point, point: Point): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

/**
 * The warp natural zones sample their polygons through, pinned still at `pins` (points that must
 * keep their level: a ramp's corners, a bridge's, a crossing's `at`), along built zones' outlines
 * and at natural polygons' corners. The identity when the amplitude is 0. With a symmetry, the
 * pins and zones must be symmetric too.
 */
export function outlineWarp(blueprint: MissionBlueprint, pins: readonly Point[], symmetry?: Rot180): OutlineWarp {
  const amplitude = raggedAmplitude(blueprint);
  if (amplitude <= 0) return identity;
  const { width, height } = blueprint.mapSize;
  const fade = FADE_PER_CELL * amplitude;
  const cornerFade = CORNER_FADE_PER_CELL * amplitude;
  const wavelength = Math.max(MIN_WAVELENGTH, WAVELENGTH_PER_CELL * amplitude);
  const seed = hashString(blueprint.terrainSeed ?? blueprint.id);

  // How far each vertex is into the wobble, past the nearest pinned thing's own margin; `fade` or
  // more is the full wobble.
  const columns = width + 1;
  const free = new Float32Array(columns * (height + 1)).fill(fade);
  const pinNear = (west: number, south: number, east: number, north: number, distance: (point: Point) => number) => {
    for (let vy = Math.max(0, Math.floor(south - fade)); vy <= Math.min(height, Math.ceil(north + fade)); vy++) {
      for (let vx = Math.max(0, Math.floor(west - fade)); vx <= Math.min(width, Math.ceil(east + fade)); vx++) {
        const index = vy * columns + vx;
        free[index] = Math.min(free[index]!, Math.max(0, distance({ x: vx, y: vy })));
      }
    }
  };
  for (const pin of pins) pinNear(pin.x, pin.y, pin.x, pin.y, (point) => Math.hypot(point.x - pin.x, point.y - pin.y) - PIN_RADIUS);
  for (const zone of blueprint.zones) {
    zone.polygon.forEach((a, i) => {
      if (zone.surface === "built") {
        const b = zone.polygon[(i + 1) % zone.polygon.length]!;
        pinNear(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), (point) => segmentDistance(a, b, point) - BUILT_MARGIN);
      } else {
        // A polygon's corner stays, but its sides wobble soon after it.
        pinNear(a.x, a.y, a.x, a.y, (point) => (Math.hypot(point.x - a.x, point.y - a.y) * fade) / cornerFade);
      }
    });
  }

  const freedom = (point: Point): number => {
    const x = Math.max(0, Math.min(width, point.x));
    const y = Math.max(0, Math.min(height, point.y));
    const x0 = Math.min(width - 1, Math.floor(x));
    const y0 = Math.min(height - 1, Math.floor(y));
    const [fx, fy] = [x - x0, y - y0];
    const at = (vx: number, vy: number) => free[vy * columns + vx]!;
    const value = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    const t = Math.min(1, value / fade);
    return t * t * (3 - 2 * t);
  };

  // Each axis moves by whole corner steps (2 cells), so a wobble moves the outline out as readily
  // as in (a corner on a polygon's side is inside by a hair), and under a cell it moves nothing.
  const step = (reach: number, noise: number): number => 2 * Math.round((reach * Math.max(-1, Math.min(1, noise * CONTRAST))) / 2);
  // Odd about a symmetry's centre: a point's move is its partner's turned round.
  const [noiseX, noiseY] = [seed, seed ^ 0x5bd1e995].map((salt) => symmetricNoise((x, y) => wobble(x, y, wavelength, salt), symmetry, -1));
  const warp: OutlineWarp = (point) => {
    const weight = freedom(point);
    if (weight === 0) return point;
    const reach = weight * amplitude;
    const dx = step(reach, noiseX!(point.x, point.y));
    const dy = step(reach, noiseY!(point.x, point.y));
    if (dx === 0 && dy === 0) return point;
    // Kept on the map, so a zone running to the map's edge still owns the edge.
    return { x: Math.max(0, Math.min(width, point.x + dx)), y: Math.max(0, Math.min(height, point.y + dy)) };
  };
  if (!symmetry) return warp;
  return (point) => {
    if (onSourceSide(symmetry, point)) return warp(point);
    const source = rotatePoint(symmetry, point);
    const warped = warp(source);
    return warped === source ? point : rotatePoint(symmetry, warped);
  };
}

/**
 * The index of the zone owning `point` (later zones win where they overlap), or -1. The wobble
 * moves cliffs, not borders on one level: where the ragged owner is at the same level as the
 * polygons' owner, the polygons' owner keeps the point (textures and regions follow the polygons there).
 */
export function zoneIndexAt(blueprint: MissionBlueprint, warp: OutlineWarp, point: Point): number {
  const { zones } = blueprint;
  let straight = zones.length - 1;
  while (straight >= 0 && !containsPoint(zones[straight]!.polygon, point)) straight--;
  const warped = warp(point);
  if (warped === point) return straight;
  let ragged = zones.length - 1;
  while (ragged >= 0 && !containsPoint(zones[ragged]!.polygon, zones[ragged]!.surface === "built" ? point : warped)) ragged--;
  const level = (index: number) => (index < 0 ? undefined : zones[index]!.elevation);
  return level(ragged) === level(straight) ? straight : ragged;
}
