import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { type Catalog, resolveLayered } from "./catalog-layer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, "../../data/tileset-sky.json");

/** A tileset's sky as its CTerrain resolves it (data/tileset-sky.json, values as the XML writes them). */
export type TilesetSky = {
  readonly skybox?: string;
  /** NonFixedSkyboxModel: the layer that pans with the camera. */
  readonly parallax?: string;
  readonly hideLowestLevel?: string;
  readonly fogEnabled?: string;
  /** "a,r,g,b", 0-255. */
  readonly fogColor?: string;
  readonly fogDensity?: string;
  readonly fogFalloff?: string;
  readonly fogStartingHeight?: string;
};

let catalog: Record<string, TilesetSky> | null = null;
const loadCatalog = () => (catalog ??= JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as Record<string, TilesetSky>);

/** Each CTerrain sky tag and the TilesetSky field it gives, as scripts/build-tileset-lights.mjs and the Campaign Mod's reader read them. */
export const SKY_TAGS = [
  ["FixedSkyboxModel", "skybox"],
  ["NonFixedSkyboxModel", "parallax"],
  ["HideLowestLevel", "hideLowestLevel"],
  ["FogEnabled", "fogEnabled"],
  ["FogColor", "fogColor"],
  ["FogDensity", "fogDensity"],
  ["FogFalloff", "fogFalloff"],
  ["FogStartingHeight", "fogStartingHeight"],
] as const satisfies readonly (readonly [string, keyof TilesetSky])[];

/**
 * A tileset's skybox, hidden lowest level and fog, the game's or the Campaign Mod's (each field
 * through its parents on its own), or undefined for an unknown tileset.
 */
export function getTilesetSky(catalog: Catalog, tilesetId: string): TilesetSky | undefined {
  const tilesets = catalog.tilesets;
  if (!tilesets.has(tilesetId)) return loadCatalog()[tilesetId];
  const sky: Record<string, string> = {};
  for (const [, field] of SKY_TAGS) {
    const value = resolveLayered(tilesets, tilesetId, (tileset) => tileset.sky[field], (id) => loadCatalog()[id]?.[field]);
    if (value !== undefined) sky[field] = value;
  }
  return sky;
}

/** Whether the map hides its lowest level: the blueprint's choice, else the stock tileset's. */
export function hidesLowestLevel(catalog: Catalog, blueprint: Pick<MissionBlueprint, "sky" | "tilesetId">): boolean {
  return blueprint.sky?.hideLowestLevel ?? getTilesetSky(catalog, blueprint.tilesetId ?? "KorhalCityEx2")?.hideLowestLevel === "1";
}

/** Sky models the game's tilesets and the Campaign Mod's use, either layer, and the Campaign Mod's models. */
export function knownSkyModels(catalog: Catalog): ReadonlySet<string> {
  const mod = [...catalog.tilesets.values()].map((tileset) => tileset.sky);
  return new Set([...[...Object.values(loadCatalog()), ...mod].flatMap((sky) => [sky.skybox, sky.parallax].filter((model) => model !== undefined)), ...catalog.models]);
}

/** A Blueprint's fog colour (0-1 per channel) as the Editor writes it: "a,r,g,b", 0-255. */
export const fogColor = (rgb: readonly number[]): string => `255,${rgb.map((channel) => Math.round(channel * 255)).join(",")}`;

/** The fog a Mission plays in, knob by knob, as the Editor writes it ("a,r,g,b" 0-255 for the colour); a knob neither its Blueprint nor its tileset sets is left out. */
export type MissionFog = { readonly enabled?: boolean; readonly color?: string; readonly density?: number; readonly falloff?: number; readonly startingHeight?: number };

/**
 * The Mission's fog as its map-local tileset override leaves it (map/write-sky.ts): each of the
 * Blueprint's `sky.fog` knobs, else its `sky.fog.from` tileset's, else its own tileset's.
 */
export function missionFog(catalog: Catalog, blueprint: Pick<MissionBlueprint, "sky" | "tilesetId">): MissionFog {
  const fog = blueprint.sky?.fog;
  const from = fog?.from !== undefined ? getTilesetSky(catalog, fog.from) : undefined;
  const own = getTilesetSky(catalog, blueprint.tilesetId ?? "KorhalCityEx2");
  const stock = (field: "fogEnabled" | "fogColor" | "fogDensity" | "fogFalloff" | "fogStartingHeight"): string | undefined => from?.[field] ?? own?.[field];
  const number = (value: number | undefined, field: "fogDensity" | "fogFalloff" | "fogStartingHeight"): number | undefined => {
    const text = stock(field);
    return value ?? (text !== undefined ? Number(text) : undefined);
  };
  const stockEnabled = stock("fogEnabled");
  const enabled = fog?.enabled ?? (stockEnabled !== undefined ? stockEnabled === "1" : undefined);
  const color = fog?.color ? fogColor(fog.color) : stock("fogColor");
  const resolved = { enabled, color, density: number(fog?.density, "fogDensity"), falloff: number(fog?.falloff, "fogFalloff"), startingHeight: number(fog?.startingHeight, "fogStartingHeight") };
  return Object.fromEntries(Object.entries(resolved).filter(([, value]) => value !== undefined));
}
