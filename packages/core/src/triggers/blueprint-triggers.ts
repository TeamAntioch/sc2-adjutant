// Compiles a Mission Blueprint's own trigger elements (ADR-0026) into the compile's Triggers and
// MapScript.galaxy, beside the concepts' triggers and, through the splice, beside Kept ones.
//
// Each Blueprint trigger is a GUI Body (domain/blueprint-trigger.ts). Its XML is the Editor's: its
// Trigger element, then every element it owns in the order the Editor reaches them, written by the
// library writer (ElementWriter) in a map's form, its own references bare. Its Galaxy is written
// by the one engine (ADR-0025): the Kept renderer reads it back from that XML, among the Kept
// elements it may call, and writes it through `callGalaxy` in the map's TemplateScope, as it does a
// Kept trigger, so a Blueprint trigger and a Kept one come out alike.
//
// Before anything is written each element's Ids are checked against the Kept elements in the
// package and the compile's own, and every reference against what is in reach: a library's element
// (`<library>/<id>`) against the library data, the map's own (a bare Id) against the Kept elements
// and the Blueprint's. The elements the concepts compile to are the compile's and may change, so a
// body can't name them. A refusal names the element and its file.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { type GuiCall, type GuiStatement, type GuiValue, type GuiVariable, heldIds, isComment, LIBRARY_ITEM_TYPES, statementIds, type StructMember, type TypeSpec } from "../domain/library-interface.js";
import { type BlueprintTrigger, type BlueprintTriggerFolder, BlueprintTriggerSchema } from "../domain/blueprint-trigger.js";
import type { Strings } from "../domain/entry-strings.js";
import { type GameLibrary, gameTriggerLibraries, type LibraryVariable } from "../mods/library-galaxy.js";
import { ElementWriter, escapeXml, mapLabelLine } from "../mods/library-xml.js";
import { KeptGalaxyRenderer, type KeptCatalog, type UnknownPart } from "./kept-trigger-galaxy.js";
import { libraryItems } from "./splice-triggers.js";
import { CORE_PRIMITIVES } from "./trigger-catalog.js";
import { elementKey, readTriggersFile, type TriggersFile } from "./triggers-file.js";

/** A Blueprint trigger element, with the file it was read from (relative to the Blueprint), for a refusal to name. */
export type AuthoredTrigger = { readonly file: string; readonly trigger: BlueprintTrigger };

/** The Blueprint's own trigger elements, the global variables it declares, and the folders they're filed in. */
export type AuthoredTriggers = { readonly triggers: readonly AuthoredTrigger[]; readonly variables?: readonly GuiVariable[]; readonly folders: readonly BlueprintTriggerFolder[] };

/** Whether the Blueprint declares any trigger element of its own: a trigger, a global or a folder. */
export const hasAuthoredTriggers = (authored: AuthoredTriggers | undefined): authored is AuthoredTriggers => authored !== undefined && authored.triggers.length + (authored.variables ?? []).length + authored.folders.length > 0;

/** A global's Galaxy, as the Editor writes it: its declaration, and its initialization unless it starts at Galaxy's default. */
type GlobalGalaxy = { readonly declaration: string; readonly initial?: string };

/** The Kept Triggers the Blueprint's elements are compiled beside: the package's file, its names, and the previous compile's items in it (by element key), which aren't Kept. */
export type KeptTriggers = { readonly triggers: string; readonly names: ReadonlyMap<string, string>; readonly compiled: ReadonlySet<string> };

/** The compile's own Triggers and MapScript.galaxy, each written whole, and the names it gives its elements (TriggerStrings keys). */
export type GeneratedTriggers = { readonly triggers: string; readonly script: string; readonly names: Readonly<Record<string, string>> };

const ELEMENT = "    ";
const CHILD = "        ";
const RULE = "//--------------------------------------------------------------------------------------------------";

/** What a refusal names a Blueprint global by. */
const describeGlobal = (variable: GuiVariable): string => `the Blueprint global "${variable.name}" (${variable.id}, triggerVariables)`;

/** What a refusal names a Blueprint trigger by. */
const describeTrigger = ({ file, trigger }: AuthoredTrigger): string => `the Blueprint trigger "${trigger.name}" (${trigger.id}, ${file})`;

/** A Blueprint trigger's file, as convert_triggers and write_blueprint_trigger write it: its element in the schema's order, as JSON. */
export const blueprintTriggerFile = (trigger: BlueprintTrigger): string => `${JSON.stringify(BlueprintTriggerSchema.parse(trigger), null, 2)}\n`;

/**
 * The Blueprint's own trigger elements, each read from its file in `triggers` (relative to the
 * Blueprint), and its folders. A file that can't be read or isn't a trigger element is refused,
 * naming it and why.
 */
