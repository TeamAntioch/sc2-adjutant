// Entries own their strings (ADR-0011: localized strings are generated, never authored). A generic
// entry, or a character, holds the strings keyed to it, by strings file: those its catalog's
// convention names for its id (`<Catalog>/<Field>/<id>`, such as Unit/Name/Crane or
// Button/Hotkey/Quay) and those its fields name (UserData text, a ConversationState's names).
// convert-entries moves them with the entry, and the compile writes them. The mod is synthetic.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogSchemaError, compileMod, EquivalenceError } from "../../src/mods/compile-mod.js";
import { convertEntries } from "../../src/mods/convert-entries.js";
import { keptReport } from "../../src/mods/kept-report.js";
import { catalog, cleanupMods, declare, inPackage, type Mod, put, setup, UNIT_FILE } from "./mod-fixture.js";

afterEach(cleanupMods);

const GAME_STRINGS = "enUS.SC2Data/LocalizedData/GameStrings.txt";
const OBJECT_STRINGS = "enUS.SC2Data/LocalizedData/ObjectStrings.txt";
const GAME_HOTKEYS = "enUS.SC2Data/LocalizedData/GameHotkeys.txt";
const CONVERSATION_STRINGS = "enUS.SC2Data/LocalizedData/ConversationStrings.txt";
const USER_FILE = "Base.SC2Data/GameData/UserData.xml";
const BUTTON_FILE = "Base.SC2Data/GameData/ButtonData.xml";
const CHARACTER_FILE = "Base.SC2Data/GameData/CharacterData.xml";

const at = (mod: Mod, file: string) => path.join(mod.modPackage, ...file.split("/"));
const strings = (...lines: string[]) => `﻿${lines.map((line) => `${line}\r\n`).join("")}`;
const readJson = async (mod: Mod, file: string) => JSON.parse(await readFile(path.join(mod.modDir, file), "utf8"));
const keptStrings = async (mod: Mod) => (await keptReport(mod.blueprintPath)).components.find((component) => component.component === "Strings")!.items.map((item) => item.item);

/** The harbour mod with buttons and a user type whose strings the Editor wrote across the three game strings files. */
async function withStrings(): Promise<Mod> {
  const mod = await setup();
  await put(at(mod, BUTTON_FILE), catalog(`<CButton id="Quay"><Icon value="quay.dds"/></CButton>`, `<CButton id="QuayAlt"><Tooltip value="Button/Tooltip/Quay"/></CButton>`));
  await put(
    at(mod, USER_FILE),
    catalog(`<CUser id="Harbour"><Instances Id="Quay"><Text Text="UserData/Harbour/Quay_Name"><Field Id="Name"/></Text></Instances></CUser>`),
  );
  await put(at(mod, GAME_STRINGS), strings("Unit/Name/Crane=Crane", "Unit/Name/Barge=Barge", "Button/Name/Quay=Open Quay", "Button/Tooltip/Quay=Opens the quay.", "UserData/Harbour/Quay_Name=The Quay", "Unit/Name/Gone=Nothing has me"));
  await put(at(mod, OBJECT_STRINGS), strings("Unit/EditorPrefix/Crane=(Harbour)", "Button/EditorSuffix/Quay=(dock)"));
  await put(at(mod, GAME_HOTKEYS), strings("Button/Hotkey/Quay=Q"));
  return mod;
}

