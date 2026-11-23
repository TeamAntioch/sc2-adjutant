// The frame-path check (ADR-0019, spec decision 7): the frames a mod's layouts and Blizzard's
// declare, the literal paths Galaxy passes to the hookup and template natives, and which of those
// no layout has. The layouts here are made up, in the forms Blizzard's and the Editor's use.
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { FRAME_PATH_NATIVES, framePathCalls, FrameTree } from "../../src/ui/frame-paths.js";

const layout = (body: string): string => `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n<Desc>\r\n${body}\r\n</Desc>\r\n`;

describe("FrameTree", () => {
  it("names every frame by its file and its path from the file's top, in any case and either separator", () => {
    const tree = new FrameTree().addLayouts([
      {
        name: "HarbourPanel",
        xml: layout(`
    <Constant name="Width" val="400"/>
    <Frame type="Frame" name="Dock">
        <Anchor relative="$parent"/>
        <Frame type="Label" name="Title"/>
        <Frame type="Frame" name="Row">
            <Frame type="Image" name="Icon"/>
        </Frame>
    </Frame>`),
      },
    ]);
    expect(["HarbourPanel/Dock", "HarbourPanel/Dock/Title", "HarbourPanel/Dock/Row/Icon", "harbourpanel\\dock\\row"].map((path) => tree.has(path))).toEqual([true, true, true, true]);
    expect(["HarbourPanel", "HarbourPanel/Row", "HarbourPanel/Dock/Icon", "Dock/Title", "HarbourPanel/Width"].map((path) => tree.has(path))).toEqual([false, false, false, false, false]);
  });

  it("puts a frame declared with file= in that file, in the nested and the flat override forms", () => {
    const tree = new FrameTree().addLayouts([
      {
        name: "HarbourUI",
        xml: layout(`
    <Frame type="GameUI" name="GameUI" file="GameUI">
        <Frame type="Frame" name="Quay"/>
    </Frame>
    <Frame type="Frame" name="GameUI/UIContainer/ConsoleUIContainer" file="GameUI">
        <Frame type="Frame" name="Crane"/>
    </Frame>`),
      },
    ]);
    expect(tree.has("GameUI/GameUI/Quay")).toBe(true);
    expect(tree.has("GameUI/GameUI/UIContainer/ConsoleUIContainer/Crane")).toBe(true);
    expect(tree.has("HarbourUI/GameUI")).toBe(false);
  });

  it("gives a frame made from a template the template's frames, through templates of templates, in any file order", () => {
    const tree = new FrameTree().addLayouts([
      { name: "HarbourUI", xml: layout(`<Frame type="Frame" name="Crate" template="HarbourTemplates/CrateTemplate"><Frame type="Label" name="Tag"/></Frame>`) },
      {
        name: "HarbourTemplates",
        xml: layout(`
    <Frame type="Frame" name="BoxTemplate"><Frame type="Frame" name="Lid"><Frame type="Image" name="Hinge"/></Frame></Frame>
    <Frame type="Frame" name="CrateTemplate" template="HarbourTemplates/BoxTemplate"><Frame type="Image" name="Slats"/></Frame>`),
      },
    ]);
    expect(["HarbourUI/Crate/Tag", "HarbourUI/Crate/Slats", "HarbourUI/Crate/Lid/Hinge", "HarbourTemplates/CrateTemplate/Lid"].map((path) => tree.has(path))).toEqual([true, true, true, true]);
    expect(tree.has("HarbourUI/Crate/Hinge")).toBe(false);
    expect(tree.has("HarbourTemplates/BoxTemplate/Slats")).toBe(false);
  });

  it("survives templates that name themselves or each other", () => {
    const tree = new FrameTree().addLayouts([
      { name: "Loops", xml: layout(`<Frame type="Frame" name="A" template="Loops/B"><Frame type="Frame" name="InA"/></Frame><Frame type="Frame" name="B" template="Loops/A"/><Frame type="Frame" name="C" template="Loops/C"/>`) },
    ]);
    expect(tree.has("Loops/B/InA")).toBe(true);
    expect(tree.has("Loops/C/Nothing")).toBe(false);
    expect(tree.has("Loops/A/Nothing")).toBe(false);
  });

  it("finds a cycle's frames' sources whichever of them is looked up first", () => {
    // A → B → C → A, and B → D: each of A, B and C has D's frame, through the cycle.
    const loops = { name: "Loops", xml: layout(`<Frame type="Frame" name="A" template="Loops/B"/><Frame type="Frame" name="B" template="Loops/C"><Frame type="Frame" name="InB"/></Frame><Frame type="Frame" name="B" template="Loops/D"/><Frame type="Frame" name="C" template="Loops/A"/><Frame type="Frame" name="D"><Frame type="Frame" name="InD"/></Frame>`) };
    const orders = [
      ["Loops/A/InD", "Loops/B/InD", "Loops/C/InD"],
      ["Loops/C/InD", "Loops/A/InD", "Loops/B/InD"],
      ["Loops/B/InD", "Loops/C/InD", "Loops/A/InD"],
    ];
    for (const order of orders) {
      const tree = new FrameTree().addLayouts([loops]);
      expect(order.map((path) => tree.has(path))).toEqual([true, true, true]);
      expect(["Loops/C/InB", "Loops/A/InB", "Loops/D/InB"].map((path) => tree.has(path))).toEqual([true, true, false]);
    }
  });

  it("has its base's frames and its own when made over a tree, and leaves the base as it was", () => {
    const base = new FrameTree().addLayouts([
      { name: "GameUI", xml: layout(`<Frame type="Frame" name="GameUI"><Frame type="Frame" name="UIContainer"/></Frame><Frame type="Frame" name="ButtonTemplate" template="Stock/Lit"><Frame type="Image" name="Normal"/></Frame>`) },
      { name: "Stock", xml: layout(`<Frame type="Frame" name="Lit"><Frame type="Image" name="Glow"/></Frame>`) },
    ]);
    const harbour = FrameTree.over(base).addLayouts([
      { name: "Harbour", xml: layout(`<Frame type="Frame" name="GameUI/UIContainer" file="GameUI"><Frame type="Frame" name="Dock"/></Frame><Frame type="Frame" name="Go" template="GameUI/ButtonTemplate"/>`) },
    ]);
    expect(["GameUI/GameUI/UIContainer/Dock", "GameUI/GameUI/UIContainer", "Harbour/Go/Normal", "Harbour/Go/Glow"].map((path) => harbour.has(path))).toEqual([true, true, true, true]);
    expect(["Dock", "UIContainer/Dock", "Go/Glow", "ButtonTemplate/Glow"].map((path) => harbour.endsWith(path))).toEqual([true, true, true, true]);
    expect(["GameUI/GameUI/UIContainer/Dock", "Harbour/Go"].map((path) => base.has(path))).toEqual([false, false]);
    expect(base.endsWith("Dock")).toBe(false);
    const bell = FrameTree.over(base);
    expect(["GameUI/GameUI/UIContainer/Dock", "GameUI/ButtonTemplate/Glow"].map((path) => bell.has(path))).toEqual([false, true]);
  });

  it("finds a path relative to an unknown frame when some frame's path ends in it", () => {
    const tree = new FrameTree().addLayouts([
      { name: "HarbourTemplates", xml: layout(`<Frame type="Frame" name="Base"><Frame type="Image" name="Image"/></Frame><Frame type="Frame" name="Crate" template="HarbourTemplates/Base"/>`) },
    ]);
    expect(["Image", "Crate/Image", "Base/Image"].map((path) => tree.endsWith(path))).toEqual([true, true, true]);
    expect(["Lid", "Image/Crate", "HarbourTemplates"].map((path) => tree.endsWith(path))).toEqual([false, false, false]);
  });

  it("writes itself as the snapshot stores it and reads that back, templates kept", () => {
    const tree = new FrameTree().addLayouts([
      { name: "Stock", xml: layout(`<Frame type="Button" name="ButtonTemplate"><Frame type="Image" name="NormalImage"/></Frame><Frame type="Button" name="Go" template="Stock/ButtonTemplate"/>`) },
    ]);
    const snapshot = tree.toSnapshot();
    expect(snapshot).toEqual({ Stock: { ButtonTemplate: { NormalImage: {} }, Go: { "@template": "Stock/ButtonTemplate" } } });
    const read = FrameTree.fromSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(read.has("Stock/Go/NormalImage")).toBe(true);
    // A mod's layouts beside the snapshot's frames use its templates.
    read.addLayouts([{ name: "HarbourUI", xml: layout(`<Frame type="Button" name="Ok" template="Stock/ButtonTemplate"/>`) }]);
    expect(read.has("HarbourUI/Ok/NormalImage")).toBe(true);
  });
});

