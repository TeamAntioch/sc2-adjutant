// Rules about how the Editor reads and writes Triggers and Galaxy (issue #738), each checked
// against our writers. The facts behind them are in docs/reference/editor-trigger-rules.md.
import { describe, expect, it } from "vitest";

import { GuiBodySchema, LibraryFunctionSchema } from "../../src/domain/library-interface.js";
import { functionGalaxy, type LibraryScope } from "../../src/mods/library-galaxy.js";
import { functionXml, libraryElements, libraryTriggersFile, readLibraryFunction, stringTable, UnconvertibleFunctionError } from "../../src/mods/library-xml.js";
import { withCustomScript } from "../../src/triggers/custom-script.js";
import { NTVE_PRESETS as P } from "../../src/triggers/trigger-catalog.js";
import { triggerVariable, wait } from "../../src/triggers/trigger-builders.js";
import type { TriggerCall, TriggerDocument } from "../../src/triggers/trigger-model.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";
import { authorTrigger } from "../../src/triggers/author-trigger.js";
import { blueprintTriggerXml, compileBlueprintTriggers, type KeptTriggers } from "../../src/triggers/blueprint-triggers.js";
import { BlueprintFunctionSchema } from "../../src/domain/blueprint-trigger.js";
import { KeptGalaxyRenderer } from "../../src/triggers/kept-trigger-galaxy.js";
import { CORE_PRIMITIVES, NTVE_FUNCTIONS as F } from "../../src/triggers/trigger-catalog.js";
import { readTriggersFile } from "../../src/triggers/triggers-file.js";
import { call, compare, stableElementId } from "../../src/triggers/trigger-builders.js";
import { cut } from "./authoring-cuts.js";

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

// The rules below (#45) are how the Editor reads Triggers that our writers rely on; each has the test
// that keeps them true. The facts behind them are in docs/reference/editor-trigger-rules.md.

/** A trigger written through the authoring tool among a cut's elements, as the Editor's names give it, and its elements' XML. */
async function authoredXml(input: Parameters<typeof authorTrigger>[0]): Promise<string> {
  const { files, libraries, map } = await cut("authored-trigger");
  const { trigger } = authorTrigger(input, { libraries, map, taken: readTriggersFile(files.triggers).ids });
  return blueprintTriggerXml(trigger).join("\n");
}

/** The `<Element Type="FunctionCall">` blocks of `xml` whose FunctionDef is `def`. */
const callsOf = (xml: string, def: string): string[] => xml.split("    <Element ").filter((block) => block.includes(`<FunctionDef Type="FunctionDef" Library="Ntve" Id="${def}"/>`));

describe("rule: a block slot is named by the slot, not the call that holds it", () => {
  const comparison = { function: "Comparison", params: { "Value 1": true, Operator: "==", "Value 2": true } };

  it("holds for an authored And: the call it holds carries Ntve/00000002", async () => {
    const xml = await authoredXml({ name: "Both", events: [{ function: "Periodic Event", params: { Duration: 2 } }], conditions: [{ function: "And", blocks: { Conditions: [comparison] } }], actions: [] });
    const [and] = callsOf(xml, "00000132");
    const [held] = callsOf(xml, "C439C375");

    expect(and).toBeDefined();
    expect(and).not.toContain("SubFunctionType");
    expect(held).toContain('<SubFunctionType Type="SubFuncType" Library="Ntve" Id="00000002"/>');
  });

  it("holds for an authored Or: the call it holds carries Ntve/00000001", async () => {
    const xml = await authoredXml({ name: "Either", events: [{ function: "Periodic Event", params: { Duration: 2 } }], conditions: [{ function: "Or", blocks: { Conditions: [comparison] } }], actions: [] });

    expect(xml).toContain('<SubFunctionType Type="SubFuncType" Library="Ntve" Id="00000001"/>');
    expect(xml).not.toContain('Id="00000002"/>\n        <Parameter');
  });
});

