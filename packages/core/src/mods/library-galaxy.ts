// A mod library's GUI functions as the Galaxy the Editor generates for them on save (ADR-0011), so
// a compile that writes a function's GUI writes its Galaxy too: Lib<id>.galaxy holds its
// definition, Lib<id>_h.galaxy its declaration.
//
// The Editor's generation is template-driven, and so is this: a function the game's libraries
// define with a ScriptCode template (If Then Else, Set Variable, Or) is written from it, its macros
// filled in; a native one as its identifier and arguments; an operator (a comparison, an
// arithmetic) as its operands either side of its operator; any other as lib<library>_gf_<identifier>(…).
// If Then Multiple, which has no template, is its If Thens one after another, each after the
// first an else if. The macros:
//
//   #PARAM(p)                 the value given for p;  #PARAM(p,"sep") each value given for a
//                             repeated p, joined by sep (Combine Strings), a separator of
//                             literals and #PARAMs (" " #PARAM(op) " ", the Arithmetic Multiples)
//                             filled in too
//   #SUBFUNCS(slot)           a slot's statements;  #SUBFUNCS(slot,"sep") its conditions, joined
//   #IFHAVESUBFUNCS(slot,x)   x when the slot holds a statement
//   #IFSUBFUNC(notfirst,x)    x when the call isn't the first in its parent's slot
//   #AUTOVAR(v[, type])       the call's own variable auto<call id>_v (int when no type is
//                             given), declared under Automatic Variable Declarations;
//                             #AUTOVAR(v,parent) and #AUTOVAR(v,ancestor:<identifier>) the one of
//                             the call's parent, or of its nearest enclosing call to that function
//   #INITAUTOVAR(v,p)         the call's own variable v, of p's type, set to p's value first
//   #SMARTBREAK               Stop Looping: break; inside a block that allows it (allowBreak,
//                             a loop's), nothing outside one
//
// The game's definitions come from data/trigger-libraries.json (scripts/build-trigger-libraries.mjs), the mod library's own from
// its interface or, for a function still Kept, from the package's Triggers. Names follow the
// Editor's rules: lp_ for a parameter, lv_ for a local and lib<library>_gv_ for a global, each its
// identifier (else its name's) started lower case. An indexed value is its variable's name, its
// indexes, then its structure member's (lib<id>_gv_regions[lv_i].lv_unit); an array variable is
// declared with each size one more than the Editor's (int[4] for 3, [lib<id>_gv_<count> + 1] for a
// constant's), and a constant one with its value.
//
// A text value is StringExternal of its GameStrings key, or StringToText("") for an empty one
// (textGalaxy). An expression (Arithmetic, Expression) is its text in parentheses, each `~<code>~`
// slot its value: an int or fixed one's text as it stands, a string one's runs of text quoted and
// joined to its slots' values by " + " (expressionGalaxy). A text expression's words are in
// GameStrings, so each slot is a TextExpressionSetToken line before the statement it is in, and its
// value is TextExpressionAssemble of its key (textExpressionGalaxy). Custom Script (Ntve/00000123) is its own text; a function that runs in its own
// thread is its parameters stored in globals and a trigger run, created once, whose function holds
// the body (threadedGalaxy, which the Kept renderer writes a map's with). A deprecated function's
// statements are headed "// Deprecated" in place of "// Implementation", and a function with no
// actions has neither line; Bank Preload writes no statement; a Section changes nothing.
// An inline function has a definition of its own, and its value is written in place of a call to it.
//
// What it can't write as the Editor would (a call it has no definition for, a template macro it
// doesn't know or one in a form it doesn't match, a call in a slot its template doesn't write, an
// #INITAUTOVAR of a constant other than an int or fixed, a block with no template but If Then
// Multiple, a thread function returning a value, custom script where a value is wanted) is refused, naming it,
// rather than guessed.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type ArrayBound, type ExpressionSlot, type GuiBody, type GuiCall, type GuiExpression, type GuiParam, type GuiStatement, type GuiValue, type GuiVariable, type HeldValue, isComment, type LibraryCustomScript, type LibraryFunction, type StructMember, type TypeSpec } from "../domain/library-interface.js";
import { galaxyIdentifier } from "../triggers/trigger-model.js";
import { renderColor, renderUnitFilterText } from "../triggers/write-map-script.js";
import { xmlAttribute, type XmlNode } from "../util/xml.js";
import { arrayBoundOf, elementIdOf, type LibraryElements, libraryElementOf, libraryStringKey, paramExpressionKey, paramValueKey, readLibraryFunction, UnconvertibleFunctionError } from "./library-xml.js";

export type GameFunction = {
  /** Its name, hint and category (its categories' names from the outermost, joined by " > "), as the Editor's function list shows them: for search (function-search.ts), not Galaxy. */
  readonly name?: string;
  readonly hint?: string;
  readonly category?: string;
  readonly identifier?: string;
  readonly flags: readonly string[];
  readonly params: readonly string[];
  readonly returns?: TypeSpec;
  readonly subFunctions?: readonly string[];
  readonly script?: string;
};
/**
 * A parameter definition: its Galaxy name, its type and its name as the Editor shows it (a game link's
 * type names its catalog, gameType), and the value a new call gives it (`default`, the library's form:
 * its library's elements as `<library>/<id>`), which the authoring tool fills in where none is given.
 */
export type GameParameter = { readonly identifier?: string; readonly name?: string; readonly type?: string; readonly element?: string; readonly gameType?: string; readonly default?: HeldValue };
/** A library's global, or a member of one of its structures: its Galaxy name, its name as the Editor shows it (for the authoring tool), and its type where it can be read. */
export type LibraryVariable = { readonly galaxy: string; readonly name?: string; readonly member?: true; readonly structure?: string; readonly type?: TypeSpec };

export type GameLibrary = {
  /** Its name, as the Editor shows it (Library/Name: Built-In, Swarm). */
  readonly name?: string;
  readonly functions: Readonly<Record<string, GameFunction>>;
  /** Each parameter's Galaxy name and type, and its name as the Editor shows it. A game link's type names its catalog (gameType). */
  readonly params: Readonly<Record<string, GameParameter>>;
  /** Each preset value's Galaxy value, and its name as the Editor shows it (PresetValue/Name), for the authoring tool. */
  readonly presetValues: Readonly<Record<string, { readonly identifier?: string; readonly name?: string; readonly value: string }>>;
  /** Each preset type's base type and name, and its values (the library's own, by Id, in the Editor's order), for the authoring tool. */
  readonly presets: Readonly<Record<string, { readonly identifier?: string; readonly name?: string; readonly base?: string; readonly bits?: boolean; readonly values?: readonly string[] }>>;
  /** Each block slot's identifier (#SUBFUNCS(<identifier>) in a template). */
  readonly subFunctions: Readonly<Record<string, string>>;
  /** Each block slot's name as the Editor shows it (If, Then, Else) and what it holds, for the authoring tool. */
  readonly slots?: Readonly<Record<string, { readonly name: string; readonly holds?: "action" | "condition" }>>;
  /**
   * The words of each text its parameters' defaults hold, by the Id of the value holding it
   * (Param/Value/lib_<library>_<id> in its GameStrings), "" for an empty one, for the authoring
   * tool: a call that leaves such a parameter out takes them. A text absent here has words unknown.
   */
  readonly defaultTexts?: Readonly<Record<string, string>>;
  /**
   * A mod library's globals and its structures' members (library-reach.ts), which a map's trigger
   * may name as `<library>/<id>`: each with its Galaxy name (`lib<id>_gv_heroUnit`, a member's
   * `lv_artanis`) and its type where it can be read. The game's library data holds none.
   */
  readonly variables?: Readonly<Record<string, LibraryVariable>>;
  /** Why every call into this library is refused (library-reach.ts): its mod's package can't be read, or another mod's library has its id. A clause: "the library Cmpn of the mod cmpn-story can't be read: …". */
  readonly refused?: string;
  /** A mod library's functions whose definition can't be read (library-reach.ts), with why: a call to one is refused naming it. */
  readonly unreadable?: Readonly<Record<string, string>>;
};

const DATA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/trigger-libraries.json");
let loaded: { readonly types: Readonly<Record<string, string>>; readonly libraries: Readonly<Record<string, GameLibrary>> } | undefined;
const gameData = () => (loaded ??= JSON.parse(readFileSync(DATA_PATH, "utf8")));
/** The game's trigger libraries (Ntve, Hots), as data/trigger-libraries.json holds them. */
export const gameTriggerLibraries = (): Readonly<Record<string, GameLibrary>> => gameData().libraries;
/** The Editor's name of each trigger type (unitgroup: Unit Group), as data/trigger-libraries.json holds them. */
export const gameTriggerTypeNames = (): Readonly<Record<string, string>> => gameData().types;

/** A function whose Galaxy can't be written as the Editor would: why. */
export class UnrenderableGalaxyError extends Error {
  readonly functionName: string;
  readonly reason: string;
  /** Where the refusal is a call into a refused library in reach (GameLibrary's `refused`), why that library is refused. */
  readonly refused: string | undefined;

