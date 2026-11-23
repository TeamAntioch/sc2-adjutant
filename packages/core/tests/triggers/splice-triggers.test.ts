// Splicing Compiled triggers into an Editor-saved Triggers file (ADR-0010), on synthetic XML.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { type CompileRecord, fingerprint } from "../../src/domain/compile-record.js";
import { editorChanges } from "../../src/map/editor-changes.js";
import { keptItems, libraryItems, recordedItemKeys, spliceTriggers, triggerItemTexts } from "../../src/triggers/splice-triggers.js";

const xml = (root: string[], elements: string[]): string =>
  ['<?xml version="1.0" encoding="utf-8"?>', "<TriggerData>", "    <Root>", ...root.map((item) => `        ${item}`), "    </Root>", ...elements, "</TriggerData>", ""].join("\r\n");

const element = (type: string, id: string, ...children: string[]): string => [`    <Element Type="${type}" Id="${id}">`, ...children.map((child) => `        ${child}`), "    </Element>"].join("\r\n");

const compiled = (action: string): string[] => [element("Trigger", "0000000A", `<Action Type="FunctionCall" Id="${action}"/>`), element("FunctionCall", action)];

describe("spliceTriggers", () => {
  it("finds a Compiled trigger the author filed in a folder, and replaces it there", () => {
    const existing = xml(
      ['<Item Type="Trigger" Id="00000001"/>', '<Item Type="Category" Id="00000002"/>'],
      [element("Trigger", "00000001"), element("Category", "00000002", '<Item Type="Trigger" Id="0000000A"/>'), ...compiled("0000000B")],
    );
    const generated = xml(['<Item Type="Trigger" Id="0000000A"/>'], compiled("0000000C"));

    const { content } = spliceTriggers(existing, generated, new Set(["Trigger/0000000A"]));

    expect(content).toBe(
      xml(
        ['<Item Type="Trigger" Id="00000001"/>', '<Item Type="Category" Id="00000002"/>'],
        [element("Trigger", "00000001"), element("Category", "00000002", '<Item Type="Trigger" Id="0000000A"/>'), ...compiled("0000000C")],
      ),
    );
    // Dropped from the Blueprint, it leaves the folder too.
    expect(spliceTriggers(content, undefined, new Set(["Trigger/0000000A"])).content).toBe(
      xml(['<Item Type="Trigger" Id="00000001"/>', '<Item Type="Category" Id="00000002"/>'], [element("Trigger", "00000001"), element("Category", "00000002")]),
    );
  });

  it("writes an item it's told to place in place where the package has it: its Root line and its elements where they stood", () => {
    const before = [element("Trigger", "00000001"), element("FunctionCall", "00000002")];
    const after = [element("Trigger", "00000003")];
    const existing = xml(['<Item Type="Trigger" Id="00000001"/>', '<Item Type="Trigger" Id="0000000A"/>', '<Item Type="Trigger" Id="00000003"/>'], [...before, ...compiled("0000000B"), ...after]);
    const generated = xml(['<Item Type="Trigger" Id="0000000A"/>', '<Item Type="Trigger" Id="0000000E"/>'], [...compiled("0000000C"), element("Trigger", "0000000E")]);

    const { content } = spliceTriggers(existing, generated, new Set(["Trigger/0000000A"]), new Set(), {}, new Set(["Trigger/0000000A"]));

    expect(content).toBe(
      xml(['<Item Type="Trigger" Id="00000001"/>', '<Item Type="Trigger" Id="0000000A"/>', '<Item Type="Trigger" Id="00000003"/>', '<Item Type="Trigger" Id="0000000E"/>'], [...before, ...compiled("0000000C"), ...after, element("Trigger", "0000000E")]),
    );
  });

  it("opens up a Root the Editor saved empty", () => {
    const existing = ['<?xml version="1.0" encoding="utf-8"?>', "<TriggerData>", "    <Root/>", "</TriggerData>", ""].join("\r\n");
    const generated = xml(['<Item Type="Trigger" Id="0000000A"/>'], compiled("0000000B"));
    expect(spliceTriggers(existing, generated, new Set()).content).toBe(generated);
  });

  it("takes a trigger's local variables out with it, and leaves a global it uses", () => {
    const kept = [element("Trigger", "00000001"), element("Variable", "00000005")];
    const local = [element("Trigger", "0000000A", '<Variable Type="Variable" Id="0000000D"/>', '<Action Type="FunctionCall" Id="0000000B"/>'), element("Variable", "0000000D"), element("FunctionCall", "0000000B", '<Variable Type="Variable" Id="00000005"/>')];
    const existing = xml(['<Item Type="Trigger" Id="00000001"/>', '<Item Type="Variable" Id="00000005"/>', '<Item Type="Trigger" Id="0000000A"/>'], [...kept, ...local]);

    expect(spliceTriggers(existing, undefined, new Set(["Trigger/0000000A"])).content).toBe(xml(['<Item Type="Trigger" Id="00000001"/>', '<Item Type="Variable" Id="00000005"/>'], kept));
  });

  it("splices a mod's library triggers inside its Library", () => {
    const library = (root: string[], elements: string[]): string =>
      ['<?xml version="1.0" encoding="utf-8"?>', "<TriggerData>", '    <Library Id="Hbr1">', "        <Root>", ...root.map((item) => `            ${item}`), "        </Root>", ...elements, "    </Library>", "</TriggerData>", ""].join("\r\n");
    const existing = library(['<Item Type="Trigger" Library="Hbr1" Id="00000001"/>'], [element("Trigger", "00000001")]);
    const generated = library(['<Item Type="Trigger" Library="Hbr1" Id="0000000A"/>'], [element("Trigger", "0000000A", '<Action Type="FunctionCall" Library="Hbr1" Id="0000000B"/>'), element("FunctionCall", "0000000B")]);

    const { content, items } = spliceTriggers(existing, generated, new Set(), new Set(), { library: "Hbr1" });

    expect(content).toBe(
      library(
        ['<Item Type="Trigger" Library="Hbr1" Id="00000001"/>', '<Item Type="Trigger" Library="Hbr1" Id="0000000A"/>'],
        [element("Trigger", "00000001"), element("Trigger", "0000000A", '<Action Type="FunctionCall" Library="Hbr1" Id="0000000B"/>'), element("FunctionCall", "0000000B")],
      ),
    );
    expect(items.map((item) => item.id)).toEqual(["0000000A"]);
    expect(spliceTriggers(content, undefined, new Set(["Trigger/0000000A"]), new Set(), { library: "Hbr1" }).content).toBe(existing);
    expect(() => spliceTriggers(existing, generated, new Set(), new Set(), { library: "Othr" })).toThrow("Triggers has no library Othr");
  });

  it("leaves a custom library a Mission embeds as it is, and splices the Mission's own triggers", () => {
    // The Editor writes an embedded library's block before the map's own Root. Its Ids are its own:
    // the library's FunctionCall 0000000B is no clash with the Mission's.
    const embedded = ['    <Library Id="Hbr1">', "        <Root>", '            <Item Type="Trigger" Library="Hbr1" Id="00000001"/>', "        </Root>", element("Trigger", "00000001", '<Action Type="FunctionCall" Library="Hbr1" Id="0000000B"/>'), element("FunctionCall", "0000000B"), "    </Library>"];
    const mission = (root: string[], elements: string[]): string => xml(root, elements).replace("<TriggerData>\r\n", `<TriggerData>\r\n${embedded.join("\r\n")}\r\n`);
    const existing = mission(['<Item Type="Trigger" Id="00000002"/>'], [element("Trigger", "00000002")]);
    const generated = xml(['<Item Type="Trigger" Id="0000000A"/>'], compiled("0000000B"));

    const { content, items } = spliceTriggers(existing, generated, new Set());

    expect(content).toBe(mission(['<Item Type="Trigger" Id="00000002"/>', '<Item Type="Trigger" Id="0000000A"/>'], [element("Trigger", "00000002"), ...compiled("0000000B")]));
    expect(items.map((item) => item.id)).toEqual(["0000000A"]);
    expect(spliceTriggers(content, undefined, new Set(["Trigger/0000000A"])).content).toBe(existing);
  });

  it("follows a Compiled call to the Kept global it names by type, in an older map whose Kept call has the global's Id", () => {
    // As thanson01 has them: the global GameOver and a call in another trigger, both 00000029.
    const kept = [element("Trigger", "00000001", '<Action Type="FunctionCall" Id="00000029"/>'), element("Variable", "00000029"), element("FunctionCall", "00000029")];
    const existing = xml(['<Item Type="Trigger" Id="00000001"/>', '<Item Type="Variable" Id="00000029"/>'], kept);
    const uses = [element("Trigger", "0000000A", '<Action Type="FunctionCall" Id="0000000B"/>'), element("FunctionCall", "0000000B", '<Parameter Type="Param" Id="0000000C"/>'), element("Param", "0000000C", '<Variable Type="Variable" Id="00000029"/>')];
    const generated = xml(['<Item Type="Trigger" Id="0000000A"/>'], uses);

    const { content } = spliceTriggers(existing, generated, new Set());

    expect(content).toBe(xml(['<Item Type="Trigger" Id="00000001"/>', '<Item Type="Variable" Id="00000029"/>', '<Item Type="Trigger" Id="0000000A"/>'], [...kept, ...uses]));
    expect(spliceTriggers(content, undefined, new Set(["Trigger/0000000A"])).content).toBe(existing);
  });

  it("replaces an item by its Id among the items filed in Root or a folder, not a trigger's comment that shares it", async () => {
    // Cut from thanson01, whose Comment 00000030 (in a trigger's actions) shares FunctionCall 00000030's Id.
    const kept = await readFile(new URL("../fixtures/editor-triggers/shared-ids/Triggers", import.meta.url), "utf8");
    // A Compiled trigger with that Id too, filed in Root, as a record from an earlier compile names it.
    const existing = kept
      .replace('        <Item Type="Trigger" Id="00000046"/>\n', '        <Item Type="Trigger" Id="00000046"/>\n        <Item Type="Trigger" Id="00000030"/>\n')
      .replace("</TriggerData>", '    <Element Type="Trigger" Id="00000030">\n    </Element>\n</TriggerData>');
    expect(existing).toContain('<Item Type="Trigger" Id="00000030"/>');

    expect(spliceTriggers(existing, undefined, new Set(["Trigger/00000030"])).content).toBe(kept);
  });

  it("still replaces a previous item whose item line is gone, as no element references it", () => {
    const kept = [element("Trigger", "00000001")];
    // Trigger 0000000A's line dropped from Root by hand; its elements remain.
    const existing = xml(['<Item Type="Trigger" Id="00000001"/>'], [...kept, ...compiled("0000000B")]);

    expect(spliceTriggers(existing, undefined, new Set(["Trigger/0000000A"])).content).toBe(xml(['<Item Type="Trigger" Id="00000001"/>'], kept));
  });

  it("refuses a Compiled element whose Id a Kept element of another type has", () => {
    const existing = xml(['<Item Type="Variable" Id="0000000B"/>'], [element("Variable", "0000000B")]);
    expect(() => spliceTriggers(existing, xml(['<Item Type="Trigger" Id="0000000A"/>'], compiled("0000000B")), new Set())).toThrow("The compile's FunctionCall 0000000B has the element Id of a Kept Variable in Triggers");
  });
});

