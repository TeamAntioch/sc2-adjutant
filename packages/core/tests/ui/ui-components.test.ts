// UI Components (ADR-0019): a Mod Blueprint turns one on in its `ui` field, overriding look fields,
// and compile-mod writes its layout (loaded by the DescIndex ahead of the Blueprint's files) and
// adds its library functions to the mod's library, with ids derived from the component's and
// function's names, a GUI interface in a "UI" folder and Galaxy bodies. Missions call them through
// Blueprint uiActions. The component is a fake (test-panel.ts) and Harbour-Story is synthetic.
import { readFile, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { readCompileRecord } from "../../src/map/mission-package.js";
import { compileMod } from "../../src/mods/compile-mod.js";
import { convertLibrary } from "../../src/mods/convert-library.js";
import { DESC_INDEX } from "../../src/mods/mod-package-files.js";
import { stableElementId } from "../../src/triggers/trigger-builders.js";
import type { UiLibraryContext } from "../../src/ui/ui-component.js";
import { cleanupMods, declare, hashTree, inPackage, setup } from "../mods/mod-fixture.js";
import { withHarbourLibrary } from "../mods/library-fixture.js";
import { TEST_PANEL } from "./test-panel.js";

afterEach(cleanupMods);

const golden = (name: string) => readFile(new URL(`./golden/${name}`, import.meta.url), "utf8");
const LAYOUT = "Base.SC2Data/UI/Layout/TestPanel.SC2Layout";
const QUAY = "Base.SC2Data/UI/Layout/Quay.SC2Layout";
const options = { uiComponents: [TEST_PANEL] };

/** Harbour-Story with its library's Ring Bell converted, a layout of its own in files, and `ui`. */
async function harbour(ui: Record<string, unknown>) {
  const mod = await setup();
  await withHarbourLibrary(mod);
  await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });
  await declare(mod, { ui, files: [{ path: QUAY, source: "UI/Layout/Quay.SC2Layout" }] }, { "UI/Layout/Quay.SC2Layout": "<Desc/>\n" });
  return mod;
}

