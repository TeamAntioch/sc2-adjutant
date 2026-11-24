// Extracts the mood mixture of every dressed place on the Antioch Style Pack's independent Exemplar
// Maps: which types an author used, in what roles and shares, how dense and how far apart, so a
// generator can make a new arrangement in the same mood rather than copy the layout (DL-07, DL-08, DL-15).
//
// The find_places tool's code (src/study/study-exemplars.ts) over Antioch's independent maps, with
// frames from the research archive. Its ten moods are the moodRules its mixtures.json records.
//
//   npm run build && node packages/core/scripts/exemplar-analysis/mixtures.mjs [id ...]   (from the Workspace root)
//
// It rewrites the active Style Pack's mixtures.json, beside its Exemplar Maps list
// (packages/plugin-style-antioch/exemplar-maps for this repo).
import path from "node:path";

import { researchArchiveDir } from "../../dist/capture/research-archive.js";
import { loadWorkspace } from "../../dist/plugins/workspace.js";
import { findStylePackPlaces } from "../../dist/study/study-exemplars.js";
import { workspaceRoot } from "../workspace-root.mjs";

// Captures and their 1000px frames are in the research archive SC2_RESEARCH_DIR names, never in the
// repo or the Style Pack. Without it every place would lose its frames, so it must be set.
const captureDir = path.join(researchArchiveDir(), "docs/research/exemplar-maps");
// One map per family of shared maps (episode-2-analysis.md, independence table).
const INDEPENDENT = ["1-1", "1-2", "1-4", "1-5", "1-7", "1-8", "2-0", "2-1", "2-2", "2-3", "2-4", "2-5", "2-6", "2-8", "3-0", "3-2", "3-3", "3-4", "3-5", "3-6", "3-7", "3-9", "3-10", "3-11"];
const only = process.argv.slice(2);
const found = await findStylePackPlaces(await loadWorkspace(workspaceRoot()), { ids: only.length ? only : INDEPENDENT, captureDir });
for (const id of found.withoutFrames) console.error(`${id}: no captures or frames in ${captureDir}; its places list no frames`);
console.error(`${found.places} places from ${found.maps.length} maps in ${found.file}`);
