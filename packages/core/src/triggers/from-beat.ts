// Arming an outcome condition (a victory or defeat condition, an objective's completeWhen) or an
// encounter only once a Beat has started (`fromBeat`), and meeting it then if it already holds.

import type { EncounterStart, MissionBlueprint, OutcomeCondition } from "../domain/mission-blueprint.js";
import { regionIdForZone } from "../map/write-regions-xml.js";
import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P } from "./trigger-catalog.js";
import type { Trigger, TriggerCall, TriggerParam, TriggerRef, TriggerVariable } from "./trigger-model.js";
import { call, callValue, compare, ifThen, ifTriggerOn, runTrigger, stableElementId, triggerVariable, turnOffCurrentTrigger, USER_PLAYER } from "./trigger-builders.js";
import { isWaveUnit, regionValueOf, unitValueOf } from "./kept-ids.js";

/** A trigger off from map start that a Beat's start turns on (`initiallyOff`), then runs if `holds` already does. */
export type ArmedTrigger = {
  readonly beatId: string;
  readonly trigger: TriggerRef;
  /** The If's conditions: whether what the trigger waits for has already happened. */
  readonly holds: readonly TriggerCall[];
  /** Whether running it checks its own conditions: a condition trigger's victory-once test, not an encounter's test of the unit entering. */
  readonly checkConditions: boolean;
};

const isTrue = (path: string, value: TriggerParam["value"], expected = true): TriggerCall => compare(path, value, P.compareEqual, { kind: "bool", value: expected });

/**
 * Whether an outcome condition's or an encounter start's event has already happened, as a Beat
 * arms it: the anchor's unit dead, in the Zone's region and alive, or player 1's; player 1's
 * collected total at the quota. A Wave's unit is none until its send creates it, so each of its
 * tests is first that it's there: unsent, it has not died, entered or been captured. A timer counts
 * from mission start, so it takes no `fromBeat` and has no state here.
 */
export function conditionHolds(blueprint: MissionBlueprint, condition: OutcomeCondition | EncounterStart, path: string): TriggerCall[] {
  if (condition.type === "timer") throw new Error(`A timer counts down from mission start, so it can't wait for Beat ${condition.fromBeat}`);
  if (condition.type === "objectivesComplete") throw new Error("Objectives complete as the mission goes, each armed from a Beat of its own, so a condition on them can't wait for a Beat");
  if (condition.type === "resourceQuota") {
    const preset = condition.resource === "minerals" ? P.playerPropMineralsCollected : P.playerPropVespeneCollected;
    return [
      call(`${path}/collected`, F.comparison, {
        left: callValue(`${path}/collected/amount`, F.playerPropertyInt, { player: { kind: "int", value: USER_PLAYER }, property: { kind: "preset", preset } }),
        operator: { kind: "preset", preset: P.compareAtLeast },
        right: { kind: "int", value: condition.amount },
      }),
    ];
  }
  const unit = unitValueOf(blueprint, condition.anchorId);
  const alive = callValue(`${path}/alive`, F.unitIsAlive, { unit });
  const sent = isWaveUnit(blueprint, condition.anchorId) ? [compare(`${path}/sent`, unit, P.compareNotEqual, { kind: "preset", preset: P.noUnit })] : [];
  switch (condition.type) {
    case "anchorDies":
      return [...sent, isTrue(`${path}/dead`, alive, false)];
    case "anchorEntersZone":
      return [...sent, isTrue(`${path}/living`, alive), isTrue(`${path}/inZone`, callValue(`${path}/inZone/test`, F.unitInRegion, { unit, region: regionValueOf(blueprint, condition.zoneId) }))];
    case "anchorCaptured":
      return [...sent, compare(`${path}/owner`, callValue(`${path}/owner/player`, F.unitOwner, { unit }), P.compareEqual, { kind: "int", value: USER_PLAYER })];
  }
}

/** `player`'s living units in a Zone's region, as a Unit Group. */
export const playerUnitsInZone = (blueprint: Pick<MissionBlueprint, "zones">, zoneId: string, player: number, path: string): TriggerParam["value"] =>
  callValue(path, F.unitsInRegionMatching, {
    unitType: { kind: "preset", preset: P.anyUnitType },
    player: { kind: "int", value: player },
    region: { kind: "region", regionId: regionIdForZone(blueprint.zones, zoneId) },
    filter: { kind: "unitfilter", require: [], exclude: ["Dead"] },
    count: { kind: "preset", preset: P.anyAmount },
  });

