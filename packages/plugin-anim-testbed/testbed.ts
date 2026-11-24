// The testbed's command: build a test map from a spec, or check one, or capture its tour.
//
//   node <plugin>/dist/testbed.js <spec.json>                    check, then build the map
//   node <plugin>/dist/testbed.js <spec.json> --check            check only
//   node <plugin>/dist/testbed.js <spec.json> --capture <folder> build with the spec's tour and film it
//                                                                through the Editor (a Host that can
//                                                                capture: the macOS one), one JPEG per stop
import path from "node:path";

import { loadHost, loadMachineConfig, requireCapability, runBrokeredCapture } from "@team-antioch/sc2-adjutant/plugin-sdk";

import { buildTestbed, reportLines, TOUR_BANK } from "./build.ts";

const USAGE = `Usage: node dist/testbed.js <spec.json> [--check | --capture <folder>]`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const spec = path.resolve(cwd, args[0]!);
  const check = args.includes("--check");
  const captureAt = args.indexOf("--capture");
  const captureDir = captureAt >= 0 ? args[captureAt + 1] : undefined;
  if (captureAt >= 0 && !captureDir) throw new Error(`--capture needs a folder for the frames\n${USAGE}`);
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
