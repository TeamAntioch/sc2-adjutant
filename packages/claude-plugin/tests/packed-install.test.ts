// The plugin as a mapper installs it from npm (#852): the public packages packed as npm would
// publish them, a Workspace made by `init` run from core's tarball the way `npx` runs it, those
// tarballs installed in the Workspace, and the launcher started with no core_path. It proves the
// tarballs hold what an install needs: core's server and CLIs, the Finders core serves when they
// load beside it, and this machine's Host Adapter.
//
// The packages aren't on npm until they're published, so the Workspace's package.json, once init has
// written it, has its dependencies pointed at the tarballs, and the Finders, which core names as
// optional dependencies, are added beside core so npm takes them from their tarballs too. It packs
// the built packages, as check-packs.mjs does, so build first; installing core's dependencies needs
// the npm registry.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findCore } from "../server/resolve.mjs";

const PLUGIN = fileURLToPath(new URL("../", import.meta.url));
const PACKAGES = path.resolve(PLUGIN, "..");
const CORE_PACKAGE = "@team-antioch/sc2-adjutant";
const CORE_VERSION = (JSON.parse(await readFile(path.join(PACKAGES, "core", "package.json"), "utf8")) as { version: string }).version;

/** This platform's Host Adapter, as the Workspace config's `bundled:` name and the package folder it's built from: none on Linux. */
const HOST = process.platform === "darwin" ? { name: "host-macos", folder: "plugin-host-macos" } : process.platform === "win32" ? { name: "host-windows", folder: "plugin-host-windows" } : undefined;
/** The packages packed and installed: core, the two Finders it serves tools from, and this platform's Host Adapter. */
const PACKED = ["core", "doodad-finder", "set-finder", ...(HOST ? [HOST.folder] : [])];

/** The environment without npm's run-script variables (a nested npm would read `npm test`'s workspace flags) or sc2-adjutant's own settings. */
function cleanEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !/^(npm_|INIT_CWD$|SC2_ADJUTANT_)/i.test(entry[0])));
}

/** Runs npm with `args` in `cwd`, resolving to its stdout, or rejecting with its output when it fails. */
function npm(args: string[], cwd: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    // npm is npm.cmd on Windows, which Node runs only through a shell.
    const child = spawn("npm", args, { cwd, env, shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`npm ${args.join(" ")} in ${cwd} exited with ${code}:\n${stdout}\n${stderr}`))));
  });
}

/** Packs the package in packages/`folder` into `destination`, giving the tarball's path and the package's name. npm 10 and 11 print an array, npm 12 an object keyed by package name. */
async function pack(folder: string, destination: string, env: Record<string, string>): Promise<{ name: string; tarball: string }> {
  const listing = JSON.parse(await npm(["pack", "--json", "--ignore-scripts", "--pack-destination", destination], path.join(PACKAGES, folder), env)) as unknown;
  const [packed] = (Array.isArray(listing) ? listing : Object.values(listing as object)) as { name: string; filename: string }[];
  return { name: packed!.name, tarball: path.join(destination, path.basename(packed!.filename)) };
}

