import { describe, expect, it } from "vitest";

import { buildCardSheet, sourceKey } from "../../src/cutscene/contact-sheet.js";
import { lightings, lightVariants, testLightData } from "../../src/cutscene/light-test.js";
import { readCutscene } from "../../src/cutscene/read-cutscene.js";
import { buildSetCatalog, type CutsceneSource } from "../../src/cutscene/set-catalog.js";

const piece = (guid: string, model: string) => `<CCutsceneNodeActor guid="${guid}" name="${model}" position="0,0,5" modelLink="${model}"/>`;
const lamp = (guid: string, name: string, camera: string) =>
  `<CCutsceneNodeLight guid="${guid}" name="${name}" position="0,0,6" type="2"><CCutsceneElementObject guid="${guid}1" duration="10000"/><CCutsceneNodeActiveShot guid="${guid}2" cameraGUID="${camera}"/></CCutsceneNodeLight>`;
const camera = (guid: string, name: string, eye: string, aim = "0,0,1") => {
  const [x, y, z] = eye.split(",");
  return `<CCutsceneNodeTargetCamera guid="${guid}" name="${name}" position="${aim}" eyePositionX="${x}" eyePositionY="${y}" eyePositionZ="${z}"><CCutsceneElementObject guid="${guid}1" duration="10000"/></CCutsceneNodeTargetCamera>`;
};
// Three shots: the wide (camera 70, under BridgeLight), from 5 s a second wide from the side (camera
// 80, under SideLight), and a close-up of a face (camera 90) a foot from its subject.
const source: CutsceneSource = {
  origin: "studio",
  path: "Maps/Test/Bridge.SC2Cutscene",
  xml: `<CutsceneState cutsceneVersion="1.3">
    <CCutsceneNodeDirector guid="1" name="Director">
      <CCutsceneNodeActiveLight guid="2"><CCutsceneElementActiveLight guid="3" lightID="BridgeLight"/><CCutsceneElementActiveLight guid="4" start="5000" lightID="SideLight"/></CCutsceneNodeActiveLight>
      <CCutsceneNodeActiveCamera guid="5"><CCutsceneElementActiveCamera guid="6" objectGuid="70"/><CCutsceneElementActiveCamera guid="7" start="5000" objectGuid="80"/></CCutsceneNodeActiveCamera>
    </CCutsceneNodeDirector>
    <CCutsceneNodeFolder guid="8" name="Set"><CCutsceneNodeFolder guid="9" name="Bridge">${piece("10", "Bridge00")}${piece("20", "Bridge01")}${piece("30", "Bridge02")}</CCutsceneNodeFolder></CCutsceneNodeFolder>
    <CCutsceneNodeFolder guid="40" name="Lights">${lamp("50", "Wide Key", "70")}${lamp("51", "Wide Fill", "70")}${lamp("60", "Side Key", "80")}${lamp("61", "Face Key", "90")}</CCutsceneNodeFolder>
    <CCutsceneNodeFolder guid="65" name="Cameras">${camera("70", "Wide", "0,-3,1.5")}${camera("80", "Side", "3,-3,1.5")}${camera("90", "Face", "0,-1,1", "0,-0.8,1")}</CCutsceneNodeFolder>
  </CutsceneState>`,
};
const set = buildSetCatalog([source])[0]!;
// Nearest the wide camera, which stands at (0, -3, 1.5).
const card = { card: "card/2.jpg", eye: [0.5, -3, 1.5] as const, target: [0, 0, 1] as const, fov: 40 };

describe("lightVariants", () => {
  const { entries, lights } = lightVariants(set, source, card, 3, "Test");

  it("lights the card camera with the lamps of the shots each rule picks, under the Light active at the first one's cut", () => {
    expect(entries.map((entry) => [entry.label, entry.light, entry.lamps])).toEqual([
      ["no lamps, BridgeLight", undefined, "none"],
      ['closest shot: shot "Wide", 2 lamps, BridgeLight', "BridgeLight", { shots: ["70"] }],
      // The best-matching wide shot is the closest one again, so it isn't filmed twice; the close-up is no wide shot.
      ['wide shots standing near: 2 shots from "Wide", 3 lamps, BridgeLight', "BridgeLight", { shots: ["70", "80"] }],
    ]);
    expect(lights).toEqual([]);
    expect(entries.every((entry) => entry.cameras[0] === card && entry.set === set)).toBe(true);
  });

  it("keeps only the picked shots' lamps in the sheet cutscene", () => {
    const sheet = buildCardSheet([entries[2]!], new Map([[sourceKey(source.origin, source.path), source]]));
    const root = readCutscene(sheet.cutscenes[0]!.xml);
    expect(root.children.find((child) => child.attrs.name === "Lights")!.children.map((child) => child.attrs.name)).toEqual(["Wide Key", "Wide Fill", "Side Key"]);
  });

  it("turns the base Light's exposure, through test Lights inheriting the rest, for a set no lamp lights", () => {
    const unlit: CutsceneSource = { ...source, xml: source.xml.replace(/<CCutsceneNodeLight [^]*?<\/CCutsceneNodeLight>/g, "") };
    const bare = lightVariants(buildSetCatalog([unlit])[0]!, unlit, card, 1, "Test");
    expect(bare.entries.map((entry) => entry.label)).toEqual(["no lamps, BridgeLight", "no lamps, BridgeLight at exposure 2", "no lamps, BridgeLight at exposure 3.5", "no lamps, BridgeLight at exposure 5"]);
    expect(bare.lights[0]).toEqual({ id: "Test1_1", parent: "BridgeLight", exposure: 2 });
    const xml = testLightData(bare.lights)!;
    expect(xml).toContain('<CLight id="Test1_1" parent="BridgeLight">');
    expect(xml).toContain('<Param index="HDRExposure" value="2.000000"/>');
    expect(testLightData([])).toBeUndefined();
  });

  it("offers all the set's lamps first, among the lightings a card camera is filmed under to pick from", () => {
    expect(lightings(set, source, card, "Pick1", { all: true }).map((way) => [way.name, way.lamps, way.light])).toEqual([
      ["all 4 lamps, BridgeLight", "all", "BridgeLight"],
      ['closest shot: shot "Wide", 2 lamps, BridgeLight', { shots: ["70"] }, "BridgeLight"],
      ['wide shots standing near: 2 shots from "Wide", 3 lamps, BridgeLight', { shots: ["70", "80"] }, "BridgeLight"],
    ]);
  });
});
