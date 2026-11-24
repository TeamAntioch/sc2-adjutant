// The convert step for a Mission's Kept triggers (ADR-0026): it reads chosen Kept triggers of the
// Map Package into the Mission Blueprint's own trigger elements, one file each in `triggers/`,
// keeping their element Ids, names and text values' words. A trigger stays where the package files
// it: a Kept folder keeps filing it, and the compile writes it in place of the Kept one, its Root
// line and elements where the Editor had them. The next compile writes each over the Kept original
// under the Equivalence Check (its Triggers XML and Galaxy compared with the Editor's), which moves
// it from Kept to Compiled.
//
// A trigger converts only when it can be read back as it is and written as the Editor writes it,
// and everything it names is in reach: a library's function in the library data in reach of the
// map, a bare Id among the package's Kept elements or the Blueprint's. Custom script, in a call or a
// value, is kept as data. One that can't convert stays Kept, with why.
//
// Kept References and holds keep working on a converted trigger: they name it by its element Id
// and Galaxy name, which it keeps.
//
// convertKeptTriggers is the pure part, over the package's files as text: the coverage script
// (scripts/trigger-coverage.mjs) runs it over maps with no Workspace around them.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { type BlueprintComment, type BlueprintElement, BlueprintFolderItem, type BlueprintFunction, type BlueprintTriggerFolder, BlueprintTriggerFolderSchema, BlueprintFunctionSchema, BlueprintTriggerSchema, type BlueprintTrigger } from "../domain/blueprint-trigger.js";
import { type GuiCall, type GuiStatement, type GuiVariable, heldIds, isComment, LIBRARY_ITEM_TYPES, MAP_GUI } from "../domain/library-interface.js";
import { type GameLibrary, gameTriggerLibraries } from "../mods/library-galaxy.js";
import { difference } from "../mods/equivalence.js";
import { ElementWriter, mapElements, readMapComment, readMapItem, readMapFunctionWhole, readMapGlobal, readMapTrigger, stringTable, UnconvertibleFunctionError } from "../mods/library-xml.js";
import { type Workspace, parseMissionBlueprint } from "../plugins/workspace.js";
import { type AuthoredFunction, type AuthoredTrigger, type AuthoredTriggers, blueprintElementFile, blueprintFunctionIds, blueprintFunctionOf, blueprintFunctionXml, blueprintReferenceProblems, blueprintTriggerIds, blueprintTriggerXml, folderXml, functionDeclaration, readAuthoredTriggers, unknownParts } from "../triggers/blueprint-triggers.js";
import { KeptGalaxyRenderer, textValueKeys } from "../triggers/kept-trigger-galaxy.js";
import { blockText, keptElementSpan } from "../triggers/splice-map-script.js";
import { libraryItems, recordedItemKeys } from "../triggers/splice-triggers.js";
import { CORE_PRIMITIVES } from "../triggers/trigger-catalog.js";
import { elementKey, readTriggersFile, triggerStringNames } from "../triggers/triggers-file.js";
import { TRIGGER_STRINGS } from "./editor-changes.js";
import { missionLibraries } from "./compile-mission.js";
import { missionMapPackage, readCompileRecord } from "./mission-package.js";

export type ConvertMissionTriggersOptions = {
  /** The Kept triggers and functions to convert, each by its name or element Id; every Kept one that can convert when not given. */
  readonly triggers?: readonly string[];
  /** The libraries in reach of the map; the game's and the Workspace mods' its dependencies load when not given. */
  readonly libraries?: Readonly<Record<string, GameLibrary>>;
};

/** The kinds of Kept element a Mission's conversion reads into its Blueprint. */
export type ConvertedKind = "trigger" | "function" | "global" | "comment" | "folder";

export type ConvertedMissionTriggers = {
  /** Each element converted, globals and functions first, each in the package's order: its kind, name, element Id and file (relative to the Blueprint; a global's is the Blueprint itself, its triggerVariables). */
  readonly converted: readonly { readonly kind: ConvertedKind; readonly name: string; readonly id: string; readonly file: string }[];
  /** Each one left Kept, with why. */
  readonly refused: readonly { readonly kind: ConvertedKind; readonly element: string; readonly reason: string }[];
};

/** A Map Package's trigger files as text: Triggers, the enUS TriggerStrings, MapScript.galaxy, and each locale's GameStrings by its path inside the package. */
export type KeptPackageFiles = {
  readonly triggers: string;
  readonly triggerStrings: string;
  readonly script: string;
  readonly gameStrings: ReadonlyMap<string, string>;
};

