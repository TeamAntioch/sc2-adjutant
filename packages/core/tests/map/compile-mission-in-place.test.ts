// A Mission compiles into its committed Map Package, beside its Blueprint, and keeps its compile
// record there as compile-record.json (ADR-0010).
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { parseCompileRecord } from "../../src/domain/compile-record.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { missionMapPackage } from "../../src/map/mission-package.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function crossing() {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-in-place-"));
  await cp(CROSSING, root, { recursive: true });
  const mission = path.join(root, "missions", "ashen-crossing");
  return { workspace: await loadWorkspace(root), mission, blueprintPath: path.join(mission, "blueprint.json") };
}

async function readTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full)] = (await readFile(full)).toString("latin1");
  }
  return out;
}

describe("compiling a Mission in place", () => {
  it("writes <Name>.SC2Map and compile-record.json beside the Blueprint, named from the Mission's folder", async () => {
    const { workspace, mission, blueprintPath } = await crossing();
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });

    expect(outputDir).toBe(path.join(mission, "Ashen-Crossing.SC2Map"));
    expect(await readdir(outputDir)).toContain("Objects");
    const record = parseCompileRecord(await readFile(path.join(mission, "compile-record.json"), "utf8"));
    expect(record.entries.some((entry) => entry.kind === "object")).toBe(true);
  }, 30_000);

  it("compiles into the package already beside the Blueprint, whatever its name", async () => {
    const { workspace, mission, blueprintPath } = await crossing();
    await compileMission(workspace, blueprintPath, path.join(mission, "Ashen 1-1.SC2Map"), { savedAt });
    expect(await missionMapPackage(blueprintPath)).toBe(path.join(mission, "Ashen 1-1.SC2Map"));
  }, 30_000);

  it("keeps Kept Content on the next compile, and a second compile changes no byte, record and all", async () => {
    const { workspace, mission, blueprintPath } = await crossing();
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
    const objects = path.join(outputDir, "Objects");
    const kept = `    <ObjectDoodad Id="4444" Position="30,30,8" Rotation="0" Scale="1,1,1" Type="MeinhoffCraterLarge"/>`;
    await writeFile(objects, (await readFile(objects, "utf8")).replace("</PlacedObjects>", `${kept}\n</PlacedObjects>`));
    const before = await readTree(mission);

    await compileMission(workspace, blueprintPath, undefined, { savedAt });
    expect(await readTree(mission)).toEqual(before);
    expect(await readFile(objects, "utf8")).toContain(kept);
  }, 30_000);

  it("compiles elsewhere whole and leaves the Mission's record alone", async () => {
    const { workspace, mission, blueprintPath } = await crossing();
    const elsewhere = path.join(root!, "build", "Copy.SC2Map");
    await compileMission(workspace, blueprintPath, elsewhere, { savedAt });
    expect(await readdir(elsewhere)).toContain("Objects");
    expect(await readdir(mission)).not.toContain("compile-record.json");
  }, 30_000);
});
