// The hero moment (spec #652 decisions 2, 5, 6, 7, 8, 9 and 11, ADR-0019), `ui.heroMoment`: the
// world freezes but for one hero, the camera zooms in on the hero and sways, a glow plays on the
// hero, and play resumes once the mod's own trigger is done (it shows the choice picker in
// between). Stat levels get Flash Hero instead, which pauses nothing. It has no layout: it drives
// the camera, the units and the game's own UI. Its look and sounds are the in-game demo's of
// 2026-11-11, which the author played and approved.
//
// Begin Hero Moment (hero) waits its turn, then returns false, doing nothing, if the hero is dead,
// or plays the moment's start and returns true:
//   - It waits while any player is in cinematic mode (NativeLib's flag, as the toast reads it), while
//     another moment plays, and while an in-play line plays. The lines' count is this script's global
//     lib<library>_ui_heroMoment_linesPlaying, which Hold Hero Moments For Line adds one to, once no
//     moment plays, and Release Hero Moments After Line takes one from: a compiled Mission calls them
//     around its in-play lines (#656, missionHeroMoment), and holds its clocks while Hero Moment Is
//     Playing. A count, since an in-play line may hold moments off while it waits for its turn as a
//     trigger scene's lines after its handback hold them too.
//   - It plays the sting, one or two sounds layered.
//   - It freezes every unit but the hero, per unit with an anim pause, which freezes missiles in
//     flight, and re-sweeps every 0.25 s of real time for units created during the moment. AI and
//     mission time pause. The hero is paused without an anim pause, so the hero keeps animating
//     and the glow plays (all seen in game).
//   - It hides the game UI (every sync frame type but BattleUI, fullscreen UI mode, the messages
//     cleared) and stores and clears the owner's selection.
//   - It saves the owner's camera, locks it, and pans and zooms to the hero over the zoom time, then
//     sways it in real time: yaw ± sway.yaw every sway.yawSeconds and height ± sway.height every
//     sway.heightSeconds, each leg eased into the next (smooth in game).
//   - It puts on the glow: the burst model at the hero's feet for 1.5 s (Begin returns after it),
//     the aura model there with its tint, and the glaze actor.
// End Hero Moment stops the sway and restores the camera exactly, waits the hand-back time, unfreezes
// everything, restores the UI and the selection, and returns; the aura and glaze then fade
// (SetOpacity, which fades a glaze, seen in game) over the glow's fade and are removed, in a thread
// of their own. Hero Moment Is Playing is true from Begin's turn to End's return. Two choice levels
// at once are one moment: the mod shows the picker twice between Begin and End.
//
// Grant Hero Power (hero, header, prompt, icon, title, description) is a story grant dressed as a
// level-up (a fight in a Mission's story can grant a hero a weapon so): the whole
// moment with a picker of one option, the power granted, which waits for its card to be picked. It
// changes no level and no experience, and grants nothing itself: the Mission's trigger that calls it
// gives the hero the power once it returns. It does nothing if Begin gives false. It calls the
// choice picker's functions, so the moment has it only when the mod turns ui.choicePicker on too,
// as has its Blueprint action, grantHeroPower.
//
// Flash Hero (hero) plays the flash model on the hero, scaled, with the flash sound, in a thread of
// its own, and waits for nothing: during a moment it plays at once, folding into it.
//
// The aura and glaze are the mod's own data (decision 9), named by the look; each defaults to none,
// which leaves it out of the script. A component writes no game data, so the mod defines them:
//   - auraModel, a CModel, which may name a file of any campaign by path (a co-op .m3 loads from a
//     map's or mod's CModel, seen in game). It's attached to the hero at Ref_Origin with
//     libNtve_gf_AttachModelToUnit and tinted with SetTintColor (auraTint, auraHdr), which
//     recolours an effect model.
//   - glazeActor, a CActorModelMaterial whose parent is GlazeParent, holding its glaze model (a
//     CModel whose parent is Glaze) and `ActorCreation → ModelMaterialApplyTo ::Main`. It's created
//     on the hero ("Create <id>" sent to the hero) and fetched with ActorFromScope(ActorScopeFromUnit(…),
//     id). Its colour must be in its data: SetTintColor sent from a trigger does nothing to a glaze
//     (seen in game), so the look has no glaze tint.
//
// The defaults are stock: the burst ShadowManifestationModel and the flash HeroicAuraImpact are
// Void.SC2Campaign's (GameData/ModelData.xml l. 2515, 4578), so the mod must depend on Void Story
// (Campaign), or override them; the sting's UI_AC_Zeratul_BladeOn and
// Protoss_PowerUpLarge and the flash's Protoss_PowerUpSmall are Liberty (Mod)'s (GameData/
// SoundData.xml l. 5017, 31913, 31920). Checked at sc2-arcade-watcher/sc2-game-data @ 7be8945.

