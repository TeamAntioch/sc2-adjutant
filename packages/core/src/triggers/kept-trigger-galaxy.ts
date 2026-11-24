// Renders a Kept trigger or function from its XML in `Triggers` to the Galaxy the Editor writes for
// it on save (ADR-0010), so a tuned trigger's MapScript.galaxy section can be rewritten without an
// Editor save. A primitive with a `galaxy` of its own (a Plugin Mechanic's, ADR-0005) is written
// by it; any function a library in reach defines (an action, a call, an operator, an event, a
// block) by the template engine (src/mods/library-galaxy.ts) in the map's scope, its values and
// the calls in its slots handed back here, as the compile's map script writer does (ADR-0025). The
// libraries in reach are the game's library data and, where the caller gives them, the libraries
// of the Workspace mods the map depends on (src/mods/library-reach.ts). A preset value is the
// catalog's, else the data's. Anything else is listed as unknown, and the trigger can't be tuned.
// A function may be an action, a value or a condition (its return type in its signature), and may
// run in its own thread, written as a library's is (threadedGalaxy); a disabled trigger has no
// section, and a Label changes no Galaxy (#947).
//
// Names follow the Editor's rules: gt_ and gf_ with the name's identifier, gv_ (a global) and lv_
// (a local or a struct member) with it started lower case, lp_ for a function's parameter; an
// indexed value with its indexes after the variable (gv_points[gv_index]), a local array with its
// sizes and a local constant with its value, as the library writer writes them. A
// library's variables (`libMyLib_gv_heroUnit.lv_scout`) are named in the library, which the map
// doesn't hold: as the library in reach names them (a Workspace mod's, library-reach.ts), else as
// placeholders that `bindLibraryNames` learns from the Editor's own Galaxy for the same element
// before it was edited.

import type { ArrayBound, ExpressionSlot, GuiCall, GuiExpression, GuiStatement, GuiValue, HeldValue, StructMember, TypeSpec } from "../domain/library-interface.js";
import { callGalaxy, type EnclosingCall, expressionGalaxy, type GameLibrary, gameTriggerLibraries, type LibraryVariable, presetConstant, reachableBitsPreset, reachableFunction, reachablePresetValue, soundLinkGalaxy, type TemplateScope, textExpressionGalaxy, type TextExpressionWords, textExpressionWords, textGalaxy, threadedGalaxy, UnrenderableGalaxyError, withTokens } from "../mods/library-galaxy.js";
import { arrayBoundOf, dedent, expressionFormProblem, expressionSlotProblem, keysWithText, stringTable } from "../mods/library-xml.js";
import { formatFixed } from "./write-triggers-xml.js";
import { conditionsBlock, GALAXY_DEFAULTS, renderColor, renderUnitFilterText } from "./write-map-script.js";
import { type FunctionDef, galaxyScope, type PresetDef } from "./trigger-catalog.js";
import { galaxyIdentifier } from "./trigger-model.js";
import { child, children, elementOf, refKey, type TriggerXmlElement, type TriggerXmlNode, type TriggersFile } from "./triggers-file.js";

/** What a value is written in: the template calls it sits in, which the engine's #AUTOVAR(v,parent) and (v,ancestor:…) name. */
type KeptScope = { readonly enclosing?: readonly EnclosingCall[] };

const RULE = "//--------------------------------------------------------------------------------------------------";

/** The functions, presets and block slots a Kept trigger may use: core's catalog and the Workspace's Mechanics' primitives, by `<library>/<id>`. */
export type KeptCatalog = {
  readonly functions: ReadonlyMap<string, FunctionDef>;
  readonly presets: ReadonlyMap<string, PresetDef>;
};

/**
 * Something a Kept element uses that can't be rendered: an uncatalogued function or preset, an XML
 * form this renderer doesn't read, or why a library in reach it calls into is refused.
 */
export type UnknownPart = {
  readonly kind: "function" | "preset" | "form" | "refused";
  /** `<library>/<id>` for a function or preset; a description for a form; the library's `refused` for a refused one. */
  readonly key: string;
};

/** Switch's slots (NativeLib.TriggerLib, as Editor 5.0.17 saves them): a case, its value, its actions. */
export const SWITCH = { switchFunction: "Ntve/91C49196", value: "B4ACF12A", caseFunction: "Ntve/3A1227AB", caseType: "AD43BC93", caseValue: "9A8F1093", caseActions: "363CE97C" } as const;

/** Galaxy types of the Editor's variable and parameter types (those the renderer declares). */
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
  camerainfo: "camerainfo",
  playergroup: "playergroup",
  sound: "sound",
  wave: "wave",
  revealer: "revealer",
  order: "order",
  actor: "actor",
  // Handles the game numbers, as every Editor save declares them (a record's members, Missions' globals).
  objective: "int",
  ping: "int",
  dialog: "int",
  control: "int",
};

/** The types a local variable's declaration is written for: any other is refused. */
export const LOCAL_VARIABLE_TYPES: ReadonlySet<string> = new Set(Object.keys(GALAXY_TYPES));

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** A placeholder for a library element's Galaxy name, until `bindLibraryNames` learns it. */
const placeholder = (key: string): string => `\u0001${key}\u0001`;
const PLACEHOLDER = /\u0001([^\u0001]+)\u0001/g;

const quote = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

class Unknown extends Error {}

/** A reference to the map's element `id`, or a library's `<library>/<id>`, as the XML names it. */
const refNode = (ref: string): TriggerXmlNode => {
  const [library, id] = ref.includes("/") ? ref.split("/") : [undefined, ref];
  return { tag: "Variable", attrs: { ...(library ? { Library: library } : {}), Id: id ?? "" }, text: "", children: [] };
};

/**
 * The `Param/Value/…` and `Param/Expression/…` keys that hold text in these strings files' texts
 * (GameStrings, each locale's), with their words: a key holding nothing is an empty text, as an
 * absent one is, which the Editor writes as StringToText("") (textGalaxy); a text expression's
 * words name the slots it sets (textExpressionGalaxy).
 */
export const textValueKeys = (texts: Iterable<string>): Map<string, string> => keysWithText([...texts].map(stringTable));

/** The GameStrings key of a map's text value, the words its Param holds. */
const mapParamValueKey = (id: string): string => `Param/Value/${id}`;

