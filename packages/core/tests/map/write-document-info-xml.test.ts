import { describe, expect, it } from "vitest";

import { writeDocumentInfoXml } from "../../src/map/write-document-info-xml.js";

describe("writeDocumentInfoXml", () => {
  it("emits the default Void dependency", () => {
    const xml = writeDocumentInfoXml();
    expect(xml).toContain("<DocInfo>");
    expect(xml).toContain("<Value>Interface</Value>");
    expect(xml).toContain("bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod");
  });

  it("supports explicit dependencies", () => {
    const xml = writeDocumentInfoXml({ dependencies: ["file:Mods/Example-Campaign.SC2Mod"] });
    expect(xml).toContain("file:Mods/Example-Campaign.SC2Mod");
    expect(xml).not.toContain("bnet:Void");
  });
});
