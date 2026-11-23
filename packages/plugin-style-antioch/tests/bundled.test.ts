// The Antioch Style Pack as a Workspace names it: bundled:style-antioch, the package core resolves
// beside itself, through the MCP server.
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { bareHost } from "@team-antioch/sc2-adjutant/src/host/host.js";
import { createServer } from "@team-antioch/sc2-adjutant/src/mcp/server.js";
import { afterEach, describe, expect, it } from "vitest";

const PACK = realpathSync(fileURLToPath(new URL("..", import.meta.url)));

const clients: Client[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A client connected to a server for a Workspace whose Style Pack is `bundled:style-antioch`. */
async function connect(): Promise<Client> {
  const root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-style-"));
  folders.push(root);
  await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixtures" }, stylePack: "bundled:style-antioch" }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ workspaceRoot: root, host: bareHost() }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

describe("bundled:style-antioch", () => {
  it("loads the package as the Workspace's Style Pack", async () => {
    const client = await connect();
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(reply.isError).toBeFalsy();
    const { plugins } = reply.structuredContent as { plugins: { name: string; source: string; roles: string[]; contributions: { styleRules: string[] } }[] };
    expect(plugins).toEqual([expect.objectContaining({ name: "style-antioch", source: "bundled:style-antioch", roles: ["style-pack"] })]);
    expect(plugins[0]!.contributions.styleRules.length).toBeGreaterThan(0);
  });

  it("serves its knowledge from the package's folder", async () => {
    const client = await connect();
    const { contents } = await client.readResource({ uri: "sc2-adjutant://plugins/style-antioch/knowledge/guide" });
    expect(contents).toEqual([expect.objectContaining({ text: await readFile(path.join(PACK, "knowledge", "GUIDE.md"), "utf8") })]);
  });
});
