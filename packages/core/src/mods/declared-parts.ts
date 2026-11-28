// The compile of Declared Content (domain/declared-content.ts), shared by a Mod's compile
// (compile-mod.ts) and a Mission's (map/mission-declared.ts, map/write-map-package.ts): each part
// read from its source and checked the same way, whichever package it goes in.
//
//   readRawEntries      gameData: each source's entries, every one with an id
//   genericEntries      entries, and the purpose-level shapes compiled down to them
//                       (characters, a mod's doodads and conversations), checked against
//                       the game's data schema, by the GameData file each goes in
//   StringsTable        every writer's strings by file and key, a key given twice
//                       differently refused, naming both writers
//   ownedStringsProblems  a part's strings (a file's @<key>s) that aren't its own
//   includesListFor     the includes list from `includes` and the catalog files written
//   packageEol          a strings file's line ending, as the package has it

import { readFile } from "node:fs/promises";
import path from "node:path";

import { type DeclaredContent, GAME_DATA_DIR } from "../domain/declared-content.js";
import { LOCALIZED_STRINGS_FILE, type Strings } from "../domain/entry-strings.js";
import { catalogEntries } from "../map/catalog-entries.js";
import { stringLines } from "../map/package-elements.js";
import { missingHotkeyWarnings, modHotkeyKeys } from "./button-hotkeys.js";
import { CatalogSchemaError, catalogSchema, entryFile, schemaProblems } from "./catalog-schema.js";
import { entryAssetPaths, type FoundFile, genericEntryAssetWarnings } from "./custom-doodads.js";
import { dataRuleWarnings } from "./data-rules.js";
import { entryStringProblems } from "./entry-strings.js";
import { includesList, standardCatalogFile } from "./game-data-files.js";
import { type GenericEntry, genericEntryKey, readGenericEntries } from "./generic-entries.js";

/** Generic entries compiled from a purpose-level shape, and what made them (`characters`, `doodads.0 (Ring)`). */
export type ShapeEntries = { readonly from: string; readonly entries: readonly GenericEntry[] };

/** Finds a file an entry's asset path names, and says where it looked. */
export type AssetFiles = () => Promise<{ readonly find: (storagePath: string) => FoundFile | undefined; readonly lookedIn: string }>;

/**
 * The entries of each of `gameData`'s sources, by its index, each entry's text: refused, naming it,
 * when one has no id (a class default goes in the Blueprint's entries).
 */
export async function readRawEntries(gameData: DeclaredContent["gameData"], source: (file: string) => Promise<Buffer>): Promise<{ readonly index: number; readonly file: string; readonly texts: readonly string[] }[]> {
  const out: { index: number; file: string; texts: string[] }[] = [];
  for (const [index, { file, source: from }] of gameData.entries()) {
    const found = catalogEntries((await source(from)).toString("utf8"));
    const unnamed = found.find((entry) => entry.id === undefined);
    if (unnamed) throw new Error(`gameData.${index}'s source ${from} has a ${unnamed.className} with no id: a raw gameData source's entries each have one, and a class default goes in the Blueprint's entries`);
    out.push({ index, file, texts: found.map((entry) => entry.text) });
  }
  return out;
}

/**
 * The Blueprint's generic entries and `shapes`', each checked against the game's data schema, by
 * the GameData file each goes in: its catalog's own unless it names one. Throws CatalogSchemaError,
 * listing every problem, when any entry doesn't fit.
 */
