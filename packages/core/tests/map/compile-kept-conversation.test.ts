// Compiling a Kept-terrain Mission's converted conversation over the package's own (ADR-0010,
// src/map/mission-conversation.ts), on the synthetic imported map of support/kept-conversation.ts.
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCompileRecord } from "../../src/domain/compile-record.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { convertMissionScreenplay } from "../../src/map/convert-mission-screenplay.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { parseMissionBlueprint } from "../../src/plugins/workspace.js";
import { readMissionScript } from "../../src/script/name-script.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { GATE_FILE, keptConversation, type KeptConversationFixture, removeKeptConversation } from "../support/kept-conversation.js";

let fixture: KeptConversationFixture | undefined;
afterEach(async () => {
  await removeKeptConversation(fixture);
  fixture = undefined;
});

const savedAt = new Date("2026-01-01T00:00:00Z");
const REASON = "The Screenplay was rewritten since the map's draft";

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full).split(path.sep).join("/")] = (await readFile(full)).toString("latin1");
  }
  return out;
}

/** The fixture with its conversation converted, and with `accept`, every difference accepted. */
async function converted(accept: boolean): Promise<KeptConversationFixture> {
  fixture = await keptConversation();
  await convertMissionScreenplay(fixture.blueprintPath, { workspace: fixture.workspace, ...(accept ? { accept: REASON } : {}) });
  return fixture;
}

const file = (fixture: KeptConversationFixture, name: string): Promise<string> => readFile(path.join(fixture.mapDir, ...name.split("/")), "utf8");

