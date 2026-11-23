// Tunes Kept triggers in a Mission's own Map Package (ADR-0010), changing each one's XML in
// Triggers and its Galaxy in MapScript.galaxy together (src/map/tune-kept-triggers.ts). The edits
// are a JSON array, as the tune_kept_triggers MCP tool takes them; given a trigger's name instead,
// it outlines that trigger's calls and parameters by element Id.
//
//   npm run tune-kept -- <blueprint.json> <edits.json>
//   npm run tune-kept -- <blueprint.json> "<trigger name>"
//
// Paths are relative to where the command was typed; the Workspace is the one above the Blueprint.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { outlineKeptTrigger, tuneKeptTriggers, type KeptTriggerEdit } from "../map/tune-kept-triggers.js";
import { loadWorkspace, workspaceRootFor } from "../plugins/workspace.js";

async function main(): Promise<void> {
  const [blueprintArg, second] = process.argv.slice(2);
  const cwd = process.env.INIT_CWD ?? process.cwd();
  if (!blueprintArg || !second) {
    console.error('Usage: tune-kept <blueprint.json> <edits.json>, or tune-kept <blueprint.json> "<trigger>" to outline it');
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
  const workspace = await loadWorkspace(root);
  const editsPath = path.resolve(cwd, second);
  if (second.endsWith(".json") && !existsSync(editsPath)) {
    console.error(`${editsPath}: file not found`);
    process.exitCode = 2;
    return;
  }
  if (!second.endsWith(".json")) {
    const { outline, tunable, reason } = await outlineKeptTrigger(workspace, blueprintPath, second);
    console.log(outline);
    if (reason) console.log(reason);
    // A trigger that can't be tuned fails, so a script can tell.
    if (!tunable) process.exitCode = 1;
    return;
  }
  const edits: unknown = JSON.parse(await readFile(editsPath, "utf8"));
  if (!Array.isArray(edits)) throw new Error(`${second} isn't a JSON array of edits`);
  const host = await loadHost(await loadMachineConfig());
  const result = await tuneKeptTriggers(workspace, blueprintPath, edits as KeptTriggerEdit[], { host });
  for (const line of result.changed) console.log(line);
  console.log(result.files.length ? `Wrote ${result.files.join(", ")} in ${result.mapPackage}` : "Nothing changed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
