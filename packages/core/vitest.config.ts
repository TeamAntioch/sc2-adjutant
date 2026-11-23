import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Full map compiles and ffmpeg runs exceed the 5s default when files run in parallel.
    testTimeout: 30000,
  },
  resolve: {
    extensions: [".ts", ".js"],
    // Local Plugins import core as the package does from dist; tests run core from source.
    alias: { "@team-antioch/sc2-adjutant/plugin-sdk": fileURLToPath(new URL("./src/plugins/plugin-sdk.ts", import.meta.url)) },
  },
});
