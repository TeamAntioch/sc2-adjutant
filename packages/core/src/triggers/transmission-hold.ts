// Which lines may play while a trigger scene plays (#485, ADR 0013). A trigger scene starts the
// moment its cue fires, never waiting for an in-play line to end: it may be time-critical (a scene
// framing a strike that plays in data either way would miss it). So it pre-empts: its Setup takes
// the lines, cutting off only the in-play line playing, which is replayed once the scene, and its
// lines after the handback, have played; the rest of that line's cue follows it. Nothing else of
// the Mission's Transmissions is cut, and the scene's Cleanup clears only its own line.
//
// Only a Mission with trigger scenes has any of this: with none, nothing cuts an in-play line.
//
// A hero moment (#656, ui.heroMoment) never plays over an in-play line. When the Campaign Mod turns
// it on, each in-play line, held or not, tells the moment it's playing until it has played, through
// the moment's Hold Hero Moments For Line and Release Hero Moments After Line, so Begin Hero Moment
// waits for it; a line due while a moment plays waits until End Hero Moment. Galaxy's threads run
// until they wait, so the hold, the wait for its turn and the send are one step once the moment
// lets the line go. A trigger scene's lines in its shots need none of it, since a moment waits out
// cinematic mode; its lines after the handback, out of cinematic mode, hold moments off as one.

import { block, call, callValue, compare, ifThen, POLL_SECONDS, triggerVariable, wait, waitUntil } from "./trigger-builders.js";
import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P, SUB_FUNCTIONS } from "./trigger-catalog.js";
import type { TriggerCall, TriggerParam, TriggerVariable } from "./trigger-model.js";

/**
 * The lines' holder and the two lines a trigger scene can cut off, with what each line's calls run.
 * A line's `send` is its Transmission sent without waiting (an If around such sends, for a Wave's
 * unit, is one too): the hold keeps it, then waits for it.
 */
export type TransmissionHold = {
  readonly variables: readonly TriggerVariable[];
  /**
   * First in a trigger scene's Setup: scene `number` takes the lines, cutting off the in-play line
   * playing and any other scene's line after its handback, each of which is replayed after it.
   */
  readonly take: (path: string, number: number) => TriggerCall[];
  /** The lines given back, unless another scene has taken them since: last in the handback, or after the last line after it. */
  readonly giveBack: (path: string, number: number) => TriggerCall;
  /** A line of a trigger scene's shots: sent, kept as the scene's line, and waited for. */
  readonly sceneLine: (path: string, send: TriggerCall) => TriggerCall[];
  /** The Cleanup's cut: the scene's own line, if a skip left it playing, and no other. */
  readonly clearSceneLine: (path: string) => TriggerCall;
  /**
   * A line after scene `number`'s handback, played while it holds the lines: if another trigger
   * scene cuts it off, replayed once that scene has given them back, the scene taking them again.
   * `sent` is the scene's own flag.
   */
  readonly afterHandbackLine: (path: string, number: number, sent: TriggerVariable, send: TriggerCall) => TriggerCall[];
  /** An in-play script line: played once no trigger scene holds the lines, and replayed if one cuts it off. */
  readonly inPlayLine: (path: string, send: TriggerCall) => TriggerCall[];
  /**
   * With a hero moment (#656): a trigger scene's lines after its handback, which play out of
   * cinematic mode, hold moments off from before the first to after the last. `held` is the scene's
   * own flag that it holds them, so its Setup, stopping those lines to play them afresh, lets go of
   * just its own hold. None without the moment.
   */
  readonly afterHandbackMoment?: {
    /** First in the lines' trigger: waits while a moment plays, then holds moments off. */
    readonly hold: (path: string, held: TriggerVariable) => TriggerCall[];
    /** Last in the lines' trigger: lets moments play again. */
    readonly release: (path: string, held: TriggerVariable) => TriggerCall[];
    /** Straight after the Setup stops the lines' trigger: lets go of its hold, if it held them. */
    readonly stopped: (path: string, held: TriggerVariable) => TriggerCall;
  };
};

/** What an in-play line calls of the hero moment, when the Campaign Mod turns ui.heroMoment on (ui/hero-moment.ts). */
export type MomentLines = {
  /** First in a line's turn: waits while a moment plays, then holds moments off. */
  readonly hold: (path: string) => TriggerCall;
  /** Once the line has played: lets moments play again. */
  readonly release: (path: string) => TriggerCall;
};

/** An in-play line no trigger scene can cut off (`send` sent and waited for), held from moments while it plays. */
export const momentLine = (path: string, send: TriggerCall, moment: MomentLines): TriggerCall[] => [moment.hold(`${path}/moment/hold`), send, moment.release(`${path}/moment/release`)];

/** No trigger scene holds the lines. */
const NONE = 0;

