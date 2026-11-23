import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { compareObjects, comparePreload, compareSaves, compareStrings, formatSaveComparison, placedTypes } from "../../src/map/save-comparison.js";

const objects = (...lines: string[]) => `<?xml version="1.0" encoding="utf-8"?>\n<PlacedObjects Version="27">\n${lines.map((line) => `  ${line}`).join("\n")}\n</PlacedObjects>\n`;
const unit = (id: number, type = "Marine", extra = "") => `<ObjectUnit Id="${id}" Position="1,2,0" Scale="1,1,1" UnitType="${type}"${extra}/>`;
const doodad = (id: number, type = "Tree") => `<ObjectDoodad Id="${id}" Position="3,4,0" Scale="1,1,1" Type="${type}"/>`;

describe("save comparison: Objects", () => {
  const before = objects(unit(1), unit(2), unit(3), doodad(4));

  it("calls a reformatted or reordered element unchanged", () => {
    const after = objects(`<ObjectUnit UnitType="Marine" Scale="1,1,1" Position="1,2,0" Id="1" />`, unit(2), unit(3), doodad(4));
    const result = compareObjects(before, after);
    expect(result.changed).toEqual([]);
    expect(result.unchanged).toBe(4);
  });

  it("sets aside an attribute the Editor drops at its default, as the compile does, and says so", () => {
    const wrote = objects(unit(1, "Marine", ` Rotation="0"`), unit(2));
    const saved = objects(unit(1), unit(2, "Marine", ` Rotation="1.5"`));
    const result = compareObjects(wrote, saved, []);
    expect(result.layoutOnly).toEqual(["1"]);
    expect(result.changed.map((change) => change.id)).toEqual(["2"]);
    expect(result.phantom?.map((change) => change.id)).toEqual(["2"]);
    expect(formatSaveComparison({ objects: result, preload: comparePreload({}), locales: [] }, true)).toContain("re-laid out only");
  });

  it("finds added, removed and changed objects, naming what differs", () => {
    const after = objects(unit(1), unit(3, "Marine", ` Rotation="1.5"`), doodad(4), unit(9));
    const result = compareObjects(before, after);
    expect(result.removed).toEqual(["2"]);
    expect(result.added).toEqual(["9"]);
    expect(result.changed).toEqual([{ id: "3", kind: "ObjectUnit", attributes: ["Rotation"] }]);
  });

  it("separates the Editor's rewrites from the author's own when told which ids were touched", () => {
    const after = objects(unit(1, "Marine", ` Rotation="1"`), unit(3, "Marine", ` Rotation="1.5"`), doodad(4));
    const result = compareObjects(before, after, ["2", "1"]);
    expect(result.phantom.map((change) => change.id)).toEqual(["3"]);
    expect(compareObjects(before, after).phantom).toBeUndefined();
  });

  it("treats an empty touched list as a list: every change is a phantom edit; no list means not asked", () => {
    const after = objects(unit(1, "Marine", ` Rotation="1"`), unit(2), unit(3), doodad(4));
    expect(compareObjects(before, after, []).phantom?.map((change) => change.id)).toEqual(["1"]);
    expect(compareObjects(before, after).phantom).toBeUndefined();
    const report = formatSaveComparison({ objects: compareObjects(before, after), preload: comparePreload({}), locales: [] }, false);
    expect(report).toContain("phantom edits: not asked");
    expect(report).toContain("needs an Editor check");
  });

  it("names what differs among repeated child tags, and does not call a shifted child many changes", () => {
    const entry = (...children: string[]) => objects(`<ObjectUnit Id="1" Position="1,2,0" UnitType="Marine">${children.join("")}</ObjectUnit>`);
    const flag = (index: string, value = "1") => `<Flag Index="${index}" Value="${value}"/>`;
    const one = entry(flag("A"), flag("B"), flag("C"));
    expect(compareObjects(one, entry(flag("A"), flag("B", "0"), flag("C"))).changed[0]!.attributes).toEqual(["Flag[1]@Value"]);
    expect(compareObjects(one, entry(flag("A"), flag("C"))).changed[0]!.attributes).toEqual(["Flag[1] removed"]);
    expect(compareObjects(one, entry(flag("A"), flag("X"), flag("B"), flag("C"))).changed[0]!.attributes).toEqual(["Flag[1] added"]);
    expect(compareObjects(one, entry(flag("A"), flag("B"), flag("C"), flag("D"))).changed[0]!.attributes).toEqual(["Flag[3] added"]);
    expect(compareObjects(entry(flag("A")), entry(flag("A", "0"))).changed[0]!.attributes).toEqual(["Flag@Value"]);
  });

  it("says a missing file is missing rather than unchanged", () => {
    expect(compareObjects(before, undefined).present).toBe(false);
  });
});