/** What a conversion is checked against, beside the package's files. */
export type KeptConversionContext = {
  /** The Kept triggers to convert, each by its name or element Id; every Kept one when not given. */
  readonly triggers?: readonly string[];
  /** The libraries in reach of the map; the game's when not given. */
  readonly libraries?: Readonly<Record<string, GameLibrary>>;
  /** The items the last compile wrote, by element key (`<type>/<id>`, as recordedItemKeys gives them), which aren't Kept. */
  readonly compiled?: ReadonlySet<string>;
  /** The Kept triggers a hold switched a call off in (the record's kept-hold Ids). */
  readonly held?: ReadonlySet<string>;
  /** The Blueprint's own trigger elements. */
  readonly authored?: AuthoredTriggers;
  /** Whether a file (relative to the Blueprint) is taken already, so a converted trigger is given another. */
  readonly fileTaken?: (file: string) => boolean;
};

/** Which Kept triggers and functions convert, as convertMissionTriggers would write them, and what stays Kept. */
export type KeptTriggerConversion = {
  /** Each trigger that converts, in the package's order: its name, element Id, the file it would be written to, and its Blueprint element. */
  readonly converted: readonly { readonly name: string; readonly id: string; readonly file: string; readonly trigger: BlueprintTrigger }[];
  /** Each one left Kept, with why. */
  readonly refused: readonly { readonly trigger: string; readonly id: string; readonly reason: string }[];
  /** The map's functions, as its triggers are: each that converts, and each left Kept with why. */
  readonly functions: {
    readonly converted: readonly { readonly name: string; readonly id: string; readonly file: string; readonly fn: BlueprintFunction }[];
    readonly refused: readonly { readonly function: string; readonly id: string; readonly reason: string }[];
  };
  /** The map's globals, each that converts into the Blueprint's triggerVariables, and each left Kept with why. */
  readonly globals: {
    readonly converted: readonly { readonly name: string; readonly id: string; readonly variable: GuiVariable }[];
    readonly refused: readonly { readonly global: string; readonly id: string; readonly reason: string }[];
  };
  /** The comments filed in Root or a folder, each that converts and each left Kept with why. */
  readonly comments: {
    readonly converted: readonly { readonly name: string; readonly id: string; readonly file: string; readonly comment: BlueprintComment }[];
    readonly refused: readonly { readonly comment: string; readonly id: string; readonly reason: string }[];
  };
  /** The map's Trigger Folders, each that converts into the Blueprint's triggerFolders (filing what it did, Kept or converted), and each left Kept with why. */
  readonly folders: {
    readonly converted: readonly { readonly name: string; readonly id: string; readonly folder: BlueprintTriggerFolder }[];
    readonly refused: readonly { readonly folder: string; readonly id: string; readonly reason: string }[];
  };
  /** Each Kept item of a kind that doesn't convert yet (a preset, a record, …): its type in Triggers, Id and name. Listed only when nothing was asked for. */
  readonly notYetConvertible: readonly { readonly type: string; readonly id: string; readonly name: string }[];
};

/** A converted trigger's file name: its name in lower case, words joined by hyphens, as a Blueprint's files are. */
export const fileSlug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "trigger";

/** The package's GameStrings files, each locale's, by path inside the package. */
export async function gameStringsFiles(pkg: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!existsSync(pkg)) return out;
  for (const locale of (await readdir(pkg)).filter((name) => name.endsWith(".SC2Data") && name !== "Base.SC2Data").sort()) {
    const file = `${locale}/LocalizedData/GameStrings.txt`;
    const full = path.join(pkg, ...file.split("/"));
    if (existsSync(full)) out.set(file, await readFile(full, "utf8"));
  }
  return out;
}

/** Each locale's GameStrings' text (as gameStringsFiles gives them), enUS first: the locale the authoring tool reads a Kept function's text defaults from. */
export const enUSFirst = (files: ReadonlyMap<string, string>): string[] => [...files].sort(([a], [b]) => Number(b.startsWith("enUS")) - Number(a.startsWith("enUS"))).map(([, text]) => text);

const NO_AUTHORED: AuthoredTriggers = { triggers: [], folders: [] };

/** What a Mission's compile record gives a conversion: the items the last compile wrote, and the Kept triggers a hold switched a call off in. */
export const recordConversionContext = (entries: Parameters<typeof recordedItemKeys>[0]): Pick<KeptConversionContext, "compiled" | "held"> => ({
  compiled: recordedItemKeys(entries),
  held: new Set(entries.flatMap((entry) => (entry.kind === "kept-hold" ? [entry.id] : []))),
});

/**
 * Which of the package's Kept triggers convert into Blueprint elements, each read and checked as
 * above, writing nothing: each one that would, and each one left Kept with why. The Kept items of
 * the kinds that don't convert yet are listed apart.
 */
