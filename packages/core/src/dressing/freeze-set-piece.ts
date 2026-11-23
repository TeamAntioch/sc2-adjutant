import { missionBlueprintSchema } from "../domain/mission-blueprint.js";
import type { Workspace } from "../plugins/workspace.js";
import { rasterizeTerrain, terrainHeightAt } from "../terrain/rasterize.js";
import { expandDressing } from "./expand-dressing.js";

/**
 * The blueprint (as written, unparsed) with one set piece replaced by the doodad anchors it
 * expands to, numbered `<set piece>-1`, `-2`... in placement order. Other set pieces keep
 * their placements, and because each doodad is seeded on its own they don't move.
 */
export function freezeSetPiece(
  raw: Record<string, unknown>,
  setPieceId: string,
  /** What the Blueprint is validated against: its Workspace's Plugins, and its Mission's catalog (missionWorkspace). */
  workspace: Pick<Workspace, "registry" | "catalog">,
): { blueprint: Record<string, unknown>; frozen: number } {
  const blueprint = missionBlueprintSchema(workspace.registry, workspace.catalog).parse(raw);
  const placement = blueprint.placements.find((p) => p.id === setPieceId && p.kind === "set-piece");
  if (!placement) throw new Error(`No set piece ${setPieceId}`);
  const terrain = rasterizeTerrain(blueprint);
  const { doodads } = expandDressing(blueprint, terrain);
  const members = doodads.filter((doodad) => doodad.setPieceId === setPieceId);
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  const anchors = members.map((doodad, index) => ({
    id: `${setPieceId}-${index + 1}`,
    name: doodad.type,
    zoneId: placement.zoneId,
    kind: "doodad",
    position: {
      x: round(doodad.x),
      y: round(doodad.y),
      // Only when raised or sunk by hand; otherwise it follows the ground.
      ...(Math.abs(doodad.z - terrainHeightAt(terrain, blueprint.mapSize.width, doodad.x, doodad.y)) > 0.05 ? { z: round(doodad.z) } : {}),
    },
    doodadType: doodad.type,
    variation: doodad.variation,
    rotation: round(doodad.rotation),
    ...(doodad.pitch !== undefined ? { pitch: doodad.pitch } : {}),
    ...(doodad.roll !== undefined ? { roll: doodad.roll } : {}),
    scale: doodad.scale,
    ...(doodad.tint ? { tint: doodad.tint } : {}),
    ...(doodad.forcePlacement ? { forcePlacement: true } : {}),
    ...(doodad.flags ? { flags: [...doodad.flags] } : {}),
  }));
  const placements = (raw["placements"] as { id: string }[]).filter((p) => p.id !== setPieceId);
  return {
    blueprint: { ...raw, anchors: [...((raw["anchors"] as unknown[] | undefined) ?? []), ...anchors], placements },
    frozen: anchors.length,
  };
}