/** The GameStrings key of a map's text expression, its words with their `~<code>~` slots. */
const mapParamExpressionKey = (id: string): string => `Param/Expression/${id}`;

/** Renders the map-local elements of one Triggers file. */
export class KeptGalaxyRenderer {
  readonly unknown: UnknownPart[] = [];
  private readonly scopes = new Map<string, "global" | "local" | "member">();
  private readonly reach: Pick<TemplateScope, "libraries">;

  constructor(
    private readonly file: TriggersFile,
    /** TriggerStrings.txt's names, `Trigger/Name/<id>` and so on. */
    private readonly names: ReadonlyMap<string, string>,
    private readonly catalog: KeptCatalog,
    /** The `Param/Value/<id>` and `Param/Expression/<id>` keys GameStrings gives text (textValueKeys); a text parameter without one is empty. Unknown when left out. */
    private readonly texts?: ReadonlyMap<string, string>,
    /** The libraries in reach of the map: the game's and its Workspace dependency mods' (librariesInReach); the game's alone when left out. */
    libraries: Readonly<Record<string, GameLibrary>> = gameTriggerLibraries(),
  ) {
    this.reach = { libraries };
    for (const element of file.elements.values()) {
      const scope = element.type === "Structure" ? "member" : element.type === "Trigger" || element.type === "FunctionDef" ? "local" : undefined;
      if (!scope) continue;
      for (const node of children(element, "Variable")) this.scopes.set(node.attrs.Id ?? "", scope);
    }
  }

  private element(id: string, type: string): TriggerXmlElement {
    const element = elementOf(this.file, type, id);
    if (!element) throw this.fail("form", `a ${type} ${id} the Triggers file doesn't hold`);
    return element;
  }

  /**
   * The automatic variable declarations of the trigger or function being rendered, which a template
   * call adds its own to; undefined outside a render, where a value's are discarded.
   */
  private autos: string[] | undefined;

  /** The TextExpressionSetToken lines of the actions being rendered, innermost last: each goes before its action. */
  private readonly tokens: string[][] = [];

  /** The Param a variable value's structure member path ends at, whose variable's type the value is: the value itself when it names no member. */
  private memberEnd(param: TriggerXmlElement): TriggerXmlElement {
    const member = child(param, "StructMember");
    return member ? this.memberEnd(this.element(member.attrs.Id ?? "", "Param")) : param;
  }

  /** A library's variable (`<library>/<id>`) as its library in reach holds it, if it does. */
  private libraryVariable(key: string): LibraryVariable | undefined {
    const [library, id] = key.split("/");
    return this.reach.libraries[library ?? ""]?.variables?.[id ?? ""];
  }

  /**
   * The type of a library's variable (`<library>/<id>`) its library in reach doesn't give: the one plain
   * type of the values a Switch on it compares it with, as its Galaxy declares the Switch's variable.
   * Undefined where no Switch tells, or its cases' values aren't all of one plain type.
   */
  private libraryVariableType(key: string): TypeSpec | undefined {
    const params = (call: TriggerXmlElement): TriggerXmlElement[] => children(call, "Parameter").map((node) => this.element(node.attrs.Id ?? "", "Param"));
    const types = new Set<string>();
    for (const element of this.file.elements.values()) {
      const ref = element.type === "FunctionCall" ? child(element, "FunctionDef") : undefined;
      if (!ref || refKey(ref) !== SWITCH.switchFunction) continue;
      const value = params(element).find((param) => child(param, "ParameterDef")?.attrs.Id === SWITCH.value);
      const end = value && this.memberEnd(value);
      const variable = end && child(end, "Variable");
      // A Switch on an element of it tells the element's type, not the variable's, whose sizes the map doesn't hold.
      if (!variable || refKey(variable) !== key || children(end, "Array").length) continue;
      for (const node of children(element, "FunctionCall")) {
        const item = elementOf(this.file, "FunctionCall", node.attrs.Id ?? "");
        if (!item || child(item, "SubFunctionType")?.attrs.Id !== SWITCH.caseType) continue;
        for (const param of params(item)) if (child(param, "ParameterDef")?.attrs.Id === SWITCH.caseValue) types.add(child(param, "ValueType")?.attrs.Type ?? "");
      }
    }
    const [type] = [...types];
    return types.size === 1 && type !== undefined && ["int", "fixed", "bool", "string", "gamelink"].includes(type) ? { type } : undefined;
  }

  /**
   * The map's scope for the template engine: its own elements carry no Library, its names are
   * gt_/gf_/gv_/lv_/lp_, an event binds to `trigger`, and the renderer's libraries are in reach. A map
   * structure type isn't written, its preset types and their values are its own, and its own
   * functions are written here.
   */
  templateScope(trigger?: string): TemplateScope {
    const subject = trigger ? `the trigger ${trigger}` : "the map";
    const refuse = (reason: string): never => {
      throw new UnrenderableGalaxyError(subject, reason);
    };
    /** A type and, for a preset or a structure, its element: `<library>/<id>`, or a bare id for the map's own. */
    const typeOf = (node: TriggerXmlNode | undefined): TypeSpec | undefined => {
      const type = node && child(node, "Type")?.attrs.Value;
      const element = node && child(node, "TypeElement");
      // An array's sizes, so a value indexing it is typed as its element.
      const array = node ? this.arrayBounds(node) : [];
      return type ? { type, ...(element?.attrs.Id ? { element: refKey(element) } : {}), ...(array.length ? { array } : {}) } : undefined;
    };
    return {
      subject,
      library: undefined,
      libraries: this.reach.libraries,
      ...(trigger ? { triggerVariable: trigger } : {}),
      variable: (ref) => this.variableName(refNode(ref)),
      member: (ref) => this.variableName(refNode(ref)),
      parameter: (id) => this.parameterName(id),
      trigger: (id) => this.triggerName(id),
      variableType: (id) => (id.includes("/") ? (this.libraryVariable(id)?.type ?? this.libraryVariableType(id)) : typeOf(child(this.element(id, "Variable"), "VariableType"))),
      parameterType: (id) => typeOf(child(this.element(id, "ParamDef"), "ParameterType")),
      structureType: (id) => refuse(`the structure ${id}, which a map doesn't hold`),
      presetBase: (id) => this.ownPresetBase(id),
      presetValue: (id) => this.ownPresetValue(id),
      ownFunction: (id) => refuse(`the map's function ${id}, which the Kept renderer writes`),
      text: (id) => textGalaxy(mapParamValueKey(id), this.texts),
      textExpression: (id) => this.textExpressionWords(id),
    };
  }

