// Tunes Kept triggers and functions in the Mission's own Map Package (ADR-0010): a parameter's
// value, a call removed, a call copied. Each edit changes the element's XML in `Triggers` and its
// Galaxy in `MapScript.galaxy` together, so Test Document runs the change without an Editor save
// (Test Document runs the script as it stands; only a save rebuilds it).
//
// The Galaxy is rendered from the edited XML (triggers/kept-trigger-galaxy.ts), so an element may be
// tuned only where every function and preset it uses is in the trigger catalog or a library in
// reach (the game's, or that of a Workspace mod the map depends on); otherwise the tool
// refuses, naming each one by library and id, and the author edits it in the Editor and saves. Before
// anything is written, the unedited element is rendered and compared with the script's own Galaxy
// for it: a script the Editor didn't write from these triggers (or a rendering this module gets
// wrong) refuses too, so the tool never writes Galaxy it can't vouch for. Every edit is checked
// before any file is written, nothing is written while the Editor has the map open, and the files are
// written all together or not at all.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { Host } from "../host/host.js";
import { type GameLibrary, gameTriggerLibraries } from "../mods/library-galaxy.js";
import { librariesInReach } from "../mods/library-reach.js";
import { parseMissionBlueprint, type Workspace } from "../plugins/workspace.js";
import { bindLibraryNames, fillLibraryNames, KeptGalaxyRenderer, SWITCH, textValueKeys, type KeptCatalog, type UnknownPart } from "../triggers/kept-trigger-galaxy.js";
import { keptElementSpan } from "../triggers/splice-map-script.js";
import { CORE_PRIMITIVES, NTVE_FUNCTIONS, primitiveKey, VCMI_FUNCTIONS, type FunctionDef, type PresetDef } from "../triggers/trigger-catalog.js";
import { formatFixed } from "../triggers/write-triggers-xml.js";
import { child, children, elementKey, elementOf, readTriggersFile, referenced, refKey, triggerStringNames, type TriggerXmlElement, type TriggerXmlNode, type TriggersFile } from "../triggers/triggers-file.js";
import { packageContents, type PackageContents } from "./kept-references.js";
import { openKeptSession, withMissionPackageLock } from "./kept-session.js";
import { outlineDiff } from "./outline-diff.js";
import { outlineKeptTriggerFrom } from "./outline-trigger.js";
import { missionTriggerReach } from "./write-blueprint-trigger.js";
import { missionMapPackage, readCompileRecord } from "./mission-package.js";
import { readDependencies } from "./read-dependencies.js";

const ElementId = z.string().regex(/^[0-9A-F]{8}$/, "An element Id is 8 uppercase hex digits, as Triggers has it");
/** A trigger or function by its name, its element Id, or a Kept Reference id. */
const TargetSchema = z.string().min(1);
/**
 * A parameter's new value, in the form it has now: a number, true/false or text for a literal; a
 * preset by `<library>/<id>`; a placed unit, point, region or camera by its Editor id; a trigger by
 * name or element Id.
 */
const ValueSchema = z.union([
  z.number().finite(),
  z.boolean(),
  z.string(),
  z.object({ preset: z.string().regex(/^\w+\/[0-9A-F]{8}$/, "A preset is <library>/<id>, such as Ntve/00000546") }).strict(),
  z.object({ id: z.number().int().nonnegative() }).strict(),
  z.object({ trigger: z.string().min(1) }).strict(),
]);
export type KeptTriggerValue = z.infer<typeof ValueSchema>;

export const KeptTriggerEditSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), trigger: TargetSchema, param: ElementId, value: ValueSchema }).strict(),
  z.object({ op: z.literal("remove"), trigger: TargetSchema, call: ElementId }).strict(),
  z
    .object({
      op: z.literal("copy"),
      trigger: TargetSchema,
      call: ElementId,
      /** The call in the same list the copy goes after; by default the one copied. */
      after: ElementId.optional(),
      /** New values for the copy's parameters, by the copied call's parameter Ids. */
      set: z.record(ElementId, ValueSchema).optional(),
    })
    .strict(),
]);
export type KeptTriggerEdit = z.input<typeof KeptTriggerEditSchema>;

export type KeptTriggerTuneResult = {
  readonly changed: readonly string[];
  readonly files: readonly string[];
  readonly mapPackage: string;
  /** A dry run's change to each trigger edited, in the Editor's form with the changed lines marked (outline-diff.ts); a function has none. */
  readonly diffs?: readonly { readonly trigger: string; readonly diff: string }[];
};

export type KeptTriggerTuneOptions = {
  /** Asked whether the Editor has the map open (`editor.checkClosed`); a host that can't tell lets the edit go ahead. */
  readonly host?: Host;
  /** Check and apply every edit in memory and return the change to each trigger in the Editor's form, writing nothing (so the Editor having the map open is no refusal). */
  readonly dryRun?: boolean;
};

const TRIGGER_STRINGS = "enUS.SC2Data/LocalizedData/TriggerStrings.txt";
/** A file of the package by its path inside it, which is always written with forward slashes (as the Kept session keys files). */
const inPackage = (dir: string, file: string): string => path.join(dir, ...file.split("/"));

