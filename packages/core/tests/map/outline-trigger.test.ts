// One outline for a Mission's trigger, Kept or the Blueprint's (#1034): the authoring tool's input,
// in the Editor's terms, read the same whichever owns the trigger, and written back through the tool
// to the same file. The package is the Harbour Mission with an Editor cut added to it (harbour-cuts.ts).
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { convertMissionTriggers } from "../../src/map/convert-mission-triggers.js";
import { outlineTrigger } from "../../src/map/outline-trigger.js";
import { writeBlueprintTrigger } from "../../src/map/write-blueprint-trigger.js";
import { harbourWith, type Mission } from "./harbour-cuts.js";

const CMPN = { id: "cmpn-story", name: "Cmpn-Story", library: "Cmpn" };

/** The Mission's Blueprint and the file of its trigger `file`, as text. */
const files = (mission: Mission, file: string): Promise<string[]> => Promise.all([mission.blueprintPath, path.join(path.dirname(mission.blueprintPath), ...file.split("/"))].map((each) => readFile(each, "utf8")));

describe("outlineTrigger", () => {
  it("outlines a Kept trigger as it outlines it once converted into the Blueprint", async () => {
    const mission = await harbourWith("authored-trigger");
    const kept = await outlineTrigger(mission.workspace, mission.blueprintPath, "Hyperion Fighter Acquire Target");

    await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers: ["Hyperion Fighter Acquire Target"] });
    const converted = await outlineTrigger(mission.workspace, mission.blueprintPath, "Hyperion Fighter Acquire Target");

    expect(kept).toMatchObject({ owner: "Kept", id: "7611B84F", unwritable: [] });
    expect(converted).toMatchObject({ owner: "Blueprint", id: "7611B84F", file: "triggers/hyperion-fighter-acquire-target.json" });
    expect(converted.trigger).toEqual(kept.trigger);
    expect(converted.text).toBe(kept.text);
    expect(kept.text).toContain('"Operator": "=="');
  }, 60_000);

  it("outlines a Kept trigger naming its Campaign Mod's globals as it does once converted", async () => {
    const mission = await harbourWith("library-globals", { mod: CMPN });
    const kept = await outlineTrigger(mission.workspace, mission.blueprintPath, "Cleanup");

    await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers: ["Initialization", "Cleanup"] });
    const converted = await outlineTrigger(mission.workspace, mission.blueprintPath, "Cleanup");

    expect(converted.text).toBe(kept.text);
    expect(kept.text).toContain('"variable": "Hero Unit"');
  }, 60_000);

  it("refuses a trigger the Mission doesn't have, naming where it looked", async () => {
    const mission = await harbourWith("authored-trigger");

    await expect(outlineTrigger(mission.workspace, mission.blueprintPath, "Nowhere")).rejects.toThrow('The Mission has no trigger "Nowhere": not one of its Blueprint\'s, nor a Kept one in its Map Package');
  }, 60_000);

  it.each([
    { cut: "library-globals", triggers: ["Initialization", "Cleanup"], mod: CMPN },
    { cut: "authored-trigger", triggers: ["Hyperion Fighter Acquire Target"] },
    { cut: "custom-script", triggers: ["Start Game Escort"] },
  ])("writes $cut's converted triggers back from their outlines through the authoring tool to the same files, byte for byte", async ({ cut, triggers, mod }) => {
    const mission = await harbourWith(cut, mod ? { mod } : {});
    await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers });
    const outlines = await Promise.all(triggers.map((name) => outlineTrigger(mission.workspace, mission.blueprintPath, name)));
    const before = await Promise.all(outlines.map((outline) => files(mission, outline.file!)));

    for (const outline of outlines) await writeBlueprintTrigger(mission.workspace, mission.blueprintPath, outline.trigger);

    expect(outlines.flatMap((outline) => outline.unwritable)).toEqual([]);
    expect(await Promise.all(outlines.map((outline) => files(mission, outline.file!)))).toEqual(before);
  }, 60_000);
});
