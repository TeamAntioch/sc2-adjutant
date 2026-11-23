// Expressions (#946): the Editor's Arithmetic and Expression values (`<ExpressionType>`), text with
// `~<code>~` slots that values fill. An int or fixed expression is its text in parentheses with its
// slots' values; a string one its runs of text quoted and joined to them by " + "; a text one's
// words are in GameStrings (Param/Expression/<id>, a library's Param/Expression/lib_<library>_<id>),
// each slot its words name set by a TextExpressionSetToken line before the statement, its value
// TextExpressionAssemble of the key. Read from a mod library's Triggers and written back as the
// Editor saved it, its words carried by the conversion, and written in Galaxy by the template
// engine and the Kept renderer alike. The fixtures are cut from the game's Campaign Common, Nova
// Covert Ops and Void Prologue libraries and a current Editor's Mission save (see the fixtures' README).
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_COMPILE_RECORD } from "../../src/domain/compile-record.js";
import type { GuiCall, GuiStatement, GuiValue } from "../../src/domain/library-interface.js";
import { readCompileRecord, saveCompileRecord } from "../../src/map/mission-package.js";
import { compileMod } from "../../src/mods/compile-mod.js";
import { convertLibrary } from "../../src/mods/convert-library.js";
import { callGalaxy, definitionIn, functionGalaxy, type LibraryScope, libraryTemplateScope } from "../../src/mods/library-galaxy.js";
import { functionXml, libraryElements, readLibraryFunction, stringTable } from "../../src/mods/library-xml.js";
import { KeptGalaxyRenderer, textValueKeys } from "../../src/triggers/kept-trigger-galaxy.js";
import { keptElementSpan } from "../../src/triggers/splice-map-script.js";
import { CORE_PRIMITIVES } from "../../src/triggers/trigger-catalog.js";
import { readTriggersFile, triggerStringNames } from "../../src/triggers/triggers-file.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/editor-triggers/expressions/", import.meta.url));
const GAME_STRINGS = "enUS.SC2Data/LocalizedData/GameStrings.txt";
/** The older Editor that saved Campaign Common and Nova writes no "// Automatic Variable Declarations" line, which the current Editor writes and so does this (#937). */
const withoutAutomaticHeader = (galaxy: string) => galaxy.replace(/^ {4}\/\/ Automatic Variable Declarations\r?\n/m, "");

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** A library of the fixture's mods: its elements, strings and words, and each element's text as the Editor saved it. */
async function library(mod: string, id: string) {
  const dir = path.join(FIXTURE, "mods", mod);
  const xml = await readFile(path.join(dir, "Triggers"), "utf8");
  const strings = stringTable(await readFile(path.join(dir, "enus.sc2data", "localizeddata", "triggerstrings.txt"), "utf8"));
  const gameStrings = await readFile(path.join(dir, "enus.sc2data", "localizeddata", "gamestrings.txt"), "utf8").catch(() => "");
  const elements = libraryElements(xml, id);
  const section = xml.slice(xml.indexOf(`<Library Id="${id}">`));
  const saved = [...section.slice(0, section.indexOf("</Library>")).matchAll(/^ {8}<Element Type="\w+" Id="[0-9A-F]{8}">\n[\s\S]*?^ {8}<\/Element>$/gm)].map((match) => match[0]);
  const editor = await readFile(path.join(dir, "base.sc2data", `Lib${id}.galaxy`), "utf8");
  const scope: LibraryScope = { library: id, functions: new Map(), elements, strings, texts: textValueKeys([gameStrings]) };
  const fn = (fnId: string) => {
    const read = readLibraryFunction(elements, strings, id, fnId);
    return { ...read, scope: { ...scope, functions: new Map([[fnId, read]]) } };
  };
  return { saved, editor, fn };
}

const commons = () => library("missionpacks/campaigncommon.sc2mod", "ComC");
const LOCATION_DATA_STRING = "8077C217";
const ARCHIVE_PROGRESS_SET = "8DDD8350";
const CLAMP_PROGRESS = "EE958875";

