// Reading a fixture GameLogs folder: files grouped by session, a crash reported, a known error
// counted but not new, and a Mission's list adding to the Workspace's. The folders are synthetic,
// built in the shape the game leaves (docs/reference/game-testing.md §4); no game runs.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatRunLogReport, reportRunLogs } from "../../src/host/game-run-report.js";
import { parseLogMessages, readGameSessions, selectSessions } from "../../src/host/game-logs.js";
import type { Host } from "../../src/host/host.js";
import { emptyMachineConfig } from "../../src/host/machine-config.js";
import { KNOWN_ERRORS_FILE, parseKnownErrors } from "../../src/host/known-errors.js";
import { tempFolder } from "../mcp/harness.js";

const RUN = "-run Test/EditorTest.SC2Map -displaymode 2 -preload 1";
const COPY_RUN = "-run /cache/capture/maps/shots-a.SC2Map -displaymode 2 -preload 1";
const RULE = "=".repeat(100);

/** A file's header block, as the game writes it: a rule, the build, the command line, a rule. */
const header = (parameters: string, prefix = ""): string =>
  [RULE, "StarCraft II (B1)", "", `Executable              /games/SC2.app`, `<Parameters>            ${parameters}`, `LocalTime               2026-01-01 00:00:00.000`, RULE].map((line) => `${prefix}${line}`).join("\n");

const alertsPrefix = "USER                  0    0.000    0.062 ";
const alerts = (parameters: string, ...messages: string[]) => `﻿${header(parameters, alertsPrefix)}\n${messages.map((message) => `${alertsPrefix}${message}`).join("\n")}\n`;
const scriptError = (parameters: string, ...blocks: string[]) => `﻿${header(parameters)}\n${blocks.join("\n")}\n`;
const text = (...messages: string[]) => `﻿${messages.map((message) => `TextError 06:01:32.000 ${message}`).join("\n")}\n`;

async function put(folder: string, name: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(folder, name)), { recursive: true });
  await writeFile(path.join(folder, name), content);
}

const AUTHOR_RUN_ERROR = "Calling 'SomeNative' is not authorized | Near line 7 in lib_gf_Start() in Lib.galaxy";

/** Two sessions of the author's Test Document, one capture's, and a capture that crashed. */
async function fixtureLogs(): Promise<string> {
  const folder = await tempFolder();
  // Session one: the files made over an hour, so no gap separates them from the next session's.
  await put(folder, "2026-03-01 10.00.00 SystemInfo.txt", "");
  await put(folder, "2026-03-01 10.00.04 Graphics.txt", `${header(RUN, "GFX  00:00:00.000 ")}\n`);
  await put(folder, "2026-03-01 10.00.20 Alerts.txt", alerts(RUN, "[  13    1] Model produces empty bounds", "[  1e    1] Model produces empty bounds"));
  await put(folder, "2026-03-01 10.00.21 ScriptError.txt", scriptError(RUN, "Calling 'SomeNative' is not authorized", "   Near line 7 in lib_gf_Start() in Lib.galaxy", "Final report for this error this game."));
  await put(folder, "2026-03-01 10.00.21 Text.txt", text("Cannot load font file [x.ttf]."));
  await put(folder, "2026-03-01 11.15.00 UI.txt", `${header(RUN)}\nInvalid property binding in frame\n`);
  // Session two, same command line: SystemInfo again starts a new group.
  await put(folder, "2026-03-01 12.00.00 SystemInfo.txt", "");
  await put(folder, "2026-03-01 12.00.20 Alerts.txt", alerts(RUN, "A fresh warning"));
  // A capture's session, naming its copy.
  await put(folder, "2026-03-01 13.00.00 SystemInfo.txt", "");
  await put(folder, "2026-03-01 13.00.20 ScriptError.txt", scriptError(COPY_RUN, "Trigger Error in 'x': boom", "   Near line 3 in x() in MapScript.galaxy"));
  await put(folder, "2026-03-01 13.00.21 Text.txt", text("Cannot load font file [x.ttf]."));
  // A crash: a folder with its session's files and the report.
  const crash = "2026-03-01 14.05.00 A Computer B98310 P4242 Crash";
  await put(folder, `${crash}/2026-03-01 14.00.00 Graphics.txt`, `${header(COPY_RUN, "GFX  00:00:00.000 ")}\n`);
  await put(folder, `${crash}/2026-03-01 14.00.30 Alerts.txt`, alerts(COPY_RUN, "Last words"));
  await put(folder, `${crash}/${crash}.txt`, "report");
  await put(folder, `${crash}/${crash} NGDP.txt`, "n");
  await put(folder, `${crash}/${crash}.SC2Replay`, "r");
  await put(folder, `${crash}/mac.log`, "m");
  return folder;
}

