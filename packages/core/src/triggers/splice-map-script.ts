// Splices Compiled Galaxy into a MapScript.galaxy that has Kept triggers (ADR-0010).
//
// Test Document runs MapScript.galaxy as it stands, and only an Editor save rebuilds it from
// Triggers, so a compile beside Kept triggers can't regenerate it. It keeps the Editor's script and
// adds or replaces only its own blocks, each where the Editor itself would put it:
//
//   include:<path>              an include line the Kept script lacks, after the last include
//   lib-init:<function>         its library's init call, at the end of InitLibs
//   global-variables            an empty Global Variables section and InitGlobals, when the Kept
//   init-globals-call             script has none, and InitMap's InitGlobals() call with it
//   variable:gv_<name>          a global's declaration, in Global Variables
//   variable-init:gv_<name>     its initial value, in InitGlobals
//   trigger-variable:gt_<name>  a trigger's declaration, in Trigger Variables
//   trigger:gt_<name>           its section (its _Func and _Init), among the trigger sections
//   trigger-init:gt_<name>      its _Init call, in InitTriggers
//
// The Editor writes globals and triggers in the depth-first order of Triggers' folder tree, so a
// global's or trigger's block goes before the block of the next one in that order the script has
// (`order`, the spliced Triggers' items by name), or at the end of its section when none follows: a
// Kept trigger the author files among Compiled ones keeps its place when the Editor next saves.
// A disabled trigger, which the Editor leaves out of the script, is passed over.
//
// An include and its library init, once added, stay: a Kept trigger saved since may call the
// library, so they leave the record as the Kept script's own. A section the compile added goes only
// once nothing is declared in it, so a global the author has added there since stays.
//
// The blocks are delimited by the Editor's own structure (its section rules, the names in each
// line), not by markers of ours, so a script the Editor has since saved still splices: the next
// compile finds its blocks by the ids on the record.

import { fingerprint } from "../domain/compile-record.js";
import { definitionSpan } from "../mods/library-galaxy.js";

/** A Compiled block of Galaxy as the record lists it. */
export type GalaxyBlock = { readonly id: string; readonly fingerprint: string };

const RULE = "//--------------------------------------------------------------------------------------------------";

type Piece = { readonly id: string; readonly text: string };

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A global's name as a pattern that matches it in either form: the Editor's, which starts it lower
 * case (gv_count), and the one the compile wrote before #902, and a record may still list (gv_Count).
 */
function globalPattern(name: string): string {
  const match = /^gv_(.)(.*)$/s.exec(name);
  if (!match) return escape(name);
  const [, first, rest] = match as unknown as [string, string, string];
  return `gv_[${first.toUpperCase()}${first.toLowerCase()}]${escape(rest)}`;
}

/** A name with a global's first letter lower case, as the Editor and the compile write it, to compare a name in a record or package from before #902 (gv_Count) or a Kept Identifier with another. */
export const editorForm = (name: string): string => (name.startsWith("gv_") ? `gv_${name.charAt(3).toLowerCase()}${name.slice(4)}` : name);

/** The script's line ending: the Editor writes CRLF. */
const eolOf = (script: string): string => (script.includes("\r\n") ? "\r\n" : "\n");

/** The span of the function `signature` (a line starting `void InitLibs () {`), from that line to past its closing `}` line. */
function functionSpan(script: string, signature: string): { start: number; close: number; end: number } | undefined {
  const match = new RegExp(`^${escape(signature)}\\r?\\n`, "m").exec(script);
  if (!match) return undefined;
  const close = script.slice(match.index).search(/^\}\r?$/m);
  if (close < 0) return undefined;
  const at = match.index + close;
  const end = script.indexOf("\n", at);
  return { start: match.index, close: at, end: end < 0 ? script.length : end + 1 };
}

/** The span of a section's body: the lines after its `// <title>` rule pair up to the next rule; `header` is where its rules start. */
function sectionSpan(script: string, title: string): { header: number; start: number; end: number } | undefined {
  const match = new RegExp(`^${escape(RULE)}\\r?\\n// ${escape(title)}\\r?\\n${escape(RULE)}\\r?\\n`, "m").exec(script);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const next = script.slice(start).search(new RegExp(`^${escape(RULE)}\\r?$`, "m"));
  return { header: match.index, start, end: next < 0 ? script.length : start + next };
}

