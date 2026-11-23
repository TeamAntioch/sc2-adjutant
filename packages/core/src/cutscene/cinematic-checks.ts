// The cinematography skill's checks that a Cinematic's timeline lets us compute (CHECKS.md,
// "Cinematic"; the numbers are measured on Blizzard's own cutscenes): F1 it
// ends, F3 nothing is cut off, C4 shot lengths, T4 its length, lines with no shot on screen, and
// shots held long past their lines. `check-workspace` runs them on each Cinematic it can write,
// timed by the voice files in the Screenplay's `audioDir`, else by the estimate. All but F1 are
// warnings or review items: a long scene is a question for the author, not a broken file.
//
// C11 (the share of lines whose camera leaves Medium) needs cameras tagged with their framing,
// which Sets don't carry yet, so it isn't checked.

import { type Cinematic, timedAnims } from "../domain/cinematic.js";
import type { ScriptLine } from "../script/name-script.js";
import { type CinematicProblem, cinematicTimeline, cueStarts, type LoadedCinematic, momentProblem, movesRoomMs, pathTimes, stepTimes } from "./cinematic.js";
import { BOOKENDS } from "./write-shot-cutscene.js";

/** CHECKS.md's cinematic tier numbers. */
export const CINEMATIC_NORMS = {
  /** T4: a story cinematic runs about a minute (Blizzard's median 61 s, p90 140 s); an insert about 15 s. */
  length: { story: { aboutMs: 60_000, warnMs: 140_000 }, insert: { aboutMs: 15_000, warnMs: 40_000 } },
  /** C4: shots run 1-12 s (Blizzard's p10-p90 1.5-9.3 s, 4% over 12 s), and a scene's median shot 3-7.3 s. */
  shot: { minMs: 1000, maxMs: 12_000 },
  medianShot: { minMs: 3000, maxMs: 7300 },
  /**
   * Ours: a shot holds at most this long after the lines it plays under end. Blizzard's conversation
   * rooms make each shot as long as its line (research §4.6); a beat after it is a pause, a longer
   * hold a shot with nothing in it.
   */
  holdAfterLinesMs: 2000,
} as const;

/** A Cinematic's timeline as the written file plays it: its shots, its lines, the fade out and the End Scene marker. */
export type CinematicTiming = {
  readonly shots: readonly { readonly startMs: number; readonly durationMs: number }[];
  readonly lines: readonly { readonly soundId: string; readonly startMs: number; readonly durationMs: number }[];
  /** When the fade in ends. */
  readonly fadeInMs: number;
  /** When the fade to black starts. */
  readonly fadeOutMs: number;
  /** Where the End Scene marker sits, which ends the file; absent when it has none. */
  readonly endSceneMs?: number;
};

/** The timing of a Cinematic with the generated bookends (write-shot-cutscene's BOOKENDS). */
export function cinematicTiming(cinematic: Cinematic, lines: readonly ScriptLine[], lengths: ReadonlyMap<string, number>): CinematicTiming {
  const timeline = cinematicTimeline(cinematic.shots, lines, lengths);
  return {
    shots: timeline.shots,
    lines: timeline.lines.map(({ line, startMs, durationMs }) => ({ soundId: line.soundId, startMs, durationMs })),
    fadeInMs: BOOKENDS.fadeInMs,
    fadeOutMs: timeline.contentMs,
    endSceneMs: timeline.contentMs + BOOKENDS.fadeOutMs + BOOKENDS.blackMs,
  };
}

type Found = Omit<CinematicProblem, "file">;

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/**
 * What the checks find in a timing. `kind` picks T4's norm; `estimated` says how many of how many
 * lines were timed by the estimate, for the length's report.
 */
