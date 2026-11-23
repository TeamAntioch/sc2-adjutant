import type { GuiCall, GuiParam, GuiValue } from "../domain/library-interface.js";
import { callGalaxy, type EnclosingCall, type GameLibrary, gameTriggerLibraries, type OwnWriter, type TemplateScope, UnrenderableGalaxyError } from "../mods/library-galaxy.js";
import { galaxyScope, isGameLibrary, TRIGGER_LIBRARIES, triggerLibraryScript, type SubFunctionDef, type TriggerLibrary } from "./trigger-catalog.js";
import {
  editorGlobalName,
  galaxyIdentifier,
  nestedCalls,
  treeOrder,
  triggerCalls,
  type ParamValue,
  type TriggerCall,
  type TriggerDocument,
  type TriggerParam,
  type TriggerVariable,
  type TriggerVariableType,
} from "./trigger-model.js";
import { formatFixed } from "./write-triggers-xml.js";

const RULE = "//--------------------------------------------------------------------------------------------------";
const BANNER = "//==================================================================================================";

export type WriteMapScriptOptions = {
  readonly mapName: string;
  readonly triggers: TriggerDocument;
  /** The libraries in reach of the map: the game's and its Workspace dependency mods' (librariesInReach); the game's alone when left out. */
  readonly libraries?: Readonly<Record<string, GameLibrary>>;
  /** Libraries the map's other triggers call beside the document's (a Blueprint's own triggers'): each is included too. */
  readonly uses?: readonly string[];
};

function triggerName(name: string): string {
  return `gt_${galaxyIdentifier(name)}`;
}

const GALAXY_TYPES: Record<TriggerVariableType, string> = {
  unit: "unit",
  unitgroup: "unitgroup",
  objective: "int",
  timer: "timer",
  int: "int",
  bool: "bool",
  fixed: "fixed",
  timerwindow: "int",
  dialog: "int",
  cutscene: "int",
  actor: "actor",
  sound: "sound",
  transmission: "int",
  point: "point",
};

/** Galaxy's own initial values, which the Editor leaves out of InitGlobals. */
export const GALAXY_DEFAULTS = new Set(["null", "0", "0.0", "false"]);

/** Bit positions of the c_targetFilter constants (TriggerLibs/GameData/Game.galaxy). */
const TARGET_FILTERS = [
  "Self", "Player", "Ally", "Neutral", "Enemy", "Air", "Ground", "Light", "Armored", "Biological", "Robotic",
  "Mechanical", "Psionic", "Massive", "Structure", "Hover", "Heroic", "", "Worker", "RawResource",
  "HarvestableResource", "Missile", "Destructible", "Item", "Uncommandable", "CanHaveEnergy", "CanHaveShields",
  "PreventDefeat", "PreventReveal", "Buried", "Cloaked", "Visible", "Stasis", "UnderConstruction", "Dead",
  "Revivable", "Hidden", "Hallucination", "Invulnerable", "HasEnergy", "HasShields", "Benign", "Passive",
  "Detector", "Radar", "Stunned", "Summoned", "Unstoppable", "Outer", "Resistant", "Silenced", "Dazed", "MapBoss",
  "Decaying", "Raisable", "HeroUnit", "NonBuildingUnit", "GroundUnit", "AirUnit", "Powerup", "PowerupOrItem",
  "NeutralHostile",
];

/** UnitFilter(requiredLow, requiredHigh, excludedLow, excludedHigh), each a sum of flag bits as the Editor writes them. */
export function renderUnitFilter(require: readonly string[], exclude: readonly string[]): string {
  const words = (names: readonly string[]): [string, string] => {
    const low: string[] = [];
    const high: string[] = [];
    for (const name of names) {
      const bit = TARGET_FILTERS.indexOf(name);
      if (bit < 0 || name === "") throw new Error(`Unknown unit filter flag ${name}`);
      if (bit < 32) low.push(`(1 << c_targetFilter${name})`);
      else high.push(`(1 << (c_targetFilter${name} - 32))`);
    }
    return [low.join(" | ") || "0", high.join(" | ") || "0"];
  };
  return `UnitFilter(${[...words(require), ...words(exclude)].join(", ")})`;
}

