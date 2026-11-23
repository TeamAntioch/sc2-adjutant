// Import (ADR-0010): a Map Package built outside the Workspace becomes a Mission, everything in it
// Kept Content. The source is a synthetic package: the Ashen Crossing fixture compiled elsewhere,
// then given what the Editor leaves in a fresh map (its default name) and a conversation.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { parseCompileRecord } from "../../src/domain/compile-record.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { EDITOR_DEFAULT_MAP_NAME, importMap } from "../../src/map/import-map.js";
import { saveCompileRecord } from "../../src/map/mission-package.js";
import { checkMissionLayout } from "../../src/layout/check-mission.js";
import { buildLayoutModel } from "../../src/layout/layout-model.js";
import { blueprintCatalog } from "../../src/catalog/catalog-layer.js";
import { missionLight } from "../../src/catalog/tileset-lights.js";
import { parseMissionBlueprint } from "../../src/plugins/workspace.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace, validateMissionBlueprint } from "../../src/plugins/workspace.js";
import { readMissionScript } from "../../src/script/name-script.js";
import { syncMission } from "../../src/sync/sync-mission.js";
import { connect, text } from "../mcp/harness.js";
import { withFog } from "../support/map-info-fog.js";
import { readMapInfo } from "../../src/map/read-map-info.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");
/** The byte-order mark the Editor starts its strings files with. */
const BOM = String.fromCharCode(0xfeff);

/** A Campaign Pack whose Screenplay Source knows the conversation Harbour01 as `act-7`. */
const HARBOUR_PACK = `
const screenplay = "# The Harbour\\n\\n- Chapter: 1\\n\\n## Scene 1: THE QUAY\\n\\n**RAYNOR**: Tie her up.\\n";
export default {
  screenplaySource: {
    name: "notes",
    fetch: async ({ ref }) => {
      if (ref !== "act-7") throw new Error("no Screenplay " + ref);
      return screenplay;
    },
    refForConversation: async (conversationId) => (conversationId === "Harbour01" ? "act-7" : conversationId === "Harbour02" ? "act-8" : undefined),
  },
  naming: { name: "chapters", conversationId: ({ fields }) => "Harbour" + fields.Chapter.padStart(2, "0") },
};
`;

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** A Workspace (with the Harbour pack when `pack`) and, outside it, an Editor-made package. */
async function setup({ pack = false } = {}) {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-import-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const source = path.join(root, "elsewhere", "Harbour.SC2Map");
  // Built from the crossing fixture, then the fixture is gone: the Workspace starts with the import only.
  await compileMission(await loadWorkspace(workspaceRoot), path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json"), source, { savedAt });
  await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
  const strings = path.join(source, "enUS.SC2Data", "LocalizedData", "GameStrings.txt");
  const text = (await readFile(strings, "utf8")).replace(/^DocInfo\/Name=.*$/m, `DocInfo/Name=${EDITOR_DEFAULT_MAP_NAME}`);
  await writeFile(strings, text.startsWith(BOM) ? text : BOM + text);
  await writeFile(path.join(source, "Base.SC2Data", "GameData", "ConversationData.xml"), `<?xml version="1.0" encoding="utf-8"?>\r\n<Catalog>\r\n    <CConversation id="Harbour01"/>\r\n</Catalog>\r\n`);
  if (pack) {
    await mkdir(path.join(workspaceRoot, "pack"));
    await writeFile(path.join(workspaceRoot, "pack", "index.mjs"), HARBOUR_PACK);
    await writeFile(
      path.join(workspaceRoot, "pack", "sc2-adjutant-plugin.json"),
      JSON.stringify({
        name: "harbour-pack",
        version: "0.1.0",
        pluginApi: 2,
        roles: ["campaign-pack"],
        contributions: { naming: ["chapters"], screenplaySource: ["notes"] },
        entry: "./index.mjs",
      }),
    );
    const config = path.join(workspaceRoot, "sc2-adjutant.workspace.json");
    await writeFile(config, JSON.stringify({ ...JSON.parse(await readFile(config, "utf8")), campaignPack: "./pack" }));
  }
  return { workspaceRoot, source, missionDir: path.join(workspaceRoot, "missions", "harbour") };
}

/**
 * Gives the package a tileset of its own: its MapInfo and terrain name HarbourDk1 (as long as the
 * MonlythEx1 they named, so MapInfo's layout holds) and, unless `define` is false, its
 * TerrainData.xml defines it, as an Editor-made map with a custom CTerrain does.
 */
async function ownTileset(source: string, { define = true } = {}): Promise<void> {
  const mapInfo = path.join(source, "MapInfo");
  const bytes = await readFile(mapInfo);
  const at = bytes.indexOf("MonlythEx1\0");
  expect(at).toBeGreaterThan(0);
  bytes.write("HarbourDk1", at, "latin1");
  await writeFile(mapInfo, bytes);
  const terrain = path.join(source, "t3Terrain.xml");
  await writeFile(terrain, (await readFile(terrain, "utf8")).replaceAll('"MonlythEx1"', '"HarbourDk1"'));
  if (!define) return;
  const data = path.join(source, "Base.SC2Data", "GameData", "TerrainData.xml");
  const own = `    <CTerrain id="HarbourDk1">\r\n        <Lighting value="CastanarEx2"/>\r\n        <BlendTextures value="MeinhoffCraters"/>\r\n        <CliffSets value="KorhalPlatformCliff0"/>\r\n    </CTerrain>\r\n`;
  await writeFile(data, (await readFile(data, "utf8")).replace("</Catalog>", `${own}</Catalog>`));
}

// The Source has cliffs and, made by our compile, no static shadow bake: the check's one warning (#250).
const NO_BAKE = {
  mission: "harbour",
  file: "missions/harbour/Harbour.SC2Map/t3VertCol",
  message: "Static shadows need a rebake: Data > Generate Static Shadows (Cmd-Shift-L) in the Editor: Harbour.SC2Map has cliffs and no bake in t3VertCol",
  severity: "warning",
};

async function hashTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full)] = createHash("sha256").update(await readFile(full)).digest("hex");
  }
  return out;
}

