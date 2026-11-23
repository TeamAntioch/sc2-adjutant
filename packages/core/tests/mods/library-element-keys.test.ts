// A mod library's elements keyed by type and Id (#1002). An older Editor numbers each element type
// apart, so Swarm Story Util's E859A89C is both a FunctionCall (in a trigger) and a FunctionDef
// (ZSS_PlayStoryModeEntryScenes), and the function's body has calls and Params sharing Ids the same
// way. The fixture is cut from the game's Swarm Story Util (see the fixtures' README).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { functionXml, libraryElementOf, libraryElements, readLibraryFunction, stringTable } from "../../src/mods/library-xml.js";
import { xmlAttribute } from "../../src/util/xml.js";

const MOD = fileURLToPath(new URL("../fixtures/editor-triggers/library-shared-ids/campaigns/swarmstoryutil.sc2mod/", import.meta.url));
const LIBRARY = "281DEC45";
const PLAY_ENTRY_SCENES = "E859A89C";

async function swarmStoryUtil() {
  const xml = await readFile(path.join(MOD, "Triggers"), "utf8");
  const strings = stringTable(await readFile(path.join(MOD, "enus.sc2data", "localizeddata", "triggerstrings.txt"), "utf8"));
  const saved = [...xml.matchAll(/^ {8}<Element Type="\w+" Id="[0-9A-F]{8}">\n[\s\S]*?^ {8}<\/Element>$/gm)].map((match) => match[0]);
  return { xml, strings, saved, elements: libraryElements(xml, LIBRARY) };
}

describe("a mod library's elements that share an Id", () => {
  it("are each held, by type and Id, so neither hides the other", async () => {
    const { elements } = await swarmStoryUtil();

    const shared = [...elements.values()].filter((node) => xmlAttribute(node, "Id") === PLAY_ENTRY_SCENES).map((node) => xmlAttribute(node, "Type"));

    expect(shared).toEqual(["FunctionCall", "FunctionDef"]);
  });

  it("are looked up by their type", async () => {
    const { elements } = await swarmStoryUtil();

    const call = libraryElementOf(elements, "FunctionCall", PLAY_ENTRY_SCENES)!;
    const def = libraryElementOf(elements, "FunctionDef", PLAY_ENTRY_SCENES)!;

    // The call is the trigger's, to Ntve's Switch; the definition's first line is its <Internal/> flag.
    expect(call.children.map((child) => child.name)).toEqual(["FunctionDef", "SubFunctionType", "Parameter", "Parameter", "Parameter"]);
    expect(xmlAttribute(call.children[0]!, "Id")).toBe("67CE2CB7");
    expect(def.children[0]!.name).toBe("Internal");
    expect(libraryElementOf(elements, "Param", PLAY_ENTRY_SCENES)).toBeUndefined();
  });

  it("let the function be read and written back as the Editor saved it, its calls and Params beside other types' with their Ids", async () => {
    const { elements, strings, saved } = await swarmStoryUtil();
    const { fn, body } = readLibraryFunction(elements, strings, LIBRARY, PLAY_ENTRY_SCENES);

    const xml = functionXml(LIBRARY, fn, body).elements;

    expect(fn.name).toBe("ZSS_PlayStoryModeEntryScenes");
    // The cut keeps the other types' elements earlier in the file and the called functions' interfaces among its own: those aren't the function's.
    const own = new Set(xml);
    expect(saved.filter((element) => own.has(element))).toEqual(xml);
    expect(xml[0]).toBe(saved.find((element) => element.startsWith(`        <Element Type="FunctionDef" Id="${PLAY_ENTRY_SCENES}">`)));
  });
});
