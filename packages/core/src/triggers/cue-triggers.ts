// The triggers of four cue shapes (#420, #488), each firing once and playing what its cue plays:
//
// - "Cue - <Anchor> Within <d> Of <target>": a unit nearing another (anchorNears). The target's
//   unit, or any of a player's units of a type, coming within range of the Anchor's unit, so either
//   may move. The unit neared is kept in a unit variable (cueUnitVariable) for the scene to film.
// - "Cue - <Anchor> Starts <effect>": the Anchor's unit starting a data effect (effectStarts). The
//   effect's target unit, or its caster for an effect on a point, is kept the same way, so the scene
//   films exactly the unit the data struck.
// - "Cue - Player <p> Loses <type>": a player's structures of a type dying (structureDies). One
//   trigger per player and type counts the deaths and plays each count's cues once, at that count.
// - "Encounter Ends - <zone>": an encounter's end (encounterEnds), the first of the ends it declares:
//   "Encounter Timer - <zone>" waits its afterSeconds from the encounter's start,
//   "Encounter Damage - <zone>" (on from its start) adds up the damage its attackers take, and
//   "Encounter Behavior - <zone>" (on from its start) waits for the Behavior the start adds to its
//   Anchor's unit to go, or the unit to die.

import { bookmarkEventName } from "../domain/cinematic.js";
import { blueprintCues, type Cue, type MissionBlueprint, type OutcomeCondition, type ScenePart } from "../domain/mission-blueprint.js";
import { anchorNameOf, isWaveUnit, unitValueOf } from "./kept-ids.js";
import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P } from "./trigger-catalog.js";
import { behaviorLink, call, callValue, compare, ifAlive, ifThen, runTrigger, stableElementId, titleWords, triggerVariable, turnOffCurrentTrigger, unitIsAlive } from "./trigger-builders.js";
import type { BindActions } from "./wave-triggers.js";
import type { Trigger, TriggerCall, TriggerParam, TriggerRef, TriggerVariable } from "./trigger-model.js";

type AnchorNears = Extract<Cue, { type: "anchorNears" }>;
type EffectStarts = Extract<Cue, { type: "effectStarts" }>;
type StructureDies = Extract<Cue, { type: "structureDies" }>;
type CinematicBookmark = Extract<Cue, { type: "cinematicBookmark" }>;
type Encounter = MissionBlueprint["encounters"][number];

/** What a cue plays, for the cues `matches` picks (build-mission-triggers' SceneActions). */
type SceneActions = (matches: (cue: Cue) => boolean) => TriggerCall[];

/** A number as a name's or path's piece: 7.5 is 7_5. */
const numberPiece = (value: number): string => String(value).replace(".", "_");
/** An id as a Galaxy name's piece: each run of other characters is one underscore, so `a-b` isn't `ab`. */
const namePiece = (id: string): string => id.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();

/** The path of one of these cues, so the same transition run from two triggers gets two ids (cuePath). */
export function cueTriggerPath(cue: AnchorNears | EffectStarts | StructureDies | CinematicBookmark | Extract<Cue, { type: "encounterEnds" }>): string {
  switch (cue.type) {
    case "cinematicBookmark":
      // A cue that fires on a skip is a trigger of its own: the Cinematic's cleanup runs it, and one that doesn't must not be run.
      return `cinematics/${cue.cinematicId}/bookmarks/${cue.bookmark}/${cue.onSkip ?? "skip"}`;
    case "anchorNears":
      return `anchors/${cue.anchorId}/nears/${cue.targetId ?? `player/${cue.player}/${cue.unitType}`}/${numberPiece(cue.distance)}`;
    case "effectStarts":
      return `anchors/${cue.anchorId}/effects/${cue.effectId}/starts`;
    case "structureDies":
      return `structures/${cue.player}/${cue.unitType}/dies/${cue.count ?? 1}`;
    case "encounterEnds":
      return `encounter/${cue.encounterId}/ends`;
  }
}

/** Where a cue entry's or scenePlayed cue's part or line goes in an element path: `S07>4/`, `line/<sound ID>/`, or nothing for the whole scene. */
export const partPath = ({ from, line }: Omit<ScenePart, "scene">): string => (from !== undefined ? `${from}/` : line !== undefined ? `line/${line}/` : "");

/**
 * The path of an outcome condition, shared by the triggers it and the cues on it make. One armed
 * from a Beat (`fromBeat`) is a condition of its own, apart from the same event armed from map start.
 */
