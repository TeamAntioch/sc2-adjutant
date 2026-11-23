// Straight and diagonal ramps, stamped exactly as Editor 5.0.17 writes its default ramps
// (decoded from an Editor-edited generated map; see tests/fixtures/editor-terrain/ramps).
//
// A ramp sits on the low side of a high zone's edge and climbs exactly one cliff level.
// Vertex cliff levels (r2) are unchanged; only the cliff-height layer, sync cliff levels,
// cell flags and the cliff cells' ramp flag change, plus a <ramp> element in t3Terrain.xml.
//
// Straight: 2 cliff cells deep (along the uphill vector u) by 4 wide (along r, the
// right-hand vector when facing uphill), in the middle of a straight edge.
//
// Diagonal: the Editor's wide diagonal ramp, cut across a high zone's corner (a 45° edge
// with the cliff turning straight on either side; Blizzard's maps cut it the same way). It
// blends into the cliffs beside it, so it's stamped from the Editor's values for exactly
// that corner shape, and the compiler moves corners to make the shape (rampContext). The
// four directions are one template rotated: 200 ramps in Blizzard's and Editor-saved maps agree.
//
// Narrow diagonal: the ladder main ramp (melee research §2 "Main ramp"), the narrowest of the
// Editor's diagonal ramps: its top edge √2 wide, 15 cells of slope in a 5×5 box, 3 cells of the
// main opening onto it. Its base sits on an odd vertex, the middle of a cliff cell, on all 54
// narrow diagonal ramps of the 21 ladder maps. Decoded from Ephemeron LE as the Editor saved it
// (a components test map); the sync cliff levels match
// the ladder maps' main ramps cell for cell.

import { CLIFF_HEIGHTS, type CornerGrid, cornerLevel } from "./cliffs.js";

/** Uphill: 0 south (-y), 1 north (+y), 2 west (-x), 3 east (+x), 4 south-west, 5 south-east, 6 north-west, 7 north-east. */
export type RampDirection = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Ramp = {
  /** Blueprint ramp id, or "<high zone>-<low zone>" for one generated from a ramp connection. */
  readonly id?: string;
  readonly direction: RampDirection;
  /**
   * Corner vertex at the top of the ramp lane: on the high zone's edge for a straight ramp, the
   * Editor's `base` for a diagonal one.
   */
  readonly edge: { readonly x: number; readonly y: number };
  readonly lowLevel: number;
  /** A diagonal ramp's narrow form: the ladder main ramp, with its base on an odd vertex. */
  readonly narrow?: true;
  /** <ramp cid>: index into the map's cliff set list; 0 when absent. */
  readonly cliffSet?: number;
};

type Vec = { readonly x: number; readonly y: number };

/** The diagonal ramp's uphill directions: south-west, south-east, north-west, north-east. */
export type DiagonalDirection = 4 | 5 | 6 | 7;
export const isDiagonal = (direction: RampDirection): direction is DiagonalDirection => direction >= 4;

/** Uphill and right-hand vectors per straight direction, written as the Editor writes them (including -0). */
const AXES: Record<0 | 1 | 2 | 3, { readonly u: Vec; readonly r: Vec; readonly text: string }> = {
  0: { u: { x: 0, y: -1 }, r: { x: -1, y: 0 }, text: "u(0.000000e+00, -1.000000e+00) r(-1.000000e+00, 0.000000e+00)" },
  1: { u: { x: 0, y: 1 }, r: { x: 1, y: 0 }, text: "u(-0.000000e+00, 1.000000e+00) r(1.000000e+00, 0.000000e+00)" },
  2: { u: { x: -1, y: 0 }, r: { x: 0, y: 1 }, text: "u(-1.000000e+00, 0.000000e+00) r(0.000000e+00, 1.000000e+00)" },
  3: { u: { x: 1, y: 0 }, r: { x: 0, y: -1 }, text: "u(1.000000e+00, -0.000000e+00) r(-0.000000e+00, -1.000000e+00)" },
};

/**
 * Fraction of the level's height gained at each vertex, indexed by distance from
 * the lane centre (|b| = 0..4) and then steps uphill from the low edge (0..4).
 */
