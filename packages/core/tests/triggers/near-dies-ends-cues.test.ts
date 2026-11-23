// Cues on a unit nearing another, on a player's structures of a type dying, and on an encounter's
// end: the `cinematic` fixture Workspace's Radio Field with two Marines, a raider and a Supply
// Depot. The compiled map's MapScript.galaxy is read back.
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
  "",
  "## Scene 3: LATER",
  "",
  "**NOVA** `D-01-01-03-001-NOVA`: Still here.",
  "",
  "## Scene 4: AFTER",
  "",
  "**NOVA** `D-01-01-04-001-NOVA`: Gone.",
  "",
].join("\n");

const unit = (id: string, x: number, unitType = "Marine", player = 1) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), zoneId: "near", kind: "unit", unitType, player, position: { x, y: 10, z: 0 }, rotation: 0 });
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
  blueprint.anchors = [unit("nova", 10), unit("raynor", 14), unit("raider", 20, "Zealot", 2)];
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
const SCENE = (number: number) => `SoundLink("radio_field-${number}-1", -1)`;

describe("a cue on a unit nearing an Anchor", () => {
  it("fires once when the Anchor's unit comes within the distance of the target's, keeping the unit neared", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "anchorNears", anchorId: "nova", targetId: "raynor", distance: 10 } });
    });
    // The target's unit comes into range of the Anchor's: either may move.
    expect(init(script, "CueNovaWithin10OfRaynor")).toMatch(/TriggerAddEventUnitRange\(gt_CueNovaWithin10OfRaynor, UnitRefFromUnit\(UnitFromId\(\d+\)\), UnitFromId\(\d+\), 10\.0, true\);/);
    const cue = section(script, "CueNovaWithin10OfRaynor");
    expect(cue).toContain("TriggerEnable(TriggerGetCurrent(), false);");
    expect(cue).toContain("gv_cue_unit_nova_nears_raynor_10 = EventUnit();");
    expect(cue.indexOf(SCENE(2))).toBeGreaterThan(cue.indexOf("gv_cue_unit_nova_nears_raynor_10 = EventUnit();"));
  });
});

describe("a cue on a unit nearing a unit type", () => {
  it("fires on the first of the player's units of that type the Anchor's unit comes near, and keeps it", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "anchorNears", anchorId: "raider", unitType: "SupplyDepot", player: 1, distance: 7.5 } });
    });
    const name = "CueRaiderWithin7_5OfPlayer1SupplyDepot";
    expect(init(script, name)).toMatch(new RegExp(`TriggerAddEventUnitRange\\(gt_${name}, null, UnitFromId\\(\\d+\\), 7\\.5, true\\);`));
    const cue = section(script, name);
    expect(cue).toContain('(UnitGetType(EventUnit()) == "SupplyDepot")');
    expect(cue).toContain("(UnitGetOwner(EventUnit()) == 1)");
    expect(cue).toContain("gv_cue_unit_raider_nears_player_1_supplydepot_7p5 = EventUnit();");
    expect(cue).toContain(SCENE(2));
  });

  it("keeps its unit apart from a target Anchor's whose cue would give the same name", async () => {
    const script = await compiled((blueprint) => {
      blueprint.anchors.push(unit("player-1-supplydepot", 24));
      blueprint.screenplay.script.cues.push(
        { scene: 2, cue: { type: "anchorNears", anchorId: "raider", unitType: "SupplyDepot", player: 1, distance: 7.5 } },
        { scene: 3, cue: { type: "anchorNears", anchorId: "raider", targetId: "player-1-supplydepot", distance: 7.5 } },
      );
    });
    const kept = [...script.matchAll(/^unit (gv_cue_unit_raider_nears_\w+);/gm)].map((match) => match[1]!);
    expect(kept).toHaveLength(2);
    expect(new Set(kept).size).toBe(2);
    for (const name of kept) expect(name).toMatch(/^gv_cue_unit_raider_nears_player_1_supplydepot_7p5_[0-9a-f]{8}$/);
    expect(section(script, "CueRaiderWithin7_5OfPlayer1SupplyDepot")).toContain(`${kept[0]} = EventUnit();`);
  });

  it("is refused without a target, with two, or on an unknown Anchor or unit type", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push(
        { scene: 2, cue: { type: "anchorNears", anchorId: "nova", distance: 10 } },
        { scene: 2, cue: { type: "anchorNears", anchorId: "nova", targetId: "raynor", unitType: "SupplyDepot", player: 1, distance: 10 } },
        { scene: 2, cue: { type: "anchorNears", anchorId: "nova", targetId: "kerrigan", distance: 10 } },
        { scene: 2, cue: { type: "anchorNears", anchorId: "nova", targetId: "nova", distance: 10 } },
        { scene: 2, cue: { type: "anchorNears", anchorId: "zeratul", targetId: "raynor", distance: 10 } },
        { scene: 3, cue: { type: "anchorNears", anchorId: "nova", unitType: "Blorp", player: 1, distance: 10 } },
        { scene: 3, cue: { type: "anchorNears", anchorId: "nova", unitType: "SupplyDepot", distance: 10 } },
      );
    });
    expect(found).toContain("An anchorNears cue names its target: targetId, or unitType and player");
    expect(found).toContain("Give targetId, or unitType and player, not both");
    expect(found).toContain("Unknown unit anchor id: kerrigan");
    expect(found).toContain("An anchorNears cue's target is another unit than its Anchor's");
    expect(found).toContain("Unknown unit anchor id: zeratul");
    expect(found).toContain("Unknown unit type: Blorp");
    expect(found).toContain("A unitType target needs its player");
  });
});

