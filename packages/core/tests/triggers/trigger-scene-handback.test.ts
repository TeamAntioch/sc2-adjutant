// A trigger scene's handback variants (#427), on the `cinematic` fixture Workspace's Radio Field: a
// scene 2 of three lines plays as the trigger scene `landing` when Nova reaches the field, on two
// camera Anchors. Lines after the handback, a handback with no fade, the objective it issues, clocks
// held for the scene, and chains of trigger scenes. The compiled MapScript.galaxy is read back.
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENE_2 = [
  "",
  "## Scene 2: THE FIELD",
  "",
  "**NOVA** `D-01-01-02-001-NOVA`: Move out.",
  "**NOVA** `D-01-01-02-002-NOVA`: Watch the ridge.",
  "**NOVA** `D-01-01-02-003-NOVA`: And the cave.",
  "",
  "## Scene 3: THE RIDGE",
  "",
  "**NOVA** `D-01-01-03-001-NOVA`: Up there.",
  "",
].join("\n");

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

/** A held wide, then an eased move to the goal under the first line. */
const SCENE = { shots: [{ camera: "cam-wide", afterMs: 0, pauseAfterMs: 500 }, { camera: "cam-wide", to: "cam-goal", line: "radio_field-2-1" }] };
const RIDGE = { shots: [{ camera: "cam-goal", afterMs: 0 }] };

/** Radio Field with scene 2 as the trigger scene `landing`, cued when Nova reaches the field (scene 3's `ridge` is written beside it, for a chain). */
async function workspace(edit: (blueprint: any, scene: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-wide", 20, 20), camera("cam-goal", 44, 40), unit("nova", 10, 10), unit("zeratul", 12, 10)];
  blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" } });
  blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 2 }];
  const scene = structuredClone(SCENE);
  edit(blueprint, scene);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  await writeFile(path.join(mission, "trigger-scenes/landing.json"), JSON.stringify(scene));
  await writeFile(path.join(mission, "trigger-scenes/ridge.json"), JSON.stringify(RIDGE));
  return { root, blueprintPath };
}

async function compiled(edit?: (blueprint: any, scene: any) => void, setup?: (root: string) => Promise<void>): Promise<string> {
  const { root, blueprintPath } = await workspace(edit);
  await setup?.(root);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return readFile(path.join(map, "MapScript.galaxy"), "utf8");
}

async function problemsOf(edit: (blueprint: any, scene: any) => void): Promise<string[]> {
  const { root } = await workspace(edit);
  const { problems } = await checkWorkspace(root);
  return problems.map((problem) => `${problem.path ?? ""}: ${problem.message}`);
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const lines = (...statements: string[]): string => statements.map((statement) => (statement ? `    ${statement}` : "")).join("\r\n");
const WIDE = stableObjectId("cam-wide");
const GOAL = stableObjectId("cam-goal");
const NOVA = stableObjectId("nova");
const ZERATUL = stableObjectId("zeratul");
/** The watched and skipped branches of the Cleanup's handback, and what follows them on both paths. */
const branches = (cleanup: string): { watched: string; skipped: string; after: string } => {
  const start = cleanup.indexOf("if ((gv_trigger_scene_landing_completed == true)) {");
  const otherwise = cleanup.indexOf("else {", start);
  const end = cleanup.indexOf("\r\n    }", otherwise);
  return { watched: cleanup.slice(start, otherwise), skipped: cleanup.slice(otherwise, end), after: cleanup.slice(end) };
};

describe("lines after the handback", () => {
  const later = (_blueprint: any, scene: any) => {
    scene.handback = { linesFrom: "radio_field-2-2" };
  };

  it("plays the lines before linesFrom inside the scene, and the rest as waited Transmissions once control is back", async () => {
    const script = await compiled(later);
    const cinematic = section(script, "TriggerSceneLandingCinematic");
    expect(cinematic).toContain('SoundLink("radio_field-2-1", -1)');
    expect(cinematic).not.toContain('SoundLink("radio_field-2-2", -1)');
    const after = section(script, "TriggerSceneLandingLines");
    // In order, each waited: one after another, as Transmissions in play, kept so another trigger scene can cut one off (ADR 0013).
    expect(after.indexOf('SoundLink("radio_field-2-2", -1)')).toBeGreaterThan(-1);
    expect(after.indexOf('SoundLink("radio_field-2-3", -1)')).toBeGreaterThan(after.indexOf('SoundLink("radio_field-2-2", -1)'));
    expect(after.match(/c_transmissionDurationAdd, false, c_maxPlayers, false\);\r\n {8}gv_script_trigger_scene_line = TransmissionLastSent\(\);\r\n {8}TransmissionWait\(gv_script_trigger_scene_line, 0\.0\);/g)).toHaveLength(2);
  });

  it("starts them after Cinematic Mode is off and the fade in has ended, without holding up what the cue plays next", async () => {
    const cleanup = section(await compiled(later), "TriggerSceneLandingCleanup");
    // After both paths' handback (its fade in waited): a skip skips the scene, not what the player is told in play.
    expect(branches(cleanup).after).toContain("TriggerExecute(gt_TriggerSceneLandingLines, true, false);");
  });

  it("is checked against the scene's lines and the shots", async () => {
    expect(
      await problemsOf((_blueprint, scene) => {
        scene.handback = { linesFrom: "radio_field-2-9" };
      }),
    ).toContain("handback.linesFrom: No line radio_field-2-9 in scene 2");
    expect(
      await problemsOf((_blueprint, scene) => {
        scene.handback = { linesFrom: "radio_field-2-1" };
      }),
    ).toContain("shots.1.line: radio_field-2-1 plays after the handback (handback.linesFrom), so no shot can cut on it");
  });
});

