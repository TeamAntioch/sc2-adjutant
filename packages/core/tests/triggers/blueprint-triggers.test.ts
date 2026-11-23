// A Mission Blueprint's own trigger elements (ADR-0026), compiled beside Kept content: the Triggers
// XML and the Galaxy they compile to are the Editor's, checked against a trigger cut from an Editor
// save (fixtures/editor-triggers/authored-trigger, Heart of the Swarm's zspace01) whose body is
// transcribed as Blueprint data (fixtures/blueprint-triggers/acquire-target.json).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BlueprintTriggerSchema, type BlueprintTrigger } from "../../src/domain/blueprint-trigger.js";
import { type GameLibrary, gameTriggerLibraries } from "../../src/mods/library-galaxy.js";
import { compileBlueprintTriggers, type KeptTriggers } from "../../src/triggers/blueprint-triggers.js";
import { triggerStringNames } from "../../src/triggers/triggers-file.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";

const read = (file: string): string => readFileSync(fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url)), "utf8");
const crlf = (text: string): string => text.replace(/\r?\n/g, "\r\n");

const saved = read("editor-triggers/authored-trigger/Triggers");
const savedScript = read("editor-triggers/authored-trigger/MapScript.galaxy");
const transcribed = (): BlueprintTrigger => BlueprintTriggerSchema.parse(JSON.parse(read("blueprint-triggers/acquire-target.json")));

/** The trigger's elements in the save: from its Trigger element to the next item's. */
const triggerStart = saved.indexOf('    <Element Type="Trigger" Id="7611B84F">');
const triggerEnd = saved.indexOf('    <Element Type="FunctionDef" Id="EDA10F5E">');
const savedElements = saved.slice(triggerStart, triggerEnd);

/** The save with the trigger taken out: its Kept global and functions, which the Blueprint trigger names by Id. */
const kept: KeptTriggers = {
  triggers: saved.slice(0, triggerStart).replace('        <Item Type="Trigger" Id="7611B84F"/>\n', "") + saved.slice(triggerEnd),
  names: triggerStringNames(read("editor-triggers/authored-trigger/TriggerStrings.txt")),
  compiled: new Set(),
};

/** The compile's own files, with no trigger of a concept's. */
const empty = { triggers: writeTriggersXml({ variables: [], triggers: [] }), script: writeMapScript({ mapName: "Test", triggers: { variables: [], triggers: [] } }), names: {} };

describe("a Blueprint trigger cut from an Editor save", () => {
  it("compiles to the save's Triggers XML: its elements in the order the Editor reaches them, filed in Root", () => {
    const { triggers } = compileBlueprintTriggers({ triggers: [{ file: "triggers/acquire-target.json", trigger: transcribed() }], folders: [] }, empty, { kept });
    expect(triggers).toContain(crlf(savedElements));
    expect(triggers).toContain('        <Item Type="Trigger" Id="7611B84F"/>\r\n    </Root>');
  });

  it("compiles to the save's Galaxy, calling the Kept functions and reading the Kept global by their Ids", () => {
    const { script } = compileBlueprintTriggers({ triggers: [{ file: "triggers/acquire-target.json", trigger: transcribed() }], folders: [] }, empty, { kept });
    const section = savedScript.slice(savedScript.indexOf("//--------------------------------------------------------------------------------------------------\n// Trigger: "));
    expect(script).toContain(crlf(section));
    expect(script).toContain("trigger gt_HyperionFighterAcquireTarget;\r\n");
    expect(script).toContain("void InitTriggers () {\r\n    gt_HyperionFighterAcquireTarget_Init();\r\n}");
  });

  it("files the trigger in its Blueprint folder, named in TriggerStrings", () => {
    const folder = { id: "5A5A0001", name: "Fighters", label: "Ntve/00000017", items: ["trigger:7611B84F"] };
    const { triggers, triggerStrings } = compileBlueprintTriggers({ triggers: [{ file: "triggers/acquire-target.json", trigger: transcribed() }], folders: [folder] }, empty, { kept });
    expect(triggers).toContain('        <Item Type="Category" Id="5A5A0001"/>\r\n    </Root>');
    expect(triggers).toContain('    <Element Type="Category" Id="5A5A0001">\r\n        <Label Type="Label" Library="Ntve" Id="00000017"/>\r\n        <Item Type="Trigger" Id="7611B84F"/>\r\n    </Element>\r\n    <Element Type="Trigger" Id="7611B84F">');
    expect(triggerStrings["Category/Name/5A5A0001"]).toBe("Fighters");
  });

  it("names the trigger and its local variable in TriggerStrings", () => {
    const { triggerStrings } = compileBlueprintTriggers({ triggers: [{ file: "triggers/acquire-target.json", trigger: transcribed() }], folders: [] }, empty, { kept });
    expect(triggerStrings).toEqual({ "Trigger/Name/7611B84F": "Hyperion Fighter Acquire Target", "Variable/Name/1874A127": "TargetGroup" });
  });
});

