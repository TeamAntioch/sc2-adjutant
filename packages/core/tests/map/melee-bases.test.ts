// The standard melee start base (#215), against the melee research's template (§1 "The standard
// base template") and Blizzard's town-hall rule (§0 "Town hall spots", `NearResources`).
import { describe, expect, it } from "vitest";

import { DIAGONAL_FACINGS } from "../../src/domain/melee-map-blueprint.js";
import { meleeBasePieces, meleeTownHallSpot, nearResourcesCells, offCorner, resourceGap } from "../../src/map/melee-bases.js";

const HALL = { x: 40.5, y: 60.5 };

describe("the standard melee base", () => {
  it("lays out the research's commonest ladder start layout, facing south-west", () => {
    const offsets = meleeBasePieces(HALL, "south-west").map((piece) => [piece.unitType, piece.x - HALL.x, piece.y - HALL.y]);
    expect(offsets).toEqual([
      ["MineralField", -6.5, -2],
      ["MineralField", -6.5, 0],
      ["MineralField", -2.5, -6],
      ["MineralField", 0.5, -6],
      ["MineralField750", -7.5, -1],
      ["MineralField750", -6.5, -4],
      ["MineralField750", -5.5, -5],
      ["MineralField750", -0.5, -7],
      ["VespeneGeyser", -7, 3],
      ["VespeneGeyser", 4, -7],
    ]);
  });

  it("mirrors the layout onto each diagonal, keeping every piece on its footprint's grid", () => {
    const southWest = meleeBasePieces(HALL, "south-west");
    const signs = { "south-west": [1, 1], "south-east": [-1, 1], "north-west": [1, -1], "north-east": [-1, -1] } as const;
    for (const facing of DIAGONAL_FACINGS) {
      const [sx, sy] = signs[facing];
      const pieces = meleeBasePieces(HALL, facing);
      expect(pieces.map((piece) => [piece.x - HALL.x, piece.y - HALL.y])).toEqual(southWest.map((piece) => [sx * (piece.x - HALL.x) + 0, sy * (piece.y - HALL.y) + 0]));
      for (const piece of pieces) {
        // 2×1 minerals centre on (whole, .5); 3×3 geysers on (.5, .5).
        const geyser = piece.unitType.endsWith("Geyser");
        expect([piece.x % 1, piece.y % 1]).toEqual(geyser ? [0.5, 0.5] : [0, 0.5]);
      }
    }
  });

  it("stands geysers exactly 3 cells from the town hall's footprint and minerals 3 or 4, or 2 at a cut corner", () => {
    for (const variant of [{}, { minerals: "rich" }, { gas: "rich" }, { gas: "one-rich" }] as const) {
      for (const facing of DIAGONAL_FACINGS) {
        for (const piece of meleeBasePieces(HALL, facing, variant)) {
          const gap = resourceGap(HALL, piece);
          if (piece.unitType.endsWith("Geyser")) expect(gap, `${facing} ${piece.label}`).toBe(3);
          else expect([2, 3, 4], `${facing} ${piece.label}`).toContain(gap);
          // 2 only off a corner of the hall, where the ring's corner cell is cut.
          if (gap === 2) expect(offCorner(HALL, piece), `${facing} ${piece.label}`).toBe(true);
        }
      }
    }
  });

  it("has a gold variant of 6 rich patches and 2 geysers, and rich-gas ones of 8 patches and 1 or 2 rich geysers", () => {
    const types = (variant: Parameters<typeof meleeBasePieces>[2]) => meleeBasePieces(HALL, "south-west", variant).map((piece) => piece.unitType);
    expect(types({ minerals: "rich" })).toEqual([
      ...Array(3).fill("RichMineralField"),
      ...Array(3).fill("RichMineralField750"),
      "VespeneGeyser",
      "VespeneGeyser",
    ]);
    expect(types({ gas: "rich" })).toEqual([...Array(4).fill("MineralField"), ...Array(4).fill("MineralField750"), "RichVespeneGeyser", "RichVespeneGeyser"]);
    expect(types({ gas: "one-rich" })).toEqual([...Array(4).fill("MineralField"), ...Array(4).fill("MineralField750"), "RichVespeneGeyser"]);
  });
});

describe("the town-hall rule (NearResources)", () => {
  it("finds the base's own town-hall spot for every facing and variant", () => {
    for (const variant of [{}, { minerals: "rich" }, { gas: "rich" }, { gas: "one-rich" }] as const) {
      for (const facing of DIAGONAL_FACINGS) {
        expect(meleeTownHallSpot(meleeBasePieces(HALL, facing, variant)), `${facing} ${JSON.stringify(variant)}`).toEqual(HALL);
      }
    }
  });

  it("rings each resource 3 cells out with the corner cells cut, and the hall's 5×5 stays clear of it", () => {
    const ring = nearResourcesCells(meleeBasePieces(HALL, "south-west"));
    const hallCells = (x: number, y: number) => Array.from({ length: 25 }, (_, index) => `${Math.floor(x) - 2 + (index % 5)},${Math.floor(y) - 2 + Math.floor(index / 5)}`);
    expect(hallCells(HALL.x, HALL.y).filter((cell) => ring.has(cell))).toEqual([]);
    // A cell closer to the minerals on either axis overlaps it.
    expect(hallCells(HALL.x - 1, HALL.y).some((cell) => ring.has(cell))).toBe(true);
    expect(hallCells(HALL.x, HALL.y - 1).some((cell) => ring.has(cell))).toBe(true);
    // A geyser's 3×3 at (33.5, 63.5) rings cells 29-37 × 59-67 less the four corners.
    const geyserRing = nearResourcesCells([{ unitType: "VespeneGeyser", x: 33.5, y: 63.5 }]);
    expect(geyserRing.size).toBe(9 * 9 - 4);
    expect([geyserRing.has("29,59"), geyserRing.has("30,59"), geyserRing.has("37,67")]).toEqual([false, true, false]);
  });

  it("keeps the town hall on flat buildable ground", () => {
    const pieces = meleeBasePieces(HALL, "south-west");
    // Only cells from x = 39 east are buildable: the best spot is pushed east, off the template's.
    const spot = meleeTownHallSpot(pieces, { buildable: (x) => x >= 39 });
    expect(spot).toBeDefined();
    expect(spot!.x).toBeGreaterThan(HALL.x);
    // Nor across two levels.
    expect(meleeTownHallSpot(pieces, { level: (_, y) => (y >= HALL.y ? 1 : 0) })).not.toEqual(HALL);
    expect(meleeTownHallSpot(pieces, { buildable: () => false })).toBeUndefined();
  });
});
