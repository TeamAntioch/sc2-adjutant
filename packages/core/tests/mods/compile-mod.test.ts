// Compiling a mod (ADR-0011 on ADR-0010): a Mod Blueprint's Compiled Content goes into the
// committed mod package beside it, each writer replacing only what the compile record lists and
// leaving Kept bytes as the Editor wrote them, under the Equivalence check. The mod is synthetic:
// an Editor-made Campaign Mod imported into a Workspace, everything in it Kept.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EditorChangesError } from "../../src/map/editor-changes.js";
import { readDependencies } from "../../src/map/read-dependencies.js";
import { readDocumentHeader, readDocumentHeaderDependencies } from "../../src/map/read-document-header.js";
import { compileMod, EquivalenceError } from "../../src/mods/compile-mod.js";
import { formatKeptReport, keptReport } from "../../src/mods/kept-report.js";
import { connect, text } from "../mcp/harness.js";
import { catalog, cleanupMods, COMPONENTS, declare, DEPENDENCIES, documentHeader, GAME_STRINGS, hashTree, inPackage, type Mod, put, setup, TRIGGERS, UNIT_DATA, UNIT_FILE } from "./mod-fixture.js";

afterEach(cleanupMods);

describe("compileMod's GameData writer, by entry", () => {
  it("adds a Compiled entry to a catalog file with Kept entries, every Kept entry's bytes as they were", async () => {
    const mod = await setup();
    await declare(mod, { gameData: [{ file: UNIT_FILE, source: "data/UnitData.xml" }] }, { "data/UnitData.xml": catalog(`<CUnit id="Gull" parent="Critter"><LifeMax value="5"/></CUnit>`) });

    const compiled = await compileMod(mod.blueprintPath);

    const text = await inPackage(mod, UNIT_FILE);
    expect(text).toBe(UNIT_DATA.replace(`    <CUnit default="1" id="HarbourBase"/>\r\n`, `    <CUnit default="1" id="HarbourBase"/>\r\n    <CUnit id="Gull" parent="Critter"><LifeMax value="5"/></CUnit>\r\n`));
    expect(compiled.record.entries).toContainEqual(expect.objectContaining({ kind: "catalog-entry", file: UNIT_FILE, id: "CUnit:Gull" }));
  });
});

