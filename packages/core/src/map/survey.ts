// A survey of a Mission's Kept Content (ADR-0010): what its Map Package holds, read from the
// package each time and never stored. Anything on the compile record is marked Compiled.

import { existsSync } from "node:fs";
import path from "node:path";

import type { RegionShape } from "../domain/mission-blueprint.js";
import { type CompileRecord, EMPTY_COMPILE_RECORD } from "../domain/compile-record.js";
import { CONVERSATION_DATA, CUTSCENES_DIR, cutsceneLineElements, gameDataEntries, type PackageConversations, packageFiles, readConversations, readPackageText as read, triggerStringNames } from "./kept-package.js";
import { triggerElementsIn } from "./kept-references.js";
import { missionMapPackage, readCompileRecord } from "./mission-package.js";
import { type PlacedDoodad, readObjectsXml, type Vec3 } from "./read-objects-xml.js";
import { type EditorRegion, readRegionsXml, regionBounds } from "./read-regions-xml.js";
import { xmlElements } from "./xml-elements.js";

export type SurveyUnit = { readonly id: number; readonly type: string; readonly player: number; readonly position: Vec3; readonly compiled: boolean };
export type SurveyPoint = { readonly id: number; readonly name?: string; readonly type?: string; readonly position: Vec3; readonly compiled: boolean };
export type SurveyCamera = { readonly id: number; readonly name: string; readonly position: Vec3; readonly compiled: boolean };

export type SurveyDoodad = { readonly id: number; readonly type: string; readonly name?: string; readonly position: Vec3; readonly compiled: boolean };
/** Doodads: unnamed ones counted by type (`compiled` of them on the record), named ones listed. */
export type SurveyDoodads = {
  readonly count: number;
  readonly byType: readonly { readonly type: string; readonly count: number; readonly compiled: number }[];
  readonly named: readonly SurveyDoodad[];
  /** Every doodad, named or not, when the survey is of an area; `byType` then counts them all. */
  readonly listed?: readonly SurveyDoodad[];
};
export type SurveyRegion = { readonly id: number; readonly name: string; readonly shapes: readonly RegionShape[]; readonly compiled: boolean };

export type SurveyTrigger = {
  readonly id: string;
  readonly name: string;
  /** Each event as MapScript.galaxy adds it, without `TriggerAddEvent` and the trigger, and the regions and points it names. */
  readonly events: readonly string[];
  /**
   * Enabled events in Triggers that MapScript.galaxy doesn't have yet: the Editor hasn't saved the
   * map since they were added. Not counted for a disabled trigger, which the Editor writes no Galaxy for.
   */
  readonly unsavedEvents?: number;
  readonly disabled?: true;
  readonly initiallyOff?: true;
  readonly compiled: boolean;
};
export type SurveyNamed = { readonly id: string; readonly name: string };
/** An item of a type the survey doesn't look into, such as a Custom Script (hand-written Galaxy): its Triggers type. */
export type SurveyOther = SurveyNamed & { readonly type: string };
/** One trigger category (`path` from Root; [] is Root itself) and what is filed in it, in the Editor's order. */
export type SurveyCategory = {
  readonly path: readonly string[];
  readonly triggers: readonly SurveyTrigger[];
  readonly functions: readonly SurveyNamed[];
  readonly structs: readonly SurveyNamed[];
  readonly presets: readonly SurveyNamed[];
  readonly variables: readonly (SurveyNamed & { readonly compiled: boolean })[];
  /** Items of any other type, such as Custom Scripts. */
  readonly others: readonly SurveyOther[];
};

/** A conversation line a cutscene plays, at `start` ms; `missing` when the package has no such conversation line. */
export type SurveyCutsceneLine = {
  readonly conversation: string;
  readonly line: string;
  readonly start: number;
  readonly speaker?: string;
  readonly text?: string;
  readonly missing?: true;
};
/**
 * A cutscene and the lines it plays: its Conversation Driver's, or with no driver its actors'
 * conversation entries. `notOnDriver` lists actors' entries the driver doesn't play.
 */
