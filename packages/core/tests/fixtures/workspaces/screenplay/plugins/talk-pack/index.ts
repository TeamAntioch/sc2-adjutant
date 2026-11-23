// A test Campaign Pack with a naming template that gives only some hooks (core's default fills
// in the rest). Its Campaign Mod, Talk-Story, declares two stock characters (mods/talk-story).
import type { PluginCode } from "../../../../../../src/plugins/plugin-api.js";

const plugin: PluginCode = {
  naming: {
    name: "chapters",
    conversationId: ({ fields, missionId }) => {
      if (!fields["Chapter"]) throw new Error("the Screenplay has no Chapter field");
      return `Ch${fields["Chapter"]}_${missionId}`;
    },
    soundId: ({ conversationId, scene, line }) => `${conversationId}_S${scene}_L${line}`,
    characterId: (name) => `Stock${name}`,
  },
};

export default plugin;
