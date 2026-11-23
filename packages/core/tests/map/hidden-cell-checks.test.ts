// The checker's hidden cells (#599): a group of cells the package hides, on cells the compile
// writes the bit on, with no doodad near it (the sky may show), or that units can still walk on.
// Synthetic: the Ashen Crossing fixture compiled in place, its landing zone hiding (20, 20) and (21, 20).
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { writeKeptPathing } from "../../src/kept-terrain/pathing-brush.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { hiddenCellProblems } from "../../src/map/hidden-cell-checks.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");
const SIZE = 128;

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** The crossing compiled with the landing zone's hidden cells, and a doodad by them when `doodad`. */
async function compiled({ doodad = false } = {}) {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-hidden-checks-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const workspace = await loadWorkspace(workspaceRoot);
  const blueprintPath = path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json");
  const raw = JSON.parse(await readFile(blueprintPath, "utf8")) as { zones: Record<string, unknown>[]; anchors: Record<string, unknown>[] };
  raw.zones.find((zone) => zone.id === "landing_zone")!.hiddenCells = [[20, 20, 2, 1]];
  if (doodad) raw.anchors.push({ id: "under_hatch", name: "Under the hatch", zoneId: "landing_zone", kind: "doodad", doodadType: "RockGiant", position: { x: 21, y: 21.5 } });
  await writeFile(blueprintPath, JSON.stringify(raw, null, 2));
  const { outputDir, blueprint } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
  return { workspaceRoot, outputDir, blueprint };
}

describe("checking hidden cells", { timeout: 120_000 }, () => {
  it("warns of a hole with nothing under it that units can walk over", async () => {
    const { outputDir, blueprint } = await compiled();
    expect(await hiddenCellProblems(blueprint, outputDir)).toEqual([
      {
        path: "zones.1.hiddenCells",
        message: "2 hidden cells of landing_zone, the first at (20, 20), have no doodad under or beside them, so the sky may show through: put one below the ground (a wall doodad, as under a hatch), or show them again",
      },
      {
        path: "zones.1.hiddenCells",
        message:
          "2 hidden cells of landing_zone, the first at (20, 20), are all still pathable, since hiding isn't pathing: units can stand over the hole unless a doodad's footprint blocks it. Block them with a doodad's footprint or a pathing blocker, or leave them walkable on purpose",
      },
    ]);
  });

  it("is quiet once a doodad stands by the hole and its cells are painted unpathable, and check says so as warnings", async () => {
    const { workspaceRoot, outputDir, blueprint } = await compiled({ doodad: true });
    const painted = new Uint8Array(SIZE * SIZE);
    painted[20 * SIZE + 20] = 0xff;
    expect((await hiddenCellProblems(blueprint, outputDir)).map((problem) => problem.message)).toEqual([
      "2 hidden cells of landing_zone, the first at (20, 20), are all still pathable, since hiding isn't pathing: units can stand over the hole unless a doodad's footprint blocks it. Block them with a doodad's footprint or a pathing blocker, or leave them walkable on purpose",
    ]);
    await writeFile(path.join(outputDir, "CellAttribute_Pnp"), writeKeptPathing(painted)!);
    expect((await hiddenCellProblems(blueprint, outputDir)).map((problem) => problem.message)).toEqual([
      "2 hidden cells of landing_zone, the first at (20, 20), include 1 still pathable, since hiding isn't pathing: units can stand over the hole unless a doodad's footprint blocks it. Block it with a doodad's footprint or a pathing blocker, or leave it walkable on purpose",
    ]);
    const report = await checkWorkspace(workspaceRoot);
    expect(report.problems.filter((problem) => problem.path === "zones.1.hiddenCells").map((problem) => problem.severity)).toEqual(["warning"]);
  });
});
