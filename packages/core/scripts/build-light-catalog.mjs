#!/usr/bin/env node
// Regenerates data/light-catalog.json: every stock CLight from Blizzard's LightData.xml (as
// mirrored in github.com/SC2Mapster/SC2GameData), with its parents resolved, as a flat map of
// fields for its first time of day ("ToDInfoArray/0/AmbientColor", "ToDInfoArray/0/Param/HDRExposure",
// "ToDInfoArray/0/DirectionalLight/Key/Color", ...), plus a summary to choose from: ambient and key
// brightness and hue, exposure, its Editor group, and the package that defines it. Portrait and
// UI lights are left out: they light talking heads and menus, not maps.
//
// A mission retunes a light by copying these fields into a map-local CLight (src/map/write-lights.ts).
//
// Usage: node packages/core/scripts/build-light-catalog.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://raw.githubusercontent.com/SC2Mapster/SC2GameData/master";
// Load order of a Legacy of the Void campaign map's dependencies, then the story and Nova packages.
const PACKAGES = [
  "mods/core.sc2mod",
  "mods/liberty.sc2mod",
  "campaigns/liberty.sc2campaign",
  "mods/swarm.sc2mod",
  "campaigns/swarm.sc2campaign",
  "mods/void.sc2mod",
  "campaigns/void.sc2campaign",
  "mods/voidprologue.sc2mod",
  "campaigns/voidstory.sc2campaign",
  "mods/novastoryassets.sc2mod",
];
const OUTPUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/light-catalog.json");

/** Parses XML into { tag, attrs, children } nodes (enough for catalog files). */
function parse(xml) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  for (const match of xml.matchAll(/<(\/?)([A-Za-z_][\w.]*)([^>]*?)(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g)) {
    if (!match[2]) continue;
    const [, closing, tag, rest, selfClosing] = match;
    if (closing) {
      stack.pop();
      continue;
    }
    const attrs = Object.fromEntries([...rest.matchAll(/([\w:]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const node = { tag, attrs, children: [] };
    stack.at(-1).children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

/**
 * A light's own fields, flattened. An element's `index` names its slot; `<X value="v"/>` and an
 * attribute `X="v"` are the same field. An unindexed ToDInfoArray is the first time of day.
 */
function fieldsOf(node, prefix = "", into = {}) {
  for (const child of node.children) {
    const index = child.attrs.index ?? (child.tag === "ToDInfoArray" ? "0" : undefined);
    const key = `${prefix}${child.tag}${index !== undefined ? `/${index}` : ""}`;
    const { index: _index, value, removed: _removed, ...rest } = child.attrs;
    if (value !== undefined) into[key] = value;
    for (const [name, attr] of Object.entries(rest)) into[`${key}/${name}`] = attr;
    fieldsOf(child, `${key}/`, into);
  }
  return into;
}

/** id -> { parent, fields, package, default } as declared; later packages override field by field. */
const declared = new Map();
for (const pkg of PACKAGES) {
  const response = await fetch(`${BASE}/${pkg}/base.sc2data/GameData/LightData.xml`);
  if (!response.ok) throw new Error(`${pkg}: HTTP ${response.status}`);
  const catalog = parse(await response.text()).children.find((node) => node.tag === "Catalog");
  for (const node of catalog?.children ?? []) {
    if (node.tag !== "CLight" || !node.attrs.id) continue;
    const before = declared.get(node.attrs.id);
    declared.set(node.attrs.id, {
      parent: node.attrs.parent ?? before?.parent,
      isDefault: node.attrs.default === "1" || before?.isDefault === true,
      fields: { ...before?.fields, ...fieldsOf(node) },
      package: before?.package ?? pkg.split("/")[1].replace(/\.sc2(mod|campaign)$/, ""),
    });
  }
}

/** A light's fields with its parents' underneath. */
const resolved = new Map();
function resolve(id, seen = new Set()) {
  if (resolved.has(id)) return resolved.get(id);
  const light = declared.get(id);
  if (!light || seen.has(id)) return {};
  seen.add(id);
  const fields = { ...(light.parent ? resolve(light.parent, seen) : {}), ...light.fields };
  resolved.set(id, fields);
  return fields;
}

const rgb = (value) => (value ?? "0,0,0").split(",").map(Number);
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Hue in degrees and saturation 0-1 of an "r,g,b" colour. */
function hueOf([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (max === min) return { hue: 0, saturation };
  const d = max - min;
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: Math.round(((hue * 60) + 360) % 360), saturation: Math.round(saturation * 100) / 100 };
}
const round = (value) => Math.round(value * 1000) / 1000;

const lights = {};
for (const [id, light] of [...declared].sort(([a], [b]) => a.localeCompare(b))) {
  if (light.isDefault) continue;
  const all = resolve(id);
  // Keep the first time of day, plus the light's own non-ToD fields (EditorCategories, times).
  // Variations is an unindexed array, so flattening would merge its entries: leave it out.
  const fields = Object.fromEntries(
    Object.entries(all).filter(([key]) => (!key.startsWith("ToDInfoArray/") || key.startsWith("ToDInfoArray/0/")) && !key.includes("/Variations/")),
  );
  if (!Object.keys(fields).some((key) => key.startsWith("ToDInfoArray/0/"))) continue;
  if (/^LightGroup:(Portraits|UI)/.test(fields["EditorCategories"] ?? "")) continue;
  const ambient = rgb(fields["ToDInfoArray/0/AmbientColor"]);
  const key = rgb(fields["ToDInfoArray/0/DirectionalLight/Key/Color"]);
  const keyScale = Number(fields["ToDInfoArray/0/DirectionalLight/Key/ColorMultiplier"] ?? 1);
  const times = new Set(Object.keys(all).flatMap((k) => (k.startsWith("ToDInfoArray/") ? [k.split("/")[1]] : [])));
  lights[id] = {
    package: light.package,
    group: (fields["EditorCategories"] ?? "").replace(/^LightGroup:/, "") || undefined,
    ...(times.size > 1 ? { timesOfDay: times.size } : {}),
    summary: {
      ambient: { brightness: round(luminance(ambient)), ...hueOf(ambient) },
      key: { brightness: round(luminance(key) * keyScale), ...hueOf(key) },
      exposure: Number(fields["ToDInfoArray/0/Param/HDRExposure"] ?? 1),
    },
    fields,
  };
}
// One light per line, so a rebuild diffs by light.
const lines = Object.entries(lights).map(([id, light]) => `  ${JSON.stringify(id)}: ${JSON.stringify(light)}`);
await writeFile(OUTPUT, `{\n "source": "SC2GameData LightData.xml",\n "lights": {\n${lines.join(",\n")}\n }\n}\n`);
const groups = {};
for (const light of Object.values(lights)) groups[light.group ?? "(none)"] = (groups[light.group ?? "(none)"] ?? 0) + 1;
console.log(`Wrote ${Object.keys(lights).length} lights to ${OUTPUT}`, groups);
