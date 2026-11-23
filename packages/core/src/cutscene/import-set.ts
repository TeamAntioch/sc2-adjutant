// Imports a cinematic set from the catalog into a Mission or a mod as data (<folder>/sets/<slug>.json):
// its pieces, marks, named cameras, Lights and lamps, read node by node from one occurrence's file
// and moved into the set's own frame. What the `import-set` CLI and the MCP server's `import_set`
// tool both run.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { type SetCamera, type SetData, type SetLamp, type SetMark, type SetPiece, SetSchema, type SetSound } from "../domain/cinematic-set.js";
import { setSourceDependency } from "../map/game-packages.js";
import { readWorkspaceMod } from "../mods/workspace-mods.js";
import { missionBlueprintPath, type Workspace } from "../plugins/workspace.js";
import { loadCutsceneSources } from "./load-sources.js";
import { type CutsceneNode, readCutscene, vectorAttr } from "./read-cutscene.js";
import { buildSetCatalog, type CinematicSet, type CutsceneSource, modelPathName, NEAR, orbitEye, type SetOccurrence } from "./set-catalog.js";
import { cutsceneSourceKinds } from "./source-kinds.js";
import { LOOP_FOREVER } from "./write-shot-cutscene.js";

type Vec3 = readonly [number, number, number];

const DEG = Math.PI / 180;

/** The set's 0,0,0 is its pieces' centre snapped to this grid, so a set built at its file's origin keeps the Editor's numbers. */
const FRAME_GRID = 8;
/** An actor's model as the catalogue names it: its model entry's id, else its model file's name. */
const modelOf = (node: CutsceneNode): string | undefined => node.attrs.modelLink || (node.attrs.modelPath ? modelPathName(node.attrs.modelPath) : undefined);
/** Where an actor or lamp with no position sits: the Editor leaves the attribute out at the file's origin, as a one-piece room often is. */
const ORIGIN: Vec3 = [0, 0, 0];

export type ImportedSet = {
  readonly set: SetData;
  /** The set's file name in the Mission's sets folder, without .json: its catalog id. */
  readonly slug: string;
  /** What was left out or renamed, for the author. */
  readonly notes: readonly string[];
};

