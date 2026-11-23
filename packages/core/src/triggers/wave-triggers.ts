// Compiled Waves (docs/adr/0008): each ground Wave is a trigger stream on AI time that creates its
// units at the spawn point and sends them through the AI's wave system along the checker's route.
// A Raid sends only to a target Zone where the player holds a unit of its type, and goes home once
// the player holds none there. A warning pings the minimap when a raider comes within its seconds
// of the aim point.

import { enemyPlayers } from "../ai/enemy-ai.js";
import { UNIT_SPEEDS } from "../ai/unit-speeds.js";
import { DIFFICULTY_NAMES as DIFFICULTIES, isPlaced, type MissionBlueprint, waveUnitCounts, waveUnitAnchors } from "../domain/mission-blueprint.js";
import { buildLayoutModel, cellCentre, deepestCell, groundRoute, type LayoutModel, REFERENCE_SPEED, zonePoint } from "../layout/layout-model.js";
import { expandPlacements } from "../map/expand-placements.js";
import { assumedPlayableBounds, intersect, rectText } from "../map/map-bounds.js";
import { regionIdForZone, type RegionSource, type WrittenRegion } from "../map/write-regions-xml.js";
import { beatsDuring } from "./beat-bounds.js";
import type { Point } from "../terrain/rasterize.js";
import { beatStart } from "./beat-start.js";
import { waveUnitVariable } from "./kept-ids.js";
import { block, call, callValue, type DebugPiece, debugMessage, pickedUnit, stableElementId, triggerVariable, turnOffCurrentTrigger, USER_PLAYER } from "./trigger-builders.js";
import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P, SUB_FUNCTIONS } from "./trigger-catalog.js";
import type { Trigger, TriggerCall, TriggerParam, TriggerVariable } from "./trigger-model.js";

type Wave = MissionBlueprint["waves"][number];

/** A target Zone a compiled Wave can be sent to, and the way there. */
type WaveTarget = {
  readonly zoneId: string;
  /** The Zone's point: a plain Wave's aim, and where the route ends. */
  readonly point: Point;
  /** One per Zone the route enters, in route order: the first cell in each. */
  readonly waypoints: readonly Point[];
  /** With a `warning`: its circle's region (written after the zones' in Regions) and radius. */
  readonly warning?: { readonly regionId: number; readonly radius: number };
};

/** Where a compiled Wave forms, which player sends it, and where it may go: one target, or a Raid's candidates in order. */
type WavePlan = {
  readonly wave: Wave;
  readonly player: number;
  readonly spawn: Point;
  readonly targets: readonly WaveTarget[];
};

export type WaveStreams = {
  readonly variables: readonly TriggerVariable[];
  readonly triggers: readonly Trigger[];
  /** Each trigger's Wave, by id. */
  readonly waveOf: ReadonlyMap<Trigger, string>;
  /** Actions to run as a Beat's trigger starts, by Beat id. */
  readonly beatActions: ReadonlyMap<string, readonly TriggerCall[]>;
  /** Actions to run at map init, once the enemy AI has started: streams of the first Beat. */
  readonly startActions: readonly TriggerCall[];
};

/** A warning's Transmission, by scene id or script scene number, as calls with element ids under `path`. */
export type TransmissionActions = (transmission: string | number, path: string) => TriggerCall[];
/** What else happens as a send binds a Wave's unit to its Anchor: the anchorNears checks on it turned on (cue-triggers' nearsOnBind). */
export type BindActions = (anchorId: string, path: string) => TriggerCall[];

type WavePlans = { readonly plans: readonly WavePlan[]; readonly warnings: readonly string[] };

/** Units appear facing south, as the Editor's default for created units. */
const SPAWN_FACING = 270;
/** How often, in seconds of AI time, a Raid checks whether the player still holds its target. */
const RAID_CHECK_SECONDS = 1;
/** How long a warning's minimap ping lasts, and its colour (red, 0-100 per channel). */
const PING_SECONDS = 5;
const PING_COLOR = [100, 0, 0] as const;

const planned = new WeakMap<MissionBlueprint, WavePlans>();

/** The Blueprint's compiled Waves, worked out once per Blueprint. */
function wavePlans(blueprint: MissionBlueprint): WavePlans {
  const known = planned.get(blueprint);
  if (known) return known;
  const made = planWaves(blueprint);
  planned.set(blueprint, made);
  return made;
}

/** What the compile reports about the Blueprint's Waves: the ones left out of the map, and why. */
export function waveWarnings(blueprint: MissionBlueprint): readonly string[] {
  return wavePlans(blueprint).warnings;
}

/**
 * The regions of the Waves' warnings, one per warned target: a circle of the warning's radius
 * around the target's point. Written right after the zones' regions (see missionRegions), in this
 * order; a Raid moves its circle to the unit it aims at as it sends.
 */
export function waveWarningRegions(blueprint: MissionBlueprint): (WrittenRegion & { readonly source: RegionSource })[] {
  return wavePlans(blueprint).plans.flatMap(({ wave, targets }) =>
    targets.flatMap((target) =>
      target.warning
        ? [
            {
              name: `Wave ${wave.id} Warning ${target.zoneId}`,
              shapes: [{ type: "circle" as const, center: target.point, radius: target.warning.radius }],
              source: { kind: "wave-warning" as const, waveId: wave.id, zoneId: target.zoneId },
            },
          ]
        : [],
    ),
  );
}

