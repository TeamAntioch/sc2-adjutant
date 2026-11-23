// Trigger scenes: a Mission's shot lists on its own map (missions/<id>/trigger-scenes/<id>.json),
// checked against the Blueprint's camera Anchors and the Screenplay, and timed to the scene's lines
// from the voice files, as Cinematics are. `check-workspace` reports their problems; `compile-map`
// writes each into the Map Package's triggers (triggers/trigger-scene-triggers.ts; ADR 0012).

import path from "node:path";

import { blueprintCatalog, layerSource } from "../catalog/catalog-layer.js";
import { isKnownBehavior, techUnit } from "../catalog/tech-catalog.js";
import { bySpeaker, speakerKey } from "../domain/character.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import {
  openEaseMs,
  type TriggerScene,
  type TriggerSceneBuild,
  type TriggerSceneOrder,
  type TriggerScenePlace,
  TriggerSceneSchema,
  type TriggerSceneUnitAim,
  type TriggerSceneWarpIn,
  type TriggerSceneWarpOut,
} from "../domain/trigger-scene.js";
import type { Script, ScriptLine } from "../script/name-script.js";
import { conditionPath, cueUnitOf } from "../triggers/cue-triggers.js";
import { cueRuns, sceneStraightBefore } from "../triggers/scene-chain.js";
import { loadedMusicSoundMs } from "../catalog/music-sounds.js";
import { isWaveUnit, keptReference, namesUnit } from "../triggers/kept-ids.js";
import { triggerSceneWorldProblems } from "../triggers/trigger-scene-world.js";
import { type CinematicProblem, cinematicTimeline, formatCinematicProblem, isCinematicError, issuesOf, readJson, sceneLines, type VoicedScript, voicedLengthsMs } from "./cinematic.js";

/**
 * The trigger-scene template's timings (RECIPES.md "Trigger scene"; T3, H2), in ms: the fade in
 * from black after the first cut, the fade out at the natural end or after a skip, and the
 * handback (fade in, Cinematic Mode off and the camera's settle together) after either.
 */
export const TRIGGER_SCENE_TIMES = { fadeInMs: 1500, fadeOutMs: 2000, skippedFadeOutMs: 500, handbackMs: 1500, skippedHandbackMs: 1000 } as const;

/**
 * T4's budget for a victory outro (`outro: "victory"`), in ms: about 25 s, with a warning over 45 s
 * (Blizzard's median and 90th percentile, CHECKS.md). The same shape as the trigger-scene checks'
 * other T4 budgets, for them to use on an outro. An outro runs from its fade in to the end of its
 * fade out, since it never hands back.
 */
export const TRIGGER_SCENE_OUTRO_LENGTH = { aboutMs: 25_000, warnMs: 45_000 } as const;

export type LoadedTriggerScene = {
  readonly id: string;
  /** Its place in the Blueprint's `screenplay.script.triggerScenes`. */
  readonly index: number;
  /** The script scene it plays; none for a victory outro listed by its outcome. */
  readonly scene?: number;
  /** `"victory"`: listed by the outcome it plays on, with no Screenplay scene, so no lines. */
  readonly outcome?: "victory";
  readonly file: string;
  readonly triggerScene: TriggerScene;
};

/**
 * A trigger scene timed to its lines: each shot's lines, in order, and how long it runs from its cut
 * (a move's length), the lines it plays in play after its handback (`handback.linesFrom`), and when
 * each music cue starts, in ms from the first cut.
 */
export type TimedTriggerScene = LoadedTriggerScene & {
  readonly shots: readonly { readonly lines: readonly ScriptLine[]; readonly durationMs: number }[];
  readonly afterHandback: readonly ScriptLine[];
  readonly cueStartsMs: readonly number[];
  /** When its last shot's lines and pause end, where the fade out starts. */
  readonly contentMs: number;
};

/** Where a Blueprint's trigger scene `id` lives: trigger-scenes/<id>.json beside the blueprint. */
export const triggerScenePath = (blueprintPath: string, id: string): string => path.join(path.dirname(blueprintPath), "trigger-scenes", `${id}.json`);

/** Reads each of the Blueprint's trigger scenes: the ones that read, and every problem met. */
export async function loadTriggerScenes(blueprint: MissionBlueprint, blueprintPath: string): Promise<{ readonly loaded: readonly LoadedTriggerScene[]; readonly problems: readonly CinematicProblem[] }> {
  const loaded: LoadedTriggerScene[] = [];
  const problems: CinematicProblem[] = [];
  for (const [index, { id, scene, outcome }] of (blueprint.screenplay.script?.triggerScenes ?? []).entries()) {
    const file = triggerScenePath(blueprintPath, id);
    const read = await readJson(file);
    if ("problem" in read) {
      problems.push({ file, message: read.problem });
      continue;
    }
    const parsed = TriggerSceneSchema.safeParse(read.value);
    if (!parsed.success) {
      problems.push(...issuesOf(file, parsed.error));
      continue;
    }
    loaded.push({ id, index, ...(scene !== undefined ? { scene } : {}), ...(outcome !== undefined ? { outcome } : {}), file, triggerScene: parsed.data });
  }
  return { loaded, problems };
}

