// A synthetic GUI library for the library breadth tests: Harbour-Story's "Harbour Tools" (Hbr1),
// with a function for each value form, literal, operator and template the conversion reads and
// writes beyond the first ones (library-fixture.ts). Each is laid out as the Editor saves it (its
// FunctionDef, then the elements it owns in the order it reaches them), with the Galaxy the Editor
// generates for it:
//
//   Halt Boats       an ability command with its type info (ValueTypeInfo) and a unit filter
//   Dim Harbour      a color, a game option and its value, an actor message
//   Count Down       ArithmeticInt;  Half Tide   ArithmeticReal
//   Shout            a #PARAM over a repeated parameter (Combine Strings), joined by its separator
//   Ring Each Boat   #AUTOVAR and #INITAUTOVAR (For Each Unit, Pick Each Unit and its Picked Unit,
//                    Repeat), and a variable started as null, which the Editor initializes not at all
//   Pick Tide        If Then Multiple, its If Thens after the first written else if
//   Open Harbour     an Action Group, which the Editor follows with a blank line (a template
//                    ending in a statement slot), then a blank comment, which it writes nothing for
import path from "node:path";

import { type Mod, put } from "./mod-fixture.js";

const ELEMENT = "        ";
const CHILD = "            ";

/** A reference child line, `<Tag Type Library Id/>`: `Ntve/…` for the game's, a bare id for Hbr1's own. */
const ref = (tag: string, type: string, id: string): string => {
  const [library, own] = id.includes("/") ? id.split("/") : ["Hbr1", id];
  return `${CHILD}<${tag} Type="${type}" Library="${library}" Id="${own}"/>`;
};
const element = (type: string, id: string, ...children: string[]): string[] => [`${ELEMENT}<Element Type="${type}" Id="${id}">`, ...children, `${ELEMENT}</Element>`];
const param = (id: string, def: string, ...value: string[]): string[] => element("Param", id, ref("ParameterDef", "ParamDef", def), ...value);
const literal = (value: string | undefined, type: string, ...more: string[]): string[] => [...(value === undefined ? [] : [`${CHILD}<Value>${value}</Value>`]), `${CHILD}<ValueType Type="${type}"/>`, ...more];
const preset = (id: string): string => ref("Preset", "PresetValue", id);
const call = (id: string, fn: string, { sub, params = [], body = [] }: { sub?: string; params?: string[]; body?: string[] } = {}): string[] =>
  element("FunctionCall", id, ref("FunctionDef", "FunctionDef", fn), ...(sub ? [ref("SubFunctionType", "SubFuncType", sub)] : []), ...params.map((p) => ref("Parameter", "Param", p)), ...body.map((b) => ref("FunctionCall", "FunctionCall", b)));
const paramDef = (id: string, type: string): string[] => element("ParamDef", id, `${CHILD}<ParameterType>`, `${CHILD}    <Type Value="${type}"/>`, `${CHILD}</ParameterType>`);
const variable = (id: string, type: string, value: string): string[] => element("Variable", id, `${CHILD}<VariableType>`, `${CHILD}    <Type Value="${type}"/>`, `${CHILD}</VariableType>`, ref("Value", "Param", value));
const returnType = (type: string): string[] => [`${CHILD}<ReturnType>`, `${CHILD}    <Type Value="${type}"/>`, `${CHILD}</ReturnType>`];
const functionDef = (id: string, kind: "FlagAction" | "FlagCall", { returns, params = [], variables = [], actions = [] }: { returns?: string; params?: string[]; variables?: string[]; actions?: string[] }): string[] =>
  element(
    "FunctionDef",
    id,
    `${CHILD}<${kind}/>`,
    ...(returns ? returnType(returns) : []),
    ...params.map((p) => ref("Parameter", "ParamDef", p)),
    ...variables.map((v) => ref("Variable", "Variable", v)),
    ...actions.map((a) => ref("FunctionCall", "FunctionCall", a)),
  );

