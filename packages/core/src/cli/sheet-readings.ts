// Sheet readings (docs/reference/doodad-facings.md): reads doodads' fronts by eye from the
// catalog's turntable renders, for core's data/doodad-sheet-readings.json.
//
//   npm run sheet-readings -- --batches <folder> [--renders <folder>] [--per <n>]
//     writes montages of the doodads worth reading (rendered, unmeasured, unread) into <folder>,
//     <per> to an image (6 by default), with batches.txt naming each image's doodads, and a
//     calibration montage of the author's measured doodads with their answers. A reader (an agent,
//     following the brief in docs/reference/doodad-facings.md) writes JSON lines from them.
//   npm run sheet-readings -- --merge <file.jsonl>... [--by <who>] [--bounds <file.json>]
//     merges the readers' lines into core's doodad-sheet-readings.json, marked read by <who>
//     (default "agent") today. Each wall-foot piece's bounds suggest a stand-off: read through
//     this machine's Host Adapter, or from --bounds (a model-footprints catalog by doodad id).

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { EMPTY_CATALOG } from "../catalog/catalog-layer.js";
import { SHEET_BACKGROUND, sheetRenders } from "@team-antioch/sc2-asset-catalog/catalog/catalog-sheets.js";
import { frontFromPictures, sheetPictureAzimuth } from "@team-antioch/sc2-asset-catalog/catalog/doodad-facings.js";
import { bundledDoodadFacings, bundledSheetReadings, DOODAD_SHEET_READINGS_PATH, getDoodad, getDoodadModel, readCoreDoodadCatalog } from "../catalog/stock-catalog.js";
import { campaignModelData } from "../catalog/model-anims.js";
import { recordModelFootprints } from "../catalog/model-footprints.js";
import { type Bounds, type CandidateEntry, formatSheetReadings, mergeSheetReadings, parseReaderLines, sheetCandidates } from "../catalog/sheet-readings.js";
import { loadHost } from "../host/host.js";
import { hostContext, loadMachineConfig } from "../host/machine-config.js";

const run = promisify(execFile);
/** npm runs the script from the package, and says where the author ran it in INIT_CWD. */
const CWD = process.env.INIT_CWD ?? process.cwd();
/** ImageMagick's default font is missing on some Macs; its labels need one. */
const FONT = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf"].find((font) => existsSync(font));
const CORE = fileURLToPath(new URL("../../", import.meta.url));

const USAGE = [
  "Usage: sheet-readings --batches <folder> [--renders <folder>] [--per <n>]",
  "       sheet-readings --merge <file.jsonl>... [--by <who>] [--bounds <file.json>]",
].join("\n");

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const [value] = args.splice(index, 2).slice(1);
  return value;
}

/** One montage: a row per doodad, its four pictures a0-a3 left to right, labelled. */
async function montage(rows: readonly { label: string; renders: readonly string[] }[], output: string): Promise<void> {
  const args = rows.flatMap(({ label, renders }) => renders.flatMap((render, n) => ["-label", n === 0 ? `${label}  a0` : `a${n}`, render]));
  await run("montage", [...args, ...(FONT ? ["-font", FONT] : []), "-pointsize", "13", "-background", SHEET_BACKGROUND, "-geometry", "190x190+2+2", "-tile", "4x", output]);
}

