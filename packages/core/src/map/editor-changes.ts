// Compiled Content the author changed in the Editor (ADR-0010). Before a compile writes anything,
// each compile record entry's fingerprint is compared with the package: an entry the package no
// longer matches, and that the compile would write otherwise or remove, is a change the author
// decides on, keeping it (it leaves the record and becomes Kept Content) or discarding it (the
// compile overwrites it). A change the compile would write anyway, such as one sync brought back
// into the Blueprint, isn't one.
//
// What is compared: placed objects, regions, string keys, triggers, globals and catalog entries
// one by one, and files written whole (the terrain's read through the Editor's re-encoding,
// map/terrain-resave.ts). Not compared: what the Editor rewrites or derives on every save rather than
// what the author edits (the ComponentList, document and map info files, a mod library's Galaxy,
// the minimap and the components' .version stamps), and Galaxy blocks, which go with their trigger.
// MapScript.galaxy is compared when the record lists it whole (a compile with no Kept triggers):
// by its fingerprint, then by its form (galaxyForm: line endings, blank lines and comments set
// aside), and left out when a trigger changed too, since the Editor writes the script from Triggers.
// A record that doesn't list it (an older one, or a spliced script) compares nothing.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PLAY_SCRIPT_ID } from "../cutscene/compile-cutscene.js";
import { withoutCustomScriptInMapScript } from "../triggers/custom-script.js";
import { type CompileRecord, type CompileRecordEntry, entryName, fingerprint, type KeptEntry } from "../domain/compile-record.js";
import { LIBRARY_ITEM_TYPES } from "../domain/library-interface.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { libraryStringKey } from "../mods/library-xml.js";
import { ANGLE_TOLERANCE, angleApart, HEIGHT_TOLERANCE, POSITION_TOLERANCE } from "../sync/sync-shared.js";
import { compileFolderText, isSplicedKind, libraryItems, recordedItemKey, recordedItemKeys, type TriggersScope, triggerItemTexts } from "../triggers/splice-triggers.js";
import { canonicalXml } from "../util/xml.js";
import { catalogEntries } from "./catalog-entries.js";
import { LIGHTING_MAP, withTgaFooter } from "./light-regions.js";
import { objectElements, regionElements, stringLines } from "./package-elements.js";
import { normalObject } from "./read-objects-xml.js";
import { anchorObjectId } from "./stable-object-id.js";
import { RESAVED_TERRAIN_FILES, sameTerrainFile } from "./terrain-resave.js";
import { CELL_ATTRIBUTE_HEADER, PATHING_FILE } from "../terrain/write-cell-attribute.js";

/** A file's content as a compile queues it: text, bytes, or a file to copy (a voice line). */
type Content = string | Uint8Array | { readonly copyFrom: string };

/** One Compiled entry the Editor changed. */
export type EditorChange = {
  readonly entry: CompileRecordEntry;
  /** Its name on the command line (compile-map --keep <name>), such as `object:1234`. */
  readonly name: string;
  readonly change: "changed in the Editor" | "removed in the Editor" | "changed in the Editor, and the Blueprint no longer writes it";
  /** What the package calls it: an object's kind (doodad, unit …), a region's or trigger's name. */
  readonly label?: string;
};

/** What the author decided for each change: entry names (`object:1234`), or "all". */
export type EditorDecisions = { readonly keep?: readonly string[] | "all"; readonly discard?: readonly string[] | "all" };

/** The decisions from the CLI's flags or the MCP tools' fields: an entry named on its own wins over the other choice's "all". */
export function editorDecisions({ keep = [], discard = [], keepAll = false, discardAll = false }: { readonly keep?: readonly string[] | undefined; readonly discard?: readonly string[] | undefined; readonly keepAll?: boolean | undefined; readonly discardAll?: boolean | undefined }): EditorDecisions {
  if (keepAll && discardAll) throw new Error("Give --keep-all or --discard-all (keepAll or discardAll), not both");
  return {
    ...(keepAll ? { keep: "all" as const } : keep.length ? { keep } : {}),
    ...(discardAll ? { discard: "all" as const } : discard.length ? { discard } : {}),
  };
}

