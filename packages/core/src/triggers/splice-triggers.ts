// Splices Compiled triggers and variables into a Triggers file that has Kept ones (ADR-0010).
//
// The Editor writes Triggers as a Root list of items (triggers, variables, categories) followed by
// one flat list of elements, each a trigger, variable, category, function call or parameter, tied
// together by Id. A Compiled trigger or variable is its Root item and every function call and
// parameter it reaches. The splice removes the previous compile's, by the record's ids, and adds
// the new ones: their items at the end of Root, their elements at the end of the file. Every line
// the Editor wrote for Kept Content stays as it was.
//
// A custom trigger library is the same list inside a `<Library Id>` block, its item lines and
// references naming the library. The caller says which list it splices (TriggersScope): a map's
// own, outside every library it embeds, or a mod's library, by its Id. Nothing outside that list is
// read or written.
//
// An element is known by its type and Id together, as the Triggers reader knows it: an older
// Editor save numbers each type apart, so a Kept global and a Kept call can share an Id.

import { type CompileRecordEntry, fingerprint, type KeptEntry } from "../domain/compile-record.js";
import { elementKey as key } from "./triggers-file.js";

type Span = { readonly start: number; readonly end: number };
type XmlElement = Span & { readonly type: string; readonly id: string; readonly text: string };
type RootItem = Span & { readonly type: string; readonly id: string };

/** A Compiled trigger, variable or library function written by a splice, and the fingerprint of all its XML. */
export type SplicedItem = { readonly kind: SplicedKind; readonly id: string; readonly fingerprint: string };
export type SplicedKind = "trigger" | "variable" | "function" | "category" | "preset" | "structure" | "comment" | "custom-script";

/**
 * The item types a splice writes, by the record kind each is: a mod's library's functions,
 * categories (trigger folders), preset types, structures, comments and custom script as well as
 * triggers and globals.
 */
const ITEM_KINDS: Readonly<Record<string, SplicedKind>> = {
  Trigger: "trigger",
  Variable: "variable",
  FunctionDef: "function",
  Category: "category",
  Preset: "preset",
  Structure: "structure",
  Comment: "comment",
  CustomScript: "custom-script",
};
/** The record kind of an item type (Trigger, Variable, FunctionDef), or undefined for one a splice doesn't write. */
export const itemKind = (type: string): SplicedKind | undefined => ITEM_KINDS[type];
const ITEM_TYPES = Object.fromEntries(Object.entries(ITEM_KINDS).map(([type, kind]) => [kind, type])) as Readonly<Record<SplicedKind, string>>;
/**
 * The element key (type and Id, as elementKey has it) of an item a record names by its kind and Id:
 * how a splice and the maps here know it, since an older save gives a Trigger and a Variable one Id.
 */
export const recordedItemKey = (entry: { readonly kind: SplicedKind; readonly id: string }): string => key(ITEM_TYPES[entry.kind], entry.id);
/** The element keys (recordedItemKey) of the Triggers items `entries` name, a record's or its kept list's: of `kinds` only, when given. */
export const recordedItemKeys = (entries: readonly (CompileRecordEntry | KeptEntry)[], kinds?: readonly SplicedKind[]): Set<string> =>
  new Set(entries.flatMap((entry) => (isSplicedEntry(entry) && (kinds === undefined || kinds.includes(entry.kind)) ? [recordedItemKey(entry)] : [])));
/** Whether a record kind is one a Triggers splice writes: a trigger, a global or a library function. */
export const isSplicedKind = (kind: string): kind is SplicedKind => Object.values(ITEM_KINDS).includes(kind as SplicedKind);
/** Whether a record entry is one a Triggers splice writes, by its kind. */
export const isSplicedEntry = <Entry extends { readonly kind: string }>(entry: Entry): entry is Extract<Entry, { readonly kind: SplicedKind }> => isSplicedKind(entry.kind);

