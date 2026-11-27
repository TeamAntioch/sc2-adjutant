// Tuning in the game, back into the spec (#138). The map saves every element's changed start, stop and
// mute to a bank named after the spec, with what the build gave each; `testbed.js <spec> --apply`
// reads that bank and writes the changes into the spec in place, keeping its comments and layout.
//
// An element is matched by its unit, moment, variation, kind, id and occurrence (which of the
// variation's elements of that kind and id it is), so reordering the spec doesn't mismatch. A value is
// written only where the spec still holds what the build gave it: one changed in the spec since is
// skipped and said. Applied values leave the bank, and the bank goes once it's empty.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { findNodeAtLocation, type Node, parseTree } from "jsonc-parser";

import { ELEMENT_KINDS, readSpec, type SpecElement } from "./spec.ts";

/** A spec's tuning bank: `AnimTune` and its name in words (`stock-units` → `AnimTuneStockUnits`). */
export function tuneBankName(specName: string): string {
  const words = specName.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return `AnimTune${words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("")}`;
}

/** Which element of the spec a tuning is: its unit's key, moment, variation (from 1), kind, id and occurrence (from 1). */
export type ElementKey = {
  readonly unit: string;
  readonly moment: string;
  readonly variation: number;
  readonly kind: string;
  readonly id: string;
  readonly occurrence: number;
};

/** An element's kind and id as the map names them: the kind's key, and its value (empty for a kill). */
export function kindAndId(el: SpecElement): { kind: string; id: string } | undefined {
  const kinds = ELEMENT_KINDS.filter((k) => el[k] !== undefined);
  if (kinds.length !== 1) return undefined;
  const kind = kinds[0]!;
  return { kind, id: kind === "kill" ? "" : String(el[kind]).trim() };
}

/** 32-bit FNV-1a, as hex. */
const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

/** Each element's section in the bank: `e` and a hash of its key, made unique. Short and plain, the same for the same key in any build. */
export function sectionNames(keys: readonly ElementKey[]): string[] {
  const taken = new Set<string>();
  return keys.map((k) => {
    const base = `e${fnv([k.unit, k.moment, k.variation, k.kind, k.id, k.occurrence].join("\u0000"))}`;
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
    taken.add(name);
    return name;
  });
}

/** What the game tunes of an element. A stop of -1 is none. */
export type Tuned = { readonly at: number; readonly stop: number; readonly muted: boolean };
const FIELDS = ["at", "stop", "muted"] as const;
type Field = (typeof FIELDS)[number];

/** One element's section of the bank: its values now, and what the build gave them. */
export type Tuning = { readonly section: string; readonly key: ElementKey; readonly now: Tuned; readonly built: Tuned };

const unescape = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The bank's tunings. A section without all its keys (not the map's) is left out. */
export function readTuneBank(xml: string): Tuning[] {
  const out: Tuning[] = [];
  for (const section of xml.matchAll(/<Section\s+name="([^"]*)"\s*>([\s\S]*?)<\/Section>/g)) {
    const values = new Map<string, string>();
    for (const key of section[2]!.matchAll(/<Key\s+name="([^"]*)"\s*>\s*<Value\s+\w+="([^"]*)"\s*\/>/g)) values.set(key[1]!, unescape(key[2]!));
    const num = (k: string): number | undefined => {
      const v = values.get(k);
      const n = v === undefined ? Number.NaN : Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const str = ["unit", "moment", "kind", "id"].map((k) => values.get(k));
    const ints = ["variation", "occurrence"].map(num);
    const nums = ["at", "atBuilt", "stop", "stopBuilt", "muted", "mutedBuilt"].map(num);
    if (str.some((s) => s === undefined) || ints.some((n) => n === undefined) || nums.some((n) => n === undefined)) continue;
    const [unit, moment, kind, id] = str as string[];
    const [variation, occurrence] = ints as number[];
    const [at, atBuilt, stop, stopBuilt, muted, mutedBuilt] = nums as number[];
    out.push({
      section: unescape(section[1]!),
      key: { unit: unit!, moment: moment!, variation: variation!, kind: kind!, id: id!, occurrence: occurrence! },
      now: { at: at!, stop: stop! < 0 ? -1 : stop!, muted: muted === 1 },
      built: { at: atBuilt!, stop: stopBuilt! < 0 ? -1 : stopBuilt!, muted: mutedBuilt === 1 },
    });
  }
  return out;
}

