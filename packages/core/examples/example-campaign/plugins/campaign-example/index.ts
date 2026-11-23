// The example Campaign Pack: what makes a Campaign itself rather than any campaign. Copy this
// folder to start your own (see the README two folders up).
//
// A Campaign Pack contributes, all optional:
//   - naming: how its Screenplays' conversations, lines, sounds and speakers are named in the map
//   - screenplaySource: where its Screenplays come from, if not files in the Workspace
// and its manifest names the Campaign Mod, whose Blueprint declares the characters: who speaks,
// what their Transmissions show and their placeholder voices (mods/example/blueprint.json).
// This one has a naming template and keeps its Screenplays as files.
//
// TypeScript that Node (22.18 or later) loads as it is. Its types come from core's plugin SDK,
// `@team-antioch/sc2-adjutant/plugin-sdk`; the import is types only, so Node erases it and the Plugin loads
// even where sc2-adjutant isn't installed.

import type { NamingTemplate, PluginCode, ScreenplayNamingContext } from "@team-antioch/sc2-adjutant/plugin-sdk";

function field(context: ScreenplayNamingContext, name: string): string {
  const value = context.fields[name];
  if (!value) throw new Error(`the Screenplay has no "- ${name}:" field`);
  return value;
}

/**
 * Every hook is optional: core's default (the Mission id, scene and line) fills in the ones a
 * template leaves out. This one leaves out lineId and soundLine, so lines are Line1-1, Line1-2...
 */
const naming: NamingTemplate = {
  name: "example",
  // Ch1_ashfall_relay, from the Screenplay's "- Chapter: 1" field and the Blueprint's id.
  conversationId: (context) => `Ch${field(context, "Chapter")}_${context.missionId}`,
  // Ch1_ashfall_relay_2_01: also the voice file's name, Ch1_ashfall_relay_2_01.wav.
  soundId: ({ conversationId, scene, line }) => `${conversationId}_${scene}_${String(line).padStart(2, "0")}`,
};

const plugin: PluginCode = { naming };
export default plugin;