describe("a UI Component's layout", () => {
  it("is written from its default look, and the DescIndex loads it ahead of the Blueprint's files", async () => {
    const mod = await harbour({ testPanel: {} });
    await compileMod(mod.blueprintPath, options);
    expect(await inPackage(mod, LAYOUT)).toBe(await golden("TestPanel-default.SC2Layout"));
    expect(await inPackage(mod, DESC_INDEX)).toBe(
      `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n<Desc>\r\n    <Include path="UI/Layout/TestPanel.SC2Layout"/>\r\n    <Include path="UI/Layout/Quay.SC2Layout"/>\r\n</Desc>\r\n`,
    );
  });

  it("takes the look fields the Blueprint overrides: colour, texture, font style and anchor", async () => {
    const mod = await harbour({ testPanel: { color: [200, 0, 0], texture: "Assets\\Textures\\ui_quay.dds", style: "@QuayTitle", anchor: { at: "topRight", x: -20, y: 40 } } });
    await compileMod(mod.blueprintPath, options);
    expect(await inPackage(mod, LAYOUT)).toBe(await golden("TestPanel-look.SC2Layout"));
  });

  it("refuses a component core doesn't have, and a look field the component doesn't", async () => {
    await expect(compileMod((await harbour({ toast: {} })).blueprintPath, options)).rejects.toThrow(/ui\.toast isn't a UI Component: the components are testPanel/);
    await cleanupMods();
    await expect(compileMod((await harbour({ testPanel: { colour: [1, 2, 3] } })).blueprintPath, options)).rejects.toThrow(/ui\.testPanel.*colour/);
  });

  it("refuses a layout of the Blueprint's files at the component's path", async () => {
    const mod = await harbour({ testPanel: {} });
    await declare(mod, { files: [{ path: LAYOUT, source: "UI/Layout/Quay.SC2Layout" }] });
    await expect(compileMod(mod.blueprintPath, options)).rejects.toThrow(/writes Base\.SC2Data\/UI\/Layout\/TestPanel\.SC2Layout twice, in ui\.testPanel and in files\.0/);
  });
});

describe("a Mod Blueprint's ui turning no component on", () => {
  it("owns nothing, so a Kept-only mod's compile leaves its package as it was and claims none of its files", async () => {
    const mod = await setup();
    const kept = await hashTree(mod.modPackage);
    await declare(mod, { ui: {} });
    const { record } = await compileMod(mod.blueprintPath, options);
    expect(await hashTree(mod.modPackage)).toEqual(kept);
    // Not DocumentInfo, DocumentHeader, the ComponentList nor the .version stamps: they stay Kept.
    expect(record.entries).toEqual([]);
    expect((await readCompileRecord(mod.blueprintPath))?.entries).toEqual([]);
  });
});

describe("a UI Component's library functions", () => {
  /** The generated part of each library file: the UI category's elements, the strings its ids name, and the functions' Galaxy. */
  async function generated(mod: Awaited<ReturnType<typeof harbour>>) {
    const triggers = await inPackage(mod, "Triggers");
    const strings = (await inPackage(mod, "enUS.SC2Data/LocalizedData/TriggerStrings.txt")).split("\r\n");
    const script = await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy");
    const header = await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy");
    return {
      root: triggers.split("\r\n").filter((line) => line.includes(`Id="1E220B14"/>`)),
      elements: triggers.slice(triggers.indexOf(`        <Element Type="Category" Id="1E220B14">`), triggers.indexOf("    </Library>")),
      strings: strings.filter((line) => /lib_Hbr1_(EC7798FC|E49F3270|73F7AAE3|1E220B14)=/.test(line)).map((line) => `${line}\r\n`).join(""),
      galaxy: script.slice(script.indexOf("void libHbr1_gf_ShowTestPanel"), script.indexOf("// Triggers")) + header.split(/(?<=\n)/).filter((line) => line.includes("TestPanel")).join(""),
    };
  }

  it("go in the mod's library with ids from the component's and function's names, a GUI interface in a UI folder and Galaxy bodies", async () => {
    const mod = await harbour({ testPanel: {} });
    await compileMod(mod.blueprintPath, options);
    const found = await generated(mod);
    expect(found.root).toEqual([`            <Item Type="Category" Library="Hbr1" Id="1E220B14"/>`]);
    expect(found.elements).toBe(await golden("TestPanel-Triggers.xml"));
    expect(found.strings).toBe(await golden("TestPanel-TriggerStrings.txt"));
    expect(found.galaxy).toBe(await golden("TestPanel-Lib.galaxy"));
  });

  it("keep their ids compile after compile, whatever the look, and a recompile changes nothing", async () => {
    const mod = await harbour({ testPanel: {} });
    await compileMod(mod.blueprintPath, options);
    const before = await hashTree(mod.modPackage);
    await compileMod(mod.blueprintPath, options);
    expect(await hashTree(mod.modPackage)).toEqual(before);

    await declare(mod, { ui: { testPanel: { color: [1, 2, 3] } } });
    await compileMod(mod.blueprintPath, options);
    expect((await generated(mod)).elements).toBe(await golden("TestPanel-Triggers.xml"));
  });

  it("can't be dropped by turning the component off once compiled, since Missions may call them", async () => {
    const mod = await harbour({ testPanel: {} });
    await compileMod(mod.blueprintPath, options);
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    delete blueprint.ui;
    await writeFile(mod.blueprintPath, JSON.stringify(blueprint));
    await expect(compileMod(mod.blueprintPath, options)).rejects.toThrow(/The function EC7798FC \(Show Test Panel\), which the last compile wrote, is gone from the interface/);
  });

  it("are refused where two components have a function of one Galaxy name", async () => {
    const mod = await harbour({ testPanel: {}, otherPanel: {} });
    const other = { ...TEST_PANEL, id: "otherPanel", name: "OtherPanel", actions: {} };
    await expect(compileMod(mod.blueprintPath, { uiComponents: [TEST_PANEL, other] })).rejects.toThrow(/The UI Components testPanel and otherPanel each have a function whose Galaxy name is libHbr1_gf_ShowTestPanel/);
  });

  it("are refused, saying so once, where one component has two functions of one Galaxy name", async () => {
    const mod = await harbour({ testPanel: {} });
    const twice = { ...TEST_PANEL, functions: () => [TEST_PANEL.functions({}, { galaxyName: (name) => name })[0]!, TEST_PANEL.functions({}, { galaxyName: (name) => name })[0]!] };
    const refusal = compileMod(mod.blueprintPath, { uiComponents: [twice] });
    await expect(refusal).rejects.toThrow(/The UI Component testPanel has two functions whose Galaxy name is libHbr1_gf_ShowTestPanel: .*give each of its functions a name of its own/);
    await expect(refusal).rejects.not.toThrow(/testPanel and testPanel/);
  });

  it("are refused where the mod declares no library for them to go in", async () => {
    const mod = await setup();
    await declare(mod, { ui: { testPanel: {} } });
    await expect(compileMod(mod.blueprintPath, options)).rejects.toThrow(/ui turns on testPanel, whose functions go in the mod's library: declare the library/);
  });

  it("are refused where one of the library's own functions has the Galaxy name of one", async () => {
    const mod = await harbour({ testPanel: {} });
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    blueprint.library.functions[0].identifier = "ShowTestPanel";
    await declare(mod, { library: blueprint.library });
    await expect(compileMod(mod.blueprintPath, options)).rejects.toThrow(/The library's function Ring Bell has the Galaxy name a UI Component's function Show Test Panel is given/);
  });
});

describe("a UI Component's script", () => {
  /** The Test Panel with state: a global of its script, and a helper that raises it. */
  const COUNTED = {
    ...TEST_PANEL,
    script: (_look: unknown, library: UiLibraryContext) => [`int ${library.scriptName("shown")};`, "", `void ${library.scriptName("count")} () {`, `    ${library.scriptName("shown")} += 1;`, "}"].join("\n"),
  };
  const counted = { uiComponents: [COUNTED] };
  const SCRIPT = stableElementId("ui/testPanel/script");

  it("goes in the mod's library as a Custom Script, filed first in the UI folder, and its Galaxy in the library's Custom Script section, before the functions", async () => {
    const mod = await harbour({ testPanel: {} });
    await compileMod(mod.blueprintPath, counted);
    const triggers = (await inPackage(mod, "Triggers")).split("\r\n");
    const category = triggers.indexOf(`        <Element Type="Category" Id="1E220B14">`);
    expect(triggers[category + 2]).toBe(`            <Item Type="CustomScript" Library="Hbr1" Id="${SCRIPT}"/>`);
    const element = triggers.indexOf(`        <Element Type="CustomScript" Id="${SCRIPT}">`);
    expect(triggers.slice(element, element + 9)).toEqual([
      `        <Element Type="CustomScript" Id="${SCRIPT}">`,
      `            <ScriptCode>`,
      `                int libHbr1_ui_testPanel_shown;`,
      ``,
      `                void libHbr1_ui_testPanel_count () {`,
      `                    libHbr1_ui_testPanel_shown += 1;`,
      `                }`,
      `            </ScriptCode>`,
      `        </Element>`,
    ]);
    expect(await inPackage(mod, "enUS.SC2Data/LocalizedData/TriggerStrings.txt")).toContain(`CustomScript/Name/lib_Hbr1_${SCRIPT}=TestPanel`);
    const galaxy = (await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).replace(/\r\n/g, "\n");
    expect(galaxy).toContain(
      [
        "    libNtve_InitVariables();",
        "}",
        "",
        "// Custom Script",
        "//--------------------------------------------------------------------------------------------------",
        "// Custom Script: TestPanel",
        "//--------------------------------------------------------------------------------------------------",
        "int libHbr1_ui_testPanel_shown;",
        "",
        "void libHbr1_ui_testPanel_count () {",
        "    libHbr1_ui_testPanel_shown += 1;",
        "}",
        "",
        "void libHbr1_InitCustomScript () {",
        "}",
        "",
        "// Presets",
        "// Functions",
      ].join("\n"),
    );
  });

  it("is replaced by a recompile, not added again", async () => {
    const mod = await harbour({ testPanel: {} });
    await compileMod(mod.blueprintPath, counted);
    const before = await hashTree(mod.modPackage);
    await compileMod(mod.blueprintPath, counted);
    expect(await hashTree(mod.modPackage)).toEqual(before);

    await compileMod(mod.blueprintPath, { uiComponents: [{ ...COUNTED, script: () => "int libHbr1_ui_testPanel_hidden;" }] });
    const galaxy = await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy");
    expect(galaxy).toContain("int libHbr1_ui_testPanel_hidden;");
    expect(galaxy).not.toContain("libHbr1_ui_testPanel_shown");
    expect(galaxy.match(/\/\/ Custom Script: TestPanel/g)).toHaveLength(1);
  });

  it("is replaced up to the library's InitCustomScript, and an InitCustomScript an Editor save gave a body is left as it is", async () => {
    const mod = await harbour({ testPanel: {} });
    await compileMod(mod.blueprintPath, counted);
    const file = `${mod.modPackage}/Base.SC2Data/LibHbr1.galaxy`;
    const init = "void libHbr1_InitCustomScript () {\n    harbourMain();\n}\n\n";
    await writeFile(file, (await readFile(file, "utf8")).replace(/void libHbr1_InitCustomScript \(\) \{\r?\n\}\r?\n\r?\n/, init));
    await compileMod(mod.blueprintPath, counted);
    const galaxy = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
    expect(galaxy).toContain(`    libHbr1_ui_testPanel_shown += 1;\n}\n\n${init}// Presets`);
    expect(galaxy.match(/InitCustomScript \(\)/g)).toHaveLength(1);
  });

  /** The Editor's Library Initialization, which the synthetic library's Galaxy lacks. */
  const INIT_LIB = [
    "//--------------------------------------------------------------------------------------------------",
    "// Library Initialization",
    "//--------------------------------------------------------------------------------------------------",
    "bool libHbr1_InitLib_completed = false;",
    "",
    "void libHbr1_InitLib () {",
    "    if (libHbr1_InitLib_completed) {",
    "        return;",
    "    }",
    "",
    "    libHbr1_InitLib_completed = true;",
    "",
    "    libHbr1_InitLibraries();",
    "    libHbr1_InitTriggers();",
    "}",
    "",
  ].join("\n");

  it("ends its section with an empty InitCustomScript, which InitLib calls before InitTriggers, as the Editor writes them for a library with a Custom Script", async () => {
    const mod = await harbour({ testPanel: {} });
    const file = `${mod.modPackage}/Base.SC2Data/LibHbr1.galaxy`;
    await writeFile(file, `${await readFile(file, "utf8")}${INIT_LIB}`);
    await compileMod(mod.blueprintPath, counted);
    const galaxy = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
    expect(galaxy).toContain("    libHbr1_ui_testPanel_shown += 1;\n}\n\nvoid libHbr1_InitCustomScript () {\n}\n\n// Presets\n");
    expect(galaxy).toContain("    libHbr1_InitLibraries();\n    libHbr1_InitCustomScript();\n    libHbr1_InitTriggers();\n}\n");
    // A recompile, or one after the Editor saves it so, changes nothing.
    const before = await hashTree(mod.modPackage);
    await compileMod(mod.blueprintPath, counted);
    expect(await hashTree(mod.modPackage)).toEqual(before);
  });

  it("leaves the library's Galaxy once its component is off, with the section, InitCustomScript and call the compile gave it, so nothing calls what's gone", async () => {
    const mod = await harbour({ testPanel: {} });
    const file = `${mod.modPackage}/Base.SC2Data/LibHbr1.galaxy`;
    const original = `${await readFile(file, "utf8")}${INIT_LIB}`;
    await writeFile(file, original);
    // A component with a script and no functions, which turning off doesn't drop a function of.
    const scriptOnly = { uiComponents: [{ ...COUNTED, functions: () => [], actions: {} }] };
    await compileMod(mod.blueprintPath, scriptOnly);
    expect(await readFile(file, "utf8")).toContain("// Custom Script: TestPanel");
    await declare(mod, { ui: {} });
    await compileMod(mod.blueprintPath, scriptOnly);
    const galaxy = await readFile(file, "utf8");
    expect(galaxy).not.toContain("Custom Script");
    expect(galaxy).not.toContain("libHbr1_ui_testPanel");
    expect(galaxy.replace(/\r\n/g, "\n")).toBe(original);
  });

  it("leaves the library's Galaxy when its component has none any more, and under its old name when its layout is renamed", async () => {
    const mod = await harbour({ testPanel: {} });
    const file = `${mod.modPackage}/Base.SC2Data/LibHbr1.galaxy`;
    await compileMod(mod.blueprintPath, counted);
    await compileMod(mod.blueprintPath, { uiComponents: [{ ...COUNTED, name: "HarbourPanel" }] });
    let galaxy = await readFile(file, "utf8");
    expect(galaxy).not.toContain("// Custom Script: TestPanel");
    expect(galaxy.match(/\/\/ Custom Script: HarbourPanel/g)).toHaveLength(1);
    expect(galaxy.match(/^int libHbr1_ui_testPanel_shown;/gm)).toHaveLength(1);

    await compileMod(mod.blueprintPath, options);
    galaxy = await readFile(file, "utf8");
    expect(galaxy).not.toContain("Custom Script");
    expect(galaxy).not.toContain("libHbr1_ui_testPanel_");
  });

  /** The package with a Kept Custom Script of the author's, `name`, in the library's folder, and its block in the Galaxy. */
  async function withKeptScript(mod: Awaited<ReturnType<typeof harbour>>, name: string): Promise<void> {
    const at = (file: string) => `${mod.modPackage}/${file}`;
    const triggers = await readFile(at("Triggers"), "utf8");
    await writeFile(
      at("Triggers"),
      triggers
        .replace(`            <Item Type="FunctionDef" Library="Hbr1" Id="0000C001"/>`, `            <Item Type="FunctionDef" Library="Hbr1" Id="0000C001"/>\r\n            <Item Type="CustomScript" Library="Hbr1" Id="0000D001"/>`)
        .replace("    </Library>", `        <Element Type="CustomScript" Id="0000D001">\r\n            <ScriptCode>\r\n                int harbourTide;\r\n            </ScriptCode>\r\n        </Element>\r\n    </Library>`),
    );
    const strings = at("enUS.SC2Data/LocalizedData/TriggerStrings.txt");
    await writeFile(strings, `${await readFile(strings, "utf8")}CustomScript/Name/lib_Hbr1_0000D001=${name}\r\n`);
    const block = ["// Custom Script", "//--------------------------------------------------------------------------------------------------", `// Custom Script: ${name}`, "//--------------------------------------------------------------------------------------------------", "int harbourTide;", "", "void libHbr1_InitCustomScript () {", "}", "", "// Presets"].join("\n");
    await writeFile(at("Base.SC2Data/LibHbr1.galaxy"), (await readFile(at("Base.SC2Data/LibHbr1.galaxy"), "utf8")).replace("// Presets", block));
  }

  it("leaves an author's Kept Custom Script's block as it is, the component's on or off", async () => {
    const mod = await harbour({ testPanel: {} });
    await withKeptScript(mod, "Harbour Tide");
    const file = `${mod.modPackage}/Base.SC2Data/LibHbr1.galaxy`;
    await compileMod(mod.blueprintPath, counted);
    const kept = "// Custom Script: Harbour Tide\n//--------------------------------------------------------------------------------------------------\nint harbourTide;\n\n";
    let galaxy = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
    expect(galaxy).toContain(kept);
    expect(galaxy).toContain("// Custom Script: TestPanel");
    expect(galaxy.match(/InitCustomScript \(\)/g)).toHaveLength(1);

    await compileMod(mod.blueprintPath, { uiComponents: [{ ...COUNTED, name: "HarbourPanel" }] });
    galaxy = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
    expect(galaxy).toContain(`${kept}//--------------------------------------------------------------------------------------------------\n// Custom Script: HarbourPanel\n`);
    expect(galaxy).not.toContain("// Custom Script: TestPanel");
    expect(galaxy).toContain("void libHbr1_InitCustomScript () {\n}\n\n// Presets");
  });

  it("is refused where the package has a Kept Custom Script of its name, whose block the compile would replace", async () => {
    const mod = await harbour({ testPanel: {} });
    await withKeptScript(mod, "TestPanel");
    await expect(compileMod(mod.blueprintPath, counted)).rejects.toThrow(/The package's Custom Script TestPanel \(0000D001\) has the name of a UI Component's script/);
  });

  it("is refused where one of the library's own Custom Scripts has its name", async () => {
    const mod = await harbour({ testPanel: {} });
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    await declare(mod, { library: { ...blueprint.library, customScripts: [{ id: "0000D020", name: "TestPanel", script: "int harbourTide;" }] } });
    await expect(compileMod(mod.blueprintPath, counted)).rejects.toThrow(/The library's Custom Script TestPanel has the name a UI Component's script is given/);
  });

  it("leaves the library's header to the Editor when it changes nothing there", async () => {
    const mod = await harbour({ testPanel: {} });
    // A library of no GUI function of its own, so only the component's script changes its Galaxy.
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    await declare(mod, { library: { ...blueprint.library, functions: [] } });
    const { record } = await compileMod(mod.blueprintPath, { uiComponents: [{ ...COUNTED, functions: () => [], actions: {} }] });
    expect(record.entries).toContainEqual(expect.objectContaining({ kind: "file", path: "Base.SC2Data/LibHbr1.galaxy" }));
    expect(record.entries).not.toContainEqual(expect.objectContaining({ kind: "file", path: "Base.SC2Data/LibHbr1_h.galaxy" }));
  });
});
