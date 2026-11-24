// `sc2-adjutant init` (#849): a Workspace from the example Campaign that checks clean, with core and
// this platform's Host Adapter as its dependencies, the Plugins' skills copied by the core installed
// in it, and the Host Adapter named in a machine config only when there is none yet.
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { CORE_FOLDER, CORE_PACKAGE, EXAMPLE_WORKSPACE, formatInit, initWorkspace, InitRefusedError, WORKSPACE_GITIGNORE, WORKSPACE_SCRIPTS, workspacePackageName } from "../../src/init/init-workspace.js";
import { checkWorkspace, isError } from "../../src/plugins/check-workspace.js";

const made: string[] = [];
afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), "sc2-adjutant-init-")));
  made.push(folder);
  return folder;
}

/** An environment whose machine config is a file in `base`, which doesn't exist yet. */
const envAt = (base: string) => ({ SC2_ADJUTANT_MACHINE_CONFIG: path.join(base, "config", "machine.json") });

/** Stands in for `npm install`: links this checkout's core into the Workspace's node_modules. */
async function linkCore(root: string): Promise<void> {
  const scope = path.join(root, "node_modules", "@team-antioch");
  await mkdir(scope, { recursive: true });
  await symlink(CORE_FOLDER, path.join(scope, "sc2-adjutant"), "junction");
}

const readJson = async (file: string) => JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;

