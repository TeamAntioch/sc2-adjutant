// The libraries a map's or a mod's Galaxy can call beyond the game's (#937): each Workspace mod its
// dependencies name, and the mods they depend on. Each is read as the template engine reads the
// game's library data (GameLibrary, as scripts/build-trigger-libraries.mjs extracts Ntve), so a call
// to one of its functions is written as a call to a game function is: by its template where it has
// one, else `lib<id>_gf_<identifier>(…)` (a native one by its identifier) with its parameters in its
// definition's order.
//
// A mod's functions come from its Mod Blueprint's library interface, and those the interface doesn't
// declare (still Kept) from its package's Triggers and strings, read for their interface only. One
// that can't be read is kept with why (`unreadable`), so a call to it is refused naming the reason;
// a disabled one (the Editor writes no Galaxy for it; the interface's word stands over the
// package's) is left out. A Workspace mod whose package can't be read, or whose library's id another
// mod's has, is refused whole: a call into it is refused with why. A mod's copy of a game library
// (Ntve, Hots) leaves the game's in reach. A dependency the Workspace doesn't hold (the game's,
// Battle.net's) brings nothing to a map.
//
// A mod's dependencies (#942, dependencyReach) are found the same way in a Workspace. A mod outside
// one is one of the game's own, so its dependencies are found under the game's data by their paths,
// every library their Triggers hold; a mod dependency found nowhere is named by a refused call,
// unless it is one of the game's mods that hold no library.

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { pathInAnyCase } from "../catalog/package-files.js";
import { type ArrayBound, LIBRARY_ITEM_TYPES, type LibraryCategory, type LibraryFunction, type LibraryInterface, type LibraryPreset, type TypeSpec } from "../domain/library-interface.js";
import { readDependencies } from "../map/read-dependencies.js";
import type { Workspace } from "../plugins/workspace.js";
import { galaxyIdentifier } from "../triggers/trigger-model.js";
import { xmlAttribute, type XmlNode } from "../util/xml.js";
import { type GameLibrary, gameTriggerLibraries, type LibraryVariable, type Unreached } from "./library-galaxy.js";
import { arrayBoundOf, elementIdOf, type LibraryElements, libraryElementOf, libraryElements, libraryStringKey, packageLibraryId, readLibraryFunction, stringTable, UnconvertibleFunctionError } from "./library-xml.js";
import { dependencyMods, fileDependencyNames, fileDependencyPaths, modPackageName, readModBlueprint } from "./workspace-mods.js";

/** The game data's kind flag of each function kind. */
export const KIND_FLAGS: Readonly<Record<LibraryFunction["kind"], string>> = { action: "action", function: "call", condition: "condition", event: "event" };

const TRIGGER_STRINGS = path.join("enUS.SC2Data", "LocalizedData", "TriggerStrings.txt");
const GAME_STRINGS = path.join("enUS.SC2Data", "LocalizedData", "GameStrings.txt");

/**
 * The game's own mods that hold no trigger library of their own, in lower case: in the game-data
 * mirror they have no Triggers (Core's Ntve and Swarm's Hots are the game's libraries, read from
 * its data). A call out of reach can't be into one, so a refusal doesn't name one not found.
 */
const LIBRARYLESS_GAME_MODS: ReadonlySet<string> = new Set(["core", "liberty", "libertymulti", "swarm", "swarmmulti", "void", "voidmulti", "novastoryassets"]);

/** The mods of `names` a call out of reach could be into: each once, without the game's that hold no library. */
const unreachedMods = (names: readonly string[]): string[] => {
  // The game matches a mod's name in any case: each is named once, in its first spelling.
  const byName = new Map<string, string>();
  for (const name of names) if (!LIBRARYLESS_GAME_MODS.has(name.toLowerCase()) && !byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), name);
  return [...byName.values()];
};

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** A library's category as functionCategories reads one: its name and the items it files (`function:<id>`, `category:<id>`, …). */
type CategoryItems = Pick<LibraryCategory, "id" | "name" | "items">;

