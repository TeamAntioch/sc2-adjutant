import { describe, expect, it } from "vitest";

import { writeT3TextureMasks, type T3TextureMasksOptions } from "../../src/terrain/write-t3-texture-masks.js";

describe("writeT3TextureMasks", () => {
  it("emits a valid MASK binary with the correct header and size", () => {
    const options: T3TextureMasksOptions = {
      width: 8,
      height: 8,
      textureWeights: new Uint8Array(64 * 8),
    };
    for (let i = 0; i < 64; i++) {
      options.textureWeights[i * 8] = 15;
    }

    const buffer = writeT3TextureMasks(options);

    expect(buffer.length).toBe(16448);
    expect(buffer.toString("ascii", 0, 4)).toBe("MASK");
    expect(buffer.readUInt32LE(4)).toBe(102);
    expect(buffer.readUInt32LE(12)).toBe(64);
    expect(buffer.readUInt32LE(16)).toBe(64);
  });

  it("packs both texels of a cell into high and low nibbles", () => {
    const weights = new Uint8Array(64 * 8);
    weights[0] = 15;

    const buffer = writeT3TextureMasks({ width: 8, height: 8, textureWeights: weights });

    expect(buffer.readUInt8(64)).toBe(0xff);
  });

  it("uses 64x64-texel tiles for cells beyond the first tile", () => {
    const weights = new Uint8Array(16 * 16 * 8);
    for (let cell = 0; cell < 16 * 16; cell++) {
      weights[cell * 8] = 15;
    }

    // Cell (9,0) belongs to tile X=1 and uses texture layer 1 instead of layer 0.
    weights[9 * 8] = 0;
    weights[9 * 8 + 1] = 15;

    const buffer = writeT3TextureMasks({ width: 16, height: 16, textureWeights: weights });
    const layerSize = (16 * 8 * 16 * 8) / 2;
    const tileBytes = (64 * 64) / 2;

    // Within tile X=1, local cell (1,0) starts at texel (8,0): byte 4.
    expect(buffer.readUInt8(64 + tileBytes + 4)).toBe(0x00);
    expect(buffer.readUInt8(64 + layerSize + tileBytes + 4)).toBe(0xff);
  });

  it("writes per-texel weights when given them, even column in the high nibble", () => {
    const texelWeights = new Uint8Array(64 * 64 * 8);
    // Texel (0,0) all layer 0; texel (1,0) split 9/6 between layers 0 and 1.
    texelWeights[0] = 15;
    texelWeights[8] = 9;
    texelWeights[8 + 1] = 6;
    const buffer = writeT3TextureMasks({ width: 8, height: 8, textureWeights: new Uint8Array(64 * 8), texelWeights });
    const layerSize = (64 * 64) / 2;
    expect(buffer.readUInt8(64)).toBe(0xf9);
    expect(buffer.readUInt8(64 + layerSize)).toBe(0x06);
  });
});
