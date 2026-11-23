// Height brushes on Kept ground (spec #247): raise, lower, flatten and smooth an area of a
// Mission's own Map Package. The package is synthetic (tests/support/kept-ground.ts): the crossing
// fixture imported, with the Editor's own height quantization and walking heights at cliff vertices.
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { bareHost } from "../../src/host/host.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { readObjectsXml } from "../../src/map/read-objects-xml.js";
import { editKeptTerrain, type HeightBrush } from "../../src/map/edit-kept-terrain.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { readT3HeightMap } from "../../src/terrain/read-t3-height-map.js";
import { readT3TerrainXml } from "../../src/terrain/read-t3-terrain-xml.js";
import { connect, text } from "../mcp/harness.js";
import { BENCH_ID, EDITOR_BIAS, EDITOR_SCALE, type KeptGroundFixture, keptGround, removeKeptGround, WELL } from "../support/kept-ground.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const SIZE = 128;
const COLUMNS = SIZE + 1;

let fixture: KeptGroundFixture | undefined;
let other: string | undefined;
afterEach(async () => {
  await removeKeptGround(fixture);
  fixture = undefined;
  if (other) await rm(other, { recursive: true, force: true });
  other = undefined;
});

async function hashTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full)] = createHash("sha256").update(await readFile(full)).digest("hex");
  }
  return out;
}

type Ground = { raw: Buffer; sync: Buffer; heights: Float32Array };
async function ground(mapPackage: string): Promise<Ground> {
  const raw = await readFile(path.join(mapPackage, "t3HeightMap"));
  const terrain = readT3TerrainXml(await readFile(path.join(mapPackage, "t3Terrain.xml"), "utf8"));
  expect([terrain.quantizeBias, terrain.quantizeScale]).toEqual([EDITOR_BIAS, EDITOR_SCALE]);
  return { raw, sync: await readFile(path.join(mapPackage, "t3SyncHeightMap")), heights: readT3HeightMap(raw, terrain).heights };
}
const syncAt = (g: Ground, v: number) => g.sync.readInt16LE(64 + v * 4);
/** How far the sync height sits from the render height at each vertex, in sync units (1/256). */
const offsets = (g: Ground) => Array.from(g.heights, (h, v) => syncAt(g, v) - Math.round(h * 256));
/** The cells with a corner changed in either height map. */
function changedCells(before: Ground, after: Ground): { x: number; y: number }[] {
  const changed = new Uint8Array(COLUMNS * COLUMNS);
  for (let v = 0; v < changed.length; v++) {
    if (!before.raw.subarray(32 + v * 6, 38 + v * 6).equals(after.raw.subarray(32 + v * 6, 38 + v * 6))) changed[v] = 1;
    if (!before.sync.subarray(64 + v * 4, 68 + v * 4).equals(after.sync.subarray(64 + v * 4, 68 + v * 4))) changed[v] = 1;
  }
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if ([y * COLUMNS + x, y * COLUMNS + x + 1, (y + 1) * COLUMNS + x, (y + 1) * COLUMNS + x + 1].some((v) => changed[v])) cells.push({ x, y });
  return cells;
}
const corners = (x0: number, y0: number, w: number, h: number) => Array.from({ length: (w + 1) * (h + 1) }, (_, i) => (y0 + Math.floor(i / (w + 1))) * COLUMNS + x0 + (i % (w + 1)));

// Across the level-3 crag's south-west corner: cliff vertices, walking heights, both levels.
const CRAG_EDGE = { rect: { x: 34, y: 22, width: 10, height: 10 } };
// Open level-1 ground round the Well.
const YARD = { rect: { x: 16, y: 60, width: 8, height: 8 } };

