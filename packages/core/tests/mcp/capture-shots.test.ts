// capture_shots (#640): the MCP tool over captureShots, through the Editor Broker, against the
// `studio` fixture host with a broker in the test's own process. A call waits for its job up to the
// server's wait limit; past it, it returns a job id, and capture_shots({ job }) collects the
// frames, or says where the job stands. The map is synthetic: a 96×80 MapInfo, playable 20,20 to 76,60.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { bareHost, type Host, loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { createServer } from "../../src/mcp/server.js";
import { writeMapInfo } from "../../src/terrain/write-map-info.js";
import { closeTestBrokers, startTestBroker } from "../support/editor-broker.js";
import { copyOf, tempFolder, text } from "./harness.js";

const studio = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await closeTestBrokers();
});

/** A Map Package with only a MapInfo, which is all a capture copy of it needs here. */
async function writeMap(mapPackage: string): Promise<void> {
  await mkdir(mapPackage, { recursive: true });
  await writeFile(path.join(mapPackage, "MapInfo"), writeMapInfo({ width: 96, height: 80, tilesetId: "Shakuras", fogType: "Dark", playableBounds: [20, 20, 76, 60], players: [] }));
}

/**
 * The `field` Workspace with Lava Field's package, served on a studio host whose tours each wait
 * for `release()` when `held`, with a broker for its cacheDir. `captureWaitMs` is the server's wait limit.
 */
async function setup({ adapter = true, held = false, captureWaitMs }: { adapter?: boolean; held?: boolean; captureWaitMs?: number } = {}) {
  const root = await copyOf("field");
  const cacheDir = path.join(await tempFolder(), "cache");
  await mkdir(cacheDir, { recursive: true });
  const file = path.join(path.dirname(cacheDir), "machine.json");
  await writeFile(file, JSON.stringify({ hostAdapter: adapter ? studio : "none", cacheDir }));
  const config = await loadMachineConfig({ file, env: {} });
  const loaded = adapter ? await loadHost(config) : bareHost(config);
  const gates: (() => void)[] = [];
  const host: Host = {
    ...loaded,
    run: (async (name: Parameters<Host["run"]>[0], request: Parameters<Host["run"]>[1]) => {
      // Held tours stop as the macOS one does when their signal aborts.
      if (name === "editor.captureTour" && held) {
        const { signal } = request as { signal?: AbortSignal };
        await new Promise<void>((resolve, reject) => {
          gates.push(resolve);
          signal?.addEventListener("abort", () => reject(new Error("the capture was cancelled")));
        });
      }
      return loaded.run(name, request as never);
    }) as Host["run"],
  };
  if (adapter) await startTestBroker(host);
  const mapPackage = path.join(root, "missions", "lava-field", "Lava-Field.SC2Map");
  await writeMap(mapPackage);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ workspaceRoot: root, host, ...(captureWaitMs !== undefined ? { captureWaitMs } : {}) }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  clients.push(client);
  /** Lets the held tours run, once each has started. */
  const release = async (count = 1) => {
    while (gates.length < count) await new Promise((resolve) => setTimeout(resolve, 10));
    for (const gate of gates.splice(0)) gate();
  };
  return { root, cacheDir, client, mapPackage, release };
}

const SHOTS = [{ rect: [40, 30, 60, 44], label: "North gate" }, { rect: [24, 24, 30, 30] }];

type Reply = { state: string; job?: string; place?: string; outputDir?: string; frames?: string[]; shotsJson?: string };

