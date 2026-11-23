// A Blueprint trigger (ADR-0026) read back into the authoring tool's input (#1061): the tree of calls
// in the Editor's terms that write_blueprint_trigger takes (author-trigger.ts's AuthoringTrigger), so
// a converted or authored trigger can be read, edited and written again (#1034). Each function is
// named as the Editor shows it where the name settles on it, each parameter by its name, each block's
// statements by their slot's name, each local by its name. Every other part (a preset value, a set
// of bits, a global, a member, a trigger, a local's type, a literal) is in the plainest form the tool
// writes the same where it stands, which the tool itself tells (author-trigger.ts's `plainer`): by
// its name where that settles on it, else by its reference. What the input can't express is listed
// by place (`unwritable`), in the Editor's terms.
//
// `authoringRoundTrip` checks a trigger against the tool: it outlines it, writes the outline back
// through authorTrigger with the trigger as the one rewritten (so its Ids are kept where its calls
// are alike), and compares what is written with the trigger. The coverage report runs it over every
// converted trigger (scripts/trigger-coverage.mjs).

import type { BlueprintTrigger } from "../domain/blueprint-trigger.js";
import type { GuiCall, GuiStatement, GuiValue, HeldValue, StructMember } from "../domain/library-interface.js";
import { resolveFunction } from "../mods/function-search.js";
import type { GameLibrary } from "../mods/library-galaxy.js";
import {
  type AuthoringCall,
  AuthoringError,
  type AuthoringMember,
  type AuthoringStatement,
  type AuthoringTrigger,
  type AuthoringValue,
  type AuthoringVariable,
  authorTrigger,
  CUSTOM_SCRIPT,
  ELEMENT_REF,
  folded,
  GAME_STRINGS,
  type MapReach,
  templateRepeats,
} from "./author-trigger.js";

/** What an outline names in: the libraries in reach and the map's own elements. */
export type OutlineContext = {
  readonly libraries: Readonly<Record<string, GameLibrary>>;
  readonly map: MapReach;
};

/** A trigger in the tool's input, and each place holding what the input can't express. */
export type AuthoringOutline = {
  readonly trigger: AuthoringTrigger;
  readonly unwritable: readonly string[];
};

/** A callee as an outline needs it: its name, its parameters' names by reference and its slots' names by reference. */
type Callee = {
  readonly name: string;
  readonly params: ReadonlyMap<string, string>;
  readonly slots: ReadonlyMap<string, string>;
  readonly paramCount: number;
  readonly repeats: ReadonlySet<string>;
};

/** `trigger` as the authoring tool's input, in the Editor's terms, with what it can't express listed. */
export function outlineForAuthoring(trigger: BlueprintTrigger, context: OutlineContext): AuthoringOutline {
  return new Outliner(trigger, context).outline();
}

class Outliner {
  private readonly unwritable: string[] = [];
  private readonly words: Readonly<Record<string, string>>;
  private readonly locals: ReadonlyMap<string, string>;

  constructor(
    private readonly trigger: BlueprintTrigger,
    private readonly context: OutlineContext,
  ) {
    this.words = trigger.strings?.[GAME_STRINGS] ?? {};
    const names = trigger.variables.map((variable) => variable.name);
    // A local is named by its name where no other local has it, else by its Id.
    this.locals = new Map(trigger.variables.map((variable) => [variable.id, names.filter((name) => name === variable.name).length === 1 ? variable.name : variable.id]));
  }

  private cant(where: string, what: string): void {
    this.unwritable.push(`${where}: ${what}`);
  }

  outline(): AuthoringOutline {
    const { trigger } = this;
    const variables: AuthoringVariable[] = trigger.variables.map((variable, index) => {
      const where = `local ${index + 1} ("${variable.name}")`;
      const { array, constant, ...type } = variable.type;
      const sizes = (array ?? []).map((bound) => ("size" in bound && typeof bound.size === "number" ? bound.size : undefined));
      if (sizes.some((size) => size === undefined)) this.cant(where, "an array sized by a constant");
      if (this.locals.get(variable.id) !== variable.name) this.cant(where, "another local has its name");
      return {
        name: variable.name,
        type: Object.keys(type).length === 1 ? type.type : (type as Exclude<AuthoringVariable["type"], string>),
        ...(variable.value ? { value: this.value(variable.value, where) } : {}),
        ...(array
          ? {
              array: sizes.filter((size): size is number => size !== undefined),
            }
          : {}),
        ...(constant ? { constant: true } : {}),
        ...(variable.identifier !== undefined ? { identifier: variable.identifier } : {}),
      };
    });
    const list = (statements: readonly GuiStatement[], kind: string): AuthoringStatement[] =>
      statements.map((statement, index) => {
        if (statement.sub !== undefined) this.cant(`${kind} ${index + 1}`, "a statement in a block slot outside a block");
        return this.statement(statement, `${kind} ${index + 1}`);
      });
    const events = list(trigger.events, "event").flatMap((statement) => ("customScript" in statement ? (this.cant("events", "custom script among the events"), []) : [statement]));
    const out: AuthoringTrigger = {
      name: trigger.name,
      ...(trigger.identifier !== undefined ? { identifier: trigger.identifier } : {}),
      ...(trigger.label !== undefined ? { label: trigger.label } : {}),
      ...(trigger.section !== undefined ? { section: trigger.section } : {}),
      ...(trigger.disabled ? { disabled: true } : {}),
      ...(trigger.initiallyOff ? { initiallyOff: true } : {}),
      ...(variables.length ? { variables } : {}),
      ...(events.length ? { events } : {}),
      ...(trigger.conditions.length ? { conditions: list(trigger.conditions, "condition") } : {}),
      ...(trigger.actions.length ? { actions: list(trigger.actions, "action") } : {}),
    };
    return { trigger: this.plainest(out), unwritable: this.unwritable };
  }

