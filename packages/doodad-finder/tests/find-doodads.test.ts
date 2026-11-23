// find_doodads (src/find-doodads.ts, #665) through core's MCP server, on core's fixture Workspace,
// with a fake embedder and a fake Jev: the package is installed, its results are
// search_doodads' with Jev's level, rank false makes no call, and with no TypeSafe key it gives the
// narrowing and says why. No call here reaches the network.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type DoodadFinderTool, type FoundDoodads, loadDoodadFinder } from "@team-antioch/sc2-adjutant/dist/mcp/find-doodads.js";
import { createServer } from "@team-antioch/sc2-adjutant/dist/mcp/server.js";
import { afterEach, describe, expect, it } from "vitest";

import { NO_JEV_KEY, openRanker } from "@team-antioch/sc2-doodad-finder/credentials.js";

import { EMPTY_CONFIG_DIR } from "./no-saved-key.ts";
import { createFindDoodads, type FindDoodadsOptions } from "../src/find-doodads.ts";
import type { RankRequest, Ranker } from "@team-antioch/sc2-doodad-finder/ranker.js";
import { fakeEmbedder } from "./fake-embedder.ts";

const CROSSING = fileURLToPath(new URL("../../core/tests/fixtures/workspaces/crossing/", import.meta.url));
const VOID_CAMPAIGN = "bnet:Void (Campaign)/0.0/999,file:Campaigns/Void.SC2Campaign";

const clients: Client[] = [];
const folders: string[] = [];
const tools: { close(): void }[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  for (const tool of tools.splice(0)) tool.close();
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function connect(doodadFinder: DoodadFinderTool | undefined): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ workspaceRoot: CROSSING, doodadFinder }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  clients.push(client);
  // Listed first, so the client checks each answer against the tool's output schema.
  await client.listTools();
  return client;
}

/** A Jev stand-in: a crusher reads as exactly this, a press could work, the rest don't fit. It keeps each request. */
function fakeJev(): Ranker & { readonly requests: RankRequest[] } {
  const requests: RankRequest[] = [];
  return {
    name: "jev",
    requests,
    async rank(request) {
      requests.push(request);
      const level = (text: string) => (/crusher/i.test(text) ? 3 : /press/i.test(text) ? 2 : 0);
      return {
        ranker: "jev",
        model: "jev-test",
        grades: new Map(request.candidates.map((card) => [card.id, { level: level(card.text) }])),
        timings: { request: 5, total: 6 },
        usage: { input: 10_000, output: 0 },
        cost: 0.00042,
      };
    },
  };
}

/** The tool with fakes, its vectors in a temporary folder; counting how often the model and the ranker are opened. */
async function tool(options: Partial<FindDoodadsOptions> = {}) {
  const folder = await mkdtemp(path.join(tmpdir(), "find-doodads-"));
  folders.push(folder);
  const embedder = fakeEmbedder();
  const jev = fakeJev();
  const opened = { embedder: 0, ranker: 0 };
  const found = createFindDoodads({
    embedder: async () => (opened.embedder++, embedder),
    ranker: async () => (opened.ranker++, { ranker: jev }),
    cacheFile: () => path.join(folder, "vectors.bin"),
    ...options,
  });
  tools.push(found);
  return { found, embedder, jev, opened };
}

const call = async (client: Client, args: Record<string, unknown>) => {
  const reply = await client.callTool({ name: "find_doodads", arguments: args });
  expect(reply.isError, JSON.stringify(reply.content)).toBeFalsy();
  return { found: reply.structuredContent as unknown as FoundDoodads, text: (reply.content as { text: string }[])[0]!.text };
};

