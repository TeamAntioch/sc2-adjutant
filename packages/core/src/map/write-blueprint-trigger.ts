// The authoring tool's I/O (#1033): writes or rewrites one of a Mission Blueprint's own trigger
// elements (ADR-0026) from calls in the Editor's terms (triggers/author-trigger.ts). It reads what
// the trigger may name: the libraries in reach of the map (missionLibraries), the package's Kept
// functions, globals and triggers by their names in TriggerStrings, and the Blueprint's own; and
// every Id in reach, so a new one clashes with none. Before writing, the trigger is checked as the
// compile checks it (blueprintReferenceProblems) and its Galaxy rendered by the one engine among the
// Kept elements, so what it writes compiles. It writes the trigger's file in `triggers/`, with its
// names and its text values' words, and lists a new one in the Blueprint's `triggers`. Nothing is
// written when it is refused.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { BlueprintFunction, BlueprintTrigger } from "../domain/blueprint-trigger.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { heldIds, type GuiVariable, type LibraryFunction, type TypeSpec } from "../domain/library-interface.js";
import type { GameLibrary } from "../mods/library-galaxy.js";
import { ElementWriter, mapElements, readMapFunction, stringTable, UnconvertibleFunctionError } from "../mods/library-xml.js";
import { parseMissionBlueprint, type Workspace } from "../plugins/workspace.js";
import { type AuthoringTrigger, AuthoringError, AuthoringTriggerSchema, authorTrigger, type MapPreset, type MapReach } from "../triggers/author-trigger.js";
import { type AuthoredTrigger, type AuthoredTriggers, blueprintReferenceProblems, blueprintTriggerFile, blueprintTriggerIds, blueprintTriggerXml, libraryForm, readAuthoredTriggers, unknownParts } from "../triggers/blueprint-triggers.js";
import { KeptGalaxyRenderer, textValueKeys } from "../triggers/kept-trigger-galaxy.js";
import { libraryItems, recordedItemKeys } from "../triggers/splice-triggers.js";
import { CORE_PRIMITIVES } from "../triggers/trigger-catalog.js";
import { readTriggersFile, triggerStringNames } from "../triggers/triggers-file.js";
import { xmlAttribute, type XmlNode } from "../util/xml.js";
import { missionLibraries } from "./compile-mission.js";
import { enUSFirst, fileSlug, gameStringsFiles } from "./convert-mission-triggers.js";
import { TRIGGER_STRINGS } from "./editor-changes.js";
import { missionMapPackage, readCompileRecord } from "./mission-package.js";

export type WrittenBlueprintTrigger = {
  readonly name: string;
  readonly id: string;
  /** Its file, relative to the Blueprint. */
  readonly file: string;
  /** Whether it is new to the Blueprint, else rewritten. */
  readonly created: boolean;
  /** How many calls it holds, and how many kept the Id they had. */
  readonly calls: number;
  readonly keptCalls: number;
};

/** A map's Triggers with nothing in it, for a Mission whose package has none yet. */
const EMPTY_TRIGGERS = '<?xml version="1.0" encoding="utf-8"?>\r\n<TriggerData>\r\n    <Root>\r\n    </Root>\r\n</TriggerData>\r\n';

/** A package's trigger files as text: Triggers, TriggerStrings and each locale's GameStrings, enUS first. */
export type PackageTriggerFiles = { readonly triggers: string; readonly triggerStrings: string; readonly gameStrings: readonly string[] };

/**
 * The package's trigger files as text: Triggers (empty ones where the package has none), TriggerStrings (empty where missing) and each locale's GameStrings;
 * and those GameStrings by their path in the package.
 */
async function packageFiles(blueprintPath: string): Promise<{ readonly files: PackageTriggerFiles; readonly gameStrings: ReadonlyMap<string, string> }> {
  const pkg = await missionMapPackage(blueprintPath);
  const optional = async (file: string, otherwise: string): Promise<string> => (existsSync(file) ? readFile(file, "utf8") : otherwise);
  const gameStrings = await gameStringsFiles(pkg);
  return {
    files: {
      triggers: await optional(path.join(pkg, "Triggers"), EMPTY_TRIGGERS),
      triggerStrings: await optional(path.join(pkg, ...TRIGGER_STRINGS.split("/")), ""),
      gameStrings: enUSFirst(gameStrings),
    },
    gameStrings,
  };
}

/**
 * A Kept global's type, from its element's VariableType; undefined where it isn't one read whole
 * (an array sized by a constant), so a value naming it is checked against no type.
 */
