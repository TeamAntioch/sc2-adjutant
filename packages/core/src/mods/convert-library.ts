// The convert step for a Campaign Mod's library (ADR-0011): it writes chosen Kept functions of the
// mod's GUI library into its Mod Blueprint's library interface, keeping their imported ids, so
// breadth conversion is mechanical. The next compile-mod writes them over the Kept functions they
// came from, under the Equivalence Check, which moves them from Kept to Compiled.
//
//   a GUI function     its interface, and its body in library/<identifier>.json (GuiBodySchema)
//   a native function  its interface, and its body: the script file in the package that defines
//                      it, copied into the mod's folder (scripts/… for Base.SC2Data/scripts/…)
//
// A function is refused, and stays Kept, when its XML holds a form the conversion doesn't write
// yet (library-xml.ts), when its Galaxy can't be written as the Editor would (library-galaxy.ts) or
// would come out otherwise than the Editor's (the Equivalence Check would fail it),
// or when no one script file defines a native one. The Blueprint gains the library (its id and
// name, as the package has them) with its first function.
//
// It converts the library's other items too: its categories (trigger folders) with what each files,
// preset types and their values, structures and their members, comments and custom script, each
// with its names. One holding a form the conversion doesn't write yet stays Kept, with why; a
// category may file a Kept item. Converting the first of them gives the interface the Root's order.

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { type GuiBody, LIBRARY_ITEM_TYPES, LIBRARY_STRUCTURE_KINDS, type LibraryFunction, type LibraryItemKind, type LibraryStructureKind, structureIds } from "../domain/library-interface.js";
import { ModBlueprintSchema } from "../domain/mod-blueprint.js";
import { TRIGGER_STRINGS } from "../map/editor-changes.js";
import { readCompileRecord } from "../map/mission-package.js";
import { galaxyIdentifier } from "../triggers/trigger-model.js";
import { difference } from "./equivalence.js";
import { fileSource } from "./convert-files.js";
import { declarationIn, definesFunction, definitionIn, functionGalaxy, libraryFunctionName, UnrenderableGalaxyError } from "./library-galaxy.js";
import { elementIdOf, functionXml, keysWithText, type LibraryItem, libraryElements, libraryStringKey, packageLibraryId, readLibraryFunction, readLibraryItem, stringTable, structureKind, UnconvertibleFunctionError } from "./library-xml.js";
import { elementTextKeys, heldStrings, keptStrings, takeStrings, withRawStrings } from "./owned-strings.js";
import { libraryItems } from "../triggers/splice-triggers.js";
import { xmlAttribute } from "../util/xml.js";
import { libraryScriptFiles } from "./library.js";
import { packageFiles } from "./mod-package-files.js";
import { type Workspace, workspaceModsFor } from "../plugins/workspace.js";
import { dependencyReach } from "./library-reach.js";
import { modPackage, readModBlueprint } from "./workspace-mods.js";

export type ConvertLibraryOptions = {
  /** The functions and other items to convert, each by id or name; every Kept one the conversion can write when not given. */
  readonly functions?: readonly string[];
  /** The Workspace the mod is in, whose mods its dependencies may be; found above the Blueprint when not given (none: the game's own mods are looked in). */
  readonly workspace?: Pick<Workspace, "root" | "mods">;
};

export type ConvertedLibrary = {
  /** Each function converted, by name, in the package's order. */
  readonly converted: readonly string[];
  /** Each one left Kept, with why. */
  readonly refused: readonly { readonly function: string; readonly reason: string }[];
  /** Each other item converted (a category, preset type, structure, comment or custom script), by name, kind by kind. */
  readonly items: readonly string[];
  /** Each other item left Kept, with why. */
  readonly refusedItems: readonly { readonly item: string; readonly reason: string }[];
};

/** The library interface's keys, in its schema's order. */
const LIBRARY_KEYS = ["id", "name", "root", "categories", "functions", "presets", "structures", "comments", "customScripts", "strings"];

/** The interface's lists of items other than functions, by kind. */
const ITEM_LISTS: Readonly<Record<LibraryStructureKind, string>> = { category: "categories", preset: "presets", structure: "structures", comment: "comments", "custom-script": "customScripts" };


