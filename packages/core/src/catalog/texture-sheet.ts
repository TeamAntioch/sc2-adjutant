// A sheet of terrain texture pictures, to choose textures by sight (ADR-0016): the package's tiles
// and SVG sheet (@team-antioch/sc2-asset-catalog's texture-pictures), drawn to PNG. The pictures
// are the sc2-mapping-reference gallery's, fetched once into the cache folder's texture-pictures/,
// so core ships none of the game's art. A texture with no gallery picture is a grey tile saying so.

import type { TextureEntry } from "@team-antioch/sc2-asset-catalog/catalog/texture-catalog.js";
import { texturePictureDir, textureSheetSvg, textureSheetTiles } from "@team-antioch/sc2-asset-catalog/catalog/texture-pictures.js";

import { renderSvgToPng } from "../preview/render-png.js";

export type TextureSheetOptions = {
  /** The machine's cache folder (its texture-pictures/ keeps the pictures); the package's cache folder when unset. */
  readonly cacheDir?: string | undefined;
  /** A local copy of the gallery (sc2-mapping-reference's public/tilesets), read before fetching. */
  readonly gallery?: string | undefined;
  readonly fetch?: typeof globalThis.fetch;
  readonly columns?: number;
  readonly size?: number;
};

/** The sheet for some textures (each with an optional label), as PNG, with the ids that have no picture. */
export async function renderTextureSheet(
  textures: readonly { readonly texture: TextureEntry; readonly label?: string | undefined }[],
  { cacheDir, gallery, fetch, columns, size }: TextureSheetOptions = {},
): Promise<{ readonly png: Buffer; readonly missing: readonly string[] }> {
  const { tiles, missing } = await textureSheetTiles(textures, { pictureDir: texturePictureDir(cacheDir), ...(gallery ? { gallery } : {}), ...(fetch ? { fetch } : {}) });
  const png = await renderSvgToPng(textureSheetSvg(tiles, { ...(columns ? { columns } : {}), ...(size ? { size } : {}) }));
  return { png, missing };
}

/** A texture as the texture sheet lists it: `<id> (<kind>, <tone>, <tilesets>): <look>`. */
export const describeTexture = (texture: TextureEntry): string =>
  `${texture.id} (${texture.description?.kind ?? "?"}, ${texture.description?.tone ?? "?"}, ${texture.tilesets.join("/")}): ${texture.description?.look ?? "no description"}`;
