import { z } from "zod";

import {
  blueprintCues,
  isMomentOf,
  mechanicMoments,
  type Cue,
  type EncounterStart,
  hasKeptTerrain,
  type MissionBlueprint,
  type OutcomeCondition,
  playsAlone,
  scenePlayedKey,
  scenePlayedName,
  type ScenePart,
  type Transition,
  type UiAction,
} from "../domain/mission-blueprint.js";
import { enemyAiSettings, enemyPlayers } from "../ai/enemy-ai.js";
import { blueprintCatalog } from "../catalog/catalog-layer.js";
import { missionLight } from "../catalog/tileset-lights.js";
import { getTilesetTextures, missionTextures } from "../catalog/tileset-textures.js";
import { bySpeaker } from "../domain/character.js";
import { compositeActorLines, compositeActors } from "../map/write-composite-actors.js";
import { lightRegionOverride } from "../map/light-regions.js";
import { lightDataXml, mapLights } from "../map/write-lights.js";
import { skyTerrainFields } from "../map/write-sky.js";
import { poolStateValue, waterDataXml } from "../map/write-water.js";
import { regionIdForZone } from "../map/write-regions-xml.js";
import { mechanicContext } from "../plugins/mechanic-context.js";
import { type CampaignLibrary, type Mechanic, type MechanicGameData, type MechanicTriggers, pluginMechanicEntries, runHook } from "../plugins/plugin-api.js";
import type { Script, ScriptLine } from "../script/name-script.js";
import { canonicalAddress, cuedLines } from "../script/scene-parts.js";
import {
  CORE_PRIMITIVES,
  type FunctionDef,
  NTVE_FUNCTIONS as F,
  NTVE_PRESETS as P,
  type PresetDef,
  primitiveKey,
  samePrimitive,
  SUB_FUNCTIONS,
  type SubFunctionDef,
  type TriggerLibrary,
} from "./trigger-catalog.js";
import {
  editorGlobalName,
  galaxyIdentifier,
  nestedCalls,
  triggerCalls,
  type Trigger,
  type TriggerCall,
  type TriggerDocument,
  type TriggerParam,
  type TriggerRef,
  type TriggerVariable,
} from "./trigger-model.js";
import { block, call, callValue, capitalized, compare, debugMessage, ifAlive, ifThen, ifTriggerOn, runTrigger, stableElementId, titleWords, triggerVariable, USER_PLAYER, wait, waits, waitUntil } from "./trigger-builders.js";
import { anchorNameOf, isWaveUnit, keptTriggerRef, namesUnit, regionValueOf, unitValueOf, zoneNameOf } from "./kept-ids.js";
import { type MissionHeroMoment, missionHeroMoment } from "../ui/hero-moment.js";
import type { UiActionContext } from "../ui/ui-component.js";
import { beatBounds } from "./beat-bounds.js";
import { beatReveals } from "./beat-reveals.js";
import { beatStart } from "./beat-start.js";
import { type ArmedTrigger, armsTriggers, conditionHolds, playerInZone, playerUnitsInZone } from "./from-beat.js";
import { bookmarksFiredOnSkip, conditionPath, cuePath, cueTriggers, cueUnitOf, encounterEndStart, objectivesNeeded, partPath } from "./cue-triggers.js";
import { type AnchorCondition, isConditionCue, type ObjectivesCondition, OUTCOME_OUTRO, requireLoaded, sameCondition, sceneChain } from "./scene-chain.js";
import { type CinematicPlayback, cinematicPlayback } from "./cinematic-triggers.js";
import { type HandedOn, type TriggerScenePlayback, triggerScenePlayback } from "./trigger-scene-triggers.js";
import { type MomentLines, momentLine, type TransmissionHold, transmissionHold } from "./transmission-hold.js";
import type { TimedTriggerScene } from "../cutscene/trigger-scene.js";
import { type TransmissionActions, waveStreams } from "./wave-triggers.js";
import { FOLDER_LABELS, fileDocument, type FolderPlan } from "./trigger-filing.js";

export { behaviorLink, block, call, callValue, pickedUnit, stableElementId, triggerVariable, turnOffCurrentTrigger, USER_PLAYER } from "./trigger-builders.js";

type Objective = MissionBlueprint["objectives"][number];
type Encounter = MissionBlueprint["encounters"][number];




function gameOver(path: string, type: typeof P.gameOverVictory | typeof P.gameOverDefeat): TriggerCall {
  return {
    id: stableElementId(path),
    def: F.gameOver,
    params: {
      player: { id: stableElementId(`${path}/player`), value: { kind: "int", value: USER_PLAYER } },
      type: { id: stableElementId(`${path}/type`), value: { kind: "preset", preset: type } },
      showDialog: { id: stableElementId(`${path}/showDialog`), value: { kind: "preset", preset: P.gameOverShowDialogTrue } },
      showScore: { id: stableElementId(`${path}/showScore`), value: { kind: "preset", preset: P.gameOverShowDialogTrue } },
    },
  };
}

/** Rough reading time for a line with no recorded audio. */
export function estimateLineSeconds(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(3, Math.ceil(words / 2.5) + 1);
}

type Scene = MissionBlueprint["screenplay"]["scenes"][number];

/**
 * One waiting "Send Transmission For Player" per line, so a scene plays in order:
 * the speaker's unit flashes and talks, and its portrait shows at centre left.
 */
function sceneTransmissions(blueprint: MissionBlueprint, scene: Scene, prefix = ""): TriggerCall[] {
  return scene.lines.map((line) => {
    const path = `${prefix}scenes/${scene.id}/${line.id}`;
    const byType = (sourcePath: string, unitType: string): TriggerCall =>
      call(sourcePath, F.unitTypeTransmissionSource, {
        overridePortrait: { kind: "preset", preset: P.doNot },
        unitType: { kind: "gamelink", gameType: "Unit", value: unitType },
      });
    if (line.speakerAnchorId) {
      const source = unitSource(`${path}/source`, unitValueOf(blueprint, line.speakerAnchorId));
      if (!isWaveUnit(blueprint, line.speakerAnchorId)) return lineTransmission(path, source, line);
      // A Wave's unit speaks from the map once it's there; before, or once dead, from its type.
      const type = blueprint.anchors.find((anchor) => anchor.id === line.speakerAnchorId)?.unitType;
      return speakerIsThere(blueprint, `${path}/there`, line.speakerAnchorId, [lineTransmission(path, source, line)], [
        lineTransmission(`${path}/gone`, type ? byType(`${path}/gone/source`, type) : call(`${path}/gone/source`, F.noTransmissionSource, {}), line),
      ]);
    }
    // Only an uncued scene, played as a Wave warning's Transmission, can get here without a unit type: the schema asks cued scenes for a source.
    return lineTransmission(path, line.speakerUnitType ? byType(`${path}/source`, line.speakerUnitType) : call(`${path}/source`, F.noTransmissionSource, {}), line);
  });
}

/** A Transmission's source: a unit on the map, which flashes and talks. */
const unitSource = (path: string, unit: TriggerParam["value"]): TriggerCall =>
  call(path, F.unitTransmissionSource, {
    flash: { kind: "preset", preset: P.transmissionFlash },
    overridePortrait: { kind: "preset", preset: P.doNot },
    anim: { kind: "modelanim", value: "Talk" },
    unit,
  });

/** `then` while the speaker's unit, a Wave's unit (kept-ids' isWaveUnit), is alive; else `otherwise`. */
function speakerIsThere(blueprint: MissionBlueprint, path: string, anchorId: string, then: TriggerCall[], otherwise: TriggerCall[]): TriggerCall {
  return ifAlive(path, unitValueOf(blueprint, anchorId), then, otherwise);
}

/** A screenplay scene's line as a waiting Transmission from `source`. */
function lineTransmission(path: string, source: TriggerCall, line: Scene["lines"][number]): TriggerCall {
  return call(path, F.sendTransmission, {
    players: { kind: "call", call: call(`${path}/players`, F.allPlayers, {}) },
    source: { kind: "call", call: source },
    portrait: {
      kind: "call",
      call: call(`${path}/portrait`, F.cinematicPortrait, {
        position: { kind: "preset", preset: P.cinematicPortraitCenterLeft },
      }),
    },
    portraitActor: { kind: "string", value: "" },
    portraitAnim: { kind: "modelanim", value: "Talk" },
    sound: { kind: "preset", preset: P.noSoundLink },
    duration: { kind: "fixed", value: line.durationSeconds ?? estimateLineSeconds(line.text) },
    durationType: { kind: "preset", preset: P.transmissionDurationSet },
    wait: { kind: "preset", preset: P.wait },
    player: { kind: "preset", preset: P.globalSoundPlayer },
    isSelect: { kind: "bool", value: false },
    speaker: { kind: "text", text: line.speaker },
    message: { kind: "text", text: line.text },
  });
}

function objectiveVariable(objective: Objective): TriggerVariable {
  const path = `objectives/${objective.id}/variable`;
  return {
    id: stableElementId(path),
    name: `objective_${objective.id}`,
    type: "objective",
    initial: { id: stableElementId(`${path}/initial`), value: { kind: "preset", preset: P.noObjective } },
  };
}

/** Creates the objective and stores it; `hidden`, an objective a trigger scene issues at its handback, is hidden until then. */
function createObjective(objective: Objective, variable: TriggerVariable | undefined, hidden = false): TriggerCall[] {
  const path = `objectives/${objective.id}/create`;
  const create: TriggerCall = {
    id: stableElementId(path),
    def: F.objectiveCreate,
    params: {
      description: { id: stableElementId(`${path}/description`), value: { kind: "text", text: objective.description } },
      state: { id: stableElementId(`${path}/state`), value: { kind: "preset", preset: P.objectiveStateActive } },
      show: { id: stableElementId(`${path}/show`), value: { kind: "preset", preset: P.objectiveShowTrue } },
      name: { id: stableElementId(`${path}/name`), value: { kind: "text", text: objective.title } },
    },
  };
  if (!variable) return [create];
  const storePath = `objectives/${objective.id}/store`;
  return [
    create,
    {
      id: stableElementId(storePath),
      def: F.setVariable,
      params: {
        variable: { id: stableElementId(`${storePath}/variable`), value: { kind: "variable", variable } },
        value: {
          id: stableElementId(`${storePath}/value`),
          value: {
            kind: "call",
            call: { id: stableElementId(`${storePath}/value/call`), def: F.lastCreatedObjective, params: {} },
          },
        },
      },
    },
    ...(hidden
      ? [
          call(`objectives/${objective.id}/hide`, F.objectiveShow, {
            objective: { kind: "variable", variable },
            players: callValue(`objectives/${objective.id}/hide/players`, F.allPlayers, {}),
            show: { kind: "preset", preset: P.hide },
          }),
        ]
      : []),
  ];
}

function completeObjective(objective: Objective, variable: TriggerVariable): TriggerCall {
  const path = `objectives/${objective.id}/complete`;
  return {
    id: stableElementId(path),
    def: F.objectiveSetState,
    params: {
      objective: { id: stableElementId(`${path}/objective`), value: { kind: "variable", variable } },
      state: { id: stableElementId(`${path}/state`), value: { kind: "preset", preset: P.objectiveStateCompleted } },
    },
  };
}



/** "Triggering Unit", as a parameter value. */
export const triggeringUnit = (path: string): TriggerParam["value"] => ({ kind: "call", call: call(path, F.triggeringUnit, {}) });

const encounterRef = (blueprint: MissionBlueprint, encounter: Encounter): TriggerRef => ({
  id: stableElementId(`encounters/${encounter.id}`),
  name: `Encounter - ${blueprint.zones.find((candidate) => candidate.id === encounter.triggerZoneId)!.name}`,
});

/** Whether an encounter starts on its Anchor's unit dying, armed only from a Beat: it may run once the unit is gone. */
const startsOnDeathFromBeat = (encounter: Encounter): boolean => encounter.fromBeat !== undefined && encounter.startsWhen?.type === "anchorDies";

/** Where the Anchor's unit died, for an encounter that starts on its death from a Beat (encounterDeathWatch). */
const encounterDeathPoint = (encounter: Encounter): TriggerVariable => {
  const path = `encounters/${encounter.id}/variables/deathPoint`;
  return triggerVariable(path, `encounters_${encounter.id.replace(/[^A-Za-z0-9]+/g, "_")}_death_point`, "point", callValue(`${path}/initial/value`, F.point, { x: { kind: "fixed", value: 0 }, y: { kind: "fixed", value: 0 } }));
};

/**
 * "Encounter Death - <zone>", for an encounter that starts on its Anchor's unit dying, armed only
 * from a Beat: a Beat that arms it after the death runs it once the unit may be gone, with no
 * position to send the attackers at. So this watch, on from map start, keeps where the unit died
 * as it dies, then runs the encounter if it's on (armed); the encounter has no event of its own.
 */
function encounterDeathWatch(blueprint: MissionBlueprint, encounter: Encounter): { readonly trigger: Trigger; readonly variable: TriggerVariable } | undefined {
  if (!startsOnDeathFromBeat(encounter)) return undefined;
  const path = `encounters/${encounter.id}`;
  const variable = encounterDeathPoint(encounter);
  const ref = encounterRef(blueprint, encounter);
  const zone = blueprint.zones.find((candidate) => candidate.id === encounter.triggerZoneId)!;
  return {
    variable,
    trigger: {
      id: stableElementId(`${path}/death`),
      name: `Encounter Death - ${zone.name}`,
      events: [anchorEvent(blueprint, encounter.startsWhen!, `${path}/starts`)],
      actions: [
        call(`${path}/death/point`, F.setVariable, { variable: { kind: "variable", variable }, value: callValue(`${path}/death/point/value`, F.unitPosition, { unit: triggeringUnit(`${path}/death/point/value/unit`) }) }),
        ifTriggerOn(`${path}/death/run`, ref, [runTrigger(`${path}/death/run/run`, ref)]),
      ],
    },
  };
}

/**
 * "Encounter - <zone>": when one of the player's units enters the zone, or on its `startsWhen`
 * (an Anchor's unit's event), turn the trigger off, send every attacker to attack-move on the
 * triggering unit's position, set its end going (its Behavior added), then play cued scenes.
 * With `fromBeat` it is off until that Beat arms it (from-beat.ts), which may run it with no
 * triggering unit, so the attackers go for the start's Anchor's unit, or the first of the player's
 * units in the zone, instead; for its Anchor's unit's death, where the unit died, which its watch
 * keeps (encounterDeathWatch), as the unit may be gone.
 */
function encounterTrigger(blueprint: MissionBlueprint, encounter: Encounter, scenes: SceneActions): Trigger {
  const path = `encounters/${encounter.id}`;
  const player = encounter.player ?? USER_PLAYER;
  const target = (at: string): TriggerParam["value"] => {
    if (encounter.fromBeat === undefined) return triggeringUnit(at);
    if (encounter.startsWhen) return unitValueOf(blueprint, encounter.startsWhen.anchorId);
    return callValue(at, F.unitGroupUnit, { group: playerUnitsInZone(blueprint, encounter.triggerZoneId, player, `${at}/group`), index: { kind: "int", value: 1 } });
  };
  const deathPoint = startsOnDeathFromBeat(encounter) ? encounterDeathPoint(encounter) : undefined;
  const point = (at: string): TriggerParam["value"] => (deathPoint ? { kind: "variable", variable: deathPoint } : callValue(at, F.unitPosition, { unit: target(`${at}/unit`) }));
  const zone = blueprint.zones.find((candidate) => candidate.id === encounter.triggerZoneId)!;
  const ends = encounterEndStart(blueprint, encounter);
  const start: Pick<Trigger, "events" | "conditions"> = deathPoint
    ? { events: [] }
    : encounter.startsWhen
    ? {
        events: [anchorEvent(blueprint, encounter.startsWhen, `${path}/starts`)],
        // Captured is the unit become player 1's, as an objective's anchorCaptured reads it.
        ...(encounter.startsWhen.type === "anchorCaptured"
          ? {
              conditions: [
                call(`${path}/starts/condition`, F.comparison, {
                  left: { kind: "call", call: call(`${path}/starts/condition/owner`, F.unitOwner, { unit: unitValueOf(blueprint, encounter.startsWhen.anchorId) }) },
                  operator: { kind: "preset", preset: P.compareEqual },
                  right: { kind: "int", value: USER_PLAYER },
                }),
              ],
            }
          : {}),
      }
    : {
        events: [
          call(`${path}/event`, F.unitEntersRegion, {
            unit: { kind: "preset", preset: P.anyUnit },
            state: { kind: "preset", preset: P.regionEnters },
            region: { kind: "region", regionId: regionIdForZone(blueprint.zones, zone.id) },
          }),
        ],
        conditions: [
          call(`${path}/condition`, F.comparison, {
            left: { kind: "call", call: call(`${path}/condition/owner`, F.unitOwner, { unit: triggeringUnit(`${path}/condition/owner/unit`) }) },
            operator: { kind: "preset", preset: P.compareEqual },
            right: { kind: "int", value: player },
          }),
        ],
      };
  return {
    ...encounterRef(blueprint, encounter),
    ...(encounter.fromBeat === undefined ? {} : { initiallyOff: true }),
    ...start,
    actions: [
      call(`${path}/disable`, F.triggerEnable, {
        trigger: { kind: "call", call: call(`${path}/disable/trigger`, F.currentTrigger, {}) },
        state: { kind: "preset", preset: P.triggerOff },
      }),
      ...encounter.attackerAnchorIds.map((anchorId) => {
        const orderPath = `${path}/attack/${anchorId}`;
        return call(orderPath, F.unitIssueOrder, {
          unit: unitValueOf(blueprint, anchorId),
          order: {
            kind: "call",
            call: call(`${orderPath}/order`, F.orderTargetingPoint, {
              point: point(`${orderPath}/order/point`),
              abilityCommand: { kind: "abilcmd", ability: "attack", target: "point" },
            }),
          },
          queue: { kind: "preset", preset: P.orderQueueReplace },
        });
      }),
      // Its declared end set going (cue-triggers.ts) before scenes that wait, and an end that comes at once after them.
      ...ends.before,
      ...scenes((cue) => cue.type === "encounter" && cue.encounterId === encounter.id),
      ...ends.after,
    ],
  };
}

