#!/usr/bin/env node
// Regenerates data/trigger-libraries.json: what the Editor's Galaxy generation needs to know of
// the game's own trigger libraries, for writing a Campaign Mod's GUI library functions as Galaxy
// (src/mods/library-galaxy.ts). Read from the libraries' definitions in the install's CASC storage:
//
//   Ntve   mods/core.sc2mod/base.sc2data/triggerlibs/nativelib.triggerlib
//   Hots   mods/swarm.sc2mod/base.sc2data/triggerlibs/swarmlib.sc2lib
//
// and their names, hints and categories from each mod's TriggerStrings.txt (enus.sc2data/localizeddata),
// the Editor's names of the trigger types from core's EditorStrings.txt (EDSTR_TRIGGERTYPE_<type>).
//
// Per library, its name (Library/Name: Built-In, Swarm) and by element Id:
//   functions     identifier, flags (native, operator, inline …), parameters in definition order,
//                 return type, sub-function slots and the ScriptCode template, when it has one;
//                 its name, hint and category (the names of the categories it is filed under, from
//                 the outermost), as the Editor's function list shows them (src/mods/function-search.ts)
//   params        a ParamDef's identifier, type and name (#PARAM(<identifier>) in a template), and
//                 its default, the value a new call gives it, read as a mod library's is (library-xml.ts)
//   presetValues  a PresetValue's Galaxy value (lib<library>_ge_<type>_<value> for a generated constant) and name
//   presets       a Preset type's base type, whether its values are bits, its name and its values
//   subFunctions  a SubFuncType's identifier (#SUBFUNCS(<identifier>) in a template)
//   slots         a SubFuncType's name (If, Then, Else) and what it holds (action or condition)
//   defaultTexts  the words of each text a parameter's default holds, by the Id of the value holding
//                 it (Param/Value/lib_<library>_<id> in the mod's GameStrings.txt; "" for none)
// The names, defaults and values are the authoring tool's (src/triggers/author-trigger.ts).
// and `types`, the Editor's name of each trigger type (unitgroup: Unit Group).
//
// Usage: with a CASC extractor named in SC2_CASC_TOOL (tools/README.md),
//   node packages/core/scripts/build-trigger-libraries.mjs "/Applications/StarCraft II"
// or from a folder that already holds the game's data extracted (one with its mods folder, in any
// case), such as a game-data mirror:
//   node packages/core/scripts/build-trigger-libraries.mjs ~/sc2-game-data
// It needs the core package built (npm run build -w @team-antioch/sc2-adjutant) for its XML reader.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { pathInAnyCase } from "../dist/catalog/package-files.js";
import { defaultTextsOf } from "../dist/mods/library-reach.js";
import { mapElements, readLibraryParameterDefault, UnconvertibleFunctionError } from "../dist/mods/library-xml.js";
import { xmlTree } from "../dist/util/xml.js";
import { extractFromStorage, storageArgument, storagePath } from "./casc-tool.mjs";

const storage = storageArgument("build-trigger-libraries.mjs");

const SOURCES = {
  Ntve: "mods/core.sc2mod/base.sc2data/triggerlibs/nativelib.triggerlib",
  Hots: "mods/swarm.sc2mod/base.sc2data/triggerlibs/swarmlib.sc2lib",
};
const STRINGS = {
  Ntve: "mods/core.sc2mod/enus.sc2data/localizeddata/triggerstrings.txt",
  Hots: "mods/swarm.sc2mod/enus.sc2data/localizeddata/triggerstrings.txt",
};
const GAME_STRINGS = {
  Ntve: "mods/core.sc2mod/enus.sc2data/localizeddata/gamestrings.txt",
  Hots: "mods/swarm.sc2mod/enus.sc2data/localizeddata/gamestrings.txt",
};
const EDITOR_STRINGS = "mods/core.sc2mod/enus.sc2data/localizeddata/editor/editorstrings.txt";
const BUILD_ID = "mods/core.sc2mod/base.sc2data/buildid.txt";

