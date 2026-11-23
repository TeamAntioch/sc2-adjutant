// The canonical XML form the Equivalence Check compares, on synthetic XML.
import { describe, expect, it } from "vitest";

import { canonicalXml } from "../../src/util/xml.js";

describe("canonicalXml", () => {
  it("reads a decimal as its value, and keeps an id's digits", () => {
    expect(canonicalXml(`<LifeMax value="400.000000"/>`)).toBe(canonicalXml(`<LifeMax value="400"/>`));
    expect(canonicalXml(`<Item Id="00000001"/>`)).not.toBe(canonicalXml(`<Item Id="1"/>`));
  });

  it("reads a vector of numbers number by number", () => {
    expect(canonicalXml(`<Scale value="1.000000,1.000000,1.000000"/>`)).toBe(canonicalXml(`<Scale value="1,1,1"/>`));
    expect(canonicalXml(`<Position value="12.500000,-3.250000"/>`)).toBe(canonicalXml(`<Position value="12.5,-3.25"/>`));
    expect(canonicalXml(`<Scale value="1,1,1"/>`)).not.toBe(canonicalXml(`<Scale value="1,1,2"/>`));
    // Text with commas is text.
    expect(canonicalXml(`<Name value="Gull, 1.50"/>`)).not.toBe(canonicalXml(`<Name value="Gull, 1.5"/>`));
  });
});