  /**
   * `out` with each value, member and local the tool would write the same in a plainer form given
   * in it (author-trigger.ts's `plainer`): by name where its name settles on it where it stands.
   * The tool is asked by writing `out` as a rewrite of the trigger, which writes nothing. It is
   * handed `out`'s own objects, unparsed, since it tells each form by the object it stands for (the
   * outline builds a new object for each place, so no two places share one). A
   * refusal comes once every statement is built, so each part the tool could build still has its
   * form; only the parts of a call it can't build (one listed as unwritable) keep their references.
   */
  private plainest(out: AuthoringTrigger): AuthoringTrigger {
    const forms = new Map<object, unknown>();
    try {
      authorTrigger(out, { libraries: this.context.libraries, map: this.context.map, taken: new Set(), previous: this.trigger, plainer: (given, form) => forms.set(given, form) });
    } catch (error) {
      if (!(error instanceof AuthoringError)) throw error;
    }
    // A form holds the parts of the value it stands for (a member, an index), which have forms of their own.
    const plain = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(plain);
      if (value === null || typeof value !== "object") return value;
      const form = forms.has(value) ? forms.get(value) : value;
      if (form === null || typeof form !== "object") return form;
      return Object.fromEntries(Object.entries(form).map(([key, inner]) => [key, plain(inner)]));
    };
    return plain(out) as AuthoringTrigger;
  }

  private statement(statement: GuiStatement, where: string): AuthoringStatement {
    const disabled = statement.disabled ? { disabled: true } : {};
    if ("comment" in statement) return { comment: statement.comment, ...disabled };
    if (statement.function === CUSTOM_SCRIPT && statement.script !== undefined) {
      if (statement.script === "") this.cant(where, "an empty Custom Script");
      return { customScript: statement.script, ...disabled };
    }
    return this.call(statement, where);
  }

  /** A library's function or the map's own, as a call needs it. */
  private callee(ref: string): Callee | undefined {
    const { libraries, map } = this.context;
    const slash = ref.indexOf("/");
    if (slash < 0) {
      const fn = map.functions.find((each) => each.id === ref);
      if (!fn) return undefined;
      return {
        name: fn.name,
        params: new Map(fn.parameters.map((param) => [param.id, param.name])),
        slots: new Map(fn.subFunctions.map((slot) => [slot.id, slot.name])),
        paramCount: fn.parameters.length,
        repeats: new Set(),
      };
    }
    const library = ref.slice(0, slash);
    const lib = libraries[library];
    const fn = lib?.functions[ref.slice(slash + 1)];
    if (!lib || !fn) return undefined;
    return {
      name: fn.name ?? fn.identifier ?? ref,
      params: new Map(fn.params.map((param) => [`${library}/${param}`, lib.params[param]?.name ?? lib.params[param]?.identifier ?? param])),
      slots: new Map(
        (fn.subFunctions ?? []).map((slot) => {
          const [slotLibrary, slotId] = slot.split("/") as [string, string];
          return [slot, libraries[slotLibrary]?.slots?.[slotId]?.name ?? libraries[slotLibrary]?.subFunctions[slotId] ?? slotId];
        }),
      ),
      paramCount: fn.params.length,
      repeats: new Set(fn.params.flatMap((param) => (templateRepeats(fn.script, lib.params[param]?.identifier) ? [`${library}/${param}`] : []))),
    };
  }

  /** How a call names its function: by its name where that settles on it (in its library, or the map's), else by its reference. */
  private functionName(ref: string, name: string): Pick<AuthoringCall, "function" | "library"> {
    const { libraries, map } = this.context;
    if (!ELEMENT_REF.test(ref)) {
      const namesakes = map.functions.filter((fn) => folded(fn.name) === folded(name));
      return { function: namesakes.length === 1 ? name : ref, library: "map" };
    }
    const library = ref.slice(0, ref.indexOf("/"));
    const anywhere = resolveFunction(libraries, name);
    const mapNamesake = map.functions.some((fn) => folded(fn.name) === folded(name));
    if (!mapNamesake && anywhere.status === "found" && anywhere.fn.id === ref) return { function: name };
    const inLibrary = resolveFunction(libraries, name, { library });
    if (inLibrary.status === "found" && inLibrary.fn.id === ref) return { function: name, library };
    return { function: ref };
  }

  private call(call: GuiCall, where: string): AuthoringCall {
    const callee = this.callee(call.function);
    if (!callee) {
      this.cant(where, `a call to ${call.function}, which isn't in reach`);
      return { function: call.function };
    }
    const at = `${where} (${callee.name})`;
    const params: Record<string, AuthoringValue | AuthoringValue[] | null> = {};
    // A parameter by its name, or by its reference where two of the callee's share the name.
    const keyOf = (ref: string, name: string): string => ([...callee.params.values()].filter((each) => folded(each) === folded(name)).length > 1 ? ref : name);
    for (const param of call.params ?? []) {
      const name = callee.params.get(param.def);
      if (name === undefined) {
        this.cant(at, `a parameter ${param.def} ${callee.name} doesn't have`);
        continue;
      }
      const key = keyOf(param.def, name);
      const value = this.value(param, `${at}, ${name}`);
      // A parameter given more than once (one its template repeats) is a list of its values.
      const before = params[key];
      if (before === undefined) params[key] = value;
      else {
        if (!callee.repeats.has(param.def)) this.cant(at, `its ${name} given more than once, which its template doesn't repeat`);
        params[key] = [...(Array.isArray(before) ? before : [before as AuthoringValue]), value];
      }
    }
    // A parameter the save leaves unset (a disabled call's) is given as null, which the tool leaves unset.
    const given = new Set((call.params ?? []).map((param) => param.def));
    for (const [ref, name] of callee.params) {
      if (!given.has(ref)) params[keyOf(ref, name)] = null;
    }
    // Each slot's statements, the slots in the order the save first holds them (which the tool keeps); a slot's statements held apart, between another's, come together, as Galaxy writes them.
    const blocks: Record<string, AuthoringStatement[]> = {};
    for (const [index, statement] of (call.body ?? []).entries()) {
      const slot = statement.sub === undefined ? undefined : callee.slots.get(statement.sub);
      if (slot === undefined) {
        this.cant(`${at}, block ${index + 1}`, "a statement in no slot of its block");
        continue;
      }
      (blocks[slot] ??= []).push(this.statement(statement, `${at}, ${slot} ${(blocks[slot]?.length ?? 0) + 1}`));
    }
    if (call.script !== undefined) this.cant(at, "custom script held by a call that isn't Custom Script");
    return {
      ...this.functionName(call.function, callee.name),
      ...(Object.keys(params).length ? { params } : {}),
      ...(Object.keys(blocks).length ? { blocks } : {}),
      ...(call.disabled ? { disabled: true } : {}),
    };
  }

  /** A value, held by the Param (or slot, or index) of `id` where it has one. */
  private value(value: GuiValue & { readonly id?: string }, where: string): AuthoringValue {
    if ("bits" in value || "presetElement" in value) {
      const bits = "bits" in value ? (value.bits ?? []) : [];
      const preset = "presetElement" in value ? value.presetElement : undefined;
      return { bits: [...bits], ...(preset !== undefined ? { preset } : {}) };
    }
    if ("preset" in value && value.preset !== undefined) return { preset: value.preset };
    if ("call" in value && value.call) return this.call(value.call, where);
    if ("variable" in value && value.variable !== undefined) {
      const local = this.locals.get(value.variable);
      return {
        variable: local ?? value.variable,
        ...(value.index
          ? {
              index: value.index.map((held) => this.value(held, `${where}, index`)),
            }
          : {}),
        ...(value.member ? { member: this.member(value.member, where) } : {}),
      };
    }
    if ("parameter" in value && value.parameter !== undefined) {
      this.cant(where, "a function's own parameter, which a trigger has none of");
      return { customScript: value.parameter };
    }
    if ("trigger" in value && value.trigger !== undefined)
      return {
        trigger: value.trigger === this.trigger.id ? this.trigger.name : value.trigger,
      };
    if ("customScript" in value && value.customScript !== undefined) {
      if (value.customScript === "") this.cant(where, "empty custom script");
      return {
        customScript: value.customScript,
        ...(value.customType !== undefined ? { type: value.customType } : {}),
      };
    }
    if ("expression" in value && value.expression) {
      const { type, text, slots } = value.expression;
      const words = type === "text" ? this.words[`Param/Expression/${value.id}`] : text;
      if (words === undefined) this.cant(where, "a text expression whose words aren't known");
      const given: Record<string, AuthoringValue> = {};
      for (const slot of slots) {
        if (slot.code in given) this.cant(where, `an expression with two slots ${slot.code}`);
        given[slot.code] = this.value(slot, `${where}, slot ${slot.code}`);
      }
      return {
        expression: words ?? "",
        type,
        ...(slots.length ? { slots: given } : {}),
      };
    }
    if ("type" in value && value.type !== undefined) {
      if (value.valueParams !== undefined) this.cant(where, `a ${value.type} literal holding values of its own (ValueParam)`);
      if (value.type === "text" && value.value === undefined) return { text: this.words[`Param/Value/${value.id}`] ?? "" };
      return {
        type: value.type,
        ...(value.value !== undefined ? { value: value.value } : {}),
        ...(value.gameType !== undefined ? { gameType: value.gameType } : {}),
        ...(value.valueId !== undefined ? { valueId: value.valueId } : {}),
        ...(value.typeInfo !== undefined ? { typeInfo: value.typeInfo } : {}),
        ...(value.context !== undefined ? { context: value.context } : {}),
      };
    }
    this.cant(where, "a value of no form the tool knows");
    return { customScript: "" };
  }

  private member(member: StructMember, where: string): AuthoringMember {
    return {
      variable: member.variable,
      ...(member.index
        ? {
            index: member.index.map((held: HeldValue) => this.value(held, `${where}, index`)),
          }
        : {}),
      ...(member.member ? { member: this.member(member.member, where) } : {}),
    };
  }
}

