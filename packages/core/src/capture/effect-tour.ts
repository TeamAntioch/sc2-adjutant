// The effect tour: films the game's effect models (Assets/Effects) in the game itself, for an
// effects gallery (sc2-asset-catalog docs/effects-gallery.md). A batch map holds one CModel per
// effect file and a script that, for each effect in turn, attaches it to a host unit on a pad,
// films its Birth, its Stand, the host moving (do its particles trail?), a plain Destroy (do they
// linger?) and its Death, and announces each frame in bank "FxTour" for the Host Adapter's capture
// to screenshot. A renderer can't show this: Blender and WhiteoutFlakes draw no particles.
//
// Each effect's timing comes from its own animations and its framing from its bounds, both read
// from the .m3 (catalog/m3-sequences.ts, m3-footprint.ts). Where it is attached, and whether it is
// moved fast, comes from where the game attaches it (data/effect-sites.json, scripts/build-effect-sites.mjs).

import { PLAYER_CAMERA } from "./area-tour.js";
import { galaxyString } from "./capture-copy.js";
import type { M3Sequence } from "../catalog/m3-sequences.js";

/** The bank the effect tour saves, with int key `stop`. */
export const EFFECT_TOUR_BANK = "FxTour";
/** The tour's Custom Script element and its init function. */
export const EFFECT_TOUR_SCRIPT_ID = "F7700001";
export const EFFECT_TOUR_INIT = "FxTour_Init";

type Vec3 = readonly [number, number, number];

/**
 * Where the game attaches an effect model, from data/effect-sites.json: the site most of its uses
 * name (null when nothing says; `guessed` from its CModel parents, ImpactFX or LaunchFX, with no
 * use), whether it is a missile and how many ribbons it has.
 */
export type EffectPlacement = { readonly site: string | null; readonly guessed?: boolean; readonly missile?: boolean; readonly ribbons?: number };

/** One effect model to film: its storage path, its animations, its bounds (cells, in its own frame) and where the game attaches it. */
export type TourEffect = {
  readonly file: string;
  readonly sequences: readonly M3Sequence[];
  readonly min: Vec3;
  readonly max: Vec3;
  readonly placement?: EffectPlacement;
};

/** The host model's attachment points, each with its height above the host's origin in the bind pose (data/effect-sites.json `hosts`). */
export type HostSites = Readonly<Record<string, number>>;

/** What a frame shows. */
export type EffectShotLabel = "birth" | "stand" | "moving" | "after-destroy" | "death";

/** A frame the tour takes: its stop number (the bank's `stop`, and the frame's file name), the effect and what it shows. */
export type EffectShot = { readonly stop: number; readonly effect: number; readonly file: string; readonly label: EffectShotLabel };

/** How one effect is filmed: seconds of game time, and the camera. Zero skips a part. */
export type EffectPlan = {
  /** Half its Birth, when the birth frame is taken; then the rest of it. */
  readonly birth: number;
  /** Into Stand when the stand frame is taken. */
  readonly standShot: number;
  /** Whether Stand loops; one that plays once is filmed half way through (`standShot` is half of it). */
  readonly standLoops: boolean;
  /** How long the host moves before the moving frame; 0 for an effect too short to move. */
  readonly move: number;
  /** How far it moves in that time, in cells. */
  readonly moveCells: number;
  /**
   * Moved fast, turned to face the way it goes: a missile, or a model with ribbons, whose trail
   * forms only at a missile's speed. The camera pulls back to `moveDistance` and follows.
   */
  readonly fast: boolean;
  /** The camera's distance while it moves. */
  readonly moveDistance: number;
  /** How far the host gets from the pad before the camera follows it, in cells: a quarter of the frame's width, so a trail has the rest behind it. */
  readonly lead: number;
  /** The host's attachment point it is attached at. */
  readonly site: string;
  /** Half its Death, when the death frame is taken; 0 when it has none. */
  readonly death: number;
  /**
   * An animation to play as soon as it's made: the only one a model has when it has neither Birth
   * nor Stand (an impact with only Death), which the game's bracket wouldn't play; "" for none.
   */
  readonly play: string;
  /**
   * A loop to play as Birth ends, for a model with Birth whose loop isn't named Stand (`GLstand`),
   * which the bracket wouldn't play; "" for none. The stand frame is taken that far into it.
   */
  readonly loop: string;
  /** The camera: distance (cells) and the height it looks at, above the pad. */
  readonly distance: number;
  readonly height: number;
  /** Each frame's stop, 0 when the frame isn't taken. */
  readonly stops: Readonly<Record<EffectShotLabel, number>>;
};