export async function genericEntries(
  declared: Pick<DeclaredContent, "entries" | "strings">,
  source: (file: string) => Promise<Buffer>,
  shapes: readonly ShapeEntries[],
  assetFiles: AssetFiles,
  keptHotkeys: readonly string[],
): Promise<{ readonly byFile: Map<string, GenericEntry[]>; readonly strings: readonly { readonly from: string; readonly entry: GenericEntry }[]; readonly warnings: readonly string[] }> {
  const schema = catalogSchema();
  const byFile = new Map<string, GenericEntry[]>();
  const strings: { from: string; entry: GenericEntry }[] = [];
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const sources: { readonly from: string; readonly list: readonly GenericEntry[] }[] = [];
  for (const { source: from } of declared.entries) sources.push({ from, list: readGenericEntries((await source(from)).toString("utf8"), from) });
  // The Blueprint's own entries' asset paths are checked (custom-doodads.ts); the shapes' are the Blueprint's other checks'.
  const own = sources.flatMap(({ list }) => list);
  // Purpose-level shapes, as the generic entries they compile down to.
  for (const { from, entries } of shapes) sources.push({ from, list: entries });
  for (const { from, list } of sources) {
    for (const entry of list) {
      const fits = [...schemaProblems(entry, schema), ...entryStringProblems(entry)];
      problems.push(...fits.map((problem) => `${from}: ${problem}`));
      if (fits.length > 0) continue;
      if (entry.strings) strings.push({ from, entry });
      const file = entryFile(entry, schema)!;
      const key = `${file.toLowerCase()}:${genericEntryKey(entry)}`;
      const other = seen.get(key);
      if (other) throw new Error(`${genericEntryKey(entry)} is a generic entry in ${other} and in ${from}: an entry is written once`);
      seen.set(key, from);
      const list = byFile.get(file);
      if (list) list.push(entry);
      else byFile.set(file, [entry]);
    }
  }
  if (problems.length > 0) throw new CatalogSchemaError(problems);
  const written = sources.map(({ from, list }) => ({ from, entries: list }));
  // The files are looked for only when an entry names one.
  const assetWarnings = own.some((entry) => entryAssetPaths(entry).length > 0) ? await assetFiles().then(({ find, lookedIn }) => genericEntryAssetWarnings(own, find, lookedIn)) : [];
  return { byFile, strings, warnings: [...dataRuleWarnings(written), ...missingHotkeyWarnings(written, modHotkeyKeys(written, declared.strings, keptHotkeys)), ...assetWarnings] };
}

/**
 * Every writer's strings, by file and key, starting from the Blueprint's own `strings`: a key given
 * twice differently is refused, naming who gave it first and who gave it again.
 */
export class StringsTable {
  /** Each file's keys and their text, in the order given. */
  readonly files: Record<string, Record<string, string>>;
  /** Who writes each strings file the Blueprint's strings don't (the library, the Screenplays). */
  private readonly fileBy = new Map<string, string>();
  /** Who first gave each key, by file and key, so a clash names both writers. */
  private readonly keyBy = new Map<string, string>();

  private readonly own: Strings;

  constructor(own: Strings) {
    this.own = own;
    this.files = Object.fromEntries(Object.entries(own).map(([file, keys]) => [file, { ...keys }]));
    for (const [file, keys] of Object.entries(own)) for (const key of Object.keys(keys)) this.keyBy.set(`${file}\0${key}`, `strings["${file}"]`);
  }

  /** Adds `keys` to `file`'s strings, each given `by` a writer, which `writer` names for the file (`by` when not given). */
  add(file: string, keys: Readonly<Record<string, string>>, by: string, writer = by): void {
    if (Object.keys(keys).length === 0) return;
    const own = (this.files[file] ??= {});
    if (!this.own[file]) this.fileBy.set(file, this.fileBy.has(file) && this.fileBy.get(file) !== writer ? `${this.fileBy.get(file)} and ${writer}` : writer);
    for (const [key, value] of Object.entries(keys)) {
      const first = this.keyBy.get(`${file}\0${key}`);
      if (own[key] !== undefined && own[key] !== value) throw new Error(`${key} in ${file} is written twice, differently: by ${first} and by ${by}; leave it to one of them`);
      if (first === undefined) this.keyBy.set(`${file}\0${key}`, by);
      own[key] = value;
    }
  }

  /** A copy to add to, leaving this table as it is. */
  copy(): StringsTable {
    const table = new StringsTable(this.own);
    for (const [file, keys] of Object.entries(this.files)) table.files[file] = { ...keys };
    for (const [file, by] of this.fileBy) table.fileBy.set(file, by);
    for (const [key, by] of this.keyBy) table.keyBy.set(key, by);
    return table;
  }

