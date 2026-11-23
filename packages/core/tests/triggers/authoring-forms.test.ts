// The authoring tool writes every value a converted trigger holds (#1061): each form, given in the tool's
// input and written as a new trigger, renders the Galaxy the Editor saved for a trigger holding it. The
// triggers are cut from Editor saves (the authoring-forms, library-globals and text-parameters fixtures),
// converted as convert_triggers reads them, outlined into the tool's input and written back through it.
import { describe, expect, it } from "vitest";

import type { BlueprintTrigger } from "../../src/domain/blueprint-trigger.js";
import { authoredTriggerGalaxy } from "../../src/map/write-blueprint-trigger.js";
import { type AuthoringTrigger, authorTrigger } from "../../src/triggers/author-trigger.js";
import { outlineForAuthoring } from "../../src/triggers/authoring-outline.js";
import { readTriggersFile, triggerStringNames } from "../../src/triggers/triggers-file.js";
import { type Cut, converted, cut, GAME_STRINGS } from "./authoring-cuts.js";

/** `input` written through the tool as a new trigger among the cut's elements (beside the Kept one of its name, which it doesn't replace: its Ids are its own), and its Galaxy. */
function written({ files, libraries, map }: Cut, input: AuthoringTrigger): { readonly trigger: BlueprintTrigger; readonly galaxy: string } {
  const { trigger } = authorTrigger(input, { libraries, map, taken: readTriggersFile(files.triggers).ids });
  return { trigger, galaxy: authoredTriggerGalaxy(trigger, [], [], { triggers: files.triggers, gameStrings: [...files.gameStrings.values()] }, triggerStringNames(files.triggerStrings), libraries) };
}

