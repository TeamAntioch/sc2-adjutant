// Generic typed catalog entries (ADR-0011): a Mod Blueprint's entry (catalog, class, id, parent,
// fields) compiled into its catalog's GameData file and checked against the game's data schema
// (data/catalog-schema.json), and the convert step that turns Kept entries into generic ones.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogSchemaError, compileMod, EquivalenceError } from "../../src/mods/compile-mod.js";
import { convertEntries } from "../../src/mods/convert-entries.js";
import { entryXml, type GenericEntry, genericEntry, readGenericEntries } from "../../src/mods/generic-entries.js";
import { keptReport } from "../../src/mods/kept-report.js";
import { connect, text } from "../mcp/harness.js";
import { catalog, cleanupMods, declare, hashTree, inPackage, type Mod, setup, UNIT_FILE } from "./mod-fixture.js";

afterEach(cleanupMods);

const entries = (...list: unknown[]) => `${JSON.stringify(list, null, 2)}\n`;

describe("compileMod's generic entries", () => {
  it("writes each entry into its catalog's GameData file, fields as Blizzard writes them", async () => {
    const mod = await setup();
    await declare(
      mod,
      { entries: [{ source: "entries/WaterData.json" }] },
      {
        "entries/WaterData.json": entries({
          catalog: "Water",
          class: "CWater",
          id: "HarbourWater",
          parent: "Shakuras",
          fields: {
            State: [
              { index: 0, Name: { value: "[Default]" }, Height: { value: 3.4 } },
              { Name: { value: "Low tide" }, Height: { value: "2.000000" } },
            ],
            ReceiveShadows: 0,
            BeachShoreline: "HarbourShore",
          },
        }),
      },
    );

    await compileMod(mod.blueprintPath);

    expect(await inPackage(mod, "Base.SC2Data/GameData/WaterData.xml")).toBe(
      [
        `<?xml version="1.0" encoding="utf-8"?>`,
        `<Catalog>`,
        `    <CWater id="HarbourWater" parent="Shakuras">`,
        `        <State index="0">`,
        `            <Name value="[Default]"/>`,
        `            <Height value="3.4"/>`,
        `        </State>`,
        `        <State>`,
        `            <Name value="Low tide"/>`,
        `            <Height value="2.000000"/>`,
        `        </State>`,
        `        <ReceiveShadows value="0"/>`,
        `        <BeachShoreline value="HarbourShore"/>`,
        `    </CWater>`,
        `</Catalog>`,
        ``,
      ].join("\n"),
    );
  });

  it("fails an entry with an unknown field, a wrong value type or a class in the wrong catalog, saying which, and writes nothing", async () => {
    const mod = await setup();
    await declare(
      mod,
      { entries: [{ source: "entries/harbour.json" }] },
      {
        "entries/harbour.json": entries(
          { catalog: "Unit", class: "CUnit", id: "Gull", parent: "Critter", fields: { LifeMax: 5, Wingspan: 2 } },
          { catalog: "Unit", class: "CUnit", id: "Tern", fields: { LifeMax: "plenty", WeaponArray: [{ Link: "Beak", Turret: "Head" }] } },
          { catalog: "Unit", class: "CWater", id: "Bay", fields: {} },
          { catalog: "Water", class: "CWater", id: "Cove", fields: { State: { index: 0, Height: { value: "high" }, Depth: { value: 3 } } } },
        ),
      },
    );
    const before = await hashTree(mod.modDir);

    const error = await compileMod(mod.blueprintPath).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CatalogSchemaError);
    expect((error as CatalogSchemaError).problems).toEqual([
      "entries/harbour.json: CUnit:Gull: CUnit has no field Wingspan",
      'entries/harbour.json: CUnit:Tern: LifeMax is a number, not "plenty"',
      "entries/harbour.json: CWater:Bay: CWater is a class of the Water catalog, not Unit",
      'entries/harbour.json: CWater:Cove: State.Height is a number, not "high"',
      "entries/harbour.json: CWater:Cove: State has no field Depth",
    ]);
    expect(await hashTree(mod.modDir)).toEqual(before);
  });
});