export type SurveyCutscene = {
  readonly name: string;
  readonly lines: readonly SurveyCutsceneLine[];
  readonly notOnDriver?: readonly SurveyCutsceneLine[];
  readonly compiled: boolean;
};
export type SurveyConversation = { readonly id: string; readonly lines: number; readonly compiled: boolean };
/** A GameData file's catalog entries, in its order. */
export type SurveyCatalogFile = { readonly file: string; readonly entries: readonly { readonly type: string; readonly id: string; readonly compiled: boolean }[] };

/** What the survey lists. Units, points, cameras, doodads and regions have a place; the rest don't. */
export const SURVEY_KINDS = ["unit", "point", "camera", "doodad", "region", "trigger", "cutscene", "conversation", "catalog"] as const;
export type SurveyKind = (typeof SURVEY_KINDS)[number];
const PLACED: ReadonlySet<SurveyKind> = new Set(["unit", "point", "camera", "doodad", "region"]);

/** An area of the map, x0 ≤ x ≤ x1 and y0 ≤ y ≤ y1. */
export type SurveyArea = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

export type SurveyOptions = {
  /** Only these kinds; by default every kind, or with an area every kind with a place. */
  readonly kinds?: readonly SurveyKind[];
  /** Only what lies in this area: corners, or a region's name or id (its bounds). Doodads in it are listed one by one. */
  readonly area?: SurveyArea | string;
};

/** The survey: a section for each kind listed, absent for a kind left out. */
export type Survey = {
  readonly mapPackage: string;
  readonly area?: SurveyArea;
  readonly units?: readonly SurveyUnit[];
  readonly points?: readonly SurveyPoint[];
  readonly cameras?: readonly SurveyCamera[];
  readonly doodads?: SurveyDoodads;
  readonly regions?: readonly SurveyRegion[];
  readonly triggers?: readonly SurveyCategory[];
  readonly cutscenes?: readonly SurveyCutscene[];
  readonly conversations?: readonly SurveyConversation[];
  readonly catalog?: readonly SurveyCatalogFile[];
};

/** The ids of `kind` on the record's entries: Compiled Content. What the author kept from a compile is Kept. */
function compiledIds(record: CompileRecord, kind: "object" | "region" | "trigger" | "variable"): Set<number | string> {
  return new Set(record.entries.flatMap((entry) => (entry.kind === kind ? [entry.id] : [])));
}

/** Unnamed doodads (every one, in an area) counted by type, most first (ties in the order they first appear); named ones listed. */
function surveyDoodads(doodads: readonly PlacedDoodad[], compiled: ReadonlySet<number | string>, listAll: boolean): SurveyDoodads {
  const byType = new Map<string, { type: string; count: number; compiled: number }>();
  const named: SurveyDoodad[] = [];
  for (const { id, type, name, position } of doodads) {
    if (name) {
      named.push({ id, type, name, position, compiled: compiled.has(id) });
      if (!listAll) continue;
    }
    const entry = byType.get(type) ?? byType.set(type, { type, count: 0, compiled: 0 }).get(type)!;
    entry.count += 1;
    if (compiled.has(id)) entry.compiled += 1;
  }
  const listed = listAll ? doodads.map(({ id, type, name, position }) => ({ id, type, ...(name ? { name } : {}), position, compiled: compiled.has(id) })) : undefined;
  return { count: doodads.length, byType: [...byType.values()].sort((a, b) => b.count - a.count), named, ...(listed ? { listed } : {}) };
}

/** Each trigger's events in MapScript.galaxy, by its Galaxy name, with the trigger argument left out. */
function galaxyEvents(script: string): Map<string, string[]> {
  const events = new Map<string, string[]>();
  for (const match of script.matchAll(/^[ \t]*TriggerAddEvent(\w+)\((gt_\w+)(?:, ?(.*))?\);[ \t]*\r?$/gm)) {
    const list = events.get(match[2]!) ?? events.set(match[2]!, []).get(match[2]!)!;
    list.push(`${match[1]}(${match[3] ?? ""})`);
  }
  return events;
}

type Names = { readonly regions: ReadonlyMap<number, string>; readonly points: ReadonlyMap<number, string> };

