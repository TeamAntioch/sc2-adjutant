// index-mod-doodads (#561, ADR-0017): renders a Campaign Mod's doodads through the Host Adapter with
// the Workspace's packages, builds their sheets in the folder their model's source decides, and
// writes their entries, pending until described; through the studio fixture Host Adapter.
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { indexModDoodads } from "../../src/catalog/index-mod-doodads.js";
import { MOD_DOODAD_INDEX_FILE, type ModDoodadIndex } from "../../src/catalog/mod-doodad-index.js";
import { loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { m3 } from "../fixtures/m3.js";
import { cleanupLantern, lanternWorkspace } from "../mods/lantern-fixture.js";
import { put } from "../mods/mod-fixture.js";

afterEach(cleanupLantern);

const STAND = [{ name: "Stand", start: 0, end: 1000, speed: 0, flags: 0 }];
const ACTORS = `<?xml version="1.0" encoding="us-ascii"?>
<Catalog>
    <CActorDoodad id="LanternFan"><Model value="LanternFan"/><EditorCategories value="DoodadType:Environment"/></CActorDoodad>
    <CActorDoodad id="LanternGate"><Model value="GateControl"/></CActorDoodad>
    <CActorDoodad id="LanternBlocker"><Model value="Invisible"/></CActorDoodad>
    <CActorDoodad id="LanternCrate"><Model value="LanternCrate"/></CActorDoodad>
</Catalog>
`;
const MODELS = `<?xml version="1.0" encoding="us-ascii"?>
<Catalog>
    <CModel id="LanternFan" parent="Doodad"><Model value="Assets\\Doodads(Custom)\\Fan\\Fan.m3"/></CModel>
    <CModel id="LanternCrate" parent="Doodad"><Model value="Assets\\Doodads(Custom)\\Crate\\Crate.m3"/></CModel>
</Catalog>
`;
const DESCRIPTION = { look: "a squat industrial fan", kind: "built", size: "medium", role: "prop", story: ["industry"], biome: ["any"], uses: [{ use: "wall vent" }] } as const;

/** The Lantern Workspace whose Campaign Mod has a fan and a crate of its own (the crate garbled), a game gate and an invisible blocker, on a studio machine with the gate's game model. */
async function setup() {
  const { root } = await lanternWorkspace();
  const modDir = path.join(root, "mods", "lantern-story");
  const pkg = path.join(modDir, "Lantern-Story.SC2Mod");
  await put(path.join(pkg, "Base.SC2Data", "GameData", "ActorData.xml"), ACTORS);
  await put(path.join(pkg, "Base.SC2Data", "GameData", "ModelData.xml"), MODELS);
  await put(path.join(pkg, "enUS.SC2Data", "LocalizedData", "ObjectStrings.txt"), "﻿Actor/Name/LanternFan=(Lantern) Fan\r\n");
  const fanFile = path.join(pkg, "Base.SC2Assets", "Assets", "Doodads(Custom)", "Fan", "Fan.m3");
  await put(fanFile, m3(STAND, { bounds: { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 1.25] } }));
  await put(path.join(pkg, "Base.SC2Assets", "Assets", "Doodads(Custom)", "Crate", "Crate.m3"), "garbled");
  const cacheDir = path.join(root, "..", `${path.basename(root)}-cache`);
  await mkdir(path.join(cacheDir, "game", "Assets", "Doodads", "GateControl"), { recursive: true });
  await writeFile(path.join(cacheDir, "game", "Assets", "Doodads", "GateControl", "GateControl.m3"), "m3");
  const machine = path.join(cacheDir, "machine.json");
  await writeFile(machine, JSON.stringify({ hostAdapter: fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url)), cacheDir }));
  const host = await loadHost(await loadMachineConfig({ file: machine, env: {} }));
  const sheets: string[] = [];
  const buildSheet = async (sources: readonly string[], output: string) => {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, sources.map((source) => path.basename(source)).join("\n"));
    sheets.push(path.relative(modDir, output).split(path.sep).join("/"));
  };
  const run = async (options: { ids?: string[]; force?: boolean } = {}) => indexModDoodads(await loadWorkspace(root), host, { ...options, buildSheet, workers: 1 });
  const index = async () => JSON.parse(await readFile(path.join(modDir, MOD_DOODAD_INDEX_FILE), "utf8")) as ModDoodadIndex;
  const log = async () => (await readFile(path.join(cacheDir, "host.log"), "utf8")).trim().split("\n");
  return { root, modDir, pkg, fanFile, run, index, sheets, log };
}

