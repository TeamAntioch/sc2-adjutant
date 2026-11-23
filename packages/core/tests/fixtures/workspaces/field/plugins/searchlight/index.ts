// A test Plugin Mechanic that only adds a Threat: a searchlight that sweeps a zone on a cycle and
// sends a player it catches back to a checkpoint. The field Workspace doesn't list it; tests that
// need it name it in a copy's config.
import { z } from "zod";

import { defineMechanic, type PluginCode } from "../../../../../../src/plugins/plugin-api.js";

const SearchlightParamsSchema = z
  .object({ sweepsZoneId: z.string().min(1), checkpointZoneId: z.string().min(1).optional(), everySeconds: z.number().positive(), warningSeconds: z.number().positive() })
  .strict();

const plugin: PluginCode = {
  mechanics: [
    defineMechanic({
      type: "searchlight",
      paramsSchema: SearchlightParamsSchema,
      buildTriggers: () => [],
      threats: (params) => [
        {
          footprint: { zoneIds: [params.sweepsZoneId] },
          schedule: { kind: "cycle", firstSeconds: params.everySeconds, intervalSeconds: params.everySeconds },
          telegraph: { warningSeconds: params.warningSeconds, description: "the beam swings round" },
          safety: { zoneIds: params.checkpointZoneId === undefined ? [] : [params.checkpointZoneId] },
          consequence: "setback",
        },
      ],
    }),
  ],
};

export default plugin;