async function batches(folder: string, args: string[]): Promise<void> {
  const renders = path.resolve(CWD, option(args, "renders") ?? path.join(CORE, "data/thumbnails/doodads"));
  const per = Number(option(args, "per") ?? 6);
  if (!Number.isInteger(per) || per < 1) throw new Error(`--per takes a whole number of doodads to an image, at least 1\n${USAGE}`);
  const rendersOf = (id: string) => sheetRenders("doodad", id).map((file) => path.join(renders, path.basename(file)));
  const catalog = readCoreDoodadCatalog().catalog as Record<string, CandidateEntry>;
  const rendered = new Set(Object.keys(catalog).filter((id) => rendersOf(id).every((file) => existsSync(file))));
  const facings = bundledDoodadFacings();
  const ids = sheetCandidates(catalog, rendered, facings, bundledSheetReadings());
  await mkdir(path.join(folder, "batches"), { recursive: true });
  const lines: string[] = [];
  for (let start = 0; start < ids.length; start += per) {
    const batch = ids.slice(start, start + per);
    lines.push(batch.join(" "));
    await montage(batch.map((id) => ({ label: id, renders: rendersOf(id) })), path.join(folder, "batches", `${String(start / per).padStart(3, "0")}.jpg`));
  }
  await writeFile(path.join(folder, "batches.txt"), `${lines.join("\n")}\n`);
  // The calibration: the measured doodads with renders, and the pictures their fronts show in.
  const measured = Object.entries(facings.doodads).filter(([id]) => rendered.has(id));
  await mkdir(path.join(folder, "calibration"), { recursive: true });
  const answers: string[] = [];
  for (let start = 0; start < measured.length; start += 7) {
    const batch = measured.slice(start, start + 7);
    const image = `${String(start / 7).padStart(2, "0")}.jpg`;
    await montage(batch.map(([id, facing]) => ({ label: `${id} ${facing.front}`, renders: rendersOf(id) })), path.join(folder, "calibration", image));
    for (const [id, facing] of batch) {
      const faces = [0, 1, 2, 3].filter((n) => Math.abs(((sheetPictureAzimuth(n) - facing.front + 540) % 360) - 180) <= 45);
      answers.push(`- ${image} ${id}: front ${facing.front}, so its front shows in ${faces.map((n) => `a${n}`).join(" and ")} (when it has a visible front at all)`);
    }
  }
  await writeFile(
    path.join(folder, "calibration", "answers.md"),
    `# The author's measured doodads\n\nPicture aN looks from ${[0, 1, 2, 3].map((n) => `a${n} ${sheetPictureAzimuth(n)}°`).join(", ")} (counterclockwise from east), pitched down 35°.\nSome measured fronts are a convention the pictures can't show (crates, pipes, tanks).\n\n${answers.join("\n")}\n`,
  );
  console.log(`${ids.length} doodads to read in ${lines.length} montages in ${folder}/batches, named in batches.txt; calibration in ${folder}/calibration.`);
  console.log("Give each reader the brief in docs/reference/doodad-facings.md (Reading more: the sheets), then run sheet-readings --merge on their JSON lines.");
}

async function merge(files: string[], args: string[]): Promise<void> {
  const by = option(args, "by") ?? "agent";
  const boundsFile = option(args, "bounds");
  const lines = (await Promise.all(files.map(async (file) => parseReaderLines(await readFile(file, "utf8")).map((line) => ({ line, file }))))).flat();
  const facings = bundledDoodadFacings();
  const wallFoot = lines.filter(({ line }) => line.placement === "wall-foot" && frontFromPictures(line.faces) !== undefined).map(({ line }) => line.id);
  let bounds: Record<string, Bounds> = {};
  if (boundsFile) bounds = JSON.parse(await readFile(path.resolve(CWD, boundsFile), "utf8")) as Record<string, Bounds>;
  else if (wallFoot.length > 0) {
    const machine = await loadMachineConfig();
    const host = await loadHost(machine);
    const doodadModel = (id: string) => {
      const model = getDoodadModel(id);
      return model ? { model, variations: getDoodad(EMPTY_CATALOG, id)?.variations ?? 1 } : undefined;
    };
    const read = await recordModelFootprints(host, wallFoot, { modelData: async () => campaignModelData(hostContext(machine).requirePath("cacheDir")), assetRoots: [], doodadModel });
    bounds = read.catalog;
    for (const { id, reason } of read.failed) console.warn(`${id}: no bounds, so no stand-off suggested (${reason})`);
  }
  const today = new Date().toISOString().slice(0, 10);
  const { readings, skipped } = mergeSheetReadings(bundledSheetReadings(), lines.map(({ line }) => line), `${by}, ${today}, catalog sheet`, facings, bounds);
  await writeFile(DOODAD_SHEET_READINGS_PATH, formatSheetReadings(readings));
  if (skipped.length > 0) console.log(`Measured by the author, so left as measured: ${skipped.join(", ")}`);
  console.log(`Recorded ${lines.length - skipped.length} readings in ${DOODAD_SHEET_READINGS_PATH}.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const folder = option(args, "batches");
  if (folder) return batches(path.resolve(CWD, folder), args);
  const mergeAt = args.indexOf("--merge");
  if (mergeAt >= 0) {
    args.splice(mergeAt, 1);
    const files: string[] = [];
    // The files: what's left once --by and --bounds and their values are taken out.
    const options = ["by", "bounds"].flatMap((name) => {
      const value = option(args, name);
      return value === undefined ? [] : [`--${name}`, value];
    });
    const unknown = args.find((arg) => arg.startsWith("--"));
    if (unknown) throw new Error(`Unknown option ${unknown}\n${USAGE}`);
    files.push(...args.map((arg) => path.resolve(CWD, arg)));
    if (files.length > 0) return merge(files, options);
  }
  console.error(USAGE);
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
