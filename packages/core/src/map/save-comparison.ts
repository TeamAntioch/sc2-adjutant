// What an Editor open-and-save did to a Map Package, read from a copy of the package before the save and
// the package after it (issue #744, part of #735). Three questions, each a claim about the Editor that is
// unchecked on the Mac and is answered here by looking at real files rather than by assuming:
//
//  - Objects: which placed objects changed, appeared or went. Run with the ids the author touched, every
//    other change is a "phantom edit": the Editor rewrote something nobody edited (ADR-0010).
//  - Preload.xml: whether it names every placed unit type and doodad type, before and after.
//  - Localized strings: whether a save in one locale dropped keys from another locale's GameStrings.
//
// It only reads. It says what differs; whether that is the Editor's doing is the author's reading, with
// the package copied before the save and the save done once.

import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalXml } from "../util/xml.js";
import { editorObjectForm } from "./editor-changes.js";
import { objectElements, stringLines } from "./package-elements.js";

export type ObjectChange = { readonly id: string; readonly kind: string; readonly attributes: readonly string[] };

/** What the Objects file's elements did across the save. */
export type ObjectsComparison = {
  readonly present: boolean;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** Ids whose element differs once formatting is set aside, with the attribute names or child tags that differ. */
  readonly changed: readonly ObjectChange[];
  /** Of `changed`, those the author did not say they touched. Undefined when no touched list was given (an empty list is a list: every change is then a phantom edit). */
  readonly phantom?: readonly ObjectChange[];
  /** Ids that differ only as the compile ignores: an attribute the Editor leaves out at its default (`Rotation="0"`), its `HeightAbsolute` flag. Not in `changed` or `phantom`: a compile does not ask about them. */
  readonly layoutOnly: readonly string[];
  readonly unchanged: number;
};

/** The unit and doodad types Preload.xml names, against the types the Objects file places. */
export type PreloadComparison = {
  readonly present: boolean;
  /** Placed unit types and doodad types with no entry, before and after the save. */
  readonly missingBefore: readonly string[];
  readonly missingAfter: readonly string[];
  /** Entries for types nothing places, after the save. */
  readonly unusedAfter: readonly string[];
  /** Types the save added to or dropped from the file. */
  readonly entriesAdded: readonly string[];
  readonly entriesRemoved: readonly string[];
};

export type LocaleComparison = {
  readonly locale: string;
  readonly keysBefore: number;
  readonly keysAfter: number;
  readonly dropped: readonly string[];
  readonly added: readonly string[];
  /** Keys whose text differs. */
  readonly changed: readonly string[];
};

export type SaveComparison = {
  readonly objects: ObjectsComparison;
  readonly preload: PreloadComparison;
  /** One per locale folder either package has, so a locale that vanished shows with `keysAfter` 0. */
  readonly locales: readonly LocaleComparison[];
};

async function readText(file: string): Promise<string | undefined> {
  return existsSync(file) ? readFile(file, "utf8") : undefined;
}

type CanonNode = { readonly tag: string; readonly attrs: ReadonlyMap<string, string>; readonly text: string; readonly children: CanonNode[] };