describe("compileMod's writers", () => {
  /** A Blueprint with a part in each writer, none of them over a Kept part. */
  async function everyWriter(mod: Mod) {
    await declare(
      mod,
      {
        gameData: [
          { file: UNIT_FILE, source: "data/UnitData.xml" },
          { file: "Base.SC2Data/GameData/SoundData.xml", source: "data/SoundData.xml" },
        ],
        strings: { "enUS.SC2Data/LocalizedData/GameStrings.txt": { "Unit/Name/Gull": "Gull" } },
        triggers: { source: "triggers.xml" },
        files: [
          { path: "Base.SC2Data/scripts/gulls.galaxy", source: "scripts/gulls.galaxy" },
          { path: "Base.SC2Data/Cutscenes/Quay - Dusk.SC2Cutscene", source: "cutscenes/Quay - Dusk.SC2Cutscene" },
          { path: "Base.SC2Data/UI/FontStyles.SC2Style", source: "ui/FontStyles.SC2Style" },
          { path: "Assets/Textures/gull.dds", source: "art/gull.dds" },
        ],
      },
      {
        "data/UnitData.xml": catalog(`<CUnit id="Gull" parent="Critter"><LifeMax value="5"/></CUnit>`),
        "data/SoundData.xml": catalog(`<CSound id="Gulls"/>`),
        "triggers.xml": [
          `<TriggerData>`,
          `    <Library Id="Hbr1">`,
          `        <Root>`,
          `            <Item Type="Trigger" Library="Hbr1" Id="000000C1"/>`,
          `        </Root>`,
          `        <Element Type="Trigger" Id="000000C1">`,
          `            <Action Type="FunctionCall" Library="Hbr1" Id="000000C2"/>`,
          `        </Element>`,
          `        <Element Type="FunctionCall" Id="000000C2">`,
          `            <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000002"/>`,
          `        </Element>`,
          `    </Library>`,
          `</TriggerData>`,
          ``,
        ].join("\n"),
        "scripts/gulls.galaxy": "void Gulls_Init () {\n}\n",
        "cutscenes/Quay - Dusk.SC2Cutscene": "<Cutscene/>\n",
        "ui/FontStyles.SC2Style": "<StyleFile/>\n",
        "art/gull.dds": "DDS gull",
      },
    );
  }

  it("leave every Kept byte as it was, and a second compile with no Blueprint change is byte-identical", async () => {
    const mod = await setup();
    const kept = await hashTree(mod.modPackage);
    await everyWriter(mod);

    const { warnings } = await compileMod(mod.blueprintPath);
    const first = await hashTree(mod.modDir);
    // What the compile doesn't write for a library trigger yet: its name and its Galaxy.
    expect(warnings).toContain("trigger:000000C1 has no name in enUS.SC2Data/LocalizedData/TriggerStrings.txt: give each one in the Blueprint's triggers.names, by its id, or the Editor shows its id");
    expect(warnings.some((warning) => warning.includes("not yet the library's Galaxy"))).toBe(true);

    // Files the compile didn't write are as they were.
    const after = await hashTree(mod.modPackage);
    const merged = [UNIT_FILE, "enUS.SC2Data/LocalizedData/GameStrings.txt", "Triggers", "ComponentList.SC2Components"];
    for (const [file, hash] of Object.entries(kept)) if (!merged.includes(file)) expect(after[file], file).toBe(hash);
    // Merged files keep their Kept lines, in order, byte for byte.
    expect(await inPackage(mod, UNIT_FILE)).toContain(UNIT_DATA.slice(0, UNIT_DATA.indexOf("</Catalog>")));
    expect(await inPackage(mod, "enUS.SC2Data/LocalizedData/GameStrings.txt")).toBe(`${GAME_STRINGS}Unit/Name/Gull=Gull\r\n`);
    const triggers = await inPackage(mod, "Triggers");
    for (const line of TRIGGERS.split("\r\n").filter((line) => line.trim() && !line.includes("</Root>") && !line.includes("</Library>") && !line.includes("</TriggerData>"))) expect(triggers).toContain(`${line}\r\n`);
    expect(triggers).toMatch(/<Item Type="Trigger" Library="Hbr1" Id="000000C1"\/>\r\n {8}<\/Root>/);
    expect(triggers).toMatch(/<Element Type="FunctionCall" Id="000000C2">[\s\S]*<\/Element>\r\n {4}<\/Library>/);
    // A component the package now has is listed.
    expect(await inPackage(mod, "ComponentList.SC2Components")).toBe(COMPONENTS.replace("</Components>", `    <DataComponent Type="font">UI/FontStyles.SC2Style</DataComponent>\r\n    <DataComponent Type="cuts">Cutscenes/Index</DataComponent>\r\n</Components>`));

    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modDir)).toEqual(first);
  });

  it("replace their Compiled parts where they stand and take out what the Blueprint drops", async () => {
    const mod = await setup();
    await everyWriter(mod);
    await compileMod(mod.blueprintPath);

    await declare(mod, { gameData: [{ file: UNIT_FILE, source: "data/UnitData.xml" }], strings: {}, triggers: undefined, files: [] }, { "data/UnitData.xml": catalog(`<CUnit id="Gull" parent="Critter"><LifeMax value="6"/></CUnit>`) });
    await compileMod(mod.blueprintPath);

    expect(await inPackage(mod, UNIT_FILE)).toBe(UNIT_DATA.replace(`    <CUnit default="1" id="HarbourBase"/>\r\n`, `    <CUnit default="1" id="HarbourBase"/>\r\n    <CUnit id="Gull" parent="Critter"><LifeMax value="6"/></CUnit>\r\n`));
    expect(await inPackage(mod, "enUS.SC2Data/LocalizedData/GameStrings.txt")).toBe(GAME_STRINGS);
    expect(await inPackage(mod, "Triggers")).toBe(TRIGGERS);
    const files = await hashTree(mod.modPackage);
    for (const gone of ["Base.SC2Data/GameData/SoundData.xml", "Base.SC2Data/scripts/gulls.galaxy", "Assets/Textures/gull.dds"]) expect(files[gone], gone).toBeUndefined();
  });

  it("leave a catalog file the Editor saved, emptied of Compiled entries, as an empty catalog, and remove one the compile made", async () => {
    const mod = await setup();
    const abil = "Base.SC2Data/GameData/AbilData.xml";
    const saved = `<?xml version="1.0" encoding="utf-8"?>\r\n<Catalog>\r\n    <CAbil id="Lift"/>\r\n</Catalog>\r\n`;
    await put(path.join(mod.modPackage, ...abil.split("/")), saved);
    await declare(mod, { gameData: [{ file: abil, source: "data/AbilData.xml" }, { file: "Base.SC2Data/GameData/SoundData.xml", source: "data/SoundData.xml" }] }, { "data/AbilData.xml": catalog(`<CAbil id="Lift"/>`), "data/SoundData.xml": catalog(`<CSound id="Gulls"/>`) });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, abil)).toBe(saved);

    await declare(mod, { gameData: [] });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, abil)).toBe(`<?xml version="1.0" encoding="utf-8"?>\r\n<Catalog>\r\n</Catalog>\r\n`);
    expect((await hashTree(mod.modPackage))["Base.SC2Data/GameData/SoundData.xml"]).toBeUndefined();
  });

  it("refuse a source outside the mod's folder, and two writers for one file", async () => {
    const mod = await setup();
    await declare(mod, { files: [{ path: "Base.SC2Data/a.txt", source: "../../outside.txt" }] });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/source/);
    await declare(mod, { files: [{ path: "Base.SC2Data/a.txt", source: "a.txt" }, { path: "Base.SC2Data/a.txt", source: "a.txt" }] }, { "a.txt": "a" });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/twice/);
    await declare(mod, { files: [], gameData: [{ file: UNIT_FILE, source: "u.xml" }] }, { "u.xml": catalog(`<CUnit parent="Marine"/>`) });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/CUnit with no id/);
    await declare(mod, { gameData: [{ file: UNIT_FILE, source: "u.xml" }] }, { "u.xml": catalog(`<CUnit id="Gull"/>`, `<CUnit id="Gull"/>`) });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/CUnit:Gull twice/);
    await declare(mod, { gameData: [{ file: "Base.SC2Data/GameData/Birds/GullData.xml", source: "u.xml" }] }, { "u.xml": catalog(`<CUnit id="Gull"/>`) });
    // A new catalog file in a folder loads through the includes list, which the compile adds it to.
    expect((await compileMod(mod.blueprintPath)).warnings.some((warning) => warning.startsWith("gameData.0 writes Base.SC2Data/GameData/Birds/GullData.xml, a catalog file the game loads only through the includes list"))).toBe(true);
    expect(await inPackage(mod, "Base.SC2Data/GameData.xml")).toContain(`<Catalog path="GameData/Birds/GullData.xml"/>`);
  });

  it("refuse triggers in a library other than the package's, or items naming another library", async () => {
    const mod = await setup();
    const kept = await hashTree(mod.modPackage);
    const triggers = (library: string, itemLibrary = library): string =>
      [`<TriggerData>`, `    <Library Id="${library}">`, `        <Root>`, `            <Item Type="Trigger" Library="${itemLibrary}" Id="000000C1"/>`, `        </Root>`, `        <Element Type="Trigger" Id="000000C1">`, `        </Element>`, `    </Library>`, `</TriggerData>`, ``].join("\n");
    await declare(mod, { triggers: { source: "triggers.xml" } }, { "triggers.xml": triggers("Othr") });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("are library Othr, but the package's Triggers is library Hbr1");
    await declare(mod, { triggers: { source: "triggers.xml" } }, { "triggers.xml": triggers("Hbr1", "Othr") });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("file items of library Othr in library Hbr1");
    expect(await hashTree(mod.modPackage)).toEqual(kept);
  });
});

