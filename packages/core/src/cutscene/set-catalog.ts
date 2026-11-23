// The catalog of cinematic sets: the rooms and environments built in Cutscene Editor files, with
// who stands where in them and which cameras film them. A set is found by its content, not its
// folder names (half the files have no "Set" folder): each file's scenery actors are clustered by
// distance into locations (one opening cutscene can hold a ship's bridge, an office and a
// station), and locations from different files that share most of their models are one set.

import type { CutsceneSourceKind } from "../plugins/plugin-api.js";
import { type CutsceneNode, readCutscene, vectorAttr } from "./read-cutscene.js";
import { CORE_SOURCE_KINDS, type CutsceneSourceKinds } from "./source-kinds.js";

/**
 * A Cutscene Editor file and where it comes from: `origin` is its source kind's id, such as
 * `blizzard` for Blizzard's game data or a Campaign's own kind from its Plugin.
 */
export type CutsceneSource = { readonly origin: string; readonly path: string; readonly xml: string };

type Vec3 = readonly [number, number, number];

export type SetMark = { readonly guid: string; readonly name: string; readonly model: string; readonly at: Vec3; readonly facing: number };
/**
 * `guid` is the node's id in its file, so a tool can copy the node itself (the contact sheet does).
 * `eye` is the lens's x and y and `eyeHeight` its z, so a tool can place the camera without the orbit values.
 */
export type SetCamera = { readonly guid: string; readonly name: string; readonly target: Vec3; readonly eye: readonly [number, number]; readonly eyeHeight: number; readonly fov: number };
/** `rotation` is the actor's x, y and z turn in degrees and `scale` its x, y and z scale, each left out when the piece has none (0 and 1). */
/**
 * A piece of scenery; `hidden` when its file has it turned off (not enabled, or not visible).
 * An actor names its model by a model entry's id (`modelLink`) or by the model's file (`modelPath`):
 * for the second, `modelPath` is that file and `model` its name without the folder and `.m3`.
 */
export type SetPiece = { readonly guid: string; readonly model: string; readonly modelPath?: string; readonly at: Vec3; readonly rotation?: Vec3; readonly scale?: Vec3; readonly hidden?: true };

/** A path on someone's disk, not in the game's data: a drive letter, or rooted. */
const ON_DISK = /^([a-z]:|[\\/])/i;

/** A model file's name without its folder and `.m3`, as a piece named by its file is called. */
export const modelPathName = (file: string): string => file.split(/[\\/]/).pop()!.replace(/\.m3$/i, "");

/** One set as built in one file. */
export type SetOccurrence = {
  readonly origin: CutsceneSource["origin"];
  readonly file: string;
  /** Folder names its scenery sits in, most common first. */
  readonly folders: readonly string[];
  readonly centre: Vec3;
  readonly pieces: readonly SetPiece[];
  readonly marks: readonly SetMark[];
  readonly cameras: readonly SetCamera[];
  /** Base Lights the file switches to (Active Light). */
  readonly lights: readonly string[];
  /** The file renders cameras to a texture (a screen or display), with these feeds. */
  readonly rttFeeds: readonly string[];
  /** GUIDs of the file's light nodes near the set: its local key, fill and practicals. */
  readonly lamps: readonly string[];
};

export type CinematicSet = {
  readonly id: string;
  readonly name: string;
  /** A story location, or a front-end screen (menu, UI backdrop) built the same way. */
  readonly kind: "story" | "menu";
  /** Distinct scenery models, by how many occurrences use each. */
  readonly models: readonly { readonly model: string; readonly uses: number }[];
  readonly occurrences: readonly SetOccurrence[];
};

