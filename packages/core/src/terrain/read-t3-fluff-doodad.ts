import { Buffer } from "node:buffer";

export type FluffEntry = { readonly x: number; readonly y: number; readonly flag: number };

/** Reads t3FluffDoodad (v102 or v103): cell positions with an optional flag byte. Meaning of the entries is undocumented. */
export function readT3FluffDoodad(buffer: Buffer): { readonly version: number; readonly entries: readonly FluffEntry[] } {
  if (buffer.toString("ascii", 0, 4) !== "DLFT") throw new Error("t3FluffDoodad: missing DLFT magic");
  const version = buffer.readUInt32LE(4);
  if (version !== 102 && version !== 103) return { version, entries: [] };
  const count = buffer.readUInt32LE(24);
  const stride = version === 103 ? 9 : 8;
  const entries: FluffEntry[] = [];
  for (let i = 0; i < count; i++) {
    const offset = 28 + i * stride;
    if (offset + stride > buffer.length) break;
    entries.push({
      x: buffer.readInt32LE(offset),
      y: buffer.readInt32LE(offset + 4),
      flag: version === 103 ? buffer[offset + 8]! : 0,
    });
  }
  return { version, entries };
}
