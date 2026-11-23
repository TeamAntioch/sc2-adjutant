// The colours a texture-blend render (study/render-layers.ts) gives each cell's 8 layers on a Kept
// map: the textures of the set its block draws on.

import { cellSet, type KeptTextures, setTextures, usesSets } from "../kept-terrain/paint-brushes.js";
import type { LayerColours } from "../study/render-layers.js";
import { SETS } from "../terrain/texture-grid.js";

/** Each cell's layer colours in a render: its block's set's textures, by `colours` (empty slots under ""). */
export function layerColours(textures: KeptTextures, colours: ReadonlyMap<string, readonly number[]>): LayerColours {
  const bySet = Array.from({ length: SETS }, (_, set) => setTextures(textures, set).map((texture) => colours.get(texture) ?? colours.get("")!));
  return usesSets(textures) ? (x: number, y: number) => bySet[cellSet(textures, x, y)]! : bySet[0]!;
}
