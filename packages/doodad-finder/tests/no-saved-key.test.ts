import { jevKey } from "@team-antioch/sc2-doodad-finder/credentials.js";
import { describe, expect, it } from "vitest";

import { EMPTY_CONFIG_DIR } from "./no-saved-key.ts";

describe("the tests' Jev key", () => {
  it("is nowhere to be found, so no test can call Jev for real", () => {
    expect(process.env.SC2_ASSET_CATALOG_CONFIG).toBe(EMPTY_CONFIG_DIR);
    expect(process.env.TYPESAFE_API_KEY).toBeUndefined();
    expect(jevKey()).toBeUndefined();
    expect(jevKey({ env: { SC2_ASSET_CATALOG_CONFIG: EMPTY_CONFIG_DIR } })).toBeUndefined();
  });
});
