// The boss bar (spec #582 decision 8, ADR-0019), `ui.bossBar`: a boss's name over its health, its
// shields when it has them and marks at its phase thresholds, at the top centre of the screen, in
// LotV's boss-bar textures.
//
// The layout follows the structure of LotV's BossUnitFrameTemplate: a 316×60 border image over a
// dark backing, with a 288×30 fill whose width code sets, and a highlight image the Flash animation
// fades in and out. It sits in ConsoleUIContainer, as Blizzard's campaign HUD does, so it should go
// with the console in cinematic mode and come back when play resumes (to check in game). Beside a
// hero moment (`ui.heroMoment`), it also hides while a moment plays and comes back after, at the
// refresh loop's next pass; without one, its script doesn't name it.
//
// One bar shows at a time. Show Boss Bar points it at a unit, replacing any it showed, and starts
// the script's refresh loop if it isn't running: every 0.25 s of game time the loop sets both fills,
// flashes the bar when the unit's life and shields fall, greys it while the unit is invulnerable,
// and hides it when the unit dies. Hide Boss Bar stops the loop at its next pass.
//
// The default look needs LotV's campaign data: the textures are asset keys of
// Void.SC2Campaign's Assets.txt and the font style is Swarm.SC2Campaign's, both loaded by a mod
// that depends on Void Story (Campaign). Checked at
// sc2-arcade-watcher/sc2-game-data @ 7be8945.

import { z } from "zod";

import { renderColor } from "../triggers/write-map-script.js";
import { heroMomentPlaying } from "./hero-moment.js";
import { type LayoutElement, layoutElement as el, layoutValue as val } from "./layout-writer.js";
import { anchorElements, colorValue, defineUiComponent, LookAnchor, LookColor, LookStyle, LookTexture, type UiLibraryContext } from "./ui-component.js";

/** The border image's size, and the fill's place and size inside it, as LotV's boss frame has them. */
const BORDER = { width: 316, height: 60 } as const;
const FILL = { x: 14, top: 15, width: 288, height: 30 } as const;
/** The shield fill, over the top of the health fill. */
const SHIELD_HEIGHT = 8;
/** The title's height above the border. */
const TITLE_HEIGHT = 24;
/** The phase marks a bar has: Mark1 to Mark4. */
export const BOSS_BAR_MARKS = 4;
/** How often the refresh loop runs, in seconds of game time, as LotV's progress bar does. */
const REFRESH_SECONDS = 0.25;
/** LotV's boss health green, a bar's colour when an action gives none. */
const LOTV_GREEN: LookColor = [41, 208, 0];

/** The panel's path, from GameUI's top as DialogControlHookupStandard takes it. */
const PANEL_PATH = "UIContainer/ConsoleUIContainer/BossBar";

const BossBarLook = z
  .object({
    /** The border image round the bar. */
    border: LookTexture.default("@UI/LotV_Shared_InGame_BossBarFrame"),
    /** The health and shield fills. */
    fill: LookTexture.default("@UI/LotV_Shared_InGame_BossBarFill"),
    /** The highlight the flash fades in and out over the border. */
    flash: LookTexture.default("@UI/LotV_Shared_InGame_BossBarFrameFlash"),
    /** The dark backing behind the fills. */
    backing: LookTexture.default("Assets\\Textures\\white.dds"),
    titleStyle: LookStyle.default("Void_BossUnitFrameUnitName"),
    shieldColor: LookColor.default([0, 170, 255]),
    /** The fills' colour while the unit is invulnerable. */
    greyColor: LookColor.default([110, 110, 110]),
    markColor: LookColor.default([255, 255, 255]),
    anchor: LookAnchor.default({ at: "top", x: 0, y: 100 }),
  })
  .strict();
type BossBarLook = z.infer<typeof BossBarLook>;

/** An anchor of one side to the same side of the border image, offset. */
const toBorder = (side: "Top" | "Bottom" | "Left" | "Right", offset: number, pos = side === "Top" || side === "Left" ? "Min" : "Max"): LayoutElement => el("Anchor", { side, relative: "$parent/Border", pos, offset: String(offset) });

