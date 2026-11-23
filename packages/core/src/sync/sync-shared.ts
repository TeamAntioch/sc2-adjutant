// What every sync from an Editor-saved map shares: the tolerances under which a difference is the
// Editor's rounding, and the helpers that turn the Editor's numbers back into blueprint values.

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { expandDressing, type PlacedDoodad, type PlacedSetPiece } from "../dressing/expand-dressing.js";
import { containsPoint, rasterizeTerrain, terrainHeightAt } from "../terrain/rasterize.js";

/** Changes below these are the Editor's rounding, not an edit. */
export const POSITION_TOLERANCE = 0.01;
export const HEIGHT_TOLERANCE = 0.05;
export const ANGLE_TOLERANCE = 0.001;
export const SCALE_TOLERANCE = 0.001;

export const round = (value: number, places = 3): number => Math.round(value * 10 ** places) / 10 ** places;
export const angleApart = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
export const vector = (scale: number | readonly [number, number, number]): readonly [number, number, number] =>
  typeof scale === "number" ? [scale, scale, scale] : scale;

/** A uniform scale as a number, else [x, y, z]. */
export const scaleValue = (scale: { x: number; y: number; z: number }): number | [number, number, number] =>
  Math.abs(scale.x - scale.y) < SCALE_TOLERANCE && Math.abs(scale.x - scale.z) < SCALE_TOLERANCE
    ? round(scale.x)
    : [round(scale.x), round(scale.y), round(scale.z)];

/** Whether the Editor's scale differs from the compiled one. */
export const scaleChanged = (editor: { x: number; y: number; z: number }, compiled: number | readonly [number, number, number]): boolean => {
  const [x, y, z] = vector(compiled);
  return Math.abs(editor.x - x) > SCALE_TOLERANCE || Math.abs(editor.y - y) > SCALE_TOLERANCE || Math.abs(editor.z - z) > SCALE_TOLERANCE;
};

/** Copies a raw JSON object deeply enough to edit it. */
export const clone = <T>(value: T): T => structuredClone(value);

/** The zone a point stands in: the last listed that contains it, as the terrain paints them. */
export function zoneAt(blueprint: MissionBlueprint, x: number, y: number): string {
  const zone = blueprint.zones.findLast((z) => containsPoint(z.polygon, { x, y }));
  return (zone ?? blueprint.zones[0]!).id;
}

/** An id slug from an Editor name or type: "Siege Tank" → "siege-tank". */
export const slugOf = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "object";

/** The first `<stem>-<n>` not taken. */
export function freshId(stem: string, taken: (id: string) => boolean): string {
  let n = 1;
  while (taken(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

/**
 * The ground a compile stands a Blueprint's objects on, and the dressing it writes there: what sync
 * compares the Editor's objects with. On a generated map, the Blueprint's own terrain; beside Kept
 * ground, the package's ground with the generating Zones written in (zonesForSync).
 */
export type SyncGround = {
  /** The ground's height at a point, where a doodad on it stands. */
  readonly groundAt: (x: number, y: number) => number;
  /** The dressing the compile would write for `blueprint` (the one read, or as sync changed it). */
  readonly dressing: (blueprint: MissionBlueprint) => { readonly doodads: readonly PlacedDoodad[]; readonly setPieces: readonly PlacedSetPiece[] };
};

/** A generated map's ground: the Blueprint's terrain, rasterized once, and its dressing on it. */
export function generatedGround(blueprint: MissionBlueprint): SyncGround {
  const terrain = rasterizeTerrain(blueprint);
  const width = blueprint.mapSize.width;
  return { groundAt: (x, y) => terrainHeightAt(terrain, width, x, y), dressing: (next) => expandDressing(next, terrain) };
}
