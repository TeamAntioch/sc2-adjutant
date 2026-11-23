// Generic typed catalog entries (ADR-0011): the general layer of a Campaign Mod's game data. An
// entry names its catalog, class, id and parent and holds its fields, and compiles to one element
// of a GameData catalog file, its catalog's own (`<Catalog>Data.xml`) unless it names another.
// It's checked against the game's data schema (catalog-schema.ts) before anything is written.
//
// Fields are written as Blizzard's catalogs write them:
//
//   fields: { "LifeMax": 120 }                         <LifeMax value="120"/>
//   fields: { "WeaponArray": { "Link": "Gun" } }       <WeaponArray Link="Gun"/>
//   fields: { "Attributes": [{ "index": "Armored", "value": 1 }, …] }
//                                                      one <Attributes index="Armored" value="1"/> each
//   fields: { "State": { "index": 0, "Height": { "value": 3.4 } } }
//                                                      <State index="0"><Height value="3.4"/></State>
//
// A field (or an array's item) given as a number or string is its value; given as an object, it's
// a structure, whose numbers and strings are its attributes and whose objects and arrays are its
// own fields, nested the same way ("$text" is an element's text). An array is a field written once
// per item, in order. A comment inside an entry is kept where it stands (catalog-fields.ts):
//
//   fields: { "LifeMax": 120, "$comment": "<Speed value=\"2\"/>" }
//                                                      <LifeMax value="120"/> then <!--<Speed value="2"/>-->
//   fields: { "On": [{ "Terms": "A" }, { "$comment": "a note" }, { "Terms": "B" }] }
//                                                      <On Terms="A"/>, <!--a note-->, <On Terms="B"/>
//
// An entry with no id is its class's default, and says so (<CDSPLowPassSimple default="1">). That form is
// lossless for Blizzard's catalogs, so a Kept entry converts to a generic one and back with
// nothing the Editor reads changed (convert-entries.ts), and its comments kept.
//
// A template entry declares the ##tokens## its children fill in, each with its type and default
// value when it has them, written first as the Editor writes them:
//
//   tokens: [{ "id": "abil", "type": "CAbilLink" }]   <?token id="abil" type="CAbilLink"?>
//
// An entry also holds the localized strings keyed to it, by strings file (entry-strings.ts):
//
//   strings: { "enUS.SC2Data/LocalizedData/GameStrings.txt": { "Unit/Name/Gull": "Gull" } }

import { z } from "zod";

import { COMMENT, type FieldStruct, FieldsSchema, type FieldValue, isCommentItem, isCommentKey, XML_NAME } from "../domain/catalog-fields.js";
import { StringsSchema } from "../domain/entry-strings.js";
import { GAME_DATA_DIR } from "../domain/mod-blueprint.js";
import { catalogEntryKey } from "../map/catalog-entries.js";
import { canonicalXml, XML_COMMENT, XML_TOKEN, type XmlNode, xmlTree } from "../util/xml.js";

/** A token a template entry declares (<?token id="abil" type="CAbilLink"?>): its id, and its type and default value when it has them. */
const TokenSchema = z.object({ id: z.string().min(1), type: z.string().optional(), value: z.string().optional() }).strict();
const TOKEN_ATTRIBUTES = ["id", "type", "value"] as const;

export const GenericEntrySchema = z
  .object({
    /** The catalog the class belongs to, as the game names it: Unit, Actor, Water … */
    catalog: z.string().min(1),
    class: z.string().regex(XML_NAME, "A class is a name such as CUnit"),
    /** Its id; none for a class's default (<CDSPLowPassSimple default="1">). */
    id: z.string().min(1).optional(),
    parent: z.string().min(1).optional(),
    /** The entry's other attributes: default="1", and tokens its parent's ##tokens## take. */
    attributes: z
      .record(z.string().regex(XML_NAME), z.string())
      .refine((attributes) => !("id" in attributes) && !("parent" in attributes), "id and parent are the entry's own: give them as id and parent, not attributes")
      .optional(),
    /** The GameData file it goes in, when not its catalog's own (one a GameData.xml includes list names). */
    file: z
      .string()
      .refine((file) => file.startsWith(GAME_DATA_DIR) && file.toLowerCase().endsWith(".xml") && !file.includes("\\") && !file.split("/").includes(".."), `A GameData file is a .xml in ${GAME_DATA_DIR}, with forward slashes`)
      .optional(),
    /** The ##tokens## it declares for its children to fill in, in order, written before its fields. */
    tokens: z.array(TokenSchema).optional(),
    fields: FieldsSchema.default({}),
    /** The localized strings keyed to it, by strings file (entry-strings.ts): its name, tooltip, hotkey, the text its fields name … */
    strings: StringsSchema.optional(),
  })
  .strict()
  .refine((entry) => entry.id !== undefined || isClassDefault(entry), 'An entry has an id, unless it\'s its class\'s default (attributes: { "default": "1" })')
  .refine((entry) => entry.tokens === undefined || isClassDefault(entry), { message: 'Tokens are a template\'s, for its children: an entry with tokens is a template (attributes: { "default": "1" })', path: ["tokens"] })
  .superRefine((entry, context) => {
    const twice = tokenTwice(entry.tokens ?? []);
    if (twice !== undefined) context.addIssue({ code: "custom", message: `The token ${twice} is declared twice`, path: ["tokens"] });
  });

