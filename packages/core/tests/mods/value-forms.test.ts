// Value forms (#950), read and written as the Editor saves them, in a mod library and in a map's
// Kept triggers: a preset value with no value of its own (the constant the Editor generates for it,
// lib<library>_ge_<type>_<value>, a map's ge_<type>_<value>), a literal naming an element by its
// number (ValueId: a difficulty, a player color, an ability command's index, a sound's variation),
// a sound link, a colour with alpha, a Switch on a preset, and Ntve's Play Sound, which has no
// script prefix. The fixtures are cut from the game's libraries and Editor saves of maps (see the
// fixtures' README).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { definitionIn, functionGalaxy, type LibraryScope } from "../../src/mods/library-galaxy.js";
import { functionXml, libraryElements, readLibraryFunction, stringTable } from "../../src/mods/library-xml.js";
import { KeptGalaxyRenderer, textValueKeys } from "../../src/triggers/kept-trigger-galaxy.js";
import { keptElementSpan } from "../../src/triggers/splice-map-script.js";
import { CORE_PRIMITIVES } from "../../src/triggers/trigger-catalog.js";
import { readTriggersFile, triggerStringNames } from "../../src/triggers/triggers-file.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/editor-triggers/value-forms/", import.meta.url));
/** The older Editor that saved Nova writes no "// Automatic Variable Declarations" line, which the current Editor writes and so does this (#937). */
const withoutAutomaticHeader = (galaxy: string) => galaxy.replace(/^ {4}\/\/ Automatic Variable Declarations\r?\n/m, "");

/** A library of the fixture's mods: a function read from it, with its scope, and each element's text and the Galaxy as the Editor saved them. */
async function library(mod: string, id: string) {
  const dir = path.join(FIXTURE, "mods", mod);
  const xml = await readFile(path.join(dir, "Triggers"), "utf8");
  const strings = stringTable(await readFile(path.join(dir, "enus.sc2data", "localizeddata", "triggerstrings.txt"), "utf8"));
  const gameStrings = path.join(dir, "enus.sc2data", "localizeddata", "gamestrings.txt");
  const texts = existsSync(gameStrings) ? textValueKeys([await readFile(gameStrings, "utf8")]) : undefined;
  const elements = libraryElements(xml, id);
  const section = xml.slice(xml.indexOf(`<Library Id="${id}">`));
  const saved = [...section.slice(0, section.indexOf("</Library>")).matchAll(/^ {8}<Element Type="\w+" Id="[0-9A-F]{8}">\n[\s\S]*?^ {8}<\/Element>$/gm)].map((match) => match[0]);
  const editor = await readFile(path.join(dir, "base.sc2data", `Lib${id}.galaxy`), "utf8");
  const scope: LibraryScope = { library: id, functions: new Map(), elements, strings, ...(texts ? { texts } : {}) };
  const fn = (fnId: string) => {
    const read = readLibraryFunction(elements, strings, id, fnId);
    return { ...read, scope: { ...scope, functions: new Map([[fnId, read]]) } };
  };
  /** The function `fnId`'s Galaxy, as written and as the Editor saved it under `name`. */
  const galaxy = (fnId: string, name: string) => {
    const { fn: read, body, scope: own } = fn(fnId);
    return { ours: functionGalaxy(own, read, body!).definition, editor: definitionIn(editor, name) };
  };
  return { saved, fn, galaxy };
}

const VOID = "voidprologue.sc2mod";
const NOVA = "missionpacks/novacampaign.sc2mod";
const CHALLENGES = "challenges.sc2mod";

