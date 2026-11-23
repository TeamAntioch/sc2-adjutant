// find_sets (#726, #802): the Set Finder's narrowing and Jev ranking, as an MCP tool. Like
// find_doodads (find-doodads.ts), the Finder lives in its own package, an optional dependency of
// core, @team-antioch/sc2-adjutant-set-finder (packages/set-finder, a wrapper over the published
// @team-antioch/sc2-set-finder), found by its name and loaded with a dynamic import of its built
// entry; where the package isn't installed, the tool isn't served.

import { finderEntry, loadFinderEntry } from "./find-doodads.js";

/** The Set Finder wrapper's npm name. */
export const SET_FINDER_PACKAGE = "@team-antioch/sc2-adjutant-set-finder";

/** The package's built entry, or undefined where it isn't installed. */
export const SET_FINDER_ENTRY = finderEntry(SET_FINDER_PACKAGE, "set-finder", "dist/find-sets.js");

export type FindSetsRequest = {
  /** The Workspace whose own sets (its cinematic-sets folder) are laid over the published ones. */
  readonly workspaceRoot?: string | undefined;
  /** The place wanted, in plain words. */
  readonly ask: string;
  readonly count: number;
  /** False gives the narrowing alone, with no call to the ranker. */
  readonly rank: boolean;
};

/** A cinematic set as find_sets gives it. */
export type FoundSet = {
  /** The set's id in the set catalogue, as import_set takes it. */
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  /** What the place is, written from its pictures. */
  readonly look: string;
  readonly facets: readonly string[];
  readonly standsInFor: readonly string[];
  /** Where one set holds more than one place: a line a place, naming the model pattern that picks it out. */
  readonly rooms?: readonly string[] | undefined;
  /** How sure the look's writer was: high, medium or low. */
  readonly confidence: string;
  /** Where its files come from. */
  readonly source: string;
  /** Cells: x, y and height. */
  readonly size: readonly [number, number, number];
  readonly cameras: number;
  /** Its chosen pictures, the whole place first, as files to read (a published set's gallery address where this machine hasn't drawn it); `inGame` the same view filmed in game, where there is one. */
  readonly pictures: readonly { readonly path: string; readonly shows: string; readonly inGame?: string }[];
  /** Jev's grade from 0 to 3, when the ask was ranked. */
  readonly level?: number | undefined;
};

export type FoundSets = {
  readonly results: readonly FoundSet[];
  readonly ranker?: "jev" | undefined;
  /** Why there was no ranking: rank false, no credential, the spend cap, or the call failed. */
  readonly rankerOff?: string | undefined;
  /** How many sets the narrowing gave the ranker. */
  readonly narrowed: number;
  /** Milliseconds: the narrowing, the ranking (0 without one) and the whole call, warm-up included. */
  readonly timings: { readonly narrow: number; readonly rank: number; readonly total: number };
  /** US dollars, estimated: this call's, and every call's since the server started. */
  readonly cost: number;
  readonly spend: number;
};

/** What the set-finder package's entry gives core. */
export type SetFinderTool = {
  /** `signal` is the MCP request's: a cancelled call stops its ranker call. */
  find(request: FindSetsRequest, options?: { readonly signal?: AbortSignal }): Promise<FoundSets>;
};

/** The Set Finder's find_sets, with the real model, cards and Jev, when its package is installed; else undefined. */
export const loadSetFinder = (entry: URL | undefined = SET_FINDER_ENTRY): Promise<SetFinderTool | undefined> => loadFinderEntry<SetFinderTool>(entry, "createFindSets", "find_sets", "the Set Finder");

const dollars = (value: number): string => `$${value.toFixed(4)}`;

/** The tool's text: what ordered the results, the counts, timings and spend, then a block per set with its level first. */
export function formatFoundSets(found: FoundSets): string {
  const { results, narrowed, timings, cost, spend } = found;
  const counts = `${results.length} of ${narrowed} narrowed`;
  const times = `narrowing ${Math.round(timings.narrow)} ms${found.ranker ? `, ranking ${Math.round(timings.rank)} ms` : ""}, ${Math.round(timings.total)} ms in all`;
  const head = found.ranker
    ? `Ranked by ${found.ranker}: ${counts}, estimated ${dollars(cost)} (${dollars(spend)} since the server started); ${times}.`
    : `The narrowing's order, unranked: ${found.rankerOff ?? "no ranker"}. ${counts}; ${times}.`;
  if (!results.length) return `${head}\nNo set matches.`;
  const blocks = results.map((set) => {
    const [x, y, z] = set.size.map(Math.round);
    return [
      `${set.level === undefined ? "" : `level ${Math.round(set.level * 100) / 100} `}${set.id}: ${set.name} (${set.kind}; ${set.source}; ${x} by ${y} cells, ${z} high; ${set.cameras} camera${set.cameras === 1 ? "" : "s"}${set.confidence === "high" ? "" : `; look written with ${set.confidence} confidence`})`,
      `  ${set.look}`,
      ...(set.standsInFor.length ? [`  Could stand in for: ${set.standsInFor.join("; ")}`] : []),
      ...(set.rooms?.length ? [`  Places in it: ${set.rooms.join(" ")}`] : []),
      ...set.pictures.map((picture) => `  picture: ${picture.path} (${picture.shows})${picture.inGame ? `; in game: ${picture.inGame}` : ""}`),
    ].join("\n");
  });
  return [head, ...blocks].join("\n");
}
