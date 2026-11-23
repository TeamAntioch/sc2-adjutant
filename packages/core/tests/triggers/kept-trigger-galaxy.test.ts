// Rendering a Kept function's Galaxy from its XML in Triggers (ADR-0010): a form the renderer can't
// vouch for is listed as unknown, so the function isn't tuned.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { GameLibrary } from "../../src/mods/library-galaxy.js";
import { librariesInReach } from "../../src/mods/library-reach.js";
import { bindLibraryNames, KeptGalaxyRenderer } from "../../src/triggers/kept-trigger-galaxy.js";
import { keptElementSpan } from "../../src/triggers/splice-map-script.js";
import { CORE_PRIMITIVES, type FunctionDef } from "../../src/triggers/trigger-catalog.js";
import { elementOf, readTriggersFile, triggerStringNames } from "../../src/triggers/triggers-file.js";

/** A file of the `shared-ids` fixture, cut from Liberty's thanson01: an older save, which numbers each element type apart. */
const sharedIds = (file: string): Promise<string> => readFile(new URL(`../fixtures/editor-triggers/shared-ids/${file}`, import.meta.url), "utf8");

/** An action function with one If Then Else whose conditions are `conditions` (element lines), and a Wait in its Then. */
const ifFunction = (conditions: readonly string[]): string =>
  [
    "<TriggerData>",
    '    <Element Type="FunctionDef" Id="E0000001">',
    "        <FlagAction/>",
    '        <FunctionCall Type="FunctionCall" Id="E0000002"/>',
    "    </Element>",
    '    <Element Type="FunctionCall" Id="E0000002">',
    '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000137"/>',
    ...conditions.map((id) => `        <FunctionCall Type="FunctionCall" Id="${id}"/>`),
    '        <FunctionCall Type="FunctionCall" Id="E0000003"/>',
    "    </Element>",
    '    <Element Type="FunctionCall" Id="E0000003">',
    '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000242"/>',
    '        <SubFunctionType Type="SubFuncType" Library="Ntve" Id="00000004"/>',
    '        <Parameter Type="Param" Id="E0000004"/>',
    '        <Parameter Type="Param" Id="E0000005"/>',
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
    // A disabled condition, which the Galaxy leaves out.
    '    <Element Type="FunctionCall" Id="E0000006">',
    '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="C439C375"/>',
    '        <SubFunctionType Type="SubFuncType" Library="Ntve" Id="00000003"/>',
    "        <Disabled/>",
    "    </Element>",
    "</TriggerData>",
  ].join("\r\n");

describe("a Kept If Then Else", () => {
  it("with no enabled conditions isn't rendered, since `if ()` isn't Galaxy", () => {
    for (const conditions of [[], ["E0000006"]]) {
      const renderer = new KeptGalaxyRenderer(readTriggersFile(ifFunction(conditions)), new Map([["FunctionDef/E0000001", "Check"]]), CORE_PRIMITIVES);

      expect(renderer.renderFunction("E0000001")).toBeUndefined();
      expect(renderer.unknown).toContainEqual({ kind: "form", key: "its IfThenElse E0000002 has no enabled conditions in if, whose Galaxy isn't known" });
    }
  });
});

