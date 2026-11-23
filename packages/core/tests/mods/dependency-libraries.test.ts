// A mod library that calls the library of a mod it depends on (#942): the generator's scope holds
// the dependencies' libraries, read from their packages' Triggers (outside a Workspace, as the
// game's own mods are) or from the Workspace's mods, and a dependency found nowhere is named.
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_COMPILE_RECORD } from "../../src/domain/compile-record.js";
import { readDependencies } from "../../src/map/read-dependencies.js";
import { saveCompileRecord } from "../../src/map/mission-package.js";
import { compileMod } from "../../src/mods/compile-mod.js";
import { convertLibrary } from "../../src/mods/convert-library.js";
import { definitionIn, functionGalaxy, gameTriggerLibraries, type LibraryScope, UnrenderableGalaxyError } from "../../src/mods/library-galaxy.js";
import { dependencyReach } from "../../src/mods/library-reach.js";
import { libraryElements, readLibraryFunction, stringTable } from "../../src/mods/library-xml.js";

/** The `dependency-libraries` fixture: Nova's mod and Campaign Common, cut from the game's data as the game holds it (see the fixtures' README). */
const FIXTURE = fileURLToPath(new URL("../fixtures/editor-triggers/dependency-libraries/", import.meta.url));
const NOVA = path.join(FIXTURE, "mods", "missionpacks", "novacampaign.sc2mod");
const COMMON = path.join(FIXTURE, "mods", "missionpacks", "campaigncommon.sc2mod");
const APPLY_TECH = "7CC40560";
/** The older Editor that saved Nova writes no "// Automatic Variable Declarations" line, which the current Editor writes and so does this (#937). */
const withoutAutomaticHeader = (galaxy: string) => galaxy.replace(/^ {4}\/\/ Automatic Variable Declarations\r?\n/m, "");

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** Nova's library scope for writing Apply User Tech Choices to Player, with what `reach` puts in reach. */
async function novaScope(pkg: string, reach?: Pick<LibraryScope, "libraries" | "unreached">) {
  const xml = await readFile(path.join(pkg, "Triggers"), "utf8");
  const strings = stringTable(await readFile(path.join(pkg, "enus.sc2data", "localizeddata", "triggerstrings.txt"), "utf8"));
  const elements = libraryElements(xml, "NovC");
  const read = readLibraryFunction(elements, strings, "NovC", APPLY_TECH);
  const scope: LibraryScope = { library: "NovC", functions: new Map([[APPLY_TECH, read]]), elements, strings, ...reach };
  return { scope, fn: read.fn, body: read.body! };
}