describe("a handback with no fade", () => {
  const unfaded = (_blueprint: any, scene: any) => {
    scene.handback = { fade: false, ping: ["nova", "zeratul"] };
  };

  it("watched to the end, ends with no fade and leaves the camera where the last shot left it", async () => {
    const script = await compiled(unfaded);
    expect(section(script, "TriggerSceneLandingCinematicEnd")).not.toContain("CinematicFade(false, 2.0");
    const { watched } = branches(section(script, "TriggerSceneLandingCleanup"));
    // Waited, so what follows (lines in play, the cue's next actions) starts once Cinematic Mode is off (T6).
    expect(watched).toContain(lines("    libNtve_gf_CinematicMode(false, PlayerGroupAll(), 1.5);", "    Wait(1.5, c_timeReal);"));
    expect(watched).not.toContain("CinematicFade(");
    expect(watched).not.toContain("CameraApplyInfo(");
    expect(watched).not.toContain("CameraRestore(");
  });

  it("after a skip, fades as any scene does and lands on the last shot's camera, the one final state", async () => {
    const script = await compiled(unfaded);
    expect(section(script, "TriggerSceneLandingCinematicEnd")).toContain("CinematicFade(false, 0.5");
    const { skipped } = branches(section(script, "TriggerSceneLandingCleanup"));
    expect(skipped).toContain(`CameraApplyInfo(1, CameraInfoFromId(${GOAL}), 1.0, -1, 10.0, true);`);
    expect(skipped).toContain("CinematicFade(true, 1.0");
    expect(skipped).not.toContain(`CameraInfoFromId(${WIDE})`);
  });

  it("pings its units on the minimap at the handback", async () => {
    const cleanup = section(await compiled(unfaded), "TriggerSceneLandingCleanup");
    for (const id of [NOVA, ZERATUL]) expect(branches(cleanup).after).toContain(`MinimapPing(PlayerGroupAll(), UnitGetPosition(UnitFromId(${id})), 4.0, Color(0.0, 100.0, 0.0));`);
  });

  it("refuses a camera to land on, and a ping on anything but a unit Anchor", async () => {
    const problems = await problemsOf((_blueprint, scene) => {
      scene.handback = { fade: false, camera: "cam-wide", ping: ["cam-goal"] };
    });
    expect(problems).toContain("handback.camera: A handback with no fade leaves the camera where the scene left it, so it names no camera");
    expect(problems).toContain("handback.ping.0: cam-goal is a camera Anchor, not a unit");
  });
});