import { z } from "zod";

import { galaxyString } from "../capture/capture-copy.js";
import type { CampaignLibrary } from "../plugins/plugin-api.js";
import { stableElementId } from "../triggers/trigger-builders.js";
import type { FunctionDef } from "../triggers/trigger-catalog.js";
import { galaxyIdentifier } from "../triggers/trigger-model.js";
import { renderColor } from "../triggers/write-map-script.js";
import { formatFixed as fx } from "../triggers/write-triggers-xml.js";
import { CHOICE_PICKER_ID, SET_CHOICE_OPTION, SHOW_CHOICE_PICKER } from "./choice-picker.js";
import { colorValue, defineUiComponent, IMAGE_FILE, inCinematicHelper, LookColor, type UiFunction, type UiLibraryContext } from "./ui-component.js";

/** How long the burst plays before it's removed, and Begin returns, in seconds of real time. */
const BURST_SECONDS = 1.5;
/** How long the camera takes to return to where it was, in seconds of real time. */
const RESTORE_SECONDS = 1;
/** How often the freeze re-sweeps for new units and the sway looks again, in seconds of real time. */
const SWEEP_SECONDS = 0.25;
/** How often Begin looks again while it waits its turn, in seconds of game time. */
const POLL_SECONDS = 0.25;
/** How long the flash model shows before it's removed, in seconds of real time. */
const FLASH_SECONDS = 1.8;
/** How long the UI takes to go to fullscreen mode and back. */
const UI_MODE_SECONDS = 0.5;
/** The sync frame types' array: c_syncFrameTypeLast is 39 (natives.galaxy l. 4975), and the demo's 64 played. */
const FRAME_TYPES = 64;

/** A Sound's, model's or actor's id, as it's written into the library's Galaxy. */
const DataId = (what: string) => z.string().regex(/^[A-Za-z0-9_]+$/, `A ${what}'s id: letters, digits and underscores`);
const Seconds = z.number().positive();

const HeroMomentLook = z
  .object({
    /** The sting, one sound or two layered: Sounds' ids. */
    stingSounds: z.array(DataId("Sound")).min(1).max(2).default(["UI_AC_Zeratul_BladeOn", "Protoss_PowerUpLarge"]),
    /** The camera on the hero: its distance, pitch, yaw from the player's and height offset, and how long it takes to get there. */
    camera: z
      .object({
        distance: z.number().positive().default(13),
        pitch: z.number().default(22),
        yawOffset: z.number().default(15),
        heightOffset: z.number().default(1.2),
        zoomSeconds: Seconds.default(0.8),
      })
      .strict()
      .prefault({}),
    /** The sway: how far the yaw and height go either side, and how long each leg takes. */
    sway: z
      .object({
        yaw: z.number().min(0).default(5),
        height: z.number().min(0).default(0.25),
        yawSeconds: Seconds.default(4),
        heightSeconds: Seconds.default(5),
      })
      .strict()
      .prefault({}),
    /** The beat between the camera's return and play resuming. */
    handBackSeconds: z.number().min(0).default(0.4),
    /** How long the aura and glaze take to fade once play resumes. */
    glowFadeSeconds: Seconds.default(2),
    /** The model that bursts at the hero's feet as the moment starts: a Model's id. */
    burstModel: DataId("Model").default("ShadowManifestationModel"),
    /** The aura at the hero's feet for the moment: the mod's own CModel's id; none by default. */
    auraModel: DataId("Model").optional(),
    /** The aura's tint and its HDR strength. */
    auraTint: LookColor.default([0, 255, 171]),
    auraHdr: z.number().positive().default(3),
    /** The glaze on the hero for the moment: the mod's own CActorModelMaterial's id; none by default. */
    glazeActor: DataId("actor").optional(),
    /** Flash Hero's model, its scale and its sound. */
    flashModel: DataId("Model").default("HeroicAuraImpact"),
    flashScale: z.number().positive().default(2.25),
    flashSound: DataId("Sound").default("Protoss_PowerUpSmall"),
  })
  .strict();
