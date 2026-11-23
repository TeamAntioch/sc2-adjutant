// A linked git worktree's main checkout, read from `.git` and the worktree's `commondir` with no
// git process. Git-ignored files a worktree doesn't get (the Plugin folders beside a Workspace,
// core's renders and sheets) are looked for there.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** The main working tree of the repository `folder` is a linked worktree of; undefined if it isn't one. `folder` is the worktree's top, where its `.git` file is. */
export function mainWorkingTree(folder: string): string | undefined {
  try {
    const dotGit = path.join(folder, ".git");
    if (!statSync(dotGit).isFile()) return undefined;
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
    if (!gitdir) return undefined;
    const worktreeGitDir = path.resolve(folder, gitdir);
    const commonDir = path.resolve(worktreeGitDir, readFileSync(path.join(worktreeGitDir, "commondir"), "utf8").trim());
    return path.basename(commonDir) === ".git" ? path.dirname(commonDir) : undefined;
  } catch {
    return undefined;
  }
}

const tops = new Map<string, string | undefined>();

/** The top of the working tree `folder` is in: the nearest folder holding `.git`. */
function workingTreeTop(folder: string): string | undefined {
  if (tops.has(folder)) return tops.get(folder);
  const parent = path.dirname(folder);
  const top = existsSync(path.join(folder, ".git")) ? folder : parent === folder ? undefined : workingTreeTop(parent);
  tops.set(folder, top);
  return top;
}

/** The same path in the main checkout, when `file` (absolute) is in a linked worktree; undefined otherwise. */
export function inMainCheckout(file: string): string | undefined {
  const top = workingTreeTop(path.dirname(file));
  const main = top && mainWorkingTree(top);
  return main && path.join(main, path.relative(top, file));
}
