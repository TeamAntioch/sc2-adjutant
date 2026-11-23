// A facing in a model's own frame as the engine's world-axis (x, y, z), and a turn between two
// facings as the triples it passes. The engine applies an actor's rotation about the world axes, z
// first, then y, then x (R = Rx·Ry·Rz), and between two keys it turns each axis on its own, so a
// banked ship turning far wobbles off the true turn mid-way. A turn keyed at the triples of the true
// turn's in-between poses (quaternion slerp), close enough together, stays on it.

import type { OwnFacing } from "../domain/cinematic.js";

type Vec3 = readonly [number, number, number];
/** A unit quaternion, (w, x, y, z). */
type Quaternion = readonly [number, number, number, number];

const degrees = Math.PI / 180;

/** Rounded off float noise, so a bank about one axis writes 0, not -0.000000, on the others. */
const clean = (angle: number): number => Math.round(angle * 1e9) / 1e9 + 0;

/** The world-axis (x, y, z) triple, in degrees, the engine turns into the same orientation as `facing`. */
export function worldFacing({ heading, pitch = 0, roll = 0 }: OwnFacing): [number, number, number] {
  const [ch, sh] = [Math.cos(heading * degrees), Math.sin(heading * degrees)];
  // Nose up turns the nose (+x at heading 0) toward +z: about y, negatively.
  const [cp, sp] = [Math.cos(-pitch * degrees), Math.sin(-pitch * degrees)];
  const [cr, sr] = [Math.cos(roll * degrees), Math.sin(roll * degrees)];
  // M = Rz(heading)·Ry(−pitch)·Rx(roll), read back as Rx(x)·Ry(y)·Rz(z): M[0][2] = sin y,
  // M[0][0] and M[0][1] give z, M[1][2] and M[2][2] give x. Straight up or down (y ±90°), both pairs
  // shrink with cos y together, so their ratios still give an x and z that turn into M.
  const m00 = ch * cp;
  const m01 = ch * sp * sr - sh * cr;
  const m02 = ch * sp * cr + sh * sr;
  const m12 = sh * sp * cr - ch * sr;
  const m22 = cp * cr;
  const y = Math.asin(Math.max(-1, Math.min(1, m02)));
  return [clean(Math.atan2(-m12, m22) / degrees), clean(y / degrees), clean(Math.atan2(-m01, m00) / degrees)];
}

const multiply = ([aw, ax, ay, az]: Quaternion, [bw, bx, by, bz]: Quaternion): Quaternion => [
  aw * bw - ax * bx - ay * by - az * bz,
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
];

/** The engine's rotation for a world-axis triple, Rx·Ry·Rz, as a quaternion. */
function quaternionOf([x, y, z]: Vec3): Quaternion {
  const half = (angle: number) => [Math.cos((angle * degrees) / 2), Math.sin((angle * degrees) / 2)] as const;
  const [[cx, sx], [cy, sy], [cz, sz]] = [half(x), half(y), half(z)];
  return multiply(multiply([cx, sx, 0, 0], [cy, 0, sy, 0]), [cz, 0, 0, sz]);
}

/** The rotation a share `s` of the shortest way from `a` to `b`. */
function slerp(a: Quaternion, b: Quaternion, s: number): Quaternion {
  let dot = a.reduce((sum, value, at) => sum + value * b[at]!, 0);
  const to = dot < 0 ? (b.map((value) => -value) as unknown as Quaternion) : b;
  dot = Math.min(1, Math.abs(dot));
  const angle = Math.acos(dot);
  if (angle < 1e-9) return a;
  const [wa, wb] = [Math.sin((1 - s) * angle) / Math.sin(angle), Math.sin(s * angle) / Math.sin(angle)];
  return a.map((value, at) => wa * value + wb * to[at]!) as unknown as Quaternion;
}

