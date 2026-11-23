// Warp-ins, a build finished at once and warp-outs in a trigger scene: the `cinematic` fixture
// Workspace's Radio Field plays a scene 2 of one line as the trigger scene `landing` when Nova reaches
// the field. Its held wide warps in two Probes round a beacon; on the line one of them builds a Nexus
// at a site, finished at once, and Nova and player 2's army warp out. Both paths, watched and skipped,
// end with the Probes and the finished Nexus there and the warped-out units gone. The compiled map's
// MapScript.galaxy is read back.
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

/** A held wide where two Probes warp in round the beacon, then a cut on the line where one builds a Nexus and Nova and player 2's army warp out. */
const SCENE = {
  shots: [
    { camera: "cam-wide", afterMs: 0, pauseAfterMs: 1000, warpIns: [{ id: "probes", unitType: "Probe", player: 1, count: 2, at: "beacon" }] },
    {
      camera: "cam-goal",
      line: LINE,
      builds: [{ warpIn: "probes", unitType: "Nexus", ability: "ProtossBuild", at: "site" }],
      warpOuts: [{ units: ["nova"] }, { player: 2, atMs: 500 }],
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
  blueprint.anchors = [camera("cam-wide", 20, 20), camera("cam-goal", 44, 40), point("beacon", 40, 40), point("site", 44, 44), unit("nova", 10, 10), unit("raider", 30, 30, 2)];
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
const BEACON = stableObjectId("beacon");
const SITE = stableObjectId("site");
const PLAYING = "gv_trigger_scene_landing_playing";
const PROBES = "gv_trigger_scene_landing_warp_in_probes";
const WARPED = "gv_trigger_scene_landing_warped_in_probes";
const EFFECT = (n: number): string => `gv_trigger_scene_landing_warp_effect_${n}_probes`;
const WARP_IN = "gt_TriggerSceneLandingWarpInShot1WarpIn1";

describe("units warped in", () => {
  it("are created round their point at the shot's cut, on a thread of their own, each with the warp-in effect", async () => {
    const script = await compiled();
    const cinematic = section(script, "TriggerSceneLandingCinematic");
    expect(cinematic).toContain(lines(`CameraApplyInfo(1, CameraInfoFromId(${stableObjectId("cam-wide")}), 0.0, -1, 10.0, true);`, `TriggerExecute(${WARP_IN}, true, false);`));
    const warp = section(script, WARP_IN.slice(3));
    // One at a time, evenly round the point, so each gets its own effect.
    for (const [n, angle] of [
      [1, "180.0"],
      [2, "360.0"],
    ] as const) {
      expect(warp).toContain(
        lines(
          `    UnitCreate(1, "Probe", 0, 1, PointWithOffsetPolar(PointFromId(${BEACON}), 1.5, ${angle}), 270.0);`,
          `    UnitGroupAdd(${PROBES}, UnitLastCreated());`,
          `    libNtve_gf_AttachModelToUnit(UnitLastCreated(), "ProtossGenericWarpInOut", "Ref_Center");`,
          `    ${EFFECT(n)} = libNtve_gf_ActorLastCreated();`,
        ),
      );
    }
    expect(warp.indexOf(`if ((${PLAYING} == true)) {`)).toBeLessThan(warp.indexOf("UnitCreate("));
    // The effect killed once it has played.
    expect(warp).toContain(lines(`    ${WARPED} = true;`, "    Wait(5.0, c_timeGame);", `    libNtve_gf_KillModel(${EFFECT(1)});`, `    libNtve_gf_KillModel(${EFFECT(2)});`));
  });
});

describe("units warped in, skipped before", () => {
  it("are created by the Cleanup, with no effect, if the scene hadn't yet; else every effect is killed", async () => {
    const cleanup = section(await compiled(), "TriggerSceneLandingCleanup");
    expect(cleanup).toContain(
      lines(
        `if ((${WARPED} == false)) {`,
        `    UnitCreate(1, "Probe", 0, 1, PointWithOffsetPolar(PointFromId(${BEACON}), 1.5, 180.0), 270.0);`,
        `    UnitGroupAdd(${PROBES}, UnitLastCreated());`,
        `    UnitCreate(1, "Probe", 0, 1, PointWithOffsetPolar(PointFromId(${BEACON}), 1.5, 360.0), 270.0);`,
        `    UnitGroupAdd(${PROBES}, UnitLastCreated());`,
        `    ${WARPED} = true;`,
        "}",
        "else {",
        `    libNtve_gf_KillModel(${EFFECT(1)});`,
        `    libNtve_gf_KillModel(${EFFECT(2)});`,
        "}",
      ),
    );
    // Not removed with the staged cast: they're the player's after the handback.
    expect(cleanup).not.toMatch(/_g = gv_trigger_scene_landing_warp_in_probes;/);
    expect(cleanup.indexOf(`if ((${WARPED} == false))`)).toBeGreaterThan(cleanup.indexOf(`${PLAYING} = false;`));
    expect(cleanup.indexOf(`if ((${WARPED} == false))`)).toBeLessThan(cleanup.indexOf("if ((gv_trigger_scene_landing_completed == true))"));
  });

  it("stand at the place itself when there's one, at a radius of the scene's own, and atMs into the shot", async () => {
    const script = await compiled((_blueprint, scene) => {
      scene.shots[0].warpIns.push({ id: "zealot", unitType: "Zealot", player: 1, at: { x: 12, y: 14 }, facing: 90, atMs: 400 });
      scene.shots[0].warpIns[0].radius = 3;
    });
    expect(section(script, WARP_IN.slice(3))).toContain("PointWithOffsetPolar(PointFromId(" + BEACON + "), 3.0, 180.0)");
    const zealot = section(script, "TriggerSceneLandingWarpInShot1WarpIn2");
    expect(zealot).toContain(lines("Wait(0.4, c_timeReal);", `if ((${PLAYING} == true)) {`, '    UnitCreate(1, "Zealot", 0, 1, Point(12.0, 14.0), 90.0);'));
  });
});

describe("warps, on a second run", () => {
  it("start from nothing done: Setup clears each warp's flag and each warp-in's group before the skip's branch", async () => {
    const setup = section(await compiled(), "TriggerSceneLandingSetup");
    const branch = setup.indexOf("if ((gv_trigger_scene_landing_skipped == false))");
    for (const reset of [`${WARPED} = false;`, `UnitGroupClear(${PROBES});`, "gv_trigger_scene_landing_built_2_1 = false;", "gv_trigger_scene_landing_warped_out_2_1 = false;", "gv_trigger_scene_landing_warped_out_2_2 = false;"]) {
      expect(setup).toContain(reset);
      expect(setup.indexOf(reset)).toBeLessThan(branch);
    }
  });
});

describe("a warp-in's ring and effects", () => {
  it("rounds each unit's angle round the ring to hundredths", async () => {
    const warp = section(
      await compiled((_blueprint, scene) => {
        scene.shots[0].warpIns[0].count = 7;
      }),
      WARP_IN.slice(3),
    );
    expect(warp).toContain(`PointWithOffsetPolar(PointFromId(${BEACON}), 1.5, 51.43)`);
    expect(warp).not.toMatch(/51\.428/);
  });

  it("are killed by the Cleanup only once the warp-in has made them, never as No Actor", async () => {
    const cleanup = section(await compiled(), "TriggerSceneLandingCleanup");
    const branch = cleanup.indexOf(`if ((${WARPED} == false))`);
    expect(cleanup.indexOf(`libNtve_gf_KillModel(${EFFECT(1)});`)).toBeGreaterThan(branch);
    expect(cleanup.slice(branch)).toMatch(new RegExp(`else \\{\\r\\n\\s+libNtve_gf_KillModel\\(${EFFECT(1)}\\);`));
  });
});

describe("a build finished at once", () => {
  const BUILT = "gv_trigger_scene_landing_built_2_1";
  const BUILDER = "UnitGroupUnit(gv_trigger_scene_landing_warp_in_probes, 1)";
  const NEXUSES = `UnitGroup("Nexus", 1, RegionCircle(PointFromId(${SITE}), 2.0), UnitFilter(0, 0, 0, (1 << (c_targetFilterDead - 32))), 0)`;

  it("orders the builder to build at the cut, waits for it to place the structure, then sets it to 100%", async () => {
    const script = await compiled();
    expect(section(script, "TriggerSceneLandingCinematic")).toContain("TriggerExecute(gt_TriggerSceneLandingBuildShot2Build1, true, false);");
    const build = section(script, "TriggerSceneLandingBuildShot2Build1");
    expect(build).toContain(
      lines(
        `    UnitIssueOrder(${BUILDER}, OrderTargetingPoint(AbilityCommand("ProtossBuild", 0), PointFromId(${SITE})), c_orderQueueReplace);`,
        `    UnitWaitUntilIdle(${BUILDER}, true);`,
        `    if ((${PLAYING} == true)) {`,
      ),
    );
    expect(build).toMatch(new RegExp(`(auto\\w+)_g = ${NEXUSES.replace(/[()]/g, "\\$&")};[\\s\\S]*?UnitSetProgressComplete\\(\\1_var, 1, 100\\);[\\s\\S]*?${BUILT} = true;`));
  });

  it("is finished by the Cleanup on a skip before it: the order cancelled, and the structure created if it wasn't placed, else set to 100%", async () => {
    const cleanup = section(await compiled(), "TriggerSceneLandingCleanup");
    expect(cleanup).toContain(
      lines(
        `if ((${BUILT} == false)) {`,
        `    if ((UnitIsAlive(${BUILDER}) == true)) {`,
        `        UnitIssueOrder(${BUILDER}, OrderTargetingPoint(AbilityCommand("move", 0), UnitGetPosition(${BUILDER})), c_orderQueueReplace);`,
        "    }",
        "",
        `    if ((UnitGroupCount(${NEXUSES}, c_unitCountAlive) == 0)) {`,
        `        UnitCreate(1, "Nexus", 0, 1, PointFromId(${SITE}), 270.0);`,
        "    }",
        "    else {",
      ),
    );
    // After the Probes it needs are in.
    expect(cleanup.indexOf(`if ((${BUILT} == false))`)).toBeGreaterThan(cleanup.indexOf(`if ((${WARPED} == false))`));
  });

  it("is left to the Cleanup when the builder placed nothing (a failed order), so the structure is still made", async () => {
    const build = section(await compiled(), "TriggerSceneLandingBuildShot2Build1");
    expect(build).toContain(lines(`    if ((${PLAYING} == true)) {`, `        if ((UnitGroupCount(${NEXUSES}, c_unitCountAlive) >= 1)) {`));
  });

  it("can be by a live unit, for its player", async () => {
    const script = await compiled((blueprint, scene) => {
      blueprint.anchors.push(unit("scv", 20, 30, 3));
      scene.shots[1].builds = [{ unit: "scv", unitType: "CommandCenter", ability: "TerranBuild", at: "site" }];
    });
    const build = section(script, "TriggerSceneLandingBuildShot2Build1");
    expect(build).toContain(`UnitIssueOrder(UnitFromId(${stableObjectId("scv")}), OrderTargetingPoint(AbilityCommand("TerranBuild", 0), PointFromId(${SITE})), c_orderQueueReplace);`);
    expect(section(script, "TriggerSceneLandingCleanup")).toContain(`UnitCreate(1, "CommandCenter", 0, 3, PointFromId(${SITE}), 270.0);`);
  });
});

describe("units warped out", () => {
  const NOVA_OUT = "gv_trigger_scene_landing_warp_out_2_1";
  const ARMY_OUT = "gv_trigger_scene_landing_warp_out_2_2";
  const ARMY = "UnitGroup(null, 2, RegionEntireMap(), UnitFilter(0, 0, (1 << c_targetFilterStructure), (1 << (c_targetFilterDead - 32))), 0)";

  it("are held still with the warp effect, then removed once it has played", async () => {
    const script = await compiled();
    expect(section(script, "TriggerSceneLandingCinematic")).toContain(
      lines("TriggerExecute(gt_TriggerSceneLandingWarpOutShot2WarpOut1, true, false);", "TriggerExecute(gt_TriggerSceneLandingWarpOutShot2WarpOut2, true, false);"),
    );
    const nova = section(script, "TriggerSceneLandingWarpOutShot2WarpOut1");
    expect(nova).toContain(`UnitGroupAdd(${NOVA_OUT}, UnitFromId(${NOVA}));`);
    expect(nova).toMatch(/libNtve_gf_PauseUnit\((auto\w+)_var, true\);\r\n\s+libNtve_gf_AttachModelToUnit\(\1_var, "ProtossGenericWarpInOut", "Ref_Origin"\);/);
    expect(nova).toMatch(/Wait\(1\.7, c_timeGame\);[\s\S]*UnitRemove\(auto\w+_var\);[\s\S]*UnitGroupClear\(gv_trigger_scene_landing_warp_out_2_1\);/);
    // A player's army: every unit of theirs that isn't a structure, atMs into the shot.
    const army = section(script, "TriggerSceneLandingWarpOutShot2WarpOut2");
    expect(army).toContain(lines("Wait(0.5, c_timeReal);", `if ((${PLAYING} == true)) {`, `    UnitGroupAddUnitGroup(${ARMY_OUT}, ${ARMY});`));
  });

  it("are removed by the Cleanup on both paths, wherever they are, after the builds and before the handback", async () => {
    const cleanup = section(await compiled(), "TriggerSceneLandingCleanup");
    expect(cleanup).toContain(lines(`UnitGroupAdd(${NOVA_OUT}, UnitFromId(${NOVA}));`));
    expect(cleanup).toContain(lines(`UnitGroupAddUnitGroup(${ARMY_OUT}, ${ARMY});`));
    expect(cleanup).toMatch(/(auto\w+)_g = gv_trigger_scene_landing_warp_out_2_2;[\s\S]*?UnitRemove\(\1_var\);[\s\S]*?UnitGroupClear\(gv_trigger_scene_landing_warp_out_2_2\);/);
    expect(cleanup.indexOf(`UnitGroupAdd(${NOVA_OUT}`)).toBeGreaterThan(cleanup.indexOf("if ((gv_trigger_scene_landing_built_2_1 == false))"));
    expect(cleanup.indexOf(`UnitGroupClear(${ARMY_OUT})`)).toBeLessThan(cleanup.indexOf("if ((gv_trigger_scene_landing_completed == true))"));
  });

  it("are gathered by the Cleanup only if the warp-out hadn't begun, so units that came after it stay", async () => {
    const script = await compiled();
    const DONE = "gv_trigger_scene_landing_warped_out_2_2";
    expect(section(script, "TriggerSceneLandingWarpOutShot2WarpOut2")).toContain(lines(`    UnitGroupAddUnitGroup(${ARMY_OUT}, ${ARMY});`, `    ${DONE} = true;`));
    expect(section(script, "TriggerSceneLandingCleanup")).toContain(lines(`if ((${DONE} == false)) {`, `    UnitGroupAddUnitGroup(${ARMY_OUT}, ${ARMY});`, "}", "", `${DONE} = true;`));
  });

  it("leave the units in a player's except alone, watched and skipped: taken back out of the army before the effect and in the Cleanup", async () => {
    const script = await compiled((blueprint, scene) => {
      blueprint.anchors.push(unit("guard", 12, 10));
      scene.shots[1].warpOuts = [{ player: 1, except: ["nova", "guard"], atMs: 500 }];
    });
    const OUT = "gv_trigger_scene_landing_warp_out_2_1";
    const PLAYER_1 = "UnitGroup(null, 1, RegionEntireMap(), UnitFilter(0, 0, (1 << c_targetFilterStructure), (1 << (c_targetFilterDead - 32))), 0)";
    const kept = [`UnitGroupAddUnitGroup(${OUT}, ${PLAYER_1});`, `UnitGroupRemove(${OUT}, UnitFromId(${NOVA}));`, `UnitGroupRemove(${OUT}, UnitFromId(${stableObjectId("guard")}));`];
    const shot = section(script, "TriggerSceneLandingWarpOutShot2WarpOut1");
    expect(shot).toContain(lines(...kept.map((statement) => `    ${statement}`), "    gv_trigger_scene_landing_warped_out_2_1 = true;"));
    expect(section(script, "TriggerSceneLandingCleanup")).toContain(lines("if ((gv_trigger_scene_landing_warped_out_2_1 == false)) {", ...kept.map((statement) => `    ${statement}`), "}"));
  });

  it("come after a warp-in in the Cleanup only when they come after it in the scene", async () => {
    const cleanup = section(
      await compiled((_blueprint, scene) => {
        scene.shots[0].warpOuts = [{ player: 1 }];
        delete scene.shots[1].warpOuts;
        delete scene.shots[1].builds;
        scene.shots[1].warpIns = scene.shots[0].warpIns;
        delete scene.shots[0].warpIns;
      }),
      "TriggerSceneLandingCleanup",
    );
    expect(cleanup.indexOf("UnitGroupAddUnitGroup(gv_trigger_scene_landing_warp_out_1_1")).toBeLessThan(cleanup.indexOf(`if ((${WARPED} == false))`));
  });
});

describe("warp-ins, builds and warp-outs, checked", () => {
  const messages = async (edit: (blueprint: any, scene: any) => void): Promise<string[]> => {
    const { root } = await workspace(edit);
    const { problems } = await checkWorkspace(root);
    // The trigger scene's own, not the fixture Cinematic's, and not the cinematography checks'
    // findings on its framing and timing (trigger-scene-checks.test.ts covers those).
    return problems.filter((problem) => problem.file.includes("trigger-scenes") && !/^(C[1-9]|T[34]|H3|O2): /.test(problem.message)).map((problem) => `${problem.path ?? ""}: ${problem.message}`);
  };

  it("passes the fixture scene", async () => {
    expect(await messages(() => {})).toEqual([]);
  });

  it("reports a warp-in of a unit type the Catalog lacks, at a place that isn't a point, and ids given twice or naming one group", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[0].warpIns.push(
        { id: "ghosts", unitType: "NoSuchUnit", player: 1, at: "cam-wide" },
        { id: "probes", unitType: "Probe", player: 1, at: "beacon" },
        { id: "two-a", unitType: "Probe", player: 1, at: "beacon" },
        { id: "two_a", unitType: "Probe", player: 1, at: "beacon" },
      );
    });
    expect(found).toContain("shots.0.warpIns.1.unitType: NoSuchUnit isn't a unit the Catalog has (data/tech-catalog.json)");
    expect(found).toContain("shots.0.warpIns.1.at: cam-wide is a camera Anchor, not a point");
    expect(found).toContain("shots.0.warpIns.2.id: probes is warped in twice");
    expect(found).toContain("shots.0.warpIns.4.id: two_a and two-a would name one unit group in the triggers; rename one");
  });

  it("reports a build by no warp-in, by a warp-in that comes later, or by a unit that isn't a unit Anchor, and of a unit that isn't a structure", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[0].builds = [
        { warpIn: "probes", unitType: "Nexus", ability: "ProtossBuild", at: "site", atMs: 0 },
        { warpIn: "nobody", unitType: "Nexus", ability: "ProtossBuild", at: "site" },
        { unit: "beacon", unitType: "Nexus", ability: "ProtossBuild", at: "site" },
        { unit: "nova", unitType: "Zealot", ability: "ProtossBuild", at: "beacon" },
      ];
      scene.shots[0].warpIns[0].atMs = 300;
    });
    expect(found).toContain("shots.0.builds.0.warpIn: probes warps in after this build; build once it's in");
    expect(found).toContain("shots.0.builds.1.warpIn: No warp-in nobody in the scene");
    expect(found).toContain("shots.0.builds.2.unit: beacon is a point Anchor, not a unit");
    expect(found).toContain("shots.0.builds.3.unitType: Zealot isn't a structure");
  });

  it("reports a stock build ability whose first command builds something else, and a builder with no player", async () => {
    const found = await messages((blueprint, scene) => {
      blueprint.anchors.push({ ...unit("drifter", 20, 30), player: undefined });
      scene.shots[1].builds = [
        { warpIn: "probes", unitType: "Pylon", ability: "ProtossBuild", at: "site" },
        { unit: "drifter", unitType: "Nexus", ability: "ProtossBuild", at: "site" },
      ];
    });
    expect(found).toContain("shots.1.builds.0.ability: ProtossBuild's first command builds a Nexus, not a Pylon; a build gives only its ability's first command");
    expect(found).toContain("shots.1.builds.1.unit: drifter has no player, so the build can't know whose its structure is");
  });

  it("reports a builder the scene pauses, or one that has withdrawn by then", async () => {
    const found = await messages((blueprint, scene) => {
      blueprint.anchors.push(unit("held", 20, 30), unit("leaver", 22, 30));
      scene.live = [{ unit: "held", pause: true }];
      scene.shots[0].orders = [{ units: ["leaver"], moveTo: "beacon", withdraw: true }];
      scene.shots[1].builds = [
        { unit: "held", unitType: "Nexus", ability: "ProtossBuild", at: "site" },
        { unit: "leaver", unitType: "Nexus", ability: "ProtossBuild", at: "beacon" },
      ];
    });
    expect(found).toContain("shots.1.builds.0.unit: held is paused for the scene (live), so it can't build");
    expect(found).toContain("shots.1.builds.1.unit: leaver has withdrawn by then (shots.0.orders.0)");
  });

  it("reports two builds by one builder at one moment, since the second order replaces the first", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].builds.push({ warpIn: "probes", unitType: "Nexus", ability: "ProtossBuild", at: "beacon" }, { warpIn: "probes", unitType: "Nexus", ability: "ProtossBuild", at: "beacon", atMs: 400 });
    });
    expect(found).toContain("shots.1.builds.1.warpIn: probes's builder is given a build at this moment already (shots.1.builds.0); give one later");
    expect(found.filter((problem) => problem.startsWith("shots.1.builds.2"))).toEqual([]);
  });

  it("takes a player's army as the game does: their structure Anchors stay, and their units warped in before it go", async () => {
    const found = await messages((blueprint, scene) => {
      blueprint.anchors.push({ ...unit("gate", 30, 34), unitType: "Nexus" });
      scene.shots[0].warpOuts = [{ player: 1, atMs: 100 }];
      scene.shots[1].warpOuts = [{ units: ["gate"] }];
    });
    expect(found.filter((problem) => problem.includes("gate"))).toEqual([]);
    expect(found).toContain("shots.1.builds.0.warpIn: probes has warped out by then (shots.0.warpOuts.0)");
  });

  it("reports a warp-out of a unit that isn't a unit Anchor or is listed twice, and an order to a unit after it warps out", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].warpOuts[0].units = ["nova", "nova", "site"];
      scene.shots.push({ camera: "cam-wide", afterMs: 0, orders: [{ units: ["nova"], moveTo: "beacon" }], warpOuts: [{ units: ["nova"] }] });
    });
    expect(found).toContain("shots.1.warpOuts.0.units.1: nova is in this warp-out twice");
    expect(found).toContain("shots.1.warpOuts.0.units.2: site is a point Anchor, not a unit");
    expect(found).toContain("shots.2.orders.0.units.0: nova has warped out by then (shots.1.warpOuts.0)");
    expect(found).toContain("shots.2.warpOuts.0.units.0: nova has warped out by then (shots.1.warpOuts.0)");
  });

  it("reports an order to a unit after its player's army warps out", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].warpOuts = [{ player: 1 }];
      scene.shots.push({ camera: "cam-wide", afterMs: 0, orders: [{ units: ["nova"], moveTo: "beacon" }] });
    });
    expect(found).toContain("shots.2.orders.0.units.0: nova has warped out by then (shots.1.warpOuts.0)");
  });

  it("leaves a player's except out of their army: an order to it after the warp-out is in time", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].warpOuts = [{ player: 1, except: ["nova"] }];
      scene.shots.push({ camera: "cam-wide", afterMs: 0, orders: [{ units: ["nova"], moveTo: "beacon" }] });
    });
    expect(found).toEqual([]);
  });

  it("reports an except entry that isn't a unit Anchor or is given twice, and except on a warp-out of units", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].warpOuts = [{ player: 1, except: ["nova", "nova", "site", "nobody"] }];
    });
    expect(found).toContain("shots.1.warpOuts.0.except.1: nova is in this except twice");
    expect(found).toContain("shots.1.warpOuts.0.except.2: site is a point Anchor, not a unit");
    expect(found).toContain("shots.1.warpOuts.0.except.3: No unit Anchor nobody in the Blueprint");
    const units = await messages((_blueprint, scene) => {
      scene.shots[1].warpOuts[0].except = ["raider"];
    });
    expect(units).toContain("shots.1.warpOuts.0: except keeps units out of a player's army (player); a warp-out of units lists only those it takes");
  });

  it("reports a warp atMs at or past its shot's end, and the compile refuses it", async () => {
    const late = (_blueprint: any, scene: any): void => {
      scene.shots[1].warpOuts[1].atMs = 99000;
    };
    expect(await messages(late)).toEqual([expect.stringMatching(/^shots\.1\.warpOuts\.1\.atMs: 99000 ms into the shot is at or past its end, at \d+ ms; give it in the shot it falls in$/)]);
    await expect(compiled(late)).rejects.toThrow(/shots\.1\.warpOuts\.1\.atMs: 99000 ms into the shot/);
  });

  it("reports a build by both a warp-in and a unit, and a warp-out of both units and a player", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].builds[0].unit = "nova";
      scene.shots[1].warpOuts[0].player = 1;
    });
    expect(found).toContain("shots.1.builds.0: A build is by a warp-in's unit (warpIn) or a live unit (unit): give one");
    expect(found).toContain("shots.1.warpOuts.0: A warp-out is of live units (units) or a player's army (player): give one");
  });
});
