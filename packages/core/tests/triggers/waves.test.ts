import { describe, expect, it } from "vitest";

import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { missionRegions } from "../../src/map/write-regions-xml.js";
import { waveWarningRegions, waveWarnings } from "../../src/triggers/wave-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { triggerTextStrings } from "../../src/triggers/write-trigger-strings.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const open = (toZoneId: string) => ({ toZoneId, type: "open" });
const zone = (id: string, x0: number, connections: string[], role = "path") => ({
  id,
  name: id,
  elevation: 1,
  landform: "flat",
  role,
  polygon: rect(x0, 0, x0 + 24, 48),
  connections: connections.map(open),
});

const calm = { id: "calm", title: "Calm", summary: "Nothing yet." };
const siege = { id: "siege", title: "Siege", summary: "The fort sends raids.", startsWhen: [{ type: "anchorEntersZone", anchorId: "hero", zoneId: "road" }] };
const fallback = { id: "fallback", title: "Fallback", summary: "The fort pulls back.", startsWhen: [{ type: "anchorDies", anchorId: "warden" }] };
const anchors = [
  { id: "hero", name: "Hero", zoneId: "home", kind: "unit", unitType: "Zeratul", player: 1, position: { x: 4, y: 24 } },
  { id: "warden", name: "Warden", zoneId: "fort", kind: "unit", unitType: "Zealot", player: 2, position: { x: 74, y: 24 } },
];

/** home → road → lane → fort, left to right on a 96x48 map (playable x 10-86, y 8-28); the fort is player 2's. */
function blueprint(waves: object[], extra: Record<string, unknown> = {}) {
  return MissionBlueprintSchema.parse({
    id: "waves",
    campaignId: "test",
    title: "Waves",
    setting: "test",
    mapSize: { width: 96, height: 48 },
    zones: [zone("home", 0, ["road"], "base"), zone("road", 24, ["home", "lane"]), zone("lane", 48, ["road", "fort"]), zone("fort", 72, ["lane"], "base")],
    anchors,
    beats: [calm, siege, fallback],
    waves,
    screenplay: { title: "Waves" },
    ...extra,
  });
}

const raid = {
  id: "raid",
  spawnZoneId: "fort",
  targetZoneIds: ["home"],
  arrival: "ground",
  units: [
    { type: "Zealot", count: 2 },
    { type: "Stalker", count: [0, 0, 1, 2] },
  ],
  startsAtBeat: "siege",
  endsAtBeat: "fallback",
  firstSeconds: 30,
  intervalSeconds: 90,
};

const scriptOf = (parsed: ReturnType<typeof blueprint>) => writeMapScript({ mapName: parsed.title, triggers: buildMissionTriggers(parsed) });
/** The Galaxy function of one trigger, a statement per line. */
const triggerLines = (script: string, galaxyName: string): string[] => {
  const start = script.indexOf(`bool gt_${galaxyName}_Func`);
  expect(start, galaxyName).toBeGreaterThanOrEqual(0);
  return script
    .slice(start, script.indexOf("\r\n}\r\n", start))
    .split("\r\n")
    .map((line) => line.trim());
};
/** That each line comes in turn, after the one before. */
const inOrder = (lines: readonly string[], expected: readonly string[]): void => {
  let from = 0;
  for (const line of expected) {
    const index = lines.indexOf(line, from);
    expect(index, line).toBeGreaterThanOrEqual(from);
    from = index + 1;
  }
};

