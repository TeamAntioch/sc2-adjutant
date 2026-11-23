// Screenshots the cinematic-set contact sheet through this machine's Host Adapter
// (editor.captureTour), then collates the frames into <out dir>/<set id>/ with an index.html.
//
//   npm run capture-sets -- <manifest.json> <out dir> [--attach]
//
// The manifest comes from `npm run contact-sheet` and names the sheet map, which is copied into the
// machine config's cacheDir first: the capture closes it without saving. --attach only watches a
// game the author already started on the sheet, and leaves the Editor alone.

import { parseArgs } from "node:util";

import { captureSets } from "../capture/set-capture.js";
import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { attach: { type: "boolean", default: false } } });
  const [manifest, out] = positionals;
  if (!manifest || !out) {
    console.error("Usage: capture-sets <manifest.json> <out dir> [--attach]");
    process.exitCode = 2;
    return;
  }
  const host = await loadHost(await loadMachineConfig());
  const log = (line: string) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${line}`);
  const result = await captureSets(host, manifest, out, { attach: values.attach, log });
  log(`${result.end}: ${result.sets} sets, ${result.collated} shots collated (${result.usable} usable) into ${out}`);
  if (result.end !== "done") process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
