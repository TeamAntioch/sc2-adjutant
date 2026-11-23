// find_doodads (ADR-0020, #665): the Doodad Finder's narrowing and Jev ranking for core's MCP server,
// which loads this file beside it with a dynamic import (core's src/mcp/find-doodads.ts) and serves
// the tool only when that works. It calls the same functions as the page's process: the cards and
// narrowing (finder.ts), Jev with the page's credential (credentials.ts) and the order (ranker.ts).
//
// The model, cards and vectors load on the first call and stay loaded for the server's life, with
// the same vector cache and watching as the page's process. The server follows the session's
// Workspace, so a call for another Workspace opens its cards and closes the last one's.

import { lookUpDoodads } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";
import { missionDependencies } from "@team-antioch/sc2-adjutant/dist/catalog/workspace-doodad-search.js";
import type { DoodadFinderTool, FindDoodadsRequest, FoundDoodad, FoundDoodads } from "@team-antioch/sc2-adjutant/dist/mcp/find-doodads.js";

import type { OpenedRanker } from "@team-antioch/sc2-doodad-finder/credentials.js";
import { type Embedder, localEmbedder } from "@team-antioch/sc2-doodad-finder/embedder.js";
import { type Finder, openFinder, vectorCacheFile } from "@team-antioch/sc2-doodad-finder/finder.js";
import type { Narrowed } from "@team-antioch/sc2-doodad-finder/narrow.js";
import { payloadLog, payloadLogFile } from "@team-antioch/sc2-doodad-finder/payload-log.js";
import { orderByFit } from "@team-antioch/sc2-doodad-finder/ranker.js";
import { finderSources, type WorkspaceSources } from "./adjutant/sources.ts";

export type FindDoodadsOptions = {
  /** The embeddings model; the local one by default. */
  readonly embedder?: () => Promise<Embedder>;
  /** Jev, with its credential; by default the page's, with each call's payload logged to the cache folder's ranker-payloads/mcp-*.jsonl. */
  readonly ranker?: () => Promise<OpenedRanker>;
  /** What a Workspace's cards are made from, and the files to watch. */
  readonly sources?: (workspaceRoot: string) => Promise<WorkspaceSources>;
  /** The vector cache for a model. */
  readonly cacheFile?: (model: string) => string;
};

export type FindDoodads = DoodadFinderTool & {
  /** Stops watching the cards' files. */
  close(): void;
};

/** Why a call asked for with rank false has no ranking. */
export const NOT_RANKED = "rank: false asked for the narrowing alone";
const NOTHING_TO_RANK = "the narrowing found nothing to rank";

type Opened = { readonly finder: Finder; readonly sources: WorkspaceSources };

/**
 * Jev with the page's credential, its payloads logged to one file per server run. The SDK loads on
 * the first ranked call, so it costs the server's start nothing.
 */
const openJev = async (): Promise<OpenedRanker> => {
  const { openRanker } = await import("@team-antioch/sc2-doodad-finder/credentials.js");
  return openRanker({ log: payloadLog(payloadLogFile("mcp-")) });
};

export function createFindDoodads(options: FindDoodadsOptions = {}): FindDoodads {
  const embedderOf = options.embedder ?? (() => localEmbedder());
  const rankerOf = options.ranker ?? openJev;
  const sourcesOf = options.sources ?? finderSources;
  const cacheFileOf = options.cacheFile ?? vectorCacheFile;

  let embedder: Promise<Embedder> | undefined;
  let opening: Promise<OpenedRanker> | undefined;
  let open: { readonly root: string; readonly opened: Promise<Opened> } | undefined;
  let spend = 0;

  const embedderNow = (): Promise<Embedder> => {
    const loading = (embedder ??= embedderOf());
    // A failed load (no network for the first download) is tried again on the next call.
    loading.catch(() => embedder === loading && (embedder = undefined));
    return loading;
  };

  const finderFor = (root: string): Promise<Opened> => {
    if (open?.root === root) return open.opened;
    const previous = open;
    const opened = (async (): Promise<Opened> => {
      const [model, sources] = await Promise.all([embedderNow(), sourcesOf(root)]);
      const finder = await openFinder({
        load: sources.load,
        embedder: model,
        cacheFile: cacheFileOf(model.model),
        watch: sources.watch,
        onError: (error) => console.error(`find_doodads: reading the cards again failed: ${(error as Error).message}`),
      });
      return { finder, sources };
    })();
    const current = { root, opened };
    open = current;
    opened.catch(() => open === current && (open = undefined));
    previous?.opened.then(({ finder }) => finder.close(), () => {});
    return opened;
  };

  return {
    async find({ workspaceRoot, ask, mission, tags, count, rank }: FindDoodadsRequest, { signal } = {}): Promise<FoundDoodads> {
      const started = performance.now();
      const { finder, sources } = await finderFor(workspaceRoot);
      let dependencies: readonly string[] | undefined;
      if (mission !== undefined) {
        if (!sources.workspace) throw new Error(`${workspaceRoot} isn't a Workspace, so it has no Mission ${mission}`);
        dependencies = await missionDependencies(sources.workspace, mission);
      }
      const narrowing = await finder.narrow(ask, { ...(tags ? { tags } : {}), dependencies });

      let ordered: readonly (Narrowed & { readonly level?: number })[] = narrowing.candidates;
      let ranked = false;
      let rankerOff: string | undefined;
      let cost = 0;
      let rankMs = 0;
      if (!rank) rankerOff = NOT_RANKED;
      else if (!narrowing.candidates.length) rankerOff = NOTHING_TO_RANK;
      else {
        const opened = await (opening ??= rankerOf());
        const jev = opened.ranker;
        if (!jev) {
          rankerOff = opened.off;
          // Looked for again on the next call, so a key set meanwhile needs no restart.
          opening = undefined;
        } else {
          try {
            const ranking = await jev.rank({ ask, tags, candidates: narrowing.candidates.map(({ card }) => card) }, signal ? { signal } : {});
            spend += ranking.cost;
            cost = ranking.cost;
            rankMs = ranking.timings.total;
            ordered = orderByFit(narrowing.candidates, ranking.grades);
            ranked = true;
          } catch (error) {
            rankerOff = (error as Error).message;
          }
        }
      }

      const top = ordered.slice(0, count);
      const looked = lookUpDoodads(
        top.map(({ id }) => id),
        finder.sources,
        dependencies,
      );
      const results = top.flatMap(({ id, level }): FoundDoodad[] => {
        const found = looked.get(id);
        if (!found) return [];
        const { score: _score, ...result } = found;
        return [level !== undefined ? { ...result, level } : result];
      });
      return {
        results,
        ...(ranked ? { ranker: "jev" as const } : { rankerOff }),
        narrowed: narrowing.candidates.length,
        timings: { narrow: narrowing.timings.total, rank: rankMs, total: performance.now() - started },
        cost,
        spend,
      };
    },
    close() {
      open?.opened.then(({ finder }) => finder.close(), () => {});
      open = undefined;
    },
  };
}
