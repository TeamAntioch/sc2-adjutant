// Library breadth, part 2 (ADR-0011): a Kept library function's custom script, its structure
// members and triggers, a function that runs in its own thread and an inline one convert into its
// GUI body and compile back as the Editor saved them, their Galaxy byte for byte. The library is
// synthetic (library-script-fixture.ts), each function laid out as the Editor saves it.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GuiBodySchema, LibraryFunctionSchema } from "../../src/domain/library-interface.js";
import { compileMod } from "../../src/mods/compile-mod.js";
import { convertLibrary } from "../../src/mods/convert-library.js";
import { definitionIn, functionGalaxy, removeDefinitions, UnrenderableGalaxyError } from "../../src/mods/library-galaxy.js";
import { functionXml, libraryElements, libraryTriggersFile, readLibraryFunction, stringTable, UnconvertibleFunctionError } from "../../src/mods/library-xml.js";
import { cleanupMods, hashTree, inPackage, setup } from "./mod-fixture.js";
import { SCRIPT_FUNCTIONS, SCRIPT_GALAXY, SCRIPT_HEADER, SCRIPT_STRINGS, SCRIPT_TRIGGERS, withScriptLibrary } from "./library-script-fixture.js";

afterEach(cleanupMods);

async function harbour() {
  const mod = await setup();
  await withScriptLibrary(mod);
  return mod;
}

/** The Editor's Triggers with one function's elements where a compile splices a Compiled item's: the end of the library. */
function moved(id: string): string {
  const at = SCRIPT_FUNCTIONS.findIndex((fn) => fn.id === id);
  const start = SCRIPT_TRIGGERS.indexOf(`        <Element Type="FunctionDef" Id="${id}">`);
  const next = SCRIPT_FUNCTIONS[at + 1];
  const close = SCRIPT_TRIGGERS.indexOf("    </Library>");
  const end = next ? SCRIPT_TRIGGERS.indexOf(`        <Element Type="FunctionDef" Id="${next.id}">`) : close;
  return SCRIPT_TRIGGERS.slice(0, start) + SCRIPT_TRIGGERS.slice(end, close) + SCRIPT_TRIGGERS.slice(start, end) + SCRIPT_TRIGGERS.slice(close);
}

const FORMS: Readonly<Record<string, string>> = {
  "Wake Crew": "Custom Script actions, of one line and of several",
  "Frame Harbour": "a value of custom script, a structure's member and a trigger",
  "Sort Cargo": "a Switch over a structure's member",
  "Sound Bell": "its own thread, with a parameter",
  "Rock Boat": "its own thread, with none",
  "Tide Level": "an inline function's own definition",
  "Clear Deck": "an inline action's own definition",
  "Read Tide": "an inline function's value in its place, and an inline action called",
  "Hail Ship": "two presets, a preloaded default and a user instance's type",
};

describe("a library function's script code, threads and structure", () => {
  it.each(SCRIPT_FUNCTIONS.map((fn) => [fn.name, FORMS[fn.name]!, fn.id] as const))("%s (%s) converts and compiles back as the Editor saved it, its Galaxy byte for byte", async (name, _form, id) => {
    const mod = await harbour();

    expect(await convertLibrary(mod.blueprintPath, { functions: [name] })).toEqual({ converted: [name], refused: [], items: [], refusedItems: [] });
    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions.filter((conversion) => conversion.accepted !== undefined)).toEqual([]);
    expect(compiled.conversions.map((conversion) => conversion.item)).toEqual(expect.arrayContaining([`function:${id}`, expect.stringMatching(/^galaxy:Base\.SC2Data\/LibHbr1\.galaxy:/), expect.stringMatching(/^galaxy:Base\.SC2Data\/LibHbr1_h\.galaxy:/)]));
    expect(await inPackage(mod, "Triggers")).toBe(moved(id));
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).toBe(SCRIPT_GALAXY);
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy")).toBe(SCRIPT_HEADER);
    expect(await inPackage(mod, "enUS.SC2Data/LocalizedData/TriggerStrings.txt")).toBe(SCRIPT_STRINGS);

    const before = await hashTree(mod.modDir);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modDir)).toEqual(before);
  });

  it("all convert at once", async () => {
    const mod = await harbour();

    expect(await convertLibrary(mod.blueprintPath)).toEqual({ converted: SCRIPT_FUNCTIONS.map((fn) => fn.name), refused: [], items: ["00000001", "Harbour"], refusedItems: [] });
    await compileMod(mod.blueprintPath);

    expect(await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).toBe(SCRIPT_GALAXY);
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy")).toBe(SCRIPT_HEADER);
  });

  it("keeps custom script, a structure's member and a trigger in the GUI body as data", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath, { functions: ["Wake Crew", "Frame Harbour"] });

    const wake = JSON.parse(await readFile(path.join(mod.modDir, "library", "WakeCrew.json"), "utf8"));
    const frame = JSON.parse(await readFile(path.join(mod.modDir, "library", "FrameHarbour.json"), "utf8"));

    expect(wake.actions[1].body[1]).toEqual({ id: "0000F125", function: "Ntve/00000123", sub: "Ntve/00000004", script: "while(true){\n    TriggerExecute(lv_watch, true, false);\n    break;\n}" });
    expect(frame.actions[0].params[1]).toEqual({ id: "0000F212", def: "Ntve/00000220", customScript: '"Harbour/Frame"', customType: "layoutframe" });
    expect(frame.actions[1].params[0]).toEqual({ id: "0000F221", def: "Ntve/00000219", variable: "0000F900", member: { id: "0000F222", variable: "0000F913" } });
    expect(frame.actions[2].params[0]).toEqual({ id: "0000F231", def: "Ntve/00000176", trigger: "0000F920" });
  });

  it("lists a parameter's presets, where there are several", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath, { functions: ["Hail Ship"] });

    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));

    expect(blueprint.library.functions[0].parameters[0].preset).toEqual(["Ntve/C5797A54", "Ntve/ED11A5DE"]);
  });
});

