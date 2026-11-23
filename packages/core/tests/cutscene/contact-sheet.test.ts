import { describe, expect, it } from "vitest";

import { buildCardSheet, buildContactSheet, buildOriginalSheet, LEAD_MS, originalMoments, SHEET_CAMPAIGNS, SHOT_MS, sheetDependencies, sourceKey } from "../../src/cutscene/contact-sheet.js";
import { type CutsceneNode, readCutscene } from "../../src/cutscene/read-cutscene.js";
import { buildSetCatalog, type CutsceneSource } from "../../src/cutscene/set-catalog.js";

const piece = (guid: string, model: string) =>
  `<CCutsceneNodeActor guid="${guid}" name="${model}" position="0,0,5" modelLink="${model}"><CCutsceneElementObject guid="${guid}1" start="2000" duration="900"/><CCutsceneNodeActiveShot guid="${guid}2" cameraGUID="55"/></CCutsceneNodeActor>`;

const bridge: CutsceneSource = {
  origin: "studio",
  path: "Maps/Test/Opening.SC2Cutscene",
  xml: `<CutsceneState cutsceneVersion="1.3">
    <CCutsceneNodeDirector guid="1" name="Director"><CCutsceneNodeActiveLight guid="2"><CCutsceneElementActiveLight guid="3" lightID="BridgeLight"/></CCutsceneNodeActiveLight></CCutsceneNodeDirector>
    <CCutsceneNodeFolder guid="4" name="Set"><CCutsceneNodeFolder guid="5" name="Corvette Bridge">${piece("10", "Bridge00")}${piece("20", "Bridge01")}${piece("30", "Bridge02")}</CCutsceneNodeFolder></CCutsceneNodeFolder>
    <CCutsceneNodeFolder guid="6" name="Characters"><CCutsceneNodeActor guid="40" name="Nova" position="1,2,5" modelLink="NovaTerra"/></CCutsceneNodeFolder>
    <CCutsceneNodeFolder guid="7" name="Lights"><CCutsceneNodeLight guid="50" name="Nova Key" position="1,2,6" type="2"><CCutsceneElementObject guid="51" duration="10"/><CCutsceneNodeActiveShot guid="52" cameraGUID="55"/></CCutsceneNodeLight></CCutsceneNodeFolder>
    <CCutsceneNodeFolder guid="8" name="Camera"><CCutsceneNodeCamera guid="55" name="Nova Wide" position="1,2,5.5" distance="4" pitch="5" yaw="180" fov="27.8"><CCutsceneElementObject guid="56" duration="10"/></CCutsceneNodeCamera></CCutsceneNodeFolder>
  </CutsceneState>`,
};

const sets = buildSetCatalog([bridge]);
const sheet = buildContactSheet(sets, new Map([[sourceKey(bridge.origin, bridge.path), bridge]]));
const root = readCutscene(sheet.cutscenes[0]!.xml);
const all = (node: CutsceneNode): CutsceneNode[] => [node, ...node.children.flatMap(all)];

