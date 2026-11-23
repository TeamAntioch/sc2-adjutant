// The model-anims and model-footprints CLIs' arguments: npm runs them from packages/core, so a
// --mod or --into path the author gives is theirs, from where they ran the command.
import path from "node:path";

import { describe, expect, it } from "vitest";

import { describeFootprint } from "../../src/cli/model-footprints-format.js";
import { recordModelsArgs } from "../../src/cli/record-models-cli.js";

describe("the record-models CLIs' arguments", () => {
  it("resolve --mod and --into against where the author ran the command, and keep the model ids", () => {
    const ran = path.resolve("/work/lantern-workspace");
    expect(recordModelsArgs(["--mod", "mods/story/Story.SC2Mod", "Lamp", "--into", "mods/story/model-anims.json", "Post"], ran)).toEqual({
      ids: ["Lamp", "Post"],
      modDirs: [path.join(ran, "mods/story/Story.SC2Mod")],
      into: path.join(ran, "mods/story/model-anims.json"),
      print: false,
    });
    expect(recordModelsArgs(["Lamp"], ran)).toEqual({ ids: ["Lamp"], modDirs: [], print: false });
  });

  it("take --print, which writes nothing, and --variation, which needs it", () => {
    expect(recordModelsArgs(["--print", "Crate", "--variation", "3"], "/w")).toEqual({ ids: ["Crate"], modDirs: [], print: true, variation: 3 });
    expect(() => recordModelsArgs(["Crate", "--variation", "3"], "/w")).toThrow(/--variation .* needs --print/);
    expect(() => recordModelsArgs(["--print", "Crate", "--variation", "x"], "/w")).toThrow(/--variation is a whole number from 0, not x/);
    expect(() => recordModelsArgs(["--print", "--into", "a.json", "Crate"], "/w")).toThrow(/--print writes nothing/);
    // An option is never another option's value: --print here is still --print.
    expect(() => recordModelsArgs(["--mod", "--print", "Crate"], "/w")).toThrow(/--mod needs a value/);
    expect(() => recordModelsArgs(["--into", "--print", "Crate"], "/w")).toThrow(/--into needs a value/);
  });

  it("ask for the usage on --help or -h", () => {
    expect(recordModelsArgs(["--help"], "/w")).toEqual({ help: true });
    expect(recordModelsArgs(["Crate", "-h"], "/w")).toEqual({ help: true });
    // A folder named -h is the --mod's.
    expect(recordModelsArgs(["--mod", "-h", "Crate"], "/w")).toEqual({ ids: ["Crate"], modDirs: [path.resolve("/w", "-h")], print: false });
  });
});

describe("model-footprints' output", () => {
  it("labels the axes: width × depth × height, which are x × y × z", () => {
    expect(describeFootprint({ file: "Assets/Doodads/Crate/Crate_01.m3", min: [-1, -0.5, 0], max: [1.25, 0.5, 2], materials: ["opaque", "blend"] })).toBe(
      "w × d × h (x × y × z) 2.25 × 1.00 × 2.00, opaque, blend, from Assets/Doodads/Crate/Crate_01.m3",
    );
  });
});
