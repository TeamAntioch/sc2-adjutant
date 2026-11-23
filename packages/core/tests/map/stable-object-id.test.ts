import { describe, expect, it } from "vitest";

import { stableObjectId } from "../../src/map/stable-object-id.js";

describe("stableObjectId", () => {
  it("is deterministic", () => {
    expect(stableObjectId("hero_zeratul")).toBe(stableObjectId("hero_zeratul"));
  });

  it("produces positive signed 32-bit ids", () => {
    const id = stableObjectId("hero_zeratul");
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThanOrEqual(0x7fffffff);
    expect(Number.isInteger(id)).toBe(true);
  });

  it("differs for different slugs", () => {
    expect(stableObjectId("hero_zeratul")).not.toBe(stableObjectId("hero_nova"));
  });
});