/** A whole line matching `pattern` (anchored to the line), or undefined. */
function lineMatching(script: string, pattern: string, from = 0, to = script.length): { start: number; end: number; text: string } | undefined {
  const regex = new RegExp(`^${pattern}\\r?\\n`, "gm");
  regex.lastIndex = from;
  const match = regex.exec(script);
  if (!match || match.index >= to) return undefined;
  return { start: match.index, end: match.index + match[0].length, text: match[0] };
}

/** Where a trigger's section is: from the rule before its `// Trigger:` comment to past the blank line after its _Init. */
function triggerSpan(script: string, name: string): { start: number; end: number } | undefined {
  const func = new RegExp(`^bool ${escape(name)}_Func \\(`, "m").exec(script);
  if (!func) return undefined;
  // Back over "// Trigger: <title>" and the rule above it.
  let start = func.index;
  for (let rules = 0; rules < 2; ) {
    start = script.lastIndexOf("\n", start - 2) + 1;
    if (script.startsWith(RULE, start)) rules += 1;
    if (start === 0) break;
  }
  const init = functionSpan(script, `void ${name}_Init () {`);
  if (!init || init.start < func.index) return undefined;
  const blank = /^\r?\n/.exec(script.slice(init.end));
  return { start, end: init.end + (blank ? blank[0].length : 0) };
}

/** Where a global's or trigger's block `id` (variable:, variable-init:, trigger-variable:, trigger:, trigger-init:) is in `script`, or undefined. */
function namedBlockSpan(script: string, id: string): { start: number; end: number } | undefined {
  const [kind, name = ""] = id.split(/:(.*)/s);
  switch (kind) {
    case "variable": {
      const section = sectionSpan(script, "Global Variables");
      return section && lineMatching(script, `\\S[^\\r\\n]* ${globalPattern(name)};`, section.start, section.end);
    }
    case "variable-init": {
      const globals = functionSpan(script, "void InitGlobals () {");
      return globals && lineMatching(script, `    ${globalPattern(name)} = [^\\r\\n]*;`, globals.start, globals.end);
    }
    case "trigger-variable": {
      const section = sectionSpan(script, "Trigger Variables");
      return section && lineMatching(script, `trigger ${escape(name)};`, section.start, section.end);
    }
    case "trigger":
      return triggerSpan(script, name);
    case "trigger-init": {
      const triggers = functionSpan(script, "void InitTriggers () {");
      return triggers && lineMatching(script, `    ${escape(name)}_Init\\(\\);`, triggers.start, triggers.end);
    }
    default:
      return undefined;
  }
}

/**
 * The blocks of `generated` (a whole script as writeMapScript writes it) that the Editor's script
 * `existing` already has a block of the same id for, each with both texts: a Kept trigger's or
 * global's Galaxy the compile would write over (one converted from Kept, ADR-0026).
 */
export function sharedBlocks(existing: string, generated: string): { readonly id: string; readonly kept: string; readonly compiled: string }[] {
  return generatedPieces(generated, existing).flatMap((piece) => {
    const span = namedBlockSpan(existing, piece.id);
    return span ? [{ id: piece.id, kept: existing.slice(span.start, span.end), compiled: piece.text }] : [];
  });
}

/** Removes the block `id` from `script`, wherever it is; a block that isn't there is left. */
function removeBlock(script: string, id: string): string {
  const [kind] = id.split(/:(.*)/s);
  const remove = (span: { start: number; end: number } | undefined): string => (span ? script.slice(0, span.start) + script.slice(span.end) : script);
  switch (kind) {
    case "include":
    case "lib-init":
      return script;
    case "variable":
    case "variable-init":
    case "trigger-variable":
    case "trigger":
    case "trigger-init":
      return remove(namedBlockSpan(script, id));
    case "global-variables": {
      const section = sectionSpan(script, "Global Variables");
      return remove(section && !declaresGlobals(script) ? { start: section.header, end: section.end } : undefined);
    }
    case "init-globals-call": {
      const map = functionSpan(script, "void InitMap () {");
      return remove(map && !declaresGlobals(script) ? lineMatching(script, "    InitGlobals\\(\\);", map.start, map.end) : undefined);
    }
    default:
      throw new Error(`Unknown Galaxy block ${id} on the compile record`);
  }
}

