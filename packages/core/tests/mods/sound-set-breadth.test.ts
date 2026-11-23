// Sound sets for every Screenplay (ADR-0011): a sound set writes a line's CSound in the AssetArray
// form as well as the template form, and a line may take a form of its own; convert-entries leaves
// a sound set's CSounds alone; and convert-sound-set writes a conversation's sound set and voices
// from its Kept CSounds and voice files. A sound set owns its CSounds' names, each its id. The
// Harbour and Harbour-Art are synthetic.
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { createServer } from "../../src/mcp/server.js";
import { compileMod, EquivalenceError } from "../../src/mods/compile-mod.js";
import { convertEntries } from "../../src/mods/convert-entries.js";
import { convertSoundSet } from "../../src/mods/convert-sound-set.js";
import { keptReport } from "../../src/mods/kept-report.js";
import { declareRecordings, harbourWithArt, inArt, RECORDING, sha256, SOUND_DATA, SOUND_ENTRY, SOUNDS, VOICE, VOICE_FOLDER } from "./harbour-art.js";
import { cleanupMods, declare, type Mod, put } from "./mod-fixture.js";

afterEach(cleanupMods);

/** A CSound that gives its AssetArray in full, as the Editor writes a line's when it isn't on a dialogue template. */
const fullForm = (sound: string, line: string, character: string, extra: { facialGroup?: string } = {}) => [
  `    <CSound id="${sound}" parent="Campaign" Subtitle="HarbourChats" Speaker="${character}" Actor="" Line="${line.slice("Line".length)}">`,
  `        <AssetArray index="0">`,
  `            <File value="Assets\\Sounds\\Conversations\\${sound}.ogg"/>`,
  `            <FacialAnim value=""/>`,
  `            <FacialGroup value="${extra.facialGroup ?? ""}"/>`,
  `            <PortraitModel value=""/>`,
  `            <Speaker value="ConversationState/Characters/${character}"/>`,
  `            <Subtitle value="Conversation/HarbourChats/${line}"/>`,
  `        </AssetArray>`,
  `        <Category value="Dialogue"/>`,
  `        <Mode value="2D"/>`,
  `    </CSound>`,
];

