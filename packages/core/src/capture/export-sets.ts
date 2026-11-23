// The public sets (issue #796): the described cinematic sets whose every file is Blizzard's, for the
// public sc2-asset-catalog (their looks and the facts a card shows) and the sc2-mapping-reference
// site (their pictures). A set any other source's file holds stays private: its looks and pictures
// never leave this repo and the machine's cache. The catalog ships only what we wrote and measured
// (its ADR 0001): a set's look, its size and camera count, and its name and files as the keys that
// find it in the game; the marks and model names read from the files stay here.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import sharp from "sharp";

import { gameFile, type SetLook } from "../cutscene/set-looks.js";
import type { CinematicSet } from "../cutscene/set-catalog.js";
import type { RenderedSet } from "./set-views.js";

/** A public set as the catalog keeps it: its look, its pictures by file, and what its card shows. */
export type PublicSet = {
  readonly name: string;
  readonly kind: SetLook["kind"];
  readonly look: string;
  readonly facets: readonly string[];
  readonly standsInFor: readonly string[];
  readonly rooms?: readonly string[];
  /** Card pictures, the whole place first; `inGame` when the same view filmed in game is published beside it. */
  readonly pictures: readonly { readonly file: string; readonly shows: string; readonly inGame?: true }[];
  readonly basis: string;
  readonly confidence: SetLook["confidence"];
  readonly problems: readonly string[];
  /** Cells: x, y and height. */
  readonly size: readonly [number, number, number];
  readonly cameras: number;
  /** The Cutscene Editor files it was catalogued from, as paths in the game's data. */
  readonly files: readonly string[];
};

export type PublicSets = {
  readonly sets: Record<string, PublicSet>;
  /** The described sets left private, each with why. */
  readonly leftOut: { readonly id: string; readonly why: string }[];
};

/** The pictures every drawn set has, published beside its card pictures. */
export const STOCK_VIEWS = ["plan.jpg", "overview.jpg"] as const;

/**
 * A described set in the catalog's shape: its look, the card pictures its views folder has (each
 * `inGame` where its frame filmed in game is there too), and the facts its card shows, from its
 * drawing (`record`) and the files the set catalog found it in (`set`, none for a set it hasn't).
 * The public sets are published in it, and sc2-adjutant's Set Finder lays the private ones over
 * them in it.
 */
export function catalogLook(id: string, look: SetLook, record: RenderedSet, set: CinematicSet | undefined, has: (id: string, file: string) => boolean): PublicSet {
  const pictures = (look.pictures ?? [])
    .filter((picture) => has(id, picture.file))
    .map((picture) => ({ file: picture.file, shows: picture.shows, ...(picture.game && has(id, gameFile(picture.file)) ? { inGame: true as const } : {}) }));
  return {
    name: record.name,
    kind: look.kind,
    look: look.look,
    facets: look.facets,
    standsInFor: look.standsInFor,
    ...(look.rooms?.length ? { rooms: look.rooms } : {}),
    pictures,
    basis: look.basis,
    confidence: look.confidence,
    problems: look.problems,
    size: record.size.map((cells) => Math.round(cells * 10) / 10) as [number, number, number],
    cameras: record.cameras.length,
    files: set?.occurrences.map((occurrence) => occurrence.file) ?? [],
  };
}

/**
 * The sets that can go public: described, drawn, and catalogued only from Blizzard's files.
 * `has(id, file)` says whether a set's views folder holds a picture.
 */
export function publicSets(
  looks: Readonly<Record<string, SetLook>>,
  catalog: readonly CinematicSet[],
  records: ReadonlyMap<string, RenderedSet>,
  has: (id: string, file: string) => boolean,
): PublicSets {
  const byId = new Map(catalog.map((set) => [set.id, set]));
  const result: PublicSets = { sets: {}, leftOut: [] };
  for (const [id, look] of Object.entries(looks).sort(([a], [b]) => a.localeCompare(b))) {
    const set = byId.get(id);
    const record = records.get(id);
    const others = [...new Set(set?.occurrences.map((occurrence) => occurrence.origin) ?? [])].filter((origin) => origin !== "blizzard");
    const why = !set ? "not in the set catalog" : others.length ? `has files from ${others.join(", ")}` : !record ? "not drawn" : record.origins?.some((origin) => origin !== "blizzard") ? "drawn from files that aren't Blizzard's" : undefined;
    if (why) {
      result.leftOut.push({ id, why });
      continue;
    }
    result.sets[id] = catalogLook(id, look, record!, set!, has);
  }
  return result;
}

/** What the catalog's file says of itself. */
export const SET_LOOKS_ABOUT =
  "Cinematic sets from StarCraft II's campaign cutscenes, described in our own words: each look was written by an agent from pictures of the set (Blender renders of its pieces where the cutscene file puts them, and frames filmed in game), and its size in cells and camera count were measured from the file. Its name and files are the keys that find it in the game's data; nothing else here is extracted from the game. The pictures are in sc2-mapping-reference, under public/sets.";

/** The catalog's `data/set-looks.json`, as the export writes it. */
export type SetLooksFile = { readonly about: string; readonly sets: Readonly<Record<string, PublicSet>> };

