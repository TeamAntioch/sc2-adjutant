import { Buffer } from "node:buffer";

import { readMapInfo } from "../../src/map/read-map-info.js";

/**
 * MapInfo with its fog string (Unexplored Areas) set to `fog`, as the Editor saves it: the string
 * changes length and everything after it moves, and the integrity hash, which doesn't count it, stays.
 */
export function withFog(mapInfo: Buffer, fog: string): Buffer {
  const current = readMapInfo(mapInfo).fogType;
  const at = mapInfo.indexOf(Buffer.from(`\0${current}\0`, "latin1"), 24) + 1;
  if (at === 0) throw new Error(`MapInfo has no fog string ${current}`);
  return Buffer.concat([mapInfo.subarray(0, at), Buffer.from(fog, "latin1"), mapInfo.subarray(at + current.length)]);
}
