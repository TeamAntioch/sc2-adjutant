// Contributes the Workspace's game-doodad notes (doodad-notes.json) to the public sc2-asset-catalog,
// as the contribute_doodad_notes tool does (src/catalog/doodad-notes-contribute.ts): on a new branch
// off origin/main, in the sc2-asset-catalog checkout named or else a fresh clone, adds their Doodad
// Uses to its per-doodad files (packages/sc2-asset-catalog/data/doodad-uses/doodads/) and their looks
// to its descriptions, with a changeset, commits, pushes and opens a pull request on
// TeamAntioch/sc2-asset-catalog with gh. Campaign Mod doodads', terrain objects' and undescribed
// doodads' notes stay, as does any note naming one of the Workspace's Missions or its story. Without
// gh or GitHub access the checkout is left as it is. --dry-run says what it would contribute and changes nothing.
//
//   npm run contribute-doodad-notes -- [--checkout ../sc2-asset-catalog] [--dry-run] [--json] [--help]
//
// The Workspace is the one above where the command was typed; a relative --checkout is from there too.

import path from "node:path";

import { contributeWorkspaceDoodadNotes, formatDoodadNotesContribution } from "../catalog/workspace-doodad-notes.js";
import { loadWorkspace, WORKSPACE_FILE, workspaceRootFor } from "../plugins/workspace.js";
import { CONTRIBUTE_DOODAD_NOTES_USAGE, parseContributeDoodadNotesArgs } from "./doodad-notes-args.js";

async function main(): Promise<void> {
  let args;
  try {
    args = parseContributeDoodadNotesArgs(process.argv.slice(2));
  } catch (error) {
    return fail((error as Error).message);
  }
  if ("help" in args) {
    console.log(CONTRIBUTE_DOODAD_NOTES_USAGE);
    return;
  }
  const { checkout, dryRun, json } = args;
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const root = workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  if (!root) return fail(`${cwd} isn't in a Workspace`);
  const contribution = await contributeWorkspaceDoodadNotes(await loadWorkspace(root), { checkout: checkout === undefined ? undefined : path.resolve(cwd, checkout), dryRun });
  console.log(json ? JSON.stringify(contribution, null, 2) : formatDoodadNotesContribution(contribution, dryRun));
  if (contribution.notOpened) process.exitCode = 1;
}

function fail(message: string): void {
  console.error(`${message}\n${CONTRIBUTE_DOODAD_NOTES_USAGE}`);
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
