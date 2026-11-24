// A library function's GUI as the Editor saves it in a mod's Triggers, read and written (ADR-0011).
//
// The Editor writes a library function as its FunctionDef element, then every element it owns, in
// the order it reaches them (each one's own before the next): its ParamDefs and their defaults,
// its block slots (SubFuncTypes), its local Variables and their initial values, then its calls,
// comments and their parameters. Each is a flat `<Element Type Id>` beside the rest, tied to the
// others by Id. Names, grammars and hints are in TriggerStrings.txt, keyed `lib_<library>_<id>`.
//
//   functionXml(library, fn, body)   the item line and the elements, as above
//   functionStrings(library, fn, body)   its TriggerStrings keys
//   readLibraryFunction(xml, strings, library, id)   back to the interface and the GUI body; a form
//                                    this file doesn't write is refused with what it is, so the
//                                    function stays Kept rather than convert lossily

import type { ArrayBound, ExpressionSlot, GuiBody, GuiCall, GuiExpression, GuiParam, GuiStatement, GuiValue, GuiVariable, HeldValue, LibraryCategory, LibraryComment, LibraryCustomScript, LibraryFunction, LibraryItemKind, LibraryParameter, LibraryPreset, LibraryStructure, StructMember, TypeSpec } from "../domain/library-interface.js";
import type { BlueprintPreset, BlueprintTrigger } from "../domain/blueprint-trigger.js";
import { isComment, LIBRARY_ITEM_TYPES, LIBRARY_STRUCTURE_KINDS, type LibraryStructureKind } from "../domain/library-interface.js";
import { elementKey } from "../triggers/triggers-file.js";
import { labelLine } from "../triggers/write-triggers-xml.js";
import { xmlAttribute, type XmlNode, xmlTree } from "../util/xml.js";

const ELEMENT = "        ";
const CHILD = "            ";
const GRANDCHILD = "                ";

/** `text` as XML text or an attribute's value: `&`, `<`, `>` and `"` escaped. */
export const escapeXml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const KIND_FLAGS = { action: "FlagAction", function: "FlagCall", condition: "FlagCondition", event: "FlagEvent" } as const;
const flagTag = (flag: string): string => `Flag${flag.charAt(0).toUpperCase()}${flag.slice(1)}`;

/** The TriggerStrings key of a library element's name (or grammar, hint). */
export const libraryStringKey = (library: string, type: string, field: "Name" | "Grammar" | "Hint", id: string): string => `${type}/${field}/lib_${library}_${id}`;

/** The GameStrings key of a library's text value, the words its Param holds: Param/Value/lib_<library>_<id>. */
export const paramValueKey = (library: string, id: string): string => `Param/Value/lib_${library}_${id}`;

/** The GameStrings key of a library's text expression, its words with their `~<code>~` slots: Param/Expression/lib_<library>_<id>. */
export const paramExpressionKey = (library: string, id: string): string => `Param/Expression/lib_${library}_${id}`;

/**
 * What is wrong with an expression Param's children past ParameterDef (their tags), of `type`, as
 * every Editor save has them: ExpressionType, ExpressionText (none for a text expression, whose
 * words are in GameStrings), then each ExpressionParam. Undefined when nothing is.
 */
export function expressionFormProblem(tags: readonly string[], type: string | undefined): string | undefined {
  if (!type) return "has an ExpressionType with no Type";
  const text = tags[1] === "ExpressionText";
  if (tags[0] !== "ExpressionType" || tags.slice(text ? 2 : 1).some((tag) => tag !== "ExpressionParam")) return `holds ${tags.join(", ")}, an expression in a form a conversion doesn't write yet`;
  if ((type === "text") === text) return `is ${type === "text" ? "a text expression with text of its own" : `a ${type} expression with no text`}, which no Editor save has`;
  return undefined;
}

/**
 * What is wrong with the children (their tags) of the Param holding an expression's slot's value,
 * and its `code`, as every Editor save has them: the value, then ExpressionCode last, with no
 * ParameterDef, and no expression in a slot. Undefined when nothing is.
 */
export function expressionSlotProblem(tags: readonly string[], code: string | undefined): string | undefined {
  if (tags.at(-1) !== "ExpressionCode" || !code) return "has no ExpressionCode last";
  if (tags.includes("ParameterDef")) return "names a parameter definition";
  if (tags[0] === "ExpressionType") return "is an expression itself, which no Editor save has";
  return undefined;
}

/** A reference child line: `<Tag Type="…" Library="…" Id="…"/>`; a map's own element (no library) has no Library. */
function refLine(indent: string, tag: string, type: string, ref: string, library: string | undefined): string {
  const [lib, id] = refParts(ref, library);
  return `${indent}<${tag} Type="${type}"${lib === undefined ? "" : ` Library="${lib}"`} Id="${id}"/>`;
}

/** A reference's library and Id: a bare one is `library`'s own, or the map's (undefined). */
const refParts = <Library extends string | undefined>(ref: string, library: Library): [string | Library, string] => (ref.includes("/") ? (ref.split("/") as [string, string]) : [library, ref]);

/** An item's icon, a Label by ref, as a Mission's Trigger Folders write theirs. */
const labelRefLine = (ref: string, library: string): string => `${CHILD}${labelLine(...refParts(ref, library))}`;

/** A map element's icon line, a Label as `<library>/<id>`, at `indent`. */
export const mapLabelLine = (ref: string, indent: string): string => `${indent}${labelLine(...(ref.split("/") as [string, string]))}`;

function typeLines(indent: string, tag: string, type: TypeSpec, library: string | undefined): string[] {
  return [
    `${indent}<${tag}>`,
    `${indent}    <Type Value="${escapeXml(type.type)}"/>`,
    ...(type.element ? [refLine(`${indent}    `, "TypeElement", typeElementKind(type.type), type.element, library)] : []),
    ...(type.gameType ? [`${indent}    <GameType Value="${escapeXml(type.gameType)}"/>`] : []),
    ...(type.assetType ? [`${indent}    <AssetType Value="${escapeXml(type.assetType)}"/>`] : []),
    ...(type.userType ? [`${indent}    <UserType Value="${escapeXml(type.userType)}"/>`] : []),
    ...(type.constant ? [`${indent}    <Constant/>`] : []),
    ...(type.array ?? []).map((bound, dim) => {
      if ("size" in bound) return `${indent}    <ArraySize Dim="${dim}" Value="${bound.size}"/>`;
      // A map's own constant names no Library.
      const [lib, id] = refParts(bound.variable, library);
      return `${indent}    <ArraySize Dim="${dim}" Type="Variable"${lib === undefined ? "" : ` Library="${lib}"`} Id="${id}"/>`;
    }),
    `${indent}</${tag}>`,
  ];
}

/** A `<ScriptCode>` block: its text's lines under the tag, a blank line left empty. */
export const scriptCodeLines = (text: string, child = CHILD, grandchild = GRANDCHILD): string[] => [`${child}<ScriptCode>`, ...text.split("\n").map((line) => (line === "" ? "" : `${grandchild}${escapeXml(line)}`)), `${child}</ScriptCode>`];

/** What a type's TypeElement names: a structure's Structure, a user instance's parameter giving its user type (ParamDef), else a Preset. */
const typeElementKind = (type: string): string => (type === "struct" ? "Structure" : type === "userinstance" ? "ParamDef" : "Preset");

/**
 * Writes elements in the order the Editor reaches them: a library's (each reference naming the
 * library, its elements indented in its `<Library>` block) or, with no library, a map's own (its
 * own references bare, its elements at the top of `<TriggerData>`).
 */
export class ElementWriter {
  readonly elements: string[] = [];
  private readonly library: string | undefined;
  /** The indentation of an element's line, its child lines and theirs. */
  private readonly elementIndent: string;
  private readonly child: string;
  private readonly grandchild: string;

  constructor(library: string | undefined, indent = ELEMENT) {
    this.library = library;
    this.elementIndent = indent;
    this.child = `${indent}    `;
    this.grandchild = `${indent}        `;
  }