export async function readAuthoredTriggers(
  blueprint: { readonly triggers?: readonly string[] | undefined; readonly triggerVariables?: readonly GuiVariable[] | undefined; readonly triggerFolders?: readonly BlueprintTriggerFolder[] | undefined },
  blueprintPath: string,
): Promise<AuthoredTriggers> {
  const triggers = await Promise.all(
    (blueprint.triggers ?? []).map(async (file): Promise<AuthoredTrigger> => {
      const full = path.join(path.dirname(blueprintPath), ...file.split("/"));
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(full, "utf8"));
      } catch (error) {
        throw new Error(`${blueprintPath}'s trigger element ${file} can't be read: ${error instanceof Error ? error.message : String(error)}`);
      }
      const parsed = BlueprintTriggerSchema.safeParse(raw);
      if (!parsed.success) throw new Error(`${blueprintPath}'s trigger element ${file} isn't one: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`).join("; ")}`);
      return { file, trigger: parsed.data };
    }),
  );
  return { triggers, variables: blueprint.triggerVariables ?? [], folders: blueprint.triggerFolders ?? [] };
}

/** A reference line in a trigger element: `<Event Type="FunctionCall" Id="…"/>`, a comment's `Type="Comment"`. */
const statementLine = (tag: string, statement: GuiStatement): string => `${CHILD}<${tag} Type="${isComment(statement) ? "Comment" : "FunctionCall"}" Id="${statement.id}"/>`;

/**
 * A Blueprint trigger's elements as the Editor writes them in a map's Triggers (LF): the Trigger first, then its local variables, events,
 * conditions and actions with everything each owns, in the order the Editor reaches them.
 */
export function blueprintTriggerXml(trigger: BlueprintTrigger): readonly string[] {
  const writer = new ElementWriter(undefined, ELEMENT);
  const lines = [
    ...(trigger.identifier ? [`${CHILD}<Identifier>${escapeXml(trigger.identifier)}</Identifier>`] : []),
    ...(trigger.label ? [mapLabelLine(trigger.label, CHILD)] : []),
    ...(trigger.section !== undefined ? [`${CHILD}<Section Value="${escapeXml(trigger.section)}"/>`] : []),
    ...(trigger.disabled ? [`${CHILD}<Disabled/>`] : []),
    ...(trigger.initiallyOff ? [`${CHILD}<InitOff/>`] : []),
    ...trigger.variables.map((variable) => `${CHILD}<Variable Type="Variable" Id="${variable.id}"/>`),
    ...trigger.events.map((statement) => statementLine("Event", statement)),
    ...trigger.conditions.map((statement) => statementLine("Condition", statement)),
    ...trigger.actions.map((statement) => statementLine("Action", statement)),
  ];
  writer.element("Trigger", trigger.id, lines);
  for (const variable of trigger.variables) writer.variable(variable);
  for (const statement of [...trigger.events, ...trigger.conditions, ...trigger.actions]) writer.statement(statement);
  return writer.elements;
}

/** A Blueprint folder's Category element (LF): its icon, then the item lines of what it files. */
function folderXml(folder: BlueprintTriggerFolder): string {
  const items = folder.items.map((item) => `${CHILD}${itemLine(item)}`);
  return [`${ELEMENT}<Element Type="Category" Id="${folder.id}">`, ...(folder.label ? [mapLabelLine(folder.label, CHILD)] : []), ...items, `${ELEMENT}</Element>`].join("\n");
}

/** An item a Blueprint folder files, `<kind>:<id>`, as its kind and Id. */
type FolderItem = { readonly kind: "trigger" | "variable" | "category"; readonly id: string };
const parseItem = (item: string): FolderItem => {
  const [kind, id] = item.split(":") as [FolderItem["kind"], string];
  return { kind, id };
};

/** The line filing an item (`<kind>:<id>`) in Root or a folder. */
const itemLine = (item: string): string => {
  const { kind, id } = parseItem(item);
  return `<Item Type="${LIBRARY_ITEM_TYPES[kind]}" Id="${id}"/>`;
};

/** Every element Id a Blueprint trigger gives: its own, its variables' and their values', its statements'. */
export function blueprintTriggerIds(trigger: BlueprintTrigger): string[] {
  return [
    trigger.id,
    ...trigger.variables.flatMap((variable) => [variable.id, ...(variable.value ? heldIds(variable.value) : [])]),
    ...[...trigger.events, ...trigger.conditions, ...trigger.actions].flatMap(statementIds),
  ];
}

/** The libraries a Blueprint trigger's calls and presets name: the map script includes each. */
export function blueprintTriggerLibraries(authored: AuthoredTriggers): Set<string> {
  const used = new Set<string>();
  const ref = (value: string | undefined): void => {
    if (value?.includes("/")) used.add(value.split("/")[0]!);
  };
  for (const parts of [...authored.triggers.map(({ trigger }) => triggerParts(trigger)), ...(authored.variables ?? []).map(globalParts)]) {
    walk(parts, {
      call: (call) => ref(call.function),
      value: (value) => {
        if ("preset" in value) ref(value.preset);
        if ("presetElement" in value) ref(value.presetElement);
        if ("variable" in value) [value.variable, ...members(value.member)].forEach(ref);
      },
    });
  }
  return used;
}

/** What a Blueprint element holds: its values (variables' initial values) and its statements. */
type Parts = { readonly values: readonly GuiValue[]; readonly statements: readonly GuiStatement[] };
/** A trigger's parts: its local variables' initial values, its events, conditions and actions. */
const triggerParts = (trigger: BlueprintTrigger): Parts => ({ values: trigger.variables.flatMap((variable) => (variable.value ? [variable.value] : [])), statements: [...trigger.events, ...trigger.conditions, ...trigger.actions] });
/** A global's parts: its initial value. */
const globalParts = (variable: GuiVariable): Parts => ({ values: variable.value ? [variable.value] : [], statements: [] });

/** The variables a structure member path names, outermost first. */
const members = (member: StructMember | undefined): string[] => (member ? [member.variable, ...members(member.member)] : []);

/** Visits every call and value of a Blueprint element, and all they hold. */
function walk(parts: Parts, visit: { readonly call?: (call: GuiCall) => void; readonly value?: (value: GuiValue, param?: { readonly id: string; readonly def: string }) => void; readonly statement?: (statement: GuiStatement) => void }): void {
  const value = (held: GuiValue, param?: { readonly id: string; readonly def: string }): void => {
    visit.value?.(held, param);
    if ("call" in held && held.call) statement(held.call);
    if ("valueParams" in held) for (const inner of held.valueParams ?? []) value(inner);
    if ("expression" in held && held.expression) for (const slot of held.expression.slots) value(slot);
    if ("variable" in held && held.variable !== undefined) {
      for (const index of held.index ?? []) value(index);
      for (let member: StructMember | undefined = held.member; member; member = member.member) for (const index of member.index ?? []) value(index);
    }
  };
  const statement = (item: GuiStatement): void => {
    visit.statement?.(item);
    if (isComment(item)) return;
    visit.call?.(item);
    for (const param of item.params ?? []) value(param, param);
    for (const inner of item.body ?? []) statement(inner);
  };
  parts.values.forEach((held) => value(held));
  parts.statements.forEach(statement);
}

/** The Kept Triggers' own elements: every element of the package's file but those the previous compile's items own. */
function keptElements(kept: KeptTriggers | undefined): Map<string, string> {
  if (!kept) return new Map();
  const file = readTriggersFile(kept.triggers);
  const compiled = previousConceptElements(kept);
  return new Map([...file.elements.values()].filter((element) => !compiled.has(elementKey(element.type, element.id))).map((element) => [elementKey(element.type, element.id), file.text.slice(element.start, element.end)]));
}

/** The elements the concepts compile to, by element key (`Trigger/<id>`), each with its name where it has one. */
type ConceptElements = ReadonlyMap<string, string | undefined>;

/** How a body reacts to a concept, since it can't name the concept's elements. */
const REACT_THROUGH_CUES = "react to it through a cue instead: hold this trigger until the cue (a Kept Reference's hold.until), or start a Beat on its run (keptTriggerRuns)";

/** The elements of the previous compile's items in the package (`kept.compiled`): the concepts' elements as it left them. */
function previousConceptElements(kept: KeptTriggers | undefined): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  if (!kept) return out;
  for (const [key, item] of libraryItems(kept.triggers)) {
    if (!kept.compiled.has(key)) continue;
    for (const text of item.elements) {
      const match = /<Element Type="(\w+)" Id="([0-9A-F]+)"/.exec(text);
      if (match) out.set(elementKey(match[1]!, match[2]!), kept.names.get(elementKey(match[1]!, match[2]!)));
    }
  }
  return out;
}

/** The elements this compile's concepts write (`generated`) and the previous compile's in the package, each with its name. */
function conceptElements(generated: TriggersFile, names: Readonly<Record<string, string>>, kept: KeptTriggers | undefined): ConceptElements {
  const out = previousConceptElements(kept);
  for (const element of generated.elements.values()) out.set(elementKey(element.type, element.id), names[`${element.type}/Name/${element.id}`]);
  return out;
}

/** Why the Blueprint's elements can't be compiled: each problem, naming its element. */
export class BlueprintTriggerError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The Blueprint's triggers can't be compiled:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
    this.name = "BlueprintTriggerError";
  }
}

/** The folders' tree: each folder's items resolved, filed once, with no folder inside itself; the Root items, folders first, then globals, then triggers. */
function folderTree(authored: AuthoredTriggers, problems: string[]): { readonly root: readonly string[]; readonly folders: ReadonlyMap<string, BlueprintTriggerFolder> } {
  const triggers = new Set(authored.triggers.map(({ trigger }) => `trigger:${trigger.id}`));
  const variables = new Set((authored.variables ?? []).map((variable) => `variable:${variable.id}`));
  const folders = new Map<string, BlueprintTriggerFolder>();
  for (const folder of authored.folders) {
    if (folders.has(folder.id)) problems.push(`the Trigger Folder ${folder.id} is declared twice in triggerFolders`);
    folders.set(folder.id, folder);
  }
  const filed = new Map<string, string>();
  for (const folder of authored.folders) {
    for (const item of folder.items) {
      const { kind, id } = parseItem(item);
      const [known, list] = kind === "trigger" ? [triggers.has(item), "Blueprint trigger the triggers list"] : kind === "variable" ? [variables.has(item), "global of triggerVariables"] : [folders.has(id), "folder of triggerFolders"];
      if (!known) problems.push(`the Trigger Folder "${folder.name}" (${folder.id}) files ${item}, which is no ${list}`);
      const other = filed.get(item);
      if (other !== undefined) problems.push(`${item} is filed in both ${other} and ${folder.id}: an item is filed once`);
      filed.set(item, folder.id);
    }
  }
  // A folder inside itself, through its subfolders, would never be reached from Root.
  for (const folder of authored.folders) {
    const seen = new Set<string>();
    for (let at: string | undefined = folder.id; at !== undefined; at = filed.get(`category:${at}`)) {
      if (seen.has(at)) {
        problems.push(`the Trigger Folder "${folder.name}" (${folder.id}) is inside itself`);
        break;
      }
      seen.add(at);
    }
  }
  const root = [...authored.folders.map((folder) => `category:${folder.id}`), ...variables, ...triggers].filter((item) => !filed.has(item));
  return { root, folders };
}

/** The Ids every Blueprint element gives, checked: each given once, and none a Kept element's or the compile's own. */
function checkIds(authored: AuthoredTriggers, kept: ReadonlyMap<string, string>, generated: ReadonlySet<string>, problems: string[]): void {
  const keptIds = new Map<string, string>();
  for (const key of kept.keys()) {
    const [type, id] = key.split("/") as [string, string];
    if (!keptIds.has(id)) keptIds.set(id, type);
  }
  const given = new Map<string, string>();
  const check = (id: string, by: string): void => {
    const other = given.get(id);
    if (other !== undefined) problems.push(`${by} gives the element Id ${id}, which ${other === by ? "it gives twice" : `${other} gives too`}: each element has an Id of its own`);
    else given.set(id, by);
    const keptType = keptIds.get(id);
    if (keptType !== undefined) problems.push(`${by} gives the element Id ${id}, which the Kept ${keptType} ${id} in Triggers has`);
    if (generated.has(id)) problems.push(`${by} gives the element Id ${id}, which one of the compile's own elements has`);
  };
  for (const entry of authored.triggers) for (const id of blueprintTriggerIds(entry.trigger)) check(id, describeTrigger(entry));
  for (const variable of authored.variables ?? []) for (const id of [variable.id, ...(variable.value ? heldIds(variable.value) : [])]) check(id, describeGlobal(variable));
  for (const folder of authored.folders) check(folder.id, `the Trigger Folder "${folder.name}"`);
}