/**
 * The actions for a cue: run each matching transition's trigger (not waited on, so a pulse's hold
 * doesn't hold up the dialogue), then every scene whose cue matches, in screenplay order: inline
 * scenes, then script scenes.
 */
type SceneActions = (matches: (cue: Cue) => boolean, outro?: { readonly at: string }) => TriggerCall[];

/**
 * A cue's actions for a Beat's trigger: `inline`, its transitions, delayed entries and every scene
 * up to its last Cinematic or trigger scene, played in the trigger; `lines`, the Transmissions after
 * that, in cue order, played on a thread of their own so they hold up nothing after them.
 */
type BeatScenes = (matches: (cue: Cue) => boolean) => { readonly inline: TriggerCall[]; readonly lines: TriggerCall[] };

/** Holds the Mission's clocks for a run of scenes, and lets them go once its last scene has handed back (H4). */
type ClockHold = { readonly hold: (path: string) => TriggerCall; readonly release: (path: string) => TriggerCall };

function sceneActionsFor(
  blueprint: MissionBlueprint,
  script: Script | undefined,
  cinematics: ReadonlyMap<number, CinematicPlayback>,
  triggerScenes: ReadonlyMap<number, TriggerScenePlayback> = new Map(),
  clocks?: ClockHold,
  hold?: TransmissionHold,
  moment?: MomentLines,
): {
  readonly scenes: SceneActions;
  readonly beatScenes: BeatScenes;
  readonly triggers: readonly Trigger[];
  /** Each trigger's script scene, by number. */
  readonly sceneOf: ReadonlyMap<Trigger, number>;
  readonly variables: readonly TriggerVariable[];
  readonly staged: StagedWait;
} {
  const reference = blueprint.screenplay.script;
  type Cued = NonNullable<typeof reference>["cues"][number];
  // The victory outcome's outro, as the last entry of a victory condition's run, its element ids under `at`.
  type OutroEntry = { readonly scene: typeof OUTCOME_OUTRO; readonly at: string };
  type Entry = Cued | OutroEntry;
  const isOutro = (entry: Entry): entry is OutroEntry => "at" in entry;
  // Held while a cue's script scene plays its Transmissions, so a scene another cue starts waits for the whole of it.
  const transmissionsPlaying = triggerVariable("script/variables/transmissions_playing", "script_transmissions_playing", "bool", { kind: "bool", value: false });
  // A Cinematic or trigger scene that can hand on (buildMissionTriggers' chains), straight before a
  // trigger scene on its cue, hands on to it and shares its skip (ADR 0012). Both sides read this one test.
  // An entry after another plays apart (behind), so it hands on to nothing and isn't handed on to.
  const behindAnother = (entry: Entry | undefined): boolean => entry !== undefined && !isOutro(entry) && entry.after !== undefined;
  const handingOn = (entry: Entry | undefined, next: Entry | undefined): { readonly handOn: (path: string) => TriggerCall; readonly as: HandedOn } | undefined => {
    if (!entry || !triggerScenes.has(next?.scene ?? -1) || behindAnother(entry) || behindAnother(next)) return undefined;
    const cinematic = cinematics.get(entry.scene);
    if (cinematic?.handOn && cinematic.completed) return { handOn: cinematic.handOn, as: { completed: cinematic.completed, musicPaused: { kind: "bool", value: true }, cameraSaved: false } };
    const triggerScene = triggerScenes.get(entry.scene);
    if (triggerScene?.handOn && triggerScene.handsOnAs) return { handOn: triggerScene.handOn, as: triggerScene.handsOnAs };
    return undefined;
  };
  // The Beats that start as an entry's scene, part or line plays (a scenePlays start), each run
  // without waiting and only while its trigger is on: the first entry of it to play starts it, and
  // Beats only move forward.
  const startsBeats = (entry: Cued, at: string): TriggerCall[] =>
    beatsStartingAt(blueprint, playsEntry(entry), (beat) => `${at}/${partPath(entry)}starts/${beat.id}/${cuePath(entry.cue)}`);
  // One script cue entry's scene: its Cinematic, its trigger scene, or its Transmissions, with element ids under `prefix`.
  // The Beats that start on it start as it does: as its Cinematic or trigger scene starts, or once
  // its Transmissions have their turn.
  const entryActions = (entry: Entry, before: Entry | undefined, after: Entry | undefined, prefix = ""): TriggerCall[] => {
    if (isOutro(entry)) {
      const handedOn = handingOn(before, entry);
      return triggerScenes.get(OUTCOME_OUTRO)!.run(entry.at, handedOn ? { after: handedOn.as } : {});
    }
    const { cue, scene: number } = entry;
    const cinematic = cinematics.get(number);
    const triggerScene = triggerScenes.get(number);
    const at = `${prefix}script/scenes/${number}`;
    const starts = startsBeats(entry, at);
    const handOn = handingOn(entry, after);
    const handsOn = handOn ? [handOn.handOn(`${at}/handOn/${cuePath(cue)}`)] : [];
    if (cinematic) return [...starts, ...handsOn, cinematic.run(`${at}/cinematic/${cuePath(cue)}`)];
    const handedOn = handingOn(before, entry);
    const cueUnit = cueUnitOf(blueprint, cue);
    if (triggerScene) return [...starts, ...handsOn, ...triggerScene.run(`${at}/triggerScene/${cuePath(cue)}`, { ...(handedOn ? { after: handedOn.as } : {}), ...(cueUnit ? { cueUnit } : {}) })];
    // Queued behind another cue's scene, and any transmission already playing, so it cuts nothing off.
    const queue = `${at}/${partPath(entry)}queue/${cuePath(cue)}`;
    // A line's Transmission is under its line and cue, so the same line on other cues, or its whole
    // scene's, keeps apart.
    const lines = entry.line === undefined ? prefix : `${at}/${partPath(entry)}${cuePath(cue)}/`;
    const plays = [...starts, ...scriptSceneTransmissions(blueprint, script!, reference!.speakerAnchors, number, lines, entry, hold, moment)];
    if (!entry.skipIfLate) return [...queueTransmissions(queue, transmissionsPlaying), ...plays, releaseTransmissions(queue, transmissionsPlaying)];
    // Dropped before its turn, it doesn't queue at all; dropped while it queues, it lets the queue go.
    const begin = `${at}/${partPath(entry)}begin/${cuePath(cue)}`;
    return [ifThen(`${begin}/queue`, unsettled(`${begin}/queue/unsettled`, entry), [...queueTransmissions(queue, transmissionsPlaying), settle(begin, entry, plays), releaseTransmissions(queue, transmissionsPlaying)])];
  };
  // A run of Cinematics and trigger scenes back to back on a cue holds the clocks from before its
  // first until its last has handed back (H4); Transmissions between them end the run.
  const staged = (entry: Entry | undefined): boolean => entry !== undefined && (cinematics.has(entry.scene) || triggerScenes.has(entry.scene));
  // A Beat that starts on a Cinematic or trigger scene starts as it plays, but what it starts (its
  // explores, Beat actions, cued scenes and pings) waits for the run to hand back: each run of them
  // holds "staged playing" from its start until its last scene has handed back, once some Beat waits on it.
  const stagedBeats = new Set(blueprint.beats.filter((beat) => (reference?.cues ?? []).some((entry) => staged(entry) && startsOnEntry(beat, entry))).map((beat) => beat.id));
  const stagedPlaying = stagedBeats.size > 0 ? triggerVariable("script/variables/staged_playing", "script_staged_playing", "bool", { kind: "bool", value: false }) : undefined;
  const markStaged = (path: string, value: boolean): TriggerCall[] =>
    stagedPlaying ? [call(path, F.setVariable, { variable: { kind: "variable", variable: stagedPlaying }, value: { kind: "bool", value } })] : [];
  const held = (entry: Entry, before: Entry | undefined, after: Entry | undefined, prefix = ""): TriggerCall[] => {
    const actions = entryActions(entry, before, after, prefix);
    if (!staged(entry)) return actions;
    const at = isOutro(entry) ? `${entry.at}/clocks` : `${prefix}script/scenes/${entry.scene}/clocks/${cuePath(entry.cue)}`;
    const stagedAt = isOutro(entry) ? `${entry.at}/staged` : `${prefix}script/scenes/${entry.scene}/staged/${cuePath(entry.cue)}`;
    const first = !staged(before);
    const last = !staged(after);
    return [
      ...(first ? markStaged(`${stagedAt}/begin`, true) : []),
      ...(first && clocks ? [clocks.hold(`${at}/hold`)] : []),
      ...actions,
      ...(last && clocks ? [clocks.release(`${at}/release`)] : []),
      ...(last ? markStaged(`${stagedAt}/end`, false) : []),
    ];
  };
  // What a Beat in `stagedBeats` runs before what it starts: a wait for the run that started it.
  const awaitStaged = (path: string): TriggerCall[] =>
    stagedPlaying ? [waitUntil(path, compare(`${path}/done`, { kind: "variable", variable: stagedPlaying }, P.compareEqual, { kind: "bool", value: false }))] : [];
  // A cue entry with afterSeconds plays from a trigger of its own, run without waiting, so the delay
  // holds up nothing else. Named by its scene, cue and delay, so other cues coming and going leave it be.
  // A part's (`from`) is named by its stage direction too, and a line's by its sound ID, so the
  // scene's other parts and lines are apart.
  // One after another is named by the entry it plays behind too.
  const behindPiece = (after: ScenePart): string => `scene/${after.scene}/${partPath(canonical(after))}`.replace(/\/$/, "");
  const delayedPath = (entry: Cued): string =>
    `script/scenes/${entry.scene}/${partPath(entry)}delayed/${cuePath(entry.cue)}/${entry.afterSeconds}${entry.after ? `/behind/${behindPiece(entry.after)}` : ""}`;
  const cueWords = (cue: Cue): string => titleWords(cuePath(cue), /[/_-]+/);
  const delayedRef = (entry: Cued): TriggerRef => ({
    id: stableElementId(delayedPath(entry)),
    name: `Script ${scenePlayedName(entry)} After ${cueWords(entry.cue)} ${String(entry.afterSeconds).replace(".", "_")}s${entry.after ? ` Behind ${scenePlayedName(canonical(entry.after))}` : ""}`,
  });
  // A trigger run without waiting that plays `actions` once, however often it's run: its `once` flag
  // is set first, so a cue firing again (within a delay, or after) doesn't play its scenes again.
  const onceTrigger = (ref: TriggerRef, path: string, once: TriggerVariable, actions: readonly TriggerCall[]): Trigger => ({
    ...ref,
    events: [],
    conditions: [call(`${path}/once`, F.comparison, { left: { kind: "variable", variable: once }, operator: { kind: "preset", preset: P.compareEqual }, right: { kind: "bool", value: false } })],
    actions: [call(`${path}/played`, F.setVariable, { variable: { kind: "variable", variable: once }, value: { kind: "bool", value: true } }), ...actions],
  });
  // A scene, part or line a scenePlayed cue names has "Script Scene <n> [<part or line>] Played", run
  // without waiting once a cue entry of it has played, which plays that cue's scenes, once. A part is
  // named by one spelling of its stage direction (S07>4 for S7>4 too), so either spelling waits on it.
  const canonical = (part: ScenePart): ScenePart => (part.from === undefined ? part : { ...part, from: canonicalAddress(part.from) });
  const playedPath = (part: ScenePart): string => `script/scenes/${part.scene}/${partPath(canonical(part))}played`;
  // An entry's `after` waits on its named entry's Played trigger too, for the mark it sets.
  const playedCues = new Map<string, ScenePart>([
    ...blueprintCues(blueprint).flatMap(({ cue }) => (cue.type === "scenePlayed" ? [[scenePlayedKey(cue), cue] as const] : [])),
    ...(reference?.cues ?? []).flatMap(({ after }) => (after ? [[scenePlayedKey(after), after] as const] : [])),
  ]);
  const playedRef = (part: ScenePart): TriggerRef => ({ id: stableElementId(playedPath(part)), name: `Script ${scenePlayedName(canonical(part))} Played` });
  const playedOnce = new Map([...playedCues].map(([key, cue]) => [key, triggerVariable(`${playedPath(cue)}/variables/played`, playedPath(cue).replace(/[^A-Za-z0-9]+/g, "_"), "bool", { kind: "bool", value: false })]));
  // What an entry's trigger runs once it has played: its scene's Played trigger, if a cue waits on it.
  const firePlayed = (entry: Cued, prefix = ""): TriggerCall[] =>
    playedCues.has(scenePlayedKey(entry))
      ? [
          call(`${prefix}${playedPath(entry)}/run/${cuePath(entry.cue)}`, F.triggerExecute, {
            checkConditions: { kind: "preset", preset: P.checkConditions },
            wait: { kind: "preset", preset: P.dontWait },
            trigger: { kind: "trigger", trigger: playedRef(entry) },
          }),
        ]
      : [];
  // A cue entry `after` another waits on its thread until that entry has played: at once if it has.
  const awaitAfter = (entry: Cued, path: string): TriggerCall[] => (entry.after ? [waitUntil(path, afterPlayed(`${path}/done`, entry.after))] : []);
  const afterPlayed = (path: string, after: ScenePart): TriggerCall => compare(path, { kind: "variable", variable: playedOnce.get(scenePlayedKey(after))! }, P.compareEqual, { kind: "bool", value: true });
  // An entry with skipIfLate settles once, as it begins or as it's dropped, whichever comes first:
  // it plays its lines, at its turn, only if nothing has dropped it. Galaxy's threads run until they
  // wait, so each test and its setting are one step, on the thread that settles it. The check refuses
  // one on a Cinematic or trigger scene, and one on a scene, part or line several entries play, so
  // its key names one entry.
  const droppable = (reference?.cues ?? []).filter((entry) => entry.skipIfLate && !staged(entry));
  const droppedPath = (part: ScenePart): string => `script/scenes/${part.scene}/${partPath(canonical(part))}dropped`;
  const settled = new Map(
    droppable.map((entry) => {
      const path = `script/scenes/${entry.scene}/${partPath(canonical(entry))}settled`;
      return [scenePlayedKey(entry), triggerVariable(`${path}/variables/settled`, path.replace(/[^A-Za-z0-9]+/g, "_"), "bool", { kind: "bool", value: false })] as const;
    }),
  );
  const settledFlag = (entry: ScenePart): TriggerParam["value"] => ({ kind: "variable", variable: settled.get(scenePlayedKey(entry))! });
  const unsettled = (path: string, entry: ScenePart): TriggerCall => compare(path, settledFlag(entry), P.compareEqual, { kind: "bool", value: false });
  // If the entry isn't settled yet, settle it and run `then`.
  const settle = (path: string, entry: ScenePart, then: readonly TriggerCall[]): TriggerCall =>
    ifThen(path, unsettled(`${path}/unsettled`, entry), [call(`${path}/settle`, F.setVariable, { variable: settledFlag(entry), value: { kind: "bool", value: true } }), ...then]);
  const droppedRef = (part: ScenePart): TriggerRef => ({ id: stableElementId(droppedPath(part)), name: `Script ${scenePlayedName(canonical(part))} Dropped` });
  // "Script Scene <n> [<part or line>] Dropped", run without waiting once the entry has been settled
  // unplayed: once the entry it plays after (if any) has played, it counts it as played, starting its
  // scenePlays Beats and marking it played, for the entries after it and the scenePlayed cues on it.
  // Each trigger here's script scene, by number, set as it's made.
  const sceneOf = new Map<Trigger, number>();
  const ofScene = (scene: number, trigger: Trigger): Trigger => {
    sceneOf.set(trigger, scene);
    return trigger;
  };
  const dropped: Trigger[] = droppable.map((entry) => {
    const path = droppedPath(entry);
    return ofScene(entry.scene, { ...droppedRef(entry), events: [], conditions: [], actions: [...awaitAfter(entry, `${path}/after`), ...startsBeats(entry, path), ...firePlayed(entry, `${path}/`)] });
  });
  // What an entry `after` another runs as it reaches its cue (after its delay), on its own thread:
  // each entry with skipIfLate it plays after, directly or down a chain of `after`s, not settled
  // yet (begun or dropped), is settled there and then, and its Dropped trigger run.
  const dropsLate = (entry: Cued, path: string): TriggerCall[] => {
    const reached = new Set<string>(entry.after ? [scenePlayedKey(entry.after)] : []);
    for (const key of reached) {
      for (const candidate of reference?.cues ?? []) if (candidate.after && scenePlayedKey(candidate) === key) reached.add(scenePlayedKey(candidate.after));
    }
    return droppable
      .filter((late) => reached.has(scenePlayedKey(late)))
      .map((late) => {
        const at = `${path}/drops/${behindPiece(late)}`;
        return settle(at, late, [runTrigger(`${at}/run`, droppedRef(late))]);
      });
  };
  // An undelayed cue entry `after` another plays from a trigger of its own, so its wait holds up
  // nothing else on its cue. Its cue runs it in its place, waiting for it if the entry it plays
  // after has played (so it plays as any entry there would), else without waiting; or plays it in
  // place itself, with no wait at all, when it has played that entry earlier (runBehind).
  const behindEntries = reference && script ? reference.cues.filter((entry) => entry.after !== undefined && entry.afterSeconds === undefined) : [];
  const behindPath = (entry: Cued): string => `script/scenes/${entry.scene}/${partPath(entry)}behind/${cuePath(entry.cue)}/${behindPiece(entry.after!)}`;
  const behindRef = (entry: Cued): TriggerRef => ({
    id: stableElementId(behindPath(entry)),
    name: `Script ${scenePlayedName(entry)} On ${cueWords(entry.cue)} Behind ${scenePlayedName(canonical(entry.after!))}`,
  });
  const behindOnce = new Map(behindEntries.map((entry) => [entry, triggerVariable(`${behindPath(entry)}/variables/played`, `${behindPath(entry).replace(/[^A-Za-z0-9]+/g, "_")}_played`, "bool", { kind: "bool", value: false })]));
  // What it plays, with element ids under `prefix`, then its Played mark.
  const playsBehind = (entry: Cued, prefix: string): TriggerCall[] => [...held(entry, undefined, undefined, prefix), ...firePlayed(entry, prefix)];
  const behind: Trigger[] = behindEntries.map((entry) => {
    const path = behindPath(entry);
    return ofScene(entry.scene, onceTrigger(behindRef(entry), path, behindOnce.get(entry)!, [...awaitAfter(entry, `${path}/wait`), ...playsBehind(entry, `${path}/`)]));
  });
  // `before` is what its cue plays before it: an entry there of the scene it plays after, not
  // itself after another, has played by then, on this thread. That entry's Played trigger, run
  // without waiting, may not have set its mark yet, so the entry plays in place on this thread,
  // once (its trigger's `once` flag), with no test of the mark and no wait for it.
  const runBehind = (entry: Cued, before: readonly Entry[]): TriggerCall[] => [...dropsLate(entry, behindPath(entry)), playBehind(entry, before)];
  const playBehind = (entry: Cued, before: readonly Entry[]): TriggerCall => {
    const path = `${behindPath(entry)}/run`;
    const run = (at: string, wait: boolean): TriggerCall => runTrigger(at, behindRef(entry), { wait });
    if (before.some((earlier) => !isOutro(earlier) && !earlier.after && scenePlayedKey(earlier) === scenePlayedKey(entry.after!))) {
      const once: TriggerParam["value"] = { kind: "variable", variable: behindOnce.get(entry)! };
      const at = `${path}/now`;
      return ifThen(at, compare(`${at}/once`, once, P.compareEqual, { kind: "bool", value: false }), [
        call(`${at}/played`, F.setVariable, { variable: once, value: { kind: "bool", value: true } }),
        ...playsBehind(entry, `${at}/`),
      ]);
    }
    return block(path, F.ifThenElse, {}, [
      { type: SUB_FUNCTIONS.if, calls: [afterPlayed(`${path}/if`, entry.after!)] },
      { type: SUB_FUNCTIONS.then, calls: [run(`${path}/now`, true)] },
      { type: SUB_FUNCTIONS.else, calls: [run(`${path}/later`, false)] },
    ]);
  };
  const delayedEntries = reference && script ? reference.cues.filter((entry) => entry.afterSeconds !== undefined) : [];
  const played = new Map(delayedEntries.map((entry) => [entry, triggerVariable(`${delayedPath(entry)}/variables/played`, `${delayedPath(entry).replace(/[^A-Za-z0-9]+/g, "_")}_played`, "bool", { kind: "bool", value: false })]));
  const delayed: Trigger[] = delayedEntries.map((entry) => {
    const path = delayedPath(entry);
    return ofScene(entry.scene, onceTrigger(delayedRef(entry), path, played.get(entry)!, [
      // AI time, which a scene pauses while it plays (Cinematic Mode alone doesn't), so the delay counts play.
      wait(`${path}/wait`, entry.afterSeconds!, P.timeAI),
      ...dropsLate(entry, path),
      ...awaitAfter(entry, `${path}/after`),
      ...held(entry, undefined, undefined, `${path}/`),
      ...firePlayed(entry, `${path}/`),
    ]));
  });
  const undelayed = (matches: (cue: Cue) => boolean): Cued[] => (reference && script ? reference.cues.filter((entry) => matches(entry.cue) && entry.afterSeconds === undefined) : []);
  // What a cue plays, in order: its transitions' triggers (run without waiting), its inline scenes'
  // Transmissions, its delayed entries' triggers (run without waiting), then each undelayed script
  // entry's actions, with the index of the last entry with a Cinematic or trigger scene (-1 for none).
  const cueParts = (matches: (cue: Cue) => boolean, outro?: { readonly at: string }) => {
    const transitions = blueprint.transitions
      .filter((transition) => matches(transition.cue))
      .map((transition) => {
        const path = transitionPath(transition);
        return runTrigger(`${path}/run/${cuePath(transition.cue)}`, { id: stableElementId(path), name: transitionName(transition) });
      })
      // Then its UI Components' actions, each its own trigger, also run without waiting.
      .concat(blueprint.uiActions.filter((action) => matches(action.cue)).map((action) => runTrigger(`${uiActionPath(action)}/run/${cuePath(action.cue)}`, uiActionRef(action))));
    const delays = (reference && script ? delayedEntries.filter((entry) => matches(entry.cue)) : []).map((entry) => runTrigger(`${delayedPath(entry)}/run`, delayedRef(entry)));
    // Each line in play, so with a hero moment it holds moments off while it plays (#656).
    const inline = blueprint.screenplay.scenes
      .filter((scene) => scene.cue !== undefined && matches(scene.cue))
      .flatMap((scene) => sceneTransmissions(blueprint, scene).flatMap((send, index) => (moment ? momentLine(`scenes/${scene.id}/${scene.lines[index]!.id}`, send, moment) : [send])));
    // The rest in order: a scene with a Cinematic or a trigger scene plays it, in place of its Transmissions.
    const cued: readonly Entry[] = [...undelayed(matches), ...(outro ? [{ scene: OUTCOME_OUTRO, at: outro.at } as const] : [])];
    // An entry after another plays apart (behind), so it ends the run of scenes back to back before it.
    const near = (entry: Entry | undefined): Entry | undefined => (behindAnother(entry) ? undefined : entry);
    const entries = cued.map((entry, index) => {
      if (behindAnother(entry)) return runBehind(entry as Cued, cued.slice(0, index));
      const actions = held(entry, near(cued[index - 1]), near(cued[index + 1]));
      // A scene that hands on to the trigger scene after it hasn't handed back yet: it has
      // played once the last of its run has, with the screen the player's again. The outcome
      // outro ends the game, so a run that ends in it never has.
      if (isOutro(entry) || handingOn(entry, cued[index + 1])) return actions;
      let first = index;
      while (first > 0 && handingOn(cued[first - 1], cued[first])) first -= 1;
      return [...actions, ...cued.slice(first, index + 1).flatMap((played) => (isOutro(played) ? [] : firePlayed(played)))];
    });
    // An entry after another isn't in its cue's run, so a Beat's Lines trigger plays it if it comes after the run's last scene.
    return { transitions, inline, delays, entries, lastStaged: cued.findLastIndex((entry) => staged(entry) && !behindAnother(entry)) };
  };
  // Each Kept trigger held until a matching cue (ADR-0014), run once the cue's scenes have played, as
  // its own event or a Run Trigger would: checking its conditions, and not waited on.
  const heldRuns = (matches: (cue: Cue) => boolean): TriggerCall[] =>
    blueprint.kept.flatMap((reference) =>
      reference.hold && matches(reference.hold.until) ? [runTrigger(`kept/${reference.id}/hold/run/${cuePath(reference.hold.until)}`, keptTriggerRef(blueprint, reference.id))] : [],
    );
  const scenes: SceneActions = (matches, outro) => {
    const { transitions, inline, delays, entries } = cueParts(matches, outro);
    return [...transitions, ...inline, ...delays, ...entries.flat(), ...heldRuns(matches)];
  };
  // A Beat's cue split in two: what plays in its trigger, up to its last Cinematic or trigger
  // scene, and the Transmissions after, which its "Lines" trigger plays (beatTriggers). A held Kept
  // trigger runs after the first part.
  const beatScenes: BeatScenes = (matches) => {
    const { transitions, inline, delays, entries, lastStaged } = cueParts(matches);
    if (lastStaged < 0) return { inline: [...transitions, ...delays, ...heldRuns(matches)], lines: [...inline, ...entries.flat()] };
    return { inline: [...transitions, ...inline, ...delays, ...entries.slice(0, lastStaged + 1).flat(), ...heldRuns(matches)], lines: entries.slice(lastStaged + 1).flat() };
  };
  const playedTriggers: Trigger[] = [...playedCues].map(([key, cue]) =>
    ofScene(cue.scene, onceTrigger(playedRef(cue), playedPath(cue), playedOnce.get(key)!, scenes((candidate) => candidate.type === "scenePlayed" && scenePlayedKey(candidate) === key))),
  );
  return {
    scenes,
    beatScenes,
    triggers: [...delayed, ...behind, ...dropped, ...playedTriggers],
    sceneOf,
    variables: [
      ...played.values(),
      ...behindOnce.values(),
      ...settled.values(),
      ...playedOnce.values(),
      ...(reference && script && reference.cues.length > 0 ? [transmissionsPlaying] : []),
      ...(stagedPlaying ? [stagedPlaying] : []),
      ...(hold?.variables ?? []),
    ],
    staged: { beats: stagedBeats, wait: awaitStaged },
  };
}

