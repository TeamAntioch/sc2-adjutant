import { describe, expect, it } from "vitest";

import { nearestBrightness, TARGET_BRIGHTNESS } from "../../src/capture/pick-lighting.js";

describe("nearestBrightness", () => {
  it("picks the frame nearest the target, whichever side it is on", () => {
    expect(TARGET_BRIGHTNESS).toBe(0.14);
    const frames = [{ brightness: 0.56 }, { brightness: 0.05 }, { brightness: 0.16 }, { brightness: 0.1 }];
    expect(nearestBrightness(frames)).toBe(frames[2]);
    expect(nearestBrightness([])).toBeUndefined();
  });
});