function layout(look: BossBarLook): LayoutElement[] {
  const image = (name: string, children: LayoutElement[]): LayoutElement => el("Frame", { type: "Image", name }, children);
  const fill = (name: string, height: number, color: LookColor, priority: number, hidden: boolean): LayoutElement =>
    image(name, [
      toBorder("Top", FILL.top),
      toBorder("Left", FILL.x),
      val("Width", FILL.width),
      val("Height", height),
      val("Texture", look.fill),
      val("TextureType", "NineSlice"),
      val("Color", colorValue(color)),
      val("RenderPriority", priority),
      ...(hidden ? [val("Visible", "false")] : []),
    ]);
  const mark = (index: number): LayoutElement =>
    image(`Mark${index}`, [toBorder("Top", FILL.top), toBorder("Left", FILL.x), val("Width", 2), val("Height", FILL.height), val("Texture", look.backing), val("Color", colorValue(look.markColor)), val("RenderPriority", 509), val("Visible", "false")]);
  return [
    el("Frame", { type: "Frame", name: "GameUI/UIContainer/ConsoleUIContainer", file: "GameUI" }, [
      el("Frame", { type: "Frame", name: "BossBar" }, [
        ...anchorElements(look.anchor),
        val("Width", BORDER.width),
        val("Height", BORDER.height + TITLE_HEIGHT),
        val("Visible", "false"),
        image("Backing", [toBorder("Top", 10), toBorder("Left", 10), toBorder("Bottom", -10), toBorder("Right", -10), val("Texture", look.backing), val("Color", "0,0,0"), val("Alpha", 150), val("RenderPriority", 400)]),
        fill("Health", FILL.height, LOTV_GREEN, 508, false),
        fill("Shield", SHIELD_HEIGHT, look.shieldColor, 508, true),
        ...Array.from({ length: BOSS_BAR_MARKS }, (_, index) => mark(index + 1)),
        image("Border", [
          el("Anchor", { side: "Bottom", relative: "$parent", pos: "Max", offset: "0" }),
          el("Anchor", { side: "Left", relative: "$parent", pos: "Min", offset: "0" }),
          val("Width", BORDER.width),
          val("Height", BORDER.height),
          val("Texture", look.border),
          val("RenderPriority", 510),
        ]),
        image("Flash", [
          el("Anchor", { relative: "$parent/Border" }),
          val("Texture", look.flash),
          val("Alpha", 0),
          val("RenderPriority", 511),
          el("Animation", { name: "Flash" }, [
            el("Event", { event: "Flash", action: "Reset", frame: "$parent" }),
            el("Event", { event: "Flash", action: "Play", frame: "$parent" }),
            el("Controller", { type: "Fade", end: "Pause" }, [
              el("Key", { type: "Curve", time: "0", value: "0", out: "Auto" }),
              el("Key", { type: "Curve", time: "0.1", value: "255", in: "Auto", out: "Auto" }),
              el("Key", { type: "Curve", time: "0.6", value: "0", in: "Auto" }),
            ]),
          ]),
        ]),
        el("Frame", { type: "Label", name: "Title" }, [toBorder("Bottom", 0, "Min"), toBorder("Left", FILL.x), toBorder("Right", -FILL.x), val("Height", TITLE_HEIGHT), val("Style", look.titleStyle)]),
      ]),
    ]),
  ];
}

/** A look colour as Galaxy's Color, as a colour argument renders. */
const galaxyColor = (color: LookColor): string => renderColor(`255,${colorValue(color)}`);

/** The names the bar's script and functions share. */
function names(library: UiLibraryContext) {
  const n = library.scriptName;
  return {
    hooked: n("hooked"),
    panel: n("panel"),
    health: n("health"),
    shield: n("shield"),
    border: n("border"),
    title: n("title"),
    marks: n("marks"),
    unit: n("unit"),
    color: n("color"),
    last: n("last"),
    grey: n("grey"),
    shown: n("shown"),
    running: n("running"),
    loop: n("loop"),
    hookup: n("Hookup"),
    paint: n("Paint"),
    place: n("PlaceMark"),
    refresh: n("Refresh"),
    loopFunc: n("LoopFunc"),
    show: library.galaxyName("Show Boss Bar"),
    hide: library.galaxyName("Hide Boss Bar"),
    flash: library.galaxyName("Flash Boss Bar"),
  };
}

