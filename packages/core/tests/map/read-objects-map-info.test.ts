import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readMapInfo } from "../../src/map/read-map-info.js";
import { readObjectsXml } from "../../src/map/read-objects-xml.js";
import { xmlElements } from "../../src/map/xml-elements.js";
import { writeMapInfo } from "../../src/terrain/write-map-info.js";

describe("readObjectsXml", () => {
  it("reads full doodad transforms and set flags", () => {
    const xml = `<PlacedObjects Version="27">
    <ObjectDoodad Id="669" Position="102.5,81.49,9.698" Rotation="2.0017" Scale="1.2,0.5,1" Type="Protoss_Corpse_05" Pitch="1.5705" TintColor="255,128,0,255">
        <Flag Index="HeightOffset" Value="1"/>
        <Flag Index="ForcePlacement" Value="0"/>
    </ObjectDoodad>
    <ObjectDoodad Id="2" Position="1,2,3" Scale="1,1,1" Type="Rock"/>
    <ObjectUnit Id="5" Position="4,5,6" Scale="1,1,1" UnitType="Zealot" Player="1"/>
</PlacedObjects>`;
    const { doodads, units } = readObjectsXml(xml);
    expect(doodads[0]).toMatchObject({
      type: "Protoss_Corpse_05",
      position: { x: 102.5, y: 81.49, z: 9.698 },
      yaw: 2.0017,
      pitch: 1.5705,
      roll: 0,
      scale: { x: 1.2, y: 0.5, z: 1 },
      tintColor: "255,128,0,255",
      flags: ["HeightOffset"],
    });
    expect(doodads[1]).toMatchObject({ yaw: 0, flags: [] });
    expect(units[0]).toMatchObject({ type: "Zealot", player: 1 });
  });

  it("reads the Editor fixture's doodads", () => {
    const xml = readFileSync(new URL("../fixtures/editor-terrain/cliffs-and-ramps/Objects", import.meta.url), "utf8");
    expect(readObjectsXml(xml).doodads).toHaveLength(9);
  });
});

describe("readMapInfo", () => {
  it("recovers what writeMapInfo wrote", () => {
    const info = readMapInfo(
      writeMapInfo({
        width: 128,
        height: 128,
        tilesetId: "MonlythEx1",
        fogType: "Dark",
        playableBounds: [10, 8, 118, 108],
        players: [{ id: 0, controller: "Neutral" }],
      }),
    );
    expect(info).toMatchObject({ width: 128, height: 128, tilesetId: "MonlythEx1", fogType: "Dark", playableBounds: [10, 8, 118, 108] });
  });
});

describe("xmlElements", () => {
  it("decodes entities and reads bodies", () => {
    const [el] = xmlElements(`<ScriptCode a="&quot;x&quot;">if (a &lt; b)</ScriptCode>`, "ScriptCode");
    expect(el).toEqual({ tag: "ScriptCode", attrs: { a: '"x"' }, body: "if (a &lt; b)" });
  });
});
