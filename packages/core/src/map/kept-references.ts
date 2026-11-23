// Kept References against their Map Package (ADR-0010): each is found by its Editor Id, and is
// broken when the package no longer has it. The check reports a broken one as an error and a name
// the Editor has changed as a warning; the compile refuses a broken one, and calls a Kept trigger
// or variable by the Editor's name, since the Editor makes its script name from that.

import path from "node:path";

import { bindLikeOriginal } from "../plugins/plugin-api.js";
import type { BlueprintTrigger } from "../domain/blueprint-trigger.js";
import type { KeptKind, KeptReference, MissionBlueprint } from "../domain/mission-blueprint.js";
import { editorForm } from "../triggers/splice-map-script.js";
import { ITEM_LINE, recordedItemKey } from "../triggers/splice-triggers.js";
import { editorGlobalName, editorTriggerName, type TriggerDocument } from "../triggers/trigger-model.js";
import { elementIdentifier, gameDataEntries, packageFiles, readPackageText as read, triggerStringNames } from "./kept-package.js";

/** One Kept Reference's problem: `index` into the Blueprint's `kept`. */
export type KeptReferenceProblem = { readonly index: number; readonly message: string; readonly severity?: "warning" };

/** What the package holds, by kind and Editor Id, with the Editor's name where it has one. */
export type PackageContents = ReadonlyMap<KeptKind, ReadonlyMap<string, string | undefined>>;

const OBJECT_KINDS: Partial<Record<string, KeptKind>> = { ObjectUnit: "unit", ObjectPoint: "point", ObjectCamera: "camera" };

const unescape = (text: string): string => text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** A Kept trigger or global in Triggers: its element Id, the Editor's name for it, and its Galaxy name. */
export type TriggerElement = { readonly kind: "trigger" | "variable"; readonly id: string; readonly name: string | undefined; readonly scriptName: string | undefined };

/**
 * The triggers and globals in a Triggers file, named from its TriggerStrings. A global is a
 * Variable item in Root or a trigger folder; a local or a struct member is a Variable element too,
 * but no item. An element with an Identifier is called by it in Galaxy; any other by its name, as
 * the Editor makes it; one with neither has no script name we can know.
 */
export function triggerElementsIn(triggers: string, strings: string): TriggerElement[] {
  const names = triggerStringNames(strings);
  const globals = new Set([...triggers.matchAll(/<Item Type="Variable" Id="([0-9A-F]{8})"\/>/g)].map((match) => match[1]!));
  const out: TriggerElement[] = [];
  for (const match of triggers.matchAll(/<Element Type="(Trigger|Variable)" Id="([0-9A-F]{8})"(\/?)>/g)) {
    const [, type, id] = match as unknown as [string, "Trigger" | "Variable", string];
    if (type === "Variable" && !globals.has(id)) continue;
    const close = match[3] ? match.index! : triggers.indexOf("</Element>", match.index!);
    const identifier = elementIdentifier(triggers.slice(match.index!, close < 0 ? undefined : close));
    const name = names.get(`${type}:${id}`);
    const scriptName = name === undefined && identifier === undefined ? undefined : type === "Trigger" ? editorTriggerName(name ?? "", identifier) : editorGlobalName(name ?? "", identifier);
    out.push({ kind: type === "Trigger" ? "trigger" : "variable", id, name, scriptName });
  }
  return out;
}

/**
 * The Galaxy names (gt_, gv_) of a Triggers file's triggers and globals in its folder tree's
 * depth-first order, Root first: the order the Editor writes MapScript.galaxy in. Each item has
 * every name `strings` (TriggerStrings files: the compile's, then one per locale) give it, first
 * file first, since its block may be under any of them: the Editor writes a new item's name to the
 * locale it is set to, and a Compiled item the author kept and renamed has its Blueprint name and
 * the Editor's. One no file names, with no Identifier, is left out.
 */
export function triggerTreeScriptNames(triggers: string, strings: readonly string[]): string[][] {
  const named = new Map<string, string[]>();
  const add = (element: TriggerElement): void => {
    if (element.scriptName === undefined) return;
    const key = `${element.kind === "trigger" ? "Trigger" : "Variable"}:${element.id}`;
    const names = named.get(key) ?? named.set(key, []).get(key)!;
    if (!names.includes(element.scriptName)) names.push(element.scriptName);
  };
  for (const text of strings) for (const element of triggerElementsIn(triggers, text)) if (element.name !== undefined) add(element);
  // A name only an Identifier gives is the same in every locale.
  for (const element of triggerElementsIn(triggers, "")) add(element);
  const items = (body: string): [string, string][] => [...body.matchAll(ITEM_LINE())].map((match) => [match[1]!, match[2]!]);
  const folders = new Map([...triggers.matchAll(/<Element Type="Category" Id="([0-9A-F]{8})">([\s\S]*?)<\/Element>/g)].map((match) => [match[1]!, items(match[2]!)]));
  const root = /<Root>([\s\S]*?)<\/Root>/.exec(triggers);
  const out: string[][] = [];
  const seen = new Set<string>();
  const visit = ([type, id]: [string, string]): void => {
    if (seen.has(`${type}:${id}`)) return;
    seen.add(`${type}:${id}`);
    if (type === "Category") (folders.get(id) ?? []).forEach(visit);
    else {
      const names = named.get(`${type}:${id}`);
      if (names !== undefined) out.push(names);
    }
  };
  if (root) items(root[1]!).forEach(visit);
  return out;
}