describe("compileMod's strings writer", () => {
  it("leaves a Kept strings file's lines that hold no key, such as an old merge conflict's, where they were", async () => {
    const mod = await setup();
    const file = "enUS.SC2Data/LocalizedData/GameStrings.txt";
    const kept = "\uFEFF<<<<<<< .mine=\r\n=======\r\n>>>>>>> .r381=\r\nUnit/Name/Crane=Crane\r\n\r\nUnit/Name/Barge=Barge\r\n";
    await writeFile(path.join(mod.modPackage, ...file.split("/")), kept);
    await declare(mod, { strings: { [file]: { "Unit/Name/Barge": "Barge" } } });

    await compileMod(mod.blueprintPath);

    expect(await inPackage(mod, file)).toBe(kept);
  });
});

describe("the Equivalence check", () => {
  /** Converts the Kept Barge with `barge` as the Blueprint's entry. */
  async function convertBarge(mod: Mod, barge: string, acceptedDifferences: unknown[] = []) {
    await declare(mod, { gameData: [{ file: UNIT_FILE, source: "data/UnitData.xml" }], acceptedDifferences }, { "data/UnitData.xml": catalog(barge) });
  }

  it("passes a converted entry that differs only in what the Editor ignores, and writes it in the Kept one's place", async () => {
    const mod = await setup();
    const barge = `<CUnit parent="Medivac" id="Barge"><Attributes value="1" index="Armored"/><LifeMax value="400"/></CUnit>`;
    await convertBarge(mod, barge);

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions).toEqual([{ item: `catalog-entry:${UNIT_FILE}:CUnit:Barge` }]);
    const text = await inPackage(mod, UNIT_FILE);
    expect(text.indexOf(barge)).toBeGreaterThan(text.indexOf(`id="Crane"`));
    expect(text.indexOf(barge)).toBeLessThan(text.indexOf(`id="HarbourBase"`));
    expect(text).toContain(`    <CUnit id="Crane" parent="Marine">\r\n        <LifeMax value="120"/>\r\n        <!--<Speed value="2"/>-->\r\n    </CUnit>\r\n`);
  });

  it("fails on a deliberate drift, writing nothing, and passes when the drift is named as an accepted difference", async () => {
    const mod = await setup();
    const before = await hashTree(mod.modPackage);
    await convertBarge(mod, `<CUnit id="Barge" parent="Medivac"><LifeMax value="450"/><Attributes index="Armored" value="1"/></CUnit>`);
    const blueprint = await readFile(mod.blueprintPath);

    const failure = await compileMod(mod.blueprintPath).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EquivalenceError);
    expect((failure as Error).message).toContain(`catalog-entry:${UNIT_FILE}:CUnit:Barge: <LifeMax value="400"> is now <LifeMax value="450">`);
    expect(await hashTree(mod.modPackage)).toEqual(before);
    expect(await readFile(path.join(mod.modDir, "compile-record.json"), "utf8")).toBe('{\n  "version": 1,\n  "entries": []\n}\n');
    expect(await readFile(mod.blueprintPath)).toEqual(blueprint);

    await convertBarge(mod, `<CUnit id="Barge" parent="Medivac"><LifeMax value="450"/><Attributes index="Armored" value="1"/></CUnit>`, [
      { item: `catalog-entry:${UNIT_FILE}:CUnit:Barge`, reason: "Barges are tougher in the new harbour" },
    ]);
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toEqual([{ item: `catalog-entry:${UNIT_FILE}:CUnit:Barge`, accepted: "Barges are tougher in the new harbour" }]);
    expect(await inPackage(mod, UNIT_FILE)).toContain(`<LifeMax value="450"/>`);
  });

  it("checks strings, triggers and whole files as they convert", async () => {
    const mod = await setup();
    await declare(
      mod,
      {
        strings: { "enUS.SC2Data/LocalizedData/GameStrings.txt": { "Unit/Name/Barge": "Big Barge" } },
        files: [
          { path: "Base.SC2Data/scripts/harbour.galaxy", source: "harbour.galaxy" },
          { path: "Assets/Textures/quay.dds", source: "quay.dds" },
        ],
      },
      { "harbour.galaxy": "void Harbour_Init () {   \n}\n\n", "quay.dds": "not the original" },
    );
    const failure = (await compileMod(mod.blueprintPath).catch((error: unknown) => error)) as EquivalenceError;
    expect(failure.mismatches.map((mismatch) => mismatch.item).sort()).toEqual(["file:Assets/Textures/quay.dds", "string:enUS.SC2Data/LocalizedData/GameStrings.txt:Unit/Name/Barge"]);
    expect(failure.mismatches.find((mismatch) => mismatch.item.startsWith("string"))!.detail).toBe("Barge is now Big Barge");
  });

  it("converts a Kept library trigger in its folder, and fails one that calls something else", async () => {
    const mod = await setup();
    const source = (functionId: string) =>
      [
        `<TriggerData>`,
        `    <Library Id="Hbr1">`,
        `        <Root>`,
        `            <Item Type="Trigger" Library="Hbr1" Id="0000000A"/>`,
        `        </Root>`,
        `        <Element Type="Trigger" Id="0000000A">`,
        `            <Action Type="FunctionCall" Library="Hbr1" Id="0000000B"/>`,
        `        </Element>`,
        `        <Element Type="FunctionCall" Id="0000000B">`,
        `            <FunctionDef Library="Ntve" Type="FunctionDef" Id="${functionId}"/>`,
        `        </Element>`,
        `    </Library>`,
        `</TriggerData>`,
        ``,
      ].join("\n");
    await declare(mod, { triggers: { source: "triggers.xml" } }, { "triggers.xml": source("00000009") });
    const failure = (await compileMod(mod.blueprintPath).catch((error: unknown) => error)) as EquivalenceError;
    expect(failure.mismatches).toEqual([{ item: "trigger:0000000A", detail: '<FunctionDef Id="00000001" Library="Ntve" Type="FunctionDef"> is now <FunctionDef Id="00000009" Library="Ntve" Type="FunctionDef">' }]);

    await declare(mod, { triggers: { source: "triggers.xml" } }, { "triggers.xml": source("00000001") });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toEqual([{ item: "trigger:0000000A" }]);
    const triggers = await inPackage(mod, "Triggers");
    // Still filed in its folder, not added to Root, and written once.
    expect(triggers).toContain(`        <Element Type="Category" Id="00000001">\r\n            <Item Type="Trigger" Library="Hbr1" Id="0000000A"/>\r\n        </Element>\r\n`);
    expect(triggers.match(/Id="0000000A"/g)).toHaveLength(2);
    expect(triggers).toContain(`<FunctionDef Library="Ntve" Type="FunctionDef" Id="00000001"/>`);
    expect(compiled.record.entries).toContainEqual(expect.objectContaining({ kind: "trigger", id: "0000000A" }));
    const again = await hashTree(mod.modDir);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modDir)).toEqual(again);
  });

  it("warns of an accepted difference that names nothing the Blueprint writes, or one no longer needed", async () => {
    const mod = await setup();
    await convertBarge(mod, `<CUnit id="Barge" parent="Medivac"><LifeMax value="400"/><Attributes index="Armored" value="1"/></CUnit>`, [
      { item: `catalog-entry:${UNIT_FILE}:CUnit:Barge`, reason: "tougher" },
      { item: `catalog-entry:${UNIT_FILE}:CUnit:Bargee`, reason: "typo" },
    ]);
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.warnings).toEqual([expect.stringContaining("came out the same as the original"), expect.stringContaining("Bargee, which the Blueprint doesn't write")]);
  });
});

