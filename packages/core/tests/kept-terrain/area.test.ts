// Area selection for brush edits on Kept ground: a Kept region, a named point with a radius, a
// rectangle or a polygon, resolved to the cells inside and a falloff that fades to nothing.
import { describe, expect, it } from "vitest";

import { type AreaContext, resolveArea } from "../../src/kept-terrain/area.js";

const context: AreaContext = {
  width: 16,
  height: 16,
  regions: [
    { id: 3, name: "Yard", shapes: [{ type: "rect", quad: [2, 2, 6, 5] }, { type: "rect", quad: [4, 2, 5, 3], negative: true }] },
  ],
  points: [{ id: 301, name: "Well", position: { x: 8, y: 8, z: 0 }, yaw: 0, scale: { x: 1, y: 1, z: 1 }, flags: [], extras: [] }],
  kept: [{ id: "yard", kind: "region", editorId: "3" }],
};

/** The cells inside, as "x,y". */
function cellsOf(mask: { width: number; inside: Uint8Array }): string[] {
  return [...mask.inside].flatMap((value, index) => (value ? [`${index % mask.width},${Math.floor(index / mask.width)}`] : []));
}

describe("resolveArea", () => {
  it("takes the cells of a rectangle, with a sharp edge changing only their corners", () => {
    const mask = resolveArea({ rect: { x: 3, y: 4, width: 2, height: 1 }, falloff: 0 }, context);
    expect(cellsOf(mask)).toEqual(["3,4", "4,4"]);
    const weighted = [...mask.vertexWeight].flatMap((weight, index) => (weight > 0 ? [`${index % 17},${Math.floor(index / 17)}:${weight}`] : []));
    expect(weighted).toEqual(["3,4:1", "4,4:1", "5,4:1", "3,5:1", "4,5:1", "5,5:1"]);
  });

  it("takes the cells whose middles lie in a Kept region, by id or Kept Reference, leaving its negative shapes out", () => {
    const expected = ["2,2", "3,2", "5,2", "2,3", "3,3", "4,3", "5,3", "2,4", "3,4", "4,4", "5,4"];
    expect(cellsOf(resolveArea({ region: 3 }, context))).toEqual(expected);
    expect(cellsOf(resolveArea({ region: "yard" }, context))).toEqual(expected);
    expect(cellsOf(resolveArea({ region: "Yard" }, context))).toEqual(expected);
  });

  it("takes the cells round a named point, by name or Editor Id, or round a position", () => {
    const expected = ["7,6", "8,6", "6,7", "7,7", "8,7", "9,7", "6,8", "7,8", "8,8", "9,8", "7,9", "8,9"];
    expect(cellsOf(resolveArea({ point: "Well", radius: 2 }, context))).toEqual(expected);
    expect(cellsOf(resolveArea({ point: 301, radius: 2 }, context))).toEqual(expected);
    expect(cellsOf(resolveArea({ point: { x: 8, y: 8 }, radius: 2 }, context))).toEqual(expected);
  });

  it("takes the cells whose middles lie in a polygon", () => {
    expect(cellsOf(resolveArea({ polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }] }, context))).toEqual(["0,0", "1,0", "2,0", "3,0", "0,1", "1,1", "2,1", "0,2", "1,2", "0,3"]);
  });

  it("fades a soft edge to nothing over three cells, and a given width over that many", () => {
    const soft = resolveArea({ rect: { x: 6, y: 6, width: 2, height: 2 } }, context);
    // Along the row through the area's corner vertices: 1 inside, falling, 0 four vertices out.
    const row = Array.from({ length: 17 }, (_, x) => soft.vertexWeight[6 * 17 + x]!);
    expect(row.slice(6, 9)).toEqual([1, 1, 1]);
    expect(row[9]).toBeGreaterThan(row[10]!);
    expect(row[10]).toBeGreaterThan(row[11]!);
    expect(row[11]).toBeGreaterThan(0);
    expect(row[12]).toBe(0);
    expect(row[2]).toBe(0);
    expect(row[3]).toBeGreaterThan(0);
    const wide = resolveArea({ rect: { x: 6, y: 6, width: 2, height: 2 }, falloff: 5 }, context);
    expect(wide.vertexWeight[6 * 17 + 13]).toBeGreaterThan(0);
    expect(wide.vertexWeight[6 * 17 + 14]).toBe(0);
    // The cells it may change: the area, grown by the falloff and the one cell round its corners.
    expect(soft.reach).toEqual({ x: 2, y: 2, width: 10, height: 10 });
  });

  it("refuses an area off the map, a region or point it can't find, and an empty one", () => {
    expect(() => resolveArea({ region: 9 }, context)).toThrow("no region 9");
    expect(() => resolveArea({ point: "Gate", radius: 2 }, context)).toThrow('no point named "Gate"');
    expect(() => resolveArea({ rect: { x: 20, y: 0, width: 2, height: 2 } }, context)).toThrow("covers no cell of the 16×16 map");
  });
});
