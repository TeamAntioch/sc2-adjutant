// The heights of a Map Package's Kept ground, read from its own files and written back in place
// (spec #247). t3HeightMap holds three uint16 per vertex: the base layer (r0), the cliff layer (r1)
// and the vertex cliff level (r2), decoded with the quantization t3Terrain.xml gives (the Editor
// picks it per map). t3SyncHeightMap holds the simulation's height (int16, 1/256 units) and cliff
// level per vertex. Height brushes change only the base layer, so cliffs stay where they are; cliff
// and ramp edits change the cliff layer and the vertex cliff levels. Only the vertices whose value
// changes are rewritten: every other byte stays as the Editor wrote it. The sync height follows the
// render height: where the two agreed they still do, and where the Editor keeps a walking height
// apart from it (at cliff vertices), the gap is kept. At a vertex whose cliff layer changes the
// cliff it walked beside has moved, so a walking height's gap is dropped (the generator's
// round(render × 256)) and only the Editor's rounding, within 2/256, is kept.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { readT3TerrainXml } from "../terrain/read-t3-terrain-xml.js";
import { formatExponent } from "../terrain/write-t3-terrain-xml.js";

const HMAP_HEADER = 32;
const SMAP_HEADER = 64;
/** How far, in 1/256 units, the Editor's sync height rounds or truncates from the render height; a larger gap is a walking height. */
const ROUNDING = 2;

export type KeptGround = {
  readonly width: number;
  readonly height: number;
  /** Vertices per row: width + 1. */
  readonly columns: number;
  readonly quantizeBias: number;
  readonly quantizeScale: number;
  /** The base layer per vertex, decoded. */
  readonly base: Float64Array;
  /** The cliff layer per vertex, decoded. */
  readonly cliff: Float64Array;
  /** The cliff level per vertex (r2's low byte: levels run 0 to 15). */
  readonly levels: Uint8Array;
  /** The total (render) height per vertex, as the readers see it. */
  readonly heights: Float32Array;
  readonly heightMap: Buffer;
  readonly syncHeightMap: Buffer;
};

/** Reads the package's ground, refusing files whose sizes don't match its t3Terrain.xml. */
export async function readKeptGround(mapPackage: string): Promise<KeptGround> {
  const terrain = readT3TerrainXml(await readFile(path.join(mapPackage, "t3Terrain.xml"), "utf8"));
  const heightMap = await readFile(path.join(mapPackage, "t3HeightMap"));
  const syncHeightMap = await readFile(path.join(mapPackage, "t3SyncHeightMap"));
  const { width, height, quantizeBias, quantizeScale } = terrain;
  const columns = width + 1;
  const count = columns * (height + 1);
  if (heightMap.toString("ascii", 0, 4) !== "HMAP" || heightMap.readUInt32LE(4) !== 101) throw new Error("t3HeightMap isn't an HMAP version 101 file, so it isn't edited");
  if (heightMap.readUInt32LE(8) !== columns || heightMap.readUInt32LE(12) !== height + 1 || heightMap.length !== HMAP_HEADER + count * 6) {
    throw new Error(`t3HeightMap isn't ${columns}×${height + 1} vertices, as t3Terrain.xml says, so it isn't edited`);
  }
  if (syncHeightMap.toString("ascii", 0, 4) !== "SMAP" || syncHeightMap.readUInt32LE(4) !== 102) throw new Error("t3SyncHeightMap isn't an SMAP version 102 file, so it isn't edited");
  if (syncHeightMap.readUInt32LE(8) !== columns || syncHeightMap.readUInt32LE(12) !== height + 1 || syncHeightMap.length !== SMAP_HEADER + count * 4) {
    throw new Error(`t3SyncHeightMap isn't ${columns}×${height + 1} vertices, as t3Terrain.xml says, so it isn't edited`);
  }
  return decodeKeptGround(heightMap, syncHeightMap, { quantizeBias, quantizeScale });
}

/** The ground in two height maps already checked against each other, decoded with `quantize`. */
export function decodeKeptGround(heightMap: Buffer, syncHeightMap: Buffer, quantize: { readonly quantizeBias: number; readonly quantizeScale: number }): KeptGround {
  const { quantizeBias, quantizeScale } = quantize;
  const columns = heightMap.readUInt32LE(8);
  const height = heightMap.readUInt32LE(12) - 1;
  const count = columns * (height + 1);
  const base = new Float64Array(count);
  const cliff = new Float64Array(count);
  const heights = new Float32Array(count);
  const levels = new Uint8Array(count);
  for (let v = 0; v < count; v++) {
    base[v] = heightMap.readUInt16LE(HMAP_HEADER + v * 6) * quantizeScale - quantizeBias;
    cliff[v] = heightMap.readUInt16LE(HMAP_HEADER + v * 6 + 2) * quantizeScale - quantizeBias;
    levels[v] = heightMap.readUInt16LE(HMAP_HEADER + v * 6 + 4);
    heights[v] = base[v]! + cliff[v]!;
  }
  return { width: columns - 1, height, columns, quantizeBias, quantizeScale, base, cliff, levels, heights, heightMap, syncHeightMap };
}

export type WrittenGround = {
  readonly heightMap: Buffer;
  readonly syncHeightMap: Buffer;
  /** The total height per vertex after the change. */
  readonly heights: Float32Array;
  /** 1 for each vertex whose height or cliff level the edit changed. */
  readonly changed: Uint8Array;
  /**
   * When the new heights didn't fit the map's quantization: the wider one every vertex was
   * rewritten with, as the Editor does. t3Terrain.xml's `<vertData>` must say so too ({@link setQuantization}).
   */
  readonly requantized?: { readonly quantizeBias: number; readonly quantizeScale: number };
};

