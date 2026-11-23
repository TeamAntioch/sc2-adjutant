import { describe, expect, it } from "vitest";

import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { rasterizeTerrain } from "../../src/terrain/rasterize.js";

type Options = { connection?: Record<string, unknown>; northSouth?: boolean; elevation?: number; tilesetId?: string };

/**
 * A 64×64 map: two banks on level 1 either side of a level-0 chasm whose ground runs from the
 * corner at 26 to the one at 26 + `gap` (later zones win, so the chasm's polygon sits a cell inside
 * them), joined by a bridge connection; west to east, or south to north when `northSouth`.
 */
function blueprint(gap: number, { connection = {}, northSouth = false, elevation = 1, tilesetId = "Castanar" }: Options = {}) {
  const rect = (a0: number, a1: number) => {
    const corners = [
      [a0, 0],
      [a1, 0],
      [a1, 64],
      [a0, 64],
    ];
    return corners.map(([along, across]) => (northSouth ? { x: across!, y: along! } : { x: along!, y: across! }));
  };
  return MissionBlueprintSchema.parse({
    id: "bridges",
    campaignId: "test",
    title: "Bridges",
    setting: "test",
    mapSize: { width: 64, height: 64 },
    tilesetId,
    zones: [
      { id: "near", name: "Near", elevation, landform: "flat", role: "base", polygon: rect(0, 32), connections: [{ toZoneId: "far", type: "bridge", ...connection }] },
      { id: "far", name: "Far", elevation, landform: "flat", role: "path", polygon: rect(32, 64) },
      { id: "chasm", name: "Chasm", elevation: elevation - 1, landform: "canyon", role: "path", polygon: rect(27, 25 + gap) },
    ],
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    screenplay: { title: "Bridges" },
  });
}

type Terrain = ReturnType<typeof rasterizeTerrain>;
const placed = (terrain: Terrain) => terrain.terrainObjects.map(({ id, type, x, y, rotation }) => ({ id, type, x, y, rotation }));
/** Sync cliff levels of the cells along row y from x0 to x1 (exclusive). */
const row = (terrain: Terrain, y: number, x0: number, x1: number) => Array.from({ length: x1 - x0 }, (_, i) => terrain.syncCliff[y * 64 + x0 + i]! / 64);
const column = (terrain: Terrain, x: number, y0: number, y1: number) => Array.from({ length: y1 - y0 }, (_, i) => terrain.syncCliff[(y0 + i) * 64 + x]! / 64);

describe("bridge connections", () => {
  it("place a stock bridge that fits the gap exactly, without reshaping it", () => {
    const terrain = rasterizeTerrain(blueprint(10));
    expect(placed(terrain)).toEqual([{ id: "near-far-bridge", type: "TerrainObjectCastanarBridge10x6", x: 31, y: 33, rotation: 0 }]);
    expect(terrain.terrainObjectWarnings).toEqual([]);
    // The deck carries the bank's level across; beside the stamp the chasm is untouched.
    expect(row(terrain, 33, 20, 44)).toEqual(Array(24).fill(1));
    expect(row(terrain, 29, 26, 36)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("build bridgeheads the bridge's width where the gap is longer than its span", () => {
    // 14 cells: the 10-cell bridge in the middle, a 2-cell landing at each end.
    const terrain = rasterizeTerrain(blueprint(14));
    expect(placed(terrain)).toEqual([{ id: "near-far-bridge", type: "TerrainObjectCastanarBridge10x6", x: 33, y: 33, rotation: 0 }]);
    expect(terrain.terrainObjectWarnings).toEqual([]);
    expect(row(terrain, 33, 20, 46)).toEqual(Array(26).fill(1));
    // Landings over the stamp's width (corner rows 30-36, so with their cliffs cells 28-37); the
    // chasm beside them stays open.
    expect(column(terrain, 27, 26, 40)).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
    expect(column(terrain, 38, 26, 40)).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
  });

  it("take the longest span the gap holds", () => {
    // 18 cells: the 16-cell bridge, its west end on the bank (stamp edges stay on the 2-cell grid).
    const terrain = rasterizeTerrain(blueprint(18));
    expect(placed(terrain)).toEqual([{ id: "near-far-bridge", type: "TerrainObjectCastanarBridge14x6", x: 34, y: 33, rotation: 0 }]);
    expect(terrain.terrainObjectWarnings).toEqual([]);
  });

  it("let the shortest bridge outspan a narrower gap, widening the chasm round its ends", () => {
    const terrain = rasterizeTerrain(blueprint(6));
    expect(placed(terrain)).toEqual([{ id: "near-far-bridge", type: "TerrainObjectCastanarBridge10x6", x: 29, y: 33, rotation: 0 }]);
    expect(terrain.terrainObjectWarnings).toEqual([]);
    expect(row(terrain, 33, 16, 44)).toEqual(Array(28).fill(1));
  });

  it("span north-south with the vertical bridges", () => {
    const terrain = rasterizeTerrain(blueprint(10, { northSouth: true }));
    expect(placed(terrain)).toEqual([{ id: "near-far-bridge", type: "TerrainObjectCastanarBridge6x10", x: 33, y: 31, rotation: 0 }]);
    expect(terrain.terrainObjectWarnings).toEqual([]);
    expect(column(terrain, 33, 20, 44)).toEqual(Array(24).fill(1));
  });

  it("go at the connection's point", () => {
    const terrain = rasterizeTerrain(blueprint(10, { connection: { at: { x: 30, y: 49 } } }));
    expect(placed(terrain)).toEqual([{ id: "near-far-bridge", type: "TerrainObjectCastanarBridge10x6", x: 31, y: 49, rotation: 0 }]);
  });

  it("use the tileset's own bridge, turned for north-south", () => {
    const terrain = rasterizeTerrain(blueprint(16, { northSouth: true, tilesetId: "MonlythEx1" }));
    expect(placed(terrain)).toEqual([{ id: "near-far-bridge", type: "MonlythLightBridge", x: 33, y: 34, rotation: 1 }]);
    expect(terrain.terrainObjectWarnings).toEqual([]);
  });

  it("refuse banks off level 1, which no stock bridge joins", () => {
    expect(() => rasterizeTerrain(blueprint(10, { elevation: 2 }))).toThrow(/stock bridges join level-1 ground/);
  });
});
