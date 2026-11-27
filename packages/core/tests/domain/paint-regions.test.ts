// Paint Regions (ADR-0028): polygons in a Mission Blueprint, each with a texture mix that overrides
// its Zones' palette inside it. This layer is the schema and its checks; nothing paints them yet.
//
// The Blueprint is a 64×64 generated map: a field on level 1 (set 0, the map's palette) and, from
// x 32, a mesa on level 2 painted from the "cave" texture set. The mesa's edge is on the 8-cell
// block grid, so every block is on one set.
import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { rasterizeTerrain } from "../../src/terrain/rasterize.js";
import { StyleBlueprintSchema } from "../support/workspaces.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const W = 64;
const CAVE = ["AgriaDirtRough", "Zerus5", "AiurRock"];
const MAP = ["MarSaraDirt", "MarSaraSand", "MarSaraRocky", "MarSaraDirtCracked", "MarSaraDarkSand", "MarSaraBlackenedRock", "MarSaraConcrete", "MarSaraPanels"];

function blueprint(paintRegions: unknown[], extra: Record<string, unknown> = {}) {
  return {
    id: "paint-regions",
    campaignId: "test",
    title: "Paint regions",
    setting: "test",
    mapSize: { width: W, height: W },
    tilesetId: "MarSara",
    textures: MAP,
    zones: [
      { id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) },
      { id: "mesa", name: "Mesa", elevation: 2, landform: "ridge", role: "path", polygon: rect(32, 0, 64, 64) },
    ],
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    screenplay: { title: "Paint regions" },
    texturePalette: { main: "MarSaraDirt", variety: ["MarSaraSand"] },
    textureSets: [{ id: "cave", textures: CAVE, zones: ["mesa"] }],
    paintRegions,
    ...extra,
  };
}

