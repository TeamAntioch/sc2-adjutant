// Cliff and ramp brushes on Kept ground (spec #247, ticket #250): raise or lower a cliff level,
// add or remove one of the generator's stock ramps, and the static shadow bake they reset. The
// package is synthetic (tests/support/kept-ground.ts): the crossing fixture imported, with the
// Editor's quantization, walking heights and a shadow bake; or, to compare with the generator,
// imported as the generator wrote it without its ramp.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { CliffBrushSchema } from "../../src/kept-terrain/cliff-brushes.js";
import { readKeptCliffs } from "../../src/kept-terrain/kept-cliffs.js";
import { type KeptGround, readKeptGround } from "../../src/kept-terrain/kept-ground.js";
import { hasShadowBake, REBAKE } from "../../src/kept-terrain/shadow-bake.js";
import { type CliffBrush, editKeptTerrain } from "../../src/map/edit-kept-terrain.js";
import { readObjectsXml } from "../../src/map/read-objects-xml.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { connect, text } from "../mcp/harness.js";
import { CLIFF_HEIGHTS, type CornerGrid, syncCellLevels, vertexLevels } from "../../src/terrain/cliffs.js";
import { BENCH_ID, bakedVertCol, type KeptGroundFixture, keptGround, generatedGround, removeKeptGround, WALKING_OFFSET } from "../support/kept-ground.js";

const SIZE = 128;
const COLUMNS = SIZE + 1;
const CLIFF_COLUMNS = SIZE / 2;

