#!/usr/bin/env node
// Regenerates data/catalog-schema.json: the game's data schema, for checking a Mod Blueprint's
// generic catalog entries (src/mods/catalog-schema.ts). The game ships no machine-readable
// schema of its own (Blizzard's Unit.xml and the like, from which its headers are generated, stay
// in-house), so the schema is read from three things the install does ship, all in its CASC
// storage:
//
//   classes → catalog   mods/core.sc2mod/base.sc2data/triggerlibs/gamedata/<Catalog>.galaxy, the
//                       headers generated from each catalog's definition: EClassId<…> lists the
//                       catalog's classes (a catalog listing none, such as ActorSupport, takes the
//                       classes found in its <catalog>data.xml files)
//   field names         mods/core.sc2mod/enus.sc2data/localizeddata/editor/editorcatalogstrings.txt,
//                       the Editor's EDSTR_FIELDNAME_<Class>_<Field> for every field it shows,
//                       used or not, under the class that declares it
//   fields' shapes      every GameData catalog file in the storage (Blizzard's own entries, in
//                       every mod, campaign and map): the attributes and nested fields each field
//                       is written with, and the kind of value each attribute holds
//
// A class's fields are its own and those of the classes it extends: by its name (CAbilEffectTarget
// has CAbilEffect's and CAbil's) and by what it writes (a field only one other class declares).
// A field's shape is pooled over its catalog: one field name in one catalog is one structure. A
// nested field also takes the fields the Editor's strings name for its structures, shape unknown:
// S<X>, those naming most of its members, and the STRUCTURES table. Value kinds: number, asset (a file
// path), link:<Catalog> (an entry id of that catalog), string (anything else: enum names,
// vectors, text), any (seen only empty or as a token).
//
// Usage: with a CASC extractor named in SC2_CASC_TOOL (tools/README.md),
//   node packages/core/scripts/build-catalog-schema.mjs "/Applications/StarCraft II"
// It needs the core package built (pnpm --filter @team-antioch/sc2-adjutant run build) for its XML reader and the
// value rules the compile checks with.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NUMBER, token } from "../dist/mods/catalog-schema.js";
import { xmlTree } from "../dist/util/xml.js";
import { extractFromStorage, storageArgument, storagePath } from "./casc-tool.mjs";

// The storage's catalogs, the generated headers, the Editor's strings and the build id (about 125 MB).
const root = await extractFromStorage(
  storageArgument("build-catalog-schema.mjs"),
  [
    `${storagePath("gamedata")}[\\\\/].*\\.xml$`,
    `${storagePath("mods", "core.sc2mod", "base.sc2data", "triggerlibs", "gamedata")}[\\\\/]`,
    `${storagePath("mods", "core.sc2mod", "enus.sc2data", "localizeddata", "editor", "editorcatalogstrings.txt")}$`,
    `${storagePath("mods", "core.sc2mod", "base.sc2data", "buildid.txt")}$`,
  ],
  "gamedata",
);
const OUTPUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/catalog-schema.json");
const CORE = path.join(root, "mods/core.sc2mod");

// Classes per catalog, from the generated headers.
const headers = path.join(CORE, "base.sc2data/triggerlibs/gamedata");
const catalogs = new Map(); // catalog → Set of classes
for (const file of (await readdir(headers)).sort()) {
  const text = await readFile(path.join(headers, file), "utf8");
  const name = /^\/\/\s+(\w+)\.galaxy generated from \1\.xml/m.exec(text)?.[1];
  if (!name || name.startsWith("GameData")) continue;
  catalogs.set(name, new Set([...text.matchAll(/^const string c_classId\w+Name = "(\w+)";/gm)].map((match) => match[1])));
}
const catalogByFile = new Map([...catalogs.keys()].map((name) => [`${name.toLowerCase()}data.xml`, name]));

// Every catalog file in the storage.
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".xml") && full.includes(`${path.sep}gamedata${path.sep}`)) yield full;
  }
}
const files = [];
for await (const file of walk(root)) files.push(file);
files.sort();

