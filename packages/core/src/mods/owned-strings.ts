// The strings a convert step gives an owner that writes them by key (docs/reference/mod-strings.md):
// the Blueprint's triggers their text parameters' values, a layout in its files the strings it
// names. Each key is taken from every localized strings file that gives it, the Blueprint's raw
// strings over the package's Kept ones, so it's written in the file the package has it in, and it
// leaves the raw strings. A key removals names stays removed; one another owner of the Blueprint
// holds (an entry, a character, the triggers, a file) stays its; and so does one the last compile
// wrote for another writer (the record lists it, no raw string gives it and the owner doesn't hold
// it). TriggerStrings is the library's, and DocInfo's strings the Blueprint's name and description.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { type CompileRecord } from "../domain/compile-record.js";
import { LOCALIZED_STRINGS_FILE, type Strings } from "../domain/entry-strings.js";
import { type ModBlueprint, parseRemoval } from "../domain/mod-blueprint.js";
import { TRIGGER_STRINGS } from "../map/editor-changes.js";
import { xmlAttribute, type XmlNode } from "../util/xml.js";
import { withString } from "./entry-strings.js";
import { readGenericEntries } from "./generic-entries.js";
import { elementIdOf, libraryElements, libraryTriggersFile, paramExpressionKey, paramValueKey } from "./library-xml.js";
import { packageStringTable } from "./mod-package-files.js";

/** Where a convert step reads the strings from: the Blueprint, its package's files, and its compile record. */
export type StringsSource = { readonly blueprint: ModBlueprint; readonly pkg: string; readonly files: readonly string[]; readonly record: CompileRecord };

/** What an owner took: its strings (those it held and those taken), the taken ones as items, and the raw strings they leave, when any was raw. */
export type TakenStrings = { readonly strings: Strings; readonly taken: readonly string[]; readonly rawLeft?: Strings };

/** Reads the package's localized strings files once, for `takeStrings` over several owners. */
export async function keptStrings({ pkg, files }: Pick<StringsSource, "pkg" | "files">): Promise<ReadonlyMap<string, ReadonlyMap<string, string>>> {
  const out = new Map<string, ReadonlyMap<string, string>>();
  for (const file of files) if (LOCALIZED_STRINGS_FILE.test(file)) out.set(file, await packageStringTable(pkg, files, file));
  return out;
}

/**
 * Takes `keys` for an owner that holds `held`, from `raw` (the Blueprint's raw strings, as earlier
 * owners left them) and the package's `kept` strings, as above. A strings file is matched in any
 * case, as the game reads it, and keeps the package's spelling.
 */
export function takeStrings(
  { blueprint, record }: Pick<StringsSource, "blueprint" | "record">,
  kept: ReadonlyMap<string, ReadonlyMap<string, string>>,
  keys: Iterable<string>,
  { held = {}, raw = blueprint.strings, elsewhere = new Set() }: { readonly held?: Strings; readonly raw?: Strings; readonly elsewhere?: ReadonlySet<string> } = {},
): TakenStrings {
  const removed = new Set(blueprint.removals.flatMap(({ item }) => {
    const removal = parseRemoval(item);
    return removal.kind === "string" ? [stringKey(removal.file, removal.key)] : [];
  }));
  const compiled = new Set(record.entries.flatMap((entry) => (entry.kind === "string" ? [stringKey(entry.file, entry.key)] : [])));
  const holds = (file: string, key: string): boolean => Object.entries(held).some(([other, texts]) => other.toLowerCase() === file.toLowerCase() && texts[key] !== undefined);
  const files = new Map<string, string>();
  for (const file of [...Object.keys(raw), ...kept.keys()]) files.set(file.toLowerCase(), file);

  let strings: Strings = held;
  const taken: string[] = [];
  const rawTaken = new Set<string>();
  for (const key of new Set(keys)) {
    // DocInfo's strings are the Blueprint's name and description.
    if (key.startsWith("DocInfo/")) continue;
    for (const [lower, file] of files) {
      // TriggerStrings is the library's; a key another owner holds is its own.
      if (lower === TRIGGER_STRINGS.toLowerCase() || holds(file, key) || elsewhere.has(stringKey(file, key)) || removed.has(stringKey(file, key))) continue;
      const rawFile = Object.keys(raw).find((other) => other.toLowerCase() === lower && raw[other]![key] !== undefined);
      const keptFile = [...kept.keys()].find((other) => other.toLowerCase() === lower && kept.get(other)!.has(key));
      if (rawFile === undefined && (keptFile === undefined || compiled.has(stringKey(file, key)))) continue;
      strings = withString(strings, keptFile ?? file, key, rawFile !== undefined ? raw[rawFile]![key]! : kept.get(keptFile!)!.get(key)!);
      taken.push(`string:${keptFile ?? file}:${key}`);
      if (rawFile !== undefined) rawTaken.add(`${rawFile}\0${key}`);
    }
  }
  return { strings, taken, ...(rawTaken.size > 0 ? { rawLeft: stringsLess(raw, (file, key) => rawTaken.has(`${file}\0${key}`)) } : {}) };
}