/** A unit filter as the Editor stores it, `<required>;<excluded>` (each a comma list, or `-` for none), as UnitFilter(…). */
export function renderUnitFilterText(text: string): string {
  const [require = "-", exclude = "-"] = text.split(";");
  const flags = (list: string): string[] => (list === "-" || list === "" ? [] : list.split(","));
  return renderUnitFilter(flags(require), flags(exclude));
}

/** A color as the Editor stores it, `<alpha>,<red>,<green>,<blue>` (each 0-255), as Color's percentages of its red, green and blue, or ColorWithAlpha's of all four. */
export function renderColor(text: string): string {
  const [alpha, red, green, blue] = text.split(",").map(Number);
  const percent = (channel: number | undefined): string => (((channel ?? 0) * 100) / 255).toFixed(2);
  // An opaque colour is Color; any other ColorWithAlpha, its alpha a percentage too (Editor saves: 0 is 0.00, 191 is 74.90).
  return alpha === 255 ? `Color(${percent(red)}, ${percent(green)}, ${percent(blue)})` : `ColorWithAlpha(${percent(red)}, ${percent(green)}, ${percent(blue)}, ${percent(alpha)})`;
}

/** Libraries whose functions or presets the document uses; Ntve is always included. */
function usedLibraries(doc: TriggerDocument, uses: readonly string[] = []): TriggerLibrary[] {
  const used = new Set<TriggerLibrary>(["Ntve", ...uses]);
  const visit = (call: TriggerCall): void => {
    used.add(call.def.library);
    for (const library of call.def.requires ?? []) used.add(library);
    for (const param of Object.values(call.params)) {
      if (param.value.kind === "preset") used.add(param.value.preset.library);
    }
    nestedCalls(call).forEach(visit);
  };
  for (const trigger of doc.triggers) triggerCalls(trigger).forEach(visit);
  // A Campaign Mod's library brings the game's libraries its dependencies hold (requires), as
  // An Editor-saved map includes SwarmLib and VoidCampaignMissionLib with its Campaign Mod's library; the mod's come after the game's.
  const mods = [...used].filter((library) => !isGameLibrary(library)).sort();
  return [...(Object.keys(TRIGGER_LIBRARIES) as TriggerLibrary[]).filter((library) => used.has(library)), ...mods];
}

/**
 * `text` as a Galaxy string literal: quotes and backslashes escaped. A control character (a line
 * break, a tab) is refused, since a value the Editor would hold has none.
 */
export function galaxyString(text: string): string {
  const control = /[\u0000-\u001f\u007f]/.exec(text);
  if (control) throw new Error(`The value ${JSON.stringify(text)} has a control character (${JSON.stringify(control[0])}), which a Galaxy string in a trigger can't hold: take it out`);
  return `"${text.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/** Refuses the compile's Galaxy of `subject` (the trigger gt_<name>, the map script), naming why. */
function refuseGalaxy(subject: string, reason: string): never {
  throw new Error(`The Galaxy of ${subject} can't be written: ${reason}`);
}

/** What a refusal of a call's Galaxy names: its trigger, or the map script for a global's initial value. */
const subjectOf = (at: Writing): string => (at.trigger ? `the trigger ${at.trigger}` : "the map script");

/**
 * Where a call is written: the trigger it is in, whether it is a parameter's value (where no
 * event binds to the trigger), the template calls it sits in, the trigger's automatic variables and
 * the libraries in reach of the map.
 */
type Writing = {
  readonly trigger: string;
  readonly inValue?: boolean;
  readonly enclosing: readonly EnclosingCall[];
  readonly autos: string[];
  readonly libraries: Readonly<Record<string, GameLibrary>>;
};

