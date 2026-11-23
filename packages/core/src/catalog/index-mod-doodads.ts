// index-mod-doodads (ADR-0017): brings a Workspace's Campaign Mod doodad index up to date with the
// mod. Each doodad the index covers (indexedModDoodads) that is new, whose model changed, whose last
// render failed or whose sheet isn't on this machine is rendered through the Host Adapter's
// model.render, with the Workspace's mod packages, and gets its 2×2 sheet: committed when its model
// came from a Workspace package, in the git-ignored game-models folder when it is the game's. Its
// entry records its model, the model's hash and bounds, and its sheet. A model with no file to draw
// is unpictured and isn't tried again; any other failure is recorded and tried again next time.
//
// Descriptions are left to an agent (or the author): a new entry is pending. An agent-written
// description of a model that changed keeps its words (and its Doodad Uses) but loses `described`,
// so it is pending again; the author's is never touched. Entries for doodads the index no longer
// covers are dropped.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Host } from "../host/host.js";
import { campaignMod, campaignModPackages } from "../mods/workspace-mods.js";
import type { Workspace } from "../plugins/workspace.js";
import { modelPathCandidates, THUMBNAIL_ANGLES, thumbnailFileName } from "@team-antioch/sc2-asset-catalog/catalog/doodad-thumbnails.js";
import { readM3Footprint } from "./m3-footprint.js";
import {
  formatModDoodadIndex,
  GAME_MODEL_SHEETS_DIR,
  indexedModDoodads,
  isPending,
  MOD_DOODAD_INDEX_FILE,
  MOD_SHEETS_DIR,
  MOD_THUMBNAILS_DIR,
  type ModDoodadEntry,
  modelChanged,
  modelHash,
  packageModelFile,
  readModDoodadIndex,
} from "./mod-doodad-index.js";
import { type ManifestEntry, renderThumbnails } from "@team-antioch/sc2-asset-catalog/catalog/render-thumbnails.js";
import { buildSheet, hostModelRenderer } from "./host-model-renderer.js";
import { findPackageFile } from "./package-files.js";

export type IndexModDoodadsOptions = {
  /** Only these doodads (each one the index covers); the others' entries stay as they are. */
  readonly ids?: readonly string[];
  /** Render every chosen doodad again, as after rebuilding the renderer. */
  readonly force?: boolean;
  readonly workers?: number;
  readonly log?: (line: string) => void;
  /** Builds a sheet from its renders; the public montageSheet (ImageMagick) by default. */
  readonly buildSheet?: (sources: readonly string[], output: string) => Promise<void>;
};

export type IndexModDoodadsResult = {
  /** The index file, absolute. */
  readonly indexFile: string;
  /** Doodads rendered and sheeted this run. */
  readonly rendered: readonly string[];
  /** Doodads found to have no model file to draw this run. */
  readonly unpictured: readonly string[];
  /** Doodads whose render failed, with why; the next run tries them again. */
  readonly failed: readonly { readonly id: string; readonly error: string }[];
  /** Entries dropped: doodads the index no longer covers. */
  readonly dropped: readonly string[];
  /** Entries waiting for a description, after this run. */
  readonly pending: readonly string[];
};

/** The folders that hold only what a machine renders, each kept out of Git by a .gitignore of its own. */
const IGNORED_DIRS = [MOD_THUMBNAILS_DIR, GAME_MODEL_SHEETS_DIR];

