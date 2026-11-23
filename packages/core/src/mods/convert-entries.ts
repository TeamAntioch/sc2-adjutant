// The convert step for generic catalog entries (ADR-0011): it writes chosen Kept entries of a mod's
// GameData file into its Mod Blueprint as generic typed entries, so breadth conversion is
// mechanical. Each keeps its imported id. The next compile-mod writes them over the Kept entries
// they came from, under the Equivalence Check, which moves them from Kept to Compiled.
//
// An entry is refused, and stays Kept, when its class isn't one the game's data schema has, when
// it doesn't fit the schema (catalog-schema.ts), when its generic form wouldn't read back the
// same (generic-entries.ts), or when the file has its key more than once. The entries go in entries/<file name>.json in the mod's folder, beside
// any already there, and the Blueprint's entries lists that source. A CConversation whose
// Screenplay the Screenplay Source knows (or, with no Source, whose screenplays/<id>.md is in the
// mod's folder) is left Kept for convert-screenplay, so the two can run in either order. A Source
// that can't tell (no refForConversation, or a conversation it doesn't know, which convert-screenplay
// then takes with --ref) leaves it to convert-entries: run convert-screenplay first for that one. So
// is a CSound one of the Blueprint's sound sets writes (one per line of its conversation) left Kept.
//
// Each entry takes the strings keyed to it with it (entry-strings.ts), from the package's Kept
// strings or the Blueprint's raw strings, which they leave. So does each entry of the file the
// Blueprint already writes, a generic one or a declared character's CCharacter, so a later run
// gives an entry converted before the strings it didn't take then.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { LOCALIZED_STRINGS_FILE, type Strings } from "../domain/entry-strings.js";
import { GAME_DATA_DIR, type ModBlueprint, ModBlueprintSchema } from "../domain/mod-blueprint.js";
import { catalogEntries } from "../map/catalog-entries.js";
import type { CompileRecord } from "../domain/compile-record.js";
import { TRIGGER_STRINGS } from "../map/editor-changes.js";
import { readCompileRecord } from "../map/mission-package.js";
import { stringLines } from "../map/package-elements.js";
import { catalogSchema, entryFile, schemaProblems } from "./catalog-schema.js";
import { characterEntry, shapeEntries } from "./characters.js";
import { conventionOwner, ownKeys, withString } from "./entry-strings.js";
import { CONVERSATION_DATA, modFile, type ModScript, readModScreenplays } from "./conversations.js";
import { type GenericEntry, genericEntry, genericEntryKey, readGenericEntries } from "./generic-entries.js";
import { packageFiles } from "./mod-package-files.js";
import { soundSetSounds } from "./sound-sets.js";
import { modPackage, readModBlueprint } from "./workspace-mods.js";
import { workspaceFor, type Workspace } from "../plugins/workspace.js";

export type ConvertEntriesOptions = {
  /** The GameData file whose Kept entries convert, a path in the package (Base.SC2Data/GameData/WaterData.xml). */
  readonly file: string;
  /** The entries to convert, by key (`CWater:MyWater`); every Kept entry of the file when not given. */
  readonly keys?: readonly string[];
  /** The Workspace the mod is in, whose Screenplay Source knows its Conversations' Screenplays; found above the Blueprint when not given, and read only for ConversationData. */
  readonly workspace?: Workspace;
};

export type ConvertedEntries = {
  /** The source the entries went in, relative to the mod's folder. */
  readonly source: string;
  /** Each entry converted, by key, in the file's order. */
  readonly converted: readonly string[];
  /** Each Kept entry left Kept, with why. */
  readonly refused: readonly RefusedEntry[];
  /** Each string that went into its entry, by its name on the compile record (`string:<file>:<key>`). */
  readonly strings: readonly string[];
};

/** A Kept entry convert left Kept, and why. */
export type RefusedEntry = { readonly key: string; readonly reason: string };