/**
 * What would stop a trigger scene compiling: a camera that isn't one of the Blueprint's camera
 * Anchors (or a Kept camera), a line that isn't its scene's, lines named out of the scene's order,
 * a first shot on a line after the scene's first, which would play the lines before it under the
 * cut meant for it, or a first shot waiting `afterMs` after nothing; and in its cast, a unit type
 * the Catalog lacks, a place that isn't a point Anchor, a live unit that isn't a unit Anchor, an
 * order to a staged unit the cast doesn't have, or an id given twice; and in its marks and orders, a
 * unit that isn't a unit Anchor, a unit marked twice, a walk for a unit the scene pauses, or an
 * order to a unit after it has withdrawn, or to a player's units in a Zone that isn't one (or a Kept
 * region); and in its aims, an Anchor that isn't a unit, or the cue's
 * unit when a cue that plays the scene names none (only anchorNears and effectStarts keep one). Of the handback: a camera on a
 * handback with no fade, a ping on anything but a unit Anchor, an objective the Blueprint hasn't,
 * and a `linesFrom` that isn't the scene's or comes at or before a shot's line. A victory outro has no handback. Of
 * its `speakers`: a staged unit the cast hasn't, a speaker given twice, a speaker with no line in the shots, or one
 * with a line after the handback, once the cast is gone. In its actor events, a staged unit the cast hasn't, or one
 * that has withdrawn by then. And a fog change the cleanup can't set back, and an open with no fade
 * beside what Setup changes under black, or on a scene played straight after another (openProblems).
 */
export function triggerSceneProblems(loaded: LoadedTriggerScene, blueprint: MissionBlueprint, script: Script): CinematicProblem[] {
  const { file, triggerScene } = loaded;
  const problems: CinematicProblem[] = [];
  const isCamera = (id: string): boolean => blueprint.anchors.some((anchor) => anchor.id === id && anchor.kind === "camera") || keptReference(blueprint, id, "camera") !== undefined;
  const camera = (id: string, at: string): void => {
    if (isCamera(id)) return;
    const anchor = blueprint.anchors.find((candidate) => candidate.id === id);
    problems.push({ file, path: at, message: anchor ? `${id} is a ${anchor.kind} Anchor, not a camera` : `No camera Anchor ${id} in the Blueprint` });
  };
  // The cue types that play the scene and keep no unit, for a shot aimed at the cue's.
  // One listed by its outcome plays on the victory conditions, which keep none (only anchorNears and effectStarts do).
  const unitless =
    loaded.scene === undefined
      ? [...new Set(blueprint.outcomes.victory.map((condition) => condition.type))]
      : [...new Set((blueprint.screenplay.script?.cues ?? []).filter((entry) => entry.scene === loaded.scene && cueUnitOf(blueprint, entry.cue) === undefined).map((entry) => entry.cue.type))];
  const aim = (target: TriggerSceneUnitAim, at: string): void => {
    if (target === "cue") {
      for (const type of unitless) {
        problems.push({
          file,
          path: at,
          message:
            loaded.scene === undefined
              ? `The shot aims at the cue's unit, but ${loaded.id} plays on the victory outcome's ${type} condition, which gives a scene no unit to aim at (only an anchorNears or effectStarts cue does); aim at a unit Anchor`
              : `The shot aims at the cue's unit, but scene ${loaded.scene} plays on ${/^[aeiou]/.test(type) ? "an" : "a"} ${type} cue, which names none; cue it on anchorNears or effectStarts, or aim at a unit Anchor`,
        });
      }
      return;
    }
    const { anchorId } = target;
    if (namesUnit(blueprint, anchorId)) return;
    const anchor = blueprint.anchors.find((candidate) => candidate.id === anchorId);
    problems.push({ file, path: at, message: anchor ? `${anchorId} is a ${anchor.kind} Anchor, not a unit` : `No unit Anchor ${anchorId} in the Blueprint` });
  };
  const lines = sceneLines(script, loaded.scene);
  if (!lines) return [{ file, message: `The script has no scene ${loaded.scene}` }];
  // A line it names that isn't its scene's; listed by its outcome, it has no scene, so no lines at all.
  const noLine = (soundId: string): string =>
    loaded.scene === undefined ? `${loaded.id} plays on the victory outcome with no Screenplay scene, so it has no lines; leave out ${soundId}` : `No line ${soundId} in scene ${loaded.scene}`;
  // A cued victory outro can't end the game too when one plays on the victory outcome, last on every victory condition.
  const byOutcome = (blueprint.screenplay.script?.triggerScenes ?? []).find((entry) => entry.outcome !== undefined);
  if (loaded.outcome === undefined && triggerScene.outro !== undefined && byOutcome !== undefined) {
    problems.push({ file, path: "outro", message: `${byOutcome.id} plays on the victory outcome, last on every victory condition, so ${loaded.id} can't end the game too: list one victory outro` });
  }
  if (loaded.outcome !== undefined) {
    if (triggerScene.outro === undefined) problems.push({ file, path: "outro", message: `${loaded.id} plays on the victory outcome, so it is a victory outro: give it outro "victory"` });
    if (blueprint.outcomes.victory.length === 0) problems.push({ file, message: `${loaded.id} plays on the victory outcome, but the Blueprint has no victory condition, so it would never play` });
  }
  const { handback } = triggerScene;
  const linesFrom = handback?.linesFrom === undefined ? lines.length : lines.findIndex((line) => line.soundId === handback.linesFrom);
  if (linesFrom < 0) problems.push({ file, path: "handback.linesFrom", message: noLine(handback!.linesFrom!) });
  let before = -1;
  triggerScene.shots.forEach((shot, at) => {
    camera(shot.camera, `shots.${at}.camera`);
    if (at === 0 && shot.afterMs) problems.push({ file, path: "shots.0.afterMs", message: "The first shot starts the scene, so it has nothing to wait after; give it afterMs 0, or a pauseAfterMs to hold it" });
    if (shot.to !== undefined) camera(shot.to, `shots.${at}.to`);
    if (shot.unit !== undefined) aim(shot.unit, `shots.${at}.unit`);
    if (shot.toUnit !== undefined) aim(shot.toUnit, `shots.${at}.toUnit`);
    if (shot.line === undefined) return;
    const index = lines.findIndex((line) => line.soundId === shot.line);
    if (index < 0) {
      problems.push({ file, path: `shots.${at}.line`, message: noLine(shot.line) });
      return;
    }
    if (index <= before) problems.push({ file, path: `shots.${at}.line`, message: `${shot.line} comes before the line of a shot before it; shots name their lines in the scene's order` });
    if (at === 0 && index > 0) problems.push({ file, path: `shots.0.line`, message: `The first shot cuts on ${shot.line}, but the scene starts with ${lines[0]!.soundId}; start the first shot on it, or with afterMs` });
    if (linesFrom >= 0 && index >= linesFrom) problems.push({ file, path: `shots.${at}.line`, message: `${shot.line} plays after the handback (handback.linesFrom), so no shot can cut on it` });
    before = index;
  });
  // Speakers who speak from a staged unit: one the cast has, with lines in the shots, and none after
  // the handback, by when the Cleanup has removed the cast.
  const castIds = new Set((triggerScene.cast ?? []).map((member) => member.id));
  const speakerNamed = new Map<string, string>();
  for (const [speaker, castId] of Object.entries(triggerScene.speakers ?? {})) {
    const where = `speakers.${speaker}`;
    const key = speakerKey(speaker);
    const same = speakerNamed.get(key);
    if (same !== undefined) problems.push({ file, path: where, message: `${speaker} and ${same} are one speaker; give it once` });
    speakerNamed.set(key, speaker);
    if (!castIds.has(castId)) problems.push({ file, path: where, message: `No staged unit ${castId} in the scene's cast` });
    const spoken = lines.flatMap((line, index) => (speakerKey(line.speaker) === key ? [index] : []));
    const after = linesFrom >= 0 ? spoken.find((index) => index >= linesFrom) : undefined;
    if (after !== undefined) {
      problems.push({ file, path: where, message: `${lines[after]!.soundId} plays after the handback (handback.linesFrom), once the Cleanup has removed the staged cast, so ${castId} can't speak it` });
    } else if (spoken.length === 0) {
      problems.push({ file, path: where, message: loaded.scene === undefined ? `${speaker} speaks no line: ${loaded.id} has no Screenplay scene, so no lines` : `${speaker} speaks no line in scene ${loaded.scene}'s shots` });
    }
  }
  if (handback?.camera !== undefined) {
    camera(handback.camera, "handback.camera");
    if (handback.fade === false) problems.push({ file, path: "handback.camera", message: "A handback with no fade leaves the camera where the scene left it, so it names no camera" });
  }
  handback?.ping?.forEach((id, at) => {
    if (namesUnit(blueprint, id)) return;
    const anchor = blueprint.anchors.find((candidate) => candidate.id === id);
    problems.push({ file, path: `handback.ping.${at}`, message: anchor ? `${id} is a ${anchor.kind} Anchor, not a unit` : `No unit Anchor ${id} in the Blueprint` });
  });
  if (triggerScene.outro !== undefined && handback !== undefined) {
    problems.push({ file, path: "handback", message: "A victory outro ends the game instead of handing back, so it has no handback" });
  }
  if (handback?.objective !== undefined && !blueprint.objectives.some((objective) => objective.id === handback.objective)) {
    problems.push({ file, path: "handback.objective", message: `No objective ${handback.objective} in the Blueprint` });
  }
  problems.push(...castProblems(loaded, blueprint));
  (triggerScene.music?.cues ?? []).forEach((cue, at) => {
    if (loadedMusicSoundMs(cue.sound) === undefined) {
      problems.push({
        file,
        path: `music.cues.${at}.sound`,
        message: `M1: ${cue.sound} isn't a Music Sound our maps load (the game's in our dependency stack, not a silent or empty one); a map-defined CSound needs the plan to say so`,
        severity: "warning",
      });
    }
    if (cue.line !== undefined && !lines.some((line) => line.soundId === cue.line)) problems.push({ file, path: `music.cues.${at}.line`, message: noLine(cue.line) });
  });
  problems.push(...triggerSceneWorldProblems(triggerScene, blueprint).map((problem) => ({ file, ...problem })));
  problems.push(...openProblems(loaded, blueprint));
  return problems;
}

