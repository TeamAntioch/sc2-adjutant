// find_sets (src/find-sets.ts, #726, #802) through core's MCP server, with made-up sets laid over
// made-up published ones, a fake embedder and a fake Jev: the package is installed, its results
// are the sets best first with their looks and pictures to read, and rank false makes no call. No
// call here reaches the network.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type FoundSets, loadSetFinder, type SetFinderTool } from "@team-antioch/sc2-adjutant/dist/mcp/find-sets.js";
import { createServer } from "@team-antioch/sc2-adjutant/dist/mcp/server.js";
import { afterEach, describe, expect, it } from "vitest";

import type { Ranker } from "@team-antioch/sc2-finder-kit/ranker.js";
import { openSetFinder, type SetCard } from "@team-antioch/sc2-set-finder";

import { createFindSets } from "../src/find-sets.ts";
import { adjutantSetCards } from "../src/sets.ts";
import { fakeEmbedder } from "./fake-embedder.ts";
import { drawnSets, PUBLISHED } from "./fixtures.ts";

const CROSSING = fileURLToPath(new URL("../../core/tests/fixtures/workspaces/crossing/", import.meta.url));

const clients: Client[] = [];
const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function connect(setFinder: SetFinderTool | undefined): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ workspaceRoot: CROSSING, setFinder }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  clients.push(client);
  // Listed first, so the client checks each answer against the tool's output schema.
  await client.listTools();
  return client;
}

/** The tool over the made-up sets, with a Jev that says the bridge reads as exactly this. */
async function tool() {
  const drawn = await drawnSets();
  closing.push(drawn.close);
  const asked: string[] = [];
  let opened = 0;
  const roots: (string | undefined)[] = [];
  const ranker: Ranker<SetCard> = {
    name: "jev",
    async rank({ ask, candidates }) {
      asked.push(ask);
      return { ranker: "jev", model: "jev-test", grades: new Map(candidates.map((card) => [card.id, { level: card.id === "ship-bridge" ? 3 : card.id === "dive-bar" ? 2 : 0.5 }])), timings: { request: 2, total: 2 }, usage: { input: 1, output: 1 }, cost: 0.001 };
    },
  };
  const found = createFindSets({
    open: async (workspaceRoot) => {
      opened++;
      roots.push(workspaceRoot);
      const { cards, looks } = await adjutantSetCards({ viewsDir: drawn.viewsDir, looksFile: drawn.looksFile, catalogFile: drawn.catalogFile, workspaceRoot: drawn.workspaceRoot, published: PUBLISHED });
      const finder = await openSetFinder({ cards, embedder: fakeEmbedder(), cacheFile: path.join(drawn.dir, "vectors.json"), ranker });
      return { finder, viewsDir: drawn.viewsDir, looks };
    },
  });
  return { found, asked, opened: () => opened, roots, viewsDir: drawn.viewsDir, looksFile: drawn.looksFile };
}

const call = async (client: Client, args: Record<string, unknown>) => {
  const reply = await client.callTool({ name: "find_sets", arguments: args });
  expect(reply.isError, JSON.stringify(reply.content)).toBeFalsy();
  return { found: reply.structuredContent as unknown as FoundSets, text: (reply.content as { text: string }[])[0]!.text };
};