/**
 * A warning's radius: its seconds at the wave's speed, else its slowest unit type's (a marine's for
 * a type with no known speed), of the types warningUnits reads.
 */
function warningRadius(wave: Wave, seconds: number): number {
  const speed = wave.speed ?? Math.min(...warningUnits(wave).map((unit) => UNIT_SPEEDS[unit.type] ?? REFERENCE_SPEED));
  return Math.round(seconds * speed * 100) / 100;
}

/**
 * The units a warning's circle reads. It is drawn once for every send it warns and every
 * difficulty, so it reads the units those sends bring on Normal: with firstOnly, the first send's,
 * leader and all; else those every send brings. If Normal sends none of them, it reads what Normal
 * does send (a first send with only its leader), else the warned sends' units on any difficulty.
 */
function warningUnits(wave: Wave): Wave["units"] {
  const every = wave.units.filter((unit) => unit.sends === "every");
  const warned = wave.warning?.firstOnly === true || every.length === 0 ? wave.units : every;
  const onNormal = (units: Wave["units"]) => units.filter((unit) => waveUnitCounts(unit.count)[1] > 0);
  return [onNormal(warned), onNormal(wave.units), warned].find((units) => units.length > 0)!;
}

/**
 * Each ground Wave as a stream (ADR 0008). "Wave - <id>" waits `firstSeconds` of AI time and
 * sends, then runs "Wave - <id> Repeat", which waits `intervalSeconds` and sends again, while the
 * stream is on. The stream turns on as `startsAtBeat` starts (with the mission, for a first Beat
 * without `startsWhen`), or any later Beat before `endsAtBeat` if the mission skips it; it turns
 * off, and its waves in the field go home, as `endsAtBeat` or any later Beat starts. Both are
 * idempotent, since a Beat trigger turns earlier ones off and the mission can skip Beats.
 * A Raid's send goes to its first candidate where the player holds a completed unit of its type,
 * aimed at that unit, or is skipped; "Wave - <id> Watch" sends a Raid home from a candidate once
 * the player holds none there.
 */
export function waveStreams(blueprint: MissionBlueprint, transmissions: TransmissionActions, onBind: BindActions = () => []): WaveStreams {
  const { plans } = wavePlans(blueprint);
  // Each Wave's unit's Anchor's unit, set as its send creates it; declared even for a Wave left
  // out of the map, since cues and scenes that name it read it (none, then).
  const variables: TriggerVariable[] = [...waveUnitAnchors(blueprint).keys()].map(waveUnitVariable);
  const triggers: Trigger[] = [];
  const waveOf = new Map<Trigger, string>();
  const beatActions = new Map<string, TriggerCall[]>();
  const startActions: TriggerCall[] = [];
  const onBeat = (beatId: string, actions: readonly TriggerCall[]): void => {
    const how = beatStart(blueprint, beatId);
    if (how === "mission") startActions.push(...actions);
    else if (how === "trigger") beatActions.set(beatId, [...(beatActions.get(beatId) ?? []), ...actions]);
  };
  const indexOf = (beatId: string) => blueprint.beats.findIndex((beat) => beat.id === beatId);
  for (const plan of plans) {
    const stream = waveStream(plan, blueprint, transmissions, onBind);
    variables.push(...stream.variables);
    triggers.push(...stream.triggers);
    for (const trigger of stream.triggers) waveOf.set(trigger, plan.wave.id);
    const from = indexOf(plan.wave.startsAtBeat);
    const until = plan.wave.endsAtBeat === undefined ? blueprint.beats.length : indexOf(plan.wave.endsAtBeat);
    blueprint.beats.forEach((beat, index) => {
      if (index >= from && index < until) onBeat(beat.id, stream.start(beat.id));
      else if (index >= until) onBeat(beat.id, stream.end(beat.id));
    });
  }
  return { variables, triggers, waveOf, beatActions, startActions };
}

