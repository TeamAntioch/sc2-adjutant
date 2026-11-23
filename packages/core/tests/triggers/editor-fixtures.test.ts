import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  NTVE_FUNCTIONS as F,
  NTVE_PRESETS as P,
  VCMI_FUNCTIONS as VF,
  VCMI_PRESETS as VP,
} from "../../src/triggers/trigger-catalog.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { keptElementSpan } from "../../src/triggers/splice-map-script.js";
import type { TriggerDocument, TriggerRef, TriggerVariable } from "../../src/triggers/trigger-model.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { triggerNameStrings, triggerTextStrings, writeStringsFile } from "../../src/triggers/write-trigger-strings.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";

const MAP_NAME = "Just Another StarCraft II Map";
const DOC_STRINGS = {
  "DocInfo/DescLong": "Completely devoid of any description whatsoever.",
  "DocInfo/DescShort": "Any",
  "DocInfo/Name": MAP_NAME,
  "MapInfo/Player00/Name": "Neutral",
  "MapInfo/Player01/Name": "Player 1",
  "MapInfo/Player02/Name": "Hostile",
};

function fixture(name: string, file: string): Promise<string> {
  return readFile(new URL(`../fixtures/editor-triggers/${name}/${file}`, import.meta.url), "utf8");
}

// Rebuilt from tests/fixtures/editor-triggers/basic using the Editor's own element IDs.
const basic: TriggerDocument = {
  variables: [],
  triggers: [
    {
      id: "40E4B031",
      name: "Melee Initialization",
      events: [{ id: "AA2F608B", def: F.mapInit, params: {} }],
      actions: [
        {
          id: "F2B482DD",
          def: F.triggerDebugOutput,
          params: {
            type: { id: "A17EA09E", value: { kind: "preset", preset: P.debugOutputTypeDefault } },
            showInGame: { id: "B80C142C", value: { kind: "preset", preset: P.debugOutputShowInGameTrue } },
            message: { id: "B24240A4", value: { kind: "text", text: "map started!" } },
          },
        },
        {
          id: "D94030F2",
          def: F.objectiveCreate,
          params: {
            description: { id: "D4945B67", value: { kind: "text", text: "" } },
            state: { id: "A56453FF", value: { kind: "preset", preset: P.objectiveStateActive } },
            show: { id: "1FC157E1", value: { kind: "preset", preset: P.objectiveShowTrue } },
            name: { id: "1062A74A", value: { kind: "text", text: "woohoo" } },
          },
        },
      ],
    },
  ],
};

const unitVariable: TriggerVariable = {
  id: "327ADAE6",
  name: "unit",
  type: "unit",
  initial: { id: "6075B7E8", value: { kind: "preset", preset: P.noUnit } },
};

// Rebuilt from tests/fixtures/editor-triggers/complex.
const complex: TriggerDocument = {
  variables: [unitVariable],
  triggers: [
    {
      id: "02C9C2F0",
      name: "dead",
      events: [
        {
          id: "26D67991",
          def: F.unitDies,
          params: { unit: { id: "D898B6FE", value: { kind: "variable", variable: unitVariable } } },
        },
      ],
      actions: [
        {
          id: "162DB872",
          def: F.gameOver,
          params: {
            player: { id: "BC887C1A", value: { kind: "int", value: 1 } },
            type: { id: "00EB8B90", value: { kind: "preset", preset: P.gameOverDefeat } },
            showDialog: { id: "E732488D", value: { kind: "preset", preset: P.gameOverShowDialogTrue } },
            showScore: { id: "9CDA1CED", value: { kind: "preset", preset: P.gameOverShowDialogTrue } },
          },
        },
      ],
    },
    {
      id: "40E4B031",
      name: "Melee Initialization",
      events: [{ id: "AA2F608B", def: F.mapInit, params: {} }],
      actions: [
        {
          id: "7A14A019",
          def: F.unitCreate,
          params: {
            count: { id: "64C284DD", value: { kind: "int", value: 1 } },
            flags: { id: "33828C24", value: { kind: "preset", preset: P.unitCreateFlagsNone } },
            player: { id: "0CBD6801", value: { kind: "int", value: 1 } },
            facing: { id: "64810AF2", value: { kind: "fixed", value: 270 } },
            unitType: { id: "0C373B6C", value: { kind: "gamelink", gameType: "Unit", value: "Marine" } },
            point: { id: "58ECC885", value: { kind: "point", objectId: 27108753 } },
          },
        },
        {
          id: "0B8C9652",
          def: F.setVariable,
          params: {
            variable: { id: "99B75CFF", value: { kind: "variable", variable: unitVariable } },
            value: {
              id: "0E0220A1",
              value: { kind: "call", call: { id: "3866DE4A", def: F.lastCreatedUnit, params: {} } },
            },
          },
        },
      ],
    },
  ],
};

