// The permission bits a file written into a Map or Mod Package gets. The Editor sets the
// executable bit on every file it saves (755), and git records it, so a writer that left each file
// at the process's default (644) would flip every file it wrote, changed or not, and the next
// Editor save would flip them back. A file the package has keeps its mode; a new one gets the mode
// of the package's other files, or the Editor's when the package has none yet.

import { existsSync } from "node:fs";
import { chmod, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** The mode the Editor gives every file it saves. */
export const EDITOR_FILE_MODE = 0o755;

/** Files a writer leaves in the package for a moment, or that aren't the package's own (.DS_Store, .gitignore). */
const passing = (name: string): boolean => name.startsWith(".") || /\.(compile-pending|edit-pending|edit-backup)$/.test(name);

/** The permission bits of the first file found in `root`, by breadth (its own files before its folders'), or undefined when it has none. */
async function sampleMode(root: string): Promise<number | undefined> {
  let folders = [root];
  while (folders.length > 0) {
    const next: string[] = [];
    for (const folder of folders) {
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        if (passing(entry.name)) continue;
        const full = path.join(folder, entry.name);
        if (entry.isFile()) return (await stat(full)).mode & 0o777;
        if (entry.isDirectory()) next.push(full);
      }
    }
    folders = next;
  }
  return undefined;
}

export type PackageModes = {
  /** The mode a write to `file` (a path in the package) gives it: its own when it exists, else the package's. */
  readonly modeFor: (file: string) => Promise<number>;
  /** Writes `content` to `file` in place, a new file getting the package's mode. */
  readonly write: (file: string, content: string | Uint8Array) => Promise<void>;
};

/**
 * Modes for the files written into the package at `root`. The package's mode is read once, from
 * the package as it is when first asked, so the files a compile adds don't change it midway.
 */
export function packageModes(root: string): PackageModes {
  let packageMode: Promise<number> | undefined;
  const newFileMode = (): Promise<number> => (packageMode ??= sampleMode(root).then((mode) => mode ?? EDITOR_FILE_MODE));
  const modeFor = async (file: string): Promise<number> => {
    const own = await stat(file).then(
      (stats) => stats.mode & 0o777,
      () => undefined,
    );
    return own ?? newFileMode();
  };
  return {
    modeFor,
    write: async (file, content) => {
      const isNew = !existsSync(file);
      const mode = isNew ? await newFileMode() : undefined;
      await writeFile(file, content);
      if (mode !== undefined) await chmod(file, mode);
    },
  };
}
