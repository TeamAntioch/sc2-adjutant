// Holds a Kept trigger back (ADR-0014): switches off what starts it in the Map Package, so a cue's
// Compiled trigger runs it once the scenes before it have played. What starts it is a Run Trigger of
// it in another Kept trigger (`from`), or its own Map Initialization event. Each is switched off as
// the Editor does it, with its Disabled flag in `Triggers`, and its line comes out of
// `MapScript.galaxy`, where an Editor save leaves out a disabled call. So the Editor shows the call
// greyed, the author can still edit the trigger there, and Test Document runs the change without a
// save.
//
// The compile record lists each call a hold switched off, with its Galaxy line and the two lines it
// sat between, so a compile without the hold switches it back on and puts the line back where it was.

import type { CompileRecordEntry } from "../domain/compile-record.js";
import { type GuiStatement, isComment } from "../domain/library-interface.js";
import type { KeptReference } from "../domain/mission-blueprint.js";
import type { AuthoredTrigger } from "./blueprint-triggers.js";
import { keptElementSpan } from "./splice-map-script.js";
import { NTVE_FUNCTIONS as F } from "./trigger-catalog.js";
import { editorTriggerName } from "./trigger-model.js";
import { child, children, elementKey, elementOf, readTriggersFile, referenced, refKey, type TriggerXmlElement, type TriggersFile } from "./triggers-file.js";

/** A Kept trigger as a hold names it: its element Id, the Editor's name and its Galaxy name. */
export type HeldTrigger = { readonly id: string; readonly name: string; readonly scriptName: string };

/** A Kept trigger to hold, and the Kept trigger whose Run Trigger of it is held (none: its own Map Initialization event). */
export type KeptHold = { readonly trigger: HeldTrigger; readonly from?: HeldTrigger | undefined };

/** A call a hold switched off, as the compile record lists it. */
export type KeptHoldEntry = Extract<CompileRecordEntry, { kind: "kept-hold" }>;

export type KeptHoldResult = {
  readonly triggers: string;
  readonly script: string;
  /** Every call held now, for the record. */
  readonly entries: readonly KeptHoldEntry[];
  /** What changed, and what a hold leaves, for the compile's report. */
  readonly notes: readonly string[];
};

const RUN_TRIGGER = `${F.triggerExecute.library}/${F.triggerExecute.id}`;
const MAP_INIT = `${F.mapInit.library}/${F.mapInit.id}`;
const RUN_TRIGGER_TARGET = `${F.triggerExecute.library}/${F.triggerExecute.params.trigger.id}`;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Why a hold can't be made, the same for a Kept trigger and a Blueprint one. */
const HOLD_REFUSALS = {
  noRunTrigger: (hold: KeptHold): string =>
    `${hold.from!.name} has no Run Trigger of ${hold.trigger.name}, so there is nothing to hold: name the trigger that runs it in hold.from, or leave from out to hold its Map Initialization event`,
  otherEvent: (hold: KeptHold): string => `${hold.trigger.name} starts on an event other than Map Initialization, which a hold can't stand in for: hold the Run Trigger that runs it (hold.from), or change its event`,
  noMapInit: (hold: KeptHold): string => `${hold.trigger.name} has no Map Initialization event to hold: name the trigger that runs it in hold.from`,
};

/** A call in a Kept trigger, and whether the Editor writes it to the script: not if it, or a call it sits in, is disabled. */
type FoundCall = { readonly element: TriggerXmlElement; readonly written: boolean };

/** The calls a trigger's events, actions and blocks hold, nested, in document order. */
function callsOf(file: TriggersFile, trigger: TriggerXmlElement): FoundCall[] {
  const out: FoundCall[] = [];
  const seen = new Set<string>();
  const visit = (element: TriggerXmlElement, written: boolean): void => {
    for (const node of element.children) {
      if (!["Param", "FunctionCall"].includes(node.attrs.Type ?? "")) continue;
      const nested = referenced(file, node);
      if (!nested || seen.has(elementKey(nested.type, nested.id))) continue;
      seen.add(elementKey(nested.type, nested.id));
      const on = written && !(nested.type === "FunctionCall" && child(nested, "Disabled"));
      if (nested.type === "FunctionCall") out.push({ element: nested, written: on });
      visit(nested, on);
    }
  };
  visit(trigger, true);
  return out;
}

const definition = (call: TriggerXmlElement): string => {
  const def = child(call, "FunctionDef");
  return def ? refKey(def) : "";
};

