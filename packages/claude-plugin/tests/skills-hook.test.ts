// The SessionStart hook (ADR-0023): in a Workspace, it copies the skills of the Plugins the
// Workspace lists into its .claude/skills/, marked and with the Plugin's folder filled in, removes
// the copies of Plugins no longer listed, and asks Claude Code to reload its skills. Run here as
// Claude Code runs it: a process given the hook's input on stdin, finding core as the launcher does.
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, describe, expect, it } from "vitest";

/** A folder as a copied skill names it: with forward slashes, on Windows too. */
const toPosix = (folder: string) => folder.split(path.sep).join("/");

const PLUGIN = fileURLToPath(new URL("../", import.meta.url));
const HOOK = path.join(PLUGIN, "hooks", "copy-skills.mjs");
const FIELD = path.resolve(PLUGIN, "..", "core", "tests", "fixtures", "workspaces", "field");
const MARKER = ".sc2-adjutant-skill.json";

const made: string[] = [];
afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), "sc2-adjutant-skills-hook-")));
  made.push(folder);
  return folder;
}

/** Runs the hook as Claude Code does for a session opened in `project`, and parses what it prints. */
async function runHook(project: string): Promise<{ output: Record<string, unknown> | undefined; stderr: string }> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("SC2_ADJUTANT")));
  const child = promisify(execFile)(process.execPath, [HOOK], { env: { ...env, CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_ROOT: PLUGIN }, cwd: project });
  child.child.stdin!.end(JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd: project, session_id: "test" }));
  const { stdout, stderr } = await child;
  return { output: stdout.trim() ? (JSON.parse(stdout) as Record<string, unknown>) : undefined, stderr };
}

/** A Workspace listing the Utility workshop, whose one skill names its Plugin's folder. */
async function workspaceWithUtility(): Promise<string> {
  const root = await scratch();
  const utility = path.join(root, "utilities", "workshop");
  await mkdir(path.join(utility, "skills", "retexture", "scripts"), { recursive: true });
  await writeFile(path.join(utility, "sc2-adjutant-plugin.json"), JSON.stringify({ name: "workshop", version: "0.1.0", pluginApi: 2, roles: ["utility"], contributions: { skills: ["skills/retexture"] } }));
  await writeFile(path.join(utility, "skills", "retexture", "SKILL.md"), "---\nname: retexture\ndescription: Retextures a model. Use when asked for one.\n---\n\nRun `python3 {{PLUGIN_FOLDER}}/skills/retexture/scripts/retexture.py`.\n");
  await writeFile(path.join(utility, "skills", "retexture", "scripts", "retexture.py"), "print('{{PLUGIN_FOLDER}} stays as it is in a script')\n");
  await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixture Campaign" }, utilities: ["./utilities/workshop"] }));
  await writeFile(path.join(root, ".gitignore"), "node_modules/\n");
  return root;
}

/** Rewrites a Plugin's manifest as a Utility of `name` contributing `skills`. */
async function writeManifest(folder: string, name: string, skills: readonly string[]): Promise<void> {
  await writeFile(path.join(folder, "sc2-adjutant-plugin.json"), JSON.stringify({ name, version: "0.1.0", pluginApi: 2, roles: ["utility"], contributions: { skills } }));
}

const reloads = { hookSpecificOutput: { hookEventName: "SessionStart", reloadSkills: true } };

