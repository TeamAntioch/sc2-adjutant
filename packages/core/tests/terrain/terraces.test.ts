import { describe, expect, it } from "vitest";

import type { MissionBlueprint } from "../../src/domain/mission-blueprint.js";
import { type CornerGrid } from "../../src/terrain/cliffs.js";
import { cliffLayout, rasterizeTerrain, terraceNotes } from "../../src/terrain/rasterize.js";
import { allowedClimb, cellJumps, TERRACE_WIDTH, terraceCorners } from "../../src/terrain/terraces.js";

type Zone = MissionBlueprint["zones"][number];

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const zone = (id: string, elevation: number, polygon: Zone["polygon"], extra: Partial<Zone> = {}): Zone => ({
  id,
  name: id,
  elevation,
  landform: "flat",
  role: "path",
  polygon,
  connections: [],
  ...extra,
});

const blueprintOf = (zones: Zone[]): MissionBlueprint => ({
  id: "terraces",
  campaignId: "test",
  title: "Terraces",
  setting: "A test",
  mapSize: { width: 32, height: 32 },
  raggedCliffs: 0,
  zones,
  anchors: [],
  placements: [],
  ramps: [],
  terrainObjects: [],
  beats: [{ id: "opening", title: "Opening", summary: "Start", zoneIds: [zones[0]!.id], anchorIds: [] }],
  objectives: [],
  mechanics: [],
  screenplay: { title: "Terraces", scenes: [{ id: "scene_1", lines: [{ id: "line_1", speaker: "Hero", text: "Hello" }] }] },
});

/** A row of corners, `fixed` where the level is followed by `!`. */
const row = (spec: string): { grid: CornerGrid; fixed: Uint8Array } => {
  const tokens = spec.split(" ");
  return {
    grid: { columns: tokens.length, rows: 1, levels: Uint8Array.from(tokens, (token) => Number.parseInt(token, 10)) },
    fixed: Uint8Array.from(tokens, (token) => (token.endsWith("!") ? 1 : 0)),
  };
};

describe("terraceCorners", () => {
  it("steps rock down to a floor a level a corner, a cliff cell a storey, and leaves the floor and far rock alone", () => {
    const { grid, fixed } = row("2! 2! 7 7 7 7 7 7 7");
    const { movedCorners } = terraceCorners(grid, fixed);
    expect([...grid.levels]).toEqual([2, 2, 3, 4, 5, 6, 7, 7, 7]);
    expect(movedCorners).toBe(4);
  });

  it("raises rock only where a floor sits more than a level above it", () => {
    const { grid, fixed } = row("5! 1 1 1 1 1");
    terraceCorners(grid, fixed);
    expect([...grid.levels]).toEqual([5, 4, 3, 2, 1, 1]);
  });

  it("steps two bands of rock drawn against each other", () => {
    const { grid } = row("2 2 2 7 7 7 7 7");
    terraceCorners(grid, new Uint8Array(grid.levels.length));
    expect([...grid.levels]).toEqual([2, 2, 2, 3, 4, 5, 6, 7]);
  });

  it("leaves two floors drawn two levels apart as they are", () => {
    const { grid, fixed } = row("1! 3! 3");
    expect(terraceCorners(grid, fixed).movedCorners).toBe(0);
    expect([...grid.levels]).toEqual([1, 3, 3]);
  });

  it("keeps a flat terrace between storeys when the width is wider than a cliff cell", () => {
    const { grid, fixed } = row("1! 5 5 5 5 5 5 5");
    terraceCorners(grid, fixed, 4);
    expect([...grid.levels]).toEqual([1, 2, 2, 3, 3, 4, 4, 5]);
  });

  it("comes out the same whatever order the corners are visited in: a map turned round stays turned round", () => {
    const { grid, fixed } = row("2! 7 7 7 7 7 7 7 2!");
    terraceCorners(grid, fixed);
    expect([...grid.levels]).toEqual([2, 3, 4, 5, 6, 5, 4, 3, 2]);
  });

  it("climbs a level over a cliff cell by default: ground two levels apart is three cells apart at least", () => {
    expect(TERRACE_WIDTH).toBe(2);
    expect([1, 2, 3].map((distance) => allowedClimb(distance))).toEqual([1, 2, 3]);
    expect([1, 2, 3, 4].map((distance) => allowedClimb(distance, 4))).toEqual([1, 1, 2, 2]);
  });
});

describe("cellJumps", () => {
  it("counts neighbouring cells two levels apart, diagonals both ways, and skips ramp cells", () => {
    // 3×2 cells: a level-3 cell beside level-1 cells, and a ramp cell between levels.
    const sync = Uint16Array.from([64, 192, 64, 64, 64, 100]);
    // (1,0)-(0,0), (1,0)-(2,0), (1,0)-(0,1) diagonally, (1,0)-(1,1); (1,0)-(2,1) is a ramp cell.
    expect(cellJumps(sync, 3, 2)).toBe(4);
    expect(cellJumps(sync, 3, 2, (cell) => cell === 1)).toBe(0);
  });
});

describe("a generated map's terraces", () => {
  // A level-1 floor against a band of level-5 backdrop rock.
  const floorAndRock = blueprintOf([zone("floor", 1, rect(0, 0, 12, 32)), zone("rock", 5, rect(12, 0, 32, 32), { backdrop: true })]);

  it("step the rock down to the floor, leave the floor as drawn and no jump of two levels", () => {
    const terrain = rasterizeTerrain(floorAndRock);
    const level = (x: number, y = 16): number => terrain.syncCliff[y * 32 + x]! / 64;
    expect(terrain.terraces.jumps).toBe(0);
    expect(terrain.terraces.cells).toBeGreaterThan(0);
    for (let x = 0; x < 11; x++) expect(level(x)).toBe(1);
    // The floor's last cell is under the first cliff, whose top corner is the rock's.
    expect([11, 12, 14, 16, 18, 20].map((x) => level(x))).toEqual([2, 2, 3, 4, 5, 5]);
    expect(level(31)).toBe(5);
    // The cliff meshes follow the steps: a cliff cell a storey.
    expect(terrain.cliffCells.filter((cell) => Math.floor(cell.index / 16) === 8).map((cell) => cell.index % 16)).toEqual([5, 6, 7, 8]);
  });

  it("are said in the compile's notes, with a warning for floors drawn two levels apart", () => {
    expect(terraceNotes({ cells: 0, jumps: 0 })).toEqual([]);
    expect(terraceNotes({ cells: 12, jumps: 0 })).toEqual(["Terraced 12 cells of rock so no cliff climbs two levels at once (the game draws those as black squares)"]);
    const touching = rasterizeTerrain(blueprintOf([zone("low", 1, rect(0, 0, 16, 32)), zone("high", 3, rect(16, 0, 32, 32))]));
    expect(touching.terraces.cells).toBe(0);
    expect(touching.terraces.jumps).toBeGreaterThan(0);
    expect(terraceNotes(touching.terraces)).toEqual([expect.stringMatching(/^\d+ neighbouring cell pairs are still two or more levels apart, where two floors/)]);
  });

  it("leave Kept ground and the Zones generating beside it as drawn", () => {
    const kept = blueprintOf([zone("floor", 1, rect(0, 0, 12, 32), { terrain: "generate" }), zone("rock", 5, rect(12, 0, 32, 32), { backdrop: true, terrain: "generate" })]);
    const layout = cliffLayout(kept);
    expect(layout.drawn).toBe(layout.corners);
    expect(layout.corners.levels[8 * layout.corners.columns + 7]).toBe(5);
  });
});
