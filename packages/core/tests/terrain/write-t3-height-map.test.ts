import { describe, expect, it } from "vitest";

import {
  HEIGHT_QUANTIZE_BIAS,
  HEIGHT_QUANTIZE_SCALE,
  heightQuantization,
  writeT3HeightMap,
  type T3HeightMapOptions,
} from "../../src/terrain/write-t3-height-map.js";

describe("writeT3HeightMap", () => {
  it("emits a valid HMAP binary with the correct header and size", () => {
    const options: T3HeightMapOptions = {
      width: 8,
      height: 8,
      heights: new Float32Array(81).fill(8.0),
    };
    const buffer = writeT3HeightMap(options);
    // Header: 4 bytes magic + 4 bytes version + 4 bytes V_W + 4 bytes V_H + 16 bytes zeros = 32 bytes
    // Payload: 81 vertices * 6 bytes = 486 bytes
    // Total: 32 + 486 = 518 bytes
    expect(buffer.length).toBe(518);
    expect(buffer.toString("ascii", 0, 4)).toBe("HMAP");
    expect(buffer.readUInt32LE(4)).toBe(101);
    expect(buffer.readUInt32LE(8)).toBe(9); // V_W = width + 1
    expect(buffer.readUInt32LE(12)).toBe(9); // V_H = height + 1
  });

  it("splits heights into base and cliff channels that the Editor sums", () => {
    const heights = new Float32Array(81).fill(8.0);
    const cliffHeights = new Float32Array(81).fill(2.0);
    const buffer = writeT3HeightMap({ width: 8, height: 8, heights, cliffHeights });
    const decode = (raw: number) => raw * HEIGHT_QUANTIZE_SCALE - HEIGHT_QUANTIZE_BIAS;
    const r0 = buffer.readUInt16LE(32);
    const r1 = buffer.readUInt16LE(34);
    expect(decode(r0)).toBeCloseTo(6.0, 3); // base layer
    expect(decode(r1)).toBeCloseTo(2.0, 3); // cliff layer
    expect(decode(r0) + decode(r1)).toBeCloseTo(8.0, 3);
    expect(buffer.readUInt16LE(36)).toBe(0); // r2 (cliff level)
  });

  it("puts the whole height in the base channel when no cliff heights are given", () => {
    const buffer = writeT3HeightMap({ width: 8, height: 8, heights: new Float32Array(81).fill(6.0) });
    const decode = (raw: number) => raw * HEIGHT_QUANTIZE_SCALE - HEIGHT_QUANTIZE_BIAS;
    expect(decode(buffer.readUInt16LE(32)) + decode(buffer.readUInt16LE(34))).toBeCloseTo(6.0, 3);
  });

  it("keeps our quantization while the heights fit it, as on every map up to level 5", () => {
    const heights = new Float32Array(81).fill(16);
    const cliffHeights = new Float32Array(81).fill(8);
    expect(heightQuantization(heights, cliffHeights)).toEqual({ quantizeBias: HEIGHT_QUANTIZE_BIAS, quantizeScale: HEIGHT_QUANTIZE_SCALE });
  });

  it("widens it past ±9, to the highest value plus 1 as the Editor does, rounded up to the digits t3Terrain.xml holds", () => {
    const heights = new Float32Array(81).fill(36);
    const cliffHeights = new Float32Array(81).fill(28);
    const { quantizeBias, quantizeScale } = heightQuantization(heights, cliffHeights);
    expect(quantizeBias).toBe(9);
    expect(quantizeScale).toBe(5.798429e-4);
    expect(0xffff * quantizeScale - quantizeBias).toBeGreaterThanOrEqual(29);
    const buffer = writeT3HeightMap({ width: 8, height: 8, heights, cliffHeights });
    expect(buffer.readUInt16LE(34) * quantizeScale - quantizeBias).toBeCloseTo(28, 3);
  });

  it("refuses a height outside the quantization it's given, rather than clamping it", () => {
    const heights = new Float32Array(81).fill(20);
    const cliffHeights = new Float32Array(81).fill(12);
    expect(() => writeT3HeightMap({ width: 8, height: 8, heights, cliffHeights, quantization: { quantizeBias: HEIGHT_QUANTIZE_BIAS, quantizeScale: HEIGHT_QUANTIZE_SCALE } })).toThrow(
      "outside t3HeightMap's quantization",
    );
  });
});
