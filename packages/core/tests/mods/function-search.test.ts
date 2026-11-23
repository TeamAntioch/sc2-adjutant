// Searching the trigger functions in reach in the Editor's terms (#1029), and resolving a name to
// one function for the authoring tool (#1033).
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveFunction, searchFunctions } from "../../src/mods/function-search.js";
import { gameTriggerLibraries } from "../../src/mods/library-galaxy.js";
import { librariesInReach } from "../../src/mods/library-reach.js";

/** The `mod-library-calls` fixture, which holds a Workspace's `mods/cmpn-story/`, whose library Cmpn is named Story Tools. */
const FIXTURE = fileURLToPath(new URL("../fixtures/editor-triggers/mod-library-calls/", import.meta.url));
const DEPENDENCIES = ["file:Mods\\Cmpn-Story.SC2Mod"];
const withMod = () => librariesInReach({ root: FIXTURE, mods: ["cmpn-story"] }, DEPENDENCIES);

describe("searching the functions in reach", () => {
  it("finds the game's functions that take a Unit Group and return a Point, in the Editor's terms", () => {
    const { hits } = searchFunctions(gameTriggerLibraries(), { takes: ["Unit Group"], returns: "Point" });

    expect(hits.map((hit) => hit.name).sort()).toEqual(["Center Of Unit Group", "Center Of Unit Group Old", "Get Best Target Point On Group"]);
    expect(hits.find((hit) => hit.name === "Center Of Unit Group")).toEqual({
      name: "Center Of Unit Group",
      library: "Ntve",
      libraryName: "Built-In",
      category: "Unit Group > Groups",
      kind: "function",
      identifier: "UnitGroupCenterOfGroup",
      parameters: [{ name: "Unit Group", type: "Unit Group" }],
      returns: "Point",
      hint: "Returns the center of a group of units, defined as the average of their X and Y positions.  Returns No Point if the unit group is empty.",
    });
  });

  it("gives Ids only when asked for", () => {
    const { hits } = searchFunctions(gameTriggerLibraries(), { text: "Center Of Unit Group", ids: true });

    expect(hits[0]).toMatchObject({ name: "Center Of Unit Group", id: "Ntve/F5D30562", parameters: [{ name: "Unit Group", type: "Unit Group", id: "Ntve/AFF14692" }] });
  });

  it("matches a type by the Editor's name or the type's own, a kind, a category and words of the name or identifier", () => {
    const libraries = gameTriggerLibraries();
    const names = (query: Parameters<typeof searchFunctions>[1]) => searchFunctions(libraries, query).hits.map((hit) => hit.name);

    expect(names({ takes: ["unitgroup"], returns: "point" })).toEqual(names({ takes: ["Unit Group"], returns: "Point" }));
    expect(names({ text: "wave use unit", kind: "action" })).toContain("Enable/Disable Wave Use For Unit");
    expect(names({ text: "AISetUnitNotUsableInWaves" })).toEqual(["Enable/Disable Wave Use For Unit"]);
    expect(names({ text: "wave use unit", kind: "condition" })).toEqual([]);
    expect(names({ category: "unit group > groups", returns: "Point" })).toEqual(expect.arrayContaining(["Center Of Unit Group"]));
  });

  it("puts a name's exact match first and counts every match beyond the limit", () => {
    const { hits, total } = searchFunctions(gameTriggerLibraries(), { text: "Center Of Unit Group", limit: 1 });

    expect(hits.map((hit) => hit.name)).toEqual(["Center Of Unit Group"]);
    expect(total).toBeGreaterThan(1);
  });

  it("returns a name two libraries share from both, each with its library", async () => {
    const { hits } = searchFunctions(await withMod(), { text: "If Then", kind: "action" });

    const exact = hits.filter((hit) => hit.name === "If Then");
    expect(exact.map((hit) => [hit.library, hit.libraryName])).toEqual([
      ["Ntve", "Built-In"],
      ["Cmpn", "Story Tools"],
    ]);
  });

  it("finds a function of a dependency mod's library", async () => {
    const { hits } = searchFunctions(await withMod(), { text: "SendTransmissionStory" });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ library: "Cmpn", libraryName: "Story Tools", kind: "action", identifier: "SendTransmissionStory" });
    expect(hits[0]!.parameters.length).toBe(5);
    // The Editor's line break in a hint is a new line.
    expect(hits[0]!.hint).toBe("Send a transmission with chat bubble and optionally an animation from the transmitting unit.\nSet to NoUnit to se");
  });

  it("names the libraries in reach whose functions can't be searched, with why", () => {
    const { refused } = searchFunctions({ ...gameTriggerLibraries(), Cmpn: { functions: {}, params: {}, presetValues: {}, presets: {}, subFunctions: {}, refused: "the mods a, b each hold a library with the id Cmpn" } }, { text: "x" });

    expect(refused).toEqual([{ library: "Cmpn", why: "the mods a, b each hold a library with the id Cmpn" }]);
  });

  it("names a mod's function whose definition can't be read, with why", () => {
    const { refused } = searchFunctions({ ...gameTriggerLibraries(), Cmpn: { functions: {}, params: {}, presetValues: {}, presets: {}, subFunctions: {}, unreadable: { "0000A001": "it holds a Foo" } } }, { text: "x" });

    expect(refused).toEqual([{ library: "Cmpn", why: "its function 0000A001 can't be read: it holds a Foo" }]);
  });
});

describe("resolving a function by name", () => {
  it("finds one function by its name, identifier or Id, in any case", () => {
    const libraries = gameTriggerLibraries();

    for (const name of ["Center Of Unit Group", "center of unit group", "UnitGroupCenterOfGroup", "Ntve/F5D30562"]) {
      expect(resolveFunction(libraries, name)).toMatchObject({ status: "found", fn: { id: "Ntve/F5D30562", name: "Center Of Unit Group" } });
    }
  });

  it("reports a name two libraries share as ambiguous, and resolves it given a library by id or name", async () => {
    const libraries = await withMod();

    const ambiguous = resolveFunction(libraries, "If Then");
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.status === "ambiguous" && ambiguous.candidates.map((fn) => fn.library)).toEqual(["Ntve", "Cmpn"]);
    expect(resolveFunction(libraries, "If Then", { library: "Cmpn" })).toMatchObject({ status: "found", fn: { id: "Cmpn/0D9A8FB1" } });
    expect(resolveFunction(libraries, "If Then", { library: "Story Tools" })).toMatchObject({ status: "found", fn: { id: "Cmpn/0D9A8FB1" } });
  });

  it("finds none for a name no library in reach has", () => {
    expect(resolveFunction(gameTriggerLibraries(), "No Such Function")).toEqual({ status: "none" });
  });
});
