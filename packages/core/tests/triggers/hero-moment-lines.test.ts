// A Mission honouring a hero moment (#656, spec #652 decision 6): when its Campaign Mod turns
// ui.heroMoment on, each compiled in-play line holds moments off while it plays, through the
// moment's Hold Hero Moments For Line and Release Hero Moments After Line, so Begin Hero Moment
// waits for it, and a line due during a moment waits for End. The clocks (goal timers, which run on
// game time) are held while a moment plays. Without ui.heroMoment the Mission compiles as before.
// The `cinematic` fixture Workspace's Radio Field, given the bell Workspace's Campaign Mod, plays
// scene 3's lines in play when Zeratul reaches the field; both are synthetic.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const BELL_STORY = fileURLToPath(new URL("../fixtures/workspaces/bell/mods/bell-story/", import.meta.url));

const SCENES = ["", "## Scene 2: THE FIELD", "", "**NOVA** `D-01-01-02-001-NOVA`: Move out.", "**NOVA** `D-01-01-02-002-NOVA`: Watch the ridge.", "", "## Scene 3: THE RIDGE", "", "**NOVA** `D-01-01-03-001-NOVA`: Up there.", "**NOVA** `D-01-01-03-002-NOVA`: Higher.", ""].join("\n");

const unit = (id: string, x: number, y: number) => ({ id, name: id, zoneId: "field", kind: "unit", unitType: "Marine", player: 1, position: { x, y, z: 0 }, rotation: 0 });
const camera = {
  id: "cam-wide",
  name: "cam-wide",
  zoneId: "field",
  kind: "camera",
  position: { x: 20, y: 20 },
  cameraTarget: { x: 20, y: 20 },
  cameraValues: [
    { index: "Distance", value: 30 },
    { index: "Pitch", value: 50 },
    { index: "Yaw", value: 180 },
    { index: "FieldOfView", value: 27.8 },
  ],
};

type Options = {
  /** The Campaign Mod's `ui`; none leaves it out. */
  readonly ui?: Record<string, unknown>;
  /** Scene 2 as a trigger scene, so the in-play lines are held for it (ADR 0013). */
  readonly triggerScene?: boolean;
  /** A defeat timer, a goal timer the Mission's clocks hold. */
  readonly timer?: boolean;
  /** The trigger scene's second line played after its handback, in play. */
  readonly afterHandback?: boolean;
  /** A Screenplay scene of the Blueprint's own, cued in play as Zeratul reaches the field. */
  readonly inline?: boolean;
};

/** Radio Field's MapScript.galaxy, compiled with bell-story, its speakers declared, as its Campaign Mod. */
async function compiled({ ui, triggerScene = false, timer = false, afterHandback = false, inline = false }: Options): Promise<string> {
  const root = await copyOf("cinematic");
  await cp(BELL_STORY, path.join(root, "mods/bell-story"), { recursive: true });
  const configPath = path.join(root, "sc2-adjutant.workspace.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  await writeFile(configPath, JSON.stringify({ ...config, campaignMod: "Bell-Story", mods: ["bell-story"] }));
  const modPath = path.join(root, "mods/bell-story/blueprint.json");
  const characters = [
    { speaker: "NOVA", id: "Nova" },
    { speaker: "ZERATUL", id: "Zeratul" },
  ];
  await writeFile(modPath, JSON.stringify({ ...JSON.parse(await readFile(modPath, "utf8")), characters, ...(ui ? { ui } : {}) }));
  const mission = path.join(root, "missions/radio-field");
  await writeFile(path.join(mission, "radio-field.md"), (await readFile(path.join(mission, "radio-field.md"), "utf8")) + SCENES);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [camera, unit("nova", 10, 10), unit("zeratul", 12, 10)];
  blueprint.screenplay.script.speakerAnchors = { NOVA: "nova" };
  blueprint.screenplay.script.cues.push({ scene: 3, cue: { type: "anchorEntersZone", anchorId: "zeratul", zoneId: "field" } });
  if (triggerScene) {
    blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" } });
    blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 2 }];
    await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
    await writeFile(path.join(mission, "trigger-scenes/landing.json"), JSON.stringify({ shots: [{ camera: "cam-wide", afterMs: 0 }], ...(afterHandback ? { handback: { linesFrom: "radio_field-2-2" } } : {}) }));
  }
  if (inline) {
    blueprint.screenplay.scenes = [
      { id: "hail", beatId: "radio", cue: { type: "anchorEntersZone", anchorId: "zeratul", zoneId: "field" }, lines: [{ id: "hail_1", speaker: "Nova", speakerAnchorId: "nova", text: "Over here." }] },
    ];
  }
  if (timer) blueprint.outcomes = { victory: [], defeat: [{ type: "timer", seconds: 300 }] };
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return (await readFile(path.join(map, "MapScript.galaxy"), "utf8")).replace(/\r\n/g, "\n");
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const golden = (name: string): string => fileURLToPath(new URL(`./golden/${name}`, import.meta.url));
const MOMENT = /HeroMoment|ui_heroMoment/;