  /** An element with these child lines, as the Editor writes it. */
  element(type: string, id: string, children: readonly string[]): void {
    this.elements.push(children.length ? [`${this.elementIndent}<Element Type="${type}" Id="${id}">`, ...children, `${this.elementIndent}</Element>`].join("\n") : `${this.elementIndent}<Element Type="${type}" Id="${id}">\n${this.elementIndent}</Element>`);
  }

  /** A value's child lines in its Param, and the elements it owns, written after. */
  private valueLines(value: GuiValue): { lines: string[]; after: () => void } {
    const lib = this.library;
    if ("preset" in value && value.preset !== undefined) return { lines: [refLine(this.child, "Preset", "PresetValue", value.preset, lib)], after: () => {} };
    if (("presetElement" in value && value.presetElement !== undefined) || ("bits" in value && value.bits !== undefined)) {
      const element = "presetElement" in value ? value.presetElement : undefined;
      const bits = ("bits" in value ? value.bits : undefined) ?? [];
      return { lines: [`${this.child}<ValueType Type="preset"/>`, ...(element ? [refLine(this.child, "ValueElement", "Preset", element, lib)] : []), ...bits.map((bit) => refLine(this.child, "ValuePreset", "PresetValue", bit, lib))], after: () => {} };
    }
    if ("call" in value && value.call !== undefined) {
      const call = value.call;
      return { lines: [refLine(this.child, "FunctionCall", "FunctionCall", call.id, lib)], after: () => this.statement(call) };
    }
    if ("variable" in value && value.variable !== undefined) return { lines: this.variableLines(value), after: () => this.variableOwned(value) };
    if ("parameter" in value && value.parameter !== undefined) return { lines: [refLine(this.child, "Parameter", "ParamDef", value.parameter, lib)], after: () => {} };
    if ("trigger" in value && value.trigger !== undefined) return { lines: [`${this.child}<ValueType Type="trigger"/>`, refLine(this.child, "ValueElement", "Trigger", value.trigger, lib)], after: () => {} };
    if ("customScript" in value && value.customScript !== undefined) return { lines: [...(value.customType !== undefined ? [`${this.child}<CustomType Type="${escapeXml(value.customType)}"/>`] : []), ...scriptCodeLines(value.customScript, this.child, this.grandchild)], after: () => {} };
    if ("expression" in value && value.expression !== undefined) {
      const expression = value.expression;
      return {
        lines: [
          `${this.child}<ExpressionType Type="${escapeXml(expression.type)}"/>`,
          ...(expression.text !== undefined ? [`${this.child}<ExpressionText>${escapeXml(expression.text)}</ExpressionText>`] : []),
          ...expression.slots.map((slot) => refLine(this.child, "ExpressionParam", "Param", slot.id, lib)),
        ],
        after: () => expression.slots.forEach((slot) => this.slot(slot)),
      };
    }
    const literal = value as Extract<GuiValue, { type: string }>;
    return {
      lines: [
        ...(literal.value !== undefined ? [`${this.child}<Value>${escapeXml(literal.value)}</Value>`] : []),
        `${this.child}<ValueType Type="${escapeXml(literal.type)}"/>`,
        ...(literal.valueId !== undefined ? [`${this.child}<ValueId Id="${literal.valueId}"/>`] : []),
        ...(literal.typeInfo !== undefined ? [`${this.child}<ValueTypeInfo Value="${escapeXml(literal.typeInfo)}"/>`] : []),
        ...(literal.gameType !== undefined ? [`${this.child}<ValueGameType Type="${escapeXml(literal.gameType)}"/>`] : []),
        ...(literal.context !== undefined ? [`${this.child}<ValueContext Value="${escapeXml(literal.context)}"/>`] : []),
        ...(literal.valueParams ?? []).map((held) => refLine(this.child, "ValueParam", "Param", held.id, lib)),
      ],
      after: () => (literal.valueParams ?? []).forEach((held) => this.held(held)),
    };
  }

  /** A variable's lines in a Param: the variable, its structure member, then each index value, as the Editor writes them. */
  private variableLines(value: VariableValue): string[] {
    const lib = this.library;
    return [refLine(this.child, "Variable", "Variable", value.variable, lib), ...(value.member ? [refLine(this.child, "StructMember", "Param", value.member.id, lib)] : []), ...(value.index ?? []).map((held) => refLine(this.child, "Array", "Param", held.id, lib))];
  }

  /** The elements a variable's Param owns, in the order the Editor reaches them: its member's, then its index values'. */
  private variableOwned(value: VariableValue): void {
    if (value.member) this.member(value.member);
    for (const held of value.index ?? []) this.held(held);
  }

  /** The Param naming a structure's member, and what it owns. */
  private member(member: StructMember): void {
    this.element("Param", member.id, this.variableLines(member));
    this.variableOwned(member);
  }

  /** The Param holding the value an expression's slot is given, its code last, and what it owns. */
  private slot(slot: ExpressionSlot): void {
    const { lines, after } = this.valueLines(slot);
    this.element("Param", slot.id, [...lines, `${this.child}<ExpressionCode Value="${escapeXml(slot.code)}"/>`]);
    after();
  }

  /** A Param holding a value (a default, an initial value), and what it owns. */
  held(held: HeldValue): void {
    const { lines, after } = this.valueLines(held);
    this.element("Param", held.id, lines);
    after();
  }

  private param(param: GuiParam): void {
    const { lines, after } = this.valueLines(param);
    this.element("Param", param.id, [refLine(this.child, "ParameterDef", "ParamDef", param.def, this.library), ...lines]);
    after();
  }

  statement(statement: GuiStatement): void {
    const lib = this.library;
    if (isComment(statement)) {
      const text = statement.comment === "" ? [] : [`${this.child}<Comment>`, ...statement.comment.split("\n").map((line) => `${this.grandchild}${escapeXml(line)}`), `${this.child}</Comment>`];
      this.element("Comment", statement.id, [...(statement.disabled ? [`${this.child}<Disabled/>`] : []), ...text, ...(statement.sub ? [refLine(this.child, "SubFunctionType", "SubFuncType", statement.sub, lib)] : [])]);
      return;
    }
    const call: GuiCall = statement;
    this.element("FunctionCall", call.id, [
      ...(call.disabled ? [`${this.child}<Disabled/>`] : []),
      refLine(this.child, "FunctionDef", "FunctionDef", call.function, lib),
      ...(call.sub ? [refLine(this.child, "SubFunctionType", "SubFuncType", call.sub, lib)] : []),
      ...(call.params ?? []).map((param) => refLine(this.child, "Parameter", "Param", param.id, lib)),
      ...(call.body ?? []).map((inner) => refLine(this.child, "FunctionCall", isComment(inner) ? "Comment" : "FunctionCall", inner.id, lib)),
      ...(call.script !== undefined ? scriptCodeLines(call.script, this.child, this.grandchild) : []),
    ]);
    for (const param of call.params ?? []) this.param(param);
    for (const inner of call.body ?? []) this.statement(inner);
  }

  parameter(parameter: LibraryParameter): void {
    this.element("ParamDef", parameter.id, [
      ...(parameter.identifier ? [`${this.child}<Identifier>${escapeXml(parameter.identifier)}</Identifier>`] : []),
      ...typeLines(this.child, "ParameterType", parameter.type, this.library),
      ...(parameter.preload ? [`${this.child}<ParamFlagPreload/>`] : []),
      ...(parameter.default ? [refLine(this.child, "Default", "Param", parameter.default.id, this.library)] : []),
      ...[parameter.preset ?? []].flat().map((preset) => refLine(this.child, "Preset", "Preset", preset, this.library)),
      ...(parameter.limits !== undefined ? [`${this.child}<Limits Value="${escapeXml(parameter.limits)}"/>`] : []),
    ]);
    if (parameter.default) this.held(parameter.default);
  }

