// A Campaign Mod's doodad index (ADR-0017): its doodads described and pictured as core's
// doodad catalog (doodad-catalog.ts) describes the game's, kept in the Workspace beside the mod's Blueprint
// as mods/<id>/doodad-catalog.json and read into the catalog layer. index-mod-doodads renders each
// doodad and writes its entry; an agent (or the author) writes its description from the sheet, in
// core's words. An entry without a description, or whose description no one has written for its
// current model (no `described`), is pending.
//
//   "HarbourFan": { "model": "Assets/Doodads(Custom)/Fan/HarbourFan.m3", "modelHash": "pkg:<size>:…",
//                   "sheet": "catalog-sheets/doodads/HarbourFan.jpg", "described": "agent",
//                   "description": { "look": "…", "kind": "built", "size": "medium", "role": "prop", … } }
//
// A sheet of a model read from one of the Workspace's own packages is the author's to commit
// (catalog-sheets/doodads/); a sheet of a game model is a rendered game asset, kept beside it in
// git-ignored catalog-sheets/game-models/, with the raw renders in git-ignored thumbnails/.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { formatIssues } from "../util/format-issues.js";
import { modelPathCandidates } from "@team-antioch/sc2-asset-catalog/catalog/doodad-thumbnails.js";
import type { Catalog } from "./catalog-layer.js";
import { type DoodadDescription } from "@team-antioch/sc2-asset-catalog/catalog/doodad-catalog.js";
import { getGameDoodadDescription, getDoodadModel } from "./stock-catalog.js";
import type { SearchableModDoodad, StockDoodadSources } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";
import { DoodadUseOrPhraseSchema } from "@team-antioch/sc2-asset-catalog/catalog/doodad-uses.js";
import { findPackageFile, type PackageFile } from "./package-files.js";

/** The index's file, beside the Campaign Mod's Blueprint. */
export const MOD_DOODAD_INDEX_FILE = "doodad-catalog.json";
/** Committed sheets, of models from the Workspace's own packages, under the mod's folder. */
export const MOD_SHEETS_DIR = "catalog-sheets/doodads";
/** Git-ignored sheets, of game models a mod doodad uses, under the mod's folder. */
export const GAME_MODEL_SHEETS_DIR = "catalog-sheets/game-models";
/** Git-ignored raw turntable renders, under the mod's folder. */
export const MOD_THUMBNAILS_DIR = "thumbnails";

/** A description in core's words (data/doodad-descriptions.json, DRESSING.md "Finding doodads"). */
export const DoodadDescriptionSchema = z
  .object({
    look: z.string().min(1),
    kind: z.enum(["natural", "built", "creature"]),
    size: z.enum(["tiny", "small", "medium", "large", "huge"]),
    role: z.enum(["cliff", "structure", "prop", "clutter", "foliage", "decal", "effect"]),
    story: z.array(z.string().min(1)),
    biome: z.array(z.string().min(1)),
    state: z.string().min(1).optional(),
    /** Doodad Uses (doodad-uses.ts): what it has been accepted as in a Doodad Search; a plain phrase reads as a record with only its `use`. */
    uses: z.array(DoodadUseOrPhraseSchema).optional(),
  })
  .strict();

export const ModDoodadEntrySchema = z
  .object({
    /** Its Editor name, when the mod's strings give one. */
    name: z.string().min(1).optional(),
    categories: z.string().min(1).optional(),
    /** Its model's storage path, resolved through its actor and CModel. */
    model: z.string().min(1).optional(),
    /** What its model was when the entry was written (modelHash): a package model's file of another size, or another game model, makes the entry stale (modelChanged). */
    modelHash: z.string().min(1).optional(),
    /** Its model's bounds, width, depth and height in game units (a cell is 1), from its MODL record: the description's `size` comes from them. */
    bounds: z.tuple([z.number(), z.number(), z.number()]).optional(),
    /** Its 2×2 turntable sheet, relative to the mod's folder. */
    sheet: z.string().min(1).optional(),
    /** Why it has no picture and won't get one: a model with nothing to draw. */
    unpictured: z.string().min(1).optional(),
    /** Why its last render failed; the next index-mod-doodads tries again. */
    renderError: z.string().min(1).optional(),
    description: DoodadDescriptionSchema.optional(),
    /** Who wrote the description: an agent, or the author (a rebuild never rewrites the author's); absent while it's pending. */
    described: z.enum(["agent", "author"]).optional(),
  })
  .strict();

export type ModDoodadEntry = z.infer<typeof ModDoodadEntrySchema>;
export type ModDoodadIndex = Readonly<Record<string, ModDoodadEntry>>;

