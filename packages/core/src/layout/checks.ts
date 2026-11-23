// The level-design checker's rules (docs/adr/0003). Each check cites the rule it comes from:
// "§4.n" numbers a rule read from Blizzard's campaign missions, "LP-n" is a Layout Principle and "PC-n" a
// pacing check of the level-design skill (packages/claude-plugin/skills/level-design). Thresholds and
// severities were calibrated against four Blizzard missions (Zero Hour, The Evacuation, Devil's
// Playground, Media Blitz); a check
// that lacks its inputs reports "not-evaluated", never "pass".

import { blueprintCatalog } from "../catalog/catalog-layer.js";
import { techUnit } from "../catalog/tech-catalog.js";
import { type Archetype, revealedZoneIds } from "../domain/mission-blueprint.js";
import type { Schedule } from "../domain/schedule.js";
import type { Threat, ThreatConsequence } from "../domain/threat.js";
import type { ConnectionChange } from "./connection-changes.js";
import {
  borderBetween,
  changesOn,
  type Crossing,
  crossingKey,
  directedKey,
  distancesTo,
  enemyHeldAt,
  footprintCells,
  footprintZoneIds,
  groundRoute,
  type LayoutModel,
  playerRoute,
  reachableFrom,
  REFERENCE_SPEED,
  type TraversalOptions,
  routeLength,
  windowOnBorder,
} from "./layout-model.js";
import { type BeatRange, beatRange, describeSchedule, overlaps } from "./schedules.js";
import { assumedPlayableBounds } from "../map/map-bounds.js";
import { boundsWarnings } from "../triggers/beat-bounds.js";
import type { LoadedTriggerScene } from "../cutscene/trigger-scene.js";
import { boundsFindings } from "./bounds-checks.js";
import { routeFindings, routeTestResults } from "./route-checks.js";

