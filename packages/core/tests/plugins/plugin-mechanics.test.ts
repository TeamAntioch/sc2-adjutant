import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MissionBlueprintSchema, missionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { runLayoutChecks } from "../../src/layout/checks.js";
import { buildLayoutModel } from "../../src/layout/layout-model.js";
import { defineMechanic, type Mechanic, type PluginRegistry } from "../../src/plugins/plugin-api.js";
import { blueprintCatalog } from "../../src/catalog/catalog-layer.js";
import { mechanicContext } from "../../src/plugins/mechanic-context.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { buildMechanicWarnings, buildMissionGameData, buildMissionGameHotkeys, buildMissionGameStrings, buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { NTVE_FUNCTIONS } from "../../src/triggers/trigger-catalog.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";

const { registry } = await loadWorkspace(fileURLToPath(new URL("../fixtures/workspaces/basic/", import.meta.url)));

const blueprint = (mechanics: object[]) => ({
  id: "plugin_fixture",
  campaignId: "fixtures",
  title: "Plugin Fixture",
  setting: "A test field",
  mapSize: { width: 32, height: 16 },
  zones: [
    { id: "field", name: "Field", elevation: 1, landform: "flat", role: "path", polygon: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }, { x: 0, y: 16 }] },
    { id: "cave", name: "Cave", elevation: 1, landform: "flat", role: "refuge", polygon: [{ x: 16, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 16 }, { x: 16, y: 16 }] },
  ],
  beats: [{ id: "one", title: "One", summary: "One." }],
  mechanics,
  screenplay: { title: "Fixture" },
});

const lava = { id: "lava", type: "hazard", params: { affectedZoneIds: ["field"], safeZoneIds: ["cave"], firstSeconds: 0, deadlySeconds: 5, warningSeconds: 5 } };

