// The Mod Blueprint's includes (docs/reference/mod-includes.md): the catalog files outside the
// standard ones, in load order, that the package's includes list (Base.SC2Data/GameData.xml) names.
// Import fills them in from the package's list, and the compile writes the list from them, as the
// Editor formats it, under the Equivalence Check. The mod is the synthetic Harbour-Story.
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ModBlueprintSchema } from "../../src/domain/mod-blueprint.js";
import { compileMod } from "../../src/mods/compile-mod.js";
import { importMod } from "../../src/mods/import-mod.js";
import { keptReport } from "../../src/mods/kept-report.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { catalog, cleanupMods, declare, hashTree, inPackage, type Mod, put, setup } from "./mod-fixture.js";

afterEach(cleanupMods);

const LIGHTS = "Base.SC2Data/GameData/Harbour/Lights.xml";
const CRANES = "Base.SC2Data/GameData/Harbour/Common/cranedata.xml";
const GULLS = "Base.SC2Data/GameData/Harbour/Gulls.xml";

/** An includes list as the Editor writes it, naming each package path in `files` in that order. */
const includesList = (files: readonly string[], { eol = "\n", encoding = "utf-8" } = {}) =>
  [`<?xml version="1.0" encoding="${encoding}"?>`, "<Includes>", ...files.map((file) => `    <Catalog path="${file.slice("Base.SC2Data/".length)}"/>`), "</Includes>", ""].join(eol);

/** Harbour-Story with two included catalog files, out of alphabetical order, saved as Harbour-Lights and imported as harbour-lights. */
async function importWithIncludes(mod: Mod, list = includesList([LIGHTS, CRANES])) {
  const source = path.join(path.dirname(mod.workspaceRoot), "elsewhere", "Harbour-Lights.SC2Mod");
  await cp(mod.modPackage, source, { recursive: true });
  await put(path.join(source, ...LIGHTS.split("/")), catalog(`<CLight id="Dusk"/>`));
  await put(path.join(source, ...CRANES.split("/")), catalog(`<CUnit id="Gantry" parent="Crane"/>`));
  await put(path.join(source, "Base.SC2Data", "gamedata.xml"), list);
  const imported = await importMod(await loadWorkspace(mod.workspaceRoot), source, "harbour-lights");
  return { ...mod, modDir: path.dirname(imported.blueprintPath), blueprintPath: imported.blueprintPath, modPackage: imported.modPackage };
}

const readBlueprint = async (mod: Mod) => JSON.parse(await readFile(mod.blueprintPath, "utf8"));

describe("importMod's includes", () => {
  it("fills in includes from the package's includes list, in its order", async () => {
    const mod = await importWithIncludes(await setup());
    expect((await readBlueprint(mod)).includes).toEqual([LIGHTS, CRANES]);
  });

  it("reads a list's paths in any case, each once, as the game does", async () => {
    const list = [`<?xml version="1.0" encoding="utf-8"?>`, "<Includes>", `    <Catalog path="gamedata/Harbour/Lights.xml"/>`, `    <Catalog path="GameData/Harbour/lights.xml"/>`, `    <Catalog path="GameData/Harbour/Common/cranedata.xml"/>`, "</Includes>", ""].join("\n");
    const mod = await importWithIncludes(await setup(), list);
    expect((await readBlueprint(mod)).includes).toEqual(["Base.SC2Data/gamedata/Harbour/Lights.xml", CRANES]);
  });

  it("leaves includes out for a package with no includes list", async () => {
    const mod = await setup();
    expect((await readBlueprint(mod)).includes).toBeUndefined();
  });
});

