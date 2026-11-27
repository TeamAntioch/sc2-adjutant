// Paint Regions painted (ADR-0028, #134): the compile lays each region's mix over the Zone palettes'
// paint, in order, feathered inward from its outline. A blend weight holds that fraction of every
// cell's layers inside the region; the ground's other textures are scaled to fill the rest.
//
// The fixture is paint-regions.test.ts's in tests/domain: a 64×64 generated map, a field on level 1
// (set 0, the map's palette: MarSaraDirt with MarSaraSand patches) and, from x 32, a mesa on level 2
// painted from the "cave" texture set.
import { describe, expect, it } from "vitest";

import { rasterizeTerrain } from "../../src/terrain/rasterize.js";
import { StyleBlueprintSchema } from "../support/workspaces.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const W = 64;
const CAVE = ["AgriaDirtRough", "Zerus5", "AiurRock"];
const MAP = ["MarSaraDirt", "MarSaraSand", "MarSaraRocky", "MarSaraDirtCracked", "MarSaraDarkSand", "MarSaraBlackenedRock", "MarSaraConcrete", "MarSaraPanels"];
const TEXELS = 8;

function blueprint(paintRegions: unknown[], extra: Record<string, unknown> = {}) {
  return StyleBlueprintSchema.parse({
    id: "paint-regions",
    campaignId: "test",
    title: "Paint regions",
    setting: "test",
    mapSize: { width: W, height: W },
    tilesetId: "MarSara",
    textures: MAP,
    zones: [
      { id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) },
      { id: "mesa", name: "Mesa", elevation: 2, landform: "ridge", role: "path", polygon: rect(32, 0, 64, 64) },
    ],
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    screenplay: { title: "Paint regions" },
    texturePalette: { main: "MarSaraDirt", variety: ["MarSaraSand"] },
    textureSets: [{ id: "cave", textures: CAVE, zones: ["mesa"] }],
    paintRegions,
    ...extra,
  });
}

/** A layer's share of a cell's texel weights (0..1): the mean of its 64 texels' weight over 15. */
function cellShare(texelWeights: Uint8Array, x: number, y: number, layer: number): number {
  let sum = 0;
  for (let ty = 0; ty < TEXELS; ty++) {
    for (let tx = 0; tx < TEXELS; tx++) sum += texelWeights[((y * TEXELS + ty) * W * TEXELS + x * TEXELS + tx) * 8 + layer]!;
  }
  return sum / (TEXELS * TEXELS * 15);
}

/** Whether a cell's 64 texels have the same weights in both paints. */
function sameCell(a: Uint8Array, b: Uint8Array, x: number, y: number): boolean {
  for (let ty = 0; ty < TEXELS; ty++) {
    const start = ((y * TEXELS + ty) * W * TEXELS + x * TEXELS) * 8;
    for (let i = start; i < start + TEXELS * 8; i++) if (a[i] !== b[i]) return false;
  }
  return true;
}

const ROCKY = MAP.indexOf("MarSaraRocky");
const without = rasterizeTerrain(blueprint([]));

describe("a Paint Region's blend weight", () => {
  const stone = { id: "stone", polygon: rect(8, 8, 24, 24), mix: [{ texture: "MarSaraRocky", weight: 0.15 }] };
  const painted = rasterizeTerrain(blueprint([stone]));

  it("holds that fraction of the layer weight in every cell inside the region, past its falloff", () => {
    for (let y = 10; y < 22; y++) {
      for (let x = 10; x < 22; x++) expect(cellShare(painted.texelWeights, x, y, ROCKY)).toBeCloseTo(0.15, 2);
    }
  });

  it("feathers in over the falloff (2 cells by default), from the ground at the outline to the full weight", () => {
    const row = [8, 9, 10].map((x) => cellShare(painted.texelWeights, x, 16, ROCKY));
    expect(row[0]).toBeGreaterThan(0);
    expect(row[0]).toBeLessThan(row[1]!);
    expect(row[1]).toBeLessThan(0.15);
    expect(row[2]).toBeCloseTo(0.15, 2);
  });

  it("leaves every cell outside the region as the Zone palette paints it", () => {
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        if (x >= 8 && x < 24 && y >= 8 && y < 24) continue;
        expect(sameCell(painted.texelWeights, without.texelWeights, x, y), `cell ${x}, ${y}`).toBe(true);
      }
    }
  });

  it("keeps every texel's weights summing to 15", () => {
    for (let t = 0; t < painted.texelWeights.length; t += 8) {
      let sum = 0;
      for (let layer = 0; layer < 8; layer++) sum += painted.texelWeights[t + layer]!;
      if (sum !== 15) throw new Error(`texel ${t / 8} sums to ${sum}`);
    }
  });
});