export async function indexModDoodads(workspace: Workspace, host: Host, options: IndexModDoodadsOptions = {}): Promise<IndexModDoodadsResult> {
  const { catalog } = workspace;
  if (catalog.error) throw new Error(catalog.error);
  const mod = await campaignMod(workspace);
  if (!mod || catalog.modDir === undefined) throw new Error("The Workspace has no Campaign Mod to index (its config or Campaign Pack names none, or it isn't imported): import it with import-mod");
  const modDir = catalog.modDir;
  const packages = await campaignModPackages(workspace);
  const indexFile = path.join(modDir, MOD_DOODAD_INDEX_FILE);
  const existing = await readModDoodadIndex(modDir);
  const covered = indexedModDoodads(catalog);
  const unknown = (options.ids ?? []).filter((id) => !covered.includes(id));
  if (unknown.length > 0) throw new Error(`The doodad index doesn't cover ${unknown.join(", ")}: it covers the Campaign Mod's doodads (${covered.join(", ") || "none"}), and a game doodad only when the mod changes its model`);
  const chosen = options.ids && options.ids.length > 0 ? covered.filter((id) => options.ids!.includes(id)) : covered;
  const names = await actorNames(mod.modPackage);

  const next: Record<string, ModDoodadEntry> = {};
  const toRender: string[] = [];
  for (const id of covered) {
    const old = existing[id];
    if (!chosen.includes(id)) {
      if (old) next[id] = old;
      continue;
    }
    const doodad = catalog.doodads.get(id)!;
    const model = doodad.model!;
    const variations = doodad.variations ?? 1;
    // A model of the same size is the same model (modelChanged): only a changed one, or a forced run, is read and hashed again.
    const changed = modelChanged(packages, model, variations, old?.modelHash);
    const hash = changed || options.force || old?.modelHash === undefined ? modelHash(packages, model, variations) : old.modelHash;
    const sheet = sheetPath(id, packageModelFile(packages, model, variations) !== undefined);
    const name = names.get(id);
    const entry: ModDoodadEntry = {
      ...(name !== undefined ? { name } : {}),
      ...(doodad.categories !== undefined ? { categories: doodad.categories } : {}),
      model,
      modelHash: hash,
      ...(!changed && old?.bounds ? { bounds: old.bounds } : {}),
      ...(!changed && old?.sheet !== undefined ? { sheet: old.sheet } : {}),
      ...(!changed && old?.unpictured !== undefined ? { unpictured: old.unpictured } : {}),
      ...(!changed && old?.renderError !== undefined ? { renderError: old.renderError } : {}),
      ...keptDescription(old, changed),
    };
    next[id] = entry;
    const sheetHere = entry.sheet === sheet && existsSync(path.join(modDir, ...sheet.split("/")));
    if (options.force || changed || entry.renderError !== undefined || (entry.unpictured === undefined && !sheetHere)) toRender.push(id);
  }

  const rendered: string[] = [];
  const unpictured: string[] = [];
  const failed: { id: string; error: string }[] = [];
  if (toRender.length > 0) {
    const renderer = hostModelRenderer(host, { packages, purpose: "Indexing the Campaign Mod's doodads" });
    const thumbnails = path.join(modDir, MOD_THUMBNAILS_DIR);
    const jobs = toRender.map((id) => ({ type: id, model: next[id]!.model!, variation: 0, variations: catalog.doodads.get(id)?.variations ?? 1 }));
    await renderThumbnails(renderer, jobs, thumbnails, { force: true, ...(options.workers !== undefined ? { workers: options.workers } : {}), ...(options.log ? { log: options.log } : {}) });
    const manifest = JSON.parse(await readFile(path.join(thumbnails, "manifest.json"), "utf8")) as Record<string, ManifestEntry>;
    for (const id of toRender) {
      const outcome = manifest[`${id}_00`];
      const { sheet: _sheet, unpictured: _unpictured, renderError: _error, ...entry } = next[id]!;
      if (outcome?.ok) {
        // The package model.render read the model from, found as it finds it; none for the game's.
        const fromPackage = outcome.model !== undefined && findPackageFile(packages, outcome.model) !== undefined;
        const sheet = sheetPath(id, fromPackage);
        await (options.buildSheet ?? buildSheet)(
          Array.from({ length: THUMBNAIL_ANGLES }, (_, angle) => path.join(thumbnails, thumbnailFileName(id, 0, angle))),
          path.join(modDir, ...sheet.split("/")),
        );
        // A sheet in the other folder is left from when the model came from elsewhere.
        await rm(path.join(modDir, ...sheetPath(id, !fromPackage).split("/")), { force: true });
        next[id] = { ...entry, sheet };
        rendered.push(id);
      } else if (outcome?.notFound && packageModelFile(packages, entry.model!, catalog.doodads.get(id)?.variations ?? 1) === undefined) {
        // Only a game model can truly be missing: a Workspace package holds this one, so the renderer failed to open it.
        next[id] = { ...entry, unpictured: `no model file to draw: ${outcome.model ?? entry.model}` };
        unpictured.push(id);
      } else {
        const error = outcome?.error ?? "not rendered";
        // A sheet from an earlier render still pictures it until a render succeeds.
        const kept = next[id]!.sheet;
        next[id] = { ...entry, ...(kept !== undefined && existsSync(path.join(modDir, ...kept.split("/"))) ? { sheet: kept } : {}), renderError: error };
        failed.push({ id, error });
      }
    }
  }

  // Bounds, for the description's size: read from the package's file, else exported from the game.
  for (const id of chosen) {
    const entry = next[id]!;
    if (entry.bounds || entry.unpictured !== undefined) continue;
    const bounds = await modelBounds(host, packages, entry.model!, catalog.doodads.get(id)?.variations ?? 1).catch(() => undefined);
    if (bounds) next[id] = { ...entry, bounds };
  }

  await mkdir(modDir, { recursive: true });
  for (const dir of IGNORED_DIRS) {
    if (!existsSync(path.join(modDir, ...dir.split("/")))) continue;
    await writeFile(path.join(modDir, ...dir.split("/"), ".gitignore"), "# Rendered on each machine (index-mod-doodads), never committed: see ADR-0017.\n*\n");
  }
  await writeFile(indexFile, formatModDoodadIndex(next));
  const dropped = Object.keys(existing).filter((id) => !covered.includes(id)).sort();
  for (const id of dropped) {
    for (const fromPackage of [true, false]) await rm(path.join(modDir, ...sheetPath(id, fromPackage).split("/")), { force: true });
  }
  return { indexFile, rendered, unpictured, failed, dropped, pending: Object.keys(next).filter((id) => isPending(next[id]!)).sort() };
}

