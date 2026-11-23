// The mission's sky (DL-14): skybox, fog and a hidden lowest level, as fields of the map-local
// tileset override. Only what the blueprint sets is written; the rest stays the tileset's.

import { blueprintCatalog, layerSource } from "../catalog/catalog-layer.js";
import { fogColor, getTilesetSky, hidesLowestLevel, knownSkyModels } from "../catalog/tileset-sky.js";
import { isPlaced, type MissionBlueprint } from "../domain/mission-blueprint.js";

/** CTerrain child elements for the blueprint's sky, in the order the Editor writes them. */
export function skyTerrainFields(blueprint: MissionBlueprint): string[] {
  const sky = blueprint.sky;
  if (!sky) return [];
  const catalog = blueprintCatalog(blueprint);
  const stock = (id: string | undefined, what: string) => {
    if (id === undefined) return undefined;
    const found = getTilesetSky(catalog, id);
    if (!found) throw new Error(`${what}: no tileset ${id} (see data/tileset-sky.json${layerSource(catalog)})`);
    return found;
  };
  const layers = stock(sky.from, "Sky");
  const fog = sky.fog;
  const from = stock(fog?.from, "Fog");
  const fields: [string, string | undefined][] = [
    ["FixedSkyboxModel", sky.skybox ?? layers?.skybox],
    ["NonFixedSkyboxModel", sky.parallax ?? layers?.parallax],
    ["HideLowestLevel", sky.hideLowestLevel === undefined ? undefined : sky.hideLowestLevel ? "1" : "0"],
    ["FogEnabled", fog?.enabled !== undefined ? (fog.enabled ? "1" : "0") : from?.fogEnabled],
    ["FogColor", fog?.color ? fogColor(fog.color) : from?.fogColor],
    ["FogDensity", fog?.density !== undefined ? fog.density.toFixed(6) : from?.fogDensity],
    ["FogFalloff", fog?.falloff !== undefined ? fog.falloff.toFixed(6) : from?.fogFalloff],
    ["FogStartingHeight", fog?.startingHeight !== undefined ? fog.startingHeight.toFixed(6) : from?.fogStartingHeight],
  ];
  return fields.flatMap(([tag, value]) => (value === undefined ? [] : [`        <${tag} value="${value}"/>`]));
}

/**
 * Notes on the sky: a sky model no tileset uses (a dependency may still have it), a hidden
 * level with no pits to show it through, and anchors left standing over the void.
 */
export function skyWarnings(blueprint: MissionBlueprint, syncCliff: Uint16Array): string[] {
  const warnings: string[] = [];
  const catalog = blueprintCatalog(blueprint);
  for (const model of [blueprint.sky?.skybox, blueprint.sky?.parallax]) {
    if (model && !knownSkyModels(catalog).has(model)) {
      warnings.push(`Sky model ${model} isn't one a tileset uses (data/tileset-sky.json${layerSource(catalog)}); check a dependency has it.`);
    }
  }
  if (!hidesLowestLevel(catalog, blueprint)) return warnings;
  const width = blueprint.mapSize.width;
  const levelAt = (x: number, y: number): number | undefined => syncCliff[Math.floor(y) * width + Math.floor(x)];
  if (blueprint.sky?.hideLowestLevel && !blueprint.zones.some((zone) => zone.elevation === 0)) {
    warnings.push("hideLowestLevel is on but no zone is a level-0 pit, so no sky shows through.");
  }
  for (const anchor of blueprint.anchors.filter(isPlaced)) {
    if (levelAt(anchor.position.x, anchor.position.y) === 0) {
      warnings.push(`Anchor ${anchor.id} stands on the hidden lowest level, over open sky.`);
    }
  }
  return warnings;
}