describe("a thread function's Galaxy in the library's", () => {
  const sound = SCRIPT_FUNCTIONS.find((fn) => fn.name === "Sound Bell")!;
  const rock = SCRIPT_FUNCTIONS.find((fn) => fn.name === "Rock Boat")!;

  it("is found whole: its trigger and globals before it, its trigger's function after", () => {
    expect(definitionIn(SCRIPT_GALAXY, "libHbr1_gf_SoundBell")).toBe(sound.galaxy.join("\n"));
    expect(definitionIn(SCRIPT_GALAXY, "libHbr1_gf_RockBoat")).toBe(rock.galaxy.join("\n"));
  });

  it("is removed whole", () => {
    const without = removeDefinitions(SCRIPT_GALAXY, ["libHbr1_gf_SoundBell"]);
    expect(without).not.toContain("SoundBell");
    expect(without).toContain(rock.galaxy.join("\n"));
  });
});

describe("a library function's script code, past the Editor's samples", () => {
  const scope = { library: "Hbr1", functions: new Map(), elements: libraryElements(SCRIPT_TRIGGERS, "Hbr1"), strings: stringTable(SCRIPT_STRINGS) };
  const refusal = (fn: object, body: object): string => {
    try {
      functionGalaxy(scope, LibraryFunctionSchema.parse(fn), GuiBodySchema.parse(body));
    } catch (error) {
      if (error instanceof UnrenderableGalaxyError) return error.reason;
      throw error;
    }
    return "written";
  };
  const fn = { id: "0000E000", name: "Moor", kind: "action", gui: "library/Moor.json" };
  const set = (value: object) => ({ actions: [{ id: "0000E010", function: "Ntve/00000136", params: [{ id: "0000E011", def: "Ntve/00000219", variable: "0000F930" }, { id: "0000E012", def: "Ntve/00000220", ...value }] }] });

  it("is refused for a thread function that returns a value", () => {
    expect(refusal({ ...fn, kind: "function", flags: ["createThread"], returns: { type: "int" } }, {})).toBe("it runs in its own thread and returns a value, whose Galaxy no Editor save shows");
  });

  it("is refused for an action that returns a value, which one save has (Nova's Attach Model To Unit With Vis)", () => {
    expect(refusal({ ...fn, returns: { type: "actor" } }, {})).toBe("it's an action that returns a value, whose Galaxy one Editor save shows, too few to know its rule");
  });

  it("is refused for a value of custom script over more than one line", () => {
    expect(refusal(fn, set({ customScript: "1.0 +\n2.0", customType: "fixed" }))).toBe("a value of custom script over more than one line, whose Galaxy this doesn't write yet");
  });

  it("is refused for a Custom Script call where a value is wanted", () => {
    expect(refusal(fn, set({ call: { id: "0000E013", function: "Ntve/00000123", script: "1.0" } }))).toBe("its custom script 0000E013 stands where a value is wanted, whose Galaxy this doesn't write yet");
  });

  it("is refused for a Switch over a value whose type it can't tell", () => {
    const value = { id: "0000E021", def: "Ntve/B4ACF12A", preset: "Ntve/1E7A4625" };
    expect(refusal(fn, { actions: [{ id: "0000E020", function: "Ntve/91C49196", params: [value] }] })).toBe("libNtve_gf_Switch's #INITAUTOVAR of value, whose anycompare type this can't tell from the value given");
  });

  it("is refused for script code on a call other than Custom Script, rather than dropped", () => {
    expect(refusal(fn, { actions: [{ id: "0000E030", function: "Hbr1/0000F550", script: "Wait(1.0, c_timeGame);" }] })).toBe("its call 0000E030 to libHbr1_gf_ClearDeck holds script code of its own, whose Galaxy this doesn't write yet");
  });

  it("is refused for an empty Custom Script", () => {
    expect(refusal(fn, { actions: [{ id: "0000E040", function: "Ntve/00000123" }] })).toBe("its custom script 0000E040 is empty, whose Galaxy this doesn't write yet");
  });

  it("is refused for a structure member with an identifier of its own, which no Editor sample shows", () => {
    const named = { ...scope, elements: libraryElements(SCRIPT_TRIGGERS.replace(`<Element Type="Variable" Id="0000F913">`, `<Element Type="Variable" Id="0000F913">\r\n            <Identifier>Master</Identifier>`), "Hbr1") };
    const body = GuiBodySchema.parse({ actions: [{ id: "0000E050", function: "Ntve/00000136", params: [{ id: "0000E051", def: "Ntve/00000219", variable: "0000F900", member: { id: "0000E052", variable: "0000F913" } }, { id: "0000E053", def: "Ntve/00000220", type: "string", value: "Ada" }] }] });
    expect(() => functionGalaxy(named, LibraryFunctionSchema.parse(fn), body)).toThrow("the structure member 0000F913, which has an identifier of its own (Master), whose Galaxy name this doesn't write yet");
  });

  it("calls an inline action whose body needs call variables of its own, which its own definition declares", () => {
    const tally = LibraryFunctionSchema.parse({ id: "0000E200", name: "Tally", kind: "function", returns: { type: "int" }, script: "(#AUTOVAR(n, int) + 1)" });
    const count = LibraryFunctionSchema.parse({ id: "0000E300", name: "Count Boats", kind: "action", flags: ["inline"], gui: "library/CountBoats.json" });
    const counting = GuiBodySchema.parse({ actions: [{ id: "0000E310", function: "Ntve/00000136", params: [{ id: "0000E311", def: "Ntve/00000219", variable: "0000F930" }, { id: "0000E312", def: "Ntve/00000220", call: { id: "0000E313", function: "Hbr1/0000E200" } }] }] });
    const withInline = { ...scope, functions: new Map([["0000E200", { fn: tally }], ["0000E300", { fn: count, body: counting }]]) };

    expect(functionGalaxy(withInline, LibraryFunctionSchema.parse(fn), GuiBodySchema.parse({ actions: [{ id: "0000E320", function: "Hbr1/0000E300" }] })).definition.split("\n").at(-2)).toBe("    libHbr1_gf_CountBoats();");
  });

  it("calls a Kept inline action by its interface, whatever its body holds", () => {
    const unreadable = { ...scope, elements: libraryElements(SCRIPT_TRIGGERS.replace(`<Element Type="FunctionCall" Id="0000F560">`, `<Element Type="FunctionCall" Id="0000F560">\r\n            <Unknown/>`), "Hbr1") };
    const read = readLibraryFunction(SCRIPT_TRIGGERS, stringTable(SCRIPT_STRINGS), "Hbr1", "0000F600");

    expect(functionGalaxy(unreadable, read.fn, read.body!).definition).toBe(SCRIPT_FUNCTIONS.find((each) => each.name === "Read Tide")!.galaxy.join("\n"));
  });

  it("reads back a value of custom script with no custom type, and refuses a custom type with none given", () => {
    const fnWith = LibraryFunctionSchema.parse({ ...fn, id: "0000E400" });
    const body = GuiBodySchema.parse(set({ customScript: "1.0" }));
    const part = functionXml("Hbr1", fnWith, body);
    const xml = libraryTriggersFile("Hbr1", [part.itemLine], part.elements);
    const strings = new Map([["FunctionDef/Name/lib_Hbr1_0000E400", "Moor"]]);

    expect(readLibraryFunction(xml, strings, "Hbr1", "0000E400").body).toEqual(body);
    expect(() => readLibraryFunction(xml.replace("<ScriptCode>", '<CustomType/>\n            <ScriptCode>'), strings, "Hbr1", "0000E400")).toThrow("its Param 0000E012 has a CustomType with no Type");
  });

  it("reads a type naming an element of a kind the conversion doesn't write as unconvertible", () => {
    const odd = SCRIPT_TRIGGERS.replace('<TypeElement Type="ParamDef" Library="Hbr1" Id="0000F703"/>', '<TypeElement Type="Preset" Library="Hbr1" Id="0000F703"/>');
    expect(() => readLibraryFunction(odd, stringTable(SCRIPT_STRINGS), "Hbr1", "0000F700")).toThrow(UnconvertibleFunctionError);
  });
});