  variable(variable: GuiVariable): void {
    this.element("Variable", variable.id, [
      ...(variable.identifier ? [`${this.child}<Identifier>${escapeXml(variable.identifier)}</Identifier>`] : []),
      ...typeLines(this.child, "VariableType", variable.type, this.library),
      ...(variable.value ? [refLine(this.child, "Value", "Param", variable.value.id, this.library)] : []),
    ]);
    if (variable.value) this.held(variable.value);
  }

  subFunction(slot: LibraryFunction["subFunctions"][number]): void {
    this.element("SubFuncType", slot.id, [
      ...(slot.identifier ? [`${this.child}<Identifier>${escapeXml(slot.identifier)}</Identifier>`] : []),
      ...(slot.holds === "action" ? [`${this.child}<Action/>`] : slot.holds === "condition" ? [`${this.child}<Condition/>`] : []),
    ]);
  }
}

/**
 * The function's item line (filed in Root) and its elements, as the Editor writes them: a library's
 * (`library`), its elements in its `<Library>` block, or, with no library, a map's own (a Mission
 * Blueprint's, ADR-0026), its own references bare and its elements at the top of `<TriggerData>`.
 */
export function functionXml(library: string | undefined, fn: LibraryFunction, body?: GuiBody): { readonly itemLine: string; readonly elements: readonly string[] } {
  const [element, child, grandchild] = library === undefined ? ["    ", ELEMENT, CHILD] : [ELEMENT, CHILD, GRANDCHILD];
  const writer = new ElementWriter(library, element);
  const lib = library;
  const def = [
    ...(fn.identifier ? [`${child}<Identifier>${escapeXml(fn.identifier)}</Identifier>`] : []),
    ...(fn.label ? [lib === undefined ? mapLabelLine(fn.label, child) : labelRefLine(fn.label, lib)] : []),
    ...(fn.section !== undefined ? [`${child}<Section Value="${escapeXml(fn.section)}"/>`] : []),
    ...(fn.disabled ? [`${child}<Disabled/>`] : []),
    ...(fn.deprecated ? [`${child}<Deprecated/>`] : []),
    ...(fn.internal ? [`${child}<Internal/>`] : []),
    `${child}<${KIND_FLAGS[fn.kind]}/>`,
    ...fn.flags.map((flag) => `${child}<${flagTag(flag)}/>`),
    ...(fn.returns ? typeLines(child, "ReturnType", fn.returns, lib) : []),
    ...fn.parameters.map((parameter) => refLine(child, "Parameter", "ParamDef", parameter.id, lib)),
    ...fn.subFunctions.map((slot) => refLine(child, "SubFunctionType", "SubFuncType", slot.id, lib)),
    ...(body?.variables ?? []).map((variable) => refLine(child, "Variable", "Variable", variable.id, lib)),
    ...(body?.actions ?? []).map((statement) => refLine(child, "FunctionCall", isComment(statement) ? "Comment" : "FunctionCall", statement.id, lib)),
    ...(fn.script !== undefined ? scriptCodeLines(fn.script, child, grandchild) : []),
  ];
  writer.elements.push([`${element}<Element Type="FunctionDef" Id="${fn.id}">`, ...def, `${element}</Element>`].join("\n"));
  for (const parameter of fn.parameters) writer.parameter(parameter);
  for (const slot of fn.subFunctions) writer.subFunction(slot);
  for (const variable of body?.variables ?? []) writer.variable(variable);
  for (const statement of body?.actions ?? []) writer.statement(statement);
  return { itemLine: library === undefined ? `${ELEMENT}<Item Type="FunctionDef" Id="${fn.id}"/>` : `${CHILD}<Item Type="FunctionDef" Library="${library}" Id="${fn.id}"/>`, elements: writer.elements };
}

/** The function's TriggerStrings: its name, grammar and hint, its parameters', block slots' and variables' names; a map's own (no library) keyed `<Type>/<Field>/<id>`. */
export function functionStrings(library: string | undefined, fn: LibraryFunction, body?: GuiBody): Record<string, string> {
  const out: Record<string, string> = {};
  const key = (type: string, field: "Name" | "Grammar" | "Hint", id: string): string => (library === undefined ? `${type}/${field}/${id}` : libraryStringKey(library, type, field, id));
  out[key("FunctionDef", "Name", fn.id)] = fn.name;
  if (fn.grammar !== undefined) out[key("FunctionDef", "Grammar", fn.id)] = fn.grammar;
  if (fn.hint !== undefined) out[key("FunctionDef", "Hint", fn.id)] = fn.hint;
  for (const parameter of fn.parameters) out[key("ParamDef", "Name", parameter.id)] = parameter.name;
  for (const slot of fn.subFunctions) out[key("SubFuncType", "Name", slot.id)] = slot.name;
  for (const variable of body?.variables ?? []) out[key("Variable", "Name", variable.id)] = variable.name;
  return out;
}

/** An item line, as Root or a category files it. */
export const itemLine = (library: string, ref: string): string => {
  const [kind, id] = ref.split(":") as [LibraryItemKind, string];
  return `${CHILD}<Item Type="${LIBRARY_ITEM_TYPES[kind]}" Library="${library}" Id="${id}"/>`;
};

/** One of the library's items other than a function, written: its elements, in the order the Editor reaches them, and its TriggerStrings. */
export type ItemXml = { readonly ref: string; readonly elements: readonly string[]; readonly strings: Readonly<Record<string, string>> };

/** An item's name string, when it has a name. */
const nameString = (library: string, type: string, item: { readonly id: string; readonly name?: string | undefined }): Record<string, string> => (item.name === undefined ? {} : { [libraryStringKey(library, type, "Name", item.id)]: item.name });

/** A category: its element, filing its items. */
export function categoryXml(library: string, category: LibraryCategory): ItemXml {
  const writer = new ElementWriter(library);
  writer.element("Category", category.id, [
    ...(category.identifier ? [`${CHILD}<Identifier>${escapeXml(category.identifier)}</Identifier>`] : []),
    ...(category.label ? [labelRefLine(category.label, library)] : []),
    ...category.items.map((ref) => itemLine(library, ref)),
  ]);
  return { ref: `category:${category.id}`, elements: writer.elements, strings: nameString(library, "Category", category) };
}

/** A preset type and its values. */
export function presetXml(library: string, preset: LibraryPreset): ItemXml {
  const writer = new ElementWriter(library);
  writer.element("Preset", preset.id, [
    ...(preset.custom ? [`${CHILD}<PresetCustom/>`] : []),
    `${CHILD}<BaseType Value="${escapeXml(preset.baseType)}"/>`,
    ...(preset.constants ? [`${CHILD}<PresetGenConstVar/>`] : []),
    ...(preset.extends ? [refLine(CHILD, "PresetExtends", "Preset", preset.extends, library)] : []),
    ...preset.values.map((value) => `${CHILD}<Item Type="PresetValue" Library="${library}" Id="${value.id}"/>`),
  ]);
  for (const value of preset.values) writer.element("PresetValue", value.id, [...(value.default ? [`${CHILD}<DefinesDefault/>`] : []), ...(value.value !== undefined ? [`${CHILD}<Value>${escapeXml(value.value)}</Value>`] : [])]);
  const strings: Record<string, string> = { ...nameString(library, "Preset", preset) };
  for (const value of preset.values) Object.assign(strings, nameString(library, "PresetValue", value));
  return { ref: `preset:${preset.id}`, elements: writer.elements, strings };
}

/** A structure and its members, each a variable with its initial value. */
export function structureXml(library: string, structure: LibraryStructure): ItemXml {
  const writer = new ElementWriter(library);
  writer.element("Structure", structure.id, structure.members.map((member) => refLine(CHILD, "Variable", "Variable", member.id, library)));
  for (const member of structure.members) writer.variable(member);
  const strings: Record<string, string> = { ...nameString(library, "Structure", structure) };
  for (const member of structure.members) strings[libraryStringKey(library, "Variable", "Name", member.id)] = member.name;
  return { ref: `structure:${structure.id}`, elements: writer.elements, strings };
}