const objectiveVariable: TriggerVariable = {
  id: "C7C0764E",
  name: "objective",
  type: "objective",
  initial: { id: "47EF6FF4", value: { kind: "preset", preset: P.noObjective } },
};
const objectiveTrigger: TriggerRef = { id: "C8093D15", name: "Objective" };
const ZERATUL = 1379696451;
const ZEALOT = 1621849861;

function gameOverAction(id: string, paramIds: readonly [string, string, string, string], type: typeof P.gameOverVictory) {
  return {
    id,
    def: F.gameOver,
    params: {
      player: { id: paramIds[0], value: { kind: "int", value: 1 } },
      type: { id: paramIds[1], value: { kind: "preset", preset: type } },
      showDialog: { id: paramIds[2], value: { kind: "preset", preset: P.gameOverShowDialogTrue } },
      showScore: { id: paramIds[3], value: { kind: "preset", preset: P.gameOverShowDialogTrue } },
    },
  } as const;
}

// Rebuilt from tests/fixtures/editor-triggers/transmission: our trigger-test map,
// extended in the Editor with a transmission, an objective variable and Run Trigger.
const transmission: TriggerDocument = {
  variables: [objectiveVariable],
  root: [
    { type: "Trigger", id: "C8093D15" },
    { type: "Trigger", id: "FD28B43B" },
    { type: "Variable", id: "C7C0764E" },
    { type: "Trigger", id: "EB028222" },
    { type: "Trigger", id: "C5935702" },
    { type: "Trigger", id: "85BAC6B1" },
  ],
  triggers: [
    {
      ...objectiveTrigger,
      events: [],
      actions: [
        {
          id: "7E16DDF1",
          def: F.objectiveSetState,
          params: {
            objective: { id: "276FB484", value: { kind: "variable", variable: objectiveVariable } },
            state: { id: "2C7E916B", value: { kind: "preset", preset: P.objectiveStateCompleted } },
          },
        },
      ],
    },
    {
      id: "FD28B43B",
      name: "Mission Start",
      events: [{ id: "AB536CB4", def: F.mapInit, params: {} }],
      actions: [
        {
          id: "102C7BB1",
          def: F.objectiveCreate,
          params: {
            description: { id: "C957D51C", value: { kind: "text", text: "Defeat the Zealot guarding the arena." } },
            state: { id: "E1BC1C2F", value: { kind: "preset", preset: P.objectiveStateActive } },
            show: { id: "A6633B8F", value: { kind: "preset", preset: P.objectiveShowTrue } },
            name: { id: "0E923541", value: { kind: "text", text: "Kill the Zealot" } },
          },
        },
        {
          id: "037D64DE",
          def: F.setVariable,
          params: {
            variable: { id: "05AD7C4C", value: { kind: "variable", variable: objectiveVariable } },
            value: {
              id: "672B2816",
              value: { kind: "call", call: { id: "B12E1AC7", def: F.lastCreatedObjective, params: {} } },
            },
          },
        },
      ],
    },
    {
      id: "EB028222",
      name: "Opening Transmission",
      events: [{ id: "21A49BA1", def: F.mapInit, params: {} }],
      actions: [
        {
          id: "065ACE4E",
          def: VF.sendTransmission,
          params: {
            unit: { id: "4074D48B", value: { kind: "unit", objectId: ZERATUL } },
            model: { id: "6F17E83F", value: { kind: "preset", preset: P.defaultPortraitModel } },
            speaker: { id: "4A65B758", value: { kind: "text", text: "Zeratul" } },
            wait: { id: "76ADA672", value: { kind: "preset", preset: P.dontWait } },
            portraitOption: { id: "8626331C", value: { kind: "preset", preset: VP.portraitHideAfter } },
            cueSound: { id: "CD1D530B", value: { kind: "preset", preset: VP.cueSoundDefault } },
            message: { id: "10B2D2D1", value: { kind: "text", text: "This is a message." } },
            duration: { id: "DB883E78", value: { kind: "fixed", value: 5 } },
          },
        },
        {
          id: "88E0ADBA",
          def: F.triggerExecute,
          params: {
            checkConditions: { id: "F4293501", value: { kind: "preset", preset: P.checkConditions } },
            wait: { id: "E476D387", value: { kind: "preset", preset: P.dontWait } },
            trigger: { id: "E1642C92", value: { kind: "trigger", trigger: objectiveTrigger } },
          },
        },
      ],
    },
    {
      id: "C5935702",
      name: "Victory - Zealot Dies",
      events: [
        { id: "FCC2B655", def: F.unitDies, params: { unit: { id: "1467F9F8", value: { kind: "unit", objectId: ZEALOT } } } },
      ],
      actions: [gameOverAction("37A838F7", ["992A743D", "E58AB6E0", "9E1E1E85", "107F6DC9"], P.gameOverVictory)],
    },
    {
      id: "85BAC6B1",
      name: "Defeat - Zeratul Dies",
      events: [
        { id: "B6539D36", def: F.unitDies, params: { unit: { id: "7D7E8011", value: { kind: "unit", objectId: ZERATUL } } } },
      ],
      actions: [gameOverAction("3C621BF2", ["0FEE1846", "E80EF9BF", "F5B33F0A", "60CDF160"], P.gameOverDefeat)],
    },
  ],
};

