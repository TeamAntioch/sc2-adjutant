// Import a mod (ADR-0011): a mod built outside the Workspace becomes a Workspace mod in
// mods/<id>/, everything in it Kept Content. The sources are synthetic: a Campaign Mod with game
// data, triggers and a dependency on an Asset Mod, and an Asset Mod holding only files.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp as cpDir, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCompileRecord } from "../../src/domain/compile-record.js";
import { writeDocumentHeader } from "../../src/map/write-document-header.js";
import { compileMod } from "../../src/mods/compile-mod.js";
import { importMod } from "../../src/mods/import-mod.js";
import { campaignMod, readWorkspaceMod } from "../../src/mods/workspace-mods.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace, WORKSPACE_FILE } from "../../src/plugins/workspace.js";
import { connect, text } from "../mcp/harness.js";

const CAMPAIGN_DEPENDENCIES = [
  "bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod",
  "file:Mods\\Harbour-Art.SC2Mod",
];

/** A Campaign Pack naming its Campaign Mod Harbour-Story. */
const PACK_MANIFEST = { name: "harbour-pack", version: "0.1.0", pluginApi: 2, roles: ["campaign-pack"], contributions: { campaignMod: "Harbour-Story" } };

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function put(file: string, content: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

/** Bytes that aren't valid UTF-8, so a copy that went through text would change them. */
const binary = (seed: number, length = 4096) => Uint8Array.from({ length }, (_, index) => (index * 31 + seed * 7) % 256);

/** A Workspace (with the Harbour pack when `pack`) and, outside it, an Editor-made Campaign Mod and Asset Mod. */
async function setup({ pack = false } = {}) {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-import-mod-"));
  const workspaceRoot = path.join(root, "workspace");
  await put(
    path.join(workspaceRoot, WORKSPACE_FILE),
    `${JSON.stringify({ campaign: { id: "harbour", name: "The Harbour" }, missions: "missions", ...(pack ? { campaignPack: "./pack" } : {}), plugins: ["bundled:hazard"] }, null, 2)}\n`,
  );
  await mkdir(path.join(workspaceRoot, "missions"));
  if (pack) await put(path.join(workspaceRoot, "pack", "sc2-adjutant-plugin.json"), JSON.stringify(PACK_MANIFEST));

  const story = path.join(root, "elsewhere", "Harbour-Story.SC2Mod");
  await put(path.join(story, "DocumentHeader"), writeDocumentHeader({ dependencies: CAMPAIGN_DEPENDENCIES, documentId: 1, attributes: { "DocInfo/Name": "Harbour-Story" } }));
  await put(
    path.join(story, "DocumentInfo"),
    `<?xml version="1.0" encoding="utf-8"?>\r\n<DocInfo>\r\n    <Dependencies>\r\n${CAMPAIGN_DEPENDENCIES.map((value) => `        <Value>${value}</Value>\r\n`).join("")}    </Dependencies>\r\n</DocInfo>\r\n`,
  );
  await put(path.join(story, "Base.SC2Data", "GameData", "UnitData.xml"), `<?xml version="1.0" encoding="utf-8"?>\r\n<Catalog>\r\n    <CUnit id="Crane" parent="Marine"/>\r\n</Catalog>\r\n`);
  await put(path.join(story, "Base.SC2Data", "Cutscenes", "Quay - Dawn.SC2Cutscene"), "<Cutscene/>\r\n");
  await put(path.join(story, "Triggers"), `<?xml version="1.0" encoding="utf-8"?>\r\n<TriggerData/>\r\n`);
  await put(path.join(story, "enUS.SC2Data", "LocalizedData", "GameStrings.txt"), "﻿Unit/Name/Crane=Crane\r\n");
  await put(path.join(story, "PreloadAssetDB.txt"), "[Unit]\r\nid=Crane\r\n");

  const art = path.join(root, "elsewhere", "Harbour-Art.SC2Mod");
  await put(path.join(art, "DocumentHeader"), writeDocumentHeader({ documentId: 2, attributes: { "DocInfo/Name": "Harbour-Art" } }));
  await put(path.join(art, "DocumentInfo"), `<?xml version="1.0" encoding="utf-8"?>\n<DocInfo>\n    <ModType>\n        <Value>Interface</Value>\n    </ModType>\n</DocInfo>\n`);
  await put(path.join(art, "Base.SC2Assets", "Assets", "Models", "Crane", "Crane.m3"), binary(3));
  await put(path.join(art, "Base.SC2Assets", "Assets", "Textures", "crane_diffuse.dds"), binary(4));
  await put(path.join(art, "Base.SC2Assets", "Assets", "Sounds", "Quay", "Gulls.ogg"), binary(5));
  await put(path.join(art, "PreloadAssetDB.txt"), "");
  return { workspaceRoot, story, art };
}

async function hashTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full).split(path.sep).join("/")] = createHash("sha256").update(await readFile(full)).digest("hex");
  }
  return out;
}

