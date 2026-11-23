// A synthetic GUI library for the library script tests: Harbour-Story's "Harbour Tools" (Hbr1),
// with a function for each script, thread and structure form the conversion reads and writes beyond
// the values and literals (library-breadth-fixture.ts). Each is laid out as the Editor saves it (its
// FunctionDef, then the elements it owns in the order it reaches them), with the Galaxy the Editor
// generates for it:
//
//   Wake Crew      Custom Script actions (a call's own <ScriptCode>), one line and several, one in
//                  an If Then's Then
//   Frame Harbour  a value of custom script (<CustomType> and <ScriptCode>), a structure's member
//                  and a trigger of the library (<ValueElement Type="Trigger">)
//   Sort Cargo     a Switch over a structure's member, its call variable typed by that member
//   Sound Bell     a function that runs in its own thread (FlagCreateThread), with a parameter;
//   Rock Boat      and with none
//   Tide Level     an inline function, which has a definition of its own, and whose value its
//   Read Tide      callers write in its place; Clear Deck, an inline action, is called as any other
//   Hail Ship      a parameter limited to two presets, one preloaded with a default, and a user
//                  instance typed by another parameter
//
// The library also holds what they name: the global Harbour (a structure of Crates and Harbour
// Master), the global Tide and the trigger Sound Foghorn.
import path from "node:path";

import { type Mod, put } from "./mod-fixture.js";

const ELEMENT = "        ";
const CHILD = "            ";
const GRANDCHILD = "                ";

const ref = (tag: string, type: string, id: string): string => {
  const [library, own] = id.includes("/") ? id.split("/") : ["Hbr1", id];
  return `${CHILD}<${tag} Type="${type}" Library="${library}" Id="${own}"/>`;
};
const element = (type: string, id: string, ...children: string[]): string[] => [`${ELEMENT}<Element Type="${type}" Id="${id}">`, ...children, `${ELEMENT}</Element>`];
const param = (id: string, def: string, ...value: string[]): string[] => element("Param", id, ref("ParameterDef", "ParamDef", def), ...value);
const literal = (value: string | undefined, type: string, ...more: string[]): string[] => [...(value === undefined ? [] : [`${CHILD}<Value>${value}</Value>`]), `${CHILD}<ValueType Type="${type}"/>`, ...more];
const preset = (id: string): string => ref("Preset", "PresetValue", id);
const scriptCode = (...lines: string[]): string[] => [`${CHILD}<ScriptCode>`, ...lines.map((line) => `${GRANDCHILD}${line}`), `${CHILD}</ScriptCode>`];
const call = (id: string, fn: string, { sub, params = [], body = [], script = [] }: { sub?: string; params?: string[]; body?: string[]; script?: string[] } = {}): string[] =>
  element(
    "FunctionCall",
    id,
    ref("FunctionDef", "FunctionDef", fn),
    ...(sub ? [ref("SubFunctionType", "SubFuncType", sub)] : []),
    ...params.map((p) => ref("Parameter", "Param", p)),
    ...body.map((b) => ref("FunctionCall", "FunctionCall", b)),
    ...(script.length ? scriptCode(...script) : []),
  );
const typed = (tag: string, type: string, ...more: string[]): string[] => [`${CHILD}<${tag}>`, `${CHILD}    <Type Value="${type}"/>`, ...more.map((line) => `${CHILD}    ${line}`), `${CHILD}</${tag}>`];
const paramDef = (id: string, type: string): string[] => element("ParamDef", id, ...typed("ParameterType", type));
const variable = (id: string, type: string, value: string): string[] => element("Variable", id, ...typed("VariableType", type), ref("Value", "Param", value));
const functionDef = (id: string, kind: "FlagAction" | "FlagCall", { flags = [], returns, params = [], variables = [], actions = [] }: { flags?: string[]; returns?: string; params?: string[]; variables?: string[]; actions?: string[] }): string[] =>
  element(
    "FunctionDef",
    id,
    `${CHILD}<${kind}/>`,
    ...flags.map((flag) => `${CHILD}<${flag}/>`),
    ...(returns ? typed("ReturnType", returns) : []),
    ...params.map((p) => ref("Parameter", "ParamDef", p)),
    ...variables.map((v) => ref("Variable", "Variable", v)),
    ...actions.map((a) => ref("FunctionCall", "FunctionCall", a)),
  );