describe("editKeptTerrain's height brushes", () => {
  const brushes: HeightBrush[] = [{ op: "raise", by: 0.5 }, { op: "lower", by: 0.5 }, { op: "flatten" }, { op: "flatten", to: 8.5 }, { op: "flatten", to: { at: "Well" } }, { op: "smooth" }];
  it.each(brushes.map((brush) => [JSON.stringify(brush), brush] as const))(
    "%s changes only cells in the area plus its falloff, only the height maps, and keeps them in agreement",
    async (_, brush) => {
      fixture = await keptGround();
      const before = await hashTree(fixture.mapPackage);
      const groundBefore = await ground(fixture.mapPackage);
      const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: CRAG_EDGE, brush }, { leaveDoodads: true, name: "test" });
      const after = await hashTree(fixture.mapPackage);
      const groundAfter = await ground(fixture.mapPackage);

      expect(Object.keys(after).filter((file) => after[file] !== before[file])).toEqual(["t3HeightMap", "t3SyncHeightMap"]);
      expect(result.files).toEqual(["t3HeightMap", "t3SyncHeightMap"]);
      const cells = changedCells(groundBefore, groundAfter);
      expect(cells.length).toBeGreaterThan(50);
      expect(result.cells).toBe(cells.length);
      // A soft falloff is 3 cells; heights are on corners, so one cell more.
      for (const { x, y } of cells) {
        expect(x).toBeGreaterThanOrEqual(34 - 4);
        expect(x).toBeLessThan(44 + 4);
        expect(y).toBeGreaterThanOrEqual(22 - 4);
        expect(y).toBeLessThan(32 + 4);
      }
      // The cliff layer and cliff level of every vertex are as they were, and so is each sync cliff level.
      for (let v = 0; v < COLUMNS * COLUMNS; v++) {
        expect(groundAfter.raw.readUInt32LE(34 + v * 6)).toBe(groundBefore.raw.readUInt32LE(34 + v * 6));
        expect(groundAfter.sync.readUInt16LE(66 + v * 4)).toBe(groundBefore.sync.readUInt16LE(66 + v * 4));
      }
      // Render and sync agree everywhere: where they matched they still do, and walking heights keep their offset.
      expect(offsets(groundAfter)).toEqual(offsets(groundBefore));
      expect(offsets(groundBefore).some((offset) => offset > 200)).toBe(true);
    },
    60_000,
  );

  it("raises and lowers the area by the amount given, fading out over the falloff", async () => {
    fixture = await keptGround();
    const before = await ground(fixture.mapPackage);
    const raised = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise", by: 0.6 } }, { leaveDoodads: true });
    expect(raised.files).toEqual(["t3HeightMap", "t3SyncHeightMap"]);
    const after = await ground(fixture.mapPackage);
    for (const v of corners(16, 60, 8, 8)) expect(after.heights[v]! - before.heights[v]!).toBeCloseTo(0.6, 3);
    const ring = 63 * COLUMNS + 26; // two vertices east of the area
    expect(after.heights[ring]! - before.heights[ring]!).toBeGreaterThan(0.1);
    expect(after.heights[ring]! - before.heights[ring]!).toBeLessThan(0.5);
    expect(after.heights[63 * COLUMNS + 28]).toBe(before.heights[63 * COLUMNS + 28]);
    expect(raised.change.max).toBeCloseTo(0.6, 3);
    expect(raised.change.min).toBeGreaterThan(0);
    expect(raised.summary).toMatch(/^Raised the 8×8 cells at \(16, 60\) by 0\.6: \d+ cells changed, by 0\.0\d* to 0\.6/);

    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: { ...YARD, falloff: "sharp" }, brush: { op: "lower", by: 0.5 } }, { leaveDoodads: true });
    const lowered = await ground(fixture.mapPackage);
    for (const v of corners(16, 60, 8, 8)) expect(lowered.heights[v]! - before.heights[v]!).toBeCloseTo(0.1, 3);
    expect(lowered.heights[ring]).toBe(after.heights[ring]);
  }, 60_000);

  it("widens the height map's quantization, as the Editor does, when the new heights need more range", async () => {
    fixture = await keptGround();
    const before = await ground(fixture.mapPackage);
    const xml = await readFile(path.join(fixture.mapPackage, "t3Terrain.xml"), "utf8");
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise", by: 3 } }, { leaveDoodads: true });
    expect(result.files).toEqual(["t3HeightMap", "t3SyncHeightMap", "t3Terrain.xml"]);
    expect(result.warnings[0]).toMatch(/^The new heights need more range than t3HeightMap's quantization gives \(bias 9\.003, scale 2\.746134e-4\), so it was widened to bias 9\.003, scale \d\.\d{6}e-4, as the Editor does/);
    expect((await readdir(fixture.mapPackage)).filter((file) => file.endsWith(".edit-pending"))).toEqual([]);
    // Only <vertData> changes in t3Terrain.xml, and the reader takes the new quantization from it.
    const newXml = await readFile(path.join(fixture.mapPackage, "t3Terrain.xml"), "utf8");
    const vertData = /<vertData [^>]*>/;
    expect(newXml.replace(vertData, "")).toBe(xml.replace(vertData, ""));
    expect(vertData.exec(newXml)![0]).toMatch(/^<vertData quantizeBias="9\.002548e\+00" quantizeScale="\d\.\d{6}e-04" standardHeight="8\.000000e\+00" name="t3HeightMap"\/>$/);
    const raw = await readFile(path.join(fixture.mapPackage, "t3HeightMap"));
    const after = { raw, sync: await readFile(path.join(fixture.mapPackage, "t3SyncHeightMap")), heights: readT3HeightMap(raw, readT3TerrainXml(newXml)).heights };
    for (const v of corners(16, 60, 8, 8)) expect(after.heights[v]! - before.heights[v]!).toBeCloseTo(3, 3);
    // Elsewhere every height stays within a step of the new quantization, and its sync height as it was.
    for (let v = 0; v < COLUMNS * COLUMNS; v++) {
      const x = v % COLUMNS;
      const y = Math.floor(v / COLUMNS);
      if (x >= 12 && x <= 28 && y >= 56 && y <= 72) continue;
      expect(Math.abs(after.heights[v]! - before.heights[v]!)).toBeLessThan(0.001);
      expect(syncAt(after, v)).toBe(syncAt(before, v));
      expect(raw.readUInt16LE(36 + v * 6)).toBe(before.raw.readUInt16LE(36 + v * 6));
    }
  }, 60_000);

  it("says a dry run's widening would happen, and refuses a widening that would rewrite cells the compile record lists", async () => {
    fixture = await keptGround();
    const dry = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise", by: 3 } }, { dryRun: true, leaveDoodads: true });
    expect(dry.warnings[0]).toContain("so it would be widened to bias");
    expect(dry.warnings[0]).toContain("every vertex of t3HeightMap would be rewritten");
    await writeFile(path.join(fixture.missionDir, "compile-record.json"), JSON.stringify({ version: 1, entries: [{ kind: "terrain-cells", file: "t3HeightMap", cells: [[100, 100, 2, 2]], fingerprint: "0123456789abcdef" }] }));
    const before = await hashTree(fixture.mapPackage);
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise", by: 3 } })).rejects.toThrow(
      "The new heights need more range than t3HeightMap's quantization gives, and widening it rewrites every vertex, including cells the compile record lists in t3HeightMap (Compiled Content): ask for a smaller change. Nothing was written",
    );
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
  }, 60_000);

  it("flattens to the area's mean, a height or the height at a point", async () => {
    fixture = await keptGround();
    const before = await ground(fixture.mapPackage);
    const inside = corners(16, 60, 8, 8);
    const mean = inside.reduce((sum, v) => sum + before.heights[v]!, 0) / inside.length;
    const flat = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "flatten" } }, { leaveDoodads: true });
    let after = await ground(fixture.mapPackage);
    for (const v of inside) expect(after.heights[v]).toBeCloseTo(mean, 3);
    expect(flat.summary).toContain(`Flattened the 8×8 cells at (16, 60) to ${mean.toFixed(2)} (their mean)`);

    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "flatten", to: 8.5 } }, { leaveDoodads: true });
    after = await ground(fixture.mapPackage);
    for (const v of inside) expect(after.heights[v]).toBeCloseTo(8.5, 3);

    fixture = (await removeKeptGround(fixture), await keptGround());
    const well = before.heights[WELL.y * COLUMNS + WELL.x]!;
    const atWell = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "flatten", to: { at: "Well" } } }, { leaveDoodads: true });
    after = await ground(fixture.mapPackage);
    for (const v of inside) expect(after.heights[v]).toBeCloseTo(well, 3);
    expect(atWell.summary).toContain(`to ${well.toFixed(2)} (the height at point 900002 (Well))`);
  }, 60_000);

  it("smooths the area's bumps", async () => {
    fixture = await keptGround();
    // The generator's ground rolls gently, so the yard gets a bump to smooth: a sharp-edged step in its middle.
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: { rect: { x: 19, y: 63, width: 2, height: 2 }, falloff: "sharp" }, brush: { op: "raise", by: 0.6 } }, { leaveDoodads: true });
    const before = await ground(fixture.mapPackage);
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "smooth" } }, { leaveDoodads: true });
    const after = await ground(fixture.mapPackage);
    const spread = (g: Ground) => {
      const hs = corners(18, 62, 4, 4).map((v) => g.heights[v]!);
      const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
      return hs.reduce((sum, h) => sum + (h - mean) ** 2, 0) / hs.length;
    };
    expect(spread(before)).toBeGreaterThan(0.005);
    expect(spread(after)).toBeLessThan(spread(before) / 3);
  }, 60_000);
});