describe("a game mod's dependency libraries", () => {
  it("are found under the game's data by their DocumentInfo paths, every library of each", async () => {
    const reach = await dependencyReach(NOVA, await readDependencies(NOVA));

    expect(Object.keys(reach.libraries)).toEqual([...Object.keys(gameTriggerLibraries()), "ComC"]);
    expect(reach.libraries["ComC"]!.functions["619CB57C"]).toEqual({ name: "CC_ApplyTech", identifier: "CC_ApplyTech", flags: ["action"], params: ["0A53C404"] });
    // Nova's art mod isn't in the fixture, but holds no library: it isn't named.
    expect(reach.unreached).toEqual({ mods: [], inWorkspace: false });
  });

  it("let a function calling another mod's library be written as the Editor saved it", async () => {
    const { scope, fn, body } = await novaScope(NOVA, await dependencyReach(NOVA, await readDependencies(NOVA)));
    const editor = definitionIn(await readFile(path.join(NOVA, "base.sc2data", "LibNovC.galaxy"), "utf8"), "libNovC_gf_ApplyUserTechChoicestoPlayer");

    expect(withoutAutomaticHeader(functionGalaxy(scope, fn, body).definition)).toBe(editor);
  });

  it("are out of reach with the game's libraries alone, and a missing dependency is named", async () => {
    const alone = await novaScope(NOVA);
    expect(() => functionGalaxy(alone.scope, alone.fn, alone.body)).toThrow(new UnrenderableGalaxyError(alone.fn.name, "it calls ComC/619CB57C, which no library in reach defines"));

    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-dependencies-"));
    const nova = path.join(root, "mods", "missionpacks", "novacampaign.sc2mod");
    await cp(NOVA, nova, { recursive: true });
    const missing = await novaScope(nova, await dependencyReach(nova, await readDependencies(nova)));
    // Nova's art mod, which holds no library, isn't named.
    expect(() => functionGalaxy(missing.scope, missing.fn, missing.body)).toThrow(
      new UnrenderableGalaxyError(missing.fn.name, "it calls ComC/619CB57C, which no library in reach defines; it depends on campaigncommon, which isn't among the game's mods"),
    );
  });

  it("name a missing dependency for a preset out of reach too", async () => {
    const { scope, fn, body } = await novaScope(NOVA, { ...(await dependencyReach(NOVA, await readDependencies(NOVA))), unreached: { mods: ["campaigncommon"], inWorkspace: false } });
    const passing = (value: object) => ({ ...body, actions: [{ ...body.actions[0]!, params: [{ id: "1681CF9F", def: "ComC/0A53C404", ...value }] }] }) as typeof body;
    const note = "which no library in reach defines; it depends on campaigncommon, which isn't among the game's mods";

    expect(() => functionGalaxy(scope, fn, passing({ preset: "Chal/12345678" }))).toThrow(new UnrenderableGalaxyError(fn.name, `the preset value Chal/12345678, ${note}`));
    expect(() => functionGalaxy(scope, fn, passing({ presetElement: "Chal/12345678" }))).toThrow(new UnrenderableGalaxyError(fn.name, `the preset element Chal/12345678, ${note}`));
    // The mod's own is no other library's: its own refusal stands.
    expect(() => functionGalaxy(scope, fn, passing({ presetElement: "NovC/12345678" }))).toThrow(new UnrenderableGalaxyError(fn.name, "a preset element NovC/12345678 that isn't a set of bits"));
    // A refused library's, with why.
    const refused = "the mods a, b each hold a library with the id Chal";
    const withRefused = { ...scope, libraries: { ...scope.libraries!, Chal: { functions: {}, params: {}, presetValues: {}, presets: {}, subFunctions: {}, refused } } };
    expect(() => functionGalaxy(withRefused, fn, passing({ presetElement: "Chal/12345678" }))).toThrow(new UnrenderableGalaxyError(fn.name, `the preset element Chal/12345678, but ${refused}`, refused));
  });

  it("are found by a DocumentInfo and Triggers in any case", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-dependencies-"));
    const nova = path.join(root, "mods", "missionpacks", "novacampaign.sc2mod");
    const common = path.join(root, "mods", "missionpacks", "campaigncommon.sc2mod");
    await cp(NOVA, nova, { recursive: true });
    await cp(COMMON, common, { recursive: true });
    // Campaign Common depends on the Void campaign; read in exact case, its lower-cased DocumentInfo would name nothing on a case-sensitive volume.
    await rename(path.join(common, "DocumentInfo"), path.join(common, "documentinfo"));
    await rename(path.join(common, "Triggers"), path.join(common, "triggers"));
    await writeFile(path.join(common, "documentinfo"), (await readFile(path.join(common, "documentinfo"), "utf8")).replace("</Dependencies>", "    <Value>bnet:Challenges/0.0/999,file:Mods/Challenges.SC2Mod</Value>\n    </Dependencies>"));

    const reach = await dependencyReach(nova, await readDependencies(nova));

    expect(Object.keys(reach.libraries)).toContain("ComC");
    expect(reach.unreached.mods).toEqual(["Challenges"]);
  });

  it("are looked for only when a function's Galaxy is written", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-dependencies-"));
    const pkg = path.join(root, "mods", "novacampaign", "NovaCampaign.SC2Mod");
    // In the Editor's spelling, as import-mod lays a Workspace mod out: the fixture's lower-cased
    // folders hold no TriggerStrings.txt on a case-sensitive volume, and a function with no name is
    // refused before its Galaxy is written.
    await mkdir(path.join(pkg, "enUS.SC2Data", "LocalizedData"), { recursive: true });
    for (const file of ["DocumentInfo", "Triggers"]) await cp(path.join(NOVA, file), path.join(pkg, file));
    await cp(path.join(NOVA, "enus.sc2data", "localizeddata", "triggerstrings.txt"), path.join(pkg, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"));
    await cp(path.join(NOVA, "base.sc2data"), path.join(pkg, "Base.SC2Data"), { recursive: true });
    const blueprintPath = path.join(root, "mods", "novacampaign", "blueprint.json");
    await writeFile(blueprintPath, JSON.stringify({ id: "novacampaign", kind: "campaign", dependencies: await readDependencies(NOVA) }));
    await saveCompileRecord(blueprintPath, EMPTY_COMPILE_RECORD);
    await writeFile(path.join(root, "sc2-adjutant.workspace.json"), "{ not json");

    await expect(convertLibrary(blueprintPath, { functions: [] })).resolves.toEqual({ converted: [], refused: [], items: [], refusedItems: [] });
    await expect(convertLibrary(blueprintPath)).rejects.toThrow(`Can't read the Workspace config ${path.join(root, "sc2-adjutant.workspace.json")}`);
  });
});

