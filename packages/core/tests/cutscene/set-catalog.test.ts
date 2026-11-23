import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { bundledDisplayChannels } from "../../src/catalog/display-channels.js";

import { readCutscene, vectorAttr } from "../../src/cutscene/read-cutscene.js";
import { renderSetIndex, renderSetPlanSvg } from "../../src/cutscene/render-set-plan.js";
import { buildSetCatalog, type CutsceneSource, markName, privateSets } from "../../src/cutscene/set-catalog.js";
import { CORE_SOURCE_KINDS, sourceOptions } from "../../src/cutscene/source-kinds.js";
import type { CutsceneSourceKind } from "../../src/plugins/plugin-api.js";

const actor = (name: string, model: string, position: string, rotation = "0,0,0") =>
  `<CCutsceneNodeActor guid="${name.length}${model.length}" name="${name}" position="${position}" rotation="${rotation}" modelLink="${model}"><CCutsceneNodeAnimLayer name="Animation Layer"/></CCutsceneNodeActor>`;
const folder = (name: string, ...children: string[]) => `<CCutsceneNodeFolder name="${name}">${children.join("")}</CCutsceneNodeFolder>`;
const file = (...children: string[]) => `<?xml version="1.0" encoding="utf-8"?>\n<CutsceneState cutsceneVersion="1.3">${children.join("")}</CutsceneState>`;
const source = (path: string, xml: string, origin = "studio"): CutsceneSource => ({ origin, path, xml });

/** A Campaign's source kind, as its Plugin would contribute it. */
const studio: CutsceneSourceKind = {
  id: "studio",
  label: "Studio",
  description: "the studio's repo",
  markName: (name) => name.replace(/^\([^)]*\)\s*-\s*/, "").replace(/\s*\(facing [^)]*\)$/i, ""),
};
const kinds = new Map([...CORE_SOURCE_KINDS, ["studio", studio]]);

const bridgePieces = ["Bridge00", "Bridge01", "Bridge02"].map((model) => actor(model, model, "0,0,5"));

/** A bridge and, 40 units off, an office; Raynor on the bridge, a camera on him, helpers and a glare around. */
const opening = source(
  "Maps/Test/Opening.SC2Cutscene",
  file(
    folder("Set", folder("Corvette Bridge", ...bridgePieces, actor("Glare", "SMX3_Glare_Blue", "0,0,5")), folder("Warden&apos;s Office", ...["Desk", "Lamp", "Wall"].map((m) => actor(m, m, "40,0,0")))),
    folder("Characters", actor("(Hyperion) - Jim Raynor (Facing Matt)", "JimRaynor", "1,2,5", "0,0,90"), actor("Look", "ShapeApple", "1,3,5")),
    folder("Camera", `<CCutsceneNodeCamera guid="9" name="Raynor Medium" position="1,2,5.5" distance="4" pitch="0" yaw="180" fov="17.5"/>`),
    `<CCutsceneNodeDirector name="Director"><CCutsceneNodeActiveLight name="Active Light"><CCutsceneElementActiveLight lightID="BridgeLight"/></CCutsceneNodeActiveLight></CCutsceneNodeDirector>`,
  ),
);

/** The same bridge with one more piece, plus a cantina built on the same origin. */
const conversation = source(
  "Base.SC2Data/Cutscenes/Conversation.SC2Cutscene",
  file(folder("Set", folder("Corvette Bridge", ...bridgePieces, actor("Bridge03", "Bridge03", "0,0,5")), folder("Corvette Cantina", ...["Bar", "Stool", "Taps"].map((m) => actor(m, m, "0,0,5"))))),
);

const menu = source("mods/x/MainMenuTest.SC2Cutscene", file(folder("Set", ...["Hologram", "Pedestal", "Ring"].map((m) => actor(m, m, "0,0,0")))), "blizzard");

