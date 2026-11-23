// The melee distance report's measuring (#216, spec #212): worker seconds between a two-spawn
// map's mains, naturals, thirds and main-ramp tops, rocks up and rocks down, and air against
// ground. A port of the script that measured Blizzard's ladder maps, which reproduced
// Liquipedia's rush distances within about 1.5 s:
//
// - The pathing grid: cells inside the playable bounds with no painted no-pathing
//   (CellAttribute_Pnp 0), less mineral, geyser and rock footprints. Doodads aren't modelled.
// - Dijkstra, 8-connected (a diagonal costs √2) with no corner cutting, stepping only between cells
//   whose sync cliff values differ by less than a level (64): ramps step 8 a cell, cliffs 64.
// - A start's walk begins at the passable cell nearest a point 3.5 cells below its town hall.
// - Seconds are cells ÷ 3.9375, a worker's speed at Faster (2.8125 × 1.4). The Mission checker's
//   3.15 (layout/layout-model.ts) is a different clock, for Missions.

import type { Point } from "../terrain/rasterize.js";
import { isGeyser, type ResourceFootprint, resourceCells } from "./melee-bases.js";

/** A worker's speed in cells per real second at Faster: Probe, SCV and Drone 2.8125 × 1.4. */
export const WORKER_SPEED = 3.9375;

/** The ground a melee map's distances are measured on: the compiled terrain's grids, by cell. */
export type MeleeGround = {
  readonly width: number;
  readonly height: number;
  /** Playable bounds [left, bottom, right, top]: nothing outside them is walked. */
  readonly bounds: readonly [number, number, number, number];
  /** t3SyncCliffLevel per cell: 64 a level, in between on ramps. */
  readonly syncCliff: ArrayLike<number>;
  /** The Editor's painted no-pathing (CellAttribute_Pnp) per cell: non-zero blocks. */
  readonly noPathing: ArrayLike<number>;
  /** Minerals, geysers and rocks, whose footprints block; any other unit (a plate) doesn't. */
  readonly units: readonly ResourceFootprint[];
};

export type MeleeMeasureInput = MeleeGround & {
  /** Each spawn's town-hall centre: Player 1's first. */
  readonly starts: readonly Point[];
  /** Every resource base's town-hall centre, mains included. */
  readonly bases: readonly { readonly id: string; readonly hall: Point }[];
};

/** A ground time; `rocksDown` only where killing the rocks changes it. */
export type GroundTime = { readonly seconds: number; readonly rocksDown?: number };

/** From Player 1's main to another base, and how far that is by air from Player 2's main. */
export type BaseDistance = { readonly base: string; readonly ground: GroundTime };

export type AirVsGround = {
  /** The early base: a main, natural or third. */
  readonly base: string;
  /** From the other spawn's town hall. */
  readonly air: number;
  readonly ground: number;
  /** Air over ground, unrounded. */
  readonly ratio: number;
};

export type MainRampMeasure = {
  /** The main-edge cell at the ramp's top, on the shortest walk between the starts. */
  readonly top: Point;
  readonly rampCells: number;
  /** The ramp's cells' bounding box: [left, bottom, right, top], inclusive. */
  readonly rampBox: readonly [number, number, number, number];
  /** Main-edge cells opening onto the ramp. */
  readonly topEdgeCells: number;
  /** The main's plateau: its cells of the start's level, flood-filled. */
  readonly mainCells: number;
};

export type MeleeDistances = {
  readonly mainToMain: { readonly ground: GroundTime; readonly air: number };
  /** Top of Player 1's main ramp to the top of Player 2's: Liquipedia's rush distance. */
  readonly rampToRamp?: GroundTime;
  readonly naturalToNatural?: GroundTime;
  /** Player 1's nearest base by ground. */
  readonly mainToNatural?: BaseDistance;
  /** Player 1's second-nearest base: the third. */
  readonly mainToThird?: BaseDistance;
  /** Player 1's third-nearest: the other candidate third. */
  readonly secondThird?: BaseDistance;
  /** Each player's main, natural and third, from the other's main. */
  readonly airVsGround: readonly AirVsGround[];
  /** Each spawn's main ramp, Player 1's first. Undefined where the main has no ramp off it. */
  readonly mains: readonly (MainRampMeasure | undefined)[];
};

