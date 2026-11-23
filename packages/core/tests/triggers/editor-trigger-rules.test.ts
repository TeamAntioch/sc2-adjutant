// Seven rules about how the Editor reads and writes Triggers and Galaxy (issue #738), each checked
// against our writers. The facts behind them are in docs/reference/editor-trigger-rules.md.
import { describe, expect, it } from "vitest";

import { GuiBodySchema, LibraryFunctionSchema } from "../../src/domain/library-interface.js";
import { functionGalaxy, type LibraryScope } from "../../src/mods/library-galaxy.js";
import { functionXml, libraryElements, libraryTriggersFile, readLibraryFunction, stringTable, UnconvertibleFunctionError } from "../../src/mods/library-xml.js";
import { withCustomScript } from "../../src/triggers/custom-script.js";
import { NTVE_PRESETS as P } from "../../src/triggers/trigger-catalog.js";
import { triggerVariable, wait } from "../../src/triggers/trigger-builders.js";
import type { TriggerDocument } from "../../src/triggers/trigger-model.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";

const scope: LibraryScope = { library: "Hbr1", functions: new Map(), elements: new Map(), strings: new Map() };
const fn = (extra: object = {}) => LibraryFunctionSchema.parse({ id: "0000F000", name: "Moor", kind: "action", gui: "library/Moor.json", ...extra });
const libraryXml = (f: ReturnType<typeof fn>, body: ReturnType<typeof GuiBodySchema.parse>) => {
  const { itemLine, elements } = functionXml("Hbr1", f, body);
  return libraryTriggersFile("Hbr1", [itemLine], elements);
};

/** The Galaxy of a function holding one local variable of `type` with this literal as its initial value. */
const localGalaxy = (type: string, value: string): string => {
  const body = GuiBodySchema.parse({ variables: [{ id: "0000F100", name: "Slot", type: { type }, value: { id: "0000F101", type, value } }] });
  return functionGalaxy(scope, fn(), body).definition;
};

describe("rule: code on the <ScriptCode> tag line loads as empty", () => {
  it("is written as a block, the tag alone on its line, in a library function's Custom Script", () => {
    const body = GuiBodySchema.parse({ actions: [{ id: "0000F200", function: "Ntve/00000123", script: "libHbr1_gv_x = 1;\nlibHbr1_gv_y = 2;" }] });
    const xml = functionXml("Hbr1", fn(), body).elements.join("\n");

    expect(xml).toContain("            <ScriptCode>\n                libHbr1_gv_x = 1;\n                libHbr1_gv_y = 2;\n            </ScriptCode>");
    expect(xml).not.toMatch(/<ScriptCode>[^\s]/);
  });

  it("is written as a block for a one-line script", () => {
    const body = GuiBodySchema.parse({ actions: [{ id: "0000F210", function: "Ntve/00000123", script: "x = 1;" }] });

    expect(functionXml("Hbr1", fn(), body).elements.join("\n")).toContain("<ScriptCode>\n                x = 1;\n            </ScriptCode>");
  });

  it("is written as a block for the map's custom script item", () => {
    const xml = withCustomScript(undefined, "C5500002", "void A() {\n}", "A");

    expect(xml).toContain("<ScriptCode>\n            void A() {\n");
    expect(xml).not.toMatch(/<ScriptCode>[^\s]/);
  });

  it("reads back what it wrote", () => {
    const body = GuiBodySchema.parse({ actions: [{ id: "0000F220", function: "Ntve/00000123", script: "a = 1;\nb = 2;" }] });
    const read = readLibraryFunction(libraryXml(fn(), body), stringTable("FunctionDef/Name/lib_Hbr1_0000F000=Moor\n"), "Hbr1", "0000F000");

    expect(read.body?.actions).toEqual(body.actions);
  });
});