/** What an edit sets: the base layer, the cliff layer and the vertex cliff levels; each left out stays as it is. */
export type GroundChange = { readonly base?: Float64Array; readonly cliff?: Float64Array; readonly levels?: Uint8Array };

/** The two height maps with the layers set as `change` gives them (a bare array: the base layer), as above. The ground's own buffers are left. */
export function writeKeptGround(ground: KeptGround, change: Float64Array | GroundChange): WrittenGround {
  const { base = ground.base, cliff = ground.cliff, levels = ground.levels } = change instanceof Float64Array ? { base: change } : change;
  const heightMap = Buffer.from(ground.heightMap);
  const syncHeightMap = Buffer.from(ground.syncHeightMap);
  const heights = Float32Array.from(ground.heights);
  const changed = new Uint8Array(base.length);
  const quantize = widened(ground, base, cliff);
  const { quantizeBias: bias, quantizeScale: scale } = quantize ?? ground;
  for (let v = 0; v < base.length; v++) {
    const at = HMAP_HEADER + v * 6;
    const syncAt = SMAP_HEADER + v * 4;
    if (levels[v] !== ground.levels[v]) {
      // The level is the low byte; any bits above it are kept as they were.
      heightMap.writeUInt16LE((heightMap.readUInt16LE(at + 4) & 0xff00) | levels[v]!, at + 4);
      syncHeightMap.writeUInt16LE((syncHeightMap.readUInt16LE(syncAt + 2) & 0xff00) | levels[v]!, syncAt + 2);
      changed[v] = 1;
    }
    const cliffMoved = cliff[v] !== ground.cliff[v];
    if (quantize) {
      // Every vertex in the new quantization; only the edited ones move by more than a step of it.
      const r0 = Math.round((base[v]! + bias) / scale);
      const r1 = Math.round((cliff[v]! + bias) / scale);
      heightMap.writeUInt16LE(r0, at);
      heightMap.writeUInt16LE(r1, at + 2);
      heights[v] = r0 * scale - bias + (r1 * scale - bias);
      if (base[v] === ground.base[v] && !cliffMoved) continue;
    } else {
      if (base[v] === ground.base[v] && !cliffMoved) continue;
      const r0 = base[v] === ground.base[v] ? heightMap.readUInt16LE(at) : Math.round((base[v]! + bias) / scale);
      const r1 = cliffMoved ? Math.round((cliff[v]! + bias) / scale) : heightMap.readUInt16LE(at + 2);
      if (r0 === heightMap.readUInt16LE(at) && r1 === heightMap.readUInt16LE(at + 2)) continue;
      heightMap.writeUInt16LE(r0, at);
      heightMap.writeUInt16LE(r1, at + 2);
      heights[v] = r0 * scale - bias + (cliffMoved ? r1 * scale - bias : ground.cliff[v]!);
    }
    if (heights[v] === ground.heights[v]) continue;
    const sync = syncHeightMap.readInt16LE(syncAt);
    const before = Math.round(ground.heights[v]! * 256);
    const after = Math.round(heights[v]! * 256);
    // Where the cliff moved, a walking height's gap goes with it; the Editor's rounding (within 2/256) stays.
    const next = sync === before || (cliffMoved && Math.abs(sync - before) > ROUNDING) ? after : sync + after - before;
    syncHeightMap.writeInt16LE(Math.min(0x7fff, Math.max(-0x8000, next)), syncAt);
    changed[v] = 1;
  }
  return { heightMap, syncHeightMap, heights, changed, ...(quantize ? { requantized: quantize } : {}) };
}

/** A quantization wide enough for the base and cliff layers, when the map's own isn't: the same bias or more, a larger scale. */
function widened(ground: KeptGround, base: Float64Array, cliff: Float64Array): { quantizeBias: number; quantizeScale: number } | undefined {
  let low = Infinity;
  let high = -Infinity;
  for (let v = 0; v < base.length; v++) {
    low = Math.min(low, base[v]!, cliff[v]!);
    high = Math.max(high, base[v]!, cliff[v]!);
  }
  const top = 0xffff * ground.quantizeScale - ground.quantizeBias;
  if (low >= -ground.quantizeBias && Math.round((high + ground.quantizeBias) / ground.quantizeScale) <= 0xffff) return undefined;
  // Rounded as t3Terrain.xml writes them (7 significant digits), with room to spare.
  const quantizeBias = Number(Math.max(ground.quantizeBias, -low + 0.01).toExponential(6));
  const quantizeScale = Number(Math.max(ground.quantizeScale, ((Math.max(high, top) + quantizeBias) / 0xffff) * 1.001).toExponential(6));
  return { quantizeBias, quantizeScale };
}

/** t3Terrain.xml with `<vertData>`'s quantization set, every other byte as it was. */
export function setQuantization(xml: string, quantize: { readonly quantizeBias: number; readonly quantizeScale: number }): string {
  const element = /<vertData\s[^>]*>/.exec(xml);
  if (!element) throw new Error("t3Terrain.xml has no <vertData>, so its quantization can't be widened");
  const text = element[0]
    .replace(/quantizeBias="[^"]*"/, `quantizeBias="${formatExponent(quantize.quantizeBias)}"`)
    .replace(/quantizeScale="[^"]*"/, `quantizeScale="${formatExponent(quantize.quantizeScale)}"`);
  return xml.slice(0, element.index) + text + xml.slice(element.index + element[0].length);
}
