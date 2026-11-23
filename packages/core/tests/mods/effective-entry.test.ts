// An entry as the game sees it (issue #742): merged across layers, with its class default and
// parent chain, tokens filled in, removed elements dropped and its referrers listed. The data is
// synthetic, written in the shape of Blizzard's catalogs.
import { describe, expect, it } from "vitest";

import { type DataLayer, effectiveEntry, type EntryReport, formatEntryReport } from "../../src/mods/effective-entry.js";

const catalog = (...entries: string[]): string => `<?xml version="1.0" encoding="us-ascii"?>\n<Catalog>\n${entries.join("\n")}\n</Catalog>`;

const core: DataLayer = {
  label: "core.sc2mod",
  files: [
    catalog(
      `<CUnit default="1"><Race value="Neut"/><LifeMax value="10"/></CUnit>`,
      `<CUnit id="Biological" default="1"><Attributes index="Biological" value="1"/><Attributes index="Light" value="1"/></CUnit>`,
      `<CUnit id="Marine" parent="Biological"><LifeMax value="45"/><WeaponArray Link="GuassRifle"/><Attributes index="Armored" value="1"/></CUnit>`,
      `<CWeaponLegacy id="GuassRifle"><Range value="5"/></CWeaponLegacy>`,
      `<CUnit id="Trooper" parent="Marine"/>`,
    ),
  ],
};
const void_: DataLayer = {
  label: "void.sc2mod",
  files: [catalog(`<CUnit id="Marine"><LifeMax value="55"/><Attributes index="Light" removed="1"/></CUnit>`)],
};
const mod: DataLayer = {
  label: "mod (Blueprint)",
  files: [catalog(`<CUnit id="Veteran" parent="Marine"><WeaponArray Link="GuassRifle"/><Footnote value="##tag##"/></CUnit>`)],
};

function report(layers: readonly DataLayer[], id: string, cls?: string): EntryReport {
  const found = effectiveEntry(layers, { id, ...(cls ? { class: cls } : {}) });
  if ("refused" in found) throw new Error(found.refused);
  return found;
}
const field = (entry: EntryReport, name: string) => entry.fields.find((one) => one.name === name);

