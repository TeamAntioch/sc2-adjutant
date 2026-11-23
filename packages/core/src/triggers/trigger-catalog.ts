// Trigger library definitions referenced by Editor GUI triggers.
//
// The Editor stores every native function, parameter and preset by an opaque
// library ID. These entries were read off Triggers/MapScript.galaxy pairs saved
// by Editor 5.0.17 (see tests/fixtures/editor-triggers) and cross-checked against
// the library definitions mirrored in github.com/SC2Mapster/SC2GameData
// (mods/core.sc2mod/.../NativeLib.TriggerLib; VoidCampaignMissionLib.SC2Lib).
// XML parameter order is whatever the Editor wrote, which can differ from
// definition order.
//
// These are the typed primitives the Blueprint builders and Plugins write calls with (ADR-0025):
// names and parameters, not Galaxy. A call's Galaxy comes from its function's template in the
// game's library data (src/mods/library-galaxy.ts); only an entry the data doesn't hold (VCMI's,
// until #951) writes its own.

import type { EnclosingCall } from "../mods/library-galaxy.js";

/** The game's trigger libraries this wraps. */
export type GameTriggerLibrary = "Ntve" | "Hots" | "VCMI";
/**
 * A trigger library: one of the game's, or a Campaign Mod's own, by the id its Mod Blueprint's
 * library interface declares (src/mods/library.ts). Core wraps no Campaign's library.
 */
export type TriggerLibrary = GameTriggerLibrary | (string & {});

/** Script include and init call of the game's libraries, in the order the Editor emits them. */
export const TRIGGER_LIBRARIES: Readonly<Record<GameTriggerLibrary, { readonly include: string; readonly init: string }>> = {
  Ntve: { include: "TriggerLibs/NativeLib", init: "libNtve_InitLib" },
  Hots: { include: "TriggerLibs/SwarmLib", init: "libHots_InitLib" },
  VCMI: { include: "TriggerLibs/VoidCampaignMissionLib", init: "libVCMI_InitLib" },
};

/** Whether a library is one of the game's, not a Campaign Mod's. */
export const isGameLibrary = (library: TriggerLibrary): library is GameTriggerLibrary => Object.hasOwn(TRIGGER_LIBRARIES, library);

/** A library's script include and init call: the game's own, or a mod library's Lib<id> and lib<id>_InitLib, as the Editor generates them. */
export function triggerLibraryScript(library: TriggerLibrary): { readonly include: string; readonly init: string } {
  return isGameLibrary(library) ? TRIGGER_LIBRARIES[library] : { include: `Lib${library}`, init: `lib${library}_InitLib` };
}

export type PresetDef = {
  readonly library: TriggerLibrary;
  readonly id: string;
  readonly galaxy: string;
  /** "value" -> <Preset Type="PresetValue"/>; "element" -> <ValueElement Type="Preset"/>. */
  readonly form: "value" | "element";
};

export type ParamDef = {
  readonly id: string;
  /** Unit parameters of events take a unit reference rather than a unit. */
  readonly unitRef?: boolean;
};

/** A block action's slot for nested calls, e.g. If Then Else's "Then". */
export type SubFunctionDef = {
  readonly library: TriggerLibrary;
  readonly id: string;
};

/** Where a call sits in the Galaxy the Editor generates: inside a Pick Each, Picked Unit is its loop variable. */
export type GalaxyScope = {
  readonly pickedUnit?: string;
};

/**
 * The GalaxyScope of a call inside `enclosing`, the template calls it sits in: the loop variable of
 * the nearest Pick Each, which its template names #AUTOVAR(var) (auto<call id>_var).
 */
export const galaxyScope = (enclosing: readonly EnclosingCall[]): GalaxyScope => {
  const pick = enclosing.findLast((outer) => outer.identifier === "PickEachUnitInGroup");
  return pick ? { pickedUnit: `auto${pick.call.id}_var` } : {};
};

export type FunctionDef = {
  readonly library: TriggerLibrary;
  readonly id: string;
  readonly kind: "event" | "condition" | "action" | "function";
  /** Parameters in the order the Editor writes them to XML. */
  readonly params: Readonly<Record<string, ParamDef>>;
  /** A block action, which holds nested calls in its slots (a TriggerCall's `blocks`) for its template to write. */
  readonly block?: "ifThenElse" | "pickEachUnit" | "switch" | "waitForCondition" | "while";
  /**
   * Its own Galaxy call, from rendered arguments; events also receive the trigger variable. Left
   * out, the call is written from its function's template in the game's library data (ADR-0025),
   * as core's primitives are. A function the data doesn't hold gives one.
   */
  readonly galaxy?: (args: Readonly<Record<string, string>>, trigger: string, scope: GalaxyScope) => string;
  /** The game's libraries a map calling this includes beside its own: for a Campaign Mod's function, those the mod's dependencies bring. */
  readonly requires?: readonly GameTriggerLibrary[];
};

/** Sub-function slots of the block actions, from NativeLib.TriggerLib. */
export const SUB_FUNCTIONS = {
  if: { library: "Ntve", id: "00000003" },
  then: { library: "Ntve", id: "00000004" },
  else: { library: "Ntve", id: "00000005" },
  pickEachActions: { library: "Ntve", id: "9441B8B5" },
  waitForCondition: { library: "Ntve", id: "C1E1D597" },
  whileConditions: { library: "Ntve", id: "20298AEC" },
  whileActions: { library: "Ntve", id: "A1B37466" },
} as const satisfies Record<string, SubFunctionDef>;

function preset(id: string, galaxy: string, form: PresetDef["form"] = "value", library: TriggerLibrary = "Ntve"): PresetDef {
  return { library, id, galaxy, form };
}

/**
 * The "pause" value (00000115) of Ntve's Pause/Unpause Option preset type (00000041), whose other
 * value is "unpause" (00000116). Pause Timer's and Pause AI Time's parameters (00000079, 90FC545F)
 * are both of that type.
 */
const PAUSE = preset("00000115", "true");

/** "any" (00000231) of Ntve's Any Game Link preset type (00000058): any unit type, any ability. */
const ANY_GAME_LINK = preset("00000231", "null");

