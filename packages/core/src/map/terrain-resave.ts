// What the Editor changes in a generated map's terrain files when it saves them, without the author
// having changed what they hold. Any terrain edit makes the Editor rewrite the whole terrain: it
// picks its own height quantization (t3Terrain.xml <vertData>), so every raw value of t3HeightMap
// moves, and it may restamp <terrain version>; a water area it saves names the stock type
// (Agria) where the compile wrote the pool's own copy of it (Agria_Pool), and WaterData.xml keeps a
// deleted area's CWater. Once sync has brought the
// author's edits back, a compile writes the same terrain in its own encoding, and that isn't an
// Editor change to keep or discard (map/editor-changes.ts).

import { cliffHeight, MAX_CLIFF_LEVEL } from "../terrain/cliffs.js";
import { readT3HeightMap } from "../terrain/read-t3-height-map.js";
import { HEIGHT_QUANTIZE_BIAS, HEIGHT_QUANTIZE_SCALE, type HeightQuantization } from "../terrain/write-t3-height-map.js";
import { sameWaterAreas, sameWaterData, WATER_DATA } from "./write-water.js";

/**
 * Whether a vertex is on one of the compile's ramps: its cliff layer at a slope between levels, not
 * at its level's height. The Editor works its ramps out again on any terrain save (01-02's test
 * save, 2026-11-10: on each of its 14 ramps, one row of vertices took the lower level and both
 * corners dropped 1.0), so a ramp's vertices are the Editor's to differ on, not the author's.
 */
export function onRamp(cliffHeights: Float32Array, cliffLevels: Uint8Array, index: number): boolean {
  const level = cliffLevels[index]!;
  return level <= MAX_CLIFF_LEVEL && Math.abs(cliffHeights[index]! - cliffHeight(level)) > HEIGHT_EDIT_TOLERANCE;
}

/** Heights closer than this are the same: the Editor's requantization moves a height by under a thousandth. */
export const HEIGHT_EDIT_TOLERANCE = 0.01;
/** A water area's corners closer than this, in cells, are the same. */
const WATER_TOLERANCE = 0.01;

/** The files whose Editor re-encoding sameTerrainFile reads through. */
export const RESAVED_TERRAIN_FILES: ReadonlySet<string> = new Set(["t3HeightMap", "t3Terrain.xml", "t3Water", WATER_DATA]);

/** t3Terrain.xml's height quantization (<vertData>), or the compile's default when it doesn't say. */
export function terrainQuantization(terrainXml: string | undefined): HeightQuantization {
  const vertData = terrainXml && /<vertData\b[^>]*>/.exec(terrainXml)?.[0];
  const attribute = (name: string): number | undefined => {
    const value = vertData ? new RegExp(`\\b${name}="([^"]+)"`).exec(vertData)?.[1] : undefined;
    return value !== undefined && Number.isFinite(Number(value)) ? Number(value) : undefined;
  };
  return { quantizeBias: attribute("quantizeBias") ?? HEIGHT_QUANTIZE_BIAS, quantizeScale: attribute("quantizeScale") ?? HEIGHT_QUANTIZE_SCALE };
}

/** t3Terrain.xml without what the Editor restamps on any terrain save: the version, and the quantization. */
const normalTerrainXml = (xml: string): string =>
  xml
    .replace(/\r\n/g, "\n")
    .replace(/<terrain version="\d+">/, "<terrain>")
    .replace(/(<vertData\b[^>]*?)\s+quantizeBias="[^"]*"/, "$1")
    .replace(/(<vertData\b[^>]*?)\s+quantizeScale="[^"]*"/, "$1")
    .trimEnd();

/**
 * Whether `now`, a generated terrain file as the package has it, holds what the compile's `next`
 * does, read through the Editor's re-encoding: a t3HeightMap's heights within a hundredth, each read
 * with its own t3Terrain.xml's quantization, and its cliff levels the same, off the compile's ramps; a t3Terrain.xml the same
 * but for its version and quantization; a t3Water's areas the same (sameWaterAreas), and its
 * WaterData.xml's CWaters (sameWaterData). Any other file: false, its bytes decide.
 */
export function sameTerrainFile(file: string, now: Uint8Array, next: Uint8Array, terrainXml: { readonly now: string | undefined; readonly next: string | undefined }): boolean {
  try {
    switch (file) {
      case "t3HeightMap":
        return sameHeights(now, next, terrainQuantization(terrainXml.now), terrainQuantization(terrainXml.next));
      case "t3Terrain.xml":
        return normalTerrainXml(Buffer.from(now).toString("utf8")) === normalTerrainXml(Buffer.from(next).toString("utf8"));
      case "t3Water":
        return sameWaterAreas(now, next, WATER_TOLERANCE);
      case WATER_DATA:
        return sameWaterData(Buffer.from(now).toString("utf8"), Buffer.from(next).toString("utf8"));
      default:
        return false;
    }
  } catch {
    // A file that can't be read as its format is a change of the author's, for them to decide.
    return false;
  }
}

function sameHeights(now: Uint8Array, next: Uint8Array, nowQuantization: HeightQuantization, nextQuantization: HeightQuantization): boolean {
  const a = readT3HeightMap(Buffer.from(now), nowQuantization);
  const b = readT3HeightMap(Buffer.from(next), nextQuantization);
  if (a.vertexWidth !== b.vertexWidth || a.vertexHeight !== b.vertexHeight) return false;
  for (let i = 0; i < a.heights.length; i++) {
    if (onRamp(b.cliffHeights, b.cliffLevels, i)) continue;
    if (a.cliffLevels[i] !== b.cliffLevels[i] || Math.abs(a.heights[i]! - b.heights[i]!) > HEIGHT_EDIT_TOLERANCE) return false;
  }
  return true;
}