/**
 * Every reference of each Blueprint trigger, checked against what is in reach: a library's
 * function, parameter, block slot, preset value, global and structure member in its library data
 * (a mod's globals and members are library-reach.ts's; the game's data holds none); the map's own function,
 * parameter definition, variable and trigger among the Kept elements and the Blueprint's (a
 * variable may be the trigger's own).
 */
function checkReferences(authored: AuthoredTriggers, kept: ReadonlyMap<string, string>, libraries: Readonly<Record<string, GameLibrary>>, problems: string[], concepts: ConceptElements = new Map()): void {
  const blueprintTriggers = new Set(authored.triggers.map(({ trigger }) => trigger.id));
  const globals = new Set((authored.variables ?? []).map((variable) => variable.id));
  const keptHas = (type: string, id: string): boolean => kept.has(elementKey(type, id));
  /** Why a bare Id of `type` can't be named when it is one of the concepts' elements: they're the compile's, and a trigger reacts to a concept through its cues. */
  const conceptRefusal = (type: string, id: string): string | undefined => {
    if (!concepts.has(elementKey(type, id))) return undefined;
    const name = concepts.get(elementKey(type, id));
    return `${name === undefined ? "" : ` ("${name}")`}, which the compile writes for a Blueprint concept and may change: ${REACT_THROUGH_CUES}`;
  };
  const elements = [
    ...authored.triggers.map((entry) => ({ by: describeTrigger(entry), parts: triggerParts(entry.trigger), locals: new Set(entry.trigger.variables.map((variable) => variable.id)), types: entry.trigger.variables.map((variable) => variable.type) })),
    ...(authored.variables ?? []).map((variable) => ({ by: describeGlobal(variable), parts: globalParts(variable), locals: new Set<string>(), types: [variable.type] })),
  ];
  for (const { by, parts, locals, types } of elements) {
    const out = new Set<string>();
    const refuse = (problem: string): void => {
      if (!out.has(problem)) problems.push(`${by} ${problem}`);
      out.add(problem);
    };
    /** A library's element of `field` in its data, or, for a bare Id, the map's own of `type`. */
    const inReach = (ref: string, field: "functions" | "params" | "subFunctions" | "presetValues" | "presets", type: string): string | undefined => {
      if (!ref.includes("/")) return keptHas(type, ref) ? undefined : `the map has no Kept ${type} ${ref}`;
      const [library, id] = ref.split("/") as [string, string];
      const data = libraries[library];
      if (!data) return `the library ${library} isn't in reach of the map (the game's, or a Workspace mod its dependencies load)`;
      if (data.refused) return data.refused;
      return data[field][id] === undefined ? `the library ${library} has no ${type} ${id}` : undefined;
    };
    /**
     * Why a library's variable path is out of reach, or undefined: its global (`<library>/<id>`) and
     * each structure member after it a member of the structure the variable before holds. A map's
     * own variable starts no check, and a library's member after a map's own is checked alone.
     */
    const libraryVariablesProblem = (variable: string, path: readonly string[]): { readonly ref: string; readonly member: boolean; readonly why: string } | undefined => {
      let before: LibraryVariable | undefined;
      for (const [index, ref] of [variable, ...path].entries()) {
        const member = index > 0;
        if (!ref.includes("/")) {
          before = undefined;
          continue;
        }
        const [library, id] = ref.split("/") as [string, string];
        const data = libraries[library];
        const found = data?.variables?.[id];
        const why = !data
          ? `the library ${library} isn't in reach of the map (the game's, or a Workspace mod its dependencies load)`
          : data.refused ??
            (found === undefined || (found.member === true) !== member
              ? `the library ${library} has no ${member ? "structure member" : "global variable"} ${id}`
              : before?.type?.element !== undefined && found.structure !== undefined && before.type.element !== found.structure
                ? `it is a member of the structure ${found.structure}, not of ${before.type.element}, which the variable before it holds`
                : undefined);
        if (why) return { ref, member, why };
        before = found;
      }
      return undefined;
    };
    // A variable's preset type, from a library in reach (a map's own preset or structure isn't an Editor form a Blueprint variable takes).
    for (const type of types as readonly TypeSpec[]) {
      if (type.type !== "preset" || type.element === undefined) continue;
      const why = inReach(type.element, "presets", "Preset");
      if (why) refuse(`declares a variable of the preset type ${type.element}, which is out of reach: ${why}`);
    }
    walk(parts, {
      call: (call) => {
        const concept = call.function.includes("/") ? undefined : conceptRefusal("FunctionDef", call.function);
        const why = concept ? undefined : inReach(call.function, "functions", "FunctionDef");
        if (concept) refuse(`calls ${call.function}${concept}`);
        if (why) refuse(`calls ${call.function}, which is out of reach: ${why}`);
        if (call.sub) {
          const slot = inReach(call.sub, "subFunctions", "SubFuncType");
          if (slot) refuse(`fills the block slot ${call.sub}, which is out of reach: ${slot}`);
        }
      },
      value: (value, param) => {
        if (param) {
          const why = inReach(param.def, "params", "ParamDef");
          if (why) refuse(`gives its Param ${param.id} for the parameter ${param.def}, which is out of reach: ${why}`);
        }
        const presetValues = [...("preset" in value && value.preset !== undefined ? [value.preset] : []), ...("bits" in value ? (value.bits ?? []) : [])];
        for (const preset of presetValues) {
          const why = inReach(preset, "presetValues", "PresetValue");
          if (why) refuse(`names the preset value ${preset}, which is out of reach: ${why}`);
        }
        if ("presetElement" in value && value.presetElement !== undefined) {
          const why = inReach(value.presetElement, "presets", "Preset");
          if (why) refuse(`names the preset type ${value.presetElement}, which is out of reach: ${why}`);
        }
        if ("variable" in value && value.variable !== undefined) {
          // A library's global and the members of its structures named after it, checked in its library; the map's own among its own.
          const problem = libraryVariablesProblem(value.variable, members(value.member));
          if (problem) refuse(`names the ${problem.member ? "structure member" : "variable"} ${problem.ref}, which is out of reach: ${problem.why}`);
          if (!value.variable.includes("/") && !locals.has(value.variable) && !globals.has(value.variable) && !keptHas("Variable", value.variable)) {
            const concept = conceptRefusal("Variable", value.variable);
            refuse(concept ? `names the variable ${value.variable}${concept}` : `names the variable ${value.variable}, which is neither its own nor a Blueprint or Kept global`);
          }
        }
        if ("trigger" in value && value.trigger !== undefined && !blueprintTriggers.has(value.trigger) && !keptHas("Trigger", value.trigger)) {
          const concept = conceptRefusal("Trigger", value.trigger);
          refuse(concept ? `names the trigger ${value.trigger}${concept}` : `names the trigger ${value.trigger}, which is neither a Blueprint trigger nor a Kept one`);
        }
      },
    });
  }
}

