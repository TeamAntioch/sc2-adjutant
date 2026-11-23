// Library breadth (ADR-0011): the value forms, literals, operators and templates a Kept library
// function holds beyond the first ones convert into its GUI body and compile back as the Editor
// saved them, their Galaxy byte for byte. The library is synthetic (library-breadth-fixture.ts),
// each function laid out as the Editor saves it.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GuiBodySchema, LibraryFunctionSchema } from "../../src/domain/library-interface.js";
import { compileMod } from "../../src/mods/compile-mod.js";
import { convertLibrary } from "../../src/mods/convert-library.js";
import { functionGalaxy, UnrenderableGalaxyError } from "../../src/mods/library-galaxy.js";
import { cleanupMods, hashTree, inPackage, setup } from "./mod-fixture.js";
import { BREADTH_FUNCTIONS, BREADTH_GALAXY, BREADTH_HEADER, BREADTH_STRINGS, BREADTH_TRIGGERS, withBreadthLibrary } from "./library-breadth-fixture.js";

afterEach(cleanupMods);

async function harbour() {
  const mod = await setup();
  await withBreadthLibrary(mod);
  return mod;
}

/** The Editor's Triggers with one function's elements where a compile splices a Compiled item's: the end of the library. */
function moved(id: string): string {
  const at = BREADTH_FUNCTIONS.findIndex((fn) => fn.id === id);
  const start = BREADTH_TRIGGERS.indexOf(`        <Element Type="FunctionDef" Id="${id}">`);
  const next = BREADTH_FUNCTIONS[at + 1];
  const close = BREADTH_TRIGGERS.indexOf("    </Library>");
  const end = next ? BREADTH_TRIGGERS.indexOf(`        <Element Type="FunctionDef" Id="${next.id}">`) : close;
  return BREADTH_TRIGGERS.slice(0, start) + BREADTH_TRIGGERS.slice(end, close) + BREADTH_TRIGGERS.slice(start, end) + BREADTH_TRIGGERS.slice(close);
}

const FORMS: Readonly<Record<string, string>> = {
  "Halt Boats": "an ability command with its type info, and a unit filter",
  "Dim Harbour": "a color, a game option and its value, and an actor message",
  "Count Down": "ArithmeticInt",
  "Half Tide": "ArithmeticReal",
  Shout: "a #PARAM over a repeated parameter, joined by its separator",
  "Ring Each Boat": "#AUTOVAR and #INITAUTOVAR, a picked unit and a variable started as null",
  "Pick Tide": "If Then Multiple",
  "Open Harbour": "an Action Group, and a blank comment after it",
};

describe("a library function's values, literals, operators and templates", () => {
  it.each(BREADTH_FUNCTIONS.map((fn) => [fn.name, FORMS[fn.name]!, fn.id] as const))("%s (%s) converts and compiles back as the Editor saved it, its Galaxy byte for byte", async (name, _form, id) => {
    const mod = await harbour();

    expect(await convertLibrary(mod.blueprintPath, { functions: [name] })).toEqual({ converted: [name], refused: [], items: [], refusedItems: [] });
    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions.filter((conversion) => conversion.accepted !== undefined)).toEqual([]);
    expect(compiled.conversions.map((conversion) => conversion.item)).toEqual(expect.arrayContaining([`function:${id}`, expect.stringMatching(/^galaxy:Base\.SC2Data\/LibHbr1\.galaxy:/)]));
    expect(await inPackage(mod, "Triggers")).toBe(moved(id));
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).toBe(BREADTH_GALAXY);
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy")).toBe(BREADTH_HEADER);
    expect(await inPackage(mod, "enUS.SC2Data/LocalizedData/TriggerStrings.txt")).toBe(BREADTH_STRINGS);

    const before = await hashTree(mod.modDir);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modDir)).toEqual(before);
  });

  it("keeps an ability command's type info in the GUI body, as the Editor wrote it", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath, { functions: ["Halt Boats"] });

    const body = JSON.parse(await readFile(path.join(mod.modDir, "library", "HaltBoats.json"), "utf8"));

    const order = body.actions[0].params.find((param: { def: string }) => param.def === "Ntve/00000172");
    expect(order.call.params[0]).toEqual({ id: "0000D11C", def: "Ntve/C2F687E6", value: "stop", type: "abilcmd", typeInfo: "0" });
  });

  it("all convert at once", async () => {
    const mod = await harbour();

    expect(await convertLibrary(mod.blueprintPath)).toEqual({ converted: BREADTH_FUNCTIONS.map((fn) => fn.name), refused: [], items: ["00000001"], refusedItems: [] });
    await compileMod(mod.blueprintPath);

    expect(await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).toBe(BREADTH_GALAXY);
  });
});