describe("Editor changes to a mod's Compiled Content", () => {
  it("stop the compile, listing each change, until the author keeps or discards it", async () => {
    const mod = await setup();
    await declare(
      mod,
      { gameData: [{ file: UNIT_FILE, source: "data/UnitData.xml" }], strings: { "enUS.SC2Data/LocalizedData/GameStrings.txt": { "Unit/Name/Gull": "Gull" } } },
      { "data/UnitData.xml": catalog(`<CUnit id="Gull" parent="Critter"/>`, `<CUnit id="Tern" parent="Critter"/>`) },
    );
    await compileMod(mod.blueprintPath);
    const unitFile = path.join(mod.modPackage, ...UNIT_FILE.split("/"));
    await writeFile(unitFile, (await readFile(unitFile, "utf8")).replace(`<CUnit id="Gull" parent="Critter"/>`, `<CUnit id="Gull" parent="Critter"><Speed value="3"/></CUnit>`).replace(`<CUnit id="Tern" parent="Critter"/>`, `<CUnit id="Tern" parent="Seagull"/>`));
    const strings = path.join(mod.modPackage, "enUS.SC2Data", "LocalizedData", "GameStrings.txt");
    await writeFile(strings, (await readFile(strings, "utf8")).replace("Gull=Gull", "Gull=Herring Gull"));
    const edited = await hashTree(mod.modPackage);

    const stopped = (await compileMod(mod.blueprintPath).catch((error: unknown) => error)) as EditorChangesError;
    expect(stopped).toBeInstanceOf(EditorChangesError);
    expect(stopped.changes.map((change) => change.name).sort()).toEqual([`catalog-entry:${UNIT_FILE}:CUnit:Gull`, `catalog-entry:${UNIT_FILE}:CUnit:Tern`, "string:enUS.SC2Data/LocalizedData/GameStrings.txt:Unit/Name/Gull"]);
    expect(stopped.message).toMatch(/Compiled Content in the mod package/);
    expect(stopped.message).toMatch(/compile_mod takes keep/);
    expect(await hashTree(mod.modPackage)).toEqual(edited);

    const compiled = await compileMod(mod.blueprintPath, { decisions: { keep: [`catalog-entry:${UNIT_FILE}:CUnit:Gull`], discard: "all" } });
    const text = await inPackage(mod, UNIT_FILE);
    expect(text).toContain(`<CUnit id="Gull" parent="Critter"><Speed value="3"/></CUnit>`);
    expect(text).toContain(`<CUnit id="Tern" parent="Critter"/>`);
    expect(await inPackage(mod, "enUS.SC2Data/LocalizedData/GameStrings.txt")).toContain("Unit/Name/Gull=Gull\r\n");
    expect(compiled.record.kept).toEqual([{ kind: "catalog-entry", file: UNIT_FILE, id: "CUnit:Gull" }]);
    expect(compiled.record.entries.some((entry) => entry.kind === "catalog-entry" && entry.id === "CUnit:Gull")).toBe(false);

    // Kept now: the next compile leaves it be.
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, UNIT_FILE)).toBe(text);
  });
  it("pass over a Compiled entry the Editor only saved in its own layout", async () => {
    const mod = await setup();
    await declare(mod, { gameData: [{ file: UNIT_FILE, source: "data/UnitData.xml" }] }, { "data/UnitData.xml": catalog(`<CUnit id="Gull" parent="Critter"><LifeMax value="5"/></CUnit>`) });
    await compileMod(mod.blueprintPath);
    const unitFile = path.join(mod.modPackage, ...UNIT_FILE.split("/"));
    await writeFile(unitFile, (await readFile(unitFile, "utf8")).replace(`<CUnit id="Gull" parent="Critter"><LifeMax value="5"/></CUnit>`, `<CUnit parent="Critter" id="Gull">\r\n        <LifeMax value="5.000000"/>\r\n    </CUnit>`));

    await expect(compileMod(mod.blueprintPath)).resolves.toBeDefined();
    expect(await inPackage(mod, UNIT_FILE)).toContain(`<CUnit id="Gull" parent="Critter"><LifeMax value="5"/></CUnit>`);
  });
});

