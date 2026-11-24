// The missing-hotkey check (issue #48, docs/reference/data-rules.md): a button used as a command
// needs a Button/Hotkey line, and buttonHotkeyKey resolves which key that is.
import { afterEach, describe, expect, it } from "vitest";

import { buttonHotkeyKey, commandButtons, missingHotkeyWarnings, modHotkeyKeys, stockHotkeys } from "../../src/mods/button-hotkeys.js";
import { compileMod } from "../../src/mods/compile-mod.js";
import type { GenericEntry } from "../../src/mods/generic-entries.js";
import { cleanupMods, declare, setup } from "./mod-fixture.js";

afterEach(cleanupMods);

const HOTKEYS = "enUS.SC2Data/LocalizedData/GameHotkeys.txt";
const button = (id: string, partial: Partial<GenericEntry> = {}): GenericEntry => ({ catalog: "Button", class: "CButton", id, fields: {}, ...partial });
/** A unit whose card has `face` as a command button. */
const unit = (face: string): GenericEntry => ({
  catalog: "Unit",
  class: "CUnit",
  id: "Crane",
  fields: { CardLayouts: [{ LayoutButtons: [{ Face: face, Type: "AbilCmd", AbilCmd: "move,Move", Row: 0, Column: 0 }] }] },
});
const warn = (list: GenericEntry[], keys: string[] = []): string[] => missingHotkeyWarnings([{ from: "entries/x.json", entries: list }], new Set(keys));

describe("buttonHotkeyKey", () => {
  it("is Core's class default for a button that says nothing, by its own id", () => {
    expect(buttonHotkeyKey(button("Quay"), [])).toBe("Button/Hotkey/Quay");
  });

  it("is the button's own Hotkey, as a value or a plain string", () => {
    expect(buttonHotkeyKey(button("A", { fields: { Hotkey: "Button/Hotkey/Move" } }), [])).toBe("Button/Hotkey/Move");
    expect(buttonHotkeyKey(button("A", { fields: { Hotkey: { value: "Button/Hotkey/Move" } } }), [])).toBe("Button/Hotkey/Move");
  });

  it("inherits a Blueprint parent's, and fills ##id## with the child's own id", () => {
    const parent = button("Base", { fields: { Hotkey: "Button/Hotkey/Shared" } });
    const same = button("Child", { parent: "Base" });
    expect(buttonHotkeyKey(same, [parent, same])).toBe("Button/Hotkey/Shared");
    const templated = button("Base2", { fields: { Hotkey: "Button/Hotkey/##id##Key" } });
    const child = button("Kid", { parent: "Base2" });
    expect(buttonHotkeyKey(child, [templated, child])).toBe("Button/Hotkey/KidKey");
  });

  it("inherits a stock parent's own Hotkey, and the default from a stock parent that has none", () => {
    expect(buttonHotkeyKey(button("Dive", { parent: "BurrowMove" }), [])).toBe("Button/Hotkey/BurrowDown");
    expect(buttonHotkeyKey(button("Dive2", { parent: "Move" }), [])).toBe("Button/Hotkey/Dive2");
  });

  it("takes the Blueprint's CButton default over Core's, and no key for an empty Hotkey", () => {
    const classDefault: GenericEntry = { catalog: "Button", class: "CButton", fields: { Hotkey: "Button/Hotkey/Shared" }, attributes: { default: "1" } };
    expect(buttonHotkeyKey(button("A"), [classDefault])).toBe("Button/Hotkey/Shared");
    expect(buttonHotkeyKey(button("B", { fields: { Hotkey: "" } }), [])).toBeUndefined();
  });
});