const parsed = [];
for (const file of files) {
  let tree;
  try {
    tree = xmlTree(await readFile(file, "utf8"));
  } catch {
    console.warn(`skipped ${path.relative(root, file)}: not XML the reader takes`);
    continue;
  }
  const top = tree.find((node) => node.name === "Catalog");
  if (top) parsed.push({ file, entries: top.children });
}

// A catalog listing no classes takes the ones in its own files.
const classCatalog = new Map();
for (const [name, classes] of catalogs) for (const className of classes) classCatalog.set(className, name);
for (const { file, entries } of parsed) {
  const name = catalogByFile.get(path.basename(file).toLowerCase());
  if (!name || catalogs.get(name).size > 0) continue;
  for (const entry of entries) if (/^C[A-Z]/.test(entry.name) && !classCatalog.has(entry.name)) catalogs.get(name).add(entry.name);
}
for (const [name, classes] of catalogs) for (const className of classes) classCatalog.set(className, name);
for (const [name, classes] of catalogs) if (classes.size === 0) catalogs.delete(name);

// Entry ids per catalog, for telling links.
const ids = new Map([...catalogs.keys()].map((name) => [name, new Set()]));
for (const { entries } of parsed) {
  for (const entry of entries) {
    const name = classCatalog.get(entry.name);
    const id = entry.attributes.find(([key]) => key === "id")?.[1];
    if (name && id) ids.get(name).add(id);
  }
}

// Observed fields: per class, its top-level field names; per catalog, each field's shape.
const MAX_VALUES = 400;
const newShape = () => ({ attributes: new Map(), children: new Map(), text: undefined });
const shapes = new Map([...catalogs.keys()].map((name) => [name, new Map()]));
const classFields = new Map();
const unknownClasses = new Map();
const note = (values, value) => {
  if (values.size < MAX_VALUES) values.add(value);
};
function observe(shape, node) {
  for (const [key, value] of node.attributes) {
    if (!shape.attributes.has(key)) shape.attributes.set(key, new Set());
    note(shape.attributes.get(key), value);
  }
  if (node.text.trim() !== "") {
    shape.text ??= new Set();
    note(shape.text, node.text.trim());
  }
  for (const child of node.children) {
    if (!shape.children.has(child.name)) shape.children.set(child.name, newShape());
    observe(shape.children.get(child.name), child);
  }
}
for (const { entries } of parsed) {
  for (const entry of entries) {
    const name = classCatalog.get(entry.name);
    if (!name) {
      unknownClasses.set(entry.name, (unknownClasses.get(entry.name) ?? 0) + 1);
      continue;
    }
    if (!classFields.has(entry.name)) classFields.set(entry.name, new Set());
    const fields = shapes.get(name);
    for (const field of entry.children) {
      classFields.get(entry.name).add(field.name);
      if (!fields.has(field.name)) fields.set(field.name, newShape());
      observe(fields.get(field.name), field);
    }
  }
}

// The Editor's field names, under the class declaring them.
const strings = await readFile(path.join(CORE, "enus.sc2data/localizeddata/editor/editorcatalogstrings.txt"), "utf8");
const declared = new Map();
for (const match of strings.matchAll(/^EDSTR_FIELDNAME_([CS][A-Za-z0-9]+)_(\w+)=/gm)) {
  if (!declared.has(match[1])) declared.set(match[1], new Set());
  declared.get(match[1]).add(match[2]);
}

/** The classes whose names `className` extends, nearest first: CAbilEffectTarget → CAbilEffect, CAbil. */
const ancestors = (className) => {
  const words = className.slice(1).match(/[A-Z][a-z0-9]*|[A-Z]+(?![a-z])/g) ?? [];
  const out = [];
  for (let count = words.length - 1; count >= 1; count--) out.push(`C${words.slice(0, count).join("")}`);
  return out;
};

