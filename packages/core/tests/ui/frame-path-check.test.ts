// The frame-path check on a mod package (ADR-0019, spec decision 7): each literal path its Galaxy
// and its Kept triggers' custom script pass to a hookup or template native, against the mod's own
// layouts, its UI Components' generated ones and Blizzard's frames. The package here is made up;
// its fade template is missing as a real mod's once was, a template no file defines.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkWorkspace, formatWorkspaceCheck } from "../../src/plugins/check-workspace.js";
import { uiComponentsOn } from "../../src/ui/components.js";
import { UI_COMPONENTS } from "../../src/ui/core-components.js";
import { componentUi, modFramePathWarnings, modFrameWarnings } from "../../src/ui/frame-path-check.js";
import { TEST_PANEL } from "./test-panel.js";

const BELL = fileURLToPath(new URL("../fixtures/workspaces/bell/", import.meta.url));

const layout = (body: string): string => `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n<Desc>\r\n${body}\r\n</Desc>\r\n`;

let modPackage: string;
beforeEach(async () => {
  modPackage = path.join(await mkdtemp(path.join(tmpdir(), "frame-path-check-")), "Harbour.SC2Mod");
  await mkdir(path.join(modPackage, "Base.SC2Data", "UI", "Layout"), { recursive: true });
  await mkdir(path.join(modPackage, "Base.SC2Data", "scripts"), { recursive: true });
});
afterEach(async () => rm(path.dirname(modPackage), { recursive: true, force: true }));

const put = (file: string, text: string) => writeFile(path.join(modPackage, file), text);
/** The package's ComponentList, naming its DescIndex, and the DescIndex including `layouts` (paths from Base.SC2Data). */
async function putDescIndex(layouts: readonly string[], descIndex = "UI/Layout/DescIndex.SC2Layout"): Promise<void> {
  await put("ComponentList.SC2Components", `<?xml version="1.0" encoding="utf-8"?>\n<Components>\n    <DataComponent Type="uiui">${descIndex}</DataComponent>\n</Components>\n`);
  await put(`Base.SC2Data/${descIndex}`, layout(layouts.map((file) => `    <Include path="${file}"/>`).join("\r\n")));
}

