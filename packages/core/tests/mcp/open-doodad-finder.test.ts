// open_doodad_finder through the MCP server (#666): registered only when the doodad-finder package
// is installed. The package's own tests drive the real tool with a fake launcher; here a
// stand-in shows what core does.
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadOpenDoodadFinder, type OpenDoodadFinderRequest, type OpenDoodadFinderTool } from "../../src/mcp/open-doodad-finder.js";
import { createServer } from "../../src/mcp/server.js";
import { connect, fixture, text } from "./harness.js";

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connectWith(openDoodadFinder: OpenDoodadFinderTool): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ workspaceRoot: fixture("crossing"), openDoodadFinder }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  clients.push(client);
  // Listed first, so the client checks each answer against the tool's output schema.
  await client.listTools();
  return client;
}

/** A tool that answers every call as a start, and keeps the requests. */
function standIn(): OpenDoodadFinderTool & { readonly requests: OpenDoodadFinderRequest[] } {
  const requests: OpenDoodadFinderRequest[] = [];
  return {
    requests,
    async open(request) {
      requests.push(request);
      return {
        action: "started",
        url: "http://127.0.0.1:4634/",
        ours: true,
        checks: [
          { name: "embeddings model", ok: true, note: "Xenova/gte-small is cached" },
          { name: "Jev", ok: false, note: "TYPESAFE_API_KEY isn't set, so Jev will be off" },
        ],
        rankers: { on: [], off: [{ ranker: "jev", reason: "no TypeSafe key" }] },
        opened: "app",
        notes: [],
        pidFile: "/w/output/doodad-finder/finder.json",
        logFile: "/w/output/doodad-finder/finder.log",
      };
    },
  };
}

describe("open_doodad_finder", () => {
  it("isn't served without the doodad-finder package", async () => {
    const client = await connect(fixture("crossing"));
    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name)).not.toContain("open_doodad_finder");
  });

  it("is served when the package is loaded, with the Workspace's root and the defaults", async () => {
    const tool = standIn();
    const client = await connectWith(tool);
    const reply = await client.callTool({ name: "open_doodad_finder", arguments: { window: "app" } });
    expect(reply.isError).toBeFalsy();
    expect(tool.requests).toEqual([{ workspaceRoot: fixture("crossing"), window: "app", stop: false }]);
    expect(reply.structuredContent).toMatchObject({ action: "started", url: "http://127.0.0.1:4634/", rankers: { on: [] } });
    expect(text(reply)).toMatch(/^Started the Doodad Finder at http:\/\/127\.0\.0\.1:4634\/, opened in a Chrome app window\./);
    expect(text(reply)).toContain("Ranker jev is off: no TypeSafe key.");
    expect(text(reply)).toContain("- Jev: not yet: TYPESAFE_API_KEY isn't set");
  });

  it("reports a start that fails as an error", async () => {
    const client = await connectWith({
      async open() {
        throw new Error("The Doodad Finder didn't answer on port 4634 within 120 s.");
      },
    });
    const reply = await client.callTool({ name: "open_doodad_finder", arguments: {} });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("didn't answer on port 4634");
  });
});

describe("loadOpenDoodadFinder", () => {
  it("gives nothing, and says nothing, when the package isn't installed", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadOpenDoodadFinder(pathToFileURL(path.resolve("/nowhere/doodad-finder/src/open-doodad-finder.ts")))).toBeUndefined();
    expect(said).not.toHaveBeenCalled();
    said.mockRestore();
  });
});
