// Every function of the game's library data (data/trigger-libraries.json) through the template
// engine (#937): a call to each, from placeholder arguments, written in a map's scope and in a mod
// library's. What the engine refuses is listed by reason, so a function the data gains, or a
// template macro or form the engine doesn't know, shows up here without a package that uses it.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { GuiBodySchema, type GuiCall, type GuiValue, LibraryFunctionSchema } from "../../src/domain/library-interface.js";
import { callGalaxy, type GameLibrary, libraryTemplateScope, type TemplateScope, UnrenderableGalaxyError } from "../../src/mods/library-galaxy.js";
import { KeptGalaxyRenderer } from "../../src/triggers/kept-trigger-galaxy.js";
import { CORE_PRIMITIVES } from "../../src/triggers/trigger-catalog.js";
import { readTriggersFile } from "../../src/triggers/triggers-file.js";

const data = JSON.parse(readFileSync(new URL("../../data/trigger-libraries.json", import.meta.url), "utf8")) as { readonly libraries: Readonly<Record<string, GameLibrary>> };

/** Literal types the engine writes from a value alone. */
const LITERALS = new Set(["int", "fixed", "bool", "string", "gamelink", "convline", "conversation", "catalogentry", "actormsg", "filepath", "userfield"]);

/** A placeholder for a parameter of `type`: a literal where the engine writes one, else a line of custom script standing for the value. */
function placeholder(type: string | undefined, identifier: string): GuiValue {
  if (type === undefined || type.startsWith("any") || type === "sameas") return { type: "int", value: "1" };
  if (LITERALS.has(type)) return { type, value: type === "bool" ? "true" : "1" };
  return { customScript: `placeholder_${identifier}` };
}

/** A condition standing in a condition slot: Triggering Trigger, which takes nothing. */
const CONDITION = "Ntve/00000217";

