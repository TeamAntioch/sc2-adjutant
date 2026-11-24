// A trigger as text in the Editor's terms, one line to a call (#46): its events, conditions and
// actions with each function by the name the Editor shows it and every argument written out by
// parameter name, a block's statements nested under its slot's name. Written from the authoring
// outline (triggers/authoring-outline.ts), which already names everything as the Editor does.
//
// The Editor's own line for a call is its function's grammar ("Set Variable (~Variable~ = ~Value~)"),
// but the game's library data (data/trigger-libraries.json) holds no grammars, only names, so this is
// the plain form: `Set Variable (Variable = Mode, Value = true)`. It exists to be compared line by
// line (outline-diff.ts); it is not read back.

import type { AuthoringCall, AuthoringStatement, AuthoringTrigger, AuthoringValue, AuthoringVariable } from "../triggers/author-trigger.js";

const INDENT = "  ";

const isCall = (statement: AuthoringStatement): statement is AuthoringCall => "function" in statement;

/** A value as the Editor shows it: a call as `Name (Parameter = value, ...)`, a variable by its name, a text in quotes. */
export function valueText(value: AuthoringValue | readonly AuthoringValue[]): string {
  if (Array.isArray(value)) return `[${value.map((each) => valueText(each)).join(", ")}]`;
  const single = value as AuthoringValue;
  if (typeof single !== "object") return String(single);
  if ("function" in single) return callText(single);
  if ("preset" in single) return single.preset;
  if ("bits" in single) return `{${single.bits.join(", ")}}`;
  if ("variable" in single) {
    const indexes = (single.index ?? []).map((each) => `[${valueText(each)}]`).join("");
    const members: string[] = [];
    for (let member = single.member; member; member = member.member) members.push(`.${member.variable}${(member.index ?? []).map((each) => `[${valueText(each)}]`).join("")}`);
    return `${single.variable}${indexes}${members.join("")}`;
  }
  if ("trigger" in single) return single.trigger;
  if ("text" in single) return `"${single.text}"`;
  if ("expression" in single) return single.expression.replace(/~(\w+)~/g, (whole, code: string) => (single.slots?.[code] !== undefined ? `(${valueText(single.slots[code]!)})` : whole));
  if ("customScript" in single) return `custom script ${single.customScript}`;
  return single.value ?? single.type;
}

/** A call as one line: its function and each parameter set, by name. */
function callText(call: AuthoringCall): string {
  const params = Object.entries(call.params ?? {}).map(([name, value]) => `${name} = ${value === null ? "(unset)" : valueText(value)}`);
  return `${call.function}${params.length > 0 ? ` (${params.join(", ")})` : ""}${call.disabled ? " (disabled)" : ""}`;
}

/** The statements as lines at `indent`: a call's line, then each of its blocks' slot names with their statements under it. */
function statementLines(statements: readonly AuthoringStatement[], indent: string): string[] {
  return statements.flatMap((statement) => {
    if (!isCall(statement)) {
      const text = "comment" in statement ? `// ${statement.comment}` : `Custom Script: ${statement.customScript}`;
      return [`${indent}${text}${statement.disabled ? " (disabled)" : ""}`];
    }
    return [`${indent}${callText(statement)}`, ...Object.entries(statement.blocks ?? {}).flatMap(([slot, body]) => [`${indent}${INDENT}${slot}`, ...statementLines(body, `${indent}${INDENT}${INDENT}`)])];
  });
}

const variableText = (variable: AuthoringVariable): string => {
  const type = typeof variable.type === "string" ? variable.type : variable.type.type;
  return `${variable.name} (${type}${variable.array ? `, array ${variable.array.join("x")}` : ""}${variable.constant ? ", constant" : ""})${variable.value !== undefined ? ` = ${valueText(variable.value)}` : ""}`;
};

/** The trigger as text in the Editor's terms, as above. */
export function editorForm(trigger: AuthoringTrigger): string {
  const flags = [trigger.disabled ? "disabled" : undefined, trigger.initiallyOff ? "initially off" : undefined].filter((flag): flag is string => flag !== undefined);
  const part = (heading: string, lines: readonly string[]): string[] => (lines.length > 0 ? [heading, ...lines] : []);
  return [
    `Trigger ${trigger.name}${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`,
    ...part("Local Variables", (trigger.variables ?? []).map((variable) => `${INDENT}${variableText(variable)}`)),
    ...part("Events", statementLines(trigger.events ?? [], INDENT)),
    ...part("Conditions", statementLines(trigger.conditions ?? [], INDENT)),
    ...part("Actions", statementLines(trigger.actions ?? [], INDENT)),
  ].join("\n");
}
