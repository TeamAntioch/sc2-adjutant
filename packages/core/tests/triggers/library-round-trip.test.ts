// "Any trigger", measured over the game's whole library (#1035): a call to every function in
// data/trigger-libraries.json, written through the authoring tool from placeholder arguments, outlines
// and writes back to the same bytes (the one file the tool and convert_triggers write,
// blueprintTriggerFile) and its Galaxy is written by the one engine. What can't be is refused, and
// each refusal is on the known list (library-refusals.json) by reason; a refusal not on it, or one
// listed that no longer happens, fails. `UPDATE_REFUSALS=1` rewrites the list.
//
// A parameter whose library default is a call leaving out a parameter (Sine's Facing Angle Of Unit,
// with no Unit) is given that call filled in, so the function itself is measured; what the tool
// does with the default as the library holds it is listed apart (`defaultsLeavingOut`).
import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { TypeSpec } from "../../src/domain/library-interface.js";
import { authoredTriggerGalaxy } from "../../src/map/write-blueprint-trigger.js";
import { type GameFunction, type GameLibrary, type GameParameter, gameTriggerLibraries } from "../../src/mods/library-galaxy.js";
import { type AuthoringCall, AuthoringError, type AuthoringTrigger, type AuthoringValue, type AuthoringVariable, authorTrigger, type MapReach } from "../../src/triggers/author-trigger.js";
import { outlineForAuthoring } from "../../src/triggers/authoring-outline.js";
import { blueprintTriggerFile } from "../../src/triggers/blueprint-triggers.js";
import { LOCAL_VARIABLE_TYPES } from "../../src/triggers/kept-trigger-galaxy.js";

const REFUSALS = new URL("./library-refusals.json", import.meta.url);
const EMPTY_TRIGGERS = '<?xml version="1.0" encoding="utf-8"?>\r\n<TriggerData>\r\n    <Root>\r\n    </Root>\r\n</TriggerData>\r\n';
/** A map with nothing of its own: every call is the game's. */
const MAP: MapReach = { functions: [], globals: [], triggers: [] };
const NAME = "Library Call";
/** A placeholder's words, and the name of its locals: an Integer one (what Any Variable is given), and one per other type, named after it. */
const PLACEHOLDER = "Placeholder";
/** Set Variable and Comparison, which hold a function's value. */
const SET_VARIABLE = "Ntve/00000136";
const COMPARISON = "Ntve/C439C375";

type Holder = { readonly call: AuthoringCall; readonly param: string };
type InReach = { readonly library: string; readonly ref: string; readonly fn: GameFunction; readonly lib: GameLibrary };
/** What the known list holds: each reason with the functions refused for it, and what the tool does with the defaults leaving out a parameter. */
type KnownList = { readonly refused: Record<string, string[]>; readonly defaultsLeavingOut: Record<string, string[]> };

const ref = (library: string, id: string): string => `${library}/${id}`;
/** A `<library>/<id>` reference's library and id. */
const parts = (reference: string): [library: string, id: string] => reference.split("/") as [string, string];
const sameType = (a: TypeSpec, b: TypeSpec): boolean => a.type === b.type && a.element === b.element && a.gameType === b.gameType;
const localType = (type: TypeSpec): boolean => LOCAL_VARIABLE_TYPES.has(type.type) && type.element === undefined && type.gameType === undefined;
const localName = (type: string): string => (type === "int" ? PLACEHOLDER : `${PLACEHOLDER} ${type}`);

/** `key`'s value in `cache`, made by `make` the first time. */
function memo<T>(cache: Map<string, T>, key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key)!;
}

/** Placeholder arguments: the value a parameter a call must be given is given, by its type. */
class Placeholders {
  /** The functions in reach that give a value, the plainest first: a placeholder of their type may be a call to one. */
  private readonly values: readonly InReach[];
  /** The actions in reach, the plainest first: one may hold a value no local can have the type of. */
  private readonly actions: readonly InReach[];
  private readonly holders = new Map<string, Holder | undefined>();
  private readonly placeholders = new Map<string, AuthoringValue | undefined>();

