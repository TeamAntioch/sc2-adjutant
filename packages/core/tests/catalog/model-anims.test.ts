// Model animation lookup (#112): core finds each model's file in ModelData and reads its
// animations; the Host Adapter's model.export pulls the model out of the game. Run through the
// `studio` fixture Host Adapter.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CAMPAIGN_CATALOGS, campaignModelData, recordModelAnims } from "../../src/catalog/model-anims.js";
import { modelFile, readModelEntries } from "../../src/catalog/model-files.js";
import { bareHost, loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { m3 } from "../fixtures/m3.js";

const studio = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));
const folders: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const MODEL_DATA = `<Catalog>
    <CModel id="Marine"><Model value="Assets\\Units\\Terran\\Marine\\Marine.m3"/></CModel>
    <CModel id="MarineStory" parent="Marine"/>
    <CModel id="Ghost"><Model value="Assets\\Units\\Terran\\Ghost\\Ghost.m3"/></CModel>
</Catalog>`;

async function studioMachine() {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-anims-"));
  folders.push(folder);
  const cacheDir = path.join(folder, "cache");
  const marine = path.join(cacheDir, "game", "Assets/Units/Terran/Marine/Marine.m3");
  await mkdir(path.dirname(marine), { recursive: true });
  await writeFile(marine, m3([
    { name: "Stand", start: 0, end: 2000, speed: 0, flags: 0 },
    { name: "Walk", start: 3000, end: 4000, speed: 2.25, flags: 0 },
  ]));
  const file = path.join(folder, "machine.json");
  await writeFile(file, JSON.stringify({ hostAdapter: studio, cacheDir }));
  const host = await loadHost(await loadMachineConfig({ file, env: {} }));
  return { host, catalogPath: path.join(folder, "model-anims.json") };
}

describe("recordModelAnims", () => {
  it("records each model's file and animations, keeping models recorded before", async () => {
    const { host, catalogPath } = await studioMachine();
    await writeFile(catalogPath, JSON.stringify({ Zealot: { file: "Assets/Zealot.m3", anims: [] } }));
    const result = await recordModelAnims(host, ["MarineStory", "Ghost", "Nobody"], { catalogPath, modelData: [MODEL_DATA] });
    expect(result).toMatchObject({
      recorded: ["MarineStory"],
      failed: [
        { id: "Ghost", reason: expect.stringContaining("ENOENT: no such file or directory") },
        { id: "Nobody", reason: "no ModelData entry" },
      ],
    });
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    // The catalog as written comes back with the result, so a caller needn't read it again.
    expect(result.catalog).toEqual(catalog);
    expect(Object.keys(catalog)).toEqual(["MarineStory", "Zealot"]);
    expect(catalog.MarineStory).toEqual({
      file: "Assets/Units/Terran/Marine/Marine.m3",
      anims: [
        { name: "Stand", durationMs: 2000, moveSpeed: 0, looping: true },
        { name: "Walk", durationMs: 1000, moveSpeed: 2.25, looping: true },
      ],
    });
  });

  it("records a model with variations from its first numbered file, <name>_00.m3, as the game names them", async () => {
    const { host, catalogPath } = await studioMachine();
    const game = path.join(path.dirname(catalogPath), "cache", "game", "Assets/Doodads/Crate_Stack");
    await mkdir(game, { recursive: true });
    await writeFile(path.join(game, "Crate_Stack_00.m3"), m3([{ name: "Stand", start: 0, end: 1500, speed: 0, flags: 0 }]));
    const doodads = `<Catalog>
    <CModel default="1" id="Doodad"><Model value="Assets\\Doodads\\##id##\\##id##.m3"/></CModel>
    <CModel id="Crate_Stack" parent="Doodad"><VariationCount value="3"/></CModel>
</Catalog>`;
    const result = await recordModelAnims(host, ["Crate_Stack"], { catalogPath, modelData: [doodads] });
    expect(result.failed).toEqual([]);
    expect(result.catalog.Crate_Stack).toEqual({ file: "Assets/Doodads/Crate_Stack/Crate_Stack_00.m3", anims: [{ name: "Stand", durationMs: 1500, moveSpeed: 0, looping: true }] });
  });

  it("tries a single-variation model at its numbered name too, and reports why its plain one failed", async () => {
    const { host, catalogPath } = await studioMachine();
    const game = path.join(path.dirname(catalogPath), "cache", "game", "Assets/Doodads/Lone_Rock");
    await mkdir(game, { recursive: true });
    await writeFile(path.join(game, "Lone_Rock_00.m3"), m3([{ name: "Stand", start: 0, end: 1000, speed: 0, flags: 0 }]));
    const doodads = `<Catalog>
    <CModel default="1" id="Doodad"><Model value="Assets\\Doodads\\##id##\\##id##.m3"/></CModel>
    <CModel id="Lone_Rock" parent="Doodad"/>
    <CModel id="Gone_Rock" parent="Doodad"/>
</Catalog>`;
    const result = await recordModelAnims(host, ["Lone_Rock", "Gone_Rock"], { catalogPath, modelData: [doodads] });
    expect(result.catalog.Lone_Rock?.file).toBe("Assets/Doodads/Lone_Rock/Lone_Rock_00.m3");
    expect(result.failed).toEqual([{ id: "Gone_Rock", reason: expect.stringContaining("Gone_Rock") }]);
  });

  it("reads a mod's own model from its assets folder with its RequiredAnims merged in, without the Host Adapter", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-anims-"));
    folders.push(folder);
    const assets = path.join(folder, "Base.SC2Assets");
    await mkdir(path.join(assets, "Assets/Models/Pilot"), { recursive: true });
    await writeFile(path.join(assets, "Assets/Models/Pilot/Pilot.m3"), m3([{ name: "Stand", start: 0, end: 2000, speed: 0, flags: 0 }]));
    await writeFile(path.join(assets, "Assets/Models/Pilot/Pilot_Anims.m3a"), m3([
      { name: "Stand", start: 0, end: 9999, speed: 0, flags: 0 },
      { name: "Talk B 01", start: 0, end: 2667, speed: 0, flags: 0 },
    ]));
    const modData = `<Catalog>
    <CModel id="Pilot" parent="SMCHARACTER">
        <Model value="Assets\\Models\\Pilot\\Pilot.m3"/>
        <RequiredAnims value="Assets\\Models\\Pilot\\Pilot_Anims.m3a"/>
        <RequiredAnims value="Assets\\Models\\Pilot\\Not_Here.m3a"/>
    </CModel>
</Catalog>`;
    const catalogPath = path.join(folder, "model-anims.json");
    const result = await recordModelAnims(bareHost(), ["Pilot", "Marine"], { catalogPath, modelData: [MODEL_DATA, modData], assetRoots: [assets] });
    // The game's own Marine needs model.export, which this host lacks: it fails alone.
    expect(result.failed).toEqual([{ id: "Marine", reason: expect.stringContaining("needs the model.export capability") }]);
    expect(result.recorded).toEqual(["Pilot"]);
    // The model's own clip comes first; a RequiredAnims file the mod doesn't hold is left out.
    expect(result.catalog.Pilot).toEqual({
      file: "Assets/Models/Pilot/Pilot.m3",
      anims: [
        { name: "Stand", durationMs: 2000, moveSpeed: 0, looping: true },
        { name: "Talk B 01", durationMs: 2667, moveSpeed: 0, looping: true },
      ],
    });
  });

  it("needs a Host Adapter that can export models", async () => {
    await expect(recordModelAnims(bareHost(), ["Marine"], { catalogPath: "unused", modelData: [MODEL_DATA] })).rejects.toThrow(
      "Looking up model animations needs the model.export capability",
    );
  });
});

