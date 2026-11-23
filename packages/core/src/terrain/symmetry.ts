// 180° rotational symmetry about the playable area's centre (melee spec #212, #214): the
// rotation itself, and how the terrain and placements keep to it. A Melee Map Blueprint draws
// half the map; rotate-half.ts adds the other half's zones and objects, and the compiler turns
// what it can't draw twice (a ramp's fit, a resource base's layout) from the source side.
//
// The centre lies on the 2-cell cliff grid's lines (both coordinates whole, and twice each even
// relative to the grid), so a corner turns onto a corner, a cell onto a cell and a cliff cell
// onto a cliff cell.

import type { Facing } from "../domain/mission-blueprint.js";
import type { Ramp, RampDirection } from "./ramps.js";
import type { Point } from "./rasterize.js";

export type Rot180 = {
  /** The playable area's centre. */
  readonly centre: Point;
  /** Each zone's partner: its rotated copy's id, or its own for a zone symmetric about the centre. */
  readonly zonePartners: ReadonlyMap<string, string>;
  /** Each rotated ramp's and resource base's id, mapped to the id of the authored one it turns. */
  readonly rotatedFrom: ReadonlyMap<string, string>;
};

/** The id a rotated copy of `id` gets: stable, so notes can name either side. */
export const rotatedId = (id: string): string => `${id}-rot`;

export function rotatePoint(symmetry: Pick<Rot180, "centre">, point: Point): Point {
  return { x: 2 * symmetry.centre.x - point.x, y: 2 * symmetry.centre.y - point.y };
}

/** The cell (by its lower-left corner) a cell turns onto. */
export function rotateCell(symmetry: Pick<Rot180, "centre">, x: number, y: number): Point {
  return { x: 2 * symmetry.centre.x - 1 - x, y: 2 * symmetry.centre.y - 1 - y };
}

/**
 * The side the other is turned from: below the centre, or on its row and not right of it. The
 * centre itself is on it, so a point is on it or its rotation is.
 */
export function onSourceSide(symmetry: Pick<Rot180, "centre">, point: Point): boolean {
  return point.y < symmetry.centre.y || (point.y === symmetry.centre.y && point.x <= symmetry.centre.x);
}

/**
 * The cell (by its lower-left corner) whose values a cell takes, so what's drawn per cell keeps to
 * the rotation: its own when its centre is on the source side, else its partner's (its own when the
 * partner is off a `width`×`height` map).
 */
export function sourceCell(symmetry: Rot180 | undefined, x: number, y: number, width: number, height: number): Point {
  if (!symmetry || onSourceSide(symmetry, { x: x + 0.5, y: y + 0.5 })) return { x, y };
  const turned = rotateCell(symmetry, x, y);
  return turned.x >= 0 && turned.y >= 0 && turned.x < width && turned.y < height ? turned : { x, y };
}

/**
 * `noise` made even (`parity` 1: a point's value is its partner's) or odd (-1: its partner's
 * negated, as a move turned round) about the centre, keeping its spread, so coherent noise keeps
 * to the rotation with no seam between the sides. `noise` itself without a symmetry.
 */
export function symmetricNoise(noise: (x: number, y: number) => number, symmetry: Pick<Rot180, "centre"> | undefined, parity: 1 | -1): (x: number, y: number) => number {
  if (!symmetry) return noise;
  return (x, y) => {
    const turned = rotatePoint(symmetry, { x, y });
    return (noise(x, y) + parity * noise(turned.x, turned.y)) * Math.SQRT1_2;
  };
}

export const ROTATED_EDGE = { north: "south", south: "north", east: "west", west: "east" } as const;

export const ROTATED_FACING: Readonly<Record<Facing, Facing>> = {
  north: "south",
  "north-east": "south-west",
  east: "west",
  "south-east": "north-west",
  south: "north",
  "south-west": "north-east",
  west: "east",
  "north-west": "south-east",
};

/** Uphill 0 south ↔ 1 north, 2 west ↔ 3 east, 4 south-west ↔ 7 north-east, 5 south-east ↔ 6 north-west. */
const ROTATED_RAMP: readonly RampDirection[] = [1, 0, 3, 2, 7, 6, 5, 4];

/** The ramp turned 180°: the straight ramps' lane and the diagonal template both turn about their `edge` vertex. */
export function rotateRamp(symmetry: Rot180, ramp: Ramp): Ramp {
  return { ...ramp, direction: ROTATED_RAMP[ramp.direction]!, edge: rotatePoint(symmetry, ramp.edge) };
}
