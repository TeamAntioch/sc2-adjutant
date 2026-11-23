// A test Plugin Mechanic: a beacon that lights at mission start, with the zone it marks.
import { z } from "zod";

import { defineMechanic, type PluginCode } from "../../../../../../src/plugins/plugin-api.js";
import { call, stableElementId } from "../../../../../../src/triggers/build-mission-triggers.js";
import { type FunctionDef, NTVE_FUNCTIONS as F } from "../../../../../../src/triggers/trigger-catalog.js";
import type { TriggerVariable } from "../../../../../../src/triggers/trigger-model.js";

const BeaconParamsSchema = z
  .object({
    zoneId: z.string().min(1),
    lit: z.boolean().default(true),
    /** Makes buildTriggers throw, to test how hook errors are reported. */
    explode: z.boolean().optional(),
    /** Guards posted in this zone from the first beat: a combat Threat. Not validated, to test how core checks Threats. */
    guardsZoneId: z.string().min(1).optional(),
    /** Counts its chimes in a variable, and chimes again as this beat starts. Not validated, to test how core checks beat actions. */
    chimesAtBeat: z.string().min(1).optional(),
    /** Adds map-local data: a behaviour, its name and a hotkey. */
    withData: z.boolean().optional(),
    /** Rings its bell with a primitive it contributes, or with one it doesn't, to test how core checks primitives. */
    ring: z.enum(["contributed", "uncontributed", "stray-block"]).optional(),
    /** Rings first in each victory trigger, with a primitive it contributes or one it doesn't. */
    ringOnVictory: z.enum(["contributed", "uncontributed"]).optional(),
    /** Forgets to ask for what the Blueprint cues at its `lit` cue, to test that core notices. */
    ignoresCue: z.boolean().optional(),
    /** Warns of each placed unit in its zone, to test the warnings hook and the placed units it reads. */
    warnsOfPlaced: z.boolean().optional(),
    /** Makes the cuesOf hook throw, or return something other than cue names, to test how core checks it. */
    cuesOf: z.enum(["throws", "bad", "stray"]).optional(),
    /** Another beacon whose lighting always comes before this one's, for core's Beat order check. */
    litAfter: z.string().min(1).optional(),
  })
  .strict();

// Test-only primitives, not real Editor functions: core only checks that a Mechanic declares what it uses.
const ringBell = { library: "Ntve", id: "BEAC0001", kind: "action", params: {}, galaxy: () => "BeaconRing()" } as const satisfies FunctionDef;
const strayBell = { library: "Ntve", id: "BEAC0002", kind: "action", params: {}, galaxy: () => "BeaconStray()" } as const satisfies FunctionDef;

const plugin: PluginCode = {
  mechanics: [
    defineMechanic({
      type: "beacon",
      paramsSchema: BeaconParamsSchema,
      primitives: { functions: { ringBell } },
      cues: ["lit"],
      behaviorIds: (params) => (params.withData ? ["BeaconGlow"] : []),
      momentOrder: (params, context) => (params.litAfter === undefined ? [] : [{ before: { mechanicId: params.litAfter, cue: "lit" }, after: { mechanicId: context.mechanicId, cue: "lit" } }]),
      cuesOf: (params) => {
        if (params.cuesOf === "throws") throw new Error("the beacon can't count");
        if (params.cuesOf === "stray") return ["lit", "dimmed"];
        return params.cuesOf === "bad" ? ([42] as unknown as string[]) : ["lit"];
      },
      validate: (params, context) =>
        context.zones.some((zone) => zone.id === params.zoneId) ? [] : [{ message: `Unknown zone id: ${params.zoneId}`, path: ["zoneId"] }],
      warnings: (params, context) =>
        params.warnsOfPlaced
          ? context
              .placedUnits()
              .filter((unit) => unit.zoneId === params.zoneId)
              .map((unit) => `${unit.unitType} ${unit.id} stands at ${unit.x}, ${unit.y}`)
          : [],
      buildTriggers: (params, context) => {
        if (params.explode) throw new Error("the beacon exploded");
        const lights = {
          id: stableElementId(`mechanics/${context.mechanicId}`),
          name: "Beacon Lights",
          events: [{ id: stableElementId(`mechanics/${context.mechanicId}/event`), def: F.mapInit, params: {} }],
          actions: [
            // What the Blueprint cues at the beacon lighting plays as it lights.
            ...(params.ignoresCue ? [] : context.cueActions("lit")),
            ...(params.ring === undefined
              ? []
              : [
                  {
                    id: stableElementId(`mechanics/${context.mechanicId}/ring`),
                    def: params.ring === "uncontributed" ? strayBell : ringBell,
                    params: {},
                    ...(params.ring === "stray-block" ? { blocks: [{ type: { library: "Ntve" as const, id: "BEAC0003" }, calls: [] }] } : {}),
                  },
                ]),
          ],
        };
        const ringOnVictory = params.ringOnVictory;
        if (ringOnVictory !== undefined) {
          return {
            triggers: [lights],
            victoryActions: (path) => [{ id: stableElementId(`${path}/ring`), def: ringOnVictory === "contributed" ? ringBell : strayBell, params: {} }],
          };
        }
        if (params.chimesAtBeat === undefined) return [lights];
        const path = `mechanics/${context.mechanicId}/chimes`;
        const chimes: TriggerVariable = {
          id: stableElementId(path),
          name: "beacon_chimes",
          type: "int",
          initial: { id: stableElementId(`${path}/initial`), value: { kind: "int", value: 0 } },
        };
        return {
          triggers: [lights],
          variables: [chimes],
          beatActions: {
            [params.chimesAtBeat]: [call(`${path}/beat`, F.setVariable, { variable: { kind: "variable", variable: chimes }, value: { kind: "int", value: 1 } })],
          },
        };
      },
      buildGameData: (params) =>
        params.withData
          ? {
              catalogs: { "BehaviorData.xml": ['    <CBehaviorBuff id="BeaconGlow"/>'] },
              strings: { "Behavior/Name/BeaconGlow": "Beacon Glow" },
              hotkeys: { "Button/Hotkey/BeaconGlow": "B" },
            }
          : {},
      threats: (params, context) =>
        params.guardsZoneId === undefined
          ? []
          : [
              {
                footprint: { zoneIds: [params.guardsZoneId] },
                schedule: { kind: "from-beat", beatId: context.beats[0]!.id },
                telegraph: { description: "the beacon's light" },
                safety: { zoneIds: [] },
                consequence: "combat",
              },
            ],
    }),
  ],
};

export default plugin;
