// The PostToolUse hook: after an Edit or Write inside a compiled package (a `*.SC2Map/` or
// `*.SC2Mod/` folder), or a Bash command that names one and has a write-like token, it adds context
// telling Claude to offer the report-missing-feature skill once if the edit works around missing
// support. Once per package per session. Run here as Claude Code runs it: a process given the
// hook's input on stdin, with its marker files in a scratch temp folder.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, describe, expect, it } from "vitest";

const PLUGIN = fileURLToPath(new URL("../", import.meta.url));
const HOOK = path.join(PLUGIN, "hooks", "hand-edit.mjs");
/** The folder under the OS temp folder that holds a folder of marker files per session. */
const MARKERS = "sc2-adjutant-hand-edits";
const MAP = "missions/x/Name.SC2Map";

const made: string[] = [];
afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), "sc2-adjutant-hand-edit-hook-")));
  made.push(folder);
  return folder;
}

/** A session's working folder, the OS temp folder the hook sees (where its marker files go), and its id. */
type Session = { readonly cwd: string; readonly temp: string; readonly id: string };

async function session(): Promise<Session> {
  return { cwd: await scratch(), temp: await scratch(), id: "session-1" };
}

type Ran = { output: Record<string, unknown> | undefined; stdout: string; stderr: string };

/** Runs the hook on `stdin` as given, in a session's folders, and parses what it prints. */
async function runHookOn(at: Session, stdin: string): Promise<Ran> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const child = promisify(execFile)(process.execPath, [HOOK], { env: { ...env, TMPDIR: at.temp, TMP: at.temp, TEMP: at.temp, CLAUDE_PLUGIN_ROOT: PLUGIN }, cwd: at.cwd });
  child.child.stdin!.end(stdin);
  const { stdout, stderr } = await child;
  return { output: stdout.trim() ? (JSON.parse(stdout) as Record<string, unknown>) : undefined, stdout, stderr };
}

/** Runs the hook as Claude Code does after a tool call, with `overrides` replacing input fields. */
async function runHook(at: Session, toolName: string, toolInput: Record<string, unknown>, overrides: Record<string, unknown> = {}): Promise<Ran> {
  const input = { session_id: at.id, cwd: at.cwd, hook_event_name: "PostToolUse", tool_name: toolName, tool_input: toolInput, tool_response: {}, ...overrides };
  return runHookOn(at, JSON.stringify(input));
}

