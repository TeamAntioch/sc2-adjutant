// Schedules (docs/adr/0006): when something in a Mission is in effect. Threats and changing
// Connections share them, so the checker can ask whether a ford floods while the low ground is
// dangerous, or whether a gate shuts while a patrol is out.

import { z } from "zod";

const id = z.string().min(1);
const seconds = z.number().nonnegative();
/** The Beats a Schedule is bounded by: from the start of `fromBeatId` (the first Beat when omitted) until `untilBeatId` starts (the end when omitted). */
const beatBounds = { fromBeatId: id.optional(), untilBeatId: id.optional() };

/**
 * When something is in effect:
 *
 * - `from-beat`: from a Beat onward, until another Beat when one is named.
 * - `cycle`: strikes on a cycle that starts at a Beat. Later `steps` change the interval and the
 *   active time from their Beats (the sun's longer days).
 * - `patrol`: during each pass of a patrol walking its Threat's route at `speed` cells a second,
 *   there and back, or round when the route ends where it starts. It needs a route footprint.
 * - `while`: while a Mechanic's state holds (a checkpoint reached, a switch held). The checker
 *   can't time it, so it counts as possibly in effect at any moment of its Beats. `mechanicId`
 *   defaults to the Mechanic that gives it.
 */
export const ScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("from-beat"), beatId: id, untilBeatId: id.optional() }).strict(),
  z
    .object({
      kind: z.literal("cycle"),
      ...beatBounds,
      /** From the start of `fromBeatId` (or the Mission) to the first strike. */
      firstSeconds: seconds,
      /** Omit for a one-off. */
      intervalSeconds: z.number().positive().optional(),
      /** How long each strike lasts; omit for an instant one. */
      activeSeconds: z.number().positive().optional(),
      /** From each step's Beat, the cycle's new interval and active time (omitted: unchanged). */
      steps: z
        .array(z.object({ fromBeatId: id, intervalSeconds: z.number().positive().optional(), activeSeconds: z.number().positive().optional() }).strict())
        .min(1)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("patrol"),
      ...beatBounds,
      /** The patrol's walking speed, in cells a second. */
      speed: z.number().positive(),
      /** How long it stands at each end of its route (or at its start, going round). */
      pauseSeconds: seconds.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("while"), ...beatBounds, mechanicId: id.optional(), state: z.string().min(1) }).strict(),
]);
export type Schedule = z.infer<typeof ScheduleSchema>;

/** Every Beat id a Schedule names, for checking they exist. */
export function scheduleBeatIds(schedule: Schedule): string[] {
  const ids =
    schedule.kind === "from-beat"
      ? [schedule.beatId, schedule.untilBeatId]
      : [schedule.fromBeatId, schedule.untilBeatId, ...(schedule.kind === "cycle" ? (schedule.steps ?? []).map((step) => step.fromBeatId) : [])];
  return ids.filter((beatId): beatId is string => beatId !== undefined);
}

/**
 * How a Connection is while its Schedule is in effect:
 *
 * - `closed`: impassable (a flooded ford, a shut gate); passable otherwise.
 * - `open`: passable; impassable otherwise (a gate that opens on each patrol pass, rocks cleared at a Beat).
 * - `one-way`: passable only from `fromZoneId` to `toZoneId` (a lift that only goes down).
 */
export const CONNECTION_STATES = ["open", "closed", "one-way"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

/**
 * A change a Mechanic makes to a Connection the Blueprint declares between two Zones, on a
 * Schedule. A Blueprint's `opensAtBeat` is an `open` change from that Beat, and `closesAtBeat` a
 * `closed` one.
 */
export const MechanicConnectionChangeSchema = z
  .object({
    fromZoneId: id,
    toZoneId: id,
    state: z.enum(CONNECTION_STATES),
    schedule: ScheduleSchema,
  })
  .strict();
export type MechanicConnectionChange = z.infer<typeof MechanicConnectionChangeSchema>;
