// Library breadth, part 3 (ADR-0011): the items a library files beside its functions (categories,
// preset types, structures, comments and custom script) convert into its library interface, and its
// triggers and globals into the Blueprint's triggers with their names (convert-triggers). They
// compile back as the Editor saved them: with all of them, Triggers and TriggerStrings byte for
// byte. The library is synthetic (library-structure-fixture.ts).
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { editorDecisions } from "../../src/map/editor-changes.js";
import { compileMod } from "../../src/mods/compile-mod.js";
import { convertLibrary } from "../../src/mods/convert-library.js";
import { convertTriggers } from "../../src/mods/convert-triggers.js";
import { keptReport } from "../../src/mods/kept-report.js";
import { cleanupMods, declare, hashTree, inPackage, put, setup } from "./mod-fixture.js";
import { STRUCTURE_STRINGS, STRUCTURE_TRIGGERS, withStructureLibrary } from "./library-structure-fixture.js";

afterEach(cleanupMods);

const STRINGS = "enUS.SC2Data/LocalizedData/TriggerStrings.txt";

async function harbour() {
  const mod = await setup();
  await withStructureLibrary(mod);
  return mod;
}

const keptIn = async (blueprintPath: string, component: string, file: string) =>
  (await keptReport(blueprintPath)).components
    .find((each) => each.component === component)!
    .items.filter((item) => item.file === file)
    .map((item) => item.item);

/** The item lines that file `id`, anywhere in a Triggers file. */
const filings = (xml: string, id: string) => xml.split(/\r?\n/).filter((line) => new RegExp(`<Item Type="\\w+" Library="Hbr1" Id="${id}"/>`).test(line)).length;

describe("a library's categories, preset types, structures, comments and custom script", () => {
  it("convert into the library interface, and compile back equivalent to the Editor's, a recompile changing nothing", async () => {
    const mod = await harbour();

    const converted = await convertLibrary(mod.blueprintPath);
    expect(converted.refused).toEqual([]);
    expect(converted.converted).toEqual(["Ring Bell", "Tide Height"]);
    expect(converted.items).toEqual(["Harbour", "Presets", "Bell Tone", "Gull Sound", "Crate Record", "comment 0000D010", "Harbour Script"]);
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    expect(blueprint.library.root).toEqual(["category:00000001"]);
    expect(blueprint.library.categories[0]).toEqual({
      id: "00000001",
      name: "Harbour",
      items: ["trigger:0000000A", "function:0000B001", "function:0000C001", "trigger:0000000F", "variable:0000000D", "structure:0000D001", "comment:0000D010", "custom-script:0000D020", "category:00000002"],
    });
    expect(blueprint.library.presets[0]).toEqual({ id: "0000D030", name: "Bell Tone", baseType: "int", custom: true, constants: true, values: [{ id: "0000D031", name: "Low", value: "0", default: true }, { id: "0000D032", name: "High", value: "1" }] });
    expect(blueprint.library.customScripts).toEqual([{ id: "0000D020", name: "Harbour Script", identifier: "harbourMain", script: 'include "scripts/harbour"', initFunction: "Harbour_Init" }]);

    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions.filter((conversion) => conversion.accepted !== undefined)).toEqual([]);
    expect(compiled.conversions.map((conversion) => conversion.item)).toEqual(
      expect.arrayContaining(["category:00000001", "category:00000002", "preset:0000D030", "preset:0000D040", "structure:0000D001", "comment:0000D010", "custom-script:0000D020"]),
    );
    // The Kept triggers and global stay, each filed once in the category the interface now writes.
    const triggers = await inPackage(mod, "Triggers");
    for (const id of ["0000000A", "0000000F", "0000000D"]) expect(filings(triggers, id), id).toBe(1);
    expect(await inPackage(mod, STRINGS)).toBe(STRUCTURE_STRINGS);
    expect(await keptIn(mod.blueprintPath, "Triggers", "Triggers")).toEqual(["trigger:0000000A", "trigger:0000000F", "variable:0000000D"]);

    const first = await hashTree(mod.modDir);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modDir)).toEqual(first);
  });
});

