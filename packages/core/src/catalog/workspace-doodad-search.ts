// search_doodads over a Workspace (doodad-search.ts): core's catalogs with the Workspace's Campaign
// Mod's doodads (described by its doodad index) and its doodad notes (doodad-notes.ts), and for a
// Mission, the dependencies its Blueprint declares, so the doodads it already has sort first. The
// MCP tool and the CLI call it.

import { DEFAULT_DEPENDENCIES } from "../map/write-document-info-xml.js";
import { missionBlueprintPath, readRawBlueprint, type Workspace } from "../plugins/workspace.js";
import type { Catalog } from "./catalog-layer.js";
import { type DoodadNote, readDoodadNotes } from "@team-antioch/sc2-asset-catalog/catalog/doodad-notes.js";
import { type DoodadSearch, type DoodadSearchQuery, type DoodadSearchResult, type DoodadSearchSources, searchDoodads, type StockDoodadSources } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";
import { coreDoodadSources } from "./stock-catalog.js";
import { formatUse } from "@team-antioch/sc2-asset-catalog/catalog/doodad-uses.js";
import { modSearchDoodads } from "./mod-doodad-index.js";

export type WorkspaceDoodadQuery = Omit<DoodadSearchQuery, "dependencies"> & {
  /** The Mission to sort for, by folder name: its dependencies' doodads first. */
  readonly mission?: string | undefined;
};

/** A Mission's map dependencies as the compile reads them: its Blueprint's own, else the default Void (Mod). */
export async function missionDependencies(workspace: Workspace, mission: string): Promise<readonly string[]> {
  const raw = await readRawBlueprint(await missionBlueprintPath(workspace, mission));
  return Array.isArray(raw.dependencies) ? raw.dependencies.filter((dependency): dependency is string => typeof dependency === "string") : DEFAULT_DEPENDENCIES;
}

/** The stock catalogs with a Workspace Catalog's Campaign Mod doodads laid over them (modSearchDoodads) and, when given, the Workspace's doodad notes. */
export function withCampaignMod(stock: StockDoodadSources, catalog: Catalog, notes?: Readonly<Record<string, DoodadNote>>): DoodadSearchSources {
  return { ...stock, modDoodads: modSearchDoodads(catalog, stock), ...(notes ? { notes } : {}) };
}

/** Searches the game's doodads and terrain objects and the Workspace's Campaign Mod's doodads, with its Doodad Uses merged in. */
export async function searchWorkspaceDoodads(workspace: Workspace, query: WorkspaceDoodadQuery): Promise<DoodadSearch> {
  const { mission, ...rest } = query;
  const dependencies = mission !== undefined ? await missionDependencies(workspace, mission) : undefined;
  const notes = await readDoodadNotes(workspace.root);
  return searchDoodads({ ...rest, ...(dependencies ? { dependencies } : {}) }, withCampaignMod(coreDoodadSources(), workspace.catalog, notes));
}

const SOURCE_LABEL: Record<DoodadSearchResult["source"], string> = { doodad: "doodad", "terrain-object": "terrain object", mod: "Campaign Mod doodad" };

/** One line per result, for the tool's text and the CLI. */
const PLACEMENT_WORDS = { "wall-foot": "stands at a wall's foot", "wall-face": "hangs on a wall's face", "wall-top": "stands on a wall's top", free: "stands free" } as const;
const facingWords = (facing: NonNullable<DoodadSearchResult["facing"]>): string =>
  [
    facing.source === "sheet" ? `read from its sheet${!facing.sure ? ", doubtful, so it turns nothing" : facing.diagonal ? ", a diagonal, so it turns nothing" : ""}${facing.placement || facing.standOff !== undefined ? "; suggested:" : ""}` : undefined,
    facing.placement ? PLACEMENT_WORDS[facing.placement] : undefined,
    facing.standOff !== undefined ? `${facing.standOff} cells out from the wall's edge` : undefined,
    facing.height !== undefined ? `${facing.height} up` : undefined,
    facing.runsAlong ? "runs along the wall" : undefined,
  ]
    .filter(Boolean)
    .join(", ")
    .replace(":,", ":");

export function formatDoodadSearch({ results, total }: { readonly results: readonly Omit<DoodadSearchResult, "score">[]; readonly total: number }): string {
  if (results.length === 0) return "No doodad matches.";
  const lines = results.map((result) => {
    const needs = result.dependency ? `needs ${result.dependency}${result.provided === undefined ? "" : result.provided ? " (the Mission has it)" : " (the Mission lacks it)"}` : "needs no dependency";
    const facts = [SOURCE_LABEL[result.source], result.package, needs, `${result.variations} variation${result.variations === 1 ? "" : "s"}`].filter(Boolean).join(", ");
    const { description } = result;
    const tags = description ? [description.kind, description.size, description.role ?? description.use, ...(description.story ?? []), ...(description.biome ?? [])].filter(Boolean).join("/") : "";
    const buildable = result.hasRenders ? "; renders here, so a sheet can be built" : "";
    const picture =
      result.picture.kind === "sheet"
        ? `sheet ${result.picture.path}`
        : result.picture.kind === "image"
          ? `gallery picture ${result.picture.url} (one angle)${buildable}`
          : result.unpictured !== undefined
            ? `unpictured: ${result.unpictured}`
            : result.source === "mod"
              ? "no sheet here yet: index-mod-doodads builds it"
              : `unpictured${buildable}`;
    return [
      `${result.id} "${result.name}" (${facts})`,
      `  ${description ? `${description.look}${tags ? ` [${tags}]` : ""}` : "no description"}`,
      ...(result.uses.length ? [`  uses: ${result.uses.map(formatUse).join("; ")}`] : []),
      ...(result.facing ? [`  faces ${result.facing.front}° at rotation 0; ${facingWords(result.facing)}`] : []),
      ...(result.pending ? ["  pending in the mod's doodad index: run index-mod-doodads, then describe it"] : []),
      `  ${picture}`,
    ].join("\n");
  });
  return [...lines, ...(total > results.length ? [`${total} matches, the first ${results.length} shown`] : [])].join("\n");
}