describe("a Mission on a Campaign Mod with ui.heroMoment on", () => {
  it("holds hero moments off while each in-play line plays", async () => {
    const script = await compiled({ ui: { heroMoment: {} } });
    expect(script).toContain("include \"LibBel1\"");
    await expect(section(script, "zeratulReachesField")).toMatchFileSnapshot(golden("hero-moment-lines.galaxy"));
  });

  it("holds them off from before an in-play line a trigger scene may cut waits its turn, through its replays, until it has played", async () => {
    const script = await compiled({ ui: { heroMoment: {} }, triggerScene: true });
    await expect(section(script, "zeratulReachesField")).toMatchFileSnapshot(golden("hero-moment-held-lines.galaxy"));
    // A trigger scene's own lines play in cinematic mode, which a moment waits out.
    expect(section(script, "TriggerSceneLandingCinematic")).not.toMatch(MOMENT);
  });

  it("holds them off through a trigger scene's lines after its handback, which play out of cinematic mode, and lets go if its Setup stops them", async () => {
    const script = await compiled({ ui: { heroMoment: {} }, triggerScene: true, afterHandback: true });
    await expect(section(script, "TriggerSceneLandingLines")).toMatchFileSnapshot(golden("hero-moment-after-handback.galaxy"));
    expect(section(script, "TriggerSceneLandingSetup")).toContain(
      [
        "    TriggerStop(gt_TriggerSceneLandingLines);",
        "    if ((gv_trigger_scene_landing_moment_held == true)) {",
        "        gv_trigger_scene_landing_moment_held = false;",
        "        libBel1_gf_ReleaseHeroMomentsAfterLine();",
        "    }",
      ].join("\n"),
    );
  });

  it("holds them off while each line of a Screenplay scene cued in play plays", async () => {
    const script = section(await compiled({ ui: { heroMoment: {} }, inline: true }), "zeratulReachesField");
    // Its one line, unvoiced, shows for its 3 s and is waited for.
    expect(script).toMatch(/ {4}libBel1_gf_HoldHeroMomentsForLine\(\);\n {4}TransmissionSendForPlayerSelect\([^\n]*"Talk", null, [^\n]*, 3\.0, c_transmissionDurationSet, true, [^\n]*\);\n {4}libBel1_gf_ReleaseHeroMomentsAfterLine\(\);/);
  });

  it("holds the clocks while a moment plays, counting holds so a moment and a run of scenes overlapping let them go at the last release", async () => {
    const script = await compiled({ ui: { heroMoment: {} }, timer: true });
    const clocks = ["ClocksHeroMoment", "ClocksHold", "ClocksRelease"].map((name) => section(script, name)).join("");
    await expect(clocks).toMatchFileSnapshot(golden("hero-moment-clocks.galaxy"));
    expect(script).toContain("    gt_ClocksHeroMoment_Init();\n");
  });

  it("holds no clocks when it has none", async () => {
    expect(await compiled({ ui: { heroMoment: {} } })).not.toContain("ClocksHeroMoment");
  });
});

describe("a Mission whose Campaign Mod leaves ui.heroMoment off", () => {
  it("compiles as it does on a mod with no ui, naming no moment", async () => {
    for (const options of [{ triggerScene: true, timer: true, afterHandback: true, inline: true }, {}]) {
      const off = await compiled({ ui: { choicePicker: {} }, ...options });
      expect(off).not.toMatch(MOMENT);
      expect(off).toBe(await compiled(options));
    }
  });
});