  /**
   * A call to a game function the catalog doesn't wrap, from its template in the map's scope: its
   * values and the calls in its slots written here, as any other, its template's variables added to
   * `autos` before theirs; outside a render, with none to add them to, a call that declares any is
   * refused. A form the engine can't write is noted, naming it.
   */
  private templateCall(call: TriggerXmlElement, trigger: string, scope: KeptScope, as: "statement" | "expression", given = this.autos, notFirst = false): string[] {
    const autos = given ?? [];
    try {
      const lines = callGalaxy(
        {
          ...this.templateScope(trigger || undefined),
          own: {
            value: (value, unitRef, enclosing) => this.value(value.id ?? "", unitRef, { ...scope, enclosing }),
            expression: (nested, enclosing) => this.call(nested.id, trigger, { ...scope, enclosing }),
            statement: (nested, notFirst, enclosing) => this.actionLines(nested.id, trigger, "", { ...scope, enclosing }, autos, notFirst),
          },
        },
        this.guiCall(call),
        { as, notFirst, enclosing: scope.enclosing ?? [], autos },
      );
      if (!given && autos.length > 0) throw this.fail("form", `a call ${call.id} whose template declares variables, outside a trigger or function to declare them in`);
      return lines;
    } catch (error) {
      if (error instanceof UnrenderableGalaxyError) throw error.refused === undefined ? this.fail("form", error.reason) : this.fail("refused", error.refused);
      throw error;
    }
  }

  /** A FunctionCall element as the engine reads a call: its function, slot, parameters and the calls it holds, by `<library>/<id>` (a bare id for the map's own). */
  private guiCall(call: TriggerXmlElement): GuiCall {
    const ref = child(call, "FunctionDef");
    if (!ref) throw this.fail("form", `a call ${call.id} that names no function`);
    const sub = child(call, "SubFunctionType");
    const script = child(call, "ScriptCode");
    const params = children(call, "Parameter").map((node) => {
      const param = this.element(node.attrs.Id ?? "", "Param");
      const def = child(param, "ParameterDef");
      return { id: param.id, def: def ? refKey(def) : "", ...this.guiValue(param) };
    });
    const body = children(call, "FunctionCall").map((node): GuiStatement => {
      if (node.attrs.Type !== "Comment") return this.guiCall(this.element(node.attrs.Id ?? "", "FunctionCall"));
      const comment = this.element(node.attrs.Id ?? "", "Comment");
      const slot = child(comment, "SubFunctionType");
      return { id: comment.id, comment: "", ...(slot ? { sub: refKey(slot) } : {}), ...(child(comment, "Disabled") ? { disabled: true } : {}) };
    });
    return {
      id: call.id,
      function: refKey(ref),
      ...(sub ? { sub: refKey(sub) } : {}),
      ...(child(call, "Disabled") ? { disabled: true } : {}),
      ...(params.length ? { params } : {}),
      ...(body.length ? { body } : {}),
      ...(script ? { script: dedent(script.text) } : {}),
    };
  }

  /** A variable value's structure member, and its members in turn, as the engine reads them. */
  private guiMember(owner: TriggerXmlElement): StructMember | undefined {
    const node = child(owner, "StructMember");
    if (!node) return undefined;
    const param = this.element(node.attrs.Id ?? "", "Param");
    const variable = child(param, "Variable");
    if (!variable) throw this.fail("form", `a struct member ${param.id} that names no variable`);
    const member = this.guiMember(param);
    const index = this.guiIndex(param);
    return { id: param.id, variable: refKey(variable), ...(index ? { index } : {}), ...(member ? { member } : {}) };
  }

  /** The values a variable value (or a structure member) is indexed by, as the engine reads them. */
  private guiIndex(owner: TriggerXmlElement): HeldValue[] | undefined {
    const index = children(owner, "Array").map((node) => {
      const param = this.element(node.attrs.Id ?? "", "Param");
      return { id: param.id, ...this.guiValue(param) } as HeldValue;
    });
    return index.length ? index : undefined;
  }

  /** A Param's value form, as far as the engine tells values apart (it writes them through the scope's own writer). */
  private guiValue(param: TriggerXmlElement): GuiValue {
    const call = child(param, "FunctionCall");
    if (call) return { call: this.guiCall(this.element(call.attrs.Id ?? "", "FunctionCall")) };
    const variable = child(param, "Variable");
    if (variable) {
      const member = this.guiMember(param);
      const index = this.guiIndex(param);
      return { variable: refKey(variable), ...(index ? { index } : {}), ...(member ? { member } : {}) };
    }
    const parameter = child(param, "Parameter");
    if (parameter) return { parameter: refKey(parameter) };
    const preset = child(param, "Preset");
    if (preset) return { preset: refKey(preset) };
    const expression = child(param, "ExpressionType");
    if (expression) return { expression: this.guiExpression(param) };
    const value = child(param, "Value");
    return { type: child(param, "ValueType")?.attrs.Type ?? "", ...(value ? { value: value.text } : {}) };
  }

  /** An expression Param's type, text and slots, as the engine reads them, in the form library-xml.ts's reader takes (expressionFormProblem). */
  private guiExpression(param: TriggerXmlElement): GuiExpression {
    const own = param.children.filter((node) => node.tag !== "ParameterDef");
    const type = own[0]?.attrs.Type ?? "";
    const problem = expressionFormProblem(own.map((node) => node.tag), type);
    if (problem) throw this.fail("form", `its Param ${param.id} ${problem}`);
    const text = child(param, "ExpressionText");
    const slots = children(param, "ExpressionParam").map((node): ExpressionSlot => {
      const slot = this.element(node.attrs.Id ?? "", "Param");
      const code = slot.children.at(-1)?.attrs.Value;
      const wrong = expressionSlotProblem(slot.children.map((child) => child.tag), code);
      if (wrong) throw this.fail("form", `its expression's slot ${slot.id} ${wrong}`);
      return { id: slot.id, code: code!, ...this.guiValue(slot) } as ExpressionSlot;
    });
    return { type, ...(text ? { text: text.text } : {}), slots };
  }

