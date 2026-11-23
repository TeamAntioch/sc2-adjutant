// The Kept report (ADR-0011): the Kept Content left in a mod, by component and item, with a
// count: the to-do list of a mod's conversion. An item is what a compile record would list once
// the Blueprint owns it: a catalog entry, a string key, a library trigger, global or other library
// item, or a file written whole. Kept is everything the record doesn't list, and what the author
// kept from it (compile-mod --keep). A Kept item a Mod Blueprint can't own yet (a library item of a
// type no writer knows) is counted apart, not in the to-do list. So are the files left to the
// Editor (docs/reference/mod-files-left-to-the-editor.md), Kept for good since no compile writes them.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { type CompileRecord, entryName } from "../domain/compile-record.js";
import { LOCALIZED_STRINGS_FILE } from "../domain/entry-strings.js";
import { catalogEntries } from "../map/catalog-entries.js";
import { readCompileRecord } from "../map/mission-package.js";
import { stringLines } from "../map/package-elements.js";
import { itemKind, libraryItems as filedItems } from "../triggers/splice-triggers.js";
import { rootChildren } from "../util/xml.js";
import { libraryStringKey, packageLibraryId } from "./library-xml.js";
import { generatesDescIndex, isDescIndex, packageFiles } from "./mod-package-files.js";
import { modPackage, readModBlueprint } from "./workspace-mods.js";

/** A mod's components, as the report groups them. */
export const KEPT_COMPONENTS = ["GameData", "Strings", "Triggers", "Scripts", "Cutscenes", "UI", "Package files", "Files"] as const;
export type KeptComponent = (typeof KEPT_COMPONENTS)[number];

/** One Kept item: its name as the record would list it, the file it is in, and what the package calls it. */
export type KeptItem = { readonly item: string; readonly file: string; readonly label?: string };

export type KeptReport = {
  readonly mod: string;
  /** The Kept items a Mod Blueprint can own: what the components count. */
  readonly total: number;
  /** Every component, in order, with its count; a component with none has count 0. */
  readonly components: readonly { readonly component: KeptComponent; readonly count: number; readonly items: readonly KeptItem[] }[];
  /** Kept items no Mod Blueprint can own yet, so no compile converts them: library items of a type no writer knows. */
  readonly notConvertibleYet: { readonly count: number; readonly items: readonly KeptItem[] };
  /** Kept files left to the Editor for good, which no compile writes, so they aren't in the to-do list. */
  readonly leftToEditor: { readonly count: number; readonly items: readonly KeptItem[] };
};

const PACKAGE_FILE = /^(DocumentInfo|DocumentHeader|ComponentList\.SC2Components|PreloadAssetDB\.txt|Preload\.xml)$|\.version$/;

/**
 * The Editor-only files a mod's package leaves to the Editor (decided on #333): its categories and
 * its catalog strings, for any locale. Named by the file, not the folder, since nobody has checked
 * that everything in those folders is Editor-only: any other file there is counted. Base isn't a
 * locale.
 */
const LEFT_TO_EDITOR = [
  /^Base\.SC2Data\/EditorDataASD\/EditorCategories\.xml$/i,
  /^Base\.SC2Data\/LocalizedData\/EditorASD\/EditorCatalogStringsSC2\.txt$/i,
  /^(?!base\.)[a-z]{4}\.SC2Data\/LocalizedData\/Editor\/EditorCatalogStringsSC2\.txt$/i,
];

/** Whether a package file is one left to the Editor, which the compile doesn't write; read in any case, as the game does. */
export const isLeftToEditor = (file: string): boolean => LEFT_TO_EDITOR.some((pattern) => pattern.test(file));

/**
 * The component a whole file belongs to, when the compile generates the DescIndex (`descIndex`)
 * or not: it's a package file while it does, and a Kept layout until then.
 */
export function componentOf(file: string, descIndex: boolean): KeptComponent {
  if (PACKAGE_FILE.test(file)) return "Package files";
  if (isDescIndex(file)) return descIndex ? "Package files" : "UI";
  if (file.startsWith("Base.SC2Data/GameData/") || /^Base\.SC2Data\/gamedata\.xml$/i.test(file)) return "GameData";
  if (LOCALIZED_STRINGS_FILE.test(file)) return "Strings";
  if (file === "Triggers") return "Triggers";
  if (file.toLowerCase().endsWith(".galaxy")) return "Scripts";
  if (file.startsWith("Base.SC2Data/Cutscenes/")) return "Cutscenes";
  if (file.startsWith("Base.SC2Data/UI/")) return "UI";
  return "Files";
}

/** The library items of a mod's Triggers (in Root and in folders, not a preset type's values), each by its type and element Id, with their names from TriggerStrings. */
function libraryItems(triggers: string, strings: string | undefined): { type: string; id: string; label?: string }[] {
  const names = new Map((strings ? stringLines(strings).lines : []).map((line) => [line.key, line.text.slice(line.key.length + 1).replace(/\r?\n$/, "")]));
  const library = packageLibraryId(triggers);
  return [...filedItems(triggers, { library }).values()].map(({ type, id }) => {
    const label = names.get(library ? libraryStringKey(library, type, "Name", id) : `${type}/Name/${id}`);
    return { type, id, ...(label ? { label } : {}) };
  });
}