function renderValue(paramId: string, value: ParamValue, unitRef: boolean, at: Writing): string {
  switch (value.kind) {
    case "int":
      return String(value.value);
    case "fixed":
      return formatFixed(value.value);
    case "bool":
      return String(value.value);
    case "string":
      return galaxyString(value.value);
    case "modelanim":
    case "convline":
    case "water":
    case "actormsg":
      return galaxyString(value.value);
    case "preset":
      return value.preset.galaxy;
    case "text":
      return value.text === "" ? 'StringToText("")' : `StringExternal("Param/Value/${paramId}")`;
    case "gamelink":
      return galaxyString(value.value);
    case "soundlink":
      return `SoundLink(${galaxyString(value.sound)}, -1)`;
    case "point":
      return `PointFromId(${value.objectId})`;
    case "camerainfo":
      return `CameraInfoFromId(${value.objectId})`;
    case "color":
      return renderColor(value.value);
    case "unit":
      return unitRef ? `UnitRefFromUnit(UnitFromId(${value.objectId}))` : `UnitFromId(${value.objectId})`;
    case "variable":
      return unitRef ? `UnitRefFromVariable("${editorGlobalName(value.variable.name)}")` : editorGlobalName(value.variable.name);
    case "trigger":
      return value.trigger.scriptName ?? triggerName(value.trigger.name);
    case "filepath":
      return galaxyString(value.value);
    case "unitfilter":
      return renderUnitFilter(value.require, value.exclude);
    case "region":
      return `RegionFromId(${value.regionId})`;
    case "abilcmd":
      return `AbilityCommand(${galaxyString(value.ability)}, 0)`;
    case "call":
      return writeCall(value.call, "expression", { ...at, inValue: true })[0]!;
  }
}

/**
 * The compile's map scope for the template engine: it writes every value and every call in a slot
 * itself (`own`), so the engine writes only each call's own form and names nothing of the map's. A
 * variable's type is that of the map's variable the call is given (an #INITAUTOVAR of any type,
 * as Switch's value, is declared of it).
 */
function compiledScope(at: Writing, own: OwnWriter, variables: ReadonlyMap<string, TriggerVariable>): TemplateScope {
  const subject = subjectOf(at);
  const unnamed = (what: string) => (): never => refuseGalaxy(subject, `${what}, which the compile writes itself`);
  return {
    subject,
    library: undefined,
    libraries: at.libraries,
    ...(at.trigger && !at.inValue ? { triggerVariable: at.trigger } : {}),
    variable: unnamed("a variable"),
    member: unnamed("a structure member"),
    parameter: unnamed("a parameter"),
    trigger: unnamed("a trigger"),
    // The engine takes an Editor type: each Galaxy type here is also the Editor type it writes as
    // itself (an objective's, a dialog's int), which the compile's own names (timerwindow) aren't.
    variableType: (id) => {
      const variable = variables.get(id);
      return variable ? { type: GALAXY_TYPES[variable.type] } : undefined;
    },
    parameterType: unnamed("a parameter's type"),
    structureType: unnamed("a structure"),
    presetBase: unnamed("a preset type"),
    presetValue: unnamed("a preset value"),
    ownFunction: unnamed("a function of the map's"),
    text: unnamed("a text"),
    own,
  };
}

/** The compile's calls, parameters and variables behind the ones the engine is handed, for its own writer to write. */
type Sources = { readonly calls: Map<GuiCall, TriggerCall>; readonly params: Map<GuiParam, TriggerParam>; readonly variables: Map<string, TriggerVariable> };

/** A value as the engine tells values apart: a template's constant, a call's or a variable's. */
function guiValue(value: ParamValue, sources: Sources): GuiValue {
  switch (value.kind) {
    case "int":
      return { type: "int", value: String(value.value) };
    case "fixed":
      return { type: "fixed", value: formatFixed(value.value) };
    case "call":
      return { call: guiCall(value.call, sources) };
    case "variable":
      sources.variables.set(value.variable.id, value.variable);
      return { variable: value.variable.id };
    case "preset":
      return { preset: `${value.preset.library}/${value.preset.id}` };
    default:
      return { type: value.kind };
  }
}

/** A call as the engine reads one, each of its parameters and the calls in its slots noted in `sources` for the compile to write. */
function guiCall(call: TriggerCall, sources: Sources, sub?: SubFunctionDef): GuiCall {
  const params = Object.entries(call.def.params).map(([name, def]): GuiParam => {
    const param = call.params[name]!;
    const gui: GuiParam = { id: param.id, def: `${call.def.library}/${def.id}`, ...guiValue(param.value, sources) };
    sources.params.set(gui, param);
    return gui;
  });
  const body = (call.blocks ?? []).flatMap((block) => block.calls.map((nested) => guiCall(nested, sources, block.type)));
  const gui: GuiCall = {
    id: call.id,
    function: `${call.def.library}/${call.def.id}`,
    ...(sub ? { sub: `${sub.library}/${sub.id}` } : {}),
    ...(params.length ? { params } : {}),
    ...(body.length ? { body } : {}),
  };
  sources.calls.set(gui, call);
  return gui;
}

