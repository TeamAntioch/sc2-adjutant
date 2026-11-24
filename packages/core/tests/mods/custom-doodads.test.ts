// Custom doodads (#606): a Campaign Mod Blueprint's `doodads` compile down to a CModel and a
// CActorDoodad of one id, so every Mission can place the model and the Editor's palette lists it,
// after the compile has found the model and every texture it names in the Workspace's mod packages
// (its Asset Mod's), and warns about bounds that don't cover the mesh; and their texture swaps (#835),
// whose CTextures go in the Campaign Mod's data, their new textures in its Asset Mod. The mods are synthetic.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CustomDoodadSchema } from "../../src/domain/custom-doodad.js";
import { ModBlueprintSchema } from "../../src/domain/mod-blueprint.js";
import { bareHost, loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { readCampaignCatalog } from "../../src/mods/campaign-catalog.js";
import { shapeEntries } from "../../src/mods/characters.js";
import { compileMod } from "../../src/mods/compile-mod.js";
import { customDoodadEntries } from "../../src/mods/custom-doodads.js";
import { entryXml } from "../../src/mods/generic-entries.js";
import { importMod } from "../../src/mods/import-mod.js";
import { loadWorkspace, WORKSPACE_FILE } from "../../src/plugins/workspace.js";
import { m3 } from "../fixtures/m3.js";
import { binary, cleanupMods, declare, documentHeader, inPackage, type Mod, put, setup } from "./mod-fixture.js";

afterEach(cleanupMods);

const MODEL = "Assets/Doodads(Custom)/Rings/HarbourRing.m3";
const TEXTURES = ["Assets/Textures/HarbourRing_Diff.dds", "Assets\\Textures\\HarbourRing_Em.dds"];
/** A ring 32 wide, its bounds as given: by default they cover it. */
const ring = (bounds: { min: [number, number, number]; max: [number, number, number] } = { min: [-16, -16, 0], max: [16, 16, 2.25] }, strings = TEXTURES) =>
  m3([], { bounds, vertices: [[-16, 0, 0], [16, 0, 2.2], [0, -16, 1], [0, 16, 1]], strings });

/**
 * Harbour-Story as the Workspace's Campaign Mod, with its Asset Mod Harbour-Art beside it holding
 * `files` (storage path to bytes) under Base.SC2Assets.
 */
async function harbourWithModels(files: Record<string, Uint8Array>): Promise<Mod> {
  const story = await setup();
  const source = path.join(path.dirname(story.workspaceRoot), "elsewhere", "Harbour-Art.SC2Mod");
  await put(path.join(source, "DocumentHeader"), documentHeader([], 6));
  await put(path.join(source, "DocumentInfo"), `<?xml version="1.0" encoding="utf-8"?>\r\n<DocInfo/>\r\n`);
  for (const [file, data] of Object.entries(files)) await put(path.join(source, "Base.SC2Assets", ...file.split(/[\\/]/)), data);
  await importMod(await loadWorkspace(story.workspaceRoot), source, "harbour-art", { kind: "asset" });
  const config = JSON.parse(await readFile(path.join(story.workspaceRoot, WORKSPACE_FILE), "utf8"));
  await writeFile(path.join(story.workspaceRoot, WORKSPACE_FILE), JSON.stringify({ ...config, campaignMod: "Harbour-Story", mods: ["harbour-story", "harbour-art"] }));
  return story;
}

const textures = (): Record<string, Uint8Array> => Object.fromEntries(TEXTURES.map((file, index) => [file, binary(20 + index)]));
const RING = { id: "HarbourRing", model: MODEL, name: "Harbour Ring", group: "Structures", tilesets: ["Char", "Bel'Shir"] };

describe("a Campaign Mod Blueprint's doodads", () => {
  it("compile into ModelData and ActorData: a Doodad CModel of the file and a CActorDoodad of its id, still, unscaled, named", async () => {
    const mod = await harbourWithModels({ [MODEL]: ring(), ...textures() });
    await declare(mod, { doodads: [RING] });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.warnings).toEqual([]);
    expect(await inPackage(mod, "Base.SC2Data/GameData/ModelData.xml")).toContain(
      [`    <CModel id="HarbourRing" parent="Doodad">`, `        <Model value="Assets\\Doodads(Custom)\\Rings\\HarbourRing.m3"/>`, `    </CModel>`].join("\n"),
    );
    expect(await inPackage(mod, "Base.SC2Data/GameData/ActorData.xml")).toContain(
      [
        `    <CActorDoodad id="HarbourRing">`,
        `        <On index="0" removed="1"/>`,
        `        <On index="1" removed="1"/>`,
        `        <EditorCategories value="DoodadType:Structures"/>`,
        `        <TexSets value="Char"/>`,
        `        <TexSets value="Bel'Shir"/>`,
        `        <RandomScaleRange value="1.000000,1.000000"/>`,
        `    </CActorDoodad>`,
      ].join("\n"),
    );
    const strings = await inPackage(mod, "enUS.SC2Data/LocalizedData/ObjectStrings.txt");
    expect(strings).toContain("Actor/Name/HarbourRing=Harbour Ring");
    expect(strings).toContain("Model/Name/HarbourRing=Harbour Ring");
  });

  it("reach the catalog layer as doodads of their model's file, so a Mission can place them", async () => {
    const mod = await harbourWithModels({ [MODEL]: ring(), ...textures() });
    await declare(mod, { doodads: [RING] });

    const catalog = await readCampaignCatalog(await loadWorkspace(mod.workspaceRoot));

    expect(catalog.error).toBeUndefined();
    expect(catalog.doodads.get("HarbourRing")).toEqual({ model: MODEL, categories: "DoodadType:Structures" });
    expect(catalog.models.has("HarbourRing")).toBe(true);
  });

  it("are refused when the model isn't in the Workspace's mod packages", async () => {
    const mod = await harbourWithModels(textures());
    await declare(mod, { doodads: [RING] });

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/doodads\.0 \(HarbourRing\)'s model Assets\/Doodads\(Custom\)\/Rings\/HarbourRing\.m3 isn't in the mod packages it loads from the Workspace \(mods\/harbour-art\/Harbour-Art\.SC2Mod, mods\/harbour-story\/Harbour-Story\.SC2Mod\)/);
  });

  it("are refused, naming each one, when the model names a texture that isn't there, unless gameTextures says it's the game's", async () => {
    const mod = await harbourWithModels({ [MODEL]: ring(undefined, [...TEXTURES, "Assets/Textures/ShipPlating_Col.dds"]), [TEXTURES[0]!]: binary(20) });
    await declare(mod, { doodads: [RING] });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/names textures that aren't in .*: Assets\\Textures\\HarbourRing_Em\.dds, Assets\/Textures\/ShipPlating_Col\.dds\. Add each file at that path, or, when it is the game's own texture, list it in the doodad's gameTextures/);

    await declare(mod, { doodads: [{ ...RING, gameTextures: ["Assets/Textures/HarbourRing_Em.dds", "assets\\textures\\shipplating_col.DDS", "Assets/Textures/Unused.dds"] }] });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.warnings).toEqual(["doodads.0 (HarbourRing)'s gameTextures lists Assets/Textures/Unused.dds, which its model doesn't name: leave it out"]);
  });

  it("warn when the model's bounds don't cover its mesh, as m3studio's default box doesn't, and when an animated one has no Stand", async () => {
    const mod = await harbourWithModels({ [MODEL]: ring({ min: [-2, -2, -0.25], max: [2, 2, 2] }), ...textures() });
    await declare(mod, { doodads: [{ ...RING, animate: true }] });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.warnings).toEqual([
      `doodads.0 (HarbourRing)'s model ${MODEL} has bounds (-2, -2, -0.25) to (2, 2, 2) that don't cover its mesh, (-16, -16, 0) to (16, 16, 2.2): the game culls the whole model once those bounds leave the screen. Export it again with the armature's m3_bounds covering the mesh (for a model that turns, as wide as its farthest point)`,
      `doodads.0 (HarbourRing) is animated, but its model ${MODEL} has no Stand animation to loop: leave animate out for a still prop`,
    ]);
    expect(await inPackage(mod, "Base.SC2Data/GameData/ActorData.xml")).not.toContain(`<On index="1" removed="1"/>`);
  });

  it("are refused, naming each, when the model or a texture is a Git LFS pointer this machine hasn't pulled", async () => {
    const pointer = new TextEncoder().encode("version https://git-lfs.github.com/spec/v1\noid sha256:0000\nsize 12\n");
    const mod = await harbourWithModels({ [MODEL]: ring(), [TEXTURES[0]!]: pointer, [TEXTURES[1]!]: binary(21) });
    await declare(mod, { doodads: [RING] });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(
      "doodads.0 (HarbourRing)'s Assets/Textures/HarbourRing_Diff.dds (mods/harbour-art/Harbour-Art.SC2Mod/Base.SC2Assets/Assets/Textures/HarbourRing_Diff.dds) is a Git LFS pointer, its file not pulled on this machine: run git lfs pull, then compile again",
    );

    await put(path.join(mod.workspaceRoot, "mods", "harbour-art", "Harbour-Art.SC2Mod", "Base.SC2Assets", ...MODEL.split("/")), pointer);
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/HarbourRing\)'s Assets\/Doodads\(Custom\)\/Rings\/HarbourRing\.m3 \(.*\) is a Git LFS pointer/);
  });

  it("are refused with a game doodad's or unit's id, in any case, and warned about at a game doodad model's path", async () => {
    const mod = await harbourWithModels({ [MODEL]: ring(), ...textures(), "Assets/Doodads/ActorLightSpot/ActorLightSpot.m3": ring() });
    await declare(mod, { doodads: [{ ...RING, id: "marine" }] });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("doodads.0 (marine)'s id is the game's unit Marine: its CModel and CActorDoodad would replace that unit's model and actor");
    await declare(mod, { doodads: [{ ...RING, id: "AcidFalls" }] });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("doodads.0 (AcidFalls)'s id is the game's doodad AcidFalls");

    await declare(mod, { doodads: [{ ...RING, model: "Assets/Doodads/ActorLightSpot/ActorLightSpot.m3" }] });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.warnings).toEqual([
      "doodads.0 (HarbourRing)'s model Assets/Doodads/ActorLightSpot/ActorLightSpot.m3 is at a game doodad's model's path: its file replaces the game's for every doodad and unit that draws it. Give it a path of its own, unless that replacement is the point",
    ]);
  });

  it("draw the game's own model with gameModel: a CModel at its path, no file in the mod packages, no warning at a game doodad model's path", async () => {
    const mod = await harbourWithModels(textures());
    const light = { id: "HarbourLight", model: "Assets/Doodads/ActorLightSpot/ActorLightSpot.m3", gameModel: true };
    await declare(mod, { doodads: [light, { id: "HarbourPylon", model: "Assets\\Buildings\\Protoss\\PylonEx2\\PylonEx2.m3", gameModel: true }] });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.warnings).toEqual([]);
    const models = await inPackage(mod, "Base.SC2Data/GameData/ModelData.xml");
    expect(models).toContain([`    <CModel id="HarbourLight" parent="Doodad">`, `        <Model value="Assets\\Doodads\\ActorLightSpot\\ActorLightSpot.m3"/>`, `    </CModel>`].join("\n"));
    expect(models).toContain(`<Model value="Assets\\Buildings\\Protoss\\PylonEx2\\PylonEx2.m3"/>`);
  });

  it("are refused with gameModel at a path the game has no model at, naming it", async () => {
    const mod = await harbourWithModels({ [MODEL]: ring(), ...textures() });
    await declare(mod, { doodads: [{ ...RING, gameModel: true }] });

    const refused = compileMod(mod.blueprintPath);
    await expect(refused).rejects.toThrow(`doodads.0 (HarbourRing)'s model ${MODEL} is a gameModel, but core knows of no game model at that path`);
    await expect(refused).rejects.toThrow("a game file core's list lacks");
  });

  it("warn with gameModel when a mod package holds a file at the model's path, which the game draws instead", async () => {
    const light = "Assets/Doodads/ActorLightSpot/ActorLightSpot.m3";
    const mod = await harbourWithModels({ ...textures(), [light]: ring() });
    await declare(mod, { doodads: [{ id: "HarbourLight", model: light, gameModel: true }] });

    expect((await compileMod(mod.blueprintPath)).warnings).toEqual([
      `doodads.0 (HarbourLight)'s model ${light} is a gameModel, but mods/harbour-art/Harbour-Art.SC2Mod/Base.SC2Assets/${light} is at that path too, and the game draws that file instead: remove it, unless that replacement is the point`,
    ]);
  });

  it("take a game doodad with variations by its numbered files alone, and one without by its plain file alone, as the game names them", async () => {
    const mod = await harbourWithModels(textures());
    const game = (model: string) => declare(mod, { doodads: [{ id: "HarbourArch", model, gameModel: true }] });
    await game("Assets/Doodads/RockArch/RockArch_03.m3");
    await expect(compileMod(mod.blueprintPath)).resolves.toBeDefined();

    await game("Assets/Doodads/RockArch/RockArch.m3");
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("core knows of no game model at that path");
    await game("Assets/Doodads/ActorLightSpot/ActorLightSpot_00.m3");
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("core knows of no game model at that path");
  });

  it("are refused with gameModel and gameTextures, which a game model's textures need none of", () => {
    expect(CustomDoodadSchema.safeParse({ id: "Crate", model: "Assets/Crate.m3", gameModel: true }).success).toBe(true);
    const listed = ModBlueprintSchema.safeParse({ id: "harbour-story", kind: "campaign", doodads: [{ ...RING, gameModel: true, gameTextures: ["Assets/Textures/X.dds"] }] });
    expect(listed.error?.issues[0]?.message).toBe("a gameModel's textures are the game's own: list only a swap's with texture in gameTextures, not Assets/Textures/X.dds");
  });

  it("are a Campaign Mod's alone, each id once", () => {
    const base = { id: "harbour-art", kind: "asset", doodads: [RING] };
    expect(ModBlueprintSchema.safeParse(base).error?.issues[0]?.message).toMatch(/Only a Campaign Mod declares doodads/);
    const twice = ModBlueprintSchema.safeParse({ ...base, kind: "campaign", doodads: [RING, { ...RING, id: "harbourring" }] });
    expect(twice.error?.issues[0]?.message).toBe("doodads.0 and doodads.1 are both harbourring: a doodad is declared once");
  });
});