/** An event with the regions and points it names after it: `UnitRegion(null, RegionFromId(1), true) (region 1 "Yard")`. */
function namedEvent(event: string, { regions, points }: Names): string {
  const named = [...event.matchAll(/\b(Region|Point)FromId\((\d+)\)/g)].map(([, kind, id]) => {
    const name = (kind === "Region" ? regions : points).get(Number(id));
    return `${kind!.toLowerCase()} ${id}${name === undefined ? "" : ` "${name}"`}`;
  });
  return named.length ? `${event} (${named.join(", ")})` : event;
}

/** The package's triggers, by category from Root, with what else is filed beside them. */
function surveyTriggers(triggersXml: string, strings: string, script: string, record: CompileRecord, names: Names): SurveyCategory[] {
  if (!triggersXml) return [];
  const elements = new Map(xmlElements(triggersXml, "Element").map((element) => [`${element.attrs.Type}:${element.attrs.Id}`, element.body]));
  const labels = triggerStringNames(strings);
  // A trigger with neither a name nor an Identifier has no Galaxy name we can know, so no events to find.
  const scriptNames = new Map(triggerElementsIn(triggersXml, strings).flatMap((element) => (element.kind === "trigger" && element.scriptName !== undefined ? [[element.id, element.scriptName] as const] : [])));
  const events = galaxyEvents(script);
  const compiledTriggers = compiledIds(record, "trigger");
  const compiledVariables = compiledIds(record, "variable");
  const nameOf = (type: string, id: string): string => labels.get(`${type}:${id}`) ?? id;
  const items = (body: string): { type: string; id: string }[] => [...body.matchAll(/<Item Type="(\w+)" Id="([0-9A-F]{8})"\/>/g)].map(([, type, id]) => ({ type: type!, id: id! }));
  const out: SurveyCategory[] = [];
  const visit = (categoryPath: readonly string[], body: string): void => {
    const category = { path: categoryPath, triggers: [] as SurveyTrigger[], functions: [] as SurveyNamed[], structs: [] as SurveyNamed[], presets: [] as SurveyNamed[], variables: [] as (SurveyNamed & { compiled: boolean })[], others: [] as SurveyOther[] };
    out.push(category);
    const below: { type: string; id: string }[] = [];
    for (const item of items(body)) {
      const name = nameOf(item.type, item.id);
      if (item.type === "Trigger") {
        const element = elements.get(`Trigger:${item.id}`) ?? "";
        const scriptName = scriptNames.get(item.id);
        const found = (scriptName === undefined ? [] : (events.get(scriptName) ?? [])).map((event) => namedEvent(event, names));
        const disabled = /<Disabled\/>/.test(element);
        // The Editor leaves a disabled event out of the Galaxy, and a disabled trigger altogether.
        const inXml = disabled || scriptName === undefined ? 0 : [...element.matchAll(/<Event Type="FunctionCall" Id="([0-9A-F]{8})"\/>/g)].filter(([, id]) => !/<Disabled\/>/.test(elements.get(`FunctionCall:${id}`) ?? "")).length;
        category.triggers.push({
          id: item.id,
          name,
          events: found,
          ...(inXml > found.length ? { unsavedEvents: inXml - found.length } : {}),
          ...(disabled ? { disabled: true as const } : {}),
          ...(/<InitOff\/>/.test(element) ? { initiallyOff: true as const } : {}),
          compiled: compiledTriggers.has(item.id),
        });
      } else if (item.type === "FunctionDef") category.functions.push({ id: item.id, name });
      else if (item.type === "Structure") category.structs.push({ id: item.id, name });
      else if (item.type === "Preset") category.presets.push({ id: item.id, name });
      else if (item.type === "Variable") category.variables.push({ id: item.id, name, compiled: compiledVariables.has(item.id) });
      else if (item.type === "Category") below.push(item);
      else category.others.push({ type: item.type, id: item.id, name });
    }
    for (const item of below) visit([...categoryPath, nameOf("Category", item.id)], elements.get(`Category:${item.id}`) ?? "");
  };
  visit([], /<Root>([\s\S]*?)<\/Root>/.exec(triggersXml)?.[1] ?? "");
  return out;
}