  constructor(functionName: string, reason: string, refused?: string) {
    super(`The Galaxy of the library function ${functionName} can't be written: ${reason}`);
    this.functionName = functionName;
    this.reason = reason;
    this.refused = refused;
    this.name = "UnrenderableGalaxyError";
  }
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
const quote = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Galaxy types of the Editor's parameter and variable types. */
const GALAXY_TYPES: Readonly<Record<string, string>> = {
  int: "int",
  fixed: "fixed",
  bool: "bool",
  string: "string",
  text: "text",
  unit: "unit",
  unitgroup: "unitgroup",
  point: "point",
  region: "region",
  timer: "timer",
  playergroup: "playergroup",
  sound: "sound",
  soundlink: "soundlink",
  actor: "actor",
  actorscope: "actorscope",
  camerainfo: "camerainfo",
  color: "color",
  trigger: "trigger",
  transmissionsource: "transmissionsource",
  wave: "wave",
  order: "order",
  abilcmd: "abilcmd",
  bank: "bank",
  revealer: "revealer",
  doodad: "doodad",
  // Ids the Editor holds as ints.
  portrait: "int",
  transmission: "int",
  dialog: "int",
  control: "int",
  objective: "int",
  player: "int",
  cinematic: "int",
  difficulty: "int",
  playercolor: "int",
  // Names and links the Editor holds as strings.
  convline: "string",
  conversation: "string",
  modelanim: "string",
  gamelink: "string",
  catalogfieldpath: "string",
  catalogfieldname: "string",
  catalogentry: "string",
  userinstance: "string",
  usertype: "string",
  userfield: "string",
  filepath: "string",
  anyvariable: "string",
};

/** A template's call variables: #AUTOVAR(v), #AUTOVAR(v, type or parent or ancestor:<identifier>) and #INITAUTOVAR(v, p). */
const AUTOVAR = /#(INIT)?AUTOVAR\(\s*(\w+)\s*(?:,\s*([^)]*?))?\s*\)/g;

/** The game's operators written as their operands either side of the operator they're given. */
const BINARY_OPERATORS: ReadonlySet<string> = new Set(["Comparison", "ArithmeticInt", "ArithmeticReal"]);

/**
 * An event's unit parameters whose native takes a unit, not a reference to one (natives.galaxy's
 * `unit`, not `unitref`): Unit Enters Range Of Unit's other unit, which Editor saves write as
 * UnitFromId(…). Every other event's unit is a reference.
 */
const EVENT_PLAIN_UNITS: ReadonlySet<string> = new Set(["Ntve/A30297E7"]);

/** The template macros the engine fills in; a template using any other is refused. */
const MACROS: ReadonlySet<string> = new Set(["PARAM", "SUBFUNCS", "IFHAVESUBFUNCS", "IFSUBFUNC", "AUTOVAR", "INITAUTOVAR", "SMARTBREAK"]);

/** Custom Script, the action whose Galaxy is its own text (`<ScriptCode>`), written as it stands. */
const CUSTOM_SCRIPT = "customscriptaction";

/**
 * Bank Preload, an action the Editor writes no statement for: the bank it names is preloaded by the
 * package (BankList.xml), not the script (Void Prologue's Load Campaign Data, Challenges' Load
 * Challenge Data, Legacy of the Void's pulnar02).
 */
const BANK_PRELOAD = "Ntve/7D278C76";

/** Literals equal to what Galaxy starts a variable with: the Editor writes no initialization for them. */
const ZERO: Readonly<Record<string, readonly string[]>> = { int: ["0"], fixed: ["0", "0.0"], bool: ["false"] };

/** The mod library's own elements, as the compile knows them: its interface's functions and the package's Triggers and strings. */
export type LibraryScope = {
  readonly library: string;
  /** The Blueprint's functions, by id: their interface and GUI body. */
  readonly functions: ReadonlyMap<string, { readonly fn: LibraryFunction; readonly body?: GuiBody }>;
  /** The package's library elements, by type and Id (Kept functions, globals, presets). */
  readonly elements: LibraryElements;
  /** The package's TriggerStrings. */
  readonly strings: ReadonlyMap<string, string>;
  /**
   * The keys of the library's text values and text expressions that hold text, with their words
   * (keysWithText): a text parameter without one is empty. Each text value is taken to hold text
   * when left out; a text expression, whose words name the slots it sets, is refused.
   */
  readonly texts?: ReadonlyMap<string, string>;
  /** The libraries in reach: the game's and the mod's dependencies' (library-reach.ts dependencyReach); the game's alone when not given. */
  readonly libraries?: Readonly<Record<string, GameLibrary>>;
  /** The mod packages the mod depends on that weren't found, by name, and where they were looked for, for a refused call to name. */
  readonly unreached?: Unreached;
};

/** The mod packages a mod depends on that weren't found, by name: in its Workspace's mods, or outside one, the game's (library-reach.ts dependencyReach). */
export type Unreached = { readonly mods: readonly string[]; readonly inWorkspace: boolean };

/** What a call names, as the engine writes a call to it: its Galaxy name, parameters, template and block slots. */
export type TemplateCallee = {
  readonly name: string;
  readonly identifier: string;
  readonly flags: readonly string[];
  /** Its parameters in its definition's order: each as `<library>/<id>`, with its template identifier and type. */
  readonly params: readonly { readonly id: string; readonly identifier: string; readonly type?: TypeSpec }[];
  readonly returns?: TypeSpec;
  readonly script?: string;
  /** Its block slots, `<library>/<id>` to the identifier its template names it by. */
  readonly subs: ReadonlyMap<string, string>;
  /** An inline function's definition, with the scope its value is written in. */
  readonly inline?: { readonly fn: LibraryFunction; readonly body?: GuiBody; readonly scope: TemplateScope };
  /** Defined by a library in reach (the game's), not the scope's own. */
  readonly game?: boolean;
};

/**
 * A template call the one being written sits in: what #AUTOVAR(v,parent) and (v,ancestor:…) name,
 * and whether it is a block a Stop Looping in it breaks out of (its function's `allowBreak`).
 */
export type EnclosingCall = { readonly call: Pick<GuiCall, "id">; readonly identifier: string; readonly allowBreak?: boolean };

/**
 * What a scope writes itself, ahead of the templates. A scope that has it writes every value and
 * every call in a slot of the call it hands the engine (the Kept renderer, from core's catalog or,
 * for a function the catalog lacks, the engine again): the engine writes only that call's own form.
 */
export type OwnWriter = {
  /** A value given for a parameter of a call inside `enclosing` (that call last); `unitRef` where an event takes a reference to a unit. */
  value(value: GuiValue & { readonly id?: string }, unitRef: boolean, enclosing: readonly EnclosingCall[]): string;
  /** A call in a condition slot or given as a value, inside `enclosing`. */
  expression(call: GuiCall, enclosing: readonly EnclosingCall[]): string;
  /** A statement in a block's slot, at no indentation: `notFirst` when it isn't the first in its slot. */
  statement(call: GuiCall, notFirst: boolean, enclosing: readonly EnclosingCall[]): string[];
};

/**
 * Where Galaxy is written: what the engine needs of a mod library or a map beyond the game's
 * functions. The engine takes it and doesn't know which it serves (#937).
 */
export type TemplateScope = {
  /** What a refusal names as being written: a library function's name, or a map trigger's. */
  readonly subject: string;
  /**
   * The library a reference without one names. A mod library's own references carry `Library`, so
   * this is its id; a map's own carry none, so it is undefined there and a bare reference is the map's.
   */
  readonly library: string | undefined;
  /**
   * The libraries in reach whose functions, presets and slots are written from their data: the
   * game's (Ntve, Hots) and its dependency mods' (library-reach.ts).
   */
  readonly libraries: Readonly<Record<string, GameLibrary>>;
  /** The dependencies not found, by name: a call to a library not in reach names them. */
  readonly unreached?: Unreached;
  /** The trigger variable an event binds to, its first argument (`gt_<name>` in a map); undefined where no trigger is written. */
  readonly triggerVariable?: string;
  /** The Galaxy name of a variable of the scope: gv_/lv_ in a map, lib<id>_gv_/lv_ in a library. */
  variable(id: string): string;
  /** The Galaxy name of a structure's member, after the `.` that follows the structure: lv_<name>. */
  member(id: string): string;
  /** The Galaxy name of a parameter of the function being written: lp_<identifier>. */
  parameter(id: string): string;
  /** The Galaxy name of a trigger of the scope: gt_ in a map, lib<id>_gt_ in a library. */
  trigger(id: string): string;
  /** The Editor type of a variable or a parameter of the scope, where it has one: a template variable is typed by its value. */
  variableType(id: string): TypeSpec | undefined;
  parameterType(id: string): TypeSpec | undefined;
  /** The Galaxy type of a structure of the scope's own: lib<id>_gs_<identifier> in a library. */
  structureType(id: string): string;
  /** The base type and the values of a preset type of the scope's own. */
  presetBase(id: string): string;
  presetValue(id: string): string;
  /** One of the scope's own functions, as a call to it needs it. */
  ownFunction(id: string): TemplateCallee;
  /** The Galaxy of the text value the scope's Param `id` holds (textGalaxy). */
  text(id: string): string;
  /** The GameStrings key and the words of the text expression the scope's Param `id` holds: refused for one with none. Absent where no text expression is written. */
  textExpression?(id: string): TextExpressionWords;
  /** Values and calls in a slot the scope writes itself; without it, the engine writes everything. */
  readonly own?: OwnWriter;
};


const attr = xmlAttribute;
const childOf = (node: XmlNode, name: string): XmlNode | undefined => node.children.find((child) => child.name === name);

/**
 * A text value's Galaxy, as the Editor writes it: its words are in GameStrings under `key`
 * (Param/Value/<id>, a library's Param/Value/lib_<library>_<id>), so it is StringExternal of the key,
 * or StringToText("") where `texts`, the keys that hold text, lacks it: an empty text, whose key
 * holds nothing or is absent. Each key is taken to hold text when `texts` isn't known.
 */
export const textGalaxy = (key: string, texts: ReadonlyMap<string, string> | undefined): string => (texts && !texts.has(key) ? 'StringToText("")' : `StringExternal(${quote(key)})`);

/**
 * An int, fixed or string expression's Galaxy, as the Editor writes it, `slot` writing each slot's
 * value: its text in parentheses, each `~<code>~` the value of the slot of that code. An int or
 * fixed expression's text stands as it is (`(lv_count-1)`); a string one's runs of text are string
 * literals, as they stand, joined to the slots' values by " + " (`("CC_L_" + (lp_planet))`). A slot
 * the text doesn't name, a code no slot has, a line break, or a quote in a string's text are refused.
 */
export function expressionGalaxy(expression: GuiExpression, slot: (slot: ExpressionSlot) => string, fail: (reason: string) => never): string {
  const text = expression.text ?? "";
  // Odd parts are the slots' codes, between their tildes.
  const parts = text.split(/~([^~]*)~/);
  const codes = parts.filter((_, at) => at % 2 === 1);
  const slots = new Map(expression.slots.map((given) => [given.code, given]));
  if (slots.size !== expression.slots.length) fail(`a ${expression.type} expression "${text}" with two slots of one code`);
  const unused = expression.slots.find((given) => !codes.includes(given.code));
  if (unused) fail(`a ${expression.type} expression "${text}" whose text has no slot ~${unused.code}~`);
  const missing = codes.find((code) => !slots.has(code));
  if (missing !== undefined) fail(`a ${expression.type} expression "${text}" with no value for its slot ~${missing}~`);
  if (/[\r\n]/.test(text)) fail(`a ${expression.type} expression over more than one line, whose Galaxy no Editor save shows`);
  if (text === "") fail(`an empty ${expression.type} expression, whose Galaxy no Editor save shows`);
  const values = new Map(expression.slots.map((given) => [given.code, slot(given)]));
  switch (expression.type) {
    case "int":
    case "fixed":
      return `(${parts.map((part, at) => (at % 2 === 1 ? values.get(part)! : part)).join("")})`;
    case "string": {
      if (text.includes('"')) fail(`a string expression "${text}" holding a quote, whose Galaxy no Editor save shows`);
      const pieces = parts.flatMap((part, at) => (at % 2 === 1 ? [values.get(part)!] : part === "" ? [] : [`"${part}"`]));
      return `(${pieces.join(" + ")})`;
    }
    default:
      return fail(`a ${expression.type} expression, whose Galaxy this doesn't write yet`);
  }
}

/** A text expression's GameStrings key and its words there, with the `~<code>~` slots they name. */
export type TextExpressionWords = { readonly key: string; readonly words: string };

/** A text expression's key and its words, from `texts` (keysWithText): refused where they aren't known, or it has none, as no Editor save shows its Galaxy. */
export function textExpressionWords(key: string, texts: ReadonlyMap<string, string> | undefined, fail: (reason: string) => never): TextExpressionWords {
  if (!texts) return fail(`the text expression ${key}, whose words aren't known`);
  const words = texts.get(key);
  return words === undefined ? fail(`the text expression ${key}, whose words are empty, whose Galaxy no Editor save shows`) : { key, words };
}

/**
 * A text expression's Galaxy, as the Editor writes it: its words are in GameStrings under `key`, so
 * its value is TextExpressionAssemble of the key, and each slot its words name, in the Editor's
 * order, is set first by a TextExpressionSetToken line before the statement it is in, added to the
 * innermost of `frames` (the statements being written, withTokens). A slot its words don't name is
 * given no line (Void Prologue's "Create Objective (Campaign)"). Refused: a code its words name that
 * no slot has, two slots of one code, a text expression outside a statement, or in another's slot.
 */
export function textExpressionGalaxy(
  frames: readonly string[][],
  { key, words }: TextExpressionWords,
  expression: GuiExpression,
  slot: (slot: ExpressionSlot) => string,
  fail: (reason: string) => never,
): string {
  const frame = frames.at(-1) ?? fail("a text expression outside a statement, whose Galaxy no Editor save shows");
  const codes = new Set([...words.matchAll(/~([^~]*)~/g)].map((match) => match[1]!));
  if (new Set(expression.slots.map((given) => given.code)).size !== expression.slots.length) fail(`the text expression ${key}, with two slots of one code`);
  const missing = [...codes].find((code) => !expression.slots.some((given) => given.code === code));
  if (missing !== undefined) fail(`the text expression ${key}, with no value for its slot ~${missing}~`);
  const before = frame.length;
  const tokens = expression.slots.filter((given) => codes.has(given.code)).map((given) => `TextExpressionSetToken(${quote(key)}, ${quote(given.code)}, ${slot(given)});`);
  if (frame.length !== before) fail("a text expression in another text expression's slot, whose Galaxy no Editor save shows");
  frame.push(...tokens);
  return `TextExpressionAssemble(${quote(key)})`;
}

/**
 * A statement's lines as `write` gives them, after the TextExpressionSetToken lines of the text
 * expressions it is given (textExpressionGalaxy, on a frame of `frames` of its own). A block's own
 * values and conditions (`block`) are refused them, no save showing where they go; the statements
 * in its slots set their own.
 */
export function withTokens(frames: string[][], block: () => boolean, write: () => string[], fail: (reason: string) => never): string[] {
  const tokens: string[] = [];
  frames.push(tokens);
  let lines: string[];
  try {
    lines = write();
  } finally {
    frames.pop();
  }
  if (tokens.length && block()) fail("a text expression given to a block itself (an If's condition, a loop's bound), whose Galaxy no Editor save shows");
  return [...tokens, ...lines];
}

/** The Galaxy name of a library function: lib<library>_gf_<identifier>, or the bare identifier of a native one or one with FlagNoScriptPrefix (Ntve's Play Sound). */
export function libraryFunctionName(library: string, fn: Pick<LibraryFunction, "identifier" | "name"> & { readonly flags: readonly string[] }): string {
  const identifier = fn.identifier ?? galaxyIdentifier(fn.name);
  return fn.flags.includes("native") || fn.flags.includes("noScriptPrefix") ? identifier : `lib${library}_gf_${identifier}`;
}

/** The library in reach a `<library>/<id>` reference names, and the id. */
const reachable = (scope: Pick<TemplateScope, "libraries">, ref: string): [GameLibrary | undefined, string | undefined] => {
  const [lib, id] = ref.split("/");
  return [scope.libraries[lib!], id];
};

/** The function `ref` (`<library>/<id>`) names in the libraries in reach, or undefined. */
export function reachableFunction(scope: Pick<TemplateScope, "libraries">, ref: string): GameFunction | undefined {
  const [library, id] = reachable(scope, ref);
  return id === undefined ? undefined : library?.functions[id];
}

/** The Galaxy of the preset value `ref` (`<library>/<id>`) a library in reach defines, or undefined. */
export function reachablePresetValue(scope: Pick<TemplateScope, "libraries">, ref: string): string | undefined {
  const [library, id] = reachable(scope, ref);
  const value = id === undefined ? undefined : library?.presetValues[id]?.value;
  return value === "" ? undefined : value;
}

/** Whether `ref` (`<library>/<id>`) is a preset type of bits a library in reach defines: a value with none set is 0. */
export const reachableBitsPreset = (scope: Pick<TemplateScope, "libraries">, ref: string): boolean => {
  const [library, id] = reachable(scope, ref);
  return id !== undefined && library?.presets[id]?.bits === true;
};

/**
 * The constant the Editor generates for a preset value with no value of its own, named by its
 * preset type's identifier and its own: lib<library>_ge_<type>_<value>, a map's ge_<type>_<value>.
 */
export const presetConstant = (library: string | undefined, type: string, value: string): string => `${library ? `lib${library}_` : ""}ge_${type}_${value}`;

/** A sound link's Galaxy: its ValueId is one more than the variation's index, and with none it plays any (-1). */
export const soundLinkGalaxy = (sound: string, valueId: string | undefined): string => `SoundLink(${quote(sound)}, ${valueId === undefined ? -1 : Number(valueId) - 1})`;

/** A refusal of `subject`'s Galaxy. */
const refuse = (subject: string, reason: string, refused?: string): never => {
  throw new UnrenderableGalaxyError(subject, reason, refused);
};

/**
 * A mod library's scope for writing `fn`: its parameters lp_, its body's variables lv_, the
 * library's globals lib<id>_gv_ and triggers lib<id>_gt_, its own functions read from the
 * Blueprint or, for one still Kept, the package's Triggers.
 */
export function libraryTemplateScope(scope: LibraryScope, fn: LibraryFunction, body: GuiBody): TemplateScope {
  const subject = fn.name;
  const fail = (reason: string): never => refuse(subject, reason);
  const own = new Map(fn.parameters.map((parameter) => [parameter.id, `lp_${lowerFirst(parameter.identifier ?? galaxyIdentifier(parameter.name))}`]));
  const locals = new Map(body.variables.map((variable) => [variable.id, variable]));
  /** One of the library's own elements of `type`, with its Identifier (if given) and its name: refused, as `what`, where the package lacks it. */
  const ownElement = (type: string, id: string, what: string): { readonly identifier?: string; readonly name: string } => {
    const node = libraryElementOf(scope.elements, type, id);
    const name = scope.strings.get(libraryStringKey(scope.library, type, "Name", id));
    if (!node || name === undefined) fail(what);
    const identifier = childOf(node!, "Identifier")?.text.trim();
    return { name: name!, ...(identifier ? { identifier } : {}) };
  };
  /** A Kept function of the library, read from the package's Triggers: refused, naming it, where it can't be. */
  const kept = (id: string, interfaceOnly: boolean): { readonly fn: LibraryFunction; readonly body?: GuiBody } => {
    try {
      return readLibraryFunction(scope.elements, scope.strings, scope.library, id, { interfaceOnly });
    } catch (error) {
      if (error instanceof UnconvertibleFunctionError) fail(`it calls ${interfaceOnly ? "" : "the inline function "}${scope.library}/${id}, whose definition can't be read: ${error.reason}`);
      throw error;
    }
  };
  return {
    subject,
    library: scope.library,
    libraries: scope.libraries ?? gameTriggerLibraries(),
    ...(scope.unreached?.mods.length ? { unreached: scope.unreached } : {}),
    variable: (id) => {
      const local = locals.get(id);
      if (local) return `lv_${lowerFirst(local.identifier ?? galaxyIdentifier(local.name))}`;
      const { identifier, name } = ownElement("Variable", id, `the variable ${id}, which is neither the function's nor a global of the library`);
      return `lib${scope.library}_gv_${identifier ?? lowerFirst(galaxyIdentifier(name))}`;
    },
    member: (id) => {
      const { identifier, name } = ownElement("Variable", id, `the structure member ${id}, which the library doesn't hold`);
      // No Editor sample has a member with an identifier of its own: a global keeps its as given, a local starts its lower case.
      if (identifier !== undefined) fail(`the structure member ${id}, which has an identifier of its own (${identifier}), whose Galaxy name this doesn't write yet`);
      return `lv_${lowerFirst(galaxyIdentifier(name))}`;
    },
    parameter: (id) => own.get(id) ?? fail(`the parameter ${id}, which isn't the function's`),
    trigger: (id) => {
      const { identifier, name } = ownElement("Trigger", id, `the trigger ${id}, which the library doesn't hold`);
      return `lib${scope.library}_gt_${identifier ?? galaxyIdentifier(name)}`;
    },
    variableType: (id) => {
      const local = locals.get(id);
      if (local) return local.type;
      // One of the package's variables (a global, a structure's member), from its VariableType.
      const node = libraryElementOf(scope.elements, "Variable", id);
      const type = node && childOf(node, "VariableType");
      const value = type && childOf(type, "Type");
      const element = type && childOf(type, "TypeElement");
      const name = value && attr(value, "Value");
      if (!name) return undefined;
      const lib = element && attr(element, "Library");
      const elementId = element && attr(element, "Id");
      // Its dimensions, so a value indexing it is typed as its element is.
      const array = type.children
        .filter((bound) => bound.name === "ArraySize")
        .map((bound, dim): ArrayBound => {
          const read = arrayBoundOf((attribute) => attr(bound, attribute), dim);
          return "refused" in read ? fail(`the variable ${id}'s size: ${read.refused}`) : read;
        });
      return { type: name, ...(lib && elementId ? { element: `${lib}/${elementId}` } : {}), ...(array.length ? { array } : {}) };
    },
    parameterType: (id) => fn.parameters.find((parameter) => parameter.id === id)?.type,
    text: (id) => textGalaxy(paramValueKey(scope.library, id), scope.texts),
    textExpression: (id) => textExpressionWords(paramExpressionKey(scope.library, id), scope.texts, fail),
    structureType: (id) => {
      const node = libraryElementOf(scope.elements, "Structure", id);
      const name = scope.strings.get(libraryStringKey(scope.library, "Structure", "Name", id));
      if (!node || name === undefined) fail(`the structure ${scope.library}/${id}, which the library doesn't hold`);
      return `lib${scope.library}_gs_${childOf(node!, "Identifier")?.text.trim() ?? galaxyIdentifier(name!)}`;
    },
    presetBase: (id) => {
      const node = libraryElementOf(scope.elements, "Preset", id);
      const base = node && childOf(node, "BaseType");
      if (!base) fail(`the preset type ${scope.library}/${id}, which the library doesn't hold`);
      return GALAXY_TYPES[attr(base!, "Value") ?? ""] ?? fail(`the preset type ${scope.library}/${id}'s base type`);
    },
    presetValue: (id) => {
      const node = libraryElementOf(scope.elements, "PresetValue", id);
      if (!node) fail(`the preset value ${scope.library}/${id}, which the library doesn't hold`);
      const value = childOf(node!, "Value")?.text.trim();
      const owner = [...scope.elements.values()].find((element) => attr(element, "Type") === "Preset" && element.children.some((item) => item.name === "Item" && attr(item, "Type") === "PresetValue" && attr(item, "Id") === id));
      // A value with none of its own, or one of a set of bits (Swarm Story Util's Swarm Story Fade Style), is the constant the
      // Editor generates for it, named by its preset type and itself.
      if (value && !(owner && childOf(owner, "PresetAsBits"))) return value;
      if (!owner) fail(`the preset value ${scope.library}/${id}, which no preset type of the library holds`);
      const named = (type: string, at: string): string => {
        const { identifier, name } = ownElement(type, at, `the ${type === "Preset" ? "preset type" : "preset value"} ${scope.library}/${at}, which has no name`);
        return identifier ?? galaxyIdentifier(name);
      };
      return presetConstant(scope.library, named("Preset", elementIdOf(owner!)), named("PresetValue", id));
    },
    ownFunction: (id) => {
      const lib = scope.library;
      const { fn: callee } = scope.functions.get(id) ?? kept(id, true);
      // Only an inline function's value is written in its place, so only its body is read; an inline action is called.
      const inline = callee.flags.includes("inline") && callee.returns ? (scope.functions.get(id) ?? kept(id, false)) : undefined;
      return {
        name: libraryFunctionName(lib, callee),
        identifier: callee.identifier ?? galaxyIdentifier(callee.name),
        flags: callee.flags,
        params: callee.parameters.map((parameter) => ({ id: `${lib}/${parameter.id}`, identifier: parameter.identifier ?? lowerFirst(galaxyIdentifier(parameter.name)), type: parameter.type })),
        ...(callee.returns ? { returns: callee.returns } : {}),
        ...(callee.script !== undefined ? { script: callee.script } : {}),
        subs: new Map(callee.subFunctions.map((slot) => [`${lib}/${slot.id}`, slot.identifier ?? lowerFirst(galaxyIdentifier(slot.name))])),
        ...(inline ? { inline: { ...inline, scope: libraryTemplateScope(scope, inline.fn, inline.body ?? { variables: [], actions: [] }) } } : {}),
      };
    },
  };
}

/** Whether a variable value, or any structure member on its path, is indexed. */
const hasIndex = (value: { readonly index?: readonly HeldValue[] | undefined; readonly member?: StructMember | undefined }): boolean => Boolean(value.index?.length) || (value.member !== undefined && hasIndex(value.member));

/** Writes calls to the game's functions, and a scope's own, from their templates, in a scope. */
class TemplateEngine {
  private readonly scope: TemplateScope;
  /** The template calls the one being written sits in, innermost last: what #AUTOVAR(v,parent) and (v,ancestor:…) name. */
  private readonly enclosing: EnclosingCall[];
  /** The TextExpressionSetToken lines of the statements being written, innermost last: each goes before its statement. */
  private readonly tokens: string[][] = [];

