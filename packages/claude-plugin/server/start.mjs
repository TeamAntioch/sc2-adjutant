#!/usr/bin/env node
// Starts sc2-adjutant's MCP server for the project Claude Code has open. The plugin's MCP config runs
//
//   node ${CLAUDE_PLUGIN_ROOT}/server/start.mjs ${CLAUDE_PROJECT_DIR}
//
// It finds the Workspace and core (see resolve.mjs), warns when core is from a different release than
// the plugin, then runs core's server in this process.
// The Workspace found from the project folder is where the server starts; core's server then
// follows the session's working folder (--follow-roots), so a session that enters a git worktree
// serves that worktree's Workspace. Claude Code launches the server in the folder it was opened in
// and never changes CLAUDE_PROJECT_DIR, so only the client's roots tell the server where the session is.
// Stdout carries the MCP protocol, so everything said here goes to stderr.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expanded, findCore, findWorkspace, pluginVersion, versionWarning, WORKSPACE_FILE } from "./resolve.mjs";

const pluginRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const project = expanded(process.argv[2]) ?? expanded(process.env.CLAUDE_PROJECT_DIR) ?? process.cwd();

const fail = (lines) => {
  console.error(["sc2-adjutant: the MCP server didn't start.", ...lines].join("\n"));
  process.exit(1);
};

const workspace = findWorkspace(project);
if (!workspace) {
  fail([`${path.resolve(project)} isn't in a Workspace: no ${WORKSPACE_FILE} in it or any folder above it.`, "Make one here with /sc2-adjutant:init, or open Claude Code in a Workspace folder. From a terminal, npx @team-antioch/sc2-adjutant init <folder> makes one too."]);
}

const core = findCore({ coreSetting: process.env.SC2_ADJUTANT_CORE, workspace, pluginRoot });
if (!core.entry) {
  fail([
    "Couldn't find sc2-adjutant core. Looked in:",
    ...core.tried.map((place) => `- ${place}`),
    "Run npm install in the Workspace folder, which installs core there. To use a checkout of https://github.com/TeamAntioch/sc2-adjutant instead, set the plugin's core_path option to it (/plugin configure sc2-adjutant@sc2-adjutant).",
    "The install page has the rest: https://adjutant.antioch.games/install/",
  ]);
}
const setting = expanded(process.env.SC2_ADJUTANT_CORE);
if (setting && core.from !== "the core_path option") console.error(`sc2-adjutant: the core_path option, ${setting}, holds no sc2-adjutant core; using ${core.folder} (${core.from}) instead.`);
const mismatch = versionWarning({ plugin: pluginVersion(pluginRoot), core: core.version, folder: core.folder, from: core.from });
if (mismatch) console.error(mismatch);
if (!core.built) fail([`Found sc2-adjutant core in ${core.folder} (${core.from}), but it isn't built: no ${core.entry}.`, "Build it: run npm install, or npm run build, in the sc2-adjutant checkout that holds it."]);

// Core's server reads the Workspace from its first argument. A core built before --follow-roots ignores the flag.
process.argv = [process.argv[0], core.entry, workspace, "--follow-roots"];
await import(pathToFileURL(core.entry).href);
