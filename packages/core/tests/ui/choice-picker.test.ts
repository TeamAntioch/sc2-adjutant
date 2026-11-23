// The choice picker, core's UI Component `ui.choicePicker` (spec #652 decisions 3, 4 and 7): a hidden
// panel in FullscreenUpperContainer with a dim, LotV's hex-glow backdrop, a header and a prompt over
// one card set per count (1, 2 or 3 cards); Set Choice Option, Show Choice Picker (which waits for a
// pick and returns it), Hide Choice Picker and Choice Picker Is Open in the mod's library; and the
// script holding the hookups and the click, hover and key triggers. Harbour-Story is synthetic.
import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { compileMod } from "../../src/mods/compile-mod.js";
import { convertLibrary } from "../../src/mods/convert-library.js";
import { DESC_INDEX } from "../../src/mods/mod-package-files.js";
import { componentLibrary, uiComponentsOn } from "../../src/ui/components.js";
import { UI_COMPONENTS } from "../../src/ui/core-components.js";
import { componentUi, modFramePathWarnings } from "../../src/ui/frame-path-check.js";
import { cleanupMods, declare, hashTree, inPackage, setup } from "../mods/mod-fixture.js";
import { withHarbourLibrary } from "../mods/library-fixture.js";

const golden = (name: string) => readFile(new URL(`./golden/${name}`, import.meta.url), "utf8");
const LAYOUT = "Base.SC2Data/UI/Layout/ChoicePicker.SC2Layout";

afterEach(cleanupMods);

/** Harbour-Story with its library's Ring Bell converted, and `ui`. */
async function harbour(ui: Record<string, unknown>) {
  const mod = await setup();
  await withHarbourLibrary(mod);
  await convertLibrary(mod.blueprintPath, { functions: ["Ring Bell"] });
  await declare(mod, { ui });
  return mod;
}

describe("the choice picker's layout", () => {
  it("is core's, written from its default look in LotV's screen frame and hex glow, and loaded by the DescIndex", async () => {
    expect(UI_COMPONENTS.map((component) => component.id)).toContain("choicePicker");
    const mod = await harbour({ choicePicker: {} });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, LAYOUT)).toBe(await golden("ChoicePicker-default.SC2Layout"));
    expect(await inPackage(mod, DESC_INDEX)).toContain(`<Include path="UI/Layout/ChoicePicker.SC2Layout"/>`);
  });

  it("takes the look's overrides: the frame, emblems, glow, backdrop, dim, styles, the 2-card gap and the anchor", async () => {
    const mod = await harbour({
      choicePicker: {
        frameBackground: "@UI/QuayCard",
        frameCornerTop: "@UI/QuayCornerTop",
        frameCornerBottom: "@UI/QuayCornerBottom",
        frameBackgroundColor: [1, 2, 3],
        frameCornerColor: [4, 5, 6],
        emblem: "@UI/QuayEmblem",
        emblemHover: "@UI/QuayEmblemHover",
        selectionGlow: "@UI/QuayGlow",
        backdrop: "@UI/QuayHex",
        backdropShimmer: "@UI/QuayHexShimmer",
        backdropColor: [7, 8, 9],
        dimColor: [10, 11, 12],
        dimAlpha: 200,
        headerStyle: "QuayHeader",
        promptStyle: "QuayPrompt",
        titleStyle: "QuayTitle",
        descriptionStyle: "QuayText",
        hotkeyStyle: "QuayHotkey",
        twoCardGap: 300,
        anchor: { at: "top", x: 0, y: 80 },
      },
    });
    await compileMod(mod.blueprintPath);
    const layout = await inPackage(mod, LAYOUT);
    for (const texture of ["QuayCard", "QuayCornerTop", "QuayCornerBottom", "QuayEmblem", "QuayEmblemHover", "QuayGlow", "QuayHex", "QuayHexShimmer"]) expect(layout).toContain(`val="@UI/${texture}"`);
    for (const color of ["1,2,3", "4,5,6", "7,8,9", "10,11,12"]) expect(layout).toContain(`<Color val="${color}"/>`);
    expect(layout).toContain(`<Alpha val="200"/>`);
    for (const style of ["QuayHeader", "QuayPrompt", "QuayTitle", "QuayText", "QuayHotkey"]) expect(layout).toContain(`<Style val="${style}"/>`);
    // The 2-card set: two 320 px cards and the gap.
    expect(layout).toContain(`<Width val="940"/>`);
    expect(layout).toContain(`<Anchor side="Left" relative="$parent" pos="Min" offset="620"/>`);
    expect(layout).toContain(`<Anchor side="Top" relative="$parent" pos="Min" offset="80"/>`);
  });

  it("stands the 1-card set's card in a slot of the 2-card set, the left by default and the right with oneCardSlot, so the hero stays in view", async () => {
    /** The 1-card set's frame: its width and its card's left edge. */
    const oneCard = async (choicePicker: Record<string, unknown>) => {
      const mod = await harbour({ choicePicker });
      await compileMod(mod.blueprintPath);
      const layout = await inPackage(mod, LAYOUT);
      const set = layout.slice(layout.indexOf('<Frame type="Frame" name="Cards1">'), layout.indexOf('<Frame type="Frame" name="Cards2">'));
      return { width: set.match(/<Width val="(\d+)"\/>/)?.[1], left: set.slice(set.indexOf('name="Card1"')).match(/<Anchor side="Left" relative="\$parent" pos="Min" offset="(\d+)"\/>/)?.[1] };
    };
    expect(await oneCard({})).toEqual({ width: "1120", left: "0" });
    expect(await oneCard({ oneCardSlot: "right" })).toEqual({ width: "1120", left: "800" });
    expect(await oneCard({ oneCardSlot: "right", twoCardGap: 300 })).toEqual({ width: "940", left: "620" });
  });

  it("makes the content as wide as its widest card set, as SC2 clips a frame's children to it", async () => {
    /** The content frame's width and each set's width. */
    const widths = async (choicePicker: Record<string, unknown>) => {
      const mod = await harbour({ choicePicker });
      await compileMod(mod.blueprintPath);
      const layout = await inPackage(mod, LAYOUT);
      const widthAfter = (name: string) => Number(layout.slice(layout.indexOf(`name="${name}"`)).match(/<Width val="(\d+)"\/>/)?.[1]);
      return { content: widthAfter("Content"), sets: [1, 2, 3].map((count) => widthAfter(`Cards${count}`)) };
    };
    for (const look of [{}, { twoCardGap: 0 }, { twoCardGap: 900 }]) {
      const { content, sets } = await widths(look);
      expect(content).toBe(Math.max(...sets));
    }
  });

  it("refuses a sound that isn't a Sound's id, a look field it doesn't have, a negative gap and a slot that isn't left or right", async () => {
    for (const choicePicker of [{ hoverSound: 'Roll"); Crash("' }, { colour: [1, 2, 3] }, { twoCardGap: -10 }, { oneCardSlot: "middle" }]) {
      const mod = await harbour({ choicePicker });
      await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/choicePicker/);
    }
  });
});

