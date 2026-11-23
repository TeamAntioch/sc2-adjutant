// Texture sets (#253): painting, slot swaps and block moves on a map with more than one texture
// set, checked against three Editor saves of one map (tests/fixtures/editor-terrain/texture-sets/).
// The first has CharDunes (set 1) on blocks 7-9 × 6-8; the second adds a grass stroke the Editor cut
// off at the square's west edge; the third moves 8 blocks south of the square onto set 1.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveArea } from "../../src/kept-terrain/area.js";
import { cellSet, findSeams, findSet, findTexture, type KeptTextures, moveBlocks, paintSlot, readKeptTextures, writeBlockMove, writePaint } from "../../src/kept-terrain/paint-brushes.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/editor-terrain/texture-sets/", import.meta.url));
const SIZE = 128;
const TEXELS = SIZE * 8;

type Save = { readonly xml: string; readonly masks: Buffer; readonly sync: Buffer };
const save = (dir: string): Save => ({
  xml: readFileSync(`${FIXTURES}${dir}t3Terrain.xml`, "utf8"),
  masks: gunzipSync(readFileSync(`${FIXTURES}${dir}t3TextureMasks.gz`)),
  sync: readFileSync(`${FIXTURES}${dir}t3SyncTextureInfo`),
});
const FIRST = save("");
const BOUNDARY = save("boundary/");
const BLOCK_MOVE = save("block-move/");
const read = ({ xml, masks, sync }: Save) => readKeptTextures(xml, masks, sync);
const rect = (x: number, y: number, width: number, height: number, falloff: "sharp" | number = "sharp") =>
  resolveArea({ rect: { x, y, width, height }, falloff }, { width: SIZE, height: SIZE, regions: [], points: [], kept: [] });
/** The square of set-1 blocks in the first save: cells 56-79 × 48-71. */
const SQUARE = { x: 56, y: 48, width: 24, height: 24 };
const inSquare = (cellX: number, cellY: number) => cellX >= SQUARE.x && cellX < SQUARE.x + SQUARE.width && cellY >= SQUARE.y && cellY < SQUARE.y + SQUARE.height;
/** The 8 blocks the third save moved onto set 1. */
const MOVED = [151, 152, 153, 167, 168, 169, 184, 185];
const syncSet = (textures: KeptTextures, sync: Buffer, cell: number) => sync.readUInt32LE(textures.syncCells + cell * 8 + 4);

describe("reading a map with two texture sets", () => {
  it("reads every slot, set and block, and the sync file's 16 names", () => {
    const textures = read(BOUNDARY);
    expect(textures.setCount).toBe(2);
    expect(textures.sets.slice(0, 2)).toEqual(["BelShirEx1", "CharDunes"]);
    expect(textures.slots.slice(0, 2)).toEqual(["BelShirDirtLight", "BelShirGrassLight"]);
    expect(textures.slots.slice(8, 13)).toEqual(["CharDunes_1", "CharDunes_5", "CharDunes_3", "CharDunes_6", "CharDunes_4"]);
    expect(textures.syncNames).toHaveLength(16);
    expect([...textures.blockSets].flatMap((set, block) => (set === 1 ? [block] : []))).toEqual([103, 104, 105, 119, 120, 121, 135, 136, 137]);
    expect(cellSet(textures, 56, 48)).toBe(1);
    expect(cellSet(textures, 55, 48)).toBe(0);
  });

  it("refuses a sync file whose cells disagree with the blocks' sets", () => {
    const sync = Buffer.from(FIRST.sync);
    const textures = read(FIRST);
    sync.writeUInt32LE(1, textures.syncCells + 4);
    expect(() => readKeptTextures(FIRST.xml, FIRST.masks, sync)).toThrow("t3SyncTextureInfo puts cell (0, 0) in texture set 1, but t3Terrain.xml puts its block in set 0");
  });

  it("finds a texture by name in each set that holds it, and a set by name or index", () => {
    const textures = read(FIRST);
    expect(findTexture(textures, "CharDunes_3")).toMatchObject({ texture: "CharDunes_3", slots: [10] });
    expect(findTexture(textures, 9).layerBySet.slice(0, 2)).toEqual([-1, 1]);
    expect(findSet(textures, "CharDunes")).toBe(1);
    expect(() => findSet(textures, 2)).toThrow("The map has no texture set 2: its sets are 0 BelShirEx1, 1 CharDunes");
    expect(() => findTexture(textures, 20)).toThrow("Slot 20 is in texture set 2, which the map doesn't have");
    const twice = { ...textures, slots: textures.slots.map((name, slot) => (slot === 3 ? "BelShirGrassLight" : name)) };
    expect(() => findTexture(twice, "BelShirGrassLight")).toThrow("BelShirGrassLight is in slots 1 and 3 of texture set 0: name the slot by its number");
  });
});

