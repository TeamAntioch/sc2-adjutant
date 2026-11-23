import { Buffer } from "node:buffer";

export type T3SyncTextureInfoOptions = {
  readonly width: number;
  readonly height: number;
  readonly textureSetCount: number;
  readonly textureNames: readonly string[];
  readonly dominantTextureIndices: Uint32Array;
  readonly textureSetIndices: Uint32Array;
};

export function writeT3SyncTextureInfo(options: T3SyncTextureInfoOptions): Buffer {
  const { width, height, textureSetCount, textureNames, dominantTextureIndices, textureSetIndices } = options;
  const cellCount = width * height;

  // Header: 20 bytes
  const header = Buffer.alloc(20);
  header.write("RTXT", 0, "ascii");
  header.writeUInt32LE(101, 4); // version
  header.writeUInt32LE(width, 8);
  header.writeUInt32LE(height, 12);
  header.writeUInt32LE(textureSetCount, 16);

  // String table: null-terminated ASCII strings
  const stringBuffers: Buffer[] = [];
  for (const name of textureNames) {
    const buf = Buffer.from(name + "\0", "ascii");
    stringBuffers.push(buf);
  }
  const stringTable = Buffer.concat(stringBuffers);

  // Payload: cellCount * 8 bytes (uint32 dominantTextureIdx + uint32 textureSetIdx)
  const payload = Buffer.alloc(cellCount * 8);
  for (let i = 0; i < cellCount; i++) {
    payload.writeUInt32LE(dominantTextureIndices[i] ?? 0, i * 8);
    payload.writeUInt32LE(textureSetIndices[i] ?? 0, i * 8 + 4);
  }

  return Buffer.concat([header, stringTable, payload]);
}
