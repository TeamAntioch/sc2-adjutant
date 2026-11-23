// The vitest config of a first-party Plugin package: its vitest.config.ts re-exports this.
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const core = (relative: string) => fileURLToPath(new URL(`./${relative}`, import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Map compiles exceed the 5s default when files run in parallel.
    testTimeout: 30000,
  },
  resolve: {
    extensions: [".ts", ".js"],
    // The Plugin imports core as Node does from core's dist; tests run core from source. Tests may
    // also reach core's internals (compiling, loading a Workspace or a host) through @team-antioch/sc2-adjutant/src.
    alias: { "@team-antioch/sc2-adjutant/plugin-sdk": core("src/plugins/plugin-sdk.ts"), "@team-antioch/sc2-adjutant/src": core("src") },
  },
});
