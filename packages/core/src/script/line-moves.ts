// Follows a Screenplay's lines and scenes from one pull to the next, by comparing the copy before
// and after: a Screenplay Source may number lines by their place (some do), so a cut or
// an insert renumbers the lines after it. The pull checks the Blueprint's line cues with it, and
// the refresh moves what names a line or scene (refresh-screenplay.ts).

import { type Script, type ScriptLine, type ScriptScene, scriptLines } from "./name-script.js";

/** One line followed from its old sound ID to its new one. */
export type LineMove = { readonly from: string; readonly to: string };

export type LineMoves = {
  /** Lines whose speaker and text are unchanged, under a new sound ID. */
  readonly moved: readonly LineMove[];
  /**
   * Lines whose text or speaker changed, found as the one line between the same two unchanged
   * neighbours before and after; `from` and `to` may be the same.
   */
  readonly changed: readonly LineMove[];
  /** Old sound IDs of lines that are gone: cut, or changed where they can't be told from a cut. */
  readonly gone: readonly string[];
};

const keyOf = (line: ScriptLine): string => `${line.speaker}\u0000${line.text}`;

/**
 * Follows every line of `before` into `after`. A line is the same line when its speaker and text
 * (mood tags aside) are; lines with the same speaker and text pair in order. A run of one unpaired
 * line between two paired neighbours, facing a run of one unpaired line between the same
 * neighbours in `after`, is that line changed. Every other unpaired line is gone.
 */
export function lineMoves(before: Script, after: Script): LineMoves {
  const old = scriptLines(before);
  const next = scriptLines(after);
  const waiting = new Map<string, number[]>();
  next.forEach((line, at) => {
    const key = keyOf(line);
    waiting.set(key, [...(waiting.get(key) ?? []), at]);
  });
  // Where each old line went in `after`, by index; undefined when unpaired.
  const pairedTo: (number | undefined)[] = old.map((line) => waiting.get(keyOf(line))?.shift());
  const taken = new Set(pairedTo.filter((at): at is number => at !== undefined));

  const moved: LineMove[] = [];
  const changed: LineMove[] = [];
  const gone: string[] = [];
  old.forEach((line, at) => {
    const to = pairedTo[at];
    if (to !== undefined) {
      if (next[to]!.soundId !== line.soundId) moved.push({ from: line.soundId, to: next[to]!.soundId });
      return;
    }
    const match = changedLine(at, pairedTo, taken, next.length);
    if (match === undefined) gone.push(line.soundId);
    else changed.push({ from: line.soundId, to: next[match]!.soundId });
  });
  return { moved, changed, gone };
}

/**
 * The one unpaired line of `after` facing the unpaired old line `at`, when `at` is alone between
 * its paired neighbours and so is that line between theirs.
 */
function changedLine(at: number, pairedTo: readonly (number | undefined)[], taken: ReadonlySet<number>, nextLength: number): number | undefined {
  if (pairedTo[at - 1] === undefined && at > 0) return undefined;
  if (pairedTo[at + 1] === undefined && at + 1 < pairedTo.length) return undefined;
  const start = at === 0 ? -1 : pairedTo[at - 1]!;
  const end = at + 1 === pairedTo.length ? nextLength : pairedTo[at + 1]!;
  const between = [];
  for (let index = start + 1; index < end; index++) between.push(index);
  if (between.length !== 1 || taken.has(between[0]!)) return undefined;
  return between[0];
}

/** One scene followed from its old number to its new one. */
export type SceneMove = { readonly from: number; readonly to: number };

export type SceneMoves = {
  /** Scenes under a new number, such as those after a scene inserted before them. */
  readonly moved: readonly SceneMove[];
  /**
   * Old scenes that can't be followed: their lines went to several scenes, or there's no line or
   * heading to follow them by. From `refreshScreenplay`, only those the Blueprint names.
   */
  readonly unsure: readonly number[];
};

/**
 * Follows every scene of `before` into `after`, by its lines: a scene whose lines (moved, changed
 * or unchanged) all landed in one scene is that scene. A scene with no line to follow is followed
 * by its heading, when one unclaimed scene of `after` has the same one. A scene whose lines are all
 * gone, or split across scenes, is unsure.
 */
export function sceneMoves(before: Script, after: Script, moves: LineMoves): SceneMoves {
  const newId = new Map([...moves.moved, ...moves.changed].map((move) => [move.from, move.to]));
  const gone = new Set(moves.gone);
  const sceneOf = new Map(after.scenes.flatMap((scene) => scene.items.filter((item) => item.kind === "line").map((line) => [(line as ScriptLine).soundId, scene.number] as const)));
  const followed = new Map<number, number>();
  const byHeading: ScriptScene[] = [];
  const unsure: number[] = [];
  for (const scene of before.scenes) {
    const lines = scene.items.filter((item): item is ScriptLine => item.kind === "line" && !gone.has(item.soundId));
    const targets = new Set(lines.map((line) => sceneOf.get(newId.get(line.soundId) ?? line.soundId)).filter((to): to is number => to !== undefined));
    if (targets.size === 1) followed.set(scene.number, [...targets][0]!);
    else if (targets.size === 0) byHeading.push(scene);
    else unsure.push(scene.number);
  }
  const claimed = new Set(followed.values());
  for (const scene of byHeading) {
    const same = after.scenes.filter((candidate) => candidate.title === scene.title && !claimed.has(candidate.number));
    if (same.length === 1) {
      followed.set(scene.number, same[0]!.number);
      claimed.add(same[0]!.number);
    } else unsure.push(scene.number);
  }
  const moved = [...followed].filter(([from, to]) => from !== to).map(([from, to]) => ({ from, to }));
  return { moved, unsure: unsure.sort((a, b) => a - b) };
}
