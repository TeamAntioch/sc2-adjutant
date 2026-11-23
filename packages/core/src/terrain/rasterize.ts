import { blueprintCatalog } from "../catalog/catalog-layer.js";
import { hidesLowestLevel } from "../catalog/tileset-sky.js";
import { isBuiltTexture, missionTextures } from "../catalog/tileset-textures.js";
import { hasKeptTerrain, type MissionBlueprint } from "../domain/mission-blueprint.js";

import {
  CELL_FLAG_CLIFF,
  CELL_FLAG_GROUND,
  CELL_FLAG_HIDDEN,
  cliffHeight,
  type CliffCell,
  cliffCells as findCliffCells,
  type CornerGrid,
  cliffVariation,
  cornerLevel,
  GROUND_LEVEL,
  isCliffCell,
  syncCellLevels,
  vertexLevels,
} from "./cliffs.js";
import { connectionBridges } from "./bridges.js";
import { hiddenCellMask } from "./hidden-cells.js";
import { checkCliffSetCount, cliffSetPlan, wornCliffSets } from "./cliff-sets.js";
import { cellJumps, terraceCorners } from "./terraces.js";
import { blockOf } from "./texture-grid.js";
import { generatedTextureSets, type GeneratedTextureSets } from "./generated-texture-sets.js";
import { groundRelief } from "./ground-relief.js";
import { mainLevelOf, paintTextures, texturePlan, zoneOwners } from "./paint-textures.js";
import { digPools, dugPoolPathing, raiseShoreBanks } from "./shore-banks.js";
import { type OutlineWarp, outlineWarp, zoneIndexAt } from "./ragged-outlines.js";
import { type DiagonalDirection, type Ramp, type RampDirection, rampContext, rampOutline, stampRamp, validateRamp } from "./ramps.js";
import { type Rot180, rotateRamp, sourceCell } from "./symmetry.js";
import {
  coveredCliffCells,
  type PlacedTerrainObject,
  placeTerrainObjects,
  stampCorners,
  stampedCells,
  stampVertexLevels,
  terrainObjectWarnings as findTerrainObjectWarnings,
} from "./terrain-objects.js";

export type TerrainRasterizationResult = {
  /** Mean texture weights per cell: [cellIndex * 8 + layerIndex] -> 0..15, summing to 15 (sync texture info, minimap). */
  readonly textureWeights: Uint8Array;
  /** Mask weights per texel, 8×8 per cell: [texelIndex * 8 + layerIndex] -> 0..15, summing to 15. */
  readonly texelWeights: Uint8Array;
  /** Texture palette advice for the author (e.g. a cliff with no texture change). */
  readonly textureWarnings: readonly string[];
  /** A generated map's own texture sets, as planned (generated-texture-sets.ts); none beside Kept ground or without `textureSets`. */
  readonly textureSets?: GeneratedTextureSets;
  /** Cell flags (LFCT bitmask per cell): 0x02 ground, 0x03 under a cliff mesh. */
  readonly cellFlags: Uint8Array;
  /** The Editor's "no pathing" paint per cell (CellAttribute_Pnp): 8 sub-cell bits, 255 a whole cell under a dug pool. */
  readonly noPathing: Uint8Array;
  /** Raw t3SyncCliffLevel value per cell: 64 per level, in between on ramps. */
  readonly syncCliff: Uint16Array;
  /** Vertex heights: base terrain plus cliff height. */
  readonly heights: Float32Array;
  /** Portion of each vertex height contributed by its cliff level (t3HeightMap r1). */
  readonly cliffHeights: Float32Array;
  /** Sync heights (SMAP fixed-point 8.8). */
  readonly syncHeights: Int16Array;
  /** Cliff level per vertex (t3HeightMap r2). */
  readonly vertexCliffLevels: Uint8Array;
  /** Cliff cells with a cliff mesh or ramp, ascending. */
  readonly cliffCells: readonly CliffCell[];
  /** Cliff set names in index order (cliff cells' and ramps' `cliffSet`). */
  readonly cliffSets: readonly string[];
  readonly ramps: readonly Ramp[];
  /** Terrain objects for t3Terrain.xml's cliffDoodadList; their stamps are already in the levels above. */
  readonly terrainObjects: readonly PlacedTerrainObject[];
  /** Terrain objects whose stamp edge doesn't meet the ground around it. */
  readonly terrainObjectWarnings: readonly string[];
  /** What the terraces did (terraces.ts): cells whose level they moved, and the jumps of two levels or more left. */
  readonly terraces: TerraceReport;
};

export type TerraceReport = {
  /** Cells whose sync level the terraces moved. */
  readonly cells: number;
  /** Neighbouring cell pairs still two or more levels apart (floors drawn too close in level), ramps, bridges and open sky aside. */
  readonly jumps: number;
};