function hostFor(folder: string, cacheDir?: string): Host {
  return {
    machine: { ...emptyMachineConfig(), ...(cacheDir ? { cacheDir } : {}) },
    adapter: undefined,
    has: (name) => name === "game.logsFolder",
    run: (async () => folder) as Host["run"],
  };
}

describe("reading a GameLogs folder", () => {
  it("groups a session's files by the order the game made them, however far apart, and the crash folder as one session", async () => {
    const sessions = await readGameSessions(await fixtureLogs());
    expect(sessions.map((session) => [session.files.map((file) => file.channel), session.crash?.pid])).toEqual([
      [["SystemInfo", "Graphics", "Alerts", "ScriptError", "Text", "UI"], undefined],
      [["SystemInfo", "Alerts"], undefined],
      [["SystemInfo", "ScriptError", "Text"], undefined],
      [["Graphics", "Alerts"], 4242],
    ]);
    expect(sessions[0]!.parameters).toBe(RUN);
    expect(sessions[3]!.crash).toMatchObject({ kind: "Crash", pid: 4242 });
    expect(sessions[3]!.crash!.report).toMatch(/Crash\.txt$/);
  });

  it("reads no folder as no sessions", async () => {
    expect(await readGameSessions(path.join(await tempFolder(), "none"))).toEqual([]);
  });

  it("selects the sessions that started in the window and name the map, or whose crash is the tool's game", async () => {
    const sessions = await readGameSessions(await fixtureLogs());
    const after = new Date(2026, 2, 1, 12, 30);
    expect(selectSessions(sessions, { after, parameters: ["shots-a.SC2Map"] }).map((session) => session.startedAt.getHours())).toEqual([13, 14]);
    expect(selectSessions(sessions, { after, parameters: ["shots-b.SC2Map"], pids: [4242] }).map((session) => session.crash?.pid)).toEqual([4242]);
    expect(selectSessions(sessions, { parameters: ["EditorTest.SC2Map"], latest: true }).map((session) => session.startedAt.getHours())).toEqual([12]);
  });

  it("joins a trigger error with its location, drops the header and the throttle notice, and keeps each line of a repeat", () => {
    const messages = parseLogMessages(scriptError(RUN, "Calling 'SomeNative' is not authorized", "   Near line 7 in lib_gf_Start() in Lib.galaxy", "Final report for this error this game.", "Calling 'SomeNative' is not authorized", "   Near line 7 in lib_gf_Start() in Lib.galaxy"));
    expect(messages).toEqual([AUTHOR_RUN_ERROR, AUTHOR_RUN_ERROR]);
    expect(parseLogMessages(alerts(RUN, "[  13    1] Model produces empty bounds"))).toEqual(["Model produces empty bounds"]);
    expect(parseLogMessages(text("Cannot load font file [x.ttf]."))).toEqual(["Cannot load font file [x.ttf]."]);
  });
});

