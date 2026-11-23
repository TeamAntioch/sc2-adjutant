import { Buffer } from "node:buffer";

export type T3SyncCliffLevelOptions = {
  readonly width: number;
  readonly height: number;
  /** Raw value per cell: 64 per cliff level, in between on ramps. */
  readonly syncCliff: Uint16Array;
};

export function writeT3SyncCliffLevel(options: T3SyncCliffLevelOptions): Buffer {
  const { width, height, syncCliff } = options;
  const cellCount = width * height;

  // Header: 32 bytes
  const header = Buffer.alloc(32);
  header.write("CLIF", 0, "ascii");
  header.writeUInt32LE(100, 4); // version
  header.writeUInt32LE(width, 8);
  header.writeUInt32LE(height, 12);
  // bytes 16..31 are zeros (already zeroed by alloc)

  // Payload: cellCount * 2 bytes (uint16 cliff level scaled by 64)
  const payload = Buffer.alloc(cellCount * 2);
  for (let i = 0; i < cellCount; i++) {
    payload.writeUInt16LE(syncCliff[i] ?? 0, i * 2);
  }

  return Buffer.concat([header, payload]);
}
