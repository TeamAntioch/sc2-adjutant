// Everything after an edit at the Screenplay Source, in one run: pulls the Screenplay, moves the
// Blueprint's Cinematics' shots onto their lines' new sound IDs and its scene references onto their
// scenes' new numbers, writes placeholder voices for new,
// changed and renumbered lines (as `npm run tts`), compiles the map when given a folder for it, and
// checks the Mission. It prints what moved, so prose that names sound IDs (a cutscene plan) can be
// brought up to date by hand, and exits 1 when a shot's line is gone or the check finds an error.
//
//   npm run refresh-screenplay -- missions/<id>/blueprint.json [--map <output-dir>]
//
// Given a Campaign Mod's Blueprint (mods/<id>/blueprint.json), it pulls each of the mod's
// Screenplays and prints how their sound IDs moved, which changed lines still play an imported
// Sound (`importedSounds`), and what the Workspace check finds in the mod. A mod has no Cinematics
// to follow and no voices of its own to write, and compiles with `compile-mod`, so it takes no --map.

import path from "node:path";

import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { writePlaceholderVoices } from "../host/placeholder-voices.js";
import { compileMission, describePlaceholders } from "../map/compile-mission.js";
import { refreshModScreenplays } from "../mods/conversations.js";
import { blueprintKind, readModBlueprint } from "../mods/workspace-mods.js";
import { checkWorkspace, formatWorkspaceCheck, isError } from "../plugins/check-workspace.js";
import { readMissionBlueprint, workspaceFor } from "../plugins/workspace.js";
import { readMissionScript } from "../script/name-script.js";
import { type LineMove, refreshScreenplay } from "../script/refresh-screenplay.js";
import { staysInside } from "../util/inside.js";

const USAGE = "Usage: refresh-screenplay <blueprint.json> [--map <output-dir>]";

/** A path as the user would type it from where this was run, when it is under there. */
const shown = (file: string): string => {
  const relative = path.relative(process.cwd(), file);
  return staysInside(relative) ? relative : file;
};

const listed = (moves: readonly LineMove[]): string => moves.map(({ from, to }) => (from === to ? from : `${from} → ${to}`)).join(", ");

