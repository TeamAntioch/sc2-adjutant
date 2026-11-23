// A melee map's mains, their ramps and plates, and its standard bases placed on the drawn
// terrain (#215, spec #212; melee research §1 "Base count, mains, naturals", §1 "Main ramp",
// §1 "Watchtowers, rocks").
//
// - Each start base's zone is a main. It sits on the top level, and its one ramp connection goes
//   down one level to its natural. That ramp is always the Editor's diagonal ramp (15 cells, one
//   level, the shape every ladder main ramp has: the narrow one, terrain/ramps.ts); the blueprint
//   sets its position, not its shape.
// - An unbuildable plate stands at the ramp's foot, 5-8 cells from its top, as on every
//   two-player ladder map: one per player.
// - Every resource base is the standard melee base (melee-bases.ts). A start base without a
//   `facing` faces its ramp's uphill direction, away from the main's entrance.

import { type DiagonalFacing, isResourceBase, MELEE_ROCKS, type MeleeMapBlueprint } from "../domain/melee-map-blueprint.js";
import { connectionRampId, containsPoint, type Point, type TerrainRasterizationResult } from "../terrain/rasterize.js";
import { type DiagonalDirection, diagonalVertex, isDiagonal, type Ramp } from "../terrain/ramps.js";
import { type Rot180, rotatePoint } from "../terrain/symmetry.js";
import { type PlacedUnit, townHallSpot } from "./expand-placements.js";
import { meleeBasePieces, meleeTownHallSpot, resourceCells } from "./melee-bases.js";
import { meleeError } from "./melee-rules.js";

/** A main and the natural its ramp goes down to. */
export type MeleeMain = {
  readonly zoneId: string;
  readonly naturalId: string;
  /** The ramp's id as the terrain names a connection's ramp: `<main>-<natural>`. */
  readonly rampId: string;
  /** For the other half's main, the half's main it turns: its plate is that one's turned. */
  readonly rotatedFrom?: string;
};

/** The ladder maps' commonest plate (12 of 21 maps; the rocks and bricks skins are the same unit). */
export const UNBUILDABLE_PLATE = "UnbuildablePlatesDestructible";

/**
 * Each start base's main in the half, checked: on the top level, with one ramp connection to its
 * natural (one level down, as the schema keeps every ramp connection) and no `ramps[]` entry,
 * which would set the ramp's shape. Throws naming the main otherwise.
 */
export function meleeMains(blueprint: MeleeMapBlueprint): MeleeMain[] {
  const zoneById = new Map(blueprint.zones.map((zone) => [zone.id, zone]));
  const top = Math.max(...blueprint.zones.map((zone) => zone.elevation));
  return blueprint.starts.map((startId) => {
    const main = zoneById.get(blueprint.placements.find((placement) => placement.id === startId)!.zoneId)!;
    if (main.elevation < top) {
      const higher = blueprint.zones.find((zone) => zone.elevation === top)!;
      meleeError("main-ramp", `main ${main.id}`, `it's at level ${main.elevation} (start base ${startId}), below ${higher.id} at ${top}: a main sits on the map's top level`);
    }
    const explicit = blueprint.ramps.find((ramp) => ramp.zoneId === main.id);
    if (explicit) {
      meleeError("main-ramp", `main ${main.id}`, `its ramp ${explicit.id} is a ramps[] entry, which sets its shape: a main's ramp is always the diagonal one. Use a ramp connection to its natural, with \`at\` for its position`);
    }
    const others = new Set<string>();
    for (const zone of blueprint.zones) {
      for (const connection of zone.connections) {
        if (connection.type !== "ramp") continue;
        if (zone.id === main.id) others.add(connection.toZoneId);
        else if (connection.toZoneId === main.id) others.add(zone.id);
      }
    }
    if (others.size !== 1) {
      meleeError(
        "main-ramp",
        `main ${main.id}`,
        others.size === 0
          ? "it has no ramp connection: give it one, down one level to its natural"
          : `it has ramp connections to ${[...others].join(", ")}: a main has one ramp, down to its natural`,
      );
    }
    // The schema keeps a ramp connection to zones one level apart, and the main is on top: so the natural is one below.
    const natural = zoneById.get([...others][0]!)!;
    return { zoneId: main.id, naturalId: natural.id, rampId: connectionRampId(main.id, natural.id) };
  });
}