/** What the author decided for the change `name`: named on its own, which wins, else under "all"; none when undecided. */
export function editorDecision({ keep, discard }: EditorDecisions, name: string): "keep" | "discard" | undefined {
  const listed = (list: readonly string[] | "all" | undefined): boolean => Array.isArray(list) && list.includes(name);
  return listed(keep) ? "keep" : listed(discard) ? "discard" : keep === "all" ? "keep" : discard === "all" ? "discard" : undefined;
}

/** The compile stopped, writing nothing, because of `changes`: each needs keeping or discarding, or a sync. */
export class EditorChangesError extends Error {
  readonly changes: readonly EditorChange[];

  constructor(changes: readonly EditorChange[], message = formatEditorChanges(changes, [])) {
    super(message);
    this.changes = changes;
    this.name = "EditorChangesError";
  }
}

/** Files the Editor rewrites or derives on a save: a difference there isn't the author's edit. */
const DERIVED_FILES = new Set(["Triggers", "ComponentList.SC2Components", "DocumentHeader", "DocumentInfo", "MapInfo", "Minimap.tga"]);
/** The map's own script, which the Editor writes from Triggers: compared as a file only when the Triggers didn't change (see editorChanges). */
const MAP_SCRIPT = "MapScript.galaxy";

/**
 * A Galaxy script without what a save may change and the script doesn't mean: line endings, blank
 * lines, runs of spaces and comments. Two scripts with the same form run the same.
 */
export function galaxyForm(script: string): string {
  return script
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").replace(/[ \t]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** Whether the package's Triggers differ from the copy the record lists whole: the Editor then wrote MapScript.galaxy from new Triggers. */
async function triggersSavedSince(root: string, record: CompileRecord): Promise<boolean> {
  const entry = record.entries.find((each) => each.kind === "file" && each.path === "Triggers");
  if (!entry || entry.kind !== "file") return false;
  const full = path.join(root, "Triggers");
  return !existsSync(full) || fingerprint(await readFile(full)) !== entry.fingerprint;
}

/** A mod library's Galaxy (Base.SC2Data/Lib<id>.galaxy and its _h header), which the Editor generates from Triggers on every save, as a map's MapScript.galaxy. */
export const LIBRARY_SCRIPT = /^Base\.SC2Data\/Lib[A-Za-z0-9]+(_h)?\.galaxy$/;

export const TRIGGER_STRINGS = "enUS.SC2Data/LocalizedData/TriggerStrings.txt";

/**
 * Terrain files the Editor computes from others when it saves (the sync heights, textures and cliff
 * levels, and the cell flags): not asked about, they go with the file they come from, kept when a
 * terrain file is kept.
 */
export const DERIVED_TERRAIN_FILES = new Set(["t3SyncHeightMap", "t3SyncTextureInfo", "t3SyncCliffLevel", "t3CellFlags"]);

const OBJECT_KINDS: Record<string, string> = { ObjectDoodad: "doodad", ObjectUnit: "unit", ObjectPoint: "point", ObjectCamera: "camera" };

/**
 * The fingerprint a file the last compile didn't write stands on the record with (a pathing layer
 * the compile painted nothing in, write-map-package.ts pathingOnRecord): no file's.
 */
export const UNWRITTEN = "0".repeat(16);

/** A CellAttribute_* file with nothing painted in it, or none. */
const blankLayer = (file: Uint8Array | undefined): boolean => !file || file.subarray(CELL_ATTRIBUTE_HEADER).every((value) => value === 0);

/** The same text with either line ending, as a file the Editor saved may have it. */
const lineEndings = (text: string): string[] => [text, text.replace(/\r\n/g, "\n"), text.replace(/\r?\n/g, "\r\n")];
/** The ids of the Compiled regions in `regionsXml` the Editor hasn't changed since the compile: each still its recorded fingerprint. */
export function regionsAsCompiled(regionsXml: string, record: CompileRecord): Set<number> {
  const prints = new Map(record.entries.flatMap((entry) => (entry.kind === "region" ? [[String(entry.id), entry.fingerprint] as const] : [])));
  return new Set(regionElements(regionsXml).flatMap((element) => (prints.has(element.key) && matches(element.text, prints.get(element.key)!) ? [Number(element.key)] : [])));
}

const matches = (text: string, print: string): boolean => lineEndings(text).some((variant) => fingerprint(variant) === print);
const sameText = (a: string, b: string): boolean => a.replace(/\r\n/g, "\n").trimEnd() === b.replace(/\r\n/g, "\n").trimEnd();

/**
 * How far apart a number may be in an object or region, by the attribute it is in and its place
 * there, and still be the same: sync's tolerances (sync-shared.ts). A doodad's height (Position's
 * third number) the Editor sets on the ground where it moves it, which sync leaves to the ground
 * when it's within 0.05; a position or a region's shape within 0.01; anything else (an angle, a
 * scale) within 0.001, past the rounding sync writes.
 */
function tolerance(kind: "object" | "region", attribute: string | undefined, place: number): number {
  if (kind === "region") return POSITION_TOLERANCE;
  if (attribute === "Position") return place === 2 ? HEIGHT_TOLERANCE : POSITION_TOLERANCE;
  return ANGLE_TOLERANCE;
}

/**
 * Two objects or regions the same but for numbers within sync's tolerances: once sync has brought
 * the Editor's change back, the compile writes its own rounding of it, and that isn't a change of
 * the author's.
 */
function sameElement(kind: "object" | "region"): (a: string, b: string) => boolean {
  const NUMBER = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi;
  const normal = (text: string): string => (kind === "object" ? editorObjectForm(text) : text.replace(/\r\n/g, "\n").trimEnd());
  return (a, b) => {
    const x = normal(a);
    const y = normal(b);
    if (x.replace(NUMBER, "#") !== y.replace(NUMBER, "#")) return false;
    const theirs = [...y.matchAll(NUMBER)];
    return [...x.matchAll(NUMBER)].every((match, index) => {
      // The attribute the number is in, and how many numbers before it there.
      const before = x.slice(0, match.index);
      const open = before.lastIndexOf('="');
      const attribute = open >= 0 && !before.slice(open + 2).includes('"') ? /(\w+)$/.exec(before.slice(0, open))?.[1] : undefined;
      const place = attribute ? before.slice(open + 2).split(",").length - 1 : 0;
      return Math.abs(Number(match[0]) - Number(theirs[index]![0])) <= tolerance(kind, attribute, place);
    });
  };
}

/**
 * A placed object as it reads once the Editor has saved it in its own form, so a compile's object
 * and the Editor's of it compare: lines without their indent (the Editor indents 4 spaces, the
 * compile 2), without the attributes the Editor leaves out at their default (`Rotation="0"`,
 * `Variation="0"`), and without the HeightAbsolute flag it gives every doodad when it saves a
 * terrain edit (01-02's test save, 2026-11-10), an element with no children left closing itself.
 */
export function editorObjectForm(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== '<Flag Index="HeightAbsolute" Value="1"/>')
    .map((line, index) => (index === 0 ? line.replace(/ (?:Rotation|Variation)="0"(?=[ />])/g, "") : line));
  if (lines.length === 2 && /^<\w+\b[^>]*[^/]>$/.test(lines[0]!) && /^<\/\w+>$/.test(lines[1]!)) return lines[0]!.replace(/>$/, "/>");
  return lines.join("\n");
}

