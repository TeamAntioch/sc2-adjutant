// A trigger scene's world changes (L2, L3): a Light switch, a fog change and the black mask with the
// fog of war off, each made under black in Setup and put back in the one Cleanup, under black before
// the handback, so a skip and the natural end land on the same world. The `cinematic` fixture
// Workspace's Radio Field plays a scene 2 of one line as the trigger scene `landing` when Nova
// enters the field (KorhalCityEx2, the default tileset, so its Light and fog are the mission's).
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENE_2 = ["", "## Scene 2: THE FIELD", "", "**NOVA** `D-01-01-02-001-NOVA`: Move out.", ""].join("\n");

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
  ],
});

async function workspace(world: Record<string, unknown>, edit: (blueprint: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.anchors = [
    camera("cam-wide", 20, 20),
    { id: "nova", name: "Nova", zoneId: "field", kind: "unit", unitType: "Marine", player: 1, position: { x: 10, y: 10, z: 0 }, rotation: 0 },
  ];
  blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "anchorEntersZone", anchorId: "nova", zoneId: "field" } });
  blueprint.screenplay.script.triggerScenes = [{ id: "landing", scene: 2 }];
  edit(blueprint);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  await writeFile(path.join(mission, "trigger-scenes/landing.json"), JSON.stringify({ shots: [{ camera: "cam-wide", afterMs: 0 }], ...world }));
  return { root, blueprintPath };
}

