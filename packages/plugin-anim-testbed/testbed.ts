// The testbed's command: build a test map from a spec, or check one, or capture its tour.
//
//   node <plugin>/dist/testbed.js <spec.json>                    check, then build the map
//   node <plugin>/dist/testbed.js <spec.json> --check            check only
//   node <plugin>/dist/testbed.js <spec.json> --capture <folder> build with the spec's tour and film it
//                                                                through the Editor (a Host that can
//                                                                capture: the macOS one), one JPEG per stop
//   node <plugin>/dist/testbed.js <spec.json> --apply [--bank <file>]
//                                                                write the element starts, stops and mutes
//                                                                tuned in the game into the spec (tune.ts)
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadHost, loadMachineConfig, requireCapability, runBrokeredCapture } from "@team-antioch/sc2-adjutant/plugin-sdk";

import { buildTestbed, reportLines, TOUR_BANK } from "./build.ts";
import { readSpec } from "./spec.ts";
import { applyTunings, findTuneBanks, readTuneBank, tuneBankName, withoutApplied } from "./tune.ts";

const USAGE = `Usage: node dist/testbed.js <spec.json> [--check | --capture <folder> | --apply [--bank <file>]]`;

/** The tuning bank to apply: `--bank`, else the one of the spec's name under the Host's Banks folder. */
async function tuneBank(bank: string, given: string | undefined): Promise<string> {
  if (given) return given;
  const host = await loadHost(await loadMachineConfig()).catch((error: unknown) => {
    throw new Error(`No Host Adapter to find the game's Banks folder (${error instanceof Error ? error.message : String(error)}): name the bank with --bank <file>`);
  });
  if (!host.has("game.banksDir")) throw new Error(`This machine's Host Adapter can't name the game's Banks folder (game.banksDir): name the bank with --bank <file>`);
  const dir = await host.run("game.banksDir", {});
  const found = await findTuneBanks(dir, bank);
  if (found.length === 1) return found[0]!;
  if (found.length === 0) throw new Error(`No ${bank}.SC2Bank under ${dir}: nothing was tuned in the game, or it's elsewhere (name it with --bank <file>)`);
  const dated = await Promise.all(found.map(async (file) => `  ${file}  (${(await stat(file)).mtime.toISOString().slice(0, 16).replace("T", " ")})`));
  throw new Error(`${found.length} banks named ${bank}.SC2Bank under ${dir}; name one with --bank <file>:\n${dated.join("\n")}`);
}

/** Writes the game's tunings into the spec, then takes what it wrote out of the bank. */
async function apply(spec: string, given: string | undefined): Promise<void> {
  const text = await readFile(spec, "utf8");
  const read = readSpec(text);
  if (!read.spec) throw new Error(`${spec}: ${read.problems.join("; ")}`);
  const bank = tuneBankName(read.spec.name ?? path.basename(spec, path.extname(spec)));
  const file = await tuneBank(bank, given);
  const xml = await readFile(file, "utf8");
  const tunings = readTuneBank(xml);
  const result = applyTunings(text, tunings);
  for (const line of result.lines) console.log(`  ${line}`);
  if (result.text !== text) await writeFile(spec, result.text);
  const left = withoutApplied(xml, result.done);
  if (left === undefined) await rm(file);
  else if (left !== xml) await writeFile(file, left);
  const written = result.lines.filter((line) => line.includes(" → ") && !line.includes(" skipped")).length;
  const skipped = result.lines.length - written;
  console.log(`${written ? `wrote ${written} into ${spec}` : "nothing to write"}${skipped ? `; ${skipped} skipped, kept in the bank` : ""} (${left === undefined ? "bank emptied and removed" : file})`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  // npm run starts a script in the package's folder and says where it was run from in INIT_CWD; run
  // directly, a stale INIT_CWD inherited from some earlier npm would point elsewhere.
  const cwd = process.env.npm_lifecycle_event && process.env.INIT_CWD ? process.env.INIT_CWD : process.cwd();
  const check = args.includes("--check");
  const bankAt = args.indexOf("--bank");
  const bankFile = bankAt >= 0 ? args[bankAt + 1] : undefined;
  if (bankAt >= 0 && (!bankFile || bankFile.startsWith("--"))) throw new Error(`--bank needs the bank file\n${USAGE}`);
  const captureAt = args.indexOf("--capture");
  const captureDir = captureAt >= 0 ? args[captureAt + 1] : undefined;
  if (captureAt >= 0 && (!captureDir || captureDir.startsWith("--"))) throw new Error(`--capture needs a folder for the frames\n${USAGE}`);
  const specArg = args.find((arg, i) => !arg.startsWith("--") && (captureAt < 0 || i !== captureAt + 1) && (bankAt < 0 || i !== bankAt + 1));
  if (!specArg) throw new Error(`No spec given\n${USAGE}`);
  const spec = path.resolve(cwd, specArg);
  if (args.includes("--apply")) {
    await apply(spec, bankFile && path.resolve(cwd, bankFile));
    return;
  }
  if (bankAt >= 0) throw new Error(`--bank goes with --apply\n${USAGE}`);
  const started = Date.now();
  const result = await buildTestbed(spec, { check, tour: captureDir !== undefined });
  for (const line of reportLines(result)) console.log(line);
  if (result.report.errors.length) {
    console.log(`${result.report.errors.length} errors: not built (the generated script is ${result.scriptPath})`);
    process.exitCode = 1;
    return;
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (check) {
    console.log(`checked in ${secs} s`);
    return;
  }
  console.log(`built ${result.outMap} in ${secs} s`);
  if (!captureDir) return;
  const host = await loadHost(await loadMachineConfig());
  requireCapability(host, "editor.captureTour", "Capturing a testbed tour");
  const outputDir = path.resolve(cwd, captureDir);
  const { frames, end } = await runBrokeredCapture(
    host,
    {
      kind: "map",
      source: result.outMap,
      label: result.name,
      copy: true,
      bank: TOUR_BANK,
      settings: { frameDigits: 2, width: 1600, quality: 88, startSeconds: 300, pressSpaceAfterSeconds: 90 },
      outputDir,
    },
    { log: (line) => console.log(`  ${line}`) },
  );
  console.log(`${frames} frames (${end}) in ${outputDir}`);
  if (end !== "done") process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
