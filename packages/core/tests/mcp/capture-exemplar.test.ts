// capture_exemplar (#26): the active Style Pack's place and grid tours through the MCP server, as
// Editor Broker tour jobs on capture_shots's pattern, against the `studio` fixture host with a
// broker in the test's own process. The `studio` Workspace's one Exemplar Map, plaza, gets its
// source map (only a MapInfo), a hand-written study and one place.
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bareHost, type Host, loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { createServer } from "../../src/mcp/server.js";
import { writeMapInfo } from "../../src/terrain/write-map-info.js";
import { closeTestBrokers, startTestBroker } from "../support/editor-broker.js";
import { copyOf, tempFolder, text } from "./harness.js";

const studioHost = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await closeTestBrokers();
  vi.unstubAllEnvs();
});

/**
 * The studio Workspace ready to capture, served on a studio host whose tours write real JPEGs and,
 * when `held`, each wait for `release()`. `captureWaitMs` is the server's wait limit.
 */
async function setup({ adapter = true, held = false, captureWaitMs }: { adapter?: boolean; held?: boolean; captureWaitMs?: number } = {}) {
  vi.stubEnv("SC2_RESEARCH_DIR", "");
  const root = await copyOf("studio");
  const source = path.join(root, "exemplar-sources/Plaza.SC2Map");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "MapInfo"), writeMapInfo({ width: 64, height: 64, tilesetId: "Shakuras", fogType: "Dark", playableBounds: [4, 4, 60, 60], players: [] }));
  const exemplarDir = path.join(root, "style-pack/exemplar-maps");
  await mkdir(path.join(exemplarDir, "plaza"), { recursive: true });
  await writeFile(path.join(exemplarDir, "plaza/study.json"), JSON.stringify({ lighting: { lightsUsed: ["Day"], calls: [{ light: "Day", inFunction: "gt_MissionStart_Func" }] } }));
  await writeFile(path.join(exemplarDir, "mixtures.json"), JSON.stringify({ maps: ["plaza"], moodRules: [], moods: {}, places: [{ map: "plaza", center: [31.5, 31.5] }] }));

  const cacheDir = path.join(await tempFolder(), "cache");
  await mkdir(cacheDir, { recursive: true });
  const file = path.join(path.dirname(cacheDir), "machine.json");
  await writeFile(file, JSON.stringify({ hostAdapter: adapter ? studioHost : "none", cacheDir, exemplarMaps: path.join(root, "exemplar-sources") }));
  const config = await loadMachineConfig({ file, env: {} });
  const loaded = adapter ? await loadHost(config) : bareHost(config);
  const gates: (() => void)[] = [];
  const host: Host = {
    ...loaded,
    run: (async (name: Parameters<Host["run"]>[0], request: Parameters<Host["run"]>[1]) => {
      if (name !== "editor.captureTour") return loaded.run(name, request as never);
      const { signal, outputDir } = request as { signal?: AbortSignal; outputDir: string };
      if (held) {
        await new Promise<void>((resolve, reject) => {
          gates.push(resolve);
          signal?.addEventListener("abort", () => reject(new Error("the capture was cancelled")));
        });
      }
      const result = await loaded.run(name, request as never);
      const jpeg = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#456" } }).jpeg().toBuffer();
      for (const frame of (await readdir(outputDir)).filter((f) => f.endsWith(".jpg"))) await writeFile(path.join(outputDir, frame), jpeg);
      return result;
    }) as Host["run"],
  };
  if (adapter) await startTestBroker(host);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ workspaceRoot: root, host, ...(captureWaitMs !== undefined ? { captureWaitMs } : {}) }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  clients.push(client);
  const release = async () => {
    while (gates.length < 1) await new Promise((resolve) => setTimeout(resolve, 10));
    for (const gate of gates.splice(0)) gate();
  };
  return { root, exemplarDir, cacheDir, client, release };
}

type Reply = { state: string; job: string; place?: string; captureDir?: string; tours?: { id: string; label: string; outcome: string; frames: number }[]; frames?: { made: number; kept: number } };

