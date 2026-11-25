// Retiming in the game, back into the spec (#77). The map saves every strike, land and length change
// to a bank named after the spec, with what the build gave each; `testbed.js <spec> --apply` reads that
// bank and writes the changes into the spec in place, keeping its comments and layout.
//
// A value is written only where the spec still holds what the build gave it: one changed in the spec
// since is skipped and said. Applied values leave the bank, and the bank goes once it's empty.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { findNodeAtLocation, type Node, parseTree } from "jsonc-parser";

import { readSpec } from "./spec.ts";

/** A spec's tuning bank: `AnimTune` and its name in words (`stock-units` → `AnimTuneStockUnits`). */
export function tuneBankName(specName: string): string {
  const words = specName.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return `AnimTune${words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("")}`;
}

/** Each unit's animations' sections in the tuning bank, by place: `<key>_<anim>` in letters, digits and _, made unique. */
export function sectionNames(units: readonly { readonly key: string; readonly animations: Record<string, unknown> }[]): string[][] {
  const taken = new Set<string>();
  return units.map((unit) =>
    Object.keys(unit.animations).map((anim) => {
      const base = `${unit.key}_${anim}`.replace(/[^A-Za-z0-9_]/g, "_");
      let name = base;
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}_${i}`;
      taken.add(name.toLowerCase());
      return name;
    }),
  );
}

const FIELDS = ["strike", "land", "length"] as const;
type Field = (typeof FIELDS)[number];

/** One animation's section of the bank: its times now, and what the build gave them. */
export type Tuning = {
  readonly section: string;
  readonly unit: string;
  readonly anim: string;
  readonly now: Readonly<Record<Field, number>>;
  readonly built: Readonly<Record<Field, number>>;
};

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
    const unit = values.get("unit");
    const anim = values.get("anim");
    const now = Object.fromEntries(FIELDS.map((f) => [f, num(f)]));
    const built = Object.fromEntries(FIELDS.map((f) => [f, num(`${f}Built`)]));
    if (unit === undefined || anim === undefined || FIELDS.some((f) => now[f] === undefined || built[f] === undefined)) continue;
    out.push({ section: unescape(section[1]!), unit, anim, now: now as Record<Field, number>, built: built as Record<Field, number> });
  }
  return out;
}

/** Two times the same to the bank's precision (a fixed's 1/4096 s, rounded to 0.001 when tuned). */
const EPS = 0.0005;
const same = (a: number, b: number): boolean => Math.abs(a - b) < EPS;
const round = (n: number): number => Math.round(n * 1000) / 1000;
/** A time as the lines show it: two places, three when it needs them. */
const show = (n: number): string => {
  const r = round(n);
  return Math.abs(r * 100 - Math.round(r * 100)) < 1e-6 ? r.toFixed(2) : r.toFixed(3);
};

export type ApplyResult = {
  /** The spec's new text (the same when nothing was written). */
  readonly text: string;
  /** What was written and what was skipped, a line each. */
  readonly lines: string[];
  /** Per section, the fields that are done with (written, or never changed): they leave the bank. */
  readonly done: Map<string, Field[]>;
};

/**
 * Writes the bank's tunings into the spec's text. A field the game changed is written only where the
 * spec still holds what the build gave it; a land is written when the spec's own (or the strike it
 * follows) would otherwise differ from the tuned one, so a land left out stays out while it follows.
 */
export function applyTunings(text: string, tunings: readonly Tuning[]): ApplyResult {
  const read = readSpec(text);
  if (!read.spec) throw new Error(`The spec doesn't read: ${read.problems.join("; ")}`);
  const spec = read.spec;
  const lines: string[] = [];
  const done = new Map<string, Field[]>();
  let out = text;
  for (const t of tunings) {
    const who = `${t.unit} / ${t.anim}`;
    const ui = spec.units.findIndex((u) => u.key === t.unit);
    const anim = ui >= 0 ? spec.units[ui]!.animations[t.anim] : undefined;
    const changed = FIELDS.filter((f) => !same(t.now[f], t.built[f]));
    if (!anim) {
      if (changed.length) lines.push(`${who}: skipped, the spec has no ${ui < 0 ? `unit "${t.unit}"` : `animation "${t.anim}" on ${t.unit}`} now`);
      else done.set(t.section, [...FIELDS]);
      continue;
    }
    const at = ["units", ui, "animations", t.anim];
    const fieldsDone: Field[] = [];
    const skip = (f: Field, has: number): void => {
      lines.push(`${who}: ${f} skipped, the spec has ${show(has)} now; the game tuned ${show(t.built[f])} → ${show(t.now[f])}`);
    };
    const write = (f: Field, from: number): void => {
      out = setNumber(out, [...at, f], round(t.now[f]));
      lines.push(`${who}: ${f} ${show(from)} → ${show(t.now[f])}`);
      fieldsDone.push(f);
    };

    // Strike: the schema's default is 0.
    let strike = anim.strike;
    if (!changed.includes("strike")) fieldsDone.push("strike");
    else if (!same(anim.strike, t.built.strike)) skip("strike", anim.strike);
    else {
      write("strike", anim.strike);
      strike = t.now.strike;
    }

    // Land: left out, it is the strike.
    const landNow = anim.land ?? anim.strike;
    const landAfter = anim.land ?? strike;
    if (same(landAfter, t.now.land)) fieldsDone.push("land");
    else if (changed.includes("land") && !same(landNow, t.built.land)) skip("land", landNow);
    else write("land", landAfter);

    // Length: left out, the build read it from the model (or made one up), so the spec holds the built one.
    if (!changed.includes("length")) fieldsDone.push("length");
    else if (anim.length !== undefined && !same(anim.length, t.built.length)) skip("length", anim.length);
    else write("length", anim.length ?? t.built.length);

    done.set(t.section, fieldsDone);
  }
  return { text: out, lines, done };
}

/** Sets the number at `at` in a JSON-with-comments text, replacing it where it is or adding the key last in its object, in the object's own layout. */
export function setNumber(text: string, at: (string | number)[], value: number): string {
  const tree = parseTree(text, [], { allowTrailingComma: false, disallowComments: false });
  if (!tree) throw new Error("The spec doesn't parse");
  const literal = String(value);
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

/** The bank without what was applied: a section all done goes, otherwise its done fields (and what they were built as). Undefined when no section is left. */
export function withoutApplied(xml: string, done: ReadonlyMap<string, readonly Field[]>): string | undefined {
  let left = 0;
  const out = xml.replace(/([ \t]*)<Section\s+name="([^"]*)"\s*>([\s\S]*?)<\/Section>[ \t]*\r?\n?/g, (whole, _indent: string, name: string, body: string) => {
    const fields = done.get(unescape(name));
    if (!fields) {
      left++;
      return whole;
    }
    if (FIELDS.every((f) => fields.includes(f))) return "";
    left++;
    const drop = new Set(fields.flatMap((f) => [f, `${f}Built`]));
    const kept = body.replace(/[ \t]*<Key\s+name="([^"]*)"\s*>[\s\S]*?<\/Key>[ \t]*\r?\n?/g, (key, keyName: string) => (drop.has(keyName) ? "" : key));
    return whole.replace(body, () => kept);
  });
  return left ? out : undefined;
}

/** The tuning banks named `bank` anywhere under the Banks folder (it holds a folder per account and handle). */
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