/** The Beats that start on a Cinematic or trigger scene playing, and the wait each runs, once started, for that scene to hand back. */
type StagedWait = { readonly beats: ReadonlySet<string>; readonly wait: (path: string) => TriggerCall[] };

/** Whether `beat` starts as the cue entry's scene, part or line plays (a scenePlays start). */
const startsOnEntry = (beat: MissionBlueprint["beats"][number], entry: ScenePart): boolean => beat.startsWhen?.some(playsEntry(entry)) ?? false;

type BeatStartCondition = NonNullable<MissionBlueprint["beats"][number]["startsWhen"]>[number];
/** A moment a cue or a Beat's start names (a Kept trigger's run, a Mechanic's cue, a scene playing), as a test on either. */
type MomentTest = (named: Cue | BeatStartCondition) => boolean;

/** A scene, part or line playing as a cue entry plays it, as a Beat's start names it (scenePlays). */
const playsEntry = (entry: ScenePart): MomentTest => (named) => named.type === "scenePlays" && scenePlayedKey(named) === scenePlayedKey(entry);

/**
 * Starts each Beat with a start at the moment (startBeat), in Blueprint order, with element ids
 * under `path(beat)`; with `wait`, each runs to its end (its own scenes handed back) before the next.
 */
function beatsStartingAt(blueprint: MissionBlueprint, at: MomentTest, path: (beat: MissionBlueprint["beats"][number]) => string, wait = false): TriggerCall[] {
  return blueprint.beats.filter((beat) => beat.startsWhen?.some(at)).map((beat) => startBeat(path(beat), beat, wait));
}

/** What a Kept trigger's run plays and starts: the scenes cued at it, then the Beats that start on it. */
function momentActions(blueprint: MissionBlueprint, scenes: SceneActions, at: MomentTest, path: (beat: MissionBlueprint["beats"][number]) => string): TriggerCall[] {
  return [...scenes(at), ...beatsStartingAt(blueprint, at, path)];
}

/**
 * Runs a Beat's trigger, only while it is on: a later Beat has turned it off, and Beats only move
 * forward. Without waiting, unless `wait`: then the run is the Beat's whole start, its trigger
 * turning the earlier Beats off before anything in it waits, and its scenes handed back.
 */
function startBeat(path: string, beat: Pick<MissionBlueprint["beats"][number], "id" | "title">, wait = false): TriggerCall {
  const trigger = beatTriggerRef(beat);
  return ifTriggerOn(path, trigger, [
    call(`${path}/run`, F.triggerExecute, { checkConditions: { kind: "preset", preset: P.checkConditions }, wait: { kind: "preset", preset: wait ? P.wait : P.dontWait }, trigger: { kind: "trigger", trigger } }),
  ]);
}

/** What the cue at `path` (as blueprintCues gives it) plays: "scene 3", "the transition dusk", "the inline scene aside", "the held Kept trigger stealth". */
function cuedWhat(blueprint: MissionBlueprint, path: readonly (string | number)[]): string {
  if (path[0] === "kept") return `the held Kept trigger ${blueprint.kept[path[1] as number]!.id}`;
  const index = path[path.length - 2] as number;
  if (path[0] === "transitions") return `the transition ${blueprint.transitions[index]!.id}`;
  if (path[0] === "uiActions") return `the UI action ${blueprint.uiActions[index]!.id}`;
  if (path[1] === "scenes") return `the inline scene ${blueprint.screenplay.scenes[index]!.id}`;
  return `scene ${blueprint.screenplay.script!.cues[index]!.scene}`;
}

/** The Anchor a speaker talks from, matched as characters are: ignoring case and spacing ("Matt  horner" is "MATT HORNER"). */
/**
 * A script scene's lines, by scene number, as Transmissions with element ids under `prefix`; with
 * `from`, only its part from that stage direction to the next, with `line`, only that line (scene-parts.ts).
 * Given `hold`, each is an in-play line a trigger scene may cut off and have replayed (transmission-hold.ts);
 * given `moment`, each holds hero moments off while it plays.
 */
function scriptSceneTransmissions(
  blueprint: MissionBlueprint,
  script: Script,
  speakerAnchors: Readonly<Record<string, string>>,
  number: number,
  prefix = "",
  part: Omit<ScenePart, "scene"> = {},
  hold?: TransmissionHold,
  moment?: MomentLines,
): TriggerCall[] {
  const scene = script.scenes.find((candidate) => candidate.number === number);
  if (!scene) throw new Error(`Script has no scene ${number}`);
  const lines = cuedLines(scene, part);
  if (!lines) throw new Error(part.from !== undefined ? `Script scene ${number} has no stage direction ${part.from}` : `Script scene ${number} has no line ${part.line}`);
  if (!hold) {
    return lines.flatMap((line) => {
      const send = scriptTransmission(blueprint, line, bySpeaker(speakerAnchors, line.speaker), prefix);
      return moment ? momentLine(`${prefix}script/${line.lineId}`, send, moment) : [send];
    });
  }
  return lines.flatMap((line) => hold.inPlayLine(`${prefix}script/${line.lineId}/hold`, scriptTransmission(blueprint, line, bySpeaker(speakerAnchors, line.speaker), prefix, false)));
}

/**
 * A script scene's turn to play its Transmissions: it waits until no other cue's scene holds
 * `playing`, takes it, then waits for any transmission still playing (a Wave warning's, say).
 * Galaxy's threads run until they wait, so the test and the take are one step. A bare wait on the
 * last sent would wake at the end of the playing scene's first line, and cut in before its second.
 */
const queueTransmissions = (path: string, playing: TriggerVariable): TriggerCall[] => [
  waitUntil(`${path}/turn`, compare(`${path}/turn/free`, { kind: "variable", variable: playing }, P.compareEqual, { kind: "bool", value: false })),
  call(`${path}/take`, F.setVariable, { variable: { kind: "variable", variable: playing }, value: { kind: "bool", value: true } }),
  call(`${path}/playing`, F.transmissionWait, { transmission: callValue(`${path}/playing/transmission`, F.transmissionLastSent, {}), offset: { kind: "fixed", value: 0 } }),
];

/** The end of a script scene's turn: the next cue's scene may play. */
const releaseTransmissions = (path: string, playing: TriggerVariable): TriggerCall =>
  call(`${path}/release`, F.setVariable, { variable: { kind: "variable", variable: playing }, value: { kind: "bool", value: false } });


/**
 * One script line as a standard "Send Transmission For Player": the line's voice sound,
 * the speaker's name and text, lasting as long as the audio (duration type Add, 0 s), waiting
 * so a scene plays in order. The source is the speaking unit on the map (a unit Anchor by id, or a
 * unit value, such as a trigger scene's staged speaker), else the unit type or portrait model of
 * the speaker's character from the Campaign Pack.
 *
 * A campaign library's own transmission action may start a talking-portrait transmission on
 * another thread, so back-to-back lines cut each other off; core uses only the standard one.
 */
function scriptTransmission(blueprint: MissionBlueprint, line: ScriptLine, speaker: string | TriggerParam["value"] | undefined, prefix = "", waited = true): TriggerCall {
  const path = `${prefix}script/${line.lineId}`;
  // Off the map: the character's unit type or portrait model, else none.
  const offMap = (sourcePath: string): TriggerCall =>
    line.unit
      ? call(sourcePath, F.unitTypeTransmissionSource, {
          overridePortrait: { kind: "preset", preset: P.doNot },
          unitType: { kind: "gamelink", gameType: "Unit", value: line.unit },
        })
      : line.model
        ? call(sourcePath, F.modelTransmissionSource, { model: { kind: "gamelink", gameType: "Model", value: line.model } })
        : call(sourcePath, F.noTransmissionSource, {});
  // A converted Kept conversation's imported line plays its imported Sound, the only CSound it has (map/mission-conversation.ts).
  const sound = (hasKeptTerrain(blueprint) ? blueprint.screenplay.script?.conversion?.importedSounds[line.lineId] : undefined) ?? line.soundId;
  if (!speaker) return scriptLineTransmission(path, offMap(`${path}/source`), line, false, waited, sound);
  const onMap = scriptLineTransmission(path, unitSource(`${path}/source`, typeof speaker === "string" ? unitValueOf(blueprint, speaker) : speaker), line, true, waited, sound);
  // A Wave's unit speaks from the map once it's there; before, or once dead, as the character off it.
  if (typeof speaker !== "string" || !isWaveUnit(blueprint, speaker)) return onMap;
  return speakerIsThere(blueprint, `${path}/there`, speaker, [onMap], [scriptLineTransmission(`${path}/gone`, offMap(`${path}/gone/source`), line, false, waited, sound)]);
}

