// A small in-memory map package for the study's measures, built from rows of characters so a
// test can work out each measure's answer by hand. Rows run from y = 0 (the south edge) upwards.

import type { PlacedDoodad } from "../../src/map/read-objects-xml.js";
import type { WaterArea } from "../../src/map/write-water.js";
import type { LoadedMapPackage } from "../../src/study/load-map-package.js";

export type FixtureDoodad = { readonly type: string; readonly x: number; readonly y: number; readonly yaw?: number };

export type FixtureMapSpec = {
  /** One string per row: a cliff level per cell, 0-9. */
  readonly levels: readonly string[];
  /** One string per row: a texture letter per cell, at full weight. Texture `X` is named `TexX`. */
  readonly textures: readonly string[];
  /** Cells blended from several textures, by "x,y": letter to weight (0-15). */
  readonly blends?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly doodads?: readonly FixtureDoodad[];
  readonly tilesetId?: string;
  readonly water?: readonly WaterArea[];
  readonly terrainData?: string;
  readonly mapScript?: string;
};

export function fixtureMap(spec: FixtureMapSpec): LoadedMapPackage {
  const height = spec.levels.length;
  const width = spec.levels[0]!.length;
  const letters = [...new Set([...spec.textures.join(""), ...Object.values(spec.blends ?? {}).flatMap((blend) => Object.keys(blend))])].sort();
  if (letters.length > 8) throw new Error("A fixture map holds at most 8 textures");
  const textures = Array.from({ length: 8 }, (_, layer) => (letters[layer] ? `Tex${letters[layer]}` : ""));
  const syncCliff = new Uint16Array(width * height);
  const cellWeights = new Float32Array(width * height * 8);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      syncCliff[i] = Number(spec.levels[y]![x]) * 64;
      const blend = spec.blends?.[`${x},${y}`] ?? { [spec.textures[y]![x]!]: 15 };
      for (const [letter, weight] of Object.entries(blend)) cellWeights[i * 8 + letters.indexOf(letter)] = weight;
    }
  }
  const doodads: PlacedDoodad[] = (spec.doodads ?? []).map((d, id) => ({
    id,
    type: d.type,
    position: { x: d.x, y: d.y, z: 0 },
    yaw: d.yaw ?? 0,
    pitch: 0,
    roll: 0,
    scale: { x: 1, y: 1, z: 1 },
    flags: [],
  }));
  return {
    dir: "fixture",
    terrain: { tilesetId: spec.tilesetId ?? "Agria", width, height, textures, blockTextureSets: [], cliffCells: [], cliffSets: [], ramps: [], cliffDoodads: [], textureSets: [] },
    heightMap: { vertexWidth: width + 1, vertexHeight: height + 1, heights: new Float32Array((width + 1) * (height + 1)) },
    syncCliff: { width, height, syncCliff },
    cellWeights,
    objects: { doodads, units: [], points: [], cameras: [] },
    mapInfo: { playableBounds: [0, 0, width, height], fogType: "Black" },
    fluffCount: 0,
    waterBodies: spec.water?.length ?? 0,
    waterAreas: spec.water ?? [],
    mapScript: spec.mapScript ?? "",
    terrainData: spec.terrainData ?? "",
    lightData: "",
  } as unknown as LoadedMapPackage;
}

/** `count` copies of `row`. */
export const rows = (row: string, count: number): string[] => Array.from({ length: count }, () => row);
