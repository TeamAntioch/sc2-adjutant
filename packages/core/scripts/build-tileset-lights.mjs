#!/usr/bin/env node
// Regenerates data/tileset-lights.json (its default CLight: Lighting, else the tileset's own id) and
// data/tileset-sky.json (its skybox, hidden lowest level and fog), from Blizzard's TerrainData.xml as mirrored in
// github.com/SC2Mapster/SC2GameData. Later mods override earlier ones by id,
// and a tileset without its own field inherits its parent's. Each tileset's blend textures and cliff
// sets are the published catalog's extractors', in data/texture-extracted.json and
// data/cliff-extracted.json (npm run extract-catalog).
//
// Only the game's own tilesets: a Campaign Mod's are read from the Workspace's mod (ADR-0011,
// src/mods/campaign-catalog.ts), never copied here.
//
// Usage: node packages/core/scripts/build-tileset-lights.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://raw.githubusercontent.com/SC2Mapster/SC2GameData/master";
// Load order matches the dependency chain of a Legacy of the Void campaign map.
const SOURCES = [
  "mods/core.sc2mod/base.sc2data/GameData/TerrainData.xml",
  "mods/liberty.sc2mod/base.sc2data/GameData/TerrainData.xml",
  "campaigns/liberty.sc2campaign/base.sc2data/GameData/TerrainData.xml",
  "mods/swarm.sc2mod/base.sc2data/GameData/TerrainData.xml",
  "campaigns/swarm.sc2campaign/base.sc2data/GameData/TerrainData.xml",
  "mods/void.sc2mod/base.sc2data/GameData/TerrainData.xml",
];

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
const LIGHT_OUTPUT = path.join(DATA_DIR, "tileset-lights.json");

const SKY_OUTPUT = path.join(DATA_DIR, "tileset-sky.json");
/** CTerrain tag -> field, for data/tileset-sky.json (DL-14). */
const SKY_FIELDS = [
  ["FixedSkyboxModel", "skybox"],
  ["NonFixedSkyboxModel", "parallax"],
  ["HideLowestLevel", "hideLowestLevel"],
  ["FogEnabled", "fogEnabled"],
  ["FogColor", "fogColor"],
  ["FogDensity", "fogDensity"],
  ["FogFalloff", "fogFalloff"],
  ["FogStartingHeight", "fogStartingHeight"],
];

/** id -> { parent?, lighting?, isTemplate?, sky fields? } */
const tilesets = new Map();

async function load(source) {
  const response = await fetch(`${BASE}/${source}`);
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  return response.text();
}

for (const source of SOURCES) {
  const xml = await load(source);
  for (const match of xml.matchAll(/<CTerrain\b([^>]*?)(\/>|>([\s\S]*?)<\/CTerrain>)/g)) {
    const attrs = match[1];
    const body = match[3] ?? "";
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    if (!id) continue;
    const entry = tilesets.get(id) ?? {};
    const parent = /\bparent="([^"]+)"/.exec(attrs)?.[1];
    if (parent) entry.parent = parent;
    const lighting = /<Lighting value="([^"]*)"\/>/.exec(body)?.[1];
    if (lighting) entry.lighting = lighting;
    if (/\bdefault="1"/.test(attrs)) entry.isTemplate = true;
    for (const [tag, field] of SKY_FIELDS) {
      const value = new RegExp(`<${tag} value="([^"]*)"/>`).exec(body)?.[1];
      if (value !== undefined) entry[field] = value;
    }
    tilesets.set(id, entry);
  }
}

function resolve(id, field, seen = new Set()) {
  const entry = tilesets.get(id);
  if (!entry || seen.has(id)) return undefined;
  seen.add(id);
  return entry[field] ?? (entry.parent ? resolve(entry.parent, field, seen) : undefined);
}

// The core CTerrain template sets Lighting to "##id##", i.e. a CLight named like the tileset.
const lights = {};
for (const id of [...tilesets.keys()].sort()) {
  lights[id] = (resolve(id, "lighting") ?? "##id##").replaceAll("##id##", id);
}
await writeFile(LIGHT_OUTPUT, `${JSON.stringify(lights, null, 2)}\n`);
console.log(`Wrote ${Object.keys(lights).length} tilesets to ${path.relative(process.cwd(), LIGHT_OUTPUT)}`);

// Each field inherits on its own, as the Editor resolves a CTerrain's parent chain.
const sky = {};
for (const id of [...tilesets.keys()].sort()) {
  if (tilesets.get(id).isTemplate) continue;
  const entry = {};
  for (const [, field] of SKY_FIELDS) {
    const value = resolve(id, field);
    if (value !== undefined) entry[field] = value;
  }
  sky[id] = entry;
}
// One tileset per line keeps the file diffable without a line per field.
const skyLines = Object.entries(sky).map(([id, entry]) => `  ${JSON.stringify(id)}: ${JSON.stringify(entry)}`);
await writeFile(SKY_OUTPUT, `{\n${skyLines.join(",\n")}\n}\n`);
console.log(`Wrote ${skyLines.length} tilesets to ${path.relative(process.cwd(), SKY_OUTPUT)}`);
