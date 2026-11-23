// A trigger scene's camera aimed at a unit rather than its camera Anchor's own target: the
// `cinematic` fixture Workspace's Radio Field, whose scene 2 plays as the trigger scene `raid` when a
// Zealot raider nears whichever of player 1's Supply Depots, and films that depot with a camera
// Anchor's values. The compiled map's MapScript.galaxy and Triggers are read back.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENE_2 = ["", "## Scene 2: THE RAID", "", "**NOVA** `D-01-01-02-001-NOVA`: They're at the depot.", "", "**NOVA** `D-01-01-02-002-NOVA`: And there she is.", ""].join("\n");
const FIRST = "radio_field-2-1";
const SECOND = "radio_field-2-2";

const camera = (id: string, x: number, y: number) => ({
  id,
  name: id,
  zoneId: "field",
  kind: "camera",
  position: { x, y },
  cameraTarget: { x, y },
  cameraValues: [
    { index: "Distance", value: 20 },
    { index: "Pitch", value: 45 },
    { index: "Yaw", value: 90 },
  ],
});
const unit = (id: string, x: number, unitType: string, player: number) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), zoneId: "field", kind: "unit", unitType, player, position: { x, y: 10, z: 0 }, rotation: 0 });
const NEARS = { type: "anchorNears", anchorId: "raider", unitType: "SupplyDepot", player: 1, distance: 10 };

/** Held on the depot the raider neared, then an eased move to the raider under the second line. */
const SCENE = {
  shots: [
    { camera: "cam-raid", unit: "cue", afterMs: 0, pauseAfterMs: 1000 },
    { camera: "cam-raid", unit: "cue", toUnit: { anchorId: "raider" }, line: SECOND },
  ],
};