/** The call in `statements` (or the calls they hold) given the value of Param `id`, at any depth. */
function callGiven(statements: readonly GuiStatement[], id: string): GuiCall | undefined {
  const holds = (value: GuiValue & { readonly id?: string }): boolean =>
    value.id === id || ("call" in value && value.call !== undefined && (value.call.params ?? []).some(holds)) || ("expression" in value && value.expression !== undefined && value.expression.slots.some(holds));
  for (const statement of statements) {
    if ("comment" in statement) continue;
    if ((statement.params ?? []).some(holds)) return statement;
    const inner = callGiven(statement.body ?? [], id);
    if (inner) return inner;
  }
  return undefined;
}

describe("an expression in a mod library's function", () => {
  it.each([
    ["Campaign Common's CC_LocationDataString (a string of two slots, one a literal)", "missionpacks/campaigncommon.sc2mod", "ComC", LOCATION_DATA_STRING],
    ["Campaign Common's CC_MissionObjectiveArchiveProgressSet (a text of two slots and a string of one)", "missionpacks/campaigncommon.sc2mod", "ComC", ARCHIVE_PROGRESS_SET],
    ["Campaign Common's CC_ClampProgressToMission (an int of two slots)", "missionpacks/campaigncommon.sc2mod", "ComC", CLAMP_PROGRESS],
    ["Nova's NC_DebugCampaignTechStoreStates (two strings of one slot)", "missionpacks/novacampaign.sc2mod", "NovC", "13D859D1"],
    ["Void Prologue's Create Objective (Campaign) (a text whose words name one of its two slots)", "voidprologue.sc2mod", "A3DDD02B", "A2B49061"],
    ["Void Prologue's Progress Color (an int of two slots and fixed ones of four)", "voidprologue.sc2mod", "A3DDD02B", "7F5EBFCE"],
  ])("is read and written back as the Editor saved it: %s", async (_, mod, id, fnId) => {
    const { saved, fn } = await library(mod, id);
    const { fn: read, body } = fn(fnId);

    const xml = functionXml(id, read, body).elements;

    const at = saved.findIndex((element) => element.includes(`Type="FunctionDef" Id="${fnId}"`));
    expect(xml).toEqual(saved.slice(at, at + xml.length));
    expect(JSON.stringify(body)).toContain('"expression":{"type":');
  });

  it("of type string is its runs of text quoted and joined to its slots' values, in parentheses (CC_LocationDataString)", async () => {
    const { editor, fn } = await commons();
    const { fn: read, body, scope } = fn(LOCATION_DATA_STRING);

    const galaxy = functionGalaxy(scope, read, body!).definition;

    expect(withoutAutomaticHeader(galaxy)).toBe(definitionIn(editor, "libComC_gf_CC_LocationDataString"));
    expect(galaxy).toContain('return ("CC_L_" + (lp_planet));');
  });

  it("of type text sets its slots before the statement and is TextExpressionAssemble of its key (CC_MissionObjectiveArchiveProgressSet)", async () => {
    const { editor, fn } = await commons();
    const { fn: read, body, scope } = fn(ARCHIVE_PROGRESS_SET);

    const galaxy = functionGalaxy(scope, read, body!).definition;

    expect(withoutAutomaticHeader(galaxy)).toBe(definitionIn(editor, "libComC_gf_CC_MissionObjectiveArchiveProgressSet"));
    expect(galaxy).toContain(
      [
        '    TextExpressionSetToken("Param/Expression/lib_ComC_6F77848E", "A", StringToText((lp_objective)));',
        '    TextExpressionSetToken("Param/Expression/lib_ComC_6F77848E", "B", IntToText(lp_progress));',
        '    TriggerDebugOutput(1, TextExpressionAssemble("Param/Expression/lib_ComC_6F77848E"), false);',
      ].join("\n"),
    );
  });

  it("of type text sets only the slots its words name (Void Prologue's Create Objective (Campaign))", async () => {
    const { editor, fn } = await library("voidprologue.sc2mod", "A3DDD02B");
    const { fn: read, body, scope } = fn("A2B49061");

    const galaxy = functionGalaxy(scope, read, body!).definition;

    expect(galaxy).toBe(definitionIn(editor, "libA3DDD02B_gf_CreateObjectiveCampaign"));
    // Its words are "~A~": its slot B, lv_bonusText, is given no line.
    expect(galaxy).not.toContain('"B", lv_bonusText');
  });

  it("of type int or fixed is its text in parentheses, each slot's value in place, a slot named twice written twice (Void Prologue's Progress Color)", async () => {
    const { editor, fn } = await library("voidprologue.sc2mod", "A3DDD02B");
    const { fn: read, body, scope } = fn("7F5EBFCE");

    const galaxy = functionGalaxy(scope, read, body!).definition;

    expect(galaxy).toBe(definitionIn(editor, "libA3DDD02B_gf_ProgressColor"));
    // An int's "(~A~+~B~)/2" and a fixed's "~A~+(~B~-~A~)*~X~/~Y~".
    expect(galaxy).toContain("lv_middle = ((lp_minValue+lp_maxValue)/2);");
    expect(galaxy).toContain("lv_r = (ColorGetComponent(lp_color1, c_colorComponentRed)+(ColorGetComponent(lp_color2, c_colorComponentRed)-ColorGetComponent(lp_color1, c_colorComponentRed))*(lp_progress - lp_minValue)/(lp_maxValue - lp_minValue));");
  });

  it("of type string with one slot is written as the Editor wrote it (NC_DebugCampaignTechStoreStates)", async () => {
    const { editor, fn } = await library("missionpacks/novacampaign.sc2mod", "NovC");
    const { fn: read, body, scope } = fn("13D859D1");
    const call = callGiven(body!.actions, "0293BB3E")!;

    // The function calls NC_ForEachArmyTechItem, whose <FlagAllowBreak> a conversion doesn't read yet (#947): its one statement is written alone.
    const [line] = callGalaxy(libraryTemplateScope(scope, read, body!), call, { as: "statement" });

    expect(line).toBe('DataTableSetString(true, ("DebugTechSaveTechItem_" + (lv_indexTechItem)), (libNovC_gf_NC_ArmyTechItemAssignedUnit(lv_indexTechItem)));');
    expect(editor).toContain(`        ${line}\n`);
  });

  it.each([
    ["a quote", "~Prefix~\\\"~Planet Name~", "holding a quote"],
    ["no slot for one of its values", "~Prefix~", "whose text has no slot ~Planet Name~"],
    ["a slot no value fills", "~Prefix~~Planet Name~~Other~", "with no value for its slot ~Other~"],
    ["no text", "", "whose text has no slot ~Prefix~"],
  ])("of type string whose text holds %s is refused", async (_, text, reason) => {
    const { fn } = await commons();
    const { fn: read, body, scope } = fn(LOCATION_DATA_STRING);
    // CC_LocationDataString's expression, its text changed.
    const changed = JSON.parse(JSON.stringify(body).replace('"text":"~Prefix~~Planet Name~"', JSON.stringify({ text }).slice(1, -1)));

    expect(() => functionGalaxy(scope, read, changed)).toThrow(reason);
  });

  it("of type text whose words are empty, or name a slot it doesn't have, is refused", async () => {
    const { fn } = await commons();
    const { fn: read, body, scope } = fn(ARCHIVE_PROGRESS_SET);

    expect(() => functionGalaxy({ ...scope, texts: new Map() }, read, body!)).toThrow("the text expression Param/Expression/lib_ComC_6F77848E, whose words are empty");
    expect(() => functionGalaxy({ ...scope, texts: new Map([["Param/Expression/lib_ComC_6F77848E", "~A~ to ~C~"]]) }, read, body!)).toThrow("with no value for its slot ~C~");
  });
});