describe("modFramePathWarnings", () => {
  it("warns about a template no layout defines, once however many places pass it, and passes the mod's and Blizzard's frames", async () => {
    await put(
      "Base.SC2Data/UI/Layout/HarbourTemplates.SC2Layout",
      layout(`<Frame type="Frame" name="CrateTemplate"><Frame type="Image" name="Image"/></Frame>
    <Frame type="Frame" name="GameUI/UIContainer/FullscreenUpperContainer" file="GameUI"><Frame type="Frame" name="HarbourMenu"/></Frame>`),
    );
    await put(
      "Base.SC2Data/LibHarb.galaxy",
      [
        "void libHarb_gf_Fade () {",
        '    DialogControlCreateFromTemplate(lv_d, c_triggerControlTypePanel, "HarbourFade/FadeFrame");',
        '    DialogControlHookup(lv_fade, c_triggerControlTypeImage, "Image");',
        '    DialogControlCreateFromTemplate(lv_d, c_triggerControlTypePanel, "HarbourTemplates/CrateTemplate");',
        '    DialogControlHookupStandard(c_triggerControlTypePanel, "UIContainer/FullscreenUpperContainer/HarbourMenu");',
        '    DialogControlHookupStandard(c_triggerControlTypePanel, "UIContainer/ConsoleUIContainer");',
        "}",
      ].join("\r\n"),
    );
    await put("Base.SC2Data/scripts/fade.galaxy", '\n\n    DialogControlCreateFromTemplate(lv_d, c_triggerControlTypePanel, "HarbourFade/FadeFrame");\n');
    await putDescIndex(["UI/Layout/HarbourTemplates.SC2Layout"]);
    const warnings = await modFramePathWarnings(modPackage);
    expect(warnings).toEqual([
      expect.objectContaining({ file: path.join(modPackage, "Base.SC2Data/LibHarb.galaxy"), where: "line 2", native: "DialogControlCreateFromTemplate", path: "HarbourFade/FadeFrame", places: 2 }),
    ]);
    expect(warnings[0]!.message).toMatch(/^"HarbourFade\/FadeFrame", passed to DialogControlCreateFromTemplate \(and 1 other place\), is a template that neither the layouts the mod loads nor the game's define, so the call is likely to find nothing\./);
  });

  it("counts only the layouts the package's DescIndex includes, in any case and from any data folder, and none without one", async () => {
    const hookups = ["Dock", "Stray", "Locale"].map((name) => `    DialogControlCreateFromTemplate(lv_d, c_triggerControlTypePanel, "Harbour${name}/${name}Template");`);
    await put("Base.SC2Data/LibHarb.galaxy", hookups.join("\n"));
    for (const name of ["Dock", "Stray"]) await put(`Base.SC2Data/UI/Layout/Harbour${name}.SC2Layout`, layout(`<Frame type="Frame" name="${name}Template"/>`));
    await mkdir(path.join(modPackage, "enUS.SC2Data", "UI", "Layout"), { recursive: true });
    await put("enUS.SC2Data/UI/Layout/HarbourLocale.SC2Layout", layout(`<Frame type="Frame" name="LocaleTemplate"/>`));
    const missing = async (): Promise<string[]> => (await modFramePathWarnings(modPackage)).map((warning) => warning.path);

    expect(await missing()).toEqual(["HarbourDock/DockTemplate", "HarbourStray/StrayTemplate", "HarbourLocale/LocaleTemplate"]);
    await putDescIndex(["ui/layout/harbourdock.sc2layout", "UI\\Layout\\HarbourLocale.SC2Layout"]);
    expect(await missing()).toEqual(["HarbourStray/StrayTemplate"]);
    // A DescIndex the ComponentList doesn't name isn't the one the game reads.
    await put("ComponentList.SC2Components", `<Components>\n    <DataComponent Type="gada">GameData</DataComponent>\n</Components>\n`);
    expect(await missing()).toHaveLength(3);
  });
  it("warns about a frame of the game's UI that isn't there, and a frame relative to a panel no frame ends in", async () => {
    await put(
      "Base.SC2Data/LibHarb.galaxy",
      [
        '    DialogControlHookupStandard(c_triggerControlTypePanel, "UIContainer/ConsoleUIContainer/HarbourGauge");',
        '    DialogControlHookup(lv_panel, c_triggerControlTypeLabel, "HarbourGaugeLabel/Text");',
      ].join("\n"),
    );
    const warnings = await modFramePathWarnings(modPackage);
    expect(warnings.map(({ native, path, where }) => ({ native, path, where }))).toEqual([
      { native: "DialogControlHookupStandard", path: "UIContainer/ConsoleUIContainer/HarbourGauge", where: "line 1" },
      { native: "DialogControlHookup", path: "HarbourGaugeLabel/Text", where: "line 2" },
    ]);
  });

  it("reads the package's Kept triggers, their custom script and their GUI calls' path parameters, at their lines in the Triggers file", async () => {
    await put(
      "Triggers",
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<TriggerData>",
        '    <Element Type="CustomScript" Id="0000ABCD">',
        "        <ScriptCode>",
        "            DialogControlCreateInPanelFromTemplate(lv_p, c_triggerControlTypePanel, &quot;HarbourFade/FadeFrame&quot;);",
        "        </ScriptCode>",
        "    </Element>",
        '    <Element Type="Param" Id="1AE8D236">',
        '        <ParameterDef Type="ParamDef" Library="Ntve" Id="B68F0E3F"/>',
        '        <CustomType Type="layoutframe"/>',
        "        <ScriptCode>",
        "            &quot;HarbourGlow/GlowFrame&quot;",
        "        </ScriptCode>",
        "    </Element>",
        '    <Element Type="Param" Id="1AE8D237">',
        '        <ParameterDef Type="ParamDef" Library="Ntve" Id="AEF92396"/>',
        "        <Value>UIContainer\\HarbourBell</Value>",
        "    </Element>",
        "</TriggerData>",
      ].join("\r\n"),
    );
    const warnings = await modFramePathWarnings(modPackage);
    expect(warnings.map(({ file, where, native, path }) => ({ file, where, native, path }))).toEqual([
      { file: path.join(modPackage, "Triggers"), where: "line 5", native: "DialogControlCreateInPanelFromTemplate", path: "HarbourFade/FadeFrame" },
      { file: path.join(modPackage, "Triggers"), where: "line 8", native: "DialogControlCreateFromTemplate", path: "HarbourGlow/GlowFrame" },
      { file: path.join(modPackage, "Triggers"), where: "line 15", native: "DialogControlHookupStandard", path: "UIContainer/HarbourBell" },
    ]);
  });

  it("counts a Kept trigger's path where the package's Galaxy passes it, the Editor's copy of it, and the two template natives as one", async () => {
    await put(
      "Triggers",
      '<TriggerData>\n    <Element Type="Param" Id="1AE8D236">\n        <ParameterDef Type="ParamDef" Library="Ntve" Id="B68F0E3F"/>\n        <ScriptCode>&quot;HarbourFade/FadeFrame&quot;</ScriptCode>\n    </Element>\n</TriggerData>\n',
    );
    await put(
      "Base.SC2Data/LibHarb.galaxy",
      '    DialogControlCreateFromTemplate(lv_d, c_triggerControlTypePanel, "HarbourFade/FadeFrame");\n    DialogControlCreateInPanelFromTemplate(lv_p, c_triggerControlTypePanel, "harbourfade\\\\FadeFrame");\n',
    );
    const warnings = await modFramePathWarnings(modPackage);
    expect(warnings.map(({ file, where, places }) => ({ file, where, places }))).toEqual([{ file: path.join(modPackage, "Base.SC2Data/LibHarb.galaxy"), where: "line 1", places: 2 }]);
    expect(warnings[0]!.message).toContain("(and 1 other place)");
  });

  it("counts the frames of the layouts and the Galaxy the compile generates, such as its UI Components'", async () => {
    await put("Base.SC2Data/LibHarb.galaxy", '    DialogControlHookupStandard(c_triggerControlTypePanel, "UIContainer/ConsoleUIContainer/HarbourGauge/Bar");\n');
    const generated = {
      layouts: [{ file: "Base.SC2Data/UI/Layout/HarbourGauge.SC2Layout", content: layout(`<Frame type="Frame" name="GameUI/UIContainer/ConsoleUIContainer" file="GameUI"><Frame type="Frame" name="HarbourGauge"><Frame type="ProgressBar" name="Bar"/></Frame></Frame>`) }],
      galaxy: [{ file: "/elsewhere/blueprint.json", where: "ui.harbourGauge", text: '    DialogControlHookupStandard(c_triggerControlTypePanel, "UIContainer/ConsoleUIContainer/HarbourGauge/Lost");\n' }],
    };
    const warnings = await modFramePathWarnings(modPackage, generated);
    expect(warnings.map(({ path, file, where }) => ({ path, file, where }))).toEqual([{ path: "UIContainer/ConsoleUIContainer/HarbourGauge/Lost", file: path.resolve(modPackage, "/elsewhere/blueprint.json"), where: "ui.harbourGauge" }]);
  });

  it("counts a generated function's call once, at its component, not again in the package's compiled copy or its Triggers", async () => {
    const call = '        DialogControlHookupStandard(c_triggerControlTypePanel, "UIContainer/ConsoleUIContainer/HarbourGauge/Lost");';
    await put("Base.SC2Data/LibHarb.galaxy", ["void libHarb_gf_ShowGauge () {", call, "}", "void libHarb_gf_Own () {", call, "}"].join("\n"));
    await put("Triggers", `<TriggerData>\n    <Element Type="CustomScript" Id="0000ABCD">\n        <ScriptCode>\n${call.replace(/"/g, "&quot;")}\n        </ScriptCode>\n    </Element>\n</TriggerData>\n`);
    const generated = { galaxy: [{ file: "/elsewhere/blueprint.json", where: "ui.harbourGauge", text: call, function: "libHarb_gf_ShowGauge" }] };
    const warnings = await modFramePathWarnings(modPackage, generated);
    // The mod's own function passes it too: two places, the first the component's own.
    expect(warnings.map(({ file, where, places }) => ({ file, where, places }))).toEqual([{ file: path.join(modPackage, "Base.SC2Data/LibHarb.galaxy"), where: "line 5", places: 2 }]);
    await put("Base.SC2Data/LibHarb.galaxy", ["void libHarb_gf_ShowGauge () {", call, "}"].join("\n"));
    expect((await modFramePathWarnings(modPackage, generated)).map(({ file, where, places }) => ({ file, where, places }))).toEqual([{ file: path.resolve(modPackage, "/elsewhere/blueprint.json"), where: "ui.harbourGauge", places: 1 }]);
  });
});

