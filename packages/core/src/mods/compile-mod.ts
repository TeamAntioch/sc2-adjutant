// Compiles a Mod Blueprint into its committed mod package in place, under ADR-0010's compile
// record (ADR-0011). The Blueprint's Compiled Content goes in through the merging writers of a
// Mission's compile (src/map/package-output.ts), each replacing only what the record lists and
// leaving every Kept byte as the Editor wrote it:
//
//   gameData   catalog entries, by entry, into their GameData files       catalog-entry
//   entries    generic typed entries, and the purpose-level shapes'      catalog-entry
//              (characters, custom doodads, Screenplays' conversations)
//              compiled down to them, a doodad's files checked first
//              (custom-doodads.ts)
//   strings    keys of the localized strings files: the Blueprint's raw    string
//              ones, each entry's own (entry-strings.ts) and DocInfo's
//              from the Blueprint's name and description
//   triggers   the library's triggers and globals, spliced into Triggers   trigger, variable
//              (filed by the library's categories), and their names      string
//   files      scripts, cutscenes, UI files and plain files, whole         file
//              (layouts with CRLF endings, as the Editor saves them)
//   ui         each UI Component's layout, and its functions in the        file, function
//              library (src/ui/components.ts)
//   soundSets  a conversation's CSounds, from the Asset Mod's sources      catalog-entry
//   cinematics a Screenplay scene's shot list on its Sets, as the          file
//              .SC2Cutscene its cue plays (mod-cinematics.ts)
//   assets,    an Asset Mod's files from their Asset Sources, whole        file, or uncommitted for
//   voices     (asset-sources.ts)                                          one each machine makes
//   includes   the includes list (Base.SC2Data/GameData.xml), in order,   file
//              with the catalog files written outside the standard ones
//   removals   Kept strings, keyless lines and files dropped on purpose   (none: gone from the
//              (removals.ts)                                               package)
//
// and once it owns anything, the package files it generates: DocumentInfo and DocumentHeader with
// the Blueprint's dependencies, the ComponentList and the components' .version stamps
// (mod-package-files.ts), and once the Blueprint has a layout, the DescIndex that loads each one,
// the UI Components' first (ADR-0019). A part the Blueprint writes over a Kept one is converted, under the
// Equivalence Check (equivalence.ts). Compiled Content the Editor has changed since stops the
// compile, as a Mission's does, until the author keeps or discards each change. As Import leaves
// it, a Mod Blueprint owns at most the includes list, as the package has it, so the first compile
// after Import changes nothing in the package.

import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { type CompileRecord, type CompileRecordEntry, entryName } from "../domain/compile-record.js";
import { GAME_DATA_DIR, type ModBlueprint, parseRemoval, removalOfLine } from "../domain/mod-blueprint.js";
import { LOCALIZED_STRINGS_FILE } from "../domain/entry-strings.js";
import { catalogEntries } from "../map/catalog-entries.js";
import { scriptLines } from "../script/name-script.js";
import { type EditorDecisions, EditorChangesError, formatEditorChanges, keptFunctions, TRIGGER_STRINGS } from "../map/editor-changes.js";
import { readCompileRecord, saveCompileRecord } from "../map/mission-package.js";
import { PackageOutput } from "../map/package-output.js";
import { machineDerive } from "../host/derive.js";
import { loadHost, type Host } from "../host/host.js";
import { loadMachineConfig, type MachineConfig } from "../host/machine-config.js";
import { workspaceFor, workspaceModsFor, type Workspace } from "../plugins/workspace.js";
import { stringLines } from "../map/package-elements.js";
import { triggerItemTexts } from "../triggers/splice-triggers.js";
import { isInside } from "../util/inside.js";
import { type Derive, type Fetch, makeAssets, type Placeholder, PLACEHOLDERS_DIR, planAssets, trackedByGit } from "./asset-sources.js";
import { genericEntries, includesListFor, ownedStringsProblems, packageEol, readRawEntries, StringsTable } from "./declared-parts.js";
import { shapeEntries } from "./characters.js";
import { type FoundFile, hostGameModels, modDoodadWarnings, modFileFinder, samePath } from "./custom-doodads.js";
import { CONVERSATION_STRINGS, conversationEntry, conversationStrings, type ModScript, readModScreenplays } from "./conversations.js";
import { CUTSCENE_ASPECTS, cutsceneDifferences } from "../cutscene/compare-cutscenes.js";
import { type Conversion, EquivalenceCheck } from "./equivalence.js";
import { entryXml, genericEntryKey } from "./generic-entries.js";
import { libraryParts } from "./library.js";
import { dependencyReach } from "./library-reach.js";
import { libraryElementOf, libraryElements, libraryElementsWithId, libraryStringKey, paramExpressionKey, paramValueKey } from "./library-xml.js";
import { xmlAttribute } from "../util/xml.js";
import { modCutscenes, modSetCutscenes } from "./mod-cinematics.js";
import { castModels } from "../cutscene/cinematic.js";
import { MOD_PACKAGE_EXTENSION, modPackage, readModBlueprint } from "./workspace-mods.js";
import { includedCatalogs, includesFile, INCLUDES_FILE, standardCatalogFile } from "./game-data-files.js";
import { DESC_INDEX, descIndexLayouts, isBaseLayout, isDescIndex, isLayout, PACKAGE_FILES, modPackageFiles, packageFiles } from "./mod-package-files.js";
import { descIndex, layoutWithCrlf } from "../ui/layout-writer.js";
import { componentLayouts, modUi } from "../ui/components.js";
import { UI_COMPONENTS } from "../ui/core-components.js";
import type { UiComponent } from "../ui/ui-component.js";
import { fileNamedKeys, textParamValueKeys } from "./owned-strings.js";
import { modPreloads } from "./preloads.js";
import { namedIn, stringsWithoutRemovals } from "./removals.js";
import { soundSetEntries } from "./sound-sets.js";