/** The id of a token declared more than once in `tokens`, if one is. */
function tokenTwice(tokens: readonly { readonly id: string }[]): string | undefined {
  const seen = new Set<string>();
  for (const { id } of tokens) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

export type GenericEntry = z.infer<typeof GenericEntrySchema>;

/** Whether `entry` is its class's default, the one entry that has no id. */
function isClassDefault(entry: { readonly attributes?: Readonly<Record<string, string>> | undefined }): boolean {
  return entry.attributes?.default === "1";
}

/** An entry's key, as a compile record and the Kept Report name it: `<Class>:<id>`, or the class alone for a class default. */
export const genericEntryKey = (entry: Pick<GenericEntry, "class" | "id">): string => catalogEntryKey(entry.class, entry.id);

export const GenericEntriesSchema = z.array(GenericEntrySchema);

/** The generic entries in `text`, a JSON source named `from`, or an error saying what's wrong with it. */
export function readGenericEntries(text: string, from: string): GenericEntry[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`The generic entries source ${from} isn't JSON: ${(error as Error).message}`, { cause: error });
  }
  const parsed = GenericEntriesSchema.safeParse(json);
  if (!parsed.success) throw new Error(`The generic entries source ${from} isn't a list of generic catalog entries: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(list)"}: ${issue.message}`).join("; ")}`);
  return parsed.data;
}

const TEXT = "$text";
const escape = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\r/g, "&#13;").replace(/\n/g, "&#10;").replace(/\t/g, "&#9;");
const escapeText = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isScalar = (value: FieldValue): value is string | number => typeof value === "string" || typeof value === "number";
const attribute = (name: string, value: string | number): string => ` ${name}="${escape(String(value))}"`;

const commentLine = (text: string | number, indent: string): string => `${indent}<!--${text}-->`;

/** The lines of field `name` holding `value`, at `indent`. */
function fieldLines(name: string, value: FieldValue, indent: string): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => (isCommentItem(item) ? [commentLine(item.$comment, indent)] : fieldLines(name, item, indent)));
  if (isScalar(value)) return [`${indent}<${name}${attribute("value", value)}/>`];
  return elementLines(name, "", value as FieldStruct, indent);
}

/** An element named `name` for structure `struct`, with `head` attributes before its own. */
function elementLines(name: string, head: string, struct: FieldStruct, indent: string): string[] {
  let attributes = head;
  const children: string[] = [];
  let text: string | undefined;
  for (const [key, value] of Object.entries(struct)) {
    if (key === TEXT) text = String(value);
    else if (isCommentKey(key)) children.push(commentLine(value as string, `${indent}    `));
    else if (isScalar(value)) attributes += attribute(key, value);
    else children.push(...fieldLines(key, value, `${indent}    `));
  }
  if (text !== undefined && children.length === 0) return [`${indent}<${name}${attributes}>${escapeText(text)}</${name}>`];
  if (text === undefined && children.length === 0) return [`${indent}<${name}${attributes}/>`];
  return [`${indent}<${name}${attributes}>${text === undefined ? "" : escapeText(text)}`, ...children, `${indent}</${name}>`];
}

/** `entry` as its catalog element, indented as an entry of a catalog file (four spaces), one line per field. */
export function entryXml(entry: GenericEntry): string {
  // A template that declares tokens says it's one first (<CSound default="1" id="…" parent="…">), as the Editor and Blizzard's catalogs write one.
  const defaultFirst = entry.tokens !== undefined && entry.tokens.length > 0 && isClassDefault(entry);
  const others = Object.entries(entry.attributes ?? {}).filter(([key]) => !(defaultFirst && key === "default"));
  const head = `${defaultFirst ? attribute("default", "1") : ""}${entry.id === undefined ? "" : attribute("id", entry.id)}${entry.parent === undefined ? "" : attribute("parent", entry.parent)}${others.map(([key, value]) => attribute(key, value)).join("")}`;
  const fields: FieldStruct = Object.fromEntries(Object.entries(entry.fields).map(([key, value]) => [key, isScalar(value) && !isCommentKey(key) ? { value } : value]));
  const lines = elementLines(entry.class, head, fields, "    ");
  const tokens = (entry.tokens ?? []).map((token) => `        <?token${TOKEN_ATTRIBUTES.filter((key) => token[key] !== undefined).map((key) => attribute(key, token[key]!)).join("")}?>`);
  if (tokens.length === 0) return lines.join("\n");
  // An entry with no fields is written open, so its tokens go inside it.
  const [open, ...rest] = lines.length === 1 ? [lines[0]!.replace(/\/>$/, ">"), `    </${entry.class}>`] : lines;
  return [open, ...tokens, ...rest].join("\n");
}

/** A value as written, as JSON: a number when it reads back the same, else the text. */
const scalarOf = (text: string): string | number => {
  const number = Number(text);
  return text.trim() !== "" && Number.isFinite(number) && String(number) === text ? number : text;
};

/** A field element as a field's value: its value when that's all it has, else a structure. */
function valueOf(node: XmlNode): string | number | FieldStruct {
  if (node.children.length === 0 && node.text.trim() === "" && node.attributes.length === 1 && node.attributes[0]![0] === "value") return scalarOf(node.attributes[0]![1]);
  return structOf(node);
}

/**
 * An element's children (fields and comments) as its members, after `head`: each field once, or
 * as an array when written more than once, in the order each name first comes. A comment goes
 * where it stands: between an array's items as an item, else as a $comment key before the field
 * it comes before, or at the end. A field written once is `single`'s.
 */
function members(owner: string, head: Record<string, FieldValue>, children: readonly XmlNode[], single: (node: XmlNode) => FieldValue): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = { ...head };
  const counts = new Map<string, number>();
  for (const child of children) if (child.name !== XML_COMMENT) counts.set(child.name, (counts.get(child.name) ?? 0) + 1);
  let comments = 0;
  const comment = (text: string): void => {
    comments += 1;
    out[comments === 1 ? COMMENT : `${COMMENT}${comments}`] = text;
  };
  let pending: string[] = [];
  for (const child of children) {
    if (child.name === XML_COMMENT) {
      pending.push(child.text);
      continue;
    }
    if (child.name in head) throw new Error(`${owner} has ${child.name} both as an attribute and as a field`);
    if (counts.get(child.name)! === 1) {
      pending.forEach(comment);
      out[child.name] = single(child);
      pending = [];
      continue;
    }
    const item = valueOf(child);
    if (isCommentItem(item)) throw new Error(`an ${child.name} written more than once holds only a comment, which a generic entry's array would read as a comment between its items`);
    if (!(child.name in out)) {
      pending.forEach(comment);
      out[child.name] = [item];
    } else {
      (out[child.name] as (string | number | FieldStruct)[]).push(...pending.map((text) => ({ [COMMENT]: text })), item);
    }
    pending = [];
  }
  pending.forEach(comment);
  return out;
}