describe("compiling a converted Kept conversation", () => {
  it("writes the conversation, its CSounds and its strings by entry, and voices only the lines with no imported Sound", async () => {
    const harbour = await converted(true);
    const soundsBefore = await file(harbour, "Base.SC2Data/GameData/SoundData.xml");
    const { warnings, placeholders } = await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });

    const conversation = await file(harbour, "Base.SC2Data/GameData/ConversationData.xml");
    // An unchanged line keeps its imported Sound; the changed and the added ones play the template's.
    expect(conversation).toMatch(/<Id value="Line1-1"\/>[\s\S]*?<Sound value="ashen_crossing-1-1"\/>/);
    expect(conversation).toMatch(/<Id value="Line2-1"\/>[\s\S]*?<Sound value="harbour-2-1"\/>/);
    expect(conversation).toMatch(/<Id value="Line2-3"\/>[\s\S]*?<Sound value="harbour-2-3"\/>/);
    expect(conversation).not.toContain(`<Id value="Line3-2"/>`);

    const sounds = await file(harbour, "Base.SC2Data/GameData/SoundData.xml");
    expect(sounds).toContain(`<CSound id="harbour-2-1" parent="Campaign2D"`);
    expect(sounds).toContain(`Assets\\Sounds\\Conversations\\harbour-2-1.ogg`);
    // The imported line's CSound plays its Kept recording.
    expect(sounds).toContain(`Assets\\Sounds\\Conversations\\ashen_crossing-1-1.ogg`);
    // The changed line's old CSound goes, with its recording: nothing plays it. The dropped line's
    // stays, since the package's Kept triggers (Ashen Crossing's, which cued scene 3) still play it.
    expect(soundsBefore).toContain(`<CSound id="ashen_crossing-2-1"`);
    expect(sounds).not.toContain(`<CSound id="ashen_crossing-2-1"`);
    expect(sounds).toContain(`<CSound id="ashen_crossing-3-2"`);
    expect(warnings).toContain("Kept the Sound ashen_crossing-3-2, which the conversation no longer plays, since a Kept trigger names it");
    // Every other Kept CSound is as it was.
    const keptEntry = /    <CSound id="ashen_crossing-1-1"[\s\S]*?<\/CSound>/.exec(soundsBefore)![0];
    expect(sounds).toContain(keptEntry);
    expect(warnings).toContain("Removed 1 Sound(s) the conversation no longer plays, with 1 recording(s): ashen_crossing-2-1");
    expect(warnings).toContain("Removed the string(s) of 1 dropped line(s) or scene(s): Conversation/ashen_crossing/Line3-2");

    const strings = await file(harbour, "enUS.SC2Data/LocalizedData/ConversationStrings.txt");
    expect(strings).toContain("Conversation/ashen_crossing/Line2-1=The next surge is close. Get under the arch.");
    expect(strings).toContain("Conversation/ashen_crossing/Line2-3=Hold there until it passes.");
    expect(strings).not.toContain("Conversation/ashen_crossing/Line3-2=");

    // Placeholders only for the two lines with a Sound of their own, copied into the package.
    expect([...placeholders!.spoken, ...placeholders!.silent].sort()).toEqual(["harbour-2-1", "harbour-2-3"]);
    const voices = await readdir(path.join(harbour.mapDir, "Assets", "Sounds", "Conversations"));
    expect(voices).toContain("harbour-2-1.ogg");
    expect(voices).not.toContain("harbour-1-1.ogg");
    expect(voices).toContain("ashen_crossing-1-1.ogg");
    expect(voices).not.toContain("ashen_crossing-2-1.ogg");
    expect(voices).toContain("ashen_crossing-3-2.ogg");

    // The Kept cutscene's link to the changed line's old recording follows it; the dropped line's stays.
    const gate = await file(harbour, GATE_FILE);
    expect(gate).toContain(`conversationLine="Line2-1" soundLink="harbour-2-1"`);
    expect(gate).toContain(`conversationLine="Line3-2" soundLink="ashen_crossing-3-2"`);
    expect(warnings).toContain(`Relinked the Kept cutscene ${GATE_FILE}: Line2-1 ashen_crossing-2-1 → harbour-2-1, since those lines' words changed`);
    expect(warnings.join("\n")).not.toContain("isn't compiled");

    // The record owns the conversation and the new CSounds now, and not the Kept cutscene.
    const record = parseCompileRecord(await readFile(path.join(harbour.missionDir, "compile-record.json"), "utf8"));
    expect(record.entries).toContainEqual(expect.objectContaining({ kind: "catalog-entry", file: "Base.SC2Data/GameData/ConversationData.xml", id: "CConversation:ashen_crossing" }));
    expect(record.entries).toContainEqual(expect.objectContaining({ kind: "catalog-entry", file: "Base.SC2Data/GameData/SoundData.xml", id: "CSound:harbour-2-1" }));
    expect(record.entries.some((entry) => entry.kind === "file" && entry.path === GATE_FILE)).toBe(false);
  }, 90_000);

  it("changes no byte on a second compile", async () => {
    const harbour = await converted(true);
    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });
    const before = await tree(harbour.missionDir);
    const { warnings } = await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });
    expect(await tree(harbour.missionDir)).toEqual(before);
    expect(warnings.join("\n")).not.toContain("Relinked");
    expect(warnings.join("\n")).not.toContain("Removed");
    expect(warnings.join("\n")).not.toContain("Kept the Sound");
    // Compiled now, the conversation has nothing Kept left to convert.
    await expect(convertMissionScreenplay(harbour.blueprintPath, { workspace: harbour.workspace })).rejects.toThrow(/is Compiled Content already/);
  }, 90_000);

  it("refuses the first compile, writing nothing, while a difference isn't accepted", async () => {
    const harbour = await converted(false);
    const record = path.join(harbour.missionDir, "compile-record.json");
    const [before, recordBefore] = [await tree(harbour.mapDir), await readFile(record, "utf8")];
    await expect(compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt })).rejects.toThrow(
      /3 converted part\(s\) differ[\s\S]*CConversation:ashen_crossing[\s\S]*Conversation\/ashen_crossing\/Line2-1[\s\S]*Fix the Mission Blueprint/,
    );
    // The package and its record are as they were; only the git-ignored placeholders were written, beside the Blueprint.
    expect(await tree(harbour.mapDir)).toEqual(before);
    expect(await readFile(record, "utf8")).toBe(recordBefore);
  }, 90_000);

  it("fails check for a Kept cutscene that plays a dropped line, and for one that links a changed line's old recording until the compile relinks it", async () => {
    const harbour = await converted(true);
    const messages = async () => (await checkWorkspace(harbour.root)).problems.filter((problem) => problem.severity !== "warning").map((problem) => problem.message);
    const before = await messages();
    expect(before).toContain(`The Kept cutscene "Gate" plays ashen_crossing/Line3-2, which the Screenplay no longer has: put the line back, or take it out of the cutscene in the Cutscene Editor`);
    expect(before).toContain(`The Kept cutscene "Gate" plays ashen_crossing/Line2-1 with the sound ashen_crossing-2-1, but the line's words changed and it plays harbour-2-1 now: compile the Mission, which relinks it`);

    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });
    const after = await messages();
    expect(after.some((message) => message.includes("Line3-2, which the Screenplay no longer has"))).toBe(true);
    expect(after.some((message) => message.includes("relinks it"))).toBe(false);
  }, 90_000);
});

