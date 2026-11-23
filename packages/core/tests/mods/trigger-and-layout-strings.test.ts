// The strings two more owners write (ADR-0011, docs/reference/mod-strings.md): the Blueprint's
// triggers write their text parameters' values, Param/Value/lib_<library>_<id>, and a UI layout
// in the Blueprint's files writes the strings it names as @<key>. Each goes in the strings file
// the package has it in, under the Equivalence Check. convert-triggers and convert-files take
// them from the Kept strings or the raw ones, and give those an owner converted earlier didn't
// take then. Harbour-Story is synthetic.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileMod } from "../../src/mods/compile-mod.js";
import { convertFiles } from "../../src/mods/convert-files.js";
import { convertTriggers } from "../../src/mods/convert-triggers.js";
import { EquivalenceError } from "../../src/mods/equivalence.js";
import { keptReport } from "../../src/mods/kept-report.js";
import { cleanupMods, declare, GAME_STRINGS, hashTree, inPackage, put, setup, TRIGGERS } from "./mod-fixture.js";

afterEach(cleanupMods);

const GAME = "enUS.SC2Data/LocalizedData/GameStrings.txt";
const LAYOUT = "Base.SC2Data/UI/Layout/Harbour.SC2Layout";
const VALUE_KEY = "Param/Value/lib_Hbr1_0000000C";

/** The fixture's trigger with a text parameter, 0000000C, and an int one, 0000000E. */
const TEXT_TRIGGERS = TRIGGERS.replace(
  `            <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000001"/>\r\n        </Element>\r\n`,
  [
    `            <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000001"/>`,
    `            <Parameter Type="Param" Library="Hbr1" Id="0000000C"/>`,
    `            <Parameter Type="Param" Library="Hbr1" Id="0000000E"/>`,
    `        </Element>`,
    `        <Element Type="Param" Id="0000000C">`,
    `            <ParameterDef Type="ParamDef" Library="Ntve" Id="00000002"/>`,
    `            <ValueType Type="text"/>`,
    `        </Element>`,
    `        <Element Type="Param" Id="0000000E">`,
    `            <ParameterDef Type="ParamDef" Library="Ntve" Id="00000003"/>`,
    `            <Value>2</Value>`,
    `            <ValueType Type="int"/>`,
    `        </Element>`,
    ``,
  ].join("\r\n"),
);

const LAYOUT_TEXT = `<Desc>\r\n    <Frame type="Label" name="Title">\r\n        <Style val="@HarbourTitle"/>\r\n        <Text val="@UI/Harbour/Title"/>\r\n    </Frame>\r\n</Desc>\r\n`;

/** Harbour-Story with a text parameter's value and a layout's string in GameStrings, between the units' names. */
async function harbour() {
  const mod = await setup();
  await put(path.join(mod.modPackage, "Triggers"), TEXT_TRIGGERS);
  await put(path.join(mod.modPackage, ...LAYOUT.split("/")), LAYOUT_TEXT);
  await put(path.join(mod.modPackage, ...GAME.split("/")), GAME_STRINGS.replace("Unit/Name/Barge", `${VALUE_KEY}=Quay open\r\nUI/Harbour/Title=The Harbour\r\nUnit/Name/Barge`));
  return mod;
}

const keptStrings = async (blueprintPath: string) => (await keptReport(blueprintPath)).components.find((each) => each.component === "Strings")?.items.map((item) => item.item) ?? [];

describe("a trigger's text parameter values", () => {
  it("convert-triggers takes them with the trigger, and the compile writes them back byte for byte, a recompile changing nothing", async () => {
    const mod = await harbour();
    const before = await inPackage(mod, GAME);

    expect(await convertTriggers(mod.blueprintPath)).toEqual({ converted: ["Open Quay"], refused: [], strings: [`string:${GAME}:${VALUE_KEY}`] });
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    expect(blueprint.triggers.strings).toEqual({ [GAME]: { [VALUE_KEY]: "Quay open" } });

    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions.map((conversion) => conversion.item)).toContain(`string:${GAME}:${VALUE_KEY}`);
    expect(await inPackage(mod, GAME)).toBe(before);
    expect(await keptStrings(mod.blueprintPath)).not.toContain(`string:${GAME}:${VALUE_KEY}`);

    const first = await hashTree(mod.modDir);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modDir)).toEqual(first);
  });

  it("gives triggers converted earlier the values they didn't take then, from the raw strings over the Kept ones, which they leave", async () => {
    const mod = await harbour();
    await convertTriggers(mod.blueprintPath);
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    await declare(mod, { triggers: { source: blueprint.triggers.source, names: blueprint.triggers.names }, strings: { [GAME]: { [VALUE_KEY]: "Quay opened", "Unit/Name/Crane": "Crane" } } });

    expect(await convertTriggers(mod.blueprintPath)).toEqual({ converted: [], refused: [], strings: [`string:${GAME}:${VALUE_KEY}`] });
    const next = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    expect(next.triggers.strings).toEqual({ [GAME]: { [VALUE_KEY]: "Quay opened" } });
    expect(next.strings).toEqual({ [GAME]: { "Unit/Name/Crane": "Crane" } });
  });

  it("leaves a value that removals names", async () => {
    const mod = await harbour();
    await declare(mod, { removals: [{ item: `string:${GAME}:${VALUE_KEY}`, reason: "The quay has no sign" }] });

    expect((await convertTriggers(mod.blueprintPath)).strings).toEqual([]);
    expect(JSON.parse(await readFile(mod.blueprintPath, "utf8")).triggers.strings).toBeUndefined();
  });

  it("a value that differs from the Kept one is an EquivalenceError", async () => {
    const mod = await harbour();
    await convertTriggers(mod.blueprintPath);
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    await declare(mod, { triggers: { ...blueprint.triggers, strings: { [GAME]: { [VALUE_KEY]: "Quay shut" } } } });

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(EquivalenceError);
  });

  it("the compile refuses a value of a parameter that isn't a text one of the triggers", async () => {
    const mod = await harbour();
    await convertTriggers(mod.blueprintPath);
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    for (const key of ["Param/Value/lib_Hbr1_0000000E", "Param/Value/lib_Hbr1_00000099", "Param/Value/lib_Other_0000000C", "Unit/Name/Crane"]) {
      await declare(mod, { triggers: { ...blueprint.triggers, strings: { [GAME]: { [key]: "Two" } } } });
      await expect(compileMod(mod.blueprintPath), key).rejects.toThrow(/triggers\.strings/);
    }
  });
});

