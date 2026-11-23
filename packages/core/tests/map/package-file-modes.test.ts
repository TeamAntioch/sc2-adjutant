// A compile keeps the permission bits of the package's files: the Editor saves every file 755 and
// git records it, so a writer that left the process's default (644) flipped every file it wrote,
// changed or not. A file the package has keeps its mode; a new one gets its neighbours'.
import { chmod, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileShotCutscene } from "../../src/cutscene/compile-cutscene.js";
import { compileMeleeMap } from "../../src/map/compile-melee-map.js";
import { stageFiles } from "../../src/map/write-files-together.js";
import { writeMapPackage } from "../../src/map/write-map-package.js";
import { compileMod } from "../../src/mods/compile-mod.js";
import { EDITOR_FILE_MODE } from "../../src/util/package-file-mode.js";
import { CrossingBlueprintSchema, crossingRaw } from "../support/workspaces.js";
import { catalog, cleanupMods, declare, setup, UNIT_FILE } from "../mods/mod-fixture.js";

// Windows has no permission bits for git or the Editor to keep.
const posix = describe.skipIf(process.platform === "win32");

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
  await cleanupMods();
});

/** Every file in `root`, by its path with forward slashes, with its permission bits. */
async function modes(root: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(root, full).split(path.sep).join("/")] = (await stat(full)).mode & 0o777;
  }
  return out;
}

/** Sets every file in `root` to `mode`, as an Editor save (755) or a plain checkout (644) leaves them. */
async function setModes(root: string, mode: number): Promise<void> {
  for (const file of Object.keys(await modes(root))) await chmod(path.join(root, ...file.split("/")), mode);
}

const every = (tree: Record<string, number>, mode: number) => Object.fromEntries(Object.keys(tree).map((file) => [file, mode]));

posix("a Mod compile", () => {
  it("keeps the 755 of every package file it writes, and gives a new file 755 too", async () => {
    const mod = await setup();
    await declare(
      mod,
      { gameData: [{ file: UNIT_FILE, source: "data/UnitData.xml" }], files: [{ path: "Assets/Textures/gull.dds", source: "art/gull.dds" }] },
      { "data/UnitData.xml": catalog(`<CUnit id="Gull" parent="Critter"/>`), "art/gull.dds": "DDS gull" },
    );
    // The source is 644, as a file the author saves usually is: the copy mustn't carry that in.
    await chmod(path.join(mod.modDir, "art", "gull.dds"), 0o644);
    await setModes(mod.modPackage, 0o755);

    await compileMod(mod.blueprintPath);
    const first = await modes(mod.modPackage);
    expect(first).toHaveProperty(["Assets/Textures/gull.dds"]);
    expect(first).toEqual(every(first, 0o755));

    await compileMod(mod.blueprintPath);
    expect(await modes(mod.modPackage)).toEqual(first);
  });

  it("gives a new file the mode the package's other files have", async () => {
    const mod = await setup();
    await declare(mod, { files: [{ path: "Assets/Textures/gull.dds", source: "art/gull.dds" }] }, { "art/gull.dds": "DDS gull" });
    await setModes(mod.modPackage, 0o644);

    await compileMod(mod.blueprintPath);
    const tree = await modes(mod.modPackage);
    expect(tree).toEqual(every(tree, 0o644));
  });
});

posix("a Map compile in place", () => {
  const { script: _script, ...screenplay } = crossingRaw.screenplay as Record<string, unknown>;
  const blueprint = CrossingBlueprintSchema.parse({ ...crossingRaw, screenplay });
  const compile = (outputDir: string, previousRecord?: Awaited<ReturnType<typeof writeMapPackage>>["record"]) =>
    writeMapPackage({ blueprint, outputDir, includeObjects: true, includeRegions: true, includeTriggers: true, savedAt: new Date("2026-01-01T00:00:00Z"), ...(previousRecord ? { previousRecord } : {}) });

  it("writes a new package's files 755, as the Editor saves them, and a recompile keeps each file's mode", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-modes-"));
    dirs.push(dir);
    const { record } = await compile(dir);
    const first = await modes(dir);
    expect(first).toEqual(every(first, EDITOR_FILE_MODE));

    // One file the author narrowed by hand keeps that too.
    await chmod(path.join(dir, "Objects"), 0o700);
    await compile(dir, record);
    expect(await modes(dir)).toEqual({ ...first, Objects: 0o700 });
  });

  it("and a cutscene written into it gives its new files the package's mode", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-modes-"));
    dirs.push(dir);
    await compile(dir);
    await setModes(dir, 0o750);
    const spec = { origin: [20, 30, 0] as [number, number, number], shots: [{ name: "Wide", durationMs: 2000, from: { target: [16, 32, 1] as [number, number, number], distance: 20, pitch: 30, yaw: 180, fov: 40 } }] };
    await compileShotCutscene(spec, dir, "Intro", { play: true });
    const tree = await modes(dir);
    expect(tree).toHaveProperty(["Base.SC2Data/Cutscenes/Index.version"]);
    expect(tree).toEqual(every(tree, 0o750));
  });
});

posix("a Melee Map compile", () => {
  it("keeps the mode of each file it copies in from its staging folder", async () => {
    const fixture = fileURLToPath(new URL("../fixtures/melee/two-spawns.json", import.meta.url));
    const dir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-modes-"));
    dirs.push(dir);
    const savedAt = new Date("2026-10-31T00:00:00Z");
    await compileMeleeMap(fixture, dir, { savedAt });
    await setModes(dir, 0o750);
    await compileMeleeMap(fixture, dir, { savedAt });
    const tree = await modes(dir);
    expect(tree).toEqual(every(tree, 0o750));
  }, 30_000);
});

posix("stageFiles", () => {
  it("gives each file its old mode, and a new one the folder's", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-modes-"));
    dirs.push(dir);
    await writeFile(path.join(dir, "t3HeightMap"), "old");
    await writeFile(path.join(dir, "t3Terrain.xml"), "old");
    await chmod(path.join(dir, "t3HeightMap"), 0o755);
    await chmod(path.join(dir, "t3Terrain.xml"), 0o750);

    await (await stageFiles(dir, [["t3HeightMap", "new"], ["t3Terrain.xml", "new"], ["t3SyncHeightMap", "new"]])).commit();
    expect(await modes(dir)).toEqual({ t3HeightMap: 0o755, "t3Terrain.xml": 0o750, t3SyncHeightMap: 0o755 });
  });
});
