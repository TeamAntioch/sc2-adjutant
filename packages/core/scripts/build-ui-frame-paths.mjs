#!/usr/bin/env node
// Regenerates data/ui-frame-paths.json: every frame Blizzard's own layouts declare, GameUI's
// frames and the stock templates among them, each with the template it is made from, for check's
// frame-path warning (src/ui/frame-path-check.ts, ADR-0019) to tell a hookup or template path the
// game has from one nothing defines.
//
// Read from the pinned mirror of the game's data, sc2-arcade-watcher/sc2-game-data at COMMIT:
// every .SC2Layout in its mods and campaigns, not those inside a map (a map's own layouts load only
// in that map). Each file is named by its stem, as the game names it, and read into a FrameTree,
// which writes it as nested frames, sorted by name, one per line, so a new pin's diff reads. A
// frame's template is kept, not copied out: a lookup follows it (Blizzard's templates of templates
// would copy out to hundreds of thousands of paths).
//
// Usage: npm run build -w @team-antioch/sc2-adjutant, then node packages/core/scripts/build-ui-frame-paths.mjs
// (GITHUB_TOKEN, when set, is sent with the one GitHub API call, the tree listing).

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { FrameTree, TEMPLATE_KEY } from "../dist/ui/frame-paths.js";
import { CORE_ROOT } from "./workspace-root.mjs";

const REPOSITORY = "sc2-arcade-watcher/sc2-game-data";
const COMMIT = "7be894538d6eac77a9583acfeb5f721e273beee4";
const OUTPUT = path.join(CORE_ROOT, "data", "ui-frame-paths.json");

const headers = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
const listing = await fetch(`https://api.github.com/repos/${REPOSITORY}/git/trees/${COMMIT}?recursive=1`, { headers });
if (!listing.ok) throw new Error(`Listing ${REPOSITORY} at ${COMMIT} failed: ${listing.status} ${listing.statusText}`);
const listed = await listing.json();
if (listed.truncated) throw new Error(`GitHub truncated the listing of ${REPOSITORY} at ${COMMIT}, so some layouts would be missed`);

const files = listed.tree
  .filter((entry) => entry.type === "blob" && /\.sc2layout$/i.test(entry.path) && !/\.sc2map\//i.test(entry.path))
  .map((entry) => entry.path)
  .sort();

/** Each file's text, a few at a time. */
async function fetchAll(paths, at = 8) {
  const out = new Array(paths.length);
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const index = next++;
      const response = await fetch(`https://raw.githubusercontent.com/${REPOSITORY}/${COMMIT}/${paths[index].split("/").map(encodeURIComponent).join("/")}`);
      if (!response.ok) throw new Error(`Fetching ${paths[index]} failed: ${response.status} ${response.statusText}`);
      out[index] = await response.text();
    }
  };
  await Promise.all(Array.from({ length: at }, worker));
  return out;
}

const texts = await fetchAll(files);
const layouts = files.map((file, index) => ({ name: path.posix.basename(file).replace(/\.sc2layout$/i, ""), xml: texts[index] }));
const tree = new FrameTree().addLayouts(layouts);
const stored = tree.toSnapshot();
const count = (node) => Object.entries(node).reduce((sum, [name, child]) => (name === TEMPLATE_KEY ? sum : sum + 1 + count(child)), 0);
// The top level is the files, not frames.
const frames = count(stored) - Object.keys(stored).length;

const snapshot = { source: { repository: REPOSITORY, commit: COMMIT, layouts: files.length, frames }, frames: stored };
await writeFile(OUTPUT, `${JSON.stringify(snapshot, null, 1)}\n`);
console.log(`Wrote ${frames} frames from ${files.length} layouts to ${path.relative(process.cwd(), OUTPUT)}`);