export const CHECK_STATUSES = ["pass", "warn", "info", "not-evaluated"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export type CheckResult = {
  readonly id: string;
  readonly title: string;
  /** Where the rule comes from in the research. */
  readonly source: string;
  readonly status: CheckStatus;
  readonly findings: readonly string[];
};

/** What a check may read beyond the layout model: the Mission's trigger scenes, when the caller loaded them. */
export type CheckContext = { readonly triggerScenes?: readonly LoadedTriggerScene[] };

type Check = (model: LayoutModel, context: CheckContext) => Omit<CheckResult, "id" | "title" | "source">;

/** Held at 3 by all four calibration missions. */
const MAX_GOAL_SITES_PER_BEAT = 3;
const MAX_INTRODUCTIONS_PER_BEAT = 1;
/**
 * Window-versus-crossing (ADR 0006): each Threat's window must be at least this many times the
 * time it takes to cross to safety, chosen by what getting caught costs. 1.2 is the Moving hazard
 * band: Devil's Playground's 10 s warning against 6-8 s retreats is 1.2-1.7×. Fatal and damaging
 * Threats keep it.
 *
 * `setback` is a PLACEHOLDER, awaiting the study of a stealth mission's patrols the way Devil's
 * Playground was studied for hazards: being sent back to a checkpoint is forgiving, so for now a
 * window only has to cover the crossing.
 */
const WINDOW_PER_CROSSING: Readonly<Record<ThreatConsequence, number>> = { damage: 1.2, combat: 1.2, fail: 1.2, setback: 1 };
/** Like the hold warning band, a second of slack: retreats are measured from a sketched zone's worst cell. */
const RETREAT_SLACK_SECONDS = 1;
/** Archetypes that run down one road, where a crossing that can close is part of the design. */
const LINEAR_ARCHETYPES: ReadonlySet<Archetype> = new Set(["escort", "commando"]);

/**
 * Bands from ARCHETYPES.md, each calibrated on one Blizzard mission.
 * Zero Hour's shortest warning is 9.2 s; the hold band allows a second for waves setting off from
 * a zone's centre rather than their real spawn point.
 */
const BANDS = {
  startToFirstGoalSeconds: [15, 90],
  hold: { groundEntrances: [2, 4], minWarningSeconds: 8, minIntervalSeconds: 120, minIntervalPerTravel: 5 },
  assault: { goalSeconds: [30, 60], minEntrancesPerBase: 2 },
  escort: { roadCells: [120, 160] },
} as const;

const result = (findings: string[], failing: CheckStatus = "warn") =>
  findings.length > 0 ? { status: failing, findings } : { status: "pass" as const, findings };
const notEvaluated = (reason: string) => ({ status: "not-evaluated" as const, findings: [reason] });

const name = (model: LayoutModel, zoneId: string): string => model.zones.get(zoneId)?.zone.name ?? zoneId;
const anchorName = (model: LayoutModel, anchorId: string): string =>
  model.blueprint.anchors.find((anchor) => anchor.id === anchorId)?.name ?? anchorId;
/** Where a goal's route starts: the start, or the unit that must arrive. */
const origin = (model: LayoutModel, goal: LayoutModel["goals"][number]): string =>
  goal.from ? `${anchorName(model, goal.from.anchorId)} in ${name(model, goal.from.zoneId)}` : "the start";
const route = (model: LayoutModel, zoneIds: readonly string[]): string => zoneIds.map((zoneId) => name(model, zoneId)).join(" → ");
const names = (model: LayoutModel, zoneIds: Iterable<string>): string => [...zoneIds].map((zoneId) => name(model, zoneId)).join(", ");
const beatTitle = (model: LayoutModel, index: number): string => model.blueprint.beats[index]?.title ?? `beat ${index + 1}`;
const article = (word: string): string => (/^[aeiou]/.test(word) ? "an" : "a");

/**
 * A crossing that can stop being passable: it collapses, can be blown, or a Connection change
 * closes it (`closesAtBeat`, a Mechanic's), turns it one-way against it, or opens it only for a while.
 */
const canClose = (model: LayoutModel, crossing: Crossing): boolean =>
  crossing.type === "collapsible" ||
  crossing.type === "bridge" ||
  changesOn(model, crossing).some((change) => closing(model, change)?.directions.has(directedKey(crossing.from, crossing.to)));

/** LP-16: declared crossings should match what the terrain lets units do, and every zone should actually exist on the map. */
const terrainAgreement: Check = (model) => {
  const findings: string[] = [];
  const declared = new Set(model.crossings.map((crossing) => crossingKey(crossing.from, crossing.to)));
  for (const facts of model.zones.values()) {
    if (facts.cells === 0) findings.push(`${facts.zone.name} is entirely covered by later zones, so it isn't on the map.`);
  }
  for (const border of model.borders) {
    const a = model.zones.get(border.a)!.zone;
    const b = model.zones.get(border.b)!.zone;
    if (a.elevation === b.elevation && !declared.has(crossingKey(a.id, b.id))) {
      findings.push(
        `${a.name} and ${b.name} meet at the same level along ${border.length} cells with no declared connection; units can walk across.`,
      );
    }
  }
  for (const crossing of model.crossings) {
    if (crossing.from > crossing.to && !crossing.oneWay) continue;
    const from = model.zones.get(crossing.from)!.zone;
    const to = model.zones.get(crossing.to)!.zone;
    const border = borderBetween(model, from.id, to.id);
    if (!border && crossing.type !== "air-only" && crossing.type !== "bridge") {
      findings.push(`${from.name} → ${to.name} is ${article(crossing.type)} ${crossing.type} connection, but the zones don't touch on the map.`);
    }
    if (border && from.elevation !== to.elevation && !["ramp", "air-only", "bridge"].includes(crossing.type)) {
      findings.push(
        `${from.name} (level ${from.elevation}) → ${to.name} (level ${to.elevation}) is ${crossing.type}, but a cliff separates them; use a ramp or air-only.`,
      );
    }
    if (border && crossing.at && !windowOnBorder(model, crossing)) {
      findings.push(`${from.name} → ${to.name} is declared at (${crossing.at.x}, ${crossing.at.y}), which isn't on their shared border; units can't cross there.`);
    }
  }
  return result(findings);
};

/**
 * §4.2, LP-7 and LP-14: a ground route from the start to every goal, around enemy bases where
 * possible, and the crossings it can't do without. Only those that can close warn, and not in an
 * escort or commando beat: every single point of failure in the calibration missions was intended
 * (escort roads, mining pockets, a keep's one ramp).
 */
const criticalPath: Check = (model) => {
  if (!model.startZoneId) return notEvaluated(`No start zone: ${model.startReason}.`);
  if (model.goals.length === 0) return notEvaluated("No goals: no primary objective or victory condition points at a zone or anchor.");
  const findings: string[] = [`Start: ${name(model, model.startZoneId)} (${model.startReason}).`];
  let warn = false;
  for (const goal of model.goals) {
    if (goal.hold) {
      findings.push(`${goal.source}: hold ${name(model, goal.zoneId)} until the timer runs out; nothing to route.`);
      continue;
    }
    const best = playerRoute(model, goal);
    if (!best) {
      warn = true;
      findings.push(`No ground route from ${origin(model, goal)} to ${name(model, goal.zoneId)} (${goal.source}).`);
      continue;
    }
    findings.push(`${goal.source}${goal.from ? ` (${origin(model, goal)})` : ""}: ${route(model, best.zoneIds)}.`);
    if (best.throughEnemy.length > 0) {
      findings.push(`  Fights through enemy-held ${names(model, best.throughEnemy)}; there's no way round.`);
    }
    const closable: string[] = [];
    const fixed: string[] = [];
    for (let index = 1; index < best.zoneIds.length; index++) {
      const from = best.zoneIds[index - 1]!;
      const to = best.zoneIds[index]!;
      if (reachableFrom(model, goal.from?.zoneId ?? model.startZoneId, { without: new Set([crossingKey(from, to)]) }).has(goal.zoneId)) continue;
      const crossing = model.crossings.find((candidate) => candidate.from === from && candidate.to === to);
      (crossing && canClose(model, crossing) ? closable : fixed).push(`${name(model, from)} → ${name(model, to)}`);
    }
    const archetype = model.archetypes[goal.beatIndex];
    if (closable.length > 0 && archetype && LINEAR_ARCHETYPES.has(archetype)) {
      findings.push(`  Single points of failure that can close or be destroyed (expected in ${article(archetype)} ${archetype}): ${closable.join("; ")}.`);
    } else if (closable.length > 0) {
      warn = true;
      findings.push(`  Single points of failure that can close or be destroyed: ${closable.join("; ")}.`);
    }
    if (fixed.length > 0) findings.push(`  Single points of failure (fixed, so usually intended): ${fixed.join("; ")}.`);
  }
  return { status: warn ? "warn" : "pass", findings };
};

/** LP-13: crossings that open or close at a beat must leave each goal reachable at its beat. */
const beatGating: Check = (model) => {
  const timed = model.crossings.filter((crossing) => changesOn(model, crossing).length > 0);
  if (timed.length === 0) return notEvaluated("No connection declares opensAtBeat or closesAtBeat.");
  if (!model.startZoneId || model.goals.length === 0) return notEvaluated("Needs a start zone and goals (see the critical path check).");
  const findings: string[] = [];
  for (const goal of model.goals) {
    if (!reachableFrom(model, model.startZoneId, { beatIndex: goal.beatIndex }).has(goal.zoneId)) {
      findings.push(
        `${name(model, goal.zoneId)} (${goal.source}) can't be reached during "${beatTitle(model, goal.beatIndex)}" with the connections open then.`,
      );
    }
  }
  return result(findings);
};

/**
 * §4.3: ways into each held region (the player's, and each enemy base complex) and each goal zone
 * outside them. Reported, not judged, until missions declare an archetype; calibration found 2
 * ground entrances for a hold and 2-3 per enemy base for an assault.
 */
const entrances: Check = (model) => {
  const regions = heldRegions(model);
  const covered = new Set(regions.flatMap((region) => [...region.zoneIds]));
  for (const goal of model.goals) {
    if (!covered.has(goal.zoneId)) {
      regions.push({ label: "Goal", zoneIds: new Set([goal.zoneId]) });
      covered.add(goal.zoneId);
    }
  }
  if (regions.length === 0) return notEvaluated("No start, enemy base or goal zones.");
  const findings = regions.map(({ label, zoneIds }) => {
    const { ground, air } = entrancesInto(model, zoneIds);
    const described = ground.map((crossing) => `${crossing.type} from ${name(model, crossing.from)}`).join(", ");
    return `${label} (${names(model, zoneIds)}): ${ground.length} ground ${ground.length === 1 ? "entrance" : "entrances"}${ground.length > 0 ? ` (${described})` : ""}${air > 0 ? `, plus ${air} air-only` : ""}.`;
  });
  return { status: "info", findings };
};

type Region = { readonly label: string; readonly zoneIds: ReadonlySet<string> };

/** The player's held region, then each enemy base complex (enemy-held zones joined by ground). */
function heldRegions(model: LayoutModel): Region[] {
  const regions: Region[] = [];
  if (model.playerRegionZoneIds.size > 0) regions.push({ label: "The player's held region", zoneIds: model.playerRegionZoneIds });
  const unassigned = new Set(model.enemyHeldZoneIds);
  for (const seed of model.enemyHeldZoneIds) {
    if (!unassigned.has(seed)) continue;
    const region = new Set([seed]);
    const queue = [seed];
    unassigned.delete(seed);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const crossing of model.crossings) {
        if (crossing.from === current && unassigned.has(crossing.to) && crossing.type !== "air-only") {
          unassigned.delete(crossing.to);
          region.add(crossing.to);
          queue.push(crossing.to);
        }
      }
    }
    regions.push({ label: "Enemy-held region", zoneIds: region });
  }
  return regions;
}

function entrancesInto(model: LayoutModel, zoneIds: ReadonlySet<string>): { ground: Crossing[]; air: number } {
  const inbound = model.crossings.filter((crossing) => zoneIds.has(crossing.to) && !zoneIds.has(crossing.from));
  const ground = inbound.filter((crossing) => crossing.type !== "air-only");
  return { ground, air: inbound.length - ground.length };
}

/** §4.4: ground travel time on the cell grid from the start to each goal at the reference speed. */
const travelTimes: Check = (model) => {
  if (!model.startZoneId || model.goals.length === 0) return notEvaluated("Needs a start zone and goals.");
  const findings = model.goals.map((goal) => {
    if (goal.hold) return `${name(model, goal.zoneId)}: held until the timer runs out, so no travel.`;
    const best = playerRoute(model, goal);
    const leg = goal.from ? `${anchorName(model, goal.from.anchorId)} → ${name(model, goal.zoneId)}` : `Start → ${name(model, goal.zoneId)}`;
    const pace = goal.from?.speed !== undefined ? ` at its ${goal.from.speed} cells/s` : "";
    return best
      ? `${leg}: about ${Math.round(best.seconds)} s on the ground${pace} (${Math.round(best.cells)} cells).`
      : `${leg}: no ground route.`;
  });
  return { status: "info", findings };
};