describe("reading a cutscene", () => {
  it("builds the nested tree and decodes entities", () => {
    const root = readCutscene(opening.xml);
    expect(root.tag).toBe("CutsceneState");
    const set = root.children[0]!;
    expect(set.children.map((child) => child.attrs.name)).toEqual(["Corvette Bridge", "Warden's Office"]);
    expect(vectorAttr(set.children[0]!.children[0]!, "position")).toEqual([0, 0, 5]);
  });

  it("refuses unbalanced files", () => {
    expect(() => readCutscene("<CutsceneState><CCutsceneNodeFolder></CutsceneState>")).toThrow(/Unbalanced/);
  });

  it("cleans actor names into mark names: the source kind's conventions, then the notes after a name and a trailing number", () => {
    expect(markName("Nova 1", "NovaTerra")).toBe("Nova");
    expect(markName("Nova (Unnamed) 1", "NovaTerra")).toBe("Nova");
    expect(markName("", "SM_Zeratul")).toBe("SM_Zeratul");
    // Core strips the notes after a name for every kind, Blizzard's too, but knows no Campaign's tag.
    expect(markName("Raynor (Bridge) 2", "Raynor")).toBe("Raynor");
    expect(markName("Kerrigan (Cutscene)", "Kerrigan")).toBe("Kerrigan");
    expect(markName("(Hyperion) - Jim Raynor (Facing Matt)", "JimRaynor")).toBe("(Hyperion) - Jim Raynor");
    expect(markName("(Hyperion) - Jim Raynor (Facing Matt)", "JimRaynor", studio)).toBe("Jim Raynor");
    expect(markName("(Hyperion) - ", "JimRaynor", studio)).toBe("JimRaynor");
  });
});

