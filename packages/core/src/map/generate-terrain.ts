// Writes a Mission's terrain alone as a Map Package, with no objects, regions or triggers: what the
// `generate-terrain` CLI and the MCP server's `generate_terrain` tool both run.

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { parseMissionBlueprint, type Workspace } from "../plugins/workspace.js";
import { writeMapPackage } from "./write-map-package.js";

export async function generateTerrain(
  workspace: Workspace,
  blueprintPath: string,
  outputDir: string,
): Promise<{ readonly blueprint: MissionBlueprint; readonly warnings: readonly string[] }> {
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const { warnings } = await writeMapPackage({ blueprint, outputDir, includeObjects: false, includeRegions: false });
  return { blueprint, warnings };
}
