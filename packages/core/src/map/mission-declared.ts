// A Mission's Declared Content (domain/declared-content.ts, issue #109): read from its folder and
// checked as a mod's is (src/mods/declared-parts.ts), then merged into its Map Package beside what
// the Mission's compile generates itself (write-map-package.ts):
//
//   gameData, entries,   by entry into their GameData files: spliced into a catalog file the
//   characters           compile writes whole, else merged by entry beside the Kept ones
//   includes             the includes list (Base.SC2Data/GameData.xml), as a mod's
//   strings, a file's    by key into the strings files: added to one the compile writes, or
//   and an entry's       merged by key beside the Kept keys
//   files                whole (layouts with CRLF endings), with the DescIndex loading the layouts
//   setCutscenes         as the Mission's Cutscenes, beside its Cinematics
//   removals             dropped from the package, the Equivalence Check expecting them gone
//
// A part the Mission's compile writes too (an entry, a key, a file) is refused, naming both
// writers: one part has one writer.

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CastModels } from "../cutscene/cinematic.js";
import { type DeclaredContent, GAME_DATA_DIR, parseRemoval, type Removal } from "../domain/declared-content.js";
import { LOCALIZED_STRINGS_FILE } from "../domain/entry-strings.js";
import { findPackageFile } from "../catalog/package-files.js";
import { characterEntry } from "../mods/characters.js";
import { type FoundFile, samePath } from "../mods/custom-doodads.js";
import type { Workspace } from "../plugins/workspace.js";
import { type AssetFiles, genericEntries, includesListFor, ownedStringsProblems, readRawEntries, StringsTable } from "../mods/declared-parts.js";
import type { EquivalenceCheck } from "../mods/equivalence.js";
import { includedCatalogs, includesFile, INCLUDES_FILE, packageFiles, standardCatalogFile } from "../mods/game-data-files.js";
import { entryXml, type GenericEntry, genericEntryKey } from "../mods/generic-entries.js";
import { DESC_INDEX, descIndexLayouts, isDescIndex, isLayout } from "../mods/mod-package-files.js";
import { modSetCutscenes } from "../mods/mod-cinematics.js";
import { fileNamedKeys } from "../mods/owned-strings.js";
import { descIndex, layoutWithCrlf } from "../ui/layout-writer.js";
import { writeStringsFile } from "../triggers/write-trigger-strings.js";
import { isInside } from "../util/inside.js";
import { catalogEntries } from "./catalog-entries.js";
import type { CompileRecord } from "../domain/compile-record.js";
import { stringLines } from "./package-elements.js";
import type { PackageOutput } from "./package-output.js";

/** A Mission's Declared Content, read from its folder and checked: what writeMapPackage merges in. */
export type MissionDeclared = {
  /** Each GameData file's entries the Blueprint owns (raw, then generic), by the file's path in the package. */
  readonly catalogs: ReadonlyMap<string, readonly string[]>;
  /** Who writes each of those files: `gameData.0`, `entries`. */
  readonly catalogWriters: ReadonlyMap<string, string>;
  /** The strings the Blueprint owns, its own and its entries' and files'. */
  readonly strings: StringsTable;
  /** The files it writes whole, each with what writes it. */
  readonly files: readonly { readonly path: string; readonly content: Uint8Array; readonly by: string }[];
  /** Its Set cutscenes, by the cutscene's name (Base.SC2Data/Cutscenes/<name>.SC2Cutscene). */
  readonly setCutscenes: readonly { readonly index: number; readonly name: string; readonly xml: string }[];
  /** `includes`, as the Blueprint gives it. */
  readonly includes: readonly string[] | undefined;
  /** Its Accepted Removals, each parsed. */
  readonly removals: readonly { readonly item: string; readonly reason: string; readonly removal: Removal }[];
  /** Advice that doesn't stop the compile: the data rules', the hotkeys', an entry's missing asset. */
  readonly warnings: readonly string[];
};

/** Whether a Blueprint declares any Declared Content: one that declares none compiles as it did before. */
export const declaresContent = (declared: DeclaredContent): boolean =>
  declared.gameData.length > 0 ||
  declared.entries.length > 0 ||
  declared.characters.length > 0 ||
  Object.keys(declared.strings).length > 0 ||
  declared.files.length > 0 ||
  declared.setCutscenes.length > 0 ||
  declared.removals.length > 0 ||
  declared.includes !== undefined;

