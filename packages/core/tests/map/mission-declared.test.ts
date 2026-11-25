// A Mission Blueprint's Declared Content (issue #109): the fields it declares the same way a Mod
// Blueprint does, from one schema, compiled into its Map Package the way a mod's compile writes them
// into the mod, beside what the Mission's compile generates. A part both would write is refused,
// naming both; an Accepted Removal is dropped from the package; and a declaration moves from a
// Mission to its Campaign Mod unchanged. Ashen Crossing and the Harbour are synthetic.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { DECLARED_CONTENT_FIELDS, DeclaredContentShape, MISSION_COUNTERPARTS, MOD_ONLY_FIELDS } from "../../src/domain/declared-content.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { ModBlueprintSchema } from "../../src/domain/mod-blueprint.js";
import { catalogEntries } from "../../src/map/catalog-entries.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { importMap } from "../../src/map/import-map.js";
import { missionMapPackage } from "../../src/map/mission-package.js";
import { compileMod, EquivalenceError } from "../../src/mods/compile-mod.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { catalog, cleanupMods, declare as declareMod, inPackage, setup, UNIT_FILE } from "../mods/mod-fixture.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));
const savedAt = new Date("2026-01-01T00:00:00Z");
const GAME_STRINGS = "enUS.SC2Data/LocalizedData/GameStrings.txt";
const entries = (...list: unknown[]) => `${JSON.stringify(list, null, 2)}\n`;
const GULL = catalog(`<CUnit id="Gull" parent="Critter"><LifeMax value="5"/></CUnit>`);
const TERN = entries({ catalog: "Unit", class: "CUnit", id: "Tern", parent: "Critter", fields: { LifeMax: 7 } });

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});
afterEach(cleanupMods);

/** Ashen Crossing, generated, in a Workspace of its own: `declare` adds fields to its Blueprint and writes each source in its folder. */
async function crossing() {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-mission-declared-"));
  const workspaceRoot = path.join(root, "workspace");
  await cp(CROSSING, workspaceRoot, { recursive: true });
  const blueprintPath = path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json");
  const original = JSON.parse(await readFile(blueprintPath, "utf8"));
  const declare = async (fields: Record<string, unknown>, sources: Record<string, string> = {}): Promise<void> => {
    for (const [file, content] of Object.entries(sources)) {
      await mkdir(path.dirname(path.join(path.dirname(blueprintPath), file)), { recursive: true });
      await writeFile(path.join(path.dirname(blueprintPath), file), content);
    }
    await writeFile(blueprintPath, JSON.stringify({ ...original, ...fields }, null, 2));
  };
  const compile = async () => compileMission(await loadWorkspace(workspaceRoot), blueprintPath, undefined, { savedAt });
  return { workspaceRoot, blueprintPath, declare, compile };
}

/** The compile's Map Package for the Mission at `blueprintPath`. */
const mapPackageOf = (blueprintPath: string): Promise<string> => missionMapPackage(blueprintPath);

describe("the Declared Content", () => {
  it("is the same schema in both Blueprints, and every other Mod Blueprint field is a mod's by nature or has a Mission counterpart", () => {
    const mod = ModBlueprintSchema.shape as Record<string, unknown>;
    const mission = (MissionBlueprintSchema as unknown as { readonly in: { readonly shape: Record<string, unknown> } }).in.shape;
    for (const field of DECLARED_CONTENT_FIELDS) {
      expect(mod[field], field).toBe(DeclaredContentShape[field]);
      expect(mission[field], field).toBe(DeclaredContentShape[field]);
    }
    const unaccounted = Object.keys(mod).filter((field) => [DECLARED_CONTENT_FIELDS.includes(field as never), field in MOD_ONLY_FIELDS, field in MISSION_COUNTERPARTS].filter(Boolean).length !== 1);
    expect(unaccounted).toEqual([]);
    expect(Object.keys(MOD_ONLY_FIELDS).filter((field) => !(field in mod))).toEqual([]);
    expect(Object.entries(MISSION_COUNTERPARTS).filter(([field, { field: counterpart }]) => !(field in mod) || !(counterpart in mission))).toEqual([]);
  });
});