describe("the choice picker's functions", () => {
  /** The generated part of the library's Galaxy: the picker's script, its functions and their declarations. */
  async function generated(mod: Awaited<ReturnType<typeof harbour>>): Promise<string> {
    const script = (await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy")).replace(/\r\n/g, "\n");
    const header = (await inPackage(mod, "Base.SC2Data/LibHbr1_h.galaxy")).replace(/\r\n/g, "\n");
    const custom = script.slice(script.indexOf("// Custom Script\n"), script.indexOf("// Presets"));
    const functions = script.slice(script.indexOf("void libHbr1_gf_SetChoiceOption"), script.indexOf("// Triggers"));
    return `${custom}${functions}${header.split(/(?<=\n)/).filter((line) => line.includes("Choice")).join("")}`;
  }

  it("are Set Choice Option and Hide Choice Picker as actions, and Show Choice Picker and Choice Picker Is Open returning a value", () => {
    const library = componentLibrary("Hbr1", uiComponentsOn({ choicePicker: {} }, UI_COMPONENTS));
    expect(library.functions.map((fn) => [fn.name, fn.kind, fn.returns?.type, fn.parameters.map((parameter) => parameter.name)])).toEqual([
      ["Set Choice Option", "action", undefined, ["Index", "Icon", "Title", "Description"]],
      ["Show Choice Picker", "function", "int", ["Header", "Prompt", "Count"]],
      ["Hide Choice Picker", "action", undefined, []],
      ["Choice Picker Is Open", "function", "bool", []],
    ]);
  });

  it("go in the mod's library with the script holding the hookups and the click, hover and key triggers, as the golden has them", async () => {
    const mod = await harbour({ choicePicker: {} });
    await compileMod(mod.blueprintPath);
    expect(await generated(mod)).toBe(await golden("ChoicePicker-Lib.galaxy"));
    const strings = await inPackage(mod, "enUS.SC2Data/LocalizedData/TriggerStrings.txt");
    for (const name of ["Set Choice Option", "Show Choice Picker", "Hide Choice Picker", "Choice Picker Is Open", "Header", "Prompt", "Count", "Description"]) expect(strings).toMatch(new RegExp(`=${name}\\r\\n`));
  });

  it("take the look's sounds and label colours into the script", async () => {
    const mod = await harbour({ choicePicker: { openSound: "Quay_Open", hoverSound: "Quay_Hover", selectSound: "Quay_Select", closeSound: "Quay_Close", headerColor: [255, 0, 0] } });
    await compileMod(mod.blueprintPath);
    const galaxy = await generated(mod);
    for (const sound of ["Quay_Open", "Quay_Hover", "Quay_Select", "Quay_Close"]) expect(galaxy).toContain(`libHbr1_ui_choicePicker_Play("${sound}");`);
    expect(galaxy).toContain("TextWithColor(lp_header, Color(100.00, 0.00, 0.00))");
  });

  it("change nothing on a recompile", async () => {
    const mod = await harbour({ choicePicker: {} });
    await compileMod(mod.blueprintPath);
    const before = await hashTree(mod.modPackage);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modPackage)).toEqual(before);
  });

  it("hook up only frames its layout has, so the frame-path check passes them", async () => {
    const mod = await harbour({ choicePicker: {} });
    await compileMod(mod.blueprintPath);
    const on = uiComponentsOn({ choicePicker: {} }, UI_COMPONENTS);
    expect(await modFramePathWarnings(mod.modPackage, componentUi(on, mod.blueprintPath, "Hbr1"))).toEqual([]);
  });

  it("sit beside the boss bar and the toast in one library, each with its own script", async () => {
    const mod = await harbour({ bossBar: {}, toast: {}, choicePicker: {} });
    await compileMod(mod.blueprintPath);
    const galaxy = await inPackage(mod, "Base.SC2Data/LibHbr1.galaxy");
    for (const name of ["BossBar", "Toast", "ChoicePicker"]) expect(galaxy).toContain(`// Custom Script: ${name}`);
    expect(galaxy).toContain("int libHbr1_gf_ShowChoicePicker (text lp_header, text lp_prompt, int lp_count) {");
  });
});
