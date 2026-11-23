// Cue entries kept in order (`after`): the `cinematic` fixture Workspace's Radio Field with a scene
// of two messages, the first cued 30 s after a Beat's start and the second on Nova reaching the far
// side, but never before the first has played. The compiled map's MapScript.galaxy is read back.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENES = [
  "",
  "## Scene 2: THE MESSAGES",
  "",
  "> Message 1",
  "",
  "**NOVA** `D-01-01-02-001-NOVA`: First.",
  "",
  "> Message 2",
  "",
  "**NOVA** `D-01-01-02-002-NOVA`: Second.",
  "",
  "## Scene 3: THE CALL",
  "",
  "**ZERATUL** `D-01-01-03-001-ZERATUL`: Late, but here.",
  "",
  "## Scene 4: THE ECHO",
  "",
  "**NOVA** `D-01-01-04-001-NOVA`: Again.",
  "",
].join("\n");

const unit = (id: string, x: number) => ({ id, name: id, zoneId: "near", kind: "unit", unitType: "Marine", player: 1, position: { x, y: 10, z: 0 }, rotation: 0 });
const camera = (id: string, x: number, y: number) => ({
  id,
  name: id,
  zoneId: "near",
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
const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

const FAR = { type: "anchorEntersZone", anchorId: "nova", zoneId: "far" };
const HARRIED = { type: "beatStarts", beatId: "harried" };
const LANDING = { id: "landing", scene: { shots: [{ camera: "cam-wide", afterMs: 0, pauseAfterMs: 1000 }], handback: { camera: "cam-wide" } } };

async function workspace(edit: (blueprint: any) => void = () => {}, triggerScene?: { id: string; scene: unknown }): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENES);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.zones = [
    { id: "near", name: "Near", elevation: 1, landform: "flat", role: "base", polygon: square(0, 0, 32) },
    { id: "far", name: "Far", elevation: 1, landform: "flat", role: "path", polygon: square(32, 0, 32) },
    { id: "cave", name: "Cave", elevation: 1, landform: "flat", role: "path", polygon: square(64, 0, 32) },
  ];
  blueprint.anchors = [unit("nova", 10), camera("cam-wide", 20, 20)];
  blueprint.beats.push({ id: "harried", title: "Harried", summary: "Nova reaches the cave.", startsWhen: [{ type: "anchorEntersZone", anchorId: "nova", zoneId: "cave" }] });
  blueprint.screenplay.script.cues.push(
    { scene: 2, from: "S02>1", cue: HARRIED, afterSeconds: 30 },
    { scene: 2, from: "S02>2", cue: FAR, after: { scene: 2, from: "S02>1" } },
  );
  edit(blueprint);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  if (triggerScene) {
    await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
    await writeFile(path.join(mission, `trigger-scenes/${triggerScene.id}.json`), JSON.stringify(triggerScene.scene));
  }
  return { root, blueprintPath };
}

async function compiled(edit?: (blueprint: any) => void, triggerScene?: { id: string; scene: unknown }): Promise<string> {
  const { root, blueprintPath } = await workspace(edit, triggerScene);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return readFile(path.join(map, "MapScript.galaxy"), "utf8");
}

async function compileError(edit: (blueprint: any) => void, triggerScene?: { id: string; scene: unknown }): Promise<string> {
  return compiled(edit, triggerScene).then(
    () => "",
    (failure: unknown) => String(failure),
  );
}

async function problems(edit: (blueprint: any) => void): Promise<string> {
  const { root } = await workspace(edit);
  return (await checkWorkspace(root)).problems.map((problem) => problem.message).join("\n");
}

const section = (script: string, name: string): string => {
  const start = script.indexOf(`bool gt_${name}_Func`);
  if (start < 0) throw new Error(`No trigger gt_${name}`);
  return script.slice(start, script.indexOf(`void gt_${name}_Init`, start));
};
const sound = (scene: number, line: number): string => `SoundLink("radio_field-${scene}-${line}", -1)`;
const PLAYED_FLAG = "gv_script_scenes_2_S02_1_played";
const FIRE_PLAYED = "TriggerExecute(gt_ScriptScene2S021Played, true, false);";
const BEHIND = "ScriptScene2S022OnAnchorsNovaEntersFarBehindScene2S021";
const RUN_WAITED = `TriggerExecute(gt_${BEHIND}, true, true);`;
const RUN_UNWAITED = `TriggerExecute(gt_${BEHIND}, true, false);`;
const FAR_TRIGGER = "AnchorsNovaEntersFar";
const BEHIND_ONCE = "script_scenes_2_S02_2_behind_anchors_nova_enters_far_scene_2_S02_1_played";

