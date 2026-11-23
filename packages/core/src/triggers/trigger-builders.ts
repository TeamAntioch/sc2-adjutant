// Builders for trigger elements with stable ids, shared by core's triggers and Plugins' (via the plugin SDK).

import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P, type PresetDef, SUB_FUNCTIONS } from "./trigger-catalog.js";
import { type ElementId, nestedCalls, type TriggerBlock, type TriggerCall, type TriggerParam, type TriggerRef, type TriggerVariable } from "./trigger-model.js";

/** The player's own player number. */
export const USER_PLAYER = 1;

/** 8-hex-digit Editor element ID derived from a path within the blueprint (FNV-1a). */
export function stableElementId(path: string): ElementId {
  let hash = 0x811c9dc5;
  for (let index = 0; index < path.length; index++) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).toUpperCase().padStart(8, "0");
}

/**
 * The element ID of the compile's Trigger Folder at `path` ("Mission", "Mission/Variables"): from
 * its path alone, so a recompile keeps the tree's ids and they can't be the author's own folders'.
 */
export const folderId = (path: string): ElementId => stableElementId(`folders/${path}`);

/** A global trigger variable at `path`, with its initial value. */
export const triggerVariable = (path: string, name: string, type: TriggerVariable["type"], value: TriggerParam["value"]): TriggerVariable => ({
  id: stableElementId(path),
  name,
  type,
  initial: { id: stableElementId(`${path}/initial`), value },
});

export function call(path: string, def: TriggerCall["def"], values: Readonly<Record<string, TriggerParam["value"]>>): TriggerCall {
  return {
    id: stableElementId(path),
    def,
    params: Object.fromEntries(
      // "/param" keeps parameter IDs apart from nested calls built at `${path}/${name}`.
      Object.entries(values).map(([name, value]) => [name, { id: stableElementId(`${path}/${name}/param`), value }]),
    ),
  };
}

/** A block action (If Then Else, Pick Each) with its nested calls. */
export function block(path: string, def: TriggerCall["def"], values: Readonly<Record<string, TriggerParam["value"]>>, blocks: TriggerBlock[]): TriggerCall {
  return { ...call(path, def, values), blocks: blocks.filter((nested) => nested.calls.length > 0) };
}

/** "Picked Unit" (inside a Pick Each Unit loop), as a parameter value. */
export const pickedUnit = (path: string): TriggerParam["value"] => ({ kind: "call", call: call(path, F.pickedUnit, {}) });

/** A data Behavior, by its id, as a parameter value. */
export const behaviorLink = (behavior: string): TriggerParam["value"] => ({ kind: "gamelink", gameType: "Behavior", value: behavior });

/** A function call as a parameter value. */
export const callValue = (path: string, def: TriggerCall["def"], values: Readonly<Record<string, TriggerParam["value"]>>): TriggerParam["value"] => ({
  kind: "call",
  call: call(path, def, values),
});

/** A comparison, `left <operator> right`, as a condition. */
export const compare = (path: string, left: TriggerParam["value"], operator: PresetDef, right: TriggerParam["value"]): TriggerCall =>
  call(path, F.comparison, { left, operator: { kind: "preset", preset: operator }, right });

/** If `condition` (every one of them, given several), then `then`: If Then Else with no else. */
export const ifThen = (path: string, condition: TriggerCall | readonly TriggerCall[], then: readonly TriggerCall[]): TriggerCall =>
  block(path, F.ifThenElse, {}, [
    { type: SUB_FUNCTIONS.if, calls: Array.isArray(condition) ? [...condition] : [condition as TriggerCall] },
    { type: SUB_FUNCTIONS.then, calls: [...then] },
  ]);

/** "Run Trigger": checking its conditions and not waiting for it, unless told otherwise. */
export const runTrigger = (path: string, trigger: TriggerRef, { wait = false, checkConditions = true }: { readonly wait?: boolean; readonly checkConditions?: boolean } = {}): TriggerCall =>
  call(path, F.triggerExecute, {
    checkConditions: { kind: "preset", preset: checkConditions ? P.checkConditions : P.dontCheckConditions },
    wait: { kind: "preset", preset: wait ? P.wait : P.dontWait },
    trigger: { kind: "trigger", trigger },
  });

/** "Wait" `seconds`, in game time unless told otherwise. */
export const wait = (path: string, seconds: number, timeType: PresetDef = P.timeGame): TriggerCall =>
  call(path, F.wait, { time: { kind: "fixed", value: seconds }, timeType: { kind: "preset", preset: timeType } });

/** How often, in game seconds, a thread waiting until something holds (waitUntil) checks it again. */
export const POLL_SECONDS = 0.25;

/** "Wait For Condition": the thread waits, checking every POLL_SECONDS of game time, until `condition` holds; not at all if it holds already. */
export const waitUntil = (path: string, condition: TriggerCall): TriggerCall =>
  block(path, F.waitForCondition, { time: { kind: "fixed", value: POLL_SECONDS }, timeType: { kind: "preset", preset: P.timeGame } }, [
    { type: SUB_FUNCTIONS.waitForCondition, calls: [condition] },
  ]);

