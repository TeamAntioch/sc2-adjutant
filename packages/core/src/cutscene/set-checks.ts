// A Set's pieces that flicker under a moving camera, found from their models' recorded footprints
// (data/model-footprints.json): the cinematography skill's BUILT-SETS.md rules "Give each
// overlapping flat piece its own height" and "Match overlapping decals exactly". `check-workspace`
// runs them on each Set a Mission's Cinematics place. A model whose footprint isn't recorded isn't
// checked.
//
// How a footprint is read (the heuristics, in FOOTPRINT_RULES):
// - A piece is turned as the engine turns an actor, by its (x, y, z) rotation about the world axes,
//   z first, then y, then x (R = Rx·Ry·Rz), so two ways of writing one orientation are the same.
// - A piece's footprint is its model's bounds in x and y, scaled by its `scale`, turned and seen
//   from above, at its `at`. A model with variations is recorded from its first numbered file, so
//   every variation gets its bounds.
// - Two footprints overlap when they cross by more than `overlapCells` on every axis that could
//   separate them, so pieces that only touch at an edge don't.
// - A model is see-through when every one of its materials blends (a standard material whose blend
//   mode isn't opaque); one solid material, or a terrain, composite or other material, makes it
//   solid. A piece faded below full `opacity` is drawn blended, so it's see-through too.
// - A see-through piece is a decal when it lies on the ground: no taller than `decalHeight` of its
//   footprint's shorter side (a sand drift is about a fifth; a fog card is as tall as it's wide).
// - A solid piece is flat when no taller than `flatHeight` of its footprint's shorter side (a ground
//   plate is about a tenth; a curb or tarmac much less).
// - Two flat pieces lie in one plane when they're turned to within `sameDegrees` of one tilt (level
//   ones at any heading) and their top faces' planes (through the model's top, scaled and turned)
//   are less than `samePlaneCells` apart: the rule's "a few hundredths of a cell". Pieces tilted
//   differently cross along a line instead.
// - Two decals overlap badly when they're of one model and differ in tint, variation or orientation
//   (by more than `sameDegrees`), at any height: separate heights don't stop the re-sort.
// - A model with no extent across the ground (particles only, or a card stood on its edge) has none.
// - Pieces never on screen together aren't compared: a hidden one, and two tied to different shots.

import type { M3Material } from "../catalog/m3-footprint.js";
import type { ModelFootprint, ModelFootprints } from "../catalog/model-footprints.js";
import type { SetData, SetPiece } from "../domain/cinematic-set.js";

export const FOOTPRINT_RULES = {
  overlapCells: 0.01,
  flatHeight: 1 / 8,
  decalHeight: 1 / 4,
  samePlaneCells: 0.02,
  sameDegrees: 0.5,
  /** Tint channels within this are the same. */
  sameTint: 0.005,
} as const;

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];
/** A rotation matrix, by rows. */
type Matrix = readonly [Vec3, Vec3, Vec3];

/** A problem in the Set's file, at a piece. */
export type SetPieceProblem = { readonly path: string; readonly message: string; readonly severity: "warning" };

const BLENDING: ReadonlySet<M3Material> = new Set(["blend", "add", "addAlpha", "mod", "mod2x"]);

/** A piece as the checks see it. */
type Placed = {
  readonly index: number;
  readonly piece: SetPiece;
  readonly kind: "flat" | "decal" | "other";
  /** Its footprint's corners, in order round it. */
  readonly corners: readonly Vec2[];
  readonly turn: Matrix;
  /** Its top face's normal, and a point on it. */
  readonly normal: Vec3;
  readonly top: Vec3;
};

const radians = Math.PI / 180;

/** The engine's turn for an (x, y, z) rotation in degrees: Rx·Ry·Rz. */
function turnOf([x, y, z]: Vec3): Matrix {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x * radians), Math.sin(x * radians), Math.cos(y * radians), Math.sin(y * radians), Math.cos(z * radians), Math.sin(z * radians)];
  return [
    [cy * cz, -cy * sz, sy],
    [sx * sy * cz + cx * sz, cx * cz - sx * sy * sz, -sx * cy],
    [-cx * sy * cz + sx * sz, cx * sy * sz + sx * cz, cx * cy],
  ];
}
const apply = (m: Matrix, [x, y, z]: Vec3): Vec3 => [m[0][0] * x + m[0][1] * y + m[0][2] * z, m[1][0] * x + m[1][1] * y + m[1][2] * z, m[2][0] * x + m[2][1] * y + m[2][2] * z];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function placed(index: number, piece: SetPiece, footprint: ModelFootprint): Placed {
  const scale = typeof piece.scale === "number" ? [piece.scale, piece.scale, piece.scale] : (piece.scale ?? [1, 1, 1]);
  const turn = turnOf(typeof piece.rotation === "number" ? [0, 0, piece.rotation] : (piece.rotation ?? [0, 0, 0]));
  const [xs, ys, zs] = [0, 1, 2].map((axis) => {
    const ends = [footprint.min[axis]! * scale[axis]!, footprint.max[axis]! * scale[axis]!];
    return [Math.min(...ends), Math.max(...ends)] as const;
  }) as [readonly [number, number], readonly [number, number], readonly [number, number]];
  const at = (local: Vec3): Vec3 => {
    const turned = apply(turn, local);
    return [piece.at[0] + turned[0], piece.at[1] + turned[1], piece.at[2] + turned[2]];
  };
  const corners = ([[xs[0], ys[0]], [xs[1], ys[0]], [xs[1], ys[1]], [xs[0], ys[1]]] as const).map(([x, y]): Vec2 => {
    const [cx, cy] = at([x, y, zs[1]]);
    return [cx, cy];
  });
  const height = zs[1] - zs[0];
  const shorter = Math.min(xs[1] - xs[0], ys[1] - ys[0]);
  const seeThrough = (piece.opacity !== undefined && piece.opacity < 1) || (footprint.materials.length > 0 && footprint.materials.every((material) => BLENDING.has(material)));
  // A model with no extent across the ground (particles only, or a card stood on its edge) has no footprint.
  const kind = shorter <= 0 ? "other" : seeThrough ? (height <= FOOTPRINT_RULES.decalHeight * shorter ? "decal" : "other") : height <= FOOTPRINT_RULES.flatHeight * shorter ? "flat" : "other";
  return { index, piece, kind, corners, turn, normal: apply(turn, [0, 0, 1]), top: at([0, 0, zs[1]]) };
}