export function convertKeptTriggers(
  { triggers: xml, triggerStrings, script, gameStrings }: KeptPackageFiles,
  { triggers: asked, libraries = gameTriggerLibraries(), compiled = new Set(), held = new Set(), authored = NO_AUTHORED, fileTaken = () => false }: KeptConversionContext = {},
): KeptTriggerConversion {
  const strings = stringTable(triggerStrings);
  const authoredFunctions = authored.functions ?? [];

  // The Kept items, in the package's order: every one filed in Root or a folder that no compile wrote and the Blueprint doesn't hold.
  const authoredGlobals = authored.variables ?? [];
  const authoredComments = authored.comments ?? [];
  const inBlueprint = [
    ...authored.triggers.map(({ file, trigger }) => ({ type: "Trigger", file, id: trigger.id, name: trigger.name })),
    ...authoredFunctions.map(({ file, fn }) => ({ type: "FunctionDef", file, id: fn.id, name: fn.name })),
    ...authoredGlobals.map((variable) => ({ type: "Variable", file: "triggerVariables", id: variable.id, name: variable.name })),
    ...authoredComments.map(({ file, comment }) => ({ type: "Comment", file, id: comment.id, name: comment.id })),
    ...authored.folders.map((folder) => ({ type: "Category", file: "triggerFolders", id: folder.id, name: folder.name })),
  ];
  const owned = new Set(inBlueprint.map((each) => elementKey(each.type, each.id)));
  const items = [...libraryItems(xml)]
    .filter(([key]) => !compiled.has(key) && !owned.has(key))
    .map(([, item]) => ({ ...item, name: strings.get(`${item.type}/Name/${item.id}`) ?? item.id }));
  const kept = items.filter((item) => CONVERTIBLE.has(item.type));
  const unknown = (asked ?? []).filter((wanted) => !kept.some((item) => item.id === wanted || item.name === wanted) && !inBlueprint.some((each) => each.id === wanted || each.name === wanted));
  if (unknown.length > 0) throw new Error(`The Map Package has no Kept trigger, function, global or comment ${unknown.join(", ")}`);
  const refused: { trigger: string; id: string; reason: string }[] = [];
  const refusedFunctions: { function: string; id: string; reason: string }[] = [];
  const refusedGlobals: { global: string; id: string; reason: string }[] = [];
  const refusedComments: { comment: string; id: string; reason: string }[] = [];
  const refusedFolders: { folder: string; id: string; reason: string }[] = [];
  for (const wanted of asked ?? []) {
    // A name a Kept element still has is that one's: the Blueprint's namesake of another kind isn't asked for.
    const already = kept.some((item) => item.id === wanted || item.name === wanted) ? undefined : inBlueprint.find((each) => each.id === wanted || each.name === wanted);
    if (!already) continue;
    const reason = `the Blueprint already holds it, in ${already.file}`;
    if (already.type === "Trigger") refused.push({ trigger: already.name, id: already.id, reason });
    else if (already.type === "FunctionDef") refusedFunctions.push({ function: already.name, id: already.id, reason });
    else if (already.type === "Variable") refusedGlobals.push({ global: already.name, id: already.id, reason });
    else if (already.type === "Comment") refusedComments.push({ comment: already.name, id: already.id, reason });
    else refusedFolders.push({ folder: already.name, id: already.id, reason });
  }
  // A name two kinds share (a folder named for the trigger it files) asks for the first kind of CONVERTIBLE's that has it; an Id for that element.
  const rank = (type: string): number => [...CONVERTIBLE].indexOf(type);
  const byName = (item: { readonly type: string; readonly name: string }): boolean => asked!.includes(item.name) && !kept.some((other) => other.name === item.name && rank(other.type) < rank(item.type));
  const chosen = asked ? kept.filter((item) => asked.includes(item.id) || byName(item)) : kept;

  const elements = mapElements(xml);
  const file = readTriggersFile(xml);
  const names = triggerStringNames(triggerStrings);
  const texts = textValueKeys(gameStrings.values());
  const renderer = new KeptGalaxyRenderer(file, names, { functions: CORE_PRIMITIVES.functions, presets: CORE_PRIMITIVES.presets }, texts, libraries);
  const keptTriggers = { triggers: xml, names, compiled };
  const taken = new Set([...authored.triggers, ...authoredFunctions, ...authoredComments].map((each) => each.file.toLowerCase()));
  /** The file a converted element of this name would be written to: its name's slug, numbered past any taken. */
  const fileFor = (name: string): string => {
    let slug = fileSlug(name);
    for (let n = 2; taken.has(`triggers/${slug}.json`) || fileTaken(`triggers/${slug}.json`); n++) slug = `${fileSlug(name)}-${n}`;
    return `triggers/${slug}.json`;
  };
  const read: { name: string; id: string; file: string; trigger: BlueprintTrigger }[] = [];
  const readFunctions: { name: string; id: string; file: string; fn: BlueprintFunction }[] = [];
  const readGlobals: { name: string; id: string; variable: GuiVariable }[] = [];
  const readComments: { name: string; id: string; file: string; comment: BlueprintComment }[] = [];
  /** The Blueprint's elements with those converted so far, and `entry`, for a reach check. */
  const withRead = (entry: { readonly trigger?: AuthoredTrigger; readonly fn?: AuthoredFunction; readonly variable?: GuiVariable }): AuthoredTriggers => ({
    ...authored,
    triggers: [...authored.triggers, ...read.map(({ trigger, file: at }) => ({ file: at, trigger })), ...(entry.trigger ? [entry.trigger] : [])],
    functions: [...authoredFunctions, ...readFunctions.map(({ fn, file: at }) => ({ file: at, fn })), ...(entry.fn ? [entry.fn] : [])],
    variables: [...authoredGlobals, ...readGlobals.map(({ variable }) => variable), ...(entry.variable ? [entry.variable] : [])],
  });
  const eol = eolOf(script);
  /** The problems of `by` (a refusal's prefix naming the element) among the reach problems, without it. */
  const ownProblems = (problems: readonly string[], by: string): string[] => problems.filter((problem) => problem.startsWith(by)).map((problem) => problem.slice(by.length));

  // Globals first, then functions: a trigger or function converted beside one may name it.
  for (const item of chosen.filter((each) => each.type === "Variable")) {
    const refuse = (reason: string): void => {
      refusedGlobals.push({ global: item.name, id: item.id, reason });
    };
    let variable: GuiVariable;
    try {
      variable = readMapGlobal(elements, strings, item.id);
    } catch (error) {
      if (!(error instanceof UnconvertibleFunctionError)) throw error;
      refuse(error.reason);
      continue;
    }
    if (wordsOf(gameStrings, new Set(variable.value ? heldIds(variable.value) : []))) {
      refuse("its initial value holds a text value, whose words a Blueprint global doesn't hold yet");
      continue;
    }
    const parsed = MAP_GUI.GuiVariableSchema.safeParse(variable);
    if (!parsed.success) {
      refuse(`it isn't a global a Mission Blueprint holds: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(global)"}: ${issue.message}`).join("; ")}`);
      continue;
    }
    const own = ownProblems(blueprintReferenceProblems(withRead({ variable }), keptTriggers, libraries), `the Blueprint global "${variable.name}" (${variable.id}, triggerVariables) `);
    if (own.length > 0) {
      refuse(outOfReach(own));
      continue;
    }
    const writer = new ElementWriter(undefined, "    ");
    writer.variable(variable);
    const xmlDiffers = difference(`variable:${variable.id}`, item.elements.join("\n"), writer.elements.join("\n"));
    if (xmlDiffers) {
      refuse(`its XML would be written otherwise than the Editor's: ${xmlDiffers}`);
      continue;
    }
    const galaxy = renderer.renderGlobal(variable.id);
    if (galaxy === undefined) {
      refuse(`its Galaxy can't be written as the Editor does: it holds ${unknownParts(renderer.unknown)}`);
      continue;
    }
    // The Editor writes a constant in Constants, not Global Variables: a section the compile doesn't write yet.
    if (galaxy.declaration.startsWith("const ")) {
      refuse("it is a constant, which the Editor declares in Constants, a section the compile doesn't write yet");
      continue;
    }
    const name = renderer.variableGalaxyName(variable.id);
    const savedDeclaration = blockText(script, `variable:${name}`);
    const savedInitial = blockText(script, `variable-init:${name}`);
    const galaxyProblem =
      savedDeclaration === undefined
        ? `MapScript.galaxy has no variable:${name}: save the map in the Editor so it writes one, then convert it`
        : difference(`galaxy:MapScript.galaxy:variable:${name}`, savedDeclaration, `${galaxy.declaration}${eol}`) ??
          difference(`galaxy:MapScript.galaxy:variable-init:${name}`, savedInitial ?? "", galaxy.initial === undefined ? "" : `    ${galaxy.initial}${eol}`);
    if (galaxyProblem) {
      refuse(savedDeclaration === undefined ? galaxyProblem : `its Galaxy would be written otherwise than the Editor's: ${galaxyProblem}`);
      continue;
    }
    readGlobals.push({ name: variable.name, id: variable.id, variable });
  }

  // Comments filed among the items have no Galaxy: their XML alone is checked.
  for (const item of chosen.filter((each) => each.type === "Comment")) {
    const refuse = (reason: string): void => {
      refusedComments.push({ comment: item.name, id: item.id, reason });
    };
    let comment: BlueprintComment;
    try {
      comment = { kind: "comment", ...readMapComment(elements, strings, item.id) };
    } catch (error) {
      if (!(error instanceof UnconvertibleFunctionError)) throw error;
      refuse(error.reason);
      continue;
    }
    const writer = new ElementWriter(undefined, "    ");
    writer.statement({ id: comment.id, comment: comment.comment });
    const xmlDiffers = difference(`comment:${comment.id}`, item.elements.join("\n"), writer.elements.join("\n"));
    if (xmlDiffers) {
      refuse(`its XML would be written otherwise than the Editor's: ${xmlDiffers}`);
      continue;
    }
    const target = fileFor(`comment ${comment.id}`);
    taken.add(target);
    readComments.push({ name: item.name, id: comment.id, file: target, comment });
  }

  // Trigger Folders: each files what it did, Kept or converted, by its item lines; it has no Galaxy.
  const readFolders: { name: string; id: string; folder: BlueprintTriggerFolder }[] = [];
  for (const item of chosen.filter((each) => each.type === "Category")) {
    const refuse = (reason: string): void => {
      refusedFolders.push({ folder: item.name, id: item.id, reason });
    };
    let category: ReturnType<typeof readMapItem>;
    try {
      category = readMapItem(elements, strings, "Category", item.id);
    } catch (error) {
      if (!(error instanceof UnconvertibleFunctionError)) throw error;
      refuse(error.reason);
      continue;
    }
    if (category.kind !== "category") {
      refuse(`it reads as a ${category.kind}, not a folder`);
      continue;
    }
    const { name, identifier, label, items: filed } = category.item;
    if (name === undefined) {
      refuse("it has no name in TriggerStrings.txt, which a Blueprint folder has");
      continue;
    }
    if (identifier !== undefined) {
      refuse("it has an <Identifier>, which a Blueprint folder doesn't hold yet");
      continue;
    }
    const other = filed.find((each) => !BlueprintFolderItem.safeParse(each).success);
    if (other !== undefined) {
      refuse(`it files ${other}, a kind of item a Blueprint folder doesn't file yet`);
      continue;
    }
    // An item the last compile wrote is a concept's, which a Blueprint element can't name.
    const conceptItem = filed.find((each) => {
      const [kind, id] = each.split(":") as [keyof typeof LIBRARY_ITEM_TYPES, string];
      return compiled.has(elementKey(LIBRARY_ITEM_TYPES[kind], id));
    });
    if (conceptItem !== undefined) {
      refuse(`it files ${conceptItem}, which the compile writes for a Blueprint concept and may change: file it elsewhere in the Editor, or leave the folder Kept`);
      continue;
    }
    const parsed = BlueprintTriggerFolderSchema.safeParse({ id: item.id, name, ...(label ? { label } : {}), items: filed });
    if (!parsed.success) {
      refuse(`it isn't a folder a Mission Blueprint holds: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(folder)"}: ${issue.message}`).join("; ")}`);
      continue;
    }
    const folder: BlueprintTriggerFolder = parsed.data;
    const xmlDiffers = difference(`category:${folder.id}`, item.elements.join("\n"), folderXml(folder));
    if (xmlDiffers) {
      refuse(`its XML would be written otherwise than the Editor's: ${xmlDiffers}`);
      continue;
    }
    readFolders.push({ name, id: folder.id, folder });
  }

  // Then functions: a trigger converted beside one may call it.
  for (const item of chosen.filter((each) => each.type === "FunctionDef")) {
    const refuse = (reason: string): void => {
      refusedFunctions.push({ function: item.name, id: item.id, reason });
    };
    let fn: BlueprintFunction;
    try {
      fn = readKeptFunction(elements, strings, gameStrings, item.id);
    } catch (error) {
      if (!(error instanceof UnconvertibleFunctionError)) throw error;
      refuse(error.reason);
      continue;
    }
    // A form the Blueprint's schema doesn't take (an identifier that is no Galaxy name, …) stays Kept.
    const parsed = BlueprintFunctionSchema.safeParse(fn);
    if (!parsed.success) {
      refuse(`it isn't a function a Mission Blueprint holds: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(function)"}: ${issue.message}`).join("; ")}`);
      continue;
    }
    const target = fileFor(fn.name);
    const own = ownProblems(blueprintReferenceProblems(withRead({ fn: { file: target, fn } }), keptTriggers, libraries), `the Blueprint function "${fn.name}" (${fn.id}, ${target}) `);
    if (own.length > 0) {
      refuse(outOfReach(own));
      continue;
    }
    const xmlDiffers = difference(`function:${fn.id}`, item.elements.join("\n"), blueprintFunctionXml(fn).join("\n"));
    if (xmlDiffers) {
      refuse(`its XML would be written otherwise than the Editor's: ${xmlDiffers}`);
      continue;
    }
    // Its Galaxy as the Editor wrote it: its declaration and its definition, which the Kept renderer writes from its XML.
    const definition = renderer.renderFunction(fn.id);
    if (definition === undefined) {
      refuse(`its Galaxy can't be written as the Editor does: it holds ${unknownParts(renderer.unknown)}`);
      continue;
    }
    const name = renderer.functionName(fn.id);
    const declaration = functionDeclaration(definition, name);
    const blocks: [string, string | undefined][] = [
      [`function-declaration:${name}`, declaration === undefined ? undefined : `${declaration}\r\n`],
      [`function:${name}`, definition],
    ];
    const galaxyProblem = blocks.flatMap(([block, written]) => {
      if (written === undefined) return [`the Galaxy written for ${name} has no signature to declare it by`];
      const saved = blockText(script, block);
      if (saved === undefined) return [`MapScript.galaxy has no ${block}: save the map in the Editor so it writes one, then convert it`];
      const differs = difference(`galaxy:MapScript.galaxy:${block}`, saved, written.replace(/\r?\n/g, eolOf(saved)));
      return differs ? [`its Galaxy would be written otherwise than the Editor's: ${differs}`] : [];
    })[0];
    if (galaxyProblem) {
      refuse(galaxyProblem);
      continue;
    }
    taken.add(target);
    readFunctions.push({ name: fn.name, id: fn.id, file: target, fn });
  }

  for (const item of chosen.filter((each) => each.type === "Trigger")) {
    const refuse = (reason: string): void => {
      refused.push({ trigger: item.name, id: item.id, reason });
    };
    let body: ReturnType<typeof readKeptTrigger>;
    try {
      body = readKeptTrigger(elements, strings, gameStrings, item.id, held);
    } catch (error) {
      if (!(error instanceof UnconvertibleFunctionError)) throw error;
      refuse(error.reason);
      continue;
    }
    const { asSaved, trigger } = body;
    const target = fileFor(trigger.name);

    // What it names, in reach: the libraries in reach, the Kept elements and the Blueprint's.
    const own = ownProblems(blueprintReferenceProblems(withRead({ trigger: { file: target, trigger } }), keptTriggers, libraries), `the Blueprint trigger "${trigger.name}" (${trigger.id}, ${target}) `);
    if (own.length > 0) {
      refuse(outOfReach(own));
      continue;
    }
    // Its XML as the Editor wrote it.
    const xmlNow = blueprintTriggerXml(asSaved).join("\n");
    const xmlDiffers = difference(`trigger:${trigger.id}`, item.elements.join("\n"), xmlNow);
    if (xmlDiffers) {
      refuse(`its XML would be written otherwise than the Editor's: ${xmlDiffers}`);
      continue;
    }
    // Its Galaxy as the Editor wrote it: the section the Kept renderer writes from its XML, or none for a disabled trigger.
    const section = renderer.renderTrigger(trigger.id);
    if (section === undefined) {
      refuse(`its Galaxy can't be written as the Editor does: it holds ${unknownParts(renderer.unknown)}`);
      continue;
    }
    if (section !== "") {
      const name = renderer.triggerName(trigger.id);
      const span = keptElementSpan(script, name);
      if (!span) {
        refuse(`MapScript.galaxy has no ${name}: save the map in the Editor so it writes one, then convert it`);
        continue;
      }
      const galaxyDiffers = difference(`galaxy:MapScript.galaxy:trigger:${name}`, script.slice(span.start, span.end), section);
      if (galaxyDiffers) {
        refuse(`its Galaxy would be written otherwise than the Editor's: ${galaxyDiffers}`);
        continue;
      }
    }
    BlueprintTriggerSchema.parse(trigger);
    taken.add(target);
    read.push({ name: trigger.name, id: trigger.id, file: target, trigger });
  }
  const notYetConvertible = asked ? [] : items.filter((item) => !CONVERTIBLE.has(item.type)).map(({ type, id, name }) => ({ type, id, name }));
  return {
    converted: read,
    refused,
    functions: { converted: readFunctions, refused: refusedFunctions },
    globals: { converted: readGlobals, refused: refusedGlobals },
    comments: { converted: readComments, refused: refusedComments },
    folders: { converted: readFolders, refused: refusedFolders },
    notYetConvertible,
  };
}

