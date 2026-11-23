import { describe, expect, it } from "vitest";

import { getStockLight } from "../../src/catalog/light-catalog.js";
import { lightXml, missionLightFields } from "../../src/map/write-lights.js";
import { CrossingBlueprintSchema, crossingRaw, crossingScript } from "../support/workspaces.js";
import { buildMissionGameData, buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";

const raw = crossingRaw;
const parsedScript = crossingScript;

/** Ashen Crossing with a retuned light, a cut into the temple, a drift and a pulse. */
const withLighting = {
  ...raw,
  lights: [{ id: "MoonDusk", from: "Monlyth", ambient: { color: [0.3, 0.32, 0.5], scale: 0.8 }, key: { scale: 0.5, direction: [0, 0, -2] }, exposure: 1.3 }],
  lighting: "MoonDusk",
  transitions: [
    { id: "enter-temple", cue: { type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "temple_gate" }, light: { to: "StarshipDark" } },
    { id: "nightfall", cue: { type: "missionStart" }, afterSeconds: 60, light: { to: "StarshipDark", seconds: 480 } },
    {
      id: "arch-quake",
      cue: { type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "rock_arch" },
      light: { to: "DominionLab02OutsideTramFlash", seconds: 0.25, back: { after: 1.5 } },
    },
  ],
};

describe("mission lights (DL-09)", () => {
  it("copies the stock light in full and turns the knobs", () => {
    const blueprint = CrossingBlueprintSchema.parse(withLighting);
    const fields = missionLightFields(blueprint.lights[0]!);
    const stock = getStockLight("Monlyth")!.fields;
    expect(Object.keys(fields)).toEqual(Object.keys(stock));
    expect(fields["ToDInfoArray/0/AmbientColor"]).toBe("0.240000,0.256000,0.400000");
    expect(Number(fields["ToDInfoArray/0/DirectionalLight/Key/ColorMultiplier"])).toBeCloseTo(Number(stock["ToDInfoArray/0/DirectionalLight/Key/ColorMultiplier"]) * 0.5, 5);
    expect(fields["ToDInfoArray/0/DirectionalLight/Key/Direction"]).toBe("0.000000,0.000000,-1.000000");
    expect(fields["ToDInfoArray/0/Param/HDRExposure"]).toBe("1.300000");
    expect(fields["ToDInfoArray/0/DirectionalLight/Fill/Color"]).toBe(stock["ToDInfoArray/0/DirectionalLight/Fill/Color"]);
  });

  it("writes CLight XML in the Editor's shape", () => {
    const xml = lightXml("Copy", getStockLight("MarSara")!.fields);
    expect(xml).toContain('<CLight id="Copy">');
    expect(xml).toContain('<ToDInfoArray index="0">');
    expect(xml).toContain('<AmbientColor value="0.525490,0.466667,0.400000"/>');
    expect(xml).toContain('<Param index="HDRExposure" value="1.500000"/>');
    expect(xml).toMatch(/<DirectionalLight index="Key">\r\n\s+<Color value="0.905882,0.768627,0.662745"\/>/);
  });

  it("puts the mission's lights in LightData.xml and points the tileset at its light", () => {
    const files = buildMissionGameData(CrossingBlueprintSchema.parse(withLighting));
    expect(files["LightData.xml"]).toContain('<CLight id="MoonDusk">');
    expect(files["TerrainData.xml"]).toContain('<Lighting value="MoonDusk"/>');
  });
});

describe("transitions (DL-09)", () => {
  const blueprint = CrossingBlueprintSchema.parse(withLighting);
  const doc = buildMissionTriggers(blueprint, { script: parsedScript });
  const script = writeMapScript({ mapName: blueprint.title, triggers: doc });
  const section = (name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));

  it("gives each transition a trigger its cue runs without waiting", () => {
    expect(doc.triggers.map((trigger) => trigger.name)).toEqual(
      expect.arrayContaining(["Transition Enter Temple", "Transition Nightfall", "Transition Arch Quake", "Zeratul Reaches Rock Arch"]),
    );
    expect(section("ZeratulReachesTempleGate")).toContain("TriggerExecute(gt_TransitionEnterTemple, true, false);");
    expect(section("MissionStart")).toContain("TriggerExecute(gt_TransitionNightfall, true, false);");
    expect(section("ZeratulReachesRockArch")).toContain("TriggerExecute(gt_TransitionArchQuake, true, false);");
  });

  it("says in Test Document what each transition changes, after its wait", () => {
    const enter = section("TransitionEnterTemple");
    expect(enter.indexOf("TriggerDebugOutput(1, ")).toBeGreaterThan(-1);
    expect(enter.indexOf("TriggerDebugOutput(1, ")).toBeLessThan(enter.indexOf('GameSetLighting("StarshipDark", 0.0);'));
    const nightfall = section("TransitionNightfall");
    expect(nightfall.indexOf("Wait(60.0, c_timeGame);")).toBeLessThan(nightfall.indexOf("TriggerDebugOutput("));
    const texts = JSON.stringify(doc);
    expect(texts).toContain("Transition enter-temple: light to StarshipDark");
    expect(texts).toContain("Transition nightfall: light to StarshipDark over 480 s");
    expect(texts).toContain("Transition arch-quake: light to DominionLab02OutsideTramFlash over 0.25 s, back after 1.5 s");
  });

  it("cuts, drifts after a wait, and pulses back to the mission's light", () => {
    expect(section("TransitionEnterTemple")).toContain('GameSetLighting("StarshipDark", 0.0);');
    const nightfall = section("TransitionNightfall");
    expect(nightfall.indexOf("Wait(60.0, c_timeGame);")).toBeLessThan(nightfall.indexOf('GameSetLighting("StarshipDark", 480.0);'));
    const quake = section("TransitionArchQuake");
    expect(quake).toContain('GameSetLighting("DominionLab02OutsideTramFlash", 0.25);');
    expect(quake.indexOf("Wait(1.5, c_timeGame);")).toBeLessThan(quake.indexOf('GameSetLighting("MoonDusk", 1.0);'));
  });

  it("rejects an unknown beat or anchor", () => {
    const issues = (transition: Record<string, unknown>): string[] => {
      const result = CrossingBlueprintSchema.safeParse({ ...withLighting, transitions: [transition] });
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(issues({ id: "t", beatId: "nope", cue: { type: "missionStart" }, light: { to: "X" } })).toEqual(["Unknown beat id: nope"]);
    expect(issues({ id: "t", cue: { type: "anchorDies", anchorId: "nobody" }, light: { to: "X" } }).length).toBeGreaterThan(0);
  });
});