/**
 * What of `authored` is out of reach of the map, each problem naming its element (checkReferences):
 * a library's element against the library data, a bare Id against the package's Kept elements and
 * the Blueprint's. How convert-mission-triggers tells a Kept trigger it can't convert.
 */
export function blueprintReferenceProblems(authored: AuthoredTriggers, kept: KeptTriggers, libraries: Readonly<Record<string, GameLibrary>> = gameTriggerLibraries()): string[] {
  const problems: string[] = [];
  checkReferences(authored, keptElements(kept), libraries, problems, previousConceptElements(kept));
  return problems;
}

/**
 * Each Blueprint trigger's and global's Galaxy name (gt_, gv_), checked: none the compile's own
 * script declares, a Kept trigger or global has, or another Blueprint element has, since the script
 * would declare it twice and the game refuse it.
 */
function checkScriptNames(authored: AuthoredTriggers, renderer: KeptGalaxyRenderer, script: string, kept: KeptTriggers | undefined, converted: ReadonlySet<string>, problems: string[]): void {
  const taken = new Map<string, string>();
  for (const match of script.matchAll(/^(?:trigger|\S+) (g[tv]_\w+);\r?$/gm)) taken.set(match[1]!, "one of the compile's own");
  for (const [key, item] of kept ? libraryItems(kept.triggers) : []) {
    // A Kept trigger the Blueprint converts is the Blueprint trigger itself.
    if (kept!.compiled.has(key) || (item.type !== "Trigger" && item.type !== "Variable") || (item.type === "Trigger" && converted.has(item.id))) continue;
    try {
      taken.set(item.type === "Trigger" ? renderer.triggerName(item.id) : renderer.variableGalaxyName(item.id), `the Kept ${item.type} ${item.id}`);
    } catch {
      // A Kept element with no name in TriggerStrings has no Galaxy name to clash with here; the splice checks the script itself.
    }
  }
  const claim = (name: string, by: string): void => {
    const other = taken.get(name);
    if (other !== undefined) problems.push(`${by} would be ${name} in Galaxy, which ${other} already is: give it another name or identifier`);
    else taken.set(name, by);
  };
  for (const variable of authored.variables ?? []) claim(renderer.variableGalaxyName(variable.id), describeGlobal(variable));
  for (const entry of authored.triggers) if (!entry.trigger.disabled) claim(renderer.triggerName(entry.trigger.id), describeTrigger(entry));
}