function keptVariableType(node: XmlNode | undefined): TypeSpec | undefined {
  const type = node?.children.find((child) => child.name === "VariableType");
  const value = type?.children.find((child) => child.name === "Type");
  const name = value && xmlAttribute(value, "Value");
  if (!type || !name) return undefined;
  const element = type.children.find((child) => child.name === "TypeElement");
  const elementId = element && xmlAttribute(element, "Id");
  const game = type.children.find((child) => child.name === "GameType");
  const gameType = game && xmlAttribute(game, "Value");
  const sizes = type.children.filter((child) => child.name === "ArraySize").map((bound) => Number(xmlAttribute(bound, "Value")));
  if (!sizes.every((size) => Number.isInteger(size) && size > 0)) return undefined;
  return {
    type: name,
    ...(element && elementId ? { element: xmlAttribute(element, "Library") ? `${xmlAttribute(element, "Library")}/${elementId}` : elementId } : {}),
    ...(gameType ? { gameType } : {}),
    ...(sizes.length ? { array: sizes.map((size) => ({ size })) } : {}),
  };
}

/**
 * The map's own elements a trigger may name, for the authoring tool (MapReach): the `kept` items'
 * functions (their interfaces; one that can't be read is left out, so a call to it is refused as
 * one not in reach), globals, triggers and preset types, by their names in TriggerStrings; the
 * Blueprint's own globals, triggers and functions; and the enUS GameStrings' words, for a Kept function's
 * text defaults.
 */
export function authoringMapReach(
  files: { readonly triggers: string; readonly triggerStrings: string; readonly gameStrings: readonly string[] },
  kept: readonly { readonly type: string; readonly id: string }[],
  blueprint: { readonly triggers: readonly AuthoredTrigger[]; readonly variables: readonly GuiVariable[]; readonly functions?: readonly BlueprintFunction[] },
): MapReach {
  const strings = stringTable(files.triggerStrings);
  const elements = mapElements(files.triggers);
  // The Blueprint's own functions, as a Kept one's interface is read.
  const functions: LibraryFunction[] = (blueprint.functions ?? []).map((fn) => libraryForm(fn).fn);
  for (const item of kept.filter((each) => each.type === "FunctionDef")) {
    try {
      functions.push(readMapFunction(elements, strings, item.id));
    } catch (error) {
      if (!(error instanceof UnconvertibleFunctionError)) throw error;
    }
  }
  const child = (node: XmlNode | undefined, name: string): XmlNode | undefined => node?.children.find((each) => each.name === name);
  const presets: MapPreset[] = kept.flatMap((item) => {
    const node = item.type === "Preset" ? elements.get(`Preset/${item.id}`) : undefined;
    if (!node) return [];
    const base = child(node, "BaseType");
    const values = node.children.flatMap((each) => {
      const id = each.name === "Item" && xmlAttribute(each, "Type") === "PresetValue" && xmlAttribute(each, "Library") === undefined ? xmlAttribute(each, "Id") : undefined;
      return id === undefined ? [] : [{ id, name: strings.get(`PresetValue/Name/${id}`), identifier: child(elements.get(`PresetValue/${id}`), "Identifier")?.text.trim() || undefined }];
    });
    return [{ id: item.id, name: strings.get(`Preset/Name/${item.id}`), base: base && xmlAttribute(base, "Value"), bits: child(node, "PresetAsBits") !== undefined, values }];
  });
  const structures = kept.flatMap((item) => {
    const node = item.type === "Structure" ? elements.get(`Structure/${item.id}`) : undefined;
    if (!node) return [];
    const members = node.children.flatMap((each) => {
      const id = each.name === "Variable" ? xmlAttribute(each, "Id") : undefined;
      const name = id === undefined ? undefined : strings.get(`Variable/Name/${id}`);
      if (id === undefined || name === undefined) return [];
      const type = keptVariableType(elements.get(`Variable/${id}`));
      return [{ id, name, ...(type ? { type } : {}) }];
    });
    return [{ id: item.id, members }];
  });
  const texts = new Map<string, string>();
  for (const text of files.gameStrings) for (const [key, words] of stringTable(text)) if (!texts.has(key)) texts.set(key, words);
  return {
    functions,
    globals: [
      ...kept.flatMap((item) => {
        const name = strings.get(`Variable/Name/${item.id}`);
        const type = keptVariableType(elements.get(`Variable/${item.id}`));
        return item.type === "Variable" && name !== undefined ? [{ id: item.id, name, ...(type ? { type } : {}) }] : [];
      }),
      ...blueprint.variables.map((variable) => ({ id: variable.id, name: variable.name, type: variable.type })),
    ],
    triggers: [
      ...kept.flatMap((item) => {
        const name = strings.get(`Trigger/Name/${item.id}`);
        return item.type === "Trigger" && name !== undefined ? [{ id: item.id, name }] : [];
      }),
      ...blueprint.triggers.map(({ trigger }) => ({ id: trigger.id, name: trigger.name })),
    ],
    presets,
    structures,
    texts,
  };
}