/** The item name of a library item: a trigger's, global's or function's as the record lists it, else `<Type>:<id>`. */
const triggerItemName = (type: string, id: string): string => `${itemKind(type) ?? type}:${id}`;

/** The Kept report of the mod whose Mod Blueprint is at `blueprintPath`. */
export async function keptReport(blueprintPath: string): Promise<KeptReport> {
  const blueprint = await readModBlueprint(blueprintPath);
  const pkg = await modPackage(blueprintPath);
  const record: CompileRecord = (await readCompileRecord(blueprintPath)) ?? { version: 1, entries: [] };
  const compiled = new Set(record.entries.map(entryName));
  for (const entry of record.kept ?? []) compiled.delete(entryName(entry));
  const isKept = (item: string): boolean => !compiled.has(item);
  const read = (file: string): Promise<string> => readFile(path.join(pkg, ...file.split("/")), "utf8");

  const items = new Map<KeptComponent, KeptItem[]>(KEPT_COMPONENTS.map((component) => [component, []]));
  const notYet: KeptItem[] = [];
  const leftToEditor: KeptItem[] = [];
  const add = (component: KeptComponent, item: KeptItem, convertible = true): void => {
    if (isKept(item.item)) (convertible ? items.get(component)! : notYet).push(item);
  };
  const files = await packageFiles(pkg);
  const descIndex = generatesDescIndex(blueprint);
  const strings = files.includes("enUS.SC2Data/LocalizedData/TriggerStrings.txt") ? await read("enUS.SC2Data/LocalizedData/TriggerStrings.txt") : undefined;
  for (const file of files) {
    // One the Blueprint writes all the same is Compiled, as any file.
    if (isLeftToEditor(file) && isKept(`file:${file}`)) {
      leftToEditor.push({ item: `file:${file}`, file });
      continue;
    }
    const component = componentOf(file, descIndex);
    // A catalog file's entries are items; a GameData file that isn't a catalog (an includes list) is one.
    if (component === "GameData" && file.toLowerCase().endsWith(".xml")) {
      const text = await read(file);
      let root: string | undefined;
      try {
        root = rootChildren(text).root;
      } catch {
        root = undefined;
      }
      if (root === "Catalog" && !compiled.has(`file:${file}`)) {
        for (const entry of catalogEntries(text)) add(component, { item: `catalog-entry:${file}:${entry.key}`, file });
        continue;
      }
    }
    if (component === "Strings" && !compiled.has(`file:${file}`)) {
      for (const line of stringLines(await read(file)).lines) add(component, { item: `string:${file}:${line.key}`, file });
      continue;
    }
    if (component === "Triggers" && !compiled.has(`file:${file}`)) {
      for (const item of libraryItems(await read(file), strings)) {
        add(component, { item: triggerItemName(item.type, item.id), file, ...(item.label ? { label: item.label } : {}) }, itemKind(item.type) !== undefined);
      }
      continue;
    }
    add(component, { item: `file:${file}`, file });
  }
  const components = KEPT_COMPONENTS.map((component) => ({ component, count: items.get(component)!.length, items: items.get(component)! }));
  return { mod: blueprint.id, total: components.reduce((sum, component) => sum + component.count, 0), components, notConvertibleYet: { count: notYet.length, items: notYet }, leftToEditor: { count: leftToEditor.length, items: leftToEditor } };
}

/**
 * The report as the author reads it: each component with its count, then each file of items with
 * its count and each folder of whole files with its count, and with `items`, each item and file.
 */
export function formatKeptReport(report: KeptReport, { items = false }: { readonly items?: boolean } = {}): string {
  const lines = [`${report.mod}: ${report.total} Kept item(s)`];
  for (const { component, count, items: kept } of report.components) {
    lines.push(`  ${component}: ${count}`);
    // Grouped by the file an item is in, or by the folder of a whole file.
    const groups = new Map<string, KeptItem[]>();
    for (const item of kept) {
      const whole = item.item === `file:${item.file}`;
      const group = whole ? `${path.posix.dirname(item.file) === "." ? "(package root)" : `${path.posix.dirname(item.file)}/`}` : item.file;
      groups.set(group, [...(groups.get(group) ?? []), item]);
    }
    for (const [group, inGroup] of groups) {
      lines.push(`    ${group}: ${inGroup.length}`);
      if (items) for (const item of inGroup) lines.push(`      ${item.item === `file:${item.file}` ? item.file : item.item}${item.label ? ` "${item.label}"` : ""}`);
    }
  }
  const { count, items: notYet } = report.notConvertibleYet;
  if (count > 0) {
    lines.push(`  Not convertible yet: ${count} (library items of a type no writer knows yet)`);
    if (items) for (const item of notYet) lines.push(`      ${item.item}${item.label ? ` "${item.label}"` : ""}`);
  }
  if (report.leftToEditor.count > 0) {
    lines.push(`  Left to the Editor: ${report.leftToEditor.count} (Editor-only files the compile doesn't write)`);
    if (items) for (const item of report.leftToEditor.items) lines.push(`      ${item.file}`);
  }
  return lines.join("\n");
}
