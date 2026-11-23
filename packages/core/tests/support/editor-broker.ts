// An Editor Broker in the test's own process, on the socket under the host's cacheDir, so the
// captures that run through the broker find it answering and never start a detached one. Close
// every broker started here with closeTestBrokers in an afterEach.
import { brokerSocketPath } from "../../src/capture/editor-broker-client.js";
import { startEditorBroker, type EditorBroker } from "../../src/capture/editor-broker.js";
import type { Host } from "../../src/host/host.js";
import { hostContext } from "../../src/host/machine-config.js";

const brokers: EditorBroker[] = [];

/** Starts a broker for `host`'s cacheDir, running its editor.captureTour. */
export async function startTestBroker(host: Host): Promise<EditorBroker> {
  const broker = await startEditorBroker({ host, socketPath: brokerSocketPath(hostContext(host.machine).requirePath("cacheDir")) });
  if (!broker) throw new Error("a broker already answers on this cacheDir's socket");
  brokers.push(broker);
  return broker;
}

export async function closeTestBrokers(): Promise<void> {
  await Promise.all(brokers.splice(0).map((broker) => broker.close()));
}
