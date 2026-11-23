// Doodad Search's page from the command line (src/catalog/write-doodad-search-page.ts), as the
// build_doodad_search_page tool builds it: index.html from a search's search.json, in the Mission's
// output folder (missions/<id>/output/doodad-search/<slug>/) or, for no Mission, the research
// archive's ($SC2_RESEARCH_DIR/doodad-search/<slug>/; SC2_RESEARCH_DIR must be set). It reports the
// candidates whose renders are here but whose sheet isn't; --build-sheets builds those (ImageMagick).
// --sheets-for builds sheets by doodad id instead, with no search.json, as build_doodad_sheets does.
//
//   npm run doodad-search-page -- <slug> [--mission <id>] [--search <file.json>] [--build-sheets] [--json]
//   npm run doodad-search-page -- --folder <folder> [--search <file.json>] [--build-sheets] [--json]
//   npm run doodad-search-page -- --sheets-for <id,...> [--json]
//
// --search copies a search's JSON in as search.json first; without it the folder's is read. The
// Workspace is the one above where the command was typed; outside one there is no Mission.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildWorkspaceSheetsFor, formatDoodadSearchPage, formatSheetsFor, writeWorkspaceDoodadSearchPage } from "../catalog/write-doodad-search-page.js";
import { loadWorkspace, WORKSPACE_FILE, workspaceRootFor } from "../plugins/workspace.js";
import { DOODAD_SEARCH_PAGE_USAGE, parseDoodadSearchPageArgs } from "./doodad-search-page-args.js";

async function main(): Promise<void> {
  let args;
  try {
    args = parseDoodadSearchPageArgs(process.argv.slice(2));
  } catch (error) {
    return fail((error as Error).message);
  }
  if ("help" in args) {
    console.log(DOODAD_SEARCH_PAGE_USAGE);
    return;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const root = workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  const workspace = root ? await loadWorkspace(root) : undefined;
  if ("sheetsFor" in args) {
    const sheets = await buildWorkspaceSheetsFor(workspace, args.sheetsFor);
    console.log(args.json ? JSON.stringify(sheets, null, 2) : formatSheetsFor(sheets));
    return;
  }
  const { page, json } = args;
  const at = (file: string) => path.resolve(cwd, file);
  let search: unknown;
  if (page.searchFile !== undefined) {
    try {
      search = JSON.parse(await readFile(at(page.searchFile), "utf8"));
    } catch (error) {
      throw new Error(`Can't read the doodad search ${at(page.searchFile)}: ${(error as Error).message}`, { cause: error });
    }
  }
  const written = await writeWorkspaceDoodadSearchPage(workspace, {
    slug: page.slug,
    mission: page.mission,
    ...(page.folder !== undefined ? { folder: at(page.folder) } : {}),
    ...(search !== undefined ? { search } : {}),
    buildSheets: page.buildSheets,
  });
  console.log(json ? JSON.stringify(written, null, 2) : formatDoodadSearchPage(written));
}

function fail(message: string): void {
  console.error(`${message}\n${DOODAD_SEARCH_PAGE_USAGE}`);
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
