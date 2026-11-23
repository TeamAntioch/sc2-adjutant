// Campaign Mod Screenplays (ADR-0011): a Campaign Mod's Blueprint names each Screenplay its hub
// chats and interludes come from (what the Screenplay Source knows it by, its pulled copy and the
// Conversation it compiles into), and the conversation shape compiles it into ConversationData and
// its strings, keeping the imported ids. The mod, its Campaign Pack and its Source are synthetic.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { WORKSPACE_FILE } from "../../src/plugins/workspace.js";
import { compileMod, EquivalenceError } from "../../src/mods/compile-mod.js";
import { convertEntries } from "../../src/mods/convert-entries.js";
import { convertScreenplay } from "../../src/mods/convert-screenplay.js";
import { editModScreenplay, findModScreenplay, pullModScreenplays, refreshModScreenplays } from "../../src/mods/conversations.js";
import { blueprintKind, readModBlueprint } from "../../src/mods/workspace-mods.js";
import { CHARACTERS, CONVERSATION_FILE, DECLARED, declareChats, harbour, KEPT_CONVERSATIONS, screenplay, setAct, STRINGS_FILE } from "./harbour-chats.js";
import { cleanupMods, declare, hashTree, inPackage, put, setup } from "./mod-fixture.js";

afterEach(cleanupMods);

const STRING = (key: string) => `string:${STRINGS_FILE}:Conversation/HarbourChats/${key}`;
const ENTRY = `catalog-entry:${CONVERSATION_FILE}:CConversation:HarbourChats`;

describe("a Campaign Mod's Screenplays", () => {
  it("compile into the Conversation they name, equivalent to the Editor's: its groups, lines, speakers and imported sounds, and its strings", async () => {
    const mod = await harbour();
    await declareChats(mod);

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions.filter((conversion) => conversion.accepted)).toEqual([]);
    expect(compiled.conversions.map((conversion) => conversion.item)).toEqual(
      expect.arrayContaining([ENTRY, STRING("Group00001"), STRING("Group00002"), STRING("Line01001"), STRING("Line01002"), STRING("Line02001")]),
    );
    const data = await inPackage(mod, CONVERSATION_FILE);
    expect(data).toContain(`    <CConversation id="Ferry">\r\n        <ProductionLevel value="2"/>\r\n    </CConversation>\r\n`);
    expect(data).toContain(`<Sound value="Harbour-Quay-01-002-Dockhand"/>`);
    // The emotion tags and the direction aren't the subtitle.
    expect(await inPackage(mod, STRINGS_FILE)).toContain("Conversation/HarbourChats/Line01002=Aye, ma'am.\n");
    expect(await inPackage(mod, STRINGS_FILE)).toContain("Conversation/Ferry/Line01001=All aboard.\n");
    expect(compiled.warnings).toEqual([]);
  });
});

describe("changing a line at the Screenplay Source", () => {
  it("changes, once pulled and recompiled, the line's string and nothing else in the mod", async () => {
    const mod = await harbour();
    await declareChats(mod);
    await compileMod(mod.blueprintPath, { decisions: undefined });
    const before = await hashTree(mod.modPackage);
    const strings = await inPackage(mod, STRINGS_FILE);

    await setAct(mod, screenplay("Aye, ma'am. Tied off."));
    await pullModScreenplays(mod.blueprintPath);
    await compileMod(mod.blueprintPath);

    const after = await hashTree(mod.modPackage);
    expect(Object.keys(after).filter((file) => after[file] !== before[file])).toEqual([STRINGS_FILE]);
    expect(await inPackage(mod, STRINGS_FILE)).toBe(strings.replace("Line01002=Aye, ma'am.\n", "Line01002=Aye, ma'am. Tied off.\n"));
  });

  it("is a difference from the Editor's text when converting, which fails the Equivalence Check until it is named", async () => {
    const mod = await harbour(screenplay("Aye aye."));
    await declareChats(mod);

    const failed = await compileMod(mod.blueprintPath).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(EquivalenceError);
    expect((failed as EquivalenceError).mismatches).toEqual([{ item: STRING("Line01002"), detail: "Aye, ma'am. is now Aye aye." }]);

    await declare(mod, { acceptedDifferences: [{ item: STRING("Line01002"), reason: "The script's newer wording" }] });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toContainEqual({ item: STRING("Line01002"), accepted: "The script's newer wording" });
  });
});

