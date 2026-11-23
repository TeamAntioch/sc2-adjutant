// Characters (ADR-0011), the first purpose-level shape: a Campaign Mod's Blueprint declares each
// speaker once (its CCharacter id, what an off-map Transmission shows, its CharacterData fields and
// its placeholder voice), the mod compile writes it into CharacterData as a generic entry, and a
// Mission compile names its Screenplay's speakers from it. The mod and the Campaign are synthetic.
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogSchemaError, compileMod, EquivalenceError } from "../../src/mods/compile-mod.js";
import { convertEntries } from "../../src/mods/convert-entries.js";
import { readModBlueprint } from "../../src/mods/workspace-mods.js";
import { cleanupMods, declare, inPackage, type Mod, put, setup } from "./mod-fixture.js";

afterEach(cleanupMods);

const CHARACTER_FILE = "Base.SC2Data/GameData/CharacterData.xml";

/** The Harbourmaster as the Editor made her in the mod's CharacterData. */
const KEPT_CHARACTERS = [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<Catalog>`,
  `    <CCharacter id="CharDockhand"/>`,
  `    <CCharacter id="CharHarbourmaster">`,
  `        <Gender value="Female"/>`,
  `        <Race value="Terran"/>`,
  `        <Unit value="Crane"/>`,
  `        <Variations Name="Character/Name/CharHarbourmaster/Var1" Model="HarbourmasterPortrait"/>`,
  `    </CCharacter>`,
  `</Catalog>`,
  ``,
].join("\r\n");

const HARBOURMASTER = {
  speaker: "HARBOURMASTER",
  id: "CharHarbourmaster",
  unit: "Crane",
  model: "HarbourmasterPortrait",
  voice: "Moira",
  fields: { Gender: "Female", Race: "Terran", Variations: { Name: "Character/Name/CharHarbourmaster/Var1" } },
};

async function withKeptCharacters(): Promise<Mod> {
  const mod = await setup();
  await put(path.join(mod.modPackage, ...CHARACTER_FILE.split("/")), KEPT_CHARACTERS);
  return mod;
}

describe("a Mod Blueprint's characters", () => {
  it("compile into CharacterData as CCharacters: the unit as Unit, the portrait model in Variations, beside the Kept ones", async () => {
    const mod = await withKeptCharacters();
    await declare(mod, { characters: [HARBOURMASTER] });

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions).toEqual([{ item: `catalog-entry:${CHARACTER_FILE}:CCharacter:CharHarbourmaster` }]);
    const text = await inPackage(mod, CHARACTER_FILE);
    expect(text).toContain(`    <CCharacter id="CharDockhand"/>\r\n`);
    expect(text).toContain(`<Unit value="Crane"/>`);
    expect(text).toContain(`<Variations Name="Character/Name/CharHarbourmaster/Var1" Model="HarbourmasterPortrait"/>`);
  });

  it("fail the Equivalence check when one drifts from the Kept original, and pass with the drift accepted", async () => {
    const mod = await withKeptCharacters();
    await declare(mod, { characters: [{ ...HARBOURMASTER, unit: "Barge" }] });

    const failure = await compileMod(mod.blueprintPath).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EquivalenceError);
    expect((failure as Error).message).toContain(`catalog-entry:${CHARACTER_FILE}:CCharacter:CharHarbourmaster: <Unit value="Crane"> is now <Unit value="Barge">`);

    const item = `catalog-entry:${CHARACTER_FILE}:CCharacter:CharHarbourmaster`;
    await declare(mod, { acceptedDifferences: [{ item, reason: "Her Transmissions show the barge she runs" }] });
    expect((await compileMod(mod.blueprintPath)).conversions).toEqual([{ item, accepted: "Her Transmissions show the barge she runs" }]);
  });

  it("are checked against the game's data schema, as generic entries are", async () => {
    const mod = await withKeptCharacters();
    await declare(mod, { characters: [{ ...HARBOURMASTER, fields: { Wingspan: 2 } }] });
    const failure = await compileMod(mod.blueprintPath).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CatalogSchemaError);
    expect((failure as Error).message).toContain("CCharacter has no field Wingspan");
  });

  it("refuse a CharacterData entry written twice, as a character and as a generic entry", async () => {
    const mod = await withKeptCharacters();
    await declare(
      mod,
      { characters: [HARBOURMASTER], entries: [{ source: "entries.json" }] },
      { "entries.json": JSON.stringify([{ catalog: "Character", class: "CCharacter", id: "CharHarbourmaster", fields: {} }]) },
    );
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("CCharacter:CharHarbourmaster is a generic entry in entries.json and in the Blueprint's characters (HARBOURMASTER)");
  });

  it("are refused by the Blueprint when two speakers read as one, two share an id, or a field says what unit or model already does", async () => {
    const mod = await setup();
    const refused = async (characters: unknown[]) => {
      await declare(mod, { characters });
      return readModBlueprint(mod.blueprintPath).then(
        () => "",
        (error: Error) => error.message,
      );
    };
    expect(await refused([HARBOURMASTER, { speaker: "harbourmaster ", id: "CharOther" }])).toContain("HARBOURMASTER is declared twice");
    expect(await refused([HARBOURMASTER, { speaker: "DOCKHAND", id: "CharHarbourmaster" }])).toContain("CharHarbourmaster is the id of two characters");
    expect(await refused([{ ...HARBOURMASTER, fields: { Unit: "Barge" } }])).toContain("unit");
    expect(await refused([{ ...HARBOURMASTER, fields: { Variations: { Model: "Other" } } }])).toContain("model");
    expect(await refused([{ ...HARBOURMASTER, fields: { Variations: "Other" } }])).toContain("give Variations as one structure");
  });

  it("are compiled into a package with no CharacterData yet as a new catalog file", async () => {
    const mod = await setup();
    await declare(mod, { characters: [{ speaker: "DOCKHAND", id: "CharDockhand", voice: "Fred" }] });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, CHARACTER_FILE)).toBe(`<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n    <CCharacter id="CharDockhand"/>\n</Catalog>\n`);
  });
});

describe("convert-entries", () => {
  it("leaves a declared character to its declaration, converting the rest of CharacterData", async () => {
    const mod = await withKeptCharacters();
    await declare(mod, { characters: [HARBOURMASTER] });
    const converted = await convertEntries(mod.blueprintPath, { file: CHARACTER_FILE });
    expect(converted.converted).toEqual(["CCharacter:CharDockhand"]);
  });
});
