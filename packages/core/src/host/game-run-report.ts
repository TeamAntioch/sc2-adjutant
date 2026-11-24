// What a tool says about a game run's logs: after a run that quit, the crash or error report, each
// distinct error with its count, and which are new, that is, which neither known-error list
// (Workspace, then Mission; known-errors.ts) knows. Also the patterns no run has matched in a
// while, which the author may remove.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Host } from "./host.js";
import { type GameCrash, readGameSessions, readSessionErrors, type SessionSelection, selectSessions } from "./game-logs.js";
import { KNOWN_ERRORS_FILE, knownBy, type ListedPattern, matches, proposePattern, readKnownErrors } from "./known-errors.js";

/** How long a pattern may go unmatched, in days, before the report flags it. */
export const STALE_DAYS = 30;
/** The most distinct errors a report lists for one session; the rest are counted. */
const MAX_LISTED = 12;

export type ReportedError = {
  readonly message: string;
  readonly count: number;
  readonly channels: readonly string[];
  /** The known-error pattern that knows it; absent for a new error. */
  readonly known?: { readonly level: "workspace" | "mission"; readonly list: string; readonly match: string; readonly reason: string };
};

export type SessionReport = {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly parameters?: string;
  readonly crash?: { readonly kind: GameCrash["kind"]; readonly folder: string; readonly report?: string };
  /** Every distinct error, most frequent first. */
  readonly errors: readonly ReportedError[];
  /** How many distinct errors no list knows. */
  readonly newErrors: number;
};

export type StalePattern = { readonly level: "workspace" | "mission"; readonly list: string; readonly match: string; readonly reason: string; readonly days: number };

export type RunLogReport = {
  readonly folder: string;
  readonly sessions: readonly SessionReport[];
  /** Patterns of the lists that applied, which no run has matched for STALE_DAYS. */
  readonly stale: readonly StalePattern[];
  /** Why there is nothing to report, when there isn't. */
  readonly note?: string;
};

export type RunLogOptions = {
  readonly host: Host;
  readonly workspaceRoot: string;
  /** The Mission's folder (beside its Blueprint), for its own list. */
  readonly missionDir?: string;
  readonly selection: SessionSelection;
  /** Now, for the stale check and a proposed pattern's date. */
  readonly now?: Date;
};

const day = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Reads the GameLogs of the sessions `selection` names and reports them against the two lists.
 * Without a Host Adapter that names its GameLogs folder, there is nothing to read, and the report
 * says so. The patterns it matched are recorded in the machine's cache folder, which is how a
 * pattern no run matches is told from one that just hasn't been needed.
 */
export async function reportRunLogs(options: RunLogOptions): Promise<RunLogReport> {
  const { host, selection } = options;
  const now = options.now ?? new Date();
  if (!host.has("game.logsFolder")) return { folder: "", sessions: [], stale: [], note: "the machine's Host Adapter doesn't name the game's log folder, so its logs weren't read" };
  const folder = await host.run("game.logsFolder", {});
  const sessions = selectSessions(await readGameSessions(folder), selection);
  if (sessions.length === 0) return { folder, sessions: [], stale: [], note: `no game session in ${folder} matches this run (its logs are written when the game quits; a game killed may have left none)` };

  const lists: { readonly level: "workspace" | "mission"; readonly file: string }[] = [
    { level: "workspace", file: path.join(options.workspaceRoot, KNOWN_ERRORS_FILE) },
    ...(options.missionDir ? [{ level: "mission" as const, file: path.join(options.missionDir, KNOWN_ERRORS_FILE) }] : []),
  ];
  const patterns: ListedPattern[] = [];
  for (const { level, file } of lists) {
    const list = path.relative(options.workspaceRoot, file).split(path.sep).join("/");
    try {
      patterns.push(...(await readKnownErrors(file, list)).map((pattern) => ({ ...pattern, level, list })));
    } catch (error) {
      return { folder, sessions: [], stale: [], note: `${(error as Error).message}; fix it, or run check` };
    }
  }

  const matched = new Set<string>();
  const reports: SessionReport[] = [];
  for (const session of sessions) {
    const errors: ReportedError[] = (await readSessionErrors(session)).map((error) => {
      const pattern = knownBy(patterns, error.message);
      for (const each of patterns) if (matches(each, error.message)) matched.add(keyOf(each));
      return { ...error, ...(pattern ? { known: { level: pattern.level, list: pattern.list, match: pattern.match, reason: pattern.reason } } : {}) };
    });
    reports.push({
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt.toISOString(),
      ...(session.parameters ? { parameters: session.parameters } : {}),
      ...(session.crash ? { crash: { kind: session.crash.kind, folder: session.crash.folder, ...(session.crash.report ? { report: session.crash.report } : {}) } } : {}),
      errors,
      newErrors: errors.filter((error) => !error.known).length,
    });
  }
  const stale = await staleAfterRun(host, patterns, matched, now);
  return { folder, sessions: reports, stale };
}

