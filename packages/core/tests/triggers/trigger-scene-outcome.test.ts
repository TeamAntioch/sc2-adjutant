// A victory outro with no Screenplay scene (#463), on the `cinematic` fixture Workspace's Radio
// Field: Nova reaching the field wins the mission, and the trigger scene `closing`, listed by its
// outcome (`{ id, outcome: "victory" }`) and cued nowhere in screenplay.script.cues, plays there,
// a camera Anchor held for 4 s with no lines, then the victory. The compiled MapScript.galaxy is read back.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ScriptReferenceSchema } from "../../src/domain/mission-blueprint.js";
import { compileMission } from "../../src/map/compile-mission.js";
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
/** One camera Anchor held for 4 s while Nova walks, then the fade to victory: no lines. */
const CLOSING = { outro: "victory", shots: [{ camera: "cam-victory", afterMs: 0, pauseAfterMs: 4000, orders: [{ units: ["nova"], moveTo: { x: 32, y: 30 } }] }] };

/** Radio Field won when Nova reaches the field, with `closing` listed by the victory outcome. */
async function workspace(edit: (blueprint: any, scene: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-victory", 30, 30), unit("nova", 10, 10)];
  blueprint.outcomes = { victory: [REACHES_FIELD], defeat: [] };
  blueprint.screenplay.script.triggerScenes = [{ id: "closing", outcome: "victory" }];
  const scene = structuredClone(CLOSING);
  edit(blueprint, scene);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  await writeFile(path.join(mission, "trigger-scenes/closing.json"), JSON.stringify(scene));
  return { root, blueprintPath };
}

async function compiled(edit?: (blueprint: any, scene: any) => void): Promise<string> {
  const { root, blueprintPath } = await workspace(edit);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return readFile(path.join(map, "MapScript.galaxy"), "utf8");
}

async function problemsOf(edit: (blueprint: any, scene: any) => void): Promise<string[]> {
  const { root } = await workspace(edit);
  const { problems } = await checkWorkspace(root);
  return problems.filter((problem) => problem.severity === undefined || problem.severity === "error").map((problem) => `${problem.path ?? ""}: ${problem.message}`);
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const lines = (...statements: string[]): string => statements.map((statement) => (statement ? `    ${statement}` : "")).join("\r\n");
const RUN = "TriggerExecute(gt_TriggerSceneClosingSetup, true, true);";
const GAME_OVER = "GameOver(1, c_gameOverVictory, true, true);";

describe("a victory outro listed by its outcome", () => {
  it("compiles with no Screenplay scene and no cue, and plays from the victory trigger, then ends the game in victory", async () => {
    const victory = section(await compiled(), "novaReachesField");
    expect(victory).toContain(lines("gv_trigger_scene_closing_skipped = false;", "gv_trigger_scene_closing_after_cinematic = false;", RUN, GAME_OVER));
  });

  it("plays on each victory condition", async () => {
    const dies = { type: "anchorDies", anchorId: "nova" };
    const script = await compiled((blueprint) => {
      blueprint.outcomes = { victory: [REACHES_FIELD, dies], defeat: [] };
    });
    expect(section(script, "novaReachesField")).toContain(lines(RUN, GAME_OVER));
    expect(section(script, "novaDies")).toContain(lines(RUN, GAME_OVER));
  });

  it("is that death pause itself when a death wins", async () => {
    const dies = { type: "anchorDies", anchorId: "nova" };
    const victory = section(
      await compiled((blueprint) => {
        blueprint.outcomes = { victory: [dies], defeat: [] };
      }),
      "novaDies",
    );
    expect(victory).toContain(lines(RUN, GAME_OVER));
    expect(victory).not.toContain("Wait(3.0, c_timeGame);");
  });

  it("plays last, after the scenes the victory condition cues", async () => {
    const victory = section(
      await compiled((blueprint) => {
        blueprint.screenplay.script.cues.push({ scene: 2, cue: REACHES_FIELD });
      }),
      "novaReachesField",
    );
    const line = victory.indexOf("TransmissionSendForPlayerSelect(");
    expect(line).toBeGreaterThan(-1);
    expect(victory.indexOf(RUN)).toBeGreaterThan(line);
  });

  it("leaves no defeat condition playing it", async () => {
    const dies = { type: "anchorDies", anchorId: "nova" };
    const script = await compiled((blueprint) => {
      blueprint.outcomes = { victory: [REACHES_FIELD], defeat: [dies] };
    });
    expect(section(script, "novaDies")).not.toContain(RUN);
  });

  it("holds the clocks while it plays, so a goal timer can't end the game under it", async () => {
    const victory = section(
      await compiled((blueprint) => {
        blueprint.outcomes = { victory: [REACHES_FIELD], defeat: [{ type: "timer", seconds: 600 }] };
      }),
      "novaReachesField",
    );
    const hold = victory.indexOf("TriggerExecute(gt_ClocksHold, true, true);");
    expect(hold).toBeGreaterThan(-1);
    expect(victory.indexOf(RUN)).toBeGreaterThan(hold);
  });
});

describe("a victory outro listed by its outcome, after the scenes its victory condition cues", () => {
  /** As compiled() and problemsOf(), with a second trigger scene file written beside the outro. */
  const withField = async (extra: any = {}): Promise<{ root: string; blueprintPath: string }> => {
    const { root, blueprintPath } = await workspace((blueprint) => {
      blueprint.anchors.push({ id: "cam-field", name: "cam-field", zoneId: "field", kind: "camera", position: { x: 20, y: 20 }, cameraTarget: { x: 20, y: 20 }, cameraValues: [{ index: "Distance", value: 30 }] });
      blueprint.screenplay.script.cues.push({ scene: 2, cue: REACHES_FIELD });
      blueprint.screenplay.script.triggerScenes.push({ id: "field", scene: 2 });
    });
    await writeFile(path.join(path.dirname(blueprintPath), "trigger-scenes/field.json"), JSON.stringify({ shots: [{ camera: "cam-field", line: "radio_field-2-1" }], ...extra }));
    return { root, blueprintPath };
  };
  const compiledWith = async (extra: any = {}): Promise<string> => {
    const { root, blueprintPath } = await withField(extra);
    const map = path.join(await tempFolder(), "RadioField.SC2Map");
    await compileMission(await loadWorkspace(root), blueprintPath, map);
    return readFile(path.join(map, "MapScript.galaxy"), "utf8");
  };
  it("is handed on to by the cued trigger scene, so one skip and one fade to black play both", async () => {
    const victory = section(await compiledWith(), "novaReachesField");
    expect(victory).toContain(
      lines(
        "gv_trigger_scene_field_hand_on = true;",
        "gv_trigger_scene_field_skipped = false;",
        "gv_trigger_scene_field_after_cinematic = false;",
        "TriggerExecute(gt_TriggerSceneFieldSetup, true, true);",
        "gv_trigger_scene_closing_skipped = (gv_trigger_scene_field_completed == false);",
      ),
    );
    expect(victory.indexOf(RUN)).toBeLessThan(victory.indexOf(GAME_OVER));
  });

  it("holds the clocks once for the run, from before the cued scene until the outro has played", async () => {
    const { root, blueprintPath } = await withField();
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    blueprint.outcomes = { victory: [REACHES_FIELD], defeat: [{ type: "timer", seconds: 600 }] };
    await writeFile(blueprintPath, JSON.stringify(blueprint));
    const map = path.join(await tempFolder(), "RadioField.SC2Map");
    await compileMission(await loadWorkspace(root), blueprintPath, map);
    const victory = section(await readFile(path.join(map, "MapScript.galaxy"), "utf8"), "novaReachesField");
    expect(victory.split("TriggerExecute(gt_ClocksHold, true, true);").length - 1).toBe(1);
    expect(victory.split("TriggerExecute(gt_ClocksRelease, true, true);").length - 1).toBe(1);
    expect(victory.indexOf("TriggerExecute(gt_ClocksHold, true, true);")).toBeLessThan(victory.indexOf("TriggerExecute(gt_TriggerSceneFieldSetup, true, true);"));
    expect(victory.indexOf("TriggerExecute(gt_ClocksRelease, true, true);")).toBeGreaterThan(victory.indexOf(RUN));
  });

  it("refuses a handback, lines after it included, on the cued scene, which hands on to the outro and never hands back there", async () => {
    await expect(compiledWith({ handback: { linesFrom: "radio_field-2-1" }, shots: [{ camera: "cam-field", afterMs: 0, pauseAfterMs: 1000 }] })).rejects.toThrow(
      /Trigger scene field hands on to the scene after it on every cue that plays it, so it never hands back: move its handback options to the last scene/,
    );
  });
});

describe("a victory outro listed by its outcome, run once", () => {
  it("plays from the first victory condition met: a second met while it plays starts nothing", async () => {
    const dies = { type: "anchorDies", anchorId: "nova" };
    const script = await compiled((blueprint) => {
      blueprint.outcomes = { victory: [REACHES_FIELD, dies], defeat: [] };
    });
    for (const trigger of ["novaReachesField", "novaDies"]) {
      const victory = section(script, trigger);
      expect(victory).toContain("if (!((gv_victory_outro_started == false))) {");
      expect(victory.indexOf("gv_victory_outro_started = true;")).toBeGreaterThan(-1);
      expect(victory.indexOf("gv_victory_outro_started = true;")).toBeLessThan(victory.indexOf(RUN));
    }
  });
});

describe("what a victory outro listed by its outcome may be", () => {
  it("a victory outro", async () => {
    expect(
      await problemsOf((_blueprint, scene) => {
        delete scene.outro;
      }),
    ).toContain('outro: closing plays on the victory outcome, so it is a victory outro: give it outro "victory"');
  });

  it("with no lines, since it has no Screenplay scene", async () => {
    expect(
      await problemsOf((_blueprint, scene) => {
        delete scene.shots[0].afterMs;
        scene.shots[0].line = "D-01-01-02-001-NOVA";
      }),
    ).toEqual(["shots.0.line: closing plays on the victory outcome with no Screenplay scene, so it has no lines; leave out D-01-01-02-001-NOVA"]);
  });

  it("aimed at no cue's unit, since a victory condition names none", async () => {
    expect(
      await problemsOf((_blueprint, scene) => {
        scene.shots[0].unit = "cue";
      }),
    ).toEqual(["shots.0.unit: The shot aims at the cue's unit, but closing plays on the victory outcome's anchorEntersZone condition, which gives a scene no unit to aim at (only an anchorNears or effectStarts cue does); aim at a unit Anchor"]);
  });

  it("only with a victory condition to play on", async () => {
    expect(
      await problemsOf((blueprint) => {
        blueprint.outcomes = { victory: [], defeat: [] };
      }),
    ).toContain(": closing plays on the victory outcome, but the Blueprint has no victory condition, so it would never play");
  });

  it("a victory outro to compile, too", async () => {
    await expect(
      compiled((_blueprint, scene) => {
        delete scene.outro;
      }),
    ).rejects.toThrow(/closing plays on the victory outcome, so it is a victory outro: give it outro "victory"/);
  });

  it("timed to a victory outro's budget, with no handback", async () => {
    const { root } = await workspace((_blueprint, scene) => {
      scene.shots[0].pauseAfterMs = 41000;
    });
    const t4 = (await checkWorkspace(root)).problems.filter((problem) => problem.message.startsWith("T4:")).map((problem) => problem.message);
    // 1.5 s fade in, 41 s held and a 2 s fade out: 44.5 s, under the outro's 45 s warning, and no 1.5 s handback.
    expect(t4).toEqual([expect.stringMatching(/^T4: it runs 44\.5 s, over the 30 s worth reviewing \(a victory outro runs about 25 s\)/)]);
  });

  it("the only victory outro, which check_workspace reports too", async () => {
    const { root, blueprintPath } = await workspace((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, cue: REACHES_FIELD });
      blueprint.screenplay.script.triggerScenes.push({ id: "closing-too", scene: 2 });
    });
    await writeFile(path.join(path.dirname(blueprintPath), "trigger-scenes/closing-too.json"), JSON.stringify({ outro: "victory", shots: [{ camera: "cam-victory", line: "radio_field-2-1" }] }));
    const { problems } = await checkWorkspace(root);
    expect(problems.map((problem) => `${problem.path ?? ""}: ${problem.message}`)).toContain(
      "outro: closing plays on the victory outcome, last on every victory condition, so closing-too can't end the game too: list one victory outro",
    );
  });

  it("the only victory outro", async () => {
    const { root, blueprintPath } = await workspace((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, cue: REACHES_FIELD });
      blueprint.screenplay.script.triggerScenes.push({ id: "closing-too", scene: 2 });
    });
    await writeFile(path.join(path.dirname(blueprintPath), "trigger-scenes/closing-too.json"), JSON.stringify(CLOSING));
    const error = await compileMission(await loadWorkspace(root), blueprintPath, path.join(await tempFolder(), "Out.SC2Map")).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    // Refused by the trigger scene checks the compile runs first, as check_workspace reports it.
    expect(String(error)).toContain("closing plays on the victory outcome, last on every victory condition, so closing-too can't end the game too: list one victory outro");
  });
});

describe("listing a trigger scene", () => {
  const reference = (triggerScenes: unknown[]) => ScriptReferenceSchema.safeParse({ source: "s.md", triggerScenes });
  const messages = (triggerScenes: unknown[]) => {
    const parsed = reference(triggerScenes);
    return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  };

  it("by its scene or its outcome, not both", () => {
    expect(messages([{ id: "a", scene: 1, outcome: "victory" }])).toContain("triggerScenes.0: A trigger scene plays its Screenplay scene or the victory outcome; give scene or outcome, not both");
    expect(messages([{ id: "a" }])).toContain("triggerScenes.0: A trigger scene plays its Screenplay scene or the victory outcome; give scene or outcome");
  });

  it("only by the victory outcome", () => {
    expect(reference([{ id: "a", outcome: "defeat" }]).success).toBe(false);
  });

  it("once by the victory outcome", () => {
    expect(messages([{ id: "a", outcome: "victory" }, { id: "b", outcome: "victory" }])).toContain(
      "triggerScenes.1.outcome: a already plays on the victory outcome, and only one victory outro can end the game",
    );
  });

  it("needs no cue when listed by outcome", () => {
    expect(reference([{ id: "a", outcome: "victory" }]).success).toBe(true);
  });
});
