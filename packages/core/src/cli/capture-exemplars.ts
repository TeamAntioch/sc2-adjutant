// Captures camera tours of the active Style Pack's Exemplar Maps (the Workspace config's
// `stylePack`, found above the current folder) through this machine's Host Adapter
// (editor.captureTour), into <id>/captures/<tour>/ in the research archive ($SC2_RESEARCH_DIR,
// which must be set). Source maps come from the folder the machine config's
// `exemplarMaps` names, as for `npm run study`. Grid tours run once per lighting each map's
// triggers use (its Map Study's lighting.lightsUsed, or the exemplar's captureLights); --places
// runs place tours instead, one frame per dressed place in the pack's mixtures.json. Tours that
// already have frames are skipped, so reruns resume. Capture copies are built in the machine
// config's cacheDir.
//
//   npm run capture-exemplars -- [--places] [--start-on-init] [--show-errors] [id ...]
//   scripts/exemplar-capture/make-frames.sh     # then the 1000px copies, beside the captures
//
// The macOS Host Adapter needs the Editor (`editorPath`) with its Test Document window mode set to
// Windowed, Accessibility and Screen Recording for the app running this, and the screen awake.

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { captureExemplarTours, gridTours, placeTours, type ExemplarEntry, type ExemplarMixtures, type ExemplarStudy } from "../capture/exemplar-capture.js";
import { researchArchiveDir } from "../capture/research-archive.js";
import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { exemplarMapSources, stylePackFiles, WORKSPACE_FILE, workspaceFor } from "../plugins/workspace.js";

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { places: { type: "boolean", default: false }, "start-on-init": { type: "boolean", default: false }, "show-errors": { type: "boolean", default: false } },
  });
  const host = await loadHost(await loadMachineConfig());
  const workspace = await workspaceFor(path.join(process.cwd(), WORKSPACE_FILE));

  const sources = await exemplarMapSources(workspace, host.machine);
  // Each entry's capture settings (captureLights, placeLight, placeZones) are in its settings.
  const exemplars: ExemplarEntry[] = sources.map((exemplar) => ({ ...(exemplar.settings as Partial<ExemplarEntry>), id: exemplar.id, path: exemplar.source }));
  const studyDirs = new Map(sources.map((exemplar) => [exemplar.id, exemplar.studyDir]));
  const studyOf = (id: string) => readJson<ExemplarStudy>(path.join(studyDirs.get(id)!, "study.json"));
  const mixtures = (): ExemplarMixtures => {
    const { exemplarDir } = stylePackFiles(workspace);
    if (!exemplarDir) throw new Error("The Workspace's Style Pack lists no Exemplar Maps (contributions.exemplarMaps)");
    return readJson<ExemplarMixtures>(path.join(exemplarDir, "mixtures.json"));
  };
  const planned = values.places ? placeTours(exemplars, mixtures(), studyOf) : gridTours(exemplars, studyOf);
  const wanted = new Set(positionals);
  const tours = planned.filter((tour) => wanted.size === 0 || wanted.has(tour.id));
  // Full-size captures go to the research archive (README "Research archive"), not the repo.
  const capturesRoot = path.join(researchArchiveDir(), "docs/research/exemplar-maps");
  const outcomes = await captureExemplarTours(host, tours, {
    capturesRoot,
    startOnInit: values["start-on-init"],
    showErrors: values["show-errors"],
    log: (line) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${line}`),
  });
  if (outcomes.some((outcome) => outcome.outcome !== "done" && outcome.outcome !== "already captured")) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