describe("a cue on a player's structures of a type dying", () => {
  it("counts their deaths in one trigger, firing each cue once at its count and then turning off", async () => {
    const script = await compiled((blueprint) => {
      blueprint.screenplay.script.cues.push(
        { scene: 2, cue: { type: "structureDies", player: 1, unitType: "SupplyDepot" } },
        { scene: 3, cue: { type: "structureDies", player: 1, unitType: "SupplyDepot", count: 2 } },
      );
    });
    const name = "CuePlayer1LosesSupplyDepot";
    expect(script.match(/TriggerAddEventUnitDied\(gt_CuePlayer1LosesSupplyDepot, null\);/g)).toHaveLength(1);
    const cue = section(script, name);
    expect(cue).toContain('(UnitGetType(EventUnit()) == "SupplyDepot")');
    expect(cue).toContain("(UnitGetOwner(EventUnit()) == 1)");
    const lost = "gv_cue_structures_1_supplydepot_lost";
    expect(cue).toContain(`${lost} = (${lost} + 1);`);
    const first = cue.indexOf(`if ((${lost} == 1))`);
    const second = cue.indexOf(`if ((${lost} == 2))`);
    expect(first).toBeGreaterThan(cue.indexOf(`${lost} = (${lost} + 1);`));
    expect(cue.indexOf(SCENE(2))).toBeGreaterThan(first);
    expect(cue.indexOf(SCENE(2))).toBeLessThan(second);
    expect(cue.indexOf(SCENE(3))).toBeGreaterThan(second);
    // After the last count, nothing more: the trigger turns itself off.
    expect(cue.indexOf("TriggerEnable(TriggerGetCurrent(), false);")).toBeGreaterThan(second);
  });

  it("is refused on an unknown unit type, or one that isn't a structure", async () => {
    const found = await problems((blueprint) => {
      blueprint.screenplay.script.cues.push(
        { scene: 2, cue: { type: "structureDies", player: 1, unitType: "Blorp" } },
        { scene: 3, cue: { type: "structureDies", player: 1, unitType: "Marine" } },
      );
    });
    expect(found).toContain("Unknown unit type: Blorp");
    expect(found).toContain("Marine isn't a structure; cue on an Anchor's death (anchorDies) instead");
  });
});

