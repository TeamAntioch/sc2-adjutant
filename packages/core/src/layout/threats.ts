// The Mission's Threats (docs/adr/0006), for the layout model: encounters, enemy groups and Waves
// from core, and each Mechanic's from its `threats` hook.

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import type { Schedule } from "../domain/schedule.js";
import { type MechanicThreat, MechanicThreatSchema, type Threat } from "../domain/threat.js";
import { mechanicContext } from "../plugins/mechanic-context.js";
import { type PluginMechanicEntry, pluginMechanicEntries, runHook } from "../plugins/plugin-api.js";
import { scheduleProblems } from "./schedules.js";

const NO_TELEGRAPH = { description: "none declared" } as const;

type Encounter = MissionBlueprint["encounters"][number];
type EncounterStart = NonNullable<Encounter["startsWhen"]>;

/**
 * Where an encounter starts: its `startsWhen`'s Zone, for an Anchor entering one; where the Anchor
 * stands, for its dying or capture, which name no Zone; its trigger Zone otherwise.
 */
export function encounterStartZoneId(blueprint: MissionBlueprint, encounter: Encounter): string {
  const start = encounter.startsWhen;
  if (!start) return encounter.triggerZoneId;
  if (start.type === "anchorEntersZone") return start.zoneId;
  return blueprint.anchors.find((anchor) => anchor.id === start.anchorId)?.zoneId ?? encounter.triggerZoneId;
}

const sameStart = (a: EncounterStart, b: { readonly type: string; readonly anchorId?: string; readonly zoneId?: string }): boolean =>
  a.type === b.type && a.anchorId === b.anchorId && (a.type !== "anchorEntersZone" || a.zoneId === b.zoneId);

/**
 * The Beat an encounter is in effect from: the later of its `fromBeat` and one that starts on its
 * `startsWhen`, as far as the Blueprint says, else the first.
 */
function encounterStartBeatId(blueprint: MissionBlueprint, encounter: Encounter): string {
  const start = encounter.startsWhen;
  const index = (beatId: string | undefined): number => blueprint.beats.findIndex((beat) => beat.id === beatId);
  const onStart = start && blueprint.beats.find((candidate) => candidate.startsWhen?.some((condition) => sameStart(start, condition)))?.id;
  const latest = Math.max(0, index(onStart), index(encounter.fromBeat));
  return blueprint.beats[latest]?.id ?? "";
}

/**
 * The enemies' Threats, in Blueprint order: encounters, enemy groups, then waves. Core's own, so
 * they run no Plugin code and can be read eagerly.
 */
export function enemyThreats(blueprint: MissionBlueprint): Threat[] {
  // Encounters and enemy groups stand in Zones, which come with Beats; a Blueprint with neither has none.
  const firstBeatId = blueprint.beats[0]?.id ?? "";
  const anchorZone = new Map(blueprint.anchors.map((anchor) => [anchor.id, anchor.zoneId]));
  const threats: Threat[] = [];
  const combatThreat = (
    kind: Threat["source"]["kind"],
    id: string,
    zoneIds: readonly string[],
    schedule: Threat["schedule"],
    telegraph: Threat["telegraph"] = NO_TELEGRAPH,
  ): Threat => ({
    source: { kind, id },
    footprint: { zoneIds: [...new Set(zoneIds)] },
    schedule,
    telegraph,
    safety: { zoneIds: [] },
    consequence: "combat",
  });

  for (const encounter of blueprint.encounters) {
    const attackers = encounter.attackerAnchorIds.flatMap((anchorId) => anchorZone.get(anchorId) ?? []);
    threats.push(
      combatThreat("encounter", encounter.id, [encounterStartZoneId(blueprint, encounter), ...attackers], { kind: "from-beat", beatId: encounterStartBeatId(blueprint, encounter) }),
    );
  }
  for (const placement of blueprint.placements) {
    if (placement.kind !== "encounter-group") continue;
    threats.push(combatThreat("enemy group", placement.id, [placement.zoneId], { kind: "from-beat", beatId: placement.passiveUntilBeat ?? firstBeatId }));
  }
  for (const wave of blueprint.waves) {
    const { warning } = wave;
    // A warning on the first send only doesn't warn before each strike, so it gives no warning time.
    const telegraph = warning && {
      ...(warning.firstOnly ? {} : { warningSeconds: warning.seconds }),
      description: `a minimap ping${warning.transmission === undefined ? "" : " and a Transmission"} as the wave nears${warning.firstOnly ? `, ${warning.seconds} s out, on its first send only` : ""}`,
    };
    // Any candidate may be the one attacked (ADR 0008).
    threats.push(
      combatThreat(
        "wave",
        wave.id,
        wave.targetZoneIds,
        {
          kind: "cycle",
          fromBeatId: wave.startsAtBeat,
          ...(wave.endsAtBeat !== undefined ? { untilBeatId: wave.endsAtBeat } : {}),
          firstSeconds: wave.firstSeconds,
          ...(wave.intervalSeconds !== undefined ? { intervalSeconds: wave.intervalSeconds } : {}),
        },
        telegraph,
      ),
    );
  }
  return threats;
}

