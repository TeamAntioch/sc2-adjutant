// Cinematics: a Mission's shot lists (missions/<id>/cinematics/<cinematicId>.json) read with their
// Sets, checked against the Screenplay, timed to the scene's lines and written as .SC2Cutscene
// timelines. `check-workspace` reports their problems; `compile-map` writes each into the Map
// Package; `compile-cutscene` writes one and can play it (ADR 0009).

import { bundledDisplayChannels, type DisplayChannels } from "../catalog/display-channels.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { z } from "zod";

import { blueprintCatalog, type Catalog } from "../catalog/catalog-layer.js";
import { catalogModelAnims, modelAnimsFiles, type ModelAnims } from "../catalog/model-anims.js";
import { catalogModelGuides, defaultFamily, type ModelGuides } from "../catalog/model-guides.js";
import type { M3Sequence } from "../catalog/m3-sequences.js";
import { isKnownLight } from "../catalog/light-catalog.js";
import { bookmarkEventName, type Cinematic, CinematicSchema, type CinematicShot, type Facing, feedOf, LOOK_AHEAD, type OwnFacing, timedAnims } from "../domain/cinematic.js";
import { type SetCamera, type SetData, type SetPiece, SetSchema } from "../domain/cinematic-set.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { DEFAULT_VOICE_FORMAT, findVoiceFiles, type VoiceFile, type VoiceFormat } from "../host/voice-files.js";
import { wavSeconds } from "../host/wav.js";
import type { PluginRegistry } from "../plugins/plugin-api.js";
import type { Script, ScriptLine } from "../script/name-script.js";
import { isInside } from "../util/inside.js";
import { feedChannel } from "./feed-channels.js";
import { FEED_RIG, feedRig } from "./feeds.js";
import { pathFacing, type TurnKey, turnKeys, worldFacing } from "./turns.js";
import { type ActorMove, BOOKENDS, type CutsceneBookmark, evenly, JUMP_MS, type LoopClip, type CutsceneSound, type ShotCamera, shotCutscene, type SpokenLine, type StandingActor, type StandingLamp } from "./write-shot-cutscene.js";

type Vec3 = readonly [number, number, number];

/**
 * One problem in a Mission's Cinematics: the file it is in (absolute), where in it, and what. An
 * error unless it has a severity: a warning, a review item (a norm it runs past, CHECKS.md) or a
 * note.
 */
export type CinematicProblem = { readonly file: string; readonly path?: string; readonly message: string; readonly severity?: Severity };

/** A problem that doesn't fail a check: a warning, a review item (a norm it runs past), or a note (something worth doing, nothing wrong). */
export type Severity = "warning" | "review" | "note";

/** Whether a problem stops a write or fails a check: one with no severity. */
export const isCinematicError = (problem: { readonly severity?: Severity }): boolean => problem.severity === undefined;

/**
 * What a Cinematic's cast models are checked against: their recorded animations, and their Model
 * Guides; and, for messages, the Workspace file that recorded a model, where one did (core's
 * data/model-anims.json otherwise).
 */
export type CastModels = {
  readonly anims: ModelAnims;
  readonly guides: ModelGuides;
  readonly files?: Readonly<Record<string, string>>;
  /** Which render-to-texture channels models show (data/display-channels.json), which a feed with no `channel` takes its Set's screen's from; none known when left out. */
  readonly displays?: DisplayChannels;
};

/** The models core records and the Workspace's, as a Cinematic's cast is checked against them. */
export async function castModels(catalog: Catalog): Promise<CastModels> {
  return { anims: await catalogModelAnims(catalog), guides: await catalogModelGuides(catalog), files: modelAnimsFiles(catalog), displays: await bundledDisplayChannels() };
}

/** A Cinematic read with the Sets it places, by their ids in it. */
export type LoadedCinematic = {
  readonly id: string;
  /** Its place in the Blueprint's `screenplay.script.cinematics`; -1 for a test Cinematic. */
  readonly index: number;
  /** The scene it plays; none for a test Cinematic, which its Blueprint doesn't list and which plays no lines. */
  readonly scene: number | undefined;
  readonly file: string;
  readonly cinematic: Cinematic;
  readonly sets: ReadonlyMap<string, SetData>;
};

/** Where a Blueprint's Cinematic `id` lives: cinematics/<id>.json beside the blueprint. */
export const cinematicPath = (blueprintPath: string, id: string): string => path.join(path.dirname(blueprintPath), "cinematics", `${id}.json`);

/** Where a Cinematic's placed Set lives: its `file`, relative to the Mission's folder. */
export const setFilePath = (blueprintPath: string, file: string): string => path.resolve(path.dirname(blueprintPath), file);

export const issuesOf = (file: string, error: z.ZodError, prefix: readonly (string | number)[] = []): CinematicProblem[] =>
  error.issues.map((issue) => {
    const where = [...prefix, ...issue.path].join(".");
    return { file, ...(where ? { path: where } : {}), message: issue.message };
  });

export async function readJson(file: string): Promise<{ value: unknown } | { problem: string }> {
  if (!existsSync(file)) return { problem: `No such file` };
  try {
    return { value: JSON.parse(await readFile(file, "utf8")) };
  } catch (error) {
    return { problem: `Can't read it: ${(error as Error).message}` };
  }
}

/** Reads one Cinematic file and its Sets, which must sit inside the Workspace at `root`: the Cinematic, or every problem met. */
export async function loadCinematic(
  root: string,
  blueprintPath: string,
  entry: { readonly id: string; readonly index: number; readonly scene: number | undefined },
  rootName = "the Workspace",
): Promise<{ readonly loaded?: LoadedCinematic; readonly problems: CinematicProblem[] }> {
  const file = cinematicPath(blueprintPath, entry.id);
  const read = await readJson(file);
  if ("problem" in read) return { problems: [{ file, message: read.problem }] };
  const parsed = CinematicSchema.safeParse(read.value);
  if (!parsed.success) return { problems: issuesOf(file, parsed.error) };
  const sets = new Map<string, SetData>();
  const problems: CinematicProblem[] = [];
  for (const [at, placed] of parsed.data.sets.entries()) {
    const setFile = setFilePath(blueprintPath, placed.file);
    const where = { file, path: `sets.${at}.file` };
    if (!(await isInside(root, setFile))) {
      problems.push({ ...where, message: `${placed.file} is outside ${rootName}` });
      continue;
    }
    const set = await readJson(setFile);
    if ("problem" in set) {
      problems.push({ ...where, message: `The set ${placed.file}: ${set.problem}` });
      continue;
    }
    const parsedSet = SetSchema.safeParse(set.value);
    if (!parsedSet.success) {
      problems.push(...issuesOf(setFile, parsedSet.error));
      continue;
    }
    sets.set(placed.id, parsedSet.data);
  }
  return problems.length ? { problems } : { loaded: { ...entry, file, cinematic: parsed.data, sets }, problems };
}

/**
 * Reads each of the Blueprint's Cinematics and its Sets, which must sit inside the Workspace at
 * `root`. Returns the ones that read, and every problem met.
 */
export async function loadCinematics(root: string, blueprint: MissionBlueprint, blueprintPath: string): Promise<{ readonly loaded: readonly LoadedCinematic[]; readonly problems: readonly CinematicProblem[] }> {
  return loadListedCinematics(root, blueprintPath, blueprint.screenplay.script?.cinematics ?? []);
}

/**
 * Reads each listed Cinematic (cinematics/<id>.json beside the Blueprint at `blueprintPath`, a
 * Mission's or a mod's) and its Sets, which must sit inside `root` (the Workspace for a Mission,
 * the mod's folder for a mod), called `rootName` in a problem. Returns the ones that read, and every
 * problem met.
 */
export async function loadListedCinematics(
  root: string,
  blueprintPath: string,
  listed: readonly { readonly id: string; readonly scene: number }[],
  rootName = "the Workspace",
): Promise<{ readonly loaded: readonly LoadedCinematic[]; readonly problems: readonly CinematicProblem[] }> {
  const loaded: LoadedCinematic[] = [];
  const problems: CinematicProblem[] = [];
  for (const [index, { id, scene }] of listed.entries()) {
    const read = await loadCinematic(root, blueprintPath, { id, index, scene }, rootName);
    problems.push(...read.problems);
    if (read.loaded) loaded.push(read.loaded);
  }
  return { loaded, problems };
}

/** The scene's lines, in order; undefined when the script has no such scene. A test Cinematic's (no scene) are none. */
export function sceneLines(script: Script | undefined, scene: number | undefined): readonly ScriptLine[] | undefined {
  if (scene === undefined) return [];
  return script?.scenes.find((entry) => entry.number === scene)?.items.filter((item): item is ScriptLine => item.kind === "line");
}

/** What a camera move can't animate (write-shot-cutscene's MOVED), so it holds the from camera's. */
const UNMOVED = ["heightOffset", "verticalFov"] as const;

/** A camera name, `"<set id>/<camera name>"`, split at its first slash. */
export function splitCamera(reference: string): { readonly set: string; readonly name: string } | undefined {
  const at = reference.indexOf("/");
  return at > 0 ? { set: reference.slice(0, at), name: reference.slice(at + 1) } : undefined;
}

/**
 * What's wrong with a Cinematic against its Sets and the Screenplay: a scene the script lacks, a
 * sound ID, camera, set or mark that doesn't exist, lines out of order or with no shot, a speaker
 * who doesn't speak in the scene. It can be written when none is an error (isCinematicError): it
 * also warns of an anim its model's Model Guide avoids, and notes each cast model with recorded
 * animations and no guide.
 */
