// A first-party package that builds to its dist/ (the Host Adapters, the Style Pack, the Finder
// wrappers): whether the built entry core is about to load is there and, in a checkout, up to date
// with the TypeScript beside it. Each such package's build ends by writing dist/.built, so a build
// that had nothing new to emit still marks the sources it saw as built. Under node_modules (an npm
// install) only the entry's presence is checked.

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/** Written into dist/ at the end of each build. */
export const BUILT_STAMP = ".built";

export type PackageBuild = { readonly built: true } | { readonly built: false; readonly reason: string };

/** Folders that hold no source the build compiles. */
const NOT_SOURCE = new Set(["node_modules", "dist", "tests"]);

/** The newest TypeScript source under `folder` that the build compiles, or undefined if none. */
function newestSource(folder: string): { readonly file: string; readonly mtimeMs: number } | undefined {
  let newest: { file: string; mtimeMs: number } | undefined;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!NOT_SOURCE.has(entry.name)) walk(file);
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") && entry.name !== "vitest.config.ts") {
        const { mtimeMs } = statSync(file);
        if (!newest || mtimeMs > newest.mtimeMs) newest = { file, mtimeMs };
      }
    }
  };
  walk(folder);
  return newest;
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
  const changed = path.relative(folder, source.file).split(path.sep).join("/");
  return { built: false, reason: `its dist/ is older than its source (${changed} changed since the last build): build its package (npm run build)` };
}
