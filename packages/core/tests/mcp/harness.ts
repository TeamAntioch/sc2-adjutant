// The MCP server started in-process over the SDK's in-memory transport, against fixture
// Workspaces, for the Seam 1 tests (#96). Clients and temporary folders are cleaned up after each test.
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import { afterEach } from "vitest";

import type { Host } from "../../src/host/host.js";
import { emptyMachineConfig } from "../../src/host/machine-config.js";
import { createServer, type ServerOptions } from "../../src/mcp/server.js";

export const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/workspaces/${name}/`, import.meta.url));

const clients: Client[] = [];
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

export type ConnectOptions = {
  /** The server follows the client's roots (follow-roots.ts). */
  readonly followRoots?: boolean;
  /**
   * The folders the client lists as its roots, asked at each `roots/list`; it may throw. Without
   * it the client declares no roots capability.
   */
  readonly roots?: () => readonly string[];
};

/** A client connected to a server for the Workspace at `root`. */
export async function connect(root: string, { followRoots, roots }: ConnectOptions = {}): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ workspaceRoot: root, ...(followRoots ? { followRoots } : {}) }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" }, roots ? { capabilities: { roots: { listChanged: true } } } : {});
  if (roots) client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: roots().map((folder) => ({ uri: pathToFileURL(folder).href })) }));
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

/** An empty temporary folder, removed after the test. */
export async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-mcp-"));
  folders.push(folder);
  return folder;
}

/** A copy of a fixture Workspace in a temporary folder, for tools that write into it. */
export async function copyOf(name: string): Promise<string> {
  const root = await tempFolder();
  await cp(fixture(name), root, { recursive: true });
  return root;
}

/** A machine whose Host Adapter can do everything. */
export const capableHost: Host = {
  machine: emptyMachineConfig(),
  adapter: undefined,
  has: () => true,
  run: () => Promise.reject(new Error("not called")) as never,
};

/** Server options that list every tool: a Host that can do everything, both Doodad Finder tools and the Set Finder's. */
export const everyTool: Partial<ServerOptions> = {
  host: capableHost,
  doodadFinder: { find: () => Promise.reject(new Error("not called")) },
  openDoodadFinder: { open: () => Promise.reject(new Error("not called")) },
  setFinder: { find: () => Promise.reject(new Error("not called")) },
};

/** The tools a server for the crossing fixture lists with `options`, sorted by name. */
export async function listTools(options: Partial<ServerOptions>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ workspaceRoot: fixture("crossing"), ...options }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  clients.push(client);
  const { tools } = await client.listTools();
  // Through JSON, as a client receives them: fields left undefined drop out.
  return (JSON.parse(JSON.stringify(tools)) as typeof tools).sort((a, b) => a.name.localeCompare(b.name));
}

/** The text of a tool reply. */
export const text = (reply: Awaited<ReturnType<Client["callTool"]>>) =>
  (reply.content as { type: string; text?: string }[]).map((part) => part.text ?? "").join("\n");
