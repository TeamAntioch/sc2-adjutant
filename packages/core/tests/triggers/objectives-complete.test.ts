// An objectivesComplete condition: holds once Objectives (all, or `count`) are Completed, as a Beat's
// start, a victory or a cue. The `trigger-test` fixture with three Objectives (each completed on
// Zeratul reaching a Zone, or a Zealot dying), its MapScript read back.
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";

const raw = JSON.parse(await readFile(new URL("../fixtures/trigger-test/blueprint.json", import.meta.url), "utf8"));

const ALL = ["kill_zealot", "reach_crossing", "reach_outpost"];

/** The fixture with Objectives and a Beat "breakout", edited. */
function blueprintWith(edit: (blueprint: any) => void = () => {}): any {
  const blueprint = structuredClone(raw);
  blueprint.objectives.push(
    { id: "reach_crossing", title: "Reach the crossing", description: "Cross.", type: "primary", beatId: "fight", completeWhen: { type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "crossing" } },
    { id: "reach_outpost", title: "Reach the outpost", description: "Arrive.", type: "primary", beatId: "fight", completeWhen: { type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "outpost" } },
  );
  blueprint.beats.push({ id: "breakout", title: "Breakout", summary: "All three done.", startsWhen: [{ type: "objectivesComplete", objectiveIds: ALL }] });
  blueprint.outcomes.victory = [{ type: "objectivesComplete", objectiveIds: ALL }];
  edit(blueprint);
  return blueprint;
}

const parse = (edit?: (blueprint: any) => void) => MissionBlueprintSchema.parse(blueprintWith(edit));
const scriptOf = (edit?: (blueprint: any) => void): string => {
  const blueprint = parse(edit);
  return writeMapScript({ mapName: blueprint.title, triggers: buildMissionTriggers(blueprint) });
};
const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const messages = (edit: (blueprint: any) => void): string[] => {
  const result = MissionBlueprintSchema.safeParse(blueprintWith(edit));
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("the schema", () => {
  it("takes the condition on a Beat start, a victory and a cue", () => {
    expect(messages(() => {})).toEqual([]);
    expect(messages((blueprint) => (blueprint.screenplay.scenes[2].cue = { type: "objectivesComplete", objectiveIds: ALL, count: 2 }))).toEqual([]);
  });

  it("refuses an unknown Objective, one nothing completes, a repeat and a count past the Objectives", () => {
    expect(messages((blueprint) => (blueprint.outcomes.victory = [{ type: "objectivesComplete", objectiveIds: ["nope"] }]))[0]).toMatch(/^outcomes\.victory\.0\.objectiveIds\.0: Unknown objective id: nope/);
    expect(messages((blueprint) => delete blueprint.objectives[1].completeWhen).join("\n")).toContain("Objective reach_crossing has no completeWhen");
    expect(messages((blueprint) => (blueprint.outcomes.victory = [{ type: "objectivesComplete", objectiveIds: ["kill_zealot", "kill_zealot"] }]))[0]).toContain("Duplicate objective id: kill_zealot");
    expect(messages((blueprint) => (blueprint.outcomes.victory = [{ type: "objectivesComplete", objectiveIds: ALL, count: 4 }]))[0]).toMatch(/count: count 4 is more than the 3 objectives/);
  });

  it("refuses a fromBeat on it, and it as an Objective's own completeWhen", () => {
    expect(messages((blueprint) => (blueprint.outcomes.victory = [{ type: "objectivesComplete", objectiveIds: ALL, fromBeat: "breakout" }]))[0]).toContain("takes no fromBeat");
    expect(messages((blueprint) => (blueprint.objectives[0].completeWhen = { type: "objectivesComplete", objectiveIds: ["reach_outpost"] }))[0]).toContain("would complete on other objectives completing");
  });
});

describe("the compile", () => {
  it("counts each Objective's first completion, then runs the condition's trigger", () => {
    const script = scriptOf();
    const crossing = section(script, "ZeratulReachesCrossing");

    expect(crossing).toContain("ObjectiveSetState(gv_objective_reach_crossing, c_objectiveStateCompleted);");
    expect(crossing).toContain("if ((gv_done_objective_reach_crossing == false)) {");
    expect(crossing).toContain("gv_done_objective_reach_crossing = true;");
    expect(crossing).toContain("gv_objectives_complete_1_count = (gv_objectives_complete_1_count + 1);");
    expect(crossing).toContain("TriggerExecute(gt_AllOfKillZealotReachCrossingReachOutpostComplete, true, false);");
  });

  it("holds only at the count, which the last of the three brings, with no event of its own", () => {
    const script = scriptOf();
    const all = section(script, "AllOfKillZealotReachCrossingReachOutpostComplete");

    expect(all).toContain("gv_objectives_complete_1_count == 3");
    expect(all).toContain("GameOver(1, c_gameOverVictory, true, true);");
    expect(script).not.toContain("TriggerAddEvent(gt_AllOfKillZealotReachCrossingReachOutpostComplete");
    // Victory and the Beat start are the one trigger's.
    expect(all).toContain("TriggerExecute(gt_BeatBreakout, true, false);");
  });

  it("starts the Beat from the condition, not by an event of its own", () => {
    const triggers = buildMissionTriggers(parse());
    expect(triggers.triggers.find((trigger) => trigger.name === "Beat - Breakout")!.events).toEqual([]);
  });

  it("counts for a count of two, and a cue plays a scene at each count", () => {
    const script = scriptOf((blueprint) => {
      blueprint.screenplay.scenes[2].cue = { type: "objectivesComplete", objectiveIds: ALL, count: 2 };
    });
    const two = section(script, "2OfKillZealotReachCrossingReachOutpostComplete");

    expect(two).toContain("gv_objectives_complete_2_count == 2");
    expect(two).toContain("TransmissionSend");
    expect(two).not.toContain("GameOver");
    // The three-of-three condition keeps its own count.
    expect(script).toContain("gv_objectives_complete_1_count");
  });

  it("is one condition however the Objectives are ordered", () => {
    const script = scriptOf((blueprint) => {
      blueprint.screenplay.scenes[2].cue = { type: "objectivesComplete", objectiveIds: [...ALL].reverse() };
    });
    expect(script).not.toContain("gv_objectives_complete_2_count");
  });
});

describe("exactly", () => {
  const exactly = (blueprint: any) => (blueprint.screenplay.scenes[2].cue = { type: "objectivesComplete", objectiveIds: ["kill_zealot", "reach_crossing"], exactly: true });

  it("is refused with a count", () => {
    expect(messages((blueprint) => (blueprint.screenplay.scenes[2].cue = { type: "objectivesComplete", objectiveIds: ALL, exactly: true, count: 2 }))[0]).toContain("takes no count");
  });

  it("holds when the last of the named completes with every other not done, and is run by the named ones only", () => {
    const script = scriptOf(exactly);
    const only = section(script, "ExactlyKillZealotReachCrossingComplete");

    expect(only).toContain("gv_done_objective_kill_zealot == true");
    expect(only).toContain("gv_done_objective_reach_crossing == true");
    expect(only).toContain("gv_done_objective_reach_outpost == false");
    expect(only).toContain("TransmissionSend");
    // The Objective outside the set still records it is done, and runs nothing of this one's.
    const outpost = section(script, "ZeratulReachesOutpost");
    expect(outpost).toContain("gv_done_objective_reach_outpost = true;");
    expect(outpost).not.toContain("gt_ExactlyKillZealotReachCrossingComplete");
    expect(section(script, "ZeratulReachesCrossing")).toContain("TriggerExecute(gt_ExactlyKillZealotReachCrossingComplete, true, false);");
  });
});