/** §4.4c and LP-13: separate primary goal sites the player has to cover in one beat; optional sites are listed beside them. */
const goalSpread: Check = (model) => {
  if (model.goals.length === 0) return notEvaluated("No goals.");
  const findings: string[] = [];
  const byBeat = new Map<number, Set<string>>();
  for (const goal of model.goals) byBeat.set(goal.beatIndex, (byBeat.get(goal.beatIndex) ?? new Set()).add(goal.zoneId));
  let warn = false;
  for (const [index, zoneIds] of byBeat) {
    if (zoneIds.size > MAX_GOAL_SITES_PER_BEAT) {
      warn = true;
      findings.push(`"${beatTitle(model, index)}" sends the player to ${zoneIds.size} separate sites (more than ${MAX_GOAL_SITES_PER_BEAT}).`);
    }
  }
  const anchorZone = new Map(model.blueprint.anchors.map((anchor) => [anchor.id, anchor.zoneId]));
  for (const objective of model.blueprint.objectives) {
    if (objective.type === "primary" || !objective.completeWhen) continue;
    const condition = objective.completeWhen;
    const zoneId =
      condition.type === "anchorEntersZone" ? condition.zoneId : condition.type === "anchorDies" || condition.type === "anchorCaptured" ? anchorZone.get(condition.anchorId) : undefined;
    if (zoneId) findings.push(`Also open during "${beatTitle(model, model.beatIndex.get(objective.beatId) ?? 0)}": ${objective.type} ${objective.id} at ${name(model, zoneId)}.`);
  }
  return { status: warn ? "warn" : "pass", findings };
};

/** Names Threats by their sources, kind by kind: "enemy group ambush", "waves north, south". */
function threatSources(threats: readonly Threat[]): string {
  const idsByKind = new Map<string, string[]>();
  for (const { source } of threats) idsByKind.set(source.kind, [...(idsByKind.get(source.kind) ?? []), source.id]);
  return [...idsByKind].map(([kind, ids]) => `${kind}${ids.length === 1 ? "" : "s"} ${ids.join(", ")}`).join(" and ");
}

/**
 * §4.4d, LP-11 and PC-5: the start and the zones critical anchors start in hold no combat Threats
 * that stand there from a beat (an encounter, an enemy group); refuges holding one, and safe zones
 * that cycling combat Threats attack (a hold mission's waves, a scripted breach), are reported.
 */
const safeHavens: Check = (model) => {
  if (!model.startZoneId && model.criticalAnchors.length === 0) return notEvaluated("No start zone or critical anchors.");
  const combat = model.threats().filter((threat) => threat.consequence === "combat");
  if (combat.length === 0) return notEvaluated("No combat Threats (encounters, enemy groups, waves or Mechanics), so there are none to place.");
  // The Threats that stand in a zone from a beat, with the beats they're active over (until, when
  // given, is the beat they stop at). One that ends before it starts is never active.
  const standing = new Map<string, { readonly threat: Threat; readonly from: number; readonly until?: number }[]>();
  for (const threat of combat) {
    if (threat.schedule.kind !== "from-beat") continue;
    const from = model.beatIndex.get(threat.schedule.beatId)!;
    const until = threat.schedule.untilBeatId === undefined ? undefined : model.beatIndex.get(threat.schedule.untilBeatId)!;
    if (until !== undefined && until <= from) continue;
    for (const zoneId of footprintZoneIds(model, threat.footprint)) standing.set(zoneId, [...(standing.get(zoneId) ?? []), { threat, from, ...(until !== undefined ? { until } : {}) }]);
  }
  const standingIn = (zoneId: string) => standing.get(zoneId) ?? [];
  const problems: string[] = [];
  const passive: string[] = [];
  // A Threat inactive until a later beat doesn't threaten the start; say when it wakes, and when one
  // that does threaten it leaves.
  const threatened = (zoneId: string, what: string): void => {
    const windows = standingIn(zoneId);
    if (windows.length === 0) return;
    const threats = windows.map((window) => window.threat);
    const now = windows.filter((window) => window.from === 0);
    if (now.length === 0) {
      passive.push(`${what} holds ${threatSources(threats)}, passive until "${beatTitle(model, Math.min(...windows.map((window) => window.from)))}".`);
      return;
    }
    const ends = now.every((window) => window.until !== undefined) ? Math.max(...now.map((window) => window.until!)) : undefined;
    problems.push(`${what} has ${threatSources(threats)} in it${ends === undefined ? "" : ` until "${beatTitle(model, ends)}"`}.`);
  };
  if (model.startZoneId) threatened(model.startZoneId, `The start, ${name(model, model.startZoneId)},`);
  for (const { anchorId, zoneId } of model.criticalAnchors) {
    if (zoneId !== model.startZoneId) threatened(zoneId, `${anchorId} (losing it fails the mission) starts in ${name(model, zoneId)}, which`);
  }
  const refuges = [...model.zones.values()].flatMap((facts) => {
    const windows = facts.zone.role === "refuge" ? standingIn(facts.zone.id) : [];
    if (windows.length === 0) return [];
    return [`Refuge ${facts.zone.name} holds ${threatSources(windows.map((window) => window.threat))}; fine if it's a one-shot ambush the player clears to claim it.`];
  });
  const safeZoneIds = new Set([
    ...model.playerRegionZoneIds,
    ...model.criticalAnchors.map((anchor) => anchor.zoneId),
    ...[...model.zones.values()].filter((facts) => facts.zone.role === "refuge").map((facts) => facts.zone.id),
  ]);
  const attackers = new Map<string, Threat[]>();
  // Anything but a standing Threat comes and goes: a cycle, a patrol, a Mechanic's state.
  for (const threat of combat.filter((candidate) => candidate.schedule.kind !== "from-beat")) {
    for (const zoneId of footprintZoneIds(model, threat.footprint)) {
      if (safeZoneIds.has(zoneId)) attackers.set(zoneId, [...(attackers.get(zoneId) ?? []), threat]);
    }
  }
  const attacked = [...attackers].map(
    ([zoneId, threats]) => `${name(model, zoneId)} is attacked by ${threatSources(threats)}; intended for a hold or a base under pressure, otherwise a scripted breach.`,
  );
  const notes = [...passive, ...refuges, ...attacked];
  if (problems.length > 0) return { status: "warn", findings: [...problems, ...notes] };
  return notes.length > 0 ? { status: "info", findings: notes } : { status: "pass", findings: [] };
};

type Wave = LayoutModel["blueprint"]["waves"][number];

function waveTiming(model: LayoutModel, wave: Wave): string {
  const start = beatTitle(model, model.beatIndex.get(wave.startsAtBeat)!);
  const end = wave.endsAtBeat === undefined ? "" : ` until "${beatTitle(model, model.beatIndex.get(wave.endsAtBeat)!)}"`;
  const repeat = wave.intervalSeconds === undefined ? "once" : `then every ${wave.intervalSeconds} s${end}`;
  return `from "${start}" (${wave.firstSeconds} s in, ${repeat})`;
}

type WavePath = {
  readonly zoneIds: readonly string[];
  readonly cells: number;
  /** At the wave's speed, or a marine's. */
  readonly seconds: number;
  /** Where the route first enters the target's held region, when that isn't the target itself. */
  readonly entrance?: { readonly zoneId: string; readonly fromZoneId: string; readonly seconds: number };
};

