// A texture set's palette on a fully generated map: the set's Zones get level bands and variety
// patches as the map's texturePalette gives the rest (DL-01, DL-02), and a set can take every Zone
// at its levels as well as the Zones its list names.
//
// The Blueprint is a 64×64 cave: a field on level 1 (set 0, under the map's palette), and, on the
// "cave" set by its levels 2 and 3, a mesa on level 2 with a peak and a backdrop wall on level 3. A
// shelf on level 2 is named by the "jungle" set's list, which wins over cave's levels. Every edge
// is on the 8-cell block grid, so no block holds Zones of two sets.
import { describe, expect, it } from "vitest";

import { type MissionBlueprint, textureSetOfZone } from "../../src/domain/mission-blueprint.js";
import { paintTextures, type TexturePlan } from "../../src/terrain/paint-textures.js";
import { rasterizeTerrain } from "../../src/terrain/rasterize.js";
import { StyleBlueprintSchema } from "../support/workspaces.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const W = 64;
const CAVE = ["AgriaDirtRough", "Zerus5", "AiurRock", "BelShirDirtDarkEx2"];
const JUNGLE = ["BelShirGrassLightEx2", "Zerus3"];

function blueprint(cave: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    id: "set-palettes",
    campaignId: "test",
    title: "Set palettes",
    setting: "test",
    mapSize: { width: W, height: W },
    tilesetId: "BelShirEx2",
    zones: [
      { id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) },
      { id: "mesa", name: "Mesa", elevation: 2, landform: "ridge", role: "path", polygon: rect(24, 24, 64, 64) },
      { id: "peak", name: "Peak", elevation: 3, landform: "ridge", role: "path", polygon: rect(40, 40, 56, 56) },
      { id: "wall", name: "Wall", elevation: 3, landform: "ridge", role: "path", backdrop: true, polygon: rect(56, 24, 64, 40) },
      { id: "shelf", name: "Shelf", elevation: 2, landform: "flat", role: "path", polygon: rect(8, 8, 24, 16) },
    ],
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    screenplay: { title: "Set palettes" },
    texturePalette: { main: "MarSaraDirt", variety: ["MarSaraSand"] },
    textureSets: [
      { id: "cave", textures: CAVE, levels: [2, 3], palette: { main: "AgriaDirtRough", variety: ["Zerus5"], high: "AiurRock" }, ...cave },
      { id: "jungle", textures: JUNGLE, zones: ["shelf"], palette: { main: "BelShirGrassLightEx2", variety: ["Zerus3"] } },
    ],
    ...extra,
  };
}

/** The compiled terrain, and each texture's share of a rectangle's ground by weight, read in each cell's block's set. */
function painted(raw: ReturnType<typeof blueprint>) {
  const terrain = rasterizeTerrain(StyleBlueprintSchema.parse(raw));
  const sets = terrain.textureSets!.plan.textures;
  const shares = (x0: number, y0: number, x1: number, y1: number) => {
    const weights = new Map<string, number>();
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const set = sets.blockSets[Math.floor(y / 8) * sets.blocksPerRow + Math.floor(x / 8)]!;
        for (let layer = 0; layer < 8; layer++) {
          const name = sets.slots[set * 8 + layer]!;
          weights.set(name, (weights.get(name) ?? 0) + terrain.textureWeights[(y * W + x) * 8 + layer]! / 15);
        }
      }
    }
    return (name: string): number => (weights.get(name) ?? 0) / ((x1 - x0) * (y1 - y0));
  };
  return { terrain, shares };
}

