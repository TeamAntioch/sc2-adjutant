// The choice picker (spec #652 decisions 3, 4 and 7, ADR-0019), `ui.choicePicker`: a generic "pick
// one of up to 3" panel, such as a hero's level-up choice. Its look and sounds are the in-game
// demo's of 2026-11-11, as the author chose them.
//
// The panel sits in FullscreenUpperContainer, not ConsoleUIContainer, so that hiding the console
// (as a hero moment does) doesn't hide it. It holds a dim over the screen; LotV's hex glow in the
// four screen corners, mirrored, with its shimmer swept across it by a 5 s LayerUV loop, as LotV's
// score screen has it (VoidShared_ScoreScreen.SC2Layout l. 101-139); a header and a prompt; and one
// card set per count, Cards1 to Cards3. The 2-card set leaves a gap in the middle where the camera
// frames the hero, and the 1-card set is the 2-card set with one slot filled, the look's
// oneCardSlot, so a single option (a story grant) leaves the hero in view too
// (the author, 2026-11-12). Each card is a Button with LotV's screen frame (its background and four
// corners, mirrored), the Nerazim War Council emblem as its normal and hover images, an icon, a title, a
// description, its hotkey, and the War Council's selection glow, shown on the chosen card. Its
// CardIn animation raises it 60 px as it shows, and Chosen 18 px more when it's picked.
//
// Set Choice Option fills a card. Show Choice Picker shows the set for its count, waits for a click
// or a key 1 to count, and returns the pick; the fades are the script's
// (DialogControlFadeTransparency), not Fade animations, as the toast's are. Its timings are all real
// time, and it has no close: Escape does nothing. The sounds are played from code, not from the
// layout's HoverSound and ClickSound, so a key and a click sound alike. The script hooks the frames
// up and creates its click, hover and key triggers lazily, on the first Show, as the boss bar hooks
// up.
//
// The default look needs LotV's campaign data, as the boss bar's does, so the mod must depend on
// Void Story (Campaign), or override it:
//   - the textures are asset keys of Void.SC2Campaign's GameData/Assets.txt: the screen frame
//     l. 25-27, the hex glow and its shimmer l. 28-29, the selection glow l. 185 and the Nerazim
//     emblem l. 211-212;
//   - the font styles are stock ones with the demo's fonts, sizes and justification and no glow:
//     the header's is Swarm.SC2Campaign's TutorialVictoryPanelStageNumber (UI/FontStyles.SC2Style
//     l. 612), the others core.sc2mod's (UI/FontStyles.SC2Style): InfoPaneHeroWeapon l. 366 for the
//     prompt, ExitGameTitle l. 489 for a card's title, InfoPaneUnitSubtitle l. 332 for its
//     description and GameFrameLargeBottomButton l. 810 for its hotkey. None has the demo's colours,
//     so the functions colour the text with TextWithColor from the look's colour fields;
//   - the open and select sounds are Void.SC2Campaign's (GameData/SoundData.xml l. 1446, 12615),
//     the hover and close sounds Void (Mod)'s (GameData/SoundData.xml l. 9688, 9596).
// Checked at sc2-arcade-watcher/sc2-game-data @ 7be8945.

import { z } from "zod";

import { galaxyString } from "../capture/capture-copy.js";
import { renderColor } from "../triggers/write-map-script.js";
import { type LayoutElement, layoutElement as el, layoutValue as val } from "./layout-writer.js";
import { anchorElements, colorValue, defineUiComponent, LookAnchor, LookColor, LookStyle, LookTexture, type UiLibraryContext } from "./ui-component.js";

/** The picker's id, and the names of the functions another component calls (the hero moment's Grant Hero Power). */
export const CHOICE_PICKER_ID = "choicePicker";
export const SET_CHOICE_OPTION = "Set Choice Option";
export const SHOW_CHOICE_PICKER = "Show Choice Picker";

/** The most cards a picker shows. */
const CHOICE_PICKER_MAX = 3;
/** A card's size. */
const CARD = { width: 320, height: 470 } as const;
/** The gap between the 3-card set's cards. */
const THREE_GAP = 30;
/** The labels and card sets, placed by the look's anchor: the header's top to the cards' bottom. Its width is the widest set's, as SC2 clips a frame's children to it. */
const CONTENT_HEIGHT = 570;
/** The card sets' top, under the header and prompt. */
const CARDS_TOP = 100;
/** A corner of the screen frame, and of the hex glow. */
const CORNER = { width: 120, height: 118 } as const;
const HEX = { width: 828, height: 456 } as const;
/** The emblem's size and its top in the card, and the icon's. */
const EMBLEM = { width: 200, height: 258, top: 18 } as const;
const ICON = { size: 84, top: 105 } as const;

