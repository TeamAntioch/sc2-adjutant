// The MapScript drift test: compiles a Mission in place, has the Editor save a copy of its package
// through this machine's Host Adapter, and reports each section of MapScript.galaxy where the
// Editor's save differs from the spliced script (src/map/drift-test.ts). Exits 1 on any drift.
//
//   npm run drift-test -- <blueprint.json>
//
// Close the Mission in the Editor first. The copy is saved under the machine config's cacheDir.

import path from "node:path";

import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { runDriftTest } from "../map/drift-test.js";
import { loadWorkspace, workspaceRootFor } from "../plugins/workspace.js";
import { formatMapScriptDrift } from "../triggers/map-script-drift.js";

async function main(): Promise<void> {
  const [blueprint] = process.argv.slice(2);
  if (!blueprint) {
    console.error("Usage: drift-test <blueprint.json>");
    process.exitCode = 2;
    return;
  }
  const blueprintPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), blueprint);
  const root = workspaceRootFor(blueprintPath);
  if (!root) {
    console.error(`${blueprintPath} isn't in a Workspace`);
    process.exitCode = 2;
    return;
  }
  const host = await loadHost(await loadMachineConfig());
  const result = await runDriftTest(await loadWorkspace(root), blueprintPath, host);
  console.log(`Compiled ${result.mapPackage}; the Editor saved a copy at ${result.savedCopy}`);
  console.log(formatMapScriptDrift(result.drift));
  if (result.drift.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
