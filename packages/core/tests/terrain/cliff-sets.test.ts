import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { getTilesetCliffSets } from "../../src/catalog/tileset-cliff-sets.js";
import { MissionBlueprintSchema, missionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { EMPTY_REGISTRY } from "../../src/plugins/plugin-api.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeMapPackage } from "../../src/map/write-map-package.js";
import { cliffCellZone, wornCliffSets } from "../../src/terrain/cliff-sets.js";
import { rasterizeTerrain } from "../../src/terrain/rasterize.js";
import { writeT3TerrainXml } from "../../src/terrain/write-t3-terrain-xml.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A 64×64 field (main level), a natural mesa with a ramp, a built mesa, and a pit. */
function blueprint(extra: Record<string, unknown> = {}, zoneExtra: Record<string, Record<string, unknown>> = {}) {
  const zones = [
    { id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) },
    {
      id: "mesa",
      name: "Mesa",
      elevation: 2,
      landform: "ridge",
      role: "path",
      polygon: rect(36, 36, 56, 56),
      connections: [{ toZoneId: "field", type: "ramp", at: { x: 46, y: 36 } }],
    },
    { id: "fort", name: "Fort", elevation: 2, landform: "flat", role: "base", surface: "built", polygon: rect(6, 36, 26, 56) },
    { id: "pit", name: "Pit", elevation: 0, landform: "canyon", role: "path", polygon: rect(20, 6, 40, 20) },
  ].map((zone) => ({ ...zone, ...(zoneExtra[zone.id] ?? {}) }));
  return {
    id: "cliffs",
    campaignId: "test",
    title: "Cliffs",
    setting: "test",
    mapSize: { width: 64, height: 64 },
    tilesetId: "BelShirEx2",
    // Cliffs exactly on the polygons, so a wall's cell is known; the last test turns the wobble on.
    raggedCliffs: 0,
    zones,
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    screenplay: { title: "Cliffs" },
    ...extra,
  };
}

const palette = { cliffPalette: { natural: "BelShirCliff0", built: "BelShirCliff1", pit: "CharCliff0" } };
const paint = (raw: ReturnType<typeof blueprint>) => rasterizeTerrain(MissionBlueprintSchema.parse(raw));
/** The cliff set name worn by the cliff cell containing map point (x, y). */
const setAt = (terrain: ReturnType<typeof paint>, x: number, y: number): string | undefined => {
  const cell = terrain.cliffCells.find((c) => c.index === Math.floor(y / 2) * 32 + Math.floor(x / 2));
  return cell ? terrain.cliffSets[cell.cliffSet ?? 0] : undefined;
};