describe("rule: a literal-zero array bound collapses to a scalar", () => {
  // The Editor holds an array's size as <ArraySize Dim Value="…"/> or <ArraySize Dim Type="Variable"/>
  // naming a constant variable (the Nova, Swarm Story Util and thanson01 saves have both). None of
  // them has a zero size, so what the Editor writes for one isn't known: it is refused (#944).
  const strings = stringTable("FunctionDef/Name/lib_Hbr1_0000F000=Moor\nVariable/Name/lib_Hbr1_0000F300=Slots\n");

  it("doesn't arise: an array of a literal size or a constant's is read and written back as the Editor writes it", () => {
    for (const array of [[{ size: 3 }], [{ variable: "Hbr1/0000F301" }, { size: 4 }]]) {
      const body = GuiBodySchema.parse({ variables: [{ id: "0000F300", name: "Slots", type: { type: "int", array } }] });
      const xml = libraryXml(fn(), body);

      expect(readLibraryFunction(xml, strings, "Hbr1", "0000F000").body?.variables).toEqual(body.variables);
    }
    const xml = libraryXml(fn(), GuiBodySchema.parse({ variables: [{ id: "0000F300", name: "Slots", type: { type: "int", array: [{ variable: "Hbr1/0000F301" }, { size: 4 }] } }] }));
    expect(xml).toContain('<Type Value="int"/>\n                <ArraySize Dim="0" Type="Variable" Library="Hbr1" Id="0000F301"/>\n                <ArraySize Dim="1" Value="4"/>\n            </VariableType>');
  });

  it("is refused for a zero size, which no Editor save has, so such a function stays Kept as the Editor saved it", () => {
    const xml = libraryXml(fn(), GuiBodySchema.parse({ variables: [{ id: "0000F300", name: "Slots", type: { type: "int", array: [{ size: 1 }] } }] })).replace('Value="1"', 'Value="0"');

    expect(() => readLibraryFunction(xml, strings, "Hbr1", "0000F000")).toThrow(new UnconvertibleFunctionError("0000F000", "an array of size 0, which no Editor save has"));
  });
});

describe("rule: library functions are emitted before map globals", () => {
  it("is not applicable to a mod library: the Editor puts its globals in the _h header the .galaxy includes first, and we write functions only", () => {
    const { definition, declaration } = functionGalaxy(scope, fn(), GuiBodySchema.parse({}));

    expect(declaration).toBe("void libHbr1_gf_Moor ();");
    expect(definition).not.toMatch(/^\w+ libHbr1_gv_/m);
  });

  it("holds in the map script: libraries, globals, InitGlobals, then trigger functions", () => {
    const doc: TriggerDocument = {
      variables: [triggerVariable("v", "Seen", "bool", { kind: "bool", value: true })],
      triggers: [{ id: "AAAA1000", name: "Idle", events: [], actions: [wait("w", 1)] }],
    };
    const script = writeMapScript({ mapName: "Rules", triggers: doc });
    const at = (text: string): number => script.indexOf(text);

    expect(at("bool gv_seen;")).toBeGreaterThan(-1);
    expect(at("void InitLibs")).toBeLessThan(at("bool gv_seen;"));
    expect(at("bool gv_seen;")).toBeLessThan(at("void InitGlobals"));
    expect(at("void InitGlobals")).toBeLessThan(at("bool gt_Idle_Func"));
  });
});

describe('rule: a string initial value of "0", "false" or "null" is dropped', () => {
  // Only the unquoted literals are Galaxy's own defaults; a string's value is quoted text.
  it.each(["0", "false", "null", "0.0"])("is kept in a library function's local string: %s", (text) => {
    expect(localGalaxy("string", text)).toContain(`    lv_slot = "${text}";`);
  });

  it("leaves out the real defaults of an int, a fixed and a bool, and keeps any other", () => {
    expect(localGalaxy("int", "0")).not.toContain("lv_slot =");
    expect(localGalaxy("fixed", "0")).not.toContain("lv_slot =");
    expect(localGalaxy("bool", "false")).not.toContain("lv_slot =");
    expect(localGalaxy("int", "3")).toContain("    lv_slot = 3;");
  });

  it("is not reachable in the map script: its variable types have no string, and its defaults are unquoted", () => {
    const doc: TriggerDocument = {
      variables: [triggerVariable("a", "Count", "int", { kind: "int", value: 0 }), triggerVariable("b", "Hold", "timerwindow", { kind: "preset", preset: P.noTimerWindow })],
      triggers: [],
    };

    const script = writeMapScript({ mapName: "Rules", triggers: doc });

    expect(script).not.toContain("gv_count =");
    expect(script).toContain("gv_hold = c_timerWindowNone;");
  });
});