describe("an older map whose element types share Ids", () => {
  const renderer = async (): Promise<KeptGalaxyRenderer> =>
    new KeptGalaxyRenderer(readTriggersFile(await sharedIds("Triggers")), triggerStringNames(await sharedIds("TriggerStrings.txt")), CORE_PRIMITIVES);

  it("holds each element by its type and Id, so a Trigger, a Variable and a FunctionCall can all be 00000029", async () => {
    const file = readTriggersFile(await sharedIds("Triggers"));

    expect(["Trigger", "Variable", "FunctionCall"].map((type) => elementOf(file, type, "00000029")?.type)).toEqual(["Trigger", "Variable", "FunctionCall"]);
    expect(file.ids.has("00000029")).toBe(true);
  });

  it("names the Trigger and the Variable that share an Id each as the Editor's script does", async () => {
    const kept = await renderer();

    expect(kept.triggerName("00000029")).toBe("gt_Init05Environment");
    // Marine Constant Respawn's condition parameter, whose value is the Variable 00000029.
    expect(kept.value("1DFE71D6")).toBe("gv_gameOver");
    expect(kept.unknown).toEqual([]);
    expect((await sharedIds("MapScript.galaxy")).split("\n")).toEqual(expect.arrayContaining(["trigger gt_Init05Environment;", "bool gv_gameOver;"]));
  });

  it("renders a trigger whose calls, parameters and variables share Ids with other types as the Editor saved it", async () => {
    const kept = await renderer();
    const script = await sharedIds("MapScript.galaxy");
    const span = keptElementSpan(script, "gt_MainObjectiveSaveColonistsComplete")!;

    const rendered = kept.renderTrigger("00000046");

    expect(kept.unknown).toEqual([]);
    expect(bindLibraryNames(rendered!, script.slice(span.start, span.end).replace(/\r?\n/g, "\r\n"))).toEqual(new Map([["Camp/E9E50921", "libCamp_gv_campaignObjectiveDelay"]]));
  });

  it("writes nothing for a comment among a trigger's events, though a call has its Id", async () => {
    const triggers = await sharedIds("Triggers");
    const names = triggerStringNames(await sharedIds("TriggerStrings.txt"));
    // A comment first among the events, as thanson01's C8E8E1B9 has one, with the Id of Comment 00000030, which FunctionCall 00000030 has too.
    const withComment = triggers.replace('    <Element Type="Trigger" Id="00000046">\n', '    <Element Type="Trigger" Id="00000046">\n        <Event Type="Comment" Id="00000030"/>\n');
    expect(withComment).not.toBe(triggers);

    const kept = new KeptGalaxyRenderer(readTriggersFile(withComment), names, CORE_PRIMITIVES);

    expect(kept.renderTrigger("00000046")).toBe((await renderer()).renderTrigger("00000046"));
  });
});

/** A file of the `template-fallback` fixture, cut from Liberty's thanson01: triggers that call game functions core's catalog doesn't wrap. */
const fallback = (file: string): Promise<string> => readFile(new URL(`../fixtures/editor-triggers/template-fallback/${file}`, import.meta.url), "utf8");

describe("a Kept trigger that calls a game function the catalog doesn't wrap", () => {
  /** The trigger rendered, and the Editor's section for it. */
  const rendered = async (id: string, name: string) => {
    const kept = new KeptGalaxyRenderer(readTriggersFile(await fallback("Triggers")), triggerStringNames(await fallback("TriggerStrings.txt")), CORE_PRIMITIVES);
    const script = await fallback("MapScript.galaxy");
    const span = keptElementSpan(script, name)!;
    const text = kept.renderTrigger(id);
    return { unknown: kept.unknown, text, saved: script.slice(span.start, span.end).replace(/\r?\n/g, "\r\n") };
  };

  it("writes an Action Queue (ActionQueueAdd) from its template, its actions from the catalog", async () => {
    const { unknown, text, saved } = await rendered("A95E8816", "gt_VictoryQ");

    expect(unknown).toEqual([]);
    expect(text).toBe(saved);
  });

  it("writes an Or of conditions from its template, and an event the catalog lacks bound to the trigger", async () => {
    const { unknown, text, saved } = await rendered("282C0622", "gt_PlayerIsInCombat");

    expect(unknown).toEqual([]);
    expect(text).toBe(saved);
  });

  it("doesn't write an event's unit given as a call, which no Editor save shows as a unit reference", () => {
    // TriggerAddEventUnitStartedAttack takes a reference to a unit: saves show a variable's (UnitRefFromVariable) and a placed unit's, not a call's.
    const file = [
      "<TriggerData>",
      '    <Element Type="Trigger" Id="E0000001">',
      '        <Event Type="FunctionCall" Id="E0000002"/>',
      "    </Element>",
      '    <Element Type="FunctionCall" Id="E0000002">',
      '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="B81FF416"/>',
      '        <Parameter Type="Param" Id="E0000003"/>',
      "    </Element>",
      '    <Element Type="Param" Id="E0000003">',
      '        <ParameterDef Type="ParamDef" Library="Ntve" Id="1771F2F3"/>',
      '        <FunctionCall Type="FunctionCall" Id="E0000004"/>',
      "    </Element>",
      '    <Element Type="FunctionCall" Id="E0000004">',
      '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000076"/>',
      "    </Element>",
      "</TriggerData>",
    ].join("\r\n");
    const kept = new KeptGalaxyRenderer(readTriggersFile(file), new Map([["Trigger/E0000001", "Attack"]]), CORE_PRIMITIVES);

    expect(kept.renderTrigger("E0000001")).toBeUndefined();
    expect(kept.unknown).toContainEqual({ kind: "form", key: "a unit an event takes that isn't a variable's or a placed unit's, whose Galaxy this doesn't write yet" });
  });

  it("writes a Repeat from its template, its constant count declared const with its variable, and the game functions among its actions from theirs", async () => {
    const { unknown, text, saved } = await rendered("48762FB3", "gt_VictoryAction");

    expect(unknown).toEqual([]);
    expect(text).toBe(saved);
  });
});