describe("a UI layout's strings", () => {
  it("convert-files takes the strings a layout names with it, and the compile writes them back byte for byte", async () => {
    const mod = await harbour();
    const before = await inPackage(mod, GAME);

    const converted = await convertFiles(mod.blueprintPath, { paths: [LAYOUT] });
    expect(converted).toEqual({ converted: [LAYOUT], refused: [], strings: [`string:${GAME}:UI/Harbour/Title`] });
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    expect(blueprint.files).toEqual([{ path: LAYOUT, source: "UI/Layout/Harbour.SC2Layout", strings: { [GAME]: { "UI/Harbour/Title": "The Harbour" } } }]);

    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions.map((conversion) => conversion.item)).toContain(`string:${GAME}:UI/Harbour/Title`);
    expect(await inPackage(mod, GAME)).toBe(before);
    expect(await keptStrings(mod.blueprintPath)).not.toContain(`string:${GAME}:UI/Harbour/Title`);

    const first = await hashTree(mod.modDir);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modDir)).toEqual(first);
  });

  it("gives a layout the Blueprint already writes the strings it didn't take then", async () => {
    const mod = await harbour();
    await declare(mod, { files: [{ path: LAYOUT, source: "UI/Layout/Harbour.SC2Layout" }] }, { "UI/Layout/Harbour.SC2Layout": LAYOUT_TEXT });

    expect(await convertFiles(mod.blueprintPath)).toEqual({ converted: [Base("scripts/harbour.galaxy")], refused: [], strings: [`string:${GAME}:UI/Harbour/Title`] });
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    expect(blueprint.files[0]).toEqual({ path: LAYOUT, source: "UI/Layout/Harbour.SC2Layout", strings: { [GAME]: { "UI/Harbour/Title": "The Harbour" } } });
  });

  it("gives a key two layouts name to one of them only", async () => {
    const mod = await harbour();
    const other = "Base.SC2Data/UI/Layout/Quay.SC2Layout";
    await put(path.join(mod.modPackage, ...other.split("/")), LAYOUT_TEXT);

    const converted = await convertFiles(mod.blueprintPath);
    expect(converted.strings).toEqual([`string:${GAME}:UI/Harbour/Title`]);
    const files = JSON.parse(await readFile(mod.blueprintPath, "utf8")).files as { path: string; strings?: unknown }[];
    expect(files.filter((file) => file.strings !== undefined).map((file) => file.path)).toHaveLength(1);
    await compileMod(mod.blueprintPath);
  });

  it("a layout's string that differs from the Kept one is an EquivalenceError", async () => {
    const mod = await harbour();
    await declare(mod, { files: [{ path: LAYOUT, source: "UI/Layout/Harbour.SC2Layout", strings: { [GAME]: { "UI/Harbour/Title": "The Docks" } } }] }, { "UI/Layout/Harbour.SC2Layout": LAYOUT_TEXT });

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(EquivalenceError);
  });

  it("the compile refuses a string a file's strings give that the file doesn't name", async () => {
    const mod = await harbour();
    await declare(mod, { files: [{ path: LAYOUT, source: "UI/Layout/Harbour.SC2Layout", strings: { [GAME]: { "UI/Harbour/Subtitle": "Gulls" } } }] }, { "UI/Layout/Harbour.SC2Layout": LAYOUT_TEXT });

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/files\.0.*UI\/Harbour\/Subtitle/);
  });
});

const Base = (file: string) => `Base.SC2Data/${file}`;
