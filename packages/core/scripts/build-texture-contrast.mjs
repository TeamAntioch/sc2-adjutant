#!/usr/bin/env node
// Regenerates data/texture-contrast.json: how stark each stock terrain texture looks on its own, as
// the contrast of its gallery picture (the standard deviation of its brightness, 0 to 255, with the
// picture at 512 px, to one place). A calm texture (grass, smooth earth, fine ash) is about 15; a
// stark one (pebbles, lumpy moss, pitted creep, roots, rough clods) 21 and up. The painter gives a
// stark variety texture less ground and smaller spots (src/terrain/paint-textures.ts). The spread
// over the mean was tried first and doesn't work: a dark texture's low mean makes calm grass score
// like pebbles.
//
// The pictures are the sc2-mapping-reference gallery's, as the texture sheet reads them: from the
// cache folder's texture-pictures/, else a local copy of the gallery, else GitHub (kept in the
// cache). A texture with no picture gets no entry, and the painter treats it as calm.
//
// Usage: node packages/core/scripts/build-texture-contrast.mjs [--gallery <sc2-mapping-reference/public/tilesets>]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { texturePicture, texturePictureDir } from "@team-antioch/sc2-asset-catalog/catalog/texture-pictures.js";
import sharp from "sharp";

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
const OUTPUT = path.join(DATA_DIR, "texture-contrast.json");
/** Every picture is measured at this size, so a larger picture's finer grain doesn't count for more. */
const SIZE = 512;

const galleryAt = process.argv.indexOf("--gallery");
const gallery = galleryAt >= 0 ? process.argv[galleryAt + 1] : undefined;
const pictureDir = texturePictureDir(process.env.SC2_ADJUTANT_CACHE_DIR);

const { textures } = JSON.parse(await readFile(path.join(DATA_DIR, "texture-extracted.json"), "utf8"));
const contrast = {};
const missing = [];
for (const [id, texture] of Object.entries(textures).sort(([a], [b]) => a.localeCompare(b))) {
  const picture = texture.image ? await texturePicture(texture, { pictureDir, ...(gallery ? { gallery } : {}) }) : undefined;
  if (!picture) {
    missing.push(id);
    continue;
  }
  const { data, info } = await sharp(picture).removeAlpha().resize(SIZE, SIZE, { kernel: "cubic" }).raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < pixels; i++) {
    const luma = 0.2126 * data[i * info.channels] + 0.7152 * data[i * info.channels + 1] + 0.0722 * data[i * info.channels + 2];
    sum += luma;
    squares += luma * luma;
  }
  const mean = sum / pixels;
  contrast[id] = Math.round(Math.sqrt(Math.max(0, squares / pixels - mean * mean)) * 10) / 10;
}

await writeFile(OUTPUT, `${JSON.stringify({ note: "Contrast of each texture's gallery picture: the standard deviation of its brightness (0 to 255) at 512 px. See scripts/build-texture-contrast.mjs.", contrast }, null, 2)}\n`);
console.log(`Wrote ${Object.keys(contrast).length} textures to ${OUTPUT}`);
if (missing.length > 0) console.log(`No picture for ${missing.length}: ${missing.join(", ")}`);