describe("importMap", () => {
  it("copies the package in byte for byte, the source untouched, apart from the Editor's default name", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    const before = await hashTree(source);

    const result = await importMap(await loadWorkspace(workspaceRoot), source, "harbour", { title: "The Harbour" });

    expect(await hashTree(source)).toEqual(before);
    const copy = path.join(missionDir, "Harbour.SC2Map");
    expect(result.mapPackage).toBe(copy);
    const copied = await hashTree(copy);
    const strings = path.join("enUS.SC2Data", "LocalizedData", "GameStrings.txt");
    expect({ ...copied, [strings]: "" }).toEqual({ ...before, [strings]: "" });
    const text = await readFile(path.join(copy, strings), "utf8");
    expect(text.startsWith(BOM)).toBe(true);
    expect(text).toContain("DocInfo/Name=The Harbour\r\n");
    expect(text).not.toContain(EDITOR_DEFAULT_MAP_NAME);
    expect(text.replace("DocInfo/Name=The Harbour", "")).toBe((await readFile(path.join(source, strings), "utf8")).replace(`DocInfo/Name=${EDITOR_DEFAULT_MAP_NAME}`, ""));
  }, 30_000);

  it("writes a minimal Blueprint read from the package, and an empty compile record", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    await importMap(await loadWorkspace(workspaceRoot), source, "harbour", { title: "The Harbour" });

    const blueprint = JSON.parse(await readFile(path.join(missionDir, "blueprint.json"), "utf8"));
    expect(blueprint).toEqual({
      id: "harbour",
      campaignId: "fixtures",
      title: "The Harbour",
      setting: "Imported from Harbour.SC2Map",
      mapSize: { width: 128, height: 128 },
      tilesetId: "MonlythEx1",
      dependencies: expect.any(Array),
      screenplay: { title: "The Harbour" },
    });
    expect(blueprint.dependencies.length).toBeGreaterThan(0);
    expect(parseCompileRecord(await readFile(path.join(missionDir, "compile-record.json"), "utf8"))).toEqual({ version: 1, entries: [] });
  }, 30_000);

  it("reads the package's Unexplored Areas into the Blueprint, leaving out the default Black Mask", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    const mapInfo = path.join(source, "MapInfo");
    await writeFile(mapInfo, withFog(await readFile(mapInfo), "BlackNoUnhide"));

    const result = await importMap(await loadWorkspace(workspaceRoot), source, "harbour", { title: "The Harbour" });

    expect(JSON.parse(await readFile(path.join(missionDir, "blueprint.json"), "utf8")).unexploredAreas).toBe("black-reduced-radius");
    expect(result.notes.join("\n")).not.toMatch(/Unexplored Areas/);
  }, 30_000);

  it("warns at compile once the Kept package's Unexplored Areas no longer matches the imported Blueprint, as sync can't bring it back", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    const mapInfo = path.join(source, "MapInfo");
    await writeFile(mapInfo, withFog(await readFile(mapInfo), "BlackNoUnhide"));
    const workspace = await loadWorkspace(workspaceRoot);
    await importMap(workspace, source, "harbour", { title: "The Harbour" });
    const blueprintPath = path.join(missionDir, "blueprint.json");
    const mask = (warnings: readonly string[]) => warnings.filter((warning) => warning.includes("Unexplored Areas"));

    expect(mask((await compileMission(workspace, blueprintPath, undefined, { savedAt })).warnings)).toEqual([]);

    // The author sets Grey Mask in the Editor: the package keeps it, and the compile says how to match.
    const kept = path.join(missionDir, "Harbour.SC2Map", "MapInfo");
    await writeFile(kept, withFog(await readFile(kept), "Dark"));
    expect(mask((await compileMission(workspace, blueprintPath, undefined, { savedAt })).warnings)).toEqual([expect.stringMatching(/package keeps its own, Grey Mask: .*set unexploredAreas to "grey" to match the package$/)]);
    expect(readMapInfo(await readFile(kept)).fogType).toBe("Dark");
  }, 60_000);

  it("imports a package whose Unexplored Areas the Editor doesn't have without setting it, saying so", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    const mapInfo = path.join(source, "MapInfo");
    await writeFile(mapInfo, withFog(await readFile(mapInfo), "Murky"));

    const result = await importMap(await loadWorkspace(workspaceRoot), source, "harbour", { title: "The Harbour" });

    expect(JSON.parse(await readFile(path.join(missionDir, "blueprint.json"), "utf8"))).not.toHaveProperty("unexploredAreas");
    expect(result.notes).toContainEqual(expect.stringContaining(`Unexplored Areas is "Murky"`));
  }, 30_000);

  it("refers to the Screenplay the Screenplay Source knows the package's conversation by, under the package's conversation id, and pulls it", async () => {
    const { workspaceRoot, source, missionDir } = await setup({ pack: true });
    const workspace = await loadWorkspace(workspaceRoot);
    const result = await importMap(workspace, source, "harbour", { title: "The Harbour" });

    const blueprint = JSON.parse(await readFile(path.join(missionDir, "blueprint.json"), "utf8"));
    expect(blueprint.screenplay).toEqual({ title: "The Harbour", script: { source: "harbour.md", ref: "act-7", conversationId: "Harbour01" } });
    // Named for the package's conversation, not the one the naming template would give the Mission.
    const validated = validateMissionBlueprint(workspace, blueprint);
    if (!validated.success) throw new Error("invalid Blueprint");
    expect((await readMissionScript(validated.blueprint, path.join(missionDir, "blueprint.json"), workspace))?.script.conversationId).toBe("Harbour01");
    expect(await readFile(path.join(missionDir, "harbour.md"), "utf8")).toContain("Tie her up.");
    expect(result.notes).toContain("The conversation Harbour01 is act-7 in the Screenplay Source notes: pulled to harbour.md");
  }, 30_000);

  it("imports without a Screenplay reference, saying why, when the Source's Screenplay can't be pulled", async () => {
    const { workspaceRoot, source, missionDir } = await setup({ pack: true });
    await writeFile(path.join(source, "Base.SC2Data", "GameData", "ConversationData.xml"), `<Catalog>\r\n    <CConversation id="Harbour02"/>\r\n</Catalog>\r\n`);
    const result = await importMap(await loadWorkspace(workspaceRoot), source, "harbour", { title: "The Harbour" });

    expect(JSON.parse(await readFile(path.join(missionDir, "blueprint.json"), "utf8")).screenplay).toEqual({ title: "The Harbour" });
    expect((await readdir(missionDir)).sort()).toEqual(["Harbour.SC2Map", "blueprint.json", "compile-record.json"]);
    expect(result.notes).toContain(
      "The conversation Harbour02 is act-8 in the Screenplay Source notes, but it couldn't be pulled (The Screenplay Source notes couldn't fetch act-8: no Screenplay act-8), so the Blueprint has no screenplay.script yet: fix it at the Source, then add { \"source\": \"harbour.md\", \"ref\": \"act-8\", \"conversationId\": \"Harbour02\" } and pull",
    );
    expect((await checkWorkspace(workspaceRoot)).problems).toEqual([NO_BAKE]);
  }, 30_000);

  it("imports without a Screenplay reference, saying why, when the Source can't look the conversation up", async () => {
    const { workspaceRoot, source, missionDir } = await setup({ pack: true });
    const index = path.join(workspaceRoot, "pack", "index.mjs");
    await writeFile(index, (await readFile(index, "utf8")).replace(/refForConversation: async \(conversationId\) => \([^\n]*\n/, 'refForConversation: async () => { throw new Error("script: command not found"); },\n'));
    const result = await importMap(await loadWorkspace(workspaceRoot), source, "harbour", { title: "The Harbour" });

    expect(JSON.parse(await readFile(path.join(missionDir, "blueprint.json"), "utf8")).screenplay).toEqual({ title: "The Harbour" });
    expect(result.notes).toContain(
      "The Screenplay Source notes couldn't look up the conversation Harbour01 (script: command not found), so the Blueprint has no screenplay.script yet: add one by hand, or import again once the Source works",
    );
  }, 30_000);

  it("imports without a Screenplay reference, saying why, when the package's conversation has an id a Blueprint can't name", async () => {
    const { workspaceRoot, source, missionDir } = await setup({ pack: true });
    await writeFile(path.join(source, "Base.SC2Data", "GameData", "ConversationData.xml"), `<Catalog>\r\n    <CConversation id="Harbour..01"/>\r\n</Catalog>\r\n`);
    const index = path.join(workspaceRoot, "pack", "index.mjs");
    await writeFile(index, (await readFile(index, "utf8")).replace(/refForConversation: async \(conversationId\) => \([^\n]*\n/, 'refForConversation: async () => "act-7",\n'));
    const result = await importMap(await loadWorkspace(workspaceRoot), source, "harbour", { title: "The Harbour" });

    expect(JSON.parse(await readFile(path.join(missionDir, "blueprint.json"), "utf8")).screenplay).toEqual({ title: "The Harbour" });
    expect(result.notes).toContain("The conversation Harbour..01 has an id a Blueprint can't name (letters, digits, _, - and ., not ending in . and with no ..), so the Blueprint doesn't refer to its Screenplay");
  }, 30_000);

  it("adds a component the compile writes to a Kept ComponentList that lacks it, leaving the rest byte for byte", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    // An Editor map with no regions yet: no Regions file, and no regi component.
    await rm(path.join(source, "Regions"));
    await rm(path.join(source, "Regions.version"), { force: true });
    const list = path.join(source, "ComponentList.SC2Components");
    await writeFile(list, (await readFile(list, "utf8")).replace(/^.*"regi".*\n/m, "").replace(/\r?\n/g, "\r\n"));
    const workspace = await loadWorkspace(workspaceRoot);
    const { blueprintPath, mapPackage } = await importMap(workspace, source, "harbour", { title: "The Harbour" });
    const before = await readFile(path.join(mapPackage, "ComponentList.SC2Components"), "utf8");
    expect(before).not.toContain("regi");

    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, regions: [{ id: "quay", name: "Quay", shapes: [{ type: "rect", quad: [10, 10, 20, 20] }] }] }, null, 2));
    await compileMission(workspace, blueprintPath, undefined, { savedAt });

    expect(await readFile(path.join(mapPackage, "Regions"), "utf8")).toContain("Quay");
    const after = await readFile(path.join(mapPackage, "ComponentList.SC2Components"), "utf8");
    expect(after.replace(/^[ \t]*<DataComponent Type="regi">Regions<\/DataComponent>\r\n/m, "")).toBe(before);
    expect(after).toMatch(/\r\n[ \t]+<DataComponent Type="regi">Regions<\/DataComponent>\r\n<\/Components>/);
    // The ComponentList stays Kept Content: a second compile leaves it as it is.
    await compileMission(workspace, blueprintPath, undefined, { savedAt });
    expect(await readFile(path.join(mapPackage, "ComponentList.SC2Components"), "utf8")).toBe(after);
    const record = parseCompileRecord(await readFile(path.join(missionDir, "compile-record.json"), "utf8"));
    expect(record.entries.some((entry) => entry.kind === "file" && entry.path === "ComponentList.SC2Components")).toBe(false);
  }, 30_000);

  it("keeps the terrain and map info a compile once wrote when the Blueprint's Zones are removed", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-import-"));
    const workspaceRoot = path.join(root, "workspace");
    await cp(CROSSING, workspaceRoot, { recursive: true });
    const blueprintPath = path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json");
    const workspace = await loadWorkspace(workspaceRoot);
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
    const kept = ["MapInfo", "t3Terrain.xml", "t3HeightMap", "DocumentInfo", "DocumentHeader", "ComponentList.SC2Components"];
    const before = Object.fromEntries(await Promise.all(kept.map(async (file) => [file, await readFile(path.join(outputDir, file), "utf8")] as const)));

    const full = JSON.parse(await readFile(blueprintPath, "utf8"));
    const { id, campaignId, title, setting, mapSize, tilesetId } = full;
    await writeFile(blueprintPath, JSON.stringify({ id, campaignId, title, setting, mapSize, tilesetId, screenplay: { title: full.screenplay.title } }, null, 2));
    await compileMission(workspace, blueprintPath, undefined, { savedAt });

    for (const file of kept) expect(await readFile(path.join(outputDir, file), "utf8"), file).toBe(before[file]);
    const record = parseCompileRecord(await readFile(path.join(workspaceRoot, "missions", "ashen-crossing", "compile-record.json"), "utf8"));
    expect(record.entries.filter((entry) => entry.kind === "file" && kept.includes(entry.path))).toEqual([]);
  }, 30_000);

  it("builds a layout model for a Blueprint with no Zones and no Beats", async () => {
    const { workspaceRoot, source } = await setup();
    const workspace = await loadWorkspace(workspaceRoot);
    const { blueprintPath } = await importMap(workspace, source, "harbour", { title: "The Harbour" });

    const model = buildLayoutModel(await parseMissionBlueprint(workspace, blueprintPath));
    expect(model.threats()).toEqual([]);
  }, 30_000);

  it("leaves the package's own name when the author gave it one, and takes the title from it", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    const strings = path.join(source, "enUS.SC2Data", "LocalizedData", "GameStrings.txt");
    await writeFile(strings, (await readFile(strings, "utf8")).replace(EDITOR_DEFAULT_MAP_NAME, "Harbour Lights"));

    await importMap(await loadWorkspace(workspaceRoot), source, "harbour");

    expect(JSON.parse(await readFile(path.join(missionDir, "blueprint.json"), "utf8")).title).toBe("Harbour Lights");
    expect(await readFile(path.join(missionDir, "Harbour.SC2Map", "enUS.SC2Data", "LocalizedData", "GameStrings.txt"), "utf8")).toBe(await readFile(strings, "utf8"));
  }, 30_000);

  it("refuses a Mission that is already there, and a folder that isn't a Map Package, writing nothing", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    const workspace = await loadWorkspace(workspaceRoot);
    await importMap(workspace, source, "harbour", { title: "The Harbour" });
    await expect(importMap(workspace, source, "harbour")).rejects.toThrow(/already/);
    await expect(importMap(workspace, path.join(root!, "elsewhere"), "quay")).rejects.toThrow(/isn't a Map Package/);
    await expect(importMap(workspace, source, "Not A Slug")).rejects.toThrow(/lowercase/);
    await expect(importMap(workspace, source, "quay", { title: "Two\nlines" })).rejects.toThrow("The title is one line of text");
    expect(await readdir(path.dirname(missionDir))).toEqual(["harbour"]);
  }, 30_000);

  it("a first compile after Import changes nothing, and the Mission passes the check", async () => {
    const { workspaceRoot, source, missionDir } = await setup({ pack: true });
    const workspace = await loadWorkspace(workspaceRoot);
    await importMap(workspace, source, "harbour", { title: "The Harbour" });
    const before = await hashTree(missionDir);

    const { outputDir, warnings } = await compileMission(workspace, path.join(missionDir, "blueprint.json"), undefined, { savedAt });

    expect(outputDir).toBe(path.join(missionDir, "Harbour.SC2Map"));
    expect(warnings).toContainEqual(expect.stringMatching(/^screenplay\.script isn't compiled: a Blueprint with no Zones keeps its Map Package's own conversation [\w-]+, so only inline screenplay\.scenes play from Compiled triggers\. Convert it to the Screenplay with convert-screenplay to compile the Screenplay over it$/));
    expect(await hashTree(missionDir)).toEqual(before);
    expect((await checkWorkspace(workspaceRoot)).problems).toEqual([NO_BAKE]);
    // Anywhere else there is no Kept terrain to compile beside.
    await expect(compileMission(workspace, path.join(missionDir, "blueprint.json"), path.join(workspaceRoot, "build", "Copy.SC2Map"), { savedAt })).rejects.toThrow(
      "compile the Mission in place, into its own package (no output folder)",
    );
  }, 30_000);

  it("skips the layout checks, saying why, while every terrain cell is Kept", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    const workspace = await loadWorkspace(workspaceRoot);
    await importMap(workspace, source, "harbour", { title: "The Harbour" });

    const { checks } = await checkMissionLayout(workspace, path.join(missionDir, "blueprint.json"));
    expect(checks.length).toBeGreaterThan(5);
    for (const check of checks) {
      expect(check.status).toBe("not-evaluated");
      expect(check.findings).toEqual(["The Blueprint has no Zones: every terrain cell is Kept Content, so there is no layout to check yet."]);
    }
  }, 30_000);

  it("won't sync the Editor's objects into the Blueprint as Anchors: they are Kept Content", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    const workspace = await loadWorkspace(workspaceRoot);
    const { blueprintPath, mapPackage } = await importMap(workspace, source, "harbour", { title: "The Harbour" });
    const before = await readFile(blueprintPath, "utf8");

    await expect(syncMission(workspace, blueprintPath, mapPackage)).rejects.toThrow(/has no Zones: everything in its Map Package is Kept Content/);
    expect(await readFile(path.join(missionDir, "blueprint.json"), "utf8")).toBe(before);
  }, 30_000);

  it("imports a package whose tileset its own game data defines, and validates and compiles the Mission against it", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    await ownTileset(source);
    const workspace = await loadWorkspace(workspaceRoot);
    const { blueprintPath } = await importMap(workspace, source, "harbour", { title: "The Harbour" });

    expect(JSON.parse(await readFile(blueprintPath, "utf8")).tilesetId).toBe("HarbourDk1");
    const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
    // Bound to the Mission's catalog, so the compile reads the map's own CTerrain: its Lighting, not a Light named for the tileset.
    expect(blueprintCatalog(blueprint).tilesets.has("HarbourDk1")).toBe(true);
    expect(missionLight(blueprintCatalog(blueprint), blueprint)).toBe("CastanarEx2");
    const before = await hashTree(missionDir);
    await compileMission(workspace, blueprintPath, undefined, { savedAt });
    expect(await hashTree(missionDir)).toEqual(before);
    expect((await checkWorkspace(workspaceRoot)).problems).toEqual([NO_BAKE]);
  }, 30_000);

  it("refuses a package whose tileset neither the game, the Campaign Mod nor its own game data defines, naming where it looked", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    await ownTileset(source, { define: false });

    await expect(importMap(await loadWorkspace(workspaceRoot), source, "harbour", { title: "The Harbour" })).rejects.toThrow(
      /tilesetId: Unknown tileset HarbourDk1 \(data\/texture-extracted\.json.* or the Map Package Harbour\.SC2Map\)/,
    );
    expect(existsSync(missionDir)).toBe(false);
  }, 30_000);

  it("doesn't read back a catalog file the compile record says a compile wrote", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    await ownTileset(source);
    const workspace = await loadWorkspace(workspaceRoot);
    const { blueprintPath } = await importMap(workspace, source, "harbour", { title: "The Harbour" });
    // As if a compile had written TerrainData.xml: it is Compiled Content, so the tileset it defines is no longer the map's own.
    await saveCompileRecord(blueprintPath, { version: 1, entries: [{ kind: "file", path: "Base.SC2Data/GameData/TerrainData.xml", fingerprint: "0000000000000000" }] });

    await expect(parseMissionBlueprint(workspace, blueprintPath)).rejects.toThrow(/Unknown tileset HarbourDk1/);
    expect((await checkWorkspace(workspaceRoot)).problems).toContainEqual(expect.objectContaining({ mission: "harbour", path: "tilesetId", message: expect.stringMatching(/^Unknown tileset HarbourDk1/) }));
  }, 30_000);

  it("reports a second Map Package beside an own-tileset package first, as the cause of its unknown tileset", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    await ownTileset(source);
    await importMap(await loadWorkspace(workspaceRoot), source, "harbour", { title: "The Harbour" });
    await cp(path.join(missionDir, "Harbour.SC2Map"), path.join(missionDir, "Stray.SC2Map"), { recursive: true });

    const errors = (await checkWorkspace(workspaceRoot)).problems.filter((problem) => problem.mission === "harbour" && problem.severity === undefined);
    expect(errors[0]).toEqual(expect.objectContaining({ file: "missions/harbour", message: expect.stringMatching(/holds 2 Map Packages/) }));
    expect(errors.slice(1)).toEqual([expect.objectContaining({ path: "tilesetId", message: expect.stringMatching(/^Unknown tileset HarbourDk1/) })]);
  }, 30_000);

  it("imports through the MCP server's import_map tool", async () => {
    const { workspaceRoot, source, missionDir } = await setup();
    const reply = await (await connect(workspaceRoot)).callTool({ name: "import_map", arguments: { source, mission: "harbour", title: "The Harbour" } });

    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({ blueprint: "missions/harbour/blueprint.json", mapPackage: "missions/harbour/Harbour.SC2Map" });
    expect(text(reply)).toContain(`Copied ${source} to ${path.join(missionDir, "Harbour.SC2Map")}`);
    expect(JSON.parse(await readFile(path.join(missionDir, "blueprint.json"), "utf8")).title).toBe("The Harbour");
  }, 30_000);
});