describe("the plugin, with sc2-adjutant installed from its packed tarballs into a Workspace init made", () => {
  let scratch: string;
  let workspace: string;
  let initialPackage: { dependencies: Record<string, string> };
  let machineConfig: unknown;
  let client: Client;
  let tools: string[];
  let launcherErr = "";

  beforeAll(async () => {
    for (const folder of PACKED) expect(existsSync(path.join(PACKAGES, folder, "dist")), `packages/${folder} isn't built: run npm run build`).toBe(true);
    // By its real path, as Node resolves packages (a Mac's temp folder is behind a symlink). A new
    // folder each run, so npx never reuses an install of an older tarball at the same path.
    scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), "sc2-adjutant-packed-")));
    const tarballs = path.join(scratch, "tarballs");
    const env = { ...cleanEnv(), SC2_ADJUTANT_MACHINE_CONFIG: path.join(scratch, "machine-config.json") };
    await mkdir(tarballs);
    const packed = await Promise.all(PACKED.map((folder) => pack(folder, tarballs, env)));
    const core = packed.find(({ name }) => name === CORE_PACKAGE)!;

    // `npx @team-antioch/sc2-adjutant init`, with core from its tarball. --no-install, since the
    // dependencies it writes are on npm only once they're published.
    workspace = path.join(scratch, "my-campaign");
    await npm(["exec", "--yes", `--package=${core.tarball}`, "--", "sc2-adjutant", "init", workspace, "--no-install"], scratch, env);
    const packageFile = path.join(workspace, "package.json");
    initialPackage = JSON.parse(await readFile(packageFile, "utf8"));
    machineConfig = existsSync(env.SC2_ADJUTANT_MACHINE_CONFIG) ? JSON.parse(await readFile(env.SC2_ADJUTANT_MACHINE_CONFIG, "utf8")) : undefined;
    // Forward slashes, which npm reads in a file: spec on Windows too.
    const dependencies = Object.fromEntries(packed.map(({ name, tarball }) => [name, `file:${tarball.split(path.sep).join("/")}`]));
    await writeFile(packageFile, JSON.stringify({ ...initialPackage, dependencies }, null, 2));
    await npm(["install", "--no-audit", "--no-fund"], workspace, env);

    // The launcher as the plugin's manifest starts it, in a Mission's folder, with core_path unset.
    client = new Client({ name: "packed-install-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(PLUGIN, "server", "start.mjs"), path.join(workspace, "missions", "ashfall-relay")],
      env: { ...env, SC2_ADJUTANT_CORE: "${user_config.core_path}" },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer) => (launcherErr += chunk));
    await client.connect(transport);
    tools = (await client.listTools()).tools.map((tool) => tool.name);
  }, 600_000);

  afterAll(async () => {
    await client?.close();
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  it("has init write a Workspace that depends on core and this platform's Host Adapter, and name the adapter in the machine config", () => {
    const expected = [CORE_PACKAGE, ...(HOST ? [`${CORE_PACKAGE}-${HOST.name}`] : [])];
    expect(Object.keys(initialPackage.dependencies).sort()).toEqual(expected.sort());
    for (const range of Object.values(initialPackage.dependencies)) expect(range).toBe(`^${CORE_VERSION}`);
    if (HOST) expect(machineConfig).toEqual({ hostAdapter: `bundled:${HOST.name}` });
    else expect(machineConfig).toBeUndefined();
  });

  it("serves core from the Workspace's node_modules, at the plugin's version", () => {
    // What the launcher chose, by the lookup it ran (start.mjs), and that it didn't warn about it.
    expect(findCore({ coreSetting: "${user_config.core_path}", workspace, pluginRoot: PLUGIN })).toMatchObject({
      folder: path.join(workspace, "node_modules", ...CORE_PACKAGE.split("/")),
      from: "the Workspace's node_modules",
      built: true,
    });
    expect(launcherErr).not.toContain("versions don't match");
  });

  it("lists the co-design tools and the Finders' tools", () => {
    expect(tools).toEqual(expect.arrayContaining(["get_session_state", "sign_off_stage", "reopen_stage", "check_workspace", "compile_map", "test_mission", "list_plugins"]));
    expect(tools).toEqual(expect.arrayContaining(["find_doodads", "open_doodad_finder", "find_sets"]));
  });

  // list_plugins names a bundled Plugin by its config name. Core resolves it from its own folder, in
  // the scratch Workspace's node_modules, where Node's lookup never reaches this checkout: so a Host
  // Adapter that loads is the one from its tarball.
  it.runIf(HOST)("loads this platform's Host Adapter, and lists the tools only a Host Adapter can run", async () => {
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    const { plugins } = reply.structuredContent as { plugins: { name: string; source: string; roles: string[] }[] };
    expect(plugins.at(-1)).toMatchObject({ name: HOST!.name, source: `bundled:${HOST!.name}`, roles: ["host-adapter"] });
    expect(tools).toContain("speak_placeholder_voices");
  });
});