type HeroMomentLook = z.infer<typeof HeroMomentLook>;

/** A look colour as Galaxy's Color. */
const galaxyColor = (color: LookColor): string => renderColor(`255,${colorValue(color)}`);
const sound = (id: string): string => `SoundPlayForPlayer(SoundLink(${galaxyString(id)}, -1), c_maxPlayers, PlayerGroupAll(), 100.0, 0.0);`;

const ID = "heroMoment";
const IS_PLAYING = "Hero Moment Is Playing";
const GRANT = "Grant Hero Power";
const HOLD_FOR_LINE = "Hold Hero Moments For Line";
const RELEASE_AFTER_LINE = "Release Hero Moments After Line";

/**
 * What a Mission's compile calls of the hero moment (#656), when its Campaign Mod turns ui.heroMoment
 * on; undefined when it doesn't, so the Mission compiles as it would without the moment. Each is the
 * component's own function, known by its id, which no function of the mod's own can have.
 */
export type MissionHeroMoment = {
  /** Before an in-play line: waits while a moment plays, then holds moments off until releaseAfterLine. */
  readonly holdForLine: FunctionDef;
  /** After an in-play line: lets moments play again. */
  readonly releaseAfterLine: FunctionDef;
  /** Whether a moment plays, from Begin's turn to End's return. */
  readonly isPlaying: FunctionDef;
};

export function missionHeroMoment(library: Pick<CampaignLibrary, "functions">): MissionHeroMoment | undefined {
  const own = (name: string): FunctionDef | undefined => {
    const def = library.functions[galaxyIdentifier(name)];
    return def?.id === stableElementId(`ui/${ID}/${name}`) ? def : undefined;
  };
  const holdForLine = own(HOLD_FOR_LINE);
  const releaseAfterLine = own(RELEASE_AFTER_LINE);
  const isPlaying = own(IS_PLAYING);
  return holdForLine && releaseAfterLine && isPlaying ? { holdForLine, releaseAfterLine, isPlaying } : undefined;
}

/**
 * The Galaxy of whether a hero moment plays, for another component that defers to one (the toast's
 * queue, the boss bar), when the mod turns ui.heroMoment on too; undefined when it doesn't, so that
 * component is written as it is alone.
 */
export function heroMomentPlaying(library: UiLibraryContext): string | undefined {
  const moment = library.other(ID);
  return moment ? `${moment.galaxyName(IS_PLAYING)}()` : undefined;
}

/** The names the moment's script and functions share. */
function names(library: UiLibraryContext) {
  const n = library.scriptName;
  return {
    playing: n("playing"),
    linesPlaying: n("linesPlaying"),
    hero: n("hero"),
    player: n("player"),
    frozen: n("frozen"),
    freezing: n("freezing"),
    freezes: n("freezes"),
    swaying: n("swaying"),
    baseYaw: n("baseYaw"),
    uiWasVisible: n("uiWasVisible"),
    aura: n("aura"),
    glaze: n("glaze"),
    fadingAura: n("fadingAura"),
    fadingGlaze: n("fadingGlaze"),
    sweep: n("sweep"),
    sway: n("sway"),
    fade: n("fade"),
    inCinematic: n("InCinematic"),
    freezeUnit: n("FreezeUnit"),
    freezeNew: n("FreezeNew"),
    freeze: n("Freeze"),
    sweepFunc: n("SweepFunc"),
    unfreeze: n("Unfreeze"),
    hideUi: n("HideGameUI"),
    restoreUi: n("RestoreGameUI"),
    cameraIn: n("CameraIn"),
    swayFunc: n("SwayFunc"),
    cameraOut: n("CameraOut"),
    removeGlaze: n("RemoveGlaze"),
    glowOn: n("GlowOn"),
    glowOff: n("GlowOff"),
    fadeFunc: n("FadeFunc"),
    begin: n("Begin"),
    end: n("End"),
    flash: n("Flash"),
  };
}

/** Lines that create trigger `variable` running `func` the first time, then run it. */
const run = (variable: string, func: string): string[] => [`    if (${variable} == null) {`, `        ${variable} = TriggerCreate("${func}");`, "    }", `    TriggerExecute(${variable}, false, false);`];