describe("after the first compile", () => {
  it("lets the author take a line's imported Sound away, after its words changed at the Source: it gets a placeholder, and the old recording goes", async () => {
    const harbour = await converted(true);
    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });
    // The author rewrote Line2-2 at the Source, so its recording no longer fits: they take it out of importedSounds.
    const raw = JSON.parse(await readFile(harbour.blueprintPath, "utf8"));
    delete raw.screenplay.script.conversion.importedSounds["Line2-2"];
    await writeFile(harbour.blueprintPath, JSON.stringify(raw, null, 2));

    const { warnings, placeholders } = await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });
    expect(await file(harbour, "Base.SC2Data/GameData/ConversationData.xml")).toMatch(/<Id value="Line2-2"\/>[\s\S]*?<Sound value="harbour-2-2"\/>/);
    const sounds = await file(harbour, "Base.SC2Data/GameData/SoundData.xml");
    expect(sounds).toContain(`<CSound id="harbour-2-2"`);
    expect(sounds).not.toContain(`<CSound id="ashen_crossing-2-2"`);
    const voices = await readdir(path.join(harbour.mapDir, "Assets", "Sounds", "Conversations"));
    expect(voices).toContain("harbour-2-2.ogg");
    expect(voices).not.toContain("ashen_crossing-2-2.ogg");
    expect([...placeholders!.spoken, ...placeholders!.silent]).toContain("harbour-2-2");
    expect(warnings).toContain("Removed 1 Sound(s) the conversation no longer plays, with 1 recording(s): ashen_crossing-2-2");
  }, 90_000);

  it("keeps a Sound a Kept trigger names, compile after compile, once the conversation no longer plays it", async () => {
    const harbour = await converted(true);
    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });
    // Line1-2's Sound is one the fixture's Kept triggers (Ashen Crossing's scene 1) play.
    const raw = JSON.parse(await readFile(harbour.blueprintPath, "utf8"));
    delete raw.screenplay.script.conversion.importedSounds["Line1-2"];
    await writeFile(harbour.blueprintPath, JSON.stringify(raw, null, 2));

    const { warnings } = await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });
    expect(warnings).toContain("Kept the Sound ashen_crossing-1-2, which the conversation no longer plays, since a Kept trigger names it");
    await compileMission(harbour.workspace, harbour.blueprintPath, undefined, { savedAt });
    expect(await file(harbour, "Base.SC2Data/GameData/SoundData.xml")).toContain(`<CSound id="ashen_crossing-1-2"`);
    expect(await readdir(path.join(harbour.mapDir, "Assets", "Sounds", "Conversations"))).toContain("ashen_crossing-1-2.ogg");
  }, 90_000);
});

describe("an unconverted Kept conversation", () => {
  it("compiles the Blueprint's own triggers, keeps the package's conversation and says how to convert it", async () => {
    fixture = await keptConversation();
    const raw = JSON.parse(await readFile(fixture.blueprintPath, "utf8"));
    // A scene after the Kept "Mission Start" trigger, as an imported map's own test line might.
    const triggerStrings = await file(fixture, "enUS.SC2Data/LocalizedData/TriggerStrings.txt");
    const editorId = /^Trigger\/Name\/([0-9A-F]{8})=Mission Start\r?$/m.exec(triggerStrings)![1];
    raw.kept = [{ id: "mission-start", kind: "trigger", editorId, name: "Mission Start" }];
    raw.screenplay.scenes = [{ id: "hello", cue: { type: "keptTriggerRuns", triggerId: "mission-start" }, lines: [{ id: "hi", speaker: "Karax", speakerUnitType: "Karax", text: "Test." }] }];
    await writeFile(fixture.blueprintPath, JSON.stringify(raw, null, 2));
    const conversationBefore = await file(fixture, "Base.SC2Data/GameData/ConversationData.xml");

    const { warnings } = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect(warnings.join("\n")).toContain("keeps its Map Package's own conversation ashen_crossing");
    expect(warnings.join("\n")).toContain("Convert it to the Screenplay with convert-screenplay");
    expect(await file(fixture, "Base.SC2Data/GameData/ConversationData.xml")).toBe(conversationBefore);
  }, 90_000);
});