export const NTVE_PRESETS = {
  // Booleans are separate presets per parameter type in Ntve.
  gameOverShowDialogTrue: preset("00000120", "true"),
  debugOutputShowInGameTrue: preset("00000071", "true"),
  objectiveShowTrue: preset("0801604A", "true"),
  gameOverDefeat: preset("00000118", "c_gameOverDefeat"),
  // From an Editor-saved map, whose only GameOver call is c_gameOverVictory.
  gameOverVictory: preset("00000117", "c_gameOverVictory"),
  objectiveStateActive: preset("24E7961A", "c_objectiveStateActive"),
  objectiveStateCompleted: preset("00000559", "c_objectiveStateCompleted"),
  objectiveStateFailed: preset("00000560", "c_objectiveStateFailed"),
  noObjective: preset("91651C80", "c_invalidObjectiveId"),
  checkConditions: preset("00000065", "true"),
  wait: preset("00000067", "true"),
  dontWait: preset("00000068", "false"),
  defaultPortraitModel: preset("225F11A5", "null"),
  anyUnit: preset("C84C7A78", "null"),
  regionEnters: preset("00000145", "true"),
  // Set Unit Position's "blend" off: the unit is put there at once.
  positionNoBlend: preset("0EA75E11", "false"),
  // No Actor (NoActor), an actor variable's initial value, and Attach Model To Unit's attach points (AttachPoints), from NativeLib.TriggerLib.
  noActor: preset("52D5A28A", "null"),
  attachPointCenter: preset("1112E4A0", '"Ref_Center"'),
  attachPointOrigin: preset("05EF205A", '"Ref_Origin"'),
  triggerOff: preset("00000545", "false"),
  orderQueueReplace: preset("00000039", "c_orderQueueReplace"),
  compareEqual: preset("1E7A4625", "=="),
  compareAtLeast: preset("B128CB9A", ">="),
  // Player properties (Preset 00000008, Player_Property_Get).
  playerPropMineralsCollected: preset("FBC23176", "c_playerPropMineralsCollected"),
  playerPropVespeneCollected: preset("3671A90E", "c_playerPropVespeneCollected"),
  // Send Transmission For Player, as an Editor-saved map calls it.
  transmissionFlash: preset("165A90EA", "true"),
  doNot: preset("00000072", "false"),
  /** "Do" of the Do/Do Not Option (00000022), Do Not's pair: Set Camera Bounds' default for its minimap. */
  do: preset("00000071", "true"),
  cinematicPortraitCenterLeft: preset("2D4517D5", "libNtve_ge_CinematicPortraitPosition_CenterLeft"),
  cinematicPortraitCenterRight: preset("6239027F", "libNtve_ge_CinematicPortraitPosition_CenterRight"),
  noSoundLink: preset("90583839", "null"),
  transmissionDurationSet: preset("92CD5912", "c_transmissionDurationSet"),
  transmissionDurationAdd: preset("9E07484E", "c_transmissionDurationAdd"),
  globalSoundPlayer: preset("8229CCB3", "c_maxPlayers"),
  timeGame: preset("00000013", "c_timeGame"),
  timeAI: preset("EC544EA4", "c_timeAI"),
  playerPropMinerals: preset("0794D450", "c_playerPropMinerals"),
  playerPropVespene: preset("D41E85DA", "c_playerPropVespene"),
  playerPropHandicap: preset("2232A90B", "c_playerPropHandicap"),
  playerPropSetTo: preset("D6715A64", "c_playerPropOperSetTo"),
  waterCurveLinear: preset("C4ACEC51", "c_wtcLinear"),
  messageAreaSubtitle: preset("875889C8", "c_messageAreaSubtitle"),
  messageAreaDirective: preset("A1F3F135", "c_messageAreaDirective"),
  directiveMessages: preset("08C4FF65", "c_messageAreaDirective"),
  // Timers, region checks and unit properties (goal timers, and Mechanics such as the flare).
  timerOneShot: preset("00000010", "false"),
  timerWindowVisible: preset("689B7C3F", "true"),
  timerWindowRemaining: preset("58436483", "false"),
  pause: PAUSE,
  unpause: preset("00000116", "false"),
  /** `pause`, by the name a Campaign Pack's Mechanic may use (a Plugin, which may be built against another copy of core). */
  timerPause: PAUSE,
  hide: preset("00000121", "false"),
  setPropertyLife: preset("F65D16B2", "c_unitPropLife"),
  getPropertyLife: preset("00000029", "c_unitPropLife"),
  propertyCurrent: preset("E66C6645", "c_unitPropCurrent"),
  minus: preset("00000086", "-"),
  debugOutputTypeDefault: preset("AEB4446D", "1"),
  unitCreateFlagsNone: preset("E85564CA", "0", "element"),
  noUnit: preset("D6EA4D09", "null"),
  compareLessOrEqual: preset("E123C832", "<="),
  anyUnitType: ANY_GAME_LINK,
  /** Unit Is Created's ability: made by any ability, or none. */
  anyAbility: ANY_GAME_LINK,
  /** Unit Is Created's behavior: No Game Link (C9DCA6C0), its default. */
  noBehavior: preset("C9DCA6C0", "null"),
  /** Unit Change Owner's colour: Change (the new owner's colour). */
  changeColor: preset("00000027", "true"),
  /** The player parameter of Units In Region Matching Conditions: any player. */
  anyPlayer: preset("2999701E", "c_playerAny"),
  anyAmount: preset("1468BD55", "0"),
  noTimerWindow: preset("4EDE1756", "c_timerWindowNone"),
  setPropertyResources: preset("F6D2A277", "c_unitPropResources"),
  getPropertyResources: preset("35EA11B2", "c_unitPropResources"),
  // Attack waves (ADR 0008); IDs from NativeLib.TriggerLib.
  waypointNormalMode: preset("F6A98FEE", "false"),
  unitCountAlive: preset("0E62911C", "c_unitCountAlive"),
  compareNotEqual: preset("500677B2", "!="),
  /** ArithmeticOp's plus (PresetValue 00000085), for Arithmetic (Integer) and (Real). */
  plus: preset("00000085", "+"),
  /** Unit Takes Damage's damage type (Preset 00000053): any. */
  damageTypeAny: preset("9F9C00A9", "c_unitDamageTypeAny"),
  /** Unit Behavior Changes' change: Create (0059E8B3), the Behavior put on the unit. */
  behaviorChangeCreate: preset("0059E8B3", "c_unitBehaviorChangeCreate"),
  /** Unit Behavior Changes' change: Destroy (D7C48C02), the Behavior gone from the unit. */
  behaviorChangeDestroy: preset("D7C48C02", "c_unitBehaviorChangeDestroy"),
  /** Unit Takes Damage's fatal option (Preset A3CF97C2): fatal or not. */
  damageFatalOrNot: preset("D33DD35C", "c_unitDamageEither"),
  /** Triggering Effect Unit's location (EffectUnit, BF3150F6): the effect's caster (090AE922), or its target (6ABB7B54). */
  effectUnitCaster: preset("090AE922", "c_effectUnitCaster"),
  effectUnitTarget: preset("6ABB7B54", "c_effectUnitTarget"),
  /** Unit Takes Damage's effect: any (Ntve's Any Game Link, 00000231). */
  anyEffect: ANY_GAME_LINK,
  triggerOn: preset("00000538", "true"),
  noWave: preset("DD3649E2", "null"),
  // Tech restrictions (a blueprint's `tech`): Allow_Disallow_Option (00000036) and Enable_Disable_Option (00000018), from NativeLib.TriggerLib.
  allow: preset("00000106", "true"),
  disallow: preset("00000107", "false"),
  enable: preset("00000063", "true"),
  disable: preset("00000064", "false"),
  /** VisibilityType (00000034), which Enable/Disable Visibility takes: the black mask, or the fog of war. */
  visTypeMask: preset("00000102", "c_visTypeMask"),
  visTypeFog: preset("00000103", "c_visTypeFog"),
  // A Cinematic's playback in a full-screen dialog (RECIPES.md "Cinematic"); IDs from NativeLib.TriggerLib.
  /** On_Off_Option (00000083), which Cinematic Mode takes: the same values as Turn On/Off. */
  on: preset("00000538", "true"),
  off: preset("00000545", "false"),
  /** Show_Hide_Option (00000043). */
  show: preset("00000120", "true"),
  anchorCenter: preset("8094C4C1", "c_anchorCenter"),
  modal: preset("440EEF91", "true"),
  controlTypeCutscene: preset("B0CEB7F5", "c_triggerControlTypeCutscene"),
  renderTypeHDR: preset("B99D8649", "c_triggerRenderTypeHDR"),
  environmentAll: preset("F9D3799C", "c_environmentAll"),
  /** ScreenMode (D73D8EE1), which Set Screen Mode takes. */
  screenModeFullscreen: preset("B2D12F4E", "c_uiModeFullscreen"),
  noDialog: preset("B76A7F2A", "c_invalidDialogId"),
  noCutscene: preset("A2833C70", "c_cutsceneNone"),
  /** The Cutscene preset's other value: an event's "any cutscene", also c_cutsceneNone (NativeLib.TriggerLib). */
  anyCutscene: preset("1B5A4DE6", "c_cutsceneNone"),
  noTrigger: preset("00000542", "null"),
  /** AllCount: every player in the group must skip (an Editor-saved map's skips use it). */
  skipAllPlayers: preset("F10CB109", "0"),
  // Kept triggers (ADR-0010): the presets a Kept map's stealth triggers use, each checked
  // against that map's Editor-saved pair: every element calling them was rendered from its Triggers
  // XML and compared with its MapScript.galaxy, the check tune_kept_triggers makes before each tune.
  timeReal: preset("00000012", "c_timeReal"),
  dontCheckConditions: preset("00000066", "false"),
  transitionDurationDefault: preset("F4355835", "c_transitionDurationDefault"),
  orderQueueAddToEnd: preset("00000040", "c_orderQueueAddToEnd"),
  /** Make Unit Uncommandable's On/Off. */
  uncommandableOn: preset("922B41E8", "true"),
  uncommandableOff: preset("0DB68CA1", "false"),
  soundtrackCategoryMusic: preset("E98A7B56", "c_soundtrackCategoryMusic"),
  soundtrackCategoryAmbience: preset("E7ED4CD8", "c_soundtrackCategoryAmbience"),
  soundtrackCueAny: preset("509577D5", "c_soundtrackCueAny"),
  /** Pause/Unpause Soundtrack's fade (Ntve's Sound Fade Option, 00000040): fade, or stop at once. */
  soundFade: preset("00000113", "true"),
  soundNoFade: preset("00000114", "false"),
  soundtrackIndexAny: preset("E06A6646", "c_soundtrackIndexAny"),
  /** Set All Sound Channel Volumes' mode (Ntve's Volume Channel Mode, CC07E877): Speech puts Music at 70% under lines; Game puts it back. */
  volumeChannelModeSpeech: preset("2533E455", "libNtve_ge_VolumeChannelMode_Speech"),
  volumeChannelModeGame: preset("8D1C3764", "libNtve_ge_VolumeChannelMode_Game"),
  /** No Sound, a sound variable's empty value. */
  noSound: preset("7B90D057", "null"),
  /** No Transmission (Ntve's Transmission Values, C4084B87), a transmission variable's empty value. */
  noTransmission: preset("4793D9F3", "c_invalidTransmissionId"),
  /** Apply Camera Object's and Pan Camera's default velocity. */
  cameraVelocityDefault: preset("4D47A35C", "-1"),
  /** Apply Camera Object's Use Target (CameraUseTargetOption, 00000045): include the object's target, or leave the camera's own. */
  cameraUseTarget: preset("00000129", "true"),
  cameraDontUseTarget: preset("00000130", "false"),
  /** Cinematic Fade's direction: in (to the scene) or out (to the colour). */
  fadeIn: preset("00000546", "true"),
  fadeOut: preset("00000547", "false"),
  fadeStyleNormal: preset("80AEE9D1", "c_fadeStyleNormal"),
  lockInput: preset("00000296", "true"),
  unlockInput: preset("00000297", "false"),
  /** Wait Until Unit Is Idle's Wait For Orders To Finish. */
  waitUntilIdleTrue: preset("4EED99E0", "true"),
  cameraFollowOn: preset("692A460B", "true"),
  cameraFollowOff: preset("C3CCFDE1", "false"),
  /** Camera Follow Unit Group's Clear Current Target Offset. */
  cameraFollowKeepOffset: preset("E67B9D6B", "false"),
  select: preset("00000108", "true"),
  /** Explore/Unexplore Area's State (Explored/Unexplored Option, 00000035). */
  explored: preset("00000104", "true"),
  unexplored: preset("00000105", "false"),
} as const;