/** The package's cutscenes, each with the conversation lines it plays, in the order it plays them. */
async function surveyCutscenes(mapDir: string, conversations: PackageConversations, compiledFiles: ReadonlySet<string>): Promise<SurveyCutscene[]> {
  const dir = path.join(mapDir, CUTSCENES_DIR);
  const line = ({ conversation, line: id, start }: { readonly conversation: string; readonly line: string; readonly start: number }): SurveyCutsceneLine => {
    const found = conversations.get(conversation)?.get(id);
    return { conversation, line: id, start, ...(found ? { ...(found.speaker ? { speaker: found.speaker } : {}), ...(found.text !== undefined ? { text: found.text } : {}) } : { missing: true as const }) };
  };
  const byStart = (a: SurveyCutsceneLine, b: SurveyCutsceneLine): number => a.start - b.start;
  const out: SurveyCutscene[] = [];
  for (const file of await packageFiles(dir, ".SC2Cutscene")) {
    // The Conversation Driver plays the lines; each speaking actor holds its own entry for lip-sync.
    const elements = cutsceneLineElements(await read(path.join(dir, file)));
    const driven = elements.driven.map(line);
    const onActors = elements.onActors.map(line);
    const played = new Set(driven.map((item) => `${item.conversation}/${item.line}`));
    const notOnDriver = driven.length ? onActors.filter((item) => !played.has(`${item.conversation}/${item.line}`)).sort(byStart) : [];
    out.push({
      name: file.replace(/\.SC2Cutscene$/, ""),
      lines: (driven.length ? driven : onActors).sort(byStart),
      ...(notOnDriver.length ? { notOnDriver } : {}),
      compiled: compiledFiles.has(`${CUTSCENES_DIR}/${file}`),
    });
  }
  return out;
}

/** The package's GameData catalog entries, by file. */
async function surveyCatalog(mapDir: string, record: CompileRecord, compiledFiles: ReadonlySet<string>): Promise<SurveyCatalogFile[]> {
  const dir = path.join(mapDir, "Base.SC2Data", "GameData");
  const compiledEntries = new Set(record.entries.flatMap((entry) => (entry.kind === "catalog-entry" ? [`${entry.file}:${entry.id}`] : [])));
  const out: SurveyCatalogFile[] = [];
  for (const file of await packageFiles(dir, ".xml")) {
    const where = `Base.SC2Data/GameData/${file}`;
    const entries = gameDataEntries(await read(path.join(dir, file))).map(({ type, id }) => ({
      type,
      id,
      compiled: compiledFiles.has(where) || compiledEntries.has(`${where}:${id}`),
    }));
    if (entries.length) out.push({ file, entries });
  }
  return out;
}

/** A kind the survey lists, refusing one it doesn't know. */
export function surveyKind(kind: string): SurveyKind {
  if (!(SURVEY_KINDS as readonly string[]).includes(kind)) throw new Error(`${kind} isn't a kind the survey lists: ${SURVEY_KINDS.join(", ")}`);
  return kind as SurveyKind;
}

/** The kinds to list: those asked for, or by default every kind, or with an area every kind with a place. */
function surveyKinds(options: SurveyOptions): Set<SurveyKind> {
  for (const kind of options.kinds ?? []) surveyKind(kind);
  if (options.kinds?.length) return new Set(options.kinds);
  return new Set(options.area === undefined ? SURVEY_KINDS : PLACED);
}

const CORNERS = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