export const ModDoodadIndexSchema = z.record(z.string().min(1), ModDoodadEntrySchema);

/** The index in `json`, refused naming `shown` and each issue's path when it doesn't validate. */
export function parseModDoodadIndex(json: string, shown: string): ModDoodadIndex {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`${shown} isn't JSON: ${(error as Error).message}`, { cause: error });
  }
  const parsed = ModDoodadIndexSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${shown} isn't a valid doodad index: ${formatIssues(parsed.error, "(index)")}`);
  return parsed.data;
}

/** An entry's fields in the order the schema lists them, whatever order they were set in. */
const ENTRY_FIELDS = Object.keys(ModDoodadEntrySchema.shape) as (keyof ModDoodadEntry)[];

/**
 * The index in a Campaign Mod's folder (mods/<id>), named so in its errors; empty when the mod has
 * none yet. Throws for a file that doesn't validate (parseModDoodadIndex).
 */
export async function readModDoodadIndex(modDir: string): Promise<ModDoodadIndex> {
  const file = path.join(modDir, MOD_DOODAD_INDEX_FILE);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return parseModDoodadIndex(text, `mods/${path.basename(modDir)}/${MOD_DOODAD_INDEX_FILE}`);
}

/** The index written as index-mod-doodads writes it: ids sorted, each entry's fields in the schema's order, two-space JSON. */
export function formatModDoodadIndex(index: ModDoodadIndex): string {
  const ordered = (entry: ModDoodadEntry) => Object.fromEntries(ENTRY_FIELDS.filter((field) => entry[field] !== undefined).map((field) => [field, entry[field]]));
  return `${JSON.stringify(Object.fromEntries(Object.keys(index).sort().map((id) => [id, ordered(index[id]!)])), null, 2)}\n`;
}

/** A storage path as core's data files write it: slashes. */
export const storagePath = (model: string): string => model.replace(/\\/g, "/");

/**
 * The package file a doodad's picture is drawn from: its first variation's, tried as the renderer
 * tries it (modelPathCandidates: `Fan.m3` or `Fan_00.m3`), from the packages; undefined for a game model.
 */
export function packageModelFile(packages: readonly string[], model: string, variations = 1): PackageFile | undefined {
  for (const candidate of modelPathCandidates(storagePath(model), 0, variations)) {
    const found = findPackageFile(packages, candidate);
    if (found) return found;
  }
  return undefined;
}

/**
 * What a model is, for telling a changed one: its first variation's file size and bytes when one of
 * `packages` holds it (packageModelFile), as `pkg:<size>:<sha1>`, else its storage path in the game
 * (whose files a Workspace doesn't track), as `game:<path>`.
 */
export function modelHash(packages: readonly string[], model: string, variations = 1): string {
  const found = packageModelFile(packages, model, variations);
  if (!found) return `game:${storagePath(model).toLowerCase()}`;
  const data = readFileSync(found.file);
  return `pkg:${data.length}:${createHash("sha1").update(data).digest("hex")}`;
}

/**
 * Whether a model is no longer the one `recorded` (an entry's modelHash) names. A package model's
 * file is compared by its size alone, so nothing is read or hashed: a change that keeps the file
 * exactly the same size goes unnoticed, which the author accepts (#558). A game model is compared by
 * its path.
 */
export function modelChanged(packages: readonly string[], model: string, variations = 1, recorded?: string): boolean {
  const found = packageModelFile(packages, model, variations);
  if (!found) return recorded !== `game:${storagePath(model).toLowerCase()}`;
  const size = /^pkg:(\d+):/.exec(recorded ?? "")?.[1];
  return size === undefined || Number(size) !== statSync(found.file).size;
}

/**
 * Whether the Campaign Mod's index covers a doodad (ADR-0017): one of the mod's own doodads, or a
 * game doodad the mod redefines with another model, since its look comes from its model; with the
 * same model, core's entry stands.
 */
export function coveredByModIndex(catalog: Catalog, id: string): boolean {
  const doodad = catalog.doodads.get(id);
  if (doodad === undefined) return false;
  const game = getDoodadModel(id);
  if (game === undefined) return true;
  return doodad.model !== undefined && storagePath(doodad.model).toLowerCase() !== storagePath(game).toLowerCase();
}

/** The Campaign Mod's doodads the index covers (coveredByModIndex), sorted. */
export function indexedModDoodads(catalog: Catalog): string[] {
  return [...catalog.doodads.keys()].filter((id) => coveredByModIndex(catalog, id)).sort();
}

