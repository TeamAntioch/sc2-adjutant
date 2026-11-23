// A catalog entry as the game sees it (issue #742): its definitions merged across the data layers
// in load order (Blizzard's packages, then a mod's), the class default and parent chain it
// inherits, its ##tokens## filled in, its removed="1" elements dropped, and the entries that name
// it. Read-only: it reads XML and writes nothing.
//
// The merge rules are the ones the Campaign Mod's catalog layer already reads by
// (campaign-catalog.ts), extended to a whole entry. A later definition of an entry replaces its
// parent when it names one and merges its fields over the earlier ones: a field given only by
// index overlays just those indices, any other replaces every earlier element of its name. An
// entry inherits, in order, its class's default (`<CUnit default="1">` with no id), then its
// parent chain from the root down, then its own fields. None of this has been checked in the
// Editor: docs/reference/effective-entry.md says what stock data backs and what still needs a check.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { type XmlNode, xmlAttribute, xmlTree, XML_COMMENT, XML_TOKEN } from "../util/xml.js";
import { loadedCatalogFiles } from "./game-data-files.js";

/** A set of catalog files loaded together, as the XML text of each, labelled for the report. */
export type DataLayer = { readonly label: string; readonly files: readonly string[] };

/** The packages of SC2Mapster's SC2GameData that make up Blizzard's data, in load order: a later one's fields override an earlier one's. */
export const STOCK_PACKAGES = [
  "mods/core.sc2mod",
  "mods/liberty.sc2mod",
  "campaigns/liberty.sc2campaign",
  "campaigns/libertystory.sc2campaign",
  "mods/swarm.sc2mod",
  "campaigns/swarm.sc2campaign",
  "campaigns/swarmstory.sc2campaign",
  "mods/void.sc2mod",
  "campaigns/void.sc2campaign",
  "campaigns/voidstory.sc2campaign",
  "mods/novastoryassets.sc2mod",
  "mods/voidprologue.sc2mod",
] as const;

type Element = { readonly index: string; readonly node: XmlNode; readonly removed: boolean; readonly from: string };
type Field = { elements: Element[]; over: boolean };
type Entry = {
  readonly cls: string;
  /** Empty for a class's default. */
  readonly id: string;
  parent?: string;
  template: boolean;
  readonly attributes: Map<string, string>;
  readonly tokens: Map<string, { type?: string; value?: string }>;
  readonly fields: Map<string, Field>;
  readonly layers: string[];
};

const keyOf = (cls: string, id: string): string => `${cls}\u0000${id}`;
const nameOf = (entry: Pick<Entry, "cls" | "id">): string => (entry.id === "" ? `${entry.cls} (class default)` : `${entry.cls}:${entry.id}`);

/** `children` merged into `fields` as the game merges a later definition (see the top of this file). */
function mergeFields(fields: Map<string, Field>, children: readonly { readonly node: XmlNode; readonly from: string }[]): void {
  const byName = new Map<string, { node: XmlNode; from: string }[]>();
  for (const child of children) {
    if (child.node.name === XML_COMMENT || child.node.name === XML_TOKEN) continue;
    byName.set(child.node.name, [...(byName.get(child.node.name) ?? []), child]);
  }
  const element = ({ node, from }: { node: XmlNode; from: string }, place: number): Element => ({ index: xmlAttribute(node, "index") ?? String(place), node, removed: xmlAttribute(node, "removed") === "1", from });
  for (const [name, nodes] of byName) {
    if (!nodes.every(({ node }) => xmlAttribute(node, "index") !== undefined)) {
      fields.set(name, { elements: nodes.map(element), over: false });
      continue;
    }
    const field = fields.get(name) ?? { elements: [], over: true };
    const elements = [...field.elements];
    for (const node of nodes) {
      const next = element(node, elements.length);
      const at = elements.findIndex((known) => known.index === next.index);
      if (at >= 0) elements[at] = next;
      else elements.push(next);
    }
    fields.set(name, { elements, over: field.over });
  }
}