describe("an imported line", () => {
  it("keeps its id: a Screenplay that no longer names it (renumbered or cut at the Source) fails the compile and the Workspace check until its Sound is let go", async () => {
    const mod = await harbour();
    await declareChats(mod);
    await compileMod(mod.blueprintPath);
    // The pull refuses it (below), so the pulled copy gets it some other way, such as by hand.
    await put(path.join(mod.modDir, DECLARED.source), screenplay().replace("`H-02-001-DOCKHAND`", "`H-02-002-DOCKHAND`"));

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/importedSounds keeps Line02001's Sound, but the Screenplay has no line Line02001/);
    expect((await checkWorkspace(mod.workspaceRoot)).problems).toEqual([expect.objectContaining({ path: "screenplays.0", message: expect.stringContaining("no line Line02001") })]);
  });
});

describe("a Screenplay's speakers", () => {
  it("each need a character in the Mod Blueprint: one without fails the Workspace check", async () => {
    const mod = await harbour();
    await declare(mod, { characters: [CHARACTERS[0]], screenplays: [DECLARED] });
    await put(path.join(mod.modDir, DECLARED.source), screenplay());

    const check = await checkWorkspace(mod.workspaceRoot);

    expect(check.problems).toEqual([
      expect.objectContaining({ mod: "harbour-story", file: "mods/harbour-story/screenplays/harbour-chats.md", path: "screenplays.0", message: expect.stringMatching(/DOCKHAND \(first in scene 1, line 2\) has no character: declare each in the characters of the Mod Blueprint .*mods\/harbour-story\/blueprint\.json/) }),
    ]);
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/DOCKHAND .* has no character/);
  });

  it("refuse a pull that names a speaker with no character, leaving the pulled copy as it was", async () => {
    const mod = await harbour();
    await declareChats(mod);
    await setAct(mod, screenplay().replace("**DOCKHAND** `H-01-002", "**BOSUN** `H-01-002"));

    await expect(pullModScreenplays(mod.blueprintPath)).rejects.toThrow(/BOSUN .* has no character/);
    expect(await readFile(path.join(mod.modDir, DECLARED.source), "utf8")).toBe(screenplay());
  });
});

