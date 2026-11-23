// The textures an .m3 names: each material layer's image path (`Assets\Textures\x.dds`), as the
// model writes it. A layer keeps its path in a CHAR block the tag index lists, so the CHAR blocks
// holding an image file's name are its textures, whatever the LAYR version. The macOS Host Adapter
// stages a mod model with just these files (ADR-0017). Which material and layer each texture is in
// (readM3MaterialTextures) says what a texture swap on it reaches (docs/reference/texture-swaps.md).

import { MAT_SIZE, matFirstLayer, modlRecord } from "./m3-footprint.js";
import { m3Index } from "./m3-sequences.js";

/** The file types a material layer draws from: images, and the videos some layers play. */
const TEXTURE_FILE = /\.(dds|tga|png|jpe?g|ogv)$/i;

/** Each texture path an MD34 .m3 names, once each, in the file's order. */
export function readM3TexturePaths(data: Uint8Array): string[] {
  const { entries } = m3Index(data);
  const paths = new Set<string>();
  for (const entry of entries) {
    if (entry.tag !== "RAHC" || entry.count === 0 || entry.offset + entry.count > data.length) continue;
    const text = new TextDecoder().decode(data.subarray(entry.offset, entry.offset + entry.count)).replace(/\0+$/, "");
    if (TEXTURE_FILE.test(text)) paths.add(text);
  }
  return [...paths];
}

/**
 * A standard material's layer slots, in MAT_'s order (structures.xml): `gloss` from MAT_ version 16,
 * the four normal-blend layers from version 19. A texture swap's component (`main.diffuse`,
 * `main.emissive`, `main.normal`, `main.specular`) names one of the first four kinds.
 */
const LAYER_SLOTS = [
  "diffuse",
  "decal",
  "specular",
  "gloss",
  "emissive",
  "emissive2",
  "environment",
  "environmentMask",
  "alphaMask",
  "alphaMask2",
  "normal",
  "height",
  "lightMap",
  "ambientOcclusion",
  "normalBlendMask1",
  "normalBlendMask2",
  "normalBlend1",
  "normalBlend2",
] as const;

export type M3LayerSlot = (typeof LAYER_SLOTS)[number];

/** One standard material and the texture in each of its layers that has one. */
export type M3MaterialTextures = {
  /** Its place in the model's material references, which the mesh's batches name. */
  readonly material: number;
  readonly name: string;
  readonly layers: readonly { readonly slot: M3LayerSlot; readonly texture: string }[];
};

/** Where MODL keeps its MATM and MAT_ references. */
const MODL_MATERIAL_REFERENCES = 300;
const MODL_STANDARD_MATERIALS = 312;
/** A LAYR's image path reference. */
const LAYR_IMAGE = 4;

/**
 * Each standard material of an MD34 .m3, by its place in the model's material references, with the
 * texture in each of its layers. One texture can be in several materials and layers: a swap of it
 * changes every one (the Pylon's `Pylon_Specular.dds` is the body's specular and the crystal's
 * specular, environment mask and alpha mask). Other material types (composite, displacement,
 * terrain …) are left out; a composite draws through standard materials, which are listed.
 */
export function readM3MaterialTextures(data: Uint8Array): M3MaterialTextures[] {
  const { view, entries, modl } = modlRecord(data);
  const reference = (at: number) => ({ count: view.getUint32(at, true), entry: entries[view.getUint32(at + 4, true)] });
  const text = (at: number, tag: string): string | undefined => {
    const ref = reference(at);
    if (ref.count === 0 || ref.entry?.tag !== tag) return undefined;
    return new TextDecoder().decode(data.subarray(ref.entry.offset, ref.entry.offset + ref.count)).replace(/\0.*$/s, "");
  };
  const matm = reference(modl.offset + MODL_MATERIAL_REFERENCES);
  const mat = reference(modl.offset + MODL_STANDARD_MATERIALS);
  const size = mat.entry ? MAT_SIZE[mat.entry.version] : undefined;
  if (!matm.entry || !mat.entry || size === undefined) return [];
  const version = mat.entry.version;
  const slots = LAYER_SLOTS.filter((slot) => (slot !== "gloss" || version >= 16) && (!slot.startsWith("normalBlend") || version >= 19));
  const found: M3MaterialTextures[] = [];
  for (let material = 0; material < matm.count; material++) {
    const index = view.getUint32(matm.entry.offset + 8 * material + 4, true);
    if (view.getUint32(matm.entry.offset + 8 * material, true) !== 1 || index >= mat.count) continue;
    const at = mat.entry.offset + size * index;
    const layers = slots.flatMap((slot, k) => {
      const layer = reference(at + matFirstLayer(version) + 12 * k);
      if (layer.count === 0 || layer.entry?.tag !== "RYAL") return [];
      const texture = text(layer.entry.offset + LAYR_IMAGE, "RAHC");
      return texture && TEXTURE_FILE.test(texture) ? [{ slot, texture }] : [];
    });
    found.push({ material, name: text(at, "RAHC") ?? "", layers });
  }
  return found;
}