  constructor(scope: TemplateScope, enclosing: EnclosingCall[] = []) {
    this.scope = scope;
    this.enclosing = enclosing;
  }

  private fail(reason: string): never {
    return refuse(this.scope.subject, reason);
  }

  /** A reference's library and id: a bare one is the scope's own. */
  private split(ref: string): [string | undefined, string] {
    return ref.includes("/") ? (ref.split("/") as [string, string]) : [this.scope.library, ref];
  }

  private isOwn(lib: string | undefined): boolean {
    return lib === this.scope.library;
  }

  /** The Galaxy type of an Editor type: an array's with its sizes, each one more than the Editor's (`int[4]`, `string[lib<id>_gv_<count> + 1]`). */
  type(type: TypeSpec): string {
    if (type.constant) this.fail(`a constant ${type.type}, which is written only as a variable's declaration`);
    const element = this.elementType(type);
    return type.array ? element + type.array.map((bound) => `[${this.arrayBound(bound)}]`).join("") : element;
  }

  /** One dimension's size as Galaxy declares it: one more than the Editor's. */
  private arrayBound(bound: ArrayBound): string {
    if ("size" in bound) return String(bound.size + 1);
    const [lib, id] = this.split(bound.variable);
    if (!this.isOwn(lib)) this.fail(`an array sized by ${bound.variable}, a variable of a library the scope doesn't name`);
    return `${this.scope.variable(id)} + 1`;
  }

