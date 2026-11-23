// The cinematography checks the checker runs on each trigger scene (CHECKS.md "Trigger scene"), on
// synthetic scenes: camera Anchors in a base and an objective Zone, and lines of known length. And
// `check-workspace` on the `cinematic` fixture Workspace's Radio Field, given a scene 2 of one line
// played as a trigger scene after its Cinematic, timed by the estimate.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { handbackTimingChecks, triggerSceneChecks, type SceneBlueprint } from "../../src/cutscene/trigger-scene-checks.js";
import { type LoadedTriggerScene, timedTriggerScene, TRIGGER_SCENE_TIMES } from "../../src/cutscene/trigger-scene.js";
import type { TriggerScene } from "../../src/domain/trigger-scene.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import type { ScriptLine } from "../../src/script/name-script.js";
import { copyOf } from "../mcp/harness.js";

const line = (soundId: string): ScriptLine => ({ kind: "line", speaker: "NOVA", character: "Nova", characterId: "Nova", soundId, text: "Move out." }) as ScriptLine;

type Values = { Distance?: number; Pitch?: number; Yaw?: number; FieldOfView?: number; DepthOfField?: number };

const camera = (id: string, zoneId: string, values: Values = {}) => ({
  id,
  name: id,
  zoneId,
  kind: "camera" as const,
  position: { x: 10, y: 10 },
  cameraTarget: { x: 10, y: 10 },
  cameraValues: Object.entries({ Distance: 34, Pitch: 56, Yaw: 180, FieldOfView: 27.8, ...values }).map(([index, value]) => ({ index, value })),
});

const zone = (id: string, role: string) => ({ id, name: id, role });

type Options = {
  /** Each camera Anchor's values, by id; cam-start (in the base) and cam-goal (on the objective) by default. */
  readonly cameras?: Record<string, Values & { zone?: string }>;
  /** Each line's length in ms: two lines, 4 s each, by default. */
  readonly lengths?: Record<string, number>;
  readonly cue?: Record<string, unknown>;
  /** More cues, after the scene's own. */
  readonly cues?: readonly Record<string, unknown>[];
  readonly afterSeconds?: number;
  readonly estimated?: readonly string[];
  /** The Screenplay's trigger scenes, listed beside the one under test. */
  readonly triggerScenes?: readonly Record<string, unknown>[];
  /** The Blueprint's victory conditions. */
  readonly victory?: readonly Record<string, unknown>[];
};

/** The findings on a trigger scene of `shots`, timed by `lengths`, in a Blueprint of `cameras`, cued at mission start unless `cue` says otherwise. */
function findings(scene: TriggerScene, options: Options = {}) {
  const lengths = options.lengths ?? { "l-1": 4000, "l-2": 4000 };
  const lines = Object.keys(lengths).map(line);
  const cameras = options.cameras ?? { "cam-start": {}, "cam-goal": { zone: "goal" } };
  const blueprint = {
    anchors: Object.entries(cameras).map(([id, { zone: zoneId = "start", ...values }]) => camera(id, zoneId, values)),
    zones: [zone("start", "base"), zone("goal", "objective"), zone("road", "path")],
    outcomes: { victory: options.victory ?? [], defeat: [] },
    screenplay: { script: { triggerScenes: options.triggerScenes ?? [], cues: [{ scene: 2, cue: options.cue ?? { type: "missionStart" }, ...(options.afterSeconds ? { afterSeconds: options.afterSeconds } : {}) }, ...(options.cues ?? [])] } },
  } as unknown as SceneBlueprint;
  const loaded: LoadedTriggerScene = { id: "landing", index: 0, scene: 2, file: "trigger-scenes/landing.json", triggerScene: scene };
  const timing = { lengths: new Map(Object.entries(lengths)), estimated: options.estimated ?? [] };
  return triggerSceneChecks(timedTriggerScene(loaded, lines, timing.lengths), blueprint, timing).map(({ path, message, severity }) => ({ ...(path ? { path } : {}), message, ...(severity ? { severity } : {}) }));
}

/** A held wide on the start, then an eased move to the goal under the second line: one that keeps every check. */
const KEPT: TriggerScene = {
  shots: [
    { camera: "cam-start", line: "l-1" },
    { camera: "cam-start", to: "cam-goal", line: "l-2" },
  ],
};