describe("a mod library's values", () => {
  it.each([
    ["Mission Status (preset values with none of their own)", VOID, "A3DDD02B", "A90BDA76"],
    ["PP_DifficultyFromIndex (difficulties by ValueId, beside a stale Value)", VOID, "A3DDD02B", "C645B4F3"],
    ["Zoom In Planet Portrait (a sound link with no ValueId)", VOID, "A3DDD02B", "C7DB17CB"],
    ["Set Hatchery Rally Point (an ability command with a ValueId)", VOID, "A3DDD02B", "4C254F3C"],
    ["Display Campaign Message (sound links with ValueIds, a Switch on a preset)", VOID, "A3DDD02B", "61D19D89"],
    ["Difficulty Setting (user type instances, a Switch on difficulties)", VOID, "A3DDD02B", "3D192DC7"],
    ["Create Drop Pod For Zerg Building (a set of bits with its preset type)", VOID, "A3DDD02B", "522AEF01"],
    ["_Zerg Drop Pod (sets of bits that name no preset type)", VOID, "A3DDD02B", "E6167EE6"],
    ["Nova's Campaign Player Color (a player color by ValueId)", NOVA, "NCMI", "2FE7927E"],
    ["Challenges' Challenge Ready Button (colours with alpha)", CHALLENGES, "Chal", "89F3EBE7"],
  ])("are read and written back as the Editor saved them: %s", async (_, mod, id, fnId) => {
    const { saved, fn } = await library(mod, id);
    const { fn: read, body } = fn(fnId);

    const xml = functionXml(id, read, body).elements;

    const at = saved.findIndex((element) => element.includes(`Type="FunctionDef" Id="${fnId}"`));
    expect(xml).toEqual(saved.slice(at, at + xml.length));
  });

  it.each([
    ["a preset value with no value of its own is the constant the Editor generates for it (Mission Status)", "A90BDA76", "libA3DDD02B_gf_MissionStatus", "return libA3DDD02B_ge_MissionStatus_Locked;"],
    ["a difficulty is its ValueId, not its Value (PP_DifficultyFromIndex)", "C645B4F3", "libA3DDD02B_gf_PP_DifficultyFromIndex", "        return 2;\n    }\n}"],
    ["a sound link with no ValueId plays any variation, and Play Sound has no script prefix (Zoom In Planet Portrait)", "C7DB17CB", "libA3DDD02B_gf_ZoomInPlanetPortrait", 'SoundPlay(SoundLink("UI_Evolutions_PlanetaryZoom", -1), PlayerGroupAll(), 100.0, 0.0);'],
    ["an ability command's ValueId is its index (Set Hatchery Rally Point)", "4C254F3C", "libA3DDD02B_gf_SetHatcheryRallyPoint", 'AbilityCommand("RallyHatchery", 1)'],
    ["a sound link's ValueId is one more than its variation, and a Switch on a preset compares its constants (Display Campaign Message)", "61D19D89", "libA3DDD02B_gf_DisplayCampaignMessage", 'SoundLink("UI_TerranMissionFailed", 1)'],
    ["a set of bits is the values set (Create Drop Pod For Zerg Building)", "522AEF01", "libA3DDD02B_gf_CreateDropPodForZergBuilding", '(1, lp_buildingType, c_unitCreateIgnorePlacement, lp_player, lp_landingPoint)'],
    ["a set of bits naming no preset type is the values set too (_Zerg Drop Pod)", "E6167EE6", "libA3DDD02B_gf__ZergDropPod", "c_unitCreateIgnorePlacement"],
    ["a user type's instance is its name, quoted (Difficulty Setting)", "3D192DC7", "libA3DDD02B_gf_DifficultySetting", 'UserDataGetFixed("DifficultySettings", "Casual", "DamageTakenRatio", 1)'],
  ])("%s, in a current Editor's save (Void Prologue)", async (_, fnId, name, shows) => {
    const { galaxy } = await library(VOID, "A3DDD02B");

    const { ours, editor } = galaxy(fnId, name);

    expect(ours).toBe(editor);
    expect(ours).toContain(shows);
  });

  it("a colour that isn't opaque is ColorWithAlpha, its alpha a percentage too (Challenges' Challenge Ready Button, an older Editor's save)", async () => {
    const { galaxy } = await library(CHALLENGES, "Chal");

    const { ours, editor } = galaxy("89F3EBE7", "libChal_gf_ChallengeReadyButton");

    expect(withoutAutomaticHeader(ours)).toBe(editor);
    expect(ours).toContain("ColorWithAlpha(16.08, 16.08, 99.61, 74.90), ColorWithAlpha(0.00, 0.00, 0.00, 0.00)");
  });

  it("a player color is its ValueId (Nova's Campaign Player Color, an older Editor's save)", async () => {
    const { galaxy } = await library(NOVA, "NCMI");

    const { ours, editor } = galaxy("2FE7927E", "libNCMI_gf_CampaignPlayerColor");

    expect(withoutAutomaticHeader(ours)).toBe(editor);
    expect(ours).toContain("int libNCMI_gf_CampaignPlayerColor () {");
    expect(ours).toContain("    return 14;\n");
  });
});