/** An area given as corners (in any order), as "x0,y0,x1,y1", or as a region's name or id: its bounds. */
function resolveArea(area: SurveyArea | string, regions: readonly EditorRegion[], mapDir: string): SurveyArea {
  const corners = typeof area === "string" ? CORNERS.exec(area)?.slice(1).map(Number) : [area.x0, area.y0, area.x1, area.y1];
  if (corners) {
    const [ax, ay, bx, by] = corners as [number, number, number, number];
    return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
  }
  const name = area as string;
  if (!name.trim()) throw new Error("an area can't be empty: give a region's name or id, or an area as x0,y0,x1,y1");
  // An unnamed region has the name "", which no area names.
  const region = regions.find((candidate) => candidate.name !== "" && candidate.name === name) ?? regions.find((candidate) => String(candidate.id) === name.trim());
  if (!region) throw new Error(`${path.basename(mapDir)} has no region "${name}": give a region's name or id, or an area as x0,y0,x1,y1`);
  if (!region.shapes.some((shape) => !shape.negative)) throw new Error(`region ${region.id} "${region.name}" has only negative shapes, so it gives no area: give another region, or x0,y0,x1,y1`);
  const [x0, y0, x1, y1] = regionBounds(region.shapes);
  return { x0, y0, x1, y1 };
}

const inArea = (area: SurveyArea | undefined, { x, y }: { readonly x: number; readonly y: number }): boolean => !area || (x >= area.x0 && x <= area.x1 && y >= area.y0 && y <= area.y1);

/** A region whose shapes' bounds meet the area. */
function regionInArea(area: SurveyArea | undefined, region: EditorRegion): boolean {
  if (!area) return true;
  if (!region.shapes.some((shape) => !shape.negative)) return false;
  const [x0, y0, x1, y1] = regionBounds(region.shapes);
  return x0 <= area.x1 && x1 >= area.x0 && y0 <= area.y1 && y1 >= area.y0;
}

/** Surveys the Map Package at `mapDir` against its compile record. */
export async function surveyPackage(mapDir: string, record: CompileRecord, options: SurveyOptions = {}): Promise<Survey> {
  const kinds = surveyKinds(options);
  const objects = readObjectsXml(await read(path.join(mapDir, "Objects")));
  const regions = readRegionsXml(await read(path.join(mapDir, "Regions")));
  const area = options.area === undefined ? undefined : resolveArea(options.area, regions, mapDir);
  const compiledObjects = compiledIds(record, "object");
  const compiledRegions = compiledIds(record, "region");
  const compiledFiles = new Set(record.entries.flatMap((entry) => (entry.kind === "file" ? [entry.path] : [])));
  const localized = path.join(mapDir, "enUS.SC2Data", "LocalizedData");
  const here = <T extends { readonly position: Vec3 }>(items: readonly T[]): T[] => items.filter((item) => inArea(area, item.position));
  const survey: { -readonly [K in keyof Survey]: Survey[K] } = { mapPackage: mapDir, ...(area ? { area } : {}) };
  if (kinds.has("unit")) survey.units = here(objects.units).map(({ id, type, player, position }) => ({ id, type, player, position, compiled: compiledObjects.has(id) }));
  if (kinds.has("point")) survey.points = here(objects.points).map(({ id, name, type, position }) => ({ id, ...(name ? { name } : {}), ...(type ? { type } : {}), position, compiled: compiledObjects.has(id) }));
  if (kinds.has("camera")) survey.cameras = here(objects.cameras).map(({ id, name, position }) => ({ id, name, position, compiled: compiledObjects.has(id) }));
  if (kinds.has("doodad")) survey.doodads = surveyDoodads(here(objects.doodads), compiledObjects, area !== undefined);
  if (kinds.has("region")) survey.regions = regions.filter((region) => regionInArea(area, region)).map(({ id, name, shapes }) => ({ id, name, shapes, compiled: compiledRegions.has(id) }));
  if (kinds.has("trigger")) {
    const names: Names = {
      regions: new Map(regions.map((region) => [region.id, region.name])),
      points: new Map([...objects.points, ...objects.cameras].flatMap((point) => (point.name ? [[point.id, point.name] as const] : []))),
    };
    survey.triggers = surveyTriggers(await read(path.join(mapDir, "Triggers")), await read(path.join(localized, "TriggerStrings.txt")), await read(path.join(mapDir, "MapScript.galaxy")), record, names);
  }
  if (kinds.has("cutscene") || kinds.has("conversation")) {
    const conversations = readConversations(await read(path.join(mapDir, CONVERSATION_DATA)), await read(path.join(localized, "ConversationStrings.txt")));
    if (kinds.has("cutscene")) survey.cutscenes = await surveyCutscenes(mapDir, conversations, compiledFiles);
    if (kinds.has("conversation")) {
      const compiled = (id: string): boolean => compiledFiles.has(CONVERSATION_DATA) || record.entries.some((entry) => entry.kind === "catalog-entry" && entry.file === CONVERSATION_DATA && entry.id === id);
      survey.conversations = [...conversations].map(([id, lines]) => ({ id, lines: lines.size, compiled: compiled(id) }));
    }
  }
  if (kinds.has("catalog")) survey.catalog = await surveyCatalog(mapDir, record, compiledFiles);
  return survey;
}

