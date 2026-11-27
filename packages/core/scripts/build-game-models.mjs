#!/usr/bin/env node
// Regenerates data/game-models.json: the storage path of every model file the game's CModels name,
// in the ModelData a Mission on Void Story loads (CAMPAIGN_CATALOGS, from the pinned sc2-game-data
// mirror), each template filled in as the game does (model-files.ts), and a model with variations
// as its numbered files (<name>_00.m3 and on). A doodad with `gameModel` names one of these, or a
// doodad's model in data/doodad-models.json, and the compile refuses any other path.
//
// Usage: pnpm --filter @team-antioch/sc2-adjutant run build && node packages/core/scripts/build-game-models.mjs

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { campaignModelData } from "../dist/catalog/model-anims.js";
import { modelFile, modelVariations, readModelEntries } from "../dist/catalog/model-files.js";
import { CORE_ROOT } from "./workspace-root.mjs";

const OUTPUT = path.join(CORE_ROOT, "data", "game-models.json");

const scratch = await mkdtemp(path.join(os.tmpdir(), "core-game-models-"));
try {
  const entries = readModelEntries(await campaignModelData(scratch));
  const files = new Map();
  for (const id of entries.keys()) {
    const file = modelFile(entries, id);
    // A path with a token no entry fills (a template's own ##id##) isn't a file.
    if (!file || file.includes("##") || !file.toLowerCase().endsWith(".m3")) continue;
    const variations = modelVariations(entries, id);
    const paths = variations > 1 ? Array.from({ length: variations }, (_, index) => file.replace(/\.m3$/i, `_${String(index).padStart(2, "0")}.m3`)) : [file];
    for (const each of paths) if (!files.has(each.toLowerCase())) files.set(each.toLowerCase(), each);
  }
  const models = [...files.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  await writeFile(OUTPUT, `${JSON.stringify(models, null, 1)}\n`);
  console.log(`${models.length} model paths -> ${path.relative(process.cwd(), OUTPUT)}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