/** What writing a trigger's outline back gives: the outline, and why it doesn't write the trigger back as it is (none when it does). */
export type AuthoringRoundTrip = {
  readonly outline: AuthoringOutline;
  readonly problems: readonly string[];
};

/**
 * Whether the authoring tool writes `trigger` back as it is: its outline (outlineForAuthoring),
 * written through authorTrigger as a rewrite of it, compared with it. Its parameters are compared
 * in any order (the tool writes them in their definition's), a block's statements slot by slot, an older Editor's set of bits naming
 * no preset type is the parameter's, and a text with no words is the same with its key or without.
 */
export function authoringRoundTrip(trigger: BlueprintTrigger, context: OutlineContext): AuthoringRoundTrip {
  const outline = outlineForAuthoring(trigger, context);
  if (outline.unwritable.length > 0) return { outline, problems: outline.unwritable };
  let written: BlueprintTrigger;
  try {
    written = authorTrigger(outline.trigger, {
      libraries: context.libraries,
      map: context.map,
      taken: new Set(),
      previous: trigger,
    }).trigger;
  } catch (error) {
    if (error instanceof AuthoringError)
      return {
        outline,
        problems: error.problems.map((problem) => `refused: ${problem}`),
      };
    throw error;
  }
  const difference = firstDifference(canonical(trigger), canonical(written), "");
  return {
    outline,
    problems: difference === undefined ? [] : [`written back otherwise, at ${difference}`],
  };
}

