// A Mission's Kept triggers converted into its Blueprint (ADR-0026) and compiled back in place of
// the Kept ones, under the Equivalence Check. The package is the Harbour Mission with an Editor cut
// added to it (harbour-cuts.ts).
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { convertKeptTriggers, convertMissionTriggers, type KeptPackageFiles } from "../../src/map/convert-mission-triggers.js";
import { type GameLibrary, gameTriggerLibraries } from "../../src/mods/library-galaxy.js";
import { packageLibraries } from "../../src/mods/library-reach.js";
import { CUTS, harbourWith, readPackage, savedAt } from "./harbour-cuts.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));

describe("convertMissionTriggers", () => {
  it("reads a Kept trigger that calls Kept functions into the Blueprint, as its transcription has it", async () => {
    const mission = await harbourWith("authored-trigger");

    const converted = await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers: ["Hyperion Fighter Acquire Target"] });

    expect(converted).toEqual({ converted: [{ name: "Hyperion Fighter Acquire Target", id: "7611B84F", file: "triggers/hyperion-fighter-acquire-target.json" }], refused: [] });
    const blueprint = JSON.parse(await readFile(mission.blueprintPath, "utf8"));
    expect(blueprint.triggers).toEqual(["triggers/hyperion-fighter-acquire-target.json"]);
    const written = JSON.parse(await readFile(path.join(path.dirname(mission.blueprintPath), "triggers", "hyperion-fighter-acquire-target.json"), "utf8"));
    expect(written).toEqual(JSON.parse(await readFile(path.join(FIXTURES, "blueprint-triggers", "acquire-target.json"), "utf8")));
  });

  it("compiles a converted trigger back in place of the Kept one, to the same Triggers, Galaxy and names", async () => {
    const mission = await harbourWith("authored-trigger");
    const before = await readPackage(mission.mapDir);
    await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers: ["7611B84F"] });

    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });

    expect(await readPackage(mission.mapDir)).toEqual(before);
    const record = JSON.parse(await readFile(path.join(path.dirname(mission.blueprintPath), "compile-record.json"), "utf8"));
    expect(record.entries).toContainEqual(expect.objectContaining({ kind: "trigger", id: "7611B84F" }));
    // And again, now that it's Compiled.
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await readPackage(mission.mapDir)).toEqual(before);
  });

  it("converts a trigger with custom script, keeping the script as data, and compiles it back to the same files", async () => {
    const mission = await harbourWith("custom-script");
    const before = await readPackage(mission.mapDir);

    const converted = await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers: ["Start Game Escort"] });

    expect(converted.refused).toEqual([]);
    const written = await readFile(path.join(path.dirname(mission.blueprintPath), "triggers", "start-game-escort.json"), "utf8");
    expect(written).toContain('"script": "AISetUnitForceMover(gv_odin, true);"');
    expect(JSON.parse(written).strings).toEqual({ "enUS.SC2Data/LocalizedData/GameStrings.txt": { "Param/Value/95837E29": "The Odin" } });
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await readPackage(mission.mapDir)).toEqual(before);
  });

  it("keeps a hold on a converted trigger working: its start stays switched off, as it was while Kept, and comes back on when the hold goes", async () => {
    const mission = await harbourWith("authored-trigger");
    const unheld = await readPackage(mission.mapDir);
    const strings = unheld[2]!;
    const id = (name: string): string => new RegExp(`^Trigger/Name/([0-9A-F]{8})=${name}\\r$`, "m").exec(strings)![1]!;
    const blueprint = JSON.parse(await readFile(mission.blueprintPath, "utf8"));
    const kept = [
      { id: "mission-start", kind: "trigger", editorId: id("Mission Start"), name: "Mission Start", hold: { until: { type: "keptTriggerRuns", triggerId: "zeratul-dies" } } },
      { id: "zeratul-dies", kind: "trigger", editorId: id("Zeratul Dies"), name: "Zeratul Dies" },
    ];
    await writeFile(mission.blueprintPath, JSON.stringify({ ...blueprint, kept }, null, 2));
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    const held = await readPackage(mission.mapDir);
    expect(held[1]).not.toContain("    TriggerAddEventMapInit(gt_MissionStart);\r\n");

    const converted = await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers: ["Mission Start"] });
    expect(converted.refused).toEqual([]);
    // Its body is the Editor's own, its start on: the hold is the compile's.
    expect(await readFile(path.join(path.dirname(mission.blueprintPath), "triggers", "mission-start.json"), "utf8")).not.toContain('"disabled"');
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await readPackage(mission.mapDir)).toEqual(held);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await readPackage(mission.mapDir)).toEqual(held);

    // The hold gone, its start is on again.
    await writeFile(mission.blueprintPath, JSON.stringify({ ...JSON.parse(await readFile(mission.blueprintPath, "utf8")), kept: kept.map(({ hold: _, ...reference }) => reference) }, null, 2));
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await readPackage(mission.mapDir)).toEqual(unheld);
  });

  it("keeps a Beat and a hold on Kept triggers working once both are converted, by the same trigger references", async () => {
    const mission = await harbourWith("authored-trigger");
    const strings = (await readPackage(mission.mapDir))[2]!;
    const id = (name: string): string => new RegExp(`^Trigger/Name/([0-9A-F]{8})=${name}\\r$`, "m").exec(strings)![1]!;
    const blueprint = JSON.parse(await readFile(mission.blueprintPath, "utf8"));
    const kept = [
      { id: "mission-start", kind: "trigger", editorId: id("Mission Start"), name: "Mission Start", hold: { until: { type: "keptTriggerRuns", triggerId: "zeratul-dies" } } },
      { id: "zeratul-dies", kind: "trigger", editorId: id("Zeratul Dies"), name: "Zeratul Dies" },
    ];
    const beats = [
      { id: "arrive", title: "Arrive", summary: "The fleet arrives." },
      { id: "fallen", title: "Fallen", summary: "Zeratul falls.", startsWhen: [{ type: "keptTriggerRuns", triggerId: "zeratul-dies" }] },
    ];
    await writeFile(mission.blueprintPath, JSON.stringify({ ...blueprint, kept, beats }, null, 2));
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    const whileKept = await readPackage(mission.mapDir);
    expect(whileKept[1]).toContain("    TriggerWaitForTrigger(gt_ZeratulDies, true);\r\n    TriggerExecute(gt_MissionStart, true, false);\r\n");
    expect(whileKept[1]).toContain("        TriggerExecute(gt_BeatFallen, true, false);\r\n");

    const converted = await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers: ["Mission Start", "Zeratul Dies"] });
    expect(converted.refused).toEqual([]);
    expect(converted.converted.map((item) => item.name).sort()).toEqual(["Mission Start", "Zeratul Dies"]);
    // The Blueprint names them as it did: the same Kept References, by element Id.
    expect(JSON.parse(await readFile(mission.blueprintPath, "utf8")).kept).toEqual(kept);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await readPackage(mission.mapDir)).toEqual(whileKept);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await readPackage(mission.mapDir)).toEqual(whileKept);
    // The hold is the converted body's now, so the record lists no call a hold switched off in the package.
    const record = JSON.parse(await readFile(path.join(path.dirname(mission.blueprintPath), "compile-record.json"), "utf8"));
    expect(record.entries.filter((entry: { kind: string }) => entry.kind === "kept-hold")).toEqual([]);

    // The hold gone, its start is on again.
    await writeFile(mission.blueprintPath, JSON.stringify({ ...JSON.parse(await readFile(mission.blueprintPath, "utf8")), kept: kept.map(({ hold: _, ...reference }) => reference) }, null, 2));
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect((await readPackage(mission.mapDir))[1]).toContain("    TriggerAddEventMapInit(gt_MissionStart);\r\n");
  });

  it("keeps a converted trigger in the Kept folder that files it", async () => {
    const mission = await harbourWith("authored-trigger", { folder: "7611B84F" });
    const before = await readPackage(mission.mapDir);
    expect(before[0]).toContain('    <Element Type="Category" Id="5A5AF001">\r\n        <Item Type="Trigger" Id="7611B84F"/>\r\n    </Element>');

    await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers: ["7611B84F"] });
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });

    expect(await readPackage(mission.mapDir)).toEqual(before);
  });

  it("holds a converted trigger the Blueprint holds only after converting it, and lets it go", async () => {
    const mission = await harbourWith("authored-trigger");
    const unheld = await readPackage(mission.mapDir);
    const id = (name: string): string => new RegExp(`^Trigger/Name/([0-9A-F]{8})=${name}\\r$`, "m").exec(unheld[2]!)![1]!;
    await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers: ["Mission Start"] });
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await readPackage(mission.mapDir)).toEqual(unheld);

    const kept = [
      { id: "mission-start", kind: "trigger", editorId: id("Mission Start"), name: "Mission Start", hold: { until: { type: "keptTriggerRuns", triggerId: "zeratul-dies" } } },
      { id: "zeratul-dies", kind: "trigger", editorId: id("Zeratul Dies"), name: "Zeratul Dies" },
    ];
    const blueprint = JSON.parse(await readFile(mission.blueprintPath, "utf8"));
    await writeFile(mission.blueprintPath, JSON.stringify({ ...blueprint, kept }, null, 2));
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    const held = await readPackage(mission.mapDir);
    expect(held[1]).not.toContain("    TriggerAddEventMapInit(gt_MissionStart);\r\n");
    expect(held[1]).toContain("    TriggerWaitForTrigger(gt_ZeratulDies, true);\r\n    TriggerExecute(gt_MissionStart, true, false);\r\n");
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await readPackage(mission.mapDir)).toEqual(held);

    await writeFile(mission.blueprintPath, JSON.stringify({ ...blueprint, kept: kept.map(({ hold: _, ...reference }) => reference) }, null, 2));
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    const released = await readPackage(mission.mapDir);
    expect(released[1]).toContain("    TriggerAddEventMapInit(gt_MissionStart);\r\n");
    expect(released[0]).toBe(unheld[0]);
  });

  it("refuses a converted trigger whose first compile would differ from the Kept one, naming the part, and writes nothing", async () => {
    const mission = await harbourWith("authored-trigger");
    const before = await readPackage(mission.mapDir);
    await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers: ["7611B84F"] });
    const file = path.join(path.dirname(mission.blueprintPath), "triggers", "hyperion-fighter-acquire-target.json");
    await writeFile(file, (await readFile(file, "utf8")).replace('"initiallyOff": true,', ""));

    await expect(compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt })).rejects.toThrow(/trigger:7611B84F: <InitOff> is now[\s\S]*galaxy:MapScript.galaxy:trigger:gt_HyperionFighterAcquireTarget/);
    expect(await readPackage(mission.mapDir)).toEqual(before);
  });

  it("compiles a half-converted map: the Kept trigger left still runs the converted one by its Id", async () => {
    const mission = await harbourWith("transmission", { whole: true });
    const before = await readPackage(mission.mapDir);

    const converted = await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers: ["Objective"] });
    expect(converted.converted.map((item) => item.name)).toEqual(["Objective"]);
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });

    const after = await readPackage(mission.mapDir);
    expect(after).toEqual(before);
    // The Kept Mission Start runs it, by its Id in Triggers and its name in Galaxy.
    expect(after[0]).toContain('<ValueElement Type="Trigger" Id="C8093D15"/>');
    expect(after[1]).toContain("TriggerExecute(gt_Objective, true, false);");
    const record = JSON.parse(await readFile(path.join(path.dirname(mission.blueprintPath), "compile-record.json"), "utf8"));
    expect(record.entries.filter((entry: { kind: string }) => entry.kind === "trigger").map((entry: { id: string }) => entry.id)).toEqual(["C8093D15"]);
  });

  it("refuses a trigger that calls a library out of reach, naming it, and leaves it Kept", async () => {
    const mission = await harbourWith("transmission", { whole: true });

    const converted = await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers: ["Opening Transmission"] });

    expect(converted.converted).toEqual([]);
    expect(converted.refused).toEqual([{ trigger: "Opening Transmission", reason: "it calls VCMI/3F2DAB19 (and 10 more of its parts), which is out of reach: the library VCMI isn't in reach of the map (the game's, or a Workspace mod its dependencies load)" }]);
    expect(JSON.parse(await readFile(mission.blueprintPath, "utf8")).triggers).toBeUndefined();
  });
});