function planWaves(blueprint: MissionBlueprint): WavePlans {
  const plans: WavePlan[] = [];
  const warnings: string[] = [];
  if (blueprint.waves.length === 0) return { plans, warnings };
  // A Wave's unit's Anchor left out with it stays none all mission: what waits on it never comes.
  const leftOut = (wave: Wave, why: string) => {
    const bound = wave.units.flatMap((unit) => (unit.anchorId === undefined ? [] : [unit.anchorId]));
    const never = bound.length === 0 ? "" : ` Anchor${bound.length > 1 ? "s" : ""} ${bound.join(", ")} never come${bound.length > 1 ? "" : "s"}, so nothing that waits on ${bound.length > 1 ? "them" : "it"} does.`;
    warnings.push(`Wave ${wave.id} ${why}; it is left out of the map.${never}`);
  };
  let model: LayoutModel | undefined;
  let placed: ReturnType<typeof expandPlacements>["units"] | undefined;
  // Warning regions so far, numbered after the zones'.
  let warned = 0;
  for (const wave of blueprint.waves) {
    if (wave.arrival !== "ground") {
      leftOut(wave, `arrives by ${wave.arrival}, which isn't compiled yet`);
      continue;
    }
    if (beatStart(blueprint, wave.startsAtBeat) === undefined) {
      leftOut(wave, `starts at beat ${wave.startsAtBeat}, which has no startsWhen (only the first beat and beats with startsWhen start in the map)`);
      continue;
    }
    const ends = wave.endsAtBeat === undefined ? -1 : blueprint.beats.findIndex((beat) => beat.id === wave.endsAtBeat);
    if (ends >= 0 && !blueprint.beats.slice(ends).some((beat) => beat.startsWhen !== undefined)) {
      warnings.push(`Wave ${wave.id} ends at beat ${wave.endsAtBeat}, but neither it nor a later beat has a startsWhen, so in the map it never stops.`);
    }
    const unknownSpeeds = wave.speed === undefined && wave.warning ? [...new Set(warningUnits(wave).map((unit) => unit.type))].filter((type) => UNIT_SPEEDS[type] === undefined) : [];
    if (unknownSpeeds.length > 0) {
      warnings.push(`Wave ${wave.id}'s warning takes a marine's speed for ${unknownSpeeds.join(", ")}, whose speed core doesn't know; give the wave a speed.`);
    }
    // A repeating wave whose leader comes on a difficulty that none of its every-send units does.
    if (wave.intervalSeconds !== undefined) {
      const total = (sends: "every" | "first", difficulty: number) =>
        wave.units.filter((unit) => unit.sends === sends).reduce((sum, unit) => sum + waveUnitCounts(unit.count)[difficulty]!, 0);
      const empty = DIFFICULTIES.filter((_, difficulty) => total("first", difficulty) > 0 && total("every", difficulty) === 0);
      if (empty.length > 0) {
        warnings.push(`Wave ${wave.id}'s repeats bring nobody on ${empty.join(", ")}, where only its first send comes; give a unit that comes with every send a count there for the wave to keep coming.`);
      }
    }
    placed ??= expandPlacements(blueprint).units;
    const player = sendingPlayer(blueprint, wave, placed);
    if (player === undefined) {
      leftOut(wave, `has no computer player to send it (no unit of players 2-14 in ${wave.spawnZoneId} or anywhere)`);
      continue;
    }
    // A unit it binds to an Anchor is created for the Wave's player, whoever the Anchor names.
    for (const unit of wave.units) {
      const bound = unit.anchorId === undefined ? undefined : blueprint.anchors.find((anchor) => anchor.id === unit.anchorId);
      if (bound?.player !== undefined && bound.player !== player) {
        warnings.push(`Wave ${wave.id} is player ${player}'s, so its ${unit.type} for Anchor ${bound.id} is too, not player ${bound.player}'s; give the Anchor player ${player}.`);
      }
    }
    model ??= buildLayoutModel(blueprint);
    const anchor = blueprint.anchors.find((candidate) => candidate.id === wave.spawnAnchorId);
    // Out of the playable area units are created where they can't walk or be seen: inside every area
    // that holds while the stream sends (beat-bounds.ts), else the one as it starts.
    const during = beatsDuring(blueprint, wave.startsAtBeat, wave.endsAtBeat);
    let playable = assumedPlayableBounds(blueprint);
    for (const bounds of during) {
      if (!bounds.setsPlayable) continue;
      const rect = bounds.playable.rect;
      // A Kept region's rectangle isn't the Blueprint's to know, so the spawn can't be kept inside it.
      if (rect === undefined) {
        if (!(anchor && isPlaced(anchor))) warnings.push(`Wave ${wave.id} sends while Beat ${bounds.beatId}'s playable area is a Kept region whose rectangle the Blueprint doesn't know, so its spawn in ${wave.spawnZoneId} may be outside it: give the Wave a spawnAnchorId inside that region`);
        continue;
      }
      const both = intersect(playable, rect);
      if (!both) {
        warnings.push(`Wave ${wave.id} sends while Beat ${bounds.beatId}'s playable area ${rectText(rect)} holds, which shares no ground with the area it starts in, so no one spawn fits both: end the Wave before that Beat (endsAtBeat), or give it a spawnAnchorId`);
        break;
      }
      playable = both;
    }
    const spawn = anchor && isPlaced(anchor) ? { x: anchor.position.x, y: anchor.position.y } : deepestCell(model, wave.spawnZoneId, playable);
    if (!spawn) {
      leftOut(wave, `has no cell in ${wave.spawnZoneId}, inside the playable area, to form in`);
      continue;
    }
    // A Raid drops a candidate it can't reach and keeps the rest; a plain Wave has only the one.
    const targets: WaveTarget[] = [];
    const unreachable: string[] = [];
    for (const zoneId of wave.targetZoneIds) {
      const point = zonePoint(model, zoneId);
      const route =
        point && groundRoute(model, { zoneId: wave.spawnZoneId, point: spawn }, { zoneId, point }, { beatIndex: model.beatIndex.get(wave.startsAtBeat)! });
      if (point && route) targets.push({ zoneId, point, waypoints: crossings(model, route.path) });
      else unreachable.push(point ? `has no ground route from ${wave.spawnZoneId} to ${zoneId}` : `has no cell to aim at in ${zoneId}`);
    }
    if (targets.length === 0) {
      leftOut(wave, unreachable.join(" and "));
      continue;
    }
    for (const why of unreachable) warnings.push(`Wave ${wave.id} ${why}, so it never raids there.`);
    const { warning } = wave;
    if (warning) {
      const radius = warningRadius(wave, warning.seconds);
      for (const target of targets) {
        if (Math.hypot(spawn.x - target.point.x, spawn.y - target.point.y) < radius) {
          warnings.push(`Wave ${wave.id} forms within its warning's ${radius}-cell circle around ${target.zoneId}, so the warning there never fires; shorten warning.seconds or move the spawn.`);
        }
      }
    }
    plans.push({
      wave,
      player,
      spawn,
      targets: warning
        ? targets.map((target) => ({ ...target, warning: { regionId: blueprint.zones.length + ++warned, radius: warningRadius(wave, warning.seconds) } }))
        : targets,
    });
  }
  return { plans, warnings };
}

