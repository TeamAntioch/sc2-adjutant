// Expands built `resource-base` and `encounter-group` Placements (those with `at`) into placed
// units at compile time, in Blizzard's shapes (enemy-ai §3.6):
//
// - A resource base leaves its town-hall spot empty (or puts an enemy's town hall and workers on it), arcs its mineral fields 6.5-7.5 cells out on
//   its `facing` side and stands a geyser at each end of the arc. Taken from the cleanest of the
//   symmetric bases in the campaign corpus: fields at (±1.5, 7), (±2.5, 6), (±5.5, 5), (±6.5, 4)
//   and geysers at (±7, 0) round a hall facing north. Other facings rotate the arc and snap each
//   piece to its footprint's grid, pushing it outward until nothing overlaps.
// - An encounter group packs its structures round `at` (a camp's Pylon in the middle), puts its
//   defences on an arc toward `facing`, and stands its units in front of them.
//
// Every piece keeps a 2-cell lane round the town-hall spot and a 1-cell gap from other buildings,
// so workers and armies can walk between them. Pieces are seeded by `<placement>/<role>/<index>`,
// so editing one placement leaves the rest where they were.
//
// Every enemy piece carries its AI settings (src/ai/enemy-ai.ts): rebuilt or not by type, kept out
// of attack waves, and active by difficulty. Casual drops the tail of each group's units; Hard and
// Brutal add copies of the group's units, placed with them but active only on those difficulties.

import {
  EncounterGroupParamsSchema,
  type Facing,
  type MissionBlueprint,
  ResourceBaseParamsSchema,
} from "../domain/mission-blueprint.js";
import { BRUTAL_ONLY, enemyAiSettings, HARD_UP, NOT_CASUAL, type UnitAi, unitAi } from "../ai/enemy-ai.js";
import { containsPoint, type TerrainRasterizationResult } from "../terrain/rasterize.js";
import { type Rot180, rotatePoint } from "../terrain/symmetry.js";

/** One unit a placement places. */
export type PlacedUnit = {
  /** Stable across recompiles: `<placement>/<role>/<index>`. */
  readonly id: string;
  readonly zoneId: string;
  readonly unitType: string;
  readonly player?: number | undefined;
  readonly x: number;
  readonly y: number;
  /** Radians. */
  readonly rotation: number;
  readonly resources?: number | undefined;
  /** An enemy unit's AI settings (rebuild, difficulty, kept out of waves). */
  readonly ai?: UnitAi | undefined;
};

type Rect = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

const FACING_ANGLE: Record<Facing, number> = {
  east: 0,
  "north-east": 45,
  north: 90,
  "north-west": 135,
  west: 180,
  "south-west": 225,
  south: 270,
  "south-east": 315,
};

/** Footprint in cells; unlisted structures are taken as 3×3. */
const FOOTPRINT: Record<string, readonly [number, number]> = {
  MineralField: [2, 1],
  MineralField750: [2, 1],
  RichMineralField: [2, 1],
  RichMineralField750: [2, 1],
  VespeneGeyser: [3, 3],
  RichVespeneGeyser: [3, 3],
  Assimilator: [3, 3],
  Nexus: [5, 5],
  Pylon: [2, 2],
  PhotonCannon: [2, 2],
  ShieldBattery: [2, 2],
};
const footprint = (type: string): readonly [number, number] => FOOTPRINT[type] ?? [3, 3];

const HALL: readonly [number, number] = [5, 5];
/** Clear ground round the town-hall spot: Blizzard's corner fields stand 2 cells off it. */
const HALL_LANE = 2;
/** Clear ground between buildings. */
const GAP = 1;
/** Room a standing unit takes, so none stands inside a building. */
const UNIT_ROOM = 1.5;

/** North-facing arc offsets from the hall's centre, nearest the middle first. */
const MINERAL_ARC: readonly (readonly [number, number])[] = [
  [-1.5, 7],
  [1.5, 7],
  [-2.5, 6],
  [2.5, 6],
  [-5.5, 5],
  [5.5, 5],
  [-6.5, 4],
  [6.5, 4],
];
const GEYSER_ARC: readonly (readonly [number, number])[] = [
  [-7, 0],
  [7, 0],
];

