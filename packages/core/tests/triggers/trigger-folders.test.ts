// Trigger Folders in the trigger document, written as the Editor saves them, on synthetic triggers.
import { describe, expect, it } from "vitest";

import { libraryItems } from "../../src/triggers/splice-triggers.js";
import { NTVE_FUNCTIONS as F } from "../../src/triggers/trigger-catalog.js";
import type { Trigger, TriggerDocument, TriggerVariable } from "../../src/triggers/trigger-model.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { triggerNameStrings } from "../../src/triggers/write-trigger-strings.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";

const variable = (id: string, name: string): TriggerVariable => ({ id, name, type: "int", initial: { id: `${id.slice(0, 7)}F`, value: { kind: "int", value: 1 } } });
const trigger = (id: string, name: string): Trigger => ({ id, name, events: [{ id: `${id.slice(0, 7)}E`, def: F.mapInit, params: {} }], actions: [] });

const count = variable("0000A001", "Count");
const start = trigger("0000B001", "Start");
const gate = trigger("0000B002", "Gate Opens");
const harbour = trigger("0000B003", "Harbour");

/** Root: Start, then Mission (Count's Variables folder, Gate Opens), then Harbour. */
const filed: TriggerDocument = {
  variables: [count],
  triggers: [start, gate, harbour],
  root: [
    { type: "Trigger", id: start.id },
    {
      type: "Category",
      folder: {
        id: "0000C001",
        name: "Mission",
        label: "0677E49B",
        items: [
          { type: "Category", folder: { id: "0000C002", name: "Variables", label: "CE915C5A", items: [{ type: "Variable", id: count.id }] } },
          { type: "Trigger", id: gate.id },
        ],
      },
    },
    { type: "Trigger", id: harbour.id },
  ],
};

describe("a trigger document with folders", () => {
  it("files each item in the folder it names, two levels deep", () => {
    const items = libraryItems(writeTriggersXml(filed));

    expect(items.get(`Trigger/${start.id}`)).toMatchObject({ type: "Trigger" });
    expect(items.get(`Trigger/${start.id}`)?.folder).toBeUndefined();
    expect(items.get("Category/0000C001")).toMatchObject({ type: "Category" });
    expect(items.get("Category/0000C001")?.folder).toBeUndefined();
    expect(items.get("Category/0000C002")?.folder).toBe("0000C001");
    expect(items.get(`Variable/${count.id}`)?.folder).toBe("0000C002");
    expect(items.get(`Trigger/${gate.id}`)?.folder).toBe("0000C001");
    expect(items.get(`Trigger/${harbour.id}`)).toMatchObject({ type: "Trigger" });
    expect(items.get(`Trigger/${harbour.id}`)?.folder).toBeUndefined();
  });

  it("writes a folder as an Editor-saved Category: its Label, then its Item lines, before what it files", () => {
    const xml = writeTriggersXml(filed);

    expect(xml).toContain(
      [
        '    <Element Type="Category" Id="0000C001">',
        '        <Label Type="Label" Library="Ntve" Id="0677E49B"/>',
        '        <Item Type="Category" Id="0000C002"/>',
        '        <Item Type="Trigger" Id="0000B002"/>',
        "    </Element>",
        '    <Element Type="Category" Id="0000C002">',
        '        <Label Type="Label" Library="Ntve" Id="CE915C5A"/>',
        '        <Item Type="Variable" Id="0000A001"/>',
        "    </Element>",
        '    <Element Type="Variable" Id="0000A001">',
      ].join("\r\n"),
    );
    expect(xml).toContain(['    <Root>', '        <Item Type="Trigger" Id="0000B001"/>', '        <Item Type="Category" Id="0000C001"/>', '        <Item Type="Trigger" Id="0000B003"/>', "    </Root>"].join("\r\n"));
  });

  it("writes a folder without a Label with its Item lines alone", () => {
    const plain: TriggerDocument = { variables: [], triggers: [gate], root: [{ type: "Category", folder: { id: "0000C003", name: "Gates", items: [{ type: "Trigger", id: gate.id }] } }] };

    expect(writeTriggersXml(plain)).toContain(['    <Element Type="Category" Id="0000C003">', '        <Item Type="Trigger" Id="0000B002"/>', "    </Element>"].join("\r\n"));
  });

  it("names each folder in TriggerStrings, as Category/Name/<id>", () => {
    expect(triggerNameStrings(filed)).toMatchObject({ "Category/Name/0000C001": "Mission", "Category/Name/0000C002": "Variables", "Trigger/Name/0000B002": "Gate Opens", "Variable/Name/0000A001": "Count" });
  });

  it("writes MapScript's triggers in the tree's depth-first order, as the Editor does", () => {
    // Listed out of tree order, so only the tree can give the script's.
    const script = writeMapScript({ mapName: "Harbour", triggers: { ...filed, triggers: [harbour, gate, start] } });
    const sections = [...script.matchAll(/^\/\/ Trigger: (.*)\r$/gm)].map((match) => match[1]);
    const declared = [...script.matchAll(/^trigger (gt_\w+);\r$/gm)].map((match) => match[1]);
    const initialized = [...script.matchAll(/^ {4}(gt_\w+)_Init\(\);\r$/gm)].map((match) => match[1]);

    expect(sections).toEqual(["Start", "Gate Opens", "Harbour"]);
    expect(declared).toEqual(["gt_Start", "gt_GateOpens", "gt_Harbour"]);
    expect(initialized).toEqual(["gt_Start", "gt_GateOpens", "gt_Harbour"]);
  });

  it("refuses a document that files a trigger twice, or leaves one unfiled", () => {
    expect(() => writeTriggersXml({ ...filed, root: [...filed.root!, { type: "Trigger", id: start.id }] })).toThrow("TriggerDocument files Trigger 0000B001 twice");
    expect(() => writeTriggersXml({ ...filed, root: filed.root!.slice(1) })).toThrow("TriggerDocument files 0000B001 nowhere");
    expect(() => writeTriggersXml({ ...filed, root: [...filed.root!, { type: "Category", folder: { id: gate.id, name: "Gates", items: [] } }] })).toThrow("TriggerDocument's folder 0000B002 (Gates) has the element ID of one of its variables or triggers");
  });
});