function script(look: HeroMomentLook, library: UiLibraryContext): string {
  const v = names(library);
  const all = "PlayerGroupAll()";
  const { camera, sway } = look;
  const aura = look.auraModel;
  const glaze = look.glazeActor;
  const liveUnits = "UnitGroup(null, c_playerAny, RegionEntireMap(), UnitFilter(0, 0, 0, (1 << (c_targetFilterDead - 32))), 0)";
  const eased = (type: string, value: string, seconds: number): string => `CameraSetValue(${v.player}, ${type}, ${value}, ${fx(seconds)}, -1.0, 10.0);`;
  return [
    "// The hero moment's state: whether one plays, and how many in-play lines hold moments off,",
    "// which a moment waits for (Missions hold them while a line plays: #656); the hero and its owner;",
    "// the units frozen, whether the freeze holds and a count of freezes; whether the camera sways",
    `// and the yaw it sways about; the game UI's frames as they were${aura || glaze ? "; the glow on the hero, and the glow fading" : ""}; and the triggers`,
    `// for the re-sweep${aura || glaze ? ", the sway and the fade" : " and the sway"}.`,
    `bool ${v.playing};`,
    `int ${v.linesPlaying};`,
    `unit ${v.hero};`,
    `int ${v.player};`,
    `unitgroup ${v.frozen};`,
    `bool ${v.freezing};`,
    `int ${v.freezes};`,
    `bool ${v.swaying};`,
    `fixed ${v.baseYaw};`,
    `bool[${FRAME_TYPES}] ${v.uiWasVisible};`,
    ...(aura ? [`actor ${v.aura};`, `actor ${v.fadingAura};`] : []),
    ...(glaze ? [`actor ${v.glaze};`, `actor ${v.fadingGlaze};`] : []),
    `trigger ${v.sweep};`,
    `trigger ${v.sway};`,
    ...(aura || glaze ? [`trigger ${v.fade};`] : []),
    "",
    ...inCinematicHelper(v.inCinematic),
    "",
    "// Freezes one unit: paused, with its animations paused, which holds a missile in flight.",
    `void ${v.freezeUnit} (unit lp_unit) {`,
    "    libNtve_gf_PauseUnit(lp_unit, true);",
    `    libNtve_gf_SendActorMessageToUnit(lp_unit, "AnimSetPausedAll");`,
    `    UnitGroupAdd(${v.frozen}, lp_unit);`,
    "}",
    "",
    "// Freezes every live unit but the hero that isn't frozen yet, missiles with them.",
    `void ${v.freezeNew} () {`,
    "    unitgroup lv_units;",
    "    int lv_index;",
    "    unit lv_unit;",
    "",
    `    lv_units = ${liveUnits};`,
    "    lv_index = UnitGroupCount(lv_units, c_unitCountAll);",
    "    while (lv_index > 0) {",
    "        lv_unit = UnitGroupUnit(lv_units, lv_index);",
    `        if ((lv_unit != ${v.hero}) && !UnitGroupHasUnit(${v.frozen}, lv_unit)) {`,
    `            ${v.freezeUnit}(lv_unit);`,
    "        }",
    "        lv_index -= 1;",
    "    }",
    "}",
    "",
    "// Freezes the world but the hero, who is paused with no anim pause so as to keep animating, and",
    "// pauses AI and mission time; the re-sweep freezes units created while it holds.",
    `void ${v.freeze} () {`,
    `    ${v.frozen} = UnitGroupEmpty();`,
    `    ${v.freezeNew}();`,
    `    libNtve_gf_PauseUnit(${v.hero}, true);`,
    "    AITimePause(true);",
    "    GameSetMissionTimePaused(true);",
    `    ${v.freezing} = true;`,
    `    ${v.freezes} += 1;`,
    ...run(v.sweep, v.sweepFunc),
    "}",
    "",
    `// The re-sweep, every ${SWEEP_SECONDS} s of real time while the freeze that ran it holds: a re-sweep`,
    "// still waiting when the next moment's freeze begins ends, leaving that freeze its own.",
    `bool ${v.sweepFunc} (bool testConds, bool runActions) {`,
    "    int lv_freeze;",
    "",
    `    lv_freeze = ${v.freezes};`,
    `    while (${v.freezing} && (lv_freeze == ${v.freezes})) {`,
    `        Wait(${SWEEP_SECONDS}, c_timeReal);`,
    `        if (${v.freezing} && (lv_freeze == ${v.freezes})) {`,
    `            ${v.freezeNew}();`,
    "        }",
    "    }",
    "    return true;",
    "}",
    "",
    "// Unfreezes the units the freeze froze and the hero, and resumes AI and mission time.",
    `void ${v.unfreeze} () {`,
    "    int lv_index;",
    "    unit lv_unit;",
    "",
    `    ${v.freezing} = false;`,
    `    lv_index = UnitGroupCount(${v.frozen}, c_unitCountAll);`,
    "    while (lv_index > 0) {",
    `        lv_unit = UnitGroupUnit(${v.frozen}, lv_index);`,
    "        libNtve_gf_PauseUnit(lv_unit, false);",
    `        libNtve_gf_SendActorMessageToUnit(lv_unit, "AnimSetPausedAll 0");`,
    "        lv_index -= 1;",
    "    }",
    `    libNtve_gf_PauseUnit(${v.hero}, false);`,
    "    AITimePause(false);",
    "    GameSetMissionTimePaused(false);",
    "}",
    "",
    "// Hides the game UI, as NativeLib's cinematic mode does but keeping BattleUI, remembering which",
    "// frames showed, and stores and clears the owner's selection.",
    `void ${v.hideUi} () {`,
    "    int lv_frame;",
    "",
    `    libNtve_gf_StoreUnitSelection(${v.player}, libNtve_ge_UnitSelectionStoreOption_ClearUnitSelection);`,
    `    UISetDragSelectEnabled(${all}, false);`,
    "    lv_frame = c_syncFrameTypeFirst;",
    "    while (lv_frame <= c_syncFrameTypeLast) {",
    `        ${v.uiWasVisible}[lv_frame] = UIFrameVisible(${v.player}, lv_frame);`,
    "        if (lv_frame != c_syncFrameTypeBattleUI) {",
    `            UISetFrameVisible(${all}, lv_frame, false);`,
    "        }",
    "        lv_frame += 1;",
    "    }",
    `    UIClearMessages(${all}, c_messageAreaAll);`,
    `    UISetMode(${all}, c_uiModeFullscreen, ${fx(UI_MODE_SECONDS)});`,
    "}",
    "",
    "// Shows the game UI as it was, and restores the owner's selection.",
    `void ${v.restoreUi} () {`,
    "    int lv_frame;",
    "",
    `    UISetMode(${all}, c_uiModeConsole, ${fx(UI_MODE_SECONDS)});`,
    "    lv_frame = c_syncFrameTypeFirst;",
    "    while (lv_frame <= c_syncFrameTypeLast) {",
    "        if (lv_frame != c_syncFrameTypeBattleUI) {",
    `            UISetFrameVisible(${all}, lv_frame, ${v.uiWasVisible}[lv_frame]);`,
    "        }",
    "        lv_frame += 1;",
    "    }",
    `    UISetDragSelectEnabled(${all}, true);`,
    `    libNtve_gf_RestoreUnitSelection(${v.player});`,
    "}",
    "",
    "// Saves and locks the owner's camera, pans and zooms it to the hero, then starts the sway.",
    `void ${v.cameraIn} () {`,
    `    CameraSave(${v.player});`,
    `    CameraLockInput(${v.player}, true);`,
    `    ${v.baseYaw} = (CameraGetYaw(${v.player}) + ${fx(camera.yawOffset)});`,
    `    CameraPan(${v.player}, UnitGetPosition(${v.hero}), ${fx(camera.zoomSeconds)}, -1.0, 10.0, false);`,
    `    ${eased("c_cameraValueDistance", fx(camera.distance), camera.zoomSeconds)}`,
    `    ${eased("c_cameraValuePitch", fx(camera.pitch), camera.zoomSeconds)}`,
    `    ${eased("c_cameraValueYaw", v.baseYaw, camera.zoomSeconds)}`,
    `    ${eased("c_cameraValueHeightOffset", fx(camera.heightOffset), camera.zoomSeconds)}`,
    `    ${v.swaying} = true;`,
    ...run(v.sway, v.swayFunc),
    "}",
    "",
    `// The sway, in real time once the zoom is done: yaw ±${sway.yaw} every ${sway.yawSeconds} s and height ±${sway.height}`,
    `// every ${sway.heightSeconds} s, each leg eased into the next, until the moment ends it.`,
    `bool ${v.swayFunc} (bool testConds, bool runActions) {`,
    "    fixed lv_yawLeft;",
    "    fixed lv_heightLeft;",
    "    fixed lv_yawWay;",
    "    fixed lv_heightWay;",
    "",
    "    lv_yawLeft = 0.0;",
    "    lv_heightLeft = 0.0;",
    "    lv_yawWay = 1.0;",
    "    lv_heightWay = 1.0;",
    `    Wait(${fx(camera.zoomSeconds)}, c_timeReal);`,
    `    while (${v.swaying}) {`,
    "        if (lv_yawLeft <= 0.0) {",
    `            ${eased("c_cameraValueYaw", `(${v.baseYaw} + ${fx(sway.yaw)} * lv_yawWay)`, sway.yawSeconds)}`,
    "            lv_yawWay = -lv_yawWay;",
    `            lv_yawLeft = ${fx(sway.yawSeconds)};`,
    "        }",
    "        if (lv_heightLeft <= 0.0) {",
    `            ${eased("c_cameraValueHeightOffset", `(${fx(camera.heightOffset)} + ${fx(sway.height)} * lv_heightWay)`, sway.heightSeconds)}`,
    "            lv_heightWay = -lv_heightWay;",
    `            lv_heightLeft = ${fx(sway.heightSeconds)};`,
    "        }",
    `        Wait(${SWEEP_SECONDS}, c_timeReal);`,
    `        lv_yawLeft -= ${SWEEP_SECONDS};`,
    `        lv_heightLeft -= ${SWEEP_SECONDS};`,
    "    }",
    "    return true;",
    "}",
    "",
    "// Stops the sway and returns the owner's camera to exactly where it was, then unlocks it.",
    `void ${v.cameraOut} () {`,
    `    ${v.swaying} = false;`,
    `    CameraRestore(${v.player}, ${fx(RESTORE_SECONDS)}, -1.0, 10.0);`,
    `    Wait(${fx(RESTORE_SECONDS)}, c_timeReal);`,
    `    CameraLockInput(${v.player}, false);`,
    "}",
    "",
    ...(glaze
      ? [
          "// Takes a glaze off at once.",
          `void ${v.removeGlaze} (actor lp_glaze) {`,
          `    ActorSend(lp_glaze, "ModelMaterialRemoveFrom ::Main");`,
          `    ActorSend(lp_glaze, "Destroy Immediate");`,
          "}",
          "",
        ]
      : []),
    `// Puts the glow on the hero: the burst at the hero's feet for ${BURST_SECONDS} s${aura ? ", the aura there, tinted" : ""}${glaze ? ",\n// and the glaze, after taking off a last moment's still fading" : ""}.`,
    `void ${v.glowOn} () {`,
    "    actor lv_burst;",
    "",
    ...(glaze ? [`    if (${v.fadingGlaze} != null) {`, `        ${v.removeGlaze}(${v.fadingGlaze});`, `        ${v.fadingGlaze} = null;`, "    }"] : []),
    `    lv_burst = libNtve_gf_AttachModelToUnit(${v.hero}, ${galaxyString(look.burstModel)}, "Ref_Origin");`,
    ...(aura ? [`    ${v.aura} = libNtve_gf_AttachModelToUnit(${v.hero}, ${galaxyString(aura)}, "Ref_Origin");`, `    ActorSend(${v.aura}, libNtve_gf_SetTintColor(${galaxyColor(look.auraTint)}, ${fx(look.auraHdr)}, 0.0));`] : []),
    ...(glaze ? [`    libNtve_gf_SendActorMessageToUnit(${v.hero}, ${galaxyString(`Create ${glaze}`)});`, `    ${v.glaze} = ActorFromScope(ActorScopeFromUnit(${v.hero}), ${galaxyString(glaze)});`] : []),
    `    Wait(${fx(BURST_SECONDS)}, c_timeReal);`,
    `    ActorSend(lv_burst, "Destroy Immediate");`,
    "}",
    "",
    ...(aura || glaze
      ? [
          "// Hands the glow to the fade, which fades it out and removes it in its own thread.",
          `void ${v.glowOff} () {`,
          ...(aura ? [`    ${v.fadingAura} = ${v.aura};`, `    ${v.aura} = null;`] : []),
          ...(glaze ? [`    ${v.fadingGlaze} = ${v.glaze};`, `    ${v.glaze} = null;`] : []),
          ...run(v.fade, v.fadeFunc),
          "}",
          "",
          `// The fade: the glow handed to it fades over ${look.glowFadeSeconds} s of real time, then goes${glaze ? ", the glaze unless a\n// moment since has taken it off" : ""}.`,
          `bool ${v.fadeFunc} (bool testConds, bool runActions) {`,
          ...(aura ? ["    actor lv_aura;"] : []),
          ...(glaze ? ["    actor lv_glaze;"] : []),
          "",
          ...(aura ? [`    lv_aura = ${v.fadingAura};`, `    ${v.fadingAura} = null;`, `    ActorSend(lv_aura, libNtve_gf_SetOpacity(0.0, ${fx(look.glowFadeSeconds)}));`] : []),
          ...(glaze ? [`    lv_glaze = ${v.fadingGlaze};`, "    if (lv_glaze != null) {", `        ActorSend(lv_glaze, libNtve_gf_SetOpacity(0.0, ${fx(look.glowFadeSeconds)}));`, "    }"] : []),
          `    Wait(${fx(look.glowFadeSeconds)}, c_timeReal);`,
          ...(aura ? [`    ActorSend(lv_aura, "Destroy Immediate");`] : []),
          ...(glaze ? [`    if ((lv_glaze != null) && (lv_glaze == ${v.fadingGlaze})) {`, `        ${v.removeGlaze}(lv_glaze);`, `        ${v.fadingGlaze} = null;`, "    }"] : []),
          "    return true;",
          "}",
          "",
        ]
      : []),
    "// Begin Hero Moment: waits its turn, then plays the moment's start on lp_hero; false, doing",
    "// nothing, if lp_hero is dead by then.",
    `bool ${v.begin} (unit lp_hero) {`,
    `    while (${v.inCinematic}() || ${v.playing} || (${v.linesPlaying} > 0)) {`,
    `        Wait(${POLL_SECONDS}, c_timeGame);`,
    "    }",
    "    if (!UnitIsAlive(lp_hero)) {",
    "        return false;",
    "    }",
    `    ${v.playing} = true;`,
    `    ${v.hero} = lp_hero;`,
    `    ${v.player} = UnitGetOwner(lp_hero);`,
    ...look.stingSounds.map((id) => `    ${sound(id)}`),
    `    ${v.freeze}();`,
    `    ${v.hideUi}();`,
    `    ${v.cameraIn}();`,
    `    ${v.glowOn}();`,
    "    return true;",
    "}",
    "",
    "// End Hero Moment: returns the camera, then after the hand-back resumes play and fades the glow.",
    `void ${v.end} () {`,
    `    if (!${v.playing}) {`,
    "        return;",
    "    }",
    `    ${v.cameraOut}();`,
    `    Wait(${fx(look.handBackSeconds)}, c_timeReal);`,
    `    ${v.unfreeze}();`,
    `    ${v.restoreUi}();`,
    ...(aura || glaze ? [`    ${v.glowOff}();`] : []),
    `    ${v.playing} = false;`,
    "}",
    "",
    "// Flash Hero: the flash model on lp_hero, scaled, with its sound; it pauses nothing.",
    `void ${v.flash} (unit lp_hero) {`,
    "    actor lv_flash;",
    "",
    "    if (!UnitIsAlive(lp_hero)) {",
    "        return;",
    "    }",
    `    lv_flash = libNtve_gf_AttachModelToUnit(lp_hero, ${galaxyString(look.flashModel)}, "Ref_Center");`,
    `    ActorSend(lv_flash, libNtve_gf_SetScale(${fx(look.flashScale)}, ${fx(look.flashScale)}, ${fx(look.flashScale)}, 0.0));`,
    `    ${sound(look.flashSound)}`,
    `    Wait(${fx(FLASH_SECONDS)}, c_timeReal);`,
    `    ActorSend(lv_flash, "Destroy Immediate");`,
    "}",
  ].join("\n");
}

