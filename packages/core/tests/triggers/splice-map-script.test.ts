// Splicing Compiled Galaxy into an Editor-saved MapScript.galaxy (ADR-0010), on synthetic scripts.
import { describe, expect, it } from "vitest";

import { scriptBlocks, spliceMapScript } from "../../src/triggers/splice-map-script.js";
import { NTVE_FUNCTIONS as F } from "../../src/triggers/trigger-catalog.js";
import type { TriggerDocument, TriggerFiling, TriggerFolder } from "../../src/triggers/trigger-model.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";

const variable = { id: "0000AAAA", name: "count", type: "int" as const, initial: { id: "0000AAAB", value: { kind: "int" as const, value: 3 } } };
const trigger = { id: "0000BBBB", name: "Count Up", events: [{ id: "0000BBBC", def: F.mapInit, params: {} }], actions: [] };

/** An Editor script with one Kept trigger and no globals, as the Editor writes it. */
const keptScript = writeMapScript({ mapName: "Harbour", triggers: { variables: [], triggers: [{ ...trigger, id: "0000CCCC", name: "Kept Start" }] } });
const compiled: TriggerDocument = { variables: [variable], triggers: [trigger] };

describe("spliceMapScript", () => {
  it("adds a Global Variables section where the Kept script has none, and takes it out again", () => {
    const { content, blocks } = spliceMapScript(keptScript, writeMapScript({ mapName: "x", triggers: compiled }), []);
    expect(content).toContain("// Global Variables\r\n//--------------------------------------------------------------------------------------------------\r\nint gv_count;\r\n\r\nvoid InitGlobals () {\r\n    gv_count = 3;\r\n}\r\n");
    expect(content).toContain("    InitLibs();\r\n    InitGlobals();\r\n    InitTriggers();");
    expect(blocks.map((block) => block.id)).toEqual(["global-variables", "init-globals-call", "variable:gv_count", "variable-init:gv_count", "trigger-variable:gt_CountUp", "trigger:gt_CountUp", "trigger-init:gt_CountUp"]);

    expect(spliceMapScript(content, undefined, blocks.map((block) => block.id)).content).toBe(keptScript);
  });

  it("leaves the section the compile added when the author has declared a global in it since", () => {
    const { content, blocks } = spliceMapScript(keptScript, writeMapScript({ mapName: "x", triggers: compiled }), []);
    const edited = content.replace("int gv_count;\r\n", "int gv_count;\r\nbool gv_authorFlag;\r\n");

    const after = spliceMapScript(edited, undefined, blocks.map((block) => block.id)).content;

    expect(after).toContain("// Global Variables\r\n//--------------------------------------------------------------------------------------------------\r\nbool gv_authorFlag;\r\n");
    expect(after).toContain("    InitGlobals();\r\n");
    expect(after).not.toContain("gv_count");
    expect(after).not.toContain("gt_CountUp");
  });

  it("splices a package compiled with the old capitalised global names and record ids, leaving no duplicate or leftover", () => {
    const counted: TriggerDocument = { variables: [{ ...variable, name: "Count" }], triggers: [trigger] };
    const { content, blocks } = spliceMapScript(keptScript, writeMapScript({ mapName: "x", triggers: counted }), []);
    expect(content).toContain("int gv_count;\r\n");
    expect(content).toContain("    gv_count = 3;\r\n");
    // Before #902 the compile wrote gv_Count, and its record listed variable:gv_Count.
    const before = content.replace(/gv_count/g, "gv_Count");
    const recorded = blocks.map((block) => block.id.replace("gv_count", "gv_Count"));
    expect(recorded).toContain("variable:gv_Count");

    const again = spliceMapScript(before, writeMapScript({ mapName: "x", triggers: counted }), recorded).content;

    expect(again).toBe(content);
    expect(again).not.toMatch(/gv_Count/);
    expect(again.match(/^int gv_count;/gm)).toHaveLength(1);
  });

  it("splices a package whose record has the old capitalised ids and the Editor has saved since, in its own lower-case form", () => {
    const counted: TriggerDocument = { variables: [{ ...variable, name: "Count" }], triggers: [trigger] };
    const { content, blocks } = spliceMapScript(keptScript, writeMapScript({ mapName: "x", triggers: counted }), []);
    // The record from before #902 lists variable:gv_Count; the Editor's save wrote gv_count, as the compile now does.
    const recorded = blocks.map((block) => block.id.replace("gv_count", "gv_Count"));

    const again = spliceMapScript(content, writeMapScript({ mapName: "x", triggers: counted }), recorded).content;

    expect(again).toBe(content);
    expect(again.match(/^int gv_count;/gm)).toHaveLength(1);
  });

  describe("in the folder tree's order", () => {
    const start = { ...trigger, id: "0000D001", name: "Mission Start" };
    const keptTrigger = { ...trigger, id: "0000D002", name: "Folder Check" };
    const objective = { ...trigger, id: "0000D003", name: "Objective Done" };
    const total = { ...variable, id: "0000E001", name: "Total", initial: { id: "0000E101", value: { kind: "int" as const, value: 1 } } };
    const keptGlobal = { ...variable, id: "0000E002", name: "authorFlag", initial: { id: "0000E102", value: { kind: "int" as const, value: 2 } } };
    const score = { ...variable, id: "0000E003", name: "Score", initial: { id: "0000E103", value: { kind: "int" as const, value: 3 } } };
    const folder = (id: string, name: string, items: TriggerFolder["items"]): TriggerFiling => ({ type: "Category", folder: { id, name, items } });
    // Mission (Variables: Total, the author's flag, Score; Mission Start), then Landfall (the author's Folder Check first, then Objective Done).
    const tree: TriggerFiling[] = [
      folder("0000F001", "Mission", [
        folder("0000F002", "Variables", [
          { type: "Variable", id: total.id },
          { type: "Variable", id: keptGlobal.id },
          { type: "Variable", id: score.id },
        ]),
        { type: "Trigger", id: start.id },
      ]),
      folder("0000F003", "Landfall", [
        { type: "Trigger", id: keptTrigger.id },
        { type: "Trigger", id: objective.id },
      ]),
    ];
    /** What the Editor writes for the whole tree, Kept and Compiled. */
    const editorSaved = writeMapScript({ mapName: "x", triggers: { variables: [total, keptGlobal, score], triggers: [start, keptTrigger, objective], root: tree } });
    const generated = writeMapScript({ mapName: "x", triggers: { variables: [total, score], triggers: [start, objective] } });
    const order = [["gv_total"], ["gv_authorFlag"], ["gv_score"], ["gt_MissionStart"], ["gt_FolderCheck"], ["gt_ObjectiveDone"]];
    const titles = (script: string): string[] => [...script.matchAll(/^\/\/ Trigger: (.*?)\r?$/gm)].map((match) => match[1]!);

    it("puts a Compiled block after a Kept trigger or global filed before it, as the Editor's save has it", () => {
      const previous = scriptBlocks(generated).map((block) => block.id);
      const kept = spliceMapScript(editorSaved, undefined, previous).content;
      expect(titles(kept)).toEqual(["Folder Check"]);

      const { content } = spliceMapScript(kept, generated, [], new Set(), order);

      expect(titles(content)).toEqual(["Mission Start", "Folder Check", "Objective Done"]);
      expect(content).toBe(editorSaved);
    });

    it("leaves an Editor-saved script as the Editor wrote it on a recompile", () => {
      const previous = scriptBlocks(generated).map((block) => block.id);

      expect(spliceMapScript(editorSaved, generated, previous, new Set(), order).content).toBe(editorSaved);
    });

    it("puts the declarations and init calls in tree order too", () => {
      const previous = scriptBlocks(generated).map((block) => block.id);
      const { content } = spliceMapScript(editorSaved, generated, previous, new Set(), order);

      expect([...content.matchAll(/^int (gv_\w+);/gm)].map((match) => match[1])).toEqual(["gv_total", "gv_authorFlag", "gv_score"]);
      expect([...content.matchAll(/^    (gv_\w+) = /gm)].map((match) => match[1])).toEqual(["gv_total", "gv_authorFlag", "gv_score"]);
      expect([...content.matchAll(/^trigger (gt_\w+);/gm)].map((match) => match[1])).toEqual(["gt_MissionStart", "gt_FolderCheck", "gt_ObjectiveDone"]);
      expect([...content.matchAll(/^    (gt_\w+)_Init\(\);/gm)].map((match) => match[1])).toEqual(["gt_MissionStart", "gt_FolderCheck", "gt_ObjectiveDone"]);
    });

    it("passes over a trigger the script leaves out, as the Editor does a disabled one", () => {
      const previous = scriptBlocks(generated).map((block) => block.id);
      const withDisabled = [["gv_total"], ["gv_authorFlag"], ["gv_score"], ["gt_MissionStart"], ["gt_Disabled"], ["gt_FolderCheck"], ["gt_ObjectiveDone"]];

      expect(spliceMapScript(editorSaved, generated, previous, new Set(), withDisabled).content).toBe(editorSaved);
    });

    it("finds a Kept trigger by any name it may have, such as the one another locale gives it", () => {
      const previous = scriptBlocks(generated).map((block) => block.id);
      const renamed = [["gv_total"], ["gv_authorFlag"], ["gv_score"], ["gt_MissionStart"], ["gt_Ordnerprufung", "gt_FolderCheck"], ["gt_ObjectiveDone"]];

      expect(spliceMapScript(editorSaved, generated, previous, new Set(), renamed).content).toBe(editorSaved);
    });

    it("without an order, puts each block at the end of its section", () => {
      const previous = scriptBlocks(generated).map((block) => block.id);

      expect(titles(spliceMapScript(editorSaved, generated, previous).content)).toEqual(["Folder Check", "Mission Start", "Objective Done"]);
    });
  });
});