/** A script line as a waiting Transmission from `source`, its portrait at centre left for a speaker on the map. */
function scriptLineTransmission(path: string, source: TriggerCall, line: ScriptLine, onMap: boolean, waited: boolean, sound = line.soundId): TriggerCall {
  return call(path, F.sendTransmission, {
    players: { kind: "call", call: call(`${path}/players`, F.allPlayers, {}) },
    source: { kind: "call", call: source },
    portrait: {
      kind: "call",
      call: call(`${path}/portrait`, F.cinematicPortrait, {
        position: { kind: "preset", preset: onMap ? P.cinematicPortraitCenterLeft : P.cinematicPortraitCenterRight },
      }),
    },
    portraitActor: { kind: "string", value: "" },
    portraitAnim: { kind: "modelanim", value: "Talk" },
    sound: { kind: "soundlink", sound },
    duration: { kind: "fixed", value: 0 },
    durationType: { kind: "preset", preset: P.transmissionDurationAdd },
    wait: { kind: "preset", preset: waited ? P.wait : P.dontWait },
    player: { kind: "preset", preset: P.globalSoundPlayer },
    isSelect: { kind: "bool", value: false },
    speaker: { kind: "text", text: line.character },
    message: { kind: "text", text: line.shown },
  });
}

/** Every distinct condition the blueprint reacts to: anchor conditions in anchor order (deaths first), then timers and quotas. */
function reactiveConditions(blueprint: MissionBlueprint): OutcomeCondition[] {
  const found = new Map<string, OutcomeCondition>();
  const add = (condition: OutcomeCondition | undefined): void => {
    if (condition) found.set(conditionPath(condition), condition);
  };
  blueprint.outcomes.victory.forEach(add);
  blueprint.outcomes.defeat.forEach(add);
  blueprint.objectives.forEach((objective) => add(objective.completeWhen));
  // A Beat that starts on Objectives completing is started by that condition's trigger.
  for (const beat of blueprint.beats) for (const condition of beat.startsWhen ?? []) if (condition.type === "objectivesComplete") add(condition);
  // Every cued element's cue, from the one list of them, so a newly cued element can't be missed.
  for (const { cue } of blueprintCues(blueprint)) {
    if (isConditionCue(cue)) add(cue);
  }
  const anchorIndex = (id: string): number => blueprint.anchors.findIndex((anchor) => anchor.id === id);
  const all = [...found.values()];
  const onAnchors = all.filter((condition): condition is AnchorCondition => "anchorId" in condition);
  onAnchors.sort(
    (a, b) => anchorIndex(a.anchorId) - anchorIndex(b.anchorId) || (a.type === "anchorDies" ? -1 : 1) - (b.type === "anchorDies" ? -1 : 1),
  );
  return [...onAnchors, ...all.filter((condition) => !("anchorId" in condition))];
}

type TimerCondition = Extract<OutcomeCondition, { type: "timer" }>;

const CLOCKS_HOLD: TriggerRef = { id: stableElementId("clocks/hold"), name: "Clocks Hold" };
const CLOCKS_RELEASE: TriggerRef = { id: stableElementId("clocks/release"), name: "Clocks Release" };
/** Runs "Clocks Hold" and "Clocks Release", and records whether any cue did, so a Mission whose scenes never hold them gets neither. */
function clockHold(): ClockHold & { readonly used: () => boolean } {
  let used = false;
  const run = (trigger: TriggerRef) => (path: string): TriggerCall => {
    used = true;
    return call(path, F.triggerExecute, { checkConditions: { kind: "preset", preset: P.checkConditions }, wait: { kind: "preset", preset: P.wait }, trigger: { kind: "trigger", trigger } });
  };
  return { hold: run(CLOCKS_HOLD), release: run(CLOCKS_RELEASE), used: () => used };
}

/** A clock's `held` flag: whether a hold paused it, or holds it for its owner (ownedClocks). */
const clockHeld = (clock: TriggerVariable): TriggerVariable => triggerVariable(`clocks/${clock.name}/held`, `clocks_${clock.name}_held`, "bool", { kind: "bool", value: false });
const clockTimer = (clock: TriggerVariable): TriggerParam["value"] => ({ kind: "variable", variable: clock });
const FALSE: TriggerParam["value"] = { kind: "bool", value: false };
const TRUE: TriggerParam["value"] = { kind: "bool", value: true };
/** Pause Timer or Unpause Timer on a clock. */
const pauseClock = (at: string, clock: TriggerVariable, paused: boolean): TriggerCall =>
  call(at, F.timerPause, { timer: clockTimer(clock), pause: { kind: "preset", preset: paused ? P.pause : P.unpause } });
/** Sets a bool flag. */
const markFlag = (at: string, flag: TriggerVariable, value: boolean): TriggerCall => call(at, F.setVariable, { variable: { kind: "variable", variable: flag }, value: { kind: "bool", value } });

/**
 * The clocks a Mechanic starts or pauses through core (MechanicTriggerContext.startClock and
 * pauseClock), each with a `paused` flag its owner sets, and its `held` flag, which the owner's
 * calls read whether or not any scene holds the clocks: so both are declared for it either way.
 * A hold holds such a clock whatever its state (clockTriggers), so `held` says a hold is in force.
 */
function ownedClocks() {
  const flags = new Map<TriggerVariable, { readonly paused: TriggerVariable; readonly held: TriggerVariable }>();
  const of = (clock: TriggerVariable) => {
    let found = flags.get(clock);
    if (!found) flags.set(clock, (found = { paused: triggerVariable(`clocks/${clock.name}/paused`, `clocks_${clock.name}_paused`, "bool", { kind: "bool", value: false }), held: clockHeld(clock) }));
    return found;
  };
  /**
   * Its owner pausing: paused, flagged so a release leaves it. Unpausing: unflagged, and unpaused
   * unless a hold has it, whose release unpauses it.
   */
  const pause = (path: string, clock: TriggerVariable, paused: boolean): TriggerCall[] => {
    const { paused: flag, held } = of(clock);
    if (paused) return [markFlag(`${path}/flag`, flag, true), pauseClock(`${path}/pause`, clock, true)];
    return [markFlag(`${path}/flag`, flag, false), ifThen(`${path}/unheld`, compare(`${path}/unheld/if`, { kind: "variable", variable: held }, P.compareEqual, FALSE), [pauseClock(`${path}/unpause`, clock, false)])];
  };
  /** Its owner starting it: one-shot, in game time, no longer paused by its owner, and paused at once if a hold is in force, whose release starts it running. */
  const start = (path: string, clock: TriggerVariable, seconds: number): TriggerCall[] => {
    const { held, paused } = of(clock);
    return [
      // A start is no longer a pause of its owner's, or a release would leave it paused.
      markFlag(`${path}/unpaused`, paused, false),
      call(`${path}/start`, F.timerStart, {
        duration: { kind: "fixed", value: seconds },
        repeating: { kind: "preset", preset: P.timerOneShot },
        timeType: { kind: "preset", preset: P.timeGame },
        timer: clockTimer(clock),
      }),
      ifThen(`${path}/held`, compare(`${path}/held/if`, { kind: "variable", variable: held }, P.compareEqual, TRUE), [pauseClock(`${path}/held/pause`, clock, true)]),
    ];
  };
  return { pause, start, flags: (clock: TriggerVariable) => flags.get(clock), variables: () => [...flags.values()].flatMap(({ paused, held }) => [paused, held]) };
}
type OwnedClocks = ReturnType<typeof ownedClocks>;

/**
 * "Clocks Hold" pauses each clock (the goal timers, and the timers the Mechanics declare) not paused
 * already, and "Clocks Release" unpauses just those, so a clock the mission paused itself stays
 * paused (H4). Each clock's `held` records which. A clock its owner starts or pauses through core
 * (ownedClocks) is held whatever its state, and a release unpauses it unless its owner has paused it.
 */
function clockTriggers(clocks: readonly TriggerVariable[], counted = false, owned?: OwnedClocks): { readonly triggers: readonly Trigger[]; readonly variables: readonly TriggerVariable[] } {
  const held = new Map(clocks.map((clock) => [clock, owned?.flags(clock)?.held ?? clockHeld(clock)]));
  const each = (step: string, build: (clock: TriggerVariable, at: string, flag: TriggerVariable) => TriggerCall | TriggerCall[]): TriggerCall[] =>
    clocks.flatMap((clock) => build(clock, `clocks/${step}/${clock.name}`, held.get(clock)!));
  const holds = each("hold", (clock, at, flag) => {
    // Its owner's: held as it is, paused or not, so its owner knows a hold is in force.
    if (owned?.flags(clock)) return [pauseClock(`${at}/pause`, clock, true), markFlag(`${at}/held`, flag, true)];
    return block(at, F.ifThenElse, {}, [
      { type: SUB_FUNCTIONS.if, calls: [compare(`${at}/if`, callValue(`${at}/if/paused`, F.timerIsPaused, { timer: clockTimer(clock) }), P.compareEqual, FALSE)] },
      { type: SUB_FUNCTIONS.then, calls: [pauseClock(`${at}/pause`, clock, true), markFlag(`${at}/held`, flag, true)] },
    ]);
  });
  const releases = each("release", (clock, at, flag) => {
    const ownerPaused = owned?.flags(clock)?.paused;
    const unpause = pauseClock(`${at}/unpause`, clock, false);
    return block(at, F.ifThenElse, {}, [
      { type: SUB_FUNCTIONS.if, calls: [compare(`${at}/if`, { kind: "variable", variable: flag }, P.compareEqual, TRUE)] },
      {
        type: SUB_FUNCTIONS.then,
        calls: ownerPaused
          ? [markFlag(`${at}/held`, flag, false), ifThen(`${at}/unowned`, compare(`${at}/unowned/if`, { kind: "variable", variable: ownerPaused }, P.compareEqual, FALSE), [unpause])]
          : [unpause, markFlag(`${at}/held`, flag, false)],
      },
    ]);
  });
  // Counted, when a hero moment holds them too (#656): a moment and a run of scenes may overlap, and
  // the clocks are paused at the first hold and let go at the last release, whichever's they are.
  const holders = counted ? triggerVariable("clocks/variables/holders", "clocks_holders", "int", { kind: "int", value: 0 }) : undefined;
  const count = (at: string, operator: PresetDef): TriggerCall =>
    call(at, F.setVariable, {
      variable: { kind: "variable", variable: holders! },
      value: callValue(`${at}/value`, F.arithmeticInt, { left: { kind: "variable", variable: holders! }, operator: { kind: "preset", preset: operator }, right: { kind: "int", value: 1 } }),
    });
  const holdersAre = (at: string, value: number): TriggerCall => compare(at, { kind: "variable", variable: holders! }, P.compareEqual, { kind: "int", value });
  return {
    triggers: [
      { ...CLOCKS_HOLD, events: [], actions: holders ? [ifThen("clocks/hold/first", holdersAre("clocks/hold/first/if", 0), holds), count("clocks/hold/count", P.plus)] : holds },
      {
        ...CLOCKS_RELEASE,
        events: [],
        actions: holders
          ? [ifThen("clocks/release/held", compare("clocks/release/held/if", { kind: "variable", variable: holders }, P.compareAtLeast, { kind: "int", value: 1 }), [count("clocks/release/count", P.minus), ifThen("clocks/release/last", holdersAre("clocks/release/last/if", 0), releases)])]
          : releases,
      },
    ],
    // An owned clock's flags are declared with its owner's (ownedClocks), held or not.
    variables: [...[...held.entries()].filter(([clock]) => !owned?.flags(clock)).map(([, flag]) => flag), ...(holders ? [holders] : [])],
  };
}

const MOMENT_CLOCKS: TriggerRef = { id: stableElementId("clocks/heroMoment"), name: "Clocks Hero Moment" };

/**
 * "Clocks Hero Moment" (map init): from the start, holds the clocks while each hero moment plays,
 * as Hero Moment Is Playing says, polling in game time, which runs on through a moment.
 */
function momentClocksTrigger(moment: MissionHeroMoment, clocks: ClockHold): Trigger {
  const path = "clocks/heroMoment/loop";
  const playing = (at: string, value: boolean): TriggerCall => compare(at, callValue(`${at}/playing`, moment.isPlaying, {}), P.compareEqual, { kind: "bool", value });
  return {
    ...MOMENT_CLOCKS,
    events: [{ id: stableElementId("clocks/heroMoment/event"), def: F.mapInit, params: {} }],
    actions: [
      block(path, F.whileLoop, {}, [
        { type: SUB_FUNCTIONS.whileConditions, calls: [compare(`${path}/always`, { kind: "bool", value: true }, P.compareEqual, { kind: "bool", value: true })] },
        {
          type: SUB_FUNCTIONS.whileActions,
          calls: [
            waitUntil(`${path}/begins`, playing(`${path}/begins/if`, true)),
            clocks.hold(`${path}/hold`),
            waitUntil(`${path}/ends`, playing(`${path}/ends/if`, false)),
            clocks.release(`${path}/release`),
          ],
        },
      ]),
    ],
  };
}

/** One countdown per distinct timer condition, started (with its window) at mission start. */
function goalTimerVariable(condition: TimerCondition): TriggerVariable {
  const path = conditionPath(condition);
  return {
    id: stableElementId(`${path}/timer`),
    name: `goal_timer_${String(condition.seconds).replace(".", "_")}`,
    type: "timer",
    initial: {
      id: stableElementId(`${path}/timer/initial`),
      value: { kind: "call", call: call(`${path}/timer/initial/call`, F.newTimer, {}) },
    },
  };
}

/** Game seconds between a unit's death and the victory/defeat screen it causes. */
const DEATH_PAUSE_SECONDS = 3;

/** Set Lighting for all players, blending over `blendSeconds`. */
export const setLighting = (callPath: string, light: string, blendSeconds: number): TriggerCall =>
  call(callPath, F.setLighting, {
    blendTime: { kind: "fixed", value: blendSeconds },
    light: { kind: "gamelink", gameType: "Light", value: light },
  });


const transitionPath = (transition: Transition): string => `transitions/${transition.id}`;
const transitionName = (transition: Transition): string => `Transition ${titleWords(transition.id)}`;

const uiActionPath = (action: UiAction): string => `ui-actions/${action.id}`;
const uiActionRef = (action: UiAction): TriggerRef => ({ id: stableElementId(uiActionPath(action)), name: `UI ${titleWords(action.id)}` });

/**
 * A UI Component's action (ADR-0019), run by its cue's trigger: wait `afterSeconds`, then call the
 * component's function in the Campaign Mod's library, which must have the component on.
 */
function uiActionTrigger(blueprint: MissionBlueprint, action: UiAction, index: number, library: CampaignLibrary): Trigger {
  const path = uiActionPath(action);
  const at = `uiActions.${index} (${action.id})`;
  let made: ReturnType<typeof uiCall>;
  try {
    made = uiCall(library, blueprint, action.action, action.params);
  } catch (error) {
    throw new Error(`${at}: ${(error as Error).message}`, { cause: error });
  }
  return {
    ...uiActionRef(action),
    events: [],
    actions: [...(action.afterSeconds !== undefined ? [wait(`${path}/after`, action.afterSeconds)] : []), call(`${path}/call`, made.def, made.args)],
  };
}

/**
 * A transition (DL-09), run by its cue's trigger: wait `afterSeconds`, change the light (a cut or
 * a drift), and for a pulse, wait and blend back to `back.to` or the mission's light.
 */
function transitionTrigger(blueprint: MissionBlueprint, transition: Transition): Trigger {
  const path = transitionPath(transition);
  const { light, water } = transition;
  const pool = water && blueprint.water.find((candidate) => candidate.id === water.poolId);
  return {
    id: stableElementId(path),
    name: transitionName(transition),
    events: [],
    actions: [
      ...(transition.afterSeconds !== undefined ? [wait(`${path}/after`, transition.afterSeconds)] : []),
      // Shown only in Test Document, as a Beat's start is: what changes, to check a transition fires when it should.
      debugMessage(`${path}/debug`, transitionDebugText(transition)),
      // The water moves over its seconds without holding up the light.
      ...(water && pool
        ? [
            call(`${path}/water`, F.setWaterState, {
              duration: { kind: "fixed", value: water.seconds },
              curve: { kind: "preset", preset: P.waterCurveLinear },
              water: { kind: "water", value: poolStateValue(pool, water.state) },
            }),
          ]
        : []),
      ...(light ? [setLighting(`${path}/light`, light.to, light.seconds)] : []),
      ...(light?.back
        ? [wait(`${path}/hold`, light.back.after), setLighting(`${path}/back`, light.back.to ?? missionLight(blueprintCatalog(blueprint), blueprint), light.back.seconds)]
        : []),
    ],
  };
}

/** A transition's debug line: "Transition dusk: light to Midnight over 480 s; water flood to high". */
function transitionDebugText(transition: Transition): string {
  const { light, water } = transition;
  const changes = [
    ...(light ? [`light to ${light.to}${light.seconds > 0 ? ` over ${light.seconds} s` : ""}${light.back ? `, back after ${light.back.after} s` : ""}`] : []),
    ...(water ? [`water ${water.poolId} to ${water.state}`] : []),
  ];
  return `Transition ${transition.id}: ${changes.join("; ")}`;
}

/**
 * The enemy AI (src/ai/enemy-ai.ts holds the tuning), for each computer player that owns a unit:
 * - "Enemy AI Start" (map init): start the campaign AI, which mines with the placed workers,
 *   defends its bases and rebuilds what the Objects say; give it money; play Casual at a
 *   handicap; grant the Hard and Brutal upgrades.
 * - "Enemy AI Money" (every few seconds of AI time): top the money up, as Blizzard's later
 *   missions do, so rebuilding never stalls.
 */
