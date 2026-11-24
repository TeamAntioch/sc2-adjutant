// The toast (spec #582 decision 9, ADR-0019), `ui.toast`: a small panel at the right edge of the
// screen, in its upper third, with an icon, a one-line title and up to two lines of text, which
// slides in from the right, stays about 4 s and fades out. It only shows: what counts as an achievement, and whether
// it's saved, is the mod's to decide.
//
// The layout follows Blizzard's battle.net toast (StandardBattlenetTemplates' ToastTemplate and
// ToastNotificationPanelTemplate): a nine-sliced background and a slide-in animation on the panel's
// Right anchor. The fades are the script's (DialogControlFadeTransparency), not the layout's: in
// game (2026-11-10), a Fade animation left paused at its end kept every later toast see-through, so
// they only flickered (docs/reference/editor-and-engine.md, "What the toast taught"). The panel sits in ConsoleUIContainer, as the boss bar does, so it goes with the console in cinematic
// mode.
//
// Show Toast joins a queue in the toast's script, which plays one toast at a time. Before each, it
// waits while any player is in cinematic mode, and a toast's 4 s count only outside it, so a toast
// fired in a cutscene shows once play resumes. Cinematic mode is NativeLib's (the Editor's Cinematic
// Mode action, libNtve_gf_CinematicMode): the native CinematicMode alone isn't seen.
// Beside a hero moment (`ui.heroMoment`), the queue waits, and a toast's count stops, while a moment
// plays too; without one, the script doesn't name it.
//
// The default look is core's, so a toast works in any mod: the background is
// UI/Glues_Battlenet_ToastBg (core.sc2mod AssetsProduct.txt l. 225), the icon
// UI_Glues_HelpMenu_AchievementIcon.dds (core.sc2mod Assets.txt l. 563) and the font styles
// StandardTooltipHeader_White and StandardTooltip (core.sc2mod FontStyles.SC2Style l. 445, 435).
// Core has no sounds but EditorDefaultSound, so the sound is UI_Achievement from Liberty (Mod)
// (liberty.sc2mod SoundData.xml l. 30927), which every melee and campaign mod depends on. Checked at
// sc2-arcade-watcher/sc2-game-data @ 7be8945.

import { z } from "zod";

import { galaxyString } from "../capture/capture-copy.js";
import { type LayoutElement, layoutElement as el, layoutValue as val } from "./layout-writer.js";
import { heroMomentPlaying } from "./hero-moment.js";
import { anchorElements, defineUiComponent, IMAGE_FILE, inCinematicHelper, LookAnchor, LookStyle, LookTexture, type UiLibraryContext } from "./ui-component.js";

/** The panel's size, and its icon's. */
const PANEL = { width: 400, height: 110 } as const;
const ICON_SIZE = 64;
/** The padding round the icon, and between it and the text. */
const PAD = 10;
/** The labels: the title's top and both labels' right edge sit this much further in than the icon. */
const LABEL_INSET = 4;
const TITLE_HEIGHT = 28;
/** Two full lines of the text's style: a shorter label didn't wrap in game ("What the toast taught" in docs/reference/editor-and-engine.md). */
const TEXT_HEIGHT = 56;
/**
 * The labels shrink their text rather than cut it off, as the info panel's unit names do
 * (InfoPaneUnit.SC2Layout): the title on its one line, the text within its two. The limits below
 * keep ordinary text at full size; shrinking covers wide letters.
 */
/** Wide, narrow and capital letters' widths, against an ordinary letter's 1: an estimate. */
const WIDE = new Set("WM");
const WIDE_LOWER = new Set("mw");
const NARROW = new Set("iljI'.,:;!|");

/** A title's width in ordinary letters, as TOAST_TITLE_WIDTH bounds it. */
export function titleWidth(title: string): number {
  let width = 0;
  for (const letter of title) {
    if (WIDE.has(letter)) width += 1.8;
    else if (WIDE_LOWER.has(letter)) width += 1.5;
    else if (NARROW.has(letter)) width += 0.5;
    else if (letter !== letter.toLowerCase()) width += 1.2;
    else width += 1;
  }
  return Math.round(width * 10) / 10;
}