  /** The Galaxy type of an Editor type's element: the type itself, for one that isn't an array. */
  private elementType(type: TypeSpec): string {
    if (type.type === "preset") {
      if (!type.element) this.fail("a preset type with no preset");
      return this.presetBase(type.element);
    }
    if (type.type === "struct") {
      if (!type.element) this.fail("a structure type with no structure");
      const [lib, id] = this.split(type.element);
      if (!this.isOwn(lib)) this.fail(`the structure ${type.element}, which the library doesn't hold`);
      return this.scope.structureType(id);
    }
    const galaxy = GALAXY_TYPES[type.type];
    if (!galaxy) this.fail(`the type ${type.type}, which this doesn't write yet`);
    return galaxy;
  }

  private presetBase(ref: string): string {
    const [lib, id] = this.split(ref);
    if (this.isOwn(lib)) return this.scope.presetBase(id);
    const preset = this.scope.libraries[lib!]?.presets[id];
    if (!preset?.base) this.notInReach(lib!, `the preset type ${ref}`);
    return GALAXY_TYPES[preset.base] ?? this.fail(`the preset type ${ref}'s base type ${preset.base}`);
  }

  private presetValue(ref: string): string {
    const [lib, id] = this.split(ref);
    if (this.isOwn(lib)) return this.scope.presetValue(id);
    const reached = reachablePresetValue(this.scope, ref);
    if (reached !== undefined) return reached;
    // A generated constant of a library in reach: a mod's interface doesn't give its name, as the library's own isn't written
    // either, and the game's data gives none for Ntve's seven or Hots' four. The library does define it, so this is the refusal.
    if (this.scope.libraries[lib!]?.presetValues[id] !== undefined) this.fail(`the preset value ${ref}, which has no value of its own`);
    return this.notInReach(lib!, `the preset value ${ref}`);
  }

