// Builds a Map Study for each Exemplar Map of the active Style Pack (the Workspace config's
// `stylePack`, found above the current folder): study.json plus layer renders in the pack's folder
// for that map. Source maps are read from the folder the machine config's `exemplarMaps` names
// (SC2_ADJUTANT_EXEMPLAR_MAPS overrides it).
//
//   npm run study            # every exemplar
//   npm run study -- 3-11    # just these ids

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { writePng } from "../preview/write-png.js";
import { exemplarMapSources, WORKSPACE_FILE, workspaceFor } from "../plugins/workspace.js";
import { loadMapPackage } from "../study/load-map-package.js";
import { buildMapStudy } from "../study/map-study.js";

async function main(): Promise<void> {
  const only = new Set(process.argv.slice(2));
  const workspace = await workspaceFor(path.join(process.cwd(), WORKSPACE_FILE));
  const exemplars = await exemplarMapSources(workspace);
  const unknown = [...only].filter((id) => !exemplars.some((exemplar) => exemplar.id === id));
  if (unknown.length) throw new Error(`The Style Pack has no Exemplar Map ${unknown.join(", ")} (its Exemplar Maps: ${exemplars.map((exemplar) => exemplar.id).join(", ")})`);
  for (const exemplar of exemplars) {
    if (only.size > 0 && !only.has(exemplar.id)) continue;
    if (!existsSync(exemplar.source)) throw new Error(`Exemplar Map ${exemplar.id}: no source map at ${exemplar.source}`);
    const started = Date.now();
    const map = loadMapPackage(exemplar.source);
    const { study, images } = buildMapStudy(exemplar, map);
    await mkdir(exemplar.studyDir, { recursive: true });
    await writeFile(path.join(exemplar.studyDir, "study.json"), `${JSON.stringify(study, null, 2)}\n`);
    for (const [name, image] of Object.entries(images)) await writeFile(path.join(exemplar.studyDir, name), writePng(image));
    console.log(`${exemplar.id}: ${exemplar.studyDir} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