/** Whether two convex footprints cross by more than FOOTPRINT_RULES.overlapCells on every separating axis. */
function overlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (const shape of [a, b]) {
    for (let at = 0; at < shape.length; at++) {
      const [from, to] = [shape[at]!, shape[(at + 1) % shape.length]!];
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (length === 0) continue;
      const axis: Vec2 = [(from[1] - to[1]) / length, (to[0] - from[0]) / length];
      const span = (points: readonly Vec2[]) => points.map(([x, y]) => x * axis[0] + y * axis[1]);
      const [onA, onB] = [span(a), span(b)];
      if (Math.min(Math.max(...onA), Math.max(...onB)) - Math.max(Math.min(...onA), Math.min(...onB)) <= FOOTPRINT_RULES.overlapCells) return false;
    }
  }
  return true;
}

/** Whether two pieces can be on screen at once. */
const together = (a: SetPiece, b: SetPiece): boolean => !a.hidden && !b.hidden && (!a.shots || !b.shots || a.shots.some((shot) => b.shots!.includes(shot)));

const SAME = Math.cos(FOOTPRINT_RULES.sameDegrees * radians);
/** Whether two pieces' top faces are parallel, to within FOOTPRINT_RULES.sameDegrees. */
const parallel = (a: Placed, b: Placed): boolean => dot(a.normal, b.normal) >= SAME;
/** Whether two pieces are turned to one orientation: each of their axes within FOOTPRINT_RULES.sameDegrees. */
const turnedAlike = (a: Placed, b: Placed): boolean => [0, 1, 2].every((axis) => dot(apply(a.turn, unit(axis)), apply(b.turn, unit(axis))) >= SAME);
const unit = (axis: number): Vec3 => [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];
/** How far apart two parallel top faces' planes are. */
const planesApart = (a: Placed, b: Placed): number => Math.abs(dot(a.normal, [a.top[0] - b.top[0], a.top[1] - b.top[1], a.top[2] - b.top[2]]));

/** What differs between two decals of one model: their tint, variation or rotation. */
function differences(a: Placed, b: Placed): string[] {
  const tint = ({ piece }: Placed) => piece.tint ?? [1, 1, 1];
  return [
    tint(a).some((channel, at) => Math.abs(channel - tint(b)[at]!) > FOOTPRINT_RULES.sameTint) ? "tint" : undefined,
    (a.piece.variation ?? 0) !== (b.piece.variation ?? 0) ? "variation" : undefined,
    turnedAlike(a, b) ? undefined : "rotation",
  ].filter((difference): difference is string => difference !== undefined);
}

const listed = (words: readonly string[]): string => (words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0]!);

/** The Set's flat pieces that overlap in one plane, and its overlapping decals that don't match: a warning at each later piece, naming the earlier ones. */
export function setPieceChecks(set: SetData, footprints: ModelFootprints): SetPieceProblem[] {
  const pieces = set.pieces.flatMap((piece, index) => {
    const footprint = Object.hasOwn(footprints, piece.model) ? footprints[piece.model] : undefined;
    const found = footprint ? placed(index, piece, footprint) : undefined;
    return found && found.kind !== "other" ? [found] : [];
  });
  const problems: SetPieceProblem[] = [];
  pieces.forEach((later, at) => {
    const clashes = pieces.slice(0, at).filter((earlier) => earlier.kind === later.kind && together(earlier.piece, later.piece) && overlap(earlier.corners, later.corners));
    if (later.kind === "flat") {
      // Rounded to a thousandth, so tops set exactly 0.02 apart are apart, whatever the sums' rounding.
      const fighting = clashes.filter((earlier) => parallel(earlier, later) && Math.round(planesApart(earlier, later) * 1000) < FOOTPRINT_RULES.samePlaneCells * 1000);
      if (!fighting.length) return;
      const others = listed(fighting.map((earlier) => `pieces.${earlier.index} (${earlier.piece.model})`));
      problems.push({
        path: `pieces.${later.index}`,
        message: `${later.piece.model} overlaps ${others} at one height (z ${later.top[2].toFixed(2)}): flat pieces that do z-fight and flicker under a moving camera, so set it a few hundredths of a cell higher or lower`,
        severity: "warning",
      });
    } else {
      const sorting = clashes.filter((earlier) => earlier.piece.model === later.piece.model).map((earlier) => ({ earlier, differ: differences(earlier, later) })).filter(({ differ }) => differ.length);
      if (!sorting.length) return;
      const differ = ["tint", "variation", "rotation"].filter((what) => sorting.some((clash) => clash.differ.includes(what)));
      problems.push({
        path: `pieces.${later.index}`,
        message: `${later.piece.model}, see-through, overlaps ${listed(sorting.map(({ earlier }) => `pieces.${earlier.index}`))} with a different ${listed(differ)}: overlapping decals re-sort every frame and flicker as the camera moves, so give them the same tint, variation and rotation, and darken only solid pieces`,
        severity: "warning",
      });
    }
  });
  return problems;
}