/** The package's triggers and globals (triggerElementsIn). */
async function triggerElements(mapDir: string): Promise<TriggerElement[]> {
  return triggerElementsIn(await read(path.join(mapDir, "Triggers")), await read(path.join(mapDir, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt")));
}

/** What the package at `mapDir` holds of each of `kinds`, by Editor Id. */
export async function packageContents(mapDir: string, kinds: ReadonlySet<KeptKind>): Promise<PackageContents> {
  const contents = new Map<KeptKind, Map<string, string | undefined>>();
  const of = (kind: KeptKind): Map<string, string | undefined> => contents.get(kind) ?? contents.set(kind, new Map()).get(kind)!;
  if (kinds.has("unit") || kinds.has("point") || kinds.has("camera")) {
    for (const match of (await read(path.join(mapDir, "Objects"))).matchAll(/<(Object\w+)\s([^>]*?)\/?>/g)) {
      const kind = OBJECT_KINDS[match[1]!];
      const id = /\bId="(\d+)"/.exec(match[2]!)?.[1];
      const name = /\bName="([^"]*)"/.exec(match[2]!)?.[1];
      if (kind && id) of(kind).set(id, name === undefined ? undefined : unescape(name));
    }
  }
  if (kinds.has("region")) {
    for (const match of (await read(path.join(mapDir, "Regions"))).matchAll(/<region id="(\d+)">\s*(?:<name value="([^"]*)"\/>)?/g)) {
      of("region").set(match[1]!, match[2] === undefined ? undefined : unescape(match[2]));
    }
  }
  if (kinds.has("trigger") || kinds.has("variable")) {
    for (const element of await triggerElements(mapDir)) of(element.kind).set(element.id, element.name);
  }
  if (kinds.has("catalog-entry")) {
    const gameData = path.join(mapDir, "Base.SC2Data", "GameData");
    for (const file of await packageFiles(gameData, ".xml")) {
      for (const { id } of gameDataEntries(await read(path.join(gameData, file)))) of("catalog-entry").set(id, undefined);
    }
  }
  return contents;
}

const WHERE: Record<KeptKind, string> = {
  unit: "Objects",
  point: "Objects",
  camera: "Objects",
  region: "Regions",
  trigger: "Triggers",
  variable: "Triggers",
  "catalog-entry": "its GameData",
};

/** A Blueprint trigger (ADR-0026) as a trigger reference finds it: by its element Id, with the names its file gives it. */
export type ReferencedBlueprintTrigger = Pick<BlueprintTrigger, "id" | "name" | "identifier" | "disabled">;

/** The Blueprint trigger each reference names by its element Id, if it names one. */
const blueprintTriggersOf = (kept: readonly KeptReference[], triggers: readonly ReferencedBlueprintTrigger[]): (ReferencedBlueprintTrigger | undefined)[] =>
  kept.map((reference) => (reference.kind === "trigger" ? triggers.find((trigger) => trigger.id === reference.editorId) : undefined));

/**
 * Each Kept Reference's problem in the package at `mapDir`: gone (an error), or named otherwise by
 * the Editor (a warning). A trigger reference may name one of the Blueprint's own triggers
 * (`blueprintTriggers`) by the same element Id, as a Kept trigger converted keeps it: then it's
 * found in the Blueprint, its name compared with the trigger's file, and refused when the trigger
 * is disabled, since then it has no script.
 */
export async function keptReferenceProblems(kept: readonly KeptReference[], mapDir: string, blueprintTriggers: readonly ReferencedBlueprintTrigger[] = []): Promise<KeptReferenceProblem[]> {
  if (kept.length === 0) return [];
  const owns = blueprintTriggersOf(kept, blueprintTriggers);
  const inPackage = kept.filter((_, index) => !owns[index]);
  const contents: PackageContents = inPackage.length === 0 ? new Map() : await packageContents(mapDir, new Set(inPackage.map((reference) => reference.kind)));
  const label = (kind: KeptKind): string => (kind === "catalog-entry" ? "catalog entry" : kind);
  return kept.flatMap((reference, index): KeptReferenceProblem[] => {
    const own = owns[index];
    if (own?.disabled) return [{ index, message: `The Blueprint trigger ${own.id} ("${own.name}"), which the Kept Reference ${reference.id} names, is disabled, so it has no script to wait on or run: turn it on, or remove what names it` }];
    if (own) return own.name === reference.name ? [] : [{ index, severity: "warning", message: `Kept Reference ${reference.id} is named "${reference.name}", but the Blueprint trigger ${own.id} it names is "${own.name}"` }];
    const found = contents.get(reference.kind);
    const editorId = String(reference.editorId);
    if (!found?.has(editorId)) {
      return [{ index, message: `${path.basename(mapDir)} has no ${label(reference.kind)} ${editorId} in ${WHERE[reference.kind]}: the Kept Reference ${reference.id} (${reference.name}) is gone; find what took its place in the Editor, or remove it and what uses it` }];
    }
    const name = found.get(editorId);
    if (name !== undefined && name !== reference.name) {
      return [{ index, severity: "warning", message: `Kept Reference ${reference.id} is named "${reference.name}", but the Editor calls it "${name}"` }];
    }
    return [];
  });
}

/**
 * The Blueprint with each Kept trigger and variable called by its Editor name and Galaxy name, for
 * the compile. Throws when a Kept Reference is gone from the package, or when a Kept trigger the
 * Blueprint hooks onto has no script in MapScript.galaxy (added in the Editor and not saved since).
 * A trigger reference naming one of `blueprintTriggers` is called by that trigger's names.
 */
export async function resolveKeptReferences<Blueprint extends Pick<MissionBlueprint, "kept">>(blueprint: Blueprint, mapDir: string, blueprintTriggers: readonly ReferencedBlueprintTrigger[] = []): Promise<Blueprint> {
  if (blueprint.kept.length === 0) return blueprint;
  const problems = await keptReferenceProblems(blueprint.kept, mapDir, blueprintTriggers);
  const errors = problems.filter((problem) => problem.severity === undefined);
  if (errors.length > 0) throw new Error(`Kept References are broken, so the Mission isn't compiled: ${errors.map((problem) => `kept.${problem.index}: ${problem.message}`).join("; ")}`);
  const elements = new Map((await triggerElements(mapDir)).map((element) => [`${element.kind}:${element.id}`, element]));
  const script = await read(path.join(mapDir, "MapScript.galaxy"));
  const owns = blueprintTriggersOf(blueprint.kept, blueprintTriggers);
  const kept = blueprint.kept.map((reference, index) => {
    const own = owns[index];
    if (own) return { ...reference, name: own.name, scriptName: editorTriggerName(own.name, own.identifier) };
    if (reference.kind !== "trigger" && reference.kind !== "variable") return reference;
    const element = elements.get(`${reference.kind}:${reference.editorId}`);
    const name = element?.name ?? reference.name;
    const scriptName = element?.scriptName ?? (reference.kind === "trigger" ? editorTriggerName(name) : editorGlobalName(name));
    if (reference.kind === "trigger" && !new RegExp(`^trigger ${scriptName};`, "m").test(script)) {
      throw new Error(`MapScript.galaxy has no script for the Kept trigger ${reference.id} ("${name}", ${scriptName}): save the map in the Editor so it writes one, then compile again`);
    }
    return { ...reference, name, scriptName };
  });
  // The copy is compiled with the Plugins and Catalog its original was validated against.
  return bindLikeOriginal({ ...blueprint, kept }, blueprint);
}

/** The Kept triggers' and globals' Galaxy names (gt_, gv_), each with its element Id: every one in Triggers but `compiled` (by element key). */
export async function keptScriptNames(mapDir: string, compiled: ReadonlySet<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const element of await triggerElements(mapDir)) if (!compiled.has(recordedItemKey(element)) && element.scriptName !== undefined) out.set(element.scriptName, element.id);
  return out;
}

