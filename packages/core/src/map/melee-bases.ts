// The standard melee base (#215, spec #212): every resource base on a melee map, start bases
// included, is the commonest start layout on Blizzard's ladder maps, not the campaign
// `resource-base` arc (expand-placements.ts).
//
// Facing south-west, from the town hall's centre:
//
//   large minerals  (-6.5,-2) (-6.5, 0) (-2.5,-6) ( 0.5,-6)
//   small minerals  (-7.5,-1) (-6.5,-4) (-5.5,-5) (-0.5,-7)
//   geysers         (-7.0, 3) ( 4.0,-7)
//
// A corner mineral line wrapping one quadrant, a geyser at each end. The other diagonals mirror it
// across the axes, which keeps every 2×1 field and 3×3 geyser on its grid (a quarter turn would put
// a field half a cell off). Each piece sits against Blizzard's `NearResources` ring, so the
// town-hall rule (§0 "Town hall spots") finds the town hall where the layout put it.

import type { DiagonalFacing, MeleeResourceBaseParams } from "../domain/melee-map-blueprint.js";
import type { Point } from "../terrain/rasterize.js";

/**
 * `minerals: "rich"`: a gold base, 6 rich patches (Proxima Station LE's gold layout). `gas: "rich"`:
 * both geysers rich; `"one-rich"`: only the first, rich (World of Sleepers LE's rich-gas bases).
 */
export type MeleeBaseVariant = Partial<Pick<MeleeResourceBaseParams, "minerals" | "gas">>;

/** A resource by type and centre: all the town-hall rule needs. */
export type ResourceFootprint = { readonly unitType: string; readonly x: number; readonly y: number };

/** One mineral field or geyser of a melee base. */
export type MeleeBasePiece = {
  /** `mineral/<index>` or `geyser/<index>`. */
  readonly label: string;
  readonly unitType: string;
  readonly x: number;
  readonly y: number;
};

type Offset = readonly [kind: "large" | "small" | "geyser", dx: number, dy: number];

/** The standard start base, facing south-west (research §1). */
const STANDARD: readonly Offset[] = [
  ["large", -6.5, -2],
  ["large", -6.5, 0],
  ["large", -2.5, -6],
  ["large", 0.5, -6],
  ["small", -7.5, -1],
  ["small", -6.5, -4],
  ["small", -5.5, -5],
  ["small", -0.5, -7],
  ["geyser", -7, 3],
  ["geyser", 4, -7],
];

/** A gold base: Proxima Station LE's, 3 large and 3 small rich patches in the same corner (measured from its Objects). */
const GOLD: readonly Offset[] = [
  ["large", -6.5, -3],
  ["large", -6.5, -2],
  ["large", -1.5, -6],
  ["small", -5.5, -5],
  ["small", -4.5, -6],
  ["small", -0.5, -7],
  ["geyser", -7, 1],
  ["geyser", 3, -7],
];

/** Signs that mirror the south-west layout onto each diagonal. */
const MIRROR: Readonly<Record<DiagonalFacing, readonly [number, number]>> = {
  "south-west": [1, 1],
  "south-east": [-1, 1],
  "north-west": [1, -1],
  "north-east": [-1, -1],
};

/**
 * A melee base's pieces round the town hall centred at `hall` (on .5 coordinates, as a 5×5
 * footprint sits): unit types only, as on every ladder map, so the game's own data sets the amounts.
 */
export function meleeBasePieces(hall: Point, facing: DiagonalFacing, variant: MeleeBaseVariant = {}): MeleeBasePiece[] {
  const [sx, sy] = MIRROR[facing];
  const rich = variant.minerals === "rich";
  const gas = variant.gas ?? "normal";
  const layout = (rich ? GOLD : STANDARD).filter(([kind], index, all) => kind !== "geyser" || gas !== "one-rich" || index === all.findIndex(([other]) => other === "geyser"));
  let minerals = 0;
  let geysers = 0;
  return layout.map(([kind, dx, dy]) => {
    const unitType =
      kind === "geyser" ? (gas === "normal" ? "VespeneGeyser" : "RichVespeneGeyser") : `${rich ? "Rich" : ""}MineralField${kind === "small" ? "750" : ""}`;
    const label = kind === "geyser" ? `geyser/${geysers++}` : `mineral/${minerals++}`;
    return { label, unitType, x: hall.x + sx * dx, y: hall.y + sy * dy };
  });
}

export const isGeyser = (unitType: string): boolean => unitType.endsWith("Geyser");