export const NTVE_FUNCTIONS = {
  mapInit: {
    library: "Ntve",
    id: "00000120",
    kind: "event",
    params: {},
  },
  unitDies: {
    library: "Ntve",
    id: "00000090",
    kind: "event",
    params: { unit: { id: "00000159", unitRef: true } },
  },
  gameOver: {
    library: "Ntve",
    id: "00000198",
    kind: "action",
    params: {
      player: { id: "00000334" },
      type: { id: "00000335" },
      showDialog: { id: "00000336" },
      showScore: { id: "00000337" },
    },
  },
  unitCreate: {
    library: "Ntve",
    id: "6C39A0DF",
    kind: "action",
    params: {
      count: { id: "972A74CB" },
      flags: { id: "5AC69524" },
      player: { id: "1EC7B7A1" },
      facing: { id: "5908CAE6" },
      unitType: { id: "EF0CF6FF" },
      point: { id: "9329BF02" },
    },
  },
  setVariable: {
    library: "Ntve",
    id: "00000136",
    kind: "action",
    params: { variable: { id: "00000219" }, value: { id: "00000220" } },
  },
  lastCreatedUnit: {
    library: "Ntve",
    id: "00000076",
    kind: "function",
    params: {},
  },
  // The default Melee Initialization trigger's actions, as every ladder map calls them (melee research §4).
  meleeInitResources: { library: "Ntve", id: "00000143", kind: "action", params: {} },
  meleeInitUnits: { library: "Ntve", id: "00000145", kind: "action", params: {} },
  meleeInitAI: { library: "Ntve", id: "00000150", kind: "action", params: {} },
  meleeInitOptions: { library: "Ntve", id: "00000148", kind: "action", params: {} },
  triggerDebugOutput: {
    library: "Ntve",
    id: "00000118",
    kind: "action",
    params: {
      type: { id: "C3CF50B0" },
      showInGame: { id: "00000187" },
      message: { id: "00000186" },
    },
  },
  objectiveCreate: {
    library: "Ntve",
    id: "1D6F1270",
    kind: "action",
    params: {
      description: { id: "064A402E" },
      state: { id: "BD92541B" },
      show: { id: "E2D11CC0" },
      name: { id: "3D400D51" },
    },
  },
  objectiveShow: {
    library: "Ntve",
    id: "19BA63F9",
    kind: "action",
    params: { objective: { id: "171BF7EF" }, players: { id: "306BC96B" }, show: { id: "F4578ECB" } },
  },
  objectiveSetState: {
    library: "Ntve",
    id: "00000440",
    kind: "action",
    params: { objective: { id: "00000853" }, state: { id: "00000854" } },
  },
  lastCreatedObjective: {
    library: "Ntve",
    id: "00000433",
    kind: "function",
    params: {},
  },
  // Trigger Is Enabled (NativeLib FunctionDef 00000112).
  triggerIsEnabled: {
    library: "Ntve",
    id: "00000112",
    kind: "function",
    params: { trigger: { id: "00000178" } },
  },
  // Wait For Trigger (NativeLib FunctionDef 81F08ADC): waits until the trigger runs, and with Wait until it is done.
  waitForTrigger: {
    library: "Ntve",
    id: "81F08ADC",
    kind: "action",
    params: { trigger: { id: "6FD0599D" }, wait: { id: "00B7706F" } },
  },
  triggerExecute: {
    library: "Ntve",
    id: "00000116",
    kind: "action",
    params: { checkConditions: { id: "00000183" }, wait: { id: "00000184" }, trigger: { id: "00000182" } },
  },
  // XML parameter order as an Editor-saved map saved it (Speaker and Message last).
  sendTransmission: {
    library: "Ntve",
    id: "00B542C6",
    kind: "action",
    params: {
      players: { id: "19691E5C" },
      source: { id: "1C6F10B7" },
      portrait: { id: "FA58B586" },
      portraitActor: { id: "78451991" },
      portraitAnim: { id: "8BC7FBEC" },
      sound: { id: "223A506F" },
      duration: { id: "3BF740D3" },
      durationType: { id: "50A2BA34" },
      wait: { id: "2D972B37" },
      player: { id: "2499246E" },
      isSelect: { id: "00D8693F" },
      speaker: { id: "315895F0" },
      message: { id: "6B561370" },
    },
  },
  allPlayers: {
    library: "Ntve",
    id: "00000192",
    kind: "function",
    params: {},
  },
  unitTransmissionSource: {
    library: "Ntve",
    id: "63326FA7",
    kind: "function",
    params: { flash: { id: "B27E6185" }, overridePortrait: { id: "31B8B230" }, anim: { id: "824CC52C" }, unit: { id: "F70DE498" } },
  },
  // For speakers who aren't placed on the map, e.g. "Raynor" on comms.
  unitTypeTransmissionSource: {
    library: "Ntve",
    id: "ED236D9F",
    kind: "function",
    params: { overridePortrait: { id: "61DFA540" }, unitType: { id: "CD28A809" } },
  },
  // For speakers known only by their portrait model, e.g. a hologram portrait.
  modelTransmissionSource: {
    library: "Ntve",
    id: "A2B4587F",
    kind: "function",
    params: { model: { id: "A7C7A2F1" } },
  },
  noTransmissionSource: {
    library: "Ntve",
    id: "C551984B",
    kind: "function",
    params: {},
  },
  cinematicPortrait: {
    library: "Ntve",
    id: "B8AD02AA",
    kind: "function",
    params: { position: { id: "064853AE" } },
  },
  // Presentation; XML parameter order as Editor-saved maps saved them.
  setLighting: {
    library: "Ntve",
    id: "BB08B228",
    kind: "action",
    params: { blendTime: { id: "E7C53B1B" }, light: { id: "E71472FB" } },
  },
  // A trigger scene's world (L2, L3); IDs from NativeLib.TriggerLib, one parameter each but VisEnable's.
  fogSetEnabled: { library: "Ntve", id: "59DA6647", kind: "action", params: { enable: { id: "7A0E9417" } } },
  fogSetDensity: { library: "Ntve", id: "0C83D19F", kind: "action", params: { density: { id: "A2D7E343" } } },
  fogSetColor: { library: "Ntve", id: "9D5EB505", kind: "action", params: { color: { id: "2E515FC7" } } },
  fogSetFallOff: { library: "Ntve", id: "B3D5BF65", kind: "action", params: { falloff: { id: "C68E062E" } } },
  fogSetStartHeight: { library: "Ntve", id: "10393B26", kind: "action", params: { startHeight: { id: "9F214D76" } } },
  /** Enable/Disable Visibility: the black mask (Visibility Type mask) or the fog of war (fog). */
  visEnable: {
    library: "Ntve",
    id: "00000162",
    kind: "action",
    params: { type: { id: "00000264" }, enable: { id: "00000265" } },
  },
  visIsEnabled: { library: "Ntve", id: "00000163", kind: "function", params: { type: { id: "00000266" } } },
  // XML parameter order as 3-11 saved it ("Raise Lava").
  setWaterState: {
    library: "Ntve",
    id: "56D51508",
    kind: "action",
    params: { duration: { id: "E26A7ECA" }, curve: { id: "4EE9832C" }, water: { id: "51DAD3CF" } },
  },
  wait: {
    library: "Ntve",
    id: "00000242",
    kind: "action",
    params: { time: { id: "00000419" }, timeType: { id: "00000420" } },
  },
  textMessage: {
    library: "Ntve",
    id: "0366EE04",
    kind: "action",
    params: { players: { id: "0D120C33" }, area: { id: "A4C19F41" }, message: { id: "78A54B52" } },
  },
  playSound: {
    library: "Ntve",
    id: "651D9322",
    kind: "action",
    params: {
      owningPlayer: { id: "4FD0F5E6" },
      audibleTo: { id: "420B8251" },
      volume: { id: "83444B10" },
      offset: { id: "1D1E66BC" },
      sound: { id: "B7793BD2" },
    },
  },
  // Timers; XML parameter order as Editor-saved and Blizzard maps wrote it.
  newTimer: {
    library: "Ntve",
    id: "00000193",
    kind: "function",
    params: {},
  },
  timerStart: {
    library: "Ntve",
    id: "00000042",
    kind: "action",
    params: { duration: { id: "00000074" }, repeating: { id: "00000075" }, timeType: { id: "00000076" }, timer: { id: "00000073" } },
  },
  timerExpires: {
    library: "Ntve",
    id: "00000049",
    kind: "event",
    params: { timer: { id: "00000086" } },
  },
  timerIsPaused: {
    library: "Ntve",
    id: "00000194",
    kind: "function",
    params: { timer: { id: "00000422" } },
  },
  timerPause: {
    library: "Ntve",
    id: "00000044",
    kind: "action",
    params: { timer: { id: "00000078" }, pause: { id: "00000079" } },
  },
  timerWindowCreate: {
    library: "Ntve",
    id: "3FCF7471",
    kind: "action",
    params: { timer: { id: "8D2781C5" }, visible: { id: "B92D669E" }, elapsed: { id: "E26FAF59" }, title: { id: "8B144181" } },
  },
  timerWindowShow: {
    library: "Ntve",
    id: "00000471",
    kind: "action",
    params: { window: { id: "00000929" }, players: { id: "00000930" }, show: { id: "00000931" } },
  },
  lastCreatedTimerWindow: {
    library: "Ntve",
    id: "00000469",
    kind: "function",
    params: {},
  },
  unitInRegion: {
    library: "Ntve",
    id: "22E8E351",
    kind: "function",
    params: { unit: { id: "54D03063" }, region: { id: "9EB21B31" } },
    // Not native: a NativeLib helper.
  },
  setUnitPropertyFixed: {
    library: "Ntve",
    id: "00000087",
    kind: "action",
    params: { unit: { id: "00000151" }, property: { id: "00000152" }, value: { id: "00000153" } },
  },
  unitPropertyFixed: {
    library: "Ntve",
    id: "C65CC121",
    kind: "function",
    params: { unit: { id: "9ADE2B3B" }, property: { id: "D1035B0C" }, current: { id: "D006774F" } },
  },
  // Runs a data effect (e.g. a map-local CEffectDamage) on a unit with a player as caster.
  playerCreateEffectUnit: {
    library: "Ntve",
    id: "EF15E7E2",
    kind: "action",
    params: { caster: { id: "FE72E71F" }, effect: { id: "B3AB20FD" }, unit: { id: "E4E74177" } },
  },
  arithmeticReal: {
    library: "Ntve",
    id: "00000129",
    kind: "function",
    params: { left: { id: "00000208" }, operator: { id: "00000209" }, right: { id: "00000210" } },
  },
  // Encounter building blocks; XML forms taken from an Editor-saved map.
  unitEntersRegion: {
    library: "Ntve",
    id: "00000041",
    kind: "event",
    params: { unit: { id: "00000325", unitRef: true }, state: { id: "00000327" }, region: { id: "00000326" } },
  },
  comparison: {
    library: "Ntve",
    id: "C439C375",
    kind: "condition",
    params: { left: { id: "ABB380C4" }, operator: { id: "51567265" }, right: { id: "4A15EC5F" } },
  },
  // Resource quotas; IDs from SC2GameData's NativeLib.TriggerLib, XML parameter order as defined there.
  playerPropertyChanges: {
    library: "Ntve",
    id: "B83E0A67",
    kind: "event",
    params: { player: { id: "74719857" }, property: { id: "E5C21E1D" } },
  },
  playerPropertyInt: {
    library: "Ntve",
    id: "00000051",
    kind: "function",
    params: { player: { id: "00000090" }, property: { id: "00000091" } },
  },
  unitOwner: {
    library: "Ntve",
    id: "00000081",
    kind: "function",
    params: { unit: { id: "00000140" } },
  },
  triggeringUnit: {
    library: "Ntve",
    id: "00000092",
    kind: "function",
    params: {},
  },
  triggerEnable: {
    library: "Ntve",
    id: "00000111",
    kind: "action",
    params: { trigger: { id: "00000176" }, state: { id: "00000177" } },
  },
  currentTrigger: {
    library: "Ntve",
    id: "00000217",
    kind: "function",
    params: {},
  },
  unitIssueOrder: {
    library: "Ntve",
    id: "00000089",
    kind: "action",
    params: { unit: { id: "00000156" }, order: { id: "00000157" }, queue: { id: "00000158" } },
  },
  orderTargetingPoint: {
    library: "Ntve",
    id: "43F16BA5",
    kind: "function",
    params: { point: { id: "32BBED47" }, abilityCommand: { id: "B796880B" } },
  },
  // XML order (unit, then ability command) as Blizzard's thanson01 Triggers saved it; Galaxy order from the native.
  orderTargetingUnit: {
    library: "Ntve",
    id: "F6F9120D",
    kind: "function",
    params: { unit: { id: "402665EE" }, abilityCommand: { id: "BF82A2BC" } },
  },
  unitPosition: {
    library: "Ntve",
    id: "00000083",
    kind: "function",
    params: { unit: { id: "00000144" } },
  },
  // Blocks, unit groups, behaviours and timer windows. IDs and XML parameter order from
  // SC2GameData's NativeLib.TriggerLib; the block forms as an Editor-saved map's Triggers hold them.
  ifThenElse: {
    library: "Ntve",
    id: "00000137",
    kind: "action",
    params: {},
    block: "ifThenElse",
  },
  pickEachUnitInGroup: {
    library: "Ntve",
    id: "C4DC760C",
    kind: "action",
    params: { group: { id: "F96B466D" } },
    block: "pickEachUnit",
  },
  pickedUnit: {
    library: "Ntve",
    id: "19CE733E",
    kind: "function",
    params: {},
  },
  unitsInRegionMatching: {
    library: "Ntve",
    id: "00000359",
    kind: "function",
    params: {
      unitType: { id: "00000691" },
      player: { id: "00000692" },
      region: { id: "00000693" },
      filter: { id: "00000695" },
      count: { id: "00000694" },
    },
  },
  entireMap: {
    library: "Ntve",
    id: "00000356",
    kind: "function",
    params: {},
  },
  unitHasBehavior: {
    library: "Ntve",
    id: "142FF15A",
    kind: "function",
    params: { unit: { id: "033DFD05" }, behavior: { id: "B29EDD13" } },
  },
  // Owners, upgrades, messages and behaviours; IDs from SC2GameData's NativeLib.TriggerLib, Galaxy forms as Editor-saved maps compiled them.
  unitOwnerChanges: {
    library: "Ntve",
    id: "FF16983A",
    kind: "event",
    params: { unit: { id: "DFB06A26", unitRef: true } },
  },
  // Tech restrictions (a blueprint's `tech`): IDs read off NativeLib.TriggerLib, parameters in
  // definition order, not yet checked against an Editor-saved map. A Campaign Pack's capture Mechanic uses
  // allowUnit too, to lock the Sentry until a capture.
  allowUnit: {
    library: "Ntve",
    id: "51A273F5",
    kind: "action",
    params: { player: { id: "B15D29C1" }, unitType: { id: "BC66D9AD" }, allow: { id: "C26556EA" } },
  },
  allowUpgrade: {
    library: "Ntve",
    id: "0B0A4FBE",
    kind: "action",
    params: { player: { id: "082DE673" }, upgrade: { id: "44F827BC" }, allow: { id: "87723663" } },
  },
  techRestrictionsEnable: {
    library: "Ntve",
    id: "12A2BFA8",
    kind: "action",
    params: { player: { id: "A52841FC" }, enable: { id: "3ED9959A" } },
  },
  setUpgradeLevel: {
    library: "Ntve",
    id: "9F8EF8FB",
    kind: "action",
    params: { player: { id: "C7188352" }, upgrade: { id: "7E5035EE" }, level: { id: "3BFEECBB" } },
    // Not native: a NativeLib helper.
  },
  clearTextMessages: {
    library: "Ntve",
    id: "33E26C4B",
    kind: "action",
    params: { players: { id: "CCFF1CD5" }, options: { id: "D8219C9F" } },
  },
  addBehavior: {
    library: "Ntve",
    id: "C47C0524",
    kind: "action",
    params: { unit: { id: "2E722704" }, behavior: { id: "9A6B09E3" }, caster: { id: "02BBDCC1" }, count: { id: "6F19F7ED" } },
  },
  // Unit Change Owner: a trigger scene's unit change, and a Campaign Pack's capture (checked byte-exact against an Editor-saved map).
  unitSetOwner: {
    library: "Ntve",
    id: "00000082",
    kind: "action",
    params: { unit: { id: "00000141" }, player: { id: "00000142" }, color: { id: "00000143" } },
  },
  removeBehavior: {
    library: "Ntve",
    id: "09840835",
    kind: "action",
    params: { unit: { id: "A6600060" }, behavior: { id: "EB47C731" }, count: { id: "A45406E1" } },
  },
  timerWindowSetTitle: {
    library: "Ntve",
    id: "00000473",
    kind: "action",
    params: { window: { id: "00000934" }, title: { id: "00000935" } },
  },
  periodicEvent: {
    library: "Ntve",
    id: "6D565EB4",
    kind: "event",
    params: { duration: { id: "4AB413B8" }, timeType: { id: "3E8E573F" } },
  },
  // Enemy AI (enemy-ai §2, §3); IDs from NativeLib.TriggerLib.
  aiCampaignStart: {
    library: "Ntve",
    id: "E2E35DF6",
    kind: "action",
    params: { player: { id: "F54F80C5" } },
  },
  modifyPlayerProperty: {
    library: "Ntve",
    id: "943DF2F7",
    kind: "action",
    params: { player: { id: "75FC31CB" }, property: { id: "4AA9487D" }, operation: { id: "C93A9DCB" }, value: { id: "EEF303AC" } },
  },
  // "Pause AI Time": stops the AI clock that Wait(…, c_timeAI) and timed waves run on (enemy-ai §1.3).
  aiTimePause: {
    library: "Ntve",
    id: "BC622053",
    kind: "action",
    params: { pause: { id: "90FC545F" } },
  },
  // "AI Time Is Paused": NativeLib.TriggerLib FunctionDef D59E1980 (identifier AITimeIsPaused, a
  // native call returning bool, no parameters); `native bool AITimeIsPaused ()` in natives.galaxy.
  // So a scene unpauses only an AI it paused itself, as NativeLib's Global Cinematic Setting does.
  aiTimeIsPaused: {
    library: "Ntve",
    id: "D59E1980",
    kind: "function",
    params: {},
  },
  // A Cinematic's playback, LotV's way (RECIPES.md "Cinematic"): NativeLib.TriggerLib FunctionDefs,
  // read with their ParamDefs from the core mod's copy (sc2-research's cutscene downloads); XML
  // parameter order as defined there, Galaxy argument order from natives.galaxy and NativeLib_h.galaxy.
  // Not Story Mode: its wrapper ends in the native StoryMode, which only Blizzard's maps may call
  // ("Calling StoryMode is not authorized" in ours). Cinematic Mode hides the game UI, and Set Screen
  // Mode (FunctionDef 8EDD3557, `native void UISetMode (playergroup players, int mode, fixed
  // duration)`) to Fullscreen after it drops the letterbox bars, as Blizzard's Setup does.
  setScreenMode: {
    library: "Ntve",
    id: "8EDD3557",
    kind: "action",
    params: { players: { id: "AE2D0D80" }, mode: { id: "5328E238" }, duration: { id: "31F1731E" } },
  },
  cinematicMode: {
    library: "Ntve",
    id: "E92E544E",
    kind: "action",
    params: { onOff: { id: "C016C6E2" }, players: { id: "8F9FC828" }, duration: { id: "5755FC77" } },
  },
  dialogCreate: {
    library: "Ntve",
    id: "BD9AF7D6",
    kind: "action",
    params: { width: { id: "0A54556D" }, height: { id: "2E6CF4F4" }, anchor: { id: "F4B2815D" }, offsetX: { id: "D323187B" }, offsetY: { id: "6580A7BB" }, modal: { id: "AB235258" } },
  },
  dialogLastCreated: {
    library: "Ntve",
    id: "20E3B9BE",
    kind: "function",
    params: {},
  },
  dialogSetFullscreen: {
    library: "Ntve",
    id: "7E8F82B1",
    kind: "action",
    params: { dialog: { id: "509A05AA" }, fullscreen: { id: "2528D993" } },
  },
  dialogSetImageVisible: {
    library: "Ntve",
    id: "9C391799",
    kind: "action",
    params: { dialog: { id: "2B74049D" }, visible: { id: "14A0F8BA" } },
  },
  dialogSetVisible: {
    library: "Ntve",
    id: "72C1FB76",
    kind: "action",
    params: { dialog: { id: "CB9F19F9" }, players: { id: "FF091149" }, visible: { id: "25A88BC6" } },
  },
  dialogDestroy: {
    library: "Ntve",
    id: "F4B5BEE7",
    kind: "action",
    params: { dialog: { id: "C5AA206D" } },
  },
  dialogControlCreate: {
    library: "Ntve",
    id: "1005DE91",
    kind: "action",
    params: { dialog: { id: "018A24CC" }, type: { id: "84675940" } },
  },
  dialogControlLastCreated: {
    library: "Ntve",
    id: "4AB42F83",
    kind: "function",
    params: {},
  },
  dialogControlSetFullDialog: {
    library: "Ntve",
    id: "96B15E03",
    kind: "action",
    params: { dialogItem: { id: "434DDA66" }, players: { id: "98F0E808" }, sizeToParent: { id: "7B1A6381" } },
  },
  setDialogItemCutscene: {
    library: "Ntve",
    id: "EF6279C8",
    kind: "action",
    params: { dialogItem: { id: "8981CFFF" }, cutscene: { id: "98636F14" }, players: { id: "1C46AA0F" } },
  },
  setDialogItemRenderType: {
    library: "Ntve",
    id: "B4E65256",
    kind: "action",
    params: { dialogItem: { id: "3DC23B38" }, renderType: { id: "57149937" }, players: { id: "4B015C65" } },
  },
  cutsceneOfDialogItem: {
    library: "Ntve",
    id: "E6F8D690",
    kind: "function",
    params: { dialogItem: { id: "1E9E9A97" } },
  },
  // A Cinematic pauses and hides the map's units, as Editor-made cutscenes do (Hide Environment leaves
  // them); NativeLib's library functions, so each renders as its libNtve_gf_ call.
  pauseUnit: {
    library: "Ntve",
    id: "30000000",
    kind: "action",
    params: { unit: { id: "90000000" }, pause: { id: "01000000" } },
  },
  showHideUnit: {
    library: "Ntve",
    id: "40000000",
    kind: "action",
    params: { unit: { id: "11000000" }, showHide: { id: "21000000" } },
  },
  unitIsPaused: {
    library: "Ntve",
    id: "8518EA3D",
    kind: "function",
    params: { unit: { id: "BAD9EC09" } },
  },
  unitIsHidden: {
    library: "Ntve",
    id: "49A95989",
    kind: "function",
    params: { unit: { id: "13EDC264" } },
  },
  unitGroupAdd: {
    library: "Ntve",
    id: "9435D821",
    kind: "action",
    params: { group: { id: "BE7DBEA1" }, unit: { id: "58E3C3B3" } },
  },
  // Remove Unit From Unit Group, for a mission trigger to take a unit back from a Cinematic's
  // groups; IDs from NativeLib.TriggerLib, parameters in definition order.
  unitGroupRemove: {
    library: "Ntve",
    id: "90CBEC01",
    kind: "action",
    params: { group: { id: "3CACD790" }, unit: { id: "834C89B2" } },
  },
  // Unit Is Created and Created Unit, for a unit made while a Cinematic plays; XML order as
  // an Editor-made Campaign's "Unit Spawned During Cutscene (Created)" trigger writes it.
  unitCreated: {
    library: "Ntve",
    id: "18377668",
    kind: "event",
    params: { creator: { id: "B38CA56F", unitRef: true }, ability: { id: "B6D9C7C9" }, behavior: { id: "4E42D7EB" } },
  },
  createdUnit: {
    library: "Ntve",
    id: "11EB5EB1",
    kind: "function",
    params: {},
  },
  // Show/Hide Environment: the map's terrain, water, doodads and backgrounds (all, with c_environmentAll).
  environmentShow: {
    library: "Ntve",
    id: "F5C63A46",
    kind: "action",
    params: { environmentType: { id: "8AE23CB6" }, showHide: { id: "23F2D708" } },
  },
  // A cutscene in the world, its 0,0,0 at `pos`: Point(64, 64) lines a cutscene built over the map
  // up with its terrain, as the Cutscene Editor's Import Terrain Data does (editor-and-engine.md).
  cutsceneCreateNew: {
    library: "Ntve",
    id: "5958C7E2",
    kind: "action",
    params: { path: { id: "FCE9F560" }, pos: { id: "D79F04DA" }, facing: { id: "6C7A1934" }, players: { id: "96AE898A" }, autoPlay: { id: "2D3D7425" } },
  },
  cutsceneLastCreated: {
    library: "Ntve",
    id: "D3945DFC",
    kind: "function",
    params: {},
  },
  cutscenePlay: {
    library: "Ntve",
    id: "C560675A",
    kind: "action",
    params: { cutscene: { id: "2391A8BE" } },
  },
  cutsceneStop: {
    library: "Ntve",
    id: "C575C576",
    kind: "action",
    params: { cutscene: { id: "3347CAA4" } },
  },
  waitForCutsceneToEnd: {
    library: "Ntve",
    id: "0CDF60FB",
    kind: "action",
    params: { cutscene: { id: "8FFCE045" } },
  },
  // A running cutscene's events (docs/reference/editor-and-engine.md, "A cutscene's events"), ids read
  // off NativeLib.TriggerLib. Cutscene Bookmark Fired (22F7DAC6): `TriggerAddEventCutsceneBookmarkFired(t,
  // int cutscene, string bookmark)`, as playback passes the bookmark. Its cutscene is a handle, or Any
  // Cutscene (`anyCutscene`); an empty bookmark name matches nothing.
  cutsceneBookmarkFired: {
    library: "Ntve",
    id: "22F7DAC6",
    kind: "event",
    params: { cutscene: { id: "93D0259C" }, bookmark: { id: "6B4F112F" } },
  },
  // Cutscene End Scene Fired (2C194B61): `TriggerAddEventCutsceneEndSceneFired(t, int cutscene)`, at the
  // End Scene marker and also when the cutscene is stopped, so a skip fires it too.
  cutsceneEndSceneFired: {
    library: "Ntve",
    id: "2C194B61",
    kind: "event",
    params: { cutscene: { id: "3957E09D" } },
  },
  // Their responses: Triggering Cutscene (798AC00C), `int EventCutsceneId()`, and Triggering Cutscene
  // Bookmark (5669CBC2), `string EventCutsceneBookmark()`. The conversation line event has no GUI function.
  eventCutsceneId: {
    library: "Ntve",
    id: "798AC00C",
    kind: "function",
    params: {},
  },
  eventCutsceneBookmark: {
    library: "Ntve",
    id: "5669CBC2",
    kind: "function",
    params: {},
  },
  // XML parameter order as an Editor-saved map saved it.
  triggerSkippableBegin: {
    library: "Ntve",
    id: "00000410",
    kind: "action",
    params: { players: { id: "00000812" }, requiredCount: { id: "00000813" }, onSkip: { id: "00000814" }, checkConditions: { id: "9D509D9F" }, wait: { id: "3E82202C" } },
  },
  // "Combine Text" and "Convert Integer To Text", for debug messages: NativeLib.TriggerLib FunctionDefs
  // 86E40471 (CombineText, an operator whose script is `(text1 + text2)`) and EAC465A1 (IntToText, native).
  combineText: {
    library: "Ntve",
    id: "86E40471",
    kind: "function",
    params: { text1: { id: "174E8B8C" }, text2: { id: "BD48D330" } },
  },
  intToText: {
    library: "Ntve",
    id: "EAC465A1",
    kind: "function",
    params: { value: { id: "D125FE97" } },
  },
  difficultyValueInt: {
    library: "Ntve",
    id: "7703744B",
    kind: "function",
    params: { casual: { id: "450AA777" }, normal: { id: "EAFE0D4F" }, hard: { id: "34D9F076" }, brutal: { id: "14E02B62" } },
    // Not native: a NativeLib helper that switches on player 1's difficulty.
  },
  // Attack waves (enemy-ai §4.1, ADR 0008); IDs from NativeLib.TriggerLib, XML order as defined there.
  point: {
    library: "Ntve",
    id: "00000022",
    kind: "function",
    params: { x: { id: "00000034" }, y: { id: "00000035" } },
  },
  unitGroupEmpty: {
    library: "Ntve",
    id: "00000104",
    kind: "function",
    params: {},
  },
  lastCreatedUnits: {
    library: "Ntve",
    id: "00000141",
    kind: "function",
    params: {},
  },
  unitGroupAddUnitGroup: {
    library: "Ntve",
    id: "A8732F20",
    kind: "action",
    params: { target: { id: "32E1F427" }, source: { id: "320F19A2" } },
  },
  unitGroupClear: {
    library: "Ntve",
    id: "00000106",
    kind: "action",
    params: { group: { id: "00000167" } },
  },
  unitIsAlive: {
    library: "Ntve",
    id: "00000216",
    kind: "function",
    params: { unit: { id: "00000378" } },
  },
  unitGroupUnit: {
    library: "Ntve",
    id: "00000213",
    kind: "function",
    params: { group: { id: "00000372" }, index: { id: "00000373" } },
  },
  unitGroupRemoveUnitGroup: {
    library: "Ntve",
    id: "EF4E46C6",
    kind: "action",
    params: { target: { id: "C119FDA8" }, source: { id: "7D302851" } },
  },
  // Wave warnings (ADR 0008); IDs from NativeLib.TriggerLib, XML order as defined there.
  unitGroupHasUnit: {
    library: "Ntve",
    id: "00000110",
    kind: "function",
    params: { group: { id: "00000175" }, unit: { id: "00000371" } },
  },
  regionSetCenter: {
    library: "Ntve",
    id: "00000034",
    kind: "action",
    params: { region: { id: "00000063" }, point: { id: "00000064" } },
  },
  regionGetCenter: {
    library: "Ntve",
    id: "00000039",
    kind: "function",
    params: { region: { id: "00000070" } },
  },
  // Explore/Unexplore Area: sets an area explored (or unexplored) for one player, so under Black
  // Mask it shows its terrain under fog. XML parameter order as Devil's Playground saved it
  // ("Mineral Node Reveal"); Do Not check cliff level, as Blizzard's maps call it.
  exploreArea: {
    library: "Ntve",
    id: "D463A836",
    kind: "action",
    params: { player: { id: "43734BD9" }, state: { id: "CC757781" }, cliffLevel: { id: "85DE9A69" }, area: { id: "ACB6148E" } },
  },
  minimapPing: {
    library: "Ntve",
    id: "00000199",
    kind: "action",
    params: { players: { id: "00000338" }, point: { id: "00000339" }, duration: { id: "00000340" }, color: { id: "00000341" } },
  },
  color: {
    library: "Ntve",
    id: "00000189",
    kind: "function",
    params: { r: { id: "00000318" }, g: { id: "00000319" }, b: { id: "00000320" } },
  },
  unitGroupCount: {
    library: "Ntve",
    id: "83B4BF45",
    kind: "function",
    params: { group: { id: "62D9DA63" }, type: { id: "4A5B3C88" } },
  },
  attackWaveUseGroup: {
    library: "Ntve",
    id: "D16912F9",
    kind: "action",
    params: { player: { id: "982396A7" }, group: { id: "E72BEF37" } },
  },
  attackWaveSetTargetPoint: {
    library: "Ntve",
    id: "12E81501",
    kind: "action",
    params: { player: { id: "D5F3A1D1" }, point: { id: "B55CF069" } },
  },
  attackWaveAddWaypoint: {
    library: "Ntve",
    id: "17E6D92B",
    kind: "action",
    params: { player: { id: "AB268797" }, waypoint: { id: "EC5281C7" }, useTransport: { id: "97A85CF7" } },
  },
  attackWaveSend: {
    library: "Ntve",
    id: "3A0403D0",
    kind: "action",
    params: { player: { id: "1B20A0F2" }, time: { id: "84463647" }, wait: { id: "CA9FBBA2" } },
  },
  attackWaveCancel: {
    library: "Ntve",
    id: "232935FA",
    kind: "action",
    params: { wave: { id: "415ACE83" } },
  },
  unitWave: {
    library: "Ntve",
    id: "869F0576",
    kind: "function",
    params: { unit: { id: "BC0C26D6" } },
  },
  // Kept triggers (ADR-0010): what a Kept map's stealth triggers and functions call,
  // each checked against that map's Editor-saved pair as the presets above. XML parameter order
  // as that map saved it; the Galaxy argument order is the native's. Unit Behavior Changes, which
  // they call too, is core's (below); Unit Type is its Campaign Pack's, and a tune reads it
  // from the Workspace's Mechanics.
  /** Switch: its cases are nested calls (see kept-trigger-galaxy's SWITCH). */
  switch: {
    library: "Ntve",
    id: "91C49196",
    kind: "action",
    block: "switch",
    params: { value: { id: "B4ACF12A" } },
  },
  randomInt: {
    library: "Ntve",
    id: "00000195",
    kind: "function",
    params: { min: { id: "00000329" }, max: { id: "00000330" } },
  },
  makeUnitUncommandable: {
    library: "Ntve",
    id: "02FA0FB6",
    kind: "action",
    params: { onOff: { id: "E7AB2B09" }, unit: { id: "EB71E50D" } },
  },
  soundtrackPlay: {
    library: "Ntve",
    id: "9D67F076",
    kind: "action",
    params: { players: { id: "99C871DC" }, category: { id: "746C8214" }, cue: { id: "80BB0A30" }, index: { id: "1F8453CB" }, makeDefault: { id: "C8B09C9F" }, soundtrack: { id: "5C6B9619" } },
  },
  // "Pause/Unpause Soundtrack": NativeLib.TriggerLib FunctionDef 5A41C578 (SoundtrackPause). Its
  // pause is a Pause/Unpause Option (00000041) and its fade a Sound Fade Option (00000040).
  soundtrackPause: {
    library: "Ntve",
    id: "5A41C578",
    kind: "action",
    params: { players: { id: "D8FB401E" }, category: { id: "5C535873" }, pause: { id: "037D41D7" }, fade: { id: "A8B8E0D2" } },
  },
  // A trigger scene's music (RECIPES.md "Music"): NativeLib.TriggerLib FunctionDefs 3B8D5BC4 (Set All
  // Sound Channel Volumes, libNtve_gf_SetAllSoundChannelVolumes(mode, players, duration)), C9ADFB21
  // (SoundLastPlayed()), 00000183 (SoundStop(sound, fade)) and 00000184 (SoundSetVolume(sound, volume)),
  // with their params in the library's order.
  setAllSoundChannelVolumes: {
    library: "Ntve",
    id: "3B8D5BC4",
    kind: "action",
    params: { mode: { id: "2DB649FD" }, players: { id: "0C4A907C" }, duration: { id: "D9CE6A0A" } },
  },
  soundLastPlayed: {
    library: "Ntve",
    id: "C9ADFB21",
    kind: "function",
    params: {},
  },
  soundStop: {
    library: "Ntve",
    id: "00000183",
    kind: "action",
    params: { sound: { id: "00000306" }, fade: { id: "00000315" } },
  },
  soundSetVolume: {
    library: "Ntve",
    id: "00000184",
    kind: "action",
    params: { sound: { id: "00000307" }, volume: { id: "00000308" } },
  },
  cameraApplyInfo: {
    library: "Ntve",
    id: "A1037B3E",
    kind: "action",
    params: { player: { id: "4E42AE87" }, camera: { id: "A3AC0C95" }, duration: { id: "6AD9514E" }, velocity: { id: "3820EC45" }, deceleration: { id: "4212D4DD" }, useTarget: { id: "6FAB3927" } },
  },
  // Pan Camera: NativeLib.TriggerLib FunctionDef DC635AEF, native `CameraPan(int player, point p,
  // fixed duration, fixed initialVelocity, fixed decelerate, bool smart)`; its smart is a Do/Do Not
  // Option (00000022). A trigger scene's camera aimed at a unit pans there.
  cameraPan: {
    library: "Ntve",
    id: "DC635AEF",
    kind: "action",
    params: { player: { id: "171CA5E8" }, point: { id: "1E118562" }, duration: { id: "92625A62" }, velocity: { id: "E863F6C2" }, deceleration: { id: "A91C853D" }, smart: { id: "AB07BE98" } },
  },
  // A trigger scene's camera and lines (RECIPES.md "Trigger scene"): NativeLib.TriggerLib FunctionDefs
  // 503F3DE6 (CameraSave), 9A0D729F (CameraRestore) and 74A20203 (TransmissionClearAll), whose
  // natives are `CameraSave(int player)`, `CameraRestore(int player, fixed duration, fixed velocity,
  // fixed decelerate)` and `TransmissionClearAll()`.
  cameraSave: {
    library: "Ntve",
    id: "503F3DE6",
    kind: "action",
    params: { player: { id: "CB75DBB2" } },
  },
  cameraRestore: {
    library: "Ntve",
    id: "9A0D729F",
    kind: "action",
    params: { player: { id: "D9FBB8EA" }, duration: { id: "48E078F7" }, velocity: { id: "743345B6" }, deceleration: { id: "D66C267B" } },
  },
  transmissionClearAll: {
    library: "Ntve",
    id: "74A20203",
    kind: "action",
    params: {},
  },
  // A scene's Transmissions queued behind one already playing: FunctionDefs 95E0136A
  // (TransmissionWait, whose Transmission defaults to the last sent) and FDD4A4BA
  // (TransmissionLastSent), natives `TransmissionWait(transmissionid, fixed offset)` and
  // `TransmissionLastSent()`.
  transmissionWait: {
    library: "Ntve",
    id: "95E0136A",
    kind: "action",
    params: { transmission: { id: "C20A2419" }, offset: { id: "7E048C98" } },
  },
  // Wait For Condition (E89F1335): `while (!(cond)) { Wait(t, timeType); }`, its conditions in sub-function C1E1D597.
  waitForCondition: {
    library: "Ntve",
    id: "E89F1335",
    kind: "action",
    params: { time: { id: "9C4402E6" }, timeType: { id: "353DD7DE" } },
    block: "waitForCondition",
  },
  transmissionLastSent: {
    library: "Ntve",
    id: "FDD4A4BA",
    kind: "function",
    params: {},
  },
  // One Transmission cut off, and whether one has ended (or been cut off), for a trigger scene that
  // cuts only the in-play line playing (transmission-hold.ts): FunctionDefs F14A27E9
  // (TransmissionClear) and C752E622 (TransmissionIsComplete), natives `TransmissionClear(int t)`
  // and `bool TransmissionIsComplete(int t)`.
  transmissionClear: {
    library: "Ntve",
    id: "F14A27E9",
    kind: "action",
    params: { transmission: { id: "4A02BF9D" } },
  },
  transmissionIsComplete: {
    library: "Ntve",
    id: "C752E622",
    kind: "function",
    params: { transmission: { id: "D4C36CA0" } },
  },
  // Stop All Instances Of Trigger (698FE891), native `TriggerStop(trigger t)`: a trigger scene played
  // again stops its earlier run's lines after the handback, which it plays afresh.
  triggerStop: {
    library: "Ntve",
    id: "698FE891",
    kind: "action",
    params: { trigger: { id: "13A87DA8" } },
  },
  // While (71596144): `while (conditions) { actions }`, its conditions in sub-function 20298AEC and
  // its actions in A1B37466. An in-play line cut off by a trigger scene plays again in one.
  whileLoop: {
    library: "Ntve",
    id: "71596144",
    kind: "action",
    params: {},
    block: "while",
  },
  cinematicFade: {
    library: "Ntve",
    id: "D8A9F49F",
    kind: "action",
    params: { direction: { id: "672FA3A3" }, duration: { id: "40A35254" }, style: { id: "BA72E931" }, color: { id: "5872348A" }, transparency: { id: "16DD371C" }, wait: { id: "D61CE1DE" } },
  },
  // A cutscene's own fade layer (its Fade elements draw on it), apart from Cinematic Fade's: a
  // cutscene played in the world leaves its closing fade here after it stops. Editor-made cutscenes fade it at 100.
  cutsceneFade: {
    library: "Ntve",
    id: "D27035F2",
    kind: "action",
    params: { direction: { id: "744B212F" }, duration: { id: "6F53CC4E" }, color: { id: "47FF6F8D" }, amount: { id: "CDDC9BD6" }, players: { id: "9418177D" }, wait: { id: "934AE781" } },
  },
  cameraLockInput: {
    library: "Ntve",
    id: "00000326",
    kind: "action",
    params: { player: { id: "00000615" }, lock: { id: "00000616" } },
  },
  unitKill: {
    library: "Ntve",
    id: "00000077",
    kind: "action",
    params: { unit: { id: "00000136" } },
  },
  // UnitRemove, FunctionDef and ParamDef ids from NativeLib.TriggerLib (Remove Unit).
  unitRemove: {
    library: "Ntve",
    id: "00000078",
    kind: "action",
    params: { unit: { id: "00000137" } },
  },
  // UnitSetPosition (Set Unit Position) and its blend preset (Enable_Disable_Option2), FunctionDef,
  // ParamDef and PresetValue ids from NativeLib.TriggerLib, parameters in definition order.
  unitSetPosition: {
    library: "Ntve",
    id: "0E8A5B30",
    kind: "action",
    params: { unit: { id: "211C5A4E" }, point: { id: "59E6F35F" }, blend: { id: "B6EF4B7A" } },
  },
  // Attach Model To Unit, Kill Model and Last Created Actor (the warp effect Blizzard's campaign
  // triggers attach to a unit warping in or out), Point With Polar Offset and Set Unit Progress:
  // FunctionDef and ParamDef ids from NativeLib.TriggerLib, parameters in definition order.
  attachModelToUnit: {
    library: "Ntve",
    id: "3A43F8C8",
    kind: "action",
    params: { unit: { id: "C4351809" }, model: { id: "CF67EF6E" }, attachPoint: { id: "D59928C5" } },
  },
  killModel: {
    library: "Ntve",
    id: "04454841",
    kind: "action",
    params: { model: { id: "392026CE" } },
  },
  actorLastCreated: {
    library: "Ntve",
    id: "0F696993",
    kind: "function",
    params: {},
  },
  pointWithOffsetPolar: {
    library: "Ntve",
    id: "00000241",
    kind: "function",
    params: { point: { id: "00000416" }, distance: { id: "00000417" }, angle: { id: "00000418" } },
  },
  unitSetProgressComplete: {
    library: "Ntve",
    id: "25FDDB2A",
    kind: "action",
    params: { unit: { id: "4EED99E0" }, slot: { id: "44545BCD" }, percent: { id: "E7F1F6D7" } },
  },
  // Send Actor Message To Unit: FunctionDef and ParamDef ids from NativeLib.TriggerLib, parameters in definition order.
  sendActorMessageToUnit: {
    library: "Ntve",
    id: "E1552C18",
    kind: "action",
    params: { unit: { id: "5A8D5B9F" }, message: { id: "8FF77F87" } },
  },
  unitEntersRangeOfPoint: {
    library: "Ntve",
    id: "E267A52A",
    kind: "event",
    params: { unit: { id: "C4A782E5", unitRef: true }, range: { id: "A468FD92" }, enters: { id: "A4C004B2" }, point: { id: "540DD7E3" } },
  },
  // Cues on a unit nearing another, a unit type dying and an encounter's end (#420); ids from
  // NativeLib.TriggerLib. Unit Enters Range Of Unit (E54B2D20): `TriggerAddEventUnitRange(t,
  // unitref u, unit fromUnit, fixed range, bool state)`, firing as `u` comes within range of
  // `fromUnit`; Triggering Unit is the one that came.
  unitEntersRangeOfUnit: {
    library: "Ntve",
    id: "E54B2D20",
    kind: "event",
    params: { unit: { id: "9B87B175", unitRef: true }, fromUnit: { id: "A30297E7" }, range: { id: "574074BD" }, state: { id: "46641A49" } },
  },
  // Unit Takes Damage (5C010D48): `TriggerAddEventUnitDamaged(t, unitref u, int damageType, int damageFatal, string effect)`.
  unitTakesDamage: {
    library: "Ntve",
    id: "5C010D48",
    kind: "event",
    params: { unit: { id: "4421C93A", unitRef: true }, damageType: { id: "1B5BFFA8" }, fatal: { id: "68EEADB6" }, effect: { id: "3F9C41F8" } },
  },
  // Unit Behavior Changes (3C0566C4): `TriggerAddEventUnitBehaviorChange(t, unitref u, string behavior,
  // int change)`: an encounter's Behavior end (#431), and a Campaign Pack's capture Mechanic's lockdown events.
  unitBehaviorChanges: {
    library: "Ntve",
    id: "3C0566C4",
    kind: "event",
    params: { unit: { id: "F3A8B0DC", unitRef: true }, behavior: { id: "1CDCC284" }, change: { id: "3029CA3C" } },
  },
  // Player Uses Effect (9FFA06A7): `TriggerAddEventPlayerEffectUsed(t, int player, string effect)`, a
  // player's effect starting (an effectStarts cue, #488), and its response Triggering Effect Unit
  // (BADA9C08), `unit EventPlayerEffectUsedUnit(int location)`, one of the effect's units by its
  // EffectUnit preset (BF3150F6). Read off NativeLib.TriggerLib; Blizzard's campaign libraries call
  // both (VoidCampaignMissionLib, NovaCampaignMissionLib).
  playerEffectUsed: {
    library: "Ntve",
    id: "9FFA06A7",
    kind: "event",
    params: { player: { id: "44A8E2B6" }, effect: { id: "6FB1C942" } },
  },
  effectUsedUnit: {
    library: "Ntve",
    id: "BADA9C08",
    kind: "function",
    params: { location: { id: "F6C0132E" } },
  },
  // Triggering Damage Amount (00000098), Unit Takes Damage's response.
  damageAmount: {
    library: "Ntve",
    id: "00000098",
    kind: "function",
    params: {},
  },
  // Unit Type Of Unit (00000079).
  unitTypeOf: {
    library: "Ntve",
    id: "00000079",
    kind: "function",
    params: { unit: { id: "00000138" } },
  },
  // Arithmetic (Integer) (00000128), an operator.
  arithmeticInt: {
    library: "Ntve",
    id: "00000128",
    kind: "function",
    params: { left: { id: "00000205" }, operator: { id: "00000206" }, right: { id: "00000207" } },
  },
  unitPauseAll: {
    library: "Ntve",
    id: "00000388",
    kind: "action",
    params: { pause: { id: "00000771" } },
  },
  unitWaitUntilIdle: {
    library: "Ntve",
    id: "31D7ABB2",
    kind: "action",
    params: { unit: { id: "96B3BE52" }, waitForOrders: { id: "85C5DDCE" } },
  },
  orderNoTarget: {
    library: "Ntve",
    id: "59BA1DDF",
    kind: "function",
    params: { abilityCommand: { id: "C2F687E6" } },
  },
  unitSetTeamColor: {
    library: "Ntve",
    id: "8A467CA8",
    kind: "action",
    params: { unit: { id: "C914703B" }, color: { id: "595B7087" } },
  },
  cameraFollowUnitGroup: {
    library: "Ntve",
    id: "B34FAB70",
    kind: "action",
    params: { player: { id: "C6DCD584" }, group: { id: "B27243D0" }, follow: { id: "C88AE748" }, clearOffset: { id: "77D427E3" } },
  },
  /** Text from a string key, such as a unit's name ("Unit/Name/<type>"). */
  stringExternal: {
    library: "Ntve",
    id: "BC53F705",
    kind: "function",
    params: { key: { id: "B1308F64" } },
  },
  unitSelect: {
    library: "Ntve",
    id: "00000175",
    kind: "action",
    params: { unit: { id: "00000289" }, player: { id: "00000290" }, select: { id: "00000291" } },
  },
  // Set Camera Bounds: NativeLib.TriggerLib FunctionDef F470860B, native `CameraSetBounds(playergroup
  // players, region bounds, bool minimap)`; its minimap is a Do/Do Not Option (00000022), Do by
  // default, which shrinks the minimap to the bounds. The bounds can't reach past the playable map.
  cameraSetBounds: {
    library: "Ntve",
    id: "F470860B",
    kind: "action",
    params: { players: { id: "3FA8845D" }, region: { id: "A8B2F758" }, minimap: { id: "B29D7650" } },
  },
  // Set Playable Map Area: FunctionDef 9AD8B4CA, native `RegionPlayableMapSet(region r)`. It confines
  // units to the region, rounded to even cells, and moves the camera bounds with it.
  regionPlayableMapSet: {
    library: "Ntve",
    id: "9AD8B4CA",
    kind: "action",
    params: { region: { id: "31FFB516" } },
  },
  /** Playable Map Area (46F2D5B8): the playable area as it stands, MapInfo's or the last Set Playable Map Area's. */
  regionPlayableMap: {
    library: "Ntve",
    id: "46F2D5B8",
    kind: "function",
    params: {},
  },
  distanceBetweenPoints: {
    library: "Ntve",
    id: "00000027",
    kind: "function",
    params: { from: { id: "00000043" }, to: { id: "00000044" } },
  },
  regionCircle: {
    library: "Ntve",
    id: "00000030",
    kind: "function",
    params: { center: { id: "00000049" }, radius: { id: "00000050" } },
  },
  unitSetFacing: {
    library: "Ntve",
    id: "00000086",
    kind: "action",
    params: { unit: { id: "00000148" }, facing: { id: "00000149" }, duration: { id: "00000150" } },
  },
  makeUnitFacePoint: {
    library: "Ntve",
    id: "D5445D96",
    kind: "action",
    params: { unit: { id: "B73F60EB" }, point: { id: "1980D31F" }, duration: { id: "B4EE9B9C" } },
  },
  pointSet: {
    library: "Ntve",
    id: "DBF8E9E3",
    kind: "action",
    params: { source: { id: "0F1200ED" }, point: { id: "1A8752D4" } },
  },
  pointFacing: {
    library: "Ntve",
    id: "DB4E6196",
    kind: "function",
    params: { point: { id: "1B0F7099" } },
  },
  unitToUnitGroup: {
    library: "Ntve",
    id: "BAEAC6C3",
    kind: "function",
    params: { unit: { id: "E208E60F" } },
  },
  setOpacity: {
    library: "Ntve",
    id: "B6218C18",
    kind: "function",
    params: { opacity: { id: "64920830" }, duration: { id: "05A29E71" } },
  },
} as const satisfies Record<string, FunctionDef>;

