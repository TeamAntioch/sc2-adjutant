// A trigger holding each block core's catalog has (If Then Else with and without an Else, Pick
// Each with Picked Unit, While, Wait For Condition, nested), and events whose units are and aren't
// references, built from a given copy of the catalog: the compile wrote it with its hand-written
// block renderers before #943, and writes it from the templates now (catalog-templates.test.ts).
import type { NTVE_FUNCTIONS, NTVE_PRESETS, SUB_FUNCTIONS } from "../../src/triggers/trigger-catalog.js";
import type { ParamValue, TriggerCall, TriggerDocument, TriggerVariable } from "../../src/triggers/trigger-model.js";

type Catalog = { readonly F: typeof NTVE_FUNCTIONS; readonly P: typeof NTVE_PRESETS; readonly S: typeof SUB_FUNCTIONS };

export function blocksDocument({ F, P, S }: Catalog): TriggerDocument {
  let next = 0;
  const id = (): string => (0x20000000 + next++).toString(16).toUpperCase();
  const call = (def: TriggerCall["def"], values: Record<string, ParamValue>, blocks?: TriggerCall["blocks"]): TriggerCall => ({
    id: id(),
    def,
    params: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { id: id(), value }])),
    ...(blocks ? { blocks } : {}),
  });
  const flag: TriggerVariable = { id: "CCCC0001", name: "gate_open", type: "bool", initial: { id: "CCCC0002", value: { kind: "bool", value: false } } };
  const hero: TriggerVariable = { id: "CCCC0003", name: "hero", type: "unit", initial: { id: "CCCC0004", value: { kind: "preset", preset: P.noUnit } } };
  const isOpen = (open: boolean): TriggerCall => call(F.comparison, { left: { kind: "variable", variable: flag }, operator: { kind: "preset", preset: P.compareEqual }, right: { kind: "bool", value: open } });
  const wait = (seconds: number): TriggerCall => call(F.wait, { time: { kind: "fixed", value: seconds }, timeType: { kind: "preset", preset: P.timeGame } });
  const picked = (): ParamValue => ({ kind: "call", call: call(F.pickedUnit, {}) });
  const units: ParamValue = {
    kind: "call",
    call: call(F.unitsInRegionMatching, {
      unitType: { kind: "preset", preset: P.anyUnitType },
      player: { kind: "int", value: 1 },
      region: { kind: "call", call: call(F.entireMap, {}) },
      filter: { kind: "unitfilter", require: [], exclude: ["Dead"] },
      count: { kind: "preset", preset: P.anyAmount },
    }),
  };
  const actions: TriggerCall[] = [
    call(F.ifThenElse, {}, [
      { type: S.if, calls: [isOpen(true), isOpen(false)] },
      { type: S.then, calls: [wait(1)] },
      { type: S.else, calls: [wait(2), call(F.setVariable, { variable: { kind: "variable", variable: flag }, value: { kind: "bool", value: true } })] },
    ]),
    call(F.pickEachUnitInGroup, { group: units }, [
      {
        type: S.pickEachActions,
        calls: [
          call(F.ifThenElse, {}, [
            { type: S.if, calls: [call(F.comparison, { left: { kind: "call", call: call(F.unitIsAlive, { unit: picked() }) }, operator: { kind: "preset", preset: P.compareEqual }, right: { kind: "bool", value: true } })] },
            { type: S.then, calls: [call(F.unitKill, { unit: picked() })] },
          ]),
        ],
      },
    ]),
    call(F.whileLoop, {}, [
      { type: S.whileConditions, calls: [isOpen(false)] },
      { type: S.whileActions, calls: [wait(0.5)] },
    ]),
    call(F.waitForCondition, { time: { kind: "fixed", value: 1 }, timeType: { kind: "preset", preset: P.timeGame } }, [{ type: S.waitForCondition, calls: [isOpen(true)] }]),
  ];
  return {
    variables: [flag, hero],
    triggers: [
      {
        id: "DDDD0001",
        name: "Every Block",
        events: [
          call(F.unitDies, { unit: { kind: "variable", variable: hero } }),
          call(F.unitEntersRangeOfUnit, { unit: { kind: "variable", variable: hero }, fromUnit: { kind: "unit", objectId: 7 }, range: { kind: "fixed", value: 8 }, state: { kind: "preset", preset: P.regionEnters } }),
        ],
        conditions: [isOpen(false), isOpen(true)],
        actions,
      },
    ],
  };
}
