import { Buffer } from "node:buffer";

export type T3CellFlagsOptions = {
  readonly width: number;
  readonly height: number;
  readonly flags: Uint8Array;
};

export function writeT3CellFlags(options: T3CellFlagsOptions): Buffer {
  const { width, height, flags } = options;
  const cellCount = width * height;

  // Header: 32 bytes
  const header = Buffer.alloc(32);
  header.write("LFCT", 0, "ascii");
  header.writeUInt32LE(102, 4); // version
  // bytes 8..23: zeros (already zeroed by alloc)
  header.writeUInt32LE(width, 24);
  header.writeUInt32LE(height, 28);
  // bytes 32? Wait, header is 32 bytes (0..31), so payload starts at 32.
  // Actually the spec says header is 32 bytes (0x00..0x1F), so payload starts at 32.

  // Payload: cellCount * 1 byte (uint8 bitmask)
  const payload = Buffer.alloc(cellCount);
  for (let i = 0; i < cellCount; i++) {
    payload.writeUInt8(flags[i] ?? 0x02, i);
  }

  return Buffer.concat([header, payload]);
}