/** Whether `player` has a unit in the Zone's region: an encounter set off by entering it, already entered. */
export const playerInZone = (blueprint: Pick<MissionBlueprint, "zones">, zoneId: string, player: number, path: string): TriggerCall[] => [
  call(`${path}/units`, F.comparison, {
    left: callValue(`${path}/units/count`, F.unitGroupCount, { group: playerUnitsInZone(blueprint, zoneId, player, `${path}/units/count/group`), type: { kind: "preset", preset: P.unitCountAlive } }),
    operator: { kind: "preset", preset: P.compareAtLeast },
    right: { kind: "int", value: 1 },
  }),
];

const armsRef = (beat: Pick<MissionBlueprint["beats"][number], "id" | "title">): TriggerRef => ({ id: stableElementId(`beats/${beat.id}/arms`), name: `Beat - ${beat.title} Arms` });

/**
 * "Beat - <title> Arms" for each Beat something waits for: it turns itself off, so it runs once,
 * then turns on each trigger armed from that Beat and runs it, without waiting, if what it waits
 * for already holds. `beatActions` gives what each Beat's trigger runs to arm them, after its own
 * scenes: its own Arms, while on, and every earlier Beat's that never started (`started`, which
 * `startActions` sets as that Beat's trigger starts), so a Beat the mission skips still arms them
 * as the next one starts, as a Wave's start does (wave-triggers.ts), while one still playing its
 * scenes arms its own after them.
 */
export function armsTriggers(
  blueprint: Pick<MissionBlueprint, "beats">,
  armed: readonly ArmedTrigger[],
): {
  readonly triggers: readonly Trigger[];
  /** Each Arms trigger's Beat, by id. */
  readonly beatOf: ReadonlyMap<Trigger, string>;
  readonly variables: readonly TriggerVariable[];
  readonly startActions: (beatId: string) => TriggerCall[];
  readonly beatActions: (beatId: string) => TriggerCall[];
} {
  const from = blueprint.beats.filter((beat) => armed.some((entry) => entry.beatId === beat.id));
  const triggers = from.map((beat): Trigger => {
    const path = `beats/${beat.id}/arms`;
    return {
      ...armsRef(beat),
      events: [],
      actions: [
        turnOffCurrentTrigger(`${path}/once`),
        ...armed
          .filter((entry) => entry.beatId === beat.id)
          .flatMap(({ trigger, holds, checkConditions }) => {
            const at = `${path}/${trigger.id}`;
            const value: TriggerParam["value"] = { kind: "trigger", trigger };
            return [
              call(`${at}/on`, F.triggerEnable, { trigger: value, state: { kind: "preset", preset: P.triggerOn } }),
              ifThen(`${at}/met`, holds, [runTrigger(`${at}/met/run`, trigger, { checkConditions })]),
            ];
          }),
      ],
    };
  });
  const beatOf = new Map(triggers.map((trigger, index) => [trigger, from[index]!.id]));
  const started = new Map(from.map((beat) => [beat.id, triggerVariable(`beats/${beat.id}/variables/started`, `beat_${beat.id.replace(/-/g, "_")}_started`, "bool", { kind: "bool", value: false })]));
  const startActions = (beatId: string): TriggerCall[] => {
    const variable = started.get(beatId);
    return variable ? [call(`beats/${beatId}/started`, F.setVariable, { variable: { kind: "variable", variable }, value: { kind: "bool", value: true } })] : [];
  };
  const order = new Map(blueprint.beats.map((beat, index) => [beat.id, index]));
  const beatActions = (beatId: string): TriggerCall[] =>
    from
      .filter((beat) => order.get(beat.id)! <= order.get(beatId)!)
      .map((beat) => {
        const at = `beats/${beatId}/arm/${beat.id}`;
        const arms = armsRef(beat);
        const run = runTrigger(`${at}/run`, arms);
        if (beat.id === beatId) return ifTriggerOn(at, arms, [run]);
        return ifThen(
          at,
          [
            isTrue(`${at}/on`, callValue(`${at}/on/enabled`, F.triggerIsEnabled, { trigger: { kind: "trigger", trigger: arms } })),
            isTrue(`${at}/skipped`, { kind: "variable", variable: started.get(beat.id)! }, false),
          ],
          [run],
        );
      });
  return { triggers, beatOf, variables: [...started.values()], startActions, beatActions };
}