describe("readGenericEntries", () => {
  it("refuses a field or attribute name XML can't hold, and id or parent given as attributes", () => {
    const read = (entry: Record<string, unknown>) => () => readGenericEntries(entries({ catalog: "Water", class: "CWater", id: "Cove", ...entry }), "entries/harbour.json");
    expect(read({ fields: { State: { 'Name value="x"/><Evil': { value: 1 } } } })).toThrow("entries/harbour.json isn't a list of generic catalog entries: 0.fields.State");
    expect(read({ fields: { State: { $text: "calm" } } })).not.toThrow();
    expect(read({ attributes: { id: "Bay" } })).toThrow("0.attributes: id and parent are the entry's own");
    expect(read({ attributes: { parent: "Shakuras" } })).toThrow("0.attributes: id and parent are the entry's own");
  });
});

describe("compileMod's catalog file names", () => {
  it("writes an entry into the package's own spelling of its catalog file, with the raw entries the Blueprint writes there", async () => {
    const mod = await setup();
    await writeFile(path.join(mod.modPackage, "Base.SC2Data", "GameData", "waterdata.xml"), catalog(`<CWater id="Cove"/>`, `<CWater id="Bay"/>`));
    await declare(
      mod,
      { gameData: [{ file: "Base.SC2Data/GameData/WaterData.xml", source: "data/water.xml" }], entries: [{ source: "entries/harbour.json" }] },
      { "data/water.xml": catalog(`<CWater id="Bay"><ReceiveShadows value="1"/></CWater>`), "entries/harbour.json": entries({ catalog: "Water", class: "CWater", id: "Cove", fields: { ReceiveShadows: 0 } }) },
    );
    await declare(mod, { acceptedDifferences: ["Cove", "Bay"].map((id) => ({ item: `catalog-entry:Base.SC2Data/GameData/waterdata.xml:CWater:${id}`, reason: "Its shadows change" })) });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.record.entries.filter((entry) => entry.kind === "catalog-entry").map((entry) => `${entry.file}:${entry.id}`)).toEqual(["Base.SC2Data/GameData/waterdata.xml:CWater:Bay", "Base.SC2Data/GameData/waterdata.xml:CWater:Cove"]);
    const text = await inPackage(mod, "Base.SC2Data/GameData/waterdata.xml");
    expect(text).toContain(`<CWater id="Cove">`);
    expect(text).toContain(`<CWater id="Bay">`);
  });
});

describe("compileMod's new catalog files", () => {
  it("refuses a new GameData file a Kept includes list doesn't name, while the Blueprint has no includes, and takes one it names", async () => {
    const mod = await setup();
    const water = { catalog: "Water", class: "CWater", id: "Cove", fields: {} };
    await writeFile(path.join(mod.modPackage, "Base.SC2Data", "GameData.xml"), `<?xml version="1.0" encoding="utf-8"?>\r\n<Includes>\r\n    <Catalog path="GameData/Harbour/HarbourData.xml"/>\r\n</Includes>\r\n`);
    await declare(mod, { gameData: [{ file: "Base.SC2Data/GameData/Gulls.xml", source: "data/Gulls.xml" }] }, { "data/Gulls.xml": catalog(`<CUnit id="Gull"/>`) });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("gameData.0 writes Base.SC2Data/GameData/Gulls.xml, which the package's includes list doesn't name: give the Blueprint its includes");

    await declare(mod, { gameData: [], entries: [{ source: "entries/harbour.json" }] }, { "entries/harbour.json": entries({ ...water, file: "Base.SC2Data/GameData/Harbour/HarbourData.xml" }) });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "Base.SC2Data/GameData/Harbour/HarbourData.xml")).toContain(`    <CWater id="Cove"/>\n`);
  });
});

