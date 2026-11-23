// The convert step for a Mission's Kept triggers (ADR-0026): it reads chosen Kept triggers of the
// Map Package into the Mission Blueprint's own trigger elements, one file each in `triggers/`,
// keeping their element Ids, names and text values' words. A trigger stays where the package files
// it: a Kept folder keeps filing it, and the compile writes it in place of the Kept one, its Root
// line and elements where the Editor had them. The next compile writes each over the Kept original
// under the Equivalence Check (its Triggers XML and Galaxy compared with the Editor's), which moves
// it from Kept to Compiled.
//
// A trigger converts only when it can be read back as it is and written as the Editor writes it,
// and everything it names is in reach: a library's function in the library data in reach of the
// map, a bare Id among the package's Kept elements or the Blueprint's. Custom script, in a call or a
// value, is kept as data. One that can't convert stays Kept, with why.
//
// Kept References and holds keep working on a converted trigger: they name it by its element Id
// and Galaxy name, which it keeps.
//
// convertKeptTriggers is the pure part, over the package's files as text: the coverage script
// (scripts/trigger-coverage.mjs) runs it over maps with no Workspace around them.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { BlueprintTriggerSchema, type BlueprintTrigger } from "../domain/blueprint-trigger.js";
import { type GuiCall, type GuiStatement, isComment } from "../domain/library-interface.js";
import { type GameLibrary, gameTriggerLibraries } from "../mods/library-galaxy.js";
import { difference } from "../mods/equivalence.js";
import { mapElements, readMapTrigger, stringTable, UnconvertibleFunctionError } from "../mods/library-xml.js";
import { type Workspace, parseMissionBlueprint } from "../plugins/workspace.js";
import { type AuthoredTrigger, type AuthoredTriggers, blueprintReferenceProblems, blueprintTriggerFile, blueprintTriggerIds, blueprintTriggerXml, readAuthoredTriggers, unknownParts } from "../triggers/blueprint-triggers.js";
import { KeptGalaxyRenderer, textValueKeys } from "../triggers/kept-trigger-galaxy.js";
import { keptElementSpan } from "../triggers/splice-map-script.js";
import { libraryItems, recordedItemKeys } from "../triggers/splice-triggers.js";
import { CORE_PRIMITIVES } from "../triggers/trigger-catalog.js";
import { readTriggersFile, triggerStringNames } from "../triggers/triggers-file.js";
import { TRIGGER_STRINGS } from "./editor-changes.js";
import { missionLibraries } from "./compile-mission.js";
import { missionMapPackage, readCompileRecord } from "./mission-package.js";

export type ConvertMissionTriggersOptions = {
  /** The Kept triggers to convert, each by its name or element Id; every Kept one that can convert when not given. */
  readonly triggers?: readonly string[];
  /** The libraries in reach of the map; the game's and the Workspace mods' its dependencies load when not given. */
  readonly libraries?: Readonly<Record<string, GameLibrary>>;
};

export type ConvertedMissionTriggers = {
  /** Each trigger converted, in the package's order: its name, element Id and file (relative to the Blueprint). */
  readonly converted: readonly { readonly name: string; readonly id: string; readonly file: string }[];
  /** Each one left Kept, with why. */
  readonly refused: readonly { readonly trigger: string; readonly reason: string }[];
};

/** A Map Package's trigger files as text: Triggers, the enUS TriggerStrings, MapScript.galaxy, and each locale's GameStrings by its path inside the package. */
export type KeptPackageFiles = {
  readonly triggers: string;
  readonly triggerStrings: string;
  readonly script: string;
  readonly gameStrings: ReadonlyMap<string, string>;
};

/** What a conversion is checked against, beside the package's files. */
export type KeptConversionContext = {
  /** The Kept triggers to convert, each by its name or element Id; every Kept one when not given. */
  readonly triggers?: readonly string[];
  /** The libraries in reach of the map; the game's when not given. */
  readonly libraries?: Readonly<Record<string, GameLibrary>>;
  /** The items the last compile wrote, by element key (`<type>/<id>`, as recordedItemKeys gives them), which aren't Kept. */
  readonly compiled?: ReadonlySet<string>;
  /** The Kept triggers a hold switched a call off in (the record's kept-hold Ids). */
  readonly held?: ReadonlySet<string>;
  /** The Blueprint's own trigger elements. */
  readonly authored?: AuthoredTriggers;
  /** Whether a file (relative to the Blueprint) is taken already, so a converted trigger is given another. */
  readonly fileTaken?: (file: string) => boolean;
};