/** Converts the Kept entries of `file` in the mod of `blueprintPath` into generic entries, as above. */
export async function convertEntries(blueprintPath: string, { file: asked, keys, workspace }: ConvertEntriesOptions): Promise<ConvertedEntries> {
  const blueprint = await readModBlueprint(blueprintPath);
  const pkg = await modPackage(blueprintPath);
  const record = await readCompileRecord(blueprintPath);
  if (!record) throw new Error(`${blueprintPath} has no compile record beside it: import the mod with import-mod, which writes an empty one`);
  if (!asked.startsWith(GAME_DATA_DIR)) throw new Error(`${asked} isn't a GameData file: give its path in the package, in ${GAME_DATA_DIR}`);
  // The file as the package spells it, so entries are matched with the record's.
  const files = await packageFiles(pkg);
  const file = files.find((name) => name.toLowerCase() === asked.toLowerCase());
  if (!file) throw new Error(`The mod package has no ${asked}`);
  const full = path.join(pkg, ...file.split("/"));
  const dir = path.dirname(blueprintPath);

  // What the Blueprint already writes in this file, however it spells it (the game reads files in any case): compiled, or declared and not compiled yet.
  const isFile = (other: string | undefined): boolean => other?.toLowerCase() === file.toLowerCase();
  const owned = new Set(record.entries.flatMap((entry) => (entry.kind === "catalog-entry" && isFile(entry.file) ? [entry.id] : [])));
  for (const { file: rawFile, source } of blueprint.gameData) {
    if (isFile(rawFile)) for (const entry of catalogEntries(await readFile(path.join(dir, source), "utf8"))) owned.add(entry.key);
  }
  const schema = catalogSchema();
  const sources = new Map<string, GenericEntry[]>();
  for (const { source } of blueprint.entries) {
    const list = readGenericEntries(await readFile(path.join(dir, source), "utf8"), source);
    sources.set(source, list);
    for (const entry of list) if (isFile(entryFile(entry, schema))) owned.add(genericEntryKey(entry));
  }
  for (const entry of shapeEntries(blueprint).flatMap((shape) => shape.entries)) if (entryFile(entry, schema)?.toLowerCase() === file.toLowerCase()) owned.add(genericEntryKey(entry));
  // A sound set's CSounds (sound-sets.ts), in SoundData: one for each line of its conversation.
  if (blueprint.soundSets.length > 0 && isFile(entryFile({ catalog: "Sound" }, schema))) {
    let scripts: ModScript[];
    try {
      const { registry } = workspace ?? (await workspaceFor(blueprintPath));
      scripts = await readModScreenplays(blueprint, registry, blueprintPath, async (from) => readFile(await modFile(blueprintPath, from)));
    } catch (error) {
      throw new Error(`The Blueprint's soundSets write CSounds in ${file}, but its Screenplays, which say which, can't be read (${(error as Error).message}): nothing was converted, so that none is converted the wrong way`, { cause: error });
    }
    for (const sound of soundSetSounds(blueprint, scripts)) owned.add(`CSound:${sound}`);
  }
  // A Screenplay's Conversation (conversations.ts), in its catalog's own file.
  if (file.toLowerCase() === CONVERSATION_DATA.toLowerCase()) for (const { conversation } of blueprint.screenplays) owned.add(`CConversation:${conversation}`);

  const found = catalogEntries(await readFile(full, "utf8"));
  // A Conversation a Screenplay will write is convert-screenplay's, so the two convert in either order.
  const screenplayOf = new Map<string, string>();
  if (file.toLowerCase() === CONVERSATION_DATA.toLowerCase()) {
    const kept = found.filter((entry) => entry.className === "CConversation" && entry.id !== undefined && !owned.has(entry.key) && (!keys || keys.includes(entry.key)));
    // A mod outside a Workspace has no Screenplay Source, only the mod folder's Screenplays.
    const source = kept.length > 0 ? (workspace ?? (await workspaceFor(blueprintPath).catch(() => undefined)))?.registry.screenplaySource() : undefined;
    for (const entry of kept) {
      let ref: string | undefined;
      try {
        ref = source ? await source.refForConversation?.(entry.id!) : undefined;
      } catch (error) {
        // Unanswered, it may be a Screenplay's: left Kept rather than converted the wrong way.
        screenplayOf.set(entry.key, `the Screenplay Source ${source!.name} couldn't say whether a Screenplay writes it (${(error as Error).message}): try again, or convert it with convert-screenplay`);
        continue;
      }
      if (ref) screenplayOf.set(entry.key, `its Screenplay is ${ref} at the Screenplay Source ${source!.name}: convert it with convert-screenplay`);
      else if (!source && existsSync(path.join(dir, "screenplays", `${entry.id}.md`))) screenplayOf.set(entry.key, `its Screenplay is screenplays/${entry.id}.md in the mod's folder: convert it with convert-screenplay`);
    }
  }
  const wanted = keys ? new Set(keys) : undefined;
  const unknown = keys?.filter((key) => !found.some((entry) => entry.key === key)) ?? [];
  if (unknown.length > 0) throw new Error(`${file} has no ${unknown.join(", ")}`);
  const source = `entries/${path.basename(file, path.extname(file))}.json`;
  const converted: GenericEntry[] = [];
  const refused: RefusedEntry[] = [];
  const counts = new Map<string, number>();
  for (const entry of found) counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
  for (const entry of found) {
    if (wanted && !wanted.has(entry.key)) continue;
    if (owned.has(entry.key)) {
      if (wanted) refused.push({ key: entry.key, reason: "the Blueprint already writes it" });
      continue;
    }
    const screenplay = screenplayOf.get(entry.key);
    if (screenplay) {
      refused.push({ key: entry.key, reason: screenplay });
      continue;
    }
    // Converted, each would be a generic entry of the same key, and an entry is written once.
    if (counts.get(entry.key)! > 1) {
      refused.push({ key: entry.key, reason: "the file has it more than once" });
      continue;
    }
    const catalog = schema.classes[entry.className]?.catalog;
    if (!catalog) {
      refused.push({ key: entry.key, reason: `${entry.className} isn't a class the game's data schema has` });
      continue;
    }
    const generic = genericEntry(entry.text, catalog);
    if ("refused" in generic) {
      refused.push({ key: entry.key, reason: generic.refused });
      continue;
    }
    const placed: GenericEntry = isFile(entryFile(generic, schema)) ? generic : { ...generic, file };
    const problems = schemaProblems(placed, schema);
    if (problems.length > 0) {
      refused.push({ key: entry.key, reason: problems.join("; ") });
      continue;
    }
    converted.push(placed);
  }

  // The strings each entry takes: the converted ones and those of the file the Blueprint already
  // writes, in the file's order, then those the Blueprint writes there that the package doesn't have yet.
  const pool = await stringPool(pkg, files, blueprint, record, [...sources.values()].flat());
  const ids = await modEntryIds(pkg, files, schema, [...sources.values()].flat());
  const moved: string[] = [];
  const take = (entry: GenericEntry): Strings | undefined => {
    let strings = entry.strings;
    for (const string of pool.keyedTo(entry, ids)) {
      strings = withString(strings, string.file, string.key, string.text);
      moved.push(`string:${string.file}:${string.key}`);
    }
    return strings;
  };
  const changedSources = new Set<string>();
  const characters = [...blueprint.characters];
  const convertedByKey = new Map(converted.map((entry, index) => [genericEntryKey(entry), index]));
  /** Where the Blueprint writes each of this file's entries: a generic entry's source and place, or a character's place. */
  const written = new Map<string, { readonly from: string; readonly at: number }[]>();
  for (const [from, list] of sources) list.forEach((entry, at) => isFile(entryFile(entry, schema)) && push(written, genericEntryKey(entry), { from, at }));
  const declaredAt = new Map<string, number>(characters.flatMap((character, at) => (isFile(entryFile(characterEntry(character), schema)) ? [[`CCharacter:${character.id}`, at] as const] : [])));
  const inFile = [...found.map((entry) => entry.key), ...written.keys(), ...declaredAt.keys()];
  for (const key of new Set(inFile)) {
    if (wanted && !wanted.has(key)) continue;
    const index = convertedByKey.get(key);
    if (index !== undefined) {
      const strings = take(converted[index]!);
      if (strings) converted[index] = { ...converted[index]!, strings };
      continue;
    }
    for (const { from, at } of written.get(key) ?? []) {
      const list = sources.get(from)!;
      const before = moved.length;
      const strings = take(list[at]!);
      if (moved.length > before) {
        list[at] = { ...list[at]!, strings: strings! };
        changedSources.add(from);
      }
    }
    const declared = declaredAt.get(key);
    if (declared !== undefined) {
      const before = moved.length;
      const strings = take(characterEntry(characters[declared]!));
      if (moved.length > before) characters[declared] = { ...characters[declared]!, strings: strings! };
    }
  }

  const raw = JSON.parse(await readFile(blueprintPath, "utf8")) as Record<string, unknown>;
  let next: Record<string, unknown> | undefined;
  if (converted.length > 0 && !blueprint.entries.some((item) => item.source === source)) next = { ...raw, entries: [...((raw.entries as unknown[] | undefined) ?? []), { source }] };
  if (characters.some((character, index) => character !== blueprint.characters[index])) {
    const declared = (raw.characters as Record<string, unknown>[]).map((character, index) => (characters[index] === blueprint.characters[index] ? character : { ...character, strings: characters[index]!.strings }));
    next = { ...(next ?? raw), characters: declared };
  }
  if (pool.rawTaken.size > 0) next = { ...(next ?? raw), strings: pool.rawLeft() };
  // The Blueprint is checked before anything is written, so a refused one leaves the sources as they were.
  if (next) ModBlueprintSchema.parse(next);
  if (converted.length > 0) {
    const target = path.join(dir, source);
    const list = [...(sources.get(source) ?? (existsSync(target) ? readGenericEntries(await readFile(target, "utf8"), source) : [])), ...converted];
    sources.set(source, list);
    changedSources.add(source);
  }
  for (const from of changedSources) {
    const target = path.join(dir, from);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(sources.get(from), null, 2)}\n`);
  }
  if (next) await writeFile(blueprintPath, `${JSON.stringify(next, null, 2)}\n`);
  return { source, converted: converted.map(genericEntryKey), refused, strings: moved };
}

/** One string an entry may take: its file, key and text, and whether the Blueprint's raw strings give it. */
type PoolString = { readonly file: string; readonly key: string; readonly text: string; readonly raw: boolean };

/**
 * The strings the entries may take: every key of the package's localized strings files and of the
 * Blueprint's raw strings that no entry holds yet and that isn't DocInfo's (the Blueprint's name and
 * description), each taken once.
 */
async function stringPool(pkg: string, files: readonly string[], blueprint: ModBlueprint, record: CompileRecord, entries: readonly GenericEntry[]) {
  const held = new Set<string>();
  const hold = (strings: Strings | undefined): void => {
    for (const [file, keys] of Object.entries(strings ?? {})) for (const key of Object.keys(keys)) held.add(`${file}\0${key}`);
  };
  entries.forEach((entry) => hold(entry.strings));
  blueprint.characters.forEach((character) => hold(character.strings));
  // The triggers' text values and a layout's strings are theirs.
  hold(blueprint.triggers?.strings);
  blueprint.files.forEach((file) => hold(file.strings));
  // A key the record lists that no raw string gives is another writer's: the library's, a Screenplay's.
  for (const entry of record.entries) if (entry.kind === "string" && blueprint.strings[entry.file]?.[entry.key] === undefined) held.add(`${entry.file}\0${entry.key}`);
  const all = new Map<string, PoolString>();
  // The library's own strings file is the library's.
  const localized = (name: string): boolean => LOCALIZED_STRINGS_FILE.test(name) && name !== TRIGGER_STRINGS;
  for (const file of files.filter(localized)) {
    for (const line of stringLines(await readFile(path.join(pkg, ...file.split("/")), "utf8")).lines) {
      // A line with no = holds no string, and DocInfo's are the Blueprint's name and description.
      if (!line.text.includes("=") || line.key.startsWith("DocInfo/")) continue;
      all.set(`${file}\0${line.key}`, { file, key: line.key, text: line.text.slice(line.key.length + 1).replace(/\r?\n$/, ""), raw: false });
    }
  }
  for (const [file, keys] of Object.entries(blueprint.strings)) {
    if (!localized(file)) continue;
    for (const [key, text] of Object.entries(keys)) if (!key.startsWith("DocInfo/")) all.set(`${file}\0${key}`, { file, key, text, raw: true });
  }
  for (const name of held) all.delete(name);
  /** The pool's strings by the entry their convention gives them to (`<catalog>\0<id>`), and by key. */
  const byOwner = new Map<string, PoolString[]>();
  const byKey = new Map<string, PoolString[]>();
  for (const string of all.values()) {
    const owner = conventionOwner(string.key);
    if (owner) push(byOwner, `${owner.catalog}\0${owner.id}`, string);
    push(byKey, string.key, string);
  }
  const taken = new Set<PoolString>();
  const rawTaken = new Set<string>();
  return {
    /**
     * Takes the strings keyed to `entry`: those its convention gives it, then those its fields name
     * and its class's defaults give it whose convention gives them to no other entry of the mod
     * (`ids`, `<catalog>\0<id>`).
     */
    keyedTo(entry: GenericEntry, ids: ReadonlySet<string>): PoolString[] {
      const own = entry.id === undefined ? [] : (byOwner.get(`${entry.catalog}\0${entry.id}`) ?? []);
      const named = [...ownKeys(entry)].flatMap((key) => {
        const owner = conventionOwner(key);
        return owner && ids.has(`${owner.catalog}\0${owner.id}`) ? [] : (byKey.get(key) ?? []);
      });
      const out = [...new Set([...own, ...named])].filter((string) => !taken.has(string));
      for (const string of out) {
        taken.add(string);
        if (string.raw) rawTaken.add(`${string.file}\0${string.key}`);
      }
      return out;
    },
    rawTaken,
    /** The Blueprint's raw strings, less those taken: a file left with none goes. */
    rawLeft(): Strings {
      const out: Record<string, Record<string, string>> = {};
      for (const [file, keys] of Object.entries(blueprint.strings)) {
        const left = Object.entries(keys).filter(([key]) => !rawTaken.has(`${file}\0${key}`));
        if (left.length > 0) out[file] = Object.fromEntries(left);
      }
      return out;
    },
  };
}

/** `map`'s list at `key`, with `value` added. */
function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Each entry the mod has, as `<catalog>\0<id>`: in its package's catalog files, and among the Blueprint's generic entries. */
async function modEntryIds(pkg: string, files: readonly string[], schema: ReturnType<typeof catalogSchema>, entries: readonly GenericEntry[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const file of files.filter((name) => name.startsWith(GAME_DATA_DIR) && name.toLowerCase().endsWith(".xml"))) {
    for (const entry of catalogEntries(await readFile(path.join(pkg, ...file.split("/")), "utf8"))) {
      const catalog = schema.classes[entry.className]?.catalog;
      if (catalog && entry.id) out.add(`${catalog}\0${entry.id}`);
    }
  }
  for (const entry of entries) if (entry.id) out.add(`${entry.catalog}\0${entry.id}`);
  return out;
}

/** What a conversion did, for the author: one line for what converted, one per entry left Kept. */
export function formatConvertedEntries({ source, converted, refused, strings }: ConvertedEntries): string {
  return [
    converted.length > 0 ? `Converted ${converted.length} entr${converted.length === 1 ? "y" : "ies"} into ${source}: ${converted.join(", ")}` : "Converted no entries",
    ...(strings.length > 0 ? [`Moved ${strings.length} string${strings.length === 1 ? "" : "s"} into their entries`] : []),
    ...refused.map((item) => `Left Kept: ${item.key}: ${item.reason}`),
  ].join("\n");
}