describe("capture_exemplar", () => {
  it("captures the pack's place tours into its Exemplar Maps folder, with their 1000px frames", async () => {
    const { exemplarDir, client } = await setup();
    const reply = await client.callTool({ name: "capture_exemplar", arguments: {} });
    expect(reply.isError, text(reply)).toBeFalsy();

    expect(reply.structuredContent).toMatchObject({
      state: "done",
      captureDir: exemplarDir,
      tours: [{ id: "plaza", label: "places-Day", outcome: "done", frames: 2 }],
      frames: { made: 2, kept: 2 },
    });
    expect((await readdir(path.join(exemplarDir, "plaza/frames/places-Day"))).sort()).toEqual(["001.jpg", "002.jpg", "stops.txt"]);
    expect(text(reply)).toContain("find_places");
  });

  it("captures grid tours on request, and under the research archive when SC2_RESEARCH_DIR is set", async () => {
    const { exemplarDir, client } = await setup();
    const archive = await tempFolder();
    vi.stubEnv("SC2_RESEARCH_DIR", archive);
    const captureDir = path.join(archive, "docs/research/exemplar-maps");

    const reply = await client.callTool({ name: "capture_exemplar", arguments: { tours: "grid", ids: ["plaza"] } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect(reply.structuredContent).toMatchObject({ state: "done", captureDir, tours: [{ label: "Day", outcome: "done" }] });
    expect(existsSync(path.join(captureDir, "plaza/captures/Day/001.jpg"))).toBe(true);
    expect(existsSync(path.join(exemplarDir, "plaza/captures"))).toBe(false);
  });

  it("returns a job id when the wait runs out, and collects the tours with it once they are done", async () => {
    const { client, release } = await setup({ held: true, captureWaitMs: 300 });
    const first = await client.callTool({ name: "capture_exemplar", arguments: {} });
    expect(first.isError, text(first)).toBeFalsy();
    const waiting = first.structuredContent as Reply;
    expect(waiting).toMatchObject({ state: "waiting", place: "running" });
    expect(text(first)).toContain(`capture_exemplar({ job: "${waiting.job}" })`);
    // A second capture would take the same tours again.
    const second = await client.callTool({ name: "capture_exemplar", arguments: { tours: "grid" } });
    expect(second.isError).toBe(true);
    expect(text(second)).toContain(`Capture job ${waiting.job} is still going`);

    await release();
    const collected = await client.callTool({ name: "capture_exemplar", arguments: { job: waiting.job } });
    expect(collected.structuredContent).toMatchObject({ state: "done", job: waiting.job, tours: [{ label: "places-Day", outcome: "done", frames: 2 }] });

    // A rerun skips the tour that has frames.
    const again = await client.callTool({ name: "capture_exemplar", arguments: {} });
    expect(again.structuredContent).toMatchObject({ state: "done", tours: [{ label: "places-Day", outcome: "already captured" }] });
  });

  it("cancels a job by its id", async () => {
    const { exemplarDir, client } = await setup({ held: true, captureWaitMs: 300 });
    const first = (await client.callTool({ name: "capture_exemplar", arguments: {} })).structuredContent as Reply;
    const cancelled = await client.callTool({ name: "capture_exemplar", arguments: { job: first.job, cancel: true } });
    expect(cancelled.structuredContent).toMatchObject({ state: "cancelled", job: first.job });
    expect(existsSync(path.join(exemplarDir, "plaza/frames"))).toBe(false);
  });

  it("refuses a machine whose Host Adapter has no editor.captureTour, naming the setting", async () => {
    const { client } = await setup({ adapter: false });
    const reply = await client.callTool({ name: "capture_exemplar", arguments: {} });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("editor.captureTour");
    expect(text(reply)).toContain("hostAdapter");
  });

  it("refuses at once, with no job, what it can't plan, and a job it doesn't have", async () => {
    const { client } = await setup();
    const unknown = await client.callTool({ name: "capture_exemplar", arguments: { ids: ["harbour"] } });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain("no Exemplar Map harbour");
    expect(text(await client.callTool({ name: "capture_exemplar", arguments: { job: "nope" } }))).toContain("No capture job nope");
    expect((await client.callTool({ name: "capture_exemplar", arguments: { job: "nope", tours: "grid" } })).isError).toBe(true);
  });
});
