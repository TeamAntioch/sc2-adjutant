// Cliff geometry as the Editor stores it (decoded from Editor 5.0.17 maps; see docs/reference/map-package-findings.md, "Terrain").
//
// The source of truth is the cliff level at every "corner" vertex (both coordinates
// even). A cliff cell covers 2x2 terrain cells; it gets a cliff mesh when its four
// corners differ. Every other cliff-related value is derived from the corners.

/** The highest cliff level: t3SyncCliffLevel holds 16 levels, 0-15, and the Editor paints all of them. */
export const MAX_CLIFF_LEVEL = 15;

/**
 * Height contributed by each cliff level, 0 to {@link MAX_CLIFF_LEVEL}: -8 for the pit, then 2 a
 * level from ground (level 1) at 0 up to 28 at level 15, as the Editor saves them
 * (read from an Editor-saved map that uses every level).
 */
export const CLIFF_HEIGHTS: readonly number[] = Array.from({ length: MAX_CLIFF_LEVEL + 1 }, (_, level) => (level === 0 ? -8 : 2 * (level - 1)));

/** The height a cliff level contributes, refusing a level outside 0 to {@link MAX_CLIFF_LEVEL}. */
export function cliffHeight(level: number): number {
  const height = CLIFF_HEIGHTS[level];
  if (height === undefined) throw new Error(`Cliff level ${level} is outside the Editor's 0 to ${MAX_CLIFF_LEVEL}`);
  return height;
}

/** Ordinary walkable ground. Level 0 is a pit (-8), still walkable on Bel'Shir. */
export const GROUND_LEVEL = 1;

export type CornerGrid = {
  /** Corners per row: width / 2 + 1. */
  readonly columns: number;
  readonly rows: number;
  /** Level at corner vertex (2·cx, 2·cy), index cy·columns + cx. */
  readonly levels: Uint8Array;
};

export function cornerLevel(grid: CornerGrid, cx: number, cy: number): number {
  return grid.levels[cy * grid.columns + cx]!;
}

/**
 * Cliff level of every vertex: corners as given, an edge midpoint takes the max of
 * its two corners, and a cliff cell's centre is high if any side has both corners high.
 */
export function vertexLevels(grid: CornerGrid, width: number, height: number): Uint8Array {
  const levels = new Uint8Array((width + 1) * (height + 1));
  for (let vy = 0; vy <= height; vy++) {
    for (let vx = 0; vx <= width; vx++) {
      const cx = vx >> 1;
      const cy = vy >> 1;
      let level: number;
      if (vx % 2 === 0 && vy % 2 === 0) {
        level = cornerLevel(grid, cx, cy);
      } else if (vx % 2 === 1 && vy % 2 === 0) {
        level = Math.max(cornerLevel(grid, cx, cy), cornerLevel(grid, cx + 1, cy));
      } else if (vx % 2 === 0) {
        level = Math.max(cornerLevel(grid, cx, cy), cornerLevel(grid, cx, cy + 1));
      } else {
        const sw = cornerLevel(grid, cx, cy);
        const se = cornerLevel(grid, cx + 1, cy);
        const nw = cornerLevel(grid, cx, cy + 1);
        const ne = cornerLevel(grid, cx + 1, cy + 1);
        level = Math.max(Math.min(sw, se), Math.min(nw, ne), Math.min(sw, nw), Math.min(se, ne));
      }
      levels[vy * (width + 1) + vx] = level;
    }
  }
  return levels;
}

export type CliffCell = {
  /** cy·(width/2) + cx. */
  readonly index: number;
  /** Mesh variation 0..3, picked pseudo-randomly as the Editor does. */
  readonly variation: number;
  /** <cc f>: 1 = cliff mesh, 2 = part of a ramp. */
  readonly flags: number;
  /** <cc cid>: index into the map's cliff set list; 0 when absent. */
  readonly cliffSet?: number;
};

/** Whether the cliff cell at (cx, cy) of the 2-cell grid wears a cliff mesh: its four corners aren't all at one level. */
export function hasCliffMesh(grid: CornerGrid, cx: number, cy: number): boolean {
  const first = cornerLevel(grid, cx, cy);
  return cornerLevel(grid, cx + 1, cy) !== first || cornerLevel(grid, cx, cy + 1) !== first || cornerLevel(grid, cx + 1, cy + 1) !== first;
}

/** Cliff cells whose corners are not all at one level, in ascending index order. */
export function cliffCells(grid: CornerGrid, seed: number): CliffCell[] {
  const cells: CliffCell[] = [];
  const cellColumns = grid.columns - 1;
  for (let cy = 0; cy < grid.rows - 1; cy++) {
    for (let cx = 0; cx < cellColumns; cx++) {
      if (!hasCliffMesh(grid, cx, cy)) continue;
      const index = cy * cellColumns + cx;
      cells.push({ index, variation: cliffVariation(index, seed), flags: 1 });
    }
  }
  return cells;
}

/**
 * t3SyncCliffLevel per cell: the level held by at least three of the cell's four
 * vertices; for a saddle (one level on one diagonal, another on the other) the higher;
 * otherwise the lowest of them. Editor-saved maps agree on all 50 saddles measured
 * (docs/reference/terrain-checks.md).
 */
export function syncCellLevels(vertexLevel: Uint8Array, width: number, height: number): Uint8Array {
  const levels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (vx: number, vy: number): number => vertexLevel[vy * (width + 1) + vx]!;
      const corners = [at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)];
      const majority = corners.find((level) => corners.filter((other) => other === level).length >= 3);
      const saddle = corners[0] === corners[3] && corners[1] === corners[2] && corners[0] !== corners[1];
      levels[y * width + x] = majority ?? (saddle ? Math.max(...corners) : Math.min(...corners));
    }
  }
  return levels;
}

/** t3CellFlags' ground bit, on every cell. */
export const CELL_FLAG_GROUND = 0x02;
/** t3CellFlags' cliff bit: the cell is unpathable cliff. */
export const CELL_FLAG_CLIFF = 0x01;
/** t3CellFlags' hidden bit: the Editor's Hide Terrain brush, the ground doesn't draw (zone.hiddenCells). */
export const CELL_FLAG_HIDDEN = 0x04;

/**
 * Whether a cell carries the cliff bit (0x01): under a cliff mesh, or, on a map that hides its
 * lowest level, at sync level 0, which is open sky (DL-14), unpathable as the Editor marks it on
 * 3-7 and 3-11. `syncCliff` is the raw t3SyncCliffLevel value (64 per level).
 */
export function isCliffCell(onCliffMesh: boolean, syncCliff: number, hidesLowestLevel: boolean): boolean {
  return onCliffMesh || (hidesLowestLevel && syncCliff === 0);
}

export function cliffVariation(index: number, seed: number): number {
  return hash32(index, seed) % 4;
}

function hash32(value: number, seed: number): number {
  let hash = (value ^ seed) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}