describe("the package files a mod compile generates", () => {
  it("write the Blueprint's dependencies into DocumentInfo and DocumentHeader, keeping the rest of each", async () => {
    const mod = await setup();
    const header = Buffer.concat([Buffer.from("H2CS"), Buffer.alloc(40), Buffer.from([1, 0, 0, 0]), Buffer.from("file:Mods/Old.SC2Mod\0"), Buffer.from("rest of the header")]);
    await writeFile(path.join(mod.modPackage, "DocumentHeader"), header);
    await declare(mod, { dependencies: [DEPENDENCIES[0]], strings: { "enUS.SC2Data/LocalizedData/GameStrings.txt": { "Unit/Name/Gull": "Gull" } } });

    await compileMod(mod.blueprintPath);

    expect(await inPackage(mod, "DocumentInfo")).toBe(
      `<?xml version="1.0" encoding="utf-8"?>\r\n<DocInfo>\r\n    <Dependencies>\r\n        <Value>${DEPENDENCIES[0]}</Value>\r\n    </Dependencies>\r\n    <Preload>\r\n        <Value>Bank;Harbour</Value>\r\n    </Preload>\r\n</DocInfo>\r\n`,
    );
    const written = await readFile(path.join(mod.modPackage, "DocumentHeader"));
    expect(written.readUInt32LE(44)).toBe(1);
    expect(written.subarray(48).toString("latin1")).toBe(`${DEPENDENCIES[0]}\0rest of the header`);
  });

  it("read a dependency's XML entities as its text, and write it escaped once", async () => {
    const mod = await setup();
    const salted = "file:Mods\\Salt & Pepper.SC2Mod";
    const info = (values: string[]) => `<?xml version="1.0" encoding="utf-8"?>\r\n<DocInfo>\r\n    <Dependencies>\r\n${values.map((value) => `        <Value>${value}</Value>\r\n`).join("")}    </Dependencies>\r\n</DocInfo>\r\n`;
    await writeFile(path.join(mod.modPackage, "DocumentInfo"), info([DEPENDENCIES[0]!, "file:Mods\\Salt &amp; Pepper.SC2Mod"]));
    expect(await readDependencies(mod.modPackage)).toEqual([DEPENDENCIES[0], salted]);
    await writeFile(path.join(mod.modPackage, "DocumentHeader"), Buffer.concat([Buffer.from("H2CS"), Buffer.alloc(40), Buffer.from([0, 0, 0, 0])]));

    await declare(mod, { dependencies: [salted], strings: { "enUS.SC2Data/LocalizedData/GameStrings.txt": { "Unit/Name/Gull": "Gull" } } });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "DocumentInfo")).toBe(info(["file:Mods\\Salt &amp; Pepper.SC2Mod"]));
    const written = await readFile(path.join(mod.modPackage, "DocumentHeader"));
    expect(written.subarray(48).toString("latin1")).toContain(`${salted}\0`);
  });

  it("repair a header whose dependencies are stale when DocumentInfo already has the Blueprint's, leaving DocumentInfo as it is", async () => {
    const mod = await setup();
    const infoBefore = await inPackage(mod, "DocumentInfo");
    await writeFile(path.join(mod.modPackage, "DocumentHeader"), documentHeader(["file:Mods\\Gone.SC2Mod"]));
    await declare(mod, { strings: { "enUS.SC2Data/LocalizedData/GameStrings.txt": { "Unit/Name/Gull": "Gull" } } });

    await compileMod(mod.blueprintPath);

    expect(await inPackage(mod, "DocumentInfo")).toBe(infoBefore);
    const written = await readFile(path.join(mod.modPackage, "DocumentHeader"));
    expect(readDocumentHeaderDependencies(written)).toEqual(DEPENDENCIES);
    expect(written.subarray(readDocumentHeader(written).end)).toEqual(documentHeader([]).subarray(48));
  });

  it("are left as the package has them while its dependencies and components are unchanged", async () => {
    const mod = await setup();
    const before = await hashTree(mod.modPackage);
    await declare(mod, { strings: { "enUS.SC2Data/LocalizedData/GameStrings.txt": { "Unit/Name/Gull": "Gull" } } });
    await compileMod(mod.blueprintPath);
    const after = await hashTree(mod.modPackage);
    for (const file of ["DocumentInfo", "DocumentHeader", "ComponentList.SC2Components", "GameText.version"]) expect(after[file], file).toBe(before[file]);
  });
});