describe("convertScreenplay", () => {
  it("declares a Kept Conversation's Screenplay, found and pulled from the Source, keeping the Sounds its lines were imported with", async () => {
    const mod = await harbour(screenplay("Aye aye."));
    await declare(mod, { characters: CHARACTERS });

    const converted = await convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" });

    expect(converted).toEqual({
      index: 0,
      ref: "act_harbour",
      source: "screenplays/HarbourChats.md",
      lines: 3,
      importedSounds: 3,
      textDifferences: [{ item: STRING("Line01002"), kept: "Aye, ma'am.", script: "Aye aye." }],
    });
    expect((await readModBlueprint(mod.blueprintPath)).screenplays).toEqual([{ ...DECLARED, source: "screenplays/HarbourChats.md" }]);
    expect(await readFile(path.join(mod.modDir, "screenplays/HarbourChats.md"), "utf8")).toBe(screenplay("Aye aye."));

    await declare(mod, { acceptedDifferences: [{ item: STRING("Line01002"), reason: "The script's newer wording" }] });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.conversions).toContainEqual({ item: ENTRY });
  });

  it("refuses a Screenplay whose lines don't line up with the Conversation's, naming each, and changes nothing", async () => {
    const mod = await harbour(screenplay().replace("`H-02-001-DOCKHAND`", "`H-02-002-DOCKHAND`"));
    await declare(mod, { characters: CHARACTERS });
    const blueprint = await readFile(mod.blueprintPath, "utf8");

    await expect(convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" })).rejects.toThrow(
      /act_harbour's lines don't line up with HarbourChats's: the Screenplay has Line02002, which the Conversation doesn't; the Conversation has Line02001, which the Screenplay doesn't/,
    );
    expect(await readFile(mod.blueprintPath, "utf8")).toBe(blueprint);
    expect(existsSync(path.join(mod.modDir, "screenplays"))).toBe(false);
  });

  it("refuses a source outside the mod's folder before it fetches or writes anything", async () => {
    const mod = await harbour();
    await declare(mod, { characters: CHARACTERS });

    await expect(convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats", source: "../elsewhere.md" })).rejects.toThrow(/stays inside|in the mod's folder/);
    expect(existsSync(path.join(mod.modDir, "..", "elsewhere.md"))).toBe(false);
  });

  it("refuses a Conversation the package doesn't have, or one a Screenplay already writes", async () => {
    const mod = await harbour();
    await declareChats(mod);

    await expect(convertScreenplay(mod.blueprintPath, { conversation: "Lighthouse" })).rejects.toThrow(/has no CConversation Lighthouse/);
    await expect(convertScreenplay(mod.blueprintPath, { conversation: "HarbourChats" })).rejects.toThrow(/screenplays\.0 already writes HarbourChats/);
  });
});

describe("convert-entries", () => {
  it("leaves a Conversation a Screenplay writes to the Screenplay", async () => {
    const mod = await harbour();
    await declareChats(mod);

    const converted = await convertEntries(mod.blueprintPath, { file: CONVERSATION_FILE });

    expect(converted.converted).toEqual(["CConversation:Ferry"]);
  });
});

/** A lighthouse conversation the package doesn't have yet, so every line of it is new. */
const lighthouse = (keeper = "`H-01-001-HARBOURMASTER`") =>
  ["# LIGHTHOUSE", "", "## Scene 1: THE LAMP", "", `**HARBOURMASTER** ${keeper}: Light it.`, ""].join("\n");
const LIGHTHOUSE = { source: "screenplays/lighthouse.md", conversation: "Lighthouse" };

describe("a Mod Blueprint's Screenplays", () => {
  it("each have their own source file: two pulled into one would overwrite each other", async () => {
    const mod = await harbour();
    await declare(mod, { characters: CHARACTERS, screenplays: [DECLARED, { ...LIGHTHOUSE, ref: "act_lighthouse", source: "screenplays/./Harbour-Chats.md" }] });

    await expect(readModBlueprint(mod.blueprintPath)).rejects.toThrow(/screenplays\/\.\/Harbour-Chats\.md is the source of screenplays\.0 and screenplays\.1/);
  });

  it("each play their own Sounds: two lines of different Screenplays playing one Sound are refused, naming both", async () => {
    const mod = await harbour();
    const sound = DECLARED.importedSounds.Line01001;
    await declare(mod, { characters: CHARACTERS, screenplays: [DECLARED, { ...LIGHTHOUSE, importedSounds: { Line01001: sound.toLowerCase() } }] });
    await put(path.join(mod.modDir, DECLARED.source), screenplay());
    await put(path.join(mod.modDir, LIGHTHOUSE.source), lighthouse());

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/screenplays\.1's Line01001 and screenplays\.0's Line01001 would both play the Sound harbour-quay-01-001-harbourmaster \(Sounds are compared without case\)/);
    expect((await checkWorkspace(mod.workspaceRoot)).problems).toEqual([expect.objectContaining({ path: "screenplays.1", message: expect.stringContaining("would both play the Sound harbour-quay-01-001-harbourmaster") })]);
  });
});