/**
 * The units a wave brings, by type: "Zealot", "Adept ×2", or four counts "Stalker ×0/1/1/2"; then
 * the ones only its first send brings: "Zealot, and on its first send Archon".
 */
function waveUnits(wave: Wave): string {
  const list = (units: Wave["units"]): string =>
    units.map(({ type, count }) => (typeof count !== "number" ? `${type} ×${count.join("/")}` : count === 1 ? type : `${type} ×${count}`)).join(", ");
  const every = list(wave.units.filter((unit) => unit.sends === "every"));
  const first = list(wave.units.filter((unit) => unit.sends === "first"));
  if (first === "") return every;
  return every === "" ? `on its first send ${first}` : `${every}, and on its first send ${first}`;
}

const waveRoutes = new WeakMap<LayoutModel, Map<string, WavePath | undefined>>();

/**
 * A ground wave's route from its spawn to one of its targets, with the crossings open in its first
 * beat; worked out once per model, since threat-paths and the hold bands both ask.
 */
function waveRoute(model: LayoutModel, wave: Wave, targetZoneId: string): WavePath | undefined {
  const routes = waveRoutes.get(model) ?? new Map<string, WavePath | undefined>();
  waveRoutes.set(model, routes);
  const key = `${wave.id}>${targetZoneId}`;
  if (!routes.has(key)) routes.set(key, routeWave(model, wave, targetZoneId));
  return routes.get(key);
}

function routeWave(model: LayoutModel, wave: Wave, targetZoneId: string): WavePath | undefined {
  const speed = wave.speed ?? REFERENCE_SPEED;
  const beatIndex = model.beatIndex.get(wave.startsAtBeat)!;
  const whole = groundRoute(model, { zoneId: wave.spawnZoneId }, { zoneId: targetZoneId }, { beatIndex });
  if (!whole) return undefined;
  const region = model.playerRegionZoneIds.has(targetZoneId) ? model.playerRegionZoneIds : new Set([targetZoneId]);
  const entryIndex = whole.zoneIds.findIndex((zoneId) => region.has(zoneId));
  const entered = whole.zoneIds[entryIndex]!;
  const toEntrance =
    entryIndex > 0 && entered !== targetZoneId ? groundRoute(model, { zoneId: wave.spawnZoneId }, { zoneId: entered }, { beatIndex }) : undefined;
  return {
    zoneIds: whole.zoneIds,
    cells: whole.cells,
    seconds: whole.cells / speed,
    ...(toEntrance ? { entrance: { zoneId: entered, fromZoneId: whole.zoneIds[entryIndex - 1]!, seconds: toEntrance.cells / speed } } : {}),
  };
}

/**
 * ADR 0004 and 0008: each ground wave's route from its spawn to each of its targets, the entrance
 * it uses into the region it attacks, and how long it takes to get there; the attacker's travel
 * time is the defender's warning. Other arrivals land at the target directly.
 */
const threatPaths: Check = (model) => {
  const waves = model.blueprint.waves;
  if (waves.length === 0) return notEvaluated("No waves.");
  const problems: string[] = [];
  const report: string[] = [];
  for (const wave of waves) {
    const raid = wave.onlyIfPlayerHolds === undefined ? "" : `, raiding where the player holds ${wave.onlyIfPlayerHolds},`;
    const label = `Wave ${wave.id} (${waveUnits(wave)})${raid} ${waveTiming(model, wave)}`;
    if (wave.arrival !== "ground") {
      report.push(`${label} arrives at ${wave.targetZoneIds.map((zoneId) => name(model, zoneId)).join(" or ")} by ${wave.arrival}, with no ground approach to watch.`);
      continue;
    }
    const assumed = wave.speed === undefined ? ", at marine speed" : "";
    for (const targetZoneId of wave.targetZoneIds) {
      const path = waveRoute(model, wave, targetZoneId);
      if (!path) {
        problems.push(`${label} has no ground route from ${name(model, wave.spawnZoneId)} to ${name(model, targetZoneId)}.`);
        continue;
      }
      const via = path.entrance
        ? ` enters ${name(model, path.entrance.zoneId)} from ${name(model, path.entrance.fromZoneId)} after about ${Math.round(path.entrance.seconds)} s and`
        : "";
      report.push(`${label}: ${route(model, path.zoneIds)};${via} reaches ${name(model, targetZoneId)} after about ${Math.round(path.seconds)} s (${Math.round(path.cells)} cells${assumed}).`);
    }
  }
  if (problems.length > 0) return { status: "warn", findings: [...problems, ...report] };
  return { status: "info", findings: report };
};

/** §4.6 and LP-17: zones the player can't reach, and dead ends that hold nothing. */
const deadSpace: Check = (model) => {
  if (!model.startZoneId) return notEvaluated(`No start zone: ${model.startReason}.`);
  const reachable = reachableFrom(model, model.startZoneId, { air: true });
  const used = new Set([
    ...model.blueprint.anchors.map((anchor) => anchor.zoneId),
    ...model.blueprint.placements.map((placement) => placement.zoneId),
    ...model.blueprint.encounters.map((encounter) => encounter.triggerZoneId),
    ...model.goals.map((goal) => goal.zoneId),
  ]);
  const findings: string[] = [];
  for (const facts of model.zones.values()) {
    const { zone } = facts;
    if (facts.cells === 0) continue;
    if (!reachable.has(zone.id)) {
      const touching = model.borders.some((border) => border.a === zone.id || border.b === zone.id);
      findings.push(`${zone.name} is never reachable from the start through declared connections${touching ? "" : " and touches no other zone"}.`);
      continue;
    }
    const exits = new Set(model.crossings.filter((crossing) => crossing.from === zone.id).map((crossing) => crossing.to));
    // A built pad (a plaza, a landing pad) is ground dressing inside its zone, not a place to go.
    if (exits.size <= 1 && zone.id !== model.startZoneId && !used.has(zone.id) && zone.surface !== "built") {
      findings.push(`${zone.name} is a dead end with nothing in it (no anchor, placement, encounter or goal).`);
    }
  }
  return result(findings);
};

/**
 * LP-4: every goal zone outside the player's own ground is previewed before the player enters it:
 * revealed by the script in its beat or an earlier one (docs/adr/0004), or seen from ground the
 * player can stand on. Enemy-held high ground doesn't count.
 */
const readableApproach: Check = (model) => {
  if (!model.startZoneId || model.goals.length === 0) return notEvaluated("Needs a start zone and goals.");
  const findings: string[] = [];
  const previews: string[] = [];
  const firstBeat = new Map<string, number>();
  for (const goal of model.goals) firstBeat.set(goal.zoneId, Math.min(goal.beatIndex, firstBeat.get(goal.zoneId) ?? Infinity));
  for (const [goalZoneId, beatIndex] of firstBeat) {
    if (model.playerRegionZoneIds.has(goalZoneId)) continue;
    const revealedIn = model.blueprint.beats.findIndex((beat, index) => index <= beatIndex && revealedZoneIds(beat).includes(goalZoneId));
    if (revealedIn >= 0) {
      previews.push(`${name(model, goalZoneId)}: revealed in ${beatTitle(model, revealedIn)}.`);
      continue;
    }
    // Zones the player can stand in without having entered the goal.
    const before = reachableFrom(model, model.startZoneId, {
      without: new Set(model.crossings.filter((crossing) => crossing.to === goalZoneId).map((crossing) => crossingKey(crossing.from, crossing.to))),
    });
    const held = enemyHeldAt(model, beatIndex);
    const viewpoints = [...before].filter((zoneId) => !held.has(zoneId) && model.overlooks.get(zoneId)?.has(goalZoneId));
    if (viewpoints.length > 0) {
      previews.push(`${name(model, goalZoneId)}: overlooked from ${names(model, viewpoints)}.`);
    } else {
      findings.push(
        `Nothing reveals ${name(model, goalZoneId)} by its beat and nothing the player can stand on overlooks it; add it to a beat's reveals (a camera pan, a revealer, a tour), add high ground or a watchtower on the approach, or make it a deliberate blind climax.`,
      );
    }
  }
  return findings.length > 0 ? { status: "warn" as const, findings } : { status: "pass" as const, findings: previews };
};

