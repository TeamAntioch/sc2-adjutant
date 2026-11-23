// The relay Mechanic: relay towers the player takes over. Each Anchor's change of owner counts it
// in relays_held and shows a message. The first one plays what the Blueprint cues at
// `firstRelay`. A Beat can announce how many are held, and a Connection opens once a Beat starts.
//
// - "Relay <anchor> Taken" (the anchor's unit becomes the player's, once): count it, show the message.
// - "First Relay" (any relay becomes the player's, once): the `firstRelay` cue.
import { z } from "zod";

import {
  call,
  callValue,
  defineMechanic,
  type MechanicContext,
  type MechanicIssue,
  type MechanicTriggerContext,
  type MechanicTriggers,
  NTVE_FUNCTIONS as F,
  NTVE_PRESETS as P,
  slugId,
  stableElementId,
  stableObjectId,
  type Trigger,
  type TriggerCall,
  type TriggerParam,
  type TriggerVariable,
  USER_PLAYER,
} from "@team-antioch/sc2-adjutant/plugin-sdk";

const RelayParamsSchema = z
  .object({
    relays: z.array(z.object({ anchorId: slugId, zoneId: slugId }).strict()).min(1),
    message: z.string().min(1).default("Relay online."),
    /** A Beat whose start shows how many relays are held. */
    announceAtBeat: slugId.optional(),
    /** A Connection the relays open from a Beat on (a gate that unlocks). */
    opens: z.object({ fromZoneId: slugId, toZoneId: slugId, atBeat: slugId }).strict().optional(),
  })
  .strict();
type RelayParams = z.infer<typeof RelayParamsSchema>;

const FIRST_RELAY_CUE = "firstRelay";
const LINK_BEHAVIOR = "ReferenceRelayLink";
const TOWER = "ReferenceRelayTower";
const PULSE = "ReferenceRelayPulse";
const HELD = "ReferenceRelayHeld";

function validateRelay(params: RelayParams, context: MechanicContext): MechanicIssue[] {
  const issues: MechanicIssue[] = [];
  const zoneIds = new Set(context.zones.map((zone) => zone.id));
  params.relays.forEach((relay, index) => {
    const anchor = context.anchors.find((candidate) => candidate.id === relay.anchorId);
    if (!anchor || anchor.kind !== "unit") issues.push({ message: `Unknown unit anchor id: ${relay.anchorId}`, path: ["relays", index, "anchorId"] });
    if (!zoneIds.has(relay.zoneId)) issues.push({ message: `Unknown zone id: ${relay.zoneId}`, path: ["relays", index, "zoneId"] });
  });
  return issues;
}

function relayTriggers(params: RelayParams, context: MechanicTriggerContext): MechanicTriggers {
  const path = `mechanics/${context.mechanicId}`;
  const held: TriggerVariable = {
    id: stableElementId(`${path}/held`),
    name: "relays_held",
    type: "int",
    initial: { id: stableElementId(`${path}/held/initial`), value: { kind: "int", value: 0 } },
  };
  const heldValue: TriggerParam["value"] = { kind: "variable", variable: held };
  const unit = (anchorId: string): TriggerParam["value"] => ({ kind: "unit", objectId: stableObjectId(anchorId) });
  const turnOff = (callPath: string): TriggerCall =>
    call(callPath, F.triggerEnable, {
      trigger: { kind: "call", call: call(`${callPath}/trigger`, F.currentTrigger, {}) },
      state: { kind: "preset", preset: P.triggerOff },
    });
  // A change of owner counts only when the tower became the player's.
  const toPlayer = (callPath: string): TriggerCall =>
    call(callPath, F.comparison, {
      left: { kind: "call", call: call(`${callPath}/owner`, F.unitOwner, { unit: { kind: "call", call: call(`${callPath}/owner/unit`, F.triggeringUnit, {}) } }) },
      operator: { kind: "preset", preset: P.compareEqual },
      right: { kind: "int", value: USER_PLAYER },
    });
  const message = (callPath: string, text: string): TriggerCall =>
    call(callPath, F.textMessage, {
      players: { kind: "call", call: call(`${callPath}/players`, F.allPlayers, {}) },
      area: { kind: "preset", preset: P.messageAreaDirective },
      message: { kind: "text", text },
    });

  const triggers: Trigger[] = params.relays.map((relay) => {
    const at = `${path}/relays/${relay.anchorId}`;
    return {
      id: stableElementId(at),
      name: `Relay ${relay.anchorId} Taken`,
      events: [call(`${at}/event`, F.unitOwnerChanges, { unit: unit(relay.anchorId) })],
      conditions: [toPlayer(`${at}/toPlayer`)],
      actions: [
        turnOff(`${at}/once`),
        call(`${at}/count`, F.setVariable, {
          variable: heldValue,
          value: callValue(`${at}/count/plus`, F.arithmeticInt, { left: heldValue, operator: { kind: "preset", preset: P.plus }, right: { kind: "int", value: 1 } }),
        }),
        message(`${at}/message`, params.message),
      ],
    };
  });

  const firstRelay = context.cueActions(FIRST_RELAY_CUE);
  if (firstRelay.length > 0) {
    triggers.push({
      id: stableElementId(`${path}/first`),
      name: "First Relay",
      events: params.relays.map((relay) => call(`${path}/first/event/${relay.anchorId}`, F.unitOwnerChanges, { unit: unit(relay.anchorId) })),
      conditions: [toPlayer(`${path}/first/toPlayer`)],
      actions: [turnOff(`${path}/first/once`), ...firstRelay],
    });
  }

  const beatActions =
    params.announceAtBeat === undefined ? undefined : { [params.announceAtBeat]: [message(`${path}/announce`, `${params.relays.length} relays stand on this ground.`)] };
  return { triggers, variables: [held], ...(beatActions ? { beatActions } : {}) };
}