/** Rocks, debris and towers whose footprints block a ground path until they're killed (measure.py BLOCKING_ROCK). */
const BLOCKING_ROCK = /^Destructible(Rock|Debris|CityDebris|Ramp)|^Debris2x2|^XelNagaTower/;
export const isBlockingRock = (unitType: string): boolean => BLOCKING_ROCK.test(unitType);

/** A mineral field or geyser, any skin: its footprint blocks a ground path. */
export const isResource = (unitType: string): boolean => isGeyser(unitType) || unitType.includes("MineralField");

/** Where a start's walk begins, as measure.py: 3.5 cells below its town hall's centre, just outside its footprint. */
export const walkStart = (hall: Point): Point => ({ x: hall.x, y: hall.y - 3.5 });

/** Seconds to a tenth, as the report gives them. */
export const roundSeconds = (seconds: number): number => Math.round(seconds * 10) / 10;

/** A rock's cells: a disc of its size's half (`…4x4` 2, `…6x6` 3; huge and diagonal rocks 3.5), as measure.py `rock_cells`. */
export function rockCells(rock: ResourceFootprint): [number, number][] {
  const size = /(\d+)x(\d+)/.exec(rock.unitType);
  let radius = 2;
  if (/Huge|Diagonal/.test(rock.unitType)) radius = 3.5;
  else if (size) {
    const digits = size[1]!;
    radius = (digits.length > 1 && digits.startsWith("1") ? Number(digits.at(-1)) : Number(digits)) / 2;
  }
  const cells: [number, number][] = [];
  for (let cx = Math.trunc(rock.x - radius - 1); cx < Math.trunc(rock.x + radius + 2); cx++) {
    for (let cy = Math.trunc(rock.y - radius - 1); cy < Math.trunc(rock.y + radius + 2); cy++) {
      if (Math.hypot(cx + 0.5 - rock.x, cy + 0.5 - rock.y) <= radius) cells.push([cx, cy]);
    }
  }
  return cells;
}

/** Where workers can walk, by cell index: with the rocks standing, or killed. */
export function meleePassable(ground: MeleeGround, withRocks: boolean): Uint8Array {
  const { width, bounds } = ground;
  const [left, bottom, right, top] = bounds;
  const blocked = new Set<number>();
  for (const unit of ground.units) {
    const cells = isResource(unit.unitType) ? resourceCells(unit) : withRocks && isBlockingRock(unit.unitType) ? rockCells(unit) : [];
    for (const [x, y] of cells) blocked.add(y * width + x);
  }
  const passable = new Uint8Array(width * ground.height);
  for (let y = bottom; y < top; y++) {
    for (let x = left; x < right; x++) {
      const index = y * width + x;
      if (ground.noPathing[index] === 0 && !blocked.has(index)) passable[index] = 1;
    }
  }
  return passable;
}

const STEPS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Ground distance in cells from `source` to every cell (Infinity where unreachable): measure.py `dijkstra`. */
export function groundDistances(ground: Pick<MeleeGround, "width" | "height" | "syncCliff">, passable: Uint8Array, source: Point): Float64Array {
  const { width, height, syncCliff: cliff } = ground;
  const dist = new Float64Array(width * height).fill(Infinity);
  const start = source.y * width + source.x;
  dist[start] = 0;
  const heap = new MinHeap();
  heap.push(0, start);
  const open = (index: number, level: number): boolean => passable[index] === 1 && Math.abs(cliff[index]! - level) < 64;
  for (let next = heap.pop(); next; next = heap.pop()) {
    const [d, i] = next;
    if (d > dist[i]!) continue;
    const x = i % width;
    const y = (i - x) / width;
    const level = cliff[i]!;
    for (const [dx, dy, cost] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (!open(j, level)) continue;
      if (dx && dy && !(open(y * width + nx, level) && open(ny * width + x, level))) continue;
      const nd = d + cost;
      if (nd < dist[j]!) {
        dist[j] = nd;
        heap.push(nd, j);
      }
    }
  }
  return dist;
}