const PYLON = "Assets/Buildings/Protoss/PylonEx2/PylonEx2.m3";
const OWN_PYLON = "Assets/Doodads(Custom)/Pylon/HarbourPylon.m3";
const EMISSIVE = "Assets/Textures/Pylon_Emissive.dds";
const ENVIRO = "Assets/Textures/EnviroTest2.dds";
const GREEN_EMISSIVE = "Assets/Textures/Green_Pylon_Emissive.dds";
const GREEN_ENVIRO = "Assets/Textures/Green_EnviroTest2.dds";
/** A Pylon-like model: its crystal's emissive (MAT_ layer 4) and environment map (6). */
const PYLON_M3 = m3([], { bounds: { min: [-1, -1, 0], max: [1, 1, 2] }, vertices: [[-1, -1, 0], [1, 1, 2]], materials: [{ blendMode: 0 }], materialLayers: [{ name: "pylon_crystal_zeus", layers: { 4: EMISSIVE, 6: ENVIRO } }] });
const SWAPS = [{ replace: EMISSIVE, with: GREEN_EMISSIVE }, { replace: ENVIRO, with: GREEN_ENVIRO }];
const STUDIO = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));

/** The `studio` test Host Adapter beside `mod`'s Workspace, whose game holds `models` at their storage paths. */
async function studioHost(mod: Mod, models: Record<string, Uint8Array>) {
  const cacheDir = path.join(path.dirname(mod.workspaceRoot), "cache");
  for (const [model, data] of Object.entries(models)) await put(path.join(cacheDir, "game", ...model.split("/")), data);
  const machine = path.join(path.dirname(mod.workspaceRoot), "machine.json");
  await writeFile(machine, JSON.stringify({ hostAdapter: STUDIO, cacheDir }));
  return { host: await loadHost(await loadMachineConfig({ file: machine, env: {} })), log: () => readFile(path.join(cacheDir, "host.log"), "utf8") };
}

