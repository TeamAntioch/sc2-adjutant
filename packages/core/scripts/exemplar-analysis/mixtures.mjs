// Extracts the mood mixture of every dressed place on the Antioch Style Pack's independent Exemplar
// Maps: which types an author used, in what roles and shares, how dense and how far apart, so a
// generator can make a new arrangement in the same mood rather than copy the layout (DL-07, DL-08, DL-15).
//
// Place-finding is core's (src/study/find-places.ts); this script adds Antioch's maps and its ten
// moods on top.
//
//   npm run build && node packages/core/scripts/exemplar-analysis/mixtures.mjs [id ...] > <Style Pack>/exemplar-maps/mixtures.json   (from the Workspace root)
//
// The Style Pack is the Workspace's active one; its Exemplar Maps folder is where its manifest's
// exemplarMaps list sits (packages/plugin-style-antioch/exemplar-maps for this repo).
import path from "node:path";

import { researchArchiveDir } from "../../dist/capture/research-archive.js";
import { exemplarMapSources, loadWorkspace, stylePackFiles } from "../../dist/plugins/workspace.js";
import { buildMixtures, findPlaces, readCaptureStops } from "../../dist/study/find-places.js";
import { loadMapPackage } from "../../dist/study/load-map-package.js";
import { studyDoodads } from "../../dist/study/measure-doodads.js";
import { workspaceRoot } from "../workspace-root.mjs";

// Captures and their 1000px frames are in the research archive SC2_RESEARCH_DIR names, never in the
// repo or the Style Pack. Without it every place would lose its frames, so it must be set.
const captureDir = path.join(researchArchiveDir(), "docs/research/exemplar-maps");
const workspace = await loadWorkspace(workspaceRoot());
const { exemplarDir } = stylePackFiles(workspace);
if (!exemplarDir) throw new Error("The Workspace's Style Pack lists no Exemplar Maps");
// One map per family of shared maps (episode-2-analysis.md, independence table).
const INDEPENDENT = ["1-1", "1-2", "1-4", "1-5", "1-7", "1-8", "2-0", "2-1", "2-2", "2-3", "2-4", "2-5", "2-6", "2-8", "3-0", "3-2", "3-3", "3-4", "3-5", "3-6", "3-7", "3-9", "3-10", "3-11"];
const only = process.argv.slice(2);
const ids = only.length ? only : INDEPENDENT;
// The active Style Pack's Exemplar Maps, with source maps from the machine config's exemplarMaps folder.
const exemplars = await exemplarMapSources(workspace);

// Antioch's moods: a place's story, read from its motif shares, first match wins. Checked against
// frames (mixtures.md).
const MOODS = [
  { name: "battlefield", test: (m) => (m.carnage ?? 0) >= 0.15 },
  { name: "infestation", test: (m) => (m.creep ?? 0) >= 0.2 },
  { name: "military post", test: (m) => (m.military ?? 0) >= 0.15 },
  { name: "lab", test: (m) => (m.lab ?? 0) >= 0.15 },
  { name: "street", test: (m) => (m.civic ?? 0) >= 0.2 },
  { name: "ruin", test: (m) => (m.wreck ?? 0) >= 0.15 || ((m.masonry ?? 0) >= 0.15 && (m.vegetation ?? 0) + (m.rock ?? 0) >= 0.3) },
  { name: "shrine", test: (m) => (m.masonry ?? 0) >= 0.2 },
  { name: "industrial", test: (m) => (m.machinery ?? 0) + (m.cargo ?? 0) >= 0.25 },
  { name: "built edge", test: (m) => (m.structure ?? 0) + (m.decal ?? 0) + (m.light ?? 0) >= 0.5 },
  { name: "wild ground", test: () => true },
];

const all = [];
for (const id of ids) {
  const e = exemplars.find((x) => x.id === id);
  const stops = readCaptureStops(captureDir, id);
  if (!stops) console.error(`${id}: no captures or frames in ${captureDir}; its places list no frames`);
  const places = findPlaces(id, studyDoodads(loadMapPackage(e.source)), { moods: MOODS, stops });
  all.push(...places);
  console.error(`${id}: ${places.length} places`);
}
const { moods, places } = buildMixtures(all, MOODS.map((m) => m.name));
console.log(JSON.stringify({ generated: new Date().toISOString().slice(0, 10), maps: ids, moods, places }, null, 1));