/** Every entry the layers define, merged: by class and id, and by id alone. */
class DataIndex {
  readonly entries = new Map<string, Entry>();
  readonly byId = new Map<string, Entry[]>();

  constructor(layers: readonly DataLayer[]) {
    for (const layer of layers) {
      for (const xml of layer.files) {
        const root = xmlTree(xml, { tokens: true }).find((node) => node.name === "Catalog");
        for (const node of root?.children ?? []) {
          if (node.name === XML_TOKEN || node.name === XML_COMMENT) continue;
          const id = xmlAttribute(node, "id") ?? "";
          const template = xmlAttribute(node, "default") === "1";
          // An element with no id that isn't a default isn't an entry the game can name.
          if (id === "" && !template) continue;
          const key = keyOf(node.name, id);
          let entry = this.entries.get(key);
          if (!entry) {
            entry = { cls: node.name, id, template: false, attributes: new Map(), tokens: new Map(), fields: new Map(), layers: [] };
            this.entries.set(key, entry);
            if (id !== "") this.byId.set(id, [...(this.byId.get(id) ?? []), entry]);
          }
          if (!entry.layers.includes(layer.label)) entry.layers.push(layer.label);
          const parent = xmlAttribute(node, "parent");
          if (parent !== undefined) entry.parent = parent;
          if (xmlAttribute(node, "default") !== undefined) entry.template = template;
          for (const [name, value] of node.attributes) if (name !== "id" && name !== "parent" && name !== "default") entry.attributes.set(name, value);
          for (const child of node.children) {
            if (child.name !== XML_TOKEN) continue;
            const declared = xmlAttribute(child, "id");
            if (declared === undefined) continue;
            const type = xmlAttribute(child, "type");
            const value = xmlAttribute(child, "value");
            entry.tokens.set(declared, { ...(type !== undefined ? { type } : {}), ...(value !== undefined ? { value } : {}) });
          }
          mergeFields(entry.fields, node.children.map((child) => ({ node: child, from: layer.label })));
        }
      }
    }
  }

  /** `parent` as an entry of `cls` names it: of the same class, else the only entry of that id (an actor may parent another class's). */
  resolveParent(cls: string, parent: string): Entry | undefined {
    const same = this.entries.get(keyOf(cls, parent));
    if (same) return same;
    const others = this.byId.get(parent) ?? [];
    return others.length === 1 ? others[0] : undefined;
  }
}

/** An element written back as XML, its ##tokens## filled in from `tokens`; the names of any it has no value for go in `unresolved`. */
function render(node: XmlNode, tokens: ReadonlyMap<string, string>, unresolved: Set<string>): string {
  const fill = (text: string): string =>
    text.replace(/##([^#\s]+)##/g, (whole, name: string) => {
      const value = tokens.get(name);
      if (value === undefined) {
        unresolved.add(name);
        return whole;
      }
      return value;
    });
  const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const attributes = node.attributes.map(([key, value]) => ` ${key}="${escape(fill(value)).replace(/"/g, "&quot;")}"`).join("");
  const children = node.children.filter((child) => child.name !== XML_COMMENT && child.name !== XML_TOKEN);
  const text = node.text.trim() === "" ? "" : escape(fill(node.text.trim()));
  if (children.length === 0 && text === "") return `<${node.name}${attributes}/>`;
  return `<${node.name}${attributes}>${text}${children.map((child) => render(child, tokens, unresolved)).join("")}</${node.name}>`;
}

/** What names an entry: its class and id, how (its parent, a token value, or a field's attribute or text), and the layers that define it. */
export type Referrer = { readonly class: string; readonly id: string; readonly via: string; readonly layers: readonly string[] };

