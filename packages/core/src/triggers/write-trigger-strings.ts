import { nestedCalls, treeOrder, triggerCalls, type TriggerCall, type TriggerDocument } from "./trigger-model.js";

/**
 * Writes a localized strings file (GameStrings.txt, TriggerStrings.txt): BOM, sorted keys, CRLF.
 * Each entry is one `key=value` line, so a key or value with a line break is refused: the format
 * can't hold one (the game's line break in text is `<n/>`).
 */
export function writeStringsFile(entries: Readonly<Record<string, string>>): string {
  const keys = Object.keys(entries).sort();
  for (const key of keys) {
    if (/[\r\n]/.test(key)) throw new Error(`The string key ${JSON.stringify(key)} has a line break, which a strings file's key=value line can't hold`);
    if (/[\r\n]/.test(entries[key]!)) throw new Error(`The string ${key} has a line break in its value (${JSON.stringify(entries[key])}), which a strings file's key=value line can't hold: write <n/> for a line break in game text`);
  }
  return "﻿" + keys.map((key) => `${key}=${entries[key]}\r\n`).join("");
}

/** Trigger, variable and folder display names, for TriggerStrings.txt. */
export function triggerNameStrings(doc: TriggerDocument): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const folder of treeOrder(doc).folders) {
    entries[`Category/Name/${folder.id}`] = folder.name;
  }
  for (const trigger of doc.triggers) {
    entries[`Trigger/Name/${trigger.id}`] = trigger.name;
  }
  for (const variable of doc.variables) {
    entries[`Variable/Name/${variable.id}`] = variable.name;
  }
  return entries;
}

/** Non-empty text parameters, for GameStrings.txt; the Editor omits empty ones. */
export function triggerTextStrings(doc: TriggerDocument): Record<string, string> {
  const entries: Record<string, string> = {};
  const visit = (call: TriggerCall): void => {
    for (const param of Object.values(call.params)) {
      if (param.value.kind === "text" && param.value.text !== "") {
        entries[`Param/Value/${param.id}`] = param.value.text;
      }
    }
    nestedCalls(call).forEach(visit);
  };
  for (const trigger of doc.triggers) {
    triggerCalls(trigger).forEach(visit);
  }
  return entries;
}
