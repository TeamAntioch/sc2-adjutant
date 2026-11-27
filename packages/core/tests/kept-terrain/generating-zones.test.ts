// Generating Zones beside Kept ground (spec #247, ticket #252): a Zone flagged `terrain: "generate"`
// owns its cells and the compile writes only those, meeting the Kept ground round it at a seam; a
// Zone flagged `kept` is an area only. The package is synthetic (tests/support/kept-ground.ts): the
// crossing fixture imported, every cell Kept, with the Editor's quantization, walking heights, a
// shadow bake and a Kept Bench on open level-1 ground at (22, 64).
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { readCompileRecord } from "../../src/map/mission-package.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { EditorChangesError } from "../../src/map/editor-changes.js";
import { readObjectsXml } from "../../src/map/read-objects-xml.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { validateMissionBlueprint } from "../../src/plugins/workspace.js";
import { editKeptTerrain } from "../../src/map/edit-kept-terrain.js";
import { readKeptCliffs } from "../../src/kept-terrain/kept-cliffs.js";
import { readKeptGround } from "../../src/kept-terrain/kept-ground.js";
import { vertexHeightAt } from "../../src/study/terrain-grid.js";
import { readKeptTextures } from "../../src/kept-terrain/paint-brushes.js";
import { generateBesideKept, terrainCellsFingerprint } from "../../src/kept-terrain/generating-zones.js";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { writeT3TextureMasks } from "../../src/terrain/write-t3-texture-masks.js";
import { readT3TextureMasks } from "../../src/terrain/read-t3-texture-masks.js";
import { BENCH_ID, type KeptGroundFixture, keptGround, removeKeptGround, WELL } from "../support/kept-ground.js";

const SIZE = 128;
const COLUMNS = SIZE + 1;
const savedAt = new Date("2026-01-01T00:00:00Z");

let fixture: KeptGroundFixture | undefined;
afterEach(async () => {
  await removeKeptGround(fixture);
  fixture = undefined;
});

/** The new block: 16×16 cells round the Kept Bench, on the cliff grid. */
const BLOCK = { x: 14, y: 56, width: 16, height: 16 };
const square = ({ x, y, width, height }: typeof BLOCK) => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];
const inBlock = (x: number, y: number) => x >= BLOCK.x && x < BLOCK.x + BLOCK.width && y >= BLOCK.y && y < BLOCK.y + BLOCK.height;

type ZoneFields = { elevation?: number; texture?: string; cliff?: string; connections?: unknown[]; terrain?: "generate" | "kept"; hiddenCells?: number[][] };
/** The Mission's Blueprint with a generating Zone over BLOCK and a Kept Zone east of it, which a Connection crosses into. */
async function withZones(fixture: KeptGroundFixture, zone: ZoneFields = {}, extra: Record<string, unknown> = {}): Promise<void> {
  const blueprint = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as Record<string, unknown>;
  const zones = [
    {
      id: "new_block",
      name: "New block",
      elevation: 1,
      landform: "flat",
      role: "path",
      terrain: "generate",
      texture: "MeinhoffConcrete",
      polygon: square(BLOCK),
      connections: [{ toZoneId: "east_yard", type: "open", at: { x: 30, y: 64 } }],
      ...zone,
    },
    { id: "east_yard", name: "East yard", elevation: 1, landform: "flat", role: "path", terrain: "kept", polygon: square({ x: 30, y: 56, width: 12, height: 16 }) },
  ];
  await writeFile(fixture.blueprintPath, JSON.stringify({ ...blueprint, zones, ...extra }, null, 2));
}

