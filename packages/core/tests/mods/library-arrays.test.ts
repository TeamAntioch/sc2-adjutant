// Array variables, indexed values and constants in a mod library (#944): read from the Editor's
// Triggers, written back as it saved them, and their Galaxy written as it generated it. The
// fixtures are cut from Swarm Story Util's and Nova Covert Ops' libraries, an older Editor's saves
// (see the fixtures' README).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GuiBodySchema, LibraryFunctionSchema } from "../../src/domain/library-interface.js";
import { definitionIn, functionGalaxy, type LibraryScope, UnrenderableGalaxyError } from "../../src/mods/library-galaxy.js";
import { functionXml, libraryElements, readLibraryFunction, stringTable, UnconvertibleFunctionError } from "../../src/mods/library-xml.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/editor-triggers/arrays/", import.meta.url));
const SWARM = path.join(FIXTURE, "campaigns", "swarmstoryutil.sc2mod");
const NOVA = path.join(FIXTURE, "mods", "missionpacks", "novacampaign.sc2mod");

/** The older Editor that saved these writes no "// Automatic Variable Declarations" line, which the current Editor writes and so does this (#937). */
const withoutAutomaticHeader = (galaxy: string) => galaxy.replace(/^ {4}\/\/ Automatic Variable Declarations\r?\n/m, "");

/** A library of a fixture package: its Triggers' elements and strings, and each element's text as the Editor saved it. */
async function library(pkg: string, id: string) {
  const xml = await readFile(path.join(pkg, "Triggers"), "utf8");
  const strings = stringTable(await readFile(path.join(pkg, "enus.sc2data", "localizeddata", "triggerstrings.txt"), "utf8"));
  const elements = libraryElements(xml, id);
  const section = xml.slice(xml.indexOf(`<Library Id="${id}">`));
  const saved = [...section.slice(0, section.indexOf("</Library>")).matchAll(/^ {8}<Element Type="\w+" Id="[0-9A-F]{8}">\n[\s\S]*?^ {8}<\/Element>$/gm)].map((match) => match[0]);
  return { elements, strings, saved };
}

/** A fixture function: read, its elements written back, its Galaxy written, and the Editor's. */
async function fixtureFunction(pkg: string, id: string, fnId: string, galaxyFile: string) {
  const { elements, strings, saved } = await library(pkg, id);
  const read = readLibraryFunction(elements, strings, id, fnId);
  const scope: LibraryScope = { library: id, functions: new Map([[fnId, read]]), elements, strings };
  const galaxy = functionGalaxy(scope, read.fn, read.body!);
  return { read, xml: functionXml(id, read.fn, read.body).elements, saved, galaxy, editor: definitionIn(await readFile(path.join(pkg, "base.sc2data", galaxyFile), "utf8"), galaxy.name) };
}

describe("an array variable in a mod library's function", () => {
  it("indexed in one dimension is read, written back and written in Galaxy as the Editor saved it (Swarm Story Util's Story Add Aliased Unit)", async () => {
    const { read, xml, saved, galaxy, editor } = await fixtureFunction(SWARM, "281DEC45", "5F3985A1", "Lib281DEC45.galaxy");

    expect(read.body!.actions[1]).toMatchObject({ params: [{ variable: "6E4C9947", index: [{ id: "FC8EAF6F", variable: "0E624C5A" }] }, {}] });
    for (const element of xml) expect(saved).toContain(element);
    expect(withoutAutomaticHeader(galaxy.definition)).toBe(editor);
    expect(editor).toContain("lib281DEC45_gv_zSS_Aliases[lib281DEC45_gv_zSS_AliasedUnitCount] = lp_alias;");
  });

  it("of a structure is indexed before its member is named, the index a call (Swarm Story Util's Character Unit)", async () => {
    const { xml, saved, galaxy, editor } = await fixtureFunction(SWARM, "281DEC45", "D28BC4EA", "Lib281DEC45.galaxy");

    for (const element of xml) expect(saved).toContain(element);
    expect(withoutAutomaticHeader(galaxy.definition)).toBe(editor);
    expect(editor).toContain("return lib281DEC45_gv_zSS_Characters[lib281DEC45_gf_ZSS_CharacterIndex(lp_character)].lv_unit;");
  });

  it("indexed in two dimensions is written with both indexes in order (Nova's NU_EquipmentInSlot)", async () => {
    const { xml, saved, galaxy, editor } = await fixtureFunction(NOVA, "NCUI", "9C1720C8", "LibNCUI.galaxy");

    for (const element of xml) expect(saved).toContain(element);
    expect(withoutAutomaticHeader(galaxy.definition)).toBe(editor);
    expect(editor).toContain("return libNCUI_gv_nU_EquipmentList[lp_equipmentSlot][lp_itemSlot];");
  });

  it("writes its elements in the order the Editor saved them", async () => {
    const { xml, saved } = await fixtureFunction(SWARM, "281DEC45", "5F3985A1", "Lib281DEC45.galaxy");

    const at = saved.findIndex((element) => element.includes('Type="FunctionDef" Id="5F3985A1"'));
    expect(xml).toEqual(saved.slice(at, at + xml.length));
  });

  it("writes a structure member's Param before its index values', as the Editor saved them", async () => {
    const { xml, saved } = await fixtureFunction(SWARM, "281DEC45", "D28BC4EA", "Lib281DEC45.galaxy");

    const at = saved.findIndex((element) => element.includes('Type="FunctionDef" Id="D28BC4EA"'));
    expect(xml).toEqual(saved.slice(at, at + xml.length));
    expect(xml.findIndex((element) => element.includes('Id="CDBE8473">'))).toBeLessThan(xml.findIndex((element) => element.includes('Id="2506A877">')));
  });
});