/** The Kept renderer over one of the fixture's map cuts, with its saved MapScript.galaxy. */
async function map(cut: string) {
  const file = (name: string) => readFile(path.join(FIXTURE, cut, name), "utf8");
  const renderer = new KeptGalaxyRenderer(readTriggersFile(await file("Triggers")), triggerStringNames(await file("TriggerStrings.txt")), CORE_PRIMITIVES);
  const script = await file("MapScript.galaxy");
  const saved = (name: string) => {
    const span = keptElementSpan(script, name);
    return span && script.slice(span.start, span.end).replace(/\r?\n/g, "\r\n");
  };
  return { renderer, saved };
}

describe("a Kept map element's values", () => {
  it.each([
    ["a Mission's Boss - Is Air Phase (the map's own preset values, with none of their own)", "sections", "FunctionDef", "52BEBF22", "gf_BossIsAirPhase", "(gv_bC.lv_phase == ge_BossPhase_Phase2AirOutsideCar)"],
    ["a Mission's Boss - Set Phase (a parameter of the map's own preset type)", "sections", "FunctionDef", "D1C96145", "gf_BossSetPhase", "void gf_BossSetPhase (int lp_phase) {"],
    ["a Mission's Complete Section (a Switch on the map's own preset type)", "sections", "FunctionDef", "A4BC5FD1", "gf_CompleteSection", "    else if (auto6B71695A_val == ge_Area_Power) {"],
    ["thanson01's BunkerGet (a colour that isn't opaque)", "thanson01", "FunctionDef", "AF6569B6", "gf_BunkerGet", "ColorWithAlpha(0.00, 100.00, 0.00, 0.00)"],
    ["thanson01's Chrysalis Tip Trigger A (a sound link with a ValueId, Play Sound)", "thanson01", "Trigger", "372C173B", "gt_ChrysalisTipTriggerA", '    SoundPlay(SoundLink("UI_TerranPing", 0), PlayerGroupAll(), 100.0, 0.0);'],
    ["thanson01's GenerateColonist (an actor message)", "thanson01", "FunctionDef", "0FAE268C", "gf_GenerateColonist", '"AnimBracketStart Work Stand,Work,Start Stand,Work Stand,Work,End"'],
    ["nova05's Add Infested Units To Rage Wave (a game link parameter)", "nova05", "FunctionDef", "29D60EB0", "gf_AddInfestedUnitsToRageWave", "string lp_infestedUnitType"],
    ["nova05's Create Terrazine Canister and Animate Tank (a set of bits with two set)", "nova05", "FunctionDef", "FC747036", "gf_CreateTerrazineCanisterandAnimateTank", "c_animFlagPlayForever | c_animFlagNonLooping"],
    ["thanson01's Wave Over AI Upgrades/Tips/Environment (a set of bits with one set)", "thanson01", "Trigger", "A33B2BC8", "gt_WaveOverAIUpgradesTipsEnvironment", '"Death", c_animFlagPlayForever, c_animTimeDefault);'],
  ])("render as the Editor saved them: %s", async (_, cut, type, id, name, shows) => {
    const { renderer, saved } = await map(cut);

    const text = type === "Trigger" ? renderer.renderTrigger(id) : renderer.renderFunction(id);

    expect(renderer.unknown).toEqual([]);
    expect(text).toBe(saved(name));
    expect(text).toContain(shows);
  });
});