describe("doodads on edited ground", () => {
  it("move by the height change at their position, keeping their height above the ground; --leave-doodads leaves them", async () => {
    fixture = await keptGround();
    const benchOf = async () => readObjectsXml(await readFile(path.join(fixture!.mapPackage, "Objects"), "utf8")).doodads.find((doodad) => doodad.id === BENCH_ID)!;
    const before = await ground(fixture.mapPackage);
    const bench = await benchOf();
    const groundAt = (g: Ground) => g.heights[bench.position.y * COLUMNS + bench.position.x]!;
    expect(bench.position.z - groundAt(before)).toBeCloseTo(0, 3);

    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: { point: "Well", radius: 4 }, brush: { op: "lower", by: 2 } });
    const after = await ground(fixture.mapPackage);
    const moved = await benchOf();
    expect(groundAt(after)).toBeCloseTo(groundAt(before) - 2, 3);
    expect(moved.position.z - groundAt(after)).toBeCloseTo(bench.position.z - groundAt(before), 3);
    expect(moved.flags).toEqual(["HeightAbsolute"]);
    expect(result.files).toEqual(["t3HeightMap", "t3SyncHeightMap", "Objects"]);
    expect(result.doodads).toContainEqual({ id: BENCH_ID, type: "Bench", by: expect.closeTo(-2, 3) });
    expect(result.summary).toContain(`${result.doodads.length} doodad${result.doodads.length === 1 ? "" : "s"} moved with the ground`);

    const objects = await readFile(path.join(fixture.mapPackage, "Objects"), "utf8");
    const left = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: { point: "Well", radius: 4 }, brush: { op: "raise", by: 2 } }, { leaveDoodads: true });
    expect(await readFile(path.join(fixture.mapPackage, "Objects"), "utf8")).toBe(objects);
    expect(left.doodads).toEqual([]);
    expect(left.warnings).toContainEqual(expect.stringContaining(`doodad ${BENCH_ID} (Bench) left at its height`));
  }, 60_000);
});

