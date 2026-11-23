// The head and tail of every Kept Map Package edit (ADR-0010), shared by editKeptTerrain,
// editKeptObjects and tuneKeptTriggers so each keeps only its own edit logic.
//
//   head: find the Mission's Map Package and refuse unless it has a compile record, since without
//         one the next compile would write the package whole over any edit;
//   tail: refuse while the Editor has the package open (rewriting it can crash the Editor, and it
//         keeps the copy it loaded), then write every file all or none (write-files-together.ts).
//
// Reading the package's files stays in each tool. The session notes a hash of every file when it
// opens, and refuses the write if a file it is about to write is no longer as it was: another
// session or the Editor wrote it between the tool's read and its write (checked again just before
// the renames), so the edit can't silently put old content back over theirs.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { CompileRecord } from "../domain/compile-record.js";
import type { Host } from "../host/host.js";
import { missionMapPackage, readCompileRecord } from "./mission-package.js";
import { withPackageLock } from "./package-lock.js";
import { BACKUP, PENDING, stageFiles, type StagedFiles, WriteFailed } from "./write-files-together.js";

/** What a session writes: each file of the package with its new content, or none to remove it. */
export type PackageFiles = readonly (readonly [string, Buffer | string | undefined])[];

/** Whose refusal a failed write is: "edited" (the Kept edit tools) or "tuned" (the trigger tuner, which words its failures its own way). */
export type WriteVerb = "edited" | "tuned";

export type KeptSessionOptions = {
  /** Words the refusals: "Not edited: …" or "Not tuned: …". */
  readonly verb: WriteVerb;
  /** Asked whether the Editor has the package open (`editor.checkClosed`); a host that can't tell lets the edit go ahead. */
  readonly host?: Host | undefined;
  /** Also refuse a folder with no MapInfo ("isn't a Map Package yet"), before the compile record is asked for. */
  readonly requirePackage?: boolean;
};

export type KeptSession = {
  readonly mapPackage: string;
  readonly record: CompileRecord;
  /**
   * Refuses while the Editor has the package open, as "Not <verb>: …". Asks the host each time, and
   * a pass covers only the next stage or commit, so a refusal can be retried after the Editor is
   * closed and a pass never outlives a later write.
   */
  readonly checkClosed: () => Promise<void>;
  /** Checks the Editor is closed, then writes `files` beside their old ones; `commit` renames them in all or none, `discard` leaves the package as it was. */
  readonly stage: (files: PackageFiles) => Promise<StagedFiles>;
  /** Checks the Editor is closed, then writes every file all or none; returns the files written. */
  readonly commit: (files: PackageFiles) => Promise<string[]>;
};

/**
 * Runs `task`, a Kept edit that reads the Mission's package and writes it back, holding the
 * package's cross-process lock (package-lock.ts) from before the first read to after the write, so
 * a compile or an edit in another session can't write between them.
 */
export async function withMissionPackageLock<T>(blueprintPath: string, task: () => Promise<T>): Promise<T> {
  return withPackageLock(await missionMapPackage(blueprintPath), task);
}

/** Files larger than this are noted by size and time rather than hashed (voice files, model packs). */
const HASH_LIMIT = 64 * 1024 * 1024;
const ABSENT = "absent";

/** What a file is, for telling whether it changed: a hash of its bytes, or its size and time when it is too big to hash. */
async function signature(file: string): Promise<string> {
  try {
    const info = await stat(file);
    if (!info.isFile()) return `not a file:${info.mtimeMs}`;
    if (info.size > HASH_LIMIT) return `big:${info.size}:${info.mtimeMs}`;
    return createHash("sha256").update(await readFile(file)).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ABSENT;
    throw error;
  }
}

/** The signature of every file under `dir`, by path with forward slashes. */
async function snapshot(dir: string, prefix = ""): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const entries = existsSync(dir) ? await readdir(dir, { withFileTypes: true }) : [];
  await Promise.all(
    entries.map(async (entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) for (const [file, sig] of await snapshot(path.join(dir, entry.name), relative)) out.set(file, sig);
      else if (entry.isFile() && !entry.name.endsWith(PENDING) && !entry.name.endsWith(BACKUP)) out.set(relative, await signature(path.join(dir, entry.name)));
    }),
  );
  return out;
}