export { CatalogSchemaError } from "./catalog-schema.js";
export { EquivalenceError } from "./equivalence.js";

export type CompileModOptions = {
  /** What the author decided for each Compiled part the Editor changed (--keep, --discard). */
  readonly decisions?: EditorDecisions;
  /**
   * The Workspace the mod is in, whose Campaign Pack names its Screenplays' lines and whose mods
   * give a sound set's Asset Sources or a voice's lines; found above the Blueprint when not given,
   * and only read when the Blueprint needs it.
   */
  readonly workspace?: Workspace;
  /** The machine, whose Host Adapter speaks placeholder voices and whose cacheDir holds community assets; the machine config's when not given. */
  readonly host?: Host;
  /** Downloads a community asset not yet in the machine's cache; the global fetch when not given. */
  readonly fetch?: Fetch;
  /** Makes a derived Asset Source by its named step; ffmpeg when not given. */
  readonly derive?: Derive;
  /** The UI Components the Blueprint's `ui` turns on come from; core's when not given. */
  readonly uiComponents?: readonly UiComponent[];
};

export type CompiledMod = {
  readonly modPackage: string;
  readonly record: CompileRecord;
  /** Each part this compile converted from Kept, equivalent or with its Accepted Difference. */
  readonly conversions: readonly Conversion[];
  /** Advice for the author that didn't stop the compile. */
  readonly warnings: readonly string[];
  /** The Asset Mod's voice files that are placeholders, each line's, and why it has no recording. */
  readonly placeholders: readonly Placeholder[];
  /** The Accepted Removals this compile found in the package and removed. */
  readonly removed: readonly { readonly item: string; readonly reason: string }[];
};

/**
 * Whether the Blueprint owns any Compiled Content beyond the includes list: as Import writes it, it
 * owns none. The includes list alone, as Import fills it in, changes no package file.
 */
export const ownsContent = (blueprint: ModBlueprint): boolean =>
  blueprint.name !== undefined ||
  blueprint.description !== undefined ||
  blueprint.gameData.length > 0 ||
  blueprint.entries.length > 0 ||
  blueprint.characters.length > 0 ||
  blueprint.doodads.length > 0 ||
  blueprint.library !== undefined ||
  // A `ui` turning no component on (`"ui": {}`) owns nothing, as no `ui` doesn't.
  Object.keys(blueprint.ui ?? {}).length > 0 ||
  blueprint.screenplays.length > 0 ||
  Object.keys(blueprint.strings).length > 0 ||
  blueprint.triggers !== undefined ||
  blueprint.files.length > 0 ||
  blueprint.soundSets.length > 0 ||
  blueprint.cinematics.length > 0 ||
  blueprint.setCutscenes.length > 0 ||
  blueprint.assets.length > 0 ||
  blueprint.voices.length > 0;

