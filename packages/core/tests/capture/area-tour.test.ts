// The tour planner for an in-game capture of an edited area (#254): one high view that frames the
// whole area, then two or three at the player's angle. Checked on the cameras' ground footprints,
// with no game.
import { describe, expect, it } from "vitest";

import { cameraFootprint, fitRect, framesDisc, framesRect, PLAYER_CAMERA, planAreaTour, type TourView } from "../../src/capture/area-tour.js";
import { containsPoint } from "../../src/terrain/rasterize.js";

const BOUNDS = [0, 0, 256, 256] as const;
const corners = (r: { x: number; y: number; width: number; height: number }) => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x, y: r.y + r.height },
  { x: r.x + r.width, y: r.y + r.height },
];
const inside = (view: TourView, r: { x: number; y: number; width: number; height: number }) =>
  view.target[0] >= r.x && view.target[0] <= r.x + r.width && view.target[1] >= r.y && view.target[1] <= r.y + r.height;

describe("cameraFootprint", () => {
  it("is the player's familiar view: about 26 cells wide at the bottom, 36 at the top and 21 deep, ahead of the camera", () => {
    const [nearLeft, nearRight, farRight, farLeft] = cameraFootprint({ target: [100, 100], ...PLAYER_CAMERA, yawOffset: 0 });
    expect(nearRight!.x - nearLeft!.x).toBeCloseTo(25.6, 0);
    expect(farRight!.x - farLeft!.x).toBeCloseTo(35.9, 0);
    expect(farLeft!.y - nearLeft!.y).toBeCloseTo(20.9, 0);
    // The camera looks north: its target sits a little south of the middle of what it sees.
    expect(nearLeft!.y).toBeLessThan(100);
    expect(farLeft!.y).toBeGreaterThan(100);
  });

  it("grows with the distance and turns with the yaw", () => {
    const near = cameraFootprint({ target: [0, 0], ...PLAYER_CAMERA, yawOffset: 0 });
    const far = cameraFootprint({ target: [0, 0], ...PLAYER_CAMERA, distance: PLAYER_CAMERA.distance * 2, yawOffset: 0 });
    near.forEach((corner, i) => {
      expect(far[i]!.x).toBeCloseTo(corner.x * 2, 6);
      expect(far[i]!.y).toBeCloseTo(corner.y * 2, 6);
    });
    const turned = cameraFootprint({ target: [0, 0], ...PLAYER_CAMERA, yawOffset: 90 });
    turned.forEach((corner, i) => expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(Math.hypot(near[i]!.x, near[i]!.y), 6));
    expect(turned.map((corner) => corner.x)).not.toEqual(near.map((corner) => corner.x));
  });
});