  /** A literal, given for the Param `id` (a text's words are keyed by it). */
  private literal(value: Extract<GuiValue, { type: string }>, id: string | undefined): string {
    const text = value.value ?? "";
    switch (value.type) {
      case "text":
        return id === undefined ? this.fail("a text with no Param of its own, whose words GameStrings can't key") : this.scope.text(id);
      case "int":
        return text || "0";
      case "fixed":
        return text.includes(".") ? text : `${text || "0"}.0`;
      case "bool":
        return text || "false";
      case "string":
      case "gamelink":
      case "convline":
      case "conversation":
      case "catalogentry":
      case "actormsg":
      case "gameoption":
      case "gameoptionvalue":
      case "filepath":
      case "userfield":
      // A user type's instance by its name: its user type (ValueContext) is a parameter of its own.
      case "userinstance":
        return quote(text);
      case "abilcmd":
        // The command's index is its ValueId, else the ability's first: the type info is the Editor's own note of how it targets.
        return `AbilityCommand(${quote(text)}, ${value.valueId ?? 0})`;
      case "soundlink":
        return soundLinkGalaxy(text, value.valueId);
      case "difficulty":
      case "playercolor":
        // Its number is its ValueId: a difficulty's Value, where an older Editor left one, is stale (Void Prologue's PP_DifficultyFromIndex, Campaign Common's CC_DifficultyFromIndex).
        return value.valueId ?? this.fail(`a ${value.type} with no ValueId, whose Galaxy no Editor save shows`);
      case "unitfilter":
        return renderUnitFilterText(text);
      case "color":
        return renderColor(text);
      case "modelanim":
        return text.startsWith('"') ? text : quote(text);
      case "catalogfieldpath": {
        // An array index the path takes from a value of its own: "Variations[" + IntToString(i) + "].Actor".
        let index = 0;
        const parts = text.split(/\[[^\]]*\]/);
        const held = value.valueParams ?? [];
        if (held.length !== parts.length - 1) this.fail(`a catalog field path ${text} with ${held.length} index value(s)`);
        return parts.map((part, at) => (at === 0 ? quote(`${part}${held.length ? "[" : ""}`) : ` + IntToString(${this.value(held[index++]!)}) + ${quote(`]${part}${at < parts.length - 1 ? "[" : ""}`)}`)).join("");
      }
      default:
        this.fail(`a literal of type ${value.type}, which this doesn't write yet`);
    }
  }

  value(value: GuiValue & { readonly id?: string }, unitRef = false): string {
    if (this.scope.own) return this.scope.own.value(value, unitRef, [...this.enclosing]);
    if (unitRef) {
      // An event takes a reference to a unit: a variable's by its name.
      if (!("variable" in value && value.variable !== undefined)) this.fail("a unit an event takes that isn't a variable's, whose Galaxy this doesn't write yet");
      if (hasIndex(value)) this.fail("a unit an event takes from an array, whose Galaxy no Editor save shows");
      return `UnitRefFromVariable(${quote(this.variablePath(value))})`;
    }
    if ("preset" in value && value.preset !== undefined) return this.presetValue(value.preset);
    // A set of bits with some set: their values, ored, in the Editor's order.
    if ("bits" in value && value.bits !== undefined) return value.bits.map((bit) => this.presetValue(bit)).join(" | ");
    if ("presetElement" in value && value.presetElement !== undefined) {
      const [lib, id] = this.split(value.presetElement);
      // Another library's, which isn't in reach or is refused: refused as a call into it is.
      const library = this.isOwn(lib) ? undefined : this.scope.libraries[lib!];
      if (!this.isOwn(lib) && (!library || library.refused !== undefined)) this.notInReach(lib!, `the preset element ${value.presetElement}`);
      if (!this.scope.libraries[lib!]?.presets[id]?.bits) this.fail(`a preset element ${value.presetElement} that isn't a set of bits`);
      return "0";
    }
    if ("call" in value && value.call !== undefined) return this.expression(value.call);
    if ("variable" in value && value.variable !== undefined) return this.variablePath(value);
    if ("parameter" in value && value.parameter !== undefined) return this.scope.parameter(value.parameter);
    if ("trigger" in value && value.trigger !== undefined) return this.scope.trigger(value.trigger);
    if ("customScript" in value && value.customScript !== undefined) {
      if (value.customScript.includes("\n")) this.fail("a value of custom script over more than one line, whose Galaxy this doesn't write yet");
      return value.customScript;
    }
    if ("expression" in value && value.expression !== undefined) return this.expressionValue(value.expression, value.id);
    return this.literal(value as Extract<GuiValue, { type: string }>, value.id);
  }

  /**
   * An expression given for the Param `id`: a text one's slots set by lines before the statement it
   * is in (textExpressionGalaxy), which a text expression outside one, or in another's slot, is
   * refused for; any other's text with its slots' values (expressionGalaxy).
   */
  private expressionValue(expression: GuiExpression, id: string | undefined): string {
    const fail = (reason: string): never => this.fail(reason);
    if (expression.type !== "text") return expressionGalaxy(expression, (slot) => this.value(slot), fail);
    if (id === undefined) this.fail("a text expression with no Param of its own, whose words GameStrings can't key");
    const words = this.scope.textExpression?.(id) ?? this.fail("a text expression, which this scope doesn't write");
    return textExpressionGalaxy(this.tokens, words, expression, (slot) => this.value(slot), fail);
  }

  /** A variable with its index values and its structure members': `lib<id>_gv_regions[lv_i].lv_units[lv_j].lv_unit`. */
  private variablePath(value: { readonly variable: string; readonly index?: readonly HeldValue[] | undefined; readonly member?: StructMember | undefined }): string {
    const indexed = (index: readonly HeldValue[] | undefined): string => (index ?? []).map((held) => `[${this.value(held)}]`).join("");
    let text = this.scope.variable(value.variable) + indexed(value.index);
    for (let member = value.member; member; member = member.member) text += `.${this.scope.member(member.variable)}${indexed(member.index)}`;
    return text;
  }

  private readonly callees = new Map<string, TemplateCallee>();

  /** What a call names: its definition, whichever library it is in, read once per function written. */
  callee(ref: string): TemplateCallee {
    const known = this.callees.get(ref);
    if (known) return known;
    const callee = this.calleeOf(ref);
    this.callees.set(ref, callee);
    return callee;
  }

  /**
   * Refuses `what`, which names a function or preset of `lib` no library in reach defines: with why,
   * where `lib`'s calls are refused, and the dependencies not found where `lib` isn't in reach.
   */
  private notInReach(lib: string, what: string): never {
    const library = this.scope.libraries[lib];
    if (library?.refused !== undefined) return refuse(this.scope.subject, `${what}, but ${library.refused}`, library.refused);
    return this.fail(`${what}, which no library in reach defines${library ? "" : this.unreachedNote()}`);
  }

  /** Why a library may be out of reach: the dependencies that weren't found, by name. */
  private unreachedNote(): string {
    const { mods = [], inWorkspace = false } = this.scope.unreached ?? {};
    if (mods.length === 0) return "";
    const one = mods.length === 1;
    const where = inWorkspace ? `${one ? "isn't one of" : "aren't among"} the Workspace's mods (the game's own mods aren't read from a Workspace)` : `${one ? "isn't" : "aren't"} among the game's mods`;
    return `; it depends on ${mods.join(", ")}, which ${where}`;
  }

  private calleeOf(ref: string): TemplateCallee {
    const [lib, id] = this.split(ref);
    if (this.isOwn(lib)) return this.scope.ownFunction(id);
    const game = this.scope.libraries[lib!];
    const fn = game?.functions[id];
    const unreadable = game?.unreadable?.[id];
    if (unreadable !== undefined) this.fail(`it calls ${ref}, whose definition can't be read: ${unreadable}`);
    if (!game || !fn) this.notInReach(lib!, `it calls ${ref}`);
    if (!fn.identifier) this.fail(`it calls ${ref}, which has no identifier`);
    // The Editor writes an inline function's value from its body in the caller, and a library in reach gives only its interface. An
    // inline action likewise: no Editor save in the game's data shows one written as a lib<id>_gf_ call (the only inline functions
    // there, in Heroes' mods, return a value), and the game's libraries (Ntve, Hots) have none.
    if (fn.flags.includes("inline")) this.fail(`it calls the inline function ${ref} (${fn.identifier}), whose Galaxy is written from its body, which this doesn't read for a library in reach`);
    return {
      name: libraryFunctionName(lib!, { identifier: fn.identifier, name: fn.identifier, flags: fn.flags }),
      identifier: fn.identifier,
      flags: fn.flags,
      params: fn.params.map((param) => {
        const type = game.params[param]?.type;
        const element = game.params[param]?.element;
        return { id: `${lib}/${param}`, identifier: game.params[param]?.identifier ?? param, ...(type ? { type: { type, ...(element ? { element } : {}) } } : {}) };
      }),
      ...(fn.returns ? { returns: fn.returns } : {}),
      ...(fn.script !== undefined ? { script: fn.script } : {}),
      subs: new Map((fn.subFunctions ?? []).map((sub) => [sub, game.subFunctions[sub.split("/")[1]!] ?? sub])),
      game: true,
    };
  }

  /** The call's arguments, in its definition's order; an event's unit parameters as references to the unit, where its native takes one. */
  private args(call: GuiCall, callee: TemplateCallee): Map<string, string> {
    const given = new Map((call.params ?? []).map((param) => [param.def, param]));
    const event = callee.flags.includes("event");
    const out = new Map<string, string>();
    for (const param of callee.params) {
      const value = given.get(param.id);
      if (!value) this.fail(`its call ${call.id} to ${callee.name} gives no ${param.identifier}`);
      out.set(param.identifier, this.value(value, event && param.type?.type === "unit" && !EVENT_PLAIN_UNITS.has(param.id)));
    }
    return out;
  }

  /**
   * A template's text, its macros filled in for `call`; statement slots as lines indented under
   * where they stand. Of the blank lines the template itself leaves (a macro filled with nothing,
   * a slot's statements' own line break) the Editor keeps one at its end, as after an If Then with
   * no Else or an Action Group, and none inside it; the statements in a slot keep their own.
   */
  private template(call: GuiCall, callee: TemplateCallee, script: string, { notFirst = false } = {}): string {
    const unknown = [...script.matchAll(/#([A-Z]+)/g)].find((macro) => !MACROS.has(macro[1]!));
    if (unknown) this.fail(`${callee.name}'s template uses ${unknown[0]}, which this doesn't write yet`);
    // What a macro is filled with stands in as a token until every macro is filled, so a macro left over
    // in a form this doesn't match is refused, and a value's own text is never taken for one.
    const fills: string[] = [];
    const fill = (galaxy: string): string => `\u0002${fills.push(galaxy) - 1}\u0003`;
    // What the call's own variables name in the calls it encloses is settled before it encloses them.
    // Stop Looping: `break;` inside a block that allows it (a loop, such as For Each Integer, or a library's own For Each with
    // FlagAllowBreak), though other blocks (an If Then, a Switch) stand between; outside one, nothing (a blank line), as
    // Editor saves write it (a Mission's Switch whose every case ends in one, in a function with no loop).
    const breaks = this.enclosing.some((outer) => outer.allowBreak);
    let text = script.replace(/#SMARTBREAK/g, breaks ? "break;" : "");
    text = text.replace(/#IFSUBFUNC\((\w+),([^)]*)\)/g, (_, test: string, then: string) => {
      if (test !== "notfirst") this.fail(`${callee.name}'s template tests #IFSUBFUNC(${test}), which this doesn't write yet`);
      return notFirst ? then : "";
    });
    text = text.replace(AUTOVAR, (_, init: string | undefined, name: string, of: string | undefined) => {
      if (!init) return `auto${this.autoOwner(call, callee, of)}_${name}`;
      // A literal is the variable's constant initializer, declared with it: the template sets nothing.
      const identifier = of ?? this.fail(`${callee.name}'s template has an #INITAUTOVAR(${name}) of no parameter`);
      return this.isConstantAuto(call, callee, identifier) ? "" : `auto${call.id}_${name} = ${fill(this.initialAuto(call, callee, identifier))};`;
    });
    this.enclosing.push({ call, identifier: callee.identifier, ...(callee.flags.includes("allowBreak") ? { allowBreak: true } : {}) });
    try {
      return this.filled(call, callee, text, fills, fill);
    } finally {
      this.enclosing.pop();
    }
  }

  /** Which call's variable an #AUTOVAR names: the call's own, its parent's or an ancestor's. */
  private autoOwner(call: GuiCall, callee: TemplateCallee, of: string | undefined): string {
    if (of === "parent") return this.enclosing.at(-1)?.call.id ?? this.fail(`${callee.name} names its parent's variable, but sits in no block`);
    if (of?.startsWith("ancestor:")) {
      const identifier = of.slice("ancestor:".length);
      return this.enclosing.findLast((outer) => outer.identifier === identifier)?.call.id ?? this.fail(`${callee.name} names the variable of a ${identifier} it doesn't sit in`);
    }
    return call.id;
  }

  /** The value given for the parameter an #INITAUTOVAR names. */
  private initGiven(call: GuiCall, callee: TemplateCallee, identifier: string): GuiParam {
    const param = callee.params.find((candidate) => candidate.identifier === identifier) ?? this.fail(`${callee.name}'s template names a parameter ${identifier} it doesn't have`);
    const given = (call.params ?? []).find((candidate) => candidate.def === param.id);
    if (!given) this.fail(`its call ${call.id} to ${callee.name} gives no ${identifier}`);
    return given;
  }

  /**
   * Whether an #INITAUTOVAR's parameter is given an int or fixed literal: the Editor declares the
   * variable const with it (`const int auto<id>_n = 20;`) and the template sets nothing. Editor
   * saves have it for int and fixed only, so a literal of another type is set as any value is.
   */
  private isConstantAuto(call: GuiCall, callee: TemplateCallee, identifier: string): boolean {
    const given = this.initGiven(call, callee, identifier);
    return "type" in given && (given.type === "int" || given.type === "fixed");
  }

  /** The value an #INITAUTOVAR sets its variable to: refused for a constant other than an int or fixed literal, which the Editor may write otherwise. */
  private initialAuto(call: GuiCall, callee: TemplateCallee, identifier: string): string {
    const given = this.initGiven(call, callee, identifier);
    if (!("call" in given && given.call) && !("variable" in given && given.variable) && !("parameter" in given && given.parameter) && !("expression" in given && given.expression)) {
      this.fail(`its call ${call.id} to ${callee.name} gives a constant ${identifier}, whose #INITAUTOVAR this doesn't write yet`);
    }
    return this.value(given);
  }

  /** The template's slots and parameters filled in, its blank lines settled as template() says. */
  private filled(call: GuiCall, callee: TemplateCallee, script: string, fills: readonly string[], fill: (galaxy: string) => string): string {
    const args = this.args(call, callee);
    const slot = (name: string): GuiStatement[] => {
      const sub = [...callee.subs].find(([, identifier]) => identifier === name)?.[0];
      if (!sub) this.fail(`${callee.name}'s template names a slot ${name} it doesn't have`);
      return (call.body ?? []).filter((statement) => statement.sub === sub && !statement.disabled);
    };
    // A call held in a slot the template doesn't write would be dropped: #IFHAVESUBFUNCS only tests a slot.
    const written = new Set([...script.matchAll(/#SUBFUNCS\((\w+)/g)].map((match) => [...callee.subs].find(([, identifier]) => identifier === match[1])?.[0]));
    const stray = (call.body ?? []).find((statement) => !isComment(statement) && !statement.disabled && !written.has(statement.sub));
    if (stray) this.fail(`its call ${call.id} to ${callee.name} holds ${stray.id} in a slot ${stray.sub ?? "(none)"} its template doesn't write`);
    let text = script.replace(/#IFHAVESUBFUNCS\((\w+),([^)]*)\)/g, (_, name: string, then: string) => (slot(name).some((statement) => !isComment(statement)) ? then : ""));
    text = text.replace(/#SUBFUNCS\((\w+),"([^"]*)"\)/g, (_, name: string, separator: string) => {
      const conditions = slot(name).filter((statement): statement is GuiCall => !isComment(statement));
      // What the Editor writes for none isn't known from its own output, and `if ()` isn't Galaxy.
      if (conditions.length === 0) this.fail(`its ${callee.identifier} ${call.id} has no enabled conditions in ${name}, whose Galaxy isn't known`);
      return fill(conditions.map((condition) => this.nestedExpression(condition)).join(separator));
    });
    // A statement slot stands in as a placeholder line until the template's own blank lines are settled.
    const slots: string[][] = [];
    text = text.replace(/^([ \t]*)#SUBFUNCS\((\w+)\)[ \t]*$/gm, (_, indent: string, name: string) => {
      const lines = this.statements(slot(name)).map((line) => (line === "" ? "" : `${indent}${line}`));
      if (lines.length === 0) return "";
      slots.push(lines);
      return `\u0000${slots.length - 1}`;
    });
    const arg = (name: string): string => args.get(name) ?? this.fail(`${callee.name}'s template names a parameter ${name} it doesn't have`);
    // A repeated parameter's values joined by a separator of string literals and #PARAMs: "+" in Combine Strings,
    // " " #PARAM(op) " " in an Arithmetic or And/Or Multiple, (a + b + 80) as Editor-saved Galaxy has them.
    text = text.replace(/#PARAM\((\w+),((?:\s*(?:"[^"]*"|#PARAM\(\w+\)))+)\s*\)/g, (_, name: string, separatorParts: string) => {
      const param = callee.params.find((candidate) => candidate.identifier === name) ?? this.fail(`${callee.name}'s template names a parameter ${name} it doesn't have`);
      const separator = [...separatorParts.matchAll(/"([^"]*)"|#PARAM\((\w+)\)/g)].map(([, literal, param]) => literal ?? arg(param!)).join("");
      return fill(
        (call.params ?? [])
          .filter((given) => given.def === param.id)
          .map((given) => this.value(given))
          .join(separator),
      );
    });
    text = text.replace(/#PARAM\((\w+)\)/g, (_, name: string) => fill(arg(name)));
    const leftover = /#([A-Z]+)/.exec(text);
    if (leftover) this.fail(`${callee.name}'s template uses ${leftover[0]} in a form this doesn't write yet`);
    text = text.replace(/\u0002(\d+)\u0003/g, (_, at: string) => fills[Number(at)]!);
    const lines = text.split("\n");
    const last = lines.findLastIndex((line) => line.trim() !== "");
    // A slot's statements end with a line break of their own: a slot that ends the template (an Action Group) leaves a blank line
    // too, one only where its last statement leaves its own.
    const endSlot = last >= 0 && lines[last]!.startsWith("\u0000") ? slots[Number(lines[last]!.slice(1))]! : undefined;
    const blankAtEnd = last < lines.length - 1 || (endSlot !== undefined && endSlot.at(-1) !== "");
    return [...lines.slice(0, last + 1).filter((line) => line.trim() !== ""), ...(blankAtEnd ? [""] : [])]
      .flatMap((line) => (line.startsWith("\u0000") ? slots[Number(line.slice(1))]! : [line]))
      .join("\n");
  }

  /** A call in a slot or given as a value: the scope's to write, where it writes its own. */
  private nestedExpression(call: GuiCall): string {
    return this.scope.own ? this.scope.own.expression(call, [...this.enclosing]) : this.expression(call);
  }

  /** A call as an expression: a function's value, a condition, or an event bound to the trigger. */
  expression(call: GuiCall): string {
    const callee = this.callee(call.function);
    if (callee.script !== undefined) return this.template(call, callee, callee.script);
    if (callee.game && callee.identifier === CUSTOM_SCRIPT) this.fail(`its custom script ${call.id} stands where a value is wanted, whose Galaxy this doesn't write yet`);
    this.onlyCustomScriptHasScript(call, callee);
    // The Editor writes an inline function's value in its place; an inline action is called as any other.
    if (callee.inline) return this.inline(call, callee.inline);
    if (callee.flags.includes("operator")) {
      const args = [...this.args(call, callee).values()];
      if (BINARY_OPERATORS.has(callee.identifier) && args.length === 3) return `(${args[0]} ${args[1]} ${args[2]})`;
      // A conversion, such as a game link to a string, is its value in parentheses.
      if (args.length === 1) return `(${args[0]})`;
      this.fail(`it calls the operator ${call.function} (${callee.identifier}), which this doesn't write yet`);
    }
    if (callee.flags.includes("event")) {
      // An event adds itself to the trigger being written: its variable comes first.
      const trigger = this.scope.triggerVariable ?? this.fail(`it calls the event ${call.function} (${callee.identifier}) outside a trigger`);
      return `${callee.name}(${[trigger, ...this.args(call, callee).values()].join(", ")})`;
    }
    return `${callee.name}(${[...this.args(call, callee).values()].join(", ")})`;
  }

  /** Script code of its own (`script`) belongs to Custom Script alone: on another call it is refused, not dropped. */
  private onlyCustomScriptHasScript(call: GuiCall, callee: TemplateCallee): void {
    if (call.script !== undefined && !(callee.game && callee.identifier === CUSTOM_SCRIPT)) this.fail(`its call ${call.id} to ${callee.name} holds script code of its own, whose Galaxy this doesn't write yet`);
  }

  /** An inline function's value: the value its single Return gives. */
  private inline(call: GuiCall, { fn, body, scope }: NonNullable<TemplateCallee["inline"]>): string {
    const actions = (body?.actions ?? []).filter((statement) => !isComment(statement));
    const only = actions[0] as GuiCall | undefined;
    if (fn.parameters.length > 0 || body?.variables.length || actions.length !== 1 || !only || this.callee(only.function).identifier !== "Return" || only.params?.length !== 1) {
      this.fail(`it calls the inline function ${fn.name}, which isn't a single Return of a value`);
    }
    if (call.params?.length) this.fail(`its call ${call.id} to the inline ${fn.name} gives parameters`);
    return new TemplateEngine(scope).value(only.params[0]!);
  }

  /**
   * One statement's lines, at no indentation (`notFirst` when it isn't the first in its slot): first
   * the TextExpressionSetToken lines of the text expressions it is given, which a block's own values
   * and conditions are refused for (the statements in its slots set their own).
   */
  statement(statement: GuiCall, notFirst: boolean): string[] {
    const callee = this.callee(statement.function);
    return withTokens(this.tokens, () => callee.subs.size > 0, () => this.statementLines(statement, callee, notFirst), (reason) => this.fail(`its call ${statement.id} to ${callee.name}: ${reason}`));
  }

  private statementLines(statement: GuiCall, callee: TemplateCallee, notFirst: boolean): string[] {
    this.onlyCustomScriptHasScript(statement, callee);
    if (statement.function === BANK_PRELOAD) return [];
    if (callee.script !== undefined) return this.template(statement, callee, callee.script, { notFirst }).split("\n");
    if (callee.game && callee.identifier === CUSTOM_SCRIPT) {
      if (!statement.script) this.fail(`its custom script ${statement.id} is empty, whose Galaxy this doesn't write yet`);
      return statement.script.split("\n");
    }
    if (callee.game && callee.identifier === "IfThenMultiple") return this.ifThenMultiple(statement, callee);
    if (callee.subs.size > 0) this.fail(`it calls the block ${statement.function} (${callee.identifier}), which has no template this can write it from`);
    return [`${this.expression(statement)};`];
  }

  /** Statements as lines, at no indentation: each the scope's to write, where it writes its own. */
  statements(statements: readonly GuiStatement[]): string[] {
    const out: string[] = [];
    let written = 0;
    for (const statement of statements) {
      // Bank Preload writes nothing (statementLines), so it isn't counted as a statement before the next (#IFSUBFUNC(notfirst)).
      if (isComment(statement) || statement.disabled || statement.function === BANK_PRELOAD) continue;
      out.push(...(this.scope.own ? this.scope.own.statement(statement, written > 0, [...this.enclosing]) : this.statement(statement, written > 0)));
      written += 1;
    }
    return out;
  }

  /** If Then Multiple, which the Editor writes with no template: its If Thens in turn, each after the first an else if (#IFSUBFUNC(notfirst)). */
  private ifThenMultiple(call: GuiCall, callee: TemplateCallee): string[] {
    const other = (call.body ?? []).find((statement) => !statement.disabled && !callee.subs.has(statement.sub ?? ""));
    if (other) this.fail(`its If Then Multiple ${call.id} holds ${other.id} in a slot ${other.sub ?? "(none)"} this doesn't write yet`);
    return this.statements(call.body ?? []);
  }

  /** The variables the Editor declares for the templates' #AUTOVAR and #INITAUTOVAR: each call's, in the order the body holds them. */
  autoDeclarations(statements: readonly GuiStatement[], out: string[] = []): string[] {
    for (const statement of statements) {
      if (isComment(statement) || statement.disabled) continue;
      this.callAutos(statement, out);
    }
    return out;
  }

  /** A call's variables and, unless the scope writes them itself, those of the calls it holds. */
  callAutos(call: GuiCall, out: string[]): void {
    const callee = this.callee(call.function);
    // Each of the call's own, at its first use, of the type its first typed use gives (int if none does).
    const types = new Map<string, string | undefined>();
    const constants = new Map<string, string>();
    for (const [, init, name, of] of (callee.script ?? "").matchAll(AUTOVAR)) {
      if (!init && (of === "parent" || of?.startsWith("ancestor:"))) continue;
      const identifier = init ? (of ?? this.fail(`${callee.name}'s template has an #INITAUTOVAR(${name}) of no parameter`)) : undefined;
      const type = identifier ? this.paramType(call, callee, identifier) : of;
      if (identifier && !types.has(name!) && this.isConstantAuto(call, callee, identifier)) constants.set(name!, this.value(this.initGiven(call, callee, identifier)));
      if (!types.has(name!) || (types.get(name!) === undefined && type !== undefined)) types.set(name!, type);
    }
    for (const [name, type] of types) out.push(constants.has(name) ? `const ${type ?? "int"} auto${call.id}_${name} = ${constants.get(name)};` : `${type ?? "int"} auto${call.id}_${name};`);
    // An inline function's value is written into the caller, so variables of its own would have to be declared there too.
    if (callee.inline && new TemplateEngine(callee.inline.scope).autoDeclarations(callee.inline.body?.actions ?? []).length) {
      this.fail(`it calls the inline function ${callee.inline.fn.name}, whose value needs variables of its own`);
    }
    if (this.scope.own) return;
    for (const param of call.params ?? []) {
      if ("call" in param && param.call) this.callAutos(param.call, out);
      // An expression's slots' calls, which it is written with.
      if ("expression" in param && param.expression) for (const slot of param.expression.slots) if ("call" in slot && slot.call) this.callAutos(slot.call, out);
    }
    this.autoDeclarations(call.body ?? [], out);
  }

  /** The Galaxy type of a callee's parameter, for the variable an #INITAUTOVAR gives its value. */
  private paramType(call: GuiCall, callee: TemplateCallee, identifier: string): string {
    const param = callee.params.find((candidate) => candidate.identifier === identifier);
    const type = param?.type;
    if (!type) this.fail(`${callee.name}'s #INITAUTOVAR of ${identifier}, whose type this can't tell`);
    if (!type.type.startsWith("any") && type.type !== "sameas") return this.type(type);
    // A parameter of any type (Switch's value) types the variable by the value given for it.
    const given = (call.params ?? []).find((candidate) => candidate.def === param!.id);
    const typed = given && this.typeOfValue(given);
    if (!typed) this.fail(`${callee.name}'s #INITAUTOVAR of ${identifier}, whose ${type.type} type this can't tell from the value given`);
    return this.type(typed);
  }

  /** The Editor type of a value, where it names one: a parameter's, a variable's (or its member's), a literal's, a call's return. */
  private typeOfValue(value: GuiValue): TypeSpec | undefined {
    if ("parameter" in value && value.parameter !== undefined) return this.scope.parameterType(value.parameter);
    if ("variable" in value && value.variable !== undefined) {
      let last: { readonly variable: string; readonly index?: readonly HeldValue[] | undefined } = value;
      for (let member = value.member; member; member = member.member) last = member;
      const type = this.scope.variableType(last.variable);
      // An array indexed in every dimension is a value of its element's type; one indexed in fewer names no type.
      if ((type?.array?.length ?? 0) !== (last.index?.length ?? 0)) return undefined;
      const { array: _array, constant: _constant, ...element } = type ?? { type: "" };
      return type && element;
    }
    if ("call" in value && value.call !== undefined) return this.callee(value.call.function).returns;
    if ("expression" in value && value.expression !== undefined) return { type: value.expression.type };
    if ("type" in value && typeof value.type === "string") return { type: value.type };
    return undefined;
  }
}

/** Writes one library function's Galaxy: its signature and its body, through the engine in the library's scope. */
class FunctionWriter {
  private readonly scope: LibraryScope;
  private readonly fn: LibraryFunction;
  private readonly body: GuiBody;
  private readonly own: TemplateScope;
  private readonly engine: TemplateEngine;

  constructor(scope: LibraryScope, fn: LibraryFunction, body: GuiBody) {
    this.scope = scope;
    this.fn = fn;
    this.body = body;
    this.own = libraryTemplateScope(scope, fn, body);
    this.engine = new TemplateEngine(this.own);
  }

  private fail(reason: string): never {
    return refuse(this.fn.name, reason);
  }

  /** A parameter's Galaxy name, lp_<identifier>, as the scope names it. */
  private param(parameter: LibraryFunction["parameters"][number]): string {
    return this.own.parameter(parameter.id);
  }

  /** The function's parameters, as its signature lists them. */
  signature(): string {
    if (this.fn.flags.includes("native") || this.fn.script !== undefined) this.fail("it has no GUI body of its own to write");
    if (this.fn.flags.includes("createThread") && this.fn.returns) this.fail("it runs in its own thread and returns a value, whose Galaxy no Editor save shows");
    // One save has an action with a return type (Nova's Attach Model To Unit With Vis), its one call written `return <call>;`: too few to know the rule.
    if (this.fn.kind === "action" && this.fn.returns) this.fail("it's an action that returns a value, whose Galaxy one Editor save shows, too few to know its rule");
    const returns = this.fn.returns ? this.engine.type(this.fn.returns) : "void";
    const params = this.fn.parameters.map((parameter) => `${this.engine.type(parameter.type)} ${this.param(parameter)}`).join(", ");
    return `${returns} ${libraryFunctionName(this.scope.library, this.fn)} (${params})`;
  }

  definition(): string {
    return this.fn.flags.includes("createThread") ? this.threaded() : [`${this.signature()} {`, ...this.bodyLines(), "}"].join("\n");
  }

  /**
   * A function that runs in its own thread, as the Editor writes it: the function stores its
   * parameters in globals and runs a trigger, created once, whose function takes them back and holds
   * the body, returning true.
   */
  private threaded(): string {
    const params = this.fn.parameters.map((parameter) => ({ type: this.engine.type(parameter.type), name: this.param(parameter) }));
    return threadedGalaxy(libraryFunctionName(this.scope.library, this.fn), this.signature(), params, this.bodyLines()).join("\n");
  }

  /** The body's lines, from its variable declarations to its implementation, indented in the function. */
  private bodyLines(): string[] {
    const lines: string[] = [];
    const variables = this.body.variables;
    const local = (variable: (typeof variables)[number]): string => `lv_${lowerFirst(variable.identifier ?? galaxyIdentifier(variable.name))}`;
    if (variables.length) {
      lines.push("    // Variable Declarations");
      for (const variable of variables) lines.push(`    ${this.declaration(variable, local(variable))};`);
      lines.push("");
    }
    lines.push("    // Automatic Variable Declarations");
    const autos = this.engine.autoDeclarations(this.body.actions);
    if (autos.length) lines.push(...autos.map((declaration) => `    ${declaration}`), "");
    if (variables.length) {
      lines.push("    // Variable Initialization");
      for (const variable of variables) {
        // A constant is given its value where it is declared.
        if (variable.type.constant) continue;
        const init = variable.value && this.initial(variable.value);
        // No Editor save sets an array variable's elements to a value of its own in a function.
        if (init !== undefined && variable.type.array) this.fail(`its array variable ${variable.name} starts at ${init}, whose Galaxy no Editor save shows`);
        if (init !== undefined) lines.push(`    ${local(variable)} = ${init};`);
      }
      lines.push("");
    }
    // A deprecated function's statements are headed "// Deprecated" in place of "// Implementation"; a function with no
    // actions has neither, though one whose actions are all comments or disabled has it (Void Prologue's PP_ResetTech and
    // PP_StoreTechBonusAtMissionBeginning).
    if (this.body.actions.length) lines.push(this.fn.deprecated ? "    // Deprecated" : "    // Implementation");
    for (const line of this.engine.statements(this.body.actions)) lines.push(line === "" ? "" : `    ${line}`);
    return lines;
  }

  /** A variable's declaration: a constant's with its value (`const string lv_bank = "Bank"`), as the Editor writes it. */
  private declaration(variable: GuiVariable, name: string): string {
    if (!variable.type.constant) return `${this.engine.type(variable.type)} ${name}`;
    const { constant: _constant, ...type } = variable.type;
    if (!variable.value) this.fail(`its constant ${variable.name} has no value`);
    return `const ${this.engine.type(type)} ${name} = ${this.engine.value(variable.value)}`;
  }

  /** A variable's initialization, or undefined where the Editor writes none (a zero or null, which Galaxy starts it with). */
  private initial(value: HeldValue): string | undefined {
    if ("type" in value && value.type !== undefined && !("call" in value && value.call)) {
      if ((ZERO[value.type] ?? []).includes(value.value ?? "0")) return undefined;
    }
    const init = this.engine.value(value);
    return "preset" in value && value.preset !== undefined && init === "null" ? undefined : init;
  }
}

/**
 * A function that runs in its own thread (FlagCreateThread), as the Editor writes it in a library
 * and in a map alike: the function `name` (its `signature`, without the brace) stores its parameters
 * in globals and runs a trigger, created once, whose function takes them back and holds the body
 * (`body`, its lines from the variable declarations on, indented), returning true. Its lines, with
 * no line break after the last.
 */
export function threadedGalaxy(name: string, signature: string, params: readonly { readonly type: string; readonly name: string }[], body: readonly string[]): string[] {
  const trigger = `auto_${name}_Trigger`;
  const global = (param: { readonly name: string }): string => `auto_${name}_${param.name}`;
  const gap = params.length ? [""] : [];
  return [
    `trigger ${trigger} = null;`,
    ...params.map((param) => `${param.type} ${global(param)};`),
    "",
    `${signature} {`,
    ...params.map((param) => `    ${global(param)} = ${param.name};`),
    ...gap,
    `    if (${trigger} == null) {`,
    `        ${trigger} = TriggerCreate("${trigger}Func");`,
    "    }",
    "",
    `    TriggerExecute(${trigger}, false, false);`,
    "}",
    "",
    `bool ${trigger}Func (bool testConds, bool runActions) {`,
    ...params.map((param) => `    ${param.type} ${param.name} = ${global(param)};`),
    ...gap,
    ...body,
    "    return true;",
    "}",
  ];
}

/** A GUI function's Galaxy: its definition for Lib<id>.galaxy and its declaration for Lib<id>_h.galaxy. */
export function functionGalaxy(scope: LibraryScope, fn: LibraryFunction, body: GuiBody): { readonly name: string; readonly definition: string; readonly declaration: string } {
  const writer = new FunctionWriter(scope, fn, body);
  return { name: libraryFunctionName(scope.library, fn), definition: writer.definition(), declaration: `${writer.signature()};` };
}

/**
 * One call's Galaxy in `scope`, from its function's template: as a statement, its lines at no
 * indentation (`notFirst` when it isn't the first in its slot), or as an expression (a value, a
 * condition, an event). `enclosing` is the template calls it sits in, as the scope's own writer
 * hands them back. The variables its template declares go on `autos` first, before any a call it
 * holds declares as it is written: its own and, unless the scope writes them itself, those of the
 * calls it holds. Refused, naming why, with UnrenderableGalaxyError.
 */
export function callGalaxy(
  scope: TemplateScope,
  call: GuiCall,
  { as, notFirst = false, enclosing = [], autos = [] }: { readonly as: "statement" | "expression"; readonly notFirst?: boolean; readonly enclosing?: readonly EnclosingCall[]; readonly autos?: string[] },
): string[] {
  const engine = new TemplateEngine(scope, [...enclosing]);
  engine.callAutos(call, autos);
  return as === "statement" ? engine.statement(call, notFirst) : [engine.expression(call)];
}

// ---------------------------------------------------------------------------------------------
// Splicing a function's Galaxy into the library's generated files.

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Galaxy `text` with its comments blanked out, line breaks kept. */
const uncommented = (text: string): string => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, " "));

/**
 * Whether Galaxy `text` defines the function `name`: a line starting with its type and its name,
 * its parameters, then its body's `{` (on that line or the next). Not a call, a declaration (`;`)
 * or a comment.
 */
export const definesFunction = (text: string, name: string): boolean => new RegExp(`^[A-Za-z_][^\\n(;=]*\\b${escape(name)}\\s*\\([^)]*\\)\\s*\\{`, "m").test(uncommented(text));

/** Where the definition of `name` is in a library's Galaxy: from its signature line to past its closing `}` line. */
export function definitionSpan(script: string, name: string): { readonly start: number; readonly end: number } | undefined {
  const match = new RegExp(`^\\S[^\\n(]* ${escape(name)} \\([^\\n]*\\) \\{\\r?$`, "m").exec(script);
  if (!match) return undefined;
  const closing = (from: number): number | undefined => {
    const close = /^\}[ \t]*\r?$/m.exec(script.slice(from));
    if (!close) return undefined;
    const newline = script.indexOf("\n", from + close.index);
    return newline < 0 ? script.length : newline + 1;
  };
  let end = closing(match.index);
  if (end === undefined) return undefined;
  // A function that runs in its own thread: its trigger and parameters' globals before it, its trigger's function after.
  const trigger = `auto_${escape(name)}_Trigger`;
  const first = `trigger auto_${name}_Trigger = null;`;
  const from = script.lastIndexOf(first, match.index);
  const globals = new RegExp(`^${escape(first)}\\r?\\n(?:\\S[^\\n]* auto_${escape(name)}_lp_\\w+;\\r?\\n)*\\r?\\n$`);
  const before = from >= 0 && (from === 0 || script[from - 1] === "\n") && globals.test(script.slice(from, match.index)) ? { index: from } : undefined;
  const after = new RegExp(`^\\r?\\nbool ${trigger}Func \\(bool testConds, bool runActions\\) \\{\\r?\\n`).exec(script.slice(end));
  if (after) end = closing(end) ?? end;
  return { start: before ? before.index : match.index, end };
}