/** The kinds of Kept item that convert, by their type in Triggers. */
const CONVERTIBLE = new Set(["Trigger", "FunctionDef", "Variable", "Comment", "Category"]);

/** The script's line ending: the Editor writes CRLF, an older one LF. */
const eolOf = (text: string): string => (text.includes("\r\n") ? "\r\n" : "\n");

/**
 * The package's Kept function `id` read back into a Blueprint element, as convert_triggers reads it:
 * its interface and body, and its text values' words from each locale's GameStrings, keyed by the
 * Param or expression holding them. Throws UnconvertibleFunctionError where its XML can't be read,
 * or it is written as a Galaxy template (ScriptCode) or natively, which a Mission Blueprint doesn't hold.
 */
export function readKeptFunction(elements: ReturnType<typeof mapElements>, strings: ReadonlyMap<string, string>, gameStrings: ReadonlyMap<string, string>, id: string): BlueprintFunction {
  const { fn: form, body } = readMapFunctionWhole(elements, strings, id);
  if (form.script !== undefined) throw new UnconvertibleFunctionError(id, "it is written as a Galaxy template (<ScriptCode>), which a Mission Blueprint doesn't hold yet");
  if (form.flags.includes("native")) throw new UnconvertibleFunctionError(id, "it is native (<FlagNative>), its body Galaxy a Mission Blueprint doesn't hold");
  const fn = blueprintFunctionOf(form, body);
  const words = wordsOf(gameStrings, new Set(blueprintFunctionIds(fn)));
  return words ? { ...fn, strings: words } : fn;
}