let fixture: KeptGroundFixture | undefined;
afterEach(async () => {
  await removeKeptGround(fixture);
  fixture = undefined;
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
const changedFiles = (before: Record<string, string>, after: Record<string, string>) => Object.keys(after).filter((file) => after[file] !== before[file]).sort();

const corners = (ground: KeptGround): CornerGrid => {
  const columns = SIZE / 2 + 1;
  const levels = new Uint8Array(columns * columns);
  for (let cy = 0; cy < columns; cy++) for (let cx = 0; cx < columns; cx++) levels[cy * columns + cx] = ground.levels[2 * cy * COLUMNS + 2 * cx]!;
  return { columns, rows: columns, levels };
};

async function state(mapPackage: string) {
  return { ground: await readKeptGround(mapPackage), cliffs: await readKeptCliffs(mapPackage, EMPTY_CATALOG) };
}
type State = Awaited<ReturnType<typeof state>>;

/** The rules the generator writes cliffs by, checked over cells x0..x1, y0..y1: every file agrees with the corners. */
function expectConsistent({ ground, cliffs }: State, x0: number, y0: number, x1: number, y1: number): void {
  const grid = corners(ground);
  const levels = vertexLevels(grid, SIZE, SIZE);
  const sync = syncCellLevels(ground.levels, SIZE, SIZE);
  for (let y = y0; y <= y1 + 1; y++) {
    for (let x = x0; x <= x1 + 1; x++) {
      const v = y * COLUMNS + x;
      expect(ground.levels[v], `r2 at (${x}, ${y})`).toBe(levels[v]);
      expect(ground.syncHeightMap.readUInt16LE(64 + v * 4 + 2), `sync level at (${x}, ${y})`).toBe(ground.levels[v]);
      expect(ground.cliff[v]!, `r1 at (${x}, ${y})`).toBeCloseTo(CLIFF_HEIGHTS[ground.levels[v]!]!, 3);
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const cell = y * SIZE + x;
      expect(cliffs.syncCliff[cell], `sync cliff at (${x}, ${y})`).toBe(sync[cell]! * 64);
      const cx = x >> 1;
      const cy = y >> 1;
      const around = [grid.levels[cy * grid.columns + cx], grid.levels[cy * grid.columns + cx + 1], grid.levels[(cy + 1) * grid.columns + cx], grid.levels[(cy + 1) * grid.columns + cx + 1]];
      const mesh = around.some((level) => level !== around[0]);
      expect(Boolean(cliffs.cellFlags[cell]! & 1), `cell flag at (${x}, ${y})`).toBe(mesh);
      expect(Boolean((cliffs.cells.get(cy * CLIFF_COLUMNS + cx)?.f ?? 0) & 1), `cliff cell at (${2 * cx}, ${2 * cy})`).toBe(mesh);
    }
  }
}

/** Every value of every file outside cells x0..x1, y0..y1 (vertices bordering them included in the window) is as it was. */
function expectUnchangedOutside(before: State, after: State, x0: number, y0: number, x1: number, y1: number): void {
  for (let v = 0; v < COLUMNS * COLUMNS; v++) {
    const x = v % COLUMNS;
    const y = Math.floor(v / COLUMNS);
    if (x >= x0 && x <= x1 + 1 && y >= y0 && y <= y1 + 1) continue;
    expect(after.ground.heightMap.subarray(32 + v * 6, 38 + v * 6).equals(before.ground.heightMap.subarray(32 + v * 6, 38 + v * 6)), `t3HeightMap at (${x}, ${y})`).toBe(true);
    expect(after.ground.syncHeightMap.subarray(64 + v * 4, 68 + v * 4).equals(before.ground.syncHeightMap.subarray(64 + v * 4, 68 + v * 4)), `t3SyncHeightMap at (${x}, ${y})`).toBe(true);
  }
  for (let cell = 0; cell < SIZE * SIZE; cell++) {
    const x = cell % SIZE;
    const y = Math.floor(cell / SIZE);
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
    expect(after.cliffs.syncCliff[cell], `sync cliff at (${x}, ${y})`).toBe(before.cliffs.syncCliff[cell]);
    expect(after.cliffs.cellFlags[cell], `cell flags at (${x}, ${y})`).toBe(before.cliffs.cellFlags[cell]);
  }
  for (const [index, entry] of [...before.cliffs.cells, ...after.cliffs.cells]) {
    const x = (index % CLIFF_COLUMNS) * 2;
    const y = Math.floor(index / CLIFF_COLUMNS) * 2;
    if (x >= x0 && x + 1 <= x1 && y >= y0 && y + 1 <= y1) continue;
    expect(after.cliffs.cells.get(index), `cliff cell at (${x}, ${y})`).toEqual(before.cliffs.cells.get(index) ?? entry);
  }
  expect(after.cliffs.ramps).toEqual(before.cliffs.ramps);
}

// Open level-1 ground round the Well and the Bench, off the grid on purpose: 17..24 snaps to the corners 18..24.
const YARD = { rect: { x: 17, y: 61, width: 8, height: 8 } };
// The cliff cells round the raised corners (18..24, 62..68): cliff columns 8..12 by rows 30..34, less the plateau inside.
const RING = Array.from({ length: 25 }, (_, i) => [8 + (i % 5), 30 + Math.floor(i / 5)] as const)
  .filter(([cx, cy]) => cx === 8 || cx === 12 || cy === 30 || cy === 34)
  .map(([cx, cy]) => cy * CLIFF_COLUMNS + cx);

describe("raising and lowering a cliff level on Kept ground", { timeout: 60_000 }, () => {
  it("raises a block with cliff cells on its grid-snapped edge in the cliff set asked for, and every terrain file agrees with them", async () => {
    fixture = await keptGround();
    const before = await state(fixture.mapPackage);
    const named = before.cliffs.cliffSets.at(-1)!;
    const hashes = await hashTree(fixture.mapPackage);
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise-cliff", cliffSet: named } }, { name: "test" });
    const after = await state(fixture.mapPackage);

    const newCells = [...after.cliffs.cells].filter(([index, entry]) => entry.f & 1 && !((before.cliffs.cells.get(index)?.f ?? 0) & 1)).map(([index]) => index);
    expect(newCells.sort((a, b) => a - b)).toEqual(RING);
    for (const index of RING) expect(after.cliffs.cells.get(index)!.cid).toBe(before.cliffs.cliffSets.indexOf(named));
    expect(result.cliffCells).toBe(RING.length);
    // The plateau is one level up: the cells inside the snapped corners at level 2, 2 units higher.
    for (let y = 62; y <= 68; y++) {
      for (let x = 18; x <= 24; x++) {
        const v = y * COLUMNS + x;
        expect(after.ground.levels[v]).toBe(2);
        expect(after.ground.heights[v]! - before.ground.heights[v]!).toBeCloseTo(2, 3);
      }
    }
    expectConsistent(after, 12, 56, 30, 74);
    expectUnchangedOutside(before, after, 16, 60, 25, 69);
    // Vertices whose cliff level changed walk at their render height, to the Editor's rounding.
    for (let v = 0; v < COLUMNS * COLUMNS; v++) {
      if (after.ground.levels[v] !== before.ground.levels[v]) expect(Math.abs(after.ground.syncHeightMap.readInt16LE(64 + v * 4) - Math.round(after.ground.heights[v]! * 256))).toBeLessThanOrEqual(2);
    }

    expect(changedFiles(hashes, await hashTree(fixture.mapPackage))).toEqual(["Objects", "t3CellFlags", "t3HeightMap", "t3SyncCliffLevel", "t3SyncHeightMap", "t3Terrain.xml", "t3VertCol"].sort());
    expect(result.files).toEqual(["t3HeightMap", "t3SyncHeightMap", "t3SyncCliffLevel", "t3CellFlags", "t3Terrain.xml", "t3VertCol", "Objects"]);
    // The Bench stands on the plateau: it rises with it.
    expect(result.doodads).toEqual([{ id: BENCH_ID, type: "Bench", by: expect.closeTo(2, 3) }]);
    const bench = readObjectsXml(await readFile(path.join(fixture.mapPackage, "Objects"), "utf8")).doodads.find((doodad) => doodad.id === BENCH_ID)!;
    expect(bench.position.z).toBeCloseTo(after.ground.heights[64 * COLUMNS + 22]!, 3);
    expect(result.summary).toMatch(new RegExp(`^Raised the cliff level of the 8×8 cells at \\(17, 61\\) by one, 16 cliff cells changed \\(${named}\\): \\d+ cells changed`));
    expect(result.warnings).toContain(`${REBAKE[0]!.toUpperCase()}${REBAKE.slice(1)} (the bake in t3VertCol was reset)`);
  });

  it("lowers it again to the ground it was, but for the shadow bake and the doodad's last decimals", async () => {
    fixture = await keptGround();
    const hashes = await hashTree(fixture.mapPackage);
    const before = readObjectsXml(await readFile(path.join(fixture.mapPackage, "Objects"), "utf8")).doodads;
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise-cliff" } }, { name: "up" });
    const down = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "lower-cliff" } }, { name: "down" });
    expect(down.summary).toMatch(/^Lowered the cliff level of the 8×8 cells at \(17, 61\) by one, 16 cliff cells changed: /);
    // The Bench is back at its height, written to 4 decimals.
    expect(changedFiles(hashes, await hashTree(fixture.mapPackage))).toEqual(["Objects", "t3VertCol"]);
    const bench = readObjectsXml(await readFile(path.join(fixture.mapPackage, "Objects"), "utf8")).doodads.find((doodad) => doodad.id === BENCH_ID)!;
    expect(bench.position.z).toBeCloseTo(before.find((doodad) => doodad.id === BENCH_ID)!.position.z, 3);
  });

  it("refuses a cliff set the map doesn't have, naming its own", async () => {
    fixture = await keptGround();
    const { cliffs } = await state(fixture.mapPackage);
    const hashes = await hashTree(fixture.mapPackage);
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise-cliff", cliffSet: "SlaynCliff0" } }, { name: "test" })).rejects.toThrow(
      `SlaynCliff0 isn't one of the map's cliff sets (${cliffs.cliffSets.join(", ")}): name one of those, or add it in the Editor first. Nothing was written`,
    );
    expect(await hashTree(fixture.mapPackage)).toEqual(hashes);
  });

  it("on a map that hides its lowest level, flags cells lowered to level 0 unpathable, and clears them raised again (DL-14)", async () => {
    fixture = await keptGround();
    const data = path.join(fixture.mapPackage, "Base.SC2Data", "GameData");
    await mkdir(data, { recursive: true });
    await writeFile(path.join(data, "TerrainData.xml"), '<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n    <CTerrain id="MonlythEx1">\n        <HideLowestLevel value="1"/>\n    </CTerrain>\n</Catalog>\n');
    const before = await state(fixture.mapPackage);
    expect(before.cliffs.hidesLowestLevel).toBe(true);
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "lower-cliff" } }, { name: "pit" });
    const pit = await state(fixture.mapPackage);
    // Inside the snapped corners, off the cliff mesh: open sky, flagged as cliff.
    for (let y = 64; y <= 65; y++) {
      for (let x = 20; x <= 21; x++) {
        expect(pit.cliffs.syncCliff[y * SIZE + x], `sync cliff at (${x}, ${y})`).toBe(0);
        expect(pit.cliffs.cellFlags[y * SIZE + x]! & 0x01, `cell flag at (${x}, ${y})`).toBe(1);
      }
    }
    // The map's own cells now say it hides the level, TerrainData or not.
    await rm(path.join(data, "TerrainData.xml"));
    expect((await state(fixture.mapPackage)).cliffs.hidesLowestLevel).toBe(true);
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise-cliff" } }, { name: "fill" });
    expect((await state(fixture.mapPackage)).cliffs.cellFlags).toEqual(before.cliffs.cellFlags);
  });

  it("leaves cells lowered to level 0 pathable on a map that shows its lowest level", async () => {
    fixture = await keptGround();
    expect((await state(fixture.mapPackage)).cliffs.hidesLowestLevel).toBe(false);
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "lower-cliff" } }, { name: "pit" });
    const pit = await state(fixture.mapPackage);
    expect(pit.cliffs.syncCliff[64 * SIZE + 20]).toBe(0);
    expect(pit.cliffs.cellFlags[64 * SIZE + 20]! & 0x01).toBe(0);
    expectConsistent(pit, 12, 56, 30, 74);
  });

  it("fills an empty self-closing cliff set list with the tileset's natural set", async () => {
    fixture = await keptGround();
    const xmlPath = path.join(fixture.mapPackage, "t3Terrain.xml");
    const xml = await readFile(xmlPath, "utf8");
    // No sets, and no cell painted with one.
    const bare = xml.replace(/[ \t]*<cliffSetList\b[\s\S]*?<\/cliffSetList>/, '        <cliffSetList num="0"/>').replace(/ cid="\d+"/g, ' cid="0"');
    expect(bare).toContain('<cliffSetList num="0"/>');
    await writeFile(xmlPath, bare);
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise-cliff" } }, { name: "test" });
    expect(result.summary).toMatch(/^Raised the cliff level/);
    const after = await state(fixture.mapPackage);
    expect(after.cliffs.cliffSets).toHaveLength(1);
    expect(after.cliffs.xml.match(/<cliffSetList/g)).toHaveLength(1);
    expect(after.cliffs.xml).toMatch(/<cliffSetList num="1">\r?\n\s*<cliffSet i="0" name="\w+"\/>\r?\n\s*<\/cliffSetList>/);
  });

  it("refuses an area over a ramp", async () => {
    fixture = await keptGround();
    const hashes = await hashTree(fixture.mapPackage);
    // The temple gate's ramp, on its south edge.
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: { rect: { x: 100, y: 72, width: 16, height: 12 } }, brush: { op: "lower-cliff" } }, { name: "test" })).rejects.toThrow(
      /is part of a ramp: remove the ramp first \(remove-ramp\)\. Nothing was written/,
    );
    expect(await hashTree(fixture.mapPackage)).toEqual(hashes);
  });
});