describe("find_sets", () => {
  it("is served when the package is installed, and not without it", async () => {
    const loaded = await loadSetFinder();
    expect(loaded).toBeDefined();
    expect((await (await connect(loaded)).listTools()).tools.map(({ name }) => name)).toContain("find_sets");
    expect((await (await connect(undefined)).listTools()).tools.map(({ name }) => name)).not.toContain("find_sets");
  });

  it("gives published and private sets in Jev's order, each with its look, level and pictures to read", async () => {
    const { found, asked, opened, viewsDir } = await tool();
    const client = await connect(found);
    const { found: result, text } = await call(client, { ask: "somewhere to fly a ship from", count: 2 });
    expect(asked).toEqual(["somewhere to fly a ship from"]);
    expect(result.ranker).toBe("jev");
    expect(result.narrowed).toBe(4);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      id: "ship-bridge",
      name: "Ship Bridge",
      kind: "room",
      level: 3,
      source: "Blizzard campaign, studio",
      cameras: 2,
      pictures: [{ path: path.join(viewsDir, "ship-bridge/card/1.jpg"), shows: "the whole place", inGame: path.join(viewsDir, "ship-bridge/card/1-game.jpg") }],
    });
    // A published set: its own look, and its picture as drawn on this machine.
    expect(result.results[1]).toMatchObject({ id: "dive-bar", source: "Blizzard campaign", level: 2, look: expect.stringMatching(/^The published look/), pictures: [{ path: path.join(viewsDir, "dive-bar/card/1.jpg") }] });
    expect(result.results[0]).not.toHaveProperty("keyword");
    expect(result.cost).toBe(0.001);
    expect(text).toMatch(/^Ranked by jev: 2 of 4 narrowed, estimated \$0\.0010/);
    expect(text).toContain("level 3 ship-bridge: Ship Bridge (room; Blizzard campaign, studio; 8 by 13 cells, 4 high; 2 cameras)");
    expect(text).toContain(`picture: ${path.join(viewsDir, "ship-bridge/card/1.jpg")} (the whole place); in game: ${path.join(viewsDir, "ship-bridge/card/1-game.jpg")}`);

    // The finder stays open, and the spend adds up.
    const again = await call(client, { ask: "a pub" });
    expect(opened()).toBe(1);
    expect(again.found.spend).toBeCloseTo(0.002);
  });

  it("opens the cards for the call's Workspace, and again when another is asked for", async () => {
    const { found, opened, roots } = await tool();
    await call(await connect(found), { ask: "a pub", rank: false });
    expect(roots.map((root) => root && path.resolve(root))).toEqual([path.resolve(CROSSING)]);
    await found.find({ workspaceRoot: CROSSING, ask: "a pub", count: 1, rank: false });
    expect(opened()).toBe(1);
    await found.find({ ask: "a pub", count: 1, rank: false });
    expect(roots.at(-1)).toBeUndefined();
    expect(opened()).toBe(2);
  });

  it("gives the gallery's address for a published set's picture this machine hasn't drawn", async () => {
    const { found, viewsDir } = await tool();
    const { rm } = await import("node:fs/promises");
    await rm(path.join(viewsDir, "dive-bar"), { recursive: true });
    const { found: result } = await call(await connect(found), { ask: "a grubby bar", rank: false });
    const bar = result.results.find((set) => set.id === "dive-bar")!;
    expect(bar.pictures[0]!.path).toMatch(/^https:\/\/.*\/dive-bar\/card\/1\.jpg$/);
  });

  it("gives the gallery's address for a published set's picture this checkout has since re-chosen", async () => {
    const { found, viewsDir, looksFile } = await tool();
    const { readFile, writeFile } = await import("node:fs/promises");
    const looks = JSON.parse(await readFile(looksFile, "utf8"));
    looks["dive-bar"].pictures = [{ file: "card/1.jpg", shows: "the back corner by the door" }];
    await writeFile(looksFile, JSON.stringify(looks));
    const { found: result } = await call(await connect(found), { ask: "a grubby bar", rank: false });
    const bar = result.results.find((set) => set.id === "dive-bar")!;
    expect(bar.pictures[0]).toMatchObject({ shows: "the whole place", path: expect.stringMatching(/^https:\/\/.*\/dive-bar\/card\/1\.jpg$/) });
    expect(bar.pictures[0]!.path).not.toContain(viewsDir);
  });

  it("gives the narrowing's order with rank false, without calling Jev", async () => {
    const { found, asked } = await tool();
    const { found: result, text } = await call(await connect(found), { ask: "a pub", rank: false });
    expect(asked).toEqual([]);
    expect(result.ranker).toBeUndefined();
    expect(result.rankerOff).toMatch(/rank: false/);
    expect(result.results[0]!.id).toBe("dive-bar");
    expect(result.results[0]!.level).toBeUndefined();
    expect(text).toMatch(/^The narrowing's order, unranked: rank: false/);
  });
});