describe("a new line", () => {
  it("plays the naming template's Sound, which the compile warns no CSound gives yet", async () => {
    const mod = await harbour();
    await declare(mod, { characters: CHARACTERS, screenplays: [LIGHTHOUSE] });
    await put(path.join(mod.modDir, LIGHTHOUSE.source), lighthouse());

    const compiled = await compileMod(mod.blueprintPath);

    expect(await inPackage(mod, CONVERSATION_FILE)).toContain(`<Sound value="H-01-001-HARBOURMASTER"/>`);
    expect(compiled.warnings).toEqual([expect.stringContaining("screenplays.0's Line01001 plays the Sound H-01-001-HARBOURMASTER, which no CSound in the mod gives yet")]);
  });

  it("isn't warned about when the package's SoundData already has its CSound", async () => {
    const mod = await harbour();
    await declare(mod, { characters: CHARACTERS, screenplays: [LIGHTHOUSE] });
    await put(path.join(mod.modDir, LIGHTHOUSE.source), lighthouse());
    await put(path.join(mod.modPackage, "Base.SC2Data", "GameData", "SoundData.xml"), `<?xml version="1.0" encoding="utf-8"?>\r\n<Catalog>\r\n    <CSound id="H-01-001-HARBOURMASTER"/>\r\n</Catalog>\r\n`);

    expect((await compileMod(mod.blueprintPath)).warnings).toEqual([]);
  });
});

