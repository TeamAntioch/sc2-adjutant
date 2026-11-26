// A Mission compiled into a copy of its committed Map Package (compileMission's `copy`): the copy
// is merged by the committed record as an in-place compile is, keeping Kept Content, and the
// committed package and its record are left byte for byte.
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { parseCompileRecord } from "../../src/domain/compile-record.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { EditorChangesError } from "../../src/map/editor-changes.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { keptGround, type KeptGroundFixture, removeKeptGround } from "../support/kept-ground.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");
const KEPT = `    <ObjectDoodad Id="4444" Position="30,30,8" Rotation="0" Scale="1,1,1" Type="MeinhoffCraterLarge"/>`;

let root: string | undefined;
let ground: KeptGroundFixture | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  await removeKeptGround(ground);
  root = undefined;
  ground = undefined;
});

/** The crossing compiled in place, with a Kept doodad the author placed in the Editor. */
async function compiledCrossing() {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-copy-"));
  await cp(CROSSING, root, { recursive: true });
  const mission = path.join(root, "missions", "ashen-crossing");
  const blueprintPath = path.join(mission, "blueprint.json");
  const workspace = await loadWorkspace(root);
  const { outputDir: committed } = await compileMission(workspace, blueprintPath, undefined, { savedAt });
  const objects = path.join(committed, "Objects");
  await writeFile(objects, (await readFile(objects, "utf8")).replace("</PlacedObjects>", `${KEPT}\n</PlacedObjects>`));
  return { workspace, mission, blueprintPath, committed, copy: path.join(mission, "output", "1", "Ashen-Crossing-a-wider.SC2Map") };
}

async function readTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full).split(path.sep).join("/")] = (await readFile(full)).toString("latin1");
  }
  return out;
}

/** The committed package and record, everything in the Mission's folder but its output/. */
async function committedFiles(mission: string): Promise<Record<string, string>> {
  return Object.fromEntries(Object.entries(await readTree(mission)).filter(([file]) => !file.startsWith("output/")));
}