describe("painting across a boundary between sets", () => {
  it("paints only blocks whose set holds the texture, leaving 2 texels each side of the boundary, as the Editor does", () => {
    const textures = read(FIRST);
    // Grass (set 0) over the square's west edge, half on each side.
    const stroke = paintSlot(textures, rect(48, 52, 16, 12), findTexture(textures, "BelShirGrassLight"));
    let set1 = 0;
    let band = 0;
    let painted = 0;
    for (let t = 0; t < TEXELS * TEXELS; t++) {
      if (!stroke.changedTexels[t]) continue;
      const x = t % TEXELS;
      const y = Math.floor(t / TEXELS);
      painted++;
      if (inSquare(Math.floor(x / 8), Math.floor(y / 8))) set1++;
      if (x >= 446 && x < 450) band++;
    }
    expect(painted).toBeGreaterThan(0);
    expect(set1).toBe(0);
    expect(band).toBe(0);
    // The Editor's grass ran out to texel column 445; so does ours.
    expect(stroke.changedTexels[60 * 8 * TEXELS + 445]).toBe(1);
    expect(stroke.offSetBlocks).toEqual([103, 119]);
  });

  it("writes each changed cell's texture as a layer of its own set, and keeps its set", () => {
    const textures = read(FIRST);
    const stroke = paintSlot(textures, rect(60, 52, 8, 8), findTexture(textures, "CharDunes_6"));
    const { sync } = writePaint(textures, stroke);
    expect(stroke.nowDominant).toBeGreaterThan(0);
    for (const [cell, layer] of stroke.dominant) {
      expect(syncSet(textures, sync, cell)).toBe(1);
      expect(layer).toBeLessThan(8);
    }
    expect(sync.readUInt32LE(textures.syncCells + (56 * SIZE + 64) * 8)).toBe(3);
  });
});

describe("moving blocks onto another set", () => {
  it("writes the Editor's t3Terrain.xml and t3SyncTextureInfo, byte for byte, keeping every weight", () => {
    // The third save's masks with the second save's sets: the grass is painted, the blocks not yet moved.
    const before = read(BOUNDARY);
    const sync = Buffer.from(BLOCK_MOVE.sync);
    for (let cell = 0; cell < SIZE * SIZE; cell++) sync.writeUInt32LE(before.blockSets[cellBlock(cell)]!, before.syncCells + cell * 8 + 4);
    const textures = readKeptTextures(BOUNDARY.xml, BLOCK_MOVE.masks, sync);
    // The blocks the Editor moved: rows 9 and 10 of columns 7-9, and row 11 of columns 8-9.
    const area = rect(56, 72, 24, 16);
    const extra = rect(64, 88, 16, 8);
    const inside = area.inside.map((value, cell) => value | extra.inside[cell]!);
    const move = moveBlocks(textures, { ...area, inside }, 1);
    expect(move.blocks).toEqual(MOVED);
    const written = writeBlockMove(textures, BOUNDARY.xml, move);
    expect(written.terrainXml).toBe(BLOCK_MOVE.xml);
    expect(written.sync.equals(BLOCK_MOVE.sync)).toBe(true);
  });

  it("moves nothing where the area's blocks are on the set already", () => {
    const textures = read(FIRST);
    expect(moveBlocks(textures, rect(60, 52, 4, 4), 1).blocks).toEqual([]);
  });
});

describe("an edit the Editor resaved unchanged", () => {
  it("writes the files the Editor kept byte for byte: a block move, then a second-set stroke running over into set 0", () => {
    const OURS = save("ours/");
    const first = read(BLOCK_MOVE);
    const move = moveBlocks(first, rect(80, 72, 8, 8), 1);
    expect(move.blocks).toEqual([154]);
    const moved = writeBlockMove(first, BLOCK_MOVE.xml, move);
    const textures = readKeptTextures(moved.terrainXml, BLOCK_MOVE.masks, moved.sync);
    const stroke = paintSlot(textures, rect(74, 74, 18, 6, 3), findTexture(textures, "CharDunes_6"));
    expect(stroke.offSetBlocks).toEqual([138, 139, 155, 170, 171]);
    const painted = writePaint(textures, stroke);
    expect(moved.terrainXml).toBe(OURS.xml);
    expect(painted.masks.equals(OURS.masks)).toBe(true);
    expect(painted.sync.equals(OURS.sync)).toBe(true);
  });
});

describe("seams", () => {
  it("finds a texture on both sides of a boundary between sets, and none where only one set has it", () => {
    const textures = read(BLOCK_MOVE);
    // The grass stroke ran across texel column 640 before its blocks moved: now CharDunes_5 meets grass there, not itself.
    const all = new Uint8Array(SIZE * SIZE).fill(1);
    expect(findSeams(textures, "BelShirGrassLight", all)).toBeUndefined();
    // A texture in both sets, on both sides of the square's edge, is a seam.
    const shared = { ...textures, slots: textures.slots.map((name, slot) => (slot === 8 ? "BelShirDirtLight" : name)) };
    expect(findSeams(shared, "BelShirDirtLight", all)).toMatchObject({ texture: "BelShirDirtLight" });
    // Only boundaries by the edit's cells count: a corner far from the square has none.
    expect(findSeams(shared, "BelShirDirtLight", rect(0, 0, 8, 8).inside)).toBeUndefined();
  });
});

const cellBlock = (cell: number) => Math.floor(Math.floor(cell / SIZE) / 8) * (SIZE / 8) + Math.floor((cell % SIZE) / 8);