/** A field element as a structure: its attributes, then its own fields (each once, or as an array) and comments. */
function structOf(node: XmlNode): FieldStruct {
  const head: Record<string, FieldValue> = {};
  for (const [key, value] of node.attributes) head[key] = scalarOf(value);
  const out = members(node.name, head, node.children, (child) => {
    const value = valueOf(child);
    return typeof value === "object" ? value : { value };
  });
  if (node.text.trim() !== "") {
    if (node.children.length > 0) throw new Error(`${node.name} has both text and ${node.children.every((child) => child.name === XML_COMMENT) ? "a comment" : "fields"}`);
    out[TEXT] = node.text.trim();
  }
  return out;
}

/**
 * The generic entry for a catalog element `xml` of `catalog`, or why it can't be one: written back
 * with entryXml, it must read the same as `xml` (canonicalXml), so a conversion changes nothing the
 * Editor reads.
 */
export function genericEntry(xml: string, catalog: string): GenericEntry | { readonly refused: string } {
  const [node, ...rest] = xmlTree(xml, { comments: true, tokens: true });
  if (!node || rest.length > 0) return { refused: "it isn't one element" };
  if (node.text.trim() !== "") return { refused: "it has text of its own" };
  const attributes = Object.fromEntries(node.attributes.filter(([key]) => key !== "id" && key !== "parent"));
  const id = node.attributes.find(([key]) => key === "id")?.[1];
  const parent = node.attributes.find(([key]) => key === "parent")?.[1];
  if (id === "") return { refused: "its id is empty" };
  if (id === undefined && !isClassDefault({ attributes })) return { refused: 'it has no id, and isn\'t its class\'s default (default="1")' };
  const declared = declarations(node, isClassDefault({ attributes }));
  if ("refused" in declared) return declared;
  const { tokens, children } = declared;
  let fields: Record<string, FieldValue>;
  try {
    fields = members(node.name, {}, children, valueOf);
  } catch (error) {
    return { refused: (error as Error).message };
  }
  const entry: GenericEntry = { catalog, class: node.name, ...(id === undefined ? {} : { id }), ...(parent === undefined ? {} : { parent }), ...(Object.keys(attributes).length ? { attributes } : {}), ...(tokens.length ? { tokens } : {}), fields };
  const written = entryXml(entry);
  if (canonicalXml(written) !== canonicalXml(xml)) return { refused: "written back as a generic entry, it wouldn't read the same" };
  if (commentsOf(written) !== commentsOf(xml)) return { refused: "written back as a generic entry, a comment in it would move" };
  return entry;
}

