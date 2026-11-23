import { xmlElements } from "./xml-elements.js";

export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

export type PlacedDoodad = {
  readonly id: number;
  readonly type: string;
  readonly name?: string;
  readonly position: Vec3;
  /** Radians. Yaw is the Editor's `Rotation`. */
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  readonly scale: Vec3;
  readonly variation?: number;
  /** "r,g,b,a" 0-255, as the Editor writes `TintColor`. */
  readonly tintColor?: string;
  readonly teamColor?: string;
  /** Flags set to 1: HeightOffset, HeightAbsolute, ForcePlacement, NoDoodadFootprint, ... */
  readonly flags: readonly string[];
};

export type PlacedUnit = {
  readonly id: number;
  readonly type: string;
  readonly player: number;
  readonly position: Vec3;
  readonly yaw: number;
  readonly scale: Vec3;
  readonly variation?: number;
  readonly resources?: number;
  readonly flags: readonly string[];
  /** What the Editor wrote that this reader doesn't read (attributes, child elements, other flags). */
  readonly extras: readonly string[];
};

export type PlacedPoint = {
  readonly id: number;
  readonly name?: string;
  readonly type?: string;
  readonly position: Vec3;
  readonly yaw: number;
  readonly scale: Vec3;
  readonly flags: readonly string[];
  readonly extras: readonly string[];
};

export type PlacedCamera = {
  readonly id: number;
  readonly name: string;
  readonly position: Vec3;
  readonly yaw: number;
  readonly target?: { readonly x: number; readonly y: number };
  /** The Editor's CameraValue entries in order (FieldOfView, Distance, Pitch, Yaw...). */
  readonly values: readonly { readonly index: string; readonly value: number }[];
  readonly flags: readonly string[];
  readonly extras: readonly string[];
};

export type ObjectsFile = {
  readonly doodads: readonly PlacedDoodad[];
  readonly units: readonly PlacedUnit[];
  readonly points: readonly PlacedPoint[];
  readonly cameras: readonly PlacedCamera[];
};

function vec3(value: string | undefined, fallback: number): Vec3 {
  const [x = fallback, y = fallback, z = fallback] = (value ?? "").split(",").map(Number);
  return { x, y, z };
}

function flags(body: string): string[] {
  return xmlElements(body, "Flag")
    .filter(({ attrs }) => attrs.Value === "1")
    .map(({ attrs }) => attrs.Index ?? "");
}

/** Attributes and child elements beyond those read (flags are read separately). */
function extras(attrs: Readonly<Record<string, string>>, body: string, read: readonly string[], defaults: Readonly<Record<string, string>> = {}): string[] {
  const out = Object.keys(attrs).filter((name) => !read.includes(name) && attrs[name] !== defaults[name]);
  for (const [, tag] of body.matchAll(/<(\w+)/g)) {
    if (tag !== "CameraValue" && tag !== "Flag" && !out.includes(tag!)) out.push(tag!);
  }
  return out;
}

