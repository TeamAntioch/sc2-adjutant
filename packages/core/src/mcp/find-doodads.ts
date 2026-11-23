// find_doodads (ADR-0020, #665): the Doodad Finder's narrowing and Jev ranking, as an MCP tool. The
// Finder lives in its own package, @team-antioch/sc2-adjutant-doodad-finder (packages/doodad-finder),
// which depends on core; core imports nothing of it, and lists it as an optional dependency, so an
// npm install has it by default. The server finds the package by its name, as Node resolves it from
// core (in a checkout, the workspace's link to packages/doodad-finder), and loads it with a dynamic
// import of its entry, the package's built JavaScript in its dist/. The entry imports core from
// core's dist, the same files this server runs from. Where the package isn't installed (left out
// with --omit=optional), or isn't built, the tool isn't served.

import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { DoodadSearchResult } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";
import { formatDoodadSearch } from "../catalog/workspace-doodad-search.js";
import { packageBuild } from "../plugins/built-package.js";

/** The Doodad Finder wrapper's npm name. */
export const DOODAD_FINDER_PACKAGE = "@team-antioch/sc2-adjutant-doodad-finder";

/**
 * A finder package's file, `file` from its root: the package as Node resolves `name` from `from`
 * (core's own module by default). Where it doesn't resolve and core is a checkout's (not under
 * node_modules), the package's folder beside core's, `folder` in packages/, as a checkout without
 * its workspace links has it. Else undefined: the package isn't installed.
 */
export function finderEntry(name: string, folder: string, file: string, from: string | URL = import.meta.url): URL | undefined {
  try {
    const manifest = createRequire(from).resolve(`${name}/package.json`);
    return pathToFileURL(path.join(path.dirname(manifest), file));
  } catch {
    const self = fileURLToPath(from);
    const at = existsSync(self) ? realpathSync(self) : self;
    if (at.split(path.sep).includes("node_modules")) return undefined;
    // From core's src/mcp and dist/mcp alike, packages/ is three folders up.
    return new URL(`../../../${folder}/${file}`, pathToFileURL(at));
  }
}

/** The package's built entry, or undefined where it isn't installed. */
export const DOODAD_FINDER_ENTRY = finderEntry(DOODAD_FINDER_PACKAGE, "doodad-finder", "dist/find-doodads.js");

/** A facet tag, as the Doodad Finder takes them: a pinned tag filters, the rest only raise. */
export type FindDoodadsTag = { readonly facet: string; readonly value: string; readonly pinned?: boolean | undefined };

export type FindDoodadsRequest = {
  /** The Workspace this call serves. */
  readonly workspaceRoot: string;
  /** A Search Part's line. */
  readonly ask: string;
  /** The Mission to mark for: the doodads its dependencies provide are kept and come first among equals. */
  readonly mission?: string | undefined;
  readonly tags?: readonly FindDoodadsTag[] | undefined;
  readonly count: number;
  /** False gives the narrowing alone, with no call to the ranker. */
  readonly rank: boolean;
};

/** A result as search_doodads gives it, less the words matched, with the ranker's level when there was a ranking. */
export type FoundDoodad = Omit<DoodadSearchResult, "score"> & { readonly level?: number };

export type FoundDoodads = {
  readonly results: readonly FoundDoodad[];
  /** The ranker that ordered them; absent when they are in the narrowing's order. */
  readonly ranker?: "jev" | undefined;
  /** Why there was no ranking: rank false, no credential, or the call failed. */
  readonly rankerOff?: string | undefined;
  /** How many candidates the narrowing gave the ranker. */
  readonly narrowed: number;
  /** Milliseconds: the narrowing, the ranking (0 without one) and the whole call, warm-up included. */
  readonly timings: { readonly narrow: number; readonly rank: number; readonly total: number };
  /** US dollars, estimated: this call's, and every call's since the server started. */
  readonly cost: number;
  readonly spend: number;
};

/** What the doodad-finder package's entry gives core. */
export type DoodadFinderTool = {
  /** `signal` is the MCP request's: a cancelled call stops its ranker call. */
  find(request: FindDoodadsRequest, options?: { readonly signal?: AbortSignal }): Promise<FoundDoodads>;
};

/**
 * A tool's factory from one of a finder package's built entries (the doodad-finder's, the set-finder's), when the package is
 * installed; else undefined (no entry, or no package at it). A package that is there but not built, or built before its source last changed, is said on stderr. A package that is there but fails to load (its own imports not installed,
 * say) is said on stderr, which the MCP protocol leaves free. open_doodad_finder loads its own
 * entry with this too (open-doodad-finder.ts).
 */
export async function loadFinderEntry<Tool>(entry: URL | undefined, factory: string, tool: string, finder = "the Doodad Finder"): Promise<Tool | undefined> {
  if (!entry) return undefined;
  const file = fileURLToPath(entry);
  const folder = path.dirname(path.dirname(file));
  if (!existsSync(path.join(folder, "package.json"))) return undefined;
  const build = packageBuild(folder, file);
  if (!build.built) {
    console.error(`sc2-adjutant: ${finder} isn't built, so ${tool} is off: ${build.reason}`);
    return undefined;
  }
  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(entry.href)) as Record<string, unknown>;
  } catch (error) {
    console.error(`sc2-adjutant: ${finder} didn't load, so ${tool} is off: ${(error as Error).message}`);
    return undefined;
  }
  const make = loaded[factory];
  if (typeof make !== "function") {
    console.error(`sc2-adjutant: ${entry.pathname} has no ${factory}, so ${tool} is off`);
    return undefined;
  }
  return (make as () => Tool)();
}

/** The Doodad Finder's find_doodads, with the real model, cards and Jev, when its package is installed; else undefined. */
export const loadDoodadFinder = (entry: URL | undefined = DOODAD_FINDER_ENTRY): Promise<DoodadFinderTool | undefined> => loadFinderEntry<DoodadFinderTool>(entry, "createFindDoodads", "find_doodads");

const dollars = (value: number): string => `$${value.toFixed(4)}`;

/** The tool's text: what ordered the results, the counts, timings and spend, then a block per result with its level first. */
export function formatFoundDoodads(found: FoundDoodads): string {
  const { results, narrowed, timings, cost, spend } = found;
  const counts = `${results.length} of ${narrowed} narrowed`;
  const times = `narrowing ${Math.round(timings.narrow)} ms${found.ranker ? `, ranking ${Math.round(timings.rank)} ms` : ""}, ${Math.round(timings.total)} ms in all`;
  const head = found.ranker
    ? `Ranked by ${found.ranker}: ${counts}, estimated ${dollars(cost)} (${dollars(spend)} since the server started); ${times}.`
    : `The narrowing's order, unranked: ${found.rankerOff ?? "no ranker"}. ${counts}; ${times}.`;
  if (!results.length) return `${head}\nNo doodad matches.`;
  const blocks = results.map((result) => {
    const block = formatDoodadSearch({ results: [result], total: 1 });
    return result.level === undefined ? block : `level ${Math.round(result.level * 100) / 100} ${block}`;
  });
  return [head, ...blocks].join("\n");
}
