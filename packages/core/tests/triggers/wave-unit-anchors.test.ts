// A Wave's unit as a unit Anchor (#480): a unit entry's `anchorId` binds the one unit its send
// creates to an Anchor with no position. Nothing is placed for it; its unit variable is none until
// the send, so cues, conditions and trigger scenes that name it act only once it's there.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { mechanicContext } from "../../src/plugins/mechanic-context.js";
import { isWaveUnit } from "../../src/triggers/kept-ids.js";
import { waveWarnings } from "../../src/triggers/wave-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const zone = (id: string, x0: number, connections: string[], role = "path") => ({
  id,
  name: id,
  elevation: 1,
  landform: "flat",
  role,
  polygon: rect(x0, 0, x0 + 24, 48),
  connections: connections.map((toZoneId) => ({ toZoneId, type: "open" })),
});

const hero = { id: "hero", name: "Hero", zoneId: "home", kind: "unit", unitType: "Zeratul", player: 1, position: { x: 4, y: 24 } };
const warden = { id: "warden", name: "Warden", zoneId: "fort", kind: "unit", unitType: "Zealot", player: 2, position: { x: 74, y: 24 } };
/** The Raid's leader: declared like any unit Anchor, with no position. */
const leader = { id: "leader", name: "Leader", zoneId: "fort", kind: "unit", unitType: "Archon", player: 2 };

/** A Raid on the road, then home, led on its first send that goes out by the Archon bound to `leader`. */
const raid = {
  id: "raid",
  spawnZoneId: "fort",
  targetZoneIds: ["road", "home"],
  arrival: "ground",
  onlyIfPlayerHolds: "Assimilator",
  units: [
    { type: "Zealot", count: 2 },
    { type: "Archon", count: [1, 1, 1, 1], sends: "first", anchorId: "leader" },
  ],
  startsAtBeat: "siege",
  firstSeconds: 30,
  intervalSeconds: 90,
};

/** home → road → lane → fort, left to right on a 96x48 map; the fort is player 2's. */
function raw(edit: (blueprint: any) => void = () => {}): any {
  const blueprint = {
    id: "waves",
    campaignId: "test",
    title: "Waves",
    setting: "test",
    mapSize: { width: 96, height: 48 },
    zones: [zone("home", 0, ["road"], "base"), zone("road", 24, ["home", "lane"]), zone("lane", 48, ["road", "fort"]), zone("fort", 72, ["lane"], "base")],
    anchors: structuredClone([hero, warden, leader]),
    beats: [
      { id: "calm", title: "Calm", summary: "Nothing yet." },
      { id: "siege", title: "Siege", summary: "The fort sends raids.", startsWhen: [{ type: "anchorEntersZone", anchorId: "hero", zoneId: "road" }] },
    ],
    waves: [structuredClone(raid)],
    screenplay: { title: "Waves" },
  };
  edit(blueprint);
  return blueprint;
}
const parsed = (edit?: (blueprint: any) => void) => MissionBlueprintSchema.parse(raw(edit));
/** The schema's issues, as `path: message`. */
const issues = (edit: (blueprint: any) => void): string[] => {
  const result = MissionBlueprintSchema.safeParse(raw(edit));
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};
const scriptOf = (edit?: (blueprint: any) => void) => {
  const blueprint = parsed(edit);
  return writeMapScript({ mapName: blueprint.title, triggers: buildMissionTriggers(blueprint) });
};
/** The Galaxy function of one trigger, a statement per line. */
const triggerLines = (script: string, galaxyName: string): string[] => {
  const start = script.indexOf(`bool gt_${galaxyName}_Func`);
  expect(start, galaxyName).toBeGreaterThanOrEqual(0);
  return script
    .slice(start, script.indexOf("\r\n}\r\n", start))
    .split("\r\n")
    .map((line) => line.trim());
};
const inOrder = (lines: readonly string[], expected: readonly string[]): void => {
  let from = 0;
  for (const line of expected) {
    const at = lines.indexOf(line, from);
    expect(at, `${line}\nafter line ${from} of\n${lines.join("\n")}`).toBeGreaterThanOrEqual(0);
    from = at + 1;
  }
};