describe("the objective at the handback", () => {
  const objective = { id: "reach-ridge", title: "Reach the ridge", description: "Get Nova to the ridge.", type: "primary", beatId: "radio" };
  const issued = (blueprint: any, scene: any) => {
    blueprint.objectives = [objective];
    scene.handback = { objective: "reach-ridge" };
  };

  it("is created hidden at mission start and shown straight after the handback", async () => {
    const script = await compiled(issued);
    const start = section(script, "MissionStart");
    expect(start.indexOf("ObjectiveShow(gv_objective_reachridge, PlayerGroupAll(), false);")).toBeGreaterThan(start.indexOf("ObjectiveCreate("));
    expect(branches(section(script, "TriggerSceneLandingCleanup")).after).toContain("ObjectiveShow(gv_objective_reachridge, PlayerGroupAll(), true);");
  });

  it("names one of the Blueprint's objectives", async () => {
    expect(
      await problemsOf((_blueprint, scene) => {
        scene.handback = { objective: "nowhere" };
      }),
    ).toContain("handback.objective: No objective nowhere in the Blueprint");
  });
});

describe("clocks held for a scene", () => {
  const timed = (blueprint: any) => {
    blueprint.outcomes = { victory: [{ type: "timer", seconds: 300 }], defeat: [] };
  };

  it("holds the goal timers from before a mid-mission scene until it hands back", async () => {
    const script = await compiled(timed);
    const cue = section(script, "novaReachesField");
    expect(cue).toContain(
      lines(
        "TriggerExecute(gt_ClocksHold, true, true);",
        "gv_trigger_scene_landing_skipped = false;",
        "gv_trigger_scene_landing_after_cinematic = false;",
        "TriggerExecute(gt_TriggerSceneLandingSetup, true, true);",
        "TriggerExecute(gt_ClocksRelease, true, true);",
      ),
    );
    // Only the clocks it paused: one the mission paused itself stays paused.
    expect(section(script, "ClocksHold")).toContain(
      lines("if ((TimerIsPaused(gv_goal_timer_300) == false)) {", "    TimerPause(gv_goal_timer_300, true);", "    gv_clocks_goal_timer_300_held = true;", "}"),
    );
    expect(section(script, "ClocksRelease")).toContain(
      lines("if ((gv_clocks_goal_timer_300_held == true)) {", "    TimerPause(gv_goal_timer_300, false);", "    gv_clocks_goal_timer_300_held = false;", "}"),
    );
  });

  it("holds the clocks a Mechanic declares, the Cinematic at mission start included", async () => {
    const script = await compiled(
      (blueprint) => {
        blueprint.mechanics = [{ id: "tick", type: "ticker", params: {} }];
      },
      async (root) => {
        const plugin = path.join(root, "plugins/ticker");
        await mkdir(plugin, { recursive: true });
        await writeFile(
          path.join(plugin, "sc2-adjutant-plugin.json"),
          JSON.stringify({ name: "ticker", version: "0.1.0", pluginApi: 2, roles: [], contributions: { mechanics: ["ticker"] }, entry: "./index.ts" }),
        );
        await writeFile(path.join(plugin, "index.ts"), TICKER);
        const config = JSON.parse(await readFile(path.join(root, "sc2-adjutant.workspace.json"), "utf8"));
        config.plugins.push("./plugins/ticker");
        await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify(config));
      },
    );
    expect(section(script, "ClocksHold")).toContain("TimerPause(gv_ticker_timer, true);");
    expect(section(script, "MissionStart")).toContain(lines("TriggerExecute(gt_ClocksHold, true, true);", "TriggerExecute(gt_CinematicRadio, true, true);", "TriggerExecute(gt_ClocksRelease, true, true);"));
  });

  it("keeps a clock its Mechanic paused paused through a release, holds its unpause until the release, and starts it paused under a hold", async () => {
    const script = await compiled(
      (blueprint) => {
        blueprint.mechanics = [{ id: "tick", type: "ticker", params: {} }];
      },
      async (root) => {
        const plugin = path.join(root, "plugins/ticker");
        await mkdir(plugin, { recursive: true });
        await writeFile(
          path.join(plugin, "sc2-adjutant-plugin.json"),
          JSON.stringify({ name: "ticker", version: "0.1.0", pluginApi: 2, roles: [], contributions: { mechanics: ["ticker"] }, entry: "./index.ts" }),
        );
        await writeFile(path.join(plugin, "index.ts"), PAUSING_TICKER);
        const config = JSON.parse(await readFile(path.join(root, "sc2-adjutant.workspace.json"), "utf8"));
        config.plugins.push("./plugins/ticker");
        await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify(config));
      },
    );
    // Its owner's pause flags it; its unpause waits for a hold's release.
    expect(section(script, "TickerStop")).toContain(lines("gv_clocks_ticker_timer_paused = true;", "TimerPause(gv_ticker_timer, true);"));
    expect(section(script, "TickerGo")).toContain(
      lines("gv_clocks_ticker_timer_paused = false;", "if ((gv_clocks_ticker_timer_held == false)) {", "    TimerPause(gv_ticker_timer, false);", "}"),
    );
    // A hold holds it whatever its state, so its owner knows one is in force; a release unpauses it only if its owner hasn't paused it.
    expect(section(script, "ClocksHold")).toContain(lines("TimerPause(gv_ticker_timer, true);", "gv_clocks_ticker_timer_held = true;"));
    // Started, it is no longer its owner's pause (a release would leave it frozen); under a hold, it starts paused, for the release to run.
    expect(section(script, "TickerStart")).toContain(
      lines("gv_clocks_ticker_timer_paused = false;", "TimerStart(gv_ticker_timer, 30.0, false, c_timeGame);", "if ((gv_clocks_ticker_timer_held == true)) {", "    TimerPause(gv_ticker_timer, true);", "}"),
    );
    expect(section(script, "ClocksRelease")).toContain(
      lines("if ((gv_clocks_ticker_timer_held == true)) {", "    gv_clocks_ticker_timer_held = false;", "    if ((gv_clocks_ticker_timer_paused == false)) {", "        TimerPause(gv_ticker_timer, false);"),
    );
    expect(script.match(/^bool gv_clocks_ticker_timer_held;/gm)).toHaveLength(1);
  });

  it("adds nothing to a Mission with no clocks", async () => {
    const script = await compiled();
    expect(script).not.toContain("gt_ClocksHold");
  });
});

