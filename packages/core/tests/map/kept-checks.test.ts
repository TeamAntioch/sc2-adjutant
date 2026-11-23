// Checks over Kept Content (ADR-0010): a broken link in it fails `check`, wherever it is, and a
// craft finding on it is a warning that says it's on Kept Content. The package is synthetic, in the
// Editor's own form (CRLF lines, byte-order marks): an imported Mission with no Zones, its own
// conversation, a Kept cutscene and a Kept trigger, and a Screenplay named for that conversation.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { type CompileRecord, EMPTY_COMPILE_RECORD, writeCompileRecord } from "../../src/domain/compile-record.js";
import { writeDocumentHeader } from "../../src/map/write-document-header.js";
import { checkWorkspace, isError, type WorkspaceProblem } from "../../src/plugins/check-workspace.js";
import { writeMapInfo } from "../../src/terrain/write-map-info.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const crlf = (lines: readonly string[]): string => `${lines.join("\r\n")}\r\n`;
const BOM = "﻿";

/** The Screenplay: one scene of three lines, named by core's default template Line1-1 … Line1-3. */
const SCREENPLAY = [
  "# Yard",
  "",
  "## Scene 1: AT THE GATE",
  "",
  "**GUARD**: Halt. Papers.",
  "",
  "**DOCKHAND**: He's with me.",
  "",
  "**GUARD**: Move along.",
  "",
].join("\n");

const conversationLine = (id: string, speaker: string, sound: string): string[] => [
  `  <Lines>`,
  `    <Id value="${id}"/>`,
  `    <Text value="Conversation/Yard-01/${id}"/>`,
  `    <Sound value="${sound}"/>`,
  `    <SpeakerCharacter value="${speaker}"/>`,
  `  </Lines>`,
];
const CONVERSATIONS = crlf([
  `<?xml version="1.0" encoding="us-ascii"?>`,
  `<Catalog>`,
  `  <CConversation id="Yard-01">`,
  ...conversationLine("Line1-1", "CharGuard", "Yard-1-1"),
  ...conversationLine("Line1-2", "CharDockhand", "Yard-1-2"),
  ...conversationLine("Line1-3", "CharGuard", "Yard-1-3"),
  `  </CConversation>`,
  `</Catalog>`,
]);
const CONVERSATION_STRINGS = BOM + crlf([`Conversation/Yard-01/Line1-1=Halt. Papers.`, `Conversation/Yard-01/Line1-2=He's with me.`, `Conversation/Yard-01/Line1-3=Move along.`]);

