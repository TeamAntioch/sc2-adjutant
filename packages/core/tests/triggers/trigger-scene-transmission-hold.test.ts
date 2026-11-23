// A trigger scene and the lines played in play around it (#485, ADR 0013): the `cinematic` fixture
// Workspace's Radio Field plays scene 2 as the trigger scene `landing` when Nova reaches the field,
// and scene 3's one line as an in-play Transmission when Zeratul does. The trigger scene starts at
// once, cutting the in-play line playing, which is replayed once the scene and its lines after the
// handback have played. The compiled MapScript.galaxy is read back.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENES = [
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
  "**NOVA** `D-01-01-03-002-NOVA`: Higher.",
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

const SCENE = { shots: [{ camera: "cam-wide", afterMs: 0 }, { camera: "cam-wide", to: "cam-goal", line: "radio_field-2-1" }] };
const RIDGE = { shots: [{ camera: "cam-goal", afterMs: 0 }] };

async function compiled(edit: (blueprint: any, scene: any) => void = () => {}): Promise<string> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENES);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera("cam-wide", 20, 20), camera("cam-goal", 44, 40), unit("nova", 10, 10), unit("zeratul", 12, 10)];
  blueprint.screenplay.script.cues.push(
    { scene: 2, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" } },
    { scene: 3, cue: { type: "anchorEntersZone", anchorId: "zeratul", zoneId: "field" } },
  );
  blueprint.screenplay.script.speakerAnchors = { NOVA: "nova" };
  blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 2 }];
  const scene = structuredClone(SCENE);
  edit(blueprint, scene);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  await writeFile(path.join(mission, "trigger-scenes/landing.json"), JSON.stringify(scene));
  await writeFile(path.join(mission, "trigger-scenes/ridge.json"), JSON.stringify(RIDGE));
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return readFile(path.join(map, "MapScript.galaxy"), "utf8");
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const lines = (...statements: string[]): string => statements.map((statement) => (statement ? `    ${statement}` : "")).join("\r\n");
/** The statements of a trigger's actions that send a line, by its sound ID. */
/** A scene's give-back: none holds the lines, unless another scene has taken them since. */
const GIVE_BACK = (number: number): string => lines(`if ((gv_script_trigger_scene == ${number})) {`, "    gv_script_trigger_scene = 0;", "}");
const sendOf = (sound: string): RegExp => new RegExp(`TransmissionSendForPlayerSelect\\([^\\r\\n]*SoundLink\\("${sound}", -1\\)[^\\r\\n]*\\);`);

