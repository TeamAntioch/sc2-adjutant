// Writes a shot-list cutscene into a compiled map, where the Cutscene Editor opens it and the game
// can play it over the map's own set.
//
//   npm run compile-cutscene -- <shots.json> <map.SC2Map> [<name>] [--play]
//
// shots.json is a ShotCutscene (src/cutscene/write-shot-cutscene.ts), or a Mission's Cinematic
// (missions/<id>/cinematics/<cinematic>.json), written with its sets into a package compile-map
// wrote: one its blueprint lists with its scene's lines, one it doesn't (a test Cinematic) silent.
// The file lands at Base.SC2Data/Cutscenes/<name>.SC2Cutscene; name defaults to the JSON's base
// name (a listed Cinematic's is always its id). --play adds a custom script that plays it in a loop
// from map start, so Test Document shows it in game: a shot list at its origin, over the map; a
// Cinematic in a full-screen dialog. A test Cinematic named after the Cinematic the map's mission
// start cue plays takes its place, and that cue plays it instead. A shot list may not take the name
// of a Cinematic the map's triggers play (ignoring case), since it would replace that file.

import path from "node:path";

import { existsSync } from "node:fs";

import { cinematicIdOf, compileCinematicCutscene, compileShotCutscene, readShotCutscene } from "../cutscene/compile-cutscene.js";
import { BLUEPRINT_FILE, workspaceFor } from "../plugins/workspace.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const play = args.includes("--play");
  const [specPath, map, name] = args.filter((arg) => arg !== "--play");
  if (!specPath || !map) {
    console.error("Usage: compile-cutscene <shots.json> <map.SC2Map> [<name>] [--play]");
    process.exitCode = 2;
    return;
  }
  // A Cinematic sits in its Mission's cinematics folder, beside the blueprint that lists it.
  const blueprintPath = path.join(path.dirname(path.dirname(path.resolve(specPath))), BLUEPRINT_FILE);
  const inMission = path.basename(path.dirname(path.resolve(specPath))) === "cinematics" && existsSync(blueprintPath);
  const workspace = inMission ? await workspaceFor(blueprintPath) : undefined;
  const cinematic = workspace ? await cinematicIdOf(workspace, blueprintPath, specPath) : undefined;
  if (cinematic?.listed && name) console.warn(`A Cinematic is written under its id, ${cinematic.id}, not ${name}`);
  const result = cinematic
    ? await compileCinematicCutscene(workspace!, blueprintPath, cinematic.id, map, { play, ...(name && !cinematic.listed ? { name } : {}) })
    : await compileShotCutscene(await readShotCutscene(specPath), map, name ?? path.basename(specPath, ".json"), { play });
  console.log(`${result.shots} shots written to ${result.file}`);
  if (result.playsFrom) console.log(`Plays from map start at ${result.playsFrom.join(", ")}`);
  if (result.inDialog) console.log(`Plays from map start in a full-screen dialog${result.fromCue ? ", from its scene's missionStart cue" : ""}`);
  for (const warning of result.warnings ?? []) console.warn(`Warning: ${warning}`);
}

await main();