/** The elements that belong to the item that references them: calls, comments and parameters, never another item. */
const OWNED_TYPES = new Set(["FunctionCall", "Param", "Comment"]);
/** What a library function owns beside its calls: its parameter definitions, block slots and local variables. */
const FUNCTION_OWNED = new Set(["ParamDef", "SubFuncType", "Variable"]);
/** What an item owns beside calls, comments and parameters, by its type: a trigger its local variables, a preset type its values, a structure its members. */
const ITEM_OWNED: Readonly<Record<string, ReadonlySet<string>>> = { Trigger: new Set(["Variable"]), FunctionDef: FUNCTION_OWNED, Preset: new Set(["PresetValue"]), Structure: new Set(["Variable"]) };

/** An item line, in Root or a folder; a library's names the library. */
export const ITEM_LINE = (): RegExp => /^[ \t]*<Item Type="([^"]+)"(?: Library="[^"]*")? Id="([^"]+)"\/>/gm;

/**
 * Which trigger list of a Triggers file a splice works on: a map's own (no library, the default),
 * outside every library the map embeds, or the custom library `library`, a mod's.
 */
export type TriggersScope = { readonly library?: string | undefined };

/** Each `<Library Id>` block of `xml`: from its opening line, past its opening tag (inner), to its closing line (a self-closing one is empty). */
function libraryBlocks(xml: string): (Span & { readonly id: string; readonly inner: number })[] {
  const out: (Span & { id: string; inner: number })[] = [];
  for (const match of xml.matchAll(/^[ \t]*<Library Id="([^"]+)"(\/?)>/gm)) {
    const inner = match.index! + match[0].length;
    const close = match[2] === "/" ? 0 : xml.slice(inner).search(/^[ \t]*<\/Library>/m);
    out.push({ id: match[1]!, start: match.index!, inner, end: close < 0 ? xml.length : inner + close });
  }
  return out;
}

/** Whether an index of `xml` is in `scope`'s part of it: outside every library for a map's own list, else inside that library. */
function region(xml: string, scope: TriggersScope): (index: number) => boolean {
  const blocks = libraryBlocks(xml);
  if (scope.library === undefined) return (index) => !blocks.some((block) => index >= block.start && index < block.end);
  const block = blocks.find((each) => each.id === scope.library);
  return (index) => block !== undefined && index >= block.inner && index < block.end;
}

/** The index of the first match of `pattern` (global) inside `scope`'s part of `xml`, or -1. */
function searchIn(xml: string, pattern: RegExp, scope: TriggersScope): number {
  const contains = region(xml, scope);
  for (const match of xml.matchAll(pattern)) if (contains(match.index!)) return match.index!;
  return -1;
}

/** Where `scope`'s elements end: its `</Library>` or the file's `</TriggerData>` line. */
function elementsEnd(xml: string, scope: TriggersScope): number {
  if (scope.library === undefined) return searchIn(xml, /^[ \t]*<\/TriggerData>/gm, scope);
  const block = libraryBlocks(xml).find((each) => each.id === scope.library);
  return block && block.end > block.inner ? block.end : -1;
}

/** Every top-level element of `scope`, by its type and Id, from the start of its line to the end of its line. */
function elements(xml: string, scope: TriggersScope): Map<string, XmlElement> {
  const out = new Map<string, XmlElement>();
  const contains = region(xml, scope);
  for (const match of xml.matchAll(/^[ \t]*<Element Type="([^"]+)" Id="([^"]+)"(\/?)>/gm)) {
    const start = match.index!;
    if (!contains(start)) continue;
    const close = match[3] === "/" ? start + match[0].length : xml.indexOf("</Element>", start) + "</Element>".length;
    const end = lineEnd(xml, close);
    out.set(key(match[1]!, match[2]!), { type: match[1]!, id: match[2]!, start, end, text: xml.slice(start, end) });
  }
  return out;
}

/** Where `scope`'s Root list opens and closes, or -1 for each. */
function rootSpan(xml: string, scope: TriggersScope): { readonly open: number; readonly close: number } {
  const open = searchIn(xml, /<Root>/g, scope);
  return { open, close: open < 0 ? -1 : xml.indexOf("</Root>", open) };
}

/** Where the line holding `index` ends, past its line ending. */
function lineEnd(text: string, index: number): number {
  const newline = text.indexOf("\n", index);
  return newline < 0 ? text.length : newline + 1;
}