// A folder of the game's data already extracted is read as it stands, each path in any case; else the install's storage is extracted.
const root = pathInAnyCase(storage, "mods")
  ? storage
  : await extractFromStorage(storage, [...Object.values(SOURCES), ...Object.values(STRINGS), ...Object.values(GAME_STRINGS), EDITOR_STRINGS, BUILD_ID].map((file) => `${storagePath(...file.split("/"))}$`), "triggerlibs");
const gameFile = (file) => {
  const at = pathInAnyCase(root, file);
  if (at === undefined) throw new Error(`${file} isn't in ${storage}`);
  return at;
};
/** A strings file's entries, by key. */
const stringTable = (text) => new Map(text.split(/\r?\n/).flatMap((line) => (line.includes("=") ? [[line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]] : [])));

const attr = (node, name) => node.attributes.find(([key]) => key === name)?.[1];
const child = (node, name) => node.children.find((c) => c.name === name);
const kids = (node, name) => node.children.filter((c) => c.name === name);
const ref = (node) => `${attr(node, "Library")}/${attr(node, "Id")}`;
/** A template's text without the XML's indentation: each line dedented by the least indent. */
function dedent(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines.at(-1).trim() === "") lines.pop();
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length));
  return lines.map((line) => line.slice(indent).trimEnd()).join("\n");
}
function typeOf(node) {
  if (!node) return undefined;
  const type = attr(child(node, "Type") ?? { attributes: [] }, "Value");
  const element = child(node, "TypeElement");
  const game = child(node, "GameType");
  return { type, ...(element ? { element: ref(element) } : {}), ...(game ? { gameType: attr(game, "Value") } : {}) };
}