/**
 * LP-3: one new thing at a time, and nothing introduced twice. Blizzard spaces introductions about
 * 60-110 s apart inside long beats, so several in one beat, or new twists in the final beat, are
 * reported for review rather than warned about.
 */
const teaching: Check = (model) => {
  const beats = model.blueprint.beats;
  if (beats.every((beat) => beat.introduces.length === 0)) return notEvaluated("No beat lists what it introduces.");
  const duplicates: string[] = [];
  const review: string[] = [];
  beats.forEach((beat, index) => {
    if (beat.introduces.length > MAX_INTRODUCTIONS_PER_BEAT) {
      review.push(`"${beat.title}" introduces ${beat.introduces.length} things (${beat.introduces.join(", ")}); check they arrive one at a time.`);
    }
    if (index === beats.length - 1 && beats.length > 1 && beat.introduces.length > 0) {
      review.push(`The final beat, "${beat.title}", introduces ${beat.introduces.join(", ")}; fine as a twist, but the climax should test what was taught.`);
    }
  });
  const seen = new Map<string, string>();
  for (const beat of beats) {
    for (const thing of beat.introduces) {
      const earlier = seen.get(thing);
      if (earlier) duplicates.push(`${thing} is introduced twice ("${earlier}" and "${beat.title}").`);
      else seen.set(thing, beat.title);
    }
  }
  for (const wave of model.blueprint.waves) {
    const waveBeat = model.beatIndex.get(wave.startsAtBeat)!;
    const untaught = [...new Set(wave.units.map((unit) => unit.type))].filter((unitType) => !beats.some((beat, index) => index <= waveBeat && beat.introduces.includes(unitType)));
    if (untaught.length > 0) {
      review.push(`Wave ${wave.id} brings ${untaught.join(", ")} in "${beatTitle(model, waveBeat)}", but no beat up to it introduces them.`);
    }
  }
  if (duplicates.length > 0) return { status: "warn", findings: [...duplicates, ...review] };
  return review.length > 0 ? { status: "info", findings: review } : { status: "pass", findings: [] };
};

/**
 * ARCHETYPES.md: the declared archetype's calibrated bands, for the beats it covers. Structure and
 * wave timing outside a band warn; travel times outside one are reported. Bands that need data
 * the blueprint can't hold yet are named.
 */
const archetypeBands: Check = (model) => {
  const beatsOf = new Map<Archetype, number[]>();
  model.archetypes.forEach((archetype, index) => {
    if (archetype) beatsOf.set(archetype, [...(beatsOf.get(archetype) ?? []), index]);
  });
  if (beatsOf.size === 0) return notEvaluated("No archetype declared on the blueprint or a beat.");
  const problems: string[] = [];
  const report: string[] = [];
  const outside = (seconds: number, [low, high]: readonly [number, number]) => seconds < low || seconds > high;

  const holdBeats = beatsOf.get("hold");
  if (holdBeats) {
    const { groundEntrances, minWarningSeconds, minIntervalSeconds, minIntervalPerTravel } = BANDS.hold;
    const { ground } = entrancesInto(model, model.playerRegionZoneIds);
    if (outside(ground.length, groundEntrances)) {
      problems.push(`Hold: the held region has ${ground.length} ground entrances; the band is ${groundEntrances[0]}-${groundEntrances[1]}.`);
    }
    const finalBeat = model.blueprint.beats.length - 1;
    const holdWaves = model.blueprint.waves.filter(
      (wave) =>
        wave.arrival === "ground" &&
        holdBeats.includes(model.beatIndex.get(wave.startsAtBeat)!) &&
        wave.targetZoneIds.some((zoneId) => model.playerRegionZoneIds.has(zoneId)),
    );
    for (const wave of holdWaves) {
      // Of the held candidates' routes, the least warning and the longest trip.
      const paths = wave.targetZoneIds
        .filter((zoneId) => model.playerRegionZoneIds.has(zoneId))
        .flatMap((zoneId) => waveRoute(model, wave, zoneId) ?? []);
      if (paths.length === 0) continue;
      const warning = Math.min(...paths.map((path) => path.entrance?.seconds ?? path.seconds));
      const trip = Math.max(...paths.map((path) => path.seconds));
      if (warning < minWarningSeconds) {
        problems.push(`Hold: wave ${wave.id} reaches the held region about ${Math.round(warning)} s after setting off; the band is at least ${minWarningSeconds} s of warning.`);
      }
      // A finale in the final beat may hammer the base (Zero Hour: every 20 s).
      if (wave.intervalSeconds === undefined || model.beatIndex.get(wave.startsAtBeat) === finalBeat) continue;
      if (wave.intervalSeconds < minIntervalSeconds) {
        problems.push(`Hold: wave ${wave.id} repeats every ${wave.intervalSeconds} s; outside the final beat the band is at least ${minIntervalSeconds} s.`);
      }
      if (wave.intervalSeconds < minIntervalPerTravel * trip) {
        problems.push(`Hold: wave ${wave.id} repeats every ${wave.intervalSeconds} s, under ${minIntervalPerTravel}× its ${Math.round(trip)} s trip.`);
      }
    }
    if (holdWaves.length === 0) report.push("Hold: no ground waves attack the held region, so the warning and interval bands can't be checked.");
  }

  const assaultBeats = beatsOf.get("assault");
  if (assaultBeats) {
    const { goalSeconds, minEntrancesPerBase } = BANDS.assault;
    for (const region of heldRegions(model).filter((candidate) => candidate.label === "Enemy-held region")) {
      const { ground } = entrancesInto(model, region.zoneIds);
      if (ground.length < minEntrancesPerBase) {
        problems.push(`Assault: enemy base ${names(model, region.zoneIds)} has ${ground.length} ground ${ground.length === 1 ? "entrance" : "entrances"}; the band is at least ${minEntrancesPerBase} (one into an inner keep is fine).`);
      }
    }
    for (const goal of model.goals.filter((candidate) => assaultBeats.includes(candidate.beatIndex))) {
      const best = playerRoute(model, goal);
      if (best && outside(best.seconds, goalSeconds)) {
        report.push(`Assault: ${name(model, goal.zoneId)} is about ${Math.round(best.seconds)} s from ${origin(model, goal)}; the band is ${goalSeconds[0]}-${goalSeconds[1]} s from the base the assault is launched from.`);
      }
    }
  }

  // The nearest goal of the first beat that has any, unless a hold (its goal is home) or an assault (banded above).
  // The player's own trips: not a hold, and not another unit's route (an escort).
  const placeGoals = model.goals.filter((goal) => !goal.hold && !goal.from);
  const firstBeat = Math.min(...placeGoals.map((goal) => goal.beatIndex));
  const firstArchetype = model.archetypes[firstBeat];
  if (firstArchetype && firstArchetype !== "hold" && firstArchetype !== "assault") {
    const times = placeGoals
      .filter((goal) => goal.beatIndex === firstBeat)
      .flatMap((goal) => {
        const best = playerRoute(model, goal);
        return best ? [{ goal, seconds: best.seconds }] : [];
      })
      .sort((a, b) => a.seconds - b.seconds);
    const first = times[0];
    const [low, high] = BANDS.startToFirstGoalSeconds;
    if (first && outside(first.seconds, [low, high])) {
      report.push(`The first goal, ${name(model, first.goal.zoneId)}, is about ${Math.round(first.seconds)} s from the start; missions mostly put it ${low}-${high} s away.`);
    }
  }

  const escortBeats = beatsOf.get("escort");
  if (escortBeats) {
    const [low, high] = BANDS.escort.roadCells;
    const escorts = model.goals.filter((goal) => goal.from && escortBeats.includes(goal.beatIndex));
    for (const goal of escorts) {
      const best = playerRoute(model, goal);
      if (best && outside(best.cells, [low, high])) {
        report.push(`Escort: ${anchorName(model, goal.from!.anchorId)}'s road to ${name(model, goal.zoneId)} is about ${Math.round(best.cells)} cells; the band is ${low}-${high}.`);
      }
    }
    if (escorts.length === 0) {
      report.push("Escort: no escort beat has a goal for a unit other than the player's start unit to reach a zone, so the road band can't be checked.");
    }
  }
  if (beatsOf.has("moving-hazard") && retreatThreats(model).length === 0) {
    report.push("Moving hazard: no Threat to retreat from, so hazard-retreat can't check the warning against the retreat.");
  }
  if (problems.length > 0) return { status: "warn", findings: [...problems, ...report] };
  return report.length > 0 ? { status: "info", findings: report } : { status: "pass", findings: [] };
};