describe("a Mission Blueprint's Declared Content", () => {
  it("compiles catalog entries, Characters, strings and files into the Map Package beside the Mission's own, and again to the same bytes", async () => {
    const mission = await crossing();
    await mission.declare(
      {
        gameData: [{ file: UNIT_FILE, source: "data/UnitData.xml" }],
        entries: [{ source: "entries/birds.json" }],
        characters: [{ speaker: "WARDEN", id: "CharWarden", unit: "Marine" }],
        strings: { [GAME_STRINGS]: { "Unit/Name/Gull": "Gull" } },
        files: [{ path: "Base.SC2Data/scripts/crossing.galaxy", source: "scripts/crossing.galaxy" }],
      },
      { "data/UnitData.xml": GULL, "entries/birds.json": TERN, "scripts/crossing.galaxy": "void Crossing_Init () {\r\n}\r\n" },
    );

    await mission.compile();

    const pkg = await mapPackageOf(mission.blueprintPath);
    const read = (file: string) => readFile(path.join(pkg, ...file.split("/")), "utf8");
    const units = catalogEntries(await read(UNIT_FILE)).map((entry) => entry.key);
    expect(units).toEqual(["CUnit:Gull", "CUnit:Tern"]);
    expect(catalogEntries(await read("Base.SC2Data/GameData/CharacterData.xml")).map((entry) => entry.key)).toEqual(["CCharacter:CharWarden"]);
    const strings = await read(GAME_STRINGS);
    expect(strings).toContain("Unit/Name/Gull=Gull\r\n");
    // The Mission's own strings are still there.
    expect(strings).toMatch(/DocInfo\/Name=/);
    expect(await read("Base.SC2Data/scripts/crossing.galaxy")).toBe("void Crossing_Init () {\r\n}\r\n");
    expect(await read("ComponentList.SC2Components")).toContain(">GameData<");

    const before = await Promise.all([UNIT_FILE, GAME_STRINGS, "Base.SC2Data/GameData/CharacterData.xml"].map(read));
    await mission.compile();
    expect(await Promise.all([UNIT_FILE, GAME_STRINGS, "Base.SC2Data/GameData/CharacterData.xml"].map(read))).toEqual(before);
  });

  it("refuses a string key, an entry or a file the Mission's compile writes too, naming both writers", async () => {
    const mission = await crossing();
    await mission.declare({ strings: { [GAME_STRINGS]: { "DocInfo/Name": "Another Crossing" } } });
    await expect(mission.compile()).rejects.toThrow(`DocInfo/Name in ${GAME_STRINGS} is written twice, differently: by the Mission's compile and by strings["${GAME_STRINGS}"]`);

    await mission.declare({ files: [{ path: "MapScript.galaxy", source: "map.galaxy" }] }, { "map.galaxy": "" });
    await expect(mission.compile()).rejects.toThrow("files.0 writes MapScript.galaxy, which the Mission's compile writes: a file has one writer");

    await mission.declare({ gameData: [{ file: UNIT_FILE, source: "a.xml" }, { file: "Base.SC2Data/GameData/unitdata.xml", source: "a.xml" }] }, { "a.xml": GULL });
    await expect(mission.compile()).rejects.toThrow("The Mission Blueprint writes Base.SC2Data/GameData/unitdata.xml twice, in gameData.0 and in gameData.1: a file has one writer");
  });

  it("refuses a source outside the Mission's folder, and a raw entry with no id", async () => {
    const mission = await crossing();
    await mission.declare({ entries: [{ source: "../elsewhere.json" }] });
    await expect(mission.compile()).rejects.toThrow(/A source is a file in the Blueprint's folder, relative to it/);

    await mission.declare({ gameData: [{ file: UNIT_FILE, source: "a.xml" }] }, { "a.xml": catalog(`<CUnit parent="Marine"/>`) });
    await expect(mission.compile()).rejects.toThrow("gameData.0's source a.xml has a CUnit with no id");
  });

  it("drops an Accepted Removal from a Kept strings file, and fails the Equivalence Check when it writes the item back", async () => {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-mission-declared-"));
    const workspaceRoot = path.join(root, "workspace");
    await cp(CROSSING, workspaceRoot, { recursive: true });
    const source = path.join(root, "elsewhere", "Yard.SC2Map");
    await compileMission(await loadWorkspace(workspaceRoot), path.join(workspaceRoot, "missions", "ashen-crossing", "blueprint.json"), source, { savedAt });
    await rm(path.join(workspaceRoot, "missions", "ashen-crossing"), { recursive: true });
    const keptStrings = path.join(source, ...GAME_STRINGS.split("/"));
    await writeFile(keptStrings, `${await readFile(keptStrings, "utf8")}Junk/Old=Left over\r\n`);
    const { blueprintPath, mapPackage } = await importMap(await loadWorkspace(workspaceRoot), source, "yard", { title: "Yard" });
    const imported = JSON.parse(await readFile(blueprintPath, "utf8"));
    const declare = (fields: Record<string, unknown>) => writeFile(blueprintPath, JSON.stringify({ ...imported, ...fields }, null, 2));
    const compile = async () => compileMission(await loadWorkspace(workspaceRoot), blueprintPath, undefined, { savedAt });
    const removal = { item: `string:${GAME_STRINGS}:Junk/Old`, reason: "Nothing names it" };

    await declare({ removals: [removal] });
    await compile();
    expect(await readFile(path.join(mapPackage, ...GAME_STRINGS.split("/")), "utf8")).not.toContain("Junk/Old");

    await declare({ removals: [removal], strings: { [GAME_STRINGS]: { "Junk/Old": "Back again" } } });
    const failure = await compile().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EquivalenceError);
    expect((failure as Error).message).toContain(`the Blueprint removes it (Nothing names it), but strings["${GAME_STRINGS}"] writes it`);
  });
});

