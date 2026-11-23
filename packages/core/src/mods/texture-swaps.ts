// A doodad's texture swaps (domain/custom-doodad.ts `swaps`) checked against its model, and the
// slot each one fills. A swap takes three pieces that must agree, and fails silently in the game
// when they don't (docs/reference/texture-swaps.md): the CModel's TextureDeclares, matched against
// the .m3's texture file names; a CTexture in a slot the model declares; and the actor's
// TextureSelectById. customDoodadEntries writes all three from what checkDoodadSwaps resolves here,
// so nothing of them is written by hand:
//
//   declaration  Prefix = the replaced file's base name, one adaption with Slot `swap<n>`
//   CTexture     `<id>_Swap<n>`, File = `with`, Slot `swap<n>.<component>`: the component of the
//                layer the model has the replaced texture in (readM3MaterialTextures), or the bare
//                slot for a layer that isn't a diffuse, emissive, normal or specular one, which the
//                game fills (the Pylon's environment map, seen in game)
//   events       TextureSelectById on ActorCreation and ModelSwapped
//
// The checks refuse a `replace` the model doesn't name, a `with` the map won't load, and two swaps
// of one texture; they warn when the replaced file's base name is the prefix of another texture
// the model names (the declaration takes both) and when the replaced texture is in several layers
// or materials (one swap changes every use).

import { readM3MaterialTextures, readM3TexturePaths, type M3LayerSlot } from "../catalog/m3-textures.js";
import type { DoodadSwap } from "../domain/custom-doodad.js";

/** The slot components a CTexture names (`swap1.emissive`); any other layer takes the bare slot. */
const COMPONENTS = ["diffuse", "emissive", "normal", "specular"] as const;
export type SwapComponent = (typeof COMPONENTS)[number];

/** A swap as customDoodadEntries writes it: the component of its slot, none for the bare slot. */
export type SwapSlot = DoodadSwap & { readonly component?: SwapComponent | undefined };

/** A texture path's file name without its extension, as a declaration's Prefix matches it: `Pylon_Emissive`. */
export const baseName = (storagePath: string): string => storagePath.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "");

/** A storage path to compare: one slash, any case, as the game matches it. */
const same = (storagePath: string): string => storagePath.replace(/\\/g, "/").toLowerCase();
const fileName = (storagePath: string): string => storagePath.split(/[\\/]/).pop()!;

/** The model a doodad's swaps are checked against: its .m3's bytes, and where they were read, for messages. */
export type SwapModel = { readonly data: Uint8Array; readonly where: string };

/**
 * Checks `doodad`'s swaps (named `label`, such as `doodads.0 (GreenPylon)`) against its model's
 * .m3, as above. `loads` says whether the map loads a file at a storage path (the doodad's own
 * files, Kept, the Workspace mods), `lookedIn` where it looks, for the refusal; a `with` in the
 * doodad's `gameTextures` is the game's own. Throws on a refusal; returns each swap's slot, in
 * order, and the warnings.
 */
export function checkDoodadSwaps(
  doodad: { readonly model: string; readonly swaps: readonly DoodadSwap[]; readonly gameTextures: readonly string[] },
  label: string,
  model: SwapModel,
  loads: (storagePath: string) => boolean,
  lookedIn: string,
): { readonly slots: readonly SwapSlot[]; readonly warnings: readonly string[] } {
  if (doodad.swaps.length === 0) return { slots: [], warnings: [] };
  let named: string[];
  let materials: ReturnType<typeof readM3MaterialTextures>;
  try {
    named = readM3TexturePaths(model.data);
    materials = readM3MaterialTextures(model.data);
  } catch (error) {
    throw new Error(`${label}'s model ${doodad.model} (${model.where}) doesn't read as an .m3, so its swaps can't be checked: ${(error as Error).message}`, { cause: error });
  }
  const game = new Set(doodad.gameTextures.map(same));
  const first = new Map<string, number>();
  const prefixes = new Map<string, number>();
  const slots: SwapSlot[] = [];
  const warnings: string[] = [];
  for (const [index, swap] of doodad.swaps.entries()) {
    const at = `${label}'s swaps.${index}`;
    const replaced = same(swap.replace);
    const other = first.get(replaced);
    if (other !== undefined) throw new Error(`${label}'s swaps.${other} and swaps.${index} both replace ${doodad.swaps[other]!.replace}: give each texture one swap`);
    first.set(replaced, index);
    // Two declarations of one prefix "tend to malfunction" (texture-swaps.md), and each would take both files anyway.
    const prefix = baseName(swap.replace);
    const sharing = prefixes.get(prefix.toLowerCase());
    if (sharing !== undefined) throw new Error(`${label}'s swaps.${sharing} and swaps.${index} replace files of one base name, ${prefix}: one declaration's prefix takes both, so swap one of them`);
    prefixes.set(prefix.toLowerCase(), index);
    if (!named.some((texture) => same(texture) === replaced)) throw new Error(`${at} replaces ${swap.replace}, which its model ${doodad.model} doesn't name. It names ${named.join(", ")}`);
    if (!game.has(same(swap.with)) && !loads(swap.with)) {
      throw new Error(`${at} draws ${swap.with}, which isn't in ${lookedIn}: add the file there, or, when it is the game's own texture, list it in the doodad's gameTextures`);
    }
    const uses = materials.flatMap(({ name, layers }) => layers.filter((layer) => same(layer.texture) === replaced).map((layer) => ({ name, slot: layer.slot })));
    // A CTexture fills one component: the first standard one the texture is in, else the bare slot.
    const component = uses.map(({ slot }) => slot).find((slot: M3LayerSlot): slot is SwapComponent => (COMPONENTS as readonly string[]).includes(slot));
    slots.push({ ...swap, ...(component ? { component } : {}) });
    const components = new Set(uses.map(({ slot }) => slot).filter((slot) => (COMPONENTS as readonly string[]).includes(slot)));
    if (uses.length > 1) {
      // One swap changes every use of the texture, but a CTexture fills one component, and uses in another may keep the old one.
      const outcome = components.size > 1 ? `its CTexture fills the ${component} alone, so the others may keep the model's texture` : "the swap changes every one";
      warnings.push(`${at} replaces ${swap.replace}, which its model ${doodad.model} has in more than one layer (${uses.map(({ name, slot }) => `${name} ${slot}`).join(", ")}): ${outcome}`);
    }
    // The bare slot was seen to fill an environment map alone (texture-swaps.md, "The Pylon's crystal").
    if (!component && (uses.length === 0 || !uses.every(({ slot }) => slot === "environment"))) {
      warnings.push(
        `${at} replaces ${swap.replace}, which its model ${doodad.model} has in ${uses.length === 0 ? "no standard material's layer" : uses.map(({ name, slot }) => `${name}'s ${slot}`).join(", ") + " layer"}: it goes in the bare slot swap${index + 1}, which the game was seen to fill only for an environment map, so look at it in the game`,
      );
    }
    // The declaration's Prefix takes every texture whose file name starts with it, in any case.
    const taken = named.filter((texture) => same(texture) !== replaced && fileName(texture).toLowerCase().startsWith(prefix.toLowerCase()));
    if (taken.length > 0) {
      warnings.push(
        `${at} declares the prefix ${prefix}, which also takes ${taken.join(", ")}, ${taken.length === 1 ? "another texture" : "other textures"} its model ${doodad.model} names: the swap may change ${taken.length === 1 ? "that one" : "those"} too`,
      );
    }
  }
  return { slots, warnings };
}
