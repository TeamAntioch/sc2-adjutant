// Which variations of a decal doodad dressing may pick, from the published catalog's decal
// descriptions (stock-catalog.ts): a painted number, letter or word promises it labels something
// (a bay, a lane), so scattered at random it reads as noise.

import { type DecalVariation, isScatterable } from "@team-antioch/sc2-asset-catalog/catalog/decal-catalog.js";

import type { Catalog } from "../catalog/catalog-layer.js";
import { getDoodad, stockDecals } from "../catalog/stock-catalog.js";

/**
 * A decal doodad's variations, by variation number, when the catalog describes it and the
 * Workspace's Campaign Mod hasn't given it a model of its own (whose variations could show anything).
 */
export function getDecalVariations(catalog: Catalog | undefined, type: string): readonly DecalVariation[] | undefined {
  if (catalog?.doodadIndex.has(type) && catalog.doodads.has(type)) return undefined;
  return Object.hasOwn(stockDecals(), type) ? stockDecals()[type] : undefined;
}

/**
 * The variations dressing may pick at random for a doodad: for a catalogued decal, the scatterable
 * ones (no glyphs, no labels, signs or emblems); else, or when it has none (a doodad of numbers
 * only, asked for by name), every variation it has. Numbers and words go where they label
 * something by naming the variations (a member's or edge line's `variations`).
 */
export function randomVariations(catalog: Catalog, type: string): number[] {
  const count = getDoodad(catalog, type)?.variations ?? 1;
  const all = Array.from({ length: count }, (_, variation) => variation);
  const described = getDecalVariations(catalog, type);
  if (!described) return all;
  const scatterable = all.filter((variation) => described[variation] && isScatterable(described[variation]));
  return scatterable.length > 0 ? scatterable : all;
}
