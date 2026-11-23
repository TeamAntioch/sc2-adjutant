import { describe, expect, it } from "vitest";

import { writeT3SyncTextureInfo, type T3SyncTextureInfoOptions } from "../../src/terrain/write-t3-sync-texture-info.js";

describe("writeT3SyncTextureInfo", () => {
  it("emits a valid RTXT binary with the correct header, string table, and size", () => {
    const textureNames = ["KorhalCityEx2Texture0", "KorhalCityEx2Texture1"];
    const options: T3SyncTextureInfoOptions = {
      width: 8,
      height: 8,
      textureSetCount: 1,
      textureNames,
      dominantTextureIndices: new Uint32Array(64).fill(0),
      textureSetIndices: new Uint32Array(64).fill(0),
    };
    const buffer = writeT3SyncTextureInfo(options);
    // Header: 4 (magic) + 4 (version) + 4 (width) + 4 (height) + 4 (textureSetCount) = 20 bytes
    // String table: 2 null-terminated strings
    // Payload: 64 cells * 8 bytes = 512 bytes
    // Total: 20 + (string table length) + 512
    const stringTableSize = textureNames.reduce((sum, name) => sum + name.length + 1, 0);
    const expectedSize = 20 + stringTableSize + 512;
    expect(buffer.length).toBe(expectedSize);
    expect(buffer.toString("ascii", 0, 4)).toBe("RTXT");
    expect(buffer.readUInt32LE(4)).toBe(101);
    expect(buffer.readUInt32LE(8)).toBe(8); // width
    expect(buffer.readUInt32LE(12)).toBe(8); // height
    expect(buffer.readUInt32LE(16)).toBe(1); // textureSetCount
  });

  it("writes dominant texture index and texture set index to the payload", () => {
    const options: T3SyncTextureInfoOptions = {
      width: 8,
      height: 8,
      textureSetCount: 1,
      textureNames: ["Tex0"],
      dominantTextureIndices: new Uint32Array(64).fill(3),
      textureSetIndices: new Uint32Array(64).fill(0),
    };
    const buffer = writeT3SyncTextureInfo(options);
    const stringTableSize = "Tex0".length + 1;
    const payloadOffset = 20 + stringTableSize;
    // First cell payload: dominantTextureIdx=3, textureSetIdx=0
    expect(buffer.readUInt32LE(payloadOffset)).toBe(3);
    expect(buffer.readUInt32LE(payloadOffset + 4)).toBe(0);
  });
});
