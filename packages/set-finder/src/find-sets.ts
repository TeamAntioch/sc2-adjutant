// find_sets (#726, #802): the Set Finder's narrowing and Jev ranking for core's MCP server, which
// loads this file beside it with a dynamic import (core's src/mcp/find-sets.ts) and serves the tool
// only when that works. It asks the published package's finder (openSetFinder) over the same cards
// as the page: the published sets with this machine's own laid over them (sets.ts), the Workspace's
// among them. The cards are made again when a call names another Workspace.
//
// Each set's pictures are files to read: a laid-over set's are in the views folder; a published
// set's are too where this machine drew the same picture (core's look names the file with
// the same caption, and its in-game frame), else they are the gallery's addresses.
//
// The model, cards and vectors load on the first call and stay loaded for the server's life.

import { existsSync } from "node:fs";
import path from "node:path";

import type { SetLook as OwnLook } from "@team-antioch/sc2-adjutant/dist/cutscene/set-looks.js";
import type { FindSetsRequest, FoundSets, SetFinderTool } from "@team-antioch/sc2-adjutant/dist/mcp/find-sets.js";

import { localEmbedder } from "@team-antioch/sc2-finder-kit/embedder.js";
import { payloadLog, payloadLogFile } from "@team-antioch/sc2-finder-kit/payload-log.js";
import { spendCap } from "@team-antioch/sc2-finder-kit/spend-cap.js";
import { openRanker, openSetFinder, type PictureAt, type SetFinder, setVectorCacheFile } from "@team-antioch/sc2-set-finder";

import { adjutantSetCards } from "./sets.ts";

export type FindSetsOptions = {
  /** The finder and the folder this machine's sets are drawn in, for a Workspace; by default the page's cards, with payloads logged to ranker-payloads/find-sets-*.jsonl. */
  readonly open?: (workspaceRoot: string | undefined) => Promise<Opened>;
};

/** The finder, the folder this machine's sets are drawn in (none without a cache folder), and the looks (core's and the Workspace's). */
type Opened = { finder: SetFinder; viewsDir: string | undefined; looks: Readonly<Record<string, OwnLook>> };

async function openForTool(workspaceRoot: string | undefined): Promise<Opened> {
  const { cards, viewsDir, looks } = await adjutantSetCards({ workspaceRoot });
  const embedder = await localEmbedder();
  const jev = openRanker({ log: payloadLog(payloadLogFile("find-sets-")) });
  const finder = await openSetFinder({ cards, embedder, cacheFile: setVectorCacheFile(embedder.model), ranker: jev.ranker, off: jev.off, cap: spendCap() });
  return { finder, viewsDir, looks };
}

/** A picture as a file to read: its own file, the same one drawn on this machine, else its address. */
const readable = (picture: PictureAt, local: string | undefined): string => picture.path ?? (local && existsSync(local) ? local : picture.url);
const gameFile = (file: string): string => file.replace(/\.jpg$/, "-game.jpg");

export function createFindSets(options: FindSetsOptions = {}): SetFinderTool {
  const openFinder = options.open ?? openForTool;
  let opening: { readonly root: string | undefined; readonly opened: Promise<Opened> } | undefined;
  let spend = 0;
  return {
    async find({ workspaceRoot, ask, count, rank }: FindSetsRequest, { signal } = {}): Promise<FoundSets> {
      const started = performance.now();
      if (!opening || opening.root !== workspaceRoot) {
        const current = { root: workspaceRoot, opened: openFinder(workspaceRoot) };
        opening = current;
        // A failed open (no network for the model's first download) is tried again on the next call.
        current.opened.catch(() => opening === current && (opening = undefined));
      }
      const { finder, viewsDir, looks } = await opening.opened;
      const found = await finder.find(ask, { rank, ...(signal ? { signal } : {}) });
      spend += found.cost;
      const results = found.sets.slice(0, count).map(({ card, level }) => {
        const { look } = card;
        // This machine's file for a published picture, when it is the same picture: a card picture
        // only where this machine's look names it with the caption the release gives (a look
        // re-chosen since names another view by that file), and its in-game frame only where that
        // look has one. The plan and overview are always the same views.
        const own = (file: string, shows: string, inGame: boolean): string | undefined => {
          if (!viewsDir) return undefined;
          if (file.startsWith("card/")) {
            const picture = looks[card.id]?.pictures?.find((candidate) => candidate.file === file);
            if (!picture || picture.shows !== shows || (inGame && !picture.game)) return undefined;
          }
          return path.join(viewsDir, card.id, inGame ? gameFile(file) : file);
        };
        return {
          id: card.id,
          name: card.name,
          kind: look.kind,
          look: look.look,
          facets: look.facets,
          standsInFor: look.standsInFor,
          ...(look.rooms?.length ? { rooms: look.rooms } : {}),
          confidence: look.confidence,
          source: card.source,
          size: look.size,
          cameras: look.cameras,
          // A set whose look names no pictures this machine has shows its plan and overview.
          pictures: (card.pictures.length ? card.pictures : card.views).map((picture) => ({
            path: readable(picture, own(picture.file, picture.shows, false)),
            shows: picture.shows,
            ...(picture.inGame ? { inGame: readable(picture.inGame, own(picture.file, picture.shows, true)) } : {}),
          })),
          ...(level !== undefined ? { level } : {}),
        };
      });
      return {
        results,
        ...(found.ranked ? { ranker: "jev" as const } : { rankerOff: found.notRanked }),
        narrowed: found.sets.length,
        timings: { narrow: found.timings.narrow, rank: found.timings.rank ?? 0, total: performance.now() - started },
        cost: found.cost,
        spend,
      };
    },
  };
}