async function workspace(edit: (blueprint: any, scene: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-raid", 30, 30), camera("cam-wide", 20, 20), unit("raider", 40, "Zealot", 2), unit("nova", 10, "Marine", 1)];
  blueprint.screenplay.script.cues.push({ scene: 2, cue: NEARS });
  blueprint.screenplay.script.triggerScenes = [{ id: "raid", scene: 2 }];
  const scene = structuredClone(SCENE);
  edit(blueprint, scene);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  await writeFile(path.join(mission, "trigger-scenes/raid.json"), JSON.stringify(scene));
  return { root, blueprintPath };
}

async function compiled(edit?: (blueprint: any, scene: any) => void): Promise<{ script: string; triggers: string }> {
  const { root, blueprintPath } = await workspace(edit);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return { script: await readFile(path.join(map, "MapScript.galaxy"), "utf8"), triggers: await readFile(path.join(map, "Triggers"), "utf8") };
}

async function problemsOf(edit: (blueprint: any, scene: any) => void): Promise<string[]> {
  const { root } = await workspace(edit);
  const { problems } = await checkWorkspace(root);
  return problems.map((problem) => `${problem.path ?? ""}: ${problem.message}`);
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const lines = (...statements: string[]): string => statements.map((statement) => (statement ? `    ${statement}` : "")).join("\r\n");
const RAID = stableObjectId("cam-raid");
const RAIDER = stableObjectId("raider");
const CUE_UNIT = "gv_cue_unit_raider_nears_player_1_supplydepot_10";

describe("a trigger scene's camera aimed at a unit", () => {
  it("takes the unit the cue neared as the scene starts", async () => {
    const { script } = await compiled();
    expect(section(script, "CueRaiderWithin10OfPlayer1SupplyDepot")).toContain(
      lines(`${CUE_UNIT} = EventUnit();`, "gv_trigger_scene_raid_skipped = false;", "gv_trigger_scene_raid_after_cinematic = false;", `gv_trigger_scene_raid_unit = ${CUE_UNIT};`, "TriggerExecute(gt_TriggerSceneRaidSetup, true, true);"),
    );
  });

  it("cuts to the camera Anchor's values without its target, panned to the cue's unit", async () => {
    const { script } = await compiled();
    expect(section(script, "TriggerSceneRaidCinematic")).toContain(
      lines(`CameraApplyInfo(1, CameraInfoFromId(${RAID}), 0.0, -1, 10.0, false);`, "CameraPan(1, UnitGetPosition(gv_trigger_scene_raid_unit), 0.0, -1, 10.0, false);", "TriggerSkippableBegin(PlayerGroupAll(), 0, null, true, false);"),
    );
  });

  it("holds on the same unit without a cut, then eases over the shot to an Anchor's unit", async () => {
    const { script } = await compiled();
    const cinematic = section(script, "TriggerSceneRaidCinematic");
    const move = cinematic.match(new RegExp(`CameraApplyInfo\\(1, CameraInfoFromId\\(${RAID}\\), ([\\d.]+), -1, 10\\.0, false\\);`, "g"));
    expect(move).toHaveLength(2);
    const seconds = move![1]!.match(/, ([\d.]+), -1/)![1]!;
    expect(Number(seconds)).toBeGreaterThan(0.5);
    expect(cinematic).toContain(lines("Wait(1.0, c_timeReal);", `CameraApplyInfo(1, CameraInfoFromId(${RAID}), ${seconds}, -1, 10.0, false);`, `CameraPan(1, UnitGetPosition(UnitFromId(${RAIDER})), ${seconds}, -1, 10.0, false);`));
    expect(cinematic.match(/CameraPan\(/g)).toHaveLength(2);
  });

  it("moves at one speed when the move is linear", async () => {
    const { script } = await compiled((_blueprint, scene) => {
      scene.shots[1].move = "linear";
    });
    expect(section(script, "TriggerSceneRaidCinematic")).toMatch(/CameraPan\(1, UnitGetPosition\(UnitFromId\(\d+\)\), [\d.]+, -1, 0\.0, false\);/);
  });

  it("cuts back to a camera Anchor's own target after a shot aimed at a unit", async () => {
    const { script } = await compiled((_blueprint, scene) => {
      scene.shots[1] = { camera: "cam-raid", line: SECOND };
    });
    expect(section(script, "TriggerSceneRaidCinematic")).toContain(`CameraApplyInfo(1, CameraInfoFromId(${RAID}), 0.0, -1, 10.0, true);`);
  });

  it("compiles Pan Camera and the unit's position as NativeLib's, and leaves a scene with no unit aim without the variable", async () => {
    const { triggers, script } = await compiled();
    for (const id of ["DC635AEF", "00000083"]) expect(triggers).toContain(`<FunctionDef Type="FunctionDef" Library="Ntve" Id="${id}"/>`);
    expect(script).toContain("unit gv_trigger_scene_raid_unit;");
    const plain = await compiled((_blueprint, scene) => {
      scene.shots = [{ camera: "cam-raid", afterMs: 0 }];
    });
    expect(plain.script).not.toContain("gv_trigger_scene_raid_unit");
  });
});

describe("a trigger scene's unit aim, checked", () => {
  it("reports a shot on the cue's unit when the scene's cue has none", async () => {
    const messages = await problemsOf((blueprint) => {
      blueprint.screenplay.script.cues = blueprint.screenplay.script.cues.map((entry: any) => (entry.scene === 2 ? { scene: 2, cue: { type: "anchorDies", anchorId: "nova" } } : entry));
    });
    expect(messages).toContain("shots.0.unit: The shot aims at the cue's unit, but scene 2 plays on an anchorDies cue, which names none; cue it on anchorNears or effectStarts, or aim at a unit Anchor");
    expect(messages).toContain("shots.1.unit: The shot aims at the cue's unit, but scene 2 plays on an anchorDies cue, which names none; cue it on anchorNears or effectStarts, or aim at a unit Anchor");
  });

  it("accepts a shot on the cue's unit when the scene plays on an effectStarts cue, and takes the unit the effect struck", async () => {
    const effect = (blueprint: any) => {
      blueprint.screenplay.script.cues = blueprint.screenplay.script.cues.map((entry: any) => (entry.scene === 2 ? { scene: 2, cue: { type: "effectStarts", anchorId: "raider", effectId: "RaidStrikeDamage" } } : entry));
    };
    expect((await problemsOf(effect)).filter((message) => message.includes("cue's unit"))).toEqual([]);
    const { script } = await compiled(effect);
    const kept = "gv_cue_unit_raider_starts_raidstrikedamage";
    expect(section(script, "CueRaiderStartsRaidStrikeDamage")).toContain(lines(`gv_trigger_scene_raid_unit = ${kept};`, "TriggerExecute(gt_TriggerSceneRaidSetup, true, true);"));
  });

  it("reports an aim at an Anchor that isn't a unit", async () => {
    const messages = await problemsOf((_blueprint, scene) => {
      scene.shots[1].toUnit = { anchorId: "cam-wide" };
      scene.shots[0].unit = { anchorId: "nobody" };
    });
    expect(messages).toContain("shots.1.toUnit: cam-wide is a camera Anchor, not a unit");
    expect(messages).toContain("shots.0.unit: No unit Anchor nobody in the Blueprint");
  });

  it("refuses a move that ends where it starts", async () => {
    const messages = await problemsOf((_blueprint, scene) => {
      scene.shots[1].toUnit = "cue";
    });
    expect(messages.some((message) => message.includes("A move goes to another camera Anchor or unit"))).toBe(true);
  });

  it("stops the compile on a shot on the cue's unit with no unit to take", async () => {
    const { root, blueprintPath } = await workspace((blueprint) => {
      blueprint.screenplay.script.cues = blueprint.screenplay.script.cues.map((entry: any) => (entry.scene === 2 ? { scene: 2, cue: { type: "anchorDies", anchorId: "nova" } } : entry));
    });
    await expect(compileMission(await loadWorkspace(root), blueprintPath, path.join(await tempFolder(), "Out.SC2Map"))).rejects.toThrow(/raid\.json shots\.0\.unit: The shot aims at the cue's unit/);
  });
});
