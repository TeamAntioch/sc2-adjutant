import { describe, expect, it } from "vitest";

import { EMPTY_REGISTRY, type NamingTemplate, type PluginRegistry } from "../../src/plugins/plugin-api.js";
import { charactersOf, NO_CHARACTERS } from "../../src/mods/characters.js";
import { nameScript, scriptLines } from "../../src/script/name-script.js";
import { parseScript, parseSpans } from "../../src/script/parse-script.js";
import { crossingMarkdown, crossingScript as script } from "../support/workspaces.js";

describe("parseScript on Ashen Crossing", () => {
  it("reads the header and all three scenes", () => {
    expect(script.title).toBe("Ashen Crossing");
    expect(parseScript(crossingMarkdown).fields).toEqual({ Chapter: "2" });
    expect(script.scenes.map((scene) => scene.number)).toEqual([1, 2, 3]);
    expect(script.scenes[1]!.title).toBe("BETWEEN THE SURGES");
  });

  it("reads each line's speaker, place in its scene and emotion spans", () => {
    expect(parseScript(crossingMarkdown).scenes[0]!.items[1]).toEqual({
      kind: "line",
      speaker: "KARAX",
      position: 1,
      text: "The star surges every few minutes. Out in the open, the heat will burn through any shield.",
      shown: "The star surges every few minutes. Out in the open, the heat will burn through any shield.",
      spans: [{ text: "The star surges every few minutes.", mood: "Serious", intensity: 40 }, { text: " Out in the open, the heat will burn through any shield." }],
    });
  });

  it("reads a line's sound id", () => {
    const withIds = parseScript(["# Ids", "## Scene 1: GATE", "**ZERATUL** `gate-1-zeratul`: I am here."].join("\n"));
    expect(withIds.scenes[0]!.items[0]).toMatchObject({ kind: "line", speaker: "ZERATUL", scriptId: "gate-1-zeratul", text: "I am here." });
  });

  it("keeps stage directions in order with the lines", () => {
    const scene2 = script.scenes[1]!;
    expect(scene2.items.map((item) => item.kind)).toEqual(["direction", "line", "line"]);
    expect(scene2.items[0]).toEqual({ kind: "direction", text: "The ground glows as a surge rolls over the plain, then dims." });
  });

  it("names it by mission id, scene and line without a Campaign Pack", () => {
    expect(script.conversationId).toBe("ashen_crossing");
    expect(scriptLines(script)[0]).toMatchObject({ speaker: "KARAX", character: "Karax", soundId: "ashen_crossing-1-1", lineId: "Line1-1" });
    expect(script.scenes.map((scene) => scene.items.filter((item) => item.kind === "line").length)).toEqual([4, 2, 2]);
  });
});

describe("parseScript on a plain Screenplay", () => {
  const plain = parseScript(
    ["# Lava Field", "- Author: someone", "## Scene 1: ARRIVAL", "**RAYNOR**: Hold here.", "**Note**: not spoken.", "**TYCHUS**: Sure thing.", "**MATT HORNER**: Aye."].join("\n"),
  );

  it("reads lines without sound ids from speakers in capitals, and a title without a colon", () => {
    expect(plain.title).toBe("Lava Field");
    expect(plain.fields).toEqual({ Author: "someone" });
    // Bold text that isn't a speaker in capitals, such as **Note**:, isn't dialogue.
    expect(plain.scenes[0]!.items).toMatchObject([
      { speaker: "RAYNOR", position: 1, text: "Hold here." },
      { speaker: "TYCHUS", position: 2, text: "Sure thing." },
      { speaker: "MATT HORNER", position: 3, text: "Aye." },
    ]);
  });

  it("names them by mission id, scene and line without a naming template", () => {
    const named = nameScript(plain, "lava_field", EMPTY_REGISTRY, NO_CHARACTERS);
    expect(named.conversationId).toBe("lava_field");
    expect(scriptLines(named).map(({ lineId, soundId, soundLine, character, characterId }) => ({ lineId, soundId, soundLine, character, characterId }))).toEqual([
      { lineId: "Line1-1", soundId: "lava_field-1-1", soundLine: "1-1", character: "Raynor", characterId: "Raynor" },
      { lineId: "Line1-2", soundId: "lava_field-1-2", soundLine: "1-2", character: "Tychus", characterId: "Tychus" },
      { lineId: "Line1-3", soundId: "lava_field-1-3", soundLine: "1-3", character: "MattHorner", characterId: "MattHorner" },
    ]);
  });

  it("names a speaker from its character: the name it shows, its CCharacter, its Transmission and its voice", () => {
    const declared = [
      { speaker: "raynor", id: "CharJim", name: "Jim Raynor", unit: "Raynor", voice: "Fred", fields: {} },
      { speaker: "TYCHUS", id: "CharTychus", model: "TychusPortrait", fields: {} },
      { speaker: "Matt  Horner", id: "CharMatt", fields: {} },
    ];
    const [raynor, tychus, horner] = scriptLines(nameScript(plain, "lava_field", EMPTY_REGISTRY, charactersOf(declared, "the Campaign Mod")));
    expect(raynor).toMatchObject({ character: "Jim Raynor", characterId: "CharJim", unit: "Raynor", voice: "Fred" });
    expect(tychus).toMatchObject({ character: "Tychus", characterId: "CharTychus", model: "TychusPortrait" });
    expect(horner).toEqual(expect.not.objectContaining({ unit: expect.anything(), voice: expect.anything() }));
    expect(horner).toMatchObject({ character: "MattHorner", characterId: "CharMatt" });
  });

  it("fails a Screenplay whose speakers the Campaign Mod doesn't declare, naming each once", () => {
    const characters = charactersOf([{ speaker: "RAYNOR", id: "Raynor", fields: {} }], "the characters of the Campaign Mod Lava's Blueprint");
    expect(() => nameScript(plain, "lava_field", EMPTY_REGISTRY, characters)).toThrow(
      "The Screenplay's speakers TYCHUS (first in scene 1, line 2), MATT HORNER (first in scene 1, line 3) have no character: declare each in the characters of the Campaign Mod Lava's Blueprint",
    );
  });
});

