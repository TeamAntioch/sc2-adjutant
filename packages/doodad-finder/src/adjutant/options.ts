// The options sc2-adjutant's Finder passes the public start function (#678), for a Workspace or
// none: its sources (the Campaign Mod's doodads and notes), its Missions as the badges' choice,
// its Doodad Searches as the tray's objects, look closer as a tray action, a tick log per Mission, a settings file per Workspace, and the
// Workspace at /status for open_doodad_finder. The CLI beside it (cli.ts) starts the Finder with them.

import path from "node:path";

import { researchArchiveDirIfSet } from "@team-antioch/sc2-adjutant/dist/capture/research-archive.js";
import { missionDependencies } from "@team-antioch/sc2-adjutant/dist/catalog/workspace-doodad-search.js";
import { missionIds } from "@team-antioch/sc2-adjutant/dist/plugins/workspace.js";

import { catalogCacheDir } from "@team-antioch/sc2-asset-catalog/catalog/catalog-dirs.js";
import type { StartFinderOptions } from "@team-antioch/sc2-doodad-finder";

import { type Copy, systemClipboard } from "../clipboard.ts";
import { doodadSearches, type SearchPlaces, tickLogFor } from "./doodad-searches.ts";
import { lookCloser } from "./look-closer.ts";
import { finderSources } from "./sources.ts";

/** The settings, a file per Workspace (or none), in the cache folder. */
const settingsFile = (cacheDir: string, workspaceRoot: string | undefined) =>
  path.join(cacheDir, `finder-settings-${workspaceRoot ? path.basename(workspaceRoot).replace(/[^A-Za-z0-9.-]+/g, "_") : "none"}.json`);

/** The start function's options for a Workspace, or none: what this CLI adds to the public defaults. */
export async function adjutantOptions(
  workspaceRoot: string | undefined,
  { researchDir = researchArchiveDirIfSet(), copy = systemClipboard(), cacheDir = catalogCacheDir() }: { readonly researchDir?: string | undefined; readonly copy?: Copy | undefined; readonly cacheDir?: string } = {},
): Promise<StartFinderOptions> {
  const sources = await finderSources(workspaceRoot);
  const { workspace } = sources;
  const at: SearchPlaces = { researchDir, missionsDir: workspace?.missionsDir, cacheDir };
  return {
    sources,
    ...(workspace
      ? { badges: { label: "Mission", choices: await missionIds(workspace), provided: "in this Mission", dependenciesOf: (mission: string) => missionDependencies(workspace, mission) } }
      : {}),
    objects: doodadSearches(at),
    trayActions: [lookCloser({ copy })],
    tickLog: tickLogFor(at),
    settingsFile: settingsFile(cacheDir, workspaceRoot),
    status: { workspace: workspaceRoot ?? null },
  };
}