describe("compileMod's includes list", () => {
  it("after Import, converts the package's includes list byte for byte, so it leaves the Kept report, and a second compile changes nothing", async () => {
    const mod = await importWithIncludes(await setup());
    const before = await hashTree(mod.modPackage);

    const compiled = await compileMod(mod.blueprintPath);

    expect(await hashTree(mod.modPackage)).toEqual(before);
    expect(compiled.conversions).toEqual([{ item: "file:Base.SC2Data/gamedata.xml" }]);
    expect(compiled.record.entries.map((entry) => (entry.kind === "file" ? entry.path : entry.kind))).toEqual(["Base.SC2Data/gamedata.xml"]);
    expect(compiled.warnings).toEqual([]);
    const report = await keptReport(mod.blueprintPath);
    expect(report.components.flatMap((component) => component.items.map((item) => item.item))).not.toContain("file:Base.SC2Data/gamedata.xml");

    const after = await hashTree(mod.modDir);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modDir)).toEqual(after);
  });

  it("keeps the Kept list's declaration and line endings", async () => {
    const list = includesList([LIGHTS, CRANES], { eol: "\r\n", encoding: "us-ascii" });
    const mod = await importWithIncludes(await setup(), list);

    await compileMod(mod.blueprintPath);

    expect(await inPackage(mod, "Base.SC2Data/gamedata.xml")).toBe(list);
  });

  it("fails the Equivalence Check when includes changes the Kept list, and passes with the difference accepted", async () => {
    const mod = await importWithIncludes(await setup());
    await declare(mod, { includes: [CRANES, LIGHTS] });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("file:Base.SC2Data/gamedata.xml");

    await declare(mod, { acceptedDifferences: [{ item: "file:Base.SC2Data/gamedata.xml", reason: "The cranes load first" }] });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "Base.SC2Data/gamedata.xml")).toBe(includesList([CRANES, LIGHTS]));
  });

  it("writes a new list from includes, adding a catalog file the Blueprint writes outside the standard ones at the end and leaving out a listed file that isn't there, warning of each", async () => {
    const mod = await setup();
    await put(path.join(mod.modPackage, ...LIGHTS.split("/")), catalog(`<CLight id="Dusk"/>`));
    await declare(mod, { includes: [LIGHTS, "Base.SC2Data/GameData/Harbour/Gone.xml"], gameData: [{ file: GULLS, source: "data/gulls.xml" }] }, { "data/gulls.xml": catalog(`<CUnit id="Gull"/>`) });

    const compiled = await compileMod(mod.blueprintPath);

    expect(await inPackage(mod, "Base.SC2Data/GameData.xml")).toBe(includesList([LIGHTS, GULLS]));
    expect(await inPackage(mod, GULLS)).toContain(`<CUnit id="Gull"/>`);
    expect(compiled.warnings).toEqual(
      expect.arrayContaining([
        "includes lists Base.SC2Data/GameData/Harbour/Gone.xml, which the package doesn't have: the includes list leaves it out, so remove it from includes",
        `gameData.0 writes ${GULLS}, a catalog file the game loads only through the includes list, and the Blueprint's includes doesn't name it: it's included last, so add it to includes where it should load`,
      ]),
    );
  });

  it("includes a new catalog file the Blueprint writes outside the standard ones when the Blueprint has no includes and the package no list", async () => {
    const mod = await setup();
    await declare(mod, { gameData: [{ file: "Base.SC2Data/GameData/Gulls.xml", source: "data/gulls.xml" }] }, { "data/gulls.xml": catalog(`<CUnit id="Gull"/>`) });

    const compiled = await compileMod(mod.blueprintPath);

    expect(await inPackage(mod, "Base.SC2Data/GameData.xml")).toBe(includesList(["Base.SC2Data/GameData/Gulls.xml"]));
    expect(compiled.warnings.some((warning) => warning.startsWith("gameData.0 writes Base.SC2Data/GameData/Gulls.xml, a catalog file the game loads only through the includes list"))).toBe(true);

    // The list it wrote is its own on the next compile too.
    const after = await hashTree(mod.modDir);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modDir)).toEqual(after);
  });

  it("leaves out a catalog file the compile wrote before and now removes", async () => {
    const mod = await setup();
    await declare(mod, { includes: [], files: [{ path: GULLS, source: "data/gulls.xml" }] }, { "data/gulls.xml": catalog(`<CUnit id="Gull"/>`) });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "Base.SC2Data/GameData.xml")).toBe(includesList([GULLS]));

    await declare(mod, { includes: [GULLS], files: [] });
    const compiled = await compileMod(mod.blueprintPath);

    expect(Object.keys(await hashTree(mod.modPackage))).not.toContain("Base.SC2Data/GameData.xml");
    expect(compiled.warnings).toContain(`includes lists ${GULLS}, which the package doesn't have: the includes list leaves it out, so remove it from includes`);
  });

  it("warns of a standard catalog file in includes, which the game loads by its name anyway", async () => {
    const mod = await setup();
    await declare(mod, { includes: ["Base.SC2Data/GameData/UnitData.xml"] });
    const compiled = await compileMod(mod.blueprintPath);
    expect(compiled.warnings).toContain("includes lists Base.SC2Data/GameData/UnitData.xml, which the game loads by its name without the includes list: remove it from includes");
  });

  it("refuses includes beside a files entry that writes the list, in any case", async () => {
    const mod = await setup();
    await declare(mod, { includes: [], files: [{ path: "Base.SC2Data/gamedata.xml", source: "data/list.xml" }] }, { "data/list.xml": includesList([]) });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("files.0 writes Base.SC2Data/gamedata.xml, the includes list, which the Blueprint's includes write: leave it to includes");
  });

  it("writes no list with no catalog files outside the standard ones, and removes the one it wrote once nothing is left to list", async () => {
    const mod = await importWithIncludes(await setup());
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "Base.SC2Data/gamedata.xml")).toBeDefined();

    await rm(path.join(mod.modPackage, ...LIGHTS.split("/")));
    await rm(path.join(mod.modPackage, ...CRANES.split("/")));
    const compiled = await compileMod(mod.blueprintPath);

    expect(Object.keys(await hashTree(mod.modPackage))).not.toContain("Base.SC2Data/gamedata.xml");
    expect(compiled.warnings).toHaveLength(2);
    expect(compiled.record.entries.some((entry) => entry.kind === "file" && entry.path === "Base.SC2Data/gamedata.xml")).toBe(false);
  });

  it("leaves a Kept list alone while the Blueprint has no includes, and refuses a catalog file it doesn't list", async () => {
    const mod = await importWithIncludes(await setup());
    const blueprint = await readBlueprint(mod);
    delete blueprint.includes;
    await writeFile(mod.blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
    const before = await inPackage(mod, "Base.SC2Data/gamedata.xml");

    await declare(mod, { gameData: [{ file: GULLS, source: "data/gulls.xml" }] }, { "data/gulls.xml": catalog(`<CUnit id="Gull"/>`) });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(`gameData.0 writes ${GULLS}, which the package's includes list doesn't name: give the Blueprint its includes`);

    await declare(mod, { gameData: [{ file: LIGHTS, source: "data/lights.xml" }] }, { "data/lights.xml": catalog(`<CLight id="Dawn"/>`) });
    const compiled = await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "Base.SC2Data/gamedata.xml")).toBe(before);
    expect(compiled.record.entries.some((entry) => entry.kind === "file" && entry.path === "Base.SC2Data/gamedata.xml")).toBe(false);
  });
});

describe("the Mod Blueprint's includes", () => {
  const parse = (includes: unknown) => ModBlueprintSchema.safeParse({ id: "harbour", kind: "campaign", includes });

  it("is a list of GameData catalog files, each once in any case", () => {
    expect(parse([LIGHTS, CRANES]).success).toBe(true);
    expect(parse(["Base.SC2Data/Lights.xml"]).success).toBe(false);
    expect(parse(["Base.SC2Data/GameData/Harbour/Lights.txt"]).success).toBe(false);
    expect(parse([LIGHTS, LIGHTS.toLowerCase()]).success).toBe(false);
  });
});