/** A trigger as the round trip compares it: params sorted by definition, a set of bits' preset type left out, empty words left out, keys sorted. */
function canonical(trigger: BlueprintTrigger): unknown {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (value === null || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      // A set of bits is its values, whatever preset type it names (an older Editor's names none); one with none set keeps its type.
      if (key === "presetElement" && record.bits !== undefined) continue;
      if (key === "params" && Array.isArray(record.params)) out.params = [...(record.params as { def: string }[])].sort((a, b) => a.def.localeCompare(b.def)).map(visit);
      else if (key === "body" && Array.isArray(record.body)) {
        // Each slot's statements together, the slots in the order they first stand: Galaxy writes a block slot by slot.
        const body = record.body as { readonly sub?: string }[];
        const slots = [...new Set(body.map((statement) => statement.sub))];
        out.body = slots.flatMap((slot) => body.filter((statement) => statement.sub === slot)).map(visit);
      } else out[key] = visit(record[key]);
    }
    return out;
  };
  const strings = Object.fromEntries(
    Object.entries(trigger.strings ?? {})
      .map(([file, entries]) => [file, Object.fromEntries(Object.entries(entries).filter(([, words]) => words !== ""))])
      .filter(([, entries]) => Object.keys(entries as object).length > 0),
  );
  const { strings: _strings, ...rest } = trigger;
  return visit({ ...rest, strings });
}

/** The path of the first place `a` and `b` differ, or undefined where they don't. */
function firstDifference(a: unknown, b: unknown, at: string): string | undefined {
  if (a === b) return undefined;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return `${at || "(trigger)"}: ${JSON.stringify(a)?.slice(0, 120)} became ${JSON.stringify(b)?.slice(0, 120)}`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const found = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], at ? `${at}.${key}` : key);
    if (found !== undefined) return found;
  }
  return undefined;
}