/** Which Kept triggers convert, as convertMissionTriggers would write them, and what stays Kept. */
export type KeptTriggerConversion = {
  /** Each trigger that converts, in the package's order: its name, element Id, the file it would be written to, and its Blueprint element. */
  readonly converted: readonly { readonly name: string; readonly id: string; readonly file: string; readonly trigger: BlueprintTrigger }[];
  /** Each one left Kept, with why. */
  readonly refused: readonly { readonly trigger: string; readonly id: string; readonly reason: string }[];
  /** Each Kept item of a kind that doesn't convert yet (a function, a global, a folder, …): its type in Triggers, Id and name. Listed only when no triggers were asked for. */
  readonly notYetConvertible: readonly { readonly type: string; readonly id: string; readonly name: string }[];
};

/** A converted trigger's file name: its name in lower case, words joined by hyphens, as a Blueprint's files are. */
export const fileSlug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "trigger";

/** The package's GameStrings files, each locale's, by path inside the package. */
export async function gameStringsFiles(pkg: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!existsSync(pkg)) return out;
  for (const locale of (await readdir(pkg)).filter((name) => name.endsWith(".SC2Data") && name !== "Base.SC2Data").sort()) {
    const file = `${locale}/LocalizedData/GameStrings.txt`;
    const full = path.join(pkg, ...file.split("/"));
    if (existsSync(full)) out.set(file, await readFile(full, "utf8"));
  }
  return out;
}

/** Each locale's GameStrings' text (as gameStringsFiles gives them), enUS first: the locale the authoring tool reads a Kept function's text defaults from. */
export const enUSFirst = (files: ReadonlyMap<string, string>): string[] => [...files].sort(([a], [b]) => Number(b.startsWith("enUS")) - Number(a.startsWith("enUS"))).map(([, text]) => text);

const NO_AUTHORED: AuthoredTriggers = { triggers: [], folders: [] };

/** What a Mission's compile record gives a conversion: the items the last compile wrote, and the Kept triggers a hold switched a call off in. */
export const recordConversionContext = (entries: Parameters<typeof recordedItemKeys>[0]): Pick<KeptConversionContext, "compiled" | "held"> => ({
  compiled: recordedItemKeys(entries),
  held: new Set(entries.flatMap((entry) => (entry.kind === "kept-hold" ? [entry.id] : []))),
});

/**
 * Which of the package's Kept triggers convert into Blueprint elements, each read and checked as
 * above, writing nothing: each one that would, and each one left Kept with why. The Kept items of
 * the kinds that don't convert yet are listed apart.
 */