export function timingProblems(timing: CinematicTiming, kind: "story" | "insert", estimated?: { readonly count: number; readonly of: number }): Found[] {
  const found: Found[] = [];
  const by = estimated?.count ? ` (${estimated.count} of ${estimated.of} lines timed by the estimate)` : "";

  // F1: it ends, after its last line. An error: WaitForCutsceneToEnd waits for the marker.
  const lineEnd = (line: CinematicTiming["lines"][number]): number => line.startMs + line.durationMs;
  const lastLine = timing.lines.reduce<CinematicTiming["lines"][number] | undefined>((last, line) => (!last || lineEnd(line) > lineEnd(last) ? line : last), undefined);
  if (timing.endSceneMs === undefined) found.push({ message: "F1: it has no End Scene marker, so WaitForCutsceneToEnd never returns" });
  else if (timing.endSceneMs <= 0) found.push({ message: "F1: its End Scene marker is at t=0, so it ends as it starts" });
  else if (lastLine && lineEnd(lastLine) > timing.endSceneMs) found.push({ message: `F1: its End Scene marker at ${seconds(timing.endSceneMs)} comes before its last line, ${lastLine.soundId}, ends at ${seconds(lineEnd(lastLine))}` });

  // F3: nothing runs on into the fade to black: no shot, and no line, which it would cut off.
  timing.shots.forEach(({ startMs, durationMs }, at) => {
    if (startMs + durationMs > timing.fadeOutMs) found.push({ path: `shots.${at}`, message: `F3: shot ${at} runs on to ${seconds(startMs + durationMs)}, past the fade to black at ${seconds(timing.fadeOutMs)}`, severity: "warning" });
  });
  for (const line of timing.lines) {
    if (lineEnd(line) > timing.fadeOutMs) found.push({ message: `F3: line ${line.soundId} runs to ${seconds(lineEnd(line))}, past the fade to black at ${seconds(timing.fadeOutMs)}, so it's cut off`, severity: "warning" });
  }

  // Lines with no shot on screen: one that starts under the fade in, or outside every shot.
  const lastShotEnd = Math.max(...timing.shots.map(({ startMs, durationMs }) => startMs + durationMs));
  for (const line of timing.lines) {
    const where =
      line.startMs < timing.fadeInMs ? "under the fade in" : line.startMs >= lastShotEnd ? "after the last shot" : !timing.shots.some(({ startMs, durationMs }) => line.startMs >= startMs && line.startMs < startMs + durationMs) ? "between shots" : undefined;
    if (where) found.push({ message: `Line ${line.soundId} starts at ${seconds(line.startMs)}, ${where}, with no shot on screen`, severity: "warning" });
  }

  // C4: each shot's length, and the scene's median shot when it cuts at all.
  const { shot, medianShot } = CINEMATIC_NORMS;
  timing.shots.forEach(({ durationMs }, at) => {
    const past = durationMs > shot.maxMs ? `over the ${shot.maxMs / 1000} s` : durationMs < shot.minMs ? `under the ${shot.minMs / 1000} s` : undefined;
    if (past) found.push({ path: `shots.${at}`, message: `C4: shot ${at} runs ${seconds(durationMs)}, ${past} a cinematic's shots keep to`, severity: "warning" });
  });
  if (timing.shots.length > 1) {
    const sorted = timing.shots.map(({ durationMs }) => durationMs).sort((a, b) => a - b);
    const middle = sorted.length / 2;
    const median = sorted.length % 2 ? sorted[Math.floor(middle)]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
    if (median < medianShot.minMs || median > medianShot.maxMs) found.push({ message: `C4: its median shot runs ${seconds(median)}, outside a cinematic's ${medianShot.minMs / 1000}-${medianShot.maxMs / 1000} s`, severity: "warning" });
  }

  // Shots held past their lines: the end of the last line that plays in each shot, to its end.
  timing.shots.forEach(({ startMs, durationMs }, at) => {
    const endMs = startMs + durationMs;
    const ends = timing.lines.filter((line) => line.startMs < endMs && lineEnd(line) > startMs).map(lineEnd);
    if (!ends.length) return;
    const holdMs = endMs - Math.max(...ends);
    if (holdMs > CINEMATIC_NORMS.holdAfterLinesMs) {
      found.push({ path: `shots.${at}`, message: `Shot ${at} holds ${seconds(holdMs)} after its lines end, over the ${CINEMATIC_NORMS.holdAfterLinesMs / 1000} s a shot is the line it plays under`, severity: "warning" });
    }
  });

  // T4: the played length, to the End Scene marker.
  const lengthMs = timing.endSceneMs ?? timing.fadeOutMs;
  const norm = CINEMATIC_NORMS.length[kind];
  const what = kind === "story" ? "a story cinematic" : "an insert";
  if (lengthMs > norm.warnMs) found.push({ message: `T4: it runs ${seconds(lengthMs)}, over the ${norm.warnMs / 1000} s warning for ${what} (about ${norm.aboutMs / 1000} s); review what could go${by}`, severity: "warning" });
  else if (lengthMs > norm.aboutMs) found.push({ message: `T4: it runs ${seconds(lengthMs)}, over the about ${norm.aboutMs / 1000} s of ${what}; review what could go${by}`, severity: "review" });
  return found;
}

/**
 * The checks on a Cinematic that can be written (cinematicProblems found nothing), timed by
 * `lengths`, of which `estimated` were estimated. A cut past the end of its line is only found
 * here, once the lines are timed; the timeline can't be built then, so it's the only check made.
 */