export type EntryReport = {
  readonly class: string;
  readonly id: string;
  /** The layers that define the entry, in load order. */
  readonly layers: readonly string[];
  /** The entry, then its parent, then its parent's, up to the root. */
  readonly chain: readonly { readonly class: string; readonly id: string; readonly layers: readonly string[] }[];
  /** A parent the data names but no layer defines, ending the chain. */
  readonly missingParent?: string;
  /** Whether the class's default (an entry of the class with no id) was applied. */
  readonly classDefault: boolean;
  /** The token values in force, `id` among them. */
  readonly tokens: Readonly<Record<string, string>>;
  /** Tokens a field names that nothing gives a value, left as written. */
  readonly unresolvedTokens: readonly string[];
  /** Each field as the game sees it: the layers and entries it came from, and its elements as XML. */
  readonly fields: readonly { readonly name: string; readonly from: readonly string[]; readonly elements: readonly string[] }[];
  /** Elements a definition removed (removed="1"), so they're not in `fields`. */
  readonly removed: readonly { readonly field: string; readonly index: string; readonly from: string }[];
  readonly referrers: { readonly total: number; readonly items: readonly Referrer[] };
  readonly notes: readonly string[];
};

export type EntryQuery = { readonly id: string; readonly class?: string; readonly referrerLimit?: number };

/** The entry as the game sees it, or why there isn't one. */
export function effectiveEntry(layers: readonly DataLayer[], query: EntryQuery): EntryReport | { readonly refused: string } {
  const index = new DataIndex(layers);
  const found = (index.byId.get(query.id) ?? []).filter((entry) => query.class === undefined || entry.cls === query.class);
  if (found.length === 0) {
    const where = query.class === undefined ? "" : ` of class ${query.class}`;
    return { refused: `No entry${where} with the id ${query.id} in ${layers.map((layer) => layer.label).join(", ") || "any data layer"}` };
  }
  if (found.length > 1) return { refused: `The id ${query.id} is defined by more than one class (${found.map((entry) => entry.cls).join(", ")}): name the class` };
  const entry = found[0]!;
  const notes: string[] = [];

  const chain: Entry[] = [entry];
  let missingParent: string | undefined;
  for (let current: Entry = entry; current.parent !== undefined; ) {
    const parent = index.resolveParent(current.cls, current.parent);
    if (!parent) {
      missingParent = current.parent;
      notes.push(`${nameOf(current)} names the parent ${current.parent}, which no layer defines, so its inherited fields stop there`);
      break;
    }
    if (chain.includes(parent)) {
      notes.push(`${nameOf(current)}'s parent ${current.parent} is already in the chain (a cycle), so the chain stops there`);
      break;
    }
    chain.push(parent);
    current = parent;
  }
  const classDefault = index.entries.get(keyOf(entry.cls, ""));
  const applied = [...(classDefault ? [classDefault] : []), ...[...chain].reverse()];

  const fields = new Map<string, Field>();
  const tokens = new Map<string, string>();
  for (const source of applied) {
    mergeFields(fields, [...source.fields.values()].flatMap((field) => field.elements.map((element) => ({ node: element.node, from: `${nameOf(source)} in ${element.from}` }))));
    for (const [name, declared] of source.tokens) if (declared.value !== undefined) tokens.set(name, declared.value);
    for (const [name, value] of source.attributes) tokens.set(name, value);
  }
  tokens.set("id", entry.id);

  const unresolved = new Set<string>();
  const outFields = [...fields]
    .map(([name, field]) => ({ name, from: [...new Set(field.elements.filter((element) => !element.removed).map((element) => element.from))], elements: field.elements.filter((element) => !element.removed).map((element) => render(element.node, tokens, unresolved)) }))
    .filter((field) => field.elements.length > 0);
  const removed = [...fields].flatMap(([name, field]) => field.elements.filter((element) => element.removed).map((element) => ({ field: name, index: element.index, from: element.from })));

  // Entries that name it: as parent, as a token's value, or as a whole attribute value or text in a field.
  const referrers: Referrer[] = [];
  const mention = (node: XmlNode, at: string): string[] => [
    ...node.attributes.filter(([, value]) => value === entry.id).map(([name]) => `${at}@${name}`),
    ...(node.text.trim() === entry.id ? [`${at} text`] : []),
    ...node.children.flatMap((child) => mention(child, `${at}/${child.name}`)),
  ];
  for (const other of index.entries.values()) {
    if (other === entry) continue;
    const vias: string[] = [];
    if (other.parent === entry.id) vias.push("parent");
    for (const [name, value] of other.attributes) if (value === entry.id) vias.push(`token ${name}`);
    for (const [name, field] of other.fields) for (const element of field.elements) vias.push(...mention(element.node, name));
    for (const via of vias) referrers.push({ class: other.cls, id: other.id, via, layers: other.layers });
  }
  referrers.sort((a, b) => (a.class + a.id + a.via < b.class + b.id + b.via ? -1 : 1));
  const limit = query.referrerLimit ?? 50;
  if (referrers.length > limit) notes.push(`${referrers.length} places name ${entry.id}; the first ${limit} are listed`);
  notes.push("Referrers are found by an exact id as a whole value; a reference built by a token (##id##) in a template isn't followed");

  return {
    class: entry.cls,
    id: entry.id,
    layers: entry.layers,
    chain: chain.map((link) => ({ class: link.cls, id: link.id, layers: link.layers })),
    ...(missingParent !== undefined ? { missingParent } : {}),
    classDefault: classDefault !== undefined,
    tokens: Object.fromEntries(tokens),
    unresolvedTokens: [...unresolved].sort(),
    fields: outFields,
    removed,
    referrers: { total: referrers.length, items: referrers.slice(0, limit) },
    notes,
  };
}

