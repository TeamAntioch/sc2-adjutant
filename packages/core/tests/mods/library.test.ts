// A Campaign Mod's library (ADR-0011): the Mod Blueprint declares its interface with the ids found
// at Import, each function's body GUI (typed calls, stored as data) or Galaxy (a script file it
// owns). compile-mod writes the functions into Triggers, their strings and their Galaxy, as the
// Editor would, under the Equivalence Check; Mission compiles call them from the same interface.
// The mod and its library are synthetic (library-fixture.ts).
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { editorDecisions, EditorChangesError } from "../../src/map/editor-changes.js";
import { compileMod, EquivalenceError } from "../../src/mods/compile-mod.js";
import { GuiBodySchema, LibraryFunctionSchema, LibraryInterfaceSchema } from "../../src/domain/library-interface.js";
import { functionGalaxy } from "../../src/mods/library-galaxy.js";
import { convertFiles } from "../../src/mods/convert-files.js";
import { convertLibrary } from "../../src/mods/convert-library.js";
import { campaignLibraryOf } from "../../src/mods/library.js";
import { keptReport } from "../../src/mods/kept-report.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { connect, text } from "../mcp/harness.js";
import { cleanupMods, hashTree, inPackage, setup } from "./mod-fixture.js";
import { LIBRARY_GALAXY, LIBRARY_HEADER, LIBRARY_STRINGS, LIBRARY_TRIGGERS, RING_BELL, RING_BELL_GALAXY, TIDE_HEIGHT, TIDES_GALAXY, withHarbourLibrary } from "./library-fixture.js";

afterEach(cleanupMods);

async function harbour() {
  const mod = await setup();
  await withHarbourLibrary(mod);
  return mod;
}

const blueprintOf = async (blueprintPath: string) => JSON.parse(await readFile(blueprintPath, "utf8"));

describe("a GUI library function", () => {
  it("converts from Kept into its interface and GUI body, and compiles back equivalent: Triggers, strings and Galaxy", async () => {
    const mod = await harbour();

    const converted = await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });

    expect(converted).toEqual({ converted: ["Ring Bell"], refused: [], items: [], refusedItems: [] });
    const library = (await blueprintOf(mod.blueprintPath)).library;
    expect(library).toMatchObject({
      id: "Hbr1",
      name: "Harbour Tools",
      functions: [
        {
          id: RING_BELL,
          name: "Ring Bell",
          kind: "action",
          grammar: "Ring the bell (~times~) times, (~wait~)",
          parameters: [
            { id: "0000B002", name: "Times", type: { type: "int" } },
            { id: "0000B003", name: "Wait", type: { type: "preset", element: "Ntve/00000020" }, default: { id: "0000B004", preset: "Ntve/00000067" } },
          ],
          gui: "library/RingBell.json",
        },
      ],
    });
    const body = JSON.parse(await readFile(path.join(mod.modDir, "library", "RingBell.json"), "utf8"));
    expect(body.variables.map((variable: { name: string }) => variable.name)).toEqual(["Count", "Label"]);
    expect(body.actions[0]).toEqual({
      id: "0000B010",
      function: "Ntve/00000136",
      params: [
        { id: "0000B011", def: "Ntve/00000219", variable: "0000B005" },
        { id: "0000B012", def: "Ntve/00000220", parameter: "0000B002" },
      ],
    });
    expect(body.actions[1]).toEqual({ id: "0000B013", comment: "Three rings for a ship in" });

    const compiled = await compileMod(mod.blueprintPath);

    const items = compiled.conversions.map((conversion) => conversion.item);
    expect(compiled.conversions.every((conversion) => conversion.accepted === undefined)).toBe(true);
    expect(items).toEqual(
      expect.arrayContaining([
        `function:${RING_BELL}`,
        "galaxy:Base.SC2Data/LibHbr1.galaxy:libHbr1_gf_RingBell",
        "galaxy:Base.SC2Data/LibHbr1_h.galaxy:libHbr1_gf_RingBell",
        "string:enUS.SC2Data/LocalizedData/TriggerStrings.txt:FunctionDef/Name/lib_Hbr1_0000B001",
        "string:enUS.SC2Data/LocalizedData/TriggerStrings.txt:ParamDef/Name/lib_Hbr1_0000B003",
        "string:enUS.SC2Data/LocalizedData/TriggerStrings.txt:Variable/Name/lib_Hbr1_0000B005",
      ]),
    );
    // As the Editor wrote them, but for where the splice puts a Compiled item's elements (the end of
    // the library): the function stays filed in its folder, its Galaxy where it was.
    const start = LIBRARY_TRIGGERS.indexOf(`        <Element Type="FunctionDef" Id="${RING_BELL}">`);
    const end = LIBRARY_TRIGGERS.indexOf(`        <Element Type="FunctionDef" Id="${TIDE_HEIGHT}">`);
    const close = LIBRARY_TRIGGERS.indexOf("    </Library>");
    const moved = LIBRARY_TRIGGERS.slice(0, start) + LIBRARY_TRIGGERS.slice(end, close) + LIBRARY_TRIGGERS.slice(start, end) + LIBRARY_TRIGGERS.slice(close);
    expect(await inPackage(mod, "Triggers")).toBe(moved);
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).toBe(LIBRARY_GALAXY);
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy")).toBe(LIBRARY_HEADER);
    expect(await inPackage(mod, "enUS.SC2Data/LocalizedData/TriggerStrings.txt")).toBe(LIBRARY_STRINGS);
    expect(compiled.record.entries).toContainEqual(expect.objectContaining({ kind: "function", id: RING_BELL }));

    const report = await keptReport(mod.blueprintPath);
    const kept = report.components.flatMap((component) => component.items.map((item) => item.item));
    expect(kept).not.toContain(`function:${RING_BELL}`);
    expect(kept).toContain(`function:${TIDE_HEIGHT}`);

    const before = await hashTree(mod.modDir);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modDir)).toEqual(before);
  });
});

