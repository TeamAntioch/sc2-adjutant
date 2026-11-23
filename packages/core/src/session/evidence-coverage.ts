// What an evidence record covers (#748). A sign-off vouches for the files it was given over, so it
// records them, each with a fingerprint, and reports itself stale once one of them differs. The
// check is on read and changes nothing: a stale record is still the author's word, and the answer to
// "does it still stand?" is theirs. Only the record's own `covers` is compared, so a record from
// before this existed (no `covers`) is "unrecorded", never stale.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { fingerprint } from "../domain/compile-record.js";
import { missionMapPackage } from "../map/mission-package.js";

/** A covered file as a record stores it. */
export const CoveredFileSchema = z.object({ path: z.string().min(1), fingerprint: z.string().regex(/^[0-9a-f]{16}$/, "A fingerprint is 16 hex digits") }).strict();

/** One covered file: its path from the Mission's folder, with forward slashes, and its fingerprint. */
export type CoveredFile = { readonly path: string; readonly fingerprint: string };

/** What differs now from what a record covered, as paths from the Mission's folder. Empty arrays mean it still stands. */
export type Staleness = { readonly changed: readonly string[]; readonly missing: readonly string[]; readonly added: readonly string[] };

/** The first Stage whose sign-off covers the Map Package; Stages 1 and 2 are about the Blueprint alone. */
export const FIRST_PACKAGE_STAGE = 3;

/** A package folder that differs per machine without the author changing the map (community and placeholder files): left out of coverage. */
const NOT_COVERED_FOLDERS = new Set(["Assets"]);
/** Package files the Editor regenerates or rewrites on every save, with no edit (the minimap; the component list and document header, seen on an unchanged save 2026-11-21, docs/reference/editor-saves.md). */
const NOT_COVERED_FILES = new Set(["Minimap.tga", "ComponentList.SC2Components", "DocumentHeader"]);

const slashed = (relative: string): string => relative.split(path.sep).join("/");

async function filesUnder(dir: string, from: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!NOT_COVERED_FOLDERS.has(entry.name)) found.push(...(await filesUnder(full, from)));
    } else if (entry.isFile() && !NOT_COVERED_FILES.has(entry.name)) {
      found.push(slashed(path.relative(from, full)));
    }
  }
  return found;
}

/**
 * The files a sign-off of `stage` covers now: the Blueprint, and from Stage 3 on every file of the
 * Mission's Map Package except its `Assets` folder, its minimap and the two files the Editor rewrites on a save (its component list and document header). Sorted by path.
 */
export async function coverageOf(blueprintPath: string, stage: number): Promise<CoveredFile[]> {
  const missionDir = path.dirname(blueprintPath);
  const relative = [slashed(path.relative(missionDir, blueprintPath))];
  if (stage >= FIRST_PACKAGE_STAGE) {
    const pack = await missionMapPackage(blueprintPath);
    if (existsSync(pack)) relative.push(...(await filesUnder(pack, missionDir)));
  }
  relative.sort();
  return Promise.all(relative.map(async (file) => ({ path: file, fingerprint: fingerprint(await readFile(path.join(missionDir, file))) })));
}

/** How `covers`, as recorded, differs from the files now: what changed, what is gone, and what a covered folder gained. */
export async function stalenessOf(blueprintPath: string, stage: number, covers: readonly CoveredFile[]): Promise<Staleness> {
  const now = new Map((await coverageOf(blueprintPath, stage)).map((file) => [file.path, file.fingerprint]));
  const then = new Set(covers.map((file) => file.path));
  return {
    changed: covers.filter((file) => now.has(file.path) && now.get(file.path) !== file.fingerprint).map((file) => file.path),
    missing: covers.filter((file) => !now.has(file.path)).map((file) => file.path),
    added: [...now.keys()].filter((file) => !then.has(file)),
  };
}

export const isStale = ({ changed, missing, added }: Staleness): boolean => changed.length + missing.length + added.length > 0;

/**
 * Whether a capture's manifest (`shots.json`, `views.json`) still stands (#748). A capture shows
 * the Mission's map as it was, so it covers what a Stage 3 sign-off does: the Blueprint and the Map
 * Package. Undefined when the manifest records no `covers` (a capture from before, or one of a map
 * that is no Mission's) or can't be read: such a capture is never reported stale.
 */
export async function captureStaleness(blueprintPath: string, manifestPath: string): Promise<Staleness | undefined> {
  let covers: readonly CoveredFile[] | undefined;
  try {
    covers = z.object({ covers: z.array(CoveredFileSchema) }).safeParse(JSON.parse(await readFile(manifestPath, "utf8"))).data?.covers;
  } catch {
    return undefined;
  }
  return covers ? stalenessOf(blueprintPath, FIRST_PACKAGE_STAGE, covers) : undefined;
}

/** The Mission's `output/shots/<name>/` captures that are stale now, by folder name, with what differs. Reads only. */
export async function staleShotCaptures(blueprintPath: string): Promise<Array<{ name: string } & Staleness>> {
  const dir = path.join(path.dirname(blueprintPath), "output", "shots");
  if (!existsSync(dir)) return [];
  const stale: Array<{ name: string } & Staleness> = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const staleness = await captureStaleness(blueprintPath, path.join(dir, entry.name, "shots.json"));
    if (staleness && isStale(staleness)) stale.push({ name: entry.name, ...staleness });
  }
  return stale;
}