const sound = (id: string, file: string): string[] => [`    <CSound id="${id}" parent="Campaign2D">`, `        <AssetArray File="${file}"/>`, `    </CSound>`];
const SOUNDS = crlf([
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<Catalog>`,
  ...sound("Yard-1-1", "Assets\\Sounds\\Conversations\\Yard-1-1.ogg"),
  ...sound("Yard-1-2", "Assets\\Sounds\\Conversations\\Yard-1-2.ogg"),
  ...sound("Yard-1-3", "Assets\\Sounds\\Conversations\\Yard-1-3.ogg"),
  `</Catalog>`,
]);

/**
 * "Arrival": a fade in, two shots, the driver's three lines (the actor holding the second's
 * lip-sync entry, which times it), a fade to black and an End Scene marker, all within the norms.
 */
const ARRIVAL_LINES = [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<CutsceneState cutsceneVersion="1.300000">`,
  `    <CCutsceneNodeDirector guid="1" name="Director">`,
  `        <CCutsceneNodeActiveCamera guid="20" name="Active Camera">`,
  `            <CCutsceneElementActiveCamera guid="21" cameraIndex="0" objectGuid="30"/>`,
  `            <CCutsceneElementActiveCamera guid="22" start="4000" cameraIndex="0" objectGuid="31"/>`,
  `        </CCutsceneNodeActiveCamera>`,
  `        <CCutsceneNodeFade guid="23" name="Fade">`,
  `            <CCutsceneElementFade guid="24" duration="1000" amount="1.000000" unfadedAmount="0.000000" fadeIn="1"/>`,
  `            <CCutsceneElementFade guid="25" start="8000" duration="1000" amount="1.000000" unfadedAmount="0.000000" fadeIn="0"/>`,
  `        </CCutsceneNodeFade>`,
  `        <CCutsceneNodeEndScene guid="26" name="End Scene Markers">`,
  `            <CCutsceneElementEndScene guid="27" start="9500"/>`,
  `        </CCutsceneNodeEndScene>`,
  `        <CCutsceneNodeConversationDriver guid="8" name="Conversation Driver (Yard-01 (Unnamed))" conversationLink="Yard-01">`,
  `            <CCutsceneElementConversationDriver guid="9" start="1000" lineId="Line1-1" previousOverlap="0"/>`,
  `            <CCutsceneElementConversationDriver guid="10" start="3000" lineId="Line1-2" previousOverlap="500"/>`,
  `            <CCutsceneElementConversationDriver guid="11" start="5000" lineId="Line1-3" previousOverlap="500"/>`,
  `        </CCutsceneNodeConversationDriver>`,
  `        <CCutsceneNodeActor guid="2" name="Dockhand">`,
  `            <CCutsceneNodeConversation guid="3" name="Conversation">`,
  `                <CCutsceneElementConversation guid="4" start="3000" duration="1500" conversationLink="Yard-01" conversationLine="Line1-2" soundLink="Yard-1-2"/>`,
  `            </CCutsceneNodeConversation>`,
  `        </CCutsceneNodeActor>`,
  `    </CCutsceneNodeDirector>`,
  `</CutsceneState>`,
];
const ARRIVAL = crlf(ARRIVAL_LINES);

const PACKAGE: Readonly<Record<string, string>> = {
  "Base.SC2Data/Cutscenes/Arrival.SC2Cutscene": ARRIVAL,
  "Base.SC2Data/GameData/ConversationData.xml": CONVERSATIONS,
  "Base.SC2Data/GameData/SoundData.xml": SOUNDS,
  "enUS.SC2Data/LocalizedData/ConversationStrings.txt": CONVERSATION_STRINGS,
  "Assets/Sounds/Conversations/Yard-1-1.ogg": "ogg",
  "Assets/Sounds/Conversations/Yard-1-2.ogg": "ogg",
  "Assets/Sounds/Conversations/Yard-1-3.ogg": "ogg",
};

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

type Setup = {
  /** Package files to add or replace (`null` removes one). */
  readonly files?: Readonly<Record<string, string | Buffer | null>>;
  readonly record?: CompileRecord;
  /** The Screenplay's text, or `null` for a Blueprint with no screenplay.script. */
  readonly screenplay?: string | null;
  readonly dependencies?: readonly string[];
  /** Folders standing for the StarCraft II install's, by path under it. */
  readonly install?: Readonly<Record<string, string>>;
  readonly conversationId?: string;
};

/** A Workspace with the Mission `yard`: no Zones, its package as `files` give it, and its Screenplay named for the package's Yard-01. */
async function setup({ files = {}, record = EMPTY_COMPILE_RECORD, screenplay = SCREENPLAY, dependencies = [], install = {}, conversationId = "Yard-01" }: Setup = {}) {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-kept-checks-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
  const missionDir = path.join(workspaceRoot, "missions", "yard");
  const mapPackage = path.join(missionDir, "Yard.SC2Map");
  for (const [file, content] of Object.entries({ ...PACKAGE, ...files })) {
    if (content === null) continue;
    await mkdir(path.dirname(path.join(mapPackage, file)), { recursive: true });
    await writeFile(path.join(mapPackage, file), content);
  }
  const sc2Path = path.join(root, "StarCraft II");
  for (const [file, content] of Object.entries(install)) {
    await mkdir(path.dirname(path.join(sc2Path, file)), { recursive: true });
    await writeFile(path.join(sc2Path, file), content);
  }
  if (screenplay !== null) await writeFile(path.join(missionDir, "yard.md"), screenplay);
  const blueprint = {
    id: "yard",
    campaignId: "fixtures",
    title: "Yard",
    setting: "Imported",
    mapSize: { width: 128, height: 128 },
    tilesetId: "MonlythEx1",
    ...(dependencies.length ? { dependencies } : {}),
    screenplay: { title: "Yard", ...(screenplay !== null ? { script: { source: "yard.md", conversationId } } : {}) },
  };
  await writeFile(path.join(missionDir, "blueprint.json"), JSON.stringify(blueprint, null, 2));
  await writeFile(path.join(missionDir, "compile-record.json"), writeCompileRecord(record));
  return { workspaceRoot, missionDir, mapPackage, check: () => checkWorkspace(workspaceRoot, { sc2Path }) };
}

const errors = (problems: readonly WorkspaceProblem[]): string[] => problems.filter(isError).map((problem) => `${problem.file}: ${problem.message}`);
const warnings = (problems: readonly WorkspaceProblem[]): string[] => problems.filter((problem) => !isError(problem)).map((problem) => `${problem.file}: ${problem.message}`);
const CUTSCENE_FILE = "missions/yard/Yard.SC2Map/Base.SC2Data/Cutscenes/Arrival.SC2Cutscene";

describe("broken links in Kept Content fail the check", () => {
  it("passes a package whose Kept cutscene plays lines the Screenplay has, with nothing to report", async () => {
    const { check } = await setup();
    expect((await check()).problems).toEqual([]);
  });

  it("fails a Kept cutscene that plays a line cut from the Screenplay, naming the cutscene and the line", async () => {
    const { check } = await setup({ screenplay: SCREENPLAY.replace("**GUARD**: Move along.\n", "") });
    expect(errors((await check()).problems)).toEqual([
      `${CUTSCENE_FILE}: The Kept cutscene "Arrival" plays Yard-01/Line1-3, which the Screenplay no longer has: put the line back, or take it out of the cutscene in the Cutscene Editor`,
    ]);
  });
});

const withoutEndScene = crlf(ARRIVAL_LINES.filter((line) => !line.includes("EndScene")));

describe("craft findings on Kept Content are warnings", () => {
  it("warns about a Kept cutscene with no End Scene marker, saying it's on Kept Content, and passes", async () => {
    const { check } = await setup({ files: { "Base.SC2Data/Cutscenes/Arrival.SC2Cutscene": withoutEndScene } });
    const { problems } = await check();
    expect(errors(problems)).toEqual([]);
    expect(warnings(problems)).toEqual([`${CUTSCENE_FILE}: On Kept Content, the cutscene "Arrival": F1: it has no End Scene marker, so WaitForCutsceneToEnd never returns`]);
  });

  it("measures a cutscene with no End Scene marker to its last line or cut, not to the actors' elements spanning the Editor's timeline", async () => {
    // No fade to black either: an actor element runs 300 s, but the content ends with Line1-3 at 6.69 s.
    const unfinished = crlf(ARRIVAL_LINES.filter((line) => !line.includes("EndScene") && !line.includes(`fadeIn="0"`)))
      .replace(`<CCutsceneNodeActor guid="2" name="Dockhand">\r\n`, `<CCutsceneNodeActor guid="2" name="Dockhand">\r\n            <CCutsceneElementObject guid="40" duration="300000"/>\r\n`);
    const { check } = await setup({ files: { "Base.SC2Data/Cutscenes/Arrival.SC2Cutscene": unfinished } });
    expect(warnings((await check()).problems)).toEqual([`${CUTSCENE_FILE}: On Kept Content, the cutscene "Arrival": F1: it has no End Scene marker, so WaitForCutsceneToEnd never returns`]);
  });
});

/** "Arrival" with an actor's entry for a line the driver doesn't play, of a conversation the package lacks. */
const withStrayActorLine = ARRIVAL.replace(
  `soundLink="Yard-1-2"/>\r\n`,
  `soundLink="Yard-1-2"/>\r\n                <CCutsceneElementConversation guid="5" start="6000" duration="800" conversationLink="Yard-05" conversationLine="Line1-3" soundLink="Yard-1-3"/>\r\n`,
);

describe("with no Screenplay, the package's own conversations are what Kept Content plays", () => {
  it("passes when every line played is in the package", async () => {
    const { check } = await setup({ screenplay: null });
    expect(errors((await check()).problems)).toEqual([]);
  });

  it("fails a line the package's conversation no longer has", async () => {
    const { check } = await setup({ screenplay: null, files: { "Base.SC2Data/GameData/ConversationData.xml": CONVERSATIONS.replace(/  <Lines>\r\n    <Id value="Line1-3"\/>[\s\S]*?<\/Lines>\r\n/, "") } });
    expect(errors((await check()).problems)).toEqual([
      `${CUTSCENE_FILE}: The Kept cutscene "Arrival" plays Yard-01/Line1-3, but the package's conversation Yard-01 has no line Line1-3: point it at a line the conversation has, or take it out of the cutscene in the Cutscene Editor`,
    ]);
  });

  it("fails an actor's entry the driver doesn't play when its conversation is gone: the entry is what plays that line", async () => {
    const { check } = await setup({ screenplay: null, files: { "Base.SC2Data/Cutscenes/Arrival.SC2Cutscene": withStrayActorLine } });
    expect(errors((await check()).problems)).toEqual([
      `${CUTSCENE_FILE}: The Kept cutscene "Arrival" plays Yard-05/Line1-3, but the package has no conversation Yard-05: point it at a conversation the package has, or take it out of the cutscene in the Cutscene Editor`,
    ]);
  });

  it("leaves a Compiled cutscene to the Cinematic checks", async () => {
    const record: CompileRecord = { version: 1, entries: [{ kind: "file", path: "Base.SC2Data/Cutscenes/Arrival.SC2Cutscene", fingerprint: "0000000000000000" }] };
    const { check } = await setup({ screenplay: null, record, files: { "Base.SC2Data/Cutscenes/Arrival.SC2Cutscene": crlf(withStrayActorLine.split("\r\n").filter((line) => !line.includes("EndScene"))) } });
    expect((await check()).problems).toEqual([]);
  });
});

/** A Kept trigger, "Gate Talk", that plays a line and the "Arrival" cutscene, and the Compiled "After Gate Talk", which plays a line too. */
const MAP_SCRIPT = (line: string, cutscene: string): string =>
  crlf([
    `//--------------------------------------------------------------------------------------------------`,
    `// Trigger: Gate Talk`,
    `//--------------------------------------------------------------------------------------------------`,
    `bool gt_GateTalk_Func (bool testConds, bool runActions) {`,
    `    libYard_gf_SendTransmission("${line}", UnitFromId(201), true, "Talk", true);`,
    `    lv_cutscene = CutsceneCreateNone("Cutscenes\\\\${cutscene}.SC2Cutscene", PlayerGroupAll(), true);`,
    `    return true;`,
    `}`,
    `//--------------------------------------------------------------------------------------------------`,
    `// Trigger: After Gate Talk`,
    `//--------------------------------------------------------------------------------------------------`,
    `bool gt_AfterGateTalk_Func (bool testConds, bool runActions) {`,
    `    libYard_gf_SendTransmission("Yard-01|Line9-9", UnitFromId(201), true, "Talk", true);`,
    `    return true;`,
    `}`,
  ]);
const TRIGGER_STRINGS = BOM + crlf([`Trigger/Name/0000000A=Gate Talk`, `Trigger/Name/0000000B=After Gate Talk`]);
const COMPILED_AFTER: CompileRecord = { version: 1, entries: [{ kind: "trigger", id: "0000000B", fingerprint: "0000000000000000" }] };
const SCRIPT_FILE = "missions/yard/Yard.SC2Map/MapScript.galaxy";

const triggerFiles = (line: string, cutscene: string) => ({ "MapScript.galaxy": MAP_SCRIPT(line, cutscene), "enUS.SC2Data/LocalizedData/TriggerStrings.txt": TRIGGER_STRINGS });

describe("Kept triggers", () => {
  it("pass when the line and the cutscene they play are there, and a Compiled trigger is left to the compile", async () => {
    const { check } = await setup({ record: COMPILED_AFTER, files: triggerFiles("Yard-01|Line1-1", "Arrival") });
    expect(errors((await check()).problems)).toEqual([]);
  });

  it("fail a line cut from the Screenplay and a cutscene that's gone, naming the trigger", async () => {
    const { check } = await setup({ record: COMPILED_AFTER, files: triggerFiles("Yard-01|Line1-3", "Departure"), screenplay: SCREENPLAY.replace("**GUARD**: Move along.\n", "") });
    expect(errors((await check()).problems).filter((problem) => problem.startsWith(SCRIPT_FILE))).toEqual([
      `${SCRIPT_FILE}: The Kept trigger "Gate Talk" plays Yard-01/Line1-3, which the Screenplay no longer has: put the line back, or take it out of the trigger in the Trigger Editor`,
      `${SCRIPT_FILE}: The Kept trigger "Gate Talk" plays the cutscene Cutscenes\\Departure.SC2Cutscene, which neither the package nor its dependencies have: put it back, or take it out of the trigger in the Trigger Editor`,
    ]);
  });
});

const SOUND_FILE = "missions/yard/Yard.SC2Map/Base.SC2Data/GameData/SoundData.xml";
const MODEL_FILE = "missions/yard/Yard.SC2Map/Base.SC2Data/GameData/ModelData.xml";
const models = (...entries: readonly [string, string][]): string =>
  crlf([`<?xml version="1.0" encoding="utf-8"?>`, `<Catalog>`, ...entries.flatMap(([id, model]) => [`    <CModel id="${id}">`, `        <Model value="${model}"/>`, `    </CModel>`]), `</Catalog>`]);

describe("sounds and assets Kept data points to", () => {
  it("fails a played line whose sound is gone from the package's sounds", async () => {
    const { check } = await setup({ screenplay: null, files: { "Base.SC2Data/GameData/SoundData.xml": SOUNDS.replace(/    <CSound id="Yard-1-3"[\s\S]*?<\/CSound>\r\n/, "") } });
    expect(errors((await check()).problems)).toEqual([
      `${CUTSCENE_FILE}: The Kept cutscene "Arrival" plays Yard-01/Line1-3, whose sound Yard-1-3 neither the package nor its dependencies have: put the sound back, or point the line at one in the Data Editor`,
    ]);
  });

  it("fails an asset gone from a folder of the package's own, naming the entry", async () => {
    const { check } = await setup({ files: { "Assets/Sounds/Conversations/Yard-1-3.ogg": null } });
    expect(errors((await check()).problems)).toEqual([
      `${SOUND_FILE}: CSound Yard-1-3 points to Assets\\Sounds\\Conversations\\Yard-1-3.ogg, which neither the package nor its dependencies have: import it again, or point the entry at another file in the Data Editor`,
    ]);
  });

  it("takes an asset in a folder the package doesn't hold as the game's, a model's numbered variations as its files, and paths without regard to case", async () => {
    const { check } = await setup({
      files: {
        "Base.SC2Data/GameData/ModelData.xml": models(["Marine", "Assets\\Units\\Terran\\Marine\\Marine.m3"], ["Poster", "Assets\\Doodads\\Poster\\Poster.m3"], ["Lamp", "assets\\doodads\\poster\\LAMP.m3"]),
        "Assets/Doodads/Poster/Poster_00.m3": "m3",
        "Assets/Doodads/Poster/Poster_01.m3": "m3",
        "Assets/Doodads/Poster/Lamp.m3": "m3",
      },
    });
    expect((await check()).problems).toEqual([]);
  });

  it("finds an asset in a local dependency on disk, or in the one it depends on, and fails one gone from the dependency's own folder", async () => {
    const files = { "Base.SC2Data/GameData/ModelData.xml": models(["Keeper", "Assets\\Models\\Keeper\\Keeper.m3"], ["Warden", "Assets\\Models\\Warden\\Warden.m3"]) };
    const install = {
      "Mods/Yard-Campaign.SC2Mod/DocumentInfo": crlf([`<DocInfo>`, `    <Dependencies>`, `        <Value>bnet:Liberty (Mod)/0.0/999,file:Mods/Liberty.SC2Mod</Value>`,
        `        <Value>file:Mods/Yard-Assets.SC2Mod</Value>`, `    </Dependencies>`, `</DocInfo>`]),
      "Mods/Yard-Assets.SC2Mod/DocumentInfo": "<DocInfo/>", "Mods/Yard-Assets.SC2Mod/Assets/Models/Keeper/Keeper.m3": "m3", "Mods/Yard-Assets.SC2Mod/Assets/Models/Warden/Warden_Old.m3": "m3" };
    const { check } = await setup({ files, install, dependencies: ["file:Mods\\Yard-Campaign.SC2Mod"] });
    expect(errors((await check()).problems)).toEqual([
      `${MODEL_FILE}: CModel Warden points to Assets\\Models\\Warden\\Warden.m3, which neither the package nor its dependencies have: import it again, or point the entry at another file in the Data Editor`,
    ]);
  });

  it("leaves Compiled game data to the compile", async () => {
    const record: CompileRecord = { version: 1, entries: [{ kind: "file", path: "Base.SC2Data/GameData/SoundData.xml", fingerprint: "0000000000000000" }] };
    const { check } = await setup({ record, files: { "Assets/Sounds/Conversations/Yard-1-3.ogg": null } });
    expect(errors((await check()).problems)).toEqual([]);
  });
});

/**
 * "Long Take": a 1 s fade in, cuts at 0 and 14 s, the fade to black at 16 s and no End Scene
 * marker. Line1-1 starts at 0.5 s (estimated from its two words: 1.69 s); Line1-3 at 15.5 s,
 * 1.5 s long by its actor's entry, so it ends at 17 s.
 */
const LONG_TAKE = crlf([
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<CutsceneState cutsceneVersion="1.300000">`,
  `    <CCutsceneNodeDirector guid="1" name="Director">`,
  `        <CCutsceneNodeActiveCamera guid="20" name="Active Camera">`,
  `            <CCutsceneElementActiveCamera guid="21" cameraIndex="0" objectGuid="30"/>`,
  `            <CCutsceneElementActiveCamera guid="22" start="14000" cameraIndex="0" objectGuid="31"/>`,
  `        </CCutsceneNodeActiveCamera>`,
  `        <CCutsceneNodeFade guid="23" name="Fade">`,
  `            <CCutsceneElementFade guid="24" duration="1000" amount="1.000000" fadeIn="1"/>`,
  `            <CCutsceneElementFade guid="25" start="16000" duration="1000" amount="1.000000" fadeIn="0"/>`,
  `        </CCutsceneNodeFade>`,
  `        <CCutsceneNodeConversationDriver guid="8" name="Conversation Driver (Yard-01 (Unnamed))" conversationLink="Yard-01">`,
  `            <CCutsceneElementConversationDriver guid="9" start="500" lineId="Line1-1" previousOverlap="0"/>`,
  `            <CCutsceneElementConversationDriver guid="11" start="15500" lineId="Line1-3" previousOverlap="500"/>`,
  `        </CCutsceneNodeConversationDriver>`,
  `        <CCutsceneNodeActor guid="2" name="Guard">`,
  `            <CCutsceneNodeConversation guid="3" name="Conversation">`,
  `                <CCutsceneElementConversation guid="4" start="15500" duration="1500" conversationLink="Yard-01" conversationLine="Line1-3" soundLink="Yard-1-3"/>`,
  `            </CCutsceneNodeConversation>`,
  `        </CCutsceneNodeActor>`,
  `    </CCutsceneNodeDirector>`,
  `</CutsceneState>`,
]);

describe("the cinematic checks on a Kept cutscene", () => {
  it("time it from the file, and report what's past the norms as warnings on Kept Content", async () => {
    const { check } = await setup({ files: { "Base.SC2Data/Cutscenes/Arrival.SC2Cutscene": null, "Base.SC2Data/Cutscenes/Long Take.SC2Cutscene": LONG_TAKE } });
    const { problems } = await check();
    const file = "missions/yard/Yard.SC2Map/Base.SC2Data/Cutscenes/Long Take.SC2Cutscene";
    const on = `${file}: On Kept Content, the cutscene "Long Take": `;
    expect(errors(problems)).toEqual([]);
    expect(warnings(problems)).toEqual([
      `${on}F1: it has no End Scene marker, so WaitForCutsceneToEnd never returns`,
      `${on}F3: line Yard-01/Line1-3 runs to 17.0 s, past the fade to black at 16.0 s, so it's cut off`,
      `${on}Line Yard-01/Line1-1 starts at 0.5 s, under the fade in, with no shot on screen`,
      `${on}C4: shot 0 runs 14.0 s, over the 12 s a cinematic's shots keep to`,
      `${on}C4: its median shot runs 8.0 s, outside a cinematic's 3-7.3 s`,
      `${on}Shot 0 holds 11.8 s after its lines end, over the 2 s a shot is the line it plays under`,
    ]);
  });
});