describe("converting a library function", () => {
  it("leaves one Kept whose Galaxy wouldn't come out as the Editor's, with the first difference", async () => {
    const mod = await harbour();
    const script = path.join(mod.modPackage, "Base.SC2Data", "LibHbr1.galaxy");
    await writeFile(script, LIBRARY_GALAXY.replace("        Wait(1.0, c_timeGame);\n", "        Wait(1.0, c_timeAI);\n"));

    expect(await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] })).toEqual({
      converted: [],
      refused: [{ function: "Ring Bell", reason: "its Galaxy would differ from the Editor's: Wait(1.0, c_timeAI); is now Wait(1.0, c_timeGame);" }],
      items: [],
      refusedItems: [],
    });
  });
});

describe("the library's imported ids", () => {
  it("fail the compile when an interface change would renumber one, naming the id the package has", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath, { functions: [RING_BELL] });
    const blueprint = await blueprintOf(mod.blueprintPath);
    blueprint.library.functions[0].parameters[0].id = "0000B0FF";
    await writeFile(mod.blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
    const before = await hashTree(mod.modPackage);

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/Ring Bell's parameter Times is 0000B0FF in the interface, but the package has it as 0000B002/);

    blueprint.library.functions[0].parameters[0].id = "0000B002";
    blueprint.library.functions[0].id = "0000B0FE";
    await writeFile(mod.blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/Ring Bell is 0000B0FE in the interface, but the package has it as 0000B001/);
    expect(await hashTree(mod.modPackage)).toEqual(before);
  });
});

describe("the library's imported ids, renamed or dropped", () => {
  async function converted() {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath, { functions: [RING_BELL] });
    return { mod, blueprint: await blueprintOf(mod.blueprintPath) };
  }
  const save = (mod: { blueprintPath: string }, blueprint: unknown) => writeFile(mod.blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);

  it("fail the compile when a parameter is renamed under a new id, or dropped", async () => {
    const { mod, blueprint } = await converted();
    blueprint.library.functions[0].parameters[0] = { ...blueprint.library.functions[0].parameters[0], id: "0000B0FF", name: "Rings" };
    await save(mod, blueprint);
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/Ring Bell's parameter 0000B002 \(Times\) is gone from the interface/);

    blueprint.library.functions[0].parameters.shift();
    await save(mod, blueprint);
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/Ring Bell's parameter 0000B002 \(Times\) is gone from the interface/);
  });

  it("fail the compile when a compiled function is renamed under a new id, or dropped", async () => {
    const { mod, blueprint } = await converted();
    await compileMod(mod.blueprintPath);
    blueprint.library.functions[0] = { ...blueprint.library.functions[0], id: "0000B0FE", name: "Ring Gong" };
    await save(mod, blueprint);
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/The function 0000B001 \(Ring Bell\), which the last compile wrote, is gone from the interface/);

    blueprint.library.functions = [];
    await save(mod, blueprint);
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/The function 0000B001 \(Ring Bell\), which the last compile wrote, is gone from the interface/);
  });

  it("fail the compile when a new parameter takes an id another element of the package has", async () => {
    const { mod, blueprint } = await converted();
    blueprint.library.functions[0].parameters.push({ id: "0000C002", name: "Loudness", type: { type: "int" } });
    await save(mod, blueprint);
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/Ring Bell's parameter Loudness has the id 0000C002, which the package already gives a ParamDef of another function/);
  });
});

