// A moving actor's steps as Blizzard's and Editor-made cutscenes move actors: along a follow path (CCutsceneNodePath,
// its markers the points it passes) at a pace set leg by leg, not by keyed x/y/z curves. In game
// and in the Editor an actor on a path travels its anim element's `movespeed` ÷ 100 cells a second,
// whatever the element's `originalMoveSpeed` and the actor's scale, and a later element on its anim
// layer changes the pace on the spot (TestPathSpeed, 2026-11-01; docs/reference/editor-and-engine.md,
// "Cutscene walk animations need their built-in move speed"). So each leg gets the movespeed that
// covers it in its step's time, an eased step a few that ramp down.

import { progressAt } from "./property-curves.js";

type Vec3 = readonly [number, number, number];

/** A timed step to a point: from where the step before left the actor, eased or linear, facing `along` its path (the Editor's (x, y, z), relative to the path's direction). */
export type Leg = {
  readonly startMs: number;
  readonly durationMs: number;
  readonly to: Vec3;
  readonly along?: Vec3 | undefined;
  readonly move?: "ease" | "linear" | undefined;
};

/** How fast the actor goes from `startMs` to `endMs`, in cells a second. */
export type Pace = { readonly startMs: number; readonly endMs: number; readonly cellsPerSecond: number };

/**
 * One follow of a path: from `startMs` until the next run (or the actor's end), through `markers`,
 * facing `along` it. A facing that changes between legs starts a run of its own, since a follow
 * element holds one rotation offset, and so does a leg UNEVEN times longer or shorter than the one
 * before it.
 */
export type PathRun = { readonly startMs: number; readonly markers: readonly Vec3[]; readonly along: Vec3 };

export type FollowPlan = { readonly runs: readonly PathRun[]; readonly paces: readonly Pace[] };

/**
 * How many times longer or shorter than the leg before it a leg may be and stay on its path. The
 * engine's curve through markers spaced very unevenly swings past the short leg and back: Hot
 * Zone's Space Approach warp-in (2026-11-02), a 7.1-cell leg then 0.65 cells then 50, scooted
 * backwards before it went on. Its dive, each leg up to 1.3 times the one before, flew clean.
 */
export const UNEVEN = 3;

/** How many paces an eased leg is split into, so its speed ramps from fast to slow as its curve's would. */
export const EASE_PIECES = 4;

const ZERO: Vec3 = [0, 0, 0];
const same = (a: readonly number[], b: readonly number[]): boolean => a.every((value, axis) => Math.abs(value - b[axis]!) < 1e-6);
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/**
 * Each leg's length along a path through `markers`, as the Editor draws it: a curve through every
 * marker. Which curve the engine uses isn't recorded, so this is one that bends through each marker
 * without overshooting: each leg a Hermite curve whose tangent at a marker runs from the marker
 * before to the one after, as long as the leg itself (an end's along its leg), so markers in a
 * line, however spaced, make a straight path and its legs their straight length, and on a bend a leg
 * is a little longer than its chord. A uniform Catmull-Rom curve would swing far past a short leg
 * that follows a long one.
 */
export function splineLengths(markers: readonly Vec3[]): number[] {
  const legs = markers.slice(1).map((end, at) => length(minus(end, markers[at]!)));
  /** The tangent at marker `at` for leg `leg` (one of the two beside it): its direction through the marker, the leg's length long. */
  const tangent = (at: number, leg: number): Vec3 => {
    const [before, after] = [markers[Math.max(0, at - 1)]!, markers[Math.min(markers.length - 1, at + 1)]!];
    const through = minus(after, before);
    const size = length(through);
    return size < 1e-12 ? ZERO : (through.map((value) => (value * legs[leg]!) / size) as unknown as Vec3);
  };
  const SAMPLES = 32;
  return markers.slice(1).map((end, at) => {
    const [p0, m0, m1] = [markers[at]!, tangent(at, at), tangent(at + 1, at)];
    const point = (t: number): Vec3 => {
      const [t2, t3] = [t * t, t * t * t];
      const [h00, h10, h01, h11] = [2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, -2 * t3 + 3 * t2, t3 - t2];
      return [0, 1, 2].map((axis) => h00 * p0[axis]! + h10 * m0[axis]! + h01 * end[axis]! + h11 * m1[axis]!) as unknown as Vec3;
    };
    let total = 0;
    let last = p0;
    for (let step = 1; step <= SAMPLES; step++) {
      const next = point(step / SAMPLES);
      total += length(minus(next, last));
      last = next;
    }
    return total;
  });
}