/** The cards' animations: CardIn raises a card from this far down as it shows, Chosen raises the chosen one this much more; in pixels and seconds. */
const CARD_IN = { from: 60, seconds: 0.35 } as const;
const CHOSEN = { rise: 18, seconds: 0.2 } as const;
/** How long the panel fades in and out, each card fades in, and the others fade once one is picked; the cards' stagger; in seconds of real time. */
const OPEN_SECONDS = 0.25;
const CARD_SECONDS = 0.3;
const STAGGER_SECONDS = 0.06;
const OTHERS_SECONDS = 0.2;
/** How long the chosen card shows before the panel goes. */
const CHOSEN_SECONDS = 0.35;
const CLOSE_SECONDS = 0.3;
/** How often Show Choice Picker looks for a pick. */
const POLL_SECONDS = 0.05;

/** The panel's path, from GameUI's top as DialogControlHookupStandard takes it. */
const PANEL_PATH = "UIContainer/FullscreenUpperContainer/ChoicePicker";

/** A Sound's id, as it's written into the library's Galaxy. */
const SOUND_ID = /^[A-Za-z0-9_]+$/;
const LookSound = z.string().regex(SOUND_ID, "A Sound's id: letters, digits and underscores, such as UI_Void_Roll_Over_3");

const ChoicePickerLook = z
  .object({
    /** The card's frame: LotV's screen frame, its background stretched to the card and a corner in each of its four corners. */
    frameBackground: LookTexture.default("@UI/LoTV_Shared_ScreenFrame_BG_Small"),
    frameCornerTop: LookTexture.default("@UI/LoTV_Shared_ScreenFrame_Corner_Top"),
    frameCornerBottom: LookTexture.default("@UI/LoTV_Shared_ScreenFrame_Corner_Bottom"),
    frameBackgroundColor: LookColor.default([150, 255, 220]),
    frameCornerColor: LookColor.default([140, 255, 215]),
    /** The emblem behind the icon, as the card's normal and hover images. */
    emblem: LookTexture.default("@UI/LotV_StoryMode_ArmyUpgrade_Faction_Nerazim_Normal"),
    emblemHover: LookTexture.default("@UI/LotV_StoryMode_ArmyUpgrade_Faction_Nerazim_Hover"),
    /** The glow round the chosen card. */
    selectionGlow: LookTexture.default("@UI/LotV_StoryMode_ArmyUpgrade_Faction_SelectionGlow"),
    /** The backdrop in the screen's corners, and the shimmer swept across it. */
    backdrop: LookTexture.default("@UI/LoTV_Shared_ScreenFrame_HexGlow"),
    backdropShimmer: LookTexture.default("@UI/LoTV_Shared_ScreenFrame_HexGlowShimmer"),
    backdropColor: LookColor.default([0, 255, 170]),
    /** The dim over the screen, behind everything; its alpha 0 (none) to 255. */
    dimColor: LookColor.default([0, 8, 6]),
    dimAlpha: z.number().int().min(0).max(255).default(120),
    headerStyle: LookStyle.default("TutorialVictoryPanelStageNumber"),
    promptStyle: LookStyle.default("InfoPaneHeroWeapon"),
    titleStyle: LookStyle.default("ExitGameTitle"),
    descriptionStyle: LookStyle.default("InfoPaneUnitSubtitle"),
    hotkeyStyle: LookStyle.default("GameFrameLargeBottomButton"),
    /** The labels' text colours, which the functions give the text over its style's. */
    headerColor: LookColor.default([180, 255, 240]),
    promptColor: LookColor.default([132, 210, 255]),
    titleColor: LookColor.default([255, 255, 255]),
    descriptionColor: LookColor.default([200, 230, 224]),
    hotkeyColor: LookColor.default([0, 255, 170]),
    /** The sounds, each a Sound's id: as the picker opens, as the mouse enters a card, on a pick, and as it closes. */
    openSound: LookSound.default("UI_ShipUpgrade_BG_YellowFlash"),
    hoverSound: LookSound.default("UI_Void_Roll_Over_3"),
    selectSound: LookSound.default("UI_ArmyRoom_ButtonClick_Confirm"),
    closeSound: LookSound.default("UI_Void_Launch_Actuate_1"),
    /** The gap between the 2-card set's cards, in pixels, where the camera frames the hero. */
    twoCardGap: z.number().int().min(0).default(480),
    /** The 2-card set's slot the 1-card set's card stands in, so the hero stays in view between the slots. */
    oneCardSlot: z.enum(["left", "right"]).default("left"),
    /** Where the labels and cards sit on the screen; the dim and backdrop fill it. */
    anchor: LookAnchor.default({ at: "centre", x: 0, y: -75 }),
  })
  .strict();