describe("indexModDoodads", () => {
  it("renders each doodad, sheets it by where its model came from, and writes pending entries", async () => {
    const { modDir, run, index, sheets } = await setup();
    const result = await run();
    expect(result).toMatchObject({ rendered: ["LanternFan", "LanternGate"], unpictured: ["LanternBlocker"], dropped: [], pending: ["LanternBlocker", "LanternCrate", "LanternFan", "LanternGate"] });
    expect(result.failed).toEqual([{ id: "LanternCrate", error: "garbled frames of Assets/Doodads(Custom)/Crate/Crate.m3" }]);
    expect(sheets.sort()).toEqual(["catalog-sheets/doodads/LanternFan.jpg", "catalog-sheets/game-models/LanternGate.jpg"]);

    const entries = await index();
    expect(entries.LanternFan).toEqual({
      name: "(Lantern) Fan",
      categories: "DoodadType:Environment",
      model: "Assets/Doodads(Custom)/Fan/Fan.m3",
      modelHash: expect.stringMatching(/^pkg:\d+:[0-9a-f]{40}$/),
      bounds: [1, 1, 1.25],
      sheet: "catalog-sheets/doodads/LanternFan.jpg",
    });
    expect(entries.LanternGate).toMatchObject({ model: "Assets/Doodads/GateControl/GateControl.m3", modelHash: "game:assets/doodads/gatecontrol/gatecontrol.m3", sheet: "catalog-sheets/game-models/LanternGate.jpg" });
    expect(entries.LanternBlocker).toEqual({ model: "Assets/Doodads/Invisible/Invisible.m3", modelHash: "game:assets/doodads/invisible/invisible.m3", unpictured: "no model file to draw: Assets/Doodads/Invisible/Invisible_00.m3" });
    expect(entries.LanternCrate).toMatchObject({ renderError: "garbled frames of Assets/Doodads(Custom)/Crate/Crate.m3" });
    expect(entries.LanternCrate?.sheet).toBeUndefined();

    for (const dir of ["thumbnails", "catalog-sheets/game-models"]) expect(await readFile(path.join(modDir, dir, ".gitignore"), "utf8")).toMatch(/^\*$/m);
    expect(existsSync(path.join(modDir, "catalog-sheets", "doodads", ".gitignore"))).toBe(false);
  });

  it("leaves what is current, tries a failure again, never retries an unpictured doodad, and re-renders a changed model", async () => {
    const { fanFile, run, index, log } = await setup();
    await run();
    const rendersBefore = (await log()).length;
    const second = await run();
    expect(second).toMatchObject({ rendered: [], unpictured: [], failed: [{ id: "LanternCrate" }] });
    expect((await log()).slice(rendersBefore).filter((line) => line.startsWith("render "))).toEqual(["render Assets/Doodads(Custom)/Crate/Crate.m3 4x512 from 1 packages", "render Assets/Doodads(Custom)/Crate/Crate_00.m3 4x512 from 1 packages"]);

    const entries = await index();
    await writeFile(
      path.join(path.dirname(fanFile), "..", "..", "..", "..", "..", MOD_DOODAD_INDEX_FILE),
      JSON.stringify({ ...entries, LanternFan: { ...entries.LanternFan, described: "agent", description: DESCRIPTION }, LanternGate: { ...entries.LanternGate, described: "author", description: DESCRIPTION } }),
    );
    expect((await run({ ids: ["LanternFan"] })).rendered).toEqual([]);
    expect((await index()).LanternFan).toMatchObject({ described: "agent", description: DESCRIPTION });

    // A changed model is told by its file's size: an edit that keeps the size goes unnoticed.
    const before = await readFile(fanFile);
    await writeFile(fanFile, m3(STAND, { bounds: { min: [-1, -1, 0], max: [1, 1, 3] } }));
    expect((await run({ ids: ["LanternFan"] })).rendered).toEqual([]);
    expect((await index()).LanternFan).toMatchObject({ bounds: [1, 1, 1.25], described: "agent" });

    await writeFile(fanFile, m3(STAND, { bounds: { min: [-1, -1, 0], max: [1, 1, 3] }, materials: [{ blendMode: 0 }] }));
    expect((await readFile(fanFile)).length).not.toBe(before.length);
    const changed = await run({ ids: ["LanternFan", "LanternGate"] });
    expect(changed.rendered).toEqual(["LanternFan"]);
    const after = await index();
    expect(after.LanternFan).toMatchObject({ bounds: [2, 2, 3], description: DESCRIPTION });
    expect(after.LanternFan?.described).toBeUndefined();
    expect(after.LanternGate).toMatchObject({ described: "author", description: DESCRIPTION });
    expect(changed.pending).toContain("LanternFan");
    expect(changed.pending).not.toContain("LanternGate");
  });

  it("drops entries for doodads the mod no longer has, with their sheets", async () => {
    const { modDir, pkg, run, index } = await setup();
    await run();
    await writeFile(path.join(pkg, "Base.SC2Data", "GameData", "ActorData.xml"), ACTORS.replace(/ *<CActorDoodad id="LanternFan">.*\n/, ""));
    const result = await run();
    expect(result.dropped).toEqual(["LanternFan"]);
    expect((await index()).LanternFan).toBeUndefined();
    expect(existsSync(path.join(modDir, "catalog-sheets", "doodads", "LanternFan.jpg"))).toBe(false);
  });

  it("counts a package model the renderer can't open as a failure to retry, not as nothing to draw", async () => {
    const { pkg, run, index } = await setup();
    await writeFile(path.join(pkg, "Base.SC2Data", "GameData", "ModelData.xml"), MODELS.replace("Crate\\Crate.m3", "Crate\\Lost.m3"));
    await put(path.join(pkg, "Base.SC2Assets", "Assets", "Doodads(Custom)", "Crate", "Lost.m3"), "unopenable");
    const result = await run({ ids: ["LanternCrate"] });
    expect(result.unpictured).toEqual([]);
    expect(result.failed.map(({ id }) => id)).toEqual(["LanternCrate"]);
    expect((await index()).LanternCrate?.unpictured).toBeUndefined();
  });

  it("pictures a package model whose variations are numbered files from its first, and leaves it alone next time", async () => {
    const { pkg, fanFile, run, index } = await setup();
    await writeFile(path.join(pkg, "Base.SC2Data", "GameData", "ModelData.xml"), MODELS.replace('<Model value="Assets\\Doodads(Custom)\\Fan\\Fan.m3"/>', '<Model value="Assets\\Doodads(Custom)\\Fan\\Fan.m3"/><VariationCount value="3"/>'));
    await put(path.join(path.dirname(fanFile), "Fan_00.m3"), await readFile(fanFile));
    await rm(fanFile);
    expect((await run({ ids: ["LanternFan"] })).rendered).toEqual(["LanternFan"]);
    expect((await index()).LanternFan).toMatchObject({ modelHash: expect.stringMatching(/^pkg:/), bounds: [1, 1, 1.25], sheet: "catalog-sheets/doodads/LanternFan.jpg" });
    expect((await run({ ids: ["LanternFan"] })).rendered).toEqual([]);
  });

  it("refuses an id the index doesn't cover", async () => {
    const { run } = await setup();
    await expect(run({ ids: ["AcidFalls"] })).rejects.toThrow(/doesn't cover AcidFalls/);
  });
});