/** Converts Kept functions of the mod's library at `blueprintPath` into its library interface, as above. */
export async function convertLibrary(blueprintPath: string, { functions: asked, workspace }: ConvertLibraryOptions = {}): Promise<ConvertedLibrary> {
  const blueprint = await readModBlueprint(blueprintPath);
  if (blueprint.kind !== "campaign") throw new Error(`${blueprintPath} is an Asset Mod's: only a Campaign Mod has a library`);
  const pkg = await modPackage(blueprintPath);
  const record = await readCompileRecord(blueprintPath);
  if (!record) throw new Error(`${blueprintPath} has no compile record beside it: import the mod with import-mod, which writes an empty one`);
  const dir = path.dirname(blueprintPath);
  const triggersFile = path.join(pkg, "Triggers");
  if (!existsSync(triggersFile)) throw new Error(`The mod package ${pkg} has no Triggers, so no library`);
  const xml = await readFile(triggersFile, "utf8");
  const libraryId = packageLibraryId(xml);
  if (!libraryId) throw new Error(`The mod package's Triggers holds no library`);
  if (blueprint.library && blueprint.library.id !== libraryId) throw new Error(`The Blueprint's library is ${blueprint.library.id}, but the package's is ${libraryId}`);
  const stringsFile = path.join(pkg, ...TRIGGER_STRINGS.split("/"));
  const strings = stringTable(existsSync(stringsFile) ? await readFile(stringsFile, "utf8") : "");
  const elements = libraryElements(xml, libraryId);

  // The package's functions, in its order, with what the Blueprint already declares or the record owns.
  const all = [...elements.values()].filter((node) => xmlAttribute(node, "Type") === "FunctionDef").map(elementIdOf).map((id) => ({ id, name: strings.get(libraryStringKey(libraryId, "FunctionDef", "Name", id)) ?? id }));
  // Its other items, filed in Root or a category, in the package's order.
  const filed = libraryItems(xml, { library: libraryId });
  const others = [...filed.values()].flatMap(({ type, id }) => {
    const kind = structureKind(type);
    return kind ? [{ id, type, kind, name: kind === "comment" ? `comment ${id}` : (strings.get(libraryStringKey(libraryId, type, "Name", id)) ?? id) }] : [];
  });
  const library = blueprint.library;
  const owned = new Set([
    ...(library?.functions ?? []).map((fn) => fn.id),
    ...(library ? structureIds(library).map((item) => item.id) : []),
    ...record.entries.flatMap((entry) => (entry.kind === "function" || (LIBRARY_STRUCTURE_KINDS as readonly string[]).includes(entry.kind) ? [(entry as { id: string }).id] : [])),
  ]);
  const unknown = (asked ?? []).filter((wanted) => ![...all, ...others].some((item) => item.id === wanted || item.name === wanted));
  if (unknown.length > 0) throw new Error(`The library ${libraryId} has no function or other item ${unknown.join(", ")}`);
  const chosen = asked ? all.filter((fn) => asked.includes(fn.id) || asked.includes(fn.name)) : all;
  const chosenOthers = asked ? others.filter((item) => asked.includes(item.id) || asked.includes(item.name)) : others;
  const items: LibraryItem[] = [];
  const refusedItems: { item: string; reason: string }[] = [];
  for (const { id, type, name } of chosenOthers) {
    if (owned.has(id)) {
      if (asked) refusedItems.push({ item: name, reason: "the Blueprint already declares it, or the last compile wrote it" });
      continue;
    }
    try {
      items.push(readLibraryItem(elements, strings, libraryId, type, id));
    } catch (error) {
      if (!(error instanceof UnconvertibleFunctionError)) throw error;
      refusedItems.push({ item: name, reason: error.reason });
    }
  }
  items.sort((a, b) => LIBRARY_STRUCTURE_KINDS.indexOf(a.kind) - LIBRARY_STRUCTURE_KINDS.indexOf(b.kind));

  const refused: { function: string; reason: string }[] = [];
  const read: { fn: LibraryFunction; body?: GuiBody }[] = [];
  for (const { id, name } of chosen) {
    if (owned.has(id)) {
      if (asked) refused.push({ function: name, reason: "the Blueprint already declares it, or the last compile wrote it" });
      continue;
    }
    try {
      read.push(readLibraryFunction(elements, strings, libraryId, id));
    } catch (error) {
      if (!(error instanceof UnconvertibleFunctionError)) throw error;
      refused.push({ function: name, reason: error.reason });
    }
  }

  // Each GUI function's Galaxy must be writable as the Editor would; each native one's body found.
  // The libraries of the mods it depends on are in reach, as the game's are (#942): looked for only where a GUI function's Galaxy is written.
  const writesGalaxy = read.some(({ fn, body }) => body && !fn.disabled && !fn.flags.includes("native"));
  const reach = writesGalaxy ? await dependencyReach(pkg, blueprint.dependencies, workspace ?? (await workspaceModsFor(blueprintPath))) : undefined;
  // The package's strings files: its text values' words, which a converted function's Galaxy is checked with and the interface takes.
  const packageStrings = await keptStrings({ pkg, files: await packageFiles(pkg) });
  const scope = {
    library: libraryId,
    functions: new Map([...(blueprint.library?.functions ?? []).map((fn) => [fn.id, { fn }] as const), ...read.map((item) => [item.fn.id, item] as const)]),
    elements,
    strings,
    texts: keysWithText(packageStrings.values()),
    ...(reach ? { libraries: reach.libraries, unreached: reach.unreached } : {}),
  };
  const scripts = await galaxyFiles(pkg, libraryId);
  const generated = libraryScriptFiles(libraryId);
  const readGenerated = async (file: string): Promise<string> => (existsSync(path.join(pkg, ...file.split("/"))) ? readFile(path.join(pkg, ...file.split("/")), "utf8") : "");
  const generatedScript = await readGenerated(generated.script);
  const generatedHeader = await readGenerated(generated.header);
  const converted: LibraryFunction[] = [];
  /** The value keys of the converted GUI functions' text parameters. */
  const textKeys = new Set<string>();
  const copies = new Map<string, string>();
  const takenFromFiles = new Set<string>();
  for (const { fn, body } of read) {
    if (fn.flags.includes("native")) {
      const name = libraryFunctionName(libraryId, fn);
      const defining = scripts.filter((script) => definesFunction(script.text, name));
      if (defining.length !== 1) {
        refused.push({ function: fn.name, reason: defining.length ? `${defining.length} script files define ${name} (${defining.map((script) => script.file).join(", ")})` : `no script file in the package defines ${name}` });
        continue;
      }
      const file = defining[0]!.file;
      // A script file the Blueprint already writes whole (convert-files) keeps its source, and moves from files to the function.
      const whole = blueprint.files.find((item) => item.path.toLowerCase() === file.toLowerCase());
      // As does another function's body in the same file, converted before.
      const body = blueprint.library?.functions.find((other) => other.galaxy?.path.toLowerCase() === file.toLowerCase())?.galaxy;
      const source = whole?.source ?? body?.source ?? fileSource(file);
      if (whole) takenFromFiles.add(whole.path);
      copies.set(file, source);
      converted.push({ ...fn, galaxy: { path: file, source } });
      continue;
    }
    if (body) {
      let galaxy: ReturnType<typeof functionGalaxy> | undefined;
      try {
        if (!fn.disabled) galaxy = functionGalaxy(scope, fn, body);
      } catch (error) {
        if (!(error instanceof UnrenderableGalaxyError)) throw error;
        refused.push({ function: fn.name, reason: error.reason });
        continue;
      }
      // As compile-mod's Equivalence Check would find it: a Galaxy this writes otherwise than the Editor did stays Kept.
      const editor = galaxy && [
        { item: generated.script, kept: definitionIn(generatedScript, galaxy.name), now: galaxy.definition },
        { item: generated.header, kept: declarationIn(generatedHeader, galaxy.name), now: galaxy.declaration },
      ].flatMap(({ item, kept, now }) => (kept === undefined ? [] : [difference(`galaxy:${item}:${galaxy.name}`, kept, now)])).find((found) => found !== undefined);
      if (editor) {
        refused.push({ function: fn.name, reason: `its Galaxy would differ from the Editor's: ${editor}` });
        continue;
      }
      const source = `library/${fn.identifier ?? galaxyIdentifier(fn.name)}.json`;
      await mkdir(path.join(dir, "library"), { recursive: true });
      await writeFile(path.join(dir, source), `${JSON.stringify(body, null, 2)}\n`);
      for (const key of elementTextKeys(libraryId, functionXml(libraryId, fn, body).elements)) textKeys.add(key);
      converted.push({ ...fn, gui: source });
      continue;
    }
    converted.push(fn);
  }

  if (converted.length > 0 || items.length > 0) {
    for (const [file, source] of copies) {
      const target = path.join(dir, source);
      if (existsSync(target)) continue;
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(pkg, ...file.split("/")), target);
    }
    const raw = JSON.parse(await readFile(blueprintPath, "utf8")) as Record<string, unknown>;
    const current = (raw.library as Record<string, unknown> | undefined) ?? { id: libraryId, name: strings.get(`Library/Name/${libraryId}`) ?? libraryId };
    // The words of the converted functions' text values, taken from the package's strings as convert-triggers takes its triggers'.
    const taken = takeStrings({ blueprint, record }, packageStrings, textKeys, { held: blueprint.library?.strings ?? {}, elsewhere: await heldStrings(blueprintPath, blueprint) });
    const list = (key: string): unknown[] | undefined => current[key] as unknown[] | undefined;
    const added = (kind: LibraryStructureKind): unknown[] | undefined => {
      const more = items.filter((item) => item.kind === kind).map((item) => item.item);
      return more.length > 0 || list(ITEM_LISTS[kind]) ? [...(list(ITEM_LISTS[kind]) ?? []), ...more] : undefined;
    };
    // The Root's order, the first time an item other than a function converts, when the interface can name every item in it.
    const root = list("root") ?? (items.length > 0 ? packageRoot(xml, libraryId) : undefined);
    // The interface's keys in its schema's order: its id and name, Root, categories, functions, then the other items.
    const library = Object.fromEntries(
      Object.entries({
        ...current,
        root,
        categories: added("category"),
        functions: [...(list("functions") ?? []), ...converted.map(withoutDefaults)],
        presets: added("preset"),
        structures: added("structure"),
        comments: added("comment"),
        customScripts: added("custom-script"),
        strings: Object.keys(taken.strings).length > 0 ? taken.strings : undefined,
      })
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => LIBRARY_KEYS.indexOf(a) - LIBRARY_KEYS.indexOf(b)),
    );
    const next: Record<string, unknown> = taken.rawLeft ? withRawStrings({ ...raw, library }, taken.rawLeft) : { ...raw, library };
    if (takenFromFiles.size > 0) next.files = ((raw.files as { path: string }[] | undefined) ?? []).filter((item) => !takenFromFiles.has(item.path));
    ModBlueprintSchema.parse(next);
    await writeFile(blueprintPath, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { converted: converted.map((fn) => fn.name), refused, items: items.map((item) => (item.kind === "comment" ? `comment ${item.item.id}` : (item.item.name ?? item.item.id))), refusedItems };
}