/** Actors that are tools, not things on screen: look-at targets, invisible attach points, camera rigs. */
const HELPER = /^(Shape[A-Z]|Sphere$|Invisible$|MarineXPR$|GlueShadowbox$)/;
/** Effects and light cards: glares, flares, steam, fog, beams. */
const EFFECT = /(glare|flare|steam|smoke|fog|dust|beam|explosion|spark|_fx|fx_|warpin|warp_?in|godray|lightshaft)/i;
/** Backdrops: skyboxes, starfields, planets, nebulae. Listed with a set but never what defines it. */
export const BACKDROP = /(skybox|starfield|background|nebula|planet|stars\b|_stars|space_?dust)/i;
/** Folders whose actors are characters (or ships and units standing in for them). */
const CHARACTER_FOLDER = /(charact|cast\b|extras?\b|crowd|actors?\b|people)/i;
/** Folders whose actors aren't scenery: cameras' rigs, sound, music, credits, effects. */
const NON_SCENERY_FOLDER = /^(cameras?|importedcameras|sounds?|audio|music.*|credits|fx|vfx|glare.*|lights?|lighting|shot lighting|shot fog|fog|devlights|text)$/i;
/** Folder names that say nothing about which set it is: structure, shot numbers, positions, effects. */
const GENERIC_FOLDER =
  /^(sets?|set \(guide\)|ship|models?|extramodels|props?|environments?|mesh|misc|extras?|common|general|core|other|random|section \d+|scene \d+|scene [a-z]|s_?\d.*|\d+.*|[a-z]_s\d.*|space|walls?|outerwalls|floor|glass|background.*|foreground.*|skybox|rtt|convo|back|far|near|front|close|wide|good|bad|moving|animate|pulse|rocks|trash|debris|buildings|[a-z]_sets|.*\b(fx|fxs|flare|glare)s?\b.*|.*efx)$/i;
/** Front-end screens (menus, UI backdrops, co-op panels): built like sets, but not story locations. */
const MENU_FILE = /(mainmenu|ui_|uiview|backgrounds?_|alliedcommander|tournament|wcs\d|mutators|_screens)/i;

/** Scenery closer than this (set units) belongs to one location. An Editor-made opening cutscene builds its rooms 30+ apart. */
const LOCATION_GAP = 15;
/** A mark or camera this close to a location's scenery is in it. */
export const NEAR = 10;
/** Model overlap (shared over all, Jaccard) for two locations to be one set; see sameSet. */
const SAME_NAME_JACCARD = 0.3;
const UNNAMED_JACCARD = 0.5;
const RENAMED_JACCARD = 0.8;
const SAME_SET_MIN_SHARED = 3;

type Actor = { readonly guid: string; readonly name: string; readonly model: string; readonly modelPath?: string; readonly at: Vec3; readonly facing: number; readonly rotation?: Vec3; readonly scale?: Vec3; readonly hidden?: true; readonly folders: readonly string[] };

const DEG = Math.PI / 180;
const distance2d = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

/**
 * An actor's name as a mark: its source kind's own conventions stripped by the kind's hook, then
 * the notes the Cutscene Editor and Blizzard's own cutscenes put after a name ("(Unnamed)",
 * "(Facing …)", "(Bridge)", "(Cutscene)") and a trailing number, for every kind
 * ("Raynor (Unnamed) 1" -> "Raynor"). An actor with no name left is named by its model.
 */
export function markName(actorName: string, model: string, kind?: CutsceneSourceKind): string {
  const stripped = kind?.markName ? kind.markName(actorName) : actorName;
  const cleaned = stripped
    .replace(/\s*\((unnamed|facing [^)]*|bridge|cutscene)\)\s*\d*$/i, "")
    .replace(/\s+\d+$/, "")
    .trim();
  return cleaned || model;
}

/**
 * Orbit camera: the eye sits `distance` back from the target against the view direction, which at
 * yaw θ is (sin θ, −cos θ) (0 looks −y, 90 +x, 180 +y), shortened by pitch. In x and y; import-set's
 * cameraEye adds the height (docs/reference/editor-and-engine.md, "Where a cutscene camera's eye sits").
 */
export function orbitEye(target: Vec3, distance: number, pitch: number, yaw: number): [number, number] {
  const level = Math.cos(pitch * DEG) * distance;
  return [target[0] - Math.sin(yaw * DEG) * level, target[1] + Math.cos(yaw * DEG) * level];
}

type FileContents = { actors: Actor[]; cameras: SetCamera[]; lights: string[]; rttFeeds: string[]; lamps: { guid: string; at: Vec3 }[] };

