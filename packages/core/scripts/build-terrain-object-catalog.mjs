#!/usr/bin/env node
// Regenerates data/terrain-object-catalog.json: every terrain object (CCliffDoodad in
// SC2GameData's TerrainObjectData.xml) with its Editor name (TerrainObject/Name from ObjectStrings,
// e.g. "Castanar Bridge Vertical Small", "Terrain Object Trench (Height 2)"), the package defining
// it, its model, tilesets and cliff set, and the cliff-level stamp it lays into the terrain.
//
// A terrain object is a model plus a grid of cliff levels: each HeightCodes row is a string of
// A–D (cliff level 0–3) or a space (left alone), NumCellsDown rows of them. Blizzard ships most
// in three copies, "(Height 1)" to "(Height 3)", the same model at a raised level. Maps place them
// in t3Terrain.xml's cliffDoodadList by id. Entries also list the doodads made from the same piece
// (Blizzard ships most as a doodad too, e.g. TerrainObjectTrench's TerrainObjectTrenchDoodad; their
// doodad-catalog pictures and descriptions show the look), the Exemplar Maps that place them (from the
// studies' cliffDoodads), and a sc2-mapping-reference gallery picture when one matches the name,
// else the repo path of its model's first WhiteoutFlakes thumbnail (`npm run thumbnails --
// --terrain-objects`; git-ignored, so without a manifest the previous catalog's paths are kept).
// Descriptions already in the catalog are kept, Doodad Uses and all; they're written by looking at the pictures.
//
// Usage, from the Workspace root (needs npm run build): node packages/core/scripts/build-terrain-object-catalog.mjs <sc2-mapping-reference/public/doodads>

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadWorkspace, stylePackFiles } from "../dist/plugins/workspace.js";
import { CORE_ROOT, workspaceRoot } from "./workspace-root.mjs";

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
const ROOT = CORE_ROOT;
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT = path.join(DATA_DIR, "terrain-object-catalog.json");
// The active Style Pack's Exemplar Maps folder, in the Workspace this is run from.
const { exemplarDir: STUDIES } = stylePackFiles(await loadWorkspace(workspaceRoot()));
if (!STUDIES) throw new Error("The Workspace's Style Pack lists no Exemplar Maps");
const THUMBNAILS = "data/thumbnails/terrain-objects";
const LEVELS = { A: 0, B: 1, C: 2, D: 3 };

const [galleryDir] = process.argv.slice(2);
if (!galleryDir) {
  console.error("Usage: build-terrain-object-catalog <sc2-mapping-reference/public/doodads>");
  process.exit(2);
}

const value = (body, tag) => new RegExp(`<${tag} value="([^"]*)"`).exec(body)?.[1];
const catalog = {};
const names = new Map();
for (const pkg of PACKAGES) {
  const data = await fetch(`${BASE}/${pkg}/base.sc2data/GameData/TerrainObjectData.xml`);
  if (data.ok) {
    for (const match of (await data.text()).matchAll(/<CCliffDoodad id="([^"]+)"[^>]*>([\s\S]*?)<\/CCliffDoodad>/g)) {
      const [, id, body] = match;
      const entry = catalog[id];
      if (entry) (entry.overriddenBy ??= []).push(pkg);
      else catalog[id] = { package: pkg };
      const fields = {
        model: value(body, "Model")?.replaceAll("\\", "/"),
        tileset: value(body, "TexSets"),
        cliffSet: value(body, "CliffSet"),
        footprint: value(body, "Footprint"),
        editorCategory: value(body, "EditorCategories"),
        across: value(body, "NumCellsAcross"),
        down: value(body, "NumCellsDown"),
      };
      for (const [key, field] of Object.entries(fields)) if (field !== undefined) catalog[id][key] = field;
      const rows = [...body.matchAll(/<HeightCodes value="([^"]*)"/g)].map((row) => row[1]);
      if (rows.length) catalog[id].heightCodes = rows;
    }
  }
  const strings = await fetch(`${BASE}/${pkg}/enus.sc2data/LocalizedData/ObjectStrings.txt`);
  if (strings.ok) for (const match of (await strings.text()).matchAll(/^TerrainObject\/Name\/([^=]+)=(.*)$/gm)) names.set(match[1], match[2].trim());
}

const doodadModels = JSON.parse(await readFile(path.join(DATA_DIR, "doodad-models.json"), "utf8"));
// A model's stem: its file name without TerrainObject/Doodad/TO, an Ex re-release or a variation
// number, so TerrainObjectTrench_01.m3 and TerrainObjectTrenchDoodad.m3 both read "trench".
const stem = (model) =>
  path
    .basename(model, ".m3")
    .toLowerCase()
    .replace(/terrainobject|doodad|^to|_?ex\d$|_\d\d$/g, "")
    .replace(/[^a-z0-9]/g, "");