/** A comment filed among the library's items. */
export function commentXml(library: string, comment: LibraryComment): ItemXml {
  const writer = new ElementWriter(library);
  writer.statement(comment);
  return { ref: `comment:${comment.id}`, elements: writer.elements, strings: {} };
}

/** Custom script filed among the library's items. */
export function customScriptXml(library: string, script: LibraryCustomScript): ItemXml {
  const writer = new ElementWriter(library);
  writer.element("CustomScript", script.id, [
    ...(script.identifier ? [`${CHILD}<Identifier>${escapeXml(script.identifier)}</Identifier>`] : []),
    ...(script.label ? [labelRefLine(script.label, library)] : []),
    ...scriptCodeLines(script.script),
    ...(script.initFunction ? [`${CHILD}<InitFunc>${escapeXml(script.initFunction)}</InitFunc>`] : []),
  ]);
  return { ref: `custom-script:${script.id}`, elements: writer.elements, strings: nameString(library, "CustomScript", script) };
}

/** A Triggers file of the library's Root (its item lines) and elements: what compile-mod splices in. */
export function libraryTriggersFile(library: string, rootLines: readonly string[], elements: readonly string[]): string {
  return [`<?xml version="1.0" encoding="utf-8"?>`, `<TriggerData>`, `    <Library Id="${library}">`, `        <Root>`, ...rootLines, `        </Root>`, ...elements, `    </Library>`, `</TriggerData>`, ``].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Reading: a Kept function, back to its interface and GUI body.

/** A function that can't be read as an interface and a GUI body without losing something: why. */
export class UnconvertibleFunctionError extends Error {
  readonly functionId: string;
  readonly reason: string;

  constructor(functionId: string, reason: string) {
    super(`The library element ${functionId} can't be converted: ${reason}`);
    this.functionId = functionId;
    this.reason = reason;
    this.name = "UnconvertibleFunctionError";
  }
}

const attr = xmlAttribute;

/** The id of the library a Triggers file holds (`<Library Id="…">`), or undefined. */
export const packageLibraryId = (xml: string): string | undefined => /<Library\s+Id="([^"]+)"/.exec(xml)?.[1];

/**
 * A library's elements by elementKey (type and Id), in file order. An older Editor numbers each
 * element type apart, so two of different types may share an Id (Swarm Story Util's E859A89C is a
 * FunctionCall and a FunctionDef): look one up by its type, with libraryElementOf.
 */
export type LibraryElements = ReadonlyMap<string, XmlNode>;

/** The elements of a Triggers file's library, by type and Id (LibraryElements). */
export function libraryElements(xml: string, library: string): Map<string, XmlNode> {
  const data = xmlTree(xml).find((node) => node.name === "TriggerData");
  const lib = data?.children.find((node) => node.name === "Library" && attr(node, "Id") === library);
  return new Map((lib?.children ?? []).filter((node) => node.name === "Element").map((node) => [elementKey(attr(node, "Type") ?? "", attr(node, "Id") ?? ""), node]));
}

/** The library's element of `type` with `id`. */
export const libraryElementOf = (elements: LibraryElements, type: string, id: string): XmlNode | undefined => elements.get(elementKey(type, id));

/** The library's elements with `id`, of any type, in file order: a new element's Id must be none of theirs, as the current Editor numbers every type from one count. */
export const libraryElementsWithId = (elements: LibraryElements, id: string): XmlNode[] => [...elements.values()].filter((node) => elementIdOf(node) === id);

/** The library's first element with `id` of a type other than `type`, where it has none of `type`: what a new element of `type` would take the Id of. */
export const otherTypeWithId = (elements: LibraryElements, type: string, id: string): XmlNode | undefined => (libraryElementOf(elements, type, id) ? undefined : libraryElementsWithId(elements, id)[0]);

/** The elementKey of an element's text, from its `<Element Type="…" Id="…">` line. */
export const elementTextKey = (element: string): string => {
  const [, type, id] = /<Element Type="([^"]+)" Id="([^"]+)"/.exec(element) ?? [];
  return elementKey(type ?? "", id ?? "");
};

/** An element's Id. */
export const elementIdOf = (node: XmlNode): string => attr(node, "Id") ?? "";

/** TriggerStrings.txt's keys and texts. */
export function stringTable(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0) out.set(line.slice(0, at), line.slice(at + 1));
  }
  return out;
}

/**
 * The text values' and text expressions' keys (`Param/Value/…`, `Param/Expression/…`) that hold
 * words in these strings files (each one's keys and texts, as stringTable reads them), with the
 * words of the first file to give them: an empty text's key holds nothing, or is absent
 * (textGalaxy), and a text expression's words name the slots it sets (textExpressionGalaxy).
 */
export function keysWithText(files: Iterable<ReadonlyMap<string, string> | Readonly<Record<string, string>>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const texts of files) {
    for (const [key, text] of texts instanceof Map ? [...texts] : Object.entries(texts)) {
      if ((key.startsWith("Param/Value/") || key.startsWith("Param/Expression/")) && text !== "" && !out.has(key)) out.set(key, text);
    }
  }
  return out;
}

/** One of the library's items other than a function, as the interface declares it. */
export type LibraryItem =
  | { readonly kind: "category"; readonly item: LibraryCategory }
  | { readonly kind: "preset"; readonly item: LibraryPreset }
  | { readonly kind: "structure"; readonly item: LibraryStructure }
  | { readonly kind: "comment"; readonly item: LibraryComment }
  | { readonly kind: "custom-script"; readonly item: LibraryCustomScript };

/** The item kind of an element type the interface reads other than a function (Category …), or undefined. */
export const structureKind = (type: string): LibraryStructureKind | undefined => LIBRARY_STRUCTURE_KINDS.find((kind) => LIBRARY_ITEM_TYPES[kind] === type);

/** Reads one item of `library` other than a function (a category, preset type, structure, comment or custom script), its element of `type` with `id`, as its writer writes it; refuses a form it doesn't write. */
export function readLibraryItem(xml: string | LibraryElements, strings: ReadonlyMap<string, string>, library: string, type: string, id: string): LibraryItem {
  return new Reader(typeof xml === "string" ? libraryElements(xml, library) : xml, strings, library, id).readItem(type);
}

/** Reads one function of `library` from its Triggers XML and strings, as functionXml writes it. */
export function readLibraryFunction(xml: string | LibraryElements, strings: ReadonlyMap<string, string>, library: string, id: string, { interfaceOnly = false } = {}): { readonly fn: LibraryFunction; readonly body?: GuiBody } {
  return new Reader(typeof xml === "string" ? libraryElements(xml, library) : xml, strings, library, id, interfaceOnly).read();
}

/**
 * The value a new call gives a library's parameter (its ParamDef's `<Default>`), as readLibraryFunction
 * reads one, or undefined where it has none. A form this file doesn't read is refused (UnconvertibleFunctionError).
 * How the game's library data gets each parameter's default (scripts/build-trigger-libraries.mjs).
 */
export function readLibraryParameterDefault(elements: LibraryElements, strings: ReadonlyMap<string, string>, library: string, paramDef: string): HeldValue | undefined {
  return new Reader(elements, strings, library, paramDef, true).parameterDefault(paramDef);
}

/** A map's own function's interface (mapElements), its own references bare: what a call to it needs. A form this file doesn't read is refused (UnconvertibleFunctionError). */
export function readMapFunction(elements: LibraryElements, strings: ReadonlyMap<string, string>, id: string): LibraryFunction {
  return new Reader(elements, strings, undefined, id, true).read().fn;
}

/** A map's own function (mapElements) whole, as functionXml writes it with no library: its interface and its GUI body. A form this file doesn't write is refused (UnconvertibleFunctionError). */
export function readMapFunctionWhole(elements: LibraryElements, strings: ReadonlyMap<string, string>, id: string): { readonly fn: LibraryFunction; readonly body?: GuiBody } {
  return new Reader(elements, strings, undefined, id).read();
}