/** The item `item` (its element) and every call and parameter it reaches in `scope`'s list, in document order. */
function owned(item: { readonly type: string; readonly id: string }, all: ReadonlyMap<string, XmlElement>, scope: TriggersScope): XmlElement[] {
  const found = new Map<string, XmlElement>();
  const visit = (element: XmlElement): void => {
    if (found.has(key(element.type, element.id))) return;
    found.set(key(element.type, element.id), element);
    // A category's item lines file other items, which it doesn't own.
    if (element.type === "Category") return;
    for (const match of element.text.matchAll(/<\w+ Type="(\w+)"(?: Library="([^"]*)")? Id="([^"]+)"\/>/g)) {
      // A reference into another library (Ntve's functions, say) is never this list's own.
      if (match[2] !== scope.library) continue;
      const child = all.get(key(match[1]!, match[3]!));
      // A trigger's own Variable lines are its local variables; a function's own ParamDef, SubFuncType and Variable lines are its definition's;
      // a preset type's Item lines are its values, a structure's Variable lines its members.
      if (child && (OWNED_TYPES.has(child.type) || ITEM_OWNED[element.type]?.has(child.type))) visit(child);
    }
  };
  const root = all.get(key(item.type, item.id));
  if (root) visit(root);
  return [...found.values()].sort((a, b) => a.start - b.start);
}

/** Cuts `spans` out of `text`, a span's text in `replacements` (by its start) put where it was; one inside another (an item line in a folder cut whole) goes with it. */
function cut(text: string, spans: readonly Span[], replacements: ReadonlyMap<number, string> = new Map()): string {
  let out = "";
  let cursor = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.end <= cursor) continue;
    out += text.slice(cursor, Math.max(cursor, span.start)) + (replacements.get(span.start) ?? "");
    cursor = span.end;
  }
  return out + text.slice(cursor);
}

/** A Compiled item's whole XML: its Root line and its elements, for its fingerprint. */
function itemText(item: RootItem, xml: string, all: ReadonlyMap<string, XmlElement>, scope: TriggersScope): string {
  return [xml.slice(item.start, item.end), ...owned(item, all, scope).map((element) => element.text)].join("");
}

/**
 * The Kept items of `scope`'s list in `xml`: every item but those `compiled` lists (by element key). On a Mission,
 * filed in Root or a folder (the compile's own too); in a mod's library, filed in Root, as before
 * Trigger Folders (its categories are the Mod Blueprint's).
 */
export function keptItems(xml: string, compiled: ReadonlySet<string>, scope: TriggersScope = {}): { readonly type: string; readonly id: string }[] {
  return itemLines(xml, scope).filter((item) => (compilesFolders(scope) || item.inRoot) && !compiled.has(key(item.type, item.id))).map(({ type, id }) => ({ type, id }));
}

/**
 * A Mission's compile folder's text (its item text, as triggerItemTexts has it) as its record's
 * fingerprint covers it: without the Item lines of items the compile doesn't own there (`owns`, by element key), so the
 * author filing a Kept item in it, or a Compiled one out of it into their own folder, is no Editor
 * change. The author's filing wins (spliceTriggers).
 */
export function compileFolderText(text: string, owns: (key: string) => boolean): string {
  return text.replace(ITEM_LINE(), (line, type: string, id: string) => (owns(key(type, id)) ? line : "\0")).replace(/^\0\r?\n/gm, "");
}

/**
 * Each item of `xml`'s list a splice writes (a trigger, global variable, library function,
 * category, preset type, structure, comment or custom script), filed in Root or a folder, by
 * element key (type and Id): its type, Id and whole XML, as a record's fingerprint is taken of it.
 */
export function triggerItemTexts(xml: string, scope: TriggersScope = {}): Map<string, { readonly type: string; readonly id: string; readonly text: string }> {
  const all = elements(xml, scope);
  const out = new Map<string, { type: string; id: string; text: string }>();
  for (const line of itemLines(xml, scope, all)) {
    if (itemKind(line.type)) out.set(key(line.type, line.id), { type: line.type, id: line.id, text: itemText(line, xml, all, scope) });
  }
  return out;
}

