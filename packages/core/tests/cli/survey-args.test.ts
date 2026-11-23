// The survey CLI's arguments: the Blueprint, and --kind and --area to narrow the listing (#240).
import { describe, expect, it } from "vitest";

import { parseSurveyArgs } from "../../src/cli/survey-args.js";

describe("survey's arguments", () => {
  it("take the Blueprint, kinds as a list or repeated, an area, and --json", () => {
    expect(parseSurveyArgs(["m/blueprint.json", "--kind", "unit,point", "--kind", "region", "--area", "Yard", "--json"])).toEqual({
      blueprintPath: "m/blueprint.json",
      options: { kinds: ["unit", "point", "region"], area: "Yard" },
      json: true,
    });
    expect(parseSurveyArgs(["b.json"])).toEqual({ blueprintPath: "b.json", options: {}, json: false });
  });

  it("refuse an unknown kind, a flag with no value, an unknown flag, and no Blueprint", () => {
    expect(() => parseSurveyArgs(["b.json", "--kind", "lamp"])).toThrow("lamp isn't a kind the survey lists: unit, point, camera, doodad, region, trigger, cutscene, conversation, catalog");
    expect(() => parseSurveyArgs(["b.json", "--area"])).toThrow(/--area needs a value/);
    expect(() => parseSurveyArgs(["b.json", "--area", ""])).toThrow(/--area can't be empty/);
    expect(() => parseSurveyArgs(["b.json", "--area", " "])).toThrow(/--area can't be empty/);
    expect(() => parseSurveyArgs(["b.json", "--all"])).toThrow(/Unknown option --all/);
    expect(() => parseSurveyArgs([])).toThrow(/Usage: survey/);
  });
});