describe("modFrameWarnings: a template below its user", () => {
  const templateOrder = async () => (await modFrameWarnings(modPackage)).flatMap((warning) => (warning.kind === "templateOrder" ? [{ file: path.basename(warning.file), frame: warning.frame, template: warning.template }] : []));

  it("warns about a frame made from a template its own file declares further down, naming the file, frame and template", async () => {
    await put(
      "Base.SC2Data/UI/Layout/HarbourGauge.SC2Layout",
      layout(`<Frame type="Frame" name="EarlyTemplate"/>
    <Frame type="Frame" name="Gauge">
        <Frame type="Frame" name="Early" template="HarbourGauge/EarlyTemplate"/>
        <Frame type="Frame" name="Late" template="harbourgauge/LateTemplate"/>
        <Frame type="Frame" name="Sub" template="HarbourGauge/Gauge/Inner"/>
        <Frame type="Frame" name="Inner"/>
    </Frame>
    <Frame type="Frame" name="LateTemplate"/>`),
    );
    await putDescIndex(["UI/Layout/HarbourGauge.SC2Layout"]);
    expect(await templateOrder()).toEqual([
      { file: "HarbourGauge.SC2Layout", frame: "HarbourGauge/Gauge/Late", template: "harbourgauge/LateTemplate" },
      { file: "HarbourGauge.SC2Layout", frame: "HarbourGauge/Gauge/Sub", template: "HarbourGauge/Gauge/Inner" },
    ]);
    const [warning] = await modFrameWarnings(modPackage);
    expect(warning!.message).toContain('"HarbourGauge/Gauge/Late" is made from the template "harbourgauge/LateTemplate", which HarbourGauge.SC2Layout declares further down');
  });

  it("passes a template declared first, one of another file in either order, and a frame of another file's name", async () => {
    await put("Base.SC2Data/UI/Layout/HarbourUser.SC2Layout", layout(`<Frame type="Frame" name="User" template="HarbourTemplates/Crate"/>\n    <Frame type="Frame" name="Twin" template="HarbourUser/Own"/>\n    <Frame type="Frame" name="Own"/>`));
    await put("Base.SC2Data/UI/Layout/HarbourTemplates.SC2Layout", layout(`<Frame type="Frame" name="Crate"/>`));
    await putDescIndex(["UI/Layout/HarbourUser.SC2Layout", "UI/Layout/HarbourTemplates.SC2Layout"]);
    // Own is below Twin in HarbourUser, so that one warns; the other file's template, below it in the DescIndex, doesn't.
    expect(await templateOrder()).toEqual([{ file: "HarbourUser.SC2Layout", frame: "HarbourUser/Twin", template: "HarbourUser/Own" }]);
  });

  it("reads a generated layout too, and a layout the DescIndex doesn't load not at all", async () => {
    await put("Base.SC2Data/UI/Layout/HarbourStray.SC2Layout", layout(`<Frame type="Frame" name="A" template="HarbourStray/B"/>\n    <Frame type="Frame" name="B"/>`));
    await putDescIndex([]);
    expect(await templateOrder()).toEqual([]);
    const generated = { layouts: [{ file: "Base.SC2Data/UI/Layout/HarbourGen.SC2Layout", content: layout(`<Frame type="Frame" name="A" template="HarbourGen/B"/>\n    <Frame type="Frame" name="B"/>`) }] };
    const warnings = await modFrameWarnings(modPackage, generated);
    expect(warnings.map((warning) => warning.kind === "templateOrder" && [warning.file, warning.frame])).toEqual([[path.resolve(modPackage, "Base.SC2Data/UI/Layout/HarbourGen.SC2Layout"), "HarbourGen/A"]]);
  });
});

