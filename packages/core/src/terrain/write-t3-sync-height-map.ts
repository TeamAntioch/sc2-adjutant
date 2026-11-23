import { Buffer } from "node:buffer";

export type T3SyncHeightMapOptions = {
  readonly width: number;
  readonly height: number;
  readonly syncHeights: Int16Array;
  readonly cliffLevels: Uint8Array;
};

export function writeT3SyncHeightMap(options: T3SyncHeightMapOptions): Buffer {
  const { width, height, syncHeights, cliffLevels } = options;
  const vertexWidth = width + 1;
  const vertexHeight = height + 1;
  const vertexCount = vertexWidth * vertexHeight;

  // Header: 64 bytes
  const header = Buffer.alloc(64);
  header.write("SMAP", 0, "ascii");
  header.writeUInt32LE(102, 4); // version
  header.writeUInt32LE(vertexWidth, 8);
  header.writeUInt32LE(vertexHeight, 12);
  // bytes 16..27: [0, 0, 0]
  // bytes 28..39: [4096, 4096, 4096] (0x1000 fixed-point scale factors)
  header.writeUInt32LE(0x1000, 28);
  header.writeUInt32LE(0x1000, 32);
  header.writeUInt32LE(0x1000, 36);
  // bytes 40..63: zeros (already zeroed by alloc)

  // Payload: vertexCount * 4 bytes (int16 height + uint16 cliffLevel)
  const payload = Buffer.alloc(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    const h = syncHeights[i] ?? 0;
    const cl = cliffLevels[i] ?? 0;
    // 8.8 fixed point: value = round(height * 256)
    payload.writeInt16LE(Math.round(h), i * 4);
    payload.writeUInt16LE(cl, i * 4 + 2);
  }

  return Buffer.concat([header, payload]);
}
