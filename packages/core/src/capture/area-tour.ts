// The camera tour of an edited area (#254): one high view that frames the whole area with a
// margin, then two or three at the player's angle (the default game camera's distance and pitch).
// A small area gets the player's view and one turned 45° each way; a longer one gets views spread
// along it, each over its part. The views are checked on their ground footprints: the trapezoid
// the camera sees on flat ground at the target's height (relief and cliffs aren't counted).

import { DEFAULT_CAMERA_VALUES } from "../map/write-objects-xml.js";
import type { CellRect } from "../kept-terrain/area.js";
import { containsPoint } from "../terrain/rasterize.js";

type XY = { readonly x: number; readonly y: number };
type Bounds = readonly [left: number, bottom: number, right: number, top: number];

const cameraDefault = (name: string): number => DEFAULT_CAMERA_VALUES.find(([key]) => key === name)![1];

/** The default game camera: what the player sees. FieldOfView is vertical. */
export const PLAYER_CAMERA = { distance: cameraDefault("Distance"), pitch: cameraDefault("Pitch"), fov: cameraDefault("FieldOfView") } as const;
/** The high view's pitch: nearly top-down, with a little relief still showing. */
export const HIGH_PITCH = 75;
/** Cells round the area the high view frames too. */
export const HIGH_MARGIN = 2;
/** The nearest a close Shot's camera comes (a Shot's `close`): near enough to frame a few cells of ground. */
export const CLOSE_DISTANCE = 8;
/** The farthest the high view goes. */
const MAX_DISTANCE = 400;
/** How far the turned views turn either way, in degrees. */
const TURN = 45;
/** The game window's shape, as `editor.captureTour` captures it. */
const ASPECT = 16 / 9;

export type TourView = {
  readonly label: string;
  /** The camera target, in cells. */
  readonly target: readonly [number, number];
  readonly distance: number;
  /** Degrees down from level. */
  readonly pitch: number;
  /** Degrees from the game camera's own yaw (looking north); the player never turns it. */
  readonly yawOffset: number;
  /** The vertical field of view, in degrees: the default game camera's, which the tour leaves alone. */
  readonly fov: number;
  /**
   * Whether it shows all of its part: the high view, everything the edit may change and a margin;
   * a player's view, the area or its share of it. False when the area is too big for the views
   * or a target had to move inside the camera bounds.
   */
  readonly whole: boolean;
};

type Camera = Pick<TourView, "target" | "distance" | "pitch" | "yawOffset"> & { readonly fov?: number };

const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** The forward and right directions on the ground for a yaw offset (0: looking north). */
function axes(yawOffset: number): { forward: XY; right: XY } {
  const a = rad(yawOffset);
  return { forward: { x: -Math.sin(a), y: Math.cos(a) }, right: { x: Math.cos(a), y: Math.sin(a) } };
}

/** How far ahead of the target the footprint's near and far edges are, and their half-widths. */
function rows(camera: Pick<Camera, "distance" | "pitch" | "fov">) {
  const fov = camera.fov ?? PLAYER_CAMERA.fov;
  const pitch = rad(camera.pitch);
  const half = rad(fov / 2);
  if (pitch - half <= 0) throw new Error(`A camera pitched ${camera.pitch}° sees the horizon with a ${fov}° field of view`);
  const height = camera.distance * Math.sin(pitch);
  const back = camera.distance * Math.cos(pitch);
  const spread = Math.tan(half) * ASPECT;
  const row = (t: number) => ({ ahead: height / Math.tan(pitch - t) - back, halfWidth: ((height * Math.cos(t)) / Math.sin(pitch - t)) * spread });
  return { near: row(-half), far: row(half) };
}

/** The ground the camera sees: near left, near right, far right, far left. */
export function cameraFootprint(camera: Camera): XY[] {
  const { forward, right } = axes(camera.yawOffset);
  const { near, far } = rows(camera);
  const at = (ahead: number, side: number): XY => ({ x: camera.target[0] + forward.x * ahead + right.x * side, y: camera.target[1] + forward.y * ahead + right.y * side });
  return [at(near.ahead, -near.halfWidth), at(near.ahead, near.halfWidth), at(far.ahead, far.halfWidth), at(far.ahead, -far.halfWidth)];
}