/** The canonical form (one element per line, indented by depth) read back into a tree. */
function canonTree(xml: string): CanonNode | undefined {
  const root: CanonNode = { tag: "", attrs: new Map(), text: "", children: [] };
  const stack: CanonNode[] = [root];
  for (const line of canonicalXml(xml).split("\n")) {
    const depth = (line.length - line.trimStart().length) / 2;
    const trimmed = line.trim();
    const tag = /^<([A-Za-z0-9_:.-]+)/.exec(trimmed)?.[1] ?? trimmed;
    const open = /^<[A-Za-z0-9_:.-]+((?: [A-Za-z0-9_:.-]+="[^"]*")*)>?/.exec(trimmed);
    const attrs = new Map([...(open?.[1] ?? "").matchAll(/ ([A-Za-z0-9_:.-]+)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!] as [string, string]));
    const text = trimmed.slice(open?.[0].length ?? trimmed.length).replace(/^>/, "").trim();
    const node: CanonNode = { tag, attrs, text, children: [] };
    stack.length = depth + 1;
    stack[depth]!.children.push(node);
    stack.push(node);
  }
  return root.children[0];
}

const sameTree = (a: CanonNode, b: CanonNode): boolean =>
  a.tag === b.tag && a.text === b.text && a.attrs.size === b.attrs.size && [...a.attrs].every(([name, value]) => b.attrs.get(name) === value) && a.children.length === b.children.length && a.children.every((child, i) => sameTree(child, b.children[i]!));

/** What differs between two matching elements, named by path: `Tag@attribute`, `Tag[n]@attribute` (n counts siblings of that tag from 0), `Tag added` and `Tag removed`. */
function diffNodes(a: CanonNode, b: CanonNode, prefix: string, out: string[]): void {
  const label = (name: string): string => (prefix ? `${prefix}@${name}` : name);
  for (const name of new Set([...a.attrs.keys(), ...b.attrs.keys()])) if (a.attrs.get(name) !== b.attrs.get(name)) out.push(label(name));
  if (a.text !== b.text) out.push(prefix ? `${prefix} text` : "text");
  const tags = [...new Set([...a.children, ...b.children].map((child) => child.tag))];
  for (const tag of tags) {
    const was = a.children.filter((child) => child.tag === tag);
    const now = b.children.filter((child) => child.tag === tag);
    const name = (i: number, count: number): string => `${prefix ? prefix + "/" : ""}${tag}${count > 1 ? `[${i}]` : ""}`;
    const count = Math.max(was.length, now.length);
    // A child added or dropped in the middle shifts the ones after it: trim what both ends share, so only the odd ones out report.
    let start = 0;
    while (start < was.length && start < now.length && sameTree(was[start]!, now[start]!)) start++;
    let end = 0;
    while (end < was.length - start && end < now.length - start && sameTree(was[was.length - 1 - end]!, now[now.length - 1 - end]!)) end++;
    const midWas = was.slice(start, was.length - end);
    const midNow = now.slice(start, now.length - end);
    const paired = Math.min(midWas.length, midNow.length);
    for (let i = 0; i < paired; i++) diffNodes(midWas[i]!, midNow[i]!, name(start + i, count), out);
    for (let i = paired; i < midWas.length; i++) out.push(`${name(start + i, count)} removed`);
    for (let i = paired; i < midNow.length; i++) out.push(`${name(start + i, count)} added`);
  }
}

/** The attributes and children in which two copies of one element differ, in canonical form (formatting and attribute order set aside). Never empty for elements that differ. */
function differences(before: string, after: string): string[] {
  const a = canonTree(before);
  const b = canonTree(after);
  if (!a || !b) return ["element"];
  const out: string[] = [];
  if (a.tag !== b.tag) out.push("element kind");
  diffNodes(a, b, "", out);
  return out.length ? out : ["element"];
}

/** Compares the Objects files of two packages' text; `touched` are the ids the author edited, deleted or added by hand. */
export function compareObjects(before: string | undefined, after: string | undefined, touched?: readonly string[]): ObjectsComparison {
  if (before === undefined || after === undefined) return { present: false, added: [], removed: [], changed: [], layoutOnly: [], unchanged: 0 };
  const was = new Map(objectElements(before).map((element) => [element.key, element.text]));
  const now = new Map(objectElements(after).map((element) => [element.key, element.text]));
  const added = [...now.keys()].filter((id) => !was.has(id));
  const removed = [...was.keys()].filter((id) => !now.has(id));
  const changed: ObjectChange[] = [];
  const layoutOnly: string[] = [];
  let unchanged = 0;
  for (const [id, text] of was) {
    const next = now.get(id);
    if (next === undefined) continue;
    if (canonicalXml(text) === canonicalXml(next)) unchanged++;
    else if (canonicalXml(editorObjectForm(text)) === canonicalXml(editorObjectForm(next))) layoutOnly.push(id);
    else changed.push({ id, kind: /^<\s*(Object[A-Za-z]+)/.exec(text.trimStart())?.[1] ?? "?", attributes: differences(text, next) });
  }
  const told = new Set(touched ?? []);
  return { present: true, added, removed, changed, ...(touched ? { phantom: changed.filter((change) => !told.has(change.id)) } : {}), layoutOnly, unchanged };
}

/** The ids Preload.xml names, as `Kind:id`, and the types an Objects file places: units as `Unit:`, doodads as `Actor:`. */
export function preloadEntries(preload: string): Set<string> {
  return new Set([...preload.matchAll(/<(Actor|Unit|Terrain|Sound|User)\s[^>]*?\bid="([^"]*)"/g)].map((match) => `${match[1]}:${match[2]}`));
}

export function placedTypes(objects: string): Set<string> {
  const types = new Set<string>();
  for (const element of objectElements(objects)) {
    const unit = /\bUnitType="([^"]*)"/.exec(element.text)?.[1];
    const doodad = /\bType="([^"]*)"/.exec(element.text)?.[1];
    if (/^<\s*ObjectUnit\b/.test(element.text.trimStart()) && unit) types.add(`Unit:${unit}`);
    else if (/^<\s*ObjectDoodad\b/.test(element.text.trimStart()) && doodad) types.add(`Actor:${doodad}`);
  }
  return types;
}

