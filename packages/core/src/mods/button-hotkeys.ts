// A command button's hotkey (issue #48, docs/reference/data-rules.md). A button used as a command
// needs a `Button/Hotkey/<key>` line in enUS GameHotkeys.txt, in the mod or its dependencies, or it
// shows and answers no key. The key is the button's merged Hotkey field: Core's class default gives
// every CButton `Button/Hotkey/##id##`, a button may point its own at another key (stock BurrowMove
// has Button/Hotkey/BurrowDown), and a parent's is inherited. buttonHotkeyKey resolves it, for this
// check and for any that needs a button's key (two buttons aliased on one card, #57).
//
// Not backed by an Editor check: that a command button with no line has no key in the game is what
// the stock data suggests (977 of Liberty's 1,324 buttons have none, mostly passives), and the docs
// say what is unconfirmed.

import { readFileSync } from "node:fs";
import path from "node:path";

import { CORE_DATA_DIR } from "../catalog/stock-catalog.js";
import { type FieldValue, isCommentItem, isCommentKey } from "../domain/catalog-fields.js";
import { type GenericEntry, genericEntryKey } from "./generic-entries.js";

/** The prefix of a hotkey's key in GameHotkeys.txt. */
export const HOTKEY_KEY_PREFIX = "Button/Hotkey/";
/** Core's CButton class default's Hotkey: every button's own key, by its id. */
const DEFAULT_HOTKEY = `${HOTKEY_KEY_PREFIX}##id##`;
/** The GameHotkeys.txt whose lines count: the English one, as the stock keys are. */
const HOTKEYS_FILE = /(^|\/)enUS\.SC2Data\/LocalizedData\/GameHotkeys\.txt$/i;

export const BUTTON_HOTKEYS_PATH = path.join(CORE_DATA_DIR, "button-hotkeys.json");

/** What the game's stock data says of hotkeys (data/button-hotkeys.json). */
export type StockHotkeys = {
  /** The keys stock GameHotkeys.txt files have a line for (Button/Hotkey/<key>). */
  readonly keys: ReadonlySet<string>;
  /** The stock buttons with a Hotkey of their own, by id, as the key it names. */
  readonly buttons: ReadonlyMap<string, string>;
};

let stock: StockHotkeys | undefined;

/** The game's stock hotkey keys and the buttons that point at another key, read once; a missing or damaged file is refused, naming how to make it again. */
export function stockHotkeys(): StockHotkeys {
  stock ??= (() => {
    let stored: { readonly keys: readonly string[]; readonly buttons: Readonly<Record<string, string>> };
    try {
      stored = JSON.parse(readFileSync(BUTTON_HOTKEYS_PATH, "utf8")) as typeof stored;
    } catch (error) {
      throw new Error(`${BUTTON_HOTKEYS_PATH} can't be read (${error instanceof Error ? error.message : String(error)}): make it again with node packages/core/scripts/build-button-hotkeys.mjs`);
    }
    return { keys: new Set(stored.keys.map((key) => `${HOTKEY_KEY_PREFIX}${key}`)), buttons: new Map(Object.entries(stored.buttons)) };
  })();
  return stock;
}

/** The text of a field written as a value (`"Hotkey": "x"` or `{ "value": "x" }`), if it is one. */
function textOf(value: FieldValue | undefined): string | undefined {
  const one = Array.isArray(value) ? value.find((item) => !isCommentItem(item)) : value;
  if (typeof one === "string") return one;
  if (typeof one === "object" && one !== null && !Array.isArray(one)) {
    const inner = (one as { readonly value?: FieldValue }).value;
    return typeof inner === "string" ? inner : undefined;
  }
  return undefined;
}

/**
 * The key a Button entry's hotkey is in GameHotkeys.txt, as the game merges it: its own Hotkey, else
 * its parent's (a Blueprint button, else a stock one), else its class default's (the Blueprint's
 * CButton default, else Core's `Button/Hotkey/##id##`), with `##id##` the entry's own id. An empty
 * Hotkey is a button that chose none, so no key. `entries` are the Blueprint's, to find parents.
 */
export function buttonHotkeyKey(entry: GenericEntry, entries: readonly GenericEntry[], stockData: StockHotkeys = stockHotkeys()): string | undefined {
  if (entry.id === undefined) return undefined;
  const buttons = entries.filter((other) => other.catalog === "Button");
  const classDefault = buttons.find((other) => other.id === undefined && other.class === entry.class && other.attributes?.default === "1");
  const seen = new Set<GenericEntry>();
  /** The Hotkey text the entry or its parents write, ## tokens unfilled. */
  const written = (current: GenericEntry | undefined, parent: string | undefined): string | undefined => {
    if (current !== undefined) {
      if (seen.has(current)) return undefined;
      seen.add(current);
      const own = textOf(current.fields.Hotkey);
      if (own !== undefined) return own;
      parent = current.parent;
    }
    if (parent === undefined) return undefined;
    const inBlueprint = buttons.find((other) => other.id === parent);
    return inBlueprint ? written(inBlueprint, undefined) : stockData.buttons.get(parent);
  };
  const text = written(entry, undefined) ?? textOf(classDefault?.fields.Hotkey) ?? DEFAULT_HOTKEY;
  return text === "" ? undefined : text.replaceAll("##id##", entry.id);
}