describe("a Paint Region's other textures", () => {
  const SAND = MAP.indexOf("MarSaraSand");
  const DIRT = MAP.indexOf("MarSaraDirt");
  const CRACKED = MAP.indexOf("MarSaraDirtCracked");
  const inner = (check: (x: number, y: number) => void) => {
    for (let y = 10; y < 22; y++) for (let x = 10; x < 22; x++) check(x, y);
  };

  it("a texture without an amount takes what the weights leave, in place of the ground", () => {
    const painted = rasterizeTerrain(blueprint([{ id: "cracked", polygon: rect(8, 8, 24, 24), mix: [{ texture: "MarSaraRocky", weight: 0.2 }, { texture: "MarSaraDirtCracked" }] }]));
    inner((x, y) => {
      expect(cellShare(painted.texelWeights, x, y, CRACKED)).toBeCloseTo(0.8, 2);
      expect(cellShare(painted.texelWeights, x, y, DIRT)).toBe(0);
    });
  });

  it("with none, the ground's textures fill what the weights leave, each in proportion", () => {
    const painted = rasterizeTerrain(blueprint([{ id: "stone", polygon: rect(8, 8, 24, 24), mix: [{ texture: "MarSaraRocky", weight: 0.4 }] }]));
    inner((x, y) => {
      const ground = cellShare(without.texelWeights, x, y, DIRT) + cellShare(without.texelWeights, x, y, SAND);
      expect(cellShare(painted.texelWeights, x, y, DIRT)).toBeCloseTo((cellShare(without.texelWeights, x, y, DIRT) / ground) * 0.6, 1);
    });
  });
});

/** Over the texels of cells x0..x1-1 × y0..y1-1, a layer's mean share (0..1), and the fractions of texels where it is 0 (`bare`) or within a weight of `full` (`core`). */
function texelShares(texelWeights: Uint8Array, [x0, y0, x1, y1]: readonly number[], layer: number, full = 1): { mean: number; bare: number; core: number } {
  let [sum, bare, core, count] = [0, 0, 0, 0];
  for (let ty = y0! * TEXELS; ty < y1! * TEXELS; ty++) {
    for (let tx = x0! * TEXELS; tx < x1! * TEXELS; tx++) {
      const weight = texelWeights[(ty * W * TEXELS + tx) * 8 + layer]! / 15;
      sum += weight;
      if (weight === 0) bare++;
      if (weight >= full - 1 / 15 - 1e-9) core++;
      count++;
    }
  }
  return { mean: sum / count, bare: bare / count, core: core / count };
}

