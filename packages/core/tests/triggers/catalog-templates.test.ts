// Every core catalog primitive's Galaxy through the template engine in a map's scope, from
// placeholder arguments (#943, ADR-0025). The snapshot is what each entry's hand-written renderer
// wrote before they went: the engine wrote every one the same, and must go on doing so. The blocks'
// snapshot is the compile's whole script for a trigger holding each, as its hand-written block
// renderers wrote it (catalog-blocks-fixture.ts).
import { describe, expect, it } from "vitest";

import type { GuiCall } from "../../src/domain/library-interface.js";
import { callGalaxy, type EnclosingCall, gameTriggerLibraries, reachableBitsPreset, reachablePresetValue, type TemplateScope } from "../../src/mods/library-galaxy.js";
import { KeptGalaxyRenderer } from "../../src/triggers/kept-trigger-galaxy.js";
import { CORE_PRIMITIVES, type FunctionDef, NTVE_FUNCTIONS, NTVE_PRESETS, SUB_FUNCTIONS } from "../../src/triggers/trigger-catalog.js";
import { readTriggersFile } from "../../src/triggers/triggers-file.js";
import type { ParamValue, Trigger, TriggerCall, TriggerParam, TriggerVariable } from "../../src/triggers/trigger-model.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { blocksDocument } from "./catalog-blocks-fixture.js";

const TRIGGER = "gt_Test";
/** The Pick Each a Picked Unit sits in, and the loop variable the Editor names after it. */
const PICK: EnclosingCall = { call: { id: "0000P1CK" }, identifier: "PickEachUnitInGroup" };

/** A placeholder argument: its name, marked where it is a reference to a unit. */
const arg = (name: string, unitRef: boolean): string => (unitRef ? `ref<${name}>` : `<${name}>`);

/** A call to `def`, each parameter a variable standing for its placeholder. */
const callTo = (def: FunctionDef): GuiCall => ({
  id: "0000C0DE",
  function: `${def.library}/${def.id}`,
  params: Object.entries(def.params).map(([name, param]) => ({ id: name, def: `${def.library}/${param.id}`, variable: name })),
});

/** The map's scope, every value written as its placeholder. */
const scope = (): TemplateScope => ({
  ...new KeptGalaxyRenderer(readTriggersFile(""), new Map(), CORE_PRIMITIVES).templateScope(TRIGGER),
  own: {
    value: (value, unitRef) => arg(value.id ?? "?", unitRef),
    expression: () => "<nested>",
    statement: () => ["<nested>;"],
  },
});

/** The Galaxy of a call to `def`, inside a Pick Each: as a statement (an action's) or an expression. */
const fromTemplate = (def: FunctionDef): string => callGalaxy(scope(), callTo(def), { as: def.kind === "action" ? "statement" : "expression", enclosing: [PICK] }).join("\n");

const libraries = gameTriggerLibraries();
const inData = (key: string): boolean => {
  const [library, id] = key.split("/");
  return libraries[library!]?.functions[id!] !== undefined;
};

const functions = [...CORE_PRIMITIVES.functions].filter(([, def]) => !def.block);