type ChoicePickerLook = z.infer<typeof ChoicePickerLook>;

type Side = "Top" | "Bottom" | "Left" | "Right";
const anchor = (side: Side, pos: "Min" | "Mid" | "Max", offset: number, relative = "$parent"): LayoutElement => el("Anchor", { side, relative, pos, offset: String(offset) });
const fill = (): LayoutElement => el("Anchor", { relative: "$parent" });
const noMouse = (): LayoutElement => val("AcceptsMouse", "false");
const curve = (time: number, value: number, ease: "in" | "out", how: string): LayoutElement => el("Key", { type: "Curve", time: String(time), value: String(value), [ease]: how });

/** The 2-card set's card slots' left edges. */
const twoSlots = (look: ChoicePickerLook): [number, number] => [0, CARD.width + look.twoCardGap];
/** Each card's left edge in the set of `count`: the 1-card set's card stands in one of the 2-card set's slots. */
function cardLefts(count: number, look: ChoicePickerLook): number[] {
  if (count === 1) return [twoSlots(look)[look.oneCardSlot === "left" ? 0 : 1]];
  if (count === 2) return twoSlots(look);
  return Array.from({ length: count }, (_, index) => index * (CARD.width + THREE_GAP));
}
/** The set's width: the 1-card set is as wide as the 2-card set, so its card stands where a 2-card set's would. */
const setWidth = (count: number, look: ChoicePickerLook): number => (count === 1 ? twoSlots(look)[1] : cardLefts(count, look).at(-1)!) + CARD.width;
/** The content's width: the widest set's, so no card is clipped. */
const contentWidth = (look: ChoicePickerLook): number => Math.max(...Array.from({ length: CHOICE_PICKER_MAX }, (_, index) => setWidth(index + 1, look)));

/** TextureCoords mirroring a corner image to the `vertical` and `horizontal` sides, as LotV's art faces the top left. */
const mirrored = (vertical: "Top" | "Bottom", horizontal: "Left" | "Right", flipVertical: boolean, layer?: string): LayoutElement => {
  const down = flipVertical && vertical === "Bottom";
  const across = horizontal === "Right";
  return el("TextureCoords", { top: down ? "1" : "0", left: across ? "1" : "0", bottom: down ? "0" : "1", right: across ? "0" : "1", ...(layer !== undefined ? { layer } : {}) });
};
const edge = (side: Side): "Min" | "Max" => (side === "Top" || side === "Left" ? "Min" : "Max");
const CORNERS = [
  ["TL", "Top", "Left"],
  ["TR", "Top", "Right"],
  ["BL", "Bottom", "Left"],
  ["BR", "Bottom", "Right"],
] as const;

