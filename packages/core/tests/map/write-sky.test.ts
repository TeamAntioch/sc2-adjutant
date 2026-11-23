import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { expandDressing } from "../../src/dressing/expand-dressing.js";
import { hidesLowestLevel } from "../../src/catalog/tileset-sky.js";
import { skyTerrainFields, skyWarnings } from "../../src/map/write-sky.js";
import { rasterizeTerrain } from "../../src/terrain/rasterize.js";
import { buildMissionGameData } from "../../src/triggers/build-mission-triggers.js";

// terrain-test: BelShirEx2 with a level-0 pit (`pit`) holding the anchor `plant_pit`.
const raw = JSON.parse(await readFile(new URL("../fixtures/terrain-test/blueprint.json", import.meta.url), "utf8")) as Record<string, unknown>;
const parse = (extra: Record<string, unknown>) => MissionBlueprintSchema.parse({ ...raw, ...extra });

describe("sky (DL-14)", () => {
  it("writes the skybox, hidden level and fog into the tileset override", () => {
    const blueprint = parse({
      sky: { skybox: "Void_Skybox", hideLowestLevel: true, fog: { from: "Starship", color: [0, 0.675, 1], density: 0.2 } },
    });
    const xml = buildMissionGameData(blueprint)["TerrainData.xml"]!;
    expect(xml).toContain('<CTerrain id="BelShirEx2">');
    expect(xml).toContain('<FixedSkyboxModel value="Void_Skybox"/>');
    expect(xml).toContain('<HideLowestLevel value="1"/>');
    // Starship's fog, with 3-11's colour and density.
    expect(xml).toContain('<FogEnabled value="1"/>');
    expect(xml).toContain('<FogColor value="255,0,172,255"/>');
    expect(xml).toContain('<FogDensity value="0.200000"/>');
    expect(xml).toContain('<FogFalloff value="0.200000"/>');
    expect(xml).toContain('<FogStartingHeight value="-20.000000"/>');
  });

  it("writes only what the blueprint sets", () => {
    expect(skyTerrainFields(parse({ sky: { skybox: "ShakurasSkyBox" } }))).toEqual(['        <FixedSkyboxModel value="ShakurasSkyBox"/>']);
    expect(skyTerrainFields(parse({}))).toEqual([]);
    expect(buildMissionGameData(parse({}))["TerrainData.xml"]).toBeUndefined();
  });

  it("copies a tileset's two sky layers, either overridable", () => {
    expect(skyTerrainFields(parse({ sky: { from: "TheVoid" } }))).toEqual([
      '        <FixedSkyboxModel value="Void_Skybox"/>',
      '        <NonFixedSkyboxModel value="Void_Skybox_Parallax"/>',
    ]);
    expect(skyTerrainFields(parse({ sky: { from: "TheVoid", skybox: "StarshipSkyBox" } }))[0]).toBe('        <FixedSkyboxModel value="StarshipSkyBox"/>');
  });

  it("refuses sky or fog from an unknown tileset", () => {
    expect(() => skyTerrainFields(parse({ sky: { fog: { from: "Nowhere" } } }))).toThrow(/Fog: no tileset Nowhere/);
    expect(() => skyTerrainFields(parse({ sky: { from: "Nowhere" } }))).toThrow(/Sky: no tileset Nowhere/);
  });

  it("hides the lowest level as the blueprint says, else as the tileset does", () => {
    expect(hidesLowestLevel(EMPTY_CATALOG, parse({}))).toBe(false);
    expect(hidesLowestLevel(EMPTY_CATALOG, parse({ sky: { hideLowestLevel: true } }))).toBe(true);
    expect(hidesLowestLevel(EMPTY_CATALOG, parse({ tilesetId: "Starship" }))).toBe(true);
    expect(hidesLowestLevel(EMPTY_CATALOG, parse({ tilesetId: "Starship", sky: { hideLowestLevel: false } }))).toBe(false);
  });

  describe("a hidden lowest level", () => {
    // Rasterized once each: the terrain doesn't depend on dressing.
    const rocks = { dressing: { cliffs: { spacing: 2, natural: { large: ["ZerusRockLarge"], small: ["AgriaDebris"] } } } };
    const open = parse(rocks);
    const hidden = parse({ ...rocks, sky: { skybox: "MadeUpSky", hideLowestLevel: true } });
    const openTerrain = rasterizeTerrain(open);
    const hiddenTerrain = rasterizeTerrain(hidden);
    const level0 = [...openTerrain.syncCliff.keys()].filter((cell) => openTerrain.syncCliff[cell] === 0);

    it("is unpathable, as the Editor marks it", () => {
      expect(new Set(level0.map((cell) => hiddenTerrain.cellFlags[cell]))).toEqual(new Set([3]));
      expect(new Set(level0.map((cell) => openTerrain.cellFlags[cell])).has(2)).toBe(true);
    });

    it("gets no dressing, and its cliffs no piles", () => {
      const levels = (blueprint: typeof open, terrain: typeof openTerrain) =>
        expandDressing(blueprint, terrain).doodads.map((d) => terrain.syncCliff[Math.floor(d.y) * 128 + Math.floor(d.x)]);
      expect(levels(open, openTerrain)).toContain(0);
      const onHidden = levels(hidden, hiddenTerrain);
      expect(onHidden.length).toBeGreaterThan(0);
      expect(onHidden).not.toContain(0);
    });

    it("warns about an unknown sky model and an anchor over the void", () => {
      const warnings = skyWarnings(hidden, hiddenTerrain.syncCliff);
      expect(warnings).toEqual([
        expect.stringContaining("Sky model MadeUpSky"),
        "Anchor plant_pit stands on the hidden lowest level, over open sky.",
      ]);
    });
  });
});