describe("a GUI function's Galaxy, past the Editor's samples", () => {
  const scope = { library: "Hbr1", functions: new Map(), elements: new Map(), strings: new Map() };
  const fn = LibraryFunctionSchema.parse({ id: "0000E000", name: "Moor", kind: "action", gui: "library/Moor.json" });
  const wait = (id: string, seconds: string, sub?: string) => ({
    id,
    function: "Ntve/00000242",
    ...(sub ? { sub } : {}),
    params: [
      { id: `${id.slice(0, 7)}1`, def: "Ntve/00000419", type: "fixed", value: seconds },
      { id: `${id.slice(0, 7)}2`, def: "Ntve/00000420", preset: "Ntve/00000013" },
    ],
  });
  const galaxy = (actions: object[]) => functionGalaxy(scope, fn, GuiBodySchema.parse({ actions })).definition;
  const refusal = (actions: object[]): string => {
    try {
      galaxy(actions);
    } catch (error) {
      if (error instanceof UnrenderableGalaxyError) return error.reason;
      throw error;
    }
    return "written";
  };

  // An If Then with no Else leaves a blank line, and so does an Action Group: one, where it ends in the other.
  it("has one blank line after an Action Group whose last action is an If Then with no Else", () => {
    const ifThen = {
      id: "0000E120",
      function: "Ntve/00000137",
      sub: "Ntve/C4F06699",
      body: [
        { id: "0000E121", function: "Ntve/C439C375", sub: "Ntve/00000003", params: [{ id: "0000E122", def: "Ntve/ABB380C4", type: "int", value: "1" }, { id: "0000E123", def: "Ntve/51567265", preset: "Ntve/1E7A4625" }, { id: "0000E124", def: "Ntve/4A15EC5F", type: "int", value: "1" }] },
        wait("0000E130", "1", "Ntve/00000004"),
      ],
    };
    const group = { id: "0000E110", function: "Ntve/75796BFD", params: [{ id: "0000E111", def: "Ntve/459BACBC", type: "string", value: "Moor" }], body: [ifThen] };

    expect(galaxy([group, wait("0000E140", "2")]).split("\n").slice(3)).toEqual(["    if ((1 == 1)) {", "        Wait(1.0, c_timeGame);", "    }", "", "    Wait(2.0, c_timeGame);", "}"]);
  });

  it("is refused for a block with no template but If Then Multiple", () => {
    expect(refusal([{ id: "0000E160", function: "Ntve/5870F9D1" }])).toBe("it calls the block Ntve/5870F9D1 (RegisterEvents), which has no template this can write it from");
  });

  it("is refused for a call to an inline function whose value needs variables of its own", () => {
    const counted = LibraryFunctionSchema.parse({ id: "0000E200", name: "Counted", kind: "function", returns: { type: "int" }, script: "(#AUTOVAR(n, int) + 1)" });
    const inline = LibraryFunctionSchema.parse({ id: "0000E300", name: "Tally", kind: "function", flags: ["inline"], returns: { type: "int" }, gui: "library/Tally.json" });
    const tally = GuiBodySchema.parse({ actions: [{ id: "0000E310", function: "Ntve/00000097", params: [{ id: "0000E311", def: "Ntve/00000488", call: { id: "0000E312", function: "Hbr1/0000E200" } }] }] });
    const withInline = { ...scope, functions: new Map([["0000E200", { fn: counted }], ["0000E300", { fn: inline, body: tally }]]) };
    const set = { id: "0000E400", function: "Ntve/00000136", params: [{ id: "0000E401", def: "Ntve/00000219", variable: "0000E500" }, { id: "0000E402", def: "Ntve/00000220", call: { id: "0000E403", function: "Hbr1/0000E300" } }] };
    const body = GuiBodySchema.parse({ variables: [{ id: "0000E500", name: "Count", type: { type: "int" } }], actions: [set] });

    expect(() => functionGalaxy(withInline, fn, body)).toThrow("it calls the inline function Tally, whose value needs variables of its own");
  });
});