/** The attributes whose numbers are angles, compared round the circle (6.2832 is 0). */
const ANGLES = new Set(["Rotation", "Pitch", "Roll"]);

/**
 * Two placed objects the same by what they say (normalObject): the same kind, attributes and set
 * flags, every number within sync's tolerances, angles round the circle. An Editor save that only
 * re-lays them out (attribute and flag order, indentation, dropped defaults, its `HeightAbsolute`
 * flag, the last digit of a scale) isn't a change of the author's.
 */
function sameObject(a: string, b: string): boolean {
  const x = normalObject(a);
  const y = normalObject(b);
  if (x.tag !== y.tag || x.flags.join() !== y.flags.join()) return false;
  const names = Object.keys(x.attrs);
  if (names.length !== Object.keys(y.attrs).length) return false;
  for (const name of names) {
    const mine = x.attrs[name]!;
    const theirs = y.attrs[name];
    if (theirs === undefined) return false;
    if (mine === theirs) continue;
    const ours = mine.split(",");
    const other = theirs.split(",");
    if (ours.length !== other.length) return false;
    const within = ours.every((part, place) => {
      const p = Number(part);
      const q = Number(other[place]);
      if (part.trim() === "" || other[place]!.trim() === "" || Number.isNaN(p) || Number.isNaN(q)) return false;
      const apart = ANGLES.has(name) ? angleApart(p, q) : Math.abs(p - q);
      return apart <= tolerance("object", name, place);
    });
    if (!within) return false;
  }
  return sameElement("object")(x.rest, y.rest);
}

