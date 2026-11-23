// Function and trigger flags (#947), read and written as the Editor saves them. In a mod library:
// FlagAllowBreak, a block whose slots may stop its loop (a Stop Looping in it is `break;`, and
// outside any loop nothing); Section, which changes no Galaxy; Deprecated, whose statements are
// headed "// Deprecated" in place of "// Implementation". In a map's Kept triggers: a function's
// Label (no Galaxy), a value's or a condition's return type (FlagCall, FlagCondition), a function
// that runs in its own thread (FlagCreateThread), and a disabled trigger, which has no section.
// The fixtures are cut from the game's Nova Covert Ops and Void Prologue libraries, Liberty's
// thanson01 and two current Editor's Mission saves (see the fixtures' README).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { GuiCall, GuiStatement } from "../../src/domain/library-interface.js";
import { callGalaxy, definitionIn, functionGalaxy, type LibraryScope, libraryTemplateScope } from "../../src/mods/library-galaxy.js";
import { functionXml, libraryElements, readLibraryFunction, stringTable } from "../../src/mods/library-xml.js";
import { KeptGalaxyRenderer } from "../../src/triggers/kept-trigger-galaxy.js";
import { keptElementSpan } from "../../src/triggers/splice-map-script.js";
import { CORE_PRIMITIVES } from "../../src/triggers/trigger-catalog.js";
import { readTriggersFile, triggerStringNames } from "../../src/triggers/triggers-file.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/editor-triggers/function-flags/", import.meta.url));
/** The older Editor that saved Nova writes no "// Automatic Variable Declarations" line, which the current Editor writes and so does this (#937). */
const withoutAutomaticHeader = (galaxy: string) => galaxy.replace(/^ {4}\/\/ Automatic Variable Declarations\r?\n/m, "");

/** A library of the fixture's mods: a function read from it, with its scope, and each element's text and the Galaxy as the Editor saved them. */
async function library(mod: string, id: string) {
  const dir = path.join(FIXTURE, "mods", mod);
  const xml = await readFile(path.join(dir, "Triggers"), "utf8");
  const strings = stringTable(await readFile(path.join(dir, "enus.sc2data", "localizeddata", "triggerstrings.txt"), "utf8"));
  const elements = libraryElements(xml, id);
  const section = xml.slice(xml.indexOf(`<Library Id="${id}">`));
  const saved = [...section.slice(0, section.indexOf("</Library>")).matchAll(/^ {8}<Element Type="\w+" Id="[0-9A-F]{8}">\n[\s\S]*?^ {8}<\/Element>$/gm)].map((match) => match[0]);
  const editor = await readFile(path.join(dir, "base.sc2data", `Lib${id}.galaxy`), "utf8");
  const scope: LibraryScope = { library: id, functions: new Map(), elements, strings };
  const fn = (fnId: string) => {
    const read = readLibraryFunction(elements, strings, id, fnId);
    return { ...read, scope: { ...scope, functions: new Map([[fnId, read]]) } };
  };
  return { saved, editor, fn };
}

const NOVA = "missionpacks/novacampaign.sc2mod";
const FOR_EACH_ARMY_TECH_ITEM = "0E4867F4";
const MISSION_REWARDS_BONUS = "FEC39B0D";

/** The call `id` in `statements`, at any depth. */
function callOf(statements: readonly GuiStatement[], id: string): GuiCall | undefined {
  for (const statement of statements) {
    if ("comment" in statement) continue;
    if (statement.id === id) return statement;
    const inner = callOf(statement.body ?? [], id);
    if (inner) return inner;
  }
  return undefined;
}