/**
 * A scene that opens with no fade (`open.fade: false`) opens in the player's sight, so Setup's
 * changes made under black would be seen: a staged cast popping in, marked units jumping, live
 * units vanishing, the Light, fog or black mask switching. Pausing a live unit shows nothing, so it
 * stays. And a scene a cue plays straight after a Cinematic or another trigger scene opens on the
 * black that one hands on under (ADR 0012), so it can't open with no fade; one that hands on can.
 */
function openProblems(loaded: LoadedTriggerScene, blueprint: MissionBlueprint): CinematicProblem[] {
  const { file, triggerScene } = loaded;
  if (triggerScene.open?.fade !== false) return [];
  const problems: CinematicProblem[] = [];
  const inSight = (at: string, what: string, edit: string): void => {
    problems.push({ file, path: at, message: `The scene opens with no fade (open.fade: false), so Setup would ${what} in the player's sight${edit}` });
  };
  if (triggerScene.cast?.length) inSight("cast", "create its staged cast", ", popping in: open from black, or leave out the cast");
  if (triggerScene.marks?.length) inSight("marks", "move its marked units", ", jumping: open from black, or leave out the marks");
  (triggerScene.live ?? []).forEach(({ unit, hide }, at) => {
    if (hide) inSight(`live.${at}.hide`, `hide ${unit}`, ", vanishing: open from black, or only pause it");
  });
  if (triggerScene.light !== undefined) inSight("light", "switch the Light", ": open from black, or leave out light");
  if (triggerScene.fog !== undefined) inSight("fog", "change the fog", ": open from black, or leave out fog");
  if (triggerScene.mask !== undefined) inSight("mask", "lift the black mask and the fog of war", ": open from black, or leave out mask");
  const before = playedStraightAfter(loaded, blueprint);
  if (before) {
    const black = "and opens on the black that scene hands on under, so it can't open with no fade: open it from black";
    problems.push({
      file,
      path: "open.fade",
      message:
        loaded.scene === undefined
          ? `${loaded.id} plays last on the victory outcome's ${before.cue} cue, straight after scene ${before.scene}, ${black}, or cue that scene elsewhere`
          : `Scene ${loaded.scene} plays straight after scene ${before.scene} on its ${before.cue} cue, ${black}, or play it on its own`,
    });
  }
  return problems;
}