describe("a Paint Region's area share", () => {
  const DARK = MAP.indexOf("MarSaraDarkSand");
  // The region is cells 8-23; past its 2-cell falloff, cells 10-21.
  const CORE = [10, 10, 22, 22];
  const region = (mix: unknown[]) => ({ id: "sandy", polygon: rect(8, 8, 24, 24), mix });

  // The measure: the texture's mean weight over the region's texels past the falloff, within 0.01.
  for (const share of [0.05, 0.2, 0.4]) {
    it(`paints patches holding ${share} of the region past its falloff, as washes with a full-strength core`, () => {
      const painted = rasterizeTerrain(blueprint([region([{ texture: "MarSaraDarkSand", share }])]));
      const { mean, bare, core } = texelShares(painted.texelWeights, CORE, DARK);
      expect(Math.abs(mean - share)).toBeLessThanOrEqual(0.01);
      // Patches, not a tint: some ground has none of it, and some holds it in full.
      expect(bare).toBeGreaterThan(0.2);
      expect(core).toBeGreaterThan(share / 4);
    });
  }

  it("works with blend weights in the same region: the weight holds in every cell, under and around the patches, which take what it leaves from the rest", () => {
    const CRACKED = MAP.indexOf("MarSaraDirtCracked");
    const mix = [{ texture: "MarSaraRocky", weight: 0.15 }, { texture: "MarSaraDarkSand", share: 0.2 }, { texture: "MarSaraDirtCracked" }];
    const painted = rasterizeTerrain(blueprint([region(mix)]));
    for (let y = 10; y < 22; y++) for (let x = 10; x < 22; x++) expect(cellShare(painted.texelWeights, x, y, ROCKY)).toBeCloseTo(0.15, 2);
    // A patch's core holds all the weight leaves: 0.85.
    const dark = texelShares(painted.texelWeights, CORE, DARK, 0.85);
    expect(Math.abs(dark.mean - 0.2)).toBeLessThanOrEqual(0.01);
    expect(dark.core).toBeGreaterThan(0.05);
    expect(dark.bare).toBeGreaterThan(0.2);
    // Weights, share and rest add up to the region's paint.
    expect(Math.abs(texelShares(painted.texelWeights, CORE, CRACKED).mean - 0.65)).toBeLessThanOrEqual(0.01);
  });

  it("shares the ground between two shares where their patches overlap, each meeting its own share", () => {
    const SAND = MAP.indexOf("MarSaraSand");
    const painted = rasterizeTerrain(blueprint([region([{ texture: "MarSaraDarkSand", share: 0.3 }, { texture: "MarSaraSand", share: 0.3 }])]));
    expect(Math.abs(texelShares(painted.texelWeights, CORE, DARK).mean - 0.3)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(texelShares(painted.texelWeights, CORE, SAND).mean - 0.3)).toBeLessThanOrEqual(0.01);
  });

  it("fades out beside a block of another texture set, as the variety painter's patches do, and still meets its share", () => {
    // The cave set holds MarSaraDarkSand too, on its layer 3; its blocks start at x 32.
    const cave = [...CAVE, "MarSaraDarkSand"];
    const across = { id: "across", polygon: rect(8, 8, 56, 24), mix: [{ texture: "MarSaraDarkSand", share: 0.4 }] };
    const painted = rasterizeTerrain(blueprint([across], { textureSets: [{ id: "cave", textures: cave, zones: ["mesa"] }] }));
    /** Dark sand's weight (0..1) at a texel, on its layer in the texel's set. */
    const dark = (tx: number, ty: number) => painted.texelWeights[(ty * W * TEXELS + tx) * 8 + (tx < 32 * TEXELS ? DARK : 3)]! / 15;
    let [atLine, nearLine, most] = [0, 0, 0];
    for (let ty = 10 * TEXELS; ty < 22 * TEXELS; ty++) {
      for (let tx = 10 * TEXELS; tx < 54 * TEXELS; tx++) {
        const d = Math.abs((tx + 0.5) / TEXELS - 32);
        if (d < 0.5) atLine = Math.max(atLine, dark(tx, ty));
        else if (d < 1.25) nearLine = Math.max(nearLine, dark(tx, ty));
        else if (d >= 2) most = Math.max(most, dark(tx, ty));
      }
    }
    // None within half a cell of the block line, at most half its core a cell and a quarter away, whole from 2 cells on.
    expect(atLine).toBe(0);
    expect(nearLine).toBeLessThanOrEqual(0.5 + 1 / 15);
    expect(most).toBe(1);
    // Past the 2-cell falloff, cells 10-53, on both sets' layers.
    const mean = (texelShares(painted.texelWeights, [10, 10, 32, 22], DARK).mean * 22 + texelShares(painted.texelWeights, [32, 10, 54, 22], 3).mean * 22) / 44;
    expect(Math.abs(mean - 0.4)).toBeLessThanOrEqual(0.01);
  });
});

describe("a Paint Region's cells", () => {
  it("are those at its levels: a region across the mesa's edge kept to level 1 leaves the mesa as it was", () => {
    const painted = rasterizeTerrain(blueprint([{ id: "low", polygon: rect(24, 8, 40, 24), mix: [{ texture: "MarSaraRocky", weight: 0.3 }], levels: [1] }]));
    expect(cellShare(painted.texelWeights, 28, 16, ROCKY)).toBeCloseTo(0.3, 2);
    for (let x = 32; x < 40; x++) expect(sameCell(painted.texelWeights, without.texelWeights, x, 16), `cell ${x}, 16`).toBe(true);
  });

  it("are refused when their set lacks one of its textures, naming the set and its textures", () => {
    // The schema refuses it first; the compile refuses a Blueprint made in code as well.
    const made = { ...blueprint([]), paintRegions: [{ id: "top", polygon: rect(36, 8, 48, 24), mix: [{ texture: "MarSaraRocky", weight: 0.3 }] }] };
    expect(() => rasterizeTerrain(made)).toThrow(`Paint Region top paints cells on texture set cave, which doesn't hold MarSaraRocky: ${CAVE.join(", ")}`);
  });
});

describe("two overlapping Paint Regions", () => {
  // The earlier holds rocky at half; the later, from x 16, at a tenth.
  const earlier = { id: "earlier", polygon: rect(8, 8, 24, 24), mix: [{ texture: "MarSaraRocky", weight: 0.5 }] };
  const later = { id: "later", polygon: rect(16, 8, 32, 24), mix: [{ texture: "MarSaraRocky", weight: 0.1 }] };
  const painted = rasterizeTerrain(blueprint([earlier, later]));
  const rocky = (x: number) => cellShare(painted.texelWeights, x, 16, ROCKY);

  it("paint the later one where they overlap, past its falloff", () => {
    for (const x of [18, 20, 23]) expect(rocky(x)).toBeCloseTo(0.1, 2);
    expect(rocky(12)).toBeCloseTo(0.5, 2);
  });

  it("fade from the earlier to the later over the later one's falloff", () => {
    expect(rocky(16)).toBeLessThan(0.5);
    expect(rocky(16)).toBeGreaterThan(rocky(17));
    expect(rocky(17)).toBeGreaterThan(0.1);
  });
});