/** Why a Blueprint trigger's Galaxy can't be written, from the renderer's unknown parts. */
function unrenderable(entry: AuthoredTrigger, unknown: readonly UnknownPart[]): string {
  return `${describeTrigger(entry)} can't be written as Galaxy: it holds ${unknownParts(unknown)}`;
}

/** What the renderer couldn't write, each part once, for a refusal: a form by what it is, else the part whose Galaxy isn't known. */
export const unknownParts = (unknown: readonly UnknownPart[]): string =>
  [...new Set(unknown.map((part) => (part.kind === "form" ? part.key : part.kind === "refused" ? `a call into a refused library (${part.key})` : `the ${part.kind} ${part.key}, whose Galaxy isn't known`)))].join("; ");

/** `text` (CRLF) with `insert` put in at `index`. */
const insertAt = (text: string, index: number, insert: string): string => text.slice(0, index) + insert + text.slice(index);

/** A match's end, or a refusal naming what the compile's own file lacks. */
function find(text: string, pattern: RegExp, what: string): RegExpExecArray {
  const match = pattern.exec(text);
  if (!match) throw new Error(`The compile's ${what} is missing, so the Blueprint's triggers can't be added`);
  return match;
}

/**
 * `script` (the compile's, CRLF) with the globals' declarations at the end of its Global Variables
 * and their initializations at the end of InitGlobals, as the Editor writes them; the section, its
 * InitGlobals and InitMap's call of it made first where the compile has no global of its own.
 */