/** Surveys a Mission's own Map Package, beside its Blueprint. */
export async function surveyMission(blueprintPath: string, options: SurveyOptions = {}): Promise<Survey> {
  const mapDir = await missionMapPackage(blueprintPath);
  if (!existsSync(mapDir)) throw new Error(`${path.dirname(blueprintPath)} has no Map Package to survey: import one (import-map) or compile the Mission first`);
  return surveyPackage(mapDir, (await readCompileRecord(blueprintPath)) ?? EMPTY_COMPILE_RECORD, options);
}

const num = (value: number): string => String(Number(value.toFixed(4)));
const at = ({ x, y }: { readonly x: number; readonly y: number }): string => `(${num(x)}, ${num(y)})`;
const at3 = ({ x, y, z }: Vec3): string => `(${num(x)}, ${num(y)}, ${num(z)})`;
const mark = (compiled: boolean): string => (compiled ? " [Compiled]" : "");
const plural = (count: number, one: string): string => `${count} ${one}${count === 1 ? "" : "s"}`;

function shapeText(shape: RegionShape): string {
  const text =
    shape.type === "rect"
      ? `rect ${at({ x: shape.quad[0], y: shape.quad[1] })}-${at({ x: shape.quad[2], y: shape.quad[3] })}`
      : shape.type === "circle"
        ? `circle ${at(shape.center)} radius ${num(shape.radius)}`
        : `diamond ${at(shape.center)} ${num(shape.width)}x${num(shape.height)}`;
  return shape.negative ? `minus ${text}` : text;
}

/** A Triggers item type as the survey names it: CustomScript is "custom script". */
const otherLabel = (type: string): string => type.replace(/(?<=[a-z])(?=[A-Z])/g, " ").toLowerCase();

function triggerText(trigger: SurveyTrigger): string {
  const states = [...(trigger.disabled ? ["disabled"] : []), ...(trigger.initiallyOff ? ["initially off"] : [])];
  const events = [
    ...trigger.events,
    ...(trigger.unsavedEvents ? [`${plural(trigger.unsavedEvents, "event")} not in MapScript.galaxy yet (save the map in the Editor)`] : []),
  ];
  return `${trigger.name} (${trigger.id})${states.map((state) => `, ${state}`).join("")}: ${events.length ? events.join("; ") : "no events"}${mark(trigger.compiled)}`;
}

