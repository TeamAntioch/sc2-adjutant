// The research archive's folder (#859): $SC2_RESEARCH_DIR, with no default.
import { describe, expect, it } from "vitest";

import { researchArchiveDir, researchArchiveDirIfSet } from "../../src/capture/research-archive.js";

describe("the research archive's folder", () => {
  it("is SC2_RESEARCH_DIR", () => {
    expect(researchArchiveDir({ SC2_RESEARCH_DIR: "/archive" })).toBe("/archive");
    expect(researchArchiveDirIfSet({ SC2_RESEARCH_DIR: "/archive" })).toBe("/archive");
  });

  it("has no default: unset or empty throws, or is undefined where it's optional", () => {
    for (const env of [{}, { SC2_RESEARCH_DIR: "" }]) {
      expect(() => researchArchiveDir(env)).toThrow(/SC2_RESEARCH_DIR isn't set/);
      expect(researchArchiveDirIfSet(env)).toBeUndefined();
    }
  });
});