  /** A text expression's GameStrings key and its words: refused where they aren't known or it has none (textExpressionWords). */
  private textExpressionWords(id: string): TextExpressionWords {
    return textExpressionWords(mapParamExpressionKey(id), this.texts, (reason) => {
      throw this.fail("form", reason);
    });
  }

  /**
   * An expression Param's Galaxy: a text one's slots set by lines before the action it is in
   * (textExpressionGalaxy), which a text expression outside one is refused for; any other's text
   * with its slots' values (expressionGalaxy).
   */
  private expressionValue(param: TriggerXmlElement, scope: KeptScope): string {
    const expression = this.guiExpression(param);
    const slot = (given: ExpressionSlot): string => this.value(given.id, false, scope);
    const refuse = (reason: string): never => {
      throw this.fail("form", reason);
    };
    if (expression.type !== "text") return expressionGalaxy(expression, slot, refuse);
    return textExpressionGalaxy(this.tokens, this.textExpressionWords(param.id), expression, slot, refuse);
  }

  private fail(kind: UnknownPart["kind"], key: string): Unknown {
    // Every occurrence, so a caller can tell whether one value used an unknown; a refusal lists each once.
    // A function or preset of a refused library in reach (library-reach.ts) is noted as why the library is refused.
    const refused = kind === "function" || kind === "preset" ? this.reach.libraries[key.split("/")[0]!]?.refused : undefined;
    this.unknown.push(refused === undefined ? { kind, key } : { kind: "refused", key: refused });
    return new Unknown(key);
  }

  /** An element's name in the map, from TriggerStrings.txt. */
  name(type: string, id: string): string {
    const name = this.names.get(`${type}/${id}`);
    if (name === undefined) throw this.fail("form", `a ${type} ${id} with no name in TriggerStrings.txt`);
    return name;
  }

  private identifier(element: TriggerXmlElement): string {
    return child(element, "Identifier")?.text || galaxyIdentifier(this.name(element.type, element.id));
  }

  triggerName(id: string): string {
    return `gt_${this.identifier(this.element(id, "Trigger"))}`;
  }

  functionName(id: string): string {
    return `gf_${this.identifier(this.element(id, "FunctionDef"))}`;
  }

  /** A record's (Structure's) Galaxy name: gs_ and its name's identifier. */
  structureName(id: string): string {
    return `gs_${this.identifier(this.element(id, "Structure"))}`;
  }

  /** The Galaxy names of a preset type's values, in order, each its constant (ge_<preset>_<value>). */
  presetValueNames(id: string): string[] {
    const owner = this.element(id, "Preset");
    return children(owner, "Item")
      .filter((item) => item.attrs.Type === "PresetValue" && !item.attrs.Library)
      .map((item) => presetConstant(undefined, this.identifier(owner), this.identifier(this.element(item.attrs.Id ?? "", "PresetValue"))));
  }

  /**
   * A record's struct as the Editor writes it in Global Structures (CRLF), through the blank line
   * after it: each member declared as a local variable is, with no initial value (each variable of
   * the record starts its members itself). Undefined, with `unknown` filled in, when it can't be.
   */
  renderStructure(id: string): string | undefined {
    this.unknown.length = 0;
    try {
      const element = this.element(id, "Structure");
      this.checkTags(element, ["Variable"]);
      const members = children(element, "Variable").map((node) => `    ${this.localVariable(node.attrs.Id ?? "", { member: true }).declaration}`);
      const lines = [`struct ${this.structureName(id)} {`, ...members, "};", "", ""];
      return this.unknown.length > 0 ? undefined : lines.join("\r\n");
    } catch (error) {
      if (error instanceof Unknown) return undefined;
      throw error;
    }
  }

  /**
   * A preset type's constants as the Editor writes them in Global Preset Declarations (CRLF lines):
   * one for each value, numbered from 0 in order, by name. Only an integer preset type of base type
   * int whose values have none of their own is written, the form every map save shows; undefined,
   * with `unknown` filled in, for any other.
   */
  renderPreset(id: string): { readonly name: string; readonly line: string }[] | undefined {
    this.unknown.length = 0;
    try {
      const element = this.element(id, "Preset");
      this.checkTags(element, ["PresetInteger", "BaseType", "PresetGenConstVar", "Item"]);
      if (!child(element, "PresetInteger") || child(element, "BaseType")?.attrs.Value !== "int") throw this.fail("form", "a preset type other than an integer one of base type int, whose Galaxy no map save shows");
      const values = children(element, "Item").filter((item) => item.attrs.Type === "PresetValue");
      for (const item of values) {
        const value = this.element(item.attrs.Id ?? "", "PresetValue");
        if (item.attrs.Library || value.children.length > 0) throw this.fail("form", `a preset value ${value.id} with a value of its own, whose Galaxy no map save shows`);
      }
      return this.presetValueNames(id).map((name, index) => ({ name, line: `const int ${name} = ${index};\r\n` }));
    } catch (error) {
      if (error instanceof Unknown) return undefined;
      throw error;
    }
  }

  /** A map variable's Galaxy name: gv_ for a global, lv_ for a trigger's or function's own. */
  variableGalaxyName(id: string): string {
    return this.variableName(refNode(id));
  }

  private variableName(node: TriggerXmlNode): string {
    // A library's variable is named as its library in reach names it, else by a placeholder until bindLibraryNames learns it.
    if (node.attrs.Library) return this.libraryVariable(refKey(node))?.galaxy ?? placeholder(refKey(node));
    const id = node.attrs.Id ?? "";
    const element = this.element(id, "Variable");
    const identifier = child(element, "Identifier")?.text;
    const scope = this.scopes.get(id) ?? "global";
    const prefix = scope === "global" ? "gv_" : "lv_";
    return `${prefix}${identifier ?? lowerFirst(galaxyIdentifier(this.name("Variable", id)))}`;
  }

  private parameterName(id: string): string {
    const element = this.element(id, "ParamDef");
    return `lp_${child(element, "Identifier")?.text ?? lowerFirst(galaxyIdentifier(this.name("ParamDef", id)))}`;
  }