describe("find_doodads", () => {
  it("is served when the package is installed", async () => {
    const loaded = await loadDoodadFinder();
    expect(loaded).toBeDefined();
    const { tools: listed } = await (await connect(loaded)).listTools();
    expect(listed.map(({ name }) => name)).toContain("find_doodads");
  });

  it("gives search_doodads' results in Jev's order, each with its level, and the narrowing's size, timings and spend", async () => {
    const { found, jev } = await tool();
    const client = await connect(found);
    const { found: result, text } = await call(client, { ask: "crusher press", count: 5 });
    expect(jev.requests).toHaveLength(1);
    expect(jev.requests[0]!.ask).toBe("crusher press");
    expect(result.ranker).toBe("jev");
    expect(result.narrowed).toBe(jev.requests[0]!.candidates.length);
    expect(result.narrowed).toBeGreaterThan(5);
    expect(result.results).toHaveLength(5);
    expect(result.results[0]).toMatchObject({ id: "PortZionCrusherDoodad", name: "Crusher Doodad", source: "doodad", level: 3 });
    expect(result.results[0]).toHaveProperty("picture.kind");
    expect(typeof result.results[0]!.hasRenders).toBe("boolean");
    expect(result.results[0]).not.toHaveProperty("score");
    const levels = result.results.map(({ level }) => level!);
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
    expect(result.cost).toBe(0.00042);
    expect(result.spend).toBe(0.00042);
    expect(result.timings.total).toBeGreaterThanOrEqual(result.timings.narrow);
    expect(text).toMatch(/^Ranked by jev: 5 of \d+ narrowed, estimated \$0\.0004 \(\$0\.0004 since the server started\)/);

    // The second call finds the model, cards and vectors loaded, and adds to the spend.
    const again = await call(client, { ask: "crusher press" });
    expect(again.found.results).toHaveLength(20);
    expect(again.found.spend).toBe(0.00084);
  });

  it("loads the model, cards and vectors on the first call and keeps them", async () => {
    const { found, embedder, opened } = await tool();
    const client = await connect(found);
    expect(opened.embedder).toBe(0);
    await call(client, { ask: "crusher", rank: false });
    const embeddedOnOpen = embedder.calls.flat().length;
    await call(client, { ask: "conveyor belt", rank: false });
    expect(opened.embedder).toBe(1);
    // Only the second ask was embedded: the cards were already.
    expect(embedder.calls.flat().length).toBe(embeddedOnOpen + 1);
  });

  it("with rank false gives the narrowing's order and makes no call", async () => {
    const { found, jev, opened } = await tool();
    const { found: result, text } = await call(await connect(found), { ask: "crusher press", rank: false });
    expect(opened.ranker).toBe(0);
    expect(jev.requests).toHaveLength(0);
    expect(result.ranker).toBeUndefined();
    expect(result.rankerOff).toMatch(/rank: false/);
    expect(result.cost).toBe(0);
    expect(result.results.every(({ level }) => level === undefined)).toBe(true);
    expect(result.results.map(({ id }) => id)).toContain("PortZionCrusherDoodad");
    expect(text).toMatch(/^The narrowing's order, unranked: /);
  });

  it("with no TypeSafe key gives the narrowing and says why", async () => {
    const { found } = await tool({ ranker: async () => openRanker({ env: { SC2_ASSET_CATALOG_CONFIG: EMPTY_CONFIG_DIR } }) });
    const { found: result } = await call(await connect(found), { ask: "crusher press" });
    expect(result.ranker).toBeUndefined();
    expect(result.rankerOff).toBe(NO_JEV_KEY);
    expect(result.results.map(({ id }) => id)).toContain("PortZionCrusherDoodad");
  });

  it("looks for the TypeSafe key again on each call while Jev is off, so a key set meanwhile is used", async () => {
    const jev = fakeJev();
    let stored = false;
    const { found } = await tool({ ranker: async () => (stored ? { ranker: jev } : { off: NO_JEV_KEY }) });
    const client = await connect(found);
    expect((await call(client, { ask: "crusher press" })).found.rankerOff).toBe(NO_JEV_KEY);
    stored = true;
    expect((await call(client, { ask: "crusher press" })).found.ranker).toBe("jev");
  });

  it("passes the call's signal to Jev, so a cancelled call stops its request", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const jev: Ranker = { name: "jev", rank: async (request, options) => (signals.push(options?.signal), fakeJev().rank(request)) };
    const { found } = await tool({ ranker: async () => ({ ranker: jev }) });
    const controller = new AbortController();
    await found.find({ workspaceRoot: CROSSING, ask: "crusher press", count: 5, rank: true }, { signal: controller.signal });
    expect(signals).toEqual([controller.signal]);
  });

  it("when Jev fails, gives the narrowing and the error", async () => {
    const failing: Ranker = { name: "jev", rank: async () => Promise.reject(new Error("jev: the request failed: 503")) };
    const { found } = await tool({ ranker: async () => ({ ranker: failing }) });
    const { found: result } = await call(await connect(found), { ask: "crusher press" });
    expect(result.ranker).toBeUndefined();
    expect(result.rankerOff).toContain("jev: the request failed: 503");
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("marks for a Mission what its dependencies provide, and sends the tags to Jev", async () => {
    const { found, jev } = await tool();
    const tags = [{ facet: "story", value: "industry" }];
    const { found: result } = await call(await connect(found), { ask: "crusher press", mission: "ashen-crossing", tags, count: 200 });
    expect(jev.requests[0]!.tags).toEqual(tags);
    expect(result.results.find(({ id }) => id === "PortZionCrusherDoodad")).toMatchObject({ provided: true });
    expect(result.results.find(({ id }) => id === "PortZionGridFloorCompactorDoodad")).toMatchObject({ dependency: VOID_CAMPAIGN, provided: false });
  });
});
