// An outcome condition, an objective's completeWhen or an encounter with `fromBeat`: armed only once
// that Beat (or a later one, if the mission skips it) has started, firing then if already met. The
// `trigger-test` fixture with two later Beats; its MapScript is read back.
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";

const raw = JSON.parse(await readFile(new URL("../fixtures/trigger-test/blueprint.json", import.meta.url), "utf8"));

/** The fixture with Beats "late" (Zeratul reaches the Crossing) and "last" (he reaches the Outpost), edited. */
function blueprintWith(edit: (blueprint: any) => void = () => {}): unknown {
  const blueprint = structuredClone(raw);
  blueprint.beats.push(
    { id: "late", title: "Late", summary: "Zeratul reaches the crossing.", startsWhen: [{ type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "crossing" }] },
    { id: "last", title: "Last", summary: "Zeratul reaches the outpost.", startsWhen: [{ type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "outpost" }] },
  );
  edit(blueprint);
  return blueprint;
}

function scriptOf(edit: (blueprint: any) => void): string {
  const blueprint = MissionBlueprintSchema.parse(blueprintWith(edit));
  return writeMapScript({ mapName: blueprint.title, triggers: buildMissionTriggers(blueprint) });
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const init = (script: string, name: string): string => script.slice(script.indexOf(`void gt_${name}_Init`), script.indexOf("}", script.indexOf(`void gt_${name}_Init`)));
const ZEALOT = `UnitFromId(${stableObjectId("enemy_target")})`;
const ZERATUL = `UnitFromId(${stableObjectId("hero_zeratul")})`;

describe("fromBeat on an outcome condition", () => {
  // The fixture's victory scene, cued on the Zealot's death, moved to Late's start: a cue on a
  // victory's event when the victory waits for a Beat is refused (below).
  const victoryFromLate = (blueprint: any) => {
    blueprint.outcomes.victory = [{ type: "anchorDies", anchorId: "enemy_target", fromBeat: "late" }];
    blueprint.screenplay.scenes.find((scene: { id: string }) => scene.id === "scene_victory").cue = { type: "beatStarts", beatId: "late" };
  };

  it("leaves the condition's trigger off until the Beat's Arms trigger turns it on", () => {
    const script = scriptOf(victoryFromLate);
    expect(init(script, "ZealotDiesFromLate")).toContain("TriggerEnable(gt_ZealotDiesFromLate, false);");
    const arms = section(script, "BeatLateArms");
    expect(arms).toContain("TriggerEnable(TriggerGetCurrent(), false);");
    expect(arms).toContain("TriggerEnable(gt_ZealotDiesFromLate, true);");
    expect(section(script, "ZealotDiesFromLate")).toContain("GameOver(1, c_gameOverVictory, true, true);");
  });

  it("arms from the Beat's trigger after its scenes, and from a later Beat's if the mission skips it", () => {
    const script = scriptOf(victoryFromLate);
    const late = section(script, "BeatLate");
    const arm = "if ((TriggerIsEnabled(gt_BeatLateArms) == true)) {";
    expect(late.indexOf("gv_beat_late_started = true;")).toBeGreaterThan(late.indexOf("TriggerEnable(gt_BeatLate, false);"));
    expect(late).toContain("TriggerExecute(gt_BeatLateArms, true, false);");
    // Its scenes of Transmissions play from its Lines, run last; a Cinematic or trigger scene would play before the arming.
    expect(late.indexOf(arm)).toBeGreaterThan(late.indexOf("gv_beat_late_started = true;"));
    expect(late.indexOf(arm)).toBeLessThan(late.indexOf("TriggerExecute(gt_BeatLateLines, true, false);"));
    // Last arms Late's too, only if Late never started: Late started and still playing its scenes arms its own after them.
    const last = section(script, "BeatLast");
    expect(last).toContain("if ((TriggerIsEnabled(gt_BeatLateArms) == true) && (gv_beat_late_started == false)) {");
    expect(last.indexOf("TriggerExecute(gt_BeatLateArms, true, false);")).toBeGreaterThan(last.indexOf("TriggerEnable(gt_BeatLate, false);"));
    expect(script).not.toContain("gt_BeatLastArms");
    expect(script).not.toContain("gv_beat_last_started");
  });

  it("fires as the Beat starts when the anchor's unit is already dead", () => {
    const arms = section(scriptOf(victoryFromLate), "BeatLateArms");
    expect(arms).toContain(`if ((UnitIsAlive(${ZEALOT}) == false)) {`);
    expect(arms).toContain("TriggerExecute(gt_ZealotDiesFromLate, true, false);");
    expect(arms.indexOf("TriggerEnable(gt_ZealotDiesFromLate, true);")).toBeLessThan(arms.indexOf("TriggerExecute(gt_ZealotDiesFromLate, true, false);"));
  });

  it("fires as the Beat starts when the anchor's unit is already in the Zone", () => {
    const script = scriptOf((blueprint) => {
      blueprint.outcomes.victory = [{ type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "outpost", fromBeat: "late" }];
    });
    expect(init(script, "ZeratulReachesOutpostFromLate")).toContain("TriggerEnable(gt_ZeratulReachesOutpostFromLate, false);");
    expect(section(script, "BeatLateArms")).toContain(`if ((UnitIsAlive(${ZERATUL}) == true) && (libNtve_gf_UnitInRegion(${ZERATUL}, RegionFromId(3)) == true)) {`);
  });

  it("fires as the Beat starts when the anchor's unit is already captured, or the quota already collected", () => {
    const script = scriptOf((blueprint) => {
      blueprint.outcomes.victory = [
        { type: "anchorCaptured", anchorId: "enemy_target", fromBeat: "late" },
        { type: "resourceQuota", resource: "vespene", amount: 500, fromBeat: "last" },
      ];
    });
    expect(section(script, "BeatLateArms")).toContain(`if ((UnitGetOwner(${ZEALOT}) == 1)) {`);
    const last = section(script, "BeatLastArms");
    expect(last).toContain("if ((PlayerGetPropertyInt(1, c_playerPropVespeneCollected) >= 500)) {");
    expect(last).toContain("TriggerExecute(gt_500VespeneCollectedFromLast, true, false);");
  });

  it("keeps the same event without fromBeat on a trigger of its own, live from map start", () => {
    const script = scriptOf(victoryFromLate);
    // The objective completes on the Zealot's death whenever it comes; only the victory waits for Late.
    expect(init(script, "ZealotDies")).not.toContain("TriggerEnable(gt_ZealotDies, false);");
    expect(section(script, "ZealotDies")).toContain("ObjectiveSetState(gv_objective_kill_zealot, c_objectiveStateCompleted);");
    expect(section(script, "ZealotDies")).not.toContain("c_gameOverVictory");
    expect(section(script, "ZealotDiesFromLate")).not.toContain("ObjectiveSetState");
  });

  it("shares one trigger between a victory and an objective armed from the same Beat", () => {
    const script = scriptOf((blueprint) => {
      victoryFromLate(blueprint);
      blueprint.objectives[0].completeWhen.fromBeat = "late";
    });
    expect(script).not.toContain("gt_ZealotDies_Func");
    const armed = section(script, "ZealotDiesFromLate");
    expect(armed).toContain("ObjectiveSetState(gv_objective_kill_zealot, c_objectiveStateCompleted);");
    expect(armed).toContain("GameOver(1, c_gameOverVictory, true, true);");
  });
});

describe("fromBeat on an encounter", () => {
  it("starts on its startsWhen only once the Beat has armed it, sending the attackers at the start's unit", () => {
    const script = scriptOf((blueprint) => {
      Object.assign(blueprint.encounters[0], { fromBeat: "late", startsWhen: { type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "outpost" } });
    });
    expect(init(script, "EncounterCrossing")).toContain("TriggerEnable(gt_EncounterCrossing, false);");
    const encounter = section(script, "EncounterCrossing");
    expect(encounter).toContain(`UnitGetPosition(${ZERATUL})`);
    expect(encounter).not.toContain("EventUnit()");
    const arms = section(script, "BeatLateArms");
    expect(arms).toContain("TriggerEnable(gt_EncounterCrossing, true);");
    expect(arms).toContain(`if ((UnitIsAlive(${ZERATUL}) == true) && (libNtve_gf_UnitInRegion(${ZERATUL}, RegionFromId(3)) == true)) {`);
    expect(arms).toContain("TriggerExecute(gt_EncounterCrossing, false, false);");
  });

  it("starts on its Anchor's unit dying from a watch that keeps where it died, as the unit may be gone once a Beat arms it", () => {
    const script = scriptOf((blueprint) => {
      Object.assign(blueprint.encounters[0], { fromBeat: "late", startsWhen: { type: "anchorDies", anchorId: "enemy_target" } });
    });
    const POINT = "gv_encounters_crossing_ambush_death_point";
    // The watch is on from map start, so it keeps the place even while the encounter waits for its Beat.
    expect(init(script, "EncounterDeathCrossing")).not.toContain("TriggerEnable(gt_EncounterDeathCrossing, false);");
    expect(init(script, "EncounterDeathCrossing")).toContain(`TriggerAddEventUnitDied(gt_EncounterDeathCrossing, UnitRefFromUnit(${ZEALOT}));`);
    const watch = section(script, "EncounterDeathCrossing");
    expect(watch).toContain(`${POINT} = UnitGetPosition(EventUnit());`);
    expect(watch.indexOf("if ((TriggerIsEnabled(gt_EncounterCrossing) == true)) {")).toBeGreaterThan(watch.indexOf(POINT));
    expect(watch).toContain("TriggerExecute(gt_EncounterCrossing, true, false);");
    // The encounter has no event of its own and sends its attackers at the kept place.
    expect(init(script, "EncounterCrossing")).not.toContain("TriggerAddEvent");
    const encounter = section(script, "EncounterCrossing");
    expect(encounter).toContain(`OrderTargetingPoint(AbilityCommand("attack", 0), ${POINT})`);
    expect(encounter).not.toContain(`UnitGetPosition(${ZEALOT})`);
    expect(script).toContain(`point ${POINT};`);
    const arms = section(script, "BeatLateArms");
    expect(arms).toContain(`if ((UnitIsAlive(${ZEALOT}) == false)) {`);
    expect(arms).toContain("TriggerExecute(gt_EncounterCrossing, false, false);");
  });

  it("starts as the Beat starts if the player's units are already in its zone, sending the attackers at the first of them", () => {
    const script = scriptOf((blueprint) => {
      blueprint.encounters[0].fromBeat = "last";
    });
    const units = "UnitGroup(null, 1, RegionFromId(2), UnitFilter(0, 0, 0, (1 << (c_targetFilterDead - 32))), 0)";
    expect(section(script, "EncounterCrossing")).toContain(`UnitGetPosition(UnitGroupUnit(${units}, 1))`);
    const arms = section(script, "BeatLastArms");
    expect(arms).toContain(`if ((UnitGroupCount(${units}, c_unitCountAlive) >= 1)) {`);
    expect(arms).toContain("TriggerExecute(gt_EncounterCrossing, false, false);");
  });

  it("compiles as it always has without fromBeat", () => {
    const script = scriptOf(() => {});
    expect(init(script, "EncounterCrossing")).not.toContain("TriggerEnable(gt_EncounterCrossing, false);");
    expect(section(script, "EncounterCrossing")).toContain("UnitGetPosition(EventUnit())");
    expect(script).not.toContain("Arms");
  });
});

describe("fromBeat and the cues on its event", () => {
  it("refuses a scene cued on the event of a victory or defeat that waits for a Beat, which would end the game over it", () => {
    const blueprint = MissionBlueprintSchema.parse(blueprintWith((edit) => (edit.outcomes.victory[0].fromBeat = "late")));
    expect(() => buildMissionTriggers(blueprint)).toThrow(
      "The inline scene scene_victory is cued on anchors/enemy_target/dies, which ends the game only from Beat late (fromBeat): played apart from that, on the event at any time, it would race the game's end. Cue it on the Beat's start or on something else, or drop the fromBeat",
    );
  });
});

describe("fromBeat checks", () => {
  const issues = (edit: (blueprint: any) => void): string[] => {
    const result = MissionBlueprintSchema.safeParse(blueprintWith(edit));
    return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  };

  it("refuses a Beat that doesn't exist", () => {
    expect(issues((blueprint) => (blueprint.outcomes.victory[0].fromBeat = "nowhere"))).toEqual(["outcomes.victory.0.fromBeat: Unknown beat id: nowhere"]);
    expect(issues((blueprint) => (blueprint.encounters[0].fromBeat = "nowhere"))).toEqual(["encounters.0.fromBeat: Unknown beat id: nowhere"]);
  });

  it("refuses a Beat that never starts in the map", () => {
    expect(
      issues((blueprint) => {
        delete blueprint.beats[2].startsWhen;
        blueprint.objectives[0].completeWhen.fromBeat = "last";
      }),
    ).toEqual(["objectives.0.completeWhen.fromBeat: Beat last has no startsWhen, so it never starts in the map and this would never be armed"]);
  });

  it("refuses the first Beat, which starts with the mission", () => {
    expect(issues((blueprint) => (blueprint.outcomes.defeat[0].fromBeat = "fight"))).toEqual([
      "outcomes.defeat.0.fromBeat: Beat fight starts with the mission, so this is armed from map start anyway: drop fromBeat",
    ]);
  });

  it("refuses a timer, which counts down from mission start", () => {
    expect(issues((blueprint) => (blueprint.outcomes.victory = [{ type: "timer", seconds: 60, fromBeat: "late" }]))).toEqual([
      "outcomes.victory.0.fromBeat: A timer counts down from mission start, so it can't wait for a Beat: drop fromBeat",
    ]);
  });
});
