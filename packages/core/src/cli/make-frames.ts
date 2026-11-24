// Makes the 1000px frames of the active Style Pack's tours (makeFrames), in the Workspace above the
// current folder: what make-frames.sh runs, and what capture_exemplar does after each capture.
// The tours are in the pack's exemplar-maps/, or under $SC2_RESEARCH_DIR/docs/research/exemplar-maps/
// when it is set.

import path from "node:path";

import { makeFrames } from "../capture/style-pack-captures.js";
import { WORKSPACE_FILE, workspaceFor } from "../plugins/workspace.js";
import { exemplarCaptureDir } from "../study/study-exemplars.js";

async function main(): Promise<void> {
  const workspace = await workspaceFor(path.join(process.cwd(), WORKSPACE_FILE));
  const { made, removed, kept, unreadable } = await makeFrames(exemplarCaptureDir(workspace));
  console.log(`made ${made}, removed ${removed}, kept ${kept}`);
  if (unreadable.length) {
    console.error(`couldn't read ${unreadable.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
