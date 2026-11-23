// Paint brushes on Kept ground (spec #247, ticket #249): paint an area with one of the map's 8
// textures, feathered in the texture masks, and swap a texture slot map-wide once the author has
// seen its reach. The package is synthetic (tests/support/kept-ground.ts): the crossing fixture
// imported, its masks painted by the generator as the Editor's brush paints them (every texel's 8
// weights sum to 15).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { editKeptTerrain } from "../../src/map/edit-kept-terrain.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { readT3TerrainXml } from "../../src/terrain/read-t3-terrain-xml.js";
import { readT3TextureMasks, type T3TextureMasks } from "../../src/terrain/read-t3-texture-masks.js";
import { connect, text } from "../mcp/harness.js";
import { type KeptGroundFixture, keptGround, removeKeptGround } from "../support/kept-ground.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));

const SIZE = 128;
const TEXELS = 8;
/** Open level-1 ground round the Well. */
const YARD = { rect: { x: 16, y: 60, width: 8, height: 8 } };
/** Slot 7 of the crossing's textures, painted nowhere near the Well. */
const GRATING = "MeinhoffGrating";

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
const changedFiles = (before: Record<string, string>, after: Record<string, string>) => Object.keys(after).filter((file) => after[file] !== before[file]).sort();
const masksOf = async (mapPackage: string) => readT3TextureMasks(await readFile(path.join(mapPackage, "t3TextureMasks")));
const texel = (masks: T3TextureMasks, layer: number, x: number, y: number) => masks.layers[layer]![y * masks.maskWidth + x]!;
/** The texels whose weights differ, as [x, y]. */
/** t3SyncTextureInfo's 8 names and each cell's texture index. */
function readSync(file: Buffer): { names: string[]; cells: number[] } {
  let at = 20;
  const names: string[] = [];
  for (let i = 0; i < 8; i++) {
    const end = file.indexOf(0, at);
    names.push(file.toString("ascii", at, end));
    at = end + 1;
  }
  return { names, cells: Array.from({ length: SIZE * SIZE }, (_, cell) => file.readUInt32LE(at + cell * 8)) };
}
const syncOf = async (mapPackage: string) => readSync(await readFile(path.join(mapPackage, "t3SyncTextureInfo")));
/** Each layer's total weight over a cell's 64 texels. */
const cellTotals = (masks: T3TextureMasks, cell: number) =>
  masks.layers.map((layer) => {
    let sum = 0;
    for (let y = 0; y < TEXELS; y++) for (let x = 0; x < TEXELS; x++) sum += layer[(Math.floor(cell / SIZE) * TEXELS + y) * masks.maskWidth + (cell % SIZE) * TEXELS + x]!;
    return sum;
  });

function changedTexels(before: T3TextureMasks, after: T3TextureMasks): [number, number][] {
  const out: [number, number][] = [];
  for (let t = 0; t < before.maskWidth * before.maskHeight; t++) {
    if (before.layers.some((layer, l) => layer[t] !== after.layers[l]![t])) out.push([t % before.maskWidth, Math.floor(t / before.maskWidth)]);
  }
  return out;
}

