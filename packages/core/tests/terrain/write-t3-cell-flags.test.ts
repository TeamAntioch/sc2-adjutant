import { describe, expect, it } from "vitest";

import { writeT3CellFlags, type T3CellFlagsOptions } from "../../src/terrain/write-t3-cell-flags.js";

describe("writeT3CellFlags", () => {
  it("emits a valid LFCT binary with the correct header and size", () => {
    const options: T3CellFlagsOptions = {
      width: 8,
      height: 8,
      flags: new Uint8Array(64).fill(0x02),
    };
    const buffer = writeT3CellFlags(options);
    // Header: 32 bytes
    // Payload: 64 cells * 1 byte = 64 bytes
    // Total: 32 + 64 = 96 bytes
    expect(buffer.length).toBe(96);
    expect(buffer.toString("ascii", 0, 4)).toBe("LFCT");
    expect(buffer.readUInt32LE(4)).toBe(102);
    expect(buffer.readUInt32LE(24)).toBe(8); // width
    expect(buffer.readUInt32LE(28)).toBe(8); // height
  });

  it("writes cell flag bitmask values to the payload", () => {
    const flags = new Uint8Array(64);
    flags[0] = 0x02; // visible terrain
    flags[1] = 0x03; // visible + cliff cutout
    flags[2] = 0x04; // chasm
    const options: T3CellFlagsOptions = { width: 8, height: 8, flags };
    const buffer = writeT3CellFlags(options);
    expect(buffer.readUInt8(32)).toBe(0x02); // cell 0
    expect(buffer.readUInt8(33)).toBe(0x03); // cell 1
    expect(buffer.readUInt8(34)).toBe(0x04); // cell 2
  });
});