describe("campaignModelData", () => {
  it("reads the campaign mods' ModelData between the race mods and the story mods, as the game loads them", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-game-data-"));
    folders.push(cacheDir);
    // A cached catalog isn't downloaded again; any other would be, and fails here.
    vi.stubGlobal("fetch", async (url: string) => {
      throw new Error(`unexpected download ${url}`);
    });
    const models: Record<string, string> = {
      // A template in the core mod, and a model of it only a campaign mod defines.
      "mods/core.sc2mod": `<CModel default="1" id="StarIcons"><Model value="Assets\\UI\\Stars\\##id##\\##id##.m3"/></CModel>`,
      "campaigns/liberty.sc2campaign": `<CModel id="StarIconVega" parent="StarIcons"/>`,
      // A melee model a later campaign gives its own variant, and one a story mod overrides in turn.
      "mods/void.sc2mod": `<CModel id="Lancer"><Model value="Assets\\Lancer.m3"/></CModel><CModel id="Warden"><Model value="Assets\\Warden.m3"/></CModel>`,
      "campaigns/void.sc2campaign": `<CModel id="Lancer"><Model value="Assets\\Lancer_Campaign.m3"/></CModel><CModel id="Warden"><Model value="Assets\\Warden_Campaign.m3"/></CModel>`,
      "campaigns/voidstory.sc2campaign": `<CModel id="Warden"><Model value="Assets\\Warden_Story.m3"/></CModel>`,
    };
    for (const mod of CAMPAIGN_CATALOGS) {
      const file = path.join(cacheDir, "game-data", mod, "ModelData.xml");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `<Catalog>${models[mod] ?? ""}</Catalog>`);
    }
    const entries = readModelEntries(await campaignModelData(cacheDir));
    expect(modelFile(entries, "StarIconVega")).toBe("Assets/UI/Stars/StarIconVega/StarIconVega.m3");
    expect(modelFile(entries, "Lancer")).toBe("Assets/Lancer_Campaign.m3");
    expect(modelFile(entries, "Warden")).toBe("Assets/Warden_Story.m3");
  });
});