describe("a chain of trigger scenes on one cue", () => {
  const chained = (blueprint: any) => {
    blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" } });
    blueprint.screenplay.script.triggerScenes.push({ id: "ridge", scene: 3 });
  };

  it("shares one skip: the first hands on, and the second takes its skip as it starts", async () => {
    const cue = section(await compiled(chained), "novaReachesField");
    expect(cue).toContain(
      lines(
        "gv_trigger_scene_landing_hand_on = true;",
        "gv_trigger_scene_landing_skipped = false;",
        "gv_trigger_scene_landing_after_cinematic = false;",
        "TriggerExecute(gt_TriggerSceneLandingSetup, true, true);",
        "gv_trigger_scene_ridge_skipped = (gv_trigger_scene_landing_completed == false);",
        // Landing paused the mission music itself (the default), so it hands on with it paused for ridge's handback.
        "gv_trigger_scene_ridge_after_cinematic = true;",
        "gv_trigger_scene_ridge_camera_saved = true;",
        "TriggerExecute(gt_TriggerSceneRidgeSetup, true, true);",
      ),
    );
  });

  it("hands on under black with Cinematic Mode on, leaving the handback to the last scene", async () => {
    const cleanup = section(await compiled(chained), "TriggerSceneLandingCleanup");
    expect(cleanup).toContain("if ((gv_trigger_scene_landing_hand_on == false)) {");
    const handOn = cleanup.indexOf("if ((gv_trigger_scene_landing_hand_on == false)) {");
    expect(cleanup.indexOf("libNtve_gf_CinematicMode(false")).toBeGreaterThan(handOn);
    expect(cleanup.indexOf("CinematicFade(true")).toBeGreaterThan(handOn);
    expect(cleanup).toContain("gv_trigger_scene_landing_hand_on = false;");
  });

  it("restores the camera the player had before the chain, saved by its first scene", async () => {
    const script = await compiled(chained);
    expect(section(script, "novaReachesField")).toContain(lines("gv_trigger_scene_ridge_camera_saved = true;", "TriggerExecute(gt_TriggerSceneRidgeSetup, true, true);"));
    expect(section(script, "TriggerSceneRidgeSetup")).toContain(lines("if ((gv_trigger_scene_ridge_camera_saved == false)) {", "    CameraSave(1);", "}"));
    expect(section(script, "TriggerSceneLandingSetup")).toContain(lines("CameraSave(1);"));
  });

  it("refuses handback options on a scene that only ever hands on, since the last scene hands back", async () => {
    const { root, blueprintPath } = await workspace((blueprint, scene) => {
      chained(blueprint);
      scene.handback = { fade: false };
    });
    await expect(compileMission(await loadWorkspace(root), blueprintPath, path.join(await tempFolder(), "Out.SC2Map"))).rejects.toThrow(
      "Trigger scene landing hands on to the scene after it on every cue that plays it, so it never hands back: move its handback options to the last scene",
    );
  });

  /** The chain, with `landing` also played alone 5 s after mission start, where it hands back. */
  const bothWays = (blueprint: any) => {
    chained(blueprint);
    blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "missionStart" }, afterSeconds: 5 });
  };

  it("fades a no-fade scene out when it hands on, so the next scene starts from black rather than cutting to it", async () => {
    const end = section(
      await compiled((blueprint, scene) => {
        bothWays(blueprint);
        scene.handback = { fade: false };
      }),
      "TriggerSceneLandingCinematicEnd",
    );
    const handOn = end.indexOf("if ((gv_trigger_scene_landing_hand_on == true)) {");
    expect(handOn).toBeGreaterThan(-1);
    expect(end.indexOf("CinematicFade(false, 2.0", handOn)).toBeGreaterThan(handOn);
  });

  it("refuses pings, an objective or lines after the handback on a scene some cue hands on from, where they would never play", async () => {
    for (const handback of [{ ping: ["nova"] }, { linesFrom: "radio_field-2-2" }]) {
      const { root, blueprintPath } = await workspace((blueprint, scene) => {
        bothWays(blueprint);
        scene.handback = handback;
      });
      await expect(compileMission(await loadWorkspace(root), blueprintPath, path.join(await tempFolder(), "Out.SC2Map"))).rejects.toThrow(
        "Trigger scene landing hands on to the scene after it on a cue, where its pings, objective and lines after the handback would never play: move them to the last scene",
      );
    }
  });
});