describe("the Kept report", () => {
  it("lists every component's Kept items with a count, and drops what the Blueprint now owns", async () => {
    const mod = await setup();
    const imported = await keptReport(mod.blueprintPath);
    const count = (report: typeof imported) => Object.fromEntries(report.components.map((component) => [component.component, component.count]));

    expect(count(imported)).toEqual({ GameData: 3, Strings: 3, Triggers: 2, Scripts: 1, Cutscenes: 1, UI: 1, "Package files": 7, Files: 1 });
    expect(imported.total).toBe(19);
    const triggers = imported.components.find((component) => component.component === "Triggers")!.items;
    // A trigger folder is a library item the library interface owns, as a trigger is.
    expect(triggers).toEqual([
      { item: "category:00000001", file: "Triggers" },
      { item: "trigger:0000000A", file: "Triggers", label: "Open Quay" },
    ]);
    expect(imported.notConvertibleYet).toEqual({ count: 0, items: [] });
    expect(imported.components.find((component) => component.component === "GameData")!.items.map((item) => item.item)).toEqual([
      `catalog-entry:${UNIT_FILE}:CUnit:Crane`,
      `catalog-entry:${UNIT_FILE}:CUnit:Barge`,
      `catalog-entry:${UNIT_FILE}:CUnit:HarbourBase`,
    ]);

    await declare(mod, { gameData: [{ file: UNIT_FILE, source: "data/UnitData.xml" }], files: [{ path: "Base.SC2Data/scripts/harbour.galaxy", source: "harbour.galaxy" }] }, {
      "data/UnitData.xml": catalog(`<CUnit id="Crane" parent="Marine"><LifeMax value="120"/></CUnit>`),
      "harbour.galaxy": "void Harbour_Init () {\r\n}\r\n",
    });
    await compileMod(mod.blueprintPath);
    const after = await keptReport(mod.blueprintPath);
    // The compile now owns Crane, the script and the package files it generates.
    expect(count(after)).toMatchObject({ GameData: 2, Scripts: 0, "Package files": 0 });
  });
});