/** core's catalog and every Mechanic's primitives in the Workspace. */
export function keptCatalog(workspace: Workspace): KeptCatalog {
  const functions = new Map<string, FunctionDef>(CORE_PRIMITIVES.functions);
  const presets = new Map<string, PresetDef>(CORE_PRIMITIVES.presets);
  for (const mechanic of workspace.registry.contributions("mechanics")) {
    for (const def of Object.values(mechanic.primitives?.functions ?? {})) if (!functions.has(primitiveKey(def))) functions.set(primitiveKey(def), def);
    for (const def of Object.values(mechanic.primitives?.presets ?? {})) if (!presets.has(primitiveKey(def))) presets.set(primitiveKey(def), def);
  }
  return { functions, presets };
}

/** The package's parts this module reads. */
type Package = {
  readonly dir: string;
  triggers: string;
  script: string;
  readonly names: ReadonlyMap<string, string>;
  /** GameStrings.txt per locale, by path in the package; a copied call's text is copied in each. */
  readonly gameStrings: Map<string, string>;
  /** The placed units, points and cameras in Objects and the regions in Regions, by Editor Id. */
  readonly placed: PackageContents;
};

async function readPackage(dir: string): Promise<Package> {
  for (const file of ["Triggers", "MapScript.galaxy", TRIGGER_STRINGS]) {
    if (!existsSync(inPackage(dir, file))) throw new Error(`${dir} has no ${file}, so it has no Kept triggers to tune`);
  }
  const gameStrings = new Map<string, string>();
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // Keyed with forward slashes on every OS: the session finds what it read by this key, and a Windows path's backslashes would match nothing.
    const file = `${entry.name}/LocalizedData/GameStrings.txt`;
    if (entry.isDirectory() && entry.name.endsWith(".SC2Data") && existsSync(inPackage(dir, file))) gameStrings.set(file, await readFile(inPackage(dir, file), "utf8"));
  }
  return {
    dir,
    triggers: await readFile(path.join(dir, "Triggers"), "utf8"),
    script: await readFile(path.join(dir, "MapScript.galaxy"), "utf8"),
    names: triggerStringNames(await readFile(inPackage(dir, TRIGGER_STRINGS), "utf8")),
    gameStrings,
    placed: await packageContents(dir, new Set(["unit", "point", "camera", "region"])),
  };
}

/** The libraries the map's Kept triggers can call: the game's, and those of the Workspace mods its DocumentInfo depends on. */
const mapLibraries = async (workspace: Workspace, pkg: Package): Promise<Readonly<Record<string, GameLibrary>>> => librariesInReach(workspace, await readDependencies(pkg.dir));

/** The text parameters' string keys that GameStrings gives text, in any locale: a text parameter without one is empty. */
const textKeys = (pkg: Package): ReadonlyMap<string, string> => textValueKeys(pkg.gameStrings.values());

/** A Kept trigger or function, resolved. */
type Target = { readonly id: string; readonly type: "Trigger" | "FunctionDef"; readonly name: string };

function resolveTarget(file: TriggersFile, names: ReadonlyMap<string, string>, kept: readonly { id: string; kind: string; editorId: string | number }[], target: string): Target {
  const reference = kept.find((item) => item.id === target && item.kind === "trigger");
  // A Kept Reference names a trigger; an element Id may be a trigger's and a function's both, in an older map.
  const byId = reference ? [elementOf(file, "Trigger", String(reference.editorId))] : [elementOf(file, "Trigger", target), elementOf(file, "FunctionDef", target)];
  const found = byId.filter((element): element is TriggerXmlElement => element !== undefined);
  const candidates = found.length > 0
    ? found
    : [...file.elements.values()].filter((element) => (element.type === "Trigger" || element.type === "FunctionDef") && names.get(`${element.type}/${element.id}`) === target);
  if (candidates.length === 0) throw new Error(`No Kept trigger or function ${target} in Triggers (by name, element Id or Kept Reference id)`);
  if (candidates.length > 1) {
    const ids = candidates.map((element) => element.id);
    throw new Error(
      new Set(ids).size < ids.length
        ? `${target} is the element Id of both a trigger and a function; name it by its name or its Kept Reference id`
        : `${target} names ${candidates.length} triggers or functions; name it by element Id (${ids.join(", ")})`,
    );
  }
  const element = candidates[0]!;
  return { id: element.id, type: element.type as Target["type"], name: names.get(`${element.type}/${element.id}`) ?? element.id };
}

/** The Param, FunctionCall and Comment elements an element's body holds, nested, in the order it reaches them. */
function subtree(file: TriggersFile, root: TriggerXmlElement): TriggerXmlElement[] {
  const found = new Map<string, TriggerXmlElement>();
  const visit = (element: TriggerXmlElement): void => {
    for (const node of element.children) {
      // Calls, comments and parameters; references to functions, variables and triggers aren't held.
      if (!["Param", "FunctionCall", "Comment"].includes(node.attrs.Type ?? "")) continue;
      const nested = referenced(file, node);
      if (!nested || found.has(elementKey(nested.type, nested.id))) continue;
      found.set(elementKey(nested.type, nested.id), nested);
      visit(nested);
    }
  };
  visit(root);
  return [...found.values()];
}

