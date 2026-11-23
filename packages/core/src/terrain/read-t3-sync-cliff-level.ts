import { Buffer } from "node:buffer";

export type T3SyncCliffLevel = {
  readonly width: number;
  readonly height: number;
  /** Raw value per cell: 64 per cliff level, in between on ramps. */
  readonly syncCliff: Uint16Array;
};

/** Reads t3SyncCliffLevel: the inverse of writeT3SyncCliffLevel. */
export function readT3SyncCliffLevel(buffer: Buffer): T3SyncCliffLevel {
  if (buffer.toString("ascii", 0, 4) !== "CLIF") throw new Error("t3SyncCliffLevel: missing CLIF magic");
  const width = buffer.readUInt32LE(8);
  const height = buffer.readUInt32LE(12);
  const syncCliff = new Uint16Array(width * height);
  for (let i = 0; i < syncCliff.length; i++) syncCliff[i] = buffer.readUInt16LE(32 + i * 2);
  return { width, height, syncCliff };
}
