// The ground the player walks: the cells of the player's routes to every goal (DL-13's shore
// lights go where the player looks). A mission without a start or goals has no routes, so every
// cell of a zone units walk on (not a backdrop) counts.

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { buildLayoutModel, playerRoute } from "../layout/layout-model.js";

/** 1 for each cell the player walks, row-major over the map. */
export function walkedGround(blueprint: MissionBlueprint): Uint8Array {
  const { width, height } = blueprint.mapSize;
  const walked = new Uint8Array(width * height);
  const model = buildLayoutModel(blueprint);
  for (const goal of model.goals) for (const cell of playerRoute(model, goal)?.path ?? []) walked[cell] = 1;
  if (walked.some((cell) => cell === 1)) return walked;
  const backdrop = new Set(blueprint.zones.flatMap((zone, index) => (zone.backdrop ? [index] : [])));
  model.owner.forEach((owner, cell) => {
    if (owner >= 0 && !backdrop.has(owner)) walked[cell] = 1;
  });
  return walked;
}