describe("convertEntries", () => {
  it("writes a catalog file's Kept entries into the Blueprint as generic entries, keeping their ids, and the compile converts them with no accepted differences", async () => {
    const mod = await setup();

    const converted = await convertEntries(mod.blueprintPath, { file: UNIT_FILE });

    const names = "enUS.SC2Data/LocalizedData/GameStrings.txt";
    expect(converted).toEqual({ source: "entries/UnitData.json", converted: ["CUnit:Crane", "CUnit:Barge", "CUnit:HarbourBase"], refused: [], strings: [`string:${names}:Unit/Name/Crane`, `string:${names}:Unit/Name/Barge`] });
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    expect(blueprint.entries).toEqual([{ source: "entries/UnitData.json" }]);
    expect(JSON.parse(await readFile(path.join(mod.modDir, "entries/UnitData.json"), "utf8"))).toEqual([
      { catalog: "Unit", class: "CUnit", id: "Crane", parent: "Marine", fields: { LifeMax: 120, $comment: '<Speed value="2"/>' }, strings: { [names]: { "Unit/Name/Crane": "Crane" } } },
      { catalog: "Unit", class: "CUnit", id: "Barge", parent: "Medivac", fields: { LifeMax: "400.000000", Attributes: { index: "Armored", value: 1 } }, strings: { [names]: { "Unit/Name/Barge": "Barge" } } },
      { catalog: "Unit", class: "CUnit", id: "HarbourBase", attributes: { default: "1" }, fields: {} },
    ]);

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions).toEqual([
      { item: `catalog-entry:${UNIT_FILE}:CUnit:Crane` },
      { item: `catalog-entry:${UNIT_FILE}:CUnit:Barge` },
      { item: `catalog-entry:${UNIT_FILE}:CUnit:HarbourBase` },
      { item: `string:${names}:Unit/Name/Crane` },
      { item: `string:${names}:Unit/Name/Barge` },
    ]);
    const report = await keptReport(mod.blueprintPath);
    expect(report.components.find((component) => component.component === "GameData")!.items.filter((item) => item.file === UNIT_FILE)).toEqual([]);
    // Each entry stands where it stood, the file's comment before them.
    const text = await inPackage(mod, UNIT_FILE);
    expect(text.indexOf("<!-- The harbour's own cranes -->")).toBeLessThan(text.indexOf('<CUnit id="Crane"'));
    expect(text.indexOf('<CUnit id="Crane"')).toBeLessThan(text.indexOf('<CUnit id="Barge"'));
  });

  it("leaves an entry the Blueprint's raw game data writes, however it spells the file", async () => {
    const mod = await setup();
    await declare(mod, { gameData: [{ file: "Base.SC2Data/GameData/unitdata.xml", source: "data/units.xml" }] }, { "data/units.xml": catalog(`<CUnit id="Crane" parent="Marine"/>`) });

    const converted = await convertEntries(mod.blueprintPath, { file: UNIT_FILE });

    expect(converted.converted).toEqual(["CUnit:Barge", "CUnit:HarbourBase"]);
  });
});