/** The half's mains and their turned copies: the other half's mains, each listed after its source. */
export function withRotatedMains(mains: readonly MeleeMain[], symmetry: Rot180): MeleeMain[] {
  const partner = (zoneId: string): string => symmetry.zonePartners.get(zoneId) ?? zoneId;
  return mains.flatMap((main) => {
    const [zoneId, naturalId] = [partner(main.zoneId), partner(main.naturalId)];
    return [main, { zoneId, naturalId, rampId: connectionRampId(zoneId, naturalId), rotatedFrom: main.zoneId }];
  });
}

/** The facing a diagonal ramp's uphill direction gives a base above it: away from the ramp. */
const UPHILL_FACING: Readonly<Record<DiagonalDirection, DiagonalFacing>> = { 4: "south-west", 5: "south-east", 6: "north-west", 7: "north-east" };

/**
 * Plate spots, by offset from the ramp's top (its `edge`, the base of the narrow diagonal ramp) in
 * the north-east ramp's frame: beside the foot, √45 ≈ 6.7 cells from the top. On the 48 ladder
 * main ramps (21 maps), 25 plates sit at the first and 9 at the second, mirrored across the ramp;
 * the rest 7.2-8.1 cells away. The second if the first isn't on the natural's flat ground.
 */
const PLATE_OFFSETS: readonly (readonly [number, number])[] = [
  [-3, -6],
  [-6, -3],
];

/** The plate's centre at a main ramp's foot: on whole coordinates, as its 2×2 footprint sits. */
export function unbuildablePlateSpot(ramp: Ramp, terrain: TerrainRasterizationResult, width: number, natural: { readonly polygon: readonly Point[] }): Point | undefined {
  const flat = 64 * ramp.lowLevel;
  for (const [dx, dy] of PLATE_OFFSETS) {
    const spot = diagonalVertex(ramp, dx, dy);
    const cells = [
      [spot.x - 1, spot.y - 1],
      [spot.x, spot.y - 1],
      [spot.x - 1, spot.y],
      [spot.x, spot.y],
    ] as const;
    const fits = cells.every(([x, y]) => {
      const index = y * width + x;
      return terrain.syncCliff[index] === flat && flatGround(terrain, width, x, y) && containsPoint(natural.polygon, { x: x + 0.5, y: y + 0.5 });
    });
    if (fits) return spot;
  }
  return undefined;
}

/**
 * The map's units on its drawn terrain: each resource base as the standard melee base, and each
 * main's plate (the half's placed, the other half's turned from them). Warns about a piece outside
 * its zone or on a cliff. Throws if a main's ramp isn't diagonal, if the town-hall rule doesn't
 * find a start base's town hall on its spot, or if a ramp's foot has no room for the plate.
 */
