// A census of the node and element kinds in a folder of Cutscene Editor files, set against the kinds our
// own code names (issue #750, part of #735). The files say what the Editor can put in a cutscene; our
// source says what the compile writes, reads or checks. A kind in the files that our source never names
// is one a cutscene can hold and our tooling doesn't know. Nothing here reads Blizzard's manual: the
// census is of the files themselves, which are the format's own evidence.
//
// "Named" is a text match and only a rough sign. A kind counts when it stands alone as a string literal
// in code (comments are dropped first, and a kind inside a longer message doesn't count). An attribute
// is looked for as a bare word in code, which is unreliable for common words (`Name`, `Time`, `Index`):
// those are set aside as ambiguous instead of judged.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { readCutscene, type CutsceneNode } from "./read-cutscene.js";

/** A source file of ours: a name to show (its path under the searched folder, without `.ts`) and its text. */
export type SourceFile = { readonly name: string; readonly text: string };

/** Attribute names common enough in any code that a match says nothing. */
export const AMBIGUOUS_ATTRIBUTES: ReadonlySet<string> = new Set(
  ["name", "time", "index", "value", "type", "id", "model", "color", "length", "start", "end", "text", "count", "mode", "state", "scale", "position", "rotation", "speed", "offset", "duration", "target", "source", "file", "path", "link", "label", "enabled", "visible", "priority", "volume", "intensity", "radius", "distance"].map((word) => word.toLowerCase()),
);

export type KindCensus = {
  readonly kind: string;
  /** Files holding at least one. */
  readonly files: number;
  /** Occurrences over all files. */
  readonly total: number;
  /** The attribute names it carries in any file, sorted. */
  readonly attributes: readonly string[];
  /** Our source files that name the kind as a string literal. */
  readonly namedIn: readonly string[];
  /** Whether a writer file (the compile's output side) is among them. */
  readonly written: boolean;
  /** Of `attributes`, those no source file mentions as a word, among the unambiguous names. Empty when the kind isn't named. */
  readonly attributesNotNamed: readonly string[];
  /** Of `attributes`, those too common as words to judge. */
  readonly attributesAmbiguous: readonly string[];
};

export type Census = { readonly files: number; readonly unreadable: readonly string[]; readonly kinds: readonly KindCensus[] };

export type CensusOptions = { /** Which source files are the writers: by default `write-shot-cutscene`, the file that writes a cutscene's nodes. */ readonly isWriter?: (name: string) => boolean };

const defaultIsWriter = (name: string): boolean => /(^|\/)write-shot-cutscene$/.test(name);

/** Every `.SC2Cutscene` file under `root`, recursively (links are followed). */
export function cutsceneFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.SC2Cutscene$/i.test(name)) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/** Every `.ts` file under `dir`, named by its path under `dir`, prefixed by `label` when given. */
export function sourceFiles(dir: string, label = ""): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts")) out.push({ name: path.posix.join(label, path.relative(dir, full).split(path.sep).join("/")).replace(/\.ts$/, ""), text: readFileSync(full, "utf8") });
    }
  };
  walk(dir);
  return out;
}

/** Source text without comments (approximately: a `//` inside a string literal loses the rest of its line). */
export function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Counts the kinds in the given files' XML text, against our `sources`. A file that won't parse is listed, not counted. */
export function tagCensus(files: readonly { readonly name: string; readonly xml: string }[], sources: readonly SourceFile[], options: CensusOptions = {}): Census {
  const isWriter = options.isWriter ?? defaultIsWriter;
  const code = sources.map((source) => ({ name: source.name, text: withoutComments(source.text) }));
  const files_ = new Map<string, Set<string>>();
  const totals = new Map<string, number>();
  const attributes = new Map<string, Set<string>>();
  const unreadable: string[] = [];
  for (const file of files) {
    let root: CutsceneNode;
    try {
      root = readCutscene(file.xml);
    } catch {
      unreadable.push(file.name);
      continue;
    }
    const walk = (node: CutsceneNode): void => {
      if (/^CCutscene/.test(node.tag)) {
        (files_.get(node.tag) ?? files_.set(node.tag, new Set()).get(node.tag)!).add(file.name);
        totals.set(node.tag, (totals.get(node.tag) ?? 0) + 1);
        const names = attributes.get(node.tag) ?? attributes.set(node.tag, new Set()).get(node.tag)!;
        for (const name of Object.keys(node.attrs)) names.add(name);
      }
      for (const child of node.children) walk(child);
    };
    walk(root);
  }
  const literal = (kind: string): RegExp => new RegExp(`(["'\`])${escape(kind)}\\1`);
  const word = (attr: string): RegExp => new RegExp(`(^|[^A-Za-z0-9_])${escape(attr)}([^A-Za-z0-9_]|$)`);
  const kinds = [...totals.keys()]
    .sort((a, b) => files_.get(b)!.size - files_.get(a)!.size || a.localeCompare(b))
    .map((kind): KindCensus => {
      const attrs = [...attributes.get(kind)!].sort();
      const pattern = literal(kind);
      const namedIn = code.filter((source) => pattern.test(source.text)).map((source) => source.name).sort();
      const ambiguous = attrs.filter((attr) => AMBIGUOUS_ATTRIBUTES.has(attr.toLowerCase()));
      const judged = attrs.filter((attr) => !ambiguous.includes(attr));
      return {
        kind,
        files: files_.get(kind)!.size,
        total: totals.get(kind)!,
        attributes: attrs,
        namedIn,
        written: namedIn.some(isWriter),
        attributesNotNamed: namedIn.length ? judged.filter((attr) => !code.some((source) => word(attr).test(source.text))) : [],
        attributesAmbiguous: ambiguous,
      };
    });
  return { files: files.length - unreadable.length, unreadable, kinds };
}

/** How a kind stands: written by a writer file, named only elsewhere (reads, imports, checks), or not named. */
export const standing = (kind: KindCensus): "writes" | "other code only" | "not named" => (kind.written ? "writes" : kind.namedIn.length ? "other code only" : "not named");

/** The census as a Markdown table, with the counts above it. */
export function formatCensus(census: Census): string {
  const count = (what: string): number => census.kinds.filter((kind) => standing(kind) === what).length;
  const lines = [
    `${census.files} files read${census.unreadable.length ? `, ${census.unreadable.length} unreadable` : ""}. ${census.kinds.length} kinds: named in a writer file ${count("writes")}, named only in other code ${count("other code only")}, not named ${count("not named")}.`,
    "",
    "| Kind | Files | Occurrences | Our code | Other files that name it | Attributes no code mentions | Attributes too common to judge |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const kind of census.kinds) {
    const others = kind.namedIn.filter((name) => !defaultIsWriter(name)).join(", ");
    lines.push(`| ${kind.kind} | ${kind.files} | ${kind.total} | ${standing(kind)} | ${others} | ${kind.namedIn.length ? kind.attributesNotNamed.join(", ") || "none" : "(all)"} | ${kind.attributesAmbiguous.join(", ")} |`);
  }
  return lines.join("\n");
}