/** The name of a trigger or variable in the package's TriggerStrings, by element Id. */
export function triggerStringName(strings: string | undefined, type: "Trigger" | "Variable" | "FunctionDef", id: string): string | undefined {
  return strings && new RegExp(`^${type}/Name/${id}=([^\\r\\n]*)`, "m").exec(strings.replace(/^﻿/, ""))?.[1];
}

/** The name of a mod library's item (a function, trigger, category …) in the package's TriggerStrings, by library, element type and Id. */
function libraryStringName(strings: string | undefined, library: string, type: string, id: string): string | undefined {
  if (strings === undefined) return undefined;
  const key = libraryStringKey(library, type, "Name", id);
  return stringLines(strings).lines.find((line) => line.key === key)?.text.slice(key.length + 1).replace(/\r?\n$/, "");
}

/**
 * Each entry of `record` that the package at `root` no longer matches, where the compile would
 * write something else there (`fresh` gives what it queued for a file) or remove it.
 */
export async function editorChanges(
  root: string,
  record: CompileRecord,
  fresh: (file: string) => Content | undefined,
  /** Files the compile leaves as the package has them (PackageOutput.keep): nothing to decide. */
  untouched: ReadonlySet<string> = new Set(),
  /** The trigger list of Triggers the record's triggers and globals are in: a Mission's own, or a mod's library. */
  triggersScope: TriggersScope = {},
): Promise<EditorChange[]> {
  const texts = new Map<string, Promise<string | undefined>>();
  const read = (file: string): Promise<string | undefined> => {
    if (!texts.has(file)) {
      const full = path.join(root, ...file.split("/"));
      texts.set(file, existsSync(full) ? readFile(full, "utf8") : Promise.resolve(undefined));
    }
    return texts.get(file)!;
  };
  const freshText = (file: string): string | undefined => {
    const content = fresh(file);
    return typeof content === "string" ? content : undefined;
  };
  const byKey = <T extends { key: string }>(items: readonly T[]): Map<string, T> => new Map(items.map((item) => [item.key, item]));
  const memo = new Map<string, unknown>();
  const once = <T>(key: string, make: () => T): T => (memo.has(key) ? (memo.get(key) as T) : (memo.set(key, make()), memo.get(key) as T));

  const out: EditorChange[] = [];
  const consider = (entry: Extract<CompileRecordEntry, { fingerprint: string }>, now: string | undefined, next: string | undefined, label?: string, same = sameText): void => {
    if (now !== undefined && matches(now, entry.fingerprint)) return;
    if (now !== undefined && next !== undefined && same(now, next)) return;
    if (now === undefined && next === undefined) return;
    const change = now === undefined ? "removed in the Editor" : next === undefined ? "changed in the Editor, and the Blueprint no longer writes it" : "changed in the Editor";
    out.push({ entry, name: entryName(entry), change, ...(label ? { label } : {}) });
  };

  for (const entry of record.entries) {
    switch (entry.kind) {
      case "object":
      case "region": {
        const file = entry.kind === "object" ? "Objects" : "Regions";
        const scan = entry.kind === "object" ? objectElements : regionElements;
        const existing = once(`package:${file}`, async () => byKey(scan((await read(file)) ?? "")));
        const generated = once(`fresh:${file}`, () => byKey(scan(freshText(file) ?? "")));
        const now = (await existing).get(String(entry.id))?.text;
        const next = generated.get(String(entry.id))?.text;
        const text = now ?? next ?? "";
        const label = entry.kind === "object" ? OBJECT_KINDS[/^\s*<(\w+)/.exec(text)?.[1] ?? ""] : /<name value="([^"]*)"/.exec(text)?.[1];
        consider(entry, now, next, label, entry.kind === "object" ? sameObject : sameElement("region"));
        break;
      }
      case "string": {
        const existing = once(`package:${entry.file}`, async () => byKey(stringLines((await read(entry.file)) ?? "").lines));
        const generated = once(`fresh:${entry.file}`, () => byKey(stringLines(freshText(entry.file) ?? "").lines));
        consider(entry, (await existing).get(entry.key)?.text, generated.get(entry.key)?.text);
        break;
      }
      case "trigger":
      case "variable":
      case "function":
      case "category":
      case "preset":
      case "structure":
      case "comment":
      case "custom-script": {
        const existing = once("package:Triggers", async () => triggerItemTexts((await read("Triggers")) ?? "", triggersScope));
        const generated = once("fresh:Triggers", () => triggerItemTexts(freshText("Triggers") ?? "", triggersScope));
        const type = LIBRARY_ITEM_TYPES[entry.kind];
        const name =
          triggersScope.library !== undefined ? libraryStringName(await read(TRIGGER_STRINGS), triggersScope.library, type, entry.id) : entry.kind === "trigger" || entry.kind === "variable" ? triggerStringName(await read(TRIGGER_STRINGS), type as "Trigger" | "Variable", entry.id) : undefined;
        let now = (await existing).get(recordedItemKey(entry))?.text;
        let next = generated.get(recordedItemKey(entry))?.text;
        // A Mission's compile folder is compared without the Item lines it doesn't own: the author's filing wins (compileFolderText).
        if (entry.kind === "category" && triggersScope.library === undefined) {
          const { compiled, authorFiled } = await once("own:Triggers", async () => {
            const compiled = recordedItemKeys(record.entries);
            const folders = new Set(record.entries.flatMap((each) => (each.kind === "category" ? [each.id] : [])));
            const filing = libraryItems((await read("Triggers")) ?? "", triggersScope);
            return { compiled, authorFiled: new Set([...filing].flatMap(([key, item]) => (item.folder !== undefined && !folders.has(item.folder) ? [key] : []))) };
          });
          if (now !== undefined) now = compileFolderText(now, (key) => compiled.has(key));
          if (next !== undefined) next = compileFolderText(next, (key) => compiled.has(key) && !authorFiled.has(key));
        }
        consider(entry, now, next, name && `"${name}"`);
        break;
      }
      case "file": {
        if (DERIVED_FILES.has(entry.path) || LIBRARY_SCRIPT.test(entry.path) || DERIVED_TERRAIN_FILES.has(entry.path) || untouched.has(entry.path) || entry.path.endsWith(".version")) break;
        const full = path.join(root, ...entry.path.split("/"));
        const saved = existsSync(full) ? await readFile(full) : undefined;
        // A lighting mask saved with or without its TGA 2.0 footer is the same paint (light-regions.ts).
        // compile_cutscene's play-from-start script is the tool's, not the Editor's (the compile drops it as it writes).
        const now = saved && entry.path === LIGHTING_MAP ? withTgaFooter(saved) : saved && entry.path === MAP_SCRIPT ? Buffer.from(withoutCustomScriptInMapScript(saved.toString("utf8"), PLAY_SCRIPT_ID)) : saved;
        if (now && fingerprint(now) === entry.fingerprint) break;
        const content = fresh(entry.path);
        const next = content === undefined ? undefined : typeof content === "string" ? Buffer.from(content) : "copyFrom" in content ? await readFile(content.copyFrom) : Buffer.from(content);
        if (now && next && now.equals(next)) break;
        // The map's script, saved by the Editor in its own layout, says what the compile writes.
        if (entry.path === MAP_SCRIPT && now && next && galaxyForm(now.toString("utf8")) === galaxyForm(next.toString("utf8"))) break;
        // A painted pathing layer the Editor left with nothing painted is the compile's no file.
        // One left blank where the last compile wrote none is no change either.
        if (entry.path === PATHING_FILE && blankLayer(now) && (blankLayer(next) || entry.fingerprint === UNWRITTEN)) break;
        // A terrain file the Editor only re-encoded (another quantization, a stock water name) holds what the compile writes.
        if (now && next && RESAVED_TERRAIN_FILES.has(entry.path) && sameTerrainFile(entry.path, now, next, { now: await read("t3Terrain.xml"), next: freshText("t3Terrain.xml") })) break;
        if (!now && !next) break;
        const change = !now ? "removed in the Editor" : !next ? "changed in the Editor, and the Blueprint no longer writes it" : "changed in the Editor";
        out.push({ entry, name: entryName(entry), change });
        break;
      }
      case "catalog-entry": {
        const existing = once(`package:${entry.file}`, async () => byKey(catalogEntries((await read(entry.file)) ?? "")));
        const generated = once(`fresh:${entry.file}`, () => byKey(catalogEntries(freshText(entry.file) ?? "")));
        // The Editor saves an entry in its own layout (attribute order, 5.000000 for 5): only a change of what it says is one.
        consider(entry, (await existing).get(entry.id)?.text, generated.get(entry.id)?.text, undefined, (a, b) => canonicalXml(a) === canonicalXml(b));
        break;
      }
      // An uncommitted file is each machine's own (a mod's placeholder or community asset): replaced without a word.
      case "uncommitted":
        break;
      // Galaxy blocks follow their trigger; terrain cells and texture sets are compared where they are written (src/map/zones-beside-kept.ts), the hidden bit in src/map/hidden-cells-changes.ts.
      default:
        break;
    }
  }
  // The Editor writes MapScript.galaxy from Triggers on every save, so a trigger the author changed
  // changes it too: that is the trigger's question (and its Galaxy follows the answer), not a second.
  // A Triggers file saved unlike the record's (a Kept trigger the author added) rewrote it as well.
  const scriptAt = out.findIndex((change) => change.entry.kind === "file" && change.entry.path === MAP_SCRIPT);
  if (scriptAt >= 0 && (out.some((change) => isSplicedKind(change.entry.kind)) || (await triggersSavedSince(root, record)))) out.splice(scriptAt, 1);
  return out;
}