/**
 * The Mission's Declared Content, read from its folder (the Blueprint's at `blueprintPath`) and
 * checked as a mod's is: every source inside the folder, each entry against the game's data
 * schema, each file's and entry's strings its own. `mapPackage` is the package it goes in, whose
 * hotkeys the missing-hotkey check counts; `assetFiles` finds a file an entry names, and `models`
 * gives the Set cutscenes' cast.
 */
export async function readMissionDeclared(
  blueprint: DeclaredContent,
  blueprintPath: string,
  { mapPackage, assetFiles, models }: { readonly mapPackage: string; readonly assetFiles: AssetFiles; readonly models: () => Promise<CastModels> },
): Promise<MissionDeclared> {
  const dir = path.dirname(blueprintPath);
  const source = async (file: string): Promise<Buffer> => {
    const full = path.join(dir, file);
    if (!(await isInside(dir, full))) throw new Error(`The Mission Blueprint's source ${file} isn't in the Mission's folder ${dir}`);
    try {
      return await readFile(full);
    } catch (error) {
      throw new Error(`The Mission Blueprint's source ${file} can't be read: ${(error as Error).message}`, { cause: error });
    }
  };
  const catalogs = new Map<string, string[]>();
  const catalogWriters = new Map<string, string>();
  /** The file as an earlier writer spelled it: the game reads its files in any case. */
  const spelled = (file: string): string => [...catalogs.keys()].find((other) => other.toLowerCase() === file.toLowerCase()) ?? file;
  const addEntries = (asked: string, by: string, texts: readonly string[]): void => {
    const file = spelled(asked);
    const list = catalogs.get(file);
    if (list) list.push(...texts);
    else catalogs.set(file, [...texts]);
    const other = catalogWriters.get(file);
    if (other === undefined) catalogWriters.set(file, by);
    else if (!other.split(" and ").includes(by)) catalogWriters.set(file, `${other} and ${by}`);
  };
  const rawFiles = new Map<string, number>();
  for (const { index, file, texts } of await readRawEntries(blueprint.gameData, source)) {
    const other = rawFiles.get(file.toLowerCase());
    if (other !== undefined) throw new Error(`The Mission Blueprint writes ${file} twice, in gameData.${other} and in gameData.${index}: a file has one writer`);
    rawFiles.set(file.toLowerCase(), index);
    addEntries(file, `gameData.${index}`, texts);
  }
  const keptHotkeys = await Promise.all(
    (await packageFiles(mapPackage).catch(() => [] as string[])).filter((file) => /(^|\/)enUS\.SC2Data\/LocalizedData\/GameHotkeys\.txt$/i.test(file)).map((file) => readFile(path.join(mapPackage, ...file.split("/")), "utf8")),
  );
  const characters = blueprint.characters.map((character) => ({ from: `the Blueprint's characters (${character.speaker})`, entries: [characterEntry(character)] }));
  const generic = await genericEntries(blueprint, source, characters, assetFiles, keptHotkeys);
  for (const [file, entries] of generic.byFile) addEntries(file, "entries", entries.map(entryXml));

  const strings = new StringsTable(blueprint.strings);
  for (const file of Object.keys(blueprint.strings)) {
    if (!LOCALIZED_STRINGS_FILE.test(file)) throw new Error(`The Mission Blueprint's strings go in ${file}, which isn't a localized strings file (<locale>.SC2Data/LocalizedData/<name>.txt)`);
  }
  const fileSources = await Promise.all(blueprint.files.map(({ source: from }) => source(from)));
  blueprint.files.forEach(({ strings: given }, index) => {
    if (!given) return;
    ownedStringsProblems(`files.${index}`, given, fileNamedKeys(fileSources[index]!.toString("utf8")), `one ${blueprint.files[index]!.source} names as @<key>`, "Mission Blueprint");
    for (const [file, keys] of Object.entries(given)) strings.add(file, keys, `files.${index}`, "the Blueprint's files");
  });
  for (const { from, entry } of generic.strings) for (const [file, keys] of Object.entries(entry.strings ?? {})) strings.add(file, keys, `${from} (${genericEntryKey(entry)})`, "the Blueprint's entries");

  const seen = new Map<string, number>();
  const files = blueprint.files.map(({ path: file }, index) => {
    if (isDescIndex(file)) throw new Error(`files.${index} writes ${file}, which the compile generates from the layouts in the Blueprint's files, in their order: leave it out of the Blueprint`);
    if (blueprint.includes !== undefined && includesFile([file]) !== undefined) throw new Error(`files.${index} writes ${file}, the includes list, which the Blueprint's includes write: leave it to includes`);
    const other = seen.get(file.toLowerCase());
    if (other !== undefined) throw new Error(`The Mission Blueprint writes ${file} twice, in files.${other} and in files.${index}: a file has one writer`);
    seen.set(file.toLowerCase(), index);
    // A layout with CRLF endings, as the Editor saves it, so a save in the Editor isn't an edit.
    return { path: file, content: isLayout(file) ? Buffer.from(layoutWithCrlf(fileSources[index]!)) : new Uint8Array(fileSources[index]!), by: `files.${index}` };
  });
  const setCutscenes = blueprint.setCutscenes.length > 0 ? await modSetCutscenes(blueprint, blueprintPath, await models(), "Mission") : [];
  return {
    catalogs,
    catalogWriters,
    strings,
    files,
    setCutscenes: setCutscenes.map(({ index, file, xml }) => ({ index, name: path.posix.basename(file).replace(/\.SC2Cutscene$/i, ""), xml })),
    includes: blueprint.includes,
    removals: blueprint.removals.map(({ item, reason }) => ({ item, reason, removal: parseRemoval(item) })),
    warnings: generic.warnings,
  };
}