export function conditionPath(condition: OutcomeCondition): string {
  const path = eventPath(condition);
  return condition.fromBeat === undefined ? path : `${path}/from/${condition.fromBeat}`;
}

function eventPath(condition: OutcomeCondition): string {
  switch (condition.type) {
    case "anchorDies":
      return `anchors/${condition.anchorId}/dies`;
    case "anchorEntersZone":
      return `anchors/${condition.anchorId}/enters/${condition.zoneId}`;
    case "anchorCaptured":
      return `anchors/${condition.anchorId}/captured`;
    case "timer":
      return `goals/timer/${condition.seconds}`;
    case "resourceQuota":
      return `goals/quota/${condition.resource}/${condition.amount}`;
    case "objectivesComplete":
      // The same Objectives, in whatever order, and a count of all of them, are one condition.
      return `goals/objectives/${[...condition.objectiveIds].sort().join("+")}/${condition.exactly ? "exactly" : objectivesNeeded(condition)}`;
  }
}

/** How many of an objectivesComplete's Objectives it waits for: its `count`, or all of them. */
export const objectivesNeeded = (condition: { readonly objectiveIds: readonly string[]; readonly count?: number | undefined }): number => condition.count ?? condition.objectiveIds.length;

/** A cue as a path segment, so the same transition run from two triggers gets two ids. */
export function cuePath(cue: Cue): string {
  switch (cue.type) {
    case "anchorDies":
    case "anchorEntersZone":
    case "anchorCaptured":
    case "objectivesComplete":
      return conditionPath(cue);
    case "encounter":
      return `encounter/${cue.encounterId}`;
    case "mechanic":
      return `mechanic/${cue.mechanicId}/${cue.cue}`;
    case "keptTriggerRuns":
      return `kept/${cue.triggerId}`;
    case "beatStarts":
      return `beat/${cue.beatId}`;
    case "anchorNears":
    case "effectStarts":
    case "structureDies":
    case "encounterEnds":
    case "cinematicBookmark":
      return cueTriggerPath(cue);
    case "scenePlayed":
      return `scene/${cue.scene}/${partPath(cue)}played`;
    default:
      return cue.type;
  }
}

const sameNears = (a: AnchorNears, b: Cue): boolean => b.type === "anchorNears" && cueTriggerPath(a) === cueTriggerPath(b);

/** A kept unit's name as its cue gives it: namePiece's, so two cues apart may give one (`StrikeA` and `strikea`, `Strike-Hit` and `Strike_Hit`). */
function keptUnitName(cue: AnchorNears | EffectStarts): string {
  if (cue.type === "effectStarts") return `cue_unit_${namePiece(cue.anchorId)}_starts_${namePiece(cue.effectId)}`;
  // Its distance's point is a "p", so `y_1` at 5 and `y` at 1.5 keep apart.
  const target = cue.targetId ?? `player_${cue.player}_${cue.unitType}`;
  return `cue_unit_${namePiece(cue.anchorId)}_nears_${namePiece(target)}_${String(cue.distance).replace(".", "p")}`;
}

const keepsUnit = (cue: Cue): cue is AnchorNears | EffectStarts => cue.type === "anchorNears" || cue.type === "effectStarts";

/**
 * The unit a cue keeps, set as the cue fires and before what it plays: for anchorNears the unit its
 * Anchor came near (the target Anchor's unit, or whichever of the player's units of the type it
 * was); for effectStarts the effect's target unit, or its caster for an effect on a point. A scene
 * the cue plays films it here (a camera aimed at a unit, #425). Its name is its cue's; where another
 * of the Blueprint's cues, apart from it, gives the same name, each takes its path's element id too,
 * so no two are one global.
 */
export function cueUnitVariable(blueprint: MissionBlueprint, cue: AnchorNears | EffectStarts): TriggerVariable {
  const path = cueTriggerPath(cue);
  const name = keptUnitName(cue);
  const clash = blueprintCues(blueprint).some(({ cue: other }) => keepsUnit(other) && cueTriggerPath(other) !== path && keptUnitName(other) === name);
  return triggerVariable(`${path}/variables/unit`, clash ? `${name}_${stableElementId(path).toLowerCase()}` : name, "unit", { kind: "preset", preset: P.noUnit });
}

