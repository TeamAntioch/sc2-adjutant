#!/usr/bin/env node
// The plugin's PostToolUse and PostToolUseFailure hook on Edit|Write|Bash. When the call looks like
// it changed something inside a compiled package, a `*.SC2Map/` or `*.SC2Mod/` folder, it adds
// context telling Claude this was a hand edit inside the package and to offer the
// report-missing-feature skill once if it works around missing support. Once per package per
// session. It never blocks or fails the tool call: a problem exits 0 silently.
//
// The note is only advisory, so the Bash check is deliberately rough: a command counts when its
// text names a package path and has a write-like token outside quotes, or an inline script's write.
// It can fire on a copy out of a package or a redirect elsewhere, and miss an edit after a `cd`
// into one; the skill's own description covers what it misses.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Marker folders older than this are deleted, best-effort, on each run. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** Package keys fold case where the file system usually does. */
const FOLD_CASE = process.platform === "darwin" || process.platform === "win32";
/** A package path as a Bash command names it, with or without something below it. */
const PACKAGE_PATH = /(?<![^\s'"`;|&<>()=,])[^\s'"`;|&<>()=,]*?\.sc2(?:map|mod)(?=[\\/\s'"`;|&<>(),]|$)/gi;
/** A write-like token outside quotes: a redirect, a writing program, or an in-place edit. */
const WRITES = [
  />/,
  /(?<![\w.-])(?:tee|rm|mv|cp|rsync|touch)(?![\w.-])/,
  /(?<![\w.-])(?:sed|perl)\s(?:[^|;&\n]*\s)?(?:-[A-Za-z]*i|--in-place)/,
];
/** An inline script that opens or writes a file: looked for in the command as written, since the script is usually quoted. */
const SCRIPT_WRITES = /(?<![\w.-])(?:python3?|node)\s[\s\S]*(?:open\(|write)/;
/** A single- or double-quoted string, whose contents the token scan blanks out. */
const QUOTED = /'[^']*'|"(?:[^"\\]|\\[\s\S])*"/g;
/** Redirects that write no file: to another stream, or to /dev/null. */
const HARMLESS_REDIRECT = /\d*>&(?:\d+|-)|\d*>\s*\/dev\/null(?![\w/])/g;
/** The Workspace config at a Workspace's root, and the folder of Mission folders when it names none. */
const WORKSPACE_FILE = "sc2-adjutant.workspace.json";
const MISSIONS_DIR = "missions";
/** A Mission's folder of throwaway copies (a test Cinematic's map): edits there are no hand edit. */
const OUTPUT_DIR = "output";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const toolInput = input.tool_input ?? {};
  const touched =
    input.tool_name === "Bash"
      ? typeof toolInput.command === "string"
        ? bashPackages(toolInput.command)
        : []
      : typeof toolInput.file_path === "string"
        ? [/^(.*?\.sc2(?:map|mod))[\\/]+[^\\/]/i.exec(path.resolve(cwd, expandHome(toolInput.file_path)))?.[1]]
        : [];
  const packages = unseen(input.session_id, touched.filter((pkg) => pkg && !isThrowaway(path.resolve(cwd, pkg))));
  if (packages.length) {
    // PostToolUseFailure, after a command that exited non-zero, takes the note the same way.
    const hookEventName = input.hook_event_name === "PostToolUseFailure" ? "PostToolUseFailure" : "PostToolUse";
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: reminder(packages) } }));
  }
} catch {
  // Never in the way of the tool call.
}

/**
 * The packages a Bash command names, when it also has a write-like token; else none. Each is keyed
 * as written: an absolute or `~/` path is resolved, a relative one is kept as its text. So a
 * relative key can be off: it's read from the folder the command ran in, which a `cd` may have
 * moved, and it differs from the absolute key an Edit of the same package gets.
 */
function bashPackages(command) {
  const named = command.match(PACKAGE_PATH) ?? [];
  // Quoted text (a grep pattern like '</Trigger>') isn't a token; the quotes stay, so words don't join.
  const unquoted = command.replace(QUOTED, (quoted) => quoted[0] + " ".repeat(quoted.length - 2) + quoted[0]).replace(HARMLESS_REDIRECT, " ");
  if (!named.length || !(WRITES.some((token) => token.test(unquoted)) || SCRIPT_WRITES.test(command))) return [];
  return named.map((text) => (path.isAbsolute(text) || text.startsWith("~/") ? path.resolve(expandHome(text)) : text));
}

function expandHome(target) {
  return target === "~" || target.startsWith("~/") ? path.join(os.homedir(), target.slice(1)) : target;
}

/**
 * Whether a package is a throwaway copy under a Mission's `output/` folder. It's placed from the
 * Workspace config above it (its `missions` folder), else from the default layout,
 * `missions/<id>/output/`.
 */
function isThrowaway(pkg) {
  const same = (a, b) => (FOLD_CASE ? a.toLowerCase() === b.toLowerCase() : a === b);
  let missions;
  for (let dir = path.dirname(pkg), up; missions === undefined && up !== dir; up = dir, dir = path.dirname(dir)) {
    if (!existsSync(path.join(dir, WORKSPACE_FILE))) continue;
    let named;
    try {
      named = JSON.parse(readFileSync(path.join(dir, WORKSPACE_FILE), "utf8")).missions;
    } catch {
      // An unreadable config: the default layout.
    }
    missions = path.resolve(dir, typeof named === "string" && named ? named : MISSIONS_DIR);
  }
  if (missions !== undefined) {
    const fold = (p) => (FOLD_CASE ? p.toLowerCase() : p);
    const parts = path.relative(fold(missions), fold(pkg)).split(/[\\/]/);
    return parts.length >= 3 && parts[0] !== ".." && !path.isAbsolute(parts[0]) && same(parts[1], OUTPUT_DIR);
  }
  const parts = pkg.split(/[\\/]/);
  return parts.some((part, i) => i >= 2 && i < parts.length - 1 && same(part, OUTPUT_DIR) && same(parts[i - 2], MISSIONS_DIR));
}

/**
 * The packages this session hasn't been reminded about, each recorded as reminded. The record is
 * one marker file per package, in a folder for the session under the OS temp folder, made with an
 * exclusive create, so of two calls running at once only the one that makes the marker gets the
 * note. With no session id there is nothing to key it by.
 */
function unseen(sessionId, touched) {
  if (typeof sessionId !== "string" || !sessionId || !touched.length) return [];
  const root = path.join(os.tmpdir(), "sc2-adjutant-hand-edits");
  const folder = path.join(root, sessionId.replace(/[^A-Za-z0-9_-]/g, "_"));
  mkdirSync(folder, { recursive: true });
  clearStale(root, folder);
  const byKey = new Map(touched.map((pkg) => [FOLD_CASE ? pkg.toLowerCase() : pkg, pkg]));
  return [...byKey].flatMap(([key, pkg]) => {
    try {
      writeFileSync(path.join(folder, createHash("sha256").update(key).digest("hex").slice(0, 32)), `${pkg}\n`, { flag: "wx" });
      return [pkg];
    } catch {
      return []; // Noted already (the marker exists), or it can't be recorded: no note either way.
    }
  });
}

/** Deletes other sessions' marker folders that haven't changed in a week, best-effort. */
function clearStale(root, keep) {
  for (const name of readdirSync(root)) {
    const folder = path.join(root, name);
    try {
      if (folder !== keep && Date.now() - statSync(folder).mtimeMs > STALE_MS) rmSync(folder, { recursive: true, force: true });
    } catch {
      // Gone already, or not ours to delete.
    }
  }
}

/** What Claude is told: neutral, and an offer to make later, not now. */
function reminder(packages) {
  const which = packages.length === 1 ? `${packages[0]} is a compiled package` : `${packages.join(", ")} are compiled packages`;
  return (
    `sc2-adjutant: that tool call changed something inside a compiled package (${which}: a Map Package or a Mod's package), outside the Blueprint and the compile. ` +
    "If this hand edit works around something sc2-adjutant doesn't support, offer the report-missing-feature skill once, at a natural pause after the task, not in the middle of it. " +
    "If it doesn't work around missing support, carry on without mentioning it. This note comes once per package per session."
  );
}
