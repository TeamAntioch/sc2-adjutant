import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";

const raw = JSON.parse(await readFile(new URL("../fixtures/trigger-test/blueprint.json", import.meta.url), "utf8")) as Record<string, unknown>;
const withTech = (tech: unknown) => MissionBlueprintSchema.parse({ ...raw, tech });
const techActions = (script: string) => script.slice(script.indexOf("bool gt_Tech_Func"), script.indexOf("void gt_Tech_Init"));

describe("a blueprint's tech", () => {
  it("adds no trigger when the blueprint restricts nothing", () => {
    expect(buildMissionTriggers(MissionBlueprintSchema.parse(raw)).triggers.map((trigger) => trigger.name)).not.toContain("Tech");
  });

  describe("disallowed at the start", () => {
    const blueprint = withTech([{ player: 1, disallow: { buildings: ["Stargate"], units: ["Phoenix"], upgrades: ["BlinkTech"] } }]);
    const doc = buildMissionTriggers(blueprint);
    const script = writeMapScript({ mapName: blueprint.title, triggers: doc });

    it("runs first at map initialization, before the Mission's and the Mechanics' own triggers", () => {
      expect(doc.triggers[0]!.name).toBe("Tech");
      expect(script).toContain("TriggerAddEventMapInit(gt_Tech);");
      expect(script.indexOf("gt_Tech_Init();")).toBeLessThan(script.indexOf("gt_MissionStart_Init();"));
    });

    it("disallows each unit, building and upgrade for its player, leaving restrictions as they are", () => {
      const actions = techActions(script);
      expect(actions).toContain('TechTreeUnitAllow(1, "Phoenix", false);');
      expect(actions).toContain('TechTreeUnitAllow(1, "Stargate", false);');
      expect(actions).toContain('TechTreeUpgradeAllow(1, "BlinkTech", false);');
      expect(actions).not.toContain("TechTreeRestrictionsEnable");
    });

    it("writes the Editor's NativeLib functions and gamelinks", () => {
      const xml = writeTriggersXml(doc);
      expect(xml).toContain('<FunctionDef Type="FunctionDef" Library="Ntve" Id="51A273F5"/>');
      expect(xml).toContain('<FunctionDef Type="FunctionDef" Library="Ntve" Id="0B0A4FBE"/>');
      expect(xml).toContain('<Value>BlinkTech</Value>\r\n        <ValueType Type="gamelink"/>\r\n        <ValueGameType Type="Upgrade"/>');
      expect(xml).toContain('<Value>Stargate</Value>\r\n        <ValueType Type="gamelink"/>\r\n        <ValueGameType Type="Unit"/>');
    });
  });

  describe("an allow list", () => {
    const blueprint = withTech([
      { player: 1, allow: { buildings: ["Nexus", "Gateway"], units: ["Probe", "Zealot"], upgrades: ["Charge"] }, disallow: { units: ["Sentry"] } },
    ]);
    const doc = buildMissionTriggers(blueprint);
    const actions = techActions(writeMapScript({ mapName: blueprint.title, triggers: doc }));

    it("turns tech restrictions on first, then allows the list, then disallows", () => {
      const enable = actions.indexOf("TechTreeRestrictionsEnable(1, true);");
      expect(enable).toBeGreaterThan(-1);
      const allows = ['TechTreeUnitAllow(1, "Probe", true);', 'TechTreeUnitAllow(1, "Zealot", true);', 'TechTreeUnitAllow(1, "Nexus", true);', 'TechTreeUnitAllow(1, "Gateway", true);', 'TechTreeUpgradeAllow(1, "Charge", true);'];
      for (const allow of allows) expect(actions.indexOf(allow)).toBeGreaterThan(enable);
      expect(actions.indexOf('TechTreeUnitAllow(1, "Sentry", false);')).toBeGreaterThan(actions.indexOf('TechTreeUpgradeAllow(1, "Charge", true);'));
    });

    it("writes Enable/Disable Tech Tree Restrictions as the Editor's NativeLib function", () => {
      const xml = writeTriggersXml(doc);
      expect(xml).toContain('<FunctionDef Type="FunctionDef" Library="Ntve" Id="12A2BFA8"/>');
      expect(xml).toContain('<Preset Type="PresetValue" Library="Ntve" Id="00000063"/>');
    });
  });

  it("restricts each player in its own calls", () => {
    const blueprint = withTech([
      { player: 1, disallow: { units: ["Phoenix"] } },
      { player: 2, allow: { units: ["Zealot"] } },
    ]);
    const actions = techActions(writeMapScript({ mapName: blueprint.title, triggers: buildMissionTriggers(blueprint) }));
    expect(actions).toContain('TechTreeUnitAllow(1, "Phoenix", false);');
    expect(actions).toContain("TechTreeRestrictionsEnable(2, true);");
    expect(actions).toContain('TechTreeUnitAllow(2, "Zealot", true);');
    expect(actions).not.toContain("TechTreeRestrictionsEnable(1, true);");
  });
});