/** Where the declaration of `name` is in a library's header: its line. */
function declarationSpan(header: string, name: string): { readonly start: number; readonly end: number } | undefined {
  const match = new RegExp(`^\\S[^\\n(]* ${escape(name)} \\([^\\n]*\\);[ \\t]*\\r?\\n?`, "m").exec(header);
  return match ? { start: match.index, end: match.index + match[0].length } : undefined;
}

/** The definition of `name` as the script has it, or undefined. */
export function definitionIn(script: string, name: string): string | undefined {
  const span = definitionSpan(script, name);
  return span && script.slice(span.start, span.end).replace(/\r?\n$/, "");
}

/** The declaration of `name` as the header has it, or undefined. */
export function declarationIn(header: string, name: string): string | undefined {
  const span = declarationSpan(header, name);
  return span && header.slice(span.start, span.end).replace(/\r?\n$/, "");
}

/**
 * `script` with each function's definition in place of the Editor's (or, for one it lacks, at the
 * end of its Functions section, where the Editor puts a function last in Root).
 */
export function spliceDefinitions(script: string, definitions: readonly { readonly name: string; readonly definition: string }[]): string {
  const eol = script.includes("\r\n") ? "\r\n" : "\n";
  let out = script;
  for (const { name, definition } of definitions) {
    const text = `${definition.replace(/\n/g, eol)}${eol}`;
    const span = definitionSpan(out, name);
    if (span) {
      out = out.slice(0, span.start) + text + out.slice(span.end);
      continue;
    }
    const triggers = out.search(/^\/\/ Triggers\r?$/m);
    if (triggers < 0) throw new Error(`The library's Galaxy has no "// Triggers" line to add ${name} before: save the mod in the Editor so it writes one`);
    out = `${out.slice(0, triggers)}${text}${eol}${out.slice(triggers)}`;
  }
  return out;
}

