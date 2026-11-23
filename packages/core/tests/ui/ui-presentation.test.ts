// UI Components are campaign presentation (ADR-0019): a component may have no layout, writing only
// its functions and script, and its functions may return a value, and wait, as a GUI function
// that isn't a condition can. The components are fakes and Harbour-Story is synthetic.
import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { compileMod } from "../../src/mods/compile-mod.js";
import { convertLibrary } from "../../src/mods/convert-library.js";
import { DESC_INDEX } from "../../src/mods/mod-package-files.js";
import { stableElementId } from "../../src/triggers/trigger-builders.js";
import { componentLibrary, uiComponentsOn } from "../../src/ui/components.js";
import { defineUiComponent } from "../../src/ui/ui-component.js";
import { cleanupMods, declare, inPackage, setup } from "../mods/mod-fixture.js";
import { withHarbourLibrary } from "../mods/library-fixture.js";
import { TEST_PANEL } from "./test-panel.js";

afterEach(cleanupMods);

const golden = (name: string) => readFile(new URL(`./golden/${name}`, import.meta.url), "utf8");

/**
 * The Test Beat: a component with no layout, whose script keeps whether it is playing, whose
 * Play Test Beat waits and returns the pick, and whose Test Beat Is Playing returns a boolean.
 */
const TEST_BEAT = defineUiComponent({
  id: "testBeat",
  name: "TestBeat",
  look: z.object({}).strict(),
  script: (_look, library) => `bool ${library.scriptName("playing")};`,
  functions: (_look, library) => [
    {
      name: "Play Test Beat",
      grammar: "Play the test beat with (~options~) options",
      hint: "Plays the test beat, waiting for it to end, and gives the option picked.",
      parameters: [{ name: "Options", type: { type: "int" } }],
      returns: { type: "int" },
      galaxy: [
        `${library.scriptName("playing")} = true;`,
        "Wait(2.0, c_timeReal);",
        `${library.scriptName("playing")} = false;`,
        `return lp_options;`,
      ].join("\n"),
    },
    {
      name: "Test Beat Is Playing",
      hint: "Whether the test beat is playing.",
      returns: { type: "bool" },
      galaxy: `return ${library.scriptName("playing")};`,
    },
  ],
  actions: {},
});

const options = { uiComponents: [TEST_PANEL, TEST_BEAT] };

/** Harbour-Story with its library's Ring Bell converted, and `ui`. */
async function harbour(ui: Record<string, unknown>) {
  const mod = await setup();
  await withHarbourLibrary(mod);
  await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });
  await declare(mod, { ui });
  return mod;
}

const exists = (mod: Awaited<ReturnType<typeof harbour>>, file: string) =>
  inPackage(mod, file).then(
    () => true,
    () => false,
  );

describe("a UI Component with no layout", () => {
  it("writes no layout file and no DescIndex, when it is the only component on", async () => {
    const mod = await harbour({ testBeat: {} });
    const { record } = await compileMod(mod.blueprintPath, options);
    expect(await exists(mod, "Base.SC2Data/UI/Layout/TestBeat.SC2Layout")).toBe(false);
    expect(await exists(mod, DESC_INDEX)).toBe(false);
    expect(record.entries.some((entry) => entry.kind === "file" && /SC2Layout$/i.test(entry.path))).toBe(false);
  });

  it("adds nothing to the DescIndex beside a component with a layout", async () => {
    const mod = await harbour({ testPanel: {}, testBeat: {} });
    await compileMod(mod.blueprintPath, options);
    expect(await inPackage(mod, DESC_INDEX)).toBe(`<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n<Desc>\r\n    <Include path="UI/Layout/TestPanel.SC2Layout"/>\r\n</Desc>\r\n`);
  });

  it("still compiles its script, named for the component, and its functions, into the UI folder", async () => {
    const mod = await harbour({ testBeat: {} });
    await compileMod(mod.blueprintPath, options);
    const galaxy = await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy");
    expect(galaxy).toContain("// Custom Script: TestBeat");
    expect(galaxy).toContain("bool libHbr1_ui_testBeat_playing;");
    expect(galaxy).toContain("int libHbr1_gf_PlayTestBeat (int lp_options) {");
  });
});

describe("a UI Component's function that returns a value", () => {
  it("is a library function of kind function, with its return type, not an action", () => {
    const generated = componentLibrary("Hbr1", uiComponentsOn({ testBeat: {} }, [TEST_BEAT]));
    const play = generated.functions.find((fn) => fn.name === "Play Test Beat")!;
    expect(play).toMatchObject({ id: stableElementId("ui/testBeat/Play Test Beat"), kind: "function", returns: { type: "int" }, flags: [] });
    expect(generated.functions.find((fn) => fn.name === "Test Beat Is Playing")).toMatchObject({ kind: "function", returns: { type: "bool" } });
    // One with no return type stays an action, as the boss bar's and toast's are.
    expect(componentLibrary("Hbr1", uiComponentsOn({ testPanel: {} }, [TEST_PANEL])).functions.map((fn) => [fn.kind, fn.returns])).toEqual([
      ["action", undefined],
      ["action", undefined],
    ]);
  });

  it("is written as FlagCall with its ReturnType, and its Galaxy returns the value after waiting, as the golden has it", async () => {
    const mod = await harbour({ testBeat: {} });
    await compileMod(mod.blueprintPath, options);
    const triggers = await inPackage(mod, "Triggers");
    const element = (id: string) => {
      const start = triggers.indexOf(`        <Element Type="FunctionDef" Id="${id}">`);
      return triggers.slice(start, triggers.indexOf("        </Element>", start));
    };
    const play = element(stableElementId("ui/testBeat/Play Test Beat"));
    expect(play).toContain("<FlagCall/>");
    expect(play).not.toContain("<FlagAction/>");
    expect(play).toContain(`<ReturnType>\r\n                <Type Value="int"/>\r\n            </ReturnType>`);
    expect(element(stableElementId("ui/testBeat/Test Beat Is Playing"))).toContain(`<ReturnType>\r\n                <Type Value="bool"/>\r\n            </ReturnType>`);

    const script = await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy");
    const header = await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy");
    const rule = "//--------------------------------------------------------------------------------------------------\n";
    const generated = script.slice(script.indexOf(`${rule}// Custom Script: TestBeat`), script.indexOf("// Presets")) + script.slice(script.indexOf("int libHbr1_gf_PlayTestBeat"), script.indexOf("// Triggers"));
    expect(generated + header.split(/(?<=\n)/).filter((line) => line.includes("TestBeat")).join("")).toBe(await golden("TestBeat-Lib.galaxy"));
  });

  it("is refused where it runs in its own thread, which can't hand a value back", () => {
    const threaded = { ...TEST_BEAT, functions: () => [{ name: "Play Test Beat", returns: { type: "int" }, createThread: true, galaxy: "return 1;" }] };
    expect(() => componentLibrary("Hbr1", uiComponentsOn({ testBeat: {} }, [threaded]))).toThrow(/The UI Component testBeat's function Play Test Beat returns a value and runs in its own thread/);
  });

  it("is refused as what a Blueprint trigger action calls, since an action can't take the value it returns", () => {
    const acted = { ...TEST_BEAT, actions: { playTestBeat: { function: "Play Test Beat", params: z.object({}).strict(), args: () => ({}) } } };
    expect(() => componentLibrary("Hbr1", uiComponentsOn({ testBeat: {} }, [acted]))).toThrow(/The UI Component testBeat's action playTestBeat calls Play Test Beat, which returns a value/);
  });
});
