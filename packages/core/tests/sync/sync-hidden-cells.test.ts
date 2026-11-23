// Hidden cells synced from the Editor (#598): t3CellFlags' hidden bit back into each Zone's
// hiddenCells, on a generated map and beside Kept ground, where sync brings back nothing else.
// Synthetic: the Ashen Crossing fixture, and the Kept ground fixture (tests/support/kept-ground.ts).
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { EditorChangesError } from "../../src/map/editor-changes.js";
import { loadWorkspace, type Workspace } from "../../src/plugins/workspace.js";
import { syncMission } from "../../src/sync/sync-mission.js";
import { syncHiddenCells } from "../../src/sync/sync-hidden-cells.js";
import { type KeptGroundFixture, keptGround, removeKeptGround } from "../support/kept-ground.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");

let root: string | undefined;
let fixture: KeptGroundFixture | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
  await removeKeptGround(fixture);
  fixture = undefined;
});

type Zone = Record<string, unknown> & { id: string; hiddenCells?: number[][] };
const zones = async (blueprintPath: string) => (JSON.parse(await readFile(blueprintPath, "utf8")) as { zones: Zone[] }).zones;
/** Hides cells in the package's t3CellFlags (`size` cells a side), as the Editor's Hide Terrain brush would. */
async function brush(mapDir: string, size: number, cells: readonly (readonly [number, number])[]): Promise<void> {
  const file = path.join(mapDir, "t3CellFlags");
  const bytes = await readFile(file);
  for (const [x, y] of cells) bytes[32 + y * size + x] = bytes[32 + y * size + x]! | 0x04;
  await writeFile(file, bytes);
}

describe("syncing hidden cells", { timeout: 120_000 }, () => {
  it("brings the Editor's hides on a generated map into the Zones holding them, and the compile is clean after", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-sync-hidden-"));
    const workspaceRoot = path.join(root, "workspace");
    await cp(CROSSING, workspaceRoot, { recursive: true });
    const workspace: Workspace = await loadWorkspace(workspaceRoot);
    const blueprintPath = path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json");
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
    await brush(outputDir, 128, [[12, 12], [13, 12], [12, 13], [13, 13], [60, 60]]);

    const stopped = await compileMission(workspace, blueprintPath, undefined, { savedAt }).catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(EditorChangesError);
    expect((stopped as Error).message).toContain("Run sync first");

    const synced = await syncMission(workspace, blueprintPath, outputDir);
    expect(synced.changes).toEqual([{ label: "Hidden cells changed", ids: ["surface", "landing_zone"] }]);
    const after = await zones(blueprintPath);
    expect(after.find((zone) => zone.id === "landing_zone")!.hiddenCells).toEqual([[12, 12, 2, 2]]);
    expect(after.find((zone) => zone.id === "surface")!.hiddenCells).toEqual([[60, 60, 1, 1]]);
    await compileMission(workspace, blueprintPath, undefined, { savedAt });
    expect((await syncMission(workspace, blueprintPath, outputDir)).changes).toEqual([]);
  });

  it("runs beside Kept ground, bringing back the hidden cells with the objects, and the compile is clean after", async () => {
    fixture = await keptGround();
    const raw = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as Record<string, unknown>;
    const square = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    raw.zones = [
      { id: "new_block", name: "New block", elevation: 2, landform: "flat", role: "path", terrain: "generate", texture: "MeinhoffConcrete", polygon: square(14, 56, 16, 16) },
      { id: "east_yard", name: "East yard", elevation: 1, landform: "flat", role: "path", terrain: "kept", polygon: square(30, 56, 12, 16) },
    ];
    await writeFile(fixture.blueprintPath, JSON.stringify(raw, null, 2));
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const before = await readFile(fixture.blueprintPath, "utf8");
    // One in the Zone, one in the Kept yard: Kept ground's own.
    await brush(fixture.mapPackage, 128, [[24, 64], [34, 60]]);

    const synced = await syncMission(fixture.workspace, fixture.blueprintPath, fixture.mapPackage);
    // The Kept doodads standing in the generating Zone are adopted as Anchors (#603) beside the hidden cells.
    expect(synced.changes.map((change) => change.label)).toEqual(["Doodads placed in the Editor on ground the compile writes, adopted as Anchors", "Hidden cells changed"]);
    expect(synced.changes).toContainEqual({ label: "Hidden cells changed", ids: ["new_block"] });
    const after = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as Record<string, unknown>;
    expect((after.zones as Zone[]).map((zone) => zone.hiddenCells)).toEqual([[[24, 64, 1, 1]], undefined]);
    // Nothing else in the Blueprint changed.
    expect({ ...after, zones: undefined, anchors: undefined }).toEqual({ ...(JSON.parse(before) as Record<string, unknown>), zones: undefined, anchors: undefined });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
  });

  it("files a hide on the Zone holding the cell's centre, where two Zones split a 2×2 cliff cell", () => {
    const rect = (x0: number, x1: number) => [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: 8 }, { x: x0, y: 8 }];
    const raw = { mapSize: { width: 16, height: 8 }, zones: [{ id: "a", terrain: "generate", polygon: rect(0, 5) }, { id: "b", terrain: "generate", polygon: rect(5, 16) }] };
    const flags = new Uint8Array(16 * 8).fill(0x02);
    flags[4 * 16 + 4] = 0x06;
    flags[4 * 16 + 5] = 0x06;
    const { blueprint } = syncHiddenCells(raw, flags);
    expect((blueprint.zones as Zone[]).map((zone) => zone.hiddenCells)).toEqual([[[4, 4, 1, 1]], [[5, 4, 1, 1]]]);
  });

  it("keeps a listed cell the compile doesn't write, and drops a hide the Editor took away", () => {
    const raw = {
      mapSize: { width: 4, height: 2 },
      zones: [
        { id: "a", terrain: "generate", polygon: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 0, y: 2 }], hiddenCells: [[0, 0, 1, 1], [2, 0, 1, 1]] },
        { id: "b", terrain: "kept", polygon: [{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 3, y: 2 }] },
      ],
    };
    // Zone a owns the 2×2 cell at (0, 0) alone; (2, 0) is in half a cliff cell, which the compile doesn't write.
    const flags = Uint8Array.from([0x02, 0x06, 0x02, 0x06, 0x02, 0x02, 0x02, 0x02]);
    const { blueprint, changed } = syncHiddenCells(raw, flags);
    expect(changed).toEqual(["a"]);
    expect((blueprint.zones as Zone[]).map((zone) => zone.hiddenCells)).toEqual([[[1, 0, 2, 1]], undefined]);
  });
});
