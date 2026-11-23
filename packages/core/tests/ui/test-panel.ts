// A fake UI Component for the framework's tests: the Test Panel, a hidden frame at the top centre
// with a backdrop and a title, shown with a title and hidden again. Its look overrides its colour,
// texture, font style and anchor. Core ships no such component.
import { z } from "zod";

import { anchorElements, defineUiComponent, LookAnchor, LookColor, LookStyle, LookTexture, colorValue } from "../../src/ui/ui-component.js";

export const TEST_PANEL = defineUiComponent({
  id: "testPanel",
  name: "TestPanel",
  look: z
    .object({
      color: LookColor.default([40, 40, 40]),
      texture: LookTexture.default("@UI/HealthBar"),
      style: LookStyle.default("@BossBarTitle"),
      anchor: LookAnchor.default({ at: "top", x: 0, y: 100 }),
    })
    .strict(),
  layout: (look) => [
    {
      tag: "Frame",
      attributes: { type: "Frame", name: "GameUI/UIContainer/ConsoleUIContainer", file: "GameUI" },
      children: [
        {
          tag: "Frame",
          attributes: { type: "Frame", name: "TestPanel" },
          children: [
            ...anchorElements(look.anchor),
            { tag: "Width", attributes: { val: "400" } },
            { tag: "Height", attributes: { val: "60" } },
            { tag: "Visible", attributes: { val: "false" } },
            {
              tag: "Frame",
              attributes: { type: "Image", name: "Back" },
              children: [
                { tag: "Anchor", attributes: { relative: "$parent" } },
                { tag: "Texture", attributes: { val: look.texture } },
                { tag: "Color", attributes: { val: colorValue(look.color) } },
              ],
            },
            {
              tag: "Frame",
              attributes: { type: "Label", name: "Title" },
              children: [
                { tag: "Anchor", attributes: { relative: "$parent" } },
                { tag: "Style", attributes: { val: look.style } },
              ],
            },
          ],
        },
      ],
    },
  ],
  functions: () => [
    {
      name: "Show Test Panel",
      grammar: "Show the test panel titled (~title~)",
      hint: "Shows the test panel with a title.",
      parameters: [{ name: "Title", type: { type: "text" } }],
      galaxy: [
        `int lv_panel = DialogControlHookupStandard(c_triggerControlTypePanel, "UIContainer/ConsoleUIContainer/TestPanel");`,
        `DialogControlSetPropertyAsText(DialogControlHookup(lv_panel, c_triggerControlTypeLabel, "Title"), c_triggerControlPropertyText, PlayerGroupAll(), lp_title);`,
        `DialogControlSetVisible(lv_panel, PlayerGroupAll(), true);`,
      ].join("\n"),
    },
    {
      name: "Hide Test Panel",
      galaxy: `DialogControlSetVisible(DialogControlHookupStandard(c_triggerControlTypePanel, "UIContainer/ConsoleUIContainer/TestPanel"), PlayerGroupAll(), false);`,
    },
  ],
  actions: {
    showTestPanel: {
      function: "Show Test Panel",
      params: z.object({ title: z.string().min(1) }).strict(),
      args: (params) => ({ title: { kind: "text", text: params.title } }),
    },
    hideTestPanel: {
      function: "Hide Test Panel",
      params: z.object({}).strict(),
      args: () => ({}),
    },
  },
});