function enemyAiTriggers(blueprint: MissionBlueprint, afterStart: readonly TriggerCall[]): Trigger[] {
  const players = enemyPlayers(blueprint);
  if (players.length === 0) return [];
  const settings = enemyAiSettings(blueprint.enemyAi);
  const path = "enemyAi";
  const int = (value: number): TriggerParam["value"] => ({ kind: "int", value });
  const byDifficulty = (callPath: string, values: readonly [number, number, number, number]): TriggerParam["value"] => ({
    kind: "call",
    call: call(callPath, F.difficultyValueInt, { casual: int(values[0]), normal: int(values[1]), hard: int(values[2]), brutal: int(values[3]) }),
  });
  const setProperty = (callPath: string, player: number, property: (typeof P)["playerPropMinerals"], value: TriggerParam["value"]): TriggerCall =>
    call(callPath, F.modifyPlayerProperty, {
      player: int(player),
      property: { kind: "preset", preset: property },
      operation: { kind: "preset", preset: P.playerPropSetTo },
      value,
    });
  const money = (callPath: string, player: number): TriggerCall[] => [
    setProperty(`${callPath}/minerals`, player, P.playerPropMinerals, int(settings.money.minerals)),
    setProperty(`${callPath}/vespene`, player, P.playerPropVespene, int(settings.money.vespene)),
  ];
  // An upgrade granted on Hard is kept on Brutal.
  const upgrades = [...new Set([...settings.hard.upgrades, ...settings.brutal.upgrades])];

  const start: Trigger = {
    id: stableElementId(`${path}/start`),
    name: "Enemy AI Start",
    events: [{ id: stableElementId(`${path}/start/event`), def: F.mapInit, params: {} }],
    actions: players.flatMap((player) => {
      const playerPath = `${path}/start/${player}`;
      return [
        call(`${playerPath}/ai`, F.aiCampaignStart, { player: int(player) }),
        ...money(`${playerPath}/money`, player),
        ...(settings.casual.handicap < 100
          ? [setProperty(`${playerPath}/handicap`, player, P.playerPropHandicap, byDifficulty(`${playerPath}/handicap/value`, [settings.casual.handicap, 100, 100, 100]))]
          : []),
        ...upgrades.map((upgrade) => {
          const hard = settings.hard.upgrades.includes(upgrade) ? 1 : 0;
          return call(`${playerPath}/upgrade/${upgrade}`, F.setUpgradeLevel, {
            player: int(player),
            upgrade: { kind: "gamelink", gameType: "Upgrade", value: upgrade },
            level: byDifficulty(`${playerPath}/upgrade/${upgrade}/level`, [0, 0, hard, 1]),
          });
        }),
      ];
    }).concat(afterStart),
  };
  const topUp: Trigger = {
    id: stableElementId(`${path}/money`),
    name: "Enemy AI Money",
    events: [
      call(`${path}/money/event`, F.periodicEvent, {
        duration: { kind: "fixed", value: settings.money.topUpSeconds },
        timeType: { kind: "preset", preset: P.timeAI },
      }),
    ],
    actions: players.flatMap((player) => money(`${path}/money/${player}`, player)),
  };
  return [start, topUp];
}

/**
 * "Tech" (map init), from the blueprint's `tech`: for each player, turn tech-tree restrictions on
 * when it has an allow list and allow the list, then disallow. It's the first trigger, so its
 * map-init actions run before the Mission's and the Mechanics' (a Mechanic that locks a unit and
 * allows it later still has the last word).
 */
function techTrigger(blueprint: MissionBlueprint): Trigger | undefined {
  if (blueprint.tech.length === 0) return undefined;
  const path = "tech";
  const int = (value: number): TriggerParam["value"] => ({ kind: "int", value });
  const lists = (player: number, list: "allow" | "disallow", tech: MissionBlueprint["tech"][number]["allow"]): TriggerCall[] => {
    if (!tech) return [];
    const allow: TriggerParam["value"] = { kind: "preset", preset: list === "allow" ? P.allow : P.disallow };
    const at = `${path}/${player}/${list}`;
    return [
      ...[...tech.units, ...tech.buildings].map((unit) =>
        call(`${at}/unit/${unit}`, F.allowUnit, { player: int(player), unitType: { kind: "gamelink", gameType: "Unit", value: unit }, allow }),
      ),
      ...tech.upgrades.map((upgrade) =>
        call(`${at}/upgrade/${upgrade}`, F.allowUpgrade, { player: int(player), upgrade: { kind: "gamelink", gameType: "Upgrade", value: upgrade }, allow }),
      ),
    ];
  };
  return {
    id: stableElementId(path),
    name: "Tech",
    events: [{ id: stableElementId(`${path}/event`), def: F.mapInit, params: {} }],
    actions: blueprint.tech.flatMap(({ player, allow, disallow }) => [
      ...(allow ? [call(`${path}/${player}/restrictions`, F.techRestrictionsEnable, { player: int(player), enable: { kind: "preset", preset: P.enable } })] : []),
      ...lists(player, "allow", allow),
      ...lists(player, "disallow", disallow),
    ]),
  };
}

/**
 * "Beat - <title>" for each beat with `startsWhen`: the first of its conditions to happen turns it
 * and every earlier beat's trigger off (so beats only move forward), sets the bounds that hold from
 * it (beat-bounds.ts), explores the beat's Zones (beat-reveals.ts), runs the Mechanics' beat actions, plays the Cinematics and trigger scenes cued
 * on its start (and any scenes cued before the last of them), then pings what it explored, so the
 * pings come at the scenes' handback, as the first Beat's do after the mission-start scenes, with
 * the camera bounds a transition held wider while they played. Last,
 * it arms what waits for it or an earlier Beat (`fromBeat`, from-beat.ts), so a condition met
 * already isn't met over its scenes, and runs "Beat - <title> Lines" without waiting: the
 * Transmissions cued on its start after those, in cue order, each queued behind the lines already
 * playing, so they hold up none of the above.
 */
function beatTriggers(
  blueprint: MissionBlueprint,
  hooks: BeatActions,
  beatScenes: BeatScenes,
  staged: StagedWait,
  arming: Pick<ReturnType<typeof armsTriggers>, "startActions" | "beatActions">,
): { readonly beatId: string; readonly trigger: Trigger }[] {
  const beats = blueprint.beats.filter((beat) => beat.startsWhen);
  const entries = blueprint.screenplay.script?.cues ?? [];
  // The Beats a Beat's own cued scenes start (scenePlays), and theirs in turn: started by its own
  // trigger's run, they don't mean a later Beat has taken over from it.
  const startedBy = (beatId: string): Set<string> => {
    const found = new Set<string>();
    const visit = (id: string): void => {
      for (const entry of entries) {
        if (entry.cue.type !== "beatStarts" || entry.cue.beatId !== id) continue;
        for (const beat of beats) {
          if (found.has(beat.id) || !startsOnEntry(beat, entry)) continue;
          found.add(beat.id);
          visit(beat.id);
        }
      }
    };
    visit(beatId);
    return found;
  };
  return beats.flatMap((beat, index) => {
    const path = `beats/${beat.id}`;
    // A Kept trigger's run, a scene playing, Objectives completing or a Mechanic's moment starts it from that trigger
    // (keptTriggerHooks, sceneActionsFor, conditionTrigger, pluginMechanicTriggers' cueActions), not by an event.
    const events = beat.startsWhen!.flatMap((condition, conditionIndex): TriggerCall[] =>
      condition.type === "keptTriggerRuns" || condition.type === "scenePlays" || condition.type === "objectivesComplete" || condition.type === "mechanic" ? [] : [anchorEvent(blueprint, condition, `${path}/starts/${conditionIndex}`)],
    );
    const turnOff = beats.slice(0, index + 1).map((earlier) =>
      call(`${path}/off/${earlier.id}`, F.triggerEnable, {
        trigger: { kind: "trigger", trigger: beatTriggerRef(earlier) },
        state: { kind: "preset", preset: P.triggerOff },
      }),
    );
    const started = debugMessage(`${path}/debug`, `Beat: ${beat.title} started`);
    // Started by a Cinematic or trigger scene, it has started as the scene plays (its trigger and
    // the earlier ones off), and what it starts waits for the scene to hand back.
    const handback = staged.beats.has(beat.id) ? staged.wait(`${path}/handback`) : [];
    // Then what its start cues: the Beat's trigger turns itself off above, so they play once.
    const cued = beatScenes((cue) => cue.type === "beatStarts" && cue.beatId === beat.id);
    const between = [...(hooks.get(beat.id) ?? []), ...cued.inline];
    const { explores, pings } = beatReveals(blueprint, beat.id);
    const bounds = beatBounds(blueprint, beat.id);
    const own = startedBy(beat.id);
    const next = beats.slice(index + 1).find((later) => !own.has(later.id));
    const lines: TriggerRef | undefined = cued.lines.length > 0 ? { id: stableElementId(`${path}/lines`), name: `Beat - ${beat.title} Lines` } : undefined;
    const runLines = lines
      ? [runTrigger(`${path}/lines/run`, lines)]
      : [];
    const trigger: Trigger = {
      ...beatTriggerRef(beat),
      events,
      actions: [
        ...turnOff,
        ...arming.startActions(beat.id),
        started,
        ...handback,
        ...bounds.start,
        ...explores,
        ...between,
        // Guarded on the very next Beat, even one this Beat's own scenes start: that one sets bounds of its own as it starts.
        ...afterScenes(`beats/${beat.id}/bounds/if-current`, bounds.settled, [...handback, ...between], beats[index + 1]),
        ...pingsAfter(beat.id, pings, [...handback, ...between], next),
        ...arming.beatActions(beat.id),
        ...runLines,
      ],
    };
    return (lines ? [trigger, { ...lines, events: [], actions: cued.lines }] : [trigger]).map((made) => ({ beatId: beat.id, trigger: made }));
  });
}

/** A Beat's "Beat - <title>" trigger. */
function beatTriggerRef(beat: Pick<MissionBlueprint["beats"][number], "id" | "title">): TriggerRef {
  return { id: stableElementId(`beats/${beat.id}`), name: `Beat - ${beat.title}` };
}

/**
 * The event of an Anchor's unit dying, entering a Zone or being captured, which starts a Beat or an
 * encounter. Its owner change is the capture: an Anchor that changes hands only to the player, such
 * as a camp Sentry.
 */
function anchorEvent(blueprint: MissionBlueprint, condition: EncounterStart, eventPath: string): TriggerCall {
  const unit: TriggerParam["value"] = unitValueOf(blueprint, condition.anchorId);
  if (condition.type === "anchorDies") {
    return { id: stableElementId(eventPath), def: F.unitDies, params: { unit: { id: stableElementId(`${eventPath}/unit`), value: unit } } };
  }
  if (condition.type === "anchorCaptured") return call(eventPath, F.unitOwnerChanges, { unit });
  return call(eventPath, F.unitEntersRegion, { unit, state: { kind: "preset", preset: P.regionEnters }, region: regionValueOf(blueprint, condition.zoneId) });
}

/**
 * A Beat's pings, run by the trigger that starts it after `before` (its beat actions and the
 * cued scenes it plays itself, or the mission-start scenes). If anything there waits, a later Beat may start meanwhile,
 * so they ping only while `next` (the next Beat with a trigger, past those its own cued scenes start)
 * still has its trigger on: Beats only move forward, each turning off its own trigger and every
 * earlier one's. The explores ran before,
 * so the ground is shown either way; only the pointer back is dropped. When #411's decision B is
 * built, a trigger scene that runs a Beat's reveals in its own cleanup owns these pings, and the
 * Beat's trigger must leave them out.
 */
function pingsAfter(beatId: string, pings: TriggerCall[], before: readonly TriggerCall[], next: Pick<MissionBlueprint["beats"][number], "id" | "title"> | undefined): TriggerCall[] {
  return afterScenes(`beats/${beatId}/reveals/if-current`, pings, before, next);
}

/**
 * Actions a Beat's trigger runs once `before` (its scenes) has handed back: a Beat's pings, or the
 * camera bounds its transition held wider meanwhile. If anything in `before` waits, they run only
 * while `next` still has its trigger on, so a later Beat that started meanwhile keeps its own.
 */
function afterScenes(path: string, calls: TriggerCall[], before: readonly TriggerCall[], next: Pick<MissionBlueprint["beats"][number], "id" | "title"> | undefined): TriggerCall[] {
  if (calls.length === 0 || !next || !waits(before)) return calls;
  return [ifTriggerOn(path, beatTriggerRef(next), calls)];
}

/**
 * "After <Kept trigger>" for each Kept trigger a cue or a Beat start names: from map start it
 * waits for that trigger to run to its end (Wait For Trigger, TriggerWaitForTrigger with
 * waitUntilDone), then plays what the cue plays and starts the Beats it starts. The Kept trigger
 * itself is left as the Editor saved it. It waits for the trigger's next run after the map starts,
 * so a Kept trigger that runs again plays nothing more, and one that runs and ends at map
 * initialization itself, before the wait begins, is missed. A Beat starts only while its trigger is
 * still on.
 */
function keptTriggerHooks(blueprint: MissionBlueprint, scenes: SceneActions): Trigger[] {
  const ids = new Set<string>();
  for (const { cue } of blueprintCues(blueprint)) if (cue.type === "keptTriggerRuns") ids.add(cue.triggerId);
  for (const beat of blueprint.beats) for (const condition of beat.startsWhen ?? []) if (condition.type === "keptTriggerRuns") ids.add(condition.triggerId);
  return [...ids].map((triggerId) => {
    const kept = keptTriggerRef(blueprint, triggerId);
    const path = `kept/${triggerId}`;
    const ran: MomentTest = (named) => named.type === "keptTriggerRuns" && named.triggerId === triggerId;
    return {
      id: stableElementId(path),
      name: `After ${kept.name}`,
      events: [{ id: stableElementId(`${path}/event`), def: F.mapInit, params: {} }],
      actions: [
        call(`${path}/wait`, F.waitForTrigger, { trigger: { kind: "trigger", trigger: kept }, wait: { kind: "preset", preset: P.wait } }),
        ...momentActions(blueprint, scenes, ran, (beat) => `${path}/beat/${beat.id}`),
      ],
    };
  });
}

/**
 * What an objectivesComplete condition counts with: a bool for each Objective some such condition
 * names (set as the Objective is Completed, so entering its Zone twice counts once), and an int for
 * each condition, the Objectives of its own Completed so far. Each Objective's completion adds one
 * to the counts of the conditions it is in and runs those, which hold only at their own count
 * (`conditionEvents`), so each fires once.
 */
type ObjectiveTally = {
  readonly done: ReadonlyMap<string, TriggerVariable>;
  readonly counts: ReadonlyMap<string, TriggerVariable>;
  /** The conditions an Objective is named by. */
  readonly of: ReadonlyMap<string, readonly ObjectivesCondition[]>;
  readonly variables: readonly TriggerVariable[];
};

function objectiveTally(blueprint: MissionBlueprint, conditions: readonly OutcomeCondition[]): ObjectiveTally {
  const complete = conditions.filter((condition): condition is ObjectivesCondition => condition.type === "objectivesComplete");
  const done = new Map<string, TriggerVariable>();
  const of = new Map<string, ObjectivesCondition[]>();
  const flag = (id: string): void => {
    if (!done.has(id)) done.set(id, triggerVariable(`objectives/${id}/variables/done`, `done_objective_${id.replace(/-/g, "_")}`, "bool", { kind: "bool", value: false }));
  };
  for (const condition of complete) {
    for (const id of condition.objectiveIds) {
      flag(id);
      of.set(id, [...(of.get(id) ?? []), condition]);
    }
    // An "exactly" also reads every other Objective a compile completes, to be not done.
    if (condition.exactly) for (const objective of blueprint.objectives) if (objective.completeWhen) flag(objective.id);
  }
  const counts = new Map(
    complete.filter((condition) => !condition.exactly).map((condition, index) => [conditionPath(condition), triggerVariable(`${conditionPath(condition)}/variables/count`, `objectives_complete_${index + 1}_count`, "int", { kind: "int", value: 0 })] as const),
  );
  return { done, counts, of, variables: [...done.values(), ...counts.values()] };
}

/**
 * What a Completed Objective adds for the conditions that count it: the first time only, it adds
 * one to each one's count and runs it, which checks the count is its own.
 */
function noteCompleted(blueprint: MissionBlueprint, objectiveId: string, tally: ObjectiveTally): TriggerCall[] {
  const flag = tally.done.get(objectiveId);
  if (!flag) return [];
  const path = `objectives/${objectiveId}/tally`;
  const counted = (condition: ObjectivesCondition): TriggerCall[] => {
    const at = `${path}/${conditionPath(condition)}`;
    const count: TriggerParam["value"] = { kind: "variable", variable: tally.counts.get(conditionPath(condition))! }; // none for an "exactly"
    return [
      ...(condition.exactly
        ? []
        : [
            call(`${at}/add`, F.setVariable, {
              variable: count,
              value: callValue(`${at}/add/plus`, F.arithmeticInt, { left: count, operator: { kind: "preset", preset: P.plus }, right: { kind: "int", value: 1 } }),
            }),
          ]),
      runTrigger(`${at}/run`, conditionTriggerRef(blueprint, condition)),
    ];
  };
  return [
    ifThen(path, compare(`${path}/new`, { kind: "variable", variable: flag }, P.compareEqual, { kind: "bool", value: false }), [
      call(`${path}/done`, F.setVariable, { variable: { kind: "variable", variable: flag }, value: { kind: "bool", value: true } }),
      ...(tally.of.get(objectiveId) ?? []).flatMap(counted),
    ]),
  ];
}

/** Starts a goal timer and shows its countdown, titled after the objective it completes. */
function startGoalTimer(blueprint: MissionBlueprint, condition: TimerCondition, variable: TriggerVariable): TriggerCall[] {
  const path = `${conditionPath(condition)}/start`;
  const timer: TriggerParam["value"] = { kind: "variable", variable };
  const objective = blueprint.objectives.find((candidate) => sameCondition(candidate.completeWhen, condition));
  const defeat = blueprint.outcomes.defeat.some((other) => sameCondition(other, condition));
  return [
    call(`${path}/timer`, F.timerStart, {
      duration: { kind: "fixed", value: condition.seconds },
      repeating: { kind: "preset", preset: P.timerOneShot },
      timeType: { kind: "preset", preset: P.timeGame },
      timer,
    }),
    call(`${path}/window`, F.timerWindowCreate, {
      timer,
      visible: { kind: "preset", preset: P.timerWindowVisible },
      elapsed: { kind: "preset", preset: P.timerWindowRemaining },
      title: { kind: "text", text: objective?.title ?? (defeat ? "Time remaining" : "Hold out") },
    }),
  ];
}