describe("a Campaign Mod Blueprint's doodad swaps", () => {
  it("write the declarations, the actor's events and a CTexture per swap in the slot of its layer into the Campaign Mod's data, the new textures the Asset Mod's", async () => {
    const mod = await harbourWithModels({ [OWN_PYLON]: PYLON_M3, [EMISSIVE]: binary(30), [ENVIRO]: binary(31), [GREEN_EMISSIVE]: binary(32), [GREEN_ENVIRO]: binary(33) });
    await declare(mod, { doodads: [{ id: "HarbourPylon", model: OWN_PYLON, swaps: SWAPS }] });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.warnings.filter((warning) => warning.includes("HarbourPylon"))).toEqual([]);
    expect(await inPackage(mod, "Base.SC2Data/GameData/ModelData.xml")).toContain(
      `        <TextureDeclares Prefix="Pylon_Emissive">\n            <Adaptions Slot="swap1"/>\n        </TextureDeclares>\n        <TextureDeclares Prefix="EnviroTest2">\n            <Adaptions Slot="swap2"/>\n        </TextureDeclares>`,
    );
    expect(await inPackage(mod, "Base.SC2Data/GameData/ActorData.xml")).toContain(
      [
        `        <On Terms="ActorCreation" Send="TextureSelectById HarbourPylon_Swap1"/>`,
        `        <On Terms="ModelSwapped" Send="TextureSelectById HarbourPylon_Swap1"/>`,
        `        <On Terms="ActorCreation" Send="TextureSelectById HarbourPylon_Swap2"/>`,
        `        <On Terms="ModelSwapped" Send="TextureSelectById HarbourPylon_Swap2"/>`,
      ].join("\n"),
    );
    expect(await inPackage(mod, "Base.SC2Data/GameData/TextureData.xml")).toContain(
      [
        `    <CTexture id="HarbourPylon_Swap1">`,
        `        <File value="Assets\\Textures\\Green_Pylon_Emissive.dds"/>`,
        `        <Slot value="swap1.emissive"/>`,
        `    </CTexture>`,
        `    <CTexture id="HarbourPylon_Swap2">`,
        `        <File value="Assets\\Textures\\Green_EnviroTest2.dds"/>`,
        `        <Slot value="swap2"/>`,
        `    </CTexture>`,
      ].join("\n"),
    );

    // Compiled without the swaps, their CTextures go.
    await declare(mod, { doodads: [{ id: "HarbourPylon", model: OWN_PYLON }] });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "Base.SC2Data/GameData/TextureData.xml").catch(() => "")).not.toContain("HarbourPylon_Swap");
  });

  it("are refused when a new texture isn't in the mod packages it loads, unless gameTextures says it's the game's, and when the model doesn't name the one replaced", async () => {
    const mod = await harbourWithModels({ [OWN_PYLON]: PYLON_M3, [EMISSIVE]: binary(30), [ENVIRO]: binary(31), [GREEN_EMISSIVE]: binary(32) });
    await declare(mod, { doodads: [{ id: "HarbourPylon", model: OWN_PYLON, swaps: SWAPS }] });

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(
      `doodads.0 (HarbourPylon)'s swaps.1 draws ${GREEN_ENVIRO}, which isn't in the mod packages it loads from the Workspace (mods/harbour-art/Harbour-Art.SC2Mod, mods/harbour-story/Harbour-Story.SC2Mod), where an Asset Mod's assets put its files once it's compiled: add the file there, or, when it is the game's own texture, list it in the doodad's gameTextures`,
    );

    await declare(mod, { doodads: [{ id: "HarbourPylon", model: OWN_PYLON, swaps: SWAPS, gameTextures: [GREEN_ENVIRO] }] });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.warnings.filter((warning) => warning.includes("HarbourPylon"))).toEqual([]);
    expect(await inPackage(mod, "Base.SC2Data/GameData/TextureData.xml")).toContain(`<File value="Assets\\Textures\\Green_EnviroTest2.dds"/>`);

    await declare(mod, { doodads: [{ id: "HarbourPylon", model: OWN_PYLON, swaps: [{ replace: "Assets/Textures/Nope.dds", with: GREEN_EMISSIVE }] }] });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(`doodads.0 (HarbourPylon)'s swaps.0 replaces Assets/Textures/Nope.dds, which its model ${OWN_PYLON} doesn't name. It names ${EMISSIVE}, ${ENVIRO}`);
  });

  it("on a gameModel read the game's .m3 through the Host Adapter, and are refused without one that can", async () => {
    const mod = await harbourWithModels({ [GREEN_EMISSIVE]: binary(32), [GREEN_ENVIRO]: binary(33) });
    await declare(mod, { doodads: [{ id: "HarbourPylon", model: PYLON, gameModel: true, swaps: SWAPS }] });
    const { host, log } = await studioHost(mod, { [PYLON]: PYLON_M3 });

    const compiled = await compileMod(mod.blueprintPath, { host });

    expect(compiled.warnings.filter((warning) => warning.includes("HarbourPylon"))).toEqual([]);
    expect(await log()).toContain(`export ${PYLON}`);
    const textures = await inPackage(mod, "Base.SC2Data/GameData/TextureData.xml");
    expect(textures).toContain(`<Slot value="swap1.emissive"/>`);
    expect(textures).toContain(`<Slot value="swap2"/>`);

    await expect(compileMod(mod.blueprintPath, { host: bareHost() })).rejects.toThrow(
      `doodads.0 (HarbourPylon) swaps textures on the gameModel ${PYLON}, whose .m3 the compile reads from the game for the layer each texture is in, through the Host Adapter's model.export, and this machine's Host Adapter (none) doesn't have it`,
    );
  });

  it("are among the Blueprint's shape entries by id without their slots, and refused there by a compile that didn't resolve them", () => {
    const blueprint = ModBlueprintSchema.parse({ id: "harbour-story", kind: "campaign", doodads: [{ id: "HarbourPylon", model: OWN_PYLON, swaps: SWAPS }] });

    const entries = shapeEntries(blueprint).flatMap((shape) => shape.entries);
    expect(entries.filter((entry) => entry.class === "CTexture").map((entry) => [entry.id, entry.fields])).toEqual([
      ["HarbourPylon_Swap1", { File: "Assets\\Textures\\Green_Pylon_Emissive.dds", Slot: "swap1" }],
      ["HarbourPylon_Swap2", { File: "Assets\\Textures\\Green_EnviroTest2.dds", Slot: "swap2" }],
    ]);
    expect(() => shapeEntries(blueprint, new Map())).toThrow("doodads.0 (HarbourPylon) swaps textures: pass its swaps' slots (modDoodadWarnings) to shapeEntries");
  });

  it("let a gameModel list a swap's new texture in gameTextures, and no other", () => {
    const doodad = { id: "HarbourPylon", model: PYLON, gameModel: true, swaps: SWAPS };
    expect(ModBlueprintSchema.safeParse({ id: "harbour-story", kind: "campaign", doodads: [{ ...doodad, gameTextures: [GREEN_ENVIRO] }] }).success).toBe(true);
    const listed = ModBlueprintSchema.safeParse({ id: "harbour-story", kind: "campaign", doodads: [{ ...doodad, gameTextures: [ENVIRO] }] });
    expect(listed.error?.issues[0]?.message).toBe(`a gameModel's textures are the game's own: list only a swap's with texture in gameTextures, not ${ENVIRO}`);
  });
});