  /** A variable reference with its index values and its struct members': `gv_rallyPoints[gv_index]`, `gv_stealth.lv_delay`. */
  private variablePath(param: TriggerXmlElement, variable: TriggerXmlNode, scope: KeptScope): string {
    const indexed = (owner: TriggerXmlElement): string => {
      if (child(owner, "ArrayIndex")) throw this.fail("form", "an <ArrayIndex>");
      return children(owner, "Array")
        .map((node) => `[${this.value(node.attrs.Id ?? "", false, scope)}]`)
        .join("");
    };
    let text = this.variableName(variable) + indexed(param);
    for (let owner = param; ; ) {
      const member = child(owner, "StructMember");
      if (!member) return text;
      const memberParam = this.element(member.attrs.Id ?? "", "Param");
      const memberVariable = child(memberParam, "Variable");
      if (!memberVariable) throw this.fail("form", `a struct member ${memberParam.id} that names no variable`);
      text += `.${this.variableName(memberVariable)}${indexed(memberParam)}`;
      owner = memberParam;
    }
  }

  /** The Galaxy for a Param element's value. */
  value(paramId: string, unitRef = false, scope: KeptScope = {}): string {
    const param = this.element(paramId, "Param");
    const call = child(param, "FunctionCall");
    // Editor saves show an event's unit reference to a variable's unit or a placed one, and its preset (null), but not to a call's or a parameter's.
    if (unitRef && (call || child(param, "Parameter"))) throw this.fail("form", "a unit an event takes that isn't a variable's or a placed unit's, whose Galaxy this doesn't write yet");
    if (call) return this.call(call.attrs.Id ?? "", "", scope);
    const variable = child(param, "Variable");
    if (variable) {
      const path = this.variablePath(param, variable, scope);
      if (unitRef && path.includes("[")) throw this.fail("form", "a unit an event takes from an array, whose Galaxy no Editor save shows");
      return unitRef ? `UnitRefFromVariable("${path}")` : path;
    }
    const parameter = child(param, "Parameter");
    if (parameter) return this.parameterName(parameter.attrs.Id ?? "");
    if (child(param, "ExpressionType")) return this.expressionValue(param, scope);
    const type = child(param, "ValueType")?.attrs.Type;
    // A set of bits: the values set (ValuePreset), joined as Galaxy ors them, in the order the Editor saves them.
    const bits = children(param, "ValuePreset");
    if (type === "preset" && bits.length > 0) return bits.map((node) => this.presetValue(node)).join(" | ");
    const preset = child(param, "Preset") ?? (child(param, "ValueElement")?.attrs.Type === "Preset" ? child(param, "ValueElement") : undefined);
    if (preset?.tag === "Preset") return this.presetValue(preset);
    if (preset) {
      // A set of bits with none set is 0: a preset type the catalog holds as one, or a library in reach defines as bits.
      const def = this.catalog.presets.get(refKey(preset));
      if (def?.form === "element") return def.galaxy;
      if (reachableBitsPreset(this.reach, refKey(preset))) return "0";
      this.fail("preset", refKey(preset));
      return "?";
    }
    const element = child(param, "ValueElement");
    if (type === "trigger" && element?.attrs.Type === "Trigger") return this.triggerName(element.attrs.Id ?? "");
    const text = child(param, "Value")?.text ?? "";
    const valueId = child(param, "ValueId")?.attrs.Id;
    switch (type) {
      case "int":
      case "bool":
        return text;
      case "fixed":
        return formatFixed(Number(text));
      case "string":
      case "gamelink":
      // A conversation line by its `<conversation>|<line>` id, as the Editor writes it.
      case "convline":
      case "actormsg":
      // A user type's instance by its name: its user type (ValueContext) is a parameter of its own.
      case "userinstance":
        return quote(text);
      case "modelanim":
        // The Editor stores an animation name quoted already: "Talk".
        return text;
      case "text":
        return textGalaxy(mapParamValueKey(param.id), this.texts);
      case "soundlink":
        return soundLinkGalaxy(text, valueId);
      case "unitfilter":
        return renderUnitFilterText(text);
      case "abilcmd":
        return `AbilityCommand(${quote(text)}, ${valueId ?? 0})`;
      case "color":
        return renderColor(text);
      case "unit":
        if (valueId === undefined) break;
        return unitRef ? `UnitRefFromUnit(UnitFromId(${valueId}))` : `UnitFromId(${valueId})`;
      case "point":
        if (valueId === undefined) break;
        return `PointFromId(${valueId})`;
      case "region":
        if (valueId === undefined) break;
        return `RegionFromId(${valueId})`;
      case "camerainfo":
        if (valueId === undefined) break;
        return `CameraInfoFromId(${valueId})`;
      case "playercolor":
        if (valueId === undefined) break;
        return valueId;
      case "preset": {
        // An older Editor's set of bits with none set names no preset type: its parameter's, in a library in reach, is one.
        const def = child(param, "ParameterDef");
        const [lib, id] = def?.attrs.Library ? [def.attrs.Library, def.attrs.Id ?? ""] : [];
        const presetType = lib && id ? this.reach.libraries[lib]?.params[id]?.element : undefined;
        if (presetType && reachableBitsPreset(this.reach, presetType)) return "0";
        break;
      }
    }
    throw this.fail("form", `a ${type ?? "typeless"} value`);
  }

  /**
   * The Galaxy of the preset value a `<Preset>` or `<ValuePreset>` names: the map's own, the
   * catalog's, else as a library in reach gives it. One none gives is noted, and "?" stands for it,
   * so the refusal lists every unknown at once.
   */
  private presetValue(node: TriggerXmlNode): string {
    if (!node.attrs.Library) return this.ownPresetValue(node.attrs.Id ?? "");
    const def = this.catalog.presets.get(refKey(node));
    if (def?.form === "value") return def.galaxy;
    const game = reachablePresetValue(this.reach, refKey(node));
    if (game !== undefined) return game;
    this.fail("preset", refKey(node));
    return "?";
  }

  /**
   * A preset value of the map's own: its value, or the constant the Editor generates for one with
   * none (ge_<type>_<value>, its preset type's identifier and its own).
   */
  private ownPresetValue(id: string): string {
    const element = this.element(id, "PresetValue");
    const value = child(element, "Value")?.text.trim();
    const owner = [...this.file.elements.values()].find((node) => node.type === "Preset" && children(node, "Item").some((item) => item.attrs.Type === "PresetValue" && !item.attrs.Library && item.attrs.Id === id));
    // A library's set of bits has a constant for each value, whatever it holds; no map save shows a map's own.
    if (owner && child(owner, "PresetAsBits")) throw this.fail("form", `a value of the map's own set of bits ${owner.id}, whose Galaxy no map save shows`);
    if (value) return value;
    if (!owner) throw this.fail("form", `a preset value ${id} that no preset type of the map holds`);
    return presetConstant(undefined, this.identifier(owner), this.identifier(element));
  }