const setVariable = (id: string, target: string[], value: string[]): string[] => [...call(id, "Ntve/00000136", { params: [`${id.slice(0, 7)}1`, `${id.slice(0, 7)}2`] }), ...param(`${id.slice(0, 7)}1`, "Ntve/00000219", ...target), ...param(`${id.slice(0, 7)}2`, "Ntve/00000220", ...value)];
const wait = (id: string, seconds: string): string[] => [...call(id, "Ntve/00000242", { params: [`${id.slice(0, 7)}1`, `${id.slice(0, 7)}2`] }), ...param(`${id.slice(0, 7)}1`, "Ntve/00000419", ...literal(seconds, "fixed")), ...param(`${id.slice(0, 7)}2`, "Ntve/00000420", preset("Ntve/00000013"))];

/** What the functions name: the globals Harbour (a structure) and Tide, and the trigger Sound Foghorn. */
const LIBRARY_ITEMS = [
  ...element("Variable", "0000F900", `${CHILD}<VariableType>`, `${CHILD}    <Type Value="struct"/>`, `${CHILD}    <TypeElement Type="Structure" Library="Hbr1" Id="0000F910"/>`, `${CHILD}</VariableType>`),
  ...element("Structure", "0000F910", ref("Variable", "Variable", "0000F911"), ref("Variable", "Variable", "0000F913")),
  ...variable("0000F911", "int", "0000F912"),
  ...element("Param", "0000F912", ...literal("0", "int")),
  ...variable("0000F913", "string", "0000F914"),
  ...element("Param", "0000F914", ...literal(undefined, "string")),
  ...variable("0000F930", "fixed", "0000F931"),
  ...element("Param", "0000F931", ...literal("0.0", "fixed")),
  ...element("Trigger", "0000F920", `${CHILD}<InitOff/>`),
];

const WAKE_CREW = [
  ...functionDef("0000F100", "FlagAction", { params: ["0000F101"], variables: ["0000F102"], actions: ["0000F110", "0000F120"] }),
  ...paramDef("0000F101", "bool"),
  ...variable("0000F102", "trigger", "0000F103"),
  ...element("Param", "0000F103", preset("Ntve/00000542")),
  ...call("0000F110", "Ntve/00000123", { script: ["lv_watch = TriggerCreate(&quot;WatchCrew_Func&quot;);"] }),
  ...call("0000F120", "Ntve/00000137", { body: ["0000F121", "0000F125"] }),
  ...call("0000F121", "Ntve/C439C375", { sub: "Ntve/00000003", params: ["0000F122", "0000F123", "0000F124"] }),
  ...param("0000F122", "Ntve/ABB380C4", ref("Parameter", "ParamDef", "0000F101")),
  ...param("0000F123", "Ntve/51567265", preset("Ntve/1E7A4625")),
  ...param("0000F124", "Ntve/4A15EC5F", ...literal("true", "bool")),
  ...call("0000F125", "Ntve/00000123", { sub: "Ntve/00000004", script: ["while(true){", "    TriggerExecute(lv_watch, true, false);", "    break;", "}"] }),
];

const FRAME_HARBOUR = [
  ...functionDef("0000F200", "FlagAction", { params: ["0000F201"], variables: ["0000F202"], actions: ["0000F210", "0000F220", "0000F230"] }),
  ...paramDef("0000F201", "string"),
  ...variable("0000F202", "string", "0000F203"),
  ...element("Param", "0000F203", ...literal(undefined, "string")),
  ...setVariable("0000F210", [ref("Variable", "Variable", "0000F202")], [`${CHILD}<CustomType Type="layoutframe"/>`, ...scriptCode("&quot;Harbour/Frame&quot;")]),
  ...call("0000F220", "Ntve/00000136", { params: ["0000F221", "0000F223"] }),
  ...param("0000F221", "Ntve/00000219", ref("Variable", "Variable", "0000F900"), ref("StructMember", "Param", "0000F222")),
  ...element("Param", "0000F222", ref("Variable", "Variable", "0000F913")),
  ...param("0000F223", "Ntve/00000220", ref("Parameter", "ParamDef", "0000F201")),
  ...call("0000F230", "Ntve/00000111", { params: ["0000F231", "0000F232"] }),
  ...param("0000F231", "Ntve/00000176", `${CHILD}<ValueType Type="trigger"/>`, ref("ValueElement", "Trigger", "0000F920")),
  ...param("0000F232", "Ntve/00000177", preset("Ntve/00000538")),
];

