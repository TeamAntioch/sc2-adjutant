#!/usr/bin/env node
// Regenerates data/game-images.json: the storage path of every image file (.dds, .tga, .png, .jpg)
// the game's own data names under Assets\, in the data a Mission on Void Story loads
// (CAMPAIGN_CATALOGS) from a clone of the pinned sc2-game-data mirror: its catalogs, layouts and
// Assets.txt. A Generic Entry's icon or texture path is checked against it (custom-doodads.ts). It
// holds only the files the game's data names: a model's own textures, which only its .m3 names, are
// not in it.
//
// Usage: npm run build -w packages/core && node packages/core/scripts/build-game-images.mjs <path to the sc2-game-data clone>

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CAMPAIGN_CATALOGS } from "../dist/catalog/model-anims.js";
import { CORE_ROOT } from "./workspace-root.mjs";

const OUTPUT = path.join(CORE_ROOT, "data", "game-images.json");
const mirror = process.argv[2] ?? process.env.SC2_GAME_DATA;
if (!mirror) throw new Error("Usage: node build-game-images.mjs <path to the sc2-game-data clone>");

const IMAGE = /Assets[\\/][^"'<>=|\r\n]*?\.(?:dds|tga|png|jpg)(?![A-Za-z0-9])/gi;
const files = new Map();
for (const mod of CAMPAIGN_CATALOGS) {
  const root = path.join(mirror, mod, "base.sc2data");
  const found = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of found.filter((each) => each.isFile() && /\.(xml|sc2layout|txt)$/i.test(each.name))) {
    for (const [match] of (await readFile(path.join(entry.parentPath, entry.name), "utf8")).matchAll(IMAGE)) {
      // A path with a template's ##token## or a wildcard isn't a file.
      if (/[#*]/.test(match)) continue;
      const file = match.replace(/\//g, "\\");
      if (!files.has(file.toLowerCase())) files.set(file.toLowerCase(), file);
    }
  }
}
const images = [...files.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
await writeFile(OUTPUT, `${JSON.stringify(images, null, 1)}\n`);
console.log(`${images.length} image paths -> ${path.relative(process.cwd(), OUTPUT)}`);