const LEADER = "gv_anchor_leader_unit";
const BIND = `${LEADER} = UnitGroupUnit(UnitLastCreatedGroup(), 1);`;
const NEARS = { type: "anchorNears", anchorId: "leader", unitType: "Assimilator", player: 1, distance: 10 };
const cued = (cue: object, lines: object[] = [{ id: "strike", speaker: "LEADER", speakerUnitType: "Archon", text: "You will not pass." }]) => (blueprint: any) => {
  blueprint.screenplay.scenes = [{ id: "strike", cue, lines }];
};

describe("a Wave's unit bound to a unit Anchor", () => {
  describe("its send", () => {
    it("binds the Anchor's unit to the one unit it creates, in the first send that goes out, after a skipped one too", () => {
      const script = scriptOf();
      expect(script).toContain(`unit ${LEADER};`);
      // The first send and every repeat: a send that finds no candidate held is skipped and binds nothing, so the next one does.
      for (const sender of ["Waveraid", "WaveraidRepeat"]) {
        const lines = triggerLines(script, sender);
        for (const region of [2, 1]) {
          inOrder(lines, [
            `if ((UnitGroupCount(UnitGroup("Assimilator", 1, RegionFromId(${region}), UnitFilter(0, 0, 0, (1 << (c_targetFilterUnderConstruction - 32)) | (1 << (c_targetFilterDead - 32))), 0), c_unitCountAlive) >= 1)) {`,
            "if ((gv_waveraidFirstSent == false)) {",
            'UnitCreate(libNtve_gf_DifficultyValueInt(1, 1, 1, 1), "Archon", 0, 2, Point(85.5, 8.5), 270.0);',
            BIND,
            "AIAttackWaveSend(2, 0, false);",
            "gv_waveraidFirstSent = true;",
          ]);
        }
        expect(lines.filter((line) => line === BIND)).toHaveLength(2);
      }
    });

    it("binds a unit that comes with the only send of a Wave that sends once", () => {
      const lines = triggerLines(
        scriptOf((blueprint) => {
          const [wave] = blueprint.waves;
          delete wave.intervalSeconds;
          delete wave.onlyIfPlayerHolds;
          wave.targetZoneIds = ["home"];
          wave.units[1] = { type: "Archon", count: [0, 1, 1, 1], anchorId: "leader" };
        }),
        "Waveraid",
      );
      // Set only where one is made, so a Casual send leaves it none whatever was created last.
      inOrder(lines, ['UnitCreate(libNtve_gf_DifficultyValueInt(0, 1, 1, 1), "Archon", 0, 2, Point(85.5, 8.5), 270.0);', "if ((libNtve_gf_DifficultyValueInt(0, 1, 1, 1) >= 1)) {", BIND, "AIAttackWaveSend(2, 0, false);"]);
    });

    it("leaves the Anchor's unit declared, as none, when its Wave is left out of the map, and says it never comes", () => {
      // The fort cut off from the lane: no ground route to any target.
      const edit = (blueprint: any) => {
        blueprint.zones[2].connections = [{ toZoneId: "road", type: "open" }];
        blueprint.zones[3].connections = [];
        cued(NEARS)(blueprint);
      };
      const script = scriptOf(edit);
      expect(script).toContain(`unit ${LEADER};`);
      expect(script).not.toContain(BIND);
      expect(waveWarnings(parsed(edit))).toContain(
        "Wave raid has no ground route from fort to road and has no ground route from fort to home; it is left out of the map. Anchor leader never comes, so nothing that waits on it does.",
      );
    });

    it("refuses it in a Wave the compile leaves out whatever the map: one arriving by air, or starting at a Beat that never starts", () => {
      expect(issues((blueprint) => (blueprint.waves[0].arrival = "air"))).toContain(
        "waves.0.units.1.anchorId: A unit that binds an Anchor comes in a ground Wave: a Wave arriving by air isn't compiled yet, so leader would never come",
      );
      expect(
        issues((blueprint) => {
          blueprint.beats.push({ id: "after", title: "After", summary: "Never starts." });
          blueprint.waves[0].startsAtBeat = "after";
        }),
      ).toContain("waves.0.units.1.anchorId: A unit that binds an Anchor comes in a Wave that starts in the map: beat after has no startsWhen, so leader would never come");
    });

    it("takes its player from a unit on the map in the spawn Zone, not from the Anchor it binds", () => {
      const edit = (blueprint: any) => {
        blueprint.anchors[1].player = 3;
        blueprint.anchors[2].player = 5;
      };
      expect(scriptOf(edit)).toContain('UnitCreate(libNtve_gf_DifficultyValueInt(1, 1, 1, 1), "Archon", 0, 3, Point(85.5, 8.5), 270.0);');
      expect(waveWarnings(parsed(edit))).toContain("Wave raid is player 3's, so its Archon for Anchor leader is too, not player 5's; give the Anchor player 3.");
    });

    it("says when the Anchor names another player than the Wave's, whose the unit is", () => {
      expect(waveWarnings(parsed((blueprint) => (blueprint.anchors[2].player = 3)))).toContain(
        "Wave raid is player 2's, so its Archon for Anchor leader is too, not player 3's; give the Anchor player 2.",
      );
    });
  });

  describe("an anchorNears cue on it", () => {
    it("looks for the target near it while it's alive, so it never fires before the send creates it", () => {
      const script = scriptOf(cued(NEARS));
      const name = "CueLeaderWithin10OfPlayer1Assimilator";
      expect(script).toContain(`TriggerAddEventTimePeriodic(gt_${name}, 0.25, c_timeGame);`);
      expect(script).not.toContain(`TriggerAddEventUnitRange(gt_${name}`);
      const kept = "gv_cue_unit_leader_nears_player_1_assimilator_10";
      inOrder(triggerLines(script, name), [
        `if ((UnitIsAlive(${LEADER}) == true)) {`,
        `${kept} = UnitGroupUnit(UnitGroup("Assimilator", 1, RegionCircle(UnitGetPosition(${LEADER}), 10.0), UnitFilter(0, 0, 0, (1 << (c_targetFilterDead - 32))), 0), 1);`,
        `if ((UnitIsAlive(${kept}) == true)) {`,
        "TriggerEnable(TriggerGetCurrent(), false);",
        // Not alive: dead, since only her send turns the check on.
        "else {",
        "TriggerEnable(TriggerGetCurrent(), false);",
      ]);
      expect(triggerLines(script, name).find((line) => line.startsWith("TransmissionSendForPlayerSelect("))).toContain('TransmissionSourceFromUnitType("Archon", false)');
    });

    it("measures to a target Anchor's unit while both are alive", () => {
      const script = scriptOf(cued({ type: "anchorNears", anchorId: "leader", targetId: "hero", distance: 6 }));
      inOrder(triggerLines(script, "CueLeaderWithin6OfHero"), [
        `if ((UnitIsAlive(${LEADER}) == true)) {`,
        `if ((UnitIsAlive(UnitFromId(${stableObjectId("hero")})) == true)) {`,
        `if ((DistanceBetweenPoints(UnitGetPosition(${LEADER}), UnitGetPosition(UnitFromId(${stableObjectId("hero")}))) <= 6.0)) {`,
        "TriggerEnable(TriggerGetCurrent(), false);",
        `gv_cue_unit_leader_nears_hero_6 = UnitFromId(${stableObjectId("hero")});`,
        // Either gone: off for good.
        "else {",
        "TriggerEnable(TriggerGetCurrent(), false);",
        "else {",
        "TriggerEnable(TriggerGetCurrent(), false);",
      ]);
    });

    it("starts off, and is turned on by the send that binds her, unless it has fired, so it never runs where she never comes", () => {
      const name = "CueLeaderWithin10OfPlayer1Assimilator";
      const kept = "gv_cue_unit_leader_nears_player_1_assimilator_10";
      const script = scriptOf((blueprint) => {
        cued(NEARS)(blueprint);
        blueprint.waves[0].units[1].count = [0, 1, 1, 1];
      });
      expect(script).toContain(`    TriggerEnable(gt_${name}, false);\r\n    TriggerAddEventTimePeriodic(gt_${name}, 0.25, c_timeGame);`);
      inOrder(triggerLines(script, "Waveraid"), ["if ((libNtve_gf_DifficultyValueInt(0, 1, 1, 1) >= 1)) {", BIND, `if ((${kept} == null)) {`, `TriggerEnable(gt_${name}, true);`]);
    });

    it("leaves a cue on placed units as it was, on the range event", () => {
      const script = scriptOf(cued({ type: "anchorNears", anchorId: "warden", targetId: "hero", distance: 6 }));
      expect(script).toContain(`TriggerAddEventUnitRange(gt_CueWardenWithin6OfHero, UnitRefFromUnit(UnitFromId(${stableObjectId("hero")})), UnitFromId(${stableObjectId("warden")}), 6.0, true);`);
    });
  });

  describe("an effectStarts cue on it", () => {
    it("compares the effect's caster with its variable as the event comes, so it never fires before the send creates it, and needs no bind", () => {
      const script = scriptOf(cued({ type: "effectStarts", anchorId: "leader", effectId: "LeaderStrike" }));
      const name = "CueLeaderStartsLeaderStrike";
      expect(script).toContain(`TriggerAddEventPlayerEffectUsed(gt_${name}, c_playerAny, "LeaderStrike");`);
      // An effect with no caster unit doesn't match her variable while it's still none.
      expect(script).toContain("if (!((EventPlayerEffectUsedUnit(c_effectUnitCaster) != null))) {");
      expect(script).toContain(`if (!((EventPlayerEffectUsedUnit(c_effectUnitCaster) == ${LEADER}))) {`);
      expect(script).not.toContain(`TriggerEnable(gt_${name}, true);`);
      expect(script).not.toContain(`TriggerEnable(gt_${name}, false);`);
    });
  });

  it("starts a Beat on its death, read from its variable as the event comes", () => {
    const script = scriptOf((blueprint) => blueprint.beats.push({ id: "after", title: "After", summary: "The leader falls.", startsWhen: [{ type: "anchorDies", anchorId: "leader" }] }));
    expect(script).toContain(`TriggerAddEventUnitDied(gt_BeatAfter, UnitRefFromVariable("${LEADER}"));`);
  });

  it("counts as dead, for a condition armed from a Beat, only once its send has created it", () => {
    const script = scriptOf((blueprint) => {
      blueprint.outcomes = { victory: [{ type: "anchorDies", anchorId: "leader", fromBeat: "siege" }], defeat: [] };
    });
    expect(triggerLines(script, "BeatSiegeArms")).toContain(`if ((${LEADER} != null) && (UnitIsAlive(${LEADER}) == false)) {`);
  });

  it("counts as in a Zone or captured, for a condition armed from a Beat, only once its send has created it", () => {
    const script = scriptOf((blueprint) => {
      blueprint.outcomes = {
        victory: [
          { type: "anchorEntersZone", anchorId: "leader", zoneId: "home", fromBeat: "siege" },
          { type: "anchorCaptured", anchorId: "leader", fromBeat: "siege" },
        ],
        defeat: [],
      };
    });
    const arms = triggerLines(script, "BeatSiegeArms");
    expect(arms.find((line) => line.includes("libNtve_gf_UnitInRegion"))).toMatch(new RegExp(`^if \\(\\(${LEADER} != null\\) && \\(UnitIsAlive\\(${LEADER}\\) == true\\) && `));
    expect(arms).toContain(`if ((${LEADER} != null) && (UnitGetOwner(${LEADER}) == 1)) {`);
  });

  it("speaks from the map once it's there, and from its unit type before", () => {
    const script = scriptOf(cued(NEARS, [{ id: "strike", speaker: "LEADER", speakerAnchorId: "leader", text: "You will not pass." }]));
    const lines = triggerLines(script, "CueLeaderWithin10OfPlayer1Assimilator");
    const there = lines.lastIndexOf(`if ((UnitIsAlive(${LEADER}) == true)) {`);
    expect(lines[there + 1]).toContain(`TransmissionSourceFromUnit(${LEADER}, true, false, "Talk")`);
    expect(lines[there + 2]).toBe("}");
    expect(lines[there + 3]).toBe("else {");
    expect(lines[there + 4]).toContain('TransmissionSourceFromUnitType("Archon", false)');
  });

  describe("check_workspace refuses", () => {
    it("nothing in a well-formed binding", () => {
      expect(issues(() => {})).toEqual([]);
    });

    it("a count above 1 on any difficulty", () => {
      expect(issues((blueprint) => (blueprint.waves[0].units[1].count = [1, 1, 2, 2]))).toEqual([
        "waves.0.units.1.count: A unit that binds an Anchor comes once: give it a count of at most 1 on each difficulty",
      ]);
      // One Normal count scales to 2 on Brutal.
      expect(issues((blueprint) => (blueprint.waves[0].units[1].count = 1))).toEqual([
        "waves.0.units.1.count: A unit that binds an Anchor comes once: give it a count of at most 1 on each difficulty",
      ]);
    });

    it("a unit that comes with every send of a repeating Wave", () => {
      expect(issues((blueprint) => (blueprint.waves[0].units[1].sends = "every"))).toEqual([
        'waves.0.units.1.sends: A unit that binds an Anchor comes once: give it sends: "first", or bind it in a Wave that sends once (no intervalSeconds)',
      ]);
    });

    it("a position on the bound Anchor, and none on any other", () => {
      expect(issues((blueprint) => (blueprint.anchors[2].position = { x: 80, y: 24 }))).toEqual([
        "anchors.2.position: leader is Wave raid's unit (its anchorId), which its send creates, so nothing is placed for it: leave out its position",
      ]);
      expect(issues((blueprint) => delete blueprint.waves[0].units[1].anchorId)).toEqual(["anchors.2.position: leader needs a position: only a unit Anchor a Wave's unit entry binds (its anchorId) has none"]);
    });

    it("an Anchor that isn't a compiled unit Anchor in the spawn Zone, of the unit's type and a computer player's", () => {
      expect(issues((blueprint) => (blueprint.waves[0].units[1].anchorId = "nobody"))).toContain("waves.0.units.1.anchorId: Unknown unit anchor id: nobody");
      expect(issues((blueprint) => (blueprint.anchors[2].zoneId = "lane"))).toContain("waves.0.units.1.anchorId: Anchor leader is in lane; a Wave's unit's Anchor is in its spawn zone fort");
      expect(issues((blueprint) => (blueprint.anchors[2].unitType = "Zealot"))).toEqual(["waves.0.units.1.anchorId: Anchor leader is a Zealot, but this unit is a Archon"]);
      expect(issues((blueprint) => (blueprint.anchors[2].player = 1))).toEqual(["waves.0.units.1.anchorId: Anchor leader is player 1's, but a Wave's units are a computer player's (2-14)"]);
      // Declared in full, as any unit Anchor.
      expect(issues((blueprint) => delete blueprint.anchors[2].unitType)).toEqual(["waves.0.units.1.anchorId: Anchor leader needs its unitType, Archon, as this unit's"]);
      expect(issues((blueprint) => delete blueprint.anchors[2].player)).toEqual(["waves.0.units.1.anchorId: Anchor leader needs its player, the Wave's computer player (2-14)"]);
    });

    it("a second unit binding the same Anchor", () => {
      expect(
        issues((blueprint) => {
          blueprint.waves.push({ ...structuredClone(raid), id: "again", units: [{ type: "Archon", count: [1, 1, 1, 1], anchorId: "leader" }], intervalSeconds: undefined });
        }),
      ).toEqual(["waves.1.units.0.anchorId: Another Wave unit binds leader already; an Anchor is one unit"]);
    });

    it("an encounter's attacker or Behavior on it, which must be there from the start", () => {
      const found = issues((blueprint) => {
        blueprint.encounters = [{ id: "ambush", triggerZoneId: "lane", attackerAnchorIds: ["leader"], behavior: { anchorId: "leader", behavior: "Shield" } }];
      });
      expect(found).toContain("encounters.0.attackerAnchorIds.0: leader is Wave raid's unit, which isn't there until its send creates it: a Wave's unit is the Wave's to send, not an encounter's attacker");
      expect(found).toContain("encounters.0.behavior.anchorId: leader is Wave raid's unit, which isn't there until its send creates it: the encounter's start adds the Behavior to a unit that is there");
    });

    it("a victory or objective on it when it never comes on some difficulty", () => {
      const casualOff = (blueprint: any) => (blueprint.waves[0].units[1].count = [0, 1, 1, 1]);
      expect(
        issues((blueprint) => {
          casualOff(blueprint);
          blueprint.outcomes = { victory: [{ type: "anchorDies", anchorId: "leader" }], defeat: [] };
        }),
      ).toEqual(["outcomes.victory.0.anchorId: leader is Wave raid's unit, which never comes on Casual (a count of 0), so this would never come there"]);
      // A Beat or an encounter that would never start there, unless another of a Beat's starts can come.
      const after = { id: "after", title: "After", summary: "The leader falls.", startsWhen: [{ type: "anchorDies", anchorId: "leader" }] };
      expect(
        issues((blueprint) => {
          casualOff(blueprint);
          blueprint.beats.push(after);
          blueprint.encounters = [{ id: "ambush", triggerZoneId: "lane", attackerAnchorIds: ["warden"], startsWhen: { type: "anchorEntersZone", anchorId: "leader", zoneId: "lane" } }];
        }),
      ).toEqual([
        "beats.2.startsWhen.0.anchorId: leader is Wave raid's unit, which never comes on Casual (a count of 0), so this would never come there",
        "encounters.0.startsWhen.anchorId: leader is Wave raid's unit, which never comes on Casual (a count of 0), so this would never come there",
      ]);
      expect(
        issues((blueprint) => {
          casualOff(blueprint);
          blueprint.beats.push({ ...after, startsWhen: [...after.startsWhen, { type: "anchorDies", anchorId: "warden" }] });
        }),
      ).toEqual([]);
      // Coming on every difficulty, it may be the goal.
      expect(issues((blueprint) => (blueprint.outcomes = { victory: [{ type: "anchorDies", anchorId: "leader" }], defeat: [] }))).toEqual([]);
    });

    it("no victory that another victory condition can still bring where it never comes", () => {
      expect(
        issues((blueprint) => {
          blueprint.waves[0].units[1].count = [0, 1, 1, 1];
          blueprint.outcomes = { victory: [{ type: "anchorDies", anchorId: "leader" }, { type: "anchorDies", anchorId: "warden" }], defeat: [] };
        }),
      ).toEqual([]);
    });

    it("two bound Anchors whose ids differ only in - and _, which would share a trigger variable", () => {
      expect(
        issues((blueprint) => {
          blueprint.anchors[2].id = "the-leader";
          blueprint.waves[0].units[1].anchorId = "the-leader";
          blueprint.anchors.push({ ...structuredClone(leader), id: "the_leader" });
          blueprint.waves.push({ ...structuredClone(raid), id: "again", units: [{ type: "Archon", count: [1, 1, 1, 1], anchorId: "the_leader" }], intervalSeconds: undefined });
        }),
      ).toEqual(["anchors.3.id: Wave units' Anchors the-leader and the_leader differ only in - and _, which their trigger variables can't tell apart: rename one"]);
    });
  });

  it("follows an edit to a parsed Blueprint's Waves, as the next compile reads it", () => {
    const blueprint = parsed();
    expect(isWaveUnit(blueprint, "leader")).toBe(true);
    delete blueprint.waves[0]!.units[1]!.anchorId;
    expect(isWaveUnit(blueprint, "leader")).toBe(false);
  });

  it("is left out of a Mechanic's anchors, and named apart, since it isn't on the map from the start", () => {
    const context = mechanicContext(parsed());
    expect(context.anchors.map((anchor) => anchor.id)).toEqual(["hero", "warden"]);
    expect([...context.waveUnitAnchorIds]).toEqual(["leader"]);
  });
});