async function editBlueprint(blueprintPath: string, change: (blueprint: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  await writeFile(blueprintPath, `${JSON.stringify(change(JSON.parse(await readFile(blueprintPath, "utf8"))), null, 2)}\n`);
}

describe("compiling a Mission into a copy", () => {
  it("keeps the committed package's Kept Content in the copy, and changes no byte of the committed package or its record", async () => {
    const { workspace, mission, blueprintPath, copy } = await compiledCrossing();
    const before = await committedFiles(mission);
    await editBlueprint(blueprintPath, (blueprint) => ({ ...blueprint, title: "Ashen Crossing, wider" }));
    const committedBlueprint = await readFile(blueprintPath, "utf8");

    const { outputDir } = await compileMission(workspace, blueprintPath, copy, { savedAt, copy: true });

    expect(outputDir).toBe(copy);
    expect(await readFile(path.join(copy, "Objects"), "utf8")).toContain(KEPT);
    expect(await readFile(path.join(copy, "enUS.SC2Data", "LocalizedData", "GameStrings.txt"), "utf8")).toContain("Ashen Crossing, wider");
    expect(await committedFiles(mission)).toEqual({ ...before, "blueprint.json": committedBlueprint });
    // The copy's own record, beside it, lists what this compile wrote there.
    const record = parseCompileRecord(await readFile(path.join(path.dirname(copy), "Ashen-Crossing-a-wider.compile-record.json"), "utf8"));
    expect(record.entries.some((entry) => entry.kind === "object")).toBe(true);
  }, 60_000);

  it("stops on Compiled Content the Editor changed in the committed package, and takes the author's keep or discard for the copy alone", async () => {
    const { workspace, mission, blueprintPath, committed, copy } = await compiledCrossing();
    const objects = path.join(committed, "Objects");
    const turned = (await readFile(objects, "utf8")).replace(/(<ObjectDoodad Id="\d+"[^>]*Rotation=")[^"]*"/, (_, head: string) => `${head}1.234"`);
    const id = /<ObjectDoodad Id="(\d+)"[^>]*Rotation="1.234"/.exec(turned)![1]!;
    await writeFile(objects, turned);
    const before = await committedFiles(mission);

    const stopped = await compileMission(workspace, blueprintPath, copy, { savedAt, copy: true }).catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(EditorChangesError);
    expect((stopped as EditorChangesError).changes.map((change) => change.name)).toContain(`object:${id}`);

    await compileMission(workspace, blueprintPath, copy, { savedAt, copy: true, decisions: { keep: [`object:${id}`] } });
    expect(await readFile(path.join(copy, "Objects"), "utf8")).toMatch(new RegExp(`<ObjectDoodad Id="${id}"[^>]*Rotation="1.234"`));
    const record = parseCompileRecord(await readFile(path.join(path.dirname(copy), "Ashen-Crossing-a-wider.compile-record.json"), "utf8"));
    expect(record.entries.some((entry) => entry.kind === "object" && entry.id === Number(id))).toBe(false);
    expect(await committedFiles(mission)).toEqual(before);
  }, 60_000);

  it("compiles a Mission with Kept terrain and Kept References, which a compile into another folder refuses", async () => {
    ground = await keptGround();
    const { workspace, blueprintPath, missionDir } = ground;
    await editBlueprint(blueprintPath, (blueprint) => ({ ...blueprint, kept: [{ id: "well", kind: "point", editorId: 900002, name: "Well" }] }));
    const before = await committedFiles(missionDir);
    const copy = path.join(missionDir, "output", "1", "Quarry-a-well.SC2Map");

    await expect(compileMission(workspace, blueprintPath, path.join(missionDir, "output", "whole", "Quarry.SC2Map"), { savedAt })).rejects.toThrow(/has Kept terrain|every terrain cell is Kept Content/);
    await compileMission(workspace, blueprintPath, copy, { savedAt, copy: true });

    for (const file of ["t3HeightMap", "t3VertCol", "CellAttribute_Pnp", "MapInfo"]) {
      expect(await readFile(path.join(copy, file))).toEqual(await readFile(path.join(ground.mapPackage, file)));
    }
    expect(await readFile(path.join(copy, "Objects"), "utf8")).toContain('Id="900002"');
    expect(await committedFiles(missionDir)).toEqual(before);
  }, 120_000);

  it("replaces an earlier copy of the same Mission with a fresh one", async () => {
    const { workspace, blueprintPath, copy } = await compiledCrossing();
    await compileMission(workspace, blueprintPath, copy, { savedAt, copy: true });
    await writeFile(path.join(copy, "Leftover.txt"), "changed in the copy");

    await compileMission(workspace, blueprintPath, copy, { savedAt, copy: true });
    expect(await readdir(copy)).not.toContain("Leftover.txt");
    expect(await readFile(path.join(copy, "Objects"), "utf8")).toContain(KEPT);
  }, 60_000);

  it("refuses a folder that holds anything but a copy of the same Mission, the committed package, and a folder beside the Blueprint", async () => {
    const { workspace, mission, blueprintPath, committed, copy } = await compiledCrossing();
    const before = await committedFiles(mission);
    await mkdir(copy, { recursive: true });
    await writeFile(path.join(copy, "notes.txt"), "the author's");
    await expect(compileMission(workspace, blueprintPath, copy, { savedAt, copy: true })).rejects.toThrow(/holds something that isn't a copy/);
    expect(await readdir(copy)).toEqual(["notes.txt"]);

    await writeFile(path.join(path.dirname(copy), "Ashen-Crossing-a-wider.copy.json"), JSON.stringify({ mission: "another-mission" }));
    await expect(compileMission(workspace, blueprintPath, copy, { savedAt, copy: true })).rejects.toThrow(/is a copy of the Mission another-mission/);

    await expect(compileMission(workspace, blueprintPath, committed, { savedAt, copy: true })).rejects.toThrow(/committed Map Package, or inside it/);
    await expect(compileMission(workspace, blueprintPath, path.join(mission, "Second.SC2Map"), { savedAt, copy: true })).rejects.toThrow(/beside .* Blueprint/);
    await expect(compileMission(workspace, blueprintPath, undefined, { savedAt, copy: true })).rejects.toThrow(/needs the folder to copy it to/);
    expect(await committedFiles(mission)).toEqual(before);
  }, 60_000);
});
