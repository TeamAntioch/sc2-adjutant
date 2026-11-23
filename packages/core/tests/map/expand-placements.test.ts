import { describe, expect, it } from "vitest";

import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { expandPlacements, type PlacedUnit } from "../../src/map/expand-placements.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A flat 64×64 field holding whatever placements the test gives it. */
function blueprint(placements: Record<string, unknown>[]) {
  return MissionBlueprintSchema.parse({
    id: "bases",
    campaignId: "test",
    title: "Bases",
    setting: "test",
    mapSize: { width: 64, height: 64 },
    tilesetId: "MarSara",
    zones: [{ id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) }],
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    placements,
    screenplay: { title: "Bases" },
  });
}

const resourceBase = (params: Record<string, unknown>) => ({ id: "res", zoneId: "field", kind: "resource-base", params: { at: { x: 32.5, y: 32.5 }, ...params } });

const SIZE: Record<string, number[]> = { Pylon: [2, 2], PhotonCannon: [2, 2], Assimilator: [3, 3], VespeneGeyser: [3, 3], RichVespeneGeyser: [3, 3], Nexus: [5, 5] };
const box = (unit: PlacedUnit) => {
  const [w, h] = unit.unitType.includes("Mineral") ? [2, 1] : (SIZE[unit.unitType] ?? [3, 3]);
  return { x0: unit.x - w! / 2, y0: unit.y - h! / 2, x1: unit.x + w! / 2, y1: unit.y + h! / 2 };
};
const overlapping = (units: PlacedUnit[]) =>
  units.flatMap((a, i) =>
    units.slice(i + 1).flatMap((b) => {
      const p = box(a);
      const q = box(b);
      return p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1 ? [`${a.id} ${b.id}`] : [];
    }),
  );

describe("resource bases", () => {
  it("arcs eight fields round an empty town-hall spot and puts a geyser at each end, as Blizzard does", () => {
    const { units, warnings } = expandPlacements(blueprint([resourceBase({ facing: "north" })]));
    expect(warnings).toEqual([]);
    const offsets = units.map((unit) => [unit.unitType, unit.x - 32.5, unit.y - 32.5, unit.resources]);
    expect(offsets).toEqual([
      ["MineralField", -1.5, 7, 1800],
      ["MineralField750", 1.5, 7, 900],
      ["MineralField", -2.5, 6, 1800],
      ["MineralField750", 2.5, 6, 900],
      ["MineralField", -5.5, 5, 1800],
      ["MineralField750", 5.5, 5, 900],
      ["MineralField", -6.5, 4, 1800],
      ["MineralField750", 6.5, 4, 900],
      ["VespeneGeyser", -7, 0, 2250],
      ["VespeneGeyser", 7, 0, 2250],
    ]);
  });

  it("turns to every facing without overlaps, keeping a 2-cell lane round the town-hall spot", () => {
    for (const facing of ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]) {
      const { units } = expandPlacements(blueprint([resourceBase({ facing })]));
      expect(units, facing).toHaveLength(10);
      expect(overlapping(units), facing).toEqual([]);
      for (const unit of units) {
        const b = box(unit);
        const lane = { x0: 32.5 - 4.5, y0: 32.5 - 4.5, x1: 32.5 + 4.5, y1: 32.5 + 4.5 };
        expect(b.x0 < lane.x1 && lane.x0 < b.x1 && b.y0 < lane.y1 && lane.y0 < b.y1, `${facing} ${unit.id}`).toBe(false);
      }
    }
  });

  it("sizes the base from its params and puts a camp's Assimilators on the geysers", () => {
    const { units } = expandPlacements(blueprint([resourceBase({ facing: "south", minerals: "small", gas: "small", assimilators: 2 })]));
    expect(units.filter((unit) => unit.unitType.startsWith("MineralField"))).toHaveLength(4);
    expect(units.filter((unit) => unit.unitType === "Assimilator")).toEqual([expect.objectContaining({ player: 2, resources: 400 })]);
    const rich = expandPlacements(blueprint([resourceBase({ minerals: "rich", gas: "rich" })])).units;
    expect(new Set(rich.map((unit) => unit.unitType))).toEqual(new Set(["RichMineralField", "RichMineralField750", "RichVespeneGeyser"]));
  });

  it("puts an enemy's town hall on the spot, with its workers between it and the minerals", () => {
    const { units, warnings } = expandPlacements(blueprint([resourceBase({ facing: "north", townHall: { player: 3, workers: 6 } })]));
    expect(warnings).toEqual([]);
    expect(units.find((unit) => unit.unitType === "Nexus")).toMatchObject({ player: 3, x: 32.5, y: 32.5 });
    const probes = units.filter((unit) => unit.unitType === "Probe");
    expect(probes).toHaveLength(6);
    for (const probe of probes) {
      expect(probe.player).toBe(3);
      expect(probe.y).toBeGreaterThan(32.5 + 2.5);
      expect(probe.y).toBeLessThan(32.5 + 6);
    }
  });

  it("leaves placements without `at` to the checker, whatever their params", () => {
    const checkerOnly = blueprint([{ id: "res", zoneId: "field", kind: "resource-base", params: { richMineralFields: true, note: "free-form" } }]);
    expect(expandPlacements(checkerOnly).units).toEqual([]);
    expect(() => blueprint([resourceBase({ facing: "up" })])).toThrow();
  });
});