// A trigger scene on the `cinematic` fixture Workspace's Radio Field: a raider, bound to the unit a
// one-send Wave creates in the camp, nears player 1's Supply Depot, and the scene films, marks,
// orders and signals it.
const SCENE_2 = ["", "## Scene 2: THE RAID", "", "**NOVA** `D-01-01-02-001-NOVA`: They're at the depot.", "", "**NOVA** `D-01-01-02-002-NOVA`: And there she is.", ""].join("\n");
const SECOND = "radio_field-2-2";
const camera = { id: "cam-raid", name: "cam-raid", zoneId: "field", kind: "camera", position: { x: 20, y: 30 }, cameraTarget: { x: 20, y: 30 }, cameraValues: [{ index: "Distance", value: 20 }] };
const SCENE = {
  marks: [{ unit: "raider", at: { x: 24, y: 30 }, facing: 180 }],
  shots: [
    { camera: "cam-raid", unit: "cue", afterMs: 0, pauseAfterMs: 1000, actorEvents: [{ unit: "raider", messages: ["Signal Blink"] }] },
    { camera: "cam-raid", toUnit: { anchorId: "raider" }, line: SECOND, orders: [{ units: ["raider"], moveTo: { x: 10, y: 30 } }] },
  ],
  handback: { ping: ["raider"] },
};