describe("a Kept trigger naming its Campaign Mod's globals", () => {
  const CMPN = { id: "cmpn-story", name: "Cmpn-Story", library: "Cmpn" };

  it("converts triggers that set and read the mod's globals, and compiles them back to the same Triggers, Galaxy and names", async () => {
    const mission = await harbourWith("library-globals", { mod: CMPN });
    const before = await readPackage(mission.mapDir);

    const converted = await convertMissionTriggers(mission.workspace, mission.blueprintPath, { triggers: ["Initialization", "Cleanup"] });

    expect(converted.refused).toEqual([]);
    expect(converted.converted.map((item) => item.name)).toEqual(["Initialization", "Cleanup"]);
    const written = JSON.parse(await readFile(path.join(path.dirname(mission.blueprintPath), "triggers", "cleanup.json"), "utf8"));
    expect(written.actions[1].params[1]).toEqual({ id: "8F61F572", def: "Ntve/EB71E50D", variable: "Cmpn/E5539606", member: { id: "C60CC870", variable: "Cmpn/C8F0D280" } });
    await compileMission(mission.workspace, mission.blueprintPath, undefined, { savedAt });
    expect(await readPackage(mission.mapDir)).toEqual(before);
    const script = await readFile(path.join(mission.mapDir, "MapScript.galaxy"), "utf8");
    expect(script).toContain("    libCmpn_gv_playerStats.lv_chosenDifficulty = 3;\r\n");
    expect(script).toContain("    libNtve_gf_MakeUnitUncommandable(libCmpn_gv_heroUnit.lv_artanis, false);\r\n");
  }, 60_000);
});

