// A Cinematic played from its scene's cue, in place of the scene's Transmissions, as LotV plays its
// cinematics (cinematography RECIPES.md "Cinematic"; libVoiC_gf_CampaignPlayCutscene2): in a
// full-screen dialog drawn above the world, under Cinematic Mode at full screen (not LotV's Story
// Mode, which only Blizzard's maps may call). All of it is NativeLib's GUI actions (ADR 0002); none
// needs custom Galaxy.

import { blackFade, block, call, callValue, ifTriggerOn, pickedUnit, runTrigger, sceneTitle as title, stableElementId, triggerVariable } from "./trigger-builders.js";
import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P, SUB_FUNCTIONS } from "./trigger-catalog.js";
import type { Trigger, TriggerCall, TriggerParam, TriggerRef, TriggerVariable } from "./trigger-model.js";

/** What a Mission's Cinematic adds to its triggers, and the action its cues run. */
export type CinematicPlayback = {
  readonly triggers: readonly Trigger[];
  readonly variables: readonly TriggerVariable[];
  /** Runs the Cinematic and waits for its cleanup, so the scenes cued after it play after it. */
  readonly run: (path: string) => TriggerCall;
  /**
   * For a mission trigger that hides or pauses `unit` itself while the Cinematic may be playing, run
   * after it: the unit leaves the group the cleanup puts back, so the cleanup leaves that state as
   * the mission set it. No engine event reports a hide or a pause, so the cleanup can't tell one apart
   * from its own otherwise.
   */
  readonly leave: (path: string, unit: TriggerParam["value"], state: "hidden" | "paused") => TriggerCall;
  /**
   * For a Cinematic chained into a trigger scene on a cue (built with `handsOn`), run before `run`:
   * this run's cleanup leaves the screen black, Cinematic Mode on and the Music soundtrack paused,
   * for the trigger scene's handback to put back (ADR 0012).
   */
  readonly handOn?: (path: string) => TriggerCall;
  /** Built with `handsOn`: true once a run is watched to its end, false after a skip, which the trigger scene after it shares. */
  readonly completed?: TriggerVariable;
};

/**
 * "Cinematic <Id>" plays the Map Package's Cutscenes\<id>.SC2Cutscene: it saves whether AI time was
 * paused and pauses it (waves wait; Cinematic Mode alone doesn't pause it), pauses the map's Music
 * and Ambience soundtracks with a fade (libVoiC_gf_PlayCinematic's), turns Cinematic Mode on
 * at full screen, hides the map's environment (unless it's shown, for a Cinematic on the map's own ground), pauses and hides its units (keeping the ones it changed), turns on
 * "Cinematic <Id> Spawns", which does the same to each unit created while it plays, and plays the cutscene in a full-screen HDR dialog. "Cinematic <Id> Watch"
 * holds only the skippable wait, so Escape ends that trigger and nothing else (cutscene §3.2). Then
 * one cleanup runs, skipped or watched to the end: stop the cutscene, turn Spawns off, unpause AI time unless it was
 * paused already, show the environment again, unpause and show the units it changed, set the mission Light back (cutscene §6 item 0), destroy the dialog, turn
 * Cinematic Mode off, and unpause the Ambience and Music soundtracks with a fade.
 */
