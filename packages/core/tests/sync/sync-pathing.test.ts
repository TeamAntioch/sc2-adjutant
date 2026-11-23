// Pathing paint under doodads and back from the Editor (map/compiled-pathing.ts, sync/sync-pathing.ts):
// the compile paints under a solid doodad Anchor, the Editor's pathing brush paints and erases, sync
// brings that back as pathingPaint, and the next compile writes the Editor's layer again, the strokes
// by the doodad moving with it. Synthetic: the Ashen Crossing fixture with a stock wall added.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { generateTerrain } from "../../src/map/generate-terrain.js";
import { EditorChangesError } from "../../src/map/editor-changes.js";
import { loadWorkspace, type Workspace } from "../../src/plugins/workspace.js";
import { syncMission } from "../../src/sync/sync-mission.js";
import { countSubs } from "../../src/terrain/doodad-pathing.js";
import { readCellAttribute, writeCellAttribute } from "../../src/terrain/write-cell-attribute.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");
const SIZE = 128;

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

type Raw = Record<string, unknown> & { anchors: Record<string, unknown>[]; pathingPaint?: unknown[] };
const read = async (file: string): Promise<Raw> => JSON.parse(await readFile(file, "utf8")) as Raw;
const layer = async (mapDir: string): Promise<Uint8Array> => readCellAttribute(await readFile(path.join(mapDir, "CellAttribute_Pnp")), SIZE, SIZE);