/** The compile's note on the terraces, and its warning about the jumps they couldn't step. */
export function terraceNotes({ cells, jumps }: TerraceReport): string[] {
  const notes: string[] = [];
  if (cells > 0) notes.push(`Terraced ${cells} cell${cells === 1 ? "" : "s"} of rock so no cliff climbs two levels at once (the game draws those as black squares)`);
  if (jumps > 0) {
    notes.push(
      `${jumps} neighbouring cell pair${jumps === 1 ? " is" : "s are"} still two or more levels apart, where two floors (Zones that aren't backdrop) meet with no rock between to terrace: the game draws those as black squares. Put a Zone a level between them, or rock a few cells wide`,
    );
  }
  return notes;
}

// Matches an Editor-created map, where level-1 ground sits at height 8.
const GROUND_HEIGHT = 8.0;
/** The seed of the cliff mesh variation the generator picks per cliff cell (cliffVariation). */
export const CLIFF_VARIATION_SEED = 0x5c2;
const TERRAIN_OBJECT_CLIFF_FLAGS = 4 | 8;

import { containsPoint, distanceToPolygon, type Point } from "./polygon.js";

export { containsPoint, type Point };

/** Cells of level ground kept beyond a built zone with a built edge line, under its curbs. */
const LEVEL_BEYOND_CURBS = 1;

/** The zone index owning each corner of the 2-cell grid (later zones win where they overlap), or -1. */
function cornerOwners(blueprint: MissionBlueprint, warp: OutlineWarp): Int16Array {
  const columns = blueprint.mapSize.width / 2 + 1;
  const rows = blueprint.mapSize.height / 2 + 1;
  const owners = new Int16Array(columns * rows);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < columns; cx++) owners[cy * columns + cx] = zoneIndexAt(blueprint, warp, { x: cx * 2, y: cy * 2 });
  return owners;
}

/** Corner levels from zone elevations, given each corner's owner. */
function levelsOf(blueprint: MissionBlueprint, owners: Int16Array): CornerGrid {
  const columns = blueprint.mapSize.width / 2 + 1;
  const rows = blueprint.mapSize.height / 2 + 1;
  const levels = Uint8Array.from(owners, (owner) => (owner < 0 ? GROUND_LEVEL : blueprint.zones[owner]!.elevation));
  return { columns, rows, levels };
}

/** Corner levels from zone elevations, straight along the polygons; later zones win where they overlap. */
function zoneCornerGrid(blueprint: MissionBlueprint): CornerGrid {
  return levelsOf(blueprint, cornerOwners(blueprint, (point) => point));
}

const RAMP_DIRECTIONS: Record<"north" | "south" | "east" | "west", RampDirection> = {
  // The ramp sits outside the zone's edge and climbs into the zone.
  south: 1,
  north: 0,
  west: 3,
  east: 2,
};

/** Places each blueprint ramp on its zone's edge, at the centre of that edge plus the offset. */
type Zone = MissionBlueprint["zones"][number];
type Edge = keyof typeof RAMP_DIRECTIONS;

/** Outermost corners on the 2-cell grid that still lie inside the zone. */
function cornerBounds(zone: Zone): { west: number; east: number; south: number; north: number } {
  const xs = zone.polygon.map((p) => p.x);
  const ys = zone.polygon.map((p) => p.y);
  return {
    west: Math.ceil(Math.min(...xs) / 2) * 2,
    east: Math.floor(Math.max(...xs) / 2) * 2,
    south: Math.ceil(Math.min(...ys) / 2) * 2,
    north: Math.floor(Math.max(...ys) / 2) * 2,
  };
}

/** The corner on `edge` of the zone's bounds, `offset` cells from the edge's centre. */
function edgePoint(zone: Zone, edge: Edge, offset: number): Point {
  const even = (value: number): number => Math.round(value / 2) * 2;
  const { west, east, south, north } = cornerBounds(zone);
  const alongX = even((west + east) / 2 + offset);
  const alongY = even((south + north) / 2 + offset);
  return { north: { x: alongX, y: north }, south: { x: alongX, y: south }, east: { x: east, y: alongY }, west: { x: west, y: alongY } }[edge];
}

/** A ramp on `edge` of the (high) zone, `offset` cells from the edge's centre, validated against the corners. */
function placeRamp(id: string, zone: Zone, edge: Edge, offset: number, corners: CornerGrid): Ramp {
  const point = edgePoint(zone, edge, offset);
  const ramp: Ramp = { id, direction: RAMP_DIRECTIONS[edge], edge: point, lowLevel: cornerLevel(corners, point.x / 2, point.y / 2) - 1 };
  try {
    validateRamp(ramp, corners);
  } catch (error) {
    throw new Error(`Ramp ${id} on the ${edge} edge of ${zone.id}: ${(error as Error).message}`);
  }
  return ramp;
}

