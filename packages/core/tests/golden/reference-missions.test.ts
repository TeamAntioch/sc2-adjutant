// The reference Missions, compiled whole, compared file by file against a committed golden of hashes.
// This guards refactors that move code without meaning to change output: any change to any file
// of the Map Package, or to the warnings the author is shown, fails here. When a change to the
// output is intended, regenerate with `npm run update-golden` and commit it with the change.
//
// The inputs are frozen in a fixture Workspace (tests/fixtures/workspaces/reference), so nothing
// else trips it. Its Campaign Pack (storm and relay Mechanics, a naming template), Campaign Mod,
// the Antioch Style Pack (`bundled:style-antioch`) and hazard load as a Campaign's Workspace loads its Plugins.
// Two versions run: the full Mission and the hero run. The hero run's warnings (cliffs two levels
// apart, a doodad dependency, doodads with no outline) are part of what it guards, not mistakes to fix.
// The Style Pack's rules shape the dressing, so a change to them is an intended golden update too.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { readMissionBlueprint } from "../../src/plugins/workspace.js";
import { readMissionScript, scriptLines } from "../../src/script/name-script.js";

const savedAt = new Date("2026-01-01T00:00:00Z");
const missions = new URL("../fixtures/workspaces/reference/missions/", import.meta.url);

const cases = [
  { name: "Ember Reach", dir: new URL("ember-reach/", missions) },
  { name: "Ember Reach (hero run)", dir: new URL("ember-reach-run/", missions) },
];

let workDir: string | undefined;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-golden-"));
});

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

describe("compiled Map Packages", () => {
  it.each(cases)("$name matches its golden byte for byte", async ({ dir }) => {
    const golden = await compileAndHash(dir, await mkdtemp(path.join(workDir!, "case-")));
    await expect(`${JSON.stringify(golden, null, 2)}\n`).toMatchFileSnapshot(fileURLToPath(new URL("golden.json", dir)));
  }, 120_000);
});

async function compileAndHash(dir: URL, caseDir: string) {
  // Compiled as the CLI and the MCP server compile a Mission: through its Workspace and the Plugins
  // it loads. Only the voice files and the timestamp are the test's own.
  const blueprintPath = fileURLToPath(new URL("blueprint.json", dir));
  const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);
  const mission = await readMissionScript(blueprint, blueprintPath, workspace);
  if (!mission) throw new Error(`${fileURLToPath(dir)} blueprint no longer references its script`);

  // Placeholder voices, in .ogg as the Mission's voice format is by default (copied into the map as
  // they are). Each holds its own sound id, so a line copied to the wrong path changes a hash.
  const audioDir = path.join(caseDir, "audio");
  await mkdir(audioDir);
  for (const line of scriptLines(mission.script)) await writeFile(path.join(audioDir, `${line.soundId}.ogg`), `${line.soundId}\n`);

  const outputDir = path.join(caseDir, "Mission.SC2Map");
  const { warnings } = await compileMission(workspace, blueprintPath, outputDir, { audioDir, savedAt });
  return { warnings, files: await hashTree(outputDir) };
}

async function hashTree(root: string): Promise<Record<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const full = path.join(entry.parentPath, entry.name);
      return { full, key: path.relative(root, full).split(path.sep).join("/") };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const manifest: Record<string, string> = {};
  for (const { full, key } of files) manifest[key] = createHash("sha256").update(await readFile(full)).digest("hex");
  return manifest;
}
