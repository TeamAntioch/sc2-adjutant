import type { MissionBlueprint } from "../domain/mission-blueprint.js";

/**
 * How a Beat starts in the compiled map: by its "Beat - <title>" trigger when it has `startsWhen`,
 * with the mission when it's the first Beat without, and otherwise not at all. The trigger has an
 * event for an Anchor's condition; a Kept trigger's run, a scene playing or a Mechanic's moment
 * (`{ type: "mechanic", mechanicId, cue }`, run where the Mechanic's triggers reach it) runs it instead.
 */
export function beatStart(blueprint: Pick<MissionBlueprint, "beats">, beatId: string): "trigger" | "mission" | undefined {
  const index = blueprint.beats.findIndex((beat) => beat.id === beatId);
  if (index < 0) return undefined;
  if (blueprint.beats[index]!.startsWhen !== undefined) return "trigger";
  return index === 0 ? "mission" : undefined;
}

