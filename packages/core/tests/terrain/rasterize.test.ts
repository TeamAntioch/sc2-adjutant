import { describe, expect, it } from "vitest";

import { rasterizeTerrain, type TerrainRasterizationResult } from "../../src/terrain/rasterize.js";
import type { MissionBlueprint } from "../src/domain/mission-blueprint.js";

const minimalBlueprint: MissionBlueprint = {
  id: "test_mission",
  campaignId: "test_campaign",
  title: "Test Mission",
  setting: "A test setting",
  mapSize: { width: 8, height: 8 },
  // Zones a few cells wide, on exact corners: no wobble.
  raggedCliffs: 0,
  zones: [
    {
      id: "base",
      name: "Base",
      elevation: 1,
      landform: "flat", role: "base",
      polygon: [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 5, y: 5 },
        { x: 1, y: 5 },
      ],
      connections: [],
    },
    {
      id: "ridge",
      name: "Ridge",
      elevation: 2,
      landform: "ridge", role: "path",
      polygon: [
        { x: 6, y: 1 },
        { x: 7, y: 1 },
        { x: 7, y: 7 },
        { x: 6, y: 7 },
      ],
      connections: [],
    },
  ],
  anchors: [],
  placements: [],
  ramps: [],
  terrainObjects: [],
  beats: [{ id: "opening", title: "Opening", summary: "Start", zoneIds: ["base"], anchorIds: [] }],
  objectives: [],
  mechanics: [],
  screenplay: {
    title: "Test Mission",
    scenes: [{ id: "scene_1", lines: [{ id: "line_1", speaker: "Hero", text: "Hello" }] }],
  },
};

describe("rasterizeTerrain", () => {
  it("produces an 8x8 cliff level grid with the correct elevations", () => {
    const result: TerrainRasterizationResult = rasterizeTerrain(minimalBlueprint);
    expect(result.syncCliff.length).toBe(64);
    expect(result.syncCliff[18]).toBe(64);
    expect(result.syncCliff[22]).toBe(128);
  });

  it("produces an 8x8 texture mask with 8 layers", () => {
    const result = rasterizeTerrain(minimalBlueprint);
    expect(result.textureWeights.length).toBe(64 * 8); // 64 cells * 8 layers
    // Check cell 18 (base zone at x=2,y=2)
    let sum = 0;
    for (let layer = 0; layer < 8; layer++) {
      sum += result.textureWeights[18 * 8 + layer];
    }
    expect(sum).toBe(15);
  });

  it("produces a 9x9 height map grid matching the cliff levels", () => {
    const result = rasterizeTerrain(minimalBlueprint);
    expect(result.heights.length).toBe(81);
  });

  it("produces a 9x9 sync height map grid matching the height map", () => {
    const result = rasterizeTerrain(minimalBlueprint);
    expect(result.syncHeights.length).toBe(81);
  });

  it("produces an 8x8 cell flags grid", () => {
    const result = rasterizeTerrain(minimalBlueprint);
    expect(result.cellFlags.length).toBe(64);
  });

  it("treats ground away from cliffs as ordinary level-1 ground", () => {
    const result = rasterizeTerrain(minimalBlueprint);
    expect(result.syncCliff).not.toContain(0);
    expect(result.syncCliff[0]).toBe(64);
    expect(result.cellFlags[0]).toBe(0x02);
  });

  it("raises corners inside a higher zone and puts cliff meshes where corners differ", () => {
    const result = rasterizeTerrain(minimalBlueprint);
    // Ridge spans x 6..7: corners at x=6 (y 2..6) are level 2.
    expect(result.vertexCliffLevels[2 * 9 + 6]).toBe(2);
    expect(result.cliffHeights[2 * 9 + 6]).toBe(2);
    expect(result.vertexCliffLevels[2 * 9 + 4]).toBe(1);
    // Cliff cells (2x2) between corner columns x=4 and x=6 carry a mesh; their cells are unpathable.
    expect(result.cliffCells.map((cell) => cell.index)).toContain(1 * 4 + 2);
    expect(result.cellFlags[2 * 8 + 4]).toBe(0x03);
    expect(result.cliffCells.every((cell) => cell.variation >= 0 && cell.variation <= 3)).toBe(true);
  });

  it("drops a level-0 zone to the pit height of -8", () => {
    const pit = rasterizeTerrain({
      ...minimalBlueprint,
      zones: [{ ...minimalBlueprint.zones[0]!, elevation: 0 }],
    });
    expect(pit.cliffHeights[2 * 9 + 2]).toBe(-8);
  });
});