describe("the set catalog", () => {
  const sets = buildSetCatalog([opening, conversation, menu], kinds);
  const byName = (name: string) => sets.find((set) => set.name === name)!;

  it("splits rooms by distance and by folder, and merges a room across files", () => {
    expect(sets.map((set) => set.name).sort()).toEqual(["Corvette Bridge", "Corvette Cantina", "MainMenuTest set", "Warden's Office"]);
    const bridge = byName("Corvette Bridge");
    expect(bridge.occurrences.map((entry) => entry.file)).toEqual([opening.path, conversation.path]);
    expect(bridge.models.map((entry) => entry.model)).toEqual(["Bridge00", "Bridge01", "Bridge02", "Bridge03"]);
  });

  it("finds marks and cameras in the room and leaves out helpers and effects", () => {
    const best = byName("Corvette Bridge").occurrences[0]!;
    expect(best.marks).toEqual([{ guid: expect.any(String), name: "Jim Raynor", model: "JimRaynor", at: [1, 2, 5], facing: 90 }]);
    expect(best.pieces.map((piece) => piece.model)).not.toContain("SMX3_Glare_Blue");
    expect(best.cameras).toHaveLength(1);
    expect(best.cameras[0]!.eye[0]).toBeCloseTo(1);
    expect(best.cameras[0]!.eye[1]).toBeCloseTo(-2);
    expect(best.cameras[0]!.eyeHeight).toBeCloseTo(5.5);
    expect(best.lights).toEqual(["BridgeLight"]);
    expect(byName("Warden's Office").occurrences[0]!.marks).toEqual([]);
  });

  it("keeps a piece's turn and scale, and a target camera's height, when the file sets them", () => {
    const turned = (model: string, extra: string) => `<CCutsceneNodeActor guid="${model}" name="${model}" position="0,0,0" ${extra} modelLink="${model}"/>`;
    const [set] = buildSetCatalog([
      source(
        "Maps/Test/Turned.SC2Cutscene",
        file(
          folder("Hall", turned("Wall", 'rotation="0,0,-150"'), turned("Pillar", 'rotation="0,0,0" scale="2,2,3"'), turned("Floor", 'rotation="0,0,0" scale="1,1,1"')),
          `<CCutsceneNodeTargetCamera guid="t" name="High" position="0,0,1" fov="30" eyePositionX="3" eyePositionY="4" eyePositionZ="9"/>`,
        ),
      ),
    ], kinds);
    const pieces = new Map(set!.occurrences[0]!.pieces.map((piece) => [piece.model, piece]));
    expect(pieces.get("Wall")!.rotation).toEqual([0, 0, -150]);
    expect(pieces.get("Pillar")!.scale).toEqual([2, 2, 3]);
    expect(pieces.get("Pillar")).not.toHaveProperty("rotation");
    expect(pieces.get("Floor")).not.toHaveProperty("scale");
    expect(set!.occurrences[0]!.cameras[0]).toMatchObject({ eye: [3, 4], eyeHeight: 9 });
  });

  it("reads an actor with no position at the origin, and marks a piece its file turns off", () => {
    const piece = (model: string, extra: string) => `<CCutsceneNodeActor guid="${model}" name="${model}" ${extra} modelLink="${model}"/>`;
    const [set] = buildSetCatalog([source("Cutscenes/Eggs.SC2Cutscene", file(folder("Set", piece("EggRoomSet", ""), piece("EggA", 'position="1,2,0"'), piece("EggB", 'position="2,2,0" visible="0"'), piece("EggC", 'position="3,2,0" enabled="0"'))))], kinds);
    expect(set!.occurrences[0]!.pieces.map((entry) => [entry.model, entry.at, entry.hidden])).toEqual([
      ["EggRoomSet", [0, 0, 0], undefined],
      ["EggA", [1, 2, 0], undefined],
      ["EggB", [2, 2, 0], true],
      ["EggC", [3, 2, 0], true],
    ]);
  });

  it("reads a piece named by its model's file, and takes no mark from a character named that way", () => {
    const filed = (name: string, position: string) => `<CCutsceneNodeActor guid="${name}" name="${name}" position="${position}" modelPath="Assets\\StoryModeSets\\Zerg\\Hive\\${name}.m3"/>`;
    const [set, ...rest] = buildSetCatalog(
      [source("Cutscenes/Hive.SC2Cutscene", file(folder("Set", filed("Hive_01", "0,0,0"), filed("Hive_02", "2,0,0"), actor("Pool", "HivePool", "1,1,0")), folder("Characters", filed("Queen", "1,0,0"), actor("Drone", "Drone", "1,2,0"))))],
      kinds,
    );
    expect(rest).toEqual([]);
    expect(set!.occurrences[0]!.pieces.map((entry) => [entry.model, entry.modelPath])).toEqual([
      ["Hive_01", "Assets\\StoryModeSets\\Zerg\\Hive\\Hive_01.m3"],
      ["Hive_02", "Assets\\StoryModeSets\\Zerg\\Hive\\Hive_02.m3"],
      ["HivePool", undefined],
    ]);
    expect(set!.occurrences[0]!.marks.map((mark) => mark.model)).toEqual(["Drone"]);
  });

  it("leaves out an actor whose model is a file on its author's own disk", () => {
    const preview = `<CCutsceneNodeActor guid="9" name="Wadjet" position="1,0,0" modelPath="C:\\Users\\someone\\AppData\\Local\\Temp\\previewTemp\\Wadjet.m3"/>`;
    const [set] = buildSetCatalog([source("Cutscenes/Hive.SC2Cutscene", file(folder("Set", actor("Pool", "HivePool", "1,1,0"), actor("Wall", "HiveWall", "2,1,0"), actor("Spire", "HiveSpire", "1,2,0"), preview)))], kinds);
    expect(set!.occurrences[0]!.pieces.map((entry) => entry.model)).toEqual(["HivePool", "HiveWall", "HiveSpire"]);
  });

  it("files front-end screens as menus, after the story sets", () => {
    expect(byName("MainMenuTest set").kind).toBe("menu");
    expect(sets.at(-1)!.kind).toBe("menu");
    expect(byName("Corvette Cantina").kind).toBe("story");
  });

  it("draws a plan and indexes every set", () => {
    const svg = renderSetPlanSvg(byName("Corvette Bridge"), kinds);
    expect(svg).toContain("<title>Corvette Bridge: cinematic set</title>");
    expect(svg).toContain(">Jim Raynor</text>");
    expect(svg).toContain(">Raynor Medium</text>");
    expect(svg).toContain(">Studio:");
    const index = renderSetIndex(sets, 3, kinds, ["studio", "blizzard"]);
    for (const set of sets) expect(index).toContain(`(plans/${set.id}.svg)`);
    expect(index).toContain("from 3 Cutscene Editor files (the studio's repo and Blizzard's game data)");
    expect(index).toContain("| [MainMenuTest set](plans/mainmenutest-set.svg) | Blizzard |");
  });

  it("keeps, for a Workspace's own catalog, only the sets with a file that isn't Blizzard's, and says so in its index", () => {
    const own = privateSets(sets);
    expect(own.length).toBeGreaterThan(0);
    expect(own.length).toBeLessThan(sets.length);
    for (const set of sets) expect(own.includes(set)).toBe(set.occurrences.some((entry) => entry.origin !== "blizzard"));
    expect(renderSetIndex(own, 3, kinds, ["studio", "blizzard"], true)).toContain("It holds only the sets with a file that isn't Blizzard's");
    expect(renderSetIndex(sets, 3, kinds)).not.toContain("It holds only");
  });

  it("uses a source kind's conventions only on its own files", () => {
    const blizzardOpening = { ...opening, origin: "blizzard" };
    const best = buildSetCatalog([blizzardOpening], kinds).find((set) => set.name === "Corvette Bridge")!.occurrences[0]!;
    expect(best.marks.map((mark) => mark.name)).toEqual(["(Hyperion) - Jim Raynor"]);
  });
});