/** The survey as lines of text, for the CLI and the MCP tool. */
export function formatSurvey(survey: Survey): string[] {
  const where = survey.area ? ` in ${at({ x: survey.area.x0, y: survey.area.y0 })}-${at({ x: survey.area.x1, y: survey.area.y1 })}` : "";
  const out = [`Kept Content of ${path.basename(survey.mapPackage)}${where} ([Compiled] is on the compile record; everything else is Kept)`];
  const section = <T>(title: string, items: readonly T[] | undefined, line: (item: T) => string | string[]): void => {
    if (!items) return;
    out.push(items.length ? `${title} (${items.length})` : `${title}: none`);
    for (const item of items) for (const text of [line(item)].flat()) out.push(`  ${text}`);
  };
  section("Units", survey.units, (unit) => `${unit.id} ${unit.type}, player ${unit.player}, at ${at(unit.position)}${mark(unit.compiled)}`);
  section("Points", survey.points, (point) => `${point.id}${point.name ? ` "${point.name}"` : ""}${point.type ? ` (${point.type})` : ""} at ${at(point.position)}${mark(point.compiled)}`);
  section("Cameras", survey.cameras, (camera) => `${camera.id} "${camera.name}" at ${at(camera.position)}${mark(camera.compiled)}`);
  if (survey.doodads) {
    const { count, byType, named, listed } = survey.doodads;
    const counts = byType.map((entry) => `${entry.count} ${entry.type}${entry.compiled ? ` (${entry.compiled} Compiled)` : ""}`).join(", ");
    const doodad = (item: SurveyDoodad): string => `  ${item.id}${item.name ? ` "${item.name}"` : ""} ${item.type} at ${at3(item.position)}${mark(item.compiled)}`;
    if (count === 0) out.push("Doodads: none");
    else if (listed) out.push(`Doodads (${count}): ${counts}`, ...listed.map(doodad));
    else out.push(`Doodads (${count}): ${counts}${named.length ? `${counts ? "; " : ""}named:` : ""}`, ...named.map(doodad));
  }
  section("Regions", survey.regions, (region) => `${region.id} "${region.name}": ${region.shapes.map(shapeText).join(", ") || "no shapes"}${mark(region.compiled)}`);
  if (survey.triggers) {
    const lines: string[] = [];
    const counts = new Map<string, number>();
    const count = (what: string, items: readonly unknown[]): void => void counts.set(what, (counts.get(what) ?? 0) + items.length);
    for (const category of survey.triggers) {
      const items = [
        ...category.functions.map((item) => `function ${item.name} (${item.id})`),
        ...category.structs.map((item) => `struct ${item.name} (${item.id})`),
        ...category.presets.map((item) => `preset ${item.name} (${item.id})`),
        ...category.variables.map((item) => `variable ${item.name} (${item.id})${mark(item.compiled)}`),
        ...category.others.map((item) => `${otherLabel(item.type)} ${item.name} (${item.id})`),
        ...category.triggers.map(triggerText),
      ];
      count("trigger", category.triggers);
      count("function", category.functions);
      count("struct", category.structs);
      count("preset", category.presets);
      count("variable", category.variables);
      for (const item of category.others) count(otherLabel(item.type), [item]);
      if (items.length === 0) continue;
      lines.push(`  ${category.path.length ? category.path.join(" > ") : "Root"}`, ...items.map((item) => `    ${item}`));
    }
    const listed = [...counts].filter(([, n]) => n > 0).map(([what, n]) => plural(n, what));
    out.push(lines.length ? `Triggers (${listed.join(", ")})` : "Triggers: none", ...lines);
  }
  const missing = (line: SurveyCutsceneLine): string => (line.missing ? " (not in this package)" : "");
  section("Cutscenes", survey.cutscenes, (cutscene) => [
    `${cutscene.name}: ${cutscene.lines.length ? plural(cutscene.lines.length, "line") : "no lines"}${mark(cutscene.compiled)}`,
    ...cutscene.lines.map(
      (line) => `  ${(line.start / 1000).toFixed(1)}s ${line.conversation}/${line.line}${line.missing ? ": not in this package" : `${line.speaker ? ` ${line.speaker}` : ""}: ${line.text ?? "(no text)"}`}`,
    ),
    ...(cutscene.notOnDriver ? [`  on an actor, not the Conversation Driver: ${cutscene.notOnDriver.map((line) => `${line.conversation}/${line.line}${missing(line)}`).join(", ")}`] : []),
  ]);
  section("Conversations", survey.conversations, (conversation) => `${conversation.id}: ${plural(conversation.lines, "line")}${mark(conversation.compiled)}`);
  if (survey.catalog) {
    const total = survey.catalog.reduce((sum, file) => sum + file.entries.length, 0);
    out.push(total ? `Catalog entries (${total})` : "Catalog entries: none");
    for (const file of survey.catalog) {
      const byType = new Map<string, string[]>();
      for (const entry of file.entries) (byType.get(entry.type) ?? byType.set(entry.type, []).get(entry.type)!).push(`${entry.id}${mark(entry.compiled)}`);
      out.push(`  ${file.file}: ${[...byType].map(([type, ids]) => `${type} ${ids.join(", ")}`).join("; ")}`);
    }
  }
  return out;
}
