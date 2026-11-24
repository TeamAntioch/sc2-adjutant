// Whether sc2-adjutant is up to date: the version comparison, the latest release from npm and its
// cache, the commands that update what's behind, and the SessionStart hook run as Claude Code runs
// it. npm is a local server here, so the tests never reach the network.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pluginVersion } from "../server/resolve.mjs";
import { CACHE_HOURS, compareVersions, latestRelease, updateNotice, updateStatus } from "../server/versions.mjs";

const PLUGIN = fileURLToPath(new URL("../", import.meta.url));
const HOOK = path.join(PLUGIN, "hooks", "update-check.mjs");
const STATUS = path.join(PLUGIN, "skills", "update", "scripts", "status.mjs");
const OURS = pluginVersion(PLUGIN) as string;
const CORE_PACKAGE = "@team-antioch/sc2-adjutant";
const HOST = "@team-antioch/sc2-adjutant-host-macos";

/** The local npm: answers core's `latest` with `published`, and counts the asks. */
let published = "0.0.0";
let asks = 0;
let server: Server;
let registry: string;
const made: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    asks++;
    if (request.url !== `/${CORE_PACKAGE.replace("/", "%2F")}/latest`) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: CORE_PACKAGE, version: published }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), "sc2-adjutant-update-")));
  made.push(folder);
  return folder;
}

/** A newer version than `version`, at its next minor. */
const nextMinor = (version: string) => version.replace(/^(\d+)\.(\d+)\.\d+.*$/, (_, major, minor) => `${major}.${Number(minor) + 1}.0`);

/** A Workspace whose node_modules holds core and the macOS Host Adapter at `core`. */
async function workspace(core: string): Promise<string> {
  const root = await scratch();
  await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixture Campaign" } }));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", private: true, dependencies: { [CORE_PACKAGE]: `^${core}`, [HOST]: `^${core}`, other: "^1.0.0" } }));
  for (const name of [CORE_PACKAGE, HOST]) {
    await mkdir(path.join(root, "node_modules", name), { recursive: true });
    await writeFile(path.join(root, "node_modules", name, "package.json"), JSON.stringify({ name, version: core }));
  }
  return root;
}

/** Runs `script` as Claude Code runs a hook for a session opened in `project`, with npm at `registryUrl`. */
async function run(script: string, project: string, env: Record<string, string> = {}, registryUrl = registry) {
  const base = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("SC2_ADJUTANT")));
  const cache = path.join(await scratch(), "latest.json");
  const child = promisify(execFile)(process.execPath, [script], { env: { ...base, CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_ROOT: PLUGIN, SC2_ADJUTANT_REGISTRY: registryUrl, SC2_ADJUTANT_UPDATE_CACHE: cache, ...env }, cwd: project });
  child.child.stdin!.end(JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd: project, session_id: "test" }));
  try {
    const { stdout } = await child;
    return { output: stdout.trim() ? (JSON.parse(stdout) as Record<string, any>) : undefined, code: 0 };
  } catch (error) {
    const { stdout, code } = error as { stdout: string; code: number };
    return { output: stdout.trim() ? (JSON.parse(stdout) as Record<string, any>) : undefined, code };
  }
}