const HALT_BOATS = [
  ...functionDef("0000D100", "FlagAction", { params: ["0000D101"], actions: ["0000D110"] }),
  ...paramDef("0000D101", "int"),
  ...call("0000D110", "Ntve/00000108", { params: ["0000D111", "0000D11A", "0000D11E"] }),
  ...param("0000D111", "Ntve/00000171", ref("FunctionCall", "FunctionCall", "0000D112")),
  ...call("0000D112", "Ntve/00000359", { params: ["0000D113", "0000D114", "0000D115", "0000D117", "0000D118"] }),
  ...param("0000D113", "Ntve/00000691", preset("Ntve/00000231")),
  ...param("0000D114", "Ntve/00000692", ref("Parameter", "ParamDef", "0000D101")),
  ...param("0000D115", "Ntve/00000693", ref("FunctionCall", "FunctionCall", "0000D116")),
  ...call("0000D116", "Ntve/00000356"),
  ...param("0000D117", "Ntve/00000695", ...literal("-;Missile,Dead,Hidden", "unitfilter")),
  ...param("0000D118", "Ntve/00000694", preset("Ntve/1468BD55")),
  ...param("0000D11A", "Ntve/00000172", ref("FunctionCall", "FunctionCall", "0000D11B")),
  ...call("0000D11B", "Ntve/59BA1DDF", { params: ["0000D11C"] }),
  ...param("0000D11C", "Ntve/C2F687E6", ...literal("stop", "abilcmd", `${CHILD}<ValueTypeInfo Value="0"/>`)),
  ...param("0000D11E", "Ntve/00000173", preset("Ntve/00000039")),
];

const DIM_HARBOUR = [
  ...functionDef("0000D200", "FlagAction", { params: ["0000D201"], actions: ["0000D210", "0000D220", "0000D230"] }),
  ...paramDef("0000D201", "unit"),
  ...call("0000D210", "Ntve/D8A9F49F", { params: ["0000D211", "0000D212", "0000D213", "0000D214", "0000D215", "0000D216"] }),
  ...param("0000D211", "Ntve/672FA3A3", preset("Ntve/00000547")),
  ...param("0000D212", "Ntve/40A35254", ...literal("0.0", "fixed")),
  ...param("0000D213", "Ntve/BA72E931", preset("Ntve/80AEE9D1")),
  ...param("0000D214", "Ntve/5872348A", ...literal("255,0,0,0", "color")),
  ...param("0000D215", "Ntve/16DD371C", ...literal("0.0", "fixed")),
  ...param("0000D216", "Ntve/D61CE1DE", preset("Ntve/00000067")),
  ...call("0000D220", "Ntve/BDF27E57", { params: ["0000D221", "0000D222", "0000D223"] }),
  ...param("0000D221", "Ntve/144A11CF", ...literal("1", "int")),
  ...param("0000D222", "Ntve/5DA7D4B8", ...literal("simplecommandcard", "gameoption")),
  ...param("0000D223", "Ntve/9E7ED4E2", ...literal("0", "gameoptionvalue", `${CHILD}<ValueContext Value="simplecommandcard"/>`)),
  ...call("0000D230", "Ntve/E1552C18", { params: ["0000D231", "0000D232"] }),
  ...param("0000D231", "Ntve/5A8D5B9F", ref("Parameter", "ParamDef", "0000D201")),
  ...param("0000D232", "Ntve/8FF77F87", ...literal("ModelFlagsSet OutlineEmitter", "actormsg")),
];

// As the Editor saves an operator's parameters: the operator first, then the right and the left.
const COUNT_DOWN = [
  ...functionDef("0000D300", "FlagCall", { returns: "int", params: ["0000D301"], actions: ["0000D310"] }),
  ...paramDef("0000D301", "int"),
  ...call("0000D310", "Ntve/00000097", { params: ["0000D311"] }),
  ...param("0000D311", "Ntve/00000488", ref("FunctionCall", "FunctionCall", "0000D312")),
  ...call("0000D312", "Ntve/00000128", { params: ["0000D313", "0000D314", "0000D315"] }),
  ...param("0000D313", "Ntve/00000206", preset("Ntve/00000086")),
  ...param("0000D314", "Ntve/00000207", ...literal("1", "int")),
  ...param("0000D315", "Ntve/00000205", ref("Parameter", "ParamDef", "0000D301")),
];