/**
 * The first Cinematic or trigger scene some cue plays straight before this trigger scene, which it
 * then takes over from under black (ADR 0012), with that cue's type. A scene listed by the victory
 * outcome plays last on each cue of a victory condition, so after that cue's last scene.
 */
function playedStraightAfter(loaded: LoadedTriggerScene, blueprint: MissionBlueprint): { readonly scene: number; readonly cue: string } | undefined {
  const reference = blueprint.screenplay.script;
  const staged = new Set([...(reference?.cinematics ?? []).map(({ scene }) => scene), ...(reference?.triggerScenes ?? []).flatMap(({ scene }) => (scene === undefined ? [] : [scene]))]);
  // The cues that are one of the victory conditions share its path.
  const victories = new Set(blueprint.outcomes.victory.map(conditionPath));
  for (const [key, { cue, entries }] of cueRuns(reference?.cues ?? [])) {
    if (loaded.scene === undefined) {
      if (!victories.has(key)) continue;
      // Last in the run, as the compile adds it (no scene is numbered 0).
      const last = sceneStraightBefore([...entries, { scene: 0, behind: false }], entries.length);
      if (last !== undefined && staged.has(last)) return { scene: last, cue: cue.type };
      continue;
    }
    const at = entries.findIndex(({ scene }, index) => scene === loaded.scene && staged.has(sceneStraightBefore(entries, index) ?? -1));
    if (at >= 0) return { scene: sceneStraightBefore(entries, at)!, cue: cue.type };
  }
  return undefined;
}

const inSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/**
 * A timed scene's music cues: one that starts after the scene ends never plays, and one that fades
 * from before it starts can't be built. One still playing when the scene ends, by its untilMs or,
 * with none, by its file's length from its in-point, is cut off by the cleanup's stop rather than
 * ended on purpose (M4).
 */
export function triggerSceneMusicChecks(timed: TimedTriggerScene): CinematicProblem[] {
  const { file, contentMs } = timed;
  const problems: CinematicProblem[] = [];
  (timed.triggerScene.music?.cues ?? []).forEach((cue, at) => {
    const startMs = timed.cueStartsMs[at]!;
    const where = `music.cues.${at}`;
    const starts = cue.line === undefined ? "" : ` on ${cue.line}`;
    if (startMs >= contentMs) {
      problems.push({ file, path: where, message: `Cue ${at + 1} starts${starts} at ${inSeconds(startMs)}, once the scene has ended at ${inSeconds(contentMs)}, so it never plays` });
    } else if (cue.untilMs === undefined) {
      const lengthMs = loadedMusicSoundMs(cue.sound);
      const endMs = typeof lengthMs === "number" ? startMs + lengthMs - (cue.fromMs ?? 0) : undefined;
      if (endMs === undefined || endMs > contentMs) {
        problems.push({
          file,
          path: where,
          message: `M4: cue ${at + 1} still plays when the scene ends at ${inSeconds(contentMs)}, so the cleanup cuts it off with a fade; give it an untilMs (and a fadeOutMs) to end it on purpose`,
          severity: "warning",
        });
      }
    } else if (cue.untilMs <= startMs) {
      problems.push({ file, path: `${where}.untilMs`, message: `Cue ${at + 1} fades from ${inSeconds(cue.untilMs)}, before it starts${starts} at ${inSeconds(startMs)}` });
    } else if (cue.untilMs + (cue.fadeOutMs ?? 0) > contentMs) {
      problems.push({ file, path: where, message: `M4: cue ${at + 1} fades from ${inSeconds(cue.untilMs)}, after the scene ends at ${inSeconds(contentMs)}, so the cleanup cuts it off; end its fade by then`, severity: "warning" });
    }
  });
  return problems;
}

/** The structure the first command (Build1) of each of the game's build abilities builds, from its AbilData. */
const STOCK_FIRST_BUILDS: Readonly<Record<string, string>> = { ProtossBuild: "Nexus", TerranBuild: "CommandCenter", ZergBuild: "Hatchery" };

