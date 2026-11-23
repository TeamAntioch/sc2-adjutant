// Surveying a Mission's Kept Content (ADR-0010): what its Map Package holds, read from the package
// each time and never stored, with Compiled Content marked from the compile record. The package
// is synthetic, in the Editor's own form: CRLF lines, four-space indents, byte-order marks.
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { type CompileRecord, writeCompileRecord } from "../../src/domain/compile-record.js";
import { formatSurvey, surveyMission } from "../../src/map/survey.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { connect, text } from "../mcp/harness.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const crlf = (lines: readonly string[]): string => `${lines.join("\r\n")}\r\n`;
const BOM = "\uFEFF";

const OBJECTS = crlf([
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<PlacedObjects Version="27">`,
  `    <ObjectDoodad Id="101" Position="10,12,8" Rotation="0.7854" Scale="1,1,1" Type="StreetLamp"/>`,
  `    <ObjectDoodad Id="102" Position="20,20,8" Scale="1,1,1" Type="CargoCrate"/>`,
  `    <ObjectDoodad Id="103" Position="70,70,8" Scale="1,1,1" Type="CargoCrate"/>`,
  `    <ObjectDoodad Id="104" Position="22,24,8" Scale="1,1,1" Type="StreetLamp" Name="Gate Lamp"/>`,
  `    <ObjectDoodad Id="105" Position="80,80,8" Scale="1,1,1" Type="Barrel"/>`,
  `    <ObjectUnit Id="201" Position="40,40,0" Rotation="1.5708" Scale="1,1,1" UnitType="Marine" Player="2"/>`,
  `    <ObjectUnit Id="202" Position="15.5,18,0" Scale="1,1,1" UnitType="Civilian"/>`,
  `    <ObjectPoint Id="301" Position="50,50,0" Scale="1,1,1" Type="Normal" Name="Guard Post" Color="0,0,0,0"/>`,
  `    <ObjectCamera Id="401" Position="60,60,0" Rotation="3.1416" Scale="1,1,1" Name="Opening" Color="0,0,0,0" CameraTarget="60,60">`,
  `        <CameraValue Index="Distance" Value="34"/>`,
  `    </ObjectCamera>`,
  `</PlacedObjects>`,
]);

const REGIONS = crlf([
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<Regions>`,
  `    <region id="1">`,
  `        <name value="Yard &amp; Gate"/>`,
  `        <shape type="rect">`,
  `            <quad value="10,10,30,30"/>`,
  `        </shape>`,
  `    </region>`,
  `    <region id="2">`,
  `        <name value="Pond"/>`,
  `        <shape type="circle">`,
  `            <center value="75,75"/>`,
  `            <radius value="5"/>`,
  `        </shape>`,
  `        <shape type="diamond">`,
  `            <center value="70,70"/>`,
  `            <width value="4"/>`,
  `            <height value="2"/>`,
  `            <negative/>`,
  `        </shape>`,
  `    </region>`,
  `</Regions>`,
]);

/**
 * Root: "Mission Start" and the category "Stealth", which holds a function, a struct, a global,
 * a preset, "Alarm" (disabled, so the Editor writes no Galaxy for it) and the category
 * "Checkpoints". That holds "Checkpoint 1" (its events in MapScript.galaxy, and one disabled, which
 * the Editor leaves out), "Checkpoint 2" (initially off, its event not yet saved by the Editor) and the
 * Compiled "After Checkpoint 1". "Alarm" has a local, which isn't a global.
 */