// Value kinds.
const ASSET = /[\\/][^\\/]*\.(m3|m3a|m3h|dds|tga|png|jpg|ogg|wav|mp3|fxa|ttf|otf|sc2bank|sc2layout|sc2cutscene|sc2style|txt|xml|wem|bnk)$/i;
function kind(values) {
  const real = [...values].filter((value) => !token(value));
  if (real.length === 0) return "any";
  if (real.every((value) => NUMBER.test(value))) return "number";
  if (real.every((value) => ASSET.test(value))) return "asset";
  if (real.length >= 3) {
    let best;
    for (const [name, set] of ids) {
      const hits = real.filter((value) => set.has(value)).length;
      if (hits / real.length >= 0.9 && (!best || hits > best.hits)) best = { name, hits };
    }
    if (best) return `link:${best.name}`;
  }
  return "string";
}
const sortedObject = (entries) => Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
// The Editor's structures, by name: S<Name> → its fields.
const structures = [...declared].filter(([name]) => name.startsWith("S"));
// Fields whose structure neither their name nor their members tell, since Blizzard writes only a
// Value in them, by catalog and field: their values are the Editor's location (TargetUnitOrPoint,
// CasterPoint …) or unit (Caster …) names, which SEffectWhichLocation's and SEffectWhichUnit's
// Value hold. GameUI's SoundData (a sound category's settings) holds SSoundData's fields and
// SSoundCategoryDefaults' (Blizzard writes Volume, MixerPriority, DupeFadeOut and other of its
// fields there), and the members rule below takes only the first. Top-level fields only.
const STRUCTURES = {
  "Validator.Target": ["SEffectWhichLocation"],
  "Validator.RequireCasterUnit": ["SEffectWhichUnit"],
  "Effect.RequireCasterUnit": ["SEffectWhichUnit"],
  "GameUI.SoundData": ["SSoundCategoryDefaults"],
};
const words = (name) => name.slice(1).match(/[A-Z][a-z0-9]*|[A-Z]+(?![a-z])/g) ?? [];
/** Whether the structures are one family: one, or all named alike for two words or more (SEffectWhichUnit, SEffectWhichLocation). */
const family = (names) => {
  const [first, ...rest] = names.map(words);
  let shared = first.length;
  for (const other of rest) {
    let same = 0;
    while (same < Math.min(shared, other.length) && other[same] === first[same]) same += 1;
    shared = same;
  }
  return rest.length === 0 || shared >= 2;
};
/**
 * The Editor's structures a field shaped `shape` (as Blizzard writes it) is, beyond S<name>: those
 * naming the most of its other members, when that's at least two and at least half of them, and
 * they're one family. CmdButtonArray's DefaultButtonFace, Requirements, State … are
 * SAbilCmdButton's; ImpactLocation's Effect and Value are each SEffectWhich… structure's.
 */
function structuresByMembers(name, shape) {
  const own = declared.get(`S${name}`) ?? new Set();
  const members = [...shape.attributes.keys(), ...[...shape.children].filter(([, child]) => child).map(([key]) => key)].filter((key) => key !== "index" && key !== "removed" && key !== "value" && !own.has(key));
  let best = 0;
  let tied = [];
  for (const [struct, fields] of structures) {
    const hits = members.filter((key) => fields.has(key)).length;
    if (hits > best) [best, tied] = [hits, [struct]];
    else if (hits === best) tied.push(struct);
  }
  return best >= 2 && best * 2 >= members.length && family(tied) ? tied : [];
}
// A nested field X takes the fields the Editor names for its structures: S<X> (Modification:
// SModification), the structures naming most of the members Blizzard writes it with, and the
// STRUCTURES above.
function addStructFields(name, shape, where) {
  for (const [child, nested] of [...shape.children]) if (nested) addStructFields(child, nested);
  const structs = [`S${name}`, ...structuresByMembers(name, shape), ...((where && STRUCTURES[`${where}.${name}`]) ?? [])];
  for (const struct of structs) for (const field of declared.get(struct) ?? []) if (!shape.attributes.has(field) && !shape.children.has(field)) shape.children.set(field, undefined);
}
function shapeJson(shape) {
  if (!shape) return { any: true };
  const out = {};
  if (shape.attributes.size) out.attributes = sortedObject([...shape.attributes].map(([key, values]) => [key, kind(values)]));
  if (shape.children.size) out.fields = sortedObject([...shape.children].map(([key, child]) => [key, shapeJson(child)]));
  if (shape.text) out.text = kind(shape.text);
  return out;
}

