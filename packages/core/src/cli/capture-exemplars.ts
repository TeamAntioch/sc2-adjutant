// Captures camera tours of the active Style Pack's Exemplar Maps (the Workspace config's
// `stylePack`, found above the current folder) through this machine's Host Adapter
// (editor.captureTour), then makes their 1000px frames: what the capture_exemplar tool does
// (captureStylePack), from the command line. Tours go to the pack's exemplar-maps/<id>/captures/<tour>/,
// or under $SC2_RESEARCH_DIR/docs/research/exemplar-maps/ when it is set, as for the Antioch pack.
// Grid tours run once per lighting each map's triggers use (its Map Study's lighting.lightsUsed,
// or the exemplar's captureLights); --places runs place tours instead, one frame per dressed place
// in the pack's mixtures.json. Tours that already have frames are skipped, so reruns resume.
// Capture copies are built in the machine config's cacheDir.
//
//   npm run capture-exemplars -- [--places] [--start-on-init] [--show-errors] [id ...]
//
// The macOS Host Adapter needs the Editor (`editorPath`) with its Test Document window mode set to
// Windowed, Accessibility and Screen Recording for the app running this, and the screen awake.

import path from "node:path";
import { parseArgs } from "node:util";

import { captureStylePack } from "../capture/style-pack-captures.js";
import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { WORKSPACE_FILE, workspaceFor } from "../plugins/workspace.js";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { places: { type: "boolean", default: false }, "start-on-init": { type: "boolean", default: false }, "show-errors": { type: "boolean", default: false } },
  });
  const host = await loadHost(await loadMachineConfig());
  const workspace = await workspaceFor(path.join(process.cwd(), WORKSPACE_FILE));
  const result = await captureStylePack(workspace, host, {
    tours: values.places ? "places" : "grid",
    ...(positionals.length ? { ids: positionals } : {}),
    machine: host.machine,
    startOnInit: values["start-on-init"],
    showErrors: values["show-errors"],
    log: (line) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${line}`),
  });
  const { made, removed, kept, unreadable } = result.frames;
  console.log(`frames: made ${made}, removed ${removed}, kept ${kept}${unreadable.length ? `; unreadable: ${unreadable.join(", ")}` : ""}`);
  if (result.withoutPlaces.length) console.log(`no places for ${result.withoutPlaces.join(", ")}`);
  if (unreadable.length || result.outcomes.some((outcome) => outcome.outcome !== "done" && outcome.outcome !== "already captured")) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
