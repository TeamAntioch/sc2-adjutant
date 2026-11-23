#!/usr/bin/env node
// The `sc2-adjutant` command, core's bin, so `npx @team-antioch/sc2-adjutant init <folder>` runs
// it from npm with nothing installed. One subcommand so far:
//
//   sc2-adjutant init <folder> [--no-install]
//
// init makes a Workspace in the folder from the example Campaign (src/init/init-workspace.ts). The
// folder is relative to where the command was typed. --no-install leaves `npm install`, and the
// Plugins' skill copy that follows it, for later.

import path from "node:path";

import { formatInit, initWorkspace, InitRefusedError } from "../init/init-workspace.js";

const USAGE = "Usage: sc2-adjutant init <folder> [--no-install]";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "init") {
    console.error(command && command !== "--help" ? `Unknown command ${command}. ${USAGE}` : USAGE);
    process.exitCode = 2;
    return;
  }
  const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--no-install");
  const folders = args.filter((arg) => !arg.startsWith("--"));
  if (unknown.length || folders.length !== 1) {
    console.error(unknown.length ? `Unknown option ${unknown.join(", ")}. ${USAGE}` : USAGE);
    process.exitCode = 2;
    return;
  }
  const [folder] = folders as [string];
  const cwd = process.env.INIT_CWD ?? process.cwd();
  try {
    const result = await initWorkspace({ folder: path.resolve(cwd, folder), install: !args.includes("--no-install") });
    console.log(formatInit(result, folder).join("\n"));
  } catch (error) {
    if (!(error instanceof InitRefusedError)) throw error;
    console.error(`sc2-adjutant init: ${error.message}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
