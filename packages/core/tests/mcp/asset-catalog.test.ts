// The Asset Catalog through the MCP server: the design skills read core's catalog files for the
// game's entries, and asset_catalog for what the Workspace's Campaign Mod defines, resolved as a
// Mission compile resolves them.
import { afterEach, describe, expect, it } from "vitest";

import { cleanupLantern, lanternWorkspace } from "../mods/lantern-fixture.js";
import { connect, fixture, text } from "./harness.js";

afterEach(cleanupLantern);

describe("asset_catalog", () => {
  it("lists the Campaign Mod's tilesets, textures, Lights and units, Kept and Blueprint-owned, each tileset resolved through its parent", async () => {
    const { root } = await lanternWorkspace();
    const client = await connect(root);

    const reply = await client.callTool({ name: "asset_catalog", arguments: {} });
    expect(reply.isError).toBeFalsy();
    const coast = {
      id: "LanternCoast",
      textures: ["LanternShingle", "MeinhoffWhiteSand", "MeinhoffRoughSand", "MeinhoffCraters", "MeinhoffRock", "MeinhoffConcrete", "MeinhoffPanels", "MeinhoffGrating"],
      cliffSets: ["MeinhoffEx1Cliff0", "MeinhoffEx1Cliff1"],
      light: "LanternDusk",
      sky: { skybox: "LanternSky", fogEnabled: "1", fogColor: "255,40,60,90" },
    };
    expect(reply.structuredContent).toEqual({
      source: "the Campaign Mod Lantern-Story in mods/lantern-story",
      tilesets: [coast, { ...coast, id: "LanternReef", cliffSets: ["MeinhoffEx1Cliff1", "MeinhoffEx1Cliff0"], sky: { ...coast.sky, hideLowestLevel: "1" } }],
      textures: ["LanternShingle"],
      cliffSets: [],
      lights: ["LanternDusk"],
      units: [{ id: "LanternKite", flyer: true }, { id: "SignalBeacon" }],
      doodads: [],
      models: [],
    });
    expect(text(reply)).toMatch(/^The Campaign Mod Lantern-Story in mods\/lantern-story defines:\ntilesets: LanternCoast, LanternReef\n/);
  });

  it("says so when the Workspace has no Campaign Mod, pointing to core's catalogs for the game's entries", async () => {
    const client = await connect(fixture("field"));
    const reply = await client.callTool({ name: "asset_catalog", arguments: {} });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({ tilesets: [], textures: [], cliffSets: [], lights: [], units: [], doodads: [], models: [] });
    expect(text(reply)).toMatch(/no Campaign Mod.*data\//);
  });
});