describe("from review", () => {
  it("reports a line the driver and an actor's lip-sync entry both play once", async () => {
    // "Long Take"'s driver plays Line1-3, and its Guard holds the line's lip-sync entry.
    const { check } = await setup({ screenplay: SCREENPLAY.replace("**GUARD**: Move along.\n", ""), files: { "Base.SC2Data/Cutscenes/Arrival.SC2Cutscene": null, "Base.SC2Data/Cutscenes/Long Take.SC2Cutscene": LONG_TAKE } });
    expect(errors((await check()).problems)).toEqual([
      `missions/yard/Yard.SC2Map/Base.SC2Data/Cutscenes/Long Take.SC2Cutscene: The Kept cutscene "Long Take" plays Yard-01/Line1-3, which the Screenplay no longer has: put the line back, or take it out of the cutscene in the Cutscene Editor`,
    ]);
  });

  it("doesn't fail a sound or cutscene a local dependency could hold when the dependency isn't on disk, and says so", async () => {
    const files = { "Base.SC2Data/GameData/SoundData.xml": SOUNDS.replace(/    <CSound id="Yard-1-3"[\s\S]*?<\/CSound>\r\n/, ""), ...triggerFiles("Yard-01|Line1-1", "Departure") };
    const { check } = await setup({ screenplay: null, record: COMPILED_AFTER, files, dependencies: ["file:Mods\\Yard-Campaign.SC2Mod"] });
    const { problems } = await check();
    expect(errors(problems)).toEqual([]);
    expect(warnings(problems)).toEqual([
      `missions/yard/blueprint.json: The dependency file:Mods\\Yard-Campaign.SC2Mod isn't under the StarCraft II folder (${path.join(root!, "StarCraft II")}), so the sounds and cutscene files Kept Content plays aren't checked, since it could hold them: put the mod there, or fix the dependency`,
    ]);
  });

  it("finds a cutscene a Kept trigger plays without regard to case, in a subfolder too", async () => {
    const files = { ...triggerFiles("Yard-01|Line1-1", "arrival"), "MapScript.galaxy": MAP_SCRIPT("Yard-01|Line1-1", "arrival") + MAP_SCRIPT("Yard-01|Line1-1", "Intro\\\\Arrival"), "Base.SC2Data/Cutscenes/Intro/Arrival.SC2Cutscene": ARRIVAL };
    const { check } = await setup({ record: COMPILED_AFTER, files });
    expect(errors((await check()).problems)).toEqual([]);
  });

  it("knows a Compiled trigger by its Galaxy block on the record, whatever TriggerStrings calls it", async () => {
    const record: CompileRecord = { version: 1, entries: [{ kind: "galaxy-block", id: "trigger:gt_AfterGateTalk", fingerprint: "0000000000000000" }] };
    const { check } = await setup({ record, files: { "MapScript.galaxy": MAP_SCRIPT("Yard-01|Line1-1", "Arrival") } });
    expect(errors((await check()).problems)).toEqual([]);
  });

  it("takes a Kept cutscene with no camera cuts as one shot, not lines with no shot", async () => {
    const { check } = await setup({ files: { "Base.SC2Data/Cutscenes/Arrival.SC2Cutscene": crlf(ARRIVAL_LINES.filter((line) => !line.includes("ActiveCamera"))) } });
    expect(warnings((await check()).problems)).toEqual([]);
  });

  it("refuses a conversation id with '..'", async () => {
    const { check } = await setup({ conversationId: "Yard..01" });
    expect(errors((await check()).problems)).toEqual([`missions/yard/blueprint.json: a conversation id: letters, digits, _, - and ., not ending in . and with no ..`]);
  });

  it("reports a Mission folder holding two Map Packages as a problem, and checks the others", async () => {
    const { check, missionDir } = await setup();
    await mkdir(path.join(missionDir, "Copy.SC2Map"));
    const result = await check();
    expect(errors(result.problems)).toHaveLength(1);
    expect(errors(result.problems)[0]).toMatch(/^missions\/yard: /);
  });
});