describe("a custom doodad's entries", () => {
  it("give its scale to the CModel and its footprint to the actor, with more fields of either over them", () => {
    const doodad = CustomDoodadSchema.parse({ id: "Crate", model: "Assets/Crate.m3", scale: 1.5, footprint: "FootprintDoodad2x2", fields: { model: { Flags: { index: "AdjustTerrain", value: 1 } }, actor: { RandomScaleRange: "0.9,1.1" } } });
    expect(customDoodadEntries(doodad).map(entryXml)).toEqual([
      [
        `    <CModel id="Crate" parent="Doodad">`,
        `        <Model value="Assets\\Crate.m3"/>`,
        `        <ScaleMin value="1.500000,1.500000,1.500000"/>`,
        `        <ScaleMax value="1.500000,1.500000,1.500000"/>`,
        `        <Flags index="AdjustTerrain" value="1"/>`,
        `    </CModel>`,
      ].join("\n"),
      [`    <CActorDoodad id="Crate">`, `        <On index="0" removed="1"/>`, `        <On index="1" removed="1"/>`, `        <Footprint value="FootprintDoodad2x2"/>`, `        <RandomScaleRange value="0.9,1.1"/>`, `    </CActorDoodad>`].join("\n"),
    ]);
  });

  it("refuse a model that isn't an .m3 file's storage path", () => {
    expect(CustomDoodadSchema.safeParse({ id: "Crate", model: "Assets/Crate.dds" }).success).toBe(false);
    expect(CustomDoodadSchema.safeParse({ id: "Crate", model: "/Users/me/Crate.m3" }).success).toBe(false);
    expect(CustomDoodadSchema.safeParse({ id: "Crate", model: "../Crate.m3" }).success).toBe(false);
  });
});

