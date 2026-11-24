#!/usr/bin/env node
// Regenerates data/package-entries.json: the CModel, CLight and CSound ids each of the game's
// packages defines in its ModelData.xml, LightData.xml and SoundData.xml, for the compile's check
// that a Cinematic's cast, Set pieces and Lights are loaded by the map's dependencies
// (src/map/game-packages.ts, #1019), and sound-mix's check of its layers' CSounds
// (src/mods/sound-mix.ts). An id defined by several packages is listed under each, so a map
// loading any of them has it.
//
// The packages are those whose place in the engine's built-in dependency chains is known
// (GAME_PACKAGES in src/map/game-packages.ts). Read from the pinned mirror of the game's data,
// sc2-arcade-watcher/sc2-game-data at COMMIT, or from a local clone of it at that commit given as
// the first argument.
//
// A CModel's file can live in another package than its entry: Nova Covert Ops' bridge has its
// CModels in Liberty.SC2Mod and its .m3 files in NovaStoryAssets.SC2Mod's assets, which the mirror
// doesn't hold. The Set's source cutscene says which package such a Set needs.
//
// Usage: node packages/core/scripts/build-package-entries.mjs [<sc2-game-data clone>]

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CORE_ROOT } from "./workspace-root.mjs";

const REPOSITORY = "sc2-arcade-watcher/sc2-game-data";
const COMMIT = "7be894538d6eac77a9583acfeb5f721e273beee4";
const OUTPUT = path.join(CORE_ROOT, "data", "package-entries.json");
const PACKAGES = [
  "mods/core.sc2mod",
  "mods/liberty.sc2mod",
  "mods/swarm.sc2mod",
  "mods/void.sc2mod",
  "campaigns/liberty.sc2campaign",
  "campaigns/swarm.sc2campaign",
  "campaigns/void.sc2campaign",
  "campaigns/libertystory.sc2campaign",
  "campaigns/swarmstory.sc2campaign",
  "campaigns/voidstory.sc2campaign",
  "mods/voidprologue.sc2mod",
  "mods/novastoryassets.sc2mod",
];
const CATALOGS = { models: ["ModelData.xml", "CModel"], lights: ["LightData.xml", "CLight"], sounds: ["SoundData.xml", "CSound"] };

const local = process.argv[2];

/** A package's catalog file, or "" when the package has none. */
async function catalog(pkg, file) {
  const relative = `${pkg}/base.sc2data/GameData/${file}`;
  if (local) {
    const at = path.join(local, relative);
    return existsSync(at) ? readFile(at, "utf8") : "";
  }
  const response = await fetch(`https://raw.githubusercontent.com/${REPOSITORY}/${COMMIT}/${relative}`);
  if (response.status === 404) return "";
  if (!response.ok) throw new Error(`Fetching ${relative} failed: ${response.status} ${response.statusText}`);
  return response.text();
}

/** The ids of the `element` entries a catalog defines, sorted, each once. */
const ids = (xml, element) => [...new Set([...xml.matchAll(new RegExp(`<${element}\\b[^>]*?\\bid="([^"]+)"`, "g"))].map((match) => match[1]))].sort();

const packages = {};
for (const pkg of PACKAGES) {
  const entries = {};
  for (const [kind, [file, element]] of Object.entries(CATALOGS)) entries[kind] = ids(await catalog(pkg, file), element);
  packages[pkg] = entries;
}
const source = `${REPOSITORY} at ${COMMIT}: each package's base.sc2data/GameData ModelData.xml, LightData.xml and SoundData.xml`;
// One id per line, so a new pin's diff reads.
await writeFile(OUTPUT, `${JSON.stringify({ source, packages }, null, 1)}\n`);
for (const [pkg, { models, lights, sounds }] of Object.entries(packages)) console.log(`${pkg}: ${models.length} models, ${lights.length} lights, ${sounds.length} sounds`);
console.log(`-> ${path.relative(process.cwd(), OUTPUT)}`);
