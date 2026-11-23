// Core's committed copy of the doodad catalog (ADR-0022): the descriptions we write and the fields
// extracted from the game, read through the published package's join. The join itself is tested
// in sc2-asset-catalog.
import { describe, expect, it } from "vitest";

import { DOODAD_DESCRIPTION_FIELDS } from "@team-antioch/sc2-asset-catalog/catalog/doodad-catalog.js";

import { readCoreDoodadCatalog } from "../../src/catalog/stock-catalog.js";

describe("core's doodad catalog files", () => {
  it("describes only doodads the extracted file lists", () => {
    expect(readCoreDoodadCatalog().unextracted).toEqual([]);
  });

  it("holds no field extracted from the game in the descriptions file", () => {
    const { descriptions } = readCoreDoodadCatalog();
    expect(Object.keys(descriptions).length).toBeGreaterThan(2000);
    for (const [id, description] of Object.entries(descriptions)) for (const field of Object.keys(description)) expect(DOODAD_DESCRIPTION_FIELDS, `${id}.${field}`).toContain(field);
  });
});
