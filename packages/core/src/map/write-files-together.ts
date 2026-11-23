// Writes a set of files in a folder all or not at all, so a Map Package is never left half edited:
// a height map at one quantization and t3Terrain.xml at another decodes the whole map wrong.
//
// Staging writes each file beside its old one (`<file>.edit-pending`). Committing moves each old
// file aside (`<file>.edit-backup`) and renames the pending one in (a file given no content is only
// moved aside: removed); if any rename fails, every file already renamed in is put back from its
// backup (or removed, if it is new) before the error is thrown. Either way, no pending or backup
// file is left.

import { existsSync } from "node:fs";
import { chmod, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { packageModes } from "../util/package-file-mode.js";

/** What a file being written is called until every file of the set is written. */
export const PENDING = ".edit-pending";
/** What an old file is called while the new ones are renamed in. */
export const BACKUP = ".edit-backup";

/** The file operations used, replaceable in tests. */
export type FileOps = {
  readonly writeFile: (file: string, content: Buffer | string) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly rm: (file: string) => Promise<void>;
  /** Gives a pending file the mode the file it replaces has (or the package's, for a new one); left out, modes aren't touched. */
  readonly keepMode?: (pending: string, file: string) => Promise<void>;
};
const fsOps = (dir: string): FileOps => {
  const modes = packageModes(dir);
  return {
    writeFile: (file, content) => writeFile(file, content),
    rename,
    rm: (file) => rm(file, { force: true }),
    keepMode: async (pending, file) => chmod(pending, await modes.modeFor(file)),
  };
};

export type StagedFiles = {
  /** Renames every staged file in, all or none; returns the files written. */
  readonly commit: () => Promise<string[]>;
  /** Removes the staged files, leaving the folder as it was. */
  readonly discard: () => Promise<void>;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** How a write failed, for the caller to word: it adds its own prefix and phrasing. */
export class WriteFailed extends Error {
  constructor(
    /** The folder written to. */
    readonly dir: string,
    /** Whether the failure was writing the pending files ("stage") or renaming them in ("commit"). */
    readonly phase: "stage" | "commit",
    /** The underlying error's message. */
    readonly reason: string,
    /** Files that could not be put back (commit only): each still has its old copy at `<file>.edit-backup`. */
    readonly unrestored: readonly string[],
    /** Whether some files had already been renamed in and were put back (commit only). */
    readonly putBack: boolean,
    cause: unknown,
  ) {
    super(reason, { cause });
    this.name = "WriteFailed";
  }
}

/** Writes every file of `out` beside its old one in `dir` (one with no content is to be removed). A failed write removes them all and throws a `WriteFailed`. */
export async function stageFiles(
  dir: string,
  out: readonly (readonly [string, Buffer | string | undefined])[],
  ops: FileOps = fsOps(dir),
): Promise<StagedFiles> {
  const at = (file: string, suffix = "") => path.join(dir, `${file}${suffix}`);
  const discard = async () => {
    await Promise.all(out.map(([file]) => ops.rm(at(file, PENDING)).catch(() => undefined)));
  };
  try {
    for (const [file, content] of out) {
      if (content === undefined) continue;
      await ops.writeFile(at(file, PENDING), content);
      await ops.keepMode?.(at(file, PENDING), at(file));
    }
  } catch (error) {
    await discard();
    throw new WriteFailed(dir, "stage", message(error), [], false, error);
  }

  const commit = async (): Promise<string[]> => {
    const backedUp: string[] = [];
    const renamedIn: string[] = [];
    try {
      for (const [file, content] of out) {
        if (existsSync(at(file))) {
          await ops.rename(at(file), at(file, BACKUP));
          backedUp.push(file);
        }
        if (content === undefined) continue;
        await ops.rename(at(file, PENDING), at(file));
        renamedIn.push(file);
      }
    } catch (error) {
      const unrestored: string[] = [];
      for (const [file] of out) {
        try {
          if (backedUp.includes(file)) await ops.rename(at(file, BACKUP), at(file));
          else if (renamedIn.includes(file)) await ops.rm(at(file));
        } catch {
          unrestored.push(file);
        }
      }
      await discard();
      throw new WriteFailed(dir, "commit", message(error), unrestored, renamedIn.length > 0, error);
    }
    await Promise.all(backedUp.map((file) => ops.rm(at(file, BACKUP)).catch(() => undefined)));
    return out.map(([file]) => file);
  };
  return { commit, discard };
}
