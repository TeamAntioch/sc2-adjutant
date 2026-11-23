// Text parameters (#945): a text value is a key into GameStrings (Param/Value/<id>, a library's
// Param/Value/lib_<library>_<id>), which the Editor writes as StringExternal of the key, or as
// StringToText("") when the text is empty, its key holding nothing or absent. Read from a mod
// library's Triggers and written back as the Editor saved it, its text carried by the conversion,
// and written in Galaxy by the template engine and the Kept renderer alike. The fixtures are cut
// from Nova Covert Ops' library and a current Editor's Mission save (see the fixtures' README).
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_COMPILE_RECORD } from "../../src/domain/compile-record.js";
import { readCompileRecord, saveCompileRecord } from "../../src/map/mission-package.js";
import { compileMod } from "../../src/mods/compile-mod.js";
import { convertLibrary } from "../../src/mods/convert-library.js";
import { definitionIn, functionGalaxy, type LibraryScope } from "../../src/mods/library-galaxy.js";
import { functionXml, libraryElements, readLibraryFunction, stringTable } from "../../src/mods/library-xml.js";
import { KeptGalaxyRenderer, textValueKeys } from "../../src/triggers/kept-trigger-galaxy.js";
import { keptElementSpan } from "../../src/triggers/splice-map-script.js";
import { CORE_PRIMITIVES } from "../../src/triggers/trigger-catalog.js";
import { readTriggersFile, triggerStringNames } from "../../src/triggers/triggers-file.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/editor-triggers/text-parameters/", import.meta.url));
const NOVA = path.join(FIXTURE, "mods", "missionpacks", "novacampaign.sc2mod");
const FORMAT_TIME = "DFC99709";
const GAME_STRINGS = "enUS.SC2Data/LocalizedData/GameStrings.txt";
/** The older Editor that saved Nova writes no "// Automatic Variable Declarations" line, which the current Editor writes and so does this (#937). */
const withoutAutomaticHeader = (galaxy: string) => galaxy.replace(/^ {4}\/\/ Automatic Variable Declarations\r?\n/m, "");

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** Nova's library as the fixture holds it: its elements, strings, text values, and each element's text as the Editor saved it. */
async function nova() {
  const xml = await readFile(path.join(NOVA, "Triggers"), "utf8");
  const strings = stringTable(await readFile(path.join(NOVA, "enus.sc2data", "localizeddata", "triggerstrings.txt"), "utf8"));
  const texts = textValueKeys([await readFile(path.join(NOVA, "enus.sc2data", "localizeddata", "gamestrings.txt"), "utf8")]);
  const elements = libraryElements(xml, "NovC");
  const section = xml.slice(xml.indexOf('<Library Id="NovC">'));
  const saved = [...section.slice(0, section.indexOf("</Library>")).matchAll(/^ {8}<Element Type="\w+" Id="[0-9A-F]{8}">\n[\s\S]*?^ {8}<\/Element>$/gm)].map((match) => match[0]);
  const read = readLibraryFunction(elements, strings, "NovC", FORMAT_TIME);
  const scope: LibraryScope = { library: "NovC", functions: new Map([[FORMAT_TIME, read]]), elements, strings, texts };
  return { read, saved, scope, editor: definitionIn(await readFile(path.join(NOVA, "base.sc2data", "LibNovC.galaxy"), "utf8"), "libNovC_gf_FormatTimeCampaign")! };
}