/** Two times the same to the bank's precision (a fixed's 1/4096 s, rounded to 0.001 when tuned). */
const EPS = 0.0005;
const same = (a: number, b: number): boolean => Math.abs(a - b) < EPS;
const round = (n: number): number => Math.round(n * 1000) / 1000;
/** A time as the lines show it: two places, three when it needs them; a stop of -1 is none. */
const show = (n: number): string => {
  if (n < 0) return "none";
  const r = round(n);
  return Math.abs(r * 100 - Math.round(r * 100)) < 1e-6 ? r.toFixed(2) : r.toFixed(3);
};
const showField = (f: Field, v: number | boolean): string => (f === "muted" ? (v ? "muted" : "playing") : show(v as number));

export type ApplyResult = {
  /** The spec's new text (the same when nothing was written). */
  readonly text: string;
  /** What was written and what was skipped, a line each. */
  readonly lines: string[];
  /** Per section, the fields that are done with (written, or never changed): they leave the bank. */
  readonly done: Map<string, Field[]>;
};

/** The element a key names, and where it is in the spec's JSON; or why there is none. */
function findElement(spec: NonNullable<ReturnType<typeof readSpec>["spec"]>, key: ElementKey): { at: (string | number)[]; el: SpecElement } | string {
  const ui = spec.units.findIndex((u) => u.key === key.unit);
  if (ui < 0) return `the spec has no unit "${key.unit}" now`;
  const moment = spec.units[ui]!.moments[key.moment];
  if (!moment) return `${key.unit} has no moment "${key.moment}" now`;
  const variation = moment.variations[key.variation - 1];
  if (!variation) return `${key.unit} ${key.moment} has no variation ${key.variation} now`;
  let seen = 0;
  for (const [ei, el] of variation.elements.entries()) {
    const k = kindAndId(el);
    if (k && k.kind === key.kind && k.id === key.id && ++seen === key.occurrence) {
      return { at: ["units", ui, "moments", key.moment, "variations", key.variation - 1, "elements", ei], el };
    }
  }
  return `${key.unit} ${key.moment} ${key.variation} has no ${key.occurrence > 1 ? `${ordinal(key.occurrence)} ` : ""}${key.kind}${key.id ? ` ${key.id}` : ""} now`;
}

const ordinal = (n: number): string => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/**
 * Writes the bank's tunings into the spec's text. A field the game changed is written only where the
 * spec still holds what the build gave it. A stop of none and muted false are written by taking the key out.
 */
export function applyTunings(text: string, tunings: readonly Tuning[]): ApplyResult {
  const read = readSpec(text);
  if (!read.spec) throw new Error(`The spec doesn't read: ${read.problems.join("; ")}`);
  const spec = read.spec;
  const lines: string[] = [];
  const done = new Map<string, Field[]>();
  let out = text;
  for (const t of tunings) {
    const k = t.key;
    const who = `${k.unit} ${k.moment} ${k.variation}, ${k.kind}${k.id ? ` ${k.id}` : ""}${k.occurrence > 1 ? ` (${ordinal(k.occurrence)})` : ""}`;
    const changed = FIELDS.filter((f) => (f === "muted" ? t.now.muted !== t.built.muted : !same(t.now[f], t.built[f])));
    const found = findElement(spec, k);
    if (typeof found === "string") {
      if (changed.length) lines.push(`${who}: skipped, ${found}`);
      else done.set(t.section, [...FIELDS]);
      continue;
    }
    const has: Tuned = { at: typeof found.el.at === "number" ? found.el.at : Number.NaN, stop: found.el.stop ?? -1, muted: found.el.muted === true };
    const fieldsDone: Field[] = [];
    for (const f of FIELDS) {
      if (!changed.includes(f)) {
        fieldsDone.push(f);
        continue;
      }
      const specSame = f === "muted" ? has.muted === t.built.muted : same(has[f], t.built[f]);
      if (!specSame) {
        lines.push(`${who}: ${f} skipped, the spec has ${showField(f, has[f])} now; the game tuned ${showField(f, t.built[f])} → ${showField(f, t.now[f])}`);
        continue;
      }
      const at = [...found.at, f];
      if (f === "muted") out = t.now.muted ? setValue(out, at, "true") : removeKey(out, at);
      else if (f === "stop" && t.now.stop < 0) out = removeKey(out, at);
      else out = setValue(out, at, String(round(t.now[f])));
      lines.push(`${who}: ${f} ${showField(f, has[f])} → ${showField(f, f === "muted" ? t.now.muted : round(t.now[f]))}`);
      fieldsDone.push(f);
    }
    done.set(t.section, fieldsDone);
  }
  return { text: out, lines, done };
}

