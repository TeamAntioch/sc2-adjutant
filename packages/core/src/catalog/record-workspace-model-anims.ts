// Recording model animations in a Workspace (ADR-0026), for a mapper who can't change core's
// data/model-anims.json. Each model goes to the file of its owner: a Mission's own (a CModel of
// its Map Package's Kept data, when the Mission is named) beside its Blueprint, the Campaign Mod's
// own beside the mod's Blueprint, and any other, a game model, in model-anims.json at the
// Workspace root. The Workspace's mod packages, and the named Mission's Map Package, are read for
// their models as `--mod` reads one, so a package model needs no Host Adapter and no game data; a
// game model is exported through the Host Adapter's model.export. A game model core doesn't record,
// and no package defines, is stock that core could carry for everyone, and the result names it so
// the session can offer a Missing-Feature Report. While which models are the Campaign Mod's or the
// Mission's own can't be told, it records nothing, since one of them would go to the root.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Host } from "../host/host.js";
import { missionCatalogFor } from "../map/mission-catalog.js";
import { missionMapPackage, readCompileRecord } from "../map/mission-package.js";
import { campaignModPackages } from "../mods/workspace-mods.js";
import { BLUEPRINT_FILE, missionIds, type Workspace } from "../plugins/workspace.js";
import { bundledModelAnims, MODEL_ANIMS_FILE, type ModelAnims, modModelData, parseModelAnims, recordModelAnims } from "./model-anims.js";
import { readModelEntries } from "./model-files.js";
import { packageAssetRoots } from "./package-files.js";

export type WorkspaceRecordOptions = {
  /** The Mission whose own models (its Map Package's Kept CModels) may be among those recorded. */
  readonly mission?: string;
  /** The game's ModelData catalogs in load order (campaignModelData), fetched only when a model needs them. */
  readonly gameModelData: () => Promise<readonly string[]>;
};

export type WorkspaceRecord = {
  /** Each file a model was recorded in, by its path from the Workspace's root, with those models. */
  readonly written: readonly { readonly file: string; readonly models: readonly string[] }[];
  readonly failed: readonly { readonly id: string; readonly reason: string }[];
  /** The game models recorded that core's data/model-anims.json doesn't record. */
  readonly stock: readonly string[];
};