/** The unit a cue keeps for the scenes it plays, if it keeps one: an anchorNears or effectStarts cue's (cueUnitVariable). */
export const cueUnitOf = (blueprint: MissionBlueprint, cue: Cue): TriggerVariable | undefined => (keepsUnit(cue) ? cueUnitVariable(blueprint, cue) : undefined);

const triggeringUnit = (path: string): TriggerParam["value"] => callValue(path, F.triggeringUnit, {});
const equal = (path: string, left: TriggerParam["value"], right: TriggerParam["value"]): TriggerCall => compare(path, left, P.compareEqual, right);
/** Triggering Unit is `unitType`, and `player`'s. */
const triggeringUnitIs = (path: string, unitType: string, player: number): TriggerCall[] => [
  equal(`${path}/type`, callValue(`${path}/type/of`, F.unitTypeOf, { unit: triggeringUnit(`${path}/type/of/unit`) }), { kind: "gamelink", gameType: "Unit", value: unitType }),
  equal(`${path}/owner`, callValue(`${path}/owner/of`, F.unitOwner, { unit: triggeringUnit(`${path}/owner/of/unit`) }), { kind: "int", value: player }),
];
const enableTrigger = (path: string, trigger: TriggerRef, on: boolean): TriggerCall =>
  call(path, F.triggerEnable, { trigger: { kind: "trigger", trigger }, state: { kind: "preset", preset: on ? P.triggerOn : P.triggerOff } });

/** How often, in game seconds, an anchorNears cue on a Wave's unit looks for its target in range. */
const NEARS_CHECK_SECONDS = 0.25;


/**
 * Each distinct anchorNears cue's trigger and kept unit. The event "Unit Enters Range Of Unit"
 * reads the unit it measures from as the map starts, so a cue that names a Wave's unit (there
 * only once its send creates it, kept-ids' unitValueOf) looks instead, every NEARS_CHECK_SECONDS,
 * for the target within its distance of the Anchor's unit's position. That check starts off, and
 * the send that binds a Wave's unit it names turns it on (onBind) unless it has fired, so it never
 * runs where the unit never comes (a count of 0); it turns itself off once a unit it needs isn't
 * alive. With two Wave units, the first bind's check stops at once if the second isn't there yet,
 * and the second's turns it on again.
 */
