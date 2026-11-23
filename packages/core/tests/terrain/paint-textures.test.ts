import { describe, expect, it } from "vitest";

import { StyleBlueprintSchema } from "../support/workspaces.js";
import { TEXELS_PER_CELL } from "../../src/terrain/texture-grid.js";
import { rasterizeTerrain } from "../../src/terrain/rasterize.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/**
 * A 64×64 field (layer 0), a meadow beside it at the same level (layer 1), and a mesa (layer 2)
 * with a ramp; the first three textures are all mid-toned, so seams blend wide.
 */
const MID_TONED = ["BelShirDirtLightEx2", "BelShirBrushEx2", "BelShirSmallTilesEx2", "BelShirBricksLargeEx2", "BelShirDirtDarkEx2"];
const paintBlueprint = (textures: string[]) => ({
    id: "paint",
    campaignId: "test",
    title: "Paint",
    setting: "test",
    mapSize: { width: 64, height: 64 },
    tilesetId: "BelShirEx2",
    textures,
    zones: [
      { id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) },
      { id: "meadow", name: "Meadow", elevation: 1, landform: "flat", role: "path", polygon: rect(0, 0, 20, 64) },
      // Its west edge (x = 33.6) is off the 2-cell corner grid: the cliff takes in cell 33, whose centre is outside.
      {
        id: "mesa",
        name: "Mesa",
        elevation: 2,
        landform: "ridge",
        role: "path",
        polygon: rect(33.6, 30, 50, 50),
        connections: [{ toZoneId: "field", type: "ramp", at: { x: 40, y: 30 } }],
      },
    ],
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    screenplay: { title: "Paint" },
});
const terrain = rasterizeTerrain(StyleBlueprintSchema.parse(paintBlueprint(MID_TONED)));
const W = 64;
const TW = W * TEXELS_PER_CELL;
const cellLayer = (x: number, y: number): number => {
  const weights = terrain.textureWeights.subarray((y * W + x) * 8, (y * W + x) * 8 + 8);
  return weights.indexOf(Math.max(...weights));
};
const texel = (tx: number, ty: number): number[] => [...terrain.texelWeights.subarray((ty * TW + tx) * 8, (ty * TW + tx) * 8 + 8)];