describe("Generic Entries' asset paths (#49)", () => {
  const GAME_MODEL = "Assets\\Doodads\\ActorLightSpot\\ActorLightSpot.m3";
  const GAME_ICON = "Assets\\Textures\\btn-ability-terran-activatemine.dds";
  const withEntries = async (mod: Mod, fields: Record<string, unknown>[]) =>
    declare(mod, { entries: [{ source: "entries/assets.json" }] }, { "entries/assets.json": `${JSON.stringify(fields)}\n` });
  const model = (id: string, file: string) => ({ catalog: "Model", class: "CModel", id, parent: "Doodad", fields: { Model: file } });
  const button = (id: string, icon: string) => ({ catalog: "Button", class: "CButton", id, fields: { Icon: icon } });

  it("warns about a missing model and a missing icon, naming the entry, field and path", async () => {
    const mod = await harbourWithModels({});
    await withEntries(mod, [model("Ghost", "Assets\\Doodads\\Custom\\Ghost.m3"), button("GhostButton", "Assets\\Textures\\btn-ghost.dds")]);
    const { warnings } = await compileMod(mod.blueprintPath);
    expect(warnings.filter((warning) => warning.includes("Ghost"))).toEqual([
      expect.stringMatching(/^CModel:Ghost's Model names Assets\\Doodads\\Custom\\Ghost\.m3, which isn't in the mod packages it loads from the Workspace .*no game model core knows of/),
      expect.stringMatching(/^CButton:GhostButton's Icon names Assets\\Textures\\btn-ghost\.dds, which isn't in the mod packages .*no game image core knows of/),
    ]);
  });

  it("is quiet for the game's own paths, in any slash and case, and for the Heroes of the Storm and co-op ones", async () => {
    const mod = await harbourWithModels({});
    await withEntries(mod, [model("Spot", GAME_MODEL), button("Mine", GAME_ICON), button("Lower", GAME_ICON.toLowerCase().replace(/\\/g, "/")), model("Coop", "Assets\\Effects\\Terran\\Goliath_Lockdown_Impact\\Goliath_Lockdown_Impact.m3")]);
    const { warnings } = await compileMod(mod.blueprintPath);
    expect(warnings.filter((warning) => warning.includes("names Assets"))).toEqual([]);
  });

  it("is quiet for a file a mod package of the Workspace ships, and one the Blueprint writes", async () => {
    const mod = await harbourWithModels({ [MODEL]: ring(), "Assets/Textures/btn-harbour.dds": binary(3), "Assets/Doodads/Varied/Varied_00.m3": ring() });
    await declare(
      mod,
      { entries: [{ source: "entries/assets.json" }], files: [{ path: "Base.SC2Assets/Assets/Textures/btn-written.dds", source: "files/btn-written.dds" }] },
      {
        "entries/assets.json": `${JSON.stringify([model("Ring", MODEL.replace(/\//g, "\\")), model("Varied", "Assets\\Doodads\\Varied\\Varied.m3"), button("Harbour", "Assets\\Textures\\btn-harbour.dds"), button("Written", "Assets\\Textures\\btn-written.dds")])}\n`,
        "files/btn-written.dds": "dds",
      },
    );
    const { warnings } = await compileMod(mod.blueprintPath);
    expect(warnings.filter((warning) => warning.includes("names Assets"))).toEqual([]);
  });

  it("leaves a doodad's own check as it was: a missing model still refuses", async () => {
    const mod = await harbourWithModels({});
    await declare(mod, { doodads: [RING] });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/doodads\.0 \(HarbourRing\)'s model .* isn't in the mod packages/);
  });
});
