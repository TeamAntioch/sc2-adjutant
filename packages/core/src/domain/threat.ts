// Threats and Schedules (docs/adr/0006): one safety concept for enemy groups, Waves and Mechanics,
// which the layout checker's safety checks read whatever the source.

import { z } from "zod";

import { ScheduleSchema } from "./schedule.js";

export { type Schedule, ScheduleSchema } from "./schedule.js";

/** A Threat's telegraph when a countdown to it is always on screen, so the whole wait is warning. */
export const COUNTDOWN_TELEGRAPH = "the countdown is always on screen";

/** What happens when a Threat catches the player. A closed set: a Plugin can't add one until a check needs it. */
export const THREAT_CONSEQUENCES = ["damage", "combat", "setback", "fail"] as const;
export type ThreatConsequence = (typeof THREAT_CONSEQUENCES)[number];

const id = z.string().min(1);
const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();

/**
 * Where a Threat reaches: whole Zones, or a route plus a radius (a patrol and its sight). A route
 * that ends where it starts is walked round; any other is walked there and back.
 */
export const FootprintSchema = z.union([
  z.object({ zoneIds: z.array(id).min(1) }).strict(),
  z.object({ route: z.array(point).min(2), radius: z.number().positive() }).strict(),
]);
export type Footprint = z.infer<typeof FootprintSchema>;

/**
 * A Threat as a Mechanic's `threats` hook gives it; core names it after the Mechanic entry.
 *
 * - `footprint`: the Zones it reaches, or a route and a radius.
 * - `schedule`: when it is active. A `patrol` Schedule walks the route footprint.
 * - `telegraph`: how it warns the player, and for how long before each strike when it does.
 * - `safety`: the Zones that are safe from it (shelters; for a `setback`, the checkpoints it sends
 *   the player back to), and how fast the threatened unit moves when it isn't a marine.
 * - `anchorId`: the one unit it is after (a hero), when it threatens that unit rather than
 *   whatever stands in its footprint. A `fail` Threat's unit is critical: the safety checks treat
 *   it as they treat a unit whose death is a defeat condition.
 */
export const MechanicThreatSchema = z
  .object({
    anchorId: id.optional(),
    footprint: FootprintSchema,
    schedule: ScheduleSchema,
    telegraph: z.object({ warningSeconds: z.number().positive().optional(), description: z.string().min(1) }).strict(),
    safety: z.object({ zoneIds: z.array(id).readonly(), retreatSpeed: z.number().positive().optional() }).strict(),
    consequence: z.enum(THREAT_CONSEQUENCES),
  })
  .strict()
  .refine((threat) => threat.schedule.kind !== "patrol" || "route" in threat.footprint, {
    message: "A patrol Schedule walks a route: give the footprint a route and a radius",
    path: ["schedule"],
  });
export type MechanicThreat = z.infer<typeof MechanicThreatSchema>;

/** A Threat in the layout model: what it is and where it came from. */
export type Threat = MechanicThreat & {
  readonly source: { readonly kind: "encounter" | "enemy group" | "wave" | "Mechanic"; readonly id: string };
};