export function cinematicProblems(loaded: LoadedCinematic, script: Script | undefined, blueprintPath: string, { anims: modelAnims, guides, files }: CastModels, listedAt = "screenplay.script.cinematics"): CinematicProblem[] {
  const { cinematic, sets, file } = loaded;
  const lines = sceneLines(script, loaded.scene);
  if (!lines) return [{ file: blueprintPath, path: `${listedAt}.${loaded.index}.scene`, message: `Cinematic ${loaded.id} plays scene ${loaded.scene}, which the Screenplay doesn't have` }];
  const problems: CinematicProblem[] = [];
  const add = (where: string, message: string, inFile = file): void => void problems.push({ file: inFile, path: where, message });
  const setOf = (id: string, where: string): SetData | undefined => {
    const set = sets.get(id);
    if (!set) add(where, `No set ${id} in this Cinematic (its sets: ${[...sets.keys()].join(", ")})`);
    return set;
  };

  /** A set camera by its `"<set id>/<camera name>"`, with a problem when there's no such camera. */
  const namedCamera = (reference: string, where: string): { readonly set: string; readonly camera: SetCamera } | undefined => {
    const parsed = splitCamera(reference);
    if (!parsed) return void add(where, `${reference} isn't "<set>/<camera name>"`);
    const set = setOf(parsed.set, where);
    const camera = set?.cameras.find((entry) => entry.name === parsed.name);
    if (set && !camera) add(where, `The set ${parsed.set} has no camera ${parsed.name} (its cameras: ${set.cameras.map((entry) => entry.name).join(", ")})`);
    return camera ? { set: parsed.set, camera } : undefined;
  };

  // The set pieces the shots time that exist.
  const found = new Set<string>();
  /** A set piece a shot times by `"<set id>/<piece id>"`, with a problem when there's no such piece or it's switched off. */
  const timedPiece = (id: string, where: string): SetPiece | undefined => {
    const { set: setId, name } = splitCamera(id)!;
    const set = setOf(setId, where);
    const piece = set?.pieces.find((entry) => entry.id === name);
    if (set && !piece) add(where, `The set ${setId} has no piece ${name} (its pieces with ids: ${set.pieces.flatMap((entry) => (entry.id === undefined ? [] : [entry.id])).join(", ") || "none"})`);
    else if (piece?.hidden) add(where, `The set ${setId}'s piece ${name} is switched off (hidden), so it's never written`);
    return piece;
  };

  /** The file that recorded a model's animations, for messages. */
  const recordedIn = (model: string): string => files?.[model] ?? "data/model-anims.json";
  /** A problem, in the Cinematic's file or `inFile`, when the model's recorded animations lack `anim`; none when they aren't recorded. */
  const checkAnim = (model: string, anim: string, where: string, inFile = file): void => {
    const recorded = modelAnims[model];
    if (recorded && !recorded.anims.some((entry) => entry.name === anim)) add(where, `${model} has no animation ${anim} (${recordedIn(model)})`, inFile);
  };
  /** A warning when a cast member's model's Model Guide avoids `anim`. */
  const checkAvoided = (model: string, anim: string, where: string): void => {
    const avoided = guides[model]?.avoid?.find((entry) => entry.anim === anim);
    if (avoided) problems.push({ file, path: where, message: `${model}'s Model Guide avoids ${anim}: ${avoided.why}`, severity: "warning" });
  };

  const position = new Map(lines.map((line, at) => [line.soundId, at]));
  /** Why a sound ID isn't one of the scene's lines: it's another scene's, or no line's. */
  const notInScene = (soundId: string): string => {
    const elsewhere = script?.scenes.find((scene) => scene.items.some((item) => item.kind === "line" && item.soundId === soundId));
    return elsewhere ? `${soundId} is a line of scene ${elsewhere.number}, not of scene ${loaded.scene}` : `No line with the sound ID ${soundId} in the Screenplay`;
  };
  let previous = -1;
  // How far into the line `previous` the latest cut on it is.
  let previousInto = 0;
  // Lines before the first cut on a line would play under the shots before it, which carry none.
  const firstCut = cinematic.shots.findIndex((shot) => shot.line !== undefined);
  cinematic.shots.forEach((shot, at) => {
    const where = `shots.${at}`;
    for (const [id, anim] of Object.entries(shot.anims ?? {})) {
      const member = cinematic.cast.find((entry) => entry.id === id);
      if (!member) {
        add(`${where}.anims.${id}`, `No cast member ${id} in this Cinematic`);
        continue;
      }
      let before = -1;
      for (const { at: inList, timed } of timedAnims(anim)) {
        checkAnim(member.model, timed.anim, `${where}.anims.${id}${inList}`);
        checkAvoided(member.model, timed.anim, `${where}.anims.${id}${inList}`);
        const length = modelAnims[member.model]?.anims.find((entry) => entry.name === timed.anim)?.durationMs;
        if (timed.fromMs !== undefined && length !== undefined && timed.fromMs >= length) add(`${where}.anims.${id}${inList}.fromMs`, `${member.model}'s ${timed.anim} is ${length} ms long: its in-point ${timed.fromMs} ms is at or past its end (${recordedIn(member.model)})`);
        if (inList && (timed.atMs ?? 0) <= before) add(`${where}.anims.${id}${inList}.atMs`, "A shot's anims for a member start in time order, each after the one before");
        before = timed.atMs ?? 0;
      }
    }
    (shot.hide ?? []).forEach((id, index) => {
      if (!cinematic.cast.some((entry) => entry.id === id)) add(`${where}.hide.${index}`, `No cast member ${id} in this Cinematic`);
    });
    (shot.keyed ?? []).forEach((id, index) => {
      if (!cinematic.cast.some((entry) => entry.id === id)) add(`${where}.keyed.${index}`, `No cast member ${id} in this Cinematic`);
      else if (!shot.moves?.[id]) add(`${where}.keyed.${index}`, `The shot doesn't move ${id}: keyed lists members its moves fly by keys`);
    });
    for (const key of ["moves", "enters", "exits"] as const) {
      for (const id of Object.keys(shot[key] ?? {})) {
        const place = `${where}.${key}.${id}`;
        if (!id.includes("/")) {
          if (!cinematic.cast.some((entry) => entry.id === id)) add(place, `No cast member ${id} in this Cinematic`);
          continue;
        }
        if (!timedPiece(id, place)) continue;
        found.add(id);
        // A piece stays where its set puts it: only its look changes.
        shot.moves?.[id]?.forEach((step, at) => {
          if (key === "moves" && (step.to !== undefined || step.facing !== undefined)) add(`${place}.${at}`, "A set piece only fades and scales (opacity, scale): make it a cast member to move or turn it");
        });
      }
    }
    // A feed films a set camera through core's rig, or a cast member through its own model's camera.
    const feed = feedOf(shot.feed);
    if (feed) {
      const place = `${where}.feed${typeof shot.feed === "string" ? "" : ".camera"}`;
      if (splitCamera(feed.camera)) {
        namedCamera(feed.camera, place);
        if (feed.cameraIndex !== undefined) add(`${where}.feed.cameraIndex`, "A feed through a set camera films through core's rig, whose camera is its own: cameraIndex picks a cast member's own camera");
      } else if (!cinematic.cast.some((entry) => entry.id === feed.camera)) {
        add(place, `${feed.camera} is neither a set camera ("<set>/<camera name>") nor a cast member of this Cinematic`);
      } else if (shot.hide?.includes(feed.camera)) {
        add(place, `The shot hides ${feed.camera}, so its feed has no one to film`);
      }
    }
    const from = typeof shot.camera === "string" ? namedCamera(shot.camera, `${where}.camera`) : undefined;
    if (shot.set !== undefined) {
      if (typeof shot.camera === "string") add(`${where}.set`, "A shot through a set camera is on that camera's set");
      else setOf(shot.set, `${where}.set`);
    }
    if (shot.move !== undefined && shot.to === undefined && shot.path === undefined) add(`${where}.move`, "A shot with no move (to or path) has no move style");
    // Each camera a move goes to: on the shot's set, and like the shot's own in what a move can't animate.
    const destinations = [...(shot.to !== undefined ? [{ camera: shot.to, at: `${where}.to` }] : []), ...(shot.path ?? []).map((key, index) => ({ camera: key.camera, at: `${where}.path.${index}.camera` }))];
    for (const { camera, at: place } of destinations) {
      if (typeof camera !== "string") continue;
      const to = namedCamera(camera, place);
      const on = typeof shot.camera === "string" ? splitCamera(shot.camera)?.set : shot.set;
      if (to && on !== undefined && to.set !== on) add(place, `A move stays on its shot's set, ${on}`);
      // A camera of a shot's own has none of them; a move to one keeps the from camera's.
      else if (to && UNMOVED.some((key) => from?.camera[key] !== to.camera[key])) {
        add(place, `${from ? from.camera.name : "The shot's own camera"} and ${to.camera.name} differ in heightOffset or verticalFov, which a move doesn't animate`);
      }
    }
    if (shot.line !== undefined && loaded.scene === undefined) {
      add(`${where}.line`, "A test Cinematic (one its Blueprint doesn't list) plays no scene, so its shots start afterMs after the shot before");
    } else if (shot.line !== undefined) {
      const found = position.get(shot.line);
      if (found === undefined) {
        add(`${where}.line`, notInScene(shot.line));
        return;
      }
      if (at === firstCut && found > 0) {
        const first = at === 0 ? "The first shot starts the Cinematic, so it" : "The first shot with a line";
        add(`${where}.line`, `${first} cuts on the scene's first line, ${lines[0]!.soundId}; ${lines.slice(0, found).map((line) => line.soundId).join(", ")} would have no shot`);
      }
      if (shot.intoLineMs !== undefined) {
        const before = cinematic.shots[at - 1];
        if (at === firstCut) add(`${where}.intoLineMs`, "The first shot with a line cuts on its start");
        else if (before?.line === undefined) add(`${where}.intoLineMs`, `The shot before has no line, so it can't carry ${shot.line} into this cut`);
        else if (before.pauseAfterMs) add(`${where}.intoLineMs`, `The shot before holds a pause after its lines, so it can't carry ${shot.line} into this cut`);
      }
      // Two shots may cut on one line when the later cuts further into it.
      const into = shot.intoLineMs ?? 0;
      if (found === previous && shot.intoLineMs !== undefined) {
        if (into <= previousInto) add(`${where}.intoLineMs`, `It cuts into ${shot.line} no later than the shot before`);
      } else if (found <= previous) add(`${where}.line`, `${shot.line} comes before the line of an earlier shot; shots cut on the lines in the scene's order`);
      if (found > previous) previousInto = into;
      else if (found === previous) previousInto = Math.max(previousInto, into);
      previous = Math.max(previous, found);
    } else {
      if (at === 0 && shot.afterMs !== 0) add(`${where}.afterMs`, "The first shot starts the Cinematic, so its afterMs is 0");
      if (!shot.pauseAfterMs) add(`${where}.pauseAfterMs`, "A shot with no line lasts its pauseAfterMs, so it needs one");
    }
  });

  // A set piece's own anim, reported in its set's file, once however often the Cinematic places it.
  const setFiles = new Map(cinematic.sets.map((placed) => [setFilePath(blueprintPath, placed.file), placed.id]));
  for (const [setFile, id] of setFiles) {
    sets.get(id)?.pieces.forEach((piece, at) => {
      // A hidden piece isn't written, so its anim never plays.
      if (piece.anim !== undefined && !piece.hidden) checkAnim(piece.model, piece.anim, `pieces.${at}.anim`, setFile);
    });
  }

  // A member or piece comes into being once and goes once, and not before it came.
  const timed = [...cinematic.cast.map((member) => member.id), ...found];
  for (const id of timed) {
    const member = { id };
    const shotsWith = (key: "enters" | "exits"): number[] => cinematic.shots.flatMap((shot, at) => (shot[key]?.[member.id] !== undefined ? [at] : []));
    const [enters, exits] = [shotsWith("enters"), shotsWith("exits")];
    for (const [key, found] of [["enters", enters], ["exits", exits]] as const) {
      for (const at of found.slice(1)) add(`shots.${at}.${key}.${member.id}`, `${member.id} ${key === "enters" ? "enters" : "exits"} once; shot ${found[0]} already ${key === "enters" ? "enters" : "exits"} it`);
    }
    const [enter, exit] = [enters[0], exits[0]];
    if (enter !== undefined && exit !== undefined && (exit < enter || (exit === enter && cinematic.shots[exit]!.exits![member.id]! <= cinematic.shots[enter]!.enters![member.id]!))) {
      add(`shots.${exit}.exits.${member.id}`, `${member.id} exits before it enters, in shot ${enter}`);
    }
  }

  /** A problem when a sound or look-at starts (or a sound ends) on a line the scene doesn't have; its place among the lines when it does. */
  const startLine = (line: string | undefined, where: string): number | undefined => {
    if (line === undefined) return undefined;
    if (loaded.scene === undefined) return void add(where, "A test Cinematic (one its Blueprint doesn't list) plays no scene, so nothing in it starts on a line");
    const found = position.get(line);
    if (found === undefined) add(where, notInScene(line));
    return found;
  };
  (cinematic.sounds ?? []).forEach((sound, at) => {
    startLine(sound.line, `sounds.${at}.line`);
    startLine(sound.untilLine, `sounds.${at}.untilLine`);
  });
  (cinematic.bookmarks ?? []).forEach((bookmark, at) => startLine(bookmark.line, `bookmarks.${at}.line`));

  // A mark more than one member is cast on: a look-at or lamp aimed at it can't tell which.
  const onMark = new Map<string, string[]>();
  for (const member of cinematic.cast) if (member.mark !== undefined) onMark.set(`${member.set}/${member.mark}`, [...(onMark.get(`${member.set}/${member.mark}`) ?? []), member.id]);
  const shared = (set: string, mark: string): string | undefined => {
    const members = onMark.get(`${set}/${mark}`) ?? [];
    return members.length > 1 ? `${members.join(" and ")} are all cast on the mark ${mark} of the set ${set}, so` : undefined;
  };
  // A set's ambience plays once however many sets loop it, so they must agree on its volume.
  const ambienceBy = new Map<string, { readonly set: string; readonly volume: number }>();
  cinematic.sets.forEach((entry, index) => {
    const set = sets.get(entry.id);
    for (const sound of set?.sounds ?? []) {
      const volume = sound.volume ?? 1;
      const first = ambienceBy.get(sound.sound);
      if (!first) ambienceBy.set(sound.sound, { set: entry.id, volume });
      else if (first.volume !== volume) add(`sets.${index}`, `The sets ${first.set} and ${entry.id} both loop the ambience ${sound.sound}, at volumes ${first.volume} and ${volume}; it plays once, so give it one volume`);
    }
    for (const mark of set?.marks ?? []) {
      const clash = mark.lookAt && onMark.has(`${entry.id}/${mark.name}`) ? shared(entry.id, mark.lookAt.mark) : undefined;
      if (clash) add(`sets.${index}`, `${clash} the ${mark.name}'s look-at at it can't tell which to look at`);
    }
    for (const lamp of set?.lamps ?? []) {
      const clash = lamp.attach ? shared(entry.id, lamp.attach.mark) : undefined;
      if (clash) add(`sets.${index}`, `${clash} the lamp ${lamp.name} attached to it can't tell which to follow`);
    }
  });

  const speakers = new Set(lines.map((line) => line.speaker));
  cinematic.cast.forEach((member, at) => {
    // Each look-at at another member, in time order: lines by the scene's order, times by the clock.
    let before: { readonly line?: number; readonly ms?: number } | undefined;
    (member.lookAts ?? []).forEach((look, index) => {
      const where = `cast.${at}.lookAts.${index}`;
      const ahead = look.at === LOOK_AHEAD;
      const target = lookedAt(look.at, cinematic.cast);
      const mark = splitCamera(look.at);
      if (ahead) {
        if (index === 0) add(`${where}.at`, `${member.id}'s first look-at can't be "${LOOK_AHEAD}": it faces ahead until one starts`);
      } else if (!target) add(`${where}.at`, mark ? `No one in this Cinematic is cast on the mark ${mark.name} of the set ${mark.set}` : `No cast member ${look.at} in this Cinematic`);
      else if (target === member) add(`${where}.at`, `${member.id} can't look at itself`);
      else if (mark && shared(mark.set, mark.name)) add(`${where}.at`, `${shared(mark.set, mark.name)} a look-at at the mark can't tell which; name the member instead`);
      const line = startLine(look.line, `${where}.line`);
      const now = look.line === undefined ? { ms: look.atMs ?? 0 } : line === undefined ? undefined : { line };
      if (now && before && ((now.line !== undefined && before.line !== undefined && now.line <= before.line) || (now.ms !== undefined && before.ms !== undefined && now.ms <= before.ms))) {
        add(where, "A member's look-ats come in time order, each after the one before");
      }
      if (now) before = now;
    });
    const set = setOf(member.set, `cast.${at}.set`);
    if (set && member.mark !== undefined && !set.marks.some((mark) => mark.name === member.mark)) {
      add(`cast.${at}.mark`, `The set ${member.set} has no mark ${member.mark} (its marks: ${set.marks.map((mark) => mark.name).join(", ")})`);
    }
    if (member.anim !== undefined) {
      checkAnim(member.model, member.anim, `cast.${at}.anim`);
      checkAvoided(member.model, member.anim, `cast.${at}.anim`);
    }
    if (member.speaker === undefined) return;
    if (loaded.scene === undefined) add(`cast.${at}.speaker`, "A test Cinematic plays no scene, so no one in it speaks");
    else if (!speakers.has(member.speaker)) add(`cast.${at}.speaker`, `${member.speaker} has no line in scene ${loaded.scene}`);
    else if (!modelAnims[member.model]) add(`cast.${at}.model`, `${member.model}'s animations aren't recorded, so ${member.speaker} can't talk: record them with record_model_anims (from a shell, npm run model-anims -- ${member.model})`);
    const first = cinematic.cast.find((other) => other.speaker === member.speaker)!;
    if (first !== member) add(`cast.${at}.speaker`, `${member.speaker} is cast twice: ${first.id} and ${member.id}`);
  });
  // A rider rides a member of the cast on its own set, not itself and not in a loop, and only
  // scales and fades, since its carrier moves and turns it. It's written only in the shots that show
  // them both, and exists only while its carrier does.
  const shownIn = castShots(cinematic, sets);
  const lives = castLives(cinematic);
  const momentText = ({ shot, ms }: ShotMoment): string => `${ms} ms into shot ${shot}`;
  const timedPath = (key: "enters" | "exits", id: string, moment: ShotMoment | undefined, fallback: string): string => (moment ? `shots.${moment.shot}.${key}.${id}` : fallback);
  cinematic.cast.forEach((member, at) => {
    if (!member.attach) return;
    const where = `cast.${at}.attach.to`;
    const carrier = memberById(cinematic.cast, member.attach.to);
    const chain = carriers(member, cinematic.cast);
    let rides = false;
    if (!carrier) add(where, `No cast member ${member.attach.to} in this Cinematic`);
    else if (carrier === member) add(where, `${member.id} can't ride itself`);
    else if (chain.at(-1) === member.id) add(where, `${member.id} rides in a loop: ${[member.id, ...chain].join(" → ")}`);
    else if (carrier.set !== member.set) add(where, `${member.id} rides ${carrier.id}, who is on the set ${carrier.set}, not ${member.set}: put them on one set`);
    else rides = true;
    cinematic.shots.forEach((shot, index) => {
      shot.moves?.[member.id]?.forEach((step, inList) => {
        if (step.to !== undefined || step.facing !== undefined) add(`shots.${index}.moves.${member.id}.${inList}`, `${member.id} rides ${member.attach!.to}, which moves and turns it: its steps only scale and fade it (opacity, scale); move ${member.attach!.to}, or turn it on the attach's rotation`);
      });
    });
    if (!rides || !carrier) return;
    // Its own entrance and exit, against its carrier's time.
    const life = lives.get(member.id)!;
    const carried = lives.get(carrier.id)!;
    if (life.never) {
      add(where, `${member.id} never exists: ${carrier.id}, which it rides, exists only ${carried.from ? `from ${momentText(carried.from)}` : "from the start"} ${carried.until ? `to ${momentText(carried.until)}` : "to the end"}, outside ${member.id}'s own time`);
      return;
    }
    if (life.own.from && carried.from && compareMoments(life.own.from, carried.from) < 0) {
      problems.push({ file, path: timedPath("enters", member.id, life.own.from, where), message: `${member.id} enters before ${carrier.id}, which it rides, so it comes into being with ${carrier.id}, ${momentText(carried.from)}`, severity: "warning" });
    }
    if (life.own.until && carried.until && compareMoments(life.own.until, carried.until) > 0) {
      problems.push({ file, path: timedPath("exits", member.id, life.own.until, where), message: `${member.id} exits after ${carrier.id}, which it rides, so it goes with ${carrier.id}, ${momentText(carried.until)}`, severity: "warning" });
    }
    if (!shownIn.get(member.id)!.some((shot) => aliveIn(life, shot))) {
      problems.push({ file, path: where, message: `No shot shows both ${member.id} and ${carrier.id}, which it rides, so ${member.id} is never written`, severity: "warning" });
    }
  });
  // A camera rides a member with a copy in the shot, all through it. Its move's cameras lend it their
  // distance, pitch, yaw and lens, not their target, which the carrier holds; and its own target
  // should be at the carrier, since the camera's position is still its own target.
  const offsetOf = new Map(cinematic.sets.map((entry) => [entry.id, entry.offset as Vec3]));
  cinematic.shots.forEach((shot, at) => {
    if (!shot.cameraAttach) return;
    const where = `shots.${at}.cameraAttach.to`;
    const carrier = memberById(cinematic.cast, shot.cameraAttach.to);
    const on = typeof shot.camera === "string" ? splitCamera(shot.camera)?.set : shot.set;
    if (!carrier) return void add(where, `No cast member ${shot.cameraAttach.to} in this Cinematic`);
    const life = lives.get(carrier.id)!;
    if (shot.hide?.includes(carrier.id)) return void add(where, `The shot hides ${carrier.id}, so its camera has no one to ride`);
    if (on !== undefined && carrier.set !== on) return void add(where, `${carrier.id} is on the set ${carrier.set}, which this shot (on ${on}) doesn't show`);
    if (!shownIn.get(carrier.id)?.includes(at)) {
      const why = carrier.attach && !shownIn.get(carrier.attach.to)?.includes(at) ? `it rides ${carrier.attach.to}, who has no copy in this shot` : carrier.mark !== undefined ? `its mark ${carrier.mark} isn't seen through ${typeof shot.camera === "string" ? shot.camera : "this camera"}` : "it isn't in this shot";
      return void add(where, `${carrier.id} has no copy in this shot (${why}), so its camera has no one to ride`);
    }
    if (!aliveIn(life, at)) {
      return void add(where, `${carrier.id} doesn't exist in this shot (${life.never ? "it never exists" : life.from && life.from.shot > at ? `it comes into being ${momentText(life.from)}` : `it goes ${momentText(life.until!)}`}), so its camera has no one to ride`);
    }
    {
      const late = life.from?.shot === at && life.from.ms > 0 ? `comes into being ${life.from.ms} ms in` : undefined;
      const early = life.until?.shot === at ? `goes ${life.until.ms} ms in` : undefined;
      if (late || early) problems.push({ file, path: where, message: `${carrier.id} ${[late, early].filter(Boolean).join(" and ")}, so the camera rides it only while it exists, and films from its own position the rest of the shot`, severity: "warning" });
    }
    // Targets in the Cinematic's frame: a set camera's by its set's offset, one of the shot's own by the shot's set's.
    const targetOf = (camera: CinematicShot["camera"]): Vec3 | undefined => {
      if (typeof camera !== "string") return plus(camera.target, on === undefined ? [0, 0, 0] : (offsetOf.get(on) ?? [0, 0, 0]));
      const named = splitCamera(camera);
      const target = named && sets.get(named.set)?.cameras.find((entry) => entry.name === named.name)?.target;
      return target && plus(target, offsetOf.get(named.set) ?? [0, 0, 0]);
    };
    const from = targetOf(shot.camera);
    const moved = [...(shot.to !== undefined ? [{ camera: shot.to, place: `shots.${at}.to` }] : []), ...(shot.path ?? []).map((key, index) => ({ camera: key.camera, place: `shots.${at}.path.${index}.camera` }))];
    for (const { camera, place } of moved) {
      const target = targetOf(camera);
      if (from && target && target.some((value, axis) => Math.abs(value - from[axis]!) > 1e-6)) {
        problems.push({ file, path: place, message: `The camera rides ${carrier.id}, so this camera's target is ignored: its move only dollies, turns and zooms; move ${carrier.id} to travel`, severity: "warning" });
      }
    }
    // Where the carrier stands at the cut, when that's known before timing: its own point or mark,
    // with no step to a point up to this shot.
    const mark = carrier.mark === undefined ? undefined : sets.get(carrier.set)?.marks.find((entry) => entry.name === carrier.mark);
    const start = carrier.attach ? undefined : carrier.at ?? mark?.at;
    const moves = cinematic.shots.slice(0, at + 1).some((earlier) => earlier.moves?.[carrier.id]?.some((step) => step.to !== undefined));
    const stands = start && !moves ? plus(start, offsetOf.get(carrier.set) ?? [0, 0, 0]) : undefined;
    if (from && stands && Math.hypot(from[0] - stands[0], from[1] - stands[1]) > RIDE_TARGET_CELLS) {
      problems.push({
        file,
        path: `shots.${at}.camera`,
        message: `The camera rides ${carrier.id}, but its target is ${Math.hypot(from[0] - stands[0], from[1] - stands[1]).toFixed(1)} cells from where ${carrier.id} stands; its position is still that target, so aim it at ${carrier.id} to frame the same however the engine takes the two`,
        severity: "warning",
      });
    }
  });
  // Each cast model that could have a guide and has none, once, at its first member.
  const noted = new Set<string>();
  cinematic.cast.forEach((member, at) => {
    if (noted.has(member.model) || !modelAnims[member.model] || guides[member.model]) return;
    noted.add(member.model);
    problems.push({
      file,
      path: `cast.${at}.model`,
      message: `${member.model} has recorded animations but no Model Guide, so its anims are chosen unreviewed: draft one with what its families show (docs/reference/model-guides.md)`,
      severity: "note",
    });
  });
  return problems;
}

