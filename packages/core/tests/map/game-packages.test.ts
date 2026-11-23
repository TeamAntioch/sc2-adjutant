// The game packages a map's dependencies load (#1019): the built-in chains the engine expands a
// game package's dependency into, through the Workspace's own mods' dependencies, and which
// packages define each of the game's models and Lights (data/package-entries.json).
import { describe, expect, it } from "vitest";

import { packageEntries, packageReachOf } from "../../src/map/game-packages.js";
import { DEFAULT_DEPENDENCIES } from "../../src/map/write-document-info-xml.js";

const NOVA_ASSETS = "bnet:Nova Covert Ops (Art Mod)/0.0/999,file:Mods/NovaStoryAssets.SC2Mod";
const VOID_STORY = "bnet:Void Story (Campaign)/0.0/999,file:Campaigns/VoidStory.SC2Campaign";

describe("the game packages a map's dependencies load", () => {
  it("loads Core and the base mods for the default Void (Mod), and no campaign or story package", () => {
    const reach = packageReachOf(DEFAULT_DEPENDENCIES, []);
    expect([...reach.loaded].sort()).toEqual(["mods/core.sc2mod", "mods/liberty.sc2mod", "mods/swarm.sc2mod", "mods/void.sc2mod"]);
    expect(reach.unresolved).toEqual([]);
  });

  it("expands the Nova Covert Ops art mod through the Void campaign to the base mods, so it can stand in for the default", () => {
    const { loaded } = packageReachOf([NOVA_ASSETS], []);
    expect(loaded).toContain("mods/novastoryassets.sc2mod");
    expect(loaded).toContain("campaigns/void.sc2campaign");
    expect(loaded).toContain("campaigns/swarm.sc2campaign");
    expect(loaded).toContain("campaigns/liberty.sc2campaign");
    expect(loaded).toContain("mods/void.sc2mod");
    expect(loaded).not.toContain("campaigns/voidstory.sc2campaign");
  });

  it("brings the Liberty and Swarm story campaigns in with Void Story", () => {
    const { loaded } = packageReachOf([VOID_STORY], []);
    expect(loaded).toContain("campaigns/swarmstory.sc2campaign");
    expect(loaded).toContain("campaigns/libertystory.sc2campaign");
  });

  it("reads a dependency in any case and with either slash, as the Editor writes a local one", () => {
    expect(packageReachOf(["file:Mods\\novastoryassets.sc2mod"], []).loaded).toContain("mods/novastoryassets.sc2mod");
  });

  it("follows a Workspace mod's own dependencies, however deep", () => {
    const mods = [
      { name: "Lantern-Story", dependencies: [NOVA_ASSETS, VOID_STORY, "file:Mods\\Lantern-Assets.SC2Mod"] },
      { name: "Lantern-Assets", dependencies: [] },
    ];
    const reach = packageReachOf(["file:Mods\\Lantern-Story.SC2Mod"], mods);
    expect(reach.loaded).toContain("mods/novastoryassets.sc2mod");
    expect(reach.loaded).toContain("campaigns/voidstory.sc2campaign");
    expect(reach.unresolved).toEqual([]);
  });

  it("names a dependency it can't follow: neither the game's nor a Workspace mod's", () => {
    const reach = packageReachOf(["file:Mods\\Elsewhere.SC2Mod", ...DEFAULT_DEPENDENCIES], []);
    expect(reach.unresolved).toEqual(["file:Mods\\Elsewhere.SC2Mod"]);
    expect(reach.loaded).toContain("mods/void.sc2mod");
  });
});

describe("which game packages define a model or a Light", () => {
  it("records Nova Covert Ops' own models and Lights in its art mod alone", () => {
    expect(packageEntries().models.get("SMX3_NovaMP03")).toEqual(["mods/novastoryassets.sc2mod"]);
    expect(packageEntries().lights.get("SMX3_Cutscene_MP03_030_Bridge")).toEqual(["mods/novastoryassets.sc2mod"]);
  });

  it("records a model every package that defines it", () => {
    // The Nova bridge's pieces are Liberty's CModels; their files are the art mod's (a Set's source package says so).
    expect(packageEntries().models.get("SMX3_Nova_Ship_Bridge01")).toEqual(["mods/liberty.sc2mod"]);
    expect(packageEntries().models.get("Marine")).toContain("mods/liberty.sc2mod");
  });

  it("knows nothing of a model none of the game's packages define", () => {
    expect(packageEntries().models.get("RadioDesk")).toBeUndefined();
  });
});