describe("rule: a Comment in a block slot carries the slot's SubFunctionType", () => {
  const body = (sub?: string) => GuiBodySchema.parse({ actions: [{ id: "0000F700", comment: "Gate", ...(sub ? { sub } : {}) }] });

  it("holds for a library function's comment in a slot, and not for one among its own statements", () => {
    const inSlot = functionXml("Hbr1", fn(), body("Ntve/00000004")).elements.join("\n");
    const loose = functionXml("Hbr1", fn(), body()).elements.join("\n");

    expect(inSlot).toContain('<Element Type="Comment" Id="0000F700">');
    expect(inSlot).toContain('<SubFunctionType Type="SubFuncType" Library="Ntve" Id="00000004"/>');
    expect(loose).not.toContain("SubFunctionType");
  });

  it("holds for a Blueprint trigger's comment in a block's slot", async () => {
    const xml = await authoredXml({ name: "Gate", events: [{ function: "Periodic Event", params: { Duration: 2 } }], actions: [{ function: "If Then Else", blocks: { Then: [{ comment: "Open" }] } }] });
    const comment = xml.split("    <Element ").find((block) => block.startsWith('Type="Comment"'));

    expect(comment).toContain('<SubFunctionType Type="SubFuncType" Library="Ntve" Id="00000004"/>');
  });
});

describe("rule: a comment's text is on its own indented line inside <Comment>", () => {
  it("holds for a library function's comment, a multi-line one a line each", () => {
    const body = GuiBodySchema.parse({ actions: [{ id: "0000F710", comment: "First\nSecond" }] });
    const xml = functionXml("Hbr1", fn(), body).elements.join("\n");

    expect(xml).toContain("            <Comment>\n                First\n                Second\n            </Comment>");
    expect(xml).not.toMatch(/<Comment>[^\s]/);
  });

  it("holds for a Blueprint trigger's comment", async () => {
    const xml = await authoredXml({ name: "Note", events: [{ function: "Periodic Event", params: { Duration: 2 } }], actions: [{ comment: "Wait here" }] });

    expect(xml).toContain("<Comment>\n            Wait here\n        </Comment>");
    expect(xml).not.toMatch(/<Comment>[^\s]/);
  });

  it("holds for a body comment, written as a FunctionCall of Type Comment in its parent's list", () => {
    const body = GuiBodySchema.parse({ actions: [{ id: "0000F711", comment: "Note" }] });

    expect(functionXml("Hbr1", fn(), body).elements.join("\n")).toContain('<FunctionCall Type="Comment" Library="Hbr1" Id="0000F711"/>');
  });
});

describe("rule: a call's parameters are saved in any order; match by ParameterDef", () => {
  // Wait (Ntve/00000242) holds its Time (419) and Time Type (420); the saves list a call's parameters in either order.
  const waitXml = (parameters: readonly string[]): string =>
    [
      "<TriggerData>",
      '    <Element Type="FunctionDef" Id="E0000001">',
      "        <FlagAction/>",
      '        <FunctionCall Type="FunctionCall" Id="E0000003"/>',
      "    </Element>",
      '    <Element Type="FunctionCall" Id="E0000003">',
      '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000242"/>',
      ...parameters.map((id) => `        <Parameter Type="Param" Id="${id}"/>`),
      "    </Element>",
      '    <Element Type="Param" Id="E0000004">',
      '        <ParameterDef Type="ParamDef" Library="Ntve" Id="00000419"/>',
      "        <Value>1.0</Value>",
      '        <ValueType Type="fixed"/>',
      "    </Element>",
      '    <Element Type="Param" Id="E0000005">',
      '        <ParameterDef Type="ParamDef" Library="Ntve" Id="00000420"/>',
      '        <Preset Type="PresetValue" Library="Ntve" Id="00000546"/>',
      "    </Element>",
      "</TriggerData>",
    ].join("\r\n");
  const render = (xml: string) => {
    const renderer = new KeptGalaxyRenderer(readTriggersFile(xml), new Map([["FunctionDef/E0000001", "Pause"]]), CORE_PRIMITIVES);
    return { galaxy: renderer.renderFunction("E0000001"), unknown: renderer.unknown };
  };

  it("renders a call whose parameters are listed in the reverse of the function's order as it does the usual order", () => {
    const usual = render(waitXml(["E0000004", "E0000005"]));
    const reversed = render(waitXml(["E0000005", "E0000004"]));

    expect(usual.unknown).toEqual([]);
    expect(usual.galaxy).toContain("Wait(1.0,");
    expect(reversed).toEqual(usual);
  });
});