/** Whether each package's Preload.xml names its placed types. `beforeObjects` and `afterObjects` are the Objects files' text. */
export function comparePreload(args: { readonly beforePreload?: string | undefined; readonly afterPreload?: string | undefined; readonly beforeObjects?: string | undefined; readonly afterObjects?: string | undefined }): PreloadComparison {
  const { beforePreload, afterPreload, beforeObjects, afterObjects } = args;
  if (beforePreload === undefined && afterPreload === undefined) return { present: false, missingBefore: [], missingAfter: [], unusedAfter: [], entriesAdded: [], entriesRemoved: [] };
  const named = (text: string | undefined): Set<string> => (text === undefined ? new Set() : preloadEntries(text));
  const before = named(beforePreload);
  const after = named(afterPreload);
  const placedBefore = beforeObjects === undefined ? new Set<string>() : placedTypes(beforeObjects);
  const placedAfter = afterObjects === undefined ? new Set<string>() : placedTypes(afterObjects);
  const sorted = (items: Iterable<string>): string[] => [...items].sort();
  return {
    present: true,
    missingBefore: sorted([...placedBefore].filter((type) => !before.has(type))),
    missingAfter: sorted([...placedAfter].filter((type) => !after.has(type))),
    unusedAfter: sorted([...after].filter((entry) => /^(Actor|Unit):/.test(entry) && !entry.endsWith("SYSTEM_ActorConfig") && !placedAfter.has(entry))),
    entriesAdded: sorted([...after].filter((entry) => !before.has(entry))),
    entriesRemoved: sorted([...before].filter((entry) => !after.has(entry))),
  };
}

/** One locale's GameStrings.txt across the save: keys dropped, added, and rewritten. */
export function compareStrings(locale: string, before: string | undefined, after: string | undefined): LocaleComparison {
  const keyed = (text: string | undefined): Map<string, string> => new Map(text === undefined ? [] : stringLines(text).lines.map((line) => [line.key, line.text.replace(/\r?\n$/, "")]));
  const was = keyed(before);
  const now = keyed(after);
  return {
    locale,
    keysBefore: was.size,
    keysAfter: now.size,
    dropped: [...was.keys()].filter((key) => !now.has(key)),
    added: [...now.keys()].filter((key) => !was.has(key)),
    changed: [...was.keys()].filter((key) => now.has(key) && now.get(key) !== was.get(key)),
  };
}

