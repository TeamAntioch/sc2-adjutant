// Dressing edits of a Mission Blueprint on disk, validated before they are saved: what the
// `capture-composite` and `freeze-set-piece` CLIs and the MCP server's tools of the same names run.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Composite } from "../domain/mission-blueprint.js";
import { type EditResult, editMissionBlueprint } from "../edit/edit-blueprint.js";
import { readDoodadActors } from "../map/read-doodad-actors.js";
import { readRegionsXml } from "../map/read-regions-xml.js";
import { missionWorkspace } from "../map/mission-catalog.js";
import type { Workspace } from "../plugins/workspace.js";
import { loadMapPackage } from "../study/load-map-package.js";
import { terrainHeightAt } from "../study/terrain-grid.js";
import { slugOf } from "../sync/sync-shared.js";
import { captureComposite } from "./capture-composite.js";
import { freezeSetPiece } from "./freeze-set-piece.js";

export type CaptureMissionOptions = {
  /** The recipe's id; by default the region name as a slug. */
  readonly id?: string;
  readonly kind?: Composite["kind"];
  readonly style?: NonNullable<Composite["style"]>;
  /** The scale range each stamped copy is drawn from; by default [1, 1]. */
  readonly scale?: readonly [number, number];
};

/**
 * Captures the doodads inside a named region of an Editor-saved map as a Doodad Composite recipe
 * (DL-07), and saves it into the Blueprint's `composites`, replacing one with the same id. The
 * doodads stay in the map.
 */
export async function captureMissionComposite(
  workspace: Workspace,
  blueprintPath: string,
  mapPath: string,
  regionName: string,
  options: CaptureMissionOptions = {},
): Promise<{ readonly composite: Composite; readonly edit: EditResult }> {
  const map = loadMapPackage(mapPath);
  const region = readRegionsXml(await readFile(path.join(mapPath, "Regions"), "utf8")).find((r) => r.name === regionName);
  if (!region) throw new Error(`No region named "${regionName}" in ${mapPath}`);
  const [low, high] = options.scale ?? [1, 1];
  const id = options.id ?? slugOf(regionName);
  const actorData = path.join(mapPath, "Base.SC2Data", "GameData", "ActorData.xml");
  const actors = existsSync(actorData) ? readDoodadActors(await readFile(actorData, "utf8")) : new Map();
  const composite = captureComposite(map.objects.doodads, region.shapes, (x, y) => terrainHeightAt(map, x, y), {
    id,
    kind: options.kind ?? "landmark",
    style: options.style ?? "natural",
    scale: [low, high],
    actors,
  });
  const edit = await editMissionBlueprint(workspace, blueprintPath, (raw) => {
    const composites = ((raw["composites"] as { id: string }[] | undefined) ?? []).filter((c) => c.id !== id);
    return { raw: { ...raw, composites: [...composites, composite] }, notes: [] };
  });
  return { composite, edit };
}

/**
 * Freezes a set piece: saves the doodads it expands to into the Blueprint as ordinary doodad
 * anchors (exact positions, yaw and variation), and removes the set-piece placement.
 */
export async function freezeMissionSetPiece(workspace: Workspace, blueprintPath: string, setPieceId: string): Promise<{ readonly frozen: number; readonly edit: EditResult }> {
  let frozen = 0;
  const mission = await missionWorkspace(workspace, blueprintPath);
  const edit = await editMissionBlueprint(workspace, blueprintPath, (raw) => {
    // Parsed and expanded against the Workspace's own Plugins, and the Mission's catalog (missionWorkspace).
    const result = freezeSetPiece(raw, setPieceId, mission);
    frozen = result.frozen;
    return { raw: result.blueprint, notes: [] };
  });
  return { frozen, edit };
}