/** Whether the script's Global Variables section declares anything. */
function declaresGlobals(script: string): boolean {
  const section = sectionSpan(script, "Global Variables");
  return section !== undefined && /^\S[^\r\n]* \w+;\r?$/m.test(script.slice(section.start, section.end));
}

/** The Compiled pieces of a generated script (writeMapScript's), each with its block id, in script order. */
function generatedPieces(generated: string, kept: string): Piece[] {
  const pieces: Piece[] = [];
  for (const line of generated.match(/^include "[^"]+"\r?\n/gm) ?? []) {
    const path = /"([^"]+)"/.exec(line)![1]!;
    if (!lineMatching(kept, `include "${escape(path)}"`)) pieces.push({ id: `include:${path}`, text: line });
  }
  const libs = functionSpan(generated, "void InitLibs () {");
  const keptLibs = functionSpan(kept, "void InitLibs () {");
  for (const line of libs ? generated.slice(libs.start, libs.close).split(/(?<=\n)/).slice(1) : []) {
    const name = /^    (\w+)\(\);/.exec(line)?.[1];
    if (name && !(keptLibs && lineMatching(kept, `    ${name}\\(\\);`, keptLibs.start, keptLibs.end))) pieces.push({ id: `lib-init:${name}`, text: line });
  }
  const globals = sectionSpan(generated, "Global Variables");
  if (globals) {
    const body = generated.slice(globals.start, globals.end);
    const declarations = body.match(/^\S[^\r\n]* gv_\w+;\r?\n/gm) ?? [];
    const initGlobals = functionSpan(generated, "void InitGlobals () {")!;
    const inits = generated.slice(initGlobals.start, initGlobals.close).split(/(?<=\n)/).slice(1).filter((line) => /^    gv_\w+ = /.test(line));
    if (!sectionSpan(kept, "Global Variables")) {
      // The section with nothing in it yet, as the Editor writes it: the rules, a blank line, an empty InitGlobals.
      const eol = eolOf(generated);
      pieces.push({ id: "global-variables", text: [RULE, "// Global Variables", RULE, "", "void InitGlobals () {", "}", "", ""].join(eol) });
      pieces.push({ id: "init-globals-call", text: lineMatching(generated, "    InitGlobals\\(\\);")!.text });
    }
    for (const line of declarations) pieces.push({ id: `variable:${/ (gv_\w+);/.exec(line)![1]}`, text: line });
    for (const line of inits) pieces.push({ id: `variable-init:${/^    (gv_\w+) = /.exec(line)![1]}`, text: line });
  }
  const triggerVariables = sectionSpan(generated, "Trigger Variables");
  const names = triggerVariables ? [...generated.slice(triggerVariables.start, triggerVariables.end).matchAll(/^trigger (gt_\w+);\r?\n/gm)] : [];
  for (const match of names) pieces.push({ id: `trigger-variable:${match[1]}`, text: match[0] });
  for (const match of names) {
    const span = triggerSpan(generated, match[1]!)!;
    pieces.push({ id: `trigger:${match[1]}`, text: generated.slice(span.start, span.end) });
  }
  for (const match of names) pieces.push({ id: `trigger-init:${match[1]}`, text: lineMatching(generated, `    ${match[1]}_Init\\(\\);`)!.text });
  return pieces;
}

/** Inserts `text` at `index`. */
const insertAt = (script: string, index: number, text: string): string => script.slice(0, index) + text + script.slice(index);

/** The items after `name`'s in `order`, each by its names (editorForm compared), or none when `order` lacks it. */
function following(order: readonly (readonly string[])[], name: string): (readonly string[])[] {
  const at = order.findIndex((names) => names.some((other) => editorForm(other) === editorForm(name)));
  return at < 0 ? [] : order.slice(at + 1);
}

