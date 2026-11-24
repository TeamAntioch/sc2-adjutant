// Core's stock catalog (src/catalog/stock-catalog.ts): the published @team-antioch/sc2-asset-catalog
// bound to core's committed data/, so the search, the Finder and the compile read core's files and
// the measured facings, and look for pictures in the main checkout from a linked worktree.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { PACKAGE_DATA_DIR } from "@team-antioch/sc2-asset-catalog/catalog/catalog-dirs.js";

import { lookUpDoodads } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";
import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import {
  CORE_DATA_DIR,
  CORE_DOODAD_SOURCE_FILES,
  coreDoodadSources,
  getDoodadPackage,
  getGameDoodadDescription,
  isGameModel,
  missingDoodadDependencies,
  readGameModelPaths,
  unknownPlacedDoodads,
} from "../../src/catalog/stock-catalog.js";
import { inMainCheckout } from "../../src/util/main-checkout.js";

describe("core's search sources", () => {
  it("are core's data folder: its doodads described and with their Doodad Uses, its terrain objects, its facings, and pictures looked for in the main checkout", () => {
    const sources = coreDoodadSources();
    expect(sources.root).toBe(CORE_DATA_DIR);
    expect(sources.doodads.PortZionCrusherDoodad).toMatchObject({ package: expect.any(String), description: { look: expect.any(String) } });
    expect(Object.keys(sources.terrainObjects).length).toBeGreaterThan(100);
    expect(Object.keys(sources.facings?.doodads ?? {}).length).toBeGreaterThan(0);
    expect(sources.pictureFallback).toBe(inMainCheckout);
    // A measured facing reaches the results, as the dressing's does.
    const [measured] = Object.keys(sources.facings!.doodads).filter((id) => Object.hasOwn(sources.doodads, id));
    expect(lookUpDoodads([measured!], sources).get(measured!)?.facing).toMatchObject({ source: "measured" });
  });

  it("are read from the files a running Finder watches: core's extracted fields and terrain objects, and the package's descriptions and Doodad Uses", () => {
    const files = (dir: string) => CORE_DOODAD_SOURCE_FILES.filter((file) => path.dirname(file) === path.resolve(dir)).map((file) => path.basename(file)).sort();
    expect(files(CORE_DATA_DIR)).toEqual(["doodad-extracted.json", "doodads.json", "terrain-object-catalog.json"]);
    expect(files(PACKAGE_DATA_DIR)).toEqual(["doodad-descriptions.json", "doodad-uses"]);
    expect(CORE_DOODAD_SOURCE_FILES).toHaveLength(5);
  });

  it("are the package's descriptions and Doodad Uses: core keeps no copy of its own", () => {
    expect(existsSync(path.join(CORE_DATA_DIR, "doodad-descriptions.json"))).toBe(false);
    expect(existsSync(path.join(CORE_DATA_DIR, "doodad-uses"))).toBe(false);
  });
});

describe("core's doodad catalog lookups", () => {
  it("give a game doodad's description and package, and the map dependencies a doodad needs", () => {
    expect(getGameDoodadDescription("PortZionCrusherDoodad")?.look).toEqual(expect.any(String));
    expect(getDoodadPackage("PortZionCrusherDoodad")).toMatch(/\.sc2(mod|campaign)$/);
    expect(getDoodadPackage("toString")).toBeUndefined();
    expect([...missingDoodadDependencies(["InfestedHomeSmall"], []).keys()]).toEqual([expect.stringContaining("Void (Campaign)")]);
  });
});

describe("unknownPlacedDoodads", () => {
  it("tells the author to declare an unknown placed doodad in the Blueprint's doodads", () => {
    const objects = '<ObjectDoodad Id="7" Position="10,20,0" Type="NoSuchDoodad"/><ObjectDoodad Id="8" Position="1,2,0" Type="AuthorsRockModel"/>';
    const warnings = unknownPlacedDoodads(objects, { ...EMPTY_CATALOG, models: new Set(["AuthorsRockModel"]) });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/NoSuchDoodad \(at 10, 20, 0\).*declare it in the Blueprint's doodads/);
    expect(warnings[1]).toMatch(/there is a CModel AuthorsRockModel but no CActorDoodad.*Declare it in the Blueprint's doodads/);
  });
});

describe("the game's model files", () => {
  it("take a CModel's file, a game doodad's numbered file, and a story set's part that only an actor names by file", () => {
    expect(isGameModel("Assets/Buildings/Protoss/PylonEx2/PylonEx2.m3")).toBe(true);
    expect(isGameModel("assets\\doodads\\rockarch\\rockarch_03.m3")).toBe(true);
    expect(isGameModel("Assets\\StoryModeSets\\Terran\\SMX1_CommandCenter\\SMX1_CommandCenter_01.m3")).toBe(true);
    expect(isGameModel("Assets/Doodads/NoSuchModel/NoSuchModel.m3")).toBe(false);
  });

  it("refuse a missing or damaged list by naming its file and how to make it again", () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), "game-models-"));
    const missing = path.join(folder, "game-models.json");
    expect(() => readGameModelPaths(missing)).toThrow(`${missing} can't be read`);
    expect(() => readGameModelPaths(missing)).toThrow("node packages/core/scripts/build-game-models.mjs");
    writeFileSync(missing, "[\"Assets/A.m3\",");
    expect(() => readGameModelPaths(missing)).toThrow(`${missing} can't be read`);
    writeFileSync(missing, `{"not":"a list"}`);
    expect(() => readGameModelPaths(missing)).toThrow(`${missing} can't be read`);
    writeFileSync(missing, `["Assets/A.m3"]`);
    expect(readGameModelPaths(missing)).toEqual(["Assets/A.m3"]);
  });
});

describe("isGameAsset", () => {
  it("knows an image the game's data names, in either slash and any case", async () => {
    const { isGameAsset } = await import("../../src/catalog/stock-catalog.js");
    expect(isGameAsset("Assets\\Textures\\btn-ability-terran-activatemine.dds")).toBe(true);
    expect(isGameAsset("assets/textures/BTN-Ability-Terran-ActivateMine.dds")).toBe(true);
    expect(isGameAsset("Assets/Textures/btn-no-such-icon.dds")).toBe(false);
  });
});