/** How a published `set-looks.json` differs from core's public sets. */
export type SetLooksDrift = {
  /** A line a set that differs, or is published but not public in core (and the `about` text, if it differs). */
  readonly drift: string[];
  /** Public sets in core that the published file doesn't carry yet: the Set Finder lays these over the published ones until a release does. */
  readonly unreleased: string[];
};

/**
 * How a published `set-looks.json` differs from what the export would write from core's looks and
 * set catalog. Only the machine's cache knows a set's size, its cameras and what was drawn, so the
 * size and camera count are taken from the published file, and every picture a look names (and its
 * in-game frame, where it has one) counts as drawn. The name is the catalog's, which set-views
 * copies into each drawing's record; a drawing's own origins aren't known here, so only the
 * catalog's decide which sets are public.
 */
export function publishedDrift(looks: Readonly<Record<string, SetLook>>, catalog: readonly CinematicSet[], published: SetLooksFile): SetLooksDrift {
  const records = new Map<string, RenderedSet>();
  for (const set of catalog) {
    if (!looks[set.id]) continue;
    const card = published.sets[set.id];
    const cameras = Array.from({ length: card?.cameras ?? 0 }, (_, n) => `Camera ${n + 1}`);
    records.set(set.id, { id: set.id, name: set.name, size: card?.size ?? [0, 0, 0], cameras, missing: [], pieces: 0, files: set.occurrences.length, marks: [] });
  }
  const { sets } = publicSets(looks, catalog, records, () => true);
  const result: SetLooksDrift = { drift: published.about === SET_LOOKS_ABOUT ? [] : ["about: the file's description differs"], unreleased: [] };
  for (const id of [...new Set([...Object.keys(sets), ...Object.keys(published.sets)])].sort((a, b) => a.localeCompare(b))) {
    const ours = sets[id];
    const theirs = published.sets[id];
    if (!theirs) result.unreleased.push(id);
    else if (!ours) result.drift.push(`${id}: in the published file, not public in core`);
    else {
      const fields = [...new Set([...Object.keys(ours), ...Object.keys(theirs)])].filter((field) => !isDeepStrictEqual(ours[field as keyof PublicSet], theirs[field as keyof PublicSet]));
      if (fields.length) result.drift.push(`${id}: ${fields.join(", ")} differ`);
    }
  }
  return result;
}

/** The files a public set publishes, in its views folder and on the site alike. */
export function publishedFiles(set: PublicSet): string[] {
  return [...set.pictures.flatMap((picture) => [picture.file, ...(picture.inGame ? [gameFile(picture.file)] : [])]), ...STOCK_VIEWS];
}

/** A picture's thumbnail, beside it: `card/1.jpg` → `card/1_tn.jpg`, as the site's galleries name them. */
export const thumbnailFile = (file: string): string => file.replace(/\.jpg$/, "_tn.jpg");

export const PICTURE_SIZE = { width: 1280, height: 720 } as const;
export const THUMBNAIL_WIDTH = 320;
const QUALITY = 82;

export type WrittenPictures = { readonly written: string[]; readonly kept: string[]; readonly removed: string[]; readonly missing: string[] };

/**
 * Writes each public set's pictures, resized, with thumbnails, into `<outDir>/<id>/`, and takes away
 * what is there that the export no longer names (another set's folder, or a picture dropped). A file
 * whose bytes come out the same isn't written again.
 */
export async function writeSetPictures(sets: Readonly<Record<string, PublicSet>>, viewsDir: string, outDir: string): Promise<WrittenPictures> {
  const result: WrittenPictures = { written: [], kept: [], removed: [], missing: [] };
  const expected = new Set<string>();
  for (const [id, set] of Object.entries(sets)) {
    for (const file of publishedFiles(set)) {
      const source = path.join(viewsDir, id, file);
      if (!existsSync(source)) {
        result.missing.push(`${id}/${file}`);
        continue;
      }
      const picture = sharp(source).resize({ ...PICTURE_SIZE, fit: "inside", withoutEnlargement: true });
      const outputs: [string, Buffer][] = [
        [file, await picture.clone().jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer()],
        [thumbnailFile(file), await picture.clone().resize({ width: THUMBNAIL_WIDTH }).jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer()],
      ];
      for (const [name, bytes] of outputs) {
        const target = path.join(outDir, id, name);
        expected.add(path.join(id, name));
        if (existsSync(target) && (await readFile(target)).equals(bytes)) {
          result.kept.push(`${id}/${name}`);
          continue;
        }
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes);
        result.written.push(`${id}/${name}`);
      }
    }
  }
  for (const file of existsSync(outDir) ? await readdir(outDir, { recursive: true, withFileTypes: true }) : []) {
    if (!file.isFile()) continue;
    const relative = path.relative(outDir, path.join(file.parentPath, file.name));
    if (expected.has(relative)) continue;
    await rm(path.join(outDir, relative));
    result.removed.push(relative.split(path.sep).join("/"));
  }
  // Folders the removals emptied, deepest first.
  const folders = existsSync(outDir) ? (await readdir(outDir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => path.join(entry.parentPath, entry.name)) : [];
  for (const folder of folders.sort((a, b) => b.length - a.length)) if ((await readdir(folder)).length === 0) await rm(folder, { recursive: true });
  return result;
}
