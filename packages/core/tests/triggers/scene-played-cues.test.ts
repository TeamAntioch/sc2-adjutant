// Cues on a scene, or part of one, having played (`scenePlayed`): the `cinematic` fixture
// Workspace's Radio Field with a scene of two messages, the first cued on a Beat's start, and a
// scene 3 cued 30 s after that first message has played. The compiled map's MapScript.galaxy is
// read back.
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

async function workspace(edit: (blueprint: any) => void = () => {}, triggerScene?: { id: string; scene: unknown }): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENES);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.zones = [
    { id: "near", name: "Near", elevation: 1, landform: "flat", role: "base", polygon: square(0, 0, 32) },
    { id: "far", name: "Far", elevation: 1, landform: "flat", role: "path", polygon: square(32, 0, 32) },
  ];
  blueprint.anchors = [unit("nova", 10), camera("cam-wide", 20, 20)];
  blueprint.beats.push({ id: "harried", title: "Harried", summary: "Nova reaches the far side.", startsWhen: [{ type: "anchorEntersZone", anchorId: "nova", zoneId: "far" }] });
  blueprint.screenplay.script.cues.push(
    { scene: 2, from: "S02>1", cue: { type: "beatStarts", beatId: "harried" } },
    { scene: 3, cue: { type: "scenePlayed", scene: 2, from: "S02>1" }, afterSeconds: 30 },
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

async function problems(edit: (blueprint: any) => void): Promise<string> {
  const { root } = await workspace(edit);
  return (await checkWorkspace(root)).problems.map((problem) => problem.message).join("\n");
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const sound = (scene: number, line: number): string => `SoundLink("radio_field-${scene}-${line}", -1)`;
const RELEASE = "gv_script_transmissions_playing = false;";
const PLAYED = "TriggerExecute(gt_ScriptScene2S021Played, true, false);";
const DELAYED = "ScriptScene3AfterScene2S021Played30s";

describe("a cue on a scene's part having played", () => {
  it("fires once the part's last Transmission has ended, from the trigger that played it", async () => {
    // The Beat's lines trigger, which plays the Transmissions cued on its start.
    const beat = section(await compiled(), "BeatHarriedLines");
    expect(beat).toContain(PLAYED);
    expect(beat.indexOf(PLAYED)).toBeGreaterThan(beat.indexOf(sound(2, 1)));
    expect(beat.indexOf(PLAYED)).toBeGreaterThan(beat.indexOf(RELEASE));
  });

  it("plays its scene after its delay, counted from the part's end", async () => {
    const script = await compiled();
    expect(section(script, "ScriptScene2S021Played")).toContain(`TriggerExecute(gt_${DELAYED}, true, false);`);
    const delayed = section(script, DELAYED);
    expect(delayed.indexOf("Wait(30.0, c_timeAI);")).toBeGreaterThanOrEqual(0);
    expect(delayed.indexOf(sound(3, 1))).toBeGreaterThan(delayed.indexOf("Wait(30.0, c_timeAI);"));
    expect(script.split(sound(3, 1))).toHaveLength(2);
  });

  it("fires once, however many cues play the part", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, from: "S02>1", cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "near" }, afterSeconds: 5 });
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "scenePlayed", scene: 2, from: "S02>1" } });
    });
    expect(script.split(PLAYED)).toHaveLength(3);
    const played = section(script, "ScriptScene2S021Played");
    expect(played).toContain("gv_script_scenes_2_S02_1_played == false");
    expect(played.indexOf("gv_script_scenes_2_S02_1_played = true;")).toBeLessThan(played.indexOf(sound(4, 1)));
    // An undelayed scene on it plays from the trigger itself, so once.
    expect(script.split(sound(4, 1))).toHaveLength(2);
  });

  it("fires on the whole scene's end when it names no part", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues = [
        blueprint.screenplay.script.cues[0],
        { scene: 2, cue: { type: "beatStarts", beatId: "harried" } },
        { scene: 3, cue: { type: "scenePlayed", scene: 2 } },
      ];
    });
    const beat = section(script, "BeatHarriedLines");
    const fire = "TriggerExecute(gt_ScriptScene2Played, true, false);";
    expect(beat.indexOf(fire)).toBeGreaterThan(beat.indexOf(sound(2, 2)));
    expect(section(script, "ScriptScene2Played")).toContain(sound(3, 1));
  });
});

