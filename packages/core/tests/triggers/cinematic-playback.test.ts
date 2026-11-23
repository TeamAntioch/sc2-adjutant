// A Cinematic played from its scene's cue: the `cinematic` fixture Workspace's Radio Field plays
// scene 1 as a Cinematic at mission start, and here also cues a scene 2 of Transmissions at mission
// start, which must play after it. The compiled map's MapScript.galaxy and Triggers are read back.
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { cinematicPlayback } from "../../src/triggers/cinematic-triggers.js";
import { call } from "../../src/triggers/trigger-builders.js";
import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P } from "../../src/triggers/trigger-catalog.js";
import type { Trigger } from "../../src/triggers/trigger-model.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const SCENE_2 = ["", "## Scene 2: THE FIELD", "", "**NOVA** `D-01-01-02-001-NOVA`: Move out.", ""].join("\n");

/** Radio Field compiled with a scene 2 of Transmissions cued at mission start after the Cinematic's scene 1. */
async function compiled(edit: (blueprint: any) => void = () => {}): Promise<{ script: string; triggers: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "missionStart" } });
  edit(blueprint);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return { script: await readFile(path.join(map, "MapScript.galaxy"), "utf8"), triggers: await readFile(path.join(map, "Triggers"), "utf8") };
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const lines = (...statements: string[]): string => statements.map((statement) => (statement ? `    ${statement}` : "")).join("\r\n");