/**
 * Refuses a Compiled trigger or global whose Galaxy name a Kept one has: the two would clash in
 * MapScript.galaxy. A global's is compared with its first letter lower case, since the splice
 * matches a global in either case (gv_Flare, a Kept Identifier, is gv_flare's). `compiled` is the
 * previous compile's triggers and globals, by element key (recordedItemKey).
 */
export async function refuseKeptScriptNames(mapDir: string, compiled: ReadonlySet<string>, triggers: TriggerDocument): Promise<void> {
  const kept = new Map([...(await keptScriptNames(mapDir, compiled))].map(([name, id]) => [editorForm(name), { name, id }]));
  if (kept.size === 0) return;
  const named = [
    ...triggers.triggers.map((trigger) => ({ name: trigger.name, script: editorTriggerName(trigger.name), what: "trigger" })),
    ...triggers.variables.map((variable) => ({ name: variable.name, script: editorGlobalName(variable.name), what: "variable" })),
  ];
  for (const { name, script, what } of named) {
    const clash = kept.get(script);
    if (!clash) continue;
    const same = clash.name === script ? "" : ` (as ${clash.name}, which the splice can't tell from it)`;
    throw new Error(`The compile's ${what} "${name}" would have the script name ${script}, which Kept ${what} ${clash.id} has${same}: rename one of them. Not compiled.`);
  }
}