describe("a text parameter of a mod library's function", () => {
  it("is read as a text value and written back as the Editor saved it (Nova's Format Time (Campaign))", async () => {
    const { read, saved } = await nova();

    const xml = functionXml("NovC", read.fn, read.body).elements;

    const at = saved.findIndex((element) => element.includes(`Type="FunctionDef" Id="${FORMAT_TIME}"`));
    expect(xml).toEqual(saved.slice(at, at + xml.length));
    expect(JSON.stringify(read.body)).toContain('{"id":"A4F1A203","def":"Ntve/43044FC8","type":"text"}');
  });

  it("is written in Galaxy as StringExternal of its key, as the Editor generated it", async () => {
    const { read, scope, editor } = await nova();

    expect(withoutAutomaticHeader(functionGalaxy(scope, read.fn, read.body!).definition)).toBe(editor);
    expect(editor).toContain('return TextTimeFormat(StringExternal("Param/Value/lib_NovC_A4F1A203"), lp_second);');
  });

  it("whose text is empty is written as StringToText(\"\")", async () => {
    const { read, scope } = await nova();

    const galaxy = functionGalaxy({ ...scope, texts: new Map([["Param/Value/lib_NovC_4E67BE7A", "<hour/>:<min2/>:<sec2/>"]]) }, read.fn, read.body!).definition;

    expect(galaxy).toContain('return TextTimeFormat(StringToText(""), lp_second);');
    expect(galaxy).toContain('return TextTimeFormat(StringExternal("Param/Value/lib_NovC_4E67BE7A"), lp_second);');
  });
});

/** A file of the `hero-objectives` fixture, cut from a current Editor's Mission save: Create Hero Survival Objectives. */
const heroObjectives = (file: string): Promise<string> => readFile(path.join(FIXTURE, "hero-objectives", file), "utf8");

describe("a text parameter of a Kept map function", () => {
  it("is StringToText(\"\") where its key holds no text, and StringExternal where it holds some, as the Editor saved it", async () => {
    const gameStrings = await heroObjectives("GameStrings.txt");
    const kept = new KeptGalaxyRenderer(readTriggersFile(await heroObjectives("Triggers")), triggerStringNames(await heroObjectives("TriggerStrings.txt")), CORE_PRIMITIVES, textValueKeys([gameStrings]));
    const script = await heroObjectives("MapScript.galaxy");
    const span = keptElementSpan(script, "gf_CreateHeroSurvivalObjectives")!;

    const text = kept.renderFunction("2F0A387D");

    expect(kept.unknown).toEqual([]);
    expect(text).toBe(script.slice(span.start, span.end).replace(/\r?\n/g, "\r\n"));
    // The first objective's description has a key holding nothing; the second's has none.
    expect(gameStrings).toContain("Param/Value/1EAE5176=\r\n");
    expect(gameStrings).not.toContain("Param/Value/B1640934");
    expect(text.match(/StringToText\(""\)/g)).toHaveLength(2);
  });
});

