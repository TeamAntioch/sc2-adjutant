import { paletteTextures, type TexturePalette } from "../domain/mission-blueprint.js";
import { type Catalog, resolveLayeredList } from "./catalog-layer.js";
import { getStockTexture, stockTextures } from "./stock-catalog.js";

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

/** Whether a texture is an accent by its catalog description: a bold look (pits, roots, cracks) to use in small amounts. */
export function textureIsAccent(id: string): boolean {
  return getStockTexture(id)?.description?.suits?.includes("accent") ?? false;
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
