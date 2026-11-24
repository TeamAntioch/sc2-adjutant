// The CASC extractor the build scripts read the game's own files with. This repo ships none: a
// maintainer installs a community tool and names it in SC2_CASC_TOOL (tools/README.md). It is
// called as stormex is (https://github.com/Talv/stormex, built on CascLib):
//
//   $SC2_CASC_TOOL -S <storage> -I <regex> -x -o <folder>
//
// -S the install's folder, -I a case-insensitive ECMAScript regex over storage paths, -x extract every
// match, -o where. Another tool works through a wrapper that takes these options: an executable
// script (with its #! line) on macOS and Linux, an .exe on Windows, since it runs without a shell.
//
// The scripts read what it extracts by lower-case paths with / separators, so the extracted tree
// is lower-cased after each run, whatever case the tool wrote.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readdir, rename, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const CASC_TOOL_VARIABLE = "SC2_CASC_TOOL";

/** The extractor SC2_CASC_TOOL names; exits with a message naming the variable when it's unset or missing. */
export function cascTool() {
  const tool = process.env[CASC_TOOL_VARIABLE];
  if (!tool) fail(`${CASC_TOOL_VARIABLE} isn't set: install a CASC extractor (tools/README.md) and set ${CASC_TOOL_VARIABLE} to its path`);
  if (!existsSync(tool)) fail(`${CASC_TOOL_VARIABLE} is ${tool}, which doesn't exist (tools/README.md)`);
  return tool;
}

/** The StarCraft II install a script reads, from its first argument; exits with its usage when there's none. */
export function storageArgument(script, what) {
  const storage = process.argv[2];
  if (!storage) fail(`Usage: ${CASC_TOOL_VARIABLE}=<extractor> node packages/core/scripts/${script} <StarCraft II folder>${what ? ` ${what}` : ""}`, 2);
  if (!existsSync(storage)) fail(`${storage} doesn't exist: give the StarCraft II install's folder`, 2);
  return storage;
}

/** A storage path pattern: its parts, any separator between them, case-insensitive. */
export const storagePath = (...parts) => parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\\\/]");

/**
 * Extracts every storage path matching one of `patterns` (regex sources) into a scratch folder,
 * lower-cased, and returns the folder. It is removed when the script exits.
 */
export async function extractFromStorage(storage, patterns, label) {
  const folder = scratchFolder(label);
  await extractInto(storage, patterns, folder);
  return folder;
}

/** A scratch folder for extracted files, removed when the script exits, an interrupted run included. */
export function scratchFolder(label) {
  const folder = mkdtempSync(path.join(tmpdir(), `sc2-adjutant-${label}-`));
  process.on("exit", () => rmSync(folder, { recursive: true, force: true }));
  // Node doesn't emit "exit" on a signal, so an interrupted run removes its folder here.
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => process.exit(130));
  return folder;
}

/** Extracts every storage path matching one of `patterns` (regex sources) into `folder`, lower-cased. */
export async function extractInto(storage, patterns, folder) {
  const tool = cascTool();
  const regex = patterns.length === 1 ? patterns[0] : `(?:${patterns.join("|")})`;
  try {
    await promisify(execFile)(tool, ["-S", storage, "-I", regex, "-x", "-o", folder], { maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    fail(`${CASC_TOOL_VARIABLE} (${tool}) failed to extract ${regex} from ${storage}: ${String(error.stderr || error.message).trim()}`);
  }
  await lowerCase(folder);
}

/** Renames every entry below `folder` to lower case, merging folders whose names differ only in case. */
async function lowerCase(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    let full = path.join(folder, entry.name);
    const lower = entry.name.toLowerCase();
    if (lower !== entry.name) {
      const target = path.join(folder, lower);
      if (entry.isDirectory() && existsSync(target) && !(await sameEntry(full, target))) {
        // A case-sensitive file system holds both: merge this one into its lower-case twin.
        await mergeInto(full, target);
        full = target;
      } else {
        // Through a temporary name, so a case-insensitive file system renames it too.
        const step = path.join(folder, `${lower}.casc-rename`);
        await rename(full, step);
        await rename(step, target);
        full = target;
      }
    }
    if (entry.isDirectory()) await lowerCase(full);
  }
}

/** Moves everything in `from` into `into`, merging folders both hold, then removes `from`. */
async function mergeInto(from, into) {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(into, entry.name);
    if (entry.isDirectory() && existsSync(target)) await mergeInto(source, target);
    else await rename(source, target);
  }
  rmSync(from, { recursive: true, force: true });
}

/** Whether two paths name one entry (as a case-insensitive file system resolves them). */
async function sameEntry(a, b) {
  const [x, y] = await Promise.all([stat(a), stat(b)]);
  return x.ino === y.ino && x.dev === y.dev;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}