export const VCMI_PRESETS = {
  portraitHideAfter: preset("70E9980F", "libVCMI_ge_MissionTransmissionPortraitOptioins_HidePortraitAfter", "value", "VCMI"),
  cueSoundDefault: preset("9546E5C7", "libVCMI_ge_MissionTransmissionCueSoundOptions_DefaultCueSoundBehavior", "value", "VCMI"),
} as const;

export const VCMI_FUNCTIONS = {
  // "Send Transmission (Campaign)" placeholder: prefixes every message with "[PH] ",
  // so generated missions use NTVE_FUNCTIONS.sendTransmission instead.
  sendTransmission: {
    library: "VCMI",
    id: "3F2DAB19",
    kind: "action",
    params: {
      unit: { id: "03ABF7AC" },
      model: { id: "CE684310" },
      speaker: { id: "5C104DDF" },
      wait: { id: "EEE981E5" },
      portraitOption: { id: "6DDE3708" },
      cueSound: { id: "B3DCA522" },
      message: { id: "9245BAC9" },
      duration: { id: "8E082B89" },
    },
    galaxy: (args) =>
      `libVCMI_gf_SendTransmissionCampaignPlaceHolder(${args.unit}, ${args.model}, ${args.speaker}, ${args.message}, ${args.duration}, ${args.wait}, ${args.portraitOption}, ${args.cueSound})`,
  },
  // Kept triggers (ADR-0010), from the same Kept map as above.
  sendActorMessageToDoodadsInRegion: {
    library: "VCMI",
    id: "CA780963",
    kind: "action",
    params: { message: { id: "7DB2FD24" }, doodadType: { id: "45F5927D" }, region: { id: "4437427F" } },
    galaxy: (args) => `libVCMI_gf_SendActorMessageToDoodadsInRegion(${args.message}, ${args.doodadType}, ${args.region})`,
  },
} as const satisfies Record<string, FunctionDef>;