const HALF_TIDE = [
  ...functionDef("0000D350", "FlagCall", { returns: "fixed", params: ["0000D351"], actions: ["0000D360"] }),
  ...paramDef("0000D351", "fixed"),
  ...call("0000D360", "Ntve/00000097", { params: ["0000D361"] }),
  ...param("0000D361", "Ntve/00000488", ref("FunctionCall", "FunctionCall", "0000D362")),
  ...call("0000D362", "Ntve/00000129", { params: ["0000D363", "0000D364", "0000D365"] }),
  ...param("0000D363", "Ntve/00000208", ref("Parameter", "ParamDef", "0000D351")),
  ...param("0000D364", "Ntve/00000209", preset("Ntve/00000088")),
  ...param("0000D365", "Ntve/00000210", ...literal("2", "fixed")),
];

const SHOUT = [
  ...functionDef("0000D400", "FlagAction", { params: ["0000D401"], variables: ["0000D402"], actions: ["0000D410"] }),
  ...paramDef("0000D401", "string"),
  ...variable("0000D402", "string", "0000D403"),
  ...element("Param", "0000D403", ...literal(undefined, "string")),
  ...call("0000D410", "Ntve/00000136", { params: ["0000D411", "0000D412"] }),
  ...param("0000D411", "Ntve/00000219", ref("Variable", "Variable", "0000D402")),
  ...param("0000D412", "Ntve/00000220", ref("FunctionCall", "FunctionCall", "0000D413")),
  ...call("0000D413", "Ntve/00000130", { params: ["0000D414", "0000D415", "0000D416"] }),
  ...param("0000D414", "Ntve/00000211", ref("Parameter", "ParamDef", "0000D401")),
  ...param("0000D415", "Ntve/00000211", ...literal("!", "string")),
  ...param("0000D416", "Ntve/00000211", ref("Parameter", "ParamDef", "0000D401")),
];

const RING_EACH_BOAT = [
  ...functionDef("0000D500", "FlagAction", { params: ["0000D501"], variables: ["0000D502", "0000D504"], actions: ["0000D510", "0000D520", "0000D530"] }),
  ...paramDef("0000D501", "unitgroup"),
  ...variable("0000D502", "unit", "0000D503"),
  ...element("Param", "0000D503", preset("Ntve/D6EA4D09")),
  ...variable("0000D504", "int", "0000D505"),
  ...element("Param", "0000D505", ...literal("3", "int")),
  ...call("0000D510", "Ntve/00000327", { params: ["0000D511", "0000D512"], body: ["0000D513"] }),
  ...param("0000D511", "Ntve/00000618", ref("Parameter", "ParamDef", "0000D501")),
  ...param("0000D512", "Ntve/00000617", ref("Variable", "Variable", "0000D502")),
  ...call("0000D513", "Ntve/00000077", { sub: "Ntve/00000007", params: ["0000D514"] }),
  ...param("0000D514", "Ntve/00000136", ref("Variable", "Variable", "0000D502")),
  ...call("0000D520", "Ntve/C4DC760C", { params: ["0000D521"], body: ["0000D522"] }),
  ...param("0000D521", "Ntve/F96B466D", ref("Parameter", "ParamDef", "0000D501")),
  ...call("0000D522", "Ntve/00000077", { sub: "Ntve/9441B8B5", params: ["0000D523"] }),
  ...param("0000D523", "Ntve/00000136", ref("FunctionCall", "FunctionCall", "0000D524")),
  ...call("0000D524", "Ntve/19CE733E"),
  ...call("0000D530", "Ntve/00000349", { params: ["0000D531"], body: ["0000D532"] }),
  ...param("0000D531", "Ntve/00000677", ref("Variable", "Variable", "0000D504")),
  ...call("0000D532", "Ntve/00000242", { sub: "Ntve/00000008", params: ["0000D533", "0000D534"] }),
  ...param("0000D533", "Ntve/00000419", ...literal("1", "fixed")),
  ...param("0000D534", "Ntve/00000420", preset("Ntve/00000013")),
];

