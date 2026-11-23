import { describe, expect, it } from "vitest";

import { belShirFlareLightXml, FLARE_LIGHT_CANDIDATES } from "../../src/catalog/flare-lights.js";
import { buildLightingPreview, FLARE_SOUND } from "../../src/triggers/build-lighting-preview.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";

describe("buildLightingPreview", () => {
  const doc = buildLightingPreview(FLARE_LIGHT_CANDIDATES);
  const script = writeMapScript({ mapName: "Lighting Preview", triggers: doc });

  it("flares to each candidate with the roar, then blends back to BelShirEx2", () => {
    for (const candidate of FLARE_LIGHT_CANDIDATES) {
      expect(script).toContain(`GameSetLighting("${candidate.id}", 0.5);`);
    }
    expect(script.match(/GameSetLighting\("BelShirEx2", 3\.0\);/g)).toHaveLength(FLARE_LIGHT_CANDIDATES.length);
    expect(script.match(new RegExp(`SoundPlayForPlayer\\(SoundLink\\("${FLARE_SOUND}", -1\\), c_maxPlayers, PlayerGroupAll\\(\\), 100\\.0, 0\\.0\\);`, "g"))).toHaveLength(
      FLARE_LIGHT_CANDIDATES.length,
    );
  });

  it("writes Light gamelinks and soundlinks the way the Editor writes them", () => {
    const xml = writeTriggersXml(doc);
    expect(xml).toContain(
      ["<Value>BelShirFlare</Value>", '<ValueType Type="gamelink"/>', '<ValueGameType Type="Light"/>'].map((line) => `        ${line}`).join("\r\n"),
    );
    expect(xml).toContain(`        <Value>${FLARE_SOUND}</Value>\r\n        <ValueType Type="soundlink"/>`);
  });

  it("defines the custom light as a full BelShirEx2 copy", () => {
    const light = belShirFlareLightXml();
    expect(light).toContain('<CLight id="BelShirFlare">');
    expect(light).not.toContain("parent=");
    expect(light).toContain('<Direction value="0.724693,-0.124265,-0.677775"/>');
  });
});