/** Grant Hero Power, when the mod turns the choice picker on too; nothing when it doesn't. */
function grant(library: UiLibraryContext): UiFunction[] {
  const picker = library.other(CHOICE_PICKER_ID);
  if (!picker) return [];
  return [
    {
      name: GRANT,
      grammar: "Grant (~hero~) a power in a hero moment, headed (~header~), prompting (~prompt~), with the card (~icon~), (~title~), (~description~)",
      hint: "A story grant dressed as a level-up: plays the whole hero moment on the hero with a choice picker of one card, the power granted, and waits for the player to pick it before handing play back. It changes no level or experience and grants nothing itself, so give the hero the power after it. It does nothing if Begin Hero Moment gives false, as when the hero is dead.",
      parameters: [
        { name: "Hero", type: { type: "unit" } },
        { name: "Header", type: { type: "text" } },
        { name: "Prompt", type: { type: "text" } },
        { name: "Icon", type: { type: "filepath", assetType: "Image" } },
        { name: "Title", type: { type: "text" } },
        { name: "Description", type: { type: "text" } },
      ],
      galaxy: [
        `if (!${library.galaxyName("Begin Hero Moment")}(lp_hero)) {`,
        "    return;",
        "}",
        `${picker.galaxyName(SET_CHOICE_OPTION)}(1, lp_icon, lp_title, lp_description);`,
        `${picker.galaxyName(SHOW_CHOICE_PICKER)}(lp_header, lp_prompt, 1);`,
        `${library.galaxyName("End Hero Moment")}();`,
      ].join("\n"),
    },
  ];
}