/** "Turn (Current Trigger) Off": a trigger that should fire once turns itself off. */
export const turnOffCurrentTrigger = (path: string): TriggerCall =>
  call(path, F.triggerEnable, {
    trigger: { kind: "call", call: call(`${path}/trigger`, F.currentTrigger, {}) },
    state: { kind: "preset", preset: P.triggerOff },
  });

/** A piece of a debug message: text as written, or an integer-valued parameter (a count, say). */
export type DebugPiece = string | { readonly int: TriggerParam["value"] };

/**
 * "Debug Message" (TriggerDebugOutput) on screen. The engine shows it only when the map runs from
 * the Editor's Test Document, so release play never does. Pieces join with Combine Text, and an
 * `{ int }` piece, an integer value, shows through Convert Integer To Text.
 */
export function debugMessage(path: string, ...pieces: readonly DebugPiece[]): TriggerCall {
  const piece = (value: DebugPiece, index: number): TriggerParam["value"] =>
    typeof value === "string" ? { kind: "text", text: value } : callValue(`${path}/message/${index}`, F.intToText, { value: value.int });
  const message = pieces.map(piece).reduce((text, next, index) => callValue(`${path}/message/join/${index}`, F.combineText, { text1: text, text2: next }));
  return call(path, F.triggerDebugOutput, {
    type: { kind: "preset", preset: P.debugOutputTypeDefault },
    showInGame: { kind: "preset", preset: P.debugOutputShowInGameTrue },
    message,
  });
}

/** Text with its first letter capitalized. */
export const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Text as a trigger name's words: split at `separators` (a hyphen or underscore), each capitalized, joined by spaces. */
export const titleWords = (text: string, separators: RegExp = /[-_]/): string => text.split(separators).map(capitalized).join(" ");

/** A Cinematic's or trigger scene's id as its triggers' title: "dust-storm_opening" is "Dust Storm Opening". */
export const sceneTitle = (id: string): string => titleWords(id);

/** "Cinematic Fade" in from black (to the scene) or out to it, over `ms`, waiting until it's done or not. */
export function blackFade(path: string, into: boolean, ms: number, wait: boolean): TriggerCall {
  return call(path, F.cinematicFade, {
    direction: { kind: "preset", preset: into ? P.fadeIn : P.fadeOut },
    duration: { kind: "fixed", value: Math.round(ms) / 1000 },
    style: { kind: "preset", preset: P.fadeStyleNormal },
    // The Editor's colour form, alpha first: opaque black, as an Editor-saved map's fades give it.
    color: { kind: "color", value: "255,0,0,0" },
    transparency: { kind: "fixed", value: 0 },
    wait: { kind: "preset", preset: wait ? P.wait : P.dontWait },
  });
}

/** If `trigger` is on, then `calls`: If Then Else on Trigger Is Enabled. */
export function ifTriggerOn(path: string, trigger: TriggerRef, calls: readonly TriggerCall[]): TriggerCall {
  const value: TriggerParam["value"] = { kind: "trigger", trigger };
  return block(path, F.ifThenElse, {}, [
    {
      type: SUB_FUNCTIONS.if,
      calls: [call(`${path}/if`, F.comparison, { left: callValue(`${path}/if/on`, F.triggerIsEnabled, { trigger: value }), operator: { kind: "preset", preset: P.compareEqual }, right: { kind: "bool", value: true } })],
    },
    { type: SUB_FUNCTIONS.then, calls },
  ]);
}

/** `unit` is alive (Unit Is Alive == true), as a condition. */
export const unitIsAlive = (path: string, unit: TriggerParam["value"]): TriggerCall =>
  call(path, F.comparison, { left: callValue(`${path}/alive`, F.unitIsAlive, { unit }), operator: { kind: "preset", preset: P.compareEqual }, right: { kind: "bool", value: true } });

/** If `unit` is alive, then `then`, else `otherwise`: a unit killed, or a Wave's unit not yet sent, has nowhere to be. */
export function ifAlive(path: string, unit: TriggerParam["value"], then: readonly TriggerCall[], otherwise: readonly TriggerCall[] = []): TriggerCall {
  return block(path, F.ifThenElse, {}, [
    { type: SUB_FUNCTIONS.if, calls: [unitIsAlive(`${path}/if`, unit)] },
    { type: SUB_FUNCTIONS.then, calls: [...then] },
    { type: SUB_FUNCTIONS.else, calls: [...otherwise] },
  ]);
}

/**
 * Whether running `calls` may hold up the trigger: a Wait, or any call told to wait (Transmissions,
 * Cinematic Fade, Trigger Execute, Wait For Trigger with the Wait preset), however deep.
 */
export function waits(calls: readonly TriggerCall[]): boolean {
  return calls.some(
    (made) => made.def === F.wait || Object.values(made.params).some((param) => param.value.kind === "preset" && param.value.preset === P.wait) || waits(nestedCalls(made)),
  );
}