describe("modFrameWarnings: a hookup's control type", () => {
  const mismatches = async () => (await modFrameWarnings(modPackage)).flatMap((warning) => (warning.kind === "controlType" ? [{ path: warning.path, controlType: warning.controlType, where: warning.where }] : []));
  const harbour = async (galaxy: string[]) => {
    await put(
      "Base.SC2Data/UI/Layout/HarbourGauge.SC2Layout",
      layout(`<Frame type="Frame" name="GameUI/UIContainer/ConsoleUIContainer" file="GameUI">
        <Frame type="Frame" name="HarbourGauge">
            <Frame type="Label" name="Title"/>
            <Frame type="Image" name="Icon"/>
            <Frame type="Frame" name="Plain"/>
            <Frame type="GlueButton" name="Special"/>
        </Frame>
    </Frame>
    <Frame type="Label" name="Template"/>`),
    );
    await put("Base.SC2Data/LibHarb.galaxy", galaxy.join("\n"));
    await putDescIndex(["UI/Layout/HarbourGauge.SC2Layout"]);
  };

  it("warns about a basic control type that is another basic type's frame, once per path and type, from each of the four natives", async () => {
    await harbour([
      'DialogControlHookupStandard(c_triggerControlTypeImage, "UIContainer/ConsoleUIContainer/HarbourGauge/Title");',
      'DialogControlHookup(lv_panel, c_triggerControlTypeLabel, "HarbourGauge/Icon");',
      'DialogControlHookup(lv_panel, c_triggerControlTypeLabel, "HarbourGauge/Icon");',
      'DialogControlCreateFromTemplate(lv_d, c_triggerControlTypeButton, "HarbourGauge/Template");',
      'DialogControlCreateInPanelFromTemplate(lv_p, c_triggerControlTypeImage, "HarbourGauge/Template");',
    ]);
    expect(await mismatches()).toEqual([
      { path: "UIContainer/ConsoleUIContainer/HarbourGauge/Title", controlType: "c_triggerControlTypeImage", where: "line 1" },
      { path: "HarbourGauge/Icon", controlType: "c_triggerControlTypeLabel", where: "line 2" },
      { path: "HarbourGauge/Template", controlType: "c_triggerControlTypeButton", where: "line 4" },
      { path: "HarbourGauge/Template", controlType: "c_triggerControlTypeImage", where: "line 5" },
    ]);
    const message = (await modFrameWarnings(modPackage)).find((warning) => warning.kind === "controlType")!.message;
    expect(message).toBe('"UIContainer/ConsoleUIContainer/HarbourGauge/Title", passed to DialogControlHookupStandard as c_triggerControlTypeImage, is a frame of type Label in the layouts the mod loads, so the hookup is likely to find nothing or the wrong control. Pass c_triggerControlTypeLabel for it, or change the frame\'s type.');
  });

  it("passes the type the frame has, a Panel for any frame, a plain Frame or a special type, a type given as an expression and a frame whose type isn't known", async () => {
    await harbour([
      'DialogControlHookupStandard(c_triggerControlTypeLabel, "UIContainer/ConsoleUIContainer/HarbourGauge/Title");',
      'DialogControlHookup(lv_panel, c_triggerControlTypePanel, "HarbourGauge/Icon");',
      'DialogControlHookup(lv_panel, c_triggerControlTypeImage, "HarbourGauge/Plain");',
      'DialogControlHookup(lv_panel, c_triggerControlTypeLabel, "HarbourGauge/Special");',
      "DialogControlHookup(lv_panel, lv_type, \"HarbourGauge/Icon\");",
      'DialogControlHookupStandard(c_triggerControlTypeImage, "UIContainer/ConsoleUIContainer");',
      'DialogControlHookupStandard(c_triggerControlTypeButton, "UIContainer/ConsoleUIContainer/ConsoleControlsPanel");',
    ]);
    expect(await mismatches()).toEqual([]);
  });

  it("leaves a hookup whose path no layout has to the path warning", async () => {
    await harbour(['DialogControlHookupStandard(c_triggerControlTypeImage, "UIContainer/ConsoleUIContainer/HarbourGauge/Gone");']);
    const warnings = await modFrameWarnings(modPackage);
    expect(warnings.map((warning) => warning.kind)).toEqual(["missing"]);
  });
});

