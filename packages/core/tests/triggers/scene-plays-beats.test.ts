// Beats that start on a script scene playing (`scenePlays`): the `cinematic` fixture Workspace's
// Radio Field with a Beat "Harried" started by a unit entering a Zone, a scene 3 cued 10 s after it,
// and a Beat "Calling" that starts as scene 3 plays. The compiled map's MapScript.galaxy is read back.
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
    { id: "calling", title: "Calling", summary: "Zeratul calls.", startsWhen: [{ type: "scenePlays", scene: 3 }] },
  );
  blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "beatStarts", beatId: "harried" }, afterSeconds: 10 });
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
const init = (script: string, name: string): string => script.slice(script.indexOf(`void gt_${name}_Init`), script.indexOf("}", script.indexOf(`void gt_${name}_Init`)));
const sound = (scene: number, line: number): string => `SoundLink("radio_field-${scene}-${line}", -1)`;
const QUEUE = "gv_script_transmissions_playing = true;";
const START = "TriggerExecute(gt_BeatCalling, true, false);";
const DELAYED = "ScriptScene3AfterBeatHarried10s";

describe("a Beat that starts on a scene playing", () => {
  it("starts after its cue's delay, as the scene starts to play", async () => {
    const script = await compiled();
    const delayed = section(script, DELAYED);
    expect(delayed).toContain(START);
    expect(delayed.indexOf(START)).toBeGreaterThan(delayed.indexOf("Wait(10.0, c_timeAI);"));
    // Once its Transmissions have their turn, and before the first of them.
    expect(delayed.indexOf(START)).toBeGreaterThan(delayed.indexOf(QUEUE));
    expect(delayed.indexOf(START)).toBeLessThan(delayed.indexOf(sound(3, 1)));
    // Only while its trigger is on, as Beats only move forward, and from nothing else.
    expect(delayed).toContain("if ((TriggerIsEnabled(gt_BeatCalling) == true))");
    expect(script.split(START)).toHaveLength(2);
    expect(init(script, "BeatCalling")).not.toContain("TriggerAdd");
  });

  it("runs what the Beat carries: its Beat actions, and the scenes cued on its start", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "beatStarts", beatId: "calling" } });
    });
    const beat = section(script, "BeatCalling");
    expect(beat).toContain("TriggerEnable(gt_BeatCalling, false);");
    // Its lines, from its lines trigger.
    expect(beat).toContain("TriggerExecute(gt_BeatCallingLines, true, false);");
    expect(section(script, "BeatCallingLines")).toContain(sound(4, 1));
  });

  it("starts from the trigger that plays an undelayed scene", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues[1] = { scene: 3, cue: { type: "beatStarts", beatId: "harried" } };
    });
    const harried = section(script, "BeatHarriedLines");
    expect(harried.indexOf(START)).toBeGreaterThan(harried.indexOf(QUEUE));
    expect(harried.indexOf(START)).toBeLessThan(harried.indexOf(sound(3, 1)));
  });

  it("starts on the part or line it names, as a cue entry names it", async () => {
    const script = await compiled((blueprint) => {
      blueprint.beats[2].startsWhen = [{ type: "scenePlays", scene: 2, from: "S02>2" }];
      blueprint.screenplay.script.cues.push(
        { scene: 2, from: "S02>1", cue: { type: "beatStarts", beatId: "harried" } },
        { scene: 2, from: "S02>2", cue: { type: "beatStarts", beatId: "harried" } },
      );
    });
    const harried = section(script, "BeatHarriedLines");
    expect(harried.indexOf(START)).toBeGreaterThan(harried.indexOf(sound(2, 1)));
    expect(harried.indexOf(START)).toBeLessThan(harried.indexOf(sound(2, 2)));
  });

  it("starts as a Cinematic starts, before it plays", async () => {
    const start = section(
      await compiled((blueprint) => {
        blueprint.beats[2].startsWhen = [{ type: "scenePlays", scene: 1 }];
      }),
      "MissionStart",
    );
    expect(start).toContain(START);
    expect(start.indexOf(START)).toBeLessThan(start.indexOf("TriggerExecute(gt_CinematicRadio, true, true);"));
  });

  it("starts on the first of a scene's cue entries to play it", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "near" } });
    });
    expect(script.split(START)).toHaveLength(3);
    expect(section(script, DELAYED)).toContain("if ((TriggerIsEnabled(gt_BeatCalling) == true))");
  });
});

