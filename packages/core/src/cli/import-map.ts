// Imports a Map Package built outside the Workspace as a new Mission (ADR-0010): copies it to
// missions/<id>/<Name>.SC2Map, never writing to the source, and writes a minimal Blueprint and an
// empty compile record, so everything in it starts as Kept Content (src/map/import-map.ts).
//
//   npm run import-map -- <source.SC2Map> <missionId> [--title "<title>"] [--setting "<setting>"]
//
// Paths are relative to where the command was typed; the Workspace is the one above it.

import path from "node:path";
import { parseArgs } from "node:util";

import { importMap } from "../map/import-map.js";
import { loadWorkspace, WORKSPACE_FILE, workspaceRootFor } from "../plugins/workspace.js";

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { title: { type: "string" }, setting: { type: "string" } } });
  const [source, missionId] = positionals;
  const cwd = process.env.INIT_CWD ?? process.cwd();
  if (!source || !missionId) {
    console.error('Usage: import-map <source.SC2Map> <missionId> [--title "<title>"] [--setting "<setting>"]');
    process.exitCode = 2;
    return;
  }
  const root = workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  if (!root) {
    console.error(`${cwd} isn't in a Workspace (no ${WORKSPACE_FILE} in any folder above it)`);
    process.exitCode = 2;
    return;
  }
  const imported = await importMap(await loadWorkspace(root), path.resolve(cwd, source), missionId, {
    ...(values.title ? { title: values.title } : {}),
    ...(values.setting ? { setting: values.setting } : {}),
  });
  for (const note of imported.notes) console.log(note);
  console.log(`Wrote ${imported.blueprintPath} and its empty compile record`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
