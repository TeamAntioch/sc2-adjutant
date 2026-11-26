// A first-party package that builds to its dist/ (the Host Adapters, the Style Pack, the Finder
// wrappers): whether the built entry core is about to load is there and, in a checkout, up to date
// with the TypeScript beside it. Each such package's build ends by writing dist/.built, holding a
// digest of the sources it saw (`writeBuiltStamp`, run by packages/core/scripts/write-built-stamp.mjs),
// so a build that had nothing new to emit still marks them as built. A source newer than the stamp
// is first taken as a change; when the sources still match the stamp's digest, it was only touched
// (a branch switched and back, a stash popped), which Turborepo's cached build doesn't restamp,
// since it leaves outputs that are already in place alone. Under node_modules (an npm install) only
// the entry's presence is checked.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Written into dist/ at the end of each build. */
export const BUILT_STAMP = ".built";

export type PackageBuild = { readonly built: true } | { readonly built: false; readonly reason: string };

/** Folders that hold no source the build compiles. */
const NOT_SOURCE = new Set(["node_modules", "dist", "tests"]);

/** Whether `name`, a file in a package, is TypeScript its build compiles. */
const isSource = (name: string) => name.endsWith(".ts") && !name.endsWith(".d.ts") && name !== "vitest.config.ts";

/** Every TypeScript source under `folder` that the build compiles, in a stable order. */
function sources(folder: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!NOT_SOURCE.has(entry.name)) walk(file);
      } else if (entry.isFile() && isSource(entry.name)) found.push(file);
    }
  };
  walk(folder);
  return found.sort();
}

/** The newest TypeScript source under `folder` that the build compiles, or undefined if none. */
function newestSource(folder: string): { readonly file: string; readonly mtimeMs: number } | undefined {
  let newest: { file: string; mtimeMs: number } | undefined;
  for (const file of sources(folder)) {
    const { mtimeMs } = statSync(file);
    if (!newest || mtimeMs > newest.mtimeMs) newest = { file, mtimeMs };
  }
  return newest;
}

/** A digest of the package's sources: each one's path in the package and its content. */
export function sourceDigest(folder: string): string {
  const hash = createHash("sha256");
  for (const file of sources(folder)) {
    hash.update(path.relative(folder, file).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Writes dist/.built for the package in `folder`, at the end of its build. */
export function writeBuiltStamp(folder: string): void {
  writeFileSync(path.join(folder, "dist", BUILT_STAMP), `${sourceDigest(folder)}\n`);
}

/**
 * Whether `entry`, the file core loads from the package in `folder`, is built. An entry outside the
 * package's dist/ (a local Plugin's TypeScript) is built when it is there.
 */
export function packageBuild(folder: string, entry: string): PackageBuild {
  const shown = path.relative(folder, entry).split(path.sep).join("/");
  const hasPackage = existsSync(path.join(folder, "package.json"));
  if (!existsSync(entry)) return { built: false, reason: `its entry point ${shown} isn't there${hasPackage ? ": build its package first (npm run build)" : ""}` };
  const dist = path.join(folder, "dist");
  if (path.relative(dist, entry).startsWith("..")) return { built: true };
  if (realpathSync(folder).split(path.sep).includes("node_modules")) return { built: true };
  const source = newestSource(folder);
  if (!source) return { built: true };
  const stamp = path.join(dist, BUILT_STAMP);
  const builtAt = existsSync(stamp) ? statSync(stamp).mtimeMs : 0;
  if (source.mtimeMs <= builtAt) return { built: true };
  if (builtAt && readFileSync(stamp, "utf8").trim() === sourceDigest(folder)) return { built: true };
  const changed = path.relative(folder, source.file).split(path.sep).join("/");
  return { built: false, reason: `its dist/ is older than its source (${changed} changed since the last build): build its package (npm run build)` };
}
