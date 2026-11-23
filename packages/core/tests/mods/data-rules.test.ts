// Data rules for a Mod Blueprint's generic entries (docs/reference/data-rules.md): each one is a
// warning that names its fix, since none is confirmed in the Editor yet.
import { afterEach, describe, expect, it } from "vitest";

import { compileMod } from "../../src/mods/compile-mod.js";
import { cleanupMods, declare, setup } from "./mod-fixture.js";

afterEach(cleanupMods);

import { dataRuleWarnings } from "../../src/mods/data-rules.js";
import type { GenericEntry } from "../../src/mods/generic-entries.js";

const entry = (partial: Partial<GenericEntry> & Pick<GenericEntry, "catalog" | "class" | "id">): GenericEntry => ({ fields: {}, ...partial });
const warn = (...list: GenericEntry[]): string[] => dataRuleWarnings([{ from: "entries/x.json", entries: list }]);

describe("per-level arrays", () => {
  it("warns when a child's first level item has no index", () => {
    const warnings = warn(entry({ catalog: "Behavior", class: "CBehaviorVeterancy", id: "HeroVet", parent: "Vet", fields: { VeterancyLevelArray: [{ MinVeterancyXP: 1 }, { MinVeterancyXP: 5 }] } }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('CBehaviorVeterancy:HeroVet');
    expect(warnings[0]).toContain('index="0"');
  });

  it("is quiet once the first item says index 0, or with no parent", () => {
    expect(warn(entry({ catalog: "Behavior", class: "CBehaviorVeterancy", id: "A", parent: "Vet", fields: { VeterancyLevelArray: [{ index: 0, MinVeterancyXP: 1 }] } }))).toEqual([]);
    expect(warn(entry({ catalog: "Behavior", class: "CBehaviorVeterancy", id: "B", fields: { VeterancyLevelArray: [{ MinVeterancyXP: 1 }] } }))).toEqual([]);
  });
});

describe("a copied ability's AbilSetId", () => {
  it("warns on a copy of a class that carries a set id, when it gives none", () => {
    const warnings = warn(entry({ catalog: "Abil", class: "CAbilStop", id: "HeroStop", parent: "stop" }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("AbilSetId");
    expect(warnings[0]).toContain('"Stop"');
  });

  it("is quiet with its own set id, or when it isn't a copy, or of a class with none", () => {
    expect(warn(entry({ catalog: "Abil", class: "CAbilStop", id: "A", parent: "stop", fields: { AbilSetId: "HeroStop" } }))).toEqual([]);
    expect(warn(entry({ catalog: "Abil", class: "CAbilStop", id: "B" }))).toEqual([]);
    expect(warn(entry({ catalog: "Abil", class: "CAbilEffectInstant", id: "C", parent: "x" }))).toEqual([]);
  });

  it("warns on a copy of a Blueprint ability that sets one", () => {
    const warnings = warn(
      entry({ catalog: "Abil", class: "CAbilEffectInstant", id: "Base", fields: { AbilSetId: "Zap" } }),
      entry({ catalog: "Abil", class: "CAbilEffectInstant", id: "Copy", parent: "Base" }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CAbilEffectInstant:Copy");
  });
});

describe("an actor's parent class", () => {
  it("warns when the parent is another class of the Blueprint", () => {
    const warnings = warn(entry({ catalog: "Actor", class: "CActorUnit", id: "Mine", parent: "Base" }), entry({ catalog: "Actor", class: "CActorModel", id: "Base" }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CActorUnit:Mine");
    expect(warnings[0]).toContain("CActorModel");
  });

  it("is quiet for the same class, a class the Blueprint doesn't hold, or a subclass named for its parent's", () => {
    expect(warn(entry({ catalog: "Actor", class: "CActorUnit", id: "A", parent: "B" }), entry({ catalog: "Actor", class: "CActorUnit", id: "B" }))).toEqual([]);
    expect(warn(entry({ catalog: "Actor", class: "CActorUnit", id: "A", parent: "Stock" }))).toEqual([]);
    expect(warn(entry({ catalog: "Actor", class: "CActorRegionQuad", id: "A", parent: "B" }), entry({ catalog: "Actor", class: "CActorRegion", id: "B" }))).toEqual([]);
  });
});

describe("a named CWeapon", () => {
  it("warns, naming CWeaponLegacy", () => {
    const warnings = warn(entry({ catalog: "Weapon", class: "CWeapon", id: "Gun" }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("CWeaponLegacy");
  });

  it("is quiet for CWeaponLegacy and for the class default", () => {
    expect(warn(entry({ catalog: "Weapon", class: "CWeaponLegacy", id: "Gun" }))).toEqual([]);
    expect(warn({ catalog: "Weapon", class: "CWeapon", fields: {}, attributes: { default: "1" } })).toEqual([]);
  });
});

describe("compileMod", () => {
  it("reports a data rule as a warning and still compiles", async () => {
    const mod = await setup();
    await declare(
      mod,
      { entries: [{ source: "entries/WeaponData.json" }] },
      { "entries/WeaponData.json": `${JSON.stringify([{ catalog: "Weapon", class: "CWeapon", id: "Gun", fields: {} }])}\n` },
    );
    const { warnings } = await compileMod(mod.blueprintPath);
    expect(warnings.some((warning) => warning.includes("CWeapon:Gun") && warning.includes("CWeaponLegacy"))).toBe(true);
  });
});
