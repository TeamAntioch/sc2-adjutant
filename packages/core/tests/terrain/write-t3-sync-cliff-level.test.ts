import { describe, expect, it } from "vitest";

import { writeT3SyncCliffLevel, type T3SyncCliffLevelOptions } from "../../src/terrain/write-t3-sync-cliff-level.js";

describe("writeT3SyncCliffLevel", () => {
  it("emits a valid CLIF binary with the correct header and size", () => {
    const options: T3SyncCliffLevelOptions = {
      width: 8,
      height: 8,
      syncCliff: new Uint16Array(64).fill(64),
    };
    const buffer = writeT3SyncCliffLevel(options);
    // Header: 32 bytes
    // Payload: 64 cells * 2 bytes = 128 bytes
    // Total: 32 + 128 = 160 bytes
    expect(buffer.length).toBe(160);
    expect(buffer.toString("ascii", 0, 4)).toBe("CLIF");
    expect(buffer.readUInt32LE(4)).toBe(100);
    expect(buffer.readUInt32LE(8)).toBe(8); // width
    expect(buffer.readUInt32LE(12)).toBe(8); // height
  });

  it("writes the raw per-cell values (64 per level, in between on ramps)", () => {
    const syncCliff = Uint16Array.from([0, 64, 72, 192]);
    const buffer = writeT3SyncCliffLevel({ width: 2, height: 2, syncCliff });
    expect([0, 1, 2, 3].map((i) => buffer.readUInt16LE(32 + i * 2))).toEqual([0, 64, 72, 192]);
  });
});