/** A trigger's section in the Editor's script. */
function editorSection(script: string, name: string): string {
  const text = script.replace(/\r\n/g, "\n");
  const start = text.indexOf(`//--------------------------------------------------------------------------------------------------\n// Trigger: ${name}\n`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n}\n", text.indexOf("_Init () {", start)) + 3;
  return text.slice(start, end);
}

/** Galaxy with the names an element's Id gives (auto<id>_, Param/Value/<id>, Param/Expression/<id>) numbered by first use: a new trigger's Ids are its own. */
function numbered(galaxy: string): string {
  const seen = new Map<string, number>();
  return galaxy.replace(/\r\n/g, "\n").trimEnd().replace(/(?<=auto|Param\/(?:Value|Expression)\/)[0-9A-F]{8}/g, (id) => `<${seen.get(id) ?? seen.set(id, seen.size).get(id)}>`);
}

/** The Editor's section for a Kept trigger, and the tool's for its outline written as a new trigger. */
function bothGalaxies(at: Cut, name: string) {
  const outline = outlineForAuthoring(converted(at, name), at);
  expect(outline.unwritable).toEqual([]);
  const { trigger, galaxy } = written(at, outline.trigger);
  return { trigger, tool: numbered(galaxy), editor: numbered(editorSection(at.files.script, name)) };
}

describe("the authoring tool's value forms", () => {
  it("writes a map's own preset values by name, as Heart of the Swarm's zhybrid01 switches on them", async () => {
    const zhybrid = await cut("authoring-forms/zhybrid01");
    const signal = (name: string) => ({ function: "Send Actor Message To Game Region", params: { Region: { function: "Entire Map" }, Message: { type: "actormsg", value: `Signal ${name}` } } });

    const { galaxy } = written(zhybrid, {
      name: "Gas Animation Handler",
      actions: [
        {
          function: "Switch",
          params: { Value: { variable: "GasStatus" } },
          blocks: {
            Cases: [
              { function: "Switch Case", params: { Value: { preset: "GasOff" } }, blocks: { Actions: [signal("GasOff")] } },
              { function: "Switch Case", params: { Value: { preset: "GasOn" } }, blocks: { Actions: [signal("GasOn")] } },
            ],
          },
        },
      ],
    });

    expect(numbered(galaxy)).toBe(numbered(editorSection(zhybrid.files.script, "Gas Animation Handler")));
  });

  it("writes a set of bits by its values' names, the preset type the parameter's", async () => {
    const zhybrid = await cut("authoring-forms/zhybrid01");
    const outline = outlineForAuthoring(converted(zhybrid, "Expansion Clear - Spawn Gas Pallets"), zhybrid);
    expect(JSON.stringify(outline.trigger)).toContain('"Flags":{"bits":["Ignore Placement"]}');

    const { tool, editor, trigger } = bothGalaxies(zhybrid, "Expansion Clear - Spawn Gas Pallets");

    expect(tool).toBe(editor);
    expect(JSON.stringify(trigger)).toContain('"presetElement":"Ntve/E85564CA","bits":["Ntve/7491C9A8"]');
  });

  it("writes a text expression's words into GameStrings, keyed by its Param", async () => {
    const zhybrid = await cut("authoring-forms/zhybrid01");

    const { tool, editor, trigger } = bothGalaxies(zhybrid, "Achievement: Dominated Terran Added");

    expect(tool).toBe(editor);
    expect(Object.entries(trigger.strings?.[GAME_STRINGS] ?? {}).filter(([key]) => key.startsWith("Param/Expression/")).map(([, words]) => words)).toEqual(["Max Dominated Units = ~A~"]);
  });

  it("writes a string expression, a record's members and an Integer given where a Real is taken, as Legacy of the Void's pkorhal02 holds them", async () => {
    const pkorhal = await cut("authoring-forms/pkorhal02");

    const { tool, editor } = bothGalaxies(pkorhal, "Enemy Camp Init");

    expect(tool).toBe(editor);
  });

  it("writes placed objects by their numbers and an ability command's targeting, as zhybrid01 holds them", async () => {
    const zhybrid = await cut("authoring-forms/zhybrid01");

    const { tool, editor } = bothGalaxies(zhybrid, "Ghost Nuke Base Entrance");

    expect(tool).toBe(editor);
  });

  it("writes a library's globals and their structures' members by name", async () => {
    const globals = await cut("library-globals", "mods/cmpn-story/Cmpn-Story.SC2Mod");
    const outline = outlineForAuthoring(converted(globals, "Cleanup"), globals);
    expect(JSON.stringify(outline.trigger)).toContain('{"variable":"Hero Unit","member":{"variable":"Artanis"}}');

    const { tool, editor } = bothGalaxies(globals, "Cleanup");

    expect(tool).toBe(editor);
    expect(tool).toContain("libCmpn_gv_heroUnit.lv_artanis");
  });

  it("gives a text parameter left out the Editor's default text: Create Objective's empty description, Display Boss Bar's Boss", async () => {
    const objectives = await cut("text-parameters/hero-objectives");
    const editorLine = numbered(objectives.files.script).split("\n").find((line) => line.includes("ObjectiveCreate("))!.trim();

    const { trigger, galaxy } = written(objectives, { name: "Objectives", actions: [{ function: "Create Objective", params: { Text: "Zeratul must survive" } }] });
    // Display Boss Bar's Title starts as "Boss", in the game's GameStrings (its Portrait, a file path, the renderer doesn't write yet).
    const boss = authorTrigger({ name: "Boss", actions: [{ function: "Display Boss Bar" }] }, { libraries: objectives.libraries, map: objectives.map, taken: new Set() }).trigger;

    expect(numbered(galaxy).split("\n").find((line) => line.includes("ObjectiveCreate("))!.trim()).toBe(editorLine);
    expect(Object.values(trigger.strings?.[GAME_STRINGS] ?? {}).sort()).toEqual(["", "Zeratul must survive"]);
    expect(Object.values(boss.strings?.[GAME_STRINGS] ?? {})).toEqual(["Boss"]);
  });

  it("writes an Integer expression as the Editor writes one, its text in parentheses with each slot its value, and refuses a slot its text doesn't name", async () => {
    const zhybrid = await cut("authoring-forms/zhybrid01");
    const wait = (expression: unknown) => ({ name: "Wait", actions: [{ function: "Wait", params: { Time: expression as never } }] });

    const { galaxy } = written(zhybrid, wait({ expression: "~A~*2+~B~", type: "Integer", slots: { B: 1, A: { variable: "AchievementMaxDomiantedTerran" } } }));

    expect(galaxy).toContain("Wait((gv_achievementMaxDomiantedTerran*2+1), c_timeGame);");
    expect(() => written(zhybrid, wait({ expression: "~A~+1", type: "Integer", slots: { A: 1, C: 2 } }))).toThrow("action 1 (Wait), Time: the expression's text names no slot \"C\": write ~<code>~ where each stands");
    expect(() => written(zhybrid, wait({ expression: "~A~+~B~", type: "Integer", slots: { A: 1 } }))).toThrow('action 1 (Wait), Time: the expression names "~B~", which no slot gives: give each in slots');
  });

  it("refuses a text default whose words the library in reach doesn't give", async () => {
    const objectives = await cut("text-parameters/hero-objectives");
    const { defaultTexts: _texts, ...ntve } = objectives.libraries.Ntve!;

    expect(() => authorTrigger({ name: "Boss", actions: [{ function: "Display Boss Bar" }] }, { libraries: { ...objectives.libraries, Ntve: ntve }, map: objectives.map, taken: new Set() })).toThrow(
      "action 1 (Display Boss Bar), Title: its default is a text whose words aren't known here: give its words",
    );
  });

});