/** The schema's issues for the Blueprint, as "path: message". */
const issues = (raw: unknown): string[] => {
  const result = StyleBlueprintSchema.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("a texture set chosen by level", () => {
  it("takes every Zone at its levels that no set's list names: a list wins over levels", () => {
    const parsed = StyleBlueprintSchema.parse(blueprint());
    const of = textureSetOfZone(parsed.textureSets!, parsed.zones);
    expect(Object.fromEntries(of)).toEqual({ mesa: 0, peak: 0, wall: 0, shelf: 1 });
  });

  it("is validated: a level in one set, a Zone at each level, zones or levels, and its Zones' textures the set's", () => {
    expect(issues(blueprint())).toEqual([]);
    const twice = blueprint({}, { textureSets: [...blueprint().textureSets, { id: "more", textures: JUNGLE, levels: [3] }] });
    expect(issues(twice)).toEqual(["textureSets.2.levels.0: Level 3 is in texture set cave's levels already: a level is painted from one set"]);
    expect(issues(blueprint({ levels: [2, 3, 5] }))).toEqual(["textureSets.0.levels.2: No generating Zone is at level 5"]);
    expect(issues(blueprint({ levels: undefined }))).toEqual(["textureSets.0: Texture set cave paints no Zone: give it zones, levels or both"]);
    expect(issues(blueprint({ levels: [2, 3, 2] }))).toEqual(["textureSets.0.levels.2: Level 2 is listed twice in texture set cave's levels"]);
    // A level whose every Zone a list names gives the set nothing, which would still cost its textures.
    const listed = blueprint({}, { textureSets: [blueprint().textureSets[0], { ...blueprint().textureSets[1], zones: ["shelf", "mesa"] }] });
    expect(issues(listed)).toEqual(["textureSets.0.levels.0: Every Zone at level 2 is named by a set's zones (mesa, shelf), so the level gives texture set cave none"]);
    const own = blueprint();
    (own.zones[2] as { texture?: string }).texture = "Zerus3";
    expect(issues(own)).toEqual(["textureSets.0.levels.1: Zone peak's texture Zerus3 isn't one of texture set cave's: AgriaDirtRough, Zerus5, AiurRock, BelShirDirtDarkEx2"]);
  });
});

describe("a texture set's palette", () => {
  const { terrain, shares } = painted(blueprint());

  it("paints the set's main level its main texture, patched with its variety (DL-01)", () => {
    // The cave's main level is 2, where most of its Zones' cells are: the mesa, west of the peak.
    expect(terrain.textureSets!.plan.textures.setCount).toBe(3);
    const mesa = shares(24, 24, 40, 64);
    // Zerus5 (tangled roots) is an accent by its catalog description, so it goes down as dabs, not washes.
    expect(mesa("AgriaDirtRough")).toBeGreaterThan(0.8);
    expect(mesa("AgriaDirtRough")).toBeLessThan(0.99);
    expect(mesa("Zerus5")).toBeGreaterThan(0.02);
    expect(mesa("Zerus5")).toBeLessThan(0.15);
  });

  it("paints a level above the set's main level its high band, with light touches of the variety (DL-02)", () => {
    const peak = shares(42, 42, 54, 54);
    expect(peak("AiurRock")).toBeGreaterThan(0.6);
    expect(peak("Zerus5")).toBeLessThan(0.3);
  });

  it("keeps a backdrop Zone to its one band texture", () => {
    expect(shares(60, 28, 64, 36)("AiurRock")).toBe(1);
  });

  it("paints a Zone its list names from that set, though its level is another set's", () => {
    const shelf = shares(8, 8, 24, 16);
    expect(shelf("BelShirGrassLightEx2") + shelf("Zerus3")).toBeCloseTo(1, 6);
    expect(shelf("Zerus3")).toBeGreaterThan(0);
  });

  it("lets a Zone's own texture win", () => {
    const raw = blueprint();
    (raw.zones[2] as { texture?: string }).texture = "BelShirDirtDarkEx2";
    expect(painted(raw).shares(44, 44, 52, 52)("BelShirDirtDarkEx2")).toBe(1);
  });

  it("counts bands from its mainLevel when it gives one", () => {
    const { shares: own } = painted(blueprint({ palette: { main: "AiurRock", low: "AgriaDirtRough", mainLevel: 3 } }));
    expect(own(44, 44, 52, 52)("AiurRock")).toBe(1);
    expect(own(28, 28, 36, 60)("AgriaDirtRough")).toBe(1);
  });

  it("advises on its own cliffs, naming the set, and the map's palette on set 0's alone", () => {
    expect(terrain.textureWarnings).toEqual([]);
    const { terrain: flat } = painted(blueprint({ palette: { main: "AgriaDirtRough", variety: ["Zerus5"] } }));
    expect(flat.textureWarnings).toEqual([
      "Texture set cave's palette: Levels 2 and 3 mostly both wear AgriaDirtRough, so the cliff between them doesn't change texture (DL-02): set the palette's high.",
    ]);
  });

  it("names the set's palette when a built Zone it paints has no texture, in a Blueprint the schema didn't check", () => {
    const parsed = StyleBlueprintSchema.parse(blueprint());
    const zones = parsed.zones.map((zone) => (zone.id === "peak" ? { ...zone, surface: "built" as const } : zone));
    expect(() => rasterizeTerrain({ ...parsed, zones })).toThrow("Zone peak is built, but texture set cave's palette has no built texture");
  });

  it("is validated: its textures the set's, and a built Zone given a texture", () => {
    expect(issues(blueprint({ palette: { main: "AgriaDirtRough", variety: ["Zerus3"] } }))).toEqual([
      "textureSets.0.palette: Palette texture Zerus3 isn't one of texture set cave's: AgriaDirtRough, Zerus5, AiurRock, BelShirDirtDarkEx2",
    ]);
    const built = blueprint();
    (built.zones[2] as { surface?: string }).surface = "built";
    expect(issues(built)).toEqual(["textureSets.0.levels.1: Zone peak is built: texture set cave's palette needs its built texture, or the Zone its own"]);
    expect(issues(blueprint({ palette: { main: "AgriaDirtRough", built: "BelShirDirtDarkEx2" } }, { zones: built.zones }))).toEqual([]);
  });
});

describe("a palette's cliff advice", () => {
  it("counts a cliff towards a set's palette where its cells are on the set's blocks and its Zones paint them, and towards no palette where they're snapped", () => {
    // 16×8 cells, two blocks: block 0 on set 0, block 1 on set 1. The cliff between levels 1 and 2 at
    // x = 12 is in block 1.
    const zones = [
      { id: "ground", elevation: 1, polygon: rect(0, 0, 16, 8) },
      { id: "step", elevation: 2, polygon: rect(12, 0, 16, 8) },
    ];
    const syncCliff = Uint16Array.from({ length: 16 * 8 }, (_, cell) => (cell % 16 >= 12 ? 128 : 64));
    const seen: { mainLevel: number; pairs: number }[] = [];
    const counts = { mainLevel: 1, lowBands: 0, highBands: 0 };
    const set0 = ["A", "", "", "", "", "", "", ""];
    const set1 = ["B", "C", "", "", "", "", "", ""];
    const layerNames = [...set0, "B", "C"];
    const plan: TexturePlan = {
      zoneLayers: [8, 9],
      builtZones: [false, false],
      zonePatches: [undefined, undefined],
      blendGroups: layerNames.map(() => ""),
      layerNames,
      palette: counts,
      setPalettes: [undefined, { id: "cave", ...counts, mainLevel: 2 }],
      rules: { cliffTextureWarnings: ({ pairs, mainLevel }) => (seen.push({ mainLevel, pairs: pairs.reduce((sum, pair) => sum + pair.total, 0) }), []) },
      sets: {
        blockSets: Uint8Array.from([0, 1]),
        blocksPerRow: 2,
        names: [set0, set1, ...Array.from({ length: 6 }, () => Array(8).fill(""))],
        layerIn: [Int8Array.from(layerNames, (_, layer) => (layer < 8 ? layer : -1)), Int8Array.from(layerNames, (name) => (name === "" ? -1 : set1.indexOf(name))), ...Array.from({ length: 6 }, () => new Int8Array(10).fill(-1))],
      },
    };
    const owner = Int16Array.from(syncCliff, (value) => (value === 128 ? 1 : 0));
    const paint = (zoneSets: number[]) => {
      seen.length = 0;
      paintTextures({ mapSize: { width: 16, height: 8 }, zones } as unknown as MissionBlueprint, { ...plan, zoneSets }, syncCliff, owner);
      return [...seen];
    };
    // Both Zones set 1's: set 1's palette sees the 8 pairs across x = 12, the map's none.
    expect(paint([1, 1])).toEqual([
      { mainLevel: 1, pairs: 0 },
      { mainLevel: 2, pairs: 8 },
    ]);
    // Both set 0's, snapped onto block 1: set 1's textures, which neither palette chose, so neither counts them.
    expect(paint([0, 0])).toEqual([
      { mainLevel: 1, pairs: 0 },
      { mainLevel: 2, pairs: 0 },
    ]);
  });
});
