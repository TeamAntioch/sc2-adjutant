import { Buffer } from "node:buffer";

import { MAPINFO_MAGIC } from "../terrain/write-map-info.js";

export type MapInfoSummary = {
  readonly version: number;
  readonly width: number;
  readonly height: number;
  readonly fogType: string;
  readonly tilesetId: string;
  /** Playable bounds: left, bottom, right, top. */
  readonly playableBounds: readonly [number, number, number, number];
};

function cString(buffer: Buffer, offset: number): [string, number] {
  const end = buffer.indexOf(0, offset);
  return [buffer.toString("utf8", offset, end), end + 1];
}

/**
 * Reads the head of MapInfo, up to the camera bounds. Editor versions differ in
 * the fields before the fog type, so the fog and tileset strings are located as
 * the two C strings that immediately precede four int32 bounds within the map size.
 */
export function readMapInfo(buffer: Buffer): MapInfoSummary {
  if (buffer.toString("ascii", 0, 4) !== MAPINFO_MAGIC) throw new Error(`MapInfo: missing ${MAPINFO_MAGIC} magic`);
  const version = buffer.readUInt32LE(4);
  const width = buffer.readUInt32LE(16);
  const height = buffer.readUInt32LE(20);
  for (let offset = 24; offset + 16 <= buffer.length; offset++) {
    if (buffer[offset - 1] !== 0) continue;
    const [left, bottom, right, top] = [0, 4, 8, 12].map((k) => buffer.readInt32LE(offset + k)) as [number, number, number, number];
    if (left < 0 || bottom < 0 || right <= left || top <= bottom || right > width || top > height) continue;
    // Walk back over the tileset and fog C strings.
    const tilesetStart = buffer.lastIndexOf(0, offset - 2) + 1;
    const fogStart = buffer.lastIndexOf(0, tilesetStart - 2) + 1;
    const [tilesetId] = cString(buffer, tilesetStart);
    const [fogType] = cString(buffer, fogStart);
    if (!/^[\w.-]+$/.test(tilesetId)) continue;
    return { version, width, height, fogType, tilesetId, playableBounds: [left, bottom, right, top] };
  }
  throw new Error("MapInfo: camera bounds not found");
}