/** Cutscene §3.3: about 0.91 s and 0.39 s a word, for a line with no voice file yet. */
export function estimateLineMs(text: string): number {
  return Math.round(910 + 390 * text.trim().split(/\s+/).filter(Boolean).length);
}

/** A PCM WAV's length in ms, from its fmt and data chunks; undefined when it isn't one. */
export function wavLengthMs(wav: Buffer): number | undefined {
  const seconds = wavSeconds(wav);
  return seconds === undefined ? undefined : Math.round(seconds * 1000);
}

/**
 * An Ogg Vorbis file's length in ms: its last page's granule position (the samples played by its
 * end) over the sample rate its identification header gives; undefined when it isn't one.
 */
export function oggLengthMs(ogg: Buffer): number | undefined {
  if (ogg.length < 27 || ogg.toString("ascii", 0, 4) !== "OggS") return undefined;
  let rate: number | undefined;
  let samples: bigint | undefined;
  for (let at = 0; at + 27 <= ogg.length && ogg.toString("ascii", at, at + 4) === "OggS"; ) {
    const segments = ogg[at + 26]!;
    if (at + 27 + segments > ogg.length) break;
    let size = 0;
    for (let index = 0; index < segments; index++) size += ogg[at + 27 + index]!;
    const body = at + 27 + segments;
    // The identification header: packet type 1, "vorbis", version, channels, then the sample rate.
    if (rate === undefined && ogg[body] === 1 && ogg.toString("ascii", body + 1, body + 7) === "vorbis" && body + 16 <= ogg.length) rate = ogg.readUInt32LE(body + 12);
    const granule = ogg.readBigInt64LE(at + 6);
    if (granule >= 0n) samples = granule;
    at = body + size;
  }
  return rate && samples !== undefined ? Math.round((Number(samples) / rate) * 1000) : undefined;
}

/** A voice file's length in ms, a PCM WAV's or an Ogg Vorbis file's; undefined when it's neither. */
export const voiceFileLengthMs = (file: Buffer): number | undefined => wavLengthMs(file) ?? oggLengthMs(file);

/**
 * A Mission's Screenplay with its voice files, as Cinematics and trigger scenes are timed from it.
 * A converted Kept conversation's (map/mission-conversation.ts) also says where an imported line's
 * Kept recording is, by its sound ID (`voiceFile`), and which Sound each line plays (`soundOf`).
 */
export type VoicedScript = {
  readonly script: Script;
  readonly audioDir: string;
  /** The format of its voice files in the package, .ogg unless given (host/voice-files.ts). */
  readonly voiceFormat?: VoiceFormat;
  /** A line's voice file, by its sound ID, where it isn't the one in `audioDir`. */
  readonly voiceFile?: (soundId: string) => string | undefined;
  /** The Sound a line plays, where it isn't its sound ID. */
  readonly soundOf?: (line: ScriptLine) => string;
};

/** Each of `lines`' length in ms, from `voiced`'s voice files, else the estimate. */
export async function voicedLengthsMs(lines: readonly ScriptLine[], voiced: VoicedScript): Promise<Map<string, number>> {
  const format = voiced.voiceFormat ?? DEFAULT_VOICE_FORMAT;
  if (!voiced.voiceFile) return lineLengthsMs(lines, voiced.audioDir, format);
  const own = voiced.voiceFile;
  const files = await findVoiceFiles(voiced.audioDir, lines.map((line) => line.soundId), format);
  return (await measuredLengthsMs(lines, (soundId) => own(soundId) ?? files.get(soundId)?.path)).lengths;
}

/**
 * Each line's length in ms: its voice file's in `audioDir` (<sound ID>.ogg or .wav, the one
 * host/voice-files.ts finds for the Mission's voice format), else the estimate.
 */