describe("a mod library function's flags", () => {
  it.each([
    ["NC_ForEachArmyTechItem (FlagAllowBreak, a block of its own)", NOVA, "NovC", FOR_EACH_ARMY_TECH_ITEM],
    ["NC_MissionRewardsBonusPossible (Stop Looping in NC_ForEachArmyTechItem)", NOVA, "NovC", MISSION_REWARDS_BONUS],
    ["Award Achievement (Campaign) (Deprecated, in its own thread)", NOVA, "NovC", "3334E9C7"],
    ["Clear Animation (with blend time) (Section and Deprecated)", NOVA, "NovC", "8089D86E"],
    ["Start Campaign AI For All Players (Void) (Deprecated)", NOVA, "NCMI", "EE10637B"],
    ["Void Prologue's Clear Animation (with blend time) (Section)", "voidprologue.sc2mod", "A3DDD02B", "5010B489"],
  ])("are read and written back as the Editor saved them: %s", async (_, mod, id, fnId) => {
    const { saved, fn } = await library(mod, id);
    const { fn: read, body } = fn(fnId);

    const xml = functionXml(id, read, body).elements;

    const at = saved.findIndex((element) => element.includes(`Type="FunctionDef" Id="${fnId}"`));
    expect(xml).toEqual(saved.slice(at, at + xml.length));
  });

  it("are read as the interface names them", async () => {
    const nova = await library(NOVA, "NovC");
    const voidPrologue = await library("voidprologue.sc2mod", "A3DDD02B");

    expect(nova.fn(FOR_EACH_ARMY_TECH_ITEM).fn.flags).toEqual(["subFunctions", "allowBreak"]);
    expect(nova.fn("8089D86E").fn).toMatchObject({ section: "Shared", deprecated: true });
    expect(nova.fn("3334E9C7").fn).toMatchObject({ deprecated: true, flags: ["createThread"] });
    expect(voidPrologue.fn("5010B489").fn.section).toBe("Shared");
    expect(voidPrologue.fn("5010B489").fn.deprecated).toBeUndefined();
  });

  it("Section changes no Galaxy (Void Prologue's Clear Animation (with blend time), a current Editor's save)", async () => {
    const { editor, fn } = await library("voidprologue.sc2mod", "A3DDD02B");
    const { fn: read, body, scope } = fn("5010B489");

    expect(functionGalaxy(scope, read, body!).definition).toBe(definitionIn(editor, "libA3DDD02B_gf_ClearAnimationwithblendtime"));
  });

  it.each([
    ["Start Campaign AI For All Players (Void)", "EE10637B", "libNCMI_gf_StartCampaignAIForAllPlayersVoid"],
    ["Start AI Personalities For All Players (Campaign), with a local", "040E5D6E", "libNCMI_gf_StartAIPersonalitiesForAllPlayersCampaign"],
  ])("Deprecated heads the statements // Deprecated: %s", async (_, fnId, name) => {
    const { editor, fn } = await library(NOVA, "NCMI");
    const { fn: read, body, scope } = fn(fnId);

    const galaxy = functionGalaxy(scope, read, body!).definition;

    expect(withoutAutomaticHeader(galaxy)).toBe(definitionIn(editor, name));
    expect(galaxy).toContain("    // Deprecated\n");
    expect(galaxy).not.toContain("// Implementation");
  });

  it("Stop Looping in a block of the library's own with FlagAllowBreak is break; (NC_MissionRewardsBonusPossible)", async () => {
    const { editor, fn } = await library(NOVA, "NovC");
    const { fn: read, body, scope } = fn(MISSION_REWARDS_BONUS);
    const forEach = callOf(body!.actions, "02C35687")!;
    const functions = new Map([[MISSION_REWARDS_BONUS, { fn: read, body }], [FOR_EACH_ARMY_TECH_ITEM, fn(FOR_EACH_ARMY_TECH_ITEM)], ["674A851B", fn("674A851B")]]);

    // The function's outer loops are Campaign Common's, a library not in reach here: the For Each Army Tech Item is written alone.
    const lines = callGalaxy(libraryTemplateScope({ ...scope, functions }, read, body!), forEach, { as: "statement" });

    expect(lines).toContain("        break;");
    expect(editor).toContain(lines.map((line) => (line === "" ? "" : `            ${line}`)).join("\n"));
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

describe("a Kept map element's flags", () => {
  it.each([
    ["thanson01's Player Is In Combat (FlagCall, a bool, with a Label)", "thanson01", "C11903A4", "gf_PlayerIsInCombat", "bool gf_PlayerIsInCombat (int lp_player) {"],
    ["thanson01's Spooge Area with Overlord (an action with a Label)", "thanson01", "37027917", "gf_SpoogeAreawithOverlord", "void gf_SpoogeAreawithOverlord ("],
    ["a Mission's Boss - Is In North Half (FlagCondition)", "boss-functions", "9FA1AC21", "gf_BossIsInNorthHalf", "bool gf_BossIsInNorthHalf () {"],
    ["a Mission's Boss - Switch to Airborne (FlagCreateThread)", "boss-functions", "A43E9385", "gf_BossSwitchtoAirborne", "trigger auto_gf_BossSwitchtoAirborne_Trigger = null;"],
    ["a Mission's Advance Zerg Tech Tree (Stop Looping in a Switch, in no loop)", "tech-tree", "94DD08B9", "gf_AdvanceZergTechTree", "        gf_UpgradeZergGroundArmor();\r\n\r\n    }"],
  ])("render as the Editor saved them: %s", async (_, cut, id, name, shows) => {
    const { renderer, saved } = await map(cut);

    const text = renderer.renderFunction(id);

    expect(renderer.unknown).toEqual([]);
    expect(text).toBe(saved(name));
    expect(text).toContain(shows);
  });

  it("Stop Looping in a Repeat is break; (thanson01's Chrysalis Ping)", async () => {
    const { renderer, saved } = await map("thanson01");

    const text = renderer.renderTrigger("53F593F4");

    expect(renderer.unknown).toEqual([]);
    expect(text).toBe(saved("gt_ChrysalisPing"));
    expect(text).toContain("            break;\r\n");
  });

  it("a trigger's Label and Section change no Galaxy (Liberty tstory01's Stop Music Soundtrack, an older Editor's save)", async () => {
    const { renderer, saved } = await map("tstory01");

    const text = renderer.renderTrigger("F8E7BD8A")!;

    expect(renderer.unknown).toEqual([]);
    expect(withoutAutomaticHeader(text)).toBe(saved("gt_StopSoundtrackMultiple"));
  });

  it.each([
    ["thanson01's Cheat check", "thanson01", "6366E49D", "gt_Cheatcheck"],
    ["a Mission's Test Save Units, with a Label", "boss-functions", "5C4F25ED", "gt_TestSaveUnits"],
  ])("a disabled trigger has no section, as the Editor writes none: %s", async (_, cut, id, name) => {
    const { renderer, saved } = await map(cut);

    expect(renderer.renderTrigger(id)).toBe("");
    expect(renderer.unknown).toEqual([]);
    expect(saved(name)).toBeUndefined();
  });

  it("a function that runs in its own thread and returns a value is refused, as no Editor save shows one", async () => {
    const file = (name: string) => readFile(path.join(FIXTURE, "boss-functions", name), "utf8");
    const triggers = (await file("Triggers")).replace(/(<Element Type="FunctionDef" Id="9FA1AC21">\r\n)/, "$1        <FlagCreateThread/>\r\n");
    const renderer = new KeptGalaxyRenderer(readTriggersFile(triggers), triggerStringNames(await file("TriggerStrings.txt")), CORE_PRIMITIVES);

    expect(renderer.renderFunction("9FA1AC21")).toBeUndefined();
    expect(renderer.unknown).toEqual([{ kind: "form", key: "a function that runs in its own thread and returns a value, whose Galaxy no Editor save shows" }]);
  });
});