/** The element of `type` with `id` among `elements`. */
const among = (elements: readonly TriggerXmlElement[], type: string, id: string): TriggerXmlElement | undefined => elements.find((element) => element.type === type && element.id === id);

/** Why the element can't be tuned, for a refusal. */
function describeUnknown(target: Target, unknown: readonly UnknownPart[]): string {
  const keys = (kind: UnknownPart["kind"]): string[] => [...new Set(unknown.filter((part) => part.kind === kind).map((part) => part.key))];
  const functions = keys("function");
  const presets = keys("preset");
  const forms = keys("form");
  const refused = keys("refused");
  const named = (keys: readonly string[]): string => keys.map((key) => { const [library, id] = key.split("/"); return `${id} (library ${library})`; }).join(", ");
  const unread = [
    ...(functions.length ? [`the trigger catalog doesn't know the function${functions.length > 1 ? "s" : ""} ${named(functions)}`] : []),
    ...(presets.length ? [`${functions.length ? "nor" : "the trigger catalog doesn't know"} the preset${presets.length > 1 ? "s" : ""} ${named(presets)}`] : []),
    ...(forms.length ? [`it holds ${forms.join("; ")}, which this tool doesn't read`] : []),
  ];
  // A refused library is its mod's to fix: an Editor save of the map doesn't mend it.
  const intoRefused = refused.length ? `it calls into a library in reach that is refused (${refused.join("; ")})` : "";
  if (unread.length === 0) return `${target.name} can't be tuned here: its Galaxy can't be written, since ${intoRefused}. Fix that mod's package or Blueprint, then tune it.`;
  return [`${target.name} can't be tuned here: its Galaxy can't be written without an Editor save, since`, ...unread].join(" ") + (intoRefused ? `, and ${intoRefused}` : "") + `. Edit it in the Editor and save the map there, so the Editor rewrites MapScript.galaxy.`;
}

/** A trigger's section (CRLF) with the blank lines between its conditions left out. */
function withoutConditionGaps(section: string): string {
  const start = section.indexOf("\r\n    if (testConds) {\r\n");
  const end = start < 0 ? -1 : section.indexOf("\r\n    }\r\n", start);
  if (end < 0) return section;
  return section.slice(0, start) + section.slice(start, end).replace(/(\r\n {8}\})\r\n(?=\r\n {8}if \(!)/g, "$1") + section.slice(end);
}

/** Renders a Kept element's Galaxy, the names of its library elements learned from the script; throws a refusal when it can't. */
class ElementGalaxy {
  /** The library elements' Galaxy names, once `check` has learned them. */
  libraryNames = new Map<string, string>();

  constructor(
    private readonly target: Target,
    private readonly catalog: KeptCatalog,
    private readonly names: ReadonlyMap<string, string>,
    private readonly texts: () => ReadonlyMap<string, string>,
    private readonly libraries: Readonly<Record<string, GameLibrary>>,
  ) {}

  private render(triggers: string): { text: string | undefined; unknown: readonly UnknownPart[]; galaxyName: string } {
    const renderer = new KeptGalaxyRenderer(readTriggersFile(triggers), this.names, this.catalog, this.texts(), this.libraries);
    const text = this.target.type === "Trigger" ? renderer.renderTrigger(this.target.id) : renderer.renderFunction(this.target.id);
    const galaxyName = this.target.type === "Trigger" ? renderer.triggerName(this.target.id) : renderer.functionName(this.target.id);
    return { text, unknown: [...renderer.unknown], galaxyName };
  }

  /**
   * Where the element's Galaxy is in `script`, which `text` is its render of: undefined for a disabled
   * trigger (rendered as nothing), which has no section, as the Editor writes it, so its edits change
   * no Galaxy. Throws where the script lacks the section, or holds one for a disabled trigger.
   */
  private section(script: string, galaxyName: string, text: string): { readonly start: number; readonly end: number } | undefined {
    const span = keptElementSpan(script, galaxyName);
    if (text === "") {
      if (span) throw new Error(`MapScript.galaxy has a ${galaxyName} for ${this.target.name}, which is disabled, so the Editor writes none: save the map in the Editor, then tune it`);
      return undefined;
    }
    if (!span) throw new Error(`MapScript.galaxy has no ${galaxyName} for ${this.target.name}: save the map in the Editor, then tune it`);
    return span;
  }