/**
 * Where the block of the next global or trigger after the piece's in tree order starts (by `find`,
 * its span in the script for one name, tried for each name the item may have), or undefined when
 * the script has none of them.
 */
function nextBlock(piece: Piece, order: readonly (readonly string[])[], find: (name: string) => { start: number } | undefined): number | undefined {
  const name = piece.id.split(/:(.*)/s)[1] ?? "";
  const prefix = name.slice(0, 3);
  for (const names of following(order, name)) {
    for (const next of names) {
      if (!next.startsWith(prefix)) continue;
      const span = find(next);
      if (span) return span.start;
    }
  }
  return undefined;
}

/** Where a piece goes in the Kept script, as the Editor would place it. */
function insertPiece(script: string, piece: Piece, eol: string, order: readonly (readonly string[])[]): string {
  const [kind] = piece.id.split(":");
  const text = piece.text.replace(/\r?\n/g, eol);
  const before = (find: (name: string) => { start: number } | undefined): number | undefined => nextBlock(piece, order, find);
  const need = <T>(value: T | undefined | null, what: string): T => {
    if (value === undefined || value === null) throw new Error(`MapScript.galaxy has no ${what}, so the compile can't add its Galaxy beside the Kept triggers; save the map in the Editor, then compile again`);
    return value;
  };
  switch (kind) {
    case "include": {
      const includes = [...script.matchAll(/^include "[^"]+"\r?\n/gm)];
      const last = need(includes.at(-1), "include lines");
      return insertAt(script, last.index + last[0].length, text);
    }
    case "lib-init":
      return insertAt(script, need(functionSpan(script, "void InitLibs () {"), "InitLibs").close, text);
    case "variable": {
      const section = need(sectionSpan(script, "Global Variables"), "Global Variables section");
      const next = before((name) => lineMatching(script, `\\S[^\\r\\n]* ${globalPattern(name)};`, section.start, section.end));
      if (next !== undefined) return insertAt(script, next, text);
      const declarations = [...script.slice(section.start, section.end).matchAll(/^\S[^\r\n]* \w+;\r?\n/gm)];
      const last = declarations.at(-1);
      return insertAt(script, last ? section.start + last.index + last[0].length : section.start, text);
    }
    case "variable-init": {
      const globals = need(functionSpan(script, "void InitGlobals () {"), "InitGlobals");
      return insertAt(script, before((name) => lineMatching(script, `    ${globalPattern(name)} = [^\\r\\n]*;`, globals.start, globals.close)) ?? globals.close, text);
    }
    case "global-variables": {
      // After the sections that come before it (libraries, structures), before the declarations and triggers.
      const next = need(/^\/\/-+\r?\n\/\/ (Global Function Declarations|Trigger Variables|Global Functions|Trigger: )/m.exec(script), "Trigger Variables section");
      return insertAt(script, next.index, text);
    }
    case "init-globals-call": {
      const libs = need(lineMatching(script, "    InitLibs\\(\\);", need(functionSpan(script, "void InitMap () {"), "InitMap").start), "InitLibs() call in InitMap");
      return insertAt(script, libs.end, text);
    }
    case "trigger-variable": {
      const section = need(sectionSpan(script, "Trigger Variables"), "Trigger Variables section");
      const next = before((name) => lineMatching(script, `trigger ${escape(name)};`, section.start, section.end));
      if (next !== undefined) return insertAt(script, next, text);
      const declarations = [...script.slice(section.start, section.end).matchAll(/^trigger \w+;\r?\n/gm)];
      const last = declarations.at(-1);
      return insertAt(script, last ? section.start + last.index + last[0].length : section.start, text);
    }
    case "trigger": {
      const initialization = need(/^\/\/-+\r?\n\/\/ Trigger Initialization\r?\n/m.exec(script), "Trigger Initialization section");
      return insertAt(script, before((name) => triggerSpan(script, name)) ?? initialization.index, text);
    }
    case "trigger-init": {
      const triggers = need(functionSpan(script, "void InitTriggers () {"), "InitTriggers");
      return insertAt(script, before((name) => lineMatching(script, `    ${escape(name)}_Init\\(\\);`, triggers.start, triggers.close)) ?? triggers.close, text);
    }
    default:
      throw new Error(`Unknown Galaxy block ${piece.id}`);
  }
}

/** The names a script declares for triggers (gt_) and globals (gv_). */
function declaredNames(script: string): Set<string> {
  const names = new Set<string>();
  for (const title of ["Trigger Variables", "Global Variables"]) {
    const section = sectionSpan(script, title);
    if (!section) continue;
    for (const match of script.slice(section.start, section.end).matchAll(/^\S[^\r\n]* (g[tv]_\w+);/gm)) names.add(editorForm(match[1]!));
  }
  return names;
}

/**
 * `existing` (the Editor's MapScript.galaxy) with the blocks the previous compile wrote
 * (`previous`, by id) taken out and the Compiled blocks of `generated` (a whole script as
 * writeMapScript writes it from the Compiled triggers, or none) put in.
 */
export function spliceMapScript(
  existing: string,
  generated: string | undefined,
  previous: readonly string[],
  /** Script names (gt_, gv_) of Compiled triggers and globals the author kept: their blocks are left as the script has them, and not added. */
  skip: ReadonlySet<string> = new Set(),
  /** The spliced Triggers' globals and triggers, each by the script names it may have, in its folder tree's order (triggerTreeScriptNames); without it, each block goes at the end of its section. */
  order: readonly (readonly string[])[] = [],
): { readonly content: string; readonly blocks: GalaxyBlock[] } {
  // Lines inside a block go before the lines that hold them; removing in reverse record order keeps that.
  let script = existing;
  for (const id of [...previous].reverse()) script = removeBlock(script, id);
  if (generated === undefined) return { content: script, blocks: [] };
  const eol = eolOf(existing);
  const skipped = new Set([...skip].map(editorForm));
  const pieces = generatedPieces(generated, script).filter((piece) => {
    const name = /^(?:trigger-variable|trigger|trigger-init|variable|variable-init):(.*)$/.exec(piece.id)?.[1];
    return name === undefined || !skipped.has(editorForm(name));
  });
  const taken = declaredNames(script);
  for (const piece of pieces) {
    const name = /^(?:trigger-variable|variable):(.*)$/.exec(piece.id)?.[1];
    if (name && taken.has(editorForm(name))) throw new Error(`MapScript.galaxy already declares ${name}, a Kept ${name.startsWith("gt_") ? "trigger" : "variable"}; the compile's would have the same script name`);
  }
  for (const piece of pieces) script = insertPiece(script, piece, eol, order);
  return { content: script, blocks: pieces.map((piece) => ({ id: piece.id, fingerprint: fingerprint(piece.text.replace(/\r?\n/g, eol)) })) };
}

/**
 * The blocks of a whole script the compile wrote (no Kept triggers beside it): each trigger's and
 * global's, as a later splice would find them once the Editor has saved the script with Kept
 * triggers in it. Its includes and library inits stay, as the Kept script's own.
 */
export function scriptBlocks(script: string): GalaxyBlock[] {
  const eol = eolOf(script);
  return generatedPieces(script, script).map((piece) => ({ id: piece.id, fingerprint: fingerprint(piece.text.replace(/\r?\n/g, eol)) }));
}

/**
 * Where a Kept element's Galaxy is in the Editor's script: a trigger's section (`gt_<name>`), from
 * the rule before its `// Trigger:` comment to past the blank line after its _Init, or a function's
 * definition (`gf_<name>`), from its signature to past the blank line after its closing brace; for a
 * function that runs in its own thread, from its `auto_gf_<name>_Trigger` global to past the blank
 * line after its trigger's function.
 */
export function keptElementSpan(script: string, name: string): { readonly start: number; readonly end: number } | undefined {
  if (name.startsWith("gt_")) return triggerSpan(script, name);
  // As a library's definition is found (a thread's globals and trigger function with it), then the blank line after it.
  const span = definitionSpan(script, name);
  if (!span) return undefined;
  const blank = /^\r?\n/.exec(script.slice(span.end));
  return { start: span.start, end: span.end + (blank ? blank[0].length : 0) };
}