/** The schema's issues for the Blueprint, as "path: message". */
const issues = (raw: unknown): string[] => {
  const result = StyleBlueprintSchema.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("a Paint Region", () => {
  it("is kept as written: a polygon or a Zone, a mix of blend weights, area shares and one texture taking the rest, a falloff and levels", () => {
    const regions = [
      {
        id: "dark-floor",
        polygon: rect(4, 4, 20, 20),
        mix: [{ texture: "MarSaraRocky", weight: 0.15 }, { texture: "MarSaraSand", share: 0.05 }, { texture: "MarSaraDirtCracked" }],
        falloff: 3,
        levels: [1],
      },
      { id: "mesa-top", zone: "mesa", mix: [{ texture: "AiurRock", share: 0.2 }] },
    ];
    const parsed = StyleBlueprintSchema.parse(blueprint(regions));
    expect(parsed.paintRegions).toEqual(regions);
  });

  it("isn't painted yet: the terrain comes out as it does without it", () => {
    const region = { id: "floor", polygon: rect(4, 4, 20, 20), mix: [{ texture: "MarSaraRocky", weight: 0.5 }, { texture: "MarSaraSand" }] };
    const withRegion = rasterizeTerrain(StyleBlueprintSchema.parse(blueprint([region])));
    const without = rasterizeTerrain(StyleBlueprintSchema.parse(blueprint([])));
    expect(Buffer.compare(Buffer.from(withRegion.textureWeights), Buffer.from(without.textureWeights))).toBe(0);
    expect(withRegion.textureSets?.plan.textures.blockSets).toEqual(without.textureSets?.plan.textures.blockSets);
  });
});

describe("a Paint Region's outline", () => {
  const mix = [{ texture: "MarSaraRocky", weight: 0.2 }];

  it("is a polygon inside the map or a known Zone's, one of the two, under an id no other region has", () => {
    expect(issues(blueprint([{ id: "edge", polygon: rect(0, 0, 64, 64), mix, levels: [1] }]))).toEqual([]);
    expect(issues(blueprint([{ id: "off", polygon: rect(-4, 4, 8, 12), mix }]))).toEqual([
      "paintRegions.0.polygon.0: Paint Region off's point (-4, 4) is off the 64×64 map",
    ]);
    expect(issues(blueprint([{ id: "ghost", zone: "nowhere", mix }]))).toEqual(["paintRegions.0.zone: Unknown zone id: nowhere"]);
    expect(issues(blueprint([{ id: "both", zone: "mesa", polygon: rect(4, 4, 8, 8), mix }]))).toEqual(["paintRegions.0: A Paint Region gives a polygon or a zone, one of the two"]);
    expect(issues(blueprint([{ id: "twice", polygon: rect(4, 4, 8, 8), mix }, { id: "twice", zone: "field", mix, levels: [1] }]))).toEqual(["paintRegions.1.id: Duplicate id: twice"]);
  });
});

describe("a Paint Region's textures", () => {
  const MAP_LIST = MAP.join(", ");
  const CAVE_LIST = CAVE.join(", ");

  it("are the texture set's its cells are on: the map's textures (set 0), or a texture set's, naming the set and its textures", () => {
    const field = (texture: string) => [{ id: "floor", polygon: rect(4, 4, 20, 20), mix: [{ texture, weight: 0.3 }] }];
    expect(issues(blueprint(field("MarSaraRocky")))).toEqual([]);
    expect(issues(blueprint(field("AiurRock")))).toEqual([`paintRegions.0.mix.0.texture: Paint Region floor paints cells on the map's textures (set 0), which don't hold AiurRock: ${MAP_LIST}`]);
    expect(issues(blueprint([{ id: "top", zone: "mesa", mix: [{ texture: "MarSaraRocky" }] }]))).toEqual([
      `paintRegions.0.mix.0.texture: Paint Region top paints cells on texture set cave, which doesn't hold MarSaraRocky: ${CAVE_LIST}`,
    ]);
  });

  it("are checked against every set the region crosses, unless its levels keep it to one", () => {
    const across = { id: "across", polygon: rect(24, 4, 40, 12), mix: [{ texture: "AiurRock", share: 0.5 }] };
    expect(issues(blueprint([across]))).toEqual([`paintRegions.0.mix.0.texture: Paint Region across paints cells on the map's textures (set 0), which don't hold AiurRock: ${MAP_LIST}`]);
    expect(issues(blueprint([{ ...across, levels: [2] }]))).toEqual([]);
  });

  it("go by the set each cell's 8×8 block is on: a block goes to the set whose Zones cover most of it", () => {
    // The nook covers 36 of the block's 64 cells, so the block's field cells round it are on the cave set too.
    const zones = [...blueprint([]).zones, { id: "nook", name: "Nook", elevation: 1, landform: "flat", role: "path", polygon: rect(8, 8, 14, 14) }];
    const textureSets = [{ id: "cave", textures: CAVE, zones: ["mesa", "nook"] }];
    const beside = [{ id: "beside", polygon: rect(14, 8, 16, 10), mix: [{ texture: "AiurRock", weight: 0.5 }] }];
    expect(issues(blueprint(beside, { zones, textureSets }))).toEqual([]);
  });

  it("without the Mission's textures, are its palette's and then its tileset's", () => {
    const own = (texture: string) => blueprint([{ id: "floor", polygon: rect(4, 4, 20, 20), mix: [{ texture, weight: 0.3 }] }], { textures: undefined, texturePalette: { main: "AiurRock" } });
    expect(issues(own("AiurRock"))).toEqual([]);
    expect(issues(own("MarSaraConcrete"))).toEqual([]);
    expect(issues(own("Zerus5"))).toEqual([`paintRegions.0.mix.0.texture: Paint Region floor paints cells on the map's textures (set 0), which don't hold Zerus5: AiurRock, ${MAP.slice(0, 7).join(", ")}`]);
  });

  it("beside Kept ground, are checked only on generating Zones' cells: a Kept Zone's are left as they are", () => {
    const zones = blueprint([]).zones.map((zone) => ({ ...zone, terrain: zone.id === "mesa" ? "generate" : "kept" }));
    const kept = (region: Record<string, unknown>) => blueprint([{ id: "patch", mix: [{ texture: "AiurRock", weight: 0.5 }], ...region }], { zones, texturePalette: undefined, textures: undefined });
    expect(issues(kept({ polygon: rect(24, 4, 40, 12) }))).toEqual([]);
    expect(issues(kept({ zone: "field" }))).toEqual([`paintRegions.0.zone: Zone field is drawn over Kept ground: only a generating Zone ("terrain": "generate") is painted by a Paint Region`]);
  });
});

describe("a Paint Region's mix", () => {
  const region = (mix: unknown[]) => [{ id: "floor", polygon: rect(4, 4, 20, 20), mix }];

  it("gives each texture a blend weight, an area share or neither, with the weights and shares at most 1 together", () => {
    expect(issues(blueprint(region([{ texture: "MarSaraRocky", weight: 0.6 }, { texture: "MarSaraSand", share: 0.4 }])))).toEqual([]);
    expect(issues(blueprint(region([{ texture: "MarSaraRocky", weight: 0.6 }, { texture: "MarSaraSand", share: 0.5 }])))).toEqual([
      "paintRegions.0.mix: Paint Region floor's blend weights and area shares add up to 1.1: together they're at most 1",
    ]);
    expect(issues(blueprint(region([{ texture: "MarSaraRocky", weight: 0.2, share: 0.2 }])))).toEqual([
      "paintRegions.0.mix.0: A texture takes a blend weight or an area share, not both",
    ]);
  });

  it("has at most one texture without an amount, and each texture once", () => {
    expect(issues(blueprint(region([{ texture: "MarSaraRocky", weight: 0.2 }, { texture: "MarSaraSand" }, { texture: "MarSaraDirt" }])))).toEqual([
      "paintRegions.0.mix.2: Paint Region floor's MarSaraSand already takes what the weights and shares leave: give MarSaraDirt a weight or a share",
    ]);
    expect(issues(blueprint(region([{ texture: "MarSaraRocky", weight: 0.2 }, { texture: "MarSaraRocky", share: 0.2 }])))).toEqual([
      "paintRegions.0.mix.1: MarSaraRocky is in Paint Region floor's mix twice: list each texture once",
    ]);
  });
});