export function transmissionHold(moment?: MomentLines): TransmissionHold {
  const variable = (key: string, type: TriggerVariable["type"]): TriggerVariable =>
    triggerVariable(
      `script/variables/${key}`,
      `script_${key}`,
      type,
      type === "transmission" ? { kind: "preset", preset: P.noTransmission } : type === "int" ? { kind: "int", value: NONE } : { kind: "bool", value: false },
    );
  // The number of the trigger scene holding the lines, from its Setup to its handback, or to its
  // last line after it: none (0), or one of the Mission's trigger scenes, numbered from 1.
  const holder = variable("trigger_scene", "int");
  // The in-play line sent last, whether a trigger scene cut it off, and whether it has played: one
  // at a time, since in-play script scenes queue on script_transmissions_playing.
  const inPlay = variable("line", "transmission");
  const inPlayCut = variable("line_cut", "bool");
  const inPlaySent = variable("line_sent", "bool");
  // A trigger scene's line sent last, shot or after the handback, and whether another cut it off:
  // one at a time, since only the scene holding the lines plays one.
  const scene = variable("trigger_scene_line", "transmission");
  const sceneCut = variable("trigger_scene_line_cut", "bool");

  const of = (held: TriggerVariable): TriggerParam["value"] => ({ kind: "variable", variable: held });
  const preset = (value: (typeof P)[keyof typeof P]): TriggerParam["value"] => ({ kind: "preset", preset: value });
  const bool = (value: boolean): TriggerParam["value"] => ({ kind: "bool", value });
  const int = (value: number): TriggerParam["value"] => ({ kind: "int", value });
  const set = (path: string, held: TriggerVariable, value: TriggerParam["value"]): TriggerCall => call(path, F.setVariable, { variable: of(held), value });
  const loop = (path: string, conditions: TriggerCall[], calls: TriggerCall[]): TriggerCall =>
    block(path, F.whileLoop, {}, [
      { type: SUB_FUNCTIONS.whileConditions, calls: conditions },
      { type: SUB_FUNCTIONS.whileActions, calls },
    ]);
  // Sent without waiting, kept, then waited: a skip or a cut ends the wait, and the kept id is what's cut.
  const played = (path: string, send: TriggerCall, kept: TriggerVariable): TriggerCall[] => [
    send,
    set(`${path}/kept`, kept, callValue(`${path}/kept/value`, F.transmissionLastSent, {})),
    call(`${path}/wait`, F.transmissionWait, { transmission: of(kept), offset: { kind: "fixed", value: 0 } }),
  ];
  // A cut line's own thread replays it: once it has its turn, it sends the line again, from the top,
  // until one plays to its end uncut.
  const replayed = (path: string, until: TriggerVariable, turn: TriggerCall[], kept: TriggerVariable, cut: TriggerVariable, send: TriggerCall): TriggerCall[] => [
    set(`${path}/unsent`, until, bool(false)),
    loop(path, [compare(`${path}/until`, of(until), P.compareEqual, bool(false))], [
      ...turn,
      set(`${path}/uncut`, cut, bool(false)),
      ...played(path, send, kept),
      set(`${path}/sent`, until, callValue(`${path}/sent/value`, F.comparison, { left: of(cut), operator: preset(P.compareEqual), right: bool(false) })),
    ]),
  ];
  // A line still playing cut off, its thread told so; one that has ended is left be.
  const cutOff = (path: string, kept: TriggerVariable, cut: TriggerVariable): TriggerCall =>
    ifThen(path, compare(`${path}/if`, callValue(`${path}/if/complete`, F.transmissionIsComplete, { transmission: of(kept) }), P.compareEqual, bool(false)), [
      call(`${path}/clear`, F.transmissionClear, { transmission: of(kept) }),
      set(`${path}/cut`, cut, bool(true)),
    ]);

  return {
    variables: [holder, inPlay, inPlayCut, inPlaySent, scene, sceneCut],
    take: (path, number) => [set(`${path}/holder`, holder, int(number)), cutOff(`${path}/inPlay`, inPlay, inPlayCut), cutOff(`${path}/scene`, scene, sceneCut)],
    giveBack: (path, number) => ifThen(path, compare(`${path}/if`, of(holder), P.compareEqual, int(number)), [set(`${path}/none`, holder, int(NONE))]),
    sceneLine: (path, send) => played(path, send, scene),
    clearSceneLine: (path) => call(path, F.transmissionClear, { transmission: of(scene) }),
    // Its turn: while another scene holds the lines, it waits; then it holds them again, cutting off
    // an in-play line that started between that scene's handback and now.
    afterHandbackLine: (path, number, sent, send) =>
      replayed(
        path,
        sent,
        [
          loop(`${path}/turn`, [compare(`${path}/turn/other`, of(holder), P.compareNotEqual, int(NONE)), compare(`${path}/turn/notOwn`, of(holder), P.compareNotEqual, int(number))], [wait(`${path}/turn/wait`, POLL_SECONDS)]),
          set(`${path}/turn/holder`, holder, int(number)),
          cutOff(`${path}/turn/inPlay`, inPlay, inPlayCut),
        ],
        scene,
        sceneCut,
        send,
      ),
    // Held from moments first, so none begins while it waits for its turn, and released once it
    // has played uncut.
    inPlayLine: (path, send) => [
      ...replayed(
        path,
        inPlaySent,
        [...(moment ? [moment.hold(`${path}/moment/hold`)] : []), waitUntil(`${path}/turn`, compare(`${path}/turn/free`, of(holder), P.compareEqual, int(NONE)))],
        inPlay,
        inPlayCut,
        send,
      ),
      ...(moment ? [moment.release(`${path}/moment/release`)] : []),
    ],
    // The hold, the flag and the release with no wait between, so the flag is true just while the scene holds moments off.
    ...(moment
      ? {
          afterHandbackMoment: {
            hold: (path, held) => [moment.hold(`${path}/hold`), set(`${path}/held`, held, bool(true))],
            release: (path, held) => [set(`${path}/unheld`, held, bool(false)), moment.release(`${path}/release`)],
            stopped: (path, held) => ifThen(path, compare(`${path}/if`, of(held), P.compareEqual, bool(true)), [set(`${path}/unheld`, held, bool(false)), moment.release(`${path}/release`)]),
          },
        }
      : {}),
  };
}