export function cinematicPlayback(
  id: string,
  missionLight: string,
  /**
   * Whether a trigger scene follows the Cinematic on some cue (ADR 0012): it then records whether
   * each run was watched to its end (`completed`, the skip they share) and can hand on to it.
   * Without it, nothing changes.
   */
  options: {
    readonly handsOn?: boolean;
    /** The Blueprint entry's `environment: "shown"`: the map's terrain, water and doodads stay showing, for a Cinematic filmed on the map's own ground. */
    readonly environmentShown?: boolean;
    /**
     * A Kept trigger is held until this Cinematic's scene has played (ADR-0014), and starts as the
     * Kept map started it, under black with Cinematic Mode on (one Kept map's stealth opening cuts to
     * black and fades itself in): every run's cleanup leaves the screen black and Cinematic Mode
     * on for it, as a run handing on to a trigger scene does.
     */
    readonly handsOnToKept?: boolean;
    /**
     * The triggers of this Cinematic's bookmark cues that fire on a skip (cue-triggers.ts,
     * bookmarksFiredOnSkip): the cleanup runs each that hasn't run, so the Mission is the same
     * whether the Cinematic was watched or skipped. A bookmark isn't heard on a skip.
     */
    readonly bookmarksOnSkip?: readonly TriggerRef[];
  } = {},
): CinematicPlayback {
  const path = `cinematics/${id}`;
  const name = `Cinematic ${title(id)}`;
  const play: TriggerRef = { id: stableElementId(path), name };
  const watch: TriggerRef = { id: stableElementId(`${path}/watch`), name: `${name} Watch` };
  const spawns: TriggerRef = { id: stableElementId(`${path}/spawns`), name: `${name} Spawns` };
  const variable = (key: string, type: TriggerVariable["type"], initial: TriggerParam["value"]): TriggerVariable =>
    triggerVariable(`${path}/variables/${key}`, `cinematic_${id}_${key}`, type, initial);
  const aiWasPaused = variable("ai_was_paused", "bool", { kind: "bool", value: false });
  const dialog = variable("dialog", "dialog", { kind: "preset", preset: P.noDialog });
  const cutscene = variable("cutscene", "cutscene", { kind: "preset", preset: P.noCutscene });
  const pausedUnits = variable("paused_units", "unitgroup", callValue(`${path}/variables/paused_units/value`, F.unitGroupEmpty, {}));
  const hiddenUnits = variable("hidden_units", "unitgroup", callValue(`${path}/variables/hidden_units/value`, F.unitGroupEmpty, {}));
  // Chained: whether this run was watched to its end, and whether it hands on to a trigger scene.
  const completed = options.handsOn ? variable("completed", "bool", { kind: "bool", value: false }) : undefined;
  const handingOn = options.handsOn ? variable("hand_on", "bool", { kind: "bool", value: false }) : undefined;

  const preset = (value: (typeof P)[keyof typeof P]): TriggerParam["value"] => ({ kind: "preset", preset: value });
  const of = (held: TriggerVariable): TriggerParam["value"] => ({ kind: "variable", variable: held });
  const players = (at: string): TriggerParam["value"] => callValue(`${at}/players`, F.allPlayers, {});
  const item = (at: string): TriggerParam["value"] => callValue(`${at}/item`, F.dialogControlLastCreated, {});
  const set = (at: string, held: TriggerVariable, value: TriggerParam["value"]): TriggerCall => call(at, F.setVariable, { variable: of(held), value });
  const pauseAI = (at: string, pause: boolean): TriggerCall => call(at, F.aiTimePause, { pause: preset(pause ? P.pause : P.unpause) });
  // On: Cinematic Mode, then a full screen to drop its letterbox bars. Off: Cinematic Mode puts the
  // console back itself. Not Story Mode, whose native only Blizzard's maps may call.
  const modes = (at: string, on: boolean): TriggerCall[] => [
    call(`${at}/cinematicMode`, F.cinematicMode, { onOff: preset(on ? P.on : P.off), players: players(`${at}/cinematicMode`), duration: { kind: "fixed", value: 0 } }),
    ...(on ? [call(`${at}/fullscreen`, F.setScreenMode, { players: players(`${at}/fullscreen`), mode: preset(P.screenModeFullscreen), duration: { kind: "fixed", value: 0 } })] : []),
  ];
  const at = (step: string): string => `${path}/${step}`;
  // The map's music and ambience would play under the Cinematic's own sound, so they're paused
  // with a fade, as Blizzard's cinematic wrappers do (libVoiC_gf_PlayCinematic), and unpaused with
  // a fade in the cleanup.
  const soundtracks = (step: string, pause: boolean): TriggerCall[] =>
    (pause ? (["music", "ambience"] as const) : (["ambience", "music"] as const)).map((category) => {
      const unpause = call(at(`${step}/${category}`), F.soundtrackPause, {
        players: players(at(`${step}/${category}`)),
        category: preset(category === "music" ? P.soundtrackCategoryMusic : P.soundtrackCategoryAmbience),
        pause: preset(pause ? P.pause : P.unpause),
        fade: preset(P.soundFade),
      });
      // Handing on, the Music stays paused for the trigger scene's handback to bring back.
      return !pause && category === "music" && handingOn ? unlessHandingOn(`${step}/${category}/unlessHandingOn`, [unpause]) : unpause;
    });
  // Calls a chained run makes only when it doesn't hand on to a trigger scene.
  function unlessHandingOn(step: string, calls: TriggerCall[]): TriggerCall {
    return block(at(step), F.ifThenElse, {}, [
      { type: SUB_FUNCTIONS.if, calls: [call(at(`${step}/if`), F.comparison, { left: of(handingOn!), operator: preset(P.compareEqual), right: { kind: "bool", value: false } })] },
      { type: SUB_FUNCTIONS.then, calls },
    ]);
  }
  // The map would show through a set's windows behind the dialog; hiding it is global, so the
  // cleanup shows it again (docs/reference/editor-and-engine.md, "Hide the map behind a Cinematic").
  const environment = (step: string, show: boolean): TriggerCall =>
    call(step, F.environmentShow, { environmentType: preset(P.environmentAll), showHide: preset(show ? P.show : P.hide) });

  // Hide Environment leaves the map's units, which show through a set's gaps (a hero floating in its
  // sky), so the map's units are paused and hidden too, as an Editor-made Campaign's start-cutscene function does: each one
  // not paused or hidden already, kept in a group so the cleanup puts back only those
  // (docs/reference/editor-and-engine.md, "Hide the map behind a Cinematic"). `unit` makes the
  // unit's value at a path: Picked Unit in the opening sweep, Created Unit in Spawns.
  type UnitAt = (path: string) => TriggerParam["value"];
  const unless = (step: string, unit: UnitAt, test: TriggerCall["def"], group: TriggerVariable, change: TriggerCall): TriggerCall =>
    block(at(step), F.ifThenElse, {}, [
      { type: SUB_FUNCTIONS.if, calls: [call(at(`${step}/if`), F.comparison, { left: callValue(at(`${step}/if/test`), test, { unit: unit(at(`${step}/if/test/unit`)) }), operator: preset(P.compareEqual), right: { kind: "bool", value: false } })] },
      { type: SUB_FUNCTIONS.then, calls: [call(at(`${step}/add`), F.unitGroupAdd, { group: of(group), unit: unit(at(`${step}/add/unit`)) }), change] },
    ]);
  const pauseAndHide = (step: string, unit: UnitAt): TriggerCall[] => [
    unless(`${step}/pause`, unit, F.unitIsPaused, pausedUnits, call(at(`${step}/pause/unit`), F.pauseUnit, { unit: unit(at(`${step}/pause/unit/unit`)), pause: preset(P.pause) })),
    unless(`${step}/hide`, unit, F.unitIsHidden, hiddenUnits, call(at(`${step}/hide/unit`), F.showHideUnit, { unit: unit(at(`${step}/hide/unit/unit`)), showHide: preset(P.hide) })),
  ];
  const createdUnit: UnitAt = (unitPath) => callValue(unitPath, F.createdUnit, {});
  const enableSpawns = (step: string, on: boolean): TriggerCall =>
    call(at(step), F.triggerEnable, { trigger: { kind: "trigger", trigger: spawns }, state: preset(on ? P.triggerOn : P.triggerOff) });
  const units = (step: string, hide: boolean): TriggerCall[] =>
    hide
      ? [
          block(at(`${step}/each`), F.pickEachUnitInGroup, {
            group: callValue(at(`${step}/each/group`), F.unitsInRegionMatching, {
              unitType: preset(P.anyUnitType),
              player: preset(P.anyPlayer),
              region: callValue(at(`${step}/each/group/region`), F.entireMap, {}),
              filter: { kind: "unitfilter", require: [], exclude: ["Dead"] },
              count: preset(P.anyAmount),
            }),
          }, [{ type: SUB_FUNCTIONS.pickEachActions, calls: pauseAndHide(step, pickedUnit) }]),
          // From here to the cleanup, a unit created (a spawn, a wave) is paused and hidden too.
          enableSpawns(`${step}/spawns`, true),
        ]
      : [
          enableSpawns(`${step}/spawns`, false),
          block(at(`${step}/unpause`), F.pickEachUnitInGroup, { group: of(pausedUnits) }, [
            { type: SUB_FUNCTIONS.pickEachActions, calls: [call(at(`${step}/unpause/unit`), F.pauseUnit, { unit: pickedUnit(at(`${step}/unpause/unit/unit`)), pause: preset(P.unpause) })] },
          ]),
          block(at(`${step}/show`), F.pickEachUnitInGroup, { group: of(hiddenUnits) }, [
            { type: SUB_FUNCTIONS.pickEachActions, calls: [call(at(`${step}/show/unit`), F.showHideUnit, { unit: pickedUnit(at(`${step}/show/unit/unit`)), showHide: preset(P.show) })] },
          ]),
          // Emptied once put back, not at the start: a run that starts before another's cleanup then
          // adds to the groups instead of wiping what the first one changed.
          call(at(`${step}/clearPaused`), F.unitGroupClear, { group: of(pausedUnits) }),
          call(at(`${step}/clearHidden`), F.unitGroupClear, { group: of(hiddenUnits) }),
        ];

  const playTrigger: Trigger = {
    ...play,
    events: [],
    actions: [
      set(at("aiWasPaused"), aiWasPaused, callValue(at("aiWasPaused/value"), F.aiTimeIsPaused, {})),
      pauseAI(at("pauseAI"), true),
      ...soundtracks("soundtracks/pause", true),
      ...modes(at("on"), true),
      ...(options.environmentShown ? [] : [environment(at("environment/hide"), false)]),
      ...units("units", true),
      ...(options.environmentShown
        ? [
            // On the map's own ground, it plays in the world at Point(64, 64), where its coordinates
            // meet the terrain as they did in the Cutscene Editor; a dialog draws the world elsewhere.
            call(at("cutscene/create"), F.cutsceneCreateNew, {
              path: { kind: "filepath", value: `Cutscenes\\${id}.SC2Cutscene`, asset: "cutscene" },
              pos: callValue(at("cutscene/create/pos"), F.point, { x: { kind: "fixed", value: 64 }, y: { kind: "fixed", value: 64 } }),
              facing: { kind: "fixed", value: 0 },
              players: players(at("cutscene/create")),
              autoPlay: { kind: "bool", value: false },
            }),
            set(at("cutscene/store"), cutscene, callValue(at("cutscene/store/value"), F.cutsceneLastCreated, {})),
          ]
        : [
          call(at("dialog"), F.dialogCreate, {
            width: { kind: "int", value: 500 },
            height: { kind: "int", value: 400 },
            anchor: preset(P.anchorCenter),
            offsetX: { kind: "int", value: 0 },
            offsetY: { kind: "int", value: 0 },
            modal: preset(P.modal),
          }),
          set(at("dialog/store"), dialog, callValue(at("dialog/store/value"), F.dialogLastCreated, {})),
          call(at("dialog/fullscreen"), F.dialogSetFullscreen, { dialog: of(dialog), fullscreen: { kind: "bool", value: true } }),
          call(at("dialog/image"), F.dialogSetImageVisible, { dialog: of(dialog), visible: preset(P.hide) }),
          call(at("dialog/visible"), F.dialogSetVisible, { dialog: of(dialog), players: players(at("dialog/visible")), visible: preset(P.show) }),
          call(at("control"), F.dialogControlCreate, { dialog: of(dialog), type: preset(P.controlTypeCutscene) }),
          call(at("control/full"), F.dialogControlSetFullDialog, { dialogItem: item(at("control/full")), players: players(at("control/full")), sizeToParent: { kind: "bool", value: true } }),
          call(at("control/cutscene"), F.setDialogItemCutscene, {
            dialogItem: item(at("control/cutscene")),
            cutscene: { kind: "filepath", value: `Cutscenes\\${id}.SC2Cutscene`, asset: "cutscene" },
            players: players(at("control/cutscene")),
          }),
          call(at("control/render"), F.setDialogItemRenderType, { dialogItem: item(at("control/render")), renderType: preset(P.renderTypeHDR), players: players(at("control/render")) }),
          set(at("cutscene/store"), cutscene, callValue(at("cutscene/store/value"), F.cutsceneOfDialogItem, { dialogItem: item(at("cutscene/store/value")) })),
          ]),
      call(at("cutscene/play"), F.cutscenePlay, { cutscene: of(cutscene) }),
      ...(completed ? [set(at("completed/reset"), completed, { kind: "bool", value: false })] : []),
      call(at("runWatch"), F.triggerExecute, { checkConditions: preset(P.checkConditions), wait: preset(P.wait), trigger: { kind: "trigger", trigger: watch } }),
      // The one cleanup, skipped or not.
      call(at("cleanup/stop"), F.cutsceneStop, { cutscene: of(cutscene) }),
      block(at("cleanup/ai"), F.ifThenElse, {}, [
        { type: SUB_FUNCTIONS.if, calls: [call(at("cleanup/ai/if"), F.comparison, { left: of(aiWasPaused), operator: preset(P.compareEqual), right: { kind: "bool", value: false } })] },
        { type: SUB_FUNCTIONS.then, calls: [pauseAI(at("cleanup/ai/unpause"), false)] },
      ]),
      ...(options.environmentShown ? [] : [environment(at("cleanup/environment"), true)]),
      ...units("cleanup/units", false),
      call(at("cleanup/light"), F.setLighting, { blendTime: { kind: "fixed", value: 0 }, light: { kind: "gamelink", gameType: "Light", value: missionLight } }),
      // In the world, the cutscene's closing fade stays on its own fade layer after it stops, which
      // a following Cinematic Fade can't lift: swap it for a Cinematic Fade black, then clear it.
      ...(options.environmentShown
        ? [
            blackFade(at("cleanup/inWorld/black"), false, 0, false),
            call(at("cleanup/inWorld/clear"), F.cutsceneFade, {
              direction: preset(P.fadeIn),
              duration: { kind: "fixed", value: 0 },
              color: { kind: "color", value: "255,0,0,0" },
              amount: { kind: "fixed", value: 100 },
              players: players(at("cleanup/inWorld/clear")),
              wait: preset(P.dontWait),
            }),
          ]
        : []),
      // Handing on to a held Kept trigger, the screen stays black for it as it starts.
      ...(options.handsOnToKept && !options.environmentShown ? [blackFade(at("cleanup/kept/black"), false, 0, true)] : []),
      // Handing on, the world stays black under the dialog as it goes, for the trigger scene's setup.
      ...(handingOn
        ? [
            block(at("cleanup/black"), F.ifThenElse, {}, [
              { type: SUB_FUNCTIONS.if, calls: [call(at("cleanup/black/if"), F.comparison, { left: of(handingOn), operator: preset(P.compareEqual), right: { kind: "bool", value: true } })] },
              {
                type: SUB_FUNCTIONS.then,
                calls: [blackFade(at("cleanup/black/fade"), false, 0, true)],
              },
            ]),
          ]
        : []),
      ...(options.environmentShown ? [] : [call(at("cleanup/dialog"), F.dialogDestroy, { dialog: of(dialog) })]),
      // Back from the in-world black, unless something after it starts under black.
      ...(options.environmentShown && !options.handsOnToKept
        ? handingOn
          ? [unlessHandingOn("cleanup/inWorld/fadeIn/unlessHandingOn", [blackFade(at("cleanup/inWorld/fadeIn"), true, 1000, false)])]
          : [blackFade(at("cleanup/inWorld/fadeIn"), true, 1000, false)]
        : []),
      ...(options.handsOnToKept ? [] : handingOn ? [unlessHandingOn("off/unlessHandingOn", modes(at("off"), false))] : modes(at("off"), false)),
      ...soundtracks("cleanup/soundtracks", false),
      ...(handingOn ? [set(at("cleanup/handOn"), handingOn, { kind: "bool", value: false })] : []),
      // Last, with the world and the screen put back: each bookmark cue the skip passed over, once.
      ...(options.bookmarksOnSkip ?? []).map((bookmark, index) =>
        ifTriggerOn(at(`cleanup/bookmarks/${index}`), bookmark, [runTrigger(at(`cleanup/bookmarks/${index}/run`), bookmark, { wait: true, checkConditions: false })]),
      ),
    ],
  };
  const watchTrigger: Trigger = {
    ...watch,
    events: [],
    actions: [
      call(at("watch/skippable"), F.triggerSkippableBegin, {
        players: players(at("watch/skippable")),
        requiredCount: preset(P.skipAllPlayers),
        onSkip: preset(P.noTrigger),
        checkConditions: preset(P.checkConditions),
        wait: preset(P.dontWait),
      }),
      call(at("watch/wait"), F.waitForCutsceneToEnd, { cutscene: of(cutscene) }),
      // Reached only when it wasn't skipped: a skip ends this trigger at the wait.
      ...(completed ? [set(at("watch/completed"), completed, { kind: "bool", value: true })] : []),
    ],
  };
  // On for the cutscene's length on Unit Is Created, as an Editor-made Campaign's "Unit Spawned
  // During Cutscene (Created)" is (that one only clears the unit's outline and fidget). Made units
  // only: a unit trained or built would come from a producer the sweep paused. No unit, as that
  // one checks, no change.
  const spawnsTrigger: Trigger = {
    ...spawns,
    initiallyOff: true,
    events: [call(at("spawns/event"), F.unitCreated, { creator: preset(P.anyUnit), ability: preset(P.anyAbility), behavior: preset(P.noBehavior) })],
    conditions: [call(at("spawns/unit"), F.comparison, { left: createdUnit(at("spawns/unit/left")), operator: preset(P.compareNotEqual), right: preset(P.noUnit) })],
    actions: pauseAndHide("spawns", createdUnit),
  };
  return {
    triggers: [playTrigger, watchTrigger, spawnsTrigger],
    variables: [aiWasPaused, dialog, cutscene, pausedUnits, hiddenUnits, ...(completed && handingOn ? [completed, handingOn] : [])],
    run: (runPath) => call(runPath, F.triggerExecute, { checkConditions: preset(P.checkConditions), wait: preset(P.wait), trigger: { kind: "trigger", trigger: play } }),
    leave: (leavePath, unit, state) => call(leavePath, F.unitGroupRemove, { group: of(state === "hidden" ? hiddenUnits : pausedUnits), unit }),
    ...(handingOn && completed ? { handOn: (handPath: string) => set(handPath, handingOn, { kind: "bool", value: true }), completed } : {}),
  };
}