describe("comparing versions", () => {
  it("orders by major, minor and patch, with a prerelease before its release", () => {
    expect(compareVersions("0.1.1", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("next", "1.0.0")).toBeUndefined();
  });
});

describe("the latest release", () => {
  it("asks npm, then answers from its cache until the cache is older than its hours", async () => {
    const env = { SC2_ADJUTANT_REGISTRY: registry, SC2_ADJUTANT_UPDATE_CACHE: path.join(await scratch(), "cache", "latest.json") };
    published = "3.4.5";
    const before = asks;
    expect(await latestRelease({ env, now: 1_000 })).toBe("3.4.5");
    published = "3.5.0";
    expect(await latestRelease({ env, now: 2_000 })).toBe("3.4.5");
    expect(asks - before).toBe(1);
    expect(await latestRelease({ env, now: 2_000, fresh: true })).toBe("3.5.0");
    published = "3.6.0";
    expect(await latestRelease({ env, now: 2_000 + CACHE_HOURS * 3_600_000 + 1 })).toBe("3.6.0");
    expect(JSON.parse(await readFile(env.SC2_ADJUTANT_UPDATE_CACHE, "utf8")).version).toBe("3.6.0");
  });

  it("falls back on a stale cache when npm can't be reached, and is undefined with none", async () => {
    const file = path.join(await scratch(), "latest.json");
    const env = { SC2_ADJUTANT_REGISTRY: "http://127.0.0.1:1", SC2_ADJUTANT_UPDATE_CACHE: file };
    expect(await latestRelease({ env, timeoutMs: 500 })).toBeUndefined();
    await writeFile(file, JSON.stringify({ version: "0.9.0", checkedAt: 0 }));
    expect(await latestRelease({ env, timeoutMs: 500 })).toBe("0.9.0");
  });
});

describe("where an install stands", () => {
  it("names the commands for a plugin from the marketplace and a Workspace's core, at the release, not npm update", async () => {
    const root = await workspace("0.1.0");
    const status = updateStatus({ pluginRoot: PLUGIN, workspace: root, core: { folder: path.join(root, "node_modules", CORE_PACKAGE), from: "the Workspace's node_modules", version: "0.1.0" }, latest: "0.2.0" });
    expect(status.upToDate).toBe(false);
    expect(status.core).toMatchObject({ version: "0.1.0", behind: true });
    expect(status.packages).toEqual({ [CORE_PACKAGE]: "^0.1.0", [HOST]: "^0.1.0" });
    expect(status.commands.workspace).toBe(`npm install ${CORE_PACKAGE}@0.2.0 ${HOST}@0.2.0`);
    // The plugin here is in this checkout, so its update is the author's git pull, not a command.
    expect(status.plugin).toMatchObject({ install: "checkout", behind: true });
    expect(status.commands.plugin).toBeUndefined();
    expect(updateNotice(status)).toBe(`sc2-adjutant 0.2.0 is out (the plugin is ${OURS}, core is 0.1.0). Run /sc2-adjutant:update to update.`);
  });

  it("is up to date when nothing is older than the release, a newer plugin included", () => {
    const status = updateStatus({ pluginRoot: PLUGIN, workspace: undefined, core: undefined, latest: "0.0.1" });
    expect(status.upToDate).toBe(true);
    expect(status.commands).toEqual({});
    expect(updateNotice(status)).toBeUndefined();
  });
});

describe("the SessionStart hook", () => {
  it("tells the author and Claude when a newer release is out", async () => {
    published = nextMinor(OURS);
    const { output } = await run(HOOK, await workspace(OURS));
    expect(output?.systemMessage).toBe(`sc2-adjutant ${published} is out (the plugin is ${OURS}, core is ${OURS}). Run /sc2-adjutant:update to update.`);
    expect(output?.hookSpecificOutput).toMatchObject({ hookEventName: "SessionStart" });
    expect(output?.hookSpecificOutput.additionalContext).toContain("offer once to run the sc2-adjutant update skill");
  });

  it("tells only Claude when everything is on the latest release", async () => {
    published = OURS;
    const { output } = await run(HOOK, await workspace(OURS));
    expect(output?.systemMessage).toBeUndefined();
    expect(output?.hookSpecificOutput.additionalContext).toBe(`sc2-adjutant is up to date: plugin ${OURS}, core ${OURS}, and the latest release is ${OURS}.`);
  });

  it("says nothing outside a Workspace, offline, or when turned off", async () => {
    published = nextMinor(OURS);
    expect((await run(HOOK, await scratch())).output).toBeUndefined();
    expect((await run(HOOK, await workspace(OURS), {}, "http://127.0.0.1:1")).output).toBeUndefined();
    expect((await run(HOOK, await workspace(OURS), { SC2_ADJUTANT_NO_UPDATE_CHECK: "1" })).output).toBeUndefined();
  });
});

describe("the update skill's status script", () => {
  it("prints where the Workspace stands, asked afresh", async () => {
    published = nextMinor(OURS);
    const root = await workspace("0.0.1");
    const { output, code } = await run(STATUS, root);
    expect(code).toBe(0);
    expect(output).toMatchObject({ latest: published, upToDate: false, workspace: root, core: { version: "0.0.1", behind: true, from: "the Workspace's node_modules" } });
    expect(output?.commands.workspace).toBe(`npm install ${CORE_PACKAGE}@${published} ${HOST}@${published}`);
  });

  it("fails when npm can't be reached", async () => {
    const { code } = await run(STATUS, await workspace(OURS), {}, "http://127.0.0.1:1");
    expect(code).toBe(1);
  });
});
