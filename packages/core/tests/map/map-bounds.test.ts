// A Mission's playable area (ADR-0015, #529): MapInfo's rectangle, from the Blueprint's `bounds`.
import { describe, expect, it } from "vitest";

import { editorBounds, overhangs, playableBounds, playableMarginWarnings, roundOut } from "../../src/map/map-bounds.js";
import { CrossingBlueprintSchema, crossingRaw } from "../support/workspaces.js";

/** Ashen Crossing (128×128, a Surface Zone over the whole map and five Zones on it), with `edit` applied. */
function crossing(edit: (raw: any) => void = () => {}) {
  const raw = structuredClone(crossingRaw) as any;
  edit(raw);
  return CrossingBlueprintSchema.parse(raw);
}

const small = (raw: any): void => {
  // The Surface becomes backdrop, so the box is round the five Zones on it: (10, 10) to (116, 96).
  raw.zones[0].backdrop = true;
};

describe("the playable area", () => {
  it("is the Editor's inset, 10 / 8 / 10 / 20 in from the left, bottom, right and top", () => {
    expect(editorBounds(128, 96)).toEqual([10, 8, 118, 76]);
  });

  it("by default is the box round the Zones that aren't backdrop, widened by 3 cells, inside the inset", () => {
    expect(playableBounds(crossing(small))).toEqual([10, 8, 118, 99]);
    // The Surface reaches the map's edges, so the inset bounds it.
    expect(playableBounds(crossing())).toEqual([10, 8, 118, 108]);
  });

  it("widens the box by the Blueprint's margin, out to whole cells", () => {
    expect(playableBounds(crossing((raw) => (small(raw), (raw.bounds = { margin: 0 }))))).toEqual([10, 10, 116, 96]);
    expect(playableBounds(crossing((raw) => (small(raw), (raw.bounds = { playable: "zones", margin: 6 }))))).toEqual([10, 8, 118, 102]);
  });

  it("is the inset when asked, or the Blueprint's own rectangle", () => {
    expect(playableBounds(crossing((raw) => (small(raw), (raw.bounds = { playable: "editor" }))))).toEqual([10, 8, 118, 108]);
    expect(playableBounds(crossing((raw) => (raw.bounds = { playable: [4, 4, 124, 124] })))).toEqual([4, 4, 124, 124]);
  });

  it("is the package's own beside Kept terrain unless the Blueprint gives one", () => {
    expect(playableBounds(crossing(), { keptTerrain: true })).toBeUndefined();
    expect(playableBounds(crossing((raw) => (raw.bounds = { playable: [0, 0, 128, 128] })), { keptTerrain: true })).toEqual([0, 0, 128, 128]);
  });

  it("warns that a rectangle nearer the edge than the inset may show the void, and not a derived one", () => {
    const blueprint = crossing((raw) => (raw.bounds = { playable: [4, 8, 118, 120] }));
    const [warning] = playableMarginWarnings(blueprint, playableBounds(blueprint)!);
    expect(warning).toContain("comes 6 cells nearer the left edge, 12 cells nearer the top edge of the map than the Editor's inset");
    expect(playableMarginWarnings(crossing(), playableBounds(crossing())!)).toEqual([]);
  });

  it("refuses a rectangle off the map, in part cells, or with a margin, and \"zones\" with no Zone to draw round", () => {
    const issues = (bounds: unknown, edit: (raw: any) => void = () => {}): string[] => {
      const raw = structuredClone(crossingRaw) as any;
      raw.bounds = bounds;
      edit(raw);
      const result = CrossingBlueprintSchema.safeParse(raw);
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(issues({ playable: [0, 0, 130, 128] })).toEqual(["[0, 0, 130, 128] runs off the 128×128 map"]);
    expect(issues({ playable: [0.5, 0, 128, 128] })).toEqual(["The map's playable area is in whole cells, as MapInfo holds it"]);
    expect(issues({ playable: [10, 0, 5, 128] })).toEqual(["A rectangle is [left, bottom, right, top], with left below right and bottom below top"]);
    expect(issues({ playable: [0, 0, 128, 128], margin: 2 })).toEqual(['A margin widens the box round the Zones, so it goes with a playable area of "zones", not a rectangle']);
    expect(issues({ playable: "editor", margin: 2 })).toEqual(['A margin widens the box round the Zones, so it goes with a playable area of "zones", not "editor"']);
    expect(issues({ margin: 2 })).toEqual([]);
    expect(issues({ margin: 2 }, (raw) => raw.zones.forEach((zone: any) => (zone.terrain = "kept")))).toEqual([
      'A margin widens the box round the Zones, so it goes with a playable area of "zones", not the package\'s own rectangle, which Kept terrain keeps without a playable',
    ]);
    expect(issues({ playable: "zones" }, (raw) => raw.zones.forEach((zone: any) => (zone.backdrop = true)))).toEqual([
      'A playable area of "zones" needs a Zone that isn\'t backdrop to draw the box round: give a rectangle',
    ]);
  });
});

describe("rectangles", () => {
  it("round out to whole or even cells", () => {
    expect(roundOut([1.5, 2.2, 9.1, 10])).toEqual([1, 2, 10, 10]);
    expect(roundOut([1, 3, 9, 10], 2)).toEqual([0, 2, 10, 10]);
  });

  it("say how far one runs past another", () => {
    expect(overhangs([10, 8, 118, 108], [4, 8, 120, 108])).toEqual(["6 cells past the left edge", "2 cells past the right edge"]);
    expect(overhangs([10, 8, 118, 108], [20, 20, 30, 30])).toEqual([]);
  });
});
