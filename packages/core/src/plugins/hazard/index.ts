// The generic `hazard` Mechanic, bundled with core as a first-party Plugin (ADR-0005): something
// that sweeps the affected zones on a cycle (lava, a storm) while the safe zones stay clear.
// Declared for the level-design checker (docs/adr/0004); it builds no triggers yet.

import { z } from "zod";

import { defineMechanic, type MechanicIssue, type PluginCode } from "../plugin-api.js";

const slugId = z.string().regex(/^[a-z][a-z0-9_-]*$/, "Use lowercase letters, numbers, hyphens, or underscores");

export const HazardParamsSchema = z
  .object({
    affectedZoneIds: z.array(slugId).min(1),
    safeZoneIds: z.array(slugId).min(1),
    firstSeconds: z.number().nonnegative(),
    /** Omit for a one-off surge. */
    intervalSeconds: z.number().positive().optional(),
    /** How long each surge stays deadly. */
    deadlySeconds: z.number().positive(),
    /** How long before each surge the player can tell it's coming (a countdown, a klaxon, a tremor). */
    warningSeconds: z.number().positive(),
  })
  .strict();

const hazard = defineMechanic({
  type: "hazard",
  paramsSchema: HazardParamsSchema,
  validate(params, context) {
    const zoneIds = new Set(context.zones.map((zone) => zone.id));
    const issues: MechanicIssue[] = [];
    for (const key of ["affectedZoneIds", "safeZoneIds"] as const) {
      params[key].forEach((zoneId, index) => {
        if (!zoneIds.has(zoneId)) issues.push({ message: `Unknown zone id: ${zoneId}`, path: [key, index] });
      });
    }
    const safe = new Set(params.safeZoneIds);
    params.affectedZoneIds.forEach((zoneId, index) => {
      if (safe.has(zoneId)) issues.push({ message: `A zone can't be both affected and safe: ${zoneId}`, path: ["affectedZoneIds", index] });
    });
    return issues;
  },
  buildTriggers: () => [],
  threats: (params) => [
    {
      footprint: { zoneIds: params.affectedZoneIds },
      schedule: {
        kind: "cycle",
        firstSeconds: params.firstSeconds,
        ...(params.intervalSeconds !== undefined ? { intervalSeconds: params.intervalSeconds } : {}),
        activeSeconds: params.deadlySeconds,
      },
      telegraph: { warningSeconds: params.warningSeconds, description: "declared" },
      safety: { zoneIds: params.safeZoneIds },
      consequence: "damage",
    },
  ],
});

const plugin: PluginCode = { mechanics: [hazard] };
export default plugin;