describe("cliff palette (DL-04)", () => {
  const terrain = paint(blueprint(palette));

  it("gives each cliff the set chosen for the ground on top of it", () => {
    expect(setAt(terrain, 56, 46)).toBe("BelShirCliff0"); // the natural mesa's east wall
    expect(setAt(terrain, 5, 46)).toBe("BelShirCliff1"); // the built fort's west wall (cliff cell x 4-6)
    expect(setAt(terrain, 30, 20)).toBe("CharCliff0"); // the pit's rim
  });

  it("gives a ramp the set of the cliff it cuts", () => {
    const ramp = terrain.ramps.find((r) => r.id === "mesa-field")!;
    expect(terrain.cliffSets[ramp.cliffSet ?? 0]).toBe("BelShirCliff0");
  });

  it("writes every set used, and each cliff cell's index into them", () => {
    const xml = writeT3TerrainXml({ catalog: EMPTY_CATALOG, tilesetId: "BelShirEx2", width: 64, height: 64, textureSetIndex: 0, cliffCells: terrain.cliffCells, cliffSets: terrain.cliffSets, ramps: terrain.ramps });
    expect(xml).toContain(`<cliffSetList num="3">`);
    for (const [index, name] of terrain.cliffSets.entries()) expect(xml).toContain(`<cliffSet i="${index}" name="${name}"/>`);
    expect(new Set([...xml.matchAll(/<cc [^>]*cid="(\d+)"/g)].map((m) => m[1]))).toEqual(new Set(["0", "1", "2"]));
  });

  it("lets a zone's own cliff win as an accent", () => {
    const accented = paint(blueprint(palette, { mesa: { cliff: "SlaynCliff0" } }));
    expect(setAt(accented, 56, 46)).toBe("SlaynCliff0");
  });

  it("dresses a ragged cliff as the zone whose ground is on top of it", () => {
    const ragged = paint(blueprint({ ...palette, raggedCliffs: 4 }, { mesa: { cliff: "SlaynCliff0" } }));
    // Every cliff cell round the mesa, wherever its wobble took it, apart from the ramp's.
    const walls = ragged.cliffCells.filter((cell) => {
      const [x, y] = [(cell.index % 32) * 2, Math.floor(cell.index / 32) * 2];
      return x >= 28 && y >= 30 && Math.hypot(x - 46, y - 36) > 8;
    });
    expect(walls.length).toBeGreaterThan(30);
    expect(new Set(walls.map((cell) => ragged.cliffSets[cell.cliffSet ?? 0]))).toEqual(new Set(["SlaynCliff0"]));
  });

  it("keeps the tileset's first set everywhere without a palette", () => {
    const plain = paint(blueprint());
    expect(plain.cliffSets).toEqual([getTilesetCliffSets(EMPTY_CATALOG, "BelShirEx2")[0]]);
    expect(plain.cliffCells.every((cell) => (cell.cliffSet ?? 0) === 0)).toBe(true);
  });

  it("refuses a cliff set no tileset has", () => {
    expect(() => paint(blueprint({ cliffPalette: { natural: "BelShirCliff9" } }))).toThrow(/Cliff set BelShirCliff9 isn't a known cliff set/);
  });
});

describe("cliff sets for groups of Zones (DL-04, DL-14)", () => {
  it("dresses the cliffs of every Zone a group lists, patterns included", () => {
    const grouped = paint(blueprint({ ...palette, cliffSets: [{ cliffSet: "SlaynCliff0", zones: ["me*", "fort"] }] }));
    expect(setAt(grouped, 56, 46)).toBe("SlaynCliff0"); // the mesa's east wall
    expect(setAt(grouped, 5, 46)).toBe("SlaynCliff0"); // the fort's west wall, over the palette's built set
    expect(setAt(grouped, 30, 20)).toBe("CharCliff0"); // the pit's rim, in no group
    const ramp = grouped.ramps.find((r) => r.id === "mesa-field")!;
    expect(grouped.cliffSets[ramp.cliffSet ?? 0]).toBe("SlaynCliff0");
  });

  it("lets a Zone's own cliff win over its group", () => {
    const grouped = paint(blueprint({ ...palette, cliffSets: [{ cliffSet: "SlaynCliff0", zones: ["*"] }] }, { fort: { cliff: "MarSaraCliff1" } }));
    expect(setAt(grouped, 56, 46)).toBe("SlaynCliff0");
    expect(setAt(grouped, 5, 46)).toBe("MarSaraCliff1");
  });

  // The mesa as a block of backdrop rock one level above the field, as round a tunnel's floor.
  const rock = { mesa: { backdrop: true, connections: [] } };

  it("gives a wall of backdrop rock the choice of the floor at its foot", () => {
    const walled = paint(blueprint({ ...palette, cliffSets: [{ cliffSet: "SlaynCliff0", zones: ["field"] }] }, { ...rock, fort: { cliff: "MarSaraCliff1" } }));
    expect(setAt(walled, 56, 46)).toBe("SlaynCliff0"); // the rock's wall, rising from the field
    expect(setAt(walled, 5, 46)).toBe("MarSaraCliff1"); // the fort isn't a backdrop: its cliff stays its own
  });

  it("keeps the rock's own choice where the floor names none", () => {
    const walled = paint(blueprint(palette, { mesa: { ...rock.mesa, cliff: "SlaynCliff0" } }));
    expect(setAt(walled, 56, 46)).toBe("SlaynCliff0");
    const floored = paint(blueprint({ ...palette, cliffSets: [{ cliffSet: "MarSaraCliff1", zones: ["field"] }] }, { mesa: { ...rock.mesa, cliff: "SlaynCliff0" } }));
    expect(setAt(floored, 56, 46)).toBe("MarSaraCliff1"); // the floor's choice wins over the rock's
  });

  it("refuses more cliff sets than a map can use, when compiling a generated map", async () => {
    const four = blueprint({ ...palette, cliffSets: [{ cliffSet: "SlaynCliff0", zones: ["mesa"] }] });
    expect(paint(four).cliffSets).toHaveLength(4);
    // A knoll with a fifth set: the palette's three, the mesa's and the knoll's.
    const knoll = { id: "knoll", name: "Knoll", elevation: 2, landform: "ridge", role: "path", polygon: rect(4, 4, 14, 14) };
    const raw = blueprint({ ...palette, cliffSets: [{ cliffSet: "SlaynCliff0", zones: ["mesa"] }, { cliffSet: "MarSaraCliff1", zones: ["knoll"] }] });
    const five = MissionBlueprintSchema.parse({ ...raw, zones: [...raw.zones, knoll] });
    // A sync or a throwaway pass beside Kept ground only reads the plan, and isn't refused.
    expect(rasterizeTerrain(five).cliffSets).toHaveLength(5);
    expect(() => rasterizeTerrain(five, { limitCliffSets: true })).toThrow(/would use 5 cliff sets \(BelShirCliff0, .*\), and a map can use at most 4/);
    const outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-cliffs-"));
    try {
      await expect(writeMapPackage({ blueprint: five, outputDir })).rejects.toThrow(/would use 5 cliff sets/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("checks each group's Zones and cliff set", () => {
    const issues = (cliffSets: unknown) => {
      const parsed = missionBlueprintSchema(EMPTY_REGISTRY, EMPTY_CATALOG).safeParse(blueprint({ cliffSets }));
      return parsed.success ? "" : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    };
    expect(issues([{ cliffSet: "SlaynCliff0", zones: ["mesa", "f*"] }])).toBe("");
    expect(issues([{ cliffSet: "SlaynCliff0", zones: ["nowhere", "ruin*"] }])).toMatch(/cliffSets.0.zones.0: Unknown zone id: nowhere\ncliffSets.0.zones.1: ruin\* matches no generating Zone/);
    expect(issues([{ cliffSet: "SlaynCliff0", zones: ["mesa"] }, { cliffSet: "MarSaraCliff1", zones: ["m*"] }])).toContain("cliffSets.1.zones.0: Zone mesa is in cliffSets.0 already");
    expect(issues([{ cliffSet: "BelShirCliff9", zones: ["mesa"] }])).toContain("cliffSets.0.cliffSet: Cliff set BelShirCliff9 isn't a known cliff set");
    const named = ["SlaynCliff0", "MarSaraCliff1", "CharCliff0", "AgriaCliff0", "BelShirCliff1"].map((cliffSet, i) => ({ cliffSet, zones: [["mesa", "fort", "pit", "field", "nowhere"][i]!] }));
    expect(issues(named.slice(0, 4))).toBe("");
    expect(issues(named.slice(0, 4).concat({ cliffSet: "BelShirCliff1", zones: ["mesa"] }))).toContain("cliffSets: The Blueprint names 5 cliff sets");
  });

  it("writes only the sets a cliff mesh or a ramp wears, renumbered", () => {
    const meshless = (flags: number) => flags === 12;
    const cells = [{ flags: 3, cliffSet: 2 }, { flags: 12, cliffSet: 1 }, { flags: 3 }];
    const ramps = [{ id: "r", cliffSet: 3 }, { id: "s" }];
    const worn = wornCliffSets(["A", "B", "C", "D"], cells, ramps, meshless);
    expect(worn.sets).toEqual(["A", "C", "D"]);
    expect(worn.cells.map((cell) => cell.cliffSet)).toEqual([1, 0, 0]);
    expect(worn.ramps).toEqual([{ id: "r", cliffSet: 2 }, { id: "s" }]);
  });
});

describe("the Zone whose choice dresses a cliff cell", () => {
  // 0 a backdrop rock, 1 a floor naming a set, 2 a floor naming none, 3 another backdrop.
  const zones = [{ backdrop: true }, {}, {}, { backdrop: true }];
  const choices = [undefined, "SlaynCliff0", undefined, undefined];

  it("is the Zone on top, unless that is a backdrop", () => {
    expect(cliffCellZone([{ level: 6, zone: 2 }, { level: 5, zone: 1 }], zones, choices)).toBe(2);
    expect(cliffCellZone([{ level: 6, zone: 0 }, { level: 5, zone: 1 }], zones, choices)).toBe(1);
  });

  it("finds the floor naming a set at any lower corner, not only the first", () => {
    const corners = [
      { level: 6, zone: 0 },
      { level: 5, zone: -1 },
      { level: 5, zone: 2 },
      { level: 5, zone: 1 },
    ];
    expect(cliffCellZone(corners, zones, choices)).toBe(1);
  });

  it("prefers ground over rock on top, whatever order the corners come in", () => {
    const plateau = { level: 6, zone: 2 };
    const rockTop = { level: 6, zone: 0 };
    const floor = { level: 4, zone: 1 };
    expect(cliffCellZone([rockTop, plateau, floor], zones, choices)).toBe(2);
    expect(cliffCellZone([plateau, rockTop, floor], zones, choices)).toBe(2);
  });

  it("leaves a step between backdrops, and a wall over a floor naming nothing, to the rock", () => {
    expect(cliffCellZone([{ level: 6, zone: 0 }, { level: 5, zone: 3 }], zones, choices)).toBe(0);
    expect(cliffCellZone([{ level: 6, zone: 0 }, { level: 5, zone: 2 }], zones, choices)).toBe(0);
  });
});
