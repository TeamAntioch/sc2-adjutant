// Converting a Kept-terrain Mission's own conversation to its Screenplay (ADR-0010,
// src/map/convert-mission-screenplay.ts), on a synthetic imported map (support/kept-conversation.ts).
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { convertMissionScreenplay, formatConvertedMissionScreenplay } from "../../src/map/convert-mission-screenplay.js";
import { sameWords, spokenWords } from "../../src/map/mission-conversation.js";
import { GATE_FILE, keptConversation, type KeptConversationFixture, removeKeptConversation } from "../support/kept-conversation.js";

let fixture: KeptConversationFixture | undefined;
afterEach(async () => {
  await removeKeptConversation(fixture);
  fixture = undefined;
});

const readJson = async (file: string): Promise<Record<string, any>> => JSON.parse(await readFile(file, "utf8"));

describe("a line's words", () => {
  it("are the same without mood tags, emphasis, punctuation, spacing or case", () => {
    expect(sameWords("[Happy 30]Thanks for coming.[/Happy]", "thanks  for coming!")).toBe(true);
    expect(sameWords("Lefty?Looks like it", "Lefty? Looks like it")).toBe(true);
    expect(sameWords("your ship. That you", "your ship...that you")).toBe(true);
    expect(sameWords("Don’t go", "Don't go")).toBe(true);
    expect(sameWords("<i>Now</i> go", "Now go")).toBe(true);
    expect(sameWords("*Laughter.*", "...")).toBe(false);
    expect(sameWords("Let her through.", "No can do.")).toBe(false);
    expect(spokenWords("[Fear 20]I feel it.[/Fear]")).toBe("i feel it");
    expect(sameWords("naïve", "naive")).toBe(true);
    // Only mood tags go: a bracketed word is spoken.
    expect(sameWords("[sighs] Fine.", "Fine.")).toBe(false);
    // Texts with no words are the same only as written.
    expect(sameWords("...", "...")).toBe(true);
    expect(sameWords("...", "!")).toBe(false);
  });
});

describe("converting a Mission's Kept conversation", () => {
  it("keeps the imported Sound of each line whose words are unchanged, and lists every difference", async () => {
    fixture = await keptConversation();
    const before = await readFile(path.join(fixture.mapDir, "Base.SC2Data", "GameData", "ConversationData.xml"));
    const converted = await convertMissionScreenplay(fixture.blueprintPath, { workspace: fixture.workspace });

    const conversion = (await readJson(fixture.blueprintPath)).screenplay.script.conversion;
    // Unchanged words keep the Kept Sound, a mood tag, punctuation or a delivery note notwithstanding.
    expect(conversion.importedSounds).toEqual({
      "Line1-1": "ashen_crossing-1-1",
      "Line1-2": "ashen_crossing-1-2",
      "Line1-3": "ashen_crossing-1-3",
      "Line1-4": "ashen_crossing-1-4",
      "Line2-2": "ashen_crossing-2-2",
      "Line3-1": "ashen_crossing-3-1",
    });
    // The changed line doesn't: it gets the template's Sound, as the added one does.
    expect(conversion.importedSounds["Line2-1"]).toBeUndefined();
    expect(converted.keepingSounds).toBe(6);
    expect(converted.changed).toEqual([{ line: "Line2-1", kept: "Another surge is building. Find cover.", script: "The next surge is close. Get under the arch." }]);
    expect(converted.added).toEqual(["Line2-3"]);
    expect(converted.dropped).toEqual([{ line: "Line3-2", cutscenes: [GATE_FILE] }]);
    expect(converted.removes).toEqual({ sounds: ["ashen_crossing-2-1"], strings: ["Conversation/ashen_crossing/Line3-2"], keptForTriggers: ["ashen_crossing-3-2"] });
    expect(converted.relinks).toEqual([{ file: GATE_FILE, line: "Line2-1", from: "ashen_crossing-2-1", to: "harbour-2-1" }]);
    // The first compile meets the conversation (a line's Sound changed, one added), the subtitles
    // that changed (Line1-1's punctuation too, though it keeps its Sound); the imported lines' CSounds
    // are the Editor's.
    expect(converted.differences.map((found) => found.item)).toEqual([
      "catalog-entry:Base.SC2Data/GameData/ConversationData.xml:CConversation:ashen_crossing",
      "string:enUS.SC2Data/LocalizedData/ConversationStrings.txt:Conversation/ashen_crossing/Line1-1",
      "string:enUS.SC2Data/LocalizedData/ConversationStrings.txt:Conversation/ashen_crossing/Line2-1",
    ]);
    expect(converted.unaccepted).toBe(3);
    expect(formatConvertedMissionScreenplay(converted)).toContain("Line3-2 is still played by Base.SC2Data/Cutscenes/Gate.SC2Cutscene");
    // Nothing in the package changes.
    expect(await readFile(path.join(fixture.mapDir, "Base.SC2Data", "GameData", "ConversationData.xml"))).toEqual(before);
  }, 60_000);

  it("names each difference as accepted with the author's reason, and runs again until the first compile", async () => {
    fixture = await keptConversation();
    await convertMissionScreenplay(fixture.blueprintPath, { workspace: fixture.workspace });
    const again = await convertMissionScreenplay(fixture.blueprintPath, { workspace: fixture.workspace, accept: "The Screenplay was rewritten since the map's draft" });

    expect(again.accepted).toBe(3);
    expect(again.unaccepted).toBe(0);
    const blueprint = await readJson(fixture.blueprintPath);
    expect(blueprint.acceptedDifferences).toEqual(again.differences.map(({ item }) => ({ item, reason: "The Screenplay was rewritten since the map's draft" })));
    // Accepting once more adds nothing.
    expect((await convertMissionScreenplay(fixture.blueprintPath, { workspace: fixture.workspace, accept: "again" })).accepted).toBe(0);
  }, 60_000);

  it("is refused for a conversation the package hasn't, or with no conversationId", async () => {
    fixture = await keptConversation();
    const blueprint = await readJson(fixture.blueprintPath);
    await writeFile(fixture.blueprintPath, JSON.stringify({ ...blueprint, screenplay: { ...blueprint.screenplay, script: { ...blueprint.screenplay.script, conversationId: "elsewhere" } } }));
    await expect(convertMissionScreenplay(fixture.blueprintPath, { workspace: fixture.workspace })).rejects.toThrow(/has no CConversation elsewhere/);
    const { conversationId: _gone, ...script } = blueprint.screenplay.script;
    await writeFile(fixture.blueprintPath, JSON.stringify({ ...blueprint, screenplay: { ...blueprint.screenplay, script } }));
    await expect(convertMissionScreenplay(fixture.blueprintPath, { workspace: fixture.workspace })).rejects.toThrow(/names no conversationId/);
  }, 60_000);
});