/** The names the Equivalence Check gives each part the Declared Content writes: those it checks when one is converted from Kept. */
export function declaredItemNames(declared: MissionDeclared): Set<string> {
  const names = new Set<string>();
  for (const [file, texts] of declared.catalogs) for (const entry of catalogEntries(`<Catalog>${texts.join("\n")}</Catalog>`)) names.add(`catalog-entry:${file}:${entry.key}`);
  for (const [file, keys] of Object.entries(declared.strings.files)) for (const key of Object.keys(keys)) names.add(`string:${file}:${key}`);
  for (const { path: file } of declared.files) names.add(`file:${file}`);
  return names;
}

/**
 * Merges the Declared Content's catalog entries in: into `gameDataFiles` (the catalog files the
 * compile writes whole, by file name) where the compile writes that file, else merged by entry beside
 * the package's own (`beside`, a Kept package's), else as a file of their own in `gameDataFiles`.
 * Returns whether it queued a catalog file of its own on `out`, which then needs the GameData component.
 */
export function mergeDeclaredCatalogs(declared: MissionDeclared, gameDataFiles: [string, string][], out: PackageOutput, beside: boolean): boolean {
  let queued = false;
  for (const [file, texts] of declared.catalogs) {
    const by = declared.catalogWriters.get(file)!;
    if (!file.startsWith(GAME_DATA_DIR) || file.slice(GAME_DATA_DIR.length).includes("/")) {
      // In a folder of GameData: a file only the includes list loads, which the compile writes whole.
      appendQueued(out, file, texts, by);
      queued = true;
      continue;
    }
    const name = file.slice(GAME_DATA_DIR.length);
    const at = gameDataFiles.findIndex(([other]) => other.toLowerCase() === name.toLowerCase());
    // A file the compile writes whole has the CRLF lines of the rest of its catalogs.
    const lines = texts.map((text) => text.replace(/\r?\n/g, "\r\n"));
    if (at >= 0) {
      const [own, content] = gameDataFiles[at]!;
      gameDataFiles[at] = [own, spliceEntries(content, lines, `Base.SC2Data/GameData/${own}`, by)];
    } else if (beside || out.queued(file)) {
      appendQueued(out, file, texts, by);
      queued = true;
    } else gameDataFiles.push([name, ['<?xml version="1.0" encoding="utf-8"?>', "<Catalog>", ...lines, "</Catalog>", ""].join("\r\n")]);
  }
  return queued;
}