/** The elements of a map's own trigger list, outside every library it embeds, by type and Id (LibraryElements). */
export function mapElements(xml: string): Map<string, XmlNode> {
  const data = xmlTree(xml).find((node) => node.name === "TriggerData");
  return new Map((data?.children ?? []).filter((node) => node.name === "Element").map((node) => [elementKey(attr(node, "Type") ?? "", attr(node, "Id") ?? ""), node]));
}

/** A map's trigger as a Mission Blueprint holds it (ADR-0026), less its `kind` and its text values' words. */
export type MapTrigger = Omit<BlueprintTrigger, "kind" | "strings">;

/** One of a map's own items other than a function (mapElements): a folder, preset type, record, comment or custom script, as a library's is read, its own references bare. A form this file doesn't write is refused (UnconvertibleFunctionError). */
export function readMapItem(elements: LibraryElements, strings: ReadonlyMap<string, string>, type: string, id: string): LibraryItem {
  return new Reader(elements, strings, undefined, id).readItem(type);
}

/** A map's preset type as a Mission Blueprint holds it (ADR-0026), less its `kind`: its values in order, a comment filed among them in its place. */
export type MapPreset = Omit<BlueprintPreset, "kind">;

/**
 * A map's own preset type (mapElements) with its values and the comments filed among them, as
 * blueprintPresetXml writes it, its name and each value's from TriggerStrings. A form this file
 * doesn't write (a value of its own, a default value, a preset type extending another) is refused
 * (UnconvertibleFunctionError), saying what it is.
 */
export function readMapPreset(elements: LibraryElements, strings: ReadonlyMap<string, string>, id: string): MapPreset {
  return new Reader(elements, strings, undefined, id).mapPreset();
}

/** A map's own global (mapElements) with its initial value, as ElementWriter.variable writes it with no library; a form this file doesn't write is refused (UnconvertibleFunctionError). */
export function readMapGlobal(elements: LibraryElements, strings: ReadonlyMap<string, string>, id: string): GuiVariable {
  return new Reader(elements, strings, undefined, id).variable(id);
}

/** A map's own comment filed in Root or a folder (mapElements), as ElementWriter.statement writes it with no library; refused (UnconvertibleFunctionError) where it holds what a comment among statements doesn't. */
export function readMapComment(elements: LibraryElements, strings: ReadonlyMap<string, string>, id: string): { readonly id: string; readonly comment: string } {
  const comment = new Reader(elements, strings, undefined, id).comment(id);
  if (!("comment" in comment) || comment.disabled || comment.sub !== undefined) throw new UnconvertibleFunctionError(id, "it is a disabled comment or one in a block slot, which no item of Root or a folder is");
  return { id: comment.id, comment: comment.comment };
}

/**
 * Reads one trigger of a map's own list (mapElements) with its names (TriggerStrings'
 * `<Type>/Name/<id>`), as blueprintTriggerXml writes it, its own references bare; a form this file
 * doesn't write is refused (UnconvertibleFunctionError), saying what it is.
 */
export function readMapTrigger(elements: LibraryElements, strings: ReadonlyMap<string, string>, id: string): MapTrigger {
  return new Reader(elements, strings, undefined, id).readTrigger();
}

class Reader {
  private readonly all: LibraryElements;
  private readonly strings: ReadonlyMap<string, string>;
  /** The library read, or undefined for a map's own list, whose own references name no Library. */
  private readonly library: string | undefined;
  private readonly functionId: string;
  /** Only what a call needs: the interface, not the body. */
  private readonly interfaceOnly: boolean;

  constructor(all: LibraryElements, strings: ReadonlyMap<string, string>, library: string | undefined, functionId: string, interfaceOnly = false) {
    this.all = all;
    this.strings = strings;
    this.library = library;
    this.functionId = functionId;
    this.interfaceOnly = interfaceOnly;
  }

  private fail(reason: string): never {
    throw new UnconvertibleFunctionError(this.functionId, reason);
  }

  private element(id: string, type: string): XmlNode {
    const node = libraryElementOf(this.all, type, id);
    if (!node) this.fail(`its ${type} ${id} isn't in ${this.library === undefined ? "the map's Triggers" : "the library"}`);
    return node;
  }

  /**
   * A reference: `own` when it must be the element's own (a call, a Param, a parameter), `variable`
   * for a variable, which in a map may also be a library's global or a library structure's member.
   */
  private ref(node: XmlNode, own: boolean | "variable" = false): string {
    const lib = attr(node, "Library");
    const id = attr(node, "Id");
    if (this.library === undefined) {
      // A map's own element is its Id alone; a library's, `<library>/<id>`.
      if (!id) this.fail(`a <${node.name}> with no Id`);
      if (own === true && lib) this.fail(`it names ${lib}'s ${attr(node, "Type")} ${id} where the map's own is expected`);
      return lib ? `${lib}/${id}` : id;
    }
    if (!lib || !id) this.fail(`a <${node.name}> with no Library or Id`);
    if (own) {
      if (lib !== this.library) this.fail(`it names ${lib}'s ${attr(node, "Type")} ${id} where its own is expected`);
      return id;
    }
    return `${lib}/${id}`;
  }

  private name(type: string, id: string, field: "Name" | "Grammar" | "Hint" = "Name"): string | undefined {
    return this.strings.get(this.library === undefined ? `${type}/${field}/${id}` : libraryStringKey(this.library, type, field, id));
  }

  private only(node: XmlNode, allowed: readonly string[]): void {
    const other = node.children.find((child) => !allowed.includes(child.name));
    if (other) this.fail(`its ${attr(node, "Type")} ${attr(node, "Id")} has a <${other.name}>, which a conversion doesn't write yet`);
  }

  /** A `<ParameterType>`, `<ReturnType>` or, with `variable`, a `<VariableType>`, which may also be constant or an array. */
  private typeOf(node: XmlNode | undefined, { variable = false } = {}): TypeSpec {
    if (!node) this.fail("a type with no <Type>");
    this.only(node, ["Type", "TypeElement", "GameType", "AssetType", "UserType", ...(variable ? ["Constant", "ArraySize"] : [])]);
    const value = (tag: string): string | undefined => {
      const child = node.children.find((c) => c.name === tag);
      return child && attr(child, "Value");
    };
    const element = node.children.find((c) => c.name === "TypeElement");
    const type = value("Type");
    if (!type) this.fail("a type with no <Type Value>");
    if (element && attr(element, "Type") !== typeElementKind(type)) this.fail(`a ${type} type naming a ${attr(element, "Type")}, which a conversion doesn't write yet`);
    const constant = node.children.some((c) => c.name === "Constant");
    const array = node.children.filter((c) => c.name === "ArraySize").map((bound, dim) => this.arrayBound(bound, dim));
    if (constant && array.length) this.fail(`a constant array of ${type}, which no Editor save has`);
    return {
      type,
      ...(element ? { element: this.ref(element) } : {}),
      ...optional("gameType", value("GameType")),
      ...optional("assetType", value("AssetType")),
      ...optional("userType", value("UserType")),
      ...(constant ? { constant: true } : {}),
      ...(array.length ? { array } : {}),
    };
  }

  /** The `dim`th dimension's `<ArraySize>`: a literal size, or a constant variable of a library naming it. */
  private arrayBound(node: XmlNode, dim: number): ArrayBound {
    const bound = arrayBoundOf((name) => attr(node, name), dim);
    if ("refused" in bound) this.fail(bound.refused);
    if ("variable" in bound && !bound.variable.includes("/") && this.library !== undefined) this.fail(`an array sized by the variable ${bound.variable}, with no Library`);
    return bound;
  }