const ALL_DIRECTIONS: readonly RampDirection[] = [0, 1, 2, 3, 4, 5, 6, 7];
const DIAGONAL_DIRECTIONS: readonly DiagonalDirection[] = [4, 5, 6, 7];

/** Each corner moved to fit a ramp counts as this many cells further from where it was asked for. */
const MOVE_COST = 2;
/** The most corners the compiler will move for one ramp. */
const MAX_MOVES = 12;

/**
 * The corners to move for the ramp to fit, or undefined if it can't: a context corner off the
 * map, locked by an earlier ramp, or at neither of the ramp's two levels.
 */
function movesFor(ramp: Ramp, corners: CornerGrid, locked: ReadonlySet<number>): number[] | undefined {
  const moves: number[] = [];
  for (const context of rampContext(ramp)) {
    const cx = context.x / 2;
    const cy = context.y / 2;
    if (cx < 0 || cy < 0 || cx >= corners.columns || cy >= corners.rows) return undefined;
    const index = cy * corners.columns + cx;
    const level = corners.levels[index]!;
    if (level === context.level) continue;
    if (locked.has(index) || (level !== ramp.lowLevel && level !== ramp.lowLevel + 1)) return undefined;
    moves.push(index);
  }
  return moves;
}

/** Sets the ramp's context corners and locks them against later ramps. */
function fitRamp(ramp: Ramp, corners: CornerGrid, locked: Set<number>): void {
  for (const context of rampContext(ramp)) {
    const index = (context.y / 2) * corners.columns + context.x / 2;
    corners.levels[index] = context.level;
    locked.add(index);
  }
}

/**
 * The ramp up from `low` onto `high` nearest `target`, straight or diagonal: its top on ground the
 * high zone owns, its foot on ground the low zone owns (later zones win where they overlap), moving up to MAX_MOVES corners between the two levels to make
 * room (each counting MOVE_COST cells). Ties go to the foot nearer the low zone's centre.
 */
/** No room for a melee main's diagonal ramp (#215): the melee compiler names it under its main-ramp rule. */
export class MainRampError extends Error {
  readonly mainId: string;
  readonly detail: string;

  constructor(mainId: string, detail: string) {
    super(`Main ${mainId}: ${detail}`);
    this.name = "MainRampError";
    this.mainId = mainId;
    this.detail = detail;
  }
}

/** The id the terrain gives the ramp a connection makes, up from `low` onto `high`. */
export const connectionRampId = (high: string, low: string): string => `${high}-${low}`;

function rampNear(id: string, zones: readonly Zone[], high: Zone, low: Zone, target: Point, corners: CornerGrid, locked: Set<number>, diagonalOnly = false): Ramp {
  const owner = (point: Point): Zone | undefined => zones.findLast((zone) => containsPoint(zone.polygon, point));
  const lowCentre = centreOf(low);
  const lowLevel = high.elevation - 1;
  if (lowLevel < 1) throw new Error(`Ramp ${id}: a ramp can't reach a level-0 pit from ground`);
  const candidates: { ramp: Ramp; cost: number; footDistance: number }[] = [];
  // A main's ramp is the narrow diagonal ramp, its base on the odd vertex in the middle of a cliff cell.
  const offset = diagonalOnly ? 1 : 0;
  for (let cy = 0; cy < corners.rows; cy++) {
    for (let cx = 0; cx < corners.columns; cx++) {
      const point = { x: cx * 2 + offset, y: cy * 2 + offset };
      if (owner(point) !== high) continue;
      for (const direction of diagonalOnly ? DIAGONAL_DIRECTIONS : ALL_DIRECTIONS) {
        const ramp: Ramp = { id, direction, edge: point, lowLevel, ...(diagonalOnly ? { narrow: true as const } : {}) };
        const foot = rampOutline(ramp).from;
        if (owner(foot) !== low) continue;
        const moves = movesFor(ramp, corners, locked);
        if (moves === undefined || moves.length > MAX_MOVES) continue;
        candidates.push({
          ramp,
          cost: Math.hypot(point.x - target.x, point.y - target.y) + MOVE_COST * moves.length,
          footDistance: Math.hypot(foot.x - lowCentre.x, foot.y - lowCentre.y),
        });
      }
    }
  }
  candidates.sort((a, b) => a.cost - b.cost || a.footDistance - b.footDistance);
  const best = candidates[0];
  if (!best && diagonalOnly) {
    throw new MainRampError(
      high.id,
      `no room for its diagonal ramp up from ${low.id} near (${target.x}, ${target.y}), even moving ${MAX_MOVES} corners. ` +
        `It's cut across a corner of the main, so put a corner of ${high.id} against ${low.id} there`,
    );
  }
  if (!best) throw new Error(`Ramp ${id}: no room for a ramp from ${low.id} up onto ${high.id}, even moving ${MAX_MOVES} corners`);
  fitRamp(best.ramp, corners, locked);
  return best.ramp;
}