describe("spliceTriggers, with the compile's Trigger Folders", () => {
  // The compile's folder 0000000F, filing its trigger 0000000A.
  const folder = (...items: string[]): string => element("Category", "0000000F", '<Label Type="Label" Library="Ntve" Id="0677E49B"/>', ...items.map((id) => `<Item Type="Trigger" Id="${id}"/>`));
  const generated = xml(['<Item Type="Category" Id="0000000F"/>'], [folder("0000000A"), ...compiled("0000000C")]);
  // The author's own folder 00000002, filing the Kept trigger 00000001.
  const authors = (...items: string[]): string => element("Category", "00000002", ...items.map((id) => `<Item Type="Trigger" Id="${id}"/>`));

  it("adds the compile's folders beside the author's, which it leaves as they are", () => {
    const existing = xml(['<Item Type="Category" Id="00000002"/>'], [authors("00000001"), element("Trigger", "00000001")]);

    const { content, items } = spliceTriggers(existing, generated, new Set());

    expect(content).toBe(xml(['<Item Type="Category" Id="00000002"/>', '<Item Type="Category" Id="0000000F"/>'], [authors("00000001"), element("Trigger", "00000001"), folder("0000000A"), ...compiled("0000000C")]));
    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual(["category:0000000F", "trigger:0000000A"]);
    expect(spliceTriggers(content, undefined, new Set(["Category/0000000F", "Trigger/0000000A"])).content).toBe(existing);
  });

  it("keeps a Kept item the author filed in a folder an earlier compile wrote, in that folder", () => {
    const existing = xml(['<Item Type="Category" Id="0000000F"/>'], [folder("0000000A", "00000001"), element("Trigger", "00000001"), ...compiled("0000000B")]);

    const { content } = spliceTriggers(existing, generated, new Set(["Category/0000000F", "Trigger/0000000A"]));

    expect(content).toBe(xml(['<Item Type="Category" Id="0000000F"/>'], [element("Trigger", "00000001"), folder("0000000A", "00000001"), ...compiled("0000000C")]));
  });

  it("finds a Kept item the author filed in a folder of the compile's, so the package is spliced, not written whole", () => {
    const existing = xml(['<Item Type="Category" Id="0000000F"/>'], [folder("0000000A", "00000001"), element("Trigger", "00000001"), ...compiled("0000000B")]);

    expect(keptItems(existing, new Set(["Category/0000000F", "Trigger/0000000A"]))).toEqual([{ type: "Trigger", id: "00000001" }]);
    expect(keptItems(generated, new Set(["Category/0000000F", "Trigger/0000000A"]))).toEqual([]);
  });

  it("records the compile's folder without the Kept item it keeps there, which is the author's filing", () => {
    const existing = xml(['<Item Type="Category" Id="0000000F"/>'], [folder("0000000A", "00000001"), element("Trigger", "00000001"), ...compiled("0000000B")]);

    const { items } = spliceTriggers(existing, generated, new Set(["Category/0000000F", "Trigger/0000000A"]));

    expect(items.find((item) => item.id === "0000000F")?.fingerprint).toBe(fingerprint(triggerItemTexts(generated).get("Category/0000000F")!.text));
  });

  it("files a Kept item in Root when the folder an earlier compile filed it in is no longer written", () => {
    const existing = xml(['<Item Type="Category" Id="0000000F"/>'], [folder("0000000A", "00000001"), element("Trigger", "00000001"), ...compiled("0000000B")]);

    const { content } = spliceTriggers(existing, xml(['<Item Type="Trigger" Id="0000000A"/>'], compiled("0000000C")), new Set(["Category/0000000F", "Trigger/0000000A"]));

    expect(content).toBe(xml(['<Item Type="Trigger" Id="00000001"/>', '<Item Type="Trigger" Id="0000000A"/>'], [element("Trigger", "00000001"), ...compiled("0000000C")]));
  });

  it("leaves a Compiled item the author moved into a folder of their own there, and out of the compile's folder", () => {
    const existing = xml(['<Item Type="Category" Id="00000002"/>', '<Item Type="Category" Id="0000000F"/>'], [authors("00000001", "0000000A"), element("Trigger", "00000001"), folder(), ...compiled("0000000B")]);

    const { content } = spliceTriggers(existing, generated, new Set(["Category/0000000F", "Trigger/0000000A"]));

    expect(content).toBe(xml(['<Item Type="Category" Id="00000002"/>', '<Item Type="Category" Id="0000000F"/>'], [authors("00000001", "0000000A"), element("Trigger", "00000001"), folder(), ...compiled("0000000C")]));
  });
});