/** An If Then of If Then Multiple, as the Editor saves it: its Then's Return before its If's comparison. */
const ifThen = (id: number, parameter: string): string[] => {
  const at = (offset: number) => `0000${(id + offset).toString(16).toUpperCase()}`;
  return [
    ...call(at(0), "Ntve/BB1891ED", { sub: "Ntve/C7699CD9", body: [at(1), at(3)] }),
    ...call(at(1), "Ntve/00000097", { sub: "Ntve/BF750C3C", params: [at(2)] }),
    ...param(at(2), "Ntve/00000488", ref("Parameter", "ParamDef", parameter)),
    ...call(at(3), "Ntve/C439C375", { sub: "Ntve/C60B9062", params: [at(4), at(5), at(6)] }),
    ...param(at(4), "Ntve/ABB380C4", ref("Parameter", "ParamDef", parameter)),
    ...param(at(5), "Ntve/51567265", preset("Ntve/40567BEE")),
    ...param(at(6), "Ntve/4A15EC5F", ...literal("0", "int")),
  ];
};

const PICK_TIDE = [
  ...functionDef("0000D600", "FlagCall", { returns: "int", params: ["0000D601", "0000D602"], actions: ["0000D610", "0000D630"] }),
  ...paramDef("0000D601", "int"),
  ...paramDef("0000D602", "int"),
  ...call("0000D610", "Ntve/C0083258", { body: ["0000D611", "0000D621"] }),
  ...ifThen(0xd611, "0000D602"),
  ...ifThen(0xd621, "0000D601"),
  ...call("0000D630", "Ntve/00000097", { params: ["0000D631"] }),
  ...param("0000D631", "Ntve/00000488", ...literal("0", "int")),
];

const OPEN_HARBOUR = [
  ...element(
    "FunctionDef",
    "0000D700",
    `${CHILD}<FlagAction/>`,
    ref("FunctionCall", "FunctionCall", "0000D710"),
    ref("FunctionCall", "Comment", "0000D720"),
    ref("FunctionCall", "FunctionCall", "0000D730"),
  ),
  ...call("0000D710", "Ntve/75796BFD", { params: ["0000D711"], body: ["0000D712"] }),
  ...param("0000D711", "Ntve/459BACBC", ...literal("Raise the boom", "string")),
  ...call("0000D712", "Ntve/00000242", { sub: "Ntve/C4F06699", params: ["0000D713", "0000D714"] }),
  ...param("0000D713", "Ntve/00000419", ...literal("1", "fixed")),
  ...param("0000D714", "Ntve/00000420", preset("Ntve/00000013")),
  ...element("Comment", "0000D720"),
  ...call("0000D730", "Ntve/00000242", { params: ["0000D731", "0000D732"] }),
  ...param("0000D731", "Ntve/00000419", ...literal("2", "fixed")),
  ...param("0000D732", "Ntve/00000420", preset("Ntve/00000013")),
];