describe("rule: an implicit `trigger t` is not prepended in function bodies", () => {
  // The Editor writes a trigger parameter as a ParamDef like any other (libNCUI_gf_NU_UpgradesClosed (trigger t)),
  // so nothing is implicit. We write exactly the parameters a function declares.
  it("is not applicable: a function with no parameters has none, one with a trigger parameter has just that", () => {
    const none = functionGalaxy(scope, fn(), GuiBodySchema.parse({})).definition;
    const withTrigger = functionGalaxy(scope, fn({ parameters: [{ id: "0000F400", name: "T", type: { type: "trigger" } }] }), GuiBodySchema.parse({})).definition;

    expect(none.split("\n")[0]).toBe("void libHbr1_gf_Moor () {");
    expect(withTrigger.split("\n")[0]).toBe("void libHbr1_gf_Moor (trigger lp_t) {");
  });

  it("is not applicable to a trigger's own function, whose signature is fixed", () => {
    const script = writeMapScript({ mapName: "Rules", triggers: { variables: [], triggers: [{ id: "AAAA1001", name: "Idle", events: [], actions: [] }] } });

    expect(script).toContain("bool gt_Idle_Func (bool testConds, bool runActions) {");
    expect(script).not.toMatch(/\btrigger t\b/);
  });
});

describe("rule: named-library references need an explicit Library", () => {
  const refs = (xml: string): string[] => xml.match(/<(?!Element|Item|Root|TriggerData|Library)\w+ [^>]*\bId="[^"]*"[^>]*\/>/g) ?? [];

  it("holds in a library's Triggers: every reference, to its own elements too, names its Library", () => {
    const body = GuiBodySchema.parse({
      variables: [{ id: "0000F500", name: "Slot", type: { type: "int" }, value: { id: "0000F501", type: "int", value: "4" } }],
      actions: [{ id: "0000F510", function: "Ntve/00000136", params: [{ id: "0000F511", def: "Ntve/00000219", variable: "0000F500" }, { id: "0000F512", def: "Ntve/00000220", type: "int", value: "1" }] }],
    });
    const xml = functionXml("Hbr1", fn({ parameters: [{ id: "0000F520", name: "Mark", type: { type: "int" } }] }), body).elements.join("\n");
    const found = refs(xml);

    expect(found.length).toBeGreaterThan(5);
    expect(found.filter((ref) => !/\bLibrary="[A-Za-z0-9]+"/.test(ref))).toEqual([]);
  });

  it("holds in a map's Triggers: the game's elements name Ntve, the map's own none, as the Editor saves a map", () => {
    const doc: TriggerDocument = {
      variables: [triggerVariable("v", "Seen", "bool", { kind: "bool", value: false })],
      triggers: [{ id: "AAAA1002", name: "Idle", events: [], actions: [wait("w", 1, P.timeGame)] }],
    };
    const found = refs(writeTriggersXml(doc));

    for (const ref of found) expect(/Library="Ntve"/.test(ref), ref).toBe(/Type="(FunctionDef|ParamDef|PresetValue|Preset)"/.test(ref));
    expect(found.some((ref) => ref.includes('Type="Param" Id='))).toBe(true);
  });
});

describe('rule: <Constant/> goes inside <VariableType>; an initial value is <Value Type="Param"/>', () => {
  it("holds for the variables we write: the type inside <VariableType>, the initial value a Param reference", () => {
    const doc: TriggerDocument = { variables: [triggerVariable("v", "Count", "int", { kind: "int", value: 4 })], triggers: [] };
    const variable = doc.variables[0]!;
    const xml = writeTriggersXml(doc);

    expect(xml).toContain(`<Element Type="Variable" Id="${variable.id}">\r\n        <VariableType>\r\n            <Type Value="int"/>\r\n        </VariableType>\r\n        <Value Type="Param" Id="${variable.initial.id}"/>`);
    expect(xml).not.toContain("<Constant");
  });

  it("holds for a constant we write: <Constant/> follows <Type> inside <VariableType>, and reads back", () => {
    const body = GuiBodySchema.parse({ variables: [{ id: "0000F600", name: "Limit", type: { type: "int", constant: true }, value: { id: "0000F601", type: "int", value: "4" } }] });
    const xml = libraryXml(fn(), body);
    const strings = stringTable("FunctionDef/Name/lib_Hbr1_0000F000=Moor\nVariable/Name/lib_Hbr1_0000F600=Limit\n");

    expect(xml).toContain('<VariableType>\n                <Type Value="int"/>\n                <Constant/>\n            </VariableType>\n            <Value Type="Param" Library="Hbr1" Id="0000F601"/>');
    expect(readLibraryFunction(xml, strings, "Hbr1", "0000F000").body?.variables).toEqual(body.variables);
  });
});
