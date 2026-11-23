import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { writeT3TerrainXml } from "../../src/terrain/write-t3-terrain-xml.js";

describe("writeT3TerrainXml (cliff cells)", () => {
  it("emits an empty cliff cell list sized to 2x2-cell blocks, like an Editor-saved map", () => {
    const xml = writeT3TerrainXml({ catalog: EMPTY_CATALOG, tilesetId: "BelShirEx1", width: 128, height: 128, textureSetIndex: 0 });
    expect(xml).toContain('<cliffCellList num="4096" numOccupied="0"/>');
    expect(xml).not.toContain("<cc ");
    expect(xml).not.toContain("<cliffSetList");
  });

  it("lists the tileset's natural cliff set and one <cc> per cliff cell", () => {
    const xml = writeT3TerrainXml({
      catalog: EMPTY_CATALOG,
      tilesetId: "BelShirEx2",
      width: 128,
      height: 128,
      textureSetIndex: 0,
      cliffCells: [
        { index: 211, variation: 2, flags: 1 },
        { index: 212, variation: 0, flags: 1 },
      ],
    });
    expect(xml).toContain('<cliffSetList num="1">\n            <cliffSet i="0" name="BelShirEx1Cliff0"/>\n        </cliffSetList>\n        <vertData');
    expect(xml).toContain('<cliffCellList num="4096" numOccupied="2">\n            <cc i="211" f="1" cid="0" cvar="2"/>');
  });
});
