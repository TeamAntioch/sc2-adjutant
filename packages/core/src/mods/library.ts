// The Campaign Mod's library, compiled (ADR-0011): what compile-mod writes for the Blueprint's
// `library`, beside the rest of the mod.
//
//   Triggers         each function's FunctionDef and the elements it owns, spliced into the
//                    package's library (library-xml.ts)                              function
//                    each category, preset type, structure, comment and custom script, and the
//                    Blueprint's own triggers and globals, filed as the categories say, in the
//                    Editor's order                                category, preset … trigger, variable
//   TriggerStrings   the library's name, each function's name, grammar and hint, its parameters',
//                    block slots' and variables' names                                string
//   Lib<id>.galaxy   a GUI function's definition, and Lib<id>_h.galaxy its declaration, written
//                    into the Galaxy the Editor generated (library-galaxy.ts)           file (generated)
//   a Galaxy body    its script file, written whole                                  file
//
// Imported ids are kept forever: a function or parameter that the package already has under
// another id fails the compile, since Missions call it by the old one. A function converted from
// Kept has its Galaxy checked against the Editor's, as its XML and strings are (the Equivalence
// Check). Mission compiles read their primitives for the library from the same interface
// (workspaceLibrary).

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { type GuiBody, GuiBodySchema, LIBRARY_ITEM_TYPES, type LibraryCustomScript, type LibraryFunction, type LibraryInterface, type LibraryItemKind, type LibraryParameter, structureIds } from "../domain/library-interface.js";
import { itemKind, libraryItems as libraryItemParts } from "../triggers/splice-triggers.js";
import type { ModBlueprint } from "../domain/mod-blueprint.js";
import { TRIGGER_STRINGS } from "../map/editor-changes.js";
import type { CampaignLibrary } from "../plugins/plugin-api.js";
import type { Workspace } from "../plugins/workspace.js";
import { NO_LIBRARY } from "../triggers/build-mission-triggers.js";
import { type FunctionDef, type GameTriggerLibrary, TRIGGER_LIBRARIES } from "../triggers/trigger-catalog.js";
import { galaxyIdentifier } from "../triggers/trigger-model.js";
import { campaignUiCall, type ComponentLibrary, modUi, uiCallArgs, type UiField, withComponents } from "../ui/components.js";
import { UI_COMPONENTS } from "../ui/core-components.js";
import type { UiActionContext, UiComponent } from "../ui/ui-component.js";
import { formatIssues } from "../util/format-issues.js";
import { xmlAttribute, type XmlNode } from "../util/xml.js";
import type { EquivalenceCheck } from "./equivalence.js";
import { elementTextKeys, keptStrings } from "./owned-strings.js";
import { packageFiles } from "./mod-package-files.js";
import { declarationIn, definesFunction, definitionIn, functionGalaxy, libraryFunctionName, type LibraryScope, removeDeclarations, removeDefinitions, spliceCustomScripts, spliceDeclarations, spliceDefinitions } from "./library-galaxy.js";
import type { DependencyReach } from "./library-reach.js";
import { categoryXml, commentXml, customScriptXml, elementIdOf, functionStrings, functionXml, itemLine, elementTextKey, keysWithText, type LibraryElements, libraryElementOf, libraryElements, libraryElementsWithId, libraryStringKey, otherTypeWithId, libraryTriggersFile, packageLibraryId, presetXml, stringTable, structureXml } from "./library-xml.js";
import { campaignModBlueprint, MOD_PACKAGE_EXTENSION } from "./workspace-mods.js";

/** Where a library's generated Galaxy is in its mod package. */
export const libraryScriptFiles = (library: string): { readonly script: string; readonly header: string } => ({ script: `Base.SC2Data/Lib${library}.galaxy`, header: `Base.SC2Data/Lib${library}_h.galaxy` });

/** What the library adds to the mod compile. */
export type LibraryParts = {
  /** A Triggers file of the library's items (its functions, categories and the rest, and the Blueprint's own triggers and globals), spliced into the package's. */
  readonly triggers?: string;
  /** TriggerStrings keys. */
  readonly strings: Readonly<Record<string, string>>;
  /** The keys of the text parameters and text expressions of the functions it writes (Param/Value/lib_<id>_<param>, Param/Expression/lib_<id>_<param>), which the interface's strings give. */
  readonly textKeys: ReadonlySet<string>;
  /** The library's generated Galaxy, written whole ("generated"), and the Galaxy bodies' script files. */
  readonly scripts: readonly { readonly file: string; readonly content: string }[];
  readonly bodies: readonly { readonly file: string; readonly content: Uint8Array; readonly by: string }[];
};


