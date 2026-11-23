// A trigger scene played from its scene's cue, in place of the scene's Transmissions, the way
// Blizzard builds one (cinematography RECIPES.md "Trigger scene"): four triggers run in turn with
// wait, Setup → Cinematic → Cinematic End → Cleanup, on the mission map under Cinematic Mode at full
// screen (never Story Mode, which only Blizzard's maps may call). All of it is NativeLib's GUI
// actions (ADR 0002); none needs custom Galaxy.

import { ordersInTime, TRIGGER_SCENE_TIMES as TIMES, type TimedTriggerScene, warpsInTime } from "../cutscene/trigger-scene.js";
import { bySpeaker } from "../domain/character.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { openEaseMs, sameFraming, shotEnd, shotStart, type TriggerSceneBuild, type TriggerSceneFraming, type TriggerSceneOrder, type TriggerScenePlace, type TriggerSceneUnitChange, type TriggerSceneWarpOut } from "../domain/trigger-scene.js";
import type { ScriptLine } from "../script/name-script.js";
import { isWaveUnit, objectIdOf, regionValueOf, unitValueOf } from "./kept-ids.js";
import { blackFade, block, call, callValue, ifAlive as ifUnitAlive, pickedUnit, sceneTitle as title, stableElementId, triggerVariable, USER_PLAYER } from "./trigger-builders.js";
import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P, SUB_FUNCTIONS } from "./trigger-catalog.js";
import { triggerSceneWorld } from "./trigger-scene-world.js";
import type { TransmissionHold } from "./transmission-hold.js";
import type { Trigger, TriggerCall, TriggerParam, TriggerRef, TriggerVariable } from "./trigger-model.js";

/**
 * A run that handed on to a trigger scene after it on a cue: whether it was watched to its end (the
 * skip they share) and whether the Music soundtrack is paused for the chain's handback to bring back.
 */
export type HandedOn = {
  readonly completed: TriggerVariable;
  readonly musicPaused: TriggerParam["value"];
  /** A trigger scene before it saved the player's camera already, so this one keeps that save rather than saving the last shot's. */
  readonly cameraSaved: boolean;
};

/** What a Mission's trigger scene adds to its triggers, and the actions its cues run. */
export type TriggerScenePlayback = {
  readonly triggers: readonly Trigger[];
  readonly variables: readonly TriggerVariable[];
  /**
   * Runs the scene and waits for its handback, so the scenes cued after it play after it. With
   * `after`, the scene follows a run on the same cue that handed on to it (left the screen black and
   * Cinematic Mode on for this scene to carry on from, and the Music soundtrack paused when a
   * Cinematic began the chain), and shares its skip: a skipped run skips this scene to its cleanup. `cueUnit` is the unit the cue
   * keeps (cue-triggers' cueUnitVariable: the unit neared, or the one an effect struck), which shots aimed at "cue" film.
   */
  readonly run: (path: string, options?: { readonly after?: HandedOn; readonly cueUnit?: TriggerVariable }) => TriggerCall[];
  /**
   * Built with `handsOn`, for a scene some cue runs straight before another trigger scene: run before
   * `run`, it makes this run's cleanup leave the screen black and Cinematic Mode on, for the next
   * scene's handback (ADR 0012).
   */
  readonly handOn?: (path: string) => TriggerCall;
  /** Built with `handsOn`: what the scene after it takes over (`run`'s `after`). */
  readonly handsOnAs?: HandedOn;
  /** A victory outro: its cleanup leaves the screen black and Cinematic Mode on, for the victory the cue ends the game with straight after `run`. */
  readonly outro: boolean;
};

/**
 * One script line as the scene's Transmission, with element ids under `prefix`: the cue's own
 * Transmission for the line, or, given `speaker`, one from that unit (a staged unit the scene's
 * `speakers` names), its flash on the unit. Sent without waiting: the scene's hold keeps it and
 * waits for it (transmission-hold.ts), so the Cleanup can cut off that line and no other.
 */
export type LineTransmission = (line: ScriptLine, prefix: string, speaker?: TriggerParam["value"]) => TriggerCall;

/** How near its place a withdrawing unit is removed, in cells: units sent to one point stop a little apart. */
const WITHDRAW_RANGE = 2;

/** How far apart, at least, the Cleanup lands units that end at one place, in cells, round a ring at least a cell out. */
const LANDING_SPACING = 1;

/**
 * How the Cleanup lands a Zone order's units, whose number it learns only in game: on a spiral out
 * from the ring of the live units landing at that place, each the golden angle round from the one
 * before and a little further out, so none lands on another however many there are.
 */
const SPIRAL_ANGLE = 137.5;
const SPIRAL_STEP = 0.2;

/** The warp effect Blizzard's campaign triggers attach to a unit warping in or out, and how long each plays, in game ms (as theirs wait). */
const WARP_MODEL = "ProtossGenericWarpInOut";
const WARP_IN_MS = 5000;
const WARP_OUT_MS = 1700;
/** How far round their place the units of a warp-in stand, in cells, unless it gives a radius. */
const WARP_IN_RADIUS = 1.5;
/** How near its place a build's structure is looked for, in cells: a builder may place it a little off. */
const BUILD_RANGE = 2;

const seconds = (ms: number): TriggerParam["value"] => ({ kind: "fixed", value: Math.round(ms) / 1000 });
/** How long a handback's minimap ping shows, in seconds. */
const PING_SECONDS = 4;

/** Pause/Unpause Soundtrack on the Music soundtrack, with a fade, for every player. */
const soundtrackPause = (where: string, pause: boolean): TriggerCall =>
  call(where, F.soundtrackPause, {
    players: callValue(`${where}/players`, F.allPlayers, {}),
    category: { kind: "preset", preset: P.soundtrackCategoryMusic },
    pause: { kind: "preset", preset: pause ? P.pause : P.unpause },
    fade: { kind: "preset", preset: P.soundFade },
  });

/** What a scene's music adds: its calls at each step of the scene, and its cues' triggers and variables. */
type SceneMusic = {
  /** In Setup, under black: the mission music paused, or lowered in Speech mode. */
  readonly setup: TriggerCall[];
  /** At the start of the Cinematic trigger: the cues that start at a time, each on its own thread. */
  readonly start: TriggerCall[];
  /** Just before a line's Transmission: the cues that start on it. */
  readonly onLine: (soundId: string) => TriggerCall[];
  /** First in the Cinematic End, skipped or watched, before its fade out: no cue starts or changes from here. */
  readonly end: TriggerCall[];
  /** First in the cleanup: the same (Setup may have gone straight to it), and each cue playing stopped with a fade. */
  readonly stop: TriggerCall[];
  /** Game mode back, when the scene lowered the music. */
  readonly cleanup: TriggerCall[];
  /** Whether the cleanup always unpauses the mission music: the scene paused it, or a cue dipped it. */
  readonly unpause: boolean;
  readonly triggers: Trigger[];
  readonly variables: TriggerVariable[];
};

/** The fade from a cue's untilMs: its volume stepped down to silence every 250 ms or so (two to ten steps), then stopped (RECIPES.md "Crossfade"). */
const FADE_STEP_MS = 250;

/**
 * A scene's music (RECIPES.md "Music"). Paused by default, as a Cinematic does; kept, it plays on.
 * Music under the lines (kept, or a cue's) is lowered in Speech mode (M5), and Game mode returns at
 * the handback. Each cue is "Trigger Scene <Id> Music <n>", run without a wait at its start, which
 * plays its Sound from its in-point (dipping the kept mission music under it), keeps the handle, and
 * fades it from its untilMs. `playing` is on from the first cut to the Cinematic End, so a cue due
 * after a skip or in the fade out never starts, and one fading leaves the cleanup's stop alone (M4).
 * Kept after a Cinematic that handed on with the music paused, Setup brings it back under black.
 */
function sceneMusic(
  scene: TimedTriggerScene,
  path: string,
  name: string,
  variable: (key: string, type?: TriggerVariable["type"]) => TriggerVariable,
  afterCinematic: TriggerVariable,
): SceneMusic {
  const at = (step: string): string => `${path}/${step}`;
  const paused = (scene.triggerScene.music?.mission ?? "pause") === "pause";
  const cues = scene.triggerScene.music?.cues ?? [];
  const lowered = !paused || cues.length > 0;
  const preset = (value: (typeof P)[keyof typeof P]): TriggerParam["value"] => ({ kind: "preset", preset: value });
  const players = (where: string): TriggerParam["value"] => callValue(`${where}/players`, F.allPlayers, {});
  const of = (held: TriggerVariable): TriggerParam["value"] => ({ kind: "variable", variable: held });
  const wait = (where: string, ms: number): TriggerCall => call(where, F.wait, { time: seconds(ms), timeType: preset(P.timeReal) });
  const onlyIf = (where: string, left: TriggerVariable, operator: (typeof P)[keyof typeof P], right: TriggerParam["value"], then: TriggerCall[]): TriggerCall =>
    block(where, F.ifThenElse, {}, [
      { type: SUB_FUNCTIONS.if, calls: [call(`${where}/if`, F.comparison, { left: of(left), operator: preset(operator), right })] },
      { type: SUB_FUNCTIONS.then, calls: then },
    ]);
  const mode = (where: string, speech: boolean): TriggerCall =>
    call(where, F.setAllSoundChannelVolumes, { mode: preset(speech ? P.volumeChannelModeSpeech : P.volumeChannelModeGame), players: players(where), duration: { kind: "fixed", value: 0.5 } });

  const playing = variable("playing");
  const handles = cues.map((_cue, index) => variable(`music_${index + 1}`, "sound"));
  const refs: TriggerRef[] = cues.map((_cue, index) => ({ id: stableElementId(at(`music/${index}`)), name: `${name} Music ${index + 1}` }));
  const run = (where: string, index: number): TriggerCall =>
    call(where, F.triggerExecute, { checkConditions: preset(P.checkConditions), wait: preset(P.dontWait), trigger: { kind: "trigger", trigger: refs[index]! } });
  const triggers: Trigger[] = cues.map((cue, index) => {
    const step = (key: string): string => at(`music/${index}/${key}`);
    const handle = handles[index]!;
    const volume = (cue.volume ?? 1) * 100;
    const startMs = scene.cueStartsMs[index]!;
    const fade: TriggerCall[] = [];
    const whilePlaying = (where: string, then: TriggerCall[]): TriggerCall => onlyIf(where, playing, P.compareEqual, { kind: "bool", value: true }, then);
    if (cue.untilMs !== undefined) {
      const steps = cue.fadeOutMs === undefined ? 0 : Math.min(10, Math.max(2, Math.round(cue.fadeOutMs / FADE_STEP_MS)));
      fade.push(wait(step("until"), cue.untilMs - startMs));
      // Linear from untilMs to silence: each step waits, then lowers the volume, unless the scene has ended.
      for (let k = 1; k <= steps; k++) {
        fade.push(
          wait(step(`fade/${k}/wait`), cue.fadeOutMs! / steps),
          whilePlaying(step(`fade/${k}`), [call(step(`fade/${k}/volume`), F.soundSetVolume, { sound: of(handle), volume: { kind: "fixed", value: Math.round(volume * (1 - k / steps) * 100) / 100 } })]),
        );
      }
      // Ramped down, it stops at once; with no fadeOutMs, with the engine's own fade.
      fade.push(whilePlaying(step("fade"), [call(step("fade/stop"), F.soundStop, { sound: of(handle), fade: preset(steps === 0 ? P.soundFade : P.soundNoFade) })]));
    }
    return {
      ...refs[index]!,
      events: [],
      actions: [
        ...(cue.line === undefined && startMs > 0 ? [wait(step("at"), startMs)] : []),
        whilePlaying(step("play"), [
          // Kept, the mission music dips under the cue; paused, it's paused already.
          ...(paused ? [] : [soundtrackPause(step("play/dip"), true)]),
          call(step("play/sound"), F.playSound, {
            owningPlayer: preset(P.globalSoundPlayer),
            audibleTo: players(step("play/sound")),
            volume: { kind: "fixed", value: volume },
            offset: seconds(cue.fromMs ?? 0),
            sound: { kind: "soundlink", sound: cue.sound },
          }),
          call(step("play/handle"), F.setVariable, { variable: of(handle), value: callValue(step("play/handle/value"), F.soundLastPlayed, {}) }),
        ]),
        ...fade,
      ],
    };
  });

  return {
    setup: [
      ...(paused
        ? [soundtrackPause(at("setup/music"), true)]
        : [onlyIf(at("setup/music"), afterCinematic, P.compareEqual, { kind: "bool", value: true }, [soundtrackPause(at("setup/music/unpause"), false)])]),
      ...(lowered ? [mode(at("setup/speech"), true)] : []),
    ],
    start: cues.length ? [call(at("cinematic/playing"), F.setVariable, { variable: of(playing), value: { kind: "bool", value: true } }), ...cues.flatMap((cue, index) => (cue.line === undefined ? [run(at(`cinematic/music/${index}`), index)] : []))] : [],
    onLine: (soundId) => cues.flatMap((cue, index) => (cue.line === soundId ? [run(at(`cinematic/music/${index}`), index)] : [])),
    end: cues.length ? [call(at("end/playing"), F.setVariable, { variable: of(playing), value: { kind: "bool", value: false } })] : [],
    stop: cues.length
      ? [
          call(at("cleanup/playing"), F.setVariable, { variable: of(playing), value: { kind: "bool", value: false } }),
          ...handles.map((handle, index) => onlyIf(at(`cleanup/music/${index}`), handle, P.compareNotEqual, preset(P.noSound), [call(at(`cleanup/music/${index}/stop`), F.soundStop, { sound: of(handle), fade: preset(P.soundFade) })])),
        ]
      : [],
    cleanup: lowered ? [mode(at("cleanup/game"), false)] : [],
    unpause: paused || cues.length > 0,
    triggers,
    variables: cues.length ? [playing, ...handles] : [],
  };
}

