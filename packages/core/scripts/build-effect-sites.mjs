#!/usr/bin/env node
// Regenerates data/effect-sites.json: for each effect model the effect tour films (every
// Assets/Effects path in data/game-models.json), where the game attaches it, whether it is a
// missile and how many ribbons it has, and the attachment points of the tour's host model. The
// tour (src/capture/effect-tour.ts) attaches each effect at its site and moves missiles and
// ribbons fast. Only these derived facts are committed, none of Blizzard's files.
//
//   site      where the game's actors attach the model, the one most of its uses name: an actor's
//             HostSiteOps (CActorModel and the like), an action actor's ImpactSiteOps for its
//             ImpactMap models and LaunchSiteOps for its LaunchAssets (Ref_Origin on a tie), each resolved through the
//             actor's parents and read as Ref_Center, Ref_Weapon, Ref_Overhead, Ref_Head,
//             Ref_Hardpoint, Ref_Chest or Ref_Origin (a site op naming none of them). With no actor
//             use, a model whose CModel parents hold ImpactFX is taken to sit at Ref_Center and one
//             under LaunchFX at Ref_Weapon, marked `guessed`. null when nothing says.
//   missile   a CActorMissile names its CModel, or the CModel's parents hold MissileFX. A missile
//             is built round its own centre, which flies in the air.
//   ribbons   its RIB_ records (a ribbon is a trail drawn behind a moving emitter).
//   hosts     each host model's attachment points (ATT_) and how high each one is above its origin
//             in the bind pose (IREF), in cells.
//
// ModelData and ActorData are read in the order a Mission on Void Story loads them: the core and
// race mods, then the campaigns, later entries overriding earlier ones.
//
// Usage: with a CASC extractor named in SC2_CASC_TOOL (tools/README.md) and core built
// (pnpm --filter @team-antioch/sc2-adjutant run build):
//   node packages/core/scripts/build-effect-sites.mjs "/Applications/StarCraft II"

import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { readM3Attachments } from "../dist/catalog/m3-attachments.js";
import { m3Index } from "../dist/catalog/m3-sequences.js";
import { modelFile, modelVariations, readModelEntries } from "../dist/catalog/model-files.js";
import { xmlAttribute, xmlTree } from "../dist/util/xml.js";
import { extractFromStorage, storageArgument, storagePath } from "./casc-tool.mjs";
import { CORE_ROOT } from "./workspace-root.mjs";

const OUTPUT = path.join(CORE_ROOT, "data", "effect-sites.json");
const PACKAGES = ["mods/core.sc2mod", "mods/liberty.sc2mod", "mods/swarm.sc2mod", "mods/void.sc2mod", "campaigns/liberty.sc2campaign", "campaigns/swarm.sc2campaign", "campaigns/void.sc2campaign"];
/** The tour's hosts: their unit and model file. */
const HOSTS = { Marine: "Assets/Units/Terran/Marine/Marine.m3" };

const storage = storageArgument("build-effect-sites.mjs");
const gameData = (file) => PACKAGES.map((pkg) => `${storagePath(...pkg.split("/"), "base.sc2data", "gamedata", file)}$`);
const folder = await extractFromStorage(
  storage,
  [...gameData("modeldata.xml"), ...gameData("actordata.xml"), "assets[\\\\/]effects[\\\\/].*\\.m3$", ...Object.values(HOSTS).map((file) => `${storagePath(...file.split("/"))}$`)],
  "effect-sites",
);

const read = async (pkg, file) => {
  const full = path.join(folder, pkg, "base.sc2data", "gamedata", file);
  return existsSync(full) ? readFile(full, "utf8") : undefined;
};
const catalogs = async (file) => (await Promise.all(PACKAGES.map((pkg) => read(pkg, file)))).filter((xml) => xml !== undefined);

// Every model file below Assets/, by its storage path in lower case (the extractor lower-cases them).
const m3Files = new Map();
for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".m3")) continue;
  const full = path.join(entry.parentPath, entry.name);
  const at = full.replace(/\\/g, "/").lastIndexOf("/assets/");
  if (at >= 0) m3Files.set(full.replace(/\\/g, "/").slice(at + 1), full);
}

// --- Models: each CModel's files and its parents ---
const entries = readModelEntries(await catalogs("modeldata.xml"));
const filesOf = new Map();
for (const id of entries.keys()) {
  const file = modelFile(entries, id);
  if (!file || file.includes("##")) continue;
  const variations = modelVariations(entries, id);
  const files = variations > 1 ? Array.from({ length: variations }, (_, n) => file.replace(/\.m3$/i, `_${String(n).padStart(2, "0")}.m3`)) : [file];
  filesOf.set(id, files.map((each) => each.replace(/\\/g, "/").toLowerCase()));
}
const parents = (id) => {
  const out = [];
  for (let at = entries.get(id)?.parent; at && !out.includes(at); at = entries.get(at)?.parent) out.push(at);
  return out;
};