describe("a trigger scene and the in-play lines around it", () => {
  it("starts at once, taking the lines and cutting only the in-play line that's playing", async () => {
    const setup = section(await compiled(), "TriggerSceneLandingSetup");
    expect(setup).toContain(
      lines(
        "gv_script_trigger_scene = 1;",
        "if ((TransmissionIsComplete(gv_script_line) == false)) {",
        "    TransmissionClear(gv_script_line);",
        "    gv_script_line_cut = true;",
        "}",
        "",
        "if ((TransmissionIsComplete(gv_script_trigger_scene_line) == false)) {",
        "    TransmissionClear(gv_script_trigger_scene_line);",
        "    gv_script_trigger_scene_line_cut = true;",
        "}",
        "",
        "CinematicFade(false, 0.0, c_fadeStyleNormal, Color(0.00, 0.00, 0.00), 0.0, true);",
      ),
    );
    expect(setup).not.toContain("TransmissionClearAll(");
    expect(setup).not.toContain("gv_script_transmissions_playing");
  });

  it("replays the in-play line it cut off once it has played, then the rest of that line's cue", async () => {
    const cue = section(await compiled(), "zeratulReachesField");
    // Each in-play line waits until no trigger scene holds the lines, and is sent again, from its
    // top, if one cut it off: until it plays to its end uncut.
    const replayed = (sound: string) =>
      new RegExp(
        [
          "gv_script_line_sent = false;",
          "while \\(\\(gv_script_line_sent == false\\)\\) \\{",
          "    while \\(!\\(\\(gv_script_trigger_scene == 0\\)\\)\\) \\{",
          "        Wait\\(0\\.25, c_timeGame\\);",
          "    \\}",
          "    gv_script_line_cut = false;",
          `    TransmissionSendForPlayerSelect\\([^\\r\\n]*SoundLink\\("${sound}", -1\\)[^\\r\\n]*, false, c_maxPlayers, false\\);`,
          "    gv_script_line = TransmissionLastSent\\(\\);",
          "    TransmissionWait\\(gv_script_line, 0\\.0\\);",
          "    gv_script_line_sent = \\(gv_script_line_cut == false\\);",
          "\\}",
        ]
          .map((statement) => `    ${statement}`)
          .join("\\r\\n"),
      );
    expect(cue).toMatch(replayed("radio_field-3-1"));
    expect(cue).toMatch(replayed("radio_field-3-2"));
    expect(cue.search(replayed("radio_field-3-2"))).toBeGreaterThan(cue.search(replayed("radio_field-3-1")));
    // Still queued behind another cue's scene, as before.
    expect(cue.indexOf("gv_script_transmissions_playing = true;")).toBeLessThan(cue.search(replayed("radio_field-3-1")));
    expect(cue.indexOf("gv_script_transmissions_playing = false;")).toBeGreaterThan(cue.search(replayed("radio_field-3-2")));
  });

  it("keeps each of its own lines as it plays it, and its Cleanup cuts off that line and no other", async () => {
    const script = await compiled();
    expect(section(script, "TriggerSceneLandingCinematic")).toMatch(
      new RegExp(`${sendOf("radio_field-2-1").source}\\r\\n    gv_script_trigger_scene_line = TransmissionLastSent\\(\\);\\r\\n    TransmissionWait\\(gv_script_trigger_scene_line, 0\\.0\\);`),
    );
    expect(section(script, "TriggerSceneLandingCleanup")).toContain("    TransmissionClear(gv_script_trigger_scene_line);\r\n    CameraLockInput(1, false);");
    expect(script).not.toContain("TransmissionClearAll(");
  });

  it("gives the lines back once control is back, unless another scene has taken them since, so the cut line plays after the handback", async () => {
    const cleanup = section(await compiled(), "TriggerSceneLandingCleanup");
    const giveBack = cleanup.indexOf(GIVE_BACK(1));
    expect(giveBack).toBeGreaterThan(cleanup.lastIndexOf("CinematicFade(true"));
    expect(giveBack).toBeGreaterThan(cleanup.lastIndexOf("libNtve_gf_CinematicMode(false"));
    expect(cleanup.slice(giveBack)).toMatch(/^ {4}if \(\(gv_script_trigger_scene == 1\)\) \{\r\n {8}gv_script_trigger_scene = 0;\r\n {4}\}\r\n\r\n {4}return true;/);
  });

  it("holds the lines through its lines after the handback, which no in-play line cuts into, and gives them back after the last", async () => {
    const script = await compiled((_blueprint, scene) => {
      scene.handback = { linesFrom: "radio_field-2-2" };
    });
    expect(section(script, "TriggerSceneLandingCleanup")).not.toContain(GIVE_BACK(1));
    const after = section(script, "TriggerSceneLandingLines");
    // Each plays while the scene holds the lines: after another trigger scene has cut it off, once
    // that one has given them back, taking them again and cutting off an in-play line that started since.
    const turn = lines(
      "    while ((gv_script_trigger_scene != 0) && (gv_script_trigger_scene != 1)) {",
      "        Wait(0.25, c_timeGame);",
      "    }",
      "    gv_script_trigger_scene = 1;",
      "    if ((TransmissionIsComplete(gv_script_line) == false)) {",
      "        TransmissionClear(gv_script_line);",
      "        gv_script_line_cut = true;",
      "    }",
      "",
      "    gv_script_trigger_scene_line_cut = false;",
    );
    expect(after.split(turn)).toHaveLength(3);
    expect(after).toContain(lines("    gv_script_trigger_scene_line_cut = false;"));
    expect(after).toContain(lines("    gv_script_trigger_scene_line = TransmissionLastSent();", "    TransmissionWait(gv_script_trigger_scene_line, 0.0);", "    gv_trigger_scene_landing_line_sent = (gv_script_trigger_scene_line_cut == false);"));
    expect(after.search(sendOf("radio_field-2-3"))).toBeGreaterThan(after.search(sendOf("radio_field-2-2")));
    expect(after.indexOf(GIVE_BACK(1))).toBeGreaterThan(after.search(sendOf("radio_field-2-3")));
  });

  it("played again while its lines after the handback still play, stops them, to play them afresh", async () => {
    const script = await compiled((blueprint, scene) => {
      scene.handback = { linesFrom: "radio_field-2-2" };
      blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "anchorEntersZone", anchorId: "zeratul", zoneId: "field" } });
    });
    const setup = section(script, "TriggerSceneLandingSetup");
    // Its own line playing is cut off as the take cuts any scene's, so nothing of the earlier run plays on.
    expect(setup.indexOf("TriggerStop(gt_TriggerSceneLandingLines);")).toBeGreaterThan(setup.indexOf("TransmissionClear(gv_script_trigger_scene_line);"));
    expect(setup.indexOf("TriggerStop(gt_TriggerSceneLandingLines);")).toBeLessThan(setup.indexOf("CinematicFade(false"));
    expect(section(await compiled(), "TriggerSceneLandingSetup")).not.toContain("TriggerStop(");
  });

  it("holds the lines across a chain: each scene takes them from the one before, which gives them back with no wait between", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" } });
      blueprint.screenplay.script.triggerScenes.push({ id: "ridge", scene: 3 });
    });
    const cleanup = section(script, "TriggerSceneLandingCleanup");
    // Handing on, landing gives the lines back, and ridge takes them, on one thread with no wait between.
    const handOn = cleanup.indexOf("gv_trigger_scene_landing_hand_on = false;");
    expect(cleanup.indexOf(GIVE_BACK(1))).toBeGreaterThan(handOn);
    expect(section(script, "TriggerSceneRidgeSetup")).toContain(lines("gv_script_trigger_scene = 2;"));
    expect(section(script, "TriggerSceneRidgeCleanup")).toContain(GIVE_BACK(2));
  });

  it("never gives the lines back after a victory outro, whose game is over", async () => {
    const script = await compiled((blueprint, scene) => {
      blueprint.outcomes = { victory: [{ type: "anchorEntersZone", anchorId: "nova", zoneId: "field" }], defeat: [] };
      scene.outro = "victory";
    });
    const cleanup = section(script, "TriggerSceneLandingCleanup");
    expect(cleanup).toContain("TransmissionClear(gv_script_trigger_scene_line);");
    expect(cleanup).not.toContain("gv_script_trigger_scene = ");
    expect(script).not.toContain("TransmissionClearAll(");
  });

  it("leaves the in-play lines of a Mission with no trigger scene as they were", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.triggerScenes = [];
    });
    expect(script).not.toContain("gv_script_trigger_scene");
    expect(script).not.toContain("gv_script_line");
    // Each line waited, one after another, as before.
    const cue = section(script, "zeratulReachesField");
    expect(cue).toMatch(sendOf("radio_field-3-1"));
    expect(cue.match(/c_transmissionDurationAdd, true, c_maxPlayers, false\);/g)).toHaveLength(2);
  });
});