function nearsTriggers(blueprint: MissionBlueprint, cues: readonly AnchorNears[], scenes: SceneActions): { triggers: Trigger[]; variables: TriggerVariable[]; onBind: BindActions } {
  const distinct = [...new Map(cues.map((cue) => [cueTriggerPath(cue), cue])).values()];
  const named = (cue: AnchorNears): TriggerRef => {
    const target = cue.targetId !== undefined ? anchorNameOf(blueprint, cue.targetId) : `Player ${cue.player} ${cue.unitType}`;
    return { id: stableElementId(`cues/${cueTriggerPath(cue)}`), name: `Cue - ${anchorNameOf(blueprint, cue.anchorId)} Within ${numberPiece(cue.distance)} Of ${target}` };
  };
  const checked = distinct.filter((cue) => isWaveUnit(blueprint, cue.anchorId) || (cue.targetId !== undefined && isWaveUnit(blueprint, cue.targetId)));
  const onBind: BindActions = (anchorId, path) =>
    checked
      .filter((cue) => cue.anchorId === anchorId || cue.targetId === anchorId)
      .map((cue) => {
        const at = `${path}/${cueTriggerPath(cue)}`;
        return ifThen(at, equal(`${at}/if`, { kind: "variable", variable: cueUnitVariable(blueprint, cue) }, { kind: "preset", preset: P.noUnit }), [enableTrigger(`${at}/on`, named(cue), true)]);
      });
  const triggers = distinct.map((cue): Trigger => {
    const path = `cues/${cueTriggerPath(cue)}`;
    const anchor: TriggerParam["value"] = unitValueOf(blueprint, cue.anchorId);
    const kept: TriggerParam["value"] = { kind: "variable", variable: cueUnitVariable(blueprint, cue) };
    const plays = () => scenes((candidate) => sameNears(cue, candidate));
    if (checked.includes(cue)) {
      const targetUnit = cue.targetId !== undefined ? unitValueOf(blueprint, cue.targetId) : undefined;
      const stop = (at: string) => [turnOffCurrentTrigger(at)];
      // Looked for only while both are alive; else off, until a bind turns it on again.
      const whileAlive = (calls: TriggerCall[]): TriggerCall[] => [
        ifAlive(`${path}/anchor`, anchor, targetUnit ? [ifAlive(`${path}/target`, targetUnit, calls, stop(`${path}/target/off`))] : calls, stop(`${path}/anchor/off`)),
      ];
      return {
        ...named(cue),
        initiallyOff: true,
        events: [call(`${path}/event`, F.periodicEvent, { duration: { kind: "fixed", value: NEARS_CHECK_SECONDS }, timeType: { kind: "preset", preset: P.timeGame } })],
        actions: whileAlive(targetUnit
          ? [
              // Measured point to point, as the range event measures, with no region to build each check.
              ifThen(`${path}/near`, call(`${path}/near/if`, F.comparison, {
                left: callValue(`${path}/near/if/distance`, F.distanceBetweenPoints, {
                  from: callValue(`${path}/near/if/distance/from`, F.unitPosition, { unit: anchor }),
                  to: callValue(`${path}/near/if/distance/to`, F.unitPosition, { unit: targetUnit }),
                }),
                operator: { kind: "preset", preset: P.compareLessOrEqual },
                right: { kind: "fixed", value: cue.distance },
              }), [
                turnOffCurrentTrigger(`${path}/once`),
                call(`${path}/keep`, F.setVariable, { variable: kept, value: targetUnit }),
                ...plays(),
              ]),
            ]
          : [
              // The first of the player's units of the type in range, or none.
              call(`${path}/keep`, F.setVariable, {
                variable: kept,
                value: callValue(`${path}/keep/unit`, F.unitGroupUnit, {
                  group: callValue(`${path}/keep/unit/group`, F.unitsInRegionMatching, {
                    unitType: { kind: "gamelink", gameType: "Unit", value: cue.unitType! },
                    player: { kind: "int", value: cue.player! },
                    region: callValue(`${path}/keep/unit/group/circle`, F.regionCircle, { center: callValue(`${path}/keep/unit/group/circle/center`, F.unitPosition, { unit: anchor }), radius: { kind: "fixed", value: cue.distance } }),
                    filter: { kind: "unitfilter", require: [], exclude: ["Dead"] },
                    count: { kind: "preset", preset: P.anyAmount },
                  }),
                  index: { kind: "int", value: 1 },
                }),
              }),
              ifThen(`${path}/near`, unitIsAlive(`${path}/near/if`, kept), [turnOffCurrentTrigger(`${path}/once`), ...plays()]),
            ]),
      };
    }
    // The unit that comes is the target (or any unit, then checked), into range of the Anchor's unit.
    const coming: TriggerParam["value"] = cue.targetId !== undefined ? unitValueOf(blueprint, cue.targetId) : { kind: "preset", preset: P.anyUnit };
    return {
      ...named(cue),
      events: [call(`${path}/event`, F.unitEntersRangeOfUnit, { unit: coming, fromUnit: anchor, range: { kind: "fixed", value: cue.distance }, state: { kind: "preset", preset: P.regionEnters } })],
      conditions: cue.targetId === undefined ? triggeringUnitIs(`${path}/target`, cue.unitType!, cue.player!) : [],
      actions: [
        turnOffCurrentTrigger(`${path}/once`),
        call(`${path}/keep`, F.setVariable, { variable: kept, value: triggeringUnit(`${path}/keep/unit`) }),
        ...plays(),
      ],
    };
  });
  return { triggers, variables: distinct.map((cue) => cueUnitVariable(blueprint, cue)), onBind };
}

/**
 * Each distinct effectStarts cue's trigger and kept unit. Player Uses Effect fires for any player's
 * use of the effect, so a unit that has changed hands still fires it, and its condition is that the
 * effect's caster is the Anchor's unit. A Wave's unit is read from its variable as the event comes
 * (kept-ids' unitValueOf): none until its send creates it, so no caster matches before (an effect
 * with no caster unit doesn't match), and no bind turns anything on. The caster stays the Anchor's unit down a chain of effects, so the effect named
 * may be one a search applies to the unit it found.
 */
