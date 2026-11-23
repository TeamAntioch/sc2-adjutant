// Compiles a Melee Map Blueprint into a Map Package the Editor calls Melee (#213), as the MCP
// server's compile_melee_map tool does, and prints its distance report (#216). A melee map needs
// no Workspace: any folder will do. A broken melee rule exits 1, naming the rule and the object.

import { compileMeleeMap } from "../map/compile-melee-map.js";
import { formatMeleeReport } from "../map/melee-checks.js";
import { MeleeRuleError } from "../map/melee-rules.js";

async function main(): Promise<void> {
  const blueprintPath = process.argv[2];
  const outputDir = process.argv[3];

  if (!blueprintPath || !outputDir) {
    console.error("Usage: compile-melee-map <melee-blueprint.json> <output-dir>");
    process.exit(1);
  }

  const { blueprint, warnings, report } = await compileMeleeMap(blueprintPath, outputDir);
  console.log(`Melee map ${blueprint.title} compiled in ${outputDir}`);
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
  console.log(`\n${formatMeleeReport(report)}`);
}

main().catch((error) => {
  // A broken melee rule names itself; anything else keeps its stack.
  console.error(error instanceof MeleeRuleError ? error.message : error);
  process.exit(1);
});