/** A file of the `salvage-objective` fixture, cut from a current Editor's Mission save: Create Secondary Objective (Salvage). */
const salvage = (file: string): Promise<string> => readFile(path.join(FIXTURE, "salvage-objective", file), "utf8");

describe("a text expression in a Kept map function", () => {
  it("is written as the Editor saved it: its slot set before the action, an int expression's value in it", async () => {
    const kept = new KeptGalaxyRenderer(readTriggersFile(await salvage("Triggers")), triggerStringNames(await salvage("TriggerStrings.txt")), CORE_PRIMITIVES, textValueKeys([await salvage("GameStrings.txt")]));
    const script = await salvage("MapScript.galaxy");
    const span = keptElementSpan(script, "gf_CreateSecondaryObjectiveSalvage")!;

    const text = kept.renderFunction("2C61F43A");

    expect(kept.unknown).toEqual([]);
    expect(text).toBe(script.slice(span.start, span.end).replace(/\r?\n/g, "\r\n"));
    expect(text).toContain('TextExpressionSetToken("Param/Expression/5F29F17B", "A", IntToText((3 - gv_objectives.lv_scrapFound)));');
  });

  it("whose words aren't known is refused", async () => {
    const kept = new KeptGalaxyRenderer(readTriggersFile(await salvage("Triggers")), triggerStringNames(await salvage("TriggerStrings.txt")), CORE_PRIMITIVES);

    expect(kept.renderFunction("2C61F43A")).toBeUndefined();
    expect(kept.unknown).toEqual([{ kind: "form", key: "the text expression Param/Expression/5F29F17B, whose words aren't known" }]);
  });
});

