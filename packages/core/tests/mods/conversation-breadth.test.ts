// Conversation shape breadth (ADR-0011): the Editor's Conversations the shape didn't write as they
// stand. A wordless scene is an empty group, an imported group keeps the stale name the Editor gave
// it, a renumbering at the Source is accepted with its Kept references following the new ids, and
// convert-entries leaves a Screenplay's Conversation to convert-screenplay. All synthetic.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileMod } from "../../src/mods/compile-mod.js";
import { convertEntries } from "../../src/mods/convert-entries.js";
import { convertScreenplay } from "../../src/mods/convert-screenplay.js";
import { readModBlueprint } from "../../src/mods/workspace-mods.js";
import { CHARACTERS, CONVERSATION_FILE, harbour, keptLine, STRINGS_FILE } from "./harbour-chats.js";
import { cleanupMods, declare, inPackage, put } from "./mod-fixture.js";

afterEach(cleanupMods);

const STRING = (key: string) => `string:${STRINGS_FILE}:Conversation/HarbourChats/${key}`;
const ENTRY = `catalog-entry:${CONVERSATION_FILE}:CConversation:HarbourChats`;

/** The Harbour's chats as the Editor saved them: `groups` then `lines`, in the Ferry's catalog. */
const keptChats = (groups: readonly string[], lines: readonly string[][]) =>
  [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<Catalog>`,
    `    <CConversation id="HarbourChats">`,
    `        <EditorCategories value="ConversationType:Mission"/>`,
    `        <ProductionLevel value="2"/>`,
    ...groups,
    ...lines.flat(),
    `    </CConversation>`,
    `</Catalog>`,
    ``,
  ].join("\r\n");

const group = (id: string, children: readonly string[], name = `Conversation/HarbourChats/${id}`) =>
  children.length === 0
    ? [`        <Groups Id="${id}" Name="${name}"/>`]
    : [`        <Groups Id="${id}" Name="${name}">`, ...children.map((child) => `            <Children value="${child}"/>`), `        </Groups>`];
const roots = (...ids: string[]) => ids.map((id) => `        <RootItems value="${id}"/>`);

const act = (scenes: readonly (readonly string[])[]) =>
  ["# HARBOUR CHATS", "", "- Act ID: act_harbour", "", ...scenes.flatMap((scene, index) => [`## Scene ${index + 1}: ${scene[0]}`, "", ...scene.slice(1).flatMap((line) => [line, ""])])].join("\n");

const strings = (entries: Record<string, string>) => `﻿${Object.entries(entries).map(([key, text]) => `Conversation/HarbourChats/${key}=${text}\r\n`).join("")}`;

/** The Harbour with its chats Kept as `kept`, their strings `keptStrings`, and the Act `markdown` at the Source. */
async function chats(markdown: string, kept: string, keptStrings: Record<string, string>) {
  const mod = await harbour(markdown);
  await put(path.join(mod.modPackage, ...CONVERSATION_FILE.split("/")), kept);
  await put(path.join(mod.modPackage, ...STRINGS_FILE.split("/")), strings(keptStrings));
  await declare(mod, { characters: CHARACTERS });
  return mod;
}

describe("a wordless scene", () => {
  it("is an empty group named after the scene, as the Editor makes it, so the scenes after it keep their groups", async () => {
    const mod = await chats(
      act([["THE FOG", "> The fog rolls in. Nobody speaks."], ["THE CRANE", "**DOCKHAND** `H-02-001-DOCKHAND`: She's stuck again."]]),
      keptChats([...group("Group00001", []), ...group("Group00002", ["Line02001"]), ...roots("Group00001", "Group00002")], [keptLine("Line02001", "Harbour-Crane-02-001-Dockhand", "CharDockhand")]),
      { Group00001: "THE FOG", Group00002: "THE CRANE", Line02001: "She's stuck again." },
    );

    await convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" });
    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions).toEqual(expect.arrayContaining([{ item: ENTRY }, { item: STRING("Group00001") }]));
    expect(compiled.conversions.filter((conversion) => conversion.accepted)).toEqual([]);
    expect(await inPackage(mod, CONVERSATION_FILE)).toContain(`<Groups Id="Group00001" Name="Conversation/HarbourChats/Group00001"/>`);
  });
});

