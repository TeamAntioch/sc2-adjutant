// Live units a trigger scene moves: the `cinematic` fixture Workspace's Radio Field plays a scene 2 of
// one line as the trigger scene `landing` when Nova reaches the field. Under black it moves Nova to a
// mark, then walks her to a second point at the second shot's cut, while two live guards walk to a
// gate and are removed there. Both paths, watched and skipped, end with Nova at the second point and
// the guards gone. The compiled map's MapScript.galaxy is read back.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENE_2 = ["", "## Scene 2: THE FIELD", "", "**NOVA** `D-01-01-02-001-NOVA`: Move out.", ""].join("\n");
const LINE = "radio_field-2-1";

const camera = (id: string, x: number, y: number) => ({
  id,
  name: id,
  zoneId: "field",
  kind: "camera",
  position: { x, y },
  cameraTarget: { x, y },
  cameraValues: [{ index: "Distance", value: 30 }],
});
const point = (id: string, x: number, y: number) => ({ id, name: id, zoneId: "field", kind: "point", position: { x, y, z: 0 } });
const unit = (id: string, x: number, y: number) => ({ id, name: id, zoneId: "field", kind: "unit", unitType: "Marine", player: 1, position: { x, y, z: 0 }, rotation: 0 });

/** Nova on her mark for a held wide, then a cut to the goal on the line, where she walks on and the guards withdraw. */
const SCENE = {
  marks: [{ unit: "nova", at: "mark", facing: 90 }],
  shots: [
    { camera: "cam-wide", afterMs: 0, pauseAfterMs: 1000 },
    {
      camera: "cam-goal",
      line: LINE,
      orders: [
        { units: ["nova"], moveTo: "beacon" },
        { units: ["guard-a", "guard-b"], moveTo: "gate", withdraw: true },
      ],
    },
  ],
};

/** Radio Field with scene 2 as the trigger scene `landing`, cued when Nova enters the field. */
async function workspace(edit: (blueprint: any, scene: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-wide", 20, 20), camera("cam-goal", 44, 40), point("mark", 40, 40), point("beacon", 44, 44), point("gate", 10, 40), unit("nova", 10, 10), unit("guard-a", 30, 30), unit("guard-b", 31, 30)];
  blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" } });
  blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 2 }];
  const scene = structuredClone(SCENE);
  edit(blueprint, scene);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  await writeFile(path.join(mission, "trigger-scenes/landing.json"), JSON.stringify(scene));
  return { root, blueprintPath };
}