/** The Harbour's SoundData with both forms: the Harbourmaster's line on the dialogue template with a portrait, the Dockhand's two in full. */
const mixedSoundData = (extra: { facialGroup?: string } = {}) =>
  [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<Catalog>`,
    `    <CSound default="1" id="Dialogue_Harbour" parent="Mission">`,
    `        <?token id="Template"?>`,
    `        <?token id="Portrait"?>`,
    `        <?token id="Speaker"?>`,
    `        <?token id="Subtitle"?>`,
    `        <?token id="Line"?>`,
    `        <AssetArrayTemplate File="Assets\\Sounds\\^TemplateParam1^.ogg" FacialAnim="^TemplateParam2^" FacialGroup="Default"/>`,
    `        <AssetArray>`,
    `            <TemplateParam value="##Template##"/>`,
    `            <PortraitModel value="##Portrait##"/>`,
    `            <Speaker value="ConversationState/Characters/##Speaker##"/>`,
    `            <Subtitle value="Conversation/##Subtitle##/Line##Line##"/>`,
    `        </AssetArray>`,
    `    </CSound>`,
    `    <CSound id="Harbour-Quay-01-001-Harbourmaster" parent="Dialogue_Harbour" Portrait="HarbourmasterPortrait" Subtitle="HarbourChats" Template="Conversations\\##id##;Harbour_Shout" Speaker="CharHarbourmaster" Line="01001"/>`,
    ...fullForm("Harbour-Quay-01-002-Dockhand", "Line01002", "CharDockhand"),
    ...fullForm("Harbour-Quay-02-001-Dockhand", "Line02001", "CharDockhand", extra),
    `    <CSound id="Gull_Cry" parent="Mission"/>`,
    `</Catalog>`,
    ``,
  ].join("\r\n");

/** The sound set the mixed SoundData is: the Dockhand's form for the set, the Harbourmaster's for its line. */
const MIXED_SET = {
  conversation: "HarbourChats",
  parent: "Campaign",
  attributes: { Actor: "" },
  fields: { Category: "Dialogue", Mode: "2D" },
  facialAnims: { Line01001: "Harbour_Shout" },
  lines: { Line01001: { parent: "Dialogue_Harbour", template: "Assets\\Sounds\\^TemplateParam1^.ogg", attributes: { Portrait: "HarbourmasterPortrait" } } },
};

const OBJECT_STRINGS = "enUS.SC2Data/LocalizedData/ObjectStrings.txt";
const NAME = (sound: string) => `string:${OBJECT_STRINGS}:Sound/Name/${sound}`;
/** The Harbour's ObjectStrings as the Editor wrote them: each CSound's name its id, unless renamed. */
const objectStrings = (renamed: Record<string, string> = {}, extra: string[] = []) =>
  `\uFEFF${[...[...SOUNDS, "Gull_Cry"].map((sound) => `Sound/Name/${sound}=${renamed[sound] ?? sound}`), ...extra].map((line) => `${line}\r\n`).join("")}`;
const keptStrings = async (mod: Mod) => (await keptReport(mod.blueprintPath)).components.find((component) => component.component === "Strings")!.items.map((item) => item.item);

const soundData = (story: Mod) => readFile(path.join(story.modPackage, ...SOUND_DATA.split("/")), "utf8");
const blueprintOf = async (mod: Mod) => JSON.parse(await readFile(mod.blueprintPath, "utf8"));
const LFS_POINTER = (bytes: Uint8Array) => `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256(bytes)}\nsize ${bytes.length}\n`;

describe("a sound set in the AssetArray form", () => {
  it("compiles each line's CSound with its AssetArray in full, a line in a form of its own, equivalent to the Editor's", async () => {
    const { story, art } = await harbourWithArt(mixedSoundData());
    await declareRecordings(art);
    await declare(story, { soundSets: [MIXED_SET] });

    const compiled = await compileMod(story.blueprintPath);

    expect(compiled.conversions).toEqual(SOUNDS.map((sound) => ({ item: SOUND_ENTRY(sound) })));
    expect(await soundData(story)).toBe(mixedSoundData());
  });
});

describe("convert-entries on SoundData", () => {
  it("leaves the CSounds a sound set writes alone, before and after its compile, so the two convert in either order", async () => {
    const { story, art } = await harbourWithArt(mixedSoundData());
    await declareRecordings(art);
    await declare(story, { soundSets: [MIXED_SET] });

    const before = await convertEntries(story.blueprintPath, { file: SOUND_DATA });
    await compileMod(story.blueprintPath);
    const after = await convertEntries(story.blueprintPath, { file: SOUND_DATA });

    expect(before.converted).toEqual(["CSound:Dialogue_Harbour", "CSound:Gull_Cry"]);
    expect(after.converted).toEqual([]);
    expect((await convertEntries(story.blueprintPath, { file: SOUND_DATA, keys: [`CSound:${SOUNDS[0]}`] })).refused).toEqual([{ key: `CSound:${SOUNDS[0]}`, reason: "the Blueprint already writes it" }]);
  });
});

describe("convert-sound-set", () => {
  it("writes a conversation's sound set and voices from its Kept CSounds and voice files, and both mods compile equivalent", async () => {
    const { story, art } = await harbourWithArt(mixedSoundData());

    const converted = await convertSoundSet(story.blueprintPath, { conversation: "HarbourChats" });

    expect(converted).toMatchObject({ conversation: "HarbourChats", assetMod: "Harbour-Art", recorded: SOUNDS, placeholders: [] });
    expect((await blueprintOf(story)).soundSets).toEqual([MIXED_SET]);
    const recordings = Object.fromEntries(SOUNDS.map((sound) => [sound, { file: `voices/${sound}.ogg`, sha256: sha256(RECORDING(sound)) }]));
    expect((await blueprintOf(art)).voices).toEqual([{ conversation: "HarbourChats", folder: VOICE_FOLDER, format: "ogg", recordings }]);
    for (const sound of SOUNDS) expect(await readFile(path.join(art.modDir, "voices", `${sound}.ogg`))).toEqual(Buffer.from(RECORDING(sound)));
    const assets = await compileMod(art.blueprintPath);
    const compiled = await compileMod(story.blueprintPath);
    expect(assets.conversions).toEqual(SOUNDS.map((sound) => ({ item: `file:${VOICE(sound)}` })));
    expect(compiled.conversions).toEqual(SOUNDS.map((sound) => ({ item: SOUND_ENTRY(sound) })));
    expect(await soundData(story)).toBe(mixedSoundData());
  });

  it("runs through convert_sound_set on the server", async () => {
    const { story } = await harbourWithArt(mixedSoundData());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer({ workspaceRoot: story.workspaceRoot }).connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);

    try {
      const reply = await client.callTool({ name: "convert_sound_set", arguments: { mod: "harbour-story", conversation: "HarbourChats" } });
      expect(reply.isError).toBeFalsy();
      expect(reply.structuredContent).toMatchObject({ conversation: "HarbourChats", assetMod: "Harbour-Art", recorded: SOUNDS });
    } finally {
      await client.close();
    }
    expect((await blueprintOf(story)).soundSets).toEqual([MIXED_SET]);
  });

  it("takes a voice file that's a Git LFS pointer by the hash it points to, and the compile never writes over it", async () => {
    const { story, art } = await harbourWithArt(mixedSoundData());
    const pointer = LFS_POINTER(RECORDING(SOUNDS[1]!));
    await put(path.join(art.modPackage, ...VOICE(SOUNDS[1]!).split("/")), pointer);

    await convertSoundSet(story.blueprintPath, { conversation: "HarbourChats" });
    const assets = await compileMod(art.blueprintPath);

    expect((await blueprintOf(art)).voices[0].recordings[SOUNDS[1]!]).toEqual({ file: `voices/${SOUNDS[1]}.ogg`, sha256: sha256(RECORDING(SOUNDS[1]!)) });
    expect((await inArt(art, VOICE(SOUNDS[1]!))).toString()).toBe(pointer);
    expect(assets.warnings).toContainEqual(expect.stringMatching(/Line01002 \(DOCKHAND\)'s recording voices\/Harbour-Quay-01-002-Dockhand\.ogg is a Git LFS pointer/));
  });

  it("moves a voice file the Asset Mod declares in assets into voices, and the line CSounds convert-entries took into the sound set", async () => {
    const { story, art } = await harbourWithArt(mixedSoundData());
    await put(path.join(art.modDir, "art", "quay.ogg"), RECORDING(SOUNDS[0]!));
    const declared = { path: VOICE(SOUNDS[0]!), source: { file: "art/quay.ogg", sha256: sha256(RECORDING(SOUNDS[0]!)) } };
    await declare(art, { assets: [declared] });
    await convertEntries(story.blueprintPath, { file: SOUND_DATA });

    const converted = await convertSoundSet(story.blueprintPath, { conversation: "HarbourChats" });

    expect(converted.movedEntries).toEqual(SOUNDS.map((sound) => `CSound:${sound}`));
    expect((await blueprintOf(art)).assets).toEqual([]);
    expect((await blueprintOf(art)).voices[0].recordings[SOUNDS[0]!]).toEqual(declared.source);
    expect(existsSync(path.join(art.modDir, "voices", `${SOUNDS[0]}.ogg`))).toBe(false);
    const entries = JSON.parse(await readFile(path.join(story.modDir, "entries", "SoundData.json"), "utf8")) as { id: string }[];
    expect(entries.map((entry) => entry.id)).toEqual(["Dialogue_Harbour", "Gull_Cry"]);
    await compileMod(art.blueprintPath);
    await compileMod(story.blueprintPath);
    // The sound set's CSounds come out as the Editor wrote them (the parent, a Generic Entry, has its own form).
    const lineSounds = (xml: string) => xml.slice(xml.indexOf(`<CSound id="${SOUNDS[0]}"`), xml.indexOf(`<CSound id="Gull_Cry"`));
    expect(lineSounds(await soundData(story))).toBe(lineSounds(mixedSoundData()));
  });

  it("gives a line whose voice file isn't there a placeholder only where the sound set would play it, and refuses one that plays a file elsewhere", async () => {
    const { story, art } = await harbourWithArt(mixedSoundData().replace("Conversations\\Harbour-Quay-02-001-Dockhand.ogg", "Elsewhere\\Harbour-Quay-02-001-Dockhand.ogg"));
    await rm(path.join(art.modPackage, ...VOICE(SOUNDS[1]!).split("/")));

    await expect(convertSoundSet(story.blueprintPath, { conversation: "HarbourChats" })).rejects.toThrow(/Line02001's CSound Harbour-Quay-02-001-Dockhand plays Assets\\Sounds\\Elsewhere\\Harbour-Quay-02-001-Dockhand\.ogg, which none of the Asset Mods/);
    expect((await convertSoundSet(story.blueprintPath, { conversation: "HarbourChats" }).catch((error: Error) => error.message)) as string).not.toMatch(/Line01002/);
  });

  it("refuses a CSound no sound set writes, naming the line, and writes nothing", async () => {
    const { story, art } = await harbourWithArt(mixedSoundData({ facialGroup: "Default" }));
    const storyBefore = await readFile(story.blueprintPath, "utf8");
    const artBefore = await readFile(art.blueprintPath, "utf8");

    await expect(convertSoundSet(story.blueprintPath, { conversation: "HarbourChats" })).rejects.toThrow(/Line02001's CSound Harbour-Quay-02-001-Dockhand .*FacialGroup/);

    expect(await readFile(story.blueprintPath, "utf8")).toBe(storyBefore);
    expect(await readFile(art.blueprintPath, "utf8")).toBe(artBefore);
    expect(existsSync(path.join(art.modDir, "voices"))).toBe(false);
  });

  it("refuses a line's CSound that declares tokens, which no sound set writes, naming the line", async () => {
    const line = `    <CSound id="Harbour-Quay-02-001-Dockhand" parent="Campaign"`;
    const { story } = await harbourWithArt(mixedSoundData().replace(`${line} `, `    <CSound default="1" id="Harbour-Quay-02-001-Dockhand" parent="Campaign" `).replace(/(<CSound default="1" id="Harbour-Quay-02-001-Dockhand"[^\n]*\n)/, `$1        <?token id="Mood"?>\r\n`));

    await expect(convertSoundSet(story.blueprintPath, { conversation: "HarbourChats" })).rejects.toThrow(/Line02001's CSound Harbour-Quay-02-001-Dockhand declares tokens/);
  });
});

describe("a sound set's names", () => {
  it("writes each line CSound's Sound/Name, its id, in ObjectStrings, equivalent to the Editor's, and leaves another CSound's Kept", async () => {
    const { story, art } = await harbourWithArt(mixedSoundData());
    await put(path.join(story.modPackage, ...OBJECT_STRINGS.split("/")), objectStrings());
    await declareRecordings(art);
    await declare(story, { soundSets: [MIXED_SET] });

    const compiled = await compileMod(story.blueprintPath);

    expect(compiled.conversions).toEqual(expect.arrayContaining(SOUNDS.map((sound) => ({ item: NAME(sound) }))));
    expect(await readFile(path.join(story.modPackage, ...OBJECT_STRINGS.split("/")), "utf8")).toBe(objectStrings());
    const kept = await keptStrings(story);
    expect(kept).toContain(NAME("Gull_Cry"));
    for (const sound of SOUNDS) expect(kept).not.toContain(NAME(sound));
  });

  it("compares each name with the Kept one, so a line CSound the author renamed differs", async () => {
    const { story, art } = await harbourWithArt(mixedSoundData());
    await put(path.join(story.modPackage, ...OBJECT_STRINGS.split("/")), objectStrings({ [SOUNDS[0]!]: "Quay shout" }));
    await declareRecordings(art);
    await declare(story, { soundSets: [MIXED_SET] });

    const error = await compileMod(story.blueprintPath).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EquivalenceError);
    expect((error as Error).message).toContain(NAME(SOUNDS[0]!));
    expect((error as Error).message).not.toContain(NAME(SOUNDS[1]!));
  });

  it("takes them out of the Blueprint's raw strings and the CSounds convert-entries took, says which, and both mods compile equivalent", async () => {
    const { story, art } = await harbourWithArt(mixedSoundData());
    const prefix = `Sound/EditorPrefix/${SOUNDS[2]}`;
    await put(path.join(story.modPackage, ...OBJECT_STRINGS.split("/")), objectStrings({}, [`${prefix}=(quay)`]));
    await convertEntries(story.blueprintPath, { file: SOUND_DATA });
    const entries = JSON.parse(await readFile(path.join(story.modDir, "entries", "SoundData.json"), "utf8")) as { id: string; strings?: unknown }[];
    // The first line's name is a raw string, not its entry's, as an earlier conversion may have left it.
    const first = entries.find((entry) => entry.id === SOUNDS[0])!;
    delete first.strings;
    await put(path.join(story.modDir, "entries", "SoundData.json"), `${JSON.stringify(entries, null, 2)}\n`);
    await declare(story, { strings: { [OBJECT_STRINGS]: { [`Sound/Name/${SOUNDS[0]}`]: SOUNDS[0] } } });

    const converted = await convertSoundSet(story.blueprintPath, { conversation: "HarbourChats" });

    expect(converted.strings).toEqual(SOUNDS.map(NAME));
    expect(converted.differences).toEqual([]);
    // A string a moved CSound held that isn't its name stays the Blueprint's, as a raw string.
    expect((await blueprintOf(story)).strings).toEqual({ [OBJECT_STRINGS]: { [prefix]: "(quay)" } });
    await compileMod(art.blueprintPath);
    await compileMod(story.blueprintPath);
    expect(await readFile(path.join(story.modPackage, ...OBJECT_STRINGS.split("/")), "utf8")).toBe(objectStrings({}, [`${prefix}=(quay)`]));
    for (const sound of SOUNDS) expect(await keptStrings(story)).not.toContain(NAME(sound));
  });

  it("names a Kept name that isn't its CSound's id among the differences the compile will find", async () => {
    const { story } = await harbourWithArt(mixedSoundData());
    await put(path.join(story.modPackage, ...OBJECT_STRINGS.split("/")), objectStrings({ [SOUNDS[1]!]: "Dockhand grumbles" }));

    const converted = await convertSoundSet(story.blueprintPath, { conversation: "HarbourChats" });

    expect(converted.differences).toEqual([`Line01002's CSound ${SOUNDS[1]}: its name Sound/Name/${SOUNDS[1]} is "Dockhand grumbles", and the sound set writes "${SOUNDS[1]}"`]);
  });

  it("refuses a removed name, which the sound set would write back, and a moved CSound's string the raw strings give otherwise, and writes nothing", async () => {
    const { story } = await harbourWithArt(mixedSoundData());
    const prefix = `Sound/EditorPrefix/${SOUNDS[2]}`;
    await put(path.join(story.modPackage, ...OBJECT_STRINGS.split("/")), objectStrings({}, [`${prefix}=(quay)`]));
    await convertEntries(story.blueprintPath, { file: SOUND_DATA });
    await declare(story, { strings: { [OBJECT_STRINGS]: { [prefix]: "(dock)" } }, removals: [{ item: NAME(SOUNDS[0]!), reason: "an old name" }] });
    const before = await readFile(story.blueprintPath, "utf8");

    const convert = () => convertSoundSet(story.blueprintPath, { conversation: "HarbourChats" }).catch((error: Error) => error.message);

    expect(await convert()).toMatch(/removals names Line01001's CSound's name Sound\/Name\/Harbour-Quay-01-001-Harbourmaster/);
    expect(await readFile(story.blueprintPath, "utf8")).toBe(before);
    await declare(story, { removals: [] });
    const unremoved = await readFile(story.blueprintPath, "utf8");
    expect(await convert()).toMatch(/entries\/SoundData\.json's CSound:Harbour-Quay-02-001-Dockhand holds Sound\/EditorPrefix\/Harbour-Quay-02-001-Dockhand .* as "\(quay\)", and the Blueprint's raw strings give it as "\(dock\)"/);
    expect(await readFile(story.blueprintPath, "utf8")).toBe(unremoved);
  });
});