/** Opens the Mission's Kept package for an edit, or throws why it can't be edited. */
export async function openKeptSession(blueprintPath: string, options: KeptSessionOptions): Promise<KeptSession> {
  const mapPackage = await missionMapPackage(blueprintPath);
  const record = await readCompileRecord(blueprintPath);
  if (options.requirePackage && !existsSync(path.join(mapPackage, "MapInfo"))) {
    throw new Error(`${mapPackage} isn't a Map Package yet: compile the Mission, or import a map for it, first`);
  }
  if (!record) {
    throw new Error(`${blueprintPath} has no compile record, so the next compile would write ${path.basename(mapPackage)} whole over any edit: compile the Mission in place first`);
  }
  const before = await snapshot(mapPackage);
  /** Refuses, writing nothing, if a file in `files` is no longer as it was when the session opened. */
  const unchanged = async (files: PackageFiles): Promise<void> => {
    for (const [file] of files) {
      // The snapshot's keys have forward slashes; a key spelled with Windows separators is the same file.
      const key = file.split(path.sep).join("/");
      if ((await signature(path.join(mapPackage, ...key.split("/")))) !== (before.get(key) ?? ABSENT)) {
        throw new Error(`Not ${options.verb}: ${file} changed since it was read (another session or the Editor wrote it): nothing was written, run the edit again`);
      }
    }
  };
  // A pass from `checkClosed` covers the next stage or commit only.
  let passed = false;
  const checkClosed = async (): Promise<void> => {
    passed = false;
    await guard(options.host, mapPackage, options.verb);
    passed = true;
  };
  const stage = async (files: PackageFiles): Promise<StagedFiles> => {
    if (!passed) await checkClosed();
    passed = false;
    await unchanged(files);
    try {
      const staged = await stageFiles(mapPackage, files);
      const commit = async (): Promise<string[]> => {
        try {
          await unchanged(files);
        } catch (error) {
          await staged.discard();
          throw error;
        }
        return staged.commit().catch((error: unknown) => Promise.reject(worded(error, options.verb)));
      };
      return { ...staged, commit };
    } catch (error) {
      throw worded(error, options.verb);
    }
  };
  return { mapPackage, record, checkClosed, stage, commit: async (files) => (await stage(files)).commit() };
}

/** A failed write in the tool's words: the shared writer reports what happened, each verb says it its own way. */
export function worded(error: unknown, verb: WriteVerb): unknown {
  if (!(error instanceof WriteFailed)) return error;
  const { dir, phase, reason, unrestored, putBack, cause } = error;
  const backups = unrestored.map((file) => `${file}${BACKUP}`).join(", ");
  if (verb === "tuned") {
    const lost =
      phase === "stage" ? "" : unrestored.length ? ` Restoring ${unrestored.join(", ")} failed too: put them back from version control (the old ${unrestored.length === 1 ? "copy is" : "copies are"} ${backups}).` : putBack ? " The files already written were put back." : "";
    return new Error(`Not tuned: writing ${dir} failed (${reason}).${lost}`, { cause });
  }
  if (phase === "stage") return new Error(`Not edited: ${reason}`, { cause });
  const left = unrestored.length ? `; ${unrestored.join(", ")} could not be put back: ${backups} ${unrestored.length === 1 ? "is" : "are"} the old copy` : "; every file was put back as it was";
  return new Error(`Not edited: ${reason}${left}`, { cause });
}

/**
 * Throws the Host's refusal if the Editor has `mapPath` open; does nothing where the Host can't
 * tell. Not wrapped: the MapScript drift test (drift-test.ts) checks two paths and passes it on as is.
 */
export async function checkEditorClosed(host: Host | undefined, mapPath: string): Promise<void> {
  if (host?.has("editor.checkClosed")) await host.run("editor.checkClosed", { mapPath });
}

async function guard(host: Host | undefined, mapPackage: string, verb: WriteVerb): Promise<void> {
  try {
    await checkEditorClosed(host, mapPackage);
  } catch (error) {
    throw new Error(`Not ${verb}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
