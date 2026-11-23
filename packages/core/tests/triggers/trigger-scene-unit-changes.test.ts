// Unit changes in a trigger scene: the `cinematic` fixture Workspace's Radio Field plays a scene 2
// of one line as the trigger scene `landing` when Nova reaches the field. On the line player 2's
// invulnerable pillar is switched on: given to player 1, its Invulnerable behaviour removed and a
// PowerSource added. Both paths, watched and skipped, end with the pillar the player's, vulnerable
// and powering. The compiled map's MapScript.galaxy and Triggers are read back.
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

/** A held wide, then a cut on the line where the pillar is switched on. */
const SCENE = {
  shots: [
    { camera: "cam-wide", afterMs: 0, pauseAfterMs: 1000 },
    { camera: "cam-goal", line: LINE, unitChanges: [{ unit: "pillar", owner: 1, removeBehaviors: ["Invulnerable"], addBehaviors: ["PowerSource"] }] },
  ],
};

/** Radio Field with scene 2 as the trigger scene `landing`, cued when Nova enters the field. */
async function workspace(edit: (blueprint: any, scene: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-wide", 20, 20), camera("cam-goal", 44, 40), point("beacon", 40, 40), unit("nova", 10, 10), unit("pillar", 40, 42, 2)];
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
const PILLAR = `UnitFromId(${stableObjectId("pillar")})`;
const CHANGED = "gv_trigger_scene_landing_unit_change_2_1";
const OWNER = `UnitSetOwner(${PILLAR}, 1, true);`;
const REMOVE = `UnitBehaviorRemove(${PILLAR}, "Invulnerable", 1);`;
const ADD = `UnitBehaviorAdd(${PILLAR}, "PowerSource", ${PILLAR}, 1);`;

describe("a unit change", () => {
  it("sets the unit's owner, keeping the new player's colour, removes then adds its behaviours at the shot's cut, and records that it was given", async () => {
    const cinematic = section(await compiled(), "TriggerSceneLandingCinematic");
    expect(cinematic).toContain(
      lines(`CameraApplyInfo(1, CameraInfoFromId(${stableObjectId("cam-goal")}), 0.0, -1, 10.0, true);`, `if ((UnitIsAlive(${PILLAR}) == true)) {`, `    ${OWNER}`, `    ${REMOVE}`, `    ${ADD}`, "}", "", `${CHANGED} = true;`),
    );
    expect(cinematic.indexOf(ADD)).toBeLessThan(cinematic.indexOf("TransmissionSendForPlayerSelect("));
  });

  it("comes before a warp-out at the same cut, as the checks take it", async () => {
    const cinematic = section(
      await compiled((_blueprint, scene) => {
        scene.shots[1].warpOuts = [{ player: 2 }];
      }),
      "TriggerSceneLandingCinematic",
    );
    expect(cinematic.indexOf(OWNER)).toBeGreaterThan(-1);
    expect(cinematic.indexOf(OWNER)).toBeLessThan(cinematic.indexOf("TriggerExecute(gt_TriggerSceneLandingWarpOutShot2WarpOut1, true, false);"));
  });

  it("comes after the shot's actor events at the same moment, as the Cleanup gives them", async () => {
    const script = await compiled((_blueprint, scene) => {
      scene.shots[1].actorEvents = [{ unit: "pillar", messages: ["Signal PillarOn"] }];
    });
    const cinematic = section(script, "TriggerSceneLandingCinematic");
    expect(cinematic.indexOf("Signal PillarOn")).toBeGreaterThan(-1);
    expect(cinematic.indexOf("Signal PillarOn")).toBeLessThan(cinematic.indexOf(OWNER));
    const cleanup = section(script, "TriggerSceneLandingCleanup");
    expect(cleanup.indexOf("Signal PillarOn")).toBeLessThan(cleanup.indexOf(OWNER));
  });

  it("is given in the Cleanup before an actor event later in the shot, as the scene gives them", async () => {
    const cleanup = section(
      await compiled((_blueprint, scene) => {
        scene.shots[1].actorEvents = [{ unit: "pillar", atMs: 500, messages: ["Signal PillarOn"] }];
      }),
      "TriggerSceneLandingCleanup",
    );
    expect(cleanup.indexOf(OWNER)).toBeGreaterThan(-1);
    expect(cleanup.indexOf(OWNER)).toBeLessThan(cleanup.indexOf("Signal PillarOn"));
  });

  it("is Unit Change Owner, Add Behavior and Remove Behavior in the map's Triggers", async () => {
    const { root, blueprintPath } = await workspace();
    const map = path.join(await tempFolder(), "RadioField.SC2Map");
    await compileMission(await loadWorkspace(root), blueprintPath, map);
    const triggers = await readFile(path.join(map, "Triggers"), "utf8");
    for (const id of ["00000082", "C47C0524", "09840835"]) expect(triggers).toContain(`<FunctionDef Type="FunctionDef" Library="Ntve" Id="${id}"/>`);
    expect(triggers).toMatch(/<ParameterDef Type="ParamDef" Library="Ntve" Id="9A6B09E3"\/>\s*<Value>PowerSource<\/Value>\s*<ValueType Type="gamelink"\/>\s*<ValueGameType Type="Behavior"\/>/);
  });
});

describe("a unit change, skipped before", () => {
  it("has the Cleanup give it if it wasn't given and the unit is alive, under black", async () => {
    const cleanup = section(await compiled(), "TriggerSceneLandingCleanup");
    expect(cleanup).toContain(lines(`if ((${CHANGED} == false)) {`, `    if ((UnitIsAlive(${PILLAR}) == true)) {`, `        ${OWNER}`, `        ${REMOVE}`, `        ${ADD}`, "    }", "", "}"));
    expect(cleanup.indexOf(ADD)).toBeLessThan(cleanup.indexOf("if ((gv_trigger_scene_landing_completed == true))"));
  });

  it("is given again in the order the scene gives them, so the last owner wins", async () => {
    const cleanup = section(
      await compiled((_blueprint, scene) => {
        scene.shots[1].unitChanges = [
          { unit: "pillar", atMs: 500, owner: 2 },
          { unit: "pillar", owner: 1 },
        ];
      }),
      "TriggerSceneLandingCleanup",
    );
    expect(cleanup.indexOf(`UnitSetOwner(${PILLAR}, 1, true);`)).toBeGreaterThan(-1);
    expect(cleanup.indexOf(`UnitSetOwner(${PILLAR}, 1, true);`)).toBeLessThan(cleanup.indexOf(`UnitSetOwner(${PILLAR}, 2, true);`));
  });

  // A warp-out gathers the units its player owns as it begins, so a change before it decides what it takes.
  const GATHER = (shot: number): string => `UnitGroupAddUnitGroup(gv_trigger_scene_landing_warp_out_${shot}_1, UnitGroup(null, 2,`;

  it("is given before a later warp-out of its old player's army gathers, so the unit given away stays, as watched", async () => {
    const cleanup = section(
      await compiled((_blueprint, scene) => {
        scene.shots[0].unitChanges = [{ unit: "pillar", owner: 1 }];
        scene.shots[1].unitChanges = [];
        scene.shots[1].warpOuts = [{ player: 2 }];
      }),
      "TriggerSceneLandingCleanup",
    );
    expect(cleanup.indexOf(GATHER(2))).toBeGreaterThan(-1);
    expect(cleanup.indexOf(OWNER)).toBeGreaterThan(-1);
    expect(cleanup.indexOf(OWNER)).toBeLessThan(cleanup.indexOf(GATHER(2)));
  });

  it("is given after an earlier warp-out of its new player's army gathers, so the unit given to it stays, as watched", async () => {
    const cleanup = section(
      await compiled((_blueprint, scene) => {
        scene.shots[0].warpOuts = [{ player: 2 }];
        scene.shots[1].unitChanges = [{ unit: "nova", owner: 2 }];
      }),
      "TriggerSceneLandingCleanup",
    );
    const owner = `UnitSetOwner(UnitFromId(${stableObjectId("nova")}), 2, true);`;
    expect(cleanup.indexOf(GATHER(1))).toBeGreaterThan(-1);
    expect(cleanup.indexOf(GATHER(1))).toBeLessThan(cleanup.indexOf(owner));
  });

  it("is given again after a skip on the scene's second run too: Setup clears the record, before the skip's branch", async () => {
    const setup = section(await compiled(), "TriggerSceneLandingSetup");
    expect(setup.indexOf(`${CHANGED} = false;`)).toBeGreaterThan(-1);
    expect(setup.indexOf(`${CHANGED} = false;`)).toBeLessThan(setup.indexOf("if ((gv_trigger_scene_landing_skipped == false))"));
  });
});

describe("a unit change atMs into its shot", () => {
  const LATER = "gt_TriggerSceneLandingUnitChangeShot2Change1";

  it("is given that long after the cut, on a thread of its own, while the shots still play, to a unit still alive", async () => {
    const script = await compiled((_blueprint, scene) => {
      scene.shots[1].unitChanges[0].atMs = 300;
    });
    const cinematic = section(script, "TriggerSceneLandingCinematic");
    expect(cinematic).toContain(lines(`CameraApplyInfo(1, CameraInfoFromId(${stableObjectId("cam-goal")}), 0.0, -1, 10.0, true);`, `TriggerExecute(${LATER}, true, false);`));
    expect(cinematic).not.toContain("UnitSetOwner");
    expect(section(script, LATER.slice(3))).toContain(
      lines(
        "Wait(0.3, c_timeReal);",
        "if ((gv_trigger_scene_landing_playing == true)) {",
        `    if ((UnitIsAlive(${PILLAR}) == true)) {`,
        `        ${OWNER}`,
        `        ${REMOVE}`,
        `        ${ADD}`,
        "    }",
        "",
        `    ${CHANGED} = true;`,
        "}",
      ),
    );
  });
});

describe("unit changes, checked", () => {
  const messages = async (edit: (blueprint: any, scene: any) => void): Promise<string[]> => {
    const { root } = await workspace(edit);
    const { problems } = await checkWorkspace(root);
    // The trigger scene's own, not the cinematography checks' findings on its framing and timing.
    return problems.filter((problem) => problem.file.includes("trigger-scenes") && !/^(C[1-9]|T[34]|H3|O2): /.test(problem.message)).map((problem) => `${problem.path ?? ""}: ${problem.message}`);
  };

  it("passes the fixture scene", async () => {
    expect(await messages(() => {})).toEqual([]);
  });

  it("reports a change to a unit that isn't a unit Anchor, or after the unit warps out", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[0].warpOuts = [{ units: ["nova"] }];
      scene.shots[1].unitChanges = [{ unit: "beacon", owner: 1 }, { unit: "nova", owner: 2 }];
    });
    expect(found).toContain("shots.1.unitChanges.0.unit: beacon is a point Anchor, not a unit");
    expect(found).toContain("shots.1.unitChanges.1.unit: nova has warped out by then (shots.0.warpOuts.0)");
  });

  it("reports a behaviour the Catalog lacks", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].unitChanges = [{ unit: "pillar", removeBehaviors: ["NoSuchDormant"], addBehaviors: ["PowerSource", "NoSuchPower"] }];
    });
    expect(found).toEqual([
      "shots.1.unitChanges.0.removeBehaviors.0: NoSuchDormant isn't a behaviour the Catalog has (data/tech-catalog.json)",
      "shots.1.unitChanges.0.addBehaviors.1: NoSuchPower isn't a behaviour the Catalog has (data/tech-catalog.json)",
    ]);
  });

  it("reports an owner outside 0-15, and a change with nothing to change", async () => {
    const found = await messages((_blueprint, scene) => {
      scene.shots[1].unitChanges = [{ unit: "pillar", owner: 16 }, { unit: "pillar" }];
    });
    expect(found).toContain("shots.1.unitChanges.0.owner: An owner is a player from 0 to 15");
    expect(found).toContain("shots.1.unitChanges.1: A unit change sets an owner, removes behaviours or adds them: give one");
  });

  it("reports a change atMs at or past its shot's end, and the compile refuses it", async () => {
    const late = (_blueprint: any, scene: any): void => {
      scene.shots[1].unitChanges[0].atMs = 99000;
    };
    expect(await messages(late)).toEqual([expect.stringMatching(/^shots\.1\.unitChanges\.0\.atMs: 99000 ms into the shot is at or past its end, at \d+ ms; give it in the shot it falls in$/)]);
    await expect(compiled(late)).rejects.toThrow(/shots\.1\.unitChanges\.0\.atMs: 99000 ms into the shot is at or past its end/);
  });
});
