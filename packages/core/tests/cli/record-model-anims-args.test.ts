// The Workspace's model-anims script's command line: `[--mission <id>] <model>...`.
import { describe, expect, it } from "vitest";

import { recordModelAnimsArgs } from "../../src/cli/record-model-anims-args.js";

describe("recordModelAnimsArgs", () => {
  it("reads the models and the Mission whose own models they may be", () => {
    expect(recordModelAnimsArgs(["SMX3_Marine", "--mission", "ashfall-relay", "SMX3_Tech"])).toEqual({ ids: ["SMX3_Marine", "SMX3_Tech"], mission: "ashfall-relay" });
    expect(recordModelAnimsArgs(["SMX3_Marine"])).toEqual({ ids: ["SMX3_Marine"] });
  });

  it("asks for help, and refuses no models, an option with no value and an unknown option", () => {
    expect(recordModelAnimsArgs(["--help"])).toEqual({ help: true });
    expect(() => recordModelAnimsArgs([])).toThrow("Name at least one model");
    expect(() => recordModelAnimsArgs(["--mission"])).toThrow("--mission needs a value");
    expect(() => recordModelAnimsArgs(["--into", "x.json", "A"])).toThrow("Unknown option --into");
  });
});
