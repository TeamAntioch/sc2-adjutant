import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { paletteTextures, type TexturePalette } from "../domain/mission-blueprint.js";
import { type Catalog, resolveLayeredList } from "./catalog-layer.js";
import { getStockTexture, stockTextures } from "./stock-catalog.js";

const CONTRAST_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/texture-contrast.json");

/** A game tileset's blend textures in layer order (data/texture-extracted.json), or undefined for a tileset the game doesn't define. */
const stockTileset = (id: string): readonly string[] | undefined => (Object.hasOwn(stockTextures().tilesets, id) ? stockTextures().tilesets[id] : undefined);

/** Whether a CTerrainTex id is one the game's tilesets use (data/texture-extracted.json) or the Campaign Mod defines. */
export function isKnownTexture(catalog: Catalog, id: string): boolean {
  return getStockTexture(id) !== undefined || catalog.textures.has(id);
}

/** A texture's tone from its catalog description (light, mid or dark), if it has one. */
export function textureTone(id: string): string | undefined {
  return getStockTexture(id)?.description?.tone;
}

/** A picture's contrast at which a texture is calm (0) and at which it is fully stark (1): grass and smooth earth are about 15, pebbles and lumpy moss 21 and up. */
const CALM_CONTRAST = 16;
const STARK_CONTRAST = 21;

let contrasts: Record<string, number> | null = null;
const loadContrasts = () => (contrasts ??= (JSON.parse(readFileSync(CONTRAST_PATH, "utf8")) as { contrast: Record<string, number> }).contrast);

/**
 * How stark a texture looks beside others, 0 (calm) to 1: from its picture's contrast
 * (data/texture-contrast.json), and 1 for a texture the catalog says suits an accent (pits, roots,
 * cracks). A stark texture reads at full strength long before its weight gets there, so variety
 * painting gives it less ground and smaller spots. A texture with no picture counts as calm.
 */
export function textureStarkness(id: string): number {
  if (getStockTexture(id)?.description?.suits?.includes("accent")) return 1;
  const contrast = loadContrasts()[id];
  return contrast === undefined ? 0 : Math.min(1, Math.max(0, (contrast - CALM_CONTRAST) / (STARK_CONTRAST - CALM_CONTRAST)));
}

/** Whether a texture is man-made (its catalog kind is `built`): paving, plating, grating. */
export function isBuiltTexture(id: string): boolean {
  return getStockTexture(id)?.description?.kind === "built";
}

/**
 * A tileset's blend textures: a game tileset's (data/texture-extracted.json) or the Campaign Mod's
 * (catalog-layer.ts), through its parents; empty for a tileset neither has.
 */
export function getTilesetTextures(catalog: Catalog, tilesetId: string): string[] {
  return [...(resolveLayeredList(catalog.tilesets, tilesetId, (tileset) => tileset.textures, stockTileset) ?? [])];
}

/** Whether a tileset is the game's or the Campaign Mod's (a template tileset isn't one a map can use). */
export function isKnownTileset(catalog: Catalog, tilesetId: string): boolean {
  const own = catalog.tilesets.get(tilesetId);
  return own ? !own.template : stockTileset(tilesetId) !== undefined;
}

/**
 * The mission's 8 blend textures: its `textures` override; else its palette's textures, then the
 * tileset's to fill; else the tileset's ("" pads empty slots).
 */
export function missionTextures(catalog: Catalog, mission: {
  readonly tilesetId?: string | undefined;
  readonly textures?: readonly string[] | undefined;
  readonly texturePalette?: TexturePalette | undefined;
}): string[] {
  const tilesetId = mission.tilesetId ?? "KorhalCityEx2";
  const tileset = getTilesetTextures(catalog, tilesetId);
  const palette = mission.texturePalette;
  const fromPalette = palette
    ? [...new Set([...paletteTextures(palette), ...tileset].filter(Boolean))]
    : undefined;
  const names = (mission.textures ?? fromPalette ?? (tileset.length > 0 ? tileset : [`${tilesetId}Texture0`])).slice(0, 8);
  while (names.length < 8) names.push("");
  return names;
}
