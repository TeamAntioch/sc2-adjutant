// sc2-adjutant's Doodad Searches as the Finder's objects (ADR-0020, #634, #678): the tray kept for
// one object at a time, named by its title or reopened while unfinished. Naming one gives the
// folder's slug, and the Finder's badges choice (its Mission) gives the folder:
// `missions/<id>/output/doodad-search/<slug>/` (git-ignored), or the research archive's
// `doodad-search/<slug>/` for no Mission, which needs SC2_RESEARCH_DIR. Each ask cards were ticked from is a Search Part, the
// ask its line until the author edits it, the ticked ids its shortlist (best first, with Jev's
// level). search.json is written on every change, as core reads it (doodad-search-page.ts),
// keeping what the doodad-search skill has judged since. One with a shortlist left is unfinished.
//
// Also the tick log's place for each Mission: its git-ignored output, else the research archive, else
// the cache folder.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { DOODAD_SEARCH_FILE, type DoodadSearchFile, type DoodadSearchPart, parseDoodadSearch } from "@team-antioch/sc2-adjutant/dist/catalog/doodad-search-page.js";
import { BLUEPRINT_FILE } from "@team-antioch/sc2-adjutant/dist/plugins/workspace.js";

import type { ObjectTick, TrayObject, TrayObjects, UnfinishedObject } from "@team-antioch/sc2-doodad-finder/server.js";
import type { TagChoice } from "@team-antioch/sc2-doodad-finder/tags.js";
import { ARCHIVE_TICK_LOG, TICK_LOG } from "../test-cases.ts";

/** Where Doodad Searches go: each Mission's output, and the research archive for no Mission. */
export type SearchPlaces = {
  /** The Workspace's missions folder; none outside a Workspace. */
  readonly missionsDir?: string | undefined;
  /** The research archive ($SC2_RESEARCH_DIR); without it there are no Doodad Searches for no Mission. */
  readonly researchDir?: string | undefined;
  /** The cache folder, for the tick log of no Mission without a research archive. */
  readonly cacheDir: string;
};

/** The folder the tick log for no Mission is in: the research archive, else the cache folder. */
const noMissionLogDir = (places: SearchPlaces): string => places.researchDir ?? places.cacheDir;

export const slugOf = (title: string): string =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");

const searchesDir = (mission: string | undefined, places: SearchPlaces): string => {
  if (mission === undefined) {
    if (!places.researchDir) throw new Error("A Doodad Search for no Mission goes in the research archive, and SC2_RESEARCH_DIR isn't set: choose a Mission, or set SC2_RESEARCH_DIR to your archive's folder");
    return path.join(places.researchDir, "doodad-search");
  }
  if (!places.missionsDir || !existsSync(path.join(places.missionsDir, mission, BLUEPRINT_FILE))) throw new Error(`No Mission ${mission} in the Workspace's missions folder`);
  return path.join(places.missionsDir, mission, "output", "doodad-search");
};

/** A new Doodad Search's folder, slugged from its title, beside none another has. */
export function searchFolder(title: string, mission: string | undefined, places: SearchPlaces): string {
  const slug = slugOf(title);
  if (!slug) throw new Error("A Doodad Search's title needs a letter or a digit: its folder is named from it");
  const dir = searchesDir(mission, places);
  let folder = path.join(dir, slug);
  for (let n = 2; existsSync(folder); n++) folder = path.join(dir, `${slug}-${n}`);
  return folder;
}

/** The ask a reopened Search Part's ticks are filed under in the tray: its latest, else its name. */
const askOf = (part: DoodadSearchPart): string => part.asks?.at(-1)?.text ?? part.name;

/** Every ask a Search Part was made from: a tick from any of them is its. */
const asksOf = (part: DoodadSearchPart): string[] => (part.asks?.length ? part.asks.map(({ text }) => text) : [part.name]);

const shortlistOf = (ticks: readonly ObjectTick[]) =>
  ticks
    .map(({ id, level }, i) => ({ entry: { id, level: Math.min(3, Math.max(0, Math.round(level))), ranker: "jev" as const }, i }))
    .sort((a, b) => b.entry.level - a.entry.level || a.i - b.i)
    .map(({ entry }) => entry);

// The tags an ask last ran with: its latest tick's.
const askEntry = (text: string, ticks: readonly ObjectTick[]) => ({
  text,
  tags: ticks.at(-1)!.tags.map(({ facet, value, pinned }) => ({ facet, value, ...(pinned ? { pinned: true } : {}) })),
  ranker: "jev" as const,
});

/**
 * The Search Parts for an object's ticks and lines, over what search.json had: a part keeps what the
 * skill judged, its shortlist and line are the tray's, and a part with nothing ticked or judged goes.
 * Asks no part has become new parts, in the order first ticked.
 */
