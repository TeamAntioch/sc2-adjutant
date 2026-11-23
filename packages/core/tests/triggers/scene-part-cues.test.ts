// Cues on part of a scene, and Transmissions queued behind one already playing: the `cinematic`
// fixture Workspace's Radio Field with a scene of two messages, each introduced by a stage
// direction and played on its own cue. The compiled map's MapScript.galaxy is read back.
import { appendFile, readFile, writeFile } from "node:fs/promises";
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
  "**NOVA** `D-01-01-02-001-NOVA`: Before the first message.",
  "",
  "> Message 1",
  "",
  "**NOVA** `D-01-01-02-002-NOVA`: First, one.",
  "**ZERATUL** `D-01-01-02-003-ZERATUL`: First, two.",
  "",
  "> Message 2",
  "",
  "**NOVA** `D-01-01-02-004-NOVA`: Second.",
  "",
].join("\n");

const unit = (id: string, x: number) => ({ id, name: id, zoneId: "near", kind: "unit", unitType: "Marine", player: 1, position: { x, y: 10, z: 0 }, rotation: 0 });
const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

async function workspace(edit: (blueprint: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENES);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.zones = [
    { id: "near", name: "Near", elevation: 1, landform: "flat", role: "base", polygon: square(0, 0, 32) },
    { id: "far", name: "Far", elevation: 1, landform: "flat", role: "path", polygon: square(32, 0, 32) },
  ];
  blueprint.anchors = [unit("nova", 10)];
  blueprint.beats.push(
    { id: "harried", title: "Harried", summary: "Nova reaches the far side.", startsWhen: [{ type: "anchorEntersZone", anchorId: "nova", zoneId: "far" }] },
    { id: "home", title: "Home", summary: "Nova comes back.", startsWhen: [{ type: "anchorEntersZone", anchorId: "nova", zoneId: "near" }] },
  );
  blueprint.screenplay.script.cues.push(
    { scene: 2, from: "S02>1", cue: { type: "beatStarts", beatId: "harried" } },
    { scene: 2, from: "S02>2", cue: { type: "beatStarts", beatId: "home" } },
    { scene: 2, from: "S02>2", cue: { type: "beatStarts", beatId: "harried" }, afterSeconds: 90 },
  );
  edit(blueprint);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  return { root, blueprintPath };
}

async function compiled(edit?: (blueprint: any) => void): Promise<string> {
  const { root, blueprintPath } = await workspace(edit);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return readFile(path.join(map, "MapScript.galaxy"), "utf8");
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const sound = (line: string): string => `SoundLink("radio_field-2-${line}", -1)`;
const TURN = "while (!((gv_script_transmissions_playing == false))) {";
const TAKE = "gv_script_transmissions_playing = true;";
const QUEUE = "TransmissionWait(TransmissionLastSent(), 0.0);";
const RELEASE = "gv_script_transmissions_playing = false;";

describe("a cue on part of a scene", () => {
  it("plays only the lines from its stage direction to the next one", async () => {
    const script = await compiled();
    // Each Beat's lines trigger plays the Transmissions cued on its start.
    const first = section(script, "BeatHarriedLines");
    expect(first).toContain(sound("2"));
    expect(first).toContain(sound("3"));
    expect(first).not.toContain(sound("1"));
    expect(first).not.toContain(sound("4"));
    const second = section(script, "BeatHomeLines");
    expect(second).toContain(sound("4"));
    expect(second).not.toContain(sound("2"));
  });

  it("plays a delayed part from a trigger named by its stage direction", async () => {
    const script = await compiled();
    expect(section(script, "BeatHarried")).toContain("TriggerExecute(gt_ScriptScene2S022AfterBeatHarried90s, true, false);");
    const delayed = section(script, "ScriptScene2S022AfterBeatHarried90s");
    expect(delayed).toContain(sound("4"));
    expect(delayed).not.toContain(sound("2"));
    expect(delayed).toContain("gv_script_scenes_2_S02_2_delayed_beat_harried_90_played = true;");
  });

  it("is refused when it names no stage direction of the scene", async () => {
    const { root } = await workspace((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, from: "S02>3", cue: { type: "beatStarts", beatId: "home" } });
    });
    const { problems } = await checkWorkspace(root);
    expect(problems.map((problem) => problem.message).join("\n")).toContain("S02>3 names no stage direction of scene 2, which has 2");
  });

  it("is refused when its stage direction has no lines before the next", async () => {
    const { root } = await workspace();
    await appendFile(path.join(root, "missions/radio-field/radio-field.md"), ["", "## Scene 3: QUIET", "", "> Nothing yet.", "", "> Then a line.", "", "**NOVA** `D-01-01-03-001-NOVA`: Here.", ""].join("\n"));
    const blueprintPath = path.join(root, "missions/radio-field/blueprint.json");
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    blueprint.screenplay.script.cues.push({ scene: 3, from: "S03>1", cue: { type: "beatStarts", beatId: "home" } });
    await writeFile(blueprintPath, JSON.stringify(blueprint));
    const { problems } = await checkWorkspace(root);
    expect(problems.map((problem) => problem.message).join("\n")).toContain("S03>1 has no lines before the next stage direction, so its cue would play nothing");
  });

  it("is refused when it names another scene's stage direction", async () => {
    const { root } = await workspace((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, from: "S01>1", cue: { type: "beatStarts", beatId: "home" } });
    });
    const { problems } = await checkWorkspace(root);
    expect(problems.map((problem) => problem.message).join("\n")).toContain("S01>1 is a stage direction of scene 1, not of scene 2");
  });

  it("is refused for a scene that plays as a Cinematic", async () => {
    const { root } = await workspace((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 1, from: "S01>1", cue: { type: "beatStarts", beatId: "home" } });
    });
    const { problems } = await checkWorkspace(root);
    expect(problems.map((problem) => problem.message).join("\n")).toContain("Scene 1 plays as a Cinematic, so its cues play it whole; remove from");
  });
});

describe("a scene's Transmissions", () => {
  it("wait for another cue's scene to finish, then for a transmission already playing, before the first line", async () => {
    const script = await compiled();
    const first = section(script, "BeatHarriedLines");
    const order = [TURN, "    Wait(0.25, c_timeGame);", TAKE, QUEUE, sound("2"), sound("3"), RELEASE].map((part) => first.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Once per part, around all its lines: the lines after the first wait on their own.
    expect(first.split(QUEUE)).toHaveLength(2);
    expect(first.split(RELEASE)).toHaveLength(2);
    const delayed = section(script, "ScriptScene2S022AfterBeatHarried90s");
    expect(delayed.indexOf(QUEUE)).toBeGreaterThan(delayed.indexOf("Wait(90.0, c_timeAI);"));
    expect(delayed.indexOf(QUEUE)).toBeLessThan(delayed.indexOf(sound("4")));
    expect(delayed.indexOf(RELEASE)).toBeGreaterThan(delayed.indexOf(sound("4")));
  });

  it("wait for one already playing when the scene is cued whole", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues = [blueprint.screenplay.script.cues[0], { scene: 2, cue: { type: "beatStarts", beatId: "harried" } }];
    });
    const whole = section(script, "BeatHarriedLines");
    expect(whole.indexOf(TAKE)).toBeLessThan(whole.indexOf(sound("1")));
    expect(whole.indexOf(RELEASE)).toBeGreaterThan(whole.indexOf(sound("4")));
  });
});