/** The name of the trigger a cue's script entries play from; found by a sound it plays. */
const triggerPlaying = (script: string, needle: string): string => {
  const at = script.indexOf(needle);
  const start = script.lastIndexOf("bool gt_", at);
  return /bool gt_(\w+)_Func/.exec(script.slice(start))![1]!;
};

describe("a cue entry after another", () => {
  it("never plays before the named entry has played: its cue runs it on a thread that waits for that entry first", async () => {
    const script = await compiled();
    // The named entry marks itself played once its last Transmission has ended.
    const delayed = section(script, triggerPlaying(script, sound(2, 1)));
    expect(delayed.indexOf(FIRE_PLAYED)).toBeGreaterThan(delayed.indexOf(sound(2, 1)));
    expect(section(script, "ScriptScene2S021Played")).toContain(`${PLAYED_FLAG} = true;`);
    // Its own thread waits on that mark, then plays the part, once.
    const behind = section(script, BEHIND);
    const wait = behind.indexOf(`while (!((${PLAYED_FLAG} == true)))`);
    expect(wait).toBeGreaterThan(0);
    expect(behind.indexOf(sound(2, 2))).toBeGreaterThan(wait);
    expect(behind).toContain("_played == false");
    expect(script.split(sound(2, 2))).toHaveLength(2);
  });

  it("plays at its place on its cue when the named entry has already played, else waits without holding up the cue", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 3, cue: FAR });
    });
    const cue = section(script, triggerPlaying(script, RUN_WAITED));
    // Waited on if it can play at once, so what comes after it on the cue plays after it; else run without waiting.
    expect(cue).toContain(`if ((${PLAYED_FLAG} == true))`);
    expect(cue.indexOf(RUN_WAITED)).toBeLessThan(cue.indexOf(RUN_UNWAITED));
    expect(cue.indexOf(sound(3, 1))).toBeGreaterThan(cue.indexOf(RUN_UNWAITED));
    expect(cue).not.toContain(`while (!((${PLAYED_FLAG} == true)))`);
  });

  it("marks itself played from its own thread, for what waits on it", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "scenePlayed", scene: 2, from: "S02>2" } });
    });
    const behind = section(script, BEHIND);
    expect(behind.indexOf("TriggerExecute(gt_ScriptScene2S022Played, true, false);")).toBeGreaterThan(behind.indexOf(sound(2, 2)));
    expect(section(script, triggerPlaying(script, RUN_WAITED))).not.toContain("gt_ScriptScene2S022Played");
  });

  it("waits its delay first, then for the named entry, on its delayed trigger", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues[2].afterSeconds = 10;
    });
    const delayed = section(script, "ScriptScene2S022AfterAnchorsNovaEntersFar10sBehindScene2S021");
    const wait = delayed.indexOf("Wait(10.0, c_timeAI);");
    const behind = delayed.indexOf(`while (!((${PLAYED_FLAG} == true)))`);
    expect(wait).toBeGreaterThan(0);
    expect(behind).toBeGreaterThan(wait);
    expect(delayed.indexOf(sound(2, 2))).toBeGreaterThan(behind);
    expect(script).not.toContain(`gt_${BEHIND}`);
  });

  it("plays in a Beat's Lines trigger, after its pings, without holding up the lines after it", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues = [
        blueprint.screenplay.script.cues[0],
        { scene: 2, from: "S02>1", cue: FAR },
        { scene: 2, from: "S02>2", cue: HARRIED, after: { scene: 2, from: "S02>1" } },
        { scene: 3, cue: HARRIED },
      ];
    });
    const lines = section(script, "BeatHarriedLines");
    const behind = "ScriptScene2S022OnBeatHarriedBehindScene2S021";
    expect(lines).toContain(`TriggerExecute(gt_${behind}, true, false);`);
    expect(lines.indexOf(sound(3, 1))).toBeGreaterThan(lines.indexOf(`TriggerExecute(gt_${behind}, true, false);`));
    expect(section(script, "BeatHarried")).not.toContain(behind);
  });

  it("leaves the lines before a Cinematic of its own in a Beat's Lines trigger, as it's no part of the run the pings wait for", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues = [
        { scene: 2, from: "S02>1", cue: FAR },
        { scene: 3, cue: HARRIED },
        { scene: 1, cue: HARRIED, after: { scene: 2, from: "S02>1" } },
      ];
    });
    const lines = section(script, "BeatHarriedLines");
    expect(lines).toContain(sound(3, 1));
    expect(lines.indexOf("ScriptScene1OnBeatHarriedBehindScene2S021")).toBeGreaterThan(lines.indexOf(sound(3, 1)));
    expect(section(script, "BeatHarried")).not.toContain(sound(3, 1));
  });

  it("waits on a Cinematic having handed back", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues[2].after = { scene: 1 };
    });
    expect(section(script, "MissionStart").indexOf("TriggerExecute(gt_ScriptScene1Played, true, false);")).toBeGreaterThan(section(script, "MissionStart").indexOf("TriggerExecute(gt_CinematicRadio, true, true);"));
    expect(section(script, "ScriptScene2S022OnAnchorsNovaEntersFarBehindScene1")).toContain("while (!((gv_script_scenes_1_played == true)))");
  });

  it("plays a Cinematic of its own behind the named entry, apart from the run on its cue", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues = [
        { scene: 2, from: "S02>1", cue: HARRIED },
        { scene: 1, cue: { type: "missionStart" }, after: { scene: 2, from: "S02>1" } },
      ];
    });
    expect(section(script, "MissionStart")).not.toContain("TriggerExecute(gt_CinematicRadio, true, true);");
    const behind = section(script, "ScriptScene1OnMissionStartBehindScene2S021");
    expect(behind.indexOf("TriggerExecute(gt_CinematicRadio, true, true);")).toBeGreaterThan(behind.indexOf(`while (!((${PLAYED_FLAG} == true)))`));
  });

  it("isn't handed on to by the scene before it on its cue, nor hands on to the one after", async () => {
    const script = await compiled(
      (blueprint) => {
        blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 4 }];
        blueprint.screenplay.script.cues = [
          { scene: 2, from: "S02>1", cue: HARRIED },
          { scene: 1, cue: { type: "missionStart" } },
          { scene: 4, cue: { type: "missionStart" }, after: { scene: 2, from: "S02>1" } },
          { scene: 3, cue: { type: "scenePlayed", scene: 1 } },
        ];
      },
      LANDING,
    );
    const start = section(script, "MissionStart");
    // The Cinematic hands back, so it has played as it ends, not once the trigger scene has.
    expect(start.indexOf("TriggerExecute(gt_ScriptScene1Played, true, false);")).toBeGreaterThan(start.indexOf("TriggerExecute(gt_CinematicRadio, true, true);"));
    expect(start.indexOf("TriggerExecute(gt_ScriptScene1Played, true, false);")).toBeLessThan(start.indexOf("ScriptScene4OnMissionStartBehindScene2S021"));
    expect(start).not.toContain("TriggerExecute(gt_TriggerSceneLandingSetup, true, true);");
    expect(section(script, "ScriptScene4OnMissionStartBehindScene2S021")).toContain("gt_TriggerSceneLanding");
  });

  it("ends the run of scenes before it, so the one before hands back before it plays, not on to the one after", async () => {
    const script = await compiled(
      (blueprint) => {
        blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 4 }];
        blueprint.screenplay.script.cues = [
          { scene: 2, from: "S02>1", cue: HARRIED },
          { scene: 1, cue: FAR },
          { scene: 3, cue: FAR, after: { scene: 2, from: "S02>1" } },
          { scene: 4, cue: FAR },
        ];
      },
      LANDING,
    );
    const cue = section(script, triggerPlaying(script, "TriggerExecute(gt_CinematicRadio, true, true);"));
    expect(cue).not.toContain("gv_cinematic_radio_hand_on = true;");
    expect(cue).not.toContain("gv_trigger_scene_landing_after_cinematic = true;");
    const behind = cue.indexOf("ScriptScene3OnAnchorsNovaEntersFarBehindScene2S021");
    expect(behind).toBeGreaterThan(cue.indexOf("TriggerExecute(gt_CinematicRadio, true, true);"));
    expect(cue.indexOf("TriggerExecute(gt_TriggerSceneLandingSetup, true, true);")).toBeGreaterThan(behind);
  });

  it("plays in place, once, with no test of the mark and no wait for it, behind the entry it plays after earlier on its own cue", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues = [
        blueprint.screenplay.script.cues[0],
        { scene: 2, from: "S02>1", cue: FAR },
        { scene: 2, from: "S02>2", cue: FAR, after: { scene: 2, from: "S02>1" } },
        { scene: 3, cue: FAR },
      ];
    });
    const cue = section(script, triggerPlaying(script, sound(2, 1)));
    // The named entry's Played trigger, run without waiting, may not have set the mark yet: nothing here waits on it.
    expect(cue).not.toContain(RUN_UNWAITED);
    expect(cue).not.toContain(RUN_WAITED);
    expect(cue).not.toContain(`${PLAYED_FLAG} == true`);
    const once = cue.indexOf(`if ((gv_${BEHIND_ONCE} == false))`);
    expect(once).toBeGreaterThan(cue.indexOf(sound(2, 1)));
    expect(cue.indexOf(`gv_${BEHIND_ONCE} = true;`)).toBeGreaterThan(once);
    expect(cue.indexOf(sound(2, 2))).toBeGreaterThan(once);
    expect(cue.indexOf(sound(3, 1))).toBeGreaterThan(cue.indexOf(sound(2, 2)));
  });

  it("keeps apart two entries of one part on one cue, each after another entry", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "missionStart" } }, { scene: 2, from: "S02>2", cue: FAR, after: { scene: 4 } });
    });
    expect(script).toContain(`bool gt_${BEHIND}_Func`);
    expect(script).toContain("bool gt_ScriptScene2S022OnAnchorsNovaEntersFarBehindScene4_Func");
  });
});