function readFile(root: CutsceneNode): FileContents {
  const actors: Actor[] = [];
  const cameras: SetCamera[] = [];
  const lights = new Set<string>();
  const lamps: { guid: string; at: Vec3 }[] = [];
  const byGuid = new Map<string, CutsceneNode>();
  const rttGuids: string[] = [];
  const walk = (node: CutsceneNode, folders: string[]): void => {
    for (const child of node.children) {
      const guid = child.attrs.guid;
      if (guid) byGuid.set(guid, child);
      switch (child.tag) {
        case "CCutsceneNodeFolder":
          walk(child, [...folders, child.attrs.name ?? ""]);
          break;
        case "CCutsceneNodeActor": {
          // An actor left where the Editor made it has no position: it sits at the origin, as a set's one-piece room often does.
          const at = vectorAttr(child, "position") ?? ([0, 0, 0] as const);
          // Named by a model entry, or by the model's file: Blizzard's later sets place a room's parts that way.
          // A file on the author's own disk (the Editor's preview folder, "C:\\Users\\...\\previewTemp\\X.m3") is a leftover, not a model the game has.
          const modelPath = child.attrs.modelLink || !child.attrs.modelPath || ON_DISK.test(child.attrs.modelPath) ? undefined : child.attrs.modelPath;
          const model = child.attrs.modelLink || (modelPath ? modelPathName(modelPath) : undefined);
          if (model) {
            const rotation = vectorAttr(child, "rotation");
            const scale = vectorAttr(child, "scale");
            actors.push({
              guid: guid ?? "",
              name: child.attrs.name ?? model,
              model,
              ...(modelPath ? { modelPath } : {}),
              at,
              facing: rotation?.[2] ?? 0,
              ...(rotation && rotation.some((degrees) => degrees !== 0) ? { rotation } : {}),
              ...(scale && scale.some((factor) => factor !== 1) ? { scale } : {}),
              ...(child.attrs.enabled === "0" || child.attrs.visible === "0" ? { hidden: true as const } : {}),
              folders,
            });
          }
          walk(child, folders);
          break;
        }
        case "CCutsceneNodeCamera": {
          const target = vectorAttr(child, "position");
          if (target) {
            const [distance, pitch, yaw] = ["distance", "pitch", "yaw"].map((name) => Number(child.attrs[name] ?? 0)) as [number, number, number];
            const eyeHeight = target[2] + Number(child.attrs.heightOffset ?? 0) + Math.sin(pitch * DEG) * distance;
            cameras.push({ guid: guid ?? "", name: child.attrs.name ?? "camera", target, eye: orbitEye(target, distance, pitch, yaw), eyeHeight, fov: Number(child.attrs.fov ?? 27.8) });
          }
          break;
        }
        case "CCutsceneNodeTargetCamera": {
          const target = vectorAttr(child, "position");
          const eye = ["eyePositionX", "eyePositionY", "eyePositionZ"].map((name) => Number(child.attrs[name]));
          if (target && eye.slice(0, 2).every(Number.isFinite)) {
            cameras.push({ guid: guid ?? "", name: child.attrs.name ?? "camera", target, eye: [eye[0]!, eye[1]!], eyeHeight: Number.isFinite(eye[2]) ? eye[2]! : target[2], fov: Number(child.attrs.fov ?? 27.8) });
          }
          break;
        }
        case "CCutsceneNodeLight": {
          const at = vectorAttr(child, "position");
          if (at && guid) lamps.push({ guid, at });
          break;
        }
        case "CCutsceneElementActiveLight":
          if (child.attrs.lightID) lights.add(child.attrs.lightID);
          break;
        case "CCutsceneElementRTTChannel":
          if (child.attrs.objectGUID) rttGuids.push(child.attrs.objectGUID);
          break;
        default:
          walk(child, folders);
      }
    }
  };
  walk(root, []);
  const rttFeeds = [...new Set(rttGuids.map((guid) => byGuid.get(guid)?.attrs.name ?? guid))];
  return { actors, cameras, lights: [...lights], rttFeeds, lamps };
}

const isCharacter = (actor: Actor): boolean => !HELPER.test(actor.model) && actor.folders.some((folder) => CHARACTER_FOLDER.test(folder));
const isScenery = (actor: Actor): boolean =>
  !HELPER.test(actor.model) &&
  !EFFECT.test(actor.model) &&
  !isCharacter(actor) &&
  !actor.folders.some((folder) => NON_SCENERY_FOLDER.test(folder.trim()));