async function sceneWorkspace(edit: (blueprint: any, scene: any) => void = () => {}): Promise<{ root: string; blueprintPath: string }> {
  const root = await copyOf("cinematic");
  const mission = path.join(root, "missions/radio-field");
  await appendFile(path.join(mission, "radio-field.md"), SCENE_2);
  const blueprintPath = path.join(mission, "blueprint.json");
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
  const [field] = blueprint.zones;
  blueprint.zones = [
    { ...field, polygon: rect(0, 0, 32, 64), connections: [{ toZoneId: "camp", type: "open" }] },
    { ...field, id: "camp", name: "Camp", polygon: rect(32, 0, 64, 64), connections: [{ toZoneId: "field", type: "open" }] },
  ];
  blueprint.anchors = [
    camera,
    { id: "depot", name: "Depot", zoneId: "field", kind: "unit", unitType: "SupplyDepot", player: 1, position: { x: 12, y: 30 } },
    { id: "raider", name: "Raider", zoneId: "camp", kind: "unit", unitType: "Zealot", player: 2 },
  ];
  blueprint.waves = [{ id: "strike", spawnZoneId: "camp", targetZoneIds: ["field"], arrival: "ground", units: [{ type: "Zealot", count: [1, 1, 1, 1], anchorId: "raider" }], startsAtBeat: "radio", firstSeconds: 20 }];
  blueprint.screenplay.script.cues.push({ scene: 2, cue: { type: "anchorNears", anchorId: "raider", unitType: "SupplyDepot", player: 1, distance: 10 } });
  blueprint.screenplay.script.triggerScenes = [{ id: "raid", scene: 2 }];
  const scene = structuredClone(SCENE);
  edit(blueprint, scene);
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await mkdir(path.join(mission, "trigger-scenes"), { recursive: true });
  await writeFile(path.join(mission, "trigger-scenes/raid.json"), JSON.stringify(scene));
  return { root, blueprintPath };
}

