import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { cameraEye, importSet } from "../../src/cutscene/import-set.js";
import { type CutsceneNode, readCutscene } from "../../src/cutscene/read-cutscene.js";
import { buildSetCatalog, type CutsceneSource } from "../../src/cutscene/set-catalog.js";
import { setCutscene } from "../../src/cutscene/set-cutscene.js";
import { shotCutscene, type ShotCamera } from "../../src/cutscene/write-shot-cutscene.js";
import { SetSchema } from "../../src/domain/cinematic-set.js";

const folder = (name: string, ...children: string[]) => `<CCutsceneNodeFolder name="${name}">${children.join("")}</CCutsceneNodeFolder>`;
const file = (...children: string[]) => `<?xml version="1.0" encoding="utf-8"?>\n<CutsceneState cutsceneVersion="1.3">${children.join("")}</CutsceneState>`;
const lifetime = `<CCutsceneElementObject duration="1000"/>`;
const shotOf = (camera: string) => `<CCutsceneNodeActiveShot cameraGUID="${camera}" cameraIndex="0"/>`;

/**
 * A lab built around (40, 8.75): a console (turned, scaled, a variation, tinted and team coloured), a
 * bench (tilted, stretched), a shelf switched off, and a screen seen only from the close camera.
 */
const lab = () =>
  file(
    folder(
      "Set",
      folder(
        "Lab",
        `<CCutsceneNodeActor guid="11" name="Console (Unnamed)" position="40,8,0" rotation="0,0,90" scale="1.5,1.5,1.5" modelLink="LabConsole" variation="2" tintColorRed="0.5" tintColorGreen="0.25" tintColorBlue="1" teamColorDiffuse="1,0,0,1">${lifetime}</CCutsceneNodeActor>`,
        `<CCutsceneNodeActor guid="12" name="Bench" position="38,6,0" rotation="10,0,45" scale="1,2,1" modelLink="LabBench">${lifetime}</CCutsceneNodeActor>`,
        `<CCutsceneNodeActor guid="13" name="Shelf" enabled="0" position="42,10,0" modelLink="LabShelf">${lifetime}</CCutsceneNodeActor>`,
        `<CCutsceneNodeActor guid="14" name="Screen" position="40,11,0" modelLink="LabScreen">${lifetime}${shotOf("32")}${shotOf("36")}</CCutsceneNodeActor>`,
      ),
    ),
    folder(
      "Characters",
      // Seen only through the close camera: a file hides a character from a shot filmed from where they stand.
      `<CCutsceneNodeActor guid="21" name="Scientist (Facing Bench)" position="41,9,0" rotation="0,0,90" modelLink="Scientist">${lifetime}${shotOf("32")}</CCutsceneNodeActor>`,
      `<CCutsceneNodeActor guid="22" name="Scientist (Facing Console)" position="41,9,0" rotation="0,0,180" modelLink="Scientist">${lifetime}</CCutsceneNodeActor>`,
    ),
    folder(
      "Cameras",
      `<CCutsceneNodeCamera guid="31" name="Wide" position="40,0,6" fov="30" distance="10" pitch="20" yaw="180" heightOffset="-1" depthOfField="0.5" focalDepth="9" falloffStart="0.0003" falloffEnd="2" falloffStartNear="0.1" falloffEndNear="0" doftype="0">${lifetime}</CCutsceneNodeCamera>`,
      // Tied to an invisible rig that stands still: it films from its own position, not the rig's.
      `<CCutsceneNodeCamera guid="32" name="Close" position="41,9.5,1.5" fov="20" verticalFOV="1" distance="3" pitch="5" yaw="90">${lifetime}<CCutsceneNodeAttachment name="Attachment"><CCutsceneElementAttachment duration="1000" attachGuid="41" attachName="Ref_Hardpoint 01" offsetX="0" offsetY="0" offsetZ="-0.2"/></CCutsceneNodeAttachment></CCutsceneNodeCamera>`,
      `<CCutsceneNodeActor guid="41" name="Close Movement" position="41,9,1.5" scale="0.2,0.2,0.2" modelLink="MarineXPR" opacity="0">${lifetime}</CCutsceneNodeActor>`,
      `<CCutsceneNodeCamera guid="33" name="Push" position="40,8,2" fov="25" verticalFOV="1" distance="4" pitch="0" yaw="0">${lifetime}<CCutsceneNodePropertyValue propertyName="distance"/></CCutsceneNodeCamera>`,
      `<CCutsceneNodeCamera guid="34" name="Wide" position="40,4,2" fov="30" verticalFOV="1" distance="5" pitch="0" yaw="180">${lifetime}</CCutsceneNodeCamera>`,
      // A target camera, as Blizzard's story sets film: its eye 6 south of and 1 above its target. A key that holds one value doesn't move it.
      `<CCutsceneNodeTargetCamera guid="35" name="Aim" position="40,8,2" targetPositionX="40" targetPositionY="8" targetPositionZ="2" eyePositionX="40" eyePositionY="2" eyePositionZ="3" fov="30" verticalFOV="1" roll="5">${lifetime}<CCutsceneNodePropertyValue propertyName="fov"><CCutsceneElementPropertyCurve value="30" time="0"/><CCutsceneElementPropertyCurve value="30" time="500"/></CCutsceneNodePropertyValue></CCutsceneNodeTargetCamera>`,
      // Aimed far behind the set, as a conversation camera is: the catalog doesn't count it, but its eye is on the set.
      `<CCutsceneNodeCamera guid="36" name="Reverse" position="70,8,2" fov="25" verticalFOV="1" distance="30" pitch="0" yaw="90">${lifetime}</CCutsceneNodeCamera>`,
    ),
    folder(
      "Lights",
      `<CCutsceneNodeLight guid="51" name="Key" position="41,8,3" type="1" colorR="0.8" colorMultiplier="2" attenuationStart="3" range="6">${lifetime}${shotOf("32")}</CCutsceneNodeLight>`,
      `<CCutsceneNodeLight guid="52" name="Fill" position="39,9,4" rotation="0,-30,90" type="2" hotspot="0.5" shadowCasting="0">${lifetime}</CCutsceneNodeLight>`,
    ),
    `<CCutsceneNodeDirector name="Director"><CCutsceneNodeActiveLight name="Active Light"><CCutsceneElementActiveLight lightID="LabLight"/></CCutsceneNodeActiveLight></CCutsceneNodeDirector>`,
  );