describe("Mechanics from Plugins", () => {
  it("fails a Blueprint whose Mechanic type no loaded Plugin provides", () => {
    const result = missionBlueprintSchema(registry).safeParse(blueprint([{ id: "glow", type: "lantern", params: {} }]));
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["mechanics", 0, "type"],
        message: "Unknown Mechanic type lantern: no Plugin the Workspace loads provides it (known types: hazard, beacon)",
      }),
    ]);
  });

  it("knows hazard only when the Workspace loads its Plugin", () => {
    expect(missionBlueprintSchema(registry).safeParse(blueprint([lava])).success).toBe(true);
    expect(MissionBlueprintSchema.safeParse(blueprint([lava])).error?.issues[0]?.message).toMatch(/^Unknown Mechanic type hazard: /);
  });

  it("validates a Plugin Mechanic's params strictly, at their path in the Blueprint", () => {
    const result = missionBlueprintSchema(registry).safeParse(
      blueprint([{ ...lava, params: { ...lava.params, warningSecs: 5 } }, { id: "light", type: "beacon", params: { zoneId: "nowhere" } }]),
    );
    expect(result.error?.issues.map(({ path, message }) => ({ path, message }))).toEqual([
      { path: ["mechanics", 0, "params"], message: 'Unrecognized key: "warningSecs"' },
      { path: ["mechanics", 1, "params", "zoneId"], message: "Unknown zone id: nowhere" },
    ]);
  });

  it("compiles a Plugin Mechanic's triggers into the map script", () => {
    const parsed = missionBlueprintSchema(registry).parse(blueprint([{ id: "light", type: "beacon", params: { zoneId: "field" } }]));
    const doc = buildMissionTriggers(parsed);
    expect(doc.triggers.map((trigger) => trigger.name)).toContain("Beacon Lights");
    expect(writeMapScript({ mapName: parsed.title, triggers: doc })).toContain("void gt_BeaconLights_Init () {");
  });

  it("reports a Plugin Mechanic's warnings, naming the Mechanic, from the units the Placements place", () => {
    const parsed = missionBlueprintSchema(registry).parse({
      ...blueprint([{ id: "light", type: "beacon", params: { zoneId: "field", warnsOfPlaced: true } }]),
      // One small geyser 7 cells west of the hall spot, snapped to its 3-cell grid.
      placements: [{ id: "rocks", zoneId: "field", kind: "resource-base", params: { at: { x: 8, y: 8 }, minerals: "none", gas: "small" } }],
    });
    expect(buildMechanicWarnings(parsed)).toEqual(["Mechanic mechanics.0 (light, type beacon from Plugin beacon): VespeneGeyser rocks/geyser/0 stands at 1.5, 8.5"]);
  });

  it("refuses two triggers that would share a script name, naming the Mechanics that made them", () => {
    const parsed = missionBlueprintSchema(registry).parse(
      blueprint([
        { id: "light", type: "beacon", params: { zoneId: "field" } },
        { id: "light2", type: "beacon", params: { zoneId: "cave" } },
      ]),
    );
    expect(() => buildMissionTriggers(parsed)).toThrow(
      'Two triggers would share the script name gt_BeaconLights: "Beacon Lights" (Mechanic mechanics.0 (light, type beacon from Plugin beacon)) and "Beacon Lights" (Mechanic mechanics.1 (light2, type beacon from Plugin beacon))',
    );
  });

  it("refuses two variables whose names differ only in their first letter's case: both are gv_ started lower case", () => {
    const variable = (name: string, id: string) => ({ id, name, type: "int" as const, initial: { id: `${id.slice(0, 4)}D${id.slice(5)}`, value: { kind: "int" as const, value: 0 } } });
    const twin = defineMechanic({ type: "twin", paramsSchema: z.object({}).strict(), buildTriggers: () => ({ triggers: [], variables: [variable("Glow", "0000C001"), variable("glow", "0000C002")] }) });
    const plugins: PluginRegistry = {
      ...registry,
      mechanic: (type) => (type === "twin" ? (twin as Mechanic) : registry.mechanic(type)),
      mechanicPlugin: (type) => (type === "twin" ? "twins" : registry.mechanicPlugin(type)),
    };
    const parsed = missionBlueprintSchema(plugins).parse(blueprint([{ id: "t", type: "twin", params: {} }]));
    expect(() => buildMissionTriggers(parsed)).toThrow("Two variables would share the script name gv_glow: ");
  });

  it("compiles a Blueprint with the Plugins it was validated against, and refuses a copy that lost them", () => {
    const parsed = missionBlueprintSchema(registry).parse(blueprint([{ id: "light", type: "beacon", params: { zoneId: "field" } }]));
    expect(() => buildMissionTriggers({ ...parsed })).toThrow(
      "Mechanic mechanics.0 (light, type beacon) needs a Plugin, but this Blueprint wasn't parsed with missionBlueprintSchema(registry)",
    );
  });

  it("puts a Plugin Mechanic's Threats in the layout model, where the checks read them", () => {
    const hero = { id: "hero", name: "Hero", zoneId: "field", kind: "unit", player: 1, position: { x: 4, y: 8 } };
    const guarded = (guardsZoneId: string) =>
      missionBlueprintSchema(registry).parse({ ...blueprint([{ id: "light", type: "beacon", params: { zoneId: "cave", guardsZoneId } }]), anchors: [hero] });
    const model = buildLayoutModel(guarded("field"));
    expect(model.threats()).toEqual([expect.objectContaining({ source: { kind: "Mechanic", id: "light" }, footprint: { zoneIds: ["field"] }, consequence: "combat" })]);
    expect(runLayoutChecks(model).find((check) => check.id === "safe-havens")).toMatchObject({
      status: "warn",
      findings: ["The start, Field, has Mechanic light in it."],
    });
    expect(() => buildLayoutModel(guarded("nowhere")).threats()).toThrow(
      "Mechanic mechanics.0 (light, type beacon from Plugin beacon): its threats hook gave a bad Threat 0: unknown zone id nowhere",
    );
    // The failure is kept, and the checks that read the Threats report it, not evaluated.
    const bad = buildLayoutModel(guarded("nowhere"));
    expect(() => bad.threats()).toThrow("unknown zone id nowhere");
    expect(runLayoutChecks(bad).find((check) => check.id === "safe-havens")?.findings[0]).toContain("unknown zone id nowhere");
    // A check that throws is reported as not evaluated; the others still run.
    const results = runLayoutChecks({ ...model, threats: () => { throw new Error("the hook failed"); } });
    expect(results.find((check) => check.id === "safe-havens")).toMatchObject({ status: "not-evaluated", findings: ["The check couldn't run: the hook failed"] });
    const failed = results.filter((check) => check.findings[0]?.startsWith("The check couldn't run")).map((check) => check.id);
    expect(failed).toEqual(expect.arrayContaining(["safe-havens", "hazard-retreat"]));
    expect(failed.length).toBeLessThan(results.length);
  });

  describe("variables, beat actions and game data", () => {
    const hero = { id: "hero", name: "Hero", zoneId: "field", kind: "unit", player: 1, position: { x: 4, y: 8 } };
    const twoBeats = (mechanics: object[]) =>
      missionBlueprintSchema(registry).parse({
        ...blueprint(mechanics),
        anchors: [hero],
        beats: [
          { id: "one", title: "One", summary: "One." },
          { id: "two", title: "Two", summary: "Two.", startsWhen: [{ type: "anchorEntersZone", anchorId: "hero", zoneId: "cave" }] },
        ],
      });

    it("declares a Plugin Mechanic's variables and runs its actions as a Beat starts", () => {
      const parsed = twoBeats([{ id: "light", type: "beacon", params: { zoneId: "field", chimesAtBeat: "two" } }]);
      const doc = buildMissionTriggers(parsed);
      expect(doc.variables.map((variable) => variable.name)).toEqual(["beacon_chimes"]);
      const script = writeMapScript({ mapName: parsed.title, triggers: doc });
      const beat = script.slice(script.indexOf("bool gt_BeatTwo_Func"), script.indexOf("void gt_BeatTwo_Init"));
      // After the Beat's own debug message (#174).
      expect(beat).toMatch(/TriggerEnable\(gt_BeatTwo, false\);\r\n {4}TriggerDebugOutput\(1, StringExternal\("Param\/Value\/[0-9A-F]{8}"\), true\);\r\n {4}gv_beacon_chimes = 1;/);
    });

    it("runs a Plugin Mechanic's beat actions after the Beat's explores and before its pings", () => {
      const parsed = twoBeats([{ id: "light", type: "beacon", params: { zoneId: "field", chimesAtBeat: "two" } }]);
      const revealing = missionBlueprintSchema(registry).parse({ ...parsed, beats: parsed.beats.map((beat) => (beat.id === "two" ? { ...beat, reveals: [{ zoneId: "cave", region: true }] } : beat)) });
      const script = writeMapScript({ mapName: revealing.title, triggers: buildMissionTriggers(revealing) });
      const beat = script.slice(script.indexOf("bool gt_BeatTwo_Func"), script.indexOf("void gt_BeatTwo_Init"));
      expect(beat.indexOf("VisExploreArea(")).toBeLessThan(beat.indexOf("gv_beacon_chimes = 1;"));
      expect(beat.indexOf("MinimapPing(")).toBeGreaterThan(beat.indexOf("gv_beacon_chimes = 1;"));
    });

    it("refuses actions for a Beat that has no trigger, naming the Mechanic", () => {
      const parsed = twoBeats([{ id: "light", type: "beacon", params: { zoneId: "field", chimesAtBeat: "one" } }]);
      expect(() => buildMissionTriggers(parsed)).toThrow(
        "Mechanic mechanics.0 (light, type beacon from Plugin beacon): its buildTriggers hook gave actions for beat one, which has no Beat trigger (only a Beat with startsWhen has one)",
      );
    });

    it("adds a Plugin Mechanic's catalog entries, strings and hotkeys, and refuses two Mechanics setting one string", () => {
      const parsed = twoBeats([{ id: "light", type: "beacon", params: { zoneId: "field", withData: true } }]);
      expect(buildMissionGameData(parsed)["BehaviorData.xml"]).toBe(
        '<?xml version="1.0" encoding="utf-8"?>\r\n<Catalog>\r\n    <CBehaviorBuff id="BeaconGlow"/>\r\n</Catalog>\r\n',
      );
      expect(buildMissionGameStrings(parsed)).toEqual({ "Behavior/Name/BeaconGlow": "Beacon Glow" });
      expect(buildMissionGameHotkeys(parsed)).toEqual({ "Button/Hotkey/BeaconGlow": "B" });

      const twice = twoBeats([
        { id: "light", type: "beacon", params: { zoneId: "field", withData: true } },
        { id: "light2", type: "beacon", params: { zoneId: "cave", withData: true } },
      ]);
      expect(() => buildMissionGameStrings(twice)).toThrow(
        "Two Mechanics set the game string Behavior/Name/BeaconGlow: Mechanic mechanics.0 (light, type beacon from Plugin beacon) and Mechanic mechanics.1 (light2, type beacon from Plugin beacon)",
      );
    });
  });

  it("refuses a buildTriggers or buildGameData result of the wrong shape, naming the Mechanic and the hook", () => {
    const odd = defineMechanic({
      type: "odd",
      paramsSchema: z.object({}).strict(),
      buildTriggers: () => [{ nope: true }] as never,
      buildGameData: () => ({ strings: { "Button/Name/Odd": 5 } }) as never,
    });
    const plugins: PluginRegistry = {
      ...registry,
      mechanic: (type) => (type === "odd" ? (odd as Mechanic) : registry.mechanic(type)),
      mechanicPlugin: (type) => (type === "odd" ? "oddity" : registry.mechanicPlugin(type)),
    };
    const parsed = missionBlueprintSchema(plugins).parse(blueprint([{ id: "o", type: "odd", params: {} }]));
    expect(() => buildMissionTriggers(parsed)).toThrow("Mechanic mechanics.0 (o, type odd from Plugin oddity): its buildTriggers hook returned");
    expect(() => buildMissionGameStrings(parsed)).toThrow("Mechanic mechanics.0 (o, type odd from Plugin oddity): its buildGameData hook returned strings.Button/Name/Odd");
  });

  it("compiles a primitive the Mechanic contributes, and refuses one it doesn't, naming both", () => {
    const ringing = (ring: string) => missionBlueprintSchema(registry).parse(blueprint([{ id: "light", type: "beacon", params: { zoneId: "field", ring } }]));
    const doc = buildMissionTriggers(ringing("contributed"));
    expect(writeMapScript({ mapName: "Plugin Fixture", triggers: doc })).toContain("    BeaconRing();");
    expect(() => buildMissionTriggers(ringing("uncontributed"))).toThrow(
      "Mechanic mechanics.0 (light, type beacon from Plugin beacon): its buildTriggers hook used the trigger function Ntve/BEAC0002, which neither core nor the Mechanic's primitives provide",
    );
    expect(() => buildMissionTriggers(ringing("stray-block"))).toThrow(
      "Mechanic mechanics.0 (light, type beacon from Plugin beacon): its buildTriggers hook used the block sub-function Ntve/BEAC0003, which neither core nor the Mechanic's primitives provide",
    );
  });

  it("refuses a primitive that reuses a known id with other parameters", () => {
    const forged = { ...NTVE_FUNCTIONS.mapInit, params: { extra: { id: "FORGED01" } } };
    const odd = defineMechanic({
      type: "odd",
      paramsSchema: z.object({}).strict(),
      buildTriggers: () => [{ id: "T0000001", name: "Odd", events: [{ id: "C0000001", def: forged, params: {} }], actions: [] }] as never,
    });
    const plugins: PluginRegistry = { ...registry, mechanic: (type) => (type === "odd" ? (odd as Mechanic) : registry.mechanic(type)) };
    const parsed = missionBlueprintSchema(plugins).parse(blueprint([{ id: "o", type: "odd", params: {} }]));
    expect(() => buildMissionTriggers(parsed)).toThrow("its buildTriggers hook used a trigger function Ntve/00000120 that differs from the one core provides");
  });

  it("runs a Mechanic's victory actions first in each victory trigger, with ids from that trigger, and checks their primitives", () => {
    const anchors = [{ id: "hero", name: "Hero", zoneId: "field", kind: "unit", player: 1, position: { x: 4, y: 8 } }];
    const outcomes = {
      victory: [
        { type: "anchorEntersZone", anchorId: "hero", zoneId: "cave" },
        { type: "timer", seconds: 60 },
      ],
    };
    const ringing = (ringOnVictory: string) =>
      missionBlueprintSchema(registry).parse({ ...blueprint([{ id: "light", type: "beacon", params: { zoneId: "field", ringOnVictory } }]), anchors, outcomes });
    const doc = buildMissionTriggers(ringing("contributed"));
    const victories = doc.triggers.filter((trigger) => trigger.actions.some((action) => action.def.id === "BEAC0001"));
    expect(victories).toHaveLength(2);
    for (const trigger of victories) expect(trigger.actions.findIndex((action) => action.def.id === "BEAC0001")).toBeLessThan(trigger.actions.length - 1);
    expect(() => buildMissionTriggers(ringing("uncontributed"))).toThrow(
      "Mechanic mechanics.0 (light, type beacon from Plugin beacon): its victoryActions used the trigger function Ntve/BEAC0002, which neither core nor the Mechanic's primitives provide",
    );
  });

  it("plays a scene cued at a Mechanic's cue in its triggers, and refuses a Mechanic that never asks for it", () => {
    const cued = (params: object) =>
      missionBlueprintSchema(registry).parse({
        ...blueprint([{ id: "light", type: "beacon", params: { zoneId: "field", ...params } }]),
        screenplay: {
          title: "Fixture",
          scenes: [{ id: "glow", cue: { type: "mechanic", mechanicId: "light", cue: "lit" }, lines: [{ id: "l1", speaker: "Keeper", speakerUnitType: "Marine", text: "It's lit." }] }],
        },
      });
    const script = writeMapScript({ mapName: "Plugin Fixture", triggers: buildMissionTriggers(cued({})) });
    const lights = script.slice(script.indexOf("bool gt_BeaconLights_Func"), script.indexOf("void gt_BeaconLights_Init"));
    expect(lights).toContain('TransmissionSendForPlayerSelect(PlayerGroupAll(), TransmissionSourceFromUnitType("Marine", false)');
    expect(() => buildMissionTriggers(cued({ ignoresCue: true }))).toThrow(
      "Mechanic mechanics.0 (light, type beacon from Plugin beacon): the Blueprint cues something at its lit, but its buildTriggers hook never asked for what to play there (context.cueActions)",
    );
  });

  describe("a Beat that starts on a Mechanic's cue", () => {
    const hero = { id: "hero", name: "Hero", zoneId: "field", kind: "unit", player: 1, position: { x: 4, y: 8 } };
    const startsOn = (cue: object, params: object = {}) => ({
      ...blueprint([{ id: "light", type: "beacon", params: { zoneId: "field", ...params } }]),
      anchors: [hero],
      beats: [
        { id: "one", title: "One", summary: "One." },
        { id: "two", title: "Two", summary: "Two.", startsWhen: [cue], reveals: [{ zoneId: "cave", region: true }] },
      ],
    });
    const atLit = { type: "mechanic", mechanicId: "light", cue: "lit" };

    it("starts from the Mechanic's triggers where they reach the moment, not by an event of its own", () => {
      const parsed = missionBlueprintSchema(registry).parse(startsOn(atLit));
      const script = writeMapScript({ mapName: parsed.title, triggers: buildMissionTriggers(parsed) });
      const lights = script.slice(script.indexOf("bool gt_BeaconLights_Func"), script.indexOf("void gt_BeaconLights_Init"));
      // Run to its whole start, so nothing after it in the Mechanic's trigger comes first.
      expect(lights).toMatch(/if \(\(TriggerIsEnabled\(gt_BeatTwo\) == true\)\) \{\r\n {8}TriggerExecute\(gt_BeatTwo, true, true\);/);
      const init = script.slice(script.indexOf("void gt_BeatTwo_Init"));
      expect(init.slice(0, init.indexOf("}"))).not.toContain("TriggerAddEvent");
      // Its reveals compile, since it has a trigger.
      expect(script.slice(script.indexOf("bool gt_BeatTwo_Func"), script.indexOf("void gt_BeatTwo_Init"))).toContain("VisExploreArea(");
    });

    it("starts the Beat before what is cued at the moment plays, so the Beat waits behind none of it", () => {
      const parsed = missionBlueprintSchema(registry).parse({
        ...startsOn(atLit),
        screenplay: {
          title: "Fixture",
          scenes: [{ id: "glow", cue: atLit, lines: [{ id: "l1", speaker: "Keeper", speakerUnitType: "Marine", text: "It's lit." }] }],
        },
      });
      const script = writeMapScript({ mapName: parsed.title, triggers: buildMissionTriggers(parsed) });
      const lights = script.slice(script.indexOf("bool gt_BeaconLights_Func"), script.indexOf("void gt_BeaconLights_Init"));
      expect(lights.indexOf("TriggerExecute(gt_BeatTwo, true, true);")).toBeGreaterThan(-1);
      expect(lights.indexOf("TriggerExecute(gt_BeatTwo, true, true);")).toBeLessThan(lights.indexOf("TransmissionSendForPlayerSelect("));
    });

    it("refuses an unknown Mechanic or a cue the Mechanic doesn't declare, at the Beat's startsWhen", () => {
      const issues = (cue: object) => missionBlueprintSchema(registry).safeParse(startsOn(cue)).error?.issues.map(({ path, message }) => ({ path, message }));
      expect(issues({ ...atLit, mechanicId: "lamp" })).toEqual([{ path: ["beats", 1, "startsWhen", 0, "mechanicId"], message: "Unknown mechanic id: lamp" }]);
      expect(issues({ ...atLit, cue: "dimmed" })).toEqual([{ path: ["beats", 1, "startsWhen", 0, "cue"], message: "Mechanic light (type beacon) has no cue dimmed (its cues: lit)" }]);
    });

    it("names the Mechanic when its cuesOf hook throws or returns something other than cue names", () => {
      expect(() => missionBlueprintSchema(registry).safeParse(startsOn(atLit, { cuesOf: "throws" }))).toThrow(
        "Mechanic mechanics.0 (light, type beacon from Plugin beacon): its cuesOf hook threw: the beacon can't count",
      );
      expect(() => missionBlueprintSchema(registry).safeParse(startsOn(atLit, { cuesOf: "bad" }))).toThrow(
        "Mechanic mechanics.0 (light, type beacon from Plugin beacon): its cuesOf hook returned [42], not a list of cue names",
      );
      expect(() => missionBlueprintSchema(registry).safeParse(startsOn(atLit, { cuesOf: "stray" }))).toThrow(
        "Mechanic mechanics.0 (light, type beacon from Plugin beacon): its cuesOf hook returned dimmed, which isn't one of its cues (lit)",
      );
    });

    it("refuses a Mechanic that never asks for what starts at its cue", () => {
      const parsed = missionBlueprintSchema(registry).parse(startsOn(atLit, { ignoresCue: true }));
      expect(() => buildMissionTriggers(parsed)).toThrow(
        "Mechanic mechanics.0 (light, type beacon from Plugin beacon): a Beat starts at its lit, but its buildTriggers hook never asked for the Beats that start there (context.cueActions or beatStarts)",
      );
    });
  });

  it("knows the behaviours a Mechanic declares its game data defines, without building that data", () => {
    const parsed = missionBlueprintSchema(registry).parse(blueprint([{ id: "light", type: "beacon", params: { zoneId: "field", withData: true } }]));
    expect(mechanicContext(parsed).knowsBehavior("BeaconGlow")).toBe(true);
    expect(mechanicContext(parsed).knowsBehavior("NoSuchGlow")).toBe(false);
    // An entry whose params don't parse declares none, and doesn't throw.
    const unparsed = { ...parsed, mechanics: [{ ...parsed.mechanics[0]!, params: { zoneId: "field", withData: "yes" } }] };
    expect(mechanicContext(unparsed, blueprintCatalog(parsed), registry).knowsBehavior("BeaconGlow")).toBe(false);
  });

  it("names the Mechanic and its Plugin when a hook throws", () => {
    const parsed = missionBlueprintSchema(registry).parse(blueprint([{ id: "light", type: "beacon", params: { zoneId: "field", explode: true } }]));
    expect(() => buildMissionTriggers(parsed)).toThrow("Mechanic mechanics.0 (light, type beacon from Plugin beacon): its buildTriggers hook threw: the beacon exploded");
  });
});
