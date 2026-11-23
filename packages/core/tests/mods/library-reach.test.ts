// The libraries a map's Galaxy can call beyond the game's (#937): each Workspace mod its
// dependencies name, read as the template engine reads the game's library data, from the Mod
// Blueprint's library interface or, for what it doesn't declare, from the mod package's Triggers.
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { type GuiCall, LibraryInterfaceSchema } from "../../src/domain/library-interface.js";
import { callGalaxy, type GameLibrary, gameTriggerLibraries, UnrenderableGalaxyError } from "../../src/mods/library-galaxy.js";
import { interfaceLibrary, librariesInReach, modLibraries, packageLibrary } from "../../src/mods/library-reach.js";
import { libraryElements, stringTable } from "../../src/mods/library-xml.js";
import { KeptGalaxyRenderer } from "../../src/triggers/kept-trigger-galaxy.js";
import { CORE_PRIMITIVES } from "../../src/triggers/trigger-catalog.js";
import { readTriggersFile } from "../../src/triggers/triggers-file.js";

/** The `mod-library-calls` fixture, which holds a Workspace's `mods/cmpn-story/`: cut from a Campaign Mod's Blueprint and its package. */
const FIXTURE = fileURLToPath(new URL("../fixtures/editor-triggers/mod-library-calls/", import.meta.url));
const MOD = path.join(FIXTURE, "mods", "cmpn-story");
const PACKAGE = path.join(MOD, "Cmpn-Story.SC2Mod");
const DEPENDENCIES = ["file:Mods\\Cmpn-Story.SC2Mod"];

