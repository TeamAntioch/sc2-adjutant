import { describe, expect, it } from "vitest";

import { rasterizeTerrain, type TerrainRasterizationResult } from "../../src/terrain/rasterize.js";
import type { MissionBlueprint } from "../../src/domain/mission-blueprint.js";

const multiZoneBlueprint: MissionBlueprint = {
  id: "test_multi_zone",
  campaignId: "test_campaign",
  title: "Test Multi-Zone",
  setting: "A test setting",
  mapSize: { width: 16, height: 16 },
  zones: [
    {
      id: "base",
      name: "Base",
      elevation: 1,
      landform: "flat", role: "base",
      polygon: [
        { x: 2, y: 2 },
        { x: 6, y: 2 },
        { x: 6, y: 6 },
        { x: 2, y: 6 },
      ],
      connections: [],
    },
    {
      id: "ridge",
      name: "Ridge",
      elevation: 2,
      landform: "ridge", role: "path",
      polygon: [
        { x: 8, y: 2 },
        { x: 12, y: 2 },
        { x: 12, y: 10 },
        { x: 8, y: 10 },
      ],
      connections: [],
    },
    {
      id: "canyon",
      name: "Canyon",
      elevation: 0,
      landform: "canyon", role: "path",
      polygon: [
        { x: 2, y: 8 },
        { x: 6, y: 8 },
        { x: 6, y: 12 },
        { x: 2, y: 12 },
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
    title: "Test Multi-Zone",
    scenes: [{ id: "scene_1", lines: [{ id: "line_1", speaker: "Hero", text: "Hello" }] }],
  },
};

describe("rasterizeTerrain (multi-zone)", () => {
  it("assigns different cliff levels to different zones", () => {
    const result = rasterizeTerrain(multiZoneBlueprint);
    // base zone (elevation 1) at cell (3,3) -> index 3*16+3 = 51
    expect(result.syncCliff[51]).toBe(64);
    // ridge zone (elevation 2) at cell (9,3) -> index 3*16+9 = 57
    expect(result.syncCliff[57]).toBe(128);
    // canyon zone (elevation 0) at cell (3,9) -> index 9*16+3 = 147
    expect(result.syncCliff[147]).toBe(0);
  });

  it("marks cliff cells between zones of different elevation with f=1", () => {
    const result = rasterizeTerrain(multiZoneBlueprint);
    expect(result.syncCliff.length).toBe(16 * 16);
    expect(result.cliffCells.length).toBeGreaterThan(0);
    expect(result.cliffCells.every((cell) => cell.flags === 1)).toBe(true);
  });

  it("assigns different texture weights to different zones", () => {
    const result = rasterizeTerrain(multiZoneBlueprint);
    // All zones now use layer 0 (single texture)
    // base zone cell (3,3) -> layer 0 should be 15
    expect(result.textureWeights[51 * 8]).toBe(15);
    // ridge zone cell (9,3) -> layer 1 should be 15 (different texture)
    expect(result.textureWeights[57 * 8 + 1]).toBe(15);
  });

  it("produces height variation within zones", () => {
    const result = rasterizeTerrain(multiZoneBlueprint);
    // Heights should not all be identical
    const uniqueHeights = new Set(result.heights);
    expect(uniqueHeights.size).toBeGreaterThan(1);
  });

  it("keeps built ground level", () => {
    const flat = { ...multiZoneBlueprint, zones: multiZoneBlueprint.zones.map((zone) => ({ ...zone, surface: "built" as const })) };
    const result = rasterizeTerrain(flat);
    // Inside the base zone (2-6, 2-6): no noise on top of the cliff layer.
    for (let y = 2; y <= 6; y++) {
      for (let x = 2; x <= 6; x++) {
        const index = y * 17 + x;
        expect(result.heights[index]! - result.cliffHeights[index]!).toBeCloseTo(result.heights[2 * 17 + 2]! - result.cliffHeights[2 * 17 + 2]!, 4);
      }
    }
  });

  it("keeps man-made textures level and roughens natural ones", () => {
    const textured = {
      ...multiZoneBlueprint,
      textures: ["AgriaConcrete", "AgriaDirt"],
      zones: multiZoneBlueprint.zones.map((zone) => ({ ...zone, texture: zone.id === "base" ? "AgriaConcrete" : "AgriaDirt" })),
    };
    const result = rasterizeTerrain(textured);
    const ground = (x: number, y: number) => result.heights[y * 17 + x]! - result.cliffHeights[y * 17 + x]!;
    // The concrete base (2-6) is level inside its seam; the dirt ridge (8-12) isn't.
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) expect(ground(x, y)).toBeCloseTo(ground(4, 4), 4);
    const ridge = new Set(Array.from({ length: 9 }, (_, i) => ground(9 + (i % 3), 3 + Math.floor(i / 3)).toFixed(4)));
    expect(ridge.size).toBeGreaterThan(1);
  });

  it("ensures all texture weights sum to 15", () => {
    const result = rasterizeTerrain(multiZoneBlueprint);
    const cellCount = 16 * 16;
    for (let i = 0; i < cellCount; i++) {
      let sum = 0;
      for (let layer = 0; layer < 8; layer++) {
        const w = result.textureWeights[i * 8 + layer];
        if (w !== undefined) sum += w;
      }
      expect(sum).toBe(15);
    }
  });
});