type Files = Record<string, Buffer>;
const TERRAIN = ["t3HeightMap", "t3SyncHeightMap", "t3SyncCliffLevel", "t3CellFlags", "t3TextureMasks", "t3SyncTextureInfo", "t3Terrain.xml"];
async function files(dir: string): Promise<Files> {
  const out: Files = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full)] = await readFile(full);
  }
  return out;
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Every cell outside BLOCK as `before` has it, in every terrain file: its corners, its own values, its texels and its cliff cell. */
async function expectKeptCellsUnchanged(before: Files, after: Files, beforeDir: string, afterDir: string): Promise<void> {
  const keptVertex = (v: number) => {
    const x = v % COLUMNS;
    const y = Math.floor(v / COLUMNS);
    // A vertex is a corner of a Kept cell unless all four cells round it are in the block.
    return ![[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]].every(([cx, cy]) => inBlock(cx!, cy!));
  };
  for (let v = 0; v < COLUMNS * COLUMNS; v++) {
    if (!keptVertex(v)) continue;
    expect(after["t3HeightMap"]!.subarray(32 + v * 6, 38 + v * 6).equals(before["t3HeightMap"]!.subarray(32 + v * 6, 38 + v * 6)), `t3HeightMap vertex ${v}`).toBe(true);
    expect(after["t3SyncHeightMap"]!.subarray(64 + v * 4, 68 + v * 4).equals(before["t3SyncHeightMap"]!.subarray(64 + v * 4, 68 + v * 4)), `t3SyncHeightMap vertex ${v}`).toBe(true);
  }
  for (const [file, header, size] of [["t3SyncCliffLevel", 32, 2], ["t3CellFlags", 32, 1]] as const) {
    expect(after[file]!.subarray(0, header).equals(before[file]!.subarray(0, header))).toBe(true);
    for (let cell = 0; cell < SIZE * SIZE; cell++) {
      if (inBlock(cell % SIZE, Math.floor(cell / SIZE))) continue;
      expect(after[file]!.subarray(header + cell * size, header + (cell + 1) * size).equals(before[file]!.subarray(header + cell * size, header + (cell + 1) * size)), `${file} cell ${cell}`).toBe(true);
    }
  }
  const texturesBefore = readKeptTextures(before["t3Terrain.xml"]!.toString("utf8"), before["t3TextureMasks"]!, before["t3SyncTextureInfo"]!);
  const texturesAfter = readKeptTextures(after["t3Terrain.xml"]!.toString("utf8"), after["t3TextureMasks"]!, after["t3SyncTextureInfo"]!);
  expect(after["t3SyncTextureInfo"]!.subarray(0, texturesAfter.syncCells).equals(before["t3SyncTextureInfo"]!.subarray(0, texturesBefore.syncCells))).toBe(true);
  const maskWidth = SIZE * 8;
  const differing: string[] = [];
  for (let cell = 0; cell < SIZE * SIZE; cell++) {
    const cx = cell % SIZE;
    const cy = Math.floor(cell / SIZE);
    if (inBlock(cx, cy)) continue;
    const at = texturesAfter.syncCells + cell * 8;
    if (!after["t3SyncTextureInfo"]!.subarray(at, at + 8).equals(before["t3SyncTextureInfo"]!.subarray(at, at + 8))) differing.push(`t3SyncTextureInfo cell ${cell}`);
    for (let ty = 0; ty < 8; ty++) {
      for (let tx = 0; tx < 8; tx++) {
        const t = (cy * 8 + ty) * maskWidth + cx * 8 + tx;
        for (let l = 0; l < 8; l++) if (texturesAfter.masks.layers[l]![t] !== texturesBefore.masks.layers[l]![t]) differing.push(`t3TextureMasks texel ${t} layer ${l}`);
      }
    }
  }
  expect(differing).toEqual([]);
  expect(after["t3TextureMasks"]!.subarray(0, 64).equals(before["t3TextureMasks"]!.subarray(0, 64))).toBe(true);
  // t3Terrain.xml: every cliff cell outside the block as it was, and everything but the cliff cell list byte for byte.
  const cliffsBefore = await readKeptCliffs(beforeDir, EMPTY_CATALOG);
  const cliffsAfter = await readKeptCliffs(afterDir, EMPTY_CATALOG);
  const half = SIZE / 2;
  for (let index = 0; index < half * half; index++) {
    if (inBlock((index % half) * 2, Math.floor(index / half) * 2)) continue;
    expect(cliffsAfter.cells.get(index), `cliff cell ${index}`).toEqual(cliffsBefore.cells.get(index));
  }
  const withoutCells = (xml: string) => xml.replace(/<cliffCellList\b[^>]*?(?:\/>|>[\s\S]*?<\/cliffCellList>)/, "");
  expect(withoutCells(after["t3Terrain.xml"]!.toString("utf8"))).toBe(withoutCells(before["t3Terrain.xml"]!.toString("utf8")));
}

describe("a generating Zone beside Kept ground", { timeout: 120_000 }, () => {
  it("writes only its own cells, and every Kept cell is byte-identical in every terrain file", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] });
    const before = await files(fixture.mapPackage);
    const snapshot = path.join(fixture.root, "before.SC2Map");
    await import("node:fs/promises").then(({ cp }) => cp(fixture!.mapPackage, snapshot, { recursive: true }));

    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const after = await files(fixture.mapPackage);

    // Only terrain files and Objects (the Bench follows the ground) change; t3VertCol, t3Water, MapInfo and the rest don't.
    const changed = Object.keys({ ...before, ...after }).filter((file) => !before[file] || !after[file] || hash(before[file]) !== hash(after[file]));
    const terrainChanged = changed.filter((file) => file.startsWith("t3"));
    expect(terrainChanged.sort()).toEqual(TERRAIN.filter((file) => file !== "t3SyncTextureInfo" || terrainChanged.includes(file)).sort());
    expect(changed.filter((file) => !file.startsWith("t3"))).not.toContain("MapInfo");
    expect(changed).not.toContain("t3VertCol");
    await expectKeptCellsUnchanged(before, after, snapshot, fixture.mapPackage);

    // Inside, the block is a plateau at level 2: its interior corners are at level 2, and its edge is cliff.
    const ground = await readKeptGround(fixture.mapPackage);
    expect(ground.levels[64 * COLUMNS + 22]).toBe(2);
    expect(ground.levels[56 * COLUMNS + 14]).toBe(1);
    const cliffs = await readKeptCliffs(fixture.mapPackage, EMPTY_CATALOG);
    expect((cliffs.cells.get(28 * 64 + 7)?.f ?? 0) & 1).toBe(1);
    expect((cliffs.cells.get(32 * 64 + 11)?.f ?? 0) & 1).toBe(0);

    // The compile record lists the block's cells in each terrain file.
    const record = await readCompileRecord(fixture.blueprintPath);
    const cells = record!.entries.filter((entry) => entry.kind === "terrain-cells");
    expect(cells.map((entry) => entry.kind === "terrain-cells" && entry.file).sort()).toEqual([...TERRAIN].sort());
    for (const entry of cells) if (entry.kind === "terrain-cells") expect(entry.cells).toEqual([[14, 56, 16, 16]]);
  });

  it("changes nothing when it is compiled again", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const once = await files(fixture.mapPackage);
    const record = await readFile(path.join(fixture.missionDir, "compile-record.json"), "utf8");
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const twice = await files(fixture.mapPackage);
    expect(Object.keys(twice).filter((file) => hash(twice[file]!) !== hash(once[file]!))).toEqual([]);
    expect(await readFile(path.join(fixture.missionDir, "compile-record.json"), "utf8")).toBe(record);
  });

  it("moves a Kept doodad inside it with the ground, lists it, and keeps its dressing off it", async () => {
    fixture = await keptGround();
    const benchBefore = readObjectsXml(await readFile(path.join(fixture.mapPackage, "Objects"), "utf8")).doodads.find((doodad) => doodad.id === BENCH_ID)!;
    await withZones(fixture, { elevation: 2, connections: [] }, {
      placements: [{ id: "rubble", kind: "set-piece", zoneId: "new_block", params: { story: "A collapsed shed.", at: { x: WELL.x + 2, y: WELL.y }, radius: 5, clutter: [{ type: "Korhal_Debris", count: 30 }] } }],
    });
    const compiled = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const objects = readObjectsXml(await readFile(path.join(fixture.mapPackage, "Objects"), "utf8"));
    const bench = objects.doodads.find((doodad) => doodad.id === BENCH_ID)!;
    // Level 2 is 2 higher than level 1; the base layer blends back to the Kept ground's only at the seam.
    expect(bench.position.z - benchBefore.position.z).toBeCloseTo(2, 1);
    expect(bench.position.x).toBe(benchBefore.position.x);
    expect(compiled.warnings.some((warning) => /Bench/.test(warning) && /moved with the ground/.test(warning))).toBe(true);
    // The dressing stands in the block, clear of the Bench.
    const record = await readCompileRecord(fixture.blueprintPath);
    const compiledIds = new Set(record!.entries.flatMap((entry) => (entry.kind === "object" ? [entry.id] : [])));
    const rubble = objects.doodads.filter((doodad) => compiledIds.has(doodad.id));
    expect(rubble.length).toBeGreaterThan(5);
    for (const doodad of rubble) {
      expect(inBlock(doodad.position.x, doodad.position.y)).toBe(true);
      expect(Math.hypot(doodad.position.x - bench.position.x, doodad.position.y - bench.position.y)).toBeGreaterThan(0.75);
    }
  });
});

