import { describe, expect, it } from "vitest";

import { componentVersionFileName, writeComponentVersion } from "../../src/map/write-component-version.js";

describe("writeComponentVersion", () => {
  it("matches the Objects.version saved by Editor 5.0.17", () => {
    // Objects.version from an Editor-created 128x128 map (build 98310).
    const expected = Buffer.from(
      "63646573626f6c70" + "02000000068001000500000000000000110000000680010001000000" + "5a6cdd6a01000000",
      "hex",
    );
    const actual = writeComponentVersion({ type: "plob", savedAt: new Date(1792896090 * 1000) });
    expect(actual.toString("hex")).toBe(expected.toString("hex"));
  });

  it("rejects component types that are not 4 characters", () => {
    expect(() => writeComponentVersion({ type: "obj" })).toThrow();
  });
});

describe("componentVersionFileName", () => {
  it("replaces the extension, or appends one when there is none", () => {
    expect(componentVersionFileName("t3Terrain.xml")).toBe("t3Terrain.version");
    expect(componentVersionFileName("Objects")).toBe("Objects.version");
  });
});