function localeFolders(packageDir: string): string[] {
  return existsSync(packageDir) ? readdirSync(packageDir).filter((name) => /^[a-z]{2}[A-Z]{2}\.SC2Data$/.test(name)).map((name) => name.split(".")[0]!) : [];
}

/** Reads the two package folders and compares them. `touched` are the object ids the author edited between the copies. */
export async function compareSaves(beforeDir: string, afterDir: string, touched?: readonly string[]): Promise<SaveComparison> {
  const [beforeObjects, afterObjects, beforePreload, afterPreload] = await Promise.all([
    readText(path.join(beforeDir, "Objects")),
    readText(path.join(afterDir, "Objects")),
    readText(path.join(beforeDir, "Preload.xml")),
    readText(path.join(afterDir, "Preload.xml")),
  ]);
  const locales = [...new Set([...localeFolders(beforeDir), ...localeFolders(afterDir)])].sort();
  const strings = await Promise.all(
    locales.map(async (locale) => compareStrings(locale, await readText(path.join(beforeDir, `${locale}.SC2Data`, "LocalizedData", "GameStrings.txt")), await readText(path.join(afterDir, `${locale}.SC2Data`, "LocalizedData", "GameStrings.txt")))),
  );
  return { objects: compareObjects(beforeObjects, afterObjects, touched), preload: comparePreload({ beforePreload, afterPreload, beforeObjects, afterObjects }), locales: strings };
}

const list = (items: readonly string[], limit = 12): string => (items.length === 0 ? "none" : items.slice(0, limit).join(", ") + (items.length > limit ? `, and ${items.length - limit} more` : ""));

/** The comparison as a short report, each section a plain answer to its claim. */
export function formatSaveComparison(result: SaveComparison, touchedGiven: boolean): string {
  const lines: string[] = [];
  const { objects, preload } = result;
  lines.push("Objects");
  if (!objects.present) lines.push("  an Objects file is missing from one of the packages");
  else {
    lines.push(`  ${objects.unchanged} unchanged, ${objects.changed.length} changed, ${objects.added.length} added, ${objects.removed.length} removed`);
    if (objects.added.length) lines.push(`  added: ${list(objects.added)}`);
    if (objects.removed.length) lines.push(`  removed: ${list(objects.removed)}`);
    if (objects.layoutOnly.length) lines.push(`  re-laid out only, as the compile ignores (a default attribute dropped): ${list(objects.layoutOnly)}`);
    for (const change of objects.changed.slice(0, 20)) lines.push(`  changed ${change.kind} ${change.id}: ${list(change.attributes)}`);
    lines.push(touchedGiven && objects.phantom ? `  rewritten though untouched (phantom edits): ${objects.phantom.length ? objects.phantom.map((change) => change.id).join(", ") : "none"}` : "  phantom edits: not asked; pass --touched <ids> (the ids you edited, added or deleted) to separate the Editor's own rewrites from yours");
  }
  lines.push("Preload.xml");
  lines.push("  (assumes a doodad's Type is the <Actor id> and a unit's UnitType the <Unit id>: needs an Editor check)");
  if (!preload.present) lines.push("  no Preload.xml in either package");
  else {
    lines.push(`  placed types with no entry before the save: ${list(preload.missingBefore)}`);
    lines.push(`  placed types with no entry after the save: ${list(preload.missingAfter)}`);
    lines.push(`  entries the save added: ${list(preload.entriesAdded)}; dropped: ${list(preload.entriesRemoved)}; for types nothing places: ${list(preload.unusedAfter)}`);
  }
  lines.push("Localized strings");
  if (result.locales.length === 0) lines.push("  no locale folders");
  for (const locale of result.locales) lines.push(`  ${locale.locale}: ${locale.keysBefore} keys before, ${locale.keysAfter} after; dropped ${list(locale.dropped)}; added ${list(locale.added)}; rewritten ${list(locale.changed)}`);
  return lines.join("\n");
}
