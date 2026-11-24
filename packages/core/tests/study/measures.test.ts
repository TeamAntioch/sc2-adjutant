import { describe, expect, it } from "vitest";

import { cliffCrossings, measureInput, measureMap } from "../../src/study/measures.js";
import { fixtureMap, rows } from "./fixture-map.js";

// 16x10 cells, all playable: a pit (level 0, columns 0-3), the main level (1, columns 4-11) and a
// height (2, columns 12-15). The pit is all A; the main level is C in columns 4-5 and B beyond; the
// height is B in rows 2-4 and D elsewhere.
const terraceTextures = Array.from({ length: 10 }, (_, y) => `AAAACCBBBBBB${y >= 2 && y <= 4 ? "BBBB" : "DDDD"}`);
const terraces = (extra: Partial<Parameters<typeof fixtureMap>[0]> = {}) =>
  fixtureMap({ levels: rows("0000111111112222", 10), textures: terraceTextures, ...extra });

describe("measureMap", () => {
  it("measures the top texture's share of each level", () => {
    const measures = measureMap(terraces());
    expect(measures["topTextureShare.lowestLevel"]).toBe(1);
    expect(measures["topTextureShare.mainLevel"]).toBe(0.75);
    expect(measures["topTextureShare.highestLevel"]).toBe(0.7);
  });

  it("measures how often the texture changes across a cliff, down into a pit and up onto a height", () => {
    // Sampled 2 cells back on each side, in rows 2-6 (the edge rows and columns are left out). Down:
    // A against B in every row. Up: B against B in rows 2-4, B against D in rows 5-6.
    const measures = measureMap(terraces());
    expect(measures["cliffTextureChange.downIntoPit"]).toBe(1);
    expect(measures["cliffTextureChange.upOntoHeight"]).toBe(0.4);
  });

  it("leaves out a cliff crossing whose sample cells fall off the map, rather than wrap to the next row", () => {
    // 4 cells back from x = 3 is x = -1, and from x = 12 is x = 16: both off the 16-cell map.
    const cross = cliffCrossings(measureInput(terraces()), 4);
    expect(cross.down).toEqual([0, 0]);
    expect(cross.up).toEqual([0, 0]);
  });

  it("measures doodad density on each level against the level's share of the ground, leaving helpers out", () => {
    // 10 visible doodads (1 in the pit, 8 on the main level, 1 on the height) and a point light.
    // The pit and the height are each a quarter of the ground, the main level half.
    const doodads = [
      { type: "AgriaTree", x: 1.5, y: 5.5 },
      ...Array.from({ length: 8 }, (_, k) => ({ type: "AgriaTree", x: 6.5 + (k % 4), y: 2.5 + Math.floor(k / 4) })),
      { type: "AgriaTree", x: 13.5, y: 5.5 },
      { type: "LightOmniRed", x: 7.5, y: 7.5 },
    ];
    const measures = measureMap(terraces({ doodads }));
    expect(measures["doodadDensity.lowestLevel"]).toBe(0.4);
    expect(measures["doodadDensity.mainLevel"]).toBe(1.6);
    expect(measures["doodadDensity.highestLevel"]).toBe(0.4);
    expect(measures["doodadDensity.perHundredCells"]).toBe(6.25);
  });

  it("measures the share of frame-sized areas (18x12 cells) on the main level that hold one texture", () => {
    // Two areas: the west one all B; the east one B with two cells of C, over the 0.5% a touch needs.
    const textures = rows(`${"B".repeat(18)}${"B".repeat(16)}CC`, 12);
    const measures = measureMap(fixtureMap({ levels: rows("1".repeat(36), 12), textures }));
    expect(measures["frameAreas.singleTextureShare"]).toBe(0.5);
  });

  it("measures where blends sit and how wide they are", () => {
    // A in columns 0-4, B in 5-9, the two columns either side of the seam blended 60/40, and one
    // stray A/C blend in the far corner. 9 blended cells, 8 of them by the seam's 4 cell borders.
    const blends: Record<string, Record<string, number>> = { "0,0": { A: 8, C: 8 } };
    for (let y = 0; y < 4; y++) {
      blends[`4,${y}`] = { A: 9, B: 6 };
      blends[`5,${y}`] = { B: 9, A: 6 };
    }
    const measures = measureMap(fixtureMap({ levels: rows("1".repeat(10), 4), textures: rows("AAAAABBBBB", 4), blends }));
    expect(measures["blend.nearBorderShare"]).toBe(0.889);
    expect(measures["blend.width"]).toBe(2);
    expect(measures["blend.singleTextureCellShare"]).toBe(0.775);
  });

  it("measures the share of natural props, built props and decals turned to a 45-degree step", () => {
    const at = (type: string, yaw: number) => ({ type, x: 8.5, y: 5.5, yaw });
    const doodads = [
      ...[0, Math.PI / 4, 0.3, 1].map((yaw) => at("Aiur_CliffRocks", yaw)), // rock: 2 of 4 snapped
      ...[Math.PI / 2, 0.5].map((yaw) => at("AgriaDebris", yaw)), // ruin: 1 of 2
      at("Aiur_City_Decals", Math.PI), // decal: 1 of 1
    ];
    const measures = measureMap(terraces({ doodads }));
    expect(measures["yawSnapping.natural"]).toBe(0.5);
    expect(measures["yawSnapping.built"]).toBe(0.5);
    expect(measures["yawSnapping.decal"]).toBe(1);
  });

  it("measures the backdrop (the ground below the main level) and what covers it", () => {
    // The pit is a quarter of the ground; water covers its west half. Agria shows its lowest level.
    const measures = measureMap(terraces({ tilesetId: "Agria", water: [{ water: "Agria", rect: [0, 0, 2, 10] }] }));
    expect(measures["backdrop.share"]).toBe(0.25);
    expect(measures["backdrop.waterShare"]).toBe(0.5);
    expect(measures["backdrop.skyShare"]).toBe(0);
    expect(measures["backdrop.coveredShare"]).toBe(0.5);
    expect(measures["backdrop.fogDensity"]).toBe(0.06);
  });

  it("counts a hidden lowest level as covered by sky, the tileset's or the map's own CTerrain's", () => {
    expect(measureMap(terraces({ tilesetId: "Avernus" }))["backdrop.skyShare"]).toBe(1);
    const terrainData = `<Catalog><CTerrain id="Agria"><HideLowestLevel value="1"/><FogDensity value="0.7"/></CTerrain></Catalog>`;
    const own = measureMap(terraces({ tilesetId: "Agria", terrainData, water: [{ water: "Agria", rect: [0, 0, 2, 10] }] }));
    expect(own["backdrop.skyShare"]).toBe(1);
    expect(own["backdrop.coveredShare"]).toBe(1);
    expect(own["backdrop.fogDensity"]).toBe(0.7);
  });

  it("follows the map's own CTerrain to its parents, in the map and then in the game", () => {
    const terrainData = `<Catalog><CTerrain id="Mine" parent="Local"/><CTerrain id="Local" parent="Agria"><HideLowestLevel value="1"/></CTerrain></Catalog>`;
    expect(measureMap(terraces({ tilesetId: "Mine", terrainData }))["backdrop.skyShare"]).toBe(1);
    const stockParent = `<Catalog><CTerrain id="Mine" parent="Avernus"/></Catalog>`;
    expect(measureMap(terraces({ tilesetId: "Mine", terrainData: stockParent }))["backdrop.skyShare"]).toBe(1);
  });

  it("measures the lighting changes the map's triggers make, and its point lights", () => {
    const mapScript = [
      "void gt_Init_Func () {",
      '    GameSetLighting("Night", 0.0);',
      '    GameSetLighting("Day", 2.5);',
      "}",
      "bool gt_Alarm_Func (bool testConds, bool runActions) {",
      '    GameSetLighting("Night", 0);',
      "}",
    ].join("\n");
    const doodads = [
      ...Array.from({ length: 9 }, () => ({ type: "AgriaTree", x: 8.5, y: 5.5 })),
      { type: "LightOmniRed", x: 7.5, y: 7.5 },
    ];
    const measures = measureMap(terraces({ mapScript, doodads }));
    expect(measures["lighting.lightsSet"]).toBe(2);
    expect(measures["lighting.changes"]).toBe(3);
    expect(measures["lighting.instantShare"]).toBe(0.667);
    expect(measures["lighting.longestBlendSeconds"]).toBe(2.5);
    expect(measures["lighting.pointLightShare"]).toBe(0.1);
    expect(measures["lighting.pointLightsPerHundredCells"]).toBe(0.625);
  });

  it("gives no value for a measure the map has nothing to measure with", () => {
    const measures = measureMap(fixtureMap({ levels: rows("1".repeat(10), 4), textures: rows("A".repeat(10), 4) }));
    expect(measures["yawSnapping.natural"]).toBeNull();
    expect(measures["topTextureShare.lowestLevel"]).toBeNull();
    expect(measures["cliffTextureChange.downIntoPit"]).toBeNull();
    expect(measures["doodadDensity.mainLevel"]).toBeNull();
    expect(measures["backdrop.share"]).toBe(0);
    expect(measures["backdrop.coveredShare"]).toBeNull();
    expect(measures["lighting.changes"]).toBe(0);
    expect(measures["lighting.instantShare"]).toBeNull();
    expect(measures["lighting.pointLightShare"]).toBeNull();
  });

  it("leaves a touch under 0.5% of an area out of its textures", () => {
    const textures = [`${"B".repeat(35)}C`, ...rows("B".repeat(36), 11)];
    expect(measureMap(fixtureMap({ levels: rows("1".repeat(36), 12), textures }))["frameAreas.singleTextureShare"]).toBe(1);
  });
});