/** Each function's category, as the Editor's function list files it: the names of the categories it is in, from the outermost, joined by " > ". */
function functionCategories(categories: readonly CategoryItems[]): Map<string, string> {
  const parent = new Map<string, string>();
  const home = new Map<string, string>();
  for (const category of categories) {
    for (const item of category.items) {
      const [kind, id] = item.split(":") as [string, string];
      if (kind === "category") parent.set(id, category.id);
      if (kind === "function") home.set(id, category.id);
    }
  }
  const byId = new Map(categories.map((category) => [category.id, category]));
  const out = new Map<string, string>();
  for (const [fn, start] of home) {
    const names: string[] = [];
    // A category filed under itself, directly or not, is named once.
    const seen = new Set<string>();
    for (let at: string | undefined = start; at !== undefined && !seen.has(at); at = parent.get(at)) {
      seen.add(at);
      const name = byId.get(at)?.name;
      if (name) names.unshift(name);
    }
    if (names.length > 0) out.set(fn, names.join(" > "));
  }
  return out;
}

/** What a library in reach is named and how its functions are filed, for search (function-search.ts). */
type LibraryNames = { readonly name?: string | undefined; readonly categories?: readonly CategoryItems[] };

/** A library's functions, preset types and variables (its globals and its structures' members), as the engine reads a library in reach, with their names as the Editor shows them. */
function reachLibrary(library: string, functions: readonly LibraryFunction[], presets: readonly LibraryPreset[], variables: Readonly<Record<string, LibraryVariable>> = {}, unreadable: Readonly<Record<string, string>> = {}, names: LibraryNames = {}): GameLibrary {
  const out: { [K in Exclude<keyof GameLibrary, "name" | "refused" | "unreadable" | "variables" | "slots" | "defaultTexts">]: Record<string, GameLibrary[K][string]> } = { functions: {}, params: {}, presetValues: {}, presets: {}, subFunctions: {} };
  const slots: Record<string, NonNullable<GameLibrary["slots"]>[string]> = {};
  const categories = functionCategories(names.categories ?? []);
  for (const fn of functions) {
    if (fn.disabled) continue;
    const category = categories.get(fn.id);
    out.functions[fn.id] = {
      name: fn.name,
      ...(fn.hint !== undefined ? { hint: fn.hint } : {}),
      ...(category !== undefined ? { category } : {}),
      identifier: fn.identifier ?? galaxyIdentifier(fn.name),
      flags: [KIND_FLAGS[fn.kind], ...fn.flags],
      params: fn.parameters.map((parameter) => parameter.id),
      ...(fn.returns ? { returns: fn.returns } : {}),
      ...(fn.subFunctions.length ? { subFunctions: fn.subFunctions.map((slot) => `${library}/${slot.id}`) } : {}),
      ...(fn.script !== undefined ? { script: fn.script } : {}),
    };
    for (const parameter of fn.parameters) {
      out.params[parameter.id] = {
        identifier: parameter.identifier ?? lowerFirst(galaxyIdentifier(parameter.name)),
        name: parameter.name,
        type: parameter.type.type,
        ...(parameter.type.element ? { element: parameter.type.element } : {}),
        ...(parameter.type.gameType ? { gameType: parameter.type.gameType } : {}),
        ...(parameter.default ? { default: parameter.default } : {}),
      };
    }
    for (const slot of fn.subFunctions) {
      out.subFunctions[slot.id] = slot.identifier ?? lowerFirst(galaxyIdentifier(slot.name));
      slots[slot.id] = { name: slot.name, ...(slot.holds ? { holds: slot.holds } : {}) };
    }
  }
  for (const preset of presets) {
    out.presets[preset.id] = { base: preset.baseType, ...(preset.name !== undefined ? { name: preset.name } : {}), values: preset.values.map((value) => value.id) };
    // A value with none of its own is a generated constant, whose name the interface doesn't give: left without one, it is refused.
    for (const value of preset.values) out.presetValues[value.id] = { value: value.value ?? "", ...(value.name !== undefined ? { name: value.name } : {}) };
  }
  return {
    ...(names.name !== undefined ? { name: names.name } : {}),
    ...out,
    ...(Object.keys(slots).length > 0 ? { slots } : {}),
    ...(Object.keys(variables).length > 0 ? { variables } : {}),
    ...(Object.keys(unreadable).length > 0 ? { unreadable } : {}),
  };
}

