// Each UI Component's Label against its font: a label shorter than its font's line height logs
// `Text [...] is too tall for a single line` in game (docs/reference/editor-and-engine.md, "UI
// layout pitfalls"). The rule tested here is one a Label's height clears its font's size by
// LABEL_HEIGHT_MARGIN. The margin of 8 comes from another project's notes and isn't confirmed in
// game, so it may change with #57; every Label in core's components keeps it today but the choice picker's prompt and hotkeys.
import { describe, expect, it } from "vitest";

import { UI_COMPONENTS } from "../../src/ui/core-components.js";
import type { LayoutElement } from "../../src/ui/layout-writer.js";

/** How far a Label's height must clear its font's size, in UI units. Unverified: see #57. */
const LABEL_HEIGHT_MARGIN = 8;

/**
 * The font size (a style's `height`) of each style core's components use for a Label, from core's
 * and the campaigns' FontStyles.SC2Style files (sc2-arcade-watcher/sc2-game-data @ 7be8945): a
 * style's own height, or its template's, or the campaign's constant the template names.
 */
const FONT_SIZE: Readonly<Record<string, number>> = {
  Void_BossUnitFrameUnitName: 16,
  StandardTooltipHeader_White: 20,
  StandardTooltip: 20,
  TutorialVictoryPanelStageNumber: 36,
  InfoPaneHeroWeapon: 20,
  ExitGameTitle: 24,
  InfoPaneUnitSubtitle: 18,
  GameFrameLargeBottomButton: 20,
};

/**
 * The Labels that don't clear the margin yet, waiting on the author's in-game check of how much
 * a label needs (#57). The choice picker's prompt and hotkey are 26 over fonts of 20, 6 over. The
 * test requires exactly these, so whichever way #57 settles it, this list is what to update.
 */
const PENDING_IN_GAME_CHECK = [/^choicePicker\/ChoicePicker\/Content\/Prompt$/, /^choicePicker\/ChoicePicker\/Content\/Cards\d\/Card\d\/Hotkey$/];
const pending = (label: string): boolean => PENDING_IN_GAME_CHECK.some((each) => each.test(label));

type LabelHeight = { readonly label: string; readonly height: number; readonly style: string };

/** The Labels below `elements` that give a Height and a Style, each by its path from the component's first Frame below GameUI's file frame. */
function labels(elements: readonly LayoutElement[], above: readonly string[], out: LabelHeight[]): void {
  for (const element of elements) {
    if (element.tag !== "Frame") continue;
    const children = element.children ?? [];
    const value = (tag: string): string | undefined => children.find((child) => child.tag === tag)?.attributes?.["val"];
    const path = [...above, ...(element.attributes?.["name"] ?? "").split("/")];
    const height = value("Height");
    const style = value("Style");
    if (element.attributes?.["type"] === "Label" && height !== undefined && style !== undefined) out.push({ label: path.join("/"), height: Number(height), style });
    labels(children, path, out);
  }
}

/** Every Label of core's components at their default looks, by `<component id>/<path below the container>`. */
function componentLabels(): LabelHeight[] {
  const out: LabelHeight[] = [];
  for (const component of UI_COMPONENTS) {
    if (!component.layout) continue;
    const found: LabelHeight[] = [];
    labels(component.layout(component.look.parse({})), [], found);
    // Each starts at the container the layout puts its panel in (GameUI/UIContainer/ConsoleUIContainer/…): the panel's own names follow it.
    out.push(...found.map((each) => ({ ...each, label: `${component.id}/${each.label.replace(/^GameUI\/UIContainer\/[A-Za-z]+\//, "")}` })));
  }
  return out;
}

describe("a UI Component's Labels", () => {
  const all = componentLabels();

  it("have a font whose size this test knows, so a new style is added to it", () => {
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((each) => FONT_SIZE[each.style] === undefined).map((each) => `${each.label} (${each.style})`)).toEqual([]);
  });

  it(`are taller than their font by ${LABEL_HEIGHT_MARGIN}, but the ones waiting on an in-game check`, () => {
    const short = all.filter((each) => each.height < (FONT_SIZE[each.style] ?? 0) + LABEL_HEIGHT_MARGIN).map((each) => each.label);
    const unexpected = short.filter((label) => !pending(label));
    const cleared = all.filter((each) => pending(each.label) && !short.includes(each.label)).map((each) => each.label);
    expect({ unexpected, cleared }).toEqual({ unexpected: [], cleared: [] });
  });
});