describe("spliceTriggers, from review of the compile's Trigger Folders", () => {
  const folder = (...items: string[]): string => element("Category", "0000000F", '<Label Type="Label" Library="Ntve" Id="0677E49B"/>', ...items.map((id) => `<Item Type="Trigger" Id="${id}"/>`));
  const authors = (...items: string[]): string => element("Category", "00000002", ...items.map((id) => `<Item Type="Trigger" Id="${id}"/>`));

  it("puts a Kept item back after the item it followed in the compile's folder, so the author's order holds", () => {
    const generated = xml(['<Item Type="Category" Id="0000000F"/>'], [folder("0000000A", "0000000E"), ...compiled("0000000C"), element("Trigger", "0000000E")]);
    const existing = xml(['<Item Type="Category" Id="0000000F"/>'], [folder("0000000A", "00000001", "0000000E"), element("Trigger", "00000001"), ...compiled("0000000B"), element("Trigger", "0000000E")]);

    const { content } = spliceTriggers(existing, generated, new Set(["Category/0000000F", "Trigger/0000000A", "Trigger/0000000E"]));

    expect(content).toBe(xml(['<Item Type="Category" Id="0000000F"/>'], [element("Trigger", "00000001"), folder("0000000A", "00000001", "0000000E"), ...compiled("0000000C"), element("Trigger", "0000000E")]));
  });

  it("leaves a Compiled item the author kept (--keep) and moved into a folder of their own there, and out of the compile's folder", () => {
    const generated = xml(['<Item Type="Category" Id="0000000F"/>'], [folder("0000000A", "00000009"), ...compiled("0000000C"), element("Trigger", "00000009")]);
    const existing = xml(['<Item Type="Category" Id="00000002"/>', '<Item Type="Category" Id="0000000F"/>'], [authors("00000009"), element("Trigger", "00000009", "<Disabled/>"), folder("0000000A"), ...compiled("0000000B")]);

    const { content } = spliceTriggers(existing, generated, new Set(["Category/0000000F", "Trigger/0000000A"]), new Set(["Trigger/00000009"]));

    expect(content).toBe(xml(['<Item Type="Category" Id="00000002"/>', '<Item Type="Category" Id="0000000F"/>'], [authors("00000009"), element("Trigger", "00000009", "<Disabled/>"), folder("0000000A"), ...compiled("0000000C")]));
  });

  it("records a Compiled item the author left in a folder of their own as the package has it", () => {
    const generated = xml(['<Item Type="Category" Id="0000000F"/>'], [folder("0000000A"), ...compiled("0000000C")]);
    const existing = xml(['<Item Type="Category" Id="00000002"/>', '<Item Type="Category" Id="0000000F"/>'], [authors("00000001", "0000000A"), element("Trigger", "00000001"), folder(), ...compiled("0000000B")]);

    const { content, items } = spliceTriggers(existing, generated, new Set(["Category/0000000F", "Trigger/0000000A"]));

    expect(items.find((item) => item.id === "0000000A")?.fingerprint).toBe(fingerprint(triggerItemTexts(content).get("Trigger/0000000A")!.text));
  });

  it("finds a mod library's Kept items in its Root only, as before Trigger Folders", () => {
    const library = (root: string[], elements: string[]): string =>
      ['<?xml version="1.0" encoding="utf-8"?>', "<TriggerData>", '    <Library Id="Hbr1">', "        <Root>", ...root.map((item) => `            ${item}`), "        </Root>", ...elements, "    </Library>", "</TriggerData>", ""].join("\r\n");
    const existing = library(['<Item Type="Category" Library="Hbr1" Id="0000000F"/>'], [element("Category", "0000000F", '<Item Type="Trigger" Library="Hbr1" Id="00000001"/>'), element("Trigger", "00000001")]);

    expect(keptItems(existing, new Set(["Category/0000000F"]), { library: "Hbr1" })).toEqual([]);
  });
});

