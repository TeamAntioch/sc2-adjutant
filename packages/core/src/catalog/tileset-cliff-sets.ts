import { cliffSetKind } from "@team-antioch/sc2-asset-catalog/catalog/cliff-catalog.js";

import { type Catalog, resolveLayeredList } from "./catalog-layer.js";
import { getStockCliffSet, stockCliffs } from "./stock-catalog.js";

/** A game tileset's cliff sets in TerrainData order (data/cliff-extracted.json), or undefined for a tileset the game doesn't define. */
const stockTileset = (id: string): readonly string[] | undefined => (Object.hasOwn(stockCliffs().tilesets, id) ? stockCliffs().tilesets[id] : undefined);

/** Whether a cliff set id is one the game's tilesets use (data/cliff-extracted.json) or the Campaign Mod defines. */
export function isKnownCliffSet(catalog: Catalog, id: string): boolean {
  return getStockCliffSet(id) !== undefined || catalog.cliffSets.has(id);
}

/** Whether a game cliff set looks natural or built: its picture's kind, else its name's variant (the package's cliffSetKind). */
export function getCliffSetKind(id: string): "natural" | "built" {
  return cliffSetKind(getStockCliffSet(id));
}

/** A tileset's cliff sets in TerrainData order, the game's or the Campaign Mod's; the first is its natural cliff. Empty if unknown. */
export function getTilesetCliffSets(catalog: Catalog, tilesetId: string): string[] {
  return [...(resolveLayeredList(catalog.tilesets, tilesetId, (tileset) => tileset.cliffSets, stockTileset) ?? [])];
}