describe("a generating Zone above the Kept ground's quantization", { timeout: 120_000 }, () => {
  // Level 8's cliff layer is 14, past the ±9 the fixture's quantization holds (#525).
  it("widens it as the Editor does, moves every Kept vertex by less than a step, and compiles again unchanged", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 8, connections: [] });
    const before = await readKeptGround(fixture.mapPackage);

    const compiled = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(compiled.warnings.some((warning) => warning.startsWith("The generating Zones' ground needs more range") && warning.includes("widened"))).toBe(true);
    const after = await readKeptGround(fixture.mapPackage);
    expect(after.quantizeScale).toBeGreaterThan(before.quantizeScale);
    expect(after.quantizeBias).toBeGreaterThanOrEqual(before.quantizeBias);
    expect(after.levels[64 * COLUMNS + 22]).toBe(8);
    expect(after.cliff[64 * COLUMNS + 22]!).toBeCloseTo(14, 2);
    let worst = 0;
    for (let v = 0; v < COLUMNS * COLUMNS; v++) {
      const x = v % COLUMNS;
      const y = Math.floor(v / COLUMNS);
      if ([[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]].every(([cx, cy]) => inBlock(cx!, cy!))) continue;
      worst = Math.max(worst, Math.abs(after.base[v]! - before.base[v]!), Math.abs(after.cliff[v]! - before.cliff[v]!));
      expect(after.levels[v], `level at vertex ${v}`).toBe(before.levels[v]);
    }
    expect(worst).toBeLessThanOrEqual(after.quantizeScale);

    // Compiled again, the widened map needs no more range and nothing reads as a hand edit.
    const once = await files(fixture.mapPackage);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const twice = await files(fixture.mapPackage);
    expect(Object.keys(twice).filter((file) => hash(twice[file]!) !== hash(once[file]!))).toEqual([]);
  });
});

describe("a Connection from a generating Zone into Kept ground", { timeout: 120_000 }, () => {
  const seam = (check: Awaited<ReturnType<typeof checkWorkspace>>) => check.problems.filter((problem) => problem.path?.startsWith("zones.0.connections"));

  it("meets the Kept cliff level where it crosses: no cliff there, and nothing for the checker", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 1 });
    expect(seam(await checkWorkspace(fixture.root))).toEqual([]);
    const compiled = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(compiled.warnings.filter((warning) => warning.startsWith("zones.0.connections"))).toEqual([]);
    // The cliff cells along the block's east edge, where the Connection crosses at (30, 64), are flat ground.
    const cliffs = await readKeptCliffs(fixture.mapPackage, EMPTY_CATALOG);
    for (let by = 28; by < 36; by++) expect((cliffs.cells.get(by * 64 + 14)?.f ?? 0) & 1).toBe(0);
    expect(seam(await checkWorkspace(fixture.root))).toEqual([]);
  });

  it("is reported by the checker when the Zone isn't at the Kept level there", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2 });
    expect(seam(await checkWorkspace(fixture.root))).toEqual([
      {
        mission: "quarry",
        file: "missions/quarry/blueprint.json",
        path: "zones.0.connections.0",
        message:
          "The Connection from new_block to east_yard crosses into Kept ground at cliff level 1 at (30, 64), but new_block generates its ground at level 2: set its elevation to 1, or move the crossing where the Kept ground is at 2",
      },
    ]);
    // The compile still builds it, with a cliff at the crossing, and says why.
    const compiled = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(compiled.warnings).toContain(
      "zones.0.connections.0: The Connection from new_block to east_yard crosses into Kept ground at cliff level 1 at (30, 64), but new_block generates its ground at level 2: set its elevation to 1, or move the crossing where the Kept ground is at 2",
    );
    // Once compiled the block's own level is in the package, and the check still reads the Kept side.
    expect(seam(await checkWorkspace(fixture.root))).toHaveLength(1);
  });
});

