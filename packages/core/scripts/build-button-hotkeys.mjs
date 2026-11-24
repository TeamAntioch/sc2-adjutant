#!/usr/bin/env node
// Regenerates data/button-hotkeys.json: what the compile's missing-hotkey check (#48,
// src/mods/button-hotkeys.ts) needs of the game's stock buttons.
//
//   keys     each Button/Hotkey/<name> key the enUS GameHotkeys.txt of the game's packages has a
//            line for, as <name>: the keys a mod's button can point its Hotkey at and have a hotkey
//   buttons  each stock CButton whose Hotkey isn't the class default's (Button/Hotkey/##id##),
//            with the key it has, its parent chain resolved: a mod's button parented on one
//            inherits it (stock BurrowMove has Button/Hotkey/BurrowDown)
//
// The packages are those of the engine's dependency chains (STOCK_PACKAGES in src/mods/effective-entry.ts).
// Read from the pinned mirror of the game's data, sc2-arcade-watcher/sc2-game-data at COMMIT, or from
// a local clone of it at that commit given as the first argument.
//
// Usage: node packages/core/scripts/build-button-hotkeys.mjs [<sc2-game-data clone>]

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CORE_ROOT } from "./workspace-root.mjs";

const REPOSITORY = "sc2-arcade-watcher/sc2-game-data";
const COMMIT = "7be894538d6eac77a9583acfeb5f721e273beee4";
const OUTPUT = path.join(CORE_ROOT, "data", "button-hotkeys.json");
const PACKAGES = [
  "mods/core.sc2mod",
  "mods/liberty.sc2mod",
  "campaigns/liberty.sc2campaign",
  "campaigns/libertystory.sc2campaign",
  "mods/swarm.sc2mod",
  "campaigns/swarm.sc2campaign",
  "campaigns/swarmstory.sc2campaign",
  "mods/void.sc2mod",
  "campaigns/void.sc2campaign",
  "campaigns/voidstory.sc2campaign",
  "mods/novastoryassets.sc2mod",
  "mods/voidprologue.sc2mod",
];
const KEY = "Button/Hotkey/";
const DEFAULT_HOTKEY = `${KEY}##id##`;

const local = process.argv[2];

/** A package's file, or "" when the package has none. */
async function read(pkg, file) {
  const relative = `${pkg}/${file}`;
  if (local) {
    const at = path.join(local, relative);
    return existsSync(at) ? readFile(at, "utf8") : "";
  }
  const response = await fetch(`https://raw.githubusercontent.com/${REPOSITORY}/${COMMIT}/${relative}`);
  if (response.status === 404) return "";
  if (!response.ok) throw new Error(`Fetching ${relative} failed: ${response.status} ${response.statusText}`);
  return response.text();
}

const keys = new Set();
/** id -> { parent?, hotkey? } as the packages define it, a later package's fields over an earlier one's. */
const buttons = new Map();

for (const pkg of PACKAGES) {
  for (const line of (await read(pkg, "enus.sc2data/LocalizedData/GameHotkeys.txt")).split(/\r?\n/)) {
    const key = line.replace(/^﻿/, "").split("=")[0].trim();
    if (key.startsWith(KEY) && key.length > KEY.length) keys.add(key.slice(KEY.length));
  }
  const xml = await read(pkg, "base.sc2data/GameData/ButtonData.xml");
  for (const [, attributes, body] of xml.matchAll(/<CButton\b([^>]*?)(?:\/>|>([\s\S]*?)<\/CButton>)/g)) {
    const id = /\bid="([^"]+)"/.exec(attributes)?.[1];
    if (!id) continue;
    const entry = buttons.get(id) ?? {};
    const parent = /\bparent="([^"]+)"/.exec(attributes)?.[1];
    if (parent) entry.parent = parent;
    const hotkey = /<Hotkey value="([^"]*)"\/>/.exec(body ?? "")?.[1];
    if (hotkey !== undefined) entry.hotkey = hotkey;
    buttons.set(id, entry);
  }
}

/** The Hotkey a stock button has, from itself or its nearest parent that gives one; undefined for the class default's. */
function hotkeyOf(id, seen = new Set()) {
  const entry = buttons.get(id);
  if (!entry || seen.has(id)) return undefined;
  seen.add(id);
  return entry.hotkey ?? (entry.parent ? hotkeyOf(entry.parent, seen) : undefined);
}

const overrides = {};
for (const id of [...buttons.keys()].sort()) {
  const hotkey = hotkeyOf(id);
  if (hotkey !== undefined && hotkey !== DEFAULT_HOTKEY) overrides[id] = hotkey;
}
const source = `${REPOSITORY} at ${COMMIT}: each package's enus.sc2data/LocalizedData/GameHotkeys.txt and base.sc2data/GameData/ButtonData.xml`;
// One key per line, so a new pin's diff reads.
await writeFile(OUTPUT, `${JSON.stringify({ source, keys: [...keys].sort(), buttons: overrides }, null, 1)}\n`);
console.log(`${keys.size} keys, ${Object.keys(overrides).length} buttons with their own Hotkey`);
console.log(`-> ${path.relative(process.cwd(), OUTPUT)}`);