/** Threats the player must retreat from: every one but combat, which the player can stand and fight, unless it names safe ground. */
const retreatThreats = (model: LayoutModel): readonly Threat[] =>
  model.threats().filter((threat) => threat.consequence !== "combat" || threat.safety.zoneIds.length > 0);

/** A note on findings that use the placeholder setback band. */
const placeholderNote = (threat: Threat): string =>
  threat.consequence === "setback" ? ` The setback band (${WINDOW_PER_CROSSING.setback}×) is a placeholder until a stealth mission's patrols are studied.` : "";

/**
 * How long a patrol walking its route at `speed` leaves a point on it out of sight: from one pass
 * to the next, less the time its sight takes to sweep past. Going round, every point waits a lap;
 * there and back, the middle of the route is passed every half round trip. A pause at each end
 * (or at the start, going round) adds to that.
 */
function patrolGapSeconds(route: readonly { x: number; y: number }[], radius: number, schedule: Extract<Schedule, { kind: "patrol" }>): number {
  return (routeLength(route) - 2 * radius) / schedule.speed + (schedule.pauseSeconds ?? 0);
}

/**
 * ADR 0004, ADR 0006 and ARCHETYPES.md, Moving hazard: window versus crossing. Each Threat's
 * window must be at least k× the time to cross to safety, with k chosen by its consequence
 * (WINDOW_PER_CROSSING). For a Zone footprint the window is the warning and the crossing is the
 * worst retreat from anywhere in it to safe ground (Devil's Playground: 10 s against 6-8 s); for a
 * traversal Threat like the flare this is the gap between shelters, for an occupation Threat like
 * lava the retreat off the fields. For a route footprint (a patrol and its sight) the crossing is
 * walking across its sight, and the window is the gap between passes, or the warning.
 */
const hazardRetreat: Check = (model) => {
  const threats = retreatThreats(model);
  if (threats.length === 0) return notEvaluated("No Threat to retreat from.");
  const problems: string[] = [];
  const report: string[] = [];
  for (const threat of threats) {
    const label = `Threat ${threat.source.id}`;
    const speed = threat.safety.retreatSpeed ?? REFERENCE_SPEED;
    const k = WINDOW_PER_CROSSING[threat.consequence];
    const { footprint } = threat;
    if ("route" in footprint) {
      const band = 2 * footprint.radius;
      const crossing = band / speed;
      const patrol = threat.schedule.kind === "patrol" ? threat.schedule : undefined;
      const { warningSeconds, description } = threat.telegraph;
      const windowSeconds = patrol ? patrolGapSeconds(footprint.route, footprint.radius, patrol) : warningSeconds;
      if (windowSeconds === undefined) {
        report.push(`${label}: its telegraph (${description}) gives no warning time, so crossing its sight can't be judged.`);
        continue;
      }
      const window = patrol ? `about ${Math.max(0, Math.round(windowSeconds))} s between passes` : `${Math.round(windowSeconds)} s of warning (${description})`;
      const crossed = `crossing its ${Math.round(band)}-cell sight takes about ${Math.round(crossing)} s`;
      if (windowSeconds < k * crossing) {
        problems.push(`${label}: ${crossed}, so the band is a window of at least ${Math.ceil(k * crossing)} s; it leaves ${window}.${placeholderNote(threat)}`);
      } else {
        report.push(`${label}: ${crossed}, against ${window}.${placeholderNote(threat)}`);
      }
      continue;
    }
    const distance = distancesTo(model, new Set(threat.safety.zoneIds));
    const indexOf = new Map(model.blueprint.zones.map((zone, index) => [zone.id, index]));
    const worstCells = new Map(footprint.zoneIds.map((zoneId) => [zoneId, -1]));
    model.owner.forEach((owner, cell) => {
      const zoneId = model.blueprint.zones[owner]?.id;
      if (zoneId !== undefined && worstCells.has(zoneId)) worstCells.set(zoneId, Math.max(worstCells.get(zoneId)!, distance[cell]!));
    });
    const stranded = [...worstCells].filter(([, cells]) => cells === Infinity).map(([zoneId]) => zoneId);
    if (stranded.length > 0) problems.push(`${label}: no ground way to safe ground from ${names(model, stranded)}.`);
    const reachable = [...worstCells].filter(([zoneId, cells]) => cells >= 0 && cells < Infinity && indexOf.has(zoneId));
    if (reachable.length === 0) continue;
    const { warningSeconds, description } = threat.telegraph;
    if (warningSeconds === undefined) {
      report.push(`${label}: its telegraph (${description}) gives no warning time, so the retreat can't be judged.`);
      continue;
    }
    const warning = `${Math.round(warningSeconds)} s of warning (${description})`;
    const maxRetreat = warningSeconds / k + RETREAT_SLACK_SECONDS;
    const tooFar = reachable
      .filter(([, cells]) => cells / speed > maxRetreat)
      .sort((a, b) => b[1] - a[1])
      .map(([zoneId, cells]) => `${name(model, zoneId)} (about ${Math.round(cells / speed)} s, ${Math.round(cells)} cells)`);
    if (tooFar.length > 0) {
      problems.push(`${label}: against ${warning}, the band is a retreat of at most ${Math.floor(maxRetreat)} s; too far from safe ground: ${tooFar.join("; ")}.${placeholderNote(threat)}`);
      continue;
    }
    const [worstZone, worst] = reachable.reduce((a, b) => (b[1] > a[1] ? b : a));
    report.push(`${label}: the worst retreat is about ${Math.round(worst / speed)} s (${Math.round(worst)} cells) from ${name(model, worstZone)}, against ${warning}.${placeholderNote(threat)}`);
  }
  if (problems.length > 0) return { status: "warn", findings: [...problems, ...report] };
  return { status: "pass", findings: report };
};