const MINERAL_TYPES: Record<"small" | "normal" | "rich", readonly [string, string]> = { small: ["MineralField", "MineralField750"], normal: ["MineralField", "MineralField750"], rich: ["RichMineralField", "RichMineralField750"] };
const MINERAL_AMOUNTS = [1800, 900];
const GAS = {
  small: { count: 1, type: "VespeneGeyser", amount: 400 },
  poor: { count: 2, type: "VespeneGeyser", amount: 600 },
  normal: { count: 2, type: "VespeneGeyser", amount: 2250 },
  rich: { count: 2, type: "RichVespeneGeyser", amount: 2250 },
};

/** Rotates a north-facing offset (+y) to the given facing. */
function rotate(facing: Facing, x: number, y: number): [number, number] {
  const a = ((FACING_ANGLE[facing] - 90) * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
}

/** Snaps a centre to its footprint's grid: odd sizes sit on .5, even ones on whole cells. */
function snap(value: number, size: number): number {
  return size % 2 === 1 ? Math.floor(value) + 0.5 : Math.round(value);
}

function rectOf(x: number, y: number, [w, h]: readonly [number, number], margin = 0): Rect {
  return { x0: x - w / 2 - margin, y0: y - h / 2 - margin, x1: x + w / 2 + margin, y1: y + h / 2 + margin };
}

/** The centre of the town-hall spot a resource base's `at` gives: its 5×5 footprint on the cell grid. */
export function townHallSpot(at: { readonly x: number; readonly y: number }): [number, number] {
  return [snap(at.x, HALL[0]), snap(at.y, HALL[1])];
}

const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

type Expansion = { readonly units: PlacedUnit[]; readonly warnings: string[] };

export type ExpandPlacementsOptions = {
  /**
   * A melee map's rotation (#214): a rotated resource base takes its source's pieces turned 180°,
   * as snapping each piece to its grid on its own would land some a cell off their partners.
   * Each rotated placement comes after its source.
   */
  readonly symmetry?: Rot180 | undefined;
};

/**
 * Builds every placement with `at`. With terrain, warns about pieces standing outside their zone
 * or on a cliff; the piece is placed anyway, for the author to move.
 */
export function expandPlacements(blueprint: MissionBlueprint, terrain?: TerrainRasterizationResult, options: ExpandPlacementsOptions = {}): Expansion {
  const { symmetry } = options;
  const units: PlacedUnit[] = [];
  const warnings: string[] = [];
  const settings = enemyAiSettings(blueprint.enemyAi);
  const ai = (type: string, player: number | undefined) => (player !== undefined && player >= 2 ? unitAi(settings, type) : undefined);
  const taken: Rect[] = [];
  const { width } = blueprint.mapSize;

  // A built pad laid over a zone (a camp's floor, a plaza) is that zone's ground dressing, not a
  // zone of its own, so it doesn't take the zone's pieces away.
  const zoneAt = (zoneId: string, x: number, y: number): string | undefined =>
    blueprint.zones.findLast((zone) => (zone.surface !== "built" || zone.id === zoneId) && containsPoint(zone.polygon, { x, y }))?.id;
  const misplaced = (zoneId: string, x: number, y: number, size: readonly [number, number]): string | undefined => {
    const rect = rectOf(x, y, size);
    for (let cy = Math.floor(rect.y0); cy < Math.ceil(rect.y1); cy++) {
      for (let cx = Math.floor(rect.x0); cx < Math.ceil(rect.x1); cx++) {
        if (zoneAt(zoneId, cx + 0.5, cy + 0.5) !== zoneId) return "outside its zone";
        if (terrain && (terrain.cellFlags[cy * width + cx]! & 0x01) !== 0) return "on a cliff";
      }
    }
    return undefined;
  };

  /** Finds the nearest free spot along `direction` from `start`, records it and returns it; undefined when there's none. */
  const place = (
    start: readonly [number, number],
    direction: readonly [number, number],
    size: readonly [number, number],
    margin: number,
    accept: (x: number, y: number) => boolean = () => true,
  ): [number, number] | undefined => {
    for (let step = 0; step < 24; step++) {
      const x = snap(start[0] + direction[0] * step * 0.5, size[0]);
      const y = snap(start[1] + direction[1] * step * 0.5, size[1]);
      const rect = rectOf(x, y, size);
      if (accept(x, y) && !taken.some((other) => overlaps(rectOf(x, y, size, margin), other) || overlaps(rect, other))) {
        taken.push(rect);
        return [x, y];
      }
    }
    return undefined;
  };
  /** Takes `start` whatever overlaps it; the misplacement check reports the result. */
  const force = (start: readonly [number, number], size: readonly [number, number]): [number, number] => {
    const spot: [number, number] = [snap(start[0], size[0]), snap(start[1], size[1])];
    taken.push(rectOf(spot[0], spot[1], size));
    return spot;
  };

  const add = (placementId: string, zoneId: string, label: string, unit: Omit<PlacedUnit, "id" | "zoneId">, size?: readonly [number, number]): void => {
    const id = `${placementId}/${label}`;
    units.push({ id, zoneId, ...unit });
    const problem = size ? misplaced(zoneId, unit.x, unit.y, size) : zoneAt(zoneId, unit.x, unit.y) === zoneId ? undefined : "outside its zone";
    if (problem) warnings.push(`${id} (${unit.unitType} at ${unit.x}, ${unit.y}) stands ${problem}; move the placement's \`at\` or turn its \`facing\`.`);
  };

  const unitDirection = (vector: readonly [number, number]): [number, number] => {
    const length = Math.hypot(vector[0], vector[1]) || 1;
    return [vector[0] / length, vector[1] / length];
  };

  // Resource bases first: their town-hall spots and mineral lines are fixed, camps fit round them.
  for (const placement of blueprint.placements) {
    if (placement.kind !== "resource-base" || placement.params["at"] === undefined) continue;
    const source = symmetry?.rotatedFrom.get(placement.id);
    if (symmetry && source !== undefined) {
      // Its town-hall lane, as its source's: later bases keep clear of both.
      const hall = townHallSpot(ResourceBaseParamsSchema.parse(placement.params).at!);
      taken.push(rectOf(hall[0], hall[1], HALL, HALL_LANE));
      for (const unit of units.filter((candidate) => candidate.id.startsWith(`${source}/`))) {
        const { x, y } = rotatePoint(symmetry, unit);
        const label = unit.id.slice(source.length + 1);
        const size = label === "town-hall" ? HALL : footprint(unit.unitType);
        const rect = rectOf(x, y, size);
        // Near the centre a base's copy can land on the base itself.
        if (taken.some((other) => overlaps(rect, other))) {
          warnings.push(`${placement.id}/${label} (${unit.unitType} at ${x}, ${y}), ${source}'s turned 180°, overlaps another piece; move ${source} further from the centre.`);
        }
        taken.push(rect);
        const { id: _id, zoneId: _zoneId, ...piece } = unit;
        add(placement.id, placement.zoneId, label, { ...piece, x, y, rotation: (unit.rotation + Math.PI) % (2 * Math.PI) }, label.startsWith("worker/") ? undefined : size);
      }
      continue;
    }
    const params = ResourceBaseParamsSchema.parse(placement.params);
    const hall = townHallSpot(params.at!);
    const hallLane = rectOf(hall[0], hall[1], HALL, HALL_LANE);
    taken.push(hallLane);
    const facingRotation = (FACING_ANGLE[params.facing] * Math.PI) / 180;

    const pieceAt = (offset: readonly [number, number], size: readonly [number, number]): [number, number] => {
      const [dx, dy] = rotate(params.facing, offset[0], offset[1]);
      // Push outward from the hall until clear of the lane round it and of other pieces.
      const out = unitDirection([dx, dy]);
      for (let step = 0; step < 24; step++) {
        const x = snap(hall[0] + dx + out[0] * step * 0.5, size[0]);
        const y = snap(hall[1] + dy + out[1] * step * 0.5, size[1]);
        const rect = rectOf(x, y, size);
        if (!taken.some((other) => overlaps(rect, other))) {
          taken.push(rect);
          return [x, y];
        }
      }
      return [snap(hall[0] + dx, size[0]), snap(hall[1] + dy, size[1])];
    };

    if (params.minerals !== "none") {
      const [near, far] = MINERAL_TYPES[params.minerals];
      const arc = params.minerals === "small" ? MINERAL_ARC.slice(0, 4) : MINERAL_ARC;
      arc.forEach((offset, index) => {
        const type = index % 2 === 0 ? near : far;
        const [x, y] = pieceAt(offset, footprint(type));
        add(placement.id, placement.zoneId, `mineral/${index}`, { unitType: type, x, y, rotation: 0, resources: MINERAL_AMOUNTS[index % 2] }, footprint(type));
      });
    }
    if (params.townHall) {
      const { player, type, worker, workers } = params.townHall;
      add(placement.id, placement.zoneId, "town-hall", { unitType: type, player, x: hall[0], y: hall[1], rotation: facingRotation, ai: ai(type, player) }, HALL);
      // Workers stand in the lane between the hall and its minerals, spread along the arc.
      for (let index = 0; index < workers; index++) {
        const spread = workers === 1 ? 0 : (index / (workers - 1) - 0.5) * 100;
        const [dx, dy] = rotate(params.facing, ...polar(90 + spread, 4 + (index % 2) * 0.8));
        const x = Math.round((hall[0] + dx) * 10) / 10;
        const y = Math.round((hall[1] + dy) * 10) / 10;
        add(placement.id, placement.zoneId, `worker/${index}`, { unitType: worker, player, x, y, rotation: facingRotation, ai: ai(worker, player) });
      }
    }
    if (params.gas !== "none") {
      const gas = GAS[params.gas];
      GEYSER_ARC.slice(0, gas.count).forEach((offset, index) => {
        const type = params.assimilators !== undefined ? "Assimilator" : gas.type;
        const [x, y] = pieceAt(offset, footprint(type));
        add(
          placement.id,
          placement.zoneId,
          `${params.assimilators !== undefined ? "assimilator" : "geyser"}/${index}`,
          { unitType: type, player: params.assimilators, x, y, rotation: facingRotation, resources: gas.amount, ai: ai(type, params.assimilators) },
          footprint(type),
        );
      });
    }
  }

  for (const placement of blueprint.placements) {
    if (placement.kind !== "encounter-group" || placement.params["at"] === undefined) continue;
    const params = EncounterGroupParamsSchema.parse(placement.params);
    const at = params.at!;
    const facing = rotate(params.facing, 0, 1);
    const rotation = (FACING_ANGLE[params.facing] * Math.PI) / 180;

    // Structures: the first at `at`, the rest round it, nearest free spot along a turning spoke;
    // a building that needs power keeps within reach of one of the group's Pylons.
    const pylons: [number, number][] = [];
    const inPower = (type: string) => (x: number, y: number) =>
      !POWERED.has(type) || pylons.length === 0 || pylons.some(([px, py]) => Math.hypot(px - x, py - y) <= 6.5);
    params.structures.forEach((type, index) => {
      const turn = index === 0 ? [0, 0] : rotate(params.facing, Math.cos(index * 2.4), Math.sin(index * 2.4));
      const direction = unitDirection(turn as [number, number]);
      let spot: [number, number] | undefined;
      for (let spoke = 0; spoke < 12 && !spot; spoke++) {
        const a = (spoke * Math.PI) / 6;
        const turned = spoke === 0 ? direction : unitDirection([direction[0] * Math.cos(a) - direction[1] * Math.sin(a), direction[0] * Math.sin(a) + direction[1] * Math.cos(a)]);
        spot = place([at.x, at.y], turned, footprint(type), GAP, inPower(type));
      }
      const [x, y] = spot ?? force([at.x, at.y], footprint(type));
      if (type === "Pylon") pylons.push([x, y]);
      add(placement.id, placement.zoneId, `structure/${index}`, { unitType: type, player: params.player, x, y, rotation, ai: ai(type, params.player) }, footprint(type));
    });

    // Defences: an arc toward the approach, spread just far enough apart to leave a gap between them.
    params.defences.forEach((type, index) => {
      const chord = Math.max(...footprint(type)) + GAP;
      const step = Math.max(30, (2 * Math.asin(Math.min(1, chord / (2 * params.defenceRadius))) * 180) / Math.PI);
      const spread = (index - (params.defences.length - 1) / 2) * step;
      const [dx, dy] = rotate(params.facing, ...polar(90 + spread, params.defenceRadius));
      const start: [number, number] = [at.x + dx, at.y + dy];
      const [x, y] = place(start, unitDirection([dx, dy]), footprint(type), GAP) ?? force(start, footprint(type));
      add(placement.id, placement.zoneId, `defence/${index}`, { unitType: type, player: params.player, x, y, rotation, ai: ai(type, params.player) }, footprint(type));
    });

    // Units: a loose knot just in front of what the group built, facing the approach.
    const built = units.filter((unit) => unit.id.startsWith(`${placement.id}/`));
    const reach = Math.max(0, ...built.map((unit) => (unit.x - at.x) * facing[0] + (unit.y - at.y) * facing[1] + Math.max(...footprint(unit.unitType)) / 2));
    const front = built.length > 0 ? reach + 1 : 0;
    const centre = [at.x + facing[0] * front, at.y + facing[1] * front];
    // Casual keeps the head of the list; Hard and Brutal add copies of it, active only there.
    const count = params.units.length;
    const kept = Math.max(1, Math.round(count * settings.casual.keep));
    const hardExtra = Math.round(count * settings.hard.extra);
    const brutalExtra = Math.max(hardExtra, Math.round(count * settings.brutal.extra));
    const knot = [
      ...params.units.map((type, index) => ({ type, label: `unit/${index}`, active: index < kept ? undefined : NOT_CASUAL })),
      ...Array.from({ length: count > 0 ? brutalExtra : 0 }, (_, index) => ({
        type: params.units[index % count]!,
        label: `extra/${index}`,
        active: index < hardExtra ? HARD_UP : BRUTAL_ONLY,
      })),
    ];
    // A knot spread across the approach, shallower along it, so a big group stays a line.
    knot.forEach(({ type, label, active }, index) => {
      const radius = index === 0 ? 0 : 1.1 * Math.sqrt(index);
      const [dx, dy] = rotate(params.facing, Math.cos(index * 2.4) * radius, Math.sin(index * 2.4) * radius * 0.6);
      // Step forward until clear of every building's footprint, with room for the unit itself.
      let [px, py] = [centre[0]! + dx, centre[1]! + dy];
      for (let step = 0; step < 16 && taken.some((rect) => overlaps(rectOf(px, py, [UNIT_ROOM, UNIT_ROOM]), rect)); step++) {
        px += facing[0] * 0.5;
        py += facing[1] * 0.5;
      }
      const x = Math.round(px * 10) / 10;
      const y = Math.round(py * 10) / 10;
      const base = ai(type, params.player);
      add(placement.id, placement.zoneId, label, { unitType: type, player: params.player, x, y, rotation, ai: base && active ? { ...base, active } : base });
    });
  }

  // Protoss buildings need a Pylon of their player within 6.5 cells, or they stand unpowered.
  for (const unit of units) {
    if (!POWERED.has(unit.unitType)) continue;
    const powered = units.some((pylon) => pylon.unitType === "Pylon" && pylon.player === unit.player && Math.hypot(pylon.x - unit.x, pylon.y - unit.y) <= 6.5);
    if (!powered) warnings.push(`${unit.id} (${unit.unitType} at ${unit.x}, ${unit.y}) has no Pylon within 6.5 cells; add or move one earlier in \`structures\`.`);
  }

  return { units, warnings };
}

/** Protoss buildings that need Pylon power. */
const POWERED = new Set([
  "Gateway",
  "WarpGate",
  "Forge",
  "CyberneticsCore",
  "TwilightCouncil",
  "RoboticsFacility",
  "RoboticsBay",
  "Stargate",
  "FleetBeacon",
  "TemplarArchive",
  "DarkShrine",
  "PhotonCannon",
  "ShieldBattery",
]);

/** A north-facing offset at `degrees` (90 = straight ahead) and `radius`. */
function polar(degrees: number, radius: number): [number, number] {
  const a = (degrees * Math.PI) / 180;
  return [Math.cos(a) * radius, Math.sin(a) * radius];
}
