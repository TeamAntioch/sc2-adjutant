// The compile-map CLI's arguments: the Blueprint, an optional output folder, and the author's
// decisions on Compiled Content changed in the Editor (#242).
import { describe, expect, it } from "vitest";

import { parseCompileMapArgs } from "../../src/cli/compile-map-args.js";

describe("compile-map's arguments", () => {
  it("take the Blueprint, an output folder, and repeated --keep and --discard", () => {
    expect(parseCompileMapArgs(["m/blueprint.json", "--keep", "object:1", "out.SC2Map", "--discard", "region:2", "--keep", "trigger:0A1B2C3D"])).toEqual({
      blueprintPath: "m/blueprint.json",
      outputDir: "out.SC2Map",
      decisions: { keep: ["object:1", "trigger:0A1B2C3D"], discard: ["region:2"] },
    });
  });

  it("take --keep-all or --discard-all, beside entries that override them", () => {
    expect(parseCompileMapArgs(["b.json", "--discard-all", "--keep", "object:1"])).toEqual({ blueprintPath: "b.json", decisions: { keep: ["object:1"], discard: "all" } });
    expect(parseCompileMapArgs(["b.json", "--keep-all"])).toEqual({ blueprintPath: "b.json", decisions: { keep: "all" } });
    expect(parseCompileMapArgs(["b.json"])).toEqual({ blueprintPath: "b.json", decisions: {} });
  });

  it("refuse --keep-all with --discard-all, a flag with no entry, an unknown flag, and no Blueprint", () => {
    expect(() => parseCompileMapArgs(["b.json", "--keep-all", "--discard-all"])).toThrow(/--keep-all or --discard-all .*not both/);
    expect(() => parseCompileMapArgs(["b.json", "--keep"])).toThrow(/--keep needs an entry/);
    expect(() => parseCompileMapArgs(["b.json", "--force"])).toThrow(/Unknown option --force/);
    expect(() => parseCompileMapArgs([])).toThrow(/Usage: compile-map/);
  });
});
