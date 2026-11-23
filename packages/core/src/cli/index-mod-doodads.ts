// Brings the Workspace's Campaign Mod doodad index (mods/<id>/doodad-catalog.json, ADR-0017) up to
// date: renders new and changed doodads through the machine's Host Adapter, builds their sheets and
// writes their entries, pending until an agent describes them (docs/reference/mod-doodad-index.md).
//
//   npm run index-mod-doodads -- [<workspace>] [--only <id>,<id>] [--force] [--jobs 4]
//
// The Workspace is the folder given, else the one at or above where the command was typed.

import path from "node:path";
import { parseArgs } from "node:util";

import { indexModDoodads } from "../catalog/index-mod-doodads.js";
import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { loadWorkspace, WORKSPACE_FILE, workspaceRootFor } from "../plugins/workspace.js";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { only: { type: "string" }, force: { type: "boolean", default: false }, jobs: { type: "string", default: "4" } },
  });
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const root = positionals[0] ? path.resolve(cwd, positionals[0]) : workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  if (!root) throw new Error(`Usage: index-mod-doodads [workspace folder] [--only <id>,…] [--force]: ${cwd} isn't in a Workspace (no ${WORKSPACE_FILE} in any folder above it)`);
  const workspace = await loadWorkspace(root);
  const host = await loadHost(await loadMachineConfig());
  const result = await indexModDoodads(workspace, host, {
    ...(values.only ? { ids: values.only.split(",").filter(Boolean) } : {}),
    force: values.force,
    workers: Number(values.jobs),
    log: (line) => console.log(line),
  });
  console.log(formatIndexResult(result, root));
}

function formatIndexResult(result: Awaited<ReturnType<typeof indexModDoodads>>, root: string): string {
  const lines = [`${path.relative(root, result.indexFile)}: ${result.rendered.length} rendered, ${result.unpictured.length} unpictured, ${result.failed.length} failed, ${result.dropped.length} dropped`];
  for (const { id, error } of result.failed) lines.push(`  failed ${id}: ${error} (tried again next run)`);
  if (result.dropped.length > 0) lines.push(`  dropped: ${result.dropped.join(", ")}`);
  lines.push(result.pending.length > 0 ? `Pending, to describe: ${result.pending.join(", ")}` : "Every entry is described.");
  return lines.join("\n");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