describe("a generating Zone's hidden cells", { timeout: 120_000 }, () => {
  const flagsFile = (fixture: KeptGroundFixture) => path.join(fixture.mapPackage, "t3CellFlags");
  const flagsAt = async (fixture: KeptGroundFixture, x: number, y: number) => (await readFile(flagsFile(fixture)))[32 + y * SIZE + x]!;
  /** Sets the hidden bit on a cell, as the Editor's Hide Terrain brush would. */
  async function hide(fixture: KeptGroundFixture, x: number, y: number): Promise<void> {
    const bytes = await readFile(flagsFile(fixture));
    bytes[32 + y * SIZE + x] = bytes[32 + y * SIZE + x]! | 0x04;
    await writeFile(flagsFile(fixture), bytes);
  }

  it("hides the cells it lists, records them, and leaves every Kept cell as it was", async () => {
    fixture = await keptGround();
    const before = await files(fixture.mapPackage);
    await withZones(fixture, { elevation: 2, connections: [], hiddenCells: [[20, 60, 2, 1]] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(await flagsAt(fixture, 20, 60)).toBe(0x06);
    expect(await flagsAt(fixture, 21, 60)).toBe(0x06);
    expect(await flagsAt(fixture, 22, 60)).toBe(0x02);
    // The Zone's cliff edge keeps its cliff bit; outside the block every byte is the package's.
    expect((await flagsAt(fixture, 14, 60)) & 0x01).toBe(0x01);
    const after = await readFile(flagsFile(fixture));
    for (let cell = 0; cell < SIZE * SIZE; cell++) if (!inBlock(cell % SIZE, Math.floor(cell / SIZE))) expect(after[32 + cell], `cell ${cell}`).toBe(before["t3CellFlags"]![32 + cell]);
    const record = await readCompileRecord(fixture.blueprintPath);
    expect(record!.entries.find((entry) => entry.kind === "hidden-cells")).toEqual({ kind: "hidden-cells", cells: [[BLOCK.x, BLOCK.y, BLOCK.width, BLOCK.height]], hidden: [[20, 60, 2, 1]] });
  });

  it("asks about a hide the Editor made, and kept, leaves it", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    await hide(fixture, 24, 64);
    // A hide outside the Zones is Kept ground's own, and nothing to ask about.
    await hide(fixture, 50, 50);
    const stopped = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt }).catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(EditorChangesError);
    expect((stopped as EditorChangesError).changes.map((change) => [change.name, change.label])).toEqual([["hidden-cells", "1 hidden in the package, unlike the Zones' hiddenCells, the first at (24, 64)"]]);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt, decisions: { keep: ["hidden-cells"] } });
    expect(await flagsAt(fixture, 24, 64)).toBe(0x06);
    expect(await flagsAt(fixture, 50, 50)).toBe(0x06);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(await flagsAt(fixture, 24, 64)).toBe(0x06);
  });

  it("asks on the first compile about the package's hides in its cells, and discarded, shows them", async () => {
    fixture = await keptGround();
    await hide(fixture, 24, 64);
    await withZones(fixture, { elevation: 2, connections: [] });
    const stopped = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt }).catch((error: unknown) => error);
    expect((stopped as EditorChangesError).changes.map((change) => change.name)).toEqual(["hidden-cells"]);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt, decisions: { discard: ["hidden-cells"] } });
    expect(await flagsAt(fixture, 24, 64)).toBe(0x02);
  });
});