  /** A Param's value, from its children past ParameterDef (and, in an expression's slot, its ExpressionCode). */
  private value(node: XmlNode, children = node.children.filter((child) => child.name !== "ParameterDef")): GuiValue {
    const tags = children.map((child) => child.name);
    const one = (tag: string): XmlNode | undefined => children.find((child) => child.name === tag);
    if (tags.length === 1 && tags[0] === "Preset" && attr(children[0]!, "Type") === "PresetValue") return { preset: this.ref(children[0]!) };
    if (tags.length === 1 && tags[0] === "FunctionCall") return { call: this.call(this.ref(children[0]!, true)) };
    if (isVariableForm(tags)) return this.variableValue(children);
    if (tags.at(-1) === "ScriptCode" && (tags.length === 1 || (tags.length === 2 && tags[0] === "CustomType"))) {
      const type = tags.length === 2 ? attr(children[0]!, "Type") : undefined;
      if (tags.length === 2 && !type) this.fail(`its Param ${attr(node, "Id")} has a CustomType with no Type`);
      return { customScript: dedent(rawText(children.at(-1)!)), ...optional("customType", type) };
    }
    if (tags.length === 1 && tags[0] === "Parameter" && attr(children[0]!, "Type") === "ParamDef") return { parameter: this.ref(children[0]!, true) };
    if (tags[0] === "ExpressionType") return { expression: this.expression(node, children) };
    const valueType = one("ValueType");
    // A set of bits: its preset type (which an older Editor leaves out) and the values set, in the Editor's order.
    const bits = children.filter((child) => child.name === "ValuePreset");
    if (valueType && attr(valueType, "Type") === "preset" && tags[0] === "ValueType" && (bits.length > 0 || tags[1] === "ValueElement") && tags.length === 1 + (tags[1] === "ValueElement" ? 1 : 0) + bits.length) {
      const element = tags[1] === "ValueElement" ? children[1]! : undefined;
      if (element && attr(element, "Type") !== "Preset") this.fail(`its Param ${attr(node, "Id")} has a ValueElement this conversion doesn't read`);
      if (bits.some((bit) => attr(bit, "Type") !== "PresetValue")) this.fail(`its Param ${attr(node, "Id")} has a ValuePreset that names no preset value`);
      const set = bits.map((bit) => this.ref(bit));
      return element ? { presetElement: this.ref(element), ...(set.length ? { bits: set } : {}) } : { bits: set };
    }
    if (valueType && tags.includes("ValueElement")) {
      const element = one("ValueElement")!;
      if (tags.length === 2 && attr(valueType, "Type") === "trigger" && attr(element, "Type") === "Trigger") return { trigger: this.ref(element, true) };
      this.fail(`its Param ${attr(node, "Id")} has a ValueElement this conversion doesn't read`);
    }
    if (valueType && tags.every((tag) => ["Value", "ValueType", "ValueId", "ValueTypeInfo", "ValueGameType", "ValueContext", "ValueParam"].includes(tag)) && tags.filter((tag) => tag !== "ValueParam").length === new Set(tags.filter((tag) => tag !== "ValueParam")).size) {
      const type = attr(valueType, "Type");
      if (!type) this.fail(`its Param ${attr(node, "Id")} has a ValueType with no Type`);
      // A text's words are in GameStrings, keyed by its Param (paramValueKey): the Param holds only its type.
      if (type === "text") return tags.length === 1 ? { type } : this.fail(`its Param ${attr(node, "Id")} holds text with ${tags.filter((tag) => tag !== "ValueType").join(", ")}, which a conversion doesn't write yet`);
      const value = one("Value");
      const valueId = one("ValueId");
      if (valueId && !/^\d+$/.test(attr(valueId, "Id") ?? "")) this.fail(`its Param ${attr(node, "Id")} has a ValueId that isn't a number`);
      const typeInfo = one("ValueTypeInfo");
      const gameType = one("ValueGameType");
      const context = one("ValueContext");
      const params = children.filter((child) => child.name === "ValueParam").map((child) => this.held(this.ref(child, true)));
      return {
        type,
        ...(value ? { value: value.text } : {}),
        ...optional("valueId", valueId && attr(valueId, "Id")),
        ...optional("typeInfo", typeInfo && attr(typeInfo, "Value")),
        ...optional("gameType", gameType && attr(gameType, "Type")),
        ...optional("context", context && attr(context, "Value")),
        ...(params.length ? { valueParams: params } : {}),
      };
    }
    this.fail(`its Param ${attr(node, "Id")} holds ${tags.length ? tags.join(", ") : "nothing"}, which a conversion doesn't write yet`);
  }

  /**
   * An expression's type, its text (a text expression's is in GameStrings) and its slots' values, in
   * the order the Editor saves them: ExpressionType, ExpressionText, then each ExpressionParam.
   */
  private expression(node: XmlNode, children: readonly XmlNode[]): GuiExpression {
    const type = attr(children[0]!, "Type");
    const problem = expressionFormProblem(children.map((child) => child.name), type);
    if (problem) this.fail(`its Param ${attr(node, "Id")} ${problem}`);
    const text = children[1]?.name === "ExpressionText" ? children[1] : undefined;
    return { type: type!, ...(text ? { text: text.text } : {}), slots: children.slice(text ? 2 : 1).map((child) => this.slot(this.ref(child, true))) };
  }

  /** The value an expression's slot is given: its Param holds the value, then its ExpressionCode. */
  private slot(id: string): ExpressionSlot {
    const node = this.element(id, "Param");
    const code = node.children.at(-1);
    const problem = expressionSlotProblem(node.children.map((child) => child.name), code && attr(code, "Value"));
    if (problem) this.fail(`its expression's slot ${id} ${problem}`);
    return { id, code: attr(code!, "Value")!, ...this.value(node, node.children.slice(0, -1)) } as ExpressionSlot;
  }

  /** A variable value from a Param's children (isVariableForm): the variable, its index values, its member. */
  private variableValue(children: readonly XmlNode[]): { variable: string; index?: HeldValue[]; member?: StructMember } {
    const member = children.find((child) => child.name === "StructMember");
    const index = children.filter((child) => child.name === "Array").map((child) => this.held(this.ref(child, true)));
    return { variable: this.ref(children[0]!, "variable"), ...(index.length ? { index } : {}), ...(member ? { member: this.member(this.ref(member, true)) } : {}) };
  }

  /** A structure member's Param: the member variable, its index values, and a member of it. */
  private member(id: string): StructMember {
    const node = this.element(id, "Param");
    const tags = node.children.map((child) => child.name);
    if (!isVariableForm(tags)) this.fail(`its structure member ${id} holds ${tags.join(", ") || "nothing"}, which a conversion doesn't write yet`);
    return { id, ...this.variableValue(node.children) };
  }

  private held(id: string): HeldValue {
    const node = this.element(id, "Param");
    if (node.children.some((child) => child.name === "ParameterDef")) this.fail(`its value ${id} names a parameter definition`);
    return { id, ...this.value(node) } as HeldValue;
  }

  private param(id: string): GuiParam {
    const node = this.element(id, "Param");
    const def = node.children.filter((child) => child.name === "ParameterDef");
    if (def.length !== 1) this.fail(`its Param ${id} names ${def.length} parameter definitions`);
    return { id, def: this.ref(def[0]!), ...this.value(node) } as GuiParam;
  }

  private statement(ref: XmlNode): GuiStatement {
    const id = this.ref(ref, true);
    return attr(ref, "Type") === "Comment" ? this.comment(id) : this.call(id);
  }

  comment(id: string): GuiStatement {
    const node = this.element(id, "Comment");
    this.only(node, ["Comment", "SubFunctionType", "Disabled"]);
    const text = node.children.find((child) => child.name === "Comment");
    const sub = node.children.find((child) => child.name === "SubFunctionType");
    return {
      id,
      ...(node.children.some((child) => child.name === "Disabled") ? { disabled: true } : {}),
      comment: text ? dedent(rawText(text)) : "",
      ...(sub ? { sub: this.ref(sub) } : {}),
    };
  }

