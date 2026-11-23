// convert_screenplay given a Kept-terrain Mission: the Map Package's own conversation converted to
// its Screenplay (src/map/convert-mission-screenplay.ts), on the synthetic imported map of
// support/kept-conversation.ts; and given a mod, as before, on the Harbour mod of tests/mods.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CHARACTERS, harbour, screenplay, STRINGS_FILE } from "../mods/harbour-chats.js";
import { cleanupMods, declare } from "../mods/mod-fixture.js";
import { GATE_FILE, keptConversation, type KeptConversationFixture, removeKeptConversation } from "../support/kept-conversation.js";
import { connect, text } from "./harness.js";

let fixture: KeptConversationFixture | undefined;
afterEach(async () => {
  await removeKeptConversation(fixture);
  fixture = undefined;
  await cleanupMods();
});

const readJson = async (file: string): Promise<Record<string, any>> => JSON.parse(await readFile(file, "utf8"));

describe("convert_screenplay for a Mission", () => {
  it("converts the Map Package's own conversation, returning what each line keeps and every difference", async () => {
    fixture = await keptConversation();
    const before = await readFile(path.join(fixture.mapDir, "Base.SC2Data", "GameData", "ConversationData.xml"));
    const client = await connect(fixture.root);
    const reply = await client.callTool({ name: "convert_screenplay", arguments: { mission: "harbour" } });

    expect(reply.isError).toBeFalsy();
    const converted = (reply.structuredContent as { mission: Record<string, any> }).mission;
    expect(reply.structuredContent).not.toHaveProperty("index");
    expect(converted).toMatchObject({ conversation: "ashen_crossing", lines: 8, keptLines: 8, keepingSounds: 6, accepted: 0, unaccepted: 3 });
    expect(converted.changed).toEqual([{ line: "Line2-1", kept: "Another surge is building. Find cover.", script: "The next surge is close. Get under the arch." }]);
    expect(converted.added).toEqual(["Line2-3"]);
    expect(converted.dropped).toEqual([{ line: "Line3-2", cutscenes: [GATE_FILE] }]);
    expect(converted.speakers).toEqual([]);
    expect(converted.relinks).toEqual([{ file: GATE_FILE, line: "Line2-1", from: "ashen_crossing-2-1", to: "harbour-2-1" }]);
    // The changed line's old Sound goes, and the dropped line's string; the dropped line's Sound stays, as a Kept trigger names it.
    expect(converted.removes).toEqual({ sounds: ["ashen_crossing-2-1"], strings: ["Conversation/ashen_crossing/Line3-2"], keptForTriggers: ["ashen_crossing-3-2"] });
    expect(converted.differences.map((found: { item: string }) => found.item)).toEqual([
      "catalog-entry:Base.SC2Data/GameData/ConversationData.xml:CConversation:ashen_crossing",
      "string:enUS.SC2Data/LocalizedData/ConversationStrings.txt:Conversation/ashen_crossing/Line1-1",
      "string:enUS.SC2Data/LocalizedData/ConversationStrings.txt:Conversation/ashen_crossing/Line2-1",
    ]);
    expect(text(reply)).toContain("Line3-2 is still played by Base.SC2Data/Cutscenes/Gate.SC2Cutscene");
    // The reply asks for the tool's accept, and says the compile refuses until the differences are accepted.
    expect(text(reply)).toContain("convert again with accept, or name it by hand");
    expect(text(reply)).not.toContain("--accept");
    expect(text(reply)).toContain("The compile refuses until each difference is named in acceptedDifferences; then compile the Mission in place (compile_map)");
    // The conversion is recorded in the Blueprint; nothing in the package changes.
    expect((await readJson(fixture.blueprintPath)).screenplay.script.conversion.importedSounds["Line1-1"]).toBe("ashen_crossing-1-1");
    expect(await readFile(path.join(fixture.mapDir, "Base.SC2Data", "GameData", "ConversationData.xml"))).toEqual(before);
  }, 60_000);

  it("names each difference as accepted with the author's reason", async () => {
    fixture = await keptConversation();
    const client = await connect(fixture.root);
    const reason = "The Screenplay was rewritten since the map's draft";
    const reply = await client.callTool({ name: "convert_screenplay", arguments: { mission: "harbour", accept: reason } });

    expect(reply.isError).toBeFalsy();
    const converted = (reply.structuredContent as { mission: { accepted: number; unaccepted: number; differences: { item: string }[] } }).mission;
    expect(converted.accepted).toBe(3);
    expect(converted.unaccepted).toBe(0);
    expect((await readJson(fixture.blueprintPath)).acceptedDifferences).toEqual(converted.differences.map(({ item }) => ({ item, reason })));
    expect(text(reply)).toMatch(/\nCompile the Mission in place \(compile_map\)/);
  }, 60_000);

  it("asks for a mod or a Mission, and refuses a mod's options for a Mission", async () => {
    fixture = await keptConversation();
    const client = await connect(fixture.root);
    const neither = await client.callTool({ name: "convert_screenplay", arguments: {} });
    expect(neither.isError).toBe(true);
    expect(text(neither)).toContain("Give a mod (with its conversation) or a Kept-terrain mission to convert");
    expect(text(neither)).not.toContain("not both");
    const both = await client.callTool({ name: "convert_screenplay", arguments: { mod: "harbour-mod", mission: "harbour" } });
    expect(both.isError).toBe(true);
    expect(text(both)).toContain("not both");
    for (const extra of [{ conversation: "ashen_crossing" }, { ref: "harbour" }, { source: "harbour.md" }, { renumber: true }]) {
      const refused = await client.callTool({ name: "convert_screenplay", arguments: { mission: "harbour", ...extra } });
      expect(refused.isError).toBe(true);
      expect(text(refused)).toContain("so it takes only accept");
    }
    const noConversation = await client.callTool({ name: "convert_screenplay", arguments: { mod: "harbour-mod" } });
    expect(noConversation.isError).toBe(true);
    expect(text(noConversation)).toContain("Give the mod's Kept CConversation id");
    // None of those touched the Blueprint.
    expect((await readJson(fixture.blueprintPath)).screenplay.script.conversion).toBeUndefined();
  }, 60_000);
});

describe("convert_screenplay for a mod", () => {
  it("declares a Kept Conversation's Screenplay and returns the mod's conversion whole, as before", async () => {
    const mod = await harbour(screenplay("Aye aye."));
    await declare(mod, { characters: CHARACTERS });
    const client = await connect(mod.workspaceRoot);
    const reply = await client.callTool({ name: "convert_screenplay", arguments: { mod: "harbour-story", conversation: "HarbourChats" } });

    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({
      index: 0,
      ref: "act_harbour",
      source: "screenplays/HarbourChats.md",
      lines: 3,
      importedSounds: 3,
      textDifferences: [{ item: `string:${STRINGS_FILE}:Conversation/HarbourChats/Line01002`, kept: "Aye, ma'am.", script: "Aye aye." }],
    });
    expect(text(reply)).toContain("compile_mod");
  });
});
