// Finds what the plugin's MCP server serves and runs: the Workspace (the project Claude Code has
// open, or the nearest folder above it with a Workspace config) and sc2-adjutant core's MCP server.
// Plain JavaScript, since the plugin ships its files as they are, with no build step.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export const WORKSPACE_FILE = "sc2-adjutant.workspace.json";
const CORE_PACKAGE = "@team-antioch/sc2-adjutant";
const CORE_BIN = "sc2-adjutant-mcp";

/** The value, unless Claude Code left it unexpanded (`${...}`) or it is empty: then undefined. */
export const expanded = (value) => (typeof value === "string" && value !== "" && !value.includes("${") ? value : undefined);

/**
 * The Workspace folder: the nearest folder at or above `start` holding a Workspace config, so a
 * session opened in a Mission's folder still serves its Workspace. Undefined when there is none.
 */
export function findWorkspace(start) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, WORKSPACE_FILE))) return dir;
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** Core's package folder, if `folder` is one: its package.json names it `@team-antioch/sc2-adjutant`. */
function corePackageAt(folder) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8"));
    return manifest.name === CORE_PACKAGE ? { folder, manifest } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Core's MCP server entry, from the first of these that holds core:
 * 1. `coreSetting`, the plugin's `core_path` option (or `SC2_ADJUTANT_CORE`): core's package folder
 *    or a checkout of the sc2-adjutant repo.
 * 2. The Workspace's own install: `@team-antioch/sc2-adjutant` resolved from the Workspace folder.
 * 3. The monorepo around the plugin, `../core`, when the plugin runs from a checkout of
 *    sc2-adjutant (`--plugin-dir`, or a marketplace added from a local path).
 * Returns the entry, where it came from and core's version, or the places it looked.
 */
export function findCore({ coreSetting, workspace, pluginRoot }) {
  const tried = [];
  const candidates = [];
  const setting = expanded(coreSetting);
  if (setting) {
    const folder = path.resolve(setting);
    candidates.push({ from: "the core_path option", folders: [folder, path.join(folder, "packages", "core")] });
  }
  if (workspace) {
    let folder;
    try {
      folder = path.dirname(createRequire(path.join(workspace, "package.json")).resolve(`${CORE_PACKAGE}/package.json`));
    } catch {
      folder = undefined;
    }
    candidates.push({ from: "the Workspace's node_modules", folders: folder ? [folder] : [], missing: `${CORE_PACKAGE} installed in ${workspace}` });
  }
  candidates.push({ from: "the sc2-adjutant checkout around the plugin", folders: [path.resolve(pluginRoot, "..", "core")] });

  for (const { from, folders, missing } of candidates) {
    if (!folders.length && missing) tried.push(missing);
    for (const folder of folders) {
      const core = corePackageAt(folder);
      if (!core) {
        tried.push(folder);
        continue;
      }
      const bin = typeof core.manifest.bin === "string" ? core.manifest.bin : core.manifest.bin?.[CORE_BIN];
      const entry = path.resolve(folder, bin ?? "dist/mcp/main.js");
      return { entry, from, built: existsSync(entry), folder, version: core.manifest.version };
    }
  }
  return { tried };
}

/** The plugin's version, from the manifest Claude Code installs (`.claude-plugin/plugin.json`). */
export function pluginVersion(pluginRoot) {
  try {
    return JSON.parse(readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")).version;
  } catch {
    return undefined;
  }
}

/** `major.minor` of a semver version, or undefined when it isn't one. */
const majorMinor = (version) => (typeof version === "string" ? /^v?(\d+)\.(\d+)\.\d+/.exec(version.trim())?.slice(1, 3).join(".") : undefined);

/**
 * The warning to print when the plugin and core don't belong to the same release: their
 * `major.minor` differ, or core's version can't be read. Patch versions may differ. Undefined
 * when they match, or when the plugin's own version can't be read.
 */
export function versionWarning({ plugin, core, folder, from }) {
  const ours = majorMinor(plugin);
  if (!ours) return undefined;
  const theirs = majorMinor(core);
  if (theirs === ours) return undefined;
  const found = theirs ? `sc2-adjutant core ${core}` : "sc2-adjutant core with no version that can be read";
  return [
    "sc2-adjutant: warning: the plugin and core versions don't match.",
    `- The Claude Code plugin is ${plugin}.`,
    `- It found ${found} in ${folder} (${from}).`,
    "Tools may fail or behave unexpectedly until both are on the same release. To update them:",
    "- core installed in the Workspace: run npm update in the Workspace folder.",
    "- the plugin: run claude plugin update sc2-adjutant@sc2-adjutant, then restart Claude Code.",
    "- a checkout set as core_path: pull it and run npm install there.",
  ].join("\n");
}
