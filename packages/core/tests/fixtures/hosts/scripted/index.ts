// A test Host Adapter that can run Test Document and speak, recording what it was asked to do in
// host.log in the machine's cache folder. Like a real one, it needs the Editor's path to test.
import { appendFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PluginCode } from "../../../../src/plugins/plugin-api.js";

const plugin: PluginCode = {
  capabilities: {
    "editor.testDocument": async ({ mapPath }, context) => {
      const editor = context.requirePath("editorPath");
      await appendFile(path.join(context.requirePath("cacheDir"), "host.log"), `${editor} tested ${mapPath}\n`);
    },
    "tts.speak": async ({ text, voice, outputPath }) => {
      await writeFile(outputPath, `spoken by ${voice}: ${text}\n`);
    },
  },
};
export default plugin;
