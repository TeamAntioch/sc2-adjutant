// A test Plugin Mechanic modelled on a stealth mission's patrols (ADR 0006): a guard walks a route,
// and a player it sees is sent back to a checkpoint. It builds no triggers; it gives the checker a
// setback Threat with a route footprint on a patrol Schedule.
import { z } from "zod";

import { defineMechanic, type PluginCode } from "@team-antioch/sc2-adjutant/plugin-sdk";

const point = z.object({ x: z.number(), y: z.number() }).strict();

const PatrolParamsSchema = z
  .object({
    route: z.array(point).min(2),
    sightRadius: z.number().positive(),
    speed: z.number().positive(),
    pauseSeconds: z.number().nonnegative().optional(),
    checkpointZoneId: z.string().min(1).optional(),
  })
  .strict();

const plugin: PluginCode = {
  mechanics: [
    defineMechanic({
      type: "patrol",
      paramsSchema: PatrolParamsSchema,
      buildTriggers: () => [],
      threats: (params) => [
        {
          footprint: { route: params.route, radius: params.sightRadius },
          schedule: { kind: "patrol", speed: params.speed, ...(params.pauseSeconds !== undefined ? { pauseSeconds: params.pauseSeconds } : {}) },
          telegraph: { description: "the guard is in plain sight" },
          safety: { zoneIds: params.checkpointZoneId === undefined ? [] : [params.checkpointZoneId] },
          consequence: "setback",
        },
      ],
    }),
  ],
};

export default plugin;