describe("an imported group's name", () => {
  it("is kept where the Editor left a stale one, as its title's string key, so the hub chat converts equivalent", async () => {
    const stale = "Conversation/HarbourD-Chats/Group00001";
    const mod = await chats(
      act([["THE QUAY", "**HARBOURMASTER** `H-01-001-HARBOURMASTER`: Tie her off."], ["THE CRANE", "**DOCKHAND** `H-02-001-DOCKHAND`: She's stuck again."]]),
      keptChats(
        [...group("Group00001", ["Line01001"], stale), ...group("Group00002", ["Line02001"]), ...roots("Group00001", "Group00002")],
        [keptLine("Line01001", "H-01-001-HARBOURMASTER", "CharHarbourmaster"), keptLine("Line02001", "H-02-001-DOCKHAND", "CharDockhand")],
      ),
      { Group00001: "THE QUAY (old)", Group00002: "THE CRANE", Line01001: "Tie her off.", Line02001: "She's stuck again." },
    );
    await put(path.join(mod.modPackage, ...STRINGS_FILE.split("/")), `${strings({ Group00002: "THE CRANE", Line01001: "Tie her off.", Line02001: "She's stuck again." })}${stale}=THE QUAY\r\n`);

    await convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" });

    expect((await readModBlueprint(mod.blueprintPath)).screenplays[0]?.importedGroupNames).toEqual({ Group00001: stale });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toEqual(expect.arrayContaining([{ item: ENTRY }, { item: `string:${STRINGS_FILE}:${stale}` }]));
    expect(compiled.conversions.filter((conversion) => conversion.accepted)).toEqual([]);
  });

  it("is refused at the compile when the Screenplay no longer has its group", async () => {
    const mod = await chats(act([["THE QUAY", "**HARBOURMASTER** `H-01-001-HARBOURMASTER`: Tie her off."]]), keptChats([], []), {});
    await declare(mod, { screenplays: [{ ref: "act_harbour", source: "screenplays/HarbourChats.md", conversation: "HarbourChats", importedGroupNames: { Group00002: "Conversation/Old/Group00002" } }] });
    await put(path.join(mod.modDir, "screenplays/HarbourChats.md"), act([["THE QUAY", "**HARBOURMASTER** `H-01-001-HARBOURMASTER`: Tie her off."]]));

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/importedGroupNames keeps Group00002's name, but the Screenplay has no scene 2/);
  });
});

