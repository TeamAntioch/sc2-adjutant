// What the model-anims and model-footprints CLIs share: their arguments, the game's and mods'
// ModelData, and the report of what each recorded and why the rest failed.
//
//   <cli> [--mod <SC2Mod folder>]... [--into <catalog file>] <model id>...
//   <cli> --print [--variation <n>] [--mod <SC2Mod folder>]... <model or doodad id>...
//
// --into records into another catalog file than core's: a Campaign Mod's models go in
// mods/<id>/model-anims.json beside its Blueprint (docs/reference/campaign-catalog.md).
// --print only reads and prints, writing no catalog, so a Doodad Search leaves the repo clean. It
// also takes a doodad id, whose model data/doodad-models.json gives, and --variation; recording
// takes model ids and variation 00 alone, as `check` reads the catalogs by model id.

import path from "node:path";

import { EMPTY_CATALOG } from "../catalog/catalog-layer.js";
import { getDoodad, getDoodadModel } from "../catalog/stock-catalog.js";
import { campaignModelData, modModelData } from "../catalog/model-anims.js";
import type { RecordModelsOptions, RecordModelsResult } from "../catalog/record-models.js";
import { type Host, loadHost } from "../host/host.js";
import { hostContext, loadMachineConfig } from "../host/machine-config.js";
import { helpAsked, optionValue } from "./help-asked.js";

export type RecordModelsArgs =
  | { readonly help: true }
  | { readonly ids: string[]; readonly modDirs: string[]; readonly into?: string; readonly print: boolean; readonly variation?: number };

const usage = (name: string) =>
  `Usage: ${name} [--mod <SC2Mod folder>]... [--into <catalog file>] <model id>...
       ${name} --print [--variation <n>] [--mod <SC2Mod folder>]... <model or doodad id>...
--print only reads and prints, writing no catalog file; it takes doodad ids and --variation too.`;

const VALUED = new Set(["--mod", "--into", "--variation"]);

/** The command line's model ids, and its --mod and --into paths resolved against `cwd`, where the author ran it. */
export function recordModelsArgs(args: readonly string[], cwd: string): RecordModelsArgs {
  if (helpAsked(args, VALUED)) return { help: true };
  const ids: string[] = [];
  const modDirs: string[] = [];
  let into: string | undefined;
  let print = false;
  let variation: number | undefined;
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!;
    if (arg === "--mod") modDirs.push(path.resolve(cwd, optionValue(args, at++, arg)));
    else if (arg === "--into") into = path.resolve(cwd, optionValue(args, at++, arg));
    else if (arg === "--print") print = true;
    else if (arg === "--variation") {
      const value = args[++at];
      variation = Number(value);
      if (!(value !== undefined && /^\d+$/.test(value))) throw new Error(`--variation is a whole number from 0, not ${value ?? "nothing"}`);
    } else ids.push(arg);
  }
  if (variation !== undefined && !print) throw new Error("--variation reads a model's other variation, which the catalog doesn't keep: it needs --print");
  if (print && into) throw new Error("--print writes nothing, so it takes no --into");
  return { ids, modDirs, ...(into ? { into } : {}), print, ...(variation !== undefined ? { variation } : {}) };
}

/** A doodad's model file and its variations, from core's doodad catalogs. */
const doodadModel = (id: string) => {
  const model = getDoodadModel(id);
  return model ? { model, variations: getDoodad(EMPTY_CATALOG, id)?.variations ?? 1 } : undefined;
};

/**
 * Runs `record` on the command line's ids and mods, printing `describe` of each model read. It
 * records into `catalogFor(--into)`, the CLI's catalog file, except with --print, when `record` gets
 * no catalog file and writes nothing.
 */
export function recordModelsCli<Entry>(
  name: string,
  catalogFor: (into: string | undefined) => string,
  record: (host: Host, ids: readonly string[], options: RecordModelsOptions) => Promise<RecordModelsResult<Entry>>,
  describe: (entry: Entry) => string,
  /** Arguments that stand for a list of model ids, such as display-channels' `--catalog-sets`. */
  idLists: Readonly<Record<string, () => readonly string[]>> = {},
): void {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });

  async function main(): Promise<void> {
    // npm runs the script from the package, and says where the author ran it in INIT_CWD.
    let args: RecordModelsArgs;
    try {
      args = recordModelsArgs(process.argv.slice(2), process.env.INIT_CWD ?? process.cwd());
    } catch (error) {
      console.error(`${(error as Error).message}\n${usage(name)}`);
      process.exitCode = 2;
      return;
    }
    if ("help" in args) {
      console.log(usage(name));
      return;
    }
    const { modDirs, into, print, variation } = args;
    const ids = args.ids.flatMap((id) => idLists[id]?.() ?? [id]);
    if (ids.length === 0 || ids.some((id) => id.startsWith("--"))) {
      console.error(usage(name));
      process.exitCode = 2;
      return;
    }
    const catalogPath = print ? undefined : catalogFor(into);
    const machine = await loadMachineConfig();
    const host = await loadHost(machine);
    const mods = await Promise.all(modDirs.map(modModelData));
    // The game's catalogs are downloaded only once the recorder knows the host can export models (or there are mods).
    const modelData = async () => [...(await campaignModelData(hostContext(machine).requirePath("cacheDir"))), ...mods.flatMap((mod) => mod.catalogs)];
    const { catalog, recorded, failed } = await record(host, ids, {
      modelData,
      assetRoots: mods.map((mod) => mod.assetRoot),
      ...(catalogPath ? { catalogPath } : { doodadModel, ...(variation !== undefined ? { variation } : {}) }),
    });
    for (const id of recorded) console.log(`${id}: ${describe(catalog[id]!)}`);
    for (const { id, reason } of failed) console.error(`${id}: ${reason}`);
    if (failed.length > 0) process.exitCode = 1;
  }
}