const RESOURCE_PROPERTY = {
  minerals: { preset: P.playerPropMineralsCollected, name: "Minerals" },
  vespene: { preset: P.playerPropVespeneCollected, name: "Vespene" },
} as const;

/** The name of a condition's event: "<Anchor> Dies", "<Anchor> Reaches <Zone>", "Timer <n> s Ends", "<n> Minerals Collected". */
function conditionName(blueprint: MissionBlueprint, condition: OutcomeCondition): string {
  switch (condition.type) {
    case "anchorDies":
      return `${anchorNameOf(blueprint, condition.anchorId)} Dies`;
    case "anchorEntersZone":
      return `${anchorNameOf(blueprint, condition.anchorId)} Reaches ${zoneNameOf(blueprint, condition.zoneId)}`;
    case "anchorCaptured":
      return `${anchorNameOf(blueprint, condition.anchorId)} Captured`;
    case "timer":
      return `Timer ${condition.seconds} s Ends`;
    case "resourceQuota":
      return `${condition.amount} ${RESOURCE_PROPERTY[condition.resource].name} Collected`;
    case "objectivesComplete": {
      if (condition.exactly) return `Exactly ${condition.objectiveIds.map((id) => titleWords(id)).join(", ")} Complete`;
      const needed = objectivesNeeded(condition);
      return `${needed === condition.objectiveIds.length ? "All" : needed} Of ${condition.objectiveIds.map((id) => titleWords(id)).join(", ")} Complete`;
    }
  }
}

/** The trigger's events, plus any conditions and actions that must run first; its name is conditionTriggerRef's. */
function conditionEvents(
  blueprint: MissionBlueprint,
  condition: OutcomeCondition,
  goalTimers: ReadonlyMap<string, TriggerVariable>,
  tally: ObjectiveTally,
): Pick<Trigger, "events" | "conditions"> & { readonly first: TriggerCall[] } {
  const path = conditionPath(condition);
  switch (condition.type) {
    // Run by the Objective whose completion brings the count to this one's, so it has no event and holds only at that count (once).
    case "objectivesComplete":
      return {
        events: [],
        conditions: condition.exactly
          ? // Every one named done and no other: the last of them to complete is the one whose run finds it so.
            [...tally.done].map(([id, flag]) => compare(`${path}/condition/${id}`, { kind: "variable", variable: flag }, P.compareEqual, { kind: "bool", value: condition.objectiveIds.includes(id) }))
          : [compare(`${path}/condition`, { kind: "variable", variable: tally.counts.get(path)! }, P.compareEqual, { kind: "int", value: objectivesNeeded(condition) })],
        first: [],
      };
    case "anchorDies": {
      const unit: TriggerParam["value"] = unitValueOf(blueprint, condition.anchorId);
      return {
        events: [
          {
            id: stableElementId(`${path}/event`),
            def: F.unitDies,
            params: { unit: { id: stableElementId(`${path}/event/unit`), value: unit } },
          },
        ],
        first: [],
      };
    }
    case "anchorEntersZone": {
      return {
        events: [
          call(`${path}/event`, F.unitEntersRegion, {
            unit: unitValueOf(blueprint, condition.anchorId),
            state: { kind: "preset", preset: P.regionEnters },
            region: regionValueOf(blueprint, condition.zoneId),
          }),
        ],
        first: [],
      };
    }
    case "anchorCaptured": {
      const unit: TriggerParam["value"] = unitValueOf(blueprint, condition.anchorId);
      return {
        events: [call(`${path}/event`, F.unitOwnerChanges, { unit })],
        conditions: [
          call(`${path}/condition`, F.comparison, {
            left: { kind: "call", call: call(`${path}/condition/owner`, F.unitOwner, { unit }) },
            operator: { kind: "preset", preset: P.compareEqual },
            right: { kind: "int", value: USER_PLAYER },
          }),
        ],
        first: [],
      };
    }
    case "timer":
      return {
        events: [call(`${path}/event`, F.timerExpires, { timer: { kind: "variable", variable: goalTimers.get(path)! } })],
        first: [],
      };
    case "resourceQuota": {
      const { preset } = RESOURCE_PROPERTY[condition.resource];
      const property: TriggerParam["value"] = { kind: "preset", preset };
      return {
        events: [call(`${path}/event`, F.playerPropertyChanges, { player: { kind: "int", value: 1 }, property })],
        conditions: [
          call(`${path}/condition`, F.comparison, {
            left: { kind: "call", call: call(`${path}/condition/collected`, F.playerPropertyInt, { player: { kind: "int", value: 1 }, property }) },
            operator: { kind: "preset", preset: P.compareAtLeast },
            right: { kind: "int", value: condition.amount },
          }),
        ],
        // The property changes with every trip a worker makes; react once.
        first: [
          call(`${path}/disable`, F.triggerEnable, {
            trigger: { kind: "call", call: call(`${path}/disable/trigger`, F.currentTrigger, {}) },
            state: { kind: "preset", preset: P.triggerOff },
          }),
        ],
      };
    }
  }
}

/** A condition's trigger: one armed from a Beat is named apart from the same event armed from map start, "<event> From <Beat>". */
function conditionTriggerRef(blueprint: MissionBlueprint, condition: OutcomeCondition): TriggerRef {
  const name = conditionName(blueprint, condition);
  const from = blueprint.beats.find((beat) => beat.id === condition.fromBeat);
  return { id: stableElementId(conditionPath(condition)), name: from ? `${name} From ${from.title}` : name };
}

/**
 * "<Anchor> Dies", "<Anchor> Reaches <Zone>", "Timer <n> s Ends", "<n> Minerals Collected":
 * complete objectives, play scenes, then victory/defeat. A victory outro (`outros`, by scene number,
 * or `victoryOutro`, listed by the victory outcome and played on each victory condition as the last
 * entry of its scene run, once) is the last scene played, and the victory follows it straight away,
 * with no death pause.
 */
function conditionTrigger(
  blueprint: MissionBlueprint,
  condition: OutcomeCondition,
  objectiveVariables: ReadonlyMap<string, TriggerVariable>,
  goalTimers: ReadonlyMap<string, TriggerVariable>,
  tally: ObjectiveTally,
  victoryActions: (path: string) => TriggerCall[],
  scenes: SceneActions,
  outros: ReadonlySet<number> = new Set(),
  victoryOutro?: { readonly id: string; readonly started: TriggerVariable },
): Trigger | undefined {
  const path = conditionPath(condition);
  const matches = (other: OutcomeCondition | undefined): boolean => sameCondition(other, condition);
  const victory = blueprint.outcomes.victory.some(matches);
  const defeat = blueprint.outcomes.defeat.some(matches);
  if (victory && defeat) {
    throw new Error(`${path} is both a victory and a defeat condition`);
  }
  const outcomeOutro = victory ? victoryOutro : undefined;
  const playsOutro = outcomeOutro !== undefined || (blueprint.screenplay.script?.cues ?? []).some(({ cue, scene }) => outros.has(scene) && isConditionCue(cue) && matches(cue));
  const actions = [
    ...(victory ? victoryActions(path) : []),
    ...blueprint.objectives
      .filter((objective) => matches(objective.completeWhen))
      .flatMap((objective) => [completeObjective(objective, objectiveVariables.get(objective.id)!), ...noteCompleted(blueprint, objective.id, tally)]),
    // The Beats that start on this condition (Objectives completing), before its scenes, as a Beat's own event starts it.
    ...blueprint.beats
      .filter((beat) => beat.startsWhen?.some((start) => start.type === "objectivesComplete" && matches(start)))
      .map((beat) => startBeat(`${path}/beat/${beat.id}`, beat)),
    // The outcome's outro last in the run, which the scene before it hands on to (ADR 0012).
    ...scenes((cue) => isConditionCue(cue) && matches(cue), outcomeOutro ? { at: `${path}/triggerScene/${outcomeOutro.id}` } : undefined),
    // Let the death animation play before the end screen; a victory outro is that pause itself.
    ...((victory || defeat) && condition.type === "anchorDies" && !playsOutro
      ? [
          call(`${path}/deathPause`, F.wait, {
            time: { kind: "fixed", value: DEATH_PAUSE_SECONDS },
            timeType: { kind: "preset", preset: P.timeGame },
          }),
        ]
      : []),
    ...(victory ? [gameOver(`${path}/victory`, P.gameOverVictory)] : []),
    ...(defeat ? [gameOver(`${path}/defeat`, P.gameOverDefeat)] : []),
  ];
  // An objectivesComplete trigger is run by name from each Objective it counts, so it exists even with nothing to do.
  if (actions.length === 0 && condition.type !== "objectivesComplete") return undefined;

  const { first, ...events } = conditionEvents(blueprint, condition, goalTimers, tally);
  // One armed from a Beat is off until the Beat arms it (from-beat.ts).
  const trigger = { ...events, name: conditionTriggerRef(blueprint, condition).name, ...(condition.fromBeat === undefined ? {} : { initiallyOff: true }) };
  // With the outcome's outro, the first victory condition met plays it and ends the game: one met
  // while it plays starts nothing (its scenes, the outro again, a second GameOver).
  if (outcomeOutro) {
    const once = call(`${path}/victoryOnce`, F.comparison, { left: { kind: "variable", variable: outcomeOutro.started }, operator: { kind: "preset", preset: P.compareEqual }, right: { kind: "bool", value: false } });
    const start = call(`${path}/victoryStarted`, F.setVariable, { variable: { kind: "variable", variable: outcomeOutro.started }, value: { kind: "bool", value: true } });
    return { id: stableElementId(path), ...trigger, conditions: [...(trigger.conditions ?? []), once], actions: [...first, start, ...actions] };
  }
  return { id: stableElementId(path), ...trigger, actions: [...first, ...actions] };
}

/**
 * Builds the mission's GUI triggers, one per event:
 * - "Tech": each player's allowed and disallowed tech, first at map init.
 * - "Mission Start": create objectives, explore the first Beat's Zones, play scenes cued at mission
 *   start, then ping what it explored (only while no later Beat has started, if the scenes waited).
 * - "Encounter - <zone>": attackers charge when the player enters the zone.
 * - "Cinematic <Id>" and its "Watch": each Cinematic, which its scene's cues run (cinematic-triggers.ts).
 * - Each Mechanic's, in Blueprint order.
 * - "Beat - <title>": each started beat: explore its Zones, run the Mechanics' beat actions, play
 *   the Cinematics and trigger scenes cued on its start, then ping what it explored (guarded the
 *   same way), then run "Beat - <title> Lines", which plays the Transmissions cued after them.
 * - "<Anchor> Dies" / "<Anchor> Reaches <Zone>": complete objectives, play cued scenes,
 *   then end the game on victory/defeat (running the Mechanics' victory actions first on victory).
 */
