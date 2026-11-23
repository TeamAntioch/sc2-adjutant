// "Is this path inside that folder", compared by real paths, so a symlink inside the folder can't
// lead out of it: the one check the server, the Screenplay pull and the compile share.

import { realpath } from "node:fs/promises";
import path from "node:path";

/** The real path of `target`, which may not exist yet: its deepest existing folder's real path, then the rest. */
export async function realPathOf(target: string): Promise<string> {
  const rest: string[] = [];
  for (let existing = path.resolve(target); ; existing = path.dirname(existing)) {
    try {
      return path.join(await realpath(existing), ...rest.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || path.dirname(existing) === existing) throw error;
      rest.push(path.basename(existing));
    }
  }
}

/** Whether `relative` (from a folder) stays inside it; `""`, the folder itself, counts only with `orSame`. */
export function staysInside(relative: string, orSame = false): boolean {
  if (relative === "") return orSame;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Whether `file` is inside `root`, both by real path (`file` may not exist yet). `root` itself
 * counts only with `orSame`.
 */
export async function isInside(root: string, file: string, { orSame = false }: { readonly orSame?: boolean } = {}): Promise<boolean> {
  return staysInside(path.relative(await realPathOf(root), await realPathOf(file)), orSame);
}
