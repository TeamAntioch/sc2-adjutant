import { Buffer } from "node:buffer";

import { HEIGHT_QUANTIZE_BIAS, HEIGHT_QUANTIZE_SCALE } from "./write-t3-height-map.js";

export type T3HeightMap = {
  /** Vertex counts: one more than the map's cell width and height. */
  readonly vertexWidth: number;
  readonly vertexHeight: number;
  /** Visible height per vertex, row-major from y = 0. */
  readonly heights: Float32Array;
  /** Portion of each height contributed by the vertex's cliff level. */
  readonly cliffHeights: Float32Array;
  /** Cliff level per vertex: 0 pit, 1 ground, up to 15. */
  readonly cliffLevels: Uint8Array;
};

export type ReadT3HeightMapOptions = {
  /** Per-map quantization from t3Terrain.xml `<vertData>`; defaults to ours. */
  readonly quantizeBias?: number;
  readonly quantizeScale?: number;
};

/** Reads t3HeightMap: the inverse of writeT3HeightMap, honouring Editor-chosen quantization. */
export function readT3HeightMap(buffer: Buffer, options: ReadT3HeightMapOptions = {}): T3HeightMap {
  const { quantizeBias = HEIGHT_QUANTIZE_BIAS, quantizeScale = HEIGHT_QUANTIZE_SCALE } = options;
  if (buffer.toString("ascii", 0, 4) !== "HMAP") throw new Error("t3HeightMap: missing HMAP magic");
  const vertexWidth = buffer.readUInt32LE(8);
  const vertexHeight = buffer.readUInt32LE(12);
  const count = vertexWidth * vertexHeight;
  if (buffer.length < 32 + count * 6) throw new Error(`t3HeightMap: truncated (${buffer.length} B for ${count} vertices)`);

  const heights = new Float32Array(count);
  const cliffHeights = new Float32Array(count);
  const cliffLevels = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const offset = 32 + i * 6;
    const base = buffer.readUInt16LE(offset) * quantizeScale - quantizeBias;
    const cliff = buffer.readUInt16LE(offset + 2) * quantizeScale - quantizeBias;
    heights[i] = base + cliff;
    cliffHeights[i] = cliff;
    cliffLevels[i] = buffer.readUInt16LE(offset + 4) & 0xff;
  }
  return { vertexWidth, vertexHeight, heights, cliffHeights, cliffLevels };
}