/**
 * "Trigger Scene <Id> Setup" runs under black: Cinematic Mode on at full screen, AI time paused
 * unless it was already (waves wait; Cinematic Mode alone doesn't pause it), the camera locked and
 * saved. It then runs, each with wait, "... Cinematic" (the first cut, the skippable begin, the fade
 * in, then each shot's camera, its move and its lines as Transmissions), "... Cinematic End" (the
 * fade out, 2.0 s, or 0.5 s after a skip) and "... Cleanup" (any line still playing cut off, the
 * camera unlocked, AI time back, then the gameplay camera, the fade in and Cinematic Mode off
 * together over 1.5 s, or 1.0 s after a skip). A skip ends only the Cinematic trigger, so the end
 * and the cleanup run the same either way.
 *
 * After a Cinematic or another trigger scene on the same cue, it shares that run's skip (T1): `run`
 * copies whether the run before was skipped into the scene's own `skipped` as it starts it, and when
 * it was, Setup goes straight to the cleanup. Each scene's flag is its own, so no other cue's run can
 * change it. Built with `handsOn`, it can itself hand on to the trigger scene after it.
 *
 * The handback's variants (`handback`): no fade, minimap pings, the objective it issues (`objective`
 * gives the objective's variable) and lines played in play after it, from "... Lines", run without
 * waiting once control is back.
 *
 * A victory outro (`outro`) never hands back: its cleanup only cuts off any line still playing, and
 * leaves the screen black after the fade out, Cinematic Mode on, the camera locked and AI time
 * paused, for the victory its cue ends the game with (RECIPES.md "Victory outro"). It can't hand on.
 */