/**
 * A call's Galaxy: as a statement, its lines at no indentation (`notFirst` when it isn't the first
 * in its slot), or as an expression. A primitive with its own `galaxy` (a Plugin's, ADR-0005) is
 * written by it; any other from its template (ADR-0025), its values and the calls in its slots
 * written here. The variables its template declares go on `autos`.
 */
function writeCall(call: TriggerCall, as: "statement" | "expression", at: Writing, notFirst = false): string[] {
  const { def } = call;
  if (def.galaxy) {
    // Its own Galaxy is a call from its arguments: calls held in its blocks would be dropped.
    if (call.blocks?.some((block) => block.calls.length > 0)) refuseGalaxy(subjectOf(at), `its call ${call.id} to ${def.library}/${def.id} holds calls in blocks, which its own galaxy doesn't write`);
    const args = Object.fromEntries(Object.entries(def.params).map(([name, paramDef]) => [name, renderValue(call.params[name]!.id, call.params[name]!.value, paramDef.unitRef ?? false, at)]));
    const galaxy = def.galaxy(args, at.inValue ? "" : at.trigger, galaxyScope(at.enclosing));
    return [as === "statement" ? `${galaxy};` : galaxy];
  }
  const sources: Sources = { calls: new Map(), params: new Map(), variables: new Map() };
  const gui = guiCall(call, sources);
  const handedBack = <Gui, Own>(map: ReadonlyMap<Gui, Own>, of: Gui): Own => {
    const own = map.get(of);
    if (own === undefined) throw new Error(`The template engine handed back to ${at.trigger || "the map script"} a call or value the compile didn't give it`);
    return own;
  };
  const scope = compiledScope(at, {
    value: (value, unitRef, enclosing) => {
      const param = handedBack(sources.params, value as GuiParam);
      return renderValue(param.id, param.value, unitRef, { ...at, enclosing });
    },
    expression: (nested, enclosing) => writeCall(handedBack(sources.calls, nested), "expression", { ...at, enclosing })[0]!,
    statement: (nested, nestedNotFirst, enclosing) => writeCall(handedBack(sources.calls, nested), "statement", { ...at, enclosing }, nestedNotFirst),
  }, sources.variables);
  try {
    return callGalaxy(scope, gui, { as, notFirst, enclosing: at.enclosing, autos: at.autos });
  } catch (error) {
    // The engine names what it writes as a library function: the compile names its trigger.
    if (error instanceof UnrenderableGalaxyError) refuseGalaxy(subjectOf(at), error.reason);
    throw error;
  }
}

/**
 * A call's Galaxy as an expression where nowhere declares the variables its template would: a
 * condition's or an event's (an event is written in _Init) and a global's initial value. No
 * function of the game's that gives a value declares any of its own, so no Editor save shows where
 * they'd go (none of 460 in the game-data mirror and sc2-research): one that does is refused.
 */
function undeclaredExpression(call: TriggerCall, at: Writing, what: string): string {
  const autos: string[] = [];
  const galaxy = writeCall(call, "expression", { ...at, autos })[0]!;
  if (autos.length > 0) refuseGalaxy(subjectOf(at), `${what}, whose template declares variables, which no Editor save shows`);
  return galaxy;
}

/** A global's initial value as Galaxy. */
function initialValue(variable: TriggerVariable, libraries: Writing["libraries"]): string {
  const { id, value } = variable.initial;
  const at: Writing = { trigger: "", enclosing: [], autos: [], libraries };
  return value.kind === "call" ? undeclaredExpression(value.call, at, `the initial value of ${editorGlobalName(variable.name)}`) : renderValue(id, value, false, at);
}

/** A trigger's actions as Galaxy statements, indented in its function. */
const actionLines = (calls: readonly TriggerCall[], at: Writing): string[] =>
  calls.flatMap((call) => writeCall(call, "statement", at)).map((line) => (line === "" ? "" : `    ${line}`));