const section = (script: string, name: string): string => script.slice(script.indexOf(`bool gt_${name}_Func`), script.indexOf(`void gt_${name}_Init`));
const RAIDER = "gv_anchor_raider_unit";
const alive = `if ((UnitIsAlive(${RAIDER}) == true)) {`;

/** The compiled scene's MapScript.galaxy and Objects, and the Workspace's problems, from one copy. */
async function sceneCompiled(edit?: (blueprint: any, scene: any) => void): Promise<{ script: string; objects: string; problems: unknown[] }> {
  const { root, blueprintPath } = await sceneWorkspace(edit);
  const { problems } = await checkWorkspace(root);
  const map = path.join(await tempFolder(), "RadioField.SC2Map");
  await compileMission(await loadWorkspace(root), blueprintPath, map);
  return { script: await readFile(path.join(map, "MapScript.galaxy"), "utf8"), objects: await readFile(path.join(map, "Objects"), "utf8"), problems };
}

describe("a trigger scene on a Wave's unit", () => {
  it("passes the Workspace's checks, with only notes and taste reviews left", async () => {
    const { problems } = await sceneCompiled();
    expect(problems.filter((problem) => !["note", "review"].includes((problem as { severity?: string }).severity ?? ""))).toEqual([]);
  });

  it("places nothing for its Anchor, and binds it as the send creates it", async () => {
    const { script, objects } = await sceneCompiled();
    expect(objects).toContain(`Id="${stableObjectId("depot")}"`);
    expect(objects).not.toContain(`Id="${stableObjectId("raider")}"`);
    expect(script).not.toContain(`UnitFromId(${stableObjectId("raider")})`);
    expect(section(script, "Wavestrike")).toContain(`${RAIDER} = UnitGroupUnit(UnitLastCreatedGroup(), 1);`);
  });

  it("aims the camera at it only while it's alive", async () => {
    const { script } = await sceneCompiled();
    const cinematic = section(script, "TriggerSceneRaidCinematic");
    const pan = cinematic.indexOf(`CameraPan(1, UnitGetPosition(${RAIDER})`);
    expect(pan).toBeGreaterThan(0);
    expect(cinematic.lastIndexOf(alive, pan)).toBeGreaterThan(cinematic.lastIndexOf("CameraApplyInfo(", pan));
  });

  it("marks it, orders it and sends it actor messages, each only while it's alive", async () => {
    const { script } = await sceneCompiled();
    for (const action of [`UnitSetPosition(${RAIDER}, Point(24.0, 30.0), false);`, `UnitIssueOrder(${RAIDER}, OrderTargetingPoint(AbilityCommand("move", 0), Point(10.0, 30.0)), c_orderQueueReplace);`, `libNtve_gf_SendActorMessageToUnit(${RAIDER}, "Signal Blink");`]) {
      const at = script.indexOf(action);
      expect(at, action).toBeGreaterThan(0);
      expect(script.lastIndexOf(alive, at), action).toBeGreaterThan(0);
    }
  });

  it("gives it a unit change or a lasting actor message only once it's there, and counts it given only then, so the Cleanup gives what it missed", async () => {
    const { script } = await sceneCompiled((_blueprint, scene) => {
      scene.shots[0].unitChanges = [{ unit: "raider", owner: 1 }];
    });
    const cinematic = section(script, "TriggerSceneRaidCinematic");
    for (const [action, record] of [
      [`UnitSetOwner(${RAIDER}, 1, true);`, "unit_change_1_1 = true;"],
      [`libNtve_gf_SendActorMessageToUnit(${RAIDER}, "Signal Blink");`, "actor_event_1_1 = true;"],
    ] as const) {
      const at = cinematic.indexOf(action);
      expect(at, action).toBeGreaterThan(0);
      expect(cinematic.lastIndexOf(alive, at), action).toBeGreaterThan(0);
      // Recorded inside the alive block, before it closes.
      const closes = cinematic.indexOf("\r\n    }\r\n", at);
      expect(closes, action).toBeGreaterThan(at);
      expect(cinematic.slice(at, closes), action).toContain(record);
    }
  });

  it("pauses it for the scene only while it's alive", async () => {
    const { script: pausedScript } = await sceneCompiled((_blueprint, scene) => {
      delete scene.shots[1].orders;
      scene.live = [{ unit: "raider", pause: true }];
    });
    const at = pausedScript.indexOf(`UnitGroupAdd(gv_trigger_scene_raid_paused_units, ${RAIDER});`);
    expect(at).toBeGreaterThan(0);
    // Alive first, then paused unless it was already.
    expect(pausedScript.slice(pausedScript.lastIndexOf(alive, at), at)).toContain(`if ((libNtve_gf_UnitIsPaused(${RAIDER}) == false)) {`);
  });

  it("is refused as a builder, which the build waits on", async () => {
    const { root } = await sceneWorkspace((_blueprint, scene) => {
      scene.shots[1].builds = [{ unit: "raider", unitType: "Pylon", ability: "ProtossBuild", at: { x: 20, y: 20 } }];
    });
    const { problems } = await checkWorkspace(root);
    expect(problems.map((problem) => `${problem.path}: ${problem.message}`)).toContain(
      "shots.1.builds.0.unit: raider is a Wave's unit, which isn't there until its send creates it; build with a unit that is there from the start, or a warp-in",
    );
  });

  it("pings it on the handback only while it's alive", async () => {
    const { script } = await sceneCompiled();
    const ping = script.indexOf(`MinimapPing(PlayerGroupAll(), UnitGetPosition(${RAIDER})`);
    expect(ping).toBeGreaterThan(0);
    expect(script.lastIndexOf(alive, ping)).toBeGreaterThan(script.lastIndexOf("\r\n}\r\n", ping));
  });
});