/** The text values' words of the elements `ids`, from each locale's GameStrings, keyed by the Param or expression holding them; undefined for none. */
function wordsOf(gameStrings: ReadonlyMap<string, string>, ids: ReadonlySet<string>): Record<string, Record<string, string>> | undefined {
  const words: Record<string, Record<string, string>> = {};
  for (const [gameStringsPath, text] of gameStrings) {
    for (const [key, value] of stringTable(text)) {
      const match = /^Param\/(?:Value|Expression)\/([0-9A-F]{8})$/.exec(key);
      if (match && ids.has(match[1]!)) (words[gameStringsPath] ??= {})[key] = value;
    }
  }
  return Object.keys(words).length > 0 ? words : undefined;
}

/** Converts chosen Kept triggers of the Mission's Map Package at `blueprintPath` into its Blueprint's own trigger elements, as above. */
export async function convertMissionTriggers(workspace: Workspace, blueprintPath: string, { triggers: asked, libraries: given }: ConvertMissionTriggersOptions = {}): Promise<ConvertedMissionTriggers> {
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const pkg = await missionMapPackage(blueprintPath);
  const record = await readCompileRecord(blueprintPath);
  if (!record) throw new Error(`${blueprintPath} has no compile record beside it: import the map with import_map, which writes an empty one`);
  const triggersFile = path.join(pkg, "Triggers");
  if (!existsSync(triggersFile)) throw new Error(`The Map Package ${pkg} has no Triggers, so no Kept trigger`);
  const optional = async (file: string): Promise<string> => (existsSync(file) ? readFile(file, "utf8") : "");
  const files: KeptPackageFiles = {
    triggers: await readFile(triggersFile, "utf8"),
    triggerStrings: await optional(path.join(pkg, ...TRIGGER_STRINGS.split("/"))),
    script: await optional(path.join(pkg, "MapScript.galaxy")),
    gameStrings: await gameStringsFiles(pkg),
  };
  const dir = path.dirname(blueprintPath);
  const listed = new Set((blueprint.triggers ?? []).map((each) => each.toLowerCase()));
  const { converted: triggers, refused: refusedTriggers, functions, globals, comments, folders } = convertKeptTriggers(files, {
    ...(asked ? { triggers: asked } : {}),
    libraries: given ?? (await missionLibraries(workspace, blueprint.dependencies ?? [])),
    ...recordConversionContext(record.entries),
    authored: await readAuthoredTriggers(blueprint, blueprintPath),
    fileTaken: (file) => listed.has(file) || existsSync(path.join(dir, ...file.split("/"))),
  });

  const written = [
    ...comments.converted.map((item) => ({ kind: "comment" as const, ...item, element: item.comment as BlueprintElement })),
    ...functions.converted.map((item) => ({ kind: "function" as const, ...item, element: item.fn as BlueprintElement })),
    ...triggers.map((item) => ({ kind: "trigger" as const, ...item, element: item.trigger as BlueprintElement })),
  ];
  if (written.length + globals.converted.length + folders.converted.length > 0) {
    await mkdir(path.join(dir, "triggers"), { recursive: true });
    for (const { element, file: at } of written) await writeFile(path.join(dir, ...at.split("/")), blueprintElementFile(element));
    const raw = JSON.parse(await readFile(blueprintPath, "utf8")) as Record<string, unknown>;
    if (written.length > 0) raw.triggers = [...((raw.triggers as string[] | undefined) ?? []), ...written.map(({ file: at }) => at)];
    // A global is declared in the Blueprint itself.
    if (globals.converted.length > 0) raw.triggerVariables = [...((raw.triggerVariables as unknown[] | undefined) ?? []), ...globals.converted.map(({ variable }) => MAP_GUI.GuiVariableSchema.parse(variable))];
    // A folder too.
    if (folders.converted.length > 0) raw.triggerFolders = [...((raw.triggerFolders as unknown[] | undefined) ?? []), ...folders.converted.map(({ folder }) => BlueprintTriggerFolderSchema.parse(folder))];
    await writeFile(blueprintPath, `${JSON.stringify(raw, null, 2)}\n`);
  }
  return {
    converted: [
      ...globals.converted.map(({ name, id }) => ({ kind: "global" as const, name, id, file: "blueprint.json (triggerVariables)" })),
      ...written.map(({ kind, name, id, file: at }) => ({ kind, name, id, file: at })),
      ...folders.converted.map(({ name, id }) => ({ kind: "folder" as const, name, id, file: "blueprint.json (triggerFolders)" })),
    ],
    refused: [
      ...globals.refused.map((item) => ({ kind: "global" as const, element: item.global, reason: item.reason })),
      ...comments.refused.map((item) => ({ kind: "comment" as const, element: item.comment, reason: item.reason })),
      ...functions.refused.map((item) => ({ kind: "function" as const, element: item.function, reason: item.reason })),
      ...refusedTriggers.map((item) => ({ kind: "trigger" as const, element: item.trigger, reason: item.reason })),
      ...folders.refused.map((item) => ({ kind: "folder" as const, element: item.folder, reason: item.reason })),
    ],
  };
}