describe("convertKeptTriggers", () => {
  /** The `transmission` save's trigger files as the Editor wrote them, no Workspace or package around them. */
  const transmission = async (): Promise<KeptPackageFiles> => {
    const cut = (file: string): Promise<string> => readFile(path.join(CUTS, "transmission", file), "utf8");
    return { triggers: await cut("Triggers"), triggerStrings: await cut("TriggerStrings.txt"), script: await cut("MapScript.galaxy"), gameStrings: new Map([["enUS.SC2Data/LocalizedData/GameStrings.txt", await cut("GameStrings.txt")]]) };
  };

  /** The `library-globals` cut's trigger files, and its mod's library as a package in reach holds it, less the globals in `without`. */
  const libraryGlobals = async (without: readonly string[] = []): Promise<{ files: KeptPackageFiles; libraries: Record<string, GameLibrary> }> => {
    const cut = (file: string): Promise<string> => readFile(path.join(CUTS, "library-globals", file), "utf8");
    const { Cmpn } = await packageLibraries(path.join(CUTS, "library-globals", "mods", "cmpn-story", "Cmpn-Story.SC2Mod"));
    const variables = Object.fromEntries(Object.entries(Cmpn!.variables ?? {}).filter(([id]) => !without.includes(id)));
    return { files: { triggers: await cut("Triggers"), triggerStrings: await cut("TriggerStrings.txt"), script: await cut("MapScript.galaxy"), gameStrings: new Map() }, libraries: { ...gameTriggerLibraries(), Cmpn: { ...Cmpn!, variables } } };
  };
  const BOTH = ["Initialization", "Cleanup"];

  it("converts a map's triggers that set and read a library's globals, with the library in reach", async () => {
    const { files, libraries } = await libraryGlobals();

    const conversion = convertKeptTriggers(files, { triggers: BOTH, libraries });

    expect(conversion.refused).toEqual([]);
    expect(conversion.converted.map((item) => item.name)).toEqual(BOTH);
  });

  it("refuses a trigger naming a library's global when the library is out of reach, naming the global and its library", async () => {
    const { files } = await libraryGlobals();

    const conversion = convertKeptTriggers(files, { triggers: BOTH });

    expect(conversion.refused).toEqual([
      { trigger: "Initialization", id: "C71847BE", reason: "it names the variable Cmpn/663B6404, which is out of reach: the library Cmpn isn't in reach of the map (the game's, or a Workspace mod its dependencies load)" },
      { trigger: "Cleanup", id: "9D207F5D", reason: "it names the variable Cmpn/E5539606, which is out of reach: the library Cmpn isn't in reach of the map (the game's, or a Workspace mod its dependencies load)" },
    ]);
  });

  it("refuses a trigger naming a global its library in reach doesn't hold, naming it and the library", async () => {
    const { files, libraries } = await libraryGlobals(["E5539606"]);

    const conversion = convertKeptTriggers(files, { triggers: BOTH, libraries });

    expect(conversion.converted.map((item) => item.name)).toEqual(["Initialization"]);
    expect(conversion.refused).toEqual([{ trigger: "Cleanup", id: "9D207F5D", reason: "it names the variable Cmpn/E5539606, which is out of reach: the library Cmpn has no global variable E5539606" }]);
  });

  it("tells which of a map's Kept triggers would convert, writing nothing, and why each other one stays Kept", async () => {
    const conversion = convertKeptTriggers(await transmission());

    expect(conversion.converted.map((item) => [item.name, item.id, item.file])).toContainEqual(["Objective", "C8093D15", "triggers/objective.json"]);
    expect(conversion.refused).toContainEqual({
      trigger: "Opening Transmission",
      id: "EB028222",
      reason: "it calls VCMI/3F2DAB19 (and 10 more of its parts), which is out of reach: the library VCMI isn't in reach of the map (the game's, or a Workspace mod its dependencies load)",
    });
    expect(conversion.converted.length + conversion.refused.length).toBe(5);
    for (const { reason } of conversion.refused) expect(reason).not.toBe("");
  });

  it("names each Kept element of a kind that doesn't convert yet", async () => {
    const conversion = convertKeptTriggers(await transmission());

    expect(conversion.notYetConvertible).toEqual([{ type: "Variable", id: "C7C0764E", name: "objective" }]);
  });

  it("skips the Compiled items", async () => {
    const conversion = convertKeptTriggers(await transmission(), { compiled: new Set(["Trigger/C8093D15", "Variable/C7C0764E"]) });

    expect([...conversion.converted.map((item) => item.id), ...conversion.refused.map((item) => item.id)]).not.toContain("C8093D15");
    expect(conversion.notYetConvertible).toEqual([]);
  });
});