const TITLE_OPTIONS = "NoWrapping|ScaleToPreventTruncation";
const TEXT_OPTIONS = "ScaleToPreventTruncation";
/** The gap between the title and the text under it. */
const LINE_GAP = 2;

/**
 * The longest title and text a Blueprint action takes, seen in game at the default styles in the
 * 302 px labels (the findings are in the docs, "What the toast taught"). The title shrinks to fit
 * only so far, so it's measured by its letters' widths, not counted: titleWidth weighs each letter
 * against an ordinary one, a W about 1.8. The text wraps and shrinks, so it's counted. A GUI call
 * isn't checked.
 */
export const TOAST_TITLE_WIDTH = 26.5;
export const TOAST_TEXT_MAX = 60;

/** How long a slide-in (and the fade-in with it) and a fade-out take, in seconds. */
const SLIDE_SECONDS = 0.3;
const FADE_SECONDS = 0.5;
/** How long a toast shows, from the start of its slide-in to the end of its fade-out. */
const TOAST_SECONDS = 4;
/** The gap between one toast's fade-out and the next's slide-in. */
const GAP_SECONDS = 0.25;
/** How often the queue looks again while cinematic mode is on, in seconds of game time. */
const POLL_SECONDS = 0.25;
/** The toasts the queue holds: a Show Toast while it's full is dropped. */
export const TOAST_QUEUE = 8;

/** The panel's path, from GameUI's top as DialogControlHookupStandard takes it. */
const PANEL_PATH = "UIContainer/ConsoleUIContainer/Toast";

/** The anchor points with the panel's Right anchor at its parent's right edge, which SlideIn moves. */
const RIGHT_POINTS = new Set(["topRight", "right", "bottomRight"]);

/** Text markup (<n/>, <c val="…">): it would break lines or change what titleWidth measures. */
const MARKUP = /<[^>]*>/;
/** A Sound's id, as a gamelink is written into MapScript.galaxy and Triggers unescaped. */
const SOUND_ID = /^[A-Za-z0-9_]+$/;

const ToastLook = z
  .object({
    /** The panel's background, nine-sliced. */
    background: LookTexture.default("@UI/Glues_Battlenet_ToastBg"),
    /** The icon a toast shows when it's given none: an image file in the game's assets. */
    icon: z.string().regex(IMAGE_FILE, "An image file in the game's assets: the script sets it as a toast's icon, which takes no asset key (@UI/…)").default("Assets\\Textures\\UI_Glues_HelpMenu_AchievementIcon.dds"),
    titleStyle: LookStyle.default("StandardTooltipHeader_White"),
    textStyle: LookStyle.default("StandardTooltip"),
    /** The sound a toast plays when it's given none: a Sound's id. */
    sound: z.string().min(1).default("UI_Achievement"),
    /** Where the panel sits once it has slid in: a right-hand point, as it slides in from the right edge. */
    anchor: LookAnchor.refine((anchor) => RIGHT_POINTS.has(anchor.at), {
      message: "The toast slides in from the right edge, so it sits at topRight, right or bottomRight",
    }).default({ at: "topRight", x: 0, y: 260 }),
  })
  .strict();
type ToastLook = z.infer<typeof ToastLook>;

const anchor = (side: "Top" | "Bottom" | "Left" | "Right", relative: string, pos: "Min" | "Mid" | "Max", offset: number): LayoutElement => el("Anchor", { side, relative, pos, offset: String(offset) });
const curve = (time: number, value: number, ease: "in" | "out", how: string): LayoutElement => el("Key", { type: "Curve", time: String(time), value: String(value), [ease]: how });