/**
 * The ids of the mod library's functions this compile leaves as the package has them: those the
 * author kept before (unless now discarded by name), and those the Editor changed that `decisions`
 * keep. PackageOutput leaves their XML; the library leaves their Galaxy, which the Editor wrote with it.
 */
export async function keptFunctions(root: string, record: CompileRecord, decisions: EditorDecisions, triggersScope: TriggersScope): Promise<Set<string>> {
  const listed = (list: readonly string[] | "all" | undefined, name: string): boolean => Array.isArray(list) && list.includes(name);
  const keeps = (name: string): boolean => listed(decisions.keep, name) || (!listed(decisions.discard, name) && decisions.keep === "all");
  const out = new Set((record.kept ?? []).flatMap((entry) => (entry.kind === "function" && !listed(decisions.discard, entryName(entry)) ? [entry.id] : [])));
  const compiled = record.entries.filter((entry): entry is Extract<CompileRecordEntry, { kind: "function" }> => entry.kind === "function" && keeps(entryName(entry)));
  if (compiled.length === 0) return out;
  const full = path.join(root, "Triggers");
  const items = triggerItemTexts(existsSync(full) ? await readFile(full, "utf8") : "", triggersScope);
  for (const entry of compiled) {
    const now = items.get(recordedItemKey(entry))?.text;
    if (now === undefined || !matches(now, entry.fingerprint)) out.add(entry.id);
  }
  return out;
}