describe("ramps on Kept ground", { timeout: 60_000 }, () => {
  const UPHILL = ["south", "north", "west", "east", "south-west", "south-east", "north-west", "north-east"] as const;
  /** The temple gate's ramp (Blueprint `ramps`), as the generator wrote it on the crossing: the ramp the no-ramps import lacks. The same ramp on the Editor-saved fixture. */
  const generatorRamp = async () => {
    const reference = await generatedGround({ ramps: true });
    const plain = await generatedGround({ ramps: false });
    try {
      const without = new Set((await state(plain.mapPackage)).cliffs.ramps.map((ramp) => ramp.text));
      const [ramp, ...more] = (await state(reference.mapPackage)).cliffs.ramps.filter((candidate) => !without.has(candidate.text));
      expect(more).toEqual([]);
      const direction = Number(ramp!.attrs.dir);
      expect(direction).toBeLessThan(4);
      // A straight ramp's base piece sits a cell below its top edge.
      const [x, y] = /c=\(([^,]+), ([^)]+)\)/.exec(ramp!.attrs.base!)!.slice(1).map(Number) as [number, number];
      const at = { x: Math.round(x + [0, 0, -1, 1][direction]!), y: Math.round(y + [-1, 1, 0, 0][direction]!) };
      return { op: "add-ramp", at, uphill: UPHILL[direction]!, low: Number(ramp!.attrs.lo), high: Number(ramp!.attrs.hi) } satisfies CliffBrush;
    } finally {
      await removeKeptGround(reference);
      await removeKeptGround(plain);
    }
  };

  it("adds a ramp between two levels that matches what the generator writes for the same ramp", async () => {
    const reference = await generatedGround({ ramps: true });
    fixture = await generatedGround({ ramps: false });
    try {
      const brush = await generatorRamp();
      const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush }, { name: "ramp" });
      expect(result.summary).toMatch(/^Added a straight ramp up north from level 1 to 2 at \(\d+, \d+\) \(\w+\): \d+ cells changed/);
      // The generated crossing, ramp and all.
      const generated = await state(reference.mapPackage);
      const kept = await state(fixture.mapPackage);
      expect(kept.cliffs.ramps.map((ramp) => ramp.text)).toEqual(generated.cliffs.ramps.map((ramp) => ramp.text));
      expect([...kept.cliffs.cells]).toEqual([...generated.cliffs.cells]);
      expect(kept.cliffs.syncCliff).toEqual(generated.cliffs.syncCliff);
      expect(kept.cliffs.cellFlags).toEqual(generated.cliffs.cellFlags);
      expect(kept.ground.levels).toEqual(generated.ground.levels);
      for (let v = 0; v < kept.ground.cliff.length; v++) expect(Math.abs(kept.ground.cliff[v]! - generated.ground.cliff[v]!), `r1 at vertex ${v}`).toBeLessThan(1e-3);
    } finally {
      await removeKeptGround(reference);
    }
  });

  it("refuses a ramp whose top and bottom don't meet its levels, and one that climbs more than a level", async () => {
    fixture = await generatedGround({ ramps: false });
    const brush = await generatorRamp();
    const hashes = await hashTree(fixture.mapPackage);
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { ...brush, low: 2, high: 3 } }, { name: "test" })).rejects.toThrow(
      /needs a straight edge one level up; found level 2, so a ramp from level 2 to 3 doesn't fit there\. Nothing was written/,
    );
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { ...brush, at: { x: 20, y: 64 } } }, { name: "test" })).rejects.toThrow(/doesn't fit there\. Nothing was written/);
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { ...brush, high: 3 } }, { name: "test" })).rejects.toThrow("A stock ramp climbs one cliff level, from 1 to 2, not to 3. Nothing was written");
    expect(await hashTree(fixture.mapPackage)).toEqual(hashes);
  });

  it("removes a stock ramp back to plain cliff, and adding it again puts it back as it was", async () => {
    fixture = await keptGround();
    const before = await state(fixture.mapPackage);
    const brush = await generatorRamp();
    const removed = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { op: "remove-ramp", at: { x: brush.at.x, y: brush.at.y - 2 } } }, { name: "remove" });
    expect(removed.summary).toMatch(/^Removed the straight ramp up north from level 1 to 2 at /);
    const plain = await state(fixture.mapPackage);
    expect(plain.cliffs.ramps).toEqual([]);
    expect(await readFile(path.join(fixture.mapPackage, "t3Terrain.xml"), "utf8")).not.toContain("rampList");
    expectConsistent(plain, 96, 70, 120, 86);
    // The fixture's walking heights (WALKING_OFFSET above the render height) go where the cliff moved.
    const moved = Array.from(plain.ground.cliff.keys()).filter((v) => plain.ground.cliff[v] !== before.ground.cliff[v]);
    expect(moved.some((v) => before.ground.syncHeightMap.readInt16LE(64 + v * 4) - Math.round(before.ground.heights[v]! * 256) === WALKING_OFFSET)).toBe(true);
    for (const v of moved) expect(Math.abs(plain.ground.syncHeightMap.readInt16LE(64 + v * 4) - Math.round(plain.ground.heights[v]! * 256))).toBeLessThanOrEqual(2);

    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush }, { name: "add" });
    const again = await state(fixture.mapPackage);
    expect(again.cliffs.xml).toBe(before.cliffs.xml);
    expect(again.cliffs.syncCliffFile.equals(before.cliffs.syncCliffFile)).toBe(true);
    expect(again.cliffs.cellFlagsFile.equals(before.cliffs.cellFlagsFile)).toBe(true);
    expect(again.ground.levels).toEqual(before.ground.levels);
    for (let v = 0; v < again.ground.cliff.length; v++) expect(again.ground.heightMap.readUInt16LE(32 + v * 6 + 2), `r1 at vertex ${v}`).toBe(before.ground.heightMap.readUInt16LE(32 + v * 6 + 2));
  });

  it("fills an empty self-closing ramp list, and puts a named cliff set on the ramp and its cells", async () => {
    fixture = await generatedGround({ ramps: false });
    const xmlPath = path.join(fixture.mapPackage, "t3Terrain.xml");
    const xml = await readFile(xmlPath, "utf8");
    await writeFile(xmlPath, xml.replace("</cliffSetList>", '</cliffSetList>\n        <rampList num="0"/>'));
    const { cliffs } = await state(fixture.mapPackage);
    const named = cliffs.cliffSets.at(-1)!;
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { ...(await generatorRamp()), cliffSet: named } }, { name: "ramp" });
    const after = await state(fixture.mapPackage);
    expect(after.cliffs.xml.match(/<rampList/g)).toHaveLength(1);
    expect(after.cliffs.ramps).toHaveLength(1);
    const cid = cliffs.cliffSets.indexOf(named);
    expect(after.cliffs.ramps[0]!.attrs.cid).toBe(String(cid));
    for (const [index, entry] of after.cliffs.cells) if (entry.f & 2) expect(after.cliffs.cells.get(index)!.cid, `cliff cell ${index}`).toBe(cid);
  });

  it("refuses a ramp whose cliff wears a set the map's list doesn't have, when none is named", async () => {
    fixture = await generatedGround({ ramps: false });
    const brush = await generatorRamp();
    const xmlPath = path.join(fixture.mapPackage, "t3Terrain.xml");
    await writeFile(xmlPath, (await readFile(xmlPath, "utf8")).replace(/(<cc [^>]*f="1"[^>]*cid=")\d+"/g, '$19"'));
    const hashes = await hashTree(fixture.mapPackage);
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush }, { name: "ramp" })).rejects.toThrow(
      /^The cliff the ramp cuts wears cliff set 9, which t3Terrain\.xml's <cliffSetList> doesn't have \(\w+.*\): name one of those with cliffSet\. Nothing was written$/,
    );
    expect(await hashTree(fixture.mapPackage)).toEqual(hashes);
  });

  it("refuses a ramp list it can't read back as written", async () => {
    fixture = await keptGround();
    const xmlPath = path.join(fixture.mapPackage, "t3Terrain.xml");
    const xml = await readFile(xmlPath, "utf8");
    await writeFile(xmlPath, xml.replace(/(<ramp\s[^>]*)\/>/, "$1></ramp>"));
    const hashes = await hashTree(fixture.mapPackage);
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise-cliff" } }, { name: "test" })).rejects.toThrow(
      "t3Terrain.xml's ramps aren't in the form the Editor writes, so the cliffs aren't edited",
    );
    expect(await hashTree(fixture.mapPackage)).toEqual(hashes);
  });

  it("refuses removing where there's no stock ramp, and an area given with a ramp", async () => {
    fixture = await keptGround();
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { op: "remove-ramp", at: { x: 20, y: 64 } } }, { name: "test" })).rejects.toThrow(
      "No stock ramp is within 6 cells of (20, 64). Nothing was written",
    );
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "remove-ramp", at: { x: 20, y: 64 } } }, { name: "test" })).rejects.toThrow(
      "area: remove-ramp takes no area: the ramp's own footprint is its area",
    );
  });
});

