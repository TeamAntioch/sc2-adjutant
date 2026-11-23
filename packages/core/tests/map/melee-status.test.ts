// A melee Map Package against the Editor's melee checklist and TLMC's forbidden features (#216;
// melee research §4 and §1a): a compiled map passes, and each reason the Editor gives is found
// on a package with that one thing changed.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileMeleeMap } from "../../src/map/compile-melee-map.js";
import { forbiddenFeatures, type MeleePackage, meleeStatusReasons, readMeleePackage } from "../../src/map/melee-status.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/melee/two-spawns.json", import.meta.url));

let outputDir: string;
let compiled: MeleePackage;

beforeAll(async () => {
  outputDir = path.join(await mkdtemp(path.join(tmpdir(), "sc2-adjutant-melee-status-")), "two-spawns.SC2Map");
  await compileMeleeMap(FIXTURE, outputDir, { savedAt: new Date("2026-10-31T00:00:00Z") });
  compiled = await readMeleePackage(outputDir);
}, 30_000);

afterAll(async () => {
  await rm(path.dirname(outputDir), { recursive: true, force: true });
});

const withInfo = (change: Partial<MeleePackage["mapInfo"]>): MeleePackage => ({ ...compiled, mapInfo: { ...compiled.mapInfo, ...change } });

describe("meleeStatusReasons", { timeout: 30_000 }, () => {
  it("finds no reason on a compiled melee map", () => {
    expect(meleeStatusReasons(compiled)).toEqual([]);
  });

  it.each<[string, () => MeleePackage, string]>([
    ["a second dependency", () => ({ ...compiled, dependencies: { ...compiled.dependencies, header: [...compiled.dependencies.header, "bnet:Liberty Campaign (Mod)/0.0/999,file:Campaigns/Liberty.SC2Campaign"] } }), "Custom dependencies (see File > Dependencies)"],
    ["game attributes", () => ({ ...compiled, attributes: true }), "Custom attributes (see Map > Game Attributes)"],
    ["a UnitData catalog", () => ({ ...compiled, gameData: [...compiled.gameData, "UnitData.xml"] }), "Custom 'UnitData' game data (UnitData.xml)"],
    ["publish mode 1", () => withInfo({ publishMode: 1 }), "Additional expansion data is not allowed, or an Arcade map (see Map > Map Options): publish mode 1"],
    ["a custom minimap preview", () => withInfo({ previewType: 0 }), "Minimap Preview is not set to Map Image"],
    ["a shown difficulty", () => withInfo({ difficulty: 2 }), "Show User Difficulty is not set to None"],
    ["black-mask fog", () => withInfo({ fog: "Black" }), "Unexplored Areas is not set to Grey Mask (fog Black)"],
    ["replays off", () => withInfo({ gameOptions: 0x4001 }), "Disable Replay Recording is set"],
    ["horizontal field of view", () => withInfo({ gameOptions: 0x4010 }), "Use Horizontal Field Of View is set"],
    ["a custom loading screen", () => withInfo({ loadingScreenType: 1 }), "Custom loading screen"],
    ["a Computer player", () => withInfo({ players: compiled.mapInfo.players.map((player) => (player.id === 2 ? { ...player, control: 2 } : player)) }), "Player 2 is set to 'Computer' control"],
    ["a set race", () => withInfo({ players: compiled.mapInfo.players.map((player) => (player.id === 1 ? { ...player, race: "Terr" } : player)) }), "Player 1 race is not set to Any (Terr)"],
    ["a fixed start", () => withInfo({ players: compiled.mapInfo.players.map((player) => (player.id === 1 ? { ...player, startLocation: 1 } : player)) }), "Player 1 start location is not set to Random"],
    ["a unit owned by Player 1", () => ({ ...compiled, objects: compiled.objects.replace('UnitType="MineralField"/>', 'UnitType="MineralField" Player="1"/>') }), "Player 1 has pre-placed units, but is not Neutral"],
    ["one start location", () => ({ ...compiled, objects: compiled.objects.replace(/<ObjectPoint [^>]*Name="Start Location 002"[^>]*\/>/, "") }), "Not enough Start Locations for all non-neutral players (Players: 2, Locations: 1)"],
    ["no triggers", () => ({ ...compiled, triggers: undefined }), "No triggers exist"],
    ["a trigger library", () => ({ ...compiled, triggers: compiled.triggers!.replace("<Root>", '<Library Id="ABCD"/><Root>') }), "Custom trigger libraries exist"],
    ["a trigger variable", () => ({ ...compiled, triggers: compiled.triggers!.replace("</TriggerData>", '<Element Type="Variable" Id="11112222"/></TriggerData>') }), "Custom trigger elements exist"],
    [
      "a second trigger",
      () => ({ ...compiled, triggers: compiled.triggers!.replace("</TriggerData>", '<Element Type="Trigger" Id="11112222">\n</Element></TriggerData>') }),
      "Custom triggers exist",
    ],
    ["MeleeInitAI dropped", () => ({ ...compiled, triggers: compiled.triggers!.replace(/ *<Action Type="FunctionCall" Id="81663ED0"\/>\r?\n/, "") }), "Trigger does not match default melee trigger (use Data > Reset All Data to reset)"],
  ])("gives the Editor's reason for %s", (_name, doctored, reason) => {
    expect(meleeStatusReasons(doctored())).toEqual([reason]);
  });
});

describe("forbiddenFeatures", { timeout: 30_000 }, () => {
  it("finds none on a compiled melee map", () => {
    expect(forbiddenFeatures(compiled.objects)).toEqual([]);
  });

  it.each([
    ['<ObjectUnit Id="7" Position="40,50,0" Rotation="0" Scale="1,1,1" UnitType="ForceField"/>', { rule: "forbidden-feature", object: "ForceField (object 7 at 40, 50)", message: "a neutral force field" }],
    [
      '<ObjectUnit Id="8" Position="41,50,0" Rotation="0" Scale="1,1,1" UnitType="Pylon"/>',
      { rule: "forbidden-feature", object: "Pylon (object 8 at 41, 50)", message: "not a ladder neutral feature: a core-race unit or building as a map object" },
    ],
    ['<ObjectDoodad Id="9" Position="42,50,0" Rotation="0" Scale="1,1,1" Type="AirSightBlocker"/>', { rule: "forbidden-feature", object: "AirSightBlocker (doodad 9 at 42, 50)", message: "an air sight or air space blocker" }],
  ] as const)("names %s", (object, finding) => {
    expect(forbiddenFeatures(compiled.objects.replace("</PlacedObjects>", `${object}\n</PlacedObjects>`))).toEqual([finding]);
  });

  it("allows every neutral the 21 ladder maps place: rocks, towers, plates, resources and their tileset skins, mineral walls, critters", () => {
    const ladder = [
      "DestructibleRockEx16x6",
      "DestructibleDebris6x6",
      "Debris2x2NonConjoined",
      "XelNagaTower",
      "UnbuildableBricksDestructible",
      "RichMineralField750",
      "RichVespeneGeyser",
      "InhibitorZoneSmall",
      "LabMineralField",
      "PurifierRichMineralField750",
      "MineralField450",
      "SpacePlatformGeyser",
      "ShakurasVespeneGeyser",
      "LabBot",
      "CleaningBot",
      "UtilityBot",
      "Scantipede",
    ]
      .map((type, index) => `<ObjectUnit Id="${index}" Position="40,50,0" Rotation="0" Scale="1,1,1" UnitType="${type}"/>`)
      .join("\n");
    expect(forbiddenFeatures(`<PlacedObjects>\n${ladder}\n</PlacedObjects>`)).toEqual([]);
  });
});
