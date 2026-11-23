// sc2-adjutant's Doodad Finder (ADR-0020, ADR-0022): the public Finder's start function with the
// author's options. With a Workspace, its Campaign Mod's doodads and notes join the stock catalog,
// its Missions are the badges' choice ("in this Mission"), each Mission's ticks go to its own tick
// log, and look closer hands the tray to the doodad-search skill as a Doodad Search. Without one,
// core's catalog alone, and Doodad Searches and ticks go to the research archive. The start
// function and the argument parsing are the published @team-antioch/sc2-doodad-finder's (#679).
//
//   npm run doodad-finder -- [--workspace <folder> | --no-workspace] [--port n] [--budget dollars] [--open]
//
// The Workspace is the one given, else the one above where the command was typed. Look closer
// copies its prompt with the system clipboard (clipboard.ts); without one the page shows it to copy.

import path from "node:path";
import { parseArgs } from "node:util";

import { WORKSPACE_FILE, workspaceRootFor } from "@team-antioch/sc2-adjutant/dist/plugins/workspace.js";

import { announce, FINDER_ARG_OPTIONS, finderArgs } from "@team-antioch/sc2-doodad-finder/cli/doodad-finder.js";
import { startFinder } from "@team-antioch/sc2-doodad-finder/start.js";
import { adjutantOptions } from "./options.ts";

const USAGE = "Usage: npm run doodad-finder -- [--workspace <folder> | --no-workspace] [--port n] [--budget dollars] [--open]";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { ...FINDER_ARG_OPTIONS, workspace: { type: "string" }, "no-workspace": { type: "boolean" } } });
  if (values.help) return void console.log(USAGE);
  const cwd = process.env.INIT_CWD ?? process.cwd();
  if (values["tick-log"] !== undefined) throw new Error(`--tick-log is the public Finder's: this one logs ticks to each Mission's output, and the research archive's for none\n${USAGE}`);
  const args = finderArgs(values, cwd, USAGE);
  const workspaceRoot = values["no-workspace"] ? undefined : values.workspace ? path.resolve(cwd, values.workspace) : workspaceRootFor(path.join(cwd, WORKSPACE_FILE));

  const started = performance.now();
  const running = await startFinder({ ...(await adjutantOptions(workspaceRoot)), port: args.port, ...(args.budget !== undefined ? { budget: args.budget } : {}), log: (line) => console.log(line) });
  console.log(workspaceRoot ? `Workspace ${workspaceRoot}` : "No Workspace: core's catalogs only; Doodad Searches go to the research archive");
  announce(running, args, started);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