const doodadsByStem = new Map();
for (const [id, model] of Object.entries(doodadModels)) doodadsByStem.set(stem(model), [...(doodadsByStem.get(stem(model)) ?? []), id]);
// Variation NN of a model whose doodads are lettered (TerrainObjectStarshipFloraPod_05 and
// TerrainObjectStarshipFloraPodDoodadF) is the NNth letter.
function doodadsFor(model) {
  const doodads = doodadsByStem.get(stem(model));
  const variation = /_(\d\d)\.m3$/.exec(model);
  const lettered = doodads?.filter((id) => /Doodad[A-Z]$/.test(id));
  if (!variation || !lettered?.length) return doodads;
  const letter = String.fromCharCode(65 + Number(variation[1]));
  return lettered.filter((id) => id.endsWith(letter));
}

const exemplarUse = new Map();
for (const dir of await readdir(STUDIES)) {
  const study = await readFile(path.join(STUDIES, dir, "study.json"), "utf8").catch(() => undefined);
  if (!study) continue;
  for (const { name, count } of JSON.parse(study).cliffs?.cliffDoodads ?? []) {
    exemplarUse.set(name, { ...exemplarUse.get(name), [dir]: count });
  }
}

const normalise = (text) => text.toLowerCase().replace(/^\([a-z]+\)_/, "").replace(/[^a-z0-9]/g, "");
const gallery = new Map();
for (const file of await readdir(galleryDir)) {
  if (!file.endsWith(".jpg") || file.endsWith("_tn.jpg")) continue;
  const key = normalise(file.replace(/\.jpg$/, "").replace(/terrain_?ob[a-z]*(_doodad)?/gi, ""));
  if (!gallery.has(key)) gallery.set(key, file);
}

const thumbnails = await readFile(path.join(ROOT, THUMBNAILS, "manifest.json"), "utf8").then(JSON.parse, () => null);
const previous = JSON.parse(await readFile(OUTPUT, "utf8").catch(() => "{}"));
const output = {};
let pictured = 0;
for (const [id, raw] of Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b))) {
  const name = names.get(id);
  const height = name && /\(Height (\d)\)\s*$/.exec(name);
  const family = name?.replace(/\s*\(Height \d\)\s*$/, "");
  const levels = [...new Set((raw.heightCodes ?? []).join("").replace(/ /g, ""))].map((code) => LEVELS[code]).sort();
  const entry = {
    ...(name && { name }),
    ...(height && { family, height: Number(height[1]) }),
    package: raw.package,
    ...(raw.overriddenBy && { overriddenBy: raw.overriddenBy }),
    model: raw.model,
    tileset: raw.tileset,
    cliffSet: raw.cliffSet,
    ...(raw.editorCategory && { editorCategory: raw.editorCategory }),
    ...(raw.footprint && { footprint: raw.footprint }),
    size: { across: Number(raw.across), down: Number(raw.down) },
    levels,
  };
  const doodads = raw.model && doodadsFor(raw.model);
  if (doodads?.length) entry.doodads = doodads;
  const candidates = [family, name, id, id.replace(/^(TerrainObject|TO)/, "").replace(/_?\d$/, "")].filter(Boolean);
  const image = candidates.map((text) => gallery.get(normalise(text.replace(/terrain ?object/gi, "")))).find(Boolean);
  if (image) {
    entry.image = image;
    pictured++;
  } else if (raw.model) {
    const thumbnail = `${THUMBNAILS}/${path.basename(raw.model, ".m3")}_00_a0.png`;
    if (thumbnails ? thumbnails[`${path.basename(raw.model, ".m3")}_00`]?.ok : previous[id]?.thumbnail === thumbnail) entry.thumbnail = thumbnail;
  }
  // Its reference sheet isn't named here: the search finds it where `npm run catalog-sheets` builds it.
  if (exemplarUse.has(id)) entry.exemplars = exemplarUse.get(id);
  // Its Doodad Uses aren't the catalog's: a terrain object's live only in a Workspace's doodad notes (sc2-asset-catalog holds doodads only).
  if (previous[id]?.description) {
    const { uses: _uses, ...description } = previous[id].description;
    entry.description = description;
  }
  entry.heightCodes = raw.heightCodes;
  output[id] = entry;
}
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
const placed = Object.values(output).filter((entry) => entry.exemplars).length;
const thumbnailed = Object.values(output).filter((entry) => entry.thumbnail).length;
console.log(`${Object.keys(output).length} terrain objects, ${pictured} with a gallery picture, ${thumbnailed} more with a thumbnail, ${placed} placed in Exemplar Maps -> ${path.relative(process.cwd(), OUTPUT)}`);