describe("the library's imported ids an older save shares across types (#1002)", () => {
  // An older Editor numbers each element type apart: here Ring Bell's call to IntToString has Ring Bell's own Id, after it in the file.
  const sharing = LIBRARY_TRIGGERS.replaceAll(`Id="0000B043"`, `Id="${RING_BELL}"`);
  async function olderSave() {
    const mod = await harbour();
    await writeFile(path.join(mod.modPackage, "Triggers"), sharing);
    return mod;
  }

  it("convert and compile back equivalent, the function and its call each found by its type", async () => {
    const mod = await olderSave();

    expect(await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] })).toMatchObject({ converted: ["Ring Bell"], refused: [] });
    await compileMod(mod.blueprintPath);

    // As the Editor wrote them, but for the Compiled function's elements at the end of the library, as the splice puts them.
    const [start, end, close] = [`        <Element Type="FunctionDef" Id="${RING_BELL}">`, `        <Element Type="FunctionDef" Id="${TIDE_HEIGHT}">`, "    </Library>"].map((line) => sharing.indexOf(line)) as [number, number, number];
    expect(await inPackage(mod, "Triggers")).toBe(sharing.slice(0, start) + sharing.slice(end, close) + sharing.slice(start, end) + sharing.slice(close));
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).toBe(LIBRARY_GALAXY);
  });

  it("still refuse a new element sharing an Id with another type's, which the package doesn't have", async () => {
    const mod = await olderSave();
    await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });
    const bodyFile = path.join(mod.modDir, "library", "RingBell.json");
    // Ring Bell's comment given the Id of its first call.
    await writeFile(bodyFile, (await readFile(bodyFile, "utf8")).replace(`"id": "0000B013"`, `"id": "0000B010"`));

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow("The element id 0000B010 is used twice in Ring Bell: each element of the library has an id of its own");
  });

  it("still refuse a new function whose id an element of another type has", async () => {
    const mod = await olderSave();
    await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });
    const blueprint = await blueprintOf(mod.blueprintPath);
    blueprint.library.functions.push({ id: "0000000B", name: "Toll Bell", kind: "action", flags: [], parameters: [], subFunctions: [], gui: blueprint.library.functions[0].gui });
    await writeFile(mod.blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/Toll Bell's id 0000000B is a FunctionCall in the package: a new function needs an id of its own/);
  });
});

describe("the Equivalence Check on a library function", () => {
  it("fails a converted body that drifts from the Editor's, in its XML and its Galaxy, and passes it named as an Accepted Difference", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });
    const bodyFile = path.join(mod.modDir, "library", "RingBell.json");
    await writeFile(bodyFile, (await readFile(bodyFile, "utf8")).replace(`"value": "3"`, `"value": "4"`));

    const failure = await compileMod(mod.blueprintPath).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EquivalenceError);
    expect((failure as EquivalenceError).mismatches).toEqual([
      { item: "galaxy:Base.SC2Data/LibHbr1.galaxy:libHbr1_gf_RingBell", detail: "if ((lv_count == 3)) { is now if ((lv_count == 4)) {" },
      { item: `function:${RING_BELL}`, detail: '<Value> "3" is now <Value> "4"' },
    ]);

    const blueprint = await blueprintOf(mod.blueprintPath);
    blueprint.acceptedDifferences = [
      { item: `function:${RING_BELL}`, reason: "Four rings now" },
      { item: "galaxy:Base.SC2Data/LibHbr1.galaxy:libHbr1_gf_RingBell", reason: "Four rings now" },
    ];
    await writeFile(mod.blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).toContain("    if ((lv_count == 4)) {\n");
  });
});

