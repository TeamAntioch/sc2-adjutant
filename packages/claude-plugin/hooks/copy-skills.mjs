#!/usr/bin/env node
// The plugin's SessionStart hook (ADR-0023). In a Workspace, it copies the skills of the Plugins
// the Workspace lists into <workspace>/.claude/skills/, where Claude Code finds project skills, and
// removes the copies of Plugins it no longer lists; core's plugins/plugin-skills.js does the copy,
// as the sync tool does. It finds the Workspace and core as the launcher does (../server/resolve.mjs)
// and prints `reloadSkills`, so the copies load in this same session. Outside a Workspace, or with
// no built core, it does nothing. It never fails the session: a problem is shown, not thrown.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expanded, findCore, findWorkspace } from "../server/resolve.mjs";

const pluginRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The hook's input, if Claude Code gave one: its `cwd` is where the session is. */
function hookInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

const input = hookInput();
const project = expanded(process.env.CLAUDE_PROJECT_DIR) ?? expanded(input.cwd) ?? process.cwd();
const workspace = findWorkspace(project);
if (!workspace) process.exit(0);

// The MCP server gets the core_path option through its env; a hook gets it as CLAUDE_PLUGIN_OPTION_CORE_PATH.
const coreSetting = expanded(process.env.SC2_ADJUTANT_CORE) ?? process.env.CLAUDE_PLUGIN_OPTION_CORE_PATH;
const core = findCore({ coreSetting, workspace, pluginRoot });
const skillsModule = core.folder && path.join(core.folder, "dist", "plugins", "plugin-skills.js");
// No core, or one built before Plugins contributed skills: the MCP server says what's wrong with core.
if (!skillsModule || !existsSync(skillsModule)) process.exit(0);

const output = { hookSpecificOutput: { hookEventName: "SessionStart", reloadSkills: true } };
try {
  const { copyWorkspaceSkills, formatSkillCopy } = await import(pathToFileURL(skillsModule).href);
  const report = await copyWorkspaceSkills(workspace);
  // Only what didn't go as asked is shown; the copies themselves load silently.
  const problems = formatSkillCopy({ ...report, copied: [], removed: [] });
  if (problems.length) output.systemMessage = `sc2-adjutant: ${problems.join("; ")}.`;
} catch (error) {
  delete output.hookSpecificOutput;
  output.systemMessage = `sc2-adjutant: the Workspace's Plugin skills weren't copied: ${error instanceof Error ? error.message : String(error)}`;
}
console.log(JSON.stringify(output));
