#!/usr/bin/env node
// Regenerates core's committed copy of the catalog's extracted fields with the published
// @team-antioch/sc2-asset-catalog's extractors (ADR-0022): data/doodads.json (kinds, categories,
// tilesets, variations, blocksGround), data/doodad-models.json (each doodad's model file) and
// data/doodad-extracted.json (names, packages, gallery pictures); data/texture-extracted.json (each
// tileset's blend textures, each texture's tilesets, file, name and gallery picture); and
// data/cliff-extracted.json (each tileset's cliff sets, each cliff set's tilesets and gallery picture). All come
// from SC2Mapster's SC2GameData and the sc2-mapping-reference gallery on GitHub, with no SC2 install.
// A mapper's copy extracts them into their cache; core commits them, so a compile reads the same
// doodads, textures and cliff sets on every machine. The descriptions and Doodad Uses aren't touched: they're
// written by hand, in the package.
//
// Usage: npm run extract-catalog [-- --check]
//   --check  writes nothing, and lists how the extraction differs from the committed files.
// GITHUB_TOKEN, when set, lists the gallery through GitHub's API above its limit for unauthenticated calls.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractCatalog } from "@team-antioch/sc2-asset-catalog/catalog/extract-catalog.js";
import { extractCliffs } from "@team-antioch/sc2-asset-catalog/catalog/extract-cliffs.js";
import { extractTextures } from "@team-antioch/sc2-asset-catalog/catalog/extract-textures.js";

const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));
/**
 * The extracted files core commits, each with the sections compared entry by entry (none: the
 * file's own entries). The extractors' info files (when, from where) aren't among them.
 */
const FILES = [
  ["doodads.json"],
  ["doodad-models.json"],
  ["doodad-extracted.json"],
  ["texture-extracted.json", ["tilesets", "textures"]],
  ["cliff-extracted.json", ["tilesets", "cliffSets"]],
];
const check = process.argv.includes("--check");

/** How two versions of one file differ, entry by entry; the number of entries that do. */
function differences(file, committed, extracted) {
  const ids = [...new Set([...Object.keys(committed), ...Object.keys(extracted)])].sort();
  let count = 0;
  for (const id of ids) {
    const [before, after] = [committed[id], extracted[id]];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    count++;
    if (before === undefined) console.log(`${file} + ${id} ${JSON.stringify(after)}`);
    else if (after === undefined) console.log(`${file} - ${id}`);
    else if (typeof before !== "object" || typeof after !== "object") console.log(`${file} ~ ${id} ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    else {
      const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
      console.log(`${file} ~ ${id} ${fields.map((field) => `${field}: ${JSON.stringify(before[field])} -> ${JSON.stringify(after[field])}`).join(", ")}`);
    }
  }
  return count;
}

const scratch = await mkdtemp(path.join(os.tmpdir(), "core-extract-"));
try {
  const log = (line) => console.log(line);
  await extractCatalog({ extractedDir: scratch, log });
  await extractTextures({ extractedDir: scratch, log });
  await extractCliffs({ extractedDir: scratch, log });
  let differing = 0;
  for (const [file, sections] of FILES) {
    const text = await readFile(path.join(scratch, file), "utf8");
    if (!check) {
      await writeFile(path.join(DATA_DIR, file), text);
      continue;
    }
    const [committed, extracted] = [JSON.parse(await readFile(path.join(DATA_DIR, file), "utf8").catch(() => "{}")), JSON.parse(text)];
    for (const section of sections ?? [undefined]) {
      differing += section ? differences(`${file} ${section}`, committed[section] ?? {}, extracted[section] ?? {}) : differences(file, committed, extracted);
    }
  }
  console.log(check ? `${differing} entries differ from the committed files` : `${FILES.map(([file]) => file).join(", ")} -> ${path.relative(process.cwd(), DATA_DIR) || "."}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