  /** `fillDefaults`: whether a parameter whose default is a call leaving out a parameter is given that call filled in, else left to its default. */
  constructor(
    private readonly libraries: Readonly<Record<string, GameLibrary>>,
    private readonly fillDefaults = true,
  ) {
    const all = Object.entries(libraries).flatMap(([library, lib]) => Object.entries(lib.functions).map(([id, fn]) => ({ library, ref: ref(library, id), fn, lib })));
    const plain = ({ fn }: InReach): boolean => !fn.flags.includes("hidden") && !fn.subFunctions?.length;
    this.values = all
      .filter((each) => plain(each) && each.fn.returns !== undefined && !each.fn.flags.includes("action") && !each.fn.flags.includes("event"))
      .sort((a, b) => this.unfilled(a.fn, a.lib).length - this.unfilled(b.fn, b.lib).length || a.ref.localeCompare(b.ref));
    this.actions = all.filter((each) => plain(each) && each.fn.flags.includes("action")).sort((a, b) => a.fn.params.length - b.fn.params.length || a.ref.localeCompare(b.ref));
  }

  /**
   * A function's parameters a call must be given: those with no default, and (`fillDefaults`) those
   * whose default is a call leaving out a parameter (Order With No Target, with no Ability Command;
   * Sine's Facing Angle Of Unit, with no Unit), each with the function that call is to.
   */
  unfilled(fn: GameFunction, lib: GameLibrary): { readonly id: string; readonly param: GameParameter | undefined; readonly call?: string }[] {
    return fn.params.flatMap((id) => {
      const param = lib.params[id];
      if (param?.default === undefined) return [{ id, param }];
      const call = this.fillDefaults && "call" in param.default ? param.default.call : undefined;
      return call && this.leavesOut(call) ? [{ id, param, call: call.function }] : [];
    });
  }

  /** Whether a function has a parameter whose default is a call leaving out a parameter. */
  defaultLeavesOut(fn: GameFunction, lib: GameLibrary): boolean {
    return fn.params.some((id) => {
      const fallback = lib.params[id]?.default;
      return fallback !== undefined && "call" in fallback && this.leavesOut(fallback.call);
    });
  }

  /** Whether `call` leaves out a parameter of its function. */
  private leavesOut(call: { readonly function: string; readonly params?: readonly { readonly def: string }[] }): boolean {
    const [library, id] = parts(call.function);
    const fn = this.libraries[library]?.functions[id];
    const given = new Set((call.params ?? []).map((param) => param.def));
    return fn !== undefined && fn.params.some((param) => !given.has(ref(library, param)));
  }

  /** `fn`'s parameters a call must be given, each given its placeholder, by reference; undefined where one has none. */
  params(fn: GameFunction, lib: GameLibrary, library: string, depth = 0): Record<string, AuthoringValue> | undefined {
    const out: Record<string, AuthoringValue> = {};
    for (const { id, param, call } of this.unfilled(fn, lib)) {
      let value: AuthoringValue | undefined;
      if (call !== undefined) {
        const [owner, callee] = parts(call);
        const inner = this.libraries[owner]?.functions[callee];
        const params = inner && depth < 2 ? this.params(inner, this.libraries[owner]!, owner, depth + 1) : undefined;
        value = params && { function: call, params };
      } else {
        const type = param && this.typeOf(param, lib, library);
        value = type && this.value(type, depth);
      }
      if (value === undefined) return undefined;
      out[ref(library, id)] = value;
    }
    return out;
  }

  /** A parameter's type; a Same As one's, the parameter's it names (an Any Variable's, the Integer local's). */
  private typeOf(param: GameParameter, lib: GameLibrary, library: string): TypeSpec | undefined {
    if (param.type === "sameas" && param.element) {
      const [owner, id] = parts(param.element);
      const named = (owner === library ? lib : this.libraries[owner])?.params[id];
      return named?.type === "anyvariable" ? { type: "int" } : named && this.typeOf(named, lib, library);
    }
    if (!param.type) return undefined;
    return { type: param.type, ...(param.element ? { element: param.element } : {}), ...(param.gameType ? { gameType: param.gameType } : {}) };
  }

  /** A placeholder of `type`: a plain literal where it has one, else a call to the plainest function giving it, else a local of it, else a literal of it. */
  value(type: TypeSpec, depth = 0): AuthoringValue | undefined {
    return memo(this.placeholders, `${depth} ${JSON.stringify(type)}`, () => this.placeholder(type, depth));
  }

