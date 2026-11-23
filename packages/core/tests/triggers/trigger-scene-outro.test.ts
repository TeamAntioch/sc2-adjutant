// A victory outro (#428), on the `cinematic` fixture Workspace's Radio Field: Nova reaching the
// field wins the mission, and scene 2 plays on that cue as the trigger scene `outro`, a camera Anchor
// held for 4 s, which ends the game in victory instead of handing back. The compiled
// MapScript.galaxy is read back.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TRIGGER_SCENE_OUTRO_LENGTH } from "../../src/cutscene/trigger-scene.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENE_2 = ["", "## Scene 2: THE FIELD", "", "**NOVA** `D-01-01-02-001-NOVA`: We're done here.", ""].join("\n");

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

const REACHES_FIELD = { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" };
/** One camera Anchor held for 4 s, then the fade to victory. */
const OUTRO = { outro: "victory", shots: [{ camera: "cam-victory", afterMs: 0, pauseAfterMs: 4000 }] };

/** Radio Field won when Nova reaches the field, with scene 2 played there as the victory outro `outro`. */
async function workspace(edit: (blueprint: any, scene: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-victory", 30, 30), unit("nova", 10, 10)];
  blueprint.outcomes = { victory: [REACHES_FIELD], defeat: [] };
  blueprint.screenplay.script.cues.push({ scene: 2, cue: REACHES_FIELD });
  blueprint.screenplay.script.triggerScenes = [{ id: "outro", scene: 2 }];
  const scene = structuredClone(OUTRO);
  edit(blueprint, scene);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  await writeFile(path.join(mission, "trigger-scenes/outro.json"), JSON.stringify(scene));
  return { root, blueprintPath };
}

async function compiled(edit?: (blueprint: any, scene: any) => void, setup?: (root: string) => Promise<void>): Promise<string> {
  const { root, blueprintPath } = await workspace(edit);
  await setup?.(root);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return readFile(path.join(map, "MapScript.galaxy"), "utf8");
}

async function compileError(edit: (blueprint: any, scene: any) => void): Promise<unknown> {
  const { root, blueprintPath } = await workspace(edit);
  return compileMission(await loadWorkspace(root), blueprintPath, path.join(await tempFolder(), "Out.SC2Map")).then(
    () => undefined,
    (error: unknown) => error,
  );
}

async function problemsOf(edit: (blueprint: any, scene: any) => void): Promise<string[]> {
  const { root } = await workspace(edit);
  const { problems } = await checkWorkspace(root);
  return problems.map((problem) => `${problem.path ?? ""}: ${problem.message}`);
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const lines = (...statements: string[]): string => statements.map((statement) => (statement ? `    ${statement}` : "")).join("\r\n");
const VICTORY_CAMERA = stableObjectId("cam-victory");
const GAME_OVER = "GameOver(1, c_gameOverVictory, true, true);";

describe("a victory outro", () => {
  it("plays from the victory trigger, then ends the game in victory", async () => {
    const victory = section(await compiled(), "novaReachesField");
    expect(victory).toContain(lines("gv_trigger_scene_outro_skipped = false;", "gv_trigger_scene_outro_after_cinematic = false;", "TriggerExecute(gt_TriggerSceneOutroSetup, true, true);", GAME_OVER));
  });

  it("holds its camera Anchor, then fades to black: 2.0 s watched, 0.5 s after a skip", async () => {
    const script = await compiled();
    const cinematic = section(script, "TriggerSceneOutroCinematic");
    expect(cinematic).toContain(`CameraApplyInfo(1, CameraInfoFromId(${VICTORY_CAMERA}), 0.0, -1, 10.0, true);`);
    expect(cinematic).toContain("Wait(4.0, c_timeReal);");
    const end = section(script, "TriggerSceneOutroCinematicEnd");
    expect(end).toContain("CinematicFade(false, 2.0");
    expect(end).toContain("CinematicFade(false, 0.5");
  });

  it("never hands back: the cleanup leaves the screen black and the camera where it is, on both paths", async () => {
    const cleanup = section(await compiled(), "TriggerSceneOutroCleanup");
    // Only its own line, if a skip left it playing (ADR 0013).
    expect(cleanup).toContain("TransmissionClear(gv_script_trigger_scene_line);");
    expect(cleanup).not.toContain("CinematicFade(true");
    expect(cleanup).not.toContain("CameraRestore(");
    expect(cleanup).not.toContain("CameraApplyInfo(");
    expect(cleanup).not.toContain("libNtve_gf_CinematicMode(false");
  });
});

describe("a victory outro's victory", () => {
  it("still runs the victory actions the Mechanics declare, before the outro", async () => {
    const script = await compiled(
      (blueprint) => {
        blueprint.mechanics = [{ id: "bell", type: "bell", params: {} }];
      },
      async (root) => {
        const plugin = path.join(root, "plugins/bell");
        await mkdir(plugin, { recursive: true });
        await writeFile(path.join(plugin, "sc2-adjutant-plugin.json"), JSON.stringify({ name: "bell", version: "0.1.0", pluginApi: 2, roles: [], contributions: { mechanics: ["bell"] }, entry: "./index.ts" }));
        await writeFile(path.join(plugin, "index.ts"), BELL);
        const config = JSON.parse(await readFile(path.join(root, "sc2-adjutant.workspace.json"), "utf8"));
        config.plugins.push("./plugins/bell");
        await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify(config));
      },
    );
    const victory = section(script, "novaReachesField");
    const rung = victory.indexOf("TimerPause(gv_bell_timer, true);");
    expect(rung).toBeGreaterThan(-1);
    expect(victory.indexOf("TriggerExecute(gt_TriggerSceneOutroSetup, true, true);")).toBeGreaterThan(rung);
    expect(victory.indexOf(GAME_OVER)).toBeGreaterThan(victory.indexOf("TriggerExecute(gt_TriggerSceneOutroSetup, true, true);"));
  });

  it("follows the outro straight away when a death wins, with no death pause after it", async () => {
    const dies = { type: "anchorDies", anchorId: "nova" };
    const script = await compiled((blueprint) => {
      blueprint.outcomes = { victory: [dies], defeat: [] };
      blueprint.screenplay.script.cues = blueprint.screenplay.script.cues.map((entry: any) => (entry.scene === 2 ? { ...entry, cue: dies } : entry));
    });
    const victory = section(script, "novaDies");
    expect(victory).toContain(lines("TriggerExecute(gt_TriggerSceneOutroSetup, true, true);", GAME_OVER));
    expect(victory).not.toContain("Wait(3.0, c_timeGame);");
  });
});

describe("where a victory outro may play", () => {
  it("only on a victory condition", async () => {
    const error = await compileError((blueprint) => {
      blueprint.outcomes = { victory: [], defeat: [] };
    });
    expect(String(error)).toContain(
      "Scene 2 is a victory outro, which ends the game, so it plays on a victory condition, and its anchors/nova/enters/field cue isn't one: cue it on one of the Blueprint's victory outcomes",
    );
  });

  it("only on a victory condition, which one armed from a Beat isn't a cue's", async () => {
    const error = await compileError((blueprint) => {
      blueprint.beats.push({ id: "late", title: "Late", summary: "Later.", startsWhen: [{ type: "anchorDies", anchorId: "nova" }] });
      blueprint.outcomes = { victory: [{ ...REACHES_FIELD, fromBeat: "late" }], defeat: [] };
    });
    expect(String(error)).toContain(
      'its anchors/nova/enters/field cue isn\'t one: the victory on it waits for Beat late (fromBeat), which a cue can\'t, so list the outro by its outcome ({ "id": "outro", "outcome": "victory" }) in place of its scene',
    );
  });

  it("last on its cue", async () => {
    const thenAnother = await compileError((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 1, cue: REACHES_FIELD });
    });
    expect(String(thenAnother)).toContain("Scene 2 is a victory outro, which ends the game, so it plays last on its anchors/nova/enters/field cue: scene 1 plays after it");
  });

  it("with no delay", async () => {
    const error = await compileError((blueprint) => {
      blueprint.screenplay.script.cues = blueprint.screenplay.script.cues.map((entry: any) => (entry.scene === 2 ? { ...entry, afterSeconds: 2 } : entry));
    });
    expect(String(error)).toContain("Scene 2 is a victory outro, which ends the game, so its cue plays it with no delay: drop the afterSeconds on its anchors/nova/enters/field cue");
  });

  it("with nothing cued on its having played", async () => {
    const error = await compileError((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 1, cue: { type: "scenePlayed", scene: 2 } });
    });
    expect(String(error)).toContain("Scene 2 is a victory outro, which ends the game, so a scenePlayed cue on it would never fire: cue scene 1 on something else");
  });

  it("with nothing off the script cued on its having played", async () => {
    const error = await compileError((blueprint) => {
      (blueprint.screenplay.scenes ??= []).push({ id: "after", cue: { type: "scenePlayed", scene: 2 }, lines: [{ id: "after-1", speaker: "Nova", speakerUnitType: "Marine", text: "After." }] });
    });
    expect(String(error)).toContain("Scene 2 is a victory outro, which ends the game, so a scenePlayed cue on it would never fire: cue the inline scene after on something else");
  });

  it("with no handback", async () => {
    expect(
      await problemsOf((_blueprint, scene) => {
        scene.handback = { camera: "cam-victory" };
      }),
    ).toContain("handback: A victory outro ends the game instead of handing back, so it has no handback");
  });
});

describe("a victory outro's length", () => {
  it("has T4's outro budget: about 25 s, a warning over 45 s", () => {
    expect(TRIGGER_SCENE_OUTRO_LENGTH).toEqual({ aboutMs: 25_000, warnMs: 45_000 });
  });
});

/** A Mechanic with a timer it stops on victory. */
const BELL = `
import { z } from "zod";
import { call, callValue, defineMechanic, NTVE_FUNCTIONS, NTVE_PRESETS, triggerVariable, type PluginCode } from "@team-antioch/sc2-adjutant/plugin-sdk";

const timer = triggerVariable("bell/timer", "bell_timer", "timer", callValue("bell/timer/initial/call", NTVE_FUNCTIONS.newTimer, {}));

const plugin: PluginCode = {
  mechanics: [
    defineMechanic({
      type: "bell",
      paramsSchema: z.object({}).strict(),
      buildTriggers: () => ({
        triggers: [],
        variables: [timer],
        victoryActions: (path) => [call(path + "/bell", NTVE_FUNCTIONS.timerPause, { timer: { kind: "variable", variable: timer }, pause: { kind: "preset", preset: NTVE_PRESETS.pause } })],
      }),
    }),
  ],
};
export default plugin;
`;