/** The passable cell nearest a point, searching out ring by ring to 8 cells: measure.py `nearest_passable`. */
export function nearestPassable(width: number, passable: Uint8Array, point: Point, reach = 8): Point | undefined {
  const cx = Math.trunc(point.x);
  const cy = Math.trunc(point.y);
  for (let r = 0; r <= reach; r++) {
    let best: { d: number; cell: Point } | undefined;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const [x, y] = [cx + dx, cy + dy];
        const index = y * width + x;
        if (x < 0 || x >= width || index < 0 || index >= passable.length || !passable[index]) continue;
        const d = Math.hypot(dx, dy);
        if (!best || d < best.d) best = { d, cell: { x, y } };
      }
    }
    if (best) return best.cell;
  }
  return undefined;
}

/** Measures a two-spawn melee map: the distance report's numbers. */
export function measureMeleeMap(input: MeleeMeasureInput): MeleeDistances {
  const { width } = input;
  const up = meleePassable(input, true);
  const down = meleePassable(input, false);
  const startCells = input.starts.map((start) => nearestPassable(width, up, walkStart(start)));
  if (input.starts.length !== 2 || startCells.some((cell) => !cell)) throw new Error("The distance report needs two starts, each with ground to walk from");
  const [s1, s2] = startCells as [Point, Point];
  const at = (cell: Point): number => cell.y * width + cell.x;
  const fromStart = [s1, s2].map((cell) => groundDistances(input, up, cell)) as [Float64Array, Float64Array];
  const fromStartDown = [s1, s2].map((cell) => groundDistances(input, down, cell)) as [Float64Array, Float64Array];
  const time = (cellsUp: number, cellsDown: number): GroundTime => {
    const seconds = roundSeconds(cellsUp / WORKER_SPEED);
    const rocksDown = roundSeconds(cellsDown / WORKER_SPEED);
    return rocksDown === seconds ? { seconds } : { seconds, rocksDown };
  };

  // Each player's other bases, nearest by ground first; no main is anyone's natural or third.
  const isMain = (hall: Point): boolean => input.starts.some((start) => Math.hypot(start.x - hall.x, start.y - hall.y) < 8);
  const bases = input.bases.flatMap((base) => {
    const cell = nearestPassable(width, up, base.hall);
    return cell && !isMain(base.hall) ? [{ ...base, cell }] : [];
  });
  const byGround = (player: 0 | 1) =>
    bases
      .map((base) => ({ base, cells: fromStart[player][at(base.cell)]!, down: fromStartDown[player][at(base.cell)]! }))
      .filter((entry) => Number.isFinite(entry.cells))
      .sort((a, b) => a.cells - b.cells);
  const nearest = [byGround(0), byGround(1)] as const;
  const entry = (rank: number): BaseDistance | undefined => {
    const found = nearest[0][rank];
    return found ? { base: found.base.id, ground: time(found.cells, found.down) } : undefined;
  };

  let naturalToNatural: GroundTime | undefined;
  const [n1, n2] = [nearest[0][0]?.base, nearest[1][0]?.base];
  if (n1 && n2 && n1 !== n2) {
    naturalToNatural = time(groundDistances(input, up, n1.cell)[at(n2.cell)]!, groundDistances(input, down, n1.cell)[at(n2.cell)]!);
  }

  const airVsGround: AirVsGround[] = [];
  for (const player of [0, 1] as const) {
    const other = (1 - player) as 0 | 1;
    const early = [{ id: player === 0 ? "Player 1's main" : "Player 2's main", hall: input.starts[player]!, cells: fromStart[other][at(startCells[player]!)]! }];
    for (const { base } of nearest[player].slice(0, 2)) early.push({ id: base.id, hall: base.hall, cells: fromStart[other][at(base.cell)]! });
    for (const base of early) {
      if (!Number.isFinite(base.cells) || base.cells === 0) continue;
      const air = Math.hypot(base.hall.x - input.starts[other]!.x, base.hall.y - input.starts[other]!.y);
      airVsGround.push({ base: base.id, air: roundSeconds(air / WORKER_SPEED), ground: roundSeconds(base.cells / WORKER_SPEED), ratio: air / base.cells });
    }
  }

  const mains = [mainRamp(input, up, s1, fromStart[0], fromStart[1]), mainRamp(input, up, s2, fromStart[1], fromStart[0])];
  const mainsDown = [mainRamp(input, down, s1, fromStartDown[0], fromStartDown[1]), mainRamp(input, down, s2, fromStartDown[1], fromStartDown[0])];
  let rampToRamp: GroundTime | undefined;
  const between = fromStart[0][at(s2)]!;
  const betweenDown = fromStartDown[0][at(s2)]!;
  if (mains[0] && mains[1] && mainsDown[0] && mainsDown[1] && Number.isFinite(between)) {
    rampToRamp = time(
      between - fromStart[0][at(mains[0].top)]! - fromStart[1][at(mains[1].top)]!,
      betweenDown - fromStartDown[0][at(mainsDown[0].top)]! - fromStartDown[1][at(mainsDown[1].top)]!,
    );
  }

  const air = roundSeconds(Math.hypot(input.starts[0]!.x - input.starts[1]!.x, input.starts[0]!.y - input.starts[1]!.y) / WORKER_SPEED);
  return {
    mainToMain: { ground: time(between, betweenDown), air },
    ...(rampToRamp ? { rampToRamp } : {}),
    ...(naturalToNatural ? { naturalToNatural } : {}),
    ...optional("mainToNatural", entry(0)),
    ...optional("mainToThird", entry(1)),
    ...optional("secondThird", entry(2)),
    airVsGround,
    mains,
  };
}