describe("convertEntries' breadth", () => {
  const write = (mod: Mod, file: string, ...list: string[]) => writeFile(path.join(mod.modPackage, "Base.SC2Data", "GameData", file), catalog(...list));
  const converts = async (mod: Mod, file: string) => {
    const converted = await convertEntries(mod.blueprintPath, { file: `Base.SC2Data/GameData/${file}` });
    expect(converted.refused).toEqual([]);
    return converted.converted;
  };

  it("keeps the comments inside an entry, each where it stood, among the fields or an array's items", async () => {
    const mod = await setup();
    const lamp = [
      `<CActorModel id="Lamp">`,
      `        <!-- lit at dusk -->`,
      `        <On Terms="ActorCreation" Send="Create"/>`,
      `        <!--On Terms="Dusk" Send="AnimPlay Glow"/-->`,
      `        <On Terms="Dawn" Send="Destroy"/>`,
      `        <Model value="Lamp"/>`,
      `        <HostSiteOps Ops="SOpTop">`,
      `            <!-- not yet -->`,
      `            <HoldPosition value="1"/>`,
      `        </HostSiteOps>`,
      `        <!--<Scale value="2"/>`,
      `        <Opacity value="0.5"/>-->`,
      `        <!-- the end -->`,
      `    </CActorModel>`,
    ].join("\n");
    await write(mod, "ActorData.xml", lamp);

    expect(await converts(mod, "ActorData.xml")).toEqual(["CActorModel:Lamp"]);

    expect(JSON.parse(await readFile(path.join(mod.modDir, "entries/ActorData.json"), "utf8"))[0].fields).toEqual({
      $comment: " lit at dusk ",
      On: [{ Terms: "ActorCreation", Send: "Create" }, { $comment: 'On Terms="Dusk" Send="AnimPlay Glow"/' }, { Terms: "Dawn", Send: "Destroy" }],
      Model: "Lamp",
      HostSiteOps: { Ops: "SOpTop", $comment: " not yet ", HoldPosition: { value: 1 } },
      $comment2: '<Scale value="2"/>\n        <Opacity value="0.5"/>',
      $comment3: " the end ",
    });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toContainEqual({ item: "catalog-entry:Base.SC2Data/GameData/ActorData.xml:CActorModel:Lamp" });
    expect(await inPackage(mod, "Base.SC2Data/GameData/ActorData.xml")).toContain(`    ${lamp}\n`);
  });

  it("refuses a comment the catalog file couldn't hold", async () => {
    const mod = await setup();
    await declare(
      mod,
      { entries: [{ source: "entries/harbour.json" }] },
      {
        "entries/harbour.json": entries(
          { catalog: "Unit", class: "CUnit", id: "Gull", fields: { $comment: "ends early --> here", $comment2: "a -- b", $comment3: "trailing-" } },
          { catalog: "Unit", class: "CUnit", id: "Tern", fields: { $comment: 3, Attributes: [{ index: "Light", value: 1 }, { $comment: "ends --> early" }] } },
        ),
      },
    );

    const error = await compileMod(mod.blueprintPath).catch((caught: unknown) => caught);

    expect((error as CatalogSchemaError).problems).toEqual([
      "entries/harbour.json: CUnit:Gull: $comment holds -->, which would end the comment early",
      "entries/harbour.json: CUnit:Gull: $comment2 holds --, or ends in -, which a comment can't",
      "entries/harbour.json: CUnit:Gull: $comment3 holds --, or ends in -, which a comment can't",
      "entries/harbour.json: CUnit:Tern: $comment is a comment's text, not 3",
      "entries/harbour.json: CUnit:Tern: Attributes[1] holds -->, which would end the comment early",
    ]);
  });

  it("converts a class default, which has no id", async () => {
    const mod = await setup();
    await write(mod, "DSPData.xml", `<CDSPLowPassSimple default="1">\n        <Cutoff value="22000.000000"/>\n    </CDSPLowPassSimple>`, `<CDSPLowPass id="Muffled"/>`);

    expect(await converts(mod, "DSPData.xml")).toEqual(["CDSPLowPassSimple", "CDSPLowPass:Muffled"]);
    expect(JSON.parse(await readFile(path.join(mod.modDir, "entries/DSPData.json"), "utf8"))[0]).toEqual({
      catalog: "DSP",
      class: "CDSPLowPassSimple",
      attributes: { default: "1" },
      fields: { Cutoff: "22000.000000" },
    });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toContainEqual({ item: "catalog-entry:Base.SC2Data/GameData/DSPData.xml:CDSPLowPassSimple" });
    expect(await inPackage(mod, "Base.SC2Data/GameData/DSPData.xml")).toContain(`    <CDSPLowPassSimple default="1">\n        <Cutoff value="22000.000000"/>\n    </CDSPLowPassSimple>\n`);
  });

  it("keeps a template's token declarations, in order, as the Editor writes them", async () => {
    const mod = await setup();
    const glow = [
      `<CActorModel default="1" id="GlowTemplate">`,
      `        <?token id="unitName" type="CUnitLink" value="Bogus"?>`,
      `        <?token id="tint"?>`,
      `        <?token id="abil" type="CAbilLink"?>`,
      `        <Model value="##unitName##"/>`,
      `        <On Terms="Abil.##abil##.Guide" Send="SetTintColor ##tint##"/>`,
      `    </CActorModel>`,
    ].join("\n");
    await write(mod, "ActorData.xml", glow);

    expect(await converts(mod, "ActorData.xml")).toEqual(["CActorModel:GlowTemplate"]);

    expect(JSON.parse(await readFile(path.join(mod.modDir, "entries/ActorData.json"), "utf8"))[0]).toEqual({
      catalog: "Actor",
      class: "CActorModel",
      id: "GlowTemplate",
      attributes: { default: "1" },
      tokens: [{ id: "unitName", type: "CUnitLink", value: "Bogus" }, { id: "tint" }, { id: "abil", type: "CAbilLink" }],
      fields: { Model: "##unitName##", On: { Terms: "Abil.##abil##.Guide", Send: "SetTintColor ##tint##" } },
    });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toContainEqual({ item: "catalog-entry:Base.SC2Data/GameData/ActorData.xml:CActorModel:GlowTemplate" });
    expect(await inPackage(mod, "Base.SC2Data/GameData/ActorData.xml")).toContain(`    ${glow}\n`);
  });

  it("fails the Equivalence Check on a template's token the Blueprint drops or changes, saying which", async () => {
    const mod = await setup();
    await write(mod, "ActorData.xml", [`<CActorArc default="1" id="Guide">`, `        <?token id="abil" type="CAbilLink"?>`, `        <On Terms="Abil.##abil##.Guide" Send="Create"/>`, `    </CActorArc>`].join("\n"), [`<CActorQuad default="1" id="Quad">`, `        <?token id="abil" type="CAbilLink"?>`, `        <LaunchActor value="QuadLaunch"/>`, `    </CActorQuad>`].join("\n"));
    const template = (cls: string, id: string, tokens: unknown, fields: unknown) => ({ catalog: "Actor", class: cls, id, attributes: { default: "1" }, ...(tokens ? { tokens } : {}), fields });
    await declare(
      mod,
      { entries: [{ source: "entries/ActorData.json" }] },
      { "entries/ActorData.json": entries(template("CActorArc", "Guide", undefined, { On: { Terms: "Abil.##abil##.Guide", Send: "Create" } }), template("CActorQuad", "Quad", [{ id: "abil", type: "CUnitLink" }], { LaunchActor: "QuadLaunch" })) },
    );

    const failure = (await compileMod(mod.blueprintPath).catch((error: unknown) => error)) as EquivalenceError;

    expect(failure).toBeInstanceOf(EquivalenceError);
    expect(failure.mismatches.map((mismatch) => mismatch.item)).toEqual(["catalog-entry:Base.SC2Data/GameData/ActorData.xml:CActorArc:Guide", "catalog-entry:Base.SC2Data/GameData/ActorData.xml:CActorQuad:Quad"]);
    expect(failure.mismatches[0]!.detail).toContain('<?token id="abil" type="CAbilLink"?>');
    expect(failure.mismatches[1]!.detail).toContain('<?token id="abil" type="CAbilLink"?> is now <?token id="abil" type="CUnitLink"?>');
  });

  it("refuses two class defaults of one class in one file", async () => {
    const mod = await setup();
    const quiet = { catalog: "DSP", class: "CDSPLowPassSimple", attributes: { default: "1" }, fields: {} };
    await declare(mod, { entries: [{ source: "entries/a.json" }, { source: "entries/b.json" }] }, { "entries/a.json": entries(quiet), "entries/b.json": entries(quiet) });

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("CDSPLowPassSimple is a generic entry in entries/a.json and in entries/b.json: an entry is written once");
  });

  it("knows the fields Blizzard's own entries don't write but the Editor's structures and classes have", async () => {
    const mod = await setup();
    await write(mod, "AbilData.xml", `<CAbilEffectTarget id="Leap"><CmdButtonArray index="Execute" AutoQueueId="Jump" DefaultButtonFace="Leap"/></CAbilEffectTarget>`);
    await write(mod, "ActorData.xml", `<CActorUnit id="Diver"><HostForProps Subject="PropsHost"/></CActorUnit>`, `<CActorForceSphere id="Splash"><Model value="ForceField"/><Radius value="2,0.2"/></CActorForceSphere>`);
    await write(mod, "EffectData.xml", `<CEffectDamage id="Squall"><ImpactLocation History="Damage"/></CEffectDamage>`, `<CEffectModifyUnit id="Reload"><Weapon Weapon="Harpoon" CooldownOperation="Max" CooldownAmount="0.25"/></CEffectModifyUnit>`);
    await write(
      mod,
      "ValidatorData.xml",
      `<CValidatorUnitOrderQueue id="Aiming"><Target Effect="Aim" Value="TargetUnitOrPoint"/></CValidatorUnitOrderQueue>`,
      `<CValidatorUnitOrder id="Aimed"><Target Effect="Aim" Value="TargetPoint"/></CValidatorUnitOrder>`,
      `<CValidatorUnitCompareBehaviorCount id="Shielded"><RequireCasterUnit Effect="Shield" Value="Source"/></CValidatorUnitCompareBehaviorCount>`,
    );
    await write(
      mod,
      "GameUIData.xml",
      `<CGameUI id="Dflt"><SoundData index="Alert" MixerPriorityNonLocal="10" DupeFadeBlend="1"><VolumeRolloffFadeOut value="0.5"/><MaxFadeOut value="2"/><ThresholdFadeTime value="1"/></SoundData></CGameUI>`,
    );

    expect(await converts(mod, "AbilData.xml")).toEqual(["CAbilEffectTarget:Leap"]);
    expect(await converts(mod, "ActorData.xml")).toEqual(["CActorUnit:Diver", "CActorForceSphere:Splash"]);
    expect(await converts(mod, "EffectData.xml")).toEqual(["CEffectDamage:Squall", "CEffectModifyUnit:Reload"]);
    expect(await converts(mod, "ValidatorData.xml")).toEqual(["CValidatorUnitOrderQueue:Aiming", "CValidatorUnitOrder:Aimed", "CValidatorUnitCompareBehaviorCount:Shielded"]);
    expect(await converts(mod, "GameUIData.xml")).toEqual(["CGameUI:Dflt"]);
    await compileMod(mod.blueprintPath);
  });

  it("still refuses a misspelt field in those structures", async () => {
    const mod = await setup();
    await write(mod, "AbilData.xml", `<CAbilEffectTarget id="Leap"><CmdButtonArray index="Execute" AutoQueueID="Jump"/></CAbilEffectTarget>`);

    const converted = await convertEntries(mod.blueprintPath, { file: "Base.SC2Data/GameData/AbilData.xml" });

    expect(converted.refused).toEqual([{ key: "CAbilEffectTarget:Leap", reason: "CAbilEffectTarget:Leap: CmdButtonArray has no field AutoQueueID (did you mean AutoQueueId?)" }]);
  });
});