/** The cast's problems: what staging and the shots' orders would get wrong in game. */
function castProblems({ file, triggerScene }: LoadedTriggerScene, blueprint: MissionBlueprint): CinematicProblem[] {
  const problems: CinematicProblem[] = [];
  const catalog = blueprintCatalog(blueprint);
  // An Anchor of `kind` by id (or a Kept one), else what it is instead.
  const anchor = (id: string, kind: "point" | "unit", at: string): void => {
    if (blueprint.anchors.some((candidate) => candidate.id === id && candidate.kind === kind) || keptReference(blueprint, id, kind) !== undefined) return;
    const found = blueprint.anchors.find((candidate) => candidate.id === id);
    const kept = keptReference(blueprint, id);
    problems.push({ file, path: at, message: found ? `${id} is a ${found.kind} Anchor, not a ${kind}` : kept ? `${id} is a Kept ${kept.kind}, not a ${kind}` : `No ${kind} Anchor ${id} in the Blueprint` });
  };
  const place = (at: TriggerScenePlace, where: string): void => {
    if (typeof at === "string") anchor(at, "point", where);
  };
  // A Zone by id, or a Kept region.
  const zone = (id: string, at: string): void => {
    if (blueprint.zones.some((candidate) => candidate.id === id) || keptReference(blueprint, id, "region") !== undefined) return;
    const found = blueprint.anchors.find((candidate) => candidate.id === id);
    const kept = keptReference(blueprint, id);
    problems.push({ file, path: at, message: found ? `${id} is a ${found.kind} Anchor, not a Zone` : kept ? `${id} is a Kept ${kept.kind}, not a Zone or Kept region` : `No Zone ${id} in the Blueprint` });
  };
  const cast = new Set<string>();
  // The triggers name each member's group with its id's hyphens as underscores.
  const named = new Map<string, string>();
  (triggerScene.cast ?? []).forEach((member, at) => {
    const name = member.id.replace(/-/g, "_");
    if (cast.has(member.id)) problems.push({ file, path: `cast.${at}.id`, message: `${member.id} is in the cast twice` });
    else if (named.has(name)) problems.push({ file, path: `cast.${at}.id`, message: `${member.id} and ${named.get(name)} would name one unit group in the triggers; rename one` });
    cast.add(member.id);
    if (!named.has(name)) named.set(name, member.id);
    if (!techUnit(catalog, member.unitType)) problems.push({ file, path: `cast.${at}.unitType`, message: `${member.unitType} isn't a unit the Catalog has (data/tech-catalog.json${layerSource(catalog)})` });
    place(member.at, `cast.${at}.at`);
  });
  const live = new Set<string>();
  (triggerScene.live ?? []).forEach(({ unit }, at) => {
    if (live.has(unit)) problems.push({ file, path: `live.${at}.unit`, message: `${unit} is listed twice; give it hide and pause together` });
    live.add(unit);
    anchor(unit, "unit", `live.${at}.unit`);
  });
  const marked = new Set<string>();
  (triggerScene.marks ?? []).forEach(({ unit, at: mark }, at) => {
    if (marked.has(unit)) problems.push({ file, path: `marks.${at}.unit`, message: `${unit} has a mark already` });
    marked.add(unit);
    anchor(unit, "unit", `marks.${at}.unit`);
    place(mark, `marks.${at}.at`);
  });
  const paused = new Set((triggerScene.live ?? []).filter((unit) => unit.pause).map(({ unit }) => unit));
  // The order each live unit or staged group withdrew in, checked in the order the orders are given,
  // so a later order to it is caught. Its first withdrawal, which is the one that removes it.
  const withdrawn = new Map<string, string>();
  const ordered = (name: string, at: string): void => {
    const gone = withdrawn.get(name);
    if (gone !== undefined) problems.push({ file, path: at, message: `${name} has withdrawn by then (${gone})` });
  };
  // Each live unit's first warp-out, which removes it: an order, build or warp-out after it is too late.
  const warps = warpsInTime(triggerScene);
  const warpedOut = new Map<string, { readonly index: number; readonly atMs: number; readonly where: string }>();
  // Given at a cut or atMs into a shot, after the unit's warp-out (an order or build at the same moment comes before it).
  const goneBy = (unit: string, index: number, atMs: number, path: string): void => {
    const gone = warpedOut.get(unit);
    if (gone && (index > gone.index || (index === gone.index && atMs > gone.atMs))) problems.push({ file, path, message: `${unit} has warped out by then (${gone.where})` });
  };
  // Each warp-in's units taken by their player's army warping out, under the warp-in's id.
  const warpInsOut = new Map<string, { readonly index: number; readonly atMs: number; readonly where: string }>();
  const warpInsSoFar: TriggerSceneWarpIn[] = [];
  for (const warp of warps) {
    if (warp.kind === "warpIn") warpInsSoFar.push(warp.action);
    if (warp.kind !== "warpOut") continue;
    const out = { index: warp.index, atMs: warp.action.atMs ?? 0, where: warpPath(warp) };
    // A player's army takes each of their unit Anchors with it that isn't a structure, as the game
    // gathers it, but those it keeps (except), and every unit of theirs warped in before it.
    const kept = new Set<string>();
    (warp.action.except ?? []).forEach((unit, n) => {
      const where = `${warpPath(warp)}.except.${n}`;
      if (kept.has(unit)) problems.push({ file, path: where, message: `${unit} is in this except twice` });
      kept.add(unit);
      anchor(unit, "unit", where);
    });
    if (warp.action.player !== undefined) {
      for (const candidate of blueprint.anchors) {
        if (candidate.kind !== "unit" || (candidate as { player?: number }).player !== warp.action.player || warpedOut.has(candidate.id) || kept.has(candidate.id)) continue;
        const unitType = (candidate as { unitType?: string }).unitType;
        if (unitType !== undefined && techUnit(catalog, unitType)?.structure) continue;
        warpedOut.set(candidate.id, out);
      }
      for (const warpIn of warpInsSoFar) if (warpIn.player === warp.action.player && !warpInsOut.has(warpIn.id)) warpInsOut.set(warpIn.id, out);
    }
    const given = new Set<string>();
    (warp.action.units ?? []).forEach((unit, n) => {
      const where = `${warpPath(warp)}.units.${n}`;
      if (given.has(unit)) problems.push({ file, path: where, message: `${unit} is in this warp-out twice` });
      given.add(unit);
      anchor(unit, "unit", where);
      const gone = warpedOut.get(unit);
      if (gone) problems.push({ file, path: where, message: `${unit} has warped out by then (${gone.where})` });
      else warpedOut.set(unit, { index: warp.index, atMs: warp.action.atMs ?? 0, where: warpPath(warp) });
    });
  }
  // Each live unit's first withdrawal, when it's given: a build by it after that is too late.
  const withdrewAt = new Map<string, { readonly index: number; readonly atMs: number; readonly where: string }>();
  // Each staged group's first withdrawal, when it's given: an actor event on it after that finds no unit.
  const castWithdrewAt = castWithdrawals(triggerScene);
  for (const { order, index, at } of ordersInTime(triggerScene)) {
    const where = `shots.${index}.orders.${at}`;
    for (const [n, unit] of (order.units ?? []).entries()) goneBy(unit, index, order.atMs ?? 0, `${where}.units.${n}`);
    if (order.cast !== undefined) {
      if (!cast.has(order.cast)) problems.push({ file, path: `${where}.cast`, message: `No staged unit ${order.cast} in the scene's cast` });
      ordered(order.cast, `${where}.cast`);
    }
    const given = new Set<string>();
    (order.units ?? []).forEach((unit, n) => {
      if (given.has(unit)) problems.push({ file, path: `${where}.units.${n}`, message: `${unit} is in this order twice` });
      given.add(unit);
      anchor(unit, "unit", `${where}.units.${n}`);
      if (paused.has(unit)) problems.push({ file, path: `${where}.units.${n}`, message: `${unit} is paused for the scene (live), so it can't walk` });
      ordered(unit, `${where}.units.${n}`);
    });
    if (order.withdraw) for (const name of order.cast !== undefined ? [order.cast] : (order.units ?? [])) if (!withdrawn.has(name)) withdrawn.set(name, where);
    if (order.withdraw) for (const unit of order.units ?? []) if (!withdrewAt.has(unit)) withdrewAt.set(unit, { index, atMs: order.atMs ?? 0, where });
    place(order.moveTo, `${where}.moveTo`);
    if (order.inZone !== undefined) zone(order.inZone, `${where}.inZone`);
  }
  // Actor events on live unit Anchors, before their unit warps out, or on the staged cast.
  triggerScene.shots.forEach((shot, index) =>
    (shot.actorEvents ?? []).forEach((event, at) => {
      if (event.cast !== undefined) {
        const where = `shots.${index}.actorEvents.${at}.cast`;
        if (!cast.has(event.cast)) problems.push({ file, path: where, message: `No staged unit ${event.cast} in the scene's cast` });
        const gone = castWithdrewAt.get(event.cast);
        if (gone && (index > gone.index || (index === gone.index && (event.atMs ?? 0) > gone.atMs))) problems.push({ file, path: where, message: `${event.cast} has withdrawn by then (${gone.where})` });
        return;
      }
      const where = `shots.${index}.actorEvents.${at}.unit`;
      anchor(event.unit!, "unit", where);
      goneBy(event.unit!, index, event.atMs ?? 0, where);
    }),
  );
  // Unit changes on live unit Anchors, before their unit warps out, with behaviours the Catalog has.
  triggerScene.shots.forEach((shot, index) =>
    (shot.unitChanges ?? []).forEach((change, at) => {
      const where = `shots.${index}.unitChanges.${at}`;
      anchor(change.unit, "unit", `${where}.unit`);
      goneBy(change.unit, index, change.atMs ?? 0, `${where}.unit`);
      for (const key of ["removeBehaviors", "addBehaviors"] as const)
        (change[key] ?? []).forEach((behavior, n) => {
          if (!isKnownBehavior(catalog, behavior)) problems.push({ file, path: `${where}.${key}.${n}`, message: `${behavior} isn't a behaviour the Catalog has (data/tech-catalog.json${layerSource(catalog)})` });
        });
    }),
  );
  // Warp-ins, as the cast is checked, and builds by a warp-in already in or a unit Anchor.
  const warpedIn = new Set<string>();
  const warpNamed = new Map<string, string>();
  // The build each builder was last given, by shot and atMs: a second at the same moment replaces it.
  const building = new Map<string, { readonly index: number; readonly atMs: number; readonly where: string }>();
  for (const warp of warps) {
    const where = warpPath(warp);
    if (warp.kind === "warpIn") {
      const { id, unitType, at } = warp.action;
      const name = id.replace(/-/g, "_");
      if (warpedIn.has(id)) problems.push({ file, path: `${where}.id`, message: `${id} is warped in twice` });
      else if (warpNamed.has(name)) problems.push({ file, path: `${where}.id`, message: `${id} and ${warpNamed.get(name)} would name one unit group in the triggers; rename one` });
      warpedIn.add(id);
      if (!warpNamed.has(name)) warpNamed.set(name, id);
      if (!techUnit(catalog, unitType)) problems.push({ file, path: `${where}.unitType`, message: `${unitType} isn't a unit the Catalog has (data/tech-catalog.json${layerSource(catalog)})` });
      place(at, `${where}.at`);
    }
    if (warp.kind === "build") {
      const { warpIn, unit, unitType, ability, at } = warp.action;
      // The game's own build abilities, whose first command (the one a build gives) builds this.
      const first = STOCK_FIRST_BUILDS[ability];
      if (first !== undefined && first !== unitType) problems.push({ file, path: `${where}.ability`, message: `${ability}'s first command builds a ${first}, not a ${unitType}; a build gives only its ability's first command` });
      const atMs = warp.action.atMs ?? 0;
      if (warpIn !== undefined && !warpedIn.has(warpIn)) {
        const later = warps.some((other) => other.kind === "warpIn" && other.action.id === warpIn);
        problems.push({ file, path: `${where}.warpIn`, message: later ? `${warpIn} warps in after this build; build once it's in` : `No warp-in ${warpIn} in the scene` });
      } else if (warpIn !== undefined) {
        const gone = warpInsOut.get(warpIn);
        if (gone && (warp.index > gone.index || (warp.index === gone.index && atMs > gone.atMs))) problems.push({ file, path: `${where}.warpIn`, message: `${warpIn} has warped out by then (${gone.where})` });
      }
      const by = warpIn !== undefined ? `warpIn:${warpIn}` : `unit:${unit}`;
      const before = building.get(by);
      if (before && before.index === warp.index && before.atMs === atMs)
        problems.push({ file, path: warpIn !== undefined ? `${where}.warpIn` : `${where}.unit`, message: `${warpIn ?? unit}'s builder is given a build at this moment already (${before.where}); give one later` });
      building.set(by, { index: warp.index, atMs, where });
      if (unit !== undefined) {
        // A unit Anchor, not a Kept unit, so the structure's player is known.
        const builder = blueprint.anchors.find((candidate) => candidate.id === unit && candidate.kind === "unit") as { player?: number } | undefined;
        if (builder) {
          if (builder.player === undefined) problems.push({ file, path: `${where}.unit`, message: `${unit} has no player, so the build can't know whose its structure is` });
          // The build waits on its builder, which a Wave's unit may not be yet.
          if (isWaveUnit(blueprint, unit)) problems.push({ file, path: `${where}.unit`, message: `${unit} is a Wave's unit, which isn't there until its send creates it; build with a unit that is there from the start, or a warp-in` });
          goneBy(unit, warp.index, atMs, `${where}.unit`);
          if (paused.has(unit)) problems.push({ file, path: `${where}.unit`, message: `${unit} is paused for the scene (live), so it can't build` });
          // A withdrawal given at the same moment as the build, or before, takes the builder away.
          const left = withdrewAt.get(unit);
          if (left && (warp.index > left.index || (warp.index === left.index && atMs >= left.atMs))) problems.push({ file, path: `${where}.unit`, message: `${unit} has withdrawn by then (${left.where})` });
        }
        else if (keptReference(blueprint, unit, "unit") !== undefined) problems.push({ file, path: `${where}.unit`, message: `${unit} is a Kept unit, whose player the build can't know; build with a unit Anchor` });
        else anchor(unit, "unit", `${where}.unit`);
      }
      const structure = techUnit(catalog, unitType);
      if (!structure) problems.push({ file, path: `${where}.unitType`, message: `${unitType} isn't a unit the Catalog has (data/tech-catalog.json${layerSource(catalog)})` });
      else if (!structure.structure) problems.push({ file, path: `${where}.unitType`, message: `${unitType} isn't a structure` });
      place(at, `${where}.at`);
    }
  }
  return problems;
}