/**
 * The computer player whose unit is in the spawn Zone (an Anchor on the map first, then a placed
 * unit), else the first computer player. A Wave's unit's Anchor isn't on the map: its Wave makes
 * it the Wave's player's.
 */
function sendingPlayer(blueprint: MissionBlueprint, wave: Wave, placed: ReturnType<typeof expandPlacements>["units"]): number | undefined {
  const computer = (player: number | undefined): player is number => player !== undefined && player >= 2 && player <= 14;
  const anchor = blueprint.anchors.find((candidate) => candidate.kind === "unit" && isPlaced(candidate) && candidate.zoneId === wave.spawnZoneId && computer(candidate.player));
  if (anchor) return anchor.player;
  const unit = placed.find((candidate) => candidate.zoneId === wave.spawnZoneId && computer(candidate.player));
  if (unit) return unit.player;
  return enemyPlayers(blueprint, placed)[0];
}

/**
 * The centre of the first cell of each new Zone along a route's cells. A route that steps along a
 * staircase border between two Zones enters each only once, so it gets one waypoint per Zone.
 */
function crossings(model: LayoutModel, path: readonly number[]): Point[] {
  const { width } = model.blueprint.mapSize;
  const entered = new Set([model.owner[path[0]!]]);
  return path.flatMap((cell) => {
    const owner = model.owner[cell];
    if (entered.has(owner)) return [];
    entered.add(owner);
    return [cellCentre(cell, width)];
  });
}

/** A target as its stream sends to it: with a Raid's group of the units sent there, and its warning trigger. */
type StreamTarget = WaveTarget & {
  /** A Raid's units sent to this candidate, for its success check. */
  readonly raided?: TriggerVariable;
  readonly warned?: { readonly id: Trigger["id"]; readonly name: string; readonly regionId: number };
};