function card(look: ChoicePickerLook, index: number, left: number): LayoutElement {
  const image = (name: string, children: LayoutElement[]): LayoutElement => el("Frame", { type: "Image", name }, children);
  const label = (name: string, top: LayoutElement, inset: number, height: number, style: string, more: LayoutElement[] = []): LayoutElement =>
    el("Frame", { type: "Label", name }, [top, anchor("Left", "Min", inset), anchor("Right", "Max", -inset), val("Height", height), val("Style", style), ...more, noMouse(), val("RenderPriority", 530)]);
  const emblem = (name: string, texture: string, alpha: number): LayoutElement =>
    image(name, [anchor("Top", "Min", EMBLEM.top), anchor("Left", "Mid", -EMBLEM.width / 2), val("Width", EMBLEM.width), val("Height", EMBLEM.height), val("Texture", texture), val("Alpha", alpha), noMouse(), val("RenderPriority", 515)]);
  const lift = (name: string, from: number, to: number, seconds: number, out: string, extra: LayoutElement[] = []): LayoutElement =>
    el("Animation", { name }, [
      el("Event", { event: name, action: "Reset" }),
      el("Event", { event: name, action: "Play" }),
      ...extra,
      el("Controller", { type: "Anchor", side: "Top", relative: "true", end: "Pause" }, [curve(0, from, "out", out), curve(seconds, to, "in", "Slow")]),
    ]);
  return el("Frame", { type: "Button", name: `Card${index}` }, [
    anchor("Top", "Min", 0),
    anchor("Left", "Min", left),
    val("Width", CARD.width),
    val("Height", CARD.height),
    val("NormalImage", "NormalImage"),
    val("HoverImage", "HoverImage"),
    lift("CardIn", CARD_IN.from, 0, CARD_IN.seconds, "Slow"),
    // CardIn resets Chosen too, so a card picked last time shows at its place.
    lift("Chosen", 0, -CHOSEN.rise, CHOSEN.seconds, "Fast", [el("Event", { event: "CardIn", action: "Reset" })]),
    image("Glow", [anchor("Top", "Min", -50), anchor("Bottom", "Max", 50), anchor("Left", "Min", -50), anchor("Right", "Max", 50), val("Texture", look.selectionGlow), noMouse(), val("Visible", "false"), val("RenderPriority", 505)]),
    image("Frame", [fill(), val("Texture", look.frameBackground), val("Color", colorValue(look.frameBackgroundColor)), noMouse(), val("RenderPriority", 509)]),
    ...CORNERS.map(([name, vertical, horizontal]) =>
      image(`Corner${name}`, [
        anchor(vertical, edge(vertical), 0),
        anchor(horizontal, edge(horizontal), 0),
        val("Width", CORNER.width),
        val("Height", CORNER.height),
        val("Texture", vertical === "Top" ? look.frameCornerTop : look.frameCornerBottom),
        mirrored(vertical, horizontal, false),
        val("Color", colorValue(look.frameCornerColor)),
        noMouse(),
        val("RenderPriority", 512),
      ]),
    ),
    emblem("NormalImage", look.emblem, 150),
    emblem("HoverImage", look.emblemHover, 220),
    image("Icon", [anchor("Top", "Min", ICON.top), anchor("Left", "Mid", -ICON.size / 2), val("Width", ICON.size), val("Height", ICON.size), noMouse(), val("RenderPriority", 520)]),
    label("Title", anchor("Top", "Min", 290), 16, 34, look.titleStyle, [val("Options", "NoWrapping|ScaleToPreventTruncation")]),
    label("Description", anchor("Top", "Min", 330), 22, 90, look.descriptionStyle, [val("Options", "ScaleToPreventTruncation")]),
    label("Hotkey", anchor("Bottom", "Max", -14), 16, 26, look.hotkeyStyle),
  ]);
}

function layout(look: ChoicePickerLook): LayoutElement[] {
  const hex = (name: string, vertical: "Top" | "Bottom", horizontal: "Left" | "Right"): LayoutElement =>
    el("Frame", { type: "Image", name }, [
      anchor(vertical, edge(vertical), 0),
      anchor(horizontal, edge(horizontal), 0),
      val("Width", HEX.width),
      val("Height", HEX.height),
      val("LayerCount", 2),
      el("Texture", { val: look.backdrop, layer: "0" }),
      el("AlphaLayer", { val: "true", layer: "0" }),
      el("WrapUV", { val: "true", layer: "0" }),
      mirrored(vertical, horizontal, true, "0"),
      el("Texture", { val: look.backdropShimmer, layer: "1" }),
      el("WrapUV", { val: "true", layer: "1" }),
      val("Color", colorValue(look.backdropColor)),
      noMouse(),
      val("RenderPriority", 460),
      el("Animation", { name: "Shimmer" }, [
        el("Event", { event: "OnShown", action: "Play" }),
        el("Event", { event: "OnShown", action: "Reset" }),
        el("Controller", { type: "LayerUV", layer: "1", side: "Left", relative: "false", sidelock: "True", end: "Loop" }, [curve(0, -1, "out", "Linear"), curve(5, 1, "in", "Linear")]),
      ]),
    ]);
  const header = (name: string, top: LayoutElement, height: number, style: string): LayoutElement =>
    el("Frame", { type: "Label", name }, [top, anchor("Left", "Min", 0), anchor("Right", "Max", 0), val("Height", height), val("Style", style), noMouse(), val("RenderPriority", 530)]);
  const set = (count: number): LayoutElement =>
    el("Frame", { type: "Frame", name: `Cards${count}` }, [
      anchor("Top", "Min", CARDS_TOP),
      anchor("Left", "Mid", 0),
      anchor("Right", "Mid", 0),
      val("Width", setWidth(count, look)),
      val("Height", CARD.height),
      val("Visible", "false"),
      ...cardLefts(count, look).map((left, index) => card(look, index + 1, left)),
    ]);
  return [
    el("Frame", { type: "Frame", name: "GameUI/UIContainer/FullscreenUpperContainer", file: "GameUI" }, [
      el("Frame", { type: "Frame", name: "ChoicePicker" }, [
        fill(),
        val("Visible", "false"),
        el("Frame", { type: "Image", name: "Dim" }, [fill(), val("Texture", "Assets\\Textures\\white.dds"), val("Color", colorValue(look.dimColor)), val("Alpha", look.dimAlpha), noMouse(), val("RenderPriority", 450)]),
        el("Frame", { type: "Frame", name: "Backdrop" }, [fill(), noMouse(), val("Visible", "false"), ...CORNERS.map(([name, vertical, horizontal]) => hex(`Hex${name}`, vertical, horizontal))]),
        el("Frame", { type: "Frame", name: "Content" }, [
          ...anchorElements(look.anchor),
          val("Width", contentWidth(look)),
          val("Height", CONTENT_HEIGHT),
          noMouse(),
          header("Header", anchor("Top", "Min", 0), 44, look.headerStyle),
          header("Prompt", anchor("Top", "Max", 4, "$parent/Header"), 26, look.promptStyle),
          ...Array.from({ length: CHOICE_PICKER_MAX }, (_, index) => set(index + 1)),
        ]),
      ]),
    ]),
  ];
}