describe("genericEntry's comments", () => {
  const refusal = (xml: string) => {
    const entry = genericEntry(xml, "Actor");
    return "refused" in entry ? entry.refused : undefined;
  };

  it("refuses an entry whose comment would move, when a field written more than once is grouped", () => {
    expect(refusal(`<CActorModel id="Lamp"><On Terms="A"/><Model value="Lamp"/><!-- after the model --><On Terms="B"/></CActorModel>`)).toBe("written back as a generic entry, a comment in it would move");
  });

  it("still keeps a comment that stays between the same fields", () => {
    expect(refusal(`<CActorModel id="Lamp"><On Terms="A"/><!-- between --><On Terms="B"/><Model value="Lamp"/></CActorModel>`)).toBeUndefined();
  });

  it("refuses an element of a repeated field holding only a comment, with why", () => {
    expect(refusal(`<CActorModel id="Lamp"><On><!-- off --></On><On Terms="B"/></CActorModel>`)).toBe(
      "an On written more than once holds only a comment, which a generic entry's array would read as a comment between its items",
    );
  });

  it("refuses a comment inside a field's text, with why", () => {
    expect(refusal(`<CActorModel id="Lamp"><Name>Lamp<!-- lit --></Name></CActorModel>`)).toBe("Name has both text and a comment");
  });

  it("doesn't read a comment's markup inside CDATA as a comment", () => {
    const entry = genericEntry(`<CActorModel id="Lamp"><Name><![CDATA[<!--lit-->]]></Name></CActorModel>`, "Actor");
    expect(entry).toEqual({ catalog: "Actor", class: "CActorModel", id: "Lamp", fields: { Name: { $text: "<!--lit-->" } } });
  });
});

