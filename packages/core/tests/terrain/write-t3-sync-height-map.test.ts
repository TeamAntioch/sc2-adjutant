import { describe, expect, it } from "vitest";

import { writeT3SyncHeightMap, type T3SyncHeightMapOptions } from "../../src/terrain/write-t3-sync-height-map.js";

describe("writeT3SyncHeightMap", () => {
  it("emits a valid SMAP binary with the correct header and size", () => {
    const options: T3SyncHeightMapOptions = {
      width: 8,
      height: 8,
      syncHeights: new Int16Array(81).fill(Math.round(8.0 * 256)),
      cliffLevels: new Uint8Array(81).fill(1),
    };
    const buffer = writeT3SyncHeightMap(options);
    // Header: 64 bytes
    // Payload: 81 vertices * 4 bytes = 324 bytes
    // Total: 64 + 324 = 388 bytes
    expect(buffer.length).toBe(388);
    expect(buffer.toString("ascii", 0, 4)).toBe("SMAP");
    expect(buffer.readUInt32LE(4)).toBe(102);
    expect(buffer.readUInt32LE(8)).toBe(9); // V_W = width + 1
    expect(buffer.readUInt32LE(12)).toBe(9); // V_H = height + 1
  });

  it("writes sync height and cliff level values to the payload", () => {
    const syncHeights = new Int16Array(81).fill(Math.round(8.0 * 256));
    const cliffLevels = new Uint8Array(81).fill(2);
    const options: T3SyncHeightMapOptions = { width: 8, height: 8, syncHeights, cliffLevels };
    const buffer = writeT3SyncHeightMap(options);
    // First vertex payload at offset 64: int16 height + uint16 cliffLevel
    expect(buffer.readInt16LE(64)).toBe(Math.round(8.0 * 256));
    expect(buffer.readUInt16LE(66)).toBe(2);
  });
});
