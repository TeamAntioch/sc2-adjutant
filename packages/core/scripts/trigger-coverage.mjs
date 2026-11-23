#!/usr/bin/env node
// Trigger coverage: how much Editor-saved trigger content the two Galaxy writers can write as the
// Editor does, and what stops the rest.
//
//   A map (a folder holding Triggers and MapScript.galaxy): each Kept Trigger and FunctionDef is
//   rendered by the Kept renderer (src/triggers/kept-trigger-galaxy.ts) from core's catalog and
//   compared with its MapScript.galaxy section (a disabled trigger, which has none, with its
//   absence). A compile-record.json beside the map package marks
//   the Compiled ones, which are skipped. Every call reachable from a Kept element is also counted
//   by where its definition is: core's catalog, the game's library data only, the map's own, or a
//   library the data doesn't hold.
//
//   A map's conversion: each Kept trigger is converted as convert_triggers would
//   (convertKeptTriggers, src/map/convert-mission-triggers.ts, writing nothing): read into a
//   Blueprint element, checked in reach, and written back to the Editor's Triggers XML and Galaxy,
//   or refused with why. A Mission's package (blueprint.json beside it, in a Workspace) is checked
//   against its record, holds, own triggers and the libraries its dependencies put in reach; any
//   other map against the game's libraries. The other Kept items are counted by kind, as not yet
//   convertible. Each trigger that converts is then written back through the authoring tool
//   (authoringRoundTrip, src/triggers/authoring-outline.ts): its outline in the tool's input, written
//   as a rewrite of it, compared with it; one that doesn't come back as it is is listed with the
//   value form the tool can't write.
//
//   A mod (a folder holding a Triggers with a <Library>): each library function is read
//   (src/mods/library-xml.ts) and written (src/mods/library-galaxy.ts) as the mod conversion
//   would, and compared with the Editor's Lib<id>.galaxy. An older Editor's save, which writes no
//   "// Automatic Variable Declarations" line, is first taken to the current Editor's forms
//   (asCurrentEditor), and a function that matches only then is counted apart.
//
// Usage, with the core package built (npm run build -w @team-antioch/sc2-adjutant):
//   node packages/core/scripts/trigger-coverage.mjs [--out <dir>] <package folder>...
// It prints the report as Markdown; --out also writes report.md and report.json there.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { convertKeptTriggers, enUSFirst, recordConversionContext } from "../dist/map/convert-mission-triggers.js";
import { difference } from "../dist/mods/equivalence.js";
import { librariesInReach } from "../dist/mods/library-reach.js";
import { authoringMapReach } from "../dist/map/write-blueprint-trigger.js";
import { authoringRoundTrip } from "../dist/triggers/authoring-outline.js";
import { libraryItems } from "../dist/triggers/splice-triggers.js";
import { workspaceModsFor } from "../dist/plugins/workspace.js";
import { readAuthoredTriggers } from "../dist/triggers/blueprint-triggers.js";
import { definitionIn, functionGalaxy, gameTriggerLibraries, UnrenderableGalaxyError } from "../dist/mods/library-galaxy.js";
import { elementIdOf, libraryElements, libraryStringKey, packageLibraryId, readLibraryFunction, stringTable, UnconvertibleFunctionError } from "../dist/mods/library-xml.js";
import { bindLibraryNames, KeptGalaxyRenderer, textValueKeys } from "../dist/triggers/kept-trigger-galaxy.js";
import { keptElementSpan } from "../dist/triggers/splice-map-script.js";
import { CORE_PRIMITIVES } from "../dist/triggers/trigger-catalog.js";
import { child, elementKey, readTriggersFile, referenced, refKey, triggerStringNames } from "../dist/triggers/triggers-file.js";
import { xmlAttribute } from "../dist/util/xml.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const gameData = JSON.parse(readFileSync(path.join(here, "../data/trigger-libraries.json"), "utf8"));
/** Each template's #INITAUTOVAR variable (For Each Integer's ae and ai, Repeat's n, Switch's val), for asCurrentEditor. */
const INIT_AUTOVARS = new Set(Object.values(gameData.libraries).flatMap((library) => Object.values(library.functions).flatMap((fn) => [...(fn.script ?? "").matchAll(/#INITAUTOVAR\((\w+)/g)].map((match) => match[1]))));
/** The Editor's names for the kinds of Triggers item that don't convert yet, for the conversion table. */
const KIND_NAMES = { FunctionDef: "function", Variable: "global variable", Category: "folder", Comment: "comment", CustomScript: "custom script", Preset: "preset", Structure: "record" };

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : undefined;
if (args.length === 0) {
  console.error("Usage: node packages/core/scripts/trigger-coverage.mjs [--out <dir>] <map or mod package folder>...");
  process.exit(1);
}

/** A file in a package, matched case-insensitively segment by segment (Blizzard's packages are lower case). */
function findFile(dir, rel) {
  let at = dir;
  for (const segment of rel.split("/")) {
    if (!existsSync(at) || !statSync(at).isDirectory()) return undefined;
    const hit = readdirSync(at).find((file) => file.toLowerCase() === segment.toLowerCase());
    if (!hit) return undefined;
    at = path.join(at, hit);
  }
  return at;
}
const read = (file) => (file && existsSync(file) ? readFileSync(file, "utf8") : "");
/**
 * The text values' keys that a package's GameStrings give text, in every locale: a text without
 * one is empty. Unknown when the package holds no GameStrings, as a copy of Blizzard's maps may not:
 * every text is then taken to hold some.
 */
function gameStringsTexts(dir) {
  const files = readdirSync(dir)
    .filter((file) => file.toLowerCase().endsWith(".sc2data"))
    .map((locale) => findFile(dir, `${locale}/LocalizedData/GameStrings.txt`))
    .filter((file) => file !== undefined);
  return files.length ? textValueKeys(files.map(read)) : undefined;
}
/** A reason with its ids and names taken out, so like reasons group. */
const normalized = (reason) =>
  reason.replace(/\b[0-9A-F]{8}\b/g, "<id>").replace(/"[^"]*"/g, '"…"').replace(/lib\w+_g[fvt]_\w+/g, "<name>").replace(/\s+/g, " ").slice(0, 160);
const gameFunction = (key) => {
  const [library, id] = key.split("/");
  return gameData.libraries[library]?.functions?.[id];
};
const describe = (key) => `${key} ${gameFunction(key)?.identifier ?? ""}`.trim();
const note = (map, key, item) => (map.get(key) ?? map.set(key, new Set()).get(key)).add(item);

const mapResults = [];
const modResults = [];
const unknownFunctions = new Map();
const soleBlocker = new Map();
const unknownPresets = new Map();
const unknownForms = new Map();
const mapDiffers = [];
const census = new Map();
const modReasons = new Map();
const modDiffers = [];
const conversionResults = [];
const conversionReasons = new Map();
const conversionRefusals = [];
const notYet = new Map();
const writeBackReasons = new Map();
const writeBackFailures = [];
const notYetConvertibleItems = [];

for (const dir of args.map((arg) => path.resolve(arg))) {
  const triggers = read(findFile(dir, "Triggers"));
  if (!triggers) {
    console.error(`${dir} has no Triggers; skipped`);
    continue;
  }
  const libraryId = packageLibraryId(triggers);
  if (libraryId && !findFile(dir, "MapScript.galaxy")) coverMod(dir, triggers, libraryId);
  else {
    coverMap(dir, triggers);
    await convertMap(dir, triggers);
  }
}

/**
 * Which of a map's Kept triggers convert into its Blueprint (convertKeptTriggers, as
 * convert_triggers would, writing nothing): each one read, checked in reach, and written back to the
 * Editor's Triggers XML and Galaxy, or refused with why. The other Kept items are counted by kind,
 * as not yet convertible. A Mission's package (a blueprint.json beside it, in a Workspace) is
 * checked against its record, holds, own triggers and the libraries its dependencies put in reach;
 * any other map against the game's libraries alone.
 */
async function convertMap(dir, triggers) {
  const label = path.basename(dir);
  const gameStrings = new Map();
  for (const locale of readdirSync(dir).filter((name) => /\.sc2data$/i.test(name) && name.toLowerCase() !== "base.sc2data").sort()) {
    const file = findFile(dir, `${locale}/LocalizedData/GameStrings.txt`);
    // Keyed as a Mission's package names it (enUS.SC2Data), which a converted trigger's strings name; Blizzard's are lower case.
    if (file) gameStrings.set(`${locale.slice(0, 2).toLowerCase()}${locale.slice(2, 4).toUpperCase()}.SC2Data/LocalizedData/GameStrings.txt`, read(file));
  }
  // As convert_triggers reads such a package, its every text value is empty, so a text's Galaxy differs from the Editor's.
  if (gameStrings.size === 0) console.error(`${dir} has no GameStrings: its text values convert as empty`);
  const files = { triggers, triggerStrings: read(findFile(dir, "enUS.SC2Data/LocalizedData/TriggerStrings.txt")), script: read(findFile(dir, "MapScript.galaxy")), gameStrings };
  const context = await missionContext(dir);
  const { converted, refused, notYetConvertible } = convertKeptTriggers(files, context);
  const others = {};
  for (const item of notYetConvertible) {
    const kind = KIND_NAMES[item.type] ?? item.type;
    others[kind] = (others[kind] ?? 0) + 1;
    // Keyed by Id too: two items of one map can share a name.
    note(notYet, kind, `${label}:${item.name} (${item.id})`);
    notYetConvertibleItems.push({ map: label, kind, ...item });
  }
  for (const item of refused) {
    note(conversionReasons, normalized(item.reason.replace(/\(and \d+ more/g, "(and N more")), `${label}:${item.trigger} (${item.id})`);
    conversionRefusals.push({ map: label, trigger: item.trigger, id: item.id, reason: item.reason });
  }
  // Each converted trigger written back through the authoring tool, among the map's Kept elements.
  const compiled = context.compiled ?? new Set();
  const kept = [...libraryItems(triggers)].filter(([key]) => !compiled.has(key)).map(([, item]) => item);
  const map = authoringMapReach({ triggers, triggerStrings: files.triggerStrings, gameStrings: enUSFirst(gameStrings) }, kept, { triggers: [], variables: context.authored?.variables ?? [] });
  let writtenBack = 0;
  for (const item of converted) {
    const { problems } = authoringRoundTrip(item.trigger, { libraries: context.libraries ?? gameTriggerLibraries(), map });
    if (problems.length === 0) {
      writtenBack++;
      continue;
    }
    // By form: each problem without its place.
    for (const problem of new Set(problems.map((each) => normalized(each.replace(/^.*?\): |^[^:(]*: /, ""))))) note(writeBackReasons, problem, `${label}:${item.name} (${item.id})`);
    writeBackFailures.push({ map: label, trigger: item.name, id: item.id, problems });
  }
  conversionResults.push({ label, reach: context.reach, triggers: converted.length + refused.length, converted: converted.length, writtenBack, refused: refused.length, notYetConvertible: notYetConvertible.length, others });
}

/** A Mission's conversion context, when `dir` is a Mission's Map Package in a Workspace; the game's libraries alone otherwise. */
async function missionContext(dir) {
  const blueprintPath = path.join(path.dirname(dir), "blueprint.json");
  const workspace = existsSync(blueprintPath) ? await workspaceModsFor(blueprintPath) : undefined;
  if (!workspace) return { reach: "the game's libraries" };
  const blueprint = JSON.parse(read(blueprintPath));
  const recordFile = path.join(path.dirname(dir), "compile-record.json");
  const entries = existsSync(recordFile) ? JSON.parse(read(recordFile)).entries : [];
  // The game's libraries and the Workspace mods' its dependencies load (librariesInReach). The Workspace's Plugins aren't loaded, so a
  // Campaign Mod the map doesn't load is simply out of reach, where convert_triggers (missionLibraries) says to add it to the dependencies.
  return {
    reach: "the Mission's",
    libraries: await librariesInReach(workspace, blueprint.dependencies ?? []),
    ...recordConversionContext(entries),
    authored: await readAuthoredTriggers(blueprint, blueprintPath),
  };
}

function coverMap(dir, triggersText) {
  const label = path.basename(dir);
  const script = read(findFile(dir, "MapScript.galaxy"));
  const names = triggerStringNames(read(findFile(dir, "enUS.SC2Data/LocalizedData/TriggerStrings.txt")));
  const texts = gameStringsTexts(dir);
  const compiled = new Set();
  const record = path.join(path.dirname(dir), "compile-record.json");
  if (existsSync(record)) for (const entry of JSON.parse(read(record)).entries) if (entry.kind === "trigger" || entry.kind === "function") compiled.add(String(entry.id));
  const file = readTriggersFile(triggersText);
  const result = { label, kept: 0, compiled: 0, matches: 0, differs: 0, uncatalogued: 0, errors: 0, noSection: 0 };
  for (const element of file.elements.values()) {
    if (element.type !== "Trigger" && element.type !== "FunctionDef") continue;
    if (compiled.has(element.id)) {
      result.compiled++;
      continue;
    }
    result.kept++;
    const tag = `${label}:${names.get(`${element.type}/${element.id}`) ?? element.id}`;
    countCalls(file, element);
    const renderer = new KeptGalaxyRenderer(file, names, CORE_PRIMITIVES, texts);
    let text;
    let galaxyName;
    try {
      text = element.type === "Trigger" ? renderer.renderTrigger(element.id) : renderer.renderFunction(element.id);
      galaxyName = element.type === "Trigger" ? renderer.triggerName(element.id) : renderer.functionName(element.id);
    } catch (error) {
      result.errors++;
      note(unknownForms, `error: ${normalized(error instanceof Error ? error.message : String(error))}`, tag);
      continue;
    }
    if (text === undefined) {
      result.uncatalogued++;
      for (const part of renderer.unknown) note(part.kind === "function" ? unknownFunctions : part.kind === "preset" ? unknownPresets : unknownForms, part.kind === "form" ? normalized(part.key) : part.key, tag);
      const functions = new Set(renderer.unknown.filter((part) => part.kind === "function").map((part) => part.key));
      if (functions.size === 1 && renderer.unknown.every((part) => part.kind === "function")) {
        const [only] = functions;
        soleBlocker.set(only, (soleBlocker.get(only) ?? 0) + 1);
      }
      continue;
    }
    const span = keptElementSpan(script, galaxyName);
    // A disabled trigger has no section, as the Editor writes it: none is a match.
    if (text === "" && !span) {
      result.matches++;
      continue;
    }
    if (!span) {
      result.noSection++;
      continue;
    }
    const saved = script.slice(span.start, span.end).replace(/\r?\n/g, "\r\n");
    if (bindLibraryNames(text, saved)) {
      result.matches++;
      continue;
    }
    result.differs++;
    const ours = text.split("\r\n");
    const theirs = saved.split("\r\n");
    const at = ours.findIndex((line, index) => theirs[index] === undefined || !bindLibraryNames(line, theirs[index]));
    const show = (line) => JSON.stringify((line ?? "").replace(/\u0001([^\u0001]+)\u0001/g, "<$1>")).slice(0, 120);
    mapDiffers.push(`${tag}: line ${at + 1}: the Editor's ${show(theirs[at])}, ours ${show(ours[at])}`);
  }
  mapResults.push(result);
}

/** Counts each call reachable from `element` by where its function is defined; an element is known by its type and Id, as an older map shares Ids across types. */
function countCalls(file, element, seen = new Set()) {
  const at = elementKey(element.type, element.id);
  if (seen.has(at)) return;
  seen.add(at);
  const ref = element.type === "FunctionCall" ? child(element, "FunctionDef") : undefined;
  if (ref) {
    const key = refKey(ref);
    const library = ref.attrs.Library;
    const kind = !library ? "the map's own" : CORE_PRIMITIVES.functions.has(key) ? "core catalog" : gameFunction(key) ? "game library data only" : gameData.libraries[library] ? "missing from its library's data" : `library not in the data (${library})`;
    const entry = census.get(key) ?? { kind, calls: 0 };
    entry.calls++;
    census.set(key, entry);
  }
  const walk = (nodes) => {
    for (const node of nodes) {
      const nested = ["FunctionCall", "Parameter", "Event", "Condition", "Action"].includes(node.tag) ? referenced(file, node) : undefined;
      if (nested) countCalls(file, nested, seen);
      walk(node.children);
    }
  };
  walk(element.children);
}

function coverMod(dir, xml, libraryId) {
  const label = path.basename(dir);
  const strings = stringTable(read(findFile(dir, "enUS.SC2Data/LocalizedData/TriggerStrings.txt")));
  const elements = libraryElements(xml, libraryId);
  const base = findFile(dir, "Base.SC2Data");
  const editorScript = read(base && findFile(base, `Lib${libraryId}.galaxy`));
  const result = { label, library: libraryId, functions: 0, native: 0, readRefused: 0, galaxyRefused: 0, matches: 0, matchesOlderEditor: 0, differs: 0, noEditorGalaxy: 0, disabled: 0 };
  const read_ = [];
  for (const node of elements.values()) {
    const id = elementIdOf(node);
    if (xmlAttribute(node, "Type") !== "FunctionDef") continue;
    result.functions++;
    try {
      read_.push(readLibraryFunction(elements, strings, libraryId, id));
    } catch (error) {
      if (!(error instanceof UnconvertibleFunctionError)) throw error;
      result.readRefused++;
      note(modReasons, `read: ${normalized(error.reason)}`, `${label}:${strings.get(libraryStringKey(libraryId, "FunctionDef", "Name", id)) ?? id}`);
    }
  }
  const scope = { library: libraryId, functions: new Map(read_.map((item) => [item.fn.id, item])), elements, strings, texts: gameStringsTexts(dir) };
  for (const { fn, body } of read_) {
    if (fn.flags.includes("native")) {
      result.native++;
      continue;
    }
    if (fn.disabled || !body) {
      result.disabled++;
      continue;
    }
    let galaxy;
    try {
      galaxy = functionGalaxy(scope, fn, body);
    } catch (error) {
      if (!(error instanceof UnrenderableGalaxyError)) throw error;
      result.galaxyRefused++;
      note(modReasons, `galaxy: ${normalized(error.reason)}`, `${label}:${fn.name}`);
      continue;
    }
    const kept = definitionIn(editorScript, galaxy.name);
    if (kept === undefined) {
      result.noEditorGalaxy++;
      continue;
    }
    const item = `galaxy:Lib${libraryId}.galaxy:${galaxy.name}`;
    const current = asCurrentEditor(kept, galaxy.definition);
    const found = difference(item, current, galaxy.definition);
    if (found === undefined) result[current === kept ? "matches" : "matchesOlderEditor"]++;
    else {
      result.differs++;
      modDiffers.push(`${label}:${fn.name}: ${normalized(found)}`);
    }
  }
  modResults.push(result);
}

/**
 * A function's Galaxy as an older Editor saved it (one that writes no "// Automatic Variable
 * Declarations" line: Nova's, Campaign Common's, Swarm Story Util's, Challenges') in the current
 * Editor's forms, which the generator writes (docs/reference/editor-trigger-rules.md, "An older
 * Editor's forms"), read against `ours`, the generator's; the current Editor's own Galaxy is
 * returned as it stands. The older forms:
 *   - the automatic variables declared first in the body, under no header, a blank line after them;
 *   - an #INITAUTOVAR given a literal (a For Each Integer's increment, a constant end) declared as
 *     a variable and set where its template stands, not declared const with its value;
 *   - a For Each Integer's test for a negative increment `<= 0`, not `< 0`;
 *   - Pick Each Unit In Unit Group counting up from 1 (`+= BoolToInt(…)`), not down from the end;
 *   - an If Then Else with no else actions written `else {` `}` where the current Editor writes a
 *     blank line. A Switch's empty default is `else {` `}` in both, so an empty else is taken for
 *     the older form only where `ours` has the blank line.
 */
function asCurrentEditor(galaxy, ours) {
  if (/\/\/ Automatic Variable Declarations/.test(galaxy)) return galaxy;
  const lines = galaxy.split(/\r?\n/);
  // The body is the last function's at the left margin (a thread's trigger function, after the one that runs it), after
  // the parameters it takes back from globals and their blank line.
  const opens = lines.findLastIndex((line) => /^\S.*\) \{$/.test(line)) + 1;
  let start = opens;
  while (/^ {4}\w+ lp_\w+ = auto_\w+;$/.test(lines[start] ?? "")) start++;
  if (start > opens && lines[start] === "") start++;
  const autos = [];
  while (/^ {4}\w+ auto[0-9A-F]{8}_\w+;$/.test(lines[start] ?? "")) autos.push(lines.splice(start, 1)[0]);
  if (autos.length && lines[start] === "") lines.splice(start, 1);
  let text = lines.join("\n");
  const declared = autos.map((line) => {
    const [, type, name] = /^ {4}(\w+) (\w+);$/.exec(line);
    const writes = [...text.matchAll(new RegExp(`\\b${name}\\s*[-+*/]?=(?!=)`, "g"))].length;
    const literal = new RegExp(`^ *${name} = (-?[0-9.]+);\\n`, "m").exec(text);
    // Only a template's #INITAUTOVAR variable (For Each Integer's ae and ai, Repeat's n, Switch's val) is declared const.
    if ((type !== "int" && type !== "fixed") || !INIT_AUTOVARS.has(name.slice(name.indexOf("_") + 1)) || writes !== 1 || !literal) return line;
    text = text.replace(literal[0], "");
    return `    const ${type} ${name} = ${literal[1]};`;
  });
  text = text
    .replace(/\((auto[0-9A-F]{8}_ai) <= 0 && /g, "($1 < 0 && ")
    .replace(
      /^( *)(auto[0-9A-F]{8}_u) = 1;\n\1for \( ; \2 <= UnitGroupCount\((auto[0-9A-F]{8}_g), c_unitCountAll\) ; \2 \+= BoolToInt\((\S+) == UnitGroupUnit\(\3, \2\)\) \) \{\n\1 {4}\4 = UnitGroupUnit\(\3, \2\);$/gm,
      "$1$2 = UnitGroupCount($3, c_unitCountAll);\n$1for (;; $2 -= 1) {\n$1    $4 = UnitGroupUnitFromEnd($3, $2);\n$1    if ($4 == null) { break; }",
    );
  const body = text.split("\n");
  const marks = ["    // Variable Initialization", "    // Implementation", "    // Deprecated"].map((mark) => body.indexOf(mark, start)).filter((index) => index >= 0);
  body.splice(marks.length ? Math.min(...marks) : body.lastIndexOf("}"), 0, "    // Automatic Variable Declarations", ...declared, ...(declared.length ? [""] : []));
  // Each empty else where ours has a blank line, the two read line by line together.
  const theirs = ours.split(/\r?\n/);
  const out = [];
  for (let at = 0; at < body.length; at++) {
    const open = /^( *)else \{$/.exec(body[at]);
    if (open && body[at + 1] === `${open[1]}}` && theirs[out.length] === "") {
      out.push("");
      at++;
    } else out.push(body[at]);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------- the report

const ranked = (map) => [...map].map(([key, items]) => ({ key, count: items.size, examples: [...items].slice(0, 4) })).sort((a, b) => b.count - a.count);
const kinds = new Map();
for (const { kind, calls } of census.values()) {
  const entry = kinds.get(kind) ?? { functions: 0, calls: 0 };
  entry.functions++;
  entry.calls += calls;
  kinds.set(kind, entry);
}
const report = {
  maps: mapResults,
  mods: modResults,
  calls: Object.fromEntries(kinds),
  uncataloguedFunctions: ranked(unknownFunctions).map((item) => ({ ...item, identifier: gameFunction(item.key)?.identifier, soleBlocker: soleBlocker.get(item.key) ?? 0 })),
  uncataloguedPresets: ranked(unknownPresets),
  forms: ranked(unknownForms),
  mapDiffers,
  modRefusals: ranked(modReasons),
  modDiffers,
  conversion: conversionResults,
  conversionReasons: ranked(conversionReasons),
  conversionRefusals,
  notYetConvertible: ranked(notYet),
  writeBackReasons: ranked(writeBackReasons),
  writeBackFailures,
  notYetConvertibleItems,
};

const percent = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : "–");
const lines = ["# Trigger coverage", ""];
if (mapResults.length) {
  lines.push("## Maps (Kept renderer, core's catalog)", "", "| map | Kept elements | match the Editor | differ | uncatalogued | error | no section |", "|---|---|---|---|---|---|---|");
  for (const r of mapResults) lines.push(`| ${r.label} | ${r.kept} (${r.compiled} Compiled skipped) | ${r.matches} (${percent(r.matches, r.kept)}) | ${r.differs} | ${r.uncatalogued} | ${r.errors} | ${r.noSection} |`);
  lines.push("", "### Calls reachable from Kept elements, by where their function is defined", "", "| defined in | functions | calls |", "|---|---|---|");
  for (const [kind, { functions, calls }] of [...kinds].sort((a, b) => b[1].calls - a[1].calls)) lines.push(`| ${kind} | ${functions} | ${calls} |`);
  lines.push("", "### Uncatalogued functions, by the Kept elements they block (top 40)", "", "| function | elements | the only blocker of |", "|---|---|---|");
  for (const item of report.uncataloguedFunctions.slice(0, 40)) lines.push(`| ${describe(item.key)} | ${item.count} | ${item.soleBlocker} |`);
  lines.push("", `Uncatalogued presets: ${report.uncataloguedPresets.length}. Forms the renderer doesn't read, and errors:`, "");
  for (const item of report.forms.slice(0, 20)) lines.push(`- ${item.count} × ${item.key}`);
  lines.push("", `### Renders that differ from the Editor's (${mapDiffers.length})`, "", ...mapDiffers.slice(0, 20).map((line) => `- ${line}`));
  const kindsSeen = [...new Set(conversionResults.flatMap((r) => Object.keys(r.others)))].sort((a, b) => report.notYetConvertible.findIndex((item) => item.key === a) - report.notYetConvertible.findIndex((item) => item.key === b));
  lines.push("", "## Conversion (Kept triggers into the Blueprint, convert_triggers)", "", `| map | checked against | Kept triggers | convert | written back by the tool | refused | not yet convertible |${kindsSeen.map((kind) => ` ${kind} |`).join("")}`, `|---|---|---|---|---|---|---|${kindsSeen.map(() => "---|").join("")}`);
  for (const r of conversionResults) lines.push(`| ${r.label} | ${r.reach} | ${r.triggers} | ${r.converted} (${percent(r.converted, r.triggers)}) | ${r.writtenBack} | ${r.refused} | ${r.notYetConvertible} |${kindsSeen.map((kind) => ` ${r.others[kind] ?? 0} |`).join("")}`);
  lines.push("", `### Converted triggers the authoring tool doesn't write back, by form (${writeBackFailures.length} triggers)`, "", ...(report.writeBackReasons.length ? report.writeBackReasons.slice(0, 30).map((item) => `- ${item.count} × ${item.key} (e.g. ${item.examples.slice(0, 3).join("; ")})`) : ["None."]));
  lines.push("", `### Refusals, by reason (${conversionRefusals.length} triggers; top 30)`, "", ...report.conversionReasons.slice(0, 30).map((item) => `- ${item.count} × ${item.key} (e.g. ${item.examples.slice(0, 3).join("; ")})`));
}
if (modResults.length) {
  lines.push("", "## Mods (library generator)", "", "| mod | library | functions | native | read refused | Galaxy refused | match the Editor | match but for an older Editor's forms | differ | no Editor Galaxy | disabled |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of modResults) lines.push(`| ${r.label} | ${r.library} | ${r.functions} | ${r.native} | ${r.readRefused} | ${r.galaxyRefused} | ${r.matches} | ${r.matchesOlderEditor} | ${r.differs} | ${r.noEditorGalaxy} | ${r.disabled} |`);
  lines.push("", "### Refusals (top 30)", "", ...report.modRefusals.slice(0, 30).map((item) => `- ${item.count} × ${item.key} (e.g. ${item.examples.slice(0, 2).join("; ")})`));
  lines.push("", `### Galaxy that differs from the Editor's (${modDiffers.length})`, "", ...modDiffers.slice(0, 20).map((line) => `- ${line}`));
}
const markdown = `${lines.join("\n")}\n`;
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "report.md"), markdown);
  writeFileSync(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(markdown);