/** The Kept entry a change becomes when the author keeps it, or undefined for one that can't be kept. */
export function keptEntryOf(entry: CompileRecordEntry): KeptEntry | undefined {
  switch (entry.kind) {
    case "file":
      return { kind: "file", path: entry.path };
    case "object":
    case "region":
      return { kind: entry.kind, id: entry.id };
    case "string":
      return { kind: "string", file: entry.file, key: entry.key };
    case "trigger":
    case "variable":
    case "function":
    case "category":
    case "preset":
    case "structure":
    case "comment":
    case "custom-script":
      return { kind: entry.kind, id: entry.id };
    case "catalog-entry":
      return { kind: "catalog-entry", file: entry.file, id: entry.id };
    case "terrain-cells":
      return { kind: "terrain-cells", file: entry.file, cells: entry.cells };
    case "texture-set":
      return { kind: "texture-set", id: entry.id, set: entry.set, blocks: entry.blocks };
    case "hidden-cells":
      return entry.cells.length > 0 ? { kind: "hidden-cells", cells: entry.cells } : undefined;
    default:
      return undefined;
  }
}

/** Where the Blueprint declares an object, when an Anchor makes it: `anchors.3 crater_1`. */
function anchorOf(blueprint: Pick<MissionBlueprint, "anchors"> | undefined, id: number): { index: number; id: string } | undefined {
  const index = blueprint?.anchors.findIndex((anchor) => anchorObjectId(anchor) === id) ?? -1;
  return index < 0 ? undefined : { index, id: blueprint!.anchors[index]!.id };
}