describe("framePathCalls", () => {
  it("finds the literal path each of the four natives is passed, with its line, as a string or through ConvertStringToUILayoutFrameName", () => {
    const galaxy = [
      "void lib1_gf_ShowDock () {",
      '    int lv_d = DialogControlHookupStandard(c_triggerControlTypePanel, "UIContainer/ConsoleUIContainer");',
      '    DialogControlHookup(DialogControlHookupStandard(c_triggerControlTypePanel, "WorldPanel"), c_triggerControlTypeLabel, libNtve_gf_ConvertStringToUILayoutFrameName("Dock\\\\Title"));',
      '    DialogControlCreateFromTemplate(lv_d, c_triggerControlTypePanel, "HarbourTemplates/CrateTemplate");',
      "    DialogControlCreateInPanelFromTemplate(lv_d, c_triggerControlTypePanel,",
      '        "HarbourTemplates/Row");',
      "}",
    ].join("\r\n");
    expect(framePathCalls(galaxy)).toEqual([
      { native: "DialogControlHookupStandard", path: "UIContainer/ConsoleUIContainer", line: 2, function: "lib1_gf_ShowDock" },
      { native: "DialogControlHookup", path: "Dock/Title", line: 3, function: "lib1_gf_ShowDock" },
      { native: "DialogControlHookupStandard", path: "WorldPanel", line: 3, function: "lib1_gf_ShowDock" },
      { native: "DialogControlCreateFromTemplate", path: "HarbourTemplates/CrateTemplate", line: 4, function: "lib1_gf_ShowDock" },
      { native: "DialogControlCreateInPanelFromTemplate", path: "HarbourTemplates/Row", line: 5, function: "lib1_gf_ShowDock" },
    ]);
  });

  it("names the function each call is in, and none for a call outside one", () => {
    const galaxy = [
      'const int lib1_gv_Dock = DialogControlHookupStandard(c_triggerControlTypePanel, "Top");',
      "bool lib1_gf_Open (int lp_d) {",
      "    if (lp_d > 0) {",
      '        DialogControlHookupStandard(c_triggerControlTypePanel, "Inner");',
      "    }",
      '    DialogControlHookupStandard(c_triggerControlTypePanel, "After");',
      "    return true;",
      "}",
      "void lib1_gf_Close () {",
      '    DialogControlHookupStandard(c_triggerControlTypePanel, "Second");',
      "}",
    ].join("\n");
    expect(framePathCalls(galaxy).map((call) => [call.path, call.function])).toEqual([
      ["Top", undefined],
      ["Inner", "lib1_gf_Open"],
      ["After", "lib1_gf_Open"],
      ["Second", "lib1_gf_Close"],
    ]);
  });

  it("leaves out a path built at run time, a call in a comment and a native's name in a string", () => {
    const galaxy = [
      '    DialogControlHookup(lv_menu, c_triggerControlTypeCheckBox, "Tab/CheckBox_" + IntToString(i));',
      "    DialogControlCreateFromTemplate(lv_d, c_triggerControlTypePanel, lv_template);",
      '    // DialogControlHookup(lv_menu, c_triggerControlTypeButton, "CloseButton");',
      '    /* DialogControlHookupStandard(c_triggerControlTypePanel, "Gone"); */',
      '    TextExpressionSetToken("DialogControlHookup(x, y, \\"Quoted\\")");',
    ].join("\n");
    expect(framePathCalls(galaxy)).toEqual([]);
  });

  it("keeps counting lines past an unclosed string and a backslash at a line's end", () => {
    const galaxy = ['    string lv_a = "unclosed;', '    string lv_b = "ends in \\', '";', '    DialogControlHookupStandard(c_triggerControlTypePanel, "WorldPanel");'].join("\n");
    expect(framePathCalls(galaxy)).toEqual([{ native: "DialogControlHookupStandard", path: "WorldPanel", line: 4 }]);
  });
});

describe("FRAME_PATH_NATIVES", () => {
  it("give each native's path parameter as the game's library defines it", async () => {
    const { libraries } = JSON.parse(await readFile(new URL("../../data/trigger-libraries.json", import.meta.url), "utf8"));
    const functions = Object.values(libraries.Ntve.functions) as { identifier: string; params: string[] }[];
    for (const [native, { argument, paramDef }] of Object.entries(FRAME_PATH_NATIVES)) {
      expect(functions.find((fn) => fn.identifier === native)?.params[argument], native).toBe(paramDef);
    }
  });
});
