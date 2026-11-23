// Renders Asset Catalog thumbnails on this machine, through its Host Adapter's model.render: for
// each doodad in core's data/doodads.json, four turntable angles as transparent 512×512 PNGs. They are
// never committed. A manifest records what was rendered, so unchanged doodads are skipped on later
// runs; pass --force after rebuilding the renderer. --terrain-objects renders each model in
// data/terrain-object-catalog.json once instead, named after the model file, into
// data/thumbnails/terrain-objects. `npm run catalog-sheets` then makes the
// reference sheets agents read. The data/ paths are core's package folder (packages/core/data in
// this repo), wherever the command runs from; an `--out` folder is relative to where it was typed.
//
//   npm run thumbnails -- [doodad ids…] [--kind rock] [--tileset Shakuras] [--limit 20]
//                         [--all-variations] [--jobs 4] [--out <dir> [--sheets]] [--force]
//   npm run thumbnails -- --terrain-objects [model names…] [--limit 20] [--jobs 4] [--force]
//   npm run thumbnails -- <name> --model <file.m3 | storage path> --out <dir> [--sheets] [--force]
//
// --model renders one model no catalog lists, named <name>: a Campaign Mod doodad's model file
// (relative to where the command was typed), or a storage path the game holds, into a folder of
// its own, never core's catalog renders. --sheets (with --out) then montages each rendered variation's four angles into <name>_<variation>.jpg beside
// them, as a catalog sheet is built: Doodad Search judges its top candidates' variations this way.
//
// The macOS and Windows Host Adapters render with the WhiteoutFlakes viewer named by `modelViewerPath`
// in the machine config (build it with packages/plugin-host-macos/scripts/build-whiteoutflakes.sh, or
// packages/plugin-host-windows/scripts/build-whiteoutflakes.ps1 on Windows).

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { buildSheets } from "@team-antioch/sc2-asset-catalog/catalog/catalog-sheets.js";
import { jobSheet, modelJob, type ThumbnailJob } from "@team-antioch/sc2-asset-catalog/catalog/doodad-thumbnails.js";
import { renderThumbnails } from "@team-antioch/sc2-asset-catalog/catalog/render-thumbnails.js";
import { buildSheet, hostModelRenderer } from "../catalog/host-model-renderer.js";
import { getDoodadModel, listDoodads } from "../catalog/stock-catalog.js";
import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";

/** Core's data folder, which the catalogs and the thumbnails live in. */
const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));

// Lights and actor shapes have no model worth a picture.
const SKIPPED_KINDS = new Set(["light"]);

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      kind: { type: "string" },
      tileset: { type: "string" },
      limit: { type: "string" },
      "all-variations": { type: "boolean", default: false },
      jobs: { type: "string", default: "4" },
      out: { type: "string" },
      force: { type: "boolean", default: false },
      "terrain-objects": { type: "boolean", default: false },
      model: { type: "string" },
      sheets: { type: "boolean", default: false },
    },
  });
  if (values.model !== undefined && positionals.length !== 1) throw new Error("--model renders one model: give it one name, such as npm run thumbnails -- StoryLiftCage --model <file.m3>");
  // Core's renders folder holds the catalogs' models only, and their sheets are built elsewhere
  // (npm run catalog-sheets): an uncatalogued model and these sheets go in a folder of their own.
  if (values.model !== undefined && values.out === undefined) throw new Error("--model renders a model no catalog lists: give an --out folder, such as the Doodad Search's renders");
  if (values.sheets && values.out === undefined) throw new Error("--sheets builds each variation's sheet beside its renders: give an --out folder, such as the Doodad Search's");
  const host = await loadHost(await loadMachineConfig());

  const cwd = process.env.INIT_CWD ?? process.cwd();
  const wanted = new Set(positionals);
  const jobs =
    values.model !== undefined ? [modelJob(positionals[0]!, values.model, cwd)] : values["terrain-objects"] ? await terrainObjectJobs(wanted) : doodadJobs(wanted, values);
  if (values.limit !== undefined) jobs.splice(Number(values.limit));

  const outDir = values.out
    ? path.resolve(cwd, values.out)
    : path.join(DATA_DIR, values["terrain-objects"] ? "thumbnails/terrain-objects" : "thumbnails/doodads");
  const started = Date.now();
  const { rendered, failed, unchanged } = await renderThumbnails(hostModelRenderer(host), jobs, outDir, {
    force: values.force,
    workers: Number(values.jobs),
    log: (line) => console.log(`${line}, ${Math.round((Date.now() - started) / 1000)} s`),
  });
  console.log(`${rendered} rendered, ${failed} failed, ${unchanged} unchanged, in ${outDir}`);
  if (failed > 0) console.log(`Failures are listed in ${path.join(outDir, "manifest.json")} (ok: false).`);
  if (values.sheets) {
    const all = jobs.map((job) => jobSheet(job, outDir));
    const sheets = all.filter((job) => job.renders.every((render) => existsSync(render)));
    const built = await buildSheets(sheets, { force: values.force, build: buildSheet });
    console.log(`${built.length} sheet${built.length === 1 ? "" : "s"} built, ${sheets.length - built.length} up to date: ${sheets.map((job) => path.basename(job.sheet)).join(", ")}`);
    const lacking = all.filter((job) => !sheets.includes(job)).map((job) => path.basename(job.sheet));
    if (lacking.length) console.log(`No sheet for ${lacking.join(", ")}: not all four renders are there.`);
  }
}

function doodadJobs(wanted: Set<string>, values: { kind?: string; tileset?: string; "all-variations"?: boolean }): ThumbnailJob[] {
  const doodads = listDoodads().filter(
    ([type, info]) =>
      (wanted.size === 0 || wanted.has(type)) &&
      !SKIPPED_KINDS.has(info.kind) &&
      (values.kind === undefined || info.kind === values.kind) &&
      (values.tileset === undefined || (info.tilesets ?? []).includes(values.tileset)),
  );
  return doodads.flatMap(([type, info]) =>
    Array.from({ length: values["all-variations"] ? info.variations : 1 }, (_, variation) => ({
      type,
      model: getDoodadModel(type) ?? `Assets/Doodads/${type}/${type}.m3`,
      variation,
      variations: info.variations,
    })),
  );
}

/** One job per terrain-object model, named after its file (several objects share each model). */
async function terrainObjectJobs(wanted: Set<string>): Promise<ThumbnailJob[]> {
  const catalog = JSON.parse(await readFile(path.join(DATA_DIR, "terrain-object-catalog.json"), "utf8")) as Record<string, { model: string }>;
  const models = new Set(Object.values(catalog).map((entry) => entry.model));
  return [...models]
    .map((model) => ({ type: path.basename(model, ".m3"), model, variation: 0, variations: 1 }))
    .filter((job) => wanted.size === 0 || wanted.has(job.type));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
