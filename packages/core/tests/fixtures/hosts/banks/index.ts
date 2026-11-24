// A test Host Adapter that only names the game's Banks folder: the cache folder's `Banks`.
import path from "node:path";

import type { PluginCode } from "../../../../src/plugins/plugin-api.js";

const plugin: PluginCode = {
  capabilities: {
    "game.banksDir": async (_request, context) => path.join(context.requirePath("cacheDir"), "..", "Banks"),
  },
};
export default plugin;