/**
 * The words of the texts the parameters' defaults (`params`) of the library `id` hold, by the Id of
 * the value holding each, from its GameStrings (`words`, by key Param/Value/lib_<library>_<id>): an
 * absent key is an empty text, as the Editor reads one. The library data's `defaultTexts`
 * (scripts/build-trigger-libraries.mjs) and a mod library's in reach.
 */
export function defaultTextsOf(params: GameLibrary["params"], words: (key: string) => string | undefined, id: string): Record<string, string> {
  const texts: Record<string, string> = {};
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.type === "text" && record.value === undefined && typeof record.id === "string") texts[record.id] = words(`Param/Value/lib_${id}_${record.id}`) ?? "";
      Object.values(record).forEach(visit);
    }
  };
  for (const param of Object.values(params)) visit(param.default);
  return texts;
}

/** `library` with its defaults' texts' words (defaultTextsOf) from its GameStrings (`words`); without GameStrings they stay unknown. */
function withDefaultTexts(library: GameLibrary, words: ((key: string) => string | undefined) | undefined, id: string): GameLibrary {
  if (!words) return library;
  const texts = defaultTextsOf(library.params, words, id);
  return Object.keys(texts).length > 0 ? { ...library, defaultTexts: texts } : library;
}

/**
 * A library's global as a map names it, with its Galaxy name as the Editor gives it (lib<id>_gv_ and
 * its identifier, else its name's, started lower case), or a member of one of its structures (lv_
 * and its name's, with `structure` the one it is a member of, as `<library>/<id>`); undefined for a
 * member with an identifier of its own, which no Editor sample has.
 */
function libraryVariable(library: string, name: string, identifier: string | undefined, structure: string | undefined, type: TypeSpec | undefined): LibraryVariable | undefined {
  if (structure !== undefined && identifier !== undefined) return undefined;
  const galaxy = structure !== undefined ? `lv_${lowerFirst(galaxyIdentifier(name))}` : `lib${library}_gv_${identifier ?? lowerFirst(galaxyIdentifier(name))}`;
  return { galaxy, name, ...(structure !== undefined ? { member: true as const, structure } : {}), ...(type ? { type } : {}) };
}

/**
 * A package library's globals and its structures' members (the Variables no function or trigger
 * holds as its own), each named in TriggerStrings: one with no name is left out, so a map naming it
 * is refused.
 */
function packageVariables(elements: LibraryElements, strings: ReadonlyMap<string, string>, library: string): Record<string, LibraryVariable> {
  const owner = new Map<string, { readonly type: string; readonly id: string }>();
  for (const node of elements.values()) {
    const type = xmlAttribute(node, "Type");
    if (type !== "Structure" && type !== "FunctionDef" && type !== "Trigger") continue;
    for (const child of node.children) if (child.name === "Variable") owner.set(xmlAttribute(child, "Id") ?? "", { type, id: elementIdOf(node) });
  }
  const out: Record<string, LibraryVariable> = {};
  for (const node of elements.values()) {
    if (xmlAttribute(node, "Type") !== "Variable") continue;
    const id = elementIdOf(node);
    const held = owner.get(id);
    const name = strings.get(libraryStringKey(library, "Variable", "Name", id));
    if ((held !== undefined && held.type !== "Structure") || name === undefined) continue;
    const identifier = node.children.find((child) => child.name === "Identifier")?.text.trim();
    const variable = libraryVariable(library, name, identifier || undefined, held && `${library}/${held.id}`, packageVariableType(node, library));
    if (variable) out[id] = variable;
  }
  return out;
}