export function triggerScenePlayback(
  scene: TimedTriggerScene,
  blueprint: MissionBlueprint,
  transmission: LineTransmission,
  options: {
    /** The Mission's hold on its lines, and this scene's number in it (ADR 0013). */
    readonly lines: { readonly hold: TransmissionHold; readonly number: number };
    /** Some cue plays it straight before another trigger scene. */
    readonly handsOn?: boolean;
    /** Some cue plays it last, so it hands back somewhere: false refuses a `handback` it would never use. */
    readonly handsBack?: boolean;
    /** Some cue plays it straight after another trigger scene, whose camera save it may keep. */
    readonly takesOver?: boolean;
    readonly objective?: (id: string) => TriggerVariable | undefined;
  },
): TriggerScenePlayback {
  const { id } = scene;
  const handback = scene.triggerScene.handback;
  const outro = scene.triggerScene.outro !== undefined;
  if (outro && options.handsOn) throw new Error(`Trigger scene ${id} is a victory outro, which ends the game, so it plays last on its cue: no trigger scene can play after it`);
  if (options.handsOn && options.handsBack === false && handback !== undefined) {
    throw new Error(`Trigger scene ${id} hands on to the scene after it on every cue that plays it, so it never hands back: move its handback options to the last scene`);
  }
  // Handing on, its cleanup skips the handback and all that follows it, so these would be lost on that
  // cue, the lines with them; the chain's last scene is where they belong.
  if (options.handsOn && (handback?.ping?.length || handback?.objective !== undefined || handback?.linesFrom !== undefined)) {
    throw new Error(`Trigger scene ${id} hands on to the scene after it on a cue, where its pings, objective and lines after the handback would never play: move them to the last scene`);
  }
  const path = `trigger-scenes/${id}`;
  const name = `Trigger Scene ${title(id)}`;
  const ref = (step: string, label: string): TriggerRef => ({ id: stableElementId(`${path}/${step}`), name: `${name} ${label}` });
  const setup = ref("setup", "Setup");
  const cinematic = ref("cinematic", "Cinematic");
  const end = ref("end", "Cinematic End");
  const cleanup = ref("cleanup", "Cleanup");
  // A Galaxy name: the scene's id and the key, hyphens as underscores.
  const variableName = (key: string): string => `trigger_scene_${id}_${key}`.replace(/-/g, "_");
  const after = ref("lines", "Lines");
  const variable = (key: string, type: TriggerVariable["type"] = "bool"): TriggerVariable =>
    triggerVariable(`${path}/variables/${key}`, variableName(key), type, type === "sound" ? { kind: "preset", preset: P.noSound } : { kind: "bool", value: false });
  const completed = variable("completed");
  const aiWasPaused = variable("ai_was_paused");
  const skipped = variable("skipped");
  const afterCinematic = variable("after_cinematic");
  // The Mission's hold on its lines (ADR 0013) and, with lines after the handback, whether the one
  // playing has played to its end.
  const { hold, number } = options.lines;
  const lineSent = scene.afterHandback.length ? variable("line_sent") : undefined;
  // With a hero moment, whether its lines after the handback hold moments off (#656).
  const momentHeld = lineSent && hold.afterHandbackMoment ? variable("moment_held") : undefined;
  const { shots } = scene.triggerScene;
  // Opening with no fade, the ease from the player's camera to the first shot's, in ms (none from black).
  const ease = openEaseMs(scene.triggerScene);
  // Whether the scene's shots are playing, for an order atMs into a shot: given on its own thread,
  // which a skip doesn't end, it gives nothing once the Cinematic has ended.
  // So are the warp-ins, builds and warp-outs, which always wait, and actor events and unit changes atMs into a shot.
  const playing = shots.some(
    (shot) =>
      [shot.orders, shot.actorEvents, shot.unitChanges].some((timed) => (timed ?? []).some((given) => given.atMs)) || [shot.warpIns, shot.builds, shot.warpOuts].some((warps) => (warps ?? []).length > 0),
  )
    ? variable("playing")
    : undefined;
  const group = (key: string): TriggerVariable =>
    triggerVariable(`${path}/variables/${key}`, variableName(key), "unitgroup", callValue(`${path}/variables/${key}/value`, F.unitGroupEmpty, {}));
  // Each staged unit's group, by its cast id, for the shots' orders and the Cleanup's removal.
  const castGroups = new Map((scene.triggerScene.cast ?? []).map((member) => [member.id, group(`cast_${member.id}`)]));
  // A line whose speaker the scene's `speakers` gives a staged unit: the first unit of its group,
  // which it plays from. Only the shots' lines: the cast is gone by the lines after the handback.
  const castSpeaker = (line: ScriptLine): TriggerParam["value"] | undefined => {
    const cast = bySpeaker(scene.triggerScene.speakers ?? {}, line.speaker);
    if (cast === undefined) return undefined;
    return callValue(`${path}/speakers/${cast}/${line.lineId}`, F.unitGroupUnit, { group: { kind: "variable", variable: castGroups.get(cast)! }, index: { kind: "int", value: 1 } });
  };
  // The live units the scene hid or paused itself, which the Cleanup puts back (as a Cinematic's groups).
  const live = scene.triggerScene.live ?? [];
  const hiddenUnits = live.some((unit) => unit.hide) ? group("hidden_units") : undefined;
  const pausedUnits = live.some((unit) => unit.pause) ? group("paused_units") : undefined;
  // The cue's unit, copied as the scene starts, for shots aimed at it; only a scene with one has it.
  const filmsCueUnit = shots.some((shot) => shot.unit === "cue" || shot.toUnit === "cue");
  const cueUnit = filmsCueUnit ? triggerVariable(`${path}/variables/unit`, `trigger_scene_${id.replace(/-/g, "_")}_unit`, "unit", { kind: "preset", preset: P.noUnit }) : undefined;
  const handingOn = options.handsOn ? variable("hand_on") : undefined;
  const cameraSaved = options.takesOver ? variable("camera_saved") : undefined;
  // The scene's Light, fog and black mask: changed under black here, put back in the cleanup (L2, L3).
  const world = triggerSceneWorld(scene.triggerScene, blueprint, path, id.replace(/-/g, "_"));

  const at = (step: string): string => `${path}/${step}`;
  const preset = (value: (typeof P)[keyof typeof P]): TriggerParam["value"] => ({ kind: "preset", preset: value });
  const of = (held: TriggerVariable): TriggerParam["value"] => ({ kind: "variable", variable: held });
  const players = (where: string): TriggerParam["value"] => callValue(`${where}/players`, F.allPlayers, {});
  const player: TriggerParam["value"] = { kind: "int", value: USER_PLAYER };
  const set = (where: string, held: TriggerVariable, value: TriggerParam["value"]): TriggerCall => call(where, F.setVariable, { variable: of(held), value });
  const is = (where: string, held: TriggerVariable, value: boolean): TriggerCall =>
    call(where, F.comparison, { left: of(held), operator: preset(P.compareEqual), right: { kind: "bool", value } });
  const when = (where: string, condition: TriggerCall, then: TriggerCall[], otherwise: TriggerCall[] = []): TriggerCall =>
    block(where, F.ifThenElse, {}, [
      { type: SUB_FUNCTIONS.if, calls: [condition] },
      { type: SUB_FUNCTIONS.then, calls: then },
      { type: SUB_FUNCTIONS.else, calls: otherwise },
    ]);
  // A Wave's unit is none until its send creates it (kept-ids' isWaveUnit), so its calls that need
  // it on the map (a pan or ping to where it is, an order, an actor event) run only while it's alive.
  const ifThere = (where: string, anchorId: string, calls: TriggerCall[]): TriggerCall[] => (isWaveUnit(blueprint, anchorId) ? [ifAlive(where, anchorId, calls)] : calls);
  const execute = (where: string, trigger: TriggerRef, waited = true): TriggerCall =>
    call(where, F.triggerExecute, { checkConditions: preset(P.checkConditions), wait: preset(waited ? P.wait : P.dontWait), trigger: { kind: "trigger", trigger } });
  const fade = blackFade;
  const cinematicMode = (where: string, on: boolean, ms: number): TriggerCall =>
    call(where, F.cinematicMode, { onOff: preset(on ? P.on : P.off), players: players(where), duration: seconds(ms) });
  // Apply Camera Object: a cut (no duration), an eased move (velocity −1, decelerate 10; C7) or a
  // linear one. Aimed at a unit, the object's values apply without its target, and the camera pans
  // to where the unit is over the same time, eased the same way.
  const applyCamera = (where: string, framing: TriggerSceneFraming, ms: number, move: "ease" | "linear" = "ease"): TriggerCall[] => {
    const deceleration: TriggerParam["value"] = { kind: "fixed", value: move === "linear" ? 0 : 10 };
    const apply = call(where, F.cameraApplyInfo, {
      player,
      camera: { kind: "camerainfo", objectId: objectIdOf(blueprint, framing.camera) },
      duration: seconds(ms),
      velocity: preset(P.cameraVelocityDefault),
      deceleration,
      useTarget: preset(framing.unit === undefined ? P.cameraUseTarget : P.cameraDontUseTarget),
    });
    if (framing.unit === undefined) return [apply];
    const unit: TriggerParam["value"] = framing.unit === "cue" ? of(cueUnit!) : unitValueOf(blueprint, framing.unit.anchorId);
    const pan = call(`${where}/pan`, F.cameraPan, {
      player,
      point: callValue(`${where}/pan/point`, F.unitPosition, { unit }),
      duration: seconds(ms),
      velocity: preset(P.cameraVelocityDefault),
      deceleration,
      smart: preset(P.doNot),
    });
    return [apply, ...(framing.unit === "cue" ? [pan] : ifThere(`${where}/there`, framing.unit.anchorId, [pan]))];
  };
  const wait = (where: string, ms: number): TriggerCall => call(where, F.wait, { time: seconds(ms), timeType: preset(P.timeReal) });
  const pauseAI = (where: string, pause: boolean): TriggerCall => call(where, F.aiTimePause, { pause: preset(pause ? P.pause : P.unpause) });
  const place = (where: string, at: TriggerScenePlace): TriggerParam["value"] =>
    typeof at === "string" ? { kind: "point", objectId: objectIdOf(blueprint, at) } : callValue(where, F.point, { x: { kind: "fixed", value: at.x }, y: { kind: "fixed", value: at.y } });
  const eachOf = (where: string, held: TriggerVariable, calls: (unitAt: string) => TriggerCall[]): TriggerCall =>
    block(where, F.pickEachUnitInGroup, { group: of(held) }, [{ type: SUB_FUNCTIONS.pickEachActions, calls: calls(`${where}/unit`) }]);
  const moveTo = (where: string, unit: TriggerParam["value"], to: TriggerScenePlace): TriggerCall =>
    call(where, F.unitIssueOrder, {
      unit,
      order: callValue(`${where}/order`, F.orderTargetingPoint, { point: place(`${where}/order/point`, to), abilityCommand: { kind: "abilcmd", ability: "move", target: "point" } }),
      queue: preset(P.orderQueueReplace),
    });
  // A staged unit's group ordered to move to a place, at a shot's cut.
  const order = (where: string, cast: string, to: TriggerScenePlace): TriggerCall => eachOf(where, castGroups.get(cast)!, (unitAt) => [moveTo(unitAt, pickedUnit(`${unitAt}/unit`), to)]);
  // The staged cast removed, under black in the Cleanup, whichever way the scene ended.
  const unstage = (where: string): TriggerCall[] =>
    [...castGroups].flatMap(([cast, held]) => [
      eachOf(`${where}/${cast}/remove`, held, (unitAt) => [call(unitAt, F.unitRemove, { unit: pickedUnit(`${unitAt}/unit`) })]),
      call(`${where}/${cast}/clear`, F.unitGroupClear, { group: of(held) }),
    ]);
  // A live unit hidden or paused for the scene, unless it was already, kept in the group the Cleanup puts back (as a Cinematic's).
  const unitOf = (unitId: string): TriggerParam["value"] => unitValueOf(blueprint, unitId);
  const change = (where: string, unitId: string, held: TriggerVariable, test: TriggerCall["def"], apply: TriggerCall): TriggerCall =>
    when(where, call(`${where}/if`, F.comparison, { left: callValue(`${where}/if/test`, test, { unit: unitOf(unitId) }), operator: preset(P.compareEqual), right: { kind: "bool", value: false } }), [
      call(`${where}/add`, F.unitGroupAdd, { group: of(held), unit: unitOf(unitId) }),
      apply,
    ]);
  const setAside = (where: string): TriggerCall[] =>
    live.flatMap(({ unit, hide, pause }) => ifThere(`${where}/${unit}/there`, unit, [
      ...(pause ? [change(`${where}/${unit}/pause`, unit, pausedUnits!, F.unitIsPaused, call(`${where}/${unit}/pause/unit`, F.pauseUnit, { unit: unitOf(unit), pause: preset(P.pause) }))] : []),
      ...(hide ? [change(`${where}/${unit}/hide`, unit, hiddenUnits!, F.unitIsHidden, call(`${where}/${unit}/hide/unit`, F.showHideUnit, { unit: unitOf(unit), showHide: preset(P.hide) }))] : []),
    ]));
  const putBack = (where: string): TriggerCall[] => [
    ...(pausedUnits
      ? [eachOf(`${where}/unpause`, pausedUnits, (unitAt) => [call(unitAt, F.pauseUnit, { unit: pickedUnit(`${unitAt}/unit`), pause: preset(P.unpause) })]), call(`${where}/clearPaused`, F.unitGroupClear, { group: of(pausedUnits) })]
      : []),
    ...(hiddenUnits
      ? [eachOf(`${where}/show`, hiddenUnits, (unitAt) => [call(unitAt, F.showHideUnit, { unit: pickedUnit(`${unitAt}/unit`), showHide: preset(P.show) })]), call(`${where}/clearHidden`, F.unitGroupClear, { group: of(hiddenUnits) })]
      : []),
  ];
  // The staged cast, created under black for the player each names, each kept in its group (O3).
  const stage = (where: string): TriggerCall[] =>
    (scene.triggerScene.cast ?? []).flatMap((member) => [
      call(`${where}/${member.id}/create`, F.unitCreate, {
        count: { kind: "int", value: member.count ?? 1 },
        flags: preset(P.unitCreateFlagsNone),
        player: { kind: "int", value: member.player },
        facing: { kind: "fixed", value: member.facing ?? 270 },
        unitType: { kind: "gamelink", gameType: "Unit", value: member.unitType },
        point: place(`${where}/${member.id}/create/point`, member.at),
      }),
      call(`${where}/${member.id}/group`, F.unitGroupAddUnitGroup, { target: of(castGroups.get(member.id)!), source: callValue(`${where}/${member.id}/group/source`, F.lastCreatedUnits, {}) }),
    ]);

  // A live unit's calls, made only if it's still alive (killed before or in the scene, it has nowhere to go).
  const ifAlive = (where: string, unit: string, then: TriggerCall[]): TriggerCall => ifUnitAlive(where, unitOf(unit), then);

  // Each live unit on its mark at once, under black, and faced as the scene gives it.
  const toMarks = (where: string): TriggerCall[] =>
    (scene.triggerScene.marks ?? []).map(({ unit, at: mark, facing }, n) =>
      ifAlive(`${where}/${n}`, unit, [
        call(`${where}/${n}/position`, F.unitSetPosition, { unit: unitOf(unit), point: place(`${where}/${n}/position/point`, mark), blend: preset(P.positionNoBlend) }),
        ...(facing !== undefined ? [call(`${where}/${n}/facing`, F.unitSetFacing, { unit: unitOf(unit), facing: { kind: "fixed", value: facing }, duration: { kind: "fixed", value: 0 } })] : []),
      ]),
    );

  // A player's units in a region that aren't structures.
  const playerUnitsIn = (where: string, owner: number, region: (where: string) => TriggerParam["value"]): TriggerParam["value"] =>
    callValue(where, F.unitsInRegionMatching, {
      unitType: preset(P.anyUnitType),
      player: { kind: "int", value: owner },
      region: region(`${where}/region`),
      filter: { kind: "unitfilter", require: [], exclude: ["Structure", "Dead"] },
      count: preset(P.anyAmount),
    });
  // Those added to a group: a warp-out's army (the whole map) or a Zone order's units. The staged
  // cast is the scene's own: it goes by a withdraw or the Cleanup, never with the player's units.
  const gatherPlayer = (where: string, held: TriggerVariable, owner: number, region: (where: string) => TriggerParam["value"]): TriggerCall[] => [
    call(where, F.unitGroupAddUnitGroup, { target: of(held), source: playerUnitsIn(`${where}/source`, owner, region) }),
    ...(scene.triggerScene.cast ?? [])
      .filter((member) => member.player === owner)
      .map((member) => call(`${where}/cast/${member.id}`, F.unitGroupRemoveUnitGroup, { target: of(held), source: of(castGroups.get(member.id)!) })),
  ];

  // Each order whose units withdraw: its own group, held as they're ordered, and the trigger that
  // removes each on reaching its place, on only while they walk.
  const enable = (where: string, trigger: TriggerRef, on: boolean): TriggerCall => call(where, F.triggerEnable, { trigger: { kind: "trigger", trigger }, state: preset(on ? P.triggerOn : P.triggerOff) });
  const withdrawals = new Map(
    shots.flatMap((shot, index) =>
      (shot.orders ?? []).flatMap((given, n) => {
        if (!given.withdraw) return [];
        const key = `withdraw_${index + 1}_${n + 1}`;
        return [[given, { key, held: group(key), arrival: ref(`${key}/arrival`, `Withdraw Shot ${index + 1} Order ${n + 1}`) }] as const];
      }),
    ),
  );
  // Each order to a player's units in a Zone: the group they're gathered into at the order (its
  // withdrawal's, when they withdraw), and whether it has gathered them, for a skip that comes first.
  const zoneOrders = new Map(
    shots.flatMap((shot, index) =>
      (shot.orders ?? []).flatMap((given, n) => {
        if (given.player === undefined) return [];
        const key = `${index + 1}_${n + 1}`;
        return [[given, { key, held: withdrawals.get(given)?.held ?? group(`zone_order_${key}`), done: variable(`zone_ordered_${key}`) }] as const];
      }),
    ),
  );
  const gatherZone = (where: string, given: TriggerSceneOrder): TriggerCall[] => gatherPlayer(where, zoneOrders.get(given)!.held, given.player!, () => regionValueOf(blueprint, given.inZone!));
  const arrivalTriggers: Trigger[] = [...withdrawals].map(([given, { key, held, arrival }]) => {
    const where = at(key);
    const arriving = (step: string): TriggerParam["value"] => callValue(`${where}/${step}`, F.triggeringUnit, {});
    return {
      ...arrival,
      initiallyOff: true,
      // Any unit, since the event can't take a group; the condition keeps it to the order's.
      events: [call(`${where}/event`, F.unitEntersRangeOfPoint, { unit: preset(P.anyUnit), range: { kind: "fixed", value: WITHDRAW_RANGE }, enters: preset(P.regionEnters), point: place(`${where}/event/point`, given.moveTo) })],
      conditions: [
        call(`${where}/held`, F.comparison, {
          left: callValue(`${where}/held/left`, F.unitGroupHasUnit, { group: of(held), unit: arriving("held/left/unit") }),
          operator: preset(P.compareEqual),
          right: { kind: "bool", value: true },
        }),
      ],
      actions: [call(`${where}/remove`, F.unitRemove, { unit: arriving("remove/unit") })],
    };
  });
  // A scene's orders in the order they're given, for what comes before and after a Zone order.
  const timedOrders = ordersInTime(scene.triggerScene);
  // The Zone orders that withdraw, given before this order: a unit it takes leaves their group, so
  // their arrival doesn't remove it on its new way (as the Cleanup leaves it to the later order).
  const earlierZoneWithdrawals = (given: TriggerSceneOrder): TriggerVariable[] =>
    timedOrders
      .slice(0, timedOrders.findIndex(({ order }) => order === given))
      .flatMap(({ order }) => (order.withdraw && zoneOrders.has(order) ? [zoneOrders.get(order)!.held] : []));
  // An order's calls: a staged unit's group or live units sent to the place, and for a withdrawal,
  // each first held in its group with its arrival turned on.
  const orderCalls = (where: string, given: TriggerSceneOrder): TriggerCall[] => {
    const withdrawal = withdrawals.get(given);
    const zone = zoneOrders.get(given);
    const earlier = earlierZoneWithdrawals(given);
    if (zone) {
      return [
        ...(withdrawal ? [enable(`${where}/arrival`, withdrawal.arrival, true)] : []),
        ...gatherZone(`${where}/gather`, given),
        set(`${where}/gathered`, zone.done, { kind: "bool", value: true }),
        ...earlier.map((held, k) => call(`${where}/taken/${k}`, F.unitGroupRemoveUnitGroup, { target: of(held), source: of(zone.held) })),
        // Those at the place already never enter its range, so they're removed now.
        ...(withdrawal
          ? [
              eachIn(`${where}/near`, playerUnitsIn(`${where}/near/units`, given.player!, (region) => callValue(region, F.regionCircle, { center: place(`${region}/center`, given.moveTo), radius: { kind: "fixed", value: WITHDRAW_RANGE } })), (unitAt) => [
                when(
                  `${unitAt}/held`,
                  call(`${unitAt}/held/if`, F.comparison, { left: callValue(`${unitAt}/held/if/left`, F.unitGroupHasUnit, { group: of(zone.held), unit: pickedUnit(`${unitAt}/held/if/left/unit`) }), operator: preset(P.compareEqual), right: { kind: "bool", value: true } }),
                  [call(`${unitAt}/held/remove`, F.unitRemove, { unit: pickedUnit(`${unitAt}/held/remove/unit`) })],
                ),
              ]),
            ]
          : []),
        eachOf(`${where}/walk`, zone.held, (unitAt) => [moveTo(unitAt, pickedUnit(`${unitAt}/unit`), given.moveTo)]),
      ];
    }
    if (given.cast !== undefined) {
      const sent = order(`${where}/walk`, given.cast, given.moveTo);
      if (!withdrawal) return [sent];
      return [enable(`${where}/arrival`, withdrawal.arrival, true), call(`${where}/hold`, F.unitGroupAddUnitGroup, { target: of(withdrawal.held), source: of(castGroups.get(given.cast)!) }), sent];
    }
    return [
      ...(withdrawal ? [enable(`${where}/arrival`, withdrawal.arrival, true)] : []),
      ...given.units!.flatMap((unit, n) => [
        ...earlier.map((held, k) => call(`${where}/units/${n}/taken/${k}`, F.unitGroupRemove, { group: of(held), unit: unitOf(unit) })),
        ...(withdrawal ? [call(`${where}/units/${n}/hold`, F.unitGroupAdd, { group: of(withdrawal.held), unit: unitOf(unit) })] : []),
        ...ifThere(`${where}/units/${n}/there`, unit, [moveTo(`${where}/units/${n}`, unitOf(unit), given.moveTo)]),
      ]),
    ];
  };
  // The final state the orders leave, put in place in the Cleanup on both paths: every live unit
  // that withdraws removed wherever it is (still walking, or never ordered on a skip), each
  // arrival off with its group cleared, and every other walked live unit put at its last order's
  // place at once (several that end at one place round it, so none lands on another).
  const withdrawn = new Set([...withdrawals.keys()].flatMap((given) => given.units ?? []));
  const landings = new Map<string, TriggerScenePlace>();
  for (const { order: given } of ordersInTime(scene.triggerScene)) for (const unit of given.units ?? []) if (!withdrawn.has(unit)) landings.set(unit, given.moveTo);
  const placeKey = (to: TriggerScenePlace): string => (typeof to === "string" ? to : `${to.x},${to.y}`);
  const sharing = new Map<string, string[]>();
  for (const [unit, to] of landings) sharing.set(placeKey(to), [...(sharing.get(placeKey(to)) ?? []), unit]);
  // A unit's landing: the place itself when it ends there alone, else its spot on a ring round it.
  const landing = (where: string, unit: string, to: TriggerScenePlace): TriggerParam["value"] => {
    const together = sharing.get(placeKey(to))!;
    if (together.length === 1) return place(where, to);
    const radius = Math.max(1, (together.length * LANDING_SPACING) / (2 * Math.PI));
    return callValue(where, F.pointWithOffsetPolar, {
      point: place(`${where}/point`, to),
      distance: { kind: "fixed", value: Math.round(radius * 100) / 100 },
      angle: { kind: "fixed", value: Math.round((together.indexOf(unit) * 36000) / together.length) / 100 },
    });
  };
  // A Zone order's units landed at its place on a spiral out from the ring of the live units landing
  // there: one spiral to each place, carried on by every Zone order that lands there (the first of
  // them in time starts it), so none lands where another did. The first place's keeps the plain names.
  const spirals = new Map<string, { readonly distance: TriggerVariable; readonly angle: TriggerVariable; readonly first: TriggerSceneOrder }>();
  for (const { order: given } of timedOrders) {
    if (!zoneOrders.has(given) || given.withdraw || spirals.has(placeKey(given.moveTo))) continue;
    const suffix = spirals.size === 0 ? "" : `_${spirals.size + 1}`;
    const counter = (key: string): TriggerVariable => triggerVariable(`${path}/variables/${key}${suffix}`, variableName(`${key}${suffix}`), "fixed", { kind: "fixed", value: 0 });
    spirals.set(placeKey(given.moveTo), { distance: counter("landing_distance"), angle: counter("landing_angle"), first: given });
  }
  const spiral = (where: string, given: TriggerSceneOrder): TriggerCall[] => {
    const { held } = zoneOrders.get(given)!;
    const { distance, angle, first } = spirals.get(placeKey(given.moveTo))!;
    const ring = sharing.get(placeKey(given.moveTo))?.length ?? 0;
    const from = ring > 1 ? Math.max(1, (ring * LANDING_SPACING) / (2 * Math.PI)) + LANDING_SPACING : LANDING_SPACING;
    const step = (key: string, counter: TriggerVariable, by: number): TriggerCall =>
      set(key, counter, callValue(`${key}/plus`, F.arithmeticReal, { left: of(counter), operator: preset(P.plus), right: { kind: "fixed", value: by } }));
    return [
      ...(given === first ? [set(`${where}/distance`, distance, { kind: "fixed", value: Math.round(from * 100) / 100 }), set(`${where}/angle`, angle, { kind: "fixed", value: 0 })] : []),
      eachOf(`${where}/each`, held, (unitAt) => [
        call(`${unitAt}/position`, F.unitSetPosition, {
          unit: pickedUnit(`${unitAt}/position/unit`),
          point: callValue(`${unitAt}/position/point`, F.pointWithOffsetPolar, { point: place(`${unitAt}/position/point/point`, given.moveTo), distance: of(distance), angle: of(angle) }),
          blend: preset(P.positionNoBlend),
        }),
        // Told to stay where it lands: one still walking would head on to the place after the handback.
        call(`${unitAt}/stay`, F.unitIssueOrder, {
          unit: pickedUnit(`${unitAt}/stay/unit`),
          order: callValue(`${unitAt}/stay/order`, F.orderTargetingPoint, {
            point: callValue(`${unitAt}/stay/order/point`, F.unitPosition, { unit: pickedUnit(`${unitAt}/stay/order/point/unit`) }),
            abilityCommand: { kind: "abilcmd", ability: "move", target: "point" },
          }),
          queue: preset(P.orderQueueReplace),
        }),
        step(`${unitAt}/angle`, angle, SPIRAL_ANGLE),
        step(`${unitAt}/distance`, distance, SPIRAL_STEP),
      ]),
    ];
  };
  const settle = (where: string): TriggerCall[] => [
    ...[...landings].map(([unit, to]) =>
      ifAlive(`${where}/land/${unit}`, unit, [call(`${where}/land/${unit}/position`, F.unitSetPosition, { unit: unitOf(unit), point: landing(`${where}/land/${unit}/position/point`, unit, to), blend: preset(P.positionNoBlend) })]),
    ),
    ...[...withdrawn].map((unit) => ifAlive(`${where}/gone/${unit}`, unit, [call(`${where}/gone/${unit}/remove`, F.unitRemove, { unit: unitOf(unit) })])),
    ...[...withdrawals].flatMap(([given, { key, held, arrival }]) => [enable(`${where}/${key}/off`, arrival, false), ...(zoneOrders.has(given) ? [] : [call(`${where}/${key}/clear`, F.unitGroupClear, { group: of(held) })])]),
  ];

  // Warp-ins, builds and warp-outs: each on a thread of its own started at its shot's cut, since each
  // waits (atMs, an effect's length, a builder placing its structure), given only while the scene
  // plays. Cleanup then puts their final state in place on both paths, in the order they happen.
  const warps = warpsInTime(scene.triggerScene);
  const waitGame = (where: string, ms: number): TriggerCall => call(where, F.wait, { time: seconds(ms), timeType: preset(P.timeGame) });
  const eachIn = (where: string, units: TriggerParam["value"], calls: (unitAt: string) => TriggerCall[]): TriggerCall =>
    block(where, F.pickEachUnitInGroup, { group: units }, [{ type: SUB_FUNCTIONS.pickEachActions, calls: calls(`${where}/unit`) }]);
  const lastCreated = (where: string): TriggerParam["value"] => callValue(where, F.lastCreatedUnit, {});
  const typed = (unitType: string): TriggerParam["value"] => ({ kind: "gamelink", gameType: "Unit", value: unitType });
  const warpEffect = (where: string, unit: TriggerParam["value"], point: typeof P.attachPointCenter): TriggerCall =>
    call(where, F.attachModelToUnit, { unit, model: { kind: "gamelink", gameType: "Model", value: WARP_MODEL }, attachPoint: preset(point) });
  const actorVariable = (key: string): TriggerVariable => triggerVariable(`${path}/variables/${key}`, variableName(key), "actor", { kind: "preset", preset: P.noActor });
  // Each warp-in's units, whether they're in, and each unit's effect, by warp-in id.
  const warpIns = new Map(
    warps.flatMap((warp) =>
      warp.kind === "warpIn"
        ? [[warp.action.id, { warp: warp.action, units: group(`warp_in_${warp.action.id}`), done: variable(`warped_in_${warp.action.id}`), effects: Array.from({ length: warp.action.count ?? 1 }, (_, k) => actorVariable(`warp_effect_${k + 1}_${warp.action.id}`)) }] as const]
        : [],
    ),
  );
  // A warp-in's units created one by one, evenly round its place, each kept in its group and, with
  // the effect, its effect kept to kill once played.
  const warpInCalls = (where: string, id: string, effect: boolean): TriggerCall[] => {
    const { warp, units, effects } = warpIns.get(id)!;
    const count = warp.count ?? 1;
    return effects.flatMap((held, k) => [
      call(`${where}/${k + 1}/create`, F.unitCreate, {
        count: { kind: "int", value: 1 },
        flags: preset(P.unitCreateFlagsNone),
        player: { kind: "int", value: warp.player },
        facing: { kind: "fixed", value: warp.facing ?? 270 },
        unitType: typed(warp.unitType),
        point:
          count === 1
            ? place(`${where}/${k + 1}/create/point`, warp.at)
            : callValue(`${where}/${k + 1}/create/point`, F.pointWithOffsetPolar, {
                point: place(`${where}/${k + 1}/create/point/point`, warp.at),
                distance: { kind: "fixed", value: warp.radius ?? WARP_IN_RADIUS },
                angle: { kind: "fixed", value: Math.round(((k + 1) * 36000) / count) / 100 },
              }),
      }),
      call(`${where}/${k + 1}/group`, F.unitGroupAdd, { group: of(units), unit: lastCreated(`${where}/${k + 1}/group/unit`) }),
      ...(effect ? [warpEffect(`${where}/${k + 1}/effect`, lastCreated(`${where}/${k + 1}/effect/unit`), P.attachPointCenter), set(`${where}/${k + 1}/held`, held, callValue(`${where}/${k + 1}/held/value`, F.actorLastCreated, {}))] : []),
    ]);
  };
  const killEffects = (where: string, id: string): TriggerCall[] => warpIns.get(id)!.effects.map((held, k) => call(`${where}/${k + 1}`, F.killModel, { model: of(held) }));
  // A build's builder, the player its structure is for, and whether it's finished.
  const builds = new Map(
    warps.flatMap((warp) => {
      if (warp.kind !== "build") return [];
      const { action } = warp;
      const builder = (where: string): TriggerParam["value"] =>
        action.warpIn !== undefined ? callValue(where, F.unitGroupUnit, { group: of(warpIns.get(action.warpIn)!.units), index: { kind: "int", value: 1 } }) : unitOf(action.unit!);
      const owner = action.warpIn !== undefined ? warpIns.get(action.warpIn)!.warp.player : (blueprint.anchors.find((anchor) => anchor.id === action.unit) as { player?: number } | undefined)?.player ?? USER_PLAYER;
      return [[action, { builder, owner, done: variable(`built_${warp.index + 1}_${warp.at + 1}`) }] as const];
    }),
  );
  // The structure a build makes, once placed: its type and player's, within reach of its place.
  const built = (where: string, build: TriggerSceneBuild, owner: number): TriggerParam["value"] =>
    callValue(where, F.unitsInRegionMatching, {
      unitType: typed(build.unitType),
      player: { kind: "int", value: owner },
      region: callValue(`${where}/region`, F.regionCircle, { center: place(`${where}/region/center`, build.at), radius: { kind: "fixed", value: BUILD_RANGE } }),
      filter: { kind: "unitfilter", require: [], exclude: ["Dead"] },
      count: preset(P.anyAmount),
    });
  const placedCount = (where: string, build: TriggerSceneBuild, owner: number): TriggerParam["value"] =>
    callValue(where, F.unitGroupCount, { group: built(`${where}/group`, build, owner), type: preset(P.unitCountAlive) });
  const finish = (where: string, build: TriggerSceneBuild, owner: number): TriggerCall =>
    eachIn(where, built(`${where}/group`, build, owner), (unitAt) => [
      call(unitAt, F.unitSetProgressComplete, { unit: pickedUnit(`${unitAt}/unit`), slot: { kind: "int", value: 1 }, percent: { kind: "int", value: 100 } }),
    ]);
  // Each warp-out's units, held while their effect plays, and whether it has begun (taken its units).
  const warpOuts = new Map(
    warps.flatMap((warp) =>
      warp.kind === "warpOut" ? [[warp.action, { held: group(`warp_out_${warp.index + 1}_${warp.at + 1}`), done: variable(`warped_out_${warp.index + 1}_${warp.at + 1}`) }] as const] : [],
    ),
  );
  const gather = (where: string, warp: TriggerSceneWarpOut): TriggerCall[] => {
    const { held } = warpOuts.get(warp)!;
    if (warp.units) return warp.units.map((unit, n) => call(`${where}/${n}`, F.unitGroupAdd, { group: of(held), unit: unitOf(unit) }));
    return [
      ...gatherPlayer(`${where}/army`, held, warp.player!, (region) => callValue(region, F.entireMap, {})),
      // Those it keeps (except) are taken back out, here for the shot and the Cleanup alike, so they stay.
      ...(warp.except ?? []).map((unit, n) => call(`${where}/except/${n}`, F.unitGroupRemove, { group: of(held), unit: unitOf(unit) })),
    ];
  };
  const removeAll = (where: string, held: TriggerVariable): TriggerCall[] => [
    eachOf(`${where}/remove`, held, (unitAt) => [call(unitAt, F.unitRemove, { unit: pickedUnit(`${unitAt}/unit`) })]),
    call(`${where}/clear`, F.unitGroupClear, { group: of(held) }),
  ];
  const warpLabel = { warpIn: "Warp In", build: "Build", warpOut: "Warp Out" } as const;
  const warpTriggers: Trigger[] = warps.map((warp) => {
    const key = `${warp.kind}/${warp.index + 1}_${warp.at + 1}`;
    const where = (step: string): string => at(`${key}/${step}`);
    const given = ((): TriggerCall[] => {
      switch (warp.kind) {
        case "warpIn": {
          const { done } = warpIns.get(warp.action.id)!;
          return [...warpInCalls(where("create"), warp.action.id, true), set(where("done"), done, { kind: "bool", value: true }), waitGame(where("effect"), WARP_IN_MS), ...killEffects(where("kill"), warp.action.id)];
        }
        case "build": {
          const { builder, owner, done } = builds.get(warp.action)!;
          return [
            call(where("order"), F.unitIssueOrder, {
              unit: builder(where("order/unit")),
              order: callValue(where("order/order"), F.orderTargetingPoint, { point: place(where("order/order/point"), warp.action.at), abilityCommand: { kind: "abilcmd", ability: warp.action.ability, target: "point" } }),
              queue: preset(P.orderQueueReplace),
            }),
            // Placed once the builder is idle (a Probe leaves it to warp in).
            call(where("placed"), F.unitWaitUntilIdle, { unit: builder(where("placed/unit")), waitForOrders: preset(P.waitUntilIdleTrue) }),
            // Finished only if placed: a failed order (no minerals, a blocked site) leaves it to the Cleanup.
            when(where("finish"), is(where("finish/if"), playing!, true), [
              when(where("finish/placed"), call(where("finish/placed/if"), F.comparison, { left: placedCount(where("finish/placed/if/count"), warp.action, owner), operator: preset(P.compareAtLeast), right: { kind: "int", value: 1 } }), [
                finish(where("finish/placed/each"), warp.action, owner),
                set(where("finish/placed/done"), done, { kind: "bool", value: true }),
              ]),
            ]),
          ];
        }
        case "warpOut": {
          const { held, done } = warpOuts.get(warp.action)!;
          return [
            ...gather(where("gather"), warp.action),
            set(where("done"), done, { kind: "bool", value: true }),
            eachOf(where("effect"), held, (unitAt) => [
              call(`${unitAt}/pause`, F.pauseUnit, { unit: pickedUnit(`${unitAt}/pause/unit`), pause: preset(P.pause) }),
              warpEffect(`${unitAt}/effect`, pickedUnit(`${unitAt}/effect/unit`), P.attachPointOrigin),
            ]),
            waitGame(where("played"), WARP_OUT_MS),
            // Removed with their effect, unless the Cleanup has removed them already.
            ...removeAll(where("gone"), held),
          ];
        }
      }
    })();
    return {
      ...ref(key, `${warpLabel[warp.kind]} Shot ${warp.index + 1} ${warpLabel[warp.kind]} ${warp.at + 1}`),
      events: [],
      actions: [...(warp.action.atMs ? [wait(where("wait"), warp.action.atMs)] : []), when(where("playing"), is(where("playing/if"), playing!, true), given)],
    };
  });
  const warpTriggerOf = new Map(warps.map((warp, n) => [`${warp.index}/${warp.kind}/${warp.at}`, warpTriggers[n]!] as const));
  // The final state a warp leaves, given in its place in the Cleanup's timeline (lastingSettled): the
  // units warped in (created now, with no effect, if a skip came first) with every effect killed,
  // each structure finished (the builder's order cancelled and the structure created if it wasn't
  // placed), and the units warped out removed.
  const warpSettled = (where: string, warp: (typeof warps)[number]): TriggerCall[] => {
    const step = (key: string): string => `${where}/${warp.kind}/${warp.index + 1}_${warp.at + 1}/${key}`;
    switch (warp.kind) {
      case "warpIn": {
        const { done } = warpIns.get(warp.action.id)!;
        // Its effects exist only once it has warped in; skipped before, there are none to kill.
        return [
          when(step("in"), is(step("in/if"), done, false), [...warpInCalls(step("in/create"), warp.action.id, false), set(step("in/done"), done, { kind: "bool", value: true })], killEffects(step("kill"), warp.action.id)),
        ];
      }
      case "build": {
        const { builder, owner, done } = builds.get(warp.action)!;
        const count = (key: string): TriggerParam["value"] => placedCount(step(key), warp.action, owner);
        return [
          when(step("finish"), is(step("finish/if"), done, false), [
            // Its order cancelled: told to stay where it is.
            when(step("finish/cancel"), call(step("finish/cancel/if"), F.comparison, { left: callValue(step("finish/cancel/if/alive"), F.unitIsAlive, { unit: builder(step("finish/cancel/if/alive/unit")) }), operator: preset(P.compareEqual), right: { kind: "bool", value: true } }), [
              call(step("finish/cancel/order"), F.unitIssueOrder, {
                unit: builder(step("finish/cancel/order/unit")),
                order: callValue(step("finish/cancel/order/order"), F.orderTargetingPoint, {
                  point: callValue(step("finish/cancel/order/order/point"), F.unitPosition, { unit: builder(step("finish/cancel/order/order/point/unit")) }),
                  abilityCommand: { kind: "abilcmd", ability: "move", target: "point" },
                }),
                queue: preset(P.orderQueueReplace),
              }),
            ]),
            when(
              step("finish/placed"),
              call(step("finish/placed/if"), F.comparison, { left: count("finish/placed/if/count"), operator: preset(P.compareEqual), right: { kind: "int", value: 0 } }),
              [
                call(step("finish/placed/create"), F.unitCreate, {
                  count: { kind: "int", value: 1 },
                  flags: preset(P.unitCreateFlagsNone),
                  player: { kind: "int", value: owner },
                  facing: { kind: "fixed", value: 270 },
                  unitType: typed(warp.action.unitType),
                  point: place(step("finish/placed/create/point"), warp.action.at),
                }),
              ],
              [finish(step("finish/placed/each"), warp.action, owner)],
            ),
            set(step("finish/done"), done, { kind: "bool", value: true }),
          ]),
        ];
      }
      case "warpOut": {
        // The units it took, or, if a skip came first, those it would have: a later unit stays.
        const { held, done } = warpOuts.get(warp.action)!;
        return [when(step("gather"), is(step("gather/if"), done, false), gather(step("gather/units"), warp.action)), set(step("done"), done, { kind: "bool", value: true }), ...removeAll(step("gone"), held)];
      }
    }
  };

  // Actor events: messages sent to a live unit's actor, or to each unit of a staged unit's group, at
  // a shot's cut, or atMs after it on a thread of its own while the shots play. Each with lasting
  // messages (a live unit's only) records that it was sent, and the Cleanup sends those of each
  // that wasn't (a skip came first), in the order they'd have come, to a unit still alive. Effects
  // play once and are never sent again.
  const actorEvents = shots
    .flatMap((shot, index) => (shot.actorEvents ?? []).map((event, n) => ({ event, index, n, sent: event.messages && event.unit !== undefined ? variable(`actor_event_${index + 1}_${n + 1}`) : undefined })))
    .sort((a, b) => a.index - b.index || (a.event.atMs ?? 0) - (b.event.atMs ?? 0) || a.n - b.n);
  const sendAll = (where: string, unit: TriggerParam["value"], messages: readonly string[]): TriggerCall[] =>
    messages.map((message, k) => call(`${where}/${k}`, F.sendActorMessageToUnit, { unit, message: { kind: "actormsg", value: message } }));
  const actorEventCalls = (where: string, { event, sent }: (typeof actorEvents)[number]): TriggerCall[] => {
    if (event.cast !== undefined) return [eachOf(`${where}/cast`, castGroups.get(event.cast)!, (unitAt) => sendAll(`${unitAt}/effects`, pickedUnit(`${unitAt}/unit`), event.effects ?? []))];
    const sending = [...sendAll(`${where}/messages`, unitOf(event.unit!), event.messages ?? []), ...sendAll(`${where}/effects`, unitOf(event.unit!), event.effects ?? [])];
    const record = sent ? [set(`${where}/sent`, sent, { kind: "bool", value: true })] : [];
    // A Wave's unit not there yet may come during the scene, so it's sent only once it is, and the
    // Cleanup sends it if it never was.
    return isWaveUnit(blueprint, event.unit!) ? [ifAlive(`${where}/there`, event.unit!, [...sending, ...record])] : [...sending, ...record];
  };
  const actorEventAt = new Map(actorEvents.map((sending) => [`${sending.index}/${sending.n}`, sending] as const));
  const actorEventTriggers = new Map(
    actorEvents.flatMap((sending) => {
      if (!sending.event.atMs) return [];
      const key = `actor-events/${sending.index + 1}_${sending.n + 1}`;
      const trigger: Trigger = {
        ...ref(key, `Actor Event Shot ${sending.index + 1} Event ${sending.n + 1}`),
        events: [],
        actions: [wait(at(`${key}/wait`), sending.event.atMs), when(at(`${key}/playing`), is(at(`${key}/playing/if`), playing!, true), actorEventCalls(at(`${key}/send`), sending))],
      };
      return [[`${sending.index}/${sending.n}`, trigger] as const];
    }),
  );

  // Unit changes: a live unit given an owner and behaviours at a shot's cut, or atMs after it on a
  // thread of its own while the shots play, each recording that it was given. All of it is lasting,
  // so the Cleanup gives each that wasn't (a skip came first) to a unit still alive.
  const unitChanges = shots
    .flatMap((shot, index) => (shot.unitChanges ?? []).map((change, n) => ({ change, index, n, changed: variable(`unit_change_${index + 1}_${n + 1}`) })))
    .sort((a, b) => a.index - b.index || (a.change.atMs ?? 0) - (b.change.atMs ?? 0) || a.n - b.n);
  const behavior = (id: string): TriggerParam["value"] => ({ kind: "gamelink", gameType: "Behavior", value: id });
  const changeUnit = (where: string, change: TriggerSceneUnitChange): TriggerCall[] => [
    ...(change.owner !== undefined ? [call(`${where}/owner`, F.unitSetOwner, { unit: unitOf(change.unit), player: { kind: "int", value: change.owner }, color: preset(P.changeColor) })] : []),
    ...(change.removeBehaviors ?? []).map((id, k) => call(`${where}/remove/${k}`, F.removeBehavior, { unit: unitOf(change.unit), behavior: behavior(id), count: { kind: "int", value: 1 } })),
    ...(change.addBehaviors ?? []).map((id, k) => call(`${where}/add/${k}`, F.addBehavior, { unit: unitOf(change.unit), behavior: behavior(id), caster: unitOf(change.unit), count: { kind: "int", value: 1 } })),
  ];
  // Given to a unit still alive, as the Cleanup gives it: one killed before its moment has nothing
  // to change. A Wave's unit not there yet may come during the scene, so it's given only once it
  // is, and the Cleanup gives it if it never was.
  const unitChangeCalls = (where: string, { change, changed }: (typeof unitChanges)[number]): TriggerCall[] => {
    const record = set(`${where}/changed`, changed, { kind: "bool", value: true });
    if (isWaveUnit(blueprint, change.unit)) return [ifAlive(`${where}/alive`, change.unit, [...changeUnit(`${where}/alive`, change), record])];
    return [ifAlive(`${where}/alive`, change.unit, changeUnit(`${where}/alive`, change)), record];
  };
  const unitChangeAt = new Map(unitChanges.map((changing) => [`${changing.index}/${changing.n}`, changing] as const));
  const unitChangeTriggers = new Map(
    unitChanges.flatMap((changing) => {
      if (!changing.change.atMs) return [];
      const key = `unit-changes/${changing.index + 1}_${changing.n + 1}`;
      const trigger: Trigger = {
        ...ref(key, `Unit Change Shot ${changing.index + 1} Change ${changing.n + 1}`),
        events: [],
        actions: [wait(at(`${key}/wait`), changing.change.atMs), when(at(`${key}/playing`), is(at(`${key}/playing/if`), playing!, true), unitChangeCalls(at(`${key}/change`), changing))],
      };
      return [[`${changing.index}/${changing.n}`, trigger] as const];
    }),
  );
  // The lasting state Zone orders, actor events, unit changes and warps leave, given in the Cleanup
  // in the order the scene gives it: by shot, then atMs, then at one moment a shot's orders, its
  // actor events, its unit changes and its warps, as its cut gives them. So a unit given away before
  // its old player's army warps out stays, as one given to a player after it does, and a Zone order
  // takes the units the Zone held at its moment. Each actor event and unit change only if a skip
  // came before it, to a unit still alive.
  const ACTOR_EVENT = 0;
  const UNIT_CHANGE = 1;
  // A Zone order's units, in the Cleanup: each a later order takes left out, so it ends where that
  // order sends it (the Cleanup has landed the live units already).
  const afterOrder = (where: string, given: TriggerSceneOrder): TriggerCall[] => {
    const { held } = zoneOrders.get(given)!;
    const orders = timedOrders.slice(timedOrders.findIndex(({ order }) => order === given) + 1);
    return [
      ...orders.flatMap(({ order }) => {
        const other = zoneOrders.get(order);
        return other ? [call(`${where}/${other.key}`, F.unitGroupRemoveUnitGroup, { target: of(held), source: of(other.held) })] : [];
      }),
      ...[...new Set(orders.flatMap(({ order }) => order.units ?? []))].map((unit) => call(`${where}/${unit}`, F.unitGroupRemove, { group: of(held), unit: unitOf(unit) })),
    ];
  };
  // A Zone order's final state, at its own moment in the Cleanup's timeline (lastingSettled): on a
  // skip before it, the units it would have taken, those in the Zone once what came before it is in
  // place (and nothing after it is, so a later warp-in or owner change neither adds to nor takes
  // from it); then its units removed if they withdraw, else landed at its place.
  const zoneSettled = (where: string, given: TriggerSceneOrder): TriggerCall[] => {
    const { key, held, done } = zoneOrders.get(given)!;
    return [
      when(`${where}/${key}/gather`, is(`${where}/${key}/gather/if`, done, false), [...gatherZone(`${where}/${key}/gather/units`, given), set(`${where}/${key}/gathered`, done, { kind: "bool", value: true })]),
      ...afterOrder(`${where}/${key}/after`, given),
      ...(given.withdraw ? [eachOf(`${where}/${key}/gone`, held, (unitAt) => [call(unitAt, F.unitRemove, { unit: pickedUnit(`${unitAt}/unit`) })])] : spiral(`${where}/${key}/land`, given)),
      call(`${where}/${key}/clear`, F.unitGroupClear, { group: of(held) }),
    ];
  };
  const ZONE_ORDER = -1;
  const WARP = 2;
  const lastingSettled = (where: string, warpsWhere: string): TriggerCall[] =>
    [
      ...timedOrders.flatMap(({ order, index }, n) => (zoneOrders.has(order) ? [{ index, atMs: order.atMs ?? 0, rank: ZONE_ORDER, n, calls: zoneSettled(`${where}/zones`, order) }] : [])),
      ...warps.map((warp, n) => ({ index: warp.index, atMs: warp.action.atMs ?? 0, rank: WARP, n, calls: warpSettled(warpsWhere, warp) })),
      ...actorEvents.flatMap(({ event, index, n, sent }) => {
        if (!sent) return [];
        const step = `${where}/actorEvents/${index + 1}_${n + 1}`;
        return [{ index, atMs: event.atMs ?? 0, rank: ACTOR_EVENT, n, calls: [when(step, is(`${step}/if`, sent, false), [ifAlive(`${step}/alive`, event.unit!, sendAll(`${step}/alive/messages`, unitOf(event.unit!), event.messages!))])] }];
      }),
      ...unitChanges.map(({ change, index, n, changed }) => {
        const step = `${where}/unitChanges/${index + 1}_${n + 1}`;
        return { index, atMs: change.atMs ?? 0, rank: UNIT_CHANGE, n, calls: [when(step, is(`${step}/if`, changed, false), [ifAlive(`${step}/alive`, change.unit, changeUnit(`${step}/alive`, change))])] };
      }),
    ]
      .sort((a, b) => a.index - b.index || a.atMs - b.atMs || a.rank - b.rank || a.n - b.n)
      .flatMap(({ calls }) => calls);
  const music = sceneMusic(scene, path, name, variable, afterCinematic);

  const setupTrigger: Trigger = {
    ...setup,
    events: [],
    actions: [
      // At once, never waiting for an in-play line: the scene may be time-critical. The in-play line
      // playing is cut off and replayed after the scene (ADR 0013).
      ...hold.take(at("setup/take"), number),
      // Played again while its lines after the handback still play, it stops them: it plays them afresh.
      ...(lineSent ? [call(at("setup/stopLines"), F.triggerStop, { trigger: { kind: "trigger", trigger: after } })] : []),
      ...(momentHeld ? [hold.afterHandbackMoment!.stopped(at("setup/stopLines/moment"), momentHeld)] : []),
      // Opening with no fade, the scene starts in the player's sight: Cinematic Mode comes on over the
      // ease the Cinematic trigger starts straight after, the two sharing one duration (as H2's do).
      ...(ease === undefined ? [fade(at("setup/black"), false, 0, true)] : []),
      cinematicMode(at("setup/cinematicMode"), true, ease ?? 0),
      // Cinematic Mode letterboxes; a full screen drops the bars.
      call(at("setup/fullscreen"), F.setScreenMode, { players: players(at("setup/fullscreen")), mode: preset(P.screenModeFullscreen), duration: { kind: "fixed", value: 0 } }),
      ...music.setup,
      ...world.setup(at),
      set(at("setup/aiWasPaused"), aiWasPaused, callValue(at("setup/aiWasPaused/value"), F.aiTimeIsPaused, {})),
      pauseAI(at("setup/pauseAI"), true),
      call(at("setup/lockCamera"), F.cameraLockInput, { player, lock: preset(P.lockInput) }),
      // The camera the player had, for a handback that restores it; after a trigger scene, the one it saved.
      cameraSaved
        ? when(at("setup/saveCamera/unlessSaved"), is(at("setup/saveCamera/unlessSaved/if"), cameraSaved, false), [call(at("setup/saveCamera"), F.cameraSave, { player })])
        : call(at("setup/saveCamera"), F.cameraSave, { player }),
      set(at("setup/completed"), completed, { kind: "bool", value: false }),
      // Before the skip's branch, so a scene skipped from the Cinematic before it lands its marks too.
      ...toMarks(at("setup/marks")),
      // Nothing warped yet this run, so a skip has Cleanup land every warp (a scene may play again),
      // and a warp-in's group holds only this run's units, the first of them its builder.
      ...[...warpIns].flatMap(([warpIn, { units, done }]) => [set(at(`setup/warps/in/${warpIn}`), done, { kind: "bool", value: false }), call(at(`setup/warps/in/${warpIn}/clear`), F.unitGroupClear, { group: of(units) })]),
      ...[...builds.values(), ...warpOuts.values()].map(({ done }, n) => set(at(`setup/warps/done/${n}`), done, { kind: "bool", value: false })),
      // No Zone gathered yet this run, so a skip has Cleanup gather each.
      ...[...zoneOrders.values()].map(({ key, done }) => set(at(`setup/zoneOrders/${key}`), done, { kind: "bool", value: false })),
      // Nothing sent yet this run, so a skip has Cleanup send it (a scene may play again).
      ...actorEvents.flatMap(({ index, n, sent }) => (sent ? [set(at(`setup/actorEvents/${index + 1}_${n + 1}`), sent, { kind: "bool", value: false })] : [])),
      ...unitChanges.map(({ index, n, changed }) => set(at(`setup/unitChanges/${index + 1}_${n + 1}`), changed, { kind: "bool", value: false })),
      // Skipped in the Cinematic before it: straight to the cleanup.
      when(at("setup/unskipped"), is(at("setup/unskipped/if"), skipped, false), [
        ...stage(at("setup/cast")),
        ...setAside(at("setup/live")),
        ...(playing ? [set(at("setup/playing"), playing, { kind: "bool", value: true })] : []),
        execute(at("setup/runCinematic"), cinematic),
        execute(at("setup/runEnd"), end),
      ]),
      execute(at("setup/runCleanup"), cleanup),
    ],
  };

  // The shots: each cuts to its camera (unless the shot before ended on it), starts its move over its
  // whole length, then plays its lines, waited, and holds its pause. The first cut and its move are
  // made under black, before the skippable begin and the fade in (T1). Opening with no fade, the
  // first shot's camera is eased to from the player's over the ease, skippable from its start, and
  // its move starts once the ease has reached it, over the rest of the shot.
  const shotCalls: TriggerCall[] = [];
  const laterTriggers: Trigger[] = [];
  shots.forEach((shot, index) => {
    const step = (key: string): string => at(`cinematic/shots/${index}/${key}`);
    const before = shots[index - 1];
    if (index > 0 && shot.afterMs) shotCalls.push(wait(step("after"), shot.afterMs));
    if (!before || !sameFraming(shotEnd(before), shotStart(shot))) shotCalls.push(...applyCamera(step("cut"), shotStart(shot), index === 0 ? (ease ?? 0) : 0));
    (shot.orders ?? []).forEach((given, n) => {
      if (!given.atMs) {
        shotCalls.push(...orderCalls(step(`orders/${n}`), given));
        return;
      }
      // Later in the shot: on a thread of its own, so the lines play on beside it.
      const key = `orders/${index + 1}_${n + 1}`;
      const later = ref(key, `Order Shot ${index + 1} Order ${n + 1}`);
      laterTriggers.push({ ...later, events: [], actions: [wait(at(`${key}/wait`), given.atMs), when(at(`${key}/playing`), is(at(`${key}/playing/if`), playing!, true), orderCalls(at(`${key}/order`), given))] });
      shotCalls.push(call(step(`orders/${n}`), F.triggerExecute, { checkConditions: preset(P.checkConditions), wait: preset(P.dontWait), trigger: { kind: "trigger", trigger: later } }));
    });
    (shot.actorEvents ?? []).forEach((_, n) => {
      const later = actorEventTriggers.get(`${index}/${n}`);
      if (later) shotCalls.push(call(step(`actorEvents/${n}`), F.triggerExecute, { checkConditions: preset(P.checkConditions), wait: preset(P.dontWait), trigger: { kind: "trigger", trigger: later } }));
      else shotCalls.push(...actorEventCalls(step(`actorEvents/${n}`), actorEventAt.get(`${index}/${n}`)!));
    });
    (shot.unitChanges ?? []).forEach((_, n) => {
      const later = unitChangeTriggers.get(`${index}/${n}`);
      if (later) shotCalls.push(call(step(`unitChanges/${n}`), F.triggerExecute, { checkConditions: preset(P.checkConditions), wait: preset(P.dontWait), trigger: { kind: "trigger", trigger: later } }));
      else shotCalls.push(...unitChangeCalls(step(`unitChanges/${n}`), unitChangeAt.get(`${index}/${n}`)!));
    });
    // The warps after them, so an owner given at the cut is the one a warp-out takes the army by.
    for (const kind of ["warpIn", "build", "warpOut"] as const) {
      const listed = { warpIn: shot.warpIns, build: shot.builds, warpOut: shot.warpOuts }[kind] ?? [];
      listed.forEach((_, n) => {
        const trigger = warpTriggerOf.get(`${index}/${kind}/${n}`)!;
        shotCalls.push(call(step(`${kind}/${n}`), F.triggerExecute, { checkConditions: preset(P.checkConditions), wait: preset(P.dontWait), trigger: { kind: "trigger", trigger } }));
      });
    }
    const moves = shot.to !== undefined || shot.toUnit !== undefined;
    const eased = index === 0 && ease !== undefined;
    if (moves && !eased) shotCalls.push(...applyCamera(step("move"), shotEnd(shot), scene.shots[index]!.durationMs, shot.move));
    if (index === 0) {
      shotCalls.push(
        call(at("cinematic/skippable"), F.triggerSkippableBegin, {
          players: players(at("cinematic/skippable")),
          requiredCount: preset(P.skipAllPlayers),
          onSkip: preset(P.noTrigger),
          checkConditions: preset(P.checkConditions),
          wait: preset(P.dontWait),
        }),
        ease === undefined ? fade(at("cinematic/fadeIn"), true, TIMES.fadeInMs, true) : wait(at("cinematic/ease"), ease),
      );
    }
    if (moves && eased) shotCalls.push(...applyCamera(step("move"), shotEnd(shot), scene.shots[index]!.durationMs - ease, shot.move));
    shotCalls.push(...scene.shots[index]!.lines.flatMap((line) => [...music.onLine(line.soundId), ...hold.sceneLine(at(`cinematic/lines/${line.lineId}`), transmission(line, `${path}/`, castSpeaker(line)))]));
    if (shot.pauseAfterMs) shotCalls.push(wait(step("pause"), shot.pauseAfterMs));
  });
  const cinematicTrigger: Trigger = { ...cinematic, events: [], actions: [...music.start, ...shotCalls, set(at("cinematic/completed"), completed, { kind: "bool", value: true })] };

  // Watched to the end, a handback with no fade has no fade out either; a skip fades as any scene's
  // does. Handing on, it fades out all the same: the next scene starts under black, which would cut.
  const faded = handback?.fade !== false;
  const watchedFade = fade(at("end/fade/watched"), false, TIMES.fadeOutMs, true);
  const watchedEnd = faded ? [watchedFade] : handingOn ? [when(at("end/fade/handOn"), is(at("end/fade/handOn/if"), handingOn, true), [watchedFade])] : [];
  const endTrigger: Trigger = {
    ...end,
    events: [],
    actions: [
      ...music.end,
      // Watched, every timed action has started by now; skipped, none starts in the fade out.
      ...(playing ? [set(at("end/playing"), playing, { kind: "bool", value: false })] : []),
      when(at("end/fade"), is(at("end/fade/if"), completed, true), watchedEnd, [fade(at("end/fade/skipped"), false, TIMES.skippedFadeOutMs, true)]),
    ],
  };

  // The handback: the gameplay camera, Cinematic Mode off and the fade in share one duration (H2),
  // and the cleanup waits for the fade, so what the cue plays next starts once control is back. With
  // no fade, a watched scene leaves the camera where its last shot left it (an intended H3
  // exception), and a skipped one lands there too, so both end in the one final state.
  const last = shots[shots.length - 1]!;
  const handbackCalls = (key: string, ms: number, watched: boolean): TriggerCall[] => {
    const camera = handback?.camera ?? (faded ? undefined : (last.to ?? last.camera));
    // Waited, as the fade in is: turning Cinematic Mode off clears any Transmission (T6), so the lines after wait for it.
    if (!faded && watched) return [cinematicMode(at(`cleanup/${key}/cinematicMode`), false, ms), wait(at(`cleanup/${key}/settle`), ms)];
    return [
      ...(camera !== undefined
        ? applyCamera(at(`cleanup/${key}/camera`), { camera }, ms)
        : [call(at(`cleanup/${key}/camera`), F.cameraRestore, { player, duration: seconds(ms), velocity: { kind: "fixed", value: -1 }, deceleration: { kind: "fixed", value: 10 } })]),
      cinematicMode(at(`cleanup/${key}/cinematicMode`), false, ms),
      fade(at(`cleanup/${key}/fadeIn`), true, ms, true),
    ];
  };
  // Straight after the handback, either way (H3): the pings, the objective, then the lines in play.
  const afterHandback: TriggerCall[] = [
    ...(handback?.ping ?? []).flatMap((anchorId) => {
      const where = at(`cleanup/ping/${anchorId}`);
      const ping = call(where, F.minimapPing, {
        players: players(where),
        point: callValue(`${where}/point`, F.unitPosition, { unit: unitValueOf(blueprint, anchorId) }),
        duration: { kind: "fixed", value: PING_SECONDS },
        // Green, a friendly ping (a wave's warning pings red).
        color: callValue(`${where}/color`, F.color, { r: { kind: "fixed", value: 0 }, g: { kind: "fixed", value: 100 }, b: { kind: "fixed", value: 0 } }),
      });
      return ifThere(`${where}/there`, anchorId, [ping]);
    }),
    ...(handback?.objective !== undefined
      ? [call(at("cleanup/objective"), F.objectiveShow, { objective: of(objectiveOf(handback.objective)), players: players(at("cleanup/objective")), show: preset(P.show) })]
      : []),
    ...(scene.afterHandback.length ? [execute(at("cleanup/lines"), after, false)] : []),
  ];
  function objectiveOf(objectiveId: string): TriggerVariable {
    const held = options.objective?.(objectiveId);
    if (!held) throw new Error(`Trigger scene ${id} issues objective ${objectiveId} at its handback, but no objective variable was given for it`);
    return held;
  }
  const cleanupTrigger: Trigger = {
    ...cleanup,
    events: [],
    actions: [
      // Every music cue stopped first, before anything waits (M4).
      ...music.stop,
      // A skip mid-line leaves the line playing; Cinematic Mode off would clear it anyway (T6), but
      // under black. Only the scene's own: no other line plays while it holds the lines.
      hold.clearSceneLine(at("cleanup/transmissions")),
      // An outro stays under black, locked and paused, for the victory.
      ...(outro ? [] : handbackCleanup()),
    ],
  };
  function handbackCleanup(): TriggerCall[] {
    return [
      ...music.cleanup,
      call(at("cleanup/unlockCamera"), F.cameraLockInput, { player, lock: preset(P.unlockInput) }),
      ...unstage(at("cleanup/cast")),
      // Landed while a hidden unit is still hidden, then shown where it ends.
      ...settle(at("cleanup/orders")),
      ...lastingSettled(at("cleanup"), at("cleanup/warps")),
      ...putBack(at("cleanup/live")),
      // The world back as the mission had it, still under black (L2); the reveals come after the handback.
      ...world.cleanup(at),
      when(at("cleanup/ai"), is(at("cleanup/ai/if"), aiWasPaused, false), [pauseAI(at("cleanup/ai/unpause"), false)]),
      ...unlessHandingOn([
        when(at("cleanup/handback"), is(at("cleanup/handback/if"), completed, true), handbackCalls("watched", TIMES.handbackMs, true), handbackCalls("skipped", TIMES.skippedHandbackMs, false)),
        // The mission music back (M4): always when the scene paused it, else after a Cinematic on the
        // same cue, which handed on with it paused for this handback to bring back.
        ...(music.unpause ? [soundtrackPause(at("cleanup/music"), false)] : [when(at("cleanup/music"), is(at("cleanup/music/if"), afterCinematic, true), [soundtrackPause(at("cleanup/music/unpause"), false)])]),
        ...afterHandback,
      ]),
      // The lines given back once control is back, or, handing on, for the next scene to take with
      // no wait between; with lines after the handback, after the last of them.
      ...(lineSent ? [] : [hold.giveBack(at("cleanup/giveBack"), number)]),
    ];
  }
  // Handing on, the screen stays black and Cinematic Mode on for the next scene, whose handback this is.
  // The camera unlock and AI time back above still run: the next scene's Setup follows on the same
  // thread with no wait (the cue's variable sets, then TriggerExecute), so no game time passes, no
  // frame draws and no input lands before it locks them again, and its Setup reads AI time as the
  // player had it, for its own cleanup to restore.
  function unlessHandingOn(calls: TriggerCall[]): TriggerCall[] {
    if (!handingOn) return calls;
    return [when(at("cleanup/unlessHandingOn"), is(at("cleanup/unlessHandingOn/if"), handingOn, false), calls), set(at("cleanup/handOn"), handingOn, { kind: "bool", value: false })];
  }
  // The lines after the handback, in play: Transmissions one after another, each waited, under the
  // scene's hold, so no in-play line cuts in. A trigger scene starting among them cuts off the one
  // playing, which is replayed once that scene has given the lines back; then they're given back.
  const linesTrigger: Trigger = {
    ...after,
    events: [],
    actions: [
      ...(momentHeld ? hold.afterHandbackMoment!.hold(at("lines/moment"), momentHeld) : []),
      ...scene.afterHandback.flatMap((line) => hold.afterHandbackLine(at(`lines/hold/${line.lineId}`), number, lineSent!, transmission(line, `${path}/lines/`))),
      ...(momentHeld ? hold.afterHandbackMoment!.release(at("lines/moment"), momentHeld) : []),
      hold.giveBack(at("lines/giveBack"), number),
    ],
  };

  return {
    triggers: [setupTrigger, cinematicTrigger, endTrigger, cleanupTrigger, ...(scene.afterHandback.length ? [linesTrigger] : []), ...music.triggers, ...laterTriggers, ...arrivalTriggers, ...warpTriggers, ...actorEventTriggers.values(), ...unitChangeTriggers.values()],
    variables: [completed, aiWasPaused, skipped, afterCinematic, ...(lineSent ? [lineSent] : []), ...(momentHeld ? [momentHeld] : []), ...(handingOn ? [handingOn] : []), ...(cameraSaved ? [cameraSaved] : []), ...(playing ? [playing] : []), ...castGroups.values(), ...[...withdrawals.values()].map(({ held }) => held),
      ...[...zoneOrders].flatMap(([given, { held, done }]) => [...(withdrawals.has(given) ? [] : [held]), done]),
      ...[...spirals.values()].flatMap(({ distance, angle }) => [distance, angle]),
      ...[...warpIns.values()].flatMap(({ units, done, effects }) => [units, done, ...effects]),
      ...[...builds.values()].map(({ done }) => done),
      ...[...warpOuts.values()].flatMap(({ held, done }) => [held, done]),
      ...actorEvents.flatMap(({ sent }) => (sent ? [sent] : [])),
      ...unitChanges.map(({ changed }) => changed),
      ...(hiddenUnits ? [hiddenUnits] : []), ...(pausedUnits ? [pausedUnits] : []), ...(cueUnit ? [cueUnit] : []), ...music.variables, ...world.variables],
    run: (runPath, { after: before, cueUnit: neared } = {}) => {
      if (cueUnit && !neared) throw new Error(`Trigger scene ${id} aims at its cue's unit, but a cue that plays it names none`);
      // Taking over from a run that handed on under black, it has no player's camera to ease from.
      if (before && ease !== undefined) {
        throw new Error(`Trigger scene ${id} plays straight after another scene on a cue, and opens on the black that scene hands on under, so it can't open with no fade: open it from black, or play it on its own`);
      }
      // Copied as the scene starts, straight after the run before on this thread, so it's this chain's skip.
      return [
        set(
          `${runPath}/skipped`,
          skipped,
          before ? callValue(`${runPath}/skipped/value`, F.comparison, { left: of(before.completed), operator: preset(P.compareEqual), right: { kind: "bool", value: false } }) : { kind: "bool", value: false },
        ),
        set(`${runPath}/afterCinematic`, afterCinematic, before ? before.musicPaused : { kind: "bool", value: false }),
        ...(cameraSaved ? [set(`${runPath}/cameraSaved`, cameraSaved, { kind: "bool", value: before?.cameraSaved ?? false })] : []),
        ...(cueUnit ? [set(`${runPath}/unit`, cueUnit, of(neared!))] : []),
        execute(runPath, setup),
      ];
    },
    outro,
    ...(handingOn ? { handOn: (handPath: string) => set(handPath, handingOn, { kind: "bool", value: true }), handsOnAs: { completed, musicPaused: music.unpause ? { kind: "bool", value: true } : of(afterCinematic), cameraSaved: true } } : {}),
  };
}