describe("from review, again", () => {
  const VOID_STORY = "bnet:Void Story (Campaign)/0.0/999,file:Campaigns/VoidStory.SC2Campaign";

  it("warns, not fails, on a cutscene a Kept trigger plays that may be one of the game's mods', and fails one gone from a folder of the package's own", async () => {
    const files = {
      ...triggerFiles("Yard-01|Line1-1", "Departure"),
      "MapScript.galaxy": MAP_SCRIPT("Yard-01|Line1-1", "Departure") + MAP_SCRIPT("Yard-01|Line1-1", "Intro\\\\Gone"),
      "Base.SC2Data/Cutscenes/Intro/Arrival.SC2Cutscene": ARRIVAL,
    };
    const { check } = await setup({ record: COMPILED_AFTER, files, dependencies: [VOID_STORY] });
    const { problems } = await check();
    expect(errors(problems)).toEqual([
      `${SCRIPT_FILE}: The Kept trigger "Gate Talk" plays the cutscene Cutscenes\\Intro\\Gone.SC2Cutscene, which neither the package nor its dependencies have: put it back, or take it out of the trigger in the Trigger Editor`,
    ]);
    expect(warnings(problems)).toEqual([
      `${SCRIPT_FILE}: The Kept trigger "Gate Talk" plays the cutscene Cutscenes\\Departure.SC2Cutscene, which neither the package nor its dependencies have, so it may be one of the game's mods' (the Mission depends on some): if it isn't, put it back, or take it out of the trigger in the Trigger Editor`,
    ]);
  });

  it("takes a game mod listed without bnet: as the game's, and keeps checking sounds; says a packed mod can't be read", async () => {
    const files = { "Base.SC2Data/GameData/SoundData.xml": SOUNDS.replace(/    <CSound id="Yard-1-3"[\s\S]*?<\/CSound>\r\n/, "") };
    const unpaired = await setup({ files, dependencies: ["file:Mods/Void.SC2Mod"] });
    const found = (await unpaired.check()).problems;
    expect(warnings(found)).toEqual([]);
    expect(errors(found)).toEqual([`${CUTSCENE_FILE}: The Kept cutscene "Arrival" plays Yard-01/Line1-3, whose sound Yard-1-3 neither the package nor its dependencies have: put the sound back, or point the line at one in the Data Editor`]);

    const packed = await setup({ files, dependencies: ["file:Mods/Yard-Campaign.SC2Mod"], install: { "Mods/Yard-Campaign.SC2Mod": "MPQ\u001a" } });
    const problems = (await packed.check()).problems;
    expect(errors(problems)).toEqual([]);
    expect(warnings(problems)).toEqual([
      `missions/yard/blueprint.json: The dependency file:Mods/Yard-Campaign.SC2Mod is a packed mod (an MPQ file), which can't be read, so the sounds and cutscene files Kept Content plays aren't checked, since it could hold them: save it in the Editor as Components (an unpacked folder) to have them checked`,
    ]);
  });

  it("checks Kept cutscenes in subfolders, their suffix in any case", async () => {
    const { check } = await setup({ screenplay: SCREENPLAY.replace("**GUARD**: Move along.\n", ""), files: { "Base.SC2Data/Cutscenes/Arrival.SC2Cutscene": null, "Base.SC2Data/Cutscenes/Intro/Gate.sc2cutscene": ARRIVAL } });
    expect(errors((await check()).problems)).toEqual([
      `missions/yard/Yard.SC2Map/Base.SC2Data/Cutscenes/Intro/Gate.sc2cutscene: The Kept cutscene "Gate" plays Yard-01/Line1-3, which the Screenplay no longer has: put the line back, or take it out of the cutscene in the Cutscene Editor`,
    ]);
  });

  it("checks all Kept Galaxy, not only trigger sections, and puts what follows the last trigger to its own section", async () => {
    const before = crlf([`void gf_Greet () {`, `    libYard_gf_SendTransmission("Yard-01|Line1-3", UnitFromId(201), true, "Talk", true);`, `}`]);
    const after = crlf([
      `//--------------------------------------------------------------------------------------------------`,
      `// Trigger Initialization`,
      `//--------------------------------------------------------------------------------------------------`,
      `void InitTriggers () {`,
      `    CutsceneCreateNone("Cutscenes/Departure.SC2Cutscene", PlayerGroupAll(), true);`,
      `}`,
    ]);
    const files = { ...triggerFiles("Yard-01|Line1-1", "Arrival"), "MapScript.galaxy": before + MAP_SCRIPT("Yard-01|Line1-1", "Arrival") + after };
    const { check } = await setup({ record: COMPILED_AFTER, files, screenplay: SCREENPLAY.replace("**GUARD**: Move along.\n", "") });
    expect(errors((await check()).problems).filter((problem) => problem.startsWith(SCRIPT_FILE))).toEqual([
      `${SCRIPT_FILE}: Kept Galaxy in MapScript.galaxy plays Yard-01/Line1-3, which the Screenplay no longer has: put the line back, or take it out of the script in the Trigger Editor`,
      `${SCRIPT_FILE}: Kept Galaxy in MapScript.galaxy (its "Trigger Initialization" section) plays the cutscene Cutscenes\\Departure.SC2Cutscene, which neither the package nor its dependencies have: put it back, or take it out of the script in the Trigger Editor`,
    ]);
  });

  it("checks a known conversation's ids that don't start with Line, and whole conversations a ConversationData native runs", async () => {
    const conversations = CONVERSATIONS.replace(`  <CConversation id="Yard-01">`, `  <CConversation id="Yard-01">\r\n    <Groups Id="Group00001"/>`);
    const script = MAP_SCRIPT("Yard-01|Line1-1", "Arrival").replace(
      `    return true;`,
      `    ConversationDataRun("Yard-01", PlayerGroupAll(), c_conversationSkipSimple, false);\r\n    ConversationDataRun("Yard-05", PlayerGroupAll(), c_conversationSkipSimple, false);\r\n    ConversationDataStateSetValue("Yard-01|Group00001", 1);\r\n    TextExpressionSetToken("Param/Expression/1", "A", StringToText("Yard-01|Gate1"));\r\n    UIDisplayMessage(PlayerGroupAll(), c_messageAreaSubtitle, StringToText("Hint|Tip3"));\r\n    return true;`,
    );
    const { check } = await setup({ record: COMPILED_AFTER, screenplay: null, files: { ...triggerFiles("Yard-01|Line1-1", "Arrival"), "MapScript.galaxy": script, "Base.SC2Data/GameData/ConversationData.xml": conversations } });
    expect(errors((await check()).problems).filter((problem) => problem.startsWith(SCRIPT_FILE))).toEqual([
      `${SCRIPT_FILE}: The Kept trigger "Gate Talk" plays Yard-01/Gate1, but the package's conversation Yard-01 has no line Gate1: point it at a line the conversation has, or take it out of the trigger in the Trigger Editor`,
      `${SCRIPT_FILE}: The Kept trigger "Gate Talk" plays the conversation Yard-05, but the package has no conversation Yard-05: point it at a conversation the package has, or take it out of the trigger in the Trigger Editor`,
    ]);
  });
});

