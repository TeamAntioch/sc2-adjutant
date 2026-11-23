// Every Campaign Mod library primitive's Galaxy through the template engine, in a map whose scope
// holds the mod's library (#974, ADR-0025), both ways: the same as the call each primitive's own
// `galaxy` wrote before it went (libraryPrimitives' lib<id>_gf_<identifier>(…), a bare identifier
// for a native one, kept here as `ownCall`), and as the snapshot of that. The libraries are the bell Workspace's Campaign Mod's, the
// Kept-calls fixture's and one here with every form a primitive is made for (the reference
// Workspace's Campaign Mod declares no library).
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { type LibraryInterface, LibraryInterfaceSchema } from "../../src/domain/library-interface.js";
import { gameTriggerLibraries, libraryFunctionName } from "../../src/mods/library-galaxy.js";
import { interfaceLibrary } from "../../src/mods/library-reach.js";
import { libraryPrimitives } from "../../src/mods/library.js";
import type { FunctionDef } from "../../src/triggers/trigger-catalog.js";
import type { TriggerCall } from "../../src/triggers/trigger-model.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";

const blueprintLibrary = async (file: string): Promise<LibraryInterface> =>
  LibraryInterfaceSchema.parse(JSON.parse(await readFile(new URL(`../fixtures/${file}`, import.meta.url), "utf8")).library);

const param = (id: string, name: string, type: string) => ({ id, name, type: { type } });
/** A library with a primitive of each form: native, threaded, hidden, a condition, a function's value, an event, no parameters, a unit's. */
const FORMS = LibraryInterfaceSchema.parse({
  id: "Frm1",
  name: "Forms",
  functions: [
    { id: "F0000001", name: "Two Args", kind: "action", parameters: [param("F0000002", "Count", "int"), param("F0000003", "Label Text", "string")], gui: "a.json" },
    { id: "F0000004", name: "No Args", kind: "action", gui: "a.json" },
    { id: "F0000005", name: "Threaded", kind: "action", flags: ["createThread"], parameters: [param("F0000006", "Where", "point")], gui: "a.json" },
    { id: "F0000007", name: "Hidden One", identifier: "HiddenOne", kind: "action", flags: ["hidden"], gui: "a.json" },
    { id: "F0000008", name: "Is Ready", kind: "condition", returns: { type: "bool" }, parameters: [param("F0000009", "Who", "unit")], gui: "a.json" },
    { id: "F000000A", name: "Count Of", kind: "function", returns: { type: "int" }, parameters: [param("F000000B", "Group", "unitgroup")], gui: "a.json" },
    { id: "F000000C", name: "Native Call", identifier: "NativeCall", kind: "action", flags: ["native"], parameters: [param("F000000D", "Value", "fixed")], galaxy: { path: "a.galaxy", source: "a.galaxy" } },
    { id: "F000000E", name: "Native Value", identifier: "NativeValue", kind: "function", flags: ["native"], returns: { type: "bool" }, galaxy: { path: "a.galaxy", source: "a.galaxy" } },
    { id: "F000000F", name: "Bell Rang", kind: "event", parameters: [param("F0000010", "Bell", "unit")], gui: "a.json" },
  ],
});

const libraries = [
  { name: "the bell Workspace's Bel1", library: await blueprintLibrary("workspaces/bell/mods/bell-story/blueprint.json") },
  { name: "the Kept-calls fixture's Cmpn", library: await blueprintLibrary("editor-triggers/mod-library-calls/mods/cmpn-story/blueprint.json") },
  { name: "Frm1, of every form", library: FORMS },
];

const primitives = libraries.flatMap(({ name, library }) => Object.entries(libraryPrimitives(library)).map(([identifier, def]) => [`${name}'s ${identifier}`, library, def] as const));
// An event's own galaxy leaves out the trigger it binds to, which the engine passes first: it stays (below).
const cases = primitives.filter(([, , def]) => def.kind !== "event");

/** A call to `def`, each parameter given its key as a string, so the order they're written in shows. */
const callTo = (def: FunctionDef): TriggerCall => ({
  id: "20000001",
  def,
  params: Object.fromEntries(Object.entries(def.params).map(([key, { id }], index) => [key, { id: `3000000${index}`, value: { kind: "string", value: key } }])),
});

/** `def` without Galaxy of its own, so the engine writes it. */
const fromTemplate = ({ galaxy: _own, ...def }: FunctionDef): FunctionDef => def;

/** `def` with the Galaxy of its own libraryPrimitives gave it before #974: its name, its arguments in their order. */
function ownCall(library: LibraryInterface, def: FunctionDef): FunctionDef {
  const name = libraryFunctionName(library.id, library.functions.find((fn) => fn.id === def.id)!);
  return { ...def, galaxy: (args) => `${name}(${Object.keys(def.params).map((key) => args[key]).join(", ")})` };
}

/**
 * The Galaxy of the trigger gt_Test calling `def`, with `library` in reach: its function, `def` a
 * condition among its conditions or an action or a value among its actions; or for an event, its
 * _Init, which adds it.
 */
function written(library: LibraryInterface, def: FunctionDef): string {
  const call = callTo(def);
  const script = writeMapScript({
    mapName: "Library",
    triggers: {
      variables: [],
      triggers: [{ id: "DDDD0011", name: "Test", events: def.kind === "event" ? [call] : [], ...(def.kind === "condition" ? { conditions: [call] } : {}), actions: def.kind === "action" || def.kind === "function" ? [call] : [] }],
    },
    libraries: { ...gameTriggerLibraries(), [library.id]: interfaceLibrary(library) },
  });
  return def.kind === "event" ? script.slice(script.indexOf("void gt_Test_Init"), script.indexOf("// Trigger Initialization")) : script.slice(script.indexOf("bool gt_Test_Func"), script.indexOf("void gt_Test_Init"));
}

describe("a Campaign Mod's library primitives through the templates", () => {
  it("are made for every library here", () => {
    expect(libraries.map(({ library }) => Object.keys(libraryPrimitives(library)).length)).toEqual([1, 3, 9]);
  });

  it.each(cases)("writes %s from its template as its own galaxy did", (_name, library, def) => {
    const fromEngine = written(library, fromTemplate(def));
    expect(fromEngine).toBe(written(library, ownCall(library, def)));
    expect(fromEngine).toMatchSnapshot();
  });

  it("leaves Galaxy of its own only to an event, which the engine would write with the trigger it binds to first", () => {
    expect(primitives.filter(([, , def]) => def.galaxy !== undefined).map(([name]) => name)).toEqual(["Frm1, of every form's BellRang"]);
    const event = libraryPrimitives(FORMS)["BellRang"]!;
    expect(written(FORMS, event)).toContain('    libFrm1_gf_BellRang("bell");');
    expect(written(FORMS, fromTemplate(event))).toContain('    libFrm1_gf_BellRang(gt_Test, "bell");');
  });
});
