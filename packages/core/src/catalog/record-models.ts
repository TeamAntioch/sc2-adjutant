// Records something read from each model's .m3 in a catalog file of core's data, by model id: its
// animations (model-anims.ts) or its footprint (model-footprints.ts). Core finds the model's file
// in the ModelData catalogs; a mod's own model is read from its assets folder, any other is pulled
// out of the game by the Host Adapter's model.export, with its RequiredAnims merged in. Without a
// catalog file it only reads, and then also takes a doodad id and a variation.

import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { requireCapability, type Host } from "../host/host.js";
import { isModelNotFound } from "../plugins/plugin-api.js";
import { modelPathCandidates } from "@team-antioch/sc2-asset-catalog/catalog/doodad-thumbnails.js";
import { modelFile, modelVariations, readModelEntries, requiredAnimFiles } from "./model-files.js";

export type RecordModelsOptions = {
  /** The catalog file to add to; models already in it are kept. Without one nothing is written: the result holds the models read alone. */
  readonly catalogPath?: string | undefined;
  /** The variation to read, 00 by default. */
  readonly variation?: number | undefined;
  /** A doodad's model file and variation count (data/doodad-models.json, doodads.json), for an id no ModelData entry has. */
  readonly doodadModel?: ((id: string) => { readonly model: string; readonly variations: number } | undefined) | undefined;
  /**
   * ModelData catalogs in load order (campaignModelData), or a function that fetches them, called
   * only once the host is known to have model.export.
   */
  readonly modelData: readonly string[] | (() => Promise<readonly string[]>);
  /**
   * Folders holding a mod's own model files (its Base.SC2Assets). A model whose file is in one is
   * read from there, with each of its RequiredAnims found there, and needs no Host Adapter.
   */
  readonly assetRoots?: readonly string[];
};

/** ModelData parsed once a set of catalogs: a caller reading model after model (every variation of a doodad) hands the same array each time. */
const parsed = new WeakMap<readonly string[], ReturnType<typeof readModelEntries>>();
function parsedEntries(catalogs: readonly string[]): ReturnType<typeof readModelEntries> {
  let entries = parsed.get(catalogs);
  if (!entries) parsed.set(catalogs, (entries = readModelEntries(catalogs)));
  return entries;
}

export type RecordModelsResult<Entry> = {
  /** The catalog as written. */
  readonly catalog: Readonly<Record<string, Entry>>;
  readonly recorded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly reason: string }[];
};

/**
 * Records `read`'s entry for each model in the catalog, sorted by model id. `read` gets the model's
 * storage path, its .m3 and a reader of its RequiredAnims files (none for an exported model, which
 * has them merged in), so a reader that needs only the model reads no more. `what` names the work
 * in the error for a host without model.export.
 */
export async function recordModels<Entry>(
  host: Host,
  ids: readonly string[],
  { catalogPath, modelData, assetRoots = [], variation = 0, doodadModel, what, read }: RecordModelsOptions & { readonly what: string; readonly read: (file: string, own: Uint8Array, requiredAnims: () => Promise<readonly Uint8Array[]>) => Entry | Promise<Entry> },
): Promise<RecordModelsResult<Entry>> {
  const exportable = () => requireCapability(host, "model.export", what);
  // Without mod assets every model comes from the game, so the host is checked before any download.
  if (!assetRoots.length) exportable();
  const entries = parsedEntries(typeof modelData === "function" ? await modelData() : modelData);
  const local = (file: string): string | undefined => assetRoots.map((root) => path.join(root, file)).find((candidate) => existsSync(candidate));
  const catalog: Record<string, Entry> = catalogPath && existsSync(catalogPath) ? (JSON.parse(await readFile(catalogPath, "utf8")) as Record<string, Entry>) : {};
  const recorded: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  const work = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-models-"));
  try {
    for (const id of ids) {
      // A model id first, else a doodad id, whose model file the doodad catalog gives.
      const modelId = modelFile(entries, id);
      const doodad = modelId ? undefined : doodadModel?.(id);
      const file = modelId ?? doodad?.model;
      if (!file) {
        failed.push({ id, reason: doodadModel ? "no ModelData entry, and no doodad of that id" : "no ModelData entry" });
        continue;
      }
      const variations = doodad ? doodad.variations : modelVariations(entries, id);
      if (variation >= variations) {
        const two = (n: number) => String(n).padStart(2, "0");
        failed.push({ id, reason: `has ${variations} variation${variations === 1 ? "" : "s"} (00${variations > 1 ? ` to ${two(variations - 1)}` : ""}), not ${two(variation)}` });
        continue;
      }
      // A model with variations has numbered files, <name>_00.m3 and on: the one asked for is read.
      const candidates = modelPathCandidates(file, variation, variations);
      const found = candidates.map((candidate) => ({ candidate, own: local(candidate) })).find((entry) => entry.own !== undefined);
      if (found) {
        try {
          const anims = () => Promise.all((modelId ? requiredAnimFiles(entries, id) : []).flatMap((anim) => local(anim) ?? []).map((part) => readFile(part)));
          catalog[id] = await read(found.candidate, await readFile(found.own!), anims);
          recorded.push(id);
        } catch (error) {
          failed.push({ id, reason: firstLine(error) });
        }
        continue;
      }
      try {
        exportable();
      } catch (error) {
        // With mod assets, a model the game must export fails alone; the others are still recorded.
        failed.push({ id, reason: firstLine(error) });
        continue;
      }
      const saved = path.join(work, `${id}.m3`);
      // The first failure that isn't a missing file says why, as renderJob reports it: the other name is only a guess.
      let failure: { reason: string; notFound: boolean } | undefined;
      let done = false;
      for (const candidate of candidates) {
        try {
          await host.run("model.export", { model: candidate, outputPath: saved });
          catalog[id] = await read(candidate, await readFile(saved), async () => []);
          recorded.push(id);
          done = true;
          break;
        } catch (error) {
          if (!failure || failure.notFound) failure = { reason: firstLine(error), notFound: isModelNotFound(error) };
        }
      }
      if (!done) failed.push({ id, reason: failure?.reason ?? "no model file to try" });
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  const sorted = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)));
  if (catalogPath) await writeFile(catalogPath, JSON.stringify(sorted, null, 2) + "\n");
  return { catalog: sorted, recorded, failed };
}

/** An error's first line, for a report. */
const firstLine = (error: unknown): string => (error instanceof Error ? error.message.split("\n")[0]! : String(error));