describe("doodads with a height offset", () => {
  it("move with HeightAbsolute as well, whose z is absolute", async () => {
    fixture = await keptGround();
    const file = path.join(fixture.mapPackage, "Objects");
    await writeFile(file, (await readFile(file, "utf8")).replace(/(Type="Bench">(\r?\n))/, '$1        <Flag Index="HeightOffset" Value="1"/>$2'));
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: { point: "Well", radius: 4 }, brush: { op: "lower", by: 1 } });
    expect(result.doodads).toContainEqual({ id: BENCH_ID, type: "Bench", by: expect.closeTo(-1, 3) });
  }, 60_000);

  it("stay as they are without HeightAbsolute, since their height is above the ground", async () => {
    fixture = await keptGround();
    const file = path.join(fixture.mapPackage, "Objects");
    const objects = (await readFile(file, "utf8")).replace(/(Type="Bench">\s*<Flag Index=")HeightAbsolute/, "$1HeightOffset");
    await writeFile(file, objects);
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: { point: "Well", radius: 4 }, brush: { op: "lower", by: 1 } });
    expect(result.doodads.map((doodad) => doodad.id)).not.toContain(BENCH_ID);
    expect(readObjectsXml(await readFile(file, "utf8")).doodads.find((doodad) => doodad.id === BENCH_ID)).toEqual(readObjectsXml(objects).doodads.find((doodad) => doodad.id === BENCH_ID));
  }, 60_000);
});

describe("renders", () => {
  it("writes the area, before, after and difference renders into the Mission's git-ignored renders/", async () => {
    fixture = await keptGround();
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "flatten" } }, { name: "yard-flat" });
    const dir = path.join(fixture.missionDir, "renders", "yard-flat");
    expect(result.renders).toEqual({ area: path.join(dir, "area.png"), before: path.join(dir, "before.png"), after: path.join(dir, "after.png"), difference: path.join(dir, "difference.png") });
    for (const file of Object.values(result.renders)) expect((await readFile(file)).subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(await readFile(path.join(fixture.missionDir, "renders", ".gitignore"), "utf8")).toBe("*\n");
  }, 60_000);

  it("on a dry run, renders the area and the change and writes nothing to the package", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise", by: 1 } }, { dryRun: true, name: "look" });
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
    expect(result.files).toEqual([]);
    expect(result.cells).toBeGreaterThan(64);
    expect(existsSync(result.renders.area)).toBe(true);
    expect(result.summary).toMatch(/^Would raise /);
  }, 60_000);
  it("leaves no renders, and the package as it was, when a file can't be written", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    await mkdir(path.join(fixture.mapPackage, "t3SyncHeightMap.edit-pending"));
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise", by: 1 } }, { name: "failed" })).rejects.toThrow(/^Not edited: /);
    await rm(path.join(fixture.mapPackage, "t3SyncHeightMap.edit-pending"), { recursive: true });
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
    expect(existsSync(path.join(fixture.missionDir, "renders", "failed"))).toBe(false);
  }, 60_000);
});

