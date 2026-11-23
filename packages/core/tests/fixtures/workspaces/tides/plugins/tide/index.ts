// A test Plugin Mechanic for Connection changes: a tide that floods a ford and the low ground on
// one Schedule. It builds no triggers; it gives the checker a Threat and a Connection change.
import { z } from "zod";

import { defineMechanic, type PluginCode, type Schedule } from "@team-antioch/sc2-adjutant/plugin-sdk";

const crossing = z.object({ fromZoneId: z.string().min(1), toZoneId: z.string().min(1) }).strict();

const TideParamsSchema = z
  .object({
    ford: crossing,
    /** More crossings the same tide floods. */
    alsoFloods: z.array(crossing).default([]),
    lowZoneIds: z.array(z.string().min(1)).min(1),
    safeZoneIds: z.array(z.string().min(1)),
    firstSeconds: z.number().nonnegative(),
    everySeconds: z.number().positive(),
    floodSeconds: z.number().positive(),
    warningSeconds: z.number().positive(),
    /** Floods on this Schedule instead of the cycle, so tests can try every kind; core validates it. */
    schedule: z.custom<Schedule>().optional(),
  })
  .strict();
type TideParams = z.infer<typeof TideParamsSchema>;

const flood = (params: TideParams): Schedule =>
  params.schedule ?? { kind: "cycle", firstSeconds: params.firstSeconds, intervalSeconds: params.everySeconds, activeSeconds: params.floodSeconds };

const plugin: PluginCode = {
  mechanics: [
    defineMechanic({
      type: "tide",
      paramsSchema: TideParamsSchema,
      buildTriggers: () => [],
      threats: (params) => [
        {
          footprint: { zoneIds: params.lowZoneIds },
          schedule: flood(params),
          telegraph: { warningSeconds: params.warningSeconds, description: "the water starts to rise" },
          safety: { zoneIds: params.safeZoneIds },
          consequence: "damage",
        },
      ],
      connectionChanges: (params) => [params.ford, ...params.alsoFloods].map((ford) => ({ ...ford, state: "closed" as const, schedule: flood(params) })),
    }),
  ],
};

export default plugin;