function waveStream(
  plan: WavePlan,
  blueprint: MissionBlueprint,
  transmissions: TransmissionActions,
  onBind: BindActions,
): {
  readonly variables: readonly TriggerVariable[];
  readonly triggers: Trigger[];
  /** At a Beat (its id keeps each copy's element ids apart): turn the stream on unless it is. */
  readonly start: (beatId: string) => TriggerCall[];
  /** At a Beat: turn the stream off and send its waves home, unless it's off. */
  readonly end: (beatId: string) => TriggerCall[];
} {
  const { wave, player } = plan;
  const { zones } = blueprint;
  const path = `waves/${wave.id}`;
  // Test Document's debug messages (#174), naming Zones and Beats as the Blueprint does.
  const say = (sayPath: string, text: string, ...rest: readonly DebugPiece[]): TriggerCall =>
    debugMessage(`${sayPath}/debug`, `Wave ${wave.id}: ${text}`, ...rest);
  const zoneName = (zoneId: string): string => zones.find((zone) => zone.id === zoneId)?.name ?? zoneId;
  const beatTitle = (beatId: string): string => blueprint.beats.find((beat) => beat.id === beatId)?.title ?? beatId;
  const int = (value: number): TriggerParam["value"] => ({ kind: "int", value });
  const fixed = (value: number): TriggerParam["value"] => ({ kind: "fixed", value });
  const preset = (value: (typeof P)[keyof typeof P]): TriggerParam["value"] => ({ kind: "preset", preset: value });
  const point = (callPath: string, at: Point) => callValue(callPath, F.point, { x: fixed(at.x), y: fixed(at.y) });

  const on = triggerVariable(`${path}/on`, `Wave ${wave.id} On`, "bool", { kind: "bool", value: false });
  const units = triggerVariable(`${path}/units`, `Wave ${wave.id} Units`, "unitgroup", callValue(`${path}/units/initial/call`, F.unitGroupEmpty, {}));
  const sent = triggerVariable(`${path}/sent`, `Wave ${wave.id} Sent`, "unitgroup", callValue(`${path}/sent/initial/call`, F.unitGroupEmpty, {}));
  const group: TriggerParam["value"] = { kind: "variable", variable: units };
  const sending: TriggerParam["value"] = { kind: "variable", variable: sent };
  const first: Trigger["id"] = stableElementId(path);
  const repeat: Trigger["id"] = stableElementId(`${path}/repeat`);
  const firstRef = { id: first, name: `Wave - ${wave.id}` };
  const repeatRef = { id: repeat, name: `Wave - ${wave.id} Repeat` };
  const raid = wave.onlyIfPlayerHolds;
  const targets: StreamTarget[] = plan.targets.map((target) => ({
    ...target,
    ...(raid === undefined
      ? {}
      : {
          raided: triggerVariable(`${path}/raided/${target.zoneId}`, `Wave ${wave.id} Raid ${target.zoneId}`, "unitgroup", callValue(`${path}/raided/${target.zoneId}/initial/call`, F.unitGroupEmpty, {})),
        }),
    ...(target.warning
      ? { warned: { id: stableElementId(`${path}/warning/${target.zoneId}`), name: `Wave - ${wave.id} Warning ${target.zoneId}`, regionId: target.warning.regionId } }
      : {}),
  }));
  // Whether the stream's first send has gone out: with firstOnly, so later sends leave the warning
  // off, and with a unit that joins only the first send, so later ones leave it out. One flag does
  // both; with firstOnly it keeps the id and name it had before sends: "first". The stream turns on
  // only once a mission (waveStreams: Beats only move forward), so it never needs to reset.
  const firstOnly = wave.warning?.firstOnly === true;
  const sentOnce = firstOnly
    ? triggerVariable(`${path}/warnedOnce`, `Wave ${wave.id} Warned`, "bool", { kind: "bool", value: false })
    : wave.units.some((unit) => unit.sends === "first")
      ? triggerVariable(`${path}/firstSent`, `Wave ${wave.id} First Sent`, "bool", { kind: "bool", value: false })
      : undefined;
  /** The player's completed units of the Raid's type in a Zone (ADR 0008: a Raid comes for the player's). */
  const held = (callPath: string, zoneId: string, type: string) =>
    callValue(callPath, F.unitsInRegionMatching, {
      unitType: { kind: "gamelink", gameType: "Unit", value: type },
      player: int(USER_PLAYER),
      region: { kind: "region", regionId: regionIdForZone(zones, zoneId) },
      filter: { kind: "unitfilter", require: [], exclude: ["UnderConstruction", "Dead"] },
      count: preset(P.anyAmount),
    });
  const count = (callPath: string, unitGroup: TriggerParam["value"]) => callValue(callPath, F.unitGroupCount, { group: unitGroup, type: preset(P.unitCountAlive) });
  const compare = (callPath: string, left: TriggerParam["value"], operator: typeof P.compareEqual | typeof P.compareAtLeast, right: number) =>
    call(callPath, F.comparison, { left, operator: preset(operator), right: int(right) });
  const run = (callPath: string, trigger: typeof firstRef): TriggerCall =>
    call(callPath, F.triggerExecute, {
      trigger: { kind: "trigger", trigger },
      checkConditions: preset(P.checkConditions),
      wait: preset(P.dontWait),
    });
  const setOn = (callPath: string, value: boolean): TriggerCall =>
    call(callPath, F.setVariable, { variable: { kind: "variable", variable: on }, value: { kind: "bool", value } });

  const isOn = (callPath: string, value: boolean): TriggerCall =>
    call(callPath, F.comparison, { left: { kind: "variable", variable: on }, operator: preset(P.compareEqual), right: { kind: "bool", value } });
  // A once-only guard: `calls` run while the bool `flag` is still false.
  const unlessSet = (guardPath: string, flag: TriggerVariable, calls: TriggerCall[]): TriggerCall =>
    block(guardPath, F.ifThenElse, {}, [
      {
        type: SUB_FUNCTIONS.if,
        calls: [call(`${guardPath}/not`, F.comparison, { left: { kind: "variable", variable: flag }, operator: preset(P.compareEqual), right: { kind: "bool", value: false } })],
      },
      { type: SUB_FUNCTIONS.then, calls },
    ]);
  const setFlag = (callPath: string, flag: TriggerVariable): TriggerCall =>
    call(callPath, F.setVariable, { variable: { kind: "variable", variable: flag }, value: { kind: "bool", value: true } });
  // Create this send's units into its own group, which goes as a wave of its own, and into the
  // stream's, which holds every wave of the stream still in the field. A send with no units for
  // this difficulty (a type that joins only on Hard) sends no wave.
  const send = (sendPath: string, target: StreamTarget): TriggerCall[] => [
    ...create(sendPath, target),
    block(`${sendPath}/any`, F.ifThenElse, {}, [
      {
        type: SUB_FUNCTIONS.if,
        calls: [
          call(`${sendPath}/any/count`, F.comparison, {
            left: callValue(`${sendPath}/any/count/units`, F.unitGroupCount, { group: sending, type: preset(P.unitCountAlive) }),
            operator: preset(P.compareAtLeast),
            right: int(1),
          }),
        ],
      },
      { type: SUB_FUNCTIONS.then, calls: dispatch(sendPath, target) },
      { type: SUB_FUNCTIONS.else, calls: [say(`${sendPath}/none`, "skipped, no units on this difficulty")] },
    ]),
  ];
  // A unit that joins only the first send is created only while no send has gone out.
  const create = (sendPath: string, target: StreamTarget): TriggerCall[] => [
    call(`${sendPath}/clear`, F.unitGroupClear, { group: sending }),
    ...wave.units.flatMap((unit, index) => {
      const unitPath = `${sendPath}/units/${index}`;
      const made = createUnit(unitPath, unit, target);
      return unit.sends === "every" ? made : [unlessSet(`${unitPath}/first`, sentOnce!, made)];
    }),
  ];
  const createUnit = (unitPath: string, unit: Wave["units"][number], target: StreamTarget): TriggerCall[] => {
    const [casual, normal, hard, brutal] = waveUnitCounts(unit.count);
    return [
      call(`${unitPath}/create`, F.unitCreate, {
        count: callValue(`${unitPath}/create/count`, F.difficultyValueInt, { casual: int(casual), normal: int(normal), hard: int(hard), brutal: int(brutal) }),
        flags: preset(P.unitCreateFlagsNone),
        player: int(player),
        facing: fixed(SPAWN_FACING),
        unitType: { kind: "gamelink", gameType: "Unit", value: unit.type },
        point: point(`${unitPath}/create/point`, plan.spawn),
      }),
      call(`${unitPath}/sent`, F.unitGroupAddUnitGroup, { target: sending, source: callValue(`${unitPath}/sent/source`, F.lastCreatedUnits, {}) }),
      call(`${unitPath}/group`, F.unitGroupAddUnitGroup, { target: group, source: callValue(`${unitPath}/group/source`, F.lastCreatedUnits, {}) }),
      // The Anchor it binds: the one unit made. Not set on a difficulty with a count of 0, so it
      // stays none there whatever the last units created were.
      ...(unit.anchorId !== undefined ? bind(unitPath, unit.anchorId, [casual, normal, hard, brutal]) : []),
      ...(target.raided
        ? [
            call(`${unitPath}/raided`, F.unitGroupAddUnitGroup, {
              target: { kind: "variable", variable: target.raided },
              source: callValue(`${unitPath}/raided/source`, F.lastCreatedUnits, {}),
            }),
          ]
        : []),
    ];
  };
  const bind = (unitPath: string, anchorId: string, counts: readonly number[]): TriggerCall[] => {
    const set = [
      call(`${unitPath}/anchor`, F.setVariable, {
        variable: { kind: "variable", variable: waveUnitVariable(anchorId) },
        value: callValue(`${unitPath}/anchor/unit`, F.unitGroupUnit, { group: callValue(`${unitPath}/anchor/unit/group`, F.lastCreatedUnits, {}), index: int(1) }),
      }),
      ...onBind(anchorId, `${unitPath}/anchor/on`),
    ];
    if (counts.every((count) => count > 0)) return set;
    const [casual, normal, hard, brutal] = counts;
    const made = callValue(`${unitPath}/anchor/if/count`, F.difficultyValueInt, { casual: int(casual!), normal: int(normal!), hard: int(hard!), brutal: int(brutal!) });
    return [block(`${unitPath}/anchor/if`, F.ifThenElse, {}, [
      { type: SUB_FUNCTIONS.if, calls: [compare(`${unitPath}/anchor/if/made`, made, P.compareAtLeast, 1)] },
      { type: SUB_FUNCTIONS.then, calls: set },
    ])];
  };
  // A Raid attack-moves on the first unit it came for, fighting the defenders on the way.
  const aim = (aimPath: string, target: StreamTarget): TriggerParam["value"] =>
    raid === undefined
      ? point(`${aimPath}/point`, target.point)
      : callValue(`${aimPath}/unit`, F.unitPosition, {
          unit: callValue(`${aimPath}/unit/first`, F.unitGroupUnit, { group: held(`${aimPath}/unit/first/held`, target.zoneId, raid), index: int(1) }),
        });
  const warningRegion = (regionId: number): TriggerParam["value"] => ({ kind: "region", regionId });
  // The send arms the target's warning: a Raid's circle moves to its aim first. With firstOnly,
  // only the stream's first send does.
  const arm = (armPath: string, target: StreamTarget): TriggerCall[] => {
    const { warned } = target;
    if (!warned) return [];
    const armed = [
      ...(raid === undefined ? [] : [call(`${armPath}/move`, F.regionSetCenter, { region: warningRegion(warned.regionId), point: aim(`${armPath}/move/aim`, target) })]),
      call(`${armPath}/on`, F.triggerEnable, { trigger: { kind: "trigger", trigger: warned }, state: preset(P.triggerOn) }),
    ];
    return firstOnly ? [unlessSet(`${armPath}/first`, sentOnce!, [...armed, setFlag(`${armPath}/first/done`, sentOnce!)])] : armed;
  };
  const dispatch = (sendPath: string, target: StreamTarget): TriggerCall[] => [
    call(`${sendPath}/use`, F.attackWaveUseGroup, { player: int(player), group: sending }),
    call(`${sendPath}/target`, F.attackWaveSetTargetPoint, { player: int(player), point: aim(`${sendPath}/target`, target) }),
    ...target.waypoints.map((waypoint, index) =>
      call(`${sendPath}/waypoints/${index}`, F.attackWaveAddWaypoint, {
        player: int(player),
        waypoint: point(`${sendPath}/waypoints/${index}/point`, waypoint),
        useTransport: preset(P.waypointNormalMode),
      }),
    ),
    call(`${sendPath}/send`, F.attackWaveSend, { player: int(player), time: int(0), wait: preset(P.dontWait) }),
    say(`${sendPath}/sent`, "sent ", { int: count(`${sendPath}/sent/count`, sending) }, ` units → ${zoneName(target.zoneId)}`),
    ...arm(`${sendPath}/warning`, target),
    // With firstOnly, arming the warning above has set it.
    ...(sentOnce && !firstOnly ? [setFlag(`${sendPath}/firstSent`, sentOnce)] : []),
  ];
  // A Raid tries its candidates in order and sends to the first the player holds; with none, the send is skipped.
  const sendOrSkip = (sendPath: string): TriggerCall[] => {
    if (raid === undefined) return send(sendPath, targets[0]!);
    const tryFrom = (index: number): TriggerCall[] => {
      const target = targets[index];
      if (!target) return [say(`${sendPath}/skip`, `skipped, no ${raid} held in ${targets.map((candidate) => zoneName(candidate.zoneId)).join(", ")}`)];
      const targetPath = `${sendPath}/${target.zoneId}`;
      return [
        block(`${targetPath}/if`, F.ifThenElse, {}, [
          { type: SUB_FUNCTIONS.if, calls: [compare(`${targetPath}/if/held`, count(`${targetPath}/if/held/count`, held(`${targetPath}/if/held/count/units`, target.zoneId, raid)), P.compareAtLeast, 1)] },
          { type: SUB_FUNCTIONS.then, calls: send(targetPath, target) },
          { type: SUB_FUNCTIONS.else, calls: tryFrom(index + 1) },
        ]),
      ];
    };
    return tryFrom(0);
  };
  // Wait on AI time, then send if the stream is still on, and go round again if it repeats.
  const actions = (actionsPath: string, seconds: number): TriggerCall[] => [
    call(`${actionsPath}/wait`, F.wait, { time: fixed(seconds), timeType: preset(P.timeAI) }),
    block(`${actionsPath}/if`, F.ifThenElse, {}, [
      {
        type: SUB_FUNCTIONS.if,
        calls: [
          isOn(`${actionsPath}/if/on`, true),
        ],
      },
      {
        type: SUB_FUNCTIONS.then,
        calls: [...sendOrSkip(`${actionsPath}/send`), ...(wave.intervalSeconds !== undefined ? [run(`${actionsPath}/again`, repeatRef)] : [])],
      },
    ]),
  ];
  const triggers: Trigger[] = [{ ...firstRef, events: [], actions: actions(path, wave.firstSeconds) }];
  if (wave.intervalSeconds !== undefined) triggers.push({ ...repeatRef, events: [], actions: actions(`${path}/repeat`, wave.intervalSeconds) });

  // Every wave of the stream's units goes home, whatever it is doing. A unit that has changed hands
  // or left its wave is skipped, so the AI's own waves and the player's units are never touched.
  const unitWave = (callPath: string) => callValue(callPath, F.unitWave, { unit: pickedUnit(`${callPath}/unit`) });
  const recall = (recallPath: string, from: TriggerParam["value"]): TriggerCall =>
    block(`${recallPath}/each`, F.pickEachUnitInGroup, { group: from }, [
      {
        type: SUB_FUNCTIONS.pickEachActions,
        calls: [
          block(`${recallPath}/each/if`, F.ifThenElse, {}, [
            {
              type: SUB_FUNCTIONS.if,
              calls: [
                call(`${recallPath}/each/if/ours`, F.comparison, {
                  left: callValue(`${recallPath}/each/if/ours/owner`, F.unitOwner, { unit: pickedUnit(`${recallPath}/each/if/ours/owner/unit`) }),
                  operator: preset(P.compareEqual),
                  right: int(player),
                }),
                call(`${recallPath}/each/if/inWave`, F.comparison, {
                  left: unitWave(`${recallPath}/each/if/inWave/wave`),
                  operator: preset(P.compareNotEqual),
                  right: preset(P.noWave),
                }),
              ],
            },
            { type: SUB_FUNCTIONS.then, calls: [call(`${recallPath}/each/cancel`, F.attackWaveCancel, { wave: unitWave(`${recallPath}/each/cancel/wave`) })] },
          ]),
        ],
      },
    ]);
  if (raid !== undefined) {
    // A Raid sent to a candidate succeeds once the player holds none of the type there. Its units
    // then leave the stream, so a later recall can't touch the waves they join once home.
    const watchPath = `${path}/watch`;
    triggers.push({
      id: stableElementId(watchPath),
      name: `Wave - ${wave.id} Watch`,
      events: [call(`${watchPath}/event`, F.periodicEvent, { duration: fixed(RAID_CHECK_SECONDS), timeType: preset(P.timeAI) })],
      // Only while the stream runs: before it no raider is out, and its end sends them all home.
      conditions: [isOn(`${watchPath}/on`, true)],
      actions: targets.flatMap((target) => {
        if (!target.raided) return [];
        const targetPath = `${watchPath}/${target.zoneId}`;
        const sentThere: TriggerParam["value"] = { kind: "variable", variable: target.raided };
        return block(`${targetPath}/if`, F.ifThenElse, {}, [
          {
            type: SUB_FUNCTIONS.if,
            calls: [
              compare(`${targetPath}/if/out`, count(`${targetPath}/if/out/count`, sentThere), P.compareAtLeast, 1),
              compare(`${targetPath}/if/taken`, count(`${targetPath}/if/taken/count`, held(`${targetPath}/if/taken/count/units`, target.zoneId, raid)), P.compareEqual, 0),
            ],
          },
          {
            type: SUB_FUNCTIONS.then,
            calls: [
              say(`${targetPath}/home`, "recalled (success)"),
              recall(`${targetPath}/home`, sentThere),
              call(`${targetPath}/leave`, F.unitGroupRemoveUnitGroup, { target: group, source: sentThere }),
              call(`${targetPath}/clear`, F.unitGroupClear, { group: sentThere }),
            ],
          },
        ]);
      }),
    });
  }
  const start = (beatId: string): TriggerCall[] => {
    const at = `${path}/start/${beatId}`;
    return [
      block(`${at}/if`, F.ifThenElse, {}, [
        { type: SUB_FUNCTIONS.if, calls: [isOn(`${at}/if/off`, false)] },
        { type: SUB_FUNCTIONS.then, calls: [setOn(`${at}/on`, true), say(at, `on, first send in ${wave.firstSeconds} s`), run(`${at}/run`, firstRef)] },
      ]),
    ];
  };
  // Once home, the units are no longer the stream's, so a later recall can't touch the waves they join.
  const end = (beatId: string): TriggerCall[] => {
    const at = `${path}/end/${beatId}`;
    return [
      block(`${at}/if`, F.ifThenElse, {}, [
        { type: SUB_FUNCTIONS.if, calls: [isOn(`${at}/if/on`, true)] },
        {
          type: SUB_FUNCTIONS.then,
          calls: [
            setOn(`${at}/off`, false),
            say(`${at}/off`, "off"),
            block(`${at}/out`, F.ifThenElse, {}, [
              { type: SUB_FUNCTIONS.if, calls: [compare(`${at}/out/any`, count(`${at}/out/any/count`, group), P.compareAtLeast, 1)] },
              { type: SUB_FUNCTIONS.then, calls: [say(`${at}/out`, `recalled (${beatTitle(beatId)})`)] },
            ]),
            recall(at, group),
            call(`${at}/clear`, F.unitGroupClear, { group }),
            ...targets.flatMap(({ zoneId, raided }) => (raided ? [call(`${at}/clear/${zoneId}`, F.unitGroupClear, { group: { kind: "variable", variable: raided } })] : [])),
          ],
        },
      ]),
    ];
  };
  // A warning fires once a raider of this stream comes within the circle, then waits for the next send to arm it.
  const transmission = wave.warning?.transmission;
  const announce = { id: stableElementId(`${path}/announce`), name: `Wave - ${wave.id} Warning Transmission` };
  if (transmission !== undefined) triggers.push({ ...announce, events: [], actions: transmissions(transmission, `${path}/announce/`) });
  for (const target of targets) {
    const { warned } = target;
    if (!warned) continue;
    const warnPath = `${path}/warning/${target.zoneId}`;
    triggers.push({
      ...warned,
      initiallyOff: true,
      // Any unit, since the event can't take a group; the condition keeps it to the stream's (a Raid's, to those sent here).
      events: [
        call(`${warnPath}/event`, F.unitEntersRegion, { unit: preset(P.anyUnit), state: preset(P.regionEnters), region: warningRegion(warned.regionId) }),
      ],
      conditions: [
        call(`${warnPath}/raider`, F.comparison, {
          left: callValue(`${warnPath}/raider/in`, F.unitGroupHasUnit, {
            group: target.raided ? { kind: "variable", variable: target.raided } : group,
            unit: callValue(`${warnPath}/raider/in/unit`, F.triggeringUnit, {}),
          }),
          operator: preset(P.compareEqual),
          right: { kind: "bool", value: true },
        }),
      ],
      actions: [
        turnOffCurrentTrigger(`${warnPath}/off`),
        say(warnPath, `warning at ${zoneName(target.zoneId)}`),
        call(`${warnPath}/ping`, F.minimapPing, {
          players: callValue(`${warnPath}/ping/players`, F.allPlayers, {}),
          point: callValue(`${warnPath}/ping/point`, F.regionGetCenter, { region: warningRegion(warned.regionId) }),
          duration: fixed(PING_SECONDS),
          color: callValue(`${warnPath}/ping/color`, F.color, { r: fixed(PING_COLOR[0]), g: fixed(PING_COLOR[1]), b: fixed(PING_COLOR[2]) }),
        }),
        ...(transmission !== undefined ? [run(`${warnPath}/transmission`, announce)] : []),
      ],
    });
  }
  const variables = [on, units, sent, ...targets.flatMap((target) => (target.raided ? [target.raided] : [])), ...(sentOnce ? [sentOnce] : [])];
  return { variables, triggers, start, end };
}
