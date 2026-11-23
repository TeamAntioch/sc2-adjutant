// Refreshes a Mission's Screenplay after an edit at its Screenplay Source, and finds what the edit
// did to its sound IDs by comparing the pulled copy before and after the pull. A Screenplay Source may number lines by their place (some do), so a cut or an
// insert renumbers the lines after it, and a shot that cuts on `…-007` would then cut on another
// line with no error. `lineMoves` follows each line to its new sound ID, and `repointCinematics`
// moves the Blueprint's Cinematics' shots with their lines. A scene inserted before others
// renumbers them too, and the Blueprint names scenes by number (its cues, its Cinematics, a Wave
// warning's Transmission): `sceneMoves` follows each scene and `repointScenes` moves those numbers.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

import { cinematicPath } from "../cutscene/cinematic.js";
import { blueprintCues, type MissionBlueprint } from "../domain/mission-blueprint.js";
import { NO_CHARACTERS } from "../mods/characters.js";
import { type LineMove, type LineMoves, lineMoves, type SceneMove, type SceneMoves, sceneMoves } from "./line-moves.js";
import { readMissionScript } from "./name-script.js";
import { type MissionInWorkspace, pullScreenplay, type PullResult } from "./screenplay-source.js";

export { type LineMove, type LineMoves, lineMoves, type SceneMove, type SceneMoves, sceneMoves };

/** The script scenes the Blueprint names by number: its cues', its Cinematics' and its Wave warnings'. */
export function sceneReferences(blueprint: MissionBlueprint): ReadonlySet<number> {
  const script = blueprint.screenplay.script;
  return new Set([
    ...(script?.cues ?? []).map((cue) => cue.scene),
    ...(script?.cinematics ?? []).map((cinematic) => cinematic.scene),
    ...blueprint.waves.flatMap((wave) => (typeof wave.warning?.transmission === "number" ? [wave.warning.transmission] : [])),
  ]);
}

/** A Blueprint value that names a script scene by number. */
const SCENE_NUMBER = /("(?:scene|transmission)"\s*:\s*)(\d+)/g;

/**
 * Moves the Blueprint's references to script scenes by number with their scenes: its cues'
 * and Cinematics' `scene`, and a Wave warning's `transmission` when it's a scene number. Only those
 * numbers are rewritten, all at once, so the file keeps its layout and a chain (6 → 7, 7 → 8) can't
 * apply twice. Returns the moves it made.
 */
export async function repointScenes(blueprintPath: string, scenes: SceneMoves): Promise<readonly SceneMove[]> {
  if (!scenes.moved.length) return [];
  const to = new Map(scenes.moved.map((move) => [move.from, move.to]));
  const text = await readFile(blueprintPath, "utf8");
  const made = new Map<number, number>();
  const next = text.replace(SCENE_NUMBER, (whole, key: string, value: string) => {
    const number = Number(value);
    const moved = to.get(number);
    if (moved === undefined) return whole;
    made.set(number, moved);
    return `${key}${moved}`;
  });
  if (next !== text) await writeFile(blueprintPath, next);
  return [...made].map(([from, moved]) => ({ from, to: moved }));
}

/**
 * Moves the Blueprint's line cues with their lines: a script cue's `line`, and a scenePlayed cue's,
 * on a moved or changed line takes its new sound ID. Only those `"line"` values are rewritten, all
 * at once, so the file keeps its layout and a chain of renumberings can't apply twice. A cue on a
 * gone line is refused by the pull before this. Returns the moves it made.
 */
export async function repointCueLines(blueprint: MissionBlueprint, blueprintPath: string, moves: LineMoves): Promise<readonly LineMove[]> {
  const cued = new Set(
    [...(blueprint.screenplay.script?.cues ?? []), ...blueprintCues(blueprint).map(({ cue }) => cue)].flatMap((named) => ("line" in named && named.line !== undefined ? [named.line] : [])),
  );
  const newId = new Map([...moves.moved, ...moves.changed].filter((move) => move.from !== move.to && cued.has(move.from)).map((move) => [move.from, move.to]));
  if (!newId.size) return [];
  const text = await readFile(blueprintPath, "utf8");
  const made = new Map<string, string>();
  // A Blueprint's only `"line"` values are its cues' (inline scenes' are `lines`).
  const next = text.replace(/("line"\s*:\s*")((?:[^"\\]|\\.)*)(")/g, (whole, open: string, value: string, close: string) => {
    const to = newId.get(value);
    if (to === undefined) return whole;
    made.set(value, to);
    return `${open}${to}${close}`;
  });
  if (next !== text) await writeFile(blueprintPath, next);
  return [...made].map(([from, to]) => ({ from, to }));
}