  private placeholder(type: TypeSpec, depth: number): AuthoringValue | undefined {
    switch (type.type) {
      case "int":
      case "byte":
      case "fixed":
      case "anynumber":
      case "anycompare":
        return 0;
      case "bool":
        return false;
      case "string":
      case "actormsg":
        return PLACEHOLDER;
      case "text":
        return { text: PLACEHOLDER };
      case "trigger":
        return { trigger: NAME };
      case "anyvariable":
        return { variable: localName("int") };
      case "gamelink":
        if (type.gameType) return PLACEHOLDER;
        break;
      case "anygamelink":
        return { value: PLACEHOLDER, type: "gamelink", gameType: "Unit" };
      case "preset":
      case "anypreset": {
        const [library = "Ntve", id] = type.element ? parts(type.element) : [];
        const preset = id ? this.libraries[library]?.presets[id] : Object.values(this.libraries.Ntve?.presets ?? {}).find((each) => !each.bits && each.values?.length);
        if (preset?.bits) return { bits: [] };
        const first = preset?.values?.[0];
        if (first) return { preset: first.includes("/") ? first : ref(library, first) };
        // A preset type with no values of its own (Game User Id): a function's value.
        break;
      }
    }
    if (depth < 2)
      for (const candidate of this.values) {
        if (!sameType(candidate.fn.returns!, type)) continue;
        const params = this.params(candidate.fn, candidate.lib, candidate.library, depth + 1);
        if (params) return { function: candidate.ref, ...(Object.keys(params).length ? { params } : {}) };
      }
    if (localType(type)) return { variable: localName(type.type) };
    return { value: PLACEHOLDER, type: type.type, ...(type.gameType ? { gameType: type.gameType } : {}) };
  }

  /** The name of each block slot of `fn` that holds conditions (If Then Else's If). */
  conditionSlots(fn: GameFunction): string[] {
    return (fn.subFunctions ?? []).flatMap((slot) => {
      const [library, id] = parts(slot);
      const found = this.libraries[library]?.slots?.[id];
      return found?.holds === "condition" ? [found.name] : [];
    });
  }

  /** The plainest action with a parameter of `type` (by reference), its others given placeholders: what holds a value no local can have the type of. */
  holder(type: TypeSpec): Holder | undefined {
    return memo(this.holders, JSON.stringify(type), () => this.findHolder(type));
  }

  private findHolder(type: TypeSpec): Holder | undefined {
    for (const { library, ref: action, fn, lib } of this.actions) {
      const id = fn.params.find((param) => {
        const def = lib.params[param];
        const taken = def && this.typeOf(def, lib, library);
        return taken !== undefined && sameType(taken, type);
      });
      if (id === undefined) continue;
      const params = this.params({ ...fn, params: fn.params.filter((param) => param !== id) }, lib, library);
      if (params) return { call: { function: action, params }, param: ref(library, id) };
    }
    return undefined;
  }
}

/** The placeholder locals `value` names, each declared of the type its name is for. */
function localsNamed(value: unknown, into = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(value)) for (const each of value) localsNamed(each, into);
  else if (value !== null && typeof value === "object") {
    const { variable } = value as { variable?: unknown };
    if (typeof variable === "string" && (variable === PLACEHOLDER || variable.startsWith(`${PLACEHOLDER} `))) into.set(variable, variable === PLACEHOLDER ? "int" : variable.slice(PLACEHOLDER.length + 1));
    for (const each of Object.values(value)) localsNamed(each, into);
  }
  return into;
}

/**
 * A trigger calling `fn` from placeholder arguments, where its kind has it stand: an event among the
 * events, a condition among the conditions, an action among the actions; any other function's value
 * set to a local of its type (Set Variable), else given to the plainest action taking it, else
 * compared with a placeholder (Comparison). A block's condition slots each hold a Comparison, as a
 * new one does in the Editor (the engine writes no empty one). A string is why it can't be placed.
 */
function callingTrigger(at: InReach, placeholders: Placeholders): AuthoringTrigger | string {
  const { fn } = at;
  const params = placeholders.params(fn, at.lib, at.library);
  if (!params)
    return fn.params.some((param) => at.lib.params[param] === undefined)
      ? "a parameter of it isn't in the library data"
      : "a parameter it must be given has no placeholder: no literal, function or local gives its type";
  const slots = placeholders.conditionSlots(fn);
  const call: AuthoringCall = {
    function: at.ref,
    ...(Object.keys(params).length ? { params } : {}),
    ...(slots.length ? { blocks: Object.fromEntries(slots.map((name) => [name, [{ function: COMPARISON }]])) } : {}),
  };
  const trigger = (body: Omit<AuthoringTrigger, "name">): AuthoringTrigger => {
    const variables: AuthoringVariable[] = [...localsNamed(body)].map(([name, type]) => ({ name, type: { type } }));
    return { name: NAME, ...(variables.length ? { variables } : {}), ...body };
  };
  if (fn.flags.includes("event")) return trigger({ events: [call] });
  if (fn.flags.includes("condition")) return trigger({ conditions: [call] });
  if (fn.flags.includes("action") || fn.returns === undefined) return trigger({ actions: [call] });
  if (localType(fn.returns)) return trigger({ actions: [{ function: SET_VARIABLE, params: { Variable: { variable: localName(fn.returns.type) }, Value: call } }] });
  const holder = placeholders.holder(fn.returns);
  if (holder) return trigger({ actions: [{ ...holder.call, params: { ...holder.call.params, [holder.param]: call } }] });
  const other = placeholders.value(fn.returns);
  if (other === undefined) return `no placeholder of its type (${fn.returns.type}) to compare its value with`;
  return trigger({ conditions: [{ function: COMPARISON, params: { "Value 1": call, "Value 2": other } }] });
}

