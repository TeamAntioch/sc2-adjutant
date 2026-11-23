// The storm Mechanic: a countdown on screen. When it runs out, the lighting changes, a sound plays
// and the hero takes damage unless it's inside a shelter Zone. Then the countdown restarts.
//
// - "Storm Countdown" (map init): starts the timer and shows its window.
// - "Storm" (timer expires): light and sound, runs "Storm Damage", holds, blends back, restarts.
// - "Storm Damage": one condition per shelter (the hero isn't in it), then the damage effect.
// - "First Storm" (timer expires, once): what the Blueprint cues at `firstStorm`.
// Each victory trigger pauses the countdown and hides its window first.
import { z } from "zod";

import {
  call,
  defineMechanic,
  type MechanicContext,
  type MechanicIssue,
  type MechanicTriggerContext,
  type MechanicTriggers,
  NTVE_FUNCTIONS as F,
  NTVE_PRESETS as P,
  regionIdForZone,
  slugId,
  stableElementId,
  stableObjectId,
  type Trigger,
  type TriggerCall,
  type TriggerParam,
  type TriggerVariable,
} from "@team-antioch/sc2-adjutant/plugin-sdk";

const StormParamsSchema = z
  .object({
    heroAnchorId: slugId,
    shelterZoneIds: z.array(slugId).min(1),
    firstSeconds: z.number().positive(),
    intervalSeconds: z.number().positive(),
    damage: z.number().positive(),
    /** CLight ids; the baseline defaults to the Mission's own light. */
    light: z.string().min(1),
    baselineLight: z.string().min(1).optional(),
    sound: z.string().min(1),
    holdSeconds: z.number().positive().default(6),
    timerTitle: z.string().min(1).default("Next storm"),
  })
  .strict();
type StormParams = z.infer<typeof StormParamsSchema>;

const FIRST_STORM_CUE = "firstStorm";
const DAMAGE_EFFECT = "ReferenceStormDamage";
/** Neutral: the storm is the environment, not an enemy. */
const CASTER_PLAYER = 0;

function validateStorm(params: StormParams, context: MechanicContext): MechanicIssue[] {
  const issues: MechanicIssue[] = [];
  const hero = context.anchors.find((anchor) => anchor.id === params.heroAnchorId);
  if (!hero || hero.kind !== "unit") issues.push({ message: `Unknown unit anchor id: ${params.heroAnchorId}`, path: ["heroAnchorId"] });
  const zoneIds = new Set(context.zones.map((zone) => zone.id));
  params.shelterZoneIds.forEach((zoneId, index) => {
    if (!zoneIds.has(zoneId)) issues.push({ message: `Unknown zone id: ${zoneId}`, path: ["shelterZoneIds", index] });
  });
  return issues;
}