describe("a Kept call to a primitive with Galaxy of its own", () => {
  it("isn't written when it holds calls in its slots, which that Galaxy, a call from its arguments, would drop", () => {
    // A Plugin's primitive (a test-only id), as a Mechanic contributes one.
    const ring: FunctionDef = { library: "Ntve", id: "BEAC0001", kind: "action", params: {}, galaxy: () => "BeaconRing()" };
    const catalog = { ...CORE_PRIMITIVES, functions: new Map([...CORE_PRIMITIVES.functions, ["Ntve/BEAC0001", ring]]) };
    const file = (held: readonly string[]): string =>
      [
        "<TriggerData>",
        '    <Element Type="Trigger" Id="E0000001">',
        '        <Action Type="FunctionCall" Id="E0000002"/>',
        "    </Element>",
        '    <Element Type="FunctionCall" Id="E0000002">',
        '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="BEAC0001"/>',
        ...held,
        "    </Element>",
        '    <Element Type="FunctionCall" Id="E0000003">',
        '        <FunctionDef Type="FunctionDef" Library="Ntve" Id="C439C375"/>',
        '        <SubFunctionType Type="SubFuncType" Library="Ntve" Id="00000004"/>',
        "    </Element>",
        "</TriggerData>",
      ].join("\r\n");

    const plain = new KeptGalaxyRenderer(readTriggersFile(file([])), new Map([["Trigger/E0000001", "Ring"]]), catalog);
    expect(plain.renderTrigger("E0000001")).toContain("    BeaconRing();");

    const holding = new KeptGalaxyRenderer(readTriggersFile(file(['        <FunctionCall Type="FunctionCall" Id="E0000003"/>'])), new Map([["Trigger/E0000001", "Ring"]]), catalog);
    expect(holding.renderTrigger("E0000001")).toBeUndefined();
    expect(holding.unknown).toContainEqual({ kind: "form", key: "a call E0000002 to Ntve/BEAC0001 holding calls, which its own galaxy doesn't write" });

    // A disabled call held there has no Galaxy to drop.
    const disabled = file(['        <FunctionCall Type="FunctionCall" Id="E0000003"/>']).replace('Id="00000004"/>', 'Id="00000004"/>\r\n        <Disabled/>');
    const holdingDisabled = new KeptGalaxyRenderer(readTriggersFile(disabled), new Map([["Trigger/E0000001", "Ring"]]), catalog);
    expect(holdingDisabled.renderTrigger("E0000001")).toContain("    BeaconRing();");
  });
});

/** A file of the `three-conditions` fixture, cut from Liberty's thanson01: a trigger with three conditions. */
const threeConditions = (file: string): Promise<string> => readFile(new URL(`../fixtures/editor-triggers/three-conditions/${file}`, import.meta.url), "utf8");

describe("a Kept trigger with several conditions", () => {
  it("writes a blank line between its conditions and none after the last, as the Editor saved it", async () => {
    const kept = new KeptGalaxyRenderer(readTriggersFile(await threeConditions("Triggers")), triggerStringNames(await threeConditions("TriggerStrings.txt")), CORE_PRIMITIVES);
    const script = await threeConditions("MapScript.galaxy");
    const span = keptElementSpan(script, "gt_AddConvoyMarineintoUnitGroup")!;

    const text = kept.renderTrigger("49030CDB");

    expect(kept.unknown).toEqual([]);
    expect(text).toBe(script.slice(span.start, span.end).replace(/\r?\n/g, "\r\n"));
  });

  it("writes one blank line between the live conditions either side of a comment, and nothing for the comment", async () => {
    const commentCondition = (file: string): Promise<string> => readFile(new URL(`../fixtures/editor-triggers/comment-condition/${file}`, import.meta.url), "utf8");
    const kept = new KeptGalaxyRenderer(readTriggersFile(await commentCondition("Triggers")), triggerStringNames(await commentCondition("TriggerStrings.txt")), CORE_PRIMITIVES);
    const script = await commentCondition("MapScript.galaxy");
    const span = keptElementSpan(script, "gt_WaveShadowFX")!;

    const text = kept.renderTrigger("7CCCC77A");

    expect(kept.unknown).toEqual([]);
    expect(text).toBe(script.slice(span.start, span.end).replace(/\r?\n/g, "\r\n"));
  });
});