  private call(id: string): GuiCall {
    const node = this.element(id, "FunctionCall");
    this.only(node, ["FunctionDef", "SubFunctionType", "Parameter", "FunctionCall", "Disabled", "ScriptCode"]);
    const def = node.children.filter((child) => child.name === "FunctionDef");
    const script = node.children.find((child) => child.name === "ScriptCode");
    if (def.length !== 1) this.fail(`its call ${id} names ${def.length} functions`);
    const sub = node.children.find((child) => child.name === "SubFunctionType");
    const params = node.children.filter((child) => child.name === "Parameter").map((child) => this.param(this.ref(child, true)));
    const body = node.children.filter((child) => child.name === "FunctionCall").map((child) => this.statement(child));
    return {
      id,
      function: this.ref(def[0]!),
      ...(sub ? { sub: this.ref(sub) } : {}),
      ...(node.children.some((child) => child.name === "Disabled") ? { disabled: true } : {}),
      ...(params.length ? { params } : {}),
      ...(body.length ? { body } : {}),
      ...(script ? { script: dedent(rawText(script)) } : {}),
    };
  }

  private parameter(id: string): LibraryParameter {
    const node = this.element(id, "ParamDef");
    this.only(node, ["Identifier", "ParameterType", "Default", "Preset", "ParamFlagPreload", "Limits"]);
    const name = this.name("ParamDef", id);
    if (name === undefined) this.fail(`its parameter ${id} has no name in TriggerStrings.txt`);
    const child = (tag: string): XmlNode | undefined => node.children.find((c) => c.name === tag);
    const def = child("Default");
    const presets = node.children.filter((c) => c.name === "Preset").map((c) => this.ref(c));
    const limits = child("Limits");
    return {
      id,
      name,
      ...optional("identifier", child("Identifier")?.text.trim()),
      type: this.typeOf(child("ParameterType")),
      ...(def ? { default: this.held(this.ref(def, true)) } : {}),
      ...(presets.length ? { preset: presets.length === 1 ? presets[0]! : presets } : {}),
      ...(child("ParamFlagPreload") ? { preload: true } : {}),
      ...optional("limits", limits && attr(limits, "Value")),
    };
  }

  /** A ParamDef's default alone, whatever else the ParamDef holds. */
  parameterDefault(id: string): HeldValue | undefined {
    const def = this.element(id, "ParamDef").children.find((c) => c.name === "Default");
    return def ? this.held(this.ref(def, true)) : undefined;
  }

  variable(id: string): GuiVariable {
    const node = this.element(id, "Variable");
    this.only(node, ["Identifier", "VariableType", "Value"]);
    const child = (tag: string): XmlNode | undefined => node.children.find((c) => c.name === tag);
    const value = child("Value");
    return {
      id,
      name: this.name("Variable", id) ?? this.fail(`its variable ${id} has no name in TriggerStrings.txt`),
      ...optional("identifier", child("Identifier")?.text.trim()),
      type: this.typeOf(child("VariableType"), { variable: true }),
      ...(value ? { value: this.held(this.ref(value, true)) } : {}),
    };
  }

  private subFunction(id: string): LibraryFunction["subFunctions"][number] {
    const node = this.element(id, "SubFuncType");
    this.only(node, ["Identifier", "Action", "Condition"]);
    const identifier = node.children.find((c) => c.name === "Identifier")?.text.trim();
    const holds: "action" | "condition" | undefined = node.children.some((c) => c.name === "Action") ? "action" : node.children.some((c) => c.name === "Condition") ? "condition" : undefined;
    return { id, name: this.name("SubFuncType", id) ?? this.fail(`its block slot ${id} has no name in TriggerStrings.txt`), ...optional("identifier", identifier), ...optional("holds", holds) };
  }

  /** An item's name in TriggerStrings, as `{ name }`, or nothing for one with none. */
  private named(type: string, id: string): { name?: string } {
    return optional("name", this.name(type, id));
  }

  /** The item lines a category or preset type holds, as `<kind>:<id>`, each the library's own. */
  private items(node: XmlNode): string[] {
    return node.children
      .filter((child) => child.name === "Item")
      .map((child) => {
        const kind = (Object.entries(LIBRARY_ITEM_TYPES) as [LibraryItemKind, string][]).find(([, editor]) => editor === attr(child, "Type"))?.[0];
        if (!kind) this.fail(`it files a ${attr(child, "Type")}, which a conversion doesn't write yet`);
        return `${kind}:${this.ref(child, true)}`;
      });
  }

  readItem(type: string): LibraryItem {
    const id = this.functionId;
    const kind = structureKind(type);
    const node = kind && libraryElementOf(this.all, type, id);
    if (!node || !kind) this.fail(`it isn't a category, preset type, structure, comment or custom script of the library`);
    const child = (tag: string): XmlNode | undefined => node.children.find((c) => c.name === tag);
    const text = (tag: string): string | undefined => child(tag)?.text.trim();
    switch (kind) {
      case "category": {
        this.only(node, ["Identifier", "Label", "Item"]);
        const label = child("Label");
        return { kind, item: { id, ...this.named("Category", id), ...optional("identifier", text("Identifier")), ...(label ? { label: this.ref(label) } : {}), items: this.items(node) } };
      }
      case "preset": {
        this.only(node, ["PresetCustom", "BaseType", "PresetGenConstVar", "PresetExtends", "Item"]);
        const base = child("BaseType");
        const type = base && attr(base, "Value");
        if (!type) this.fail(`its preset type ${id} has no BaseType`);
        const extended = child("PresetExtends");
        const values = node.children
          .filter((c) => c.name === "Item")
          .map((c) => {
            if (attr(c, "Type") !== "PresetValue") this.fail(`its preset type ${id} holds a ${attr(c, "Type")}`);
            const valueId = this.ref(c, true);
            const value = this.element(valueId, "PresetValue");
            this.only(value, ["DefinesDefault", "Value"]);
            const held = value.children.find((v) => v.name === "Value");
            return { id: valueId, ...this.named("PresetValue", valueId), ...(held ? { value: held.text } : {}), ...(value.children.some((v) => v.name === "DefinesDefault") ? { default: true } : {}) };
          });
        return {
          kind,
          item: { id, ...this.named("Preset", id), baseType: type, ...(child("PresetCustom") ? { custom: true } : {}), ...(child("PresetGenConstVar") ? { constants: true } : {}), ...(extended ? { extends: this.ref(extended) } : {}), values },
        };
      }
      case "structure": {
        this.only(node, ["Variable"]);
        return { kind, item: { id, ...this.named("Structure", id), members: node.children.map((c) => this.variable(this.ref(c, true))) } };
      }
      case "comment": {
        this.only(node, ["Comment"]);
        const comment = child("Comment");
        return { kind, item: { id, comment: comment ? dedent(rawText(comment)) : "" } };
      }
      case "custom-script": {
        this.only(node, ["Identifier", "Label", "ScriptCode", "InitFunc"]);
        const label = child("Label");
        const script = child("ScriptCode");
        if (!script) this.fail(`its custom script ${id} has no ScriptCode`);
        return {
          kind,
          item: { id, ...this.named("CustomScript", id), ...optional("identifier", text("Identifier")), ...(label ? { label: this.ref(label) } : {}), script: dedent(rawText(script)), ...optional("initFunction", text("InitFunc")) },
        };
      }
    }
  }

  /** A map's preset type, as readMapPreset reads it. */
  mapPreset(): MapPreset {
    const id = this.functionId;
    const node = this.element(id, "Preset");
    this.only(node, ["PresetInteger", "BaseType", "PresetGenConstVar", "Item"]);
    const name = this.name("Preset", id);
    if (name === undefined) this.fail("it has no name in TriggerStrings.txt");
    const base = node.children.find((c) => c.name === "BaseType");
    const baseType = base && attr(base, "Value");
    if (!baseType) this.fail(`its preset type ${id} has no BaseType`);
    const values = node.children
      .filter((c) => c.name === "Item")
      .map((c): MapPreset["values"][number] => {
        const itemId = this.ref(c, true);
        if (attr(c, "Type") === "Comment") {
          const comment = this.comment(itemId);
          if (!("comment" in comment) || comment.disabled || comment.sub !== undefined) this.fail(`its comment ${itemId} is disabled or in a block slot, which no preset type's is`);
          return { id: itemId, comment: comment.comment };
        }
        if (attr(c, "Type") !== "PresetValue") this.fail(`its preset type ${id} holds a ${attr(c, "Type")}`);
        this.only(this.element(itemId, "PresetValue"), []);
        const valueName = this.name("PresetValue", itemId);
        if (valueName === undefined) this.fail(`its value ${itemId} has no name in TriggerStrings.txt`);
        return { id: itemId, name: valueName };
      });
    const has = (tag: string): boolean => node.children.some((c) => c.name === tag);
    return { id, name, baseType, ...(has("PresetInteger") ? { integer: true } : {}), ...(has("PresetGenConstVar") ? { constants: true } : {}), values };
  }