describe("the trigger-scene checks", () => {
  it("find nothing in a scene that keeps them", () => {
    expect(findings(KEPT)).toEqual([]);
  });

  it("C1: a review item when the first shot is closer than a wide", () => {
    expect(findings(KEPT, { cameras: { "cam-start": { Distance: 12 }, "cam-goal": { zone: "goal" } } })).toEqual([
      { path: "shots.0.camera", message: "C1: shot 0 opens on cam-start at distance 12, closer than a wide (about 25 or more): open on a wide, or record that the scene is framed on its speakers", severity: "review" },
    ]);
  });

  it("C3: a warning for a camera turned more than 45° off a yaw of 180, once per Anchor", () => {
    // cam-goal is both the move's end and the handback.
    expect(findings({ ...KEPT, handback: { camera: "cam-goal" } }, { cameras: { "cam-start": {}, "cam-goal": { zone: "goal", Yaw: 120 } } })).toContainEqual({
      path: "shots.1.to",
      message: "C3: shot 1's camera cam-goal has a yaw of 120, 60° off 180, past the 45° that keeps screen direction: turn cam-goal's Yaw toward 180, or record why",
      severity: "warning",
    });
    expect(findings({ ...KEPT, handback: { camera: "cam-goal" } }, { cameras: { "cam-start": {}, "cam-goal": { zone: "goal", Yaw: 120 } } }).filter(({ message }) => message.includes("past the 45°"))).toHaveLength(1);
  });

  it("C3: a review item for a cut that turns the camera more than 45°, noted as deliberate past 90°", () => {
    const cut: TriggerScene = { shots: [{ camera: "cam-start", line: "l-1" }, { camera: "cam-goal", line: "l-2" }] };
    // 220 is 40° off 180, so only the turn is found.
    expect(findings(cut, { cameras: { "cam-start": { Yaw: 140 }, "cam-goal": { zone: "goal", Yaw: 220 } } }).filter(({ message }) => message.startsWith("C3"))).toEqual([
      { path: "shots.1.camera", message: "C3: the cut to shot 1 turns the camera 80°, from cam-start's yaw 140 to cam-goal's 220, past the 45° successive shots keep to: bring their yaws closer, or record why", severity: "review" },
    ]);
    // 359 and 0 are 1° apart, but each is 180° off 180.
    expect(findings(cut, { cameras: { "cam-start": { Yaw: 359 }, "cam-goal": { zone: "goal", Yaw: 0 } } }).filter(({ message }) => message.includes("the cut"))).toEqual([]);
    expect(findings(cut, { cameras: { "cam-start": { Yaw: 130 }, "cam-goal": { zone: "goal", Yaw: 225 } } }).filter(({ message }) => message.includes("the cut"))).toEqual([
      { path: "shots.1.camera", message: "C3: the cut to shot 1 turns the camera 95°, from cam-start's yaw 130 to cam-goal's 225, past 90°, which is a deliberate choice: bring their yaws closer, or record why", severity: "review" },
    ]);
  });

  it("C8: a warning for a camera whose field of view isn't the game camera's 27.8", () => {
    expect(findings(KEPT, { cameras: { "cam-start": {}, "cam-goal": { zone: "goal", FieldOfView: 40 } } })).toEqual([
      { path: "shots.1.to", message: "C8: shot 1's camera cam-goal has a field of view of 40, not 27.8: set cam-goal's FieldOfView to 27.8 and get closer with Distance", severity: "warning" },
    ]);
    // The Editor's 27.7995 is 27.8.
    expect(findings(KEPT, { cameras: { "cam-start": { FieldOfView: 27.7995 }, "cam-goal": { zone: "goal" } } })).toEqual([]);
  });

  it("C9: a warning for depth of field on a gameplay-framed camera, or over 0.1 on a closer one", () => {
    expect(findings(KEPT, { cameras: { "cam-start": { DepthOfField: 0.1 }, "cam-goal": { zone: "goal", Distance: 15, DepthOfField: 0.3 } } })).toEqual([
      { path: "shots.0.camera", message: "C9: shot 0's camera cam-start is gameplay-framed (distance 34) with depth of field 0.1: set cam-start's DepthOfField to 0, so the player reads the whole map", severity: "warning" },
      { path: "shots.1.to", message: "C9: shot 1's camera cam-goal has depth of field 0.3, over the 0.1 a closer shot keeps to: set cam-goal's DepthOfField to 0.1 or less", severity: "warning" },
    ]);
    expect(findings(KEPT, { cameras: { "cam-start": {}, "cam-goal": { zone: "goal", Distance: 15, DepthOfField: 0.1 } } })).toEqual([]);
    // Far but pitched low, it is framed, not gameplay.
    expect(findings(KEPT, { cameras: { "cam-start": {}, "cam-goal": { zone: "goal", Distance: 40, Pitch: 15, DepthOfField: 0.05 } } })).toEqual([]);
  });

  it("C7: a review item for a linear move", () => {
    const linear: TriggerScene = { shots: [KEPT.shots[0]!, { ...KEPT.shots[1]!, move: "linear" }] };
    expect(findings(linear)).toEqual([{ path: "shots.1.move", message: "C7: shot 1 moves linearly: leave out move to ease it (velocity −1, decelerate 10), or record why a snap is intended", severity: "review" }]);
  });

  it("C4: a warning for a move under 1.5 s or over 15 s, unless it is exactly its lines", () => {
    // A move held 16 s past its line, and one of 1 s with no line.
    const long: TriggerScene = { shots: [KEPT.shots[0]!, { ...KEPT.shots[1]!, pauseAfterMs: 12_000 }] };
    expect(findings(long).filter(({ message }) => message.startsWith("C4"))).toEqual([
      { path: "shots.1", message: "C4: shot 1's move runs 16.0 s, over the 15 s a move keeps to: split it at a line, or hold part of it", severity: "warning" },
    ]);
    const short: TriggerScene = { shots: [...KEPT.shots, { camera: "cam-goal", to: "cam-start", afterMs: 0, pauseAfterMs: 1000 }] };
    expect(findings(short).filter(({ message }) => message.startsWith("C4"))).toEqual([
      { path: "shots.2", message: "C4: shot 2's move runs 1.0 s, under the 1.5 s a move keeps to: lengthen it with pauseAfterMs, or cut instead (leave out to)", severity: "warning" },
    ]);
    // A move under two lines is no line's length.
    expect(findings(KEPT, { lengths: { "l-1": 4000, "l-2": 10_000, "l-3": 10_000 } }).filter(({ message }) => message.startsWith("C4"))).toEqual([
      { path: "shots.1", message: "C4: shot 1's move runs 20.0 s, over the 15 s a move keeps to: split it at a line, or hold part of it", severity: "warning" },
    ]);
    // Exactly its 20 s line.
    expect(findings(KEPT, { lengths: { "l-1": 4000, "l-2": 20_000 } }).filter(({ message }) => message.startsWith("C4"))).toEqual([]);
  });

  it("C4: a review item when the camera moves for under about 20% or over about 95% of the scene", () => {
    const held: TriggerScene = { shots: [{ camera: "cam-start", line: "l-1" }, { camera: "cam-goal", line: "l-2" }] };
    expect(findings(held)).toEqual([
      { message: "C4: the camera moves for 0% of the scene, under the about 20% of a trigger scene: move under a line (give a shot a `to`), or record why it holds", severity: "review" },
    ]);
    const moving: TriggerScene = { shots: [{ camera: "cam-start", to: "cam-goal", line: "l-1" }, { camera: "cam-goal", to: "cam-start", line: "l-2" }] };
    expect(findings(moving)).toEqual([
      { message: "C4: the camera moves for 100% of the scene, over the about 95% of a trigger scene: hold a shot (leave out its to), or record why it never settles", severity: "review" },
    ]);
  });

  it("T4: a review item over 30 s, a warning past the budget of its cue, and the lines walked when they alone run past it", () => {
    const t4 = (options: Options) => findings(KEPT, options).filter(({ message }) => message.startsWith("T4"));
    // 35 s of lines, the 1.5 s fade in, the 2 s fade out and the 1.5 s handback.
    expect(t4({ lengths: { "l-1": 20_000, "l-2": 15_000 } })).toEqual([{ message: "T4: it runs 40.0 s, over the 30 s worth reviewing (an intro runs about 35 s): review what could go", severity: "review" }]);
    expect(t4({ lengths: { "l-1": 20_000, "l-2": 15_000 }, cue: { type: "anchorDies", anchorId: "sentry" }, estimated: ["l-1"] })).toEqual([
      {
        message: "T4: it runs 40.0 s, over the 30 s worth reviewing (a mid-mission scene runs about 30 s): review what could go (1 of 2 lines timed by the estimate); its lines alone run 35.0 s, past the about 30 s: walk the author through each line (keep it, move it into play as a transmission or to a later cue, or cut it) and record each decision",
        severity: "review",
      },
    ]);
    // A delayed mission-start cue plays mid-mission.
    expect(t4({ lengths: { "l-1": 20_000, "l-2": 15_000 }, afterSeconds: 30 })[0]!.message).toContain("a mid-mission scene");
    expect(t4({ lengths: { "l-1": 30_000, "l-2": 30_000 } })).toEqual([
      {
        message: "T4: it runs 65.0 s, over the 60 s warning for an intro (about 35 s): review what could go; its lines alone run 60.0 s, past the about 35 s: walk the author through each line (keep it, move it into play as a transmission or to a later cue, or cut it) and record each decision",
        severity: "warning",
      },
    ]);
  });

  it("H3: a review item for a mid-mission scene that names its handback camera, or a mission-start one that lands off the start", () => {
    expect(findings({ ...KEPT, handback: { camera: "cam-start" } }, { cue: { type: "beatStarts", beatId: "harried" } })).toEqual([
      { path: "handback.camera", message: "H3: a mid-mission scene hands back on cam-start, not the player's own camera: leave out handback.camera so the player lands where they were, or record why", severity: "review" },
    ]);
    expect(findings({ ...KEPT, handback: { camera: "cam-start" } })).toEqual([]);
    // A scene cued at mission start and mid-mission is held to the mid-mission handback.
    expect(findings({ ...KEPT, handback: { camera: "cam-start" } }, { cues: [{ scene: 2, cue: { type: "beatStarts", beatId: "harried" } }] })).toEqual([
      { path: "handback.camera", message: "H3: a mid-mission scene hands back on cam-start, not the player's own camera: leave out handback.camera so the player lands where they were, or record why", severity: "review" },
    ]);
    // Not the last scene on its cue, it doesn't hand back to the player: it hands on to the trigger scene after it.
    const road = { cameras: { "cam-start": {}, "cam-goal": { zone: "goal" }, "cam-road": { zone: "road" } } };
    expect(findings({ ...KEPT, handback: { camera: "cam-road" } }, { ...road, cues: [{ scene: 3, cue: { type: "missionStart" } }], triggerScenes: [{ id: "next", scene: 3 }] })).toEqual([]);
    expect(findings({ ...KEPT, handback: { camera: "cam-road" } }, road)).toEqual([
      { path: "handback.camera", message: "H3: the mission-start scene hands back on cam-road, in road, not the start: hand back on a camera Anchor in a base Zone (start), or leave out handback.camera for the map's start camera", severity: "review" },
    ]);
  });

  it("H3: agrees with the compile on who hands back, which the scene after it decides", () => {
    const road = { cameras: { "cam-start": {}, "cam-goal": { zone: "goal" }, "cam-road": { zone: "road" } } };
    const handback = { ...KEPT, handback: { camera: "cam-road" } };
    const landsOff = [{ path: "handback.camera", message: expect.stringContaining("H3: the mission-start scene hands back on cam-road"), severity: "review" }];
    // A plain scene after it isn't one to hand on to: the compile hands back first, so the scene lands.
    expect(findings(handback, { ...road, cues: [{ scene: 3, cue: { type: "missionStart" } }] })).toEqual(landsOff);
    // The scene before a victory outro listed by the outcome hands on to it, though no cue names it.
    const win = { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" };
    const outcome = { ...road, cue: win, victory: [win], triggerScenes: [{ id: "landing", scene: 2 }, { id: "outro", outcome: "victory" }] };
    expect(findings({ ...KEPT, handback: { camera: "cam-road" } }, outcome)).toEqual([]);
    expect(findings({ ...KEPT, handback: { camera: "cam-road" } }, { ...outcome, victory: [] })).toHaveLength(1);
  });

  it("O2: a review item for a mission-start scene that never shows the goal", () => {
    const start: TriggerScene = { shots: [{ camera: "cam-start", line: "l-1" }, { camera: "cam-start", to: "cam-road", line: "l-2" }] };
    const cameras = { "cam-start": {}, "cam-goal": { zone: "goal" }, "cam-road": { zone: "road" } };
    expect(findings(start, { cameras })).toEqual([
      { message: "O2: the mission-start scene never shows the goal: cut or move to a camera Anchor in an objective Zone (goal)", severity: "review" },
    ]);
    // Mid-mission, it needn't.
    expect(findings(start, { cameras, cue: { type: "anchorDies", anchorId: "sentry" } })).toEqual([]);
    // The start, when neither a shot nor the handback shows it; handing back on the map's start camera does.
    const goal: TriggerScene = { shots: [{ camera: "cam-goal", line: "l-1" }, { camera: "cam-goal", to: "cam-road", line: "l-2" }] };
    expect(findings({ ...goal, handback: { camera: "cam-road" } }, { cameras }).filter(({ message }) => message.startsWith("O2"))).toEqual([
      { message: "O2: the mission-start scene never shows the start: cut to a camera Anchor in a base Zone (start), or hand back on one", severity: "review" },
    ]);
    expect(findings(goal, { cameras })).toEqual([]);
    // A Kept handback camera's Zone isn't known, but the shots still show no goal.
    expect(findings({ ...start, handback: { camera: "kept-cam" } }, { cameras })).toEqual([
      { message: "O2: the mission-start scene never shows the goal: cut or move to a camera Anchor in an objective Zone (goal)", severity: "review" },
    ]);
  });

  it("T3: the template's fades are the skill's, and a handback timed otherwise is a warning", () => {
    expect(handbackTimingChecks("trigger-scenes/landing.json", TRIGGER_SCENE_TIMES)).toEqual([]);
    expect(handbackTimingChecks("trigger-scenes/landing.json", { ...TRIGGER_SCENE_TIMES, skippedFadeOutMs: 1000, handbackMs: 3000 })).toEqual([
      { file: "trigger-scenes/landing.json", message: "T3: its fade out after a skip runs 1.0 s, not T3's 0.5 s: time it to 0.5 s, or record why", severity: "warning" },
      { file: "trigger-scenes/landing.json", message: "T3: its handback after the natural end runs 3.0 s, not T3's 1.5 s: time it to 1.5 s, or record why", severity: "warning" },
    ]);
  });
});

/** Radio Field with a scene 2 of one line, played at mission start by the trigger scene `landing`: a held wide, then an eased move to the second camera under the line. */
async function checkedWith(yaw: number) {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), ["", "## Scene 2: THE FIELD", "", "**NOVA** `D-01-01-02-001-NOVA`: Move out.", ""].join("\n"));
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [
    { ...camera("cam-wide", "field"), position: { x: 20, y: 20 }, cameraTarget: { x: 20, y: 20 } },
    { ...camera("cam-goal", "field", { Yaw: yaw }), position: { x: 44, y: 40 }, cameraTarget: { x: 44, y: 40 } },
  ];
  blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "missionStart" } });
  blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 2 }];
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  const scene = { shots: [{ camera: "cam-wide", afterMs: 0, pauseAfterMs: 1000 }, { camera: "cam-wide", to: "cam-goal", line: "radio_field-2-1" }] };
  await writeFile(path.join(mission, "trigger-scenes/landing.json"), JSON.stringify(scene));
  return (await checkWorkspace(root)).problems.filter(({ file }) => file.endsWith("trigger-scenes/landing.json")).map(({ path, message, severity }) => ({ path, message, severity }));
}

describe("check-workspace's trigger-scene checks", () => {
  it("reports nothing on a trigger scene that keeps them", async () => {
    expect(await checkedWith(180)).toEqual([]);
  });

  it("reports a check a trigger scene breaks, at its shot", async () => {
    expect(await checkedWith(100)).toEqual([
      { path: "shots.1.to", message: "C3: shot 1's camera cam-goal has a yaw of 100, 80° off 180, past the 45° that keeps screen direction: turn cam-goal's Yaw toward 180, or record why", severity: "warning" },
    ]);
  });
});
