// find_doodads through the MCP server (#665): registered only when the doodad-finder package is
// installed. The package's own tests call the real tool; here a stand-in shows what core does.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { type DoodadFinderTool, type FindDoodadsRequest, loadDoodadFinder } from "../../src/mcp/find-doodads.js";
import { createServer } from "../../src/mcp/server.js";
import { connect, fixture, tempFolder, text } from "./harness.js";

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connectWith(doodadFinder: DoodadFinderTool): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ workspaceRoot: fixture("crossing"), doodadFinder }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

/** A Doodad Finder that answers every ask with one ranked result, and keeps the requests. */
function standIn(): DoodadFinderTool & { readonly requests: FindDoodadsRequest[] } {
  const requests: FindDoodadsRequest[] = [];
  return {
    requests,
    async find(request) {
      requests.push(request);
      return {
        results: [{ id: "PortZionCrusherDoodad", name: "Crusher Doodad", source: "doodad", uses: [], variations: 1, picture: { kind: "none" }, hasRenders: false, level: 2.8 }],
        ranker: "jev",
        narrowed: 1,
        timings: { narrow: 4, rank: 210, total: 220 },
        cost: 0.0004,
        spend: 0.0004,
      };
    },
  };
}

describe("find_doodads", () => {
  it("isn't served without the doodad-finder package", async () => {
    const client = await connect(fixture("crossing"));
    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).toContain("search_doodads");
    expect(tools.map(({ name }) => name)).not.toContain("find_doodads");
  });

  it("is served when the package is loaded, with the defaults filled in and the Workspace's root", async () => {
    const finder = standIn();
    const client = await connectWith(finder);
    const reply = await client.callTool({ name: "find_doodads", arguments: { ask: "industrial press head", tags: [{ facet: "story", value: "industry", pinned: true }] } });
    expect(reply.isError).toBeFalsy();
    expect(finder.requests).toEqual([{ workspaceRoot: fixture("crossing"), ask: "industrial press head", tags: [{ facet: "story", value: "industry", pinned: true }], count: 20, rank: true }]);
    expect(reply.structuredContent).toMatchObject({ ranker: "jev", narrowed: 1, results: [{ id: "PortZionCrusherDoodad", level: 2.8 }] });
    expect(text(reply)).toMatch(/^Ranked by jev: 1 of 1 narrowed, estimated \$0\.0004/);
    expect(text(reply)).toContain('level 2.8 PortZionCrusherDoodad "Crusher Doodad"');
  });

  it("says why there was no ranking", async () => {
    const finder: DoodadFinderTool = {
      async find() {
        const ranked = await standIn().find({ workspaceRoot: "", ask: "", count: 20, rank: true });
        const { level: _level, ...result } = ranked.results[0]!;
        return { ...ranked, results: [result], ranker: undefined, rankerOff: "no TypeSafe key", cost: 0, spend: 0 };
      },
    };
    const client = await connectWith(finder);
    const reply = await client.callTool({ name: "find_doodads", arguments: { ask: "crusher" } });
    expect(text(reply)).toMatch(/^The narrowing's order, unranked: no TypeSafe key\./);
  });
});

describe("loadDoodadFinder", () => {
  /** A doodad-finder package folder whose built entry is `body`, stamped as built when `stamped`. */
  async function finderPackage(body: string, stamped = true) {
    const folder = await tempFolder();
    await mkdir(path.join(folder, "dist"), { recursive: true });
    await writeFile(path.join(folder, "package.json"), "{}");
    await mkdir(path.join(folder, "src"), { recursive: true });
    await writeFile(path.join(folder, "src", "find-doodads.ts"), "export {};\n");
    const entry = path.join(folder, "dist", "find-doodads.mjs");
    await writeFile(entry, body);
    if (stamped) await writeFile(path.join(folder, "dist", ".built"), "");
    return { folder, entry };
  }

  it("gives nothing, and says nothing, when the package isn't installed", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadDoodadFinder(pathToFileURL(path.resolve("/nowhere/doodad-finder/dist/find-doodads.js")))).toBeUndefined();
    expect(said).not.toHaveBeenCalled();
    said.mockRestore();
  });

  it("says why when the package is there but one of its imports isn't (no npm install)", async () => {
    const { entry } = await finderPackage('import "a-package-never-installed";\nexport const createFindDoodads = () => ({});\n');
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadDoodadFinder(pathToFileURL(entry))).toBeUndefined();
    expect(said).toHaveBeenCalledWith(expect.stringMatching(/the Doodad Finder didn't load, so find_doodads is off: .*a-package-never-installed/));
    said.mockRestore();
  });

  it("says to build the package when it is there but its dist isn't", async () => {
    const { folder } = await finderPackage("export const createFindDoodads = () => ({});\n");
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadDoodadFinder(pathToFileURL(path.join(folder, "dist", "missing.mjs")))).toBeUndefined();
    expect(said).toHaveBeenCalledWith("sc2-adjutant: the Doodad Finder isn't built, so find_doodads is off: its entry point dist/missing.mjs isn't there: build its package first (npm run build)");
    said.mockRestore();
  });

  it("says to rebuild when its source changed since the last build", async () => {
    const { folder, entry } = await finderPackage("export const createFindDoodads = () => ({});\n");
    const past = new Date(Date.now() - 60_000);
    await utimes(path.join(folder, "dist", ".built"), past, past);
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadDoodadFinder(pathToFileURL(entry))).toBeUndefined();
    expect(said).toHaveBeenCalledWith(expect.stringContaining("isn't built, so find_doodads is off: its dist/ is older than its source (src/find-doodads.ts changed since the last build)"));
    said.mockRestore();
  });

  it("loads a built, stamped package", async () => {
    const { entry } = await finderPackage("export const createFindDoodads = () => ({ find: async () => ({}) });\n");
    expect(await loadDoodadFinder(pathToFileURL(entry))).toMatchObject({ find: expect.any(Function) });
  });
});
