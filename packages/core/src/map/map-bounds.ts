// A Mission's playable area (ADR-0015): MapInfo's one rectangle, which the game uses as the area
// units may go, the camera's bounds at the start and `RegionPlayableMap()`. The Editor calls it
// "Camera" in Map Properties > Bounds. A generated Mission's comes from its Blueprint's `bounds`:
// by default the box round its Zones that aren't backdrop, widened by a margin and kept inside the
// Editor's own inset, so the camera, which looks past the bounds, still sees the map's terrain.

import { type BoundsRect, hasKeptTerrain, type MissionBlueprint } from "../domain/mission-blueprint.js";

export type Rect = BoundsRect;

/**
 * The Editor's default bounds inset, in cells from each side: the inset a new map gets, and the
 * one Blizzard's campaign stage regions keep to, (10, 8) to (W−10, H−20). The top is widest since
 * the camera pitches north: about 12–14 cells past the top bound show on screen, against about 8
 * past the bottom (inferred from the camera's angle, not measured in game).
 */
export const EDITOR_MARGINS = { left: 10, bottom: 8, right: 10, top: 20 } as const;

/** Cells the default playable area reaches past the box round the Zones. */
export const DEFAULT_ZONES_MARGIN = 3;

/** The Editor's default bounds on a map this size: [10, 8, w−10, h−20]. */
export function editorBounds(width: number, height: number): Rect {
  return [EDITOR_MARGINS.left, EDITOR_MARGINS.bottom, width - EDITOR_MARGINS.right, height - EDITOR_MARGINS.top];
}

/** The box round some polygons' points; none for no points. */
export function boxOf(polygons: readonly (readonly { readonly x: number; readonly y: number }[])[]): Rect | undefined {
  const points = polygons.flat();
  if (points.length === 0) return undefined;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** `rect` widened by `by` cells on every side. */
export const widen = ([left, bottom, right, top]: Rect, by: number): Rect => [left - by, bottom - by, right + by, top + by];

/** The overlap of two rectangles; none when they don't overlap. */
export function intersect(a: Rect, b: Rect): Rect | undefined {
  const rect: Rect = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return rect[0] < rect[2] && rect[1] < rect[3] ? rect : undefined;
}

/** The box round two rectangles. */
export const union = (a: Rect, b: Rect): Rect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

/** `rect` grown out to whole cells, or to even ones, as Set Playable Map Area rounds its region. */
export function roundOut([left, bottom, right, top]: Rect, step: 1 | 2 = 1): Rect {
  const down = (value: number): number => Math.floor(value / step) * step;
  const up = (value: number): number => Math.ceil(value / step) * step;
  return [down(left), down(bottom), up(right), up(top)];
}

/**
 * `rect` drawn in to even cells: the most a region off the even cells can keep once Set Playable
 * Map Area rounds it to the nearest even edges, whichever way a half rounds. What the checks and
 * the Waves' spawns read, so nothing they pass lands outside what plays.
 */
export function roundIn([left, bottom, right, top]: Rect): Rect {
  return [Math.ceil(left / 2) * 2, Math.ceil(bottom / 2) * 2, Math.floor(right / 2) * 2, Math.floor(top / 2) * 2];
}

/** A distance in cells as it reads in a message: "1 cell", "2.5 cells". */
export const cellsText = (value: number): string => `${round(value)} ${round(value) === 1 ? "cell" : "cells"}`;

export const sameRect = (a: Rect, b: Rect): boolean => a.every((value, index) => value === b[index]);

/** Whether `inner` lies inside `outer`. */
export const rectContains = (outer: Rect, inner: Rect): boolean => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];

/** How far a point lies outside a rectangle, in cells: 0 inside it or on its edge. */
export function distanceOutside([left, bottom, right, top]: Rect, point: { readonly x: number; readonly y: number }): number {
  const dx = Math.max(left - point.x, 0, point.x - right);
  const dy = Math.max(bottom - point.y, 0, point.y - top);
  return Math.hypot(dx, dy);
}

/** How far `inner` runs past each side of `outer`, as "N cells past the left edge" phrases; none when it lies inside. */
export function overhangs(outer: Rect, inner: Rect): string[] {
  const sides = [
    ["left", outer[0] - inner[0]],
    ["bottom", outer[1] - inner[1]],
    ["right", inner[2] - outer[2]],
    ["top", inner[3] - outer[3]],
  ] as const;
  return sides.filter(([, by]) => by > 0).map(([side, by]) => `${cellsText(by)} past the ${side} edge`);
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** The rectangle as it reads in a message. */
export const rectText = (rect: Rect): string => `[${rect.map(round).join(", ")}]`;

type BoundsBlueprint = Pick<MissionBlueprint, "mapSize" | "zones" | "bounds">;

/** The box round the Zones that aren't backdrop, none when every Zone is. */
export const walkableZonesBox = (blueprint: Pick<MissionBlueprint, "zones">): Rect | undefined => boxOf(blueprint.zones.filter((zone) => !zone.backdrop).map((zone) => zone.polygon));

/**
 * The playable area the compile writes into MapInfo: the Blueprint's rectangle, the Editor's inset,
 * or by default the box round its walkable Zones widened by the margin, in whole cells, kept inside
 * the Editor's inset (the Editor's inset itself when that leaves nothing). Undefined beside Kept
 * terrain when `bounds.playable` isn't given: the package keeps its own.
 */
export function playableBounds(blueprint: BoundsBlueprint, { keptTerrain = false }: { readonly keptTerrain?: boolean } = {}): Rect | undefined {
  const { width, height } = blueprint.mapSize;
  const playable = blueprint.bounds?.playable;
  if (playable === undefined && keptTerrain) return undefined;
  const inset = editorBounds(width, height);
  if (Array.isArray(playable)) return playable as Rect;
  if (playable === "editor") return inset;
  const box = walkableZonesBox(blueprint);
  if (!box) return inset;
  return intersect(roundOut(widen(box, blueprint.bounds?.margin ?? DEFAULT_ZONES_MARGIN)), inset) ?? inset;
}

/**
 * The playable area a rule reads when the compile writes none (beside Kept terrain, the package's,
 * which only a read of its MapInfo tells): the Editor's inset, as the compile wrote before bounds.
 */
export const assumedPlayableBounds = (blueprint: BoundsBlueprint): Rect =>
  playableBounds(blueprint, { keptTerrain: hasKeptTerrain(blueprint) }) ?? editorBounds(blueprint.mapSize.width, blueprint.mapSize.height);

/**
 * Advice on a playable area the author gave as a rectangle: the camera looks past the bounds, so a
 * rectangle nearer the map's edge than the Editor's inset shows the void beyond the map there. A
 * derived one is kept inside the inset, so this is about rectangles only.
 */
export function playableMarginWarnings(blueprint: BoundsBlueprint, rect: Rect): string[] {
  if (!Array.isArray(blueprint.bounds?.playable)) return [];
  const { width, height } = blueprint.mapSize;
  const short = overhangs(editorBounds(width, height), rect).map((phrase) => phrase.replace(/ past the (\w+) edge/, " nearer the $1 edge"));
  return short.length > 0
    ? [
        `The playable area ${rectText(rect)} comes ${short.join(", ")} of the map than the Editor's inset (${EDITOR_MARGINS.left} / ${EDITOR_MARGINS.bottom} / ${EDITOR_MARGINS.right} / ${EDITOR_MARGINS.top} cells from the left, bottom, right and top), and the camera looks past its bounds, most of all to the north: the map may show the void beyond its edge there. Pull the rectangle in, or make the map bigger`,
      ]
    : [];
}