const RISE: readonly (readonly number[])[] = [
  [0, 0.25, 0.5, 0.75, 1],
  [0, 0.25, 0.5, 0.75, 1],
  [0, 0.25, 0.5, 0.75, 1],
  [0, 0.125, 0.25, 0.625, 1],
  [0, 0, 0, 0.5, 1],
];

const at = (edge: Vec, axes: { u: Vec; r: Vec }, a: number, b: number): Vec => ({
  x: edge.x + axes.u.x * a + axes.r.x * b,
  y: edge.y + axes.u.y * a + axes.r.y * b,
});

/** Turns an offset in the north-east frame (dir 7) into the given diagonal direction's. */
function rotate(direction: RampDirection, x: number, y: number): Vec {
  switch (direction) {
    case 6:
      return { x: -y, y: x };
    case 5:
      return { x: y, y: -x };
    case 4:
      return { x: -x, y: -y };
    default:
      return { x, y };
  }
}

/** A diagonal ramp's vertex offset from its base, in the north-east ramp's frame turned to the ramp's direction. */
export const diagonalVertex = (ramp: Ramp, x: number, y: number): Vec => {
  const d = rotate(ramp.direction, x, y);
  return { x: ramp.edge.x + d.x, y: ramp.edge.y + d.y };
};

/** The lower-left corner of a cell (or a 2×2 cliff cell, size 2) at an offset from the base, rotated. */
const diagonalCell = (ramp: Ramp, x: number, y: number, size = 1): Vec => {
  const centre = rotate(ramp.direction, x + size / 2, y + size / 2);
  return { x: ramp.edge.x + centre.x - size / 2, y: ramp.edge.y + centre.y - size / 2 };
};

// The north-east diagonal ramp, from the base, as the Editor wrote it on our generated
// Octagon (tests/fixtures/editor-terrain/ramps, base (92,56)): what differs from plain cliffs.
/** [x, y, fraction of the level gained] per vertex. */
const DIAGONAL_RISE: readonly (readonly [number, number, number])[] = [
  [-3, -5, 0.0625], [-2, -5, 0.125], [-1, -5, 0.1875], [0, -5, 0.25], [1, -5, 0.125],
  [-3, -4, 0.125], [-2, -4, 0.25], [-1, -4, 0.375], [0, -4, 0.5], [1, -4, 0.25],
  [-5, -3, 0.0625], [-4, -3, 0.125], [-3, -3, 0.25], [-2, -3, 0.375], [-1, -3, 0.5], [0, -3, 0.625], [1, -3, 0.5625], [2, -3, 0.5],
  [-5, -2, 0.125], [-4, -2, 0.25], [-3, -2, 0.375], [-2, -2, 0.5], [-1, -2, 0.625], [0, -2, 0.75], [1, -2, 0.875],
  [-5, -1, 0.1875], [-4, -1, 0.375], [-3, -1, 0.5], [-2, -1, 0.625], [-1, -1, 0.75], [0, -1, 0.875], [1, -1, 0.9375],
  [-5, 0, 0.25], [-4, 0, 0.5], [-3, 0, 0.625], [-2, 0, 0.75], [-1, 0, 0.875],
  [-5, 1, 0.125], [-4, 1, 0.25], [-3, 1, 0.5625], [-2, 1, 0.875], [-1, 1, 0.9375],
  [-3, 2, 0.5],
];
/** [x, y, sync cliff level above the low level's] per cell, by its lower-left corner. */
const DIAGONAL_SYNC: readonly (readonly [number, number, number])[] = [
  [-2, -6, 8], [-3, -5, 8], [-2, -5, 16], [-1, -5, 24], [-4, -4, 8], [-3, -4, 16], [-2, -4, 24], [-1, -4, 32], [0, -4, 40],
  [-5, -3, 8], [-4, -3, 16], [-3, -3, 24], [-2, -3, 32], [-1, -3, 40], [0, -3, 48],
  [-6, -2, 8], [-5, -2, 16], [-4, -2, 24], [-3, -2, 32], [-2, -2, 40], [-1, -2, 48],
  [-5, -1, 24], [-4, -1, 32], [-3, -1, 40], [-2, -1, 48], [-4, 0, 40], [-3, 0, 48],
];
/** [x, y, flags] per cell. */
const DIAGONAL_FLAGS: readonly (readonly [number, number, number])[] = [
  [-2, -6, 3], [-1, -6, 3], [0, -6, 3], [1, -6, 3], [-2, -5, 3], [-1, -5, 3], [0, -5, 3], [1, -5, 3],
  [-6, -2, 3], [-5, -2, 3], [-6, -1, 3], [-5, -1, 3], [-6, 0, 3], [-5, 0, 3], [-6, 1, 3], [-5, 1, 3],
  [-2, -2, 2], [-1, -2, 2], [0, -2, 2], [1, -2, 2], [-2, -1, 2], [-1, -1, 2], [0, -1, 2], [1, -1, 2],
  [-2, 0, 2], [-1, 0, 2], [-2, 1, 2], [-1, 1, 2],
];
/** Cliff cells (lower-left corners) marked as ramp. */
const DIAGONAL_RAMP_CELLS: readonly (readonly [number, number])[] = [
  [-4, -6], [-2, -6], [0, -6], [-6, -4], [-4, -4], [-2, -4], [0, -4], [-6, -2], [-4, -2], [-2, -2], [0, -2], [-6, 0], [-4, 0], [-2, 0],
];
/** The corner shape the template was written for: high on the cut corner, within this many cells. */
const DIAGONAL_CONTEXT_REACH = { min: -8, max: 6 };
const diagonalHigh = (x: number, y: number): boolean => x >= -4 && y >= -4 && x + y >= 0;