describe("a hand edit to a generating Zone's cells", { timeout: 120_000 }, () => {
  /** Lowers one vertex inside the block by about a unit, as an Editor height brush would. */
  async function editInEditor(fixture: KeptGroundFixture): Promise<void> {
    const file = path.join(fixture.mapPackage, "t3HeightMap");
    const bytes = await readFile(file);
    const at = 32 + (62 * COLUMNS + 20) * 6;
    bytes.writeUInt16LE(bytes.readUInt16LE(at) - 4000, at);
    await writeFile(file, bytes);
  }
  const vertex = async (fixture: KeptGroundFixture) => (await readFile(path.join(fixture.mapPackage, "t3HeightMap"))).readUInt16LE(32 + (62 * COLUMNS + 20) * 6);

  /**
   * Saves the height map again at another quantization, as every Editor save does (on one Editor-saved map,
   * quantizeBias 9.003069 → 9.003311): each raw value changes, no height by more than a step.
   * `raise` lifts one vertex inside the block too, by that much.
   */
  async function requantize(fixture: KeptGroundFixture, raise = 0): Promise<void> {
    const xmlFile = path.join(fixture.mapPackage, "t3Terrain.xml");
    const xml = await readFile(xmlFile, "utf8");
    const scale = Number(/quantizeScale="([^"]*)"/.exec(xml)![1]);
    const bias = Number(/quantizeBias="([^"]*)"/.exec(xml)![1]);
    const [newScale, newBias] = [scale * (1 + 9e-6), bias + 0.000242];
    const file = path.join(fixture.mapPackage, "t3HeightMap");
    const bytes = await readFile(file);
    const lifted = 62 * COLUMNS + 20;
    for (let v = 0; v < COLUMNS * COLUMNS; v++) {
      for (const at of [32 + v * 6, 34 + v * 6]) {
        const height = bytes.readUInt16LE(at) * scale - bias + (v === lifted && at === 32 + v * 6 ? raise : 0);
        bytes.writeUInt16LE(Math.min(65535, Math.max(0, Math.round((height + newBias) / newScale))), at);
      }
    }
    await writeFile(file, bytes);
    await writeFile(xmlFile, xml.replace(/quantizeScale="[^"]*"/, `quantizeScale="${newScale.toExponential(6)}"`).replace(/quantizeBias="[^"]*"/, `quantizeBias="${newBias.toExponential(6)}"`));
  }

  it("isn't one when the Editor only quantized the heights again", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    await requantize(fixture);

    await expect(compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt })).resolves.toBeDefined();
  });

  it("is still one when a height moved by a tenth, in a save at another quantization", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    await requantize(fixture, 0.1);

    const stopped = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt }).catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(EditorChangesError);
    expect((stopped as EditorChangesError).changes.map((change) => [change.name, change.label])).toEqual([["terrain-cells:t3HeightMap", "4 cells of a generating Zone, the first at (19, 61)"]]);
  });

  it("stops the compile, naming the cells, until the author keeps or discards it", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const generated = await vertex(fixture);
    await editInEditor(fixture);
    const edited = await files(fixture.mapPackage);

    const stopped = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt }).catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(EditorChangesError);
    expect((stopped as EditorChangesError).changes.map((change) => [change.name, change.label])).toEqual([["terrain-cells:t3HeightMap", "4 cells of a generating Zone, the first at (19, 61)"]]);
    const now = await files(fixture.mapPackage);
    expect(Object.keys(now).filter((file) => hash(now[file]!) !== hash(edited[file]!))).toEqual([]);

    // Discarded, the Zone writes the vertex again.
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt, decisions: { discard: ["terrain-cells:t3HeightMap"] } });
    expect(await vertex(fixture)).toBe(generated);
  });

  it("kept, leaves those cells as the Editor left them, off the Zone in every file, and compiles again without asking", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    await editInEditor(fixture);
    const edited = await vertex(fixture);
    const compiled = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt, decisions: { keep: ["terrain-cells:t3HeightMap"] } });
    expect(await vertex(fixture)).toBe(edited);
    const record = await readCompileRecord(fixture.blueprintPath);
    expect(record!.kept).toEqual([{ kind: "terrain-cells", file: "t3HeightMap", cells: [[19, 61, 2, 2]] }]);
    // The Zone's cells on the record leave the kept ones out: its 2×2 cliff cell at (18, 60) is Kept now.
    const cells = record!.entries.find((entry) => entry.kind === "terrain-cells" && entry.file === "t3TextureMasks");
    const owned = cells?.kind === "terrain-cells" ? cells.cells.reduce((sum, [, , w, h]) => sum + w * h, 0) : 0;
    expect(owned).toBe(16 * 16 - 4 * 4);
    expect(compiled.warnings.some((warning) => warning.includes("terrain-cells:t3HeightMap:19,61"))).toBe(true);

    const before = await files(fixture.mapPackage);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const after = await files(fixture.mapPackage);
    expect(Object.keys(after).filter((file) => hash(after[file]!) !== hash(before[file]!))).toEqual([]);
  });
});