/** Reads the Objects file: placed doodads (with full transforms), units, points and cameras. */
export function readObjectsXml(xml: string): ObjectsFile {
  const doodads = xmlElements(xml, "ObjectDoodad").map(({ attrs, body }) => ({
    id: Number(attrs.Id),
    type: attrs.Type ?? "",
    ...(attrs.Name ? { name: attrs.Name } : {}),
    position: vec3(attrs.Position, 0),
    yaw: Number(attrs.Rotation ?? 0),
    pitch: Number(attrs.Pitch ?? 0),
    roll: Number(attrs.Roll ?? 0),
    scale: vec3(attrs.Scale, 1),
    ...(attrs.Variation !== undefined ? { variation: Number(attrs.Variation) } : {}),
    ...(attrs.TintColor ? { tintColor: attrs.TintColor } : {}),
    ...(attrs.TeamColor ? { teamColor: attrs.TeamColor } : {}),
    flags: flags(body),
  }));
  const units = xmlElements(xml, "ObjectUnit").map(({ attrs, body }) => ({
    id: Number(attrs.Id),
    type: attrs.UnitType ?? "",
    player: Number(attrs.Player ?? 0),
    position: vec3(attrs.Position, 0),
    yaw: Number(attrs.Rotation ?? 0),
    scale: vec3(attrs.Scale, 1),
    ...(attrs.Variation !== undefined ? { variation: Number(attrs.Variation) } : {}),
    ...(attrs.Resources !== undefined ? { resources: Number(attrs.Resources) } : {}),
    flags: flags(body),
    extras: extras(attrs, body, ["Id", "UnitType", "Player", "Position", "Rotation", "Scale", "Variation", "Resources"]),
  }));
  const points = xmlElements(xml, "ObjectPoint").map(({ attrs, body }) => ({
    id: Number(attrs.Id),
    ...(attrs.Name ? { name: attrs.Name } : {}),
    ...(attrs.Type ? { type: attrs.Type } : {}),
    position: vec3(attrs.Position, 0),
    yaw: Number(attrs.Rotation ?? 0),
    scale: vec3(attrs.Scale, 1),
    flags: flags(body),
    extras: extras(attrs, body, ["Id", "Name", "Type", "Position", "Rotation", "Scale"], { Color: "0,0,0,0" }),
  }));
  const cameras = xmlElements(xml, "ObjectCamera").map(({ attrs, body }) => {
    const [tx, ty] = (attrs.CameraTarget ?? "").split(",").map(Number);
    return {
      id: Number(attrs.Id),
      name: attrs.Name ?? "",
      position: vec3(attrs.Position, 0),
      yaw: Number(attrs.Rotation ?? 0),
      ...(attrs.CameraTarget ? { target: { x: tx!, y: ty! } } : {}),
      values: xmlElements(body, "CameraValue").map((value) => ({ index: value.attrs.Index ?? "", value: Number(value.attrs.Value) })),
      flags: flags(body),
      extras: extras(attrs, body, ["Id", "Name", "Position", "Rotation", "CameraTarget"], { Scale: "1,1,1", Color: "0,0,0,0" }),
    };
  });
  return { doodads, units, points, cameras };
}

/**
 * What an Editor save writes for an attribute it leaves out: the Editor drops `Variation="0"`,
 * `Rotation="0"`, `Pitch="0"` and `Roll="0"`, and a unit scale, when it saves.
 */
const OBJECT_DEFAULTS: Readonly<Record<string, string>> = { Rotation: "0", Pitch: "0", Roll: "0", Variation: "0", Scale: "1,1,1" };

/**
 * Flags the Editor sets on every doodad it saves that don't change what the doodad is: a compiled
 * doodad's z is its absolute height already, and the Editor adds `HeightAbsolute` to say so.
 */
const EDITOR_SAVE_FLAGS: ReadonlySet<string> = new Set(["HeightAbsolute"]);

/** One placed object as what it says, not how the Editor laid it out. */
export type NormalObject = {
  readonly tag: string;
  /** Every attribute, with the defaults an Editor save leaves out filled in. */
  readonly attrs: Readonly<Record<string, string>>;
  /** The flags set to 1, sorted, without those an Editor save adds (`HeightAbsolute`). */
  readonly flags: readonly string[];
  /** Its other child elements (camera values, AI flags, a Flag not set to 1 …), one to a line, trimmed. */
  readonly rest: string;
};

/**
 * The normal form of one Objects element (`<ObjectDoodad …>…</ObjectDoodad>`), so an object the
 * Editor only re-saved compares the same as the one the compile wrote: attribute and flag order,
 * indentation, dropped defaults and the save's own flags fall away. Numbers are left as written,
 * for the comparer to weigh with sync's tolerances.
 */
export function normalObject(text: string): NormalObject {
  const tag = /^\s*<(\w+)/.exec(text)?.[1] ?? "";
  const element = xmlElements(text, tag)[0];
  const attrs = { ...OBJECT_DEFAULTS, ...(element?.attrs ?? {}) };
  const body = element?.body ?? "";
  const set = flags(body)
    .filter((flag) => !EDITOR_SAVE_FLAGS.has(flag))
    .sort();
  const rest = body
    // Only the flags read as set leave it: any other Flag element (one with no Value) stays, to be compared.
    .replace(/<Flag\s+Index="[^"]*"\s+Value="1"\s*\/>/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join("\n");
  return { tag, attrs, flags: set, rest };
}