/**
 * The package's Kept trigger `id` read back into a Blueprint element, as convert_triggers reads it:
 * as saved (`asSaved`), and as it converts (`trigger`): each call a hold switched off (`held`, ADR-0014)
 * back on, as the Editor saved it before the hold, and its text values' words from each locale's
 * GameStrings, keyed by the Param or expression holding them. Throws UnconvertibleFunctionError
 * where its XML can't be read.
 */
export function readKeptTrigger(
  elements: ReturnType<typeof mapElements>,
  strings: ReadonlyMap<string, string>,
  gameStrings: ReadonlyMap<string, string>,
  id: string,
  held: ReadonlySet<string>,
): { readonly asSaved: BlueprintTrigger; readonly trigger: BlueprintTrigger } {
  const asSaved: BlueprintTrigger = { kind: "trigger", ...readMapTrigger(elements, strings, id) };
  const trigger = withCallsOn(asSaved, held);
  const words = wordsOf(gameStrings, new Set(blueprintTriggerIds(trigger)));
  return { asSaved, trigger: words ? { ...trigger, strings: words } : trigger };
}

/** `trigger` with each call of `ids` (statements, at any depth) switched back on. */
function withCallsOn(trigger: BlueprintTrigger, ids: ReadonlySet<string>): BlueprintTrigger {
  if (ids.size === 0) return trigger;
  const on = (statement: GuiStatement): GuiStatement => {
    if (isComment(statement)) return statement;
    const { disabled, ...rest } = statement;
    const call: GuiCall = ids.has(statement.id) ? rest : statement;
    return call.body ? { ...call, body: call.body.map(on) } : call;
  };
  return { ...trigger, events: trigger.events.map(on), conditions: trigger.conditions.map(on), actions: trigger.actions.map(on) };
}