  /** A map's trigger: its flags, local variables, events, conditions and actions, as blueprintTriggerXml writes them. */
  readTrigger(): MapTrigger {
    const id = this.functionId;
    const node = this.element(id, "Trigger");
    this.only(node, ["Identifier", "Label", "Section", "Disabled", "InitOff", "Variable", "Event", "Condition", "Action"]);
    const child = (tag: string): XmlNode | undefined => node.children.find((c) => c.name === tag);
    const name = this.name("Trigger", id);
    if (name === undefined) this.fail("it has no name in TriggerStrings.txt");
    const label = child("Label");
    const sectionNode = child("Section");
    const section = sectionNode && attr(sectionNode, "Value");
    if (sectionNode && (section === undefined || sectionNode.children.length)) this.fail("its <Section> isn't a Value alone");
    const statements = (tag: string): GuiStatement[] => node.children.filter((c) => c.name === tag).map((c) => this.statement(c));
    return {
      id,
      name,
      ...optional("identifier", child("Identifier")?.text.trim()),
      ...(label ? { label: this.ref(label) } : {}),
      ...optional("section", section),
      ...(child("Disabled") ? { disabled: true } : {}),
      ...(child("InitOff") ? { initiallyOff: true } : {}),
      variables: node.children.filter((c) => c.name === "Variable").map((c) => this.variable(this.ref(c, true))),
      events: statements("Event"),
      conditions: statements("Condition"),
      actions: statements("Action"),
    };
  }

  read(): { fn: LibraryFunction; body?: GuiBody } {
    const id = this.functionId;
    const node = this.element(id, "FunctionDef");
    const kinds = (Object.entries(KIND_FLAGS) as [LibraryFunction["kind"], string][]).filter(([, tag]) => node.children.some((child) => child.name === tag));
    if (kinds.length !== 1) this.fail(`it has ${kinds.length} kind flags (FlagAction, FlagCall, FlagCondition, FlagEvent)`);
    const kindTag = KIND_FLAGS[kinds[0]![0]];
    const flagNames = new Map<string, string>([["FlagNative", "native"], ["FlagCreateThread", "createThread"], ["FlagHidden", "hidden"], ["FlagInline", "inline"], ["FlagNoScriptPrefix", "noScriptPrefix"], ["FlagSubFunctions", "subFunctions"], ["FlagAllowBreak", "allowBreak"], ["FlagOperator", "operator"], ["FlagRestricted", "restricted"]]);
    const allowed = ["Identifier", "Label", "Section", "Disabled", "Deprecated", "Internal", "ReturnType", "Parameter", "SubFunctionType", "Variable", "FunctionCall", "ScriptCode", kindTag, ...flagNames.keys()];
    this.only(node, allowed);
    const child = (tag: string): XmlNode | undefined => node.children.find((c) => c.name === tag);
    const name = this.name("FunctionDef", id);
    if (name === undefined) this.fail("it has no name in TriggerStrings.txt");
    const flags = node.children.flatMap((c) => (flagNames.has(c.name) ? [flagNames.get(c.name)!] : [])) as LibraryFunction["flags"];
    const label = child("Label");
    const sectionNode = child("Section");
    const section = sectionNode && attr(sectionNode, "Value");
    if (sectionNode && (!section || sectionNode.children.length)) this.fail("its <Section> isn't a Value alone");
    const returns = child("ReturnType");
    const script = child("ScriptCode");
    const ownSubs = node.children.filter((c) => c.name === "SubFunctionType");
    for (const sub of ownSubs) if (attr(sub, "Library") !== this.library) this.fail(`its block slot ${attr(sub, "Id")} is ${attr(sub, "Library")}'s`);
    const variables = this.interfaceOnly ? [] : node.children.filter((c) => c.name === "Variable").map((c) => this.variable(this.ref(c, true)));
    const actions = this.interfaceOnly ? [] : node.children.filter((c) => c.name === "FunctionCall").map((c) => this.statement(c));
    const fn: LibraryFunction = {
      id,
      name,
      ...optional("identifier", child("Identifier")?.text.trim()),
      kind: kinds[0]![0],
      flags,
      ...optional("grammar", this.name("FunctionDef", id, "Grammar")),
      ...optional("hint", this.name("FunctionDef", id, "Hint")),
      ...(label ? { label: this.ref(label) } : {}),
      ...optional("section", section),
      ...(child("Disabled") ? { disabled: true } : {}),
      ...(child("Deprecated") ? { deprecated: true } : {}),
      ...(child("Internal") ? { internal: true } : {}),
      ...(returns ? { returns: this.typeOf(returns) } : {}),
      parameters: node.children.filter((c) => c.name === "Parameter").map((c) => this.parameter(this.ref(c, true))),
      subFunctions: ownSubs.map((sub) => this.subFunction(this.ref(sub, true))),
      ...(script ? { script: dedent(rawText(script)) } : {}),
    };
    const native = flags.includes("native");
    if (native && (variables.length || actions.length)) this.fail("it's native, yet has GUI actions");
    return native || this.interfaceOnly || (script && !variables.length && !actions.length) ? { fn } : { fn, body: { variables, actions } };
  }
}

/**
 * The `dim`th dimension of an array's size, from its `<ArraySize>`'s attributes (`attribute`): a
 * literal (`Value`), or a constant variable (`Type="Variable"`), as `<library>/<id>` or, in a map's
 * Triggers, which names its own elements with no Library, its bare id. Anything else is refused, as
 * is a size of 0: no Editor save has one, so what its Galaxy is isn't known.
 */
export function arrayBoundOf(attribute: (name: string) => string | undefined, dim: number): ArrayBound | { readonly refused: string } {
  const [given, size, type, library, id] = ["Dim", "Value", "Type", "Library", "Id"].map(attribute);
  if (given !== String(dim)) return { refused: `an array whose dimension ${dim} is given as Dim="${given ?? ""}"` };
  if (size !== undefined && type === undefined) return /^[1-9][0-9]*$/.test(size) ? { size: Number(size) } : { refused: `an array of size ${size}, which no Editor save has` };
  if (type === "Variable" && size === undefined && id) return { variable: library ? `${library}/${id}` : id };
  return { refused: "an <ArraySize> of neither a size nor a variable" };
}

/** A variable's tags in a Param, as the Editor writes them: the Variable, at most one StructMember, then an Array per index. */
const isVariableForm = (tags: readonly string[]): boolean => /^Variable(,StructMember)?(,Array)*$/.test(tags.join(","));

/** A variable value, or a structure member: what its Param names and owns. */
type VariableValue = { readonly variable: string; readonly index?: readonly HeldValue[] | undefined; readonly member?: StructMember | undefined };

const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } => (value === undefined ? {} : ({ [key]: value } as { [P in K]?: V }));

/** An element's text, decoded, with its line structure (xmlTree drops only whitespace-only text). */
const rawText = (node: XmlNode): string => node.text;

/** Text without the XML's indentation: blank first and last lines dropped, each line dedented by the least indent, the rest of it as it is (a trailing space included). */
export function dedent(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && lines[0]!.trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
  const indents = lines.filter((line) => line.trim() !== "").map((line) => line.length - line.trimStart().length);
  const indent = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => (line.trim() === "" ? "" : line.slice(indent))).join("\n");
}