/**
 * The ground point, in cells, a point of the camera's frame shows: `u` across from its left edge
 * and `v` down from its top, each 0..1, on flat ground at the target's height, as cameraFootprint
 * reads it (relief and cliffs aren't counted). The frame's corners are the footprint's.
 */
export function frameToGround(camera: Camera, u: number, v: number): XY {
  const { forward, right } = axes(camera.yawOffset);
  const pitch = rad(camera.pitch);
  const tanHalf = Math.tan(rad((camera.fov ?? PLAYER_CAMERA.fov) / 2));
  const height = camera.distance * Math.sin(pitch);
  const back = camera.distance * Math.cos(pitch);
  // The ray through the frame point, as the camera sees it: up the frame tilts it towards level.
  const up = (1 - 2 * v) * tanHalf;
  const side = (2 * u - 1) * tanHalf * ASPECT;
  const down = Math.sin(pitch) - up * Math.cos(pitch);
  if (down <= 0) throw new Error(`That point of the frame is at or above the horizon (camera pitched ${camera.pitch}°)`);
  const reach = height / down;
  const ahead = reach * (Math.cos(pitch) + up * Math.sin(pitch)) - back;
  const across = reach * side;
  return { x: camera.target[0] + forward.x * ahead + right.x * across, y: camera.target[1] + forward.y * ahead + right.y * across };
}

/** Whether the camera sees the whole rectangle. */
export function framesRect(camera: Camera, rect: CellRect): boolean {
  const footprint = cameraFootprint(camera);
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].every((corner) => containsPoint(footprint, corner));
}