/** The functions, in the library's order: name, FunctionDef id, its elements, and its Galaxy as the Editor generates it. */
export const BREADTH_FUNCTIONS = [
  {
    name: "Halt Boats",
    id: "0000D100",
    elements: HALT_BOATS,
    galaxy: [
      "void libHbr1_gf_HaltBoats (int lp_player) {",
      "    // Automatic Variable Declarations",
      "    // Implementation",
      "    UnitGroupIssueOrder(UnitGroup(null, lp_player, RegionEntireMap(), UnitFilter(0, 0, (1 << c_targetFilterMissile), (1 << (c_targetFilterDead - 32)) | (1 << (c_targetFilterHidden - 32))), 0), Order(AbilityCommand(\"stop\", 0)), c_orderQueueReplace);",
      "}",
    ],
    params: { "0000D101": "Player" },
  },
  {
    name: "Dim Harbour",
    id: "0000D200",
    elements: DIM_HARBOUR,
    galaxy: [
      "void libHbr1_gf_DimHarbour (unit lp_lamp) {",
      "    // Automatic Variable Declarations",
      "    // Implementation",
      "    CinematicFade(false, 0.0, c_fadeStyleNormal, Color(0.00, 0.00, 0.00), 0.0, true);",
      '    PlayerOptionOverride(1, "simplecommandcard", "0");',
      '    libNtve_gf_SendActorMessageToUnit(lp_lamp, "ModelFlagsSet OutlineEmitter");',
      "}",
    ],
    params: { "0000D201": "Lamp" },
  },
  {
    name: "Count Down",
    id: "0000D300",
    elements: COUNT_DOWN,
    galaxy: ["int libHbr1_gf_CountDown (int lp_i) {", "    // Automatic Variable Declarations", "    // Implementation", "    return (lp_i - 1);", "}"],
    params: { "0000D301": "I" },
  },
  {
    name: "Half Tide",
    id: "0000D350",
    elements: HALF_TIDE,
    galaxy: ["fixed libHbr1_gf_HalfTide (fixed lp_tide) {", "    // Automatic Variable Declarations", "    // Implementation", "    return (lp_tide / 2.0);", "}"],
    params: { "0000D351": "Tide" },
  },
  {
    name: "Shout",
    id: "0000D400",
    elements: SHOUT,
    galaxy: [
      "void libHbr1_gf_Shout (string lp_word) {",
      "    // Variable Declarations",
      "    string lv_call;",
      "",
      "    // Automatic Variable Declarations",
      "    // Variable Initialization",
      '    lv_call = "";',
      "",
      "    // Implementation",
      '    lv_call = (lp_word + "!" + lp_word);',
      "}",
    ],
    params: { "0000D401": "Word" },
    variables: { "0000D402": "Call" },
  },
  {
    name: "Ring Each Boat",
    id: "0000D500",
    elements: RING_EACH_BOAT,
    galaxy: [
      "void libHbr1_gf_RingEachBoat (unitgroup lp_boats) {",
      "    // Variable Declarations",
      "    unit lv_boat;",
      "    int lv_rings;",
      "",
      "    // Automatic Variable Declarations",
      "    unitgroup auto0000D510_g;",
      "    int auto0000D510_u;",
      "    unitgroup auto0000D520_g;",
      "    int auto0000D520_u;",
      "    unit auto0000D520_var;",
      "    int auto0000D530_n;",
      "    int auto0000D530_i;",
      "",
      "    // Variable Initialization",
      "    lv_rings = 3;",
      "",
      "    // Implementation",
      "    auto0000D510_g = lp_boats;",
      "    auto0000D510_u = UnitGroupCount(auto0000D510_g, c_unitCountAll);",
      "    for (;; auto0000D510_u -= 1) {",
      "        lv_boat = UnitGroupUnitFromEnd(auto0000D510_g, auto0000D510_u);",
      "        if (lv_boat == null) { break; }",
      "        UnitKill(lv_boat);",
      "    }",
      "    auto0000D520_g = lp_boats;",
      "    auto0000D520_u = UnitGroupCount(auto0000D520_g, c_unitCountAll);",
      "    for (;; auto0000D520_u -= 1) {",
      "        auto0000D520_var = UnitGroupUnitFromEnd(auto0000D520_g, auto0000D520_u);",
      "        if (auto0000D520_var == null) { break; }",
      "        UnitKill(auto0000D520_var);",
      "    }",
      "    auto0000D530_n = lv_rings;",
      "    for (auto0000D530_i = 1; auto0000D530_i <= auto0000D530_n; auto0000D530_i += 1) {",
      "        Wait(1.0, c_timeGame);",
      "    }",
      "}",
    ],
    params: { "0000D501": "Boats" },
    variables: { "0000D502": "Boat", "0000D504": "Rings" },
  },
  {
    name: "Pick Tide",
    id: "0000D600",
    elements: PICK_TIDE,
    galaxy: [
      "int libHbr1_gf_PickTide (int lp_low, int lp_high) {",
      "    // Automatic Variable Declarations",
      "    // Implementation",
      "    if ((lp_high > 0)) {",
      "        return lp_high;",
      "    }",
      "    else if ((lp_low > 0)) {",
      "        return lp_low;",
      "    }",
      "    return 0;",
      "}",
    ],
    params: { "0000D601": "Low", "0000D602": "High" },
  },
  {
    name: "Open Harbour",
    id: "0000D700",
    elements: OPEN_HARBOUR,
    galaxy: ["void libHbr1_gf_OpenHarbour () {", "    // Automatic Variable Declarations", "    // Implementation", "    Wait(1.0, c_timeGame);", "", "    Wait(2.0, c_timeGame);", "}"],
    params: {},
  },
] as const;