/**
 * A trigger's reach problems as one reason: those out of reach for one cause (a library not in
 * reach) named by the first, with how many more, so a call's every parameter isn't listed.
 */
function outOfReach(problems: readonly string[]): string {
  const byWhy = new Map<string, string[]>();
  const other: string[] = [];
  for (const problem of problems) {
    const match = /^(.*?), which is out of reach: (.*)$/.exec(problem);
    if (match) byWhy.set(match[2]!, [...(byWhy.get(match[2]!) ?? []), match[1]!]);
    else other.push(problem);
  }
  return [...[...byWhy].map(([why, what]) => `it ${what[0]}${what.length > 1 ? ` (and ${what.length - 1} more of its parts)` : ""}, which is out of reach: ${why}`), ...other.map((problem) => `it ${problem}`)].join("; ");
}

/** What a conversion did, for the author: one line for what converted, one per element left Kept. */
export function formatConvertedMissionTriggers({ converted, refused }: ConvertedMissionTriggers): string {
  return [
    converted.length > 0 ? `Converted ${converted.length} Kept element${converted.length === 1 ? "" : "s"}: ${converted.map((item) => `${item.kind} ${item.name} (${item.file})`).join(", ")}` : "Converted no Kept elements",
    ...refused.map((item) => `Left Kept: ${item.kind} ${item.element}: ${item.reason}`),
  ].join("\n");
}