export function searchParts(before: readonly DoodadSearchPart[], ticks: readonly ObjectTick[], lines: Readonly<Record<string, string>>): DoodadSearchPart[] {
  const from = (ask: string) => ticks.filter((tick) => tick.ask === ask);
  const claimed = new Set<string>();
  const parts: DoodadSearchPart[] = [];
  for (const part of before) {
    const own = asksOf(part).filter((ask) => !claimed.has(ask));
    for (const ask of own) claimed.add(ask);
    const ticked = own.filter((ask) => from(ask).length);
    const mine = ticks.filter((tick) => ticked.includes(tick.ask));
    if (!mine.length && !part.candidates.length && !part.alsoConsidered.length) continue;
    const asks = ticked.length ? [...(part.asks ?? []).filter(({ text }) => !ticked.includes(text)), ...ticked.map((ask) => askEntry(ask, from(ask)))] : part.asks;
    const line = own.map((ask) => lines[ask]).find((edited) => edited !== undefined);
    parts.push({ ...part, readsAs: line ?? part.readsAs, shortlist: shortlistOf(mine), ...(asks ? { asks } : {}) });
  }
  for (const ask of new Set(ticks.map((tick) => tick.ask))) {
    if (claimed.has(ask)) continue;
    const mine = from(ask);
    parts.push({ name: ask, readsAs: lines[ask] ?? ask, queries: [], candidates: [], alsoConsidered: [], shortlist: shortlistOf(mine), asks: [askEntry(ask, mine)] });
  }
  return parts;
}

const readSearch = async (folder: string): Promise<DoodadSearchFile> => {
  const file = path.join(folder, DOODAD_SEARCH_FILE);
  return parseDoodadSearch(JSON.parse(await readFile(file, "utf8")), file);
};

const listed = async (folder: string): Promise<string[]> => readdir(folder).catch(() => []);

/** The folders Doodad Searches are in: the research archive's (when there is one), then each Mission's (a folder with a Blueprint). */
async function searchDirs(places: SearchPlaces): Promise<string[]> {
  const dirs = places.researchDir ? [path.join(places.researchDir, "doodad-search")] : [];
  const { missionsDir } = places;
  if (missionsDir) for (const mission of (await listed(missionsDir)).sort()) if (existsSync(path.join(missionsDir, mission, BLUEPRINT_FILE))) dirs.push(path.join(missionsDir, mission, "output", "doodad-search"));
  return dirs;
}

/** sc2-adjutant's Doodad Searches as the Finder's objects. */
export function doodadSearches(places: SearchPlaces): TrayObjects {
  // What each open search.json held, so what the skill judged is kept when the tray's part is written.
  const files = new Map<string, DoodadSearchFile>();

  const unfinished = async (): Promise<UnfinishedObject[]> => {
    const found: UnfinishedObject[] = [];
    for (const dir of await searchDirs(places)) {
      for (const slug of (await listed(dir)).sort()) {
        const folder = path.join(dir, slug);
        const search = await readSearch(folder).catch(() => undefined);
        const ticked = search?.parts.reduce((sum, part) => sum + (part.shortlist?.length ?? 0), 0) ?? 0;
        if (search && ticked) found.push({ key: folder, title: search.title, ...(search.mission !== undefined ? { choice: search.mission } : {}), ticked });
      }
    }
    return found;
  };

  return {
    label: "Object",
    placeholder: "Crushing press over a conveyor",
    async start(title, mission) {
      const folder = searchFolder(title, mission, places);
      files.set(folder, { title, ...(mission !== undefined ? { mission } : {}), parts: [] });
      return { key: folder, title, choice: mission, ticks: [], lines: {} };
    },
    unfinished,
    async reopen(key) {
      if (!(await unfinished()).some((known) => known.key === key)) throw new Error(`${key} is not an unfinished Doodad Search`);
      const file = await readSearch(key);
      files.set(key, file);
      const ticks: ObjectTick[] = [];
      const lines: Record<string, string> = {};
      const pinned = new Map<string, TagChoice>();
      for (const part of file.parts) {
        const ask = askOf(part);
        const tags = part.asks?.find(({ text }) => text === ask)?.tags ?? [];
        for (const tag of part.asks?.flatMap((entry) => entry.tags) ?? []) if (tag.pinned) pinned.set(`${tag.facet}\n${tag.value}`, { facet: tag.facet, value: tag.value });
        for (const { id, level } of part.shortlist ?? []) ticks.push({ id, ask, tags, level });
        if (part.readsAs !== ask) lines[ask] = part.readsAs;
      }
      return { key, title: file.title, choice: file.mission, ticks, lines, pinned: [...pinned.values()] };
    },
    async save({ key, ticks, lines }: TrayObject) {
      const opened = files.get(key);
      if (!opened) throw new Error(`${key} isn't an open Doodad Search`);
      // Read again, so what the skill wrote while it was open is kept.
      const before = (await readSearch(key).catch(() => undefined)) ?? opened;
      const next: DoodadSearchFile = { ...before, parts: searchParts(before.parts, ticks, lines) };
      const file = path.join(key, DOODAD_SEARCH_FILE);
      if (next.parts.length) {
        const checked = parseDoodadSearch(next, file);
        await mkdir(key, { recursive: true });
        await writeFile(file, `${JSON.stringify(checked, null, 2)}\n`);
      } else {
        await rm(file, { force: true });
      }
      files.set(key, next);
    },
  };
}

/** The tick log for a Mission: its git-ignored output, else the research archive's, else the cache folder's. */
export const tickLogFor =
  (places: SearchPlaces) =>
  (mission: string | undefined): string =>
    mission !== undefined && places.missionsDir ? path.join(places.missionsDir, mission, TICK_LOG) : path.join(noMissionLogDir(places), ARCHIVE_TICK_LOG);