describe("a Galaxy-bodied library function", () => {
  it("converts with its script file, which the Blueprint then owns, and compiles back equivalent", async () => {
    const mod = await harbour();

    expect(await convertLibrary(mod.blueprintPath, { functions: ["Tide Height"] })).toEqual({ converted: ["Tide Height"], refused: [], items: [], refusedItems: [] });
    const [fn] = (await blueprintOf(mod.blueprintPath)).library.functions;
    expect(fn).toEqual({
      id: TIDE_HEIGHT,
      name: "Tide Height",
      identifier: "TideHeight",
      kind: "function",
      flags: ["native"],
      returns: { type: "fixed" },
      parameters: [{ id: "0000C002", name: "Hour", type: { type: "int" } }],
      galaxy: { path: "Base.SC2Data/scripts/tides.galaxy", source: "scripts/tides.galaxy" },
    });
    expect(await readFile(path.join(mod.modDir, "scripts", "tides.galaxy"), "utf8")).toBe(TIDES_GALAXY);

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions.map((conversion) => conversion.item)).toEqual(expect.arrayContaining([`function:${TIDE_HEIGHT}`, "file:Base.SC2Data/scripts/tides.galaxy"]));
    expect(compiled.conversions.every((conversion) => conversion.accepted === undefined)).toBe(true);
    const kept = (await keptReport(mod.blueprintPath)).components.flatMap((component) => component.items.map((item) => item.item));
    expect(kept).not.toContain("file:Base.SC2Data/scripts/tides.galaxy");

    // The Blueprint owns the script now: its change is compiled, and checked no more.
    await writeFile(path.join(mod.modDir, "scripts", "tides.galaxy"), TIDES_GALAXY.replace("2.5", "3.0"));
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "Base.SC2Data/scripts/tides.galaxy")).toContain("return 3.0;");
  });

  it("is refused where its source doesn't define it", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath, { functions: ["Tide Height"] });
    await compileMod(mod.blueprintPath);
    await writeFile(path.join(mod.modDir, "scripts", "tides.galaxy"), "fixed TideLow () {\r\n    return 0.0;\r\n}\r\n");

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/Tide Height\) is native, its body in scripts\/tides.galaxy, but that file doesn't define TideHeight/);
    // A declaration, or a comment naming it, is no definition.
    for (const text of ["fixed TideHeight (int lp_hour);\r\n", "// TideHeight (int lp_hour) {\r\n", "/*\r\nfixed TideHeight (int lp_hour) {\r\n}\r\n*/\r\n"]) {
      await writeFile(path.join(mod.modDir, "scripts", "tides.galaxy"), text);
      await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/that file doesn't define TideHeight/);
    }
    // A definition whose brace is on the next line is one.
    await writeFile(path.join(mod.modDir, "scripts", "tides.galaxy"), "fixed TideHeight (int lp_hour)\r\n{\r\n    return 2.5;\r\n}\r\n");
    await compileMod(mod.blueprintPath);
  });
});