/** A package Variable's type, from its VariableType; undefined where it can't be read whole. */
function packageVariableType(node: XmlNode, library: string): TypeSpec | undefined {
  const type = node.children.find((child) => child.name === "VariableType");
  const value = type?.children.find((child) => child.name === "Type");
  const name = value && xmlAttribute(value, "Value");
  if (!type || !name) return undefined;
  const element = type.children.find((child) => child.name === "TypeElement");
  const elementId = element && xmlAttribute(element, "Id");
  const array: ArrayBound[] = [];
  for (const [dim, bound] of type.children.filter((child) => child.name === "ArraySize").entries()) {
    const read = arrayBoundOf((attribute) => (attribute === "Library" ? (xmlAttribute(bound, "Library") ?? library) : xmlAttribute(bound, attribute)), dim);
    if ("refused" in read) return undefined;
    array.push(read);
  }
  return { type: name, ...(element && elementId ? { element: `${xmlAttribute(element, "Library") ?? library}/${elementId}` } : {}), ...(array.length ? { array } : {}) };
}

/** A library in reach, from its interface (a Mod Blueprint's `library`). */
export function interfaceLibrary(library: Pick<LibraryInterface, "id" | "functions" | "presets"> & Partial<Pick<LibraryInterface, "name" | "categories" | "structures" | "strings">>): GameLibrary {
  // Its structures' members; its globals are the Mod Blueprint's triggers, which the package holds.
  const members: Record<string, LibraryVariable> = {};
  for (const structure of library.structures ?? []) {
    for (const member of structure.members) {
      const variable = libraryVariable(library.id, member.name, member.identifier, `${library.id}/${structure.id}`, member.type);
      if (variable) members[member.id] = variable;
    }
  }
  const words = library.strings?.["enUS.SC2Data/LocalizedData/GameStrings.txt"];
  return withDefaultTexts(reachLibrary(library.id, library.functions, library.presets, members, {}, { name: library.name, categories: library.categories ?? [] }), words && ((key) => words[key]), library.id);
}

/** A library in reach, from a package's library elements (libraryElements) and its TriggerStrings: each function's interface, and its preset types. */
export function packageLibrary(elements: LibraryElements, strings: ReadonlyMap<string, string>, library: string, gameStrings?: ReadonlyMap<string, string>): GameLibrary {
  const functions: LibraryFunction[] = [];
  const presets: LibraryPreset[] = [];
  const categories: CategoryItems[] = [];
  const unreadable: Record<string, string> = {};
  for (const node of elements.values()) {
    const id = elementIdOf(node);
    const type = xmlAttribute(node, "Type");
    if (type === "Category") categories.push(packageCategory(node, strings, library));
    if (type === "Preset") {
      const preset = reachPreset(elements, id, node, strings, library);
      if (preset) presets.push(preset);
    }
    if (type !== "FunctionDef") continue;
    try {
      functions.push(readLibraryFunction(elements, strings, library, id, { interfaceOnly: true }).fn);
    } catch (error) {
      if (!(error instanceof UnconvertibleFunctionError)) throw error;
      unreadable[id] = error.reason;
    }
  }
  const read = reachLibrary(library, functions, presets, packageVariables(elements, strings, library), unreadable, { name: strings.get(`Library/Name/${library}`), categories });
  return withDefaultTexts(read, gameStrings && ((key) => gameStrings.get(key)), library);
}

/** The item kind of each of the Editor's element types a category files (LIBRARY_ITEM_TYPES turned round). */
const ITEM_KINDS: ReadonlyMap<string, string> = new Map(Object.entries(LIBRARY_ITEM_TYPES).map(([kind, type]) => [type, kind]));