const blueprintLibrary = async () => LibraryInterfaceSchema.parse(JSON.parse(await readFile(path.join(MOD, "blueprint.json"), "utf8")).library);
const packageRead = async () => {
  const xml = await readFile(path.join(PACKAGE, "Triggers"), "utf8");
  return packageLibrary(libraryElements(xml, "Cmpn"), stringTable(await readFile(path.join(PACKAGE, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"), "utf8")), "Cmpn");
};

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("a mod library in reach", () => {
  it("gives each function's Galaxy name, kind, parameters in definition order and template, from the library interface", async () => {
    const library = interfaceLibrary(await blueprintLibrary());

    expect(library.name).toBe("Story Tools");
    expect(library.functions["B8B27D5C"]).toEqual({
      name: "Send Transmission (Story)",
      hint: "Send a transmission with chat bubble and optionally an animation from the transmitting unit.<n/>Set to NoUnit to se",
      identifier: "SendTransmissionStory",
      flags: ["action"],
      params: ["30598D6A", "DD9E1F85", "D9698A59", "770B5643", "7AD92355"],
    });
    // A function with no Identifier is named from its name, as the Editor names it.
    expect(library.functions["BCF70417"]).toEqual({ name: "Sound Channel Volume - Speech", identifier: "SoundChannelVolumeSpeech", flags: ["action"], params: [] });
    expect(library.functions["0D9A8FB1"]).toMatchObject({ identifier: "IfThen", subFunctions: ["Cmpn/3F18199E", "Cmpn/ADF13909"], script: 'if (#SUBFUNCS(if," && ")) {\n    #SUBFUNCS(then)\n}' });
    expect(library.params["D9698A59"]).toEqual({ identifier: "waitUntilDone", name: "WaitUntilDone", type: "preset", element: "Ntve/00000020", default: { id: "7A09F448", preset: "Ntve/00000067" } });
    expect(library.subFunctions).toEqual({ "3F18199E": "if", ADF13909: "then" });
    // What the authoring tool names them by.
    expect(library.slots).toEqual({ "3F18199E": { name: "If", holds: "condition" }, ADF13909: { name: "Then", holds: "action" } });
  });

  it("gives each of a package's globals and its structures' members, with its name, Galaxy name and type, as a map names them", async () => {
    const globals = path.join(FIXTURE, "..", "library-globals", "mods", "cmpn-story", "Cmpn-Story.SC2Mod");
    const xml = await readFile(path.join(globals, "Triggers"), "utf8");
    const library = packageLibrary(libraryElements(xml, "Cmpn"), stringTable(await readFile(path.join(globals, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"), "utf8")), "Cmpn");

    expect(library.variables).toEqual({
      E5539606: { galaxy: "libCmpn_gv_heroUnit", name: "Hero Unit", type: { type: "struct", element: "Cmpn/EF280903" } },
      C8F0D280: { galaxy: "lv_artanis", name: "Artanis", member: true, structure: "Cmpn/EF280903", type: { type: "unit" } },
      "663B6404": { galaxy: "libCmpn_gv_playerStats", name: "Player Stats", type: { type: "struct", element: "Cmpn/62EEFC1A" } },
      "111A5B24": { galaxy: "lv_chosenDifficulty", name: "Chosen Difficulty", member: true, structure: "Cmpn/62EEFC1A", type: { type: "int" } },
    });
  });

  it("gives the members of an interface's structures; its globals are the package's", () => {
    const library = interfaceLibrary({ id: "Cmpn", functions: [], presets: [], structures: [{ id: "EF280903", name: "Hero Record", members: [{ id: "C8F0D280", name: "Artanis", type: { type: "unit" } }] }] });

    expect(library.variables).toEqual({ C8F0D280: { galaxy: "lv_artanis", name: "Artanis", member: true, structure: "Cmpn/EF280903", type: { type: "unit" } } });
  });

  it("reads the same from the mod package's Triggers and strings", async () => {
    expect(await packageRead()).toEqual(interfaceLibrary(await blueprintLibrary()));
  });

  it("is each Workspace mod a map's dependencies name, by its library's id", async () => {
    const found = await modLibraries({ root: FIXTURE, mods: ["cmpn-story"] }, DEPENDENCIES);

    expect(Object.keys(found)).toEqual(["Cmpn"]);
    expect(found["Cmpn"]).toEqual(interfaceLibrary(await blueprintLibrary()));
    expect(await modLibraries({ root: FIXTURE, mods: ["cmpn-story"] }, [])).toEqual({});
  });

  it("is read from the mod package where the Mod Blueprint declares no library, or not those functions", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-reach-"));
    await cp(MOD, path.join(root, "mods", "cmpn-story"), { recursive: true });
    const blueprintPath = path.join(root, "mods", "cmpn-story", "blueprint.json");
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    const whole = interfaceLibrary(await blueprintLibrary());

    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, library: undefined }));
    expect((await modLibraries({ root, mods: ["cmpn-story"] }, DEPENDENCIES))["Cmpn"]).toEqual(whole);

    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, library: { ...blueprint.library, functions: blueprint.library.functions.slice(0, 1) } }));
    expect((await modLibraries({ root, mods: ["cmpn-story"] }, DEPENDENCIES))["Cmpn"]).toEqual(whole);
  });

  it("leaves out a function the Mod Blueprint disables, though the package's copy is enabled", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-reach-"));
    await cp(MOD, path.join(root, "mods", "cmpn-story"), { recursive: true });
    const blueprintPath = path.join(root, "mods", "cmpn-story", "blueprint.json");
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    const functions = blueprint.library.functions.map((fn: { id: string }) => (fn.id === "BCF70417" ? { ...fn, disabled: true } : fn));
    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, library: { ...blueprint.library, functions } }));

    const library = (await modLibraries({ root, mods: ["cmpn-story"] }, DEPENDENCIES))["Cmpn"]!;

    expect(library.functions["BCF70417"]).toBeUndefined();
    expect(library.functions["B8B27D5C"]).toBeDefined();
  });

  it("refuses calls into a library whose id another mod's has, naming both, and keeps the game's over a mod's copy", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-reach-"));
    await cp(MOD, path.join(root, "mods", "cmpn-story"), { recursive: true });
    await cp(MOD, path.join(root, "mods", "cmpn-copy"), { recursive: true });
    await rename(path.join(root, "mods", "cmpn-copy", "Cmpn-Story.SC2Mod"), path.join(root, "mods", "cmpn-copy", "Cmpn-Copy.SC2Mod"));
    const copyPath = path.join(root, "mods", "cmpn-copy", "blueprint.json");
    await writeFile(copyPath, JSON.stringify({ ...JSON.parse(await readFile(copyPath, "utf8")), id: "cmpn-copy" }));
    const dependencies = [...DEPENDENCIES, "file:Mods\\Cmpn-Copy.SC2Mod"];
    const call = (reach: Readonly<Record<string, GameLibrary>>, fn: string) => () =>
      callGalaxy(new KeptGalaxyRenderer(readTriggersFile(""), new Map(), CORE_PRIMITIVES, undefined, reach).templateScope("gt_Test"), { id: "0000C0DE", function: fn }, { as: "statement" });

    expect(call(await librariesInReach({ root, mods: ["cmpn-story", "cmpn-copy"] }, dependencies), "Cmpn/BCF70417")).toThrow(/the mods cmpn-story, cmpn-copy each hold a library with the id Cmpn/);

    // A mod's library with a game library's id: the game's stays in reach.
    const blueprintPath = path.join(root, "mods", "cmpn-story", "blueprint.json");
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, library: { ...blueprint.library, id: "Ntve" } }));
    const reach = await librariesInReach({ root, mods: ["cmpn-story"] }, DEPENDENCIES);
    expect(reach["Ntve"]).toBe(gameTriggerLibraries()["Ntve"]);
    expect(call(reach, "Ntve/1D2DCAF0")()).toBeDefined();
  });

  it("refuses calls into a mod whose package can't be read, naming why, and reads on", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-reach-"));
    await cp(MOD, path.join(root, "mods", "cmpn-story"), { recursive: true });
    // A Triggers that can't be read: a folder where the file should be.
    const triggers = path.join(root, "mods", "cmpn-story", "Cmpn-Story.SC2Mod", "Triggers");
    await rm(triggers);
    await mkdir(triggers);

    const reach = await librariesInReach({ root, mods: ["cmpn-story"] }, DEPENDENCIES);
    const scope = new KeptGalaxyRenderer(readTriggersFile(""), new Map(), CORE_PRIMITIVES, undefined, reach).templateScope("gt_Test");

    expect(Object.keys(reach)).toEqual([...Object.keys(gameTriggerLibraries()), "Cmpn"]);
    expect(() => callGalaxy(scope, { id: "0000C0DE", function: "Cmpn/BCF70417" }, { as: "statement" })).toThrow(/Cmpn\/BCF70417.*the library Cmpn of the mod cmpn-story can't be read: .*EISDIR/);
    // A call into the game's libraries is written as ever.
    expect(callGalaxy(scope, { id: "0000C0DE", function: "Ntve/1D2DCAF0" }, { as: "statement" })).toBeDefined();
  });

  it("is in reach beside the game's libraries", async () => {
    const reach = await librariesInReach({ root: FIXTURE, mods: ["cmpn-story"] }, DEPENDENCIES);

    expect(Object.keys(reach)).toEqual([...Object.keys(gameTriggerLibraries()), "Cmpn"]);
  });

  it("gives the words of the texts its parameters' defaults hold, from its GameStrings, an absent key an empty text", async () => {
    const library = await blueprintLibrary();
    const greet = LibraryInterfaceSchema.parse({
      ...library,
      functions: [{ id: "0000A002", name: "Greet", kind: "action", parameters: [{ id: "0000A003", name: "Line", type: { type: "text" }, default: { id: "0000A004", type: "text" } }, { id: "0000A005", name: "Aside", type: { type: "text" }, default: { id: "0000A006", type: "text" } }], gui: "library/Greet.json" }],
      strings: { "enUS.SC2Data/LocalizedData/GameStrings.txt": { "Param/Value/lib_Cmpn_0000A004": "Hello" } },
    });

    expect(interfaceLibrary(greet).defaultTexts).toEqual({ "0000A004": "Hello", "0000A006": "" });
    expect(interfaceLibrary({ ...greet, strings: undefined }).defaultTexts).toBeUndefined();
  });

  it("refuses a call to an inline function's value, which the Editor writes from its body in the caller", async () => {
    const library = await blueprintLibrary();
    const inline = LibraryInterfaceSchema.parse({ ...library, functions: [{ id: "0000A001", name: "Current Word", kind: "function", flags: ["inline"], returns: { type: "string" }, gui: "library/CurrentWord.json" }] });
    const scope = new KeptGalaxyRenderer(readTriggersFile(""), new Map(), CORE_PRIMITIVES, undefined, { ...gameTriggerLibraries(), Cmpn: interfaceLibrary(inline) }).templateScope("gt_Test");
    const call: GuiCall = { id: "0000C0DE", function: "Cmpn/0000A001" };

    expect(() => callGalaxy(scope, call, { as: "expression" })).toThrow(UnrenderableGalaxyError);
    expect(() => callGalaxy(scope, call, { as: "expression" })).toThrow(/inline function Cmpn\/0000A001/);
  });

  it("refuses a call to an inline action, which no Editor save shows written as a call", async () => {
    const library = await blueprintLibrary();
    const inline = LibraryInterfaceSchema.parse({ ...library, functions: [{ id: "0000A002", name: "Clear Words", kind: "action", flags: ["inline"], gui: "library/ClearWords.json" }] });
    const scope = new KeptGalaxyRenderer(readTriggersFile(""), new Map(), CORE_PRIMITIVES, undefined, { ...gameTriggerLibraries(), Cmpn: interfaceLibrary(inline) }).templateScope("gt_Test");

    expect(() => callGalaxy(scope, { id: "0000C0DE", function: "Cmpn/0000A002" }, { as: "statement" })).toThrow(/inline function Cmpn\/0000A002/);
  });
});