/** A primitive's Editor identity, `<library>/<id>`: a Plugin built against another copy of core still names core's primitives by it. */
export const primitiveKey = (def: { readonly library: TriggerLibrary; readonly id: string }): string => `${def.library}/${def.id}`;

const byKey = <Def extends { readonly library: TriggerLibrary; readonly id: string }>(defs: readonly Def[]): ReadonlyMap<string, Def> =>
  new Map(defs.map((def) => [primitiveKey(def), def]));

/** Every primitive core provides, by `primitiveKey`; a Plugin Mechanic's triggers may use these and its own `primitives`. */
export const CORE_PRIMITIVES: {
  readonly functions: ReadonlyMap<string, FunctionDef>;
  readonly presets: ReadonlyMap<string, PresetDef>;
  readonly subFunctions: ReadonlyMap<string, SubFunctionDef>;
} = {
  functions: byKey([...Object.values(NTVE_FUNCTIONS), ...Object.values(VCMI_FUNCTIONS)]),
  presets: byKey([...Object.values(NTVE_PRESETS), ...Object.values(VCMI_PRESETS)]),
  subFunctions: byKey(Object.values(SUB_FUNCTIONS)),
};

/**
 * Whether two primitives with one `primitiveKey` are the same primitive: the same kind, form and
 * parameters (ids in order), so a Plugin built against another copy of core matches, and one that
 * redefines a primitive under its id doesn't.
 */
export function samePrimitive(a: FunctionDef | PresetDef | SubFunctionDef, b: FunctionDef | PresetDef | SubFunctionDef): boolean {
  if (a === b) return true;
  const shape = (def: FunctionDef | PresetDef | SubFunctionDef): string =>
    JSON.stringify({
      key: primitiveKey(def),
      kind: "kind" in def ? def.kind : undefined,
      block: "block" in def ? def.block : undefined,
      params: "params" in def ? Object.entries(def.params).map(([name, param]) => [name, param.id, param.unitRef ?? false]) : undefined,
      galaxy: "form" in def ? [def.galaxy, def.form] : undefined,
    });
  return shape(a) === shape(b);
}