describe("the contact sheet", () => {
  it("copies the set's scenery and lights, lasting the whole cutscene, without ties to missing cameras", () => {
    const total = String(LEAD_MS + 6 * SHOT_MS + 500);
    const set = root.children.find((child) => child.attrs.name === "Set")!;
    expect(set.children.map((child) => child.attrs.modelLink)).toEqual(["Bridge00", "Bridge01", "Bridge02"]);
    const lights = root.children.find((child) => child.attrs.name === "Lights")!;
    expect(lights.children.map((child) => child.attrs.name)).toEqual(["Nova Key"]);
    const elements = [...all(set), ...all(lights)].filter((node) => node.tag === "CCutsceneElementObject");
    expect(elements.every((node) => node.attrs.duration === total && node.attrs.start === undefined)).toBe(true);
    expect([...all(set), ...all(lights)].some((node) => node.tag === "CCutsceneNodeActiveShot")).toBe(false);
    expect(all(root).some((node) => node.tag === "CCutsceneNodeActor" && node.attrs.modelLink === "NovaTerra")).toBe(false);
  });

  it("cuts from the set's own camera to four views from the middle and one from outside, under its base Light", () => {
    const cuts = all(root).filter((node) => node.tag === "CCutsceneElementActiveCamera");
    expect(cuts.map((node) => node.attrs.start)).toEqual([undefined, ...[1, 2, 3, 4, 5].map((shot) => String(LEAD_MS + shot * SHOT_MS))]);
    const cameras = root.children.find((child) => child.attrs.name === "Cameras")!.children;
    expect(cameras.map((camera) => camera.attrs.name)).toEqual([
      "Nova Wide",
      "From the middle, looking north",
      "From the middle, looking east",
      "From the middle, looking south",
      "From the middle, looking west",
      "High overview from outside",
    ]);
    expect(cuts.map((node) => node.attrs.objectGuid)).toEqual(cameras.map((camera) => camera.attrs.guid));
    expect(all(root).find((node) => node.tag === "CCutsceneElementActiveLight")!.attrs.lightID).toBe("BridgeLight");
  });

  it("announces every shot in order, and the manifest names them", () => {
    expect(sheet.shots.map((shot) => shot.stop)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sheet.shots[0]!.camera).toBe("Nova Wide");
    expect(sheet.script).toContain('Cs_Play("Cutscenes\\\\Sheet-001.SC2Cutscene", 1, 6);');
    expect(sheet.script).toContain("Cs_Announce(-1);");
    expect(sheet.script).not.toContain("Hide the debug panel");
    // Story Mode's native is for Blizzard's maps only: in ours it logs an error over the frames.
    expect(sheet.script).not.toContain("StoryMode");
  });

  it("captures an original file at its own cuts to the set's cameras, skipping fades to black and flash cuts", () => {
    // Cuts: 0 s to the set's camera (55), 4 s to a camera elsewhere (99), 8 s back to 55 for 0.5 s,
    // 8.5 s to 55 under a fade to black (out at 8.5-9 s, in at 12 s), 14 s to 55 again until 20 s.
    const xml = bridge.xml
      .replace(
        '<CCutsceneNodeActiveLight guid="2">',
        `<CCutsceneNodeActiveCamera guid="60">${[
          ["61", "0", "55"],
          ["62", "4000", "99"],
          ["63", "8000", "55"],
          ["64", "8500", "55"],
          ["65", "14000", "55"],
        ]
          .map(([guid, start, camera]) => `<CCutsceneElementActiveCamera guid="${guid}" start="${start}" objectGuid="${camera}"/>`)
          .join("")}</CCutsceneNodeActiveCamera><CCutsceneNodeFade guid="70"><CCutsceneElementFade guid="71" start="8500" duration="500"/><CCutsceneElementFade guid="72" start="12000" duration="1000" fadeIn="1"/></CCutsceneNodeFade><CCutsceneNodeActiveLight guid="2">`,
      )
      .replace('<CCutsceneElementObject guid="56" duration="10"/>', '<CCutsceneElementObject guid="56" duration="20000"/>');
    const source = { ...bridge, xml };
    const moments = originalMoments(buildSetCatalog([source])[0]!.occurrences[0]!, source);
    // The first cut to 55 is taken a beat in; the flash cut, the cut under black and camera 99 are not.
    expect(moments).toEqual([{ ms: 900, camera: "Nova Wide" }]);
    const original = buildOriginalSheet(buildSetCatalog([source]), new Map([[sourceKey(source.origin, source.path), source]]));
    expect(original.cutscenes[0]!.xml).toBe(xml);
    expect(original.script).toContain("Cs_Shot(cs, 900, 1);");
  });

  it("pauses before taking over the screen when asked, so the debug panel can be hidden by hand", () => {
    const paused = buildContactSheet(sets, new Map([[sourceKey(bridge.origin, bridge.path), bridge]]), 30).script;
    const wait = paused.indexOf("Wait(30.0, c_timeReal);");
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThan(paused.indexOf("CinematicFade(false"));
  });

  it("films a set's card pictures with free cameras, one cutscene per choice of pieces, naming each shot's card", () => {
    const sources = new Map([[sourceKey(bridge.origin, bridge.path), bridge]]);
    const cards = buildCardSheet(
      [
        { set: sets[0]!, cameras: [{ card: "card/2.jpg", eye: [0, -3, 1.5], target: [0, 0, 1.2], fov: 40 }, { card: "card/4.jpg", eye: [1, 1, 1], target: [2, 1, 1], fov: 60 }] },
        { set: sets[0]!, without: "Bridge0[12]", cameras: [{ card: "card/3.jpg", eye: [0, 0, 1.2], target: [0, 1, 1.2], fov: 60 }] },
      ],
      sources,
    );
    expect(cards.cutscenes.map((cutscene) => cutscene.file)).toEqual(["Card-001.SC2Cutscene", "Card-002.SC2Cutscene"]);
    const first = readCutscene(cards.cutscenes[0]!.xml);
    const cameras = first.children.find((child) => child.attrs.name === "Cameras")!.children;
    expect(cameras.map((camera) => camera.tag)).toEqual(["CCutsceneNodeTargetCamera", "CCutsceneNodeTargetCamera"]);
    expect(cameras[0]!.attrs).toMatchObject({
      name: "card 2",
      position: "0.000000,0.000000,1.200000",
      eyePositionX: "0.000000",
      eyePositionY: "-3.000000",
      eyePositionZ: "1.500000",
      targetPositionX: "0.000000",
      targetPositionY: "0.000000",
      targetPositionZ: "1.200000",
      fov: "40.000000",
      verticalFOV: "1",
      roll: "0.000000",
    });
    const cuts = all(first).filter((node) => node.tag === "CCutsceneElementActiveCamera");
    expect(cuts.map((node) => node.attrs.objectGuid)).toEqual(cameras.map((camera) => camera.attrs.guid));
    expect(all(first).find((node) => node.tag === "CCutsceneElementActiveLight")!.attrs.lightID).toBe("BridgeLight");
    const pieces = (xml: string) => readCutscene(xml).children.find((child) => child.attrs.name === "Set")!.children.map((child) => child.attrs.modelLink);
    expect(pieces(cards.cutscenes[0]!.xml)).toEqual(["Bridge00", "Bridge01", "Bridge02"]);
    expect(pieces(cards.cutscenes[1]!.xml)).toEqual(["Bridge00"]);
    expect(cards.shots.map(({ stop, shot, camera, card }) => ({ stop, shot, camera, card }))).toEqual([
      { stop: 1, shot: 0, camera: "card 2", card: "card/2.jpg" },
      { stop: 2, shot: 1, camera: "card 4", card: "card/4.jpg" },
      { stop: 3, shot: 2, camera: "card 3", card: "card/3.jpg" },
    ]);
    expect(cards.script).toContain('Cs_Play("Cutscenes\\\\Card-002.SC2Cutscene", 3, 1);');
  });
});

