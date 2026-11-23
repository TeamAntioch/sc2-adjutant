// A Campaign Mod's doodad index (#560, ADR-0017): mods/<id>/doodad-catalog.json, read into the
// catalog layer, so every reader of core's doodad catalog sees the mod's doodads described too; and
// the Workspace check's warnings for what it lacks.
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getDoodadDescription, indexedModDoodads, MOD_DOODAD_INDEX_FILE, modDoodadIndexGaps, formatModDoodadIndex, modelChanged, modelHash, parseModDoodadIndex } from "../../src/catalog/mod-doodad-index.js";
import { addWorkspaceDoodadNote, formatAddedDoodadNote } from "../../src/catalog/workspace-doodad-notes.js";
import { formatDoodadSearch, searchWorkspaceDoodads } from "../../src/catalog/workspace-doodad-search.js";
import { campaignCatalogEntries } from "../../src/mods/campaign-catalog.js";
import { campaignModPackages } from "../../src/mods/workspace-mods.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { cleanupLantern, lanternWorkspace } from "../mods/lantern-fixture.js";
import { put } from "../mods/mod-fixture.js";

afterEach(cleanupLantern);

const FAN_MODEL = "Assets/Doodads(Custom)/Fan/Fan.m3";
const ACTORS = `<?xml version="1.0" encoding="us-ascii"?>
<Catalog>
    <CActorDoodad id="LanternFan"><Model value="LanternFan"/></CActorDoodad>
    <CActorDoodad id="LanternBlocker"><Model value="Invisible"/></CActorDoodad>
    <CActorDoodad id="AcidFalls"><Model value="LanternFalls"/></CActorDoodad>
    <CActorDoodad id="AcidSplash"><Footprint value="FootprintDoodad1x1"/></CActorDoodad>
</Catalog>
`;
const MODELS = `<?xml version="1.0" encoding="us-ascii"?>
<Catalog>
    <CModel id="LanternFan" parent="Doodad"><Model value="Assets\\Doodads(Custom)\\Fan\\Fan.m3"/></CModel>
    <CModel id="LanternFalls" parent="Doodad"><Model value="Assets\\Doodads(Custom)\\Falls\\Falls.m3"/></CModel>
</Catalog>
`;
const DESCRIPTION = { look: "a squat industrial fan in a square steel housing", kind: "built", size: "medium", role: "prop", story: ["industry"], biome: ["any"] } as const;

/** The Lantern Workspace with doodads in its Campaign Mod: two of its own, one game doodad on a new model, one game doodad left on the game's. */
async function lanternWithDoodads() {
  const { root } = await lanternWorkspace();
  const modDir = path.join(root, "mods", "lantern-story");
  const pkg = path.join(modDir, "Lantern-Story.SC2Mod");
  await put(path.join(pkg, "Base.SC2Data", "GameData", "ActorData.xml"), ACTORS);
  await put(path.join(pkg, "Base.SC2Data", "GameData", "ModelData.xml"), MODELS);
  await put(path.join(pkg, "Base.SC2Assets", ...FAN_MODEL.split("/")), "fan m3");
  const writeIndex = (index: unknown) => writeFile(path.join(modDir, MOD_DOODAD_INDEX_FILE), typeof index === "string" ? index : JSON.stringify(index));
  return { root, modDir, pkg, writeIndex };
}

