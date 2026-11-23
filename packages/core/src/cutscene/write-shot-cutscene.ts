// A cutscene built from a shot list: each shot is an orbit camera (held, or moving to a second
// camera with eased property curves) and its own backdrop, actors that exist only while that shot
// is on screen. This is per-shot compositing as the Cutscene Editor does it: a sky model or a few
// towers placed for one camera, instead of dressing the whole map. The set itself stays on the map
// the cutscene plays over (the hybrid); the cutscene adds cameras, backdrops and the Light.
//
// It's laid out shot first, as Blizzard's story cutscenes are (Korhal Arrival's s010a_FOLDER …):
// a folder a shot, `s010 <shot name>` in steps of 10, holding its camera, its own copy of each
// actor it shows and its backdrop; a top-level LIGHTS folder holding the lamps that light every
// shot and a folder a shot for the rest; and at the top level only the Director and what stands
// through every shot.

import { followPlan, type Leg, type Pace, partWay } from "./follow-path.js";
import { type CurveKey, type Passing, shakeJolts, shaken, smoothKeys, spanKeys } from "./property-curves.js";
import { type CutsceneNode, writeCutscene } from "./read-cutscene.js";
import type { TurnKey } from "./turns.js";

type Vec3 = readonly [number, number, number];

/** An orbit camera, in the map's camera values: it looks at `target`, its eye `distance` back along `yaw`. */
export type ShotCamera = {
  readonly target: Vec3;
  readonly distance: number;
  readonly pitch: number;
  readonly yaw: number;
  /** Vertical field of view, degrees (the map's FieldOfView). */
  readonly fov: number;
  /**
   * Depth of field as a blur amount, 0-1 (doftype 0, as HotS's and one Campaign's cameras write it; that
   * Campaign uses 0.1-0.5). Off without it. LotV's physical f-stop (doftype 2) doesn't render on the Mac
   * client even at Ultra post-processing; this does (exp-dof-legacy, 2026-10-28).
   */
  readonly blur?: number | undefined;
  /** Where the focus sits, in cells from the eye; the target (`distance`) when left out. */
  readonly focalDepth?: number | undefined;
  /** Cells past the focus over which the blur reaches full, and cells from the eye that blur near. */
  readonly falloff?: { readonly far: number; readonly near: number } | undefined;
  /** The Editor's heightOffset, written as given (an imported Set's cameras keep theirs). */
  readonly heightOffset?: number;
  /** Degrees about its line of sight; level when left out. */
  readonly roll?: number | undefined;
  /** false: the Editor's verticalFOV flag is off, as some imported cameras have it. */
  readonly verticalFov?: false;
  /** How far from the eye shadows are drawn (the camera's shadowClip), in cells; 75, Blizzard's usual, when left out. */
  readonly shadowDistance?: number | undefined;
};

/**
 * A model placed for one shot. Rotation is degrees: a number turns it about z, a triple is the
 * Editor's own (x, y, z), which a sky card stood up on its edge needs. Tint is 0-1 per channel.
 */
export type BackdropActor = {
  readonly model: string;
  readonly at: Vec3;
  readonly name?: string;
  readonly rotation?: number | Vec3;
  readonly scale?: number;
  readonly variation?: number;
  readonly tint?: readonly [number, number, number];
  /** A looping animation for the whole shot: "Walk" when the actor walks, else "Stand". */
  readonly anim?: string | AnimClip;
  /**
   * Walks from `at` through these points. The actor moves at its walk's own speed (walkSpeed),
   * not at whatever pace the path and shot length imply, so a longer path isn't finished, and a
   * model whose walk records no move speed (0) doesn't move.
   */
  readonly walkTo?: readonly Vec3[];
};

/**
 * An animation as the Editor records it once picked for a model: its loop length and the move
 * speed built into it. A walker on a path stands still without the move speed.
 */
export type AnimClip = {
  readonly name: string;
  readonly durationMs: number;
  readonly moveSpeed: number;
};

/**
 * How fast an actor walking `clip` moves along its path, in cells a second: the move speed is in
 * hundredths of a cell, whatever the actor's scale (measured on TestPathSpeed in game and in the
 * Editor, 2026-11-01: 300 went 3 cells a second at scale 1, 0.5 and 0.15).
 */
export function walkSpeed(clip: AnimClip): number {
  return clip.moveSpeed / 100;
}

/** A movespeed for `cellsPerSecond`, as an anim element carries it (walkSpeed's inverse). */
export const movespeedFor = (cellsPerSecond: number): number => cellsPerSecond * 100;

/**
 * A point light for one shot, tied to its camera, as Blizzard rigs each shot (cutscene §2.6,
 * L5/L6): a key, a weaker fill and a rim about three times the key. Color is 0-1 per channel.
 */
export type ShotLight = {
  readonly name: string;
  readonly at: Vec3;
  readonly color: readonly [number, number, number];
  /** colorMultiplier: 1 for a key. */
  readonly strength: number;
  /** Cells to where it fades out; full strength out to half of it. */
  readonly range: number;
  /** Casts shadows; off when absent, so the base Light's key stays the one shadow-caster. */
  readonly shadows?: true | undefined;
  /** A spot, aimed by `rotation` (the Editor's (x, y, z)), with its cone's hotspot and falloff; an omni when left out. */
  readonly spot?: { readonly rotation: Vec3; readonly hotspot?: number | undefined; readonly falloff?: number | undefined } | undefined;
  /** Its strength's changes through the shot, ms from the cut, in time order; it holds between them and after the last. */
  readonly steps?: readonly { readonly startMs: number; readonly durationMs: number; readonly strength: number; readonly move?: "ease" | "linear" | undefined }[] | undefined;
};

export type Shot = {
  readonly name: string;
  readonly durationMs: number;
  readonly from: ShotCamera;
  /** Where the camera ends up; it moves there over the whole shot, easing out. */
  readonly to?: ShotCamera;
  /** In place of `to`, the cameras it moves through, each reached `atMs` from the cut, in time order. */
  readonly path?: readonly { readonly atMs: number; readonly camera: ShotCamera }[];
  /**
   * "ease" (`to`'s default) leaves each key at speed and settles onto the next; "linear" moves at one
   * speed, to keep pace with a subject walking at one speed; "smooth" (a path's default) flies through
   * every key with no kink, at rest at the ends (the Editor's Auto tangent).
   */
  readonly move?: "ease" | "linear" | "smooth";
  /** A shake of its camera, from `startMs` after the cut for `durationMs`: see CameraShake. */
  readonly shake?: CameraShake;
  readonly backdrop?: readonly BackdropActor[];
  readonly lights?: readonly ShotLight[];
  /** Switches the base Light on this shot's cut, with no blend (L3); the first shot's replaces the cutscene's `light`. */
  readonly light?: string;
  /**
   * What a display shows through the shot: render-to-texture channel `channel` films, from the cut
   * to the shot's end, through the camera `cameraIndex` inside the model of standing actor `actor`
   * (by index: its copy in this shot, or its one node), at `aspectRatio` when given.
   */
  readonly feed?: ShotFeed;
  /**
   * Rides the camera on standing actor `actor`'s attach point `point` (its copy in this shot, or its
   * one node), `offset` from it, from the cut to the shot's end, as Editor-made handheld cameras
   * ride an invisible marine's Ref_Head: the point carries it, so the shot's moves animate the
   * rest and no curve keys the target (position); a shake, which jolts the target, is left
   * out. Its position stays its own target: Editor-made cameras on still rigs film from their own
   * position (docs/reference/editor-and-engine.md, "Where a cutscene camera's eye sits").
   */
  readonly attach?: { readonly actor: number; readonly point: string; readonly offset?: Vec3 | undefined };
};

/** A shot's render-to-texture feed: see Shot's `feed`. */
export type ShotFeed = { readonly channel: number; readonly actor: number; readonly cameraIndex: number; readonly aspectRatio?: number | undefined };

/**
 * A camera's shake, keyed by hand as Blizzard's are (research §4.10): its target jolts `amplitude`
 * cells along each axis, `hz` times a second, a key each half cycle, and with `roll` its roll by that
 * many degrees too. The jolts' sizes vary (half to all of the amplitude) but are the same on every
 * compile.
 */
export type CameraShake = {
  readonly startMs: number;
  readonly durationMs: number;
  readonly amplitude: number;
  readonly hz: number;
  readonly roll?: number | undefined;
};

/**
 * A model on the timeline, as a Set's pieces and a Cinematic's cast are: standing through every
 * shot (in the top-level Set folder), or, given `shots` (by index), as its own copy in each of
 * those shots' folders, alive only from the shot's cut to its end (the last shot's runs on to the
 * end of the timeline). A copy starts where the actor stands at its cut, after every move that
 * ended by then, and holds the anims, moves and lines of its shot: a line plays on the copy in
 * the shot where it starts. Times stay absolute. Scale is even, or (x, y, z), negative to mirror;
 * colours are 0-1.
 */