/** Compiles the Mod Blueprint at `blueprintPath` into the mod package beside it, as above. */
export async function compileMod(blueprintPath: string, options: CompileModOptions = {}): Promise<CompiledMod> {
  const blueprint = await readModBlueprint(blueprintPath);
  const pkg = await modPackage(blueprintPath);
  const record = await readCompileRecord(blueprintPath);
  if (!record) throw new Error(`${blueprintPath} has no compile record beside it: import the mod with import-mod, which writes an empty one`);
  const dir = path.dirname(blueprintPath);
  const check = new EquivalenceCheck(blueprint.acceptedDifferences);
  let modWorkspace: Promise<Workspace> | undefined;
  const workspace = (): Promise<Workspace> => (modWorkspace ??= options.workspace ? Promise.resolve(options.workspace) : workspaceFor(blueprintPath));

  const source = async (file: string): Promise<Buffer> => {
    const full = path.join(dir, file);
    if (!(await isInside(dir, full))) throw new Error(`The Mod Blueprint's source ${file} isn't in the mod's folder ${dir}`);
    try {
      return await readFile(full);
    } catch (error) {
      throw new Error(`The Mod Blueprint's source ${file} can't be read: ${(error as Error).message}`, { cause: error });
    }
  };
  const queued = new Map<string, string>();
  const claim = (file: string, by: string): void => {
    const other = queued.get(file);
    if (other) throw new Error(`The Mod Blueprint writes ${file} twice, in ${other} and in ${by}: a file has one writer`);
    if (isDescIndex(file)) throw new Error(`${by} writes ${file}, which the compile generates now from the layouts in the Blueprint's files, in their order: leave it out of the Blueprint`);
    if ((PACKAGE_FILES as readonly string[]).includes(file) || file.endsWith(".version")) throw new Error(`${by} writes ${file}, which the compile generates: leave it out of the Blueprint`);
    queued.set(file, by);
  };

  const existing = await packageFiles(pkg);
  /** A GameData file as the package spells it, or as an earlier writer did: the game reads its files in any case, so one file is one writer. */
  const spelled = (file: string): string => {
    const lower = file.toLowerCase();
    return existing.find((name) => name.toLowerCase() === lower) ?? [...queued.keys()].find((name) => name.toLowerCase() === lower) ?? file;
  };
  const gameDataFiles = blueprint.gameData.map(({ file }, index) => {
    const named = spelled(file);
    claim(named, `gameData.${index}`);
    return named;
  });
  // The mod's triggers are its library's: the package's, which the Blueprint's and its library interface's must be.
  const libraries = (text: string): string[] => [...text.matchAll(/<Library\s+Id="([^"]*)"/g)].map((match) => match[1]!);
  const packageTriggers = existing.includes("Triggers") ? await readFile(path.join(pkg, "Triggers"), "utf8") : "";
  let libraryId = libraries(packageTriggers)[0] ?? blueprint.library?.id;
  let triggers: string | undefined;
  if (blueprint.triggers) {
    claim("Triggers", "triggers");
    triggers = (await source(blueprint.triggers.source)).toString("utf8");
    const other = [...triggers.matchAll(/<Item Type="([^"]+)"/g)].map((match) => match[1]!).filter((type) => type !== "Trigger" && type !== "Variable");
    if (other.length > 0) throw new Error(`The Mod Blueprint's triggers (${blueprint.triggers.source}) file ${[...new Set(other)].join(", ")} items: a Mod Blueprint owns a library's triggers and globals there, filed in Root, and its functions in its library interface`);
    const [own, ...more] = libraries(triggers);
    if (own === undefined) throw new Error(`The Mod Blueprint's triggers (${blueprint.triggers.source}) has no <Library Id>: a mod's triggers are its library's`);
    if (more.length > 0 || libraries(packageTriggers).length > 1) throw new Error(`The Mod Blueprint's triggers and the package's Triggers each hold one library, the mod's: ${more.length > 0 ? blueprint.triggers.source : "the package's Triggers"} has more`);
    if (libraryId !== undefined && own !== libraryId) throw new Error(`The Mod Blueprint's triggers (${blueprint.triggers.source}) are library ${own}, but the ${libraries(packageTriggers).length > 0 ? "package's Triggers" : "library interface"} is library ${libraryId}: write them in the mod's library`);
    libraryId = own;
    const strays = [...new Set([...triggers.matchAll(/<Item Type="[^"]+" Library="([^"]*)"/g)].map((match) => match[1]!).filter((id) => id !== libraryId))];
    if (strays.length > 0) throw new Error(`The Mod Blueprint's triggers (${blueprint.triggers.source}) file items of library ${strays.join(", ")} in library ${libraryId}: each item line names the mod's library`);
    if (triggerItemTexts(triggers, { library: libraryId }).size === 0) throw new Error(`The Mod Blueprint's triggers (${blueprint.triggers.source}) has no trigger or global in its library's Root`);
  }
  // Accepted Removals: dropped from the package, and from the Kept original a whole strings file's conversion is compared with.
  const removals = blueprint.removals.map(({ item, reason }) => ({ item, reason, removal: parseRemoval(item) }));
  for (const { item, removal } of removals) {
    if (removal.kind === "file" && ((PACKAGE_FILES as readonly string[]).includes(removal.path) || removal.path.endsWith(".version"))) throw new Error(`removals names ${item}, which the compile generates: it can't be removed`);
  }
  const removing = new Set(removals.map(({ item }) => item));
  /** The removals a whole strings file's conversion left out of it. */
  const removedWhole = new Set<string>();
  const replaceKept = (item: string, kept: string | Uint8Array, compiled: string | Uint8Array): boolean => {
    // A removed item written back fails as that (below), not as a difference too.
    if (removing.has(item)) return false;
    const file = item.startsWith("file:") ? item.slice("file:".length) : undefined;
    if (file === undefined || !LOCALIZED_STRINGS_FILE.test(file)) return check.replaceKept(item, kept, compiled);
    const less = stringsWithoutRemovals(file, Buffer.from(kept).toString("utf8"), removals.map(({ removal }) => removal));
    for (const name of less.removed) removedWhole.add(name);
    return check.replaceKept(item, less.text, compiled);
  };
  const output = new PackageOutput(pkg, record, options.decisions, replaceKept, { library: libraryId });
  output.removeKept(removals.map(({ removal }) => removal));

  // The includes list (Base.SC2Data/GameData.xml): the Blueprint's, written from its includes,
  // unless it has none and the package has a list, which is then Kept (or files writes one).
  // A list the last compile wrote stays the Blueprint's, as one it writes new does.
  const listFile = includesFile(existing);
  const listWriter = blueprint.files.findIndex(({ path: file }) => includesFile([file]) !== undefined);
  if (blueprint.includes !== undefined && listWriter >= 0) throw new Error(`files.${listWriter} writes ${blueprint.files[listWriter]!.path}, the includes list, which the Blueprint's includes write: leave it to includes`);
  const wroteList = listFile !== undefined && record.entries.some((entry) => entry.kind === "file" && entry.path === listFile);
  const ownsList = blueprint.includes !== undefined || (listWriter < 0 && (listFile === undefined || wroteList));
  const keptIncludes = ownsList ? new Set<string>() : await includedCatalogs(pkg, existing);
  /** Each catalog file's entries the Blueprint owns, raw and generic, by file. */
  const catalogs = new Map<string, string[]>();
  const addEntries = (file: string, by: string, texts: readonly string[]): void => {
    // The game loads a catalog file in GameData itself by its name, any other only through the includes list: the Blueprint's adds it, a Kept one must name it.
    if (!ownsList && !existing.includes(file) && !standardCatalogFile(file) && !keptIncludes.has(file.toLowerCase())) {
      throw new Error(`${by} writes ${file}, which the package's includes list doesn't name: give the Blueprint its includes (the catalog files the list names, in load order), and the compile adds it to the list`);
    }
    const list = catalogs.get(file);
    if (list) list.push(...texts);
    else catalogs.set(file, [...texts]);
  };
  for (const { index, texts } of await readRawEntries(blueprint.gameData, source)) addEntries(gameDataFiles[index]!, `gameData.${index}`, texts);
  // The Screenplays, named with the Campaign Pack's naming template (conversations.ts).
  const registry = blueprint.screenplays.length > 0 ? (await workspace()).registry : undefined;
  const scripts = registry ? await readModScreenplays(blueprint, registry, blueprintPath, source) : [];
  const name = path.basename(pkg).slice(0, -MOD_PACKAGE_EXTENSION.length);
  // The machine, loaded once and only when a step needs it: a gameModel's swaps, the Asset Mod's files.
  let host: Promise<Host> | undefined;
  let machine: Promise<MachineConfig> | undefined;
  const machineHost = (): Promise<Host> => (host ??= options.host ? Promise.resolve(options.host) : loadMachineConfig().then((machine) => loadHost(machine)));
  // The custom doodads' model and texture files, before any of their entries is written (custom-doodads.ts).
  // A gameModel's swaps read the game's .m3 through the Host Adapter, loaded only when one does.
  const doodads = blueprint.doodads.length > 0 ? await modDoodadWarnings(blueprint.doodads, await workspace(), blueprint.id, async () => hostGameModels(await machineHost())) : undefined;
  const doodadWarnings = doodads?.warnings ?? [];
  // The hotkey lines the package Keeps, which the missing-hotkey check counts (button-hotkeys.ts).
  const keptHotkeys = await Promise.all(existing.filter((file) => /(^|\/)enUS\.SC2Data\/LocalizedData\/GameHotkeys\.txt$/i.test(file)).map((file) => readFile(path.join(pkg, ...file.split("/")), "utf8")));
  // The files an entry's asset path can name: the mod packages, and what this compile writes (not on disk yet).
  const blueprintFiles = new Set([...blueprint.files, ...blueprint.assets].map(({ path: file }) => samePath(file.replace(/^Base\.SC2Assets[\\/]/i, ""))));
  const assetFiles = async (): Promise<{ readonly find: (storagePath: string) => FoundFile | undefined; readonly lookedIn: string }> => {
    const { find, lookedIn } = await modFileFinder(await workspace(), blueprint.id);
    return { find: (storagePath) => find(storagePath) ?? (blueprintFiles.has(samePath(storagePath)) ? { data: new Uint8Array(), where: "the Blueprint's files" } : undefined), lookedIn };
  };
  const { byFile: generic, strings: entryStrings, warnings: dataWarnings } = await genericEntries(
    blueprint,
    source,
    [
      ...shapeEntries(blueprint, doodads?.swaps ?? new Map()),
      { from: "screenplays", entries: scripts.map(conversationEntry) },
      { from: "soundSets", entries: await soundSetEntries(blueprint, name, scripts, workspace) },
    ],
    assetFiles,
    keptHotkeys,
  );
  for (const [asked, entries] of generic) {
    const file = spelled(asked);
    if (!queued.has(file)) claim(file, `entries (${file})`);
    addEntries(file, `entries`, entries.map(entryXml));
  }
  /** Advice on the includes list: a catalog file it adds, or a listed one it leaves out. */
  const includeWarnings: string[] = [];
  /** The files other than catalogs this compile writes, as written, for the preloads. */
  const writes = new Map<string, string | Uint8Array>();
  const write = (file: string, content: string | Uint8Array, kind: "strings" | "triggers" | "generated" | "file"): void => {
    writes.set(file, content);
    output.write(file, content, kind);
  };
  /** Each CSound the mod will have: the package's Kept ones and those the Blueprint writes. */
  const soundIds = new Set<string>();
  for (const file of existing.filter((name) => name.startsWith(GAME_DATA_DIR) && name.toLowerCase().endsWith(".xml"))) {
    const text = await readFile(path.join(pkg, ...file.split("/")), "utf8");
    if (text.includes("<CSound")) for (const entry of catalogEntries(text)) if (entry.className === "CSound" && entry.id) soundIds.add(entry.id.toLowerCase());
  }
  for (const texts of catalogs.values()) for (const entry of catalogEntries(`<Catalog>${texts.join("\n")}</Catalog>`)) if (entry.className === "CSound" && entry.id) soundIds.add(entry.id.toLowerCase());
  for (const [file, texts] of catalogs) output.write(file, `<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n${texts.map((text) => `${text}\n`).join("")}</Catalog>\n`, "catalog");

  // The library: its functions in Triggers, their strings, their Galaxy and Galaxy bodies (library.ts).
  const compiledFunctions = new Set(record.entries.flatMap((entry) => (entry.kind === "function" ? [entry.id] : [])));
  const compiledScripts = new Set(record.entries.flatMap((entry) => (entry.kind === "custom-script" ? [entry.id] : [])));
  const recordedFile = (file: string): boolean => record.entries.some((entry) => entry.kind === "file" && entry.path === file);
  const kept = await keptFunctions(pkg, record, options.decisions ?? {}, { library: libraryId });
  // The UI Components the Blueprint turns on: their layouts, and their functions in the library (ADR-0019).
  const { components, generated } = modUi(blueprint, options.uiComponents ?? UI_COMPONENTS);
  // The libraries of the mods it depends on are in reach of its functions' Galaxy, as the game's are (#942).
  // Its Workspace's mods are those of the Workspace the compile has loaded, where it has; else read without loading its Plugins.
  const reachWorkspace = async () => options.workspace ?? (modWorkspace ? await modWorkspace : await workspaceModsFor(blueprintPath));
  const reach = (blueprint.library ?? generated) ? await dependencyReach(pkg, blueprint.dependencies, await reachWorkspace()) : undefined;
  const library = await libraryParts(blueprint, pkg, source, { wroteScripts: recordedFile, check, compiled: compiledFunctions, compiledScripts, kept, triggers, ...(generated ? { generated } : {}), ...(reach ? { reach } : {}) });

  const table = new StringsTable(blueprint.strings);
  const strings = table.files;
  const addStrings = (file: string, keys: Record<string, string>, by: string, writer?: string): void => table.add(file, keys, by, writer);
  addStrings(TRIGGER_STRINGS, library.strings, "the library");
  // The words of the library's text values, each in its own strings file.
  if (blueprint.library?.strings) {
    ownedStringsProblems("library.strings", blueprint.library.strings, library.textKeys, `a text parameter or text expression of the library's functions (${paramValueKey(libraryId!, "<id>")}, ${paramExpressionKey(libraryId!, "<id>")})`);
    for (const [file, keys] of Object.entries(blueprint.library.strings)) addStrings(file, keys, "library.strings", "the library");
  }
  if (triggers !== undefined) addStrings(TRIGGER_STRINGS, triggerNames(triggers, libraryId!, blueprint.triggers!.names), "triggers.names");
  // The triggers' text parameters' values, and the strings a file names, each in its own strings file.
  if (triggers !== undefined && blueprint.triggers!.strings) {
    const named = textParamValueKeys(triggers, libraryId!);
    ownedStringsProblems("triggers.strings", blueprint.triggers!.strings, named, `a text parameter of the Blueprint's triggers (${paramValueKey(libraryId!, "<id>")})`);
    for (const [file, keys] of Object.entries(blueprint.triggers!.strings)) addStrings(file, keys, "triggers.strings", "the Blueprint's triggers");
  }
  const fileSources = await Promise.all(blueprint.files.map(({ source: from }) => source(from)));
  blueprint.files.forEach(({ strings: given }, index) => {
    if (!given) return;
    ownedStringsProblems(`files.${index}`, given, fileNamedKeys(fileSources[index]!.toString("utf8")), `one ${blueprint.files[index]!.source} names as @<key>`);
    for (const [file, keys] of Object.entries(given)) addStrings(file, keys, `files.${index}`, "the Blueprint's files");
  });
  for (const read of scripts) addStrings(CONVERSATION_STRINGS, conversationStrings(read), `screenplays.${read.index}`);
  for (const { from, entry } of entryStrings) for (const [file, keys] of Object.entries(entry.strings ?? {})) addStrings(file, keys, `${from} (${genericEntryKey(entry)})`, "the Blueprint's entries");
  const docInfo = docInfoStrings(blueprint);
  const twice = Object.keys(docInfo).filter((key) => blueprint.strings[GAME_STRINGS]?.[key] !== undefined);
  if (twice.length > 0) throw new Error(`The Blueprint's strings give ${twice.join(", ")}, which its name and description do: leave them to those`);
  addStrings(GAME_STRINGS, docInfo, "the Blueprint's name and description");
  for (const [file, keys] of Object.entries(strings)) {
    claim(file, table.writerOf(file));
    const eol = await packageEol(pkg, file);
    write(file, `\uFEFF${Object.entries(keys).map(([key, value]) => `${key}=${value}${eol}`).join("")}`, "strings");
  }
  for (const { file, content } of library.scripts) {
    claim(file, "library");
    write(file, content, "generated");
  }
  for (const { file, content, by } of library.bodies) {
    claim(file, `library (${by})`);
    write(file, content, "file");
  }

  if (!blueprint.triggers && library.triggers) claim("Triggers", "library");
  const triggersFile = library.triggers ?? triggers;
  if (triggersFile !== undefined) write("Triggers", triggersFile, "triggers");

  const ownLayouts = componentLayouts(components);
  for (const { file, by } of ownLayouts) claim(file, by);
  blueprint.files.forEach(({ path: file }, index) => claim(file, `files.${index}`));
  for (const { file, content } of ownLayouts) write(file, content, "file");
  // A layout with CRLF endings, as the Editor saves it, so a save in the Editor isn't an edit.
  blueprint.files.forEach(({ path: file }, index) => write(file, isLayout(file) ? layoutWithCrlf(fileSources[index]!) : new Uint8Array(fileSources[index]!), "file"));
  // The DescIndex, loading the UI Components' layouts, then each of the Blueprint's in Base.SC2Data in its order, so a hand-written one can override a generated default (ADR-0019).
  const layouts = descIndexLayouts([...ownLayouts.map(({ file }) => file), ...blueprint.files.map(({ path: file }) => file)]);
  /** Advice on the layouts: a Kept one the DescIndex doesn't load. */
  const layoutWarnings: string[] = [];
  const fileRemovals = new Set(removals.flatMap(({ removal }) => (removal.kind === "file" ? [removal.path.toLowerCase()] : [])));
  if (layouts.length > 0) {
    // As the package spells it, so a Kept one is replaced; queued without a claim, which refuses every other writer of it.
    const descIndexFile = spelled(DESC_INDEX);
    queued.set(descIndexFile, "the DescIndex");
    write(descIndexFile, descIndex(layouts), "file");
    const writing = new Set([...queued.keys()].map((file) => file.toLowerCase()));
    const recorded = new Set(record.entries.flatMap((entry) => (entry.kind === "file" ? [entry.path.toLowerCase()] : [])));
    for (const file of existing) {
      const lower = file.toLowerCase();
      if (!isBaseLayout(file) || isDescIndex(file) || writing.has(lower) || fileRemovals.has(lower) || recorded.has(lower)) continue;
      layoutWarnings.push(`${file} is Kept, so the generated DescIndex doesn't load it, and the game won't: convert it with convert-files to put it in the Blueprint's files, or remove it`);
    }
  }

  // The Cinematics, each scene's shot list on its Sets as the cutscene its cue plays (mod-cinematics.ts).
  const cutscenes = blueprint.cinematics.length > 0 ? await modCutscenes(blueprint, blueprintPath, await workspace(), scripts) : [];
  for (const { index, file, xml } of cutscenes) {
    claim(file, `cinematics.${index}`);
    // A rebuild never matches a hand-built scene keyframe for keyframe: it's compared by what plays.
    check.byAspect(`file:${file}`, cutsceneDifferences, CUTSCENE_ASPECTS);
    output.write(file, xml, "file");
  }
  // The Set cutscenes, each Set written back with no shots, so its room opens in the Cutscene Editor (set-cutscene.ts).
  const setCutscenes = blueprint.setCutscenes.length > 0 ? await modSetCutscenes(blueprint, blueprintPath, await castModels((await workspace()).catalog)) : [];
  for (const { index, file, xml } of setCutscenes) {
    claim(file, `setCutscenes.${index}`);
    check.byAspect(`file:${file}`, (kept, compiled) => cutsceneDifferences(kept, compiled, "the Set cutscene"), CUTSCENE_ASPECTS);
    output.write(file, xml, "file");
  }

  // The Asset Mod's files, from their Asset Sources (asset-sources.ts), each claimed before any is fetched, spoken or encoded.
  const assets = await planAssets(blueprint, dir, workspace);
  for (const asset of assets.files) claim(asset.path, asset.from);
  const { files: made, warnings: assetWarnings } = await makeAssets(assets, {
    modDir: dir,
    host: machineHost,
    fetch: options.fetch ?? ((url) => fetch(url)),
    // ffmpeg, cached by content in the machine's cache, so an unchanged placeholder isn't encoded
    // again: only the machine config is read for it, never the Host Adapter.
    derive: options.derive ?? (async (step, input) => machineDerive(options.host?.machine ?? (await (machine ??= loadMachineConfig())))(step, input)),
  });
  // A recording this machine doesn't have leaves its voice file as the package has it, and its record entry as the last compile wrote it.
  const held = new Set(assets.files.flatMap((asset) => (asset.held ? [asset.path] : [])));
  output.keep(held);
  const carried = record.entries.filter((entry) => (entry.kind === "file" || entry.kind === "uncommitted") && held.has(entry.path));
  for (const asset of assets.files) {
    if (asset.held) continue;
    output.write(asset.path, made.get(asset.path)!, "file");
    if (asset.placeholder) check.note(`file:${asset.path}`, `${asset.placeholder.line} (${asset.placeholder.speaker}) has a placeholder, since ${asset.placeholder.reason}`);
  }
  const uncommitted = new Set([
    ...assets.files.filter((asset) => !asset.committed && !asset.held).map((asset) => asset.path),
    ...carried.flatMap((entry) => (entry.kind === "uncommitted" ? [entry.path] : [])),
  ]);
  /** The record as this compile leaves it: each uncommitted file without a fingerprint, and each held file's entry carried. */
  const settle = (next: CompileRecord): CompileRecord => uncommit({ ...next, entries: carryEntries(next.entries, carried, record.entries) }, uncommitted);

  // The includes list, from the Blueprint's includes and the catalog files it writes outside the standard ones.
  if (ownsList) {
    // Gone once this compile is done: an Accepted Removal's file, and a whole file the last compile wrote and this one doesn't.
    const removed = [
      ...removals.flatMap(({ removal }) => (removal.kind === "file" ? [removal.path] : [])),
      ...record.entries.flatMap((entry) => (entry.kind === "file" && !queued.has(entry.path) ? [entry.path] : [])),
    ];
    const list = await includesListFor(blueprint.includes ?? [], { pkg, listFile, existing, queued, removed });
    if (list.files.length > 0) {
      const file = listFile ?? INCLUDES_FILE;
      claim(file, "includes");
      write(file, list.text, "file");
    }
    includeWarnings.push(...list.warnings);
  }

  // The package's own files, once the Blueprint owns anything (or the last compile wrote them).
  const generatedBefore = record.entries.some((entry) => entry.kind === "file" && (PACKAGE_FILES as readonly string[]).includes(entry.path));
  if (ownsContent(blueprint) || generatedBefore) {
    // A DescIndex the last compile wrote and this one doesn't goes, as does a removed one, so the ComponentList doesn't list it.
    const keptByAuthor = new Set((record.kept ?? []).flatMap((entry) => (entry.kind === "file" ? [entry.path.toLowerCase()] : [])));
    const descIndexGone = layouts.length === 0 && existing.some((file) => isDescIndex(file) && (fileRemovals.has(file.toLowerCase()) || (record.entries.some((entry) => entry.kind === "file" && entry.path === file) && !keptByAuthor.has(file.toLowerCase()))));
    const files = [...new Set([...existing, ...queued.keys()])].filter((file) => !(descIndexGone && isDescIndex(file)));
    const preloads = await modPreloads(pkg, existing, catalogs, writes);
    for (const generated of await modPackageFiles(pkg, { name, dependencies: blueprint.dependencies, preloads, files, written: [...queued.keys()] })) output.write(generated.file, generated.content, generated.kind);
  }

  // The check expects each removal gone: a part the Blueprint still writes there fails it, in any spelling of a file.
  const writerOf = (file: string): string | undefined => [...queued].find(([other]) => other.toLowerCase() === file.toLowerCase())?.[1];
  for (const { item, reason, removal } of removals) {
    if (removal.kind === "file") {
      const by = writerOf(removal.path);
      if (by) check.expectGone(item, reason, by);
      continue;
    }
    if (removal.kind === "string" && strings[removal.file]?.[removal.key] !== undefined) {
      check.expectGone(item, reason, table.keyWriter(removal.file, removal.key)!);
      continue;
    }
    // A strings file written whole: whatever its Accepted Differences, a removed key or line is gone from it.
    const whole = blueprint.files.findIndex(({ path: file }) => file === removal.file);
    const content = writes.get(removal.file);
    if (whole >= 0 && content !== undefined && stringLines(Buffer.from(content).toString("utf8"), { keyless: true }).lines.some((line) => removalOfLine(removal.file, line, [removal]))) {
      check.expectGone(item, reason, `files.${whole}`);
    }
  }

  // Before anything is written: the mod folder's .gitignore must be the compile's, to list what it makes on each machine.
  const gitignore = await readGitignore(dir, uncommitted);

  let written: CompileRecord;
  try {
    written = settle(await output.finish((next) => saveCompileRecord(blueprintPath, settle(next)), { beforeWrite: () => check.assertPassed() }));
  } catch (error) {
    // A Set cutscene the Editor changed (not deleted: there's nothing to read) comes back into its Set through sync (sync-mod.ts).
    if (error instanceof EditorChangesError) {
      const syncable = error.changes.filter((change) => change.change === "changed in the Editor" && setCutscenes.some(({ file }) => change.name === `file:${file}`)).map((change) => change.name);
      throw new EditorChangesError(error.changes, formatEditorChanges(error.changes, syncable, undefined, { target: "mod package", tool: "compile_mod" }));
    }
    throw error;
  }

  await writeGitignore(dir, path.basename(pkg), uncommitted, gitignore);
  const tracked = await trackedByGit(pkg, [...uncommitted]);

  const owned = new Set(written.entries.map(entryName));
  // Not written yet: a library trigger's or global's name (unless triggers.names or the Blueprint's strings give it) and the library's Galaxy, which the Editor makes on save.
  const libraryItems = written.entries.flatMap((entry) => (entry.kind === "trigger" || entry.kind === "variable" ? [entry] : []));
  const names = libraryItems.length > 0 && existsSync(path.join(pkg, ...TRIGGER_STRINGS.split("/"))) ? stringLines(await readFile(path.join(pkg, ...TRIGGER_STRINGS.split("/")), "utf8")).lines.map((line) => line.key) : [];
  const unnamed = libraryItems.filter((entry) => !names.includes(libraryStringKey(libraryId!, entry.kind === "trigger" ? "Trigger" : "Variable", "Name", entry.id)));
  const warnings = [
    ...(unnamed.length > 0 ? [`${unnamed.map(entryName).join(", ")} ha${unnamed.length === 1 ? "s" : "ve"} no name in ${TRIGGER_STRINGS}: give each one in the Blueprint's triggers.names, by its id, or the Editor shows its id`] : []),
    ...(libraryItems.length > 0 ? [`The compile writes the library's triggers and globals into Triggers, but not yet the library's Galaxy: open the mod in the Editor and save it, so its script has them, before playing it`] : []),
    ...check.unneeded.map((difference) => `acceptedDifferences names ${difference.item} ("${difference.reason}"), but it came out the same as the original: the difference can go`),
    ...blueprint.acceptedDifferences
      // An aspect's name (`<item>#<aspect>`) names an item compared by aspect: a Cinematic's cutscene.
      .filter((difference) => !owned.has(check.itemOf(difference.item)))
      .map((difference) => `acceptedDifferences names ${difference.item}, which the Blueprint doesn't write: check its name (the compile's names are on compile-record.json)`),
    ...silentLines(scripts, soundIds),
    ...assetWarnings,
    ...doodadWarnings,
    ...dataWarnings,
    ...includeWarnings,
    ...layoutWarnings,
    ...cutscenes
      .filter(({ estimated }) => estimated.length > 0)
      .map(({ id, estimated }) => `The Cinematic ${id} is timed by the estimate for ${estimated.length} line(s) no Asset Mod the mod depends on holds a voice file for (${estimated.join(", ")}): its cutscene's timing changes once they're there, so compile the Asset Mod that voices them first`),
    ...blueprint.acceptedDifferences
      // Once converted, the names stay as the record of what changed; one on a scene that's new had
      // nothing to differ from. The game reads a file in any case, so the package's spelling is the scene's.
      .filter(({ item }) => [...cutscenes, ...setCutscenes].some(({ file }) => item.startsWith(`file:${file}#`) && !existing.some((name) => name.toLowerCase() === file.toLowerCase())))
      .map(({ item }) => `acceptedDifferences names ${item}, but the ${setCutscenes.some(({ file }) => item.startsWith(`file:${file}#`)) ? "Set cutscene" : "Cinematic's cutscene"} is new to the package, so there was no Kept scene to differ from: the difference can go`),
    ...tracked.map((file) => `${file} is now made on each machine (a placeholder or a community asset), but git still tracks the file it replaced: untrack it with git rm --cached "${path.basename(pkg)}/${file}" from ${dir}, or the next commit records this machine's file over it`),
    ...output.unusedKept.map((entry) => `The Blueprint still writes ${entryName(entry)}, but it was kept as the Editor left it (--keep), so the compile no longer writes it: remove it from the Blueprint, or compile with --discard ${entryName(entry)} to have it written again`),
  ];
  const placeholders = assets.files.flatMap((asset) => (asset.placeholder ? [asset.placeholder] : []));
  const removed = removals.filter(({ item }) => output.removedKept.has(item) || removedWhole.has(item)).map(({ item, reason }) => ({ item, reason }));
  // Each compile, while it stands: the removal of a file is checked by what still names it.
  warnings.push(...(await stillNamed(pkg, removals.flatMap(({ removal }) => (removal.kind === "file" && !existsSync(path.join(pkg, ...removal.path.split("/"))) ? [removal.path] : [])))));
  return { modPackage: pkg, record: written, conversions: check.conversions, warnings, placeholders, removed };
}

/**
 * A warning for each file removed as an Accepted Removal that a file left in the package still
 * names, by its path in its data folder (Cutscenes/<name>.SC2Cutscene) as the game's data names one.
 */
async function stillNamed(pkg: string, removed: readonly string[]): Promise<string[]> {
  if (removed.length === 0) return [];
  const byName = new Map(removed.map((file) => [file.replace(/^[^/]+\.SC2Data\//, ""), file]));
  const naming = await namedIn(pkg, await packageFiles(pkg), [...byName.keys()]);
  return [...naming].flatMap(([name, files]) =>
    files.length === 0 ? [] : [`removals removes file:${byName.get(name)}, but ${files.join(", ")} still name${files.length === 1 ? "s" : ""} it (${name}): change what names it, or the game finds no file there`],
  );
}

/** The game strings file a mod's DocInfo strings are in. */
const GAME_STRINGS = "enUS.SC2Data/LocalizedData/GameStrings.txt";

/** The mod's DocInfo strings, from the Blueprint's name and description: those it gives. */
function docInfoStrings({ name, description }: ModBlueprint): Record<string, string> {
  return {
    ...(name === undefined ? {} : { "DocInfo/Name": name }),
    ...(description?.short === undefined ? {} : { "DocInfo/DescShort": description.short }),
    ...(description?.long === undefined ? {} : { "DocInfo/DescLong": description.long }),
  };
}

/** The TriggerStrings names the Blueprint's triggers give: each trigger's, global's and trigger's local variable's, by element id. */
function triggerNames(triggers: string, library: string, names: Readonly<Record<string, string>>): Record<string, string> {
  const elements = libraryElements(triggers, library);
  const out: Record<string, string> = {};
  for (const [id, name] of Object.entries(names)) {
    // An older Editor numbers each element type apart, so the Id may be a Trigger's and a Variable's both: a name by Id can't tell which.
    const types = (["Trigger", "Variable"] as const).filter((type) => libraryElementOf(elements, type, id));
    if (types.length > 1) throw new Error(`triggers.names names ${id}, which is both a Trigger and a Variable of the Blueprint's triggers: a name given by Id can't tell which it names`);
    const type = types[0];
    if (!type) {
      const other = libraryElementsWithId(elements, id)[0];
      throw new Error(`triggers.names names ${id}, which ${other ? `is a ${xmlAttribute(other, "Type")}` : "isn't an element"} of the Blueprint's triggers: it names their triggers, globals and triggers' local variables`);
    }
    out[libraryStringKey(library, type, "Name", id)] = name;
  }
  return out;
}

/** `entries` with each of `carried` put back where `previous` had it, after the entry before it there, so the record doesn't change. */
function carryEntries(entries: readonly CompileRecordEntry[], carried: readonly CompileRecordEntry[], previous: readonly CompileRecordEntry[]): CompileRecordEntry[] {
  const out = [...entries];
  for (const entry of carried) {
    if (out.includes(entry)) continue;
    let at = 0;
    for (let index = previous.indexOf(entry) - 1; index >= 0; index--) {
      const before = entryName(previous[index]!);
      const found = out.findIndex((other) => entryName(other) === before);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    out.splice(at, 0, entry);
  }
  return out;
}

/** `next` with each uncommitted file listed as one, without a fingerprint. */
function uncommit(next: CompileRecord, uncommitted: ReadonlySet<string>): CompileRecord {
  return { ...next, entries: next.entries.map((entry) => (entry.kind === "file" && uncommitted.has(entry.path) ? { kind: "uncommitted" as const, path: entry.path } : entry)) };
}

/** The first line of the .gitignore a compile writes in an Asset Mod's folder. */
export const GITIGNORE_HEADER = "# Written by compile-mod: the files each machine makes for itself, kept out of git.";

/** The mod folder's .gitignore as it is: the compile's text (none when there's no file), or the author's own. */
type Gitignore = { readonly authors: true } | { readonly authors: false; readonly text?: string };

/** The mod folder's .gitignore; one the author wrote is refused once the compile has files to list there. */
async function readGitignore(dir: string, uncommitted: ReadonlySet<string>): Promise<Gitignore> {
  const file = path.join(dir, ".gitignore");
  const existing = existsSync(file) ? await readFile(file, "utf8") : undefined;
  if (existing === undefined || existing.startsWith(GITIGNORE_HEADER)) return { authors: false, ...(existing === undefined ? {} : { text: existing }) };
  if (uncommitted.size > 0) throw new Error(`${file} isn't the one compile-mod writes: move its patterns to the Workspace's .gitignore, so the compile can list the files it makes on each machine`);
  return { authors: true };
}

/**
 * The mod folder's .gitignore: its placeholders/ and each uncommitted package file (a community
 * asset or a placeholder). Written only while there's something to ignore, and removed when there
 * isn't, unless the author wrote it.
 */
async function writeGitignore(dir: string, packageName: string, uncommitted: ReadonlySet<string>, gitignore: Gitignore): Promise<void> {
  if (gitignore.authors) return;
  const existing = gitignore.text;
  const file = path.join(dir, ".gitignore");
  const placeholders = existsSync(path.join(dir, PLACEHOLDERS_DIR));
  if (uncommitted.size === 0 && !placeholders) {
    if (existing !== undefined) await rm(file);
    return;
  }
  const text = [
    GITIGNORE_HEADER,
    ...(placeholders ? ["# Placeholder voices, and what each was made from", `/${PLACEHOLDERS_DIR}/`] : []),
    ...(uncommitted.size > 0 ? ["# Community assets (from the machine's cache) and placeholders, in the package", ...[...uncommitted].sort().map((asset) => `/${gitignorePath(packageName)}/${gitignorePath(asset)}`)] : []),
    "",
  ].join("\n");
  if (text !== existing) await writeFile(file, text);
}

/** `file` as a .gitignore pattern that matches it alone: its glob characters and a trailing space escaped. */
const gitignorePath = (file: string): string => file.replace(/[\\*?[\]]/g, "\\$&").replace(/ $/, "\\ ");

/**
 * A warning for each Screenplay whose new lines (those without an imported Sound) play a Sound no
 * CSound of the mod gives, by the CSound ids in `sounds` (lower case): the conversation links to
 * it, but the line has no voice until a CSound gives one.
 */
function silentLines(scripts: readonly ModScript[], sounds: ReadonlySet<string>): string[] {
  return scripts.flatMap(({ screenplay, index, script }) => {
    const silent = scriptLines(script).filter((line) => screenplay.importedSounds[line.lineId] === undefined && !sounds.has(line.soundId.toLowerCase()));
    if (silent.length === 0) return [];
    const one = silent.length === 1;
    return [
      `screenplays.${index}'s ${silent.map((line) => line.lineId).join(", ")} play${one ? "s" : ""} the Sound${one ? "" : "s"} ${silent.map((line) => line.soundId).join(", ")}, which no CSound in the mod gives yet: ${one ? "the line has" : "those lines have"} no voice until one does (a sound set's, a CSound in the Blueprint's gameData or entries, or the package's SoundData)`,
    ];
  });
}