async function compiled(edit?: (blueprint: any, scene: any) => void): Promise<string> {
  const { root, blueprintPath } = await workspace(edit);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return readFile(path.join(map, "MapScript.galaxy"), "utf8");
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const lines = (...statements: string[]): string => statements.map((statement) => (statement ? `    ${statement}` : "")).join("\r\n");
const NOVA = stableObjectId("nova");
const MARK = stableObjectId("mark");
const BEACON = stableObjectId("beacon");
const GATE = stableObjectId("gate");
const GUARDS = [stableObjectId("guard-a"), stableObjectId("guard-b")];

describe("a live unit moved to a mark", () => {
  it("is moved there at once and faced in Setup, under black, whether or not a Cinematic before it was skipped", async () => {
    const setup = section(await compiled(), "TriggerSceneLandingSetup");
    expect(setup.indexOf("UnitSetPosition(")).toBeGreaterThan(setup.indexOf("CinematicFade(false, 0.0"));
    // Outside the not-skipped branch, so a skip carried from a Cinematic lands it too.
    expect(setup.indexOf("UnitSetPosition(")).toBeLessThan(setup.indexOf("if ((gv_trigger_scene_landing_skipped == false))"));
  });

  it("is left alone if it's dead or gone by the scene", async () => {
    const setup = section(await compiled(), "TriggerSceneLandingSetup");
    expect(setup).toContain(
      lines(`if ((UnitIsAlive(UnitFromId(${NOVA})) == true)) {`, `    UnitSetPosition(UnitFromId(${NOVA}), PointFromId(${MARK}), false);`, `    UnitSetFacing(UnitFromId(${NOVA}), 90.0, 0.0);`, "}"),
    );
  });
});

describe("a live unit's walk during a shot", () => {
  it("is ordered at the shot's cut, before its line", async () => {
    const cinematic = section(await compiled(), "TriggerSceneLandingCinematic");
    const walk = `UnitIssueOrder(UnitFromId(${NOVA}), OrderTargetingPoint(AbilityCommand("move", 0), PointFromId(${BEACON})), c_orderQueueReplace);`;
    expect(cinematic).toContain(lines(`CameraApplyInfo(1, CameraInfoFromId(${stableObjectId("cam-goal")}), 0.0, -1, 10.0, true);`, walk));
    expect(cinematic.indexOf(walk)).toBeLessThan(cinematic.indexOf("TransmissionSendForPlayerSelect("));
  });

  it("lands a hidden live unit before the Cleanup shows it again", async () => {
    const cleanup = section(
      await compiled((_blueprint, scene) => {
        scene.live = [{ unit: "nova", hide: true }];
      }),
      "TriggerSceneLandingCleanup",
    );
    expect(cleanup.indexOf(`UnitSetPosition(UnitFromId(${NOVA})`)).toBeLessThan(cleanup.indexOf("libNtve_gf_ShowHideUnit("));
  });

  it("ends where it was going on both paths: Cleanup puts the unit there at once, under black", async () => {
    const cleanup = section(await compiled(), "TriggerSceneLandingCleanup");
    const land = lines(`if ((UnitIsAlive(UnitFromId(${NOVA})) == true)) {`, `    UnitSetPosition(UnitFromId(${NOVA}), PointFromId(${BEACON}), false);`, "}");
    expect(cleanup).toContain(land);
    // On no branch of the handback.
    expect(cleanup.indexOf(land)).toBeLessThan(cleanup.indexOf("if ((gv_trigger_scene_landing_completed == true))"));
  });

  it("lands several units sent to one place round it, a cell or more apart, rather than on one another", async () => {
    const cleanup = section(
      await compiled((_blueprint, scene) => {
        scene.shots[1].orders[1] = { units: ["guard-a", "guard-b"], moveTo: "beacon" };
      }),
      "TriggerSceneLandingCleanup",
    );
    const [a, b] = GUARDS;
    for (const [unit, angle] of [[NOVA, "0.0"], [a, "120.0"], [b, "240.0"]] as const) {
      expect(cleanup).toContain(`UnitSetPosition(UnitFromId(${unit}), PointWithOffsetPolar(PointFromId(${BEACON}), 1.0, ${angle}), false);`);
    }
  });
});

describe("units that withdraw", () => {
  const GROUP = "gv_trigger_scene_landing_withdraw_2_2";
  const ARRIVAL = "gt_TriggerSceneLandingWithdrawShot2Order2";

  it("walk to their point at the shot's cut, held in the order's group", async () => {
    const cinematic = section(await compiled(), "TriggerSceneLandingCinematic");
    for (const guard of GUARDS) {
      expect(cinematic).toContain(lines(`UnitGroupAdd(${GROUP}, UnitFromId(${guard}));`, `UnitIssueOrder(UnitFromId(${guard}), OrderTargetingPoint(AbilityCommand("move", 0), PointFromId(${GATE})), c_orderQueueReplace);`));
    }
    expect(cinematic.indexOf(`TriggerEnable(${ARRIVAL}, true);`)).toBeLessThan(cinematic.indexOf(`UnitGroupAdd(${GROUP}`));
  });

  it("are removed as each reaches it", async () => {
    const script = await compiled();
    const init = script.slice(script.indexOf(`void ${ARRIVAL}_Init`));
    expect(init).toContain(`TriggerEnable(${ARRIVAL}, false);`);
    expect(init).toContain(`TriggerAddEventUnitRangePoint(${ARRIVAL}, null, PointFromId(${GATE}), 2.0, true);`);
    const arrival = section(script, ARRIVAL.slice(3));
    expect(arrival).toContain(`if (!((UnitGroupHasUnit(${GROUP}, EventUnit()) == true))) {`);
    expect(arrival).toContain(lines("UnitRemove(EventUnit());"));
  });

  it("can be a staged unit's group, held from it and removed in the Cleanup with the cast", async () => {
    const script = await compiled((_blueprint, scene) => {
      scene.cast = [{ id: "squad", unitType: "Marine", player: 2, count: 2, at: "gate" }];
      scene.shots[1].orders[1] = { cast: "squad", moveTo: "mark", withdraw: true };
    });
    expect(section(script, "TriggerSceneLandingCinematic")).toContain(lines(`TriggerEnable(${ARRIVAL}, true);`, `UnitGroupAddUnitGroup(${GROUP}, gv_trigger_scene_landing_cast_squad);`));
    expect(script).toContain(`TriggerAddEventUnitRangePoint(${ARRIVAL}, null, PointFromId(${MARK}), 2.0, true);`);
    expect(section(script, "TriggerSceneLandingCleanup")).toMatch(/(auto\w+)_g = gv_trigger_scene_landing_cast_squad;[\s\S]*?UnitRemove\(\1_var\);/);
  });

  it("are gone on both paths: Cleanup removes any still walking, or never ordered, under black", async () => {
    const cleanup = section(await compiled(), "TriggerSceneLandingCleanup");
    for (const guard of GUARDS) {
      expect(cleanup).toContain(lines(`if ((UnitIsAlive(UnitFromId(${guard})) == true)) {`, `    UnitRemove(UnitFromId(${guard}));`, "}"));
      expect(cleanup).not.toContain(`UnitSetPosition(UnitFromId(${guard})`);
    }
    expect(cleanup).toContain(lines(`TriggerEnable(${ARRIVAL}, false);`, `UnitGroupClear(${GROUP});`));
    expect(cleanup.indexOf("UnitRemove(")).toBeLessThan(cleanup.indexOf("if ((gv_trigger_scene_landing_completed == true))"));
  });
});

describe("an order atMs into its shot", () => {
  const delayed = (_blueprint: any, scene: any): void => {
    scene.shots[1].orders[0].atMs = 1200;
  };
  const LATER = "gt_TriggerSceneLandingOrderShot2Order1";

  it("is given that long after the cut, beside the shot's lines, while the scene still plays", async () => {
    const script = await compiled(delayed);
    const cinematic = section(script, "TriggerSceneLandingCinematic");
    expect(cinematic).toContain(lines(`CameraApplyInfo(1, CameraInfoFromId(${stableObjectId("cam-goal")}), 0.0, -1, 10.0, true);`, `TriggerExecute(${LATER}, true, false);`));
    expect(cinematic).not.toContain(`UnitIssueOrder(UnitFromId(${NOVA})`);
    // A skip ends only the Cinematic's waits, so the order checks the scene hasn't been cleaned up.
    expect(section(script, LATER.slice(3))).toContain(
      lines("Wait(1.2, c_timeReal);", "if ((gv_trigger_scene_landing_playing == true)) {", `    UnitIssueOrder(UnitFromId(${NOVA}), OrderTargetingPoint(AbilityCommand("move", 0), PointFromId(${BEACON})), c_orderQueueReplace);`, "}"),
    );
    const setup = section(script, "TriggerSceneLandingSetup");
    expect(setup.indexOf("gv_trigger_scene_landing_playing = true;")).toBeGreaterThan(setup.indexOf("if ((gv_trigger_scene_landing_skipped == false))"));
    expect(setup.indexOf("gv_trigger_scene_landing_playing = true;")).toBeLessThan(setup.indexOf("TriggerExecute(gt_TriggerSceneLandingCinematic"));
    // Cleared as the Cinematic ends, watched or skipped, so nothing starts during the fade out after a skip.
    const end = section(script, "TriggerSceneLandingCinematicEnd");
    expect(end.indexOf("gv_trigger_scene_landing_playing = false;")).toBeGreaterThan(-1);
    expect(end.indexOf("gv_trigger_scene_landing_playing = false;")).toBeLessThan(end.indexOf("CinematicFade("));
    const cleanup = section(script, "TriggerSceneLandingCleanup");
    // And the Cleanup still lands it, given or not.
    expect(cleanup).toContain(`UnitSetPosition(UnitFromId(${NOVA}), PointFromId(${BEACON}), false);`);
  });

  it("adds nothing to a scene whose orders are all at the cut", async () => {
    expect(await compiled()).not.toContain("gv_trigger_scene_landing_playing");
  });
});

describe("marks, walks and withdrawals, checked", () => {
  const messages = async (edit: (blueprint: any, scene: any) => void): Promise<string[]> => {
    const { root } = await workspace(edit);
    const { problems } = await checkWorkspace(root);
    // The trigger scene's own, not the fixture Cinematic's, and not the cinematography checks'
    // findings on its framing and timing (trigger-scene-checks.test.ts covers those).
    return problems.filter((problem) => problem.file.includes("trigger-scenes") && !/^(C[1-9]|T[34]|H3|O2): /.test(problem.message)).map((problem) => `${problem.path ?? ""}: ${problem.message}`);
  };

  it("reports a mark on a unit that isn't a unit Anchor, a mark that isn't a point, and a unit marked twice", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.marks = [
        { unit: "mark", at: "beacon" },
        { unit: "nova", at: "cam-wide" },
        { unit: "nova", at: "beacon" },
      ];
    });
    expect(found).toContain("marks.0.unit: mark is a point Anchor, not a unit");
    expect(found).toContain("marks.1.at: cam-wide is a camera Anchor, not a point");
    expect(found).toContain("marks.2.unit: nova has a mark already");
  });

  it("reports an order to a unit that isn't a unit Anchor, or that the scene pauses", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.live = [{ unit: "nova", pause: true }];
      scene.shots[1].orders[1].units = ["guard-a", "gate"];
    });
    expect(found).toContain("shots.1.orders.1.units.1: gate is a point Anchor, not a unit");
    expect(found).toContain("shots.1.orders.0.units.0: nova is paused for the scene (live), so it can't walk");
  });

  it("reports an order to a unit after it withdraws", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots.push({ camera: "cam-wide", afterMs: 0, orders: [{ units: ["guard-b"], moveTo: "beacon" }] });
    });
    expect(found).toContain("shots.2.orders.0.units.0: guard-b has withdrawn by then (shots.1.orders.1)");
  });

  it("reports a staged unit's group ordered after it withdraws, and a unit given twice in one order", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.cast = [{ id: "squad", unitType: "Marine", player: 2, at: "gate" }];
      scene.shots[1].orders = [{ cast: "squad", moveTo: "mark", withdraw: true }, { units: ["nova", "nova"], moveTo: "beacon" }];
      scene.shots.push({ camera: "cam-wide", afterMs: 0, orders: [{ cast: "squad", moveTo: "beacon" }] });
    });
    expect(found).toContain("shots.2.orders.0.cast: squad has withdrawn by then (shots.1.orders.0)");
    expect(found).toContain("shots.1.orders.1.units.1: nova is in this order twice");
  });

  it("reports an order atMs at or past its shot's end, which the next shot's orders would overtake, and the compile refuses it", async () => {
    const late = (_blueprint: any, scene: any): void => {
      scene.shots[0].orders = [{ units: ["nova"], moveTo: "beacon", atMs: 99000 }];
    };
    expect(await messages(late)).toEqual([expect.stringMatching(/^shots\.0\.orders\.0\.atMs: 99000 ms into the shot is at or past its end, at \d+ ms; give the order in the shot it falls in$/)]);
    await expect(compiled(late)).rejects.toThrow(/shots\.0\.orders\.0\.atMs: 99000 ms into the shot is at or past its end/);
    expect(await messages((_blueprint, scene) => (scene.shots[0].orders = [{ units: ["nova"], moveTo: "beacon", atMs: 500 }]))).toEqual([]);
  });

  it("reports an order to both a staged unit and live units, or to neither", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].orders = [{ cast: "squad", units: ["nova"], moveTo: "beacon" }, { moveTo: "beacon" }];
    });
    expect(found).toContain("shots.1.orders.0: An order is to a staged unit (cast), live units (units) or a player's units in a Zone (player and inZone): give one");
    expect(found).toContain("shots.1.orders.1: An order is to a staged unit (cast), live units (units) or a player's units in a Zone (player and inZone): give one");
  });

  it("passes the fixture scene", async () => {
    expect(await messages(() => {})).toEqual([]);
  });
});