// The narrow diagonal ramp, north-east frame, from the base: Ephemeron LE's south-west main ramp
// (base (125,37)) turned. What differs from plain cliffs, as above.
/** [x, y, fraction of the level gained] per vertex. */
const NARROW_RISE: readonly (readonly [number, number, number])[] = [
  [-3, -4, 0.125], [-2, -4, 0.25],
  [-4, -3, 0.125], [-3, -3, 0.25], [-2, -3, 0.375], [-1, -3, 0.5],
  [-4, -2, 0.25], [-3, -2, 0.375], [-2, -2, 0.5], [-1, -2, 0.625], [0, -2, 0.75],
  [-3, -1, 0.5], [-2, -1, 0.625], [-1, -1, 0.75], [0, -1, 0.875],
  [-2, 0, 0.75], [-1, 0, 0.875],
];
/** Vertices beside the ramp's top corners, midway down a cliff edge, that the Editor puts on the low level. */
const NARROW_LOWERED: readonly (readonly [number, number])[] = [
  [1, -2],
  [-2, 1],
];
/** [x, y, sync cliff level above the low level's] per cell, by its lower-left corner: the 15 cells of slope. */
const NARROW_SYNC: readonly (readonly [number, number, number])[] = [
  [-3, -1, 40], [-2, -1, 48],
  [-4, -2, 24], [-3, -2, 32], [-2, -2, 40], [-1, -2, 48],
  [-5, -3, 8], [-4, -3, 16], [-3, -3, 24], [-2, -3, 32], [-1, -3, 40],
  [-4, -4, 8], [-3, -4, 16], [-2, -4, 24],
  [-3, -5, 8],
];
/** The ramp's 3×3 cliff cells (lower-left corners), all marked as ramp: the lane down the diagonal, the sides either side. */
const NARROW_RAMP_CELLS: readonly (readonly [number, number])[] = [-5, -3, -1].flatMap((y) => [-5, -3, -1].map((x) => [x, y] as const));
/** The corner shape it's stamped for, on the odd offsets the 2-cell grid has round an odd base. */
const NARROW_CONTEXT_REACH = { min: -7, max: 3 };
const narrowHigh = (x: number, y: number): boolean => x >= -3 && y >= -3 && x + y >= 0;

/** Each piece's u/r text per diagonal direction: the lower side pieces are axis-aligned. */
const DIAGONAL_TEXT: Record<4 | 5 | 6 | 7, { readonly side: string; readonly lane: string }> = {
  4: { side: "u(0.000000e+00, -1.000000e+00) r(-1.000000e+00, 0.000000e+00)", lane: "u(-7.071068e-01, -7.071068e-01) r(-7.071068e-01, 7.071068e-01)" },
  5: { side: "u(1.000000e+00, 0.000000e+00) r(0.000000e+00, -1.000000e+00)", lane: "u(7.071068e-01, -7.071068e-01) r(-7.071068e-01, -7.071068e-01)" },
  6: { side: "u(-1.000000e+00, 0.000000e+00) r(0.000000e+00, 1.000000e+00)", lane: "u(-7.071068e-01, 7.071068e-01) r(7.071068e-01, 7.071068e-01)" },
  7: { side: "u(0.000000e+00, 1.000000e+00) r(1.000000e+00, 0.000000e+00)", lane: "u(7.071068e-01, 7.071068e-01) r(7.071068e-01, -7.071068e-01)" },
};

