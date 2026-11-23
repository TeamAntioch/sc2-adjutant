import type { Catalog } from "../catalog/catalog-layer.js";
import { getTilesetCliffSets } from "../catalog/tileset-cliff-sets.js";
import { getTilesetTextures } from "../catalog/tileset-textures.js";
import type { CliffCell } from "./cliffs.js";
import { type Ramp, rampXml } from "./ramps.js";
import { cliffDoodadXml, type PlacedTerrainObject } from "./terrain-objects.js";
import { HEIGHT_QUANTIZE_BIAS, HEIGHT_QUANTIZE_SCALE, type HeightQuantization } from "./write-t3-height-map.js";

// Editor-style float formatting, e.g. 9.000000e+00.
export function formatExponent(value: number): string {
  return value.toExponential(6).replace(/e([+-])(\d)$/, "e$10$2");
}

export type T3TerrainXmlOptions = {
  readonly tilesetId: string;
  readonly width: number;
  readonly height: number;
  readonly textureSetIndex: number;
  /** Cliff cells with a mesh; their `cliffSet` indexes `cliffSets`. */
  readonly cliffCells?: readonly CliffCell[];
  /** Cliff set names in index order; defaults to the tileset's natural set alone. */
  readonly cliffSets?: readonly string[];
  readonly ramps?: readonly Ramp[];
  readonly terrainObjects?: readonly PlacedTerrainObject[];
  /** Blend texture names (defaults to the tileset's). */
  readonly textures?: readonly string[];
  /** Where the tileset's default textures and cliff set come from: the Mission's. */
  readonly catalog: Catalog;
  /** t3HeightMap's quantization (heightQuantization); defaults to ours, ±9 a channel. */
  readonly quantization?: HeightQuantization;
};

export function writeT3TerrainXml(options: T3TerrainXmlOptions): string {
  const { tilesetId, width, height } = options;
  const vertexWidth = width + 1;
  const vertexHeight = height + 1;
  const blockCount = Math.floor(width / 8) * Math.floor(height / 8);
  // Cliff cells cover 2x2 terrain cells, matching Editor-saved maps.
  const cliffCellCount = Math.floor(width / 2) * Math.floor(height / 2);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push(`<terrain version="115">`);
  lines.push(`    <heightMap tileSet="${tilesetId}" uvtiling="12.000000 12.000000 0.000000 0.000000 " dim="${vertexWidth} ${vertexHeight} " offset="0.000000 0.000000 0.000000 " scale="1.000000e+00 1.000000e+00 1.000000e+00 ">`);
  const cliffCells = options.cliffCells ?? [];
  if (cliffCells.length > 0) {
    // Only the cliff sets actually used are listed; <cc cid> indexes this list.
    const fallback = getTilesetCliffSets(options.catalog, tilesetId)[0];
    const cliffSets = options.cliffSets ?? (fallback ? [fallback] : []);
    if (cliffSets.length === 0) throw new Error(`No cliff set known for tileset ${tilesetId}`);
    lines.push(`        <cliffSetList num="${cliffSets.length}">`);
    cliffSets.forEach((name, index) => lines.push(`            <cliffSet i="${index}" name="${name}"/>`));
    lines.push(`        </cliffSetList>`);
  }
  const ramps = options.ramps ?? [];
  if (ramps.length > 0) {
    lines.push(`        <rampList num="${ramps.length}">`);
    for (const ramp of ramps) lines.push(`            ${rampXml(ramp)}`);
    lines.push(`        </rampList>`);
  }
  const terrainObjects = options.terrainObjects ?? [];
  if (terrainObjects.length > 0) {
    lines.push(`        <cliffDoodadList num="${terrainObjects.length}">`);
    for (const object of terrainObjects) lines.push(`            ${cliffDoodadXml(object)}`);
    lines.push(`        </cliffDoodadList>`);
  }
  lines.push(`        <vertData quantizeBias="${formatExponent(options.quantization?.quantizeBias ?? HEIGHT_QUANTIZE_BIAS)}" quantizeScale="${formatExponent(options.quantization?.quantizeScale ?? HEIGHT_QUANTIZE_SCALE)}" standardHeight="8.000000e+00" name="t3HeightMap"/>`);
  lines.push(`        <masks name="t3TextureMasks"/>`);
  lines.push(`        <textureSetList num="8">`);
  lines.push(`            <textureSet i="0" name="${tilesetId}"/>`);
  for (let i = 1; i < 8; i++) {
    lines.push(`            <textureSet i="${i}" name=""/>`);
  }
  lines.push(`        </textureSetList>`);
  lines.push(`        <textureList num="64">`);
  const textures = options.textures ?? getTilesetTextures(options.catalog, tilesetId);
  for (let i = 0; i < 64; i++) {
    const name = textures[i] ?? "";
    lines.push(`            <texture i="${i}" name="${name}"/>`);
  }
  lines.push(`        </textureList>`);
  lines.push(`        <blockTextureSetList num="${blockCount}">`);
  for (let i = 0; i < blockCount; i++) {
    lines.push(`            <blockTextureSet i="${i}" tileSet="0"/>`);
  }
  lines.push(`        </blockTextureSetList>`);
  if (cliffCells.length === 0) {
    lines.push(`        <cliffCellList num="${cliffCellCount}" numOccupied="0"/>`);
  } else {
    lines.push(`        <cliffCellList num="${cliffCellCount}" numOccupied="${cliffCells.length}">`);
    for (const cell of cliffCells) {
      lines.push(`            <cc i="${cell.index}" f="${cell.flags}" cid="${cell.cliffSet ?? 0}" cvar="${cell.variation}"/>`);
    }
    lines.push(`        </cliffCellList>`);
  }
  lines.push(`    </heightMap>`);
  lines.push(`</terrain>`);

  return lines.join("\n");
}