/** The items the package's library files in its Root, as the interface names them; undefined when one is of a kind it can't name. */
function packageRoot(xml: string, library: string): string[] | undefined {
  const refs: string[] = [];
  for (const { type, id, folder } of libraryItems(xml, { library }).values()) {
    if (folder !== undefined) continue;
    const kind = (Object.entries(LIBRARY_ITEM_TYPES) as [LibraryItemKind, string][]).find(([, editor]) => editor === type)?.[0];
    if (!kind) return undefined;
    refs.push(`${kind}:${id}`);
  }
  return refs;
}

/** A function as the Blueprint lists it: its interface first and its body last, without the empty lists the schema defaults. */
function withoutDefaults(fn: LibraryFunction): Record<string, unknown> {
  const order = ["id", "name", "identifier", "kind", "flags", "grammar", "hint", "label", "internal", "disabled", "returns", "parameters", "subFunctions", "script", "gui", "galaxy"] as const;
  const empty = (value: unknown): boolean => value === undefined || (Array.isArray(value) && value.length === 0);
  return Object.fromEntries(order.flatMap((key) => (empty(fn[key]) ? [] : [[key, fn[key]]])));
}

/** The package's Galaxy files a native function may be defined in: every one but the library's generated script. */
async function galaxyFiles(pkg: string, library: string): Promise<{ readonly file: string; readonly text: string }[]> {
  const generated = libraryScriptFiles(library);
  const files = (await packageFiles(pkg)).filter((file) => file.toLowerCase().endsWith(".galaxy") && file !== generated.script && file !== generated.header && !file.toLowerCase().endsWith("_h.galaxy"));
  return Promise.all(files.map(async (file) => ({ file, text: await readFile(path.join(pkg, ...file.split("/")), "utf8") })));
}

/** What a conversion did, for the author: one line for what converted, one per function left Kept. */
export function formatConvertedLibrary({ converted, refused, items, refusedItems }: ConvertedLibrary): string {
  return [
    converted.length > 0 ? `Converted ${converted.length} library function${converted.length === 1 ? "" : "s"}: ${converted.join(", ")}` : "Converted no library functions",
    ...(items.length > 0 ? [`Converted ${items.length} other library item${items.length === 1 ? "" : "s"} (categories, preset types, structures, comments, custom script): ${items.join(", ")}`] : []),
    ...refused.map((item) => `Left Kept: ${item.function}: ${item.reason}`),
    ...refusedItems.map((item) => `Left Kept: ${item.item}: ${item.reason}`),
  ].join("\n");
}