/** Every Threat in the Mission, in Blueprint order: the enemies', then Mechanics'. `walkableFrom` gives the zones a unit can walk to from a zone. */
export function missionThreats(blueprint: MissionBlueprint, walkableFrom: (zoneId: string) => ReadonlySet<string>): Threat[] {
  const threats: Threat[] = enemyThreats(blueprint);
  for (const entry of pluginMechanicEntries(blueprint)) {
    const source = { kind: "Mechanic", id: entry.id } as const;
    for (const threat of pluginThreats(blueprint, entry, walkableFrom)) threats.push({ source, ...threat });
  }
  return threats;
}

/** A Plugin Mechanic's Threats, checked against the schema and the Blueprint's zones, beats, anchors and map. */
function pluginThreats(blueprint: MissionBlueprint, entry: PluginMechanicEntry, walkableFrom: (zoneId: string) => ReadonlySet<string>): MechanicThreat[] {
  const context = { ...mechanicContext(blueprint), mechanicId: entry.id, walkableFrom };
  const given = runHook(entry.label, "threats hook", () => entry.mechanic.threats?.(entry.params, context) ?? []);
  const zoneIds = new Set(blueprint.zones.map((zone) => zone.id));
  // Only a unit can be a Threat's target.
  const anchorIds = new Set(blueprint.anchors.filter((anchor) => anchor.kind === "unit").map((anchor) => anchor.id));
  const { width, height } = blueprint.mapSize;
  return given.map((raw, index) => {
    const fail = (problem: string): never => {
      throw new Error(`${entry.label}: its threats hook gave a bad Threat ${index}: ${problem}`);
    };
    const parsed = MechanicThreatSchema.safeParse(raw);
    if (!parsed.success) fail(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    const threat = parsed.data!;
    const { footprint } = threat;
    const reached = "zoneIds" in footprint ? footprint.zoneIds : [];
    for (const zoneId of [...reached, ...threat.safety.zoneIds]) if (!zoneIds.has(zoneId)) fail(`unknown zone id ${zoneId}`);
    if ("route" in footprint) {
      for (const point of footprint.route) {
        if (point.x < 0 || point.y < 0 || point.x > width || point.y > height) fail(`route point (${point.x}, ${point.y}) is off the ${width}×${height} map`);
      }
    }
    for (const problem of scheduleProblems(blueprint, threat.schedule, entry.id)) fail(problem);
    if (threat.anchorId !== undefined && !anchorIds.has(threat.anchorId)) fail(`unknown unit anchor id ${threat.anchorId}`);
    return { ...threat, schedule: ownedSchedule(threat.schedule, entry.id) };
  });
}

/** A `while` Schedule names the Mechanic whose state it follows: the one that gave it, unless it says otherwise. */
export function ownedSchedule(schedule: Schedule, mechanicId: string): Schedule {
  return schedule.kind === "while" && schedule.mechanicId === undefined ? { ...schedule, mechanicId } : schedule;
}
