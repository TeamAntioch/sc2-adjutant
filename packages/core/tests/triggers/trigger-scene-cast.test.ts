// A trigger scene's cast: the `cinematic` fixture Workspace's Radio Field plays a scene 2 of one line
// as the trigger scene `landing` when Nova reaches the field. It stages two units of its own (a pair
// of Marines at a point Anchor and a Medic at a position), orders the Marines to a second point at
// the second shot's cut, and hides a live unit Anchor for the scene. The compiled map's
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
const unit = (id: string, x: number, y: number) => ({ id, name: id, zoneId: "field", kind: "unit", unitType: "Marine", player: 1, position: { x, y, z: 0 }, rotation: 0 });

/** A held wide, then a cut to the goal on the line, where the staged Marines are sent west. */
const SCENE = {
  cast: [
    { id: "squad", unitType: "Marine", player: 2, count: 2, at: "squad-start", facing: 180 },
    { id: "medic", unitType: "Medic", player: 2, at: { x: 30, y: 30 } },
  ],
  live: [{ unit: "stand-in", hide: true }],
  shots: [
    { camera: "cam-wide", afterMs: 0, pauseAfterMs: 1000 },
    { camera: "cam-goal", line: LINE, orders: [{ cast: "squad", moveTo: "squad-west" }] },
  ],
};