export async function lineLengthsMs(lines: readonly ScriptLine[], audioDir: string | undefined, format: VoiceFormat = DEFAULT_VOICE_FORMAT): Promise<Map<string, number>> {
  return (await voiceLengthsMs(lines, audioDir, format)).lengths;
}

/** As lineLengthsMs, with the sound IDs of the lines it timed by the estimate. */
export async function voiceLengthsMs(
  lines: readonly ScriptLine[],
  audioDir: string | undefined,
  format: VoiceFormat = DEFAULT_VOICE_FORMAT,
): Promise<{ readonly lengths: Map<string, number>; readonly estimated: readonly string[] }> {
  const files = audioDir ? await findVoiceFiles(audioDir, lines.map((line) => line.soundId), format) : new Map<string, VoiceFile>();
  return measuredLengthsMs(lines, (soundId) => files.get(soundId)?.path);
}

/**
 * Each line's length in ms, measured with `measure` from the voice file `voiceFile` finds for its
 * sound ID, else the estimate; with the sound IDs it estimated.
 */
export async function measuredLengthsMs(
  lines: readonly ScriptLine[],
  voiceFile: (soundId: string) => string | undefined,
  measure: (file: Buffer) => number | undefined = voiceFileLengthMs,
): Promise<{ readonly lengths: Map<string, number>; readonly estimated: readonly string[] }> {
  const lengths = new Map<string, number>();
  const estimated: string[] = [];
  for (const line of lines) {
    const file = voiceFile(line.soundId);
    const measured = file && existsSync(file) ? measure(await readFile(file)) : undefined;
    if (measured === undefined) estimated.push(line.soundId);
    lengths.set(line.soundId, measured ?? estimateLineMs(line.text));
  }
  return { lengths, estimated };
}

export type CinematicTimeline = {
  readonly shots: readonly { readonly startMs: number; readonly durationMs: number }[];
  readonly lines: readonly { readonly line: ScriptLine; readonly startMs: number; readonly durationMs: number }[];
  /** When the last shot's lines and pause end, where the fade to black starts. */
  readonly contentMs: number;
};

/**
 * When each shot and line plays. The lines run back to back in the scene's order from the end of
 * the fade in, apart from pauses. A shot with a line cuts on that line's start and carries it and
 * every later line no shot names; a shot with afterMs cuts that long after the shot before ends,
 * and carries no line; a shot with intoLineMs cuts that far into its line, which the shot before
 * started. Each shot ends `pauseAfterMs` after its lines (or its own start).
 */
export function cinematicTimeline(
  shots: readonly Pick<CinematicShot, "line" | "afterMs" | "pauseAfterMs" | "intoLineMs" | "lineAtMs">[],
  lines: readonly ScriptLine[],
  lengths: ReadonlyMap<string, number>,
  /** When the first line may start: the end of the fade in (a Cinematic's 1 s; a trigger scene's 1.5 s). */
  fadeInMs: number = BOOKENDS.fadeInMs,
): CinematicTimeline {
  const indexOf = (soundId: string): number => {
    const found = lines.findIndex((line) => line.soundId === soundId);
    if (found < 0) throw new Error(`No line ${soundId} in the scene`);
    return found;
  };
  const placed: { line: ScriptLine; startMs: number; durationMs: number }[] = [];
  let clock: number = fadeInMs;
  let next = 0;
  // A shot's lineAtMs holds its line until that long after its cut (a J cut's lead).
  const heldUntil = new Map<string, () => number | undefined>();
  shots.forEach((shot, at) => {
    if (shot.line !== undefined && shot.lineAtMs !== undefined) heldUntil.set(shot.line, () => (starts[at] === undefined ? undefined : starts[at]! + shot.lineAtMs!));
  });
  const playUntil = (end: number): void => {
    for (; next < end; next++) {
      const held = heldUntil.get(lines[next]!.soundId)?.();
      if (held !== undefined) clock = Math.max(clock, held);
      const durationMs = lengths.get(lines[next]!.soundId) ?? estimateLineMs(lines[next]!.text);
      placed.push({ line: lines[next]!, startMs: clock, durationMs });
      clock += durationMs;
    }
  };
  const starts: number[] = [];
  // Where the shot before's own content began: after the fade in for the first, else at its cut.
  let contentStart: number = fadeInMs;
  shots.forEach((shot, at) => {
    if (at === 0) {
      starts.push(0);
      return;
    }
    // A cut inside a line: the shot before carries the line's start, and this one the rest of it.
    if (shot.intoLineMs !== undefined) {
      playUntil(indexOf(shot.line!) + 1);
      const carried = placed.at(-1)!;
      if (shot.intoLineMs >= carried.durationMs) throw new Error(`Shot ${at} cuts ${shot.intoLineMs} ms into ${shot.line}, which lasts ${carried.durationMs} ms`);
      starts.push(carried.startMs + shot.intoLineMs);
      contentStart = carried.startMs + shot.intoLineMs;
      return;
    }
    const before = shots[at - 1]!;
    // The shot before carries the lines up to this shot's line, or for a shot with no line, up to the next shot's.
    const nextLine = shot.line ?? shots.slice(at).find((later) => later.line !== undefined)?.line;
    playUntil(nextLine === undefined ? lines.length : indexOf(nextLine));
    const end = Math.max(clock, contentStart) + (before.pauseAfterMs ?? 0);
    const start = end + (shot.line === undefined ? (shot.afterMs ?? 0) : 0);
    starts.push(start);
    clock = start;
    contentStart = start;
  });
  playUntil(lines.length);
  const contentMs = Math.max(clock, contentStart) + (shots.at(-1)?.pauseAfterMs ?? 0);
  return {
    shots: starts.map((startMs, at) => ({ startMs, durationMs: (starts[at + 1] ?? contentMs) - startMs })),
    lines: placed,
    contentMs,
  };
}

/**
 * What a cast member's model holds and talks with. Its Talks come in families named by their other
 * words, numbered variants aside: "Talk" and "Talk 01" are the plain family, "Talk B 01" the B one.
 * It takes the plain family, else the B one (some Redux hero models have only that), else the one with
 * the fewest other words (alphabetical on a tie), and holds the family's own Stand ("Stand B",
 * "Stand Victory") when the model has one, as Editor-made conversations pair them, else "Stand".
 *
 * A member's `own` anim, a Stand of a family it has Talks for, talks in that family. An `own` anim
 * that picks no family ("Channel Interact", or "Stand" on a model with no plain Talks) talks in its
 * Model Guide's default family (`guideDefault`), when the model has Talks of it, else the ranked
 * one. With no `own` anim, the default family replaces the ranking, when the model has a Stand of
 * it ("Stand Victory B", else a numbered one, "Stand Victory B 01"): it holds that Stand and talks
 * in the family's Talks, or the ranked family's when the family has none.
 */
export function castClips(anims: readonly M3Sequence[], own?: string, guideDefault?: string): { readonly stand?: LoopClip; readonly talks: readonly LoopClip[] } {
  const clip = ({ name, durationMs }: M3Sequence): LoopClip => ({ name, durationMs });
  const families = new Map<string, LoopClip[]>();
  for (const anim of anims) {
    const words = /^Talk((?: (?!\d+$)\S+)*)(?: \d+)?$/.exec(anim.name)?.[1];
    if (words === undefined) continue;
    families.set(words.trim(), [...(families.get(words.trim()) ?? []), clip(anim)]);
  }
  const ranked = [...families.keys()].sort((a, b) => Number(b === "") - Number(a === "") || Number(b === "B") - Number(a === "B") || a.split(" ").length - b.split(" ").length || a.localeCompare(b));
  // A member standing in a Stand family (its own anim "Stand Victory B") talks in that family; one
  // whose own anim picks no family ("Channel Interact") talks in the guide's default, when it has Talks.
  const standing = own === undefined ? undefined : /^Stand((?: (?!\d+$)\S+)*)(?: \d+)?$/.exec(own)?.[1]?.trim();
  const defaultOrRanked = guideDefault !== undefined && families.has(guideDefault) ? guideDefault : ranked[0];
  const family = standing !== undefined && families.has(standing) ? standing : own !== undefined ? defaultOrRanked : ranked[0];
  const find = (name: string) => anims.find((anim) => anim.name === name);
  const talksOf = (words: string | undefined): LoopClip[] => (words === undefined ? [] : families.get(words)!);
  // The guide's default family, when the member gives no anim and the model has a Stand of it.
  if (own === undefined && guideDefault !== undefined) {
    const defaultStand = standOf(anims, guideDefault);
    if (defaultStand) return { stand: clip(defaultStand), talks: talksOf(defaultOrRanked) };
  }
  const stand = (family ? find(`Stand ${family}`.trim()) : undefined) ?? standOf(anims);
  return { ...(stand ? { stand: clip(stand) } : {}), talks: talksOf(family) };
}

/** The anim `name` with its recorded length, and its move speed when it has one (a walk's), when the model's recorded anims have it, else the bare name. */
const recordedClip = (recorded: readonly M3Sequence[], name: string): string | LoopClip => {
  const found = recorded.find((anim) => anim.name === name);
  return found ? { name, durationMs: found.durationMs, ...(found.moveSpeed > 0 ? { moveSpeed: found.moveSpeed } : {}) } : name;
};

/**
 * A model's Stand of a family, the plain one when none is given: "Stand" ("Stand Victory B"), else
 * its first numbered one ("Stand 01"), which is what the game plays for "Stand" on a model without
 * a plain one (GuardianShield has only Stand 01).
 */
function standOf(anims: readonly M3Sequence[], family = ""): M3Sequence | undefined {
  const name = `Stand ${family}`.trim();
  return anims.find((anim) => anim.name === name) ?? anims.find((anim) => anim.name.startsWith(`${name} `) && /^\d+$/.test(anim.name.slice(name.length + 1)));
}

/** A set piece's looping anim, its own or its model's Stand; none (the writer's bare Stand) when its model's records have no Stand. */
export const pieceAnim = (piece: SetPiece, modelAnims: ModelAnims): { anim?: string | LoopClip } => {
  const recorded = modelAnims[piece.model]?.anims ?? [];
  if (piece.anim !== undefined) return { anim: recordedClip(recorded, piece.anim) };
  const stand = standOf(recorded);
  return stand ? { anim: { name: stand.name, durationMs: stand.durationMs } } : {};
};

/**
 * When each of a shot's steps runs, in ms from its cut: each holds `afterMs` after the one before
 * (or the cut), then takes `ms`, the last the rest of the shot when it gives none. A step that ends
 * past the shot's end, or has no time left to run, gives the overrun instead: how far into the
 * shot it would run.
 */
/**
 * How far a shot's moves may run, from its cut: its end, and for the last shot the fade out's end,
 * since its copies stay through it and a ship shouldn't freeze as the picture fades. A step with no
 * ms still takes only the rest of the shot; one with an ms may run into the fade.
 */
export function movesRoomMs(at: number, shotCount: number, durationMs: number): number {
  return at === shotCount - 1 ? durationMs + BOOKENDS.fadeOutMs : durationMs;
}

export function stepTimes(steps: readonly { readonly afterMs?: number | undefined; readonly ms?: number | undefined }[], durationMs: number, limitMs = durationMs): { startMs: number; durationMs: number }[] | { overrunMs: number } {
  const times: { startMs: number; durationMs: number }[] = [];
  let clock = 0;
  for (const step of steps) {
    const startMs = clock + (step.afterMs ?? 0);
    const end = step.ms !== undefined ? startMs + step.ms : durationMs;
    if (end > limitMs || end <= startMs) return { overrunMs: Math.max(end, startMs) };
    times.push({ startMs, durationMs: end - startMs });
    clock = end;
  }
  return times;
}

/**
 * When a shot's camera reaches each key of its path, in ms from its cut: its `atMs`, the last at the
 * shot's end when it gives none. A key past the shot's end, or one before the last at it (two keys
 * at one time), gives that key's index and why instead.
 */
export function pathTimes(path: readonly { readonly atMs?: number | undefined }[], durationMs: number): number[] | { late: number; why: string } {
  const times = path.map((key) => key.atMs ?? durationMs);
  const late = times.findIndex((time, at) => time > durationMs || (time === durationMs && at < times.length - 1));
  if (late === -1) return times;
  const ms = times[late]!;
  return { late, why: ms > durationMs ? `${ms} ms in, past the shot's end at ${durationMs} ms` : `at the shot's end, ${durationMs} ms in, before its last key` };
}

/**
 * Why a shot's `enters` or `exits` time can't be written, if it can't: past the shot's end (an
 * enter at its very end too, since it would exist for no time), or an exit at its cut of the
 * Cinematic's first shot with no time before it.
 */
export function momentProblem(key: "enters" | "exits", ms: number, durationMs: number, firstShot: boolean): string | undefined {
  if (ms > durationMs || (key === "enters" && ms === durationMs)) return `${key === "enters" ? "enters" : "exits"} it ${ms} ms in, past the shot's end at ${durationMs} ms`;
  if (key === "exits" && ms === 0 && firstShot) return "exits it at the Cinematic's start, so it never exists";
  return undefined;
}

/** A facing as the engine's world-axis (x, y, z): the Editor's triple as it is, an own-frame one converted. */
const worldTriple = (facing: Exclude<Facing, number>): Vec3 => ("heading" in facing ? worldFacing(facing as OwnFacing) : (facing as Vec3));