  /** Checks the unedited element renders as the script has it, and learns its library names. */
  check(triggers: string, script: string): void {
    const { text, unknown, galaxyName } = this.render(triggers);
    if (text === undefined) throw new Error(describeUnknown(this.target, unknown));
    const span = this.section(script, galaxyName, text);
    if (!span) return;
    const saved = script.slice(span.start, span.end).replace(/\r?\n/g, "\r\n");
    // A section saved without the blank line between conditions (a compile's, or an earlier tune's, before #968) is
    // the Editor's otherwise: it is accepted, and the splice writes the Editor's layout.
    const names = bindLibraryNames(text, saved) ?? bindLibraryNames(withoutConditionGaps(text), withoutConditionGaps(saved));
    if (!names) {
      // A section saved without those blank lines is compared without them, so the line named is the one that differs.
      const older = withoutConditionGaps(saved) === saved;
      const ours = (older ? withoutConditionGaps(text) : text).split("\r\n");
      const theirs = saved.split("\r\n");
      // A line holding a library placeholder matches any name there.
      const found = ours.findIndex((line, index) => theirs[index] === undefined || !bindLibraryNames(line, theirs[index]));
      const at = found < 0 ? ours.length : found;
      throw new Error(
        `MapScript.galaxy's ${galaxyName} isn't the Galaxy the Editor writes for ${this.target.name}'s XML (line ${at + 1}: the script has ${JSON.stringify(theirs[at] ?? "")}, its XML gives ${JSON.stringify((ours[at] ?? "").replace(/\u0001([^\u0001]+)\u0001/g, "<$1>"))}), so a tuned copy can't be vouched for. Save the map in the Editor, then tune it`,
      );
    }
    this.libraryNames = names;
  }

  /** The edited element's Galaxy spliced into `script` in place of its old Galaxy. */
  splice(triggers: string, script: string): string {
    const { text, unknown, galaxyName } = this.render(triggers);
    if (text === undefined) {
      const why = describeUnknown(this.target, unknown).replace(/^.*? since /, "").replace(/\. (Edit it in the Editor|Fix that mod).*$/, "");
      throw new Error(`this edit leaves ${this.target.name} in a form whose Galaxy can't be written (${why})`);
    }
    const span = this.section(script, galaxyName, text);
    if (!span) return script;
    const eol = script.includes("\r\n") ? "\r\n" : "\n";
    return script.slice(0, span.start) + fillLibraryNames(text, this.libraryNames).replace(/\r\n/g, eol) + script.slice(span.end);
  }
}

