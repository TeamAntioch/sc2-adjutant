// The MapScript drift test (ADR-0010): compile a Mission in place, have the Editor save a copy of
// its package through the Host Adapter (editor.save), and compare the Editor's MapScript.galaxy
// with the spliced one, section by section (triggers/map-script-drift.ts). The copy lives under
// the machine's `<cacheDir>/drift/`, so the Editor's save never rewrites the Mission's package.

import { existsSync } from "node:fs";
import { readFile, rm, cp } from "node:fs/promises";
import path from "node:path";

import { runEditorAction } from "../capture/editor-broker-client.js";
import { hostContext } from "../host/machine-config.js";
import { type Host, requireCapability } from "../host/host.js";
import type { Workspace } from "../plugins/workspace.js";
import { mapScriptDrift, type SectionDrift } from "../triggers/map-script-drift.js";
import { compileMission } from "./compile-mission.js";
import { checkEditorClosed } from "./kept-session.js";
import { missionMapPackage } from "./mission-package.js";

export const DRIFT_FOLDER = "drift";

export type DriftResult = {
  /** The Mission's package, as compiled. */
  readonly mapPackage: string;
  /** The copy the Editor saved. */
  readonly savedCopy: string;
  readonly drift: readonly SectionDrift[];
};

export async function runDriftTest(workspace: Workspace, blueprintPath: string, host: Host, options: { readonly savedAt?: Date; readonly seconds?: number } = {}): Promise<DriftResult> {
  requireCapability(host, "editor.save", "The MapScript drift test");
  // Neither the package nor the copy is rewritten under an Editor that has it open (it can crash).
  const target = await missionMapPackage(blueprintPath);
  const savedCopy = path.join(hostContext(host.machine).requirePath("cacheDir"), DRIFT_FOLDER, path.basename(target));
  for (const mapPath of [target, savedCopy]) if (existsSync(mapPath)) await checkEditorClosed(host, mapPath);
  const { outputDir: mapPackage } = await compileMission(workspace, blueprintPath, undefined, { host, ...(options.savedAt ? { savedAt: options.savedAt } : {}) });
  await rm(savedCopy, { recursive: true, force: true });
  await cp(mapPackage, savedCopy, { recursive: true });
  // Through the Editor Broker on a machine that captures, waiting its turn behind any capture.
  await runEditorAction(host, "editor.save", { mapPath: savedCopy, ...(options.seconds ? { seconds: options.seconds } : {}) });
  const spliced = await readFile(path.join(mapPackage, "MapScript.galaxy"), "utf8");
  const saved = await readFile(path.join(savedCopy, "MapScript.galaxy"), "utf8");
  return { mapPackage, savedCopy, drift: mapScriptDrift(spliced, saved) };
}
