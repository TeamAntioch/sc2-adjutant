// Builds the catalog of cinematic sets from Cutscene Editor files. Each `--source <kind>=<dir>`
// names a folder and its source kind: `blizzard` for Blizzard's game data (the sc2-game-data
// mirror, as downloaded to docs/research/cutscene-cinematography/downloads in the research
// archive, $SC2_RESEARCH_DIR), or a Campaign's repo, whose kind its Plugin contributes to the
// Workspace holding the current folder (outside a Workspace, only `blizzard`). Writes catalog.json,
// a plan SVG per set and a README index into the output folder.
//
// Core's catalog (data/cinematic-sets) is Blizzard's sets alone:
//
//   npm run catalog-sets -- --source blizzard=$SC2_RESEARCH_DIR/docs/research/cutscene-cinematography/downloads \
//     --out packages/core/data/cinematic-sets
//
// A Workspace's own sets are in its cinematic-sets folder: read with its Campaign's files and
// Blizzard's together (so a set the Campaign staged in a Blizzard set is the one set), and written
// with --private, which keeps only the sets with a file that isn't Blizzard's. From the Workspace:
//
//   npm run catalog-sets -- --source <kind>=<Campaign repo> --source blizzard=<downloads> --private --out cinematic-sets

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { bundledDisplayChannels } from "../catalog/display-channels.js";
import { loadCatalogSources } from "../cutscene/load-sources.js";
import { renderSetIndex, renderSetPlanSvg } from "../cutscene/render-set-plan.js";
import { buildSetCatalog, privateSets } from "../cutscene/set-catalog.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const out = option("out");
  if (!out || !args.includes("--source")) {
    console.error("Usage: catalog-sets --source <kind>=<dir> [--source <kind>=<dir> ...] [--workspace <dir>] [--private] --out <dir>");
    process.exitCode = 2;
    return;
  }
  const { kinds, roots, sources } = await loadCatalogSources(args);
  const privateOnly = args.includes("--private");
  const all = buildSetCatalog(sources, kinds);
  const sets = privateOnly ? privateSets(all) : all;
  await rm(path.join(out, "plans"), { recursive: true, force: true });
  await mkdir(path.join(out, "plans"), { recursive: true });
  // Centimetre precision is plenty for a plan and keeps the file small. Node GUIDs only matter to
  // tools that reopen the source files (the contact sheet), which rebuild the catalog themselves.
  const rounded = (key: string, value: unknown): unknown =>
    key === "guid" || key === "lamps" ? undefined : typeof value === "number" ? Math.round(value * 100) / 100 : value;
  // One set per line: small, and a regenerated catalog diffs set by set.
  const lines = sets.map((set) => JSON.stringify(set, rounded));
  await writeFile(path.join(out, "catalog.json"), `{"files":${sources.length},"sets":[\n${lines.join(",\n")}\n]}\n`);
  // Each set's screens and their channels, from core's display channels (npm run display-channels).
  const displays = await bundledDisplayChannels();
  for (const set of sets) await writeFile(path.join(out, "plans", `${set.id}.svg`), renderSetPlanSvg(set, kinds, displays));
  await writeFile(path.join(out, "README.md"), renderSetIndex(sets, sources.length, kinds, [...new Set(roots.map(({ origin }) => origin))], privateOnly, displays));
  console.log(`${sets.length} sets from ${sources.length} files written to ${out}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