describe("rule: a FunctionDef is filed in Root or a Category, never unfiled", () => {
  it("holds for a library function: its item line files it, and names its Id", () => {
    const { itemLine, elements } = functionXml("Hbr1", fn(), GuiBodySchema.parse({}));

    expect(itemLine.trim()).toBe('<Item Type="FunctionDef" Library="Hbr1" Id="0000F000"/>');
    expect(libraryTriggersFile("Hbr1", [itemLine], elements)).toContain(`<Root>\n${itemLine}\n        </Root>`);
  });

  it("holds for a Blueprint function with no folder: Root files it, beside each FunctionDef the compile writes", () => {
    const fnItem = BlueprintFunctionSchema.parse({ kind: "function", id: "0000F800", name: "Reset", functionKind: "action" });
    const empty = { triggers: writeTriggersXml({ variables: [], triggers: [] }), script: writeMapScript({ mapName: "Test", triggers: { variables: [], triggers: [] } }), names: {} };
    const kept: KeptTriggers = { triggers: empty.triggers, names: new Map(), compiled: new Set() };
    const { triggers } = compileBlueprintTriggers({ triggers: [], functions: [{ file: "triggers/reset.json", fn: fnItem }], folders: [] }, empty, { kept });
    const defined = [...triggers.matchAll(/<Element Type="FunctionDef" Id="([0-9A-F]{8})"/g)].map((match) => match[1]);
    const filed = [...triggers.matchAll(/<Item Type="FunctionDef" Id="([0-9A-F]{8})"\/>/g)].map((match) => match[1]);

    expect(defined).toContain("0000F800");
    expect(filed.sort()).toEqual(defined.sort());
  });
});

describe("rule: one call element, one parent", () => {
  const shared = (): TriggerCall => call("shared/picked", F.pickedUnit, {});
  const twoParams = (value: TriggerCall): TriggerDocument => ({
    variables: [],
    triggers: [{ id: "AAAA2001", name: "Twice", events: [], actions: [call("act", F.comparison, { left: { kind: "call", call: value }, operator: { kind: "preset", preset: P.compareEqual }, right: { kind: "call", call: value } })] }],
  });

  it("is refused in writeTriggersXml where two parameters point at one call, naming the Id and both parents", () => {
    const value = shared();
    const action = call("act", F.comparison, {});

    expect(() => writeTriggersXml(twoParams(value))).toThrow(
      `The call ${value.id} is referenced from two places, the parameter ${stableElementId("act/left/param")} of the call ${action.id} and the parameter ${stableElementId("act/right/param")} of the call ${action.id}: the Editor gives a call one parent, and writes an empty argument where two share one`,
    );
  });

  it("is refused where a call is both a trigger's action and a parameter's value", () => {
    const value = shared();
    const doc: TriggerDocument = { variables: [], triggers: [{ id: "AAAA2002", name: "Both", events: [], actions: [value, compare("act", { kind: "call", call: value }, P.compareEqual, { kind: "bool", value: true })] }] };

    expect(() => writeTriggersXml(doc)).toThrow(/is referenced from two places, the trigger AAAA2002 and the parameter/);
  });

  it("writes a call of its own in each place", () => {
    const doc = twoParams(shared());
    const action = doc.triggers[0]!.actions[0]!;
    const right = { ...action, params: { ...action.params, right: { id: action.params.right!.id, value: { kind: "call" as const, call: call("other/picked", F.pickedUnit, {}) } } } };

    expect(() => writeTriggersXml({ ...doc, triggers: [{ ...doc.triggers[0]!, actions: [right] }] })).not.toThrow();
  });
});