describe("Mission compiles calling the library", () => {
  const BELL = fileURLToPath(new URL("../fixtures/workspaces/bell/", import.meta.url));

  /**
   * Compiles a Mission of the bell Workspace, whose Campaign Pack's Mechanic rings the Campaign
   * Mod's library function, into a throwaway folder; `editMod` and `editMission` change a copy of
   * the Campaign Mod's Blueprint and the Mission's first.
   */
  async function compileBell(mission: string, editMod?: (blueprint: Record<string, unknown>) => void, editMission?: (blueprint: Record<string, unknown>) => void) {
    const out = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-library-"));
    const edited = editMod !== undefined || editMission !== undefined;
    // A copy sits beside the fixture, so its Plugin's imports of core resolve as the fixture's do.
    const root = edited ? await mkdtemp(path.join(BELL, "..", ".bell-copy-")) : BELL;
    try {
      if (edited) {
        await cp(BELL, root, { recursive: true });
        const edit = async (file: string, change: ((blueprint: Record<string, unknown>) => void) | undefined) => {
          const blueprint = JSON.parse(await readFile(file, "utf8"));
          change?.(blueprint);
          await writeFile(file, JSON.stringify(blueprint));
        };
        await edit(path.join(root, "mods", "bell-story", "blueprint.json"), editMod);
        await edit(path.join(root, "missions", mission, "blueprint.json"), editMission);
      }
      const map = path.join(out, "Field.SC2Map");
      await compileMission(await loadWorkspace(root), path.join(root, "missions", mission, "blueprint.json"), map);
      return { triggers: await readFile(path.join(map, "Triggers"), "utf8"), script: await readFile(path.join(map, "MapScript.galaxy"), "utf8") };
    } finally {
      await rm(out, { recursive: true, force: true });
      if (edited) await rm(root, { recursive: true, force: true });
    }
  }

  it("read the library's primitives from its interface: the function and parameter ids, and its Galaxy", async () => {
    const { triggers, script } = await compileBell("bell-field");

    expect(triggers).toContain('<FunctionDef Type="FunctionDef" Library="Bel1" Id="0000B001"/>');
    expect(triggers).toContain('<ParameterDef Type="ParamDef" Library="Bel1" Id="0000B002"/>');
    expect(triggers).toContain('<ParameterDef Type="ParamDef" Library="Bel1" Id="0000B003"/>');
    expect(script).toContain('include "LibBel1"');
    expect(script).toContain("libBel1_InitLib();");
    expect(script).toContain("libBel1_gf_RingBell(3, true);");
  });

  it("include the game's libraries the Campaign Mod's dependencies bring, and only those", async () => {
    expect((await compileBell("bell-field")).script).not.toMatch(/SwarmLib|VoidCampaignMissionLib/);

    const { script } = await compileBell("bell-field", (blueprint) => {
      blueprint["dependencies"] = ["bnet:Void Story (Campaign)/0.0/999,file:Campaigns/VoidStory.SC2Campaign"];
    });

    expect(script.replace(/\r\n/g, "\n")).toContain('include "TriggerLibs/NativeLib"\ninclude "TriggerLibs/SwarmLib"\ninclude "TriggerLibs/VoidCampaignMissionLib"\ninclude "LibBel1"\n');
  });

  it("fail a call into a Campaign Mod whose Blueprint can't be read, saying why", async () => {
    await expect(
      compileBell("bell-field", (blueprint) => {
        blueprint["kind"] = "story";
      }),
    ).rejects.toThrow(/RingBell.*mods\/bell-story\/blueprint.json.*can't be read: Invalid Mod Blueprint/);
  });

  it("refuse a call into the library from a map that doesn't load the Campaign Mod, saying to add it", async () => {
    await expect(
      compileBell("bell-field", undefined, (blueprint) => {
        delete blueprint["dependencies"];
      }),
    ).rejects.toThrow(
      "The Galaxy of the trigger gt_BellRings can't be written: it calls Bel1/0000B001, but the map doesn't load the Campaign Mod Bell-Story, whose library Bel1 is: add file:Mods\\Bell-Story.SC2Mod to the Blueprint's dependencies",
    );
  });

  it("refuse a call to a function the interface doesn't declare, naming where it would be", async () => {
    await expect(compileBell("gong-field")).rejects.toThrow(/The Campaign Mod Bell-Story's library Bel1 has no function RingGong \(its interface, mods\/bell-story\/blueprint.json, declares RingBell\)/);
  });
});

describe("convertLibrary after convertFiles", () => {
  it("takes a native function's script file over from the Blueprint's files, so one writer writes it", async () => {
    const mod = await harbour();
    expect((await convertFiles(mod.blueprintPath)).converted).toContain("Base.SC2Data/scripts/tides.galaxy");

    await convertLibrary(mod.blueprintPath);

    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    expect(blueprint.files.map((file: { path: string }) => file.path)).not.toContain("Base.SC2Data/scripts/tides.galaxy");
    expect(blueprint.library.functions.find((fn: { name: string }) => fn.name === "Tide Height").galaxy).toEqual({ path: "Base.SC2Data/scripts/tides.galaxy", source: "scripts/tides.galaxy" });
    await compileMod(mod.blueprintPath);
  });
});

describe("the convert_library tool", () => {
  it("converts a Workspace mod's Kept library functions, saying what it left Kept and why", async () => {
    const mod = await harbour();
    // Ring Bell calls a function no library in reach defines: its Galaxy can't be written.
    const triggers = path.join(mod.modPackage, "Triggers");
    await writeFile(triggers, (await readFile(triggers, "utf8")).replace(`Library="Ntve" Id="00000242"`, `Library="Ntve" Id="FFFFFFFF"`));
    const client = await connect(mod.workspaceRoot);

    const reply = await client.callTool({ name: "convert_library", arguments: { mod: "harbour-story" } });

    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({ converted: ["Tide Height"], refused: [{ function: "Ring Bell", reason: "it calls Ntve/FFFFFFFF, which no library in reach defines" }], items: ["00000001"], refusedItems: [] });
    expect(text(reply)).toContain("compile_mod");
  });
});

describe("a library function the author kept as the Editor changed it", () => {
  it("stays as the Editor has it, its XML and its Galaxy, compile after compile", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });
    await compileMod(mod.blueprintPath);
    // The author edits Ring Bell in the Editor, which saves its Galaxy with it.
    const triggers = path.join(mod.modPackage, "Triggers");
    const script = path.join(mod.modPackage, "Base.SC2Data", "LibHbr1.galaxy");
    await writeFile(triggers, (await readFile(triggers, "utf8")).replace("<Value>3</Value>", "<Value>5</Value>"));
    await writeFile(script, (await readFile(script, "utf8")).replace("(lv_count == 3)", "(lv_count == 5)"));

    const undecided = await compileMod(mod.blueprintPath).catch((error: unknown) => error);
    expect(undecided).toBeInstanceOf(EditorChangesError);
    expect((undecided as EditorChangesError).changes).toEqual([expect.objectContaining({ name: `function:${RING_BELL}`, label: '"Ring Bell"' })]);

    const compiled = await compileMod(mod.blueprintPath, { decisions: editorDecisions({ keep: [`function:${RING_BELL}`] }) });

    expect(compiled.record.kept).toContainEqual({ kind: "function", id: RING_BELL });
    expect(await inPackage(mod, "Triggers")).toContain("<Value>5</Value>");
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).toContain("if ((lv_count == 5)) {");
    const before = await hashTree(mod.modPackage);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modPackage)).toEqual(before);
  });
});

