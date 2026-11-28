// Edits Kept objects and regions in the Mission's Map Package itself (ADR-0010): doodads, units,
// points and cameras in `Objects`, regions in `Regions`. Each edit rewrites only the element it
// changes, so every other byte stays as the Editor wrote it (its line ends, indents, attribute
// order and doodad groups). Compiled Content (on the compile record) is refused, naming the
// Blueprint field that owns it, and so is any edit while the Editor has the map open. Every edit is
// checked before any file is written, so a refused one leaves the package as it was. The
// `edit_kept_objects` MCP tool and the `edit-kept` CLI run it.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { CompileRecord } from "../domain/compile-record.js";
import { type MissionBlueprint, type RegionShape, RegionShapeSchema } from "../domain/mission-blueprint.js";
import { expandDressing } from "../dressing/expand-dressing.js";
import type { Host } from "../host/host.js";
import { parseMissionBlueprint, type Workspace } from "../plugins/workspace.js";
import { rasterizeTerrain } from "../terrain/rasterize.js";
import { boundsRegions } from "../triggers/beat-bounds.js";
import { waveWarningRegions } from "../triggers/wave-triggers.js";
import { openKeptSession, withMissionPackageLock } from "./kept-session.js";
import { regionBounds } from "./read-regions-xml.js";
import { anchorObjectId, stableObjectId } from "./stable-object-id.js";
import { missionRegions } from "./write-regions-xml.js";
import { decodeXmlText } from "./xml-elements.js";

const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite().optional() }).strict();
const OffsetSchema = z.object({ x: z.number().finite().default(0), y: z.number().finite().default(0), z: z.number().finite().optional() }).strict();
/** An object by its Editor Id, or a unit, point or camera by its Kept Reference id. */
const ObjectTargetSchema = z.union([z.number().int().nonnegative(), z.string().min(1)]);
/** A region by its Editor id, or by its Kept Reference id. */
const RegionTargetSchema = z.union([z.number().int().nonnegative(), z.string().min(1)]);
const ScaleSchema = z.union([z.number().positive(), z.tuple([z.number().positive(), z.number().positive(), z.number().positive()])]);
const TintSchema = z.string().regex(/^\d{1,3},\d{1,3},\d{1,3}$/, 'A tint is "r,g,b" with each 0-255');
const FlagSchema = z.string().regex(/^[A-Za-z]+$/, "A flag is the Editor's name for it, such as HeightAbsolute");

/** One edit. Angles are degrees (a facing about z, a tilt's pitch and roll), written as the Editor's radians. */
export const KeptEditSchema = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("move"), object: ObjectTargetSchema.optional(), region: RegionTargetSchema.optional(), to: PointSchema.optional(), by: OffsetSchema.optional() })
    .strict()
    .refine((edit) => (edit.object === undefined) !== (edit.region === undefined), "A move names one object or one region")
    .refine((edit) => (edit.to === undefined) !== (edit.by === undefined), "A move gives `to` (where it goes) or `by` (how far), not both"),
  z.object({ op: z.literal("rotate"), object: ObjectTargetSchema, facing: z.number().finite() }).strict(),
  z
    .object({ op: z.literal("tilt"), object: ObjectTargetSchema, pitch: z.number().finite().optional(), roll: z.number().finite().optional() })
    .strict()
    .refine((edit) => edit.pitch !== undefined || edit.roll !== undefined, "A tilt gives a pitch, a roll or both"),
  z.object({ op: z.literal("scale"), object: ObjectTargetSchema, scale: ScaleSchema }).strict(),
  z.object({ op: z.literal("tint"), object: ObjectTargetSchema, tint: TintSchema.nullable() }).strict(),
  z
    .object({ op: z.literal("swap"), object: ObjectTargetSchema, type: z.string().min(1).optional(), variation: z.number().int().nonnegative().optional() })
    .strict()
    .refine((edit) => edit.type !== undefined || edit.variation !== undefined, "A swap gives a type, a variation or both"),
  z
    .object({
      op: z.literal("add"),
      type: z.string().min(1),
      at: PointSchema,
      /** An existing doodad whose height (when `at.z` is left out) and flags the new one takes. */
      like: z.number().int().nonnegative().optional(),
      facing: z.number().finite().optional(),
      pitch: z.number().finite().optional(),
      roll: z.number().finite().optional(),
      scale: ScaleSchema.optional(),
      variation: z.number().int().nonnegative().optional(),
      tint: TintSchema.optional(),
      flags: z.array(FlagSchema).optional(),
    })
    .strict(),
  z.object({ op: z.literal("remove"), object: ObjectTargetSchema }).strict(),
  z.object({ op: z.literal("rename"), object: ObjectTargetSchema, name: z.string().min(1).regex(/^[^\r\n]*$/, "A name is one line") }).strict(),
  z
    .object({ op: z.literal("flags"), object: ObjectTargetSchema, set: z.array(FlagSchema).optional(), clear: z.array(FlagSchema).optional() })
    .strict()
    .refine((edit) => (edit.set?.length ?? 0) + (edit.clear?.length ?? 0) > 0, "A flags edit sets or clears at least one flag"),
  z.object({ op: z.literal("resize"), region: RegionTargetSchema, scale: z.union([z.number().positive(), z.object({ x: z.number().positive(), y: z.number().positive() }).strict()]) }).strict(),
  z.object({ op: z.literal("redraw"), region: RegionTargetSchema, shapes: z.array(RegionShapeSchema).min(1) }).strict(),
]);
export type KeptEdit = z.input<typeof KeptEditSchema>;
type Edit = z.output<typeof KeptEditSchema>;