describe("a converted function's text values", () => {
  /** Nova's mod as import-mod lays a mod out, outside a Workspace, its package in the Editor's spelling, without its Galaxy. */
  async function mod(): Promise<{ blueprintPath: string; pkg: string }> {
    root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-text-parameters-"));
    const pkg = path.join(root, "mods", "novacampaign", "NovaCampaign.SC2Mod");
    await mkdir(path.join(pkg, "enUS.SC2Data", "LocalizedData"), { recursive: true });
    await cp(path.join(NOVA, "Triggers"), path.join(pkg, "Triggers"));
    await cp(path.join(NOVA, "enus.sc2data", "localizeddata", "triggerstrings.txt"), path.join(pkg, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt"));
    await cp(path.join(NOVA, "enus.sc2data", "localizeddata", "gamestrings.txt"), path.join(pkg, ...GAME_STRINGS.split("/")));
    const blueprintPath = path.join(root, "mods", "novacampaign", "blueprint.json");
    await writeFile(blueprintPath, JSON.stringify({ id: "novacampaign", kind: "campaign" }));
    await saveCompileRecord(blueprintPath, EMPTY_COMPILE_RECORD);
    return { blueprintPath, pkg };
  }

  /** The package's Galaxy, the library's definitions and declarations, which compile-mod writes into. */
  async function addGalaxy(pkg: string): Promise<void> {
    await mkdir(path.join(pkg, "Base.SC2Data"), { recursive: true });
    for (const file of ["LibNovC.galaxy", "LibNovC_h.galaxy"]) await cp(path.join(NOVA, "base.sc2data", file), path.join(pkg, "Base.SC2Data", file));
  }

  it("are taken into the library by convert-library, and round-trip through compile-mod with the Equivalence Check passing", async () => {
    const { blueprintPath, pkg } = await mod();

    // Without the package's Galaxy, which the older Editor wrote without the Automatic Variable Declarations line, the function converts.
    const converted = await convertLibrary(blueprintPath, { functions: ["Format Time (Campaign)"] });

    expect(converted).toMatchObject({ converted: ["Format Time (Campaign)"], refused: [] });
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    expect(blueprint.library.strings).toEqual({ [GAME_STRINGS]: { "Param/Value/lib_NovC_4E67BE7A": "<hour/>:<min2/>:<sec2/>", "Param/Value/lib_NovC_A4F1A203": "<min2/>:<sec2/>" } });

    await addGalaxy(pkg);
    await writeFile(
      blueprintPath,
      JSON.stringify({ ...blueprint, acceptedDifferences: [{ item: "galaxy:Base.SC2Data/LibNovC.galaxy:libNovC_gf_FormatTimeCampaign", reason: "The current Editor writes the Automatic Variable Declarations line" }] }),
    );

    await compileMod(blueprintPath);

    const gameStrings = await readFile(path.join(pkg, ...GAME_STRINGS.split("/")), "utf8");
    expect(gameStrings).toContain("Param/Value/lib_NovC_A4F1A203=<min2/>:<sec2/>");
    expect(gameStrings).toContain("Param/Value/lib_NovC_4E67BE7A=<hour/>:<min2/>:<sec2/>");
    expect(definitionIn(await readFile(path.join(pkg, "Base.SC2Data", "LibNovC.galaxy"), "utf8"), "libNovC_gf_FormatTimeCampaign")).toContain('StringExternal("Param/Value/lib_NovC_A4F1A203")');
    const record = await readCompileRecord(blueprintPath);
    expect(record!.entries).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "string", file: GAME_STRINGS, key: "Param/Value/lib_NovC_A4F1A203" })]));
  });

  it("that the library doesn't give stay Kept, and their words still write StringExternal", async () => {
    const { blueprintPath, pkg } = await mod();
    await convertLibrary(blueprintPath, { functions: ["Format Time (Campaign)"] });
    await addGalaxy(pkg);
    const { library: { strings: _taken, ...library }, ...blueprint } = JSON.parse(await readFile(blueprintPath, "utf8"));
    await writeFile(
      blueprintPath,
      JSON.stringify({ ...blueprint, library, acceptedDifferences: [{ item: "galaxy:Base.SC2Data/LibNovC.galaxy:libNovC_gf_FormatTimeCampaign", reason: "The current Editor writes the Automatic Variable Declarations line" }] }),
    );

    await compileMod(blueprintPath);

    const galaxy = definitionIn(await readFile(path.join(pkg, "Base.SC2Data", "LibNovC.galaxy"), "utf8"), "libNovC_gf_FormatTimeCampaign")!;
    expect(galaxy).toContain('StringExternal("Param/Value/lib_NovC_A4F1A203")');
    expect(galaxy).toContain('StringExternal("Param/Value/lib_NovC_4E67BE7A")');
  });

  it("must each be a text parameter of the library's functions", async () => {
    const { blueprintPath, pkg } = await mod();
    await convertLibrary(blueprintPath, { functions: ["Format Time (Campaign)"] });
    await addGalaxy(pkg);
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    await writeFile(blueprintPath, JSON.stringify({ ...blueprint, library: { ...blueprint.library, strings: { [GAME_STRINGS]: { "Param/Value/lib_NovC_00000001": "Stray" } } } }));

    await expect(compileMod(blueprintPath)).rejects.toThrow("library.strings gives Param/Value/lib_NovC_00000001, which isn't a text parameter or text expression of the library's functions");
  });
});