/** Degrees between two rotations. */
const apart = (a: Quaternion, b: Quaternion): number => (2 * Math.acos(Math.min(1, Math.abs(a.reduce((sum, value, at) => sum + value * b[at]!, 0))))) / degrees;

/** `angle` give or take whole turns, as near `near` as it gets. */
const nearest = (angle: number, near: number): number => angle + 360 * Math.round((near - angle) / 360);

/**
 * The world-axis triple of `q` nearest `near`, axis by axis: of its two triples, (x, y, z) and
 * (x + 180, 180 − y, z + 180), each give or take whole turns. Straight up or down (y ±90°) only x ∓ z
 * counts, so it keeps `near`'s x.
 */
export function tripleNear(q: Quaternion, near: Vec3): Vec3 {
  const [w, x, y, z] = q;
  const m00 = 1 - 2 * (y * y + z * z);
  const m01 = 2 * (x * y - w * z);
  const m02 = 2 * (x * z + w * y);
  const m10 = 2 * (x * y + w * z);
  const m12 = 2 * (y * z - w * x);
  const m20 = 2 * (x * z - w * y);
  const m22 = 1 - 2 * (x * x + y * y);
  const sinY = Math.max(-1, Math.min(1, m02));
  const unwrap = (triple: Vec3): Vec3 => [nearest(triple[0], near[0]), nearest(triple[1], near[1]), nearest(triple[2], near[2])];
  if (Math.abs(sinY) > 1 - 1e-12) {
    // Rz(z) = Ry(y)ᵀ·Rx(x)ᵀ·M, with x kept.
    const ay = Math.sign(sinY) * 90;
    const [cx, sx] = [Math.cos(near[0] * degrees), Math.sin(near[0] * degrees)];
    const a10 = cx * m10 + sx * m20;
    const n00 = -Math.sign(sinY) * (-sx * m10 + cx * m20);
    return unwrap([near[0], ay, Math.atan2(a10, n00) / degrees]);
  }
  const first: Vec3 = [Math.atan2(-m12, m22) / degrees, Math.asin(sinY) / degrees, Math.atan2(-m01, m00) / degrees];
  const [a, b] = [unwrap(first), unwrap([first[0] + 180, 180 - first[1], first[2] + 180])];
  const off = (triple: Vec3) => triple.reduce((sum, value, at) => sum + Math.abs(value - near[at]!), 0);
  return off(a) <= off(b) ? a : b;
}

/**
 * The world-axis triple, nearest `near` axis by axis, of an actor flying along `direction` nose
 * first (heading and pitch from it, no roll) and turned off it by `offset`, an actor's (x, y, z):
 * how a follow path's pathRotationOffset turns it, as Blizzard's write one to stand a rocket
 * modelled nose up along its path (0, 90, 0) or turn a model whose nose is +y (0, 0, −90). The
 * engine turns it by the offset before the path's pitch, in the path's level frame
 * (TestBankOrder, 2026-11-02: a bank offset on a diving path swings the nose off the path rather
 * than rolling about it). Along its path for a direction of no length.
 */
export function pathFacing(direction: Vec3, offset: Vec3, near: Vec3 = [0, 0, 0]): Vec3 {
  const [x, y, z] = direction;
  const flat = Math.hypot(x, y);
  const heading = flat > 1e-9 ? Math.atan2(y, x) / degrees : 0;
  const pitch = flat > 1e-9 || Math.abs(z) > 1e-9 ? Math.atan2(z, flat) / degrees : 0;
  return cleaned(tripleNear(multiply(multiply(quaternionOf(worldFacing({ heading })), quaternionOf(offset)), quaternionOf(worldFacing({ heading: 0, pitch }))), near));
}

/** How far, in degrees, a turn keyed at these triples may stray from the true turn between its keys. */
const TOLERANCE = 0.25;
/** The longest span of a turn, in degrees, before it's checked against the true turn. */
const SPAN = 15;
/** How many points along a span are checked against the true turn, less one. */
const SAMPLES = 16;
/** How many times a span that strays is halved, at most. */
const DEPTH = 10;
/** How far, in degrees, a turn from straight up or down falls behind while it swaps its triple for the one it leaves by. */
const LAG = 0.1;