describe("pulling a mod's Screenplays", () => {
  it("refuses a Screenplay that lost an imported line, leaving every file as it was", async () => {
    const mod = await harbour();
    await declareChats(mod);
    await setAct(mod, screenplay().replace("`H-02-001-DOCKHAND`", "`H-02-002-DOCKHAND`"));

    await expect(pullModScreenplays(mod.blueprintPath)).rejects.toThrow(/importedSounds keeps Line02001's Sound, but the Screenplay has no line Line02001/);
    expect(await readFile(path.join(mod.modDir, DECLARED.source), "utf8")).toBe(screenplay());
  });
});

describe("a strings key two writers give differently", () => {
  it("names both writers", async () => {
    const mod = await harbour();
    await declareChats(mod);
    await declare(mod, { strings: { [STRINGS_FILE]: { "Conversation/HarbourChats/Line01001": "Make her fast." } } });

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(`Conversation/HarbourChats/Line01001 in ${STRINGS_FILE} is written twice, differently: by strings["${STRINGS_FILE}"] and by screenplays.0; leave it to one of them`);
  });
});

describe("blueprintKind", () => {
  it("tells a Mod Blueprint from a Mission Blueprint, and names a file that isn't JSON", async () => {
    const mod = await harbour();
    await declareChats(mod);
    const notJson = path.join(mod.modDir, "broken.json");
    await writeFile(notJson, "{ nope");
    const mission = path.join(mod.modDir, "mission.json");
    await writeFile(mission, JSON.stringify({ id: "lava_field" }));

    expect(await blueprintKind(mod.blueprintPath)).toBe("mod");
    expect(await blueprintKind(mission)).toBe("mission");
    await expect(blueprintKind(notJson)).rejects.toThrow(new RegExp(`Can't read the Blueprint .*broken\\.json: .*JSON`));
  });
});

describe("addressing a Screenplay of the mod", () => {
  const second = { ...DECLARED, ref: "act_ferry", source: "screenplays/ferry-chats.md", conversation: "Ferry", importedSounds: {} };

  it("by its ref, its conversation or its file, and by nothing when the mod declares one", async () => {
    const mod = await harbour();
    await declare(mod, { characters: CHARACTERS, screenplays: [DECLARED, second] });
    const blueprint = await readModBlueprint(mod.blueprintPath);

    expect(findModScreenplay(blueprint, mod.blueprintPath, "act_harbour")).toBe(0);
    expect(findModScreenplay(blueprint, mod.blueprintPath, "ferry")).toBe(1);
    expect(findModScreenplay(blueprint, mod.blueprintPath, "screenplays/harbour-chats.md")).toBe(0);
    expect(findModScreenplay(blueprint, mod.blueprintPath, "Ferry-Chats")).toBe(1);
    expect(findModScreenplay(blueprint, mod.blueprintPath, ".\\screenplays\\Harbour-Chats.md")).toBe(0);
    expect(findModScreenplay({ ...blueprint, screenplays: [DECLARED] }, mod.blueprintPath)).toBe(0);
  });

  it("refuses a name that matches none, and no name among several, listing what the mod declares", async () => {
    const mod = await harbour();
    await declare(mod, { characters: CHARACTERS, screenplays: [DECLARED, second] });
    const blueprint = await readModBlueprint(mod.blueprintPath);

    expect(() => findModScreenplay(blueprint, mod.blueprintPath, "act_nope")).toThrow(/names none of .*act_harbour \/ HarbourChats .*act_ferry \/ Ferry/);
    expect(() => findModScreenplay(blueprint, mod.blueprintPath)).toThrow(/declares 2 Screenplays: name one by/);
  });
});

describe("editModScreenplay", () => {
  it("hands the edits to the Source for the Screenplay's ref, with the mod's id, and returns its report", async () => {
    const mod = await harbour();
    await declareChats(mod);
    const edits = { revision: "abc", edits: [{ cut: "H-01-002-DOCKHAND" }] };

    const dry = await editModScreenplay(mod.blueprintPath, undefined, edits, true);
    expect(dry).toEqual({ index: 0, ref: "act_harbour", report: "edited act_harbour (dry run)\n" });
    expect(JSON.parse(await readFile(path.join(mod.workspaceRoot, "edit-request.json"), "utf8"))).toEqual({ modId: "harbour-story", ref: "act_harbour", edits, dryRun: true });

    await editModScreenplay(mod.blueprintPath, "HarbourChats", edits, false);
    expect(JSON.parse(await readFile(path.join(mod.workspaceRoot, "edit-request.json"), "utf8")).dryRun).toBe(false);
    // Nothing is written in the Workspace: the pulled copy waits for the pull.
    expect(await readFile(path.join(mod.modDir, DECLARED.source), "utf8")).toBe(screenplay());
  });

  it("is refused for a Screenplay with no ref, as there is nothing to ask the Source for", async () => {
    const mod = await harbour();
    await declare(mod, { characters: CHARACTERS, screenplays: [{ ...DECLARED, ref: undefined }] });

    await expect(editModScreenplay(mod.blueprintPath, undefined, {}, true)).rejects.toThrow(/screenplays\.0 has no ref/);
  });
});

describe("refreshModScreenplays", () => {
  it("pulls, follows the lines to their new sound IDs and names a changed line that still plays its imported Sound", async () => {
    const mod = await harbour();
    await declareChats(mod);

    await setAct(mod, screenplay("Aye, ma'am. Tied off."));
    const { sourceName, refreshed } = await refreshModScreenplays(mod.blueprintPath);

    expect(sourceName).toBe("harbour-notes");
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({ index: 0, ref: "act_harbour", keptSounds: ["Line01002"] });
    expect(refreshed[0]!.moves?.changed).toEqual([{ from: "H-01-002-DOCKHAND", to: "H-01-002-DOCKHAND" }]);
    expect(await readFile(path.join(mod.modDir, DECLARED.source), "utf8")).toBe(screenplay("Aye, ma'am. Tied off."));
  });

  it("reports a line gone as the pull refuses it, while its Sound is kept", async () => {
    const mod = await harbour();
    await declareChats(mod);

    await setAct(mod, screenplay().replace("**DOCKHAND** `H-01-002-DOCKHAND`: [Happy 30]Aye[/Happy], ma'am.\n\n", ""));
    await expect(refreshModScreenplays(mod.blueprintPath)).rejects.toThrow(/importedSounds keeps Line01002's Sound.*nothing was pulled/);
  });
});
