// A trigger scene's music (cinematography RECIPES.md "Music"): the mission music paused with a fade
// or kept and lowered under the lines, and cues from an in-point, all stopped and put back in the
// one cleanup. The fixture is trigger-scene-playback.test.ts's: Radio Field's scene 2 as the trigger
// scene `landing`, here cued on its own when Nova enters the field, unless a test chains it after
// the mission-start Cinematic.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENE_2 = ["", "## Scene 2: THE FIELD", "", "**NOVA** `D-01-01-02-001-NOVA`: Move out.", ""].join("\n");
const LINE = "radio_field-2-1";
const SCENE_3 = ["", "## Scene 3: THE RAID", "", "**NOVA** `D-01-01-03-001-NOVA`: Here they come.", ""].join("\n");
/** Scene 3: a held wide under its line, with a cue from 4 s into its file on the line. */
const RAID = {
  shots: [{ camera: "cam-wide", line: "radio_field-3-1", pauseAfterMs: 1000 }],
  music: { cues: [{ sound: "LOTV_Music_P05CinePart02", line: "radio_field-3-1", fromMs: 4000 }] },
};

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

/** A held wide on cam-wide, then an eased move to cam-goal under the line. */
const SCENE = {
  shots: [
    { camera: "cam-wide", afterMs: 0, pauseAfterMs: 1000 },
    { camera: "cam-wide", to: "cam-goal", line: LINE },
  ],
};

const NOVA = { id: "nova", name: "Nova", zoneId: "field", kind: "unit", unitType: "Marine", player: 1, position: { x: 10, y: 10, z: 0 }, rotation: 0 };

/** Radio Field with scene 2 as the trigger scene `landing`, cued on its own when Nova enters the field. */
async function workspace(edit: (blueprint: any, scene: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-wide", 20, 20), camera("cam-goal", 44, 40), NOVA];
  blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" } });
  blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 2 }];
  const scene = structuredClone(SCENE);
  edit(blueprint, scene);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  await writeFile(path.join(mission, "trigger-scenes/landing.json"), JSON.stringify(scene));
  if (blueprint.screenplay.script.triggerScenes.some((entry: any) => entry.id === "raid")) {
    await appendFile(path.join(mission, "radio-field.md"), SCENE_3);
    await writeFile(path.join(mission, "trigger-scenes/raid.json"), JSON.stringify(RAID));
  }
  return { root, blueprintPath };
}

/** Scene 2 straight after the mission-start Cinematic, which hands on to it with the music paused (ADR 0012). */
const chained = (blueprint: any): void => {
  blueprint.screenplay.script.cues = blueprint.screenplay.script.cues.map((entry: any) => (entry.scene === 2 ? { scene: 2, cue: { type: "missionStart" } } : entry));
};

