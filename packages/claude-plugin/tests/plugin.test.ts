// The plugin as Claude Code loads it: its manifest starts the MCP server for the project, the server
// starts from the plugin through the launcher and lists the tools the commands drive, and the
// launcher finds the Workspace and core where the README says it does.
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findCore, findWorkspace, pluginVersion, versionWarning } from "../server/resolve.mjs";

const PLUGIN = fileURLToPath(new URL("../", import.meta.url));
const CORE = path.resolve(PLUGIN, "..", "core");
const EXAMPLE = path.join(CORE, "examples", "example-campaign");
const manifest = JSON.parse(await readFile(path.join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8"));
const commands = (await readdir(path.join(PLUGIN, "commands"))).filter((file) => file.endsWith(".md"));
/** The prefix Claude Code gives the tools of a plugin's MCP server: mcp__plugin_<plugin>_<server>__. */
const toolPrefix = (server: string) => `mcp__plugin_${manifest.name}_${server}__`.replace(/[^A-Za-z0-9_-]/g, "_");
/** Claude Code's own tools a command may pre-approve, alone or with a pattern: `Bash(node --version)`. Edit and Write never: a command pre-approves only what reads, or the shell commands it names. */
const CLAUDE_CODE_TOOLS = ["Bash", "Read", "Glob", "Grep"];
/** The tool an `allowed-tools` entry allows, without its pattern. */
const claudeCodeTool = (allowed: string) => allowed.replace(/\(.*\)$/, "");

/** A command's file: its frontmatter, its `allowed-tools` entries and its whole text. */
async function readCommand(file: string) {
  const text = await readFile(path.join(PLUGIN, "commands", file), "utf8");
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
  const allowed = /^allowed-tools: (.*)$/m.exec(frontmatter)?.[1]?.split(",").map((tool) => tool.trim()) ?? [];
  return { text, frontmatter, allowed };
}

/** The tools a command's text names as `snake_case` code. */
const namedTools = (text: string) => [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(([, tool]) => tool!);

describe("the manifest", () => {
  it("names the plugin sc2-adjutant and starts one server, the launcher, for the project Claude Code has open", () => {
    expect(manifest.name).toBe("sc2-adjutant");
    expect(Object.keys(manifest.mcpServers)).toEqual(["sc2-adjutant"]);
    expect(manifest.mcpServers["sc2-adjutant"]).toMatchObject({ command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server/start.mjs", "${CLAUDE_PROJECT_DIR}"] });
  });

  it("passes only options it declares to the server", () => {
    const references = [...JSON.stringify(manifest.mcpServers).matchAll(/\$\{user_config\.([A-Za-z0-9_]+)\}/g)].map(([, key]) => key);
    expect(references.length).toBeGreaterThan(0);
    for (const key of references) expect(manifest.userConfig).toHaveProperty(key!);
  });
});

describe("the MCP server, started as the plugin starts it", () => {
  let client: Client;
  let tools: string[];
  let scratch: string;

  beforeAll(async () => {
    // A scratch copy of the example Workspace, opened in a Mission's folder, as a project could be.
    scratch = await mkdtemp(path.join(os.tmpdir(), "sc2-adjutant-plugin-"));
    await cp(EXAMPLE, scratch, { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    client = new Client({ name: "plugin-test", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(PLUGIN, "server", "start.mjs"), path.join(scratch, "missions", "ashfall-relay")],
        env: { ...env, SC2_ADJUTANT_CORE: "${user_config.core_path}" },
        stderr: "pipe",
      }),
    );
    tools = (await client.listTools()).tools.map((tool) => tool.name);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  it("serves the Workspace above the project folder and lists the co-design tools", async () => {
    expect(tools).toEqual(expect.arrayContaining(["get_session_state", "sign_off_stage", "reopen_stage", "check_workspace", "compile_map", "test_mission", "list_plugins"]));
    const state = await client.callTool({ name: "get_session_state", arguments: { mission: "ashfall-relay" } });
    expect(state.structuredContent).toMatchObject({ missions: [{ mission: "ashfall-relay", stage: 1 }] });
  });

  it.each(commands)("%s drives only tools the server has, by their plugin names, or Claude Code's own", async (file) => {
    const { frontmatter, allowed, text } = await readCommand(file);
    expect(frontmatter).toMatch(/^description: \S/m);
    for (const tool of allowed) {
      if (tool.startsWith(toolPrefix("sc2-adjutant"))) expect(tools).toContain(tool.slice(toolPrefix("sc2-adjutant").length));
      else expect(CLAUDE_CODE_TOOLS, `${file} allows ${tool}`).toContain(claudeCodeTool(tool));
    }
    // A command names a tool as `snake_case` code, and nothing else that way (fields go in prose).
    // Only one that pre-approves Claude Code's tools and none of the server's, as init does to run
    // before there's a server, may name none.
    const named = namedTools(text);
    const serverless = allowed.length > 0 && allowed.every((tool) => !tool.startsWith(toolPrefix("sc2-adjutant")));
    if (!serverless) expect(named.length).toBeGreaterThan(0);
    for (const tool of named) expect(tools, `${file} names ${tool}`).toContain(tool);
  });
});

describe("the init command", () => {
  it("is run only by the author, and says it starts a new Campaign", async () => {
    const { frontmatter } = await readCommand("init.md");
    expect(frontmatter).toMatch(/^disable-model-invocation: true$/m);
    expect(/^description: (.*)$/m.exec(frontmatter)?.[1]).toMatch(/new Campaign/);
  });

  it("uses only Bash and none of the server's tools, so it works while the server is down", async () => {
    const { allowed, text } = await readCommand("init.md");
    expect(allowed.length).toBeGreaterThan(0);
    expect(new Set(allowed.map(claudeCodeTool))).toEqual(new Set(["Bash"]));
    expect(text).not.toContain(toolPrefix("sc2-adjutant"));
    expect(namedTools(text)).toEqual([]);
  });

  it("pre-approves the Node check and init, by npx and by Windows' npx.cmd", async () => {
    const { allowed, text } = await readCommand("init.md");
    expect(allowed).toEqual(expect.arrayContaining(["Bash(node --version)", "Bash(npx @team-antioch/sc2-adjutant init:*)", "Bash(npx.cmd @team-antioch/sc2-adjutant init:*)"]));
    expect(text).toContain("22.18");
    expect(text).toContain("/mcp");
    expect(text).toContain("/sc2-adjutant:co-design");
  });

  it("names every entry init refuses to overwrite: the example Campaign's, and the files init writes", async () => {
    const { text } = await readCommand("init.md");
    const refused = [...(await readdir(EXAMPLE)).filter((entry) => entry !== ".gitignore"), ".gitignore", "package.json"];
    expect(refused).toContain("sc2-adjutant.workspace.json");
    for (const entry of refused) expect(text, entry).toMatch(new RegExp(`\`${entry.replace(/\./g, "\\.")}/?\``));
    expect(text).toContain("`.claude/`");
  });
});

describe("the README", () => {
  it("lists every command", async () => {
    const readme = await readFile(path.join(PLUGIN, "README.md"), "utf8");
    for (const file of commands) expect(readme, file).toContain(`| \`/sc2-adjutant:${path.basename(file, ".md")}`);
  });
});

describe("the MCP server, in a session whose working folder moves", () => {
  let scratch: string;
  let roots: string[];
  let client: Client;

  beforeAll(async () => {
    // The project's Workspace, and a copy of it as a git worktree is: one more Mission.
    scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), "sc2-adjutant-follow-")));
    const [project, worktree] = [path.join(scratch, "project"), path.join(scratch, "worktree")];
    await cp(EXAMPLE, project, { recursive: true });
    await cp(EXAMPLE, worktree, { recursive: true });
    await cp(path.join(worktree, "missions", "ashfall-relay"), path.join(worktree, "missions", "worktree-only"), { recursive: true });
    roots = [project];
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    client = new Client({ name: "plugin-test", version: "0.0.0" }, { capabilities: { roots: { listChanged: true } } });
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: roots.map((folder) => ({ uri: pathToFileURL(folder).href })) }));
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(PLUGIN, "server", "start.mjs"), project], env: { ...env, SC2_ADJUTANT_CORE: "${user_config.core_path}" }, stderr: "pipe" }));
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  it("serves the Workspace of the folder the session is in, as it enters and leaves a worktree", async () => {
    const state = (mission: string) => client.callTool({ name: "get_session_state", arguments: { mission } });
    expect((await state("worktree-only")).isError).toBe(true);
    roots = [path.join(scratch, "worktree")];
    expect((await state("worktree-only")).isError).toBeFalsy();
    roots = [path.join(scratch, "project")];
    expect((await state("worktree-only")).isError).toBe(true);
    expect((await state("ashfall-relay")).isError).toBeFalsy();
  });
});

