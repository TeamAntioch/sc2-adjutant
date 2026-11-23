
import { describe, expect, it } from "vitest";

import { BRUTAL_ONLY, ENEMY_AI, enemyAiSettings, HARD_UP, NOT_CASUAL, REBUILD_ALWAYS, unitAi } from "../../src/ai/enemy-ai.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { expandPlacements } from "../../src/map/expand-placements.js";
import { writeObjectsXml } from "../../src/map/write-objects-xml.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function blueprint(units: string[], enemyAi?: Record<string, unknown>) {
  return MissionBlueprintSchema.parse({
    id: "ai",
    campaignId: "test",
    title: "AI",
    setting: "test",
    mapSize: { width: 64, height: 64 },
    tilesetId: "MarSara",
    zones: [{ id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) }],
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    placements: [
      { id: "camp", zoneId: "field", kind: "encounter-group", params: { at: { x: 32, y: 32 }, units, structures: ["Pylon"], defences: ["PhotonCannon"] } },
    ],
    screenplay: { title: "AI" },
    ...(enemyAi ? { enemyAi } : {}),
  });
}

describe("placed enemy units' AI settings", () => {
  it("rebuilds economy, supply and static defence, never the army, and keeps everyone out of waves", () => {
    const settings = enemyAiSettings();
    expect(unitAi(settings, "PhotonCannon").rebuild).toEqual([REBUILD_ALWAYS, REBUILD_ALWAYS, REBUILD_ALWAYS, REBUILD_ALWAYS]);
    expect(unitAi(settings, "Probe").rebuild[1]).toBe(REBUILD_ALWAYS);
    expect(unitAi(settings, "Zealot").rebuild).toEqual([0, 0, 0, 0]);
    expect(unitAi(settings, "Nexus").rebuild).toEqual([0, 0, 0, 0]);
    expect(unitAi(settings, "Zealot").waveable).toBe(false);
  });

  it("cuts Casual to two thirds of each group and adds a quarter on Hard and half on Brutal", () => {
    const { units } = expandPlacements(blueprint(["Zealot", "Zealot", "Stalker", "Stalker", "Adept", "Adept"]));
    const active = (prefix: string) => units.filter((unit) => unit.id.startsWith(`camp/${prefix}`)).map((unit) => unit.ai?.active);
    expect(active("unit/")).toEqual([undefined, undefined, undefined, undefined, NOT_CASUAL, NOT_CASUAL].map((value) => value ?? [true, true, true, true]));
    expect(active("extra/")).toEqual([HARD_UP, HARD_UP, BRUTAL_ONLY]);
    // Counts per difficulty: Casual 4, Normal 6, Hard 8, Brutal 9.
    const on = (difficulty: number) => units.filter((unit) => /\/(unit|extra)\//.test(unit.id) && unit.ai!.active[difficulty]).length;
    expect([0, 1, 2, 3].map(on)).toEqual([4, 6, 8, 9]);
  });

  it("takes the blueprint's overrides over the defaults", () => {
    const { units } = expandPlacements(blueprint(["Zealot", "Zealot", "Zealot"], { casual: { keep: 1 }, hard: { extra: 0 }, brutal: { extra: 0 }, rebuildAlways: ["Zealot"] }));
    const guards = units.filter((unit) => unit.unitType === "Zealot");
    expect(guards).toHaveLength(3);
    for (const guard of guards) expect(guard.ai).toMatchObject({ active: [true, true, true, true], rebuild: [14, 14, 14, 14] });
    expect(units.find((unit) => unit.unitType === "PhotonCannon")!.ai!.rebuild).toEqual([0, 0, 0, 0]);
    expect(enemyAiSettings({ money: { minerals: 500 } }).money).toEqual({ ...ENEMY_AI.money, minerals: 500 });
  });

  it("writes them as the Editor's unit properties, in Blizzard's order", () => {
    const xml = writeObjectsXml({
      anchors: [
        {
          id: 1,
          name: "guard",
          zoneId: "field",
          kind: "unit",
          position: { x: 1, y: 1 },
          unitType: "Zealot",
          player: 2,
          ai: { rebuild: [0, 0, 0, 0], active: HARD_UP, waveable: false },
        },
      ],
    });
    expect(xml).toContain(
      [
        '  <ObjectUnit Id="1" Position="1,1,0" Rotation="0" Scale="1,1,1" UnitType="Zealot" Player="2">',
        '    <AIRebuild Index="1" Value="0"/>',
        '    <AIRebuild Index="2" Value="0"/>',
        '    <AIRebuild Index="3" Value="0"/>',
        '    <AIRebuild Index="4" Value="0"/>',
        '    <AIActive Index="1" Value="0"/>',
        '    <AIActive Index="2" Value="0"/>',
        '    <AIFlag Index="IsUseable" Value="0"/>',
        "  </ObjectUnit>",
      ].join("\n"),
    );
  });
});

describe("enemy AI triggers", () => {
  const camp = blueprint(["Zealot", "Stalker"]);
  const galaxy = writeMapScript({ mapName: camp.title, triggers: buildMissionTriggers(camp) });
  const section = (name: string): string => galaxy.slice(galaxy.indexOf(`bool gt_${name}_Func`), galaxy.indexOf(`void gt_${name}_Init`));

  it("starts the campaign AI for the enemy with money, Casual's handicap and Brutal's upgrades", () => {
    const start = section("EnemyAIStart");
    expect(start).toContain("AICampaignStart(2);");
    expect(start).toContain("PlayerModifyPropertyInt(2, c_playerPropMinerals, c_playerPropOperSetTo, 10000);");
    expect(start).toContain("PlayerModifyPropertyInt(2, c_playerPropVespene, c_playerPropOperSetTo, 10000);");
    expect(start).toContain("PlayerModifyPropertyInt(2, c_playerPropHandicap, c_playerPropOperSetTo, libNtve_gf_DifficultyValueInt(50, 100, 100, 100));");
    expect(start).toContain('libNtve_gf_SetUpgradeLevelForPlayer(2, "ProtossGroundWeaponsLevel1", libNtve_gf_DifficultyValueInt(0, 0, 0, 1));');
  });

  it("tops the money up on AI time", () => {
    expect(galaxy).toMatch(/TriggerAddEventTimePeriodic\(gt_EnemyAIMoney, 10(\.0)?, c_timeAI\);/);
    expect(section("EnemyAIMoney")).toContain("PlayerModifyPropertyInt(2, c_playerPropMinerals, c_playerPropOperSetTo, 10000);");
  });
});
