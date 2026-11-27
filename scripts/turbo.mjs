// Runs Turborepo with SC2_CATALOG_STAMP set, which turbo.json's globalEnv puts in every task's hash.
// The stamp says which sc2-asset-catalog packages are installed: the published ones (their
// versions), or a linked sibling checkout's (`pnpm run link-catalog`), in which case it covers every
// file in their dist/ by path, size and time. So a cached build or lint against the published
// packages is never replayed while they are linked, and rebuilding the sibling invalidates the cache,
// though no file of this repo changed. Turbo can't hash those files itself: it skips node_modules.
//
// The root's build, lint and test run turbo through this script, and so should anything else that
// wants their cache: `pnpm run turbo run test --filter=<package>`. A bare `pnpm exec turbo` has no stamp,
// so it misses that cache.
//
// Usage, from the repo root: node scripts/turbo.mjs <turbo arguments>
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CATALOG_PACKAGES = ["sc2-asset-catalog", "sc2-finder-kit", "sc2-doodad-finder", "sc2-set-finder"];

function catalogStamp() {
  const hash = createHash("sha256");
  for (const name of CATALOG_PACKAGES) {
    const installed = path.join(ROOT, "node_modules", "@team-antioch", name);
    if (!existsSync(installed)) {
      hash.update(`${name} missing\n`);
      continue;
    }
    const folder = realpathSync(installed);
    const { version } = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8"));
    if (folder.startsWith(path.join(ROOT, "node_modules") + path.sep)) {
      hash.update(`${name} published ${version}\n`);
      continue;
    }
    hash.update(`${name} linked ${version}\n`);
    const dist = path.join(folder, "dist");
    if (!existsSync(dist)) continue;
    const files = readdirSync(dist, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name))
      .sort();
    for (const file of files) {
      const { size, mtimeMs } = statSync(file);
      hash.update(`${path.relative(folder, file)} ${size} ${mtimeMs}\n`);
    }
  }
  return hash.digest("hex").slice(0, 16);
}

const turbo = createRequire(import.meta.url).resolve("turbo/bin/turbo");
const result = spawnSync(process.execPath, [turbo, ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, SC2_CATALOG_STAMP: catalogStamp() },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