describe("what the game reads to open the package", () => {
  const CAMPAIGN = "file:Mods\\Yard-Campaign.SC2Mod";
  const install = { "Mods/Yard-Campaign.SC2Mod/DocumentInfo": "<DocInfo/>" };
  const documentInfo = (dependencies: readonly string[]): string =>
    crlf([`<?xml version="1.0" encoding="utf-8"?>`, `<DocInfo>`, `    <Dependencies>`, ...dependencies.map((dependency) => `        <Value>${dependency}</Value>`), `    </Dependencies>`, `</DocInfo>`]);
  const header = (dependencies: readonly string[]): Buffer => writeDocumentHeader({ dependencies, documentId: 0x3131db95, attributes: { "DocInfo/Name": "Yard" } });
  const HEADER_FILE = "missions/yard/Yard.SC2Map/DocumentHeader";
  const lists = (headerList: string, infoList: string) => `DocumentHeader lists ${headerList}; DocumentInfo lists ${infoList}`;
  const FIX = "resave it in the Editor, which rewrites the header's list from DocumentInfo, or make the header's list match (the count at byte 0x2C, then each dependency as a C string)";
  const mapInfo = (hideErrorsDuringTest: boolean): Buffer =>
    writeMapInfo({ width: 128, height: 128, tilesetId: "KorhalCityEx2", fogType: "Black", playableBounds: [8, 8, 120, 120], players: [{ id: 1, controller: "User" }], hideErrorsDuringTest });

  it("passes a header that lists DocumentInfo's dependencies, and a MapInfo whose hash its fields give", async () => {
    const { check } = await setup({ dependencies: [CAMPAIGN], install, files: { DocumentInfo: documentInfo([CAMPAIGN]), DocumentHeader: header([CAMPAIGN]), MapInfo: mapInfo(true) } });
    expect((await check()).problems).toEqual([]);
  });

  // An imported map whose header kept the mod of the map it came from, which no longer exists.
  it("fails a header dependency DocumentInfo doesn't list and that isn't on disk, giving both lists", async () => {
    const stale = "file:Mods\\Yard-Original.SC2Mod";
    const { check } = await setup({ dependencies: [CAMPAIGN], install, files: { DocumentInfo: documentInfo([CAMPAIGN]), DocumentHeader: header([stale]) } });
    const { problems } = await check();
    expect(errors(problems)).toEqual([
      `${HEADER_FILE}: DocumentHeader depends on ${stale}, which DocumentInfo doesn't list and isn't under the StarCraft II folder (${path.join(root!, "StarCraft II")}), so the game won't launch it ("dependencies which are no longer available"). ${lists(stale, CAMPAIGN)}: ${FIX}`,
    ]);
    expect(warnings(problems)).toEqual([]);
  });

  it("warns, not fails, on lists that differ when every header dependency is there", async () => {
    const assets = "file:Mods\\Yard-Assets.SC2Mod";
    const { check } = await setup({ dependencies: [CAMPAIGN], install: { ...install, "Mods/Yard-Assets.SC2Mod/DocumentInfo": "<DocInfo/>" }, files: { DocumentInfo: documentInfo([CAMPAIGN]), DocumentHeader: header([assets, CAMPAIGN]) } });
    const { problems } = await check();
    expect(errors(problems)).toEqual([]);
    expect(warnings(problems)).toEqual([`${HEADER_FILE}: DocumentHeader's dependencies aren't DocumentInfo's, and the game resolves them from the header. ${lists(`${assets}, ${CAMPAIGN}`, CAMPAIGN)}: ${FIX}`]);
  });

  it("fails a header that isn't one", async () => {
    const { check } = await setup({ files: { DocumentInfo: documentInfo([]), DocumentHeader: "not a header" } });
    expect(errors((await check()).problems)).toEqual([`${HEADER_FILE}: DocumentHeader: not a H2CS header, so the game can't read the package's dependencies: resave it in the Editor`]);
  });

  // Hide Errors During Test Document (0x20) set by hand, the hash left as it was.
  it("fails a MapInfo whose stored hash its fields don't give, naming the hash to write", async () => {
    const stale = mapInfo(true);
    mapInfo(false).copy(stale, 8, 8, 16);
    const { check } = await setup({ files: { MapInfo: stale } });
    const expected = `0x${mapInfo(true).readUInt32LE(8).toString(16).toUpperCase()}`;
    const storedHash = `0x${stale.readUInt32LE(8).toString(16).toUpperCase()}`;
    expect(errors((await check()).problems)).toEqual([
      `missions/yard/Yard.SC2Map/MapInfo: MapInfo's integrity hash is ${storedHash}, but its fields give ${expected}, so the game won't open the map ("failed to open map"; the Editor logs "Unable to load 'MapInfo'"). A hand edit to its size, description, camera bounds or game options flags changes the hash: write ${expected} as the u64 at byte 8, or undo the edit`,
    ]);
  });

  it("reads only as far as the game options flags, so a later block it doesn't expect can't fail a good hash", async () => {
    const good = mapInfo(true);
    const cut = good.subarray(0, good.length - 40);
    const { check } = await setup({ files: { MapInfo: cut } });
    expect((await check()).problems).toEqual([]);
  });

  it("says a MapInfo whose strings run past the end can't be read, rather than naming a hash from the wrong bytes", async () => {
    const good = mapInfo(true);
    const cut = good.subarray(0, good.indexOf("KorhalCityEx2") + 4);
    const { check } = await setup({ files: { MapInfo: cut } });
    expect(errors((await check()).problems)).toEqual([
      expect.stringMatching(/^missions\/yard\/Yard\.SC2Map\/MapInfo: MapInfo can't be read \(MapInfo: its string at byte \d+ has no end\), so the game can't open the map: resave the map in the Editor$/),
    ]);
  });

  it("checks the hash when reading the header throws", async () => {
    const stale = mapInfo(true);
    mapInfo(false).copy(stale, 8, 8, 16);
    // A folder where DocumentInfo should be: reading it throws.
    const { check } = await setup({ files: { "DocumentInfo/stray": "x", DocumentHeader: header([]), MapInfo: stale } });
    expect(errors((await check()).problems).map((problem) => problem.split(": ")[0])).toEqual(["missions/yard/Yard.SC2Map", "missions/yard/Yard.SC2Map/MapInfo"]);
  });

  it("leaves a MapInfo of a version the hash isn't confirmed on", async () => {
    const other = mapInfo(true);
    other.writeUInt32LE(40, 4);
    other.writeUInt32LE(0, 8);
    const { check } = await setup({ files: { MapInfo: other } });
    expect((await check()).problems).toEqual([]);
  });
});
