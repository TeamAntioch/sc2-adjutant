import { describe, expect, it } from "vitest";

import { fogLabelOf, isUnexploredAreas, labelOf, MAPINFO_FOG, unexploredAreasOf } from "../../src/domain/unexplored-areas.js";

describe("Unexplored Areas", () => {
  it("maps each Blueprint value to MapInfo's fog string and back", () => {
    expect(MAPINFO_FOG).toEqual({ black: "Black", grey: "Dark", "black-reduced-radius": "BlackNoUnhide" });
    for (const [value, fog] of Object.entries(MAPINFO_FOG)) expect(unexploredAreasOf(fog)).toBe(value);
    expect(unexploredAreasOf("Murky")).toBeUndefined();
  });

  it("names a value as the Editor does, and quotes one it doesn't have, inherited keys included", () => {
    expect(labelOf("black-reduced-radius")).toBe("Black Mask (Reduced Radius)");
    expect(fogLabelOf("Dark")).toBe("Grey Mask");
    expect(fogLabelOf("Murky")).toBe(`"Murky"`);
    expect(isUnexploredAreas("constructor")).toBe(false);
    expect(labelOf("constructor")).toBe(`"constructor"`);
    expect(labelOf(undefined)).toBe("undefined");
  });
});