export function convertKeptTriggers(
  { triggers: xml, triggerStrings, script, gameStrings }: KeptPackageFiles,
  { triggers: asked, libraries = gameTriggerLibraries(), compiled = new Set(), held = new Set(), authored = NO_AUTHORED, fileTaken = () => false }: KeptConversionContext = {},
): KeptTriggerConversion {
  const strings = stringTable(triggerStrings);

  // The Kept items, in the package's order: every one filed in Root or a folder that no compile wrote and the Blueprint doesn't hold.
  const owned = new Set(authored.triggers.map(({ trigger }) => trigger.id));
  const items = [...libraryItems(xml)]
    .filter(([key, item]) => !compiled.has(key) && !(item.type === "Trigger" && owned.has(item.id)))
    .map(([, item]) => ({ ...item, name: strings.get(`${item.type}/Name/${item.id}`) ?? item.id }));
  const kept = items.filter((item) => item.type === "Trigger");
  const unknown = (asked ?? []).filter((wanted) => !kept.some((item) => item.id === wanted || item.name === wanted) && !authored.triggers.some(({ trigger }) => trigger.id === wanted || trigger.name === wanted));
  if (unknown.length > 0) throw new Error(`The Map Package has no Kept trigger ${unknown.join(", ")}`);
  const refused: { trigger: string; id: string; reason: string }[] = (asked ?? []).flatMap((wanted) => {
    const already = authored.triggers.find(({ trigger }) => trigger.id === wanted || trigger.name === wanted);
    return already ? [{ trigger: already.trigger.name, id: already.trigger.id, reason: `the Blueprint already holds it, in ${already.file}` }] : [];
  });
  const chosen = asked ? kept.filter((item) => asked.includes(item.id) || asked.includes(item.name)) : kept;

  const elements = mapElements(xml);
  const file = readTriggersFile(xml);
  const names = triggerStringNames(triggerStrings);
  const texts = textValueKeys(gameStrings.values());
  const renderer = new KeptGalaxyRenderer(file, names, { functions: CORE_PRIMITIVES.functions, presets: CORE_PRIMITIVES.presets }, texts, libraries);
  const keptTriggers = { triggers: xml, names, compiled };
  const taken = new Set(authored.triggers.map((each) => each.file.toLowerCase()));
  const read: { name: string; id: string; file: string; trigger: BlueprintTrigger }[] = [];
  for (const item of chosen) {
    const refuse = (reason: string): void => {
      refused.push({ trigger: item.name, id: item.id, reason });
    };
    let body: ReturnType<typeof readKeptTrigger>;
    try {
      body = readKeptTrigger(elements, strings, gameStrings, item.id, held);
    } catch (error) {
      if (!(error instanceof UnconvertibleFunctionError)) throw error;
      refuse(error.reason);
      continue;
    }
    const { asSaved, trigger } = body;
    let slug = fileSlug(trigger.name);
    for (let n = 2; taken.has(`triggers/${slug}.json`) || fileTaken(`triggers/${slug}.json`); n++) slug = `${fileSlug(trigger.name)}-${n}`;
    const target = `triggers/${slug}.json`;

    // What it names, in reach: the libraries in reach, the Kept elements and the Blueprint's.
    const entry: AuthoredTrigger = { file: target, trigger };
    const problems = blueprintReferenceProblems({ ...authored, triggers: [...authored.triggers, ...read.map(({ trigger: other, file: at }) => ({ file: at, trigger: other })), entry] }, keptTriggers, libraries);
    const prefix = `the Blueprint trigger "${trigger.name}" (${trigger.id}, ${target}) `;
    const own = problems.filter((problem) => problem.startsWith(prefix)).map((problem) => problem.slice(prefix.length));
    if (own.length > 0) {
      refuse(outOfReach(own));
      continue;
    }
    // Its XML as the Editor wrote it.
    const xmlNow = blueprintTriggerXml(asSaved).join("\n");
    const xmlDiffers = difference(`trigger:${trigger.id}`, item.elements.join("\n"), xmlNow);
    if (xmlDiffers) {
      refuse(`its XML would be written otherwise than the Editor's: ${xmlDiffers}`);
      continue;
    }
    // Its Galaxy as the Editor wrote it: the section the Kept renderer writes from its XML, or none for a disabled trigger.
    const section = renderer.renderTrigger(trigger.id);
    if (section === undefined) {
      refuse(`its Galaxy can't be written as the Editor does: it holds ${unknownParts(renderer.unknown)}`);
      continue;
    }
    if (section !== "") {
      const name = renderer.triggerName(trigger.id);
      const span = keptElementSpan(script, name);
      if (!span) {
        refuse(`MapScript.galaxy has no ${name}: save the map in the Editor so it writes one, then convert it`);
        continue;
      }
      const galaxyDiffers = difference(`galaxy:MapScript.galaxy:trigger:${name}`, script.slice(span.start, span.end), section);
      if (galaxyDiffers) {
        refuse(`its Galaxy would be written otherwise than the Editor's: ${galaxyDiffers}`);
        continue;
      }
    }
    BlueprintTriggerSchema.parse(trigger);
    taken.add(target);
    read.push({ name: trigger.name, id: trigger.id, file: target, trigger });
  }
  const notYetConvertible = asked ? [] : items.filter((item) => item.type !== "Trigger").map(({ type, id, name }) => ({ type, id, name }));
  return { converted: read, refused, notYetConvertible };
}

/** Converts chosen Kept triggers of the Mission's Map Package at `blueprintPath` into its Blueprint's own trigger elements, as above. */
export async function convertMissionTriggers(workspace: Workspace, blueprintPath: string, { triggers: asked, libraries: given }: ConvertMissionTriggersOptions = {}): Promise<ConvertedMissionTriggers> {
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const pkg = await missionMapPackage(blueprintPath);
  const record = await readCompileRecord(blueprintPath);
  if (!record) throw new Error(`${blueprintPath} has no compile record beside it: import the map with import_map, which writes an empty one`);
  const triggersFile = path.join(pkg, "Triggers");
  if (!existsSync(triggersFile)) throw new Error(`The Map Package ${pkg} has no Triggers, so no Kept trigger`);
  const optional = async (file: string): Promise<string> => (existsSync(file) ? readFile(file, "utf8") : "");
  const files: KeptPackageFiles = {
    triggers: await readFile(triggersFile, "utf8"),
    triggerStrings: await optional(path.join(pkg, ...TRIGGER_STRINGS.split("/"))),
    script: await optional(path.join(pkg, "MapScript.galaxy")),
    gameStrings: await gameStringsFiles(pkg),
  };
  const dir = path.dirname(blueprintPath);
  const listed = new Set((blueprint.triggers ?? []).map((each) => each.toLowerCase()));
  const { converted, refused } = convertKeptTriggers(files, {
    ...(asked ? { triggers: asked } : {}),
    libraries: given ?? (await missionLibraries(workspace, blueprint.dependencies ?? [])),
    ...recordConversionContext(record.entries),
    authored: await readAuthoredTriggers(blueprint, blueprintPath),
    fileTaken: (file) => listed.has(file) || existsSync(path.join(dir, ...file.split("/"))),
  });

  if (converted.length > 0) {
    await mkdir(path.join(dir, "triggers"), { recursive: true });
    for (const { trigger, file: at } of converted) await writeFile(path.join(dir, ...at.split("/")), blueprintTriggerFile(trigger));
    const raw = JSON.parse(await readFile(blueprintPath, "utf8")) as Record<string, unknown>;
    raw.triggers = [...((raw.triggers as string[] | undefined) ?? []), ...converted.map(({ file: at }) => at)];
    await writeFile(blueprintPath, `${JSON.stringify(raw, null, 2)}\n`);
  }
  return { converted: converted.map(({ name, id, file: at }) => ({ name, id, file: at })), refused: refused.map(({ trigger, reason }) => ({ trigger, reason })) };
}