/** The package's Objects with the wall moved `dx` cells east, as the Editor saves a drag. */
async function dragWall(mapDir: string, dx: number): Promise<void> {
  const file = path.join(mapDir, "Objects");
  const objects = await readFile(file, "utf8");
  const moved = objects.replace(/<ObjectDoodad\b[^>]*Type="Aiur_Temple_Bigwalls"[^>]*>/, (element) => element.replace(/Position="([-\d.]+)/, (_, x: string) => `Position="${Number(x) + dx}`));
  expect(moved).not.toBe(objects);
  await writeFile(file, moved);
}

/** The cells x0-x1, y0-y1 of a layer, shifted `dx` cells east (what was west of the box comes in blank). */
function shifted(cells: Uint8Array, dx: number, [x0, y0, x1, y1]: readonly number[]): Uint8Array {
  const out = Uint8Array.from(cells);
  for (let y = y0!; y <= y1!; y++) for (let x = x0!; x <= x1!; x++) out[y * SIZE + x] = x - dx >= x0! ? cells[y * SIZE + x - dx]! : 0;
  return out;
}

/** A copy of the fixture with a stock wall block (8 × 4.4 cells at variation 0) standing at (60, 60), unturned. */
async function withWall(): Promise<{ workspace: Workspace; blueprintPath: string }> {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-sync-pathing-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const blueprintPath = path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json");
  const raw = await read(blueprintPath);
  raw.anchors.push({ id: "temple_wall", name: "Temple wall", zoneId: "surface", kind: "doodad", doodadType: "Aiur_Temple_Bigwalls", variation: 0, position: { x: 60, y: 60 }, rotation: 0, scale: 1 });
  await writeFile(blueprintPath, JSON.stringify(raw, null, 2));
  return { workspace: await loadWorkspace(workspaceRoot), blueprintPath };
}

describe("pathing paint under doodads", { timeout: 180_000 }, () => {
  it("paints under a solid doodad, brings the Editor's strokes back, and moves a doodad's strokes with it", async () => {
    const { workspace, blueprintPath } = await withWall();
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
    const compiled = await layer(outputDir);
    // The wall's cell (60, 60) is painted whole; a cell well off it isn't.
    expect(compiled[60 * SIZE + 60]).toBe(0xff);
    expect(compiled[60 * SIZE + 70]).toBe(0);
    const wall = countSubs(compiled);
    expect(wall).toBeGreaterThan(250);

    // The pathing brush: a cell erased from the wall's middle, a cell painted far from it.
    const edited = Uint8Array.from(compiled);
    edited[60 * SIZE + 60] = 0;
    edited[100 * SIZE + 20] = 0xff;
    await writeFile(path.join(outputDir, "CellAttribute_Pnp"), writeCellAttribute(edited));

    const stopped = await compileMission(workspace, blueprintPath, undefined, { savedAt }).catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(EditorChangesError);
    expect((stopped as Error).message).toContain("Run sync first");
    expect((stopped as Error).message).toContain("file:CellAttribute_Pnp");

    const synced = await syncMission(workspace, blueprintPath, outputDir);
    expect(synced.changes).toEqual([{ label: "Pathing paint changed", ids: ["8 sub-cells painted at cell (20, 100)", "8 sub-cells erased at cell (60, 60)"] }]);
    // Cell (60, 60) starts at the sub-cell under the wall's origin, (120, 240).
    expect((await read(blueprintPath)).pathingPaint).toEqual([{ block: [[20, 100, 1, 1]] }, { doodad: "temple_wall", clear: [[0, 0, 1, 1]] }]);

    await compileMission(workspace, blueprintPath, undefined, { savedAt });
    expect(await layer(outputDir)).toEqual(edited);
    expect((await syncMission(workspace, blueprintPath, outputDir)).changes).toEqual([]);

    // Moved 3 cells east in the Blueprint, the wall takes its erased cell with it; the far cell stays.
    const raw = await read(blueprintPath);
    raw.anchors.find((anchor) => anchor.id === "temple_wall")!.position = { x: 63, y: 60 };
    await writeFile(blueprintPath, JSON.stringify(raw, null, 2));
    await compileMission(workspace, blueprintPath, undefined, { savedAt });
    const moved = await layer(outputDir);
    expect(moved[60 * SIZE + 63]).toBe(0);
    expect(moved[60 * SIZE + 60]).toBe(0xff);
    expect(moved[100 * SIZE + 20]).toBe(0xff);
  });

  it("leaves paint the compile wrote alone, and paints nothing under a doodad set to walk", async () => {
    const { workspace, blueprintPath } = await withWall();
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
    expect((await syncMission(workspace, blueprintPath, outputDir)).changes).toEqual([]);

    const raw = await read(blueprintPath);
    raw.anchors.find((anchor) => anchor.id === "temple_wall")!.pathing = "walk";
    await writeFile(blueprintPath, JSON.stringify(raw, null, 2));
    await compileMission(workspace, blueprintPath, undefined, { savedAt });
    expect((await layer(outputDir).catch(() => new Uint8Array(SIZE * SIZE)))[60 * SIZE + 60]).toBe(0);
  });

  it("lays strokes over a doodad the Editor moved where it now stands, and compiles after sync without stopping", async () => {
    const { workspace, blueprintPath } = await withWall();
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
    const compiled = await layer(outputDir);
    // The Editor drags the wall 3 cells east, leaving its paint behind; the author erases what's left
    // off the wall's new spot, and paints a cell east of it.
    await dragWall(outputDir, 3);
    const box = [50, 50, 80, 70];
    const expected = shifted(compiled, 3, box);
    const edited = Uint8Array.from(compiled);
    for (let cell = 0; cell < edited.length; cell++) edited[cell] = edited[cell]! & expected[cell]!;
    expect(countSubs(edited)).toBeLessThan(countSubs(compiled));
    let east = 64;
    while (expected[60 * SIZE + east]) east++;
    east++;
    edited[60 * SIZE + east] = 0xff;
    await writeFile(path.join(outputDir, "CellAttribute_Pnp"), writeCellAttribute(edited));

    const synced = await syncMission(workspace, blueprintPath, outputDir);
    expect(synced.edit?.saved).toBe(true);
    const raw = await read(blueprintPath);
    expect(raw.anchors.find((anchor) => anchor.id === "temple_wall")!.position).toMatchObject({ x: 63, y: 60 });
    // Erasing the paint left behind changes nothing; the painted cell goes with the wall, from where it now stands.
    expect(raw.pathingPaint).toEqual([{ doodad: "temple_wall", block: [[east - 63, 0, 1, 1]] }]);

    // The record has the Editor's layer, so the compile writes over it: the wall's paint where it stands, and the cell.
    await compileMission(workspace, blueprintPath, undefined, { savedAt });
    expected[60 * SIZE + east] = 0xff;
    expect(await layer(outputDir)).toEqual(expected);
    expect((await syncMission(workspace, blueprintPath, outputDir)).changes).toEqual([]);
  });

  it("stops on a layer painted where the last compile wrote none, and syncs it back", async () => {
    const { workspace, blueprintPath } = await withWall();
    // Nothing painted: the wall and the fixture's temple columns walked through.
    const walking = await read(blueprintPath);
    for (const anchor of walking.anchors) if (["temple_wall", "temple_columns_w", "temple_columns_e"].includes(anchor.id as string)) anchor.pathing = "walk";
    await writeFile(blueprintPath, JSON.stringify(walking, null, 2));
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
    const file = path.join(outputDir, "CellAttribute_Pnp");
    const empty = await readFile(file).then((bytes) => readCellAttribute(bytes, SIZE, SIZE), () => new Uint8Array(SIZE * SIZE));
    expect(countSubs(empty)).toBe(0);
    const painted = Uint8Array.from(empty);
    painted[100 * SIZE + 20] = 0xff;
    await writeFile(file, writeCellAttribute(painted));
    // The wall paints again, so the compile would write the file: it stops rather than overwrite the author's cell.
    const raw = await read(blueprintPath);
    delete raw.anchors.find((anchor) => anchor.id === "temple_wall")!.pathing;
    await writeFile(blueprintPath, JSON.stringify(raw, null, 2));
    const stopped = await compileMission(workspace, blueprintPath, undefined, { savedAt }).catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(EditorChangesError);
    expect((stopped as Error).message).toContain("Run sync first");
    expect((stopped as Error).message).toContain("file:CellAttribute_Pnp");

    await syncMission(workspace, blueprintPath, outputDir);
    expect((await read(blueprintPath)).pathingPaint).toEqual([{ block: [[20, 100, 1, 1]] }]);
    await compileMission(workspace, blueprintPath, undefined, { savedAt });
    const after = await layer(outputDir);
    expect(after[100 * SIZE + 20]).toBe(0xff);
    expect(after[60 * SIZE + 60]).toBe(0xff);
  });

  it("keeps an entry the author wrote as it is when the Editor's strokes miss it", async () => {
    const { workspace, blueprintPath } = await withWall();
    const raw = await read(blueprintPath);
    // Beside the wall, by hand, where it stands: sync would give a stroke there to the wall.
    raw.pathingPaint = [{ block: [[69, 60, 1, 1]] }];
    await writeFile(blueprintPath, JSON.stringify(raw, null, 2));
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
    const edited = await layer(outputDir);
    expect(edited[60 * SIZE + 69]).toBe(0xff);
    edited[100 * SIZE + 20] = 0xff;
    await writeFile(path.join(outputDir, "CellAttribute_Pnp"), writeCellAttribute(edited));
    await syncMission(workspace, blueprintPath, outputDir);
    expect((await read(blueprintPath)).pathingPaint).toEqual([{ block: [[69, 60, 1, 1]] }, { block: [[20, 100, 1, 1]] }]);
  });

  it("paints no doodad's pathing in a package written without its objects", async () => {
    const { workspace, blueprintPath } = await withWall();
    const outputDir = path.join(root!, "terrain-only.SC2Map");
    await generateTerrain(workspace, blueprintPath, outputDir);
    const cells = await readFile(path.join(outputDir, "CellAttribute_Pnp")).then((bytes) => readCellAttribute(bytes, SIZE, SIZE), () => new Uint8Array(SIZE * SIZE));
    expect(cells[60 * SIZE + 60]).toBe(0);
  });

  it("writes over a layer the Editor left blank where the last compile wrote none", async () => {
    const { workspace, blueprintPath } = await withWall();
    const walking = await read(blueprintPath);
    for (const anchor of walking.anchors) if (["temple_wall", "temple_columns_w", "temple_columns_e"].includes(anchor.id as string)) anchor.pathing = "walk";
    await writeFile(blueprintPath, JSON.stringify(walking, null, 2));
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
    await writeFile(path.join(outputDir, "CellAttribute_Pnp"), writeCellAttribute(new Uint8Array(SIZE * SIZE)));
    const raw = await read(blueprintPath);
    delete raw.anchors.find((anchor) => anchor.id === "temple_wall")!.pathing;
    await writeFile(blueprintPath, JSON.stringify(raw, null, 2));
    await compileMission(workspace, blueprintPath, undefined, { savedAt });
    expect((await layer(outputDir))[60 * SIZE + 60]).toBe(0xff);
  });

  it("reads nothing from a copy with no compile record and no layer, and no strokes from one painted as compiled", async () => {
    const { workspace, blueprintPath } = await withWall();
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
    const copy = path.join(root!, "copy.SC2Map");
    await cp(outputDir, copy, { recursive: true });
    const pathingOf = (result: Awaited<ReturnType<typeof syncMission>>) => result.changes.filter((change) => change.label === "Pathing paint changed");
    // As compiled: the nearest layer it could have been painted over is itself.
    expect(pathingOf(await syncMission(workspace, blueprintPath, copy))).toEqual([]);
    // No layer at all says nothing, rather than that everything was erased.
    await rm(path.join(copy, "CellAttribute_Pnp"));
    expect(pathingOf(await syncMission(workspace, blueprintPath, copy))).toEqual([]);
    expect((await read(blueprintPath)).pathingPaint).toBeUndefined();
  });
});