const TRIGGER_TEST_STRINGS = {
  "DocInfo/DescLong": "Kill the Zealot to win; lose if Zeratul dies.",
  "DocInfo/DescShort": "Test arena for generated triggers",
  "DocInfo/Name": "Trigger Test",
};

describe("the transmission fixture's units", () => {
  it("are the trigger-test blueprint's anchors, by their stable ids", () => {
    expect([ZERATUL, ZEALOT]).toEqual([stableObjectId("hero_zeratul"), stableObjectId("enemy_target")]);
  });
});

describe.each([
  ["basic", basic, MAP_NAME, DOC_STRINGS],
  ["complex", complex, MAP_NAME, DOC_STRINGS],
  ["transmission", transmission, "Trigger Test", TRIGGER_TEST_STRINGS],
])("Editor trigger fixture: %s", (name, doc, mapName, docStrings) => {
  it("reproduces Triggers byte-for-byte", async () => {
    expect(writeTriggersXml(doc)).toBe(await fixture(name, "Triggers"));
  });

  it("reproduces MapScript.galaxy byte-for-byte", async () => {
    expect(writeMapScript({ mapName, triggers: doc })).toBe(await fixture(name, "MapScript.galaxy"));
  });

  it("reproduces TriggerStrings.txt and GameStrings.txt", async () => {
    // readFile keeps the UTF-8 BOM, so this also checks we write one.
    expect(writeStringsFile(triggerNameStrings(doc))).toBe(await fixture(name, "TriggerStrings.txt"));
    expect(writeStringsFile({ ...docStrings, ...triggerTextStrings(doc) })).toBe(await fixture(name, "GameStrings.txt"));
  });
});

