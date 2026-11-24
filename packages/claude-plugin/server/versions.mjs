// Whether this install of sc2-adjutant is on the latest release: the plugin's version and the
// Workspace's core against the newest core on npm. The plugin and core release together at one
// version (scripts/publish-packages.mjs), so core's npm `latest` stands for the release. The
// SessionStart hook (../hooks/update-check.mjs) and the update skill's script both read it here.
// Plain JavaScript, since the plugin ships its files as they are, with no build step.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { findCore, pluginVersion } from "./resolve.mjs";

export const CORE_PACKAGE = "@team-antioch/sc2-adjutant";
/** The npm scope every public sc2-adjutant package is published under. */
const SCOPE = "@team-antioch/";
const REGISTRY = "https://registry.npmjs.org";
/** How long a looked-up latest version is trusted before npm is asked again. */
export const CACHE_HOURS = 12;

/** The semver's numbers and prerelease, or undefined when it isn't one. */
function parse(version) {
  const match = typeof version === "string" ? /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim()) : null;
  return match ? { numbers: match.slice(1, 4).map(Number), pre: match[4] } : undefined;
}

/** Negative, zero or positive as `a` is older than, the same as or newer than `b`; undefined when either isn't a version. A prerelease is older than its release. */
export function compareVersions(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return undefined;
  for (let i = 0; i < 3; i++) if (x.numbers[i] !== y.numbers[i]) return x.numbers[i] - y.numbers[i];
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The file the latest version is cached in: SC2_ADJUTANT_UPDATE_CACHE, or one in the OS's temp folder. */
export const cacheFile = (env = process.env) => env.SC2_ADJUTANT_UPDATE_CACHE || path.join(os.tmpdir(), "sc2-adjutant", "latest-release.json");

/**
 * The newest release's version: from the cache when it is fresh, else from npm, within `timeoutMs`.
 * `fresh` skips the cache. Undefined when npm can't be reached and nothing is cached; a stale cache
 * is used then. Sends npm nothing but the package's name.
 */
export async function latestRelease({ env = process.env, fresh = false, timeoutMs = 3000, now = Date.now() } = {}) {
  const file = cacheFile(env);
  let cached;
  try {
    cached = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    cached = undefined;
  }
  const valid = parse(cached?.version) && typeof cached?.checkedAt === "number";
  if (!fresh && valid && now - cached.checkedAt < CACHE_HOURS * 3_600_000) return cached.version;
  try {
    const registry = (env.SC2_ADJUTANT_REGISTRY || REGISTRY).replace(/\/$/, "");
    const response = await fetch(`${registry}/${CORE_PACKAGE.replace("/", "%2F")}/latest`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`npm answered ${response.status}`);
    const { version } = await response.json();
    if (!parse(version)) throw new Error("npm gave no version");
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ version, checkedAt: now })}\n`);
    } catch {
      // An unwritable cache only means asking npm again next time.
    }
    return version;
  } catch {
    return valid ? cached.version : undefined;
  }
}

/**
 * How the plugin was installed: `marketplace` from Claude Code's plugin cache (updated with
 * `claude plugin update`), `checkout` inside a clone of sc2-adjutant (updated with git), or `other`.
 */
export function pluginInstall(pluginRoot) {
  const parts = path.resolve(pluginRoot).split(path.sep);
  if (parts.includes(".claude") && parts.includes("plugins")) return "marketplace";
  try {
    if (JSON.parse(readFileSync(path.resolve(pluginRoot, "..", "core", "package.json"), "utf8")).name === CORE_PACKAGE) return "checkout";
  } catch {
    // No core beside the plugin.
  }
  return "other";
}

/** The sc2-adjutant packages the Workspace's package.json depends on, with their ranges. */
export function workspacePackages(workspace) {
  if (!workspace) return {};
  try {
    const manifest = JSON.parse(readFileSync(path.join(workspace, "package.json"), "utf8"));
    return Object.fromEntries(Object.entries(manifest.dependencies ?? {}).filter(([name]) => name.startsWith(SCOPE)));
  } catch {
    return {};
  }
}

/**
 * Where this install stands against `latest`: the plugin's and core's versions, how each is
 * installed, which are behind, and the commands that update them. `core` is findCore's answer.
 */
export function updateStatus({ pluginRoot, workspace, core, latest }) {
  const plugin = { version: pluginVersion(pluginRoot), root: pluginRoot, install: pluginInstall(pluginRoot) };
  const coreAt = core?.folder ? { version: core.version, folder: core.folder, from: core.from } : undefined;
  const behind = (version) => latest !== undefined && (compareVersions(version, latest) ?? -1) < 0;
  plugin.behind = behind(plugin.version);
  if (coreAt) coreAt.behind = behind(coreAt.version);
  const packages = workspacePackages(workspace);
  const commands = {};
  if (plugin.behind && plugin.install === "marketplace") commands.plugin = ["claude plugin marketplace update sc2-adjutant", "claude plugin update sc2-adjutant@sc2-adjutant"];
  // `npm update` keeps to the range package.json gives, and ^0.x never crosses a minor version, so name the release.
  if (coreAt?.behind && coreAt.from === "the Workspace's node_modules" && Object.keys(packages).length) commands.workspace = `npm install ${Object.keys(packages).map((name) => `${name}@${latest}`).join(" ")}`;
  return { latest, workspace, plugin, core: coreAt, packages, upToDate: latest !== undefined && !plugin.behind && !coreAt?.behind, commands };
}

/** updateStatus for a session in `workspace` (or none), finding core as the launcher does. */
export async function checkForUpdate({ pluginRoot, workspace, coreSetting, env = process.env, fresh = false }) {
  const core = workspace || coreSetting ? findCore({ coreSetting, workspace, pluginRoot }) : undefined;
  const latest = await latestRelease({ env, fresh });
  return updateStatus({ pluginRoot, workspace, core, latest });
}

/** One line for the author when something is behind, or undefined. */
export function updateNotice(status) {
  if (status.latest === undefined || status.upToDate) return undefined;
  const parts = [];
  if (status.plugin.behind) parts.push(`the plugin is ${status.plugin.version ?? "at no version"}`);
  if (status.core?.behind) parts.push(`core is ${status.core.version ?? "at no version"}`);
  return `sc2-adjutant ${status.latest} is out (${parts.join(", ")}). Run /sc2-adjutant:update to update.`;
}