export const relay = defineMechanic({
  type: "relay",
  paramsSchema: RelayParamsSchema,
  cues: [FIRST_RELAY_CUE],
  validate: validateRelay,
  buildTriggers: relayTriggers,
  // A tower unit with a pulse ability and its button, gated on a requirement, in every catalog a
  // Mechanic's map-local data commonly reaches.
  buildGameData: () => ({
    catalogs: {
      "AbilData.xml": [`    <CAbilEffectInstant id="${PULSE}">`, `        <CmdButtonArray index="Execute" DefaultButtonFace="${PULSE}" Requirements="${HELD}"/>`, "    </CAbilEffectInstant>"],
      "ActorData.xml": [`    <CActorUnit id="${TOWER}" parent="GenericUnitStandard" unitName="${TOWER}"/>`],
      "BehaviorData.xml": [`    <CBehaviorBuff id="${LINK_BEHAVIOR}"/>`],
      "ButtonData.xml": [`    <CButton id="${PULSE}">`, '        <Icon value="Assets\\Textures\\btn-ability-protoss-feedback.dds"/>', "    </CButton>"],
      "RequirementData.xml": [`    <CRequirement id="${HELD}">`, `        <NodeArray index="Use" Link="${HELD}"/>`, "    </CRequirement>"],
      "RequirementNodeData.xml": [`    <CRequirementCountBehavior id="${HELD}">`, `        <Count Link="${LINK_BEHAVIOR}" State="Has"/>`, "    </CRequirementCountBehavior>"],
      "UnitData.xml": [`    <CUnit id="${TOWER}" parent="Pylon">`, `        <AbilArray Link="${PULSE}"/>`, `        <BehaviorArray Link="${LINK_BEHAVIOR}"/>`, "    </CUnit>"],
      "ValidatorData.xml": [`    <CValidatorUnitCompareBehaviorCount id="${HELD}Validator">`, `        <Behavior value="${LINK_BEHAVIOR}"/>`, "    </CValidatorUnitCompareBehaviorCount>"],
    },
    strings: { [`Behavior/Name/${LINK_BEHAVIOR}`]: "Relay Link", [`Button/Name/${PULSE}`]: "Relay Pulse", [`Unit/Name/${TOWER}`]: "Relay Tower" },
    hotkeys: { [`Button/Hotkey/${PULSE}`]: "R" },
  }),
  connectionChanges: (params) =>
    params.opens === undefined
      ? []
      : [{ fromZoneId: params.opens.fromZoneId, toZoneId: params.opens.toZoneId, state: "open" as const, schedule: { kind: "from-beat" as const, beatId: params.opens.atBeat } }],
});