/** The keys the mod's own hotkey lines give: its entries' and the Blueprint's strings in enUS GameHotkeys.txt, and the lines `kept` (the package's Kept GameHotkeys.txt text) has. */
export function modHotkeyKeys(sources: readonly { readonly entries: readonly GenericEntry[] }[], blueprintStrings: Readonly<Record<string, Readonly<Record<string, string>>>>, kept: readonly string[] = []): Set<string> {
  const keys = new Set<string>();
  const add = (strings: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined): void => {
    for (const [file, lines] of Object.entries(strings ?? {})) if (HOTKEYS_FILE.test(file)) for (const key of Object.keys(lines)) keys.add(key);
  };
  add(blueprintStrings);
  for (const { entries } of sources) for (const entry of entries) add(entry.strings);
  for (const text of kept) for (const line of text.split(/\r?\n/)) keys.add(line.replace(/^﻿/, "").split("=")[0]!.trim());
  return keys;
}

/** The items of a field written once or as an array, comments left out. */
const items = (value: FieldValue | undefined): FieldValue[] => (value === undefined ? [] : (Array.isArray(value) ? [...value] : [value]).filter((item) => !isCommentItem(item)));
const struct = (value: FieldValue | undefined): Readonly<Record<string, FieldValue>> | undefined => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, FieldValue>>) : undefined);

/** Each `LayoutButtons` item anywhere in a field's structure (a CUnit's CardLayouts hold them). */
function layoutButtons(value: FieldValue, out: Readonly<Record<string, FieldValue>>[] = []): Readonly<Record<string, FieldValue>>[] {
  if (Array.isArray(value)) value.forEach((item) => layoutButtons(item, out));
  else if (typeof value === "object" && value !== null) {
    for (const [name, member] of Object.entries(value)) {
      if (isCommentKey(name)) continue;
      if (name === "LayoutButtons") for (const item of items(member)) {
        const button = struct(item);
        if (button) out.push(button);
      }
      else layoutButtons(member, out);
    }
  }
  return out;
}

/** A button the Blueprint's entries use as a command, and where. */
export type CommandButton = { readonly button: string; readonly where: string };

/**
 * The buttons the entries use as commands on a card: the face of a `LayoutButtons` item of type
 * AbilCmd (when it gives none, the DefaultButtonFace of the Blueprint's ability command it names),
 * and the button of a train, build or research ability's `InfoArray` item. A passive button, or a
 * submenu's, isn't one.
 */
export function commandButtons(entries: readonly GenericEntry[]): CommandButton[] {
  const out: CommandButton[] = [];
  const abilities = new Map(entries.filter((entry) => entry.catalog === "Abil" && entry.id !== undefined).map((entry) => [entry.id!, entry]));
  const commandFace = (abilCmd: string): string | undefined => {
    const [abil, command] = abilCmd.split(",");
    for (const item of items(abilities.get(abil ?? "")?.fields.CmdButtonArray)) {
      const one = struct(item);
      if (one && String(one.index) === command && typeof one.DefaultButtonFace === "string") return one.DefaultButtonFace;
    }
    return undefined;
  };
  for (const entry of entries) {
    const name = genericEntryKey(entry);
    for (const field of Object.values(entry.fields)) {
      for (const item of layoutButtons(field)) {
        if (item.Type !== "AbilCmd" || typeof item.AbilCmd !== "string") continue;
        const face = typeof item.Face === "string" ? item.Face : commandFace(item.AbilCmd);
        if (face !== undefined) out.push({ button: face, where: `${name}'s card (${item.AbilCmd})` });
      }
    }
    if (entry.catalog === "Abil" && ["CAbilTrain", "CAbilBuild", "CAbilResearch"].includes(entry.class)) {
      for (const item of items(entry.fields.InfoArray)) {
        const face = struct(struct(item)?.Button)?.DefaultButtonFace;
        if (typeof face === "string") out.push({ button: face, where: `${name}'s InfoArray` });
      }
    }
  }
  return out;
}

/**
 * A warning for each Button the entries write that a card or an ability uses as a command and whose
 * hotkey key has no line: not in `modKeys` (modHotkeyKeys) or the game's stock GameHotkeys.txt. A
 * button the Blueprint doesn't write (a stock or Kept one) isn't checked.
 */
export function missingHotkeyWarnings(
  sources: readonly { readonly from: string; readonly entries: readonly GenericEntry[] }[],
  modKeys: ReadonlySet<string>,
  stockData: StockHotkeys = stockHotkeys(),
): string[] {
  const all = sources.flatMap(({ entries }) => entries);
  const uses = new Map<string, string[]>();
  for (const { button, where } of commandButtons(all)) uses.set(button, [...(uses.get(button) ?? []), where]);
  const out: string[] = [];
  for (const { from, entries } of sources) {
    for (const entry of entries) {
      if (entry.catalog !== "Button" || entry.id === undefined) continue;
      const where = uses.get(entry.id);
      if (where === undefined) continue;
      const key = buttonHotkeyKey(entry, all, stockData);
      if (key === undefined || modKeys.has(key) || stockData.keys.has(key)) continue;
      out.push(
        `${from}: ${genericEntryKey(entry)} is a command button (${[...new Set(where)].join(", ")}) whose hotkey key ${key} has no line in the mod's or the game's enUS GameHotkeys.txt, so it has no hotkey: add "${key}" to the button's strings in enUS.SC2Data/LocalizedData/GameHotkeys.txt, or point its Hotkey at a key that has one`,
      );
    }
  }
  return out;
}