export const HERO_MOMENT = defineUiComponent({
  id: ID,
  name: "HeroMoment",
  look: HeroMomentLook,
  script,
  functions: (_look, library) => {
    const v = names(library);
    return [
      {
        name: "Begin Hero Moment",
        grammar: "Begin a hero moment on (~hero~)",
        hint: "Freezes everything but the hero, hides the game UI, zooms the camera in on the hero and sways it, and puts a glow on the hero, with a sting; End Hero Moment hands play back. It waits while cinematic mode is on, another moment plays or an in-play line plays, then gives false, doing nothing, if the hero is dead, and true once the moment has begun (about 1.5 seconds in).",
        parameters: [{ name: "Hero", type: { type: "unit" } }],
        returns: { type: "bool" },
        galaxy: `return ${v.begin}(lp_hero);`,
      },
      {
        name: "End Hero Moment",
        hint: "Returns the camera to where it was, then, after a beat, unfreezes everything and shows the game UI and the selection again; the glow fades once play resumes. It does nothing when no moment plays.",
        galaxy: `${v.end}();`,
      },
      {
        name: IS_PLAYING,
        hint: "Whether a hero moment plays, from its Begin until its End has handed play back.",
        returns: { type: "bool" },
        galaxy: `return ${v.playing};`,
      },
      {
        name: HOLD_FOR_LINE,
        hint: "For an in-play line about to play: waits while a hero moment plays, then holds hero moments off, so Begin Hero Moment waits, until Release Hero Moments After Line. A compiled Mission calls it before each in-play line.",
        galaxy: [`while (${v.playing}) {`, `    Wait(${POLL_SECONDS}, c_timeGame);`, "}", `${v.linesPlaying} += 1;`].join("\n"),
      },
      {
        name: RELEASE_AFTER_LINE,
        hint: "For an in-play line that has played: lets hero moments play again, once every line holding them off has released them. A compiled Mission calls it once for each Hold Hero Moments For Line.",
        galaxy: [`if (${v.linesPlaying} > 0) {`, `    ${v.linesPlaying} -= 1;`, "}"].join("\n"),
      },
      ...grant(library),
      {
        name: "Flash Hero",
        grammar: "Flash (~hero~)",
        hint: "Plays the stat-level flash on the hero, with its sound. It pauses nothing, and during a hero moment it plays at once.",
        parameters: [{ name: "Hero", type: { type: "unit" } }],
        createThread: true,
        galaxy: `${v.flash}(lp_hero);`,
      },
    ];
  },
  actions: {
    grantHeroPower: {
      function: GRANT,
      needs: [CHOICE_PICKER_ID],
      params: z
        .object({
          /** The hero: a unit Anchor's or Kept unit's id. */
          hero: z.string().min(1),
          /** The picker's header and prompt over the card; none when left out. */
          header: z.string().default(""),
          prompt: z.string().default(""),
          /** The card: the power granted. The icon is an image file in the game's assets; none when left out. */
          icon: z.string().regex(IMAGE_FILE, "An image file in the game's assets, such as Assets\\Textures\\btn-quay-bell.dds: not an asset key (@UI/…), which a card's icon doesn't take").optional(),
          title: z.string().min(1),
          description: z.string().min(1),
        })
        .strict(),
      args: (params, mission) => ({
        hero: mission.unit(params.hero, "hero"),
        header: { kind: "text", text: params.header },
        prompt: { kind: "text", text: params.prompt },
        icon: { kind: "filepath", value: params.icon ?? "", asset: "image" },
        title: { kind: "text", text: params.title },
        description: { kind: "text", text: params.description },
      }),
    },
  },
});