/** What `repointCinematics` did to one Cinematic. */
export type RepointedCinematic = {
  readonly id: string;
  /** Absolute. */
  readonly file: string;
  /** Shots moved to their line's new sound ID, by their index in `shots`. */
  readonly repointed: readonly ({ readonly shot: number } & LineMove)[];
  /** Shots whose line is gone, left as they were: each needs a line chosen again. */
  readonly orphaned: readonly { readonly shot: number; readonly line: string }[];
};

/**
 * Moves each of the Blueprint's Cinematics' shots with its line: a shot on a moved or changed line
 * cuts on its new sound ID, and one on a gone line is reported. Only the shots' `line` values are
 * rewritten, so the file keeps its layout. A Cinematic file that's missing or isn't JSON with
 * shots is skipped; the check reports it.
 */
export async function repointCinematics(blueprint: MissionBlueprint, blueprintPath: string, moves: LineMoves): Promise<RepointedCinematic[]> {
  const newId = new Map([...moves.moved, ...moves.changed].map((move) => [move.from, move.to]));
  const gone = new Set(moves.gone);
  const results: RepointedCinematic[] = [];
  for (const { id } of blueprint.screenplay.script?.cinematics ?? []) {
    const file = cinematicPath(blueprintPath, id);
    if (!existsSync(file)) continue;
    const text = await readFile(file, "utf8");
    let shots: unknown;
    try {
      shots = (JSON.parse(text) as { shots?: unknown }).shots;
    } catch {
      continue;
    }
    if (!Array.isArray(shots)) continue;
    const repointed: RepointedCinematic["repointed"][number][] = [];
    const orphaned: RepointedCinematic["orphaned"][number][] = [];
    shots.forEach((shot: unknown, index) => {
      const line = typeof shot === "object" && shot !== null && "line" in shot ? shot.line : undefined;
      if (typeof line !== "string") return;
      const to = newId.get(line);
      if (to !== undefined) repointed.push({ shot: index, from: line, to });
      else if (gone.has(line)) orphaned.push({ shot: index, line });
    });
    if (repointed.length) {
      // Every `"line": "<id>"` is a shot's (no other part of a Cinematic has a `line`), and each is
      // replaced at once, so a chain of renumberings (007 → 006, 008 → 007) can't apply twice.
      await writeFile(file, text.replace(/("line"\s*:\s*")((?:[^"\\]|\\.)*)(")/g, (whole, open: string, value: string, close: string) => (newId.has(value) ? `${open}${newId.get(value)}${close}` : whole)));
    }
    results.push({ id, file, repointed, orphaned });
  }
  return results;
}

export type RefreshResult = {
  readonly pull: PullResult;
  /** What the pull did to the sound IDs; undefined when there was no readable copy before it. */
  readonly moves?: LineMoves;
  /** What the pull did to the scene numbers, and the Blueprint's scene references it moved. */
  readonly scenes?: SceneMoves & { readonly repointed: readonly SceneMove[] };
  readonly cinematics: readonly RepointedCinematic[];
  /** The Blueprint's line cues moved with their lines (repointCueLines). */
  readonly cueLines: readonly LineMove[];
  /** The pulled Screenplay's voice files' folder, absolute. */
  readonly audioDir: string;
};

/**
 * Pulls the Blueprint's Screenplay, follows its lines from the copy it replaced, and moves the
 * Blueprint's Cinematics' shots and line cues with them. A copy that is missing or can't be read
 * before the pull is nothing to follow from: the pull goes ahead and nothing is moved. Lines are followed by their
 * speaker and text, not their characters, so a speaker the Campaign Mod doesn't declare yet is
 * pulled and followed; voicing and compiling the Screenplay (readMissionScript) ask for it.
 */
export async function refreshScreenplay(mission: MissionInWorkspace, blueprintPath: string): Promise<RefreshResult> {
  const { blueprint, workspace } = mission;
  const before = await readMissionScript(blueprint, blueprintPath, workspace, NO_CHARACTERS).catch(() => undefined);
  const pull = await pullScreenplay(mission, blueprintPath, { followLines: true });
  const after = (await readMissionScript(blueprint, blueprintPath, workspace, NO_CHARACTERS))!;
  if (!before) return { pull, cinematics: [], cueLines: [], audioDir: after.audioDir };
  const moves = lineMoves(before.script, after.script);
  const followed = sceneMoves(before.script, after.script, moves);
  // Only a scene the Blueprint names matters when it can't be followed.
  const named = sceneReferences(blueprint);
  const scenes = { ...followed, unsure: followed.unsure.filter((scene) => named.has(scene)) };
  const repointed = await repointScenes(blueprintPath, scenes);
  const cueLines = await repointCueLines(blueprint, blueprintPath, moves);
  return { pull, moves, scenes: { ...scenes, repointed }, cinematics: await repointCinematics(blueprint, blueprintPath, moves), cueLines, audioDir: after.audioDir };
}