/**
 * Where a step's `facing` leaves a member that faced `from` (in world axes, `turned`): degrees take
 * that heading and keep the tilt (an own-frame facing keeps its pitch and roll, so a banked ship
 * stays banked about its nose, and the Editor's triple its x and y as written, since a turn keyed
 * along the true one may leave `turned` as the other triple of the same pose), and a triple or an
 * own-frame facing replaces it.
 */
export function turnedTo(from: Facing, step: Facing, turned: Vec3): Exclude<Facing, number> {
  if (typeof step !== "number") return step;
  if (typeof from === "object" && "heading" in from) return { ...from, heading: step };
  return typeof from === "number" ? [turned[0], turned[1], step] : [from[0], from[1], step];
}

const plus = (at: readonly number[], offset: Vec3): Vec3 => [at[0]! + offset[0], at[1]! + offset[1], at[2]! + offset[2]];

/**
 * A step's `facing` along its path, from the one the member faced it with before (none: nose
 * first): degrees take that heading off the path and keep the tilt, as turnedTo does; a triple or
 * an own-frame facing replaces it.
 */
export function alongTo(from: Facing | undefined, step: Facing): Facing {
  if (typeof step !== "number") return step;
  if (typeof from === "object" && "heading" in from) return { ...from, heading: step };
  return Array.isArray(from) ? [from[0], from[1], step] : step;
}

/**
 * A facing along a path as the turn off it the follow's pathRotationOffset is written with. The
 * engine banks an offset's x the other way from an actor's rotation (TestPathBanking, 2026-11-02:
 * a negative x banks right), so an own-frame facing goes in with its roll reversed; the Editor's
 * triple goes in as written.
 */
const turnOff = (facing: Facing): Vec3 =>
  typeof facing === "number" ? [0, 0, facing] : "heading" in facing ? worldFacing({ ...(facing as OwnFacing), roll: -((facing as OwnFacing).roll ?? 0) }) : (facing as Vec3);

/** The turn off its path an offset written by turnOff gives the actor, in an actor's terms (pathFacing's). */
const trueOff = (facing: Facing): Vec3 =>
  typeof facing === "number" ? [0, 0, facing] : "heading" in facing ? worldFacing(facing as OwnFacing) : [-(facing as Vec3)[0], (facing as Vec3)[1], (facing as Vec3)[2]];

/** A Set's camera as the writer takes it, its target moved by `offset` (where the Set is placed). */
export function shotCamera(camera: SetCamera, offset: Vec3): ShotCamera {
  return {
    target: plus(camera.target, offset),
    distance: camera.distance,
    pitch: camera.pitch,
    yaw: camera.yaw,
    fov: camera.fov,
    ...(camera.blur !== undefined ? { blur: camera.blur } : {}),
    ...(camera.focalDepth !== undefined ? { focalDepth: camera.focalDepth } : {}),
    ...(camera.falloff ? { falloff: camera.falloff } : {}),
    ...(camera.heightOffset !== undefined ? { heightOffset: camera.heightOffset } : {}),
    ...(camera.roll !== undefined ? { roll: camera.roll } : {}),
    ...(camera.verticalFov === false ? { verticalFov: false as const } : {}),
    ...(camera.shadowDistance !== undefined ? { shadowDistance: camera.shadowDistance } : {}),
  };
}

/**
 * The .SC2Cutscene of a checked Cinematic, a folder a shot (write-shot-cutscene): its camera and
 * its own copy of each cast member it shows (none in a shot that hides the member, its mark wasn't
 * seen in, or on another set) and of each of its Sets' pieces it shows (those tied to the set
 * cameras it uses; a piece in every shot stands once at the top level), each copy alive only
 * through its shot; its lights, and the lamps tied to its cameras, in LIGHTS (a lamp that lights
 * every shot at its top); the scene's lines on a ConversationDriver over the map's conversation
 * data, each also on its speaker's copy in the shot where it starts; the base Light at t=0, and
 * the fades and End Scene marker (BOOKENDS). A cast member with no anim stands and talks in its
 * model's Model Guide's default family (castClips).
 */
