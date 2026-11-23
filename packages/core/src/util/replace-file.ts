// Atomic file replacement for files the tools keep in the Workspace (Blueprints, Stage records):
// a reader never sees half a file, and a symlinked file stays a link.

import { randomUUID } from "node:crypto";
import { chmod, readlink, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { realPathOf } from "./inside.js";

/** How many links a path may pass through, as the system's own limit (Linux's MAXSYMLINKS). */
const MAX_LINKS = 40;

/**
 * The file a write to `target` lands on, by real path: `target` with every link followed, also
 * when the file at the end doesn't exist yet (a dangling link writes its target). Writes through
 * two links to one file resolve to the same path, so it is also the key to serialize them by.
 */
export async function writeTarget(target: string): Promise<string> {
  let current = path.resolve(target);
  for (let hops = 0; hops <= MAX_LINKS; hops++) {
    try {
      return await realpath(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Not there, or a link to something not there: resolve the folder, then follow the link if it is one.
    const folder = await realPathOf(path.dirname(current));
    const here = path.join(folder, path.basename(current));
    const link = await readlink(here).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "EINVAL") return undefined;
      throw error;
    });
    if (link === undefined) return here;
    current = path.resolve(folder, link);
  }
  throw new Error(`Too many symbolic links resolving ${target}`);
}

/**
 * Writes `content` to a temporary file beside the real file `target` links to, then renames it
 * over that file, so a reader never sees half a file and a symlinked file stays a link. A
 * `target` that doesn't exist yet is created. The new file keeps the old one's permission bits.
 * It is a new inode, so a hard link to the old file keeps the old content. Callers serialize
 * writes within one process (the MCP server queues them by `writeTarget`); two processes writing
 * one file at once can lose one's write.
 */
export async function replaceFile(target: string, content: string): Promise<void> {
  const real = await writeTarget(target);
  const temporary = path.join(path.dirname(real), `.${path.basename(real)}.${randomUUID()}.tmp`);
  try {
    const mode = await stat(real).then(
      (stats) => stats.mode,
      () => undefined,
    );
    await writeFile(temporary, content, mode === undefined ? {} : { mode });
    if (mode !== undefined) await chmod(temporary, mode);
    await rename(temporary, real);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
