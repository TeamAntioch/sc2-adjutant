// The Campaign Mod as a catalog layer (ADR-0011): a Workspace's Missions use the tilesets, terrain
// textures, Lights, units and doodads its Campaign Mod defines, with full checking, as they use the
// game's. The mod's entries are read from its package while they're Kept and from its Blueprint once
// it owns them (lantern-fixture.ts).
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { blueprintCatalog, EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { isKnownBehavior, isKnownEffect, techUnit } from "../../src/catalog/tech-catalog.js";
import { getTilesetCliffSets } from "../../src/catalog/tileset-cliff-sets.js";
import { getTilesetSky } from "../../src/catalog/tileset-sky.js";
import { getTilesetTextures } from "../../src/catalog/tileset-textures.js";
import { freezeMissionSetPiece } from "../../src/dressing/mission-dressing-edits.js";
import { checkMissionLayout } from "../../src/layout/check-mission.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { checkWorkspace, isError } from "../../src/plugins/check-workspace.js";
import { getDoodadModel } from "../../src/catalog/stock-catalog.js";
import { catalogLayerOf } from "../../src/mods/campaign-catalog.js";
import { bindLikeOriginal, blueprintPlugins } from "../../src/plugins/plugin-api.js";
import { loadWorkspace, parseMissionBlueprint, readRawBlueprint, validateMissionBlueprint } from "../../src/plugins/workspace.js";
import { syncMission } from "../../src/sync/sync-mission.js";
import { CROSSING, cleanupLantern, lanternWorkspace, useLantern } from "./lantern-fixture.js";
import { put } from "./mod-fixture.js";

const savedAt = new Date("2026-01-01T00:00:00Z");

afterEach(cleanupLantern);

describe("a Workspace's Campaign Mod as a catalog layer", () => {
  it("gives a Mission its Kept tileset, texture, Light and unit, compiled and checked in full", async () => {
    const { root, blueprintPath } = await lanternWorkspace();
    await useLantern(blueprintPath, "LanternCoast");
    const workspace = await loadWorkspace(root);

    const compiled = await compileMission(workspace, blueprintPath, path.join(root, "build", "Lantern.SC2Map"), { savedAt });
    const terrain = await readFile(path.join(compiled.outputDir, "t3Terrain.xml"), "utf8");
    expect(terrain).toContain("LanternShingle");
    expect(terrain).toContain("MeinhoffEx1Cliff0");
    expect(compiled.warnings.filter((warning) => /LanternDusk|LanternSky/.test(warning))).toEqual([]);

    const check = await checkWorkspace(root);
    expect(check.problems.filter(isError)).toEqual([]);
    const { checks } = await checkMissionLayout(workspace, blueprintPath);
    expect(checks.length).toBeGreaterThan(0);
  }, 60_000);

  it("reads a tileset the mod's Blueprint owns, on its Kept parent", async () => {
    const { root, blueprintPath } = await lanternWorkspace();
    await useLantern(blueprintPath, "LanternReef");
    const workspace = await loadWorkspace(root);

    expect(getTilesetTextures(workspace.catalog, "LanternReef")[0]).toBe("LanternShingle");
    expect(getTilesetCliffSets(workspace.catalog, "LanternReef")).toEqual(["MeinhoffEx1Cliff1", "MeinhoffEx1Cliff0"]);
    expect(getTilesetSky(workspace.catalog, "LanternReef")).toEqual({ skybox: "LanternSky", hideLowestLevel: "1", fogEnabled: "1", fogColor: "255,40,60,90" });
    const compiled = await compileMission(workspace, blueprintPath, path.join(root, "build", "Reef.SC2Map"), { savedAt });
    // Its natural cliff is its own first.
    expect(await readFile(path.join(compiled.outputDir, "t3Terrain.xml"), "utf8")).toContain("MeinhoffEx1Cliff1");
    expect((await checkWorkspace(root)).problems.filter(isError)).toEqual([]);
  }, 60_000);

  it("takes a unit's flight from its parent in the game's data", async () => {
    const { root } = await lanternWorkspace();
    const { catalog } = await loadWorkspace(root);
    expect(techUnit(catalog, "LanternKite")).toEqual({ flyer: true });
    expect(techUnit(catalog, "SignalBeacon")).toEqual({});
  });

  it("refuses the mod's tileset and units when the Workspace names no Campaign Mod", async () => {
    const { root, blueprintPath } = await lanternWorkspace({ named: false });
    await useLantern(blueprintPath, "LanternCoast");

    const messages = (await checkWorkspace(root)).problems.filter(isError).map((problem) => `${problem.path}: ${problem.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringMatching(/^tilesetId: Unknown tileset LanternCoast/), expect.stringMatching(/^tech\.0\.allow\.units\.0: Unknown unit or building: SignalBeacon/)]),
    );
  }, 60_000);

  it("reports a Campaign Mod whose entries can't be read, and gives Missions none of them", async () => {
    const { root, blueprintPath } = await lanternWorkspace();
    await useLantern(blueprintPath, "LanternCoast");
    await writeFile(path.join(root, "mods", "lantern-story", "entries", "terrain.json"), "[{");

    const messages = (await checkWorkspace(root)).problems.filter(isError).map((problem) => `${problem.mod ?? problem.mission}: ${problem.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^lantern-story: Can't read the Campaign Mod Lantern-Story in mods\/lantern-story's catalog entries: The generic entries source entries\/terrain\.json isn't JSON/),
        expect.stringMatching(/^ashen-crossing: Unknown tileset LanternCoast/),
      ]),
    );
  }, 60_000);

  it("reads only the package's catalog files the game loads: those named by their catalog, and those the includes list names", async () => {
    const { root } = await lanternWorkspace();
    const pkg = path.join(root, "mods", "lantern-story", "Lantern-Story.SC2Mod", "Base.SC2Data");
    await writeFile(path.join(pkg, "GameData.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<Includes>\n    <Catalog path="GameData/Extra/Lights.xml"/>\n</Includes>\n`);
    await put(path.join(pkg, "GameData", "Extra", "Lights.xml"), `<Catalog><CLight id="LanternDawn"/></Catalog>`);
    await put(path.join(pkg, "GameData", "Old", "LightData.xml"), `<Catalog><CLight id="LanternStray"/></Catalog>`);
    await put(path.join(pkg, "GameData", "Notes.xml"), `<Catalog><CLight id="LanternNote"/></Catalog>`);

    const { catalog } = await loadWorkspace(root);
    expect(catalog.error).toBeUndefined();
    expect([...catalog.lights].sort()).toEqual(["LanternDawn", "LanternDusk"]);
  });

  it("checks each Workspace's Missions against its own Campaign Mod, whichever Workspace loaded last", async () => {
    const { root, blueprintPath } = await lanternWorkspace();
    await useLantern(blueprintPath, "LanternCoast");
    const lantern = await loadWorkspace(root);
    await loadWorkspace(CROSSING);

    expect(validateMissionBlueprint(lantern, await readRawBlueprint(blueprintPath), lantern.catalog).success).toBe(true);
  });

  it("syncs and freezes a Mission on the mod's tileset against its own Workspace, whichever loaded last", async () => {
    const { root, blueprintPath } = await lanternWorkspace();
    await useLantern(blueprintPath, "LanternCoast");
    const lantern = await loadWorkspace(root);
    const { outputDir } = await compileMission(lantern, blueprintPath, undefined, { savedAt });
    await loadWorkspace(CROSSING);

    expect((await syncMission(lantern, blueprintPath, outputDir)).changes).toEqual([]);
    await expect(freezeMissionSetPiece(lantern, blueprintPath, "nope")).rejects.toThrow(/^No set piece nope$/);
  }, 60_000);

  it("compiles a Blueprint against the Catalog it was validated against, and a copy bound like it against the same", async () => {
    const { root, blueprintPath } = await lanternWorkspace();
    await useLantern(blueprintPath, "LanternCoast");
    const workspace = await loadWorkspace(root);
    const blueprint = await parseMissionBlueprint(workspace, blueprintPath);

    expect(blueprintCatalog(blueprint)).toBe(workspace.catalog);
    const copy = bindLikeOriginal({ ...blueprint, title: "Copy" }, blueprint);
    expect(blueprintCatalog(copy)).toBe(workspace.catalog);
    expect(blueprintPlugins(copy)).toBe(workspace.registry);
    // A copy not bound has the game's entries alone, as a Blueprint made in code does.
    expect(blueprintCatalog({ ...blueprint })).toBe(EMPTY_CATALOG);
  });

  it("compiles two Workspaces with different Campaign Mods at once, each against its own", async () => {
    const shingle = await lanternWorkspace();
    const gravel = await lanternWorkspace({ texture: "LanternGravel" });
    await Promise.all([useLantern(shingle.blueprintPath, "LanternCoast"), useLantern(gravel.blueprintPath, "LanternCoast")]);
    const compile = async ({ root, blueprintPath }: { readonly root: string; readonly blueprintPath: string }) => {
      const { outputDir } = await compileMission(await loadWorkspace(root), blueprintPath, path.join(root, "build", "Lantern.SC2Map"), { savedAt });
      return readFile(path.join(outputDir, "t3Terrain.xml"), "utf8");
    };

    const [shingleTerrain, gravelTerrain] = await Promise.all([compile(shingle), compile(gravel)]);
    expect(shingleTerrain).toContain("LanternShingle");
    expect(shingleTerrain).not.toContain("LanternGravel");
    expect(gravelTerrain).toContain("LanternGravel");
    expect(gravelTerrain).not.toContain("LanternShingle");
  }, 60_000);
});

describe("a Campaign Mod's catalog files, merged as the game merges them", () => {
  const catalog = (body: string) => `<Catalog>\n${body}\n</Catalog>`;

  it("replaces an indexed field by its index, drops one removed, and keeps the rest", () => {
    const layer = catalogLayerOf([
      catalog(`<CUnit id="Tower"><Attributes index="Structure" value="1"/><Attributes index="Armored" value="1"/><Mover value="Fly"/></CUnit>`),
      catalog(`<CUnit id="Tower"><Attributes index="Armored" value="0"/></CUnit>`),
      catalog(`<CTerrain id="Coast"><CliffSets index="0" value="A"/><CliffSets index="1" value="B"/></CTerrain>`),
      catalog(`<CTerrain id="Coast"><CliffSets index="1" removed="1"/><BlendTextures/><BlendTextures value="Sand"/></CTerrain>`),
    ]);
    expect(layer.units.get("Tower")).toEqual({ mover: "Fly", structure: true });
    expect(layer.tilesets.get("Coast")).toMatchObject({ textures: ["Sand"] });
    expect(getTilesetCliffSets({ ...EMPTY_CATALOG, ...layer }, "Coast")).toEqual(["A"]);
  });

  it("reads a behaviour of any CBehavior class, and checks one against the mod's and the game's", () => {
    const layer = catalogLayerOf([catalog(`<CBehaviorBuff id="Dormant"/><CBehaviorPowerSource id="BeaconPower" parent="PowerSource"/><CBehaviorBuff id="BuffBase" default="1"/>`)]);
    const merged = { ...EMPTY_CATALOG, ...layer };
    expect([...layer.behaviors].sort()).toEqual(["BeaconPower", "Dormant"]);
    expect([isKnownBehavior(merged, "Dormant"), isKnownBehavior(merged, "PowerSource"), isKnownBehavior(merged, "BuffBase"), isKnownBehavior(EMPTY_CATALOG, "Dormant")]).toEqual([true, true, false, false]);
  });

  it("reads an effect of any CEffect class, and checks one against the mod's and the game's", () => {
    const layer = catalogLayerOf([catalog(`<CEffectDamage id="RaidStrikeDamage"/><CEffectSet id="RaidStrikeSet"/><CEffectDamage id="DamageBase" default="1"/>`)]);
    const merged = { ...EMPTY_CATALOG, ...layer };
    expect([...layer.effects].sort()).toEqual(["RaidStrikeDamage", "RaidStrikeSet"]);
    expect([isKnownEffect(merged, "RaidStrikeDamage"), isKnownEffect(merged, "250mmStrikeCannonsDamage"), isKnownEffect(merged, "DamageBase"), isKnownEffect(EMPTY_CATALOG, "RaidStrikeDamage")]).toEqual([true, true, false, false]);
  });

  it("replaces an index in its place, and lays an entry's indices over the list its parent gives it", () => {
    const layer = catalogLayerOf([
      catalog(`<CTerrain id="Coast"><CliffSets value="A"/><CliffSets value="B"/><CliffSets value="C"/></CTerrain>`),
      catalog(`<CTerrain id="Coast"><CliffSets index="0" value="Z"/></CTerrain>`),
      catalog(`<CTerrain id="Reef" parent="Coast"><CliffSets index="1" value="Y"/></CTerrain><CTerrain id="Shoal" parent="Coast"><CliffSets index="0" removed="1"/></CTerrain>`),
    ]);
    const merged = { ...EMPTY_CATALOG, ...layer };
    expect(getTilesetCliffSets(merged, "Coast")).toEqual(["Z", "B", "C"]);
    expect(getTilesetCliffSets(merged, "Reef")).toEqual(["Z", "Y", "C"]);
    expect(getTilesetCliffSets(merged, "Shoal")).toEqual(["B", "C"]);
  });

  it("replaces the package's copy of an entry the Blueprint owns outright, a field it dropped gone", () => {
    const layer = catalogLayerOf(
      [catalog(`<CUnit id="Kite"><Mover value="Fly"/><Attributes index="Structure" value="1"/></CUnit>`)],
      [catalog(`<CUnit id="Kite" parent="Medivac"/>`), catalog(`<CUnit id="Kite"><Attributes index="Structure" value="0"/></CUnit>`)],
    );
    expect(layer.units.get("Kite")).toEqual({ parent: "Medivac", structure: false });
  });

  it("gives a doodad whose model's variation count isn't a number its parent model's count, else none", () => {
    const layer = catalogLayerOf([
      catalog(`<CModel id="Base"><VariationCount value="2"/></CModel><CModel id="Lamp" parent="Base"><VariationCount value="many"/></CModel><CModel id="Post"><VariationCount value=""/></CModel>`),
      catalog(`<CActorDoodad id="Lamp"/><CActorDoodad id="Post"/><CActorDoodad id="Odd"><Model value="Lamp"/><VariationCount value="x"/></CActorDoodad>`),
    ]);
    expect(Object.fromEntries(layer.doodads)).toEqual({
      Lamp: { variations: 2, model: "Assets/Doodads/Lamp/Lamp.m3" },
      Post: { variations: 1, model: "Assets/Doodads/Post/Post.m3" },
      Odd: { variations: 2, model: "Assets/Doodads/Lamp/Lamp.m3" },
    });
  });

  it("lets a later definition stop an entry being a template", () => {
    const layer = catalogLayerOf([catalog(`<CTerrain id="Base" default="1"/>`), catalog(`<CTerrain id="Base" default="0"/>`)]);
    expect(layer.tilesets.get("Base")).toEqual({ sky: {} });
  });

  it("finds a doodad's model through its parent actor, for its variations", () => {
    const layer = catalogLayerOf([
      catalog(`<CModel id="LampModel"><VariationCount value="3"/></CModel>`),
      catalog(`<CActorDoodad id="LampBase" default="1"><Model value="LampModel"/></CActorDoodad><CActorDoodad id="Lamp" parent="LampBase"/><CActorDoodad id="Post"/>`),
    ]);
    expect(Object.fromEntries(layer.doodads)).toEqual({ Lamp: { variations: 3, model: "Assets/Doodads/LampModel/LampModel.m3" }, Post: { model: "Assets/Doodads/Post/Post.m3" } });
  });

  it("resolves a doodad's model file through its CModel and the model's parents, ##id## its model's id, else the game's file", () => {
    const layer = catalogLayerOf([
      catalog(
        `<CModel id="Fan" parent="Doodad"><Model value="Assets\\Doodads(Custom)\\Fan\\HarbourFan.m3"/></CModel>` +
          `<CModel id="CrateBase" default="1"><Model value="Assets\\Doodads(Custom)\\##id##\\##id##.m3"/></CModel><CModel id="Crate" parent="CrateBase"/>`,
      ),
      catalog(`<CActorDoodad id="Fan"/><CActorDoodad id="Crate"/><CActorDoodad id="Blocker"><Model value="Invisible"/></CActorDoodad><CActorDoodad id="Gate"><Model value="GateControl"/></CActorDoodad>`),
    ]);
    expect(layer.doodads.get("Fan")?.model).toBe("Assets/Doodads(Custom)/Fan/HarbourFan.m3");
    expect(layer.doodads.get("Crate")?.model).toBe("Assets/Doodads(Custom)/Crate/Crate.m3");
    expect(layer.doodads.get("Blocker")?.model).toBe("Assets/Doodads/Invisible/Invisible.m3");
    expect(layer.doodads.get("Gate")?.model).toBe("Assets/Doodads/GateControl/GateControl.m3");
  });

  it("reads an actor template's ##id## Model as each actor's own id, and a model under a game model as that model's file", () => {
    const layer = catalogLayerOf([
      catalog(`<CModel id="HarbourCrate" parent="Doodad"><Model value="Assets\\Doodads(Custom)\\Crate\\Crate.m3"/></CModel><CModel id="HarbourArch" parent="RockArch"/>`),
      catalog(`<CActorDoodad id="HarbourBase" default="1"><Model value="##id##"/></CActorDoodad><CActorDoodad id="HarbourCrate" parent="HarbourBase"/><CActorDoodad id="HarbourArch"/>`),
    ]);
    expect(layer.doodads.get("HarbourCrate")?.model).toBe("Assets/Doodads(Custom)/Crate/Crate.m3");
    expect(layer.doodads.get("HarbourArch")?.model).toBe(getDoodadModel("RockArch"));
    expect(getDoodadModel("RockArch")).toBeDefined();
  });
});