/** The cells a resource covers, by lower-left corner: a field 2×1, a geyser 3×3 (research measure.py). */
export function resourceCells(piece: ResourceFootprint): [number, number][] {
  const cx = Math.floor(piece.x);
  const cy = Math.floor(piece.y);
  if (isGeyser(piece.unitType)) return [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy): [number, number] => [cx + dx, cy + dy]));
  return [
    [cx - 1, cy],
    [cx, cy],
  ];
}

const key = (x: number, y: number): string => `${x},${y}`;

/**
 * Blizzard's `NearResources` ring (liberty FootprintData.xml): 3 cells round each resource's
 * footprint, less the ring's four corner cells. A town hall's 5×5 may not overlap it. Cells as "x,y".
 */
export function nearResourcesCells(pieces: readonly ResourceFootprint[]): Set<string> {
  const ring = new Set<string>();
  for (const piece of pieces) {
    const cells = resourceCells(piece);
    const xs = cells.map(([x]) => x);
    const ys = cells.map(([, y]) => y);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 3, Math.max(...xs) + 3, Math.min(...ys) - 3, Math.max(...ys) + 3];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if ((x === x0 || x === x1) && (y === y0 || y === y1)) continue;
        ring.add(key(x, y));
      }
    }
  }
  return ring;
}

/** Empty cells between the 5×5 town hall centred at `hall` and a resource's footprint (Chebyshev). */
export function resourceGap(hall: Point, piece: ResourceFootprint): number {
  const [hx0, hx1] = [Math.floor(hall.x) - 2, Math.floor(hall.x) + 2];
  const [hy0, hy1] = [Math.floor(hall.y) - 2, Math.floor(hall.y) + 2];
  const between = (value: number, low: number, high: number): number => Math.max(low - value - 1, value - high - 1, 0);
  return Math.min(...resourceCells(piece).map(([x, y]) => Math.max(between(x, hx0, hx1), between(y, hy0, hy1))));
}

/** The ground the town-hall rule searches; cells by lower-left corner. */
export type TownHallSearch = {
  /** Whether a cell is buildable ground; every cell by default. */
  readonly buildable?: (x: number, y: number) => boolean;
  /** A cell's level: a town hall's 25 cells must share one. One level by default. */
  readonly level?: (x: number, y: number) => number;
};

/**
 * The best town-hall spot for a group of resources (research §0, measure.py `town_hall_spot`):
 * the 5×5 centre within 12 cells of the resources' middle, clear of their `NearResources` ring and
 * footprints, on buildable ground of one level, with the least summed distance to the resources.
 * On the 46 ladder start locations this finds every StartLoc exactly. Undefined when none is legal.
 */
export function meleeTownHallSpot(pieces: readonly ResourceFootprint[], search: TownHallSearch = {}): Point | undefined {
  const { buildable = () => true, level = () => 0 } = search;
  const ring = nearResourcesCells(pieces);
  const covered = new Set(pieces.flatMap((piece) => resourceCells(piece).map(([x, y]) => key(x, y))));
  const cx = Math.trunc(pieces.reduce((sum, piece) => sum + piece.x, 0) / pieces.length);
  const cy = Math.trunc(pieces.reduce((sum, piece) => sum + piece.y, 0) / pieces.length);
  let best: { score: number; spot: Point } | undefined;
  for (let ix = cx - 12; ix <= cx + 12; ix++) {
    for (let iy = cy - 12; iy <= cy + 12; iy++) {
      if (!legal(ix, iy)) continue;
      const spot = { x: ix + 0.5, y: iy + 0.5 };
      const score = pieces.reduce((sum, piece) => sum + Math.hypot(piece.x - spot.x, piece.y - spot.y), 0);
      if (!best || score < best.score) best = { score, spot };
    }
  }
  return best?.spot;

  function legal(ix: number, iy: number): boolean {
    const first = level(ix - 2, iy - 2);
    for (let x = ix - 2; x <= ix + 2; x++) {
      for (let y = iy - 2; y <= iy + 2; y++) {
        if (ring.has(key(x, y)) || covered.has(key(x, y)) || !buildable(x, y) || level(x, y) !== first) return false;
      }
    }
    return true;
  }
}

/**
 * Whether a field lies wholly off a corner of the 5×5 town hall centred at `hall`: beside neither
 * its columns nor its rows. Only there may a mineral stand 2 cells from it, where the
 * NearResources ring's corner cell is cut (research §1).
 */
export function offCorner(hall: Point, piece: Point): boolean {
  const [x0, x1, y0, y1] = [Math.floor(hall.x) - 2, Math.floor(hall.x) + 2, Math.floor(hall.y) - 2, Math.floor(hall.y) + 2];
  const cells = [Math.floor(piece.x) - 1, Math.floor(piece.x)];
  const row = Math.floor(piece.y);
  return cells.every((x) => x < x0 || x > x1) && (row < y0 || row > y1);
}
