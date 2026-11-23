// Hidden cells changed in the Editor (#597): the compile records where it wrote t3CellFlags' hidden
// bit and which cells it hid, and a hide or a show the Editor made since stops it until the author
// syncs, keeps or discards it. On a generated map; beside Kept ground it's in
// tests/kept-terrain/generating-zones.test.ts. Synthetic: the Ashen Crossing fixture compiled in place.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { parseCompileRecord } from "../../src/domain/compile-record.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { EditorChangesError } from "../../src/map/editor-changes.js";
import { hiddenCells } from "../../src/map/hidden-cells-changes.js";
import { loadWorkspace, type Workspace } from "../../src/plugins/workspace.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");
const SIZE = 128;

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

type Mission = { readonly workspace: Workspace; readonly missionDir: string; readonly mapDir: string; readonly blueprintPath: string };

/** The Ashen Crossing Mission, its landing zone hiding (20, 20) and (21, 20), compiled once in place. */
async function compiled(): Promise<Mission> {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-hidden-cells-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const workspace = await loadWorkspace(workspaceRoot);
  const missionDir = path.join(workspaceRoot, "missions", "ashen-crossing");
  const blueprintPath = path.join(missionDir, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8")) as { zones: Record<string, unknown>[] };
  blueprint.zones.find((zone) => zone.id === "landing_zone")!.hiddenCells = [[20, 20, 2, 1]];
  await writeFile(blueprintPath, JSON.stringify(blueprint, null, 2));
  const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
  return { workspace, missionDir, mapDir: outputDir, blueprintPath };
}

const flagsFile = (mission: Mission) => path.join(mission.mapDir, "t3CellFlags");
const hiddenAt = async (mission: Mission, x: number, y: number) => ((await readFile(flagsFile(mission)))[32 + y * SIZE + x]! & 0x04) !== 0;
/** Hides (or shows) cells in the package, as the Editor's Hide Terrain brush would. */
async function brush(mission: Mission, cells: readonly (readonly [number, number])[], hide: boolean): Promise<void> {
  const bytes = await readFile(flagsFile(mission));
  for (const [x, y] of cells) bytes[32 + y * SIZE + x] = hide ? bytes[32 + y * SIZE + x]! | 0x04 : bytes[32 + y * SIZE + x]! & ~0x04;
  await writeFile(flagsFile(mission), bytes);
}
const record = async (mission: Mission) => parseCompileRecord(await readFile(path.join(mission.missionDir, "compile-record.json"), "utf8"));
const compile = (mission: Mission, decisions?: { keep?: string[]; discard?: string[] }) => compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt, ...(decisions ? { decisions } : {}) });