/** Where the authoring tool refuses `input`, its outline can't express it, the outline writes other bytes, or the engine can't write its Galaxy: why. */
function roundTripProblems(input: AuthoringTrigger, libraries: Readonly<Record<string, GameLibrary>>): readonly string[] {
  try {
    const { trigger } = authorTrigger(input, { libraries, map: MAP, taken: new Set() });
    const outline = outlineForAuthoring(trigger, { libraries, map: MAP });
    if (outline.unwritable.length > 0) return outline.unwritable.map((place) => `its outline can't express ${place}`);
    const again = authorTrigger(outline.trigger, { libraries, map: MAP, taken: new Set(), previous: trigger }).trigger;
    if (blueprintTriggerFile(again) !== blueprintTriggerFile(trigger)) return ["its outline writes other bytes"];
    authoredTriggerGalaxy(trigger, [], [], { triggers: EMPTY_TRIGGERS, gameStrings: [] }, new Map(), libraries);
    return [];
  } catch (error) {
    if (error instanceof AuthoringError) return error.problems;
    throw error;
  }
}

/** A problem as a reason: its place in the trigger left out (`action 1 (Set Variable), Value (…), X: `), and the Ids it names. */
const reasonOf = (problem: string): string =>
  problem
    .replace(/^(?:its outline can't express )?(?:action|condition|event) \d+ \(.*?\)(?:, [^:]*?)?: /, (place) => (place.startsWith("its outline") ? "its outline can't express " : ""))
    .replace(/\b[0-9A-F]{8}\b/g, "<id>");

/** Each reason's functions, the reasons sorted. */
const byReason = (found: Record<string, string[]>): Record<string, string[]> => Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)));

describe("every function in the game's library data", () => {
  it("is written by the authoring tool from placeholder arguments, outlines and writes back to the same bytes and compiles, or is refused for a known reason", async () => {
    const libraries = gameTriggerLibraries();
    const placeholders = new Placeholders(libraries);
    const asHeld = new Placeholders(libraries, false);
    const refused: Record<string, string[]> = {};
    const defaultsLeavingOut: Record<string, string[]> = {};
    const problemsOf = (at: InReach, from: Placeholders): readonly string[] => {
      const input = callingTrigger(at, from);
      return typeof input === "string" ? [input] : roundTripProblems(input, libraries);
    };
    let yielded = Date.now();
    for (const [library, lib] of Object.entries(libraries))
      for (const [id, fn] of Object.entries(lib.functions)) {
        // The worker answers vitest every so often, which times its calls out otherwise (on a loaded machine too).
        if (Date.now() - yielded > 100) {
          await new Promise((resolve) => setImmediate(resolve));
          yielded = Date.now();
        }
        const at = { library, ref: ref(library, id), fn, lib };
        const name = `${at.ref} ${fn.name ?? fn.identifier ?? ""}`.trim();
        for (const reason of new Set(problemsOf(at, placeholders).map(reasonOf))) (refused[reason] ??= []).push(name);
        if (placeholders.defaultLeavesOut(fn, lib)) {
          const problems = problemsOf(at, asHeld);
          for (const reason of problems.length ? new Set(problems.map(reasonOf)) : ["written back and compiled"]) (defaultsLeavingOut[reason] ??= []).push(name);
        }
      }
    const known: KnownList = { refused: byReason(refused), defaultsLeavingOut: byReason(defaultsLeavingOut) };
    if (process.env.UPDATE_REFUSALS) writeFileSync(REFUSALS, `${JSON.stringify(known, null, 2)}\n`);
    expect(known).toEqual(JSON.parse(readFileSync(REFUSALS, "utf8")));
  }, 300_000);
});
