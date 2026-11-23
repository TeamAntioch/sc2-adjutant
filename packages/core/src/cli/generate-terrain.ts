import { generateTerrain } from "../map/generate-terrain.js";
import { workspaceFor } from "../plugins/workspace.js";

async function main(): Promise<void> {
  const blueprintPath = process.argv[2];
  const outputDir = process.argv[3];

  if (!blueprintPath || !outputDir) {
    console.error("Usage: generate-terrain <blueprint.json> <output-dir>");
    process.exit(1);
  }

  const { warnings } = await generateTerrain(await workspaceFor(blueprintPath), blueprintPath, outputDir);

  console.log(`Terrain generated in ${outputDir}`);
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
