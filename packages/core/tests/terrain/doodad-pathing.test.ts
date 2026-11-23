// No-pathing under doodads (src/terrain/doodad-pathing.ts): which doodads paint, their outlines on
// the Editor's sub-cells, the author's paint over them, and the paint sync works out from a layer.
import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import type { DoodadOutlines } from "../../src/catalog/doodad-outlines.js";
import { applyPathingPaint, countSubs, doodadSubCells, hasSub, missingOutlineWarning, paintDoodads, paintsPathing, pathingPaintFrom, type PathingDoodad, subRects } from "../../src/terrain/doodad-pathing.js";

/** An outline of a solid `w` × `h` rectangle centred on the origin, in 0.125-cell pixels. */
function rectangle(w: number, h: number): DoodadOutlines["variations"][number] {
  const width = Math.round(w / 0.125);
  const height = Math.round(h / 0.125);
  return { x: -w / 2, y: -h / 2, width, height, bits: new Uint8Array(width * height).fill(1) };
}
const OUTLINES = new Map<string, DoodadOutlines>([
  // A wall 2 long and half a cell thick; variation 1 has nothing at a unit's height.
  ["Wall", { model: "Wall.m3", variations: [rectangle(2, 0.5), null] }],
]);

const W = 8;
const H = 8;
const wall = (over: Partial<PathingDoodad> = {}): PathingDoodad => ({ id: "piece/Wall/0", type: "Wall", x: 4, y: 4, rotation: 0, scale: 1, variation: 0, ring: "props", pathing: "block", ...over });
/** The sub-cells as (sx, sy) pairs. */
const pairs = (subs: readonly number[]): [number, number][] => subs.map((index) => [index % (W * 2), Math.floor(index / (W * 2))]);

describe("which doodads paint", () => {
  it("paints a set piece's anchor, props and added pieces, and doodad Anchors, of a solid role", () => {
    // Stock doodads with catalog descriptions: a structure, a prop, clutter and a decal.
    expect(paintsPathing({ type: "Aiur_Temple_Bigwalls", ring: "added" }, EMPTY_CATALOG)).toBe(true);
    expect(paintsPathing({ type: "Aiur_Temple_Pillars", ring: "props" }, EMPTY_CATALOG)).toBe(true);
    expect(paintsPathing({ type: "Aiur_Temple_Pillars", ring: "anchor-object" }, EMPTY_CATALOG)).toBe(true);
    expect(paintsPathing({ type: "TempleDebris", ring: "props" }, EMPTY_CATALOG)).toBe(false);
    expect(paintsPathing({ type: "Aiur_Temple_Inlay", ring: "anchor" }, EMPTY_CATALOG)).toBe(false);
  });

  it("leaves clutter and other dressing walkable, unless a piece says block, and walk wins over a solid role", () => {
    expect(paintsPathing({ type: "Aiur_Temple_Pillars", ring: "clutter" }, EMPTY_CATALOG)).toBe(false);
    expect(paintsPathing({ type: "Aiur_Temple_Pillars" }, EMPTY_CATALOG)).toBe(false);
    expect(paintsPathing({ type: "TempleDebris", ring: "clutter", pathing: "block" }, EMPTY_CATALOG)).toBe(true);
    expect(paintsPathing({ type: "Aiur_Temple_Bigwalls", ring: "added", pathing: "walk" }, EMPTY_CATALOG)).toBe(false);
  });
});

describe("a doodad's paint", () => {
  it("covers the sub-cells half under its outline, at its position", () => {
    // 2 wide is 4 sub-cells across; half a cell high is 2 rows.
    expect(pairs(doodadSubCells(wall(), W, H, OUTLINES)!)).toEqual([[6, 15], [7, 15], [8, 15], [9, 15], [6, 16], [7, 16], [8, 16], [9, 16]]);
  });

  it("turns with the doodad, counterclockwise, and scales with it", () => {
    // A quarter turn stands it on end: half a cell across (1 sub-cell), 2 high (8 rows).
    const turned = pairs(doodadSubCells(wall({ rotation: Math.PI / 2, x: 4.25 }), W, H, OUTLINES)!);
    expect(turned.map(([sx]) => sx)).toEqual(Array(8).fill(8));
    expect(turned.map(([, sy]) => sy)).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
    expect(doodadSubCells(wall({ scale: [2, 1, 1] }), W, H, OUTLINES)!.length).toBe(16);
  });

  it("is nothing for a variation with nothing at a unit's height, and unknown for a type with no outline", () => {
    expect(doodadSubCells(wall({ variation: 1 }), W, H, OUTLINES)).toEqual([]);
    expect(doodadSubCells(wall({ type: "Unknown" }), W, H, OUTLINES)).toBeUndefined();
    const { missing, cells } = paintDoodads([wall({ type: "Unknown", variation: 3 }), wall()], W, H, EMPTY_CATALOG, OUTLINES);
    expect([...missing]).toEqual([["Unknown", new Set([3])]]);
    expect(countSubs(cells)).toBe(8);
  });
});