describe("check", () => {
  it("refuses an after naming an entry that doesn't exist", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues[2].after = { scene: 4 };
    });
    expect(found).toContain("Scene 4 has no cue of its own, so it never plays and the entry after it would never play; cue it in screenplay.script.cues");
  });

  it("refuses an after naming a part and a line both", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues[2].after = { scene: 2, from: "S02>1", line: "D-01-01-02-001-NOVA" };
    });
    expect(found).toContain("An after names a part (from) or a line, not both");
  });

  it("refuses a cycle of entries each after another", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues[1].after = { scene: 2, from: "S02>2" };
    });
    expect(found).toContain("Scene 2 S02>1 plays after scene 2 S02>2, which plays after scene 2 S02>1: a cycle, so none of them plays");
  });

  it("refuses an entry after itself", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues[2].after = { scene: 2, from: "S02>2" };
    });
    expect(found).toContain("Scene 2 S02>2 plays after scene 2 S02>2: a cycle, so none of them plays");
  });

  it("refuses a cycle through an after and a scenePlayed cue together", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues[1].cue = { type: "scenePlayed", scene: 3 };
      blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "missionStart" }, after: { scene: 2, from: "S02>2" } });
    });
    expect(found).toContain("a cycle, so none of them plays");
    expect(found).toContain("plays after scene 2 S02>2");
    expect(found).toContain("waits on scene 3");
  });

  it("takes no cycle when the named scene has another entry that plays", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues[1].after = { scene: 2, from: "S02>2" };
      blueprint.screenplay.script.cues.push({ scene: 2, from: "S02>2", cue: { type: "missionStart" } });
    });
    expect(found).not.toContain("a cycle");
  });

  it("passes the entries as they stand", async () => {
    expect(await problems(() => {})).not.toContain("after");
  });
});

