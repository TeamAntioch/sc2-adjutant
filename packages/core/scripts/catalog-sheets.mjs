#!/usr/bin/env node
// Builds the reference sheets for core's doodad and terrain-object catalogs on this machine, with the
// published @team-antioch/sc2-asset-catalog's sheet builder: one 512×512 JPEG per entry with its four
// turntable angles (variation 00) in a 2×2 grid on mid-grey, from the renders `npm run thumbnails`
// (and `-- --terrain-objects`) made through the Host Adapter's model.render. Renders and sheets are
// rendered game assets, git-ignored under data/thumbnails/ and data/catalog-sheets/, never
// committed or named in the catalogs: the search finds each sheet where this builds it. A sheet is
// rebuilt only when a render is newer. Terrain objects of one model share one sheet. Needs
// ImageMagick (`montage`).
//
// Usage: npm run catalog-sheets [-- --force]

import { existsSync } from "node:fs";
import path from "node:path";

import { buildSheets, sheetName, sheetPath, sheetRenders } from "@team-antioch/sc2-asset-catalog/catalog/catalog-sheets.js";

import { CORE_DATA_DIR, readCoreDoodadSources } from "../dist/catalog/stock-catalog.js";

const force = process.argv.includes("--force");
const { doodads, terrainObjects } = readCoreDoodadSources();

for (const [catalog, entries] of [["doodad", doodads], ["terrain-object", terrainObjects]]) {
  const jobs = new Map();
  for (const [id, entry] of Object.entries(entries)) {
    const name = sheetName(catalog, id, entry.model);
    if (jobs.has(name)) continue;
    // A sheet is built from as many of the four renders as are here.
    const renders = sheetRenders(catalog, name).map((render) => path.join(CORE_DATA_DIR, render)).filter(existsSync);
    jobs.set(name, { renders, sheet: path.join(CORE_DATA_DIR, sheetPath(catalog, name)) });
  }
  const built = await buildSheets(jobs.values(), { force });
  const sheeted = [...jobs.values()].filter((job) => existsSync(job.sheet)).length;
  console.log(`${catalog}s: ${built.length} sheets built, ${sheeted} of ${jobs.size} have one`);
}