describe("the compile_mod and kept_report tools", () => {
  it("compile a Workspace mod by id and report what is still Kept, and stop on a failed Equivalence check", async () => {
    const mod = await setup();
    await declare(mod, { gameData: [{ file: UNIT_FILE, source: "data/UnitData.xml" }] }, { "data/UnitData.xml": catalog(`<CUnit id="Crane" parent="Marine"><LifeMax value="120"/></CUnit>`) });
    const client = await connect(mod.workspaceRoot);

    const compiled = await client.callTool({ name: "compile_mod", arguments: { mod: "harbour-story" } });
    expect(compiled.isError).toBeFalsy();
    expect(compiled.structuredContent).toMatchObject({ modPackage: "mods/harbour-story/Harbour-Story.SC2Mod", conversions: [{ item: `catalog-entry:${UNIT_FILE}:CUnit:Crane` }], kept: { total: 11, notConvertibleYet: 0 } });
    expect(text(compiled)).toContain("harbour-story: 11 Kept item(s)");

    const report = await client.callTool({ name: "kept_report", arguments: { mod: "harbour-story", items: true } });
    expect(text(report)).toContain(`      catalog-entry:${UNIT_FILE}:CUnit:Barge`);
    expect(text(report)).toContain(`      trigger:0000000A "Open Quay"`);
    expect(text(report)).toContain(`      category:00000001`);
    expect(report.structuredContent).toMatchObject({ total: 11, notConvertibleYet: { count: 0, items: [] } });

    await declare(mod, {}, { "data/UnitData.xml": catalog(`<CUnit id="Crane" parent="Marine"><LifeMax value="120"/></CUnit>`, `<CUnit id="Barge" parent="Medivac"/>`) });
    const failed = await client.callTool({ name: "compile_mod", arguments: { mod: "harbour-story" } });
    expect(failed.isError).toBe(true);
    expect(text(failed)).toContain(`catalog-entry:${UNIT_FILE}:CUnit:Barge: the compile drops`);
  });
});