function script(look: BossBarLook, library: UiLibraryContext): string {
  const v = names(library);
  const all = "PlayerGroupAll()";
  const moment = heroMomentPlaying(library);
  const hookups = [
    `        ${v.health} = DialogControlHookup(${v.panel}, c_triggerControlTypeImage, "Health");`,
    `        ${v.shield} = DialogControlHookup(${v.panel}, c_triggerControlTypeImage, "Shield");`,
    `        ${v.border} = DialogControlHookup(${v.panel}, c_triggerControlTypeImage, "Border");`,
    `        ${v.title} = DialogControlHookup(${v.panel}, c_triggerControlTypeLabel, "Title");`,
    ...Array.from({ length: BOSS_BAR_MARKS }, (_, index) => `        ${v.marks}[${index}] = DialogControlHookup(${v.panel}, c_triggerControlTypeImage, "Mark${index + 1}");`),
  ];
  const width = (percent: string): string => `FixedToInt(${FILL.width}.0 * ${percent} / 100.0)`;
  return [
    "// The boss bar's state: its frames once hooked up, the unit it shows, the colour it was given,",
    "// the unit's life and shields at the last pass, whether it is greyed out, shown and refreshing.",
    `bool ${v.hooked};`,
    `int ${v.panel};`,
    `int ${v.health};`,
    `int ${v.shield};`,
    `int ${v.border};`,
    `int ${v.title};`,
    `int[${BOSS_BAR_MARKS}] ${v.marks};`,
    `unit ${v.unit};`,
    `color ${v.color};`,
    `fixed ${v.last};`,
    `bool ${v.grey};`,
    `bool ${v.shown};`,
    `bool ${v.running};`,
    `trigger ${v.loop};`,
    "",
    "// Hooks up the bar's frames, the first time.",
    `void ${v.hookup} () {`,
    `    if (!${v.hooked}) {`,
    `        ${v.panel} = DialogControlHookupStandard(c_triggerControlTypePanel, "${PANEL_PATH}");`,
    ...hookups,
    `        ${v.hooked} = true;`,
    "    }",
    "}",
    "",
    "// Colours the fills: grey while the unit is invulnerable, else the bar's colour and the shields'.",
    `void ${v.paint} () {`,
    `    if (${v.grey}) {`,
    `        DialogControlSetPropertyAsColor(${v.health}, c_triggerControlPropertyColor, ${all}, ${galaxyColor(look.greyColor)});`,
    `        DialogControlSetPropertyAsColor(${v.shield}, c_triggerControlPropertyColor, ${all}, ${galaxyColor(look.greyColor)});`,
    "    }",
    "    else {",
    `        DialogControlSetPropertyAsColor(${v.health}, c_triggerControlPropertyColor, ${all}, ${v.color});`,
    `        DialogControlSetPropertyAsColor(${v.shield}, c_triggerControlPropertyColor, ${all}, ${galaxyColor(look.shieldColor)});`,
    "    }",
    `    DialogControlSetPropertyAsBool(${v.border}, c_triggerControlPropertyDesaturated, ${all}, ${v.grey});`,
    "}",
    "",
    "// Puts phase mark lp_index at lp_at of the bar (0.75 is three quarters along), or hides it for 0.",
    `void ${v.place} (int lp_index, fixed lp_at) {`,
    "    if ((lp_at <= 0.0) || (lp_at >= 1.0)) {",
    `        DialogControlSetVisible(${v.marks}[lp_index], ${all}, false);`,
    "        return;",
    "    }",
    `    DialogControlSetPositionRelative(${v.marks}[lp_index], ${all}, c_anchorTopLeft, ${v.border}, c_anchorTopLeft, ${FILL.x} + FixedToInt(${FILL.width}.0 * lp_at) - 1, ${FILL.top});`,
    `    DialogControlSetVisible(${v.marks}[lp_index], ${all}, true);`,
    "}",
    "",
    "// One pass: sets the fills from the unit, flashes the bar when its life and shields fall and",
    "// greys it while the unit is invulnerable. False when the unit is dead.",
    `bool ${v.refresh} () {`,
    "    fixed lv_now;",
    "    bool lv_invulnerable;",
    "",
    `    if (!UnitIsAlive(${v.unit})) {`,
    "        return false;",
    "    }",
    `    DialogControlSetSize(${v.health}, ${all}, MaxI(1, ${width(`UnitGetPropertyFixed(${v.unit}, c_unitPropLifePercent, c_unitPropCurrent)`)}), ${FILL.height});`,
    `    if (UnitGetPropertyFixed(${v.unit}, c_unitPropShieldsMax, c_unitPropCurrent) > 0.0) {`,
    `        DialogControlSetSize(${v.shield}, ${all}, MaxI(1, ${width(`UnitGetPropertyFixed(${v.unit}, c_unitPropShieldsPercent, c_unitPropCurrent)`)}), ${SHIELD_HEIGHT});`,
    `        DialogControlSetVisible(${v.shield}, ${all}, (UnitGetPropertyFixed(${v.unit}, c_unitPropShields, c_unitPropCurrent) > 0.0));`,
    "    }",
    "    else {",
    `        DialogControlSetVisible(${v.shield}, ${all}, false);`,
    "    }",
    `    lv_now = (UnitGetPropertyFixed(${v.unit}, c_unitPropLife, c_unitPropCurrent) + UnitGetPropertyFixed(${v.unit}, c_unitPropShields, c_unitPropCurrent));`,
    `    lv_invulnerable = UnitTestState(${v.unit}, c_unitStateInvulnerable);`,
    `    if (lv_invulnerable != ${v.grey}) {`,
    `        ${v.grey} = lv_invulnerable;`,
    `        ${v.paint}();`,
    "    }",
    `    if (lv_now < ${v.last}) {`,
    `        ${v.flash}();`,
    "    }",
    `    ${v.last} = lv_now;`,
    "    return true;",
    "}",
    "",
    `// The refresh loop, every ${REFRESH_SECONDS} s while the bar shows; it hides the bar when the unit dies${moment ? ",\n// and while a hero moment plays" : ""}.`,
    `bool ${v.loopFunc} (bool testConds, bool runActions) {`,
    `    while (${v.shown}) {`,
    ...(moment ? [`        DialogControlSetVisible(${v.panel}, ${all}, !${moment});`] : []),
    `        if (!${v.refresh}()) {`,
    `            ${v.hide}();`,
    "            break;",
    "        }",
    `        Wait(${REFRESH_SECONDS}, c_timeGame);`,
    "    }",
    `    ${v.running} = false;`,
    "    return true;",
    "}",
  ].join("\n");
}

