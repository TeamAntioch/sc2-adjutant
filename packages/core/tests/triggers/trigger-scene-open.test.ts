// A trigger scene that opens with no fade (`open.fade: false`, #484), on the `cinematic` fixture
// Workspace's Radio Field: a scene 2 of one line plays as the trigger scene `landing` when Nova
// reaches the field, on two camera Anchors. No black at Setup: Cinematic Mode comes on and the
// camera eases from where the player was looking to the first shot's over `easeMs`. Setup's changes
// under black are refused beside it, and so is a scene chained after another, which opens on black.
// The compiled MapScript.galaxy is read back.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TriggerSceneSchema } from "../../src/domain/trigger-scene.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENE_2 = ["", "## Scene 2: THE FIELD", "", "**NOVA** `D-01-01-02-001-NOVA`: Move out.", "", "## Scene 3: THE RIDGE", "", "**NOVA** `D-01-01-03-001-NOVA`: Up there.", ""].join("\n");

const camera = (id: string, x: number, y: number) => ({
  id,
  name: id,
  zoneId: "field",
  kind: "camera",
  position: { x, y },
  cameraTarget: { x, y },
  cameraValues: [
    { index: "Distance", value: 30 },
    { index: "Pitch", value: 50 },
    { index: "Yaw", value: 180 },
    { index: "FieldOfView", value: 27.8 },
  ],
});
const unit = (id: string, x: number, y: number) => ({ id, name: id, zoneId: "field", kind: "unit", unitType: "Marine", player: 1, position: { x, y, z: 0 }, rotation: 0 });
const point = (id: string, x: number, y: number) => ({ id, name: id, zoneId: "field", kind: "point", position: { x, y } });

const REACHES_FIELD = { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" };
/** A held wide, opened in play, then the goal on the line. */
const SCENE = { open: { fade: false }, shots: [{ camera: "cam-wide", afterMs: 0, pauseAfterMs: 2000 }, { camera: "cam-goal", line: "radio_field-2-1" }] };
const RIDGE = { shots: [{ camera: "cam-goal", afterMs: 0 }] };

/** Radio Field with scene 2 as the trigger scene `landing`, cued when Nova reaches the field (scene 3's `ridge` is written beside it, for a chain). */
async function workspace(edit: (blueprint: any, scene: any, ridge: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-wide", 20, 20), camera("cam-goal", 44, 40), unit("nova", 10, 10), point("spot", 30, 30)];
  blueprint.screenplay.script.cues.push({ scene: 2, cue: REACHES_FIELD });
  blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 2 }];
  const scene = structuredClone(SCENE);
  const ridge = structuredClone(RIDGE);
  edit(blueprint, scene, ridge);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  await writeFile(path.join(mission, "trigger-scenes/landing.json"), JSON.stringify(scene));
  await writeFile(path.join(mission, "trigger-scenes/ridge.json"), JSON.stringify(ridge));
  return { root, blueprintPath };
}

async function compiled(edit?: (blueprint: any, scene: any, ridge: any) => void): Promise<string> {
  const { root, blueprintPath } = await workspace(edit);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return readFile(path.join(map, "MapScript.galaxy"), "utf8");
}

