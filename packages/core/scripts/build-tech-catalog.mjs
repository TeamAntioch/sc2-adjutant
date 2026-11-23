#!/usr/bin/env node
// Regenerates data/tech-catalog.json: every stock unit (CUnit, structures included), upgrade
// (CUpgrade), behaviour (CBehavior*) and effect (CEffect*) id in SC2GameData's UnitData.xml,
// UpgradeData.xml, BehaviorData.xml and EffectData.xml, for a Mission Blueprint's `tech` field, a
// trigger scene's `unitChanges` and an effectStarts cue's effect to be checked against. Each unit records whether it flies (`Mover` Fly) and whether it's a
// structure (`Attributes` Structure), read through its `parent` chain; the layout checker's
// air-bypass note reads `flyer`. Template entries (`default="1"`) aren't units and are left out.
//
// Usage: node packages/core/scripts/build-tech-catalog.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { CORE_ROOT } from "./workspace-root.mjs";

const BASE = "https://raw.githubusercontent.com/SC2Mapster/SC2GameData/master";
// In load order; a later package's fields override an earlier one's.
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
const OUTPUT = path.join(CORE_ROOT, "data", "tech-catalog.json");

async function fetchData(pkg, file) {
  const response = await fetch(`${BASE}/${pkg}/base.sc2data/GameData/${file}`);
  return response.ok ? response.text() : "";
}

// Each entry's fields, merged in load order: id -> { parent, template, mover, structure }.
const units = new Map();
const upgrades = new Set();
const behaviors = new Set();
const effects = new Set();
for (const pkg of PACKAGES) {
  const unitXml = await fetchData(pkg, "UnitData.xml");
  // Self-closing entries carry no fields beyond their attributes.
  for (const match of unitXml.matchAll(/<CUnit\b([^>]*?)(\/>|>([\s\S]*?)<\/CUnit>)/g)) {
    const [, attributes, , body = ""] = match;
    const id = /\bid="([^"]+)"/.exec(attributes)?.[1];
    if (!id) continue;
    const entry = units.get(id) ?? {};
    const parent = /\bparent="([^"]+)"/.exec(attributes)?.[1];
    if (parent) entry.parent = parent;
    if (/\bdefault="1"/.test(attributes)) entry.template = true;
    const mover = /<Mover value="([^"]*)"/.exec(body)?.[1];
    if (mover !== undefined) entry.mover = mover;
    const structure = /<Attributes index="Structure" value="([01])"/.exec(body)?.[1];
    if (structure !== undefined) entry.structure = structure === "1";
    units.set(id, entry);
  }
  const upgradeXml = await fetchData(pkg, "UpgradeData.xml");
  for (const match of upgradeXml.matchAll(/<CUpgrade\b([^>]*?)\/?>/g)) {
    const id = /\bid="([^"]+)"/.exec(match[1])?.[1];
    if (id && !/\bdefault="1"/.test(match[1])) upgrades.add(id);
  }
  const behaviorXml = await fetchData(pkg, "BehaviorData.xml");
  for (const match of behaviorXml.matchAll(/<CBehavior\w*\b([^>]*?)\/?>/g)) {
    const id = /\bid="([^"]+)"/.exec(match[1])?.[1];
    if (id && !/\bdefault="1"/.test(match[1])) behaviors.add(id);
  }
  const effectXml = await fetchData(pkg, "EffectData.xml");
  for (const match of effectXml.matchAll(/<CEffect\w*\b([^>]*?)\/?>/g)) {
    const id = /\bid="([^"]+)"/.exec(match[1])?.[1];
    if (id && !/\bdefault="1"/.test(match[1])) effects.add(id);
  }
}

/** A field through the parent chain. */
function inherited(id, field, seen = new Set()) {
  const entry = units.get(id);
  if (!entry || seen.has(id)) return undefined;
  seen.add(id);
  return entry[field] ?? (entry.parent ? inherited(entry.parent, field, seen) : undefined);
}

const catalog = { units: {}, upgrades: [...upgrades].sort(), behaviors: [...behaviors].sort(), effects: [...effects].sort() };
for (const id of [...units.keys()].sort()) {
  if (units.get(id).template) continue;
  const facts = {};
  if (inherited(id, "mover") === "Fly") facts.flyer = true;
  if (inherited(id, "structure") === true) facts.structure = true;
  catalog.units[id] = facts;
}
await writeFile(OUTPUT, `${JSON.stringify(catalog, null, 1)}\n`);
console.log(`Wrote ${Object.keys(catalog.units).length} units, ${catalog.upgrades.length} upgrades, ${catalog.behaviors.length} behaviours and ${catalog.effects.length} effects to ${path.relative(process.cwd(), OUTPUT)}`);