/** A turn's key between its ends: the world-axis triple it passes, and how far along the turn it is (0 to 1). */
export type TurnKey = { readonly share: number; readonly rotation: Vec3 };

const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const cleaned = (triple: Vec3): Vec3 => [clean(triple[0]), clean(triple[1]), clean(triple[2])];

/**
 * A turn from the world-axis triple `from` to `to` as the engine should key it: the triples it passes
 * on the way, each at its share of the turn (none for a turn the engine already makes about one
 * axis), and where it ends, each axis near the key before so it turns the short way. Keyed at these,
 * each axis straight from key to key, it stays within TOLERANCE of the true turn at each moment: a
 * key every SPAN degrees, and between two that stray, another, halving as far as DEPTH, then only
 * the keys it needs. From
 * straight up or down (y ±90°), where many triples give the one pose, it first swaps `from` for the
 * triple the turn leaves by, which holds the pose, over the moment it takes the turn to go LAG.
 */
export function turnKeys(from: Vec3, to: Vec3): { readonly between: readonly TurnKey[]; readonly end: Vec3 } {
  const [start, finish] = [quaternionOf(from), quaternionOf(to)];
  const angle = apart(start, finish);
  const at = (share: number) => slerp(start, finish, share);
  const locked = Math.abs(Math.sin(from[1] * degrees)) > 1 - 1e-9 && angle > 1e-6;
  // At y ±90° only x ∓ z counts: keep the x the turn leaves by (seen half a degree in), and the z that holds the pose with it.
  const leaving = locked ? tripleNear(start, [tripleNear(at(Math.min(0.5, 0.5 / angle)), from)[0], from[1], from[2]]) : from;
  const keys: TurnKey[] = [{ share: 0, rotation: from }, ...(locked ? [{ share: Math.min(0.5, LAG / angle), rotation: leaving }] : [])];
  const strays = (a: TurnKey, b: TurnKey) =>
    Array.from({ length: SAMPLES - 1 }, (_, step) => (step + 1) / SAMPLES).some((u) => apart(quaternionOf(lerp3(a.rotation, b.rotation, u)), at(a.share + (b.share - a.share) * u)) > TOLERANCE);
  /** The keys after `a` up to and with `b`, halving the span between them while it strays. */
  const refined = (a: TurnKey, b: TurnKey, depth: number): TurnKey[] => {
    if (depth === DEPTH || !strays(a, b)) return [b];
    const share = (a.share + b.share) / 2;
    const middle = { share, rotation: tripleNear(at(share), a.rotation) };
    const near = refined(a, middle, depth + 1);
    // The far half from the near half's last key as written, its end again near that, so it stays on its side.
    const reached = near.at(-1)!;
    return [...near, ...refined(reached, { ...b, rotation: tripleNear(at(b.share), reached.rotation) }, depth + 1)];
  };
  const spans = Math.max(1, Math.ceil(angle / SPAN));
  const first = keys.at(-1)!.share;
  for (let step = 1; step <= spans; step++) {
    const share = first + ((1 - first) * step) / spans;
    keys.push(...refined(keys.at(-1)!, { share, rotation: tripleNear(at(share), keys.at(-1)!.rotation) }, 0));
  }
  // Then leaves out each key the turn stays on the true one without (all of them, for a turn about
  // one axis, as the engine makes it).
  const kept = [keys[0]!];
  keys.slice(1).forEach((key, index) => {
    const next = keys[index + 2];
    if (!next || strays(kept.at(-1)!, next)) kept.push(key);
  });
  return { between: kept.slice(1, -1).map(({ share, rotation }) => ({ share, rotation: cleaned(rotation) })), end: cleaned(keys.at(-1)!.rotation) };
}