export type StandingActor = {
  readonly model: string;
  /** The model's file, where the actor names that and not a model entry. */
  readonly modelPath?: string;
  readonly at: Vec3;
  readonly name?: string;
  readonly rotation?: number | Vec3;
  readonly scale?: number | Vec3;
  readonly variation?: number;
  readonly tint?: readonly [number, number, number];
  readonly teamColor?: { readonly diffuse?: readonly number[] | undefined; readonly emissive?: readonly number[] | undefined };
  readonly opacity?: number;
  /** Switched off (the Editor's enabled off): it plays nothing, as a Set's hidden piece. */
  readonly hidden?: true;
  /** The folder it's kept in: "Set" when left out. */
  readonly folder?: string;
  /** Its copy in a shot lives on past the shot's end to its own `untilMs` (a voice whose line runs on past the cut). */
  readonly outlivesShot?: true;
  /** When it comes into being, in cutscene ms, and when it goes; all through when left out. */
  readonly fromMs?: number;
  readonly untilMs?: number;
  /** A looping animation all through; "Stand" when left out. */
  readonly anim?: string | LoopClip;
  /** How fast `anim` plays (the element's timeScale): 0.5 at half speed; its own speed when left out. */
  readonly animSpeed?: number | undefined;
  /** Where the animation changes to another, in time order, until the next change or the end; `once` plays it a single time, at `speed` and `priority` (3 when left out) when given. */
  readonly animFrom?: readonly { readonly startMs: number; readonly anim: string | LoopClip; readonly once?: true; readonly speed?: number | undefined; readonly priority?: number | undefined; readonly startOffsetMs?: number | undefined }[];
  /** Its timed changes, in time order: each from where it was to `to`, turning to `rotation`, scaling to `scale` and fading to `opacity`, where given. It holds between them and after the last. */
  readonly moves?: readonly ActorMove[];
  /**
   * The shots it's copied into, by index; absent, it stands through every shot as one actor. Past
   * the shots, the `views` it's Active for (by index after the last shot), as a Set cutscene's
   * pieces are: tied only to views, it stands as one actor too.
   */
  readonly shots?: readonly number[];
  /** The lines it says, from the cutscene's conversation: each plays on it, with its sound. */
  readonly says?: readonly SpokenLine[];
  /** Where it looks, in time order, each until the next or the end: at another standing actor, by its index, or ahead (no `at`), which writes no look-at. */
  readonly looks?: readonly LookAt[];
  /**
   * Rides another standing actor (by index) at its attach point `point`, offset and turned (the
   * Editor's x, y, z) from it, as Blizzard's blades ride a hand: a copy rides the other's copy in its
   * shot, over its own life. It's written with no position or rotation of its own (the point gives
   * both), so its `at`, `rotation` and moves to points are ignored; its scale, fades and anims stay.
   */
  readonly attach?: { readonly actor: number; readonly point: string; readonly offset?: Vec3 | undefined; readonly rotation?: Vec3 | undefined };
};

/** A look-at from `startMs`: at the standing actor `at` (an index), as the Editor's `type`, aimed at its attach point `point`. */
export type LookAt = { readonly startMs: number; readonly at?: number; readonly type: string; readonly point: string };

/**
 * A timed change of a standing actor: "ease" leaves at speed and settles, "linear" keeps one speed.
 * Its steps `to` points take it along a follow path, as Blizzard's and Editor-made cutscenes move their
 * actors (follow-path.ts): a path through where it stands as it starts and each step's `to`, nose
 * first along it, at the pace each leg needs to take its step's time. A turn on the spot, a scale
 * and a fade are property curves (Blizzard's space cutscenes stretch and fade their ships so).
 */
export type ActorMove = {
  readonly startMs: number;
  readonly durationMs: number;
  readonly to?: Vec3 | undefined;
  /**
   * With `to`: how it faces along its path on this leg, relative to the path's direction, as the
   * Editor's (x, y, z) in its own frame (the follow's pathRotationOffset): none, nose first.
   */
  readonly along?: Vec3 | undefined;
  /**
   * Degrees, the Editor's (x, y, z). A turn on the spot without `to`; with `to`, where the leg
   * leaves it facing, for a later copy to start from (the path turns it on the way).
   */
  readonly rotation?: Vec3 | undefined;
  /** The rotations a turn to `rotation` passes, each at its share of the move (turns.ts' turnKeys): keyed where the move gets there, at its pace. */
  readonly turn?: readonly TurnKey[] | undefined;
  /** (x, y, z), the model's own axes. */
  readonly scale?: Vec3 | undefined;
  /** 0 (invisible) to 1. */
  readonly opacity?: number | undefined;
  readonly move?: "ease" | "linear" | undefined;
  /** With `to`: keyed there (position and rotation curves) rather than flown along the follow path. */
  readonly keyed?: true | undefined;
};

/**
 * A looping animation and its length, which the Editor records as originalDuration once it's
 * picked, and the move speed built into it, when it has one (a walk's; a Stand's is 0).
 */
export type LoopClip = { readonly name: string; readonly durationMs: number; readonly moveSpeed?: number | undefined };

/** A line an actor says, at its start in the cutscene. */
export type SpokenLine = {
  readonly lineId: string;
  /** Its CSound: the line's voice, which plays on the actor (and its facial anim, when the sound has one). */
  readonly soundId: string;
  readonly startMs: number;
  readonly durationMs: number;
  /** Loops on a layer over the actor's own while it says the line, blending in and out (TALK_BLEND_MS). */
  readonly talk?: LoopClip;
};

/** The longest step to a point that's a jump, not a move: a frame at 60 a second. A copy coming into being on one starts where it lands. */
export const JUMP_MS = 16;

/** How long a Talk takes to blend in over a speaker's Stand, and back out (Blizzard's usual 300-500 ms). */
const TALK_BLEND_MS = 300;

/** A light of a Set's own: lighting every shot from the top of LIGHTS, or, given `shots` (by index), copied into each of those shots' LIGHTS folders for that shot alone. */
export type StandingLamp = {
  readonly name: string;
  readonly type: "omni" | "spot";
  readonly at: Vec3;
  readonly rotation?: Vec3 | undefined;
  readonly color: readonly [number, number, number];
  readonly strength: number;
  readonly attenuationStart?: number | undefined;
  readonly range?: number | undefined;
  readonly hotspot?: number | undefined;
  readonly falloff?: number | undefined;
  readonly shadows?: false | undefined;
  readonly shots?: readonly number[] | undefined;
  /** Attached to a standing actor (by its index) at its attach point `point`, offset and turned (the Editor's x, y, z), so it follows it. */
  readonly attach?: { readonly actor: number; readonly point: string; readonly offset?: Vec3 | undefined; readonly rotation?: Vec3 | undefined } | undefined;
};

/**
 * A sound the cutscene plays besides its lines, from `startMs` to `endMs` (the end when left out):
 * once, or looping; from `fromMs` into its file, at `volume`. `fadeOutMs` fades it to silence over
 * that long before it ends (all of it, when it plays less). A copy for a run of shots (a set's
 * ambience) gives the run's first `shot`, whose tag it's named with.
 */
export type CutsceneSound = {
  readonly sound: string;
  readonly startMs: number;
  readonly endMs?: number | undefined;
  readonly fadeOutMs?: number | undefined;
  readonly shot?: number | undefined;
  readonly volume?: number | undefined;
  readonly loop?: true | undefined;
  readonly fromMs?: number | undefined;
};

/** The Editor's sound mode for a sound that loops for as long as it plays (-1, unsigned). */
export const LOOP_FOREVER = "4294967295";

/** Lines a ConversationDriver plays from the map's conversation data, at their start times. */
export type CutsceneConversation = {
  /** The CConversation's id. */
  readonly id: string;
  readonly lines: readonly { readonly lineId: string; readonly startMs: number }[];
};

/** Cutscenes/Index.version: a version stamp the Editor writes beside a map's cutscenes (copied from an Editor-saved map's). */
export const INDEX_VERSION = Buffer.from("6364657373747563020000005d2f0100040000000b000000030000005d2f0100fb0100002116af5e01000000", "hex");

/** Cutscene T8: a fade in from black at t=0, and after the last shot a fade to black held before the End Scene marker. */
export const BOOKENDS = { fadeInMs: 1000, fadeOutMs: 1000, blackMs: 2000 } as const;

export type ShotCutscene = {
  /** The base Light for the whole cutscene, e.g. "KorhalNight". */
  readonly light?: string;
  /**
   * The map point at the cutscene's 0,0,0. Shots are written in map coordinates. The Cutscene
   * Editor's Import Terrain Data appears to put map point (64, 64) there whatever the map's size,
   * so [64, 64, 0] lines a cutscene up with its terrain in the Editor; in game, pass the same point
   * to CutsceneCreateNew.
   */
  readonly origin?: Vec3;
  readonly shots: readonly Shot[];
  readonly standing?: readonly StandingActor[];
  readonly lamps?: readonly StandingLamp[];
  readonly conversation?: CutsceneConversation;
  readonly sounds?: readonly CutsceneSound[];
  /**
   * Named cameras the file holds that no cut goes to, as a Set's are in a Set cutscene: an actor or
   * lamp is tied to one by its index after the shots'.
   */
  readonly views?: readonly (ShotCamera & { readonly name: string })[];
  /** How long the timeline runs when it has no shots; the shots' length (and the bookends) when it has. */
  readonly lengthMs?: number;
  /** The base Lights it switches to in turn, from t=0, each for an equal share of the timeline (a Set cutscene's); `light` and the shots' switches when left out. */
  readonly lightsInTurn?: readonly string[];
  /** Adds BOOKENDS: the timeline runs on past the shots by the fade out and the black, then ends. */
  readonly bookends?: boolean;
  /**
   * Named points on the Director's bookmark track. A trigger hears one as playback passes it
   * (`TriggerAddEventCutsceneBookmarkFired`, editor-and-engine.md "A cutscene's events"). It isn't
   * heard when the cutscene is stopped, skipped or jumped past it, or jumped to it.
   */
  readonly bookmarks?: readonly CutsceneBookmark[];
};

/** A bookmark: a name a trigger listens for, at a time on the timeline. */
export type CutsceneBookmark = { readonly name: string; readonly atMs: number };

const fixed = (value: number): string => value.toFixed(6);
const vector = (values: readonly number[]): string => values.map(fixed).join(",");
/** A scale as (x, y, z): one number scales evenly. */
export const evenly = (scale: number | Vec3): Vec3 => (typeof scale === "number" ? [scale, scale, scale] : scale);
const optional = (name: string, value: number | undefined): Record<string, string> => (value === undefined ? {} : { [name]: fixed(value) });

const focus = (camera: ShotCamera): number | undefined => (camera.blur === undefined ? undefined : (camera.focalDepth ?? camera.distance));
/** One Campaign's usual falloffs: blur full 2 cells past the focus; no near blur. */
const FALLOFF = { far: 2, near: 0 };

/** The camera properties a move animates, and how each reads off a ShotCamera (undefined: not set). */
const MOVED: readonly [string, (camera: ShotCamera) => number | undefined][] = [
  ["positionX", (camera) => camera.target[0]],
  ["positionY", (camera) => camera.target[1]],
  ["positionZ", (camera) => camera.target[2]],
  ["distance", (camera) => camera.distance],
  ["pitch", (camera) => camera.pitch],
  ["yaw", (camera) => camera.yaw],
  ["roll", (camera) => camera.roll ?? 0],
  ["fov", (camera) => camera.fov],
  ["focalDepth", focus],
];