  /** Who writes `file`: its writers, or the Blueprint's strings. */
  writerOf(file: string): string {
    return this.fileBy.get(file) ?? `strings["${file}"]`;
  }

  /** Who gave `key` in `file`, when anyone did. */
  keyWriter(file: string, key: string): string | undefined {
    return this.keyBy.get(`${file}\0${key}`);
  }
}

/**
 * Throws for `by`'s strings in a file that isn't a localized strings file, or under a key it doesn't
 * name (`what` says which it names), each listed; `blueprint` names the Blueprint (the Mod Blueprint).
 */
export function ownedStringsProblems(by: string, strings: Strings, named: ReadonlySet<string>, what: string, blueprint = "Mod Blueprint"): void {
  const problems = Object.entries(strings).flatMap(([file, keys]) => [
    ...(LOCALIZED_STRINGS_FILE.test(file) ? [] : [`${by}'s strings go in ${file}, which isn't a localized strings file (<locale>.SC2Data/LocalizedData/<name>.txt)`]),
    ...Object.keys(keys)
      .filter((key) => !named.has(key))
      .map((key) => `${by} gives ${key}, which isn't ${what}`),
  ]);
  if (problems.length > 0) throw new Error(`The ${blueprint}'s ${by} can't be written:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
}

/** The line ending of the package's strings file `file`: CRLF, as the Editor writes it, unless the file has LF. */
export async function packageEol(pkg: string, file: string): Promise<string> {
  try {
    const text = await readFile(path.join(pkg, ...file.split("/")), "utf8");
    const first = stringLines(text).lines[0]?.text;
    return first && first.endsWith("\n") && !first.endsWith("\r\n") ? "\n" : "\r\n";
  } catch {
    return "\r\n";
  }
}

/**
 * The includes list the Blueprint's `includes` give: each listed catalog file the package will have,
 * in order, then each catalog file the compile writes (`queued`, by its writer) outside the standard
 * ones that `includes` doesn't name, with a warning for each one added or left out. Formatted as
 * the package's own list (`listFile`) is, when it has one.
 */
export async function includesListFor(
  includes: readonly string[],
  { pkg, listFile, existing, queued, removed }: { readonly pkg: string; readonly listFile: string | undefined; readonly existing: readonly string[]; readonly queued: ReadonlyMap<string, string>; readonly removed: readonly string[] },
): Promise<{ readonly files: readonly string[]; readonly text: string; readonly warnings: readonly string[] }> {
  // The game reads its files in any case.
  const gone = new Set(removed.map((file) => file.toLowerCase()));
  const willHave = new Set([...existing.filter((file) => !gone.has(file.toLowerCase())), ...queued.keys()].map((file) => file.toLowerCase()));
  const warnings: string[] = [];
  const files: string[] = [];
  for (const file of includes) {
    if (!willHave.has(file.toLowerCase())) {
      warnings.push(`includes lists ${file}, which the package doesn't have: the includes list leaves it out, so remove it from includes`);
      continue;
    }
    // Listed all the same: the author's list, which the game reads as it is.
    if (standardCatalogFile(file)) warnings.push(`includes lists ${file}, which the game loads by its name without the includes list: remove it from includes`);
    files.push(file);
  }
  const listed = new Set(files.map((file) => file.toLowerCase()));
  for (const [file, by] of queued) {
    if (!file.startsWith(GAME_DATA_DIR) || !file.toLowerCase().endsWith(".xml") || standardCatalogFile(file) || listed.has(file.toLowerCase())) continue;
    files.push(file);
    listed.add(file.toLowerCase());
    warnings.push(`${by} writes ${file}, a catalog file the game loads only through the includes list, and the Blueprint's includes doesn't name it: it's included last, so add it to includes where it should load`);
  }
  const kept = listFile === undefined ? undefined : await readFile(path.join(pkg, ...listFile.split("/")), "utf8");
  return { files, text: includesList(files, kept), warnings };
}