/**
 * A timed scene's orders, warp-ins, builds, warp-outs, actor events and unit changes given `atMs` at or past their shot's end:
 * each runs on its own thread, so one would overtake the next shot's, or come after the Cleanup and
 * never be given.
 */
export function triggerSceneTimingProblems(timed: TimedTriggerScene): CinematicProblem[] {
  return castSpeakerTimingProblems(timed).concat(timed.triggerScene.shots.flatMap((shot, index) =>
    (shot.orders ?? []).flatMap((order, at) => {
      const { durationMs } = timed.shots[index]!;
      if (!order.atMs || order.atMs < durationMs) return [];
      return [{ file: timed.file, path: `shots.${index}.orders.${at}.atMs`, message: `${order.atMs} ms into the shot is at or past its end, at ${Math.round(durationMs)} ms; give the order in the shot it falls in` }];
    }),
  ).concat(
    warpsInTime(timed.triggerScene).flatMap((warp) => {
      const { durationMs } = timed.shots[warp.index]!;
      const { atMs } = warp.action;
      if (!atMs || atMs < durationMs) return [];
      return [{ file: timed.file, path: `${warpPath(warp)}.atMs`, message: `${atMs} ms into the shot is at or past its end, at ${Math.round(durationMs)} ms; give it in the shot it falls in` }];
    }),
    timed.triggerScene.shots.flatMap((shot, index) =>
      (shot.actorEvents ?? []).flatMap((event, at) => {
        const { durationMs } = timed.shots[index]!;
        if (!event.atMs || event.atMs < durationMs) return [];
        return [{ file: timed.file, path: `shots.${index}.actorEvents.${at}.atMs`, message: `${event.atMs} ms into the shot is at or past its end, at ${Math.round(durationMs)} ms; give it in the shot it falls in` }];
      }),
    ),
    timed.triggerScene.shots.flatMap((shot, index) =>
      (shot.unitChanges ?? []).flatMap((change, at) => {
        const { durationMs } = timed.shots[index]!;
        if (!change.atMs || change.atMs < durationMs) return [];
        return [{ file: timed.file, path: `shots.${index}.unitChanges.${at}.atMs`, message: `${change.atMs} ms into the shot is at or past its end, at ${Math.round(durationMs)} ms; give it in the shot it falls in` }];
      }),
    ),
  ));
}

