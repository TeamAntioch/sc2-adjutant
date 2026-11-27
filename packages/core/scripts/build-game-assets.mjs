#!/usr/bin/env node
// Regenerates data/game-assets.json: the storage path of every image file (.dds, .tga, .png, .jpg) and every model file (.m3) that data/game-models.json lacks,
// the game's own data names under Assets\, from a clone of the pinned sc2-game-data mirror: the
// catalogs, layouts and Assets.txt of EVERY mod and campaign in it, not only the ones a Void Story
// Mission loads (CAMPAIGN_CATALOGS). The engine's dependency chains are known for twelve packages
// only (src/map/game-packages.ts), and a Campaign Mod's entries name Heroes of the Storm and
// co-op icons that show in the Editor without depending on those mods, so a path counts when any
// stock mod names it. A texture only a model's own .m3 names is not in it. game-models.json stays the list a `gameModel` doodad is checked against;
// this one is wider, for the warning on a Generic Entry's path.
//
// Usage: pnpm --filter @team-antioch/sc2-adjutant run build && node packages/core/scripts/build-game-assets.mjs <path to the sc2-game-data clone>

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readFileSync } from "node:fs";
import { CAMPAIGN_CATALOGS } from "../dist/catalog/model-anims.js";
import { modelFile, modelVariations, readModelEntries } from "../dist/catalog/model-files.js";
import { CORE_ROOT } from "./workspace-root.mjs";

const inGit = (entry) => entry.parentPath.split(path.sep).includes(".git");
const OUTPUT = path.join(CORE_ROOT, "data", "game-assets.json");
const mirror = process.argv[2] ?? process.env.SC2_GAME_DATA;
if (!mirror) throw new Error("Usage: node build-game-assets.mjs <path to the sc2-game-data clone>");

const IMAGE = /Assets[\\/][^"'<>=|\r\n]*?\.(?:dds|tga|png|jpg|m3)(?![A-Za-z0-9])/gi;
const files = new Map();
const found = await readdir(mirror, { recursive: true, withFileTypes: true });
for (const entry of found.filter((each) => each.isFile() && /\.(xml|sc2layout|stormlayout|txt)$/i.test(each.name) && !inGit(each))) {
  for (const [match] of (await readFile(path.join(entry.parentPath, entry.name), "utf8")).matchAll(IMAGE)) {
    // A path with a template's ##token## or a wildcard isn't a file.
    if (/[#*]/.test(match)) continue;
    const file = match.replace(/\//g, "\\");
    if (!files.has(file.toLowerCase())) files.set(file.toLowerCase(), file);
  }
}
// The models of every CModel in the mirror, templates filled in as the game does (model-files.ts), each mod's
// catalogs read after the Void Story ones (a later entry overrides an earlier), as build-game-models.mjs reads them.
const everyCatalog = [];
for (const entry of found.filter((each) => each.isFile() && /\.xml$/i.test(each.name) && !inGit(each))) everyCatalog.push(path.join(entry.parentPath, entry.name));
const base = await Promise.all(CAMPAIGN_CATALOGS.map((mod) => readFile(path.join(mirror, mod, "base.sc2data", "GameData", "ModelData.xml"), "utf8")));
const withModels = [];
for (const file of everyCatalog.sort()) {
  const text = await readFile(file, "utf8");
  if (text.includes("<CModel ")) withModels.push(text);
}
const entries = readModelEntries([...base, ...withModels]);
for (const id of entries.keys()) {
  const file = modelFile(entries, id);
  if (!file || file.includes("##") || !file.toLowerCase().endsWith(".m3")) continue;
  const variations = modelVariations(entries, id);
  const paths = variations > 1 ? Array.from({ length: variations }, (_, index) => file.replace(/\.m3$/i, `_${String(index).padStart(2, "0")}.m3`)) : [file];
  for (const each of paths.map((one) => one.replace(/\//g, "\\"))) if (!files.has(each.toLowerCase())) files.set(each.toLowerCase(), each);
}
const known = new Set(JSON.parse(readFileSync(path.join(CORE_ROOT, "data", "game-models.json"), "utf8")).map((file) => file.replace(/\\/g, "/").toLowerCase()));
const images = [...files.values()].filter((file) => !known.has(file.replace(/\\/g, "/").toLowerCase())).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
await writeFile(OUTPUT, `${JSON.stringify(images, null, 1)}\n`);
console.log(`${images.length} asset paths -> ${path.relative(process.cwd(), OUTPUT)}`);