  /** The Galaxy for a FunctionCall element, as an expression or a single statement. */
  call(callId: string, trigger: string, scope: KeptScope = {}): string {
    const call = this.element(callId, "FunctionCall");
    const ref = child(call, "FunctionDef");
    if (!ref) throw this.fail("form", `a call ${callId} that names no function`);
    const params = children(call, "Parameter").map((node) => this.element(node.attrs.Id ?? "", "Param"));
    const paramFor = (defId: string): TriggerXmlElement | undefined => params.find((param) => child(param, "ParameterDef")?.attrs.Id === defId);
    if (!ref.attrs.Library) {
      // A function of the map's own: its parameters in the order it declares them.
      const def = this.element(ref.attrs.Id ?? "", "FunctionDef");
      const args = children(def, "Parameter").map((node) => {
        const param = paramFor(node.attrs.Id ?? "");
        return param ? this.value(param.id, false, scope) : this.defaultValue(node.attrs.Id ?? "", scope);
      });
      return `${this.functionName(def.id)}(${args.join(", ")})`;
    }
    const def = this.catalog.functions.get(refKey(ref));
    if (!def?.galaxy && reachableFunction(this.reach, refKey(ref))) return this.templateCall(call, trigger, scope, "expression")[0]!;
    if (!def?.galaxy) {
      this.fail("function", refKey(ref));
      return "?";
    }
    // Its own Galaxy is a call from its arguments: calls held in its slots would be dropped.
    const held = children(call, "FunctionCall").filter((node) => node.attrs.Type !== "Comment" && !child(this.element(node.attrs.Id ?? "", "FunctionCall"), "Disabled"));
    if (held.length > 0) throw this.fail("form", `a call ${callId} to ${refKey(ref)} holding calls, which its own galaxy doesn't write`);
    const args: Record<string, string> = {};
    for (const [name, paramDef] of Object.entries(def.params)) {
      const param = paramFor(paramDef.id);
      if (!param) throw this.fail("form", `a call to ${refKey(ref)} without its parameter ${paramDef.id}`);
      args[name] = this.value(param.id, paramDef.unitRef ?? false, scope);
    }
    if (params.length !== Object.keys(def.params).length) throw this.fail("form", `a call to ${refKey(ref)} with parameters its catalog entry doesn't list`);
    return def.galaxy(args, trigger, galaxyScope(scope.enclosing ?? []));
  }

  private defaultValue(paramDefId: string, scope: KeptScope): string {
    const def = this.element(paramDefId, "ParamDef");
    const fallback = child(def, "Default");
    if (!fallback) throw this.fail("form", `a call that leaves out parameter ${paramDefId}, which has no default`);
    return this.value(fallback.attrs.Id ?? "", false, scope);
  }

  /**
   * An action's statements at `indent`: a catalogued one with its own `galaxy` as a call, any other
   * the library data defines from its template. The TextExpressionSetToken lines of the text
   * expressions it is given go first, which a block's own values and conditions are refused for (the
   * actions in its slots set their own).
   */
  private actionLines(callId: string, trigger: string, indent: string, scope: KeptScope, autos: string[], notFirst = false): string[] {
    const call = this.element(callId, "FunctionCall");
    if (child(call, "Disabled")) return [];
    const ref = child(call, "FunctionDef");
    const game = ref?.attrs.Library && !this.catalog.functions.get(refKey(ref))?.galaxy ? reachableFunction(this.reach, refKey(ref)) : undefined;
    const lines = withTokens(
      this.tokens,
      () => (game?.subFunctions?.length ?? 0) > 0,
      () => (game ? this.templateCall(call, trigger, scope, "statement", autos, notFirst) : [`${this.call(call.id, trigger, scope)};`]),
      (reason) => {
        throw this.fail("form", `its call ${call.id}: ${reason}`);
      },
    );
    return lines.map((line) => (line === "" ? "" : `${indent}${line}`));
  }

  /**
   * A local variable's declaration and, unless it's Galaxy's own default, its initial value. A
   * constant is declared with its value; an array with its sizes, each one more than the Editor's
   * (`int[4]` for 3, `[gv_count + 1]` for a constant variable's).
   */
  private localVariable(id: string, { member = false } = {}): { declaration: string; initial?: string } {
    const element = this.element(id, "Variable");
    const variableType = child(element, "VariableType") ?? { tag: "VariableType", attrs: {}, text: "", children: [] };
    const type = child(variableType, "Type")?.attrs.Value ?? "";
    // A game link names the catalog it links into (GameType), which its Galaxy, a string, doesn't show.
    const other = variableType.children.find((node) => !["Type", "Constant", "ArraySize", "TypeElement", ...(type === "gamelink" ? ["GameType"] : [])].includes(node.tag));
    if (other) throw this.fail("form", `a local variable's <${other.tag}>`);
    const galaxy = this.variableType(variableType, type, member);
    const name = this.variableName(refNode(id));
    const value = member ? undefined : child(element, "Value");
    // A record's member starts where each variable of the record does, in its own initialization, not the record's Galaxy.
    const initial = value ? this.value(value.attrs.Id ?? "") : undefined;
    const bounds = this.arrayBounds(variableType).map((bound) => `[${"size" in bound ? bound.size + 1 : `${this.variableName(refNode(bound.variable))} + 1`}]`);
    if (child(variableType, "Constant")) {
      if (bounds.length || initial === undefined) throw this.fail("form", `a constant local variable ${bounds.length ? "array" : "with no value"}`);
      return { declaration: `const ${galaxy} ${name} = ${initial};` };
    }
    const starts = initial !== undefined && !GALAXY_DEFAULTS.has(initial);
    // No Editor save sets an array variable's elements to a value of its own in a trigger.
    if (starts && bounds.length) throw this.fail("form", "an array local variable with an initial value");
    return { declaration: `${galaxy}${bounds.join("")} ${name};`, ...(starts ? { initial: `${name} = ${initial};` } : {}) };
  }