function layout(look: ToastLook): LayoutElement[] {
  const label = (name: string, top: LayoutElement, height: number, style: string, more: LayoutElement[] = []): LayoutElement =>
    el("Frame", { type: "Label", name }, [top, anchor("Left", "$parent/Icon", "Max", PAD), anchor("Right", "$parent", "Max", -PAD - LABEL_INSET), val("Height", height), val("Style", style), ...more]);
  return [
    el("Frame", { type: "Frame", name: "GameUI/UIContainer/ConsoleUIContainer", file: "GameUI" }, [
      el("Frame", { type: "Frame", name: "Toast" }, [
        ...anchorElements(look.anchor),
        val("Width", PANEL.width),
        val("Height", PANEL.height),
        val("Visible", "false"),
        el("Animation", { name: "SlideIn" }, [
          el("Event", { event: "SlideIn", action: "Reset" }),
          el("Event", { event: "SlideIn", action: "Play" }),
          el("Controller", { type: "Anchor", side: "Right", relative: "true", end: "Pause" }, [curve(0, PANEL.width, "out", "Fast"), curve(SLIDE_SECONDS, 0, "in", "Fast")]),
        ]),
        el("Frame", { type: "Frame", name: "Body" }, [
          el("Anchor", { relative: "$parent" }),
          el("Frame", { type: "Image", name: "Background" }, [el("Anchor", { relative: "$parent" }), val("Texture", look.background), val("TextureType", "NineSlice"), val("RenderPriority", 500)]),
          el("Frame", { type: "Image", name: "Icon" }, [
            anchor("Top", "$parent", "Min", PAD),
            anchor("Left", "$parent", "Min", PAD),
            val("Width", ICON_SIZE),
            val("Height", ICON_SIZE),
            val("Texture", look.icon),
            val("RenderPriority", 510),
          ]),
          label("Title", anchor("Top", "$parent", "Min", PAD + LABEL_INSET), TITLE_HEIGHT, look.titleStyle, [val("Options", TITLE_OPTIONS)]),
          label("Text", anchor("Top", "$parent/Title", "Max", LINE_GAP), TEXT_HEIGHT, look.textStyle, [val("Options", TEXT_OPTIONS)]),
        ]),
      ]),
    ]),
  ];
}

/** The names the toast's script and function share. */
function names(library: UiLibraryContext) {
  const n = library.scriptName;
  return {
    hooked: n("hooked"),
    panel: n("panel"),
    icon: n("icon"),
    title: n("title"),
    text: n("text"),
    queueIcon: n("queueIcon"),
    queueTitle: n("queueTitle"),
    queueText: n("queueText"),
    queueSound: n("queueSound"),
    head: n("head"),
    count: n("count"),
    running: n("running"),
    loop: n("loop"),
    hookup: n("Hookup"),
    inCinematic: n("InCinematic"),
    hold: n("Hold"),
    play: n("Play"),
    loopFunc: n("LoopFunc"),
  };
}

