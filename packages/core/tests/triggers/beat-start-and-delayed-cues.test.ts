// Cues on a Beat's start and cues with a delay: the `cinematic` fixture Workspace's Radio Field with
// a Beat that either of two units starts, which cues scene 2 at once and scene 3 90 s later. The
// compiled map's MapScript.galaxy is read back.
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENES = [
  "",
  "## Scene 2: THE FIELD",
  "",
  "**NOVA** `D-01-01-02-001-NOVA`: Move out.",
  "**NOVA** `D-01-01-02-002-NOVA`: Now.",
  "",
  "## Scene 3: LATER",
  "",
  "**NOVA** `D-01-01-03-001-NOVA`: Still here.",
  "",
  "## Scene 4: AGAIN",
  "",
  "**NOVA** `D-01-01-04-001-NOVA`: Still moving.",
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
  blueprint.anchors = [unit("nova", 10), unit("raynor", 14)];
  blueprint.beats.push({
    id: "harried",
    title: "Harried",
    summary: "Either of them reaches the far side.",
    startsWhen: [
      { type: "anchorEntersZone", anchorId: "nova", zoneId: "far" },
      { type: "anchorEntersZone", anchorId: "raynor", zoneId: "far" },
    ],
  });
  blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "beatStarts", beatId: "harried" } }, { scene: 3, cue: { type: "beatStarts", beatId: "harried" }, afterSeconds: 90 });
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
const init = (script: string, name: string): string => script.slice(script.indexOf(`void gt_${name}_Init`), script.indexOf("}", script.indexOf(`void gt_${name}_Init`)));
const sound = (scene: number, line: number): string => `SoundLink("radio_field-${scene}-${line}", -1)`;
const QUEUE = "gv_script_transmissions_playing = true;";
const LINES = "TriggerExecute(gt_BeatHarriedLines, true, false);";
const CINEMATIC = "TriggerExecute(gt_CinematicRadio, true, true);";
const reveal = (blueprint: any) => {
  blueprint.beats.find((beat: { id: string }) => beat.id === "harried").reveals = [{ zoneId: "far", region: true }];
};

describe("a cue on a Beat's start", () => {
  it("plays its Transmissions from a lines trigger of its own, run without waiting once the Beat has turned itself off", async () => {
    const script = await compiled();
    const beat = section(script, "BeatHarried");
    expect(script.match(/TriggerAddEventUnitRegion\(gt_BeatHarried, /g)).toHaveLength(2);
    expect(beat).toContain("TriggerEnable(gt_BeatHarried, false);");
    // Run after the Beat has turned itself off, so its lines play once; nothing in the Beat's trigger waits on them.
    expect(beat.indexOf(LINES)).toBeGreaterThan(beat.indexOf("TriggerEnable(gt_BeatHarried, false);"));
    expect(beat).not.toContain(sound(2, 1));
    expect(beat).not.toContain("TransmissionWait(");
    const lines = section(script, "BeatHarriedLines");
    expect(lines.indexOf(QUEUE)).toBeLessThan(lines.indexOf(sound(2, 1)));
    // Run only by its Beat's trigger, from no event.
    expect(script.split(LINES)).toHaveLength(2);
    expect(init(script, "BeatHarriedLines")).not.toContain("TriggerAdd");
  });

  it("explores and pings the Beat's Zones before its lines, so a later Beat starting during them doesn't drop the pings", async () => {
    const beat = section(
      await compiled((blueprint) => {
        reveal(blueprint);
        blueprint.beats.push({ id: "pinned", title: "Pinned", summary: "Nova is back.", startsWhen: [{ type: "anchorEntersZone", anchorId: "nova", zoneId: "near" }] });
      }),
      "BeatHarried",
    );
    expect(beat.indexOf("VisExploreArea(")).toBeLessThan(beat.indexOf("MinimapPing("));
    expect(beat.indexOf("MinimapPing(")).toBeLessThan(beat.indexOf(LINES));
    expect(beat).not.toContain("TriggerIsEnabled(");
  });

  it("plays several Transmission entries on its cue from the one lines trigger, in their cue order, each behind the lock", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "beatStarts", beatId: "harried" } }, { scene: 2, line: "radio_field-2-2", cue: { type: "beatStarts", beatId: "harried" } });
    });
    const lines = section(script, "BeatHarriedLines");
    const scene2 = lines.indexOf(sound(2, 1));
    const scene4 = lines.indexOf(sound(4, 1));
    const line = lines.lastIndexOf(sound(2, 2));
    expect(scene2).toBeGreaterThanOrEqual(0);
    expect(scene4).toBeGreaterThan(scene2);
    expect(line).toBeGreaterThan(scene4);
    // Each takes the lock in turn, so another cue's lines don't cut in between them.
    expect(lines.split(QUEUE)).toHaveLength(4);
    expect(lines.indexOf(QUEUE, scene2)).toBeLessThan(scene4);
    expect(lines.indexOf(QUEUE, scene4)).toBeLessThan(line);
  });

  it("keeps a Cinematic on its cue in its place, the pings after its handback, and its lines after the pings", async () => {
    const script = await compiled((blueprint) => {
      reveal(blueprint);
      blueprint.beats.push({ id: "pinned", title: "Pinned", summary: "Nova is back.", startsWhen: [{ type: "anchorEntersZone", anchorId: "nova", zoneId: "near" }] });
      // Scene 1's Cinematic, then scene 2's lines, then scene 4's.
      blueprint.screenplay.script.cues.splice(1, 0, { scene: 1, cue: { type: "beatStarts", beatId: "harried" } });
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "beatStarts", beatId: "harried" } });
    });
    const beat = section(script, "BeatHarried");
    const cinematic = beat.indexOf(CINEMATIC);
    expect(cinematic).toBeGreaterThan(beat.indexOf("VisExploreArea("));
    // The Cinematic waited on, a later Beat may start meanwhile: the pings are guarded, as before.
    expect(beat.indexOf("TriggerIsEnabled(gt_BeatPinned)")).toBeGreaterThan(cinematic);
    expect(beat.indexOf("MinimapPing(")).toBeGreaterThan(cinematic);
    expect(beat.indexOf(LINES)).toBeGreaterThan(beat.indexOf("MinimapPing("));
    expect(beat).not.toContain(sound(2, 1));
    const lines = section(script, "BeatHarriedLines");
    expect(lines.indexOf(sound(4, 1))).toBeGreaterThan(lines.indexOf(sound(2, 1)));
  });

  it("keeps lines cued before a Cinematic on its cue in their place, before it", async () => {
    const script = await compiled((blueprint) => {
      // Scene 2's lines, then scene 1's Cinematic, then scene 4's lines.
      blueprint.screenplay.script.cues.push({ scene: 1, cue: { type: "beatStarts", beatId: "harried" } }, { scene: 4, cue: { type: "beatStarts", beatId: "harried" } });
    });
    const beat = section(script, "BeatHarried");
    expect(beat.indexOf(sound(2, 1))).toBeLessThan(beat.indexOf(CINEMATIC));
    expect(beat.indexOf(LINES)).toBeGreaterThan(beat.indexOf(CINEMATIC));
    expect(beat).not.toContain(sound(4, 1));
    const lines = section(script, "BeatHarriedLines");
    expect(lines).toContain(sound(4, 1));
    expect(lines).not.toContain(sound(2, 1));
  });

  it("has no lines trigger when its cue plays no Transmissions at once", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues = blueprint.screenplay.script.cues.filter((entry: { scene: number }) => entry.scene !== 2);
    });
    expect(script).not.toContain("gt_BeatHarriedLines");
  });

  it("doesn't guard the pings when nothing before them waits, such as a scene cued after a delay", async () => {
    const beat = section(
      await compiled((blueprint) => {
        blueprint.beats.find((candidate: { id: string }) => candidate.id === "harried").reveals = [{ zoneId: "far", region: true }];
        blueprint.beats.push({ id: "pinned", title: "Pinned", summary: "Nova is back.", startsWhen: [{ type: "anchorEntersZone", anchorId: "nova", zoneId: "near" }] });
        // Only scene 3, 90 s on, from a trigger of its own run without waiting.
        blueprint.screenplay.script.cues = blueprint.screenplay.script.cues.filter((entry: { scene: number }) => entry.scene !== 2);
      }),
      "BeatHarried",
    );
    expect(beat).toContain("MinimapPing(");
    expect(beat).not.toContain("TriggerIsEnabled(");
  });

  it("is refused for a Beat nothing starts", async () => {
    const { root } = await workspace((blueprint) => {
      blueprint.beats.push({ id: "lull", title: "Lull", summary: "Nothing starts it." });
      blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "beatStarts", beatId: "lull" } });
    });
    const { problems } = await checkWorkspace(root);
    expect(problems.map((problem) => problem.message).join("\n")).toContain("Beat lull has no startsWhen, so nothing starts it and the cue would never fire");
  });
});

