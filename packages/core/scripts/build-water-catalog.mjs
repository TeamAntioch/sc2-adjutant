#!/usr/bin/env node
// Regenerates data/water-types.json: every stock CWater (water and lava types) with its default
// state's fields, parents resolved, from Blizzard's WaterData.xml as mirrored in
// github.com/SC2Mapster/SC2GameData. A mission's pool copies one (DL-13).
//
// Usage: node packages/core/scripts/build-water-catalog.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://raw.githubusercontent.com/SC2Mapster/SC2GameData/master";
// Load order matches the dependency chain of a Legacy of the Void campaign map.
const PACKAGES = [
  "mods/core.sc2mod",
  "mods/liberty.sc2mod",
  "campaigns/liberty.sc2campaign",
  "mods/swarm.sc2mod",
  "campaigns/swarm.sc2campaign",
  "mods/void.sc2mod",
  "campaigns/void.sc2campaign",
];
const OUTPUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/water-types.json");

/** id -> { package, parent?, state: { field: value } } */
const types = new Map();
const template = { state: {} };

/** A state's fields, from child elements (`<Height value="9"/>`) or attributes (`Height="9"`). */
function stateFields(attrs, body) {
  const fields = {};
  for (const [, name, value] of attrs.matchAll(/\b(\w+)="([^"]*)"/g)) if (name !== "index") fields[name] = value;
  for (const [, name, value] of body.matchAll(/<(\w+) value="([^"]*)"\/>/g)) fields[name] = value;
  return fields;
}

for (const pkg of PACKAGES) {
  const response = await fetch(`${BASE}/${pkg}/base.sc2data/GameData/WaterData.xml`);
  if (!response.ok) continue;
  const xml = await response.text();
  for (const match of xml.matchAll(/<CWater\b([^>]*?)(\/>|>([\s\S]*?)<\/CWater>)/g)) {
    const attrs = match[1];
    const body = match[3] ?? "";
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    const isTemplate = /\bdefault="1"/.test(attrs);
    if (!id && !isTemplate) continue;
    const entry = isTemplate ? template : (types.get(id) ?? { package: pkg.split("/")[1], state: {} });
    const parent = /\bparent="([^"]+)"/.exec(attrs)?.[1];
    if (parent) entry.parent = parent;
    // The default state: index 0, or the first State without an index.
    const state = /<State\b([^>]*?)(?:\/>|>([\s\S]*?)<\/State>)/.exec(body);
    if (state && !/index="[1-9]/.test(state[1])) Object.assign(entry.state, stateFields(state[1], state[2] ?? ""));
    if (!isTemplate) types.set(id, entry);
  }
}

// A type without its own state (Agria, Avernus) takes the template's, from core's <CWater default="1">.
function resolveState(id, seen = new Set()) {
  const entry = types.get(id);
  if (!entry || seen.has(id)) return { ...template.state };
  seen.add(id);
  return { ...(entry.parent ? resolveState(entry.parent, seen) : template.state), ...entry.state };
}

const lines = [...types.keys()]
  .sort()
  .map((id) => {
    const { package: pkg, parent } = types.get(id);
    return `  ${JSON.stringify(id)}: ${JSON.stringify({ package: pkg, ...(parent ? { parent } : {}), state: resolveState(id) })}`;
  });
await writeFile(OUTPUT, `{\n${lines.join(",\n")}\n}\n`);
console.log(`Wrote ${lines.length} water types to ${path.relative(process.cwd(), OUTPUT)}`);