function stormTriggers(params: StormParams, context: MechanicTriggerContext): MechanicTriggers {
  const path = `mechanics/${context.mechanicId}`;
  const variable: TriggerVariable = {
    id: stableElementId(`${path}/timer`),
    name: "storm_timer",
    type: "timer",
    initial: { id: stableElementId(`${path}/timer/initial`), value: { kind: "call", call: call(`${path}/timer/initial/call`, F.newTimer, {}) } },
  };
  const timer: TriggerParam["value"] = { kind: "variable", variable };
  const hero: TriggerParam["value"] = { kind: "unit", objectId: stableObjectId(params.heroAnchorId) };
  const allPlayers = (callPath: string): TriggerParam["value"] => ({ kind: "call", call: call(callPath, F.allPlayers, {}) });
  const setLighting = (callPath: string, light: string, blendSeconds: number): TriggerCall =>
    call(callPath, F.setLighting, { blendTime: { kind: "fixed", value: blendSeconds }, light: { kind: "gamelink", gameType: "Light", value: light } });
  const startTimer = (callPath: string, seconds: number): TriggerCall =>
    call(callPath, F.timerStart, {
      duration: { kind: "fixed", value: seconds },
      repeating: { kind: "preset", preset: P.timerOneShot },
      timeType: { kind: "preset", preset: P.timeGame },
      timer,
    });
  const timerEvent = (eventPath: string): TriggerCall => call(eventPath, F.timerExpires, { timer });

  const damage: Trigger = {
    id: stableElementId(`${path}/damage`),
    name: "Storm Damage",
    events: [],
    conditions: params.shelterZoneIds.map((zoneId) =>
      call(`${path}/damage/outside/${zoneId}`, F.comparison, {
        left: {
          kind: "call",
          call: call(`${path}/damage/outside/${zoneId}/inRegion`, F.unitInRegion, { unit: hero, region: { kind: "region", regionId: regionIdForZone(context.zones, zoneId) } }),
        },
        operator: { kind: "preset", preset: P.compareEqual },
        right: { kind: "bool", value: false },
      }),
    ),
    actions: [
      call(`${path}/damage/apply`, F.playerCreateEffectUnit, {
        caster: { kind: "int", value: CASTER_PLAYER },
        effect: { kind: "gamelink", gameType: "Effect", value: DAMAGE_EFFECT },
        unit: hero,
      }),
    ],
  };

  const triggers: Trigger[] = [
    {
      id: stableElementId(`${path}/countdown`),
      name: "Storm Countdown",
      events: [call(`${path}/countdown/event`, F.mapInit, {})],
      actions: [
        startTimer(`${path}/countdown/start`, params.firstSeconds),
        call(`${path}/countdown/window`, F.timerWindowCreate, {
          timer,
          visible: { kind: "preset", preset: P.timerWindowVisible },
          elapsed: { kind: "preset", preset: P.timerWindowRemaining },
          title: { kind: "text", text: params.timerTitle },
        }),
      ],
    },
    {
      id: stableElementId(`${path}/strike`),
      name: "Storm",
      events: [timerEvent(`${path}/strike/event`)],
      actions: [
        setLighting(`${path}/strike/light`, params.light, 0.5),
        call(`${path}/strike/sound`, F.playSound, {
          owningPlayer: { kind: "preset", preset: P.globalSoundPlayer },
          audibleTo: allPlayers(`${path}/strike/sound/players`),
          volume: { kind: "fixed", value: 100 },
          offset: { kind: "fixed", value: 0 },
          sound: { kind: "soundlink", sound: params.sound },
        }),
        call(`${path}/strike/damage`, F.triggerExecute, {
          checkConditions: { kind: "preset", preset: P.checkConditions },
          wait: { kind: "preset", preset: P.dontWait },
          trigger: { kind: "trigger", trigger: { id: damage.id, name: damage.name } },
        }),
        call(`${path}/strike/hold`, F.wait, { time: { kind: "fixed", value: params.holdSeconds }, timeType: { kind: "preset", preset: P.timeGame } }),
        setLighting(`${path}/strike/restore`, params.baselineLight ?? context.light, 3),
        startTimer(`${path}/strike/restart`, params.intervalSeconds),
      ],
    },
    damage,
  ];

  const firstStorm = context.cueActions(FIRST_STORM_CUE);
  if (firstStorm.length > 0) {
    triggers.push({
      id: stableElementId(`${path}/first`),
      name: "First Storm",
      events: [timerEvent(`${path}/first/event`)],
      actions: [
        call(`${path}/first/disable`, F.triggerEnable, {
          trigger: { kind: "call", call: call(`${path}/first/disable/trigger`, F.currentTrigger, {}) },
          state: { kind: "preset", preset: P.triggerOff },
        }),
        ...firstStorm,
      ],
    });
  }

  const victoryActions = (victoryPath: string): TriggerCall[] => [
    call(`${victoryPath}/stopStorm/pause`, F.timerPause, { timer, pause: { kind: "preset", preset: P.timerPause } }),
    call(`${victoryPath}/stopStorm/hide`, F.timerWindowShow, {
      window: { kind: "call", call: call(`${victoryPath}/stopStorm/hide/window`, F.lastCreatedTimerWindow, {}) },
      players: allPlayers(`${victoryPath}/stopStorm/hide/players`),
      show: { kind: "preset", preset: P.hide },
    }),
  ];

  // The countdown is a clock: a scene holds it until it hands back.
  return { triggers, variables: [variable], clocks: [variable], victoryActions };
}

export const storm = defineMechanic({
  type: "storm",
  paramsSchema: StormParamsSchema,
  single: true,
  cues: [FIRST_STORM_CUE],
  validate: validateStorm,
  buildTriggers: stormTriggers,
  buildGameData: (params) => ({
    catalogs: {
      "EffectData.xml": [
        `    <CEffectDamage id="${DAMAGE_EFFECT}">`,
        '        <ImpactLocation Value="TargetUnit"/>',
        '        <Kind value="Spell"/>',
        `        <Amount value="${params.damage}"/>`,
        '        <ArmorReduction value="0"/>',
        '        <Death value="Fire"/>',
        "    </CEffectDamage>",
      ],
    },
  }),
  threats: (params, context) => {
    // A traversal Threat: every Zone the hero can walk to, but its shelters.
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
        safety: { zoneIds: params.shelterZoneIds, ...(hero.speed !== undefined ? { retreatSpeed: hero.speed } : {}) },
        consequence: "damage",
      },
    ];
  },
});