describe("convertEntries' strings", () => {
  it("moves the Kept strings its catalog's convention keys to an entry's id into it, by strings file, and the compile converts them unchanged", async () => {
    const mod = await withStrings();
    const before = await Promise.all([GAME_STRINGS, OBJECT_STRINGS, GAME_HOTKEYS].map((file) => inPackage(mod, file)));

    const converted = await convertEntries(mod.blueprintPath, { file: UNIT_FILE });

    expect(converted.strings).toEqual([`string:${GAME_STRINGS}:Unit/Name/Crane`, `string:${OBJECT_STRINGS}:Unit/EditorPrefix/Crane`, `string:${GAME_STRINGS}:Unit/Name/Barge`]);
    const [crane, barge] = await readJson(mod, "entries/UnitData.json");
    expect(crane.strings).toEqual({ [GAME_STRINGS]: { "Unit/Name/Crane": "Crane" }, [OBJECT_STRINGS]: { "Unit/EditorPrefix/Crane": "(Harbour)" } });
    expect(barge.strings).toEqual({ [GAME_STRINGS]: { "Unit/Name/Barge": "Barge" } });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions).toEqual(
      expect.arrayContaining([{ item: `string:${GAME_STRINGS}:Unit/Name/Crane` }, { item: `string:${GAME_STRINGS}:Unit/Name/Barge` }, { item: `string:${OBJECT_STRINGS}:Unit/EditorPrefix/Crane` }]),
    );
    expect(await Promise.all([GAME_STRINGS, OBJECT_STRINGS, GAME_HOTKEYS].map((file) => inPackage(mod, file)))).toEqual(before);
    expect(await keptStrings(mod)).not.toContain(`string:${GAME_STRINGS}:Unit/Name/Crane`);
  });

  it("moves the strings an entry's fields name, such as UserData text, and leaves one another entry is keyed to for that entry", async () => {
    const mod = await withStrings();

    await convertEntries(mod.blueprintPath, { file: USER_FILE });
    const buttons = await convertEntries(mod.blueprintPath, { file: BUTTON_FILE });

    const [user] = await readJson(mod, "entries/UserData.json");
    expect(user.strings).toEqual({ [GAME_STRINGS]: { "UserData/Harbour/Quay_Name": "The Quay" } });
    const [quay, alt] = await readJson(mod, "entries/ButtonData.json");
    // QuayAlt names Quay's tooltip, but the tooltip is Quay's by its key.
    expect(quay.strings).toEqual({
      [GAME_STRINGS]: { "Button/Name/Quay": "Open Quay", "Button/Tooltip/Quay": "Opens the quay." },
      [OBJECT_STRINGS]: { "Button/EditorSuffix/Quay": "(dock)" },
      [GAME_HOTKEYS]: { "Button/Hotkey/Quay": "Q" },
    });
    expect(alt.strings).toBeUndefined();
    expect(buttons.strings).toHaveLength(4);

    await convertEntries(mod.blueprintPath, { file: UNIT_FILE });
    await compileMod(mod.blueprintPath);
    // Only the string nothing in the mod is keyed to stays Kept.
    expect((await keptStrings(mod)).filter((item) => !item.includes("TriggerStrings"))).toEqual([`string:${GAME_STRINGS}:Unit/Name/Gone`]);
  });

  it("leaves a string another catalog's entries are keyed by to them, though a field names it: a sound's subtitle is its conversation's line", async () => {
    const mod = await setup();
    const sounds = "Base.SC2Data/GameData/SoundData.xml";
    await put(at(mod, sounds), catalog(`<CSound id="Quay-01"><AssetArray Subtitle="Conversation/Quay/Line00001"/></CSound>`));
    await put(at(mod, CONVERSATION_STRINGS), strings("Conversation/Quay/Line00001=Mind the gap.", "Sound/Name/Quay-01=Quay 1"));

    const converted = await convertEntries(mod.blueprintPath, { file: sounds });

    expect(converted.strings).toEqual([`string:${CONVERSATION_STRINGS}:Sound/Name/Quay-01`]);
  });

  it("gives an entry the Blueprint already writes its strings on a later run, and moves a raw string of the Blueprint's into its entry", async () => {
    const mod = await withStrings();
    await declare(mod, { strings: { [GAME_STRINGS]: { "Unit/Name/Crane": "Crane", "Unit/Name/Gone": "Nothing has me" } } });
    await convertEntries(mod.blueprintPath, { file: UNIT_FILE });
    // An entry converted before entries had strings.
    const [crane, barge, base] = await readJson(mod, "entries/UnitData.json");
    await writeFile(path.join(mod.modDir, "entries/UnitData.json"), JSON.stringify([{ ...crane, strings: undefined }, { ...barge, strings: undefined }, base]));
    await declare(mod, { strings: { [GAME_STRINGS]: { "Unit/Name/Crane": "Crane", "Unit/Name/Gone": "Nothing has me" } } });

    const again = await convertEntries(mod.blueprintPath, { file: UNIT_FILE });

    expect(again.converted).toEqual([]);
    expect(again.strings).toEqual([`string:${GAME_STRINGS}:Unit/Name/Crane`, `string:${OBJECT_STRINGS}:Unit/EditorPrefix/Crane`, `string:${GAME_STRINGS}:Unit/Name/Barge`]);
    const blueprint = await readJson(mod, "blueprint.json");
    expect(blueprint.strings).toEqual({ [GAME_STRINGS]: { "Unit/Name/Gone": "Nothing has me" } });
    expect((await readJson(mod, "entries/UnitData.json"))[0].strings[GAME_STRINGS]).toEqual({ "Unit/Name/Crane": "Crane" });
    const before = await inPackage(mod, GAME_STRINGS);
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, GAME_STRINGS)).toBe(before);
  });

  it("gives an entry the Blueprint declares for the file its strings before it's ever compiled", async () => {
    const mod = await withStrings();
    await put(at(mod, GAME_STRINGS), strings("Unit/Name/Gull=Gull"));
    await declare(mod, { entries: [{ source: "entries/birds.json" }] }, { "entries/birds.json": JSON.stringify([{ catalog: "Unit", class: "CUnit", id: "Gull", fields: {} }]) });

    const converted = await convertEntries(mod.blueprintPath, { file: UNIT_FILE });

    expect(converted.strings).toContain(`string:${GAME_STRINGS}:Unit/Name/Gull`);
    expect((await readJson(mod, "entries/birds.json"))[0].strings).toEqual({ [GAME_STRINGS]: { "Unit/Name/Gull": "Gull" } });
  });

  it("leaves what another writer owns: the library's strings, a key the compile record lists, a raw string outside the localized strings, and a line with no key", async () => {
    const mod = await withStrings();
    await put(
      at(mod, USER_FILE),
      catalog(`<CUser id="Harbour"><Instances Id="Quay"><Text Text="Trigger/Name/lib_Hbr1_0000000A"><Field Id="Name"/></Text><Text Text="Harbour/Bell"><Field Id="Bell"/></Text></Instances></CUser>`),
    );
    await put(at(mod, GAME_STRINGS), `${await inPackage(mod, GAME_STRINGS)}Harbour/Bell\r\n`);
    await declare(mod, { strings: { [GAME_STRINGS]: { "Unit/Name/Barge": "Barge" }, "Base.SC2Data/Notes.txt": { "Unit/Name/Crane": "Crane" } } });
    await compileMod(mod.blueprintPath);
    // Barge's name is on the record, written by the raw strings; with those gone, another writer has it.
    await declare(mod, { strings: { "Base.SC2Data/Notes.txt": { "Unit/Name/Crane": "Crane" } } });

    const users = await convertEntries(mod.blueprintPath, { file: USER_FILE });
    const units = await convertEntries(mod.blueprintPath, { file: UNIT_FILE });

    expect(users.strings).toEqual([]);
    expect(units.strings).toEqual([`string:${GAME_STRINGS}:Unit/Name/Crane`, `string:${OBJECT_STRINGS}:Unit/EditorPrefix/Crane`]);
    expect((await readJson(mod, "blueprint.json")).strings).toEqual({ "Base.SC2Data/Notes.txt": { "Unit/Name/Crane": "Crane" } });
  });

  it("gives a declared character the strings keyed to it, wherever the Editor put them, in the Blueprint's declaration", async () => {
    const mod = await setup();
    await put(at(mod, CHARACTER_FILE), catalog(`<CCharacter id="CharHarbourmaster"><Variations Name="Character/Name/CharHarbourmaster/Var1"/></CCharacter>`));
    await put(at(mod, GAME_STRINGS), strings("Unit/Name/Crane=Crane", "Character/VoiceRef/CharHarbourmaster=Mara Voice"));
    await put(at(mod, CONVERSATION_STRINGS), strings("Character/Name/CharHarbourmaster=Mara Quill", "Character/Name/CharHarbourmaster/Var1=Portrait", "Character/Dialect/CharHarbourmaster=Coastal"));
    await declare(mod, { characters: [{ speaker: "HARBOURMASTER", id: "CharHarbourmaster", fields: { Variations: { Name: "Character/Name/CharHarbourmaster/Var1" } } }] });

    const converted = await convertEntries(mod.blueprintPath, { file: CHARACTER_FILE });

    expect(converted.converted).toEqual([]);
    expect((await readJson(mod, "blueprint.json")).characters[0].strings).toEqual({
      [GAME_STRINGS]: { "Character/VoiceRef/CharHarbourmaster": "Mara Voice" },
      [CONVERSATION_STRINGS]: { "Character/Name/CharHarbourmaster": "Mara Quill", "Character/Name/CharHarbourmaster/Var1": "Portrait", "Character/Dialect/CharHarbourmaster": "Coastal" },
    });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toEqual(expect.arrayContaining([{ item: `string:${CONVERSATION_STRINGS}:Character/Dialect/CharHarbourmaster` }, { item: `string:${GAME_STRINGS}:Character/VoiceRef/CharHarbourmaster` }]));
    expect((await keptStrings(mod)).filter((item) => item.includes("Character/"))).toEqual([]);
  });
});