describe("beside Kept ground of two texture sets", { timeout: 120_000 }, () => {
  // The texture-sets fixture's first save (128 cells square, CharDunes as set 1) in place of the Kept ground's own textures.
  const SETS = fileURLToPath(new URL("../fixtures/editor-terrain/texture-sets/", import.meta.url));
  async function generate(fixture: KeptGroundFixture) {
    const kept = {
      ground: await readKeptGround(fixture.mapPackage),
      cliffs: await readKeptCliffs(fixture.mapPackage, EMPTY_CATALOG),
      textures: readKeptTextures(await readFile(`${SETS}t3Terrain.xml`, "utf8"), gunzipSync(await readFile(`${SETS}t3TextureMasks.gz`)), await readFile(`${SETS}t3SyncTextureInfo`)),
      objects: undefined,
    };
    const parsed = validateMissionBlueprint(fixture.workspace, JSON.parse(await readFile(fixture.blueprintPath, "utf8")), fixture.workspace.catalog);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.issues));
    return () => generateBesideKept(parsed.blueprint, kept);
  }

  it("paints a generating Zone by name, from the set its blocks are on, and refuses a texture no set holds", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] });
    expect(await generate(fixture)).toThrow("The map has no texture MeinhoffConcrete");
    // BLOCK's blocks (1-3 × 7-8) are on set 0, where BelShirGrassLight is layer 1.
    await withZones(fixture, { elevation: 2, connections: [], texture: "BelShirGrassLight" });
    const zone = (await generate(fixture))();
    const masks = readT3TextureMasks(zone.files.t3TextureMasks as Buffer);
    const t = (60 * 8 + 4) * masks.maskWidth + 20 * 8 + 4;
    expect(masks.layers[1]![t]).toBe(15);
    expect(zone.textureSets).toEqual([]);
  });

  it("refuses a Blueprint texture set over a block the Editor put on another set", async () => {
    fixture = await keptGround();
    // Cells 56-63 × 48-55: block 103, on the fixture's CharDunes set 1.
    await withZones(fixture, { elevation: 2, connections: [], texture: "BraxisAlphaPlatesEx2" }, { textureSets: [{ id: "factory", textures: ["BraxisAlphaPlatesEx2"], zones: ["new_block"] }] });
    const blueprint = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as { zones: { id: string; polygon: unknown }[] };
    blueprint.zones[0]!.polygon = square({ x: 56, y: 48, width: 8, height: 8 });
    await writeFile(fixture.blueprintPath, JSON.stringify(blueprint, null, 2));
    expect(await generate(fixture)).toThrow(/Block 103 \(cells 56-63 × 48-55\) is on texture set 1 \(CharDunes\)/);
  });

  it("paints a Paint Region over a generating Zone's cells, from the set its blocks are on, and leaves every other cell as it was", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [], texture: "BelShirGrassLight" });
    const plain = (await generate(fixture))();
    // BelShirDirtLight is set 0's layer 0, at 15% in every cell past the falloff (2 cells).
    await withZones(fixture, { elevation: 2, connections: [], texture: "BelShirGrassLight" }, { paintRegions: [{ id: "dirt", zone: "new_block", mix: [{ texture: "BelShirDirtLight", weight: 0.15 }] }] });
    const zone = (await generate(fixture))();
    const masks = readT3TextureMasks(zone.files.t3TextureMasks as Buffer);
    const before = readT3TextureMasks(plain.files.t3TextureMasks as Buffer);
    const share = (cx: number, cy: number) => {
      let sum = 0;
      for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) sum += masks.layers[0]![(cy * 8 + ty) * masks.maskWidth + cx * 8 + tx]!;
      return sum / (64 * 15);
    };
    for (let y = 58; y < 70; y++) for (let x = 16; x < 28; x++) expect(share(x, y)).toBeCloseTo(0.15, 2);
    expect(share(14, 64)).toBeLessThan(share(15, 64));
    for (let t = 0; t < masks.maskWidth * masks.maskHeight; t++) {
      if (inBlock(Math.floor((t % masks.maskWidth) / 8), Math.floor(t / masks.maskWidth / 8))) continue;
      for (let l = 0; l < 8; l++) if (masks.layers[l]![t] !== before.layers[l]![t]) throw new Error(`texel ${t} layer ${l} changed outside the Zone`);
    }
  });

  it("refuses a Paint Region naming a texture the set its generating Zone's blocks are on lacks", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [], texture: "BelShirGrassLight" }, { paintRegions: [{ id: "dunes", zone: "new_block", mix: [{ texture: "CharDunes_1", weight: 0.2 }] }] });
    expect(await generate(fixture)).toThrow("Paint Region dunes paints cells on texture set 0 (BelShirEx1), which doesn't hold CharDunes_1: BelShirDirtLight, BelShirGrassLight. Nothing was compiled");
  });

  it("leaves a Mission with no generating Zone alone, since it paints nothing", async () => {
    fixture = await keptGround();
    await withZones(fixture, { terrain: "kept", connections: [] });
    expect(await generate(fixture)).not.toThrow();
  });
});

describe("the terrain flag", () => {
  it("is set on every Zone or on none, and a Mission beside Kept ground needs no Beats", async () => {
    fixture = await keptGround();
    await withZones(fixture);
    const raw = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as { zones: Record<string, unknown>[] };
    expect(validateMissionBlueprint(fixture.workspace, raw, fixture.workspace.catalog).success).toBe(true);
    const { terrain: _terrain, ...unflagged } = raw.zones[1]!;
    const mixed = validateMissionBlueprint(fixture.workspace, { ...raw, zones: [raw.zones[0], unflagged] }, fixture.workspace.catalog);
    expect(mixed.success).toBe(false);
    if (!mixed.success) {
      expect(mixed.issues).toContainEqual({
        path: "zones.1.terrain",
        message: 'Another Zone sets terrain, so the Mission has Kept ground: say whether east_yard generates its ground ("generate") or is drawn over Kept ground ("kept")',
      });
    }
  });

  it("makes a generating Zone's cells Compiled Content, which a brush edit refuses", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: { rect: { x: 18, y: 60, width: 4, height: 4 } }, brush: { op: "raise", by: 0.5 } })).rejects.toThrow(
      /Compiled Content \(t3HeightMap, on the compile record\).*zones\.0 \(new_block\)'s elevation or ground/,
    );
    // Kept ground beside it can still be edited.
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: { rect: { x: 50, y: 60, width: 4, height: 4 } }, brush: { op: "raise", by: 0.25 } }, { name: "beside" });
  }, 120_000);
});