/** Six decimals (the Editor's own precision), with no -0. */
const round = (value: number): number => Math.round(value * 1e6) / 1e6 + 0;
const number = (node: CutsceneNode, name: string): number | undefined => {
  const value = node.attrs[name];
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const quad = (node: CutsceneNode, name: string): [number, number, number, number] | undefined => {
  const parts = node.attrs[name]?.split(",").map(Number);
  return parts && parts.length === 4 && parts.every(Number.isFinite) ? [round(parts[0]!), round(parts[1]!), round(parts[2]!), round(parts[3]!)] : undefined;
};

const baseName = (file: string): string => file.split("/").at(-1)!.replace(/\.sc2cutscene$/i, "").toLowerCase();

/** The occurrence `file` names (its path in its source, or its file name with or without .SC2Cutscene), else the richest. */
function pickOccurrence(set: CinematicSet, file: string | undefined): SetOccurrence {
  if (!file) return set.occurrences[0]!;
  const wanted = file.replace(/\\/g, "/").toLowerCase();
  const exact = set.occurrences.filter((entry) => entry.file.toLowerCase() === wanted);
  const named = exact.length ? exact : set.occurrences.filter((entry) => baseName(entry.file) === baseName(wanted));
  const listed = set.occurrences.map((entry) => `${entry.origin}:${entry.file}`).join("; ");
  if (named.length === 1) return named[0]!;
  if (named.length > 1) throw new Error(`${file} names ${named.length} files of ${set.name}; give its path: ${listed}`);
  throw new Error(`${set.name} isn't in ${file}; it is in ${listed}`);
}

function findSet(sets: readonly CinematicSet[], name: string): CinematicSet {
  const wanted = name.trim().toLowerCase();
  const found = sets.find((set) => set.name.toLowerCase() === wanted) ?? sets.find((set) => set.id === wanted);
  if (found) return found;
  const words = wanted.split(/\W+/).filter((word) => word.length > 2);
  const close = sets.filter((set) => words.some((word) => set.name.toLowerCase().includes(word))).map((set) => set.name);
  throw new Error(`No set called ${name} in the catalog of these sources${close.length ? `; did you mean ${close.slice(0, 8).join(", ")}?` : ""}`);
}

/**
 * The set the catalog calls `name` (or by its id), from its richest occurrence or the one `file`
 * names. `sources` must hold that occurrence's file. Its frame's 0,0,0 is the file's point `origin`
 * when given (a set imported again keeps the frame its Cinematics place it by), else its pieces'
 * centre snapped to FRAME_GRID.
 */
export function importSet(sets: readonly CinematicSet[], sources: readonly CutsceneSource[], name: string, options: { readonly file?: string; readonly origin?: Vec3 } = {}): ImportedSet {
  const catalogued = findSet(sets, name);
  const occurrence = pickOccurrence(catalogued, options.file);
  const source = sources.find((entry) => entry.origin === occurrence.origin && entry.path === occurrence.file);
  if (!source) throw new Error(`The sources don't hold ${occurrence.origin}:${occurrence.file}`);
  const nodes = new Map<string, CutsceneNode>();
  // What the Editor switched off, with all it holds: it plays nothing.
  const off = new Set<CutsceneNode>();
  const collect = (node: CutsceneNode, disabled: boolean): void => {
    if (node.attrs.guid) nodes.set(node.attrs.guid, node);
    if (disabled || node.attrs.enabled === "0") off.add(node);
    node.children.forEach((child) => collect(child, disabled || node.attrs.enabled === "0"));
  };
  const root = readCutscene(source.xml);
  collect(root, false);
  /** The enabled children of `node` tagged `tag`, and their enabled children tagged `element`. */
  const elementsOf = (node: CutsceneNode, tag: string, element: string): CutsceneNode[] =>
    node.children.filter((child) => child.tag === tag && !off.has(child)).flatMap((child) => child.children.filter((entry) => entry.tag === element && !off.has(entry)));
  const labelOf = (node: CutsceneNode | undefined): string => node?.attrs.modelLink || node?.attrs.name || "something not in the file";
  const notes: string[] = [];

  const origin: Vec3 = options.origin ?? [round(Math.round(occurrence.centre[0] / FRAME_GRID) * FRAME_GRID), round(Math.round(occurrence.centre[1] / FRAME_GRID) * FRAME_GRID), 0];
  const local = (at: readonly number[]): [number, number, number] => [round(at[0]! - origin[0]), round(at[1]! - origin[1]), round(at[2]! - origin[2])];

  /**
   * A name unique among the set's `kind` (cameras, marks), since Cinematics name them: a repeat is
   * numbered from 2, past any number the file already uses.
   */
  const unique = (kind: string): ((name: string) => string) => {
    const taken = new Set<string>();
    const repeated = new Set<string>();
    return (name) => {
      let given = name;
      for (let n = 2; taken.has(given); n++) given = `${name} ${n}`;
      if (given !== name && !repeated.has(name)) {
        repeated.add(name);
        notes.push(`The file has a ${kind} called "${name}" twice or more; the later ones are numbered (${given}, ...)`);
      }
      taken.add(given);
      return given;
    };
  };

  // The set's nodes: its pieces (matched by guid and model), and its lamps.
  const pieceNodes = occurrence.pieces.map((entry) => {
    const found = nodes.get(entry.guid);
    return found?.tag === "CCutsceneNodeActor" && modelOf(found) === entry.model ? found : undefined;
  });
  const lampNodes = occurrence.lamps.flatMap((guid) => {
    const found = nodes.get(guid);
    return found?.tag === "CCutsceneNodeLight" ? [found] : [];
  });
  const tiesOf = (node: CutsceneNode): string[] => node.children.filter((child) => child.tag === "CCutsceneNodeActiveShot").map((child) => child.attrs.cameraGUID ?? "");

  // Cameras first: pieces, marks and lamps name the shots they're tied to by camera name. The set's
  // cameras are the ones whose target or eye is near its pieces, in file order: conversation
  // cameras (some Campaigns') aim far behind the actor they frame, so only their eye is on the set.
  const scenery = occurrence.pieces.map((entry) => entry.at);
  const nearSet = (point: readonly number[]): boolean => scenery.some((at) => Math.hypot(at[0] - point[0]!, at[1] - point[1]!) <= NEAR);
  const films = (camera: SetCamera): boolean => nearSet(camera.target) || nearSet(cameraEye(camera));
  const cameraNames = new Map<string, string>();
  const cameras: SetCamera[] = [];
  const cameraName = unique("camera");
  const fileFrame = (at: readonly number[]): [number, number, number] => [at[0]!, at[1]!, at[2]!];
  const moving: string[] = [];
  for (const [guid, node] of nodes) {
    if (!/^CCutsceneNode(Target)?Camera$/.test(node.tag)) continue;
    const inFile = node.tag === "CCutsceneNodeTargetCamera" ? targetCamera(node) : orbitCamera(node, nodes, fileFrame);
    if (!inFile || !films(inFile)) continue;
    const name = cameraName(inFile.name);
    cameraNames.set(guid, name);
    cameras.push({ ...inFile, target: local(inFile.target), name });
    if (inFile.moves && node.tag === "CCutsceneNodeTargetCamera") moving.push(name);
  }
  if (moving.length) notes.push(`Target camera${moving.length === 1 ? "" : "s"} ${moving.join(", ")} move${moving.length === 1 ? "s" : ""} (a keyed target, eye, lens or roll): imported at the first frame, marked moves`);

  /** The imported cameras an object is tied to; null when it is tied only to others (cameras off the set, or with no eye), so never seen through this set's. */
  const shotsOf = (node: CutsceneNode): { shots?: [string, ...string[]] } | null => {
    const ties = tiesOf(node);
    if (ties.length === 0) return {};
    const names = [...new Set(ties.flatMap((guid) => (cameraNames.has(guid) ? [cameraNames.get(guid)!] : [])))];
    return names.length ? { shots: names as [string, ...string[]] } : null;
  };

  const pieces: SetPiece[] = [];
  let unseen = 0;
  occurrence.pieces.forEach((entry, index) => {
    const node = pieceNodes[index];
    const shots = node ? shotsOf(node) : {};
    if (shots === null) unseen++;
    else pieces.push({ ...(node ? piece(node, local, (text) => notes.push(text)) : { model: entry.model, at: local(entry.at) }), ...shots });
  });
  if (unseen) notes.push(`Left out ${unseen} piece${unseen === 1 ? "" : "s"} seen only through cameras not imported`);

  const lamps: SetLamp[] = [];
  // The node of each lamp kept, in `lamps`' order, for its attachment.
  const keptLamps: CutsceneNode[] = [];
  let unlit = 0;
  for (const node of lampNodes) {
    if (node.attrs.type !== undefined && node.attrs.type !== "1" && node.attrs.type !== "2") {
      notes.push(`Left out lamp ${node.attrs.name || "Light"}: light type ${node.attrs.type}, where only omni (1) and spot (2) lights are imported`);
      continue;
    }
    const shots = shotsOf(node);
    if (shots === null) unlit++;
    else {
      lamps.push({ ...lamp(node, local), ...shots });
      keptLamps.push(node);
    }
  }
  if (unlit) notes.push(`Left out ${unlit} lamp${unlit === 1 ? "" : "s"} lighting only cameras not imported`);

  // A mark tied only to cameras not imported gets empty shots: it isn't seen through any of the set's.
  const markName = unique("mark");
  const marks: SetMark[] = occurrence.marks.map((mark) => {
    const node = nodes.get(mark.guid);
    const shots = node ? shotsOf(node) : {};
    return { name: markName(mark.name), model: mark.model, at: local(mark.at), facing: round(mark.facing), ...(shots ?? { shots: [] }) };
  });
  const markOf = new Map(occurrence.marks.map((mark, index) => [mark.guid, marks[index]!.name]));

  // A character's look-at at another's (its first, held all through: a set has no clock).
  occurrence.marks.forEach((mark, index) => {
    const node = nodes.get(mark.guid);
    const [first, ...later] = (node ? elementsOf(node, "CCutsceneNodeLookAt", "CCutsceneElementLookAt") : []).sort((a, b) => (number(a, "start") ?? 0) - (number(b, "start") ?? 0));
    if (!first) return;
    const target = markOf.get(first.attrs.lookAtGUID ?? "");
    const name = marks[index]!.name;
    if (target === undefined || target === name) notes.push(`Left out the ${name}'s look-at, at ${labelOf(nodes.get(first.attrs.lookAtGUID ?? ""))}, which isn't another mark`);
    else marks[index] = { ...marks[index]!, lookAt: { mark: target, ...(first.attrs.lookAtType ? { type: first.attrs.lookAtType } : {}), ...(first.attrs.lookAtAttachId ? { point: first.attrs.lookAtAttachId } : {}) } };
    for (const look of later) notes.push(`Left out the ${name}'s later look-at, at ${labelOf(nodes.get(look.attrs.lookAtGUID ?? ""))}: a set's mark looks at one other mark all through`);
  });

  // A lamp attached to a character rides its mark; one attached to anything else stands where it is.
  lamps.forEach((entry, index) => {
    const attachment = elementsOf(keptLamps[index]!, "CCutsceneNodeAttachment", "CCutsceneElementAttachment")[0];
    if (!attachment) return;
    if (!attachment.attrs.attachName) return void notes.push(`Lamp ${entry.name} is attached to ${labelOf(nodes.get(attachment.attrs.attachGuid ?? ""))} at no attach point: it stands where it is`);
    const mark = markOf.get(attachment.attrs.attachGuid ?? "");
    if (mark === undefined) return void notes.push(`Lamp ${entry.name} is attached to ${labelOf(nodes.get(attachment.attrs.attachGuid ?? ""))}, which isn't a mark: it stands where it is`);
    const triple = (prefix: string): [number, number, number] => ["X", "Y", "Z"].map((axis) => round(number(attachment, `${prefix}${axis}`) ?? 0)) as [number, number, number];
    const [offset, rotation] = [triple("offset"), triple("rotation")];
    lamps[index] = { ...entry, attach: { mark, point: attachment.attrs.attachName, ...(offset.some(Boolean) ? { offset } : {}), ...(rotation.some(Boolean) ? { rotation } : {}) } };
  });

  // The set's ambience: a sound looping all through the file. Others are a scene's cues.
  const fileMs = Math.max(0, ...[...nodes.values()].filter((node) => node.tag.startsWith("CCutsceneElement") && !off.has(node)).map((node) => (number(node, "start") ?? 0) + (number(node, "duration") ?? 0)));
  const sounds: SetSound[] = [];
  for (const node of [...nodes.values()].filter((found) => found.tag === "CCutsceneNodeSound" && !off.has(found) && found.attrs.soundLink)) {
    const lifetime = node.children.find((child) => child.tag === "CCutsceneElementObject");
    const [start, duration] = [number(lifetime ?? node, "start") ?? 0, number(lifetime ?? node, "duration") ?? 0];
    const loops = node.attrs.mode === LOOP_FOREVER && start === 0 && (lifetime?.attrs.lockedToEnd === "1" || duration >= fileMs);
    if (!loops) {
      notes.push(`Left out sound ${node.attrs.soundLink}: it doesn't loop all through the file, so it's a cue for a Cinematic's sounds`);
      continue;
    }
    const volume = number(node, "volumeScale");
    sounds.push({ sound: node.attrs.soundLink!, ...(volume !== undefined && volume !== 1 ? { volume: round(volume) } : {}) });
  }
  const set = SetSchema.parse({
    name: catalogued.name,
    provenance: { setId: catalogued.id, catalogName: catalogued.name, kind: occurrence.origin, file: occurrence.file, origin },
    lights: [...occurrence.lights],
    pieces,
    marks,
    cameras,
    lamps,
    ...(sounds.length ? { sounds } : {}),
  });
  // A set from a story package's cutscene is made of that package's models (game-packages.ts).
  const needs = occurrence.origin === "blizzard" ? setSourceDependency(occurrence.file) : undefined;
  if (needs) {
    notes.push(`Its models are ${needs.name}'s, from the cutscene's package: a map that plays it needs ${needs.dependency} among its dependencies, or through a mod it depends on, or the set isn't there in the game`);
  }
  return { set, slug: catalogued.id, notes };
}

function piece(node: CutsceneNode, local: (at: readonly number[]) => [number, number, number], note: (text: string) => void): SetPiece {
  const rotation = vectorAttr(node, "rotation")?.map(round) as Vec3 | undefined;
  const scale = vectorAttr(node, "scale")?.map(round) as Vec3 | undefined;
  const tint = ["tintColorRed", "tintColorGreen", "tintColorBlue"].map((name) => number(node, name));
  const [diffuse, emissive] = [quad(node, "teamColorDiffuse"), quad(node, "teamColorEmissive")];
  const variation = number(node, "variation");
  const opacity = number(node, "opacity");
  // The loop it plays, as a set piece loops one: the first looping anim of its body layer (the one
  // called Animation Layer, else its first switched on, since faces and eyes get layers of their own).
  // A one-shot, such as a Birth before the loop, isn't one; a bare Stand is the default.
  const layers = node.children.filter((child) => child.tag === "CCutsceneNodeAnimLayer" && child.attrs.enabled !== "0");
  const body = (layers.find((layer) => layer.attrs.name === "Animation Layer") ?? layers[0])?.children.filter((child) => child.tag === "CCutsceneElementAnim" && child.attrs.anim) ?? [];
  const played = body.find((child) => child.attrs.looping === "1");
  const label = node.attrs.name || modelOf(node)!;
  if (body.length && !played) note(`${label} plays only ${body[0]!.attrs.anim} once, which a set piece can't: it plays its Stand`);
  const anim = played?.attrs.anim;
  const timeScale = played && number(played, "timeScale");
  if (timeScale !== undefined && timeScale <= 0) note(`${label}'s anim plays at speed ${round(timeScale)}, frozen, which a set piece can't: it plays at its own speed`);
  const animSpeed = timeScale !== undefined && timeScale > 0 ? round(timeScale) : undefined;
  return {
    model: modelOf(node)!,
    ...(node.attrs.modelLink ? {} : { modelPath: node.attrs.modelPath!.replace(/\\/g, "/") }),
    at: local(vectorAttr(node, "position") ?? ORIGIN),
    ...(rotation && rotation.some((value) => value !== 0) ? { rotation: rotation[0] === 0 && rotation[1] === 0 ? rotation[2] : [...rotation] } : {}),
    ...(scale && scale.some((value) => value !== 1) ? { scale: scale[0] === scale[1] && scale[1] === scale[2] ? scale[0] : [...scale] } : {}),
    ...(variation ? { variation } : {}),
    ...(tint.some((value) => value !== undefined) ? { tint: tint.map((value) => round(value ?? 1)) as [number, number, number] } : {}),
    ...(diffuse || emissive ? { teamColor: { ...(diffuse ? { diffuse } : {}), ...(emissive ? { emissive } : {}) } } : {}),
    ...(opacity !== undefined && opacity !== 1 ? { opacity: round(opacity) } : {}),
    ...(anim && anim !== "Stand" ? { anim } : {}),
    ...(animSpeed !== undefined && animSpeed !== 1 ? { animSpeed } : {}),
    ...(node.attrs.enabled === "0" || node.attrs.visible === "0" ? { hidden: true as const } : {}),
  };
}

/**
 * Where an orbit camera's eye sits in the file's frame: `distance` back from its target against the
 * view direction, which at yaw θ is (sin θ, −cos θ), and above the target by its height offset plus
 * `distance` · sin(pitch). See docs/reference/editor-and-engine.md, "Where a cutscene camera's eye sits".
 */
export function cameraEye(camera: Pick<SetCamera, "target" | "distance" | "pitch" | "yaw" | "heightOffset">): [number, number, number] {
  const [x, y] = orbitEye(camera.target, camera.distance, camera.pitch, camera.yaw);
  return [x, y, camera.target[2] + (camera.heightOffset ?? 0) + Math.sin(camera.pitch * DEG) * camera.distance];
}

/**
 * An orbit camera's values. A camera tied to a rig (an invisible actor at an attach point, as some
 * Campaigns tie most of their cameras) films from its own position while the rig stands still: neither the
 * rig's position nor the attachment's offset places it (docs/reference/editor-and-engine.md). A rig
 * with keys marks the camera `moves`, kept at its own position: how a moving rig carries a camera
 * hasn't been seen.
 */
function orbitCamera(node: CutsceneNode, nodes: ReadonlyMap<string, CutsceneNode>, local: (at: readonly number[]) => [number, number, number]): SetCamera | undefined {
  const [distance, pitch, yaw] = ["distance", "pitch", "yaw"].map((name) => number(node, name));
  const position = vectorAttr(node, "position");
  if (!position || distance === undefined || pitch === undefined || yaw === undefined) return undefined;
  const attachment = node.children.find((child) => child.tag === "CCutsceneNodeAttachment")?.children.find((child) => child.tag === "CCutsceneElementAttachment");
  const rig = attachment?.attrs.attachGuid ? nodes.get(attachment.attrs.attachGuid) : undefined;
  const animated = (of: CutsceneNode | undefined): boolean => !!of?.children.some((child) => child.tag === "CCutsceneNodePropertyValue" || child.tag === "CCutsceneNodeFollowPath");
  const heightOffset = number(node, "heightOffset");
  const { fov, verticalFov, ...rest } = lens(node, distance, (name) => number(node, name));
  return {
    name: node.attrs.name || "Camera",
    target: local(position),
    distance: round(distance),
    pitch: round(pitch),
    yaw: round(yaw),
    fov,
    ...(verticalFov === false ? { verticalFov } : {}),
    ...(heightOffset ? { heightOffset: round(heightOffset) } : {}),
    ...rest,
    ...(animated(node) || animated(rig) ? { moves: true as const } : {}),
  };
}

/** What both kinds of camera share: lens, vertical-fov flag, roll, depth of field and shadow distance, each read by `value`. */
function lens(node: CutsceneNode, distance: number, value: (name: string) => number | undefined): Pick<SetCamera, "fov" | "verticalFov" | "roll" | "blur" | "focalDepth" | "falloff" | "shadowDistance"> {
  const blur = value("depthOfField");
  const doftype = value("doftype") ?? 0;
  const roll = value("roll");
  const shadowClip = value("shadowClip");
  return {
    fov: round(value("fov") ?? 27.8),
    ...(node.attrs.verticalFOV === "1" ? {} : { verticalFov: false as const }),
    ...(roll ? { roll: round(roll) } : {}),
    ...(blur && doftype === 0
      ? { blur: round(blur), focalDepth: round(value("focalDepth") ?? distance), falloff: { far: round(value("falloffEnd") ?? 2), near: round(value("falloffStartNear") ?? 0) } }
      : {}),
    // 75 is the default a camera's shadowDistance leaves out, and the writer's; the Editor saves some as 74.999992.
    ...(shadowClip !== undefined && shadowClip > 0 && Math.abs(shadowClip - 75) > 1e-3 ? { shadowDistance: round(shadowClip) } : {}),
  };
}

/** The properties whose keys make a target camera move: where it looks from and at, its lens and its roll. */
const TARGET_CAMERA_MOTION = ["targetPositionX", "targetPositionY", "targetPositionZ", "eyePositionX", "eyePositionY", "eyePositionZ", "fov", "roll"];

/**
 * A target camera (CCutsceneNodeTargetCamera: a target point and an eye point, as Blizzard's story
 * sets film) as the orbit camera a set holds: the eye's offset from the target gives `distance`,
 * `pitch` and `yaw`, the inverse of `cameraEye`. A keyed property is read at its first key (the
 * camera's first frame, which the Editor's attribute needn't be: it saves the value where its
 * timeline stood); keys that vary in where it looks, its lens or its roll mark it `moves`. Undefined
 * when its eye is its target, which gives no direction.
 */
function targetCamera(node: CutsceneNode): SetCamera | undefined {
  const keys = new Map<string, number[]>();
  for (const property of node.children) {
    if (property.tag !== "CCutsceneNodePropertyValue" || !property.attrs.propertyName) continue;
    const curve = property.children
      .filter((key) => key.tag === "CCutsceneElementPropertyCurve")
      .map((key) => ({ time: number(key, "time") ?? number(key, "start") ?? 0, value: number(key, "value") }))
      .filter((key): key is { time: number; value: number } => key.value !== undefined)
      .sort((a, b) => a.time - b.time);
    if (curve.length) keys.set(property.attrs.propertyName, curve.map((key) => key.value));
  }
  const value = (name: string): number | undefined => keys.get(name)?.[0] ?? number(node, name);
  const point = (prefix: string): Vec3 | undefined => {
    const xyz = ["X", "Y", "Z"].map((axis) => value(`${prefix}${axis}`));
    return xyz.every((entry) => entry !== undefined) ? (xyz as unknown as Vec3) : undefined;
  };
  const target = point("targetPosition") ?? (vectorAttr(node, "position") as Vec3 | undefined);
  const eye = point("eyePosition");
  if (!target || !eye) return undefined;
  const [dx, dy, dz] = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
  const level = Math.hypot(dx, dy);
  const distance = Math.hypot(level, dz);
  if (distance < 1e-6) return undefined;
  const moves = TARGET_CAMERA_MOTION.some((name) => {
    const curve = keys.get(name);
    return !!curve && curve.some((entry) => Math.abs(entry - curve[0]!) > 1e-4);
  });
  return {
    name: node.attrs.name || "Camera",
    target: [round(target[0]), round(target[1]), round(target[2])],
    distance: round(distance),
    pitch: round(Math.atan2(dz, level) / DEG),
    // Straight up or down has no yaw of its own: 0, as the Editor's orbit cameras start.
    yaw: level < 1e-9 ? 0 : round(Math.atan2(0 - dx, dy) / DEG),
    ...lens(node, distance, value),
    ...(moves ? { moves: true as const } : {}),
  };
}

function lamp(node: CutsceneNode, local: (at: readonly number[]) => [number, number, number]): SetLamp {
  const rotation = vectorAttr(node, "rotation")?.map(round) as Vec3 | undefined;
  const optional = (key: keyof SetLamp, attr: string): Partial<SetLamp> => {
    const value = number(node, attr);
    return value === undefined ? {} : { [key]: round(value) };
  };
  return {
    name: node.attrs.name || "Light",
    type: node.attrs.type === "2" ? "spot" : "omni",
    at: local(vectorAttr(node, "position") ?? ORIGIN),
    ...(rotation && rotation.some((value) => value !== 0) ? { rotation: [...rotation] } : {}),
    // The Editor leaves out attributes at their defaults: a missing colour channel is 1.
    color: ["colorR", "colorG", "colorB"].map((name) => round(number(node, name) ?? 1)) as [number, number, number],
    strength: round(number(node, "colorMultiplier") ?? 1),
    ...optional("attenuationStart", "attenuationStart"),
    ...optional("range", "range"),
    ...optional("hotspot", "hotspot"),
    ...optional("falloff", "falloff"),
    ...(node.attrs.shadowCasting === "0" ? { shadows: false as const } : {}),
  };
}

/** The set's JSON with one piece, mark, camera or lamp a line, so a re-import diffs entry by entry. */
export function formatSet(set: SetData): string {
  const fields = Object.entries(set).map(([key, value]) =>
    Array.isArray(value) && value.length && typeof value[0] === "object"
      ? `  ${JSON.stringify(key)}: [\n${value.map((entry) => `    ${JSON.stringify(entry)}`).join(",\n")}\n  ]`
      : `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
  );
  return `{\n${fields.join(",\n")}\n}\n`;
}

/**
 * Imports the set into the Workspace's Mission `mission`, at <mission>/sets/<slug>.json, reading the
 * `roots` (each a source kind and its folder; the kinds core's and the Workspace's Plugins'). Returns
 * where it wrote the set.
 */
export async function importSetIntoMission(
  workspace: Workspace,
  mission: string,
  name: string,
  roots: readonly { readonly origin: string; readonly root: string }[],
  options: { readonly file?: string } = {},
): Promise<ImportedSet & { readonly path: string }> {
  return importSetBeside(workspace, await missionBlueprintPath(workspace, mission), name, roots, options);
}

/**
 * Imports the set into the Workspace's mod `mod`, at mods/<mod>/sets/<slug>.json, for the mod's
 * Cinematics, reading the `roots` as importSetIntoMission does: often the mod's own folder, whose
 * Kept cutscenes hold its sets. Returns where it wrote the set.
 */
export async function importSetIntoMod(
  workspace: Workspace,
  mod: string,
  name: string,
  roots: readonly { readonly origin: string; readonly root: string }[],
  options: { readonly file?: string } = {},
): Promise<ImportedSet & { readonly path: string }> {
  if (!workspace.mods.includes(mod)) throw new Error(`The Workspace has no mod ${mod}; its mods: ${workspace.mods.join(", ") || "none"}`);
  return importSetBeside(workspace, (await readWorkspaceMod(workspace, mod)).blueprintPath, name, roots, options);
}

/** Imports the set into the sets folder beside the Blueprint at `blueprintPath`. */
async function importSetBeside(
  workspace: Workspace,
  blueprintPath: string,
  name: string,
  roots: readonly { readonly origin: string; readonly root: string }[],
  options: { readonly file?: string },
): Promise<ImportedSet & { readonly path: string }> {
  const kinds = cutsceneSourceKinds(workspace.registry);
  for (const { origin } of roots) if (!kinds.has(origin)) throw new Error(`No cutscene source kind ${origin}; the Workspace knows ${[...kinds.keys()].join(", ")}`);
  const sources = (await Promise.all(roots.map(({ root, origin }) => loadCutsceneSources(root, origin)))).flat();
  const imported = importSet(buildSetCatalog(sources, kinds), sources, name, options);
  const target = path.join(path.dirname(blueprintPath), "sets", `${imported.slug}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, formatSet(imported.set));
  return { ...imported, path: target };
}
