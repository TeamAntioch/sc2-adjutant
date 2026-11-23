// The published package's Doodad Uses (its data/doodad-uses/, one file per doodad), which core reads
// as they are, checked against core's catalogs and merged into the sources core searches. Reading
// and merging uses is the package's, tested in sc2-asset-catalog.
import { describe, expect, it } from "vitest";

import { DOODAD_USES_DIR } from "@team-antioch/sc2-asset-catalog/catalog/catalog-dirs.js";
import { readDoodadUses } from "@team-antioch/sc2-asset-catalog/catalog/doodad-uses.js";

import { coreDoodadSources } from "../../src/catalog/stock-catalog.js";

describe("the package's Doodad Uses", () => {
  it("are valid, each for a doodad core's catalog has, none for a terrain object, and the catalogs hold none", () => {
    const uses = readDoodadUses(DOODAD_USES_DIR);
    const { doodads, terrainObjects } = coreDoodadSources();
    expect(Object.keys(uses.doodad).filter((id) => !Object.hasOwn(doodads, id))).toEqual([]);
    expect(Object.keys(uses["terrain-object"]).filter((id) => !Object.hasOwn(terrainObjects, id))).toEqual([]);
    expect(Object.keys(uses.doodad).length).toBeGreaterThan(0);
    const withUses = [...Object.values(doodads), ...Object.values(terrainObjects)].filter((entry) => entry.description && "uses" in entry.description);
    expect(withUses).toEqual([]);
  });

  it("are merged into the core sources the search reads", () => {
    const { doodads } = coreDoodadSources();
    const [id, uses] = Object.entries(readDoodadUses(DOODAD_USES_DIR).doodad)[0]!;
    expect(doodads[id]!.uses).toEqual(uses);
  });
});
