// The game's data schema (data/catalog-schema.json, docs/reference/catalog-schema.md): its
// catalogs, the classes in each, each class's fields, and the shape of each field (its attributes
// with the kind of value each holds, and its nested fields), read from the install's own catalogs
// by scripts/build-catalog-schema.mjs. A generic catalog entry is checked against it before a mod
// compile writes anything: its class must be one of its catalog's, each field one its class has,
// and each value of the kind the field holds.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type FieldStruct, type FieldValue, isCommentItem, isCommentKey } from "../domain/catalog-fields.js";
import { GAME_DATA_DIR } from "../domain/mod-blueprint.js";
import { type GenericEntry, genericEntryKey } from "./generic-entries.js";

/** A field's shape: its attributes, each with its kind of value, and its nested fields; any when only its name is known. */
export type FieldShape = { readonly attributes?: Readonly<Record<string, ValueKind>>; readonly fields?: Readonly<Record<string, FieldShape>>; readonly text?: ValueKind; readonly any?: true };

/** number, asset (a file path), link:<Catalog> (an entry id), string (anything else), any (seen only empty or as a token). */
export type ValueKind = "number" | "asset" | "string" | "any" | `link:${string}`;

export type CatalogSchema = {
  readonly build: string;
  readonly catalogs: Readonly<Record<string, { readonly file: string; readonly classes: readonly string[]; readonly fields: Readonly<Record<string, FieldShape>> }>>;
  readonly classes: Readonly<Record<string, { readonly catalog: string; readonly fields: readonly string[] }>>;
};

const SCHEMA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/catalog-schema.json");
let loaded: CatalogSchema | undefined;

/** The game's data schema. */
export const catalogSchema = (): CatalogSchema => (loaded ??= JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as CatalogSchema);

/** The catalog whose own file is `name` (`WaterData.xml` → Water, in any case), if any: the files the game loads from GameData by name. */
export function catalogOfFile(name: string, schema = catalogSchema()): string | undefined {
  const lower = name.toLowerCase();
  return Object.entries(schema.catalogs).find(([, catalog]) => catalog.file.toLowerCase() === lower)?.[0];
}

/** The GameData file `entry` goes in: the one it names, else its catalog's own; undefined for a catalog the game hasn't. */
export function entryFile(entry: Pick<GenericEntry, "catalog" | "file">, schema = catalogSchema()): string | undefined {
  const own = schema.catalogs[entry.catalog]?.file;
  return entry.file ?? (own === undefined ? undefined : `${GAME_DATA_DIR}${own}`);
}

/** A number as the game reads one: an integer or a decimal, with an exponent or not. Shared with scripts/build-catalog-schema.mjs. */
export const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
/** A value standing for another until the game reads it: a ##token##, a $const, or empty. Shared with scripts/build-catalog-schema.mjs. */
export const token = (value: string): boolean => value === "" || value.includes("##") || value.startsWith("$") || value.includes("{");

/** Why `value` isn't of kind `kind`, or undefined when it is. */
function wrongKind(kind: ValueKind, value: string | number): string | undefined {
  const text = String(value);
  if (token(text)) return undefined;
  if (kind === "number" && !NUMBER.test(text)) return `is a number, not ${JSON.stringify(value)}`;
  if (kind.startsWith("link:") && /[\s\\/]/.test(text)) return `is a link to a ${kind.slice(5)} entry, by its id, not ${JSON.stringify(value)}`;
  return undefined;
}

const nearest = (name: string, known: readonly string[]): string => {
  const match = known.find((other) => other.toLowerCase() === name.toLowerCase());
  return match ? ` (did you mean ${match}?)` : "";
};