describe("parseScript on emphasis", () => {
  const line = (text: string) => parseScript(["# Outpost", "## Scene 1: YARD", `**RAYNOR**: ${text}`].join("\n")).scenes[0]!.items[0]!;

  it("speaks `*word*` emphasis plainly and shows it in the game's italic tags", () => {
    expect(line("Wait. *You* did this?")).toMatchObject({ text: "Wait. You did this?", shown: "Wait. <i>You</i> did this?", spans: [{ text: "Wait. You did this?" }] });
    expect(line("[Angry 60]*Get* *out of here!*[/Angry]")).toMatchObject({ text: "Get out of here!", shown: "<i>Get</i> <i>out of here!</i>", spans: [{ text: "Get out of here!", mood: "Angry", intensity: 60 }] });
  });

  it("leaves a lone or spaced asterisk as it is", () => {
    expect(line("Five * three, and * that.")).toMatchObject({ text: "Five * three, and * that.", shown: "Five * three, and * that." });
  });
});

describe("parseScript on delivery directions", () => {
  const scene = (...lines: string[]) => parseScript(["# Outpost", "## Scene 1: YARD", ...lines].join("\n")).scenes[0]!.items;

  it("reads a direction after the id, or after the speaker, apart from the spoken text", () => {
    expect(scene("**HORNER** `outpost-03` *(shocked)*: [Surprise 60]Raynor![/Surprise] Here?", "**RAYNOR** *(slowly)*: Hold here.", "**TYCHUS**: Sure.")).toEqual([
      {
        kind: "line",
        speaker: "HORNER",
        position: 1,
        scriptId: "outpost-03",
        delivery: "shocked",
        text: "Raynor! Here?",
        shown: "Raynor! Here?",
        spans: [{ text: "Raynor!", mood: "Surprise", intensity: 60 }, { text: " Here?" }],
      },
      { kind: "line", speaker: "RAYNOR", position: 2, delivery: "slowly", text: "Hold here.", shown: "Hold here.", spans: [{ text: "Hold here." }] },
      { kind: "line", speaker: "TYCHUS", position: 3, text: "Sure.", shown: "Sure.", spans: [{ text: "Sure." }] },
    ]);
  });

  it("carries the direction onto the named line", () => {
    const named = nameScript(parseScript(["# Outpost", "## Scene 1: YARD", "**RAYNOR** *(slowly)*: Hold here."].join("\n")), "outpost", EMPTY_REGISTRY, NO_CHARACTERS);
    expect(scriptLines(named)[0]).toMatchObject({ soundId: "outpost-1-1", delivery: "slowly", text: "Hold here." });
  });

  it("refuses a line with a speaker and an id it can't read, rather than leave it out", () => {
    expect(() => scene("**RAYNOR** `outpost-01`: Fine.", "**HORNER** `outpost-02` [loud]: Not fine.")).toThrow(
      "Scene 1: can't read the dialogue line `**HORNER** `outpost-02` [loud]: Not fine.`: a line is **SPEAKER** `id` *(direction)*: text, with the id and the direction optional",
    );
  });
});

describe("nameScript with a Campaign Pack", () => {
  const plain = parseScript(["# Lava Field: The Return", "## Scene 1: ARRIVAL", "**RAYNOR**: Hold here.", "**TYCHUS**: Sure."].join("\n"));
  const withNaming = (naming: NamingTemplate): PluginRegistry => ({ ...EMPTY_REGISTRY, naming: () => naming });

  it("keeps a title whose colon isn't after a prefix", () => {
    expect(plain.title).toBe("Lava Field: The Return");
  });

  it("refuses an id that isn't one, naming the line and the hook", () => {
    expect(() => nameScript(plain, "lava_field", withNaming({ name: "paths", soundId: () => "../../escape" }), NO_CHARACTERS)).toThrow(
      'Scene 1, line 1 (RAYNOR): the naming template paths: its soundId hook returned "../../escape", not an id (letters, digits, _, - and ., not ending in .)',
    );
    expect(() => nameScript(plain, "lava_field", withNaming({ name: "spaces", soundId: () => "a b" }), NO_CHARACTERS)).toThrow('returned "a b", not an id');
    expect(() => nameScript(plain, "lava_field", withNaming({ name: "dot", soundId: () => "ab." }), NO_CHARACTERS)).toThrow('returned "ab.", not an id');
  });

  it("refuses two lines whose sound ids differ only in case, since their voice files would share a name", () => {
    expect(() => nameScript(plain, "lava_field", withNaming({ name: "case", soundId: ({ line }) => (line === 1 ? "Voice" : "voice") }), NO_CHARACTERS)).toThrow(
      "would share the sound id voice (ids are compared without case)",
    );
    expect(() => nameScript(plain, "lava_field", withNaming({ name: "quotes", conversationId: () => 'a"b' }), NO_CHARACTERS)).toThrow("its conversationId hook returned");
  });
});

describe("parseSpans", () => {
  it("splits emotion tags into spans and leaves untagged text plain", () => {
    expect(parseSpans("Well, [Happy 30]thanks for coming.[/Happy] Bye.")).toEqual([
      { text: "Well, " },
      { text: "thanks for coming.", mood: "Happy", intensity: 30 },
      { text: " Bye." },
    ]);
  });
});