/**
 * The package's Kept trigger `id` read back into a Blueprint element, as convert_triggers reads it:
 * as saved (`asSaved`), and as it converts (`trigger`): each call a hold switched off (`held`, ADR-0014)
 * back on, as the Editor saved it before the hold, and its text values' words from each locale's
 * GameStrings, keyed by the Param or expression holding them. Throws UnconvertibleFunctionError
 * where its XML can't be read.
 */
export function readKeptTrigger(
  elements: ReturnType<typeof mapElements>,
  strings: ReadonlyMap<string, string>,
  gameStrings: ReadonlyMap<string, string>,
  id: string,
  held: ReadonlySet<string>,
): { readonly asSaved: BlueprintTrigger; readonly trigger: BlueprintTrigger } {
  const asSaved: BlueprintTrigger = { kind: "trigger", ...readMapTrigger(elements, strings, id) };
  const trigger = withCallsOn(asSaved, held);
  const ids = new Set(blueprintTriggerIds(trigger));
  const words: Record<string, Record<string, string>> = {};
  for (const [gameStringsPath, text] of gameStrings) {
    for (const [key, value] of stringTable(text)) {
      const match = /^Param\/(?:Value|Expression)\/([0-9A-F]{8})$/.exec(key);
      if (match && ids.has(match[1]!)) (words[gameStringsPath] ??= {})[key] = value;
    }
  }
  return { asSaved, trigger: Object.keys(words).length > 0 ? { ...trigger, strings: words } : trigger };
}

/** `trigger` with each call of `ids` (statements, at any depth) switched back on. */
function withCallsOn(trigger: BlueprintTrigger, ids: ReadonlySet<string>): BlueprintTrigger {
  if (ids.size === 0) return trigger;
  const on = (statement: GuiStatement): GuiStatement => {
    if (isComment(statement)) return statement;
    const { disabled, ...rest } = statement;
    const call: GuiCall = ids.has(statement.id) ? rest : statement;
    return call.body ? { ...call, body: call.body.map(on) } : call;
  };
  return { ...trigger, events: trigger.events.map(on), conditions: trigger.conditions.map(on), actions: trigger.actions.map(on) };
}

/**
 * A trigger's reach problems as one reason: those out of reach for one cause (a library not in
 * reach) named by the first, with how many more, so a call's every parameter isn't listed.
 */
function outOfReach(problems: readonly string[]): string {
  const byWhy = new Map<string, string[]>();
  const other: string[] = [];
  for (const problem of problems) {
    const match = /^(.*?), which is out of reach: (.*)$/.exec(problem);
    if (match) byWhy.set(match[2]!, [...(byWhy.get(match[2]!) ?? []), match[1]!]);
    else other.push(problem);
  }
  return [...[...byWhy].map(([why, what]) => `it ${what[0]}${what.length > 1 ? ` (and ${what.length - 1} more of its parts)` : ""}, which is out of reach: ${why}`), ...other.map((problem) => `it ${problem}`)].join("; ");
}

/** What a conversion did, for the author: one line for what converted, one per trigger left Kept. */
export function formatConvertedMissionTriggers({ converted, refused }: ConvertedMissionTriggers): string {
  return [
    converted.length > 0 ? `Converted ${converted.length} Kept trigger${converted.length === 1 ? "" : "s"}: ${converted.map((item) => `${item.name} (${item.file})`).join(", ")}` : "Converted no Kept triggers",
    ...refused.map((item) => `Left Kept: ${item.trigger}: ${item.reason}`),
  ].join("\n");
}
