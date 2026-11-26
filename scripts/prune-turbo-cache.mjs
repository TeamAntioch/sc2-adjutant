// Prunes Turborepo's local cache to the entries this job's runs used, so the CI cache a job saves
// holds one commit's builds and lint, not every commit's since the cache was first made. Each turbo
// run writes its summary to .turbo/runs/ when TURBO_RUN_SUMMARY is set (the setup action sets it),
// naming the hash of every task it ran or replayed. A cache entry's files are named by that hash:
// `<hash>.tar.zst`, `<hash>-meta.json`, `<hash>-manifest.json`.
//
// Usage, from the repo root: node scripts/prune-turbo-cache.mjs
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const RUNS = path.join(".turbo", "runs");
const CACHE = path.join(".turbo", "cache");

if (!existsSync(RUNS) || !existsSync(CACHE)) {
  console.log("No turbo run summaries or cache here; nothing to prune.");
  process.exit(0);
}

const used = new Set();
for (const file of readdirSync(RUNS)) {
  if (!file.endsWith(".json")) continue;
  const summary = JSON.parse(readFileSync(path.join(RUNS, file), "utf8"));
  for (const task of summary.tasks ?? []) if (task.hash) used.add(task.hash);
}
if (used.size === 0) {
  // Without a summary there is no telling what was used: keep everything rather than nothing.
  console.log("No task hashes in the run summaries; keeping the whole cache.");
  process.exit(0);
}

let kept = 0;
let removed = 0;
for (const file of readdirSync(CACHE)) {
  const hash = file.split(/[-.]/, 1)[0];
  if (used.has(hash)) kept++;
  else {
    rmSync(path.join(CACHE, file), { recursive: true, force: true });
    removed++;
  }
}
rmSync(RUNS, { recursive: true, force: true });
console.log(`Turbo cache: kept ${kept} files for ${used.size} tasks this job ran, removed ${removed}.`);
