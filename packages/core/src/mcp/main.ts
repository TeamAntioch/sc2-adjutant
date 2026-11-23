#!/usr/bin/env node
// Serves a Workspace over MCP on stdio. The Workspace is the folder given as the first argument,
// or the current folder:
//
//   npm run build && node dist/mcp/main.js /path/to/workspace
//
// With --follow-roots it serves the Workspace at or above the client's working folder instead,
// asked at each call (follow-roots.ts), and the folder given is the one for a client with none:
//
//   node dist/mcp/main.js /path/to/workspace --follow-roots

// First, so that nothing any other module logs reaches stdout.
import "./stdio-console.js";

import { existsSync } from "node:fs";
import path from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { WORKSPACE_FILE } from "../plugins/workspace.js";
import { loadDoodadFinder } from "./find-doodads.js";
import { loadSetFinder } from "./find-sets.js";
import { loadOpenDoodadFinder } from "./open-doodad-finder.js";
import { createServer } from "./server.js";

const args = process.argv.slice(2);
const followRoots = args.includes("--follow-roots");
const workspaceRoot = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? process.cwd());
if (!existsSync(path.join(workspaceRoot, WORKSPACE_FILE))) {
  console.error(`${workspaceRoot} isn't a Workspace: it has no ${WORKSPACE_FILE}. Pass the Workspace folder as the first argument.`);
  process.exit(1);
}
// The machine's Host Adapter, from the machine config; a restart picks up changes to it.
const host = await loadMachineConfig()
  .then(loadHost)
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
// find_doodads and open_doodad_finder, when the doodad-finder package is installed (find-doodads.ts); find_sets, when the set-finder package is (find-sets.ts).
const [doodadFinder, openDoodadFinder, setFinder] = await Promise.all([loadDoodadFinder(), loadOpenDoodadFinder(), loadSetFinder()]);
await createServer({ workspaceRoot, host, followRoots, doodadFinder, openDoodadFinder, setFinder }).connect(new StdioServerTransport());
