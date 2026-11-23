import { describe, expect, it } from "vitest";

import { followPlan, splineLengths } from "../../src/cutscene/follow-path.js";

describe("a follow path's legs", () => {
  it("measures a straight path's legs as the straight line, however its markers are spaced", () => {
    const lengths = splineLengths([
      [0, 0, 0],
      [400, 0, 0],
      [403, 0, 0],
      [440, 0, 0],
    ]);
    expect(lengths[0]).toBeCloseTo(400, 6);
    expect(lengths[1]).toBeCloseTo(3, 6);
    expect(lengths[2]).toBeCloseTo(37, 6);
  });

  it("measures a bend along the curve the path draws through its markers, a little longer than the straight line", () => {
    const [first, second] = splineLengths([
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ]);
    expect(first).toBeGreaterThan(10.05);
    expect(first).toBeLessThan(11);
    expect(second).toBeGreaterThan(10.05);
  });

  it("covers each leg of a bend in its time, by the curve's length", () => {
    const markers = [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ] as const;
    const { runs, paces } = followPlan(markers[0], [
      { startMs: 0, durationMs: 2000, to: markers[1], move: "linear" },
      { startMs: 2000, durationMs: 1000, to: markers[2], move: "linear" },
    ]);
    const [first, second] = splineLengths(markers);
    expect(runs).toEqual([{ startMs: 0, markers, along: [0, 0, 0] }]);
    expect(paces).toEqual([
      { startMs: 0, endMs: 2000, cellsPerSecond: first! / 2 },
      { startMs: 2000, endMs: 3000, cellsPerSecond: second! },
    ]);
  });

  it("adds no marker for a step that goes nowhere, and holds still through it", () => {
    const { runs, paces } = followPlan(
      [0, 0, 0],
      [
        { startMs: 0, durationMs: 1000, to: [10, 0, 0], move: "linear" },
        { startMs: 1000, durationMs: 1000, to: [10, 0, 0] },
        { startMs: 2000, durationMs: 1000, to: [20, 0, 0], move: "linear" },
      ],
    );
    expect(runs[0]!.markers).toHaveLength(3);
    expect(paces.map((pace) => pace.cellsPerSecond)).toEqual([10, 0, 10]);
  });
});