async function compiled(edit?: (blueprint: any, scene: any) => void): Promise<string> {
  const { root, blueprintPath } = await workspace(edit);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return readFile(path.join(map, "MapScript.galaxy"), "utf8");
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const lines = (...statements: string[]): string => statements.map((statement) => (statement ? `    ${statement}` : "")).join("\r\n");
const PAUSE = "SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryMusic, true, true);";
const UNPAUSE = "SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryMusic, false, true);";

describe("a trigger scene's mission music", () => {
  it("is paused with a fade under black by default, and brought back by the cleanup on either path", async () => {
    const script = await compiled();
    const setup = section(script, "TriggerSceneLandingSetup");
    expect(setup).toContain(lines("UISetMode(PlayerGroupAll(), c_uiModeFullscreen, 0.0);", PAUSE));
    // Not in the skippable part: a skip still runs the cleanup that unpauses it.
    expect(section(script, "TriggerSceneLandingCinematic")).not.toContain("SoundtrackPause");
    const cleanup = section(script, "TriggerSceneLandingCleanup");
    expect(cleanup).toContain(UNPAUSE);
    expect(cleanup).not.toContain("gv_trigger_scene_landing_after_cinematic == true");
  });

  it("kept, plays on lowered under the lines in Speech mode, and comes back to Game mode at the handback", async () => {
    const script = await compiled((_blueprint, scene) => {
      scene.music = { mission: "keep" };
    });
    const setup = section(script, "TriggerSceneLandingSetup");
    expect(setup).not.toContain(PAUSE);
    expect(setup).toContain(
      lines(
        "UISetMode(PlayerGroupAll(), c_uiModeFullscreen, 0.0);",
        // After a Cinematic that handed on with it paused, it's brought back under black, to play on under the lines.
        "if ((gv_trigger_scene_landing_after_cinematic == true)) {",
        `    ${UNPAUSE}`,
        "}",
        "",
        "libNtve_gf_SetAllSoundChannelVolumes(libNtve_ge_VolumeChannelMode_Speech, PlayerGroupAll(), 0.5);",
      ),
    );
    const cleanup = section(script, "TriggerSceneLandingCleanup");
    expect(cleanup).toContain("libNtve_gf_SetAllSoundChannelVolumes(libNtve_ge_VolumeChannelMode_Game, PlayerGroupAll(), 0.5);");
    // Never paused by this scene, so it's unpaused only after a Cinematic that handed on with it paused.
    expect(cleanup).toContain(lines("if ((gv_trigger_scene_landing_after_cinematic == true)) {", `    ${UNPAUSE}`, "}"));
  });
});

const MUSIC = "LOTV_Music_P05CinePart02";

describe("a trigger scene's music cue", () => {
  /** A cue on the line from 4 s into its file, faded from 6 s into the scene over 1 s, over the kept mission music. */
  const cued = (_blueprint: any, scene: any): void => {
    scene.music = { mission: "keep", cues: [{ sound: MUSIC, line: LINE, fromMs: 4000, untilMs: 6000, fadeOutMs: 1000 }] };
  };

  it("starts on its line from its in-point, with the mission music dipped under it, and fades from its until", async () => {
    const script = await compiled(cued);
    const cinematic = section(script, "TriggerSceneLandingCinematic");
    expect(cinematic.indexOf("gv_trigger_scene_landing_playing = true;")).toBeLessThan(cinematic.indexOf("CameraApplyInfo("));
    // Started without a wait just before its line, so the lines keep their time.
    const start = cinematic.indexOf("TriggerExecute(gt_TriggerSceneLandingMusic1, true, false);");
    expect(start).toBeGreaterThan(cinematic.lastIndexOf("CameraApplyInfo("));
    expect(start).toBeLessThan(cinematic.indexOf("TransmissionSendForPlayerSelect("));
    // The line starts 2.5 s into the scene (the 1.5 s fade in and the wide's 1 s hold), so the fade waits 3.5 s.
    expect(section(script, "TriggerSceneLandingMusic1")).toContain(
      lines(
        "if ((gv_trigger_scene_landing_playing == true)) {",
        `    ${PAUSE}`,
        `    SoundPlayForPlayer(SoundLink("${MUSIC}", -1), c_maxPlayers, PlayerGroupAll(), 100.0, 4.0);`,
        "    gv_trigger_scene_landing_music_1 = SoundLastPlayed();",
        "}",
        "",
        "Wait(3.5, c_timeReal);",
        // Down to silence in four steps over its 1 s fade, then stopped, each step only while the scene plays.
        ...[75, 50, 25, 0].flatMap((volume) => ["Wait(0.25, c_timeReal);", "if ((gv_trigger_scene_landing_playing == true)) {", `    SoundSetVolume(gv_trigger_scene_landing_music_1, ${volume.toFixed(1)});`, "}", ""]),
        "if ((gv_trigger_scene_landing_playing == true)) {",
        "    SoundStop(gv_trigger_scene_landing_music_1, false);",
        "}",
      ),
    );
  });

  it("is stopped with a fade by the cleanup, skipped or watched, and the mission music it dipped comes back", async () => {
    const script = await compiled(cued);
    // From the Cinematic End's fade out on, skipped or watched, no cue starts or fades.
    expect(section(script, "TriggerSceneLandingCinematicEnd")).toContain(lines("gv_trigger_scene_landing_playing = false;", "if ((gv_trigger_scene_landing_completed == true)) {"));
    const cleanup = section(script, "TriggerSceneLandingCleanup");
    expect(cleanup).toContain(
      lines(
        // Before anything waits, so a cue still to start never does.
        "gv_trigger_scene_landing_playing = false;",
        "if ((gv_trigger_scene_landing_music_1 != null)) {",
        "    SoundStop(gv_trigger_scene_landing_music_1, true);",
        "}",
      ),
    );
    expect(cleanup).toContain("libNtve_gf_SetAllSoundChannelVolumes(libNtve_ge_VolumeChannelMode_Game, PlayerGroupAll(), 0.5);");
    expect(cleanup).toContain(UNPAUSE);
    expect(cleanup).not.toContain("gv_trigger_scene_landing_after_cinematic == true");
  });

  it("starts at its time on its own thread, and after the Cinematic it hands on from leaves the paused music for the cleanup", async () => {
    const { root, blueprintPath } = await workspace((blueprint, scene) => {
      chained(blueprint);
      scene.music = { cues: [{ sound: MUSIC, atMs: 2000, untilMs: 5000, volume: 0.8 }] };
    });
    const map = path.join(await tempFolder(), "RadioField.SC2Map");
    await compileMission(await loadWorkspace(root), blueprintPath, map);
    const script = await readFile(path.join(map, "MapScript.galaxy"), "utf8");
    expect(section(script, "TriggerSceneLandingCinematic")).toContain(lines("gv_trigger_scene_landing_playing = true;", "TriggerExecute(gt_TriggerSceneLandingMusic1, true, false);"));
    expect(section(script, "TriggerSceneLandingMusic1")).toContain(
      lines(
        "Wait(2.0, c_timeReal);",
        // Paused already: the scene doesn't dip it again.
        "if ((gv_trigger_scene_landing_playing == true)) {",
        `    SoundPlayForPlayer(SoundLink("${MUSIC}", -1), c_maxPlayers, PlayerGroupAll(), 80.0, 0.0);`,
        "    gv_trigger_scene_landing_music_1 = SoundLastPlayed();",
        "}",
        "",
        "Wait(3.0, c_timeReal);",
        "if ((gv_trigger_scene_landing_playing == true)) {",
        // No fadeOutMs: the engine's own fade.
        "    SoundStop(gv_trigger_scene_landing_music_1, true);",
        "}",
      ),
    );
    // Under the lines, Speech mode; the cleanup puts Game mode back and always unpauses.
    expect(section(script, "TriggerSceneLandingSetup")).toContain(lines(PAUSE, "libNtve_gf_SetAllSoundChannelVolumes(libNtve_ge_VolumeChannelMode_Speech, PlayerGroupAll(), 0.5);"));
    const cleanup = section(script, "TriggerSceneLandingCleanup");
    expect(cleanup).toContain("libNtve_gf_SetAllSoundChannelVolumes(libNtve_ge_VolumeChannelMode_Game, PlayerGroupAll(), 0.5);");
    expect(cleanup).toContain(UNPAUSE);
    // Its handle is a sound variable, No Sound until it plays.
    expect(script).toContain("sound gv_trigger_scene_landing_music_1;");
    const triggers = await readFile(path.join(map, "Triggers"), "utf8");
    expect(triggers).toContain('<Type Value="sound"/>');
    expect(triggers).toContain('<Preset Type="PresetValue" Library="Ntve" Id="7B90D057"/>');
  });
});

describe("two trigger scenes' music in one mission", () => {
  it("compiles a kept-and-lowered scene and a scene with a cue from an in-point, and each cleanup stops its cues and brings the mission music back", async () => {
    const script = await compiled((blueprint, scene) => {
      scene.music = { mission: "keep" };
      // Scene 3, played when Nova reaches the field again, with its own cue over the paused mission music.
      blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" } });
      blueprint.screenplay.script.triggerScenes.push({ id: "raid", scene: 3 });
    });
    const keep = section(script, "TriggerSceneLandingCleanup");
    expect(keep).toContain("libNtve_gf_SetAllSoundChannelVolumes(libNtve_ge_VolumeChannelMode_Game, PlayerGroupAll(), 0.5);");
    expect(keep).not.toContain("SoundStop(");
    const raid = section(script, "TriggerSceneRaidCleanup");
    expect(raid).toContain(lines("gv_trigger_scene_raid_playing = false;", "if ((gv_trigger_scene_raid_music_1 != null)) {", "    SoundStop(gv_trigger_scene_raid_music_1, true);", "}"));
    expect(raid).toContain(UNPAUSE);
    expect(section(script, "TriggerSceneRaidMusic1")).toContain(`SoundPlayForPlayer(SoundLink("${MUSIC}", -1), c_maxPlayers, PlayerGroupAll(), 100.0, 4.0);`);
  });
});

describe("a trigger scene's music, checked", () => {
  const messages = async (cues: any[]): Promise<string[]> => {
    const { root } = await workspace((_blueprint, scene) => {
      scene.music = { cues };
    });
    const { problems } = await checkWorkspace(root);
    return problems.filter((problem) => problem.file.endsWith("landing.json")).map((problem) => `${problem.severity ?? "error"} ${problem.path ?? ""}: ${problem.message}`);
  };

  it("passes cues that play a loaded Music Sound and end before the scene does", async () => {
    expect(await messages([{ sound: MUSIC, line: LINE, fromMs: 4000, untilMs: 3000, fadeOutMs: 500 }])).toEqual([]);
  });

  it("warns of a Sound our maps don't load (M1), and refuses a line the scene doesn't have", async () => {
    expect(await messages([{ sound: "Nowhere_Music", line: "radio_field-2-9" }])).toEqual([
      "warning music.cues.0.sound: M1: Nowhere_Music isn't a Music Sound our maps load (the game's in our dependency stack, not a silent or empty one); a map-defined CSound needs the plan to say so",
      "error music.cues.0.line: No line radio_field-2-9 in scene 2",
    ]);
  });

  it("warns of a cue still playing when the scene ends, which only the cleanup stops (M4)", async () => {
    const LONG = "LOTV_Music_P07CinePart02";
    const found = await messages([{ sound: LONG }, { sound: LONG, atMs: 1000, untilMs: 60000 }, { sound: MUSIC, fromMs: 4000 }]);
    // The third's file (5.2 s) runs out 1.2 s in, before the scene ends: no warning.
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/^warning music\.cues\.0: M4: cue 1 still plays when the scene ends at [\d.]+ s, so the cleanup cuts it off with a fade; give it an untilMs \(and a fadeOutMs\) to end it on purpose$/);
    expect(found[1]).toMatch(/^warning music\.cues\.1: M4: cue 2 fades from 60\.0 s, after the scene ends at [\d.]+ s/);
  });

  it("refuses a cue that starts once the scene has ended", async () => {
    expect(await messages([{ sound: MUSIC, atMs: 60000 }])).toEqual([expect.stringMatching(/^error music\.cues\.0: Cue 1 starts at 60\.0 s, once the scene has ended at [\d.]+ s, so it never plays$/)]);
  });

  it("refuses a cue that fades from before it starts", async () => {
    // The line starts 2.5 s in.
    expect(await messages([{ sound: MUSIC, line: LINE, untilMs: 2000 }])).toEqual(["error music.cues.0.untilMs: Cue 1 fades from 2.0 s, before it starts on radio_field-2-1 at 2.5 s"]);
  });
});