/** `content`, a catalog file the compile writes, with `lines` before its </Catalog>: refused when it has one of their entries already. */
function spliceEntries(content: string, lines: readonly string[], file: string, by: string): string {
  const own = new Set(catalogEntries(content).map((entry) => entry.key));
  const twice = catalogEntries(`<Catalog>${lines.join("\n")}</Catalog>`).find((entry) => own.has(entry.key));
  if (twice) throw new Error(`The Mission Blueprint's ${by} writes ${twice.key} in ${file}, which the Mission's compile writes too: an entry has one writer, so give it another id`);
  const end = content.lastIndexOf("</Catalog>");
  if (end < 0) throw new Error(`${file} has no </Catalog> for the Blueprint's ${by} to go before`);
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  return `${content.slice(0, end)}${lines.map((line) => line.replace(/\r?\n/g, eol)).join(eol)}${eol}${content.slice(end)}`;
}

/** Queues `texts` in the catalog file `file`, merged by entry: after the entries the compile queued there already, if any. */
function appendQueued(out: PackageOutput, file: string, texts: readonly string[], by: string): void {
  const queued = out.queued(file);
  if (queued && typeof queued.content === "string") {
    out.write(file, spliceEntries(queued.content, texts, file, by), queued.kind);
    return;
  }
  if (queued) throw new Error(`The Mission Blueprint's ${by} writes ${file}, which the Mission's compile writes whole: give its entries another file`);
  out.write(file, `<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n${texts.map((text) => `${text}\n`).join("")}</Catalog>\n`, "catalog");
}

/**
 * Writes the rest of the Declared Content, once the Mission's compile has queued everything of its
 * own: its strings, added by key to a strings file the compile writes (refused where it writes the
 * key differently) or merged by key beside the Kept ones; its files, whole, and the DescIndex
 * loading their layouts; the includes list; its Set cutscenes are the compile's Cutscenes already.
 * `extraStrings` are strings of the compile's own Blueprint parts that go in by key the same way
 * (its doodads' names). `check` is told of each Accepted Removal the Blueprint writes back.
 */
export async function writeDeclaredRest(
  declared: MissionDeclared,
  out: PackageOutput,
  { pkg, record, extraStrings, check }: { readonly pkg: string; readonly record: CompileRecord | undefined; readonly extraStrings: readonly { readonly by: string; readonly strings: Readonly<Record<string, Readonly<Record<string, string>>>> }[]; readonly check: EquivalenceCheck },
): Promise<{ readonly warnings: readonly string[] }> {
  const table = declared.strings;
  for (const { by, strings } of extraStrings) for (const [file, keys] of Object.entries(strings)) table.add(file, keys, by);
  for (const [file, keys] of Object.entries(table.files)) {
    if (Object.keys(keys).length === 0) continue;
    const queued = out.queued(file);
    if (queued && queued.kind !== "strings") throw new Error(`${table.writerOf(file)} give strings in ${file}, which the Mission's compile writes whole: leave it to one of them`);
    const own: Record<string, string> = {};
    if (queued) {
      for (const line of stringLines(Buffer.from(queued.content as string | Uint8Array).toString("utf8")).lines) {
        if (line.key === "") continue;
        own[line.key] = line.text.slice(line.text.indexOf("=") + 1).replace(/\r?\n$/, "");
      }
    }
    for (const [key, value] of Object.entries(keys)) {
      if (own[key] !== undefined && own[key] !== value) throw new Error(`${key} in ${file} is written twice, differently: by the Mission's compile and by ${table.keyWriter(file, key) ?? table.writerOf(file)}; leave it to one of them`);
      own[key] = value;
    }
    out.write(file, writeStringsFile(own), "strings");
  }
  for (const { path: file, content, by } of declared.files) {
    if (out.queued(file)) throw new Error(`${by} writes ${file}, which the Mission's compile writes: a file has one writer`);
    out.write(file, content, "file");
  }
  const layouts = descIndexLayouts(declared.files.map(({ path: file }) => file));
  const existing = await packageFiles(pkg).catch(() => [] as string[]);
  if (layouts.length > 0) {
    // As the package spells it, so a Kept one is replaced.
    const file = existing.find((name) => isDescIndex(name)) ?? DESC_INDEX;
    if (out.queued(file)) throw new Error(`The Blueprint's files have layouts, whose DescIndex the compile generates, but the Mission's compile writes ${file} already`);
    out.write(file, descIndex(layouts), "file");
  }

  // The includes list, from the Blueprint's includes and the catalog files it writes outside the standard ones, as a mod's.
  const warnings: string[] = [];
  const listFile = includesFile(existing);
  const wroteList = listFile !== undefined && (record?.entries ?? []).some((entry) => entry.kind === "file" && entry.path === listFile);
  const listWriter = declared.files.find(({ path: file }) => includesFile([file]) !== undefined);
  const ownsList = declared.includes !== undefined || (listWriter === undefined && (listFile === undefined || wroteList));
  const written = new Map([...declared.catalogs].map(([file]) => [file, declared.catalogWriters.get(file)!] as const));
  if (!ownsList) {
    const kept = await includedCatalogs(pkg, existing);
    for (const [file, by] of written) {
      if (existing.includes(file) || standardCatalogFile(file) || kept.has(file.toLowerCase())) continue;
      throw new Error(`${by} writes ${file}, which the package's includes list doesn't name: give the Blueprint its includes (the catalog files the list names, in load order), and the compile adds it to the list`);
    }
  } else {
    const queued = new Map(out.queuedFiles().map((file) => [file, written.get(file) ?? "the Mission's compile"] as const));
    const removed = [
      ...declared.removals.flatMap(({ removal }) => (removal.kind === "file" ? [removal.path] : [])),
      ...(record?.entries ?? []).flatMap((entry) => (entry.kind === "file" && !queued.has(entry.path) ? [entry.path] : [])),
    ];
    const list = await includesListFor(declared.includes ?? [], { pkg, listFile, existing, queued, removed });
    if (list.files.length > 0) out.write(listFile ?? INCLUDES_FILE, list.text, "file");
    warnings.push(...list.warnings);
  }

  // The check expects each removal gone: a part the Blueprint still writes there fails it, in any spelling of a file.
  for (const { item, reason, removal } of declared.removals) {
    if (removal.kind === "file") {
      const by = declared.files.find(({ path: file }) => file.toLowerCase() === removal.path.toLowerCase())?.by;
      if (by) check.expectGone(item, reason, by);
    } else if (removal.kind === "string" && table.files[removal.file]?.[removal.key] !== undefined) {
      check.expectGone(item, reason, table.keyWriter(removal.file, removal.key) ?? table.writerOf(removal.file));
    }
  }
  return { warnings };
}