describe("painting Kept ground with one of the map's textures", { timeout: 60_000 }, () => {
  it("changes mask texels only inside the area plus its falloff, and blends its edge over the falloff's width", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    const masksBefore = await masksOf(fixture.mapPackage);
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "paint", texture: GRATING } }, { name: "test" });
    const masksAfter = await masksOf(fixture.mapPackage);

    expect(changedFiles(before, await hashTree(fixture.mapPackage)).filter((file) => !file.startsWith("../"))).toEqual(["t3SyncTextureInfo", "t3TextureMasks"]);
    expect(result.files.slice().sort()).toEqual(["t3SyncTextureInfo", "t3TextureMasks"]);
    const texels = changedTexels(masksBefore, masksAfter);
    // The 8×8 cells and a soft falloff of 3 cells round them, in texels.
    for (const [x, y] of texels) {
      expect(x).toBeGreaterThanOrEqual((16 - 3) * TEXELS);
      expect(x).toBeLessThan((24 + 3) * TEXELS);
      expect(y).toBeGreaterThanOrEqual((60 - 3) * TEXELS);
      expect(y).toBeLessThan((68 + 3) * TEXELS);
    }
    expect(texels.length).toBeGreaterThan(64 * 64);
    // Inside, the ground is all grating; everywhere the weights still sum to 15, as the Editor's brush leaves them.
    for (let y = 60 * TEXELS; y < 68 * TEXELS; y++) for (let x = 16 * TEXELS; x < 24 * TEXELS; x++) expect(texel(masksAfter, 7, x, y)).toBe(15);
    for (const [x, y] of texels) expect(masksAfter.layers.reduce((sum, layer) => sum + layer[y * masksAfter.maskWidth + x]!, 0)).toBe(15);

    // East along the middle row: from all grating at the edge to as it was 3 cells out, never rising.
    const row = 64 * TEXELS + 4;
    const east = Array.from({ length: 3 * TEXELS + 4 }, (_, k) => texel(masksAfter, 7, 24 * TEXELS + k, row));
    expect(texel(masksBefore, 7, 24 * TEXELS, row)).toBe(0);
    for (let k = 1; k < east.length; k++) expect(east[k]).toBeLessThanOrEqual(east[k - 1]!);
    expect(east[0]).toBeGreaterThanOrEqual(14);
    // Half way out (1.5 cells) it is about half grating, and it fades to nothing by 3 cells.
    expect(east[12]).toBeGreaterThanOrEqual(5);
    expect(east[12]).toBeLessThanOrEqual(10);
    expect(new Set(east.filter((w) => w > 0 && w < 15)).size).toBeGreaterThanOrEqual(8);
    expect(east.slice(3 * TEXELS)).toEqual([0, 0, 0, 0]);
    expect(result.summary).toMatch(/^Painted the 8×8 cells at \(16, 60\) with MeinhoffGrating \(slot 7\)/);
  });

  it("gives each changed cell its dominant texture in the sync texture info, and leaves the other cells' as they were", async () => {
    fixture = await keptGround();
    const masksBefore = await masksOf(fixture.mapPackage);
    const syncBefore = await syncOf(fixture.mapPackage);
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "paint", texture: GRATING } }, { name: "test" });
    const masksAfter = await masksOf(fixture.mapPackage);
    const syncAfter = await syncOf(fixture.mapPackage);

    expect(syncAfter.names).toEqual(syncBefore.names);
    const changed = new Set(changedTexels(masksBefore, masksAfter).map(([x, y]) => Math.floor(y / TEXELS) * SIZE + Math.floor(x / TEXELS)));
    let feathered = 0;
    for (let cell = 0; cell < SIZE * SIZE; cell++) {
      if (!changed.has(cell)) {
        expect(syncAfter.cells[cell]).toBe(syncBefore.cells[cell]);
        continue;
      }
      // The texture with the most weight over the cell; the lower slot on a tie.
      const totals = cellTotals(masksAfter, cell);
      expect(syncAfter.cells[cell]).toBe(totals.indexOf(Math.max(...totals)));
      if (totals[7]! > 0 && totals[7]! < 15 * 64) feathered++;
    }
    for (let y = 60; y < 68; y++) for (let x = 16; x < 24; x++) expect(syncAfter.cells[y * SIZE + x]).toBe(7);
    // The feathered ring: some cells mostly grating now, some still mostly what they were.
    expect(feathered).toBeGreaterThan(40);
    expect(syncAfter.cells.filter((texture, cell) => changed.has(cell) && texture !== 7).length).toBeGreaterThan(10);
  });

  it("takes a slot number as well as a name, and paints only the area itself with a sharp edge", async () => {
    fixture = await keptGround();
    const masksBefore = await masksOf(fixture.mapPackage);
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: { ...YARD, falloff: "sharp" }, brush: { op: "paint", texture: 7 } }, { name: "test" });
    const texels = changedTexels(masksBefore, await masksOf(fixture.mapPackage));
    expect(texels.length).toBe(64 * 64);
    for (const [x, y] of texels) {
      expect(Math.floor(x / TEXELS)).toBeGreaterThanOrEqual(16);
      expect(Math.floor(x / TEXELS)).toBeLessThan(24);
      expect(Math.floor(y / TEXELS)).toBeGreaterThanOrEqual(60);
      expect(Math.floor(y / TEXELS)).toBeLessThan(68);
    }
    expect(result.summary).toBe("Painted the 8×8 cells at (16, 60) with MeinhoffGrating (slot 7), with a sharp edge: 64 cells changed (4096 texels), 64 now mostly MeinhoffGrating");
    expect(result.texels).toBe(4096);
  });

  it("refuses a texture the map doesn't have, naming its 8 and the slot swap, and writes nothing", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    const edit = editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "paint", texture: "KorhalCityEx2_3" } });
    await expect(edit).rejects.toThrow(
      'The map has no texture KorhalCityEx2_3. Its 8 are 0 MeinhoffSandDunes, 1 MeinhoffWhiteSand, 2 MeinhoffRoughSand, 3 MeinhoffCraters, 4 MeinhoffRock, 5 MeinhoffConcrete, 6 MeinhoffPanels, 7 MeinhoffGrating. Paint with one of those, or put KorhalCityEx2_3 in a slot first with a slot swap ({ "op": "swap-slot", "slot", "texture": "KorhalCityEx2_3" })',
    );
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
  });

  it("renders the stroke and reports it on a dry run, writing nothing to the package", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "paint", texture: GRATING } }, { dryRun: true, name: "dry" });
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
    expect(result.files).toEqual([]);
    expect(result.summary).toMatch(/^Would paint the 8×8 cells at \(16, 60\) with MeinhoffGrating \(slot 7\), feathered over 3 cells: \d+ cells changed/);
    for (const file of Object.values(result.renders)) expect((await readFile(file)).subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(Object.keys(result.legend ?? {})).toContain(GRATING);
  });
});

