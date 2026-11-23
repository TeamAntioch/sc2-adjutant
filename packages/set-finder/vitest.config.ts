// The Set Finder imports core as Node does, from core's dist; tests run core from source.
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    // No test may find the author's saved Jev key: see tests/no-saved-key.ts.
    setupFiles: ["tests/no-saved-key.ts"],
  },
  resolve: {
    extensions: [".ts", ".js"],
    alias: { "@team-antioch/sc2-adjutant/dist": fileURLToPath(new URL("../core/src", import.meta.url)) },
  },
});