describe("capture_shots", () => {
  it("returns a Mission's frames and shots.json when the job finishes within the wait", async () => {
    const { root, client } = await setup();
    const reply = await client.callTool({ name: "capture_shots", arguments: { mission: "lava-field", shots: SHOTS, name: "gate" } });

    expect(reply.isError).toBeFalsy();
    const outputDir = path.join(root, "missions", "lava-field", "output", "shots", "gate");
    const result = reply.structuredContent as Reply;
    expect(result).toMatchObject({ state: "done", outputDir, shotsJson: path.join(outputDir, "shots.json") });
    expect(result.frames).toEqual([path.join(outputDir, "01-north-gate.jpg"), path.join(outputDir, "02.jpg")]);
    expect(await readFile(result.frames![0]!, "utf8")).toBe("frame 1\n");
    expect(text(reply)).toContain(`Captured 2 Shots in ${outputDir}`);
  });

  it("lists a Shot the host captured late apart from missing ones, with no frame (#123)", async () => {
    const { cacheDir, client } = await setup();
    // The studio host reports stop 1 as captured after its hold.
    await writeFile(path.join(cacheDir, "tour-stops.txt"), "1 late\n2\n");
    const reply = await client.callTool({ name: "capture_shots", arguments: { mission: "lava-field", shots: SHOTS, name: "late" } });

    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toMatchObject({
      state: "done",
      late: ["1 (North gate)"],
      missing: [],
      shots: [
        { shot: 1, label: "North gate", frame: null, late: true },
        { shot: 2, frame: expect.stringMatching(/02\.jpg$/) },
      ],
    });
    expect((reply.structuredContent as { shots: { late?: true }[] }).shots[1]!.late).toBeUndefined();
    expect(text(reply)).toContain("Shot 1 (North gate) was captured late, after the camera moved on: retake it");
  });

  it("returns a job id when the wait runs out, and collects the frames with it once the job is done", async () => {
    const { cacheDir, client, mapPackage, release } = await setup({ held: true, captureWaitMs: 300 });
    const first = await client.callTool({ name: "capture_shots", arguments: { mapPath: mapPackage, shots: SHOTS, name: "slow" } });
    expect(first.isError).toBeFalsy();
    const waiting = first.structuredContent as Reply;
    expect(waiting).toMatchObject({ state: "waiting", place: "running" });
    expect(waiting.job).toMatch(/\S/);
    expect(text(first)).toContain(`capture_shots({ job: "${waiting.job}" })`);

    // A second job, on another map so it can't join the first's tour, waits behind it.
    const other = path.join(path.dirname(mapPackage), "..", "Other.SC2Map");
    await writeMap(other);
    const second = await client.callTool({ name: "capture_shots", arguments: { mapPath: other, shots: SHOTS, name: "next" } });
    expect(second.structuredContent).toMatchObject({ state: "waiting", place: "1 of 1 in the queue" });

    // The job still writes its frames after the release; a slow runner can pass the 300 ms wait doing it.
    const collect = async (job: string) => {
      let reply;
      do reply = await client.callTool({ name: "capture_shots", arguments: { job } });
      while ((reply.structuredContent as Reply).state === "waiting");
      return reply;
    };

    await release();
    const collected = await collect(waiting.job);
    const outputDir = path.join(cacheDir, "shots", "slow");
    expect(collected.structuredContent).toMatchObject({ state: "done", job: waiting.job, outputDir, frames: [path.join(outputDir, "01-north-gate.jpg"), path.join(outputDir, "02.jpg")] });
    // Collecting it again gives the same frames.
    expect((await client.callTool({ name: "capture_shots", arguments: { job: waiting.job } })).structuredContent).toMatchObject({ state: "done", outputDir });

    await release();
    const next = await collect((second.structuredContent as Reply).job);
    expect(next.structuredContent).toMatchObject({ state: "done", outputDir: path.join(cacheDir, "shots", "next") });
  });

  it("cancels a running job by its id, and the next one runs", async () => {
    const { client, mapPackage, release } = await setup({ held: true, captureWaitMs: 300 });
    const first = (await client.callTool({ name: "capture_shots", arguments: { mapPath: mapPackage, shots: SHOTS, name: "unwanted" } })).structuredContent as Reply;
    expect(first.state).toBe("waiting");
    const other = path.join(path.dirname(mapPackage), "..", "Other.SC2Map");
    await writeMap(other);
    const second = (await client.callTool({ name: "capture_shots", arguments: { mapPath: other, shots: SHOTS, name: "wanted" } })).structuredContent as Reply;

    const cancelled = await client.callTool({ name: "capture_shots", arguments: { job: first.job, cancel: true } });
    expect(cancelled.structuredContent).toMatchObject({ state: "cancelled", job: first.job });
    expect(text(cancelled)).toContain("the capture job was cancelled");
    // The cancelled tour's gate is still in the list, beside the next one's.
    await release(2);
    const next = await client.callTool({ name: "capture_shots", arguments: { job: second.job } });
    expect(next.structuredContent).toMatchObject({ state: "done" });
    expect((await client.callTool({ name: "capture_shots", arguments: { cancel: true } })).isError).toBe(true);
  });

  it("refuses a machine with no capture host, an unknown job, and a call with neither a map nor a job", async () => {
    const bare = await setup({ adapter: false });
    const refused = await bare.client.callTool({ name: "capture_shots", arguments: { mission: "lava-field", shots: SHOTS } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("capture_shots needs a Host Adapter that can run editor.captureTour");
    expect(text(refused)).toContain("No Shots were captured");
    // It names every Host Adapter that has the capability, and the setting that picks one.
    expect(text(refused)).toContain("bundled:host-macos or bundled:host-windows");
    expect(text(refused)).toContain("hostAdapter");
    expect(text(refused)).not.toContain("their Mac");
    const collect = await bare.client.callTool({ name: "capture_shots", arguments: { job: "any" } });
    expect(text(collect)).toContain("capture_shots needs a Host Adapter");

    const { client } = await setup();
    const unknown = await client.callTool({ name: "capture_shots", arguments: { job: "nope" } });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain("No capture job nope");
    const empty = await client.callTool({ name: "capture_shots", arguments: { shots: SHOTS } });
    expect(empty.isError).toBe(true);
    expect(text(empty)).toContain("a mission or a mapPath");
  });
});