  /**
   * A variable's Galaxy type, from its `<VariableType>` of `type`: a plain type's, a preset type's
   * base type's (the map's own or a library's in reach), and, for a record's member, a record of the
   * map's own as its struct (gs_). A variable of a record type is refused: its Galaxy initializes
   * each member, which this doesn't write yet.
   */
  private variableType(variableType: TriggerXmlNode, type: string, member: boolean): string {
    const element = child(variableType, "TypeElement");
    if (element && type !== "preset" && type !== "struct") throw this.fail("form", "a local variable's <TypeElement>");
    if (type === "preset") {
      if (!element) throw this.fail("form", "a local variable of a preset type it doesn't name");
      if (!element.attrs.Library) return this.ownPresetBase(element.attrs.Id ?? "");
      return this.presetBaseGalaxy(this.reach.libraries[element.attrs.Library]?.presets[element.attrs.Id ?? ""]?.base, `a variable of the preset type ${refKey(element)}`);
    }
    if (type === "struct") {
      if (!member) throw this.fail("form", "a variable of a record type, whose members' initialization this doesn't write yet");
      if (!element || element.attrs.Library) throw this.fail("form", `a record's member of ${element ? `the library record ${refKey(element)}` : "a record type it doesn't name"}`);
      return this.structureName(element.attrs.Id ?? "");
    }
    if (type === "gamelink") return "string";
    const galaxy = GALAXY_TYPES[type];
    if (!galaxy) throw this.fail("form", `a local variable of type ${type || "(none)"}`);
    return galaxy;
  }

  /** A `<VariableType>`'s array sizes, read as the library reader reads them (arrayBoundOf): none for a variable that isn't an array. */
  private arrayBounds(variableType: TriggerXmlNode): ArrayBound[] {
    return children(variableType, "ArraySize").map((bound, dim) => {
      const read = arrayBoundOf((name) => bound.attrs[name], dim);
      if ("refused" in read) throw this.fail("form", read.refused);
      return read;
    });
  }

  /** A function's Galaxy return type: `void` for an action, which has none; a value's or a condition's its `<ReturnType>`'s, a plain type. */
  private returnType(element: TriggerXmlElement, returnsValue: boolean): string {
    const node = child(element, "ReturnType");
    if (!returnsValue) {
      // As the library writer refuses one: one save has it, too few to know its rule.
      if (node) throw this.fail("form", "an action with a <ReturnType>");
      return "void";
    }
    const other = node?.children.find((tag) => tag.tag !== "Type");
    if (other) throw this.fail("form", `a function returning a type with a <${other.tag}>`);
    const type = node && child(node, "Type")?.attrs.Value;
    const galaxy = type ? GALAXY_TYPES[type] : undefined;
    if (!galaxy) throw this.fail("form", `a function returning ${type ? `a ${type}` : "no type"}`);
    return galaxy;
  }

  /** The Galaxy type of a preset type of the map's own: its base type's. */
  private ownPresetBase(id: string): string {
    return this.presetBaseGalaxy(child(this.element(id, "Preset"), "BaseType")?.attrs.Value, `the preset type ${id}`);
  }

  /** The Galaxy type of a preset type's base type `base`: refused, naming the preset type (`what`), where this doesn't declare it. */
  private presetBaseGalaxy(base: string | undefined, what: string): string {
    const galaxy = base ? GALAXY_TYPES[base] : undefined;
    if (!galaxy) throw this.fail("form", `${what}, whose base type ${base ? `${base} ` : ""}this doesn't declare`);
    return galaxy;
  }

  /**
   * A map function's parameter's Galaxy type, from its `<ParameterType>`: a game link (of any
   * catalog, its GameType) and a user type's instance are strings, a preset its preset type's base
   * type, the map's own or a library's in reach.
   */
  private parameterType(node: TriggerXmlNode | undefined): string {
    const type = (node && child(node, "Type")?.attrs.Value) ?? "";
    if (type === "gamelink" || type === "userinstance") return "string";
    if (type === "preset") {
      const element = node && child(node, "TypeElement");
      if (!element?.attrs.Library) return this.ownPresetBase(element?.attrs.Id ?? "");
      return this.presetBaseGalaxy(this.reach.libraries[element.attrs.Library]?.presets[element.attrs.Id ?? ""]?.base, `a parameter of the preset type ${refKey(element)}`);
    }
    const galaxy = GALAXY_TYPES[type];
    if (!galaxy) throw this.fail("form", `a parameter of type ${type || "(none)"}`);
    return galaxy;
  }

  /** The tags an element of `type` may hold that this renderer reads; any other is a form it doesn't know. */
  private checkTags(element: TriggerXmlElement, known: readonly string[]): void {
    for (const node of element.children) if (!known.includes(node.tag)) throw this.fail("form", `a ${element.type}'s <${node.tag}>`);
  }

  /** Statements for a body's calls, comments left out (the Editor writes nothing for them). */
  private bodyLines(refs: readonly TriggerXmlNode[], trigger: string, autos: string[]): string[] {
    return refs.filter((node) => node.attrs.Type !== "Comment").flatMap((node) => this.actionLines(node.attrs.Id ?? "", trigger, "    ", {}, autos));
  }

  /** The variable lines before the body: declarations, the automatic ones, the initialization. */
  private header(locals: readonly TriggerXmlNode[], autos: readonly string[]): string[] {
    const variables = locals.map((node) => this.localVariable(node.attrs.Id ?? ""));
    return [
      ...(variables.length > 0 ? ["    // Variable Declarations", ...variables.map((variable) => `    ${variable.declaration}`), ""] : []),
      "    // Automatic Variable Declarations",
      ...(autos.length > 0 ? [...autos.map((declaration) => `    ${declaration}`), ""] : []),
      ...(variables.length > 0 ? ["    // Variable Initialization", ...variables.flatMap((variable) => (variable.initial ? [`    ${variable.initial}`] : [])), ""] : []),
    ];
  }