// As the Editor saves a Switch: its default's Return before its cases.
const SORT_CARGO = [
  ...functionDef("0000F300", "FlagCall", { returns: "int", actions: ["0000F310"] }),
  ...call("0000F310", "Ntve/91C49196", { params: ["0000F311"], body: ["0000F313", "0000F315"] }),
  ...param("0000F311", "Ntve/B4ACF12A", ref("Variable", "Variable", "0000F900"), ref("StructMember", "Param", "0000F312")),
  ...element("Param", "0000F312", ref("Variable", "Variable", "0000F911")),
  ...call("0000F313", "Ntve/00000097", { sub: "Ntve/3E7C4C40", params: ["0000F314"] }),
  ...param("0000F314", "Ntve/00000488", ...literal("0", "int")),
  ...call("0000F315", "Ntve/3A1227AB", { sub: "Ntve/AD43BC93", params: ["0000F316"], body: ["0000F317"] }),
  ...param("0000F316", "Ntve/9A8F1093", ...literal("2", "int")),
  ...call("0000F317", "Ntve/00000097", { sub: "Ntve/363CE97C", params: ["0000F318"] }),
  ...param("0000F318", "Ntve/00000488", ...literal("1", "int")),
];

const SOUND_BELL = [
  ...functionDef("0000F400", "FlagAction", { flags: ["FlagCreateThread"], params: ["0000F401"], variables: ["0000F402"], actions: ["0000F410", "0000F420"] }),
  ...paramDef("0000F401", "int"),
  ...variable("0000F402", "int", "0000F403"),
  ...element("Param", "0000F403", ...literal("0", "int")),
  ...setVariable("0000F410", [ref("Variable", "Variable", "0000F402")], [ref("Parameter", "ParamDef", "0000F401")]),
  ...wait("0000F420", "1.0"),
];

const ROCK_BOAT = [...functionDef("0000F450", "FlagAction", { flags: ["FlagCreateThread"], actions: ["0000F460"] }), ...wait("0000F460", "2.0")];

const TIDE_LEVEL = [
  ...functionDef("0000F500", "FlagCall", { flags: ["FlagInline"], returns: "fixed", actions: ["0000F510"] }),
  ...call("0000F510", "Ntve/00000097", { params: ["0000F511"] }),
  ...param("0000F511", "Ntve/00000488", ref("Variable", "Variable", "0000F930")),
];

const CLEAR_DECK = [...functionDef("0000F550", "FlagAction", { flags: ["FlagInline"], actions: ["0000F560"] }), ...setVariable("0000F560", [ref("Variable", "Variable", "0000F930")], literal("0.0", "fixed"))];

const READ_TIDE = [
  ...functionDef("0000F600", "FlagAction", { variables: ["0000F601"], actions: ["0000F610", "0000F620"] }),
  ...variable("0000F601", "fixed", "0000F602"),
  ...element("Param", "0000F602", ...literal("0.0", "fixed")),
  ...setVariable("0000F610", [ref("Variable", "Variable", "0000F601")], [ref("FunctionCall", "FunctionCall", "0000F613")]),
  ...call("0000F613", "Hbr1/0000F500"),
  ...call("0000F620", "Hbr1/0000F550"),
];

const HAIL_SHIP = [
  ...functionDef("0000F700", "FlagAction", { params: ["0000F701", "0000F703", "0000F705"] }),
  ...element("ParamDef", "0000F701", ...typed("ParameterType", "color"), ref("Default", "Param", "0000F702"), ref("Preset", "Preset", "Ntve/C5797A54"), ref("Preset", "Preset", "Ntve/ED11A5DE")),
  ...element("Param", "0000F702", preset("Ntve/3A57447B")),
  ...element("ParamDef", "0000F703", ...typed("ParameterType", "gamelink", `<GameType Value="User"/>`), `${CHILD}<ParamFlagPreload/>`, ref("Default", "Param", "0000F704")),
  ...element("Param", "0000F704", ...literal("Harbour", "gamelink", `${CHILD}<ValueGameType Type="User"/>`)),
  ...element("ParamDef", "0000F705", ...typed("ParameterType", "userinstance", `<TypeElement Type="ParamDef" Library="Hbr1" Id="0000F703"/>`, `<UserType Value="Harbour"/>`)),
];

const threadStub = (name: string, params: readonly (readonly [string, string])[]): string[] => {
  const fn = `libHbr1_gf_${name}`;
  const trigger = `auto_${fn}_Trigger`;
  const gap = params.length ? [""] : [];
  return [
    `trigger ${trigger} = null;`,
    ...params.map(([type, own]) => `${type} auto_${fn}_${own};`),
    "",
    `void ${fn} (${params.map(([type, own]) => `${type} ${own}`).join(", ")}) {`,
    ...params.map(([, own]) => `    auto_${fn}_${own} = ${own};`),
    ...gap,
    `    if (${trigger} == null) {`,
    `        ${trigger} = TriggerCreate("${trigger}Func");`,
    "    }",
    "",
    `    TriggerExecute(${trigger}, false, false);`,
    "}",
    "",
    `bool ${trigger}Func (bool testConds, bool runActions) {`,
    ...params.map(([type, own]) => `    ${type} ${own} = auto_${fn}_${own};`),
    ...gap,
  ];
};