function effectTriggers(blueprint: MissionBlueprint, cues: readonly EffectStarts[], scenes: SceneActions): { triggers: Trigger[]; variables: TriggerVariable[] } {
  const distinct = [...new Map(cues.map((cue) => [cueTriggerPath(cue), cue])).values()];
  const triggers = distinct.map((cue): Trigger => {
    const path = `cues/${cueTriggerPath(cue)}`;
    const kept: TriggerParam["value"] = { kind: "variable", variable: cueUnitVariable(blueprint, cue) };
    const effectUnit = (at: string, location: "caster" | "target"): TriggerParam["value"] =>
      callValue(at, F.effectUsedUnit, { location: { kind: "preset", preset: location === "caster" ? P.effectUnitCaster : P.effectUnitTarget } });
    return {
      id: stableElementId(path),
      name: `Cue - ${anchorNameOf(blueprint, cue.anchorId)} Starts ${cue.effectId}`,
      events: [call(`${path}/event`, F.playerEffectUsed, { player: { kind: "preset", preset: P.anyPlayer }, effect: { kind: "gamelink", gameType: "Effect", value: cue.effectId } })],
      conditions: [
        // A caster at all, so an effect with none never matches a Wave's unit not yet there (none too).
        call(`${path}/caster/any`, F.comparison, { left: effectUnit(`${path}/caster/any/unit`, "caster"), operator: { kind: "preset", preset: P.compareNotEqual }, right: { kind: "preset", preset: P.noUnit } }),
        equal(`${path}/caster`, effectUnit(`${path}/caster/unit`, "caster"), unitValueOf(blueprint, cue.anchorId)),
      ],
      actions: [
        turnOffCurrentTrigger(`${path}/once`),
        call(`${path}/keep`, F.setVariable, { variable: kept, value: effectUnit(`${path}/keep/unit`, "target") }),
        // An effect on a point has no target unit: the scene films the caster, which is surely there.
        ifThen(`${path}/point`, equal(`${path}/point/if`, kept, { kind: "preset", preset: P.noUnit }), [
          call(`${path}/point/keep`, F.setVariable, { variable: kept, value: effectUnit(`${path}/point/keep/unit`, "caster") }),
        ]),
        ...scenes((candidate) => candidate.type === "effectStarts" && cueTriggerPath(candidate) === cueTriggerPath(cue)),
      ],
    };
  });
  return { triggers, variables: distinct.map((cue) => cueUnitVariable(blueprint, cue)) };
}

/** One trigger per player and structure type, counting its deaths; each count's cues play once, at that count, and it turns off after the last. */
function diesTriggers(cues: readonly StructureDies[], scenes: SceneActions): { triggers: Trigger[]; variables: TriggerVariable[] } {
  const groups = new Map<string, { player: number; unitType: string; counts: Set<number> }>();
  for (const cue of cues) {
    const key = `${cue.player}/${cue.unitType}`;
    const group = groups.get(key) ?? { player: cue.player, unitType: cue.unitType, counts: new Set<number>() };
    group.counts.add(cue.count ?? 1);
    groups.set(key, group);
  }
  const triggers: Trigger[] = [];
  const variables: TriggerVariable[] = [];
  for (const { player, unitType, counts } of groups.values()) {
    const path = `cues/structures/${player}/${unitType}`;
    const lost = triggerVariable(`${path}/variables/lost`, `cue_structures_${player}_${namePiece(unitType)}_lost`, "int", { kind: "int", value: 0 });
    const lostValue: TriggerParam["value"] = { kind: "variable", variable: lost };
    const ordered = [...counts].sort((a, b) => a - b);
    variables.push(lost);
    triggers.push({
      id: stableElementId(path),
      name: `Cue - Player ${player} Loses ${unitType}`,
      events: [call(`${path}/event`, F.unitDies, { unit: { kind: "preset", preset: P.anyUnit } })],
      conditions: triggeringUnitIs(`${path}/dying`, unitType, player),
      actions: [
        call(`${path}/count`, F.setVariable, {
          variable: lostValue,
          value: callValue(`${path}/count/plus`, F.arithmeticInt, { left: lostValue, operator: { kind: "preset", preset: P.plus }, right: { kind: "int", value: 1 } }),
        }),
        ...ordered.map((count, index) =>
          ifThen(`${path}/at/${count}`, equal(`${path}/at/${count}/if`, lostValue, { kind: "int", value: count }), [
            ...scenes((cue) => cue.type === "structureDies" && cue.player === player && cue.unitType === unitType && (cue.count ?? 1) === count),
            // Then nothing more, so the warning never nags.
            ...(index === ordered.length - 1 ? [turnOffCurrentTrigger(`${path}/at/${count}/done`)] : []),
          ]),
        ),
      ],
    });
  }
  return { triggers, variables };
}