/** A string's identity, by its strings file in any case (as the game reads it) and its key. */
export const stringKey = (file: string, key: string): string => `${file.toLowerCase()}\0${key}`;

/**
 * The strings the Blueprint at `blueprintPath` gives an owner, by stringKey: its Generic Entries'
 * (in their sources), its characters', its triggers' and its files'. An owner takes none of them.
 */
export async function heldStrings(blueprintPath: string, blueprint: ModBlueprint): Promise<Set<string>> {
  const out = new Set<string>();
  const hold = (strings: Strings | undefined): void => {
    for (const [file, keys] of Object.entries(strings ?? {})) for (const key of Object.keys(keys)) out.add(stringKey(file, key));
  };
  for (const { source } of blueprint.entries) {
    const file = path.join(path.dirname(blueprintPath), ...source.split("/"));
    if (existsSync(file)) for (const entry of readGenericEntries(await readFile(file, "utf8"), source)) hold(entry.strings);
  }
  blueprint.characters.forEach((character) => hold(character.strings));
  hold(blueprint.triggers?.strings);
  blueprint.files.forEach((file) => hold(file.strings));
  return out;
}

/** `next`, a Blueprint's JSON, with `strings` as its raw strings: none left, it has none. */
export function withRawStrings(next: Record<string, unknown>, strings: Strings): Record<string, unknown> {
  const { strings: _was, ...rest } = next;
  return Object.keys(strings).length > 0 ? { ...rest, strings } : rest;
}

/** `strings` less each key `taken` names: a file left with none goes. */
export function stringsLess(strings: Strings, taken: (file: string, key: string) => boolean): Strings {
  const out: Record<string, Record<string, string>> = {};
  for (const [file, texts] of Object.entries(strings)) {
    const left = Object.entries(texts).filter(([key]) => !taken(file, key));
    if (left.length > 0) out[file] = Object.fromEntries(left);
  }
  return out;
}

/** The GameStrings keys of `library`'s text parameters and text expressions in its elements, as functionXml writes them. */
export const elementTextKeys = (library: string, elements: readonly string[]): Set<string> => textParamValueKeys(libraryTriggersFile(library, [], elements), library);

/**
 * The GameStrings keys of `library`'s words in a Triggers file: each text value's (a Param whose
 * ValueType is text, Param/Value/…) and each text expression's (a Param whose ExpressionType is
 * text, Param/Expression/…).
 */
export function textParamValueKeys(triggers: string, library: string): Set<string> {
  const out = new Set<string>();
  const holds = (node: XmlNode, tag: string): boolean => node.children.some((child) => child.name === tag && xmlAttribute(child, "Type") === "text");
  for (const node of libraryElements(triggers, library).values()) {
    if (xmlAttribute(node, "Type") !== "Param") continue;
    if (holds(node, "ValueType")) out.add(paramValueKey(library, elementIdOf(node)));
    if (holds(node, "ExpressionType")) out.add(paramExpressionKey(library, elementIdOf(node)));
  }
  return out;
}

/** The keys a file names as a string, `"@<key>"` in an attribute, as a UI layout's `<Text val="@UI/CreditItemBase/Actor"/>` does. */
export function fileNamedKeys(text: string): Set<string> {
  return new Set([...text.matchAll(/="@([^"=\r\n]+)"/g)].map((match) => match[1]!));
}