export function buildMissionTriggers(
  blueprint: MissionBlueprint,
  options: {
    readonly script?: Script;
    /** The Campaign Mod's library, which Mechanics' triggers may call (mods/library.ts); none by default. */
    readonly library?: CampaignLibrary;
    /** The Mission's trigger scenes, checked and timed (cutscene/trigger-scene.ts); the Blueprint's `triggerScenes` need them. */
    readonly triggerScenes?: readonly TimedTriggerScene[];
  } = {},
): TriggerDocument {
  if (blueprint.screenplay.script && !options.script) {
    throw new Error("The blueprint's screenplay uses a script; pass the parsed script to buildMissionTriggers");
  }
  const reference = blueprint.screenplay.script;
  const listedTriggerScenes = reference?.triggerScenes ?? [];
  const timedTriggerScenes = new Map((options.triggerScenes ?? []).map((scene) => [scene.id, scene]));
  requireLoaded(blueprint, timedTriggerScenes);
  // The Scene Chain: which scenes hand on, hand back or take over, and the victory outros (scene-chain.ts).
  const chain = sceneChain(blueprint);
  const { byOutcome } = chain;
  chain.assertOutros(timedTriggerScenes);
  const outros = chain.outros(timedTriggerScenes);
  // A scenePlayed cue (a script scene's, a transition's or an inline scene's) waits on a scene that
  // plays and hands back: not a victory outro, nor one only a game-ending condition's cues play, whose
  // game is over once it has played.
  const ends = (cue: Cue): boolean => isConditionCue(cue) && [...blueprint.outcomes.victory, ...blueprint.outcomes.defeat].some((condition) => sameCondition(condition, cue));
  // A scene cued on the event of a victory or defeat armed from a Beat plays on the event's own
  // trigger, live from map start (cues take no fromBeat), so once the Beat has armed the condition,
  // the game would end over it.
  for (const { cue, path } of blueprintCues(blueprint)) {
    if (path[0] === "transitions" || path[0] === "uiActions" || !isConditionCue(cue) || ends(cue)) continue;
    const waiting = [...blueprint.outcomes.victory, ...blueprint.outcomes.defeat].find((condition) => condition.fromBeat !== undefined && sameCondition({ ...condition, fromBeat: undefined }, cue));
    if (!waiting) continue;
    throw new Error(
      `${capitalized(cuedWhat(blueprint, path))} is cued on ${cuePath(cue)}, which ends the game only from Beat ${waiting.fromBeat} (fromBeat): played apart from that, on the event at any time, it would race the game's end. Cue it on the Beat's start or on something else, or drop the fromBeat`,
    );
  }
  for (const { cue, path } of blueprintCues(blueprint)) {
    if (cue.type !== "scenePlayed") continue;
    const waiting = cuedWhat(blueprint, path);
    if (outros.has(cue.scene)) throw new Error(`Scene ${cue.scene} is a victory outro, which ends the game, so a scenePlayed cue on it would never fire: cue ${waiting} on something else`);
    const playing = (reference?.cues ?? []).filter((entry) => scenePlayedKey(entry) === scenePlayedKey(cue));
    // The schema checks a cue entry plays it; beside Kept terrain an unconverted script plays nothing.
    if (path[0] === "kept" && playing.length === 0) throw new Error(`${capitalized(waiting)} waits on ${scenePlayedName(cue)}, which this compile doesn't play, so it would never run: convert the Mission's conversation (convert-screenplay) or hold it until another cue`);
    if (playing.length > 0 && playing.every((entry) => ends(entry.cue))) {
      throw new Error(`${scenePlayedName(cue)} plays only on a condition that ends the game, so a scenePlayed cue on it would never fire: cue ${waiting} on something else`);
    }
  }
  // So does an entry's after.
  for (const { scene, after } of reference?.cues ?? []) {
    if (!after) continue;
    const fix = `drop the after on scene ${scene}'s cue`;
    if (outros.has(after.scene)) throw new Error(`Scene ${after.scene} is a victory outro, which ends the game, so an entry after it would never play: ${fix}`);
    const playing = (reference?.cues ?? []).filter((entry) => scenePlayedKey(entry) === scenePlayedKey(after));
    if (playing.length > 0 && playing.every((entry) => ends(entry.cue))) throw new Error(`${scenePlayedName(after)} plays only on a condition that ends the game, so an entry after it would never play: ${fix}`);
  }
  const light = (reference?.cinematics ?? []).length > 0 ? missionLight(blueprintCatalog(blueprint), blueprint) : "";
  const cinematics = new Map(
    (reference?.cinematics ?? []).map(({ id, scene, environment }) => [
      scene,
      cinematicPlayback(id, light, {
        handsOn: chain.handsOn(scene),
        environmentShown: environment === "shown",
        // A Kept trigger held until the whole scene has played starts after it, as the Kept map started it.
        handsOnToKept: blueprint.kept.some(({ hold }) => hold?.until.type === "scenePlayed" && hold.until.scene === scene && hold.until.from === undefined && hold.until.line === undefined),
        // Its bookmark cues that fire on a skip, run by its cleanup if the skip passed over them.
        bookmarksOnSkip: bookmarksFiredOnSkip(blueprint, id),
      }),
    ]),
  );
  // A trigger scene's line, sent without waiting for its hold to keep and wait for (transmission-hold.ts).
  const transmission = (line: ScriptLine, prefix: string, speaker?: TriggerParam["value"]): TriggerCall =>
    scriptTransmission(blueprint, line, speaker ?? bySpeaker(reference!.speakerAnchors, line.speaker), prefix, false);
  // An objective a trigger scene issues at its handback is created hidden, and shown there (H3).
  const issued = new Set(listedTriggerScenes.flatMap(({ id }) => timedTriggerScenes.get(id)!.triggerScene.handback?.objective ?? []));
  const objectiveVariables = new Map<string, TriggerVariable>();
  for (const objective of blueprint.objectives) {
    if (objective.completeWhen || issued.has(objective.id)) objectiveVariables.set(objective.id, objectiveVariable(objective));
  }
  chain.assertOutcomeOutro(timedTriggerScenes);
  // A trigger scene starts at once and cuts off the in-play line playing, which is replayed after it
  // (ADR 0013): a Mission with one holds its lines; one with none plays them as it always has.
  const { listed } = chain;
  // A hero moment, when the Campaign Mod turns ui.heroMoment on, waits for each in-play line (#656).
  const heroMoment = missionHeroMoment(options.library ?? NO_LIBRARY);
  const momentLines: MomentLines | undefined = heroMoment && {
    hold: (path) => call(path, heroMoment.holdForLine, {}),
    release: (path) => call(path, heroMoment.releaseAfterLine, {}),
  };
  const hold = listed.length > 0 ? transmissionHold(momentLines) : undefined;
  const triggerScenes = new Map(
    listed.map(({ id, scene }, index) => [
      scene,
      triggerScenePlayback(timedTriggerScenes.get(id)!, blueprint, transmission, {
        lines: { hold: hold!, number: index + 1 },
        ...chain.role(scene),
        objective: (objectiveId) => objectiveVariables.get(objectiveId),
      }),
    ]),
  );

  const conditions = reactiveConditions(blueprint);
  const tally = objectiveTally(blueprint, conditions);
  const goalTimers = new Map(
    conditions.flatMap((condition) => (condition.type === "timer" ? [[conditionPath(condition), goalTimerVariable(condition)] as const] : [])),
  );
  // A Mission with clocks (goal timers, or a Mechanic, which may declare some) holds them for each
  // run of scenes, in "Clocks Hold" and "Clocks Release", built once the Mechanics have said which.
  const holding = goalTimers.size > 0 || pluginMechanicEntries(blueprint).length > 0 ? clockHold() : undefined;
  const { scenes, beatScenes, triggers: sceneTriggers, sceneOf, variables: sceneVariables, staged } = sceneActionsFor(blueprint, options.script, cinematics, triggerScenes, holding, hold, momentLines);
  // The victory outcome's outro, played last in each victory condition's run (sceneActionsFor), once.
  const victoryOutro = byOutcome ? { id: byOutcome.id, started: triggerVariable("outcomes/victory/variables/outro_started", "victory_outro_started", "bool", { kind: "bool", value: false }) } : undefined;

  const triggers: Trigger[] = [];
  // Each trigger's Trigger Folder, by #816's table (missionFolders).
  const placed = new Map<Trigger, string>();
  const file = (place: string, ...made: readonly Trigger[]): void => {
    for (const trigger of made) {
      triggers.push(trigger);
      placed.set(trigger, place);
    }
  };
  // The script scenes that file something, each with a folder of its own, and those of them with a
  // Cinematic or Trigger Scene compiled, whose folder is a Cutscene's.
  const filedScenes = new Set<number>();
  const stagedScenes = new Set<number>();
  const sceneFolder = (scene: number): string => {
    filedScenes.add(scene);
    return sceneFolderPath(scene);
  };
  const tech = techTrigger(blueprint);
  if (tech) file(MISSION_FOLDER, tech);
  const timers = conditions.flatMap((condition) =>
    condition.type === "timer" ? startGoalTimer(blueprint, condition, goalTimers.get(conditionPath(condition))!) : [],
  );
  const startScenes = scenes((cue) => cue.type === "missionStart");
  // A Cinematic or trigger scene at mission start holds the goal timers (game time, which pausing AI
  // time doesn't stop) until it and the scenes after it have played.
  const sceneAtStart = (blueprint.screenplay.script?.cues ?? []).some(
    (entry) => entry.cue.type === "missionStart" && !playsAlone(entry) && (cinematics.has(entry.scene) || triggerScenes.has(entry.scene)),
  );
  // The first Beat starts with the map, unless a condition starts it: its Zones are explored at
  // map start, and pinged once the scenes cued at mission start have handed back (pingsAfter).
  const firstBeat = blueprint.beats[0];
  const startsWithMission = firstBeat !== undefined && beatStart(blueprint, firstBeat.id) === "mission";
  const { explores: startExplores, pings: startPings } = startsWithMission ? beatReveals(blueprint, firstBeat.id) : { explores: [], pings: [] };
  // Its bounds are set before anything else, so the opening's camera starts inside them.
  const startBounds = startsWithMission ? beatBounds(blueprint, firstBeat.id) : { start: [], settled: [] };
  const opening = sceneAtStart ? [...startScenes, ...timers] : [...timers, ...startScenes];
  const firstTriggered = blueprint.beats.find((beat) => beat.startsWhen);
  const startActions = [
    ...startBounds.start,
    ...blueprint.objectives.flatMap((objective) => createObjective(objective, objectiveVariables.get(objective.id), issued.has(objective.id))),
    ...startExplores,
    ...opening,
    ...(firstBeat ? afterScenes(`beats/${firstBeat.id}/bounds/if-current`, startBounds.settled, opening, firstTriggered) : []),
    ...(firstBeat ? pingsAfter(firstBeat.id, startPings, opening, firstTriggered) : []),
  ];
  if (startActions.length > 0) {
    file(MISSION_FOLDER, {
      id: stableElementId("missionStart"),
      name: "Mission Start",
      events: [{ id: stableElementId("missionStart/event"), def: F.mapInit, params: {} }],
      actions: startActions,
    });
  }

  const encounterTriggers = blueprint.encounters.map((encounter) => ({ encounter, trigger: encounterTrigger(blueprint, encounter, scenes) }));
  for (const { encounter, trigger } of encounterTriggers) file(encounterFolder(blueprint, encounter.id), trigger);
  const deathWatches = blueprint.encounters.flatMap((encounter) => {
    const watch = encounterDeathWatch(blueprint, encounter);
    return watch ? [{ ...watch, encounter }] : [];
  });
  for (const { encounter, trigger } of deathWatches) file(encounterFolder(blueprint, encounter.id), trigger);
  for (const transition of blueprint.transitions) file(cuedFolder(transition.beatId, transition.cue), transitionTrigger(blueprint, transition));
  blueprint.uiActions.forEach((action, index) => file(cuedFolder(undefined, action.cue), uiActionTrigger(blueprint, action, index, options.library ?? NO_LIBRARY)));
  for (const [scene, cinematic] of cinematics) {
    stagedScenes.add(scene);
    file(sceneFolder(scene), ...cinematic.triggers);
  }
  // The victory outcome's outro (no scene) plays with the outcomes.
  for (const [scene, triggerScene] of triggerScenes) {
    if (scene !== OUTCOME_OUTRO) stagedScenes.add(scene);
    file(scene === OUTCOME_OUTRO ? MISSION_FOLDER : sceneFolder(scene), ...triggerScene.triggers);
  }
  for (const trigger of sceneTriggers) file(sceneFolder(sceneOf.get(trigger)!), trigger);
  // Cues on a unit nearing another, a structure type dying, an encounter's end.
  const cued = cueTriggers(blueprint, blueprintCues(blueprint).map(({ cue }) => cue), scenes);
  for (const trigger of cued.triggers) {
    const encounterId = cued.encounterOf.get(trigger);
    file(encounterId === undefined ? CUES_FOLDER : encounterFolder(blueprint, encounterId), trigger);
  }

  const owned = ownedClocks();
  const plugin = pluginMechanicTriggers(blueprint, scenes, options.library ?? NO_LIBRARY, owned);
  for (const made of plugin.triggers) file(mechanicFolder(made.mechanicId), made.trigger);
  // Built after every cue's actions (the Beats', Kept hooks' and conditions' below), if any held them.
  const clocks = (): ReturnType<typeof clockTriggers> | undefined => (holding?.used() ? clockTriggers([...goalTimers.values(), ...plugin.clocks], heroMoment !== undefined, owned) : undefined);
  // A hero moment pauses AI time, which the Waves and the delayed cues run on, but not the clocks'
  // game time, so they're held while one plays, as for a run of scenes (#656).
  if (heroMoment && holding && goalTimers.size + plugin.clocks.length > 0) file(MISSION_FOLDER, momentClocksTrigger(heroMoment, holding));

  // A Wave warning's Transmission: a Screenplay scene by id, or a script scene by number.
  const warningTransmissions: TransmissionActions = (transmission, prefix) => {
    if (typeof transmission === "string") {
      const scene = blueprint.screenplay.scenes.find((candidate) => candidate.id === transmission);
      if (!scene) throw new Error(`No screenplay scene ${transmission}`);
      return sceneTransmissions(blueprint, scene, prefix);
    }
    if (!reference || !options.script) throw new Error(`Script has no scene ${transmission}`);
    return scriptSceneTransmissions(blueprint, options.script, reference.speakerAnchors, transmission, prefix);
  };
  const waves = waveStreams(blueprint, warningTransmissions, cued.onBind);
  const beatActions = new Map(plugin.beatActions);
  for (const [beatId, actions] of waves.beatActions) beatActions.set(beatId, [...(beatActions.get(beatId) ?? []), ...actions]);
  // What waits for a Beat (fromBeat): each off until the Beat arms it, run then if already met. A
  // condition from a Beat is a victory's, a defeat's or an objective's (no cue takes fromBeat), so it has a trigger.
  const armed: ArmedTrigger[] = [
    ...conditions.flatMap((condition) =>
      condition.fromBeat === undefined
        ? []
        : [{ beatId: condition.fromBeat, trigger: conditionTriggerRef(blueprint, condition), holds: conditionHolds(blueprint, condition, `${conditionPath(condition)}/holds`), checkConditions: true }],
    ),
    ...encounterTriggers.flatMap(({ encounter, trigger }) => {
      if (encounter.fromBeat === undefined) return [];
      const at = `encounters/${encounter.id}/holds`;
      const holds = encounter.startsWhen ? conditionHolds(blueprint, encounter.startsWhen, at) : playerInZone(blueprint, encounter.triggerZoneId, encounter.player ?? USER_PLAYER, at);
      // Its own conditions read the unit that set it off, which a run from the Beat has none of.
      return [{ beatId: encounter.fromBeat, trigger, holds, checkConditions: false }];
    }),
  ];
  const arming = armsTriggers(blueprint, armed);
  for (const { beatId, trigger } of beatTriggers(blueprint, beatActions, beatScenes, staged, arming)) file(beatFolder(beatId), trigger);
  for (const trigger of arming.triggers) file(beatFolder(arming.beatOf.get(trigger)!), trigger);
  file(CUES_FOLDER, ...keptTriggerHooks(blueprint, scenes));
  file(ENEMY_AI_FOLDER, ...enemyAiTriggers(blueprint, waves.startActions));
  const wavesById = new Map(blueprint.waves.map((wave) => [wave.id, wave]));
  for (const trigger of waves.triggers) {
    const wave = wavesById.get(waves.waveOf.get(trigger)!)!;
    file(waveFolder(wave.startsAtBeat, wave.id), trigger);
  }

  for (const condition of conditions) {
    const trigger = conditionTrigger(blueprint, condition, objectiveVariables, goalTimers, tally, plugin.victoryActions, scenes, outros, victoryOutro);
    if (trigger) file(conditionFolder(blueprint, condition), trigger);
  }
  const held = clocks();
  if (held) file(MISSION_FOLDER, ...held.triggers);

  const galaxyNames = new Map<string, Trigger>();
  const makers = new Map(plugin.triggers.map((made) => [made.trigger, made.label]));
  const maker = (trigger: Trigger): string => `"${trigger.name}" (${makers.get(trigger) ?? "core"})`;
  for (const trigger of triggers) {
    const name = galaxyIdentifier(trigger.name);
    const clash = galaxyNames.get(name);
    if (clash) throw new Error(`Two triggers would share the script name gt_${name}: ${maker(clash)} and ${maker(trigger)}`);
    galaxyNames.set(name, trigger);
  }

  const variables = [
    ...objectiveVariables.values(),
    ...tally.variables,
    ...goalTimers.values(),
    ...plugin.variables.map((made) => made.variable),
    ...waves.variables,
    ...[...cinematics.values()].flatMap((cinematic) => cinematic.variables),
    ...[...triggerScenes.values()].flatMap((triggerScene) => triggerScene.variables),
    ...(victoryOutro ? [victoryOutro.started] : []),
    ...arming.variables,
    ...deathWatches.map(({ variable }) => variable),
    ...sceneVariables,
    ...cued.variables,
    ...(held?.variables ?? []),
    ...owned.variables(),
  ];
  const variableNames = new Map<string, string>();
  const variableMakers = new Map(plugin.variables.map((made) => [made.variable, made.label]));
  for (const variable of variables) {
    const name = editorGlobalName(variable.name);
    const made = `"${variable.name}" (${variableMakers.get(variable) ?? "core"})`;
    const clash = variableNames.get(name);
    if (clash) throw new Error(`Two variables would share the script name ${name}: ${clash} and ${made}`);
    variableNames.set(name, made);
  }
  const folders = missionFolders(blueprint, [...filedScenes], stagedScenes, [...new Set(plugin.triggers.map((made) => made.mechanicId))]);
  const doc = fileDocument({ variables, triggers }, folders, (trigger) => placed.get(trigger)!, MISSION_FOLDER);
  const seen = new Set<string>();
  for (const id of collectIds(doc)) {
    if (seen.has(id)) throw new Error(`Trigger element id collision: ${id}`);
    seen.add(id);
  }
  return doc;
}

// The Trigger Folders a Mission's generated triggers go in (#816), by their paths (trigger-filing.ts).
// docs/reference/editor-trigger-rules.md ("Where a Mission's generated triggers go") lists the layout.
const MISSION_FOLDER = "Mission";
const CUES_FOLDER = "Screenplay/Cues";
const ENEMY_AI_FOLDER = "Enemy AI";
const beatFolder = (beatId: string): string => `Beat:${beatId}`;
const objectivesFolder = (beatId: string): string => `${beatFolder(beatId)}/Objectives`;
const waveFolder = (beatId: string, waveId: string): string => `${beatFolder(beatId)}/Waves/${waveId}`;
const sceneFolderPath = (scene: number): string => `Screenplay/Scene ${scene}`;
const mechanicFolder = (mechanicId: string): string => `Mechanics/${mechanicId}`;

/**
 * A Wave's, Encounter's or Mechanic's folder name: its title, else its id in words, each `_` or `-`
 * a space and each word upper case first ("raid_quake" is "Raid Quake"). Its path, and so its
 * folder id, stays by id, so a new title renames the folder where it is.
 */
const folderName = (entry: { readonly id: string; readonly title?: string | undefined }): string =>
  entry.title ?? entry.id.split(/[_-]+/).filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");

/** The Beat an Encounter is filed under: its fromBeat, else the first Beat, from which it's live. */
const encounterBeat = (blueprint: MissionBlueprint, encounter: Encounter): string | undefined => encounter.fromBeat ?? blueprint.beats[0]?.id;

const encounterFolder = (blueprint: MissionBlueprint, encounterId: string): string => {
  const beatId = encounterBeat(blueprint, blueprint.encounters.find((encounter) => encounter.id === encounterId)!);
  return beatId === undefined ? MISSION_FOLDER : `${beatFolder(beatId)}/Encounters/${encounterId}`;
};

/** A transition's or UI action's folder: its Beat's (its beatId, or the Beat whose start cues it), else Mission. */
const cuedFolder = (beatId: string | undefined, cue: Cue): string => {
  const beat = beatId ?? (cue.type === "beatStarts" ? cue.beatId : undefined);
  return beat === undefined ? MISSION_FOLDER : beatFolder(beat);
};

/**
 * A condition's trigger's folder: Mission for a victory or defeat; else the Objectives of the first
 * Objective it completes; else the Beat it starts (Objectives completing); else Cues, as only a cue reacts to it.
 */
function conditionFolder(blueprint: MissionBlueprint, condition: OutcomeCondition): string {
  const matches = (other: OutcomeCondition | undefined): boolean => sameCondition(other, condition);
  if ([...blueprint.outcomes.victory, ...blueprint.outcomes.defeat].some(matches)) return MISSION_FOLDER;
  const objective = blueprint.objectives.find((candidate) => matches(candidate.completeWhen));
  if (objective) return objectivesFolder(objective.beatId);
  const beat = blueprint.beats.find((candidate) => candidate.startsWhen?.some((start) => start.type === "objectivesComplete" && matches(start)));
  return beat ? beatFolder(beat.id) : CUES_FOLDER;
}

/**
 * Every folder the Mission's triggers may go in, in the order the Editor lists them, each with its
 * Label (#816's Icons table): `scenes`, the script scenes that file something, and `mechanicIds`,
 * the Mechanic entries that do, each get one; a scene in `staged`, with a Cinematic or Trigger
 * Scene compiled, is a Cutscene's folder, any other a Conversation's.
 */
function missionFolders(blueprint: MissionBlueprint, scenes: readonly number[], staged: ReadonlySet<number>, mechanicIds: readonly string[]): FolderPlan[] {
  const beats = blueprint.beats.map((beat): FolderPlan => {
    const path = beatFolder(beat.id);
    return {
      path,
      name: beat.title,
      label: FOLDER_LABELS.beat,
      subfolders: [
        { path: objectivesFolder(beat.id), name: "Objectives", label: FOLDER_LABELS.objectives },
        {
          path: `${path}/Encounters`,
          name: "Encounters",
          label: FOLDER_LABELS.encounters,
          subfolders: blueprint.encounters
            .filter((encounter) => encounterBeat(blueprint, encounter) === beat.id)
            .map((encounter) => ({ path: encounterFolder(blueprint, encounter.id), name: folderName(encounter), label: FOLDER_LABELS.encounters })),
        },
        {
          path: `${path}/Waves`,
          name: "Waves",
          label: FOLDER_LABELS.waves,
          subfolders: blueprint.waves.filter((wave) => wave.startsAtBeat === beat.id).map((wave) => ({ path: waveFolder(beat.id, wave.id), name: folderName(wave), label: FOLDER_LABELS.waves })),
        },
      ],
    };
  });
  return [
    { path: MISSION_FOLDER, name: "Mission", label: FOLDER_LABELS.mission },
    ...beats,
    {
      path: "Screenplay",
      name: "Screenplay",
      label: FOLDER_LABELS.screenplay,
      subfolders: [
        ...[...scenes]
          .sort((a, b) => a - b)
          .map((scene) => ({ path: sceneFolderPath(scene), name: `Scene ${scene}`, label: staged.has(scene) ? FOLDER_LABELS.cutscene : FOLDER_LABELS.conversation })),
        { path: CUES_FOLDER, name: "Cues", label: FOLDER_LABELS.cues },
      ],
    },
    {
      path: "Mechanics",
      name: "Mechanics",
      label: FOLDER_LABELS.mechanics,
      subfolders: mechanicIds.map((id) => ({ path: mechanicFolder(id), name: folderName(blueprint.mechanics.find((mechanic) => mechanic.id === id) ?? { id }), label: FOLDER_LABELS.mechanics })),
    },
    { path: ENEMY_AI_FOLDER, name: "Enemy AI", label: FOLDER_LABELS.enemyAi },
  ];
}

/** No library: a Campaign whose Campaign Mod declares none, or a compile that reads none. */
export const NO_LIBRARY: CampaignLibrary = {
  functions: {},
  function: (identifier) => {
    throw new Error(`No Campaign Mod library declares ${identifier}: declare it in the library interface of the Campaign Mod's Mod Blueprint`);
  },
  uiCall: (action) => {
    throw new Error(`${action} is a UI Component's action, which needs a Campaign Mod with the component on, and the Workspace names no Campaign Mod`);
  },
};