/**
 * Each staged group's first withdrawal, by cast id, as the orders are given: from that moment its
 * units may be gone (each is removed on arriving, which may be at once), so nothing after it may
 * use them. An actor event at a moment after it is too late, and a line in its shot or after,
 * since the shot's lines play while its units walk.
 */
function castWithdrawals(triggerScene: TriggerScene): Map<string, { readonly index: number; readonly atMs: number; readonly where: string }> {
  const withdrew = new Map<string, { readonly index: number; readonly atMs: number; readonly where: string }>();
  for (const { order, index, at } of ordersInTime(triggerScene)) {
    if (order.withdraw && order.cast !== undefined && !withdrew.has(order.cast)) withdrew.set(order.cast, { index, atMs: order.atMs ?? 0, where: `shots.${index}.orders.${at}` });
  }
  return withdrew;
}

/**
 * A staged speaker's first line in or after the shot whose order withdraws its cast group
 * (castWithdrawals): the unit is removed on arriving, so the line could play from no unit.
 */
function castSpeakerTimingProblems(timed: TimedTriggerScene): CinematicProblem[] {
  const speakers = timed.triggerScene.speakers ?? {};
  const withdrew = castWithdrawals(timed.triggerScene);
  const problems: CinematicProblem[] = [];
  const reported = new Set<string>();
  timed.shots.forEach(({ lines }, index) => {
    for (const line of lines) {
      const castId = bySpeaker(speakers, line.speaker);
      const gone = castId === undefined ? undefined : withdrew.get(castId);
      if (!gone || index < gone.index) continue;
      const speaker = Object.keys(speakers).find((name) => speakerKey(name) === speakerKey(line.speaker))!;
      if (reported.has(speaker)) continue;
      reported.add(speaker);
      problems.push({
        file: timed.file,
        path: `speakers.${speaker}`,
        message: `${castId} withdraws in shot ${gone.index + 1} (${gone.where}), so it can't speak ${line.soundId}, in shot ${index + 1}: it's removed on arriving, which may come while that shot's lines play`,
      });
    }
  });
  return problems;
}

