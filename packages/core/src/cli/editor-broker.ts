// The Editor Broker's process (src/capture/editor-broker.ts): started detached by the first capture
// client that finds none answering, with the client's machine config in
// $SC2_ADJUTANT_MACHINE_CONFIG. It loads that machine's Host Adapter, listens on the socket under
// its cacheDir, runs capture jobs and the Editor actions that click menus one at a time, and exits
// after 10 minutes idle. Its output goes to <cacheDir>/editor-broker.log. Exits at once when
// another broker already answers.
//
//   node packages/core/dist/cli/editor-broker.js

import { fileURLToPath } from "node:url";

import { brokerSocketPath } from "../capture/editor-broker-client.js";
import { startEditorBroker } from "../capture/editor-broker.js";
import { loadHost } from "../host/host.js";
import { hostContext, loadMachineConfig } from "../host/machine-config.js";

async function main(): Promise<void> {
  const log = (line: string) => console.log(`[${new Date().toISOString()}] ${line}`);
  const host = await loadHost(await loadMachineConfig());
  const socketPath = brokerSocketPath(hostContext(host.machine).requirePath("cacheDir"));
  const broker = await startEditorBroker({ host, socketPath, log, script: fileURLToPath(import.meta.url) });
  if (!broker) {
    log(`another broker answers on ${socketPath}; exiting`);
    return;
  }
  // Stopped by hand, it removes its socket; one that crashed leaves it, for the next to take over
  // (Windows removes a named pipe either way).
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => void broker.close());
  await broker.closed;
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