function centreOf(zone: Zone): Point {
  return {
    x: zone.polygon.reduce((sum, p) => sum + p.x, 0) / zone.polygon.length,
    y: zone.polygon.reduce((sum, p) => sum + p.y, 0) / zone.polygon.length,
  };
}

/**
 * The edge of the high zone that faces the low zone, and an offset along it towards the low
 * zone's centre, kept far enough from the edge's ends for the 8-cell-wide ramp to fit.
 */
function facingEdge(high: Zone, low: Zone): { edge: Edge; offset: number } {
  const { west, east, south, north } = cornerBounds(high);
  const centre = { x: (west + east) / 2, y: (south + north) / 2 };
  const target = centreOf(low);
  const dx = target.x - centre.x;
  const dy = target.y - centre.y;
  const clamp = (value: number, halfSpan: number): number => Math.max(-(halfSpan - 4), Math.min(halfSpan - 4, value));
  return Math.abs(dx) > Math.abs(dy)
    ? { edge: dx > 0 ? "east" : "west", offset: clamp(dy, (north - south) / 2) }
    : { edge: dy > 0 ? "north" : "south", offset: clamp(dx, (east - west) / 2) };
}

/**
 * Explicit `ramps[]` entries, then one ramp per `ramp` connection whose high zone has no
 * explicit ramp (explicit placements win; a zone pair can only express one ramp). Given
 * `unplaced`, a connection's ramp that doesn't fit is skipped and its error collected there.
 *
 * With a symmetry, each ramp is placed on the source side and its rotated copy is that ramp
 * turned 180°, not placed again: rounding to the grid and breaking ties would put it elsewhere.
 * A ramp connection up onto a zone in `diagonalOnto` (a melee main, #215) is always the narrow diagonal ramp, the ladder main ramp.
 */
function blueprintRamps(blueprint: MissionBlueprint, corners: CornerGrid, unplaced?: string[], symmetry?: Rot180, diagonalOnto?: ReadonlySet<string>): Ramp[] {
  const zoneById = new Map(blueprint.zones.map((zone) => [zone.id, zone]));
  const locked = new Set<number>();
  const ramps: Ramp[] = [];
  const addRotation = (turn: Rot180, ramp: Ramp, id: string): void => {
    const turned: Ramp = { ...rotateRamp(turn, ramp), id };
    if (movesFor(turned, corners, locked) === undefined) throw new Error(`Ramp ${id}, ${ramp.id} turned 180°, has no room: it runs into ${ramp.id} or another ramp`);
    fitRamp(turned, corners, locked);
    ramps.push(turned);
  };
  const rotationOf = new Map([...(symmetry?.rotatedFrom ?? [])].map(([rotated, source]) => [source, rotated]));
  for (const spec of blueprint.ramps) {
    if (symmetry?.rotatedFrom.has(spec.id)) continue;
    const ramp = placeRamp(spec.id, zoneById.get(spec.zoneId)!, spec.edge, spec.offset, corners);
    fitRamp(ramp, corners, locked);
    ramps.push(ramp);
    const rotated = rotationOf.get(spec.id);
    if (symmetry && rotated !== undefined) addRotation(symmetry, ramp, rotated);
  }

  const explicitZones = new Set(blueprint.ramps.map((spec) => spec.zoneId));
  const partner = (zoneId: string): string => symmetry?.zonePartners.get(zoneId) ?? zoneId;
  const pairOf = (a: string, b: string): string => [a, b].sort().join("|");
  const seen = new Set<string>();
  for (const zone of blueprint.zones) {
    for (const connection of zone.connections) {
      const other = zoneById.get(connection.toZoneId);
      const pair = pairOf(zone.id, connection.toZoneId);
      if (connection.type !== "ramp" || !other || seen.has(pair)) continue;
      seen.add(pair);
      const rotatedPair = symmetry ? pairOf(partner(zone.id), partner(connection.toZoneId)) : pair;
      seen.add(rotatedPair);
      const [high, low] = zone.elevation > other.elevation ? [zone, other] : [other, zone];
      if (explicitZones.has(high.id)) continue;
      // `at` may come from either side's listing of the connection; without it, aim for the middle
      // of the high zone's edge facing the low zone.
      const at = connection.at ?? other.connections.find((candidate) => candidate.toZoneId === zone.id)?.at;
      const facing = facingEdge(high, low);
      try {
        const ramp = rampNear(connectionRampId(high.id, low.id), blueprint.zones, high, low, at ?? edgePoint(high, facing.edge, facing.offset), corners, locked, diagonalOnto?.has(high.id));
        ramps.push(ramp);
        if (symmetry && rotatedPair !== pair) addRotation(symmetry, ramp, connectionRampId(partner(high.id), partner(low.id)));
      } catch (error) {
        if (!unplaced) throw error;
        unplaced.push((error as Error).message);
      }
    }
  }
  return ramps;
}