/** A fresh element Id, derived from `seed`, that no element of the file has yet, of any type, as the Editor numbers them. */
function freshId(file: TriggersFile, taken: Set<string>, seed: string): string {
  for (let turn = 0; ; turn++) {
    const id = createHash("sha256").update(`${seed}#${turn}`).digest("hex").slice(0, 8).toUpperCase();
    if (!file.ids.has(id) && !taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

/** `text` with `element`'s lines replaced by `body` (its whole text). */
const replaceElement = (file: TriggersFile, element: TriggerXmlElement, body: string): string => file.text.slice(0, element.start) + body + file.text.slice(element.end);

/** A Param element's text with its value set to `value`, in the form it already has. */
function setParamValue(file: TriggersFile, param: TriggerXmlElement, value: KeptTriggerValue, target: Target, context: EditContext): string {
  const text = file.text.slice(param.start, param.end);
  const type = child(param, "ValueType")?.attrs.Type;
  const where = `parameter ${param.id} of ${target.name}`;
  const encode = (raw: string): string => raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // Replacers, so a `$` in the value is written as it is.
  const swap = (pattern: RegExp, replacement: string): string => text.replace(pattern, () => replacement);
  const withValue = (raw: string): string => swap(/<Value>[^<]*<\/Value>/, `<Value>${encode(raw)}</Value>`);
  const presetNode = child(param, "Preset") ?? (child(param, "ValueElement")?.attrs.Type === "Preset" ? child(param, "ValueElement") : undefined);
  if (presetNode) {
    if (typeof value !== "object" || !("preset" in value)) throw new Error(`The ${where} is a preset: give { "preset": "<library>/<id>" }`);
    if (!context.catalog.presets.has(value.preset)) throw new Error(`the trigger catalog doesn't know the preset ${value.preset}, so its Galaxy can't be written`);
    const [library, id] = value.preset.split("/");
    return presetNode.tag === "Preset"
      ? swap(/<Preset Type="PresetValue" Library="\w+" Id="[0-9A-F]{8}"\/>/, `<Preset Type="PresetValue" Library="${library}" Id="${id}"/>`)
      : swap(/<ValueElement Type="Preset" Library="\w+" Id="[0-9A-F]{8}"\/>/, `<ValueElement Type="Preset" Library="${library}" Id="${id}"/>`);
  }
  if (child(param, "ValueId") && type !== "abilcmd") {
    if (typeof value !== "object" || !("id" in value)) throw new Error(`The ${where} is a placed ${type}: give { "id": <its Editor id> }`);
    const kind = PLACED_KINDS[type ?? ""];
    if (!kind) throw new Error(`The ${where} is a ${type ?? "typeless"} value, which this tool doesn't set: tune it in the Editor`);
    const id = String(value.id);
    if (!context.placed.get(kind)?.has(id)) {
      const other = (["unit", "point", "camera", "region"] as const).find((item) => context.placed.get(item)?.has(id));
      throw new Error(`The ${where} is a ${kind}, and the map has no ${kind} ${id} in ${kind === "region" ? "Regions" : "Objects"}${other ? ` (${id} is a ${other})` : ""}`);
    }
    return swap(/<ValueId Id="[^"]*"\/>/, `<ValueId Id="${value.id}"/>`);
  }
  if (type === "trigger" && child(param, "ValueElement")) {
    if (typeof value !== "object" || !("trigger" in value)) throw new Error(`The ${where} is a trigger: give { "trigger": <its name or element Id> }`);
    return swap(/<ValueElement Type="Trigger" Id="[0-9A-F]{8}"\/>/, `<ValueElement Type="Trigger" Id="${context.resolveTrigger(value.trigger)}"/>`);
  }
  // Text Galaxy takes in a string literal as written: one line, no control characters.
  const plain = (raw: string): boolean => !/[\u0000-\u001f\u007f]/.test(raw);
  if (!child(param, "Value")) throw new Error(`The ${where} isn't a literal, a preset, a placed object or a trigger (it's ${child(param, "FunctionCall") ? "a call" : child(param, "Variable") ? "a variable" : "another form"}): tune it in the Editor`);
  switch (type) {
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value) || Math.abs(value) > 2 ** 31 - 1) throw new Error(`The ${where} is an integer (a 32-bit one)`);
      return withValue(String(value));
    case "fixed":
      // Galaxy's fixed is 20.12 bits: a value it can hold, written without an exponent.
      if (typeof value !== "number" || Math.abs(value) >= 524288 || /e/i.test(formatFixed(value))) throw new Error(`The ${where} is a number, and needs one a number Galaxy writes plainly (under 524288, without an exponent)`);
      return withValue(formatFixed(value));
    case "bool":
      if (typeof value !== "boolean") throw new Error(`The ${where} is true or false`);
      return withValue(String(value));
    case "string":
    case "gamelink":
      if (typeof value !== "string" || !plain(value)) throw new Error(`The ${where} is ${type === "gamelink" ? "a game data id" : "a string"}: one line of plain text`);
      return withValue(value);
    case "modelanim":
      if (typeof value !== "string" || !/^\w+$/.test(value)) throw new Error(`The ${where} is an animation name, such as Talk: one line of plain text`);
      return withValue(`"${value}"`);
    default:
      throw new Error(`The ${where} is a ${type ?? "typeless"} value, which this tool doesn't set: tune it in the Editor`);
  }
}

/** A call's block slot (its SubFunctionType), or "" outside a block. */
const slotOf = (call: TriggerXmlElement): string => {
  const slot = child(call, "SubFunctionType");
  return slot ? refKey(slot) : "";
};

/** A call that is a parameter's value can't be removed or copied: it isn't in a list, and its Param holds one value. */
function refuseParamValue(line: { holder: TriggerXmlElement }, callId: string, op: string): void {
  if (line.holder.type === "Param") throw new Error(`${callId} is the value of parameter ${line.holder.id}, not a call in a list, so it can't be ${op}: ${op} the call that holds it, or change the parameter in the Editor`);
}

type ReferenceLine = { readonly holder: TriggerXmlElement; readonly tag: string; readonly element: TriggerXmlElement; readonly start: number; readonly end: number };

/**
 * The first line in `holders` (a trigger's Action, a body's or block's FunctionCall) that refers to
 * a call or comment `callId` of one of `types` and that `accept` takes, with its holder and the
 * element it names. In an older map a comment and a call can share an Id, so each line is tried.
 */
function referenceLine(file: TriggersFile, holders: readonly TriggerXmlElement[], callId: string, types: readonly string[] = ["FunctionCall", "Comment"], accept: (line: ReferenceLine) => boolean = () => true): ReferenceLine | undefined {
  const pattern = new RegExp(`^ +<(Action|Condition|Event|FunctionCall) Type="(${types.join("|")})" Id="${callId}"/>\\r?\\n`, "gm");
  for (const holder of holders) {
    for (const match of file.text.slice(holder.start, holder.end).matchAll(pattern)) {
      const element = elementOf(file, match[2]!, callId);
      const line = element && { holder, tag: match[1]!, element, start: holder.start + match.index, end: holder.start + match.index + match[0].length };
      if (line && accept(line)) return line;
    }
  }
  return undefined;
}

/** Applies one edit to `pkg.triggers` (and GameStrings for a copy), returning what changed. */
/** What an edit resolves against: the catalog its presets must be in, the file's triggers by name, and the package's placed objects. */
type EditContext = { readonly catalog: KeptCatalog; readonly resolveTrigger: (name: string) => string; readonly placed: PackageContents };

/**
 * A GameStrings line holding Param `id`'s words: a text value's (`Param/Value/<id>`) or a text
 * expression's (`Param/Expression/<id>`). Its groups: `bom`, the byte order mark before it when it
 * is the file's first line; `kind`, Value or Expression; `words`; `end`, its line break, none on the last line.
 */
const wordsLine = (id: string): RegExp => new RegExp(`^(?<bom>\\uFEFF?)Param/(?<kind>Value|Expression)/${id}=(?<words>[^\\r\\n]*)(?<end>\\r?\\n|$)`, "m");

/** The placed object a ValueId parameter of each type names. */
const PLACED_KINDS: Partial<Record<string, "unit" | "point" | "camera" | "region">> = { unit: "unit", point: "point", region: "region", camerainfo: "camera" };

function applyEdit(pkg: Package, edit: z.infer<typeof KeptTriggerEditSchema>, target: Target, context: EditContext): string {
  const file = readTriggersFile(pkg.triggers);
  const root = elementOf(file, target.type, target.id)!;
  const inside = subtree(file, root);
  const holders = [root, ...inside];
  /** The call's line or the comment's, whichever `id` names; refused when, in an older map, a call and a comment there both have it. */
  const oneOf = (id: string, call: ReferenceLine | undefined, comment: ReferenceLine | undefined): ReferenceLine | undefined => {
    if (call && comment) throw new Error(`${id} is the element Id of both a call and a comment in ${target.name}, so which is meant isn't known; edit it in the Editor`);
    return call ?? comment;
  };
  /** The line naming the call (or, for `types` with Comment, the comment) `id` in the target. */
  const lineOf = (id: string, types: readonly string[]): ReferenceLine | undefined => {
    const inTarget = (line: ReferenceLine): boolean => inside.includes(line.element);
    return oneOf(id, referenceLine(file, holders, id, ["FunctionCall"], inTarget), types.includes("Comment") ? referenceLine(file, holders, id, ["Comment"], inTarget) : undefined);
  };
  switch (edit.op) {
    case "set": {
      const param = among(inside, "Param", edit.param);
      if (!param) throw new Error(`${edit.param} isn't a parameter in ${target.name}`);
      pkg.triggers = replaceElement(file, param, setParamValue(file, param, edit.value, target, context));
      return `${target.name}: parameter ${edit.param} set to ${JSON.stringify(edit.value)}`;
    }
    case "remove": {
      const line = lineOf(edit.call, ["FunctionCall", "Comment"]);
      if (!line) throw new Error(`${edit.call} isn't a call or comment in ${target.name}`);
      refuseParamValue(line, edit.call, "removed");
      const removed = [line.element, ...subtree(file, line.element)];
      const spans = [{ start: line.start, end: line.end }, ...removed].sort((a, b) => b.start - a.start);
      let text = file.text;
      for (const span of spans) text = text.slice(0, span.start) + text.slice(span.end);
      pkg.triggers = text;
      // A removed text parameter's or text expression's words go too, in every locale.
      for (const [stringsFile, strings] of pkg.gameStrings) {
        let next = strings;
        for (const param of removed.filter((element) => element.type === "Param")) next = next.replace(wordsLine(param.id), "$<bom>");
        pkg.gameStrings.set(stringsFile, next);
      }
      return `${target.name}: removed ${edit.call}`;
    }
    case "copy": {
      const line = lineOf(edit.call, ["FunctionCall"]);
      if (!line) throw new Error(`${edit.call} isn't a call in ${target.name}`);
      const source = line.element;
      refuseParamValue(line, edit.call, "copied");
      // The same list: the same holder, the same kind (event, condition, action or call) and, in a block, the same slot.
      const after = edit.after ? oneOf(edit.after, referenceLine(file, [line.holder], edit.after, ["FunctionCall"]), referenceLine(file, [line.holder], edit.after, ["Comment"])) : line;
      if (!after || after.tag !== line.tag || (edit.after && slotOf(after.element) !== slotOf(source))) {
        throw new Error(`${edit.after} isn't in the same list as ${edit.call} in ${target.name}`);
      }
      const copied = [source, ...subtree(file, source)];
      const taken = new Set<string>();
      // Each copied element's new Id, by its type and old Id: one no element of any type has.
      const ids = new Map(copied.map((element) => [elementKey(element.type, element.id), freshId(file, taken, `${target.id}/${element.id}/${edit.after ?? ""}`)]));
      const paramId = (id: string): string => ids.get(elementKey("Param", id))!;
      for (const param of Object.keys(edit.set ?? {})) if (!among(copied, "Param", param)) throw new Error(`${param} isn't a parameter of the copied call ${edit.call}`);
      // The copy's elements: the originals with every reference to a copied element renamed, by its type, each with its new value.
      let blocks = "";
      for (const element of copied) {
        let body = file.text.slice(element.start, element.end).replace(/ Type="(\w+)" Id="([0-9A-F]{8})"/g, (match, type: string, old: string) => {
          const fresh = ids.get(elementKey(type, old));
          return fresh ? ` Type="${type}" Id="${fresh}"` : match;
        });
        const value = element.type === "Param" ? edit.set?.[element.id] : undefined;
        if (value !== undefined) {
          const renamed = readTriggersFile(body);
          body = setParamValue(renamed, elementOf(renamed, "Param", paramId(element.id))!, value, target, context);
        }
        blocks += body;
      }
      const end = Math.max(...copied.map((element) => element.end));
      const fresh = ids.get(elementKey(source.type, source.id))!;
      const reference = file.text.slice(line.start, line.end).replace(edit.call, () => fresh);
      // The reference after `after`, the elements after the copied ones; the later one first, so each index holds.
      const inserts = [{ at: after.end, text: reference }, { at: end, text: blocks }].sort((a, b) => b.at - a.at);
      pkg.triggers = inserts.reduce((text, insert) => text.slice(0, insert.at) + insert.text + text.slice(insert.at), file.text);
      // A copied text parameter's or text expression's words are copied under the new key, after the original's line.
      for (const [stringsFile, strings] of pkg.gameStrings) {
        let next = strings;
        for (const param of copied.filter((element) => element.type === "Param")) {
          // The last line may have no line break after it.
          const entry = wordsLine(param.id).exec(next);
          if (!entry) continue;
          const { kind, words, end: lineEnd } = entry.groups!;
          const copiedLine = `Param/${kind}/${paramId(param.id)}=${words}`;
          const added = lineEnd ? `${copiedLine}${lineEnd}` : `${next.includes("\r\n") ? "\r\n" : "\n"}${copiedLine}`;
          next = next.slice(0, entry.index + entry[0].length) + added + next.slice(entry.index + entry[0].length);
        }
        pkg.gameStrings.set(stringsFile, next);
      }
      return `${target.name}: copied ${edit.call} as ${fresh}${edit.set ? ` (${Object.keys(edit.set).map((id) => `${id} as ${paramId(id)}`).join(", ")})` : ""}`;
    }
  }
}

/** Kept trigger names (and Kept References) the edits may name, checked against the compile record: a Compiled trigger is the Blueprint's. */
function refuseCompiled(target: Target, compiled: ReadonlySet<string>): void {
  if (compiled.has(target.id)) throw new Error(`${target.name} is Compiled Content (on the compile record): change the Blueprint that writes it, then compile`);
}

export function tuneKeptTriggers(workspace: Workspace, blueprintPath: string, edits: readonly KeptTriggerEdit[], options: KeptTriggerTuneOptions = {}): Promise<KeptTriggerTuneResult> {
  return withMissionPackageLock(blueprintPath, () => tuneKeptTriggersLocked(workspace, blueprintPath, edits, options));
}

async function tuneKeptTriggersLocked(workspace: Workspace, blueprintPath: string, edits: readonly KeptTriggerEdit[], options: KeptTriggerTuneOptions): Promise<KeptTriggerTuneResult> {
  const parsed = edits.map((edit, index) => {
    const result = KeptTriggerEditSchema.safeParse(edit);
    if (!result.success) throw new Error(`Edit ${index + 1}: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
    return result.data;
  });
  if (parsed.length === 0) throw new Error("No edits given");
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const session = await openKeptSession(blueprintPath, { verb: "tuned", host: options.host, requirePackage: true });
  const { mapPackage, record } = session;
  const compiled = new Set(record.entries.flatMap((entry) => (entry.kind === "trigger" ? [entry.id] : [])));

  const pkg = await readPackage(mapPackage);
  const original = { triggers: pkg.triggers, script: pkg.script, gameStrings: new Map(pkg.gameStrings) };
  const catalog = keptCatalog(workspace);
  const libraries = await mapLibraries(workspace, pkg);
  const kept = blueprint.kept ?? [];
  const galaxies = new Map<string, ElementGalaxy>();
  const changed: string[] = [];
  const touched = new Map<string, Target>();
  const texts = (): ReadonlyMap<string, string> => textKeys(pkg);
  parsed.forEach((edit, index) => {
    try {
      const file = readTriggersFile(pkg.triggers);
      const target = resolveTarget(file, pkg.names, kept, edit.trigger);
      refuseCompiled(target, compiled);
      touched.set(elementKey(target.type, target.id), target);
      // By type and Id: an older map's trigger and function can share an Id.
      const galaxyKey = elementKey(target.type, target.id);
      if (!galaxies.has(galaxyKey)) {
        const galaxy = new ElementGalaxy(target, catalog, pkg.names, texts, libraries);
        galaxy.check(original.triggers, original.script);
        galaxies.set(galaxyKey, galaxy);
      }
      const resolveTrigger = (name: string): string => {
        const trigger = resolveTarget(file, pkg.names, kept, name);
        if (trigger.type !== "Trigger") throw new Error(`${name} is a function, not a trigger`);
        return trigger.id;
      };
      changed.push(applyEdit(pkg, edit, target, { catalog, resolveTrigger, placed: pkg.placed }));
      // Rendered after each edit, so an edit that leaves the element unwritable is the one named.
      pkg.script = galaxies.get(galaxyKey)!.splice(pkg.triggers, pkg.script);
    } catch (error) {
      throw new Error(`Edit ${index + 1} (${edit.op}): ${error instanceof Error ? error.message : String(error)}. Nothing was written`, { cause: error });
    }
  });

  if (options.dryRun) return { changed, files: [], mapPackage, diffs: await dryRunDiffs(workspace, blueprintPath, [...touched.values()], original.triggers, pkg) };

  // Only the files the edits changed, written together so the XML, the script and the strings never disagree.
  const candidates: readonly (readonly [string, string, string | undefined])[] = [
    ["Triggers", pkg.triggers, original.triggers],
    ["MapScript.galaxy", pkg.script, original.script],
    ...[...pkg.gameStrings].map(([file, text]) => [file, text, original.gameStrings.get(file)] as const),
  ];
  const changedFiles = candidates.filter(([, text, was]) => text !== was).map(([file, text]) => [file, text] as const);
  // Nothing changed, nothing written, so the Editor being open is no refusal.
  const files = changedFiles.length > 0 ? await session.commit(changedFiles) : [];
  return { changed, files: files.map((file) => file.split(path.sep).join("/")), mapPackage };
}

/**
 * Each trigger edited, as the Editor shows it after the edits with its changed lines marked
 * (outline-diff.ts). A trigger the Editor's form can't read is named with why; a function has none.
 */
async function dryRunDiffs(workspace: Workspace, blueprintPath: string, targets: readonly Target[], was: string, now: Package): Promise<{ readonly trigger: string; readonly diff: string }[]> {
  const reach = await missionTriggerReach(workspace, blueprintPath);
  return targets.map((target) => {
    if (target.type !== "Trigger") return { trigger: target.name, diff: `${target.name} is a function: outline_trigger reads triggers, so its change isn't shown in the Editor's form` };
    try {
      return { trigger: target.name, diff: outlineDiff(outlineKeptTriggerFrom(reach, target.id, was, reach.gameStrings), outlineKeptTriggerFrom(reach, target.id, now.triggers, now.gameStrings)) };
    } catch (error) {
      return { trigger: target.name, diff: `${target.name}: no Editor-form diff: ${error instanceof Error ? error.message : String(error)}` };
    }
  });
}

/**
 * A Kept trigger's or function's calls and parameters with their element Ids and Galaxy values, to
 * pick what to tune; and whether it can be tuned (else why not).
 */
export async function outlineKeptTrigger(workspace: Workspace, blueprintPath: string, trigger: string): Promise<{ readonly outline: string; readonly tunable: boolean; readonly reason?: string }> {
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const pkg = await readPackage(await missionMapPackage(blueprintPath));
  const record = await readCompileRecord(blueprintPath);
  const file = readTriggersFile(pkg.triggers);
  const target = resolveTarget(file, pkg.names, blueprint.kept ?? [], trigger);
  const catalog = keptCatalog(workspace);
  const texts = textKeys(pkg);
  // The game's alone where the map's can't be read: the outline is still shown, the reason with it.
  let libraries = gameTriggerLibraries();
  let reason: string | undefined;
  let names = new Map<string, string>();
  try {
    libraries = await mapLibraries(workspace, pkg);
    const galaxy = new ElementGalaxy(target, catalog, pkg.names, () => texts, libraries);
    if (!record) throw new Error(`${blueprintPath} has no compile record yet: compile the Mission in place, or import its map, before tuning it`);
    refuseCompiled(target, new Set(record.entries.flatMap((entry) => (entry.kind === "trigger" ? [entry.id] : []))));
    galaxy.check(pkg.triggers, pkg.script);
    names = galaxy.libraryNames;
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  const renderer = new KeptGalaxyRenderer(file, pkg.names, catalog, texts, libraries);
  const functionNames = new Map<string, string>(Object.entries({ ...NTVE_FUNCTIONS, ...VCMI_FUNCTIONS }).map(([name, def]) => [primitiveKey(def), name]));
  const show = (paramId: string): string => {
    try {
      const before = renderer.unknown.length;
      const value = renderer.value(paramId);
      return renderer.unknown.length > before ? "(uncatalogued)" : fillLibraryNames(value, names);
    } catch {
      return "(not readable)";
    }
  };
  const lines: string[] = [`${target.name} (${target.type === "Trigger" ? "trigger" : "function"} ${target.id})${reason ? "" : ", tunable"}`];
  const visitCall = (node: TriggerXmlNode, indent: string, label: string): void => {
    // A comment, or a call the file lacks, has nothing to tune.
    const call = referenced(file, node);
    if (call?.type !== "FunctionCall") return;
    const ref = child(call, "FunctionDef");
    const key = ref ? refKey(ref) : "?";
    const def = catalog.functions.get(key);
    const switchCase = key === SWITCH.caseFunction;
    const name = ref && !ref.attrs.Library ? `${pkg.names.get(`FunctionDef/${ref.attrs.Id}`) ?? key} (the map's function)` : switchCase ? "case" : def ? (functionNames.get(key) ?? key) : `${key} (uncatalogued)`;
    lines.push(`${indent}${label}${call.id} ${name}${child(call, "Disabled") ? " (disabled)" : ""}`);
    const paramNames = new Map(Object.entries(def?.params ?? {}).map(([paramName, param]) => [param.id, paramName]));
    if (switchCase) paramNames.set(SWITCH.caseValue, "value");
    for (const node of children(call, "Parameter")) {
      const param = referenced(file, node);
      if (param?.type !== "Param") continue;
      const defId = child(param, "ParameterDef")?.attrs.Id ?? "";
      const paramName = paramNames.get(defId) ?? pkg.names.get(`ParamDef/${defId}`) ?? defId;
      lines.push(`${indent}    ${param.id} ${paramName} = ${show(param.id)}`);
      const nested = child(param, "FunctionCall");
      if (nested) visitCall(nested, `${indent}        `, "");
    }
    for (const node of children(call, "FunctionCall")) visitCall(node, `${indent}    `, "");
  };
  const root = elementOf(file, target.type, target.id)!;
  for (const node of root.children) {
    if (!["Event", "Condition", "Action", "FunctionCall"].includes(node.tag)) continue;
    visitCall(node, "  ", node.tag === "FunctionCall" ? "" : `${node.tag.toLowerCase()} `);
  }
  return { outline: lines.join("\n"), tunable: reason === undefined, ...(reason ? { reason } : {}) };
}
