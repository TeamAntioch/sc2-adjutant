// An order to a player's units in a Zone: the `cinematic` fixture Workspace's Radio Field plays a
// scene 2 of one line as the trigger scene `landing` when Nova reaches the field. On the line, player
// 2's units in the field (their non-structures, gathered at the order) walk to a gate and are removed
// there. Both paths, watched and skipped, end with them gone: on a skip, Cleanup takes those in the
// field as the scene ends. The compiled map's MapScript.galaxy is read back.
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
const unit = (id: string, x: number, y: number, player = 1) => ({ id, name: id, zoneId: "field", kind: "unit", unitType: "Marine", player, position: { x, y, z: 0 }, rotation: 0 });

/** A held wide, then a cut on the line where player 2's units in the field withdraw through the gate. */
const SCENE = {
  shots: [
    { camera: "cam-wide", afterMs: 0, pauseAfterMs: 1000 },
    { camera: "cam-goal", line: LINE, orders: [{ player: 2, inZone: "field", moveTo: "gate", withdraw: true }] },
  ],
};

/** Radio Field with scene 2 as the trigger scene `landing`, cued when Nova enters the field. */
async function workspace(edit: (blueprint: any, scene: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-wide", 20, 20), camera("cam-goal", 44, 40), point("beacon", 44, 44), point("gate", 10, 40), unit("nova", 10, 10), unit("raider", 30, 30, 2)];
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
const GATE = stableObjectId("gate");
const BEACON = stableObjectId("beacon");
const GROUP = "gv_trigger_scene_landing_withdraw_2_1";
const DONE = "gv_trigger_scene_landing_zone_ordered_2_1";
const ARRIVAL = "gt_TriggerSceneLandingWithdrawShot2Order1";
/** Player 2's units in the field (its compiled region) that aren't structures, as a warp-out of their army gathers them. */
const IN_FIELD = "UnitGroup(null, 2, RegionFromId(1), UnitFilter(0, 0, (1 << c_targetFilterStructure), (1 << (c_targetFilterDead - 32))), 0)";
/** Each unit of a group, picked in turn, walked to a point Anchor. */
const eachWalks = (held: string, to: number): RegExp =>
  new RegExp(`(auto\\w+)_g = ${held};[\\s\\S]*?UnitIssueOrder\\(\\1_var, OrderTargetingPoint\\(AbilityCommand\\("move", 0\\), PointFromId\\(${to}\\)\\), c_orderQueueReplace\\);`);

describe("an order to a player's units in a Zone", () => {
  it("gathers their non-structures in the Zone at the shot's cut, held in the order's group, and walks each to the place", async () => {
    const cinematic = section(await compiled(), "TriggerSceneLandingCinematic");
    expect(cinematic).toContain(lines(`TriggerEnable(${ARRIVAL}, true);`, `UnitGroupAddUnitGroup(${GROUP}, ${IN_FIELD});`, `${DONE} = true;`));
    expect(cinematic).toMatch(eachWalks(GROUP, GATE));
    expect(cinematic.indexOf(`UnitGroupAddUnitGroup(${GROUP}`)).toBeLessThan(cinematic.indexOf("TransmissionSendForPlayerSelect("));
  });
});

describe("a Zone's units that withdraw", () => {
  it("are removed as each reaches the place", async () => {
    const script = await compiled();
    expect(script).toContain(`TriggerAddEventUnitRangePoint(${ARRIVAL}, null, PointFromId(${GATE}), 2.0, true);`);
    const arrival = section(script, ARRIVAL.slice(3));
    expect(arrival).toContain(`if (!((UnitGroupHasUnit(${GROUP}, EventUnit()) == true))) {`);
    expect(arrival).toContain(lines("UnitRemove(EventUnit());"));
  });

  it("are gone on both paths: on a skip before the order, Cleanup gathers those in the Zone as the scene ends, and removes every one, under black", async () => {
    const cleanup = section(await compiled(), "TriggerSceneLandingCleanup");
    const gather = lines(`if ((${DONE} == false)) {`, `    UnitGroupAddUnitGroup(${GROUP}, ${IN_FIELD});`, `    ${DONE} = true;`, "}");
    expect(cleanup).toContain(gather);
    expect(cleanup).toMatch(new RegExp(`(auto\\w+)_g = ${GROUP};[\\s\\S]*?UnitRemove\\(\\1_var\\);`));
    expect(cleanup).toContain(lines(`TriggerEnable(${ARRIVAL}, false);`));
    // Gathered before the removal, the group cleared after it, and on no branch of the handback.
    expect(cleanup.indexOf(gather)).toBeLessThan(cleanup.indexOf(`_g = ${GROUP};`));
    expect(cleanup.indexOf(`UnitGroupClear(${GROUP});`)).toBeGreaterThan(cleanup.indexOf(`_g = ${GROUP};`));
    expect(cleanup.indexOf("UnitRemove(")).toBeLessThan(cleanup.indexOf("if ((gv_trigger_scene_landing_completed == true))"));
  });

  it("are gathered after the Cleanup has put in place what the scene did before the order: units landed, warped in or given to the player", async () => {
    const cleanup = section(
      await compiled((_blueprint, scene) => {
        scene.shots[0].orders = [{ units: ["nova"], moveTo: "beacon" }];
        scene.shots[0].warpIns = [{ id: "zealots", unitType: "Zealot", player: 2, count: 2, at: "beacon" }];
        scene.shots[0].unitChanges = [{ unit: "nova", owner: 2 }];
      }),
      "TriggerSceneLandingCleanup",
    );
    const gather = cleanup.indexOf(`UnitGroupAddUnitGroup(${GROUP}, ${IN_FIELD});`);
    expect(gather).toBeGreaterThan(cleanup.indexOf(`UnitSetPosition(UnitFromId(${stableObjectId("nova")})`));
    expect(gather).toBeGreaterThan(cleanup.indexOf("gv_trigger_scene_landing_warped_in_zealots = true;"));
    expect(gather).toBeGreaterThan(cleanup.indexOf(`UnitSetOwner(UnitFromId(${stableObjectId("nova")}), 2, true);`));
  });

  it("leave what the scene brings into the Zone after the order, units warped in or given to the player, to stay on both paths: the Zone settles at its own moment, before them", async () => {
    const cleanup = section(
      await compiled((_blueprint, scene) => {
        scene.shots[1].warpIns = [{ id: "zealots", unitType: "Zealot", player: 2, at: "beacon", atMs: 500 }];
        scene.shots[1].unitChanges = [{ unit: "nova", owner: 2 }];
      }),
      "TriggerSceneLandingCleanup",
    );
    const gone = cleanup.indexOf(`_g = ${GROUP};`);
    expect(cleanup.indexOf(`UnitGroupAddUnitGroup(${GROUP}, ${IN_FIELD});`)).toBeLessThan(gone);
    expect(gone).toBeLessThan(cleanup.indexOf("gv_trigger_scene_landing_warped_in_zealots = true;"));
    expect(gone).toBeLessThan(cleanup.indexOf(`UnitSetOwner(UnitFromId(${stableObjectId("nova")}), 2, true);`));
  });

  it("take a unit the order took though a later change gives it away, on a skip as watched", async () => {
    const cleanup = section(
      await compiled((_blueprint, scene) => {
        scene.shots[1].unitChanges = [{ unit: "raider", owner: 1, atMs: 500 }];
      }),
      "TriggerSceneLandingCleanup",
    );
    expect(cleanup.indexOf(`UnitGroupAddUnitGroup(${GROUP}, ${IN_FIELD});`)).toBeGreaterThan(-1);
    expect(cleanup.indexOf(`UnitGroupAddUnitGroup(${GROUP}, ${IN_FIELD});`)).toBeLessThan(cleanup.indexOf(`UnitSetOwner(UnitFromId(${stableObjectId("raider")}), 1, true);`));
  });

  it("remove at the order those already at the place, which never enter its range", async () => {
    const cinematic = section(await compiled(), "TriggerSceneLandingCinematic");
    const near = `UnitGroup(null, 2, RegionCircle(PointFromId(${GATE}), 2.0),`;
    expect(cinematic).toContain(near);
    expect(cinematic).toMatch(new RegExp(`(auto\\w+)_g = UnitGroup\\(null, 2, RegionCircle\\(PointFromId\\(${GATE}\\), 2\\.0\\)[\\s\\S]*?if \\(\\(UnitGroupHasUnit\\(${GROUP}, \\1_var\\) == true\\)\\) \\{\\s*UnitRemove\\(\\1_var\\);`));
    expect(cinematic.indexOf(near)).toBeGreaterThan(cinematic.indexOf(`UnitGroupAddUnitGroup(${GROUP}, ${IN_FIELD});`));
  });

  it("let a later order take a unit out of their withdrawal, watched as on a skip, so it isn't removed on its new way", async () => {
    const script = await compiled((_blueprint, scene) => {
      scene.shots[1].orders.push({ units: ["raider"], moveTo: "beacon", atMs: 500 }, { player: 2, inZone: "field", moveTo: "beacon", atMs: 600 });
    });
    const unitsOrder = section(script, "TriggerSceneLandingOrderShot2Order2");
    expect(unitsOrder).toContain(`UnitGroupRemove(${GROUP}, UnitFromId(${stableObjectId("raider")}));`);
    const zoneOrder = section(script, "TriggerSceneLandingOrderShot2Order3");
    const gathered = zoneOrder.indexOf("UnitGroupAddUnitGroup(gv_trigger_scene_landing_zone_order_2_3,");
    expect(gathered).toBeGreaterThan(-1);
    expect(zoneOrder.indexOf(`UnitGroupRemoveUnitGroup(${GROUP}, gv_trigger_scene_landing_zone_order_2_3);`)).toBeGreaterThan(gathered);
  });

  it("leave out the staged cast of the player's, which goes by its own withdraw or the Cleanup", async () => {
    const cinematic = section(
      await compiled((_blueprint, scene) => {
        scene.cast = [{ id: "relay", unitType: "Marine", player: 2, at: "beacon" }];
      }),
      "TriggerSceneLandingCinematic",
    );
    expect(cinematic).toContain(lines(`UnitGroupAddUnitGroup(${GROUP}, ${IN_FIELD});`, `UnitGroupRemoveUnitGroup(${GROUP}, gv_trigger_scene_landing_cast_relay);`));
  });

  it("are gathered afresh each run: Setup marks the Zone ungathered", async () => {
    const setup = section(await compiled(), "TriggerSceneLandingSetup");
    expect(setup.indexOf(`${DONE} = false;`)).toBeGreaterThan(-1);
    expect(setup.indexOf(`${DONE} = false;`)).toBeLessThan(setup.indexOf("if ((gv_trigger_scene_landing_skipped == false))"));
  });
});

describe("a Zone's units that walk on", () => {
  const OWN = "gv_trigger_scene_landing_zone_order_2_1";
  const walkOn = (_blueprint: any, scene: any): void => {
    delete scene.shots[1].orders[0].withdraw;
    scene.shots[1].orders[0].moveTo = "beacon";
  };

  it("are held in a group of the order's own and walked there", async () => {
    const script = await compiled(walkOn);
    const cinematic = section(script, "TriggerSceneLandingCinematic");
    expect(cinematic).toContain(lines(`UnitGroupAddUnitGroup(${OWN}, ${IN_FIELD});`, `${DONE} = true;`));
    expect(cinematic).toMatch(eachWalks(OWN, BEACON));
    expect(script).not.toContain(ARRIVAL);
  });

  it("end where they were going on both paths: Cleanup lands each there at once, a little further round a spiral than the one before", async () => {
    const cleanup = section(await compiled(walkOn), "TriggerSceneLandingCleanup");
    expect(cleanup).toContain(lines("gv_trigger_scene_landing_landing_distance = 1.0;", "gv_trigger_scene_landing_landing_angle = 0.0;"));
    expect(cleanup).toMatch(
      new RegExp(
        `(auto\\w+)_g = ${OWN};[\\s\\S]*?` +
          `UnitSetPosition\\(\\1_var, PointWithOffsetPolar\\(PointFromId\\(${BEACON}\\), gv_trigger_scene_landing_landing_distance, gv_trigger_scene_landing_landing_angle\\), false\\);\\s*` +
          `UnitIssueOrder\\([^;]*;\\s*` +
          `gv_trigger_scene_landing_landing_angle = \\(gv_trigger_scene_landing_landing_angle \\+ 137\\.5\\);\\s*` +
          `gv_trigger_scene_landing_landing_distance = \\(gv_trigger_scene_landing_landing_distance \\+ 0\\.2\\);`,
      ),
    );
    expect(cleanup).toContain(`UnitGroupClear(${OWN});`);
    expect(cleanup).not.toMatch(new RegExp(`_g = ${OWN};[\\s\\S]*?UnitRemove\\(`));
  });

  it("stop walking once landed, so none heads back to the place after the handback", async () => {
    const cleanup = section(await compiled(walkOn), "TriggerSceneLandingCleanup");
    expect(cleanup).toMatch(
      new RegExp(
        `(auto\\w+)_g = ${OWN};[\\s\\S]*?UnitSetPosition\\(\\1_var, [^;]*;\\s*` +
          `UnitIssueOrder\\(\\1_var, OrderTargetingPoint\\(AbilityCommand\\("move", 0\\), UnitGetPosition\\(\\1_var\\)\\), c_orderQueueReplace\\);`,
      ),
    );
  });

  it("carry on one spiral with every other Zone order to the same place, so none lands where another did", async () => {
    const cleanup = section(
      await compiled((blueprint, scene) => {
        walkOn(blueprint, scene);
        scene.shots[1].orders.push({ player: 3, inZone: "field", moveTo: "beacon", atMs: 500 }, { player: 4, inZone: "field", moveTo: "gate", atMs: 600 });
      }),
      "TriggerSceneLandingCleanup",
    );
    expect(cleanup.split("gv_trigger_scene_landing_landing_distance = 1.0;").length - 1).toBe(1);
    expect(cleanup).toMatch(/(auto\w+)_g = gv_trigger_scene_landing_zone_order_2_2;[\s\S]*?PointWithOffsetPolar\(PointFromId\(\d+\), gv_trigger_scene_landing_landing_distance, gv_trigger_scene_landing_landing_angle\)/);
    // The gate's own spiral, from its own start.
    expect(cleanup).toContain(lines("gv_trigger_scene_landing_landing_distance_2 = 1.0;", "gv_trigger_scene_landing_landing_angle_2 = 0.0;"));
  });

  it("settle in the order they're given, by atMs, not as listed", async () => {
    const cleanup = section(
      await compiled((blueprint, scene) => {
        walkOn(blueprint, scene);
        scene.shots[1].orders[0].atMs = 500;
        scene.shots[1].orders.push({ player: 2, inZone: "field", moveTo: "gate" });
      }),
      "TriggerSceneLandingCleanup",
    );
    const first = cleanup.indexOf("if ((gv_trigger_scene_landing_zone_ordered_2_2 == false)) {");
    const second = cleanup.indexOf("if ((gv_trigger_scene_landing_zone_ordered_2_1 == false)) {");
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
    // The earlier one leaves out what the later one takes, not the other way round.
    expect(cleanup).toContain(`UnitGroupRemoveUnitGroup(gv_trigger_scene_landing_zone_order_2_2, ${OWN});`);
    expect(cleanup).not.toContain(`UnitGroupRemoveUnitGroup(${OWN}, gv_trigger_scene_landing_zone_order_2_2);`);
  });

  it("start their spiral outside the ring of live units landing at the same place", async () => {
    const cleanup = section(
      await compiled((blueprint, scene) => {
        walkOn(blueprint, scene);
        blueprint.anchors.push(unit("guard-a", 30, 30), unit("guard-b", 31, 30), unit("guard-c", 32, 30), unit("guard-d", 33, 30), unit("guard-e", 34, 30), unit("guard-f", 35, 30), unit("guard-g", 36, 30));
        scene.shots[0].orders = [{ units: ["guard-a", "guard-b", "guard-c", "guard-d", "guard-e", "guard-f", "guard-g"], moveTo: "beacon" }];
      }),
      "TriggerSceneLandingCleanup",
    );
    // Seven round a ring of 7/2π ≈ 1.11 cells, so the spiral starts a cell beyond it.
    expect(cleanup).toContain("gv_trigger_scene_landing_landing_distance = 2.11;");
  });

  it("leave each unit a later order takes to that order, so it ends where its last order sends it", async () => {
    const cleanup = section(
      await compiled((blueprint, scene) => {
        walkOn(blueprint, scene);
        scene.shots[1].orders.push({ units: ["nova"], moveTo: "gate" }, { player: 2, inZone: "field", moveTo: "gate", atMs: 500 });
      }),
      "TriggerSceneLandingCleanup",
    );
    const LATER = "gv_trigger_scene_landing_zone_order_2_3";
    expect(cleanup).toContain(lines(`UnitGroupRemoveUnitGroup(${OWN}, ${LATER});`, `UnitGroupRemove(${OWN}, UnitFromId(${stableObjectId("nova")}));`));
    expect(cleanup.indexOf(`UnitGroupRemoveUnitGroup(${OWN}`)).toBeLessThan(cleanup.indexOf(`_g = ${OWN};`));
    expect(cleanup).not.toContain(`UnitGroupRemoveUnitGroup(${LATER}, ${OWN});`);
  });
});

describe("an order to a player's units in a Zone, checked", () => {
  const messages = async (edit: (blueprint: any, scene: any) => void): Promise<string[]> => {
    const { root } = await workspace(edit);
    const { problems } = await checkWorkspace(root);
    // The trigger scene's own, not the cinematography checks' findings on its framing and timing.
    return problems.filter((problem) => problem.file.includes("trigger-scenes") && !/^(C[1-9]|T[34]|H3|O2): /.test(problem.message)).map((problem) => `${problem.path ?? ""}: ${problem.message}`);
  };

  it("reports a Zone the Blueprint hasn't, and a Kept object that isn't a region", async () => {
    const found = await messages((blueprint, scene) => {
      blueprint.kept = [...(blueprint.kept ?? []), { id: "kept-unit", kind: "unit", name: "Kept Unit", editorId: 9 }];
      scene.shots[1].orders.push({ player: 2, inZone: "nowhere", moveTo: "gate" }, { player: 2, inZone: "kept-unit", moveTo: "gate" });
    });
    expect(found).toContain("shots.1.orders.1.inZone: No Zone nowhere in the Blueprint");
    expect(found).toContain("shots.1.orders.2.inZone: kept-unit is a Kept unit, not a Zone or Kept region");
  });

  it("takes a Kept region as its Zone", async () => {
    const found = await messages((blueprint, scene) => {
      blueprint.kept = [...(blueprint.kept ?? []), { id: "keep", kind: "region", name: "Keep", editorId: 7 }];
      scene.shots[1].orders[0].inZone = "keep";
    });
    expect(found).toEqual([]);
  });

  it("reports an order giving more than one of cast, units and player, a player without a Zone, and a Zone without a player", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].orders = [
        { units: ["nova"], player: 2, inZone: "field", moveTo: "gate" },
        { cast: "squad", player: 2, inZone: "field", moveTo: "gate" },
        { player: 2, moveTo: "gate" },
        { units: ["nova"], inZone: "field", moveTo: "gate" },
        { inZone: "field", moveTo: "gate" },
      ];
    });
    const GIVE_ONE = "An order is to a staged unit (cast), live units (units) or a player's units in a Zone (player and inZone): give one";
    expect(found).toContain(`shots.1.orders.0: ${GIVE_ONE}`);
    expect(found).toContain(`shots.1.orders.1: ${GIVE_ONE}`);
    expect(found).toContain("shots.1.orders.2.inZone: An order to a player's units names the Zone they're in: give inZone");
    expect(found).toContain("shots.1.orders.3.inZone: inZone is the Zone of an order to a player's units: give player with it, or leave it out");
    // An order to no one gets the one message, which names player and inZone.
    expect(found.filter((message) => message.startsWith("shots.1.orders.4"))).toEqual([`shots.1.orders.4: ${GIVE_ONE}`]);
  });

  it("passes the fixture scene", async () => {
    expect(await messages(() => {})).toEqual([]);
  });
});
