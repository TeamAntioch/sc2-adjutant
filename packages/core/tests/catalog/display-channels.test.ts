// Display channels (#1054): which render-to-texture channels a model shows, recorded like model
// footprints from each model's file in ModelData, which the Host Adapter's model.export pulls out of
// the game. Run through the `studio` fixture Host Adapter.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { bundledDisplayChannels, displayChannels, recordDisplayChannels } from "../../src/catalog/display-channels.js";
import { setCatalogModelIds } from "../../src/catalog/stock-catalog.js";
import { loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { m3Layers } from "../fixtures/m3.js";

const studio = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const SETS = `<Catalog>
    <CModel default="1" id="SMSET"><Model value="Assets\\StoryModeSets\\##id##\\##id##.m3"/></CModel>
    <CModel id="Bridge_Screen" parent="SMSET"/>
    <CModel id="Bridge_Wall" parent="SMSET"/>
</Catalog>`;

describe("recordDisplayChannels", () => {
  it("records each model's file and the channels it shows, an empty list for a model that shows none, keeping models recorded before", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-display-channels-"));
    folders.push(folder);
    const cacheDir = path.join(folder, "cache");
    const game = (file: string) => path.join(cacheDir, "game", file);
    for (const [id, channels] of [["Bridge_Screen", [-1, 6]], ["Bridge_Wall", [-1]]] as const) {
      await mkdir(path.dirname(game(`Assets/StoryModeSets/${id}/${id}.m3`)), { recursive: true });
      await writeFile(game(`Assets/StoryModeSets/${id}/${id}.m3`), m3Layers([{ version: 26, channels }]));
    }
    const machine = path.join(folder, "machine.json");
    await writeFile(machine, JSON.stringify({ hostAdapter: studio, cacheDir }));
    const host = await loadHost(await loadMachineConfig({ file: machine, env: {} }));
    const catalogPath = path.join(folder, "display-channels.json");
    await writeFile(catalogPath, JSON.stringify({ Old_Holo: { file: "Assets/Old_Holo.m3", channels: [0, 1, 2] } }));

    const result = await recordDisplayChannels(host, ["Bridge_Screen", "Bridge_Wall", "Nobody"], { catalogPath, modelData: [SETS] });
    expect(result.recorded).toEqual(["Bridge_Screen", "Bridge_Wall"]);
    expect(result.failed).toEqual([{ id: "Nobody", reason: "no ModelData entry" }]);
    expect(JSON.parse(await readFile(catalogPath, "utf8"))).toEqual({
      Bridge_Screen: { file: "Assets/StoryModeSets/Bridge_Screen/Bridge_Screen.m3", channels: [6] },
      Bridge_Wall: { file: "Assets/StoryModeSets/Bridge_Wall/Bridge_Wall.m3", channels: [] },
      Old_Holo: { file: "Assets/Old_Holo.m3", channels: [0, 1, 2] },
    });
  });
});

describe("displayChannels", () => {
  it("gives a recorded model's channels, and undefined for a model nobody recorded", async () => {
    const catalog = { Bridge_Screen: { file: "x.m3", channels: [6] }, Bridge_Wall: { file: "y.m3", channels: [] } };
    expect(displayChannels(catalog, "Bridge_Screen")).toEqual([6]);
    expect(displayChannels(catalog, "Bridge_Wall")).toEqual([]);
    expect(displayChannels(catalog, "Unknown")).toBeUndefined();
  });

  it("has the screens the research found in core's catalog", async () => {
    const catalog = await bundledDisplayChannels();
    expect(displayChannels(catalog, "SMX3_Nova_Ship_Bridge_MainScreen")).toEqual([6]);
    expect(displayChannels(catalog, "SMHyperionBridgeBriefingCenter")).toEqual([0, 1, 2]);
    expect(displayChannels(catalog, "SMX2_Bridge_Communicator")).toEqual([0]);
    expect(displayChannels(catalog, "SMX3_Cutscene_MP01_040_Room11")).toEqual([6]);
    expect(displayChannels(catalog, "SMHyperionBridgeStage1Set")).toEqual([]);
  });
});

describe("setCatalogModelIds", () => {
  it("lists the set catalogue's models by CModel id, once each and sorted, leaving out pieces named by file alone", () => {
    const ids = setCatalogModelIds();
    expect(ids).toContain("SMX3_Cutscene_MP01_040_Room11");
    expect(ids).toContain("SMX2_KorhalArrival_SkyShieldScreen");
    expect(ids).toEqual([...new Set(ids)].sort());
    expect(ids.some((id) => /\.m3$/i.test(id))).toBe(false);
    // Named by file in one set and as a CModel in another.
    expect(ids).toContain("SMX3_Cutscene_MP01_010_Camera");
  });
});