describe("a part's address", () => {
  it("names the same part however its scene number is written", async () => {
    // The entry writes S02>1, the cue S2>1: one stage direction, so one Played trigger.
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues[blueprint.screenplay.script.cues.length - 1].cue.from = "S2>1";
    });
    expect(section(script, "BeatHarriedLines")).toContain(PLAYED);
    expect(section(script, "ScriptScene2S021Played")).toContain("TriggerExecute(gt_ScriptScene3After");
  });

  it("isn't refused for the other spelling", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "scenePlayed", scene: 2, from: "S2>1" } });
    });
    expect(found).not.toContain("has no cue of its own");
  });
});

describe("a cue on a scene having played, off the script's cues", () => {
  it("plays an inline scene cued on it", async () => {
    const script = await compiled((blueprint) => {
      (blueprint.screenplay.scenes ??= []).push({ id: "aside", cue: { type: "scenePlayed", scene: 2, from: "S02>1" }, lines: [{ id: "aside-1", speaker: "Nova", speakerUnitType: "Marine", text: "Aside." }] });
    });
    expect(section(script, "ScriptScene2S021Played")).toContain(`TransmissionSourceFromUnitType("Marine", false)`);
  });
});

describe("a cue on a scene that ends the game", () => {
  it("is refused when only a condition that ends the game plays the scene", async () => {
    const { root, blueprintPath } = await workspace((blueprint) => {
      blueprint.outcomes = { victory: [], defeat: [{ type: "anchorDies", anchorId: "nova" }] };
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "anchorDies", anchorId: "nova" } }, { scene: 3, cue: { type: "scenePlayed", scene: 4 } });
    });
    const error = await compileMission(await loadWorkspace(root), blueprintPath, path.join(await tempFolder(), "Out.SC2Map")).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(String(error)).toContain("Scene 4 plays only on a condition that ends the game, so a scenePlayed cue on it would never fire: cue scene 3 on something else");
  });
});

describe("a cue on a trigger scene having played", () => {
  const LANDING = { id: "landing", scene: { shots: [{ camera: "cam-wide", afterMs: 0, pauseAfterMs: 1000 }], handback: { camera: "cam-wide" } } };
  const chained = (blueprint: any) => {
    blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 4 }];
    blueprint.screenplay.script.cues = [
      blueprint.screenplay.script.cues[0],
      { scene: 4, cue: { type: "missionStart" } },
      { scene: 3, cue: { type: "scenePlayed", scene: 1 } },
      { scene: 2, cue: { type: "scenePlayed", scene: 4 } },
    ];
  };

  it("fires once it has handed back, and for a scene that handed on to it, only then", async () => {
    const start = section(await compiled(chained, LANDING), "MissionStart");
    const setup = start.indexOf("TriggerExecute(gt_TriggerSceneLandingSetup, true, true);");
    expect(setup).toBeGreaterThan(start.indexOf("TriggerExecute(gt_CinematicRadio, true, true);"));
    // The Cinematic hands on to the trigger scene, so it has played when the trigger scene hands back.
    expect(start.indexOf("TriggerExecute(gt_ScriptScene1Played, true, false);")).toBeGreaterThan(setup);
    expect(start.indexOf("TriggerExecute(gt_ScriptScene4Played, true, false);")).toBeGreaterThan(setup);
  });
});

describe("check", () => {
  it("refuses a cue on a part that has no cue of its own", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "scenePlayed", scene: 2, from: "S02>2" } });
    });
    expect(found).toContain("Scene 2 S02>2 has no cue of its own, so it never plays and this cue would never fire; cue it in screenplay.script.cues");
  });

  it("refuses a cue on a whole scene that only its parts' cues play", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "scenePlayed", scene: 2 } });
    });
    expect(found).toContain("Scene 2 has no cue of its own, so it never plays and this cue would never fire; cue it in screenplay.script.cues");
  });

  it("refuses a part named on another scene", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "scenePlayed", scene: 3, from: "S02>1" } });
    });
    expect(found).toContain("S02>1 is a stage direction of scene 2, not of scene 3");
  });

  it("refuses a cycle of scenes each waiting on another having played", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "scenePlayed", scene: 2 } }, { scene: 2, cue: { type: "scenePlayed", scene: 4 } });
    });
    expect(found).toContain("Scene 4 waits on scene 2 having played, which waits on scene 4: a cycle, so none of them plays");
  });

  it("refuses a scene waiting on itself", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "scenePlayed", scene: 4 } });
    });
    expect(found).toContain("Scene 4 waits on scene 4 having played: a cycle, so none of them plays");
  });

  it("takes a loop as no cycle when a scene in it has a cue of another kind too", async () => {
    // Scene 3 plays after S02>1, then scene 4, then scene 3's second entry finds it already played.
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "scenePlayed", scene: 3 } }, { scene: 3, cue: { type: "scenePlayed", scene: 4 } });
    });
    expect(found).not.toContain("a cycle");
  });
});