describe("a compiled library function's Galaxy", () => {
  it("goes when the function is disabled, and moves to its new name when it is renamed", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });
    await compileMod(mod.blueprintPath);
    const blueprint = await blueprintOf(mod.blueprintPath);

    blueprint.library.functions[0].name = "Ring Bells";
    await writeFile(mod.blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).toContain("void libHbr1_gf_RingBells (int lp_times, bool lp_wait) {");
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).not.toContain("libHbr1_gf_RingBell (");
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy")).toContain("void libHbr1_gf_RingBells (int lp_times, bool lp_wait);\n\n// Trigger Declarations");
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy")).not.toContain("libHbr1_gf_RingBell (");

    blueprint.library.functions[0].disabled = true;
    await writeFile(mod.blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).toBe(LIBRARY_GALAXY.replace(`${RING_BELL_GALAXY}\n\n`, ""));
    expect(await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy")).toBe(LIBRARY_HEADER.replace("void libHbr1_gf_RingBell (int lp_times, bool lp_wait);\n", ""));
  });
});

describe("a disabled library function", () => {
  it("isn't offered to Missions, since the Editor writes no Galaxy for it", () => {
    const library = LibraryInterfaceSchema.parse({
      id: "Bel1",
      name: "Bell Tools",
      functions: [{ id: "0000B001", name: "Ring Bell", kind: "action", disabled: true, gui: "library/RingBell.json" }],
    });

    const campaign = campaignLibraryOf(library, "The Campaign Mod Bell-Story", "mods/bell-story/blueprint.json");

    expect(campaign.functions).toEqual({});
    expect(() => campaign.function("RingBell")).toThrow(/Bel1's function RingBell is disabled in its interface \(mods\/bell-story\/blueprint.json\): enable it/);
  });
});

describe("converting a function that calls a Kept inline function", () => {
  it("leaves it Kept, naming the inline function, when that function's body can't be read", async () => {
    const mod = await harbour();
    const triggers = path.join(mod.modPackage, "Triggers");
    const inline = [
      `        <Element Type="Param" Id="0000B024">`,
      `            <ParameterDef Type="ParamDef" Library="Ntve" Id="4A15EC5F"/>`,
      `            <FunctionCall Type="FunctionCall" Library="Hbr1" Id="0000D020"/>`,
      `        </Element>`,
      `        <Element Type="FunctionCall" Id="0000D020">`,
      `            <FunctionDef Type="FunctionDef" Library="Hbr1" Id="0000D001"/>`,
      `        </Element>`,
      `        <Element Type="FunctionDef" Id="0000D001">`,
      `            <FlagCall/>`,
      `            <FlagInline/>`,
      `            <ReturnType>`,
      `                <Type Value="int"/>`,
      `            </ReturnType>`,
      `            <FunctionCall Type="FunctionCall" Library="Hbr1" Id="0000D0FF"/>`,
      `        </Element>`,
    ].join("\r\n");
    const xml = (await readFile(triggers, "utf8"))
      .replace(/        <Element Type="Param" Id="0000B024">\r\n[\s\S]*?        <\/Element>/, inline)
      .replace(`            <Item Type="FunctionDef" Library="Hbr1" Id="0000C001"/>`, `            <Item Type="FunctionDef" Library="Hbr1" Id="0000C001"/>\r\n            <Item Type="FunctionDef" Library="Hbr1" Id="0000D001"/>`);
    await writeFile(triggers, xml);
    const strings = path.join(mod.modPackage, "enUS.SC2Data", "LocalizedData", "TriggerStrings.txt");
    await writeFile(strings, `${await readFile(strings, "utf8")}FunctionDef/Name/lib_Hbr1_0000D001=Three\r\n`);

    const converted = await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });

    expect(converted.converted).toEqual([]);
    expect(converted.refused).toEqual([{ function: "Ring Bell", reason: expect.stringMatching(/^it calls the inline function Hbr1\/0000D001, whose definition can't be read: its FunctionCall 0000D0FF isn't in the library/) }]);
  });
});