  /**
   * A trigger's section as the Editor writes it (CRLF), from the rule before `// Trigger: <name>`
   * to the blank line after its _Init; empty for a disabled trigger, which has none; undefined, with
   * `unknown` filled in, when it can't be.
   */
  renderTrigger(id: string): string | undefined {
    this.unknown.length = 0;
    try {
      const element = this.element(id, "Trigger");
      // The Editor writes no section for a disabled trigger, whatever it holds, nor its global or its _Init's call (thanson01's cheats).
      if (child(element, "Disabled")) return "";
      // A Label is the trigger's icon in the Editor and a Section where a campaign files it: neither changes its Galaxy.
      this.checkTags(element, ["Label", "Section", "Variable", "Event", "Condition", "Action", "InitOff", "Identifier"]);
      const name = this.triggerName(id);
      const autos: string[] = (this.autos = []);
      const actions = this.bodyLines(children(element, "Action"), name, autos);
      const conditions = children(element, "Condition").filter((node) => node.attrs.Type !== "Comment" && !child(this.element(node.attrs.Id ?? "", "FunctionCall"), "Disabled"));
      const conditionLines = conditionsBlock(conditions.map((node) => this.call(node.attrs.Id ?? "", name)));
      // An event is written in the trigger's _Init, not its _Func, whose header declares the template variables: no save shows
      // an event's value needing any, so one that does is refused.
      const eventAutos: string[] = (this.autos = []);
      const events = children(element, "Event")
        .filter((node) => node.attrs.Type !== "Comment" && !child(this.element(node.attrs.Id ?? "", "FunctionCall"), "Disabled"))
        .map((node) => `    ${this.call(node.attrs.Id ?? "", name)};`);
      if (eventAutos.length > 0) throw this.fail("form", "an event whose value declares template variables, whose Galaxy this doesn't write yet");
      this.autos = autos;
      const lines = [
        RULE,
        `// Trigger: ${this.name("Trigger", id)}`,
        RULE,
        `bool ${name}_Func (bool testConds, bool runActions) {`,
        ...this.header(children(element, "Variable"), autos),
        ...conditionLines,
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
        ...(child(element, "InitOff") ? [`    TriggerEnable(${name}, false);`] : []),
        ...events,
        "}",
        "",
        "",
      ];
      return this.unknown.length > 0 ? undefined : lines.join("\r\n");
    } catch (error) {
      if (error instanceof Unknown) return undefined;
      throw error;
    } finally {
      this.autos = undefined;
    }
  }

  /**
   * A global variable's declaration (in Global Variables) and, unless it's Galaxy's own default, its
   * initialization (in InitGlobals), as the Editor writes them; undefined, with `unknown` filled in,
   * when they can't be.
   */
  renderGlobal(id: string): { readonly declaration: string; readonly initial?: string } | undefined {
    this.unknown.length = 0;
    try {
      const global = this.localVariable(id);
      return this.unknown.length > 0 ? undefined : global;
    } catch (error) {
      if (error instanceof Unknown) return undefined;
      throw error;
    }
  }

  /**
   * A function's definition as the Editor writes it (CRLF), through the blank line after it: an
   * action's, or a value's or a condition's with its return type; one that runs in its own thread
   * with its trigger and globals (threadedGalaxy). Undefined when it can't be.
   */
  renderFunction(id: string): string | undefined {
    this.unknown.length = 0;
    try {
      const element = this.element(id, "FunctionDef");
      // A Label is the function's icon in the Editor and a Section where a campaign files it: neither changes its Galaxy.
      this.checkTags(element, ["Label", "Section", "FlagAction", "FlagCall", "FlagCondition", "FlagCreateThread", "ReturnType", "Parameter", "Variable", "FunctionCall", "Identifier"]);
      const kinds = ["FlagAction", "FlagCall", "FlagCondition"].filter((tag) => child(element, tag));
      if (kinds.length !== 1) throw this.fail("form", `a function with ${kinds.length} kind flags (FlagAction, FlagCall, FlagCondition)`);
      const returns = this.returnType(element, kinds[0] !== "FlagAction");
      const thread = child(element, "FlagCreateThread") !== undefined;
      // A thread hands nothing back to its caller; no Editor save has a function that runs in one and returns a value.
      if (thread && returns !== "void") throw this.fail("form", "a function that runs in its own thread and returns a value, whose Galaxy no Editor save shows");
      const name = this.functionName(id);
      const params = children(element, "Parameter").map((node) => {
        const def = this.element(node.attrs.Id ?? "", "ParamDef");
        return { type: this.parameterType(child(def, "ParameterType")), name: this.parameterName(def.id) };
      });
      const autos: string[] = (this.autos = []);
      const actions = children(element, "FunctionCall");
      const body = this.bodyLines(actions, "", autos);
      const signature = `${returns} ${name} (${params.map((param) => `${param.type} ${param.name}`).join(", ")})`;
      // A function with no actions has no Implementation line; one whose actions are all disabled or comments has it.
      const inner = [...this.header(children(element, "Variable"), autos), ...(actions.length > 0 ? ["    // Implementation"] : []), ...body];
      const lines = [...(thread ? threadedGalaxy(name, signature, params, inner) : [`${signature} {`, ...inner, "}"]), "", ""];
      return this.unknown.length > 0 ? undefined : lines.join("\r\n");
    } catch (error) {
      if (error instanceof Unknown) return undefined;
      throw error;
    } finally {
      this.autos = undefined;
    }
  }
}

/** Whether rendered Galaxy still holds library placeholders. */
export const hasPlaceholders = (text: string): boolean => text.includes("\u0001");

/**
 * The names of the library elements `rendered` (Galaxy with placeholders) uses, learned from
 * `saved`, the Editor's Galaxy for the same element; undefined when `saved` isn't that Galaxy.
 */
export function bindLibraryNames(rendered: string, saved: string): Map<string, string> | undefined {
  const keys: string[] = [];
  let pattern = "";
  let last = 0;
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const match of rendered.matchAll(PLACEHOLDER)) {
    pattern += escape(rendered.slice(last, match.index));
    const key = match[1]!;
    const seen = keys.indexOf(key);
    if (seen >= 0) pattern += `\\${seen + 1}`;
    else {
      keys.push(key);
      pattern += "([A-Za-z_][A-Za-z0-9_]*)";
    }
    last = match.index + match[0].length;
  }
  pattern += escape(rendered.slice(last));
  const found = new RegExp(`^${pattern}$`).exec(saved);
  if (!found) return undefined;
  return new Map(keys.map((key, index) => [key, found[index + 1]!]));
}

/** `rendered` with its placeholders replaced by the names in `names`; throws on one it lacks. */
export function fillLibraryNames(rendered: string, names: ReadonlyMap<string, string>): string {
  return rendered.replace(PLACEHOLDER, (_, key: string) => {
    const name = names.get(key);
    if (name === undefined) throw new Error(`No Galaxy name known for the library element ${key}`);
    return name;
  });
}
