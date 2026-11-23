// The Doodad Finder's test cases (ADR-0020): the Search Parts of past Doodad Searches, read where
// they are at run time (the research archive's and each Mission's git-ignored output), and the
// author's ticks from the Finder's tick log. Nothing here is committed: rendered assets and
// Workspace content stay out of this repo.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { DOODAD_SEARCH_FILE, parseDoodadSearch } from "@team-antioch/sc2-adjutant/dist/catalog/doodad-search-page.js";

import type { Tag } from "@team-antioch/sc2-doodad-finder/narrow.js";

export { TICK_LOG_FILE } from "@team-antioch/sc2-doodad-finder/tray.js";

/** One ask and the doodads it should find. */
export type NarrowingCase = {
  /** Where it came from: a search.json's Search Part, or a tick log's line. */
  readonly from: string;
  readonly ask: string;
  /** The object the ask is a part of: its Doodad Search's title. */
  readonly object?: string;
  readonly tags?: readonly Tag[];
  /** The Mission it was for, whose dependencies the narrowing marks. */
  readonly mission?: string;
  /** The ids it should find, best first: a Search Part's judged candidates, or the cards ticked. */
  readonly targets: readonly string[];
};

/** The tick log's place in a Mission's folder, git-ignored: one JSON line per ask the author ticked cards from. */
export const TICK_LOG = "output/doodad-finder/ticks.jsonl";

/**
 * A tick log's line: the ask, its tags, the ids ticked from it so far, best first, and the object
 * and Mission it was for. The Finder appends one on every tick, so an ask's last line holds all its
 * ticks.
 */
export type TickLine = { readonly ask: string; readonly tags?: readonly Tag[]; readonly ticked: readonly string[]; readonly object?: string; readonly mission?: string };

const listed = async (folder: string): Promise<string[]> => readdir(folder).catch(() => []);

/** The search.json of every past Doodad Search: the research archive's (`<archive>/doodad-search/<slug>/`), when there is one, and each Mission's (`<mission>/output/doodad-search/<slug>/`). */
export async function pastSearchFiles(researchDir: string | undefined, missionsDir?: string): Promise<string[]> {
  const folders = researchDir ? [path.join(researchDir, "doodad-search")] : [];
  if (missionsDir) for (const mission of (await listed(missionsDir)).sort()) folders.push(path.join(missionsDir, mission, "output", "doodad-search"));
  const files: string[] = [];
  for (const folder of folders) for (const slug of (await listed(folder)).sort()) files.push(path.join(folder, slug, DOODAD_SEARCH_FILE));
  return files;
}

/** The tick log for no Mission, in the research archive, else in the cache folder. */
export const ARCHIVE_TICK_LOG = "doodad-finder/ticks.jsonl";

/** The tick log of every Mission that has one; with the folder of the log for no Mission, that log first. */
export async function tickLogFiles(missionsDir: string | undefined, noMissionDir?: string): Promise<string[]> {
  const missions = missionsDir ? (await listed(missionsDir)).sort().map((mission) => path.join(missionsDir, mission, TICK_LOG)) : [];
  return noMissionDir ? [path.join(noMissionDir, ARCHIVE_TICK_LOG), ...missions] : missions;
}

export type ReadCases = { readonly cases: NarrowingCase[]; readonly skipped: { readonly file: string; readonly reason: string }[] };

/**
 * Two cases per Search Part with judged candidates: its name, as the author would type an ask, and
 * its line (what it reads as), each to find its candidates. A file that isn't there is skipped
 * quietly, one that doesn't parse is skipped with its reason.
 */
export async function pastSearchCases(files: readonly string[]): Promise<ReadCases> {
  const cases: NarrowingCase[] = [];
  const skipped: ReadCases["skipped"] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    try {
      const search = parseDoodadSearch(JSON.parse(text), file);
      const slug = path.basename(path.dirname(file));
      for (const part of search.parts) {
        const targets = part.candidates.map((candidate) => candidate.id);
        if (!targets.length) continue;
        const mission = { object: search.title, ...(search.mission ? { mission: search.mission } : {}) };
        cases.push({ from: `${slug} / ${part.name} (name)`, ask: part.name, ...mission, targets });
        cases.push({ from: `${slug} / ${part.name} (line)`, ask: part.readsAs, ...mission, targets });
      }
    } catch (error) {
      skipped.push({ file, reason: (error as Error).message });
    }
  }
  return { cases, skipped };
}

/** A case per ask in each tick log, from the ask's last line: for the line's Mission, else the Mission whose log it is. */
export async function tickLogCases(files: readonly string[]): Promise<ReadCases> {
  const skipped: ReadCases["skipped"] = [];
  const latest = new Map<string, NarrowingCase>();
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => undefined);
    if (text === undefined) continue;
    const logMission = file.endsWith(path.join(TICK_LOG)) ? path.basename(path.resolve(file, "../../..")) : undefined;
    text.split("\n").forEach((line, i) => {
      if (!line.trim()) return;
      try {
        const tick = JSON.parse(line) as TickLine;
        if (typeof tick.ask !== "string" || !Array.isArray(tick.ticked)) throw new Error("needs an ask and the ids ticked");
        const mission = typeof tick.mission === "string" ? tick.mission : logMission;
        const object = typeof tick.object === "string" ? tick.object : undefined;
        // A later line for the ask replaces an earlier one, keeping its place.
        latest.set(JSON.stringify([file, object, tick.ask]), {
          from: `${mission ?? "no Mission"} tick log line ${i + 1}`,
          ask: tick.ask,
          ...(object ? { object } : {}),
          ...(tick.tags ? { tags: tick.tags } : {}),
          ...(mission ? { mission } : {}),
          targets: tick.ticked,
        });
      } catch (error) {
        skipped.push({ file: `${file}:${i + 1}`, reason: (error as Error).message });
      }
    });
  }
  return { cases: [...latest.values()].filter(({ targets }) => targets.length), skipped };
}

/** How many of some ids were found: a hit rate's numerator and denominator. */
export type Hits = { readonly found: number; readonly of: number };

export const hits = (ids: readonly string[], found: ReadonlySet<string>): Hits => ({ found: ids.filter((id) => found.has(id)).length, of: ids.length });

export const addHits = (a: Hits, b: Hits): Hits => ({ found: a.found + b.found, of: a.of + b.of });

export const formatHits = ({ found, of }: Hits): string => (of ? `${found}/${of} (${Math.round((100 * found) / of)}%)` : "none");

/** The p-th percentile (0-100) of some numbers, by nearest rank. */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

/** How many targets a ranked list has in its top n, out of as many of them as could be there. */
export const topHits = (ranked: readonly string[], targets: readonly string[], n: number): Hits => {
  const top = new Set(ranked.slice(0, n));
  return { found: targets.filter((id) => top.has(id)).length, of: Math.min(n, targets.length) };
};