describe("the mod doodad index", () => {
  it("covers the mod's own doodads, and a game doodad only when the mod changes its model", async () => {
    const { root } = await lanternWithDoodads();
    const workspace = await loadWorkspace(root);
    expect(workspace.catalog.doodads.get("LanternFan")?.model).toBe(FAN_MODEL);
    expect(indexedModDoodads(workspace.catalog)).toEqual(["AcidFalls", "LanternBlocker", "LanternFan"]);
  });

  it("is read into the catalog layer: descriptions for the dressing rules, entries with absolute sheets for asset_catalog", async () => {
    const { root, modDir, pkg, writeIndex } = await lanternWithDoodads();
    await mkdir(path.join(modDir, "catalog-sheets", "doodads"), { recursive: true });
    await writeFile(path.join(modDir, "catalog-sheets", "doodads", "LanternFan.jpg"), "jpg");
    await writeIndex({
      LanternFan: { model: FAN_MODEL, modelHash: modelHash([pkg], FAN_MODEL), sheet: "catalog-sheets/doodads/LanternFan.jpg", described: "agent", description: { ...DESCRIPTION, uses: ["vent fan in a wall"] } },
      LanternBlocker: { model: "Assets/Doodads/Invisible/Invisible.m3", modelHash: "game:assets/doodads/invisible/invisible.m3", unpictured: "no model to draw" },
      // Left from when the mod gave AcidSplash a model of its own: gone, so core's entry stands.
      AcidSplash: { model: "Assets/Doodads/Old/Old.m3", described: "agent", description: { ...DESCRIPTION, look: "an old override" } },
    });
    const workspace = await loadWorkspace(root);

    expect(getDoodadDescription(workspace.catalog, "LanternFan")).toMatchObject({ role: "prop", size: "medium" });
    expect(getDoodadDescription(workspace.catalog, "LanternBlocker")).toBeUndefined();
    expect(getDoodadDescription(workspace.catalog, "AcidSplash")).toEqual(getDoodadDescription({ ...workspace.catalog, doodadIndex: new Map() }, "AcidSplash"));
    expect(getDoodadDescription(workspace.catalog, "AcidSplash")).toBeDefined();
    expect(getDoodadDescription(workspace.catalog, "AcidSplash")?.look).not.toBe("an old override");

    const doodads = campaignCatalogEntries(workspace).doodads;
    expect(doodads.find((doodad) => doodad.id === "LanternFan")).toEqual({
      id: "LanternFan",
      variations: 1,
      model: FAN_MODEL,
      // A use written as a plain phrase reads as a record.
      indexed: { description: { ...DESCRIPTION, uses: [{ use: "vent fan in a wall" }] }, described: "agent", sheet: path.join(modDir, "catalog-sheets", "doodads", "LanternFan.jpg") },
    });
    expect(doodads.find((doodad) => doodad.id === "LanternBlocker")?.indexed).toEqual({ pending: true, unpictured: "no model to draw" });
    expect(doodads.find((doodad) => doodad.id === "AcidSplash")?.indexed).toBeUndefined();
  });

  it("refuses a file that isn't an index, naming the path of each problem", () => {
    expect(() => parseModDoodadIndex(`{"Fan": {"description": {"look": "x", "kind": "metal"}}}`, "mods/m/doodad-catalog.json")).toThrow(/^mods\/m\/doodad-catalog.json isn't a valid doodad index: .*Fan\.description\.kind/);
    expect(() => parseModDoodadIndex(`{`, "mods/m/doodad-catalog.json")).toThrow(/isn't JSON/);
  });

  it("writes ids sorted and each entry's fields in one order, however they were set", () => {
    const written = formatModDoodadIndex({
      Lamp: { described: "agent", description: { look: "lamp", kind: "built", size: "small", role: "prop", story: [], biome: [] }, sheet: "catalog-sheets/doodads/Lamp.jpg", model: "Assets/Doodads/Lamp/Lamp.m3" },
      Fan: { unpictured: "no model file to draw", model: "Assets/Doodads/Fan/Fan.m3" },
    });
    expect(Object.keys(JSON.parse(written))).toEqual(["Fan", "Lamp"]);
    expect(Object.keys(JSON.parse(written).Lamp)).toEqual(["model", "sheet", "description", "described"]);
  });

  it("is searched and noted in a Workspace: search_doodads matches its words, add_doodad_note writes into its entry", async () => {
    const { root, modDir, pkg, writeIndex } = await lanternWithDoodads();
    await mkdir(path.join(modDir, "catalog-sheets", "doodads"), { recursive: true });
    await writeFile(path.join(modDir, "catalog-sheets", "doodads", "LanternFan.jpg"), "jpg");
    await writeIndex({
      LanternFan: { name: "(Lantern) Fan", model: FAN_MODEL, modelHash: modelHash([pkg], FAN_MODEL), sheet: "catalog-sheets/doodads/LanternFan.jpg", described: "agent", description: DESCRIPTION },
    });
    let workspace = await loadWorkspace(root);

    const text = formatDoodadSearch(await searchWorkspaceDoodads(workspace, { words: ["industrial fan"], role: ["prop"] }));
    expect(text).toContain(`LanternFan "(Lantern) Fan" (Campaign Mod doodad, needs no dependency, 1 variation)\n  ${DESCRIPTION.look} [built/medium/prop/industry/any]`);
    // The same file, however the temporary folder is spelled (a Windows 8.3 short name, a macOS /private link).
    const sheet = /^  sheet (.*LanternFan\.jpg)$/m.exec(text)?.[1];
    expect(sheet && (await realpath(sheet))).toBe(await realpath(path.join(modDir, "catalog-sheets", "doodads", "LanternFan.jpg")));
    expect(formatDoodadSearch(await searchWorkspaceDoodads(workspace, { words: ["blocker"] }))).toContain("pending in the mod's doodad index: run index-mod-doodads, then describe it");

    const added = await addWorkspaceDoodadNote(workspace, { id: "LanternFan", use: "vent fan in a wall" });
    expect(added.file).toBe(`mods/lantern-story/${MOD_DOODAD_INDEX_FILE}`);
    expect(formatAddedDoodadNote(added)).toBe(`LanternFan: uses vent fan in a wall, look “${DESCRIPTION.look}” (in the Campaign Mod's doodad index, mods/lantern-story/${MOD_DOODAD_INDEX_FILE})`);
    expect(existsSync(path.join(root, "doodad-notes.json"))).toBe(false);
    workspace = await loadWorkspace(root);
    const vents = (await searchWorkspaceDoodads(workspace, { words: ["vent fan in a wall"], limit: 500 })).results.filter((result) => result.source === "mod");
    expect(vents.map(({ id, uses }) => [id, uses])).toEqual([["LanternFan", [{ use: "vent fan in a wall" }]]]);
  });

  it("knows what the index lacks: missing, pending, stale and gone entries", async () => {
    const { root, pkg, writeIndex } = await lanternWithDoodads();
    await writeIndex({
      LanternFan: { model: FAN_MODEL, modelHash: modelHash([pkg], FAN_MODEL), described: "author", description: DESCRIPTION },
      LanternBlocker: { model: "Assets/Doodads/Invisible/Invisible.m3", modelHash: "game:assets/doodads/invisible/invisible.m3", unpictured: "no model to draw" },
      AcidSplash: { model: "Assets/Doodads/AcidSplash/AcidSplash.m3", modelHash: "x", described: "agent", description: DESCRIPTION },
    });
    let workspace = await loadWorkspace(root);
    const packages = await campaignModPackages(workspace);
    expect(modDoodadIndexGaps(workspace.catalog, packages)).toEqual({ missing: ["AcidFalls"], pending: ["LanternBlocker"], stale: [], gone: ["AcidSplash"] });

    // The same size isn't read: an edit that keeps the file's size goes unnoticed (#558).
    await writeFile(path.join(pkg, "Base.SC2Assets", ...FAN_MODEL.split("/")), "fan M3");
    workspace = await loadWorkspace(root);
    expect(modDoodadIndexGaps(workspace.catalog, packages).stale).toEqual([]);

    await writeFile(path.join(pkg, "Base.SC2Assets", ...FAN_MODEL.split("/")), "a new fan m3");
    workspace = await loadWorkspace(root);
    expect(modDoodadIndexGaps(workspace.catalog, packages).stale).toEqual(["LanternFan"]);
  });

  it("records a package model by its size and bytes, and tells a changed one by its size alone", async () => {
    const { pkg } = await lanternWithDoodads();
    const recorded = modelHash([pkg], FAN_MODEL);
    expect(recorded).toMatch(/^pkg:6:[0-9a-f]{40}$/);
    expect(modelChanged([pkg], FAN_MODEL, 1, recorded)).toBe(false);
    expect(modelChanged([pkg], FAN_MODEL, 1, "pkg:7:0000")).toBe(true);
    expect(modelChanged([pkg], FAN_MODEL, 1, undefined)).toBe(true);
    expect(modelChanged([pkg], "Assets/Doodads/Rock/Rock.m3", 1, "game:assets/doodads/rock/rock.m3")).toBe(false);
    expect(modelChanged([pkg], "Assets/Doodads/Rock/Rock.m3", 1, "game:assets/doodads/stone/stone.m3")).toBe(true);
  });

  it("warns in the Workspace check about what the index lacks, and fails on a file that doesn't read", async () => {
    const { root, writeIndex } = await lanternWithDoodads();
    let check = await checkWorkspace(root);
    const index = check.problems.filter((problem) => problem.file === `mods/lantern-story/${MOD_DOODAD_INDEX_FILE}`);
    expect(index).toEqual([
      {
        mod: "lantern-story",
        file: `mods/lantern-story/${MOD_DOODAD_INDEX_FILE}`,
        message: "The doodad index lacks 3 doodads (AcidFalls, LanternBlocker, LanternFan) the Campaign Mod defines: run index-mod-doodads, then describe them",
        severity: "warning",
      },
    ]);

    await writeIndex("[]");
    check = await checkWorkspace(root);
    const broken = check.problems.filter((problem) => problem.file === `mods/lantern-story/${MOD_DOODAD_INDEX_FILE}`);
    expect(broken).toHaveLength(1);
    expect(broken[0]!.severity).toBeUndefined();
    expect(broken[0]!.message).toMatch(/isn't a valid doodad index/);
    expect(JSON.parse(await readFile(path.join(root, "sc2-adjutant.workspace.json"), "utf8")).campaignMod).toBe("Lantern-Story");
  });
});