/** Single-linkage clusters of scenery by distance on the ground plane. */
function locations(scenery: readonly Actor[]): Actor[][] {
  const parent = scenery.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < scenery.length; i++) {
    for (let j = i + 1; j < scenery.length; j++) {
      if (distance2d(scenery[i]!.at, scenery[j]!.at) <= LOCATION_GAP) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Actor[]>();
  scenery.forEach((actor, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), actor]));
  return [...groups.values()].flatMap(byRoom);
}

/** The shallowest folder that names something ("Set/Ship Cantina/Bar" -> "Ship Cantina"). */
const roomOf = (actor: Actor): string => actor.folders.map((folder) => folder.trim()).find((folder) => folder && !GENERIC_FOLDER.test(folder)) ?? "";

/**
 * Splits one location by room folder. A ship's rooms can be built on its shared origin (the
 * bridge and cantina sit on top of each other), so only their folders tell them apart.
 * Pieces with no room folder join the largest room.
 */
function byRoom(location: Actor[]): Actor[][] {
  const rooms = new Map<string, Actor[]>();
  for (const actor of location) rooms.set(roomOf(actor), [...(rooms.get(roomOf(actor)) ?? []), actor]);
  const unnamed = rooms.get("") ?? [];
  rooms.delete("");
  if (rooms.size === 0) return [unnamed];
  const named = [...rooms.values()].sort((a, b) => b.length - a.length);
  named[0]!.push(...unnamed);
  return named;
}

const count = <T,>(values: readonly T[]): [T, number][] => {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};

function occurrence(source: CutsceneSource, kind: CutsceneSourceKind | undefined, contents: FileContents, location: Actor[]): SetOccurrence {
  const near = (point: readonly number[]): boolean => location.some((actor) => distance2d(actor.at, point) <= NEAR);
  const centre: Vec3 = [0, 1, 2].map((axis) => location.reduce((sum, actor) => sum + actor.at[axis]!, 0) / location.length) as unknown as Vec3;
  // Every meaningful folder on the way down to each piece, the most widely shared first.
  const folders = count(location.flatMap((actor) => [...new Set(actor.folders.map((folder) => folder.trim()).filter((folder) => folder && !GENERIC_FOLDER.test(folder)))])).map(([name]) => name);
  return {
    origin: source.origin,
    file: source.path,
    folders,
    centre,
    pieces: location.map((actor) => ({ guid: actor.guid, model: actor.model, ...(actor.modelPath ? { modelPath: actor.modelPath } : {}), at: actor.at, ...(actor.rotation ? { rotation: actor.rotation } : {}), ...(actor.scale ? { scale: actor.scale } : {}), ...(actor.hidden ? { hidden: true as const } : {}) })),
    // A mark's model is a model entry's id, which a cast member is made from: a character named by its model's file isn't one.
    marks: contents.actors.filter((actor) => isCharacter(actor) && !actor.modelPath && near(actor.at)).map((actor) => ({ guid: actor.guid, name: markName(actor.name, actor.model, kind), model: actor.model, at: actor.at, facing: actor.facing })),
    cameras: contents.cameras.filter((camera) => near(camera.target) || near(camera.eye)),
    lights: contents.lights,
    rttFeeds: contents.rttFeeds,
    lamps: contents.lamps.filter((lamp) => near(lamp.at)).map((lamp) => lamp.guid),
  };
}

/** The models that identify a location: its scenery, less backdrops. */
const signature = (occurrence: SetOccurrence): Set<string> => new Set(occurrence.pieces.map((piece) => piece.model).filter((model) => !BACKDROP.test(model)));

/**
 * Whether two occurrences are one set. Same room name and some shared models; or, with a name
 * missing, most models shared; or, with different names, nearly all. Names alone aren't enough
 * ("Interior" names a tram in one file and a station in another), and models alone chain rooms
 * together through a file that builds two of them in one folder.
 */
function sameSet(a: SetOccurrence, b: SetOccurrence, modelsA: Set<string>, modelsB: Set<string>): boolean {
  let shared = 0;
  for (const model of modelsA) if (modelsB.has(model)) shared++;
  const jaccard = shared / (modelsA.size + modelsB.size - shared);
  const [nameA, nameB] = [a.folders[0]?.toLowerCase(), b.folders[0]?.toLowerCase()];
  if (nameA && nameB && nameA === nameB) return shared >= 2 && jaccard >= SAME_NAME_JACCARD;
  if (!nameA || !nameB) return shared >= SAME_SET_MIN_SHARED && jaccard >= UNNAMED_JACCARD;
  return shared >= SAME_SET_MIN_SHARED && jaccard >= RENAMED_JACCARD;
}

