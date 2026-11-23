// Edits Kept objects and regions in a Mission's own Map Package (ADR-0010), changing only the
// elements the edits touch (src/map/edit-kept-objects.ts). The edits are a JSON array, as the
// edit_kept_objects MCP tool takes them.
//
//   npm run edit-kept -- <blueprint.json> <edits.json>
//
// Paths are relative to where the command was typed; the Workspace is the one above the Blueprint.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { editKeptObjects, type KeptEdit } from "../map/edit-kept-objects.js";
import { loadWorkspace, workspaceRootFor } from "../plugins/workspace.js";

async function main(): Promise<void> {
  const [blueprintArg, editsArg] = process.argv.slice(2);
  const cwd = process.env.INIT_CWD ?? process.cwd();
  if (!blueprintArg || !editsArg) {
    console.error("Usage: edit-kept <blueprint.json> <edits.json>");
    process.exitCode = 2;
    return;
  }
  const blueprintPath = path.resolve(cwd, blueprintArg);
  const root = workspaceRootFor(blueprintPath);
  if (!root) {
    console.error(`${blueprintPath} isn't in a Workspace`);
    process.exitCode = 2;
    return;
  }
  const edits: unknown = JSON.parse(await readFile(path.resolve(cwd, editsArg), "utf8"));
  if (!Array.isArray(edits)) throw new Error(`${editsArg} isn't a JSON array of edits`);
  const host = await loadHost(await loadMachineConfig());
  const result = await editKeptObjects(await loadWorkspace(root), blueprintPath, edits as KeptEdit[], { host });
  for (const line of result.changed) console.log(line);
  for (const warning of result.warnings) console.log(`warning: ${warning}`);
  console.log(result.files.length ? `Wrote ${result.files.join(" and ")} in ${result.mapPackage}` : "Nothing changed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