/** A function's Galaxy identifier, from its interface or the package's element. */
const identifierOf = (fn: Pick<LibraryFunction, "identifier" | "name">): string => fn.identifier ?? galaxyIdentifier(fn.name);

/**
 * Refuses an interface that would renumber what the package already has, since Missions call the
 * library by these ids: a function or parameter of the same name under another id, a parameter
 * the package has that the interface drops (renamed under a new id, or gone), a function the last
 * compile wrote that it drops, or a new parameter whose id another element of the package has.
 */
function checkStableIds(library: LibraryInterface, elements: LibraryElements, strings: ReadonlyMap<string, string>, compiled: ReadonlySet<string>): void {
  const name = (type: string, id: string): string | undefined => strings.get(libraryStringKey(library.id, type, "Name", id));
  const identifier = (node: XmlNode, type: string): string | undefined => node.children.find((child) => child.name === "Identifier")?.text.trim() || galaxyIdentifier(name(type, elementIdOf(node)) ?? "") || undefined;
  const packaged = new Map<string, string>();
  for (const node of elements.values()) {
    if (xmlAttribute(node, "Type") !== "FunctionDef") continue;
    const ident = identifier(node, "FunctionDef");
    if (ident) packaged.set(ident.toLowerCase(), elementIdOf(node));
  }
  const problems: string[] = [];
  const declared = new Set(library.functions.map((fn) => fn.id));
  for (const id of compiled) {
    if (!declared.has(id)) problems.push(`The function ${id} (${name("FunctionDef", id) ?? "unnamed"}), which the last compile wrote, is gone from the interface: Missions calling it would break; keep it, under its id`);
  }
  for (const fn of library.functions) {
    const was = packaged.get(identifierOf(fn).toLowerCase());
    if (was && was !== fn.id) problems.push(`${fn.name} is ${fn.id} in the interface, but the package has it as ${was}: imported ids are kept, so Missions calling it don't break; give it ${was}`);
    // A function the package has keeps its id, whatever an older save numbered alike; a new one's must be no element's.
    const node = libraryElementOf(elements, "FunctionDef", fn.id);
    const taken = otherTypeWithId(elements, "FunctionDef", fn.id);
    if (taken) problems.push(`${fn.name}'s id ${fn.id} is a ${xmlAttribute(taken, "Type")} in the package: a new function needs an id of its own`);
    const own = node ? node.children.filter((c) => c.name === "Parameter").map((c) => xmlAttribute(c, "Id")!) : [];
    const params = new Map<string, string>();
    for (const id of own) {
      const def = libraryElementOf(elements, "ParamDef", id);
      const ident = def && identifier(def, "ParamDef");
      if (ident) params.set(ident.toLowerCase(), id);
    }
    for (const parameter of fn.parameters) {
      const old = params.get((parameter.identifier ?? galaxyIdentifier(parameter.name)).toLowerCase());
      if (old && old !== parameter.id) problems.push(`${fn.name}'s parameter ${parameter.name} is ${parameter.id} in the interface, but the package has it as ${old}: imported ids are kept, so Missions calling it don't break; give it ${old}`);
      const other = own.includes(parameter.id) ? undefined : libraryElementsWithId(elements, parameter.id)[0];
      if (other) problems.push(`${fn.name}'s parameter ${parameter.name} has the id ${parameter.id}, which the package already gives a ${xmlAttribute(other, "Type")}${xmlAttribute(other, "Type") === "ParamDef" ? " of another function" : ""}: a new parameter needs an id of its own`);
    }
    const kept = new Set(fn.parameters.map((parameter) => parameter.id));
    for (const id of own) {
      if (!kept.has(id)) problems.push(`${fn.name}'s parameter ${id} (${name("ParamDef", id) ?? "unnamed"}) is gone from the interface: Missions calling ${fn.name} give it by that id; keep it, under its id`);
    }
  }
  // A category, preset type, structure, comment or custom script under the id of another kind of element.
  const own: readonly (readonly [string, { readonly id: string; readonly name?: string | undefined }[]])[] = [
    ["Category", library.categories],
    ["Preset", library.presets],
    ["Structure", library.structures],
    ["Comment", library.comments],
    ["CustomScript", library.customScripts],
  ];
  for (const [type, list] of own) {
    for (const item of list) {
      const taken = otherTypeWithId(elements, type, item.id);
      if (taken) problems.push(`The ${type} ${item.name ?? item.id}'s id ${item.id} is a ${xmlAttribute(taken, "Type")} in the package: a new item needs an id of its own`);
    }
  }
  if (problems.length) throw new Error(`The library interface would renumber imported ids:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
}

/** The Blueprint's library, compiled into the parts compile-mod writes. */
export async function libraryParts(
  blueprint: ModBlueprint,
  pkg: string,
  source: (file: string) => Promise<Buffer>,
  {
    wroteScripts,
    check,
    compiled,
    compiledScripts = new Set(),
    kept,
    triggers: raw,
    generated,
    reach,
  }: {
    /** Whether the last compile wrote the library's Galaxy, so it keeps writing it. */
    readonly wroteScripts: (file: string) => boolean;
    readonly check: EquivalenceCheck;
    /** Function ids the last compile wrote: their Galaxy isn't converted again. */
    readonly compiled: ReadonlySet<string>;
    /** Custom script ids the last compile wrote: a UI Component's no longer written, or renamed, leaves the library's Galaxy. */
    readonly compiledScripts?: ReadonlySet<string>;
    /** Function ids the author kept as the Editor has them: their XML (PackageOutput) and Galaxy are left as the package has them. */
    readonly kept: ReadonlySet<string>;
    /** The Blueprint's own library triggers and globals (its `triggers` source), filed by the interface's categories. */
    readonly triggers?: string | undefined;
    /** The UI Components' functions (src/ui/components.ts), added to the library with their GUI bodies. */
    readonly generated?: ComponentLibrary;
    /** What the mod's dependencies put in reach (dependencyReach): the game's libraries alone when not given. */
    readonly reach?: DependencyReach;
  },
): Promise<LibraryParts> {
  const library = blueprint.library && generated ? withComponents(blueprint.library, generated) : blueprint.library;
  const read = async (file: string): Promise<string | undefined> => {
    const full = path.join(pkg, ...file.split("/"));
    return existsSync(full) ? readFile(full, "utf8") : undefined;
  };
  const triggersText = (await read("Triggers")) ?? "";
  const packageLibrary = packageLibraryId(triggersText);
  const id = library?.id ?? packageLibrary;
  const files = id ? libraryScriptFiles(id) : undefined;
  const scripts: { file: string; content: string }[] = [];
  const keepScripts = async (): Promise<void> => {
    for (const file of files ? [files.script, files.header] : []) {
      const text = await read(file);
      if (text !== undefined && wroteScripts(file)) scripts.push({ file, content: text });
    }
  };
  if (!library || (library.functions.length === 0 && structureIds(library).length === 0 && library.root === undefined)) {
    // A library the last compile wrote functions of can't drop them: Missions call them by id.
    if (compiled.size > 0 && id) checkStableIds({ id, name: library?.name ?? id, functions: [], categories: [], presets: [], structures: [], comments: [], customScripts: [] }, libraryElements(triggersText, id), stringTable((await read(TRIGGER_STRINGS)) ?? ""), compiled);
    await keepScripts();
    return { strings: library ? { [`Library/Name/${library.id}`]: library.name } : {}, textKeys: new Set(), scripts, bodies: [] };
  }
  if (packageLibrary && packageLibrary !== library.id) throw new Error(`The library interface is ${library.id}, but the package's Triggers holds the library ${packageLibrary}: a mod has one library, and its id is kept`);

  const strings = stringTable((await read(TRIGGER_STRINGS)) ?? "");
  const elements = libraryElements(triggersText, library.id);
  checkStableIds(library, elements, strings, compiled);

  const functions = new Map<string, { fn: LibraryFunction; body?: GuiBody }>();
  for (const [index, fn] of library.functions.entries()) {
    let body: GuiBody | undefined = generated?.bodies.get(fn.id);
    if (fn.gui !== undefined) {
      let raw: unknown;
      try {
        raw = JSON.parse((await source(fn.gui)).toString("utf8"));
      } catch (error) {
        throw new Error(`library.functions.${index} (${fn.name})'s GUI body ${fn.gui} isn't JSON: ${(error as Error).message}`, { cause: error });
      }
      const parsed = GuiBodySchema.safeParse(raw);
      if (!parsed.success) throw new Error(`library.functions.${index} (${fn.name})'s GUI body ${fn.gui} isn't valid: ${formatIssues(parsed.error, "(body)")}`);
      body = parsed.data;
    }
    functions.set(fn.id, { fn, ...(body ? { body } : {}) });
  }

  const parts = library.functions.map((fn) => functionXml(library.id, fn, functions.get(fn.id)?.body));
  const items = [
    ...library.categories.map((category) => ({ part: categoryXml(library.id, category), name: `the category ${category.name ?? category.id}` })),
    ...library.presets.map((preset) => ({ part: presetXml(library.id, preset), name: `the preset type ${preset.name ?? preset.id}` })),
    ...library.structures.map((structure) => ({ part: structureXml(library.id, structure), name: `the structure ${structure.name ?? structure.id}` })),
    ...library.comments.map((comment) => ({ part: commentXml(library.id, comment), name: `the comment ${comment.id}` })),
    ...library.customScripts.map((script) => ({ part: customScriptXml(library.id, script), name: `the custom script ${script.name ?? script.id}` })),
  ];
  const rawItems = raw === undefined ? new Map<string, { type: string; id: string; elements: readonly string[] }>() : libraryItemParts(raw, { library: library.id });
  if (raw !== undefined) {
    // Each element of the Blueprint's triggers belongs to one of its triggers or globals, or the compile would drop it.
    const reached = new Set([...rawItems.values()].flatMap((item) => item.elements.map(elementTextKey)));
    const stray = [...libraryElements(raw, library.id)].filter(([key]) => !reached.has(key)).map(([, node]) => elementIdOf(node));
    if (stray.length > 0) throw new Error(`The Mod Blueprint's triggers hold element${stray.length === 1 ? "" : "s"} ${stray.join(", ")}, which no trigger or global of theirs reaches: take ${stray.length === 1 ? "it" : "them"} out, or file what owns ${stray.length === 1 ? "it" : "them"} in their Root`);
  }
  // Every element the library writes has an id of its own, bodies' calls, values and comments too. Only elements the package
  // already has may share one across types, as an older save numbered them (Swarm Story Util's E859A89C, a FunctionCall and a
  // FunctionDef): a converted function keeps the Ids it was imported with.
  const owners: { readonly name: string; readonly elements: readonly string[] }[] = [
    ...parts.map((part, index) => ({ name: library.functions[index]!.name, elements: part.elements })),
    ...items.map(({ part, name }) => ({ name, elements: part.elements })),
    ...[...rawItems.values()].map((item) => ({ name: `the Blueprint's ${item.type.toLowerCase()} ${item.id}`, elements: item.elements })),
  ];
  const owner = new Map<string, { key: string; index: number }[]>();
  for (const [index, { elements: texts }] of owners.entries()) {
    for (const element of texts) {
      const key = elementTextKey(element);
      const id = key.slice(key.indexOf("/") + 1);
      const others = owner.get(id) ?? [];
      const other = others.find((seen) => seen.key === key || !(elements.has(key) && elements.has(seen.key)))?.index;
      const name = (at: number): string => owners[at]!.name;
      if (other === index) throw new Error(`The element id ${id} is used twice in ${name(index)}: each element of the library has an id of its own`);
      if (other !== undefined) throw new Error(`The element id ${id} is in both ${name(other)} and ${name(index)}: each element of the library has an id of its own`);
      owner.set(id, [...others, { key, index }]);
    }
  }
  const out: Record<string, string> = { [`Library/Name/${library.id}`]: library.name };
  for (const fn of library.functions) Object.assign(out, functionStrings(library.id, fn, functions.get(fn.id)?.body));
  for (const { part } of items) Object.assign(out, part.strings);

  // Galaxy bodies: each script file once, and it must define the functions that name it.
  const bodies = new Map<string, { file: string; content: Uint8Array; by: string }>();
  for (const [index, fn] of library.functions.entries()) {
    if (!fn.galaxy) continue;
    const content = bodies.get(fn.galaxy.path)?.content ?? new Uint8Array(await source(fn.galaxy.source));
    const name = libraryFunctionName(library.id, fn);
    if (!definesFunction(Buffer.from(content).toString("utf8"), name)) throw new Error(`library.functions.${index} (${fn.name}) is native, its body in ${fn.galaxy.source}, but that file doesn't define ${name}`);
    const other = bodies.get(fn.galaxy.path);
    if (other && other.by !== fn.galaxy.source) throw new Error(`library.functions.${index} (${fn.name}) writes ${fn.galaxy.path} from ${fn.galaxy.source}, but another function writes it from ${other.by}: a file has one source`);
    bodies.set(fn.galaxy.path, { file: fn.galaxy.path, content, by: fn.galaxy.source });
  }

  // The GUI functions' Galaxy, into what the Editor generated.
  // A text value or text expression holds words where the interface's strings give it some or, for a key they don't give, the package's Kept strings do.
  const given = new Set(Object.values(library.strings ?? {}).flatMap((texts) => Object.keys(texts)));
  const keptTexts = [...keysWithText((await keptStrings({ pkg, files: await packageFiles(pkg) })).values())].filter(([key]) => !given.has(key));
  const texts = new Map([...keysWithText(Object.values(library.strings ?? {})), ...keptTexts]);
  const scope: LibraryScope = { library: library.id, functions, elements, strings, texts, ...(reach ? { libraries: reach.libraries, unreached: reach.unreached } : {}) };
  const pairs = library.functions.flatMap((fn) => {
    const body = functions.get(fn.id)?.body;
    return body && !fn.disabled && !kept.has(fn.id) ? [{ id: fn.id, galaxy: functionGalaxy(scope, fn, body) }] : [];
  });
  const rendered = pairs.map((pair) => pair.galaxy);
  // What the last compile wrote that this one doesn't: a function now disabled, renamed or Galaxy-bodied.
  const names = new Set(rendered.map((galaxy) => galaxy.name));
  const stale = [...compiled].flatMap((fnId) => {
    const node = libraryElementOf(elements, "FunctionDef", fnId);
    if (kept.has(fnId) || !node) return [];
    const identifier = node.children.find((child) => child.name === "Identifier")?.text.trim();
    const name = strings.get(libraryStringKey(library.id, "FunctionDef", "Name", fnId));
    if (!identifier && name === undefined) return [];
    const was = libraryFunctionName(library.id, { identifier, name: name ?? "", flags: node.children.some((child) => child.name === "FlagNative") ? ["native"] : [] });
    return names.has(was) ? [] : [was];
  });
  const editorScript = await read(files!.script);
  const header = await read(files!.header);
  // The UI Components' scripts, which the Editor would write from their Custom Scripts on save.
  const componentScripts = generated?.customScripts ?? [];
  if (componentScripts.length && (editorScript === undefined || header === undefined)) throw new Error(`The package has no ${editorScript === undefined ? files!.script : files!.header} for the UI Components' scripts to go in: save the mod in the Editor once so it generates the library's Galaxy`);
  const goneScripts = staleComponentScripts(library.id, blueprint.library!, elements, strings, compiledScripts, componentScripts);
  const script = editorScript === undefined ? undefined : spliceCustomScripts(editorScript, library.id, componentScripts, goneScripts);
  /** The library's Galaxy and header, each written only when this compile changes it, or when the last one wrote it, which keeps it on the record (keepScripts). */
  const writeScripts = (scriptContent: string, headerContent: string): void => {
    for (const [file, before, content] of [
      [files!.script, editorScript, scriptContent],
      [files!.header, header, headerContent],
    ] as const) {
      if (content !== before || wroteScripts(file)) scripts.push({ file, content });
    }
  };
  if (rendered.length) {
    if (script === undefined || header === undefined) throw new Error(`The package has no ${script === undefined ? files!.script : files!.header} for the library's Galaxy to go in: save the mod in the Editor once so it generates the library's Galaxy`);
    // A function converted from Kept: its Galaxy is checked against the Editor's.
    for (const { id: fnId, galaxy } of pairs) {
      if (compiled.has(fnId)) continue;
      const editor = definitionIn(script, galaxy.name);
      if (editor !== undefined) check.replaceKept(`galaxy:${files!.script}:${galaxy.name}`, editor, galaxy.definition);
      const declared = declarationIn(header, galaxy.name);
      if (declared !== undefined) check.replaceKept(`galaxy:${files!.header}:${galaxy.name}`, declared, galaxy.declaration);
    }
    writeScripts(spliceDefinitions(removeDefinitions(script, stale), rendered), spliceDeclarations(removeDeclarations(header, stale), rendered));
  } else if ((stale.length || componentScripts.length || goneScripts.length) && script !== undefined && header !== undefined) {
    writeScripts(removeDefinitions(script, stale), removeDeclarations(header, stale));
  } else {
    await keepScripts();
  }

  return {
    triggers: libraryTree(library, elements, [
      ...[...rawItems.values()].map((item) => ({ ref: `${itemKind(item.type)}:${item.id}`, elements: item.elements })),
      ...parts.map((part, index) => ({ ref: `function:${library.functions[index]!.id}`, elements: part.elements })),
      ...items.map(({ part }) => part),
    ]),
    strings: out,
    textKeys: new Set(parts.flatMap((part) => [...elementTextKeys(library.id, part.elements)])),
    scripts,
    bodies: [...bodies.values()],
  };
}

/**
 * The names of the UI Components' Custom Script blocks the last compile wrote into the library's
 * Galaxy and this one doesn't: a component turned off or left without a script, or its block under
 * the name it had before its layout was renamed. A custom script of the Blueprint's own isn't one
 * (the Editor writes its Galaxy), nor one the package has under that name that this compile didn't
 * write. Refuses a component's script named as one of the package's Kept Custom Scripts, whose
 * block it would replace.
 */
function staleComponentScripts(
  library: string,
  own: LibraryInterface,
  elements: LibraryElements,
  strings: ReadonlyMap<string, string>,
  compiledScripts: ReadonlySet<string>,
  componentScripts: readonly LibraryCustomScript[],
): string[] {
  const nameOf = (id: string): string => strings.get(libraryStringKey(library, "CustomScript", "Name", id)) ?? id;
  const blueprintOwn = new Set(own.customScripts.map((script) => script.id));
  const writing = new Map(componentScripts.map((script) => [script.id, script.name ?? script.id]));
  const written = new Set(writing.values());
  /** The package's Custom Scripts that aren't the compile's components', by name: the Kept ones and the Blueprint's own. */
  const others = new Set<string>();
  for (const node of elements.values()) {
    const id = elementIdOf(node);
    if (xmlAttribute(node, "Type") !== "CustomScript" || writing.has(id) || (compiledScripts.has(id) && !blueprintOwn.has(id))) continue;
    const name = nameOf(id);
    if (written.has(name) && !blueprintOwn.has(id)) throw new Error(`The package's Custom Script ${name} (${id}) has the name of a UI Component's script, whose Galaxy block would replace its own: rename the package's in the Editor, or turn the component off`);
    others.add(name);
  }
  return [...compiledScripts].flatMap((id) => {
    if (blueprintOwn.has(id) || !libraryElementOf(elements, "CustomScript", id)) return [];
    const was = nameOf(id);
    return writing.get(id) === was || written.has(was) || others.has(was) ? [] : [was];
  });
}

/**
 * The library's Triggers as the Editor saves it: its Root's item lines (the interface's `root`, then
 * every item no category of it files), then each item's elements, walking Root depth first, each
 * category's items after it, as the Editor orders them. A category may file a Kept item, which the
 * package has: its line is written, its elements stay Kept. Refuses a category or Root filing an
 * item neither the Blueprint nor the package has, and a category inside itself.
 */
function libraryTree(library: LibraryInterface, packaged: LibraryElements, parts: readonly { readonly ref: string; readonly elements: readonly string[] }[]): string {
  const written = new Map(parts.map((part) => [part.ref, part.elements]));
  const categories = new Map(library.categories.map((category) => [category.id, category]));
  const where = new Map<string, string>([
    ...(library.root ?? []).map((ref, index) => [ref, `library.root.${index}`] as const),
    ...library.categories.flatMap((category, index) => category.items.map((ref, at) => [ref, `library.categories.${index}.items.${at} (${category.name ?? category.id})`] as const)),
  ]);
  // Root's order names Kept items as convert-library found them: one the package no longer has (the author deleted it) is gone from it.
  const gone = new Set<string>();
  for (const [ref, at] of where) {
    if (written.has(ref)) continue;
    const [kind, id] = ref.split(":") as [LibraryItemKind, string];
    if (libraryElementOf(packaged, LIBRARY_ITEM_TYPES[kind], id)) continue;
    const other = libraryElementsWithId(packaged, id)[0];
    const type = other && xmlAttribute(other, "Type");
    if (type === undefined && at.startsWith("library.root.")) {
      gone.add(ref);
      continue;
    }
    if (type !== LIBRARY_ITEM_TYPES[kind]) throw new Error(`${at} files ${ref}, which ${type ? `the package has as a ${type}` : "neither the Blueprint nor the package has"}: file each item under its kind (${Object.keys(LIBRARY_ITEM_TYPES).join(", ")}) and id`);
  }
  // Each category's items, and theirs, never reaching it again.
  const inside = (id: string, path: readonly string[]): void => {
    for (const ref of categories.get(id)?.items ?? []) {
      if (!ref.startsWith("category:")) continue;
      const child = ref.slice("category:".length);
      if (path.includes(child)) throw new Error(`The category ${categories.get(child)?.name ?? child} is filed inside itself (${[...path, child].map((each) => categories.get(each)?.name ?? each).join(" > ")})`);
      inside(child, [...path, child]);
    }
  };
  for (const id of categories.keys()) inside(id, [id]);
  const root = [...(library.root ?? []).filter((ref) => !gone.has(ref)), ...parts.map((part) => part.ref).filter((ref) => !where.has(ref))];
  const elements: string[] = [];
  const reached = new Set<string>();
  const visit = (ref: string): void => {
    if (reached.has(ref)) return;
    reached.add(ref);
    elements.push(...(written.get(ref) ?? []));
    if (ref.startsWith("category:")) for (const child of categories.get(ref.slice("category:".length))?.items ?? []) visit(child);
  };
  for (const ref of root) visit(ref);
  return libraryTriggersFile(library.id, root.map((ref) => itemLine(library.id, ref)), elements);
}

/**
 * The game's trigger libraries in the game's packages a mod can depend on, by package path in lower
 * case (Ntve, in every map, aside): SwarmLib is in Swarm's mod, VoidCampaignMissionLib in Void
 * Story's campaign, which sits on Swarm's. Other packages bring none that core knows.
 */
const PACKAGE_LIBRARIES: Readonly<Record<string, readonly GameTriggerLibrary[]>> = {
  "mods/swarm.sc2mod": ["Hots"],
  "campaigns/voidstory.sc2campaign": ["Hots", "VCMI"],
};

/** The game's libraries a mod's dependencies bring (DocumentInfo's `bnet:…,file:<path>` or `file:<path>`), in the game's order. */
export function dependencyLibraries(dependencies: readonly string[]): GameTriggerLibrary[] {
  const found = new Set<GameTriggerLibrary>();
  for (const dependency of dependencies) {
    const file = /(?:^|,)file:(.+)$/.exec(dependency)?.[1];
    for (const library of (file && PACKAGE_LIBRARIES[file.replace(/\\/g, "/").toLowerCase()]) || []) found.add(library);
  }
  return (Object.keys(TRIGGER_LIBRARIES) as GameTriggerLibrary[]).filter((library) => found.has(library));
}

/**
 * The library's functions as typed trigger primitives (ADR-0002), for Mission compiles: each a
 * FunctionDef by its Galaxy identifier, its parameters by identifier in definition order. A map
 * that loads the mod holds its library in reach, so the compile writes a call to one from the
 * library's interface, as lib<library>_gf_<identifier>(…) (ADR-0025, #974). Two keep a call of
 * their own, with their arguments alone: an event, since the engine passes the trigger it binds to
 * first, which no Workspace's library has needed yet; and a function of `uiComponents` (a UI
 * Component's, which the Mod Blueprint's interface doesn't declare, so its library in reach lacks
 * it until the mod's package is compiled). `requires` are the game's libraries the mod's
 * dependencies bring, which a map calling it includes.
 */
export function libraryPrimitives(library: LibraryInterface, requires: readonly GameTriggerLibrary[] = [], uiComponents: ReadonlySet<string> = new Set()): Readonly<Record<string, FunctionDef>> {
  const out: Record<string, FunctionDef> = {};
  for (const fn of library.functions) {
    // A disabled function has no Galaxy (the Editor writes none), so a Mission's call would fail to load.
    if (fn.disabled || fn.script !== undefined || fn.flags.includes("inline") || fn.subFunctions.length > 0) continue;
    const params = fn.parameters.map((parameter) => ({ key: parameterKey(parameter), id: parameter.id }));
    const name = libraryFunctionName(library.id, fn);
    out[identifierOf(fn)] = {
      library: library.id,
      id: fn.id,
      kind: fn.kind,
      params: Object.fromEntries(params.map(({ key, id }) => [key, { id }])),
      ...(fn.kind === "event" || uiComponents.has(fn.id) ? { galaxy: (args: Readonly<Record<string, string>>) => `${name}(${params.map(({ key }) => args[key]).join(", ")})` } : {}),
      ...(requires.length ? { requires } : {}),
    };
  }
  return out;
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** A parameter's key in its FunctionDef's params: its Galaxy identifier, lower first. */
const parameterKey = (parameter: Pick<LibraryParameter, "identifier" | "name">): string => lowerFirst(parameter.identifier ?? galaxyIdentifier(parameter.name));

/** The Campaign Mod's library `library` declares, its functions as libraryPrimitives gives them; `declaredIn` names it for a call it lacks. */
export function campaignLibraryOf(
  library: LibraryInterface,
  label: string,
  declaredIn: string,
  requires: readonly GameTriggerLibrary[] = [],
  ui?: { readonly field: UiField | undefined; readonly registry: readonly UiComponent[]; readonly mod: string },
): CampaignLibrary {
  // The UI Components the mod turns on add their functions, as its compile does (modUi); a `ui` its
  // compile would refuse offers none, so a Mission with no UI action still compiles, and a UI action
  // says why. Built on first use, so a Mission that calls nothing in the library builds none of it.
  let built: { readonly whole: LibraryInterface; readonly refused?: Error; readonly functions: Readonly<Record<string, FunctionDef>> } | undefined;
  const made = (): NonNullable<typeof built> => {
    if (built) return built;
    let whole = library;
    let refused: Error | undefined;
    try {
      if (ui) whole = modUi({ ui: ui.field, library }, ui.registry).library ?? library;
    } catch (error) {
      refused = error as Error;
    }
    built = { whole, ...(refused ? { refused } : {}), functions: libraryPrimitives(whole, requires, uiComponentFunctions(library, whole)) };
    return built;
  };
  const lookUp = (identifier: string): FunctionDef => {
    const { whole, functions } = made();
    const found = functions[identifier];
    const disabled = whole.functions.find((fn) => fn.disabled && identifierOf(fn) === identifier);
    if (!found && disabled) throw new Error(`${label}'s library ${library.id}'s function ${identifier} is disabled in its interface (${declaredIn}): enable it, since the Editor writes no Galaxy for a disabled function`);
    if (!found) throw new Error(`${label}'s library ${library.id} has no function ${identifier} (its interface, ${declaredIn}, declares ${Object.keys(functions).join(", ") || "none"})`);
    return found;
  };
  return {
    id: library.id,
    get functions() {
      return made().functions;
    },
    function: lookUp,
    ...(ui
      ? {
          uiCall: (action: string, params: unknown, mission: UiActionContext) => {
            const { whole, refused } = made();
            if (refused) throw new Error(`${action} can't be called, since ${ui.mod}'s Mod Blueprint (${declaredIn}) won't compile: ${refused.message}`);
            const call = campaignUiCall(action, params, ui.registry, { ui: ui.field, label: ui.mod, shown: declaredIn }, mission);
            const def = lookUp(call.function);
            const fn = whole.functions.find((each) => identifierOf(each) === call.function);
            const types = Object.fromEntries((fn?.parameters ?? []).map((parameter) => [parameterKey(parameter), parameter.type]));
            return { def, args: uiCallArgs(def, call, types) };
          },
        }
      : {}),
  };
}

/** The functions of `whole` that `declared`, the interface it was made from, doesn't hold: the UI Components'. */
const uiComponentFunctions = (declared: LibraryInterface, whole: LibraryInterface): Set<string> => {
  const own = new Set(declared.functions.map((fn) => fn.id));
  return new Set(whole.functions.flatMap((fn) => (own.has(fn.id) ? [] : [fn.id])));
};

/** A library none of whose functions can be called, each call failing with `reason`. */
const unavailableLibrary = (reason: string): CampaignLibrary => ({
  functions: {},
  function: (identifier) => {
    throw new Error(`No Campaign Mod library declares ${identifier}: ${reason}`);
  },
  uiCall: (action) => {
    throw new Error(`${action} is a UI Component's action, which the Campaign Mod's library would hold: ${reason}`);
  },
});

/**
 * The Workspace's Campaign Mod's library, as its Blueprint's Library Interface declares it. None
 * when neither the Workspace config nor its Campaign Pack names a Campaign Mod. When the
 * Workspace hasn't imported it, its Blueprint can't be read, it is an Asset Mod or it declares no
 * library, a call to it fails, saying which, so a Mission compile doesn't hide a broken Blueprint
 * behind a missing function.
 */
export async function workspaceLibrary(workspace: Workspace, uiComponents: readonly UiComponent[] = UI_COMPONENTS): Promise<CampaignLibrary> {
  const mod = await campaignModBlueprint(workspace);
  if (mod.found === "none") return NO_LIBRARY;
  if (mod.found === "missing") return unavailableLibrary(`the Campaign Mod ${mod.name} isn't in the Workspace: import ${mod.name}${MOD_PACKAGE_EXTENSION} with import-mod`);
  if (mod.found === "unreadable") return unavailableLibrary(`the Campaign Mod ${mod.name}'s Blueprint (${mod.shown}) can't be read: ${mod.reason}`);
  if (mod.blueprint.kind !== "campaign") return unavailableLibrary(`${mod.name} (${mod.shown}), named as the Campaign Mod, is an Asset Mod: make it a Campaign Mod`);
  if (!mod.blueprint.library) return unavailableLibrary(`the Campaign Mod ${mod.name}'s Blueprint (${mod.shown}) declares no library: declare it there`);
  return campaignLibraryOf(mod.blueprint.library, `The Campaign Mod ${mod.name}`, mod.shown, dependencyLibraries(mod.blueprint.dependencies), { field: mod.blueprint.ui, registry: uiComponents, mod: `the Campaign Mod ${mod.name}` });
}