/** The ramp's footprint and its uphill arrow, in map coordinates (from = its foot). */
export function rampOutline(ramp: Ramp): { readonly corners: readonly Vec[]; readonly from: Vec; readonly to: Vec } {
  if (isDiagonal(ramp.direction) && ramp.narrow) {
    return {
      corners: [diagonalVertex(ramp, -1, 1), diagonalVertex(ramp, 1, -1), diagonalVertex(ramp, -3, -5), diagonalVertex(ramp, -5, -3)],
      from: diagonalVertex(ramp, -4, -4),
      to: diagonalVertex(ramp, 1, 1),
    };
  }
  if (isDiagonal(ramp.direction)) {
    return {
      corners: [diagonalVertex(ramp, -2, 2), diagonalVertex(ramp, 2, -2), diagonalVertex(ramp, -2, -6), diagonalVertex(ramp, -6, -2)],
      from: diagonalVertex(ramp, -4, -4),
      to: diagonalVertex(ramp, 1, 1),
    };
  }
  const axes = AXES[ramp.direction as 0 | 1 | 2 | 3];
  return {
    corners: [at(ramp.edge, axes, -4, -4), at(ramp.edge, axes, 0, -4), at(ramp.edge, axes, 0, 4), at(ramp.edge, axes, -4, 4)],
    from: at(ramp.edge, axes, -4, 0),
    to: at(ramp.edge, axes, 1, 0),
  };
}

/** A corner (on the 2-cell grid, map coordinates) and the level the ramp needs there. */
export type ContextCorner = { readonly x: number; readonly y: number; readonly level: number; readonly high: boolean };

/**
 * The corner levels a ramp needs: a straight edge one level up with flat ground below it, or
 * for a diagonal ramp the cut corner it was decoded on.
 */
export function rampContext(ramp: Ramp): ContextCorner[] {
  const corner = (point: Vec, high: boolean): ContextCorner => ({ ...point, high, level: ramp.lowLevel + (high ? 1 : 0) });
  if (isDiagonal(ramp.direction)) {
    const [reach, high] = ramp.narrow ? [NARROW_CONTEXT_REACH, narrowHigh] : [DIAGONAL_CONTEXT_REACH, diagonalHigh];
    const corners: ContextCorner[] = [];
    for (let y = reach.min; y <= reach.max; y += 2) {
      for (let x = reach.min; x <= reach.max; x += 2) {
        corners.push(corner(diagonalVertex(ramp, x, y), high(x, y)));
      }
    }
    return corners;
  }
  const axes = AXES[ramp.direction as 0 | 1 | 2 | 3];
  const corners: ContextCorner[] = [];
  for (let b = -4; b <= 4; b += 2) {
    corners.push(corner(at(ramp.edge, axes, 0, b), true));
    for (const a of [-2, -4]) corners.push(corner(at(ramp.edge, axes, a, b), false));
  }
  return corners;
}