/** The report as plain lines for a reply. */
export function formatEntryReport(report: EntryReport): string {
  const lines = [`${report.class}:${report.id}, defined in ${report.layers.join(", ")}`];
  lines.push(`Inherits: ${report.chain.slice(1).map((link) => link.id).join(" > ") || "no parent"}${report.missingParent ? ` (parent ${report.missingParent} isn't defined)` : ""}${report.classDefault ? `, and the ${report.class} default` : ""}`);
  const tokens = Object.entries(report.tokens).filter(([name]) => name !== "id");
  if (tokens.length > 0) lines.push(`Tokens: ${tokens.map(([name, value]) => `${name}=${value}`).join(", ")}`);
  if (report.unresolvedTokens.length > 0) lines.push(`Unresolved tokens: ${report.unresolvedTokens.join(", ")}`);
  lines.push("Fields:");
  for (const field of report.fields) lines.push(...field.elements.map((element) => `  ${element}  (${field.from.join(", ")})`));
  if (report.removed.length > 0) lines.push(`Removed: ${report.removed.map((one) => `${one.field}[${one.index}] by ${one.from}`).join(", ")}`);
  lines.push(`Named by ${report.referrers.total}:`);
  for (const referrer of report.referrers.items) lines.push(`  ${referrer.class}:${referrer.id} ${referrer.via}`);
  lines.push(...report.notes.map((note) => `Note: ${note}`));
  return lines.join("\n");
}

/** Blizzard's data layers from an SC2GameData folder (its `mods/` and `campaigns/` packages), in load order, skipping a package it lacks; none when it has none. */
export async function stockLayers(folder: string): Promise<DataLayer[]> {
  const layers: DataLayer[] = [];
  for (const pkg of STOCK_PACKAGES) {
    const dir = path.join(folder, ...pkg.split("/"));
    if (!existsSync(dir)) continue;
    const files = await Promise.all((await loadedCatalogFiles(dir)).map((file) => readFile(path.join(dir, ...file.split("/")), "utf8")));
    layers.push({ label: pkg.split("/")[1]!, files });
  }
  return layers;
}