/** A file of the `indexed-values` fixture, cut from Liberty's thanson01: triggers that index an array global. */
const indexedValues = (file: string): Promise<string> => readFile(new URL(`../fixtures/editor-triggers/indexed-values/${file}`, import.meta.url), "utf8");

describe("a Kept trigger that indexes an array variable", () => {
  /** The trigger rendered, and the Editor's section for it. */
  const rendered = async (id: string, name: string) => {
    const kept = new KeptGalaxyRenderer(readTriggersFile(await indexedValues("Triggers")), triggerStringNames(await indexedValues("TriggerStrings.txt")), CORE_PRIMITIVES);
    const script = await indexedValues("MapScript.galaxy");
    const span = keptElementSpan(script, name)!;
    return { unknown: kept.unknown, text: kept.renderTrigger(id), saved: script.slice(span.start, span.end).replace(/\r?\n/g, "\r\n") };
  };

  it("writes each element it sets by its literal index, as the Editor saved it", async () => {
    const { unknown, text, saved } = await rendered("8345D960", "gt_Init06Difficulty");

    expect(unknown).toEqual([]);
    expect(text).toBe(saved);
    expect(text).toContain("gv_unloadAmount[6] = 16;");
  });

  it("writes an element indexed by a variable as a Repeat's count, set where the template stands", async () => {
    const { unknown, text, saved } = await rendered("A4CAA752", "gt_Gathercolonistspriortoevacuation");

    expect(unknown).toEqual([]);
    expect(text).toBe(saved);
    expect(text).toContain("auto37AAE177_n = gv_unloadAmount[gv_escortIndex];");
  });
});

/** The `mod-library-calls` fixture's folder: a Mission map's triggers that call its Campaign Mod's library, and the mod (`mods/cmpn-story/`). */
const MOD_CALLS = fileURLToPath(new URL("../fixtures/editor-triggers/mod-library-calls/", import.meta.url));
const modCalls = (file: string): Promise<string> => readFile(path.join(MOD_CALLS, file), "utf8");

describe("a Kept trigger that calls its Campaign Mod's library", () => {
  /** The trigger rendered with `libraries` in reach, and the Editor's section for it. */
  const rendered = async (id: string, name: string, libraries?: Readonly<Record<string, GameLibrary>>) => {
    const kept = new KeptGalaxyRenderer(readTriggersFile(await modCalls("Triggers")), triggerStringNames(await modCalls("TriggerStrings.txt")), CORE_PRIMITIVES, undefined, libraries);
    const script = await modCalls("MapScript.galaxy");
    const span = keptElementSpan(script, name)!;
    const text = kept.renderTrigger(id);
    return { unknown: kept.unknown, text, saved: script.slice(span.start, span.end).replace(/\r?\n/g, "\r\n") };
  };
  /** The map's libraries in reach: the game's, and the Workspace mod its dependencies name. */
  const inReach = () => librariesInReach({ root: MOD_CALLS, mods: ["cmpn-story"] }, ["file:Mods\\Cmpn-Story.SC2Mod"]);

  it("writes a call to a library function as lib<id>_gf_<identifier>(…), its parameters in its definition's order, as the Editor saved it", async () => {
    const { unknown, text, saved } = await rendered("017CF088", "gt_BanterDiscoverAirPustule", await inReach());

    expect(unknown).toEqual([]);
    expect(bindLibraryNames(text!, saved)).toEqual(new Map([["Cmpn/E5539606", "libCmpn_gv_heroUnit"], ["Cmpn/0F999F8A", "lv_zeratul"]]));
  });

  it("writes a block the library defines from its own template", async () => {
    const { unknown, text, saved } = await rendered("E547FCA7", "gt_BanterEnterReactorRoom", await inReach());

    expect(unknown).toEqual([]);
    expect(bindLibraryNames(text!, saved)).toEqual(new Map([["Cmpn/E5539606", "libCmpn_gv_heroUnit"], ["Cmpn/0F999F8A", "lv_zeratul"], ["Cmpn/C8F0D280", "lv_artanis"]]));
  });

  it("is refused, naming the library's functions, when the mod isn't in reach", async () => {
    const { unknown, text } = await rendered("017CF088", "gt_BanterDiscoverAirPustule");

    expect(text).toBeUndefined();
    expect(new Set(unknown.map((part) => part.key))).toEqual(new Set(["Cmpn/BCF70417", "Cmpn/B8B27D5C", "Cmpn/8F0B8074"]));
  });
});
