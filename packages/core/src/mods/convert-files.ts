// The convert step for whole files (ADR-0011): it copies chosen Kept files of a mod's package into
// the mod's folder, at its path in the package less Base.SC2Data/ (scripts/… for
// Base.SC2Data/scripts/…, as convert-library copies a native function's Galaxy), and lists each in
// the Blueprint's `files`. A file already there with other bytes is refused. The
// next compile-mod writes each back over its Kept original, under the Equivalence Check, which
// moves it from Kept to Compiled. Without names, it takes the files the Blueprint owns as source
// files: every Kept Galaxy script, UI layout (.SC2Layout) and font style (.SC2Style), except the
// DescIndex, which the compile generates (ADR-0019).
//
// A file stays Kept when the Blueprint already writes it (in `files`, as a library's Galaxy, or as
// an Asset Source); the Galaxy the Editor generates for a library in Triggers (Lib<id>.galaxy and
// its header) is left for the library interface, unless named; and a named file is refused when it is one of the package files the compile
// generates, one left to the Editor, or one another shape owns by its parts: a GameData catalog, a
// strings file, Triggers.
//
// Each UI layout takes the strings it names as @<key> (<Text val="@UI/CreditItemBase/Actor"/>)
// into its `strings`, by the strings file the package has each in, from the Kept strings or the
// raw ones, which they leave; a run gives layouts the Blueprint already writes the strings they
// didn't take then (owned-strings.ts).

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { type CompileRecord, entryName } from "../domain/compile-record.js";
import type { Strings } from "../domain/entry-strings.js";
import { type ModBlueprint, ModBlueprintSchema, parseRemoval } from "../domain/mod-blueprint.js";
import { readCompileRecord } from "../map/mission-package.js";
import { componentOf, isLeftToEditor } from "./kept-report.js";
import { libraryScriptFiles } from "./library.js";
import { generatesDescIndex, isDescIndex, isLayout, packageFiles } from "./mod-package-files.js";
import { fileNamedKeys, heldStrings, keptStrings, stringKey, takeStrings, withRawStrings } from "./owned-strings.js";
import { modPackage, readModBlueprint } from "./workspace-mods.js";