describe("a converted function's text expressions", () => {
  /** Campaign Common's mod as import-mod lays a mod out, outside a Workspace, its package in the Editor's spelling, without its Galaxy. */
  async function mod(): Promise<{ blueprintPath: string; pkg: string }> {
    const dir = path.join(FIXTURE, "mods", "missionpacks", "campaigncommon.sc2mod");
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-expressions-"));
    const pkg = path.join(root, "mods", "campaigncommon", "CampaignCommon.SC2Mod");
    await mkdir(path.join(pkg, "enUS.SC2Data", "LocalizedData"), { recursive: true });
    await cp(path.join(dir, "Triggers"), path.join(pkg, "Triggers"));
    await cp(path.join(dir, "enus.sc2data", "localizeddata", "triggerstrings.txt"), path.join(pkg, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"));
    await cp(path.join(dir, "enus.sc2data", "localizeddata", "gamestrings.txt"), path.join(pkg, ...GAME_STRINGS.split("/")));
    const blueprintPath = path.join(root, "mods", "campaigncommon", "blueprint.json");
    await writeFile(blueprintPath, JSON.stringify({ id: "campaigncommon", kind: "campaign" }));
    await saveCompileRecord(blueprintPath, EMPTY_COMPILE_RECORD);
    await mkdir(path.join(pkg, "Base.SC2Data"), { recursive: true });
    return { blueprintPath, pkg };
  }

  it("have their words taken into the library by convert-library, and round-trip through compile-mod with the Equivalence Check passing", async () => {
    const { blueprintPath, pkg } = await mod();

    const converted = await convertLibrary(blueprintPath, { functions: ["CC_MissionObjectiveArchiveProgressSet"] });

    expect(converted).toMatchObject({ converted: ["CC_MissionObjectiveArchiveProgressSet"], refused: [] });
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    expect(blueprint.library.strings).toEqual({ [GAME_STRINGS]: { "Param/Expression/lib_ComC_6F77848E": "Setting archive progress for ~A~ to ~B~" } });

    for (const file of ["LibComC.galaxy", "LibComC_h.galaxy"]) await cp(path.join(FIXTURE, "mods", "missionpacks", "campaigncommon.sc2mod", "base.sc2data", file), path.join(pkg, "Base.SC2Data", file));
    await writeFile(
      blueprintPath,
      JSON.stringify({ ...blueprint, acceptedDifferences: [{ item: "galaxy:Base.SC2Data/LibComC.galaxy:libComC_gf_CC_MissionObjectiveArchiveProgressSet", reason: "The current Editor writes the Automatic Variable Declarations line" }] }),
    );

    await compileMod(blueprintPath);

    expect(await readFile(path.join(pkg, ...GAME_STRINGS.split("/")), "utf8")).toContain("Param/Expression/lib_ComC_6F77848E=Setting archive progress for ~A~ to ~B~");
    expect(definitionIn(await readFile(path.join(pkg, "Base.SC2Data", "LibComC.galaxy"), "utf8"), "libComC_gf_CC_MissionObjectiveArchiveProgressSet")).toContain('TextExpressionAssemble("Param/Expression/lib_ComC_6F77848E")');
    const record = await readCompileRecord(blueprintPath);
    expect(record!.entries).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "string", file: GAME_STRINGS, key: "Param/Expression/lib_ComC_6F77848E" })]));
  });
});
