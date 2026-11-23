import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { readT3HeightMap } from "../../src/terrain/read-t3-height-map.js";
import { readT3SyncCliffLevel } from "../../src/terrain/read-t3-sync-cliff-level.js";
import { readT3TerrainXml, textureAt } from "../../src/terrain/read-t3-terrain-xml.js";
import { cellTextureWeights, readT3TextureMasks } from "../../src/terrain/read-t3-texture-masks.js";
import { readT3FluffDoodad } from "../../src/terrain/read-t3-fluff-doodad.js";
import { readT3VertCol, vertexValueGrid } from "../../src/terrain/read-t3-vert-col.js";
import { writeT3HeightMap } from "../../src/terrain/write-t3-height-map.js";
import { writeT3SyncCliffLevel } from "../../src/terrain/write-t3-sync-cliff-level.js";
import { writeT3TerrainXml } from "../../src/terrain/write-t3-terrain-xml.js";
import { writeT3TextureMasks } from "../../src/terrain/write-t3-texture-masks.js";

const FIXTURE = new URL("../fixtures/editor-terrain/cliffs-and-ramps/", import.meta.url);

describe("readT3HeightMap", () => {
  it("round-trips writeT3HeightMap within quantization error", () => {
    const heights = Float32Array.from([8, 8.5, 10, 12, 4, 8, 8, 8, 8]);
    const cliffHeights = Float32Array.from([0, 0, 2, 4, -4, 0, 0, 0, 0]);
    const cliffLevels = Uint8Array.from([1, 1, 2, 3, 0, 1, 1, 1, 1]);
    const read = readT3HeightMap(writeT3HeightMap({ width: 2, height: 2, heights, cliffHeights, cliffLevels }));
    expect(read.vertexWidth).toBe(3);
    expect(read.cliffLevels).toEqual(cliffLevels);
    read.heights.forEach((h, i) => expect(h).toBeCloseTo(heights[i]!, 3));
  });

  it("reads the Editor fixture's plateau and pit levels", () => {
    const xml = readT3TerrainXml(readFileSync(new URL("t3Terrain.xml", FIXTURE), "utf8"));
    const map = readT3HeightMap(readFileSync(new URL("t3HeightMap", FIXTURE)), xml);
    expect(map.vertexWidth).toBe(129);
    expect(new Set(map.cliffLevels)).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe("readT3SyncCliffLevel", () => {
  it("round-trips writeT3SyncCliffLevel", () => {
    const syncCliff = Uint16Array.from([64, 64, 96, 128]);
    expect(readT3SyncCliffLevel(writeT3SyncCliffLevel({ width: 2, height: 2, syncCliff })).syncCliff).toEqual(syncCliff);
  });
});

describe("readT3TextureMasks", () => {
  it("round-trips writeT3TextureMasks per cell", () => {
    const width = 16;
    const height = 8;
    const textureWeights = new Uint8Array(width * height * 8);
    for (let cell = 0; cell < width * height; cell++) textureWeights[cell * 8 + (cell % 8)] = cell % 16;
    const masks = readT3TextureMasks(writeT3TextureMasks({ width, height, textureWeights }));
    expect(masks.maskWidth).toBe(128);
    expect(Array.from(cellTextureWeights(masks, width, height))).toEqual(Array.from(textureWeights));
  });
});

describe("readT3TerrainXml", () => {
  it("round-trips the fields writeT3TerrainXml sets", () => {
    const terrain = readT3TerrainXml(
      writeT3TerrainXml({ catalog: EMPTY_CATALOG, tilesetId: "BelShirEx2", width: 32, height: 16, textureSetIndex: 0 }),
    );
    expect(terrain).toMatchObject({ tilesetId: "BelShirEx2", width: 32, height: 16, version: 115 });
    expect(terrain.blockTextureSets).toHaveLength(8);
    expect(textureAt(terrain, 0, 0, 0)).toBe(terrain.textures[0]);
  });

  it("reads the Editor fixture's ramps and cliff cells", () => {
    const terrain = readT3TerrainXml(readFileSync(new URL("t3Terrain.xml", FIXTURE), "utf8"));
    expect(terrain.width).toBe(128);
    expect(terrain.ramps.map((ramp) => ramp.dir).sort()).toEqual([3, 7]);
    expect(terrain.cliffCells.length).toBeGreaterThan(0);
    expect(terrain.cliffSets.length).toBeGreaterThan(0);
  });
});

describe("readT3FluffDoodad", () => {
  it("reads the Editor's empty v103 file", () => {
    const empty = Buffer.concat([Buffer.from("DLFT"), Buffer.from([103, 0, 0, 0]), Buffer.alloc(20)]);
    expect(readT3FluffDoodad(empty)).toEqual({ version: 103, entries: [] });
  });
});

describe("readT3VertCol", () => {
  function entry(kind: number, rect: number[], data: number[]): Buffer {
    const head = Buffer.alloc(36);
    head.writeInt32LE(kind === 1 ? 0 : 1234, 0);
    head.writeInt32LE(kind, 4);
    rect.forEach((v, i) => head.writeFloatLE(v, 8 + i * 4));
    head.writeUInt32LE(data.length, 32);
    return Buffer.concat([head, Buffer.from(data)]);
  }

  it("reads entries to the exact end and grids kind-1 vertex values", () => {
    const tile = Array.from({ length: 25 }, (_, i) => 200 + i);
    const header = Buffer.alloc(32);
    header.write("VTCL", 0, "ascii");
    header.writeUInt32LE(104, 4);
    header.writeUInt32LE(2, 8);
    const file = Buffer.concat([header, entry(1, [0, 0, 4, 4], tile), entry(2, [2, 2, 4, 4], [1, 2, 3])]);
    const entries = readT3VertCol(file);
    expect(entries.map((e) => [e.kind, e.data.length])).toEqual([[1, 25], [2, 3]]);
    const grid = vertexValueGrid(entries, 8, 4);
    expect(grid[0]).toBe(200);
    expect(grid[1 * 9 + 4]).toBe(209); // row 1, column 4
    expect(grid[8]).toBe(255); // outside every tile
  });

  it("rejects a file the entries don't exactly fill", () => {
    const header = Buffer.alloc(32);
    header.write("VTCL", 0, "ascii");
    header.writeUInt32LE(1, 8);
    expect(() => readT3VertCol(Buffer.concat([header, entry(1, [0, 0, 4, 4], [1]), Buffer.from([0])]))).toThrow();
  });
});