/** Every file under a folder, relative to it with forward slashes. */
async function filesUnder(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

describe("initWorkspace", () => {
  it("copies the example Campaign, writes the Workspace's package.json and .gitignore, and checks clean", async () => {
    const base = await scratch();
    const root = path.join(base, "My Campaign");
    const result = await initWorkspace({ folder: root, install: false, env: envAt(base), platform: "darwin", coreVersion: "0.1.0" });

    const example = (await filesUnder(EXAMPLE_WORKSPACE)).filter((file) => file !== ".gitignore" && !/^missions\/[^/]+\/(output\/|[^/]+\.SC2Map\/|compile-record\.json$|audio\/manifest\.json$)/.test(file));
    expect(await filesUnder(root)).toEqual([...example, ".gitignore", "package.json"].sort());
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe(WORKSPACE_GITIGNORE);

    const pkg = await readJson(path.join(root, "package.json"));
    expect(pkg).toMatchObject({ name: "my-campaign", private: true, type: "module", dependencies: { [CORE_PACKAGE]: "^0.1.0", "@team-antioch/sc2-adjutant-host-macos": "^0.1.0", "@team-antioch/sc2-adjutant-anim-testbed": "^0.1.0" } });
    expect((pkg.scripts as Record<string, string>)["compile-map"]).toBe(`node node_modules/${CORE_PACKAGE}/dist/cli/compile-map.js`);
    expect(result).toMatchObject({ root, hostAdapter: "bundled:host-macos", installed: false });

    const check = await checkWorkspace(root);
    expect(check.problems.filter(isError)).toEqual([]);
  });

  it("gives every script a core CLI that exists", () => {
    for (const file of Object.values(WORKSPACE_SCRIPTS)) expect(existsSync(path.join(CORE_FOLDER, "src", "cli", `${file}.ts`)), file).toBe(true);
  });

  it("depends on the Windows Host Adapter on Windows, and on none on Linux", async () => {
    const base = await scratch();
    await initWorkspace({ folder: path.join(base, "win"), install: false, env: envAt(base), platform: "win32", coreVersion: "0.2.3" });
    expect((await readJson(path.join(base, "win", "package.json"))).dependencies).toEqual({ [CORE_PACKAGE]: "^0.2.3", "@team-antioch/sc2-adjutant-host-windows": "^0.2.3", "@team-antioch/sc2-adjutant-anim-testbed": "^0.2.3" });

    const linux = await scratch();
    const result = await initWorkspace({ folder: path.join(linux, "penguin"), install: false, env: envAt(linux), platform: "linux", coreVersion: "0.2.3" });
    expect((await readJson(path.join(linux, "penguin", "package.json"))).dependencies).toEqual({ [CORE_PACKAGE]: "^0.2.3", "@team-antioch/sc2-adjutant-anim-testbed": "^0.2.3" });
    expect(result.machineConfig).toEqual({ kind: "no-host", file: envAt(linux).SC2_ADJUTANT_MACHINE_CONFIG, platform: "linux" });
    expect(existsSync(envAt(linux).SC2_ADJUTANT_MACHINE_CONFIG)).toBe(false);
    expect(formatInit(result, "penguin").join("\n")).toContain("No Host Adapter runs on linux");
  });

  it("names this platform's Host Adapter in a new machine config", async () => {
    const base = await scratch();
    const result = await initWorkspace({ folder: path.join(base, "ws"), install: false, env: envAt(base), platform: "darwin" });
    expect(result.machineConfig).toEqual({ kind: "written", file: envAt(base).SC2_ADJUTANT_MACHINE_CONFIG, hostAdapter: "bundled:host-macos" });
    expect(await readJson(envAt(base).SC2_ADJUTANT_MACHINE_CONFIG)).toEqual({ hostAdapter: "bundled:host-macos" });
  });

  it("leaves an existing machine config as it is, and says what it names", async () => {
    const base = await scratch();
    const file = envAt(base).SC2_ADJUTANT_MACHINE_CONFIG;
    await mkdir(path.dirname(file), { recursive: true });
    const config = `{ "sc2Path": "/Games/StarCraft II" }\n`;
    await writeFile(file, config);
    const result = await initWorkspace({ folder: path.join(base, "ws"), install: false, env: envAt(base), platform: "darwin" });
    expect(await readFile(file, "utf8")).toBe(config);
    expect(result.machineConfig).toEqual({ kind: "existing", file });
    expect(formatInit(result, "ws").join("\n")).toContain(`it names no Host Adapter`);

    await writeFile(file, `{ "hostAdapter": "./my-adapter" }\n`);
    const again = await initWorkspace({ folder: path.join(base, "ws2"), install: false, env: envAt(base), platform: "darwin" });
    expect(again.machineConfig).toEqual({ kind: "existing", file, hostAdapter: "./my-adapter" });
    expect(await readFile(file, "utf8")).toBe(`{ "hostAdapter": "./my-adapter" }\n`);
  });

  it("runs npm install, then copies the Plugins' skills with the core installed in the Workspace", async () => {
    const base = await scratch();
    // The example, with a Utility whose skill names its Plugin's folder.
    const example = path.join(base, "example");
    await cp(EXAMPLE_WORKSPACE, example, { recursive: true });
    const utility = path.join(example, "utilities", "workshop");
    await mkdir(path.join(utility, "skills", "retexture"), { recursive: true });
    await writeFile(path.join(utility, "sc2-adjutant-plugin.json"), JSON.stringify({ name: "workshop", version: "0.1.0", pluginApi: 2, roles: ["utility"], contributions: { skills: ["skills/retexture"] } }));
    await writeFile(path.join(utility, "skills", "retexture", "SKILL.md"), "---\nname: retexture\ndescription: Retextures a model. Use when asked for one.\n---\n\nRun `{{PLUGIN_FOLDER}}/retexture.py`.\n");
    const config = await readJson(path.join(example, "sc2-adjutant.workspace.json"));
    await writeFile(path.join(example, "sc2-adjutant.workspace.json"), JSON.stringify({ ...config, utilities: ["./utilities/workshop"] }));

    const root = path.join(base, "ws");
    const installs: string[] = [];
    const result = await initWorkspace({
      folder: root,
      example,
      env: envAt(base),
      platform: "darwin",
      runInstall: async (folder) => {
        installs.push(folder);
        await linkCore(folder);
      },
    });
    expect(installs).toEqual([root]);
    // The example's Utility, and the testbed every new Workspace gets (DEFAULT_UTILITIES).
    expect(result).toMatchObject({ installed: true, skills: ["Copied the Plugins' skills into .claude/skills: workshop-retexture, anim-testbed"] });
    expect((await readJson(path.join(root, "sc2-adjutant.workspace.json"))).utilities).toEqual(["./utilities/workshop", "bundled:anim-testbed"]);
    const skill = await readFile(path.join(root, ".claude", "skills", "workshop-retexture", "SKILL.md"), "utf8");
    expect(skill).toContain(`${path.join(root, "utilities", "workshop").split(path.sep).join("/")}/retexture.py`);
  });

  it("says the skills weren't copied when core isn't in the Workspace after the install", async () => {
    const base = await scratch();
    const result = await initWorkspace({ folder: path.join(base, "ws"), env: envAt(base), platform: "darwin", runInstall: async () => {} });
    expect(result.skillsNote).toBe(`not copied: ${CORE_PACKAGE} isn't installed in the Workspace`);
    expect(formatInit(result, "ws").join("\n")).toContain("the first Claude Code session in the Workspace copies them");
  });

  it("says where the Workspace is when npm install fails", async () => {
    const base = await scratch();
    const root = path.join(base, "ws");
    const failing = initWorkspace({ folder: root, env: envAt(base), platform: "darwin", runInstall: () => Promise.reject(new Error("npm install exited with 1")) });
    await expect(failing).rejects.toThrow(`Made the Workspace in ${root}, but npm install exited with 1: run npm install there once that's fixed`);
  });

  it("refuses a folder that already has a Workspace config, and writes nothing", async () => {
    const base = await scratch();
    const root = path.join(base, "ws");
    await mkdir(root);
    await writeFile(path.join(root, "sc2-adjutant.workspace.json"), "{}");
    await expect(initWorkspace({ folder: root, install: false, env: envAt(base), platform: "darwin" })).rejects.toThrow(InitRefusedError);
    await expect(initWorkspace({ folder: root, install: false, env: envAt(base), platform: "darwin" })).rejects.toThrow("already has a Workspace config");
    expect(await readdir(root)).toEqual(["sc2-adjutant.workspace.json"]);
    expect(existsSync(envAt(base).SC2_ADJUTANT_MACHINE_CONFIG)).toBe(false);
  });

  it("refuses a folder holding a file it would overwrite, and takes one holding only others", async () => {
    const base = await scratch();
    const root = path.join(base, "ws");
    await mkdir(root);
    await writeFile(path.join(root, "package.json"), "{}");
    await expect(initWorkspace({ folder: root, install: false, env: envAt(base), platform: "darwin" })).rejects.toThrow(`${root} already has package.json, which init would overwrite`);

    const other = path.join(base, "other");
    await mkdir(path.join(other, ".git"), { recursive: true });
    await initWorkspace({ folder: other, install: false, env: envAt(base), platform: "darwin" });
    expect(existsSync(path.join(other, "sc2-adjutant.workspace.json"))).toBe(true);
  });
});

describe("workspacePackageName", () => {
  it("makes a package name of the folder's", () => {
    expect(workspacePackageName("/x/Ashfall Relay Saga")).toBe("ashfall-relay-saga");
    expect(workspacePackageName("/x/.hidden")).toBe("hidden");
    expect(workspacePackageName("/x/!!!")).toBe("sc2-adjutant-workspace");
  });
});
