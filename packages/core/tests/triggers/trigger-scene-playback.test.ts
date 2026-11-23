// A trigger scene played from its scene's cue: the `cinematic` fixture Workspace's Radio Field plays
// scene 1 as a Cinematic at mission start, and here also plays a scene 2 of one line as a trigger
// scene straight after it, on two camera Anchors: a held wide, then an eased move under the line to
// the goal. The compiled map's MapScript.galaxy and Triggers are read back.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { timedTriggerScene, TRIGGER_SCENE_TIMES } from "../../src/cutscene/trigger-scene.js";
import type { ScriptLine } from "../../src/script/name-script.js";
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
  cameraValues: [
    { index: "Distance", value: 30 },
    { index: "Pitch", value: 50 },
    { index: "Yaw", value: 180 },
    { index: "FieldOfView", value: 27.8 },
  ],
});

/** A held wide on cam-wide, an eased move to cam-goal under the line, a held beat on the goal, and the handback on the wide. */
const SCENE = {
  shots: [
    { camera: "cam-wide", afterMs: 0, pauseAfterMs: 1000 },
    { camera: "cam-wide", to: "cam-goal", line: LINE },
    { camera: "cam-goal", afterMs: 0, pauseAfterMs: 1500 },
  ],
  handback: { camera: "cam-wide" },
};

/** Radio Field with scene 2 as the trigger scene `landing`, cued at mission start after the Cinematic's scene 1. */
async function workspace(edit: (blueprint: any, scene: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-wide", 20, 20), camera("cam-goal", 44, 40)];
  blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "missionStart" } });
  blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 2 }];
  const scene = structuredClone(SCENE);
  edit(blueprint, scene);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  await writeFile(path.join(mission, "trigger-scenes/landing.json"), JSON.stringify(scene));
  return { root, blueprintPath };
}

