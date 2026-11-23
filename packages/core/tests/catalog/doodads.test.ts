import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { matchDoodads } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";
import { coreDoodadSources, checkDoodad, getDoodad, getDoodadModel } from "../../src/catalog/stock-catalog.js";

describe("doodad catalog", () => {
  it("knows the Editor-placed Bel'Shir doodads and their variation counts", () => {
    // The Editor placed BelShirFlowers with Variation 9, the last of 10.
    expect(getDoodad(EMPTY_CATALOG, "BelShirFlowers")?.variations).toBe(10);
    expect(getDoodad(EMPTY_CATALOG, "RockArch")?.tilesets).toContain("Meinhoff");
  });

  it("rejects unknown types and out-of-range variations", () => {
    expect(() => checkDoodad(EMPTY_CATALOG, "a", "NoSuchDoodad", undefined)).toThrow(/unknown doodad type/);
    expect(() => checkDoodad(EMPTY_CATALOG, "a", "BelShirFlowers", 10)).toThrow(/variations 0-9/);
    expect(() => checkDoodad(EMPTY_CATALOG, "a", "BelShirFlowers", 9)).not.toThrow();
  });
});

describe("the doodads only novastoryassets.sc2mod and voidprologue.sc2mod define", () => {
  // Added when the extracted doodads.json was adopted (#690); they have no description yet.
  const added: ReadonlyArray<readonly [id: string, words: readonly string[]]> = [
    ["FlameTurretFlameModelDoodad", ["flame", "turret"]],
    ["Tarsonis_Windows_Terran_Destructible", ["tarsonis", "windows", "terran"]],
    ["Tarsonis_Windows_Zerg_Destructible", ["tarsonis", "windows", "zerg"]],
    ["VoidCatalystBase", ["void", "catalyst"]],
    ["VoidPrologueColonistShip", ["colonist", "ship"]],
    ["VultureChase_CargoTruckUnitBarrels", ["cargo", "truck", "barrels"]],
    ["VultureChase_CargoTruckUnitFlatbed", ["cargo", "truck", "flatbed"]],
    ["VultureChase_CargoTruckUnitTrailer", ["cargo", "truck", "trailer"]],
  ];

  it.each(added)("%s resolves a model", (id) => {
    expect(getDoodad(EMPTY_CATALOG, id)).toBeDefined();
    expect(getDoodadModel(id)).toMatch(/\.m3$/);
  });

  it.each(added)("%s turns up in a search for words of its name and id", (id, words) => {
    expect(matchDoodads({ words }, coreDoodadSources()).map((match) => match.id)).toContain(id);
  });
});

describe("which game doodads block ground", () => {
  it("leaves walkable decks unblocked and blocks solid doodads, as SC2GameData's footprints say", () => {
    const blocks = (id: string) => getDoodad(EMPTY_CATALOG, id)?.blocksGround === true;
    expect(["UmojanLabCatwalkSectionPlatform", "UmojanLabCatwalkSectionRampNE", "IceBridge", "MarSaraBridge", "ChainLinkFenceStraight", "UnbuildablePlates"].filter(blocks)).toEqual([]);
    expect(["MengskPalace", "CastanarStasisTubeLarge", "PathingandSightBlocker1x1Doodad"].filter((id) => !blocks(id))).toEqual([]);
  });
});