/** What a Mission's own triggers may name, read from its Blueprint, its package and its compile record. */
export type MissionTriggerReach = {
  readonly blueprint: MissionBlueprint;
  readonly authored: AuthoredTriggers;
  readonly libraries: Readonly<Record<string, GameLibrary>>;
  readonly files: PackageTriggerFiles;
  /** Each locale's GameStrings, by its path in the package. */
  readonly gameStrings: ReadonlyMap<string, string>;
  readonly record: Awaited<ReturnType<typeof readCompileRecord>>;
  /** The items the last compile wrote, by element key, which aren't Kept. */
  readonly compiled: ReadonlySet<string>;
  /** The package's Kept items: neither the compile's own nor a trigger the Blueprint holds. */
  readonly kept: readonly { readonly type: string; readonly id: string }[];
};

/** The Mission at `blueprintPath`'s trigger reach: its Blueprint's own elements, the libraries in reach of its map, its package's trigger files and Kept items. */
export async function missionTriggerReach(workspace: Workspace, blueprintPath: string): Promise<MissionTriggerReach> {
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const authored = await readAuthoredTriggers(blueprint, blueprintPath);
  const { files, gameStrings } = await packageFiles(blueprintPath);
  const record = await readCompileRecord(blueprintPath);
  const compiled = record ? recordedItemKeys(record.entries) : new Set<string>();
  // The Blueprint's own triggers and functions are read from its files, not the package's copies.
  const owned = new Set([...authored.triggers.map(({ trigger }) => `Trigger/${trigger.id}`), ...(authored.functions ?? []).map(({ fn }) => `FunctionDef/${fn.id}`)]);
  const kept = [...libraryItems(files.triggers)].filter(([key]) => !compiled.has(key) && !owned.has(key)).map(([, item]) => item);
  return { blueprint, authored, libraries: await missionLibraries(workspace, blueprint.dependencies ?? []), files, gameStrings, record, compiled, kept };
}

/**
 * The map's own elements a trigger may name (authoringMapReach): the Kept ones but a Kept trigger
 * `except` (one outlined, as it will be once converted), the Blueprint's globals, and `others`, its
 * triggers but the one written.
 */
export const missionMapReach = ({ files, kept, authored }: MissionTriggerReach, others: readonly AuthoredTrigger[], except?: string): MapReach =>
  authoringMapReach(files, kept.filter((item) => !(item.type === "Trigger" && item.id === except)), { triggers: others, variables: authored.variables ?? [], functions: (authored.functions ?? []).map(({ fn }) => fn) });

/**
 * Writes (or, for a Blueprint trigger of the same name, rewrites) the trigger `input` gives in the
 * Editor's terms, as above. Refused (AuthoringError), with every problem in the Editor's terms, when
 * a name isn't in reach or is ambiguous, a value has the wrong type, or what it names or its Galaxy
 * can't be written; nothing is written then.
 */