describe("sheetDependencies", () => {
  it("puts every story campaign ahead of the base map's own dependencies", () => {
    expect(sheetDependencies(["file:Mods\\Demo-Campaign.SC2Mod"])).toEqual([...SHEET_CAMPAIGNS, "file:Mods\\Demo-Campaign.SC2Mod"]);
  });

  it("doesn't list a campaign the base map already has, however it names the file", () => {
    const own = ["file:Campaigns\\VoidStory.SC2Campaign", "file:Mods\\Demo-Campaign.SC2Mod"];
    const dependencies = sheetDependencies(own);
    expect(dependencies.filter((dependency) => /voidstory/i.test(dependency))).toEqual(["file:Campaigns\\VoidStory.SC2Campaign"]);
    expect(dependencies).toHaveLength(SHEET_CAMPAIGNS.length + 1);
  });
});

describe("a card sheet entry's lighting", () => {
  const sources = new Map([[sourceKey(bridge.origin, bridge.path), bridge]]);
  const camera = { card: "card/2.jpg", eye: [0, -3, 1.5] as const, target: [0, 0, 1.2] as const, fov: 40 };
  const lit = (lighting: Partial<Parameters<typeof buildCardSheet>[0][number]>) => {
    const cutscene = readCutscene(buildCardSheet([{ set: sets[0]!, cameras: [camera], ...lighting }], sources).cutscenes[0]!.xml);
    return {
      lamps: cutscene.children.find((child) => child.attrs.name === "Lights")!.children.map((child) => child.attrs.name),
      light: all(cutscene).find((node) => node.tag === "CCutsceneElementActiveLight")?.attrs.lightID,
    };
  };

  it("is the file's first base Light with all its lamps, unless it says otherwise", () => {
    expect(lit({})).toEqual({ lamps: ["Nova Key"], light: "BridgeLight" });
    expect(lit({ light: "OtherLight", lamps: "none" })).toEqual({ lamps: [], light: "OtherLight" });
  });

  it("keeps only the lamps near a camera's aim when given a distance", () => {
    // Nova Key stands at (1, 2), about 2.2 from the aim at (0, 0).
    expect(lit({ lamps: 3 }).lamps).toEqual(["Nova Key"]);
    expect(lit({ lamps: 2 }).lamps).toEqual([]);
  });

  it("puts the entry's label ahead of its camera's name", () => {
    expect(buildCardSheet([{ set: sets[0]!, cameras: [camera], label: "no lamps", lamps: "none" }], sources).shots[0]!.camera).toBe("no lamps: card 2");
  });
});

describe("a sheet cutscene's pieces", () => {
  it("drop properties the file keys over time, so a piece it hides for a while still stands, and keep one set at the start", () => {
    const keyedSource: CutsceneSource = {
      ...bridge,
      xml: bridge.xml.replace(
        `${piece("10", "Bridge00")}`,
        `<CCutsceneNodeActor guid="10" name="Bridge00" position="0,0,5" modelLink="Bridge00"><CCutsceneElementObject guid="101" duration="900"/>` +
          `<CCutsceneNodePropertyValue guid="11" propertyName="visible"><CCutsceneElementPropertyValue guid="111" start="2655" value="0"/><CCutsceneElementPropertyValue guid="112" start="12575" value="1"/></CCutsceneNodePropertyValue>` +
          `<CCutsceneNodePropertyValue guid="12" propertyName="opacity"><CCutsceneElementPropertyValue guid="121" value="0.5"/></CCutsceneNodePropertyValue></CCutsceneNodeActor>`,
      ),
    };
    const keyedSets = buildSetCatalog([keyedSource]);
    const cutscene = readCutscene(buildContactSheet(keyedSets, new Map([[sourceKey(keyedSource.origin, keyedSource.path), keyedSource]])).cutscenes[0]!.xml);
    const dock = all(cutscene).find((node) => node.attrs.modelLink === "Bridge00")!;
    expect(dock.children.filter((child) => child.tag === "CCutsceneNodePropertyValue").map((child) => child.attrs.propertyName)).toEqual(["opacity"]);
  });
});
