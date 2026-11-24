// Reading the game's GameLogs folder: which files belong to one game session, and the distinct
// errors in them. The folder is each Host Adapter's (`game.logsFolder`); the reading is the same
// on every machine, so it lives here and runs over a fixture folder in tests.
//
// What the folder looks like (Mac, 2026-11-24): files named `<YYYY-MM-DD HH.MM.SS> <Channel>.txt`
// in local time, the stamp being when the game made the file. The game writes them as it exits, so
// a session's files can be created minutes apart (Graphics and SystemInfo at start; Alerts,
// ScriptError and Text a little later; UI, Cutscenes whenever they're first needed) and are all
// modified at the quit. A crash or an error makes a folder `<stamp> <computer> B<build> P<pid> Crash`
// (or `Error`) holding that session's files and the crash report. Most files open with a header
// block (`<Parameters>`, the game's command line, is in it); Text.txt has none.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/** A file of one session: its channel is the name after the stamp (`Alerts`, `ScriptError`, …). */
export type GameLogFile = {
  readonly path: string;
  readonly channel: string;
  /** When the game made it, from its name. */
  readonly createdAt: Date;
  readonly modifiedAt: Date;
};

/** A crash or an error report's folder. */
export type GameCrash = {
  readonly kind: "Crash" | "Error";
  readonly folder: string;
  /** The game's process id, from the folder's name: the way to know a crash is a game the tool started. */
  readonly pid: number;
  readonly at: Date;
  /** The report file in the folder, if there is one. */
  readonly report?: string;
};

export type GameSession = {
  /** The earliest of its files. */
  readonly startedAt: Date;
  /** The latest a file of it was modified: the quit, for a game that quit. */
  readonly endedAt: Date;
  /** The game's command line, from a file header; absent when no file has a header. */
  readonly parameters?: string;
  readonly files: readonly GameLogFile[];
  readonly crash?: GameCrash;
};

/** The channels whose lines are what went wrong. SystemInfo, Graphics and the rest only describe the machine. */
export const ERROR_CHANNELS: readonly string[] = ["ScriptError", "Alerts", "Text", "UI", "Cutscenes"];

const STAMP = /^(\d{4})-(\d\d)-(\d\d) (\d\d)\.(\d\d)\.(\d\d) (.+)$/;
const CRASH_FOLDER = /^(.+) B\d+ P(\d+) (Crash|Error)$/;

function stampOf(name: string): { readonly at: Date; readonly rest: string } | undefined {
  const match = STAMP.exec(name);
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s, rest] = match;
  return { at: new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)), rest: rest! };
}

async function fileOf(filePath: string, channel: string, createdAt: Date): Promise<GameLogFile> {
  return { path: filePath, channel, createdAt, modifiedAt: (await stat(filePath)).mtime };
}

/** The `<Parameters>` line of a file's header, if it has one; only its first few kilobytes are read. */
async function parametersOf(file: GameLogFile): Promise<string | undefined> {
  const text = (await readFile(file.path, "utf8")).slice(0, 4096);
  return /<Parameters>[ \t]+(.+)/.exec(text)?.[1]?.trim();
}

/**
 * Every session in a GameLogs folder, oldest first. Files are grouped in the order the game made
 * them: a file joins the latest group that has no file of its channel yet and whose command line
 * agrees (a file with no header, such as Text, agrees with any), else it starts a group. Time alone
 * can't group them, since one session's files are made minutes or an hour apart. A crash or error
 * folder is one session, its own files in it. Files of a game still running are read as they are.
 */
export async function readGameSessions(folder: string): Promise<GameSession[]> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const loose: GameLogFile[] = [];
  const crashes: { crash: Omit<GameCrash, "report">; dir: string; name: string }[] = [];
  for (const entry of entries) {
    const stamped = stampOf(entry.name);
    if (!stamped) continue;
    if (entry.isDirectory()) {
      const match = CRASH_FOLDER.exec(stamped.rest);
      if (match) crashes.push({ crash: { kind: match[3] as GameCrash["kind"], folder: path.join(folder, entry.name), pid: Number(match[2]), at: stamped.at }, dir: path.join(folder, entry.name), name: entry.name });
    } else if (entry.isFile() && entry.name.endsWith(".txt")) {
      loose.push(await fileOf(path.join(folder, entry.name), stamped.rest.slice(0, -".txt".length), stamped.at));
    }
  }
  loose.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.path.localeCompare(b.path));

  type Group = { files: GameLogFile[]; parameters?: string };
  const groups: Group[] = [];
  for (const file of loose) {
    const parameters = await parametersOf(file);
    const home = [...groups].reverse().find((group) => !group.files.some((each) => each.channel === file.channel) && (!parameters || !group.parameters || group.parameters === parameters));
    if (home) {
      home.files.push(file);
      if (parameters && !home.parameters) home.parameters = parameters;
    } else groups.push({ files: [file], ...(parameters ? { parameters } : {}) });
  }
  const sessions: GameSession[] = groups.map(({ files, parameters }) => sessionOf(files, parameters));

  for (const { crash, dir, name } of crashes) {
    const files: GameLogFile[] = [];
    let report: string | undefined;
    for (const inner of await readdir(dir, { withFileTypes: true })) {
      if (!inner.isFile() || !inner.name.endsWith(".txt")) continue;
      if (inner.name === `${name}.txt`) report = path.join(dir, inner.name);
      // The crash's own files (report, NGDP, Streaming, Variables) carry the folder's name after the stamp; the session's are plain channels.
      const stamped = stampOf(inner.name);
      if (stamped && !stamped.rest.startsWith(stampOf(name)!.rest)) files.push(await fileOf(path.join(dir, inner.name), stamped.rest.slice(0, -".txt".length), stamped.at));
    }
    let parameters: string | undefined;
    for (const file of files) parameters ??= await parametersOf(file);
    sessions.push(sessionOf(files, parameters, { ...crash, ...(report ? { report } : {}) }));
  }
  return sessions.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