describe("hidden cells on a generated map", { timeout: 120_000 }, () => {
  it("are written and recorded, and compile again without asking", async () => {
    const mission = await compiled();
    expect(await hiddenAt(mission, 20, 20)).toBe(true);
    expect(await hiddenAt(mission, 21, 20)).toBe(true);
    expect(await hiddenAt(mission, 22, 20)).toBe(false);
    expect((await record(mission)).entries.find((entry) => entry.kind === "hidden-cells")).toEqual({ kind: "hidden-cells", cells: [[0, 0, SIZE, SIZE]], hidden: [[20, 20, 2, 1]] });
    await compile(mission);
  });

  it("stop the compile when the Editor hid or showed one, naming them, and nothing is written", async () => {
    const mission = await compiled();
    await brush(mission, [[60, 60], [61, 60]], true);
    await brush(mission, [[20, 20]], false);
    const before = await readFile(flagsFile(mission));
    const stopped = await compile(mission).catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(EditorChangesError);
    expect((stopped as EditorChangesError).changes.map((change) => [change.name, change.label])).toEqual([["hidden-cells", "2 hidden and 1 shown in the package, unlike the Zones' hiddenCells, the first at (20, 20)"]]);
    expect((await readFile(flagsFile(mission))).equals(before)).toBe(true);
  });

  it("discarded, take the Blueprint's bit again", async () => {
    const mission = await compiled();
    await brush(mission, [[60, 60]], true);
    await brush(mission, [[20, 20]], false);
    await compile(mission, { discard: ["hidden-cells"] });
    expect(await hiddenAt(mission, 60, 60)).toBe(false);
    expect(await hiddenAt(mission, 20, 20)).toBe(true);
  });

  it("kept, stay as the Editor left them, off the record, and the next compile doesn't ask", async () => {
    const mission = await compiled();
    await brush(mission, [[60, 60]], true);
    await brush(mission, [[20, 20]], false);
    const kept = await compile(mission, { keep: ["hidden-cells"] });
    expect(await hiddenAt(mission, 60, 60)).toBe(true);
    expect(await hiddenAt(mission, 20, 20)).toBe(false);
    expect(await hiddenAt(mission, 21, 20)).toBe(true);
    const after = await record(mission);
    expect(after.kept).toEqual([{ kind: "hidden-cells", cells: [[20, 20, 1, 1], [60, 60, 1, 1]] }]);
    expect(after.entries.find((entry) => entry.kind === "hidden-cells")).toMatchObject({ hidden: [[21, 20, 1, 1]] });
    expect(kept.warnings.some((warning) => warning.includes("--discard hidden-cells:20,20"))).toBe(true);
    await compile(mission);
    expect(await hiddenAt(mission, 60, 60)).toBe(true);

    // Discarded by name, the kept cells are the Blueprint's again.
    await compile(mission, { discard: ["hidden-cells:20,20"] });
    expect(await hiddenAt(mission, 60, 60)).toBe(false);
    expect(await hiddenAt(mission, 20, 20)).toBe(true);
  });

  it("aren't recorded while a kept terrain file keeps t3CellFlags as the Editor saved it", async () => {
    const mission = await compiled();
    const heights = path.join(mission.mapDir, "t3HeightMap");
    const bytes = await readFile(heights);
    bytes.writeUInt16LE(bytes.readUInt16LE(32 + 6 * 1000) + 100, 32 + 6 * 1000);
    await writeFile(heights, bytes);
    await compile(mission, { keep: ["file:t3HeightMap"] });
    expect((await record(mission)).entries.some((entry) => entry.kind === "hidden-cells")).toBe(false);
    // A cell the Blueprint adds now isn't written, so it isn't on the record to read as shown in the Editor.
    const raw = JSON.parse(await readFile(mission.blueprintPath, "utf8")) as { zones: Record<string, unknown>[] };
    raw.zones.find((zone) => zone.id === "landing_zone")!.hiddenCells = [[20, 20, 2, 1], [25, 25, 1, 1]];
    await writeFile(mission.blueprintPath, JSON.stringify(raw, null, 2));
    await compile(mission);
    await compile(mission);
    expect(await hiddenAt(mission, 25, 25)).toBe(false);
  });

  it("aren't changed by a cliff or ground bit the Editor rewrote", async () => {
    const mission = await compiled();
    const bytes = await readFile(flagsFile(mission));
    bytes[32 + 70 * SIZE + 70] = bytes[32 + 70 * SIZE + 70]! ^ 0x01;
    await writeFile(flagsFile(mission), bytes);
    await compile(mission);
  });
});

describe("telling the hidden bit's changes", () => {
  const width = 4;
  const height = 1;
  const field = Uint8Array.from([1, 0, 0, 0]);
  const flags = (...bits: number[]) => Uint8Array.from(bits, (bit) => 0x02 | (bit ? 0x04 : 0));

  it("names nothing on a first compile, or where the package agrees with the Blueprint", () => {
    expect(hiddenCells({ width, height, field }).changes).toEqual([]);
    expect(hiddenCells({ width, height, field, packageFlags: flags(1, 0, 0, 0), record: { version: 1, entries: [] } }).changes).toEqual([]);
  });

  it("names a cell the record doesn't list whose bit isn't the Blueprint's, though the Editor may not have changed it", () => {
    const { changes } = hiddenCells({ width, height, field, packageFlags: flags(1, 0, 1, 0), record: { version: 1, entries: [] } });
    expect(changes.map((change) => change.label)).toEqual(["1 hidden in the package, unlike the Zones' hiddenCells, the first at (2, 0)"]);
  });

  it("leaves a cell the Blueprint changed since, where the Editor didn't, to the Blueprint", () => {
    const record = { version: 1 as const, entries: [{ kind: "hidden-cells" as const, cells: [[0, 0, 4, 1] as [number, number, number, number]], hidden: [] }] };
    const result = hiddenCells({ width, height, field, packageFlags: flags(0, 0, 0, 0), record });
    expect(result.changes).toEqual([]);
    expect([...result.hidden]).toEqual([1, 0, 0, 0]);
  });

  it("writes only the cells it may", () => {
    const result = hiddenCells({ width, height, field, may: Uint8Array.from([1, 1, 0, 0]) });
    expect([...result.writable]).toEqual([1, 1, 0, 0]);
    expect(result.entry).toEqual({ kind: "hidden-cells", cells: [[0, 0, 2, 1]], hidden: [[0, 0, 1, 1]] });
  });
});
