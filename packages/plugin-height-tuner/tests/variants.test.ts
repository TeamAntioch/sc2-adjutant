// The variant words: what a test map's strips are.
import { describe, expect, it } from "vitest";

import { DEFAULT_VARIANTS, parseVariants, variantLabel, variantName, variantSuffix } from "../variants.ts";

describe("parseVariants", () => {
  it("reads the defaults: stock, then the crush and inverted crush at three shares each", () => {
    expect(parseVariants(DEFAULT_VARIANTS).map(variantName)).toEqual(["stock", "crush:15", "crush:25", "crush:40", "inverted-crush:15", "inverted-crush:25", "inverted-crush:40"]);
  });

  it("puts stock first, adding it when it isn't listed", () => {
    expect(parseVariants("crush:25,stock").map(variantName)).toEqual(["stock", "crush:25"]);
    expect(parseVariants("crush:25").map(variantName)).toEqual(["stock", "crush:25"]);
  });

  it("reads a scale and an offset", () => {
    const [, scaled] = parseVariants("crush:25*2+0.3");
    expect(scaled).toEqual({ kind: "crush", share: 0.25, scale: 2, offset: 0.3 });
    expect(variantLabel(scaled!)).toBe("crush 25%, scale 2, offset 0.3");
    expect(variantSuffix(scaled!)).toBe("Crush25S2O0p3");
  });

  it("refuses a crush without its share, a share on another kind, a repeat and more than 7 strips", () => {
    expect(() => parseVariants("crush")).toThrow(/% of the tile/);
    expect(() => parseVariants("flat:20")).toThrow(/only crush/);
    expect(() => parseVariants("crush:25,crush:25")).toThrow(/twice/);
    expect(() => parseVariants("crush:10,crush:20,crush:30,crush:40,crush:50,crush:60,crush:70")).toThrow(/holds 7/);
    expect(() => parseVariants("bumpy")).toThrow(/isn't a variant/);
  });
});
