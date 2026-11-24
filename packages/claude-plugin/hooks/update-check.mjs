#!/usr/bin/env node
// The plugin's SessionStart hook that says whether sc2-adjutant is up to date. In a Workspace, it
// compares the plugin's version and the Workspace's core with the newest release on npm (looked up
// at most every 12 hours, see ../server/versions.mjs). When either is behind, it tells the author in
// one line and tells Claude to offer the update skill; when both are current, it tells Claude only.
// Outside a Workspace, with SC2_ADJUTANT_NO_UPDATE_CHECK set, or when npm can't be reached, it
// prints nothing. It never fails the session.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expanded, findWorkspace } from "../server/resolve.mjs";
import { checkForUpdate, updateNotice } from "../server/versions.mjs";

const pluginRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The hook's input, if Claude Code gave one: its `cwd` is where the session is. */
function hookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

try {
  if (process.env.SC2_ADJUTANT_NO_UPDATE_CHECK) process.exit(0);
  const input = hookInput();
  const workspace = findWorkspace(expanded(process.env.CLAUDE_PROJECT_DIR) ?? expanded(input.cwd) ?? process.cwd());
  if (!workspace) process.exit(0);
  const coreSetting = expanded(process.env.SC2_ADJUTANT_CORE) ?? expanded(process.env.CLAUDE_PLUGIN_OPTION_CORE_PATH);
  const status = await checkForUpdate({ pluginRoot, workspace, coreSetting });
  if (status.latest === undefined) process.exit(0);

  const notice = updateNotice(status);
  const versions = `plugin ${status.plugin.version ?? "unknown"}${status.core ? `, core ${status.core.version ?? "unknown"}` : ""}`;
  const context = notice
    ? `${notice} (${versions}; latest ${status.latest}.) At a natural pause, offer once to run the sc2-adjutant update skill; don't update without the author's yes.`
    : `sc2-adjutant is up to date: ${versions}, and the latest release is ${status.latest}.`;
  const output = { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } };
  if (notice) output.systemMessage = notice;
  console.log(JSON.stringify(output));
} catch {
  // A failed check says nothing: it is only advice.
}