function sessionOf(files: readonly GameLogFile[], parameters: string | undefined, crash?: GameCrash): GameSession {
  const created = files.map((file) => file.createdAt.getTime());
  const modified = files.map((file) => file.modifiedAt.getTime());
  const startedAt = new Date(Math.min(...created, ...(crash ? [crash.at.getTime()] : [])));
  const endedAt = new Date(Math.max(...modified, ...(crash ? [crash.at.getTime()] : [])));
  return { startedAt, endedAt, ...(parameters ? { parameters } : {}), files, ...(crash ? { crash } : {}) };
}

/** Which sessions a tool run's own: started in the window, and either its map named in the command line or its game's crash. */
export type SessionSelection = {
  /** Sessions started at or after this, with a little slack for the stamp's whole seconds. */
  readonly after?: Date;
  /** Sessions started before this. */
  readonly before?: Date;
  /** Any of these in the command line: the map's name, or `EditorTest.SC2Map` for a Test Document. */
  readonly parameters?: readonly string[];
  /** The processes of the games the tool started: a crash folder's `P<pid>` names one. */
  readonly pids?: readonly number[];
  /** Only the latest of those that match. */
  readonly latest?: boolean;
};

const SLACK_MS = 2000;

export function selectSessions(sessions: readonly GameSession[], selection: SessionSelection): GameSession[] {
  const matching = sessions.filter((session) => {
    if (selection.after && session.startedAt.getTime() < selection.after.getTime() - SLACK_MS) return false;
    if (selection.before && session.startedAt.getTime() >= selection.before.getTime()) return false;
    if (session.crash && selection.pids?.includes(session.crash.pid)) return true;
    if (!selection.parameters) return true;
    return session.parameters !== undefined && selection.parameters.some((part) => session.parameters!.includes(part));
  });
  return selection.latest ? matching.slice(-1) : matching;
}

/** A distinct error in a session: its message (a trigger error and its `Near line` joined) and how many lines said it. */
export type SessionError = {
  readonly message: string;
  readonly count: number;
  /** The channels that said it. */
  readonly channels: readonly string[];
};

const RULE = /^=+$/;
/** A line's channel prefix in Alerts-style files (`USER 0 0.000 0.062 `) and Text-style ones (`TextError 06:01:32.000 `). */
const PREFIX = /^[A-Za-z]+[ \t]+(?:\d+[ \t]+\d+\.\d+[ \t]+\d+\.\d+|\d\d:\d\d:\d\d\.\d+)[ \t]?/;
/** The `[  13    1]` object stamp some Alerts lines carry: differs per line, so it's not part of the message. */
const OBJECT_STAMP = /^\[\s*[0-9a-f]+\s+\d+\]\s*/i;
/** A throttle notice after an error, not an error of its own. */
const THROTTLE = /^Final report for this error/;

/** The messages of one file, repeats included, in order: its header skipped, a continuation line joined to its error. */
export function parseLogMessages(text: string): string[] {
  const messages: string[] = [];
  let inHeader: boolean | undefined;
  let headerRules = 0;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.replace(PREFIX, "");
    if (inHeader === undefined) {
      if (line.trim() === "") continue;
      inHeader = RULE.test(line.trim());
      if (inHeader) {
        headerRules = 1;
        continue;
      }
    } else if (inHeader) {
      if (RULE.test(line.trim())) {
        headerRules++;
        if (headerRules === 2) inHeader = false;
      }
      continue;
    }
    if (line.trim() === "" || RULE.test(line.trim())) continue;
    const text = line.replace(OBJECT_STAMP, "");
    if (THROTTLE.test(text.trim())) continue;
    if (/^\s/.test(line) && messages.length > 0) messages[messages.length - 1] += ` | ${text.trim()}`;
    else messages.push(text.trim());
  }
  return messages;
}
/** The distinct errors across a session's error channels, most frequent first. */
export async function readSessionErrors(session: GameSession): Promise<SessionError[]> {
  const found = new Map<string, { count: number; channels: Set<string> }>();
  for (const file of session.files) {
    if (!ERROR_CHANNELS.includes(file.channel)) continue;
    for (const message of parseLogMessages(await readFile(file.path, "utf8"))) {
      const entry = found.get(message) ?? { count: 0, channels: new Set<string>() };
      entry.count++;
      entry.channels.add(file.channel);
      found.set(message, entry);
    }
  }
  return [...found].map(([message, { count, channels }]) => ({ message, count, channels: [...channels] })).sort((a, b) => b.count - a.count || a.message.localeCompare(b.message));
}