describe("the library interface's element ids", () => {
  const fn = (id: string, name: string, extra: object = {}) => ({ id, name, kind: "action", gui: `library/${id}.json`, ...extra });

  it("are refused where two functions share one, even two of one name, or a block slot's or default's", () => {
    const problems = (functions: object[]) => {
      const parsed = LibraryInterfaceSchema.safeParse({ id: "Bel1", name: "Bell Tools", functions });
      return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
    };
    const times = { id: "0000B002", name: "Times", type: { type: "int" } };
    expect(problems([fn("0000B001", "Ring Bell", { parameters: [times] }), fn("0000B011", "Ring Bell", { parameters: [times] })])).toEqual(["The element id 0000B002 is in both Ring Bell (functions.0) and Ring Bell (functions.1)"]);
    expect(problems([fn("0000B001", "Ring Bell", { parameters: [times] }), fn("0000B011", "Ring Gong", { subFunctions: [{ id: "0000B002", name: "Then" }] })])).toEqual(["The element id 0000B002 is in both Ring Bell (functions.0) and Ring Gong (functions.1)"]);
    expect(problems([fn("0000B001", "Ring Bell", { parameters: [{ ...times, default: { id: "0000B011", type: "int", value: "3" } }] }), fn("0000B011", "Ring Gong")])).toEqual(["The element id 0000B011 is in both Ring Bell (functions.0) and Ring Gong (functions.1)"]);
  });

  it("fail the compile where a GUI body's element has another function's id", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });
    const blueprint = await blueprintOf(mod.blueprintPath);
    blueprint.library.functions.push(fn("0000E001", "Ring Gong", { gui: "library/RingGong.json" }));
    await writeFile(path.join(mod.modDir, "library", "RingGong.json"), JSON.stringify({ actions: [{ id: "0000B013", comment: "Once" }] }));
    await writeFile(mod.blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);

    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/The element id 0000B013 is in both Ring Bell and Ring Gong: each element of the library has an id of its own/);
  });
});