/** What a UI action's arguments read of `blueprint`: a unit by its unit Anchor's or Kept unit's id. */
export function uiActionContext(blueprint: Pick<MissionBlueprint, "anchors" | "kept" | "waves">): UiActionContext {
  return {
    unit: (anchorId, param) => {
      if (!namesUnit(blueprint, anchorId)) throw new Error(`${param} ${anchorId} is neither a unit Anchor nor a Kept unit of the Mission: name one of its unit Anchors, or declare the unit in kept`);
      return unitValueOf(blueprint, anchorId);
    },
  };
}

/** The call a Mission's UI action makes, from `library` (CampaignLibrary.uiCall), or NO_LIBRARY's refusal when it has none. */
export const uiCall = (library: CampaignLibrary, blueprint: Pick<MissionBlueprint, "anchors" | "kept" | "waves">, action: string, params: unknown): ReturnType<NonNullable<CampaignLibrary["uiCall"]>> =>
  (library.uiCall ?? NO_LIBRARY.uiCall!)(action, params, uiActionContext(blueprint));

/** Actions each Beat's trigger runs as it starts, by Beat id. */
type BeatActions = ReadonlyMap<string, readonly TriggerCall[]>;

type PluginMechanicTriggers = {
  /** Each with the Mechanic entry that made it: its label, and its id, which files it (the path Mechanics/<id>, the name folderName gives). */
  readonly triggers: readonly { readonly trigger: Trigger; readonly label: string; readonly mechanicId: string }[];
  readonly variables: readonly { readonly variable: TriggerVariable; readonly label: string }[];
  readonly beatActions: BeatActions;
  /** The timers the Mechanics declare as clocks, which a run of scenes holds (H4). */
  readonly clocks: readonly TriggerVariable[];
  /** Every Mechanic's victory actions for the victory trigger at `path`, in Blueprint order. */
  readonly victoryActions: (path: string) => TriggerCall[];
};

/**
 * What the Mechanics add to the triggers, in Blueprint order, each trigger and variable with the
 * Mechanic entry that made it. Beat actions must name a Beat that has a trigger.
 */
function pluginMechanicTriggers(blueprint: MissionBlueprint, scenes: SceneActions, library: CampaignLibrary, owned: OwnedClocks): PluginMechanicTriggers {
  const context = mechanicContext(blueprint);
  const startedBeats = new Set(blueprint.beats.filter((beat) => beat.startsWhen).map((beat) => beat.id));
  const triggers: { trigger: Trigger; label: string; mechanicId: string }[] = [];
  const variables: { variable: TriggerVariable; label: string }[] = [];
  const beatActions = new Map<string, TriggerCall[]>();
  const clocks: TriggerVariable[] = [];
  const victories: { readonly made: (path: string) => readonly TriggerCall[]; readonly mechanic: Mechanic; readonly label: string }[] = [];
  for (const { id, mechanic, params, label } of pluginMechanicEntries(blueprint)) {
    const scenesAsked = new Set<string>();
    const beatsAsked = new Set<string>();
    const at = (cue: string): MomentTest => (named) => isMomentOf(named, id, cue);
    // The Beats that start on the moment, each run to its whole start (startBeat with wait) and only
    // while its trigger is still on, so a Mechanic that reaches the moment again starts none.
    const beatStarts = (cue: string): TriggerCall[] => {
      beatsAsked.add(cue);
      return beatsStartingAt(blueprint, at(cue), (beat) => `mechanics/${id}/cues/${cue}/beat/${beat.id}`, true);
    };
    // The Beats that start on the moment, first, then what the Blueprint cues there.
    const cueActions = (cue: string, options: { readonly beats?: boolean } = {}): TriggerCall[] => {
      scenesAsked.add(cue);
      return [...(options.beats === false ? [] : beatStarts(cue)), ...scenes(at(cue))];
    };
    const ownClocks: TriggerVariable[] = [];
    const ownedPause = (path: string, clock: TriggerVariable, pausing: boolean): TriggerCall[] => {
      ownClocks.push(clock);
      return owned.pause(path, clock, pausing);
    };
    const ownedStart = (path: string, clock: TriggerVariable, seconds: number): TriggerCall[] => {
      ownClocks.push(clock);
      return owned.start(path, clock, seconds);
    };
    const built = runHook(label, "buildTriggers hook", () =>
      mechanic.buildTriggers(params, { ...context, mechanicId: id, cueActions, beatStarts, pauseClock: ownedPause, startClock: ownedStart, library }),
    );
    checkResult(label, "buildTriggers", MechanicTriggersResultSchema, built);
    const made: MechanicTriggers = isTriggerList(built) ? { triggers: built } : built;
    // What the Blueprint cues and starts at this Mechanic must reach its triggers, or it would silently never play or start.
    for (const cue of new Set(cuedAt(blueprint, id, "cues"))) {
      if (!scenesAsked.has(cue)) throw new Error(`${label}: the Blueprint cues something at its ${cue}, but its buildTriggers hook never asked for what to play there (context.cueActions)`);
    }
    for (const cue of new Set(cuedAt(blueprint, id, "beats"))) {
      if (!beatsAsked.has(cue)) throw new Error(`${label}: a Beat starts at its ${cue}, but its buildTriggers hook never asked for the Beats that start there (context.cueActions or beatStarts)`);
    }
    checkPrimitives(label, mechanic, "buildTriggers hook", [...made.triggers.flatMap(triggerCalls), ...Object.values(made.beatActions ?? {}).flat()], made.variables, library);
    triggers.push(...made.triggers.map((trigger) => ({ trigger, label, mechanicId: id })));
    variables.push(...(made.variables ?? []).map((variable) => ({ variable, label })));
    for (const clock of made.clocks ?? []) {
      if (clock.type !== "timer" || !made.variables?.includes(clock)) throw new Error(`${label}: its buildTriggers hook declared clock ${clock.name}, which isn't one of its timer variables`);
      clocks.push(clock);
    }
    for (const clock of ownClocks) {
      if (!made.clocks?.includes(clock)) throw new Error(`${label}: its buildTriggers hook started or paused ${clock.name} with context.startClock or pauseClock, which isn't one of its clocks`);
    }
    for (const [beatId, actions] of Object.entries(made.beatActions ?? {})) {
      if (!startedBeats.has(beatId)) {
        throw new Error(`${label}: its buildTriggers hook gave actions for beat ${beatId}, which has no Beat trigger (only a Beat with startsWhen has one)`);
      }
      beatActions.set(beatId, [...(beatActions.get(beatId) ?? []), ...actions]);
    }
    if (made.victoryActions) victories.push({ made: made.victoryActions, mechanic, label });
  }
  const victoryActions = (path: string): TriggerCall[] =>
    victories.flatMap(({ made, mechanic, label }) => {
      const calls = runHook(label, "victoryActions", () => made(path));
      checkPrimitives(label, mechanic, "victoryActions", calls, [], library);
      return [...calls];
    });
  return { triggers, variables, beatActions, clocks, victoryActions };
}

/** The cue names the Blueprint's cues (script cues, transitions, scenes…) or its Beat starts use at one Mechanic entry. */
function cuedAt(blueprint: MissionBlueprint, mechanicId: string, by: "cues" | "beats"): string[] {
  return mechanicMoments(blueprint).flatMap(({ moment, path }) => ((path[0] === "beats") === (by === "beats") && isMomentOf(moment, mechanicId) ? [moment.cue] : []));
}

const isTriggerList = (built: readonly Trigger[] | MechanicTriggers): built is readonly Trigger[] => Array.isArray(built);

/** A trigger or variable as far as core checks a hook's result before using it: an object with an id and a name. */
const TriggerLike = z.looseObject({ id: z.string().min(1), name: z.string().min(1) });
const MechanicTriggersResultSchema = z.union([
  z.array(TriggerLike),
  z
    .object({
      triggers: z.array(TriggerLike),
      variables: z.array(TriggerLike).optional(),
      clocks: z.array(TriggerLike).optional(),
      beatActions: z.record(z.string(), z.array(z.looseObject({ id: z.string().min(1) }))).optional(),
      victoryActions: z.custom<(path: string) => unknown>((value) => typeof value === "function", "Expected a function").optional(),
    })
    .strict(),
]);
const MechanicGameDataResultSchema = z
  .object({
    catalogs: z.record(z.string(), z.array(z.string())).optional(),
    strings: z.record(z.string(), z.string()).optional(),
    hotkeys: z.record(z.string(), z.string()).optional(),
  })
  .strict();

/** Refuses a hook's result that isn't the shape its contract promises, naming the Mechanic and the hook. */
function checkResult(label: string, hook: string, schema: z.ZodType, result: unknown): void {
  const parsed = schema.safeParse(result);
  if (!parsed.success) {
    throw new Error(`${label}: its ${hook} hook returned ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(result)"}: ${issue.message}`).join("; ")}`);
  }
}

/**
 * A Plugin Mechanic's triggers use only typed primitives (ADR-0002, ADR-0005): core's, and the ones
 * the Mechanic contributes. Anything else fails the compile, naming the Mechanic and the primitive,
 * and so does one that reuses a known primitive's id with other parameters or another form.
 */
function checkPrimitives(label: string, mechanic: Mechanic, hook: string, calls: readonly TriggerCall[], variables: readonly TriggerVariable[] = [], library: CampaignLibrary = NO_LIBRARY): void {
  const own = <Def extends { readonly library: TriggerLibrary; readonly id: string }>(defs: Readonly<Record<string, Def>> | undefined): ReadonlyMap<string, Def> =>
    new Map(Object.values(defs ?? {}).map((def) => [primitiveKey(def), def]));
  const known = {
    // The Campaign Mod's library's functions, as its interface declares them, beside core's and the Mechanic's.
    functions: [CORE_PRIMITIVES.functions, own(mechanic.primitives?.functions), own(library.functions)],
    presets: [CORE_PRIMITIVES.presets, own(mechanic.primitives?.presets)],
    subFunctions: [CORE_PRIMITIVES.subFunctions, own(mechanic.primitives?.subFunctions)],
  } as const;
  const check = <Def extends FunctionDef | PresetDef | SubFunctionDef>(what: string, sources: readonly ReadonlyMap<string, Def>[], def: Def): void => {
    const key = primitiveKey(def);
    const registered = sources.map((source) => source.get(key)).find((candidate) => candidate !== undefined);
    if (!registered) {
      throw new Error(`${label}: its ${hook} used the ${what} ${key}, which neither core nor the Mechanic's primitives provide`);
    }
    if (!samePrimitive(registered, def)) {
      throw new Error(`${label}: its ${hook} used a ${what} ${key} that differs from the one ${sources[0]!.has(key) ? "core" : "the Mechanic's primitives"} provide${sources[0]!.has(key) ? "s" : ""}`);
    }
  };
  const checkPreset = (preset: PresetDef): void => check("preset", known.presets, preset);
  const seenVariables = new Set<TriggerVariable>();
  const checkVariable = (variable: TriggerVariable): void => {
    if (seenVariables.has(variable)) return;
    seenVariables.add(variable);
    checkValue(variable.initial.value);
  };
  const checkValue = (value: TriggerParam["value"]): void => {
    if (value.kind === "preset") checkPreset(value.preset);
    if (value.kind === "variable") checkVariable(value.variable);
    if (value.kind === "call") visit(value.call);
  };
  const visit = (call: TriggerCall): void => {
    check("trigger function", known.functions, call.def);
    for (const param of Object.values(call.params)) checkValue(param.value);
    for (const block of call.blocks ?? []) {
      check("block sub-function", known.subFunctions, block.type);
      block.calls.forEach(visit);
    }
  };
  calls.forEach(visit);
  variables.forEach(checkVariable);
}

/** Each Plugin Mechanic's map-local data, in Blueprint order, with the Mechanic entry that made it. */
export type MechanicGameDataMade = readonly { readonly data: MechanicGameData; readonly label: string }[];

/**
 * Runs each Plugin Mechanic's buildGameData hook once, for one compile: pass the result to
 * buildMissionGameData, buildMissionGameStrings and buildMissionGameHotkeys, so the hooks run once
 * rather than once each, and nothing is kept between compiles.
 */
export function buildMechanicGameData(blueprint: MissionBlueprint): MechanicGameDataMade {
  const context = mechanicContext(blueprint);
  return pluginMechanicEntries(blueprint).flatMap(({ id, mechanic, params, label }) => {
    if (!mechanic.buildGameData) return [];
    const data = runHook(label, "buildGameData hook", () => mechanic.buildGameData!(params, { ...context, mechanicId: id }));
    checkResult(label, "buildGameData", MechanicGameDataResultSchema, data);
    return [{ data, label }];
  });
}

/** Each Plugin Mechanic's warnings for the author, in Blueprint order, each naming its Mechanic entry. */
export function buildMechanicWarnings(blueprint: MissionBlueprint): string[] {
  const context = mechanicContext(blueprint);
  return pluginMechanicEntries(blueprint).flatMap(({ id, mechanic, params, label }) => {
    if (!mechanic.warnings) return [];
    const warnings = runHook(label, "warnings hook", () => mechanic.warnings!(params, { ...context, mechanicId: id }));
    checkResult(label, "warnings", z.array(z.string()), warnings);
    return warnings.map((warning) => `${label}: ${warning}`);
  });
}

/** One table of strings or hotkeys from every Plugin Mechanic; two setting one key fails, naming both. */
function pluginMechanicTable(made: MechanicGameDataMade, table: "strings" | "hotkeys"): Record<string, string> {
  const merged: Record<string, string> = {};
  const setBy = new Map<string, string>();
  for (const { data, label } of made) {
    for (const [key, value] of Object.entries(data[table] ?? {})) {
      const clash = setBy.get(key);
      if (clash) throw new Error(`Two Mechanics set the ${table === "strings" ? "game string" : "hotkey"} ${key}: ${clash} and ${label}`);
      setBy.set(key, label);
      merged[key] = value;
    }
  }
  return merged;
}

function collectIds(doc: TriggerDocument): string[] {
  const ids: string[] = [];
  const visit = (call: TriggerCall): void => {
    ids.push(call.id);
    for (const param of Object.values(call.params)) ids.push(param.id);
    nestedCalls(call).forEach(visit);
  };
  for (const variable of doc.variables) {
    ids.push(variable.id, variable.initial.id);
    if (variable.initial.value.kind === "call") visit(variable.initial.value.call);
  }
  for (const trigger of doc.triggers) {
    ids.push(trigger.id);
    triggerCalls(trigger).forEach(visit);
  }
  return ids;
}

const catalogFile = (body: readonly string[]): string =>
  ['<?xml version="1.0" encoding="utf-8"?>', "<Catalog>", ...body, "</Catalog>", ""].join("\r\n");

/**
 * Map-local catalog files, keyed by GameData file name. Static setup lives here rather
 * than in map-init triggers so the Editor shows what the game shows. `cinematicLights` are the
 * Light ids the Mission's Cinematics switch to, so a Plugin's Light among them is written too.
 */
export function buildMissionGameData(blueprint: MissionBlueprint, made: MechanicGameDataMade = buildMechanicGameData(blueprint), cinematicLights: readonly string[] = []): Record<string, string> {
  const files: Record<string, string> = {};
  const lights = lightDataXml(mapLights(blueprint, cinematicLights), lightRegionOverride(blueprint));
  if (lights) files["LightData.xml"] = lights;
  const water = waterDataXml(blueprint);
  if (water) files["WaterData.xml"] = water;
  const actors = compositeActors(blueprint);
  if (actors.length > 0) files["ActorData.xml"] = catalogFile(compositeActorLines(actors));

  // A palette's textures may come from other tilesets: override the blend textures whenever they differ.
  const catalog = blueprintCatalog(blueprint);
  const blend = blueprint.textures ?? (blueprint.texturePalette ? missionTextures(catalog, blueprint).filter(Boolean) : undefined);
  const stock = getTilesetTextures(catalog, blueprint.tilesetId ?? "KorhalCityEx2");
  const overridesTextures = blend !== undefined && blend.some((name, index) => name !== stock[index]);
  const sky = skyTerrainFields(blueprint);
  if (blueprint.lighting || overridesTextures || sky.length > 0) {
    // Partial override of the stock tileset, as Kept maps can do for KorhalCityEx2.
    const tileset = blueprint.tilesetId ?? "KorhalCityEx2";
    files["TerrainData.xml"] = catalogFile([
      `    <CTerrain id="${tileset}">`,
      ...(blueprint.lighting ? [`        <Lighting value="${blueprint.lighting}"/>`] : []),
      ...(overridesTextures ? blend : []).map((texture, index) => `        <BlendTextures index="${index}" value="${texture}"/>`),
      ...sky,
      "    </CTerrain>",
    ]);
  }

  // Mechanics share catalog files, so collect their entries per file first.
  const catalogs = new Map<string, string[]>();
  const add = (fileName: string, lines: readonly string[]): void => {
    catalogs.set(fileName, [...(catalogs.get(fileName) ?? []), ...lines]);
  };
  for (const { data } of made) {
    for (const [fileName, lines] of Object.entries(data.catalogs ?? {})) add(fileName, lines);
  }
  for (const [fileName, lines] of catalogs) {
    if (files[fileName]) throw new Error(`Two sources write ${fileName}`);
    files[fileName] = catalogFile(lines);
  }
  return files;
}

/** Hotkeys for the Mechanics' buttons (GameHotkeys.txt). */
export function buildMissionGameHotkeys(blueprint: MissionBlueprint, made: MechanicGameDataMade = buildMechanicGameData(blueprint)): Record<string, string> {
  return pluginMechanicTable(made, "hotkeys");
}

/** Display names and tooltips for the Mechanics' map-local data (GameStrings.txt). */
export function buildMissionGameStrings(blueprint: MissionBlueprint, made: MechanicGameDataMade = buildMechanicGameData(blueprint)): Record<string, string> {
  return pluginMechanicTable(made, "strings");
}