export type KeptEditResult = {
  /** One line per edit: what it changed. */
  readonly changed: readonly string[];
  /** What the author may want to check, such as a doodad that kept its height on new ground. */
  readonly warnings: readonly string[];
  /** The files written, relative to the Map Package. */
  readonly files: readonly string[];
  readonly mapPackage: string;
};

export type KeptEditOptions = {
  /** Asked whether the Editor has the map open (`editor.checkClosed`); a host that can't tell lets the edit go ahead. */
  readonly host?: Host;
};

type ObjectTag = "ObjectDoodad" | "ObjectUnit" | "ObjectPoint" | "ObjectCamera";
const NOUN: Record<ObjectTag, "doodad" | "unit" | "point" | "camera"> = { ObjectDoodad: "doodad", ObjectUnit: "unit", ObjectPoint: "point", ObjectCamera: "camera" };
/** The Editor's attribute order for each object (as an Editor-saved map's Objects has them), for an attribute an edit adds. */
const ORDER: Record<ObjectTag, readonly string[]> = {
  ObjectDoodad: ["Id", "Variation", "Position", "Rotation", "Scale", "Name", "Type", "Pitch", "Roll", "TintColor", "TeamColor"],
  ObjectUnit: ["Id", "Variation", "Position", "Rotation", "Scale", "UnitType", "Player", "Resources"],
  ObjectPoint: ["Id", "Position", "Rotation", "Scale", "Type", "Name", "Color"],
  ObjectCamera: ["Id", "Position", "Rotation", "Scale", "Name", "Color", "CameraTarget"],
};
/** Which objects each edit applies to. */
const EDITS_OBJECTS: Record<Exclude<Edit["op"], "add" | "resize" | "redraw">, readonly ObjectTag[]> = {
  move: ["ObjectDoodad", "ObjectUnit", "ObjectPoint", "ObjectCamera"],
  rotate: ["ObjectDoodad", "ObjectUnit", "ObjectPoint", "ObjectCamera"],
  tilt: ["ObjectDoodad"],
  scale: ["ObjectDoodad"],
  tint: ["ObjectDoodad"],
  swap: ["ObjectDoodad"],
  remove: ["ObjectDoodad"],
  rename: ["ObjectPoint", "ObjectCamera"],
  flags: ["ObjectDoodad", "ObjectUnit", "ObjectPoint", "ObjectCamera"],
};
/** The Blueprint property a Compiled object's edit belongs to. */
const ANCHOR_FIELD: Record<Exclude<Edit["op"], "add" | "resize" | "redraw">, string> = {
  move: "position",
  rotate: "rotation",
  tilt: "pitch and roll",
  scale: "scale",
  tint: "tint",
  swap: "doodadType and variation",
  remove: "entry (remove the Anchor)",
  rename: "name",
  flags: "flags (or forcePlacement)",
};

/** Applies `edits` in order to the Mission's Map Package, as above. */
export function editKeptObjects(workspace: Workspace, blueprintPath: string, edits: readonly KeptEdit[], options: KeptEditOptions = {}): Promise<KeptEditResult> {
  return withMissionPackageLock(blueprintPath, () => editKeptObjectsLocked(workspace, blueprintPath, edits, options));
}