const TRIGGERS = crlf([
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<TriggerData>`,
  `    <Root>`,
  `        <Item Type="Trigger" Id="0000000A"/>`,
  `        <Item Type="Category" Id="000000C1"/>`,
  `    </Root>`,
  `    <Element Type="Trigger" Id="0000000A">`,
  `        <Event Type="FunctionCall" Id="00000E01"/>`,
  `    </Element>`,
  `    <Element Type="FunctionCall" Id="00000E01">`,
  `        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000120"/>`,
  `    </Element>`,
  `    <Element Type="Category" Id="000000C1">`,
  `        <Item Type="FunctionDef" Id="000000F1"/>`,
  `        <Item Type="Structure" Id="0000005A"/>`,
  `        <Item Type="Preset" Id="000000B1"/>`,
  `        <Item Type="Variable" Id="000000A1"/>`,
  `        <Item Type="Trigger" Id="0000000B"/>`,
  `        <Item Type="Category" Id="000000C2"/>`,
  `    </Element>`,
  `    <Element Type="FunctionDef" Id="000000F1">`,
  `        <FlagAction/>`,
  `    </Element>`,
  `    <Element Type="Structure" Id="0000005A">`,
  `        <Variable Type="Variable" Id="000000A3"/>`,
  `    </Element>`,
  `    <Element Type="Variable" Id="000000A3">`,
  `        <VariableType>`,
  `            <Type Value="int"/>`,
  `        </VariableType>`,
  `    </Element>`,
  `    <Element Type="Variable" Id="000000A1">`,
  `        <VariableType>`,
  `            <Type Value="int"/>`,
  `        </VariableType>`,
  `    </Element>`,
  `    <Element Type="Trigger" Id="0000000B">`,
  `        <Disabled/>`,
  `        <Event Type="FunctionCall" Id="00000E05"/>`,
  `        <Variable Type="Variable" Id="000000A2"/>`,
  `    </Element>`,
  `    <Element Type="Variable" Id="000000A2">`,
  `        <VariableType>`,
  `            <Type Value="int"/>`,
  `        </VariableType>`,
  `    </Element>`,
  `    <Element Type="Category" Id="000000C2">`,
  `        <Item Type="Trigger" Id="0000000C"/>`,
  `        <Item Type="Trigger" Id="0000000D"/>`,
  `        <Item Type="Trigger" Id="0000000E"/>`,
  `    </Element>`,
  `    <Element Type="Trigger" Id="0000000C">`,
  `        <Event Type="FunctionCall" Id="00000E02"/>`,
  `        <Event Type="FunctionCall" Id="00000E06"/>`,
  `    </Element>`,
  `    <Element Type="FunctionCall" Id="00000E06">`,
  `        <Disabled/>`,
  `        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000120"/>`,
  `    </Element>`,
  `    <Element Type="Trigger" Id="0000000D">`,
  `        <InitOff/>`,
  `        <Event Type="FunctionCall" Id="00000E03"/>`,
  `    </Element>`,
  `    <Element Type="Trigger" Id="0000000E">`,
  `        <Event Type="FunctionCall" Id="00000E04"/>`,
  `    </Element>`,
  `</TriggerData>`,
]);

// The Editor sometimes starts the file with two byte-order marks.
const TRIGGER_STRINGS = BOM + BOM + crlf([
  `Category/Name/000000C1=Stealth`,
  `Category/Name/000000C2=Checkpoints`,
  `FunctionDef/Name/000000F1=Reset Guards`,
  `Structure/Name/0000005A=Guard State`,
  `Preset/Name/000000B1=Alert State`,
  `Trigger/Name/0000000A=Mission Start`,
  `Trigger/Name/0000000B=Alarm`,
  `Trigger/Name/0000000C=Checkpoint 1`,
  `Trigger/Name/0000000D=Checkpoint 2`,
  `Trigger/Name/0000000E=After Checkpoint 1`,
  `Variable/Name/000000A1=Alarm Level`,
  `Variable/Name/000000A2=Count`,
  `Variable/Name/000000A3=Level`,
]);

const MAP_SCRIPT = crlf([
  `void gt_MissionStart_Init () {`,
  `    gt_MissionStart = TriggerCreate("gt_MissionStart_Func");`,
  `    TriggerAddEventMapInit(gt_MissionStart);`,
  `}`,
  `void gt_Checkpoint1_Init () {`,
  `    gt_Checkpoint1 = TriggerCreate("gt_Checkpoint1_Func");`,
  `    TriggerAddEventUnitRegion(gt_Checkpoint1, null, RegionFromId(1), true);`,
  `    TriggerAddEventUnitRangePoint(gt_Checkpoint1, null, PointFromId(301), 1.0, true);`,
  `}`,
  `void gt_AfterCheckpoint1_Init () {`,
  `    gt_AfterCheckpoint1 = TriggerCreate("gt_AfterCheckpoint1_Func");`,
  `    TriggerAddEventMapInit(gt_AfterCheckpoint1);`,
  `}`,
]);

