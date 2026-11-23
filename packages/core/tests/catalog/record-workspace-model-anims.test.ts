// Recording model animations in a Workspace (ADR-0026): each model goes to its owner's file, a
// game model's to model-anims.json at the root, the Campaign Mod's own beside its Blueprint, a
// Mission's own beside its Blueprint, and the result names the stock models core doesn't record.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { formatWorkspaceRecord, recordWorkspaceModelAnims } from "../../src/catalog/record-workspace-model-anims.js";
import { bareHost, loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { m3 } from "../fixtures/m3.js";
import { copyOf } from "../mcp/harness.js";
import { cleanupLantern, lanternWorkspace } from "../mods/lantern-fixture.js";
import { put } from "../mods/mod-fixture.js";

const studio = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));
const folders: string[] = [];
afterEach(async () => {
  await cleanupLantern();
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

/** The game's ModelData, as the recorder reads it: two story models core doesn't record. */
const GAME_DATA = `<Catalog>
    <CModel id="TestTrooper"><Model value="Assets\\Units\\Trooper\\Trooper.m3"/></CModel>
    <CModel id="TestMedic"><Model value="Assets\\Units\\Medic\\Medic.m3"/></CModel>
</Catalog>`;
const gameModelData = async () => [GAME_DATA];

const STAND = [{ name: "Stand", start: 0, end: 2000, speed: 0, flags: 0 }];

/** The studio Host Adapter, its game install holding the two game models. */
async function studioHost() {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-record-"));
  folders.push(folder);
  const cacheDir = path.join(folder, "cache");
  for (const file of ["Assets/Units/Trooper/Trooper.m3", "Assets/Units/Medic/Medic.m3"]) await put(path.join(cacheDir, "game", file), m3(STAND));
  const machine = path.join(folder, "machine.json");
  await writeFile(machine, JSON.stringify({ hostAdapter: studio, cacheDir }));
  return loadHost(await loadMachineConfig({ file: machine, env: {} }));
}

const read = async (file: string) => JSON.parse(await readFile(file, "utf8"));

/** The lantern Workspace, its Campaign Mod defining the Buoy and its Mission's Map Package the Signal, each with its model file. */
async function ownedModels() {
  const { root, blueprintPath } = await lanternWorkspace();
  const pkg = path.join(root, "mods/lantern-story/Lantern-Story.SC2Mod");
  await put(path.join(pkg, "Base.SC2Data/GameData/ModelData.xml"), `<Catalog>\n    <CModel id="LanternBuoy"><Model value="Assets\\Buoy\\Buoy.m3"/></CModel>\n</Catalog>\n`);
  await put(path.join(pkg, "Base.SC2Assets/Assets/Buoy/Buoy.m3"), m3(STAND));
  const map = path.join(path.dirname(blueprintPath), "Ashen.SC2Map");
  await put(path.join(map, "Base.SC2Data/GameData/ModelData.xml"), `<Catalog>\n    <CModel id="AshenSignal"><Model value="Assets\\Signal\\Signal.m3"/></CModel>\n</Catalog>\n`);
  // A Map Package keeps its files at its root, not in a Base.SC2Assets folder.
  await put(path.join(map, "Assets/Signal/Signal.m3"), m3(STAND));
  await put(path.join(path.dirname(blueprintPath), "compile-record.json"), JSON.stringify({ version: 1, entries: [] }));
  return { root, blueprintPath };
}

describe("recordWorkspaceModelAnims", () => {
  it("records a game model at the Workspace root, keeping what's there, and names it as stock core doesn't record", async () => {
    const root = await copyOf("cinematic");
    await writeFile(path.join(root, "model-anims.json"), JSON.stringify({ TestMedic: { file: "Assets/Old.m3", anims: [] } }));
    const result = await recordWorkspaceModelAnims(await loadWorkspace(root), await studioHost(), ["TestTrooper"], { gameModelData });
    expect(result).toEqual({ written: [{ file: "model-anims.json", models: ["TestTrooper"] }], failed: [], stock: ["TestTrooper"] });
    const recorded = await read(path.join(root, "model-anims.json"));
    expect(Object.keys(recorded)).toEqual(["TestMedic", "TestTrooper"]);
    expect(recorded.TestTrooper.anims).toEqual([{ name: "Stand", durationMs: 2000, moveSpeed: 0, looping: true }]);
    // And the next load casts it.
    expect((await loadWorkspace(root)).catalog.modelAnimsLayers.map((layer) => Object.keys(layer.anims))).toEqual([["TestMedic", "TestTrooper"]]);
  });

  it("records each model in its owner's file: the Campaign Mod's own beside its Blueprint, the Mission's own beside the Mission's", async () => {
    const { root } = await ownedModels();
    const result = await recordWorkspaceModelAnims(await loadWorkspace(root), await studioHost(), ["AshenSignal", "LanternBuoy", "TestTrooper"], { mission: "ashen-crossing", gameModelData });
    expect(result).toEqual({
      written: [
        { file: "model-anims.json", models: ["TestTrooper"] },
        { file: "mods/lantern-story/model-anims.json", models: ["LanternBuoy"] },
        { file: "missions/ashen-crossing/model-anims.json", models: ["AshenSignal"] },
      ],
      failed: [],
      stock: ["TestTrooper"],
    });
    expect(Object.keys(await read(path.join(root, "mods/lantern-story/model-anims.json")))).toEqual(["LanternBuoy"]);
    expect(Object.keys(await read(path.join(root, "missions/ashen-crossing/model-anims.json")))).toEqual(["AshenSignal"]);
  });

  it("records a Mission's own model as a game model's, and fails it, when no Mission is named", async () => {
    const { root } = await ownedModels();
    const result = await recordWorkspaceModelAnims(await loadWorkspace(root), await studioHost(), ["AshenSignal"], { gameModelData });
    expect(result).toEqual({ written: [], failed: [{ id: "AshenSignal", reason: "no ModelData entry" }], stock: [] });
  });

  it("records the packages' models without model.export, and refuses each game model, naming the capability", async () => {
    const { root } = await ownedModels();
    const result = await recordWorkspaceModelAnims(await loadWorkspace(root), bareHost(), ["LanternBuoy", "TestTrooper"], { gameModelData });
    expect(result.written).toEqual([{ file: "mods/lantern-story/model-anims.json", models: ["LanternBuoy"] }]);
    expect(result.failed).toEqual([{ id: "TestTrooper", reason: expect.stringContaining("needs the model.export capability") }]);
    // Nothing is written for a file with nothing recorded.
    await expect(readFile(path.join(root, "model-anims.json"))).rejects.toThrow("ENOENT");
  });

  it("reads the Mission's own model from its Map Package without model.export, and the game's ModelData not being there fails only the game models", async () => {
    const { root } = await ownedModels();
    // As campaignModelData's caller fails on a machine with no cacheDir: before any promise.
    const unfetched = (): Promise<string[]> => {
      throw new Error("No cacheDir is set");
    };
    const result = await recordWorkspaceModelAnims(await loadWorkspace(root), bareHost(), ["AshenSignal", "LanternBuoy", "TestTrooper"], { mission: "ashen-crossing", gameModelData: unfetched });
    expect(result.written).toEqual([
      { file: "mods/lantern-story/model-anims.json", models: ["LanternBuoy"] },
      { file: "missions/ashen-crossing/model-anims.json", models: ["AshenSignal"] },
    ]);
    expect(result.failed).toEqual([{ id: "TestTrooper", reason: "no ModelData entry (the game's ModelData couldn't be read: No cacheDir is set)" }]);
  });

  it("calls no model stock that a Workspace package defines, though it's recorded at the root", async () => {
    const { root } = await ownedModels();
    // The Mission isn't named, so its package isn't read; the mod's Buoy, defined by a package, goes to the mod's file.
    const pkg = path.join(root, "mods/lantern-story/Lantern-Story.SC2Mod");
    await put(path.join(pkg, "Base.SC2Data/GameData/ModelData.xml"), `<Catalog>\n    <CModel id="LanternBuoy"><Model value="Assets\\Buoy\\Buoy.m3"/></CModel>\n</Catalog>\n`);
    const workspace = await loadWorkspace(root);
    // A Workspace whose Campaign Mod's own models aren't known to its catalog sends one to the root.
    const unknown = { ...workspace, catalog: { ...workspace.catalog, models: new Set<string>() } };
    const result = await recordWorkspaceModelAnims(unknown, await studioHost(), ["LanternBuoy", "TestTrooper"], { gameModelData });
    expect(result.written).toEqual([{ file: "model-anims.json", models: ["LanternBuoy", "TestTrooper"] }]);
    expect(result.stock).toEqual(["TestTrooper"]);
  });

  it("refuses while the Campaign Mod's catalog can't be read, or the named Mission's Kept data can't be told", async () => {
    const { root, blueprintPath } = await ownedModels();
    await writeFile(path.join(path.dirname(blueprintPath), "compile-record.json"), "{ not a record");
    await expect(recordWorkspaceModelAnims(await loadWorkspace(root), await studioHost(), ["AshenSignal"], { mission: "ashen-crossing", gameModelData })).rejects.toThrow(
      "Can't tell which of the Mission ashen-crossing's models are its own: its compile record doesn't read",
    );
    await writeFile(path.join(root, "mods/lantern-story/Lantern-Story.SC2Mod/Base.SC2Data/GameData/UnitData.xml"), "<Catalog><CUnit");
    const broken = await loadWorkspace(root);
    if (!broken.catalog.error) throw new Error("the fixture's mod should fail to read");
    await expect(recordWorkspaceModelAnims(broken, await studioHost(), ["TestTrooper"], { gameModelData })).rejects.toThrow("Can't tell which models are the Campaign Mod's own");
  });

  it("leaves a file that doesn't read as it is, failing the models it would get", async () => {
    const root = await copyOf("cinematic");
    await writeFile(path.join(root, "model-anims.json"), "{ not json");
    const result = await recordWorkspaceModelAnims(await loadWorkspace(root), await studioHost(), ["TestTrooper"], { gameModelData });
    expect(result).toEqual({ written: [], stock: [], failed: [{ id: "TestTrooper", reason: expect.stringMatching(/^model-anims\.json isn't JSON: .*; fix it, then record again$/) }] });
    expect(await readFile(path.join(root, "model-anims.json"), "utf8")).toBe("{ not json");
  });

  it("refuses a Mission that isn't the Workspace's", async () => {
    const root = await copyOf("cinematic");
    await expect(recordWorkspaceModelAnims(await loadWorkspace(root), await studioHost(), ["TestTrooper"], { mission: "nowhere", gameModelData })).rejects.toThrow("No Mission nowhere in the Workspace");
  });

  it("doesn't call a game model core records stock", async () => {
    const root = await copyOf("cinematic");
    const data = async () => [`<Catalog>\n    <CModel id="SMX3_BGPeople_01"><Model value="Assets\\Units\\Trooper\\Trooper.m3"/></CModel>\n</Catalog>`];
    const result = await recordWorkspaceModelAnims(await loadWorkspace(root), await studioHost(), ["SMX3_BGPeople_01"], { gameModelData: data });
    expect(result.stock).toEqual([]);
  });
});

describe("formatWorkspaceRecord", () => {
  it("lists each file written, each failure, and the stock models core could carry", () => {
    expect(
      formatWorkspaceRecord({
        written: [{ file: "model-anims.json", models: ["SMX3_Marine", "SMX3_Tech"] }],
        failed: [{ id: "Nobody", reason: "no ModelData entry" }],
        stock: ["SMX3_Marine", "SMX3_Tech"],
      }),
    ).toBe(
      [
        "model-anims.json: SMX3_Marine, SMX3_Tech",
        "Nobody: no ModelData entry",
        "Core doesn't record SMX3_Marine or SMX3_Tech, stock models it could carry for everyone: offer a Missing-Feature Report (the report-missing-feature skill) so they're added to core.",
      ].join("\n"),
    );
  });
});
