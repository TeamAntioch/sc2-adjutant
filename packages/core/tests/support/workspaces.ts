// Fixture Workspaces that core's tests validate and compile Blueprints with. None holds anything
// from an author's own Campaign: tests/no-campaign-content.test.ts checks that.
//
// - `antioch`: the Antioch Style Pack (the public pack beside core) and hazard, for tests of the
//   dresser and the texture painter with a real pack's style rules and Doodad Composites.
// - `crossing`: hazard alone, with Ashen Crossing, a synthetic Mission with a hero, a hazard with
//   safe zones (shelters only once a Threat fails the Mission: tests/preview adds one) and a
//   Screenplay of stock characters, named by core's default naming template.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { missionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { workspaceCharacters } from "../../src/mods/characters.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { nameScript } from "../../src/script/name-script.js";
import { parseScript } from "../../src/script/parse-script.js";

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/workspaces/${name}/`, import.meta.url));

export const styleWorkspace = await loadWorkspace(fixture("antioch"));

/** The Mission Blueprint schema with the `antioch` Workspace's Plugins. */
export const StyleBlueprintSchema = missionBlueprintSchema(styleWorkspace.registry);

export const crossingWorkspace = await loadWorkspace(fixture("crossing"));

/** The Mission Blueprint schema with the `crossing` Workspace's Plugins. */
export const CrossingBlueprintSchema = missionBlueprintSchema(crossingWorkspace.registry);

const crossingDir = new URL("../fixtures/workspaces/crossing/missions/ashen-crossing/", import.meta.url);

export const crossingBlueprintPath = fileURLToPath(new URL("blueprint.json", crossingDir));

/** Ashen Crossing's Blueprint as stored. */
export const crossingRaw = JSON.parse(await readFile(crossingBlueprintPath, "utf8")) as Record<string, unknown>;

export const crossingMarkdown = await readFile(new URL("ashen-crossing.md", crossingDir), "utf8");

/** Ashen Crossing's Screenplay, named as its compile names it. */
export const crossingScript = nameScript(parseScript(crossingMarkdown), "ashen_crossing", crossingWorkspace.registry, await workspaceCharacters(crossingWorkspace));