describe("commandButtons", () => {
  it("finds a card's AbilCmd faces, and a train, build or research ability's InfoArray buttons, but not a passive", () => {
    const passive: GenericEntry = { catalog: "Unit", class: "CUnit", id: "P", fields: { CardLayouts: { LayoutButtons: { Face: "Passive", Type: "Passive" } } } };
    const train: GenericEntry = { catalog: "Abil", class: "CAbilTrain", id: "T", fields: { InfoArray: [{ index: "Train1", Button: { DefaultButtonFace: "Marine" } }] } };
    expect(commandButtons([unit("Quay"), passive, train]).map(({ button: id }) => id)).toEqual(["Quay", "Marine"]);
  });

  it("takes the face of the ability's command when the card names none", () => {
    const abil: GenericEntry = { catalog: "Abil", class: "CAbilEffectTarget", id: "Dive", fields: { CmdButtonArray: { index: "Execute", DefaultButtonFace: "DiveButton" } } };
    const card: GenericEntry = { catalog: "Unit", class: "CUnit", id: "U", fields: { CardLayouts: { LayoutButtons: { Type: "AbilCmd", AbilCmd: "Dive,Execute" } } } };
    expect(commandButtons([abil, card]).map(({ button: id }) => id)).toEqual(["DiveButton"]);
  });
});

describe("missingHotkeyWarnings", () => {
  it("warns on a command button with no key line, naming the key and the fix", () => {
    const warnings = warn([button("Quay"), unit("Quay")]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CButton:Quay");
    expect(warnings[0]).toContain("Button/Hotkey/Quay");
    expect(warnings[0]).toContain("GameHotkeys.txt");
  });

  it("is quiet once the mod has the line, or the button points at a stock key", () => {
    expect(warn([button("Quay"), unit("Quay")], ["Button/Hotkey/Quay"])).toEqual([]);
    expect(warn([button("Quay", { fields: { Hotkey: "Button/Hotkey/Move" } }), unit("Quay")])).toEqual([]);
    expect(warn([button("Quay", { parent: "BurrowMove" }), unit("Quay")])).toEqual([]);
  });

  it("is quiet for a passive button, and for a button no card or ability uses", () => {
    const passive: GenericEntry = { catalog: "Unit", class: "CUnit", id: "P", fields: { CardLayouts: { LayoutButtons: { Face: "Quay", Type: "Passive" } } } };
    expect(warn([button("Quay"), passive])).toEqual([]);
    expect(warn([button("Quay")])).toEqual([]);
  });

  it("counts the lines of the entries' and the Blueprint's strings and a Kept file", () => {
    const entries = [button("Quay", { strings: { [HOTKEYS]: { "Button/Hotkey/Quay": "Q" } } }), button("Dock"), button("Pier"), unit("Quay"), unit("Dock"), unit("Pier")];
    const keys = modHotkeyKeys([{ entries }], { [HOTKEYS]: { "Button/Hotkey/Dock": "D" } }, ["﻿Button/Hotkey/Pier=P\r\n"]);
    expect(missingHotkeyWarnings([{ from: "x", entries }], keys)).toEqual([]);
    expect([...modHotkeyKeys([{ entries: [button("A", { strings: { "deDE.SC2Data/LocalizedData/GameHotkeys.txt": { "Button/Hotkey/A": "A" } } })] }], {})]).toEqual([]);
  });
});

describe("the stock data", () => {
  it("has the keys and the button that points at another", () => {
    expect(stockHotkeys().keys.has("Button/Hotkey/BurrowDown")).toBe(true);
    expect(stockHotkeys().buttons.get("BurrowMove")).toBe("Button/Hotkey/BurrowDown");
  });
});

describe("compileMod", () => {
  it("warns about a command button with no hotkey line and still compiles", async () => {
    const mod = await setup();
    const entries = [
      { catalog: "Button", class: "CButton", id: "Quay", fields: {} },
      { catalog: "Unit", class: "CUnit", id: "Crane2", fields: { CardLayouts: { LayoutButtons: { Face: "Quay", Type: "AbilCmd", AbilCmd: "move,Move" } } } },
    ];
    await declare(mod, { entries: [{ source: "entries/ButtonData.json" }] }, { "entries/ButtonData.json": `${JSON.stringify(entries)}\n` });
    const { warnings } = await compileMod(mod.blueprintPath);
    expect(warnings.some((warning) => warning.includes("CButton:Quay") && warning.includes("Button/Hotkey/Quay"))).toBe(true);
  });
});
