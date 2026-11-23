// Who owns each part of a package, decided without writing a file (map/ownership-plan.ts).
import { describe, expect, it } from "vitest";

import { BESIDE_KEPT, planOwnership, type PackagePart } from "../../src/map/ownership-plan.js";

const PARTS: readonly PackagePart[] = ["terrain", "pathing", "lightingMap", "mapInfo", "missionData", "doodadCatalogs", "triggers", "componentList"];
const zone = (terrain?: "generate" | "kept") => ({ terrain }) as never;
const plan = (zones: readonly unknown[], melee = false, kept: readonly unknown[] = []) =>
  planOwnership({ blueprint: { id: "m1", zones: zones as never, kept: kept as never }, outputDir: "/pkg", melee });

describe("planOwnership", () => {
  it("compiles a Mission whose Zones all generate its ground whole", () => {
    const compiled = plan([zone()]);
    expect(compiled.mode).toBe("compiled");
    expect(compiled.besideKept).toBe(false);
    expect(PARTS.map((part) => compiled.owner(part))).toEqual(PARTS.map(() => "compile"));
    expect(compiled.keptFiles).toEqual([]);
    expect(compiled.componentListKind).toBe("components");
    expect(compiled.packageRefusal(false, false)).toBeUndefined();
    expect(compiled.triggersRefusal(true, false)).toBeUndefined();
    expect(compiled.writesTriggers(true, false)).toBe(true);
  });

  it("treats a melee map as compiled even with no Zones", () => {
    const melee = plan([], true);
    expect(melee.mode).toBe("melee");
    expect(melee.besideKept).toBe(false);
    expect(melee.owner("terrain")).toBe("compile");
  });

  it("keeps the package's terrain, pathing and data beside Kept ground, and patches what the compile adds", () => {
    for (const beside of [plan([]), plan([zone("kept")]), plan([zone("generate"), zone("kept")])]) {
      expect(beside.mode).toBe("beside-kept");
      expect(beside.owner("pathing")).toBe("package");
      expect(beside.owner("lightingMap")).toBe("package");
      expect(beside.owner("missionData")).toBe("package");
      expect(beside.owner("terrain")).toBe("patch");
      expect(beside.owner("mapInfo")).toBe("patch");
      expect(beside.owner("triggers")).toBe("patch");
      expect(beside.owner("doodadCatalogs")).toBe("patch");
      expect(beside.owner("componentList")).toBe("patch");
      expect(beside.componentListKind).toBe("kept-components");
      expect(beside.keptFiles).toContain("t3HeightMap");
      expect(beside.keptFiles).toContain("MapInfo");
    }
  });

  it("refuses a Kept package without a compile record or a MapInfo, naming why", () => {
    expect(plan([]).packageRefusal(true, true)).toBeUndefined();
    expect(plan([]).packageRefusal(false, true)).toContain("m1 has no Zones, so every terrain cell is Kept Content");
    expect(plan([zone("kept")]).packageRefusal(true, false)).toContain("has Kept terrain beside its Zones");
    expect(plan([zone("kept")]).packageRefusal(true, false)).toContain("/pkg isn't a Map Package with a compile record");
  });

  it("refuses Kept References with no record, only when the compile builds the Mission's triggers", () => {
    const withKept = plan([zone("kept")], false, [{}]);
    expect(withKept.keptReferencesRefusal(true, false)).toContain("has Kept References");
    expect(withKept.keptReferencesRefusal(false, false)).toBeUndefined();
    expect(withKept.keptReferencesRefusal(true, true)).toBeUndefined();
    expect(plan([zone("kept")]).keptReferencesRefusal(true, false)).toBeUndefined();
  });

  it("needs no record for Kept References that each name one of the Blueprint's own triggers", () => {
    const naming = (...editorIds: string[]) => plan([zone()], false, editorIds.map((editorId) => ({ kind: "trigger" as const, editorId })));
    expect(naming("15E66F7A").keptReferencesRefusal(true, false, new Set(["15E66F7A"]))).toBeUndefined();
    expect(naming("15E66F7A", "00000029").keptReferencesRefusal(true, false, new Set(["15E66F7A"]))).toContain("has Kept References");
  });

  it("writes triggers beside Kept ground only when it has any to splice in, and needs a Triggers file for them", () => {
    const beside = plan([]);
    expect(beside.writesTriggers(true, false)).toBe(false);
    expect(beside.writesTriggers(true, true)).toBe(true);
    expect(beside.writesTriggers(false, true)).toBe(false);
    expect(beside.triggersRefusal(true, false)).toContain("/pkg has no Triggers");
    expect(beside.triggersRefusal(true, true)).toBeUndefined();
    expect(beside.triggersRefusal(false, false)).toBeUndefined();
  });

  it("keeps exactly the files the table lists for the parts the compile doesn't own", () => {
    const beside = plan([]);
    const listed = Object.values(BESIDE_KEPT).flatMap((part) => part.files ?? []);
    expect([...beside.keptFiles].sort()).toEqual([...listed].sort());
    expect(new Set(beside.keptFiles).size).toBe(beside.keptFiles.length);
  });

  it("reads every entry of the table: handing a part to the compile changes what the plan derives", () => {
    const input = { blueprint: { id: "m1", zones: [] as never, kept: [] as never }, outputDir: "/pkg", melee: false };
    const base = planOwnership(input);
    for (const part of PARTS) {
      const flipped = planOwnership(input, { ...BESIDE_KEPT, [part]: { owner: "compile" } });
      const derived = (p: ReturnType<typeof planOwnership>) => ({ owner: p.owner(part), keptFiles: p.keptFiles, kind: p.componentListKind, writes: p.writesTriggers(true, false) });
      expect(derived(flipped), part).not.toEqual(derived(base));
    }
    // Each derived output moves with its own entry.
    expect(planOwnership(input, { ...BESIDE_KEPT, componentList: { owner: "compile" } }).componentListKind).toBe("components");
    expect(planOwnership(input, { ...BESIDE_KEPT, triggers: { owner: "compile" } }).writesTriggers(true, false)).toBe(true);
    expect(planOwnership(input, { ...BESIDE_KEPT, pathing: { owner: "compile", files: ["CellAttribute_Pnp"] } }).keptFiles).not.toContain("CellAttribute_Pnp");
  });

  it("holds a Kept trigger only beside Kept ground that has Triggers", () => {
    expect(plan([]).holdsRefusal(true)).toBeUndefined();
    expect(plan([]).holdsRefusal(false)).toContain("holds a Kept trigger");
    expect(plan([zone()]).holdsRefusal(true)).toContain("holds a Kept trigger");
  });
});