/**
 * "Arrival"'s Conversation Driver plays three lines of Harbour-01, the first with no start. Its
 * actors hold one of them and a stale line of a conversation the package lacks, which the driver
 * doesn't play. "Departure" has no driver, only an actor's line.
 */
const ARRIVAL = crlf([
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<CutsceneState cutsceneVersion="1.300000">`,
  `    <CCutsceneNodeDirector guid="1" name="Director">`,
  `        <CCutsceneNodeConversationDriver guid="8" name="Conversation Driver (Harbour-01 (Unnamed))" conversationLink="Harbour-01">`,
  `            <CCutsceneElementConversationDriver guid="9" lineId="Line00001" previousOverlap="0"/>`,
  `            <CCutsceneElementConversationDriver guid="10" start="2000" lineId="Line00003" previousOverlap="500"/>`,
  `            <CCutsceneElementConversationDriver guid="11" start="5200" lineId="Line00002" previousOverlap="500"/>`,
  `        </CCutsceneNodeConversationDriver>`,
  `        <CCutsceneNodeActor guid="2" name="Dockhand">`,
  `            <CCutsceneNodeConversation guid="3" name="Conversation">`,
  `                <CCutsceneElementConversation guid="4" start="5200" duration="900" conversationLink="Harbour-01" conversationLine="Line00002" soundLink="Harbour-01-002"/>`,
  `                <CCutsceneElementConversation guid="7" start="9000" duration="500" conversationLink="Elsewhere-01" conversationLine="Line00009"/>`,
  `            </CCutsceneNodeConversation>`,
  `        </CCutsceneNodeActor>`,
  `    </CCutsceneNodeDirector>`,
  `</CutsceneState>`,
]);
const DEPARTURE = crlf([
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<CutsceneState cutsceneVersion="1.300000">`,
  `    <CCutsceneNodeDirector guid="1" name="Director">`,
  `        <CCutsceneNodeConversation guid="3" name="Conversation">`,
  `            <CCutsceneElementConversation guid="4" start="1000" duration="900" conversationLink="Harbour-01" conversationLine="Line00003"/>`,
  `        </CCutsceneNodeConversation>`,
  `    </CCutsceneNodeDirector>`,
  `</CutsceneState>`,
]);