/** A call to `library/id`, each parameter given its placeholder, each condition slot one condition, its other slots empty. */
function callTo(library: string, id: string): GuiCall {
  const lib = data.libraries[library]!;
  const fn = lib.functions[id]!;
  // A condition slot (#SUBFUNCS(slot,"sep")) can't be empty, since `if ()` isn't Galaxy.
  const conditions = new Set([...(fn.script ?? "").matchAll(/#SUBFUNCS\((\w+),"/g)].map((match) => match[1]));
  const body = (fn.subFunctions ?? [])
    .filter((sub) => conditions.has(lib.subFunctions[sub.split("/")[1]!]))
    .map((sub, at) => ({ id: `0000E${String(at).padStart(3, "0")}`, function: CONDITION, sub }));
  return {
    id: "0000C0DE",
    function: `${library}/${id}`,
    params: fn.params.map((param, at) => ({ id: `0000F${String(at).padStart(3, "0")}`, def: `${library}/${param}`, ...placeholder(lib.params[param]?.type, lib.params[param]?.identifier ?? param) })),
    ...(body.length ? { body } : {}),
  };
}

/** Each function's refusal in `scope`, as its reason with ids taken out, and how many functions give it. */
function refusals(scope: TemplateScope): Record<string, number> {
  const found: Record<string, number> = {};
  for (const [library, lib] of Object.entries(data.libraries)) {
    for (const [id, fn] of Object.entries(lib.functions)) {
      try {
        const galaxy = callGalaxy(scope, callTo(library, id), { as: fn.flags.includes("action") ? "statement" : "expression" }).join("\n");
        // A template macro the engine passed over, written into the Galaxy as text, is a failure too.
        const leaked = /#[A-Z]+/.exec(galaxy);
        if (leaked) found[`${fn.identifier ?? id} leaks ${leaked[0]} into its Galaxy`] = 1;
      } catch (error) {
        if (!(error instanceof UnrenderableGalaxyError)) throw error;
        const reason = error.reason.replace(/\b[0-9A-F]{8}\b/g, "<id>").replace(/\(\w+\) outside a trigger/, "(<event>) outside a trigger");
        found[reason] = (found[reason] ?? 0) + 1;
      }
    }
  }
  return found;
}

const mapScope = (): TemplateScope => new KeptGalaxyRenderer(readTriggersFile(""), new Map(), CORE_PRIMITIVES).templateScope("gt_Test");
const libraryScope = (): TemplateScope =>
  libraryTemplateScope(
    { library: "Test", functions: new Map(), elements: new Map(), strings: new Map() },
    LibraryFunctionSchema.parse({ id: "0000AAAA", name: "Test", kind: "action", gui: "library/Test.json" }),
    GuiBodySchema.parse({}),
  );

/** What either scope refuses, by reason, with how many functions: forms the engine doesn't write yet (#937), and gaps in the data. */
const KNOWN: Readonly<Record<string, number>> = {
  // The data names no identifier for these, so no Galaxy name.
  "it calls Ntve/<id>, which has no identifier": 44,
  // Macros the engine doesn't fill in yet.
  "libNtve_gf_SkipRemaining's template uses #DEFRETURN, which this doesn't write yet": 1,
  "libNtve_gf_Continue's template uses #SMARTCONTINUE, which this doesn't write yet": 1,
  "libNtve_gf_ConvertPresetToIdentifier's template uses #PRESETIDENT, which this doesn't write yet": 1,
  // A slot as `#SUBFUNCS(actions);`, a statement line with a semicolon after it, which no Editor save shows.
  "libNtve_gf_PickEachPlayerInGroupDeprecated's template uses #SUBFUNCS in a form this doesn't write yet": 1,
  // Operators and a block with no template the engine knows.
  "it calls the operator Ntve/<id> (AndOr), which this doesn't write yet": 1,
  "it calls the operator Ntve/<id> (ArithmeticInt2), which this doesn't write yet": 1,
  "it calls the block Ntve/<id> (RegisterEvents), which has no template this can write it from": 1,
  // Templates the data doesn't match: a slot it lacks (Ntve/18B03961), a parameter its definition calls conversationLine.
  "libNtve_gf_ForEachSetBitInBitMask's template names a slot Actions it doesn't have": 1,
  "libNtve_gf_TransmissionCommentConversation's template names a parameter sound it doesn't have": 1,
  // Placeholders a call can't stand on: these name an enclosing block's variable, and Custom Script is its own text.
  "libNtve_gf_SwitchCase names its parent's variable, but sits in no block": 1,
  "libNtve_gf_IntLoopCurrent names the variable of a PickEachInteger it doesn't sit in": 1,
  "libNtve_gf_PlayerGroupLoopCurrent names the variable of a PickEachPlayerInGroup it doesn't sit in": 1,
  "libNtve_gf_UnitGroupLoopCurrent names the variable of a PickEachUnitInGroup it doesn't sit in": 1,
  "its custom script <id> is empty, whose Galaxy this doesn't write yet": 1,
};

describe("a call to every function of the game's library data", () => {
  it("is written in a map's scope, but for the known refusals and an event's unit given as anything but a variable, which a map's own writer writes", () => {
    expect(refusals(mapScope())).toEqual({ ...KNOWN, "a unit an event takes that isn't a variable's, whose Galaxy this doesn't write yet": 40 });
  });

  it("is written in a mod library's scope, but for the known refusals and events, which only a trigger binds", () => {
    expect(refusals(libraryScope())).toEqual({ ...KNOWN, "it calls the event Ntve/<id> (<event>) outside a trigger": 112 });
  });
});

describe('an operator over a repeated value (#PARAM(val," " #PARAM(op) " "))', () => {
  /** A call to `fn` given `values` for its repeated parameter `val` and the preset `opValue` for `op`. */
  const multiple = (fn: string, val: string, op: string, opValue: string, values: readonly string[]): GuiCall => ({
    id: "0000C0DE",
    function: fn,
    params: [...values.map((text, at) => ({ id: `0000F${String(at).padStart(3, "0")}`, def: val, customScript: text })), { id: "0000FFFF", def: op, preset: opValue }],
  });

  it("joins its values with its operator, as Editor-saved Galaxy has an Arithmetic (Integer) Multiple", () => {
    // The game's challenges mod, LibChal.galaxy: (libChal_gv_cHLC_VICTORYPANELWAVEPANEL_Y + libChal_gv_cHLC_VICTORYPANELSCORE_HEIGHT + 80)
    const call = multiple("Ntve/00000126", "Ntve/00000202", "Ntve/00000201", "Ntve/00000085", ["lv_y", "lv_height", "80"]);

    expect(callGalaxy(libraryScope(), call, { as: "expression" })).toEqual(["(lv_y + lv_height + 80)"]);
  });

  it("joins its values with its operator, as Editor-saved Galaxy has an And/Or Multiple", () => {
    // Liberty's tstory01: return ((… == ge_ActorType_BackgroundWithFidget) || (… == ge_ActorType_MainWithFidget));
    const call = multiple("Ntve/00000134", "Ntve/00000218", "Ntve/00000217", "Ntve/00000090", ["lv_a", "lv_b"]);

    expect(callGalaxy(libraryScope(), call, { as: "expression" })).toEqual(["(lv_a || lv_b)"]);
  });
});

describe("a template variable typed by a map variable's value (#INITAUTOVAR of Switch's value)", () => {
  /** A map whose variable 0000AAAA is of the game's preset type ArithmeticOp (Ntve/00000027), its base int. */
  const scope = (): TemplateScope =>
    new KeptGalaxyRenderer(
      readTriggersFile(
        [
          "<TriggerData>",
          '    <Element Type="Variable" Id="0000AAAA">',
          "        <VariableType>",
          '            <Type Value="preset"/>',
          '            <TypeElement Type="Preset" Library="Ntve" Id="00000027"/>',
          "        </VariableType>",
          "    </Element>",
          "</TriggerData>",
        ].join("\r\n"),
      ),
      new Map([["Variable/0000AAAA", "Op"]]),
      CORE_PRIMITIVES,
    ).templateScope("gt_Test");
  const switchOn = (variable: string): GuiCall => ({ id: "0000C0DE", function: "Ntve/91C49196", params: [{ id: "0000F000", def: "Ntve/B4ACF12A", variable }] });

  it("is of the preset's base type, the variable's preset kept with its type", () => {
    const autos: string[] = [];
    callGalaxy(scope(), switchOn("0000AAAA"), { as: "statement", autos });

    expect(autos).toEqual(["int auto0000C0DE_val;"]);
  });

  it("is refused for a library's variable, whose type the map doesn't hold", () => {
    expect(() => callGalaxy(scope(), switchOn("Camp/E9E50921"), { as: "statement" })).toThrow("libNtve_gf_Switch's #INITAUTOVAR of value, whose anycompare type this can't tell from the value given");
  });
});

describe("a block written from its template", () => {
  it("is refused when it holds a statement in a slot its template doesn't write, rather than dropping it", () => {
    // An Action Queue writes only its Actions slot; a Wait in an If Then Else's Then slot has nowhere to go.
    const call: GuiCall = {
      id: "0000C0DE",
      function: "Ntve/74DFFAD8",
      body: [{ id: "0000BEEF", function: "Ntve/00000242", sub: "Ntve/00000004", params: [] }],
    };

    expect(() => callGalaxy(libraryScope(), call, { as: "statement" })).toThrow("its call 0000C0DE to libNtve_gf_ActionQueueAdd holds 0000BEEF in a slot Ntve/00000004 its template doesn't write");
  });

  it("is refused when it holds a statement in a slot its template only tests (#IFHAVESUBFUNCS) and never writes", () => {
    const fn = LibraryFunctionSchema.parse({ id: "0000BBBB", name: "Guarded", kind: "action", script: "#IFHAVESUBFUNCS(actions,Wait(1.0, c_timeGame);)", subFunctions: [{ id: "0000BBBC", name: "Actions" }] });
    const scope = libraryTemplateScope({ library: "Test", functions: new Map([["0000BBBB", { fn }]]), elements: new Map(), strings: new Map() }, fn, GuiBodySchema.parse({}));
    const call: GuiCall = { id: "0000C0DE", function: "Test/0000BBBB", body: [{ id: "0000BEEF", function: "Ntve/00000242", sub: "Test/0000BBBC", params: [] }] };

    expect(() => callGalaxy(scope, call, { as: "statement" })).toThrow("its call 0000C0DE to libTest_gf_Guarded holds 0000BEEF in a slot Test/0000BBBC its template doesn't write");
  });
});

describe("a value filled into a template", () => {
  it("is never taken for a template macro, though its text looks like one", () => {
    // Repeat's count, set to its variable by #INITAUTOVAR, given StringLength("#RED").
    const call: GuiCall = {
      id: "0000C0DE",
      function: "Ntve/00000349",
      params: [{ id: "0000F000", def: "Ntve/00000677", call: { id: "0000C0DF", function: "Ntve/00000007", params: [{ id: "0000F001", def: "Ntve/00000008", type: "string", value: "#RED" }] } }],
    };

    expect(callGalaxy(libraryScope(), call, { as: "statement" })[0]).toBe('auto0000C0DE_n = StringLength("#RED");');
  });
});

describe("a template macro in a form the engine doesn't match", () => {
  it("is refused, not written into the Galaxy as text: Pick Each Player (Deprecated)'s #SUBFUNCS(actions);, which no Editor save shows", () => {
    expect(() => callGalaxy(libraryScope(), callTo("Ntve", "0155FBC1"), { as: "statement" })).toThrow(
      "libNtve_gf_PickEachPlayerInGroupDeprecated's template uses #SUBFUNCS in a form this doesn't write yet",
    );
  });
});
