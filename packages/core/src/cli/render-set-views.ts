// Draws the cinematic sets in Blender under neutral light (see capture/set-views.ts): a plan, an
// overview and each camera's frame per set, with an index.html to browse them by.
//
//   npm run render-set-views -- --source <kind>=<Campaign repo> \
//     --source blizzard=$SC2_RESEARCH_DIR/docs/research/cutscene-cinematography/downloads \
//     [--only <set id>,<set id>] [--kind story|menu|all] [--limit 5] [--mod <SC2Mod folder>]... \
//     [--blender <program>] [--out <dir>]
//
// The models come through the machine's Host Adapter (model.exportGltf) and are kept in the machine
// config's cacheDir. Blender is `blender` on the path unless --blender says; --out is
// <cacheDir>/set-views by default.

import path from "node:path";

import { campaignModelData, modModelData } from "../catalog/model-anims.js";
import { renderSetViews } from "../capture/set-views.js";
import { loadCatalogSources } from "../cutscene/load-sources.js";
import { buildSetCatalog } from "../cutscene/set-catalog.js";
import { loadHost } from "../host/host.js";
import { hostContext, loadMachineConfig } from "../host/machine-config.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  if (!args.includes("--source")) {
    console.error("Usage: render-set-views --source <kind>=<dir> [--source ...] [--workspace <dir>] [--only ids] [--kind story|menu|all] [--limit n] [--mod <SC2Mod folder>]... [--blender <program>] [--out <dir>]");
    process.exitCode = 2;
    return;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const { kinds, sources } = await loadCatalogSources(args);
  const kind = option("kind") ?? "story";
  const only = option("only")?.split(",");
  let sets = buildSetCatalog(sources, kinds).filter((set) => (only ? only.includes(set.id) : kind === "all" || set.kind === kind));
  if (option("limit")) sets = sets.slice(0, Number(option("limit")));
  if (sets.length === 0) throw new Error("No sets selected");

  const machine = await loadMachineConfig();
  const host = await loadHost(machine);
  const cacheDir = hostContext(machine).requirePath("cacheDir");
  const modDirs = args.flatMap((arg, at) => (arg === "--mod" ? [path.resolve(cwd, args[at + 1] ?? "")] : []));
  const mods = await Promise.all(modDirs.map(modModelData));
  const out = path.resolve(cwd, option("out") ?? path.join(cacheDir, "set-views"));
  const log = (line: string) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${line}`);
  const rendered = await renderSetViews(sets, {
    host,
    blender: option("blender") ?? "blender",
    cacheDir,
    outDir: out,
    modelData: [...(await campaignModelData(cacheDir)), ...mods.flatMap((mod) => mod.catalogs)],
    assetRoots: mods.map((mod) => mod.assetRoot),
    log,
    // A run over every set of a kind is the whole list.
    prune: !only && !option("limit"),
  });
  log(`${rendered.length} of ${sets.length} sets drawn into ${out}/index.html`);
  if (rendered.length < sets.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