/** Checks the ramp fits as the corners stand: its context corners on the map and at their levels. */
export function validateRamp(ramp: Ramp, corners: CornerGrid): void {
  // A ramp spans one Editor cliff level. Ground (level 1) down to the level-0 pit (-8)
  // counts as more than one in the Editor, which refuses that ramp.
  if (ramp.lowLevel < 1) throw new Error("A ramp can't reach a level-0 pit from ground: the drop is more than one Editor level");
  for (const context of rampContext(ramp)) {
    if (context.x % 2 !== 0 || context.y % 2 !== 0) throw new Error(`Ramp corner (${context.x},${context.y}) is not on the 2-cell grid`);
    const cx = context.x / 2;
    const cy = context.y / 2;
    if (cx < 0 || cy < 0 || cx >= corners.columns || cy >= corners.rows) {
      throw new Error(`Ramp at (${ramp.edge.x},${ramp.edge.y}) runs off the map`);
    }
    const level = cornerLevel(corners, cx, cy);
    if (level === context.level) continue;
    if (isDiagonal(ramp.direction)) {
      throw new Error(`Ramp at (${ramp.edge.x},${ramp.edge.y}) needs a corner cut diagonally from level ${ramp.lowLevel + 1} to ${ramp.lowLevel}; found level ${level} at (${context.x},${context.y})`);
    }
    throw new Error(
      context.high
        ? `Ramp at (${ramp.edge.x},${ramp.edge.y}) needs a straight edge one level up; found level ${level}`
        : `Ramp at (${ramp.edge.x},${ramp.edge.y}) needs flat level-${ramp.lowLevel} ground below it; found ${level}`,
    );
  }
}

export type RampTerrain = {
  readonly width: number;
  readonly height: number;
  /** t3HeightMap r1 per vertex. */
  readonly cliffHeights: Float32Array;
  /** Raw t3SyncCliffLevel value per cell (64 per level). */
  readonly syncCliff: Uint16Array;
  readonly cellFlags: Uint8Array;
  /** Cliff cell index -> f flags (1 cliff, 2 ramp). */
  readonly cliffCellFlags: Map<number, number>;
  /** t3HeightMap r2 per vertex: the narrow ramp lowers two beside its top. */
  readonly vertexCliffLevels?: Uint8Array;
};

/** Stamps one validated ramp into the derived terrain layers. */
export function stampRamp(ramp: Ramp, terrain: RampTerrain): void {
  const { width } = terrain;
  const lowHeight = CLIFF_HEIGHTS[ramp.lowLevel]!;
  const highHeight = CLIFF_HEIGHTS[ramp.lowLevel + 1]!;
  const low = 64 * ramp.lowLevel;

  if (isDiagonal(ramp.direction) && ramp.narrow) {
    for (const [x, y, rise] of NARROW_RISE) {
      const vertex = diagonalVertex(ramp, x, y);
      terrain.cliffHeights[vertex.y * (width + 1) + vertex.x] = lowHeight + rise * (highHeight - lowHeight);
    }
    for (const [x, y] of NARROW_LOWERED) {
      const vertex = diagonalVertex(ramp, x, y);
      const index = vertex.y * (width + 1) + vertex.x;
      terrain.cliffHeights[index] = lowHeight;
      if (terrain.vertexCliffLevels) terrain.vertexCliffLevels[index] = ramp.lowLevel;
    }
    for (const [x, y, level] of NARROW_SYNC) {
      const cell = diagonalCell(ramp, x, y);
      terrain.syncCliff[cell.y * width + cell.x] = low + level;
    }
    for (const [x, y] of NARROW_RAMP_CELLS) {
      // The lane's cliff cells are open ground, the sides' under the cliff mesh (0x02 and 0x03, as on the wide ramp).
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const cell = diagonalCell(ramp, x + dx, y + dy);
        terrain.cellFlags[cell.y * width + cell.x] = x === y ? 0x02 : 0x03;
      }
      const cliff = diagonalCell(ramp, x, y, 2);
      terrain.cliffCellFlags.set((cliff.y >> 1) * (width / 2) + (cliff.x >> 1), 2);
    }
    return;
  }
  if (isDiagonal(ramp.direction)) {
    for (const [x, y, rise] of DIAGONAL_RISE) {
      const vertex = diagonalVertex(ramp, x, y);
      terrain.cliffHeights[vertex.y * (width + 1) + vertex.x] = lowHeight + rise * (highHeight - lowHeight);
    }
    for (const [x, y, level] of DIAGONAL_SYNC) {
      const cell = diagonalCell(ramp, x, y);
      terrain.syncCliff[cell.y * width + cell.x] = low + level;
    }
    for (const [x, y, flags] of DIAGONAL_FLAGS) {
      const cell = diagonalCell(ramp, x, y);
      terrain.cellFlags[cell.y * width + cell.x] = flags;
    }
    for (const [x, y] of DIAGONAL_RAMP_CELLS) {
      const cell = diagonalCell(ramp, x, y, 2);
      terrain.cliffCellFlags.set((cell.y >> 1) * (width / 2) + (cell.x >> 1), 2);
    }
    return;
  }

  const axes = AXES[ramp.direction as 0 | 1 | 2 | 3];
  for (let a = -4; a <= 0; a++) {
    for (let b = -4; b <= 4; b++) {
      const vertex = at(ramp.edge, axes, a, b);
      const rise = RISE[Math.abs(b)]![a + 4]!;
      terrain.cliffHeights[vertex.y * (width + 1) + vertex.x] = lowHeight + rise * (highHeight - lowHeight);
    }
  }

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 8; j++) {
      const p1 = at(ramp.edge, axes, -4 + i, -4 + j);
      const p2 = at(ramp.edge, axes, -3 + i, -3 + j);
      const x = Math.min(p1.x, p2.x);
      const y = Math.min(p1.y, p2.y);
      const side = j === 0 || j === 7;
      terrain.syncCliff[y * width + x] = side ? (i === 3 ? low + 64 : low) : [low + 8, low + 24, low + 40, low + 64][i]!;
      terrain.cellFlags[y * width + x] = j <= 1 || j >= 6 ? 0x03 : 0x02;
      terrain.cliffCellFlags.set((y >> 1) * (width / 2) + (x >> 1), 2);
    }
  }
}