describe("what a Beat that starts on a Cinematic or trigger scene starts", () => {
  const STAGED = "gv_script_staged_playing";
  const WAIT = `while (!((${STAGED} == false))) {`;
  const onCinematic = (blueprint: any) => {
    blueprint.beats[2].startsWhen = [{ type: "scenePlays", scene: 1 }];
    blueprint.beats[2].reveals = ["far"];
    blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "beatStarts", beatId: "calling" } });
  };

  it("waits for the scene to hand back: the scenes cued on its start, and its reveals", async () => {
    const script = await compiled(onCinematic);
    const start = section(script, "MissionStart");
    const cinematic = start.indexOf("TriggerExecute(gt_CinematicRadio, true, true);");
    expect(start.indexOf(`${STAGED} = true;`)).toBeLessThan(start.indexOf(START));
    expect(start.indexOf(`${STAGED} = false;`)).toBeGreaterThan(cinematic);
    const beat = section(script, "BeatCalling");
    // It starts at once (it turns its trigger off), then waits.
    expect(beat.indexOf("TriggerEnable(gt_BeatCalling, false);")).toBeLessThan(beat.indexOf(WAIT));
    expect(beat.indexOf(WAIT)).toBeGreaterThanOrEqual(0);
    expect(beat.indexOf("VisExploreArea")).toBeGreaterThan(beat.indexOf(WAIT));
    expect(beat.indexOf("MinimapPing")).toBeGreaterThan(beat.indexOf(WAIT));
    // Its lines trigger, run once it has pinged.
    expect(beat.indexOf("TriggerExecute(gt_BeatCallingLines, true, false);")).toBeGreaterThan(beat.indexOf("MinimapPing"));
    expect(section(script, "BeatCallingLines")).toContain(sound(4, 1));
  });

  it("leaves a Beat that starts on Transmissions as it was", async () => {
    const script = await compiled();
    expect(script).not.toContain(STAGED);
  });
});

describe("a Beat whose own scene starts another", () => {
  it("pings its reveals before the lines that start it, unguarded", async () => {
    const script = await compiled((blueprint) => {
      blueprint.beats[1].reveals = ["far"];
      blueprint.screenplay.script.cues[1] = { scene: 3, cue: { type: "beatStarts", beatId: "harried" } };
    });
    const harried = section(script, "BeatHarried");
    expect(harried.indexOf("MinimapPing")).toBeLessThan(harried.indexOf("TriggerExecute(gt_BeatHarriedLines, true, false);"));
    expect(harried).not.toContain("TriggerIsEnabled(");
    expect(section(script, "BeatHarriedLines")).toContain(START);
  });

  it("still pings its reveals once a Cinematic that starts it has handed back", async () => {
    const script = await compiled((blueprint) => {
      blueprint.beats[1].reveals = ["far"];
      blueprint.beats[2].startsWhen = [{ type: "scenePlays", scene: 1 }];
      blueprint.screenplay.script.cues[1] = { scene: 1, cue: { type: "beatStarts", beatId: "harried" } };
    });
    const harried = section(script, "BeatHarried");
    expect(harried.indexOf("MinimapPing")).toBeGreaterThan(harried.indexOf("TriggerExecute(gt_CinematicRadio, true, true);"));
    // The only test of Calling's trigger is the one that starts it: Calling, started by Harried's own scene, doesn't drop Harried's pings.
    expect(harried.split("TriggerIsEnabled(gt_BeatCalling)")).toHaveLength(2);
  });
});

describe("check", () => {
  it("refuses a Beat on a scene with no cue", async () => {
    const found = await problems((blueprint) => {
      blueprint.beats[2].startsWhen = [{ type: "scenePlays", scene: 4 }];
    });
    expect(found).toContain("Scene 4 has no cue of its own, so it never plays and Beat calling would never start on it; cue it in screenplay.script.cues");
  });

  it("refuses a whole scene that only its parts' cues play", async () => {
    const found = await problems((blueprint) => {
      blueprint.beats[2].startsWhen = [{ type: "scenePlays", scene: 2 }];
      blueprint.screenplay.script.cues.push({ scene: 2, from: "S02>1", cue: { type: "beatStarts", beatId: "harried" } });
    });
    expect(found).toContain("Scene 2 has no cue of its own, so it never plays and Beat calling would never start on it");
  });

  it("refuses a part named on another scene, and a part and a line both", async () => {
    const found = await problems((blueprint) => {
      blueprint.beats[2].startsWhen = [
        { type: "scenePlays", scene: 3, from: "S02>1" },
        { type: "scenePlays", scene: 2, from: "S02>1", line: "D-01-01-02-001-NOVA" },
      ];
    });
    expect(found).toContain("S02>1 is a stage direction of scene 2, not of scene 3");
    expect(found).toContain("A scenePlays start names a part (from) or a line, not both");
  });

  it("refuses a Beat that starts on a scene cued on its own start", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues[1] = { scene: 3, cue: { type: "beatStarts", beatId: "calling" } };
    });
    expect(found).toContain("Scene 3 waits on Beat calling starting, which starts as scene 3 plays: a cycle, so none of them plays");
  });

  it("follows a cycle through scenePlayed cues too", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues[1] = { scene: 3, cue: { type: "scenePlayed", scene: 4 } };
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "beatStarts", beatId: "calling" } });
    });
    expect(found).toContain("Scene 3 waits on scene 4 having played, which waits on Beat calling starting, which starts as scene 3 plays: a cycle, so none of them plays");
  });

  it("takes a loop as no cycle when the Beat has another start too", async () => {
    const found = await problems((blueprint) => {
      blueprint.beats[2].startsWhen.push({ type: "anchorDies", anchorId: "nova" });
      blueprint.screenplay.script.cues[1] = { scene: 3, cue: { type: "beatStarts", beatId: "calling" } };
    });
    expect(found).not.toContain("a cycle");
  });

  it("passes the fixture as it stands", async () => {
    const found = await problems(() => {});
    expect(found).not.toMatch(/scene \d|Scene \d|Beat calling/);
  });
});