/**
 * ADR 0006: checkpoint spacing, the setback Threats' refuge spacing. A setback Threat sends a
 * player it catches back to its checkpoints (its safe ground); how far back is what one mistake
 * costs. Reported, not judged, until a stealth mission's patrols are studied; a setback with no checkpoint warns.
 */
const checkpointSpacing: Check = (model) => {
  const setbacks = model.threats().filter((threat) => threat.consequence === "setback");
  if (setbacks.length === 0) return notEvaluated("No setback Threat, so no checkpoints to space.");
  const problems: string[] = [];
  const report: string[] = [];
  for (const threat of setbacks) {
    const label = `Threat ${threat.source.id}`;
    if (threat.safety.zoneIds.length === 0) {
      problems.push(`${label} sends the player back to a checkpoint, but names none.`);
      continue;
    }
    const checkpoints = names(model, threat.safety.zoneIds);
    const distance = distancesTo(model, new Set(threat.safety.zoneIds));
    const cells = footprintCells(model, threat.footprint).filter((cell) => distance[cell]! < Infinity);
    if (cells.length === 0) {
      report.push(`${label}: nowhere it reaches has a ground way back to ${checkpoints}.`);
      continue;
    }
    const worst = cells.reduce((a, b) => (distance[b]! > distance[a]! ? b : a));
    const speed = threat.safety.retreatSpeed ?? REFERENCE_SPEED;
    const zone = model.blueprint.zones[model.owner[worst]!]!;
    report.push(
      `${label}: caught at worst in ${zone.name}, about ${Math.round(distance[worst]! / speed)} s (${Math.round(distance[worst]!)} cells) from its checkpoint (${checkpoints}).`,
    );
  }
  if (problems.length > 0) return { status: "warn", findings: [...problems, ...report] };
  return { status: "info", findings: report };
};

/** When a Connection change shuts a crossing that was open, and which directions it shuts; undefined when it never does. */
type Closing = { readonly directions: ReadonlySet<string>; readonly range: BeatRange; readonly what: string };

function closing(model: LayoutModel, change: ConnectionChange): Closing | undefined {
  const { fromZoneId: a, toZoneId: b, schedule } = change;
  const both = new Set([directedKey(a, b), directedKey(b, a)]);
  const range = beatRange(model.beatIndex, schedule);
  const pair = `${name(model, a)} ↔ ${name(model, b)}`;
  switch (change.state) {
    case "closed":
      return { directions: both, range, what: `closes ${pair}` };
    case "one-way":
      return { directions: new Set([directedKey(b, a)]), range, what: `makes ${name(model, a)} → ${name(model, b)} one-way` };
    case "open":
      // Rocks cleared at a Beat stay cleared; anything else is shut again outside its Schedule.
      if (schedule.kind === "from-beat" && schedule.untilBeatId === undefined) return undefined;
      return {
        directions: both,
        range: schedule.kind === "from-beat" ? { from: range.until, until: Infinity } : { from: range.from, until: Infinity },
        what: `opens ${pair} only`,
      };
  }
}

/**
 * ADR 0006: a Connection that closes on a Schedule mustn't trap the player on a Threat's ground.
 * Changes one source gives on the same Schedule close together (a tide flooding two fords). For
 * each such closing that can share a Beat with a Threat, every Zone of the Threat's footprint that
 * has a ground way to its safe ground with every Connection open must keep one in each shared Beat,
 * with the closing shut and the other Connections as they are then (a tide that floods the ford off
 * the low ground while the low ground drowns). A setback's checkpoints aren't shelters to reach, so
 * setback Threats aren't checked.
 */
const closingTraps: Check = (model) => {
  const groups = new Map<string, { change: ConnectionChange; directions: Set<string>; range: BeatRange; whats: string[] }>();
  for (const change of model.connectionChanges) {
    const shut = closing(model, change);
    if (!shut) continue;
    const key = JSON.stringify([change.source, change.state === "open", change.schedule]);
    const group = groups.get(key) ?? { change, directions: new Set<string>(), range: shut.range, whats: [] };
    for (const direction of shut.directions) group.directions.add(direction);
    group.whats.push(shut.what);
    groups.set(key, group);
  }
  if (groups.size === 0) return notEvaluated("No Connection closes on a Schedule.");
  const threats = retreatThreats(model).filter((threat) => threat.consequence !== "setback" && threat.safety.zoneIds.length > 0);
  if (threats.length === 0) return notEvaluated("No Threat names safe ground for a closing to cut off.");
  const beats = model.blueprint.beats.length;
  const findings: string[] = [];
  for (const threat of threats) {
    const safe = new Set(threat.safety.zoneIds);
    const reachesSafety = (zoneId: string, options: TraversalOptions = {}) => [...reachableFrom(model, zoneId, options)].some((reached) => safe.has(reached));
    // Zones that can get to safety at all; only these can be trapped.
    const footprint = footprintZoneIds(model, threat.footprint).filter((zoneId) => !safe.has(zoneId) && reachesSafety(zoneId));
    const threatRange = beatRange(model.beatIndex, threat.schedule);
    for (const group of groups.values()) {
      if (!overlaps(group.range, threatRange)) continue;
      const from = Math.max(group.range.from, threatRange.from);
      const until = Math.min(group.range.until, threatRange.until, beats);
      const trapped = footprint.filter((zoneId) => {
        for (let beatIndex = from; beatIndex < until; beatIndex++) if (!reachesSafety(zoneId, { beatIndex, closed: group.directions })) return true;
        return false;
      });
      if (trapped.length === 0) continue;
      const by = group.change.source.kind === "Mechanic" ? `Mechanic ${group.change.source.id}` : "The Blueprint";
      const when = describeSchedule(model.blueprint, group.change.schedule);
      findings.push(
        `${by} ${group.whats.join(" and ")} ${when}, while Threat ${threat.source.id} can be active: ${names(model, trapped)} then ${trapped.length === 1 ? "has" : "have"} no ground way to safe ground (${names(model, safe)}).`,
      );
    }
  }
  return result(findings);
};

/** LP-12: vaults are small single-entrance pockets off the critical path; an air-only pocket counts. */
const vaults: Check = (model) => {
  const vaultZones = [...model.zones.values()].filter((facts) => facts.zone.role === "vault");
  if (vaultZones.length === 0) return notEvaluated("No zone has the vault role.");
  const onPath = new Set<string>();
  for (const goal of model.goals) for (const zoneId of playerRoute(model, goal)?.zoneIds ?? []) onPath.add(zoneId);
  const findings: string[] = [];
  for (const { zone } of vaultZones) {
    const inbound = model.crossings.filter((crossing) => crossing.to === zone.id);
    const ground = new Set(inbound.filter((crossing) => crossing.type !== "air-only").map((crossing) => crossing.from));
    const ways = ground.size > 0 ? ground.size : new Set(inbound.map((crossing) => crossing.from)).size;
    if (ways !== 1) findings.push(`Vault ${zone.name} has ${ways} entrances; a vault has one.`);
    if (onPath.has(zone.id)) findings.push(`Vault ${zone.name} is on the route to a goal; a vault is optional and off the critical path.`);
  }
  return result(findings);
};

/** A goal whose ground way is at least this many times the straight line is one air shortens: the lowest ratio in the tech-tree research's §7 table. */
const AIR_SHORTCUT = 1.2;