/** `script` without the definitions of `names`, each with the blank line the Editor leaves after it. */
export function removeDefinitions(script: string, names: readonly string[]): string {
  let out = script;
  for (const name of names) {
    const span = definitionSpan(out, name);
    if (!span) continue;
    const blank = /^[ \t]*\r?\n/.exec(out.slice(span.end));
    out = out.slice(0, span.start) + out.slice(span.end + (blank ? blank[0].length : 0));
  }
  return out;
}

/** `header` without the declarations of `names`. */
export function removeDeclarations(header: string, names: readonly string[]): string {
  let out = header;
  for (const name of names) {
    const span = declarationSpan(out, name);
    if (span) out = out.slice(0, span.start) + out.slice(span.end);
  }
  return out;
}

const RULE = "//--------------------------------------------------------------------------------------------------";

/**
 * `script`, the library `library`'s Galaxy, with each custom script's text in its Custom Script
 * section as the Editor writes it there: under a ruled "Custom Script: <name>" heading, then a
 * blank line. One the script already has, by name, is replaced; a new one goes after the others,
 * the section opening before Presets when the library has none. The blocks named in `removed` go
 * first: scripts the last compile wrote and this one doesn't, or wrote under another name.
 *
 * As the Editor does, a section with a block in it ends with the library's InitCustomScript, which
 * InitLib calls between InitVariables and InitTriggers; a section left with none goes, with its
 * InitCustomScript and the call, when that calls nothing.
 */
