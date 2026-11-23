import { describe, expect, it } from "vitest";

import { cardCamera, COMPASS_FOV, FREE_FOV, needsMeasure, planCardShots } from "../../src/cutscene/card-cameras.js";

describe("a card picture's camera in the game", () => {
  it("takes a free shot's eye and target as they are, with its lens or Blender's default", () => {
    expect(cardCamera({ eye: [1, 2, 3], target: [4, 5, 6] })).toEqual({ eye: [1, 2, 3], target: [4, 5, 6], fov: FREE_FOV });
    expect(cardCamera({ eye: [1, 2, 3], target: [4, 5, 6], fov: 25 })).toEqual({ eye: [1, 2, 3], target: [4, 5, 6], fov: 25 });
  });

  it("stands a compass shot at its point, its height over the recorded floor, looking level the way it names", () => {
    const from = { compass: 1.2, at: [10, 20] as [number, number], floor: 0.5 };
    expect(needsMeasure({ ...from, way: "north" })).toBe(false);
    expect(cardCamera({ ...from, way: "north" })).toEqual({ eye: [10, 20, 1.7], target: [10, 21, 1.7], fov: COMPASS_FOV });
    expect(cardCamera({ ...from, way: "east" })!.target).toEqual([11, 20, 1.7]);
    expect(cardCamera({ ...from, way: "south" })!.target).toEqual([10, 19, 1.7]);
    expect(cardCamera({ ...from, way: "west", fov: 50 })).toEqual({ eye: [10, 20, 1.7], target: [9, 20, 1.7], fov: 50 });
  });

  it("takes what the record leaves out of a compass shot from Blender's measure: the bounds' centre, the floor it guessed", () => {
    const measure = { centre: [3, -4] as const, floor: 2 };
    const noPoint = { compass: 1.2, way: "north" as const, floor: 0 };
    expect(needsMeasure(noPoint)).toBe(true);
    expect(cardCamera(noPoint, measure)).toEqual({ eye: [3, -4, 1.2], target: [3, -3, 1.2], fov: COMPASS_FOV });
    const noFloor = { compass: 1, way: "east" as const, at: [1, 1] as [number, number] };
    expect(needsMeasure(noFloor)).toBe(true);
    expect(cardCamera(noFloor, measure)).toEqual({ eye: [1, 1, 3], target: [2, 1, 3], fov: COMPASS_FOV });
    expect(cardCamera(noPoint)).toBeUndefined();
    expect(cardCamera(noFloor)).toBeUndefined();
  });

  it("has none for a cut, a view, a plan, an orbit, a capture or the set's own camera", () => {
    expect(cardCamera({ eye: [0, 0, 1], target: [1, 0, 1], cut: 3 })).toBeUndefined();
    expect(cardCamera({ compass: 1.2, at: [0, 0], way: "east", floor: 0, cut: 3 })).toBeUndefined();
    expect(cardCamera({ view: "overview" })).toBeUndefined();
    expect(cardCamera({ plan: true })).toBeUndefined();
    expect(cardCamera({ orbit: [135, 40] })).toBeUndefined();
    expect(cardCamera({ capture: "01-wide.jpg" })).toBeUndefined();
    expect(cardCamera({ camera: "s010" })).toBeUndefined();
  });
});

describe("planning a set's card shots", () => {
  const pictures = [
    { file: "card/1.jpg", shows: "the whole room", from: { orbit: [135, 40] as [number, number], cut: 9 } },
    { file: "card/2.jpg", shows: "the bar", from: { eye: [0, 0, 1] as [number, number, number], target: [1, 0, 1] as [number, number, number] } },
    { file: "card/3.jpg", shows: "upstairs", from: { compass: 1.2, way: "south" as const, floor: 4, only: "Upper" } },
    { file: "card/4.jpg", shows: "the door", from: { eye: [2, 2, 1] as [number, number, number], target: [3, 2, 1] as [number, number, number], fov: 30 } },
    { file: "card/5.jpg", shows: "no record" },
  ];

  it("groups the pictures it can film by the pieces they leave out, and says why it skips the rest", () => {
    const plan = planCardShots(pictures, (filter) => (filter.only === "Upper" ? { centre: [5, 5], floor: 0 } : undefined));
    expect(plan.groups).toEqual([
      {
        cameras: [
          { card: "card/2.jpg", eye: [0, 0, 1], target: [1, 0, 1], fov: FREE_FOV },
          { card: "card/4.jpg", eye: [2, 2, 1], target: [3, 2, 1], fov: 30 },
        ],
      },
      { only: "Upper", cameras: [{ card: "card/3.jpg", eye: [5, 5, 5.2], target: [5, 4, 5.2], fov: COMPASS_FOV }] },
    ]);
    expect(plan.skipped.map((entry) => entry.card)).toEqual(["card/1.jpg", "card/5.jpg"]);
    expect(plan.skipped[0]!.why).toMatch(/cut/);
  });

  it("skips a compass picture it has no measure for", () => {
    const plan = planCardShots(pictures, () => undefined);
    expect(plan.groups.flatMap((group) => group.cameras.map((camera) => camera.card))).toEqual(["card/2.jpg", "card/4.jpg"]);
    expect(plan.skipped.find((entry) => entry.card === "card/3.jpg")!.why).toMatch(/measured/);
  });
});
