// A test Plugin Mechanic: a periodic blast the hero must shelter from, with a countdown always on
// screen. It builds no triggers; it gives the checker a traversal Threat that fails the Mission,
// over every zone the hero can walk to except its shelters.
import { z } from "zod";

import { defineMechanic, type PluginCode } from "@team-antioch/sc2-adjutant/plugin-sdk";

const CountdownParamsSchema = z
  .object({
    heroAnchorId: z.string().min(1),
    shelterZoneIds: z.array(z.string().min(1)).min(1),
    firstSeconds: z.number().positive(),
    intervalSeconds: z.number().positive(),
  })
  .strict();

const plugin: PluginCode = {
  mechanics: [
    defineMechanic({
      type: "countdown",
      paramsSchema: CountdownParamsSchema,
      buildTriggers: () => [],
      threats: (params, context) => {
        const hero = context.anchors.find((anchor) => anchor.id === params.heroAnchorId);
        if (!hero) return [];
        const shelters = new Set(params.shelterZoneIds);
        const footprint = [...context.walkableFrom(hero.zoneId)].filter((zoneId) => !shelters.has(zoneId));
        if (footprint.length === 0) return [];
        return [
          {
            anchorId: hero.id,
            footprint: { zoneIds: footprint },
            schedule: { kind: "cycle", firstSeconds: params.firstSeconds, intervalSeconds: params.intervalSeconds },
            telegraph: { warningSeconds: Math.min(params.firstSeconds, params.intervalSeconds), description: "the countdown is always on screen" },
            safety: { zoneIds: params.shelterZoneIds },
            consequence: "fail",
          },
        ];
      },
    }),
  ],
};
export default plugin;