async function editKeptObjectsLocked(workspace: Workspace, blueprintPath: string, edits: readonly KeptEdit[], options: KeptEditOptions): Promise<KeptEditResult> {
  const parsed = edits.map((edit, index) => {
    const result = KeptEditSchema.safeParse(edit);
    if (!result.success) throw new Error(`Edit ${index + 1}: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
    return result.data;
  });
  if (parsed.length === 0) throw new Error("No edits given");
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const session = await openKeptSession(blueprintPath, { verb: "edited", host: options.host, requirePackage: true });
  const { mapPackage, record } = session;

  const files = { Objects: await readOptional(path.join(mapPackage, "Objects")), Regions: await readOptional(path.join(mapPackage, "Regions")) };
  const state = { objects: files.Objects, regions: files.Regions };
  const editor = new PackageEditor(blueprint, record);
  const changed: string[] = [];
  const warnings: string[] = [];
  parsed.forEach((edit, index) => {
    try {
      const done = editor.apply(edit, state);
      changed.push(done.change);
      warnings.push(...done.warnings);
    } catch (error) {
      throw new Error(`Edit ${index + 1} (${edit.op}): ${error instanceof Error ? error.message : String(error)}. Nothing was written`, { cause: error });
    }
  });

  const out: (readonly [string, string])[] = [];
  if (state.objects !== files.Objects) out.push(["Objects", state.objects!]);
  if (state.regions !== files.Regions) out.push(["Regions", state.regions!]);
  // Nothing changed, nothing written, so the Editor being open is no refusal.
  const written = out.length > 0 ? await session.commit(out) : [];
  return { changed, warnings, files: written, mapPackage };
}

/**
 * `xml` (an Objects file) with each doodad in `heights` given that height (its Position's z), its x
 * and y as the Editor wrote them and every other byte left. The terrain brushes use it to keep
 * doodads on the ground they move (src/map/edit-kept-terrain.ts).
 */
export function setDoodadHeights(xml: string, heights: ReadonlyMap<number, number>): string {
  let out = xml;
  for (const [id, z] of heights) {
    const found = locateObject(out, id);
    if (!found || found.tag !== "ObjectDoodad") throw new Error(`the package has no doodad ${id}`);
    const [x = "0", y = "0"] = (getAttr(found.text, "Position") ?? "").split(",");
    out = splice(out, found, setAttr(found.text, "Position", `${x},${y},${num(z)}`, ORDER.ObjectDoodad));
  }
  return out;
}

async function readOptional(file: string): Promise<string | undefined> {
  return existsSync(file) ? readFile(file, "utf8") : undefined;
}

type Located = { readonly tag: string; readonly start: number; readonly end: number; readonly text: string; readonly indent: string };

class PackageEditor {
  private readonly compiledObjects: ReadonlySet<number>;
  private readonly compiledRegions: readonly number[];

  private readonly blueprint: MissionBlueprint;

  constructor(blueprint: MissionBlueprint, record: CompileRecord) {
    this.blueprint = blueprint;
    this.compiledObjects = new Set(record.entries.flatMap((entry) => (entry.kind === "object" ? [entry.id] : [])));
    this.compiledRegions = record.entries.flatMap((entry) => (entry.kind === "region" ? [entry.id] : []));
  }

  apply(edit: Edit, state: { objects: string | undefined; regions: string | undefined }): { change: string; warnings: string[] } {
    if (edit.op === "add") {
      if (state.objects === undefined) throw new Error("the package has no Objects file to add a doodad to");
      const { xml, change } = addDoodad(state.objects, edit);
      state.objects = xml;
      return { change, warnings: [] };
    }
    if (edit.op === "resize" || edit.op === "redraw" || (edit.op === "move" && edit.region !== undefined)) {
      if (state.regions === undefined) throw new Error("the package has no Regions file");
      const id = this.regionId(edit.region!);
      if (this.compiledRegions.includes(id)) throw new Error(`region ${id} is Compiled Content (on the compile record): ${this.regionField(id)} instead`);
      const found = locate(state.regions, "region", "id", id);
      if (!found) throw new Error(`the package has no region ${id}`);
      const name = decodeXmlText(/<name value="([^"]*)"/.exec(found.text)?.[1] ?? "");
      const { text, change } = editRegion(found, edit, newlineOf(state.regions));
      state.regions = splice(state.regions, found, text);
      return { change: `region ${id} (${name}): ${change}`, warnings: [] };
    }
    if (state.objects === undefined) throw new Error("the package has no Objects file");
    const id = this.objectId(edit.object!);
    const found = locateObject(state.objects, id);
    if (!found) throw new Error(`the package has no object ${id}`);
    const tag = found.tag as ObjectTag;
    const allowed = EDITS_OBJECTS[edit.op];
    if (!allowed.includes(tag)) {
      const why = edit.op === "rename" && tag === "ObjectUnit" ? " (a unit has no name in Objects: the Editor names it in triggers)" : "";
      throw new Error(`${edit.op} edits ${allowed.map((item) => `${NOUN[item]}s`).join(", ")}, and object ${id} is a ${NOUN[tag]}${why}`);
    }
    if (this.compiledObjects.has(id)) throw new Error(`${NOUN[tag]} ${id} is Compiled Content (on the compile record): ${this.objectField(id, edit.op)} instead`);
    const label = `${NOUN[tag]} ${id} (${objectLabel(found.text, tag)})`;
    const newline = newlineOf(state.objects);
    if (edit.op === "remove") {
      state.objects = removeGroupMember(splice(state.objects, found, undefined), id);
      return { change: `${label}: removed`, warnings: [] };
    }
    const { text, change, warnings } = editObject(found, tag, edit, newline);
    state.objects = splice(state.objects, found, text);
    return { change: `${label}: ${change}`, warnings: warnings.map((warning) => `${label} ${warning}`) };
  }

  private objectId(target: number | string): number {
    if (typeof target === "number") return target;
    const kept = this.blueprint.kept.find((reference) => reference.id === target && (reference.kind === "unit" || reference.kind === "point" || reference.kind === "camera"));
    if (!kept) throw new Error(`${target} isn't a Kept unit, point or camera in the Blueprint's kept: name the object by its Editor Id`);
    return Number(kept.editorId);
  }

  private regionId(target: number | string): number {
    if (typeof target === "number") return target;
    const kept = this.blueprint.kept.find((reference) => reference.id === target && reference.kind === "region");
    if (!kept) throw new Error(`${target} isn't a Kept region in the Blueprint's kept: name the region by its Editor id`);
    return Number(kept.editorId);
  }

  /** Where in the Blueprint a Compiled object comes from, as the change to make there. */
  private objectField(id: number, op: keyof typeof ANCHOR_FIELD): string {
    const index = this.blueprint.anchors.findIndex((anchor) => anchorObjectId(anchor) === id);
    if (index >= 0) return `change anchors.${index} (${this.blueprint.anchors[index]!.id})'s ${ANCHOR_FIELD[op]} in the Blueprint`;
    return "it is generated from the Blueprint's placements, set pieces or dressing: change the one that makes it in the Blueprint";
  }

  /** Where in the Blueprint a Compiled region comes from, as the change to make there. */
  private regionField(id: number): string {
    const blueprint = this.blueprint;
    const regions = missionRegions(blueprint, expandDressing(blueprint, rasterizeTerrain(blueprint)).setPieces, waveWarningRegions(blueprint), boundsRegions(blueprint));
    const source = regions[this.compiledRegions.indexOf(id)]?.source;
    if (source?.kind === "zone") return `change zones.${blueprint.zones.findIndex((zone) => zone.id === source.zoneId)} (${source.zoneId})'s region in the Blueprint`;
    if (source?.kind === "region") return `change regions.${blueprint.regions.findIndex((region) => region.id === source.regionId)} (${source.regionId}) in the Blueprint`;
    if (source?.kind === "wave-warning") return `it is the warning circle of waves.${blueprint.waves.findIndex((wave) => wave.id === source.waveId)} (${source.waveId}): change its warning in the Blueprint`;
    if (source?.kind === "bounds") {
      const index = blueprint.beats.findIndex((beat) => beat.id === source.beatId);
      const field = source.role === "playable" ? "playable" : source.role === "camera" ? "camera.bounds" : "camera.transition";
      return `it is a bounds region of beats.${index} (${source.beatId}): change its ${field} in the Blueprint`;
    }
    if (source?.kind === "set-piece") return `it is the label of the set piece placements.${blueprint.placements.findIndex((placement) => placement.id === source.setPieceId)} (${source.setPieceId}): change the set piece in the Blueprint`;
    return "change the Blueprint, whose compile writes it";
  }
}

/** The element `<tag ... key="id" ...>` and its extent, with its line's indent. */
function locate(xml: string, tag: string, key: string, id: number): Located | undefined {
  const open = new RegExp(`<(${tag})\\s[^>]*?\\b${key}="${id}"[^>]*?(/?)>`, "g");
  return located(xml, open.exec(xml));
}

function locateObject(xml: string, id: number): Located | undefined {
  const open = new RegExp(`<(Object(?:Doodad|Unit|Point|Camera))\\s[^>]*?\\bId="${id}"[^>]*?(/?)>`, "g");
  return located(xml, open.exec(xml));
}

function located(xml: string, match: RegExpExecArray | null): Located | undefined {
  if (!match) return undefined;
  const tag = match[1]!;
  const start = match.index;
  const close = `</${tag}>`;
  const closeAt = match[2] === "/" ? -1 : xml.indexOf(close, start);
  if (match[2] !== "/" && closeAt < 0) throw new Error(`the ${tag} at character ${start} has no ${close}: the file looks cut short, so it isn't edited`);
  const end = match[2] === "/" ? start + match[0].length : closeAt + close.length;
  const lineStart = xml.lastIndexOf("\n", start) + 1;
  return { tag, start, end, text: xml.slice(start, end), indent: xml.slice(lineStart, start) };
}

/** `xml` with `found` replaced by `text`, or removed with its line when `text` is undefined. */
function splice(xml: string, found: Located, text: string | undefined): string {
  if (text !== undefined) return xml.slice(0, found.start) + text + xml.slice(found.end);
  const lineStart = xml.lastIndexOf("\n", found.start);
  const from = lineStart > 0 && xml[lineStart - 1] === "\r" ? lineStart - 1 : Math.max(lineStart, 0);
  return xml.slice(0, from) + xml.slice(found.end);
}

function newlineOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** The Editor writes positions, angles and scales with at most 4 decimals. */
function num(value: number): string {
  const rounded = Math.round(value * 10000) / 10000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}
const radians = (degrees: number): number => (degrees * Math.PI) / 180;
/** A facing as the Editor's Rotation: radians in [0, 2π). */
const rotationOf = (degrees: number): string => num(radians(((degrees % 360) + 360) % 360));

function getAttr(text: string, name: string): string | undefined {
  const value = new RegExp(`^<\\w+\\s[^>]*?\\b${name}="([^"]*)"`).exec(text)?.[1];
  return value === undefined ? undefined : decodeXmlText(value);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The element with its open tag's `name` set to `value` (escaped), or removed when undefined; a new one goes where the Editor puts it. */
function setAttr(text: string, name: string, value: string | undefined, order: readonly string[]): string {
  const openEnd = text.indexOf(">") + 1;
  let open = text.slice(0, openEnd);
  const rest = text.slice(openEnd);
  const existing = new RegExp(`\\s${name}="[^"]*"`);
  if (existing.test(open)) {
    open = open.replace(existing, value === undefined ? "" : ` ${name}="${escapeXml(value)}"`);
    return open + rest;
  }
  if (value === undefined) return text;
  const attr = ` ${name}="${escapeXml(value)}"`;
  const later = order.slice(order.indexOf(name) + 1).find((other) => new RegExp(`\\s${other}="`).test(open));
  if (later) {
    const at = open.search(new RegExp(`\\s${later}="`));
    open = open.slice(0, at) + attr + open.slice(at);
  } else {
    open = open.replace(/\s*(\/?)>$/, (_, slash: string) => `${attr}${slash ? "/" : ""}>`);
  }
  return open + rest;
}

function vector(value: string | undefined, fallback: number): [number, number, number] {
  const [x = fallback, y = fallback, z = fallback] = (value ?? "").split(",").filter((part) => part !== "").map(Number);
  return [x, y, z];
}

function objectLabel(text: string, tag: ObjectTag): string {
  if (tag === "ObjectDoodad") return getAttr(text, "Type") ?? "doodad";
  if (tag === "ObjectUnit") return getAttr(text, "UnitType") ?? "unit";
  return getAttr(text, "Name") ?? NOUN[tag];
}

function hasFlag(text: string, flag: string): boolean {
  return new RegExp(`<Flag Index="${flag}" Value="1"\\s*/>`).test(text);
}

/** The element with `set` flags on and `clear` flags off, as the Editor writes them: a child line each, self-closing when none is left. */
function setFlags(found: Located, text: string, set: readonly string[], clear: readonly string[], newline: string): string {
  let out = text;
  const tag = found.tag;
  const childIndent = found.indent + (found.indent || "    ");
  for (const flag of clear) {
    out = out.replace(new RegExp(`\\r?\\n[ \\t]*<Flag Index="${flag}" Value="[01]"\\s*/>`), "");
  }
  for (const flag of set) {
    if (hasFlag(out, flag)) continue;
    const zeroed = new RegExp(`<Flag Index="${flag}" Value="0"(\\s*)/>`);
    if (zeroed.test(out)) {
      out = out.replace(zeroed, `<Flag Index="${flag}" Value="1"$1/>`);
      continue;
    }
    const line = `${childIndent}<Flag Index="${flag}" Value="1"/>`;
    if (out.endsWith("/>") && !out.includes(`</${tag}>`)) {
      out = `${out.replace(/\s*\/>$/, ">")}${newline}${line}${newline}${found.indent}</${tag}>`;
      continue;
    }
    // After the element's last flag, else last among its children.
    const flags = [...out.matchAll(/<Flag [^>]*\/>/g)];
    const at = flags.length > 0 ? flags.at(-1)!.index! + flags.at(-1)![0].length : out.lastIndexOf(newline, out.lastIndexOf(`</${tag}>`));
    out = out.slice(0, at) + newline + line + out.slice(at);
  }
  // No children left: self-closing, as the Editor writes it.
  const openEnd = out.indexOf(">") + 1;
  if (!out.endsWith("/>") && out.slice(openEnd, out.lastIndexOf(`</${tag}>`)).trim() === "") out = `${out.slice(0, openEnd - 1)}/>`;
  return out;
}

function editObject(found: Located, tag: ObjectTag, edit: Exclude<Edit, { op: "add" | "remove" | "resize" | "redraw" }>, newline: string): { text: string; change: string; warnings: string[] } {
  const order = ORDER[tag];
  let text = found.text;
  const warnings: string[] = [];
  switch (edit.op) {
    case "move": {
      const [x, y, z] = vector(getAttr(text, "Position"), 0);
      const to = edit.to ? { x: edit.to.x, y: edit.to.y, z: edit.to.z ?? z } : { x: x + edit.by!.x, y: y + edit.by!.y, z: edit.by!.z === undefined ? z : z + edit.by!.z };
      text = setAttr(text, "Position", `${num(to.x)},${num(to.y)},${num(to.z)}`, order);
      if (tag === "ObjectCamera") {
        const target = getAttr(text, "CameraTarget");
        if (target !== undefined) {
          const [tx, ty] = vector(target, 0);
          text = setAttr(text, "CameraTarget", `${num(tx + to.x - x)},${num(ty + to.y - y)}`, order);
        }
      }
      if (tag === "ObjectDoodad" && (edit.to ? edit.to.z === undefined : edit.by!.z === undefined) && hasFlag(text, "HeightAbsolute")) {
        warnings.push(`kept its height, ${num(to.z)} (HeightAbsolute): give z if the ground there is higher or lower`);
      }
      return { text, change: `moved to (${num(to.x)}, ${num(to.y)}, ${num(to.z)})`, warnings };
    }
    case "rotate": {
      // The Editor leaves a zero Rotation out.
      const rotation = rotationOf(edit.facing);
      text = setAttr(text, "Rotation", rotation === "0" ? undefined : rotation, order);
      // A camera keeps its yaw again as a camera value, in degrees.
      if (tag === "ObjectCamera") text = text.replace(/(<CameraValue Index="Yaw" Value=")[^"]*(")/, `$1${num(((edit.facing % 360) + 360) % 360)}$2`);
      return { text, change: `facing ${num(edit.facing)}°`, warnings };
    }
    case "tilt": {
      if (edit.pitch !== undefined) text = setAttr(text, "Pitch", edit.pitch === 0 ? undefined : num(radians(edit.pitch)), order);
      if (edit.roll !== undefined) text = setAttr(text, "Roll", edit.roll === 0 ? undefined : num(radians(edit.roll)), order);
      return { text, change: `tilted to${edit.pitch !== undefined ? ` pitch ${num(edit.pitch)}°` : ""}${edit.roll !== undefined ? ` roll ${num(edit.roll)}°` : ""}`, warnings };
    }
    case "scale": {
      const [sx, sy, sz] = typeof edit.scale === "number" ? [edit.scale, edit.scale, edit.scale] : edit.scale;
      text = setAttr(text, "Scale", `${num(sx)},${num(sy)},${num(sz)}`, order);
      return { text, change: `scaled to ${num(sx)},${num(sy)},${num(sz)}`, warnings };
    }
    case "tint":
      text = setAttr(text, "TintColor", edit.tint ?? undefined, order);
      return { text, change: edit.tint ? `tinted ${edit.tint}` : "tint removed", warnings };
    case "swap": {
      if (edit.type !== undefined) text = setAttr(text, "Type", edit.type, order);
      // The Editor leaves Variation 0 out.
      if (edit.variation !== undefined) text = setAttr(text, "Variation", edit.variation === 0 ? undefined : String(edit.variation), order);
      return { text, change: `now ${getAttr(text, "Type")}${getAttr(text, "Variation") !== undefined ? ` variation ${getAttr(text, "Variation")}` : ""}`, warnings };
    }
    case "rename":
      text = setAttr(text, "Name", edit.name, order);
      return { text, change: `renamed ${edit.name}`, warnings };
    case "flags":
      text = setFlags(found, text, edit.set ?? [], edit.clear ?? [], newline);
      return { text, change: [edit.set?.length ? `set ${edit.set.join(", ")}` : "", edit.clear?.length ? `cleared ${edit.clear.join(", ")}` : ""].filter(Boolean).join("; "), warnings };
  }
}

/** Adds a doodad after the last object, in the file's own form, with an Id no object has. */
function addDoodad(xml: string, edit: Extract<Edit, { op: "add" }>): { xml: string; change: string } {
  const newline = newlineOf(xml);
  const ids = new Set([...xml.matchAll(/<Object\w+\s[^>]*?\bId="(\d+)"/g)].map((match) => Number(match[1])));
  const like = edit.like === undefined ? undefined : locateObject(xml, edit.like);
  if (edit.like !== undefined && like?.tag !== "ObjectDoodad") throw new Error(`like names doodad ${edit.like}, which the package doesn't have`);
  const z = edit.at.z ?? (like ? vector(getAttr(like.text, "Position"), 0)[2] : undefined);
  if (z === undefined) throw new Error("give at.z (the height there, as the doodads around it have) or like, a doodad whose height and flags it takes");
  let id = stableObjectId(`kept/${edit.type}/${edit.at.x},${edit.at.y}`);
  while (ids.has(id)) id = (id + 1) >>> 0;
  const flags = edit.flags ?? (like ? [...like.text.matchAll(/<Flag Index="(\w+)" Value="1"/g)].map((match) => match[1]!) : []);
  const objects = [...xml.matchAll(/<(Object(?:Doodad|Unit|Point|Camera))\s[^>]*?\bId="\d+"[^>]*?(\/?)>/g)];
  const last = objects.length > 0 ? located(xml, objects.at(-1)! as RegExpExecArray) : undefined;
  const indent = last?.indent ?? "    ";
  const [sx, sy, sz] = edit.scale === undefined ? [1, 1, 1] : typeof edit.scale === "number" ? [edit.scale, edit.scale, edit.scale] : edit.scale;
  const attrs = [
    `Id="${id}"`,
    ...(edit.variation ? [`Variation="${edit.variation}"`] : []),
    `Position="${num(edit.at.x)},${num(edit.at.y)},${num(z)}"`,
    ...(rotationOf(edit.facing ?? 0) !== "0" ? [`Rotation="${rotationOf(edit.facing!)}"`] : []),
    `Scale="${num(sx)},${num(sy)},${num(sz)}"`,
    `Type="${escapeXml(edit.type)}"`,
    ...(edit.pitch ? [`Pitch="${num(radians(edit.pitch))}"`] : []),
    ...(edit.roll ? [`Roll="${num(radians(edit.roll))}"`] : []),
    ...(edit.tint ? [`TintColor="${edit.tint}"`] : []),
  ].join(" ");
  const element =
    flags.length === 0
      ? `${indent}<ObjectDoodad ${attrs}/>`
      : [`${indent}<ObjectDoodad ${attrs}>`, ...flags.map((flag) => `${indent}${indent || "    "}<Flag Index="${flag}" Value="1"/>`), `${indent}</ObjectDoodad>`].join(newline);
  const at = last ? last.end : xml.lastIndexOf(newline, xml.lastIndexOf("</PlacedObjects>"));
  if (at < 0) throw new Error("Objects has no </PlacedObjects> to add a doodad before");
  return { xml: xml.slice(0, at) + newline + element + xml.slice(at), change: `doodad ${id} (${edit.type}): added at (${num(edit.at.x)}, ${num(edit.at.y)}, ${num(z)})` };
}

/** `xml` without the doodad group lines that list `id`. */
function removeGroupMember(xml: string, id: number): string {
  return xml.replace(new RegExp(`\\r?\\n[ \\t]*<GroupObject Id="${id}"\\s*/>`, "g"), "");
}

/** A region's shapes as written, each with where it sits in the region's text. */
function regionShapes(text: string): { shape: RegionShape; start: number; end: number }[] {
  const out: { shape: RegionShape; start: number; end: number }[] = [];
  for (const match of text.matchAll(/<shape type="(\w+)">([\s\S]*?)<\/shape>/g)) {
    const body = match[2]!;
    const value = (tag: string) => new RegExp(`<${tag} value="([^"]*)"`).exec(body)?.[1];
    const pair = (tag: string) => (value(tag) ?? "").split(",").map(Number);
    const negative = /<negative\s*\/>/.test(body) ? { negative: true } : {};
    const [cx, cy] = pair("center");
    const shape: RegionShape | undefined =
      match[1] === "rect"
        ? { type: "rect", quad: pair("quad") as [number, number, number, number], ...negative }
        : match[1] === "circle"
          ? { type: "circle", center: { x: cx!, y: cy! }, radius: Number(value("radius")), ...negative }
          : match[1] === "diamond"
            ? { type: "diamond", center: { x: cx!, y: cy! }, width: Number(value("width")), height: Number(value("height")), ...negative }
            : undefined;
    if (shape) out.push({ shape, start: match.index!, end: match.index! + match[0].length });
  }
  return out;
}

/** A shape's values, written into its own element in place (`<quad>`, `<center>`, `<radius>`, `<width>`, `<height>`). */
function rewriteShape(text: string, shape: RegionShape): string {
  const set = (body: string, tag: string, value: string) => body.replace(new RegExp(`(<${tag} value=")[^"]*(")`), `$1${value}$2`);
  if (shape.type === "rect") return set(text, "quad", shape.quad.map(num).join(","));
  const centred = set(text, "center", `${num(shape.center.x)},${num(shape.center.y)}`);
  if (shape.type === "circle") return set(centred, "radius", num(shape.radius));
  return set(set(centred, "width", num(shape.width)), "height", num(shape.height));
}

/** A shape's lines as the Editor writes them, in the file's indent. */
function shapeLines(shape: RegionShape, indent: string, unit: string): string[] {
  const inner = indent + unit;
  const negative = shape.negative ? [`${inner}<negative/>`] : [];
  if (shape.type === "rect") return [`${indent}<shape type="rect">`, ...negative, `${inner}<quad value="${shape.quad.map(num).join(",")}"/>`, `${indent}</shape>`];
  const center = `${inner}<center value="${num(shape.center.x)},${num(shape.center.y)}"/>`;
  if (shape.type === "circle") return [`${indent}<shape type="circle">`, ...negative, center, `${inner}<radius value="${num(shape.radius)}"/>`, `${indent}</shape>`];
  return [`${indent}<shape type="diamond">`, ...negative, center, `${inner}<width value="${num(shape.width)}"/>`, `${inner}<height value="${num(shape.height)}"/>`, `${indent}</shape>`];
}

function editRegion(found: Located, edit: Extract<Edit, { op: "move" | "resize" | "redraw" }>, newline: string): { text: string; change: string } {
  const shapes = regionShapes(found.text);
  // A shape this tool can't read would be left out of a move or kept through a redraw.
  const unknown = [...found.text.matchAll(/<shape type="(\w+)"/g)].map((match) => match[1]!).filter((type) => type !== "rect" && type !== "circle" && type !== "diamond");
  if (unknown.length > 0) throw new Error(`the region has a shape this tool doesn't read (${unknown.join(", ")}): edit it in the Editor`);
  if (edit.op === "redraw") {
    const unit = found.indent || "    ";
    const lines = edit.shapes.flatMap((shape) => shapeLines(shape, found.indent + unit, unit));
    let text = found.text;
    // Out with the old shapes, each with its line; the new ones where the first stood, else before </region>.
    for (const { start, end } of [...shapes].reverse()) {
      const lineStart = text.lastIndexOf("\n", start);
      const from = text[lineStart - 1] === "\r" ? lineStart - 1 : lineStart;
      text = text.slice(0, from) + text.slice(end);
    }
    const first = shapes[0];
    const at = first ? (() => {
      const lineStart = found.text.lastIndexOf("\n", first.start);
      return found.text[lineStart - 1] === "\r" ? lineStart - 1 : lineStart;
    })() : text.lastIndexOf(newline, text.lastIndexOf("</region>"));
    text = text.slice(0, at) + lines.map((line) => newline + line).join("") + text.slice(at);
    return { text, change: `redrawn as ${edit.shapes.map((shape) => shape.type).join(", ")}` };
  }
  if (shapes.length === 0) throw new Error("the region has no shapes to move or resize");
  const [x0, y0, x1, y1] = regionBounds(shapes.map((item) => item.shape));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let transform: (x: number, y: number) => [number, number];
  let size: (dx: number, dy: number) => [number, number] = (dx, dy) => [dx, dy];
  let change: string;
  if (edit.op === "move") {
    const dx = edit.to ? edit.to.x - cx : edit.by!.x;
    const dy = edit.to ? edit.to.y - cy : edit.by!.y;
    transform = (x, y) => [x + dx, y + dy];
    change = `moved by (${num(dx)}, ${num(dy)}), its centre now (${num(cx + dx)}, ${num(cy + dy)})`;
  } else {
    const sx = typeof edit.scale === "number" ? edit.scale : edit.scale.x;
    const sy = typeof edit.scale === "number" ? edit.scale : edit.scale.y;
    transform = (x, y) => [cx + (x - cx) * sx, cy + (y - cy) * sy];
    size = (dx, dy) => [dx * sx, dy * sy];
    if (sx !== sy && shapes.some((item) => item.shape.type === "circle")) throw new Error("a circle can't be stretched: resize it by one scale, or redraw it");
    change = `resized by ${num(sx)}${sx === sy ? "" : ` × ${num(sy)}`} about its centre (${num(cx)}, ${num(cy)})`;
  }
  let text = found.text;
  for (const { shape, start, end } of [...shapes].reverse()) {
    let moved: RegionShape;
    if (shape.type === "rect") {
      const [ax, ay] = transform(shape.quad[0], shape.quad[1]);
      const [bx, by] = transform(shape.quad[2], shape.quad[3]);
      moved = { ...shape, quad: [ax, ay, bx, by] };
    } else {
      const [x, y] = transform(shape.center.x, shape.center.y);
      if (shape.type === "circle") moved = { ...shape, center: { x, y }, radius: size(shape.radius, shape.radius)[0] };
      else {
        const [width, height] = size(shape.width, shape.height);
        moved = { ...shape, center: { x, y }, width, height };
      }
    }
    text = text.slice(0, start) + rewriteShape(text.slice(start, end), moved) + text.slice(end);
  }
  return { text, change };
}