/**
 * What flying bypasses, when the blueprint's `tech` lets player 1 fly (tech-tree research §5.4, §8.6):
 * air-only links, connections that close or are blocked (collapsible, rocks, scheduled closings),
 * and goals whose ground way is much longer than the straight line. An allow list with no flyer
 * passes: cliffs, chasms and collapses hold. Without an allow list, restrictions stay off, so any
 * flyer not disallowed may be buildable. Ground cliff-crossers (Blink, Colossus, Reapers) and
 * transports' drops aren't counted yet.
 */
const airBypass: Check = (model) => {
  const tech = model.blueprint.tech.find((entry) => entry.player === 1);
  if (!tech) return notEvaluated("The blueprint gives player 1 no tech, so whether they can fly isn't declared.");
  const findings: string[] = [];
  if (tech.allow) {
    const flyers = [...tech.allow.units, ...tech.allow.buildings].filter((id) => techUnit(blueprintCatalog(model.blueprint), id)?.flyer);
    if (flyers.length === 0) return result([]);
    findings.push(`Player 1's tech allows flyers (${flyers.join(", ")}); terrain doesn't stop them:`);
  } else {
    findings.push("Player 1's tech has no allow list, so any flyer it doesn't disallow may be buildable; terrain doesn't stop them:");
  }
  const pair = (a: string, b: string) => `${name(model, a)} ↔ ${name(model, b)}`;
  const seen = new Set<string>();
  for (const crossing of model.crossings) {
    const key = crossingKey(crossing.from, crossing.to);
    if (seen.has(key)) continue;
    if (crossing.type === "air-only") findings.push(`  air-only ${pair(crossing.from, crossing.to)} opens to them`);
    else if (crossing.type === "collapsible") findings.push(`  ${pair(crossing.from, crossing.to)} (collapsible) doesn't hold them once it closes`);
    else if (crossing.type === "rocks") findings.push(`  ${pair(crossing.from, crossing.to)} (rocks) doesn't stop them before it's cleared`);
    else continue;
    seen.add(key);
  }
  for (const change of model.connectionChanges) {
    const key = crossingKey(change.fromZoneId, change.toZoneId);
    const shut = closing(model, change);
    if (!shut || seen.has(key)) continue;
    seen.add(key);
    const by = change.source.kind === "Mechanic" ? `Mechanic ${change.source.id}` : "the Blueprint";
    findings.push(`  ${by} ${shut.what} ${describeSchedule(model.blueprint, change.schedule)}, which doesn't hold them`);
  }
  const { width } = model.blueprint.mapSize;
  const zoneIndex = new Map(model.blueprint.zones.map((zone, index) => [zone.id, index]));
  for (const goal of model.goals) {
    const route = playerRoute(model, goal);
    const start = route?.path[0];
    if (!route || start === undefined) continue;
    const [sx, sy] = [start % width, Math.floor(start / width)];
    let air = Infinity;
    if (goal.point) air = Math.hypot(Math.floor(goal.point.x) - sx, Math.floor(goal.point.y) - sy);
    else {
      const target = zoneIndex.get(goal.zoneId);
      model.owner.forEach((owner, cell) => {
        if (owner === target) air = Math.min(air, Math.hypot((cell % width) - sx, Math.floor(cell / width) - sy));
      });
    }
    if (air > 0 && route.cells / air >= AIR_SHORTCUT) {
      findings.push(`  ${goal.source} (${name(model, goal.zoneId)}): ${Math.round(route.cells)} cells by ground, ${Math.round(air)} by air (${(route.cells / air).toFixed(1)}×)`);
    }
  }
  if (findings.length === 1) findings.push("  nothing here yet: no air-only link, closable connection or long ground way to a goal");
  return { status: "info", findings };
};

/**
 * ADR-0015: the map's playable area holds the Zones units walk, and the bounds each Beat sets hold
 * what it uses (bounds-checks.ts), with the compile's own advice on those bounds.
 */
const bounds: Check = (model, { triggerScenes = [] }) => {
  const { blueprint } = model;
  return result([...boundsWarnings(blueprint), ...boundsFindings(blueprint, assumedPlayableBounds(blueprint), triggerScenes)]);
};

/**
 * Each ground Connection must be passable on the generated terrain: a cliff between the Zones with
 * no ramp, or cells the author painted unpathable, can leave one blocked (route-checks.ts).
 */
const routeOpen: Check = (model) => result(routeFindings(model));

/** The Blueprint's declared route tests (`tests.routes`, issue #741), walked on the generated terrain. */
const routeTests: Check = (model) => {
  const results = routeTestResults(model);
  if (results.length === 0) return notEvaluated("The Blueprint declares no route tests (tests.routes).");
  return result(results.filter((test) => !test.passed).map((test) => test.message));
};

const CHECKS: readonly (readonly [id: string, title: string, source: string, check: Check])[] = [
  ["terrain-agreement", "Declared connections match the terrain", "LP-16", terrainAgreement],
  ["critical-path", "Ground route from the start to every goal", "§4.2, LP-7, LP-14", criticalPath],
  ["beat-gating", "Goals reachable when their beat needs them", "LP-13", beatGating],
  ["entrances", "Entrances into held regions and goals", "§4.3", entrances],
  ["travel-times", "Travel time to each goal", "§4.4", travelTimes],
  ["goal-spread", "Separate goal sites per beat", "§4.4c, LP-13", goalSpread],
  ["safe-havens", "No threats at the start or around critical anchors", "§4.4d, LP-11, PC-5", safeHavens],
  ["dead-space", "No unreachable or empty dead-end zones", "§4.6, LP-17", deadSpace],
  ["threat-paths", "Waves come by a route the defender can read", "ADR 0004", threatPaths],
  ["readable-approach","Each goal is seen before it's entered", "LP-4", readableApproach],
  ["teaching", "One new thing at a time", "LP-3", teaching],
  ["vaults", "Vaults are single-entrance pockets off the critical path", "LP-12", vaults],
  ["hazard-retreat", "Each Threat warns long enough to reach safe ground", "ADR 0004; ADR 0006; ARCHETYPES.md", hazardRetreat],
  ["checkpoint-spacing", "What one mistake costs against each setback Threat", "ADR 0006", checkpointSpacing],
  ["closing-traps", "No Connection closes to trap the player on a Threat's ground", "ADR 0006", closingTraps],
  ["archetype-bands", "The layout fits its archetype's calibrated bands", "ARCHETYPES.md", archetypeBands],
  ["air-bypass", "What the player's flyers bypass", "tech-tree research §5.4, §8", airBypass],
  ["bounds", "The playable area and camera bounds hold what each Beat uses", "ADR-0015", bounds],
  ["route-open", "Each ground Connection can be walked on the generated terrain", "#749", routeOpen],
  ["route-tests", "Declared route tests arrive or are blocked as expected", "#741", routeTests],
];

/** Every check, not evaluated, for `reason`: a Blueprint with nothing the checks can read. */
export function layoutChecksSkipped(reason: string): CheckResult[] {
  return CHECKS.map(([id, title, source]) => ({ id, title, source, ...notEvaluated(reason) }));
}

/**
 * Every check's result. A check that throws (a Plugin's threats hook failing, say) is reported as
 * not evaluated, with the reason, and the other checks still run.
 */
export function runLayoutChecks(model: LayoutModel, context: CheckContext = {}): CheckResult[] {
  return CHECKS.map(([id, title, source, check]) => {
    try {
      return { id, title, source, ...check(model, context) };
    } catch (error) {
      return { id, title, source, ...notEvaluated(`The check couldn't run: ${error instanceof Error ? error.message : String(error)}`) };
    }
  });
}