export function cinematicCutscene(loaded: LoadedCinematic, script: Script | undefined, lengths: ReadonlyMap<string, number>, { anims: modelAnims, guides, displays = {} }: CastModels, soundOf: (line: ScriptLine) => string = (line) => line.soundId): string {
  const { cinematic, sets } = loaded;
  const lines = sceneLines(script, loaded.scene) ?? [];
  const timeline = cinematicTimeline(cinematic.shots, lines, lengths);
  const offsetOf = new Map(cinematic.sets.map((entry) => [entry.id, entry.offset as Vec3]));
  const setCamera = (reference: string): { camera: ShotCamera; name: string; set: string } => {
    const { set, name } = splitCamera(reference)!;
    return { camera: shotCamera(sets.get(set)!.cameras.find((camera) => camera.name === name)!, offsetOf.get(set)!), name, set };
  };
  // Each shot's camera, its move's end and its lights, in the Cinematic's frame, and the set it films (none: it sees every set).
  // A shot light's strength steps, timed from its cut as a member's moves are.
  const lightSteps = (steps: NonNullable<NonNullable<CinematicShot["lights"]>[number]["steps"]>, at: number) => {
    const { durationMs } = timeline.shots[at]!;
    const times = stepTimes(steps, durationMs);
    if ("overrunMs" in times) throw new Error(`Shot ${at}'s light steps run until ${times.overrunMs} ms into it, past its end at ${durationMs} ms`);
    return steps.map((step, index) => ({ ...times[index]!, strength: step.strength, ...(step.move ? { move: step.move } : {}) }));
  };
  // A shot's camera path and shake, timed from its cut once the shot is.
  const cameraPath = (path: NonNullable<CinematicShot["path"]>, at: number, camera: (camera: CinematicShot["camera"]) => ShotCamera) => {
    const { durationMs } = timeline.shots[at]!;
    const times = pathTimes(path, durationMs);
    if ("late" in times) throw new Error(`Shot ${at}'s camera path reaches its key ${times.late} ${times.why}`);
    return path.map((key, index) => ({ atMs: times[index]!, camera: camera(key.camera) }));
  };
  const shotShake = ({ atMs, ms, amplitude, hz, roll }: NonNullable<CinematicShot["shake"]>, at: number) => {
    const { durationMs } = timeline.shots[at]!;
    const times = stepTimes([{ afterMs: atMs, ms }], durationMs);
    if ("overrunMs" in times) throw new Error(`Shot ${at}'s shake runs until ${times.overrunMs} ms into it, past its end at ${durationMs} ms`);
    return { startMs: times[0]!.startMs, durationMs: times[0]!.durationMs, amplitude, hz, ...(roll !== undefined ? { roll } : {}) };
  };
  const filmed = cinematic.shots.map((shot, at) => {
    const from = typeof shot.camera === "string" ? setCamera(shot.camera) : undefined;
    const set = from?.set ?? shot.set;
    const offset: Vec3 = set === undefined ? [0, 0, 0] : offsetOf.get(set)!;
    const own = (camera: Exclude<CinematicShot["camera"], string>): ShotCamera => ({ ...camera, target: plus(camera.target, offset) });
    const start = from ?? { camera: own(shot.camera as Exclude<CinematicShot["camera"], string>), name: "Camera" };
    // A camera a move goes to: a set's, or one of the shot's own, which keeps the shot's camera's roll unless it gives its own.
    const destination = (camera: CinematicShot["camera"]): ShotCamera =>
      typeof camera === "string" ? setCamera(camera).camera : { ...own(camera), ...(camera.roll === undefined && start.camera.roll !== undefined ? { roll: start.camera.roll } : {}) };
    return {
      ...start,
      own: from === undefined,
      set,
      ...(shot.to !== undefined ? { to: destination(shot.to) } : {}),
      ...(shot.path ? { path: cameraPath(shot.path, at, destination) } : {}),
      ...(shot.shake ? { shake: shotShake(shot.shake, at) } : {}),
      lights: shot.lights?.map(({ steps, ...light }) => ({ ...light, at: plus(light.at, offset), ...(steps ? { steps: lightSteps(steps, at) } : {}) })),
    };
  });
  // Each shot's feed: the set it films, and through which of that set's cameras (`camera`), or which
  // cast member's own camera (`member`).
  type ShotFeedOf = { readonly set: string; readonly camera?: string; readonly member?: string; readonly channel?: number | undefined; readonly cameraIndex?: number | undefined; readonly aspectRatio?: number | undefined };
  const feeds = cinematic.shots.map((shot, at): ShotFeedOf | undefined => {
    const feed = feedOf(shot.feed);
    if (!feed) return undefined;
    const { camera: target, ...rest } = feed;
    const named = splitCamera(target);
    if (named) return { ...rest, set: named.set, camera: named.name };
    const member = cinematic.cast.find((entry) => entry.id === target);
    if (!member) throw new Error(`Shot ${at}'s feed films ${target}, which is neither a set camera nor a cast member`);
    return { ...rest, set: member.set, member: target };
  });
  /**
   * The shots a set's piece or lamp shows in: through its cameras named `names`, or with no names,
   * every shot on the set or on none; null when that's no shot, and {} when it's every one. A piece
   * tied to cameras also shows through a camera of a shot's own on its set: the source tied it to
   * hide it from cameras that couldn't see it, and a new camera may (a room's walls are tied pieces).
   * A tied lamp is a camera's rig, so it stays with its cameras.
   */
  const tied = (set: string, names: readonly string[] | undefined, piece = false): { shots?: number[] } | null => {
    const through = (shot: (typeof filmed)[number]): boolean => shot.set === set && (shot.own ? piece : names!.includes(shot.name));
    // A shot whose feed films the set shows it as one on it would, through the feed's camera; a
    // member's own camera, like a camera of a shot's own, shows its set's tied pieces.
    const fed = (at: number): boolean => {
      const feed = feeds[at];
      return feed?.set === set && (!names || (feed.camera === undefined ? piece : names.includes(feed.camera)));
    };
    const shots = filmed.flatMap((shot, at) => ((names ? through(shot) : shot.set === undefined || shot.set === set) || fed(at) ? [at] : []));
    if (!shots.length) return null;
    return !names && shots.length === filmed.length ? {} : { shots };
  };
  // A cast member's steps through each shot that moves it, or a set piece's (`id` its
  // "<set id>/<piece id>"), from the cut, in the Cinematic's frame (`offset` its set's), from where
  // it stands, `at`. A turn on the spot to a facing in degrees turns it to that heading and keeps
  // its tilt, and each turn goes the short way round. A turn from or to a facing in the model's own
  // frame is keyed along the true turn (turnKeys), which the engine, turning each world axis on its
  // own, would stray from. A step to a point flies it along its path nose first, its `facing` (and
  // a later one's, until another gives one) a turn off the path (`along`); where the leg leaves it
  // facing is its world rotation from then on.
  // An even step `scale` keeps each axis's sign from `mirror`, as a mirrored piece's own scale has it.
  const movesOf = (id: string, offset: Vec3, start: Facing, at: Vec3, mirror: Vec3 = [1, 1, 1]): ActorMove[] => {
    let facing: Facing = start;
    let turned: Vec3 = typeof facing === "number" ? [0, 0, facing] : worldTriple(facing);
    let place = at;
    let along: Facing | undefined;
    const nearest = (to: number, from: number): number => to + 360 * Math.round((from - to) / 360);
    return cinematic.shots.flatMap((shot, at) => {
      const { startMs: cut, durationMs } = timeline.shots[at]!;
      const steps = shot.moves?.[id] ?? [];
      // The last shot's copies stay through the fade out, so its steps may run on through it.
      const room = movesRoomMs(at, cinematic.shots.length, durationMs);
      const times = stepTimes(steps, durationMs, room);
      if ("overrunMs" in times) throw new Error(`Shot ${at} moves ${id} until ${times.overrunMs} ms into it, past its end at ${room} ms${room > durationMs ? " (the fade out's end)" : ""}`);
      return steps.map((step, index): ActorMove => {
        const startMs = cut + times[index]!.startMs;
        const end = startMs + times[index]!.durationMs;
        let turn: readonly TurnKey[] = [];
        const scale = step.scale !== undefined ? { scale: typeof step.scale === "number" ? (evenly(step.scale).map((value, axis) => value * Math.sign(mirror[axis]!)) as unknown as Vec3) : step.scale } : {};
        const look = { ...scale, ...(step.opacity !== undefined ? { opacity: step.opacity } : {}), ...(step.move ? { move: step.move } : {}) };
        const to = step.to ? plus(step.to, offset) : undefined;
        // A keyed step (the shot's `keyed`) moves it by curves and turns it to its facing in the
        // set's frame, as a turn on the spot does; a later path step starts nose first again.
        if (to && shot.keyed?.includes(id)) {
          if (step.facing !== undefined) {
            const next = turnedTo(facing, step.facing, turned);
            const ownFrame = (typeof facing === "object" && "heading" in facing) || "heading" in next;
            facing = next;
            const world = worldTriple(next);
            if (ownFrame) ({ between: turn, end: turned } = turnKeys(turned, world));
            else turned = [nearest(world[0], turned[0]), nearest(world[1], turned[1]), nearest(world[2], turned[2])];
          }
          along = undefined;
          place = to;
          return { startMs, durationMs: end - startMs, to, keyed: true, rotation: turned, ...(turn.length ? { turn } : {}), ...look };
        }
        // A step to where it already stands only turns, scales or fades it.
        if (to && Math.hypot(to[0] - place[0], to[1] - place[1], to[2] - place[2]) > 1e-9) {
          if (step.facing !== undefined) along = alongTo(along, step.facing);
          const offAlong = along === undefined ? undefined : turnOff(along);
          const direction: Vec3 = [to[0] - place[0], to[1] - place[1], to[2] - place[2]];
          // A jump (JUMP_MS) puts it somewhere new; it doesn't fly there, so it keeps its facing.
          if (end - startMs > JUMP_MS) {
            turned = pathFacing(direction, along === undefined ? [0, 0, 0] : trueOff(along), turned);
            facing = [...turned];
          }
          place = to;
          return { startMs, durationMs: end - startMs, to, ...(offAlong?.some((angle) => angle !== 0) ? { along: offAlong } : {}), rotation: turned, ...look };
        }
        if (step.facing !== undefined) {
          const next = turnedTo(facing, step.facing, turned);
          const ownFrame = (typeof facing === "object" && "heading" in facing) || "heading" in next;
          facing = next;
          const to = worldTriple(next);
          if (ownFrame) ({ between: turn, end: turned } = turnKeys(turned, to));
          else turned = [nearest(to[0], turned[0]), nearest(to[1], turned[1]), nearest(to[2], turned[2])];
        }
        return { startMs, durationMs: end - startMs, ...(step.facing !== undefined ? { rotation: turned } : {}), ...(turn.length ? { turn } : {}), ...look };
      });
    });
  };
  // Where it comes into being and goes: the one shot that enters it and the one that exits it.
  const lifetimeOf = (id: string): { fromMs?: number; untilMs?: number } => {
    const moment = (key: "enters" | "exits"): number | undefined => {
      const at = cinematic.shots.findIndex((shot) => shot[key]?.[id] !== undefined);
      if (at < 0) return undefined;
      const ms = cinematic.shots[at]![key]![id]!;
      const { startMs, durationMs } = timeline.shots[at]!;
      const problem = momentProblem(key, ms, durationMs, at === 0);
      if (problem) throw new Error(`Shot ${at} ${problem.replace(" it ", ` ${id} `)}`);
      return startMs + ms;
    };
    const [fromMs, untilMs] = [moment("enters"), moment("exits")];
    if (fromMs !== undefined && untilMs !== undefined && untilMs <= fromMs) throw new Error(`${id} exits at ${untilMs} ms, before it enters at ${fromMs} ms`);
    return { ...(fromMs !== undefined ? { fromMs } : {}), ...(untilMs !== undefined ? { untilMs } : {}) };
  };

  const standing: StandingActor[] = [];
  const lamps: StandingLamp[] = [];
  // The lamps attached to a mark's character, by their place in `lamps`, for once the cast stands.
  const riders: { readonly lamp: number; readonly set: string; readonly attach: NonNullable<SetData["lamps"][number]["attach"]> }[] = [];
  for (const entry of cinematic.sets) {
    const set = sets.get(entry.id)!;
    for (const piece of set.pieces) {
      const shots = tied(entry.id, piece.shots, true);
      if (piece.hidden || !shots) continue;
      // A piece with an id may come and go, fade and scale, as the shots time it.
      const timed = piece.id === undefined ? undefined : `${entry.id}/${piece.id}`;
      const moves = timed === undefined ? [] : movesOf(timed, entry.offset as Vec3, piece.rotation ?? 0, plus(piece.at, entry.offset as Vec3), evenly(piece.scale ?? 1));
      standing.push({
        model: piece.model,
        ...(piece.modelPath ? { modelPath: piece.modelPath } : {}),
        // By its set and model: "space SMX2_Background_Starfield_Generic", "s010 space …" as a shot's copy.
        name: `${entry.id} ${piece.model}`,
        at: plus(piece.at, entry.offset as Vec3),
        ...(piece.rotation !== undefined ? { rotation: piece.rotation } : {}),
        ...(piece.scale !== undefined ? { scale: piece.scale } : {}),
        ...(piece.variation ? { variation: piece.variation } : {}),
        ...(piece.tint ? { tint: piece.tint } : {}),
        ...(piece.teamColor ? { teamColor: piece.teamColor } : {}),
        ...(piece.opacity !== undefined ? { opacity: piece.opacity } : {}),
        // At its recorded length, as a cast member's: a bare Stand leaves an animated model frozen.
        ...pieceAnim(piece, modelAnims),
        ...(piece.animSpeed !== undefined ? { animSpeed: piece.animSpeed } : {}),
        ...(timed === undefined ? {} : lifetimeOf(timed)),
        ...(moves.length ? { moves } : {}),
        ...shots,
      });
    }
    for (const lamp of set.lamps) {
      const shots = tied(entry.id, lamp.shots);
      if (!shots) continue;
      const { shots: _names, at, attach, ...rest } = lamp;
      if (attach) riders.push({ lamp: lamps.length, set: entry.id, attach });
      lamps.push({ ...rest, at: plus(at, entry.offset as Vec3), ...shots });
    }
  }
  // Where each cast member written stands in `standing`, for the look-ats aimed at it.
  const castAt = new Map<string, number>();
  // The shots each member is copied into.
  const shownIn = castShots(cinematic, sets);
  // When each member written exists, for the members riding it.
  const lives = new Map<string, { fromMs?: number; untilMs?: number }>();
  for (const member of carriersFirst(cinematic.cast)) {
    const offset = offsetOf.get(member.set)!;
    const mark = member.mark === undefined ? undefined : sets.get(member.set)!.marks.find((entry) => entry.name === member.mark)!;
    // A rider shows only in the shots its carrier does (castShots), and exists only while its carrier does.
    const carrier = member.attach === undefined ? undefined : castAt.get(member.attach.to);
    if (member.attach !== undefined && carrier === undefined) continue;
    const shown = { shots: [...shownIn.get(member.id)!] };
    if (!shown.shots.length) continue;
    const says = timeline.lines.filter(({ line }) => member.speaker !== undefined && line.speaker === member.speaker);
    const recorded = modelAnims[member.model]?.anims ?? [];
    const clips = castClips(recorded, member.anim, defaultFamily(guides[member.model]));
    const clipOf = (name: string): string | LoopClip => recordedClip(recorded, name);
    const own: string | LoopClip = (member.anim !== undefined ? clipOf(member.anim) : clips.stand) ?? "Stand";
    // Each shot's anim for it, where the shot overrides it; changes only where the anim does. A timed
    // anim starts part-way in, the member's own holding until then; one played once always starts anew.
    const shotAnims = cinematic.shots.map((shot) => shot.anims?.[member.id]);
    const nameOf = (anim: string | LoopClip): string => (typeof anim === "string" ? anim : anim.name);
    // Each run at the member's animSpeed, unless a shot's timed anim gives its own speed.
    const ownSpeed = member.animSpeed;
    const runs: { startMs: number; anim: string | LoopClip; once?: true; speed?: number; priority?: number; startOffsetMs?: number }[] = [{ startMs: 0, anim: own, ...(ownSpeed !== undefined ? { speed: ownSpeed } : {}) }];
    // A run with an in-point (startOffsetMs) always starts anew there, as one played once does.
    const play = (startMs: number, anim: string | LoopClip, once?: true, speed = ownSpeed, priority?: number, startOffsetMs?: number): void => {
      const last = runs.at(-1)!;
      if (runs.length > 1 && last.startMs === startMs) runs.pop();
      const before = runs.at(-1)!;
      if (once || before.once || startOffsetMs !== undefined || nameOf(anim) !== nameOf(before.anim) || speed !== before.speed || (priority ?? 3) !== (before.priority ?? 3)) {
        runs.push({ startMs, anim, ...(once ? { once } : {}), ...(speed !== undefined ? { speed } : {}), ...(priority !== undefined ? { priority } : {}), ...(startOffsetMs !== undefined ? { startOffsetMs } : {}) });
      }
    };
    shotAnims.forEach((override, at) => {
      const start = timeline.shots[at]!.startMs;
      if (override === undefined) return play(start, own);
      if (typeof override === "string") return play(start, clipOf(override));
      const { durationMs } = timeline.shots[at]!;
      const timed = timedAnims(override).map((entry) => entry.timed);
      if (timed[0]!.atMs) play(start, own);
      for (const { anim, atMs, once, speed, priority, fromMs } of timed) {
        if ((atMs ?? 0) >= durationMs) throw new Error(`Shot ${at} starts ${member.id}'s ${anim} ${atMs ?? 0} ms into it, at or past its end at ${durationMs} ms`);
        const clip = clipOf(anim);
        if (fromMs !== undefined && typeof clip === "object" && fromMs >= clip.durationMs) throw new Error(`Shot ${at} plays ${member.id}'s ${anim} from ${fromMs} ms: ${member.model}'s ${anim} is ${clip.durationMs} ms long, so its in-point is at or past its end`);
        play(start + (atMs ?? 0), clip, once, speed ?? ownSpeed, priority, fromMs);
      }
    });
    // A member on a mark starts there, facing its way, unless it starts at a point of its own.
    // A rider stands where its carrier's point puts it (the writer gives it no place of its own).
    const startsOnMark = mark !== undefined && member.at === undefined;
    const place: Vec3 = member.attach ? [0, 0, 0] : plus(startsOnMark ? mark!.at : member.at!, offset);
    const moves = movesOf(member.id, offset, startsOnMark ? mark!.facing : (member.facing ?? 0), place);
    const ownLife = lifetimeOf(member.id);
    const carrierLife = member.attach === undefined ? {} : lives.get(member.attach.to)!;
    const fromMs = ownLife.fromMs === undefined ? carrierLife.fromMs : Math.max(ownLife.fromMs, carrierLife.fromMs ?? 0);
    const untilMs = ownLife.untilMs === undefined ? carrierLife.untilMs : Math.min(ownLife.untilMs, carrierLife.untilMs ?? Infinity);
    if (fromMs !== undefined && untilMs !== undefined && untilMs <= fromMs) throw new Error(`${member.id} rides ${member.attach!.to}, who exists only from ${carrierLife.fromMs ?? 0} to ${carrierLife.untilMs ?? "the end"} ms, outside its own time`);
    lives.set(member.id, { ...(fromMs !== undefined ? { fromMs } : {}), ...(untilMs !== undefined ? { untilMs } : {}) });
    // A speaker says its lines on its own actor, so it must exist through them.
    const unborn = says.find(({ startMs, durationMs }) => startMs < (fromMs ?? 0) || (untilMs !== undefined && startMs + durationMs > untilMs));
    if (unborn) throw new Error(`${member.id} says ${unborn.line.soundId} from ${unborn.startMs} ms to ${unborn.startMs + unborn.durationMs} ms, outside the time it exists (${fromMs ?? 0} to ${untilMs ?? "the end"} ms)`);
    // A line plays inside the shot it starts in: the next cut waits for it to end.
    const shotAt = (ms: number): number => timeline.shots.findLastIndex((shot) => shot.startMs <= ms);
    let talked = 0;
    castAt.set(member.id, standing.length);
    standing.push({
      model: member.model,
      name: member.id,
      at: place,
      // A rider's attach point turns it, so it has no rotation of its own.
      ...(member.attach
        ? { attach: { actor: carrier!, point: member.attach.point, offset: member.attach.offset, rotation: member.attach.rotation } }
        : { rotation: typeof member.facing === "object" ? worldTriple(member.facing) : startsOnMark ? mark!.facing : (member.facing ?? 0) }),
      ...(member.scale !== undefined ? { scale: member.scale } : {}),
      ...(member.opacity !== undefined ? { opacity: member.opacity } : {}),
      ...(fromMs !== undefined ? { fromMs } : {}),
      ...(untilMs !== undefined ? { untilMs } : {}),
      ...(member.teamColor ? { teamColor: member.teamColor } : {}),
      ...(member.tint ? { tint: member.tint } : {}),
      ...(moves.length ? { moves } : {}),
      ...(runs[0]!.anim !== "Stand" ? { anim: runs[0]!.anim } : {}),
      ...(ownSpeed !== undefined ? { animSpeed: ownSpeed } : {}),
      ...(runs.length > 1 ? { animFrom: runs.slice(1) } : {}),
      // Each line takes the model's next Talk, in turn, for some variety, over its own anim or a shot's
      // timed one (a gesture); none in a shot that runs an anim of its own through it in place of both.
      ...(says.length
        ? {
            says: says.map(({ line, startMs, durationMs }) => {
              const talk = clips.talks.length > 0 && typeof shotAnims[shotAt(startMs)] !== "string" ? { talk: clips.talks[talked++ % clips.talks.length]! } : {};
              return { lineId: line.lineId, soundId: soundOf(line), startMs, durationMs, ...talk };
            }),
          }
        : {}),
      ...shown,
    });
  }

  // A feed through a set camera films through a rig (feeds.ts) standing in each shot it feeds, its
  // camera at the set camera's eye; one of a member's own camera films through the member's copy.
  const rigAt = new Map<string, number>();
  feeds.forEach((feed, at) => {
    if (feed?.camera === undefined) return;
    const key = `${feed.set}/${feed.camera}`;
    const index = rigAt.get(key);
    if (index !== undefined) return void (standing[index] = { ...standing[index]!, shots: [...standing[index]!.shots!, at] });
    const { camera, set } = setCamera(key);
    rigAt.set(key, standing.length);
    const rig = feedRig(camera);
    standing.push({ model: FEED_RIG.model, name: `feed ${set} ${feed.camera}`, at: rig.at, rotation: rig.rotation, shots: [at] });
  });
  const shotFeed = (at: number) => {
    const feed = feeds[at];
    if (!feed) return undefined;
    const actor = feed.camera !== undefined ? rigAt.get(`${feed.set}/${feed.camera}`) : castAt.get(feed.member!);
    if (actor === undefined || !(standing[actor]!.shots?.includes(at) ?? true)) throw new Error(`Shot ${at}'s feed films ${feed.member}, who has no copy in that shot (its hide hides them)`);
    return { channel: feedChannel(loaded, at, displays), actor, cameraIndex: feed.camera !== undefined ? FEED_RIG.cameraIndex : (feed.cameraIndex ?? 0), ...(feed.aspectRatio !== undefined ? { aspectRatio: feed.aspectRatio } : {}) };
  };

  // A shot's camera rides its carrier's copy in the shot.
  const cameraRide = (shot: CinematicShot, at: number) => {
    if (!shot.cameraAttach) return undefined;
    const { to, point, offset } = shot.cameraAttach;
    const actor = castAt.get(to);
    if (actor === undefined || !(standing[actor]!.shots?.includes(at) ?? true)) throw new Error(`Shot ${at}'s camera rides ${to}, who has no copy in that shot`);
    return { actor, point, ...(offset ? { offset: offset as Vec3 } : {}) };
  };

  // A lamp attached to a mark rides the one cast on it; where its set puts it when no one is.
  for (const { lamp, set, attach } of riders) {
    const actor = castAt.get(lookedAt(`${set}/${attach.mark}`, cinematic.cast)?.id ?? "");
    if (actor !== undefined) lamps[lamp] = { ...lamps[lamp]!, attach: { actor, point: attach.point, offset: attach.offset, rotation: attach.rotation } };
  }

  // When the sounds and look-ats start: one past the end, or a look-at out of order, can't be written.
  const cues = cueStarts(cinematic, timeline);
  if (cues.problems.length) throw new Error(cues.problems.map(({ path, message }) => `${path}: ${message}`).join("; "));
  // Where each member looks: its own look-ats, else its mark's (all through), at whoever is cast on the other mark.
  for (const member of cinematic.cast) {
    const index = castAt.get(member.id);
    if (index === undefined) continue;
    const markLook = lookAtOf(member, sets);
    const starts = member.lookAts ? cues.looks.get(member.id)! : [0];
    const looks = (member.lookAts ?? (markLook ? [markLook] : [])).flatMap(({ at, line, type, point }, look) => {
      const target = castAt.get(lookedAt(at, cinematic.cast)?.id ?? "");
      const startMs = starts[look];
      if (startMs === undefined) throw new Error(`${member.id} looks at ${at} from ${line}, which isn't a line of the scene`);
      // Facing ahead ends the look-at before it, and writes none of its own.
      if (at === LOOK_AHEAD) return [{ startMs, type: type ?? DEFAULT_LOOK.type, point: point ?? DEFAULT_LOOK.point }];
      return target === undefined ? [] : [{ startMs, at: target, type: type ?? DEFAULT_LOOK.type, point: point ?? DEFAULT_LOOK.point }];
    });
    if (looks.length) standing[index] = { ...standing[index]!, looks };
  }

  // Each set's ambience loops through the set's shots (and those that see every set), once however
  // many sets play it: from each cut to them to the cut away, a run of them one loop, fading out
  // over AMBIENCE_FADE_OUT_MS before the cut away; a sound in every shot loops all through, as one
  // the last shot plays runs on through the fade to black. The Cinematic's own sounds start on a
  // line or at a time and end on one, or at the end.
  const ambience = new Map<string, { volume: number | undefined; sets: Set<string> }>();
  for (const entry of cinematic.sets) {
    for (const { sound, volume } of sets.get(entry.id)!.sounds ?? []) {
      const found = ambience.get(sound) ?? { volume, sets: new Set<string>() };
      ambience.set(sound, { ...found, sets: found.sets.add(entry.id) });
    }
  }
  const cutAt = (at: number): number => Math.round(timeline.shots[at]!.startMs);
  const ambienceRuns = [...ambience].flatMap(([sound, { volume, sets: playing }]): CutsceneSound[] => {
    const shots = filmed.flatMap((shot, at) => (shot.set === undefined || playing.has(shot.set) ? [at] : []));
    if (shots.length === filmed.length) return [{ sound, startMs: 0, volume, loop: true }];
    const runs = shots.filter((at, index) => shots[index - 1] !== at - 1);
    return runs.map((first) => {
      let last = first;
      while (shots.includes(last + 1)) last++;
      const away = last + 1 < filmed.length ? cutAt(last + 1) : undefined;
      return { sound, startMs: cutAt(first), volume, loop: true, shot: first, ...(away === undefined ? {} : { endMs: away, fadeOutMs: AMBIENCE_FADE_OUT_MS }) };
    });
  });
  const sounds: CutsceneSound[] = [
    ...ambienceRuns,
    ...(cinematic.sounds ?? []).map(({ sound, line, untilLine, fadeOutMs, fromMs, volume, loop }, at) => {
      const startMs = cues.sounds[at];
      if (startMs === undefined) throw new Error(`The sound ${sound} starts on ${line}, which isn't a line of the scene`);
      const endMs = cues.soundEnds[at];
      if (endMs === undefined) throw new Error(`The sound ${sound} ends on ${untilLine}, which isn't a line of the scene`);
      return { sound, startMs, endMs, fadeOutMs, volume, loop, fromMs };
    }),
  ];

  // Named points a Mission's cues play scenes from, as `<Cinematic id>/<name>` so another Cinematic's may share a name.
  const bookmarks: CutsceneBookmark[] = (cinematic.bookmarks ?? []).map(({ name, line }, at) => {
    const atMs = cues.bookmarks[at];
    if (atMs === undefined) throw new Error(`The bookmark ${name} sits on ${line}, which isn't a line of the scene`);
    return { name: bookmarkEventName(loaded.id, name), atMs };
  });

  // A line whose speaker has no copy in the shot it starts in (a voice over another set's shot, or a
  // speaker no one plays) says it on an Invisible actor of its own in that shot, at its camera's
  // target, as Blizzard's off-screen lines are: the Director's ConversationDriver alone plays no sound.
  // Its copy there lives on to its last line's end, so a line that runs on past the shot (a J cut,
  // intoLineMs) isn't cut off with it.
  const voices = new Map<string, StandingActor & { says: SpokenLine[]; fromMs: number; untilMs: number }>();
  for (const { line, startMs, durationMs } of timeline.lines) {
    const at = timeline.shots.findLastIndex((shot) => shot.startMs <= startMs);
    const speaker = cinematic.cast.find((member) => member.speaker === line.speaker);
    const actor = speaker === undefined ? undefined : standing[castAt.get(speaker.id) ?? -1];
    if (actor && (actor.shots === undefined || actor.shots.includes(at))) continue;
    const key = `${at} ${line.speaker}`;
    const voice = voices.get(key) ?? { model: "Invisible", name: `${line.speaker.toLowerCase()} voice`, at: filmed[at]!.camera.target, shots: [at], outlivesShot: true as const, says: [], fromMs: startMs, untilMs: startMs + durationMs };
    voice.says.push({ lineId: line.lineId, soundId: soundOf(line), startMs, durationMs });
    voice.untilMs = Math.max(voice.untilMs, startMs + durationMs);
    voices.set(key, voice);
  }
  standing.push(...voices.values());

  const light = baseLight(loaded);
  return shotCutscene({
    ...(light ? { light } : {}),
    shots: cinematic.shots.map((shot, at) => {
      const { camera, to, path, shake, lights } = filmed[at]!;
      const feed = shotFeed(at);
      const attach = cameraRide(shot, at);
      return {
        name: shot.name ?? filmed[at]!.name,
        durationMs: timeline.shots[at]!.durationMs,
        from: camera,
        ...(to ? { to } : {}),
        ...(path ? { path } : {}),
        ...((to || path) && shot.move ? { move: shot.move } : {}),
        ...(shake ? { shake } : {}),
        ...(lights?.length ? { lights } : {}),
        ...(shot.light ? { light: shot.light } : {}),
        ...(feed ? { feed } : {}),
        ...(attach ? { attach } : {}),
      };
    }),
    standing,
    lamps,
    // The Transmissions' own conversation and line ids (write-conversation-data), so the two never
    // diverge; a test Cinematic plays none.
    ...(loaded.scene !== undefined && script ? { conversation: { id: script.conversationId, lines: timeline.lines.map(({ line, startMs }) => ({ lineId: line.lineId, startMs })) } } : {}),
    ...(sounds.length ? { sounds } : {}),
    ...(bookmarks.length ? { bookmarks } : {}),
    bookends: true,
  });
}