describe("core's catalog through the templates", () => {
  it("holds only functions the game's library data defines, but for VCMI's, which the data doesn't hold yet (#951)", () => {
    expect(functions.filter(([key]) => !inData(key)).map(([key]) => key)).toEqual(["VCMI/3F2DAB19", "VCMI/CA780963"]);
  });

  it.each(functions.filter(([key]) => inData(key)))("writes %s from its template as its hand-written renderer did", (_key, def) => {
    expect(fromTemplate(def)).toMatchSnapshot();
  });

  it("writes every block, nested, as the compile's hand-written block renderers did", () => {
    expect(writeMapScript({ mapName: "Blocks", triggers: blocksDocument({ F: NTVE_FUNCTIONS, P: NTVE_PRESETS, S: SUB_FUNCTIONS }) })).toMatchSnapshot();
  });

  // As the registry asks of a Plugin's (registry.ts), so a Plugin that declares one of core's as core does still loads.
  it("gives each entry written from its template the parameter ids the data gives its function", () => {
    const mismatched = [...CORE_PRIMITIVES.functions]
      .filter(([key, def]) => !def.galaxy && inData(key))
      .filter(([key, def]) => {
        const [library, id] = key.split("/");
        const ids = Object.values(def.params).map((param) => param.id).sort();
        return JSON.stringify(ids) !== JSON.stringify([...libraries[library!]!.functions[id!]!.params].sort());
      })
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it("leaves Galaxy of its own only to the entries the data doesn't hold", () => {
    expect(functions.filter(([, def]) => def.galaxy !== undefined).map(([key]) => key)).toEqual(["VCMI/3F2DAB19", "VCMI/CA780963"]);
  });

  // A preset of the "element" form names a preset type of bits: its value with none set is 0.
  it.each([...CORE_PRIMITIVES.presets].filter(([key]) => !key.startsWith("VCMI/")))("gives the preset %s the value the game's library data does", (key, def) => {
    expect(def.form === "element" ? (reachableBitsPreset({ libraries }, key) ? "0" : undefined) : reachablePresetValue({ libraries }, key)).toBe(def.galaxy);
  });
});

describe("the compile's map script, where a template's call isn't written as the Editor would", () => {
  const S = SUB_FUNCTIONS;
  const count: TriggerVariable = { id: "CCCC0011", name: "count", type: "int", initial: { id: "CCCC0012", value: { kind: "int", value: 0 } } };
  const units: TriggerVariable = { id: "CCCC0013", name: "units", type: "unitgroup", initial: { id: "CCCC0014", value: { kind: "preset", preset: NTVE_PRESETS.noUnit } } };
  const param = (id: string, value: ParamValue): TriggerParam => ({ id, value });
  const wait: TriggerCall = {
    id: "2000000A",
    def: NTVE_FUNCTIONS.wait,
    params: { time: param("2000000B", { kind: "fixed", value: 1 }), timeType: param("2000000C", { kind: "preset", preset: NTVE_PRESETS.timeGame }) },
  };
  /** A Pick Each over a group, holding a Wait: its template declares variables of its own. */
  const pickEach = (): TriggerCall => ({
    id: "20000001",
    def: NTVE_FUNCTIONS.pickEachUnitInGroup,
    params: { group: param("20000002", { kind: "variable", variable: units }) },
    blocks: [{ type: S.pickEachActions, calls: [wait] }],
  });
  const script = (trigger: Partial<Trigger>, variables: readonly TriggerVariable[] = [count, units]): string =>
    writeMapScript({ mapName: "Refusals", triggers: { variables, triggers: [{ id: "DDDD0011", name: "Test", events: [], actions: [], ...trigger }] } });

  // No function of the game's that gives a value declares variables of its own, so no Editor save
  // shows a condition's, an event's or a global's (460 saves in the game-data mirror and sc2-research).
  it("refuses a condition whose template declares variables", () => {
    expect(() => script({ conditions: [pickEach()] })).toThrow("The Galaxy of the trigger gt_Test can't be written: a condition, whose template declares variables, which no Editor save shows");
  });

  it("refuses an event whose template declares variables, since an event is written in _Init", () => {
    expect(() => script({ events: [pickEach()] })).toThrow("The Galaxy of the trigger gt_Test can't be written: an event, whose template declares variables, which no Editor save shows");
  });

  it("refuses a global's initial value whose template declares variables", () => {
    const group: TriggerVariable = { ...units, initial: { id: "CCCC0015", value: { kind: "call", call: pickEach() } } };
    expect(() => script({}, [group])).toThrow("The Galaxy of the map script can't be written: the initial value of gv_units, whose template declares variables, which no Editor save shows");
  });

  it("refuses a call to a primitive with Galaxy of its own that holds calls in blocks, which that Galaxy would drop", () => {
    const own: FunctionDef = { library: "Ntve", id: "BEAC0001", kind: "action", params: {}, galaxy: () => "BeaconRing()" };
    expect(() => script({ actions: [{ id: "20000001", def: own, params: {}, blocks: [{ type: S.then, calls: [wait] }] }] })).toThrow(
      "The Galaxy of the trigger gt_Test can't be written: its call 20000001 to Ntve/BEAC0001 holds calls in blocks, which its own galaxy doesn't write",
    );
  });

  it("names the trigger, not a library function, when the template engine refuses a call", () => {
    const empty: TriggerCall = { id: "20000001", def: NTVE_FUNCTIONS.ifThenElse, params: {}, blocks: [{ type: S.then, calls: [wait] }] };
    expect(() => script({ actions: [empty] })).toThrow(/^The Galaxy of the trigger gt_Test can't be written: its IfThenElse 20000001 has no enabled conditions/);
  });

  it("writes a Switch on a variable, its value's variable declared of the variable's type", () => {
    const caseDef: FunctionDef = { library: "Ntve", id: "3A1227AB", kind: "action", params: { value: { id: "9A8F1093" } } };
    const switchOn: TriggerCall = {
      id: "20000001",
      def: NTVE_FUNCTIONS.switch,
      params: { value: param("20000002", { kind: "variable", variable: count }) },
      blocks: [
        {
          type: { library: "Ntve", id: "AD43BC93" },
          calls: [{ id: "20000003", def: caseDef, params: { value: param("20000004", { kind: "int", value: 2 }) }, blocks: [{ type: { library: "Ntve", id: "363CE97C" }, calls: [wait] }] }],
        },
      ],
    };
    const written = script({ actions: [switchOn] });
    expect(written).toContain(["    // Automatic Variable Declarations", "    int auto20000001_val;", ""].join("\r\n"));
    expect(written).toContain(["    auto20000001_val = gv_count;", "    if (auto20000001_val == 2) {", "        Wait(1.0, c_timeGame);", "    }"].join("\r\n"));
  });
});