describe("a run's report", () => {
  const selection = { after: new Date(2026, 2, 1, 12, 30), parameters: ["shots-a.SC2Map", "EditorTest.SC2Map"], pids: [4242] };

  it("reports the crash and each distinct error with its count, all new with no lists", async () => {
    const workspace = await tempFolder();
    const report = await reportRunLogs({ host: hostFor(await fixtureLogs()), workspaceRoot: workspace, selection });
    expect(report.sessions).toHaveLength(2);
    expect(report.sessions[1]!.crash).toMatchObject({ kind: "Crash" });
    expect(report.sessions[0]!.errors).toEqual([
      { message: "Cannot load font file [x.ttf].", count: 1, channels: ["Text"] },
      { message: "Trigger Error in 'x': boom | Near line 3 in x() in MapScript.galaxy", count: 1, channels: ["ScriptError"] },
    ]);
    expect(report.sessions.map((session) => session.newErrors)).toEqual([2, 1]);
    expect(formatRunLogReport(report, "Game logs").join("\n")).toContain("CRASH");
  });

  it("counts a known error but doesn't call it new, and a Mission's list adds to the Workspace's", async () => {
    const workspace = await tempFolder();
    const mission = path.join(workspace, "missions", "one");
    await put(workspace, KNOWN_ERRORS_FILE, JSON.stringify({ patterns: [{ match: "Cannot load font file", reason: "the Mac has no Courier", added: "2026-03-01" }] }));
    const options = { host: hostFor(await fixtureLogs()), workspaceRoot: workspace, selection: { ...selection, pids: [] as number[], parameters: ["shots-a.SC2Map"] } };

    const workspaceOnly = await reportRunLogs(options);
    const [session] = workspaceOnly.sessions;
    expect(session!.errors.find((error) => error.message.startsWith("Cannot load font"))).toMatchObject({ count: 1, known: { level: "workspace", reason: "the Mac has no Courier" } });
    expect(session!.newErrors).toBe(1);

    await put(mission, KNOWN_ERRORS_FILE, JSON.stringify({ patterns: [{ match: "Trigger Error in 'x'", reason: "x is a stub in this Mission", added: "2026-03-01" }] }));
    const both = await reportRunLogs({ ...options, missionDir: mission });
    expect(both.sessions[0]!.newErrors).toBe(0);
    expect(both.sessions[0]!.errors.map((error) => error.known?.level).sort()).toEqual(["mission", "workspace"]);
    // The Mission's own list is for that Mission only.
    expect((await reportRunLogs(options)).sessions[0]!.newErrors).toBe(1);
  });

  it("proposes a pattern for a new error without writing one", async () => {
    const workspace = await tempFolder();
    const report = await reportRunLogs({ host: hostFor(await fixtureLogs()), workspaceRoot: workspace, selection });
    const lines = formatRunLogReport(report, "Game logs", new Date("2026-03-02T00:00:00Z"));
    expect(lines.some((line) => line.includes('"match":"Cannot load font file [x.ttf]."') && line.includes("TODO(author)") && line.includes('"added":"2026-03-02"'))).toBe(true);
    await expect(readGameSessions(workspace)).resolves.toEqual([]);
  });

  it("flags a pattern no run has matched for 30 days, and not one that matched lately", async () => {
    const workspace = await tempFolder();
    const cache = await tempFolder();
    await put(
      workspace,
      KNOWN_ERRORS_FILE,
      JSON.stringify({
        patterns: [
          { match: "Cannot load font file", reason: "no Courier", added: "2026-01-01" },
          { match: "never happens", reason: "old", added: "2026-01-01" },
          { match: "recent pattern", reason: "new", added: "2026-02-20" },
        ],
      }),
    );
    const options = { host: hostFor(await fixtureLogs(), cache), workspaceRoot: workspace, selection, now: new Date("2026-03-02T00:00:00Z") };
    const report = await reportRunLogs(options);
    expect(report.stale.map((pattern) => pattern.match)).toEqual(["never happens"]);
    expect(formatRunLogReport(report, "Game logs").join("\n")).toContain("maybe remove it from known-errors.json");
    // 40 days later, a run with a different error list: the font pattern, last matched on the first run, is now stale too.
    const later = await reportRunLogs({ ...options, now: new Date("2026-04-12T00:00:00Z"), selection: { after: new Date(2026, 2, 1, 11, 50), parameters: ["EditorTest.SC2Map"], latest: true } });
    expect(later.sessions[0]!.errors.map((error) => error.message)).toEqual(["A fresh warning"]);
    expect(later.stale.map((pattern) => pattern.match).sort()).toEqual(["Cannot load font file", "never happens", "recent pattern"]);
  });

  it("says why when the Host Adapter names no folder, or no session matches, or a list is malformed", async () => {
    const workspace = await tempFolder();
    const none = await reportRunLogs({ host: { ...hostFor("x"), has: () => false }, workspaceRoot: workspace, selection });
    expect(none.note).toContain("doesn't name the game's log folder");
    const empty = await reportRunLogs({ host: hostFor(await tempFolder()), workspaceRoot: workspace, selection });
    expect(empty.note).toContain("no game session");
    await put(workspace, KNOWN_ERRORS_FILE, "{ nope");
    const bad = await reportRunLogs({ host: hostFor(await fixtureLogs()), workspaceRoot: workspace, selection });
    expect(bad.note).toContain("known-errors.json isn't JSON");
  });
});

describe("known-error lists", () => {
  const ok = { match: "text", reason: "why", added: "2026-03-01" };

  it("parses a list, a regex pattern included", () => {
    expect(parseKnownErrors(JSON.stringify({ patterns: [ok, { ...ok, match: "^a.*z$", regex: true }] }), "f.json")).toHaveLength(2);
  });

  it.each([
    ["a missing reason", { patterns: [{ match: "x", added: "2026-03-01" }] }, "reason"],
    ["a blank reason", { patterns: [{ ...ok, reason: "  " }] }, "needs a reason"],
    ["a malformed date", { patterns: [{ ...ok, added: "yesterday" }] }, "YYYY-MM-DD"],
    ["a regex that doesn't compile", { patterns: [{ ...ok, match: "(", regex: true }] }, "regular expression"],
    ["a pattern listed twice", { patterns: [ok, ok] }, "listed twice"],
    ["an unknown key", { patterns: [], extra: 1 }, "extra"],
  ])("refuses %s", (_name, list, message) => {
    expect(() => parseKnownErrors(JSON.stringify(list), "known-errors.json")).toThrow(message);
  });
});
