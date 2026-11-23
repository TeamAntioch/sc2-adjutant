// Doodad Search's narrowing step from the command line (@team-antioch/sc2-asset-catalog's search), as the
// search_doodads tool runs it: keywords and facets over the game's doodads, its terrain objects and
// the Workspace's Campaign Mod's doodads, with the Workspace's Doodad Uses (doodad-notes.json) merged
// in. Outside a Workspace it searches the game's alone. Reads only.
//
//   npm run search-doodads -- crusher press [--kind built] [--size medium] [--role prop,clutter] [--story industry,terran]
//     [--biome urban] [--package campaigns/void.sc2campaign] [--mission <id>] [--limit n] [--json] [--help]
//
// The Workspace is the one above where the command was typed. Errors go to stderr, so --json's
// stdout holds the search or nothing; run npm with -s (npm run -s search-doodads -- … --json) to
// keep npm's own lines out of it too.

import path from "node:path";

import { searchDoodads } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";
import { coreDoodadSources } from "../catalog/stock-catalog.js";
import { formatDoodadSearch, searchWorkspaceDoodads } from "../catalog/workspace-doodad-search.js";
import { loadWorkspace, WORKSPACE_FILE, workspaceRootFor } from "../plugins/workspace.js";
import { parseSearchDoodadsArgs, SEARCH_DOODADS_USAGE } from "./search-doodads-args.js";

async function main(): Promise<void> {
  let args;
  try {
    args = parseSearchDoodadsArgs(process.argv.slice(2));
  } catch (error) {
    return fail((error as Error).message);
  }
  if ("help" in args) {
    console.log(SEARCH_DOODADS_USAGE);
    return;
  }
  const { query, json } = args;
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const root = workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  const { mission, ...rest } = query;
  if (mission !== undefined && !root) return fail(`--mission needs a Workspace, and ${cwd} isn't in one`);
  const found = root ? await searchWorkspaceDoodads(await loadWorkspace(root), query) : searchDoodads(rest, coreDoodadSources());
  console.log(json ? JSON.stringify(found, null, 2) : formatDoodadSearch(found));
}

function fail(message: string): void {
  console.error(`${message}\n${SEARCH_DOODADS_USAGE}`);
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
