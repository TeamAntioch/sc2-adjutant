// A test Campaign Pack whose Campaign Mod, Bell-Story, has a library (mods/bell-story): its bell
// Mechanic rings Ring Bell at mission start, a primitive it reads from the library's interface
// (context.library) rather than declaring one of its own.
import { z } from "zod";

import { defineMechanic, type PluginCode } from "../../../../../../src/plugins/plugin-api.js";
import { call, stableElementId } from "../../../../../../src/triggers/build-mission-triggers.js";
import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P } from "../../../../../../src/triggers/trigger-catalog.js";

const plugin: PluginCode = {
  mechanics: [
    defineMechanic({
      type: "bell",
      paramsSchema: z.object({ function: z.string().default("RingBell") }).strict(),
      buildTriggers: (params, context) => [
        {
          id: stableElementId(`mechanics/${context.mechanicId}`),
          name: "Bell Rings",
          events: [call(`mechanics/${context.mechanicId}/event`, F.mapInit, {})],
          actions: [call(`mechanics/${context.mechanicId}/ring`, context.library.function(params.function), { times: { kind: "int", value: 3 }, wait: { kind: "preset", preset: P.wait } })],
        },
      ],
    }),
  ],
};

export default plugin;
