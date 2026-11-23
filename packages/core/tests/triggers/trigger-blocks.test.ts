import { describe, expect, it } from "vitest";

import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P, SUB_FUNCTIONS } from "../../src/triggers/trigger-catalog.js";
import type { ParamValue, TriggerCall, TriggerDocument, TriggerVariable } from "../../src/triggers/trigger-model.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";

let next = 0;
const id = (): string => (0x10000000 + next++).toString(16).toUpperCase();
const call = (def: TriggerCall["def"], values: Record<string, ParamValue>, blocks?: TriggerCall["blocks"]): TriggerCall => ({
  id: id(),
  def,
  params: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { id: id(), value }])),
  ...(blocks ? { blocks } : {}),
});

const isDay: TriggerVariable = { id: "AAAA0001", name: "sun_is_day", type: "bool", initial: { id: "AAAA0002", value: { kind: "bool", value: false } } };
const window: TriggerVariable = {
  id: "AAAA0003",
  name: "sun_window",
  type: "timerwindow",
  initial: { id: "AAAA0004", value: { kind: "preset", preset: P.noTimerWindow } },
};
const seconds: TriggerVariable = { id: "AAAA0005", name: "sun_day_seconds", type: "fixed", initial: { id: "AAAA0006", value: { kind: "fixed", value: 90 } } };

const picked: ParamValue = { kind: "call", call: call(F.pickedUnit, {}) };
const pick = call(
  F.pickEachUnitInGroup,
  {
    group: {
      kind: "call",
      call: call(F.unitsInRegionMatching, {
        unitType: { kind: "preset", preset: P.anyUnitType },
        player: { kind: "int", value: 1 },
        region: { kind: "call", call: call(F.entireMap, {}) },
        filter: { kind: "unitfilter", require: [], exclude: ["Missile", "Dead", "Hidden"] },
        count: { kind: "preset", preset: P.anyAmount },
      }),
    },
  },
  [
    {
      type: SUB_FUNCTIONS.pickEachActions,
      calls: [
        call(F.ifThenElse, {}, [
          {
            type: SUB_FUNCTIONS.if,
            calls: [
              call(F.comparison, {
                left: { kind: "call", call: call(F.unitHasBehavior, { unit: picked, behavior: { kind: "gamelink", gameType: "Behavior", value: "SunHeatShield" } }) },
                operator: { kind: "preset", preset: P.compareEqual },
                right: { kind: "bool", value: false },
              }),
            ],
          },
          {
            type: SUB_FUNCTIONS.then,
            calls: [
              call(F.removeBehavior, {
                unit: { kind: "call", call: call(F.pickedUnit, {}) },
                behavior: { kind: "gamelink", gameType: "Behavior", value: "SunTethered" },
                count: { kind: "int", value: 1 },
              }),
            ],
          },
        ]),
      ],
    },
  ],
);
const doc: TriggerDocument = {
  variables: [isDay, window, seconds],
  triggers: [
    {
      id: "BBBB0001",
      name: "Sun Burns",
      events: [call(F.periodicEvent, { duration: { kind: "fixed", value: 1 }, timeType: { kind: "preset", preset: P.timeGame } })],
      conditions: [call(F.comparison, { left: { kind: "variable", variable: isDay }, operator: { kind: "preset", preset: P.compareEqual }, right: { kind: "bool", value: true } })],
      actions: [pick],
    },
  ],
};

describe("block actions", () => {
  const script = writeMapScript({ mapName: "Blocks", triggers: doc });
  const xml = writeTriggersXml(doc);

  it("declares Pick Each's auto variables and loops from the group's end, as the Editor does", () => {
    const auto = `auto${pick.id}`;
    expect(script).toContain(
      [
        "    // Automatic Variable Declarations",
        `    unitgroup ${auto}_g;`,
        `    int ${auto}_u;`,
        `    unit ${auto}_var;`,
        "",
        "    // Conditions",
      ].join("\r\n"),
    );
    expect(script).toContain(
      [
        `    ${auto}_g = UnitGroup(null, 1, RegionEntireMap(), UnitFilter(0, 0, (1 << c_targetFilterMissile), (1 << (c_targetFilterDead - 32)) | (1 << (c_targetFilterHidden - 32))), 0);`,
        `    ${auto}_u = UnitGroupCount(${auto}_g, c_unitCountAll);`,
        `    for (;; ${auto}_u -= 1) {`,
        `        ${auto}_var = UnitGroupUnitFromEnd(${auto}_g, ${auto}_u);`,
        `        if (${auto}_var == null) { break; }`,
        `        if ((UnitHasBehavior2(${auto}_var, "SunHeatShield") == false)) {`,
        `            UnitBehaviorRemove(${auto}_var, "SunTethered", 1);`,
        "        }",
        "",
        "    }",
      ].join("\r\n"),
    );
  });

  it("writes typed globals, leaving Galaxy's defaults out of InitGlobals", () => {
    expect(script).toContain("bool gv_sun_is_day;\r\nint gv_sun_window;\r\nfixed gv_sun_day_seconds;");
    expect(script).toContain("void InitGlobals () {\r\n    gv_sun_window = c_timerWindowNone;\r\n    gv_sun_day_seconds = 90.0;\r\n}");
    expect(script).toContain("TriggerAddEventTimePeriodic(gt_SunBurns, 1.0, c_timeGame);");
  });

  it("nests block calls under their parent, each marked with its sub-function", () => {
    const ifCall = pick.blocks![0]!.calls[0]!;
    const parent = xml.slice(xml.indexOf(`<Element Type="FunctionCall" Id="${pick.id}">`));
    expect(parent).toMatch(new RegExp(`<Parameter Type="Param" Id="[0-9A-F]{8}"/>\\r\\n {8}<FunctionCall Type="FunctionCall" Id="${ifCall.id}"/>`));
    expect(xml).toContain(
      `<Element Type="FunctionCall" Id="${ifCall.id}">\r\n        <FunctionDef Type="FunctionDef" Library="Ntve" Id="00000137"/>\r\n        <SubFunctionType Type="SubFuncType" Library="Ntve" Id="9441B8B5"/>`,
    );
    expect(xml).toContain('<SubFunctionType Type="SubFuncType" Library="Ntve" Id="00000003"/>');
    expect(xml).toContain('<SubFunctionType Type="SubFuncType" Library="Ntve" Id="00000004"/>');
    expect(xml).toContain("<Value>-;Missile,Dead,Hidden</Value>\r\n        <ValueType Type=\"unitfilter\"/>");
    expect(xml).toContain('<Type Value="preset"/>\r\n            <TypeElement Type="Preset" Library="Ntve" Id="00000100"/>');
  });
});