describe("compileMod's entry strings", () => {
  it("checks an entry's strings against the Kept ones they replace", async () => {
    const mod = await withStrings();
    await declare(mod, { entries: [{ source: "entries/units.json" }] }, { "entries/units.json": JSON.stringify([{ catalog: "Unit", class: "CUnit", id: "Crane", parent: "Marine", fields: { LifeMax: 120, $comment: '<Speed value="2"/>' }, strings: { [GAME_STRINGS]: { "Unit/Name/Crane": "Big Crane" } } }]) });

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(EquivalenceError);
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/Unit\/Name\/Crane/);
  });

  it("refuses an entry's string that isn't keyed to it, or one in a file that isn't a localized strings file, saying which", async () => {
    const mod = await setup();
    await declare(
      mod,
      { entries: [{ source: "entries/units.json" }] },
      {
        "entries/units.json": JSON.stringify([
          { catalog: "Unit", class: "CUnit", id: "Gull", fields: {}, strings: { [GAME_STRINGS]: { "Unit/Name/Gull": "Gull", "Unit/Name/Tern": "Tern" } } },
          { catalog: "Unit", class: "CUnit", id: "Tern", fields: {}, strings: { "Base.SC2Data/GameData/UnitData.xml": { "Unit/Name/Tern": "Tern" } } },
        ]),
      },
    );

    const error = await compileMod(mod.blueprintPath).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CatalogSchemaError);
    expect((error as Error).message).toContain("CUnit:Gull's string Unit/Name/Tern isn't keyed to it");
    expect((error as Error).message).toContain("CUnit:Tern's strings go in Base.SC2Data/GameData/UnitData.xml, which isn't a localized strings file");
  });
});