/**
 * Each item `xml` files in Root or a folder, by element key (type and Id): its type and Id, the
 * folder it's in (none for Root) and the elements it owns, in order, each with LF line ends and
 * none after it.
 */
export function libraryItems(xml: string, scope: TriggersScope = {}): Map<string, { readonly type: string; readonly id: string; readonly folder?: string; readonly elements: readonly string[] }> {
  const all = elements(xml, scope);
  const out = new Map<string, { type: string; id: string; folder?: string; elements: string[] }>();
  for (const line of itemLines(xml, scope, all)) out.set(key(line.type, line.id), { type: line.type, id: line.id, ...(line.folder ? { folder: line.folder } : {}), elements: owned(line, all, scope).map((element) => element.text.replace(/\r?\n$/, "").replace(/\r\n/g, "\n")) });
  return out;
}

/** Each Compiled item `generated` holds (one with its own elements there, not just a line filing a Kept one), with its fingerprint. */
export function triggerItems(generated: string, scope: TriggersScope = {}): SplicedItem[] {
  const all = elements(generated, scope);
  const seen = new Set<string>();
  return itemLines(generated, scope, all).flatMap((item) => {
    const kind = itemKind(item.type);
    if (!kind || !all.has(key(item.type, item.id)) || seen.has(key(item.type, item.id))) return [];
    seen.add(key(item.type, item.id));
    return [{ kind, id: item.id, fingerprint: fingerprint(itemText(item, generated, all, scope)) }];
  });
}

/**
 * Every item line of `scope`, in Root or in a trigger folder (a Category element): what files a
 * trigger, global or other item. A preset type's lines naming its values aren't item lines.
 */
function itemLines(xml: string, scope: TriggersScope, all: ReadonlyMap<string, XmlElement> = elements(xml, scope)): (RootItem & { readonly inRoot: boolean; readonly folder?: string })[] {
  const { open, close } = rootSpan(xml, scope);
  const contains = region(xml, scope);
  const folders = [...all.values()].filter((element) => element.type === "Category");
  return [...xml.matchAll(ITEM_LINE())].flatMap((match) => {
    const at = match.index!;
    if (!contains(at)) return [];
    const inRoot = open >= 0 && at > open && at < close;
    const folder = inRoot ? undefined : folders.find((element) => at > element.start && at < element.end);
    if (!inRoot && !folder) return [];
    return [{ type: match[1]!, id: match[2]!, start: at, end: lineEnd(xml, at + match[0].length), inRoot, ...(folder ? { folder: folder.id } : {}) }];
  });
}

/**
 * Whether the compile works out the folders of `scope`'s list itself, filing only its own items in
 * them: a Mission's Trigger Folders. A mod's library is filed by its Mod Blueprint's categories,
 * which file Kept items too.
 */
const compilesFolders = (scope: TriggersScope): boolean => scope.library === undefined;

/**
 * A folder's element `text` without the item lines of `drop`, and with the Kept lines `add` (whole
 * lines), each put back after the item it followed in the package's folder (`order`, in order), or
 * first when nothing before it is still there. Items are known by their element keys throughout.
 */
function refiled(text: string, drop: ReadonlySet<string>, add: ReadonlyMap<string, string>, order: readonly string[]): string {
  const kept = text.replace(ITEM_LINE(), (line, type: string, id: string) => (drop.has(key(type, id)) ? "\0" : line)).replace(/^\0\r?\n/gm, "");
  if (add.size === 0) return kept;
  const lines = [...kept.matchAll(ITEM_LINE())].map((match) => ({ key: key(match[1]!, match[2]!), text: kept.slice(match.index!, lineEnd(kept, match.index! + match[0].length)) }));
  for (const [item, line] of add) {
    const before = order.slice(0, order.indexOf(item)).reverse().find((each) => lines.some((other) => other.key === each));
    lines.splice(before === undefined ? 0 : lines.findIndex((other) => other.key === before) + 1, 0, { key: item, text: line });
  }
  const first = kept.search(ITEM_LINE());
  const at = first < 0 ? kept.lastIndexOf("\n", kept.lastIndexOf("</Element>")) + 1 : first;
  return kept.slice(0, at) + lines.map((line) => line.text).join("") + kept.slice(at).replace(ITEM_LINE(), "\0").replace(/^\0\r?\n/gm, "");
}