describe("genericEntry's tokens", () => {
  it("refuses a token declared after a field or comment, or inside a field, which it would move", () => {
    expect(genericEntry(`<CSound default="1" id="Line"><!-- speakers --><?token id="Speaker"?></CSound>`, "Sound")).toEqual({ refused: "it declares a token after a field or comment, or inside a field: a generic entry writes its tokens first" });
    expect(genericEntry(`<CSound default="1" id="Line"><Volume value="1"/><?token id="Speaker"?></CSound>`, "Sound")).toEqual({ refused: "it declares a token after a field or comment, or inside a field: a generic entry writes its tokens first" });
    expect(genericEntry(`<CSound default="1" id="Line"><AssetArray><?token id="Speaker"?></AssetArray></CSound>`, "Sound")).toEqual({ refused: "it declares a token after a field or comment, or inside a field: a generic entry writes its tokens first" });
  });

  it("refuses a token declaration with more than an id, a type and a value", () => {
    expect(genericEntry(`<CSound default="1" id="Line"><?token id="Speaker" kind="text"?></CSound>`, "Sound")).toEqual({ refused: `its token declaration <?token id="Speaker" kind="text"?> isn't an id with a type and value at most` });
    expect(genericEntry(`<CSound default="1" id="Line"><?token type="CUnitLink"?></CSound>`, "Sound")).toHaveProperty("refused");
    expect(genericEntry(`<CSound default="1" id="Line"><?token id="Speaker" type=""?></CSound>`, "Sound")).toMatchObject({ tokens: [{ id: "Speaker", type: "" }] });
  });

  it("refuses tokens on an entry that isn't a template, or one declared twice, in a Kept entry and in a Blueprint", () => {
    expect(genericEntry(`<CSound id="Line"><?token id="Speaker"?></CSound>`, "Sound")).toEqual({ refused: 'it declares tokens and isn\'t a template (default="1")' });
    expect(genericEntry(`<CSound default="1" id="Line"><?token id="Speaker"?><?token id="Speaker" value="X"?></CSound>`, "Sound")).toEqual({ refused: "it declares the token Speaker twice" });
    const sound = (extra: object) => JSON.stringify([{ catalog: "Sound", class: "CSound", id: "Line", ...extra }]);
    expect(() => readGenericEntries(sound({ tokens: [{ id: "Speaker" }] }), "entries/a.json")).toThrow("tokens: Tokens are a template's, for its children");
    expect(() => readGenericEntries(sound({ attributes: { default: "1" }, tokens: [{ id: "Speaker" }, { id: "Speaker" }] }), "entries/a.json")).toThrow("tokens: The token Speaker is declared twice");
  });

  it("writes a template with tokens and no fields open, its tokens inside", () => {
    const xml = `<CSound default="1" id="Line">\n        <?token id="Speaker"?>\n    </CSound>`;
    expect(genericEntry(xml, "Sound")).toEqual({ catalog: "Sound", class: "CSound", id: "Line", attributes: { default: "1" }, tokens: [{ id: "Speaker" }], fields: {} });
    expect(entryXml(genericEntry(xml, "Sound") as GenericEntry)).toBe(`    ${xml}`);
  });
});