type Token = z.infer<typeof TokenSchema>;

/**
 * The tokens an entry element declares, and its other children, or why a generic entry can't hold
 * them: it writes them first, so they must come before every field and comment, and only a template (`template`) has them.
 */
function declarations(node: XmlNode, template: boolean): { readonly tokens: Token[]; readonly children: XmlNode[] } | { readonly refused: string } {
  const leading = node.children.findIndex((child) => child.name !== XML_TOKEN);
  const declared = leading < 0 ? node.children : node.children.slice(0, leading);
  const children = node.children.slice(declared.length);
  if (children.some(function nested(child): boolean {
    return child.name === XML_TOKEN || child.children.some(nested);
  }))
    return { refused: "it declares a token after a field or comment, or inside a field: a generic entry writes its tokens first" };
  const tokens: Token[] = [];
  for (const token of declared) {
    const parsed = TokenSchema.safeParse(Object.fromEntries(token.attributes));
    if (!parsed.success || token.attributes.length !== new Set(token.attributes.map(([key]) => key)).size) return { refused: `its token declaration <?token${token.attributes.map(([key, value]) => attribute(key, value)).join("")}?> isn't an id with a type and value at most` };
    tokens.push(parsed.data);
  }
  if (tokens.length > 0 && !template) return { refused: 'it declares tokens and isn\'t a template (default="1")' };
  const twice = tokenTwice(tokens);
  if (twice !== undefined) return { refused: `it declares the token ${twice} twice` };
  return { tokens, children };
}

/**
 * The comments of `xml`, in order, each with where it stands: the element it's in and the fields
 * either side of it. That's what canonicalXml leaves out, and what a field written more than once
 * moves when it's written as one run, for checking a conversion keeps each comment in place.
 */
function commentsOf(xml: string): string {
  const out: string[][] = [];
  const walk = (nodes: readonly XmlNode[], path: string): void =>
    nodes.forEach((node, index) => {
      if (node.name !== XML_COMMENT) return walk(node.children, `${path}/${node.name}`);
      const field = (step: number): string => {
        for (let at = index + step; at >= 0 && at < nodes.length; at += step) if (nodes[at]!.name !== XML_COMMENT) return nodes[at]!.name;
        return "";
      };
      out.push([path, field(-1), node.text, field(1)]);
    });
  walk(xmlTree(xml, { comments: true }), "");
  return JSON.stringify(out);
}