describe("packages that differ from the usual", { timeout: 60_000 }, () => {
  it("refuses painting an empty slot by number, and fills one with a swap", async () => {
    fixture = await keptGround();
    const xmlFile = path.join(fixture.mapPackage, "t3Terrain.xml");
    await writeFile(xmlFile, (await readFile(xmlFile, "utf8")).replace('<texture i="6" name="MeinhoffPanels"/>', '<texture i="6" name=""/>'));
    const before = await hashTree(fixture.mapPackage);
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "paint", texture: 6 } })).rejects.toThrow(/^Slot 6 is empty: the map's 8 are .*6 \(empty\)/);
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
    const filled = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { op: "swap-slot", slot: 6, texture: "KorhalCityEx2_3" } }, { confirm: true, name: "fill" });
    expect(filled.files).toEqual(["t3Terrain.xml", "t3SyncTextureInfo"]);
    expect(readT3TerrainXml(await readFile(xmlFile, "utf8")).textures[6]).toBe("KorhalCityEx2_3");
  });

  it("swaps only the slot's own name in t3SyncTextureInfo, keeping the others as the file has them", async () => {
    fixture = await keptGround();
    const syncFile = path.join(fixture.mapPackage, "t3SyncTextureInfo");
    // A sync file whose slot 0 name differs from t3Terrain.xml's, as a stale save might leave it (same length, so the cells stay put).
    const stale = Buffer.from(await readFile(syncFile));
    stale.write("meinhoffSandDunes", 20, "ascii");
    await writeFile(syncFile, stale);
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { op: "swap-slot", slot: 4, texture: "KorhalCityEx2_3" } }, { confirm: true, name: "swap" });
    expect((await syncOf(fixture.mapPackage)).names).toEqual(["meinhoffSandDunes", "MeinhoffWhiteSand", "MeinhoffRoughSand", "MeinhoffCraters", "KorhalCityEx2_3", "MeinhoffConcrete", "MeinhoffPanels", "MeinhoffGrating"]);
  });

  it("paints a package without height maps, which painting doesn't need", async () => {
    fixture = await keptGround();
    for (const file of ["t3HeightMap", "t3SyncHeightMap", "MapInfo"]) await rm(path.join(fixture.mapPackage, file));
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "paint", texture: GRATING } }, { name: "test" });
    expect(result.files.slice().sort()).toEqual(["t3SyncTextureInfo", "t3TextureMasks"]);
  });
});