/**
 * When each of a Cinematic's sounds and each cast member's look-ats start on its clock, and when each
 * sound ends (the Cinematic's end when it gives none), in whole ms as the file writes them, and what
 * in them can't be written: a start at or past the Cinematic's end, a sound's end at or before its
 * start or past the Cinematic's end, or a look-at that doesn't come after the one before. Each
 * problem says what to move (`fix`: its start or its end). What the writer and the timed checks
 * share, so a Cinematic the check passes compiles. Starts and ends on a line the scene doesn't have
 * are cinematicProblems' and are left out.
 */
export function cueStarts(cinematic: Cinematic, timeline: CinematicTimeline): {
  readonly sounds: readonly (number | undefined)[];
  readonly soundEnds: readonly (number | undefined)[];
  /** When each bookmark sits, in `cinematic.bookmarks`' order; none for one on a line the scene doesn't have. */
  readonly bookmarks: readonly (number | undefined)[];
  readonly looks: ReadonlyMap<string, readonly (number | undefined)[]>;
  readonly problems: readonly { readonly path: string; readonly message: string; readonly fix: "its start" | "its end" }[];
} {
  const endMs = Math.round(timeline.contentMs + BOOKENDS.fadeOutMs + BOOKENDS.blackMs);
  const lineStart = new Map(timeline.lines.map(({ line, startMs }) => [line.soundId, Math.round(startMs)]));
  const startOf = (cue: { readonly line?: string | undefined; readonly atMs?: number | undefined }): number | undefined => (cue.line === undefined ? (cue.atMs ?? 0) : lineStart.get(cue.line));
  const problems: { path: string; message: string; fix: "its start" | "its end" }[] = [];
  const pastEnd = (path: string, what: string, ms: number | undefined): void => {
    if (ms !== undefined && ms >= endMs) problems.push({ path, message: `${what} starts ${ms} ms in, at or past the Cinematic's end at ${endMs} ms`, fix: "its start" });
  };
  const sounds = (cinematic.sounds ?? []).map((sound, at) => {
    const ms = startOf(sound);
    pastEnd(`sounds.${at}`, `The sound ${sound.sound}`, ms);
    return ms;
  });
  const soundEnds = (cinematic.sounds ?? []).map((sound, at) => {
    const ms = sound.untilLine === undefined ? (sound.untilMs ?? endMs) : lineStart.get(sound.untilLine);
    const start = sounds[at];
    const path = `sounds.${at}.${sound.untilLine === undefined ? "untilMs" : "untilLine"}`;
    if (ms !== undefined && ms > endMs) problems.push({ path, message: `The sound ${sound.sound} ends ${ms} ms in, past the Cinematic's end at ${endMs} ms`, fix: "its end" });
    else if (ms !== undefined && start !== undefined && start < endMs && ms <= start) problems.push({ path, message: `The sound ${sound.sound} ends ${ms} ms in, at or before its start at ${start} ms`, fix: "its end" });
    return ms;
  });
  const bookmarks = (cinematic.bookmarks ?? []).map((bookmark, at) => {
    const ms = startOf(bookmark);
    pastEnd(`bookmarks.${at}`, `The bookmark ${bookmark.name}`, ms);
    return ms;
  });
  const looks = new Map<string, (number | undefined)[]>();
  cinematic.cast.forEach((member, at) => {
    if (!member.lookAts) return;
    let before: number | undefined;
    looks.set(
      member.id,
      member.lookAts.map((look, index) => {
        const ms = startOf(look);
        const path = `cast.${at}.lookAts.${index}`;
        pastEnd(path, `${member.id}'s look-at at ${look.at}`, ms);
        if (ms !== undefined && before !== undefined && ms <= before) problems.push({ path, message: `${member.id}'s look-at at ${look.at} starts at ${ms} ms, not after the one before at ${before} ms`, fix: "its start" });
        if (ms !== undefined) before = ms;
        return ms;
      }),
    );
  });
  return { sounds, soundEnds, bookmarks, looks, problems };
}

/**
 * How long a set's ambience fades out before a cut away from the set: a quick fade, so the bed
 * doesn't click off, at the short end of Blizzard's sound fade-outs (0.2 to 7 s, 1.9 s typical).
 */
export const AMBIENCE_FADE_OUT_MS = 250;

