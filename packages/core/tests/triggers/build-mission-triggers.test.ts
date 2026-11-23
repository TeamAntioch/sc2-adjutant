import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { buildMissionTriggers, estimateLineSeconds, stableElementId } from "../../src/triggers/build-mission-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";

const blueprint = MissionBlueprintSchema.parse(
  JSON.parse(await readFile(new URL("../fixtures/trigger-test/blueprint.json", import.meta.url), "utf8")),
);

describe("stableElementId", () => {
  it("produces 8 uppercase hex digits deterministically", () => {
    expect(stableElementId("missionStart")).toMatch(/^[0-9A-F]{8}$/);
    expect(stableElementId("missionStart")).toBe(stableElementId("missionStart"));
    expect(stableElementId("a")).not.toBe(stableElementId("b"));
  });
});

describe("buildMissionTriggers", () => {
  const doc = buildMissionTriggers(blueprint);
  const script = writeMapScript({ mapName: blueprint.title, triggers: doc });

  it("groups actions into one trigger per event", () => {
    expect(doc.triggers.map((trigger) => trigger.name)).toEqual([
      "Mission Start",
      "Encounter - Crossing",
      "Zeratul Dies",
      "Zealot Dies",
    ]);
  });

  it("sends encounter attackers at the player's unit once it enters the trigger zone", () => {
    const encounter = script.slice(script.indexOf("bool gt_EncounterCrossing_Func"), script.indexOf("}", script.indexOf("void gt_EncounterCrossing_Init")));
    expect(encounter).toContain(
      [
        "    // Conditions",
        "    if (testConds) {",
        "        if (!((UnitGetOwner(EventUnit()) == 1))) {",
        "            return false;",
        "        }",
        "    }",
        "",
        "    // Actions",
      ].join("\r\n"),
    );
    expect(encounter).toContain("TriggerEnable(TriggerGetCurrent(), false);");
    for (const anchorId of ["ambush_zealot_1", "ambush_zealot_2"]) {
      expect(encounter).toContain(
        `UnitIssueOrder(UnitFromId(${stableObjectId(anchorId)}), OrderTargetingPoint(AbilityCommand("attack", 0), UnitGetPosition(EventUnit())), c_orderQueueReplace);`,
      );
    }
    expect(encounter).toContain("TransmissionSendForPlayerSelect(");
    // Crossing is the second zone, so region 2.
    expect(encounter).toContain("TriggerAddEventUnitRegion(gt_EncounterCrossing, null, RegionFromId(2), true);");
  });

  it("stores completable objectives and completes them before the game ends", () => {
    expect(doc.variables.map((variable) => variable.name)).toEqual(["objective_kill_zealot"]);
    expect(script).toContain("gv_objective_kill_zealot = c_invalidObjectiveId;");
    expect(script).toContain("gv_objective_kill_zealot = ObjectiveLastCreated();");
    const zealot = script.slice(script.indexOf("bool gt_ZealotDies_Func"));
    const complete = zealot.indexOf("ObjectiveSetState(gv_objective_kill_zealot, c_objectiveStateCompleted);");
    const transmission = zealot.indexOf("TransmissionSendForPlayerSelect(");
    const victory = zealot.indexOf("GameOver(1, c_gameOverVictory, true, true);");
    expect(complete).toBeGreaterThan(-1);
    expect(complete).toBeLessThan(transmission);
    expect(transmission).toBeLessThan(victory);
  });

  it("plays cued scenes as waiting native transmissions from the speaker's unit", () => {
    // The VCMI placeholder action prefixed messages with "[PH] "; only NativeLib is needed now.
    expect(script).not.toContain("VoidCampaignMissionLib");
    const start = script.slice(script.indexOf("bool gt_MissionStart_Func"), script.indexOf("void gt_MissionStart_Init"));
    expect(start.match(/TransmissionSendForPlayerSelect\(/g)).toHaveLength(2);
    // Same shape as the Editor's generated call.
    expect(start).toMatch(
      new RegExp(
        String.raw`TransmissionSendForPlayerSelect\(PlayerGroupAll\(\), TransmissionSourceFromUnit\(UnitFromId\(${stableObjectId("hero_zeratul")}\), true, false, "Talk"\), ` +
          String.raw`libNtve_gf_CinematicPortrait\(libNtve_ge_CinematicPortraitPosition_CenterLeft\), "", "Talk", null, ` +
          String.raw`StringExternal\("Param/Value/[0-9A-F]{8}"\), StringExternal\("Param/Value/[0-9A-F]{8}"\), 3\.0, c_transmissionDurationSet, true, c_maxPlayers, false\);`,
      ),
    );
  });

  it("requires a speaker unit for lines in cued scenes", () => {
    const raw = JSON.parse(JSON.stringify(blueprint)) as { screenplay: { scenes: { lines: Record<string, unknown>[] }[] } };
    delete raw.screenplay.scenes[0]!.lines[0]!.speakerAnchorId;
    expect(MissionBlueprintSchema.safeParse(raw).success).toBe(false);
  });

  it("wires death triggers to the placed units' object ids", () => {
    expect(script).toContain(
      `TriggerAddEventUnitDied(gt_ZealotDies, UnitRefFromUnit(UnitFromId(${stableObjectId("enemy_target")})));`,
    );
    expect(script).toContain(
      `TriggerAddEventUnitDied(gt_ZeratulDies, UnitRefFromUnit(UnitFromId(${stableObjectId("hero_zeratul")})));`,
    );
    expect(script).toContain("GameOver(1, c_gameOverDefeat, true, true);");
  });

  it("counts down a timer goal from mission start and ends the game when it runs out", () => {
    const timed = MissionBlueprintSchema.parse({
      ...blueprint,
      objectives: [
        { id: "survive", title: "Survive", description: "Hold out for five minutes.", type: "primary", beatId: blueprint.beats[0]!.id, completeWhen: { type: "timer", seconds: 300 } },
      ],
      outcomes: { victory: [{ type: "timer", seconds: 300 }], defeat: [] },
    });
    const timedDoc = buildMissionTriggers(timed);
    const timedScript = writeMapScript({ mapName: timed.title, triggers: timedDoc });
    expect(timedDoc.variables.map((variable) => variable.name)).toContain("goal_timer_300");
    expect(timedDoc.triggers.map((trigger) => trigger.name)).toContain("Timer 300 s Ends");
    const start = timedScript.slice(timedScript.indexOf("bool gt_MissionStart_Func"));
    expect(start).toContain("TimerStart(gv_goal_timer_300, 300.0, false, c_timeGame);");
    expect(start).toMatch(/TimerWindowCreate\(gv_goal_timer_300, StringExternal\("Param\/Value\/[0-9A-F]{8}"\), true, false\);/);
    expect(timedScript).toContain("TriggerAddEventTimer(gt_Timer300sEnds, gv_goal_timer_300);");
    const ends = timedScript.slice(timedScript.indexOf("bool gt_Timer300sEnds_Func"));
    expect(ends.indexOf("ObjectiveSetState(gv_objective_survive, c_objectiveStateCompleted);")).toBeGreaterThan(-1);
    expect(ends.indexOf("ObjectiveSetState(gv_objective_survive, c_objectiveStateCompleted);")).toBeLessThan(ends.indexOf("GameOver(1, c_gameOverVictory, true, true);"));
  });

  it("completes a resource quota once player 1 has collected enough", () => {
    const quota = MissionBlueprintSchema.parse({
      ...blueprint,
      objectives: [
        { id: "mine", title: "Mine 8,000 minerals", description: "Collect 8,000 minerals.", type: "primary", beatId: blueprint.beats[0]!.id, completeWhen: { type: "resourceQuota", resource: "minerals", amount: 8000 } },
      ],
      outcomes: { victory: [{ type: "resourceQuota", resource: "minerals", amount: 8000 }], defeat: [] },
    });
    const quotaScript = writeMapScript({ mapName: quota.title, triggers: buildMissionTriggers(quota) });
    expect(quotaScript).toContain("TriggerAddEventPlayerPropChange(gt_8000MineralsCollected, 1, c_playerPropMineralsCollected);");
    const collected = quotaScript.slice(quotaScript.indexOf("bool gt_8000MineralsCollected_Func"));
    expect(collected).toContain("if (!((PlayerGetPropertyInt(1, c_playerPropMineralsCollected) >= 8000))) {");
    const disable = collected.indexOf("TriggerEnable(TriggerGetCurrent(), false);");
    expect(disable).toBeGreaterThan(-1);
    expect(disable).toBeLessThan(collected.indexOf("ObjectiveSetState(gv_objective_mine, c_objectiveStateCompleted);"));
    expect(collected).toContain("GameOver(1, c_gameOverVictory, true, true);");
  });

  it("emits no triggers or library includes for a blueprint without objectives, scenes or outcomes", () => {
    const bare = buildMissionTriggers({
      ...blueprint,
      objectives: [],
      encounters: [],
      outcomes: { victory: [], defeat: [] },
      screenplay: { ...blueprint.screenplay, scenes: blueprint.screenplay.scenes.map(({ cue: _cue, ...scene }) => scene) },
    });
    expect(bare.triggers).toEqual([]);
    expect(writeMapScript({ mapName: "x", triggers: bare })).not.toContain("VoidCampaignMissionLib");
  });
});

describe("estimateLineSeconds", () => {
  it("allows at least three seconds and scales with word count", () => {
    expect(estimateLineSeconds("Hi.")).toBe(3);
    expect(estimateLineSeconds("one two three four five six seven eight nine ten")).toBe(5);
  });
});

describe("MissionBlueprintSchema outcomes", () => {
  it("rejects outcomes that reference a missing or non-unit anchor", () => {
    const raw = JSON.parse(JSON.stringify(blueprint)) as Record<string, unknown>;
    raw.outcomes = { victory: [{ type: "anchorDies", anchorId: "nobody" }], defeat: [] };
    expect(MissionBlueprintSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects scene cues and speakers that reference a non-unit anchor", () => {
    const raw = JSON.parse(JSON.stringify(blueprint)) as { screenplay: { scenes: Record<string, unknown>[] } };
    raw.screenplay.scenes[0]!.cue = { type: "anchorDies", anchorId: "arena" };
    expect(MissionBlueprintSchema.safeParse(raw).success).toBe(false);
  });
});
