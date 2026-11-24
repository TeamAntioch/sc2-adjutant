// Builds a Map Study for each Exemplar Map of the active Style Pack (the Workspace config's
// `stylePack`, found above the current folder): study.json plus layer renders in the pack's folder
// for that map. Source maps are read from the folder the machine config's `exemplarMaps` names
// (SC2_ADJUTANT_EXEMPLAR_MAPS overrides it), else the Workspace config's. The study_exemplar tool
// runs the same code (src/study/study-exemplars.ts).
//
//   npm run study            # every exemplar
//   npm run study -- 3-11    # just these ids

import path from "node:path";

import { WORKSPACE_FILE, workspaceFor } from "../plugins/workspace.js";
import { studyExemplars } from "../study/study-exemplars.js";

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  const workspace = await workspaceFor(path.join(process.cwd(), WORKSPACE_FILE));
  await studyExemplars(workspace, { ...(ids.length ? { ids } : {}), onStudied: ({ id, studyDir, seconds }) => console.log(`${id}: ${studyDir} (${seconds.toFixed(1)}s)`) });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
