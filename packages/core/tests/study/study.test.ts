import { describe, expect, it } from "vitest";

import type { PlacedDoodad } from "../../src/map/read-objects-xml.js";
import type { LoadedMapPackage } from "../../src/study/load-map-package.js";
import { classifyManipulations } from "../../src/study/measure-doodads.js";
import { buildTerrainGrid } from "../../src/study/terrain-grid.js";

const plain: PlacedDoodad = {
  id: 1,
  type: "Rock",
  position: { x: 1, y: 1, z: 8 },
  yaw: 1,
  pitch: 0,
  roll: 0,
  scale: { x: 1, y: 1, z: 1 },
  flags: [],
};

describe("classifyManipulations", () => {
  it("leaves an ordinary placement alone", () => {
    expect(classifyManipulations(plain, 0.01)).toEqual([]);
  });

  it("names each deliberate transform", () => {
    const odd = { ...plain, pitch: 1.57, scale: { x: 3, y: 0.4, z: 1 }, tintColor: "255,0,0,255", flags: ["NoDoodadFootprint"] };
    expect(classifyManipulations(odd, -1)).toEqual(["tilted", "nonUniformScale", "sunk", "tinted", "extremeScale", "noFootprint"]);
  });
});

describe("buildTerrainGrid", () => {
  // 4x2 cells: a level-1 west half, a level-2 east half, a ramp cell between them on the top row.
  const width = 4;
  const height = 2;
  const syncCliff = Uint16Array.from([64, 64, 128, 128, 64, 96, 128, 128]);
  const map = {
    terrain: { width, height, textures: ["A", "B", "", "", "", "", "", ""], blockTextureSets: [] },
    syncCliff: { width, height, syncCliff },
    mapInfo: { playableBounds: [0, 0, 4, 2] },
    cellWeights: Float32Array.from({ length: width * height * 8 }, (_, i) => (i % 8 === 0 ? 15 : i % 8 === 1 ? 5 : 0)),
  } as unknown as LoadedMapPackage;
  const grid = buildTerrainGrid(map);

  it("marks ramps and cliff edges", () => {
    expect(Array.from(grid.isRamp)).toEqual([0, 0, 0, 0, 0, 1, 0, 0]);
    expect(Array.from(grid.isCliffEdge)).toEqual([0, 1, 1, 0, 0, 0, 0, 0]);
    expect(grid.edgeDistance[0]).toBe(1);
  });

  it("normalises texture weights into visible shares", () => {
    expect(grid.layerTexture.slice(0, 2)).toEqual(["A", "B"]);
    expect(grid.layerShare[0]).toBeCloseTo(0.75);
    expect(grid.layerShare[1]).toBeCloseTo(0.25);
  });
});