describe("paintTextures", () => {
  it("gives every texel and every cell weights that sum to 15, as the Editor's brush does", () => {
    for (let t = 0; t < TW * TW; t += 97) expect(texel(t % TW, Math.floor(t / TW)).reduce((a, b) => a + b, 0)).toBe(15);
    for (let cell = 0; cell < W * W; cell++) {
      expect(terrain.textureWeights.subarray(cell * 8, cell * 8 + 8).reduce((a, b) => a + b, 0)).toBe(15);
    }
  });

  it("runs a plateau's texture to its cliff, even off the zone's polygon", () => {
    expect(terrain.syncCliff[40 * W + 33]).toBe(128);
    expect(cellLayer(33, 40)).toBe(2);
    expect(cellLayer(31, 40)).toBe(0);
  });

  it("paints a ramp with the top's texture, blending into the ground at its foot", () => {
    // Up the ramp's centre line (x = 40, uphill north): open ground, foot (y = 26), top (y = 29).
    const mesaShare = (y: number): number => terrain.textureWeights[(y * W + 40) * 8 + 2]!;
    expect(terrain.syncCliff[26 * W + 40]! % 64).not.toBe(0);
    expect(mesaShare(20)).toBe(0);
    expect(mesaShare(24)).toBeGreaterThan(0);
    expect(mesaShare(26)).toBeGreaterThan(mesaShare(24));
    expect(mesaShare(26)).toBeLessThan(15);
    expect(mesaShare(28)).toBeGreaterThan(mesaShare(26));
    expect(mesaShare(30)).toBe(15);
  });

  it("blends a seam between same-level zones over a couple of cells, varying within cells", () => {
    // Deep inside each side: pure.
    expect(texel(10 * 8, 32 * 8)[1]).toBe(15);
    expect(texel(30 * 8, 10 * 8)[0]).toBe(15);
    // Along the seam (x = 20): both textures, and texels within one cell differ.
    let blended = 0;
    let varied = 0;
    for (let y = 0; y < 64; y++) {
      for (const x of [19, 20]) {
        const cell = new Set<string>();
        for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) cell.add(texel(x * 8 + tx, y * 8 + ty).join());
        if ([...cell].some((weights) => weights.split(",").filter((w) => w !== "0").length > 1)) blended++;
        if (cell.size > 1) varied++;
      }
    }
    expect(blended).toBeGreaterThan(64);
    expect(varied).toBeGreaterThan(64);
    // The seam wanders off the sketch's straight line, but stays within reach of it.
    const seamX = Array.from({ length: 64 }, (_, y) => [...Array(64).keys()].find((x) => cellLayer(x, y) !== 1)!);
    expect(Math.max(...seamX) - Math.min(...seamX)).toBeGreaterThanOrEqual(3);
    for (const x of seamX) expect(Math.abs(x - 20)).toBeLessThanOrEqual(10);
  });

  it("varies the blend's width along a seam, from narrow to several cells", () => {
    // Along each texel row, the run of texels with no texture at 14 or more across the seam.
    const widths: number[] = [];
    for (let ty = 0; ty < 64 * 8; ty += 8) {
      let start = -1;
      for (let tx = 0; tx < 30 * 8; tx++) {
        const mixed = texel(tx, ty).every((weight) => weight < 14);
        if (mixed && start < 0) start = tx;
        if (!mixed && start >= 0) {
          widths.push(tx - start);
          start = -1;
        }
      }
    }
    widths.sort((a, b) => a - b);
    expect(widths[0]!).toBeLessThan(16);
    expect(widths[widths.length - 1]!).toBeGreaterThanOrEqual(3 * widths[0]!);
  });

  it("meets textures of different tones at a narrow seam, not a wide blend (DL-03)", () => {
    // Across the meadow's seam, along texel rows: the runs of texels with no texture at 14 or more.
    const seamWidths = (painted: typeof terrain): number[] => {
      const widths: number[] = [];
      for (let ty = 0; ty < 64 * 8; ty += 8) {
        let start = -1;
        for (let tx = 0; tx < 30 * 8; tx++) {
          const weights = [...painted.texelWeights.subarray((ty * TW + tx) * 8, (ty * TW + tx) * 8 + 8)];
          const mixed = weights.every((weight) => weight < 14);
          if (mixed && start < 0) start = tx;
          if (!mixed && start >= 0) {
            widths.push(tx - start);
            start = -1;
          }
        }
      }
      return widths.sort((a, b) => a - b);
    };
    const median = (values: number[]): number => values[Math.floor(values.length / 2)]!;
    // The meadow dark (BelShirDirtDarkEx2) against the mid field, beside the all-mid map.
    const contrast = rasterizeTerrain(
      StyleBlueprintSchema.parse(paintBlueprint(["BelShirDirtLightEx2", "BelShirDirtDarkEx2", "BelShirSmallTilesEx2"])),
    );
    expect(median(seamWidths(contrast))).toBeLessThanOrEqual(10);
    expect(median(seamWidths(terrain))).toBeGreaterThan(2 * median(seamWidths(contrast)));
  });

  it("keeps same-tone seams wide beside a cliff down to a different tone", () => {
    // A dark pit along the bottom (y < 6); the mid field/meadow seam runs up past it.
    const withPit = paintBlueprint(MID_TONED);
    withPit.zones.push({ id: "pit", name: "Pit", elevation: 0, landform: "canyon", role: "path", texture: "BelShirDirtDarkEx2", polygon: rect(0, 0, 64, 6) } as (typeof withPit.zones)[number]);
    const pitted = rasterizeTerrain(StyleBlueprintSchema.parse(withPit));
    // Seam widths in the rows just above the pit's cliff (cells y 6-9).
    const widths = (painted: typeof terrain): number[] => {
      const out: number[] = [];
      for (let ty = 6 * 8; ty < 10 * 8; ty += 2) {
        let start = -1;
        for (let tx = 0; tx < 30 * 8; tx++) {
          const weights = [...painted.texelWeights.subarray((ty * TW + tx) * 8, (ty * TW + tx) * 8 + 8)];
          const mixed = weights.every((weight) => weight < 14);
          if (mixed && start < 0) start = tx;
          if (!mixed && start >= 0) {
            out.push(tx - start);
            start = -1;
          }
        }
      }
      return out.sort((a, b) => a - b);
    };
    const median = (values: number[]): number => values[Math.floor(values.length / 2)]!;
    expect(median(widths(pitted))).toBeGreaterThan(0.6 * median(widths(terrain)));
  });
});