const readJson = async (file: string) => JSON.parse(await readFile(file, "utf8"));

describe("importMod", () => {
  it("copies a Campaign Mod and an Asset Mod in byte for byte, the sources untouched", async () => {
    const { workspaceRoot, story, art } = await setup();
    const before = { story: await hashTree(story), art: await hashTree(art) };

    const imported = await importMod(await loadWorkspace(workspaceRoot), story, "harbour-story");
    await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art");

    expect({ story: await hashTree(story), art: await hashTree(art) }).toEqual(before);
    expect(imported.modPackage).toBe(path.join(workspaceRoot, "mods", "harbour-story", "Harbour-Story.SC2Mod"));
    expect(await hashTree(imported.modPackage)).toEqual(before.story);
    expect(await hashTree(path.join(workspaceRoot, "mods", "harbour-art", "Harbour-Art.SC2Mod"))).toEqual(before.art);
  });

  it("writes a minimal Mod Blueprint (id, kind, the dependencies DocumentInfo lists) and an empty compile record", async () => {
    const { workspaceRoot, story, art } = await setup();
    await importMod(await loadWorkspace(workspaceRoot), story, "harbour-story");
    await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art");

    expect(await readJson(path.join(workspaceRoot, "mods", "harbour-story", "blueprint.json"))).toEqual({ id: "harbour-story", kind: "campaign", dependencies: CAMPAIGN_DEPENDENCIES });
    expect(await readJson(path.join(workspaceRoot, "mods", "harbour-art", "blueprint.json"))).toEqual({ id: "harbour-art", kind: "asset", dependencies: [] });
    for (const id of ["harbour-story", "harbour-art"]) {
      expect(parseCompileRecord(await readFile(path.join(workspaceRoot, "mods", id, "compile-record.json"), "utf8"))).toEqual({ version: 1, entries: [] });
    }
  });

  it("reads an Asset Mod that keeps its art in Base.SC2Data/Assets as an Asset Mod", async () => {
    const { workspaceRoot, art } = await setup();
    await put(path.join(art, "Base.SC2Data", "Assets", "Textures", "quay_sign.DDS"), binary(6));
    await put(path.join(art, "Base.SC2Data", ".DS_Store"), binary(7, 64));
    const imported = await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art");
    expect((await readJson(imported.blueprintPath)).kind).toBe("asset");
  });

  it("reads an Asset Mod whose Triggers file holds no triggers as an Asset Mod, and one with triggers as a Campaign Mod", async () => {
    const { workspaceRoot, art } = await setup();
    await put(path.join(art, "Triggers"), `<?xml version="1.0" encoding="utf-8"?>\r\n<TriggerData>\r\n    <Library Id="Art">\r\n        <Root/>\r\n    </Library>\r\n</TriggerData>\r\n`);
    const imported = await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art");
    expect((await readJson(imported.blueprintPath)).kind).toBe("asset");

    const scripted = path.join(root!, "scripted", "Harbour-Scripted.SC2Mod");
    await cpDir(art, scripted, { recursive: true });
    await put(path.join(scripted, "Triggers"), `<?xml version="1.0" encoding="utf-8"?>\n<TriggerData>\n    <Library Id="Art">\n        <Root>\n            <Item Type="Trigger" Library="Art" Id="1A2B3C4D"/>\n        </Root>\n        <Element Type="Trigger" Id="1A2B3C4D"/>\n    </Library>\n</TriggerData>\n`);
    expect((await importMod(await loadWorkspace(workspaceRoot), scripted, "harbour-scripted")).kind).toBe("campaign");
  });

  it("refuses a folder named only .SC2Mod", async () => {
    const { workspaceRoot, art } = await setup();
    const nameless = path.join(root!, "nameless", ".SC2Mod");
    await cpDir(art, nameless, { recursive: true });
    await expect(importMod(await loadWorkspace(workspaceRoot), nameless, "harbour-art")).rejects.toThrow(/isn't an unpacked \.SC2Mod/);
  });

  it("reads back a package whose extension the Editor wrote in another case", async () => {
    const { workspaceRoot, art } = await setup();
    const lower = path.join(root!, "lower", "harbour-art.sc2mod");
    await cpDir(art, lower, { recursive: true });
    await importMod(await loadWorkspace(workspaceRoot), lower, "harbour-art");
    expect(await readWorkspaceMod(await loadWorkspace(workspaceRoot), "harbour-art")).toMatchObject({ name: "harbour-art", kind: "asset" });
  });

  it("puts .gitattributes back when an Asset Mod's import fails", async () => {
    const { workspaceRoot, art } = await setup();
    const config = path.join(workspaceRoot, WORKSPACE_FILE);
    const workspace = await loadWorkspace(workspaceRoot);
    await chmod(config, 0o444);
    try {
      await expect(importMod(workspace, art, "harbour-art")).rejects.toThrow();
    } finally {
      await chmod(config, 0o644);
    }
    expect(existsSync(path.join(workspaceRoot, ".gitattributes"))).toBe(false);
    expect(await readdir(path.join(workspaceRoot, "mods"))).toEqual([]);
  });

  it("refuses a second mod of a name a mod folder already has, even one whose Blueprint doesn't read", async () => {
    const { workspaceRoot, story } = await setup();
    const imported = await importMod(await loadWorkspace(workspaceRoot), story, "harbour-story");
    await writeFile(imported.blueprintPath, "{ broken");
    await expect(importMod(await loadWorkspace(workspaceRoot), story, "harbour-story-2")).rejects.toThrow(/already imports Harbour-Story\.SC2Mod as harbour-story/);
  });

  it("takes the kind it's given over the one it reads from the package", async () => {
    const { workspaceRoot, art } = await setup();
    const imported = await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art", { kind: "campaign" });
    expect((await readJson(imported.blueprintPath)).kind).toBe("campaign");
  });

  it("names each imported mod in the Workspace settings, keeping the rest of the config", async () => {
    const { workspaceRoot, story, art } = await setup();
    await importMod(await loadWorkspace(workspaceRoot), story, "harbour-story");
    await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art");

    const config = await readJson(path.join(workspaceRoot, WORKSPACE_FILE));
    expect(config).toEqual({ campaign: { id: "harbour", name: "The Harbour" }, missions: "missions", plugins: ["bundled:hazard"], mods: ["harbour-story", "harbour-art"] });
    expect((await loadWorkspace(workspaceRoot)).mods).toEqual(["harbour-story", "harbour-art"]);
  });

  it("adds the mod to the config's text, keeping its formatting", async () => {
    const { workspaceRoot, story, art } = await setup();
    const config = path.join(workspaceRoot, WORKSPACE_FILE);
    await writeFile(config, `{\n    "campaign": { "id": "harbour", "name": "The Harbour" },\n    "missions": "missions",\n    "plugins": ["bundled:hazard"]\n}\n`);
    await importMod(await loadWorkspace(workspaceRoot), story, "harbour-story");
    expect(await readFile(config, "utf8")).toBe(`{\n    "campaign": { "id": "harbour", "name": "The Harbour" },\n    "missions": "missions",\n    "plugins": ["bundled:hazard"],\n    "mods": ["harbour-story"]\n}\n`);
    await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art");
    expect(await readFile(config, "utf8")).toBe(`{\n    "campaign": { "id": "harbour", "name": "The Harbour" },\n    "missions": "missions",\n    "plugins": ["bundled:hazard"],\n    "mods": ["harbour-story", "harbour-art"]\n}\n`);
  });

  it("adds to a config's mods written one per line, and to an empty one", async () => {
    const { workspaceRoot, story, art } = await setup();
    const config = path.join(workspaceRoot, WORKSPACE_FILE);
    await writeFile(config, `{\n  "campaign": { "id": "harbour", "name": "The Harbour" },\n  "mods": [],\n  "missions": "missions"\n}\n`);
    await importMod(await loadWorkspace(workspaceRoot), story, "harbour-story");
    expect(await readFile(config, "utf8")).toBe(`{\n  "campaign": { "id": "harbour", "name": "The Harbour" },\n  "mods": ["harbour-story"],\n  "missions": "missions"\n}\n`);
    await writeFile(config, `{\n  "campaign": { "id": "harbour", "name": "The Harbour" },\n  "mods": [\n    "harbour-story"\n  ],\n  "missions": "missions"\n}\n`);
    await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art");
    expect(await readFile(config, "utf8")).toBe(`{\n  "campaign": { "id": "harbour", "name": "The Harbour" },\n  "mods": [\n    "harbour-story",\n    "harbour-art"\n  ],\n  "missions": "missions"\n}\n`);
  });

  it("names both of two mods imported at once", async () => {
    const { workspaceRoot, story, art } = await setup();
    const workspace = await loadWorkspace(workspaceRoot);
    await Promise.all([importMod(workspace, story, "harbour-story"), importMod(workspace, art, "harbour-art")]);
    expect([...(await loadWorkspace(workspaceRoot)).mods].sort()).toEqual(["harbour-art", "harbour-story"]);
  });

  it("tracks an Asset Mod's binaries in Git LFS, in any case, adding only the .gitattributes patterns that are missing", async () => {
    const { workspaceRoot, story, art } = await setup();
    const existing = "*.txt text eol=lf\nmods/harbour-art/**/*.[mM]3 filter=lfs diff=lfs merge=lfs -text\n";
    await writeFile(path.join(workspaceRoot, ".gitattributes"), existing);
    await importMod(await loadWorkspace(workspaceRoot), story, "harbour-story");
    expect(await readFile(path.join(workspaceRoot, ".gitattributes"), "utf8")).toBe(existing);

    const imported = await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art");

    const lines = (await readFile(path.join(workspaceRoot, ".gitattributes"), "utf8")).split("\n");
    expect(lines.slice(0, 2)).toEqual(["*.txt text eol=lf", "mods/harbour-art/**/*.[mM]3 filter=lfs diff=lfs merge=lfs -text"]);
    for (const pattern of ["[dD][dD][sS]", "[oO][gG][gG]", "[wW][aA][vV]", "[mM]3[aA]"]) expect(lines).toContain(`mods/harbour-art/**/*.${pattern} filter=lfs diff=lfs merge=lfs -text`);
    expect(lines.filter((line) => line.startsWith("mods/harbour-art/**/*.[mM]3 "))).toHaveLength(1);
    expect(lines.some((line) => line.startsWith("mods/harbour-story/"))).toBe(false);
    expect(imported.notes.some((note) => note.includes("Git LFS"))).toBe(true);
  });

  it("refuses a source that isn't an unpacked mod, an id already taken, and a second mod of the same name, leaving nothing behind", async () => {
    const { workspaceRoot, story } = await setup();
    const workspace = await loadWorkspace(workspaceRoot);
    await expect(importMod(workspace, path.join(root!, "elsewhere"), "harbour-story")).rejects.toThrow(/isn't an unpacked \.SC2Mod/);
    await expect(importMod(workspace, story, "Harbour")).rejects.toThrow(/isn't a mod id/);
    await importMod(workspace, story, "harbour-story");
    await expect(importMod(await loadWorkspace(workspaceRoot), story, "harbour-story")).rejects.toThrow(/already there/);
    await expect(importMod(await loadWorkspace(workspaceRoot), story, "harbour-story-2")).rejects.toThrow(/already imports Harbour-Story\.SC2Mod as harbour-story/);
    expect(await readdir(path.join(workspaceRoot, "mods"))).toEqual(["harbour-story"]);
    expect((await readJson(path.join(workspaceRoot, WORKSPACE_FILE))).mods).toEqual(["harbour-story"]);
  });
});

describe("after Import", () => {
  it("the first compile changes nothing", async () => {
    const { workspaceRoot, story, art } = await setup();
    for (const [source, id] of [[story, "harbour-story"], [art, "harbour-art"]] as const) {
      const imported = await importMod(await loadWorkspace(workspaceRoot), source, id);
      const modDir = path.dirname(imported.blueprintPath);
      const before = await hashTree(modDir);

      await compileMod(imported.blueprintPath);

      expect(await hashTree(modDir)).toEqual(before);
    }
  });

  it("the Campaign Pack's Campaign Mod name resolves to the imported Campaign Mod", async () => {
    const { workspaceRoot, story, art } = await setup({ pack: true });
    expect(await campaignMod(await loadWorkspace(workspaceRoot))).toBeUndefined();
    await importMod(await loadWorkspace(workspaceRoot), story, "harbour-story");
    await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art");

    expect(await campaignMod(await loadWorkspace(workspaceRoot))).toEqual({
      id: "harbour-story",
      kind: "campaign",
      name: "Harbour-Story",
      blueprintPath: path.join(workspaceRoot, "mods", "harbour-story", "blueprint.json"),
      modPackage: path.join(workspaceRoot, "mods", "harbour-story", "Harbour-Story.SC2Mod"),
      dependencies: CAMPAIGN_DEPENDENCIES,
    });
  });

  it("the Workspace checks clean", async () => {
    const { workspaceRoot, story, art } = await setup({ pack: true });
    await importMod(await loadWorkspace(workspaceRoot), story, "harbour-story");
    await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art");
    expect((await checkWorkspace(workspaceRoot)).problems).toEqual([]);
  });
});

describe("check_workspace on mods", () => {
  it("reports a mod the settings name that isn't there, a broken Mod Blueprint, and a Campaign Mod the Workspace lacks", async () => {
    const { workspaceRoot, story, art } = await setup({ pack: true });
    await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art");
    const imported = await importMod(await loadWorkspace(workspaceRoot), story, "harbour-story");
    await writeFile(imported.blueprintPath, JSON.stringify({ id: "harbour-story", kind: "data" }));
    const config = path.join(workspaceRoot, WORKSPACE_FILE);
    await writeFile(config, JSON.stringify({ ...(await readJson(config)), mods: ["harbour-art", "harbour-story", "harbour-gone"] }));

    const problems = (await checkWorkspace(workspaceRoot)).problems.map((problem) => `${problem.file}${problem.path ? ` ${problem.path}` : ""}: ${problem.message}`);
    expect(problems).toEqual([
      expect.stringMatching(/^mods\/harbour-story\/blueprint\.json kind: /),
      expect.stringMatching(/^mods\/harbour-gone: .*isn't there/),
    ]);
  });

  it("reports a Campaign Mod the Workspace lacks once every mod reads", async () => {
    const { workspaceRoot, art } = await setup({ pack: true });
    await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art");
    const problems = (await checkWorkspace(workspaceRoot)).problems.map((problem) => `${problem.file}: ${problem.message}`);
    expect(problems).toEqual([expect.stringMatching(/^sc2-adjutant\.workspace\.json: The Campaign Pack names its Campaign Mod Harbour-Story, which none of the Workspace's mods is/)]);
  });

  it("reports two mods of one package name, in any case", async () => {
    const { workspaceRoot, art } = await setup();
    await importMod(await loadWorkspace(workspaceRoot), art, "harbour-art");
    await cpDir(path.join(workspaceRoot, "mods", "harbour-art"), path.join(workspaceRoot, "mods", "harbour-art-2"), { recursive: true });
    const blueprint = path.join(workspaceRoot, "mods", "harbour-art-2", "blueprint.json");
    await writeFile(blueprint, JSON.stringify({ ...(await readJson(blueprint)), id: "harbour-art-2" }));
    const lower = path.join(workspaceRoot, "mods", "harbour-art-2");
    // By way of another name, since the disk may not tell the two cases apart.
    await rename(path.join(lower, "Harbour-Art.SC2Mod"), path.join(lower, "renaming"));
    await rename(path.join(lower, "renaming"), path.join(lower, "harbour-art.SC2Mod"));
    const config = path.join(workspaceRoot, WORKSPACE_FILE);
    await writeFile(config, JSON.stringify({ ...(await readJson(config)), mods: ["harbour-art", "harbour-art-2"] }));

    const problems = (await checkWorkspace(workspaceRoot)).problems.map((problem) => `${problem.mod}: ${problem.message}`);
    expect(problems).toEqual([expect.stringMatching(/^harbour-art-2: harbour-art\.SC2Mod has the name of the mod harbour-art.s Harbour-Art\.SC2Mod/)]);
  });

  it("refuses a config naming one mod twice", async () => {
    const { workspaceRoot } = await setup();
    const config = path.join(workspaceRoot, WORKSPACE_FILE);
    await writeFile(config, JSON.stringify({ ...(await readJson(config)), mods: ["harbour-art", "harbour-art"] }));
    await expect(loadWorkspace(workspaceRoot)).rejects.toThrow(/harbour-art.*twice/);
  });
});

describe("the import_mod tool", () => {
  it("imports a mod into the Workspace, as importMod does", async () => {
    const { workspaceRoot, art } = await setup();
    const client = await connect(workspaceRoot);
    const reply = await client.callTool({ name: "import_mod", arguments: { source: art, mod: "harbour-art" } });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({ blueprint: "mods/harbour-art/blueprint.json", modPackage: "mods/harbour-art/Harbour-Art.SC2Mod", kind: "asset" });
    expect(text(reply)).toContain("Wrote mods/harbour-art/blueprint.json and its empty compile record");
  });
});
