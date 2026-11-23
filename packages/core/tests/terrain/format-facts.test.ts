import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { CLIFF_HEIGHTS } from "../../src/terrain/cliffs.js";
import { type Ramp, type RampDirection, rampXml, stampRamp, type RampTerrain } from "../../src/terrain/ramps.js";
import { writeT3SyncHeightMap } from "../../src/terrain/write-t3-sync-height-map.js";
import { writeT3TerrainXml } from "../../src/terrain/write-t3-terrain-xml.js";

// The format facts of issue #745, each checked against what we write. The evidence for the ones
// measured on Editor-saved maps is in docs/reference/terrain-checks.md.

describe("ramp directions", () => {
  // Uphill vector of the ramp's `base` piece per `dir`, as the Editor writes it (Ephemeron LE,
  // a Workspace Mission: dirs 0-3 straight, 4-7 diagonal; y grows north).
  const UPHILL: Record<RampDirection, string> = {
    0: "u(0.000000e+00, -1.000000e+00)",
    1: "u(-0.000000e+00, 1.000000e+00)",
    2: "u(-1.000000e+00, 0.000000e+00)",
    3: "u(1.000000e+00, -0.000000e+00)",
    4: "u(-7.071068e-01, -7.071068e-01)",
    5: "u(7.071068e-01, -7.071068e-01)",
    6: "u(-7.071068e-01, 7.071068e-01)",
    7: "u(7.071068e-01, 7.071068e-01)",
  };

  it.each([0, 1, 2, 3, 4, 5, 6, 7] as const)("writes dir %i with its uphill vector", (direction) => {
    const xml = rampXml({ direction, edge: { x: 32, y: 32 }, lowLevel: 1 });
    expect(xml).toContain(`<ramp dir="${direction}" `);
    expect(xml).toContain(` base="${UPHILL[direction]} `);
  });
});

describe("ramp rails", () => {
  // The Editor draws a ramp's two rails (the cliff edges either side of the lane) from the same
  // heights, so a ramp stamped uneven would show a seam. Each stamp is mirror-symmetric about its lane.
  const SIZE = 64;
  const blank = (level: number): RampTerrain => ({
    width: SIZE,
    height: SIZE,
    cliffHeights: new Float32Array((SIZE + 1) * (SIZE + 1)).fill(CLIFF_HEIGHTS[level]!),
    syncCliff: new Uint16Array(SIZE * SIZE).fill(64 * level),
    cellFlags: new Uint8Array(SIZE * SIZE),
    cliffCellFlags: new Map(),
    vertexCliffLevels: new Uint8Array((SIZE + 1) * (SIZE + 1)).fill(level),
  });
  const stamped = (ramp: Ramp): RampTerrain => {
    const terrain = blank(ramp.lowLevel);
    stampRamp(ramp, terrain);
    return terrain;
  };
  const vertexAt = (terrain: RampTerrain, x: number, y: number): number => terrain.cliffHeights[y * (SIZE + 1) + x]!;

  it.each([
    [0, (a: number, b: number) => [32 + b, 32 + a]],
    [1, (a: number, b: number) => [32 - b, 32 - a]],
    [2, (a: number, b: number) => [32 + a, 32 - b]],
    [3, (a: number, b: number) => [32 - a, 32 + b]],
  ] as const)("raises a straight ramp (dir %i) equally on both rails", (direction, place) => {
    const terrain = stamped({ direction, edge: { x: 32, y: 32 }, lowLevel: 2 });
    for (let a = -4; a <= 0; a++) {
      for (let b = 1; b <= 4; b++) {
        const [lx, ly] = place(a, -b);
        const [rx, ry] = place(a, b);
        expect(vertexAt(terrain, lx!, ly!)).toBe(vertexAt(terrain, rx!, ry!));
      }
    }
  });

  // The diagonal templates are symmetric about the line y = x of the north-east frame (dir 7, base (40,40)).
  it.each([
    ["wide", undefined],
    ["narrow", true],
  ] as const)("raises a %s diagonal ramp equally on both rails", (_, narrow) => {
    const ramp: Ramp = { direction: 7, edge: { x: 40, y: 40 }, lowLevel: 2, ...(narrow ? { narrow } : {}) };
    const terrain = stamped(ramp);
    const mismatches: string[] = [];
    for (let x = -8; x <= 8; x++) {
      for (let y = x + 1; y <= 8; y++) {
        if (vertexAt(terrain, 40 + x, 40 + y) !== vertexAt(terrain, 40 + y, 40 + x)) mismatches.push(`(${x},${y})`);
      }
    }
    expect(mismatches).toEqual([]);
    // Cells too: the mirror of the cell whose lower-left corner is (x, y) has it at (y, x).
    for (let x = -8; x <= 8; x++) {
      for (let y = x + 1; y <= 8; y++) {
        expect(terrain.syncCliff[(40 + y) * SIZE + 40 + x]).toBe(terrain.syncCliff[(40 + x) * SIZE + 40 + y]);
      }
    }
  });
});

describe("list sizes in t3Terrain.xml", () => {
  it.each([
    [128, 128],
    [256, 256],
    [208, 160],
    [96, 96],
  ])("writes cliffCellList num = w·h/4 and blockTextureSetList num = w·h/64 at %i×%i", (width, height) => {
    const xml = writeT3TerrainXml({ catalog: EMPTY_CATALOG, tilesetId: "BelShirEx1", width, height, textureSetIndex: 0 });
    expect(xml).toContain(`<cliffCellList num="${(width * height) / 4}" `);
    expect(xml).toContain(`<blockTextureSetList num="${(width * height) / 64}">`);
    expect(xml.match(/<blockTextureSet /g)).toHaveLength((width * height) / 64);
  });
});

describe("t3SyncHeightMap header", () => {
  it("writes the Q12 scale 4096 non-zero in all three fields, at any size", () => {
    for (const [width, height] of [[8, 8], [96, 64]] as const) {
      const vertices = (width + 1) * (height + 1);
      const buffer = writeT3SyncHeightMap({ width, height, syncHeights: new Int16Array(vertices), cliffLevels: new Uint8Array(vertices) });
      expect([buffer.readInt32LE(28), buffer.readInt32LE(32), buffer.readInt32LE(36)]).toEqual([4096, 4096, 4096]);
    }
  });
});
