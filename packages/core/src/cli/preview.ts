// Renders a blueprint's layout as an annotated SVG, by default next to the blueprint
// (missions/<id>/preview.svg, the mission's map of record).
//
//   npm run preview -- missions/<id>/blueprint.json [out.svg]

import { readMissionBlueprint } from "../plugins/workspace.js";
import { writePreview } from "../preview/write-preview.js";

async function main(): Promise<void> {
  const [blueprintPath, outPath] = process.argv.slice(2);
  if (!blueprintPath) {
    console.error("Usage: preview <blueprint.json> [out.svg]");
    process.exitCode = 2;
    return;
  }
  const { blueprint } = await readMissionBlueprint(blueprintPath);
  const { svgPath, unplaced } = await writePreview(blueprint, blueprintPath, outPath);
  console.log(`Preview written to ${svgPath}`);
  for (const message of unplaced) console.warn(`Not placed: ${message}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