describe("the static shadow bake", { timeout: 60_000 }, () => {
  const rebake = (check: Awaited<ReturnType<typeof checkWorkspace>>) => check.problems.filter((problem) => problem.message.includes("Static shadows"));

  it("is reset by a cliff edit and warned about by the check until the map is rebaked in the Editor", async () => {
    fixture = await keptGround();
    const vertCol = path.join(fixture.mapPackage, "t3VertCol");
    expect(hasShadowBake(await readFile(vertCol))).toBe(true);
    expect(rebake(await checkWorkspace(fixture.root))).toEqual([]);

    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise-cliff" } }, { name: "test" });
    const reset = await readFile(vertCol);
    expect(hasShadowBake(reset)).toBe(false);
    expect(reset.length).toBe((await readFile(vertCol)).length);
    expect(rebake(await checkWorkspace(fixture.root))).toEqual([
      { mission: "quarry", file: "missions/quarry/Quarry.SC2Map/t3VertCol", message: "Static shadows need a rebake: Data > Generate Static Shadows (Cmd-Shift-L) in the Editor: Quarry.SC2Map has cliffs and no bake in t3VertCol", severity: "warning" },
    ]);

    // The author's rebake in the Editor.
    const { ground } = await state(fixture.mapPackage);
    await writeFile(vertCol, bakedVertCol(SIZE, SIZE, ground.levels));
    expect(rebake(await checkWorkspace(fixture.root))).toEqual([]);
  });

  it("is kept by a height edit", async () => {
    fixture = await keptGround();
    const vertCol = await readFile(path.join(fixture.mapPackage, "t3VertCol"));
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "raise", by: 0.5 } }, { name: "test" });
    expect(result.warnings.filter((warning) => warning.includes("shadow"))).toEqual([]);
    expect((await readFile(path.join(fixture.mapPackage, "t3VertCol"))).equals(vertCol)).toBe(true);
  });
});