const colonists: TriggerVariable = { id: "00000020", name: "P4_COLONISTS", type: "int", initial: { id: "00000176", value: { kind: "int", value: 0 } } };
const convoyGuards: TriggerVariable = {
  id: "BAB35D6B",
  name: "ConvoyGuards",
  type: "unitgroup",
  initial: { id: "3FEF7B8B", value: { kind: "call", call: { id: "3FEF7B8C", def: F.unitGroupEmpty, params: {} } } },
};
const triggeringUnit = (id: string) => ({ kind: "call", call: { id, def: F.triggeringUnit, params: {} } }) as const;

// Rebuilt from tests/fixtures/editor-triggers/three-conditions (thanson01's "Add Convoy Marine into Unit Group"), its trigger only.
const threeConditions: TriggerDocument = {
  variables: [colonists, convoyGuards],
  triggers: [
    {
      id: "49030CDB",
      name: "Add Convoy Marine into Unit Group",
      events: [
        {
          id: "7D6C3C07",
          def: F.unitEntersRegion,
          params: {
            unit: { id: "5C64B01B", value: { kind: "preset", preset: P.anyUnit } },
            region: { id: "F3A56738", value: { kind: "region", regionId: 15, kept: true } },
            state: { id: "4514906B", value: { kind: "preset", preset: P.regionEnters } },
          },
        },
      ],
      conditions: [
        {
          id: "AE6610AC",
          def: F.comparison,
          params: {
            operator: { id: "A5BF99DF", value: { kind: "preset", preset: P.compareEqual } },
            left: {
              id: "634CE43E",
              value: {
                kind: "call",
                call: {
                  id: "DFF7C403",
                  def: F.unitGroupHasUnit,
                  params: {
                    unit: { id: "F8748995", value: triggeringUnit("699E914E") },
                    group: { id: "944A9E65", value: { kind: "variable", variable: convoyGuards } },
                  },
                },
              },
            },
            right: { id: "B2EEAB88", value: { kind: "bool", value: false } },
          },
        },
        {
          id: "28A2A80D",
          def: F.comparison,
          params: {
            left: {
              id: "E095631B",
              value: { kind: "call", call: { id: "A7564CDD", def: F.unitOwner, params: { unit: { id: "1705F8AA", value: triggeringUnit("9DD78E34") } } } },
            },
            operator: { id: "7BBEA06F", value: { kind: "preset", preset: P.compareEqual } },
            right: { id: "0F006302", value: { kind: "variable", variable: colonists } },
          },
        },
        {
          id: "B37E7191",
          def: F.comparison,
          params: {
            operator: { id: "A6B28800", value: { kind: "preset", preset: P.compareEqual } },
            left: {
              id: "ED91D050",
              value: { kind: "call", call: { id: "4BC01367", def: F.unitTypeOf, params: { unit: { id: "B9881D20", value: triggeringUnit("873543CD") } } } },
            },
            right: { id: "62F8E79E", value: { kind: "gamelink", gameType: "Unit", value: "Marine" } },
          },
        },
      ],
      actions: [
        {
          id: "CEE02B6C",
          def: F.unitGroupAdd,
          params: {
            unit: { id: "8DF4DF93", value: triggeringUnit("5E1FC507") },
            group: { id: "BF2B76DB", value: { kind: "variable", variable: convoyGuards } },
          },
        },
      ],
    },
  ],
};

describe("a compiled trigger with several conditions", () => {
  it("writes a blank line between its conditions and none after the last, as the Editor saved it", async () => {
    const section = (script: string): string => {
      const span = keptElementSpan(script, "gt_AddConvoyMarineintoUnitGroup")!;
      return script.slice(span.start, span.end).replace(/\r?\n/g, "\n");
    };

    const written = writeMapScript({ mapName: MAP_NAME, triggers: threeConditions });

    expect(section(written)).toBe(section(await fixture("three-conditions", "MapScript.galaxy")));
  });
});
