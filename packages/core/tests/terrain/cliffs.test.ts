import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { cliffCells, type CornerGrid, syncCellLevels, vertexLevels } from "../../src/terrain/cliffs.js";

// Editor 5.0.17 BelShirEx2 map with a plateau, a pit and two ramps (see the README).
const FIXTURE = "../fixtures/editor-terrain/cliffs-and-ramps";
const SIZE = 128;
const fixture = (name: string): Promise<Buffer> => readFile(new URL(`${FIXTURE}/${name}`, import.meta.url));

const heightMap = await fixture("t3HeightMap");
const r2 = (vx: number, vy: number): number => heightMap.readUInt16LE(32 + (vy * (SIZE + 1) + vx) * 6 + 4);
const terrainXml = (await fixture("t3Terrain.xml")).toString("utf8");
const editorCells = [...terrainXml.matchAll(/<cc i="(\d+)" f="(\d+)" cid="\d+" cvar="\d+"\/>/g)].map((m) => ({
  index: Number(m[1]),
  flags: Number(m[2]),
}));

// Ramps follow their own height rules (round B); leave their cliff cells and one
// cliff cell of margin out of these comparisons.
const rampCells = editorCells.filter((cell) => cell.flags & 2).map((cell) => cell.index);
const nearRamp = (cx: number, cy: number): boolean =>
  rampCells.some((index) => Math.abs((index % 64) - cx) <= 1 && Math.abs(Math.floor(index / 64) - cy) <= 1);

const columns = SIZE / 2 + 1;
const levels = new Uint8Array(columns * columns);
for (let cy = 0; cy < columns; cy++) for (let cx = 0; cx < columns; cx++) levels[cy * columns + cx] = r2(cx * 2, cy * 2);
const grid: CornerGrid = { columns, rows: columns, levels };

describe("cliff rules against an Editor-saved map", () => {
  it("has the expected features: level 0, 1, 2 and 3 corners, 101 cliff and 15 ramp cells", () => {
    expect(new Set(levels)).toEqual(new Set([0, 1, 2, 3]));
    expect(editorCells.filter((cell) => cell.flags === 1)).toHaveLength(101);
    expect(rampCells).toHaveLength(15);
  });

  it("derives every vertex cliff level from the corners", () => {
    const derived = vertexLevels(grid, SIZE, SIZE);
    const mismatches: string[] = [];
    for (let vy = 0; vy <= SIZE; vy++) {
      for (let vx = 0; vx <= SIZE; vx++) {
        if (nearRamp(vx >> 1, vy >> 1)) continue;
        if (derived[vy * (SIZE + 1) + vx] !== r2(vx, vy)) mismatches.push(`(${vx},${vy})`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("finds exactly the Editor's cliff cells", () => {
    const ours = cliffCells(grid, 1)
      .map((cell) => cell.index)
      .filter((index) => !nearRamp(index % 64, Math.floor(index / 64)));
    const editor = editorCells
      .filter((cell) => cell.flags === 1 && !nearRamp(cell.index % 64, Math.floor(cell.index / 64)))
      .map((cell) => cell.index);
    expect(ours).toEqual(editor);
  });

  it("reproduces t3SyncCliffLevel and the cliff bit of t3CellFlags", async () => {
    const syncFile = await fixture("t3SyncCliffLevel");
    const flagsFile = await fixture("t3CellFlags");
    const derivedVertices = new Uint8Array((SIZE + 1) * (SIZE + 1));
    for (let vy = 0; vy <= SIZE; vy++) for (let vx = 0; vx <= SIZE; vx++) derivedVertices[vy * (SIZE + 1) + vx] = r2(vx, vy);
    const sync = syncCellLevels(derivedVertices, SIZE, SIZE);
    const cliffCellSet = new Set(cliffCells(grid, 1).map((cell) => cell.index));
    const mismatches: string[] = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (nearRamp(x >> 1, y >> 1)) continue;
        const editorSync = syncFile.readUInt16LE(32 + (y * SIZE + x) * 2);
        if (editorSync !== sync[y * SIZE + x]! * 64) mismatches.push(`sync (${x},${y})`);
        const editorFlags = flagsFile[flagsFile.length - SIZE * SIZE + y * SIZE + x]!;
        const ourFlags = cliffCellSet.has((y >> 1) * 64 + (x >> 1)) ? 0x03 : 0x02;
        if (editorFlags !== ourFlags) mismatches.push(`flags (${x},${y}) ${editorFlags}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

// A terrain cell's four vertices as [(x, y), (x+1, y), (x, y+1), (x+1, y+1)]; the cell is a 1×1 map.
const syncLevelOf = (vertices: readonly [number, number, number, number]): number => syncCellLevels(Uint8Array.from(vertices), 1, 1)[0]!;

describe("syncCellLevels on mixed cells", () => {
  // Measured on Editor-saved maps (two Workspace Missions and Ephemeron LE, 2026-11-18): 6,001 of 6,013
  // three-high cells take the high level, 6,122 of 6,134 three-low cells the low one, and all 50 saddle
  // cells (the high pair on one diagonal) take the high level. Edge-split cells take the low one, 12,806 of 12,846.
  it("gives a cell three of whose vertices share a level that level", () => {
    expect(syncLevelOf([2, 2, 1, 2])).toBe(2);
    expect(syncLevelOf([1, 2, 1, 1])).toBe(1);
  });

  it("gives a saddle cell, the high pair on one diagonal, the high level", () => {
    expect(syncLevelOf([4, 3, 3, 4])).toBe(4);
    expect(syncLevelOf([3, 4, 4, 3])).toBe(4);
    expect(syncLevelOf([1, 0, 0, 1])).toBe(1);
  });

  it("gives an edge-split cell the low level", () => {
    expect(syncLevelOf([2, 2, 1, 1])).toBe(1);
    expect(syncLevelOf([1, 2, 1, 2])).toBe(1);
  });
});
