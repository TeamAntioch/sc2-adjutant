// A Kept map's playable area through the compile (ADR-0015, #529): bounds.playable patches the
// package's MapInfo in place, the record remembers what was there, an Editor change stops the
// compile until the author decides, and dropping bounds.playable puts the original back.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { parseCompileRecord } from "../../src/domain/compile-record.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { EditorChangesError } from "../../src/map/editor-changes.js";
import { importMap } from "../../src/map/import-map.js";
import { mapInfoHashProblems } from "../../src/map/kept-checks.js";
import { mapInfoBounds, patchMapInfoBounds } from "../../src/map/patch-map-info.js";
import { readTga } from "../../src/map/read-tga.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** A Workspace with an imported Mission, every part of its package Kept Content: Ashen Crossing compiled elsewhere (128×128, bounds [10, 8, 118, 108]). */
async function imported() {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-kept-bounds-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const source = path.join(root, "elsewhere", "Harbour.SC2Map");
  await compileMission(await loadWorkspace(workspaceRoot), path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json"), source, { savedAt });
  await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
  const workspace = await loadWorkspace(workspaceRoot);
  const { blueprintPath, mapPackage } = await importMap(workspace, source, "harbour", { title: "The Harbour" });
  const mapInfo = path.join(mapPackage, "MapInfo");
  const setBounds = async (bounds: unknown): Promise<void> => {
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    if (bounds === undefined) delete blueprint.bounds;
    else blueprint.bounds = { playable: bounds };
    await writeFile(blueprintPath, JSON.stringify(blueprint, null, 2));
  };
  const record = async () => parseCompileRecord(await readFile(path.join(path.dirname(blueprintPath), "compile-record.json"), "utf8"));
  return { workspace, blueprintPath, mapPackage, mapInfo, setBounds, record, compile: (options = {}) => compileMission(workspace, blueprintPath, undefined, { savedAt, ...options }) };
}

describe("a Kept map's playable area", () => {
  it("is left as the package has it while the Blueprint gives none", async () => {
    const { mapInfo, compile, record } = await imported();
    const before = await readFile(mapInfo);
    await compile();
    expect((await readFile(mapInfo)).equals(before)).toBe(true);
    expect((await record()).entries.some((entry) => entry.kind === "map-bounds")).toBe(false);
  }, 60_000);

  it("is set in place from bounds.playable, with its hash, and put back once the Blueprint drops it", async () => {
    const { mapInfo, mapPackage, compile, record, setBounds } = await imported();
    const before = await readFile(mapInfo);
    expect(mapInfoBounds(before)).toEqual([10, 8, 118, 108]);

    await setBounds([12, 10, 116, 104]);
    await compile();
    const patched = await readFile(mapInfo);
    expect(mapInfoBounds(patched)).toEqual([12, 10, 116, 104]);
    // The Kept minimap is masked black outside the new rectangle: cell (11, 50) is now outside it.
    const minimap = readTga(await readFile(path.join(mapPackage, "Minimap.tga")));
    const at = ((128 - 1 - 50) * 128 + 11) * 3;
    expect(minimap.rgb[at]! + minimap.rgb[at + 1]! + minimap.rgb[at + 2]!).toBe(0);
    expect(await mapInfoHashProblems(mapPackage)).toEqual([]);
    expect((await record()).entries).toContainEqual({ kind: "map-bounds", bounds: [12, 10, 116, 104], original: [10, 8, 118, 108] });
    // MapInfo stays Kept Content: no file entry for it.
    expect((await record()).entries.some((entry) => entry.kind === "file" && entry.path === "MapInfo")).toBe(false);

    await setBounds(undefined);
    await compile();
    expect((await readFile(mapInfo)).equals(before)).toBe(true);
    expect((await record()).entries.some((entry) => entry.kind === "map-bounds")).toBe(false);
  }, 60_000);

  it("still compiles beside a MapInfo it can't read, losing only the bounds checks", async () => {
    const { mapInfo, compile } = await imported();
    await writeFile(mapInfo, (await readFile(mapInfo)).subarray(0, 40));
    await expect(compile()).resolves.toBeDefined();
  }, 60_000);

  it("stops on an Editor change to it, and takes the author's decision", async () => {
    const { mapInfo, compile, record, setBounds } = await imported();
    await setBounds([12, 10, 116, 104]);
    await compile();
    // The author moves the bounds in the Editor's Map Properties.
    await writeFile(mapInfo, patchMapInfoBounds(await readFile(mapInfo), [14, 10, 116, 104]));

    const stopped = await compile().catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(EditorChangesError);
    expect((stopped as EditorChangesError).message).toContain("map-bounds:MapInfo (the playable area, now [14, 10, 116, 104]; the Blueprint's bounds.playable is [12, 10, 116, 104]");
    expect(mapInfoBounds(await readFile(mapInfo))).toEqual([14, 10, 116, 104]);

    await compile({ decisions: { discard: ["map-bounds:MapInfo"] } });
    expect(mapInfoBounds(await readFile(mapInfo))).toEqual([12, 10, 116, 104]);
    // The original is still the package's own, from before the first compile set it.
    expect((await record()).entries).toContainEqual({ kind: "map-bounds", bounds: [12, 10, 116, 104], original: [10, 8, 118, 108] });
  }, 60_000);
});
