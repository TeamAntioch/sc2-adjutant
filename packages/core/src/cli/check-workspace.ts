// Checks a whole Workspace: loads it and its Plugins, and validates every Mission's Blueprint and
// Screenplay against them (src/plugins/check-workspace.ts). Prints each problem with its Mission
// and where it is, and exits 1 on any error; warnings and review items (a Cinematic past a
// cinematography norm) are printed but don't fail it.
//
//   npm run check-workspace -- [workspace folder] [--json]
//
// The folder is relative to where the command was typed; by default, the Workspace above it.

import path from "node:path";

import { checkWorkspace, formatWorkspaceCheck, isError } from "../plugins/check-workspace.js";
import { WORKSPACE_FILE, workspaceRootFor } from "../plugins/workspace.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const named = args.find((arg) => !arg.startsWith("--"));
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const root = named ? path.resolve(cwd, named) : workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  if (!root) {
    console.error(`Usage: check-workspace [workspace folder] [--json]: ${cwd} isn't in a Workspace (no ${WORKSPACE_FILE} in any folder above it)`);
    process.exitCode = 2;
    return;
  }
  const check = await checkWorkspace(root);
  console.log(json ? JSON.stringify(check, null, 2) : formatWorkspaceCheck(check));
  if (check.problems.some(isError)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