describe("beside Kept ground, the review's cases", { timeout: 120_000 }, () => {
  it("keeps cells kept from an earlier compile when the author discards everything else", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const file = path.join(fixture.mapPackage, "t3HeightMap");
    const bytes = await readFile(file);
    const at = 32 + (62 * COLUMNS + 20) * 6;
    bytes.writeUInt16LE(bytes.readUInt16LE(at) - 4000, at);
    await writeFile(file, bytes);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt, decisions: { keep: ["terrain-cells:t3HeightMap"] } });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt, decisions: { discard: "all" } });
    expect((await readFile(file)).readUInt16LE(at)).toBe(bytes.readUInt16LE(at));
    expect((await readCompileRecord(fixture.blueprintPath))!.kept).toEqual([{ kind: "terrain-cells", file: "t3HeightMap", cells: [[19, 61, 2, 2]] }]);
  });

  it("keeps its dressing off a crossing into Kept ground", async () => {
    fixture = await keptGround();
    await withZones(fixture, {}, {
      placements: [{ id: "rubble", kind: "set-piece", zoneId: "new_block", params: { story: "A collapsed shed.", at: { x: 27, y: 64 }, radius: 5, clutter: [{ type: "Korhal_Debris", count: 30 }] } }],
    });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const record = await readCompileRecord(fixture.blueprintPath);
    const compiledIds = new Set(record!.entries.flatMap((entry) => (entry.kind === "object" ? [entry.id] : [])));
    const rubble = readObjectsXml(await readFile(path.join(fixture.mapPackage, "Objects"), "utf8")).doodads.filter((doodad) => compiledIds.has(doodad.id));
    expect(rubble.length).toBeGreaterThan(3);
    for (const doodad of rubble) expect(Math.hypot(doodad.position.x - 30, doodad.position.y - 64)).toBeGreaterThan(3.5);
  });

  it("leaves a Kept Zone's ground alone where it lies inside a generating one", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] });
    const blueprint = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as { zones: unknown[] };
    blueprint.zones.push({ id: "shrine", name: "Shrine", elevation: 1, landform: "flat", role: "vault", terrain: "kept", polygon: square({ x: 16, y: 58, width: 4, height: 8 }) });
    await writeFile(fixture.blueprintPath, JSON.stringify(blueprint));
    const before = await readKeptGround(fixture.mapPackage);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const after = await readKeptGround(fixture.mapPackage);
    for (let y = 58; y <= 66; y++) for (let x = 16; x <= 20; x++) expect(after.heightMap.subarray(32 + (y * COLUMNS + x) * 6, 38 + (y * COLUMNS + x) * 6).equals(before.heightMap.subarray(32 + (y * COLUMNS + x) * 6, 38 + (y * COLUMNS + x) * 6))).toBe(true);
    const cells = (await readCompileRecord(fixture.blueprintPath))!.entries.find((entry) => entry.kind === "terrain-cells");
    expect(cells?.kind === "terrain-cells" && cells.cells.reduce((sum, [, , w, h]) => sum + w * h, 0)).toBe(16 * 16 - 4 * 8);
  });

  it("stands a doodad Anchor on the ground the compile writes, not the generator's alone", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] }, {
      anchors: [{ id: "lamp", name: "Lamp", zoneId: "new_block", kind: "doodad", doodadType: "Korhal_Debris", position: { x: 14.5, y: 64.5 } }],
    });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const ground = await readKeptGround(fixture.mapPackage);
    const lamp = readObjectsXml(await readFile(path.join(fixture.mapPackage, "Objects"), "utf8")).doodads.find((doodad) => doodad.name === "Lamp" || doodad.type === "Korhal_Debris");
    expect(lamp!.position.z).toBeCloseTo(vertexHeightAt(ground.heights, COLUMNS, 14.5, 64.5), 3);
  });

  it("puts a Zone's own cliff set on the cliffs at its edge, when the map has that set", async () => {
    fixture = await keptGround();
    // A second set, as the Editor lists one once a cliff is painted with it.
    const xmlPath = path.join(fixture.mapPackage, "t3Terrain.xml");
    const xml = await readFile(xmlPath, "utf8");
    const newline = xml.includes("\r\n") ? "\r\n" : "\n";
    await writeFile(xmlPath, xml.replace(/<cliffSetList num="1">(\r?\n)(\s*)(<cliffSet i="0" name="[^"]*"\/>)/, `<cliffSetList num="2">$1$2$3${newline}$2<cliffSet i="1" name="AgriaCliff0"/>`));
    const sets = (await readKeptCliffs(fixture.mapPackage, EMPTY_CATALOG)).cliffSets;
    expect(sets).toHaveLength(2);
    await withZones(fixture, { elevation: 2, connections: [], cliff: sets[1] } as ZoneFields);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const cliffs = await readKeptCliffs(fixture.mapPackage, EMPTY_CATALOG);
    const edge = [...cliffs.cells].filter(([index, entry]) => entry.f & 1 && inBlock((index % 64) * 2, Math.floor(index / 64) * 2));
    expect(edge.length).toBe(28);
    expect(new Set(edge.map(([, entry]) => cliffs.cliffSets[entry.cid]))).toEqual(new Set([sets[1]]));
  });

  it("puts a cliffSets group's set on its Zones' cliffs, and refuses a group naming a Kept Zone", async () => {
    fixture = await keptGround();
    const xmlPath = path.join(fixture.mapPackage, "t3Terrain.xml");
    const xml = await readFile(xmlPath, "utf8");
    const newline = xml.includes("\r\n") ? "\r\n" : "\n";
    await writeFile(xmlPath, xml.replace(/<cliffSetList num="1">(\r?\n)(\s*)(<cliffSet i="0" name="[^"]*"\/>)/, `<cliffSetList num="2">$1$2$3${newline}$2<cliffSet i="1" name="AgriaCliff0"/>`));
    await withZones(fixture, { elevation: 2, connections: [] }, { cliffSets: [{ cliffSet: "AgriaCliff0", zones: ["new_*"] }] });
    const raw = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as Record<string, unknown>;
    const kept = validateMissionBlueprint(fixture.workspace, { ...raw, cliffSets: [{ cliffSet: "AgriaCliff0", zones: ["east_yard"] }] }, fixture.workspace.catalog);
    expect(kept.success ? [] : kept.issues.map((issue) => issue.message)).toContain(`Zone east_yard is drawn over Kept ground: only a generating Zone ("terrain": "generate") has its cliffs chosen by a cliffSets group`);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const cliffs = await readKeptCliffs(fixture.mapPackage, EMPTY_CATALOG);
    const edge = [...cliffs.cells].filter(([index, entry]) => entry.f & 1 && inBlock((index % 64) * 2, Math.floor(index / 64) * 2));
    expect(edge.length).toBe(28);
    expect(new Set(edge.map(([, entry]) => cliffs.cliffSets[entry.cid]))).toEqual(new Set(["AgriaCliff0"]));
  });
});

describe("beside Kept ground, the second review's cases", { timeout: 120_000 }, () => {
  const compiledDoodads = async (fixture: KeptGroundFixture) => {
    const record = await readCompileRecord(fixture.blueprintPath);
    const ids = new Set(record!.entries.flatMap((entry) => (entry.kind === "object" ? [entry.id] : [])));
    return readObjectsXml(await readFile(path.join(fixture.mapPackage, "Objects"), "utf8")).doodads.filter((doodad) => ids.has(doodad.id));
  };
  const ROCKS = { large: ["ZerusRockLarge"], small: ["AgriaDebris"] };

  it("with every Zone Kept, generates no ground or dressing, and stands a Kept Zone's set piece on the package's own ground", async () => {
    fixture = await keptGround();
    // At elevation 2 the generator's ground would sit 2 above the package's level-1 yard.
    await withZones(fixture, { terrain: "kept", elevation: 2, connections: [] }, {
      dressing: { cliffs: { spacing: 2, natural: ROCKS, built: ROCKS } },
      placements: [{ id: "rubble", kind: "set-piece", zoneId: "east_yard", params: { story: "A collapsed shed.", at: { x: 36, y: 64 }, radius: 4, clutter: [{ type: "Korhal_Debris", count: 12 }] } }],
    });
    const before = await files(fixture.mapPackage);
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const after = await files(fixture.mapPackage);
    for (const file of TERRAIN) expect(hash(after[file]!), file).toBe(hash(before[file]!));
    const record = await readCompileRecord(fixture.blueprintPath);
    expect(record!.entries.filter((entry) => entry.kind === "terrain-cells")).toEqual([]);
    // Only the set piece's doodads: no cliff piles on the Kept cliffs.
    const doodads = await compiledDoodads(fixture);
    expect(doodads.length).toBeGreaterThan(3);
    const ground = await readKeptGround(fixture.mapPackage);
    for (const doodad of doodads) {
      expect(doodad.type).toBe("Korhal_Debris");
      expect(Math.hypot(doodad.position.x - 36, doodad.position.y - 64)).toBeLessThanOrEqual(4.5);
      expect(doodad.position.z).toBeCloseTo(vertexHeightAt(ground.heights, COLUMNS, doodad.position.x, doodad.position.y), 2);
    }
  });

  it("stands a Kept Zone's set piece on the package's ground beside a generating Zone", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] }, {
      placements: [{ id: "rubble", kind: "set-piece", zoneId: "east_yard", params: { story: "A collapsed shed.", at: { x: 36, y: 64 }, radius: 4, clutter: [{ type: "Korhal_Debris", count: 12 }] } }],
    });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const ground = await readKeptGround(fixture.mapPackage);
    const rubble = (await compiledDoodads(fixture)).filter((doodad) => doodad.type === "Korhal_Debris");
    expect(rubble.length).toBeGreaterThan(3);
    for (const doodad of rubble) expect(doodad.position.z).toBeCloseTo(vertexHeightAt(ground.heights, COLUMNS, doodad.position.x, doodad.position.y), 2);
  });

  it("piles rocks at the foot of the cliffs it writes against the Kept levels, which the generator alone doesn't have", async () => {
    fixture = await keptGround();
    // A level-1 pit cut into the level-3 crag: its edge is cliff only against the Kept crag round it.
    const pit = { x: 44, y: 30, width: 8, height: 8 };
    await withZones(fixture, { elevation: 1, connections: [], polygon: square(pit) } as ZoneFields, { dressing: { cliffs: { spacing: 2, natural: ROCKS, built: ROCKS } } });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    const piles = (await compiledDoodads(fixture)).filter((doodad) => ROCKS.large.includes(doodad.type) || ROCKS.small.includes(doodad.type));
    expect(piles.length).toBeGreaterThan(0);
    for (const doodad of piles) {
      expect(doodad.position.x).toBeGreaterThanOrEqual(pit.x);
      expect(doodad.position.x).toBeLessThan(pit.x + pit.width);
      expect(doodad.position.y).toBeGreaterThanOrEqual(pit.y);
      expect(doodad.position.y).toBeLessThan(pit.y + pit.height);
    }
  });

  it("says which cells a Zone wrote last time that no Zone owns now, still with the generated ground", async () => {
    fixture = await keptGround();
    await withZones(fixture, { elevation: 2, connections: [] });
    await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    await withZones(fixture, { elevation: 2, connections: [], polygon: square({ ...BLOCK, width: 8 }) } as ZoneFields);
    const compiled = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(compiled.warnings).toContain(
      "128 cells the last compile's generating Zones wrote, the first at (22, 56), are in no generating Zone now, so they keep the generated ground and are Kept Content from here on: reshape them with the brushes (edit-terrain), or bring them back into a generating Zone",
    );
    // Once off the record they aren't reported again.
    const again = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(again.warnings.filter((warning) => warning.includes("in no generating Zone now"))).toEqual([]);
  });
});

describe("a terrain file's cells, as the record fingerprints them", () => {
  it("tells texture weights apart that read the same run together", () => {
    const texelWeights = (a: number, b: number) => {
      const weights = new Uint8Array(64 * 64 * 8);
      weights[0] = a;
      weights[1] = b;
      return weights;
    };
    const masks = (a: number, b: number) => writeT3TextureMasks({ width: 8, height: 8, textureWeights: new Uint8Array(64 * 8), texelWeights: texelWeights(a, b) });
    const cells = new Uint8Array(64).fill(1);
    const xml = "";
    expect(terrainCellsFingerprint("t3TextureMasks", masks(1, 14), cells, 8, 8, xml)).not.toBe(terrainCellsFingerprint("t3TextureMasks", masks(11, 4), cells, 8, 8, xml));
  });
});