const encounterPath = (encounter: Encounter): string => `encounters/${encounter.id}`;
const encounterRefs = (
  blueprint: MissionBlueprint,
  encounter: Encounter,
): { readonly ends: TriggerRef; readonly timer: TriggerRef; readonly damage: TriggerRef; readonly behavior: TriggerRef } => {
  const zone = blueprint.zones.find((candidate) => candidate.id === encounter.triggerZoneId)?.name ?? encounter.triggerZoneId;
  const path = encounterPath(encounter);
  return {
    ends: { id: stableElementId(`${path}/ends`), name: `Encounter Ends - ${zone}` },
    timer: { id: stableElementId(`${path}/ends/timer`), name: `Encounter Timer - ${zone}` },
    damage: { id: stableElementId(`${path}/ends/damage`), name: `Encounter Damage - ${zone}` },
    behavior: { id: stableElementId(`${path}/ends/behavior`), name: `Encounter Behavior - ${zone}` },
  };
};

/** The ends an encounter declares: the first of its `endsWhen`'s and its Behavior's going. */
type EncounterEnds = NonNullable<Encounter["endsWhen"]> & Pick<Encounter, "behavior">;

/** The encounter's declared ends, when a cue plays something on them: an end nothing plays on isn't compiled. */
const cuedEnds = (blueprint: MissionBlueprint, encounter: Encounter): EncounterEnds | undefined =>
  blueprintCues(blueprint).some(({ cue }) => cue.type === "encounterEnds" && cue.encounterId === encounter.id) && (encounter.endsWhen || encounter.behavior)
    ? { ...encounter.endsWhen, behavior: encounter.behavior }
    : undefined;

/** One stack of the Behavior on the unit, the unit its own caster. */
const addBehavior = (path: string, unit: TriggerParam["value"], behavior: string): TriggerCall =>
  call(path, F.addBehavior, { unit, behavior: behaviorLink(behavior), caster: unit, count: { kind: "int", value: 1 } });

/** "If <the unit> has none of the Behavior, run the encounter's end": UnitHasBehavior2 counts every stack and instance. */
const endIfNoBehavior = (path: string, unit: TriggerParam["value"], behavior: string, ends: TriggerRef): TriggerCall =>
  ifThen(path, equal(`${path}/if`, callValue(`${path}/has`, F.unitHasBehavior, { unit, behavior: behaviorLink(behavior) }), { kind: "bool", value: false }), [runTrigger(`${path}/end`, ends)]);

/**
 * What an encounter's start trigger runs for its ends, around the scenes its start plays. Before
 * them: its Behavior added to the Anchor's unit (cued or not, as the data may do more than time
 * the end), and for the ends a cue plays on, the damage count and Behavior watch turned on first
 * and the timer run without waiting. After them: a unit already dead, or one the Behavior didn't
 * take on, would never lose it, so the end comes then, after the start's scenes and not over them.
 */
export function encounterEndStart(blueprint: MissionBlueprint, encounter: Encounter): { readonly before: TriggerCall[]; readonly after: TriggerCall[] } {
  const ends = cuedEnds(blueprint, encounter);
  const path = `${encounterPath(encounter)}/ends/start`;
  const refs = encounterRefs(blueprint, encounter);
  const { behavior } = encounter;
  const unit: TriggerParam["value"] | undefined = behavior && unitValueOf(blueprint, behavior.anchorId);
  return {
    before: [
      ...(ends?.damageTaken !== undefined ? [enableTrigger(`${path}/damage`, refs.damage, true)] : []),
      ...(ends?.behavior ? [enableTrigger(`${path}/behavior/watch`, refs.behavior, true)] : []),
      ...(behavior && unit ? [addBehavior(`${path}/behavior/add`, unit, behavior.behavior)] : []),
      ...(ends?.afterSeconds !== undefined ? [runTrigger(`${path}/timer`, refs.timer)] : []),
    ],
    after: ends?.behavior && unit ? [endIfNoBehavior(`${path}/behavior/missing`, unit, ends.behavior.behavior, refs.ends)] : [],
  };
}