describe("modFrameWarnings: core's UI Components", () => {
  it("raise none, all on at their default looks", async () => {
    const on = uiComponentsOn(Object.fromEntries(UI_COMPONENTS.map((component) => [component.id, {}])), UI_COMPONENTS);
    expect(on).toHaveLength(UI_COMPONENTS.length);
    expect(await modFrameWarnings(modPackage, componentUi(on, "/elsewhere/blueprint.json", "Harb"))).toEqual([]);
  });
});

describe("componentUi", () => {
  it("generates nothing for components on a Blueprint with no library, whose compile refuses them", () => {
    const on = [{ component: TEST_PANEL, look: TEST_PANEL.look.parse({}) }];
    expect(componentUi(on, "/elsewhere/blueprint.json", undefined)).toEqual({});
    const generated = componentUi(on, "/elsewhere/blueprint.json", "Harb");
    expect(generated.layouts).toHaveLength(1);
    expect(generated.galaxy?.map((source) => [source.where, source.function])).toEqual(expect.arrayContaining([["ui.testPanel", "libHarb_gf_ShowTestPanel"]]));
  });
});

describe("check", () => {
  it("warns about each mod's missing frame paths, counting its UI Components' generated layouts and Galaxy, and stays valid", async () => {
    // A copy of the bell Workspace, beside it so its Plugin's imports resolve, with the Test Panel on.
    const root = await mkdtemp(path.join(BELL, "..", ".bell-frames-"));
    try {
      await cp(BELL, root, { recursive: true });
      const blueprintFile = path.join(root, "mods", "bell-story", "blueprint.json");
      await writeFile(blueprintFile, JSON.stringify({ ...JSON.parse(await readFile(blueprintFile, "utf8")), ui: { testPanel: {} } }, null, 2));
      const galaxy = path.join(root, "mods", "bell-story", "Bell-Story.SC2Mod", "Base.SC2Data", "LibBel1.galaxy");
      await mkdir(path.dirname(galaxy), { recursive: true });
      await writeFile(galaxy, 'void libBel1_gf_Fade () {\n    DialogControlCreateFromTemplate(lv_d, c_triggerControlTypePanel, "BellFade/FadeFrame");\n}\n');

      const check = await checkWorkspace(root, { uiComponents: [TEST_PANEL] });
      const frames = check.problems.filter((problem) => /passed to DialogControl/.test(problem.message));
      expect(frames).toEqual([
        { mod: "bell-story", file: "mods/bell-story/Bell-Story.SC2Mod/Base.SC2Data/LibBel1.galaxy", path: "line 2", severity: "warning", message: expect.stringMatching(/^"BellFade\/FadeFrame", passed to DialogControlCreateFromTemplate, is a template/) },
      ]);
      expect(formatWorkspaceCheck(check)).toMatch(/are valid, with \d+ warning/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