const keyOf = (pattern: ListedPattern): string => `${pattern.list}\u0000${pattern.regex ? "re:" : ""}${pattern.match}`;

/** Records this run's matches, and lists the patterns last matched (else added) over STALE_DAYS ago. No cache folder, no record, no flags. */
async function staleAfterRun(host: Host, patterns: readonly ListedPattern[], matched: ReadonlySet<string>, now: Date): Promise<StalePattern[]> {
  const cacheDir = host.machine.cacheDir;
  if (!cacheDir || patterns.length === 0) return [];
  const file = path.join(cacheDir, "known-error-hits.json");
  let hits: Record<string, string> = {};
  try {
    if (existsSync(file)) hits = JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
  } catch {
    hits = {};
  }
  for (const key of matched) hits[key] = now.toISOString();
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, `${JSON.stringify(hits, null, 2)}\n`);
  } catch {
    return [];
  }
  return patterns.flatMap((pattern) => {
    const last = new Date(hits[keyOf(pattern)] ?? `${pattern.added}T00:00:00Z`);
    const days = Math.floor((now.getTime() - last.getTime()) / 86_400_000);
    return days >= STALE_DAYS ? [{ level: pattern.level, list: pattern.list, match: pattern.match, reason: pattern.reason, days }] : [];
  });
}

/** The report as lines for a tool's reply. */
export function formatRunLogReport(report: RunLogReport, heading: string, now: Date = new Date()): string[] {
  if (report.sessions.length === 0) return report.note ? [`${heading}: ${report.note}`] : [];
  const lines: string[] = [];
  for (const session of report.sessions) {
    const what = session.crash ? `${session.crash.kind.toUpperCase()}: the game left ${session.crash.folder}${session.crash.report ? ` (report: ${session.crash.report})` : ""}` : "no crash";
    lines.push(`${heading} (game session ${session.startedAt} to ${session.endedAt}): ${what}; ${session.errors.length} distinct error${session.errors.length === 1 ? "" : "s"}, ${session.newErrors} new`);
    const listed = [...session.errors.filter((error) => !error.known), ...session.errors.filter((error) => error.known)].slice(0, MAX_LISTED);
    for (const error of listed) lines.push(`  ${error.known ? "known" : "NEW  "} x${error.count} [${error.channels.join(", ")}] ${error.message}${error.known ? ` (${error.known.level} list: ${error.known.reason})` : ""}`);
    if (session.errors.length > listed.length) lines.push(`  and ${session.errors.length - listed.length} more distinct errors`);
    const fresh = session.errors.filter((error) => !error.known).slice(0, 3);
    if (fresh.length > 0) {
      lines.push(`  To call a new error known, the author adds a pattern with a reason to ${KNOWN_ERRORS_FILE} (the Workspace's root for every Mission, or beside the Mission's Blueprint for this one), for example:`);
      for (const error of fresh) lines.push(`    ${JSON.stringify(proposePattern(error.message, day(now)))}`);
    }
  }
  for (const pattern of report.stale) lines.push(`  Unmatched for ${pattern.days} days, so maybe remove it from ${pattern.list}: "${pattern.match}" (${pattern.reason})`);
  return lines;
}