/** Whether the camera sees the whole disc: true whichever way the game turns a yaw offset. */
export function framesDisc(camera: Camera, centre: readonly [number, number], radius: number): boolean {
  const footprint = cameraFootprint(camera);
  const point = { x: centre[0], y: centre[1] };
  if (!containsPoint(footprint, point)) return false;
  return footprint.every((a, i) => {
    const b = footprint[(i + 1) % footprint.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return Math.abs((b.x - a.x) * (a.y - point.y) - (a.x - point.x) * (b.y - a.y)) / length >= radius;
  });
}

/** The target that puts the middle of the footprint's depth on `centre`, looking along the yaw. */
function aimAt(centre: readonly [number, number], camera: Pick<Camera, "distance" | "pitch"> & { readonly yawOffset?: number }): [number, number] {
  const { near, far } = rows(camera);
  const { forward } = axes(camera.yawOffset ?? 0);
  const ahead = (near.ahead + far.ahead) / 2;
  return [centre[0] - forward.x * ahead, centre[1] - forward.y * ahead];
}

const clampTo = (bounds: Bounds, [x, y]: readonly [number, number]): [number, number] => [Math.min(Math.max(x, bounds[0]), bounds[2]), Math.min(Math.max(y, bounds[1]), bounds[3])];

/** A camera that frames a rectangle: see `fitRect`. */
export type FittedCamera = Pick<TourView, "target" | "distance" | "pitch" | "yawOffset" | "fov" | "whole">;

/**
 * The camera that frames the whole of `rect` (cells) at a pitch and a yaw offset, with the default
 * game camera's field of view: aimed at the rectangle's middle, from the nearest distance, in whole
 * cells from the player's own (or from `nearest`, for a closer view of a small rectangle), whose
 * footprint holds all four corners. The distance stops at 400,
 * and the target is kept inside `bounds`, the map's camera bounds, as the game keeps it. `whole`
 * is false when either cut the frame short.
 */
export function fitRect(rect: CellRect, view: Pick<TourView, "pitch" | "yawOffset">, bounds: Bounds, nearest: number = PLAYER_CAMERA.distance): FittedCamera {
  const centre: [number, number] = [rect.x + rect.width / 2, rect.y + rect.height / 2];
  const { pitch, yawOffset } = view;
  let distance = nearest;
  while (distance < MAX_DISTANCE && !framesRect({ target: aimAt(centre, { distance, pitch, yawOffset }), distance, pitch, yawOffset }, rect)) distance += 1;
  const camera = { target: clampTo(bounds, aimAt(centre, { distance, pitch, yawOffset })), distance, pitch, yawOffset };
  return { ...camera, fov: PLAYER_CAMERA.fov, whole: framesRect(camera, rect) };
}

/**
 * The views of a tour of `area` (cells), as above. The high view frames `reach` (by default the
 * area): for a brush, every cell it may change, falloff and all. `bounds` are the map's camera
 * bounds: the game keeps the camera's target inside them, so the plan does too, and a view at the
 * map's edge may then show less than its part.
 */
export function planAreaTour(area: CellRect, bounds: Bounds, reach: CellRect = area): TourView[] {
  const centre: [number, number] = [area.x + area.width / 2, area.y + area.height / 2];
  const framed = { x: reach.x - HIGH_MARGIN, y: reach.y - HIGH_MARGIN, width: reach.width + 2 * HIGH_MARGIN, height: reach.height + 2 * HIGH_MARGIN };
  const high: TourView = { label: "high", ...fitRect(framed, { pitch: HIGH_PITCH, yawOffset: 0 }, bounds) };

  const player = (label: string, target: readonly [number, number], shows: (camera: Camera) => boolean, yawOffset = 0): TourView => {
    const camera = { target: clampTo(bounds, target), ...PLAYER_CAMERA, yawOffset };
    return { label, ...camera, whole: shows(camera) };
  };
  // Strips side by side (split along x) or one behind another (along y).
  const parts = (n: number, along: "x" | "y"): CellRect[] =>
    Array.from({ length: n }, (_, i) =>
      along === "x"
        ? { x: area.x + (area.width / n) * i, y: area.y, width: area.width / n, height: area.height }
        : { x: area.x, y: area.y + (area.height / n) * i, width: area.width, height: area.height / n },
    );
  const middle = (part: CellRect): [number, number] => [part.x + part.width / 2, part.y + part.height / 2];
  const fits = (part: CellRect) => framesRect({ target: aimAt(middle(part), PLAYER_CAMERA), ...PLAYER_CAMERA, yawOffset: 0 }, part);
  // The player's view is wide and shallow (about 25-35 cells across by 20 deep), so the split is
  // the one whose strips fit it, the fewest strips first; the area's own long side breaks a tie.
  const longSide = area.width >= area.height ? "x" : "y";
  const splits = [longSide, longSide === "x" ? "y" : "x"] as const;
  const split = [1, 2, 3].flatMap((n) => splits.map((along) => ({ n, along }))).find(({ n, along }) => parts(n, along).every(fits)) ?? { n: 3, along: longSide };
  const needed = split.n;

  const halfDiagonal = Math.hypot(area.width, area.height) / 2;
  if (needed === 1 && framesDisc({ target: centre, ...PLAYER_CAMERA, yawOffset: TURN }, centre, halfDiagonal)) {
    // Turned views aim at the middle itself: which way the game turns a positive yaw doesn't matter then.
    const disc = (camera: Camera) => framesDisc(camera, centre, halfDiagonal);
    return [
      high,
      player("player", aimAt(centre, PLAYER_CAMERA), (camera) => framesRect(camera, area)),
      player(`player-yaw-${TURN}`, centre, disc, -TURN),
      player(`player-yaw+${TURN}`, centre, disc, TURN),
    ];
  }
  const n = Math.max(needed, 2);
  const along = needed === 1 ? longSide : split.along;
  return [high, ...parts(n, along).map((part, i) => player(`player-${i + 1}`, aimAt(middle(part), PLAYER_CAMERA), (camera) => framesRect(camera, part)))];
}
