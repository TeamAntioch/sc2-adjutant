// Brush edits on a Mission's Kept ground, in its own Map Package (ADR-0010,
// src/map/edit-kept-terrain.ts). The edit is a JSON object { area, brush }, as the
// edit_kept_terrain MCP tool takes them; a ramp brush (add-ramp, remove-ramp), a slot swap and
// emptying a slot ({ "op": "clear-slot", "slot" }) take no area. A slot swap only renders the
// cells its slot covers, and a block move ({ "op": "set-blocks", "set" }) the blocks it moves,
// until it's run again with --confirm.
// A pathing brush ({ "op": "block-pathing" } or { "op": "clear-pathing" }) paints whole cells.
//
//   npm run edit-terrain -- <blueprint.json> <edit.json> [--dry-run] [--leave-doodads] [--confirm] [--name <renders folder>]
//
// Paths are relative to where the command was typed; the Workspace is the one above the Blueprint.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { editKeptTerrain, type KeptTerrainEdit } from "../map/edit-kept-terrain.js";
import { loadWorkspace, workspaceRootFor } from "../plugins/workspace.js";

const USAGE = "Usage: edit-terrain <blueprint.json> <edit.json> [--dry-run] [--leave-doodads] [--confirm] [--name <renders folder>]";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = new Set<string>(args.filter((arg) => arg === "--dry-run" || arg === "--leave-doodads" || arg === "--confirm"));
  const nameAt = args.indexOf("--name");
  const name = nameAt >= 0 ? args[nameAt + 1] : undefined;
  const positional = args.filter((arg, index) => !arg.startsWith("--") && (nameAt < 0 || index !== nameAt + 1));
  const [blueprintArg, editArg] = positional;
  const cwd = process.env.INIT_CWD ?? process.cwd();
  if (!blueprintArg || !editArg || positional.length > 2 || (nameAt >= 0 && !name) || args.some((arg) => arg.startsWith("--") && !flags.has(arg) && arg !== "--name")) {
    console.error(USAGE);
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
  const edit = JSON.parse(await readFile(path.resolve(cwd, editArg), "utf8")) as KeptTerrainEdit;
  const host = await loadHost(await loadMachineConfig());
  const result = await editKeptTerrain(await loadWorkspace(root), blueprintPath, edit, {
    host,
    leaveDoodads: flags.has("--leave-doodads"),
    dryRun: flags.has("--dry-run"),
    confirm: flags.has("--confirm"),
    ...(name ? { name } : {}),
  });
  console.log(result.summary);
  for (const warning of result.warnings) console.log(`warning: ${warning}`);
  console.log(result.files.length ? `Wrote ${result.files.join(", ")} in ${result.mapPackage}` : result.removed?.length ? `Removed ${result.removed.join(", ")} from ${result.mapPackage}` : "Nothing written");
  if (result.renders) console.log(`Renders: ${path.dirname(result.renders.area)}`);
  if (result.legend) console.log(`Colours: ${Object.entries(result.legend).map(([texture, colour]) => `${texture} ${colour}`).join(", ")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