describe("class defaults", () => {
  it("refuses an entry with no id that isn't its class's default", () => {
    expect(() => readGenericEntries(entries({ catalog: "Unit", class: "CUnit", fields: { LifeMax: 1 } }), "entries/a.json")).toThrow(
      'entries/a.json isn\'t a list of generic catalog entries: 0: An entry has an id, unless it\'s its class\'s default (attributes: { "default": "1" })',
    );
    expect(genericEntry(`<CLight><Name value="x"/></CLight>`, "Light")).toEqual({ refused: "it has no id, and isn't its class's default (default=\"1\")" });
  });

  it("leaves Kept each entry its file has more than once, which would be written twice", async () => {
    const mod = await setup();
    const quiet = `<CDSPLowPassSimple default="1">\n        <Cutoff value="22000.000000"/>\n    </CDSPLowPassSimple>`;
    await writeFile(path.join(mod.modPackage, "Base.SC2Data", "GameData", "DSPData.xml"), catalog(quiet, `<CDSPLowPass id="Muffled"/>`, quiet));

    const converted = await convertEntries(mod.blueprintPath, { file: "Base.SC2Data/GameData/DSPData.xml" });

    expect(converted.converted).toEqual(["CDSPLowPass:Muffled"]);
    expect(converted.refused).toEqual([
      { key: "CDSPLowPassSimple", reason: "the file has it more than once" },
      { key: "CDSPLowPassSimple", reason: "the file has it more than once" },
    ]);
    await compileMod(mod.blueprintPath);
  });
});

