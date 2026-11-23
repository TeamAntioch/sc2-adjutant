// The melee distance report's measuring (#216), on grids built to known cell distances: worker
// seconds at 3.9375 cells/s over cell pathing, as Blizzard's ladder maps were
// measured.
import { describe, expect, it } from "vitest";

import { measureMeleeMap, type MeleeGround, WORKER_SPEED } from "../../src/map/melee-distances.js";

const WIDTH = 64;
const HEIGHT = 32;
const LEVEL = 64;

type Draft = { syncCliff: Uint16Array; noPathing: Uint8Array };

function ground(paint: (draft: Draft) => void = () => {}): Omit<MeleeGround, "units"> {
  const draft = { syncCliff: new Uint16Array(WIDTH * HEIGHT).fill(LEVEL), noPathing: new Uint8Array(WIDTH * HEIGHT) };
  paint(draft);
  return { width: WIDTH, height: HEIGHT, bounds: [0, 0, WIDTH, HEIGHT], ...draft };
}

const at = (x: number, y: number): number => y * WIDTH + x;
const seconds = (cells: number): number => cells / WORKER_SPEED;

describe("measureMeleeMap", () => {
  it("times a straight walk between the two starts, town hall to town hall", () => {
    // Each start's walk begins 3.5 cells below its town hall's centre: cells (10, 13) and (50, 13), 40 apart.
    const report = measureMeleeMap({ ...ground(), units: [], starts: [{ x: 10.5, y: 16.5 }, { x: 50.5, y: 16.5 }], bases: [] });
    expect(report.mainToMain.ground.seconds).toBeCloseTo(seconds(40), 1);
    expect(report.mainToMain.ground.rocksDown).toBeUndefined();
    expect(report.mainToMain.air).toBeCloseTo(seconds(40), 1);
  });

  it("goes round a cliff and through a ramp, and times ramp top to ramp top", () => {
    // Mains on level 2 left of x = 14 and right of x = 49, the middle on level 1, joined only by
    // two-cell ramps on rows 12-15. Starts 3 cells inside each main's edge: 43 cells apart, 37 between the ramp tops.
    const report = measureMeleeMap({
      ...ground(({ syncCliff }) => {
        for (let y = 0; y < HEIGHT; y++) {
          for (let x = 0; x < WIDTH; x++) {
            const main = x < 14 || x >= 50;
            const ramp = (x === 14 || x === 15 || x === 48 || x === 49) && y >= 12 && y <= 15;
            // Beside the ramps, a whole level's step from main to middle: a worker can't take it.
            if (main) syncCliff[at(x, y)] = 2 * LEVEL;
            if (ramp) syncCliff[at(x, y)] = LEVEL + 32;
          }
        }
      }),
      units: [],
      starts: [{ x: 10.5, y: 16.5 }, { x: 53.5, y: 16.5 }],
      bases: [],
    });
    expect(report.mainToMain.ground.seconds).toBeCloseTo(seconds(43), 1);
    expect(report.rampToRamp?.seconds).toBeCloseTo(seconds(37), 1);
    expect(report.mains[0]?.rampCells).toBe(8);
  });

  it("gives rocks-up and rocks-down times when a rock sits on the shortest path", () => {
    // A wall down x = 30 with two gaps: rows 12-15, blocked by a 4×4 rock, and rows 28-29 open.
    // Rocks up, the walk detours through the top gap: 2 × (15√2 + 4) + 2 cells. Rocks down, it's straight: 40.
    const report = measureMeleeMap({
      ...ground(({ noPathing }) => {
        for (let y = 0; y < HEIGHT; y++) if (!((y >= 12 && y <= 15) || y === 28 || y === 29)) noPathing[at(30, y)] = 255;
      }),
      units: [{ unitType: "DestructibleRockEx14x4", x: 30, y: 14 }],
      starts: [{ x: 10.5, y: 16.5 }, { x: 50.5, y: 16.5 }],
      bases: [],
    });
    const detour = 2 * (15 * Math.SQRT2 + 4) + 2;
    expect(report.mainToMain.ground.seconds).toBeCloseTo(seconds(detour), 1);
    expect(report.mainToMain.ground.rocksDown).toBeCloseTo(seconds(40), 1);
  });

  it("finds each main's natural and thirds by ground, past mineral footprints", () => {
    // Bases along the row at 8, 16 and about 21 cells' walk from the first start's cell (10, 13); a mineral field blocks the straight line to the farthest.
    const report = measureMeleeMap({
      ...ground(),
      units: [{ unitType: "MineralField", x: 29, y: 13.5 }],
      starts: [{ x: 10.5, y: 16.5 }, { x: 60.5, y: 16.5 }],
      bases: [
        { id: "main", hall: { x: 10.5, y: 16.5 } },
        { id: "natural", hall: { x: 18.5, y: 13.5 } },
        { id: "third", hall: { x: 26.5, y: 13.5 } },
        { id: "fourth", hall: { x: 30.5, y: 13.5 } },
        { id: "main-rot", hall: { x: 60.5, y: 16.5 } },
      ],
    });
    expect(report.mainToNatural).toMatchObject({ base: "natural" });
    expect(report.mainToNatural?.ground.seconds).toBeCloseTo(seconds(8), 1);
    expect(report.mainToThird).toMatchObject({ base: "third" });
    expect(report.mainToThird?.ground.seconds).toBeCloseTo(seconds(16), 1);
    // Round the field (cells 28-29 of row 13), with no corner cutting: 16 along, √2 up, 3 along, 1 down.
    expect(report.secondThird).toMatchObject({ base: "fourth" });
    expect(report.secondThird?.ground.seconds).toBeCloseTo(seconds(20 + Math.SQRT2), 1);
  });
});
