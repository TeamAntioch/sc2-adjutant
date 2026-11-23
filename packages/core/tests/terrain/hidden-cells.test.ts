// Hidden cells (zone.hiddenCells, #596): the Editor's Hide Terrain brush as a Blueprint field,
// written into t3CellFlags bit 0x4, and moved with its Zone.
import { describe, expect, it } from "vitest";

import { StyleBlueprintSchema } from "../support/workspaces.js";
import { moveZoneEdit } from "../../src/edit/edit-blueprint.js";
import { CELL_FLAG_CLIFF, CELL_FLAG_GROUND, CELL_FLAG_HIDDEN } from "../../src/terrain/cliffs.js";
import { hiddenCellMask, unownedHiddenWarning, writeHiddenBit } from "../../src/terrain/hidden-cells.js";
import { rasterizeTerrain } from "../../src/terrain/rasterize.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A level-1 field with a level-2 catwalk (40-56 × 40-56), whose hidden cells are `hidden`. */
function blueprint(hidden: unknown, catwalk: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "hatch",
    campaignId: "test",
    title: "Hatch",
    setting: "test",
    mapSize: { width: 64, height: 64 },
    tilesetId: "MarSara",
    zones: [
      { id: "field", name: "Field", elevation: 1, landform: "flat", role: "path", polygon: rect(0, 0, 64, 64) },
      { id: "catwalk", name: "Catwalk", elevation: 2, landform: "flat", role: "path", polygon: rect(40, 40, 56, 56), hiddenCells: hidden, ...catwalk },
    ],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    screenplay: { title: "Hatch" },
  };
}
const issues = (raw: Record<string, unknown>): string[] => {
  const result = StyleBlueprintSchema.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("a Zone's hiddenCells", () => {
  it("are whole-cell rectangles inside the map and the Zone", () => {
    expect(issues(blueprint([[47, 47, 2, 1], [48, 48, 1, 1]]))).toEqual([]);
    expect(issues(blueprint([[62, 47, 4, 1]]))).toEqual(["zones.1.hiddenCells.0: Hidden cells [62, 47, 4, 1] reach off the 64×64 map"]);
    expect(issues(blueprint([[47, 47, 1, 1], [38, 47, 3, 1]]))).toEqual(["zones.1.hiddenCells.1: Hidden cell (38, 47) is outside catwalk: list it on the Zone it's in"]);
    expect(issues(blueprint([[47, 47, 0, 1]]))).toHaveLength(1);
  });

  it("are refused on a Zone drawn over Kept ground, which keeps the package's", () => {
    const raw = blueprint([[47, 47, 1, 1]], { terrain: "kept" });
    for (const zone of raw.zones as Record<string, unknown>[]) zone.terrain ??= "generate";
    expect(issues(raw).filter((issue) => issue.includes("hiddenCells"))).toEqual([
      "zones.1.hiddenCells: catwalk is drawn over Kept ground, whose hidden cells stay as the package has them: hide its cells in the Editor, or make the Zone generate",
    ]);
  });

  it("set the hidden bit on a generated map, and only there", () => {
    const terrain = rasterizeTerrain(StyleBlueprintSchema.parse(blueprint([[47, 47, 2, 1]])));
    const hidden = [...terrain.cellFlags.keys()].filter((cell) => terrain.cellFlags[cell]! & CELL_FLAG_HIDDEN);
    expect(hidden).toEqual([47 * 64 + 47, 47 * 64 + 48]);
    // The ground bit stays: hiding isn't the cliff's unpathable bit.
    expect(terrain.cellFlags[47 * 64 + 47]).toBe(CELL_FLAG_GROUND | CELL_FLAG_HIDDEN);
    const plain = rasterizeTerrain(StyleBlueprintSchema.parse(blueprint(undefined)));
    expect(plain.cellFlags.some((flags) => (flags & CELL_FLAG_HIDDEN) !== 0)).toBe(false);
  });

  it("move with their Zone, by whole cells only", () => {
    const { raw: moved } = moveZoneEdit("catwalk", 4, -2)(blueprint([[47, 47, 2, 1]]));
    expect((moved.zones as Record<string, unknown>[])[1]!.hiddenCells).toEqual([[51, 45, 2, 1]]);
    expect(() => moveZoneEdit("catwalk", 4.4, 0)(blueprint([[47, 47, 2, 1]]))).toThrow("Zone catwalk has hiddenCells, which are whole cells: move it by whole cells");
    expect(() => moveZoneEdit("catwalk", 4.4, 0)(blueprint(undefined))).not.toThrow();
  });
});

describe("writing the hidden bit", () => {
  it("sets and clears it on the cells the compile owns, keeps every other bit, and names the hidden cells it can't write", () => {
    const width = 4;
    const flags = Uint8Array.from([0x02, 0x03 | CELL_FLAG_HIDDEN, 0x02 | 0x40, 0x02, 0x02 | CELL_FLAG_HIDDEN, 0x02, 0x02, 0x02]);
    const owned = Uint8Array.from([1, 1, 1, 1, 0, 0, 0, 0]);
    const hidden = Uint8Array.from([1, 0, 1, 0, 0, 1, 0, 0]);
    const out = writeHiddenBit(flags, hidden, owned);
    expect([...out]).toEqual([0x02 | CELL_FLAG_HIDDEN, 0x03, 0x02 | 0x40 | CELL_FLAG_HIDDEN, 0x02, 0x02 | CELL_FLAG_HIDDEN, 0x02, 0x02, 0x02]);
    expect(out[1]! & CELL_FLAG_CLIFF).toBe(CELL_FLAG_CLIFF);
    expect(unownedHiddenWarning(hidden, owned, width)).toBe(
      "1 hidden cell, the first at (1, 1), isn't a generating Zone's to write (only whole 2×2 cliff cells inside it are), so the package's ground there stays as it is: hide it in the Editor, or grow the Zone",
    );
    expect(unownedHiddenWarning(hidden, Uint8Array.from(hidden, () => 1), width)).toBeUndefined();
  });

  it("reads no Kept Zone's cells", () => {
    const mask = hiddenCellMask({ zones: [{ terrain: "kept", hiddenCells: [[0, 0, 1, 1]] }, { terrain: "generate", hiddenCells: [[1, 0, 1, 2]] }] } as never, 2, 2);
    expect([...mask]).toEqual([0, 1, 0, 1]);
  });
});