describe("a mod library function's own arrays, sized by a constant variable", () => {
  /** Nova's NU_MissionSetRewards: two local arrays sized by the constant libNCUI_gv_nUC_MissionRewardsMaxCount. It calls a Campaign Common function this can't read, so only its declarations are written here. */
  const rewards = async () => {
    const { elements, strings, saved } = await library(NOVA, "NCUI");
    return { read: readLibraryFunction(elements, strings, "NCUI", "AB37E133"), elements, strings, saved };
  };

  it("are read with their sizes, and every element is written back as the Editor saved it", async () => {
    const { read, saved } = await rewards();

    expect(read.body!.variables.filter((variable) => variable.type.array).map((variable) => [variable.name, variable.type])).toEqual([
      ["TechItemRewards", { type: "userinstance", userType: "CampaignTechItem", array: [{ variable: "NCUI/49606004" }] }],
      ["EquipmentRewards", { type: "userinstance", userType: "CampaignPerk", array: [{ variable: "NCUI/49606004" }] }],
    ]);
    const xml = functionXml("NCUI", read.fn, read.body).elements;
    const at = saved.findIndex((element) => element.includes('Type="FunctionDef" Id="AB37E133"'));
    expect(xml).toEqual(saved.slice(at, at + xml.length));
  });

  it("are declared with the constant's name plus one, and not initialized, as the Editor wrote them", async () => {
    const { read, elements, strings } = await rewards();
    const editor = definitionIn(await readFile(path.join(NOVA, "base.sc2data", "LibNCUI.galaxy"), "utf8"), "libNCUI_gf_NU_MissionSetRewards")!;
    /** From its Variable Declarations to its Implementation. */
    const variables = (galaxy: string) => galaxy.slice(galaxy.indexOf("    // Variable Declarations"), galaxy.indexOf("    // Implementation"));

    const written = functionGalaxy({ library: "NCUI", functions: new Map(), elements, strings }, read.fn, { variables: read.body!.variables, actions: [] }).definition;

    expect(variables(withoutAutomaticHeader(written))).toBe(variables(editor));
    expect(variables(editor)).toContain("    string[libNCUI_gv_nUC_MissionRewardsMaxCount + 1] lv_techItemRewards;\n");
  });
});

// The local forms no function of the fixtures' libraries holds alone: each is the Editor's Galaxy for it, from Nova's libraries.
describe("a mod library function's own array or constant variable", () => {
  const scope: LibraryScope = { library: "NovC", functions: new Map(), elements: new Map(), strings: new Map() };
  const fn = LibraryFunctionSchema.parse({ id: "0000F000", name: "Moor", kind: "action", gui: "library/Moor.json" });
  const galaxy = (variables: unknown[]) => functionGalaxy(scope, fn, GuiBodySchema.parse({ variables })).definition;

  it("is declared with its size, one more than the Editor's (NC_DebugProgressCompleteToMission's string[10] lv_arcMissions, of size 9)", () => {
    expect(galaxy([{ id: "7BDE27A0", name: "arcMissions", identifier: "arcMissions", type: { type: "gamelink", gameType: "Map", array: [{ size: 9 }] } }])).toContain("    string[10] lv_arcMissions;\n");
  });

  it("that is constant is declared with its value, and not set again (NS_TempConversationBank's const string lv_tempConvoBankName)", () => {
    const text = galaxy([{ id: "ED16D9C4", name: "TempConvoBankName", type: { type: "string", constant: true }, value: { id: "0000F003", type: "string", value: "PSTempConvoBank" } }]);

    expect(text).toContain('    // Variable Declarations\n    const string lv_tempConvoBankName = "PSTempConvoBank";\n\n');
    expect(text).toContain("    // Variable Initialization\n\n");
  });

  it("that is an array with a value of its own is refused: no Editor save shows its Galaxy", () => {
    expect(() => galaxy([{ id: "0000F004", name: "Counts", type: { type: "int", array: [{ size: 3 }] }, value: { id: "0000F005", type: "int", value: "2" } }])).toThrow(UnrenderableGalaxyError);
  });

  it("of a literal-zero size is refused on reading: no Editor save has one", () => {
    const body = GuiBodySchema.parse({ variables: [{ id: "0000F006", name: "Slots", type: { type: "int", array: [{ size: 1 }] } }] });
    const xml = functionXml("NovC", fn, body)
      .elements.join("\n")
      .replace('Dim="0" Value="1"', 'Dim="0" Value="0"');
    const strings = stringTable("FunctionDef/Name/lib_NovC_0000F000=Moor\nVariable/Name/lib_NovC_0000F006=Slots\n");

    expect(() => readLibraryFunction(`<TriggerData><Library Id="NovC">${xml}</Library></TriggerData>`, strings, "NovC", "0000F000")).toThrow(new UnconvertibleFunctionError("0000F000", "an array of size 0, which no Editor save has"));
  });
});
