// Captures Shots in game (spec #637, src/capture/shots.ts), as the MCP tool capture_shots does:
// one frame per rectangle of the map, through the Editor Broker and this machine's Host Adapter
// (editor.captureTour), on a capture copy in the machine config's cacheDir. The map is a Mission's
// Blueprint (its own Map Package, frames in missions/<id>/output/shots/<name>/) or any Map Package
// (frames in <cacheDir>/shots/<name>/). It waits as long as the job takes. With --status it prints
// the broker's status instead: the running job, the queue and the last error.
//
//   npm run capture-shots -- <blueprint.json | Map.SC2Map> <shots.json> [--name <folder>] [--lighting <id>]
//   npm run capture-shots -- --status
//
// The shots file is a list of Shots ({ rect: [left, bottom, right, top], pitch?, yaw?, label? }),
// or { "shots": [...] }. Paths are relative to where the command was typed.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { brokerSocketPath, editorBrokerStatus } from "../capture/editor-broker-client.js";
import { captureShots, type Shot } from "../capture/shots.js";
import { shotsReport } from "./capture-shots-report.js";
import { loadHost } from "../host/host.js";
import { hostContext, loadMachineConfig } from "../host/machine-config.js";

const USAGE = "Usage: capture-shots <blueprint.json | Map.SC2Map> <shots.json> [--name <folder>] [--lighting <id>], or capture-shots --status";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { name: { type: "string" }, lighting: { type: "string" }, status: { type: "boolean" } } });
  if (values.status) {
    const config = await loadMachineConfig();
    const socketPath = brokerSocketPath(hostContext(config).requirePath("cacheDir"));
    const status = await editorBrokerStatus(socketPath);
    console.log(status ? JSON.stringify(status, null, 2) : `No Editor Broker answers at ${socketPath}: none is running.`);
    return;
  }
  const [mapArg, shotsArg] = positionals;
  if (!mapArg || !shotsArg || positionals.length > 2) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const target = path.resolve(cwd, mapArg);
  const source = target.replace(/[\\/]+$/, "").endsWith(".SC2Map") ? { mapPath: target } : { blueprintPath: target };
  const listed = JSON.parse(await readFile(path.resolve(cwd, shotsArg), "utf8")) as Shot[] | { shots: Shot[] };
  const shots = Array.isArray(listed) ? listed : listed.shots;
  if (!Array.isArray(shots)) throw new Error(`${shotsArg} holds neither a list of Shots nor { "shots": [...] }`);

  const host = await loadHost(await loadMachineConfig());
  const log = (line: string) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${line}`);
  const result = await captureShots(source, shots, { host, log, ...(values.name ? { name: values.name } : {}), ...(values.lighting ? { lighting: values.lighting } : {}) });
  const report = shotsReport(result);
  for (const line of report.lines) console.log(line);
  if (report.exitCode) process.exitCode = report.exitCode;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