export function cinematicChecks(loaded: LoadedCinematic, lines: readonly ScriptLine[], lengths: ReadonlyMap<string, number>, estimated: readonly string[]): CinematicProblem[] {
  const { cinematic, file } = loaded;
  const tooFar = cinematic.shots.flatMap((shot, at) => {
    const lineMs = shot.line === undefined ? undefined : lengths.get(shot.line);
    if (shot.intoLineMs === undefined || lineMs === undefined || shot.intoLineMs < lineMs) return [];
    const timed = estimated.includes(shot.line!) ? "by the estimate" : "by its voice file";
    return [{ file, path: `shots.${at}.intoLineMs`, message: `It cuts ${shot.intoLineMs} ms into ${shot.line}, which runs ${lineMs} ms ${timed}, so the Cinematic won't compile until the line is longer or the cut earlier; its other timing checks wait for that`, severity: "warning" as const }];
  });
  if (tooFar.length) return tooFar;
  const timing = cinematicTiming(cinematic, lines, lengths);
  // A cast member's steps past its shot's end, or a timed anim that starts there: the writer
  // refuses them, once the shot is timed.
  const overrun = cinematic.shots.flatMap((shot, at) => {
    const { durationMs } = timing.shots[at]!;
    const fix = (path: string): string => (path.startsWith("moves") || path.includes(".steps") ? "steps shorter" : path.startsWith("anims") ? "anim earlier" : path === "shake" ? "shake shorter" : "time earlier");
    const late = (path: string, message: string) => ({ file, path: `shots.${at}.${path}`, message: `${message}, so the Cinematic won't compile until the shot is longer or the ${fix(path)}`, severity: "warning" as const });
    // The same timing the writer uses (stepTimes), so a warning here is a compile it would refuse.
    const stepsOverrun = (path: string, steps: readonly { afterMs?: number | undefined; ms?: number | undefined }[], what = "steps run", room = durationMs) => {
      const times = stepTimes(steps, durationMs, room);
      return "overrunMs" in times ? [late(path, `Its ${what} ${times.overrunMs} ms, to or past ${room > durationMs ? "the fade out's end" : "the shot's end"} at ${room} ms`)] : [];
    };
    // The last shot's moves may run on through the fade out (movesRoomMs).
    const moveRoom = movesRoomMs(at, cinematic.shots.length, durationMs);
    const moves = Object.entries(shot.moves ?? {}).flatMap(([id, steps]) => stepsOverrun(`moves.${id}`, steps, "steps run", moveRoom));
    const lights = (shot.lights ?? []).flatMap((light, index) => (light.steps ? stepsOverrun(`lights.${index}.steps`, light.steps) : []));
    const moments = (["enters", "exits"] as const).flatMap((key) =>
      Object.entries(shot[key] ?? {}).flatMap(([id, ms]) => {
        const problem = momentProblem(key, ms, durationMs, at === 0);
        return problem ? [late(`${key}.${id}`, `It ${problem.replace(" it ", ` ${id} `)}`)] : [];
      }),
    );
    const anims = Object.entries(shot.anims ?? {}).flatMap(([id, anim]) =>
      timedAnims(anim).flatMap(({ at, timed }) => ((timed.atMs ?? 0) >= durationMs ? [late(`anims.${id}${at}`, `Its anim starts ${timed.atMs ?? 0} ms in, at or past the shot's end at ${durationMs} ms`)] : [])),
    );
    // The camera's path keys and its shake, timed as the writer times them (pathTimes, stepTimes).
    const reached = pathTimes(shot.path ?? [], durationMs);
    const path = "late" in reached ? [late(`path.${reached.late}.atMs`, `Its camera reaches this key ${reached.why}`)] : [];
    const shake = shot.shake ? stepsOverrun("shake", [{ afterMs: shot.shake.atMs, ms: shot.shake.ms }], "shake runs") : [];
    return [...moves, ...lights, ...moments, ...anims, ...path, ...shake];
  });
  // A sound or look-at past the end, a sound that ends before it starts, or a look-at out of order:
  // the writer refuses them, once timed.
  const cues = cueStarts(cinematic, cinematicTimeline(cinematic.shots, lines, lengths)).problems.map(({ path, message, fix }) => ({ file, path, message: `${message}, so the Cinematic won't compile until ${fix} moves`, severity: "warning" as const }));
  return [...overrun, ...cues, ...timingProblems(timing, cinematic.kind ?? "story", { count: estimated.length, of: lines.length }).map((problem) => ({ file, ...problem }))];
}