describe("a cue entry after another, at the game's end", () => {
  const outro = { id: "landing", scene: { outro: "victory", shots: LANDING.scene.shots } };

  it("is refused on a victory outro, which plays at once on its cue", async () => {
    const error = await compileError((blueprint) => {
      blueprint.outcomes = { victory: [FAR], defeat: [] };
      blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 4 }];
      blueprint.screenplay.script.cues.push({ scene: 4, cue: FAR, after: { scene: 2, from: "S02>1" } });
    }, outro);
    expect(error).toContain("Scene 4 is a victory outro, which ends the game, so its cue plays it at once: drop the after on its anchors/nova/enters/far cue");
  });

  it("is refused naming a victory outro", async () => {
    const error = await compileError((blueprint) => {
      blueprint.outcomes = { victory: [FAR], defeat: [] };
      blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 4 }];
      blueprint.screenplay.script.cues.push({ scene: 4, cue: FAR });
      blueprint.screenplay.script.cues[2].after = { scene: 4 };
    }, outro);
    expect(error).toContain("Scene 4 is a victory outro, which ends the game, so an entry after it would never play: drop the after on scene 2's cue");
  });

  it("is refused when the named entry plays only on a condition that ends the game", async () => {
    const error = await compileError((blueprint) => {
      blueprint.outcomes = { victory: [], defeat: [{ type: "anchorDies", anchorId: "nova" }] };
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "anchorDies", anchorId: "nova" } });
      blueprint.screenplay.script.cues[2].after = { scene: 4 };
    });
    expect(error).toContain("Scene 4 plays only on a condition that ends the game, so an entry after it would never play: drop the after on scene 2's cue");
  });
});