describe("convert-screenplay's text differences", () => {
  it("leave out a line that differs only by trailing space, which the compile doesn't count", async () => {
    const mod = await chats(
      act([["THE QUAY", "**HARBOURMASTER** `H-01-001-HARBOURMASTER`: Tie her off. "]]),
      keptChats([...group("Group00001", ["Line01001"]), ...roots("Group00001")], [keptLine("Line01001", "H-01-001-HARBOURMASTER", "CharHarbourmaster")]),
      { Group00001: "THE QUAY", Line01001: "Tie her off." },
    );

    expect((await convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" })).textDifferences).toEqual([]);
    expect((await compileMod(mod.blueprintPath)).conversions).toContainEqual({ item: STRING("Line01001") });
  });
});

describe("convert-entries before convert-screenplay", () => {
  it("leaves a Conversation whose Screenplay the Source knows Kept, for convert-screenplay, and converts the others", async () => {
    const mod = await harbour();
    await declare(mod, { characters: CHARACTERS });

    const converted = await convertEntries(mod.blueprintPath, { file: CONVERSATION_FILE });

    expect(converted.converted).toEqual(["CConversation:Ferry"]);
    expect(converted.refused).toEqual([{ key: "CConversation:HarbourChats", reason: "its Screenplay is act_harbour at the Screenplay Source harbour-notes: convert it with convert-screenplay" }]);
    await convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" });
    expect((await compileMod(mod.blueprintPath)).conversions).toEqual(expect.arrayContaining([{ item: ENTRY }, { item: `catalog-entry:${CONVERSATION_FILE}:CConversation:Ferry` }]));
  });
});

/** The Harbour's chats before the author folded the empty scene 1 into the quay scene at the Source. */
const BEFORE_FOLD = keptChats(
  [...group("Group00001", []), ...group("Group00002", ["Line02001", "Line02002"]), ...group("Group00003", ["Line03001"]), ...roots("Group00001", "Group00002", "Group00003")],
  [keptLine("Line02001", "Old-02-001-Harbourmaster", "CharHarbourmaster"), keptLine("Line02002", "Old-02-002-Dockhand", "CharDockhand"), keptLine("Line03001", "Old-03-001-Dockhand", "CharDockhand")],
);
const BEFORE_FOLD_STRINGS = { Group00001: "ON THE QUAY, WANDERING", Group00002: "THE QUAY", Group00003: "THE CRANE", Line02001: "Tie her off.", Line02002: "Aye, ma'am.", Line03001: "She's stuck again." };
const FOLDED = act([
  ["THE QUAY", "**HARBOURMASTER** `H-01-001-HARBOURMASTER`: Tie her off.", "**DOCKHAND** `H-01-002-DOCKHAND`: Aye, ma'am."],
  ["THE CRANE", "**DOCKHAND** `H-02-001-DOCKHAND`: She's stuck again."],
]);
/** A library trigger that sends two of the chats' lines, and a Ferry line of the same id. */
const KEPT_TRIGGERS = [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<TriggerData>`,
  `    <Library Id="Hbr1">`,
  `        <Element Type="Param" Id="00000001">`,
  `            <Value>HarbourChats|Line02002</Value>`,
  `            <ValueType Type="convline"/>`,
  `        </Element>`,
  `        <Element Type="Param" Id="00000002">`,
  `            <Value>HarbourChats|Line03001</Value>`,
  `            <ValueType Type="convline"/>`,
  `        </Element>`,
  `        <Element Type="Param" Id="00000003">`,
  `            <Value>Ferry|Line02002</Value>`,
  `            <ValueType Type="convline"/>`,
  `        </Element>`,
  `    </Library>`,
  `</TriggerData>`,
  ``,
].join("\r\n");
const CUTSCENE_FILE = "Base.SC2Data/Cutscenes/Harbour Chats.SC2Cutscene";
const keptCutscene = (driver: string, element: string, ferry: string, bookmarks = ["Group00002", "Line02001", "Line03001"]) =>
  [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<Cutscene>`,
    `    <CCutsceneNodeBookmark guid="5" name="Lines">`,
    ...bookmarks.map((name, index) => `        <CCutsceneElementBookmark guid="${6 + index}" bookmarkName="${name}"/>`),
    `    </CCutsceneNodeBookmark>`,
    `    <CCutsceneNodeConversationDriver guid="1" name="Conversation Driver" conversationLink="HarbourChats">`,
    `        <CCutsceneElementConversationDriver guid="2" lineId="${driver}" previousOverlap="500"/>`,
    `    </CCutsceneNodeConversationDriver>`,
    `    <CCutsceneElementConversation guid="3" conversationLink="HarbourChats" conversationLine="${element}" soundLink="Old-03-001-Dockhand"/>`,
    `    <CCutsceneElementConversation guid="4" conversationLink="Ferry" conversationLine="${ferry}"/>`,
    `</Cutscene>`,
    ``,
  ].join("\r\n");

async function folded() {
  const mod = await chats(FOLDED, BEFORE_FOLD, BEFORE_FOLD_STRINGS);
  await put(path.join(mod.modPackage, "Triggers"), KEPT_TRIGGERS);
  await put(path.join(mod.modPackage, ...CUTSCENE_FILE.split("/")), keptCutscene("Line02001", "Line03001", "Line03001"));
  return mod;
}
const REASON = "Scene 1 folded into the quay scene at the Source (author, 2026-11-02)";

describe("a Conversation renumbered at the Source", () => {
  it("is refused without the author's renumbering, naming it", async () => {
    const mod = await folded();
    await expect(convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" })).rejects.toThrow(/lines don't line up .*renumber/);
  });

  it("converts once the author renumbers it: lines paired in order keep their Sounds, the differences are accepted, and the Kept references follow the new ids", async () => {
    const mod = await folded();

    const converted = await convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats", accept: REASON, renumber: true });

    expect(converted.renumbered).toEqual([
      { from: "Line02001", to: "Line01001" },
      { from: "Line02002", to: "Line01002" },
      { from: "Line03001", to: "Line02001" },
    ]);
    expect(converted.references).toEqual([
      { file: CUTSCENE_FILE, count: 5 },
      { file: "Triggers", count: 2 },
    ]);
    expect(converted.textDifferences).toEqual([]);
    const blueprint = await readModBlueprint(mod.blueprintPath);
    expect(blueprint.screenplays[0]?.importedSounds).toEqual({ Line01001: "Old-02-001-Harbourmaster", Line01002: "Old-02-002-Dockhand", Line02001: "Old-03-001-Dockhand" });
    expect(blueprint.acceptedDifferences).toEqual([
      { item: ENTRY, reason: REASON },
      { item: STRING("Group00001"), reason: REASON },
      { item: STRING("Group00002"), reason: REASON },
      { item: STRING("Line02001"), reason: REASON },
    ]);
    expect(await inPackage(mod, "Triggers")).toBe(KEPT_TRIGGERS.replace("HarbourChats|Line02002", "HarbourChats|Line01002").replace("HarbourChats|Line03001", "HarbourChats|Line02001"));
    // Its bookmarks named after the lines and scenes follow too, in a cutscene that drives only this conversation.
    expect(await inPackage(mod, CUTSCENE_FILE)).toBe(keptCutscene("Line01001", "Line02001", "Line03001", ["Group00001", "Line01001", "Line02001"]));

    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toContainEqual({ item: ENTRY, accepted: REASON });
    expect(compiled.warnings).toEqual([]);
    expect(await inPackage(mod, CONVERSATION_FILE)).toContain(`<Sound value="Old-03-001-Dockhand"/>`);
  });

  it("leaves another conversation's driver alone after an empty driver of this one", async () => {
    const mod = await chats(FOLDED, BEFORE_FOLD, BEFORE_FOLD_STRINGS);
    const cutscene = [
      `<Cutscene>`,
      `    <CCutsceneNodeConversationDriver guid="1" conversationLink="HarbourChats"/>`,
      `    <CCutsceneNodeConversationDriver guid="2" conversationLink="Ferry">`,
      `        <CCutsceneElementConversationDriver guid="3" lineId="Line02001"/>`,
      `    </CCutsceneNodeConversationDriver>`,
      `</Cutscene>`,
      ``,
    ].join("\r\n");
    await put(path.join(mod.modPackage, ...CUTSCENE_FILE.split("/")), cutscene);

    expect((await convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats", accept: REASON, renumber: true })).references).toEqual([]);
    expect(await inPackage(mod, CUTSCENE_FILE)).toBe(cutscene);
  });

  it("refuses a pairing whose speakers differ, changing nothing", async () => {
    const mod = await folded();
    await put(path.join(mod.workspaceRoot, "screenplays.json"), JSON.stringify({ act_harbour: FOLDED.replace("**DOCKHAND** `H-01-002-DOCKHAND`", "**HARBOURMASTER** `H-01-002-HARBOURMASTER`") }));
    const before = await readFile(mod.blueprintPath, "utf8");

    await expect(convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats", accept: REASON, renumber: true })).rejects.toThrow(/Line01002 \(CharHarbourmaster\) would be Line02002 \(CharDockhand\)/);
    expect(await readFile(mod.blueprintPath, "utf8")).toBe(before);
    expect(await inPackage(mod, "Triggers")).toBe(KEPT_TRIGGERS);
  });
});

describe("an accepted difference in a Conversation's groups", () => {
  it("lets convert-screenplay declare it, accepted, while its lines must still match the Editor's", async () => {
    const kept = keptChats(
      [...group("Group00001", []), ...group("Group00001", []), ...group("Group00002", ["Line02001"]), ...roots("Group00001", "Group00001", "Group00002")],
      [keptLine("Line02001", "H-02-001-DOCKHAND", "CharDockhand")],
    );
    const markdown = act([["THE FOG", "> The fog rolls in."], ["THE CRANE", "**DOCKHAND** `H-02-001-DOCKHAND`: She's stuck again."]]);
    const mod = await chats(markdown, kept, { Group00001: "THE FOG", Group00002: "THE CRANE", Line02001: "She's stuck again." });
    const reason = "The Editor wrote the empty Group00001 twice: the compile writes it once";

    await expect(convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" })).rejects.toThrow(/wouldn't compile .* as the Editor has it/);
    const converted = await convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats", accept: reason });

    expect(converted.entryDifference).toMatch(/<Groups Id="Group00001"/);
    expect((await readModBlueprint(mod.blueprintPath)).acceptedDifferences).toEqual([{ item: ENTRY, reason }]);
    expect((await compileMod(mod.blueprintPath)).conversions).toContainEqual({ item: ENTRY, accepted: reason });
    expect(await inPackage(mod, CONVERSATION_FILE)).toContain(`<Groups Id="Group00001" Name="Conversation/HarbourChats/Group00001"/>`);
  });

  it("is refused when a line differs as well", async () => {
    const kept = keptChats([...group("Group00001", ["Line01001"]), ...roots("Group00001")], [keptLine("Line01001", "H-01-001-HARBOURMASTER", "CharDockhand")]);
    const mod = await chats(act([["THE QUAY", "**HARBOURMASTER** `H-01-001-HARBOURMASTER`: Tie her off."]]), kept, { Group00001: "THE QUAY", Line01001: "Tie her off." });

    await expect(convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats", accept: "Anything" })).rejects.toThrow(/lines wouldn't compile as the Editor has them .*CharDockhand/);
  });
});

describe("an imported line's facial animation", () => {
  it("is kept, as its Sound is, so the line converts equivalent", async () => {
    const sad = keptLine("Line01001", "H-01-001-HARBOURMASTER", "CharHarbourmaster");
    sad.splice(3, 0, `            <FacialAnim value="Sad"/>`);
    const mod = await chats(act([["THE QUAY", "**HARBOURMASTER** `H-01-001-HARBOURMASTER`: Tie her off."]]), keptChats([...group("Group00001", ["Line01001"]), ...roots("Group00001")], [sad]), { Group00001: "THE QUAY", Line01001: "Tie her off." });

    await convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" });

    expect((await readModBlueprint(mod.blueprintPath)).screenplays[0]?.importedFacialAnims).toEqual({ Line01001: "Sad" });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toContainEqual({ item: ENTRY });
    expect(await inPackage(mod, CONVERSATION_FILE)).toContain(`<FacialAnim value="Sad"/>`);
  });
});