describe("convert-triggers", () => {
  it("converts the library's triggers and globals with their names, so with the interface Triggers and TriggerStrings compile byte for byte, with nothing Kept", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath);

    const converted = await convertTriggers(mod.blueprintPath);
    expect(converted).toEqual({ converted: ["Open Quay", "Close Quay", "Tide"], refused: [], strings: [] });
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    expect(blueprint.triggers).toEqual({ source: "library/triggers.xml", names: { "0000000A": "Open Quay", "0000000F": "Close Quay", "00000010": "Gate", "0000000D": "Tide" } });

    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions.filter((conversion) => conversion.accepted !== undefined)).toEqual([]);
    expect(compiled.conversions.map((conversion) => conversion.item)).toEqual(expect.arrayContaining(["trigger:0000000A", "trigger:0000000F", "variable:0000000D", `string:${STRINGS}:Variable/Name/lib_Hbr1_00000010`]));
    expect(compiled.warnings.filter((warning) => warning.includes("has no name"))).toEqual([]);
    expect(await inPackage(mod, "Triggers")).toBe(STRUCTURE_TRIGGERS);
    expect(await inPackage(mod, STRINGS)).toBe(STRUCTURE_STRINGS);
    expect(await keptIn(mod.blueprintPath, "Triggers", "Triggers")).toEqual([]);
    expect(await keptIn(mod.blueprintPath, "Strings", STRINGS)).toEqual([]);

    const first = await hashTree(mod.modDir);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modDir)).toEqual(first);
  });

  it("converts the named ones only, and leaves what the Blueprint already has", async () => {
    const mod = await harbour();
    expect(await convertTriggers(mod.blueprintPath, { items: ["Tide"] })).toEqual({ converted: ["Tide"], refused: [], strings: [] });
    expect(await convertTriggers(mod.blueprintPath, { items: ["Tide", "0000000A"] })).toEqual({ converted: ["Open Quay"], refused: [{ item: "Tide", reason: "the Blueprint already has it, or the last compile wrote it" }], strings: [] });
    await expect(convertTriggers(mod.blueprintPath, { items: ["Lighthouse"] })).rejects.toThrow("The library Hbr1 has no trigger or global Lighthouse");

    await compileMod(mod.blueprintPath);
    // Filed in Kept categories, they stay filed there.
    const kept = await keptIn(mod.blueprintPath, "Triggers", "Triggers");
    expect(kept).toContain("trigger:0000000F");
    expect(kept).not.toContain("trigger:0000000A");
    expect(kept).not.toContain("variable:0000000D");
    const triggers = await inPackage(mod, "Triggers");
    for (const id of ["0000000A", "0000000D"]) expect(filings(triggers, id), id).toBe(1);
    expect(triggers).toMatch(/<Element Type="Category" Id="00000001">(?:(?!<\/Element>)[\s\S])*Id="0000000D"\/>/);
    expect(await inPackage(mod, STRINGS)).toBe(STRUCTURE_STRINGS);
  });
});

describe("after a conversion", () => {
  it("an item the author kept as the Editor changed it stays filed in the category the compile writes", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath);
    await convertTriggers(mod.blueprintPath);
    await compileMod(mod.blueprintPath);
    const edited = STRUCTURE_TRIGGERS.replace(`        <Element Type="Trigger" Id="0000000F">\r\n            <Disabled/>\r\n`, `        <Element Type="Trigger" Id="0000000F">\r\n`);
    await put(path.join(mod.modPackage, "Triggers"), edited);

    await compileMod(mod.blueprintPath, { decisions: editorDecisions({ keep: ["trigger:0000000F"] }) });
    const triggers = await inPackage(mod, "Triggers");
    expect(filings(triggers, "0000000F")).toBe(1);
    expect(triggers).not.toContain(`<Element Type="Trigger" Id="0000000F">\r\n            <Disabled/>`);
  });

  it("Root's order leaves out a Kept item the package no longer has", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath);
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    await declare(mod, { library: { ...blueprint.library, root: [...blueprint.library.root, "trigger:0000ABCD"] } });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "Triggers")).not.toContain("0000ABCD");
  });
});