describe("the launcher", () => {
  let scratch: string;
  beforeAll(async () => {
    // By its real path, as Node resolves packages (a Mac's temp folder is behind a symlink).
    scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), "sc2-adjutant-launcher-")));
  });
  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("finds the nearest Workspace at or above the project folder, or none", async () => {
    const mission = path.join(scratch, "ws", "missions", "one");
    await mkdir(mission, { recursive: true });
    expect(findWorkspace(mission)).toBeUndefined();
    await writeFile(path.join(scratch, "ws", "sc2-adjutant.workspace.json"), "{}");
    expect(findWorkspace(mission)).toBe(path.join(scratch, "ws"));
    expect(findWorkspace(path.join(scratch, "ws"))).toBe(path.join(scratch, "ws"));
  });

  it("takes core from the core_path option first, as core's folder or a checkout holding it", () => {
    const fromCheckout = findCore({ coreSetting: path.resolve(CORE, "..", ".."), workspace: undefined, pluginRoot: scratch });
    expect(fromCheckout).toMatchObject({ entry: path.join(CORE, "dist", "mcp", "main.js"), from: "the core_path option" });
    expect(findCore({ coreSetting: CORE, workspace: undefined, pluginRoot: scratch })).toMatchObject({ folder: CORE, from: "the core_path option" });
  });

  it("then from the Workspace's own install of sc2-adjutant", async () => {
    const workspace = path.join(scratch, "installed");
    await mkdir(path.join(workspace, "node_modules", "@team-antioch", "sc2-adjutant"), { recursive: true });
    await writeFile(path.join(workspace, "node_modules", "@team-antioch", "sc2-adjutant", "package.json"), JSON.stringify({ name: "@team-antioch/sc2-adjutant", bin: { "sc2-adjutant-mcp": "dist/mcp/main.js" } }));
    const core = findCore({ coreSetting: "", workspace, pluginRoot: scratch });
    expect(core).toMatchObject({ from: "the Workspace's node_modules", built: false, entry: path.join(workspace, "node_modules", "@team-antioch", "sc2-adjutant", "dist", "mcp", "main.js") });
  });

  it("then from the checkout around the plugin, ignoring an option Claude Code left unexpanded", () => {
    expect(findCore({ coreSetting: "${user_config.core_path}", workspace: scratch, pluginRoot: PLUGIN })).toMatchObject({ folder: CORE, from: "the sc2-adjutant checkout around the plugin", built: true });
  });

  it("says where it looked when core is nowhere", () => {
    const missing = path.join(scratch, "nowhere");
    const core = findCore({ coreSetting: missing, workspace: scratch, pluginRoot: path.join(scratch, "plugin") });
    expect(core.entry).toBeUndefined();
    expect(core.tried).toEqual([missing, path.join(missing, "packages", "core"), `@team-antioch/sc2-adjutant installed in ${scratch}`, path.join(scratch, "core")]);
  });

  it("reads the plugin's version from its manifest, and core's with the core it finds", async () => {
    expect(pluginVersion(PLUGIN)).toBe(JSON.parse(await readFile(path.join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version);
    expect(pluginVersion(scratch)).toBeUndefined();
    const core = findCore({ coreSetting: CORE, workspace: undefined, pluginRoot: scratch });
    expect(core.version).toBe(JSON.parse(await readFile(path.join(CORE, "package.json"), "utf8")).version);
    expect(versionWarning({ plugin: pluginVersion(PLUGIN), core: core.version, folder: core.folder, from: core.from })).toBeUndefined();
  });

  it("warns when core's major or minor version differs from the plugin's, or can't be read", () => {
    const at = { folder: "/ws/node_modules/@team-antioch/sc2-adjutant", from: "the Workspace's node_modules" };
    expect(versionWarning({ plugin: "0.1.0", core: "0.1.3", ...at })).toBeUndefined();
    expect(versionWarning({ plugin: "0.1.0", core: "0.1.0-beta.1", ...at })).toBeUndefined();
    const minor = versionWarning({ plugin: "0.2.0", core: "0.1.4", ...at });
    expect(minor).toContain("the plugin and core versions don't match");
    expect(minor).toContain("The Claude Code plugin is 0.2.0.");
    expect(minor).toContain(`sc2-adjutant core 0.1.4 in ${at.folder} (${at.from})`);
    expect(minor).toContain("/sc2-adjutant:update");
    expect(minor).toContain("npm install @team-antioch/sc2-adjutant@latest");
    expect(minor).toContain("claude plugin update sc2-adjutant@sc2-adjutant");
    expect(versionWarning({ plugin: "1.1.0", core: "2.1.0", ...at })).toContain("sc2-adjutant core 2.1.0");
    expect(versionWarning({ plugin: "0.1.0", core: undefined, ...at })).toContain("no version that can be read");
    expect(versionWarning({ plugin: "0.1.0", core: "next", ...at })).toContain("no version that can be read");
    expect(versionWarning({ plugin: undefined, core: "0.1.0", ...at })).toBeUndefined();
  });

  it("outside a Workspace, points at /sc2-adjutant:init before the terminal's npx", async () => {
    const folder = path.join(scratch, "empty");
    await mkdir(folder, { recursive: true });
    const run = spawnSync(process.execPath, [path.join(PLUGIN, "server", "start.mjs"), folder], { encoding: "utf8", env: { ...process.env, SC2_ADJUTANT_CORE: "" } });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${folder} isn't in a Workspace`);
    const init = run.stderr.indexOf("/sc2-adjutant:init");
    expect(init).toBeGreaterThan(-1);
    expect(run.stderr.indexOf("npx @team-antioch/sc2-adjutant init")).toBeGreaterThan(init);
  });

  it("prints the warning to stderr when it starts with core from another release", async () => {
    const workspace = path.join(scratch, "older-core");
    const core = path.join(workspace, "node_modules", "@team-antioch", "sc2-adjutant");
    await mkdir(core, { recursive: true });
    await writeFile(path.join(workspace, "sc2-adjutant.workspace.json"), "{}");
    await writeFile(path.join(core, "package.json"), JSON.stringify({ name: "@team-antioch/sc2-adjutant", version: "0.0.9", bin: { "sc2-adjutant-mcp": "dist/mcp/main.js" } }));
    const run = spawnSync(process.execPath, [path.join(PLUGIN, "server", "start.mjs"), workspace], { encoding: "utf8", env: { ...process.env, SC2_ADJUTANT_CORE: "" } });
    expect(run.stderr).toContain("the plugin and core versions don't match");
    expect(run.stderr).toContain(`sc2-adjutant core 0.0.9 in ${core}`);
  });
});
