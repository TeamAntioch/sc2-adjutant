// Reading Schedules (docs/adr/0006) at the layout checker's grain, the Beat: when one can be in
// effect, when it surely is, and whether two can be in effect at once. Seconds within a Beat
// aren't tracked, so anything but a from-a-Beat Schedule is only possibly in effect.

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { type Schedule, scheduleBeatIds } from "../domain/schedule.js";

/** Beat indices `[from, until)` a Schedule can be in effect in; `until` is Infinity when it runs to the end. */
export type BeatRange = { readonly from: number; readonly until: number };

export function beatRange(beatIndex: ReadonlyMap<string, number>, schedule: Schedule): BeatRange {
  const at = (beatId: string | undefined, otherwise: number) => (beatId === undefined ? otherwise : (beatIndex.get(beatId) ?? otherwise));
  const from = schedule.kind === "from-beat" ? at(schedule.beatId, 0) : at(schedule.fromBeatId, 0);
  return { from, until: at(schedule.untilBeatId, Infinity) };
}

/** Whether the Schedule can be in effect at some moment of the Beat. */
export function mayBeActiveAt(beatIndex: ReadonlyMap<string, number>, schedule: Schedule, index: number): boolean {
  const range = beatRange(beatIndex, schedule);
  return index >= range.from && index < range.until;
}

/** Whether the Schedule is in effect for the whole Beat: only a from-a-Beat one can be. */
export function alwaysActiveAt(beatIndex: ReadonlyMap<string, number>, schedule: Schedule, index: number): boolean {
  return schedule.kind === "from-beat" && mayBeActiveAt(beatIndex, schedule, index);
}

/** Whether two ranges share a Beat. */
export function overlaps(a: BeatRange, b: BeatRange): boolean {
  return a.from < b.until && b.from < a.until;
}

/**
 * Problems with the ids a Schedule names: Beats that don't exist, a Schedule that ends at or
 * before the Beat it starts at, and a `while` Schedule's Mechanic. `ownMechanicId` is the Mechanic
 * giving it, which a `while` Schedule defaults to.
 */
export function scheduleProblems(blueprint: MissionBlueprint, schedule: Schedule, ownMechanicId?: string): string[] {
  const beatIds = new Set(blueprint.beats.map((beat) => beat.id));
  const problems = scheduleBeatIds(schedule)
    .filter((beatId) => !beatIds.has(beatId))
    .map((beatId) => `unknown beat id ${beatId}`);
  if (problems.length === 0) {
    // The Beats run in order: it ends after it starts, and each cycle step falls in between, after the last.
    const index = new Map(blueprint.beats.map((beat, at) => [beat.id, at]));
    const { from, until } = beatRange(index, schedule);
    if (until <= from) problems.push(`untilBeatId ${schedule.untilBeatId} doesn't come after the Beat it starts from`);
    let last = from;
    for (const step of schedule.kind === "cycle" ? (schedule.steps ?? []) : []) {
      const at = index.get(step.fromBeatId)!;
      if (at <= last || at >= until) problems.push(`step fromBeatId ${step.fromBeatId} must come after the cycle's start and each earlier step, and before its end`);
      last = Math.max(last, at);
    }
  }
  if (schedule.kind === "while") {
    const mechanicId = schedule.mechanicId ?? ownMechanicId;
    if (mechanicId === undefined) problems.push("a while Schedule needs a mechanicId");
    else if (!blueprint.mechanics.some((entry) => entry.id === mechanicId)) problems.push(`unknown mechanic id ${mechanicId}`);
  }
  return problems;
}

/** A Schedule in words, for findings: `from "Quake"`, `on a cycle`, `on each patrol pass`. */
export function describeSchedule(blueprint: MissionBlueprint, schedule: Schedule): string {
  const title = (beatId: string) => `"${blueprint.beats.find((beat) => beat.id === beatId)?.title ?? beatId}"`;
  const until = schedule.untilBeatId === undefined ? "" : ` until ${title(schedule.untilBeatId)}`;
  const from = schedule.kind !== "from-beat" && schedule.fromBeatId !== undefined ? ` from ${title(schedule.fromBeatId)}` : "";
  switch (schedule.kind) {
    case "from-beat":
      return `from ${title(schedule.beatId)}${until}`;
    case "cycle":
      return `${schedule.intervalSeconds === undefined ? "once" : "on a cycle"}${from}${until}`;
    case "patrol":
      return `on each patrol pass${from}${until}`;
    case "while":
      return `while ${schedule.mechanicId ?? "its Mechanic"} is ${schedule.state}${from}${until}`;
  }
}