function formatExponent(value: number): string {
  return value.toExponential(6).replace(/e([+-])(\d)$/, "e$10$2");
}

/** The <ramp> element; piece centres are in cell coordinates, sizes in cliff cells. */
export function rampXml(ramp: Ramp): string {
  const none = "u(0.000000e+00, 0.000000e+00) r(0.000000e+00, 0.000000e+00) c=(0.000000e+00, 0.000000e+00) w=0.000000e+00 h=0.000000e+00";
  const element = (pieces: { leftLo: string; rightLo: string; base: string; mid: string }): string =>
    `<ramp dir="${ramp.direction}" hi="${ramp.lowLevel + 1}" lo="${ramp.lowLevel}"` +
    ` leftLo="${pieces.leftLo}" leftHi="${none}" rightLo="${pieces.rightLo}" rightHi="${none}"` +
    ` base="${pieces.base}" mid="${pieces.mid}"` +
    ` cid="${ramp.cliffSet ?? 0}" leftLoVar="0" leftHiVar="4294967295" rightLoVar="0" rightHiVar="4294967295"/>`;
  const piece = (text: string, centre: Vec, w: number, h: number): string =>
    `${text} c=(${formatExponent(centre.x)}, ${formatExponent(centre.y)}) w=${formatExponent(w)} h=${formatExponent(h)}`;

  if (isDiagonal(ramp.direction) && ramp.narrow) {
    const text = DIAGONAL_TEXT[ramp.direction];
    return element({
      leftLo: piece(text.side, diagonalVertex(ramp, -3, -1), 2, 2),
      rightLo: piece(text.side, diagonalVertex(ramp, -1, -3), 2, 2),
      base: piece(text.lane, diagonalVertex(ramp, 0, 0), Math.SQRT2, 0),
      mid: piece(text.lane, diagonalVertex(ramp, -2, -2), Math.SQRT2, 2 * Math.SQRT2),
    });
  }
  if (isDiagonal(ramp.direction)) {
    const text = DIAGONAL_TEXT[ramp.direction as 4 | 5 | 6 | 7];
    const lane = 2 * Math.SQRT2;
    return element({
      leftLo: piece(text.side, diagonalVertex(ramp, -4, 0), 2, 2),
      rightLo: piece(text.side, diagonalVertex(ramp, 0, -4), 2, 2),
      base: piece(text.lane, diagonalVertex(ramp, 0, 0), lane, 0),
      mid: piece(text.lane, diagonalVertex(ramp, -2, -2), lane, lane),
    });
  }
  const axes = AXES[ramp.direction as 0 | 1 | 2 | 3];
  return element({
    leftLo: piece(axes.text, at(ramp.edge, axes, -2, -3), 1, 2),
    rightLo: piece(axes.text, at(ramp.edge, axes, -2, 3), 1, 2),
    base: piece(axes.text, at(ramp.edge, axes, -1, 0), 4, 1),
    mid: piece(axes.text, at(ramp.edge, axes, -2, 0), 2, 2),
  });
}