/** Each encounter with a declared end that a cue plays on: its end, timer, damage and Behavior triggers. */
function encounterEndTriggers(blueprint: MissionBlueprint, scenes: SceneActions): { triggers: Trigger[]; encounterOf: Map<Trigger, string>; variables: TriggerVariable[] } {
  const triggers: Trigger[] = [];
  const encounterOf = new Map<Trigger, string>();
  const variables: TriggerVariable[] = [];
  for (const encounter of blueprint.encounters) {
    const ends = cuedEnds(blueprint, encounter);
    if (!ends) continue;
    // This encounter's triggers are those pushed from here on.
    const first = triggers.length;
    const path = `${encounterPath(encounter)}/ends`;
    const refs = encounterRefs(blueprint, encounter);
    const ended = triggerVariable(`${path}/variables/ended`, `encounters_${namePiece(encounter.id)}_ended`, "bool", { kind: "bool", value: false });
    variables.push(ended);
    triggers.push({
      ...refs.ends,
      events: [],
      // Once, whichever end comes first.
      conditions: [equal(`${path}/once`, { kind: "variable", variable: ended }, { kind: "bool", value: false })],
      actions: [
        call(`${path}/ended`, F.setVariable, { variable: { kind: "variable", variable: ended }, value: { kind: "bool", value: true } }),
        ...(ends.damageTaken !== undefined ? [enableTrigger(`${path}/damage/off`, refs.damage, false)] : []),
        ...(ends.behavior ? [enableTrigger(`${path}/behavior/off`, refs.behavior, false)] : []),
        ...scenes((cue) => cue.type === "encounterEnds" && cue.encounterId === encounter.id),
      ],
    });
    if (ends.afterSeconds !== undefined) {
      triggers.push({
        ...refs.timer,
        events: [],
        // AI time, which a scene pauses while it plays, so the time counts play.
        actions: [call(`${path}/timer/wait`, F.wait, { time: { kind: "fixed", value: ends.afterSeconds }, timeType: { kind: "preset", preset: P.timeAI } }), runTrigger(`${path}/timer/end`, refs.ends)],
      });
    }
    if (ends.damageTaken !== undefined) {
      const taken = triggerVariable(`${path}/variables/damage`, `encounters_${namePiece(encounter.id)}_damage_taken`, "fixed", { kind: "fixed", value: 0 });
      const takenValue: TriggerParam["value"] = { kind: "variable", variable: taken };
      variables.push(taken);
      triggers.push({
        ...refs.damage,
        // On from the encounter's start (encounterEndStart).
        initiallyOff: true,
        events: encounter.attackerAnchorIds.map((anchorId) =>
          call(`${path}/damage/event/${anchorId}`, F.unitTakesDamage, {
            unit: unitValueOf(blueprint, anchorId),
            damageType: { kind: "preset", preset: P.damageTypeAny },
            fatal: { kind: "preset", preset: P.damageFatalOrNot },
            effect: { kind: "preset", preset: P.anyEffect },
          }),
        ),
        actions: [
          call(`${path}/damage/add`, F.setVariable, {
            variable: takenValue,
            value: callValue(`${path}/damage/add/plus`, F.arithmeticReal, { left: takenValue, operator: { kind: "preset", preset: P.plus }, right: callValue(`${path}/damage/add/amount`, F.damageAmount, {}) }),
          }),
          ifThen(
            `${path}/damage/enough`,
            call(`${path}/damage/enough/if`, F.comparison, { left: takenValue, operator: { kind: "preset", preset: P.compareAtLeast }, right: { kind: "fixed", value: ends.damageTaken } }),
            [runTrigger(`${path}/damage/end`, refs.ends)],
          ),
        ],
      });
    }
    if (ends.behavior) {
      const unit: TriggerParam["value"] = unitValueOf(blueprint, ends.behavior.anchorId);
      triggers.push({
        ...refs.behavior,
        // On from the encounter's start (encounterEndStart).
        initiallyOff: true,
        events: [
          call(`${path}/behavior/event/gone`, F.unitBehaviorChanges, { unit, behavior: behaviorLink(ends.behavior.behavior), change: { kind: "preset", preset: P.behaviorChangeDestroy } }),
          { id: stableElementId(`${path}/behavior/event/dies`), def: F.unitDies, params: { unit: { id: stableElementId(`${path}/behavior/event/dies/unit`), value: unit } } },
        ],
        // One stack or instance going, of several, isn't the end: only none left, or the unit dead.
        actions: [
          // A tick on, so the stack the event names is surely off the unit before it counts what's left.
          call(`${path}/behavior/settle`, F.wait, { time: { kind: "fixed", value: 0 }, timeType: { kind: "preset", preset: P.timeGame } }),
          ifThen(`${path}/behavior/dead`, equal(`${path}/behavior/dead/if`, callValue(`${path}/behavior/dead/alive`, F.unitIsAlive, { unit }), { kind: "bool", value: false }), [
            runTrigger(`${path}/behavior/dead/end`, refs.ends),
          ]),
          endIfNoBehavior(`${path}/behavior/none`, unit, ends.behavior.behavior, refs.ends),
        ],
      });
    }
    for (const trigger of triggers.slice(first)) encounterOf.set(trigger, encounter.id);
  }
  return { triggers, encounterOf, variables };
}

