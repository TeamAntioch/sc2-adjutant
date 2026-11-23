// Terraces: the game draws a cliff one level high, so a generated map's ground never climbs two
// levels between neighbouring cells (diagonal neighbours too). Where a Zone's ground meets ground
// two or more levels above or below it (backdrop rock bands drawn against each other, a floor
// against rock two levels up), a jump renders as a solid black square in game. The compile steps
// the rock between them down (or up) a level at a time, with a terrace at least TERRACE_WIDTH
// cells wide between storeys, and leaves the floors, ramps and bridges as the Blueprint drew them.
//
// It works on the 2-cell corner grid, the cliffs' source of truth (cliffs.ts): every cliff cell,
// cliff set, sync level, texture, height and doodad is derived from the corners afterwards.

import type { CornerGrid } from "./cliffs.js";

/**
 * The narrowest terrace between two storeys of terraced rock, in cells: ground two levels apart
 * is at least this many cells plus one apart. 2 is one cliff cell, the finest the corner grid
 * draws, so storeys of rock climb a cliff cell at a time.
 */
export const TERRACE_WIDTH = 2;

/** How many levels ground may climb over `distance` corners (2·distance cells, Chebyshev). */
export function allowedClimb(distance: number, width = TERRACE_WIDTH): number {
  return 1 + Math.floor((2 * distance - 1) / width);
}

export type TerraceResult = {
  /** Corners whose level the terraces moved. */
  readonly movedCorners: number;
};

/**
 * Moves every corner not in `fixed` toward its neighbours, in place, until no two corners climb
 * more than {@link allowedClimb} levels over their distance: lowered toward lower ground around
 * it, and raised only where a fixed corner (a floor) sits too far above it. Fixed corners don't
 * move, so two floors drawn too close in level stay as they are (count what's left with
 * {@link cellJumps}).
 *
 * The result is the highest levels at or under the drawn ones (floors aside) that meet the rule,
 * whatever order the corners are visited in, so a symmetric map stays symmetric.
 */
export function terraceCorners(grid: CornerGrid, fixed: Uint8Array, width = TERRACE_WIDTH): TerraceResult {
  const { columns, rows, levels } = grid;
  const radius = Math.ceil(width / 2) + 1;
  const offsets: { dx: number; dy: number; climb: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx !== 0 || dy !== 0) offsets.push({ dx, dy, climb: allowedClimb(Math.max(Math.abs(dx), Math.abs(dy)), width) });
    }
  }
  const before = levels.slice();
  // The floor under each corner: a fixed corner holds its level, and a corner near one can't sit
  // more than its reach below it, nor the rock round that corner below that, and so on.
  const floor = new Int16Array(levels.length).fill(-1);
  for (let index = 0; index < levels.length; index++) if (fixed[index]) floor[index] = levels[index]!;
  const reach = (update: (index: number, cx: number, cy: number) => boolean): void => {
    let changed = true;
    while (changed) {
      changed = false;
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < columns; cx++) if (!fixed[cy * columns + cx] && update(cy * columns + cx, cx, cy)) changed = true;
    }
  };
  const around = (cx: number, cy: number, visit: (other: number, climb: number) => void): void => {
    for (const { dx, dy, climb } of offsets) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && y >= 0 && x < columns && y < rows) visit(y * columns + x, climb);
    }
  };
  reach((index, cx, cy) => {
    let low = floor[index]!;
    around(cx, cy, (other, climb) => (low = Math.max(low, floor[other]! - climb)));
    if (low <= floor[index]!) return false;
    floor[index] = low;
    return true;
  });
  for (let index = 0; index < levels.length; index++) if (levels[index]! < floor[index]!) levels[index] = floor[index]!;
  // Then each corner comes down to within reach of the corners round it, down to its floor.
  reach((index, cx, cy) => {
    let high = levels[index]!;
    around(cx, cy, (other, climb) => (high = Math.min(high, levels[other]! + climb)));
    const level = Math.max(high, floor[index]!);
    if (level >= levels[index]!) return false;
    levels[index] = level;
    return true;
  });
  let movedCorners = 0;
  for (let index = 0; index < levels.length; index++) if (levels[index] !== before[index]) movedCorners++;
  return { movedCorners };
}

/**
 * Neighbouring cell pairs (across, up and diagonal) whose whole sync levels differ by two or more:
 * the cliffs the game can't draw. `syncCliff` is t3SyncCliffLevel (64 a level); ramp cells (between
 * levels) and cells `skip` marks don't count.
 */
export function cellJumps(syncCliff: Uint16Array, width: number, height: number, skip?: (cell: number) => boolean): number {
  const whole = (cell: number): boolean => syncCliff[cell]! % 64 === 0 && !skip?.(cell);
  let jumps = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      if (!whole(cell)) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny >= height) continue;
        const other = ny * width + nx;
        if (whole(other) && Math.abs(syncCliff[cell]! - syncCliff[other]!) >= 128) jumps++;
      }
    }
  }
  return jumps;
}
