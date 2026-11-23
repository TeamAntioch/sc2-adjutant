// Runs the level-design checker over a Mission Blueprint's layout and words its report: what the
// `check-layout` CLI and the MCP server's `check_layout` tool both run (docs/adr/0003).

import { hasKeptTerrain, type MissionBlueprint } from "../domain/mission-blueprint.js";
import { loadTriggerScenes } from "../cutscene/trigger-scene.js";
import { parseMissionBlueprint, type Workspace } from "../plugins/workspace.js";
import { type CheckResult, type CheckStatus, layoutChecksSkipped, runLayoutChecks } from "./checks.js";
import { buildLayoutModel } from "./layout-model.js";

export async function checkMissionLayout(
  workspace: Workspace,
  blueprintPath: string,
): Promise<{ readonly blueprint: MissionBlueprint; readonly checks: readonly CheckResult[] }> {
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  // The checks read Zones and Beats, which a Blueprint with Kept terrain doesn't have yet.
  if (hasKeptTerrain(blueprint)) return { blueprint, checks: layoutChecksSkipped(blueprint.zones.length === 0 ? KEPT_TERRAIN_REASON : BESIDE_KEPT_REASON) };
  // The trigger scenes that read, for the bounds check; one that doesn't is check_workspace's to report.
  const { loaded } = await loadTriggerScenes(blueprint, blueprintPath);
  return { blueprint, checks: runLayoutChecks(buildLayoutModel(blueprint), { triggerScenes: loaded }) };
}

const KEPT_TERRAIN_REASON = "The Blueprint has no Zones: every terrain cell is Kept Content, so there is no layout to check yet.";
const BESIDE_KEPT_REASON = "The Blueprint's Zones are beside Kept ground, which the layout checks don't read yet, so they're skipped: check_workspace checks each Connection across a seam.";

const MARK: Record<CheckStatus, string> = { pass: "✓", warn: "!", info: "·", "not-evaluated": "?" };

/** The report as the author reads it: one line per check, its findings beneath, then the tally. */
export function formatLayoutReport(title: string, checks: readonly CheckResult[]): string {
  const lines = [`Layout check: ${title}`, ""];
  for (const check of checks) {
    lines.push(`${MARK[check.status]} ${check.id}: ${check.title} [${check.status}; ${check.source}]`);
    for (const finding of check.findings) lines.push(`    ${finding}`);
  }
  const count = (status: CheckStatus) => checks.filter((check) => check.status === status).length;
  lines.push("", `${count("pass")} pass, ${count("warn")} warn, ${count("info")} info, ${count("not-evaluated")} not evaluated.`);
  return lines.join("\n");
}