/** The check's errors, as `path: message`. */
async function problemsOf(edit: (blueprint: any, scene: any, ridge: any) => void): Promise<string[]> {
  const { root } = await workspace(edit);
  const { problems } = await checkWorkspace(root);
  return problems.filter((problem) => problem.severity === undefined || problem.severity === "error").map((problem) => `${problem.path ?? ""}: ${problem.message}`);
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const lines = (...statements: string[]): string => statements.map((statement) => (statement ? `    ${statement}` : "")).join("\r\n");
const WIDE = stableObjectId("cam-wide");
const GOAL = stableObjectId("cam-goal");
const NOVA = stableObjectId("nova");

describe("a trigger scene that opens with no fade", () => {
  it("goes to no black at Setup: Cinematic Mode comes on over the ease, and the camera is locked and saved as before", async () => {
    const setup = section(await compiled(), "TriggerSceneLandingSetup");
    expect(setup).not.toContain("CinematicFade(");
    expect(setup).toContain(
      lines(
        "libNtve_gf_CinematicMode(true, PlayerGroupAll(), 1.0);",
        "UISetMode(PlayerGroupAll(), c_uiModeFullscreen, 0.0);",
        "SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryMusic, true, true);",
        "gv_trigger_scene_landing_ai_was_paused = AITimeIsPaused();",
        "AITimePause(true);",
        "CameraLockInput(1, true);",
        "CameraSave(1);",
      ),
    );
  });

  it("reaches the first shot's camera by an eased pan from the player's over 1 s, in place of the cut and the fade in", async () => {
    const cinematic = section(await compiled(), "TriggerSceneLandingCinematic");
    expect(cinematic).toContain(
      lines(
        `CameraApplyInfo(1, CameraInfoFromId(${WIDE}), 1.0, -1, 10.0, true);`,
        "TriggerSkippableBegin(PlayerGroupAll(), 0, null, true, false);",
        "Wait(1.0, c_timeReal);",
        "Wait(2.0, c_timeReal);",
        `CameraApplyInfo(1, CameraInfoFromId(${GOAL}), 0.0, -1, 10.0, true);`,
      ),
    );
    expect(cinematic).not.toContain("CinematicFade(");
    expect(cinematic).not.toContain(`CameraApplyInfo(1, CameraInfoFromId(${WIDE}), 0.0`);
  });

  it("eases over easeMs when the scene gives it", async () => {
    const cinematic = section(
      await compiled((_blueprint, scene) => {
        scene.open = { fade: false, easeMs: 2500 };
      }),
      "TriggerSceneLandingCinematic",
    );
    expect(cinematic).toContain(lines(`CameraApplyInfo(1, CameraInfoFromId(${WIDE}), 2.5, -1, 10.0, true);`, "TriggerSkippableBegin(PlayerGroupAll(), 0, null, true, false);", "Wait(2.5, c_timeReal);"));
    expect(section(await compiled((_blueprint, scene) => (scene.open = { fade: false, easeMs: 2500 })), "TriggerSceneLandingSetup")).toContain("libNtve_gf_CinematicMode(true, PlayerGroupAll(), 2.5);");
  });

  it("starts the first shot's move once the ease has reached its camera, over the rest of the shot", async () => {
    const cinematic = section(
      await compiled((_blueprint, scene) => {
        scene.shots[0].to = "cam-goal";
      }),
      "TriggerSceneLandingCinematic",
    );
    // The shot runs the 1 s ease and its 2 s pause, so its move takes the 2 s left once the ease ends.
    expect(cinematic).toContain(
      lines(
        `CameraApplyInfo(1, CameraInfoFromId(${WIDE}), 1.0, -1, 10.0, true);`,
        "TriggerSkippableBegin(PlayerGroupAll(), 0, null, true, false);",
        "Wait(1.0, c_timeReal);",
        `CameraApplyInfo(1, CameraInfoFromId(${GOAL}), 2.0, -1, 10.0, true);`,
        "Wait(2.0, c_timeReal);",
      ),
    );
  });

  it("times the first shot's move for C4 from the end of the ease", async () => {
    const { root } = await workspace((_blueprint, scene) => {
      scene.shots[0] = { camera: "cam-wide", to: "cam-goal", afterMs: 0, pauseAfterMs: 1000 };
    });
    const { problems } = await checkWorkspace(root);
    // The shot runs the 1 s ease and a 1 s pause; its move, from the ease's end, only the last 1 s.
    expect(problems.map((problem) => problem.message)).toContain("C4: shot 0's move runs 1.0 s, under the 1.5 s a move keeps to: lengthen it with pauseAfterMs, or cut instead (leave out to)");
  });

  it("counts the ease as the camera moving, for C4's share of the scene", async () => {
    const { root } = await workspace((_blueprint, scene) => {
      scene.shots = [{ camera: "cam-wide", afterMs: 0, pauseAfterMs: 3000 }];
      scene.open = { fade: false, easeMs: 2000 };
    });
    const { problems } = await checkWorkspace(root);
    // 2 s of easing in a 5 s scene that otherwise holds: 40%, over C4's about 20%.
    expect(problems.filter((problem) => problem.message.startsWith("C4: the camera moves for"))).toEqual([]);
  });

  it("eases the pan to a unit the first shot is aimed at", async () => {
    const cinematic = section(
      await compiled((_blueprint, scene) => {
        scene.shots[0].unit = { anchorId: "nova" };
      }),
      "TriggerSceneLandingCinematic",
    );
    expect(cinematic).toContain(`CameraApplyInfo(1, CameraInfoFromId(${WIDE}), 1.0, -1, 10.0, false);`);
    expect(cinematic).toContain(`CameraPan(1, UnitGetPosition(UnitFromId(${NOVA})), 1.0, -1, 10.0, false);`);
  });

  it("is skippable from the start of the ease, and a skip there skips to the cleanup as any skip does", async () => {
    const script = await compiled();
    const cinematic = section(script, "TriggerSceneLandingCinematic");
    expect(cinematic.indexOf("TriggerSkippableBegin(")).toBeLessThan(cinematic.indexOf("Wait(1.0, c_timeReal);"));
    expect(section(script, "TriggerSceneLandingCinematicEnd")).toContain("CinematicFade(false, 0.5");
    // The cleanup lands the player's camera back on both paths, the one final state.
    const cleanup = section(script, "TriggerSceneLandingCleanup");
    expect(cleanup.match(/CameraRestore\(1, /g)).toHaveLength(2);
  });

  it("starts its lines once the ease has ended, as they would once the fade in had", async () => {
    const cinematic = section(
      await compiled((_blueprint, scene) => {
        scene.shots = [{ camera: "cam-wide", line: "radio_field-2-1" }];
      }),
      "TriggerSceneLandingCinematic",
    );
    expect(cinematic.indexOf("Wait(1.0, c_timeReal);")).toBeGreaterThan(-1);
    expect(cinematic.indexOf('SoundLink("radio_field-2-1", -1)')).toBeGreaterThan(cinematic.indexOf("Wait(1.0, c_timeReal);"));
  });

  it("leaves a scene that opens from black as it was", async () => {
    const script = await compiled((_blueprint, scene) => {
      delete scene.open;
    });
    expect(section(script, "TriggerSceneLandingSetup")).toContain(lines("CinematicFade(false, 0.0, c_fadeStyleNormal, Color(0.00, 0.00, 0.00), 0.0, true);", "libNtve_gf_CinematicMode(true, PlayerGroupAll(), 0.0);"));
    const cinematic = section(script, "TriggerSceneLandingCinematic");
    expect(cinematic).toContain(lines(`CameraApplyInfo(1, CameraInfoFromId(${WIDE}), 0.0, -1, 10.0, true);`, "TriggerSkippableBegin(PlayerGroupAll(), 0, null, true, false);", "CinematicFade(true, 1.5"));
  });
});

describe("what a scene that opens with no fade refuses", () => {
  it("refuses easeMs on a scene that opens from black", () => {
    const parsed = TriggerSceneSchema.safeParse({ ...SCENE, open: { easeMs: 1000 } });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)).toContain(
      "open.easeMs: easeMs is how long a scene that opens with no fade eases from the player's camera to its first shot's, so it needs fade: false",
    );
  });

  it("refuses a staged cast, marks and hidden live units, which Setup would change in the player's sight", async () => {
    const problems = await problemsOf((_blueprint, scene) => {
      scene.cast = [{ id: "guard", unitType: "Marine", player: 1, at: "spot" }];
      scene.marks = [{ unit: "nova", at: "spot" }];
      scene.live = [{ unit: "nova", hide: true }];
    });
    expect(problems).toContain("cast: The scene opens with no fade (open.fade: false), so Setup would create its staged cast in the player's sight, popping in: open from black, or leave out the cast");
    expect(problems).toContain("marks: The scene opens with no fade (open.fade: false), so Setup would move its marked units in the player's sight, jumping: open from black, or leave out the marks");
    expect(problems).toContain("live.0.hide: The scene opens with no fade (open.fade: false), so Setup would hide nova in the player's sight, vanishing: open from black, or only pause it");
  });

  it("allows a live unit it only pauses", async () => {
    const problems = await problemsOf((_blueprint, scene) => {
      scene.live = [{ unit: "nova", pause: true }];
    });
    expect(problems.filter((problem) => problem.includes("open.fade"))).toEqual([]);
  });

  it("refuses a Light, fog or black mask change, which Setup would make in the player's sight", async () => {
    const problems = await problemsOf((_blueprint, scene) => {
      scene.light = "NightLight";
      scene.fog = { density: 0.05 };
      scene.mask = "off";
    });
    for (const [field, what] of [
      ["light", "switch the Light"],
      ["fog", "change the fog"],
      ["mask", "lift the black mask and the fog of war"],
    ]) {
      expect(problems).toContain(`${field}: The scene opens with no fade (open.fade: false), so Setup would ${what} in the player's sight: open from black, or leave out ${field}`);
    }
  });

  it("refuses a scene played straight after another trigger scene on a cue, which opens on that scene's black", async () => {
    const chained = (blueprint: any, scene: any, ridge: any) => {
      delete scene.open;
      ridge.open = { fade: false };
      blueprint.screenplay.script.cues.push({ scene: 3, cue: REACHES_FIELD });
      blueprint.screenplay.script.triggerScenes.push({ id: "ridge", scene: 3 });
    };
    expect(await problemsOf(chained)).toContain(
      "open.fade: Scene 3 plays straight after scene 2 on its anchorEntersZone cue, and opens on the black that scene hands on under, so it can't open with no fade: open it from black, or play it on its own",
    );
    const { root, blueprintPath } = await workspace(chained);
    // The compile refuses it too, before it writes anything.
    await expect(compileMission(await loadWorkspace(root), blueprintPath, path.join(await tempFolder(), "Out.SC2Map"))).rejects.toThrow(
      "open.fade: Scene 3 plays straight after scene 2 on its anchorEntersZone cue",
    );
  });

  it("finds a chain the compile would make on cues written two ways, as the compile reads them", async () => {
    // A structure's first loss, with and without its count of 1, is one cue.
    const problems = await problemsOf((blueprint, scene, ridge) => {
      delete scene.open;
      ridge.open = { fade: false };
      blueprint.screenplay.script.cues = [
        { scene: 1, cue: { type: "missionStart" } },
        { scene: 2, cue: { type: "structureDies", player: 1, unitType: "Assimilator" } },
        { scene: 3, cue: { type: "structureDies", player: 1, unitType: "Assimilator", count: 1 } },
      ];
      blueprint.screenplay.script.triggerScenes.push({ id: "ridge", scene: 3 });
    });
    expect(problems).toContain(
      "open.fade: Scene 3 plays straight after scene 2 on its structureDies cue, and opens on the black that scene hands on under, so it can't open with no fade: open it from black, or play it on its own",
    );
  });

  it("refuses a scene played straight after a Cinematic on a cue", async () => {
    const problems = await problemsOf((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "missionStart" } });
    });
    expect(problems).toContain(
      "open.fade: Scene 2 plays straight after scene 1 on its missionStart cue, and opens on the black that scene hands on under, so it can't open with no fade: open it from black, or play it on its own",
    );
  });

  it("allows the first scene of a chain, which hands on but opens on the player's view", async () => {
    const problems = await problemsOf((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 3, cue: REACHES_FIELD });
      blueprint.screenplay.script.triggerScenes.push({ id: "ridge", scene: 3 });
    });
    expect(problems.filter((problem) => problem.includes("open"))).toEqual([]);
  });

  it("refuses a victory outro listed by its outcome when a victory condition's cue plays a scene straight before it", async () => {
    const problems = await problemsOf((blueprint, scene, ridge) => {
      delete scene.open;
      blueprint.outcomes = { victory: [REACHES_FIELD], defeat: [] };
      blueprint.screenplay.script.triggerScenes.push({ id: "ridge", outcome: "victory" });
      Object.assign(ridge, { outro: "victory", open: { fade: false } });
    });
    expect(problems).toContain(
      "open.fade: ridge plays last on the victory outcome's anchorEntersZone cue, straight after scene 2, and opens on the black that scene hands on under, so it can't open with no fade: open it from black, or cue that scene elsewhere",
    );
  });
});