describe("editorChanges, on a Mission's Trigger Folders", () => {
  const folder = (...items: string[]): string => element("Category", "0000000F", '<Label Type="Label" Library="Ntve" Id="0677E49B"/>', ...items.map((id) => `<Item Type="Trigger" Id="${id}"/>`));
  const authors = (...items: string[]): string => element("Category", "00000002", ...items.map((id) => `<Item Type="Trigger" Id="${id}"/>`));
  const generated = xml(['<Item Type="Category" Id="0000000F"/>'], [folder("0000000A"), ...compiled("0000000C")]);
  // Compiled beside the Kept trigger 00000001 in Root.
  const first = spliceTriggers(xml(['<Item Type="Trigger" Id="00000001"/>'], [element("Trigger", "00000001")]), generated, new Set());
  const record: CompileRecord = { version: 1, entries: first.items };
  const changes = async (triggers: string): Promise<string[]> => {
    const dir = await mkdtemp(path.join(tmpdir(), "folder-changes-"));
    try {
      await writeFile(path.join(dir, "Triggers"), triggers);
      return (await editorChanges(dir, record, (file) => (file === "Triggers" ? generated : undefined))).map((change) => `${change.name}: ${change.change}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it("doesn't ask about a Kept item the author filed in the compile's folder", async () => {
    expect(await changes(xml(['<Item Type="Category" Id="0000000F"/>'], [element("Trigger", "00000001"), folder("0000000A", "00000001"), ...compiled("0000000C")]))).toEqual([]);
  });

  it("doesn't ask about a Compiled item the author moved out of the compile's folder into their own", async () => {
    expect(await changes(xml(['<Item Type="Category" Id="00000002"/>', '<Item Type="Category" Id="0000000F"/>'], [authors("00000001", "0000000A"), element("Trigger", "00000001"), folder(), ...compiled("0000000C")]))).toEqual([]);
  });

  it("still asks about the compile's folder when the author changed what it says", async () => {
    const relabelled = first.content.replace('Id="0677E49B"', 'Id="00000035"');
    expect(await changes(relabelled)).toEqual(["category:0000000F: changed in the Editor"]);
  });
});

describe("an older save's items that share an Id", () => {
  // Cut from thanson01: the Trigger and the Variable that are both 00000029, filed in Root, and Trigger 00000046.
  const map = (): Promise<string> => readFile(new URL("../fixtures/editor-triggers/shared-ids/Triggers", import.meta.url), "utf8");
  const triggerBlock = (text: string): string => text.slice(text.indexOf('    <Element Type="Trigger" Id="00000029">'), text.indexOf('    <Element Type="Variable" Id="00000029">'));
  const lf = (lines: string[]): string => lines.join("\n") + "\n";

  it("knows a record's items, and those the author kept from it, by kind and Id", () => {
    const record: CompileRecord = {
      version: 1,
      entries: [
        { kind: "trigger", id: "00000029", fingerprint: "0000000000000000" },
        { kind: "category", id: "0000000F", fingerprint: "0000000000000000" },
        { kind: "object", id: 7, fingerprint: "0000000000000000" },
      ],
      kept: [{ kind: "variable", id: "00000029" }],
    };
    expect([...recordedItemKeys([...record.entries, ...record.kept!])]).toEqual(["Trigger/00000029", "Category/0000000F", "Variable/00000029"]);
    expect([...recordedItemKeys([...record.entries, ...record.kept!], ["trigger", "variable"])]).toEqual(["Trigger/00000029", "Variable/00000029"]);
  });

  it("holds each item's text by its type and Id, so neither hides the other", async () => {
    const items = triggerItemTexts(await map());
    expect([...items.keys()]).toEqual(["Trigger/00000029", "Variable/00000029", "Trigger/00000046"]);
    expect(items.get("Variable/00000029")!.text).toContain('<Element Type="Variable" Id="00000029">');
    expect(items.get("Trigger/00000029")!.text).toContain('<Action Type="FunctionCall" Id="A084E60C"/>');
  });

  it("replaces the Trigger the record names by kind and Id, and leaves the Variable with its Id filed where it was", async () => {
    const kept = await map();
    // The compile converted Kept Trigger 00000029: it writes it now, under its own Id.
    const converted = ['    <Element Type="Trigger" Id="00000029">', "    </Element>"];
    const generated = lf(['<?xml version="1.0" encoding="utf-8"?>', "<TriggerData>", "    <Root>", '        <Item Type="Trigger" Id="00000029"/>', "    </Root>", ...converted, "</TriggerData>"]);

    const { content, items } = spliceTriggers(kept, generated, new Set(["Trigger/00000029"]));

    const expected = kept
      .replace('        <Item Type="Trigger" Id="00000029"/>\n', "")
      .replace("    </Root>\n", '        <Item Type="Trigger" Id="00000029"/>\n    </Root>\n')
      .replace(triggerBlock(kept), "")
      .replace("</TriggerData>", `${lf(converted)}</TriggerData>`);
    expect(content).toBe(expected);
    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual(["trigger:00000029"]);
    expect([...triggerItemTexts(content).keys()]).toEqual(["Variable/00000029", "Trigger/00000046", "Trigger/00000029"]);
  });

  describe("in a mod's library", () => {
    // The same cut as a mod's library holds it: inside its Library block, its item lines and references naming the library.
    const library = async (): Promise<string> =>
      (await map())
        .replace("<TriggerData>\n", '<TriggerData>\n    <Library Id="Thn1">\n')
        .replace("</TriggerData>", "    </Library>\n</TriggerData>")
        .replace(/<(\w+) Type="(\w+)" Id="/g, '<$1 Type="$2" Library="Thn1" Id="');
    // The Mod Blueprint's category 0000000F, filing the items it names (type/Id).
    const category = (...items: string[]): string[] => [
      '    <Element Type="Category" Id="0000000F">',
      ...items.map((item) => `        <Item Type="${item.split("/")[0]}" Library="Thn1" Id="${item.split("/")[1]}"/>`),
      "    </Element>",
    ];
    const withCategory = (text: string, ...items: string[]): string =>
      text
        .replace(/ {8}<Item Type="(Trigger|Variable)" Library="Thn1" Id="00000029"\/>\n/g, "")
        .replace("    </Root>\n", '        <Item Type="Category" Library="Thn1" Id="0000000F"/>\n    </Root>\n')
        .replace("    </Library>", `${lf(category(...items))}    </Library>`);
    const generated = (...items: string[]): string =>
      lf(['<?xml version="1.0" encoding="utf-8"?>', "<TriggerData>", '    <Library Id="Thn1">', "    <Root>", '        <Item Type="Category" Library="Thn1" Id="0000000F"/>', "    </Root>", ...category(...items), "    </Library>", "</TriggerData>"]);

    it("files each of the two in the category that files it", async () => {
      const existing = withCategory(await library(), "Trigger/00000029", "Variable/00000029");
      const items = libraryItems(existing, { library: "Thn1" });
      expect(items.get("Trigger/00000029")).toMatchObject({ type: "Trigger", folder: "0000000F" });
      expect(items.get("Variable/00000029")).toMatchObject({ type: "Variable", folder: "0000000F" });
      expect(spliceTriggers(existing, generated("Trigger/00000029", "Variable/00000029"), new Set(["Category/0000000F"]), new Set(), { library: "Thn1" }).content).toBe(existing);
    });

    it("refuses a category that no longer files the Kept Variable, though it still files the Trigger with its Id", async () => {
      const existing = withCategory(await library(), "Trigger/00000029", "Variable/00000029");
      expect(() => spliceTriggers(existing, generated("Trigger/00000029"), new Set(["Category/0000000F"]), new Set(), { library: "Thn1" })).toThrow("without the Kept Variable 00000029 filed there");
    });
  });
});