describe("the compile refuses", () => {
  it("an element of the Blueprint's triggers that none of their triggers or globals reaches", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath);
    await convertTriggers(mod.blueprintPath);
    const source = path.join(mod.modDir, "library", "triggers.xml");
    const text = await readFile(source, "utf8");
    await put(source, text.replace("    </Library>", `        <Element Type="Param" Id="0000EEE1">\n            <Value>1</Value>\n            <ValueType Type="int"/>\n        </Element>\n    </Library>`));
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("The Mod Blueprint's triggers hold element 0000EEE1, which no trigger or global of theirs reaches");
  });

  it("a category filing an item neither the Blueprint nor the package has", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath);
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    blueprint.library.categories[1].items.push("preset:0000EEEE");
    await declare(mod, { library: blueprint.library });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("library.categories.1.items.2 (Presets) files preset:0000EEEE, which neither the Blueprint nor the package has");
  });

  it("a category that no longer files a Kept item filed there, which would be lost", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath);
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    blueprint.library.categories[0].items = blueprint.library.categories[0].items.filter((ref: string) => ref !== "trigger:0000000F");
    await declare(mod, { library: blueprint.library });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("without the Kept Trigger 0000000F filed there");
  });

  it("a name in triggers.names for an element its triggers don't have", async () => {
    const mod = await harbour();
    await convertTriggers(mod.blueprintPath);
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    await declare(mod, { triggers: { ...blueprint.triggers, names: { ...blueprint.triggers.names, "0000B001": "Ring Bell" } } });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("triggers.names names 0000B001, which isn't an element of the Blueprint's triggers");
  });

  it("a name in triggers.names for an Id that is both a trigger's and a global's, as an older save numbers them (#1002)", async () => {
    const mod = await harbour();
    await convertTriggers(mod.blueprintPath);
    const source = path.join(mod.modDir, "library", "triggers.xml");
    // The global Tide (0000000D) renumbered to the Id of the trigger Open Quay (0000000A).
    await put(source, (await readFile(source, "utf8")).replaceAll(`Id="0000000D"`, `Id="0000000A"`));
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    const { "0000000D": tide, ...names } = blueprint.triggers.names;
    expect(tide).toBeDefined();
    await declare(mod, { triggers: { ...blueprint.triggers, names } });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("triggers.names names 0000000A, which is both a Trigger and a Variable of the Blueprint's triggers: a name given by Id can't tell which it names");
  });

  it("an item filed twice", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath);
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    blueprint.library.categories[1].items.push("trigger:0000000A");
    await declare(mod, { library: blueprint.library });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("trigger:0000000A is filed in both categories.0 (Harbour) and categories.1 (Presets): an item is filed once");
  });
});

describe("convert-library leaves Kept", () => {
  it("an item holding a form it doesn't write yet, with why", async () => {
    const mod = await harbour();
    const triggers = STRUCTURE_TRIGGERS.replace(`            <BaseType Value="string"/>\r\n`, `            <Identifier>GullSound</Identifier>\r\n            <BaseType Value="string"/>\r\n`);
    await put(path.join(mod.modPackage, "Triggers"), triggers);
    const converted = await convertLibrary(mod.blueprintPath);
    expect(converted.refusedItems).toEqual([{ item: "Gull Sound", reason: "its Preset 0000D040 has a <Identifier>, which a conversion doesn't write yet" }]);
    // The category filing it still converts: it files the Kept preset type.
    expect(converted.items).toContain("Presets");
    await compileMod(mod.blueprintPath);
    expect(await keptIn(mod.blueprintPath, "Triggers", "Triggers")).toContain("preset:0000D040");
  });
});