describe("a cue on an encounter's end", () => {
  const encounter = (endsWhen?: object) => ({ id: "ambush", triggerZoneId: "far", attackerAnchorIds: ["raider"], ...(endsWhen ? { endsWhen } : {}) });

  it("plays once, on the first of its declared ends: a time after it starts, or damage its attackers take", async () => {
    const script = await compiled((blueprint) => {
      blueprint.encounters = [encounter({ afterSeconds: 15, damageTaken: 200 })];
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "encounterEnds", encounterId: "ambush" } });
    });
    // The encounter's start sets both ends going, without waiting.
    const start = section(script, "EncounterFar");
    expect(start).toContain("TriggerEnable(gt_EncounterDamageFar, true);");
    expect(start).toContain("TriggerExecute(gt_EncounterTimerFar, true, false);");
    const timer = section(script, "EncounterTimerFar");
    expect(timer.indexOf("TriggerExecute(gt_EncounterEndsFar, true, false);")).toBeGreaterThan(timer.indexOf("Wait(15.0, c_timeAI);"));
    // Damage to its attackers, counted from its start.
    expect(script).toContain("TriggerEnable(gt_EncounterDamageFar, false);");
    expect(init(script, "EncounterDamageFar")).toMatch(/TriggerAddEventUnitDamaged\(gt_EncounterDamageFar, UnitRefFromUnit\(UnitFromId\(\d+\)\), c_unitDamageTypeAny, c_unitDamageEither, null\);/);
    const damage = section(script, "EncounterDamageFar");
    expect(damage).toContain("gv_encounters_ambush_damage_taken = (gv_encounters_ambush_damage_taken + EventUnitDamageAmount());");
    expect(damage).toContain("if ((gv_encounters_ambush_damage_taken >= 200.0))");
    expect(damage).toContain("TriggerExecute(gt_EncounterEndsFar, true, false);");
    // The end plays once, whichever comes first.
    const ends = section(script, "EncounterEndsFar");
    expect(ends).toContain("if (!((gv_encounters_ambush_ended == false))) {");
    expect(ends).toContain("gv_encounters_ambush_ended = true;");
    expect(ends).toContain("TriggerEnable(gt_EncounterDamageFar, false);");
    expect(ends.indexOf(SCENE(4))).toBeGreaterThan(ends.indexOf("gv_encounters_ambush_ended = true;"));
    expect(section(script, "EncounterFar")).not.toContain(SCENE(4));
  });

  it("isn't compiled when no cue plays on it", async () => {
    const script = await compiled((blueprint) => {
      blueprint.encounters = [encounter({ afterSeconds: 15, damageTaken: 200 })];
    });
    expect(script).not.toContain("gt_EncounterEndsFar");
    expect(script).not.toContain("gt_EncounterTimerFar");
  });

  it("with only a time, has no damage trigger", async () => {
    const script = await compiled((blueprint) => {
      blueprint.encounters = [encounter({ afterSeconds: 15 })];
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "encounterEnds", encounterId: "ambush" } });
    });
    expect(script).not.toContain("gt_EncounterDamageFar");
    expect(section(script, "EncounterFar")).toContain("TriggerExecute(gt_EncounterTimerFar, true, false);");
  });

  it("is refused on an unknown encounter, one that declares no end, or an end with neither a time nor damage", async () => {
    const found = await problems((blueprint) => {
      blueprint.encounters = [encounter(), { ...encounter({}), id: "raid" }];
      blueprint.screenplay.script.cues.push(
        { scene: 3, cue: { type: "encounterEnds", encounterId: "nowhere" } },
        { scene: 4, cue: { type: "encounterEnds", encounterId: "ambush" } },
      );
    });
    expect(found).toContain("Unknown encounter id: nowhere");
    expect(found).toContain("Encounter ambush declares no end (endsWhen or behavior), so the cue would never fire");
    expect(found).toContain("An encounter's end needs afterSeconds, damageTaken or both");
  });
});