const conversationLine = (id: string, speaker: string): string[] => [
  `  <Lines>`,
  `    <Id value="${id}"/>`,
  `    <Text value="Conversation/Harbour-01/${id}"/>`,
  `    <SpeakerCharacter value="${speaker}"/>`,
  `  </Lines>`,
];
const CONVERSATIONS = crlf([
  `<?xml version="1.0" encoding="us-ascii"?>`,
  `<Catalog>`,
  `  <CConversation id="Harbour-01">`,
  `    <Groups Id="Group00001" Name="Conversation/Harbour-01/Group00001"/>`,
  ...conversationLine("Line00001", "CharGuard"),
  ...conversationLine("Line00002", "CharDockhand"),
  ...conversationLine("Line00003", "CharGuard"),
  `  </CConversation>`,
  `</Catalog>`,
]);
const CONVERSATION_STRINGS = BOM + crlf([
  `Conversation/Harbour-01/Group00001=AT THE DOCKS`,
  `Conversation/Harbour-01/Line00001=Halt. Papers.`,
  `Conversation/Harbour-01/Line00002=He's with me.`,
  `Conversation/Harbour-01/Line00003=Move along.`,
]);
const UNITS = crlf([
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<Catalog>`,
  `    <CUnit id="Guard" parent="Marine">`,
  `        <LifeMax value="60"/>`,
  `    </CUnit>`,
  `    <CUnit id="Dockhand" parent="Civilian"/>`,
  `</Catalog>`,
]);
const ACTORS = crlf([`<?xml version="1.0" encoding="utf-8"?>`, `<Catalog>`, `    <CActorUnit id="Guard" parent="GenericUnitStandard" unitName="Guard"/>`, `</Catalog>`]);

/** Objects 101 (a doodad) and 202 (a unit), region 2, "After Checkpoint 1", the "Departure" cutscene, the Dockhand unit and ActorData.xml are Compiled; everything else is Kept. */
const RECORD: CompileRecord = {
  version: 1,
  entries: [
    { kind: "object", id: 101, fingerprint: "0000000000000000" },
    { kind: "object", id: 202, fingerprint: "0000000000000000" },
    { kind: "region", id: 2, fingerprint: "0000000000000000" },
    { kind: "trigger", id: "0000000E", fingerprint: "0000000000000000" },
    { kind: "file", path: "Base.SC2Data/Cutscenes/Departure.SC2Cutscene", fingerprint: "0000000000000000" },
    { kind: "catalog-entry", file: "Base.SC2Data/GameData/UnitData.xml", id: "Dockhand", fingerprint: "0000000000000000" },
    { kind: "file", path: "Base.SC2Data/GameData/ActorData.xml", fingerprint: "0000000000000000" },
  ],
};

const PACKAGE: Readonly<Record<string, string>> = {
  Objects: OBJECTS,
  Regions: REGIONS,
  Triggers: TRIGGERS,
  "MapScript.galaxy": MAP_SCRIPT,
  "enUS.SC2Data/LocalizedData/TriggerStrings.txt": TRIGGER_STRINGS,
  "Base.SC2Data/Cutscenes/Arrival.SC2Cutscene": ARRIVAL,
  "Base.SC2Data/Cutscenes/Departure.SC2Cutscene": DEPARTURE,
  "Base.SC2Data/GameData/ConversationData.xml": CONVERSATIONS,
  "Base.SC2Data/GameData/UnitData.xml": UNITS,
  "Base.SC2Data/GameData/ActorData.xml": ACTORS,
  "enUS.SC2Data/LocalizedData/ConversationStrings.txt": CONVERSATION_STRINGS,
};

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** A Workspace with the Mission `yard`: a Blueprint with no Zones, and its package as `files` give it. */
async function setup(files: Readonly<Record<string, string>> = {}, record: CompileRecord = RECORD) {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-survey-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
  const missionDir = path.join(workspaceRoot, "missions", "yard");
  const mapPackage = path.join(missionDir, "Yard.SC2Map");
  for (const [file, content] of Object.entries({ ...PACKAGE, ...files })) {
    await mkdir(path.dirname(path.join(mapPackage, file)), { recursive: true });
    await writeFile(path.join(mapPackage, file), content);
  }
  const blueprintPath = path.join(missionDir, "blueprint.json");
  const blueprint = { id: "yard", campaignId: "fixtures", title: "Yard", setting: "Imported", mapSize: { width: 128, height: 128 }, tilesetId: "MonlythEx1", screenplay: { title: "Yard" } };
  await writeFile(blueprintPath, JSON.stringify(blueprint, null, 2));
  await writeFile(path.join(missionDir, "compile-record.json"), writeCompileRecord(record));
  return { workspace: await loadWorkspace(workspaceRoot), blueprintPath, mapPackage };
}

describe("surveyMission", () => {
  it("lists units, points and cameras by kind, with Editor Id, type, player and position, marking Compiled ones", async () => {
    const { blueprintPath } = await setup();
    const survey = await surveyMission(blueprintPath);

    expect(survey.units).toEqual([
      { id: 201, type: "Marine", player: 2, position: { x: 40, y: 40, z: 0 }, compiled: false },
      { id: 202, type: "Civilian", player: 0, position: { x: 15.5, y: 18, z: 0 }, compiled: true },
    ]);
    expect(survey.points).toEqual([{ id: 301, name: "Guard Post", type: "Normal", position: { x: 50, y: 50, z: 0 }, compiled: false }]);
    expect(survey.cameras).toEqual([{ id: 401, name: "Opening", position: { x: 60, y: 60, z: 0 }, compiled: false }]);
  });

  it("counts unnamed doodads by type, Compiled ones apart, and lists named ones", async () => {
    const { blueprintPath } = await setup();
    const survey = await surveyMission(blueprintPath);

    expect(survey.doodads).toEqual({
      count: 5,
      byType: [
        { type: "CargoCrate", count: 2, compiled: 0 },
        { type: "StreetLamp", count: 1, compiled: 1 },
        { type: "Barrel", count: 1, compiled: 0 },
      ],
      named: [{ id: 104, type: "StreetLamp", name: "Gate Lamp", position: { x: 22, y: 24, z: 8 }, compiled: false }],
    });
  });

  it("lists regions with their shapes", async () => {
    const { blueprintPath } = await setup();
    const survey = await surveyMission(blueprintPath);

    expect(survey.regions).toEqual([
      { id: 1, name: "Yard & Gate", shapes: [{ type: "rect", quad: [10, 10, 30, 30] }], compiled: false },
      {
        id: 2,
        name: "Pond",
        shapes: [
          { type: "circle", center: { x: 75, y: 75 }, radius: 5 },
          { type: "diamond", center: { x: 70, y: 70 }, width: 4, height: 2, negative: true },
        ],
        compiled: true,
      },
    ]);
  });

  it("lists triggers by category, with their events, and the functions, structs and globals beside them", async () => {
    const { blueprintPath } = await setup();
    const survey = await surveyMission(blueprintPath);

    expect(survey.triggers).toEqual([
      { path: [], triggers: [{ id: "0000000A", name: "Mission Start", events: ["MapInit()"], compiled: false }], functions: [], structs: [], presets: [], variables: [], others: [] },
      {
        path: ["Stealth"],
        triggers: [{ id: "0000000B", name: "Alarm", events: [], disabled: true, compiled: false }],
        functions: [{ id: "000000F1", name: "Reset Guards" }],
        structs: [{ id: "0000005A", name: "Guard State" }],
        presets: [{ id: "000000B1", name: "Alert State" }],
        variables: [{ id: "000000A1", name: "Alarm Level", compiled: false }],
        others: [],
      },
      {
        path: ["Stealth", "Checkpoints"],
        triggers: [
          { id: "0000000C", name: "Checkpoint 1", events: ['UnitRegion(null, RegionFromId(1), true) (region 1 "Yard & Gate")', 'UnitRangePoint(null, PointFromId(301), 1.0, true) (point 301 "Guard Post")'], compiled: false },
          { id: "0000000D", name: "Checkpoint 2", events: [], unsavedEvents: 1, initiallyOff: true, compiled: false },
          { id: "0000000E", name: "After Checkpoint 1", events: ["MapInit()"], compiled: true },
        ],
        functions: [],
        structs: [],
        presets: [],
        variables: [],
        others: [],
      },
    ]);
  });

  it("lists cutscenes with the lines each plays: its Conversation Driver's, or with no driver its actors'", async () => {
    const { blueprintPath } = await setup();
    const survey = await surveyMission(blueprintPath);

    expect(survey.cutscenes).toEqual([
      {
        name: "Arrival",
        lines: [
          { conversation: "Harbour-01", line: "Line00001", start: 0, speaker: "CharGuard", text: "Halt. Papers." },
          { conversation: "Harbour-01", line: "Line00003", start: 2000, speaker: "CharGuard", text: "Move along." },
          { conversation: "Harbour-01", line: "Line00002", start: 5200, speaker: "CharDockhand", text: "He's with me." },
        ],
        notOnDriver: [{ conversation: "Elsewhere-01", line: "Line00009", start: 9000, missing: true }],
        compiled: false,
      },
      { name: "Departure", lines: [{ conversation: "Harbour-01", line: "Line00003", start: 1000, speaker: "CharGuard", text: "Move along." }], compiled: true },
    ]);
  });

  it("lists conversations with their line count, and catalog entries by file", async () => {
    const { blueprintPath } = await setup();
    const survey = await surveyMission(blueprintPath);

    expect(survey.conversations).toEqual([{ id: "Harbour-01", lines: 3, compiled: false }]);
    expect(survey.catalog).toEqual([
      { file: "ActorData.xml", entries: [{ type: "CActorUnit", id: "Guard", compiled: true }] },
      { file: "ConversationData.xml", entries: [{ type: "CConversation", id: "Harbour-01", compiled: false }] },
      {
        file: "UnitData.xml",
        entries: [
          { type: "CUnit", id: "Guard", compiled: false },
          { type: "CUnit", id: "Dockhand", compiled: true },
        ],
      },
    ]);
  });

  it("narrows to the kinds asked for", async () => {
    const { blueprintPath } = await setup();
    const survey = await surveyMission(blueprintPath, { kinds: ["point", "conversation"] });

    expect(survey).toEqual({
      mapPackage: expect.any(String),
      points: [{ id: 301, name: "Guard Post", type: "Normal", position: { x: 50, y: 50, z: 0 }, compiled: false }],
      conversations: [{ id: "Harbour-01", lines: 3, compiled: false }],
    });
  });

  it("narrows to an area, given by corners or a region, listing and counting each doodad in it", async () => {
    const { blueprintPath } = await setup();
    const byCorners = await surveyMission(blueprintPath, { area: { x0: 10, y0: 10, x1: 30, y1: 30 } });
    const byRegion = await surveyMission(blueprintPath, { area: "Yard & Gate" });

    const inYard = {
      mapPackage: expect.any(String),
      area: { x0: 10, y0: 10, x1: 30, y1: 30 },
      units: [{ id: 202, type: "Civilian", player: 0, position: { x: 15.5, y: 18, z: 0 }, compiled: true }],
      points: [],
      cameras: [],
      doodads: {
        count: 3,
        byType: [
          { type: "StreetLamp", count: 2, compiled: 1 },
          { type: "CargoCrate", count: 1, compiled: 0 },
        ],
        named: [{ id: 104, type: "StreetLamp", name: "Gate Lamp", position: { x: 22, y: 24, z: 8 }, compiled: false }],
        listed: [
          { id: 101, type: "StreetLamp", position: { x: 10, y: 12, z: 8 }, compiled: true },
          { id: 102, type: "CargoCrate", position: { x: 20, y: 20, z: 8 }, compiled: false },
          { id: 104, type: "StreetLamp", name: "Gate Lamp", position: { x: 22, y: 24, z: 8 }, compiled: false },
        ],
      },
      regions: [{ id: 1, name: "Yard & Gate", shapes: [{ type: "rect", quad: [10, 10, 30, 30] }], compiled: false }],
    };
    expect(byCorners).toEqual(inYard);
    expect(byRegion).toEqual(inYard);
    expect(await surveyMission(blueprintPath, { area: "1" })).toEqual(inYard);
  });

  it("lists the kinds without a place whole beside an area only when asked for them", async () => {
    const { blueprintPath } = await setup();
    const survey = await surveyMission(blueprintPath, { area: "Pond", kinds: ["region", "cutscene"] });

    expect(survey.regions?.map((region) => region.id)).toEqual([2]);
    expect(survey.cutscenes?.map((cutscene) => cutscene.name)).toEqual(["Arrival", "Departure"]);
    expect(survey.triggers).toBeUndefined();
  });

  it("refuses an area it can't find, or an unknown kind", async () => {
    const { blueprintPath } = await setup();
    await expect(surveyMission(blueprintPath, { area: "Lighthouse" })).rejects.toThrow('Yard.SC2Map has no region "Lighthouse": give a region\'s name or id, or an area as x0,y0,x1,y1');
    await expect(surveyMission(blueprintPath, { area: "1..5,0,10,10" })).rejects.toThrow('Yard.SC2Map has no region "1..5,0,10,10"');
    await expect(surveyMission(blueprintPath, { area: "" })).rejects.toThrow("an area can't be empty");
    await expect(surveyMission(blueprintPath, { area: "  " })).rejects.toThrow("an area can't be empty");
    await expect(surveyMission(blueprintPath, { kinds: ["unit", "lamp" as never] })).rejects.toThrow("lamp isn't a kind the survey lists: unit, point, camera, doodad, region, trigger, cutscene, conversation, catalog");
  });
});

describe("formatSurvey", () => {
  it("writes the survey as lines, with Compiled Content marked", async () => {
    const { blueprintPath } = await setup();

    expect(formatSurvey(await surveyMission(blueprintPath))).toEqual([
      "Kept Content of Yard.SC2Map ([Compiled] is on the compile record; everything else is Kept)",
      "Units (2)",
      "  201 Marine, player 2, at (40, 40)",
      "  202 Civilian, player 0, at (15.5, 18) [Compiled]",
      "Points (1)",
      '  301 "Guard Post" (Normal) at (50, 50)',
      "Cameras (1)",
      '  401 "Opening" at (60, 60)',
      "Doodads (5): 2 CargoCrate, 1 StreetLamp (1 Compiled), 1 Barrel; named:",
      '  104 "Gate Lamp" StreetLamp at (22, 24, 8)',
      "Regions (2)",
      '  1 "Yard & Gate": rect (10, 10)-(30, 30)',
      '  2 "Pond": circle (75, 75) radius 5, minus diamond (70, 70) 4x2 [Compiled]',
      "Triggers (5 triggers, 1 function, 1 struct, 1 preset, 1 variable)",
      "  Root",
      "    Mission Start (0000000A): MapInit()",
      "  Stealth",
      "    function Reset Guards (000000F1)",
      "    struct Guard State (0000005A)",
      "    preset Alert State (000000B1)",
      "    variable Alarm Level (000000A1)",
      "    Alarm (0000000B), disabled: no events",
      "  Stealth > Checkpoints",
      '    Checkpoint 1 (0000000C): UnitRegion(null, RegionFromId(1), true) (region 1 "Yard & Gate"); UnitRangePoint(null, PointFromId(301), 1.0, true) (point 301 "Guard Post")',
      "    Checkpoint 2 (0000000D), initially off: 1 event not in MapScript.galaxy yet (save the map in the Editor)",
      "    After Checkpoint 1 (0000000E): MapInit() [Compiled]",
      "Cutscenes (2)",
      "  Arrival: 3 lines",
      "    0.0s Harbour-01/Line00001 CharGuard: Halt. Papers.",
      "    2.0s Harbour-01/Line00003 CharGuard: Move along.",
      "    5.2s Harbour-01/Line00002 CharDockhand: He's with me.",
      "    on an actor, not the Conversation Driver: Elsewhere-01/Line00009 (not in this package)",
      "  Departure: 1 line [Compiled]",
      "    1.0s Harbour-01/Line00003 CharGuard: Move along.",
      "Conversations (1)",
      "  Harbour-01: 3 lines",
      "Catalog entries (4)",
      "  ActorData.xml: CActorUnit Guard [Compiled]",
      "  ConversationData.xml: CConversation Harbour-01",
      "  UnitData.xml: CUnit Guard, Dockhand [Compiled]",
    ]);
  });

  it("lists each doodad in an area, and says when a kind has nothing there", async () => {
    const { blueprintPath } = await setup();

    expect(formatSurvey(await surveyMission(blueprintPath, { area: "Pond", kinds: ["camera", "doodad"] }))).toEqual([
      "Kept Content of Yard.SC2Map in (70, 70)-(80, 80) ([Compiled] is on the compile record; everything else is Kept)",
      "Cameras: none",
      "Doodads (2): 1 CargoCrate, 1 Barrel",
      "  103 CargoCrate at (70, 70, 8)",
      "  105 Barrel at (80, 80, 8)",
    ]);
  });
});

describe("the survey MCP tool", () => {
  it("lists the Mission's Kept Content, narrowed by kinds and an area", async () => {
    const { workspace } = await setup();
    const reply = await (await connect(workspace.root)).callTool({ name: "survey", arguments: { mission: "yard", kinds: ["unit", "region"], area: "10,10,30,30" } });

    expect(reply.isError).toBeFalsy();
    expect(text(reply).split("\n")).toEqual([
      "Kept Content of Yard.SC2Map in (10, 10)-(30, 30) ([Compiled] is on the compile record; everything else is Kept)",
      "Units (1)",
      "  202 Civilian, player 0, at (15.5, 18) [Compiled]",
      "Regions (1)",
      '  1 "Yard & Gate": rect (10, 10)-(30, 30)',
    ]);
  });

  it("replies with the refusal for an area it can't find", async () => {
    const { workspace } = await setup();
    const reply = await (await connect(workspace.root)).callTool({ name: "survey", arguments: { mission: "yard", area: "Lighthouse" } });

    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain('Yard.SC2Map has no region "Lighthouse"');
  });
});

describe("formatSurvey on a sparse package", () => {
  it("says a region of only negative shapes gives no area, and lists globals beside no triggers", async () => {
    const hole = REGIONS.replace(`</Regions>`, `    <region id="3">\r\n        <name value="Hole"/>\r\n        <shape type="circle">\r\n            <center value="5,5"/>\r\n            <radius value="1"/>\r\n            <negative/>\r\n        </shape>\r\n    </region>\r\n</Regions>`);
    const globals = crlf([`<?xml version="1.0" encoding="utf-8"?>`, `<TriggerData>`, `    <Root>`, `        <Item Type="Variable" Id="000000A1"/>`, `    </Root>`, `</TriggerData>`]);
    const { blueprintPath } = await setup({ Regions: hole, Triggers: globals });

    await expect(surveyMission(blueprintPath, { area: "Hole" })).rejects.toThrow('region 3 "Hole" has only negative shapes, so it gives no area');
    expect(formatSurvey(await surveyMission(blueprintPath, { kinds: ["trigger"] }))).toEqual([
      "Kept Content of Yard.SC2Map ([Compiled] is on the compile record; everything else is Kept)",
      "Triggers (1 variable)",
      "  Root",
      "    variable Alarm Level (000000A1)",
    ]);
  });
});

describe("the survey on what the Editor leaves unnamed or escaped", () => {
  it("lists a Custom Script and other items it doesn't look into, and counts them in the heading", async () => {
    const triggers = crlf([
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<TriggerData>`,
      `    <Root>`,
      `        <Item Type="CustomScript" Id="E7700001"/>`,
      `    </Root>`,
      `    <Element Type="CustomScript" Id="E7700001">`,
      `        <ScriptCode>void Hand_Init () {}</ScriptCode>`,
      `        <InitFunc>Hand_Init</InitFunc>`,
      `    </Element>`,
      `</TriggerData>`,
    ]);
    const { blueprintPath } = await setup({ Triggers: triggers, "enUS.SC2Data/LocalizedData/TriggerStrings.txt": BOM + crlf([`CustomScript/Name/E7700001=Hand Galaxy`]) });
    const survey = await surveyMission(blueprintPath, { kinds: ["trigger"] });

    expect(survey.triggers).toEqual([{ path: [], triggers: [], functions: [], structs: [], presets: [], variables: [], others: [{ type: "CustomScript", id: "E7700001", name: "Hand Galaxy" }] }]);
    expect(formatSurvey(survey).slice(1)).toEqual(["Triggers (1 custom script)", "  Root", "    custom script Hand Galaxy (E7700001)"]);
  });

  it("reports no unsaved events for a trigger with no name or Identifier, whose Galaxy name it can't know", async () => {
    const strings = TRIGGER_STRINGS.replace("Trigger/Name/0000000D=Checkpoint 2\r\n", "");
    const { blueprintPath } = await setup({ "enUS.SC2Data/LocalizedData/TriggerStrings.txt": strings });
    const checkpoints = (await surveyMission(blueprintPath, { kinds: ["trigger"] })).triggers!.find((category) => category.path.length === 2)!;

    expect(checkpoints.triggers[1]).toEqual({ id: "0000000D", name: "0000000D", events: [], initiallyOff: true, compiled: false });
  });

  it("decodes conversation ids and line values as it does a cutscene's links", async () => {
    const conversations = CONVERSATIONS.replace('<CConversation id="Harbour-01">', '<CConversation id="Harbour&amp;Co">').replaceAll("Conversation/Harbour-01/", "Conversation/Harbour&amp;Co/");
    const strings = CONVERSATION_STRINGS.replaceAll("Conversation/Harbour-01/", "Conversation/Harbour&Co/");
    const departure = DEPARTURE.replace('conversationLink="Harbour-01"', 'conversationLink="Harbour&amp;Co"');
    const { blueprintPath } = await setup({
      "Base.SC2Data/GameData/ConversationData.xml": conversations,
      "enUS.SC2Data/LocalizedData/ConversationStrings.txt": strings,
      "Base.SC2Data/Cutscenes/Departure.SC2Cutscene": departure,
    });
    const survey = await surveyMission(blueprintPath, { kinds: ["cutscene", "conversation"] });

    expect(survey.cutscenes!.find((cutscene) => cutscene.name === "Departure")!.lines).toEqual([{ conversation: "Harbour&Co", line: "Line00003", start: 1000, speaker: "CharGuard", text: "Move along." }]);
    expect(survey.conversations).toEqual([{ id: "Harbour&Co", lines: 3, compiled: false }]);
  });

  it("never takes an unnamed region for an area by name", async () => {
    const unnamed = REGIONS.replace(`</Regions>`, `    <region id="3">\r\n        <shape type="rect">\r\n            <quad value="0,0,1,1"/>\r\n        </shape>\r\n    </region>\r\n</Regions>`);
    const { blueprintPath } = await setup({ Regions: unnamed });

    await expect(surveyMission(blueprintPath, { area: "" })).rejects.toThrow("an area can't be empty");
    expect((await surveyMission(blueprintPath, { area: "3", kinds: ["region"] })).area).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });
});