for (const [catalog, fields] of shapes) for (const [name, shape] of fields) if (shape) addStructFields(name, shape, catalog);

// The classes a class extends beyond its name's, as what it writes shows them: a class writing a
// field that only one other class of its catalog declares extends that one (CActorModel writes
// Host, which only CActorBearings declares). Not one whose name extends its own: that's its own field.
const owners = new Map(); // catalog → field → classes declaring it
for (const [className, name] of classCatalog) {
  if (!owners.has(name)) owners.set(name, new Map());
  for (const field of declared.get(className) ?? []) {
    const byField = owners.get(name);
    if (!byField.has(field)) byField.set(field, []);
    byField.get(field).push(className);
  }
}
const bases = (className) => {
  const out = new Set();
  for (const field of classFields.get(className) ?? []) {
    const declaring = owners.get(classCatalog.get(className))?.get(field) ?? [];
    if (declaring.length === 1 && declaring[0] !== className && !ancestors(declaring[0]).includes(className)) out.add(declaring[0]);
  }
  return out;
};
// A class's fields: what its entries write and the Editor declares for it, then the same of each
// class its name extends (CAbilEffectTarget: CAbilEffect, CAbil) and each class it extends by
// what it writes, and theirs in turn (CActorUnit writes CActorModel's Model; CActorModel writes
// CActorBearings' Host; so CActorUnit has CActorBearings' HostForProps).
// Only a top-level call's result is cached: inside a cycle, a class's fields leave out those of the
// classes on the path to it, so they're whole only once the call that began the walk returns.
const allFields = new Map();
function fieldsOf(className, seen = new Set()) {
  if (allFields.has(className)) return allFields.get(className);
  seen.add(className);
  const fields = new Set([...(classFields.get(className) ?? []), ...(declared.get(className) ?? [])]);
  const more = [...ancestors(className), ...bases(className)].filter((other) => !seen.has(other));
  for (const other of more) for (const field of fieldsOf(other, seen)) fields.add(field);
  seen.delete(className);
  if (seen.size === 0) allFields.set(className, fields);
  return fields;
}

const classes = {};
for (const [className, name] of [...classCatalog].sort(([a], [b]) => (a < b ? -1 : 1))) {
  if (!catalogs.has(name)) continue;
  classes[className] = { catalog: name, fields: [...fieldsOf(className)].sort() };
}
const out = {
  about: "The game's data schema for generic catalog entries, from the install's CASC storage by packages/core/scripts/build-catalog-schema.mjs (docs/reference/catalog-schema.md). Regenerate it, don't edit it.",
  build: (await readFile(path.join(CORE, "base.sc2data/buildid.txt"), "utf8").catch(() => "")).trim(),
  catalogs: {},
  classes,
};
for (const name of [...catalogs.keys()].sort()) {
  const fields = shapes.get(name);
  // Fields the Editor names but no Blizzard entry writes: known, shape unknown.
  for (const className of catalogs.get(name)) for (const field of classes[className]?.fields ?? []) if (!fields.has(field)) fields.set(field, undefined);
  out.catalogs[name] = {
    file: `${name}Data.xml`,
    classes: [...catalogs.get(name)].sort(),
    fields: sortedObject([...fields].map(([field, shape]) => [field, shape ? shapeJson(shape) : { any: true }])),
  };
}

await writeFile(OUTPUT, `${JSON.stringify(out)}\n`);
console.log(`${OUTPUT}: ${Object.keys(out.catalogs).length} catalogs, ${Object.keys(classes).length} classes, from ${parsed.length} catalog files (build ${out.build})`);
const skipped = [...unknownClasses].sort((a, b) => b[1] - a[1]);
if (skipped.length) console.log(`Root elements that aren't classes, skipped: ${skipped.map(([name, count]) => `${name} (${count})`).join(", ")}`);