export function spliceCustomScripts(script: string, library: string, customScripts: readonly Pick<LibraryCustomScript, "id" | "name" | "script">[], removed: readonly string[] = []): string {
  const eol = script.includes("\r\n") ? "\r\n" : "\n";
  const lib = escape(library);
  let out = script;
  /** The line after the section's last block: the library's InitCustomScript, or Presets (Functions) when it has none. */
  const sectionEnds = `void lib${lib}_InitCustomScript \\(.*|// Presets|// Functions`;
  const sectionEnd = (from: number): number => {
    const next = new RegExp(`^(?:${sectionEnds})\\r?$`, "m").exec(out.slice(from));
    if (!next) throw new Error(`The library's Galaxy has no "// Presets", "// Functions" or lib${library}_InitCustomScript line to end its Custom Script section at: save the mod in the Editor so it writes them`);
    return from + next.index;
  };
  /** Where the block named `name` is: its heading, to the next block's heading or the section's end. */
  const blockSpan = (name: string): { readonly start: number; readonly end: number } | undefined => {
    const heading = new RegExp(`^${escape(RULE)}\\r?\\n// Custom Script: ${escape(name)}\\r?\\n${escape(RULE)}\\r?\\n`, "m").exec(out);
    if (!heading) return undefined;
    const after = heading.index + heading[0].length;
    const next = new RegExp(`^(?:${escape(RULE)}|${sectionEnds})\\r?$`, "m").exec(out.slice(after));
    return { start: heading.index, end: next ? after + next.index : out.length };
  };
  for (const name of removed) {
    const span = blockSpan(name);
    if (span) out = out.slice(0, span.start) + out.slice(span.end);
  }
  for (const custom of customScripts) {
    const name = custom.name ?? custom.id;
    const block = [RULE, `// Custom Script: ${name}`, RULE, ...custom.script.replace(/\s+$/, "").split(/\r?\n/), "", ""].join(eol);
    const span = blockSpan(name);
    if (span) {
      out = out.slice(0, span.start) + block + out.slice(span.end);
      continue;
    }
    const section = /^\/\/ Custom Script\r?$/m.exec(out);
    const at = sectionEnd(section ? section.index : 0);
    out = out.slice(0, at) + (section ? "" : `// Custom Script${eol}`) + block + out.slice(at);
  }
  return customScriptInit(out, library, eol);
}

/**
 * `script` with its Custom Script section's InitCustomScript as the Editor writes it: when the
 * section has a block, an InitCustomScript after the blocks (empty, unless the package has one)
 * and its call in InitLib; when it has none, no section, and no InitCustomScript that calls nothing.
 */
function customScriptInit(script: string, library: string, eol: string): string {
  const lib = escape(library);
  const section = /^\/\/ Custom Script\r?\n/m.exec(script);
  if (!section) return script;
  const from = section.index + section[0].length;
  const end = new RegExp(`^(?:void lib${lib}_InitCustomScript \\(.*|// Presets|// Functions)\\r?$`, "m").exec(script.slice(from));
  if (!end) return script;
  const sectionEnd = from + end.index;
  const blocks = script.slice(from, sectionEnd);
  const hasInit = script.startsWith(`void lib${library}_InitCustomScript (`, sectionEnd);
  const call = new RegExp(`^ {4}lib${lib}_InitCustomScript\\(\\);\\r?\\n`, "m");
  if (/^\/\/ Custom Script: /m.test(blocks)) {
    if (hasInit) return script;
    const out = `${script.slice(0, sectionEnd)}void lib${library}_InitCustomScript () {${eol}}${eol}${eol}${script.slice(sectionEnd)}`;
    return call.test(out) ? out : withInitCall(out, library, eol);
  }
  // No block left: the section goes, with an InitCustomScript that calls nothing and its call.
  if (blocks.trim() !== "") return script;
  const empty = new RegExp(`^void lib${lib}_InitCustomScript \\(\\) \\{\\r?\\n\\}\\r?\\n(?:\\r?\\n)?`).exec(script.slice(sectionEnd));
  if (hasInit && !empty) return script;
  return (script.slice(0, section.index) + script.slice(sectionEnd + (empty ? empty[0].length : 0))).replace(call, "");
}

/** `script` with InitLib calling the library's InitCustomScript where the Editor does: after InitVariables (InitLibraries), before InitTriggers. */
function withInitCall(script: string, library: string, eol: string): string {
  const lib = escape(library);
  const initLib = new RegExp(`^void lib${lib}_InitLib \\(\\) \\{\\r?$`, "m").exec(script);
  if (!initLib) return script;
  const closing = /^\}\r?$/m.exec(script.slice(initLib.index));
  const body = script.slice(initLib.index, closing ? initLib.index + closing.index : script.length);
  const line = (name: string): RegExpExecArray | null => new RegExp(`^ {4}lib${lib}_${name}\\(\\);\\r?\\n`, "m").exec(body);
  const before = line("InitVariables") ?? line("InitLibraries");
  const triggers = line("InitTriggers");
  const at = before ? before.index + before[0].length : triggers?.index;
  if (at === undefined) return script;
  const where = initLib.index + at;
  return `${script.slice(0, where)}    lib${library}_InitCustomScript();${eol}${script.slice(where)}`;
}

/** `header` with each function's declaration in place of the Editor's, or at the end of its Function Declarations. */
export function spliceDeclarations(header: string, declarations: readonly { readonly name: string; readonly declaration: string }[]): string {
  const eol = header.includes("\r\n") ? "\r\n" : "\n";
  let out = header;
  for (const { name, declaration } of declarations) {
    const span = declarationSpan(out, name);
    if (span) {
      out = out.slice(0, span.start) + declaration + eol + out.slice(span.end);
      continue;
    }
    const next = out.search(/^\/\/ Trigger Declarations\r?$/m);
    if (next < 0) throw new Error(`The library's header has no "// Trigger Declarations" line to add ${name} before: save the mod in the Editor so it writes one`);
    // Before the blank line that ends Function Declarations.
    const before = out.slice(0, next).replace(/(\r?\n)+$/, "");
    out = `${before}${eol}${declaration}${eol}${eol}${out.slice(next)}`;
  }
  return out;
}