describe("effectiveEntry", () => {
  it("merges a stock unit across layers: a later definition replaces a field and overlays an indexed one, and removed=1 drops its element", () => {
    const marine = report([core, void_], "Marine");
    expect(marine.layers).toEqual(["core.sc2mod", "void.sc2mod"]);
    expect(field(marine, "LifeMax")).toEqual({ name: "LifeMax", from: ["CUnit:Marine in void.sc2mod"], elements: [`<LifeMax value="55"/>`] });
    expect(field(marine, "WeaponArray")?.elements).toEqual([`<WeaponArray Link="GuassRifle"/>`]);
    // Biological's two attributes, Armored added by Marine, Light removed by void.
    expect(field(marine, "Attributes")?.elements).toEqual([`<Attributes index="Biological" value="1"/>`, `<Attributes index="Armored" value="1"/>`]);
    expect(marine.removed).toEqual([{ field: "Attributes", index: "Light", from: "CUnit:Marine in void.sc2mod" }]);
  });

  it("inherits the class default, then the parent chain from the root down, and says where each field came from", () => {
    const trooper = report([core, void_], "Trooper");
    expect(trooper.chain.map((link) => link.id)).toEqual(["Trooper", "Marine", "Biological"]);
    expect(trooper.classDefault).toBe(true);
    expect(field(trooper, "Race")).toEqual({ name: "Race", from: ["CUnit (class default) in core.sc2mod"], elements: [`<Race value="Neut"/>`] });
    expect(field(trooper, "LifeMax")?.from).toEqual(["CUnit:Marine in void.sc2mod"]);
    expect(field(trooper, "Attributes")?.from).toEqual(["CUnit:Biological in core.sc2mod", "CUnit:Marine in core.sc2mod"]);
  });

  it("fills a mod entry's tokens from its own attributes, a template's declared defaults and the entry's id", () => {
    const withTokens: DataLayer = {
      label: "t",
      files: [
        catalog(
          `<CActorModel id="Template" default="1"><?token id="tag" type="Text" value="plain"?><Model value="Assets\\##id##\\##variant##.m3"/><Note value="##tag##"/></CActorModel>`,
          `<CActorModel id="Crate" parent="Template" variant="Big"/>`,
          `<CActorModel id="Barrel" parent="Template" tag="rusty"/>`,
        ),
      ],
    };
    const crate = report([withTokens], "Crate");
    expect(field(crate, "Model")?.elements).toEqual([`<Model value="Assets\\Crate\\Big.m3"/>`]);
    expect(field(crate, "Note")?.elements).toEqual([`<Note value="plain"/>`]);
    expect(report([withTokens], "Barrel").unresolvedTokens).toEqual(["variant"]);
    expect(field(report([withTokens], "Barrel"), "Note")?.elements).toEqual([`<Note value="rusty"/>`]);
    expect(crate.tokens).toMatchObject({ id: "Crate", variant: "Big", tag: "plain" });
  });

  it("reads a Mod entry through Blizzard's parent, and reports what is left of a token nothing fills", () => {
    const veteran = report([core, void_, mod], "Veteran");
    expect(veteran.layers).toEqual(["mod (Blueprint)"]);
    expect(veteran.chain.map((link) => link.id)).toEqual(["Veteran", "Marine", "Biological"]);
    expect(field(veteran, "LifeMax")?.elements).toEqual([`<LifeMax value="55"/>`]);
    expect(field(veteran, "Footnote")?.elements).toEqual([`<Footnote value="##tag##"/>`]);
    expect(veteran.unresolvedTokens).toEqual(["tag"]);
  });

  it("lists who names an entry: children by parent, and fields by a whole attribute value", () => {
    const marine = report([core, void_, mod], "Marine");
    expect(marine.referrers.items.map((one) => `${one.class}:${one.id} ${one.via}`)).toEqual(["CUnit:Trooper parent", "CUnit:Veteran parent"]);
    const rifle = report([core, void_, mod], "GuassRifle");
    expect(rifle.referrers.items).toEqual([
      { class: "CUnit", id: "Marine", via: "WeaponArray@Link", layers: ["core.sc2mod", "void.sc2mod"] },
      { class: "CUnit", id: "Veteran", via: "WeaponArray@Link", layers: ["mod (Blueprint)"] },
    ]);
    expect(report([core, void_, mod], "Marine").referrers.total).toBe(2);
  });

  it("caps the referrers listed and keeps the total", () => {
    const found = effectiveEntry([core, void_, mod], { id: "Marine", referrerLimit: 1 });
    if ("refused" in found) throw new Error(found.refused);
    expect(found.referrers.total).toBe(2);
    expect(found.referrers.items).toHaveLength(1);
    expect(found.notes.join(" ")).toMatch(/2 places name Marine/);
  });

  it("stops at a parent no layer defines, and at a cycle, saying so", () => {
    const odd: DataLayer = { label: "odd", files: [catalog(`<CUnit id="Orphan" parent="Nowhere"><LifeMax value="3"/></CUnit>`, `<CUnit id="A" parent="B"/>`, `<CUnit id="B" parent="A"/>`)] };
    const orphan = report([odd], "Orphan");
    expect(orphan.missingParent).toBe("Nowhere");
    expect(orphan.notes[0]).toMatch(/Nowhere, which no layer defines/);
    expect(report([odd], "A").notes[0]).toMatch(/cycle/);
  });

  it("refuses an id that isn't there, and one two classes share unless the class is named", () => {
    expect(effectiveEntry([core], { id: "Nothing" })).toEqual({ refused: "No entry with the id Nothing in core.sc2mod" });
    const shared: DataLayer = { label: "s", files: [catalog(`<CUnit id="Beacon"/>`, `<CActorUnit id="Beacon"/>`)] };
    expect(effectiveEntry([shared], { id: "Beacon" })).toEqual({ refused: "The id Beacon is defined by more than one class (CUnit, CActorUnit): name the class" });
    expect(report([shared], "Beacon", "CActorUnit").class).toBe("CActorUnit");
    expect(effectiveEntry([shared], { id: "Beacon", class: "CWeapon" })).toEqual({ refused: "No entry of class CWeapon with the id Beacon in s" });
  });

  it("writes a report a reader can follow", () => {
    const text = formatEntryReport(report([core, void_], "Marine"));
    expect(text).toMatch(/^CUnit:Marine, defined in core.sc2mod, void.sc2mod\nInherits: Biological, and the CUnit default\n/);
    expect(text).toContain(`<LifeMax value="55"/>  (CUnit:Marine in void.sc2mod)`);
    expect(text).toContain("Removed: Attributes[Light] by CUnit:Marine in void.sc2mod");
  });
});
