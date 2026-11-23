import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { writeT3TerrainXml, type T3TerrainXmlOptions } from "../../src/terrain/write-t3-terrain-xml.js";

describe("writeT3TerrainXml", () => {
  it("emits a valid t3Terrain.xml matching the reference format", () => {
    const options: T3TerrainXmlOptions = {
      catalog: EMPTY_CATALOG,
      tilesetId: "BelShirEx1",
      width: 128,
      height: 128,
      textureSetIndex: 0,
    };
    const xml = writeT3TerrainXml(options);
    expect(xml).toContain('<terrain version="115">');
    expect(xml).toContain('tileSet="BelShirEx1"');
    expect(xml).toContain('dim="129 129 "');
    expect(xml).toContain('quantizeBias="9.000000e+00"');
    expect(xml).toContain('quantizeScale="2.746134e-04"');
    expect(xml).toContain('standardHeight="8.000000e+00"');
    expect(xml).toContain("<vertData");
    expect(xml).toContain("<masks");
    expect(xml).toContain("<textureSetList");
    expect(xml).toContain("<textureList");
    expect(xml).toContain("<blockTextureSetList");
    expect(xml).toContain("<cliffCellList");
  });
});
