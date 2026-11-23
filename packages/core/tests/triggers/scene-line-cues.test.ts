// Cues on one line of a scene (a cue entry's `line`): the `cinematic` fixture Workspace's Radio
// Field with a scene of two lines and no stage directions, each line on its own cue (one on a first
// loss, one on a second, say). The compiled map's MapScript.galaxy is read back.
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENES = [
  "",
  "## Scene 2: THE LOSSES",
  "",
  "**NOVA** `D-01-01-02-001-NOVA`: One down.",
  "",
  "**ZERATUL** `D-01-01-02-002-ZERATUL`: Two down.",
  "",
  "## Scene 3: AFTER",
  "",
  "**NOVA** `D-01-01-03-001-NOVA`: That's both.",
  "",
].join("\n");

// The default naming's sound IDs: <mission>-<scene>-<line>.
const FIRST = "radio_field-2-1";
const SECOND = "radio_field-2-2";

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
  blueprint.screenplay.script.cues.push({ scene: 2, line: FIRST, cue: { type: "beatStarts", beatId: "harried" } }, { scene: 2, line: SECOND, cue: { type: "beatStarts", beatId: "home" } });
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

async function problems(edit: (blueprint: any) => void): Promise<string> {
  const { root } = await workspace(edit);
  return (await checkWorkspace(root)).problems.map((problem) => problem.message).join("\n");
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const sound = (id: string): string => `SoundLink("${id}", -1)`;
const TURN = "while (!((gv_script_transmissions_playing == false))) {";
const TAKE = "gv_script_transmissions_playing = true;";
const QUEUE = "TransmissionWait(TransmissionLastSent(), 0.0);";
const RELEASE = "gv_script_transmissions_playing = false;";

describe("a cue on one line of a scene", () => {
  it("plays only that line", async () => {
    const script = await compiled();
    // Each Beat's lines trigger plays the Transmissions cued on its start.
    const first = section(script, "BeatHarriedLines");
    expect(first).toContain(sound(FIRST));
    expect(first).not.toContain(sound(SECOND));
    const second = section(script, "BeatHomeLines");
    expect(second).toContain(sound(SECOND));
    expect(second).not.toContain(sound(FIRST));
  });

  it("queues its line behind another cue's scene, as a part does", async () => {
    const first = section(await compiled(), "BeatHarriedLines");
    const order = [TURN, TAKE, QUEUE, sound(FIRST), RELEASE].map((part) => first.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("compiles beside other cues of the same scene and line: on the same cue, and the whole scene", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push(
        { scene: 2, line: SECOND, cue: { type: "beatStarts", beatId: "harried" } },
        { scene: 2, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "far" } },
      );
    });
    const harried = section(script, "BeatHarriedLines");
    expect(harried.indexOf(sound(FIRST))).toBeLessThan(harried.indexOf(sound(SECOND)));
    // Each line, on its own turn.
    expect(harried.split(RELEASE)).toHaveLength(3);
  });

  it("plays a delayed line from a trigger named by its line", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, line: SECOND, cue: { type: "beatStarts", beatId: "harried" }, afterSeconds: 90 });
    });
    const name = "ScriptScene2radio_field22AfterBeatHarried90s";
    expect(section(script, "BeatHarried")).toContain(`TriggerExecute(gt_${name}, true, false);`);
    const delayed = section(script, name);
    expect(delayed).toContain(sound(SECOND));
    expect(delayed).not.toContain(sound(FIRST));
  });
});

describe("a cue on a line having played", () => {
  it("fires once that line's entry has played", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "scenePlayed", scene: 2, line: SECOND } });
    });
    const home = section(script, "BeatHomeLines");
    const fire = "TriggerExecute(gt_ScriptScene2radio_field22Played, true, false);";
    expect(home.indexOf(fire)).toBeGreaterThan(home.indexOf(sound(SECOND)));
    expect(section(script, "BeatHarriedLines")).not.toContain(fire);
    expect(section(script, "ScriptScene2radio_field22Played")).toContain(sound("radio_field-3-1"));
  });

  it("is refused when no entry plays that line", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.pop();
      blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "scenePlayed", scene: 2, line: SECOND } });
    });
    expect(found).toContain("Scene 2 radio_field-2-2 has no cue of its own, so it never plays and this cue would never fire; cue it in screenplay.script.cues");
  });

  it("is refused for the whole scene when only its lines' cues play it", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "scenePlayed", scene: 2 } });
    });
    expect(found).toContain("Scene 2 has no cue of its own, so it never plays and this cue would never fire; cue it in screenplay.script.cues");
  });

  it("is refused naming a line and a part both", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "scenePlayed", scene: 2, from: "S02>1", line: FIRST } });
    });
    expect(found).toContain("A scenePlayed cue names a part (from) or a line, not both");
  });
});

describe("check", () => {
  it("refuses a line not in the scene", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, line: "radio_field-2-9", cue: { type: "missionStart" } });
    });
    expect(found).toContain("radio_field-2-9 is no line of scene 2, whose lines are radio_field-2-1, radio_field-2-2");
  });

  it("refuses another scene's line", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, line: "radio_field-3-1", cue: { type: "missionStart" } });
    });
    expect(found).toContain("radio_field-3-1 is a line of scene 3, not of scene 2");
  });

  it("refuses a line that's no sound ID, on a cue entry and a scenePlayed cue", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, line: "radio field/2", cue: { type: "missionStart" } }, { scene: 3, cue: { type: "scenePlayed", scene: 2, line: "a..b" } });
    });
    expect(found.split("a line's sound ID: letters, digits, _, - and ., not ending in . and with no ..")).toHaveLength(3);
  });

  it("refuses a line with from", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, line: FIRST, from: "S02>1", cue: { type: "missionStart" } });
    });
    expect(found).toContain("A cue plays a part (from) or a line, not both: remove one");
  });

  it("refuses a line of a scene that plays as a Cinematic", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 1, line: "radio_field-1-1", cue: { type: "beatStarts", beatId: "home" } });
    });
    expect(found).toContain("Scene 1 plays as a Cinematic, so its cues play it whole; remove line");
  });
});