/** A Mechanic with one clock, a timer started at map init. */
const TICKER = `
import { z } from "zod";
import { callValue, defineMechanic, NTVE_FUNCTIONS, triggerVariable, type PluginCode } from "@team-antioch/sc2-adjutant/plugin-sdk";

const timer = triggerVariable("ticker/timer", "ticker_timer", "timer", callValue("ticker/timer/initial/call", NTVE_FUNCTIONS.newTimer, {}));

const plugin: PluginCode = {
  mechanics: [defineMechanic({ type: "ticker", paramsSchema: z.object({}).strict(), buildTriggers: () => ({ triggers: [], variables: [timer], clocks: [timer] }) })],
};
export default plugin;
`;

/** The ticker, with triggers that pause and unpause its clock for its own reasons (context.pauseClock). */
const PAUSING_TICKER = `
import { z } from "zod";
import { callValue, defineMechanic, NTVE_FUNCTIONS, stableElementId, triggerVariable, type PluginCode } from "@team-antioch/sc2-adjutant/plugin-sdk";

const timer = triggerVariable("ticker/timer", "ticker_timer", "timer", callValue("ticker/timer/initial/call", NTVE_FUNCTIONS.newTimer, {}));

const plugin: PluginCode = {
  mechanics: [
    defineMechanic({
      type: "ticker",
      paramsSchema: z.object({}).strict(),
      buildTriggers: (_params, context) => ({
        triggers: [
          { id: stableElementId("ticker/stop"), name: "Ticker Stop", events: [], actions: [...context.pauseClock("ticker/stop/pause", timer, true)] },
          { id: stableElementId("ticker/go"), name: "Ticker Go", events: [], actions: [...context.pauseClock("ticker/go/pause", timer, false)] },
          { id: stableElementId("ticker/start"), name: "Ticker Start", events: [], actions: [...context.startClock("ticker/start/clock", timer, 30)] },
        ],
        variables: [timer],
        clocks: [timer],
      }),
    }),
  ],
};
export default plugin;
`;
