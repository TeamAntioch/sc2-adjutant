// Where core's scripts find things: core's own package folder (its data/ and dist/), and the
// Workspace they work on. Needs `npm run build`.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { WORKSPACE_FILE, workspaceRootFor } from "../dist/plugins/workspace.js";

/** Core's package folder, which holds data/ and dist/. */
export const CORE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The root of the Workspace a script works on: the nearest folder with a Workspace config above
 * where the command was started (INIT_CWD under npm, else the current folder). Run from this
 * repo's root, that is this repo's own Workspace.
 */
export function workspaceRoot(cwd = process.env.INIT_CWD ?? process.cwd()) {
  const root = workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  if (!root) throw new Error(`${path.resolve(cwd)} isn't in a Workspace: no ${WORKSPACE_FILE} in any folder above it. Run the script from a Workspace.`);
  return root;
}