/** A Campaign Mod's Screenplays: pulled, their lines followed, and the mod checked. */
async function refreshMod(blueprintPath: string): Promise<void> {
  const workspace = await workspaceFor(blueprintPath);
  const { sourceName, refreshed } = await refreshModScreenplays(blueprintPath, workspace);
  if (!sourceName) console.log("The Workspace's Campaign Pack has no Screenplay Source, so each Screenplay file is the Screenplay itself: nothing to pull");
  else if (refreshed.length === 0) console.log("The Mod Blueprint declares no Screenplays: nothing to pull");
  for (const { ref, path: file, moves, keptSounds } of refreshed) {
    console.log(`Pulled ${ref} from ${sourceName} to ${shown(file)}`);
    if (!moves) console.log("  There was no readable Screenplay before the pull, so no sound IDs were followed.");
    else if (!moves.moved.length && !moves.changed.length && !moves.gone.length) console.log("  Sound IDs: none moved.");
    else {
      console.log(`  Sound IDs: ${moves.moved.length} moved, ${moves.changed.length} changed in text or speaker, ${moves.gone.length} gone.`);
      if (moves.moved.length) console.log(`    Moved: ${listed(moves.moved)}`);
      if (moves.changed.length) console.log(`    Changed: ${listed(moves.changed)}`);
      if (moves.gone.length) console.log(`    Gone: ${moves.gone.join(", ")}`);
    }
    if (keptSounds.length) {
      console.log(`  ${keptSounds.join(", ")} changed but still play the Sound imported with ${keptSounds.length === 1 ? "it" : "them"} (importedSounds): if the old recording no longer fits, take ${keptSounds.length === 1 ? "it" : "them"} out of importedSounds once the author agrees.`);
    }
  }
  const modId = (await readModBlueprint(blueprintPath)).id;
  const check = await checkWorkspace(workspace.root);
  const own = { ...check, problems: check.problems.filter((problem) => problem.mod === modId) };
  for (const problem of own.problems) console.log(`mod ${modId}: ${problem.file}${problem.path ? ` ${problem.path}` : ""}: ${problem.severity ? `${problem.severity}: ` : ""}${problem.message}`);
  if (!own.problems.length) console.log(`Mod ${modId}: no problems.`);
  if (own.problems.some(isError)) process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mapAt = args.indexOf("--map");
  const outputDir = mapAt >= 0 ? args[mapAt + 1] : undefined;
  const positional = mapAt >= 0 ? [...args.slice(0, mapAt), ...args.slice(mapAt + 2)] : args;
  const [blueprintPath, ...rest] = positional;
  if (!blueprintPath || rest.length || (mapAt >= 0 && (!outputDir || outputDir.startsWith("--")))) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  if ((await blueprintKind(blueprintPath)) === "mod") {
    if (outputDir) throw new Error("--map compiles a Mission's map; a Campaign Mod compiles with `npm run compile-mod`");
    await refreshMod(blueprintPath);
    return;
  }
  const mission = await readMissionBlueprint(blueprintPath);
  const { blueprint, workspace } = mission;
  let failed = false;

  // 1. Pull, and follow the lines.
  const refresh = await refreshScreenplay(mission, blueprintPath);
  console.log(
    refresh.pull.sourceName
      ? `Pulled ${blueprint.screenplay.script?.ref} from ${refresh.pull.sourceName} to ${shown(refresh.pull.path)}`
      : `The Workspace's Campaign Pack has no Screenplay Source, so ${shown(refresh.pull.path)} is the Screenplay itself: nothing to pull`,
  );
  const { moves } = refresh;
  if (!moves) console.log("There was no readable Screenplay before the pull, so no sound IDs were followed.");
  else if (!moves.moved.length && !moves.changed.length && !moves.gone.length) console.log("Sound IDs: none moved.");
  else {
    console.log(`Sound IDs: ${moves.moved.length} moved, ${moves.changed.length} changed in text or speaker, ${moves.gone.length} gone.`);
    if (moves.moved.length) console.log(`  Moved: ${listed(moves.moved)}`);
    if (moves.changed.length) console.log(`  Changed: ${listed(moves.changed)}`);
    if (moves.gone.length) console.log(`  Gone: ${moves.gone.join(", ")}`);
    console.log("  Prose that names these sound IDs, such as the cutscene plans, isn't changed: bring it up to date by hand.");
  }
  if (refresh.scenes?.moved.length) {
    console.log(`Scenes: ${refresh.scenes.moved.map(({ from, to }) => `${from} → ${to}`).join(", ")}.`);
    if (refresh.scenes.repointed.length) console.log(`  The Blueprint's scene references moved with them (${refresh.scenes.repointed.map(({ from, to }) => `${from} → ${to}`).join(", ")}).`);
  }
  if (refresh.scenes?.unsure.length) {
    console.log(`Scenes that can't be followed: ${refresh.scenes.unsure.join(", ")} (lines split across scenes, or none to follow by): check the Blueprint's cues, Cinematics and Wave warnings that name them.`);
    failed = true;
  }
  if (refresh.cueLines.length) console.log(`Line cues: moved with their lines (${listed(refresh.cueLines)}).`);
  for (const cinematic of refresh.cinematics) {
    if (cinematic.repointed.length) console.log(`Cinematic ${cinematic.id}: ${cinematic.repointed.length} shot(s) moved with their lines (${cinematic.repointed.map(({ shot, from, to }) => `shot ${shot}: ${from} → ${to}`).join(", ")}).`);
    for (const { shot, line } of cinematic.orphaned) {
      console.log(`Cinematic ${cinematic.id}: shot ${shot} cuts on ${line}, which is gone: choose its line again in ${shown(cinematic.file)}.`);
      failed = true;
    }
  }

  // 2. Placeholder voices, as `npm run tts`, named with the Campaign Mod's characters: a speaker it doesn't declare stops here, pulled.
  const { script, voiceFormat } = (await readMissionScript(blueprint, blueprintPath, workspace))!;
  const host = await loadHost(await loadMachineConfig());
  if (!host.has("tts.speak")) console.warn(`The machine's Host Adapter can't speak (no tts.speak; set hostAdapter in ${host.machine.file}), so new and changed lines get silence.`);
  const voices = await writePlaceholderVoices(host, script, refresh.audioDir, "stale", { format: voiceFormat });
  console.log(`Voices: ${voices.spoken.length} spoken, ${voices.silent.length} silent, in ${shown(refresh.audioDir)}.`);
  if (voices.outdated.length) console.warn(`${voices.outdated.length} spoken placeholder(s) may no longer match their text and were kept, since this host can't speak: ${voices.outdated.join(", ")}`);
  if (voices.unhashed.length) console.warn(`${voices.unhashed.length} voice file(s) no longer match their line but were kept, as they might be real recordings: ${voices.unhashed.join(", ")}. If they are all placeholders, run \`npm run tts -- <blueprint> --adopt-unhashed\`.`);

  // 3. The map, when asked for.
  if (outputDir) {
    const { warnings, placeholders } = await compileMission(workspace, blueprintPath, outputDir, { host });
    console.log(`Map compiled in ${shown(path.resolve(outputDir))}`);
    const described = describePlaceholders(placeholders);
    if (described) console.log(described);
    for (const warning of warnings) console.warn(`Warning: ${warning}`);
  } else console.log("Map not compiled: pass --map <output-dir> to compile it.");

  // 4. The check, for this Mission.
  const missionId = path.basename(path.dirname(path.resolve(blueprintPath)));
  const check = await checkWorkspace(workspace.root);
  const own = { ...check, missions: [missionId], problems: check.problems.filter((problem) => problem.mission === missionId) };
  console.log(formatWorkspaceCheck(own));
  if (own.problems.some(isError)) failed = true;
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
