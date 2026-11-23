// A cue or Beat start on a Kept trigger's run (ADR-0010): an "After <trigger>" trigger waits on it.
import { describe, expect, it } from "vitest";

import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { CrossingBlueprintSchema, crossingRaw, crossingScript } from "../support/workspaces.js";

const blueprint = MissionBlueprintSchema.parse({
  id: "harbour",
  campaignId: "fixtures",
  title: "The Harbour",
  setting: "A port at dusk",
  mapSize: { width: 96, height: 64 },
  kept: [{ id: "gate-opens", kind: "trigger", editorId: "0A1B2C3D", name: "Gate Opens" }],
  beats: [
    { id: "arrive", title: "Arrive", summary: "The ship docks." },
    { id: "unload", title: "Unload", summary: "The crates come off.", startsWhen: [{ type: "keptTriggerRuns", triggerId: "gate-opens" }] },
  ],
  screenplay: { title: "The Harbour", scenes: [{ id: "s", cue: { type: "keptTriggerRuns", triggerId: "gate-opens" }, lines: [{ id: "l", speaker: "Dock Master", speakerUnitType: "Marine", text: "Tie her up." }] }] },
});

describe("a Kept trigger's run", () => {
  it("is waited on from map start, then plays the cued scene and starts the Beat while the Beat's trigger is on", () => {
    const triggers = buildMissionTriggers(blueprint);
    const script = writeMapScript({ mapName: "The Harbour", triggers });
    const after = script.slice(script.indexOf("// Trigger: After Gate Opens"));

    expect(triggers.triggers.find((trigger) => trigger.name === "Beat - Unload")!.events).toEqual([]);
    expect(after).toContain("    TriggerWaitForTrigger(gt_GateOpens, true);\r\n    TransmissionSendForPlayerSelect(");
    expect(after).toContain("    if ((TriggerIsEnabled(gt_BeatUnload) == true)) {\r\n        TriggerExecute(gt_BeatUnload, true, false);\r\n    }");
    expect(after).toContain("    TriggerAddEventMapInit(gt_AfterGateOpens);");
  });
});

describe("a held Kept trigger (ADR-0014)", () => {
  /** Ashen Crossing with scene 1 a Cinematic at mission start, and a Kept "Stealth" held as `hold` says. */
  function crossing(hold: Record<string, unknown>) {
    const raw = structuredClone(crossingRaw) as any;
    raw.screenplay.script.cinematics = [{ id: "opening", scene: 1 }];
    raw.kept = [
      { id: "initialization", kind: "trigger", editorId: "0A1B2C3E", name: "Initialization" },
      { id: "stealth", kind: "trigger", editorId: "0A1B2C3D", name: "Stealth", hold },
    ];
    const blueprint = CrossingBlueprintSchema.parse(raw);
    const script = writeMapScript({ mapName: blueprint.title, triggers: buildMissionTriggers(blueprint, { script: crossingScript }) });
    return (name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
  }

  it("runs once the scene it waits on has played: after the Cinematic's cleanup, skipped or watched to its end", () => {
    const section = crossing({ from: "initialization", until: { type: "scenePlayed", scene: 1 } });
    const start = section("MissionStart");

    expect(start.indexOf("TriggerExecute(gt_CinematicOpening, true, true);")).toBeGreaterThan(-1);
    expect(start.indexOf("TriggerExecute(gt_ScriptScene1Played, true, false);")).toBeGreaterThan(start.indexOf("TriggerExecute(gt_CinematicOpening, true, true);"));
    expect(section("ScriptScene1Played")).toContain("    TriggerExecute(gt_Stealth, true, false);\r\n    return true;");
    expect(start).not.toContain("gt_Stealth");
  });

  it("has the Cinematic it waits on hand on to it, leaving the screen black and Cinematic Mode on, but not one held on another cue", () => {
    const handedOn = crossing({ from: "initialization", until: { type: "scenePlayed", scene: 1 } })("CinematicOpening");
    expect(handedOn).not.toContain("libNtve_gf_CinematicMode(false, ");
    expect(handedOn.slice(handedOn.indexOf("CutsceneStop("))).toContain("CinematicFade(false, 0.0, ");

    const own = crossing({ until: { type: "missionStart" } })("CinematicOpening");
    expect(own).toContain("libNtve_gf_CinematicMode(false, ");
  });

  it("is refused when it waits on a scene the compile doesn't play, as beside Kept terrain with an unconverted script", () => {
    const raw = structuredClone(crossingRaw) as any;
    raw.kept = [{ id: "stealth", kind: "trigger", editorId: "0A1B2C3D", name: "Stealth", hold: { until: { type: "scenePlayed", scene: 1 } } }];
    const blueprint = CrossingBlueprintSchema.parse(raw);

    expect(() => buildMissionTriggers({ ...blueprint, screenplay: { ...blueprint.screenplay, script: undefined } })).toThrow("The held Kept trigger stealth waits on Scene 1, which this compile doesn't play");
  });

  it("runs from its cue's trigger after the cue's scenes, such as Mission Start's", () => {
    const start = crossing({ until: { type: "missionStart" } })("MissionStart");

    expect(start.indexOf("TriggerExecute(gt_Stealth, true, false);")).toBeGreaterThan(start.indexOf("TriggerExecute(gt_CinematicOpening, true, true);"));
  });
});
