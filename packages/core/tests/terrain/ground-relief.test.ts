import { describe, expect, it } from "vitest";
import { GROUND_RELIEF, groundRelief } from "../../src/terrain/ground-relief.js";

const SIZE = 64;
const sample = (relief: (x: number, y: number) => number) => {
  let most = 0;
  let step = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      most = Math.max(most, Math.abs(relief(x, y)));
      step += Math.abs(relief(x + 1, y) - relief(x, y)) + Math.abs(relief(x, y + 1) - relief(x, y));
    }
  }
  return { most, meanStep: step / (2 * SIZE * SIZE) };
};

describe("groundRelief", () => {
  it("rolls smoothly within its reach: a vertex sits close to its neighbours", () => {
    const { most, meanStep } = sample(groundRelief());
    expect(most).toBeLessThanOrEqual(GROUND_RELIEF);
    // The ground does rise and fall, but a random height per vertex would step 0.2 on average.
    expect(most).toBeGreaterThan(GROUND_RELIEF / 2);
    expect(meanStep).toBeLessThan(0.04);
  });

  it("keeps to a melee map's rotation, with no seam between the sides", () => {
    const symmetry = { centre: { x: 32, y: 32 }, zonePartners: new Map(), rotatedFrom: new Map() };
    const relief = groundRelief(symmetry);
    for (let y = 0; y <= SIZE; y++) for (let x = 0; x <= SIZE; x++) expect(relief(x, y)).toBe(relief(SIZE - x, SIZE - y));
    expect(sample(relief).meanStep).toBeLessThan(0.04);
  });
});