describe("a global variable the Blueprint declares", () => {
  /** The save's global, its initial value and the call giving it, as Blueprint data. */
  const global = { id: "863AD0ED", name: "HyperionFighterGroup", type: { type: "unitgroup" }, value: { id: "07F9EB02", call: { id: "35500CDF", function: "Ntve/00000104" } } };
  const globalStart = saved.indexOf('    <Element Type="Variable" Id="863AD0ED">');
  const globalEnd = saved.indexOf('    <Element Type="FunctionDef" Id="82A32553">');
  /** The save with the trigger and the global taken out: the Kept functions alone. */
  const cut = (text: string): string => text.slice(0, text.indexOf('    <Element Type="Variable" Id="863AD0ED">')) + text.slice(text.indexOf('    <Element Type="FunctionDef" Id="82A32553">'));
  const functionsOnly: KeptTriggers = { ...kept, triggers: cut(kept.triggers).replace('        <Item Type="Variable" Id="863AD0ED"/>\n', "") };
  const compileBoth = () => compileBlueprintTriggers({ triggers: [{ file: "triggers/acquire-target.json", trigger: transcribed() }], variables: [global], folders: [] }, empty, { kept: functionsOnly });

  it("compiles to the save's Triggers XML, filed in Root, and the trigger names it by its Id", () => {
    const { triggers, triggerStrings } = compileBoth();
    expect(triggers).toContain(crlf(saved.slice(globalStart, globalEnd)));
    expect(triggers).toContain('        <Item Type="Variable" Id="863AD0ED"/>\r\n        <Item Type="Trigger" Id="7611B84F"/>\r\n    </Root>');
    expect(triggerStrings["Variable/Name/863AD0ED"]).toBe("HyperionFighterGroup");
  });

  it("compiles to the save's declaration and initialization, in a Global Variables section the compile's script lacked", () => {
    const { script } = compileBoth();
    expect(script).toContain("// Global Variables\r\n//--------------------------------------------------------------------------------------------------\r\nunitgroup gv_hyperionFighterGroup;\r\n\r\nvoid InitGlobals () {\r\n    gv_hyperionFighterGroup = UnitGroupEmpty();\r\n}\r\n");
    expect(script).toContain("    InitLibs();\r\n    InitGlobals();\r\n    InitTriggers();\r\n");
    expect(script).toContain("        if (!((UnitGroupHasUnit(gv_hyperionFighterGroup, EventUnit()) == true))) {\r\n");
  });
});