/** The camera's pitch: three quarters from above, as effects are seen in play but with more of their height. */
export const EFFECT_PITCH = 40;
/** How much more than the effect's bounds the frame holds: bounds seldom cover all the particles. */
export const FRAME_MARGIN = 1.3;
/** The closest and farthest the camera goes. */
const MIN_DISTANCE = 6;
const MAX_DISTANCE = 70;
/** The longest wait into a part: a 30 s Birth is filmed 4 s in. */
const MAX_PART = 4;
/** An animation under this long is a flash; one this long or longer has time to move in. */
const MOVE_MIN = 1.5;
/** A fast move: cells a second, near a slow missile's (a Phoenix's is 15, a Stalker's 10), for how long. */
export const FAST_SPEED = 10;
export const FAST_MOVE = 2;
/** The closest the camera is while a fast move films a trail. */
const FAST_DISTANCE = 12;
/** The site every host has, and the one a site the host lacks falls back to. */
const ORIGIN = "Ref_Origin";
const CENTER = "Ref_Center";

/**
 * Where to attach an effect on the host: a missile at Ref_Center, as it flies round its own centre;
 * else the site the game attaches it at, guessed or not; Ref_Origin when nothing says. A site the
 * host lacks is Ref_Center. `hostSites` unset doesn't check.
 */
export function attachSite(placement: EffectPlacement | undefined, hostSites?: HostSites): string {
  const wanted = placement?.missile ? CENTER : (placement?.site ?? ORIGIN);
  if (!hostSites || wanted === ORIGIN || wanted in hostSites) return wanted;
  return CENTER in hostSites ? CENTER : ORIGIN;
}

/**
 * How high a site is on the host, for framing: its bind-pose height, but no lower than Ref_Center
 * for a raised one, since a weapon bone rests at the feet in the bind pose (the Marine's) and is
 * held up in Stand.
 */
function siteHeight(site: string, hostSites?: HostSites): number {
  if (site === ORIGIN || !hostSites) return 0;
  return Math.max(hostSites[site] ?? 0, hostSites[CENTER] ?? 0);
}

const animation = (sequences: readonly M3Sequence[], name: string): M3Sequence | undefined =>
  sequences.find((sequence) => sequence.name.toLowerCase() === name.toLowerCase()) ?? sequences.find((sequence) => sequence.name.toLowerCase().startsWith(`${name.toLowerCase()} `));

/** A model's loop when it has no Stand: its first looping animation not named Birth or Death (`GLstand`). */
const otherLoop = (sequences: readonly M3Sequence[]): M3Sequence | undefined =>
  sequences.find((sequence) => sequence.looping && !/^(birth|death)( |$)/i.test(sequence.name));

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * Plans one effect: which frames it gets and when. The game plays a generic model actor's
 * animations as a bracket, Birth, then Stand (looping), then Death once the bracket is stopped,
 * so the plan follows the animations the file has:
 * - `birth` half way through Birth, when it has one;
 * - `stand` a second into a looping Stand, or half way through one that plays once (a one-shot);
 * - `moving` after the host has moved sideways for a second, when Stand loops or lasts long enough;
 * - `after-destroy` half a second after a plain Destroy, which shows particles left in the world;
 * - `death` half way through Death, on a fresh copy whose bracket is stopped, when it has one.
 * A model with no Stand that loops under another name (`GLstand`) has that loop played instead:
 * as Birth ends, or at once when it has no Birth either.
 * It is attached where the game attaches it (attachSite), and the camera looks at that point. A
 * missile or a model with ribbons moves fast (FAST_SPEED for FAST_MOVE seconds) with the camera
 * pulled back and following, so a trail has room to form.
 * `firstStop` is the first stop number; the plan numbers its frames on from it.
 */