describe("swapping one of the map's texture slots", { timeout: 60_000 }, () => {
  /** Slot 4 of the crossing, painted on its rocky ground; swapped for a texture the map doesn't have. */
  const SWAP = { op: "swap-slot", slot: "MeinhoffRock", texture: "KorhalCityEx2_3" } as const;
  const pngWidth = (png: Buffer) => png.readUInt32BE(16);

  it("without a yes, renders every cell the slot covers, map-wide, and writes nothing", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: SWAP }, { name: "swap" });

    expect(await hashTree(fixture.mapPackage)).toEqual(before);
    expect(result.files).toEqual([]);
    expect(result.cells).toBeGreaterThan(100);
    expect(result.summary).toMatch(new RegExp(`^Would swap slot 4, MeinhoffRock, for KorhalCityEx2_3\\. It covers ${result.cells} cells \\(at least 10% of their weight; \\d+ with any\\), \\d+ of them mostly MeinhoffRock`));
    expect(result.warnings.join(" ")).toContain("run it again with --confirm");
    // The whole 128-cell map, 4 px a cell.
    for (const file of Object.values(result.renders)) expect(pngWidth(await readFile(file))).toBe(SIZE * 4);
    expect(Object.keys(result.legend ?? {})).toEqual(expect.arrayContaining(["MeinhoffRock", "KorhalCityEx2_3"]));
  });

  it("with a yes, renames the slot in t3Terrain.xml and the sync texture names, and leaves the masks as they were", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    const xmlBefore = await readFile(path.join(fixture.mapPackage, "t3Terrain.xml"), "utf8");
    const syncBefore = await syncOf(fixture.mapPackage);
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: SWAP }, { confirm: true, name: "swap" });

    expect(changedFiles(before, await hashTree(fixture.mapPackage))).toEqual(["t3SyncTextureInfo", "t3Terrain.xml"]);
    expect(result.files).toEqual(["t3Terrain.xml", "t3SyncTextureInfo"]);
    const xmlAfter = await readFile(path.join(fixture.mapPackage, "t3Terrain.xml"), "utf8");
    const lines = [xmlBefore.split("\n"), xmlAfter.split("\n")] as const;
    expect(lines[1].length).toBe(lines[0].length);
    expect(lines[1].filter((line, i) => line !== lines[0][i])).toEqual([lines[0].find((line) => line.includes('<texture i="4"'))!.replace("MeinhoffRock", "KorhalCityEx2_3")]);
    expect(readT3TerrainXml(xmlAfter).textures.slice(0, 8)).toEqual(["MeinhoffSandDunes", "MeinhoffWhiteSand", "MeinhoffRoughSand", "MeinhoffCraters", "KorhalCityEx2_3", "MeinhoffConcrete", "MeinhoffPanels", "MeinhoffGrating"]);
    const syncAfter = await syncOf(fixture.mapPackage);
    expect(syncAfter.names).toEqual(readT3TerrainXml(xmlAfter).textures.slice(0, 8));
    expect(syncAfter.cells).toEqual(syncBefore.cells);
    expect(result.summary).toMatch(/^Swapped slot 4, MeinhoffRock, for KorhalCityEx2_3: the \d+ cells/);
  });

  it("writes nothing on a dry run, even with a yes", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: SWAP }, { confirm: true, dryRun: true, name: "swap" });
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
    expect(result.files).toEqual([]);
  });

  it("refuses a texture already in a slot, one the game doesn't have, and an area", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    const swap = (brush: object, area?: object) => editKeptTerrain(fixture!.workspace, fixture!.blueprintPath, { ...(area ? { area } : {}), brush } as never, { confirm: true });
    await expect(swap({ op: "swap-slot", slot: 4, texture: GRATING })).rejects.toThrow('MeinhoffGrating is in slot 7 already: paint with it there ({ "op": "paint", "texture": 7 })');
    await expect(swap({ op: "swap-slot", slot: 4, texture: "NoSuchTexture" })).rejects.toThrow("NoSuchTexture isn't a terrain texture the game has");
    await expect(swap({ op: "swap-slot", slot: "Lava", texture: "KorhalCityEx2_3" })).rejects.toThrow("The map has no texture Lava");
    await expect(swap(SWAP, YARD)).rejects.toThrow("swap-slot takes no area: it changes every cell the slot covers, map-wide");
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
  });
});