describe("an encounter that starts on a condition (startsWhen)", () => {
  const encounter = (startsWhen: object) => ({ id: "ambush", triggerZoneId: "far", attackerAnchorIds: ["raider"], startsWhen });

  it("starts when its Anchor enters the zone, not on any of the player's units entering", async () => {
    const script = await compiled((blueprint) => {
      blueprint.encounters = [encounter({ type: "anchorEntersZone", anchorId: "nova", zoneId: "far" })];
    });
    expect(init(script, "EncounterFar")).toMatch(/TriggerAddEventUnitRegion\(gt_EncounterFar, UnitRefFromUnit\(UnitFromId\(\d+\)\), RegionFromId\(\d+\), true\);/);
    const start = section(script, "EncounterFar");
    expect(start).not.toContain("UnitGetOwner(EventUnit())");
    expect(start).toContain("TriggerEnable(TriggerGetCurrent(), false);");
    expect(start).toMatch(/UnitIssueOrder\(UnitFromId\(\d+\), OrderTargetingPoint\(AbilityCommand\("attack", 0\), UnitGetPosition\(EventUnit\(\)\)\), c_orderQueueReplace\);/);
  });

  it("starts when its Anchor dies", async () => {
    const script = await compiled((blueprint) => {
      blueprint.encounters = [encounter({ type: "anchorDies", anchorId: "raynor" })];
    });
    expect(init(script, "EncounterFar")).toMatch(/TriggerAddEventUnitDied\(gt_EncounterFar, UnitRefFromUnit\(UnitFromId\(\d+\)\)\);/);
    expect(init(script, "EncounterFar")).not.toContain("TriggerAddEventUnitRegion");
  });

  it("starts when its Anchor is captured", async () => {
    const script = await compiled((blueprint) => {
      blueprint.encounters = [encounter({ type: "anchorCaptured", anchorId: "raynor" })];
    });
    expect(init(script, "EncounterFar")).toMatch(/TriggerAddEventUnitChangeOwner\(gt_EncounterFar, UnitRefFromUnit\(UnitFromId\(\d+\)\)\);/);
    // Captured: the unit has become player 1's, not any change of hands.
    expect(section(script, "EncounterFar")).toMatch(/\(UnitGetOwner\(UnitFromId\(\d+\)\) == 1\)/);
  });
});

describe("an encounter that ends when a data Behavior runs out (behavior)", () => {
  const encounter = (extra: object = {}) => ({ id: "ambush", triggerZoneId: "far", attackerAnchorIds: ["raider"], behavior: { anchorId: "raider", behavior: "AmbushClock" }, ...extra });

  it("adds the Behavior to the Anchor's unit at its start, whether or not a cue plays on its end", async () => {
    const script = await compiled((blueprint) => {
      blueprint.encounters = [encounter()];
    });
    expect(section(script, "EncounterFar")).toMatch(/UnitBehaviorAdd\(UnitFromId\(\d+\), "AmbushClock", UnitFromId\(\d+\), 1\);/);
    expect(script).not.toContain("gt_EncounterBehaviorFar");
  });

  it("ends, once, when the unit no longer has the Behavior or dies", async () => {
    const script = await compiled((blueprint) => {
      blueprint.encounters = [encounter()];
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "encounterEnds", encounterId: "ambush" } });
    });
    // Watched from the encounter's start, before the Behavior goes on.
    const start = section(script, "EncounterFar");
    expect(start.indexOf("TriggerEnable(gt_EncounterBehaviorFar, true);")).toBeGreaterThan(-1);
    expect(start.indexOf("TriggerEnable(gt_EncounterBehaviorFar, true);")).toBeLessThan(start.indexOf("UnitBehaviorAdd("));
    const watch = init(script, "EncounterBehaviorFar");
    expect(watch).toContain("TriggerEnable(gt_EncounterBehaviorFar, false);");
    expect(watch).toMatch(/TriggerAddEventUnitBehaviorChange\(gt_EncounterBehaviorFar, UnitRefFromUnit\(UnitFromId\(\d+\)\), "AmbushClock", c_unitBehaviorChangeDestroy\);/);
    expect(watch).toMatch(/TriggerAddEventUnitDied\(gt_EncounterBehaviorFar, UnitRefFromUnit\(UnitFromId\(\d+\)\)\);/);
    expect(section(script, "EncounterBehaviorFar")).toContain("TriggerExecute(gt_EncounterEndsFar, true, false);");
    const ends = section(script, "EncounterEndsFar");
    expect(ends).toContain("TriggerEnable(gt_EncounterBehaviorFar, false);");
    expect(ends.indexOf(SCENE(4))).toBeGreaterThan(ends.indexOf("gv_encounters_ambush_ended = true;"));
    expect(script).not.toContain("gt_EncounterTimerFar");
    // A unit already dead, or one the Behavior didn't take on, ends it at once.
    const add = start.indexOf("UnitBehaviorAdd(");
    const missing = start.indexOf('if ((UnitHasBehavior2(UnitFromId(', add);
    expect(missing).toBeGreaterThan(add);
    expect(start.slice(missing)).toMatch(/^if \(\(UnitHasBehavior2\(UnitFromId\(\d+\), "AmbushClock"\) == false\)\) \{\s*TriggerExecute\(gt_EncounterEndsFar, true, false\);/);
  });

  it("ends at once on a missing Behavior only after the scenes its start plays", async () => {
    const script = await compiled((blueprint) => {
      blueprint.encounters = [encounter()];
      blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "encounter", encounterId: "ambush" } }, { scene: 4, cue: { type: "encounterEnds", encounterId: "ambush" } });
    });
    const start = section(script, "EncounterFar");
    expect(start.indexOf(SCENE(2))).toBeGreaterThan(start.indexOf("UnitBehaviorAdd("));
    expect(start.indexOf("UnitHasBehavior2(")).toBeGreaterThan(start.indexOf(SCENE(2)));
  });

  it("ends when the last of the Behavior goes, not on one stack of several going", async () => {
    const script = await compiled((blueprint) => {
      blueprint.encounters = [encounter()];
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "encounterEnds", encounterId: "ambush" } });
    });
    const watch = section(script, "EncounterBehaviorFar");
    expect(watch).toMatch(/if \(\(UnitIsAlive\(UnitFromId\(\d+\)\) == false\)\) \{\s*TriggerExecute\(gt_EncounterEndsFar, true, false\);/);
    expect(watch).toMatch(/if \(\(UnitHasBehavior2\(UnitFromId\(\d+\), "AmbushClock"\) == false\)\) \{\s*TriggerExecute\(gt_EncounterEndsFar, true, false\);/);
    expect(watch.match(/TriggerExecute\(gt_EncounterEndsFar/g)).toHaveLength(2);
  });

  it("ends on the first of the Behavior and its declared ends", async () => {
    const script = await compiled((blueprint) => {
      blueprint.encounters = [encounter({ endsWhen: { afterSeconds: 30 } })];
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "encounterEnds", encounterId: "ambush" } });
    });
    const start = section(script, "EncounterFar");
    expect(start).toContain("TriggerEnable(gt_EncounterBehaviorFar, true);");
    expect(start).toContain("TriggerExecute(gt_EncounterTimerFar, true, false);");
  });
});