export function planEffect(effect: TourEffect, firstStop: number, hostSites?: HostSites): EffectPlan {
  const birth = animation(effect.sequences, "Birth");
  const named = animation(effect.sequences, "Stand");
  const other = named ? undefined : otherLoop(effect.sequences);
  const stand = named ?? other ?? (birth ? undefined : effect.sequences[0]);
  const play = !birth && !named && stand ? stand.name : "";
  const loop = birth && other ? other.name : "";
  // A model whose only animation is Death plays it at once: no second copy for a death frame.
  const death = play && play === animation(effect.sequences, "Death")?.name ? undefined : animation(effect.sequences, "Death");
  const standSeconds = stand ? stand.durationMs / 1000 : 0;
  const looping = stand?.looping ?? true;
  const standShot = round(looping ? Math.min(1, Math.max(standSeconds / 2, 0.25)) : Math.min(MAX_PART, Math.max(standSeconds / 2, 0.1)));
  const moves = looping || standSeconds - standShot >= MOVE_MIN;
  const [x0, y0, z0] = effect.min;
  const [x1, y1, z1] = effect.max;
  // Framed as a sphere round its bounds, on the pad: SC2 models stand on their origin.
  const radius = Math.max(0.5, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2);
  const halfFov = ((PLAYER_CAMERA.fov / 2) * Math.PI) / 180;
  const distance = round(Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, (radius * FRAME_MARGIN) / Math.tan(halfFov))));
  const labels: EffectShotLabel[] = [...(birth ? (["birth"] as const) : []), "stand", ...(moves ? (["moving"] as const) : []), "after-destroy", ...(death ? (["death"] as const) : [])];
  const stops = { birth: 0, stand: 0, moving: 0, "after-destroy": 0, death: 0 };
  labels.forEach((label, n) => (stops[label] = firstStop + n));
  const fast = moves && Boolean(effect.placement?.missile || effect.placement?.ribbons);
  const moveDistance = fast ? Math.max(distance, FAST_DISTANCE) : distance;
  const site = attachSite(effect.placement, hostSites);
  return {
    birth: birth ? round(Math.min(MAX_PART, birth.durationMs / 2000)) : 0,
    standShot,
    standLoops: looping,
    move: fast ? FAST_MOVE : moves ? 1 : 0,
    // Slow, a quarter of the frame's width, so the host stays in view: the frame is about 0.84 × distance wide.
    moveCells: fast ? FAST_SPEED * FAST_MOVE : moves ? round(Math.min(12, Math.max(1, distance * 0.21))) : 0,
    fast,
    moveDistance,
    lead: moves ? round(moveDistance * 0.21) : 0,
    site,
    death: death ? round(Math.min(MAX_PART, Math.max(death.durationMs / 2000, 0.1))) : 0,
    play,
    loop,
    distance,
    // The effect's middle, above the site it's attached at; never below the ground.
    height: round(Math.max(0, siteHeight(site, hostSites) + Math.min((z0 + z1) / 2, radius))),
    stops,
  };
}

/** A batch of effects planned for one map: each effect's CModel id, its plan and every frame in stop order. */
export type EffectBatch = { readonly effects: readonly TourEffect[]; readonly ids: readonly string[]; readonly plans: readonly EffectPlan[]; readonly shots: readonly EffectShot[] };

/** The map-local CModel id of a batch's `n`th effect. */
export const effectModelId = (n: number): string => `FxTour${String(n + 1).padStart(4, "0")}`;

/** Plans a batch: its effects' plans, numbered from stop 1, attached at the host's `hostSites`. */
export function planEffectBatch(effects: readonly TourEffect[], hostSites?: HostSites): EffectBatch {
  if (effects.length === 0) throw new Error("An effect tour needs at least one effect");
  let next = 1;
  const plans = effects.map((effect) => {
    const plan = planEffect(effect, next, hostSites);
    next += Object.values(plan.stops).filter((stop) => stop > 0).length;
    return plan;
  });
  if (next - 1 > 9999) throw new Error(`An effect tour's frames are numbered in 4 digits; this batch has ${next - 1}: split it`);
  const shots = plans
    .flatMap((plan, effect) => (Object.entries(plan.stops) as [EffectShotLabel, number][]).filter(([, stop]) => stop > 0).map(([label, stop]) => ({ stop, effect, file: effects[effect]!.file, label })))
    .sort((a, b) => a.stop - b.stop);
  return { effects, ids: effects.map((_, n) => effectModelId(n)), plans, shots };
}

