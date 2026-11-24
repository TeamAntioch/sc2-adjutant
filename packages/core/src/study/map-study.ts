import type { RgbImage } from "../map/read-tga.js";
import type { ExemplarMap } from "../plugins/plugin-api.js";
import type { LoadedMapPackage } from "./load-map-package.js";
import { measureCliffs } from "./measure-cliffs.js";
import { measureComposition } from "./measure-composition.js";
import { measureDoodads, studyDoodads } from "./measure-doodads.js";
import { measureLighting } from "./measure-lighting.js";
import { measureTexturing } from "./measure-texturing.js";
import { measureMap } from "./measures.js";
import { PX, renderDoodads, renderElevation, renderHeight, CONTOUR, renderPathing, renderTextures, renderVertexShading } from "./render-layers.js";
import { buildTerrainGrid } from "./terrain-grid.js";

/** What a Map Study records of its Exemplar Map. */
export type ExemplarEntry = Pick<ExemplarMap, "id" | "provenance" | "note">;

export const MAP_STUDY_VERSION = 1;

/** One Exemplar Map's Map Study: measurements plus the layer images they were taken from. */
export function buildMapStudy(exemplar: ExemplarEntry, map: LoadedMapPackage) {
  const grid = buildTerrainGrid(map);
  const doodads = studyDoodads(map);
  const textures = renderTextures(grid);
  const doodadLayer = renderDoodads(grid, doodads);
  const elevation = renderElevation(grid);
  const images: Record<string, RgbImage> = {
    "textures.png": textures.image,
    "elevation.png": elevation,
    "height.png": renderHeight(grid, map.heightMap.heights),
    "doodads.png": doodadLayer.image,
    ...(map.minimap ? { "minimap.png": map.minimap } : {}),
    ...(map.vertexValues ? { "vertex-shading.png": renderVertexShading(grid, map.vertexValues) } : {}),
    ...(map.noPathing ? { "pathing.png": renderPathing(grid, map.noPathing, elevation) } : {}),
  };
  const study = {
    mapStudyVersion: MAP_STUDY_VERSION,
    exemplar: { id: exemplar.id, provenance: exemplar.provenance, ...(exemplar.note ? { note: exemplar.note } : {}) },
    layers: {
      note: `Renders are ${PX} px per cell, north up. textures.png: dominant texture per cell; elevation.png: cliff levels (darker = cliff edge, blue = ramp); height.png: shaded relief of the height map (lit from the north-west, low dark blue-grey to high sand, a contour every ${CONTOUR} units), showing sculpted height within a level; doodads.png: doodads by kind, manipulated ones ringed red; vertex-shading.png: t3VertCol kind-1 values (white untouched), cliff edges blue; pathing.png: painted pathing (CellAttribute_Pnp, the Editor's pathing brush) in red over the elevation, sub-cell by sub-cell, when the map has any. Outside the playable bounds is dimmed.`,
      texturesLegend: textures.legend,
      doodadsLegend: doodadLayer.legend,
    },
    texturing: measureTexturing(map, grid),
    cliffs: measureCliffs(map, grid),
    doodads: measureDoodads(map, grid, doodads),
    lighting: measureLighting(map),
    composition: measureComposition(map, grid),
    // The lesson-neutral measures (measures.ts), which a consistency report reads from the study, so it needs no source map.
    measures: measureMap(map),
  };
  return { study, images };
}