describe("a GUI function's Galaxy", () => {
  // As the Editor writes an If Then with no Else: one blank line after it, at any depth, nested in
  // an Else too (docs/reference/library-interface.md); an If Then Else has none.
  it("has the blank line the Editor leaves after an If Then with no Else", () => {
    const count = "0000F001";
    const set = (id: string, value: string, sub?: string) => ({
      id,
      function: "Ntve/00000136",
      ...(sub ? { sub } : {}),
      params: [
        { id: `${id.slice(0, 7)}1`, def: "Ntve/00000219", variable: count },
        { id: `${id.slice(0, 7)}2`, def: "Ntve/00000220", type: "int", value },
      ],
    });
    const equals = (id: string, value: string) => ({
      id,
      function: "Ntve/C439C375",
      sub: "Ntve/00000003",
      params: [
        { id: `${id.slice(0, 7)}1`, def: "Ntve/ABB380C4", variable: count },
        { id: `${id.slice(0, 7)}2`, def: "Ntve/51567265", preset: "Ntve/1E7A4625" },
        { id: `${id.slice(0, 7)}3`, def: "Ntve/4A15EC5F", type: "int", value },
      ],
    });
    const ifThen = (id: string, test: string, then: string, otherwise: object[] = [], sub?: string) => ({
      id,
      function: "Ntve/00000137",
      ...(sub ? { sub } : {}),
      body: [equals(`${id.slice(0, 6)}10`, test), set(`${id.slice(0, 6)}20`, then, "Ntve/00000004"), ...otherwise.map((statement) => ({ ...statement, sub: "Ntve/00000005" }))],
    });
    const body = GuiBodySchema.parse({
      variables: [{ id: count, name: "Count", type: { type: "int" } }],
      actions: [ifThen("0000F100", "3", "1", [ifThen("0000F200", "2", "2")]), ifThen("0000F300", "4", "4")],
    });
    const fn = LibraryFunctionSchema.parse({ id: "0000F000", name: "Pick", kind: "action", gui: "library/Pick.json" });

    const { definition } = functionGalaxy({ library: "Hbr1", functions: new Map(), elements: new Map(), strings: new Map() }, fn, body);

    expect(definition).toBe(
      [
        "void libHbr1_gf_Pick () {",
        "    // Variable Declarations",
        "    int lv_count;",
        "",
        "    // Automatic Variable Declarations",
        "    // Variable Initialization",
        "",
        "    // Implementation",
        "    if ((lv_count == 3)) {",
        "        lv_count = 1;",
        "    }",
        "    else {",
        "        if ((lv_count == 2)) {",
        "            lv_count = 2;",
        "        }",
        "",
        "    }",
        "    if ((lv_count == 4)) {",
        "        lv_count = 4;",
        "    }",
        "",
        "}",
      ].join("\n"),
    );
  });
});

describe("a library with triggers of the Blueprint's own", () => {
  it("compiles its functions into the same library as its triggers", async () => {
    const mod = await harbour();
    await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });
    const quay = LIBRARY_TRIGGERS.split("\r\n");
    const element = (id: string) => quay.slice(quay.indexOf(`        <Element Type="${id === "0000000A" ? "Trigger" : "FunctionCall"}" Id="${id}">`)).slice(0, 3);
    const own = [`<?xml version="1.0" encoding="utf-8"?>`, `<TriggerData>`, `    <Library Id="Hbr1">`, `        <Root>`, `            <Item Type="Trigger" Library="Hbr1" Id="0000000A"/>`, `        </Root>`, ...element("0000000A"), ...element("0000000B"), `    </Library>`, `</TriggerData>`, ``].join("\n");
    await writeFile(path.join(mod.modDir, "quay.xml"), own);
    const blueprint = await blueprintOf(mod.blueprintPath);
    blueprint.triggers = { source: "quay.xml" };
    await writeFile(mod.blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.record.entries).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "function", id: RING_BELL }), expect.objectContaining({ kind: "trigger", id: "0000000A" })]));
    const triggers = await inPackage(mod, "Triggers");
    expect(triggers.match(/<Element Type="FunctionDef" Id="0000B001">/g)).toHaveLength(1);
    expect(triggers.match(/<Element Type="Trigger" Id="0000000A">/g)).toHaveLength(1);
    const before = await hashTree(mod.modPackage);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modPackage)).toEqual(before);
  });
});