/** About how long a batch takes in game, in seconds, after the game starts. The game's waits run at real speed in Test Document: the test batch (2026-11-23) took 143 s against 117 planned. */
export function batchSeconds(batch: EffectBatch, options: Pick<EffectTourOptions, "hold"> = {}): number {
  const hold = (options.hold ?? DEFAULT_HOLD) + 0.25;
  return Math.round(
    batch.plans.reduce((sum, plan) => sum + 1 + plan.birth * 2 + plan.standShot + plan.move + 0.5 + (plan.death ? 1.5 + plan.death * 2 + 0.5 : 0) + Object.values(plan.stops).filter((stop) => stop > 0).length * hold, 0) + 5,
  );
}

/** `--batches`: one batch (`3`) or a range (`3-5`); every batch when unset. */
export function batchRange(range: string | undefined): [number, number] {
  if (range === undefined) return [1, Infinity];
  const match = /^(\d+)(?:-(\d+))?$/.exec(range);
  if (!match || Number(match[1]) < 1 || (match[2] !== undefined && Number(match[2]) < Number(match[1]))) {
    throw new Error(`--batches takes one batch (3) or a range (3-5), not ${JSON.stringify(range)}`);
  }
  return [Number(match[1]), Number(match[2] ?? match[1])];
}

/** The map-local ModelData: one CModel per effect file. */
export function effectModelData(batch: EffectBatch): string {
  const models = batch.effects.map((effect, n) => `    <CModel id="${batch.ids[n]}" parent="FX">\n        <Model value="${effect.file.replace(/\//g, "\\")}"/>\n    </CModel>`);
  return `<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n${models.join("\n")}\n</Catalog>\n`;
}

/** Seconds of real time each frame is held for the screenshot, by default. */
export const DEFAULT_HOLD = 1.5;

export type EffectTourOptions = {
  /** Where on the map the pad is, in cells. */
  readonly pad?: readonly [number, number];
  /** The unit the effects are attached to; a Marine by default, which also shows their scale. */
  readonly host?: string;
  /** The host player's colour index, for the parts that take team colour; 8 (light pink) by default. */
  readonly teamColor?: number;
  /** The Light the batch is filmed in; the tileset's own when unset. */
  readonly lighting?: string;
  /** Seconds of real time each frame is held for the screenshot. */
  readonly hold?: number;
  /**
   * Hold the game still while a frame is taken (Set Global Time Scale 0). Off by default: in the
   * test run (2026-11-23) the game wrote no bank while held, so the capture missed 15 of 38 frames.
   */
  readonly freeze?: boolean;
  /**
   * The capture records video as well: once the pad is reset for an effect, the tour saves int key
   * `mark` (the effect's number from 1), which the Host Adapter notes in the video's timeline, and
   * attaches the effect a second later, so the frames of a burst over before any screenshot can
   * be found in it (effect-video.ts). It waits 12 s before the first effect, not 3, for the
   * recording to start.
   */
  readonly video?: boolean;
};

/** An animation's name as an actor message's anim props: its words joined by commas (`GLstand 01` is `GLstand,01`). */
const animProps = (name: string): string => name.trim().split(/\s+/).filter(Boolean).join(",");

const fx = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value));

/**
 * The batch's Galaxy: hide the UI, make the host, then film each effect in turn on the pad. Each
 * frame is announced by saving bank "FxTour" with key `stop`, held for the screenshot, and the
 * tour ends with stop -1. Waits for animations are in game time, waits for screenshots in real time.
 */