describe("the author's paint", () => {
  const placed = new Map([["piece/Wall/0", { x: 4, y: 4 }]]);

  it("erases and paints rectangles, a doodad's from the sub-cell under its origin", () => {
    const { cells: base } = paintDoodads([wall()], W, H, EMPTY_CATALOG, OUTLINES);
    // Erase the wall's leftmost column (sub-cell 6, 2 left of the origin's 8), paint a cell at the map's corner.
    const { cells, warnings } = applyPathingPaint(base, [{ block: [[0, 0, 1, 1]] }, { doodad: "piece/Wall/0", clear: [[-1, -0.25, 0.5, 0.5]] }], W, H, placed);
    expect(warnings).toEqual([]);
    expect(countSubs(cells)).toBe(8 - 2 + 8);
    expect(hasSub(cells, 15 * 16 + 6, W)).toBe(false);
    expect(hasSub(cells, 15 * 16 + 7, W)).toBe(true);
    expect(cells[0]).toBe(0xff);
  });

  it("leaves out a doodad's paint when it isn't placed, and says so", () => {
    const { cells, warnings } = applyPathingPaint(new Uint8Array(W * H), [{ doodad: "gone", block: [[0, 0, 1, 1]] }], W, H, placed);
    expect(countSubs(cells)).toBe(0);
    expect(warnings[0]).toContain("gone");
  });

  it("is worked out from the Editor's layer so the compile writes that layer again, strokes kept with their doodad", () => {
    const { cells: base, byDoodad } = paintDoodads([wall()], W, H, EMPTY_CATALOG, OUTLINES);
    const editor = Uint8Array.from(base);
    // Erase one of the wall's sub-cells; paint two beside it, and a cell far off.
    editor[3 * W + 4] = editor[3 * W + 4]! & ~0x02;
    editor[4 * W + 5] = editor[4 * W + 5]! | 0x10 | 0x20;
    editor[0] = 0xff;
    const owners = [{ id: "piece/Wall/0", x: 4, y: 4, subs: byDoodad.get("piece/Wall/0")! }];
    const paint = pathingPaintFrom(base, editor, W, H, owners);
    expect(paint.map((entry) => entry.doodad)).toEqual([undefined, "piece/Wall/0"]);
    expect(paint[0]).toEqual({ block: [[0, 0, 1, 1]] });
    expect(applyPathingPaint(base, paint, W, H, placed).cells).toEqual(editor);
    // Moved 2 cells east, the doodad's strokes move with it; the far one stays.
    const moved = paintDoodads([wall({ x: 6 })], W, H, EMPTY_CATALOG, OUTLINES).cells;
    const after = applyPathingPaint(moved, paint, W, H, new Map([["piece/Wall/0", { x: 6, y: 4 }]])).cells;
    expect(countSubs(after)).toBe(countSubs(editor));
    expect(after[0]).toBe(0xff);
    expect(pathingPaintFrom(base, base, W, H, owners)).toEqual([]);
  });

  it("covers sub-cells with the same rectangles each time", () => {
    // Two rows of three, and one more on the row above.
    const subs = [0, 1, 2, 16, 17, 18, 32];
    expect(subRects(subs, W)).toEqual([[0, 0, 3, 2], [0, 2, 1, 1]]);
    expect(subRects([...subs].reverse(), W)).toEqual(subRects(subs, W));
  });
});

describe("the warning for doodads with no outline", () => {
  it("gives the command for a game doodad, and the Editor for one that isn't the game's", () => {
    const warning = missingOutlineWarning(new Map([["Aiur_Temple_Bigwalls", new Set([2])], ["CustomShrine", new Set([0])]]))!;
    expect(warning).toContain("npm run doodad-outlines -- Aiur_Temple_Bigwalls`");
    expect(warning).not.toContain("doodad-outlines -- Aiur_Temple_Bigwalls CustomShrine");
    expect(warning).toContain("CustomShrine isn't a game doodad");
    expect(warning).toContain("paint the pathing under it in the Editor and sync");
  });
});

describe("a raised doodad", () => {
  it("isn't painted standing clear of a unit's height, unless its pathing says block", () => {
    expect(paintsPathing({ type: "Aiur_Temple_Bigwalls", ring: "props", raised: 0.5 }, EMPTY_CATALOG)).toBe(true);
    expect(paintsPathing({ type: "Aiur_Temple_Bigwalls", ring: "props", raised: 2 }, EMPTY_CATALOG)).toBe(false);
    expect(paintsPathing({ type: "Aiur_Temple_Bigwalls", ring: "props", raised: 2, pathing: "block" }, EMPTY_CATALOG)).toBe(true);
  });
});