describe("a Mod Blueprint's name and description", () => {
  it("compile into GameStrings as DocInfo/Name, DescShort and DescLong, under the Equivalence Check", async () => {
    const mod = await setup();
    await writeFile(at(mod, GAME_STRINGS), strings("Unit/Name/Crane=Crane", "DocInfo/Name=Harbour Story", "DocInfo/DescShort=Any", "DocInfo/DescLong=The harbour's own mod."));
    await declare(mod, { name: "Harbour Story", description: { short: "Any", long: "The harbour's own mod." } });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions).toEqual(expect.arrayContaining([{ item: `string:${GAME_STRINGS}:DocInfo/Name` }, { item: `string:${GAME_STRINGS}:DocInfo/DescShort` }, { item: `string:${GAME_STRINGS}:DocInfo/DescLong` }]));
    expect(await keptStrings(mod)).not.toContain(`string:${GAME_STRINGS}:DocInfo/Name`);

    await declare(mod, { name: "Harbour Tales" });
    await expect(compileMod(mod.blueprintPath)).resolves.toBeDefined();
    expect(await inPackage(mod, GAME_STRINGS)).toContain("DocInfo/Name=Harbour Tales\r\n");
  });

  it("are only the Blueprint's: a raw string can't give them too, even the same", async () => {
    const mod = await setup();
    await declare(mod, { name: "Harbour Story", description: { long: "The harbour's own mod." }, strings: { [GAME_STRINGS]: { "DocInfo/Name": "Harbour Story", "DocInfo/DescLong": "Harbour" } } });

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("The Blueprint's strings give DocInfo/Name, DocInfo/DescLong, which its name and description do: leave them to those");
  });

  it("take a description with a short or a long one", async () => {
    const mod = await setup();
    await declare(mod, { description: {} });

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/short or long/);
  });
});
