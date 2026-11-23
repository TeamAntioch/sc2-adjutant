// Runs the level-design checker over a blueprint's layout and prints what it finds
// (docs/adr/0003). Advisory: it exits 0 whatever it finds, unless the blueprint is invalid.
//
//   npm run check-layout -- missions/<id>/blueprint.json [--json]

import { checkMissionLayout, formatLayoutReport } from "../layout/check-mission.js";
import { workspaceFor } from "../plugins/workspace.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const blueprintPath = args.find((arg) => !arg.startsWith("--"));
  if (!blueprintPath) {
    console.error("Usage: check-layout <blueprint.json> [--json]");
    process.exitCode = 2;
    return;
  }
  const { blueprint, checks } = await checkMissionLayout(await workspaceFor(blueprintPath), blueprintPath);
  console.log(json ? JSON.stringify(checks, null, 2) : formatLayoutReport(blueprint.title, checks));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