/** Records each model's animations in its owner's Workspace file, keeping what each file holds. */
export async function recordWorkspaceModelAnims(workspace: Workspace, host: Host, ids: readonly string[], { mission, gameModelData }: WorkspaceRecordOptions): Promise<WorkspaceRecord> {
  const { catalog } = workspace;
  // Which models are the mod's own must be known, or one would go to the root and be called stock.
  if (catalog.error) throw new Error(`Can't tell which models are the Campaign Mod's own: ${catalog.error}`);
  const relative = (file: string) => path.relative(workspace.root, file).split(path.sep).join("/");
  // The named Mission's own models, and its package, read after the mods as the game loads a map.
  let missionOwn: ReadonlySet<string> = new Set();
  let missionFiles: { readonly anims: string; readonly mapPackage?: string } | undefined;
  if (mission !== undefined) {
    const known = await missionIds(workspace);
    if (!known.includes(mission)) throw new Error(`No Mission ${mission} in the Workspace (its Missions: ${known.join(", ") || "none"})`);
    const blueprintPath = path.join(workspace.missionsDir, mission, BLUEPRINT_FILE);
    const own = await missionCatalogFor(catalog, blueprintPath);
    missionOwn = new Set([...own.models].filter((model) => !catalog.models.has(model)));
    const mapPackage = await missionMapPackage(blueprintPath).catch(() => undefined);
    // As with the mod's: the Mission's own models must be known.
    if (mapPackage && existsSync(mapPackage)) {
      await readCompileRecord(blueprintPath).catch((error: unknown) => {
        throw new Error(`Can't tell which of the Mission ${mission}'s models are its own: its compile record doesn't read (${(error as Error).message})`);
      });
    }
    missionFiles = { anims: path.join(path.dirname(blueprintPath), MODEL_ANIMS_FILE), ...(mapPackage && existsSync(mapPackage) ? { mapPackage } : {}) };
  }
  const packages = [...(await campaignModPackages(workspace)), ...(missionFiles?.mapPackage ? [missionFiles.mapPackage] : [])];
  const read = await Promise.all(packages.map(modModelData));
  const packageCatalogs = read.flatMap((mod) => mod.catalogs);
  // The game's ModelData, when it can be had: without it (no cacheDir, or offline) the packages' models still record.
  let gameError: string | undefined;
  let modelData: Promise<string[]> | undefined;
  const options = {
    modelData: () =>
      // A fetcher that throws before it returns (no cacheDir) is read as one that rejects.
      (modelData ??= Promise.resolve().then(gameModelData).then(
        (game) => [...game, ...packageCatalogs],
        (error: unknown) => {
          gameError = (error as Error).message;
          return packageCatalogs;
        },
      )),
    // The newest-loaded package's copy of a model file first, as the game reads it: its
    // Base.SC2Assets folder, then its root, where a Map Package keeps its files.
    assetRoots: [...packages].reverse().flatMap(packageAssetRoots),
  };
  // A model a package defines is the Workspace's, so it's never stock, wherever it's recorded.
  const packageModels = readModelEntries(packageCatalogs);

  // Each model's file: the Mission's, the mod's or the root's.
  const rootFile = path.join(workspace.root, MODEL_ANIMS_FILE);
  const modFile = catalog.modDir ? path.join(catalog.modDir, MODEL_ANIMS_FILE) : undefined;
  const fileOf = (id: string): string => (missionFiles && missionOwn.has(id) ? missionFiles.anims : modFile && catalog.models.has(id) ? modFile : rootFile);
  const groups = new Map<string, string[]>();
  for (const id of new Set(ids)) groups.set(fileOf(id), [...(groups.get(fileOf(id)) ?? []), id]);
  const order = [rootFile, modFile, missionFiles?.anims];
  const files = [...groups.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));

  const written: { file: string; models: string[] }[] = [];
  const failed: { id: string; reason: string }[] = [];
  const stock: string[] = [];
  const core = await bundledModelAnims();
  for (const file of files) {
    const group = groups.get(file)!;
    let kept: ModelAnims;
    try {
      kept = existsSync(file) ? parseModelAnims(await readFile(file, "utf8"), relative(file)) : {};
    } catch (error) {
      // A file that doesn't read isn't written over: what it holds may be worth more than these.
      for (const id of group) failed.push({ id, reason: `${(error as Error).message}; fix it, then record again` });
      continue;
    }
    let result: Awaited<ReturnType<typeof recordModelAnims>>;
    try {
      // Read only: the file is written below, and only when a model was recorded.
      result = await recordModelAnims(host, group, options);
    } catch (error) {
      // Such as a host that can't export models, with no package to read them from.
      for (const id of group) failed.push({ id, reason: (error as Error).message.split("\n")[0]! });
      continue;
    }
    failed.push(...result.failed.map((failure) => (gameError && failure.reason === "no ModelData entry" ? { ...failure, reason: `no ModelData entry (the game's ModelData couldn't be read: ${gameError})` } : failure)));
    if (result.recorded.length === 0) continue;
    const merged = Object.fromEntries(Object.entries({ ...kept, ...result.catalog }).sort(([a], [b]) => a.localeCompare(b)));
    await writeFile(file, JSON.stringify(merged, null, 2) + "\n");
    written.push({ file: relative(file), models: [...result.recorded] });
    if (file === rootFile) stock.push(...result.recorded.filter((id) => !core[id] && !packageModels.has(id)));
  }
  return { written, failed, stock };
}

/** A list of ids in words: `A`, `A or B`, `A, B or C`. */
const either = (ids: readonly string[]): string => (ids.length < 2 ? ids.join("") : `${ids.slice(0, -1).join(", ")} or ${ids.at(-1)}`);

/** The line that tells a session the stock models recorded are worth a Missing-Feature Report; none when there are none. */
export function stockLine(stock: readonly string[]): string | undefined {
  if (stock.length === 0) return undefined;
  return `Core doesn't record ${either(stock)}, stock models it could carry for everyone: offer a Missing-Feature Report (the report-missing-feature skill) so they're added to core.`;
}

/** A record as the CLI prints it: each file written with its models, each failure, then the stock line. */
export function formatWorkspaceRecord({ written, failed, stock }: WorkspaceRecord): string {
  const stocked = stockLine(stock);
  return [...written.map(({ file, models }) => `${file}: ${models.join(", ")}`), ...failed.map(({ id, reason }) => `${id}: ${reason}`), ...(stocked ? [stocked] : [])].join("\n");
}