/** The ramps the compiler would stamp, for the preview: ramp connections that don't fit are listed, not thrown. */
export function previewRamps(blueprint: MissionBlueprint): { readonly ramps: readonly Ramp[]; readonly unplaced: readonly string[] } {
  const unplaced: string[] = [];
  const ramps = blueprintRamps(blueprint, zoneCornerGrid(blueprint), unplaced);
  return { ramps, unplaced };
}

/** Bilinear terrain height at a map position, e.g. a doodad's z. */
/**
 * The Blueprint's hand height edits (`terrainEdits.heights`, synced back from the Editor), added to
 * the generated `heights` (vertex heights, row-major, width + 1 per row) in place. They go last, over
 * the banks and dug pools, so the ground comes out as the author left it in the Editor.
 */
export function applyHeightEdits(blueprint: Pick<MissionBlueprint, "mapSize" | "terrainEdits">, heights: Float32Array): void {
  const row = blueprint.mapSize.width + 1;
  for (const [key, offset] of Object.entries(blueprint.terrainEdits?.heights ?? {})) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    const index = y * row + x;
    if (x < row && heights[index] !== undefined) heights[index] += offset;
  }
}

export function terrainHeightAt(terrain: TerrainRasterizationResult, width: number, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.floor(y));
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const at = (vx: number, vy: number): number => terrain.heights[vy * (width + 1) + vx] ?? GROUND_HEIGHT;
  const south = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const north = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return south * (1 - fy) + north * fy;
}

/** The cliffs as the zones, ramps, bridges and terrain objects lay them out, before stamps. */
export type CliffLayout = {
  /** Corner levels: the zones' (natural outlines ragged), with ramps' and bridges' corners set. */
  readonly corners: CornerGrid;
  /** The zone index owning each corner as the levels were drawn, or -1. */
  readonly owners: Int16Array;
  /** The zone index owning each corner on the straight polygons, or -1. */
  readonly straightOwners: Int16Array;
  readonly ramps: readonly Ramp[];
  readonly terrainObjects: readonly PlacedTerrainObject[];
  /** Where natural zones sample their polygons (ragged-outlines.ts). */
  readonly warp: OutlineWarp;
  /** Corner levels as the Zones drew them, before terraces (terraces.ts); `corners` itself when nothing was terraced. */
  readonly drawn: CornerGrid;
};

/**
 * The corners terraces may not move: a corner a Zone that isn't a backdrop owns at its elevation
 * (a floor), a corner a ramp or bridge set, and, where the lowest level is hidden, the open sky.
 */
function terraceFixed(blueprint: MissionBlueprint, corners: CornerGrid, owners: Int16Array, set: readonly Point[], hiddenSky: boolean): Uint8Array {
  const fixed = new Uint8Array(corners.levels.length);
  corners.levels.forEach((level, index) => {
    const zone = blueprint.zones[owners[index]!];
    if ((zone && !zone.backdrop && zone.elevation === level) || (hiddenSky && level === 0)) fixed[index] = 1;
  });
  for (const point of set) {
    if (point.x % 2 !== 0 || point.y % 2 !== 0) continue;
    const [cx, cy] = [point.x / 2, point.y / 2];
    if (cx >= 0 && cy >= 0 && cx < corners.columns && cy < corners.rows) fixed[cy * corners.columns + cx] = 1;
  }
  return fixed;
}

/**
 * Lays out the cliffs: ramps and bridges are fitted on the straight polygons first, then natural
 * outlines are roughened everywhere but round them, so every ramp, bridge and terrain object sits
 * on the ground it would have without the wobble. `lenient` (for the checker and preview) skips a
 * ramp, bridge or terrain object that doesn't fit instead of throwing.
 */
