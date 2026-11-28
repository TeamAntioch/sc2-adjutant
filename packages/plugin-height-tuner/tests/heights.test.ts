// The height maths: reading a normal map's red channel, integrating a height from its slopes,
// flattening a tile's broad bands and crushing a share of it to 0.
import { describe, expect, it } from "vitest";

import { correlation, crushShare, downsampled, flattenBands, type Height, integrateNormal, inverted, readRed, wrapBlur, zeroShare } from "../heights.ts";

const SIZE = 64;

/** A tiling height: round stones 8 texels apart on a light-to-dark band across the whole tile. */
function stones(size = SIZE, band = 0): Height {
  const values = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [u, v] = [(2 * Math.PI * x) / size, (2 * Math.PI * y) / size];
      values[y * size + x] = 0.5 + 0.25 * Math.sin(8 * u) * Math.sin(8 * v) + band * Math.sin(u);
    }
  }
  return { size, values };
}

/**
 * The normal map of a height, as SC2's DXT5 terrain normals keep it: X in alpha, Y in green, and
 * `red` in red. The slopes are taken across the wrap, as the texture tiles.
 */
function normalMap(height: Height, red: (i: number) => number, strength = 4): Uint8Array {
  const { size, values } = height;
  const rgba = new Uint8Array(size * size * 4);
  const at = (x: number, y: number): number => values[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = (strength * (at(x + 1, y) - at(x - 1, y))) / 2;
      const q = (strength * (at(x, y + 1) - at(x, y - 1))) / 2;
      const length = Math.hypot(p, q, 1);
      const i = y * size + x;
      rgba.set([red(i), Math.round(((-q / length + 1) / 2) * 255), 0, Math.round(((-p / length + 1) / 2) * 255)], 4 * i);
    }
  }
  return rgba;
}

describe("readRed", () => {
  it("tells a real height from a flat red channel and from a copy of the normal's Y", () => {
    const height = stones();
    const rgba = normalMap(height, (i) => Math.round(height.values[i]! * 255));
    expect(readRed(rgba).kind).toBe("height");
    expect(readRed(normalMap(height, () => 255)).kind).toBe("flat");
    const copy = normalMap(height, () => 0);
    for (let i = 0; i < SIZE * SIZE; i++) copy[4 * i] = copy[4 * i + 1]!;
    expect(readRed(copy).kind).toBe("normal-copy");
  });
});

describe("integrateNormal", () => {
  it("gets the height back from the slopes alone, the right way up", () => {
    const height = stones();
    const recovered = integrateNormal(normalMap(height, () => 255), SIZE);
    expect(correlation(recovered, height)).toBeGreaterThan(0.95);
  });

  it("refuses a size that isn't a power of two", () => {
    expect(() => integrateNormal(new Uint8Array(48 * 48 * 4), 48)).toThrow(/power-of-two/);
  });
});

describe("wrapBlur and flattenBands", () => {
  it("blurs across the tile's edge as if it tiled", () => {
    const values = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) values[y * SIZE] = 1;
    const blurred = wrapBlur({ size: SIZE, values }, 2);
    // The column at x = 0 spreads to both x = 1 and the far edge, x = 63, alike.
    expect(blurred.values[1]).toBeCloseTo(blurred.values[SIZE - 1]!, 5);
    expect(blurred.values[1]!).toBeGreaterThan(0);
  });

  it("takes out a broad band and keeps the stones", () => {
    const banded = stones(SIZE, 0.4);
    const flattened = flattenBands(banded, 3);
    expect(correlation(flattened, stones())).toBeGreaterThan(0.9);
    expect(correlation(banded, stones())).toBeLessThan(0.75);
  });
});

describe("crushShare", () => {
  it("puts the share asked for at 0 and keeps the highest at the top level", () => {
    const crushed = crushShare(stones(), 0.25, 0.9);
    expect(zeroShare(crushed)).toBeCloseTo(0.25, 1);
    expect(Math.max(...crushed.values)).toBeCloseTo(0.9, 5);
  });

  it("upside down, crushes the highest texels instead", () => {
    const height = stones();
    const crushed = crushShare(inverted(height), 0.25, 1);
    const highest = height.values.indexOf(Math.max(...height.values));
    expect(crushed.values[highest]).toBe(0);
  });
});

describe("downsampled", () => {
  it("averages each block, as a mip level does", () => {
    const { values } = downsampled({ size: 2, values: Float32Array.from([0, 1, 0.5, 0.5]) }, 1);
    expect(values[0]).toBeCloseTo(0.5);
  });
});