describe("encounter groups", () => {
  const camp = (params: Record<string, unknown>) => ({
    id: "camp",
    zoneId: "field",
    kind: "encounter-group",
    params: { at: { x: 32, y: 20 }, facing: "south", units: ["Zealot", "Stalker", "Stalker"], structures: ["Pylon"], defences: ["PhotonCannon", "PhotonCannon"], defenceRadius: 3, ...params },
  });

  it("puts the Pylon at `at`, Cannons toward the approach in its power, and the guards in front", () => {
    const { units, warnings } = expandPlacements(blueprint([camp({})]));
    expect(warnings).toEqual([]);
    const [pylon, ...cannons] = units.filter((unit) => unit.unitType !== "Zealot" && unit.unitType !== "Stalker");
    expect(pylon).toMatchObject({ unitType: "Pylon", x: 32, y: 20, player: 2 });
    expect(cannons).toHaveLength(2);
    for (const cannon of cannons) {
      expect(cannon.y).toBeLessThan(20);
      expect(Math.hypot(cannon.x - 32, cannon.y - 20)).toBeLessThanOrEqual(6.5);
    }
    const guards = units.filter((unit) => unit.id.startsWith("camp/unit/"));
    expect(guards).toHaveLength(3);
    for (const guard of guards) expect(guard.y).toBeLessThan(Math.min(...cannons.map((cannon) => cannon.y)));
  });

  it("never stands a unit inside a building, however big the group", () => {
    const big = camp({ units: Array(14).fill("Stalker"), defences: ["PhotonCannon", "PhotonCannon", "PhotonCannon"] });
    const { units } = expandPlacements(blueprint([big]));
    const buildings = units.filter((unit) => unit.unitType === "Pylon" || unit.unitType === "PhotonCannon").map(box);
    for (const unit of units.filter((unit) => unit.unitType === "Stalker")) {
      for (const b of buildings) {
        const inside = unit.x > b.x0 - 0.5 && unit.x < b.x1 + 0.5 && unit.y > b.y0 - 0.5 && unit.y < b.y1 + 0.5;
        expect(inside, `${unit.id} at ${unit.x}, ${unit.y}`).toBe(false);
      }
    }
    expect(overlapping(units.filter((unit) => !["Zealot", "Stalker"].includes(unit.unitType)))).toEqual([]);
  });

  it("keeps a base's buildings in its Pylons' power and clear of the resource base", () => {
    const base = camp({ at: { x: 32, y: 14 }, structures: ["Nexus", "Pylon", "Gateway", "CyberneticsCore", "Pylon", "Gateway", "Forge"], defences: [] });
    const { units, warnings } = expandPlacements(blueprint([resourceBase({ facing: "north" }), base]));
    expect(warnings).toEqual([]);
    expect(overlapping(units.filter((unit) => !["Zealot", "Stalker"].includes(unit.unitType)))).toEqual([]);
  });

  it("counts a built pad inside a zone as that zone's ground", () => {
    const base = camp({ at: { x: 32, y: 14 }, structures: ["Nexus", "Pylon", "Gateway"], defences: ["PhotonCannon"] });
    const padded = blueprint([resourceBase({ facing: "north" }), base]);
    padded.zones.push({ ...padded.zones[0]!, id: "pad", name: "Pad", role: "path", surface: "built", polygon: rect(20, 6, 44, 40), connections: [] });
    expect(expandPlacements(padded).warnings).toEqual([]);
  });

  it("still warns about pieces on a natural zone laid over theirs", () => {
    const covered = blueprint([camp({ at: { x: 32, y: 32 } })]);
    covered.zones.push({ ...covered.zones[0]!, id: "rise", name: "Rise", role: "path", polygon: rect(20, 20, 44, 44), connections: [] });
    expect(expandPlacements(covered).warnings.join("\n")).toMatch(/camp\/unit\/\d \(\w+ at .*\) stands outside its zone/);
  });

  it("warns about pieces outside their zone or unpowered", () => {
    const { warnings } = expandPlacements(blueprint([camp({ at: { x: 2, y: 2 }, structures: ["Gateway"], defences: [] })]));
    expect(warnings.join("\n")).toMatch(/camp\/structure\/0 \(Gateway at .*\) has no Pylon within 6\.5 cells/);
    expect(warnings.join("\n")).toMatch(/camp\/unit\/\d \(\w+ at .*\) stands outside its zone/);
  });
});