function withGlobals(script: string, globals: readonly GlobalGalaxy[]): string {
  if (globals.length === 0) return script;
  const declarations = globals.map((global) => `${global.declaration}\r\n`).join("");
  const initials = globals.flatMap((global) => (global.initial ? [`    ${global.initial}\r\n`] : [])).join("");
  if (!/^\/\/ Global Variables\r$/m.test(script)) {
    const before = find(script, new RegExp(`^${RULE}\\r\\n// Trigger Variables\\r\\n`, "m"), "map script's Trigger Variables").index;
    script = insertAt(script, before, `${RULE}\r\n// Global Variables\r\n${RULE}\r\n${declarations}\r\nvoid InitGlobals () {\r\n${initials}}\r\n\r\n`);
    const libs = find(script, /^void InitMap \(\) \{\r\n {4}InitLibs\(\);\r\n/m, "map script's InitMap");
    return insertAt(script, libs.index + libs[0].length, "    InitGlobals();\r\n");
  }
  const section = find(script, /^\/\/ Global Variables\r\n\/\/-+\r\n/m, "map script's Global Variables");
  script = insertAt(script, section.index + section[0].length, declarations);
  const init = find(script, /^void InitGlobals \(\) \{\r\n/m, "map script's InitGlobals");
  return insertAt(script, init.index + init[0].length, initials);
}

/** The compile's Triggers and MapScript.galaxy with the Blueprint's elements in, the strings they need, and the Kept triggers they convert. */
export type CompiledBlueprintTriggers = {
  readonly triggers: string;
  readonly script: string;
  readonly triggerStrings: Readonly<Record<string, string>>;
  readonly gameStrings: Strings;
  /** The Kept triggers the Blueprint converts this compile, each by its element Id and Galaxy name, and whether it is disabled (so has no Galaxy). */
  readonly converted: readonly { readonly id: string; readonly scriptName: string; readonly disabled: boolean }[];
};

/**
 * The compile's Triggers and MapScript.galaxy with the Blueprint's trigger elements added, and the
 * strings they need. In Triggers, the Blueprint's folders and the triggers no folder files go in
 * Root before the compile's own items, folders first, and every element before the compile's own,
 * depth first through the folders as the Editor writes them: the splice keeps each where the
 * package has it, while the compile's own go to the end, so the order holds from one compile to the
 * next. In the script each trigger's declaration, section and _Init call go before the compile's
 * own, in that same order, as the Editor writes the tree's. A Blueprint trigger with a Kept
 * trigger's Id is that one converted (convert-mission-triggers.ts): it may give the Kept one's
 * Ids, and is returned in `converted`, for the Equivalence Check. Refused, naming each element and
 * why, when an Id clashes or a reference is out of reach (BlueprintTriggerError), or when its
 * Galaxy can't be written.
 */
export function compileBlueprintTriggers(
  authored: AuthoredTriggers,
  generated: GeneratedTriggers,
  {
    kept,
    libraries = gameTriggerLibraries(),
    catalog = { functions: CORE_PRIMITIVES.functions, presets: CORE_PRIMITIVES.presets },
  }: { readonly kept?: KeptTriggers; readonly libraries?: Readonly<Record<string, GameLibrary>>; readonly catalog?: KeptCatalog } = {},
): CompiledBlueprintTriggers {
  if (!hasAuthoredTriggers(authored)) return { triggers: generated.triggers, script: generated.script, triggerStrings: {}, gameStrings: {}, converted: [] };
  const problems: string[] = [];
  const keptOwn = keptElements(kept);
  const generatedFile = readTriggersFile(generated.triggers);
  const tree = folderTree(authored, problems);
  // A Blueprint trigger with a Kept trigger's Id is that one converted (convert-mission-triggers): it gives the Ids the Kept one's elements have.
  const converting = convertedKept(authored, kept);
  const replaced = new Set([...converting.values()].flat());
  checkIds(authored, new Map([...keptOwn].filter(([key]) => !replaced.has(key))), generatedFile.ids, problems);
  checkReferences(authored, keptOwn, libraries, problems, conceptElements(generatedFile, generated.names, kept));
  if (problems.length > 0) throw new BlueprintTriggerError(problems);

  // Triggers: the Root lines, then the elements, depth first.
  const byId = new Map(authored.triggers.map((entry) => [entry.trigger.id, entry]));
  const globalsById = new Map((authored.variables ?? []).map((variable) => [variable.id, variable]));
  const order: AuthoredTrigger[] = [];
  const globalOrder: GuiVariable[] = [];
  const elements: string[] = [];
  const visit = (item: string): void => {
    const { kind, id } = parseItem(item);
    if (kind === "category") {
      const folder = tree.folders.get(id)!;
      elements.push(folderXml(folder));
      folder.items.forEach(visit);
      return;
    }
    if (kind === "variable") {
      const variable = globalsById.get(id)!;
      globalOrder.push(variable);
      const writer = new ElementWriter(undefined, ELEMENT);
      writer.variable(variable);
      elements.push(...writer.elements);
      return;
    }
    const entry = byId.get(id)!;
    order.push(entry);
    elements.push(...blueprintTriggerXml(entry.trigger));
  };
  tree.root.forEach(visit);
  const crlf = (text: string): string => text.replace(/\r?\n/g, "\r\n");
  const rootLines = tree.root.map((item) => `${CHILD}${itemLine(item)}\r\n`).join("");
  let triggers = generated.triggers;
  // Before the compile's own, which a splice moves to the end each compile while the Blueprint's stay in place.
  const rootOpen = find(triggers, /^    <Root>\r?\n/m, "Triggers' Root");
  triggers = insertAt(triggers, rootOpen.index + rootOpen[0].length, rootLines);
  const rootClose = find(triggers, /^    <\/Root>\r?\n/m, "Triggers' Root");
  triggers = insertAt(triggers, rootClose.index + rootClose[0].length, elements.map((element) => `${crlf(element)}\r\n`).join(""));

  // Names, and the text values' words.
  const triggerStrings: Record<string, string> = {};
  for (const folder of authored.folders) triggerStrings[`Category/Name/${folder.id}`] = folder.name;
  for (const variable of authored.variables ?? []) triggerStrings[`Variable/Name/${variable.id}`] = variable.name;
  for (const { trigger } of authored.triggers) {
    triggerStrings[`Trigger/Name/${trigger.id}`] = trigger.name;
    for (const variable of trigger.variables) triggerStrings[`Variable/Name/${variable.id}`] = variable.name;
  }
  const gameStrings: Record<string, Record<string, string>> = {};
  for (const { trigger } of authored.triggers) for (const [file, strings] of Object.entries(trigger.strings ?? {})) Object.assign((gameStrings[file] ??= {}), strings);

  // Galaxy, by the Kept renderer, from the Triggers with the Kept elements in reach.
  const writtenFile = readTriggersFile(triggers);
  const keptText = [...keptOwn].filter(([key]) => !writtenFile.elements.has(key) && !replaced.has(key)).map(([, text]) => crlf(text).replace(/(\r\n)?$/, "\r\n")).join("");
  const combined = readTriggersFile(insertAt(triggers, triggers.search(/^<\/TriggerData>/m), keptText));
  const names = new Map<string, string>([...(kept?.names ?? []), ...Object.entries(generated.names).map(([key, name]) => [key.replace("/Name/", "/"), name] as const), ...Object.entries(triggerStrings).map(([key, name]) => [key.replace("/Name/", "/"), name] as const)]);
  const texts = new Map<string, string>();
  for (const strings of Object.values(gameStrings)) for (const [key, words] of Object.entries(strings)) if (words !== "") texts.set(key, words);
  const renderer = new KeptGalaxyRenderer(combined, names, catalog, texts, libraries);
  checkScriptNames(authored, renderer, generated.script, kept, new Set(converting.keys()), problems);
  if (problems.length > 0) throw new BlueprintTriggerError(problems);
  const globals: GlobalGalaxy[] = [];
  for (const variable of globalOrder) {
    const global = renderer.renderGlobal(variable.id);
    if (global === undefined) problems.push(`${describeGlobal(variable)} can't be written as Galaxy: it holds ${[...new Set(renderer.unknown.map((part) => part.key))].join("; ")}`);
    else globals.push(global);
  }
  const written: { readonly name: string; readonly section: string }[] = [];
  for (const entry of order) {
    const section = renderer.renderTrigger(entry.trigger.id);
    if (section === undefined) problems.push(unrenderable(entry, renderer.unknown));
    // A disabled trigger has no Galaxy: no section, no declaration and no _Init call.
    else if (section !== "") written.push({ name: renderer.triggerName(entry.trigger.id), section });
  }
  if (problems.length > 0) throw new BlueprintTriggerError(problems);

  // Each before the compile's own, as in Triggers.
  let script = withGlobals(generated.script, globals);
  const declarations = find(script, /^\/\/ Trigger Variables\r\n\/\/-+\r\n/m, "map script's Trigger Variables");
  script = insertAt(script, declarations.index + declarations[0].length, written.map(({ name }) => `trigger ${name};\r\n`).join(""));
  const firstSection = script.search(new RegExp(`^${RULE}\\r\\n// Trigger: `, "m"));
  const initialization = find(script, new RegExp(`^${RULE}\\r\\n// Trigger Initialization\\r\\n`, "m"), "map script's Trigger Initialization");
  script = insertAt(script, firstSection >= 0 && firstSection < initialization.index ? firstSection : initialization.index, written.map(({ section }) => section).join(""));
  const inits = find(script, /^void InitTriggers \(\) \{\r\n/m, "map script's InitTriggers");
  script = insertAt(script, inits.index + inits[0].length, written.map(({ name }) => `    ${name}_Init();\r\n`).join(""));
  const converted = [...converting.keys()].map((id) => ({ id, scriptName: renderer.triggerName(id), disabled: byId.get(id)!.trigger.disabled === true }));
  return { triggers, script, triggerStrings, gameStrings, converted };
}

/**
 * The Blueprint triggers that are Kept triggers converted: each Blueprint trigger whose Id a Kept
 * Trigger in the package has, by Id, with the element keys of the Kept one's elements, which it
 * writes over.
 */
function convertedKept(authored: AuthoredTriggers, kept: KeptTriggers | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!kept) return out;
  const ids = new Set(authored.triggers.map(({ trigger }) => trigger.id));
  for (const [key, item] of libraryItems(kept.triggers)) {
    if (item.type !== "Trigger" || kept.compiled.has(key) || !ids.has(item.id)) continue;
    out.set(
      item.id,
      item.elements.flatMap((text) => {
        const match = /<Element Type="(\w+)" Id="([0-9A-F]+)"/.exec(text);
        return match ? [elementKey(match[1]!, match[2]!)] : [];
      }),
    );
  }
  return out;
}

