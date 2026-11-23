// A Melee Map Blueprint compiled end to end (#213), checked against what was measured on 21
// Blizzard ladder maps and an
// Editor-saved one the Editor calls Melee.
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileMeleeMap } from "../../src/map/compile-melee-map.js";
import { readMapInfoFields } from "../../src/map/read-map-info-fields.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/melee/two-spawns.json", import.meta.url));
const VOID_MOD = "bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod";

// The Editor's stock script for a map whose only trigger is the default Melee Initialization,
// byte for byte as it saves it: CRLF line ends and "// " for the header's blank comment lines.
const STOCK_MAP_SCRIPT = `//==================================================================================================
//
// Generated Map Script
//
// Name:   Two Spawns
//
//==================================================================================================
include "TriggerLibs/NativeLib"

//--------------------------------------------------------------------------------------------------
// Library Initialization
//--------------------------------------------------------------------------------------------------
void InitLibs () {
    libNtve_InitLib();
}

//--------------------------------------------------------------------------------------------------
// Trigger Variables
//--------------------------------------------------------------------------------------------------
trigger gt_MeleeInitialization;

//--------------------------------------------------------------------------------------------------
// Trigger: Melee Initialization
//--------------------------------------------------------------------------------------------------
bool gt_MeleeInitialization_Func (bool testConds, bool runActions) {
    // Automatic Variable Declarations
    // Actions
    if (!runActions) {
        return true;
    }

    MeleeInitResources();
    MeleeInitUnits();
    MeleeInitAI();
    MeleeInitOptions();
    return true;
}

//--------------------------------------------------------------------------------------------------
void gt_MeleeInitialization_Init () {
    gt_MeleeInitialization = TriggerCreate("gt_MeleeInitialization_Func");
    TriggerAddEventMapInit(gt_MeleeInitialization);
}

//--------------------------------------------------------------------------------------------------
// Trigger Initialization
//--------------------------------------------------------------------------------------------------
void InitTriggers () {
    gt_MeleeInitialization_Init();
}

//--------------------------------------------------------------------------------------------------
// Map Initialization
//--------------------------------------------------------------------------------------------------
void InitMap () {
    InitLibs();
    InitTriggers();
}
`
  .replace(/^\/\/$/gm, "// ")
  .replaceAll("\n", "\r\n");

let outputDir: string;
let warnings: readonly string[];
const read = (file: string) => readFile(path.join(outputDir, file), "utf8");

beforeAll(async () => {
  outputDir = path.join(await mkdtemp(path.join(tmpdir(), "sc2-adjutant-melee-")), "two-spawns.SC2Map");
  ({ warnings } = await compileMeleeMap(FIXTURE, outputDir, { savedAt: new Date("2026-10-31T00:00:00Z") }));
}, 30_000);

afterAll(async () => {
  await rm(path.dirname(outputDir), { recursive: true, force: true });
});

describe("compileMeleeMap", { timeout: 30_000 }, () => {
  it("compiles the fixture without warnings", () => {
    expect(warnings).toEqual([]);
  });

  it("writes the ladder maps' MapInfo: publish mode 0, fog Dark, Melee loading screen, difficulty 0, map-image preview", async () => {
    const info = readMapInfoFields(await readFile(path.join(outputDir, "MapInfo")));
    expect(info).toMatchObject({
      version: 39,
      width: 160,
      height: 160,
      localeMode: 1,
      previewType: 1,
      difficulty: 0,
      fog: "Dark",
      loadingScreenType: 0,
      gameOptions: 0x4000,
      speedMode: 0,
      publishMode: 0,
      // 136×136 centred across, the larger margin at the top.
      bounds: [12, 8, 148, 144],
    });
  });

  it("gives MapInfo Neutral, two Users with any race and a random start, and Hostile: no Computer players", async () => {
    const info = readMapInfoFields(await readFile(path.join(outputDir, "MapInfo")));
    expect(info.players).toEqual([
      { id: 0, control: 3, team: 0, race: "", color: 0, startLocation: 0 },
      { id: 1, control: 1, team: -1, race: "", color: 0, startLocation: 0 },
      { id: 2, control: 1, team: -1, race: "", color: 0, startLocation: 0 },
      { id: 15, control: 4, team: 0, race: "", color: 0, startLocation: 0 },
    ]);
    // Two-spawn ladder maps leave the variant block's start locations empty; the StartLoc points place the players.
    expect(info.startLocationIds).toEqual([]);
  });

  it("places a StartLoc point at each start base's town-hall centre, and owns every unit by Neutral", async () => {
    const objects = await read("Objects");
    const starts = [...objects.matchAll(/<ObjectPoint [^>]*Position="([^"]+)"[^>]*Type="StartLoc"[^>]*Name="([^"]+)"/g)].map((match) => [match[1], match[2]]);
    expect(starts).toEqual([
      ["34.5,27.5,0", "Start Location 001"],
      ["125.5,124.5,0", "Start Location 002"],
    ]);
    const units = [...objects.matchAll(/<ObjectUnit [^>]*>/g)].map((match) => match[0]);
    // Three resource bases in the half and three in its rotation, and each main's unbuildable plate.
    expect(units.length).toBe(6 * 10 + 2);
    expect(units.filter((unit) => /Player="[1-9]/.test(unit))).toEqual([]);
  });

  it("writes the stock Melee Initialization trigger and MapScript.galaxy, as on ladder maps", async () => {
    const triggers = await read("Triggers");
    const defs = [...triggers.matchAll(/<FunctionDef Type="FunctionDef" Library="(\w+)" Id="(\w+)"\/>/g)].map((match) => `${match[1]}/${match[2]}`);
    // Map Initialization, then MeleeInitResources, MeleeInitUnits, MeleeInitAI and MeleeInitOptions.
    expect(defs).toEqual(["Ntve/00000120", "Ntve/00000143", "Ntve/00000145", "Ntve/00000150", "Ntve/00000148"]);
    expect([...triggers.matchAll(/<Item Type="(\w+)"/g)].map((match) => match[1])).toEqual(["Trigger"]);
    // Byte for byte as the Editor saves it: a BOM, the stock trigger id and a CRLF.
    expect(await read("enUS.SC2Data/LocalizedData/TriggerStrings.txt")).toBe("\uFEFFTrigger/Name/B1162226=Melee Initialization\r\n");
    expect(await read("MapScript.galaxy")).toBe(STOCK_MAP_SCRIPT);
  });

  it("depends on Void (Mod) alone, in DocumentInfo and DocumentHeader", async () => {
    const documentInfo = await read("DocumentInfo");
    expect([...documentInfo.matchAll(/<Value>([^<]+)<\/Value>/g)].map((match) => match[1])).toEqual(["Interface", VOID_MOD]);
    const header = await readFile(path.join(outputDir, "DocumentHeader"));
    expect(header.readUInt32LE(44)).toBe(1);
    expect(header.subarray(48, 48 + VOID_MOD.length).toString("utf8")).toBe(VOID_MOD);
    expect(header.toString("latin1")).toContain("MapInfo/Player02/Name");
  });

  it("writes no game data beyond the Light, Water, Terrain and Actor catalogs", async () => {
    const gameData = path.join(outputDir, "Base.SC2Data", "GameData");
    const catalogs = existsSync(gameData) ? await readdir(gameData) : [];
    expect(catalogs.filter((file) => !["LightData.xml", "WaterData.xml", "TerrainData.xml", "ActorData.xml"].includes(file))).toEqual([]);
  });
});