/** A scene's orders in the order they're given: by shot, then by time into it, then as listed (exact once no atMs passes its shot's end). */
export function ordersInTime(triggerScene: TriggerScene): { readonly order: TriggerSceneOrder; readonly index: number; readonly at: number }[] {
  return triggerScene.shots
    .flatMap((shot, index) => (shot.orders ?? []).map((order, at) => ({ order, index, at })))
    .sort((a, b) => a.index - b.index || (a.order.atMs ?? 0) - (b.order.atMs ?? 0) || a.at - b.at);
}

/** A shot's warp-in, build or warp-out, where it is in the scene file. */
export type TriggerSceneWarp = (
  | { readonly kind: "warpIn"; readonly action: TriggerSceneWarpIn }
  | { readonly kind: "build"; readonly action: TriggerSceneBuild }
  | { readonly kind: "warpOut"; readonly action: TriggerSceneWarpOut }
) & { readonly index: number; readonly at: number };

const WARP_KINDS = ["warpIn", "build", "warpOut"] as const;
const warpKey = { warpIn: "warpIns", build: "builds", warpOut: "warpOuts" } as const;

/** The path of a warp in the scene file, such as `shots.1.builds.0`. */
export const warpPath = (warp: TriggerSceneWarp): string => `shots.${warp.index}.${warpKey[warp.kind]}.${warp.at}`;

/**
 * A scene's warp-ins, builds and warp-outs in the order they happen: by shot, then by time into it,
 * then warp-ins, builds and warp-outs (as the cut starts them), then as listed.
 */
export function warpsInTime(triggerScene: TriggerScene): TriggerSceneWarp[] {
  return triggerScene.shots
    .flatMap((shot, index) => [
      ...(shot.warpIns ?? []).map((action, at): TriggerSceneWarp => ({ kind: "warpIn", action, index, at })),
      ...(shot.builds ?? []).map((action, at): TriggerSceneWarp => ({ kind: "build", action, index, at })),
      ...(shot.warpOuts ?? []).map((action, at): TriggerSceneWarp => ({ kind: "warpOut", action, index, at })),
    ])
    .sort((a, b) => a.index - b.index || (a.action.atMs ?? 0) - (b.action.atMs ?? 0) || WARP_KINDS.indexOf(a.kind) - WARP_KINDS.indexOf(b.kind) || a.at - b.at);
}

/**
 * Each shot's lines and length. A shot with a line (and the first shot) carries the lines from its
 * own to the next shot with a line, as a Cinematic's shots do (cinematicTimeline), and a shot with
 * no line after the first carries none. Its length runs from its cut to the next shot's, the first
 * one's through the fade in (or the ease of a scene that opens with no fade). The lines from `handback.linesFrom` on are the scene's after its handback.
 */
export function timedTriggerScene(loaded: LoadedTriggerScene, all: readonly ScriptLine[], lengths: ReadonlyMap<string, number>): TimedTriggerScene {
  const { shots, handback } = loaded.triggerScene;
  const linesFrom = handback?.linesFrom === undefined ? -1 : all.findIndex((line) => line.soundId === handback.linesFrom);
  const lines = linesFrom < 0 ? all : all.slice(0, linesFrom);
  // Its first line starts once the fade in has ended, or, opening with no fade, the ease.
  const timeline = cinematicTimeline(shots, lines, lengths, openEaseMs(loaded.triggerScene) ?? TRIGGER_SCENE_TIMES.fadeInMs);
  const indexOf = (soundId: string): number => lines.findIndex((line) => line.soundId === soundId);
  let next = 0;
  return {
    ...loaded,
    shots: shots.map((shot, at) => {
      const carries = at === 0 || shot.line !== undefined;
      const later = shots.slice(at + 1).find((candidate) => candidate.line !== undefined);
      const end = carries ? (later ? indexOf(later.line!) : lines.length) : next;
      const carried = lines.slice(next, end);
      next = Math.max(next, end);
      return { lines: carried, durationMs: timeline.shots[at]!.durationMs };
    }),
    afterHandback: linesFrom < 0 ? [] : all.slice(linesFrom),
    contentMs: timeline.contentMs,
    cueStartsMs: (loaded.triggerScene.music?.cues ?? []).map((cue) => (cue.line === undefined ? (cue.atMs ?? 0) : (timeline.lines.find((placed) => placed.line.soundId === cue.line)?.startMs ?? 0))),
  };
}

/**
 * Every trigger scene of a Blueprint, checked and timed from the voice files in `audioDir`. Throws
 * with every problem when any can't be compiled.
 */
export async function compileTriggerScenes(
  blueprint: MissionBlueprint,
  blueprintPath: string,
  script: VoicedScript | undefined,
): Promise<readonly TimedTriggerScene[]> {
  if ((blueprint.screenplay.script?.triggerScenes ?? []).length === 0) return [];
  const { loaded, problems } = await loadTriggerScenes(blueprint, blueprintPath);
  const all = [...problems, ...(script ? loaded.flatMap((entry) => triggerSceneProblems(entry, blueprint, script.script)) : [])].filter(isCinematicError);
  if (all.length) throw new Error(`The trigger scenes can't be compiled: ${all.map(formatCinematicProblem).join("; ")}`);
  if (!script) return [];
  const timed = await Promise.all(
    loaded.map(async (entry) => {
      const lines = sceneLines(script.script, entry.scene) ?? [];
      return timedTriggerScene(entry, lines, await voicedLengthsMs(lines, script));
    }),
  );
  const late = timed.flatMap(triggerSceneTimingProblems);
  if (late.length) throw new Error(`The trigger scenes can't be compiled: ${late.map(formatCinematicProblem).join("; ")}`);
  const unbuilt = timed.flatMap(triggerSceneMusicChecks).filter(isCinematicError);
  if (unbuilt.length) throw new Error(`The trigger scenes can't be compiled: ${unbuilt.map(formatCinematicProblem).join("; ")}`);
  return timed;
}