describe("a Workspace mod's dependency libraries", () => {
  /** A Workspace holding both mods as import-mod lays a mod out, their packages in the Editor's spelling. */
  async function workspace(): Promise<string> {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-dependencies-"));
    await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "nova", name: "Nova" }, missions: "missions", plugins: [], mods: ["novacampaign", "campaigncommon"] }));
    for (const [id, source, name] of [
      ["novacampaign", NOVA, "NovaCampaign.SC2Mod"],
      ["campaigncommon", COMMON, "CampaignCommon.SC2Mod"],
    ] as const) {
      const pkg = path.join(root, "mods", id, name);
      await mkdir(path.join(pkg, "enUS.SC2Data", "LocalizedData"), { recursive: true });
      for (const file of ["DocumentInfo", "Triggers"]) await cp(path.join(source, file), path.join(pkg, file));
      await cp(path.join(source, "enus.sc2data", "localizeddata", "triggerstrings.txt"), path.join(pkg, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"));
      if (id === "novacampaign") await cp(path.join(source, "base.sc2data"), path.join(pkg, "Base.SC2Data"), { recursive: true });
      const blueprintPath = path.join(root, "mods", id, "blueprint.json");
      await writeFile(blueprintPath, JSON.stringify({ id, kind: "campaign", dependencies: await readDependencies(source) }));
      await saveCompileRecord(blueprintPath, EMPTY_COMPILE_RECORD);
    }
    return path.join(root, "mods", "novacampaign", "blueprint.json");
  }

  it("are its Workspace mods', so convert-library writes a call into one and checks it against the Editor's", async () => {
    const blueprintPath = await workspace();

    const converted = await convertLibrary(blueprintPath, { functions: ["Apply User Tech Choices to Player"] });

    // Its Galaxy is written: the one difference left is the older Editor's missing line.
    expect(converted.converted).toEqual([]);
    expect(converted.refused).toEqual([{ function: "Apply User Tech Choices to Player", reason: "its Galaxy would differ from the Editor's: // Implementation is now // Automatic Variable Declarations" }]);
  });

  it("refuse a call into a dependency the Workspace doesn't hold, naming it once but not the game's mods that hold no library", async () => {
    const blueprintPath = await workspace();
    await writeFile(path.join(root!, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "nova", name: "Nova" }, missions: "missions", plugins: [], mods: ["novacampaign"] }));
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, dependencies: ["bnet:Core/0.0/999,file:Mods/Core.SC2Mod", "bnet:Liberty/0.0/999,file:Mods/Liberty.SC2Mod", ...blueprint.dependencies, "file:Mods/CampaignCommon.SC2Mod"] }));

    const converted = await convertLibrary(blueprintPath, { functions: ["Apply User Tech Choices to Player"] });

    expect(converted.refused).toEqual([
      { function: "Apply User Tech Choices to Player", reason: "it calls ComC/619CB57C, which no library in reach defines; it depends on campaigncommon, which isn't one of the Workspace's mods (the game's own mods aren't read from a Workspace)" },
    ]);
  });

  it("are in reach of compile-mod, which writes the call into the library's Galaxy", async () => {
    const blueprintPath = await workspace();
    const pkg = path.join(path.dirname(blueprintPath), "NovaCampaign.SC2Mod");
    const { fn, body } = await novaScope(NOVA);
    await mkdir(path.join(path.dirname(blueprintPath), "library"), { recursive: true });
    await writeFile(path.join(path.dirname(blueprintPath), "library", "ApplyUserTechChoicestoPlayer.json"), JSON.stringify(body));
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    await writeFile(
      blueprintPath,
      JSON.stringify({
        ...blueprint,
        library: { id: "NovC", name: "Nova Campaign", functions: [{ ...fn, gui: "library/ApplyUserTechChoicestoPlayer.json" }] },
        acceptedDifferences: [{ item: "galaxy:Base.SC2Data/LibNovC.galaxy:libNovC_gf_ApplyUserTechChoicestoPlayer", reason: "The current Editor writes the Automatic Variable Declarations line" }],
      }),
    );

    await compileMod(blueprintPath);

    expect(definitionIn(await readFile(path.join(pkg, "Base.SC2Data", "LibNovC.galaxy"), "utf8"), "libNovC_gf_ApplyUserTechChoicestoPlayer")).toBe(
      ["void libNovC_gf_ApplyUserTechChoicestoPlayer (int lp_player) {", "    // Automatic Variable Declarations", "    // Implementation", "    libComC_gf_CC_ApplyTech(lp_player);", "}"].join("\n"),
    );
  });
});