// --- Actors: their fields, through their parents ---
const actors = new Map();
for (const xml of await catalogs("actordata.xml")) {
  const catalog = xmlTree(xml).find((node) => node.name === "Catalog");
  for (const node of catalog?.children ?? []) {
    const id = xmlAttribute(node, "id");
    if (!node.name.startsWith("CActor") || !id) continue;
    const actor = actors.get(id) ?? { tag: node.name, parent: undefined, fields: {}, impacts: [], launches: [], unitName: undefined };
    actor.parent = xmlAttribute(node, "parent") ?? actor.parent;
    actor.unitName = xmlAttribute(node, "unitName") ?? actor.unitName;
    for (const child of node.children) {
      if (["Model", "HostSiteOps", "ImpactSiteOps", "LaunchSiteOps"].includes(child.name)) actor.fields[child.name] = xmlAttribute(child, "value") ?? xmlAttribute(child, "Ops") ?? "";
      const model = xmlAttribute(child, "Model");
      if (child.name === "ImpactMap" && model) actor.impacts.push(model);
      if (child.name === "LaunchAssets" && model) actor.launches.push(model);
    }
    actors.set(id, actor);
  }
}
const field = (id, name) => {
  for (let at = id, depth = 0; at && depth < 20; at = actors.get(at)?.parent, depth++) {
    const value = actors.get(at)?.fields[name];
    if (value !== undefined) return value;
  }
  return undefined;
};
const SITES = [
  [/Overhead/, "Ref_Overhead"],
  [/Head/, "Ref_Head"],
  [/Weapon/, "Ref_Weapon"],
  [/HardPoint/i, "Ref_Hardpoint"],
  [/Chest/, "Ref_Chest"],
  [/Center|Harness|Volume|RandomDamage|AttachTarget/, "Ref_Center"],
];
const siteOf = (ops) => SITES.find(([pattern]) => ops && pattern.test(ops))?.[1] ?? "Ref_Origin";

// How often each model file is attached at each site, and as a missile.
const uses = new Map();
const use = (id, site) => {
  for (const file of filesOf.get(id) ?? []) {
    const counts = uses.get(file) ?? {};
    counts[site] = (counts[site] ?? 0) + 1;
    uses.set(file, counts);
  }
};
const MODEL_ACTORS = new Set(["CActorModel", "CActorModelMissile", "CActorSplat", "CActorBeamSimple", "CActorBeamStandard", "CActorSiteMover"]);
for (const [id, actor] of actors) {
  if (MODEL_ACTORS.has(actor.tag)) {
    let model = field(id, "Model");
    if (!model || model.includes("##")) model = (model ?? "##id##").replace("##id##", id);
    if (!filesOf.has(model) && filesOf.has(id)) model = id;
    if (filesOf.has(model)) use(model, siteOf(field(id, "HostSiteOps")));
  }
  if (actor.tag === "CActorMissile") {
    const model = [field(id, "Model"), actor.unitName, id].find((each) => each && filesOf.has(each));
    if (model) use(model, "missile");
  }
  if (actor.tag === "CActorAction") {
    for (const model of actor.impacts) if (filesOf.has(model)) use(model, siteOf(field(id, "ImpactSiteOps")));
    for (const model of actor.launches) if (filesOf.has(model)) use(model, siteOf(field(id, "LaunchSiteOps")));
  }
}
// Each model file's CModel parents, over every CModel naming it.
const parentsOf = new Map();
for (const [id, files] of filesOf) for (const file of files) parentsOf.set(file, new Set([...(parentsOf.get(file) ?? []), ...parents(id)]));

// --- The tour's effects ---
const gameModels = JSON.parse(await readFile(path.join(CORE_ROOT, "data", "game-models.json"), "utf8"));
const effects = {};
let missing = 0;
for (const file of gameModels) {
  const key = file.toLowerCase();
  if (!key.startsWith("assets/effects/") || key.startsWith("assets/effects/glaze/")) continue;
  const counts = uses.get(key) ?? {};
  const kinds = parentsOf.get(key) ?? new Set();
  const placed = Object.entries(counts).filter(([site]) => site !== "missile").sort((a, b) => b[1] - a[1] || (a[0] === "Ref_Origin" ? -1 : b[0] === "Ref_Origin" ? 1 : a[0].localeCompare(b[0])));
  const missile = counts.missile > 0 || kinds.has("MissileFX");
  const guess = kinds.has("ImpactFX") ? "Ref_Center" : kinds.has("LaunchFX") ? "Ref_Weapon" : null;
  const m3 = m3Files.get(key);
  // Not in the install, so the tour can't film it either.
  if (!m3) {
    missing++;
    continue;
  }
  const ribbons = m3Index(new Uint8Array(await readFile(m3))).entries.find((entry) => entry.tag === "_BIR")?.count ?? 0;
  effects[file] = { site: placed[0]?.[0] ?? guess, ...(placed.length === 0 && guess ? { guessed: true } : {}), ...(missile ? { missile: true } : {}), ...(ribbons ? { ribbons } : {}) };
}

const hosts = {};
for (const [unit, file] of Object.entries(HOSTS)) {
  const m3 = m3Files.get(file.toLowerCase());
  if (!m3) throw new Error(`${file} wasn't extracted from ${storage}`);
  const sites = Object.fromEntries(readM3Attachments(new Uint8Array(await readFile(m3))).map((point) => [point.name, Math.round(point.position[2] * 100) / 100]));
  hosts[unit] = { model: file, sites };
}

const lines = Object.entries(effects).map(([file, facts]) => `  ${JSON.stringify(file)}: ${JSON.stringify(facts)}`);
await writeFile(OUTPUT, `{\n "hosts": ${JSON.stringify(hosts)},\n "effects": {\n${lines.join(",\n")}\n }\n}\n`);
const tally = {};
for (const facts of Object.values(effects)) {
  const key = facts.missile ? "missile" : `${facts.site ?? "unknown"}${facts.guessed ? "?" : ""}`;
  tally[key] = (tally[key] ?? 0) + 1;
}
console.log(`${lines.length} effects (${missing} more that game-models.json names aren't in the install) -> ${path.relative(process.cwd(), OUTPUT)}`);
console.log(Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([key, n]) => `${key} ${n}`).join(", "));
console.log(`${Object.values(effects).filter((facts) => facts.ribbons).length} with ribbons, ${Object.values(effects).filter((facts) => facts.ribbons && facts.missile).length} of them missiles`);