const editorStrings = stringTable(await readFile(gameFile(EDITOR_STRINGS), "utf8"));
const types = Object.fromEntries([...editorStrings].flatMap(([key, name]) => (/^EDSTR_TRIGGERTYPE_[a-z]+$/.test(key) ? [[key.slice("EDSTR_TRIGGERTYPE_".length), name]] : [])));
const out = { build: (await readFile(gameFile(BUILD_ID), "utf8").catch(() => "")).trim() || undefined, types, libraries: {} };
for (const [library, file] of Object.entries(SOURCES)) {
  const xml = await readFile(gameFile(file), "utf8");
  const [data] = xmlTree(xml);
  const strings = stringTable(await readFile(gameFile(STRINGS[library]), "utf8"));
  // The library's elements, for reading a parameter's default as a Mod library's is read (library-xml.ts).
  const elements = mapElements(xml);
  const unreadDefaults = new Map();
  const text = (type, field, id) => strings.get(`${type}/${field}/lib_${library}_${id}`);
  // Each function's category: the names of the categories it is filed under, from Root's outward in.
  const categories = new Map(kids(data, "Element").flatMap((element) => (attr(element, "Type") === "Category" ? [[attr(element, "Id"), element]] : [])));
  const categoryOf = new Map();
  const fileIn = (holder, path) => {
    for (const item of kids(holder, "Item")) {
      if (attr(item, "Library") !== library) continue;
      const id = attr(item, "Id");
      if (attr(item, "Type") === "FunctionDef") categoryOf.set(id, path);
      if (attr(item, "Type") !== "Category") continue;
      const name = text("Category", "Name", id);
      if (categories.has(id)) fileIn(categories.get(id), name ? [...path, name] : path);
    }
  };
  const top = child(data, "Root");
  if (top) fileIn(top, []);
  const name = strings.get(`Library/Name/${library}`);
  const lib = { ...(name ? { name } : {}), functions: {}, params: {}, presetValues: {}, presets: {}, subFunctions: {} };
  for (const element of kids(data, "Element")) {
    const id = attr(element, "Id");
    const identifier = child(element, "Identifier")?.text.trim();
    switch (attr(element, "Type")) {
      case "FunctionDef": {
        const flags = element.children.filter((c) => c.name.startsWith("Flag")).map((c) => c.name.slice(4).charAt(0).toLowerCase() + c.name.slice(5));
        const script = child(element, "ScriptCode");
        const returns = typeOf(child(element, "ReturnType"));
        const subs = kids(element, "SubFunctionType").map(ref);
        const name = text("FunctionDef", "Name", id);
        const hint = text("FunctionDef", "Hint", id);
        const category = categoryOf.get(id);
        lib.functions[id] = {
          ...(name ? { name } : {}),
          ...(hint ? { hint } : {}),
          ...(category?.length ? { category: category.join(" > ") } : {}),
          ...(identifier ? { identifier } : {}),
          flags,
          params: kids(element, "Parameter").map((c) => attr(c, "Id")),
          ...(returns ? { returns } : {}),
          ...(subs.length ? { subFunctions: subs } : {}),
          ...(script ? { script: dedent(script.text) } : {}),
        };
        break;
      }
      case "ParamDef":
      {
        const name = text("ParamDef", "Name", id);
        // The value a new call gives it, which the authoring tool fills in; a form the reader doesn't read is left out, so the tool asks for a value.
        let defaultValue;
        try {
          defaultValue = readLibraryParameterDefault(elements, strings, library, id);
        } catch (error) {
          if (!(error instanceof UnconvertibleFunctionError)) throw error;
          unreadDefaults.set(error.reason, (unreadDefaults.get(error.reason) ?? 0) + 1);
        }
        lib.params[id] = { ...(identifier ? { identifier } : {}), ...typeOf(child(element, "ParameterType")), ...(name ? { name } : {}), ...(defaultValue ? { default: defaultValue } : {}) };
      }
        break;
      case "PresetValue": {
        // As it stands: the Editor writes it untrimmed (Protoss's toast style is "c_achievementToastStyleProtoss ").
        const value = child(element, "Value");
        const name = text("PresetValue", "Name", id);
        lib.presetValues[id] = { ...(identifier ? { identifier } : {}), ...(name ? { name } : {}), value: value ? value.text : "" };
        break;
      }
      case "Preset": {
        const base = child(element, "BaseType");
        const name = text("Preset", "Name", id);
        const values = kids(element, "Item").flatMap((item) => (attr(item, "Type") === "PresetValue" && attr(item, "Library") === library ? [attr(item, "Id")] : []));
        lib.presets[id] = { ...(identifier ? { identifier } : {}), ...(base ? { base: attr(base, "Value") } : {}), ...(child(element, "PresetAsBits") ? { bits: true } : {}), ...(name ? { name } : {}), ...(values.length ? { values } : {}) };
        break;
      }
      case "SubFuncType": {
        if (identifier) lib.subFunctions[id] = identifier;
        const name = text("SubFuncType", "Name", id);
        const holds = child(element, "Action") ? "action" : child(element, "Condition") ? "condition" : undefined;
        if (name) (lib.slots ??= {})[id] = { name, ...(holds ? { holds } : {}) };
        break;
      }
    }
  }
  // A preset type that generates constants names its values lib<library>_ge_<type>_<value> where they give no value of their own.
  for (const element of kids(data, "Element")) {
    if (attr(element, "Type") !== "Preset" || !child(element, "PresetGenConstVar")) continue;
    const type = child(element, "Identifier")?.text.trim();
    for (const item of kids(element, "Item")) {
      const value = lib.presetValues[attr(item, "Id")];
      if (type && value && value.value === "" && value.identifier) value.value = `lib${library}_ge_${type}_${value.identifier}`;
    }
  }
  // The words of the texts the defaults hold, which a call left to its default writes: an absent key is an empty text, as the Editor reads one.
  const gameStrings = stringTable(await readFile(gameFile(GAME_STRINGS[library]), "utf8"));
  const texts = defaultTextsOf(lib.params, (key) => gameStrings.get(key), library);
  if (Object.keys(texts).length > 0) lib.defaultTexts = texts;
  for (const [reason, count] of unreadDefaults) console.warn(`${library}: ${count} parameter default${count === 1 ? "" : "s"} left out: ${reason}`);
  out.libraries[library] = lib;
}

const target = fileURLToPath(new URL("../data/trigger-libraries.json", import.meta.url));
await writeFile(target, `${JSON.stringify(out)}\n`);
const count = (library) => Object.keys(out.libraries[library].functions).length;
console.log(`Wrote ${target}: ${Object.keys(SOURCES).map((library) => `${library} ${count(library)} functions`).join(", ")}`);