/** Where convert-files puts a package file's source in the mod's folder. */
export const fileSource = (file: string): string => file.replace(/^Base\.SC2Data\//, "");

/** The kinds of file convert-files takes without names: those the Blueprint owns as source files. */
const SOURCE_FILE = /\.(galaxy|sc2layout|sc2style)$/i;

export type ConvertFilesOptions = {
  /** The files to convert, by path in the package; every Kept Galaxy, layout and style file when not given. */
  readonly paths?: readonly string[];
};

export type ConvertedFiles = {
  /** Each file converted, by path in the package, in the package's order. */
  readonly converted: readonly string[];
  /** Each named file left Kept, with why. */
  readonly refused: readonly { readonly path: string; readonly reason: string }[];
  /** The strings the files name that they took from the Kept strings or the raw ones, as items. */
  readonly strings: readonly string[];
};

/**
 * The package files the Blueprint writes, or the record says it wrote, in lower case (the game
 * reads its files in any case): its `files`, its library's Galaxy, its Asset Sources' files and
 * the voice files its recordings make.
 */
export function ownedFiles(blueprint: ModBlueprint, record: CompileRecord): Set<string> {
  const owned = new Set<string>();
  const add = (file: string): void => void owned.add(file.toLowerCase());
  for (const entry of record.entries) if (entry.kind === "file" || entry.kind === "uncommitted") add(entry.path);
  for (const { path: file } of blueprint.files) add(file);
  for (const { path: file } of blueprint.assets) add(file);
  for (const voices of blueprint.voices) for (const sound of Object.keys(voices.recordings)) add(`${voices.folder}/${sound}.${voices.format}`);
  if (blueprint.library) {
    const { script, header } = libraryScriptFiles(blueprint.library.id);
    add(script);
    add(header);
    for (const fn of blueprint.library.functions) if (fn.galaxy) add(fn.galaxy.path);
  }
  return owned;
}

/** The mod's Blueprint, package, folder and compile record, for a convert step. */
export async function convertTarget(blueprintPath: string) {
  const blueprint = await readModBlueprint(blueprintPath);
  const pkg = await modPackage(blueprintPath);
  const record = await readCompileRecord(blueprintPath);
  if (!record) throw new Error(`${blueprintPath} has no compile record beside it: import the mod with import-mod, which writes an empty one`);
  // A Kept entry the author kept from the compile (compile-mod --keep) is still Kept.
  const kept = new Set((record.kept ?? []).map(entryName));
  const compiled: CompileRecord = { ...record, entries: record.entries.filter((entry) => !kept.has(entryName(entry))) };
  return { blueprint, pkg, record: compiled, dir: path.dirname(blueprintPath), files: await packageFiles(pkg) };
}

/**
 * `blueprintPath`'s Blueprint as `change` makes it from the file's own JSON, checked now; the
 * returned step writes it. A convert step stages it before writing any source, so a Blueprint the
 * schema refuses leaves the mod's folder as it was.
 */
export async function stageBlueprint(blueprintPath: string, change: (raw: Record<string, unknown>) => Record<string, unknown>): Promise<() => Promise<void>> {
  const next = change(JSON.parse(await readFile(blueprintPath, "utf8")) as Record<string, unknown>);
  ModBlueprintSchema.parse(next);
  return () => writeFile(blueprintPath, `${JSON.stringify(next, null, 2)}\n`);
}

/** Converts Kept whole files of the mod of `blueprintPath` into files its Blueprint owns, as above. */
export async function convertFiles(blueprintPath: string, { paths }: ConvertFilesOptions = {}): Promise<ConvertedFiles> {
  const { blueprint, pkg, record, dir, files } = await convertTarget(blueprintPath);
  const owned = ownedFiles(blueprint, record);
  const refused: { path: string; reason: string }[] = [];
  let chosen: string[];
  if (paths) {
    const descIndex = generatesDescIndex(blueprint);
    const asked = new Set<string>();
    for (const name of paths) {
      const file = files.find((other) => other.toLowerCase() === name.toLowerCase());
      if (!file) throw new Error(`The mod package has no ${name}`);
      // One the Blueprint writes all the same is refused below as already written.
      if (isLeftToEditor(file) && !owned.has(file.toLowerCase())) throw new Error(`${file} is left to the Editor: the compile doesn't write it, so it has no source`);
      // The DescIndex is the compile's to write, from the Blueprint's layouts, once it has one (ADR-0019).
      if (isDescIndex(file) && !descIndex) {
        throw new Error(`${file} stays Kept while the Blueprint has no layout in Base.SC2Data, and the compile generates it once it has one: convert the layouts it loads instead`);
      }
      const component = componentOf(file, descIndex);
      if (component === "Package files") throw new Error(`${file} is one the compile generates: it has no source`);
      if (component === "GameData" || component === "Strings" || component === "Triggers") throw new Error(`${file} is owned by its parts, not whole: convert its ${component === "GameData" ? "entries (convert-entries)" : component === "Strings" ? "strings by key" : "library (convert-library)"}`);
      asked.add(file);
    }
    // In the package's order, as without names.
    chosen = files.filter((file) => asked.has(file));
    for (const file of chosen) if (owned.has(file.toLowerCase())) refused.push({ path: file, reason: "the Blueprint already writes it" });
    chosen = chosen.filter((file) => !owned.has(file.toLowerCase()));
  } else {
    // The Galaxy the Editor generates for each library in Triggers, which the library interface owns once it converts (convert-library).
    const triggers = files.find((file) => file === "Triggers");
    const libraries = triggers ? [...(await readFile(path.join(pkg, triggers), "utf8")).matchAll(/<Library\s+Id="([^"]+)"/g)].map((match) => match[1]!) : [];
    const generated = new Set(libraries.flatMap((library) => Object.values(libraryScriptFiles(library)).map((file) => file.toLowerCase())));
    // The DescIndex is generated from the Blueprint's layouts (ADR-0019).
    chosen = files.filter((file) => SOURCE_FILE.test(file) && !isDescIndex(file) && !owned.has(file.toLowerCase()) && !generated.has(file.toLowerCase()));
  }

  // A source already in the mod's folder is taken when it's the package's file, and refused when it isn't.
  const copies: string[] = [];
  const taken: string[] = [];
  for (const file of chosen) {
    const target = path.join(dir, ...fileSource(file).split("/"));
    if (existsSync(target) && !(await readFile(target)).equals(await readFile(path.join(pkg, ...file.split("/"))))) {
      refused.push({ path: file, reason: `the mod's folder already has ${fileSource(file)}, with other bytes: move it, or declare it in files yourself` });
      continue;
    }
    if (!existsSync(target)) copies.push(file);
    taken.push(file);
  }

  // The strings each file names (a layout's @UI/… text): the new ones', and those the files the Blueprint already writes didn't take then.
  const kept = await keptStrings({ pkg, files });
  const elsewhere = await heldStrings(blueprintPath, blueprint);
  let raw = blueprint.strings;
  const strings: string[] = [];
  /** `entry` with the strings its layout `text` names that it takes, each then held, out of `raw`; another file stays as it is. */
  const takeNamedStrings = (entry: { readonly path: string; readonly source: string; readonly strings?: Strings | undefined }, text: Buffer) => {
    if (!isLayout(entry.path)) return entry;
    const took = takeStrings({ blueprint, record }, kept, fileNamedKeys(text.toString("utf8")), { held: entry.strings ?? {}, raw, elsewhere });
    if (took.rawLeft) raw = took.rawLeft;
    for (const item of took.taken) {
      const string = parseRemoval(item);
      if (string.kind === "string") elsewhere.add(stringKey(string.file, string.key));
    }
    strings.push(...took.taken);
    return took.taken.length > 0 ? { ...entry, strings: took.strings } : entry;
  };
  const declared: (typeof blueprint.files)[number][] = [];
  for (const entry of blueprint.files) {
    const at = path.join(dir, ...entry.source.split("/"));
    declared.push(existsSync(at) ? takeNamedStrings(entry, await readFile(at)) : entry);
  }
  const entries: { path: string; source: string; strings?: Strings | undefined }[] = [];
  for (const file of taken) entries.push(takeNamedStrings({ path: file, source: fileSource(file) }, await readFile(path.join(pkg, ...file.split("/")))));

  if (taken.length > 0 || strings.length > 0) {
    // The Blueprint is checked before any source is written.
    const write = await stageBlueprint(blueprintPath, (json) => {
      const files = (json.files as Record<string, unknown>[] | undefined) ?? [];
      const next = { ...json, files: [...files.map((entry, index) => (declared[index]!.strings !== blueprint.files[index]!.strings ? { ...entry, strings: declared[index]!.strings } : entry)), ...entries] };
      return raw !== blueprint.strings ? withRawStrings(next, raw) : next;
    });
    for (const file of copies) {
      const target = path.join(dir, ...fileSource(file).split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(pkg, ...file.split("/")), target);
    }
    await write();
  }
  return { converted: taken, refused, strings };
}

/** What a conversion did, for the author. */
export function formatConvertedFiles({ converted, refused, strings }: ConvertedFiles): string {
  return [
    converted.length > 0 ? `Converted ${converted.length} file(s) into the mod's folder: ${converted.join(", ")}` : "Converted no files",
    ...(strings.length > 0 ? [`Took ${strings.length} string(s) the files name, which they write now: ${strings.join(", ")}`] : []),
    ...refused.map((item) => `Left Kept: ${item.path}: ${item.reason}`),
  ].join("\n");
}