/** The packages the note names, or [] with no note; it fails on anything but a clean PostToolUse note. */
async function noted(at: Session, toolName: string, toolInput: Record<string, unknown>): Promise<string[]> {
  const { output, stderr } = await runHook(at, toolName, toolInput);
  expect(stderr).toBe("");
  if (output === undefined) return [];
  expect(Object.keys(output)).toEqual(["hookSpecificOutput"]);
  const { hookEventName, additionalContext, ...rest } = output.hookSpecificOutput as { hookEventName: string; additionalContext: string };
  expect({ hookEventName, rest }).toEqual({ hookEventName: "PostToolUse", rest: {} });
  expect(additionalContext).toContain("report-missing-feature");
  return /\((.*?) (?:is a compiled package|are compiled packages):/.exec(additionalContext)![1]!.split(", ");
}

describe("the hand-edit hook", () => {
  it("notes an Edit or Write inside a package, keyed by its absolute path", async () => {
    const at = await session();
    expect(await noted(at, "Edit", { file_path: `${MAP}/Triggers`, old_string: "a", new_string: "b" })).toEqual([path.join(at.cwd, MAP)]);
    expect(await noted(at, "Write", { file_path: path.join(at.cwd, "missions/y/Other.SC2Mod/Base.SC2Data/GameData/UnitData.xml"), content: "" })).toEqual([path.join(at.cwd, "missions/y/Other.SC2Mod")]);
  });

  it.each([
    ["an Edit of a Blueprint", "Edit", { file_path: "missions/x/blueprint.json" }],
    ["a Write outside any package", "Write", { file_path: "/elsewhere/notes.txt" }],
    ["a Write of a file named like a package", "Write", { file_path: MAP }],
    ["an Edit under a Mission's output folder", "Edit", { file_path: "missions/x/output/Test.SC2Map/Triggers" }],
    ["a Bash write under a Mission's output folder", "Bash", { command: "rm -rf missions/x/output/Test.SC2Map" }],
    ["a compile", "Bash", { command: "npm run compile-map -- missions/x/blueprint.json > /tmp/log" }],
    ["cat", "Bash", { command: `cat ${MAP}/MapScript.galaxy 2>&1` }],
    ["grep", "Bash", { command: `grep -rn Trigger ${MAP} 2>/dev/null | head -20` }],
    ["sed -n", "Bash", { command: `sed -n '1,20p' ${MAP}/MapScript.galaxy` }],
    ["git diff", "Bash", { command: `git diff -- ${MAP}` }],
    ["a > inside quotes", "Bash", { command: "grep '</Trigger>' Name.SC2Map/Triggers" }],
  ])("adds nothing after %s", async (_, toolName, toolInput) => {
    const at = await session();
    expect(await noted(at, toolName, toolInput)).toEqual([]);
    expect(await readdir(at.temp)).toEqual([]);
  });

  it("places output/ from the Workspace config's missions folder", async () => {
    const at = await session();
    await writeFile(path.join(at.cwd, "sc2-adjutant.workspace.json"), JSON.stringify({ missions: "maps" }));
    expect(await noted(at, "Edit", { file_path: "maps/x/output/Test.SC2Map/Triggers" })).toEqual([]);
    expect(await noted(at, "Edit", { file_path: "MAPS/x/output/Test.SC2Map/Triggers" })).toHaveLength(process.platform === "darwin" || process.platform === "win32" ? 0 : 1);
    expect(await noted(at, "Edit", { file_path: "missions/x/output/Test.SC2Map/Triggers" })).toEqual([path.join(at.cwd, "missions/x/output/Test.SC2Map")]);
  });

  it.each([
    ["sed -i", `sed -i '' 's/a/b/' ${MAP}/MapScript.galaxy`, [MAP]],
    ["a > redirect", `echo x >> "${MAP}/Triggers"`, [MAP]],
    ["a >& redirect to a file", `make >& ${MAP}/log`, [MAP]],
    ["rm of the bare package", `rm -rf ${MAP} missions/y/Other.SC2Mod`, [MAP, "missions/y/Other.SC2Mod"]],
    ["a python write", `python3 -c "open('${MAP}/T', 'w').write('x')"`, [MAP]],
    ["an absolute path", "perl -pi -e 's/a/b/' /maps/Name.SC2Map/T", ["/maps/Name.SC2Map"]],
    ["a ~/ path", "touch ~/maps/Name.SC2Map/T", [path.join(os.homedir(), "maps/Name.SC2Map")]],
    ["a redirect after a quoted >", "echo '<a>' > N.SC2Map/T", ["N.SC2Map"]],
    ["sed -i on a quoted package path", `sed -i '' s/a/b/ "missions/x/N.SC2Map/T"`, ["missions/x/N.SC2Map"]],
    ["a quoted python write", `python3 -c "open('missions/x/N.SC2Map/T','w')"`, ["missions/x/N.SC2Map"]],
  ])("notes a Bash command with a write and a package path (%s), keying it as written", async (_, command, packages) => {
    const at = await session();
    // An absolute path is resolved as the OS resolves it in the hook's folder: on Windows, with that folder's drive letter and backslashes.
    expect(await noted(at, "Bash", { command })).toEqual(packages.map((pkg) => (path.isAbsolute(pkg) ? path.resolve(at.cwd, pkg) : pkg)));
  });

  it("notes a failed call as PostToolUseFailure", async () => {
    const at = await session();
    const { output } = await runHook(at, "Bash", { command: `rm ${MAP}/T` }, { hook_event_name: "PostToolUseFailure", error: "Exit code 1" });
    expect(output).toEqual({ hookSpecificOutput: { hookEventName: "PostToolUseFailure", additionalContext: expect.stringContaining(MAP) } });
  });

  it("notes a package once per session, with a marker file per package in a folder for the session", async () => {
    const at = await session();
    expect(await noted(at, "Edit", { file_path: `${MAP}/Triggers` })).toHaveLength(1);
    expect(await noted(at, "Write", { file_path: `${MAP}/MapScript.galaxy` })).toEqual([]);
    expect(await noted(at, "Edit", { file_path: "missions/y/Other.SC2Map/T" })).toHaveLength(1);
    expect(await noted({ ...at, id: "session-2" }, "Edit", { file_path: `${MAP}/Triggers` })).toHaveLength(1);
    expect((await readdir(path.join(at.temp, MARKERS))).sort()).toEqual(["session-1", "session-2"]);
    expect(await readdir(path.join(at.temp, MARKERS, "session-1"))).toHaveLength(2);
  });

  it("gives the note to exactly one of several calls on the same package running at once", async () => {
    const at = await session();
    const runs = await Promise.all(Array.from({ length: 8 }, (_, i) => runHook(at, "Edit", { file_path: `${MAP}/File${i}` })));
    expect(runs.filter((run) => run.stdout !== "")).toHaveLength(1);
    expect(runs.map((run) => run.stderr)).toEqual(Array(8).fill(""));
  });

  it("deletes marker folders untouched for over a week, and keeps newer ones", async () => {
    const at = await session();
    const old = path.join(at.temp, MARKERS, "old-session");
    await mkdir(old, { recursive: true });
    await mkdir(path.join(at.temp, MARKERS, "recent-session"));
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(old, eightDaysAgo, eightDaysAgo);
    await runHook(at, "Edit", { file_path: `${MAP}/Triggers` });
    expect((await readdir(path.join(at.temp, MARKERS))).sort()).toEqual(["recent-session", "session-1"]);
  });

  it(`${process.platform === "darwin" || process.platform === "win32" ? "folds" : "keeps"} the case of a package's path on ${process.platform}`, async () => {
    const at = await session();
    expect(await noted(at, "Edit", { file_path: `${MAP}/Triggers` })).toHaveLength(1);
    const other = await noted(at, "Edit", { file_path: "missions/x/name.sc2map/MapScript.galaxy" });
    expect(other).toHaveLength(process.platform === "darwin" || process.platform === "win32" ? 0 : 1);
  });

  it.each([
    ["input that isn't JSON", "not json"],
    ["no session id", JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: `${MAP}/T` } })],
    ["no tool input", JSON.stringify({ session_id: "s", hook_event_name: "PostToolUse", tool_name: "Bash" })],
  ])("never blocks, and exits 0 silently on %s", async (_, stdin) => {
    expect(await runHookOn(await session(), stdin)).toEqual({ output: undefined, stdout: "", stderr: "" });
  });

  it("exits 0 silently, with no note, when it can't make its marker folder", async () => {
    const at = await session();
    await writeFile(path.join(at.temp, MARKERS), "not a folder");
    expect(await runHook(at, "Edit", { file_path: `${MAP}/Triggers` })).toEqual({ output: undefined, stdout: "", stderr: "" });
  });

  it("is the plugin's PostToolUse and PostToolUseFailure hook on Edit, Write and Bash", async () => {
    const hooks = JSON.parse(await readFile(path.join(PLUGIN, "hooks", "hooks.json"), "utf8"));
    expect(hooks.hooks.PostToolUse).toEqual([{ matcher: "Edit|Write|Bash", hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/hand-edit.mjs"' }] }]);
    expect(hooks.hooks.PostToolUseFailure).toEqual(hooks.hooks.PostToolUse);
  });
});
