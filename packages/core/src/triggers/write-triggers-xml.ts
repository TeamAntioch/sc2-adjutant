import type { SubFunctionDef } from "./trigger-catalog.js";
import { triggerCalls, triggerTree, type ParamValue, type TriggerCall, type TriggerDocument, type TriggerNode, type TriggerParam, type TriggerVariable } from "./trigger-model.js";

const INDENT = "    ";

export function formatFixed(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

/** `text` as XML element text: `&`, `<` and `>` escaped. */
const xmlText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function paramBody(param: TriggerParam, paramDefLine: string | undefined): string[] {
  const lines = paramDefLine ? [paramDefLine] : [];
  const value: ParamValue = param.value;
  switch (value.kind) {
    case "int":
      lines.push(`<Value>${value.value}</Value>`, `<ValueType Type="int"/>`);
      break;
    case "fixed":
      lines.push(`<Value>${formatFixed(value.value)}</Value>`, `<ValueType Type="fixed"/>`);
      break;
    case "bool":
      lines.push(`<Value>${value.value}</Value>`, `<ValueType Type="bool"/>`);
      break;
    case "string":
      lines.push(...(value.value === "" ? [] : [`<Value>${xmlText(value.value)}</Value>`]), `<ValueType Type="string"/>`);
      break;
    case "convline":
    case "water":
    case "actormsg":
      lines.push(`<Value>${xmlText(value.value)}</Value>`, `<ValueType Type="${value.kind}"/>`);
      break;
    case "modelanim":
      lines.push(`<Value>&quot;${xmlText(value.value).replace(/"/g, "&quot;")}&quot;</Value>`, `<ValueType Type="modelanim"/>`);
      break;
    case "preset":
      if (value.preset.form === "element") {
        lines.push(
          `<ValueType Type="preset"/>`,
          `<ValueElement Type="Preset" Library="${value.preset.library}" Id="${value.preset.id}"/>`,
        );
      } else {
        lines.push(`<Preset Type="PresetValue" Library="${value.preset.library}" Id="${value.preset.id}"/>`);
      }
      break;
    case "text":
      lines.push(`<ValueType Type="text"/>`);
      break;
    case "gamelink":
      lines.push(
        `<Value>${xmlText(value.value)}</Value>`,
        `<ValueType Type="gamelink"/>`,
        `<ValueGameType Type="${value.gameType}"/>`,
      );
      break;
    case "soundlink":
      lines.push(`<Value>${xmlText(value.sound)}</Value>`, `<ValueType Type="soundlink"/>`);
      break;
    case "point":
    case "unit":
    case "camerainfo":
      lines.push(`<ValueType Type="${value.kind}"/>`, `<ValueId Id="${value.objectId}"/>`);
      break;
    case "color":
      lines.push(`<Value>${xmlText(value.value)}</Value>`, `<ValueType Type="color"/>`);
      break;
    case "filepath":
      // Type info 5 is an image, as the Editor wrote it for Create Tip's icon; 1 a cutscene, as one Editor-saved map wrote one.
      lines.push(`<Value>${xmlText(value.value)}</Value>`, `<ValueType Type="filepath"/>`, `<ValueTypeInfo Value="${value.asset === "cutscene" ? 1 : 5}"/>`);
      break;
    case "unitfilter":
      lines.push(`<Value>${xmlText(unitFilterValue(value.require, value.exclude))}</Value>`, `<ValueType Type="unitfilter"/>`);
      break;
    case "region":
      lines.push(`<ValueType Type="region"/>`, `<ValueId Id="${value.regionId}"/>`);
      break;
    case "abilcmd":
      lines.push(
        `<Value>${xmlText(value.ability)}</Value>`,
        `<ValueType Type="abilcmd"/>`,
        `<ValueTypeInfo Value="${value.target === "none" ? 0 : value.target === "unit" ? 1 : 2}"/>`,
      );
      break;
    case "variable":
      lines.push(`<Variable Type="Variable" Id="${value.variable.id}"/>`);
      break;
    case "trigger":
      lines.push(`<ValueType Type="trigger"/>`, `<ValueElement Type="Trigger" Id="${value.trigger.id}"/>`);
      break;
    case "call":
      lines.push(`<FunctionCall Type="FunctionCall" Id="${value.call.id}"/>`);
      break;
  }
  return lines;
}

/** The Editor's unit filter text, "<required>;<excluded>", "-" for an empty side ("-;Missile,Dead,Hidden"). */
export function unitFilterValue(require: readonly string[], exclude: readonly string[]): string {
  return `${require.length > 0 ? require.join(",") : "-"};${exclude.length > 0 ? exclude.join(",") : "-"}`;
}

/** NativeLib's preset types that variable types are: Timer Window, and Cutscene (as one Editor-saved map wrote one). */
const PRESET_TYPES: Partial<Record<TriggerVariable["type"], string>> = { timerwindow: "00000100", cutscene: "DF249F5E" };

/** A variable's type: plain, or a preset type such as Timer Window. */
function variableTypeLines(variable: TriggerVariable): string[] {
  const preset = PRESET_TYPES[variable.type];
  if (preset) {
    return [`${INDENT}<Type Value="preset"/>`, `${INDENT}<TypeElement Type="Preset" Library="Ntve" Id="${preset}"/>`];
  }
  return [`${INDENT}<Type Value="${variable.type}"/>`];
}

/**
 * Who references each call element, by call Id. The Editor gives a call one parent: where two
 * parameters point at one call it writes an empty argument (`f(a, , b)`) and the save won't compile,
 * so a write that references a call twice is refused, naming the Id and both parents.
 */
type CallParents = Map<string, string>;

function claimCall(parents: CallParents, id: string, parent: string): void {
  const first = parents.get(id);
  if (first !== undefined) {
    throw new Error(`The call ${id} is referenced from two places, ${first} and ${parent}: the Editor gives a call one parent, and writes an empty argument where two share one`);
  }
  parents.set(id, parent);
}

function element(type: string, id: string, body: readonly string[]): string[] {
  return [
    `${INDENT}<Element Type="${type}" Id="${id}">`,
    ...body.map((line) => `${INDENT}${INDENT}${line}`),
    `${INDENT}</Element>`,
  ];
}

/**
 * Emits a call followed, depth-first, by its parameters and any nested calls, then the calls in
 * its blocks, each marked with its sub-function (as an Editor-saved map's If Then Else and Pick Each are).
 */
function callElements(call: TriggerCall, parents: CallParents, subFunction?: SubFunctionDef): string[] {
  const paramNames = Object.keys(call.def.params);
  const missing = paramNames.filter((name) => !call.params[name]);
  if (missing.length > 0) {
    throw new Error(`Call ${call.id} (${call.def.library}/${call.def.id}) is missing params: ${missing.join(", ")}`);
  }

  const blocks = call.blocks ?? [];
  for (const block of blocks) for (const child of block.calls) claimCall(parents, child.id, `a block of the call ${call.id}`);
  const lines = element("FunctionCall", call.id, [
    `<FunctionDef Type="FunctionDef" Library="${call.def.library}" Id="${call.def.id}"/>`,
    ...(subFunction ? [`<SubFunctionType Type="SubFuncType" Library="${subFunction.library}" Id="${subFunction.id}"/>`] : []),
    ...paramNames.map((name) => `<Parameter Type="Param" Id="${call.params[name]!.id}"/>`),
    ...blocks.flatMap((block) => block.calls.map((child) => `<FunctionCall Type="FunctionCall" Id="${child.id}"/>`)),
  ]);

  for (const name of paramNames) {
    const param = call.params[name]!;
    const paramDef = call.def.params[name]!;
    lines.push(
      ...element(
        "Param",
        param.id,
        paramBody(param, `<ParameterDef Type="ParamDef" Library="${call.def.library}" Id="${paramDef.id}"/>`),
      ),
    );
    if (param.value.kind === "call") {
      claimCall(parents, param.value.call.id, `the parameter ${param.id} of the call ${call.id}`);
      lines.push(...callElements(param.value.call, parents));
    }
  }
  for (const block of blocks) {
    for (const child of block.calls) lines.push(...callElements(child, parents, block.type));
  }
  return lines;
}

/** An element's icon, a Label of `library` by Id, as the Editor writes it on a Category (and a mod library's function or custom script). */
export const labelLine = (library: string, id: string): string => `<Label Type="Label" Library="${library}" Id="${id}"/>`;

/** The line filing an item of a map's own triggers in Root or a folder. */
function itemLine(item: TriggerNode): string {
  const id = item.type === "Variable" ? item.variable.id : item.type === "Trigger" ? item.trigger.id : item.folder.id;
  return `<Item Type="${item.type}" Id="${id}"/>`;
}

/** Writes a Triggers component the way Editor 5.0.17 does (CRLF, no trailing newline). */
export function writeTriggersXml(doc: TriggerDocument): string {
  const tree = triggerTree(doc);
  const parents: CallParents = new Map();
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', "<TriggerData>", `${INDENT}<Root>`];
  for (const item of tree) lines.push(`${INDENT}${INDENT}${itemLine(item)}`);
  lines.push(`${INDENT}</Root>`);

  // Each element, depth first: a folder's, then those of what it files, as the Editor writes them.
  const visit = (item: TriggerNode): void => {
    if (item.type === "Category") {
      const { folder } = item;
      lines.push(...element("Category", folder.id, [...(folder.label ? [labelLine("Ntve", folder.label)] : []), ...item.items.map(itemLine)]));
      item.items.forEach(visit);
      return;
    }
    if (item.type === "Variable") {
      const { variable } = item;
      lines.push(
        ...element("Variable", variable.id, [
          "<VariableType>",
          ...variableTypeLines(variable),
          "</VariableType>",
          `<Value Type="Param" Id="${variable.initial.id}"/>`,
        ]),
        ...element("Param", variable.initial.id, paramBody(variable.initial, undefined)),
      );
      if (variable.initial.value.kind === "call") {
        claimCall(parents, variable.initial.value.call.id, `the initial value ${variable.initial.id} of the variable ${variable.id}`);
        lines.push(...callElements(variable.initial.value.call, parents));
      }
      return;
    }
    const { trigger } = item;
    for (const call of triggerCalls(trigger)) claimCall(parents, call.id, `the trigger ${trigger.id}`);
    lines.push(
      ...element("Trigger", trigger.id, [
        // First, as in thanson01's Editor-saved Triggers.
        ...(trigger.initiallyOff ? ["<InitOff/>"] : []),
        ...trigger.events.map((call) => `<Event Type="FunctionCall" Id="${call.id}"/>`),
        ...(trigger.conditions ?? []).map((call) => `<Condition Type="FunctionCall" Id="${call.id}"/>`),
        ...trigger.actions.map((call) => `<Action Type="FunctionCall" Id="${call.id}"/>`),
      ]),
    );
    for (const call of triggerCalls(trigger)) {
      lines.push(...callElements(call, parents));
    }
  };
  tree.forEach(visit);

  lines.push("</TriggerData>");
  return lines.join("\r\n");
}