describe("a cue with a delay", () => {
  it("plays its scene from a trigger of its own, once, after a wait in AI time, without holding up the cue", async () => {
    const script = await compiled();
    const beat = section(script, "BeatHarried");
    // Run without waiting, so scene 2 still plays straight away.
    expect(beat).toContain("TriggerExecute(gt_ScriptScene3AfterBeatHarried90s, true, false);");
    expect(beat).not.toContain('SoundLink("radio_field-3-1", -1)');
    const delayed = section(script, "ScriptScene3AfterBeatHarried90s");
    // Its condition lets it play once, however often the cue fires.
    expect(delayed).toContain("if (!((gv_script_scenes_3_delayed_beat_harried_90_played == false))) {");
    expect(delayed).toContain("gv_script_scenes_3_delayed_beat_harried_90_played = true;");
    expect(delayed.indexOf("Wait(90.0, c_timeAI);")).toBeGreaterThan(delayed.indexOf("_played = true;"));
    expect(delayed.indexOf('SoundLink("radio_field-3-1", -1)')).toBeGreaterThan(delayed.indexOf("Wait(90.0, c_timeAI);"));
  });

  it("isn't a scene at mission start for the goal timers when it waits", async () => {
    const script = await compiled((blueprint) => {
      // The Cinematic's scene 1 plays a minute in, so the goal timer starts with the map.
      blueprint.screenplay.script.cues[0].afterSeconds = 60;
      blueprint.outcomes = { victory: [{ type: "timer", seconds: 300 }], defeat: [] };
    });
    const start = section(script, "MissionStart");
    expect(start.indexOf("TimerStart(gv_goal_timer_300, 300.0")).toBeLessThan(start.indexOf("TriggerExecute(gt_ScriptScene1AfterMissionStart60s, true, false);"));
  });
});

describe("a cue on the first Beat's start", () => {
  it("is refused for missionStart", async () => {
    const { root } = await workspace((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "beatStarts", beatId: "radio" } });
    });
    const { problems } = await checkWorkspace(root);
    expect(problems.map((problem) => problem.message).join("\n")).toContain("Beat radio is the first, which starts with the mission; cue missionStart instead");
  });
});