describe("the SessionStart hook", () => {
  it("runs at session start, before the update check", async () => {
    const hooks = JSON.parse(await readFile(path.join(PLUGIN, "hooks", "hooks.json"), "utf8"));
    expect(Object.keys(hooks.hooks)).toEqual(["SessionStart", "PostToolUse", "PostToolUseFailure"]);
    expect(hooks.hooks.SessionStart).toEqual([{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/copy-skills.mjs"' }, { type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/update-check.mjs"', timeout: 10 }] }]);
  });

  it("copies a listed Utility's skill, named for its Plugin, with the marker and its Plugin's folder filled in, ignores the copy, and reloads skills", async () => {
    const root = await workspaceWithUtility();
    expect((await runHook(root)).output).toEqual(reloads);
    const copy = path.join(root, ".claude", "skills", "workshop-retexture");
    const folder = path.join(root, "utilities", "workshop");
    expect(await readFile(path.join(copy, "SKILL.md"), "utf8")).toBe(`---\nname: workshop-retexture\ndescription: Retextures a model. Use when asked for one.\n---\n\nRun \`python3 ${toPosix(folder)}/skills/retexture/scripts/retexture.py\`.\n`);
    expect(await readFile(path.join(copy, "scripts", "retexture.py"), "utf8")).toBe("print('{{PLUGIN_FOLDER}} stays as it is in a script')\n");
    expect(JSON.parse(await readFile(path.join(copy, MARKER), "utf8"))).toMatchObject({ plugin: "workshop", pluginFolder: folder });
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toMatch(/^node_modules\/\n\n# sc2-adjutant: .*\n\/\.claude\/skills\/workshop-retexture\/\n\/\.claude\/\.sc2-adjutant-skill-\*\.partial\/\n# sc2-adjutant: end of copied skills\n$/);
    // Only the copy is left behind: no staging folder.
    expect((await readdir(path.join(root, ".claude"))).sort()).toEqual(["skills"]);
  });

  it("removes the copy once the Workspace no longer lists the Utility", async () => {
    const root = await workspaceWithUtility();
    await runHook(root);
    await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixture Campaign" } }));
    expect((await runHook(root)).output).toEqual(reloads);
    expect(await readdir(path.join(root, ".claude", "skills"))).toEqual([]);
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe("node_modules/\n");
  });

  it("never touches a skill folder without the marker, even one of a listed skill's name", async () => {
    const root = await workspaceWithUtility();
    const own = path.join(root, ".claude", "skills", "own-skill");
    const sameName = path.join(root, ".claude", "skills", "workshop-retexture");
    await mkdir(own, { recursive: true });
    await mkdir(sameName, { recursive: true });
    await writeFile(path.join(own, "SKILL.md"), "the author's own\n");
    await writeFile(path.join(sameName, "SKILL.md"), "the author's own retexture\n");
    const { output } = await runHook(root);
    expect(output).toMatchObject(reloads);
    expect(output?.systemMessage).toBe("sc2-adjutant: Plugin workshop's skill workshop-retexture wasn't copied: .claude/skills/workshop-retexture is already there and wasn't copied from a Plugin, so it is left as it is.");
    expect(await readFile(path.join(own, "SKILL.md"), "utf8")).toBe("the author's own\n");
    expect(await readdir(sameName)).toEqual(["SKILL.md"]);
    expect(await readFile(path.join(sameName, "SKILL.md"), "utf8")).toBe("the author's own retexture\n");
    // Unlisting the Utility leaves both alone too.
    await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixture Campaign" } }));
    await runHook(root);
    expect((await readdir(path.join(root, ".claude", "skills"))).sort()).toEqual(["own-skill", "workshop-retexture"]);
  });

  it.each([
    ["outside the Plugin's folder", (root: string) => path.join(root, "sc2-adjutant.workspace.json"), "a link that leads outside the Plugin's folder"],
    ["nowhere", (root: string) => path.join(root, "gone"), "a link that leads nowhere"],
    ["back into its own folder", () => ".", "a link back into a folder that holds it"],
  ])("skips a skill holding a link %s, and copies the others", async (_, target, why) => {
    const root = await workspaceWithUtility();
    const utility = path.join(root, "utilities", "workshop");
    await mkdir(path.join(utility, "skills", "broken"), { recursive: true });
    await writeFile(path.join(utility, "skills", "broken", "SKILL.md"), "---\nname: broken\ndescription: Breaks.\n---\n");
    await symlink(target(root), path.join(utility, "skills", "broken", "link"));
    await writeFile(path.join(utility, "sc2-adjutant-plugin.json"), JSON.stringify({ name: "workshop", version: "0.1.0", pluginApi: 2, roles: ["utility"], contributions: { skills: ["skills/broken", "skills/retexture"] } }));
    const { output } = await runHook(root);
    expect(output).toMatchObject(reloads);
    expect(output?.systemMessage).toBe(`sc2-adjutant: Plugin workshop's skill workshop-broken wasn't copied: its link is ${why}.`);
    expect(await readdir(path.join(root, ".claude", "skills"))).toEqual(["workshop-retexture"]);
  });

  it("rewrites its .gitignore block in place, even with its end line deleted, keeping the author's lines", async () => {
    const root = await workspaceWithUtility();
    await runHook(root);
    const gitignore = path.join(root, ".gitignore");
    const text = await readFile(gitignore, "utf8");
    await writeFile(gitignore, `${text.replace("# sc2-adjutant: end of copied skills\n", "")}output/\n`);
    await runHook(root);
    expect(await readFile(gitignore, "utf8")).toBe(`${text}output/\n`);
  });

  it("refreshes a copy whose source changed, and leaves one that didn't", async () => {
    const root = await workspaceWithUtility();
    await runHook(root);
    const copy = path.join(root, ".claude", "skills", "workshop-retexture", "SKILL.md");
    await writeFile(copy, "edited by hand\n");
    await runHook(root);
    expect(await readFile(copy, "utf8")).toBe("edited by hand\n");
    await writeFile(path.join(root, "utilities", "workshop", "skills", "retexture", "SKILL.md"), "---\nname: retexture\ndescription: Changed. Use when asked.\n---\n");
    await runHook(root);
    expect(await readFile(copy, "utf8")).toContain("description: Changed.");
  });

  it("keeps the name of a skill named as its Plugin is, or already starting with its Plugin's name", async () => {
    const root = await workspaceWithUtility();
    const utility = path.join(root, "utilities", "workshop");
    for (const name of ["workshop", "workshop-rescale"]) {
      await mkdir(path.join(utility, "skills", name), { recursive: true });
      await writeFile(path.join(utility, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: Retextures. Use when asked.\n---\n`);
    }
    await writeManifest(utility, "workshop", ["skills/workshop", "skills/workshop-rescale"]);
    expect((await runHook(root)).output).toEqual(reloads);
    expect((await readdir(path.join(root, ".claude", "skills"))).sort()).toEqual(["workshop", "workshop-rescale"]);
    expect(await readFile(path.join(root, ".claude", "skills", "workshop", "SKILL.md"), "utf8")).toBe("---\nname: workshop\ndescription: Retextures. Use when asked.\n---\n");
  });

  it("sets a name written over several lines in full", async () => {
    const root = await workspaceWithUtility();
    await writeFile(path.join(root, "utilities", "workshop", "skills", "retexture", "SKILL.md"), "---\nname: >-\n  retexture\ndescription: Retextures. Use when asked.\n---\n");
    await runHook(root);
    expect(await readFile(path.join(root, ".claude", "skills", "workshop-retexture", "SKILL.md"), "utf8")).toBe("---\nname: workshop-retexture\ndescription: Retextures. Use when asked.\n---\n");
  });

  it("names a scoped Plugin's copies without its @ and with a hyphen for its slash", async () => {
    const root = await workspaceWithUtility();
    await writeManifest(path.join(root, "utilities", "workshop"), "@team/work.shop", ["skills/retexture"]);
    expect((await runHook(root)).output).toEqual(reloads);
    expect(await readdir(path.join(root, ".claude", "skills"))).toEqual(["team-work-shop-retexture"]);
    expect(await readFile(path.join(root, ".claude", "skills", "team-work-shop-retexture", "SKILL.md"), "utf8")).toMatch(/^---\nname: team-work-shop-retexture\n/);
  });

  it("removes a copy made under a skill's old, unprefixed name", async () => {
    const root = await workspaceWithUtility();
    const old = path.join(root, ".claude", "skills", "retexture");
    await mkdir(old, { recursive: true });
    await writeFile(path.join(old, "SKILL.md"), "---\nname: retexture\n---\n");
    await writeFile(path.join(old, MARKER), JSON.stringify({ plugin: "workshop", pluginFolder: path.join(root, "utilities", "workshop"), fingerprint: "old" }));
    expect((await runHook(root)).output).toEqual(reloads);
    expect(await readdir(path.join(root, ".claude", "skills"))).toEqual(["workshop-retexture"]);
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).not.toContain("/.claude/skills/retexture/");
  });

  it("leaves Python's __pycache__ folders and .pyc files out of a copy, and out of what makes it change", async () => {
    const root = await workspaceWithUtility();
    const scripts = path.join(root, "utilities", "workshop", "skills", "retexture", "scripts");
    await mkdir(path.join(scripts, "__pycache__"), { recursive: true });
    await writeFile(path.join(scripts, "__pycache__", "retexture.cpython-312.pyc"), "bytecode");
    await writeFile(path.join(scripts, "stray.pyc"), "bytecode");
    await runHook(root);
    const copy = path.join(root, ".claude", "skills", "workshop-retexture");
    expect(await readdir(path.join(copy, "scripts"))).toEqual(["retexture.py"]);
    // Running the scripts writes new bytecode; the copy is left as it is.
    await writeFile(path.join(copy, "SKILL.md"), "edited by hand\n");
    await writeFile(path.join(scripts, "__pycache__", "retexture.cpython-312.pyc"), "new bytecode");
    await writeFile(path.join(scripts, "stray.pyc"), "new bytecode");
    await runHook(root);
    expect(await readFile(path.join(copy, "SKILL.md"), "utf8")).toBe("edited by hand\n");
  });

  it("writes nothing outside a Workspace", async () => {
    const folder = await scratch();
    const { output, stderr } = await runHook(folder);
    expect(output).toBeUndefined();
    expect(stderr).toBe("");
    expect(await readdir(folder)).toEqual([]);
  });

  it("copies a Style Pack's skill the same way", async () => {
    const root = await scratch();
    await cp(FIELD, root, { recursive: true });
    expect((await runHook(path.join(root, "missions"))).output).toEqual(reloads);
    const copy = path.join(root, ".claude", "skills", "example-pack-dressing-review");
    const pack = path.join(root, "plugins", "example-pack");
    expect(await readFile(path.join(copy, "SKILL.md"), "utf8")).toContain(`python3 ${toPosix(pack)}/skills/dressing-review/scripts/count.py`);
    expect(await readFile(path.join(copy, "SKILL.md"), "utf8")).toMatch(/^---\nname: example-pack-dressing-review\n/);
    expect(await readFile(path.join(copy, "scripts", "count.py"), "utf8")).toBe('print("count")\n');
    expect(JSON.parse(await readFile(path.join(copy, MARKER), "utf8"))).toMatchObject({ plugin: "example-pack", pluginFolder: pack });
  });
});