describe("planAreaTour", () => {
  it("frames a small area: a high view over it with a margin, then the player's view and one turned each way", () => {
    const area = { x: 52, y: 36, width: 10, height: 10 };
    const views = planAreaTour(area, BOUNDS);
    expect(views.map((view) => view.label)).toEqual(["high", "player", "player-yaw-45", "player-yaw+45"]);
    const [high, ...player] = views;
    expect(high!.pitch).toBeGreaterThan(PLAYER_CAMERA.pitch);
    expect(framesRect(high!, { x: 50, y: 34, width: 14, height: 14 })).toBe(true);
    for (const view of player) {
      expect([view.distance, view.pitch]).toEqual([PLAYER_CAMERA.distance, PLAYER_CAMERA.pitch]);
      expect(framesDisc(view, [57, 41], Math.hypot(5, 5))).toBe(true);
    }
    expect(framesRect(player[0]!, area)).toBe(true);
    expect(player.map((view) => view.yawOffset)).toEqual([0, -45, 45]);
  });

  it("frames a brush's whole reach from high up, and the area itself at the player's angle", () => {
    const area = { x: 16, y: 60, width: 8, height: 8 };
    const reach = { x: 12, y: 56, width: 16, height: 16 };
    const views = planAreaTour(area, BOUNDS, reach);
    expect(views.map((view) => view.label)).toEqual(["high", "player", "player-yaw-45", "player-yaw+45"]);
    expect(framesRect(views[0]!, { x: 10, y: 54, width: 20, height: 20 })).toBe(true);
    expect(framesRect(planAreaTour(area, BOUNDS)[0]!, { x: 10, y: 54, width: 20, height: 20 })).toBe(false);
    for (const view of views.slice(1)) expect(framesDisc(view, [20, 64], Math.hypot(4, 4))).toBe(true);
  });

  it("spreads the player's views along an area too long for one, so together they cover it", () => {
    const area = { x: 20, y: 100, width: 70, height: 12 };
    const views = planAreaTour(area, BOUNDS);
    expect(views.map((view) => view.label)).toEqual(["high", "player-1", "player-2", "player-3"]);
    expect(framesRect(views[0]!, area)).toBe(true);
    const player = views.slice(1);
    for (const view of player) {
      expect(view.yawOffset).toBe(0);
      expect(inside(view, area)).toBe(true);
    }
    // West to east, each over its third of the area.
    expect(player.map((view) => view.target[0])).toEqual([...player.map((view) => view.target[0])].sort((a, b) => a - b));
    for (const [i, view] of player.entries()) expect(framesRect(view, { x: 20 + (70 / 3) * i, y: 100, width: 70 / 3, height: 12 })).toBe(true);
  });

  it("goes south to north along a tall area, with two views when two cover it", () => {
    const area = { x: 100, y: 40, width: 10, height: 34 };
    const views = planAreaTour(area, BOUNDS);
    expect(views.map((view) => view.label)).toEqual(["high", "player-1", "player-2"]);
    const [, south, north] = views;
    expect(south!.target[1]).toBeLessThan(north!.target[1]);
    expect(framesRect(south!, { x: 100, y: 40, width: 10, height: 17 })).toBe(true);
    expect(framesRect(north!, { x: 100, y: 57, width: 10, height: 17 })).toBe(true);
  });

  it("splits an area to fit the player's wide, shallow view: a 24×22 area into strips one behind another", () => {
    const area = { x: 100, y: 100, width: 24, height: 22 };
    const views = planAreaTour(area, BOUNDS);
    expect(views.map((view) => view.label)).toEqual(["high", "player-1", "player-2"]);
    const [, south, north] = views;
    expect(south!.target[1]).toBeLessThan(north!.target[1]);
    expect(south!.target[0]).toBe(north!.target[0]);
    expect(framesRect(south!, { x: 100, y: 100, width: 24, height: 11 })).toBe(true);
    expect(framesRect(north!, { x: 100, y: 111, width: 24, height: 11 })).toBe(true);
    expect(views.every((view) => view.whole)).toBe(true);
  });

  it("still frames a large area from high up, with three player's views inside it", () => {
    const area = { x: 10, y: 10, width: 120, height: 90 };
    const views = planAreaTour(area, BOUNDS);
    expect(views).toHaveLength(4);
    expect(framesRect(views[0]!, area)).toBe(true);
    for (const corner of corners(area)) expect(containsPoint(cameraFootprint(views[0]!), corner)).toBe(true);
    for (const view of views.slice(1)) expect(inside(view, area)).toBe(true);
  });

  it("says when a view shows only part of its ground: an area too long for three views, or one at the map's edge", () => {
    const strip = planAreaTour({ x: 10, y: 100, width: 150, height: 6 }, BOUNDS);
    expect(strip.map((view) => [view.label, view.whole])).toEqual([["high", true], ["player-1", false], ["player-2", false], ["player-3", false]]);
    expect(planAreaTour({ x: 52, y: 36, width: 10, height: 10 }, BOUNDS).every((view) => view.whole)).toBe(true);
    const edge = planAreaTour({ x: 0, y: 0, width: 6, height: 6 }, [20, 20, 236, 236]);
    expect(edge.find((view) => view.label === "player")!.whole).toBe(false);
  });

  it("keeps every camera target inside the map's camera bounds", () => {
    const views = planAreaTour({ x: 0, y: 0, width: 6, height: 6 }, [4, 4, 252, 252]);
    for (const view of views) {
      expect(view.target[0]).toBeGreaterThanOrEqual(4);
      expect(view.target[1]).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("fitRect", () => {
  it("frames a bigger rectangle from farther away", () => {
    const small = fitRect({ x: 100, y: 100, width: 20, height: 20 }, { pitch: 75, yawOffset: 0 }, BOUNDS);
    const big = fitRect({ x: 80, y: 80, width: 60, height: 60 }, { pitch: 75, yawOffset: 0 }, BOUNDS);
    expect(big.distance).toBeGreaterThan(small.distance);
    expect([small.whole, big.whole]).toEqual([true, true]);
  });

  it("frames the whole rectangle at 45°, 60° and 75° pitch, and turned 30°", () => {
    const rect = { x: 100, y: 120, width: 40, height: 24 };
    for (const [pitch, yawOffset] of [[45, 0], [60, 0], [75, 0], [60, 30]] as const) {
      const camera = fitRect(rect, { pitch, yawOffset }, BOUNDS);
      expect([camera.pitch, camera.yawOffset, camera.whole]).toEqual([pitch, yawOffset, true]);
      for (const corner of corners(rect)) expect(containsPoint(cameraFootprint(camera), corner)).toBe(true);
      // The nearest such camera: a cell closer, the same aim misses a corner.
      expect(framesRect({ ...camera, distance: camera.distance - 1 }, rect)).toBe(false);
    }
    // A lower camera sits farther back: its target is south of the rectangle's middle.
    expect(fitRect(rect, { pitch: 45, yawOffset: 0 }, BOUNDS).target[1]).toBeLessThan(fitRect(rect, { pitch: 75, yawOffset: 0 }, BOUNDS).target[1]);
  });

  it("stops at 400, and says a rectangle too big for that isn't whole", () => {
    const camera = fitRect({ x: 0, y: 0, width: 400, height: 400 }, { pitch: 45, yawOffset: 0 }, [0, 0, 400, 400]);
    expect(camera.distance).toBe(400);
    expect(camera.whole).toBe(false);
  });

  it("keeps the target inside the camera bounds, and says a rectangle that then falls outside the frame isn't whole", () => {
    const rect = { x: 0, y: 0, width: 12, height: 12 };
    const free = fitRect(rect, { pitch: 75, yawOffset: 0 }, BOUNDS);
    expect(free.whole).toBe(true);
    const clamped = fitRect(rect, { pitch: 75, yawOffset: 0 }, [20, 20, 236, 236]);
    expect(clamped.target).toEqual([20, 20]);
    expect(clamped.whole).toBe(false);
  });
});