/** The target's position, which a shake jolts by its amplitude in cells. */
const SHAKEN_TARGET: readonly string[] = ["positionX", "positionY", "positionZ"];

export function shotCutscene(input: ShotCutscene): string {
  const [ox, oy, oz] = input.origin ?? [0, 0, 0];
  const local = ([x, y, z]: Vec3): Vec3 => [x - ox, y - oy, z - oz];
  const spec: ShotCutscene = {
    ...input,
    shots: input.shots.map((shot) => ({
      ...shot,
      from: { ...shot.from, target: local(shot.from.target) },
      ...(shot.to ? { to: { ...shot.to, target: local(shot.to.target) } } : {}),
      ...(shot.path ? { path: shot.path.map((key) => ({ ...key, camera: { ...key.camera, target: local(key.camera.target) } })) } : {}),
      ...(shot.backdrop ? { backdrop: shot.backdrop.map((piece) => ({ ...piece, at: local(piece.at), ...(piece.walkTo ? { walkTo: piece.walkTo.map(local) } : {}) })) } : {}),
      ...(shot.lights ? { lights: shot.lights.map((light) => ({ ...light, at: local(light.at) })) } : {}),
    })),
    ...(input.standing ? { standing: input.standing.map((piece) => ({ ...piece, at: local(piece.at), ...(piece.moves ? { moves: piece.moves.map((step) => ({ ...step, ...(step.to ? { to: local(step.to) } : {}) })) } : {}) })) } : {}),
    ...(input.lamps ? { lamps: input.lamps.map((lamp) => ({ ...lamp, at: local(lamp.at) })) } : {}),
  };
  let counter = 0;
  const guid = (): string => `88${String(++counter).padStart(8, "0")}`;
  const shotsMs = spec.shots.reduce((sum, shot) => sum + shot.durationMs, 0);
  const totalMs = spec.shots.length === 0 && spec.lengthMs !== undefined ? spec.lengthMs : shotsMs + (spec.bookends ? BOOKENDS.fadeOutMs + BOOKENDS.blackMs : 0);
  const starts = spec.shots.map((_, index) => spec.shots.slice(0, index).reduce((sum, shot) => sum + shot.durationMs, 0));
  for (const { name, atMs } of spec.bookmarks ?? []) {
    // An empty name isn't a wildcard: a trigger registered with "" never fires (editor-and-engine.md).
    if (name.trim() === "") throw new Error("A bookmark needs a name: a trigger can't listen for an empty one");
    if (!Number.isFinite(atMs) || atMs < 0 || atMs > totalMs) throw new Error(`Bookmark ${name} is at ${atMs} ms, outside the cutscene's 0 to ${totalMs} ms`);
  }

  /** A shot's tag, `s010` for the first, in Blizzard's steps of 10, and its folder's name. */
  const tagOf = (index: number): string => `s${String((index + 1) * 10).padStart(3, "0")}`;
  const folderName = (index: number): string => `${tagOf(index)} ${spec.shots[index]!.name}`;
  /** Where a shot's copies stop: the next cut, or the timeline's end after the last shot, so the last shot's stay through the fade out. */
  const endOf = (index: number): number => (index + 1 < spec.shots.length ? starts[index + 1]! : totalMs);
  const folder = (name: string, children: CutsceneNode[]): CutsceneNode => ({ tag: "CCutsceneNodeFolder", attrs: { guid: guid(), name }, children });

  const lifetime = (start: number, duration: number): CutsceneNode => ({
    tag: "CCutsceneElementObject",
    attrs: { guid: guid(), ...(start > 0 ? { start: String(start) } : {}), duration: String(duration), ...(start + duration >= totalMs ? { lockedToEnd: "1" } : {}) },
    children: [],
  });

  // A property's keys as the Editor writes them (property-curves): absolute cutscene times, each
  // handle a third of the way in time to the key beside it, 1 ms out at the ends.
  // Named for its property, or as the Editor names it (a sound's volumeScale is "Property - Volume").
  const curveNode = (property: string, keys: readonly CurveKey[], label = property): CutsceneNode => ({
    tag: "CCutsceneNodePropertyValue",
    attrs: { guid: guid(), name: `Property - ${label}`, propertyName: property },
    children: keys.map((key, at) => {
      const [before, after] = [keys[at - 1], keys[at + 1]];
      const inTime = before ? key.time - (key.time - before.time) / 3 : key.time - 1;
      const outTime = after ? key.time + (after.time - key.time) / 3 : key.time + 1;
      return {
        tag: "CCutsceneElementPropertyCurve",
        attrs: { guid: guid(), ...(key.time > 0 ? { start: String(Math.round(key.time)) } : {}), value: fixed(key.value), time: fixed(key.time), curveInValue: vector([inTime, key.inValue]), curveOutValue: vector([outTime, key.outValue]), curveOutType: key.outType, curveInType: key.inType },
        children: [],
      };
    }),
  });

  // A camera's move, through the path's keys from its own at the cut: eased (cutscene §1.5: it
  // leaves at speed and settles onto each key), linear, or smooth (Auto tangents, no kink at a key).
  // One curve for each property that changes, and for the ones a shake moves.
  const cameraCurves = (shot: Shot, start: number): CutsceneNode[] => {
    const path = shot.path ?? (shot.to ? [{ atMs: shot.durationMs, camera: shot.to }] : []);
    const cameras = [{ atMs: 0, camera: shot.from }, ...path];
    const style = shot.move ?? (shot.path ? "smooth" : "ease");
    const shake = shot.attach ? undefined : shot.shake;
    return MOVED.flatMap(([property, read], axis) => {
      // A camera riding an actor has its target carried by the attach point.
      if (shot.attach && SHAKEN_TARGET.includes(property)) return [];
      const values = cameras.map(({ camera }) => read(camera));
      const amplitude = shake ? (SHAKEN_TARGET.includes(property) ? shake.amplitude : property === "roll" ? shake.roll : undefined) : undefined;
      const moves = path.length > 0 && values.every((value) => value !== undefined) && values.some((value) => Math.abs(value! - values[0]!) >= 1e-6);
      if (!moves && amplitude === undefined) return [];
      const points = moves ? cameras.map(({ atMs }, at) => ({ time: start + atMs, value: values[at]! })) : [];
      let keys = style === "smooth" ? smoothKeys(points) : spanKeys(points, points.slice(1).map(() => style));
      if (shake && amplitude !== undefined) {
        const [from, to] = [start + shake.startMs, start + shake.startMs + shake.durationMs];
        if (!keys.length) keys = spanKeys([{ time: from, value: values[0]! }, { time: to, value: values[0]! }], ["linear"]);
        keys = shaken(keys, from, to, shakeJolts(from, to, shake.hz, amplitude, axis));
      }
      return [curveNode(property, keys)];
    });
  };

  const cameraNode = (camera: ShotCamera, name: string, curves: readonly CutsceneNode[]): CutsceneNode => ({
      tag: "CCutsceneNodeCamera",
      attrs: {
        guid: guid(),
        name,
        position: vector(camera.target),
        fov: fixed(camera.fov),
        ...(camera.verticalFov === false ? {} : { verticalFOV: "1" }),
        nearClip: fixed(0.1),
        farClip: fixed(600),
        shadowClip: fixed(camera.shadowDistance ?? 75),
        distance: fixed(camera.distance),
        pitch: fixed(camera.pitch),
        yaw: fixed(camera.yaw),
        ...(camera.heightOffset !== undefined ? { heightOffset: fixed(camera.heightOffset) } : {}),
        ...(camera.roll !== undefined ? { roll: fixed(camera.roll) } : {}),
        ...(camera.blur !== undefined
          ? {
              depthOfField: fixed(camera.blur),
              focalDepth: fixed(focus(camera)!),
              falloffStart: fixed(0.0003),
              falloffEnd: fixed((camera.falloff ?? FALLOFF).far),
              falloffStartNear: fixed((camera.falloff ?? FALLOFF).near),
              falloffEndNear: fixed(0),
              doftype: fixed(0),
            }
          : {}),
      },
      children: [lifetime(0, totalMs), ...curves],
  });
  const cameras = [...spec.shots.map((shot, index) => cameraNode(shot.from, shot.name, cameraCurves(shot, starts[index]!))), ...(spec.views ?? []).map((view) => cameraNode(view, view.name, []))];

  // A walker follows a path of markers beside it in the folder (CCutsceneNodeFollowPath), as
  // Blizzard's and Editor-made entrances do, while its walk animation loops.
  /** A path through `markers`, each alive from `start` for `duration`, as the actor following it is. */
  const pathNode = (name: string, markers: readonly Vec3[], start: number, duration: number): CutsceneNode => ({
    tag: "CCutsceneNodePath",
    attrs: { guid: guid(), name },
    children: markers.map((point) => ({ tag: "CCutsceneNodePathMarker", attrs: { guid: guid(), name: "Path Marker", position: vector(point) }, children: [lifetime(start, duration)] })),
  });
  /** An actor's Follow Path: each follow from `start` to `end` along its path, turned `along` it when given (pathRotationOffset). */
  const followNode = (follows: readonly { start: number; end: number; path: CutsceneNode; along?: Vec3 | undefined }[]): CutsceneNode => ({
    tag: "CCutsceneNodeFollowPath",
    attrs: { guid: guid(), name: "Follow Path" },
    children: follows.map(({ start, end, path, along }) => ({
      tag: "CCutsceneElementFollowPath",
      attrs: {
        guid: guid(),
        ...(start > 0 ? { start: String(start) } : {}),
        duration: String(end - start),
        ...(end >= totalMs ? { lockedToEnd: "1" } : {}),
        pathGuid: path.attrs.guid!,
        ...(along?.some((angle) => Math.abs(angle) > 1e-9) ? { pathRotationOffset: vector(along) } : {}),
      },
      children: [],
    })),
  });
  const actor = (piece: BackdropActor, start: number, duration: number): CutsceneNode[] => {
    const path = piece.walkTo?.length ? pathNode(`${piece.name ?? piece.model} path`, [piece.at, ...piece.walkTo], start, duration) : undefined;
    const follow = path ? [followNode([{ start, end: start + duration, path }])] : [];
    return [placed(piece, start, duration, path ? "Walk" : "Stand", follow), ...(path ? [path] : [])];
  };
  const placed = (piece: BackdropActor, start: number, duration: number, anim: string, follow: CutsceneNode[]): CutsceneNode => ({
    tag: "CCutsceneNodeActor",
    attrs: {
      guid: guid(),
      name: piece.name ?? piece.model,
      position: vector(piece.at),
      scale: vector(Array(3).fill(piece.scale ?? 1)),
      rotation: vector(typeof piece.rotation === "object" ? piece.rotation : [0, 0, piece.rotation ?? 0]),
      modelLink: piece.model,
      ...(piece.variation ? { variation: String(piece.variation) } : {}),
      shadowBox: "0",
      ...(piece.tint ? { tintColorRed: fixed(piece.tint[0]), tintColorGreen: fixed(piece.tint[1]), tintColorBlue: fixed(piece.tint[2]) } : {}),
    },
    children: [
      lifetime(start, duration),
      {
        tag: "CCutsceneNodeAnimLayer",
        attrs: { guid: guid(), name: "Animation Layer" },
        children: [{ tag: "CCutsceneElementAnim", attrs: { guid: guid(), ...(start > 0 ? { start: String(start) } : {}), duration: String(duration), ...animAttrs(piece.anim ?? anim), looping: "1" }, children: [] }],
      },
      ...follow,
    ],
  });
  const animAttrs = (clip: string | AnimClip): Record<string, string> =>
    typeof clip === "string"
      ? { anim: clip, priority: "3" }
      : { anim: clip.name, priority: "5", originalDuration: String(clip.durationMs), originalMoveSpeed: fixed(clip.moveSpeed), movespeed: fixed(clip.moveSpeed) };
  // Each shot's backdrop, named by its shot as its copies are.
  // Like its copies, the last shot's stays through the fade out.
  const backdrops = spec.shots.map((shot, index) => (shot.backdrop ?? []).flatMap((piece) => actor({ ...piece, name: `${tagOf(index)} ${piece.name ?? piece.model}` }, starts[index]!, endOf(index) - starts[index]!)));
  // Point lights (type 1) need no aim. Each lights only its own shot: it lives only through the
  // shot, and is tied to its camera (ActiveShot) as Blizzard ties nearly all its lights.
  // Property curves through keys at absolute cutscene times, one node per property that changes,
  // each span eased or linear.
  // A span may pass values of its own on the way (`between`, by property and span).
  const propertyCurves = (
    properties: readonly string[],
    keys: readonly { time: number; values: readonly number[] }[],
    linear: readonly boolean[],
    between: (axis: number, span: number) => readonly Passing[] | undefined = () => undefined,
  ): CutsceneNode[] =>
    properties.flatMap((property, axis) => {
      const points = keys.map(({ time, values }) => ({ time, value: values[axis]! }));
      const passes = linear.map((_, span) => between(axis, span));
      if ([...points.map(({ value }) => value), ...passes.flatMap((values) => (values ?? []).map(({ value }) => value))].every((value) => Math.abs(value - points[0]!.value) < 1e-6)) return [];
      return [curveNode(property, spanKeys(points, linear.map((straight) => (straight ? "linear" : "ease")), passes))];
    });
  /** Keys for timed steps from `start`: a hold key where a step starts after the last one ended, and one at each step's end. */
  const stepKeys = <Step extends { readonly startMs: number; readonly durationMs: number; readonly move?: "ease" | "linear" | undefined }>(
    start: readonly number[],
    steps: readonly Step[],
    next: (from: readonly number[], step: Step) => number[],
  ): { keys: { time: number; values: readonly number[] }[]; linear: boolean[]; spans: (Step | undefined)[] } => {
    let place = start;
    const keys: { time: number; values: readonly number[] }[] = [];
    const linear: boolean[] = [];
    // The step each span runs, none for a hold.
    const spans: (Step | undefined)[] = [];
    for (const step of steps) {
      const last = keys.at(-1);
      if (!last || last.time < step.startMs) {
        if (last) {
          linear.push(true);
          spans.push(undefined);
        }
        keys.push({ time: step.startMs, values: place });
      }
      place = next(place, step);
      linear.push(step.move === "linear");
      spans.push(step);
      keys.push({ time: step.startMs + step.durationMs, values: place });
    }
    return { keys, linear, spans };
  };
  /** Ties a light to the camera it lights. */
  const activeShot = (camera: string): CutsceneNode => ({ tag: "CCutsceneNodeActiveShot", attrs: { guid: guid(), cameraGUID: camera, cameraIndex: "0" }, children: [] });
  const light = (rig: ShotLight, start: number, duration: number, camera: string): CutsceneNode => ({
    tag: "CCutsceneNodeLight",
    attrs: {
      guid: guid(),
      name: rig.name,
      position: vector(rig.at),
      ...(rig.spot ? { rotation: vector(rig.spot.rotation) } : {}),
      type: rig.spot ? "2" : "1",
      colorR: fixed(rig.color[0]),
      colorG: fixed(rig.color[1]),
      colorB: fixed(rig.color[2]),
      colorMultiplier: fixed(rig.strength),
      attenuationStart: fixed(rig.range / 2),
      range: fixed(rig.range),
      ...(rig.spot ? { ...optional("hotspot", rig.spot.hotspot), ...optional("falloff", rig.spot.falloff) } : {}),
      ...(rig.shadows ? {} : { shadowCasting: "0" }),
    },
    children: [
      lifetime(start, duration),
      activeShot(camera),
      // A flash: its strength keyed, diffuse and specular together, as Blizzard's warp-ins key both.
      ...(rig.steps?.length
        ? (() => {
            const { keys, linear } = stepKeys([rig.strength], rig.steps.map((step) => ({ ...step, startMs: start + step.startMs })), (_, step) => [step.strength]);
            const both = keys.map((key) => ({ time: key.time, values: [key.values[0]!, key.values[0]!] }));
            return propertyCurves(["colorMultiplier", "specularColorMultiplier"], both, linear);
          })()
        : []),
    ],
  });
  const rigs = spec.shots.map((shot, index) => (shot.lights ?? []).map((rig) => light(rig, starts[index]!, endOf(index) - starts[index]!, cameras[index]!.attrs.guid!)));

  // The actor's own animation, changing where animFrom says, from `from` to `until` (the last
  // locked to the end when that's the timeline's): a copy takes the run in force at its cut and
  // those that start in its life. A run another replaces at the same moment is left out.
  // On a path, each run is split where the pace changes, every piece carrying its leg's movespeed
  // (paceAttrs), and a piece after the first goes on from where its run had got to (carriedOn).
  const held = (piece: StandingActor, from: number, until: number, paces: readonly Pace[] = []): CutsceneNode[] => {
    const listed: { startMs: number; anim: string | LoopClip; once?: true; speed?: number | undefined; priority?: number | undefined; startOffsetMs?: number | undefined }[] = [{ startMs: 0, anim: piece.anim ?? "Stand", speed: piece.animSpeed }, ...(piece.animFrom ?? [])];
    const all = listed.filter((run, at) => listed[at + 1]?.startMs !== run.startMs);
    const runs = all.slice(Math.max(0, all.findLastIndex((run) => Math.round(run.startMs) <= from))).filter((run) => Math.round(run.startMs) < until);
    return runs.flatMap((run, at) => {
      const start = Math.max(from, Math.round(run.startMs));
      const end = at + 1 < runs.length ? Math.round(runs[at + 1]!.startMs) : until;
      return paced(start, end, paces).map(({ start: pieceStart, end: pieceEnd, pace }) => ({
        tag: "CCutsceneElementAnim",
        attrs: {
          guid: guid(),
          ...(pieceStart > 0 ? { start: String(pieceStart) } : {}),
          duration: String(pieceEnd - pieceStart),
          ...(pieceEnd >= totalMs ? { lockedToEnd: "1" } : {}),
          ...loop(run.anim),
          ...paceAttrs(run.anim, run.priority, pace),
          ...(run.once ? {} : { looping: "1" }),
          ...(run.speed !== undefined && run.speed !== 1 ? { timeScale: fixed(run.speed) } : {}),
          ...carriedOn(run.anim, pieceStart - start, run.speed ?? 1, !run.once, run.startOffsetMs),
        },
        children: [],
      }));
    });
  };
  const loop = (clip: string | LoopClip): Record<string, string> => (typeof clip === "string" ? { anim: clip } : { anim: clip.name, originalDuration: String(clip.durationMs) });
  /** `start` to `end` cut where a pace starts or ends, each piece with the pace it's in (none off the path's time). */
  const paced = (start: number, end: number, paces: readonly Pace[]): { start: number; end: number; pace?: Pace }[] => {
    const edges = [...new Set([start, ...paces.flatMap((pace) => [pace.startMs, pace.endMs]).filter((time) => time > start && time < end), end])].sort((a, b) => a - b);
    return edges.slice(1).map((pieceEnd, at) => {
      const pace = paces.find((entry) => entry.startMs <= edges[at]! && edges[at]! < entry.endMs);
      return { start: edges[at]!, end: pieceEnd, ...(pace ? { pace } : {}) };
    });
  };
  // A piece on the path carries its leg's movespeed. An anim with a move speed built in (a walk)
  // also carries that, as originalMoveSpeed, at a Walk's priority 5 as the Editor writes it; one
  // without (a Stand, or a model that has no walk of its own) carries the movespeed alone, which
  // moves it (TestPathSpeed's ship on Stand), where originalMoveSpeed 0 would hold it still.
  const paceAttrs = (clip: string | LoopClip, priority: number | undefined, pace: Pace | undefined): Record<string, string> => {
    const builtIn = typeof clip === "object" && clip.moveSpeed ? clip.moveSpeed : undefined;
    if (!pace) return { priority: String(priority ?? 3) };
    return { priority: String(priority ?? (builtIn ? 5 : 3)), ...(builtIn ? { originalMoveSpeed: fixed(builtIn) } : {}), movespeed: fixed(movespeedFor(pace.cellsPerSecond)) };
  };
  /**
   * Where a piece `elapsed` ms into its anim's run picks it up (startOffset), so a split run plays
   * on: past the run's in-point `inPoint` (clip time), and, when its length is known, a loop's place in
   * its cycle, or no further than the clip's end for one played once. originalDuration stays the whole clip's, as Blizzard's anims with a startOffset keep it.
   */
  const carriedOn = (clip: string | LoopClip, elapsed: number, speed: number, looping: boolean, inPoint = 0): Record<string, string> => {
    let offset = inPoint + Math.round(elapsed * speed);
    // A loop goes round its cycle; one played once holds at its clip's end, never past it.
    if (typeof clip === "object" && clip.durationMs > 0) offset = looping ? offset % clip.durationMs : Math.min(offset, clip.durationMs);
    return offset > 0 ? { startOffset: String(offset) } : {};
  };
  // Talk on a layer of its own above the actor's Stand, at a higher priority, as Blizzard's story
  // scenes keep it: when a Talk ends, the Stand under it shows again. Each runs within the actor's
  // life, `from` to `until`: a line a later shot cuts into stops at the cut on one copy and goes on
  // from it on the next, with no blend at the cut.
  // On a path a Talk carries the movespeed too, split where the pace changes as the actor's own
  // anim is, so it moves on whichever anim the engine takes its pace from (an Editor-made walker writes its
  // walk's movespeed on the anim layered over it).
  const talking = (lines: readonly SpokenLine[], from: number, until: number, paces: readonly Pace[] = []): CutsceneNode[] => {
    const talks = lines.filter((line): line is SpokenLine & { talk: LoopClip } => line.talk !== undefined);
    if (!talks.length) return [];
    return [
      {
        tag: "CCutsceneNodeAnimLayer",
        attrs: { guid: guid(), name: "Talk" },
        children: talks.flatMap((line) => {
          const [lineStart, lineEnd] = [Math.round(line.startMs), Math.round(line.startMs) + Math.round(line.durationMs)];
          const [start, end] = [Math.max(lineStart, from), Math.min(lineEnd, until)];
          return paced(start, end, paces).map(({ start: pieceStart, end: pieceEnd, pace }) => ({
            tag: "CCutsceneElementAnim",
            attrs: {
              guid: guid(),
              ...(pieceStart > 0 ? { start: String(pieceStart) } : {}),
              duration: String(pieceEnd - pieceStart),
              ...loop(line.talk),
              priority: "4",
              ...(pace ? { movespeed: fixed(movespeedFor(pace.cellsPerSecond)) } : {}),
              looping: "1",
              blendTime: String(pieceStart > lineStart ? 0 : TALK_BLEND_MS),
              blendOutTime: String(pieceEnd < lineEnd ? 0 : TALK_BLEND_MS),
              ...carriedOn(line.talk, pieceStart - start, 1, true),
            },
            children: [],
          }));
        }),
      },
    ];
  };
  // A speaker's lines on its actor, as Blizzard's and Editor-made conversation scenes place them, beside
  // the ConversationDriver's. The facial anim is the sound's own: our CSounds have none (no FaceFX).
  const spoken = (lines: readonly SpokenLine[]): CutsceneNode => ({
    tag: "CCutsceneNodeConversation",
    attrs: { guid: guid(), name: "Conversation" },
    children: lines.map((line) => ({
      tag: "CCutsceneElementConversation",
      attrs: {
        guid: guid(),
        ...(line.startMs > 0 ? { start: String(Math.round(line.startMs)) } : {}),
        duration: String(Math.round(line.durationMs)),
        conversationLink: spec.conversation?.id ?? "",
        conversationLine: line.lineId,
        soundLink: line.soundId,
        facialGroup: "",
        facialAnim: "",
        assetDuration: String(Math.round(line.durationMs)),
      },
      children: [],
    })),
  });
  // A standing actor's turns, scales and fades as one curve per rotation, scale or opacity axis that
  // changes, keyed at every step's start and end (a hold between steps is a flat stretch), with the
  // camera's handles: an eased stretch leaves at speed and settles, a linear one keeps to the
  // straight line. A step to a point goes along the path (pathOf), so it keys only its scale and
  // fade. Position, rotation, scale and opacity, as the Editor names their properties.
  const MOVING = ["positionX", "positionY", "positionZ", "rotationX", "rotationY", "rotationZ", "scaleX", "scaleY", "scaleZ", "opacity"] as const;
  // A copy whose path lets go of it (`landed`) holds its last marker by keys from then on, and its
  // legs key where they leave it facing, so a turn on the spot after them starts from there.
  const moving = (piece: StandingActor, landed?: { atMs: number; at: Vec3 }): CutsceneNode[] => {
    if (!piece.moves?.length) return [];
    const rotation = typeof piece.rotation === "object" ? piece.rotation : [0, 0, piece.rotation ?? 0];
    const steps = piece.moves.map((step): ActorMove => {
      if (!step.to || step.keyed) return step;
      const { to: _to, rotation: facing, turn: _turn, along: _along, ...rest } = step;
      return landed && facing ? { ...rest, rotation: facing, move: "linear" } : rest;
    });
    const held: CutsceneNode[] = landed ? (["positionX", "positionY", "positionZ"] as const).map((property, axis) => curveNode(property, spanKeys([{ time: landed.atMs, value: landed.at[axis]! }, { time: Math.max(landed.atMs + 1, totalMs), value: landed.at[axis]! }], ["linear"]))) : [];
    const { keys, linear, spans } = stepKeys([...piece.at, ...rotation, ...evenly(piece.scale ?? 1), piece.opacity ?? 1], steps, (from, step) => [
      ...(step.to ?? from.slice(0, 3)),
      ...(step.rotation ?? from.slice(3, 6)),
      ...(step.scale ?? from.slice(6, 9)),
      step.opacity ?? from[9]!,
    ]);
    // A turn's in-between rotations, on the rotation axes (3 to 5).
    return [...held, ...propertyCurves(MOVING, keys, linear, (axis, span) => (axis >= 3 && axis < 6 ? spans[span]?.turn?.map(({ share, rotation }) => ({ share, value: rotation[axis - 3]! })) : undefined))];
  };
  // A cutscene's `views` (its cameras past the shots, a Set cutscene's) are tied to by Active for
  // Shot; a shot index makes copies instead.
  const isView = (index: number): boolean => index >= spec.shots.length;
  const activeFor = (shots: readonly number[] | undefined): CutsceneNode[] =>
    [...new Set((shots ?? []).filter(isView))].map((index) => activeShot(cameras[index]!.attrs.guid!));
  /** Whether it stands as one actor (in every shot, or tied only to views) rather than as copies in its shots. */
  const single = (shots: readonly number[] | undefined): boolean => shots === undefined || (shots.length > 0 && shots.every(isView));
  /**
   * The follow path of an actor whose steps go to points, alive from `from` to `until`: the paths
   * beside it (one, `<name> path`, unless its facing along them changes; then a run a path, `path
   * 2` on), its Follow Path, each run's element from its first leg until the next run starts or the
   * actor goes (it stops at the last marker), and the paces its anims carry. A leg under way when it
   * comes into being starts where it has got to by then along the leg's straight line (a Cinematic's
   * steps never run over a cut). Nothing for an actor that stays put.
   */
  const pathOf = (piece: StandingActor, from: number, until: number): { paths: CutsceneNode[]; follow: CutsceneNode[]; paces: readonly Pace[]; landed?: { atMs: number; at: Vec3 } } => {
    const [born, gone] = [piece.fromMs ?? 0, piece.untilMs ?? totalMs];
    const legs: Leg[] = (piece.moves ?? []).flatMap((step) => (step.to && !step.keyed && step.startMs < until ? [{ startMs: step.startMs, durationMs: step.durationMs, to: step.to, along: step.along, move: step.move }] : []));
    let start: Vec3 = piece.at;
    const first = legs[0];
    const life = Math.max(from, born);
    if (first && first.startMs < life) {
      start = partWay(piece.at, first, life);
      legs[0] = { ...first, startMs: life, durationMs: first.startMs + first.durationMs - life };
    }
    const { runs, paces } = followPlan(start, legs);
    if (!runs.length) return { paths: [], follow: [], paces: [] };
    // A turn on the spot after the last leg needs the path to let go of the actor's facing: its
    // follow ends at the last marker, and keys hold it there from then on (moving), as an Editor-made
    // walker is keyed from where its path ends.
    const lastEnd = paces.at(-1)!.endMs;
    const turnsAfter = (piece.moves ?? []).some((step) => !step.to && step.rotation !== undefined && step.startMs >= lastEnd && step.startMs < until);
    const name = piece.name ?? piece.model;
    const paths = runs.map((run, at) => pathNode(`${name} path${at ? ` ${at + 1}` : ""}`, run.markers, born, gone - born));
    const follow = followNode(runs.map((run, at) => ({ start: run.startMs, end: runs[at + 1]?.startMs ?? (turnsAfter ? lastEnd : gone), path: paths[at]!, along: run.along })));
    const within = paces.filter((pace) => pace.startMs < until).map((pace) => ({ ...pace, endMs: Math.min(pace.endMs, until) }));
    return { paths, follow: [follow], paces: within, ...(turnsAfter ? { landed: { atMs: lastEnd, at: runs.at(-1)!.markers.at(-1)! } } : {}) };
  };
  /** An actor on the timeline, alive from `from` to `until`, talking through `talks` (its own lines, by default), and the paths it follows beside it. */
  const standingNodes = (piece: StandingActor, from: number, until: number, talks: readonly SpokenLine[] = piece.says ?? []): CutsceneNode[] => {
    const { paths, follow, paces, landed } = pathOf(piece, from, until);
    return [standingActor(piece, from, until, talks, follow, paces, landed), ...paths];
  };
  const standingActor = (piece: StandingActor, from: number, until: number, talks: readonly SpokenLine[], follow: readonly CutsceneNode[], paces: readonly Pace[], landed?: { atMs: number; at: Vec3 }): CutsceneNode => ({
    tag: "CCutsceneNodeActor",
    attrs: {
      guid: guid(),
      name: piece.name ?? piece.model,
      // A rider's attach point places and turns it, as Blizzard's riders mostly stand at 0,0,0.
      ...(piece.attach ? {} : { position: vector(piece.at) }),
      ...(piece.scale !== undefined ? { scale: vector(evenly(piece.scale)) } : {}),
      ...(piece.rotation !== undefined && !piece.attach ? { rotation: vector(typeof piece.rotation === "object" ? piece.rotation : [0, 0, piece.rotation]) } : {}),
      ...(piece.hidden ? { enabled: "0" } : {}),
      ...(piece.modelPath ? { modelPath: piece.modelPath.replace(/\//g, "\\") } : { modelLink: piece.model }),
      ...(piece.variation ? { variation: String(piece.variation) } : {}),
      shadowBox: "0",
      ...(piece.tint ? { tintColorRed: fixed(piece.tint[0]), tintColorGreen: fixed(piece.tint[1]), tintColorBlue: fixed(piece.tint[2]) } : {}),
      ...(piece.teamColor?.diffuse ? { teamColorDiffuse: vector(piece.teamColor.diffuse) } : {}),
      ...(piece.teamColor?.emissive ? { teamColorEmissive: vector(piece.teamColor.emissive) } : {}),
      ...(piece.opacity !== undefined ? { opacity: fixed(piece.opacity) } : {}),
    },
    children: [
      lifetime(piece.fromMs ?? 0, (piece.untilMs ?? totalMs) - (piece.fromMs ?? 0)),
      ...activeFor(piece.shots),
      {
        tag: "CCutsceneNodeAnimLayer",
        attrs: { guid: guid(), name: "Animation Layer" },
        children: held(piece, from, until, paces),
      },
      ...talking(talks, from, until, paces),
      ...(piece.says?.length ? [spoken(piece.says)] : []),
      ...follow,
      ...moving(piece, landed),
    ],
  });
  /**
   * An actor's copy for shot `index`, and the paths it follows, or none when it doesn't exist then:
   * alive from the cut (or its entrance) to the shot's end (or its exit), standing as it was left
   * as it came into being by every step that ended by then, and by a jump (a step to a point in a
   * frame or less, JUMP_MS) right then, with the steps that run in its life and the lines that
   * start in the shot, and talking through every line it lives through any of.
   */
  const copyOf = (piece: StandingActor, index: number): CutsceneNode[] | undefined => {
    // In whole ms, as the elements are written, so a line or a run on the cut lands on this copy.
    const [cut, end] = [Math.round(starts[index]!), Math.round(endOf(index))];
    const from = Math.max(Math.round(piece.fromMs ?? 0), cut);
    const until = piece.outlivesShot && piece.untilMs !== undefined ? Math.min(Math.round(piece.untilMs), Math.round(totalMs)) : Math.min(Math.round(piece.untilMs ?? totalMs), end);
    if (until <= from) return undefined;
    const moves = piece.moves ?? [];
    // A jump at its birth places it, rather than flying it there at a pace no frame could show.
    const settled = (step: ActorMove): boolean => step.startMs + step.durationMs <= from || (step.to !== undefined && step.durationMs <= JUMP_MS && Math.round(step.startMs) <= from);
    const done = moves.filter(settled);
    const last = <Key extends "to" | "rotation" | "scale" | "opacity">(key: Key): ActorMove[Key] => done.findLast((step) => step[key] !== undefined)?.[key];
    const [at, rotation, scale, opacity] = [last("to"), last("rotation"), last("scale"), last("opacity")];
    const own = moves.filter((step) => !settled(step) && step.startMs < end);
    const says = (piece.says ?? []).filter((line) => Math.round(line.startMs) >= cut && Math.round(line.startMs) < end);
    const talks = (piece.says ?? []).filter((line) => Math.round(line.startMs) < until && Math.round(line.startMs) + Math.round(line.durationMs) > from);
    const { shots: _shots, moves: _moves, says: _says, outlivesShot: _outlives, ...rest } = piece;
    const copy: StandingActor = {
      ...rest,
      name: `${tagOf(index)} ${piece.name ?? piece.model}`,
      ...(at ? { at } : {}),
      ...(rotation ? { rotation } : {}),
      ...(scale ? { scale } : {}),
      ...(opacity !== undefined ? { opacity } : {}),
      fromMs: from,
      untilMs: until,
      ...(own.length ? { moves: own } : {}),
      ...(says.length ? { says } : {}),
    };
    return standingNodes(copy, from, until, talks);
  };
  const shotsOf = (piece: { readonly shots?: readonly number[] | undefined }): Set<number> => new Set(piece.shots ?? []);
  const pieces = spec.standing ?? [];
  // Each actor's one node, or its copy in each shot, by its index (looks and lamps name actors so),
  // each the actor first and then the paths it follows.
  let singles: (CutsceneNode[] | undefined)[] = pieces.map((piece) => (single(piece.shots) ? standingNodes(piece, 0, totalMs) : undefined));
  let copyNodes: (CutsceneNode[] | undefined)[][] = spec.shots.map((_, index) => pieces.map((piece) => (!single(piece.shots) && shotsOf(piece).has(index) ? copyOf(piece, index) : undefined)));
  /** The actor node actor `actor` has in shot `shot`: its copy there, or its one node. */
  const nodeOf = (actor: number, shot: number | undefined): CutsceneNode | undefined => ((shot === undefined ? undefined : copyNodes[shot]![actor]) ?? singles[actor])?.[0];
  /** When a copy (in shot `shot`) or an actor's one node lives. */
  const lifeOf = (piece: StandingActor, shot: number | undefined): [number, number] =>
    shot === undefined ? [0, totalMs] : [Math.max(Math.round(piece.fromMs ?? 0), Math.round(starts[shot]!)), Math.min(Math.round(piece.untilMs ?? totalMs), Math.round(endOf(shot)))];
  // Look-ats name the actor looked at by guid, so they go on once every actor has its nodes: a
  // copy's at the other's copy in its shot, over its own life.
  const looking = (nodes: CutsceneNode[] | undefined, piece: StandingActor, shot: number | undefined): CutsceneNode[] | undefined => {
    const looks = piece.looks ?? [];
    const node = nodes?.[0];
    if (!nodes || !node || !looks.length) return nodes;
    const [from, until] = lifeOf(piece, shot);
    const elements = looks.flatMap((look, at): CutsceneNode[] => {
      const start = Math.max(from, Math.round(look.startMs));
      const end = Math.min(until, at + 1 < looks.length ? Math.round(looks[at + 1]!.startMs) : totalMs);
      const target = look.at === undefined ? undefined : nodeOf(look.at, shot);
      if (end <= start || !target) return [];
      return [
        {
          tag: "CCutsceneElementLookAt",
          attrs: { guid: guid(), ...(start > 0 ? { start: String(start) } : {}), duration: String(end - start), ...(end >= totalMs ? { lockedToEnd: "1" } : {}), lookAtGUID: target.attrs.guid!, lookAtType: look.type, lookAtAttachId: look.point },
          children: [],
        },
      ];
    });
    return elements.length ? [{ ...node, children: [...node.children, { tag: "CCutsceneNodeLookAt", attrs: { guid: guid(), name: "Look At" }, children: elements }] }, ...nodes.slice(1)] : nodes;
  };
  singles = singles.map((node, index) => looking(node, pieces[index]!, undefined));
  copyNodes = copyNodes.map((nodes, shot) => nodes.map((node, index) => looking(node, pieces[index]!, shot)));
  // A lamp riding an actor's attach point, as Editor-made fills ride a walker's overhead: a lamp's copy
  // rides the actor's copy in its shot. With no one there, it stands where the set puts it. Whatever
  // rides (a lamp, an actor, a camera) rides only while the actor's node lives, from `start` for
  // `duration` at most.
  const attached = (attach: StandingLamp["attach"], shot: number | undefined, from: number, duration: number): CutsceneNode[] => {
    const target = attach && nodeOf(attach.actor, shot);
    if (!attach || !target) return [];
    const carrier = pieces[attach.actor]!;
    const copied = shot !== undefined && copyNodes[shot]![attach.actor] !== undefined;
    const [born, gone] = copied ? lifeOf(carrier, shot) : [Math.round(carrier.fromMs ?? 0), Math.round(carrier.untilMs ?? totalMs)];
    const start = Math.max(from, born);
    const end = Math.min(from + duration, gone);
    if (end <= start) return [];
    const [offset, rotation] = [attach.offset ?? [0, 0, 0], attach.rotation ?? [0, 0, 0]];
    const values = { offsetX: offset[0], offsetY: offset[1], offsetZ: offset[2], rotationX: rotation[0], rotationY: rotation[1], rotationZ: rotation[2] };
    return [
      {
        tag: "CCutsceneNodeAttachment",
        attrs: { guid: guid(), name: "Attachment" },
        children: [
          {
            tag: "CCutsceneElementAttachment",
            attrs: {
              guid: guid(),
              ...(start > 0 ? { start: String(start) } : {}),
              duration: String(end - start),
              ...(end >= totalMs ? { lockedToEnd: "1" } : {}),
              attachGuid: target.attrs.guid!,
              attachName: attach.point,
              ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, fixed(value)])),
            },
            children: [],
          },
        ],
      },
    ];
  };
  // An actor riding another, as Blizzard's blades ride a hand: its Attachment after its anim layers,
  // where the Editor puts it, a copy riding the other's copy in its shot over its own life.
  const riding = (nodes: CutsceneNode[] | undefined, piece: StandingActor, shot: number | undefined): CutsceneNode[] | undefined => {
    const node = nodes?.[0];
    if (!nodes || !node || !piece.attach) return nodes;
    const [from, until] = lifeOf(piece, shot);
    const attachment = attached(piece.attach, shot, from, until - from);
    const after = node.children.findLastIndex((child) => child.tag === "CCutsceneNodeAnimLayer") + 1;
    return [{ ...node, children: [...node.children.slice(0, after), ...attachment, ...node.children.slice(after)] }, ...nodes.slice(1)];
  };
  singles = singles.map((node, index) => riding(node, pieces[index]!, undefined));
  copyNodes = copyNodes.map((nodes, shot) => nodes.map((node, index) => riding(node, pieces[index]!, shot)));
  const copies = copyNodes.map((nodes) => nodes.flatMap((node) => node ?? []));
  // A camera riding an actor, as Editor-made handheld cameras ride an invisible marine: its
  // Attachment after its lifetime, from the cut to the shot's end, on the actor's copy in the shot.
  spec.shots.forEach((shot, index) => {
    if (!shot.attach) return;
    const target = nodeOf(shot.attach.actor, index);
    if (!target) throw new Error(`Shot ${index}'s camera rides ${pieces[shot.attach.actor]?.name ?? `actor ${shot.attach.actor}`}, which doesn't exist in that shot`);
    const [start, end] = [Math.round(starts[index]!), Math.round(endOf(index))];
    const camera = cameras[index]!;
    cameras[index] = {
      ...camera,
      children: [camera.children[0]!, ...attached({ ...shot.attach, rotation: undefined }, index, start, end - start), ...camera.children.slice(1)],
    };
  });
  const lampNode = (lamp: StandingLamp, start: number, duration: number, camera?: string, shot?: number): CutsceneNode => ({
    tag: "CCutsceneNodeLight",
    attrs: {
      guid: guid(),
      name: lamp.name,
      position: vector(lamp.at),
      ...(lamp.rotation ? { rotation: vector(lamp.rotation) } : {}),
      type: lamp.type === "spot" ? "2" : "1",
      colorR: fixed(lamp.color[0]),
      colorG: fixed(lamp.color[1]),
      colorB: fixed(lamp.color[2]),
      colorMultiplier: fixed(lamp.strength),
      ...optional("attenuationStart", lamp.attenuationStart),
      ...optional("range", lamp.range),
      ...optional("hotspot", lamp.hotspot),
      ...optional("falloff", lamp.falloff),
      ...(lamp.shadows === false ? { shadowCasting: "0" } : {}),
    },
    children: [
      lifetime(start, duration),
      ...attached(lamp.attach, shot, start, duration),
      ...(camera ? [activeShot(camera)] : activeFor(lamp.shots)),
    ],
  });
  // A lamp that lights every shot stands at the top of LIGHTS, as does one tied only to views; one
  // tied to shots is copied into each, as a shot's own lights are. A lamp riding a copied actor
  // goes into that actor's shots.
  const lampShots = (entry: StandingLamp): readonly number[] | undefined => entry.shots ?? (entry.attach && !single(pieces[entry.attach.actor]?.shots) ? pieces[entry.attach.actor]!.shots : undefined);
  const lamps = (spec.lamps ?? []).filter((entry) => single(lampShots(entry))).map((entry) => lampNode(entry, 0, totalMs));
  const shotLamps = spec.shots.map((_, index) =>
    (spec.lamps ?? [])
      .filter((entry) => !single(lampShots(entry)) && new Set(lampShots(entry)).has(index))
      .map((entry) => lampNode({ ...entry, name: `${tagOf(index)} ${entry.name}` }, starts[index]!, endOf(index) - starts[index]!, cameras[index]!.attrs.guid!, index)),
  );

  // Its sounds besides the lines, each from its start to its end, as Editor-made scenes keep them in a
  // Sound folder. A sound that ends stops with its lifetime, and one that fades has Blizzard's
  // volume curve: its volume at its start and where the fade begins, then linear to 0 at its end.
  const sounds = (spec.sounds ?? []).map((sound): CutsceneNode => {
    const start = Math.round(sound.startMs);
    const end = Math.min(totalMs, Math.round(sound.endMs ?? totalMs));
    const fadeMs = Math.min(Math.round(sound.fadeOutMs ?? 0), end - start);
    const volume = sound.volume ?? 1;
    const fading = [{ time: start, value: volume }, ...(end - fadeMs > start ? [{ time: end - fadeMs, value: volume }] : []), { time: end, value: 0 }];
    return {
      tag: "CCutsceneNodeSound",
      attrs: {
        guid: guid(),
        name: sound.shot === undefined ? sound.sound : `${tagOf(sound.shot)} ${sound.sound}`,
        soundLink: sound.sound,
        ...optional("volumeScale", sound.volume),
        ...(sound.loop ? { mode: LOOP_FOREVER } : {}),
        ...(sound.fromMs ? { startOffset: String(Math.round(sound.fromMs)) } : {}),
      },
      children: [lifetime(start, end - start), ...(fadeMs > 0 ? [curveNode("volumeScale", spanKeys(fading, fading.slice(1).map(() => "linear")), "Volume")] : [])],
    };
  });

  // RTT: a node a channel, as an Editor-made opening cutscene keeps one in its RTT folder, with an element a
  // shot that feeds it, from the cut to the shot's end, filming the camera inside its actor's model
  // in that shot (Blizzard's CCutsceneElementRTTChannel: objectGUID and cameraIndex).
  const fed = spec.shots.flatMap((shot, index) => (shot.feed ? [{ ...shot.feed, index }] : []));
  const channels = [...new Set(fed.map((feed) => feed.channel))].sort((a, b) => a - b);
  const rtt: CutsceneNode[] = channels.map((channel) => ({
    tag: "CCutsceneNodeRTTChannel",
    attrs: { guid: guid(), name: `RTT Channel ${channel}`, RTTChannel: String(channel) },
    children: fed
      .filter((feed) => feed.channel === channel)
      .map((feed) => {
        const target = nodeOf(feed.actor, feed.index);
        if (!target) throw new Error(`Shot ${feed.index}'s feed films ${pieces[feed.actor]?.name ?? `actor ${feed.actor}`}, which doesn't exist in that shot`);
        const [start, end] = [Math.round(starts[feed.index]!), Math.round(endOf(feed.index))];
        return {
          tag: "CCutsceneElementRTTChannel",
          attrs: {
            guid: guid(),
            ...(start > 0 ? { start: String(start) } : {}),
            duration: String(end - start),
            ...(end >= totalMs ? { lockedToEnd: "1" } : {}),
            objectGUID: target.attrs.guid!,
            cameraIndex: String(feed.cameraIndex),
            ...optional("aspectRatio", feed.aspectRatio),
          },
          children: [],
        };
      }),
  }));

  // The scene's lines, from the map's conversation data (the Transmissions' own), at their starts.
  const conversation: CutsceneNode[] = spec.conversation
    ? [
        {
          tag: "CCutsceneNodeConversationDriver",
          attrs: { guid: guid(), name: `Conversation Driver (${spec.conversation.id})`, conversationLink: spec.conversation.id },
          children: spec.conversation.lines.map((line) => ({
            tag: "CCutsceneElementConversationDriver",
            attrs: { guid: guid(), ...(line.startMs > 0 ? { start: String(Math.round(line.startMs)) } : {}), lineId: line.lineId, previousOverlap: "500" },
            children: [],
          })),
        },
      ]
    : [];
  // Black in Blizzard's form: colour 0, full amount.
  const fade = (start: number, duration: number, fadeIn: boolean): CutsceneNode => ({
    tag: "CCutsceneElementFade",
    attrs: { guid: guid(), ...(start > 0 ? { start: String(start) } : {}), duration: String(duration), colorR: fixed(0), colorG: fixed(0), colorB: fixed(0), amount: fixed(1), unfadedAmount: fixed(0), fadeIn: fadeIn ? "1" : "0" },
    children: [],
  });
  const bookends: CutsceneNode[] = spec.bookends
    ? [
        { tag: "CCutsceneNodeFade", attrs: { guid: guid(), name: "Fade" }, children: [fade(0, BOOKENDS.fadeInMs, true), fade(shotsMs, BOOKENDS.fadeOutMs, false)] },
      ]
    : [];
  const endScene: CutsceneNode[] = spec.bookends
    ? [{ tag: "CCutsceneNodeEndScene", attrs: { guid: guid(), name: "End Scene Markers" }, children: [{ tag: "CCutsceneElementEndScene", attrs: { guid: guid(), start: String(totalMs) }, children: [] }] }]
    : [];

  // The base Light at t=0, then a switch on each cut that names one, with no blend (L3).
  const switches = spec.lightsInTurn
    ? spec.lightsInTurn.map((light, index) => ({ start: Math.round((totalMs * index) / spec.lightsInTurn!.length), light }))
    : [
        ...(spec.light && spec.shots[0]?.light === undefined ? [{ start: 0, light: spec.light }] : []),
        ...spec.shots.flatMap((shot, index) => (shot.light ? [{ start: starts[index]!, light: shot.light }] : [])),
      ];
  // Bookmarks, in time order, as the Cutscene Editor writes its Director's "Bookmarks" track.
  const bookmarkTrack: CutsceneNode[] = spec.bookmarks?.length
    ? [
        {
          tag: "CCutsceneNodeBookmark",
          attrs: { guid: guid(), name: "Bookmarks" },
          children: [...spec.bookmarks]
            .sort((x, y) => x.atMs - y.atMs)
            .map(({ name, atMs }) => ({
              tag: "CCutsceneElementBookmark",
              attrs: { guid: guid(), ...(atMs > 0 ? { start: String(Math.round(atMs)) } : {}), bookmarkName: name },
              children: [],
            })),
        },
      ]
    : [];
  const director: CutsceneNode = {
    tag: "CCutsceneNodeDirector",
    attrs: { guid: guid(), name: "Director" },
    children: [
      {
        tag: "CCutsceneNodeActiveCamera",
        attrs: { guid: guid(), name: "Active Camera" },
        children: cameras.slice(0, spec.shots.length).map((camera, index) => ({
          tag: "CCutsceneElementActiveCamera",
          attrs: { guid: guid(), ...(starts[index]! > 0 ? { start: String(starts[index]) } : {}), cameraIndex: "0", objectGuid: camera.attrs.guid! },
          children: [],
        })),
      },
      ...conversation,
      ...bookmarkTrack,
      ...bookends,
      ...(switches.length
        ? [
            {
              tag: "CCutsceneNodeActiveLight",
              attrs: { guid: guid(), name: "Active Light" },
              children: switches.map(({ start, light }) => ({ tag: "CCutsceneElementActiveLight", attrs: { guid: guid(), ...(start > 0 ? { start: String(start) } : {}), lightGUID: "0", lightID: light, lightIndex: "0", blendTime: "0" }, children: [] })),
            },
          ]
        : []),
      ...endScene,
    ],
  };
  // LIGHTS: the lamps that light every shot, then a folder a shot for its own lights and its lamp copies.
  const lights = [...lamps, ...spec.shots.flatMap((_, index) => (rigs[index]!.length || shotLamps[index]!.length ? [folder(folderName(index), [...rigs[index]!, ...shotLamps[index]!])] : []))];
  const root: CutsceneNode = {
    tag: "CutsceneState",
    attrs: { cutsceneVersion: "1.300000" },
    children: [
      director,
      // Each folder its standing actors are kept in, in the order they first come.
      ...[...new Set(pieces.flatMap((piece, index) => (singles[index] ? [piece.folder ?? "Set"] : [])))].map((name) =>
        folder(
          name,
          pieces.flatMap((piece, index) => (singles[index] && (piece.folder ?? "Set") === name ? singles[index]! : [])),
        ),
      ),
      ...(lights.length ? [folder("LIGHTS", lights)] : []),
      ...(sounds.length ? [folder("Sound", sounds)] : []),
      ...(rtt.length ? [folder("RTT", rtt)] : []),
      ...spec.shots.map((_, index) => folder(folderName(index), [cameras[index]!, ...copies[index]!, ...backdrops[index]!])),
      // The views no cut goes to, a Set cutscene's cameras.
      ...(spec.views?.length ? [folder("Cameras", cameras.slice(spec.shots.length))] : []),
    ],
  };
  return writeCutscene(root);
}

