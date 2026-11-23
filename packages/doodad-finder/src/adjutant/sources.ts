// What sc2-adjutant's Doodad Finder searches, read afresh on each change: core's committed stock
// catalog (src/catalog/stock-catalog.ts: the game's doodads, core's terrain objects and measured
// facings, and the Doodad Uses), not the public Finder's extraction in the cache, and in a
// Workspace, its Campaign Mod's doodads (with the mod's doodad index, ADR-0017) and its doodad
// notes. With the files to watch for each.

import path from "node:path";

import { DOODAD_NOTES_FILE, readDoodadNotes } from "@team-antioch/sc2-asset-catalog/catalog/doodad-notes.js";
import type { DoodadSearchSources } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";
import { CORE_DOODAD_SOURCE_FILES, readCoreDoodadSources } from "@team-antioch/sc2-adjutant/dist/catalog/stock-catalog.js";
import { MOD_DOODAD_INDEX_FILE } from "@team-antioch/sc2-adjutant/dist/catalog/mod-doodad-index.js";
import { withCampaignMod } from "@team-antioch/sc2-adjutant/dist/catalog/workspace-doodad-search.js";
import { loadWorkspace, type Workspace } from "@team-antioch/sc2-adjutant/dist/plugins/workspace.js";

import type { FinderSources } from "@team-antioch/sc2-doodad-finder/stock-sources.js";

export type WorkspaceSources = FinderSources & {
  /** The Workspace as it was first loaded, for its Missions; none outside one. */
  readonly workspace?: Workspace;
};

/** Core's sources alone, or a Workspace's with its mod and notes. */
export async function finderSources(workspaceRoot?: string): Promise<WorkspaceSources> {
  if (workspaceRoot === undefined) return { load: async () => readCoreDoodadSources(), watch: CORE_DOODAD_SOURCE_FILES };
  const workspace = await loadWorkspace(workspaceRoot);
  let first: Workspace | undefined = workspace;
  const load = async (): Promise<DoodadSearchSources> => {
    // The mod's catalog is read with the Workspace; read again only after the first load.
    const current = first ?? (await loadWorkspace(workspaceRoot));
    first = undefined;
    return withCampaignMod(readCoreDoodadSources(), current.catalog, await readDoodadNotes(workspaceRoot));
  };
  const modIndex = workspace.catalog.modDir !== undefined ? [path.join(workspace.catalog.modDir, MOD_DOODAD_INDEX_FILE)] : [];
  return { load, watch: [...CORE_DOODAD_SOURCE_FILES, path.join(workspaceRoot, DOODAD_NOTES_FILE), ...modIndex], workspace };
}
