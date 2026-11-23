// What the Editor writes where a function has no statement to write (#952): a function with no
// actions has no "// Implementation" line, one whose actions are all comments (or disabled) does;
// Bank Preload writes no statement, its bank preloaded by the package instead; and a game preset
// value is written as its <Value> stands, a trailing space too. The fixtures are cut from the game's
// libraries and a Mission's save (see the fixtures' README).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GuiBodySchema, type GuiCall, LibraryFunctionSchema } from "../../src/domain/library-interface.js";
import { callGalaxy, definitionIn, functionGalaxy, type LibraryScope, libraryTemplateScope } from "../../src/mods/library-galaxy.js";
import { libraryElements, readLibraryFunction, stringTable } from "../../src/mods/library-xml.js";
import { KeptGalaxyRenderer } from "../../src/triggers/kept-trigger-galaxy.js";
import { keptElementSpan } from "../../src/triggers/splice-map-script.js";
import { CORE_PRIMITIVES } from "../../src/triggers/trigger-catalog.js";
import { readTriggersFile, triggerStringNames } from "../../src/triggers/triggers-file.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/editor-triggers/no-statements/", import.meta.url));
/** The older Editor that saved Challenges writes no "// Automatic Variable Declarations" line, which the current Editor writes and so does this (#937). */
const withoutAutomaticHeader = (galaxy: string) => galaxy.replace(/^ {4}\/\/ Automatic Variable Declarations\r?\n/m, "");

/** The function `fnId` of the fixture mod's library `id`, as written and as the Editor saved it under `name`. */
async function galaxy(mod: string, id: string, fnId: string, name: string) {
  const dir = path.join(FIXTURE, "mods", mod);
  const elements = libraryElements(await readFile(path.join(dir, "Triggers"), "utf8"), id);
  const strings = stringTable(await readFile(path.join(dir, "enus.sc2data", "localizeddata", "triggerstrings.txt"), "utf8"));
  const read = readLibraryFunction(elements, strings, id, fnId);
  const scope: LibraryScope = { library: id, functions: new Map([[fnId, read]]), elements, strings };
  const editor = definitionIn(await readFile(path.join(dir, "base.sc2data", `Lib${id}.galaxy`), "utf8"), name);
  return { ours: functionGalaxy(scope, read.fn, read.body!).definition, editor };
}

describe("a mod library function with no statement to write", () => {
  it("has no Implementation line when it has no actions (Void Prologue's PP_ResetTech, a current Editor's save)", async () => {
    const { ours, editor } = await galaxy("voidprologue.sc2mod", "A3DDD02B", "09EFB9A3", "libA3DDD02B_gf_PP_ResetTech");

    expect(ours).toBe(editor);
    expect(ours).toBe("void libA3DDD02B_gf_PP_ResetTech () {\n    // Automatic Variable Declarations\n}");
  });

  it("has an Implementation line when its only action is a comment (Void Prologue's PP_StoreTechBonusAtMissionBeginning)", async () => {
    const { ours, editor } = await galaxy("voidprologue.sc2mod", "A3DDD02B", "56D89176", "libA3DDD02B_gf_PP_StoreTechBonusAtMissionBeginning");

    expect(ours).toBe(editor);
    expect(ours).toContain("    // Implementation\n}");
  });

  it("writes nothing for Bank Preload (Challenges' Load Challenge Data, an older Editor's save)", async () => {
    const { ours, editor } = await galaxy("challenges.sc2mod", "Chal", "C130BC3B", "libChal_gf_LoadChallengeData");

    expect(withoutAutomaticHeader(ours)).toBe(editor);
    expect(ours).not.toContain("BankPreload");
  });
});

describe("a Kept map function with no actions", () => {
  it("renders with no Implementation line (a Mission's Power Area - Move Units Away, a current Editor's save)", async () => {
    const file = (name: string) => readFile(path.join(FIXTURE, "mission", name), "utf8");
    const renderer = new KeptGalaxyRenderer(readTriggersFile(await file("Triggers")), triggerStringNames(await file("TriggerStrings.txt")), CORE_PRIMITIVES);
    const script = await file("MapScript.galaxy");
    const span = keptElementSpan(script, "gf_PowerAreaMoveUnitsAway")!;

    const text = renderer.renderFunction("2F6EE379");

    expect(renderer.unknown).toEqual([]);
    expect(text).toBe(script.slice(span.start, span.end));
    expect(text).not.toContain("// Implementation");
  });
});

describe("a game preset value", () => {
  it("is written as its Value stands, a trailing space too (Ntve's Protoss toast style, as Void Prologue's Load Campaign Data has it)", () => {
    const fn = LibraryFunctionSchema.parse({ id: "0000BBBB", name: "Test", kind: "action", gui: "library/Test.json" });
    const scope = libraryTemplateScope({ library: "Test", functions: new Map(), elements: new Map(), strings: new Map() }, fn, GuiBodySchema.parse({}));
    const call: GuiCall = {
      id: "0000C0DE",
      function: "Ntve/DD650E92",
      params: [
        { id: "0000F000", def: "Ntve/973BDC47", call: { id: "0000C0DF", function: "Ntve/00000192", params: [] } },
        { id: "0000F001", def: "Ntve/3BDFB445", preset: "Ntve/A76B4CEF" },
      ],
    };

    expect(callGalaxy(scope, call, { as: "statement" })).toEqual(["UISetAchievementToastStyle(PlayerGroupAll(), c_achievementToastStyleProtoss );"]);
  });
});
