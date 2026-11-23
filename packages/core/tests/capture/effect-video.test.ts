// The effect tour's video (capture/effect-video.ts): reading the recording's timeline, placing each
// effect in it, and picking the frames that changed most.
import { describe, expect, it } from "vitest";

import type { EffectShot } from "../../src/capture/effect-tour.js";
import { BASE_AFTER_MARK, changeScores, effectSegments, parseVideoStops, pickPeaks } from "../../src/capture/effect-video.js";

const shot = (stop: number, effect: number, label: EffectShot["label"]): EffectShot => ({ stop, effect, file: `Assets/Effects/E${effect}.m3`, label });

describe("parseVideoStops", () => {
  it("reads stops and marks, keeping each one's first time and skipping lines it can't read", () => {
    const timeline = parseVideoStops("m1 2.000\n1 2.700\n2 4.100\n2 4.300\nm2 9.5\nnonsense\n\n");
    expect([...timeline.stops]).toEqual([
      [1, 2.7],
      [2, 4.1],
    ]);
    expect([...timeline.marks]).toEqual([
      [1, 2],
      [2, 9.5],
    ]);
  });
});

describe("effectSegments", () => {
  const shots = [shot(1, 0, "birth"), shot(2, 0, "stand"), shot(3, 0, "moving"), shot(4, 0, "after-destroy"), shot(5, 1, "stand"), shot(6, 1, "after-destroy")];

  it("bases each effect just after its mark, searches up to its stand frame, and clips to the next effect", () => {
    const timeline = parseVideoStops("m1 2\n1 3\n2 5\n3 8\n4 10\nm2 13\n5 14\n6 16\n");
    const [first, second] = effectSegments(shots, timeline, 1.5);
    expect(first).toEqual({ effect: 0, base: 2 + BASE_AFTER_MARK, searchEnd: 5, end: 13 + BASE_AFTER_MARK });
    // The last effect's clip runs past its last stop by the frame's hold.
    expect(second).toEqual({ effect: 1, base: 13 + BASE_AFTER_MARK, searchEnd: 14, end: 16 + 1.5 });
  });

  it("leaves out an effect none of whose stops were timed", () => {
    expect(effectSegments(shots, parseVideoStops("m1 2\nm2 13\n5 14\n"), 1.5).map((each) => each.effect)).toEqual([1]);
  });

  it("without marks, bases an effect in the reset after the previous one's last frame, and the first by its lead-in", () => {
    // Stops only: a recording made without marks.
    const timeline = parseVideoStops("1 10\n2 12\n3 15\n4 17\n5 22\n6 25\n");
    const [first, second] = effectSegments(shots, timeline, 1.5, () => 0.6);
    expect(first!.base).toBeCloseTo(10 - 0.6 - 0.25);
    expect(first!.searchEnd).toBe(12);
    // After stop 4's frame is held 1.5 s, half way through the 0.5 s reset.
    expect(second!.base).toBeCloseTo(17 + 1.5 + 0.25);
    expect(first!.end).toBeCloseTo(second!.base);
  });
});

describe("pickPeaks", () => {
  it("takes the highest frames, at least the gap apart, in time order, and none under the floor", () => {
    const scores = [0, 1, 9, 10, 8, 0, 0, 7, 0, 3];
    expect(pickPeaks(scores, 3, 3, 2)).toEqual([3, 7]);
    expect(pickPeaks(scores, 2, 1)).toEqual([2, 3]);
    expect(pickPeaks([0.5, 1, 0.2], 4, 1, 1.5)).toEqual([]);
  });
});

describe("changeScores", () => {
  it("scores each frame by the percentage of its pixels that changed past the threshold from the first", () => {
    const frames = new Uint8Array([10, 10, 10, 10, 20, 0, 10, 10, 60, 200, 10, 30]);
    expect(changeScores(frames, 2, 16)).toEqual([0, 0, 0, 0, 100, 50]);
  });
});