/** Each way `entry` doesn't fit the schema, as `<Class>:<id>: …`; empty when it fits. */
export function schemaProblems(entry: GenericEntry, schema = catalogSchema()): string[] {
  const name = genericEntryKey(entry);
  const catalog = schema.catalogs[entry.catalog];
  if (!catalog) return [`${name}: ${entry.catalog} isn't one of the game's catalogs${nearest(entry.catalog, Object.keys(schema.catalogs))}`];
  const cls = schema.classes[entry.class];
  if (!cls) return [`${name}: ${entry.class} isn't a class the game has${nearest(entry.class, Object.keys(schema.classes))}`];
  if (cls.catalog !== entry.catalog) return [`${name}: ${entry.class} is a class of the ${cls.catalog} catalog, not ${entry.catalog}`];
  const problems: string[] = [];
  for (const [field, value] of Object.entries(entry.fields)) {
    if (isCommentKey(field)) {
      problems.push(...commentProblems(`${name}: ${field}`, value));
      continue;
    }
    if (!cls.fields.includes(field)) {
      problems.push(`${name}: ${entry.class} has no field ${field}${nearest(field, cls.fields)}`);
      continue;
    }
    problems.push(...valueProblems(`${name}: ${field}`, value, catalog.fields[field] ?? { any: true }));
  }
  return problems;
}

/** The problems of `value` at `where` against `shape`; a field given as a value is its value attribute. */
function valueProblems(where: string, value: FieldValue, shape: FieldShape): string[] {
  if (shape.any) return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => (isCommentItem(item) ? commentProblems(`${where}[${index}]`, item.$comment) : valueProblems(`${where}[${index}]`, item, shape)));
  if (typeof value === "string" || typeof value === "number") {
    const kind = shape.attributes?.value ?? shape.fields?.value?.attributes?.value;
    if (kind === undefined) return [`${where} is a structure (${describe(shape)}), not a value: give it as an object`];
    const wrong = wrongKind(kind, value);
    return wrong ? [`${where} ${wrong}`] : [];
  }
  const problems: string[] = [];
  for (const [key, member] of Object.entries(value as FieldStruct)) {
    if (key === "$text") {
      if (shape.text === undefined) problems.push(`${where} has no text`);
      continue;
    }
    if (isCommentKey(key)) {
      problems.push(...commentProblems(`${where}.${key}`, member));
      continue;
    }
    // A structure's value is written as an attribute or as a field of its own (<Height value="…"/>), either way.
    const asAttribute = shape.attributes?.[key] ?? shape.fields?.[key]?.attributes?.value ?? (shape.fields?.[key]?.any ? "any" : undefined) ?? ARRAY_ATTRIBUTES[key];
    if (typeof member === "string" || typeof member === "number") {
      if (asAttribute === undefined) {
        problems.push(`${where} has no field ${key}${nearest(key, known(shape))}`);
        continue;
      }
      const wrong = wrongKind(asAttribute, member);
      if (wrong) problems.push(`${key === "value" ? where : `${where}.${key}`} ${wrong}`);
      continue;
    }
    const nested = shape.fields?.[key] ?? (asAttribute === undefined ? undefined : { attributes: { value: asAttribute } });
    if (!nested) {
      problems.push(`${where} has no field ${key}${nearest(key, known(shape))}`);
      continue;
    }
    problems.push(...valueProblems(`${where}.${key}`, member, nested));
  }
  return problems;
}

/** The problems of a comment's text `value` at `where`: one XML lets a comment hold, with no -- and no - at its end. */
function commentProblems(where: string, value: FieldValue): string[] {
  if (typeof value !== "string") return [`${where} is a comment's text, not ${JSON.stringify(value)}`];
  if (value.includes("-->")) return [`${where} holds -->, which would end the comment early`];
  if (value.includes("--") || value.endsWith("-")) return [`${where} holds --, or ends in -, which a comment can't`];
  return [];
}

/** What any field element may carry: its place in an array, and that it removes the parent's. */
const ARRAY_ATTRIBUTES: Readonly<Record<string, ValueKind>> = { index: "string", removed: "number" };

const known = (shape: FieldShape): string[] => [...Object.keys(shape.attributes ?? {}), ...Object.keys(shape.fields ?? {})];

const describe = (shape: FieldShape): string => known(shape).slice(0, 6).join(", ") || "nothing";

/** The generic entries failed the schema: each problem, naming its entry. */
export class CatalogSchemaError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super([`${problems.length} generic catalog entr${problems.length === 1 ? "y problem" : "y problems"} against the game's data schema, so nothing is compiled:`, ...problems.map((problem) => `  ${problem}`)].join("\n"));
    this.problems = problems;
    this.name = "CatalogSchemaError";
  }
}