/** Longest common prefix of the models, cut back to a word boundary ("SMX3_Nova_Ship_Bridge04" -> "SMX3_Nova_Ship_Bridge"). */
function modelStem(models: readonly string[]): string {
  if (models.length === 0) return "";
  let prefix = models[0]!;
  for (const model of models) while (!model.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return prefix.replace(/[_\d]+$/, "");
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "set";

/**
 * The sets a file of some other source than Blizzard's game data holds: the ones a Workspace keeps
 * in its own catalog (catalog-sets --private), since core's has Blizzard's alone.
 */
export const privateSets = (sets: readonly CinematicSet[]): CinematicSet[] => sets.filter((set) => set.occurrences.some((occurrence) => occurrence.origin !== "blizzard"));

/** The sets in `sources`; each file's mark names follow its source kind's conventions, as `kinds` gives them. */
export function buildSetCatalog(sources: readonly CutsceneSource[], kinds: CutsceneSourceKinds = CORE_SOURCE_KINDS): CinematicSet[] {
  const found: SetOccurrence[] = [];
  for (const source of sources) {
    const contents = readFile(readCutscene(source.xml));
    for (const location of locations(contents.actors.filter(isScenery))) {
      const candidate = occurrence(source, kinds.get(source.origin), contents, location);
      // A set has a few distinct pieces of its own, or a couple that something is staged in; a lone
      // prop, a bare starfield or a pile of rocks nobody films isn't one.
      const pieces = signature(candidate).size;
      if (pieces >= 3 || (pieces === 2 && candidate.marks.length + candidate.cameras.length > 0)) found.push(candidate);
    }
  }

  // Merge occurrences that share most of their models, across all files.
  const signatures = found.map(signature);
  const parent = found.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) if (sameSet(found[i]!, found[j]!, signatures[i]!, signatures[j]!)) parent[find(i)] = find(j);
  }
  const groups = new Map<number, SetOccurrence[]>();
  found.forEach((entry, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), entry]));

  const used = new Set<string>();
  const sets = [...groups.values()].map((occurrences): Omit<CinematicSet, "id"> => {
    const models = count(occurrences.flatMap((entry) => [...signature(entry)])).map(([model, uses]) => ({ model, uses }));
    const kind = occurrences.some((entry) => !MENU_FILE.test(entry.file)) ? "story" : "menu";
    // Richest first, and a story file ahead of a menu that reuses the set.
    const sorted = [...occurrences].sort(
      (a, b) =>
        Number(MENU_FILE.test(a.file)) - Number(MENU_FILE.test(b.file)) ||
        b.marks.length + b.cameras.length - (a.marks.length + a.cameras.length) ||
        a.file.localeCompare(b.file),
    );
    const folder = count(occurrences.map((entry) => entry.folders[0] ?? "").filter(Boolean))[0]?.[0];
    const stem = modelStem(models.map((entry) => entry.model));
    const fileName = sorted[0]!.file.split("/").at(-1)!.replace(/\.sc2cutscene$/i, "");
    const name = folder ?? (stem.length >= 6 ? stem : `${fileName} set`);
    return { name, kind, models, occurrences: sorted };
  });
  sets.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "story" ? -1 : 1) || b.occurrences.length - a.occurrences.length || a.name.localeCompare(b.name));
  // Several sets called "Bridge" are told apart by the file each is drawn from.
  const names = count(sets.map((set) => set.name.toLowerCase()));
  const shared = new Set(names.filter(([, n]) => n > 1).map(([name]) => name));
  return sets.map((entry) => {
    const set = shared.has(entry.name.toLowerCase())
      ? { ...entry, name: `${entry.name} (${entry.occurrences[0]!.file.split("/").at(-1)!.replace(/\.sc2cutscene$/i, "")})` }
      : entry;
    let id = slug(set.name);
    for (let n = 2; used.has(id); n++) id = `${slug(set.name)}-${n}`;
    used.add(id);
    return { id, ...set };
  });
}