/** The functions, in the library's order: name, FunctionDef id, its elements, its Galaxy as the Editor generates it and its declaration. */
export const SCRIPT_FUNCTIONS = [
  {
    name: "Wake Crew",
    id: "0000F100",
    elements: WAKE_CREW,
    galaxy: [
      "void libHbr1_gf_WakeCrew (bool lp_loud) {",
      "    // Variable Declarations",
      "    trigger lv_watch;",
      "",
      "    // Automatic Variable Declarations",
      "    // Variable Initialization",
      "",
      "    // Implementation",
      '    lv_watch = TriggerCreate("WatchCrew_Func");',
      "    if ((lp_loud == true)) {",
      "        while(true){",
      "            TriggerExecute(lv_watch, true, false);",
      "            break;",
      "        }",
      "    }",
      "",
      "}",
    ],
    declaration: "void libHbr1_gf_WakeCrew (bool lp_loud);",
    params: { "0000F101": "Loud" },
    variables: { "0000F102": "Watch" },
  },
  {
    name: "Frame Harbour",
    id: "0000F200",
    elements: FRAME_HARBOUR,
    galaxy: [
      "void libHbr1_gf_FrameHarbour (string lp_master) {",
      "    // Variable Declarations",
      "    string lv_frame;",
      "",
      "    // Automatic Variable Declarations",
      "    // Variable Initialization",
      '    lv_frame = "";',
      "",
      "    // Implementation",
      '    lv_frame = "Harbour/Frame";',
      "    libHbr1_gv_harbour.lv_harbourMaster = lp_master;",
      "    TriggerEnable(libHbr1_gt_SoundFoghorn, true);",
      "}",
    ],
    declaration: "void libHbr1_gf_FrameHarbour (string lp_master);",
    params: { "0000F201": "Master" },
    variables: { "0000F202": "Frame" },
  },
  {
    name: "Sort Cargo",
    id: "0000F300",
    elements: SORT_CARGO,
    galaxy: [
      "int libHbr1_gf_SortCargo () {",
      "    // Automatic Variable Declarations",
      "    int auto0000F310_val;",
      "",
      "    // Implementation",
      "    auto0000F310_val = libHbr1_gv_harbour.lv_crates;",
      "    if (auto0000F310_val == 2) {",
      "        return 1;",
      "    }",
      "    else {",
      "        return 0;",
      "    }",
      "}",
    ],
    declaration: "int libHbr1_gf_SortCargo ();",
    params: {},
  },
  {
    name: "Sound Bell",
    id: "0000F400",
    elements: SOUND_BELL,
    galaxy: [
      ...threadStub("SoundBell", [["int", "lp_times"]]),
      "    // Variable Declarations",
      "    int lv_rung;",
      "",
      "    // Automatic Variable Declarations",
      "    // Variable Initialization",
      "",
      "    // Implementation",
      "    lv_rung = lp_times;",
      "    Wait(1.0, c_timeGame);",
      "    return true;",
      "}",
    ],
    declaration: "void libHbr1_gf_SoundBell (int lp_times);",
    params: { "0000F401": "Times" },
    variables: { "0000F402": "Rung" },
  },
  {
    name: "Rock Boat",
    id: "0000F450",
    elements: ROCK_BOAT,
    galaxy: [...threadStub("RockBoat", []), "    // Automatic Variable Declarations", "    // Implementation", "    Wait(2.0, c_timeGame);", "    return true;", "}"],
    declaration: "void libHbr1_gf_RockBoat ();",
    params: {},
  },
  {
    name: "Tide Level",
    id: "0000F500",
    elements: TIDE_LEVEL,
    galaxy: ["fixed libHbr1_gf_TideLevel () {", "    // Automatic Variable Declarations", "    // Implementation", "    return libHbr1_gv_tide;", "}"],
    declaration: "fixed libHbr1_gf_TideLevel ();",
    params: {},
  },
  {
    name: "Clear Deck",
    id: "0000F550",
    elements: CLEAR_DECK,
    galaxy: ["void libHbr1_gf_ClearDeck () {", "    // Automatic Variable Declarations", "    // Implementation", "    libHbr1_gv_tide = 0.0;", "}"],
    declaration: "void libHbr1_gf_ClearDeck ();",
    params: {},
  },
  {
    name: "Read Tide",
    id: "0000F600",
    elements: READ_TIDE,
    galaxy: [
      "void libHbr1_gf_ReadTide () {",
      "    // Variable Declarations",
      "    fixed lv_level;",
      "",
      "    // Automatic Variable Declarations",
      "    // Variable Initialization",
      "",
      "    // Implementation",
      "    lv_level = libHbr1_gv_tide;",
      "    libHbr1_gf_ClearDeck();",
      "}",
    ],
    declaration: "void libHbr1_gf_ReadTide ();",
    params: {},
    variables: { "0000F601": "Level" },
  },
  {
    name: "Hail Ship",
    id: "0000F700",
    elements: HAIL_SHIP,
    galaxy: ["void libHbr1_gf_HailShip (color lp_colour, string lp_kind, string lp_ship) {", "    // Automatic Variable Declarations", "}"],
    declaration: "void libHbr1_gf_HailShip (color lp_colour, string lp_kind, string lp_ship);",
    params: { "0000F701": "Colour", "0000F703": "Kind", "0000F705": "Ship" },
  },
] as const;

