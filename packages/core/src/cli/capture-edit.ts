// Looks at edited Kept ground in game (spec #247, src/capture/edit-capture.ts): a short camera tour
// of each area, one high view and two or three at the player's angle, through this machine's Host
// Adapter (editor.captureTour), on a capture copy in the machine config's cacheDir. The Mission's
// own Map Package is only read. Frames go to the research archive ($SC2_RESEARCH_DIR, which must be
// set) under missions/<id>/captures/<name>/, with views.json.
//
//   npm run capture-edit -- <blueprint.json> <edit.json>... [--name <capture folder>] [--lighting <id>]
//
// Each edit file is what edit-terrain took ({ area, brush }; a ramp shows its footprint, and a slot
// swap needs an area), a bare area, or a list of either: at the end of a batch, pass every edit of
// it and the game starts once. Paths are relative to where
// the command was typed. The macOS Host Adapter needs the Editor with its Test Document window mode
// set to Windowed, Accessibility and Screen Recording for the app running this, and the screen
// awake. It closes only capture copies, never the author's own maps.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { areasOf, captureKeptAreas, type CaptureTarget } from "../capture/edit-capture.js";
import { researchArchiveDir } from "../capture/research-archive.js";
import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { loadWorkspace, workspaceRootFor } from "../plugins/workspace.js";

const USAGE = "Usage: capture-edit <blueprint.json> <edit.json>... [--name <capture folder>] [--lighting <id>]";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { name: { type: "string" }, lighting: { type: "string" } } });
  const [blueprintArg, ...editArgs] = positionals;
  if (!blueprintArg || editArgs.length === 0) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const blueprintPath = path.resolve(cwd, blueprintArg);
  const root = workspaceRootFor(blueprintPath);
  if (!root) {
    console.error(`${blueprintPath} isn't in a Workspace`);
    process.exitCode = 2;
    return;
  }
  const areas: CaptureTarget[] = [];
  for (const arg of editArgs) {
    const file = path.resolve(cwd, arg);
    areas.push(...areasOf(arg, JSON.parse(await readFile(file, "utf8"))));
  }
  const host = await loadHost(await loadMachineConfig());
  // Full-size captures go to the research archive (its README), not a repo.
  const researchDir = researchArchiveDir();
  const log = (line: string) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${line}`);
  const result = await captureKeptAreas(await loadWorkspace(root), blueprintPath, areas, {
    host,
    researchDir,
    log,
    ...(values.name ? { name: values.name } : {}),
    ...(values.lighting ? { lighting: values.lighting } : {}),
  });
  for (const view of result.views) {
    const camera = `${view.distance} away, pitch ${view.pitch}${view.yawOffset ? `, turned ${view.yawOffset}°` : ""}`;
    console.log(`${view.frame}: (${view.target[0].toFixed(1)}, ${view.target[1].toFixed(1)}), ${camera}`);
  }
  console.log(result.summary);
  if (result.end !== "done" || result.missing.length > 0 || result.late.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
