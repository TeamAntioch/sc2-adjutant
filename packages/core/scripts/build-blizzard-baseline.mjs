// Builds data/blizzard-baseline.json: core's lesson-neutral measures over every campaign mission of
// Wings of Liberty, Heart of the Swarm, Legacy of the Void and Nova Covert Ops, read from the
// install's CASC storage. A Style Pack's consistency report sets a mapper's maps against it.
//
// Usage: with a CASC extractor named in SC2_CASC_TOOL (tools/README.md), after `npm run build`,
//
//   SC2_CASC_TOOL=<extractor> node packages/core/scripts/build-blizzard-baseline.mjs "<StarCraft II folder>"
//
// It extracts one mission's map files at a time into a scratch folder, measures them and removes
// them, so no map is kept and nothing but the measures is written. The missions are
// BLIZZARD_CAMPAIGN_MISSIONS (src/study/blizzard-baseline.ts). Rebuild it whenever a measure
// changes or is added: the baseline's test fails until it covers every measure.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { BLIZZARD_CAMPAIGN_MISSIONS, BLIZZARD_BASELINE_PATH, buildBlizzardBaseline } from "../dist/study/blizzard-baseline.js";
import { loadMapPackage } from "../dist/study/load-map-package.js";
import { measureMap } from "../dist/study/measures.js";
import { PATHING_FILE } from "../dist/terrain/write-cell-attribute.js";
import { extractInto, scratchFolder, storageArgument, storagePath } from "./casc-tool.mjs";

/** The files of a map package a study reads (load-map-package.ts), by the names it reads them by. */
const MAP_FILES = [
  "t3Terrain.xml",
  "t3TextureMasks",
  "t3HeightMap",
  "t3SyncCliffLevel",
  "Objects",
  "MapInfo",
  "Minimap.tga",
  "t3VertCol",
  "t3FluffDoodad",
  "t3Water",
  PATHING_FILE,
  "MapScript.galaxy",
  "Base.SC2Data/GameData/TerrainData.xml",
  "Base.SC2Data/GameData/LightData.xml",
];
/** Where the map's English name is. */
const STRINGS = "enUS.SC2Data/LocalizedData/GameStrings.txt";

const storage = storageArgument("build-blizzard-baseline.mjs");
const scratch = scratchFolder("blizzard-baseline");

const maps = [];
const unavailable = [];
for (const mission of BLIZZARD_CAMPAIGN_MISSIONS) {
  const folder = path.join(scratch, mission.id);
  mkdirSync(folder);
  const files = [...MAP_FILES, STRINGS].map((file) => storagePath(...file.split("/"))).join("|");
  await extractInto(storage, [`^${storagePath(...mission.storagePath.split("/"))}[\\\\/](?:${files})$`], folder);
  const dir = path.join(folder, ...mission.storagePath.split("/"));
  const terrain = path.join(dir, "t3terrain.xml");
  if (!existsSync(terrain)) {
    console.error(`No map at ${mission.storagePath} in ${storage}: has the game moved its campaign maps?`);
    process.exit(1);
  }
  if (statSync(terrain).size === 0) {
    // The storage lists the map, but the launcher hasn't downloaded its data (Nova Covert Ops downloads apart).
    unavailable.push({ id: mission.id, campaign: mission.campaign, reason: `the install lists the map but holds none of its data: download ${mission.campaign} in the Battle.net app and rebuild` });
    rmSync(folder, { recursive: true, force: true });
    process.stderr.write(`(${mission.id} not downloaded) `);
    continue;
  }
  restoreCase(dir);
  const name = englishName(path.join(dir, STRINGS.toLowerCase()));
  maps.push({ id: mission.id, campaign: mission.campaign, ...(name ? { name } : {}), measures: measureMap(loadMapPackage(dir)) });
  rmSync(folder, { recursive: true, force: true });
  process.stderr.write(`${mission.id} `);
}
process.stderr.write("\n");

writeFileSync(BLIZZARD_BASELINE_PATH, `${JSON.stringify(buildBlizzardBaseline(maps, unavailable), null, 2)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), BLIZZARD_BASELINE_PATH)}: ${maps.length} missions`);
if (unavailable.length) console.warn(`Not in this install, so left out: ${unavailable.map((m) => m.id).join(", ")}. Download them and rebuild.`);

/**
 * Renames each file the study reads, and the folders above it, from the lower case the extract
 * leaves to the name the study reads it by, for a case-sensitive file system.
 */
function restoreCase(dir) {
  for (const file of MAP_FILES) {
    let at = dir;
    for (const part of file.split("/")) {
      const names = readdirSync(at);
      if (!names.includes(part)) {
        if (!names.includes(part.toLowerCase())) break; // the map has no such file
        // Through a temporary name, so a case-insensitive file system renames it too.
        renameSync(path.join(at, part.toLowerCase()), path.join(at, `${part}.case`));
        renameSync(path.join(at, `${part}.case`), path.join(at, part));
      }
      at = path.join(at, part);
    }
  }
}

/** The map's English name (DocInfo/Name in its GameStrings.txt), or undefined. */
function englishName(file) {
  if (!existsSync(file)) return undefined;
  return /^DocInfo\/Name=(.*)$/m.exec(readFileSync(file, "utf8"))?.[1]?.trim() || undefined;
}
