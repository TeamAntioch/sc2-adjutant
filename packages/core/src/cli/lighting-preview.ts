// Compiles a lighting preview: a Blueprint's map with a trigger cycling candidate flare lights
// against its tileset's baseline.
//
//   npm run lighting-preview -- [blueprint.json] [output.SC2Map]
//
// By default, core's test-fields example (examples/test-fields/missions/lighting-preview), into
// the Blueprint's own output/ folder.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { belShirFlareLightXml, FLARE_LIGHT_CANDIDATES } from "../catalog/flare-lights.js";
import { writeMapPackage } from "../map/write-map-package.js";
import { readMissionBlueprint } from "../plugins/workspace.js";
import { buildLightingPreview } from "../triggers/build-lighting-preview.js";

const DEFAULT_BLUEPRINT = fileURLToPath(new URL("../../examples/test-fields/missions/lighting-preview/blueprint.json", import.meta.url));

async function main(): Promise<void> {
  const blueprintPath = process.argv[2] ?? DEFAULT_BLUEPRINT;
  const outputDir = process.argv[3] ?? path.join(path.dirname(blueprintPath), "output", "lighting-preview.SC2Map");

  const { blueprint } = await readMissionBlueprint(blueprintPath);
  const { warnings } = await writeMapPackage({
    blueprint,
    outputDir,
    includeObjects: true,
    includeRegions: true,
    triggers: buildLightingPreview(FLARE_LIGHT_CANDIDATES),
    gameData: { "LightData.xml": belShirFlareLightXml() },
  });
  console.log(`Lighting preview compiled in ${outputDir}`);
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