/**
 * The paths and paces that take an actor from `start` through `legs` (in time order) in their
 * times: a run of the path for each stretch of evenly spaced legs facing one way along it, its markers where the
 * run starts and each of its legs' ends (a leg that goes nowhere adds none), and the paces from the
 * first leg's start to the last one's end, 0 while it waits between legs. Times are whole ms, as the
 * elements are written, and each pace covers its leg's length in exactly its time.
 */
export function followPlan(start: Vec3, legs: readonly Leg[]): FollowPlan {
  const runs: { startMs: number; markers: Vec3[]; along: Vec3 }[] = [];
  // Where each leg ends on the runs: its run and its segment there; none for a leg that goes nowhere.
  const placed: ({ run: number; segment: number } | undefined)[] = [];
  let at = start;
  for (const leg of legs) {
    if (same(leg.to, at)) {
      placed.push(undefined);
      continue;
    }
    const along = leg.along ?? ZERO;
    const previous = runs.at(-1)?.markers;
    const before = previous && previous.length > 1 ? length(minus(previous.at(-1)!, previous.at(-2)!)) : undefined;
    const ratio = before === undefined ? 1 : length(minus(leg.to, at)) / before;
    if (!runs.length || !same(runs.at(-1)!.along, along) || ratio > UNEVEN || ratio < 1 / UNEVEN) runs.push({ startMs: Math.round(leg.startMs), markers: [at], along });
    const run = runs.at(-1)!;
    run.markers.push(leg.to);
    placed.push({ run: runs.length - 1, segment: run.markers.length - 2 });
    at = leg.to;
  }
  if (!runs.length) return { runs: [], paces: [] };
  const lengths = runs.map((run) => splineLengths(run.markers));
  const paces: Pace[] = [];
  const add = (startMs: number, endMs: number, cells: number): void => {
    if (endMs <= startMs) return;
    const cellsPerSecond = (cells * 1000) / (endMs - startMs);
    const last = paces.at(-1);
    if (last && last.endMs === startMs && Math.abs(last.cellsPerSecond - cellsPerSecond) < 1e-9) paces[paces.length - 1] = { ...last, endMs };
    else paces.push({ startMs, endMs, cellsPerSecond });
  };
  const first = placed.findIndex((place) => place !== undefined);
  const last = placed.findLastIndex((place) => place !== undefined);
  legs.forEach((leg, index) => {
    if (index < first || index > last) return;
    // Each leg at least a whole ms, after the one before, so none goes uncovered.
    const before = paces.at(-1)?.endMs;
    const from = Math.max(Math.round(leg.startMs), before ?? -Infinity);
    const to = Math.max(Math.round(leg.startMs + leg.durationMs), from + 1);
    if (before !== undefined && before < from) add(before, from, 0);
    const place = placed[index];
    const cells = place ? lengths[place.run]![place.segment]! : 0;
    if (leg.move === "linear" || cells === 0) return add(from, to, cells);
    // An eased leg leaves fast and settles, as its keyed curve would: a pace for each piece of its time.
    const times = Array.from({ length: EASE_PIECES + 1 }, (_, piece) => from + Math.round(((to - from) * piece) / EASE_PIECES));
    for (let piece = 0; piece < EASE_PIECES; piece++) {
      const [a, b] = [times[piece]!, times[piece + 1]!];
      add(a, b, cells * (progressAt("ease", (b - from) / (to - from)) - progressAt("ease", (a - from) / (to - from))));
    }
  });
  return { runs, paces };
}

/**
 * Where `leg` leaves an actor that started it at `from` by `ms`, a time in it: along its straight
 * line, as far as its pace has gone.
 */
export function partWay(from: Vec3, leg: Leg, ms: number): Vec3 {
  const u = Math.min(1, Math.max(0, (ms - leg.startMs) / leg.durationMs));
  const share = progressAt(leg.move ?? "ease", u);
  return [0, 1, 2].map((axis) => from[axis]! + (leg.to[axis]! - from[axis]!) * share) as unknown as Vec3;
}