describe("emptying a texture slot nothing paints", { timeout: 60_000 }, () => {
  /** Slot 6 of the crossing, painted nowhere. */
  const PANELS = 6;

  it("writes the slot's name as \"\" in t3Terrain.xml and the sync texture names, as the Editor writes an empty slot, and changes no other byte", async () => {
    fixture = await keptGround();
    // With CRLF line ends, as the Editor saves t3Terrain.xml.
    const xmlFile = path.join(fixture.mapPackage, "t3Terrain.xml");
    await writeFile(xmlFile, (await readFile(xmlFile, "utf8")).replace(/\r?\n/g, "\r\n"));
    const before = await hashTree(fixture.mapPackage);
    const xmlBefore = await readFile(xmlFile, "utf8");
    const syncBefore = await readFile(path.join(fixture.mapPackage, "t3SyncTextureInfo"));
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { op: "clear-slot", slot: PANELS } }, { name: "clear" });

    expect(changedFiles(before, await hashTree(fixture.mapPackage))).toEqual(["t3SyncTextureInfo", "t3Terrain.xml"]);
    expect(result.files).toEqual(["t3Terrain.xml", "t3SyncTextureInfo"]);
    const xmlAfter = await readFile(xmlFile, "utf8");
    // The one line, CRLF kept, in the Editor's own empty-slot form (tests/fixtures/editor-terrain/texture-sets).
    const line = xmlBefore.split("\n").find((l) => l.includes('<texture i="6"'))!;
    expect(xmlAfter).toBe(xmlBefore.replace(line, line.replace('name="MeinhoffPanels"', 'name=""')));
    expect(line.endsWith("\r")).toBe(true);
    // The sync file loses the name's bytes and keeps its bare \0; every other byte stays.
    const syncAfter = await readFile(path.join(fixture.mapPackage, "t3SyncTextureInfo"));
    const at = syncBefore.indexOf("MeinhoffPanels\0", 20, "ascii");
    expect(syncAfter.equals(Buffer.concat([syncBefore.subarray(0, at), syncBefore.subarray(at + "MeinhoffPanels".length)]))).toBe(true);
    expect((await syncOf(fixture.mapPackage)).names[PANELS]).toBe("");
    expect(result.summary).toBe("Emptied slot 6, MeinhoffPanels, painted nowhere: the map now uses 7 different textures, of the Editor's 16");
  });

  it("takes the slot by name, and writes nothing on a dry run, renders included", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { op: "clear-slot", slot: "MeinhoffPanels" } }, { dryRun: true, name: "clear" });
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
    expect(result.files).toEqual([]);
    // It changes no cell's look, so it renders nothing.
    expect(result.renders).toBeUndefined();
    expect(existsSync(path.join(path.dirname(fixture.blueprintPath), "renders", "clear"))).toBe(false);
    expect(result.summary).toBe("Would empty slot 6, MeinhoffPanels, painted nowhere: the map would then use 7 different textures, of the Editor's 16");
  });

  it("refuses a slot something paints, naming the cells, and an empty slot or an area, writing nothing", async () => {
    fixture = await keptGround();
    const before = await hashTree(fixture.mapPackage);
    const clear = (brush: object, area?: object) => editKeptTerrain(fixture!.workspace, fixture!.blueprintPath, { ...(area ? { area } : {}), brush } as never);
    await expect(clear({ op: "clear-slot", slot: 4 })).rejects.toThrow(/^MeinhoffRock \(slot 4\) has weight in 354 cells, so it isn't emptied: \(\d+, \d+\)(, \(\d+, \d+\)){9} and 344 more, in cells \d+-\d+ × \d+-\d+\. Paint them with another texture first. Nothing was written$/);
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { op: "clear-slot", slot: PANELS } }, { name: "clear" });
    const emptied = await hashTree(fixture.mapPackage);
    await expect(clear({ op: "clear-slot", slot: PANELS })).rejects.toThrow("Slot 6 is empty already: nothing to clear");
    await expect(clear({ op: "clear-slot", slot: 7 }, YARD)).rejects.toThrow("clear-slot takes no area: it empties the slot map-wide");
    expect(await hashTree(fixture.mapPackage)).toEqual(emptied);
    expect(emptied).not.toEqual(before);
  });

  it("refuses a slot a cell's sync texture names with no weight there, naming the cell", async () => {
    fixture = await keptGround();
    // Cell (5, 9)'s sync texture points at slot 6, though none of its texels has weight there.
    const syncFile = path.join(fixture.mapPackage, "t3SyncTextureInfo");
    const sync = await readFile(syncFile);
    let at = 20;
    for (let i = 0; i < 8; i++) at = sync.indexOf(0, at) + 1;
    sync.writeUInt32LE(PANELS, at + (9 * SIZE + 5) * 8);
    await writeFile(syncFile, sync);
    const before = await hashTree(fixture.mapPackage);
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { op: "clear-slot", slot: PANELS } })).rejects.toThrow(
      "MeinhoffPanels (slot 6) is the sync texture (t3SyncTextureInfo) of 1 cell with no weight on it, which would then name an empty slot, so it isn't emptied: (5, 9). Paint them with another texture first. Nothing was written",
    );
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
  });

  it("refuses a slot whose texture a generating Zone names, naming the Zone", async () => {
    fixture = await keptGround();
    const blueprint = JSON.parse(await readFile(fixture.blueprintPath, "utf8")) as { zones?: unknown[] };
    const square = [
      { x: 16, y: 60 },
      { x: 24, y: 60 },
      { x: 24, y: 68 },
      { x: 16, y: 68 },
    ];
    const zone = { id: "panels", name: "Panels", elevation: 1, landform: "flat", role: "path", terrain: "generate", texture: "MeinhoffPanels", polygon: square, connections: [] };
    await writeFile(fixture.blueprintPath, JSON.stringify({ ...blueprint, zones: [...(blueprint.zones ?? []), zone] }, null, 2));
    const before = await hashTree(fixture.mapPackage);
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { brush: { op: "clear-slot", slot: PANELS } })).rejects.toThrow(
      "MeinhoffPanels (slot 6) is the texture of generating Zone panels, which the next compile paints from texture set 0's slots, so it isn't emptied: give the Zone another texture in the Blueprint first. Nothing was written",
    );
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
  });
});