describe("the edit_kept_terrain MCP tool's cliff brushes", () => {
  it("removes a ramp with no area, and asks for the rebake", async () => {
    fixture = await keptGround();
    const reply = await (await connect(fixture.root)).callTool({ name: "edit_kept_terrain", arguments: { mission: "quarry", brush: { op: "remove-ramp", at: { x: 108, y: 78 } }, name: "mcp" } });
    expect(reply.isError).toBeFalsy();
    const structured = reply.structuredContent as { cliffCells: number; files: string[] };
    expect(structured.cliffCells).toBeGreaterThan(0);
    expect(structured.files).toEqual(["t3HeightMap", "t3SyncHeightMap", "t3SyncCliffLevel", "t3CellFlags", "t3Terrain.xml", "t3VertCol"]);
    expect(text(reply)).toMatch(/^Removed the straight ramp up north from level 1 to 2 at \(108, 80\)/);
    expect(text(reply)).toContain(`warning: Static shadows need a rebake: Data > Generate Static Shadows (Cmd-Shift-L) in the Editor (the bake in t3VertCol was reset)`);
  }, 60_000);
});

describe("the add-ramp brush's levels", () => {
  it("runs up to the Editor's level 15, as raise-cliff does (#525)", () => {
    const ramp = (low: number, high: number) => CliffBrushSchema.safeParse({ op: "add-ramp", at: { x: 20, y: 20 }, uphill: "north", low, high }).success;
    expect(ramp(7, 8)).toBe(true);
    expect(ramp(14, 15)).toBe(true);
    expect(ramp(15, 16)).toBe(false);
  });
});