/** Whether `call` is a Run Trigger of the trigger `id`. */
function runs(file: TriggersFile, call: TriggerXmlElement, id: string): boolean {
  if (definition(call) !== RUN_TRIGGER) return false;
  return children(call, "Parameter").some((parameter) => {
    const param = referenced(file, parameter);
    const def = param && child(param, "ParameterDef");
    return def !== undefined && refKey(def) === RUN_TRIGGER_TARGET && child(param!, "ValueElement")?.attrs.Id === id;
  });
}

/** The Editor's name for a trigger, by element Id. */
const nameOf = (names: ReadonlyMap<string, string>, id: string): string => names.get(`Trigger/${id}`) ?? id;

/** `text` with the call `id`'s Disabled flag set or cleared, as the Editor writes it: the first line of its body. */
function setDisabled(text: string, id: string, disabled: boolean): string {
  const file = readTriggersFile(text);
  const element = elementOf(file, "FunctionCall", id);
  if (!element || Boolean(child(element, "Disabled")) === disabled) return text;
  const bodyStart = text.indexOf("\n", element.start) + 1;
  if (disabled) return `${text.slice(0, bodyStart)}        <Disabled/>${file.eol}${text.slice(bodyStart)}`;
  const flag = `        <Disabled/>${file.eol}`;
  const at = text.indexOf(flag, bodyStart);
  if (at < 0 || at >= element.end) return text;
  return text.slice(0, at) + text.slice(at + flag.length);
}

/** Changes the lines of a Kept trigger's section of the script. */
function editSection(script: string, scriptName: string, what: string, edit: (lines: string[]) => string[]): string {
  const span = keptElementSpan(script, scriptName);
  if (!span) throw new Error(`MapScript.galaxy has no ${scriptName} for ${what}: save the map in the Editor so it writes one, then compile again`);
  const eol = script.includes("\r\n") ? "\r\n" : "\n";
  const lines = script.slice(span.start, span.end).split(eol);
  return script.slice(0, span.start) + edit(lines).join(eol) + script.slice(span.end);
}

/**
 * Applies `holds` to a Map Package's `triggers` and `script`, and releases each call `previous` (the
 * last compile's record) lists that no hold keeps now. Throws, naming the trigger, when a hold
 * names a start the package doesn't have, or when the script isn't what the Editor writes for the
 * triggers it changes.
 */