describe("Compiled ground", { timeout: 60_000 }, () => {
  it("refuses a stroke on generated ground, naming the Zone's texture in the Blueprint", async () => {
    other = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-paint-"));
    await cp(CROSSING, other, { recursive: true });
    const blueprintPath = path.join(other, "missions", "ashen-crossing", "blueprint.json");
    const workspace = await loadWorkspace(other);
    const { outputDir } = await compileMission(workspace, blueprintPath, undefined, { savedAt: new Date("2026-01-01T00:00:00Z") });
    const before = await hashTree(outputDir);
    const zones = JSON.parse(await readFile(blueprintPath, "utf8")).zones as { id: string }[];
    await expect(editKeptTerrain(workspace, blueprintPath, { area: { rect: { x: 104, y: 84, width: 4, height: 4 } }, brush: { op: "paint", texture: 0 } })).rejects.toThrow(
      `The terrain there is Compiled Content (t3TextureMasks is on the compile record): change zones.${zones.findIndex((zone) => zone.id === "temple_gate")} (temple_gate)'s texture in the Blueprint instead. Nothing was written`,
    );
    await expect(editKeptTerrain(workspace, blueprintPath, { brush: { op: "swap-slot", slot: 4, texture: "KorhalCityEx2_3" } }, { confirm: true })).rejects.toThrow(
      "The texture list is Compiled Content (t3Terrain.xml is on the compile record): change the Blueprint's textures (slot 4) instead. Nothing was written",
    );
    await expect(editKeptTerrain(workspace, blueprintPath, { brush: { op: "clear-slot", slot: 7 } })).rejects.toThrow(
      "The texture list is Compiled Content (t3Terrain.xml is on the compile record): change the Blueprint's textures (slot 7) instead. Nothing was written",
    );
    expect(await hashTree(outputDir)).toEqual(before);
  });

  it("refuses a stroke reaching texture cells the compile record lists, and paints elsewhere", async () => {
    fixture = await keptGround();
    await writeFile(path.join(fixture.missionDir, "compile-record.json"), JSON.stringify({ version: 1, entries: [{ kind: "terrain-cells", file: "t3TextureMasks", cells: [[26, 64, 2, 2]], fingerprint: "0123456789abcdef" }] }));
    // The soft falloff reaches cells 24 to 26 past the yard's east edge, so column 26 of the listed 2×2 but not 27.
    await expect(editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: YARD, brush: { op: "paint", texture: 7 } })).rejects.toThrow(/^2 cells in the area are Compiled Content \(t3TextureMasks, on the compile record\), the first at \(26, 64\)/);
    const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area: { ...YARD, falloff: 1 }, brush: { op: "paint", texture: 7 } }, { name: "test" });
    expect(result.files.length).toBe(2);
  });
});

