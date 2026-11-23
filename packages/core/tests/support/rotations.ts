// Rotations as 3×3 matrices, composed the way the engine applies an actor's world-axis (x, y, z)
// (R = Rx·Ry·Rz) and the way an own-frame facing reads (heading, then pitch, then roll), for checking
// what core writes against the true orientation.
import type { CutsceneNode } from "../../src/cutscene/read-cutscene.js";

export type Matrix = number[][];
const radians = Math.PI / 180;
export const times = (a: Matrix, b: Matrix): Matrix => a.map((row) => b[0]!.map((_, column) => row.reduce((sum, value, k) => sum + value * b[k]![column]!, 0)));
const transposed = (a: Matrix): Matrix => a[0]!.map((_, column) => a.map((row) => row[column]!));
const about = (axis: 0 | 1 | 2, degrees: number): Matrix => {
  const [c, s] = [Math.cos(degrees * radians), Math.sin(degrees * radians)];
  if (axis === 0) return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 1) return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
};

/** The engine's rotation for a world-axis triple: about z, then world y, then world x. */
export const engine = ([x, y, z]: readonly number[]): Matrix => times(about(0, x!), times(about(1, y!), about(2, z!)));

/** An own-frame facing's rotation: heading about z, nose up about its own lateral axis, roll about its nose. */
export const own = ({ heading, pitch = 0, roll = 0 }: { heading: number; pitch?: number; roll?: number }): Matrix => times(about(2, heading), times(about(1, -pitch), about(0, roll)));

/** The angle in degrees between two rotations. */
export const apart = (a: Matrix, b: Matrix): number => {
  const trace = [0, 1, 2].reduce((sum, i) => sum + [0, 1, 2].reduce((inner, k) => inner + a[k]![i]! * b[k]![i]!, 0), 0);
  return Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) / radians;
};

/** The rotation a fraction `s` of the shortest way from `a` to `b`, turning about one axis. */
export function between(a: Matrix, b: Matrix, s: number): Matrix {
  const delta = times(transposed(a), b);
  const angle = apart(a, b) * radians;
  if (angle < 1e-12) return a;
  let axis = [delta[2]![1]! - delta[1]![2]!, delta[0]![2]! - delta[2]![0]!, delta[1]![0]! - delta[0]![1]!];
  if (Math.hypot(...axis) < 1e-6) {
    // A half turn: the axis is the column of (delta + I) / 2 with the largest entry.
    const sym = delta.map((row, i) => row.map((value, k) => (value + (i === k ? 1 : 0)) / 2));
    const best = [0, 1, 2].reduce((most, i) => (sym[i]![i]! > sym[most]![most]! ? i : most), 0);
    axis = sym.map((row) => row[best]!);
  }
  const norm = Math.hypot(...axis);
  const [x, y, z] = axis.map((value) => value / norm) as [number, number, number];
  const [c, s1] = [Math.cos(angle * s), Math.sin(angle * s)];
  const t = 1 - c;
  return times(a, [
    [c + x * x * t, x * y * t - z * s1, x * z * t + y * s1],
    [y * x * t + z * s1, c + y * y * t, y * z * t - x * s1],
    [z * x * t - y * s1, z * y * t + x * s1, c + z * z * t],
  ]);
}

/** How far `pose` is from the shortest turn from `a` to `b`: the nearest pose along it, in degrees. */
export const offTurn = (pose: Matrix, a: Matrix, b: Matrix): number => Math.min(...Array.from({ length: 2001 }, (_, at) => apart(pose, between(a, b, at / 2000))));

/** A CCutsceneNodePropertyValue's value at `time` (ms): its keys' Bezier, the first key's before it and the last's after. */
export function curveValue(property: CutsceneNode, time: number): number {
  const keys = property.children.map(({ attrs }) => {
    const [inTime, inValue] = attrs.curveInValue!.split(",").map(Number) as [number, number];
    const [outTime, outValue] = attrs.curveOutValue!.split(",").map(Number) as [number, number];
    return { time: Number(attrs.time), value: Number(attrs.value), inTime, inValue, outTime, outValue };
  });
  const next = keys.findIndex((key) => key.time >= time);
  if (next === -1) return keys.at(-1)!.value;
  if (next === 0) return keys[0]!.value;
  const [a, b] = [keys[next - 1]!, keys[next]!];
  const bezier = (p0: number, p1: number, p2: number, p3: number, u: number) => (1 - u) ** 3 * p0 + 3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u ** 2 * p2 + u ** 3 * p3;
  // The u where the time Bezier reaches `time`, by bisection (time only increases along a span).
  let [low, high] = [0, 1];
  for (let step = 0; step < 60; step++) {
    const middle = (low + high) / 2;
    if (bezier(a.time, a.outTime, b.inTime, b.time, middle) < time) low = middle;
    else high = middle;
  }
  return bezier(a.value, a.outValue, b.inValue, b.value, (low + high) / 2);
}