export function applyKeptHolds(
  triggers: string,
  script: string,
  names: ReadonlyMap<string, string>,
  holds: readonly KeptHold[],
  previous: readonly KeptHoldEntry[],
  /** The Compiled triggers' element Ids (the last compile's record): not Kept, so not among the triggers a hold leaves running it. */
  compiled: ReadonlySet<string> = new Set(),
  /**
   * The Blueprint's own triggers' element Ids (ADR-0026). A hold whose call sits in one (its own
   * Map Initialization event, or a Run Trigger in `from`) is holdBlueprintTriggers', which switches
   * it off in the body, so it's left alone here, and so is the record's entry for one.
   */
  blueprint: ReadonlySet<string> = new Set(),
): KeptHoldResult {
  const notes: string[] = [];
  const entries: KeptHoldEntry[] = [];
  const file = readTriggersFile(triggers);
  // Each hold's calls: the ones to switch off now and the ones a hold switched off before.
  const plans = holds.flatMap((hold) => {
    if (blueprint.has((hold.from ?? hold.trigger).id)) return [];
    // A held Blueprint trigger run from a Kept one needn't be in Triggers yet: only the Kept caller's call is switched off.
    const held = elementOf(file, "Trigger", hold.trigger.id);
    if (!held && !blueprint.has(hold.trigger.id)) throw new Error(`The held Kept trigger ${hold.trigger.name} (${hold.trigger.id}) isn't in Triggers`);
    if (hold.from) {
      const caller = elementOf(file, "Trigger", hold.from.id);
      if (!caller) throw new Error(`The Kept trigger ${hold.from.name} (${hold.from.id}) that runs ${hold.trigger.name} isn't in Triggers`);
      const calls = callsOf(file, caller).filter((found) => runs(file, found.element, hold.trigger.id));
      if (calls.length === 0) throw new Error(HOLD_REFUSALS.noRunTrigger(hold));
      return [{ hold, caller: hold.from, calls, line: `TriggerExecute\\(${escape(hold.trigger.scriptName)}, (?:true|false), (?:true|false)\\);` }];
    }
    // Its own start: a Kept trigger, so in Triggers (a Blueprint one returned above).
    const events = children(held!, "Event").flatMap((node) => {
      const event = referenced(file, node);
      return event?.type === "FunctionCall" ? [{ element: event, written: !child(event, "Disabled") }] : [];
    });
    const other = events.find((event) => event.written && definition(event.element) !== MAP_INIT);
    if (other) throw new Error(HOLD_REFUSALS.otherEvent(hold));
    const calls = events.filter((event) => definition(event.element) === MAP_INIT);
    if (calls.length === 0) throw new Error(HOLD_REFUSALS.noMapInit(hold));
    return [{ hold, caller: hold.trigger, calls, line: `TriggerAddEventMapInit\\(${escape(hold.trigger.scriptName)}\\);` }];
  });
  const heldNow = new Set(plans.flatMap((plan) => plan.calls.map((found) => found.element.id)));

  // Releases first: a call no hold keeps goes back on, and its line back between the two it sat between.
  let xml = triggers;
  let galaxy = script;
  for (const entry of previous) {
    // A call in a Blueprint trigger is its body's, written as the Blueprint has it now.
    if (heldNow.has(entry.id) || blueprint.has(entry.trigger)) continue;
    const call = elementOf(readTriggersFile(xml), "FunctionCall", entry.id);
    // Gone, or switched back on in the Editor (which wrote its line again on save): nothing to put back.
    if (!call || !child(call, "Disabled")) continue;
    xml = setDisabled(xml, entry.id, false);
    galaxy = editSection(galaxy, entry.script, nameOf(names, entry.trigger), (lines) => {
      const at = lines.flatMap((line, index) => (line === entry.gap[0] && lines[index + 1] === entry.gap[1] ? [index + 1] : []));
      if (at.length !== 1) {
        throw new Error(
          `The hold on ${entry.id} in ${nameOf(names, entry.trigger)} is gone, but MapScript.galaxy has changed around where its line was, so the compile can't put it back: turn the call on in the Editor and save the map there`,
        );
      }
      return [...lines.slice(0, at[0]), entry.line, ...lines.slice(at[0])];
    });
    notes.push(`Switched ${nameOf(names, entry.trigger)}'s call ${entry.id} back on, as no hold keeps it now`);
  }

  for (const { hold, caller, calls, line } of plans) {
    const pattern = new RegExp(`^[ \\t]*${line}$`);
    const switching = calls.filter((found) => found.written);
    // Each one switched off already: the last compile's, carried over, or the author's own.
    for (const found of calls) {
      if (found.written) continue;
      const was = previous.find((entry) => entry.id === found.element.id);
      if (was) entries.push(was);
    }
    if (switching.length > 0) {
      galaxy = editSection(galaxy, caller.scriptName, caller.name, (lines) => {
        const matching = lines.flatMap((text, index) => (pattern.test(text) ? [index] : []));
        if (matching.length !== switching.length) {
          throw new Error(
            `MapScript.galaxy's ${caller.scriptName} has ${matching.length} ${hold.from ? `Run Trigger of ${hold.trigger.name}` : "Map Initialization event"} where Triggers has ${switching.length}, so it isn't what the Editor writes for ${caller.name}: save the map in the Editor, then compile again`,
          );
        }
        const removed = new Set(matching);
        const kept = (from: number, step: number): string => {
          let index = from;
          while (removed.has(index)) index += step;
          return lines[index] ?? "";
        };
        switching.forEach((found, order) => {
          const index = matching[order]!;
          entries.push({ kind: "kept-hold", id: found.element.id, trigger: caller.id, script: caller.scriptName, line: lines[index]!, gap: [kept(index - 1, -1), kept(index + 1, 1)] });
        });
        return lines.filter((_, index) => !removed.has(index));
      });
      for (const found of switching) xml = setDisabled(xml, found.element.id, true);
      notes.push(`Held ${hold.trigger.name}: switched off ${hold.from ? `its Run Trigger in ${caller.name}` : "its Map Initialization event"} (${switching.map((found) => found.element.id).join(", ")}); its cue runs it now`);
    }
    // Any other Kept trigger that runs it still does: the hold doesn't reach it. A Compiled one is the cue's.
    const others = [...file.elements.values()]
      .filter((element) => element.type === "Trigger" && element.id !== caller.id && !compiled.has(element.id) && callsOf(file, element).some((found) => found.written && runs(file, found.element, hold.trigger.id)))
      .map((element) => nameOf(names, element.id));
    if (others.length > 0) notes.push(`${hold.trigger.name} is also run by ${others.join(", ")}, which its hold leaves as it is`);
  }
  return { triggers: xml, script: galaxy, entries, notes };
}