/** A package's category, as functionCategories reads one: its name, and the items of `library` it files. */
function packageCategory(node: XmlNode, strings: ReadonlyMap<string, string>, library: string): CategoryItems {
  const id = elementIdOf(node);
  const name = strings.get(libraryStringKey(library, "Category", "Name", id));
  const items = node.children.flatMap((item) => {
    const kind = item.name === "Item" && xmlAttribute(item, "Library") === library ? ITEM_KINDS.get(xmlAttribute(item, "Type") ?? "") : undefined;
    return kind ? [`${kind}:${xmlAttribute(item, "Id")}`] : [];
  });
  return { id, ...(name !== undefined ? { name } : {}), items };
}

/**
 * A preset type as a call into its library needs it: its base type and each value's own Galaxy,
 * read from its elements as the mod's own are (libraryTemplateScope), whatever else it holds (a
 * label, an identifier), which converting it would refuse. Undefined without a base type.
 */
function reachPreset(elements: LibraryElements, id: string, node: XmlNode, strings: ReadonlyMap<string, string>, library: string): LibraryPreset | undefined {
  const baseType = node.children.find((child) => child.name === "BaseType");
  const base = baseType && xmlAttribute(baseType, "Value");
  if (!base) return undefined;
  const values = node.children.flatMap((item) => {
    const valueId = item.name === "Item" && xmlAttribute(item, "Type") === "PresetValue" ? xmlAttribute(item, "Id") : undefined;
    const element = valueId === undefined ? undefined : libraryElementOf(elements, "PresetValue", valueId);
    if (!element) return [];
    const held = element.children.find((child) => child.name === "Value");
    const name = strings.get(libraryStringKey(library, "PresetValue", "Name", valueId!));
    return [{ id: valueId!, ...(held ? { value: held.text.trim() } : {}), ...(name !== undefined ? { name } : {}) }];
  });
  const name = strings.get(libraryStringKey(library, "Preset", "Name", id));
  return { id, baseType: base, values, ...(name !== undefined ? { name } : {}) };
}

/** `under` with `top` laid over it: `top`'s functions, parameters, slots and presets replace `under`'s of the same id. */
const overlaid = (under: GameLibrary, top: GameLibrary): GameLibrary => {
  // A function the package can't read that `top` declares is `top`'s.
  const unreadable = Object.fromEntries(Object.entries(under.unreadable ?? {}).filter(([id]) => top.functions[id] === undefined));
  const name = top.name ?? under.name;
  return {
    ...(name !== undefined ? { name } : {}),
    functions: { ...under.functions, ...top.functions },
    params: { ...under.params, ...top.params },
    presetValues: { ...under.presetValues, ...top.presetValues },
    presets: { ...under.presets, ...top.presets },
    subFunctions: { ...under.subFunctions, ...top.subFunctions },
    ...(under.slots || top.slots ? { slots: { ...under.slots, ...top.slots } } : {}),
    ...(under.defaultTexts || top.defaultTexts ? { defaultTexts: { ...under.defaultTexts, ...top.defaultTexts } } : {}),
    ...(under.variables || top.variables ? { variables: { ...under.variables, ...top.variables } } : {}),
    ...(Object.keys(unreadable).length > 0 ? { unreadable } : {}),
  };
};

/**
 * A mod's library: its Mod Blueprint's interface laid over its package's. A function the interface
 * disables is left out, though the package's copy (compiled before it was disabled) is enabled.
 */
function declaredLibrary(kept: GameLibrary, declared: LibraryInterface): GameLibrary {
  const library = overlaid(kept, interfaceLibrary(declared));
  const disabled = new Set(declared.functions.flatMap((fn) => (fn.disabled ? [fn.id] : [])));
  const enabled = <T>(record: Readonly<Record<string, T>>): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([id]) => !disabled.has(id)));
  const { unreadable, ...rest } = library;
  const stillUnreadable = enabled(unreadable ?? {});
  return { ...rest, functions: enabled(library.functions), ...(Object.keys(stillUnreadable).length > 0 ? { unreadable: stillUnreadable } : {}) };
}