describe("a Mission Blueprint's Set cutscenes and includes list", () => {
  it("writes a Set as a cutscene with no shots among the map's Cutscenes", async () => {
    const mission = await crossing();
    const wharf = { name: "Wharf", lights: ["WharfDay"], pieces: [{ model: "WharfDeck", at: [0, 0, 0] }], marks: [], cameras: [{ name: "Wide", target: [0, 0, 1.5], distance: 10, pitch: 10, yaw: 180, fov: 40 }], lamps: [], sounds: [] };
    await mission.declare({ setCutscenes: [{ cutscene: "Set - Wharf", set: "sets/wharf.json" }] }, { "sets/wharf.json": JSON.stringify(wharf) });

    await mission.compile();

    const pkg = await mapPackageOf(mission.blueprintPath);
    expect(await readFile(path.join(pkg, "Base.SC2Data", "Cutscenes", "Set - Wharf.SC2Cutscene"), "utf8")).toContain("WharfDeck");
    expect(await readFile(path.join(pkg, "ComponentList.SC2Components"), "utf8")).toContain(">Cutscenes/Index<");
  });

  it("adds a catalog file the game loads only through the includes list to it, as a mod's compile does", async () => {
    const mission = await crossing();
    const gulls = "Base.SC2Data/GameData/Birds/GullData.xml";
    await mission.declare({ gameData: [{ file: gulls, source: "a.xml" }] }, { "a.xml": GULL });

    const { warnings } = await mission.compile();

    const pkg = await mapPackageOf(mission.blueprintPath);
    expect(catalogEntries(await readFile(path.join(pkg, ...gulls.split("/")), "utf8")).map((entry) => entry.key)).toEqual(["CUnit:Gull"]);
    expect(await readFile(path.join(pkg, "Base.SC2Data", "GameData.xml"), "utf8")).toContain('path="GameData/Birds/GullData.xml"');
    expect(warnings.some((warning) => warning.startsWith(`gameData.0 writes ${gulls}, a catalog file the game loads only through the includes list`))).toBe(true);

    await mission.declare({ gameData: [{ file: gulls, source: "a.xml" }], includes: [gulls] }, { "a.xml": GULL });
    expect((await mission.compile()).warnings.filter((warning) => warning.includes("includes"))).toEqual([]);
  });
});

describe("a game-data change on a Mission", () => {
  it("moves to its Campaign Mod by moving the declaration and its source file, and compiles to the same entries", async () => {
    const mission = await crossing();
    const declaration = { gameData: [{ file: UNIT_FILE, source: "data/UnitData.xml" }], entries: [{ source: "entries/birds.json" }] };
    const sources = { "data/UnitData.xml": GULL, "entries/birds.json": TERN };
    await mission.declare(declaration, sources);
    await mission.compile();
    const pkg = await mapPackageOf(mission.blueprintPath);
    const inMission = catalogEntries(await readFile(path.join(pkg, ...UNIT_FILE.split("/")), "utf8"));

    const mod = await setup();
    await declareMod(mod, declaration, sources);
    await compileMod(mod.blueprintPath);
    const inMod = catalogEntries(await inPackage(mod, UNIT_FILE)).filter((entry) => ["CUnit:Gull", "CUnit:Tern"].includes(entry.key));

    const lines = (text: string) => text.replace(/\r\n/g, "\n");
    expect(inMod.map((entry) => [entry.key, lines(entry.text)])).toEqual(inMission.map((entry) => [entry.key, lines(entry.text)]));
  });
});