// Message 1 (`skipIfLate`) is dropped once Message 2, after it, reaches its cue first.
const SETTLED = "gv_script_scenes_2_S02_1_settled";
const DROP = "TriggerExecute(gt_ScriptScene2S021Dropped, true, false);";
const skipFirst = (blueprint: any): void => {
  blueprint.screenplay.script.cues[1].skipIfLate = true;
};

describe("a cue entry dropped once late (skipIfLate)", () => {
  it("plays only if nothing has dropped it by its turn, and settles itself as it begins", async () => {
    const script = await compiled(skipFirst);
    const own = section(script, triggerPlaying(script, sound(2, 1)));
    // Dropped before its turn, it doesn't queue; dropped while it queues, it plays nothing at its turn.
    expect(own.indexOf(`if ((${SETTLED} == false))`)).toBeLessThan(own.indexOf("gv_script_transmissions_playing = true;"));
    const test = own.indexOf(`if ((${SETTLED} == false))`, own.indexOf("gv_script_transmissions_playing = true;"));
    expect(test).toBeGreaterThan(0);
    expect(own.indexOf(`${SETTLED} = true;`)).toBeGreaterThan(test);
    expect(own.indexOf(sound(2, 1))).toBeGreaterThan(own.indexOf(`${SETTLED} = true;`));
    // The queue is let go either way.
    expect(own.lastIndexOf("gv_script_transmissions_playing = false;")).toBeGreaterThan(own.indexOf(sound(2, 1)));
  });

  it("is dropped as the entry after it reaches its cue, before that entry waits for it", async () => {
    const script = await compiled(skipFirst);
    const cue = section(script, triggerPlaying(script, RUN_UNWAITED));
    // Settled there and then, on the cue's own thread, so its own thread can't begin it after.
    const test = cue.indexOf(`if ((${SETTLED} == false))`);
    expect(test).toBeGreaterThan(0);
    expect(cue.indexOf(`${SETTLED} = true;`)).toBeGreaterThan(test);
    expect(cue.indexOf(DROP)).toBeGreaterThan(cue.indexOf(`${SETTLED} = true;`));
    expect(cue.indexOf(DROP)).toBeLessThan(cue.indexOf(`if ((${PLAYED_FLAG} == true))`));
    const dropped = section(script, "ScriptScene2S021Dropped");
    expect(dropped).toContain(FIRE_PLAYED);
    expect(dropped).not.toContain(sound(2, 1));
  });

  it("counts as played once dropped, after the entry it plays after has played, so the order holds", async () => {
    const script = await compiled((blueprint) => {
      skipFirst(blueprint);
      blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "missionStart" } });
      blueprint.screenplay.script.cues[1].after = { scene: 3 };
    });
    const dropped = section(script, "ScriptScene2S021Dropped");
    const wait = dropped.indexOf("while (!((gv_script_scenes_3_played == true)))");
    expect(wait).toBeGreaterThan(0);
    expect(dropped.indexOf(FIRE_PLAYED)).toBeGreaterThan(wait);
  });

  it("starts the Beats that start on it as it's dropped, and its scenePlayed cues fire", async () => {
    const script = await compiled((blueprint) => {
      skipFirst(blueprint);
      blueprint.beats.push({ id: "echo", title: "Echo", summary: "The first message goes.", startsWhen: [{ type: "scenePlays", scene: 2, from: "S02>1" }] });
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "scenePlayed", scene: 2, from: "S02>1" } });
    });
    const dropped = section(script, "ScriptScene2S021Dropped");
    expect(dropped).toContain("TriggerExecute(gt_BeatEcho, true, false);");
    expect(dropped.indexOf(FIRE_PLAYED)).toBeGreaterThan(dropped.indexOf("gt_BeatEcho"));
    expect(section(script, "ScriptScene2S021Played")).toContain(sound(4, 1));
  });

  it("is dropped by an entry after it down a chain of afters", async () => {
    const script = await compiled((blueprint) => {
      skipFirst(blueprint);
      blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "cave" }, after: { scene: 2, from: "S02>2" } });
    });
    expect(section(script, "ScriptScene3OnAnchorsNovaEntersCaveBehindScene2S022")).not.toContain(DROP);
    const cue = section(script, triggerPlaying(script, "TriggerExecute(gt_ScriptScene3OnAnchorsNovaEntersCaveBehindScene2S022, true, false);"));
    expect(cue).toContain(DROP);
  });

  it("is dropped by a delayed entry after it once its delay is up, before it waits", async () => {
    const script = await compiled((blueprint) => {
      skipFirst(blueprint);
      blueprint.screenplay.script.cues[2].afterSeconds = 10;
    });
    const delayed = section(script, "ScriptScene2S022AfterAnchorsNovaEntersFar10sBehindScene2S021");
    expect(delayed.indexOf(DROP)).toBeGreaterThan(delayed.indexOf("Wait(10.0, c_timeAI);"));
    expect(delayed.indexOf(DROP)).toBeLessThan(delayed.indexOf(`while (!((${PLAYED_FLAG} == true)))`));
  });

  it("leaves an entry without it as it was", async () => {
    const script = await compiled();
    expect(script).not.toContain("Dropped");
    expect(script).not.toContain("_settled");
  });
});