/** A library every call into is refused, with why (`refused`, which completes "…, but"). */
export const refusedLibrary = (refused: string): GameLibrary => ({ functions: {}, params: {}, presetValues: {}, presets: {}, subFunctions: {}, refused });

/**
 * The libraries of the Workspace mods a package with the dependencies `dependencies` loads (a
 * map's, or a mod's), by library id, in load order: each from its Mod Blueprint's interface over its package's Triggers. A mod with
 * no library brings none. One whose package can't be read is refused, as is an id another mod's
 * library has: a call into it is refused with why, and the other libraries read on. A copy of a
 * game library's is left out, so the game's stays in reach.
 */
export async function modLibraries(workspace: Pick<Workspace, "root" | "mods">, dependencies: readonly string[]): Promise<Record<string, GameLibrary>> {
  const out: Record<string, GameLibrary> = {};
  const holders = new Map<string, string[]>();
  for (const mod of await dependencyMods(workspace, dependencies)) {
    let id: string | undefined;
    try {
      const declared = (await readModBlueprint(mod.blueprintPath)).library;
      id = declared?.id;
      const triggers = path.join(mod.modPackage, "Triggers");
      const xml = existsSync(triggers) ? await readFile(triggers, "utf8") : "";
      // The Blueprint's library is the mod's: a package holding another (one convert-library refuses) brings nothing to it.
      id ??= packageLibraryId(xml);
      if (!id) continue;
      const stringsFile = path.join(mod.modPackage, TRIGGER_STRINGS);
      const strings = stringTable(existsSync(stringsFile) ? await readFile(stringsFile, "utf8") : "");
      const gameStringsFile = path.join(mod.modPackage, GAME_STRINGS);
      const gameStrings = existsSync(gameStringsFile) ? stringTable(await readFile(gameStringsFile, "utf8")) : undefined;
      const kept = packageLibrary(libraryElements(xml, id), strings, id, gameStrings);
      out[id] = declared ? declaredLibrary(kept, declared) : kept;
    } catch (error) {
      // A library whose id can't be read can't be named by a call: left out, a call into it is refused as one no library in reach defines.
      if (!id) continue;
      out[id] = refusedLibrary(`the library ${id} of the mod ${mod.id} can't be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    // A copy of a game library (Ntve, Hots) doesn't replace the game's data, which holds more of it: calls into it stay the game's.
    if (id in gameTriggerLibraries()) {
      delete out[id];
      continue;
    }
    const held = [...(holders.get(id) ?? []), mod.id];
    holders.set(id, held);
    if (held.length > 1) out[id] = refusedLibrary(`the mods ${held.join(", ")} each hold a library with the id ${id}`);
  }
  return out;
}

/** Every library a package with the dependencies `dependencies` can call: the game's, then its Workspace mods' (modLibraries). */
export async function librariesInReach(workspace: Pick<Workspace, "root" | "mods">, dependencies: readonly string[]): Promise<Readonly<Record<string, GameLibrary>>> {
  return { ...gameTriggerLibraries(), ...(await modLibraries(workspace, dependencies)) };
}

/** What a mod's dependencies put in reach (#942): every library its Galaxy can call, and each mod it depends on that wasn't found, by name. */
export type DependencyReach = {
  readonly libraries: Readonly<Record<string, GameLibrary>>;
  readonly unreached: Unreached;
};

/**
 * What the dependencies `dependencies` of the mod package `pkg` (its DocumentInfo's, as its Mod
 * Blueprint holds them) put in reach. In a Workspace: the game's libraries and its Workspace mods'
 * (librariesInReach). Outside one, `pkg` is one of the game's own mods, under the game's data: each
 * mod it depends on is found there by its path (gameDataRoot), the mods that one depends on first,
 * and every library in its Triggers is read as packageLibrary reads one (a game library's id, Ntve
 * or Hots, stays the game data's). A mod dependency found nowhere is unreached, and a call into a
 * library not in reach is refused naming it, unless it is one of the game's mods that hold no
 * library (LIBRARYLESS_GAME_MODS: Core, Liberty, Swarm, Void, …). In a Workspace the game's own mods aren't read: the
 * Workspace has no extracted copy of them.
 */
export async function dependencyReach(pkg: string, dependencies: readonly string[], workspace?: Pick<Workspace, "root" | "mods">): Promise<DependencyReach> {
  if (workspace) {
    const mods = await dependencyMods(workspace, dependencies);
    const found = new Set(mods.map((mod) => mod.name.toLowerCase()));
    const named = fileDependencyNames([...dependencies, ...mods.flatMap((mod) => mod.dependencies)]);
    return { libraries: await librariesInReach(workspace, dependencies), unreached: { mods: unreachedMods(named.filter((name) => !found.has(name.toLowerCase()))), inWorkspace: true } };
  }
  const root = gameDataRoot(pkg);
  const libraries: Record<string, GameLibrary> = { ...gameTriggerLibraries() };
  const unreached: string[] = [];
  const seen = new Set<string>();
  const visit = async (named: readonly string[]): Promise<void> => {
    for (const file of fileDependencyPaths(named)) {
      if (seen.has(file.toLowerCase())) continue;
      seen.add(file.toLowerCase());
      const dependency = root === undefined ? undefined : pathInAnyCase(root, file);
      // A packed package (a file, not a folder) can't be read here.
      if (dependency === undefined || !statSync(dependency).isDirectory()) {
        unreached.push(modPackageName(file.split("/").pop()!));
        continue;
      }
      await visit(await readDependencies(dependency, { anyCase: true }));
      // A copy of a game library in a package doesn't replace the game's data, which holds more of it.
      for (const [id, library] of Object.entries(await packageLibraries(dependency))) if (!(id in gameTriggerLibraries())) libraries[id] = library;
    }
  };
  await visit(dependencies);
  return { libraries, unreached: { mods: unreachedMods(unreached), inWorkspace: false } };
}

/**
 * The game's data a package outside a Workspace is part of: the folder holding the `Mods` or
 * `Campaigns` folder it sits under (in any case), which a DocumentInfo's `file:` paths start from;
 * undefined when it is under neither.
 */
export function gameDataRoot(pkg: string): string | undefined {
  for (let dir = path.dirname(path.resolve(pkg)); path.dirname(dir) !== dir; dir = path.dirname(dir)) {
    if (["mods", "campaigns"].includes(path.basename(dir).toLowerCase())) return path.dirname(dir);
  }
  return undefined;
}

/** Every library a package's Triggers holds, by id, each read as packageLibrary reads one; none when it has no Triggers. */
export async function packageLibraries(pkg: string): Promise<Record<string, GameLibrary>> {
  const triggers = pathInAnyCase(pkg, "Triggers");
  if (triggers === undefined) return {};
  const xml = await readFile(triggers, "utf8");
  const stringsFile = pathInAnyCase(pkg, TRIGGER_STRINGS);
  const strings = stringTable(stringsFile === undefined ? "" : await readFile(stringsFile, "utf8"));
  const gameStringsFile = pathInAnyCase(pkg, GAME_STRINGS);
  const gameStrings = gameStringsFile === undefined ? undefined : stringTable(await readFile(gameStringsFile, "utf8"));
  const out: Record<string, GameLibrary> = {};
  for (const [, id] of xml.matchAll(/<Library\s+Id="([^"]+)"/g)) out[id!] = packageLibrary(libraryElements(xml, id!), strings, id!, gameStrings);
  return out;
}