/**
 * The mod's entry for a doodad when its index covers it and has one: it replaces core's for every
 * reader, even while pending. Undefined otherwise, so core's entry stands (an entry left for a
 * doodad the mod no longer covers is gone, not read).
 */
export function modDoodadEntry(catalog: Catalog, id: string): ModDoodadEntry | undefined {
  return coveredByModIndex(catalog, id) ? catalog.doodadIndex.get(id) : undefined;
}

/**
 * A doodad's description from its picture, if it has one: the Campaign Mod's doodad index's when
 * it covers the doodad (a mod doodad, or a game doodad whose model the mod changed), even while its
 * entry is pending, else core's. An entry for a doodad the index no longer covers is ignored.
 */
export function getDoodadDescription(catalog: Catalog, type: string): DoodadDescription | undefined {
  const entry = modDoodadEntry(catalog, type);
  if (entry) return entry.description as DoodadDescription | undefined;
  return getGameDoodadDescription(type);
}

/** The absolute path of a mod doodad's sheet when its entry names one and the file is on this machine. */
export function modDoodadSheet(catalog: Catalog, type: string): string | undefined {
  const sheet = catalog.doodadIndex.get(type)?.sheet;
  if (sheet === undefined || catalog.modDir === undefined) return undefined;
  const file = path.join(catalog.modDir, ...sheet.split("/"));
  return existsSync(file) ? file : undefined;
}

/** Whether an entry waits for a description: it has none, or none written for its current model. */
export const isPending = (entry: ModDoodadEntry): boolean => entry.description === undefined || entry.described === undefined;

/**
 * The Campaign Mod's doodads as Doodad Search lays them over the stock catalogs (doodad-search.ts),
 * in the catalog's order: each of the mod's own, and each game doodad the mod gave a model of its
 * own (coveredByModIndex), as its index entry describes and pictures it, pending until it has a
 * description written for its current model. A game doodad the mod redefines on the game's model
 * is left out, so the game's entry stands.
 */
export function modSearchDoodads(catalog: Catalog, stock: Pick<StockDoodadSources, "doodads">): Map<string, SearchableModDoodad> {
  const found = new Map<string, SearchableModDoodad>();
  for (const [id, doodad] of catalog.doodads) {
    const covered = coveredByModIndex(catalog, id);
    if (!covered && Object.hasOwn(stock.doodads, id)) continue;
    const entry = covered ? catalog.doodadIndex.get(id) : undefined;
    const { uses, ...description } = entry?.description ?? {};
    const sheet = entry?.sheet !== undefined && catalog.modDir !== undefined ? path.join(catalog.modDir, ...entry.sheet.split("/")) : undefined;
    found.set(id, {
      ...(entry?.name !== undefined ? { name: entry.name } : {}),
      ...(entry?.description ? { description: description as DoodadDescription } : {}),
      ...(uses ? { uses } : {}),
      variations: doodad.variations ?? 1,
      ...(sheet !== undefined ? { sheet } : {}),
      ...(entry === undefined || isPending(entry) ? { pending: true as const } : {}),
      ...(entry?.unpictured !== undefined ? { unpictured: entry.unpictured } : {}),
    });
  }
  return found;
}

/** What the index lacks against the mod, for the Workspace check: each id sorted. */
export type ModDoodadIndexGaps = {
  /** Doodads the index covers that have no entry. */
  readonly missing: readonly string[];
  /** Entries with no description yet. */
  readonly pending: readonly string[];
  /** Entries whose model has changed since they were written. */
  readonly stale: readonly string[];
  /** Entries for doodads the mod no longer defines (or whose model the game's entry now matches). */
  readonly gone: readonly string[];
};

export function modDoodadIndexGaps(catalog: Catalog, packages: readonly string[]): ModDoodadIndexGaps {
  const covered = indexedModDoodads(catalog);
  const coveredIds = new Set(covered);
  const index = catalog.doodadIndex;
  const missing = covered.filter((id) => !index.has(id));
  const present = covered.filter((id) => index.has(id));
  const stale = present.filter((id) => {
    const doodad = catalog.doodads.get(id);
    const entry = index.get(id)!;
    if (doodad?.model === undefined) return entry.model !== undefined;
    return modelChanged(packages, doodad.model, doodad.variations, entry.modelHash);
  });
  const staleIds = new Set(stale);
  const pending = present.filter((id) => !staleIds.has(id) && isPending(index.get(id)!));
  const gone = [...index.keys()].filter((id) => !coveredIds.has(id)).sort();
  return { missing, pending, stale, gone };
}