describe("a package with fewer files", () => {
  it("still edits and renders without Objects, Regions, t3TextureMasks or t3CellFlags", async () => {
    fixture = await keptGround();
    for (const file of ["Objects", "Regions", "t3TextureMasks", "t3CellFlags"]) await rm(path.join(fixture.mapPackage, file));
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "lower", by: 0.5 } }, { name: "bare" });
    expect(result.files).toEqual(["t3HeightMap", "t3SyncHeightMap"]);
    expect(existsSync(result.renders.area)).toBe(true);
  }, 60_000);
});

describe("refusals", () => {
  it("refuses Compiled cells, naming the Zone in the Blueprint", async () => {
    other = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-kept-terrain-"));
    await cp(CROSSING, other, { recursive: true });
    const blueprintPath = path.join(other, "missions", "ashen-crossing", "blueprint.json");
    const workspace = await loadWorkspace(other);
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt: new Date("2026-01-01T00:00:00Z") });
    const before = await hashTree(outputDir);
    const zones = JSON.parse(await readFile(blueprintPath, "utf8")).zones as { id: string }[];
    await expect(editKeptTerrain(workspace, blueprintPath, { area: { rect: { x: 104, y: 84, width: 4, height: 4 } }, brush: { op: "raise", by: 1 } })).rejects.toThrow(
      `The terrain there is Compiled Content (t3HeightMap is on the compile record): change zones.${zones.findIndex((zone) => zone.id === "temple_gate")} (temple_gate)'s elevation or ground in the Blueprint instead. Nothing was written`,
    );
    expect(await hashTree(outputDir)).toEqual(before);
  }, 60_000);

  it("refuses cells the compile record lists, and leaves the rest of the map editable", async () => {
    fixture = await keptGround();
    const record = path.join(fixture.missionDir, "compile-record.json");
    await writeFile(record, JSON.stringify({ version: 1, entries: [{ kind: "terrain-cells", file: "t3HeightMap", cells: [[18, 62, 2, 2]], fingerprint: "0123456789abcdef" }] }));
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise", by: 1 } })).rejects.toThrow(
      "4 cells in the area are Compiled Content (t3HeightMap, on the compile record), the first at (18, 62): change the Blueprint, whose compile writes them, instead. Nothing was written",
    );
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: CRAG_EDGE, brush: { op: "raise", by: 0.5 } })).resolves.toBeDefined();
  }, 60_000);

  it("refuses while the Editor has the map open, writing nothing", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    const host = {
      ...bareHost(),
      has: (name: string) => name === "editor.checkClosed",
      run: (async () => {
        throw new Error("the Editor has Quarry.SC2Map open; close it there without saving first");
      }) as unknown as ReturnType<typeof bareHost>["run"],
    };
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise", by: 1 } }, { host })).rejects.toThrow(
      "Not edited: the Editor has Quarry.SC2Map open; close it there without saving first",
    );
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
    // No renders of a change it didn't make.
    expect(existsSync(path.join(fixture.missionDir, "renders"))).toBe(false);
  }, 60_000);
});

describe("the edit_kept_terrain MCP tool", () => {
  it("edits the ground and reports the change and the renders", async () => {
    fixture = await keptGround();
    const reply = await (await connect(fixture.root)).callTool({ name: "edit_kept_terrain", arguments: { mission: "quarry", area: YARD, brush: { op: "raise", by: 1 }, name: "mcp" } });
    expect(reply.isError).toBeFalsy();
    const structured = reply.structuredContent as { cells: number; files: string[]; renders: Record<string, string> };
    expect(structured.files.slice(0, 2)).toEqual(["t3HeightMap", "t3SyncHeightMap"]);
    expect(structured.cells).toBeGreaterThan(64);
    expect(structured.renders.difference).toBe("missions/quarry/renders/mcp/difference.png");
    expect(text(reply)).toMatch(/^Raised the 8×8 cells at \(16, 60\) by 1/);
    expect(text(reply)).toContain("Renders: missions/quarry/renders/mcp/");
  }, 60_000);

  it("replies with a refusal, writing nothing", async () => {
    fixture = await keptGround();
    const reply = await (await connect(fixture.root)).callTool({ name: "edit_kept_terrain", arguments: { mission: "quarry", area: { region: "Nowhere" }, brush: { op: "smooth" } } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain('the package has no region named "Nowhere"');
  }, 60_000);
});
