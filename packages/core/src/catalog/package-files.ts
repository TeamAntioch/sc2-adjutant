// A file named by its storage path (`Assets\Doodads\X\X.m3`, as game data writes it) in a list of
// mod package folders, found as the game finds it: in the newest-loaded package that holds it,
// under its Base.SC2Assets folder or at its root, in any case. Mission and mod compiles never need
// it; rendering a Workspace mod's models does (model.render's `packages`, ADR-0017), and the Host
// Adapter and core look a file up the same way.

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Where a storage path's file is: the package that holds it and the file's path on disk. */
export type PackageFile = { readonly package: string; readonly file: string };

/** A storage path's parts: backslashes or slashes, without a leading one. */
const storageParts = (storagePath: string): string[] => storagePath.split(/[\\/]+/).filter((part) => part.length > 0);

/** The entry of `dir` named `name` in any case: the exact name first, as the game matches names. */
function entryIn(dir: string, name: string): string | undefined {
  const exact = path.join(dir, name);
  if (existsSync(exact)) return exact;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return undefined;
  }
  const lower = name.toLowerCase();
  const found = entries.find((entry) => entry.toLowerCase() === lower);
  return found === undefined ? undefined : path.join(dir, found);
}

/** The file at `parts` under `root`, each part matched in any case; undefined when it isn't there or isn't a file. */
function fileUnder(root: string, parts: readonly string[]): string | undefined {
  const at = pathInAnyCase(root, parts.join("/"));
  if (at === undefined) return undefined;
  try {
    return statSync(at).isFile() ? at : undefined;
  } catch {
    return undefined;
  }
}

/** The file or folder a storage path names under `root`, each part matched in any case, as the game finds it; undefined when it isn't there. */
export function pathInAnyCase(root: string, storagePath: string): string | undefined {
  let at: string | undefined = root;
  for (const part of storageParts(storagePath)) {
    at = entryIn(at, part);
    if (at === undefined) return undefined;
  }
  return at;
}

/** The folders of a package that storage paths are read from: its Base.SC2Assets folder, then its root. */
export function packageAssetRoots(packageDir: string): string[] {
  const assets = entryIn(packageDir, "Base.SC2Assets");
  return assets !== undefined ? [assets, packageDir] : [packageDir];
}

/**
 * The file a storage path names in `packages` (mod package folders in load order, dependencies
 * first), from the newest-loaded package that holds it; undefined when none does, so the game's
 * own file is the one meant.
 */
export function findPackageFile(packages: readonly string[], storagePath: string): PackageFile | undefined {
  const parts = storageParts(storagePath);
  if (parts.length === 0) return undefined;
  for (const pkg of [...packages].reverse()) {
    for (const root of packageAssetRoots(pkg)) {
      const file = fileUnder(root, parts);
      if (file !== undefined) return { package: pkg, file };
    }
  }
  return undefined;
}