export function effectTourScript(batch: EffectBatch, options: EffectTourOptions = {}): string {
  const [px, py] = options.pad ?? [128, 128];
  const host = options.host ?? "Marine";
  const n = batch.effects.length;
  const freeze = options.freeze ?? false;
  const data = batch.plans.map((plan, i) =>
    [
      `    fxModel[${i}] = ${galaxyString(batch.ids[i]!)}; fxPlay[${i}] = ${galaxyString(plan.play)}; fxLoop[${i}] = ${galaxyString(animProps(plan.loop))};`,
      `fxSite[${i}] = ${galaxyString(plan.site)}; fxFast[${i}] = ${plan.fast ? "true" : "false"};`,
      `fxBirth[${i}] = ${fx(plan.birth)}; fxStand[${i}] = ${fx(plan.standShot)}; fxMove[${i}] = ${fx(plan.move)}; fxMoveCells[${i}] = ${fx(plan.moveCells)}; fxDeath[${i}] = ${fx(plan.death)};`,
      `fxDistance[${i}] = ${fx(plan.distance)}; fxHeight[${i}] = ${fx(plan.height)}; fxMoveDistance[${i}] = ${fx(plan.moveDistance)}; fxLead[${i}] = ${fx(plan.lead)};`,
      `fxShot[${i}][0] = ${plan.stops.birth}; fxShot[${i}][1] = ${plan.stops.stand}; fxShot[${i}][2] = ${plan.stops.moving}; fxShot[${i}][3] = ${plan.stops["after-destroy"]}; fxShot[${i}][4] = ${plan.stops.death};`,
    ].join(" "),
  );
  return `// Effect tour (generated by npm run effect-tour): films each effect model on a pad and announces
// each frame by saving bank "${EFFECT_TOUR_BANK}" with key "stop", for an outside watcher to screenshot.
include "TriggerLibs/NativeLib"
const int fxCount = ${n};
const fixed fxHold = ${fx(options.hold ?? DEFAULT_HOLD)};
const bool fxFreeze = ${freeze ? "true" : "false"};
const bool fxVideo = ${options.video ? "true" : "false"};
const string fxLighting = ${galaxyString(options.lighting ?? "")};
string[fxCount] fxModel;
string[fxCount] fxPlay;
string[fxCount] fxLoop;
string[fxCount] fxSite;
bool[fxCount] fxFast;
fixed[fxCount] fxMoveDistance;
fixed[fxCount] fxLead;
fixed[fxCount] fxBirth;
fixed[fxCount] fxStand;
fixed[fxCount] fxMove;
fixed[fxCount] fxMoveCells;
fixed[fxCount] fxDeath;
fixed[fxCount] fxDistance;
fixed[fxCount] fxHeight;
int[fxCount][5] fxShot;
bank fxBank;
unit fxHost;
point fxPad;

void FxTour_Data() {
${data.join("\n")}
}

// Announces a frame (none when stop is 0): holds the game still, clears messages, saves the bank,
// and holds the frame for the screenshot.
void FxTour_Shot(int stop) {
    if (stop <= 0) {
        return;
    }
    if (fxFreeze) {
        GameSetGlobalTimeScale(0.0);
    }
    UIClearMessages(PlayerGroupAll(), c_messageAreaAll);
    Wait(0.25, c_timeReal);
    BankValueSetFromInt(fxBank, "tour", "stop", stop);
    BankSave(fxBank);
    Wait(fxHold, c_timeReal);
    if (fxFreeze) {
        GameSetGlobalTimeScale(1.0);
    }
}

// Puts the host back on the pad, clears every particle left over, and points the camera.
void FxTour_Reset(int i) {
    ActorWorldParticleFXDestroy();
    UnitSetPosition(fxHost, fxPad, false);
    UnitSetFacing(fxHost, 270.0, 0.0);
    CameraSetValue(1, c_cameraValueDistance, fxDistance[i], 0.0, -1, 10.0);
    CameraSetValue(1, c_cameraValueHeightOffset, fxHeight[i], 0.0, -1, 10.0);
    CameraPan(1, fxPad, 0.0, -1, 10.0, false);
    if (fxVideo) {
        // Marks the bare pad in the video, then waits long enough that the host noticing the bank
        // late still finds the pad bare: the effect is attached a second after the mark.
        BankValueSetFromInt(fxBank, "tour", "mark", i + 1);
        BankSave(fxBank);
        Wait(1.0, c_timeReal);
    } else {
        Wait(0.5, c_timeReal);
    }
}

void FxTour_Film(int i) {
    actor fx;
    fixed step;
    fixed moved;
    FxTour_Reset(i);
    fx = libNtve_gf_AttachModelToUnit(fxHost, fxModel[i], fxSite[i]);
    if (fxPlay[i] != "") {
        ActorSend(fx, "AnimPlay FxTour " + fxPlay[i]);
    }
    if (fxBirth[i] > 0.0) {
        Wait(fxBirth[i], c_timeGame);
        FxTour_Shot(fxShot[i][0]);
        Wait(fxBirth[i], c_timeGame);
    }
    if (fxLoop[i] != "") {
        // A loop not named Stand, which the bracket doesn't play after Birth.
        ActorSend(fx, "AnimPlay FxTour " + fxLoop[i] + " PlayForever");
    }
    Wait(fxStand[i], c_timeGame);
    FxTour_Shot(fxShot[i][1]);
    if (fxMove[i] > 0.0) {
        if (fxFast[i]) {
            // A missile flies facing the way it goes; the camera pulls back for its trail.
            UnitSetFacing(fxHost, 0.0, 0.0);
            CameraSetValue(1, c_cameraValueDistance, fxMoveDistance[i], 0.5, -1, 10.0);
        }
        // Moved a step each game loop, the art blended between, so the effect sees a smooth move.
        // Once the host is a quarter of the frame from the pad the camera follows it, the trail behind.
        step = fxMoveCells[i] / (fxMove[i] * 16.0);
        moved = 0.0;
        while (moved < fxMoveCells[i]) {
            moved += step;
            UnitSetPosition(fxHost, PointWithOffset(fxPad, moved, 0.0), true);
            if (moved > fxLead[i]) {
                CameraPan(1, PointWithOffset(fxPad, moved - fxLead[i], 0.0), 0.0625, -1, 10.0, false);
            }
            Wait(0.0625, c_timeGame);
        }
        FxTour_Shot(fxShot[i][2]);
    }
    ActorSend(fx, "Destroy");
    Wait(0.5, c_timeGame);
    FxTour_Shot(fxShot[i][3]);
    if (fxDeath[i] > 0.0) {
        FxTour_Reset(i);
        fx = libNtve_gf_AttachModelToUnit(fxHost, fxModel[i], fxSite[i]);
        Wait(fxBirth[i] * 2.0 + 0.75, c_timeGame);
        // Played outright: stopping the bracket of the generic actor this makes removes it at once.
        ActorSend(fx, "AnimPlay FxTour Death");
        Wait(fxDeath[i], c_timeGame);
        FxTour_Shot(fxShot[i][4]);
        ActorSend(fx, "Destroy Immediate");
    }
}

bool FxTour_Run(bool testConds, bool runActions) {
    int i;
    fxBank = BankLoad("${EFFECT_TOUR_BANK}", 1);
    fxPad = Point(${fx(px)}, ${fx(py)});
    if (fxLighting != "") {
        GameSetLighting(fxLighting, 0.0);
    }
    VisEnable(c_visTypeMask, false);
    VisEnable(c_visTypeFog, false);
    libNtve_gf_HideGameUI(false, PlayerGroupAll());
    UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeMenuBar, false);
    UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeErrorDisplayPanel, false);
    TriggerDebugOutputEnable(false);
    TriggerDebugWindowOpen(false);
    UISetCursorVisible(PlayerGroupAll(), false);
    PlayerSetColorIndex(1, ${options.teamColor ?? 8}, true);
    UnitCreate(1, ${galaxyString(host)}, c_unitCreateIgnorePlacement, 1, fxPad, 270.0);
    fxHost = UnitLastCreated();
    UnitSetState(fxHost, c_unitStateInvulnerable, true);
    UnitSetState(fxHost, c_unitStateSelectable, false);
    CameraLockInput(1, true);
    CameraApplyInfo(1, CameraInfoDefault(), 0.0, -1, 10.0, false);
    CameraSetValue(1, c_cameraValuePitch, ${fx(EFFECT_PITCH)}, 0.0, -1, 10.0);
    FxTour_Data();
    // Recording, the Host Adapter can resize and start recording the window only once the game has
    // loaded: a longer wait, so the first effect is filmed.
    if (fxVideo) {
        Wait(12.0, c_timeReal);
    } else {
        Wait(3.0, c_timeReal);
    }
    i = 0;
    while (i < fxCount) {
        FxTour_Film(i);
        i += 1;
    }
    BankValueSetFromInt(fxBank, "tour", "stop", -1);
    BankSave(fxBank);
    return true;
}

void ${EFFECT_TOUR_INIT}() {
    TriggerAddEventMapInit(TriggerCreate("FxTour_Run"));
}
`;
}
