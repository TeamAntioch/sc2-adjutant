// A Workspace mod's files as model.render reads them (#559, ADR-0017): a storage path is found in
// the newest-loaded mod package that holds it, else it's the game's; the Workspace's packages come
// in load order under its Campaign Mod.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { renderThumbnails } from "@team-antioch/sc2-asset-catalog/catalog/render-thumbnails.js";

import { hostModelRenderer } from "../../src/catalog/host-model-renderer.js";
import { findPackageFile } from "../../src/catalog/package-files.js";
import { loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { importMod } from "../../src/mods/import-mod.js";
import { campaignModPackages, fileDependencyNames } from "../../src/mods/workspace-mods.js";
import { loadWorkspace, WORKSPACE_FILE } from "../../src/plugins/workspace.js";
import { cleanupMods, documentHeader, put, setup } from "../mods/mod-fixture.js";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
  await cleanupMods();
});

async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-package-files-"));
  folders.push(folder);
  return folder;
}

describe("findPackageFile", () => {
  it("finds a storage path under a package's Base.SC2Assets or its root, in any case, newest package first", async () => {
    const root = await tempFolder();
    const art = path.join(root, "Art.SC2Mod");
    const story = path.join(root, "Story.SC2Mod");
    await put(path.join(art, "Base.SC2Assets", "Assets", "Doodads(Custom)", "Fan", "Fan.m3"), "art fan");
    await put(path.join(art, "Base.SC2Assets", "Assets", "Doodads(Custom)", "Gate", "Gate.m3"), "art gate");
    await put(path.join(story, "Assets", "Doodads(Custom)", "Gate", "Gate.m3"), "story gate");

    expect(findPackageFile([art, story], "Assets\\Doodads(Custom)\\Fan\\Fan.m3")).toEqual({ package: art, file: path.join(art, "Base.SC2Assets", "Assets", "Doodads(Custom)", "Fan", "Fan.m3") });
    expect(findPackageFile([art, story], "assets/doodads(custom)/fan/FAN.m3")?.package).toBe(art);
    expect(findPackageFile([art, story], "Assets/Doodads(Custom)/Gate/Gate.m3")?.package).toBe(story);
    expect(findPackageFile([story, art], "Assets/Doodads(Custom)/Gate/Gate.m3")?.package).toBe(art);
    expect(findPackageFile([art, story], "Assets/Doodads/Rock/Rock.m3")).toBeUndefined();
    expect(findPackageFile([art, story], "Assets/Doodads(Custom)/Fan")).toBeUndefined();
    expect(findPackageFile([], "Assets/Doodads(Custom)/Fan/Fan.m3")).toBeUndefined();
  });
});

describe("campaignModPackages", () => {
  it("names a package's file dependencies, not its Battle.net ones", () => {
    expect(fileDependencyNames(["bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod", "file:Mods\\Harbour-Art.SC2Mod", "bnet:Only (Mod)/0.0/1"])).toEqual(["Void", "Harbour-Art"]);
  });

  it("lists the Workspace mods the Campaign Mod depends on, then the Campaign Mod", async () => {
    const story = await setup();
    const config = path.join(story.workspaceRoot, WORKSPACE_FILE);
    await writeFile(config, JSON.stringify({ ...JSON.parse(await readFile(config, "utf8")), campaignMod: "Harbour-Story" }));
    expect(await campaignModPackages(await loadWorkspace(story.workspaceRoot))).toEqual([story.modPackage]);

    const source = path.join(path.dirname(story.workspaceRoot), "elsewhere", "Harbour-Art.SC2Mod");
    await put(path.join(source, "DocumentHeader"), documentHeader([], 6));
    await put(path.join(source, "DocumentInfo"), `<?xml version="1.0" encoding="utf-8"?>\r\n<DocInfo>\r\n</DocInfo>\r\n`);
    await put(path.join(source, "Base.SC2Assets", "Assets", "Textures", "gull.dds"), "dds");
    const art = await importMod(await loadWorkspace(story.workspaceRoot), source, "harbour-art", { kind: "asset" });

    expect(await campaignModPackages(await loadWorkspace(story.workspaceRoot))).toEqual([art.modPackage, story.modPackage]);
  });
});

describe("renderThumbnails with packages", () => {
  it("reads a model from the packages before the game, and draws again with other packages", async () => {
    const folder = await tempFolder();
    const cacheDir = path.join(folder, "cache");
    const pkg = path.join(folder, "Art.SC2Mod");
    const FAN = { type: "Fan", model: "Assets/Doodads(Custom)/Fan/Fan.m3", variation: 0, variations: 1 };
    const ROCK = { type: "Rock", model: "Assets/Doodads/Rock/Rock.m3", variation: 0, variations: 1 };
    await put(path.join(pkg, "Base.SC2Assets", ...FAN.model.split("/")), "m3");
    await mkdir(path.join(cacheDir, "game", "Assets", "Doodads", "Rock"), { recursive: true });
    await writeFile(path.join(cacheDir, "game", ...ROCK.model.split("/")), "m3");
    const file = path.join(folder, "machine.json");
    await writeFile(file, JSON.stringify({ hostAdapter: fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url)), cacheDir }));
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    const out = path.join(folder, "thumbnails");

    expect(await renderThumbnails(hostModelRenderer(host, { packages: [pkg] }), [FAN, ROCK], out, { workers: 1 })).toEqual({ rendered: 2, failed: 0, unchanged: 0 });
    expect(await renderThumbnails(hostModelRenderer(host), [FAN], out)).toEqual({ rendered: 0, failed: 1, unchanged: 0 });
    expect(await renderThumbnails(hostModelRenderer(host, { packages: [pkg] }), [FAN, ROCK], out)).toEqual({ rendered: 1, failed: 0, unchanged: 1 });
    const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8"));
    expect(manifest.Fan_00).toMatchObject({ ok: true, model: FAN.model });
    // index-mod-doodads files each sheet by where findPackageFile finds the model drawn.
    expect(findPackageFile([pkg], manifest.Fan_00.model)?.package).toBe(pkg);
    expect(findPackageFile([pkg], manifest.Rock_00.model)).toBeUndefined();
    expect(manifest.Rock_00).toMatchObject({ ok: true, model: ROCK.model });
    const log = (await readFile(path.join(cacheDir, "host.log"), "utf8")).trim().split("\n");
    expect(log[0]).toBe(`render ${FAN.model} 4x512 from 1 packages`);
  });
});