describe("a set's screens", () => {
  /** LotV's Korhal arrival in small: the bridge's communicator, which shows channel 0, and Raynor's studio 29 cells below it. */
  const korhal = source(
    "campaigns/voidstory.sc2campaign/base.sc2data/Cutscenes/Korhal.SC2Cutscene",
    file(
      folder("SET", folder("BRIDGE", ...["SMX2_Bridge_Communicator", "Deck", "Rail"].map((m) => actor(m, m, "0,0,0")))),
      folder("RAYNOR_SCREEN", ...["SMRaynorMarine", "SMHyperionBridgeStage1Set", "SMX2_KorhalArrival_SkyShieldScreen"].map((m) => actor(m, m, "0,-2,-29.5"))),
    ),
    "blizzard",
  );
  const sets = buildSetCatalog([korhal], kinds);
  const named = (name: string) => sets.find((set) => set.name === name)!;
  const displays = { SMX2_Bridge_Communicator: { file: "c.m3", channels: [0] }, Deck: { file: "d.m3", channels: [] } };

  it("names a set's screens and their channels on its plan and in the index, and nothing for a set with none", () => {
    // The side panel wraps its lines, so read its words.
    const words = (svg: string) => [...svg.matchAll(/<text [^>]*font-size="9" fill="#333">([^<]*)<\/text>/g)].map((match) => match[1]).join(" ");
    expect(words(renderSetPlanSvg(named("BRIDGE"), kinds, displays))).toContain("Screens: SMX2_Bridge_Communicator (channel 0)");
    expect(renderSetPlanSvg(named("BRIDGE"), kinds, displays)).not.toContain("Display feeds");
    // The studio's models are known and none is a screen; with them unread, it says so.
    const studio = { ...displays, SMRaynorMarine: { file: "r.m3", channels: [] }, SMHyperionBridgeStage1Set: { file: "h.m3", channels: [] }, SMX2_KorhalArrival_SkyShieldScreen: { file: "s.m3", channels: [] } };
    expect(words(renderSetPlanSvg(named("RAYNOR_SCREEN"), kinds, studio))).not.toContain("Screens:");
    expect(words(renderSetPlanSvg(named("RAYNOR_SCREEN"), kinds, displays))).toContain("Screens: none known; not read: SMHyperionBridgeStage1Set, SMRaynorMarine, SMX2_KorhalArrival_SkyShieldScreen");
    const index = renderSetIndex(sets, 1, kinds, ["blizzard"], false, studio);
    expect(index).toContain("| Set | From | Files | Models | Marks (richest file) | Cameras | Screen channels |");
    expect(index).toMatch(/\| \[BRIDGE\]\(plans\/bridge\.svg\) \|.*\| 0 \|$/m);
    expect(index).toMatch(/\| \[RAYNOR_SCREEN\]\(plans\/raynor-screen\.svg\) \|.*\|  \|$/m);
    expect(renderSetIndex(sets, 1, kinds, ["blizzard"], false, displays)).toMatch(/\| \[RAYNOR_SCREEN\]\(plans\/raynor-screen\.svg\) \|.*\| \? \|$/m);
  });

  it("is what core's committed README says, from its catalog and display channels: run catalog-sets again after display-channels", async () => {
    const dir = fileURLToPath(new URL("../../data/cinematic-sets/", import.meta.url));
    const { files, sets: core } = JSON.parse(readFileSync(`${dir}catalog.json`, "utf8"));
    expect(renderSetIndex(core, files, CORE_SOURCE_KINDS, ["blizzard"], false, await bundledDisplayChannels())).toBe(readFileSync(`${dir}README.md`, "utf8"));
  });
});

describe("catalog source options", () => {
  it("reads each --source <kind>=<dir> in order, refusing kinds the Workspace doesn't know", () => {
    expect(sourceOptions(["--source", "studio=/a=b", "--out", "x", "--source", "blizzard=/c"], kinds)).toEqual([
      { origin: "studio", root: "/a=b" },
      { origin: "blizzard", root: "/c" },
    ]);
    expect(() => sourceOptions(["--source", "other=/a"], kinds)).toThrow("No cutscene source kind other; the Workspace knows blizzard, studio");
    expect(() => sourceOptions(["--source", "/a"], kinds)).toThrow('--source takes <kind>=<dir>, not "/a"');
  });
});