describe("compileMod's preloads", () => {
  it("drops a carried preload once nothing names its file, keeps the rest, and adds none", async () => {
    const mod = await setup();
    const model = (id: string) => `<CModel id="${id}"><Model value="Assets\\Units\\${id}\\${id}.m3"/></CModel>`;
    // Gone and Quay were named only by Barge, which converts naming neither; a cutscene still names Quay.
    await writeFile(path.join(mod.modPackage, "Base.SC2Data", "GameData", "ModelData.xml"), catalog(model("Barge").replace("</CModel>", `<Image value="Assets\\Units\\Gone\\Gone.m3"/><FacialController value="Assets\\Units\\Quay\\Quay.m3"/></CModel>`), model("Crane")).replace(/\n/g, "\r\n"));
    await writeFile(path.join(mod.modPackage, "Base.SC2Data", "Cutscenes", "Quay - Dawn.SC2Cutscene"), `<Cutscene><Model value="Assets\\Units\\Quay\\Quay.m3"/></Cutscene>\r\n`);
    const preloads = ["GameLink:Model;Barge", "AssetFile;Assets\\Units\\Crane\\Crane.m3", "AssetFile;Assets\\Units\\Gone\\Gone.m3", "AssetFile;Assets\\Units\\Quay\\Quay.m3", "AssetFile;Assets\\Units\\Old\\Old.m3", "Bank;Harbour"];
    const info = (values: readonly string[]) => (text: string) => text.replace(/    <Preload>[\s\S]*<\/Preload>\r\n/, `    <Preload>\r\n${values.map((value) => `        <Value>${value}</Value>\r\n`).join("")}    </Preload>\r\n`);
    const documentInfo = path.join(mod.modPackage, "DocumentInfo");
    await writeFile(documentInfo, info(preloads)(await readFile(documentInfo, "utf8")));
    const before = await readFile(documentInfo, "utf8");

    await convertEntries(mod.blueprintPath, { file: "Base.SC2Data/GameData/ModelData.xml", keys: ["CModel:Barge"] });
    const list = JSON.parse(await readFile(path.join(mod.modDir, "entries/ModelData.json"), "utf8"));
    delete list[0].fields.Image;
    delete list[0].fields.FacialController;
    await declare(
      mod,
      { acceptedDifferences: [{ item: "catalog-entry:Base.SC2Data/GameData/ModelData.xml:CModel:Barge", reason: "Its image and facial controller go" }] },
      { "entries/ModelData.json": entries(...list, { catalog: "Model", class: "CModel", id: "Gull", fields: { Model: "Assets\\Units\\Gull\\Gull.m3" } }) },
    );
    await compileMod(mod.blueprintPath);

    expect(await readFile(documentInfo, "utf8")).toBe(
      info([
        "GameLink:Model;Barge",
        "AssetFile;Assets\\Units\\Crane\\Crane.m3",
        "AssetFile;Assets\\Units\\Quay\\Quay.m3",
        "AssetFile;Assets\\Units\\Old\\Old.m3",
        "Bank;Harbour",
      ])(before),
    );
  });

  it("keeps a preload whose file a file the Blueprint writes now names", async () => {
    const mod = await setup();
    await writeFile(path.join(mod.modPackage, "Base.SC2Data", "GameData", "ModelData.xml"), catalog(`<CModel id="Barge"><Model value="Assets\\Units\\Barge\\Barge.m3"/><Image value="Assets\\Units\\Gone\\Gone.m3"/></CModel>`));
    const documentInfo = path.join(mod.modPackage, "DocumentInfo");
    await writeFile(documentInfo, (await readFile(documentInfo, "utf8")).replace("<Value>Bank;Harbour</Value>", "<Value>AssetFile;Assets\\Units\\Gone\\Gone.m3</Value>"));
    const before = await readFile(documentInfo, "utf8");
    await convertEntries(mod.blueprintPath, { file: "Base.SC2Data/GameData/ModelData.xml" });
    const list = JSON.parse(await readFile(path.join(mod.modDir, "entries/ModelData.json"), "utf8"));
    delete list[0].fields.Image;
    await declare(
      mod,
      {
        acceptedDifferences: [
          { item: "catalog-entry:Base.SC2Data/GameData/ModelData.xml:CModel:Barge", reason: "Its image goes" },
          { item: "file:Base.SC2Data/Cutscenes/Quay - Dawn.SC2Cutscene", reason: "The dawn shows the old model" },
        ],
        files: [{ path: "Base.SC2Data/Cutscenes/Quay - Dawn.SC2Cutscene", source: "cutscenes/dawn.SC2Cutscene" }],
      },
      { "entries/ModelData.json": entries(...list), "cutscenes/dawn.SC2Cutscene": `<Cutscene><Model value="Assets\\Units\\Gone\\Gone.m3"/></Cutscene>\r\n` },
    );

    await compileMod(mod.blueprintPath);

    expect(await readFile(documentInfo, "utf8")).toBe(before);
  });
});

describe("the convert_entries tool", () => {
  it("converts a Workspace mod's Kept entries by file, saying what it left Kept and why", async () => {
    const mod = await setup();
    await writeFile(path.join(mod.modPackage, "Base.SC2Data", "GameData", "WaterData.xml"), catalog(`<CWater id="Cove"><ReceiveShadows value="0"/></CWater>`, `<CSplash id="Spray"/>`));
    const client = await connect(mod.workspaceRoot);

    const reply = await client.callTool({ name: "convert_entries", arguments: { mod: "harbour-story", file: "Base.SC2Data/GameData/WaterData.xml" } });

    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({ source: "entries/WaterData.json", converted: ["CWater:Cove"], refused: [{ key: "CSplash:Spray", reason: "CSplash isn't a class the game's data schema has" }], strings: [] });
    expect(text(reply)).toContain("Converted 1 entr");
    expect(text(reply)).toContain("compile_mod");
  });
});