export const BREADTH_TRIGGERS = [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<TriggerData>`,
  `    <Library Id="Hbr1">`,
  `        <Root>`,
  `            <Item Type="Category" Library="Hbr1" Id="00000001"/>`,
  `        </Root>`,
  `        <Element Type="Category" Id="00000001">`,
  ...BREADTH_FUNCTIONS.map((fn) => `            <Item Type="FunctionDef" Library="Hbr1" Id="${fn.id}"/>`),
  `        </Element>`,
  ...BREADTH_FUNCTIONS.flatMap((fn) => fn.elements),
  `    </Library>`,
  `</TriggerData>`,
  ``,
].join("\r\n");

export const BREADTH_STRINGS = [
  ...BREADTH_FUNCTIONS.flatMap((fn) => [
    `FunctionDef/Name/lib_Hbr1_${fn.id}=${fn.name}`,
    ...Object.entries(fn.params).map(([id, name]) => `ParamDef/Name/lib_Hbr1_${id}=${name}`),
    ...Object.entries("variables" in fn ? fn.variables : {}).map(([id, name]) => `Variable/Name/lib_Hbr1_${id}=${name}`),
  ]),
  "Library/Name/Hbr1=Harbour Tools",
]
  .sort()
  .map((line, index) => (index === 0 ? `﻿${line}` : line))
  .concat([""])
  .join("\r\n");

export const BREADTH_GALAXY = [
  'include "TriggerLibs/NativeLib"',
  "",
  'include "LibHbr1_h"',
  "",
  "//--------------------------------------------------------------------------------------------------",
  "// Library: Harbour Tools",
  "//--------------------------------------------------------------------------------------------------",
  "// External Library Initialization",
  "void libHbr1_InitLibraries () {",
  "    libNtve_InitVariables();",
  "}",
  "",
  "// Presets",
  "// Functions",
  ...BREADTH_FUNCTIONS.flatMap((fn) => [...fn.galaxy, ""]),
  "// Triggers",
  "",
].join("\n");

export const BREADTH_HEADER = [
  'include "TriggerLibs/natives"',
  "",
  "//--------------------------------------------------------------------------------------------------",
  "// Library: Harbour Tools",
  "//--------------------------------------------------------------------------------------------------",
  "// Function Declarations",
  ...BREADTH_FUNCTIONS.map((fn) => `${fn.galaxy[0]!.replace(/ \{$/, ";")}`),
  "",
  "// Trigger Declarations",
  "",
].join("\n");

/** Gives the imported package the breadth library, as if it had come with it. */
export async function withBreadthLibrary(mod: Mod): Promise<void> {
  const files = {
    Triggers: BREADTH_TRIGGERS,
    "enUS.SC2Data/LocalizedData/TriggerStrings.txt": BREADTH_STRINGS,
    "Base.SC2Data/LibHbr1.galaxy": BREADTH_GALAXY,
    "Base.SC2Data/LibHbr1_h.galaxy": BREADTH_HEADER,
  };
  for (const [file, content] of Object.entries(files)) await put(path.join(mod.modPackage, ...file.split("/")), content);
}