function script(look: ToastLook, library: UiLibraryContext): string {
  const v = names(library);
  const all = "PlayerGroupAll()";
  // Beside a hero moment, a toast waits, and its time stops, while one plays, as in cinematic mode.
  const moment = heroMomentPlaying(library);
  const held = moment ? `(${v.inCinematic}() || ${moment})` : `${v.inCinematic}()`;
  return [
    "// The toast's state: its frames once hooked up, the toasts waiting (a ring of",
    `// ${TOAST_QUEUE} from the head), and whether the loop that plays them is running.`,
    `bool ${v.hooked};`,
    `int ${v.panel};`,
    `int ${v.icon};`,
    `int ${v.title};`,
    `int ${v.text};`,
    `string[${TOAST_QUEUE}] ${v.queueIcon};`,
    `text[${TOAST_QUEUE}] ${v.queueTitle};`,
    `text[${TOAST_QUEUE}] ${v.queueText};`,
    `string[${TOAST_QUEUE}] ${v.queueSound};`,
    `int ${v.head};`,
    `int ${v.count};`,
    `bool ${v.running};`,
    `trigger ${v.loop};`,
    "",
    "// Hooks up the toast's frames, the first time.",
    `void ${v.hookup} () {`,
    `    if (!${v.hooked}) {`,
    `        ${v.panel} = DialogControlHookupStandard(c_triggerControlTypePanel, "${PANEL_PATH}");`,
    `        ${v.icon} = DialogControlHookup(${v.panel}, c_triggerControlTypeImage, "Body/Icon");`,
    `        ${v.title} = DialogControlHookup(${v.panel}, c_triggerControlTypeLabel, "Body/Title");`,
    `        ${v.text} = DialogControlHookup(${v.panel}, c_triggerControlTypeLabel, "Body/Text");`,
    `        ${v.hooked} = true;`,
    "    }",
    "}",
    "",
    ...inCinematicHelper(v.inCinematic),
    "",
    `// Waits lp_seconds of game time, counting only the time outside cinematic mode${moment ? " and hero moments" : ""}.`,
    `void ${v.hold} (fixed lp_seconds) {`,
    "    fixed lv_left;",
    "",
    "    lv_left = lp_seconds;",
    "    while (lv_left > 0.0) {",
    `        Wait(${POLL_SECONDS}, c_timeGame);`,
    `        if (!${held}) {`,
    `            lv_left -= ${POLL_SECONDS};`,
    "        }",
    "    }",
    "}",
    "",
    "// Plays the toast at lp_index of the queue: it slides and fades in with its sound, stays, then",
    "// fades out. An empty icon or sound is the look's.",
    `void ${v.play} (int lp_index) {`,
    "    string lv_icon;",
    "    string lv_sound;",
    "",
    `    lv_icon = ${v.queueIcon}[lp_index];`,
    `    if (lv_icon == "") {`,
    `        lv_icon = ${galaxyString(look.icon)};`,
    "    }",
    `    lv_sound = ${v.queueSound}[lp_index];`,
    `    if (lv_sound == "") {`,
    `        lv_sound = ${galaxyString(look.sound)};`,
    "    }",
    `    DialogControlSetPropertyAsString(${v.icon}, c_triggerControlPropertyImage, ${all}, lv_icon);`,
    `    DialogControlSetPropertyAsText(${v.title}, c_triggerControlPropertyText, ${all}, ${v.queueTitle}[lp_index]);`,
    `    DialogControlSetPropertyAsText(${v.text}, c_triggerControlPropertyText, ${all}, ${v.queueText}[lp_index]);`,
    `    DialogControlFadeTransparency(${v.panel}, ${all}, 0.0, 100.0);`,
    `    DialogControlSetVisible(${v.panel}, ${all}, true);`,
    `    DialogControlSendAnimationEvent(${v.panel}, ${all}, "SlideIn");`,
    `    DialogControlFadeTransparency(${v.panel}, ${all}, ${SLIDE_SECONDS}, 0.0);`,
    `    SoundPlayForPlayer(SoundLink(lv_sound, -1), c_maxPlayers, ${all}, 100.0, 0.0);`,
    `    ${v.hold}(${(TOAST_SECONDS - FADE_SECONDS).toFixed(1)});`,
    `    DialogControlFadeTransparency(${v.panel}, ${all}, ${FADE_SECONDS}, 100.0);`,
    `    Wait(${FADE_SECONDS}, c_timeGame);`,
    `    DialogControlSetVisible(${v.panel}, ${all}, false);`,
    "}",
    "",
    `// The queue's loop: plays its toasts one at a time, each once no player is in cinematic mode${moment ? "\n// and no hero moment plays" : ""}.`,
    `bool ${v.loopFunc} (bool testConds, bool runActions) {`,
    "    int lv_index;",
    "",
    `    ${v.hookup}();`,
    `    while (${v.count} > 0) {`,
    `        while (${held}) {`,
    `            Wait(${POLL_SECONDS}, c_timeGame);`,
    "        }",
    `        lv_index = ${v.head};`,
    `        ${v.head} = (${v.head} + 1) % ${TOAST_QUEUE};`,
    `        ${v.count} -= 1;`,
    `        ${v.play}(lv_index);`,
    `        Wait(${GAP_SECONDS}, c_timeGame);`,
    "    }",
    `    ${v.running} = false;`,
    "    return true;",
    "}",
  ].join("\n");
}