/** A look colour as Galaxy's Color, as a colour argument renders. */
const galaxyColor = (color: LookColor): string => renderColor(`255,${colorValue(color)}`);

/** The names the picker's script and functions share. */
function names(library: UiLibraryContext) {
  const n = library.scriptName;
  return {
    hooked: n("hooked"),
    panel: n("panel"),
    header: n("header"),
    prompt: n("prompt"),
    backdrop: n("backdrop"),
    sets: n("sets"),
    cards: n("cards"),
    icons: n("icons"),
    titles: n("titles"),
    descriptions: n("descriptions"),
    glows: n("glows"),
    optionIcon: n("optionIcon"),
    optionTitle: n("optionTitle"),
    optionDescription: n("optionDescription"),
    shown: n("shown"),
    waiting: n("waiting"),
    count: n("count"),
    choice: n("choice"),
    session: n("session"),
    events: n("events"),
    keys: n("keys"),
    hookup: n("Hookup"),
    play: n("Play"),
    choose: n("Choose"),
    show: n("Show"),
    eventsFunc: n("EventsFunc"),
    keysFunc: n("KeysFunc"),
  };
}

function script(look: ChoicePickerLook, library: UiLibraryContext): string {
  const v = names(library);
  const all = "PlayerGroupAll()";
  const size = CHOICE_PICKER_MAX + 1;
  const hookups: string[] = [];
  for (let count = 1; count <= CHOICE_PICKER_MAX; count += 1) {
    hookups.push(`        ${v.sets}[${count}] = DialogControlHookup(${v.panel}, c_triggerControlTypePanel, "Content/Cards${count}");`);
    for (let index = 1; index <= count; index += 1) {
      const at = `[${count}][${index}]`;
      const card = `${v.cards}${at}`;
      hookups.push(
        `        ${card} = DialogControlHookup(${v.sets}[${count}], c_triggerControlTypeButton, "Card${index}");`,
        `        ${v.icons}${at} = DialogControlHookup(${card}, c_triggerControlTypeImage, "Icon");`,
        `        ${v.titles}${at} = DialogControlHookup(${card}, c_triggerControlTypeLabel, "Title");`,
        `        ${v.descriptions}${at} = DialogControlHookup(${card}, c_triggerControlTypeLabel, "Description");`,
        `        ${v.glows}${at} = DialogControlHookup(${card}, c_triggerControlTypeImage, "Glow");`,
        `        DialogControlSetPropertyAsText(DialogControlHookup(${card}, c_triggerControlTypeLabel, "Hotkey"), c_triggerControlPropertyText, ${all}, TextWithColor(StringToText("[ ${index} ]"), ${galaxyColor(look.hotkeyColor)}));`,
      );
    }
  }
  const keys = Array.from({ length: CHOICE_PICKER_MAX }, (_, index) => `        TriggerAddEventKeyPressed(${v.keys}, c_playerAny, c_key${index + 1}, true, c_keyModifierStateIgnore, c_keyModifierStateIgnore, c_keyModifierStateIgnore);`);
  const keyChecks = Array.from({ length: CHOICE_PICKER_MAX }, (_, index) => [`    if (lv_key == c_key${index + 1}) {`, `        ${v.choose}(${index + 1});`, "    }"]).flat();
  return [
    "// The choice picker's state: its frames once hooked up, by card set and card (1-based), the",
    "// options to show, whether it shows and waits for a pick, the set showing, the pick, a count of",
    "// Shows and Hides (so a Show that a Hide ended leaves the next one alone), and the triggers for",
    "// clicks and mouse-enter on the cards and for keys 1-3.",
    `bool ${v.hooked};`,
    `int ${v.panel};`,
    `int ${v.header};`,
    `int ${v.prompt};`,
    `int ${v.backdrop};`,
    `int[${size}] ${v.sets};`,
    `int[${size}][${size}] ${v.cards};`,
    `int[${size}][${size}] ${v.icons};`,
    `int[${size}][${size}] ${v.titles};`,
    `int[${size}][${size}] ${v.descriptions};`,
    `int[${size}][${size}] ${v.glows};`,
    `string[${size}] ${v.optionIcon};`,
    `text[${size}] ${v.optionTitle};`,
    `text[${size}] ${v.optionDescription};`,
    `bool ${v.shown};`,
    `bool ${v.waiting};`,
    `int ${v.count};`,
    `int ${v.choice};`,
    `int ${v.session};`,
    `trigger ${v.events};`,
    `trigger ${v.keys};`,
    "",
    "// Plays a sound for every player.",
    `void ${v.play} (string lp_sound) {`,
    `    SoundPlayForPlayer(SoundLink(lp_sound, -1), c_maxPlayers, ${all}, 100.0, 0.0);`,
    "}",
    "",
    "// Picks card lp_index of the set showing, while the picker waits for a pick.",
    `void ${v.choose} (int lp_index) {`,
    `    if (!${v.waiting} || (${v.choice} != 0) || (lp_index < 1) || (lp_index > ${v.count})) {`,
    "        return;",
    "    }",
    `    ${v.choice} = lp_index;`,
    "}",
    "",
    "// A click on a card picks it; the mouse entering one plays the hover sound, while the picker waits.",
    `bool ${v.eventsFunc} (bool testConds, bool runActions) {`,
    "    int lv_control;",
    "    int lv_index;",
    "",
    `    if (!${v.waiting}) {`,
    "        return true;",
    "    }",
    "    lv_control = EventDialogControl();",
    "    lv_index = 1;",
    `    while (lv_index <= ${v.count}) {`,
    `        if (lv_control == ${v.cards}[${v.count}][lv_index]) {`,
    "            if (EventDialogControlEventType() == c_triggerControlEventTypeMouseEnter) {",
    `                ${v.play}(${galaxyString(look.hoverSound)});`,
    "            }",
    "            else {",
    `                ${v.choose}(lv_index);`,
    "            }",
    "        }",
    "        lv_index += 1;",
    "    }",
    "    return true;",
    "}",
    "",
    "// Keys 1-3 pick a card; they do nothing while the picker is closed.",
    `bool ${v.keysFunc} (bool testConds, bool runActions) {`,
    "    int lv_key;",
    "",
    `    if (!${v.waiting}) {`,
    "        return true;",
    "    }",
    "    lv_key = EventKeyPressed();",
    ...keyChecks,
    "    return true;",
    "}",
    "",
    "// Hooks up the picker's frames and creates its triggers, the first time.",
    `void ${v.hookup} () {`,
    `    if (!${v.hooked}) {`,
    `        ${v.panel} = DialogControlHookupStandard(c_triggerControlTypePanel, "${PANEL_PATH}");`,
    `        ${v.header} = DialogControlHookup(${v.panel}, c_triggerControlTypeLabel, "Content/Header");`,
    `        ${v.prompt} = DialogControlHookup(${v.panel}, c_triggerControlTypeLabel, "Content/Prompt");`,
    `        ${v.backdrop} = DialogControlHookup(${v.panel}, c_triggerControlTypePanel, "Backdrop");`,
    ...hookups,
    `        ${v.events} = TriggerCreate("${v.eventsFunc}");`,
    `        TriggerAddEventDialogControl(${v.events}, c_playerAny, c_invalidDialogControlId, c_triggerControlEventTypeClick);`,
    `        TriggerAddEventDialogControl(${v.events}, c_playerAny, c_invalidDialogControlId, c_triggerControlEventTypeMouseEnter);`,
    `        ${v.keys} = TriggerCreate("${v.keysFunc}");`,
    ...keys,
    `        ${v.hooked} = true;`,
    "    }",
    "}",
    "",
    "// Shows the set of lp_count cards with the options set, waits for a pick and returns it, 1-based;",
    "// 0 if Hide Choice Picker closes it first, and at once while another picker shows.",
    `int ${v.show} (text lp_header, text lp_prompt, int lp_count) {`,
    "    int lv_count;",
    "    int lv_index;",
    "    int lv_other;",
    "    int lv_choice;",
    "    int lv_session;",
    "",
    `    ${v.hookup}();`,
    `    if (${v.shown}) {`,
    "        return 0;",
    "    }",
    `    lv_count = MinI(MaxI(lp_count, 1), ${CHOICE_PICKER_MAX});`,
    `    ${v.session} += 1;`,
    `    lv_session = ${v.session};`,
    `    ${v.shown} = true;`,
    `    ${v.count} = lv_count;`,
    `    ${v.choice} = 0;`,
    "    lv_other = 1;",
    `    while (lv_other <= ${CHOICE_PICKER_MAX}) {`,
    `        DialogControlSetVisible(${v.sets}[lv_other], ${all}, (lv_other == lv_count));`,
    "        lv_other += 1;",
    "    }",
    `    DialogControlSetPropertyAsText(${v.header}, c_triggerControlPropertyText, ${all}, TextWithColor(lp_header, ${galaxyColor(look.headerColor)}));`,
    `    DialogControlSetPropertyAsText(${v.prompt}, c_triggerControlPropertyText, ${all}, TextWithColor(lp_prompt, ${galaxyColor(look.promptColor)}));`,
    "    lv_index = 1;",
    "    while (lv_index <= lv_count) {",
    `        DialogControlSetPropertyAsString(${v.icons}[lv_count][lv_index], c_triggerControlPropertyImage, ${all}, ${v.optionIcon}[lv_index]);`,
    `        DialogControlSetVisible(${v.icons}[lv_count][lv_index], ${all}, (${v.optionIcon}[lv_index] != ""));`,
    `        DialogControlSetPropertyAsText(${v.titles}[lv_count][lv_index], c_triggerControlPropertyText, ${all}, TextWithColor(${v.optionTitle}[lv_index], ${galaxyColor(look.titleColor)}));`,
    `        DialogControlSetPropertyAsText(${v.descriptions}[lv_count][lv_index], c_triggerControlPropertyText, ${all}, TextWithColor(${v.optionDescription}[lv_index], ${galaxyColor(look.descriptionColor)}));`,
    `        DialogControlSetVisible(${v.glows}[lv_count][lv_index], ${all}, false);`,
    `        DialogControlFadeTransparency(${v.cards}[lv_count][lv_index], ${all}, 0.0, 100.0);`,
    "        lv_index += 1;",
    "    }",
    // The backdrop is shown on every Show, before the panel, as the demo did, so its shimmer's OnShown plays.
    `    DialogControlSetVisible(${v.backdrop}, ${all}, true);`,
    `    DialogControlFadeTransparency(${v.panel}, ${all}, 0.0, 100.0);`,
    `    DialogControlSetVisible(${v.panel}, ${all}, true);`,
    `    DialogControlFadeTransparency(${v.panel}, ${all}, ${OPEN_SECONDS}, 0.0);`,
    `    ${v.play}(${galaxyString(look.openSound)});`,
    "    lv_index = 1;",
    "    while (lv_index <= lv_count) {",
    `        DialogControlSendAnimationEvent(${v.cards}[lv_count][lv_index], ${all}, "CardIn");`,
    `        DialogControlFadeTransparency(${v.cards}[lv_count][lv_index], ${all}, ${CARD_SECONDS}, 0.0);`,
    `        Wait(${STAGGER_SECONDS}, c_timeReal);`,
    "        lv_index += 1;",
    "    }",
    // A Hide Choice Picker while the cards came in leaves it closed.
    `    ${v.waiting} = (lv_session == ${v.session});`,
    `    while ((${v.choice} == 0) && ${v.waiting}) {`,
    `        Wait(${POLL_SECONDS}, c_timeReal);`,
    "    }",
    `    lv_choice = ${v.choice};`,
    `    if (lv_session != ${v.session}) {`,
    "        return 0;",
    "    }",
    `    ${v.waiting} = false;`,
    `    ${v.play}(${galaxyString(look.selectSound)});`,
    `    DialogControlSetVisible(${v.glows}[lv_count][lv_choice], ${all}, true);`,
    `    DialogControlSendAnimationEvent(${v.cards}[lv_count][lv_choice], ${all}, "Chosen");`,
    "    lv_index = 1;",
    "    while (lv_index <= lv_count) {",
    "        if (lv_index != lv_choice) {",
    `            DialogControlFadeTransparency(${v.cards}[lv_count][lv_index], ${all}, ${OTHERS_SECONDS}, 100.0);`,
    "        }",
    "        lv_index += 1;",
    "    }",
    `    Wait(${CHOSEN_SECONDS}, c_timeReal);`,
    `    ${v.play}(${galaxyString(look.closeSound)});`,
    `    DialogControlFadeTransparency(${v.panel}, ${all}, ${CLOSE_SECONDS}, 100.0);`,
    `    Wait(${CLOSE_SECONDS}, c_timeReal);`,
    `    if (lv_session == ${v.session}) {`,
    `        DialogControlSetVisible(${v.panel}, ${all}, false);`,
    `        ${v.shown} = false;`,
    "    }",
    "    return lv_choice;",
    "}",
  ].join("\n");
}