const MARK_PARAMETERS = Array.from({ length: BOSS_BAR_MARKS }, (_, index) => ({ name: `Mark ${index + 1}`, type: { type: "fixed" } }));

export const BOSS_BAR = defineUiComponent({
  id: "bossBar",
  name: "BossBar",
  look: BossBarLook,
  layout,
  script,
  functions: (_look, library) => {
    const v = names(library);
    const all = "PlayerGroupAll()";
    const moment = heroMomentPlaying(library);
    return [
      {
        name: "Show Boss Bar",
        grammar: "Show the boss bar for (~unit~) titled (~title~) in (~colour~), with phase marks at (~mark1~), (~mark2~), (~mark3~) and (~mark4~)",
        hint: "Shows the boss bar for a unit, replacing any bar showing. It follows the unit's life and shields, flashes when they fall, greys out while the unit is invulnerable and hides when it dies. Each phase mark is a fraction of the bar (0.5 is halfway); 0 leaves it out.",
        parameters: [
          { name: "Unit", type: { type: "unit" } },
          { name: "Title", type: { type: "text" } },
          { name: "Colour", type: { type: "color" } },
          ...MARK_PARAMETERS,
        ],
        galaxy: [
          `${v.hookup}();`,
          `${v.unit} = lp_unit;`,
          `${v.color} = lp_colour;`,
          `${v.grey} = false;`,
          `${v.last} = (UnitGetPropertyFixed(lp_unit, c_unitPropLife, c_unitPropCurrent) + UnitGetPropertyFixed(lp_unit, c_unitPropShields, c_unitPropCurrent));`,
          `DialogControlSetPropertyAsText(${v.title}, c_triggerControlPropertyText, ${all}, lp_title);`,
          ...Array.from({ length: BOSS_BAR_MARKS }, (_, index) => `${v.place}(${index}, lp_mark${index + 1});`),
          `${v.paint}();`,
          `${v.refresh}();`,
          `DialogControlSetVisible(${v.panel}, ${all}, ${moment ? `!${moment}` : "true"});`,
          `${v.shown} = true;`,
          `if (!${v.running}) {`,
          `    ${v.running} = true;`,
          `    if (${v.loop} == null) {`,
          `        ${v.loop} = TriggerCreate("${v.loopFunc}");`,
          "    }",
          `    TriggerExecute(${v.loop}, false, false);`,
          "}",
        ].join("\n"),
      },
      {
        name: "Hide Boss Bar",
        hint: "Hides the boss bar and stops its refresh.",
        galaxy: [`${v.shown} = false;`, `if (${v.hooked}) {`, `    DialogControlSetVisible(${v.panel}, ${all}, false);`, "}"].join("\n"),
      },
      {
        name: "Flash Boss Bar",
        hint: "Flashes the boss bar, as a hit does, unless it is greyed out.",
        galaxy: [`if (${v.hooked} && !${v.grey}) {`, `    DialogControlSendAnimationEvent(${v.panel}, ${all}, "Flash");`, "}"].join("\n"),
      },
    ];
  },
  actions: {
    showBossBar: {
      function: "Show Boss Bar",
      params: z
        .object({
          /** The boss: a unit Anchor's or Kept unit's id. */
          unit: z.string().min(1),
          title: z.string().min(1),
          color: LookColor.default(LOTV_GREEN),
          /** Up to four fractions of the bar, each strictly between 0 and 1, where its phases change. */
          phaseMarks: z.array(z.number().gt(0).lt(1)).max(BOSS_BAR_MARKS).default([]),
        })
        .strict(),
      args: (params, mission) => ({
        unit: mission.unit(params.unit, "unit"),
        title: { kind: "text", text: params.title },
        colour: { kind: "color", value: `255,${colorValue(params.color)}` },
        ...Object.fromEntries(Array.from({ length: BOSS_BAR_MARKS }, (_, index) => [`mark${index + 1}`, { kind: "fixed", value: params.phaseMarks[index] ?? 0 }])),
      }),
    },
    hideBossBar: {
      function: "Hide Boss Bar",
      params: z.object({}).strict(),
      args: () => ({}),
    },
  },
});