/**
 * A main's plateau and the ramp off it on the shortest walk between the starts (measure.py
 * `main_ramps`): the plateau's edge cell beside a ramp with the least summed distance from both
 * starts is its top, and the ramp is the in-between cells flood-filled from there.
 */
function mainRamp(ground: MeleeGround, passable: Uint8Array, start: Point, own: Float64Array, other: Float64Array): MainRampMeasure | undefined {
  const { width, height, syncCliff: cliff } = ground;
  const level = cliff[start.y * width + start.x]!;
  const sides = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const region = new Set<number>();
  for (const stack = [start.y * width + start.x]; stack.length > 0; ) {
    const i = stack.pop()!;
    if (region.has(i) || !passable[i] || cliff[i] !== level) continue;
    region.add(i);
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of sides) if (inside(x + dx, y + dy)) stack.push((y + dy) * width + x + dx);
  }
  const edge = [...region].filter((i) => {
    const x = i % width;
    const y = (i - x) / width;
    return sides.some(([dx, dy]) => {
      if (!inside(x + dx, y + dy)) return false;
      const j = (y + dy) * width + x + dx;
      return passable[j] && cliff[j] !== level && Math.abs(cliff[j]! - level) < 64;
    });
  });
  if (edge.length === 0) return undefined;
  const top = edge.reduce((best, i) => (own[i]! + other[i]! < own[best]! + other[best]! ? i : best));
  const tx = top % width;
  const ty = (top - tx) / width;
  const ramp = new Set<number>();
  const stack: number[] = [];
  for (const [dx, dy] of [...sides, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const j = (ty + dy) * width + tx + dx;
    if (inside(tx + dx, ty + dy) && passable[j] && cliff[j]! % 64 !== 0) stack.push(j);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    if (ramp.has(i) || cliff[i]! % 64 === 0) continue;
    ramp.add(i);
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of sides) if (inside(x + dx, y + dy)) stack.push((y + dy) * width + x + dx);
  }
  const xs = [...ramp].map((i) => i % width);
  const ys = [...ramp].map((i) => Math.trunc(i / width));
  const topEdgeCells = edge.filter((i) => {
    const x = i % width;
    const y = (i - x) / width;
    return sides.some(([dx, dy]) => ramp.has((y + dy) * width + x + dx));
  }).length;
  return {
    top: { x: tx, y: ty },
    rampCells: ramp.size,
    rampBox: ramp.size > 0 ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [tx, ty, tx, ty],
    topEdgeCells,
    mainCells: region.size,
  };
}


function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

/** A binary min-heap of [distance, cell] pairs. */
class MinHeap {
  private readonly items: [number, number][] = [];

  push(distance: number, cell: number): void {
    const items = this.items;
    items.push([distance, cell]);
    for (let i = items.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (items[parent]![0] <= items[i]![0]) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }

  pop(): [number, number] | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last) {
      items[0] = last;
      for (let i = 0; ; ) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let smallest = i;
        if (l < items.length && items[l]![0] < items[smallest]![0]) smallest = l;
        if (r < items.length && items[r]![0] < items[smallest]![0]) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i]!, items[smallest]!];
        i = smallest;
      }
    }
    return top;
  }
}