/** A change as the author reads it: `object:1234 (doodad, anchors.3 crater_1): changed in the Editor`. */
export function describeEditorChange(change: EditorChange, blueprint?: Pick<MissionBlueprint, "anchors">): string {
  const anchor = change.entry.kind === "object" ? anchorOf(blueprint, change.entry.id) : undefined;
  const about = [change.label, anchor && `anchors.${anchor.index} ${anchor.id}`].filter(Boolean).join(", ");
  return `${change.name}${about ? ` (${about})` : ""}: ${change.change}`;
}

/**
 * The compile's refusal: what sync brings back (`syncable`, by entry name), then what to keep or
 * discard, each change on its own line, and how to decide.
 */
export function formatEditorChanges(
  changes: readonly EditorChange[],
  syncable: readonly string[],
  blueprint?: Pick<MissionBlueprint, "anchors">,
  /** What is compiled into and by which tool: a Mission's Map Package by compile_map unless given. */
  { target = "Map Package", tool = "compile_map" }: { readonly target?: string; readonly tool?: string } = {},
): string {
  const sync = changes.filter((change) => syncable.includes(change.name));
  const decide = changes.filter((change) => !syncable.includes(change.name));
  const lines = [`The Editor has changed Compiled Content in the ${target} since the last compile, so nothing is compiled.`];
  if (sync.length > 0) {
    lines.push(
      `Run sync first: it brings these back into the Blueprint, then compile again (or --discard <entry> to overwrite one). sync brings back: ${sync.map((change) => describeEditorChange(change, blueprint).replace(/: [^:]*$/, "")).join("; ")}`,
    );
  }
  if (decide.length > 0) {
    lines.push(
      "Keep or discard each change:",
      ...decide.map((change) => `  ${describeEditorChange(change, blueprint)}`),
      `Keeping one leaves it as the Editor has it and takes it off the compile record, as Kept Content the Blueprint no longer writes; discarding one has the compile overwrite it with what the Blueprint says. Compile with --keep <entry> or --discard <entry> for each (repeatable), or --keep-all or --discard-all; ${tool} takes keep, discard, keepAll and discardAll.`,
    );
  }
  return lines.join("\n");
}

/** A warning for a declaration the compile no longer writes because the author kept what it made. */
export function describeUnusedKept(entry: KeptEntry, blueprint?: Pick<MissionBlueprint, "anchors">, label?: string): string {
  const name = entryName(entry);
  const undo = `remove the declaration from the Blueprint, or compile with --discard ${name} to have it written again`;
  if (entry.kind === "terrain-cells") {
    const count = entry.cells.reduce((sum, [, , w, h]) => sum + w * h, 0);
    return `${count} cells of a generating Zone, the first at (${entry.cells[0]![0]}, ${entry.cells[0]![1]}), were kept as the Editor left them in ${entry.file} (--keep), so the compile no longer writes them: compile with --discard ${name} to have the Zone write them again`;
  }
  if (entry.kind === "hidden-cells") {
    const count = entry.cells.reduce((sum, [, , w, h]) => sum + w * h, 0);
    return `${count} cell${count === 1 ? "" : "s"}, the first at (${entry.cells[0]![0]}, ${entry.cells[0]![1]}), ${count === 1 ? "was" : "were"} kept hidden or shown as the Editor left ${count === 1 ? "it" : "them"} (--keep), so the compile no longer writes ${count === 1 ? "its" : "their"} hidden bit: compile with --discard ${name} to have the Blueprint's written again (sync first to bring the Editor's into the Zones' hiddenCells)`;
  }
  if (entry.kind === "texture-set") {
    return `Texture set ${entry.id} (set ${entry.set}) was kept as the Editor left it (--keep), so the compile no longer writes its name, slots or blocks, and paints its Zones from the sets their blocks are on: compile with --discard ${name} to have it written again`;
  }
  if (entry.kind === "object") {
    const anchor = anchorOf(blueprint, entry.id);
    if (anchor) return `anchors.${anchor.index} (${anchor.id}) is declared, but its object ${entry.id} was kept as the Editor left it (--keep), so the compile no longer writes it: ${undo}`;
  }
  return `The Blueprint still makes ${name}${label ? ` (${label})` : ""}, but it was kept as the Editor left it (--keep), so the compile no longer writes it: ${undo}`;
}