/**
 * A trigger's conditions block, from each condition's Galaxy expression, as the Editor writes it:
 * a blank line between each condition and the next, none after the last; nothing for no conditions.
 */
export function conditionsBlock(expressions: readonly string[]): string[] {
  if (expressions.length === 0) return [];
  return [
    "    // Conditions",
    "    if (testConds) {",
    ...expressions.flatMap((expression, index) => [
      ...(index > 0 ? [""] : []),
      `        if (!(${expression})) {`,
      "            return false;",
      "        }",
    ]),
    "    }",
    "",
  ];
}

/** Writes MapScript.galaxy as Editor 5.0.17 generates it from the same triggers (CRLF). */
export function writeMapScript(options: WriteMapScriptOptions): string {
  const { mapName, triggers: doc, libraries: inReach = gameTriggerLibraries(), uses } = options;
  // Globals and triggers in the folder tree's depth-first order, as the Editor writes them.
  const { variables, triggers } = treeOrder(doc);
  const hasGlobals = variables.length > 0;
  const libraries = usedLibraries(doc, uses).map(triggerLibraryScript);
  const lines: string[] = [
    BANNER,
    "// ",
    "// Generated Map Script",
    "// ",
    `// Name:   ${mapName}`,
    "// ",
    BANNER,
    ...libraries.map((library) => `include "${library.include}"`),
    "",
    RULE,
    "// Library Initialization",
    RULE,
    "void InitLibs () {",
    ...libraries.map((library) => `    ${library.init}();`),
    "}",
    "",
  ];

  if (hasGlobals) {
    lines.push(RULE, "// Global Variables", RULE);
    for (const variable of variables) {
      lines.push(`${GALAXY_TYPES[variable.type]} ${editorGlobalName(variable.name)};`);
    }
    lines.push("", "void InitGlobals () {");
    for (const variable of variables) {
      // A null initial value is Galaxy's default, so the Editor omits it.
      const initial = initialValue(variable, inReach);
      if (!GALAXY_DEFAULTS.has(initial)) {
        lines.push(`    ${editorGlobalName(variable.name)} = ${initial};`);
      }
    }
    lines.push("}", "");
  }

  lines.push(RULE, "// Trigger Variables", RULE);
  for (const trigger of triggers) {
    lines.push(`trigger ${triggerName(trigger.name)};`);
  }
  lines.push("");

  for (const trigger of triggers) {
    const name = triggerName(trigger.name);
    const autos: string[] = [];
    const at: Writing = { trigger: name, enclosing: [], autos, libraries: inReach };
    const actions = actionLines(trigger.actions, at);
    const conditions = (trigger.conditions ?? []).map((call) => undeclaredExpression(call, at, "a condition"));
    const events = trigger.events.map((call) => `    ${undeclaredExpression(call, at, "an event")};`);
    lines.push(
      RULE,
      `// Trigger: ${trigger.name}`,
      RULE,
      `bool ${name}_Func (bool testConds, bool runActions) {`,
      "    // Automatic Variable Declarations",
      ...(autos.length > 0 ? [...autos.map((declaration) => `    ${declaration}`), ""] : []),
      ...conditionsBlock(conditions),
      "    // Actions",
      "    if (!runActions) {",
      "        return true;",
      "    }",
      "",
      ...actions,
      "    return true;",
      "}",
      "",
      RULE,
      `void ${name}_Init () {`,
      `    ${name} = TriggerCreate("${name}_Func");`,
      // As the Editor writes an initially-off trigger: off before its events are added.
      ...(trigger.initiallyOff ? [`    TriggerEnable(${name}, false);`] : []),
      ...events,
      "}",
      "",
    );
  }

  lines.push(RULE, "// Trigger Initialization", RULE, "void InitTriggers () {");
  for (const trigger of triggers) {
    lines.push(`    ${triggerName(trigger.name)}_Init();`);
  }
  lines.push("}", "", RULE, "// Map Initialization", RULE, "void InitMap () {", "    InitLibs();");
  if (hasGlobals) {
    lines.push("    InitGlobals();");
  }
  lines.push("    InitTriggers();", "}", "");

  return lines.join("\r\n");
}