/**
 * The Blueprint's own triggers (ADR-0026) with the calls `holds` switch off switched off in their
 * bodies: a Run Trigger of a held trigger in the Blueprint trigger that runs it (`from`), or a held
 * Blueprint trigger's own Map Initialization event. A Kept trigger converted keeps its hold this
 * way: the compile writes it as applyKeptHolds leaves the Kept one, its call Disabled, so the
 * Galaxy has no line for it. Throws, as applyKeptHolds does, when a held Blueprint trigger starts
 * on an event other than Map Initialization or has none, or when the Blueprint trigger `from`
 * names has no Run Trigger of it.
 */
export function holdBlueprintTriggers(triggers: readonly AuthoredTrigger[], holds: readonly KeptHold[]): AuthoredTrigger[] {
  if (holds.length === 0) return [...triggers];
  /** Whether `statement` is a Run Trigger of one of `ids`. */
  const runsOneOf = (statement: GuiStatement, ids: readonly string[]): boolean => {
    if (isComment(statement) || statement.function !== RUN_TRIGGER) return false;
    const target = statement.params?.find((param) => param.def === RUN_TRIGGER_TARGET);
    return target !== undefined && "trigger" in target && target.trigger !== undefined && ids.includes(target.trigger);
  };
  /** The calls in `statements` and their blocks the Editor writes to the script: none disabled, nor in a disabled one. */
  const written = (statements: readonly GuiStatement[]): GuiStatement[] =>
    statements.flatMap((statement) => (isComment(statement) || statement.disabled ? [] : [statement, ...written(statement.body ?? [])]));
  for (const hold of holds) {
    if (hold.from) {
      const caller = triggers.find(({ trigger }) => trigger.id === hold.from!.id)?.trigger;
      if (caller && !written(caller.actions).some((statement) => runsOneOf(statement, [hold.trigger.id]))) {
        throw new Error(HOLD_REFUSALS.noRunTrigger(hold));
      }
      continue;
    }
    const held = triggers.find(({ trigger }) => trigger.id === hold.trigger.id)?.trigger;
    if (!held) continue;
    const events = written(held.events);
    if (events.some((event) => !isComment(event) && event.function !== MAP_INIT)) {
      throw new Error(HOLD_REFUSALS.otherEvent(hold));
    }
    if (!held.events.some((event) => !isComment(event) && event.function === MAP_INIT)) throw new Error(HOLD_REFUSALS.noMapInit(hold));
  }
  return triggers.map((entry) => {
    const { trigger } = entry;
    const runs = holds.filter((hold) => hold.from?.id === trigger.id).map((hold) => hold.trigger.id);
    const ownStart = holds.some((hold) => !hold.from && hold.trigger.id === trigger.id);
    if (runs.length === 0 && !ownStart) return entry;
    const off = (statement: GuiStatement): GuiStatement => {
      if (isComment(statement)) return statement;
      const call = runsOneOf(statement, runs) ? { ...statement, disabled: true } : statement;
      return call.body ? { ...call, body: call.body.map(off) } : call;
    };
    const events = ownStart ? trigger.events.map((statement) => (!isComment(statement) && statement.function === MAP_INIT ? { ...statement, disabled: true } : statement)) : trigger.events;
    return { ...entry, trigger: { ...trigger, events, actions: runs.length > 0 ? trigger.actions.map(off) : trigger.actions } };
  });
}

/** The Blueprint's holds, each Kept trigger by its element Id, name and Galaxy name as the compile found them (resolveKeptReferences). */
export function keptHolds(blueprint: { readonly kept: readonly KeptReference[] }): KeptHold[] {
  const named = (id: string): HeldTrigger => {
    const reference = blueprint.kept.find((candidate) => candidate.id === id && candidate.kind === "trigger");
    if (!reference) throw new Error(`Unknown Kept trigger id: ${id}`);
    return { id: String(reference.editorId), name: reference.name, scriptName: reference.scriptName ?? editorTriggerName(reference.name) };
  };
  return blueprint.kept.flatMap((reference) => (reference.hold ? [{ trigger: named(reference.id), ...(reference.hold.from ? { from: named(reference.hold.from) } : {}) }] : []));
}
