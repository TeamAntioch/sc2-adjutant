// Adds a Doodad Use, a corrected look, or both, as the add_doodad_note tool does
// (@team-antioch/sc2-asset-catalog's doodad notes): for a game doodad or a terrain object to the Workspace's doodad
// notes (doodad-notes.json), dropping the notes core already holds; for a Campaign Mod doodad to
// its entry in the mod's doodad index. A use's variation (the Editor's number, 01 or 1), scale and
// source go with it as its record's fields, not in its phrase.
//
//   npm run add-doodad-note -- <doodad id> [--use "press head over a conveyor" [--variation 1] [--scale 3] [--from "crushing-press search, 2026-11-09"]]
//     [--look "..."] [--json] [--help]
//
// The Workspace is the one above where the command was typed.

import path from "node:path";

import { addWorkspaceDoodadNote, formatAddedDoodadNote } from "../catalog/workspace-doodad-notes.js";
import { loadWorkspace, WORKSPACE_FILE, workspaceRootFor } from "../plugins/workspace.js";
import { ADD_DOODAD_NOTE_USAGE, parseAddDoodadNoteArgs } from "./doodad-notes-args.js";

async function main(): Promise<void> {
  let args;
  try {
    args = parseAddDoodadNoteArgs(process.argv.slice(2));
  } catch (error) {
    return fail((error as Error).message);
  }
  if ("help" in args) {
    console.log(ADD_DOODAD_NOTE_USAGE);
    return;
  }
  const { json, ...input } = args;
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const root = workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  if (!root) return fail(`${cwd} isn't in a Workspace`);
  const added = await addWorkspaceDoodadNote(await loadWorkspace(root), input);
  console.log(json ? JSON.stringify(added, null, 2) : formatAddedDoodadNote(added));
}

function fail(message: string): void {
  console.error(`${message}\n${ADD_DOODAD_NOTE_USAGE}`);
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