describe("a Cinematic played from its cue", () => {
  it("plays in place of its scene's Transmissions, then the scenes cued after it", async () => {
    const { script } = await compiled();
    const start = section(script, "MissionStart");
    expect(start).toContain("TriggerExecute(gt_CinematicRadio, true, true);");
    // Scene 1's lines play only in the Cinematic; scene 2's follow it as Transmissions.
    expect(script).not.toContain('SoundLink("radio_field-1-');
    expect(start.indexOf("TriggerExecute(gt_CinematicRadio")).toBeLessThan(start.indexOf('SoundLink("radio_field-2-1", -1)'));
  });

  it("plays in a full-screen dialog under Cinematic Mode at full screen, with AI time paused, waiting skippably, then one cleanup", async () => {
    const { script } = await compiled();
    expect(section(script, "CinematicRadio")).toContain(
      lines(
        "gv_cinematic_radio_ai_was_paused = AITimeIsPaused();",
        "AITimePause(true);",
        // The map's music and ambience pause under it, as under Blizzard's cinematics.
        "SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryMusic, true, true);",
        "SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryAmbience, true, true);",
        "libNtve_gf_CinematicMode(true, PlayerGroupAll(), 0.0);",
        "UISetMode(PlayerGroupAll(), c_uiModeFullscreen, 0.0);",
        // The map would otherwise show through a set's windows.
        "EnvironmentShow(c_environmentAll, false);",
      ),
    );
    // Then its units are paused and hidden (below), and the dialog made.
    expect(section(script, "CinematicRadio")).toContain(
      lines(
        "DialogCreate(500, 400, c_anchorCenter, 0, 0, true);",
        "gv_cinematic_radio_dialog = DialogLastCreated();",
        "DialogSetFullscreen(gv_cinematic_radio_dialog, true);",
        "DialogSetImageVisible(gv_cinematic_radio_dialog, false);",
        "DialogSetVisible(gv_cinematic_radio_dialog, PlayerGroupAll(), true);",
        "DialogControlCreate(gv_cinematic_radio_dialog, c_triggerControlTypeCutscene);",
        "DialogControlSetFullDialog(DialogControlLastCreated(), PlayerGroupAll(), true);",
        'libNtve_gf_SetDialogItemCutscene(DialogControlLastCreated(), "Cutscenes\\\\radio.SC2Cutscene", PlayerGroupAll());',
        "libNtve_gf_SetDialogItemRenderType(DialogControlLastCreated(), c_triggerRenderTypeHDR, PlayerGroupAll());",
        "gv_cinematic_radio_cutscene = CutsceneGetTriggerControl(DialogControlLastCreated());",
        "CutscenePlay(gv_cinematic_radio_cutscene);",
        // Skipped or watched to the end, the run comes back here: the cleanup is the same.
        "TriggerExecute(gt_CinematicRadioWatch, true, true);",
        "CutsceneStop(gv_cinematic_radio_cutscene);",
        "if ((gv_cinematic_radio_ai_was_paused == false)) {",
        "    AITimePause(false);",
        "}",
        "",
        "EnvironmentShow(c_environmentAll, true);",
      ),
    );
    expect(section(script, "CinematicRadio")).toContain(
      lines(
        'GameSetLighting("KorhalCityEx2", 0.0);',
        "DialogDestroy(gv_cinematic_radio_dialog);",
        "libNtve_gf_CinematicMode(false, PlayerGroupAll(), 0.0);",
        // The one cleanup, skipped or not, brings the soundtracks back.
        "SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryAmbience, false, true);",
        "SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryMusic, false, true);",
      ),
    );
    // Story Mode's native is for Blizzard's maps only: in ours it logs "Calling StoryMode is not authorized".
    expect(script).not.toContain("StoryMode");
    // The wait is the only thing the skippable trigger holds, so a skip ends just that trigger.
    expect(section(script, "CinematicRadioWatch")).toContain(lines("TriggerSkippableBegin(PlayerGroupAll(), 0, null, true, false);", "WaitForCutsceneToEnd(gv_cinematic_radio_cutscene);", "return true;"));
    expect(script).toContain("int gv_cinematic_radio_dialog;");
    expect(script).toContain("int gv_cinematic_radio_cutscene;");
    expect(script).toContain("bool gv_cinematic_radio_ai_was_paused;");
  });

  it("pauses and hides the map's units while it plays, and its cleanup restores only the ones it changed", async () => {
    const { script } = await compiled();
    const cinematic = section(script, "CinematicRadio");
    // Hide Environment leaves units showing through a set's gaps (a hero floating in its sky).
    for (const statement of [
      "UnitGroup(null, c_playerAny, RegionEntireMap(), UnitFilter(0, 0, 0, (1 << (c_targetFilterDead - 32))), 0)",
      "if ((libNtve_gf_UnitIsPaused(",
      "UnitGroupAdd(gv_cinematic_radio_paused_units, ",
      "if ((libNtve_gf_UnitIsHidden(",
      "UnitGroupAdd(gv_cinematic_radio_hidden_units, ",
    ]) {
      expect(cinematic).toContain(statement);
    }
    const at = (text: string, from = 0) => cinematic.indexOf(text, from);
    const play = at("CutscenePlay(");
    expect(at("libNtve_gf_PauseUnit(")).toBeGreaterThan(at("EnvironmentShow(c_environmentAll, false);"));
    expect(at("libNtve_gf_PauseUnit(")).toBeLessThan(play);
    expect(cinematic).toMatch(/libNtve_gf_PauseUnit\(\w+, true\);/);
    expect(cinematic).toMatch(/libNtve_gf_ShowHideUnit\(\w+, false\);/);
    // The cleanup: back, from the groups it kept, before the dialog goes.
    const cleanup = at("EnvironmentShow(c_environmentAll, true);");
    expect(cinematic.slice(cleanup)).toMatch(/_g = gv_cinematic_radio_paused_units;[\s\S]*libNtve_gf_PauseUnit\(\w+, false\);/);
    expect(cinematic.slice(cleanup)).toMatch(/_g = gv_cinematic_radio_hidden_units;[\s\S]*libNtve_gf_ShowHideUnit\(\w+, true\);/);
    expect(at("libNtve_gf_ShowHideUnit(", cleanup)).toBeLessThan(at("DialogDestroy("));
    // Emptied once put back, so a run overlapping another's adds to the groups rather than wiping them.
    expect(cinematic.slice(cleanup)).toContain(lines("UnitGroupClear(gv_cinematic_radio_paused_units);", "UnitGroupClear(gv_cinematic_radio_hidden_units);"));
    expect(cinematic.slice(0, cleanup)).not.toContain("UnitGroupEmpty()");
    expect(script).toContain("unitgroup gv_cinematic_radio_paused_units;");
  });

  it("plays a Cinematic on the map's own ground in the world with the environment showing, and still hides its units", async () => {
    const { script } = await compiled((blueprint) => {
      blueprint.screenplay.script.cinematics[0].environment = "shown";
    });
    const cinematic = section(script, "CinematicRadio");
    expect(cinematic).not.toContain("EnvironmentShow(");
    // In the world at Point(64, 64), where its coordinates meet the terrain; a dialog draws the world elsewhere.
    expect(cinematic).toContain('CutsceneCreateNew("Cutscenes\\\\radio.SC2Cutscene", Point(64.0, 64.0), 0.0, PlayerGroupAll(), false);');
    expect(cinematic).toContain("gv_cinematic_radio_cutscene = CutsceneLastCreated();");
    expect(cinematic).not.toContain("DialogCreate(");
    expect(cinematic).not.toContain("DialogDestroy(");
    expect(cinematic).toMatch(/libNtve_gf_ShowHideUnit\(\w+, false\);/);
    expect(cinematic).toMatch(/libNtve_gf_ShowHideUnit\(\w+, true\);/);
  });

  it("pauses and hides a unit created while it plays, until the cleanup", async () => {
    const { script } = await compiled();
    const cinematic = section(script, "CinematicRadio");
    const spawns = section(script, "CinematicRadioSpawns");
    // A spawn, a wave or a mission trigger's unit would show through the frame: the Spawns trigger,
    // on only while the Cinematic plays, treats it as the opening sweep treats the map's units.
    expect(script).toContain(lines('gt_CinematicRadioSpawns = TriggerCreate("gt_CinematicRadioSpawns_Func");', "TriggerEnable(gt_CinematicRadioSpawns, false);", "TriggerAddEventUnitCreated(gt_CinematicRadioSpawns, null, null, null);"));
    expect(spawns).toContain("if (!((EventUnitCreatedUnit() != null))) {");
    expect(spawns).toContain(
      lines(
        "if ((libNtve_gf_UnitIsPaused(EventUnitCreatedUnit()) == false)) {",
        "    UnitGroupAdd(gv_cinematic_radio_paused_units, EventUnitCreatedUnit());",
        "    libNtve_gf_PauseUnit(EventUnitCreatedUnit(), true);",
        "}",
        "",
        "if ((libNtve_gf_UnitIsHidden(EventUnitCreatedUnit()) == false)) {",
        "    UnitGroupAdd(gv_cinematic_radio_hidden_units, EventUnitCreatedUnit());",
        "    libNtve_gf_ShowHideUnit(EventUnitCreatedUnit(), false);",
        "}",
      ),
    );
    // On from the opening sweep to the cleanup, which turns it off before it puts the units back.
    const at = (text: string) => cinematic.indexOf(text);
    expect(at("TriggerEnable(gt_CinematicRadioSpawns, true);")).toBeGreaterThan(at("libNtve_gf_ShowHideUnit("));
    expect(at("TriggerEnable(gt_CinematicRadioSpawns, true);")).toBeLessThan(at("CutscenePlay("));
    expect(at("TriggerEnable(gt_CinematicRadioSpawns, false);")).toBeGreaterThan(at("CutsceneStop("));
    expect(at("TriggerEnable(gt_CinematicRadioSpawns, false);")).toBeLessThan(at("_g = gv_cinematic_radio_paused_units;"));
  });

  const playedScript = (options: Parameters<typeof cinematicPlayback>[2]) => {
    const playback = cinematicPlayback("radio", "KorhalCityEx2", options);
    return section(writeMapScript({ mapName: "Synthetic", triggers: { variables: playback.variables, triggers: playback.triggers } }), "CinematicRadio");
  };

  it("in the world, swaps the cutscene's leftover closing fade for a Cinematic Fade black after it stops, then fades back in and ends Cinematic Mode", () => {
    const cinematic = playedScript({ environmentShown: true });
    const at = (text: string) => cinematic.indexOf(text);
    const black = at("CinematicFade(false, 0.0, c_fadeStyleNormal, Color(0.00, 0.00, 0.00), 0.0, false);");
    const clear = at("CutsceneFade(true, 0.0, Color(0.00, 0.00, 0.00), 100.0, PlayerGroupAll(), false);");
    const fadeIn = at("CinematicFade(true, 1.0, c_fadeStyleNormal, Color(0.00, 0.00, 0.00), 0.0, false);");
    expect(black).toBeGreaterThan(at("CutsceneStop("));
    expect(clear).toBeGreaterThan(black);
    expect(fadeIn).toBeGreaterThan(clear);
    expect(at("libNtve_gf_CinematicMode(false, PlayerGroupAll(), 0.0);")).toBeGreaterThan(fadeIn);
    // In a dialog, destroying it takes the cutscene's fade with it.
    expect(playedScript({})).not.toContain("CutsceneFade(");
  });

  it("handing on to a Kept trigger held until its scene, leaves the screen black and Cinematic Mode on for it", () => {
    for (const environmentShown of [true, false]) {
      const cinematic = playedScript({ environmentShown, handsOnToKept: true });
      const stop = cinematic.indexOf("CutsceneStop(");
      expect(cinematic.slice(stop), `environmentShown ${environmentShown}`).toMatch(/CinematicFade\(false, 0\.0, /);
      expect(cinematic, `environmentShown ${environmentShown}`).not.toMatch(/CinematicFade\(true, /);
      expect(cinematic, `environmentShown ${environmentShown}`).not.toContain("libNtve_gf_CinematicMode(false, ");
    }
  });

  it("leaves a unit the mission hides or pauses while it plays as the mission set it", () => {
    const playback = cinematicPlayback("radio", "KorhalCityEx2");
    const unit = { kind: "unit", objectId: 7 } as const;
    // A mission trigger that hides and pauses a unit of its own during playback, then says so.
    const mission: Trigger = {
      id: "AAAA0001",
      name: "Mission Hides",
      events: [],
      actions: [
        call("mission/hide", F.showHideUnit, { unit, showHide: { kind: "preset", preset: P.hide } }),
        playback.leave("mission/leaveHidden", unit, "hidden"),
        call("mission/pause", F.pauseUnit, { unit, pause: { kind: "preset", preset: P.pause } }),
        playback.leave("mission/leavePaused", unit, "paused"),
      ],
    };
    const script = writeMapScript({ mapName: "Synthetic", triggers: { variables: playback.variables, triggers: [...playback.triggers, mission] } });
    // Out of the groups the cleanup puts back, so it neither shows nor unpauses the unit.
    expect(section(script, "MissionHides")).toContain(
      lines(
        "libNtve_gf_ShowHideUnit(UnitFromId(7), false);",
        "UnitGroupRemove(gv_cinematic_radio_hidden_units, UnitFromId(7));",
        "libNtve_gf_PauseUnit(UnitFromId(7), true);",
        "UnitGroupRemove(gv_cinematic_radio_paused_units, UnitFromId(7));",
      ),
    );
  });

  it("is NativeLib's GUI actions in the Triggers file, with no custom script", async () => {
    const { triggers } = await compiled();
    expect(triggers).not.toContain("CustomScript");
    // Set Screen Mode (UISetMode) to Fullscreen, not Story Mode (B88E5C2B).
    expect(triggers).toContain('<FunctionDef Type="FunctionDef" Library="Ntve" Id="8EDD3557"/>');
    expect(triggers).toContain('<Preset Type="PresetValue" Library="Ntve" Id="B2D12F4E"/>');
    expect(triggers).not.toContain('Id="B88E5C2B"');
    // Pause/Unpause Unit, Show/Hide Unit and their tests, from NativeLib.
    for (const id of ["30000000", "40000000", "8518EA3D", "49A95989", "9435D821"]) expect(triggers).toContain(`<FunctionDef Type="FunctionDef" Library="Ntve" Id="${id}"/>`);
    // Unit Is Created (any creator, any ability, no behavior) and Created Unit.
    for (const id of ["18377668", "11EB5EB1"]) expect(triggers).toContain(`<FunctionDef Type="FunctionDef" Library="Ntve" Id="${id}"/>`);
    for (const id of ["C84C7A78", "00000231", "C9DCA6C0"]) expect(triggers).toContain(`<Preset Type="PresetValue" Library="Ntve" Id="${id}"/>`);
    // Show/Hide Environment, all types.
    expect(triggers).toContain('<FunctionDef Type="FunctionDef" Library="Ntve" Id="F5C63A46"/>');
    expect(triggers).toContain('<Preset Type="PresetValue" Library="Ntve" Id="F9D3799C"/>');
    // Set Dialog Item Cutscene's file, typed as a cutscene as the Editor saves one.
    expect(triggers).toContain("<Value>Cutscenes\\radio.SC2Cutscene</Value>\r\n        <ValueType Type=\"filepath\"/>\r\n        <ValueTypeInfo Value=\"1\"/>");
    // The cutscene variable is NativeLib's Cutscene preset type, starting at No Cutscene.
    expect(triggers).toContain('<TypeElement Type="Preset" Library="Ntve" Id="DF249F5E"/>');
    expect(triggers).toContain('<Preset Type="PresetValue" Library="Ntve" Id="A2833C70"/>');
    expect(triggers).toContain('<Type Value="dialog"/>');
  });

  it("starts a goal timer after a mission start Cinematic and the scenes after it, so the countdown is held while it plays", async () => {
    const { script } = await compiled((blueprint) => {
      blueprint.outcomes = { victory: [{ type: "timer", seconds: 300 }], defeat: [] };
    });
    const start = section(script, "MissionStart");
    expect(start.indexOf('SoundLink("radio_field-2-1", -1)')).toBeGreaterThan(start.indexOf("TriggerExecute(gt_CinematicRadio"));
    expect(start.indexOf("TimerStart(gv_goal_timer_300, 300.0")).toBeGreaterThan(start.indexOf('SoundLink("radio_field-2-1", -1)'));
  });
});