describe("an encounter's start and Behavior, checked", () => {
  it("is refused with an unknown Anchor in startsWhen or behavior, or an end cued on an encounter with no end", async () => {
    const found = await problems((blueprint) => {
      blueprint.encounters = [
        { id: "ambush", triggerZoneId: "far", attackerAnchorIds: ["raider"], startsWhen: { type: "anchorEntersZone", anchorId: "ghost", zoneId: "nowhere" }, behavior: { anchorId: "phantom", behavior: "AmbushClock" } },
        { id: "raid", triggerZoneId: "far", attackerAnchorIds: ["raider"] },
      ];
      blueprint.screenplay.script.cues.push({ scene: 4, cue: { type: "encounterEnds", encounterId: "raid" } });
    });
    expect(found).toContain("Unknown unit anchor id: ghost");
    expect(found).toContain("Unknown unit anchor id: phantom");
    expect(found).toMatch(/Unknown .*zone.* id: nowhere/i);
    expect(found).toContain("Encounter raid declares no end (endsWhen or behavior), so the cue would never fire");
  });

  it("is refused with a player beside startsWhen, which the start doesn't read", async () => {
    const found = await problems((blueprint) => {
      blueprint.encounters = [
        { id: "ambush", triggerZoneId: "far", attackerAnchorIds: ["raider"], player: 1, startsWhen: { type: "anchorDies", anchorId: "raynor" } },
        { id: "raid", triggerZoneId: "far", attackerAnchorIds: ["raider"], player: 1 },
      ];
    });
    expect(found).toContain("Encounter ambush starts on its startsWhen, so its player is never read: drop it");
    expect(found).not.toContain("Encounter raid starts");
  });
});