async function compiled(world: Record<string, unknown>, edit?: (blueprint: any) => void): Promise<string> {
  const { root, blueprintPath } = await workspace(world, edit);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return readFile(path.join(map, "MapScript.galaxy"), "utf8");
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const lines = (...statements: string[]): string => statements.map((statement) => (statement ? `    ${statement}` : "")).join("\r\n");
const setup = (script: string) => section(script, "TriggerSceneLandingSetup");
const cleanup = (script: string) => section(script, "TriggerSceneLandingCleanup");
/** Where a statement sits in a trigger, failing the test when it isn't there. */
const at = (trigger: string, statement: string): number => {
  const index = trigger.indexOf(statement);
  expect(index, statement).toBeGreaterThanOrEqual(0);
  return index;
};

describe("a trigger scene's Light", () => {
  it("switches to its Light under black, and back to the mission Light in the cleanup before the handback", async () => {
    const script = await compiled({ light: "NightLight" });
    const black = at(setup(script), "CinematicFade(false, 0.0,");
    expect(at(setup(script), 'GameSetLighting("NightLight", 0.0);')).toBeGreaterThan(black);
    expect(at(setup(script), 'GameSetLighting("NightLight", 0.0);')).toBeLessThan(at(setup(script), "TriggerExecute(gt_TriggerSceneLandingCinematic"));
    // The mission Light is the default tileset's; set back with no blend while the screen is black.
    expect(at(cleanup(script), 'GameSetLighting("KorhalCityEx2", 0.0);')).toBeLessThan(at(cleanup(script), "if ((gv_trigger_scene_landing_completed == true))"));
  });

  it("warns of a Light that is neither the Mission's, a Plugin's, stock nor the Campaign Mod's", async () => {
    const { root } = await workspace({ light: "NoSuchLight" });
    const { problems } = await checkWorkspace(root);
    expect(problems).toContainEqual(expect.objectContaining({ path: "light", severity: "warning", message: expect.stringContaining("Light NoSuchLight is neither in the Mission's lights") }));
  });

  it("writes a Light of the Mission's own into the map, and doesn't warn of it", async () => {
    const { root, blueprintPath } = await workspace({ light: "Night" }, (blueprint) => {
      blueprint.lights = [{ id: "Night", from: "KorhalCityEx2" }];
    });
    const { problems } = await checkWorkspace(root);
    expect(problems.filter((problem) => problem.path === "light")).toEqual([]);
    const map = path.join(await tempFolder(), "RadioField.SC2Map");
    await compileMission(await loadWorkspace(root), blueprintPath, map);
    expect(await readFile(path.join(map, "Base.SC2Data/GameData/LightData.xml"), "utf8")).toContain('<CLight id="Night"');
  });

  it("leaves the Light alone when the scene names none", async () => {
    const script = await compiled({});
    expect(setup(script)).not.toContain("GameSetLighting");
    expect(cleanup(script)).not.toContain("GameSetLighting");
  });
});

describe("a trigger scene's fog", () => {
  it("sets each knob it changes under black, and the mission's back in the cleanup", async () => {
    const script = await compiled({ fog: { color: [0, 0.2, 0.4], density: 0.05, falloff: 0.3 } });
    expect(setup(script)).toContain(lines("FogSetColor(Color(0.00, 20.00, 40.00));", "FogSetDensity(0.05);", "FogSetFallOff(0.3);"));
    // KorhalCityEx2's fog (255,119,215,247; 0.02; 0.2), before the handback.
    expect(at(cleanup(script), lines("FogSetColor(Color(46.67, 84.31, 96.86));", "FogSetDensity(0.02);", "FogSetFallOff(0.2);"))).toBeLessThan(
      at(cleanup(script), "if ((gv_trigger_scene_landing_completed == true))"),
    );
    expect(script).not.toContain("FogSetStartHeight");
  });

  it("sets a knob back to the Blueprint's own sky fog over its tileset's", async () => {
    const script = await compiled({ fog: { density: 0.05, startingHeight: 2 } }, (blueprint) => {
      blueprint.sky = { fog: { from: "Agria", startingHeight: -1.5 } };
    });
    // Agria's density, the Blueprint's start height.
    expect(cleanup(script)).toContain(lines("FogSetDensity(0.06);", "FogSetStartHeight(-1.5);"));
  });

  it("is refused when the mission's value of a knob it changes isn't known", async () => {
    // KorhalCityEx2 sets no fog start height.
    const { root } = await workspace({ fog: { startingHeight: 2 } });
    const { problems } = await checkWorkspace(root);
    expect(problems.map((problem) => `${problem.path ?? ""}: ${problem.message}`)).toContain(
      "fog.startingHeight: The scene changes the fog's start height, but the mission's isn't known (neither the Blueprint's sky.fog nor tileset KorhalCityEx2 sets it), so the cleanup can't set it back; give the Blueprint's sky.fog.startingHeight",
    );
  });

  it("turns the fog on for the scene, and off again after, when the mission's is off", async () => {
    const script = await compiled({ fog: { density: 0.05 } }, (blueprint) => {
      blueprint.sky = { fog: { enabled: false } };
    });
    expect(setup(script)).toContain(lines("FogSetEnabled(true);", "FogSetDensity(0.05);"));
    expect(cleanup(script)).toContain(lines("FogSetDensity(0.02);", "FogSetEnabled(false);"));
  });

  it("leaves the fog's switch alone when the mission's is on", async () => {
    expect(await compiled({ fog: { density: 0.05 } })).not.toContain("FogSetEnabled");
  });
});

describe("a trigger scene with the black mask off", () => {
  it("turns the mask and the fog of war off under black, and back on in the cleanup if they were on", async () => {
    const script = await compiled({ mask: "off" });
    expect(setup(script)).toContain(
      lines(
        "gv_trigger_scene_landing_mask_was_on = VisIsEnabled(c_visTypeMask);",
        "VisEnable(c_visTypeMask, false);",
        "gv_trigger_scene_landing_fog_of_war_was_on = VisIsEnabled(c_visTypeFog);",
        "VisEnable(c_visTypeFog, false);",
      ),
    );
    expect(at(setup(script), "VisEnable(c_visTypeMask, false);")).toBeGreaterThan(at(setup(script), "CinematicFade(false, 0.0,"));
    const restore = lines(
      "if ((gv_trigger_scene_landing_mask_was_on == true)) {",
      "    VisEnable(c_visTypeMask, true);",
      "}",
      "",
      "if ((gv_trigger_scene_landing_fog_of_war_was_on == true)) {",
      "    VisEnable(c_visTypeFog, true);",
      "}",
    );
    expect(at(cleanup(script), restore)).toBeLessThan(at(cleanup(script), "if ((gv_trigger_scene_landing_completed == true))"));
  });

  it("writes Enable/Disable Visibility and the Fog actions as NativeLib's", async () => {
    const { root, blueprintPath } = await workspace({ mask: "off", fog: { color: [0, 0, 0], density: 0.1, falloff: 0.1 } }, (blueprint) => {
      blueprint.sky = { fog: { startingHeight: 0 } };
    });
    const map = path.join(await tempFolder(), "RadioField.SC2Map");
    await compileMission(await loadWorkspace(root), blueprintPath, map);
    const triggers = await readFile(path.join(map, "Triggers"), "utf8");
    // VisEnable, VisIsEnabled, FogSetColor, FogSetDensity, FogSetFallOff.
    for (const id of ["00000162", "00000163", "9D5EB505", "0C83D19F", "B3D5BF65"]) expect(triggers).toContain(`<FunctionDef Type="FunctionDef" Library="Ntve" Id="${id}"/>`);
    // Visibility Type's mask and fog, Enable/Disable Option's enable and disable.
    for (const id of ["00000102", "00000103", "00000063", "00000064"]) expect(triggers).toContain(`<Preset Type="PresetValue" Library="Ntve" Id="${id}"/>`);
  });
});

describe("a trigger scene's world on a skip", () => {
  it("is changed before the skippable Cinematic and put back in the cleanup both paths run", async () => {
    const script = await compiled({ light: "NightLight", fog: { density: 0.05 }, mask: "off" }, (blueprint) => {
      // At mission start after the Cinematic, so a skip there goes straight to this cleanup.
      blueprint.screenplay.script.cues = blueprint.screenplay.script.cues.map((entry: any) => (entry.scene === 2 ? { scene: 2, cue: { type: "missionStart" } } : entry));
    });
    const unskipped = at(setup(script), "if ((gv_trigger_scene_landing_skipped == false))");
    for (const change of ['GameSetLighting("NightLight", 0.0);', "FogSetDensity(0.05);", "VisEnable(c_visTypeMask, false);"]) expect(at(setup(script), change)).toBeLessThan(unskipped);
    // The cleanup runs outside the unskipped branch, and puts all three back.
    expect(setup(script)).toMatch(/\r\n {4}}\r\n\r\n {4}TriggerExecute\(gt_TriggerSceneLandingCleanup, true, true\);/);
    for (const back of ['GameSetLighting("KorhalCityEx2", 0.0);', "FogSetDensity(0.02);", "VisEnable(c_visTypeMask, true);", "VisEnable(c_visTypeFog, true);"]) at(cleanup(script), back);
  });
});