describe("check, of skipIfLate", () => {
  it("refuses one that nothing plays after, so it never applies", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues[2].skipIfLate = true;
    });
    expect(found).toContain("Scene 2 S02>2's skipIfLate never applies: no entry plays after it; drop skipIfLate or give a later entry an after on it");
  });

  it("refuses one whose later entries are all cued only once it has played", async () => {
    const found = await problems((blueprint) => {
      skipFirst(blueprint);
      blueprint.screenplay.script.cues[2].cue = { type: "scenePlayed", scene: 2, from: "S02>1" };
    });
    expect(found).toContain("Scene 2 S02>1's skipIfLate never applies: every entry after it is cued only once it has played, or comes after it on the same cue; drop skipIfLate");
  });

  it("refuses one whose later entry waits on a Beat that only it starts", async () => {
    const found = await problems((blueprint) => {
      skipFirst(blueprint);
      blueprint.beats.push({ id: "echo", title: "Echo", summary: "The first message goes.", startsWhen: [{ type: "scenePlays", scene: 2, from: "S02>1" }] });
      blueprint.screenplay.script.cues[2].cue = { type: "beatStarts", beatId: "echo" };
    });
    expect(found).toContain("Scene 2 S02>1's skipIfLate never applies: every entry after it is cued only once it has played");
  });

  it("refuses one whose later entry comes after it on the same cue, as it has begun by then", async () => {
    const found = await problems((blueprint) => {
      skipFirst(blueprint);
      blueprint.screenplay.script.cues[1] = { scene: 2, from: "S02>1", cue: FAR, skipIfLate: true };
    });
    expect(found).toContain("Scene 2 S02>1's skipIfLate never applies: every entry after it is cued only once it has played, or comes after it on the same cue; drop skipIfLate");
  });

  it("refuses one whose later entry always comes first on the same cue, so it never plays", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues[1] = { scene: 2, from: "S02>1", cue: FAR, afterSeconds: 5, skipIfLate: true };
    });
    expect(found).toContain("Scene 2 S02>1's skipIfLate always applies, so it never plays: Scene 2 S02>2 reaches the same cue first; drop skipIfLate or cue them apart");
  });

  it("refuses one on a Cinematic", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues[0].skipIfLate = true;
      blueprint.screenplay.script.cues[2].after = { scene: 1 };
    });
    expect(found).toContain("Scene 1 plays as a Cinematic, which skipIfLate doesn't drop: it drops Transmissions; drop skipIfLate");
  });

  it("refuses one on a trigger scene", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 4 }];
      blueprint.screenplay.script.cues.push({ scene: 4, cue: HARRIED, skipIfLate: true });
      blueprint.screenplay.script.cues[2].after = { scene: 4 };
    });
    expect(found).toContain("Scene 4 plays as a trigger scene, which skipIfLate doesn't drop: it drops Transmissions; drop skipIfLate");
  });

  it("refuses one on a part that several entries play", async () => {
    const found = await problems((blueprint) => {
      skipFirst(blueprint);
      blueprint.screenplay.script.cues.push({ scene: 2, from: "S2>1", cue: { type: "missionStart" } });
    });
    expect(found).toContain("skipIfLate drops Scene 2 S02>1, which 2 cue entries play: cue it once");
  });

  it("passes one that an entry after it can overtake", async () => {
    expect(await problems(skipFirst)).not.toContain("skipIfLate");
  });
});