/** Radio Field with scene 2 as the trigger scene `landing`, cued when Nova enters the field. */
async function workspace(edit: (blueprint: any, scene: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-wide", 20, 20), camera("cam-goal", 44, 40), point("squad-start", 40, 40), point("squad-west", 10, 40), unit("nova", 10, 10), unit("stand-in", 42, 42)];
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
const START = stableObjectId("squad-start");
const WEST = stableObjectId("squad-west");
const STAND_IN = stableObjectId("stand-in");

describe("a trigger scene's staged cast", () => {
  it("is created under black in Setup, for the player it names, when the scene isn't skipped", async () => {
    const setup = section(await compiled(), "TriggerSceneLandingSetup");
    expect(setup).toContain(
      lines(
        "if ((gv_trigger_scene_landing_skipped == false)) {",
        `    UnitCreate(2, "Marine", 0, 2, PointFromId(${START}), 180.0);`,
        "    UnitGroupAddUnitGroup(gv_trigger_scene_landing_cast_squad, UnitLastCreatedGroup());",
        `    UnitCreate(1, "Medic", 0, 2, Point(30.0, 30.0), 270.0);`,
        "    UnitGroupAddUnitGroup(gv_trigger_scene_landing_cast_medic, UnitLastCreatedGroup());",
      ),
    );
    // Created after the fade to black.
    expect(setup.indexOf("UnitCreate(")).toBeGreaterThan(setup.indexOf("CinematicFade(false, 0.0"));
  });

  it("is ordered at a shot's cut to move to a point", async () => {
    const cinematic = section(await compiled(), "TriggerSceneLandingCinematic");
    // Each of the squad, picked from its group straight after the cut.
    expect(cinematic).toMatch(
      new RegExp(
        `CameraApplyInfo\\(1, CameraInfoFromId\\(${stableObjectId("cam-goal")}\\), 0\\.0, -1, 10\\.0, true\\);\\r\\n {4}(auto\\w+)_g = gv_trigger_scene_landing_cast_squad;[\\s\\S]*?` +
          `UnitIssueOrder\\(\\1_var, OrderTargetingPoint\\(AbilityCommand\\("move", 0\\), PointFromId\\(${WEST}\\)\\), c_orderQueueReplace\\);`,
      ),
    );
    // Ordered after the cut, before the line.
    expect(cinematic.indexOf("UnitIssueOrder(")).toBeLessThan(cinematic.indexOf("TransmissionSendForPlayerSelect("));
  });

  it("is removed under black in Cleanup, on a skip and the natural end alike", async () => {
    const cleanup = section(await compiled(), "TriggerSceneLandingCleanup");
    for (const member of ["squad", "medic"]) {
      expect(cleanup).toMatch(new RegExp(`(auto\\w+)_g = gv_trigger_scene_landing_cast_${member};[\\s\\S]*?UnitRemove\\(\\1_var\\);\\r\\n {4}}\\r\\n {4}UnitGroupClear\\(gv_trigger_scene_landing_cast_${member}\\);`));
    }
    // Before the handback's fade in, and on no branch of it.
    expect(cleanup.indexOf("UnitRemove(")).toBeLessThan(cleanup.indexOf("if ((gv_trigger_scene_landing_completed == true))"));
  });
});

describe("a live unit a trigger scene films", () => {
  it("is hidden in Setup unless the mission hid it already, and only then shown again in Cleanup", async () => {
    const script = await compiled();
    expect(section(script, "TriggerSceneLandingSetup")).toContain(
      lines(
        `    if ((libNtve_gf_UnitIsHidden(UnitFromId(${STAND_IN})) == false)) {`,
        `        UnitGroupAdd(gv_trigger_scene_landing_hidden_units, UnitFromId(${STAND_IN}));`,
        `        libNtve_gf_ShowHideUnit(UnitFromId(${STAND_IN}), false);`,
        "    }",
        "",
        "    TriggerExecute(gt_TriggerSceneLandingCinematic, true, true);",
      ),
    );
    const cleanup = section(script, "TriggerSceneLandingCleanup");
    expect(cleanup).toMatch(/(auto\w+)_g = gv_trigger_scene_landing_hidden_units;[\s\S]*?libNtve_gf_ShowHideUnit\(\1_var, true\);\r\n {4}}\r\n {4}UnitGroupClear\(gv_trigger_scene_landing_hidden_units\);/);
    expect(cleanup.indexOf("libNtve_gf_ShowHideUnit(")).toBeLessThan(cleanup.indexOf("if ((gv_trigger_scene_landing_completed == true))"));
    expect(script).not.toContain("gv_trigger_scene_landing_paused_units");
  });

  it("is paused, when the scene asks, the same way", async () => {
    const script = await compiled((_blueprint, scene) => {
      scene.live = [{ unit: "stand-in", pause: true }];
    });
    expect(section(script, "TriggerSceneLandingSetup")).toContain(
      lines(
        `    if ((libNtve_gf_UnitIsPaused(UnitFromId(${STAND_IN})) == false)) {`,
        `        UnitGroupAdd(gv_trigger_scene_landing_paused_units, UnitFromId(${STAND_IN}));`,
        `        libNtve_gf_PauseUnit(UnitFromId(${STAND_IN}), true);`,
        "    }",
      ),
    );
    expect(section(script, "TriggerSceneLandingCleanup")).toMatch(/(auto\w+)_g = gv_trigger_scene_landing_paused_units;[\s\S]*?libNtve_gf_PauseUnit\(\1_var, false\);/);
    expect(script).not.toContain("gv_trigger_scene_landing_hidden_units");
  });
});

describe("a trigger scene's cast, checked", () => {
  const messages = async (edit: (blueprint: any, scene: any) => void): Promise<string[]> => {
    const { root } = await workspace(edit);
    const { problems } = await checkWorkspace(root);
    // The trigger scene's own, not the fixture Cinematic's, and not the cinematography checks'
    // findings on its framing and timing (trigger-scene-checks.test.ts covers those).
    return problems.filter((problem) => problem.file.includes("trigger-scenes") && !/^(C[1-9]|T[34]|H3|O2): /.test(problem.message)).map((problem) => `${problem.path ?? ""}: ${problem.message}`);
  };

  it("reports a staged unit type the Catalog lacks and a live Anchor that isn't a unit", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.cast[1].unitType = "Mediq";
      scene.live = [{ unit: "squad-start", hide: true }, { unit: "nobody", pause: true }];
    });
    expect(found).toContain("cast.1.unitType: Mediq isn't a unit the Catalog has (data/tech-catalog.json)");
    expect(found).toContain("live.0.unit: squad-start is a point Anchor, not a unit");
    expect(found).toContain("live.1.unit: No unit Anchor nobody in the Blueprint");
  });

  it("reports a place that isn't a point Anchor, and an order to no staged unit", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.cast[0].at = "cam-wide";
      scene.shots[1].orders = [{ cast: "squad", moveTo: "nowhere" }, { cast: "ghosts", moveTo: "squad-west" }];
    });
    expect(found).toContain("cast.0.at: cam-wide is a camera Anchor, not a point");
    expect(found).toContain("shots.1.orders.0.moveTo: No point Anchor nowhere in the Blueprint");
    expect(found).toContain("shots.1.orders.1.cast: No staged unit ghosts in the scene's cast");
  });

  it("reports a cast id or live unit given twice", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.cast[1].id = "squad";
      scene.live.push({ unit: "stand-in", pause: true });
    });
    expect(found).toContain("cast.1.id: squad is in the cast twice");
    expect(found).toContain("live.1.unit: stand-in is listed twice; give it hide and pause together");
  });

  it("reports cast ids the triggers would name alike", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.cast[0].id = "squad-a";
      scene.cast[1].id = "squad_a";
      scene.shots[1].orders = [{ cast: "squad-a", moveTo: "squad-west" }];
    });
    expect(found).toContain("cast.1.id: squad_a and squad-a would name one unit group in the triggers; rename one");
  });

  it("passes the fixture scene", async () => {
    expect(await messages(() => {})).toEqual([]);
  });
});