describe("compiled ground Waves (ADR 0008)", () => {
  const script = scriptOf(blueprint([raid]));

  it("waits on AI time, creates each type's count for the difficulty at the spawn, and sends along the route", () => {
    const lines = triggerLines(script, "Waveraid");
    inOrder(lines, [
      "Wait(30.0, c_timeAI);",
      "if ((gv_waveraidOn == true)) {",
      "UnitGroupClear(gv_waveraidSent);",
      // The fort is entered only from the lane: its deepest playable cells are on the playable area's east edge.
      'UnitCreate(libNtve_gf_DifficultyValueInt(2, 2, 3, 3), "Zealot", 0, 2, Point(85.5, 8.5), 270.0);',
      "UnitGroupAddUnitGroup(gv_waveraidSent, UnitLastCreatedGroup());",
      "UnitGroupAddUnitGroup(gv_waveraidUnits, UnitLastCreatedGroup());",
      'UnitCreate(libNtve_gf_DifficultyValueInt(0, 0, 1, 2), "Stalker", 0, 2, Point(85.5, 8.5), 270.0);',
      "UnitGroupAddUnitGroup(gv_waveraidSent, UnitLastCreatedGroup());",
      "UnitGroupAddUnitGroup(gv_waveraidUnits, UnitLastCreatedGroup());",
      // A send that made no units (a type that joins only on Hard) sends no wave.
      "if ((UnitGroupCount(gv_waveraidSent, c_unitCountAlive) >= 1)) {",
      // Only this send's units: the waves already in the field carry on.
      "AIAttackWaveUseGroup(2, gv_waveraidSent);",
      "AIAttackWaveSetTargetPoint(2, Point(11.5, 23.5));",
    ]);
    // One waypoint per Connection crossing, in route order: into the lane, the road, then home.
    const waypoints = lines.filter((line) => line.startsWith("AIAttackWaveAddWaypoint(2, "));
    expect(waypoints.map((line) => Number(/Point\(([\d.]+),/.exec(line)![1]))).toEqual([71.5, 47.5, 23.5]);
    expect(waypoints.every((line) => line.endsWith(", false);"))).toBe(true);
    inOrder(lines, [waypoints.at(-1)!, "AIAttackWaveSend(2, 0, false);", "TriggerExecute(gt_WaveraidRepeat, true, false);"]);
    // Repeating is the send's last action.
    expect(lines[lines.lastIndexOf("}") - 1]).toBe("TriggerExecute(gt_WaveraidRepeat, true, false);");
  });

  it("repeats every interval of AI time while the stream is on", () => {
    const repeat = triggerLines(script, "WaveraidRepeat");
    inOrder(repeat, ["Wait(90.0, c_timeAI);", "if ((gv_waveraidOn == true)) {", "AIAttackWaveSend(2, 0, false);"]);
    expect(repeat[repeat.lastIndexOf("}") - 1]).toBe("TriggerExecute(gt_WaveraidRepeat, true, false);");
  });

  /** That a Beat's trigger turns the stream on (unless it's on already). */
  const starts = (lines: readonly string[]) =>
    inOrder(lines, ["if ((gv_waveraidOn == false)) {", "gv_waveraidOn = true;", "TriggerExecute(gt_Waveraid, true, false);"]);
  /** That a Beat's trigger turns the stream off (unless it's off) and sends home every wave of the stream's units. */
  const stops = (lines: readonly string[]) => {
    const auto = /^(auto[0-9A-F]{8})_g = gv_waveraidUnits;$/.exec(lines.find((line) => line.endsWith("_g = gv_waveraidUnits;"))!)![1];
    inOrder(lines, [
      "if ((gv_waveraidOn == true)) {",
      "gv_waveraidOn = false;",
      `${auto}_g = gv_waveraidUnits;`,
      // Still the sender's, and still in a wave: the AI's own waves and captured units are left alone.
      `if ((UnitGetOwner(${auto}_var) == 2) && (AIUnitGetWave(${auto}_var) != null)) {`,
      `AIAttackWaveCancel(AIUnitGetWave(${auto}_var));`,
      "UnitGroupClear(gv_waveraidUnits);",
    ]);
  };

  it("starts the stream when its beat starts, and stops it and sends its waves home when its end beat starts", () => {
    starts(triggerLines(script, "BeatSiege"));
    stops(triggerLines(script, "BeatFallback"));
    expect(triggerLines(script, "BeatSiege")).not.toContain("gv_waveraidOn = false;");
    expect(script).toContain("unitgroup gv_waveraidUnits;");
    expect(script).toContain("gv_waveraidUnits = UnitGroupEmpty();");
  });

  it("writes the stream's unit groups as the Editor saves one: a unitgroup starting as Empty Unit Group", () => {
    const xml = writeTriggersXml(buildMissionTriggers(blueprint([raid])));
    const variable = xml.slice(xml.lastIndexOf('<Element Type="Variable"', xml.indexOf('<Type Value="unitgroup"/>')));
    const call = /<FunctionCall Type="FunctionCall" Id="([0-9A-F]{8})"\/>/.exec(variable.slice(variable.indexOf('<Element Type="Param"')))![1];
    expect(xml).toContain(`<Element Type="FunctionCall" Id="${call}">\r\n        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000104"/>`);
  });

  it("sends a wave once without an interval, from the mission start in a first beat without startsWhen", () => {
    const once = scriptOf(blueprint([{ ...raid, startsAtBeat: "calm", intervalSeconds: undefined }]));
    expect(once).not.toContain("gt_WaveraidRepeat");
    expect(triggerLines(once, "Waveraid").some((line) => line.startsWith("TriggerExecute("))).toBe(false);
    starts(triggerLines(once, "EnemyAIStart"));
  });

  it("starts the stream at a later beat before its end when the mission skips its start, and stops it at a later beat when it skips its end", () => {
    const later = { id: "later", title: "Later", summary: "After the fallback.", startsWhen: [{ type: "anchorDies", anchorId: "hero" }] };
    const surge = { id: "surge", title: "Surge", summary: "Between the siege and the fallback.", startsWhen: [{ type: "anchorEntersZone", anchorId: "hero", zoneId: "lane" }] };
    const skipping = scriptOf(blueprint([raid], { beats: [calm, siege, surge, fallback, later] }));
    // Skipping Siege straight to Surge still starts it; Surge after Siege leaves it running.
    starts(triggerLines(skipping, "BeatSurge"));
    // Skipping Fallback straight to Later still stops it; Later after Fallback finds it off.
    stops(triggerLines(skipping, "BeatLater"));
    expect(triggerLines(skipping, "BeatLater")).not.toContain("gv_waveraidOn = true;");
  });

  it("sends units from the spawn Anchor when there is one", () => {
    const gate = { id: "gate", name: "Gate", zoneId: "fort", kind: "point", position: { x: 80, y: 20 } };
    const parsed = blueprint([{ ...raid, spawnAnchorId: "gate" }], { anchors: [...anchors, gate] });
    expect(triggerLines(scriptOf(parsed), "Waveraid")).toContain('UnitCreate(libNtve_gf_DifficultyValueInt(2, 2, 3, 3), "Zealot", 0, 2, Point(80.0, 20.0), 270.0);');
  });

  it("reports the waves it can't compile, and what it leaves out of the ones it can", () => {
    const mutas = { ...raid, id: "mutas", arrival: "air", units: [{ type: "Mutalisk", count: 4 }] };
    const parsed = blueprint([raid, mutas]);
    expect(waveWarnings(parsed)).toEqual(["Wave mutas arrives by air, which isn't compiled yet; it is left out of the map."]);
    expect(scriptOf(parsed)).not.toContain("gt_Wavemutas");
    expect(waveWarnings(blueprint([{ ...raid, warning: { seconds: 15 } }]))).toEqual([]);
    expect(waveWarnings(blueprint([{ ...raid, units: [{ type: "Gorgon", count: 1 }], warning: { seconds: 15 } }]))).toEqual([
      "Wave raid's warning takes a marine's speed for Gorgon, whose speed core doesn't know; give the wave a speed.",
    ]);
    const unstarted = blueprint([raid], { beats: [calm, { ...siege, startsWhen: undefined }, fallback] });
    expect(waveWarnings(unstarted)).toEqual([
      "Wave raid starts at beat siege, which has no startsWhen (only the first beat and beats with startsWhen start in the map); it is left out of the map.",
    ]);
    const endless = blueprint([raid], { beats: [calm, siege, { ...fallback, startsWhen: undefined }] });
    expect(waveWarnings(endless)).toEqual(["Wave raid ends at beat fallback, but neither it nor a later beat has a startsWhen, so in the map it never stops."]);
  });

  describe("Raids", () => {
    // Raids on the road first, then home; the player's completed Assimilators there (regions 2 and 1).
    const raider = { ...raid, targetZoneIds: ["road", "home"], onlyIfPlayerHolds: "Assimilator" };
    const raidScript = scriptOf(blueprint([raider]));
    const completed = "UnitFilter(0, 0, 0, (1 << (c_targetFilterUnderConstruction - 32)) | (1 << (c_targetFilterDead - 32)))";
    const heldIn = (region: number) => `UnitGroup("Assimilator", 1, RegionFromId(${region}), ${completed}, 0)`;

    it("sends to the first candidate the player holds a completed unit in, aimed at that unit, or skips the send", () => {
      const lines = triggerLines(raidScript, "Waveraid");
      inOrder(lines, [
        "if ((gv_waveraidOn == true)) {",
        `if ((UnitGroupCount(${heldIn(2)}, c_unitCountAlive) >= 1)) {`,
        "UnitGroupAddUnitGroup(gv_waveraidRaidroad, UnitLastCreatedGroup());",
        "AIAttackWaveUseGroup(2, gv_waveraidSent);",
        `AIAttackWaveSetTargetPoint(2, UnitGetPosition(UnitGroupUnit(${heldIn(2)}, 1)));`,
        "AIAttackWaveSend(2, 0, false);",
        "else {",
        `if ((UnitGroupCount(${heldIn(1)}, c_unitCountAlive) >= 1)) {`,
        "UnitGroupAddUnitGroup(gv_waveraidRaidhome, UnitLastCreatedGroup());",
        `AIAttackWaveSetTargetPoint(2, UnitGetPosition(UnitGroupUnit(${heldIn(1)}, 1)));`,
        "AIAttackWaveSend(2, 0, false);",
        // Neither held: nothing is sent, and the stream waits for its next send.
        "TriggerExecute(gt_WaveraidRepeat, true, false);",
      ]);
      // Each candidate's route: the road is reached through the lane, home through the road too.
      const waypoints = lines.filter((line) => line.startsWith("AIAttackWaveAddWaypoint(2, ")).map((line) => Number(/Point\(([\d.]+),/.exec(line)![1]));
      expect(waypoints).toEqual([71.5, 47.5, 71.5, 47.5, 23.5]);
      // Repeating doesn't depend on a candidate being held.
      expect(lines[lines.lastIndexOf("}") - 1]).toBe("TriggerExecute(gt_WaveraidRepeat, true, false);");
      expect(lines.filter((line) => line === "TriggerExecute(gt_WaveraidRepeat, true, false);")).toHaveLength(1);
    });

    it("sends a Raid home from a candidate once the player holds none of the type there, and lets its units go", () => {
      expect(raidScript).toContain("TriggerAddEventTimePeriodic(gt_WaveraidWatch, 1.0, c_timeAI);");
      const watch = triggerLines(raidScript, "WaveraidWatch");
      // Only while the stream runs.
      inOrder(watch, ["if (testConds) {", "if (!((gv_waveraidOn == true))) {", "return false;"]);
      const auto = (group: string) => /^(auto[0-9A-F]{8})_g/.exec(watch.find((line) => line.endsWith(`_g = ${group};`))!)![1];
      for (const [zone, region] of [
        ["road", 2],
        ["home", 1],
      ] as const) {
        const loop = auto(`gv_waveraidRaid${zone}`);
        inOrder(watch, [
          `if ((UnitGroupCount(gv_waveraidRaid${zone}, c_unitCountAlive) >= 1) && (UnitGroupCount(${heldIn(region)}, c_unitCountAlive) == 0)) {`,
          `${loop}_g = gv_waveraidRaid${zone};`,
          `if ((UnitGetOwner(${loop}_var) == 2) && (AIUnitGetWave(${loop}_var) != null)) {`,
          `AIAttackWaveCancel(AIUnitGetWave(${loop}_var));`,
          // Out of the stream, so the end beat's recall leaves the waves they join at home alone.
          `UnitGroupRemoveUnitGroup(gv_waveraidUnits, gv_waveraidRaid${zone});`,
          `UnitGroupClear(gv_waveraidRaid${zone});`,
        ]);
      }
      expect(raidScript).toContain("unitgroup gv_waveraidRaidroad;");
      expect(raidScript).toContain("gv_waveraidRaidhome = UnitGroupEmpty();");
    });

    it("still sends every raider home when its end beat starts, and forgets where they were sent", () => {
      const fallbackLines = triggerLines(raidScript, "BeatFallback");
      inOrder(fallbackLines, [
        "gv_waveraidOn = false;",
        fallbackLines.find((line) => line.endsWith("_g = gv_waveraidUnits;"))!,
        fallbackLines.find((line) => line.startsWith("AIAttackWaveCancel(AIUnitGetWave("))!,
        "UnitGroupClear(gv_waveraidUnits);",
        "UnitGroupClear(gv_waveraidRaidroad);",
        "UnitGroupClear(gv_waveraidRaidhome);",
      ]);
    });

    describe("a unit that joins only the first send that goes out", () => {
      const led = { ...raider, units: [...raider.units, { type: "Archon", count: [1, 1, 1, 1], sends: "first" }] };
      const ledScript = scriptOf(blueprint([led]));
      const archon = 'UnitCreate(libNtve_gf_DifficultyValueInt(1, 1, 1, 1), "Archon", 0, 2, Point(85.5, 8.5), 270.0);';

      it("is created, in the send's group, only while no send has gone out", () => {
        for (const sender of ["Waveraid", "WaveraidRepeat"]) {
          const lines = triggerLines(ledScript, sender);
          for (const zone of ["road", "home"]) {
            inOrder(lines, [
              'UnitCreate(libNtve_gf_DifficultyValueInt(0, 0, 1, 2), "Stalker", 0, 2, Point(85.5, 8.5), 270.0);',
              "if ((gv_waveraidFirstSent == false)) {",
              archon,
              "UnitGroupAddUnitGroup(gv_waveraidSent, UnitLastCreatedGroup());",
              "UnitGroupAddUnitGroup(gv_waveraidUnits, UnitLastCreatedGroup());",
              `UnitGroupAddUnitGroup(gv_waveraidRaid${zone}, UnitLastCreatedGroup());`,
              "AIAttackWaveUseGroup(2, gv_waveraidSent);",
              "AIAttackWaveSend(2, 0, false);",
              // Only a send that goes out uses the unit up: a skipped one leaves it for the next.
              "gv_waveraidFirstSent = true;",
            ]);
          }
          // Once per candidate, inside the send that found it held.
          expect(lines.filter((line) => line === archon)).toHaveLength(2);
          expect(lines.filter((line) => line === "gv_waveraidFirstSent = true;")).toHaveLength(2);
        }
        expect(ledScript).toContain("bool gv_waveraidFirstSent;");
      });

      it("leaves a stream without one as it was", () => {
        expect(raidScript).not.toContain("FirstSent");
      });

      it("joins a plain Wave's first send that has units, so a send with none on this difficulty leaves it for the next", () => {
        const lines = triggerLines(scriptOf(blueprint([{ ...raid, units: [...raid.units, { type: "Archon", count: [0, 1, 1, 1], sends: "first" }] }])), "WaveraidRepeat");
        inOrder(lines, [
          "if ((gv_waveraidFirstSent == false)) {",
          'UnitCreate(libNtve_gf_DifficultyValueInt(0, 1, 1, 1), "Archon", 0, 2, Point(85.5, 8.5), 270.0);',
          "if ((UnitGroupCount(gv_waveraidSent, c_unitCountAlive) >= 1)) {",
          "AIAttackWaveSend(2, 0, false);",
          "gv_waveraidFirstSent = true;",
          "else {",
        ]);
        expect(lines.filter((line) => line === "gv_waveraidFirstSent = true;")).toHaveLength(1);
      });

      it("leaves the warning's circle to the units every send brings", () => {
        const units = [
          { type: "Stalker", count: 1 },
          { type: "Zealot", count: 1, sends: "first" },
        ];
        const [region] = waveWarningRegions(blueprint([{ ...raid, units, warning: { seconds: 10 } }]));
        // A Stalker's 4.13 cells a second, not the slower Zealot's 3.15.
        expect(region!.shapes[0]).toMatchObject({ radius: 41.3 });
      });

      it("counts it in the circle when only the first send is warned, which is the one that brings it", () => {
        const units = [
          { type: "Stalker", count: 1 },
          { type: "Zealot", count: 1, sends: "first" },
        ];
        const [region] = waveWarningRegions(blueprint([{ ...raid, units, warning: { seconds: 10, firstOnly: true } }]));
        // The Zealot's 3.15 cells a second, the slower of the two.
        expect(region!.shapes[0]).toMatchObject({ radius: 31.5 });
      });

      it("reads the circle from units Normal sends, not every-send units Normal leaves out", () => {
        const units = [
          { type: "Zealot", count: [0, 0, 1, 1] },
          { type: "Stalker", count: 1, sends: "first" },
        ];
        const [region] = waveWarningRegions(blueprint([{ ...raid, units, warning: { seconds: 10 } }]));
        // On Normal only the first send goes out, with the Stalker alone.
        expect(region!.shapes[0]).toMatchObject({ radius: 41.3 });
      });

      it("asks for a speed only for the units the circle reads, each named once", () => {
        const leader = { type: "Gorgon", count: 1, sends: "first" };
        expect(waveWarnings(blueprint([{ ...raid, units: [{ type: "Zealot", count: 2 }, leader], warning: { seconds: 15 } }]))).toEqual([]);
        const gorgons = [
          { type: "Gorgon", count: 1 },
          { ...leader, count: 1 },
        ];
        expect(waveWarnings(blueprint([{ ...raid, units: gorgons, warning: { seconds: 15, firstOnly: true } }]))).toEqual([
          "Wave raid's warning takes a marine's speed for Gorgon, whose speed core doesn't know; give the wave a speed.",
        ]);
      });

      it("says when a repeating wave's repeats bring nobody on a difficulty its first send comes on", () => {
        const units = [
          { type: "Zealot", count: [0, 1, 1, 1] },
          { type: "Archon", count: 1, sends: "first" },
        ];
        expect(waveWarnings(blueprint([{ ...raid, units }]))).toEqual([
          "Wave raid's repeats bring nobody on Casual, where only its first send comes; give a unit that comes with every send a count there for the wave to keep coming.",
        ]);
        expect(waveWarnings(blueprint([{ ...raid, units, intervalSeconds: undefined }]))).toEqual([]);
      });

      it("shares firstOnly's flag, set as the first send arms its warning", () => {
        const lines = triggerLines(scriptOf(blueprint([{ ...led, warning: { seconds: 10, firstOnly: true } }])), "WaveraidRepeat");
        inOrder(lines, ["if ((gv_waveraidWarned == false)) {", archon, "AIAttackWaveSend(2, 0, false);", "if ((gv_waveraidWarned == false)) {", "gv_waveraidWarned = true;"]);
        expect(lines.join("\n")).not.toContain("FirstSent");
      });

      it("never turns its stream on again once it is off, so the leader comes once a mission", () => {
        // It turns on only at Beats before its end Beat and off at that Beat and after, and Beats only move forward.
        const turns = (galaxyName: string) => {
          const lines = triggerLines(ledScript, galaxyName);
          return { on: lines.includes("gv_waveraidOn = true;"), off: lines.includes("gv_waveraidOn = false;") };
        };
        expect(turns("BeatSiege")).toEqual({ on: true, off: false });
        expect(turns("BeatFallback")).toEqual({ on: false, off: true });
        expect(ledScript.match(/gv_waveraidOn = true;/g)).toHaveLength(1);
      });
    });

    it("drops a candidate it has no ground route to, and says so", () => {
      const island = { id: "island", name: "island", elevation: 2, landform: "flat", role: "path", polygon: rect(0, 40, 8, 48), connections: [] };
      const parsed = blueprint([{ ...raider, targetZoneIds: ["island", "home"] }], {
        zones: [...blueprint([]).zones, island],
      });
      expect(waveWarnings(parsed)).toEqual(["Wave raid has no ground route from fort to island, so it never raids there."]);
      expect(scriptOf(parsed)).not.toContain("gv_waveraidRaidisland");
    });
  });

  describe("warnings", () => {
    const alarm = { id: "alarm", lines: [{ id: "incoming", speaker: "Hero", speakerAnchorId: "hero", text: "Incoming!" }] };
    const warned = (warning: object, extra: object = {}) => blueprint([{ ...raid, warning, ...extra }], { screenplay: { title: "Waves", scenes: [alarm] } });

    it("compiles a circle of the warning's seconds at the slowest unit's speed around the aim point, after the zones' regions", () => {
      // Zealots (3.15 cells/s) are slower than Stalkers (4.13).
      const regions = waveWarningRegions(warned({ seconds: 10 }));
      expect(regions).toEqual([
        { name: "Wave raid Warning home", shapes: [{ type: "circle", center: { x: 11.5, y: 23.5 }, radius: 31.5 }], source: { kind: "wave-warning", waveId: "raid", zoneId: "home" } },
      ]);
      // The wave's own speed wins.
      expect(waveWarningRegions(warned({ seconds: 10 }, { speed: 2 }))[0]!.shapes[0]).toMatchObject({ radius: 20 });
      // A type that joins only on Hard and up doesn't slow the circle drawn for every difficulty.
      const queens = { units: [{ type: "Zergling", count: 6 }, { type: "Queen", count: [0, 0, 0, 1] }] };
      expect(waveWarningRegions(warned({ seconds: 10 }, queens))[0]!.shapes[0]).toMatchObject({ radius: 41.3 });
      // Region 5: after the four zones.
      expect(missionRegions(warned({ seconds: 10 }), [], regions).map((region) => region.name)).toEqual(["home", "road", "lane", "fort", "Wave raid Warning home"]);
    });

    it("fires, off until a send arms it, when a unit of the stream enters the circle: turns itself off, pings the aim point and plays the Transmission", () => {
      const script = scriptOf(warned({ seconds: 10, transmission: "alarm" }));
      inOrder(script.split("\r\n").map((line) => line.trim()), [
        'gt_WaveraidWarninghome = TriggerCreate("gt_WaveraidWarninghome_Func");',
        "TriggerEnable(gt_WaveraidWarninghome, false);",
        "TriggerAddEventUnitRegion(gt_WaveraidWarninghome, null, RegionFromId(5), true);",
      ]);
      inOrder(triggerLines(script, "WaveraidWarninghome"), [
        "if (!((UnitGroupHasUnit(gv_waveraidUnits, EventUnit()) == true))) {",
        "TriggerEnable(TriggerGetCurrent(), false);",
        "MinimapPing(PlayerGroupAll(), RegionGetCenter(RegionFromId(5)), 5.0, Color(100.0, 0.0, 0.0));",
        "TriggerExecute(gt_WaveraidWarningTransmission, true, false);",
      ]);
      expect(triggerLines(script, "WaveraidWarningTransmission").some((line) => line.startsWith("TransmissionSendForPlayerSelect("))).toBe(true);
      // Each send arms it once it has sent.
      for (const sender of ["Waveraid", "WaveraidRepeat"]) inOrder(triggerLines(script, sender), ["AIAttackWaveSend(2, 0, false);", "TriggerEnable(gt_WaveraidWarninghome, true);"]);
      const xml = writeTriggersXml(buildMissionTriggers(warned({ seconds: 10 })));
      expect(xml).toMatch(/<Element Type="Trigger" Id="[0-9A-F]{8}">\r\n        <InitOff\/>\r\n        <Event /);
    });

    it("plays an uncued scene whose lines name no speaker on the map, with no source", () => {
      const quiet = { id: "quiet", lines: [{ id: "hush", speaker: "Voice", text: "They're coming." }] };
      const parsed = blueprint([{ ...raid, warning: { seconds: 10, transmission: "quiet" } }], { screenplay: { title: "Waves", scenes: [quiet] } });
      expect(triggerLines(scriptOf(parsed), "WaveraidWarningTransmission").join("\n")).toContain("TransmissionSource()");
    });

    it("says when the wave forms inside its warning's circle, where no unit ever enters it", () => {
      // The fort's spawn is about 74 cells from home's point: 30 s of Zealots is 94.5 cells.
      expect(waveWarnings(warned({ seconds: 30 }))).toEqual([
        "Wave raid forms within its warning's 94.5-cell circle around home, so the warning there never fires; shorten warning.seconds or move the spawn.",
      ]);
      expect(waveWarnings(warned({ seconds: 10 }))).toEqual([]);
    });

    it("leaves the Transmission out when none is given", () => {
      const script = scriptOf(warned({ seconds: 10 }));
      expect(script).not.toContain("gt_WaveraidWarningTransmission");
      expect(triggerLines(script, "WaveraidWarninghome").some((line) => line.startsWith("TriggerExecute("))).toBe(false);
    });

    it("plays a script scene by number as the Transmission", () => {
      const parsed = blueprint([{ ...raid, warning: { seconds: 10, transmission: 3 } }], { screenplay: { title: "Waves", script: { source: "waves.md" } } });
      const line = { kind: "line", speaker: "HERO", character: "Hero", characterId: "Hero", soundId: "waves-3-1", lineId: "Line3-1", soundLine: "3-1", text: "Incoming!", spans: [] } as const;
      const script = { title: "Waves", fields: {}, conversationId: "waves", scenes: [{ number: 3, title: "Alarm", items: [line] }] };
      const galaxy = writeMapScript({ mapName: parsed.title, triggers: buildMissionTriggers(parsed, { script }) });
      expect(triggerLines(galaxy, "WaveraidWarningTransmission").some((text) => text.startsWith("TransmissionSendForPlayerSelect(") && text.includes('SoundLink("waves-3-1", -1)'))).toBe(true);
    });

    it("arms only on the stream's first send with firstOnly", () => {
      const script = scriptOf(warned({ seconds: 10, firstOnly: true }));
      for (const sender of ["Waveraid", "WaveraidRepeat"]) {
        inOrder(triggerLines(script, sender), [
          "AIAttackWaveSend(2, 0, false);",
          "if ((gv_waveraidWarned == false)) {",
          "TriggerEnable(gt_WaveraidWarninghome, true);",
          "gv_waveraidWarned = true;",
        ]);
      }
    });

    it("moves a Raid's circle to the unit it aims at as it arms it, one circle per candidate", () => {
      const parsed = blueprint([{ ...raid, targetZoneIds: ["road", "home"], onlyIfPlayerHolds: "Assimilator", warning: { seconds: 10 } }]);
      expect(waveWarningRegions(parsed).map((region) => region.name)).toEqual(["Wave raid Warning road", "Wave raid Warning home"]);
      const lines = triggerLines(scriptOf(parsed), "Waveraid");
      const road = lines.findIndex((line) => line.startsWith("RegionSetCenter(RegionFromId(5), UnitGetPosition(UnitGroupUnit(UnitGroup(\"Assimilator\", 1, RegionFromId(2)"));
      expect(road).toBeGreaterThan(lines.indexOf("AIAttackWaveSend(2, 0, false);"));
      expect(lines[road + 1]).toBe("TriggerEnable(gt_WaveraidWarningroad, true);");
      expect(lines.some((line) => line.startsWith("RegionSetCenter(RegionFromId(6), UnitGetPosition(UnitGroupUnit(UnitGroup(\"Assimilator\", 1, RegionFromId(1)"))).toBe(true);
      // Only the raiders sent to the road set off the road's warning.
      expect(triggerLines(scriptOf(parsed), "WaveraidWarningroad")).toContain("if (!((UnitGroupHasUnit(gv_waveraidRaidroad, EventUnit()) == true))) {");
    });
  });
});

describe("debug messages in Test Document (#174)", () => {
  /** The trigger's lines with each text parameter's string put back in, quoted, so a debug message reads as it shows. */
  const readable = (parsed: ReturnType<typeof blueprint>, galaxyName: string): string[] => {
    const triggers = buildMissionTriggers(parsed);
    const strings = triggerTextStrings(triggers);
    const script = writeMapScript({ mapName: parsed.title, triggers });
    return triggerLines(script, galaxyName).map((line) => line.replace(/StringExternal\("([^"]+)"\)/g, (_, key: string) => JSON.stringify(strings[key])));
  };
  const debug = (message: string) => `TriggerDebugOutput(1, ${message}, true);`;

  it("says when a Beat starts", () => {
    expect(readable(blueprint([raid]), "BeatSiege")).toContain(debug('"Beat: Siege started"'));
  });

  it("says when a stream turns on, and when its first send is due", () => {
    inOrder(readable(blueprint([raid]), "BeatSiege"), ["gv_waveraidOn = true;", debug('"Wave raid: on, first send in 30 s"'), "TriggerExecute(gt_Waveraid, true, false);"]);
  });

  it("says when a stream turns off, and recalls its waves in the field, naming the Beat that ended it", () => {
    const lines = readable(blueprint([raid]), "BeatFallback");
    inOrder(lines, [
      "gv_waveraidOn = false;",
      debug('"Wave raid: off"'),
      // Only with raiders out.
      "if ((UnitGroupCount(gv_waveraidUnits, c_unitCountAlive) >= 1)) {",
      debug('"Wave raid: recalled (Fallback)"'),
      lines.find((line) => line.startsWith("AIAttackWaveCancel(AIUnitGetWave("))!,
    ]);
  });

  it("says how many units each send sent and where, or that this difficulty sends none", () => {
    for (const sender of ["Waveraid", "WaveraidRepeat"]) {
      inOrder(readable(blueprint([raid]), sender), [
        "if ((UnitGroupCount(gv_waveraidSent, c_unitCountAlive) >= 1)) {",
        "AIAttackWaveSend(2, 0, false);",
        debug('(("Wave raid: sent " + IntToText(UnitGroupCount(gv_waveraidSent, c_unitCountAlive))) + " units → home")'),
        "else {",
        debug('"Wave raid: skipped, no units on this difficulty"'),
      ]);
    }
  });

  describe("for a Raid", () => {
    const raider = { ...raid, targetZoneIds: ["road", "home"], onlyIfPlayerHolds: "Assimilator", warning: { seconds: 10 } };
    // Zones by their Blueprint names.
    const named = blueprint([raider], { zones: blueprint([]).zones.map((zone) => ({ ...zone, name: `The ${zone.id}` })) });

    it("names the candidate it sent to, or the Zones it found none held in", () => {
      const lines = readable(named, "Waveraid");
      inOrder(lines, [
        "AIAttackWaveSend(2, 0, false);",
        debug('(("Wave raid: sent " + IntToText(UnitGroupCount(gv_waveraidSent, c_unitCountAlive))) + " units → The road")'),
        "AIAttackWaveSend(2, 0, false);",
        debug('(("Wave raid: sent " + IntToText(UnitGroupCount(gv_waveraidSent, c_unitCountAlive))) + " units → The home")'),
        debug('"Wave raid: skipped, no Assimilator held in The road, The home"'),
        "TriggerExecute(gt_WaveraidRepeat, true, false);",
      ]);
    });

    it("says when it goes home on success", () => {
      const watch = readable(named, "WaveraidWatch");
      for (const zone of ["road", "home"]) {
        inOrder(watch, [`UnitGroupClear(gv_waveraidRaid${zone});`]);
      }
      expect(watch.filter((line) => line === debug('"Wave raid: recalled (success)"'))).toHaveLength(2);
    });

    it("says where its warning fired", () => {
      inOrder(readable(named, "WaveraidWarningroad"), ["TriggerEnable(TriggerGetCurrent(), false);", debug('"Wave raid: warning at The road"')]);
      inOrder(readable(named, "WaveraidWarninghome"), ["TriggerEnable(TriggerGetCurrent(), false);", debug('"Wave raid: warning at The home"')]);
    });
  });
});
