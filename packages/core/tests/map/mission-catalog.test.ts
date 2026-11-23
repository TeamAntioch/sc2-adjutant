// A Mission's catalog (src/map/mission-catalog.ts): its Workspace's, with the Kept game data of its
// own Map Package laid over it as the game loads a map's data after its mods. The Lantern fixture's
// Campaign Mod defines LanternCoast; its Mission, compiled in place, then gets data of its own in
// a catalog file no compile writes (LightData.xml).
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { blueprintCatalog } from "../../src/catalog/catalog-layer.js";
import { getTilesetLight } from "../../src/catalog/tileset-lights.js";
import { getTilesetTextures } from "../../src/catalog/tileset-textures.js";
import { parseCompileRecord } from "../../src/domain/compile-record.js";
import { freezeMissionSetPiece } from "../../src/dressing/mission-dressing-edits.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { missionCatalogFor, missionWorkspace } from "../../src/map/mission-catalog.js";
import { saveCompileRecord } from "../../src/map/mission-package.js";
import { checkWorkspace, isError } from "../../src/plugins/check-workspace.js";
import { loadWorkspace, parseMissionBlueprint } from "../../src/plugins/workspace.js";
import { syncMission } from "../../src/sync/sync-mission.js";
import { cleanupLantern, lanternWorkspace, useLantern } from "../mods/lantern-fixture.js";

const savedAt = new Date("2026-01-01T00:00:00Z");

afterEach(cleanupLantern);

/** The map's own data: LanternCoast given only another Light, and LanternCove, a tileset of its own on it. */
const OWN = `<?xml version="1.0" encoding="utf-8"?>
<Catalog>
    <CTerrain id="LanternCoast">
        <Lighting value="CastanarEx2"/>
    </CTerrain>
    <CTerrain id="LanternCove" parent="LanternCoast"/>
</Catalog>
`;

/** The Lantern Mission compiled in place, then given OWN in its package's LightData.xml. */
async function ownData(data = OWN) {
  const { root, blueprintPath } = await lanternWorkspace();
  await useLantern(blueprintPath, "LanternCoast");
  const { outputDir } = await compileMission(await loadWorkspace(root), blueprintPath, undefined, { savedAt });
  const file = path.join(outputDir, "Base.SC2Data", "GameData", "LightData.xml");
  await writeFile(file, data);
  return { root, blueprintPath, outputDir, file };
}

describe("a Mission's own Kept game data", () => {
  it("is merged over the Campaign Mod's field by field: an entry setting one field keeps the mod's others", async () => {
    const { root, blueprintPath } = await ownData();
    const workspace = await loadWorkspace(root);
    const catalog = blueprintCatalog(await parseMissionBlueprint(workspace, blueprintPath));

    expect(getTilesetLight(catalog, "LanternCoast")).toBe("CastanarEx2");
    expect(getTilesetTextures(catalog, "LanternCoast")[0]).toBe("LanternShingle");
    // The Workspace's own catalog is left as it was.
    expect(getTilesetLight(workspace.catalog, "LanternCoast")).toBe("LanternDusk");
  }, 60_000);

  it("is the Mission's when it syncs, freezes a set piece and is checked", async () => {
    const { root, blueprintPath, outputDir } = await ownData();
    await useLantern(blueprintPath, "LanternCove");
    const workspace = await loadWorkspace(root);

    expect((await syncMission(workspace, blueprintPath, outputDir)).changes).toEqual([]);
    await expect(freezeMissionSetPiece(workspace, blueprintPath, "nope")).rejects.toThrow(/^No set piece nope$/);
    expect((await missionWorkspace(workspace, blueprintPath)).catalog.tilesets.has("LanternCove")).toBe(true);
    expect((await checkWorkspace(root)).problems.filter(isError)).toEqual([]);
  }, 60_000);

  it("leaves out an entry the compile record says a compile wrote into a Kept file", async () => {
    const { root, blueprintPath } = await ownData();
    await useLantern(blueprintPath, "LanternCove");
    const record = parseCompileRecord(await readFile(path.join(path.dirname(blueprintPath), "compile-record.json"), "utf8"));
    await saveCompileRecord(blueprintPath, {
      ...record,
      entries: [...record.entries, { kind: "catalog-entry", file: "Base.SC2Data/GameData/LightData.xml", id: "LanternCove", fingerprint: "0000000000000000" }],
    });

    await expect(parseMissionBlueprint(await loadWorkspace(root), blueprintPath)).rejects.toThrow(/Unknown tileset LanternCove/);
  }, 60_000);

  it("is read once while its files are unchanged, and again when one changes", async () => {
    const { root, blueprintPath, file } = await ownData();
    const { catalog: base } = await loadWorkspace(root);

    const first = await missionCatalogFor(base, blueprintPath);
    expect(await missionCatalogFor(base, blueprintPath)).toBe(first);
    await writeFile(file, OWN.replace("CastanarEx2", "CastanarEx2Dawn"));
    const changed = await missionCatalogFor(base, blueprintPath);
    expect(changed).not.toBe(first);
    expect(getTilesetLight(changed, "LanternCoast")).toBe("CastanarEx2Dawn");
  }, 60_000);

  it("is the Workspace's catalog alone when which of its data is Kept can't be told, and the check says why", async () => {
    const { root, blueprintPath, outputDir } = await ownData();
    const { catalog: base } = await loadWorkspace(root);
    const recordFile = path.join(path.dirname(blueprintPath), "compile-record.json");

    await writeFile(recordFile, "not a record");
    expect(await missionCatalogFor(base, blueprintPath)).toBe(base);
    // The Blueprint still reads, on the mod's tileset; the check reports the record against the package.
    await expect(parseMissionBlueprint(await loadWorkspace(root), blueprintPath)).resolves.toBeDefined();
    expect((await checkWorkspace(root)).problems.filter(isError)).toContainEqual(expect.objectContaining({ file: "missions/ashen-crossing/Ashen-Crossing.SC2Map" }));

    await writeFile(recordFile, "{}");
    await cp(outputDir, path.join(path.dirname(outputDir), "Copy.SC2Map"), { recursive: true });
    expect(await missionCatalogFor(base, blueprintPath)).toBe(base);
  }, 60_000);

  it("leaves data that doesn't parse out, the Workspace's catalog standing", async () => {
    const { root, blueprintPath } = await ownData("<Catalog><CTerrain id=");
    const { catalog: base } = await loadWorkspace(root);
    expect(await missionCatalogFor(base, blueprintPath)).toBe(base);
  }, 60_000);
});