/** The trigger of a cinematicBookmark cue, as the Cinematic's cleanup runs it. */
function bookmarkRef(cue: CinematicBookmark): TriggerRef {
  return {
    id: stableElementId(`cues/${cueTriggerPath(cue)}`),
    name: `Cue - ${titleWords(cue.cinematicId)} Bookmark ${cue.bookmark}${cue.onSkip === "fire" ? " (Fires On Skip)" : ""}`,
  };
}

/**
 * The triggers of the Cinematic `cinematicId`'s bookmark cues that fire when it's skipped
 * (`onSkip: "fire"`), in the order their cues are listed: what its cleanup runs, for each one not
 * run yet, so the Mission is the same however the Cinematic ends.
 */
export function bookmarksFiredOnSkip(blueprint: MissionBlueprint, cinematicId: string): TriggerRef[] {
  const cues = blueprintCues(blueprint).flatMap(({ cue }) => (cue.type === "cinematicBookmark" && cue.cinematicId === cinematicId && cue.onSkip === "fire" ? [cue] : []));
  return [...new Map(cues.map((cue) => [cueTriggerPath(cue), bookmarkRef(cue)])).values()];
}

/**
 * One trigger per distinct cinematicBookmark cue, once: Cutscene Bookmark Fired on any cutscene,
 * named `<Cinematic id>/<bookmark>` as the Cinematic's file writes it, so only that Cinematic's
 * cutscene fires it. It turns itself off first, so the Cinematic's cleanup (which runs a `fire` cue
 * that wasn't reached) finds it off once it has run.
 */
function bookmarkTriggers(cues: readonly CinematicBookmark[], scenes: SceneActions): { triggers: Trigger[]; variables: TriggerVariable[] } {
  const distinct = [...new Map(cues.map((cue) => [cueTriggerPath(cue), cue])).values()];
  const triggers = distinct.map((cue): Trigger => {
    const path = `cues/${cueTriggerPath(cue)}`;
    return {
      ...bookmarkRef(cue),
      events: [
        call(`${path}/event`, F.cutsceneBookmarkFired, {
          cutscene: { kind: "preset", preset: P.anyCutscene },
          bookmark: { kind: "string", value: bookmarkEventName(cue.cinematicId, cue.bookmark) },
        }),
      ],
      conditions: [],
      actions: [turnOffCurrentTrigger(`${path}/once`), ...scenes((candidate) => candidate.type === "cinematicBookmark" && cueTriggerPath(candidate) === cueTriggerPath(cue))],
    };
  });
  return { triggers, variables: [] };
}

/** The triggers and variables of the Blueprint's anchorNears, effectStarts, structureDies, cinematicBookmark and encounterEnds cues. */
export function cueTriggers(
  blueprint: MissionBlueprint,
  cues: readonly Cue[],
  scenes: SceneActions,
): {
  readonly triggers: readonly Trigger[];
  /** Each encounter end's trigger's encounter, by id. */
  readonly encounterOf: ReadonlyMap<Trigger, string>;
  readonly variables: readonly TriggerVariable[];
  readonly onBind: BindActions;
} {
  const nears = nearsTriggers(blueprint, cues.filter((cue): cue is AnchorNears => cue.type === "anchorNears"), scenes);
  const effects = effectTriggers(blueprint, cues.filter((cue): cue is EffectStarts => cue.type === "effectStarts"), scenes);
  const dies = diesTriggers(cues.filter((cue): cue is StructureDies => cue.type === "structureDies"), scenes);
  const bookmarks = bookmarkTriggers(cues.filter((cue): cue is CinematicBookmark => cue.type === "cinematicBookmark"), scenes);
  const ends = encounterEndTriggers(blueprint, scenes);
  return {
    triggers: [...nears.triggers, ...effects.triggers, ...dies.triggers, ...bookmarks.triggers, ...ends.triggers],
    encounterOf: ends.encounterOf,
    variables: [...nears.variables, ...effects.variables, ...dies.variables, ...bookmarks.variables, ...ends.variables],
    onBind: nears.onBind,
  };
}