/**
 * Galaxy that plays `file` (under the map's Cutscenes folder) over the map from its start, in a
 * loop, for checking a cutscene in game. It plays in the world at `origin`, as HotS plays its story
 * cutscenes, so the map's own set shows around it. Init function: ShotCutscene_Init.
 *
 * Each run is an In-Game Cutscene: it pauses AI time, so timed waves wait, and Escape is meant to
 * skip it. Cinematic Mode alone doesn't pause AI time (NativeLib's CinematicMode has no AITimePause;
 * enemy-ai §9 Q8). A skip ends the skippable trigger early (cutscene §3.2), so as Blizzard's
 * mission scenes do, that trigger holds only the wait (onSkip null, no TriggerSkippableEnd), and the
 * loop runs it with wait. Ended or skipped, the loop then stops the cutscene once and restores AI
 * time once, unpausing only an AI that wasn't paused already, as NativeLib's Global Cinematic
 * Setting does. The skip isn't tested in game yet.
 */
export function playShotCutsceneScript(file: string, origin: Vec3 = [0, 0, 0]): string {
  const [x, y] = origin.map((value) => value.toFixed(1));
  return [
    "int ShotCutscene_cutscene;",
    "trigger ShotCutscene_WatchTrigger;",
    "",
    "bool ShotCutscene_Watch(bool testConds, bool runActions) {",
    "    TriggerSkippableBegin(PlayerGroupAll(), 0, null, true, false);",
    "    WaitForCutsceneToEnd(ShotCutscene_cutscene);",
    "    return true;",
    "}",
    "",
    "bool ShotCutscene_Play(bool testConds, bool runActions) {",
    "    bool aiWasPaused;",
    // Test Document shows data warnings and library errors over everything: switch off the
    // trigger-debug output that carries them, and the error panel.
    "    TriggerDebugOutputEnable(false);",
    "    TriggerDebugWindowOpen(false);",
    "    UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeErrorDisplayPanel, false);",
    // At map init the console isn't up yet, and Cinematic Mode switched on then left it showing.
    "    Wait(0.5, c_timeReal);",
    "    CinematicMode(PlayerGroupAll(), true, 0.0);",
    "    libNtve_gf_HideGameUI(false, PlayerGroupAll());",
    "    UISetCursorVisible(PlayerGroupAll(), false);",
    // The map's terrain, doodads and water would show through a set's windows; the loop keeps them
    // hidden all session (docs/reference/editor-and-engine.md, "Hide the map behind a Cinematic").
    "    EnvironmentShow(c_environmentAll, false);",
    "    while (true) {",
    "        aiWasPaused = AITimeIsPaused();",
    "        AITimePause(true);",
    `        ShotCutscene_cutscene = CutsceneCreateNew("Cutscenes\\\\${file}", Point(${x}, ${y}), 0.0, PlayerGroupAll(), true);`,
    "        TriggerExecute(ShotCutscene_WatchTrigger, true, true);",
    "        CutsceneStop(ShotCutscene_cutscene);",
    "        if (!aiWasPaused) {",
    "            AITimePause(false);",
    "        }",
    "        Wait(1.0, c_timeReal);",
    "    }",
    "    return true;",
    "}",
    "",
    "void ShotCutscene_Init() {",
    '    ShotCutscene_WatchTrigger = TriggerCreate("ShotCutscene_Watch");',
    '    TriggerAddEventMapInit(TriggerCreate("ShotCutscene_Play"));',
    "}",
  ].join("\n");
}