export function cliffLayout(blueprint: MissionBlueprint, lenient = false, symmetry?: Rot180, diagonalOnto?: ReadonlySet<string>): CliffLayout {
  const straightOwners = cornerOwners(blueprint, (point) => point);
  const straight = levelsOf(blueprint, straightOwners);
  const before = straight.levels.slice();
  const attempt = <T>(build: () => T, otherwise: T): T => {
    try {
      return build();
    } catch (error) {
      if (!lenient) throw error;
      return otherwise;
    }
  };
  const ramps = attempt(() => blueprintRamps(blueprint, straight, lenient ? [] : undefined, symmetry, diagonalOnto), []);
  // Bridge connections become stock bridges, with the ground reshaped to meet them.
  const terrainObjects = attempt(() => placeTerrainObjects(blueprint, connectionBridges(blueprint, straight)), []);

  const ats: Point[] = blueprint.zones.flatMap((zone) => zone.connections.flatMap((connection) => (connection.at ? [connection.at] : [])));
  const pins: Point[] = [...ats];
  for (const ramp of ramps) {
    const outline = rampOutline(ramp);
    pins.push(ramp.edge, outline.from, outline.to, ...rampContext(ramp));
  }
  for (const object of terrainObjects) pins.push(...object.stamp.filter((vertex) => vertex.x % 2 === 0 && vertex.y % 2 === 0));
  straight.levels.forEach((level, index) => {
    if (level !== before[index]) pins.push({ x: (index % straight.columns) * 2, y: Math.floor(index / straight.columns) * 2 });
  });
  const warp = outlineWarp(blueprint, pins, symmetry);

  // Ragged levels, except where the ramps and bridges set a corner (pinned, so the warp leaves the
  // ground round it as the straight polygons drew it).
  const owners = cornerOwners(blueprint, warp);
  const corners = levelsOf(blueprint, owners);
  corners.levels.forEach((_, index) => {
    if (straight.levels[index] !== before[index]) corners.levels[index] = straight.levels[index]!;
  });
  // A generated map's rock steps a level at a time between storeys (terraces.ts); Kept ground and
  // the Zones generating beside it are left as drawn.
  if (hasKeptTerrain(blueprint)) return { corners, owners, straightOwners, ramps, terrainObjects, warp, drawn: corners };
  const drawn = { ...corners, levels: corners.levels.slice() };
  const hiddenSky = hidesLowestLevel(blueprintCatalog(blueprint), blueprint);
  terraceCorners(corners, terraceFixed(blueprint, corners, owners, pins.slice(ats.length), hiddenSky));
  return { corners, owners, straightOwners, ramps, terrainObjects, warp, drawn };
}

/**
 * The zone index owning each cell as the terrain draws it (row-major, -1 for none), for the
 * checker: the polygons' owner, except in a cliff cell whose corners the ragged outlines gave
 * another zone. There the polygons' owner keeps the cell if its level is one of the corners',
 * else the cell goes to its nearest corner's owner.
 */
export function cellOwners(blueprint: MissionBlueprint): Int32Array {
  const { width, height } = blueprint.mapSize;
  const { corners, owners, straightOwners } = cliffLayout(blueprint, true);
  const cells = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const centre = { x: x + 0.5, y: y + 0.5 };
      const straight = blueprint.zones.findLastIndex((zone) => containsPoint(zone.polygon, centre));
      const [cx, cy] = [x >> 1, y >> 1];
      const around = [cy * corners.columns + cx, cy * corners.columns + cx + 1, (cy + 1) * corners.columns + cx, (cy + 1) * corners.columns + cx + 1];
      const moved = around.some((index) => owners[index] !== straightOwners[index]);
      const levels = around.map((index) => corners.levels[index]);
      const nearest = (cy + (y & 1)) * corners.columns + cx + (x & 1);
      cells[y * width + x] = !moved || (straight >= 0 && levels.includes(blueprint.zones[straight]!.elevation)) ? straight : owners[nearest]!;
    }
  }
  return cells;
}

export type RasterizeOptions = {
  /** A melee map's rotation (#214): the terrain comes out the same turned 180° about its centre. */
  readonly symmetry?: Rot180 | undefined;
  /** Zones whose ramp connections up onto them are always the Editor's diagonal ramp: a melee map's mains (#215). */
  readonly diagonalRampsOnto?: ReadonlySet<string> | undefined;
  /**
   * Refuse more cliff sets than a map can use (MAX_MAP_CLIFF_SETS). Set by the compile of a generated
   * map, which writes these sets; beside Kept ground the map keeps its own, and a sync or preview only reads.
   */
  readonly limitCliffSets?: boolean | undefined;
};