const parse = (text: string): Node => {
  const tree = parseTree(text, [], { allowTrailingComma: false, disallowComments: false });
  if (!tree) throw new Error("The spec doesn't parse");
  return tree;
};

/** Sets the value at `at` in a JSON-with-comments text to `literal`, replacing it where it is or adding the key last in its object, in the object's own layout. */
export function setValue(text: string, at: (string | number)[], literal: string): string {
  const tree = parse(text);
  const existing = findNodeAtLocation(tree, at);
  if (existing) return text.slice(0, existing.offset) + literal + text.slice(existing.offset + existing.length);
  const object: Node | undefined = findNodeAtLocation(tree, at.slice(0, -1));
  if (!object || object.type !== "object") throw new Error(`No object at ${at.slice(0, -1).join(".")}`);
  const key = JSON.stringify(at[at.length - 1]);
  const props = object.children ?? [];
  const last = props[props.length - 1];
  if (!last) return `${text.slice(0, object.offset + 1)} ${key}: ${literal} ${text.slice(object.offset + 1)}`;
  const end = last.offset + last.length;
  const eol = text.indexOf("\n", end) < 0 ? text.length : text.indexOf("\n", end);
  // On one line with the rest of the object, or the line goes on past the brace: add it on the same line.
  const multiline = text.slice(object.offset, object.offset + object.length).includes("\n");
  if (!multiline || !/^\s*(\/\/.*)?$/.test(text.slice(end, eol).replace(/\r$/, ""))) return `${text.slice(0, end)}, ${key}: ${literal}${text.slice(end)}`;
  const lineStart = text.lastIndexOf("\n", last.offset) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))![0];
  const cr = text[eol - 1] === "\r" ? "\r" : "";
  const lineEnd = cr ? eol - 1 : eol;
  return `${text.slice(0, end)},${text.slice(end, lineEnd)}${cr}\n${indent}${key}: ${literal}${text.slice(lineEnd)}`;
}

/** Takes the key at `at` out of its object, with its comma; the same text when it isn't there. */
export function removeKey(text: string, at: (string | number)[]): string {
  const tree = parse(text);
  const value = findNodeAtLocation(tree, at);
  const prop = value?.parent;
  const object = prop?.parent;
  if (!prop || prop.type !== "property" || !object) return text;
  const props = object.children ?? [];
  const i = props.indexOf(prop);
  const next = props[i + 1];
  if (next) return text.slice(0, prop.offset) + text.slice(next.offset);
  const before = props[i - 1];
  if (before) return text.slice(0, before.offset + before.length) + text.slice(prop.offset + prop.length);
  return text.slice(0, object.offset + 1) + text.slice(prop.offset + prop.length).replace(/^\s*/, "");
}

/**
 * The bank without what was applied: a section all done goes; in one partly done, each done field's
 * built value becomes its value, so it reads as unchanged while the rest wait. Undefined when no section is left.
 */
export function withoutApplied(xml: string, done: ReadonlyMap<string, readonly Field[]>): string | undefined {
  let left = 0;
  const keyRe = /<Key\s+name="([^"]*)"\s*>(\s*<Value\s+\w+="[^"]*"\s*\/>\s*)<\/Key>/g;
  const out = xml.replace(/([ \t]*)<Section\s+name="([^"]*)"\s*>([\s\S]*?)<\/Section>[ \t]*\r?\n?/g, (whole, _indent: string, name: string, body: string) => {
    const fields = done.get(unescape(name));
    if (!fields) {
      left++;
      return whole;
    }
    if (FIELDS.every((f) => fields.includes(f))) return "";
    left++;
    const values = new Map([...body.matchAll(keyRe)].map((m) => [m[1]!, m[2]!]));
    const kept = body.replace(keyRe, (key, keyName: string) => {
      const field = fields.find((f) => `${f}Built` === keyName);
      const now = field && values.get(field);
      return now ? `<Key name="${keyName}">${now}</Key>` : key;
    });
    return whole.replace(body, () => kept);
  });
  return left ? out : undefined;
}

/** The tuning banks named `bank` anywhere under the Banks folder (straight in it on a Mac; a folder per account and handle elsewhere). */
export async function findTuneBanks(banksDir: string, bank: string): Promise<string[]> {
  const want = `${bank}.sc2bank`.toLowerCase();
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && entry.name.toLowerCase() === want) found.push(child);
    }
  };
  if (existsSync(banksDir)) await walk(banksDir);
  return found.sort();
}