/**
 * Galaxy that plays a Cinematic, `file` under the map's Cutscenes folder, from map start in a loop,
 * for checking it in game. A Cinematic films its own sets, not the map, so it plays as LotV plays its
 * cinematics (RECIPES.md, "Cinematic"; libVoiC_gf_CampaignPlayCutscene2): in a full-screen dialog
 * drawn above the world, under Cinematic Mode at full screen, with the map's environment hidden (unless
 * `environmentShown`, for a Cinematic on the map's own ground) and
 * its units paused and hidden so they don't show through a set's windows. Each run pauses AI time and the map's
 * Music and Ambience soundtracks (libVoiC_gf_PlayCinematic's), waits in its
 * own skippable trigger as `playShotCutsceneScript` does, then stops the cutscene, closes the dialog
 * and restores AI time and the soundtracks once, skipped or not. Init function: Cinematic_Init.
 */
export function playCinematicScript(file: string, { environmentShown = false }: { readonly environmentShown?: boolean } = {}): string {
  return [
    "int Cinematic_dialog;",
    "int Cinematic_cutscene;",
    "trigger Cinematic_WatchTrigger;",
    "",
    "bool Cinematic_Watch(bool testConds, bool runActions) {",
    "    TriggerSkippableBegin(PlayerGroupAll(), 0, null, true, false);",
    "    WaitForCutsceneToEnd(Cinematic_cutscene);",
    "    return true;",
    "}",
    "",
    "bool Cinematic_Play(bool testConds, bool runActions) {",
    "    bool aiWasPaused;",
    "    unitgroup units;",
    "    int at;",
    "    unit picked;",
    "    TriggerDebugOutputEnable(false);",
    "    TriggerDebugWindowOpen(false);",
    "    UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeErrorDisplayPanel, false);",
    "    Wait(0.5, c_timeReal);",
    // Not Story Mode: its native is for Blizzard's maps only ("Calling StoryMode is not authorized").
    // Cinematic Mode hides the game UI, and a full screen drops its letterbox bars.
    "    CinematicMode(PlayerGroupAll(), true, 0.0);",
    "    UISetMode(PlayerGroupAll(), c_uiModeFullscreen, 0.0);",
    "    libNtve_gf_HideGameUI(false, PlayerGroupAll());",
    "    UISetCursorVisible(PlayerGroupAll(), false);",
    // The map's terrain, doodads and water, and its units, would show through a set's windows; the
    // loop keeps them hidden, the units paused, all session (docs/reference/editor-and-engine.md,
    // "Hide the map behind a Cinematic").
    ...(environmentShown ? [] : ["    EnvironmentShow(c_environmentAll, false);"]),
    "    units = UnitGroup(null, c_playerAny, RegionEntireMap(), UnitFilter(0, 0, 0, (1 << (c_targetFilterDead - 32))), 0);",
    // A session-long hide that's never undone, so unlike the cued Cinematic's trigger it keeps no record.
    "    at = UnitGroupCount(units, c_unitCountAll);",
    "    for (;; at -= 1) {",
    "        picked = UnitGroupUnitFromEnd(units, at);",
    "        if (picked == null) { break; }",
    "        libNtve_gf_PauseUnit(picked, true);",
    "        libNtve_gf_ShowHideUnit(picked, false);",
    "    }",
    "    while (true) {",
    "        aiWasPaused = AITimeIsPaused();",
    "        AITimePause(true);",
    // The map's music and ambience pause under each run, as Blizzard's cinematic wrappers pause them.
    "        SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryMusic, true, true);",
    "        SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryAmbience, true, true);",
    ...(environmentShown
      ? [
          // On the map's own ground, in the world at Point(64, 64), where it meets the terrain.
          `        Cinematic_cutscene = CutsceneCreateNew("Cutscenes\\\\${file}", Point(64, 64), 0.0, PlayerGroupAll(), false);`,
        ]
      : [
          "        DialogCreate(500, 400, c_anchorCenter, 0, 0, true);",
          "        Cinematic_dialog = DialogLastCreated();",
          "        DialogSetFullscreen(Cinematic_dialog, true);",
          "        DialogSetImageVisible(Cinematic_dialog, false);",
          "        DialogSetVisible(Cinematic_dialog, PlayerGroupAll(), true);",
          "        DialogControlCreate(Cinematic_dialog, c_triggerControlTypeCutscene);",
          "        DialogControlSetFullDialog(DialogControlLastCreated(), PlayerGroupAll(), true);",
          `        libNtve_gf_SetDialogItemCutscene(DialogControlLastCreated(), "Cutscenes\\\\${file}", PlayerGroupAll());`,
          "        libNtve_gf_SetDialogItemRenderType(DialogControlLastCreated(), c_triggerRenderTypeHDR, PlayerGroupAll());",
          "        Cinematic_cutscene = CutsceneGetTriggerControl(DialogControlLastCreated());",
        ]),
    "        CutscenePlay(Cinematic_cutscene);",
    "        TriggerExecute(Cinematic_WatchTrigger, true, true);",
    "        CutsceneStop(Cinematic_cutscene);",
    ...(environmentShown ? [] : ["        DialogDestroy(Cinematic_dialog);"]),
    "        if (!aiWasPaused) {",
    "            AITimePause(false);",
    "        }",
    "        SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryAmbience, false, true);",
    "        SoundtrackPause(PlayerGroupAll(), c_soundtrackCategoryMusic, false, true);",
    "        Wait(1.0, c_timeReal);",
    "    }",
    "    return true;",
    "}",
    "",
    "void Cinematic_Init() {",
    '    Cinematic_WatchTrigger = TriggerCreate("Cinematic_Watch");',
    '    TriggerAddEventMapInit(TriggerCreate("Cinematic_Play"));',
    "}",
  ].join("\n");
}