export function rasterizeTerrain(blueprint: MissionBlueprint, options: RasterizeOptions = {}): TerrainRasterizationResult {
  const { symmetry, diagonalRampsOnto, limitCliffSets } = options;
  const { width, height } = blueprint.mapSize;
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new Error(`Map size must be even (cliff cells are 2x2): ${width}x${height}`);
  }
  const cellCount = width * height;
  const vertexCount = (width + 1) * (height + 1);


  // Cliffs: corner levels from zone elevations (natural outlines ragged), moved where ramps and
  // bridges need room, then terrain objects' stamps; everything else derived from them. Stamps go
  // over the vertex levels the zones and ramps give, as the Editor applies them; the stamped
  // corners then decide the cliff cells around them.
  const { corners, owners, ramps, terrainObjects, drawn } = cliffLayout(blueprint, false, symmetry, diagonalRampsOnto);
  const vertexCliffLevels = vertexLevels(corners, width, height);
  const drawnCells = drawn === corners ? undefined : syncCellLevels(vertexLevels(drawn, width, height), width, height);
  const terrainObjectWarnings = findTerrainObjectWarnings(terrainObjects, vertexCliffLevels, width);
  stampVertexLevels(terrainObjects, vertexCliffLevels, width);
  stampCorners(terrainObjects, corners);
  const cliffLevels = syncCellLevels(vertexCliffLevels, width, height);
  // Under a stamp the Editor's sync level follows the object's model, which we can't read; the
  // highest of a cell's vertices gives a bridge its full deck (it misses the flares at the ends).
  const objectCells = stampedCells(terrainObjects, width);
  for (const cell of objectCells) {
    const x = cell % width;
    const y = Math.floor(cell / width);
    const at = (vx: number, vy: number): number => vertexCliffLevels[vy * (width + 1) + vx]!;
    cliffLevels[cell] = Math.max(at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1));
  }
  const syncCliff = Uint16Array.from(cliffLevels, (level) => level * 64);
  let terracedCells = 0;
  if (drawnCells) for (let cell = 0; cell < cellCount; cell++) if (drawnCells[cell] !== cliffLevels[cell]) terracedCells++;

  const cellFlags = new Uint8Array(cellCount).fill(CELL_FLAG_GROUND);
  const cliffColumns = width / 2;
  for (const cell of findCliffCells(corners, CLIFF_VARIATION_SEED)) {
    const x = (cell.index % cliffColumns) * 2;
    const y = Math.floor(cell.index / cliffColumns) * 2;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      cellFlags[(y + dy) * width + x + dx] = CELL_FLAG_GROUND | CELL_FLAG_CLIFF;
    }
  }

  // The Editor flags every cell under a stamp as cliff.
  for (const cell of objectCells) cellFlags[cell] = CELL_FLAG_GROUND | CELL_FLAG_CLIFF;

  const cliffHeights = Float32Array.from(vertexCliffLevels, cliffHeight);

  // Ramps overwrite the cliff layer, sync levels, flags and cliff cells in their footprint.
  const cliffCellFlags = new Map(findCliffCells(corners, CLIFF_VARIATION_SEED).map((cell) => [cell.index, cell.flags]));
  // Under a terrain object the model is the wall: no cliff mesh, flags 4|8 as the Editor writes them.
  for (const index of coveredCliffCells(terrainObjects, width)) cliffCellFlags.set(index, TERRAIN_OBJECT_CLIFF_FLAGS);
  for (const ramp of ramps) {
    stampRamp(ramp, { width, height, cliffHeights, syncCliff, cellFlags, cliffCellFlags, vertexCliffLevels });
  }
  // A hidden lowest level is open sky (DL-14): unpathable, as the Editor marks it on 3-7 and 3-11.
  const catalog = blueprintCatalog(blueprint);
  const hidden = hidesLowestLevel(catalog, blueprint);
  for (let cell = 0; cell < cellCount; cell++) if (isCliffCell(false, syncCliff[cell]!, hidden)) cellFlags[cell] = CELL_FLAG_GROUND | CELL_FLAG_CLIFF;
  // Jumps left: a bridge's deck and open sky through a hidden lowest level aren't drawn as cliffs.
  const terraces: TerraceReport = { cells: terracedCells, jumps: cellJumps(syncCliff, width, height, (cell) => objectCells.has(cell) || (hidden && syncCliff[cell] === 0)) };
  // The Zones' hidden cells: the Editor's Hide Terrain brush, written into the flags (zone.hiddenCells).
  const hiddenCells = hiddenCellMask(blueprint, width, height);
  for (let cell = 0; cell < cellCount; cell++) if (hiddenCells[cell]) cellFlags[cell]! |= CELL_FLAG_HIDDEN;
  // Textures, once the cliffs and ramps are known: they follow cliff levels.
  // A generated map's own texture sets (ADR-0016); beside Kept ground they're generating-zones.ts's.
  // Planned for every caller, not only the package writer: the heights below roughen by the
  // textures each block's set paints, so sync-doodads and freeze-set-piece read the package's heights.
  const textures = missionTextures(catalog, blueprint);
  // Each cell's Zone, which both the sets and the paint read.
  const owner = zoneOwners(blueprint);
  const textureSets = hasKeptTerrain(blueprint) ? undefined : generatedTextureSets(blueprint, textures, owner);
  const plan = texturePlan(blueprint, textures, syncCliff, owner, textureSets && { ...textureSets.plan.textures, setOfZone: textureSets.plan.setOfZone, indexOf: textureSets.plan.indexOf });
  const { textureWeights, texelWeights, warnings: textureWarnings } = paintTextures(blueprint, plan, syncCliff, owner, symmetry);

  // Under a symmetry a cliff cell takes the mesh variation of the one it turns onto on the source side.
  const sourceCliffCell = (index: number): number => {
    // Its top-right cell turns onto the source cliff cell's bottom-left one.
    const source = sourceCell(symmetry, (index % cliffColumns) * 2 + 1, Math.floor(index / cliffColumns) * 2 + 1, width, height);
    return (source.y >> 1) * cliffColumns + (source.x >> 1);
  };
  // Cliff sets: each cliff wears the set chosen for the ground on top of it (DL-04).
  const cliffPlan = cliffSetPlan(blueprint, corners, mainLevelOf(syncCliff), owners);
  const plannedCells: CliffCell[] = [...cliffCellFlags]
    .sort(([a], [b]) => a - b)
    .map(([index, flags]) => ({
      index,
      flags,
      variation: cliffVariation(sourceCliffCell(index), CLIFF_VARIATION_SEED),
      cliffSet: cliffPlan.setAt(index % cliffColumns, Math.floor(index / cliffColumns)),
    }));
  const plannedRamps = ramps.map((ramp) => {
    const cliffSet = cliffPlan.setForRamp(ramp);
    return cliffSet === 0 ? ramp : { ...ramp, cliffSet };
  });
  // Only the sets a cliff mesh or a ramp wears are written (and counted).
  const { sets: cliffSets, cells: cliffCells, ramps: placedRamps } = wornCliffSets(cliffPlan.sets, plannedCells, plannedRamps, (flags) => flags === TERRAIN_OBJECT_CLIFF_FLAGS);
  if (limitCliffSets) checkCliffSetCount(cliffSets);

  const heights = new Float32Array(vertexCount);
  const syncHeights = new Int16Array(vertexCount);
  const built = (point: Point): boolean => blueprint.zones.findLast((zone) => containsPoint(zone.polygon, point))?.surface === "built";
  // Curbs and trim straddle a built zone's edge: the ground stays level a cell beyond it, then
  // roughens over the next (a curb on bumps reads as dropped, not laid: the author's review, 2026-10-28).
  const lined = blueprint.zones.filter((zone) => zone.surface === "built" && (zone.edges?.built ?? blueprint.dressing?.edges?.built ?? "none") !== "none");
  // Man-made textures (paving, plating, grating) lie flat wherever they're painted, natural ones
  // take the relief (the author, 2026-10-29): each vertex roughens by the natural share of the
  // cells round it, so a blended seam eases from flat to rough.
  // With texture sets, a layer's texture is the one it has in the cell's block's set.
  const builtLayersBySet = (plan.sets?.names ?? [plan.layerNames]).map((names) => names.map((name) => Boolean(name) && isBuiltTexture(name)));
  const builtLayersAt = (cx: number, cy: number): readonly boolean[] =>
    plan.sets ? builtLayersBySet[plan.sets.blockSets[blockOf(plan.sets.blocksPerRow, cx, cy)]!]! : builtLayersBySet[0]!;
  const naturalShare = (vx: number, vy: number): number => {
    let natural = 0;
    let total = 0;
    for (const [cx, cy] of [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]] as const) {
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      const builtLayers = builtLayersAt(cx, cy);
      for (let layer = 0; layer < 8; layer++) {
        const weight = textureWeights[(cy * width + cx) * 8 + layer]!;
        total += weight;
        if (!builtLayers[layer]) natural += weight;
      }
    }
    return total === 0 ? 1 : natural / total;
  };
  const roughness = (point: Point): number => {
    if (built(point)) return 0;
    const near = Math.min(Infinity, ...lined.map((zone) => distanceToPolygon(zone.polygon, point)));
    return Math.min(1, Math.max(0, near - LEVEL_BEYOND_CURBS), naturalShare(point.x, point.y));
  };
  const relief = groundRelief(symmetry);
  for (let vy = 0; vy <= height; vy++) {
    for (let vx = 0; vx <= width; vx++) {
      const idx = vy * (width + 1) + vx;
      // Gentle rolls (ground-relief.ts) in the base layer; cliffs and ramps live in their own layer.
      // Built ground and man-made textures stay level: relief there reads as a buckled pavement.
      const base = GROUND_HEIGHT + roughness({ x: vx, y: vy }) * relief(vx, vy);
      heights[idx] = base + cliffHeights[idx]!;
    }
  }
  raiseShoreBanks(blueprint, heights, vertexCliffLevels);
  digPools(blueprint, heights);
  applyHeightEdits(blueprint, heights);
  const noPathing = dugPoolPathing(blueprint, heights);
  for (let idx = 0; idx < vertexCount; idx++) syncHeights[idx] = Math.round(heights[idx]! * 256);

  return { textureWeights, texelWeights, textureWarnings, ...(textureSets ? { textureSets } : {}), cellFlags, noPathing, syncCliff, heights, cliffHeights, syncHeights, vertexCliffLevels, cliffCells, cliffSets, ramps: placedRamps, terrainObjects, terrainObjectWarnings, terraces };
}