describe("save comparison: Preload.xml", () => {
  const placed = objects(unit(1, "Rifleman"), doodad(2, "BelShirTree"), doodad(3, "BelShirTree"));

  it("reads the types an Objects file places", () => {
    expect([...placedTypes(placed)].sort()).toEqual(["Actor:BelShirTree", "Unit:Rifleman"]);
  });

  it("reports placed types with no entry, and entries the save added or dropped", () => {
    const beforePreload = `<Preload>\n<Actor id="SYSTEM_ActorConfig"/>\n<Unit id="Rifleman"/>\n<Unit id="Gone"/>\n</Preload>`;
    const afterPreload = `<Preload>\n<Actor id="SYSTEM_ActorConfig"/>\n<Actor id="BelShirTree" Variations="0"/>\n<Unit id="Rifleman"/>\n</Preload>`;
    const result = comparePreload({ beforePreload, afterPreload, beforeObjects: placed, afterObjects: placed });
    expect(result.missingBefore).toEqual(["Actor:BelShirTree"]);
    expect(result.missingAfter).toEqual([]);
    expect(result.entriesAdded).toEqual(["Actor:BelShirTree"]);
    expect(result.entriesRemoved).toEqual(["Unit:Gone"]);
    expect(result.unusedAfter).toEqual([]);
  });

  it("says nothing was found when neither package has the file", () => {
    expect(comparePreload({ beforeObjects: placed, afterObjects: placed }).present).toBe(false);
  });
});

describe("save comparison: strings", () => {
  it("lists keys a save dropped, added and rewrote", () => {
    const result = compareStrings("deDE", "A=one\nB=two\nC=three\n", "A=one\nC=THREE\nD=four\n");
    expect(result).toMatchObject({ keysBefore: 3, keysAfter: 3, dropped: ["B"], added: ["D"], changed: ["C"] });
  });
});

describe("compareSaves", () => {
  it("reads two package folders, including a locale that vanished", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "compare-saves-"));
    const make = (name: string, files: Record<string, string>) => {
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, name, file)), { recursive: true });
        writeFileSync(path.join(root, name, file), text);
      }
    };
    make("before", { Objects: objects(unit(1), unit(2)), "enUS.SC2Data/LocalizedData/GameStrings.txt": "A=1\n", "deDE.SC2Data/LocalizedData/GameStrings.txt": "A=1\nB=2\n" });
    make("after", { Objects: objects(unit(1)), "enUS.SC2Data/LocalizedData/GameStrings.txt": "A=1\n" });
    const result = await compareSaves(path.join(root, "before"), path.join(root, "after"), ["2"]);
    expect(result.objects.removed).toEqual(["2"]);
    expect(result.locales.find((entry) => entry.locale === "deDE")).toMatchObject({ keysBefore: 2, keysAfter: 0, dropped: ["A", "B"] });
    const report = formatSaveComparison(result, true);
    expect(report).toContain("removed: 2");
    expect(report).toContain("deDE: 2 keys before, 0 after");
  });
});
