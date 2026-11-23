// The Mission's Connection changes (docs/adr/0006), for the layout model: the Blueprint's
// `opensAtBeat` and `closesAtBeat` shorthand as from-a-Beat changes, then each Mechanic's from its
// `connectionChanges` hook.

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { type MechanicConnectionChange, MechanicConnectionChangeSchema } from "../domain/schedule.js";
import { mechanicContext } from "../plugins/mechanic-context.js";
import { pluginMechanicEntries, runHook } from "../plugins/plugin-api.js";
import { scheduleProblems } from "./schedules.js";
import { ownedSchedule } from "./threats.js";

/** A Connection change in the layout model, and where it came from: a Blueprint connection's shorthand, or a Mechanic. */
export type ConnectionChange = MechanicConnectionChange & {
  readonly source: { readonly kind: "connection" | "Mechanic"; readonly id: string };
};

/** Every Connection change in the Mission: the Blueprint's shorthand in zone order, then each Mechanic's in Blueprint order. */
export function missionConnectionChanges(blueprint: MissionBlueprint): ConnectionChange[] {
  const changes: ConnectionChange[] = [];
  // Both sides of a two-way connection may list the same shorthand; it is one change.
  const seen = new Set<string>();
  for (const zone of blueprint.zones) {
    for (const connection of zone.connections) {
      const pair = connection.oneWay ? `${zone.id}>${connection.toZoneId}` : [zone.id, connection.toZoneId].sort().join("|");
      const shorthand = [
        ["open", connection.opensAtBeat],
        ["closed", connection.closesAtBeat],
      ] as const;
      for (const [state, beatId] of shorthand) {
        if (beatId === undefined || seen.has(`${pair}:${state}`)) continue;
        seen.add(`${pair}:${state}`);
        changes.push({
          fromZoneId: zone.id,
          toZoneId: connection.toZoneId,
          state,
          schedule: { kind: "from-beat", beatId },
          source: { kind: "connection", id: `${zone.id} → ${connection.toZoneId}` },
        });
      }
    }
  }

  // A change must name a declared Connection; a one-way one, a direction it can be walked.
  const declared = new Set(blueprint.zones.flatMap((zone) => zone.connections.map((connection) => `${zone.id}>${connection.toZoneId}`)));
  const twoWay = new Set(
    blueprint.zones.flatMap((zone) => zone.connections.filter((connection) => !connection.oneWay).map((connection) => `${connection.toZoneId}>${zone.id}`)),
  );
  const walkable = (from: string, to: string) => declared.has(`${from}>${to}`) || twoWay.has(`${from}>${to}`);
  for (const entry of pluginMechanicEntries(blueprint)) {
    const given = runHook(entry.label, "connectionChanges hook", () => entry.mechanic.connectionChanges?.(entry.params, { ...mechanicContext(blueprint), mechanicId: entry.id }) ?? []);
    given.forEach((raw, index) => {
      const fail = (problem: string): never => {
        throw new Error(`${entry.label}: its connectionChanges hook gave a bad change ${index}: ${problem}`);
      };
      const parsed = MechanicConnectionChangeSchema.safeParse(raw);
      if (!parsed.success) fail(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
      const change = parsed.data!;
      const { fromZoneId, toZoneId } = change;
      if (change.state === "one-way" ? !walkable(fromZoneId, toZoneId) : !walkable(fromZoneId, toZoneId) && !walkable(toZoneId, fromZoneId)) {
        fail(`the Blueprint declares no connection ${change.state === "one-way" ? "walkable " : ""}from ${fromZoneId} to ${toZoneId}`);
      }
      for (const problem of scheduleProblems(blueprint, change.schedule, entry.id)) fail(problem);
      changes.push({ ...change, schedule: ownedSchedule(change.schedule, entry.id), source: { kind: "Mechanic", id: entry.id } });
    });
  }
  return changes;
}