async function compiled(edit?: (blueprint: any, scene: any) => void): Promise<{ script: string; triggers: string }> {
  const { root, blueprintPath } = await workspace(edit);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return { script: await readFile(path.join(map, "MapScript.galaxy"), "utf8"), triggers: await readFile(path.join(map, "Triggers"), "utf8") };
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const lines = (...statements: string[]): string => statements.map((statement) => (statement ? `    ${statement}` : "")).join("\r\n");
const WIDE = stableObjectId("cam-wide");
const GOAL = stableObjectId("cam-goal");

describe("a trigger scene played from its cue", () => {
  it("plays in place of its scene's Transmissions, after the Cinematic on the same cue", async () => {
    const { script } = await compiled();
    const start = section(script, "MissionStart");
    expect(start).toContain(
      lines(
        // One skip for both: the Cinematic hands on, and the scene takes its skip as it starts.
        "gv_cinematic_radio_hand_on = true;",
        "TriggerExecute(gt_CinematicRadio, true, true);",
        "gv_trigger_scene_landing_skipped = (gv_cinematic_radio_completed == false);",
        "gv_trigger_scene_landing_after_cinematic = true;",
        "TriggerExecute(gt_TriggerSceneLandingSetup, true, true);",
      ),
    );
    // Scene 2's one line plays only inside the trigger scene.
    expect(start).not.toContain('SoundLink("radio_field-2-1", -1)');
    expect(section(script, "TriggerSceneLandingCinematic")).toContain('SoundLink("radio_field-2-1", -1)');
  });

  it("sets up under black in Cinematic Mode at full screen, with AI time paused and the camera locked and saved", async () => {
    const { script } = await compiled();
    expect(section(script, "TriggerSceneLandingSetup")).toContain(
      lines(
        "CinematicFade(false, 0.0, c_fadeStyleNormal, Color(0.00, 0.00, 0.00), 0.0, true);",
        "libNtve_gf_CinematicMode(true, PlayerGroupAll(), 0.0);",
        "UISetMode(PlayerGroupAll(), c_uiModeFullscreen, 0.0);",
        // The mission music, paused by default (it's paused already after the Cinematic).
        "SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryMusic, true, true);",
        "gv_trigger_scene_landing_ai_was_paused = AITimeIsPaused();",
        "AITimePause(true);",
        "CameraLockInput(1, true);",
        "CameraSave(1);",
        "gv_trigger_scene_landing_completed = false;",
        // Skipped in the Cinematic: straight to the cleanup.
        "if ((gv_trigger_scene_landing_skipped == false)) {",
        "    TriggerExecute(gt_TriggerSceneLandingCinematic, true, true);",
        "    TriggerExecute(gt_TriggerSceneLandingCinematicEnd, true, true);",
        "}",
        "",
        "TriggerExecute(gt_TriggerSceneLandingCleanup, true, true);",
      ),
    );
    expect(script).not.toContain("StoryMode");
  });

  it("cuts to the first camera under black, then skippably fades in and plays each shot's move and line", async () => {
    const { script } = await compiled();
    const cinematic = section(script, "TriggerSceneLandingCinematic");
    // The move lasts its line, which a placeholder voice times by the estimate.
    const move = cinematic.match(new RegExp(`CameraApplyInfo\\(1, CameraInfoFromId\\(${GOAL}\\), ([\\d.]+), -1, 10\\.0, true\\);`));
    expect(move).not.toBeNull();
    expect(Number(move![1])).toBeGreaterThan(0.5);
    expect(cinematic).toContain(
      lines(
        `CameraApplyInfo(1, CameraInfoFromId(${WIDE}), 0.0, -1, 10.0, true);`,
        "TriggerSkippableBegin(PlayerGroupAll(), 0, null, true, false);",
        "CinematicFade(true, 1.5, c_fadeStyleNormal, Color(0.00, 0.00, 0.00), 0.0, true);",
        "Wait(1.0, c_timeReal);",
        // Shot 2 starts on the wide shot 1 held, so it moves without a cut.
        `CameraApplyInfo(1, CameraInfoFromId(${GOAL}), ${move![1]}, -1, 10.0, true);`,
      ),
    );
    // The line, kept and waited (ADR 0013), then shot 3's hold on the goal (no cut: shot 2 ended there), then done.
    const line = cinematic.indexOf("TransmissionSendForPlayerSelect(");
    expect(line).toBeGreaterThan(cinematic.indexOf(`CameraInfoFromId(${GOAL})`));
    expect(cinematic.slice(line)).toMatch(
      /c_transmissionDurationAdd, false, c_maxPlayers, false\);\r\n {4}gv_script_trigger_scene_line = TransmissionLastSent\(\);\r\n {4}TransmissionWait\(gv_script_trigger_scene_line, 0\.0\);\r\n {4}Wait\(1\.5, c_timeReal\);\r\n {4}gv_trigger_scene_landing_completed = true;/,
    );
    expect(cinematic.match(/CameraApplyInfo\(/g)).toHaveLength(2);
  });

  it("fades out over 2.0 s at the natural end, or 0.5 s after a skip", async () => {
    const { script } = await compiled();
    expect(section(script, "TriggerSceneLandingCinematicEnd")).toContain(
      lines(
        "if ((gv_trigger_scene_landing_completed == true)) {",
        "    CinematicFade(false, 2.0, c_fadeStyleNormal, Color(0.00, 0.00, 0.00), 0.0, true);",
        "}",
        "else {",
        "    CinematicFade(false, 0.5, c_fadeStyleNormal, Color(0.00, 0.00, 0.00), 0.0, true);",
        "}",
      ),
    );
  });

  it("cleans up under black, then hands back with the camera, the fade in and Cinematic Mode off over one duration", async () => {
    const { script } = await compiled();
    const handback = (seconds: string) => [
      `    CameraApplyInfo(1, CameraInfoFromId(${WIDE}), ${seconds}, -1, 10.0, true);`,
      `    libNtve_gf_CinematicMode(false, PlayerGroupAll(), ${seconds});`,
      // Waited, so what the cue plays next starts once control is back.
      `    CinematicFade(true, ${seconds}, c_fadeStyleNormal, Color(0.00, 0.00, 0.00), 0.0, true);`,
    ];
    expect(section(script, "TriggerSceneLandingCleanup")).toContain(
      lines(
        // Only its own line, if a skip left it playing (ADR 0013).
        "TransmissionClear(gv_script_trigger_scene_line);",
        "CameraLockInput(1, false);",
        "if ((gv_trigger_scene_landing_ai_was_paused == false)) {",
        "    AITimePause(false);",
        "}",
        "",
        "if ((gv_trigger_scene_landing_completed == true)) {",
        ...handback("1.5"),
        "}",
        "else {",
        ...handback("1.0"),
        "}",
        // The music back: this scene paused it, and after the Cinematic it was paused for this handback.
        "SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryMusic, false, true);",
      ),
    );
  });

  it("restores the camera the player had when it names no handback camera", async () => {
    const { script } = await compiled((_blueprint, scene) => {
      delete scene.handback;
    });
    const cleanup = section(script, "TriggerSceneLandingCleanup");
    expect(cleanup).toContain("CameraRestore(1, 1.5, -1.0, 10.0);");
    expect(cleanup).toContain("CameraRestore(1, 1.0, -1.0, 10.0);");
  });

  it("chains after the Cinematic: a skip there skips the scene, and the Cinematic hands on under black with Cinematic Mode on and the music paused", async () => {
    const { script } = await compiled();
    const cinematic = section(script, "CinematicRadio");
    // Watched to the end or skipped, the run records which; no flag is shared between cues.
    expect(cinematic).toContain(lines("gv_cinematic_radio_completed = false;", "TriggerExecute(gt_CinematicRadioWatch, true, true);"));
    expect(script).not.toContain("gv_scene_chain_skipped");
    expect(section(script, "CinematicRadioWatch")).toContain(lines("WaitForCutsceneToEnd(gv_cinematic_radio_cutscene);", "gv_cinematic_radio_completed = true;"));
    expect(cinematic).toContain(
      lines(
        "if ((gv_cinematic_radio_hand_on == true)) {",
        "    CinematicFade(false, 0.0, c_fadeStyleNormal, Color(0.00, 0.00, 0.00), 0.0, true);",
        "}",
        "",
        "DialogDestroy(gv_cinematic_radio_dialog);",
        "if ((gv_cinematic_radio_hand_on == false)) {",
        "    libNtve_gf_CinematicMode(false, PlayerGroupAll(), 0.0);",
        "}",
        "",
        "SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryAmbience, false, true);",
        "if ((gv_cinematic_radio_hand_on == false)) {",
        "    SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryMusic, false, true);",
        "}",
        "",
        "gv_cinematic_radio_hand_on = false;",
      ),
    );
  });

  it("leaves a Cinematic with no trigger scene after it as it was", async () => {
    const { script } = await compiled((blueprint) => {
      // Scene 2 plays when the field is entered, so the Cinematic plays alone at mission start.
      blueprint.anchors.push({ id: "nova", name: "Nova", zoneId: "field", kind: "unit", unitType: "Marine", player: 1, position: { x: 10, y: 10, z: 0 }, rotation: 0 });
      blueprint.screenplay.script.cues = blueprint.screenplay.script.cues.map((entry: any) =>
        entry.scene === 2 ? { scene: 2, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" } } : entry,
      );
    });
    expect(script).toContain(lines("gv_trigger_scene_landing_skipped = false;", "gv_trigger_scene_landing_after_cinematic = false;", "TriggerExecute(gt_TriggerSceneLandingSetup, true, true);"));
    expect(script).not.toContain("gv_cinematic_radio_hand_on");
    expect(script).not.toContain("gv_cinematic_radio_completed");
  });

  it("isn't skipped on a cue of its own by a skipped opening", async () => {
    const { script } = await compiled((blueprint) => {
      blueprint.anchors.push({ id: "nova", name: "Nova", zoneId: "field", kind: "unit", unitType: "Marine", player: 1, position: { x: 10, y: 10, z: 0 }, rotation: 0 });
      blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" } });
    });
    expect(script).toContain(lines("gv_trigger_scene_landing_skipped = false;", "gv_trigger_scene_landing_after_cinematic = false;", "TriggerExecute(gt_TriggerSceneLandingSetup, true, true);"));
    // Two runs: after the Cinematic at mission start, and alone when Nova reaches the field.
    expect(script.match(/TriggerExecute\(gt_TriggerSceneLandingSetup, true, true\);/g)).toHaveLength(2);
  });

  it("holds the mission-start goal timers until the trigger scene hands back", async () => {
    const { script } = await compiled((blueprint) => {
      blueprint.outcomes = { victory: [{ type: "timer", seconds: 300 }], defeat: [] };
    });
    const start = section(script, "MissionStart");
    expect(start.indexOf("TimerStart(gv_goal_timer_300, 300.0")).toBeGreaterThan(start.indexOf("TriggerExecute(gt_TriggerSceneLandingSetup"));
  });

  it("references camera Anchors as camera objects, and Cinematic Fade's black in the Editor's form", async () => {
    const { triggers } = await compiled();
    expect(triggers).not.toContain("CustomScript");
    expect(triggers).toContain(`<ValueType Type="camerainfo"/>\r\n        <ValueId Id="${WIDE}"/>`);
    expect(triggers).toContain('<Value>255,0,0,0</Value>\r\n        <ValueType Type="color"/>');
    // Apply Camera Object, Cinematic Fade, Save Camera, Restore Camera and Clear Transmission are NativeLib's.
    for (const id of ["A1037B3E", "D8A9F49F", "503F3DE6", "F14A27E9"]) expect(triggers).toContain(`<FunctionDef Type="FunctionDef" Library="Ntve" Id="${id}"/>`);
  });
});

describe("a trigger scene's file", () => {
  it("is checked against the Blueprint's camera Anchors and the scene's lines", async () => {
    const { root } = await workspace((_blueprint, scene) => {
      scene.shots[0].camera = "cam-nowhere";
      scene.shots[1].line = "radio_field-2-9";
    });
    const { problems } = await checkWorkspace(root);
    const messages = problems.map((problem) => `${problem.path ?? ""}: ${problem.message}`);
    expect(messages).toContain("shots.0.camera: No camera Anchor cam-nowhere in the Blueprint");
    expect(messages).toContain("shots.1.line: No line radio_field-2-9 in scene 2");
  });

  it("has a first shot that waits after nothing refused", async () => {
    const { root } = await workspace((_blueprint, scene) => {
      scene.shots[0].afterMs = 500;
    });
    const { problems } = await checkWorkspace(root);
    expect(problems.map((problem) => `${problem.path ?? ""}: ${problem.message}`)).toContain(
      "shots.0.afterMs: The first shot starts the scene, so it has nothing to wait after; give it afterMs 0, or a pauseAfterMs to hold it",
    );
  });

  it("stops the compile when it can't be built", async () => {
    const { root, blueprintPath } = await workspace((_blueprint, scene) => {
      scene.shots[1].to = "cam-nowhere";
    });
    await expect(compileMission(await loadWorkspace(root), blueprintPath, path.join(await tempFolder(), "Out.SC2Map"))).rejects.toThrow(
      /trigger scenes can't be compiled: .*landing\.json shots\.1\.to: No camera Anchor cam-nowhere/,
    );
  });

  it("is a scene's only Cinematic or trigger scene", async () => {
    const { root } = await workspace((blueprint) => {
      blueprint.screenplay.script.triggerScenes.push({ id: "again", scene: 1 });
    });
    const { problems } = await checkWorkspace(root);
    expect(problems.map((problem) => problem.message)).toContain("Scene 1 already has a Cinematic");
  });
});

describe("a trigger scene's timing", () => {
  const line = (soundId: string): ScriptLine => ({ kind: "line", speaker: "NOVA", character: "Nova", characterId: "Nova", soundId, lineId: soundId, soundLine: soundId, text: "Go.", spans: [] });
  const loaded = (shots: any[]) => ({ id: "t", index: 0, scene: 1, file: "t.json", triggerScene: { shots } });

  it("gives each shot its lines and its length from its cut, the first through the fade in", () => {
    const lines = [line("a"), line("b"), line("c")];
    const lengths = new Map([["a", 2000], ["b", 3000], ["c", 1000]]);
    const timed = timedTriggerScene(
      loaded([
        { camera: "w", afterMs: 0, pauseAfterMs: 500 },
        { camera: "w", to: "g", line: "b" },
        { camera: "g", afterMs: 250, pauseAfterMs: 1000 },
      ]),
      lines,
      lengths,
    );
    // The first shot carries the lines before the first shot on a line; a later shot with no line carries none.
    expect(timed.shots.map((shot) => shot.lines.map((spoken) => spoken.soundId))).toEqual([["a"], ["b", "c"], []]);
    expect(timed.shots.map((shot) => shot.durationMs)).toEqual([TRIGGER_SCENE_TIMES.fadeInMs + 2000 + 500, 3000 + 1000 + 250, 1000]);
  });
});