/** A look-at's type and the attach point it looks at when it gives neither, as Editor-made hub chats turn a head. */
export const DEFAULT_LOOK = { type: "SlowHeadOnly", point: "Head" } as const;

type CastMember = Cinematic["cast"][number];

/** How far (across the ground) a riding camera's target may sit from its carrier before check warns: one Campaign's handheld cameras sit within half a cell of theirs. */
const RIDE_TARGET_CELLS = 1;

/** The cast member called `id`. */
export const memberById = (cast: readonly CastMember[], id: string | undefined): CastMember | undefined => (id === undefined ? undefined : cast.find((member) => member.id === id));

/**
 * The cast in an order that writes each carrier before the members riding it, otherwise as listed.
 * A loop is broken where it's met (the checks report it).
 */
export function carriersFirst(cast: readonly CastMember[]): CastMember[] {
  const ordered: CastMember[] = [];
  const met = new Set<string>();
  const visit = (member: CastMember | undefined): void => {
    if (!member || met.has(member.id)) return;
    met.add(member.id);
    visit(memberById(cast, member.attach?.to));
    ordered.push(member);
  };
  cast.forEach(visit);
  return ordered;
}

/**
 * Where each shot is and what it shows a set's cast through: its set (none: it sees every set),
 * whether its camera is its own, its set camera's name, and the set and camera its feed films (a
 * member's own camera has none).
 */
function shotViews(cinematic: Cinematic): { readonly set?: string; readonly own: boolean; readonly camera?: string; readonly feed?: { readonly set: string; readonly camera?: string } }[] {
  return cinematic.shots.map((shot) => {
    const named = typeof shot.camera === "string" ? splitCamera(shot.camera) : undefined;
    const set = named?.set ?? shot.set;
    const feed = feedOf(shot.feed);
    const fedCamera = feed && splitCamera(feed.camera);
    const fedSet = fedCamera?.set ?? (feed ? memberById(cinematic.cast, feed.camera)?.set : undefined);
    return {
      ...(set !== undefined ? { set } : {}),
      own: named === undefined,
      ...(named ? { camera: named.name } : {}),
      ...(fedSet !== undefined ? { feed: { set: fedSet, ...(fedCamera ? { camera: fedCamera.name } : {}) } } : {}),
    };
  });
}

/**
 * The shots each cast member is copied into, by id: every shot on its set (or on none), but for a
 * mark the set's file showed only through some of its cameras, none through that set's others; a
 * camera of a shot's own hides no one. A shot whose feed films the set shows the member too, unless
 * its mark wasn't seen through the feed's camera. A shot's `hide` hides it whatever its camera. A
 * rider shows only in the shots its carrier does (none for a carrier not in the cast, or a loop).
 * Its entrance and exit aren't counted (castLives).
 */
export function castShots(cinematic: Cinematic, sets: ReadonlyMap<string, SetData>): ReadonlyMap<string, readonly number[]> {
  const views = shotViews(cinematic);
  const shown = new Map<string, readonly number[]>();
  for (const member of carriersFirst(cinematic.cast)) {
    const names = member.mark === undefined ? undefined : sets.get(member.set)?.marks.find((mark) => mark.name === member.mark)?.shots;
    const onShot = (view: (typeof views)[number]): boolean => !((view.set !== undefined && view.set !== member.set) || (names && view.set === member.set && !view.own && !names.includes(view.camera!)));
    const onFeed = (view: (typeof views)[number]): boolean => view.feed?.set === member.set && !(names && view.feed.camera !== undefined && !names.includes(view.feed.camera));
    let shots = views.flatMap((view, at) => (!cinematic.shots[at]!.hide?.includes(member.id) && (onShot(view) || onFeed(view)) ? [at] : []));
    if (member.attach) {
      const carried = new Set(shown.get(member.attach.to) ?? []);
      shots = shots.filter((at) => carried.has(at));
    }
    shown.set(member.id, shots);
  }
  return shown;
}

/** A moment of a Cinematic before it's timed: `ms` into shot `shot`. */
export type ShotMoment = { readonly shot: number; readonly ms: number };
const compareMoments = (a: ShotMoment, b: ShotMoment): number => a.shot - b.shot || a.ms - b.ms;

/**
 * When each cast member exists, by id, as shot moments: from the shot that enters it to the one that
 * exits it (all through when it gives neither). A rider's is cut to its carrier's (`own` is its own,
 * uncut), and is `never` when the two don't overlap.
 */
export function castLives(cinematic: Cinematic): ReadonlyMap<string, { readonly from?: ShotMoment; readonly until?: ShotMoment; readonly own: { readonly from?: ShotMoment; readonly until?: ShotMoment }; readonly never?: true }> {
  const momentOf = (id: string, key: "enters" | "exits"): ShotMoment | undefined => {
    const shot = cinematic.shots.findIndex((entry) => entry[key]?.[id] !== undefined);
    return shot < 0 ? undefined : { shot, ms: cinematic.shots[shot]![key]![id]! };
  };
  const lives = new Map<string, { from?: ShotMoment; until?: ShotMoment; own: { from?: ShotMoment; until?: ShotMoment }; never?: true }>();
  for (const member of carriersFirst(cinematic.cast)) {
    const own = { ...(momentOf(member.id, "enters") ? { from: momentOf(member.id, "enters")! } : {}), ...(momentOf(member.id, "exits") ? { until: momentOf(member.id, "exits")! } : {}) };
    const carrier = member.attach ? lives.get(member.attach.to) : undefined;
    const later = (a?: ShotMoment, b?: ShotMoment): ShotMoment | undefined => (!a ? b : !b ? a : compareMoments(a, b) >= 0 ? a : b);
    const earlier = (a?: ShotMoment, b?: ShotMoment): ShotMoment | undefined => (!a ? b : !b ? a : compareMoments(a, b) <= 0 ? a : b);
    const from = later(own.from, carrier?.from);
    const until = earlier(own.until, carrier?.until);
    const never = carrier?.never || (from && until && compareMoments(until, from) <= 0);
    lives.set(member.id, { ...(from ? { from } : {}), ...(until ? { until } : {}), own, ...(never ? { never: true as const } : {}) });
  }
  return lives;
}

/** Whether a member alive `life` has a copy in shot `at` at all (it enters by the shot's end and hasn't gone at its cut). */
const aliveIn = (life: { readonly from?: ShotMoment; readonly until?: ShotMoment; readonly never?: true }, at: number): boolean =>
  !life.never && !(life.from && life.from.shot > at) && !(life.until && (life.until.shot < at || (life.until.shot === at && life.until.ms === 0)));

/**
 * The members `member` rides through, carrier by carrier, ending where the chain does, or at the
 * first it meets twice (a loop) or that isn't in the cast.
 */
export function carriers(member: CastMember, cast: readonly CastMember[]): string[] {
  const chain: string[] = [];
  for (let at = member.attach?.to; at !== undefined; ) {
    chain.push(at);
    if (at === member.id || chain.indexOf(at) < chain.length - 1) break;
    at = memberById(cast, at)?.attach?.to;
  }
  return chain;
}

/** The cast member a look-at's `at` names: by id, or as `"<set id>/<mark name>"` the one cast on that mark. */
export function lookedAt(at: string, cast: readonly CastMember[]): CastMember | undefined {
  const mark = splitCamera(at);
  return mark ? cast.find((member) => member.set === mark.set && member.mark === mark.name) : memberById(cast, at);
}

/** The look-at a member gets from its mark, all through, when its set's mark has one. */
function lookAtOf(member: CastMember, sets: ReadonlyMap<string, SetData>): NonNullable<CastMember["lookAts"]>[number] | undefined {
  const look = member.mark === undefined ? undefined : sets.get(member.set)?.marks.find((mark) => mark.name === member.mark)?.lookAt;
  return look && { at: `${member.set}/${look.mark}`, ...(look.type ? { type: look.type } : {}), ...(look.point ? { point: look.point } : {}) };
}

/** The base Light a Cinematic starts on: its own `light`, else its first set's first Light. */
const baseLight = ({ cinematic, sets }: LoadedCinematic): string | undefined => cinematic.light ?? sets.get(cinematic.sets[0]!.id)!.lights[0];

/** The Light ids a Cinematic plays, each once: its base Light, then the shots' switches. */
export function cinematicLights(loaded: LoadedCinematic): string[] {
  const base = baseLight(loaded);
  return [...new Set([...(base ? [base] : []), ...loaded.cinematic.shots.flatMap((shot) => (shot.light ? [shot.light] : []))])];
}

/**
 * Warnings for the Lights a Cinematic names (its base `light`, its shots' `light`) that are none
 * of its sets' Lights, the Mission's own `lights` (a mod's Cinematic, with no `blueprint`, has
 * none), a loaded Plugin's Lights, stock or the Campaign Mod's: a dependency may define one, but a
 * typo plays as the default Light.
 */
export function cinematicLightWarnings(
  loaded: LoadedCinematic,
  blueprint: Pick<MissionBlueprint, "lights"> | undefined,
  { registry: plugins, catalog }: { readonly registry: PluginRegistry; readonly catalog: Catalog },
): CinematicProblem[] {
  const known = (id: string): boolean =>
    [...loaded.sets.values()].some((set) => set.lights.includes(id)) || (blueprint?.lights ?? []).some((light) => light.id === id) || plugins.light(id) !== undefined || isKnownLight(catalog, id);
  const contributed = plugins.contributions("lights").map((light) => light.id);
  const named = [
    ...(loaded.cinematic.light ? [{ path: "light", id: loaded.cinematic.light }] : []),
    ...loaded.cinematic.shots.flatMap((shot, at) => (shot.light ? [{ path: `shots.${at}.light`, id: shot.light }] : [])),
  ];
  return named
    .filter(({ id }) => !known(id))
    .map(({ path, id }) => ({
      file: loaded.file,
      path,
      message: `No Light ${id} in its sets' Lights, ${blueprint ? "the Mission's lights, " : ""}a Plugin's Lights (${contributed.length ? contributed.join(", ") : "none"}), data/light-catalog.json or the Campaign Mod; check a dependency defines it`,
      severity: "warning" as const,
    }));
}

/**
 * Every Cinematic of a Blueprint as its .SC2Cutscene, by Cinematic id, timed from the voice files in
 * `audioDir`. Throws with every problem when any can't be written.
 */
export async function compileCinematics(
  root: string,
  blueprint: MissionBlueprint,
  blueprintPath: string,
  script: VoicedScript | undefined,
): Promise<Record<string, { readonly xml: string; readonly shots: number; readonly lights: readonly string[] }>> {
  const { loaded, problems } = await loadCinematics(root, blueprint, blueprintPath);
  // The models of the Catalog the Blueprint was validated against.
  const models = await castModels(blueprintCatalog(blueprint));
  const all = [...problems, ...(script ? loaded.flatMap((entry) => cinematicProblems(entry, script.script, blueprintPath, models)) : [])].filter(isCinematicError);
  if (all.length) throw new Error(`The Cinematics can't be written: ${all.map(formatCinematicProblem).join("; ")}`);
  const written: Record<string, { xml: string; shots: number; lights: readonly string[] }> = {};
  for (const entry of loaded) {
    const lines = sceneLines(script!.script, entry.scene) ?? [];
    written[entry.id] = { ...writeChecked(entry, script!.script, await voicedLengthsMs(lines, script!), models, script!.soundOf), lights: cinematicLights(entry) };
  }
  return written;
}

/**
 * A checked Cinematic as its .SC2Cutscene. A cut inside a line, a move or a timed anim can only be
 * checked against the shot's length here, once the voices are timed: those throw, naming the file.
 */
export function writeChecked(entry: LoadedCinematic, script: Script | undefined, lengths: ReadonlyMap<string, number>, models: CastModels, soundOf?: (line: ScriptLine) => string): { readonly xml: string; readonly shots: number } {
  try {
    return { xml: cinematicCutscene(entry, script, lengths, models, soundOf), shots: entry.cinematic.shots.length };
  } catch (error) {
    throw new Error(`The Cinematic ${entry.file} can't be written: ${(error as Error).message}`);
  }
}

/**
 * A test Cinematic as its .SC2Cutscene: the file cinematics/<id>.json beside the Blueprint, which
 * the Blueprint doesn't list, compiled with its sets and no scene, so it plays no lines. For judging
 * a set's framing in game before its shots join a scene's Cinematic. Throws with every problem when
 * it can't be written.
 */
export async function compileTestCinematic(
  root: string,
  blueprintPath: string,
  id: string,
  /** The Workspace's, whose Campaign Mod's models it may place. */
  catalog: Catalog,
): Promise<{ readonly xml: string; readonly shots: number; readonly lights: readonly string[] }> {
  const { loaded, problems } = await loadCinematic(root, blueprintPath, { id, index: -1, scene: undefined });
  const models = await castModels(catalog);
  const all = [...problems, ...(loaded ? cinematicProblems(loaded, undefined, blueprintPath, models) : [])].filter(isCinematicError);
  if (all.length) throw new Error(`The Cinematics can't be written: ${all.map(formatCinematicProblem).join("; ")}`);
  return { ...writeChecked(loaded!, undefined, new Map(), models), lights: cinematicLights(loaded!) };
}

export const formatCinematicProblem = (problem: CinematicProblem): string => `${problem.file}${problem.path ? ` ${problem.path}` : ""}: ${problem.message}`;