describe("a Blueprint trigger that can't be compiled", () => {
  const compile = (trigger: BlueprintTrigger, generated = empty, libraries = gameTriggerLibraries()): unknown => {
    try {
      compileBlueprintTriggers({ triggers: [{ file: "triggers/acquire-target.json", trigger }], folders: [] }, generated, { kept, libraries });
    } catch (error) {
      return (error as Error).message;
    }
    return undefined;
  };
  const named = 'the Blueprint trigger "Hyperion Fighter Acquire Target" (7611B84F, triggers/acquire-target.json)';

  it("is refused for a call to a function no library in reach defines", () => {
    const message = compile({ ...transcribed(), actions: [{ id: "0BAD0001", function: "Ntve/0BADF00D" }] });
    expect(message).toContain(`${named} calls Ntve/0BADF00D, which is out of reach: the library Ntve has no FunctionDef 0BADF00D`);
  });

  it("is refused for a call into a library the map doesn't reach", () => {
    const message = compile({ ...transcribed(), actions: [{ id: "0BAD0001", function: "Cmpn/0000AAAA" }] });
    expect(message).toContain(`${named} calls Cmpn/0000AAAA, which is out of reach: the library Cmpn isn't in reach of the map`);
  });

  it("is refused for a map function or global the package doesn't keep", () => {
    const message = compile({
      ...transcribed(),
      actions: [
        { id: "0BAD0001", function: "0BADF00D" },
        { id: "0BAD0002", function: "Ntve/00000136", params: [{ id: "0BAD0003", def: "Ntve/00000219", variable: "0BADBEEF" }, { id: "0BAD0004", def: "Ntve/00000220", type: "bool", value: "true" }] },
      ],
    });
    expect(message).toContain(`${named} calls 0BADF00D, which is out of reach: the map has no Kept FunctionDef 0BADF00D`);
    expect(message).toContain(`${named} names the variable 0BADBEEF, which is neither its own nor a Blueprint or Kept global`);
  });

  /** Set Variable of a library's global's member to true. */
  const setsLibraryMember = (global: string, member: string): BlueprintTrigger => ({
    ...transcribed(),
    actions: [{ id: "0BAD0002", function: "Ntve/00000136", params: [{ id: "0BAD0003", def: "Ntve/00000219", variable: global, member: { id: "0BAD0005", variable: member } }, { id: "0BAD0004", def: "Ntve/00000220", type: "bool", value: "true" }] }],
  });
  /** A mod library in reach holding a global of the structure Cmpn/AAAA0001, its member, and a member of another structure. */
  const cmpn: GameLibrary = {
    functions: {},
    params: {},
    presetValues: {},
    presets: {},
    subFunctions: {},
    variables: {
      AAAA0010: { galaxy: "libCmpn_gv_heroUnit", type: { type: "struct", element: "Cmpn/AAAA0001" } },
      AAAA0011: { galaxy: "lv_artanis", member: true, structure: "Cmpn/AAAA0001", type: { type: "bool" } },
      AAAA0021: { galaxy: "lv_chosenDifficulty", member: true, structure: "Cmpn/AAAA0002", type: { type: "bool" } },
    },
  };

  it("is refused for a library's global when the library is out of reach, naming the global and its library", () => {
    const message = compile(setsLibraryMember("Cmpn/AAAA0010", "Cmpn/AAAA0011"));
    expect(message).toContain(`${named} names the variable Cmpn/AAAA0010, which is out of reach: the library Cmpn isn't in reach of the map`);
  });

  it("is refused for a global or a structure member its library in reach doesn't hold, or a member of another structure", () => {
    const libraries = { ...gameTriggerLibraries(), Cmpn: cmpn };
    expect(compile(setsLibraryMember("Cmpn/0BADF00D", "Cmpn/AAAA0011"), empty, libraries)).toContain(`${named} names the variable Cmpn/0BADF00D, which is out of reach: the library Cmpn has no global variable 0BADF00D`);
    expect(compile(setsLibraryMember("Cmpn/AAAA0011", "Cmpn/AAAA0011"), empty, libraries)).toContain(`${named} names the variable Cmpn/AAAA0011, which is out of reach: the library Cmpn has no global variable AAAA0011`);
    expect(compile(setsLibraryMember("Cmpn/AAAA0010", "Cmpn/AAAA0021"), empty, libraries)).toContain(`${named} names the structure member Cmpn/AAAA0021, which is out of reach: it is a member of the structure Cmpn/AAAA0002, not of Cmpn/AAAA0001, which the variable before it holds`);
  });

  it("compiles a library's global and its member, named in Galaxy as its library names them", () => {
    const { script } = compileBlueprintTriggers({ triggers: [{ file: "triggers/acquire-target.json", trigger: setsLibraryMember("Cmpn/AAAA0010", "Cmpn/AAAA0011") }], folders: [] }, empty, { kept, libraries: { ...gameTriggerLibraries(), Cmpn: cmpn } });
    expect(script).toContain("    libCmpn_gv_heroUnit.lv_artanis = true;\r\n");
  });

  it("is refused for an element Id a Kept element has", () => {
    const message = compile({ ...transcribed(), actions: [{ id: "863AD0ED", function: "Ntve/00000092" }] });
    expect(message).toContain(`${named} gives the element Id 863AD0ED, which the Kept Variable 863AD0ED in Triggers has`);
  });

  it("is refused for an element Id one of the compile's own elements has", () => {
    const generated = { ...empty, triggers: empty.triggers.replace("</TriggerData>", '    <Element Type="Trigger" Id="1874A127">\r\n    </Element>\r\n</TriggerData>') };
    expect(compile(transcribed(), generated)).toContain(`${named} gives the element Id 1874A127, which one of the compile's own elements has`);
  });

  it("is refused for a trigger, global or function a concept compiles to, pointing to the Blueprint's cues", () => {
    const generated = {
      ...empty,
      triggers: empty.triggers.replace(
        "</TriggerData>",
        '    <Element Type="Trigger" Id="1874A127">\r\n    </Element>\r\n    <Element Type="Variable" Id="1874A128">\r\n    </Element>\r\n    <Element Type="FunctionDef" Id="1874A129">\r\n    </Element>\r\n</TriggerData>',
      ),
      names: { "Trigger/Name/1874A127": "Beat - Arrive", "Variable/Name/1874A128": "Wave Count" },
    };
    const message = compile(
      {
        ...transcribed(),
        actions: [
          { id: "0BAD0001", function: "Ntve/00000116", params: [{ id: "0BAD0002", def: "Ntve/00000182", trigger: "1874A127" }] },
          { id: "0BAD0003", function: "Ntve/00000136", params: [{ id: "0BAD0004", def: "Ntve/00000219", variable: "1874A128" }, { id: "0BAD0005", def: "Ntve/00000220", type: "int", value: "1" }] },
          { id: "0BAD0006", function: "1874A129" },
        ],
      },
      generated,
    );
    const cues = "react to it through a cue instead: hold this trigger until the cue (a Kept Reference's hold.until), or start a Beat on its run (keptTriggerRuns)";
    expect(message).toContain(`${named} names the trigger 1874A127 ("Beat - Arrive"), which the compile writes for a Blueprint concept and may change: ${cues}`);
    expect(message).toContain(`${named} names the variable 1874A128 ("Wave Count"), which the compile writes for a Blueprint concept and may change: ${cues}`);
    expect(message).toContain(`${named} calls 1874A129, which the compile writes for a Blueprint concept and may change: ${cues}`);
  });

  it("is refused for a preset type no library in reach defines", () => {
    const message = compile({ ...transcribed(), variables: [{ id: "0BAD0001", name: "Mode", type: { type: "preset", element: "Ntve/0BADF00D" } }] });
    expect(message).toContain(`${named} declares a variable of the preset type Ntve/0BADF00D, which is out of reach: the library Ntve has no Preset 0BADF00D`);
  });

  it("is refused for a Galaxy name a Kept trigger has", () => {
    const keptTrigger = kept.triggers.replace("</TriggerData>", '    <Element Type="Trigger" Id="0A0A0001">\n    </Element>\n</TriggerData>').replace("    </Root>", '        <Item Type="Trigger" Id="0A0A0001"/>\n    </Root>');
    const names = new Map([...kept.names, ["Trigger/0A0A0001", "Hyperion Fighter Acquire Target"]]);
    let message: string | undefined;
    try {
      compileBlueprintTriggers({ triggers: [{ file: "triggers/acquire-target.json", trigger: transcribed() }], folders: [] }, empty, { kept: { ...kept, triggers: keptTrigger, names } });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(`${named} would be gt_HyperionFighterAcquireTarget in Galaxy, which the Kept Trigger 0A0A0001 already is`);
  });

  it("is refused for an Id it gives twice", () => {
    const message = compile({ ...transcribed(), actions: [{ id: "3C30F180", function: "Ntve/00000092" }] });
    expect(message).toContain(`${named} gives the element Id 3C30F180, which it gives twice`);
  });
});
