#!/usr/bin/env node
// Prints, as JSON, where this install of sc2-adjutant stands against the newest release: the
// plugin's version and how it was installed, the Workspace's core and its sc2-adjutant packages,
// the latest version on npm (asked afresh, not from the cache) and the commands that update what's
// behind. See ../../../server/versions.mjs.
//
//   node status.mjs [--core <core_path>]
//
// Run it in the Workspace. --core is the plugin's core_path option, when the author set one.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { expanded, findWorkspace } from "../../../server/resolve.mjs";
import { checkForUpdate } from "../../../server/versions.mjs";

const pluginRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const { values } = parseArgs({ options: { core: { type: "string" } } });
const workspace = findWorkspace(expanded(process.env.CLAUDE_PROJECT_DIR) ?? process.cwd());
const coreSetting = expanded(values.core) ?? expanded(process.env.SC2_ADJUTANT_CORE);
const status = await checkForUpdate({ pluginRoot, workspace, coreSetting, fresh: true });
console.log(JSON.stringify(status, null, 2));
if (status.latest === undefined) {
  console.error("Couldn't reach npm to find the latest release (https://registry.npmjs.org).");
  process.exitCode = 1;
}