export const SCRIPT_TRIGGERS = [
  `<?xml version="1.0" encoding="utf-8"?>`,
  `<TriggerData>`,
  `    <Library Id="Hbr1">`,
  `        <Root>`,
  `            <Item Type="Category" Library="Hbr1" Id="00000001"/>`,
  `        </Root>`,
  `        <Element Type="Category" Id="00000001">`,
  `            <Item Type="Variable" Library="Hbr1" Id="0000F900"/>`,
  `            <Item Type="Structure" Library="Hbr1" Id="0000F910"/>`,
  `            <Item Type="Variable" Library="Hbr1" Id="0000F930"/>`,
  `            <Item Type="Trigger" Library="Hbr1" Id="0000F920"/>`,
  ...SCRIPT_FUNCTIONS.map((fn) => `            <Item Type="FunctionDef" Library="Hbr1" Id="${fn.id}"/>`),
  `        </Element>`,
  ...LIBRARY_ITEMS,
  ...SCRIPT_FUNCTIONS.flatMap((fn) => fn.elements),
  `    </Library>`,
  `</TriggerData>`,
  ``,
].join("\r\n");

export const SCRIPT_STRINGS = [
  ...SCRIPT_FUNCTIONS.flatMap((fn) => [
    `FunctionDef/Name/lib_Hbr1_${fn.id}=${fn.name}`,
    ...Object.entries(fn.params).map(([id, name]) => `ParamDef/Name/lib_Hbr1_${id}=${name}`),
    ...Object.entries("variables" in fn ? fn.variables : {}).map(([id, name]) => `Variable/Name/lib_Hbr1_${id}=${name}`),
  ]),
  "Variable/Name/lib_Hbr1_0000F900=Harbour",
  "Structure/Name/lib_Hbr1_0000F910=Harbour",
  "Variable/Name/lib_Hbr1_0000F911=Crates",
  "Variable/Name/lib_Hbr1_0000F913=Harbour Master",
  "Variable/Name/lib_Hbr1_0000F930=Tide",
  "Trigger/Name/lib_Hbr1_0000F920=Sound Foghorn",
  "Library/Name/Hbr1=Harbour Tools",
]
  .sort()
  .map((line, index) => (index === 0 ? `﻿${line}` : line))
  .concat([""])
  .join("\r\n");

export const SCRIPT_GALAXY = [
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
  ...SCRIPT_FUNCTIONS.flatMap((fn) => [...fn.galaxy, ""]),
  "// Triggers",
  "",
].join("\n");

export const SCRIPT_HEADER = [
  'include "TriggerLibs/natives"',
  "",
  "//--------------------------------------------------------------------------------------------------",
  "// Library: Harbour Tools",
  "//--------------------------------------------------------------------------------------------------",
  "// Function Declarations",
  ...SCRIPT_FUNCTIONS.map((fn) => fn.declaration),
  "",
  "// Trigger Declarations",
  "",
].join("\n");

/** Gives the imported package the script library, as if it had come with it. */
export async function withScriptLibrary(mod: Mod): Promise<void> {
  const files = {
    Triggers: SCRIPT_TRIGGERS,
    "enUS.SC2Data/LocalizedData/TriggerStrings.txt": SCRIPT_STRINGS,
    "Base.SC2Data/LibHbr1.galaxy": SCRIPT_GALAXY,
    "Base.SC2Data/LibHbr1_h.galaxy": SCRIPT_HEADER,
  };
  for (const [file, content] of Object.entries(files)) await put(path.join(mod.modPackage, ...file.split("/")), content);
}