const richest: CutsceneSource = { origin: "blizzard", path: "Scenes/Lab.SC2Cutscene", xml: lab() };
/** The same lab with no one in it and a single camera. */
const plain: CutsceneSource = {
  origin: "blizzard",
  path: "Scenes/Lab Plain.SC2Cutscene",
  xml: file(
    folder("Set", folder("Lab", ...[["LabConsole", "40,8,0"], ["LabBench", "38,6,0"], ["LabShelf", "42,10,0"]].map(([model, at], index) => `<CCutsceneNodeActor guid="6${index}" name="${model}" position="${at}" modelLink="${model}">${lifetime}</CCutsceneNodeActor>`))),
    folder("Cameras", `<CCutsceneNodeCamera guid="71" name="Overview" position="40,8,1" fov="40" verticalFOV="1" distance="12" pitch="30" yaw="45">${lifetime}</CCutsceneNodeCamera>`),
  ),
};
const sources = [richest, plain];

describe("importing a set", () => {
  const { set, slug, notes } = importSet(buildSetCatalog(sources), sources, "Lab");

  it("says nothing of a dependency for a set from a file the default Void (Mod) loads, or one outside the game's packages", () => {
    expect(notes.some((note) => note.includes("dependencies"))).toBe(false);
  });

  it("says which mod a set from a story package's cutscene needs, and the dependency to add", () => {
    const nova = { ...plain, path: "mods/novastoryassets.sc2mod/base.sc2data/Cutscenes/Lab Plain.SC2Cutscene" };
    const imported = importSet(buildSetCatalog([nova]), [nova], "Lab");
    expect(imported.notes).toContain(
      "Its models are NovaStoryAssets.SC2Mod's, from the cutscene's package: a map that plays it needs bnet:Nova Covert Ops (Art Mod)/0.0/999,file:Mods/NovaStoryAssets.SC2Mod among its dependencies, or through a mod it depends on, or the set isn't there in the game",
    );
  });

  it("takes the set from its richest occurrence, in the set's own frame, with where it came from", () => {
    expect(slug).toBe("lab");
    expect(set.name).toBe("Lab");
    // The pieces' centre, snapped to an 8-cell grid, is the set's 0,0,0.
    expect(set.provenance).toEqual({ setId: "lab", catalogName: "Lab", kind: "blizzard", file: "Scenes/Lab.SC2Cutscene", origin: [40, 8, 0] });
    expect(set.lights).toEqual(["LabLight"]);
  });

  it("keeps each piece's model and transform, its look and when it shows", () => {
    expect(set.pieces).toEqual([
      { model: "LabConsole", at: [0, 0, 0], rotation: 90, scale: 1.5, variation: 2, tint: [0.5, 0.25, 1], teamColor: { diffuse: [1, 0, 0, 1] } },
      { model: "LabBench", at: [-2, -2, 0], rotation: [10, 0, 45], scale: [1, 2, 1] },
      { model: "LabShelf", at: [2, 2, 0], hidden: true },
      { model: "LabScreen", at: [0, 3, 0], shots: ["Close", "Reverse"] },
    ]);
  });

  it("keeps the marks, named and facing, numbering a name the file uses twice, and the shots each is seen in", () => {
    expect(set.marks).toEqual([
      { name: "Scientist", model: "Scientist", at: [1, 1, 0], facing: 90, shots: ["Close"] },
      { name: "Scientist 2", model: "Scientist", at: [1, 1, 0], facing: 180 },
    ]);
    expect(notes).toEqual(expect.arrayContaining([expect.stringContaining('mark called "Scientist" twice')]));
  });

  it("keeps the named cameras as orbit values, a rigged camera at its own position, a target camera, and one aimed past the set from inside it", () => {
    expect(set.cameras).toEqual([
      { name: "Wide", target: [0, -8, 6], distance: 10, pitch: 20, yaw: 180, fov: 30, verticalFov: false, heightOffset: -1, blur: 0.5, focalDepth: 9, falloff: { far: 2, near: 0.1 } },
      { name: "Close", target: [1, 1.5, 1.5], distance: 3, pitch: 5, yaw: 90, fov: 20 },
      { name: "Push", target: [0, 0, 2], distance: 4, pitch: 0, yaw: 0, fov: 25, moves: true },
      { name: "Wide 2", target: [0, -4, 2], distance: 5, pitch: 0, yaw: 180, fov: 30 },
      { name: "Aim", target: [0, 0, 2], distance: 6.082763, pitch: 9.462322, yaw: 180, fov: 30, roll: 5 },
      { name: "Reverse", target: [30, 0, 2], distance: 30, pitch: 0, yaw: 90, fov: 25 },
    ]);
    expect(notes).toEqual(expect.arrayContaining([expect.stringContaining('"Wide" twice')]));
    expect(notes.some((note) => note.includes("Aim"))).toBe(false);
  });

  it("keeps the set's own lamps and the shots they light", () => {
    expect(set.lamps).toEqual([
      { name: "Key", type: "omni", at: [1, 0, 3], color: [0.8, 1, 1], strength: 2, attenuationStart: 3, range: 6, shots: ["Close"] },
      { name: "Fill", type: "spot", at: [-1, 1, 4], rotation: [0, -30, 90], color: [1, 1, 1], strength: 1, hotspot: 0.5, shadows: false },
    ]);
  });

  it("writes JSON the Set schema accepts, which refuses a camera or mark name used twice", () => {
    expect(SetSchema.parse(JSON.parse(JSON.stringify(set)))).toEqual(set);
    const twice = { ...set, cameras: [set.cameras[0], { ...set.cameras[1], name: "Wide" }] };
    expect(SetSchema.safeParse(twice).error?.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([["cameras.1.name", "Two cameras are called Wide"]]);
  });
});

describe("a camera written by the shot writer", () => {
  it("imports to the same orbit values", () => {
    const held: ShotCamera = { target: [62.5, 70.25, 4.1], distance: 7.5, pitch: 12.25, yaw: -135, fov: 18 };
    const blurred: ShotCamera = { target: [66, 60, 5], distance: 9, pitch: 4, yaw: 100.5, fov: 35, blur: 0.3, focalDepth: 6.5, falloff: { far: 1.5, near: 0.2 } };
    // Three backdrop pieces around (64, 64) make the set, so its frame's origin is the writer's. A shot folder (s010 …) names no set, so it takes the file's name.
    const backdrop = [["DeckPlate", [62, 62, 0]], ["DeckRail", [66, 66, 0]], ["DeckLamp", [64, 64, 0]]].map(([model, at]) => ({ model: model as string, at: at as [number, number, number] }));
    const xml = shotCutscene({ shots: [{ name: "Held", durationMs: 2000, from: held, backdrop }, { name: "Blurred", durationMs: 2000, from: blurred }] });
    const written: CutsceneSource = { origin: "blizzard", path: "Deck.SC2Cutscene", xml };
    const { set } = importSet(buildSetCatalog([written]), [written], "Deck set");
    expect(set.provenance!.origin).toEqual([64, 64, 0]);
    const inFile = (camera: ShotCamera) => ({ ...camera, target: camera.target.map((value, axis) => value - [64, 64, 0][axis]!) });
    expect(set.cameras).toEqual([
      { name: "Held", ...inFile(held) },
      { name: "Blurred", ...inFile(blurred) },
    ]);
  });
});

describe("where a rigged camera films from", () => {
  // A campaign's way: each camera tied to an invisible marine ("<camera> Movement") at Ref_Hardpoint
  // 01, with an attach offset, while the camera's own position is somewhere else. Shaped on a real
  // over-the-shoulder camera: its own position is far off the set and its rig is the wide shot's, yet
  // from its own position the eye sits just behind the engineer at shoulder height, looking past her.
  const bridge: CutsceneSource = {
    origin: "blizzard",
    path: "Bridge.SC2Cutscene",
    xml: file(
      folder("Set", ...[["DeckA", "0,0,4"], ["DeckB", "2,4,4"], ["DeckC", "-2,4,4"]].map(([model, at], index) => `<CCutsceneNodeActor guid="7${index}" name="${model}" position="${at}" modelLink="${model}">${lifetime}</CCutsceneNodeActor>`)),
      folder("Characters", `<CCutsceneNodeActor guid="81" name="Engineer" position="1.5,2.7,5" rotation="0,0,150" modelLink="Engineer">${lifetime}</CCutsceneNodeActor>`),
      `<CCutsceneNodeCamera guid="82" name="Engineer Shoulder" position="-52.774757,-3.354549,7.999849" fov="27.8" verticalFOV="1" distance="57.776077" pitch="17.529251" yaw="-83.46228" heightOffset="-19.602209">${lifetime}<CCutsceneNodeAttachment name="Attachment"><CCutsceneElementAttachment duration="1000" attachGuid="83" attachName="Ref_Hardpoint 01" offsetX="-0.5" offsetY="0" offsetZ="-0.2"/></CCutsceneNodeAttachment></CCutsceneNodeCamera>`,
      `<CCutsceneNodeActor guid="83" name="Wide Movement" position="-0.54525,14.32074,13.944016" scale="0.2,0.2,0.2" modelLink="MarineXPR" opacity="0">${lifetime}</CCutsceneNodeActor>`,
    ),
  };
  const { set } = importSet(buildSetCatalog([bridge]), [bridge], buildSetCatalog([bridge])[0]!.name);
  const camera = set.cameras.find((entry) => entry.name === "Engineer Shoulder")!;

  it("imports the camera at its own position, with its height offset as written", () => {
    expect(camera).toMatchObject({ target: [-52.774757, -3.354549, 7.999849], distance: 57.776077, pitch: 17.529251, yaw: -83.46228, heightOffset: -19.602209 });
  });

  it("puts the eye distance back from the target against the yaw, raised by the height offset and the pitch", () => {
    const eye = cameraEye(camera);
    expect(eye.map((value) => Math.round(value * 100) / 100)).toEqual([1.96, 2.92, 5.8]);
    // Half a cell behind the engineer's mark, about her shoulder's height above it.
    const mark = set.marks.find((entry) => entry.name === "Engineer")!;
    expect(Math.hypot(eye[0] - mark.at[0], eye[1] - mark.at[1])).toBeLessThan(0.6);
    expect(eye[2] - mark.at[2]).toBeCloseTo(0.8, 1);
  });
});

describe("choosing the occurrence", () => {
  it("takes the file --file names instead of the richest", () => {
    const { set } = importSet(buildSetCatalog(sources), sources, "lab", { file: "Lab Plain" });
    expect(set.provenance!.file).toBe("Scenes/Lab Plain.SC2Cutscene");
    expect(set.cameras.map((camera) => camera.name)).toEqual(["Overview"]);
    expect(set.marks).toEqual([]);
    expect(importSet(buildSetCatalog(sources), sources, "Lab", { file: "Scenes/Lab Plain.SC2Cutscene" }).set.provenance!.file).toBe("Scenes/Lab Plain.SC2Cutscene");
  });

  it("names the set's files when --file isn't one of them, and close names for a set it can't find", () => {
    expect(() => importSet(buildSetCatalog(sources), sources, "Lab", { file: "Kitchen" })).toThrow("Lab isn't in Kitchen; it is in blizzard:Scenes/Lab.SC2Cutscene; blizzard:Scenes/Lab Plain.SC2Cutscene");
    expect(() => importSet(buildSetCatalog(sources), sources, "The Lab Annex")).toThrow("No set called The Lab Annex in the catalog of these sources; did you mean Lab?");
  });
});

describe("edge cases in a source file", () => {
  const pieces = ["LabConsole", "LabBench", "LabShelf"].map((model, index) => `<CCutsceneNodeActor guid="8${index}" name="${model}" position="${index},0,0" modelLink="${model}"${index === 0 ? ' scale="-1,-1,-1"' : ""}>${lifetime}</CCutsceneNodeActor>`);
  const camera = (guid: string, name: string, at: string) => `<CCutsceneNodeCamera guid="${guid}" name="${name}" position="${at}" fov="30" verticalFOV="1" distance="2" pitch="0" yaw="0">${lifetime}</CCutsceneNodeCamera>`;
  const edge: CutsceneSource = {
    origin: "blizzard",
    path: "Edge.SC2Cutscene",
    xml: file(
      folder("Set", folder("Lab", ...pieces)),
      folder(
        "Cameras",
        camera("91", "Wide", "1,0,1"),
        camera("92", "Wide 2", "1,0,1"),
        camera("93", "Wide", "1,0,1"),
        // Made beside the lab, then tied to a rig 60 cells away that never moves: it still films here.
        `<CCutsceneNodeCamera guid="94" name="Elsewhere" position="1,1,1" fov="30" verticalFOV="1" distance="2" pitch="0" yaw="0">${lifetime}<CCutsceneNodeAttachment name="Attachment"><CCutsceneElementAttachment duration="1000" attachGuid="95"/></CCutsceneNodeAttachment></CCutsceneNodeCamera>`,
        `<CCutsceneNodeActor guid="95" name="Elsewhere Movement" position="61,1,1" modelLink="MarineXPR" opacity="0">${lifetime}</CCutsceneNodeActor>`,
        // Tied to a rig with keys: marked as moving, kept at its own position.
        `<CCutsceneNodeCamera guid="97" name="Tracking" position="1,-1,1" fov="30" verticalFOV="1" distance="2" pitch="0" yaw="0">${lifetime}<CCutsceneNodeAttachment name="Attachment"><CCutsceneElementAttachment duration="1000" attachGuid="98"/></CCutsceneNodeAttachment></CCutsceneNodeCamera>`,
        `<CCutsceneNodeActor guid="98" name="Tracking Movement" position="1,-1,1" modelLink="MarineXPR" opacity="0">${lifetime}<CCutsceneNodePropertyValue propertyName="positionX"/></CCutsceneNodeActor>`,
        // A target camera written with no target attributes: its position is its target.
        `<CCutsceneNodeTargetCamera guid="99" name="Aim" position="1,0,1" eyePositionX="1" eyePositionY="-3" eyePositionZ="2" fov="30">${lifetime}</CCutsceneNodeTargetCamera>`,
        // A target camera whose eye is keyed to dolly in: imported at its first key, not the attribute the Editor saved mid-move.
        `<CCutsceneNodeTargetCamera guid="101" name="Dolly" targetPositionX="1" targetPositionY="0" targetPositionZ="1" eyePositionX="1" eyePositionY="-2" eyePositionZ="1" fov="30" verticalFOV="1">${lifetime}<CCutsceneNodePropertyValue propertyName="eyePositionY"><CCutsceneElementPropertyCurve value="-2" time="900"/><CCutsceneElementPropertyCurve value="-4" time="100"/></CCutsceneNodePropertyValue></CCutsceneNodeTargetCamera>`,
        // Filming somewhere else in the file: not one of the set's cameras.
        `<CCutsceneNodeCamera guid="100" name="Away" position="300,300,1" fov="30" verticalFOV="1" distance="2" pitch="0" yaw="0">${lifetime}</CCutsceneNodeCamera>`,
      ),
      folder("Lights", `<CCutsceneNodeLight guid="96" name="Sun" position="1,0,5" type="3">${lifetime}</CCutsceneNodeLight>`),
      // Seen only through the camera off the set, which isn't imported.
      folder("Characters", `<CCutsceneNodeActor guid="89" name="Pilot" position="1,1,0" modelLink="Pilot">${lifetime}${shotOf("100")}</CCutsceneNodeActor>`),
    ),
  };
  const { set, notes } = importSet(buildSetCatalog([edge]), [edge], "Lab");

  it("imports a piece the file gives no position at the file's origin", () => {
    const room = `<CCutsceneNodeActor guid="70" name="Room" modelLink="LabRoom">${lifetime}</CCutsceneNodeActor>`;
    const source: CutsceneSource = { origin: "blizzard", path: "Room.SC2Cutscene", xml: file(folder("Set", folder("Lab", room, ...pieces))) };
    const imported = importSet(buildSetCatalog([source]), [source], "Lab").set;
    expect(imported.pieces.find((piece) => piece.model === "LabRoom")).toMatchObject({ at: [0, 0, 0] });
  });

  it("imports a piece named by its model's file with that file, and writes it back the same way", () => {
    const room = `<CCutsceneNodeActor guid="71" name="Room_01_ONE" position="1,1,0" modelPath="Assets\\Sets\\Lab\\Room_01.m3">${lifetime}</CCutsceneNodeActor>`;
    const source: CutsceneSource = { origin: "blizzard", path: "Room.SC2Cutscene", xml: file(folder("Set", folder("Lab", room, ...pieces))) };
    const imported = importSet(buildSetCatalog([source]), [source], "Lab").set;
    expect(imported.pieces.find((piece) => piece.model === "Room_01")).toMatchObject({ modelPath: "Assets/Sets/Lab/Room_01.m3", at: [1, 1, 0] });
    const written = setCutscene(SetSchema.parse(imported), { lengthMs: 1000, models: { anims: {}, guides: {} } });
    expect(written).toContain('modelPath="Assets\\Sets\\Lab\\Room_01.m3"');
    expect(written).not.toContain('modelLink="Room_01"');
  });

  it("keeps a mirrored piece's even negative scale", () => {
    expect(set.pieces[0]).toMatchObject({ model: "LabConsole", scale: -1 });
  });

  it("numbers a repeated name past the names the file already uses", () => {
    expect(set.cameras.map((entry) => entry.name)).toEqual(["Wide", "Wide 2", "Wide 3", "Elsewhere", "Tracking", "Aim", "Dolly"]);
  });

  it("keeps a camera tied to a rig with keys at its own position, marked as moving", () => {
    expect(set.cameras.find((entry) => entry.name === "Tracking")).toMatchObject({ target: [1, -1, 1], moves: true });
  });

  it("imports a target camera with no target attributes at its position, and a moving one at its first frame, marked as moving", () => {
    expect(set.cameras.find((entry) => entry.name === "Aim")).toEqual({ name: "Aim", target: [1, 0, 1], distance: 3.162278, pitch: 18.434949, yaw: 180, fov: 30, verticalFov: false });
    expect(set.cameras.find((entry) => entry.name === "Dolly")).toEqual({ name: "Dolly", target: [1, 0, 1], distance: 4, pitch: 0, yaw: 180, fov: 30, moves: true });
    expect(notes).toEqual(expect.arrayContaining(["Target camera Dolly moves (a keyed target, eye, lens or roll): imported at the first frame, marked moves"]));
  });

  it("gives a mark seen only through cameras it doesn't import no shots of the set's", () => {
    expect(set.marks).toEqual([{ name: "Pilot", model: "Pilot", at: [1, 1, 0], facing: 0, shots: [] }]);
  });

  it("keeps a camera tied to a still rig elsewhere, and leaves out a light it can't type", () => {
    expect(set.cameras.find((entry) => entry.name === "Elsewhere")).toMatchObject({ target: [1, 1, 1] });
    expect(set.lamps).toEqual([]);
    expect(notes).toEqual(expect.arrayContaining([expect.stringContaining("Left out lamp Sun: light type 3")]));
  });
});

describe("a piece's animation and a camera's shadow distance", () => {
  const anim = (attrs: string) => `<CCutsceneNodeAnimLayer name="Animation Layer"><CCutsceneElementAnim duration="1000" ${attrs} priority="3" looping="1"/></CCutsceneNodeAnimLayer>`;
  const piece = (guid: string, model: string, at: string, animated = "") => `<CCutsceneNodeActor guid="${guid}" name="${model}" position="${at}" modelLink="${model}">${lifetime}${animated}</CCutsceneNodeActor>`;
  const orbit = (guid: string, name: string, extra: string) => `<CCutsceneNodeCamera guid="${guid}" name="${name}" position="1,0,1" fov="30" verticalFOV="1" distance="2" pitch="0" yaw="0" ${extra}>${lifetime}</CCutsceneNodeCamera>`;
  const orrery: CutsceneSource = {
    origin: "blizzard",
    path: "Orrery.SC2Cutscene",
    xml: file(
      folder(
        "Set",
        folder(
          "Orrery",
          piece("101", "Planet", "0,0,0", anim(`anim="Stand Work" originalDuration="3000" timeScale="0.5"`)),
          piece("102", "Pedestal", "1,0,0", anim(`anim="Stand"`)),
          piece("103", "Moon", "2,0,0", anim(`anim="Birth" timeScale="1.000000"`)),
          piece("104", "Plinth", "1,1,0"),
          // A one-shot Birth, then the loop it settles into.
          piece("105", "Hatch", "2,1,0", `<CCutsceneNodeAnimLayer name="Animation Layer"><CCutsceneElementAnim duration="500" anim="Birth" priority="3"/><CCutsceneElementAnim start="500" duration="500" anim="Stand Open" priority="3" looping="1" lockedToEnd="1"/></CCutsceneNodeAnimLayer>`),
          // A switched-off layer, and a face layer before the body's.
          piece("106", "Beacon", "0,1,0", `<CCutsceneNodeAnimLayer name="Old" enabled="0"><CCutsceneElementAnim duration="1000" anim="Walk" looping="1"/></CCutsceneNodeAnimLayer><CCutsceneNodeAnimLayer name="Face"><CCutsceneElementAnim duration="1000" anim="Eye Blink" looping="1"/></CCutsceneNodeAnimLayer>${anim(`anim="Stand Work"`)}`),
          // Only a one-shot: no loop to keep.
          piece("107", "Crate", "0,2,0", `<CCutsceneNodeAnimLayer name="Animation Layer"><CCutsceneElementAnim duration="1000" anim="Death" priority="3"/></CCutsceneNodeAnimLayer>`),
          // Frozen: a speed of 0, which a set piece can't hold.
          piece("108", "Statue", "1,2,0", anim(`anim="Stand" timeScale="0.000000"`)),
        ),
      ),
      folder("Cameras", orbit("111", "Near", `shadowClip="20.000000"`), orbit("112", "Usual", `shadowClip="75.000000"`), orbit("113", "Bare", ""), orbit("114", "Nearly", `shadowClip="74.999992"`)),
    ),
  };
  const { set, notes } = importSet(buildSetCatalog([orrery]), [orrery], "Orrery");

  it("keeps the loop a piece plays on its body layer and its speed, leaving out a bare Stand, a speed of 1 and a one-shot", () => {
    expect(set.pieces).toEqual([
      { model: "Planet", at: [0, 0, 0], anim: "Stand Work", animSpeed: 0.5 },
      { model: "Pedestal", at: [1, 0, 0] },
      { model: "Moon", at: [2, 0, 0], anim: "Birth" },
      { model: "Plinth", at: [1, 1, 0] },
      { model: "Hatch", at: [2, 1, 0], anim: "Stand Open" },
      { model: "Beacon", at: [0, 1, 0], anim: "Stand Work" },
      { model: "Crate", at: [0, 2, 0] },
      { model: "Statue", at: [1, 2, 0] },
    ]);
    expect(notes).toEqual(
      expect.arrayContaining([
        "Crate plays only Death once, which a set piece can't: it plays its Stand",
        "Statue's anim plays at speed 0, frozen, which a set piece can't: it plays at its own speed",
      ]),
    );
  });

  it("keeps a camera's shadowClip as its shadow distance, leaving out Blizzard's usual 75", () => {
    expect(set.cameras.map(({ name, shadowDistance }) => ({ name, shadowDistance }))).toEqual([
      { name: "Near", shadowDistance: 20 },
      { name: "Usual", shadowDistance: undefined },
      { name: "Bare", shadowDistance: undefined },
      { name: "Nearly", shadowDistance: undefined },
    ]);
    expect(set.cameras.filter((camera) => "shadowDistance" in camera).map((camera) => camera.name)).toEqual(["Near"]);
  });
});

describe("a set written by the shot writer", () => {
  it("imports its pieces' anims and speeds, and its cameras' shadow distances, as they were written", () => {
    const standing = [
      { model: "Planet", at: [62, 62, 0] as const, anim: "Stand Work", animSpeed: 0.5 },
      { model: "Moon", at: [66, 66, 0] as const, anim: { name: "Birth", durationMs: 1500 } },
      { model: "Pedestal", at: [64, 64, 0] as const, animSpeed: 2 },
      { model: "Plinth", at: [64, 62, 0] as const },
    ];
    const near: ShotCamera = { target: [64, 64, 2], distance: 5, pitch: 10, yaw: 0, fov: 30, shadowDistance: 20 };
    const usual: ShotCamera = { target: [64, 66, 2], distance: 5, pitch: 10, yaw: 90, fov: 30 };
    const xml = shotCutscene({ shots: [{ name: "Near", durationMs: 2000, from: near }, { name: "Usual", durationMs: 2000, from: usual }], standing });
    const written: CutsceneSource = { origin: "blizzard", path: "Orrery.SC2Cutscene", xml };
    const { set } = importSet(buildSetCatalog([written]), [written], "Orrery set");
    expect(set.pieces.map(({ model, anim, animSpeed }) => ({ model, anim, animSpeed }))).toEqual([
      { model: "Planet", anim: "Stand Work", animSpeed: 0.5 },
      { model: "Moon", anim: "Birth", animSpeed: undefined },
      { model: "Pedestal", anim: undefined, animSpeed: 2 },
      { model: "Plinth", anim: undefined, animSpeed: undefined },
    ]);
    expect(set.cameras.map(({ name, shadowDistance }) => ({ name, shadowDistance }))).toEqual([
      { name: "Near", shadowDistance: 20 },
      { name: "Usual", shadowDistance: undefined },
    ]);
  });
});

describe("importing a set's ambience, look-ats and attached lamps", () => {
  // A bridge, 2 s long: a captain who turns to the pilot, a fill riding the captain's overhead and a
  // spot tied to a console. It plays a hum all through, at half volume; a beep loops for its second
  // half; a briefing plays once; and a switched-off drone loops all through.
  const whole = `<CCutsceneElementObject duration="2000" lockedToEnd="1"/>`;
  const bridge: CutsceneSource = {
    origin: "blizzard",
    path: "Scenes/Bridge.SC2Cutscene",
    xml: file(
      folder(
        "Set",
        folder(
          "Bridge",
          `<CCutsceneNodeActor guid="11" name="Helm" position="8,8,0" modelLink="BridgeHelm">${whole}</CCutsceneNodeActor>`,
          `<CCutsceneNodeActor guid="12" name="Chair" position="10,8,0" modelLink="BridgeChair">${whole}</CCutsceneNodeActor>`,
          `<CCutsceneNodeActor guid="13" name="Screen" position="9,10,0" modelLink="BridgeScreen">${whole}</CCutsceneNodeActor>`,
        ),
      ),
      folder(
        "Characters",
        `<CCutsceneNodeActor guid="21" name="Captain (Unnamed)" position="9,7,0" rotation="0,0,90" modelLink="Captain">${whole}<CCutsceneNodeLookAt guid="61" name="Look At"><CCutsceneElementLookAt guid="62" start="197" duration="1000" lookAtGUID="22" lookAtType="SlowHeadOnly" lookAtAttachId="Head"/><CCutsceneElementLookAt guid="63" start="1197" duration="803" lockedToEnd="1" lookAtGUID="13" lookAtType="InstantHeadOnly" lookAtAttachId="Center"/></CCutsceneNodeLookAt></CCutsceneNodeActor>`,
        `<CCutsceneNodeActor guid="22" name="Pilot" position="10,9,0" modelLink="Pilot">${whole}<CCutsceneNodeLookAt guid="64" name="Look At" enabled="0"><CCutsceneElementLookAt guid="65" duration="2000" lookAtGUID="21" lookAtType="SlowHeadOnly" lookAtAttachId="Head"/></CCutsceneNodeLookAt></CCutsceneNodeActor>`,
      ),
      folder("Cameras", `<CCutsceneNodeCamera guid="31" name="Wide" position="9,8,1" fov="30" verticalFOV="1" distance="6" pitch="10" yaw="180">${whole}</CCutsceneNodeCamera>`),
      folder(
        "Lights",
        `<CCutsceneNodeLight guid="51" name="Captain Fill" position="9,7,2" type="2" range="1.5">${whole}<CCutsceneNodeAttachment guid="52" name="Attachment"><CCutsceneElementAttachment guid="53" duration="2000" lockedToEnd="1" attachGuid="21" attachName="Ref_Overhead" offsetX="0.200000" offsetY="-0.300000" offsetZ="-0.100000" rotationX="55.000000" rotationY="10.000000" rotationZ="0.000000"/></CCutsceneNodeAttachment></CCutsceneNodeLight>`,
        `<CCutsceneNodeLight guid="54" name="Helm Spot" position="8,8,2" type="1">${whole}<CCutsceneNodeAttachment guid="55" name="Attachment"><CCutsceneElementAttachment guid="56" duration="2000" attachGuid="11" attachName="Ref_Center" offsetX="0" offsetY="0" offsetZ="0" rotationX="0" rotationY="0" rotationZ="0"/></CCutsceneNodeAttachment></CCutsceneNodeLight>`,
      ),
      folder(
        "Sound",
        `<CCutsceneNodeSound guid="41" name="Hum" soundLink="BridgeHum" volumeScale="0.500000" mode="4294967295" assetDuration="60000">${whole}</CCutsceneNodeSound>`,
        `<CCutsceneNodeSound guid="42" name="Beep" soundLink="BridgeBeep" mode="4294967295" assetDuration="500"><CCutsceneElementObject start="1000" duration="1000" lockedToEnd="1"/></CCutsceneNodeSound>`,
        `<CCutsceneNodeSound guid="43" name="Briefing" soundLink="Music_Briefing" assetDuration="10531">${whole}</CCutsceneNodeSound>`,
        `<CCutsceneNodeSound guid="44" name="Drone" soundLink="BridgeDrone" mode="4294967295" enabled="0">${whole}</CCutsceneNodeSound>`,
      ),
      `<CCutsceneNodeDirector name="Director"><CCutsceneNodeActiveLight name="Active Light"><CCutsceneElementActiveLight lightID="BridgeLight"/></CCutsceneNodeActiveLight></CCutsceneNodeDirector>`,
    ),
  };
  const { set, notes } = importSet(buildSetCatalog([bridge]), [bridge], "Bridge");

  it("keeps a sound that loops all through the file as the set's ambience, at its volume, and names the cues it leaves for a Cinematic's sounds", () => {
    expect(set.sounds).toEqual([{ sound: "BridgeHum", volume: 0.5 }]);
    expect(notes).toEqual(
      expect.arrayContaining([
        "Left out sound BridgeBeep: it doesn't loop all through the file, so it's a cue for a Cinematic's sounds",
        "Left out sound Music_Briefing: it doesn't loop all through the file, so it's a cue for a Cinematic's sounds",
      ]),
    );
    expect(notes.join("\n")).not.toContain("BridgeDrone");
  });

  it("keeps a character's look-at at another mark's, from the first, and names what it leaves out", () => {
    expect(set.marks).toEqual([
      { name: "Captain", model: "Captain", at: [1, -1, 0], facing: 90, lookAt: { mark: "Pilot", type: "SlowHeadOnly", point: "Head" } },
      { name: "Pilot", model: "Pilot", at: [2, 1, 0], facing: 0 },
    ]);
    expect(notes).toEqual(expect.arrayContaining(["Left out the Captain's later look-at, at BridgeScreen: a set's mark looks at one other mark all through"]));
  });

  it("keeps a lamp attached to a character as attached to its mark, and stands one attached to anything else where it is", () => {
    expect(set.lamps).toEqual([
      { name: "Captain Fill", type: "spot", at: [1, -1, 2], color: [1, 1, 1], strength: 1, range: 1.5, attach: { mark: "Captain", point: "Ref_Overhead", offset: [0.2, -0.3, -0.1], rotation: [55, 10, 0] } },
      { name: "Helm Spot", type: "omni", at: [0, 0, 2], color: [1, 1, 1], strength: 1 },
    ]);
    expect(notes).toEqual(expect.arrayContaining(["Lamp Helm Spot is attached to BridgeHelm, which isn't a mark: it stands where it is"]));
  });

  it("stands a lamp attached at no attach point where it is, and says so", () => {
    const pointless = { ...bridge, xml: bridge.xml.replace(' attachName="Ref_Overhead"', "") };
    const imported = importSet(buildSetCatalog([pointless]), [pointless], "Bridge");
    expect(imported.set.lamps[0]).not.toHaveProperty("attach");
    expect(imported.notes).toEqual(expect.arrayContaining(["Lamp Captain Fill is attached to Captain at no attach point: it stands where it is"]));
  });
});

// Blizzard's cutscene files are not in the repo: point this at the sc2-game-data mirror's folder
// (the one holding mods/, at the commit data/cinematic-sets was built from) to import a story set.
const GAME_DATA = process.env.SC2_CUTSCENE_SOURCES;
const NOVA_BRIDGE = "mods/novastoryassets.sc2mod/base.sc2data/Cutscenes/SMX3_Cutscene_MP03_030.SC2Cutscene";
describe.skipIf(!GAME_DATA || !existsSync(path.join(GAME_DATA, NOVA_BRIDGE)))("a story set filmed through target cameras (SC2_CUTSCENE_SOURCES)", () => {
  // Read when it runs: a skipped describe's body still runs.
  let source: CutsceneSource;
  let set: ReturnType<typeof importSet>["set"];
  let notes: readonly string[];
  beforeAll(() => {
    source = { origin: "blizzard", path: NOVA_BRIDGE, xml: readFileSync(path.join(GAME_DATA!, NOVA_BRIDGE), "utf8") };
    ({ set, notes } = importSet(buildSetCatalog([source]), [source], "Nova Bridge"));
  });

  it("imports Nova Bridge with all 22 of its pieces and its cameras", () => {
    expect(set.pieces).toHaveLength(22);
    expect(set.cameras.length).toBeGreaterThanOrEqual(23);
    expect(notes.filter((note) => /Left out \d+ piece|only orbit cameras/.test(note))).toEqual([]);
  });

  it("gives each still target camera the file's eye and target back through cameraEye", () => {
    const all: CutsceneNode[] = [];
    const walk = (node: CutsceneNode): void => {
      if (node.tag === "CCutsceneNodeTargetCamera") all.push(node);
      node.children.forEach(walk);
    };
    walk(readCutscene(source.xml));
    const once = all.filter((node) => all.filter((other) => other.attrs.name === node.attrs.name).length === 1);
    const checked = once.flatMap((node) => {
      const camera = set.cameras.find((entry) => entry.name === node.attrs.name);
      return camera && !camera.moves ? [[node, camera] as const] : [];
    });
    expect(checked.length).toBeGreaterThan(0);
    const origin = set.provenance!.origin;
    for (const [node, camera] of checked) {
      const file = (prefix: string) => ["X", "Y", "Z"].map((axis, index) => Number(node.attrs[`${prefix}${axis}`]) - origin[index]!);
      const close = (actual: readonly number[], expected: readonly number[]) => actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 4));
      close(camera.target, file("targetPosition"));
      close(cameraEye(camera), file("eyePosition"));
    }
  });
});