/**
 * `existing` with the previous compile's items (`previous`, by element key) taken out and those of
 * `generated` (a whole Triggers file, or none) put in. One the author has filed in a trigger folder
 * of their own stays filed there, unless `generated` is a mod library's that files it in a category
 * of its own; one `generated` files in Root goes at the end of Root, and the author's folders are
 * never written. A mod library's category files its items itself, Kept ones too, so a Kept item it
 * no longer files would be lost, and is refused. On a Mission, a Kept item the author filed in a
 * folder an earlier compile wrote stays in it, or goes to the end of Root once the compile no
 * longer writes that folder. A Compiled element whose Id a Kept one has is refused, unless it
 * replaces the package's element of its own type and Id, whose Id an older save already shared.
 */
export function spliceTriggers(
  existing: string,
  generated: string | undefined,
  previous: ReadonlySet<string>,
  /** Compiled items the author kept (compile-map --keep), by element key: left as the package has them, and not added. */
  skip: ReadonlySet<string> = new Set(),
  /** The trigger list spliced, in `existing` and `generated` alike: a map's own by default. */
  scope: TriggersScope = {},
  /**
   * Items written in place, by element key: one the package has already (in `previous`) keeps its
   * Root line where it stands, and its elements go where its old ones began, rather than at the
   * ends of Root and the file. A Mission Blueprint's own elements (ADR-0026), so one converted
   * from Kept stays where the Editor had it.
   */
  inPlace: ReadonlySet<string> = new Set(),
): { readonly content: string; readonly items: SplicedItem[] } {
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  if (scope.library !== undefined && !libraryBlocks(existing).some((block) => block.id === scope.library)) throw new Error(`Triggers has no library ${scope.library} to add the compile's triggers to`);
  // A Root the Editor saved empty closes itself: opened up, so items can go in it.
  const emptyRoot = searchIn(existing, /^([ \t]*)<Root\s*\/>/gm, scope);
  const opened = emptyRoot < 0 ? existing : existing.slice(0, emptyRoot) + existing.slice(emptyRoot).replace(/^([ \t]*)<Root\s*\/>/, (_, indent: string) => `${indent}<Root>${eol}${indent}</Root>`);
  const all = elements(opened, scope);
  const freshElements = generated === undefined ? new Map<string, XmlElement>() : elements(generated, scope);
  const generatedLines = generated === undefined ? [] : itemLines(generated, scope, freshElements);
  const itemKey = (line: { readonly type: string; readonly id: string }): string => key(line.type, line.id);
  // In a folder the author kept (--keep): it files its items as the package has it.
  const inKeptFolder = (line: { readonly folder?: string }): boolean => line.folder !== undefined && skip.has(key("Category", line.folder));
  const allFresh = generatedLines.filter((line) => !skip.has(itemKey(line)));
  // The items the compile writes: each with elements of its own in `generated`, once.
  const items = [...new Map(allFresh.filter((line) => itemKind(line.type) && freshElements.has(itemKey(line))).map((line) => [itemKey(line), line])).values()];
  const freshLines = allFresh.filter((line) => !inKeptFolder(line));
  const inFreshFolder = new Set(freshLines.filter((line) => line.folder !== undefined).map(itemKey));
  const inFreshRoot = new Set(freshLines.filter((line) => line.inRoot).map(itemKey));
  // Where the compile files each item, those the author kept (--keep) too: one they filed in a folder of their own stays there.
  const inFreshFolderAll = new Set(generatedLines.filter((line) => line.folder !== undefined && !inKeptFolder(line)).map(itemKey));
  const lines = itemLines(opened, scope, all);
  // The previous compile's items, by the item lines filing them in Root or a folder: a trigger's comment or local variable may share an item's Id in an older map, but is no item.
  const previousLines = lines.filter((line) => previous.has(itemKey(line)) && itemKind(line.type));
  // Once each: an item may be filed both in Root and in a folder.
  const filedItems = new Set(previousLines.map((line) => all.get(itemKey(line))).filter((element): element is XmlElement => element !== undefined));
  // One whose line is gone (a hand edit) is still the previous compile's, when no filed item has its Id and no element references it as its own.
  const references = new Set([...all.values()].flatMap((element) => [...element.text.matchAll(/<\w+ Type="(\w+)"(?: Library="([^"]*)")? Id="([^"]+)"\/>/g)].filter((match) => match[2] === scope.library).map((match) => key(match[1]!, match[3]!))));
  const filedKeys = new Set(lines.map(itemKey));
  const unfiled = [...all.values()].filter((element) => previous.has(itemKey(element)) && itemKind(element.type) && !filedKeys.has(itemKey(element)) && !references.has(itemKey(element)));
  const previousItems = [...filedItems, ...unfiled];
  const cutElements = previousItems.flatMap((element) => owned(element, all, scope));
  const insideCut = (line: Span): boolean => cutElements.some((element) => line.start > element.start && line.start < element.end);
  // The items written in place: each the compile writes that the package has as a previous item.
  const placed = new Set(items.map(itemKey).filter((each) => inPlace.has(each) && previousItems.some((element) => itemKey(element) === each)));
  // Each one's Root line stays where it is, when the compile files it in Root alone.
  const placedInRoot = new Set(lines.filter((line) => line.inRoot && placed.has(itemKey(line)) && inFreshRoot.has(itemKey(line)) && !inFreshFolder.has(itemKey(line))).map(itemKey));
  // A Mission's compile works out its own folders and never files a Kept item; a Mod Blueprint's categories file every item they hold.
  const compileFiles = compilesFolders(scope);
  // Filed in a folder the compile doesn't write, by the author, and given Root by the compile (or, on a Mission, a folder of the compile's): its line stays where it is.
  const filed = new Set(lines.filter((line) => !line.inRoot && !insideCut(line) && !inKeptFolder(line) && ((inFreshRoot.has(itemKey(line)) && !inFreshFolder.has(itemKey(line))) || (compileFiles && inFreshFolderAll.has(itemKey(line))))).map(itemKey));
  const cutLines = lines.filter((line) => !insideCut(line) && !filed.has(itemKey(line)) && !inKeptFolder(line) && (previous.has(itemKey(line)) || inFreshFolderAll.has(itemKey(line)) || (line.inRoot && inFreshRoot.has(itemKey(line)))) && !(line.inRoot && placedInRoot.has(itemKey(line))));
  // A Kept item filed in a folder the compile now writes, which no longer files it, would be lost; one the author kept (--keep) counts as filed where the compile files it.
  const filedAnywhere = new Set(generatedLines.filter((line) => !inKeptFolder(line)).map(itemKey));
  const lost = lines.filter((line) => insideCut(line) && !previous.has(itemKey(line)) && !filedAnywhere.has(itemKey(line)) && itemKind(line.type) !== undefined);
  if (lost.length > 0 && !compileFiles) throw new Error(`The compile writes the folder${lost.length === 1 ? "" : "s"} ${[...new Set(lost.map((line) => line.folder))].join(", ")} without the Kept ${lost.map((line) => `${line.type} ${line.id}`).join(", ")} filed there: file ${lost.length === 1 ? "it" : "each"} in the Blueprint (in a category or Root), or it would be lost`);
  // On a Mission, such an item stays in its folder when the compile still writes that folder, else goes in Root.
  const writesFolder = (id: string | undefined): id is string => id !== undefined && items.some((item) => item.type === "Category" && item.id === id);
  const keptInFolder = new Map<string, Map<string, string>>();
  for (const line of lost) if (writesFolder(line.folder)) keptInFolder.set(line.folder, (keptInFolder.get(line.folder) ?? new Map<string, string>()).set(itemKey(line), opened.slice(line.start, line.end)));
  const folderOrder = (id: string): string[] => lines.filter((line) => line.folder === id).map(itemKey);
  const keptToRoot = lost.filter((line) => !writesFolder(line.folder)).map((line) => opened.slice(line.start, line.end));
  const asLines = (text: string): string => text.replace(/\r?\n/g, eol).replace(new RegExp(`(${eol})?$`), eol);
  // A compiled element as it is written: a Mission's folder refiled with the Kept items it keeps.
  const writtenText = (element: XmlElement): string => (element.type === "Category" ? refiled(element.text, filed, keptInFolder.get(element.id) ?? new Map(), folderOrder(element.id)) : element.text);
  // Each placed item's elements go where its first old one began.
  const placedElements = new Set<string>();
  const replacements = new Map<number, string>();
  for (const each of placed) {
    const now = owned(items.find((item) => itemKey(item) === each)!, freshElements, scope);
    for (const element of now) placedElements.add(itemKey(element));
    // Its old elements begin with its own element, which made it a previous item.
    const old = owned(all.get(each)!, all, scope);
    replacements.set(Math.min(...old.map((element) => element.start)), now.map((element) => asLines(writtenText(element))).join(""));
  }
  let kept = cut(opened, [...cutLines, ...cutElements], replacements);

  const rootLines = [...keptToRoot, ...freshLines.filter((line) => line.inRoot && !filed.has(itemKey(line)) && !placedInRoot.has(itemKey(line))).map((line) => generated!.slice(line.start, line.end))].map(asLines).join("");
  if (generated === undefined && rootLines === "") return { content: kept, items: [] };
  const { close: rootEnd } = rootSpan(kept, scope);
  const rootClose = rootEnd < 0 ? -1 : kept.lastIndexOf("\n", rootEnd) + 1;
  if (rootEnd < 0) throw new Error("Triggers has no Root list to add the compile's triggers to");
  kept = kept.slice(0, rootClose) + rootLines + kept.slice(rootClose);
  if (generated === undefined) return { content: kept, items: [] };

  // A Kept element by its Id alone: a Compiled element may have no Id a Kept one of any type has, as the Editor numbers them.
  const keptIds = new Map([...elements(kept, scope).values()].map((element) => [element.id, element]));
  // The exception: one that replaces the package's own element of its type and Id (a converted Kept item), whose Id an older save already shared.
  const replaced = new Set(cutElements.map(itemKey));
  // The compile's elements in the order it wrote them, which for a library is the Editor's.
  const written = new Map<string, XmlElement>();
  for (const item of items) for (const element of owned(item, freshElements, scope)) if (!placedElements.has(itemKey(element))) written.set(key(element.type, element.id), element);
  const blocks: string[] = [];
  for (const element of [...written.values()].sort((a, b) => a.start - b.start)) {
    const clash = replaced.has(itemKey(element)) ? undefined : keptIds.get(element.id);
    if (clash) throw new Error(`The compile's ${element.type} ${element.id} has the element Id of a Kept ${clash.type} in Triggers; not compiled`);
    blocks.push(writtenText(element));
  }
  const dataClose = elementsEnd(kept, scope);
  if (dataClose < 0) throw new Error(`Triggers has no ${scope.library === undefined ? "</TriggerData>" : `</Library> for ${scope.library}`} to add the compile's triggers before`);
  kept = kept.slice(0, dataClose) + blocks.map(asLines).join("") + kept.slice(dataClose);
  const spliced = triggerItems(generated, scope).filter((item) => !skip.has(recordedItemKey(item)));
  if (!compileFiles) return { content: kept, items: spliced };
  // A Mission's folder is recorded as the package has it, without those the author filed elsewhere, and without the Item lines it doesn't own (compileFolderText).
  const inPackage = triggerItemTexts(kept, scope);
  const own = new Set(spliced.map(recordedItemKey));
  return {
    content: kept,
    items: spliced.map((item) => {
      const folder = item.kind === "category" ? inPackage.get(recordedItemKey(item)) : undefined;
      return folder ? { ...item, fingerprint: fingerprint(compileFolderText(folder.text, (each) => own.has(each))) } : item;
    }),
  };
}
