// Model footprints (#266): recorded like model-anims, from each model's file in ModelData, which the
// Host Adapter's model.export pulls out of the game or a mod holds. Run through the `studio`
// fixture Host Adapter.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { recordModelFootprints } from "../../src/catalog/model-footprints.js";
import { bareHost, loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { m3 } from "../fixtures/m3.js";

const studio = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const DOODADS = `<Catalog>
    <CModel default="1" id="Doodad"><Model value="Assets\\Doodads\\##id##\\##id##.m3"/></CModel>
    <CModel id="Stone_Slab" parent="Doodad"><VariationCount value="2"/></CModel>
    <CModel id="Dust_Drift" parent="Doodad"/>
    <CModel id="Lost_Slab" parent="Doodad"/>
</Catalog>`;

async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-footprints-"));
  folders.push(folder);
  return folder;
}

describe("recordModelFootprints", () => {
  it("records each model's file, bounds and materials, keeping models recorded before", async () => {
    const folder = await tempFolder();
    const cacheDir = path.join(folder, "cache");
    const slab = path.join(cacheDir, "game", "Assets/Doodads/Stone_Slab/Stone_Slab_00.m3");
    await mkdir(path.dirname(slab), { recursive: true });
    await writeFile(slab, m3([], { bounds: { min: [-5, -6, -0.5], max: [5, 6, 0.5] }, materials: [{ blendMode: 0 }] }));
    const machine = path.join(folder, "machine.json");
    await writeFile(machine, JSON.stringify({ hostAdapter: studio, cacheDir }));
    const host = await loadHost(await loadMachineConfig({ file: machine, env: {} }));
    const catalogPath = path.join(folder, "model-footprints.json");
    await writeFile(catalogPath, JSON.stringify({ Old_Rock: { file: "Assets/Old_Rock.m3", min: [0, 0, 0], max: [1, 1, 1], materials: ["opaque"] } }));

    const result = await recordModelFootprints(host, ["Stone_Slab", "Lost_Slab", "Nobody"], { catalogPath, modelData: [DOODADS] });
    expect(result.recorded).toEqual(["Stone_Slab"]);
    expect(result.failed).toEqual([
      { id: "Lost_Slab", reason: expect.stringContaining("Lost_Slab") },
      { id: "Nobody", reason: "no ModelData entry" },
    ]);
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    expect(result.catalog).toEqual(catalog);
    expect(catalog).toEqual({
      Old_Rock: { file: "Assets/Old_Rock.m3", min: [0, 0, 0], max: [1, 1, 1], materials: ["opaque"] },
      Stone_Slab: { file: "Assets/Doodads/Stone_Slab/Stone_Slab_00.m3", min: [-5, -6, -0.5], max: [5, 6, 0.5], materials: ["opaque"] },
    });
  });

  it("only reads, writing nothing, with no catalog file; and reads a doodad's model by its doodad id, in the variation asked", async () => {
    const folder = await tempFolder();
    const cacheDir = path.join(folder, "cache");
    const game = (file: string) => path.join(cacheDir, "game", file);
    await mkdir(path.dirname(game("Assets/Doodads/Stone_Slab/Stone_Slab_01.m3")), { recursive: true });
    await writeFile(game("Assets/Doodads/Stone_Slab/Stone_Slab_00.m3"), m3([], { bounds: { min: [-5, -6, -0.5], max: [5, 6, 0.5] }, materials: [{ blendMode: 0 }] }));
    await writeFile(game("Assets/Doodads/Stone_Slab/Stone_Slab_01.m3"), m3([], { bounds: { min: [-1, -2, 0], max: [1, 2, 3] }, materials: [{ blendMode: 0 }] }));
    // A doodad whose model no CModel of its own names: data/doodad-models.json gives its file.
    await mkdir(path.dirname(game("Assets/Doodads/Shared/Plinth_02.m3")), { recursive: true });
    await writeFile(game("Assets/Doodads/Shared/Plinth_02.m3"), m3([], { bounds: { min: [0, 0, 0], max: [2, 4, 6] }, materials: [{ blendMode: 0 }] }));
    const machine = path.join(folder, "machine.json");
    await writeFile(machine, JSON.stringify({ hostAdapter: studio, cacheDir }));
    const host = await loadHost(await loadMachineConfig({ file: machine, env: {} }));
    const doodadModel = (id: string) => (id === "TemplePlinth" ? { model: "Assets/Doodads/Shared/Plinth.m3", variations: 3 } : undefined);

    const read = await recordModelFootprints(host, ["Stone_Slab", "TemplePlinth", "Nobody"], { modelData: [DOODADS], variation: 1, doodadModel });
    expect(read.failed).toEqual([
      { id: "TemplePlinth", reason: expect.stringContaining("Plinth_01") },
      { id: "Nobody", reason: "no ModelData entry, and no doodad of that id" },
    ]);
    expect(read.catalog).toEqual({ Stone_Slab: { file: "Assets/Doodads/Stone_Slab/Stone_Slab_01.m3", min: [-1, -2, 0], max: [1, 2, 3], materials: ["opaque"] } });
    expect((await readdir(folder)).sort()).toEqual(["cache", "machine.json"]);

    const plinth = await recordModelFootprints(host, ["TemplePlinth"], { modelData: [DOODADS], variation: 2, doodadModel });
    expect(plinth.catalog).toEqual({ TemplePlinth: { file: "Assets/Doodads/Shared/Plinth_02.m3", min: [0, 0, 0], max: [2, 4, 6], materials: ["opaque"] } });
    // A variation the model hasn't.
    const beyond = await recordModelFootprints(host, ["Stone_Slab"], { modelData: [DOODADS], variation: 2 });
    expect(beyond.failed).toEqual([{ id: "Stone_Slab", reason: "has 2 variations (00 to 01), not 02" }]);
  });

  it("reads a mod's own model from its assets folder, without the Host Adapter", async () => {
    const folder = await tempFolder();
    const assets = path.join(folder, "Base.SC2Assets");
    await mkdir(path.join(assets, "Assets/Doodads/Dust_Drift"), { recursive: true });
    await writeFile(path.join(assets, "Assets/Doodads/Dust_Drift/Dust_Drift.m3"), m3([], { bounds: { min: [-3, -3, 0], max: [3, 3, 1] }, materials: [{ blendMode: 1 }] }));
    const result = await recordModelFootprints(bareHost(), ["Dust_Drift"], { catalogPath: path.join(folder, "model-footprints.json"), modelData: [DOODADS], assetRoots: [assets] });
    expect(result.failed).toEqual([]);
    expect(result.catalog.Dust_Drift).toEqual({ file: "Assets/Doodads/Dust_Drift/Dust_Drift.m3", min: [-3, -3, 0], max: [3, 3, 1], materials: ["blend"] });
  });
});