export async function writeBlueprintTrigger(workspace: Workspace, blueprintPath: string, given: AuthoringTrigger): Promise<WrittenBlueprintTrigger> {
  const parsed = AuthoringTriggerSchema.safeParse(given);
  if (!parsed.success) throw new Error(`The trigger isn't one the tool takes: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(trigger)"}: ${issue.message}`).join("; ")}`);
  const input = parsed.data;
  const reach = await missionTriggerReach(workspace, blueprintPath);
  const { blueprint, authored, libraries, files, record, compiled, kept } = reach;
  const strings = stringTable(files.triggerStrings);
  const names = triggerStringNames(files.triggerStrings);

  // The trigger rewritten: by its Id when given (a rename), else by its name.
  const previous = authored.triggers.find(({ trigger }) => (input.id !== undefined ? trigger.id === input.id : trigger.name === input.name));
  if (input.id !== undefined && !previous) throw new AuthoringError(input.name, [`the Blueprint has no trigger ${input.id} to rewrite: leave id out to write a new one`]);
  const others = authored.triggers.filter((entry) => entry !== previous);
  const namesake = others.find(({ trigger }) => trigger.name === input.name);
  if (namesake) throw new AuthoringError(input.name, [`the Blueprint trigger ${namesake.trigger.id} (${namesake.file}) has this name already: give this one another`]);
  const map = missionMapReach(reach, others);
  const keptNamesake = kept.find((item) => item.type === "Trigger" && strings.get(`Trigger/Name/${item.id}`) === input.name);
  if (keptNamesake) throw new AuthoringError(input.name, [`the map has a Kept trigger of this name (${keptNamesake.id}): convert it into the Blueprint with convert_triggers, then rewrite it here, or give this one another name`]);

  // Every Id in reach: the package's, the compile record's and the Blueprint's.
  const taken = new Set<string>([
    ...readTriggersFile(files.triggers).ids,
    ...(record?.entries ?? []).flatMap((entry) => ("id" in entry && typeof entry.id === "string" && /^[0-9A-F]{8}$/.test(entry.id) ? [entry.id] : [])),
    ...others.flatMap(({ trigger }) => blueprintTriggerIds(trigger)),
    ...(authored.variables ?? []).flatMap((variable) => [variable.id, ...(variable.value ? heldIds(variable.value) : [])]),
    ...authored.folders.map((folder) => folder.id),
  ]);
  const { trigger, calls, keptCalls } = authorTrigger(input, { libraries, map, taken, ...(previous ? { previous: previous.trigger } : {}) });

  const dir = path.dirname(blueprintPath);
  let file = previous?.file;
  if (file === undefined) {
    const listed = new Set((blueprint.triggers ?? []).map((each) => each.toLowerCase()));
    let slug = fileSlug(trigger.name);
    for (let n = 2; listed.has(`triggers/${slug}.json`) || existsSync(path.join(dir, "triggers", `${slug}.json`)); n++) slug = `${fileSlug(trigger.name)}-${n}`;
    file = `triggers/${slug}.json`;
  }

  // What it names, in reach, as the compile checks it.
  const entry: AuthoredTrigger = { file, trigger };
  const problems = blueprintReferenceProblems({ ...authored, triggers: [...others, entry] }, { triggers: files.triggers, names, compiled }, libraries);
  const prefix = `the Blueprint trigger "${trigger.name}" (${trigger.id}, ${file}) `;
  const own = problems.filter((problem) => problem.startsWith(prefix)).map((problem) => problem.slice(prefix.length));
  if (own.length > 0) throw new AuthoringError(input.name, own.map((problem) => `it ${problem}`));
  authoredTriggerGalaxy(trigger, others, authored.variables ?? [], files, names, libraries);

  await mkdir(path.join(dir, "triggers"), { recursive: true });
  await writeFile(path.join(dir, ...file.split("/")), blueprintTriggerFile(trigger));
  if (!previous) {
    const raw = JSON.parse(await readFile(blueprintPath, "utf8")) as Record<string, unknown>;
    raw.triggers = [...((raw.triggers as string[] | undefined) ?? []), file];
    await writeFile(blueprintPath, `${JSON.stringify(raw, null, 2)}\n`);
  }
  return { name: trigger.name, id: trigger.id, file, created: !previous, calls, keptCalls };
}

/**
 * A Blueprint trigger's Galaxy, rendered by the one engine among the Kept elements and the
 * Blueprint's, as the compile renders it ("" for a disabled one). Refused (AuthoringError) where
 * the engine can't write it as the Editor does.
 */
export function authoredTriggerGalaxy(
  trigger: BlueprintTrigger,
  others: readonly AuthoredTrigger[],
  globals: readonly GuiVariable[],
  files: { readonly triggers: string; readonly gameStrings: readonly string[] },
  keptNames: ReadonlyMap<string, string>,
  libraries: Readonly<Record<string, GameLibrary>>,
): string {
  const base = files.triggers;
  const eol = base.includes("\r\n") ? "\r\n" : "\n";
  const writer = new ElementWriter(undefined, "    ");
  for (const variable of globals) writer.variable(variable);
  // Later elements stand over the package's of the same key: a converted trigger's Kept copy, a compiled global.
  const added = [...writer.elements, ...others.flatMap(({ trigger: other }) => blueprintTriggerXml(other)), ...blueprintTriggerXml(trigger)].map((element) => `${element.replace(/\r?\n/g, eol)}${eol}`).join("");
  const combined = readTriggersFile(base.replace(/^<\/TriggerData>/m, `${added}</TriggerData>`));
  const names = new Map(keptNames);
  for (const variable of globals) names.set(`Variable/${variable.id}`, variable.name);
  for (const each of [...others.map(({ trigger: other }) => other), trigger]) {
    names.set(`Trigger/${each.id}`, each.name);
    for (const variable of each.variables) names.set(`Variable/${variable.id}`, variable.name);
  }
  const texts = new Map(textValueKeys(files.gameStrings));
  for (const strings of Object.values(trigger.strings ?? {})) for (const [key, words] of Object.entries(strings)) if (words !== "") texts.set(key, words);
  const renderer = new KeptGalaxyRenderer(combined, names, { functions: CORE_PRIMITIVES.functions, presets: CORE_PRIMITIVES.presets }, texts, libraries);
  const section = renderer.renderTrigger(trigger.id);
  if (section === undefined) throw new AuthoringError(trigger.name, [`its Galaxy can't be written as the Editor writes it: it holds ${unknownParts(renderer.unknown)}`]);
  return section;
}
