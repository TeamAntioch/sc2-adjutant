import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { readMapInfo, type MapInfoSummary } from "../map/read-map-info.js";
import { readObjectsXml, type ObjectsFile } from "../map/read-objects-xml.js";
import { readTga, type RgbImage } from "../map/read-tga.js";
import { readT3FluffDoodad } from "../terrain/read-t3-fluff-doodad.js";
import { readT3HeightMap, type T3HeightMap } from "../terrain/read-t3-height-map.js";
import { readT3SyncCliffLevel, type T3SyncCliffLevel } from "../terrain/read-t3-sync-cliff-level.js";
import { readT3TerrainXml, type T3Terrain } from "../terrain/read-t3-terrain-xml.js";
import { cellTextureWeights, readT3TextureMasks } from "../terrain/read-t3-texture-masks.js";
import { cellAttributeFits, PATHING_FILE, readCellAttribute } from "../terrain/write-cell-attribute.js";
import { readT3VertCol, readT3VertColHeader, vertexValueGrid } from "../terrain/read-t3-vert-col.js";

/** Everything a Map Study reads from one unpacked map package. */
export type LoadedMapPackage = {
  readonly dir: string;
  readonly terrain: T3Terrain;
  readonly heightMap: T3HeightMap;
  readonly syncCliff: T3SyncCliffLevel;
  /** Mean mask weight (0..15) per cell and layer: [cellIndex * 8 + layer]. */
  readonly cellWeights: Float32Array;
  readonly objects: ObjectsFile;
  readonly mapInfo: MapInfoSummary;
  readonly minimap?: RgbImage;
  readonly vertCol?: { readonly version: number; readonly entryCount: number; readonly bytes: number };
  /** t3VertCol kind-1 value per vertex ((width+1) x (height+1)); 255 = untouched. */
  readonly vertexValues?: Uint8Array;
  readonly fluffCount: number;
  /** The Editor's painted pathing (CellAttribute_Pnp), a byte per cell, when the map has any. */
  readonly noPathing?: Uint8Array;
  /** Body count from the t3Water header. */
  readonly waterBodies: number;
  readonly mapScript: string;
  readonly terrainData: string;
  readonly lightData: string;
};

function readOptional(file: string): Buffer | undefined {
  return existsSync(file) ? readFileSync(file) : undefined;
}

export function loadMapPackage(dir: string): LoadedMapPackage {
  const at = (name: string) => path.join(dir, name);
  const terrain = readT3TerrainXml(readFileSync(at("t3Terrain.xml"), "utf8"));
  const masks = readT3TextureMasks(readFileSync(at("t3TextureMasks")));
  const minimap = readOptional(at("Minimap.tga"));
  const vertCol = readOptional(at("t3VertCol"));
  const fluff = readOptional(at("t3FluffDoodad"));
  const water = readOptional(at("t3Water"));
  const pathing = readOptional(at(PATHING_FILE));
  const gameData = (name: string) => readOptional(at(`Base.SC2Data/GameData/${name}`))?.toString("utf8") ?? "";
  return {
    dir,
    terrain,
    heightMap: readT3HeightMap(readFileSync(at("t3HeightMap")), terrain),
    syncCliff: readT3SyncCliffLevel(readFileSync(at("t3SyncCliffLevel"))),
    cellWeights: cellTextureWeights(masks, terrain.width, terrain.height),
    objects: readObjectsXml(readFileSync(at("Objects"), "utf8")),
    mapInfo: readMapInfo(readFileSync(at("MapInfo"))),
    ...(minimap ? { minimap: readTga(minimap) } : {}),
    ...(vertCol
      ? { vertCol: readT3VertColHeader(vertCol), vertexValues: vertexValueGrid(readT3VertCol(vertCol), terrain.width, terrain.height) }
      : {}),
    // A study leaves out a painted layer that doesn't fit the map, rather than fail.
    ...(pathing && cellAttributeFits(pathing, terrain.width, terrain.height) ? { noPathing: readCellAttribute(pathing, terrain.width, terrain.height) } : {}),
    fluffCount: fluff ? readT3FluffDoodad(fluff).entries.length : 0,
    waterBodies: water && water.length >= 16 ? water.readUInt32LE(12) : 0,
    mapScript: readOptional(at("MapScript.galaxy"))?.toString("utf8") ?? "",
    terrainData: gameData("TerrainData.xml"),
    lightData: gameData("LightData.xml"),
  };
}
