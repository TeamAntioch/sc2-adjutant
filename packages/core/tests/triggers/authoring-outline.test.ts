// A Blueprint trigger read back into the authoring tool's input (#1034): each part by the name the
// Editor shows it where that name, written back, settles on the same element, else by its
// reference. The triggers are cut from Editor saves (fixtures/editor-triggers), converted as
// convert_triggers reads them.
import { describe, expect, it } from "vitest";

import { authoringRoundTrip, outlineForAuthoring } from "../../src/triggers/authoring-outline.js";
import { converted, cut } from "./authoring-cuts.js";

describe("outlineForAuthoring", () => {
  it("names a trigger's parts as the Editor shows them: preset values, literals, the map's globals and a local's type", async () => {
    const at = await cut("authored-trigger");

    const { trigger, unwritable } = outlineForAuthoring(converted(at, "Hyperion Fighter Acquire Target"), at);

    const inGroup = (unit: string, group: string) => ({ function: "Unit In Unit Group", params: { Unit: { function: unit }, "Unit Group": { variable: group } } });
    expect(unwritable).toEqual([]);
    expect(trigger).toEqual({
      name: "Hyperion Fighter Acquire Target",
      initiallyOff: true,
      variables: [{ name: "TargetGroup", type: "Unit Group", value: { function: "Empty Unit Group" } }],
      events: [{ function: "Unit Acquires Target", params: { Unit: "Any Unit" } }],
      conditions: [{ function: "Comparison", params: { "Value 1": inGroup("Triggering Unit", "HyperionFighterGroup"), Operator: "==", "Value 2": true } }],
      actions: [
        { function: "Set Variable", params: { Variable: { variable: "TargetGroup" }, Value: { function: "Hyperion Fighter Target Group", library: "map" } } },
        {
          function: "If Then Else",
          blocks: {
            Then: [{ function: "Hyperion Fighter Leashing", library: "map", params: { Fighter: { function: "Triggering Unit" } } }],
            If: [{ function: "Comparison", params: { "Value 1": inGroup("Acquired Target", "TargetGroup"), Operator: "==", "Value 2": false } }],
          },
        },
      ],
    });
  });

  it("keeps a part by its reference where its name would settle on another, or on none", async () => {
    const at = await cut("authored-trigger");
    // A second Kept global of the same name.
    const map = { ...at.map, globals: [...at.map.globals, { id: "0BADF00D", name: "HyperionFighterGroup" }] };
    const trigger = converted(at, "Hyperion Fighter Acquire Target");

    const { trigger: outline } = outlineForAuthoring(trigger, { ...at, map });

    expect(JSON.stringify(outline)).toContain('"Unit Group":{"variable":"863AD0ED"}');
    expect(JSON.stringify(outline)).toContain('"Unit Group":{"variable":"TargetGroup"}');
  });

  it("writes every trigger of the cuts back as it is from its outline by names", async () => {
    const cuts = [
      { at: await cut("authored-trigger"), names: ["Hyperion Fighter Acquire Target"] },
      { at: await cut("authoring-forms/zhybrid01"), names: ["Gas Animation Handler", "Expansion Clear - Spawn Gas Pallets", "Ghost Nuke Base Entrance", "Achievement: Dominated Terran Added"] },
      { at: await cut("authoring-forms/pkorhal02"), names: ["Enemy Camp Init"] },
      { at: await cut("library-globals", "mods/cmpn-story/Cmpn-Story.SC2Mod"), names: ["Initialization", "Cleanup"] },
    ];

    const problems = cuts.flatMap(({ at, names }) => names.flatMap((name) => authoringRoundTrip(converted(at, name), at).problems.map((problem) => `${name}: ${problem}`)));

    expect(problems).toEqual([]);
  });
});