describe("the edit_kept_terrain MCP tool's paint brushes", { timeout: 60_000 }, () => {
  it("paints, and swaps a slot only with confirm", async () => {
    fixture = await keptGround();
    const client = await connect(fixture.root);
    const paint = await client.callTool({ name: "edit_kept_terrain", arguments: { mission: "quarry", area: YARD, brush: { op: "paint", texture: GRATING }, name: "mcp" } });
    expect(paint.isError).toBeFalsy();
    expect(text(paint)).toMatch(/^Painted the 8×8 cells at \(16, 60\) with MeinhoffGrating \(slot 7\)/);
    expect((paint.structuredContent as { texels: number }).texels).toBeGreaterThan(4096);
    expect(text(paint)).toContain("Colours: MeinhoffSandDunes rgb(");

    const swap = { op: "swap-slot", slot: 4, texture: "KorhalCityEx2_3" };
    const asked = await client.callTool({ name: "edit_kept_terrain", arguments: { mission: "quarry", brush: swap, name: "swap" } });
    expect(asked.isError).toBeFalsy();
    expect((asked.structuredContent as { files: string[] }).files).toEqual([]);
    expect(text(asked)).toContain("Nothing written");
    const done = await client.callTool({ name: "edit_kept_terrain", arguments: { mission: "quarry", brush: swap, confirm: true, name: "swap" } });
    expect((done.structuredContent as { files: string[] }).files).toEqual(["t3Terrain.xml", "t3SyncTextureInfo"]);
  });

  it("empties a slot nothing paints, with no confirm, and refuses one something does", async () => {
    fixture = await keptGround();
    const client = await connect(fixture.root);
    const refused = await client.callTool({ name: "edit_kept_terrain", arguments: { mission: "quarry", brush: { op: "clear-slot", slot: "MeinhoffRock" }, name: "clear" } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("MeinhoffRock (slot 4) has weight in 354 cells, so it isn't emptied");
    const done = await client.callTool({ name: "edit_kept_terrain", arguments: { mission: "quarry", brush: { op: "clear-slot", slot: 7 }, name: "clear" } });
    expect(done.isError).toBeFalsy();
    expect(text(done)).toMatch(/^Emptied slot 7, MeinhoffGrating, painted nowhere/);
    expect((done.structuredContent as { files: string[] }).files).toEqual(["t3Terrain.xml", "t3SyncTextureInfo"]);
  });
});