/** Renames the Kept Sound `from` (its CSound, its line's link and its .ogg recording) to `to`, as if the map's exporter had named it as the naming template does. */
async function renameKeptSound(fixture: KeptConversationFixture, from: string, to: string): Promise<void> {
  for (const name of ["Base.SC2Data/GameData/ConversationData.xml", "Base.SC2Data/GameData/SoundData.xml", GATE_FILE]) {
    const full = path.join(fixture.mapDir, ...name.split("/"));
    await writeFile(full, (await readFile(full, "utf8")).replaceAll(`"${from}"`, `"${to}"`).replaceAll(`\\${from}.ogg`, `\\${to}.ogg`));
  }
  const voices = path.join(fixture.mapDir, "Assets", "Sounds", "Conversations");
  await rename(path.join(voices, `${from}.ogg`), path.join(voices, `${to}.ogg`));
}

describe("a Kept Sound the naming template names alike", () => {
  it("is kept with its recording when the words are unchanged, and gets no placeholder over it", async () => {
    fixture = await keptConversation();
    await renameKeptSound(fixture, "ashen_crossing-1-1", "harbour-1-1");
    const recording = await readFile(path.join(fixture.mapDir, "Assets", "Sounds", "Conversations", "harbour-1-1.ogg"));
    await convertMissionScreenplay(fixture.blueprintPath, { workspace: fixture.workspace, accept: REASON });
    expect(JSON.parse(await readFile(fixture.blueprintPath, "utf8")).screenplay.script.conversion.importedSounds["Line1-1"]).toBe("harbour-1-1");

    const { placeholders } = await compileMission(fixture.workspace, fixture.blueprintPath, undefined, { savedAt });
    expect([...placeholders!.spoken, ...placeholders!.silent]).not.toContain("harbour-1-1");
    expect(await readFile(path.join(fixture.mapDir, "Assets", "Sounds", "Conversations", "harbour-1-1.ogg"))).toEqual(recording);
  }, 90_000);

  it("is refused for a line whose words changed, since its recording speaks the old ones", async () => {
    fixture = await keptConversation();
    await renameKeptSound(fixture, "ashen_crossing-2-1", "harbour-2-1");
    await expect(convertMissionScreenplay(fixture.blueprintPath, { workspace: fixture.workspace })).rejects.toThrow(/Line2-1 \(harbour-2-1\): the words changed[\s\S]*new sound ID at the Source/);
  }, 60_000);
});

describe("a converted conversation's cued scene", () => {
  it("plays each imported line's Transmission with its imported Sound, and a changed line's with the template's", async () => {
    const harbour = await converted(true);
    const raw = JSON.parse(await readFile(harbour.blueprintPath, "utf8"));
    raw.screenplay.script.cues = [{ scene: 2, cue: { type: "missionStart" } }];
    await writeFile(harbour.blueprintPath, JSON.stringify(raw, null, 2));
    // Built as the compile builds them (the package's own Kept triggers aside, which this fixture's Ashen Crossing ones would clash with).
    const blueprint = await parseMissionBlueprint(harbour.workspace, harbour.blueprintPath);
    const { script } = (await readMissionScript(blueprint, harbour.blueprintPath, harbour.workspace))!;
    const galaxy = writeMapScript({ mapName: blueprint.title, triggers: buildMissionTriggers(blueprint, { script }) });
    expect(galaxy).toContain(`SoundLink("ashen_crossing-2-2", -1)`);
    expect(galaxy).toContain(`SoundLink("harbour-2-1", -1)`);
    expect(galaxy).not.toContain(`SoundLink("harbour-2-2", -1)`);
  }, 90_000);
});
