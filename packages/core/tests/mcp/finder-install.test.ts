// The Finder wrappers from an npm install (#843): core finds each by its package name, from where
// Node resolves it beside core under node_modules/@team-antioch/, and the server then serves
// find_doodads, open_doodad_finder and find_sets. A scratch folder stands in for the install:
// core's module path inside it, and stand-in wrapper packages whose entries make fake tools.
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { DOODAD_FINDER_PACKAGE, finderEntry, loadDoodadFinder } from "../../src/mcp/find-doodads.js";
import { loadSetFinder, SET_FINDER_PACKAGE } from "../../src/mcp/find-sets.js";
import { loadOpenDoodadFinder } from "../../src/mcp/open-doodad-finder.js";
import { createServer } from "../../src/mcp/server.js";
import { fixture, tempFolder } from "./harness.js";

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

/** A Workspace's node_modules/@team-antioch, with core's MCP module path in it and each wrapper `installed` as a stand-in package. */
async function install(installed: readonly string[]) {
  // The real path, as Node resolves a package to it (macOS's temporary folder is a link).
  const scope = path.join(await realpath(await tempFolder()), "node_modules", "@team-antioch");
  const core = path.join(scope, "sc2-adjutant", "dist", "mcp");
  await mkdir(core, { recursive: true });
  const from = path.join(core, "find-doodads.js");
  await writeFile(from, "export {};\n");
  const stub = async (name: string, files: Record<string, string>) => {
    const folder = path.join(scope, name.replace("@team-antioch/", ""));
    await mkdir(path.join(folder, "dist"), { recursive: true });
    await writeFile(path.join(folder, "package.json"), JSON.stringify({ name, version: "0.1.0", type: "module" }));
    for (const [file, body] of Object.entries(files)) await writeFile(path.join(folder, "dist", file), body);
  };
  if (installed.includes(DOODAD_FINDER_PACKAGE))
    await stub(DOODAD_FINDER_PACKAGE, {
      "find-doodads.js": "export const createFindDoodads = () => ({ find: async () => ({ results: [], narrowed: 0, timings: { narrow: 0, rank: 0, total: 0 }, cost: 0, spend: 0 }) });\n",
      "open-doodad-finder.js": "export const createOpenDoodadFinder = () => ({ open: async () => { throw new Error('not called'); } });\n",
    });
  if (installed.includes(SET_FINDER_PACKAGE))
    await stub(SET_FINDER_PACKAGE, { "find-sets.js": "export const createFindSets = () => ({ find: async () => ({ results: [], narrowed: 0, timings: { narrow: 0, rank: 0, total: 0 }, cost: 0, spend: 0 }) });\n" });
  return { scope, from: pathToFileURL(from) };
}

async function toolNames(from: URL): Promise<string[]> {
  const doodads = finderEntry(DOODAD_FINDER_PACKAGE, "doodad-finder", "dist/find-doodads.js", from);
  const sets = finderEntry(SET_FINDER_PACKAGE, "set-finder", "dist/find-sets.js", from);
  // A loader given no entry loads the server's own, so a package not found here isn't loaded at all.
  const [doodadFinder, openDoodadFinder, setFinder] = await Promise.all([
    doodads && loadDoodadFinder(doodads),
    doodads && loadOpenDoodadFinder(new URL("open-doodad-finder.js", doodads)),
    sets && loadSetFinder(sets),
  ]);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ workspaceRoot: fixture("crossing"), doodadFinder, openDoodadFinder, setFinder }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  clients.push(client);
  return (await client.listTools()).tools.map((tool) => tool.name);
}

describe("the Finder wrappers from an npm install", () => {
  it("are found by package name beside core, and their tools served", async () => {
    const { scope, from } = await install([DOODAD_FINDER_PACKAGE, SET_FINDER_PACKAGE]);
    const entry = finderEntry(SET_FINDER_PACKAGE, "set-finder", "dist/find-sets.js", from);
    expect(entry && path.relative(scope, fileURLToPath(entry)).split(path.sep).join("/")).toBe("sc2-adjutant-set-finder/dist/find-sets.js");
    expect(await toolNames(from)).toEqual(expect.arrayContaining(["find_doodads", "open_doodad_finder", "find_sets"]));
  });

  it("aren't looked for beside core's folder when core is installed and they aren't", async () => {
    const { from } = await install([]);
    expect(finderEntry(DOODAD_FINDER_PACKAGE, "doodad-finder", "dist/find-doodads.js", from)).toBeUndefined();
    const names = await toolNames(from);
    for (const tool of ["find_doodads", "open_doodad_finder", "find_sets"]) expect(names).not.toContain(tool);
  });

  it("fall back to the package folder beside core's in a checkout with no workspace link", async () => {
    const checkout = await tempFolder();
    const from = path.join(checkout, "packages", "core", "dist", "mcp", "find-doodads.js");
    const entry = finderEntry("@team-antioch/a-package-never-installed", "doodad-finder", "dist/find-doodads.js", pathToFileURL(from));
    expect(entry && fileURLToPath(entry)).toBe(path.join(checkout, "packages", "doodad-finder", "dist", "find-doodads.js"));
  });
});