export const TOAST = defineUiComponent({
  id: "toast",
  name: "Toast",
  look: ToastLook,
  layout,
  script,
  functions: (_look, library) => {
    const v = names(library);
    const at = `(${v.head} + ${v.count}) % ${TOAST_QUEUE}`;
    return [
      {
        name: "Show Toast",
        grammar: "Show a toast with (~icon~), titled (~title~), saying (~text~), with the sound (~sound~)",
        hint: `Shows a toast at the right of the screen: an icon, a one-line title (at most ${TOAST_TITLE_WIDTH} ordinary letters wide, where W and M count about 1.8) and text of up to ${TOAST_TEXT_MAX} characters (two lines), with a sound. Longer text shrinks to fit. Toasts queue and play one at a time, each about ${TOAST_SECONDS} seconds, and wait while cinematic mode is on. An empty icon or sound is the mod's default. A toast shown while ${TOAST_QUEUE} are waiting is dropped.`,
        parameters: [
          { name: "Icon", type: { type: "filepath", assetType: "Image" } },
          { name: "Title", type: { type: "text" } },
          { name: "Text", type: { type: "text" } },
          { name: "Sound", type: { type: "gamelink", gameType: "Sound" } },
        ],
        galaxy: [
          `if (${v.count} >= ${TOAST_QUEUE}) {`,
          "    return;",
          "}",
          `${v.queueIcon}[${at}] = lp_icon;`,
          `${v.queueTitle}[${at}] = lp_title;`,
          `${v.queueText}[${at}] = lp_text;`,
          `${v.queueSound}[${at}] = lp_sound;`,
          `${v.count} += 1;`,
          `if (!${v.running}) {`,
          `    ${v.running} = true;`,
          `    if (${v.loop} == null) {`,
          `        ${v.loop} = TriggerCreate("${v.loopFunc}");`,
          "    }",
          `    TriggerExecute(${v.loop}, false, false);`,
          "}",
        ].join("\n"),
      },
    ];
  },
  actions: {
    showToast: {
      function: "Show Toast",
      params: z
        .object({
          /** An image file in the game's assets; the mod's default icon when left out. */
          icon: z.string().regex(IMAGE_FILE, "An image file in the game's assets, such as Assets\\Textures\\btn-quay-bell.dds: not an asset key (@UI/…), which a toast's icon doesn't take").optional(),
          title: z
            .string()
            .min(1)
            .regex(/^[^\r\n]*$/, "No line breaks: a toast's title is one line")
            .refine((title) => !MARKUP.test(title), "No text markup (<n/>, <c val=…>): a toast's title is plain text")
            .superRefine((title, context) => {
              const width = titleWidth(title);
              if (width > TOAST_TITLE_WIDTH)
                context.addIssue({
                  code: "custom",
                  message: `A toast's title is one line: this one is ${width} ordinary letters wide, over the ${TOAST_TITLE_WIDTH} that fit, and would be cut off (W and M count about 1.8, m and w 1.5, other capitals 1.2, i, l and punctuation 0.5)`,
                });
            }),
          /** Wrapped to two lines; it takes no line breaks of its own. */
          text: z
            .string()
            .min(1)
            .max(TOAST_TEXT_MAX, `A toast's text is ${TOAST_TEXT_MAX} characters at most, so it fits`)
            .regex(/^[^\r\n]*$/, "No line breaks: the text wraps to two lines by itself")
            .refine((text) => !MARKUP.test(text), "No text markup (<n/>, <c val=…>): a toast's text is plain, and wraps by itself"),
          /** A Sound's id; the mod's default sound when left out. */
          sound: z.string().regex(SOUND_ID, "A Sound's id: letters, digits and underscores, such as UI_ObjectiveComplete").optional(),
        })
        .strict(),
      args: (params) => ({
        icon: { kind: "filepath", value: params.icon ?? "", asset: "image" },
        title: { kind: "text", text: params.title },
        text: { kind: "text", text: params.text },
        sound: { kind: "gamelink", gameType: "Sound", value: params.sound ?? "" },
      }),
    },
  },
});