export function placeMeleeUnits(
  blueprint: MeleeMapBlueprint,
  mains: readonly MeleeMain[],
  terrain: TerrainRasterizationResult,
  symmetry?: Rot180,
): { units: PlacedUnit[]; warnings: string[] } {
  const { width } = blueprint.mapSize;
  const zoneById = new Map(blueprint.zones.map((zone) => [zone.id, zone]));
  const rampById = new Map(terrain.ramps.map((ramp) => [ramp.id, ramp]));
  const units: PlacedUnit[] = [];
  const warnings: string[] = [];

  const mainRamps = new Map(
    mains.map((main) => {
      const ramp = rampById.get(main.rampId);
      if (!ramp || !isDiagonal(ramp.direction)) {
        meleeError("main-ramp", `main ${main.zoneId}`, `it has no diagonal ramp down to ${main.naturalId}; give it a ramp connection to ${main.naturalId} at a corner of ${main.zoneId}`);
      }
      return [main.zoneId, ramp] as const;
    }),
  );

  for (const placement of blueprint.placements) {
    if (!isResourceBase(placement)) {
      const { at, size } = placement.params;
      units.push({ id: `${placement.id}/rocks`, zoneId: placement.zoneId, unitType: MELEE_ROCKS[size], x: at.x, y: at.y, rotation: 0 });
      continue;
    }
    const { at, minerals, gas } = placement.params;
    const ramp = mainRamps.get(placement.zoneId);
    const start = blueprint.starts.includes(placement.id);
    // The schema asks every base but a start for a facing; a start's main has its ramp by now.
    const facing = placement.params.facing ?? UPHILL_FACING[ramp!.direction as DiagonalDirection];
    const [hx, hy] = townHallSpot(at);
    const zone = zoneById.get(placement.zoneId)!;
    const pieces = meleeBasePieces({ x: hx, y: hy }, facing, { minerals, gas });
    if (start) checkTownHall(placement.id, { x: hx, y: hy }, pieces, terrain, width);
    for (const piece of pieces) {
      const id = `${placement.id}/${piece.label}`;
      units.push({ id, zoneId: placement.zoneId, unitType: piece.unitType, x: piece.x, y: piece.y, rotation: 0 });
      const cells = resourceCells(piece);
      const problem = cells.some(([x, y]) => !containsPoint(zone.polygon, { x: x + 0.5, y: y + 0.5 }))
        ? "outside its zone"
        : cells.some(([x, y]) => !flatGround(terrain, width, x, y))
          ? "on a cliff or ramp"
          : undefined;
      if (problem) warnings.push(`${id} (${piece.unitType} at ${piece.x}, ${piece.y}) stands ${problem}; move the base's \`at\` or turn its \`facing\`.`);
    }
  }

  const plates = new Map<string, Point>();
  for (const main of mains) {
    const ramp = mainRamps.get(main.zoneId)!;
    const source = main.rotatedFrom !== undefined ? plates.get(main.rotatedFrom) : undefined;
    const spot = source && symmetry ? rotatePoint(symmetry, source) : unbuildablePlateSpot(ramp, terrain, width, zoneById.get(main.naturalId)!);
    if (!spot) {
      meleeError("main-ramp", `main ${main.zoneId}`, `its ramp at (${ramp.edge.x}, ${ramp.edge.y}) has no flat ground of ${main.naturalId} at its foot for the unbuildable plate; give the natural room below the ramp`);
    }
    plates.set(main.zoneId, spot);
    units.push({ id: `${main.zoneId}/unbuildable-plate`, zoneId: main.naturalId, unitType: UNBUILDABLE_PLATE, ...spot, rotation: 0 });
  }
  return { units, warnings };
}

/** Whether a cell is level ground: under no cliff mesh, and not on a ramp. */
function flatGround(terrain: TerrainRasterizationResult, width: number, x: number, y: number): boolean {
  const index = y * width + x;
  return x >= 0 && y >= 0 && x < width && index < terrain.syncCliff.length && (terrain.cellFlags[index]! & 0x01) === 0 && terrain.syncCliff[index]! % 64 === 0;
}

/**
 * Our port of Blizzard's town-hall rule (research §0) must find a start base's town hall on its
 * spot, the StartLoc, as it does on every ladder map: else the 5×5 there isn't level ground clear
 * of the resources' NearResources ring, and the game would put the town hall elsewhere.
 */
function checkTownHall(id: string, hall: Point, pieces: Parameters<typeof meleeTownHallSpot>[0], terrain: TerrainRasterizationResult, width: number): void {
  const found = meleeTownHallSpot(pieces, { buildable: (x, y) => flatGround(terrain, width, x, y), level: (x, y) => terrain.syncCliff[y * width + x]! });
  if (found?.x === hall.x && found.y === hall.y) return;
  meleeError(
    "start-base",
    `start base ${id}`,
    `the town-hall rule puts its town hall at ${found ? `(${found.x}, ${found.y})` : "no spot"}, not on its StartLoc (${hall.x}, ${hall.y}): ` +
      "the 5×5 there isn't level ground. Move its `at` onto open ground in the main",
  );
}