/** The strings a Mission's own doodads' names give (ObjectStrings), by what gives each. */
export function doodadNameStrings(entries: readonly { readonly id: string; readonly entries: readonly GenericEntry[] }[]): { readonly by: string; readonly strings: Readonly<Record<string, Readonly<Record<string, string>>>> }[] {
  return entries.flatMap(({ id, entries: list }) => {
    const strings: Record<string, Record<string, string>> = {};
    for (const entry of list) for (const [file, keys] of Object.entries(entry.strings ?? {})) Object.assign((strings[file] ??= {}), keys);
    return Object.keys(strings).length > 0 ? [{ by: `the Blueprint's doodad ${id}`, strings }] : [];
  });
}


/**
 * Finds a file a Mission's generic entry names, for the missing-asset check: in its Map Package, in
 * the Workspace mod packages the map loads (`packages`), or among the files the Blueprint writes
 * (`own`, by package path), which aren't in the package yet.
 */
export function missionFileFinder(workspace: Pick<Workspace, "root">, packages: readonly string[], mapPackage: string, own: readonly string[] = []): { readonly find: (storagePath: string) => FoundFile | undefined; readonly lookedIn: string } {
  const search = [...packages, mapPackage];
  const writes = new Set(own.map((file) => samePath(file.replace(/^Base\.SC2Assets[\\/]/i, ""))));
  const lookedIn = `the Map Package, the mod packages the map loads from the Workspace (${packages.map((pkg) => path.relative(workspace.root, pkg)).join(", ") || "none"}) and the Blueprint's files`;
  const find = (storagePath: string): FoundFile | undefined => {
    const found = findPackageFile(search, storagePath);
    if (found) return { data: readFileSync(found.file), where: path.relative(workspace.root, found.file) };
    return writes.has(samePath(storagePath)) ? { data: new Uint8Array(), where: "the Blueprint's files" } : undefined;
  };
  return { find, lookedIn };
}