export const CHOICE_PICKER = defineUiComponent({
  id: CHOICE_PICKER_ID,
  name: "ChoicePicker",
  look: ChoicePickerLook,
  layout,
  script,
  functions: (_look, library) => {
    const v = names(library);
    return [
      {
        name: SET_CHOICE_OPTION,
        grammar: "Set choice option (~index~) to (~icon~), titled (~title~), saying (~description~)",
        hint: `Fills card Index (1 to ${CHOICE_PICKER_MAX}) of the choice picker for its next Show Choice Picker: an icon (an image file, such as Assets\\Textures\\btn-quay-bell.dds; empty for none), a one-line title and a description of about four lines.`,
        parameters: [
          { name: "Index", type: { type: "int" } },
          { name: "Icon", type: { type: "filepath", assetType: "Image" } },
          { name: "Title", type: { type: "text" } },
          { name: "Description", type: { type: "text" } },
        ],
        galaxy: [
          `if ((lp_index < 1) || (lp_index > ${CHOICE_PICKER_MAX})) {`,
          "    return;",
          "}",
          `${v.optionIcon}[lp_index] = lp_icon;`,
          `${v.optionTitle}[lp_index] = lp_title;`,
          `${v.optionDescription}[lp_index] = lp_description;`,
        ].join("\n"),
      },
      {
        name: SHOW_CHOICE_PICKER,
        grammar: "Show the choice picker headed (~header~), prompting (~prompt~), with (~count~) options",
        hint: `Shows the choice picker with Count options (1 to ${CHOICE_PICKER_MAX}), as Set Choice Option filled them, and waits for the player to click one or press its key, 1 to Count. It gives the option picked, 1-based, or 0 if Hide Choice Picker closed the picker first. There's no close: Escape does nothing. It runs in real time, so it works while the game is paused. While a picker shows, another Show Choice Picker gives 0 at once, so show one at a time.`,
        parameters: [
          { name: "Header", type: { type: "text" } },
          { name: "Prompt", type: { type: "text" } },
          { name: "Count", type: { type: "int" } },
        ],
        returns: { type: "int" },
        galaxy: `return ${v.show}(lp_header, lp_prompt, lp_count);`,
      },
      {
        name: "Hide Choice Picker",
        hint: "Hides the choice picker at once, as at a mission's end. A Show Choice Picker waiting for a pick gives 0.",
        galaxy: [`${v.session} += 1;`, `${v.waiting} = false;`, `${v.shown} = false;`, `if (${v.hooked}) {`, `    DialogControlSetVisible(${v.panel}, PlayerGroupAll(), false);`, "}"].join("\n"),
      },
      {
        name: "Choice Picker Is Open",
        hint: "Whether the choice picker shows, from its Show Choice Picker until it has faded out.",
        returns: { type: "bool" },
        galaxy: `return ${v.shown};`,
      },
    ];
  },
  actions: {},
});