/** A doodad's sheet, relative to the mod's folder: committed for a Workspace package's model, git-ignored for a game model. */
const sheetPath = (id: string, fromPackage: boolean): string => `${fromPackage ? MOD_SHEETS_DIR : GAME_MODEL_SHEETS_DIR}/${id}.jpg`;

/** What an entry keeps of its description: the author's always; an agent's when its model hasn't changed, else its words without `described`, so it is pending. */
function keptDescription(old: ModDoodadEntry | undefined, changed: boolean): Pick<ModDoodadEntry, "description" | "described"> {
  if (!old?.description) return {};
  if (old.described === "author" || (!changed && old.described !== undefined)) return { description: old.description, described: old.described };
  return { description: old.description };
}

/** A model's width, depth and height in game units, from its MODL bounds, rounded to 0.01. */
async function modelBounds(host: Host, packages: readonly string[], model: string, variations: number): Promise<[number, number, number] | undefined> {
  const found = packageModelFile(packages, model, variations);
  let data: Uint8Array | undefined;
  if (found) data = await readFile(found.file);
  else {
    if (!host.has("model.export")) return undefined;
    const dir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-bounds-"));
    try {
      const file = path.join(dir, "model.m3");
      for (const candidate of modelPathCandidates(model, 0, variations)) {
        data = await host.run("model.export", { model: candidate, outputPath: file }).then(() => readFile(file), () => undefined);
        if (data) break;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  if (!data) return undefined;
  const { min, max } = readM3Footprint(data);
  const round = (value: number) => Math.round(value * 100) / 100;
  return [round(max[0] - min[0]), round(max[1] - min[1]), round(max[2] - min[2])];
}

/** The Editor names the mod's strings give its actors (`Actor/Name/<id>=…`), by id. */
async function actorNames(modPackage: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const file of ["GameStrings.txt", "ObjectStrings.txt"]) {
    const text = await readFile(path.join(modPackage, "enUS.SC2Data", "LocalizedData", file), "utf8").catch(() => "");
    for (const match of text.replace(/^﻿/, "").matchAll(/^Actor\/Name\/([^=\r\n]+)=(.*?)\r?$/gm)) if (match[2]!.trim()) names.set(match[1]!, match[2]!.trim());
  }
  return names;
}
