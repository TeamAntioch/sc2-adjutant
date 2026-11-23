// A Cinematic's shot list, kept in the Workspace at missions/<id>/cinematics/<cinematicId>.json and
// listed in the Blueprint's `screenplay.script.cinematics` with the scene it plays. It films a cast
// on one or more Sets, each placed at an offset in the Cinematic's own frame, and its shots are timed
// to the scene's lines, not to the clock (ADR 0009).

import { z } from "zod";

import { ColorSchema, TeamColorSchema } from "./cinematic-set.js";
import { slugId } from "./mission-blueprint.js";

const finite = z.number().finite();
/** A shot's name for what it times: a cast member's id, or a set piece's `"<set id>/<piece id>"`. */
const TimedId = z.string().regex(/^[a-z][a-z0-9_-]*(\/[a-z][a-z0-9_-]*)?$/, 'A cast id, or a set piece\'s "<set id>/<piece id>"');
const Vec3Schema = z.tuple([finite, finite, finite]);

/** What a display's feed films: a set camera, `"<set id>/<camera name>"`, or a cast member, by id, through its model's own camera. */
const FeedTarget = z.string().min(1);

/**
 * A shot's feed in full: what it films (`camera`, as FeedTarget), the RTT channel it renders into
 * (when left out, the lowest the screens on the shot's set show, by data/display-channels.json, else
 * 0, which the Hyperion briefing holo's front reads; cutscene/feed-channels.ts), which of a cast member's
 * model's cameras (its CAM_ index, 0 when left out; a set camera is filmed through core's rig, whose
 * camera is its own), and the picture's width over its height (`aspectRatio`, as Blizzard gives its
 * portrait feeds 1.6 to 1.77; the channel's own when left out).
 */
const FeedSchema = z
  .object({
    camera: FeedTarget,
    channel: z.number().int().min(0).max(6).optional(),
    cameraIndex: z.number().int().nonnegative().optional(),
    aspectRatio: finite.positive().optional(),
  })
  .strict();
export type Feed = z.infer<typeof FeedSchema>;

/** A shot's feed as its full form: a bare target is `{ camera }`. */
export const feedOf = (feed: string | Feed | undefined): Feed | undefined => (typeof feed === "string" ? { camera: feed } : feed);

/** An orbit camera, as `write-shot-cutscene`'s ShotCamera takes it: it looks at `target`, its eye `distance` back along `yaw`. */
export const ShotCameraSchema = z.object({
  target: Vec3Schema,
  distance: finite,
  pitch: finite,
  yaw: finite,
  fov: finite,
  /** Degrees about its line of sight, a dutch angle; level (0) when left out. A move or path rolls it. */
  roll: finite.optional(),
  blur: finite.optional(),
  focalDepth: finite.optional(),
  falloff: z.object({ far: finite, near: finite }).optional(),
  /** How far from the eye shadows are drawn (the camera's shadowClip), in cells; 75, Blizzard's usual, when left out. Keep the subject inside it through a move. */
  shadowDistance: finite.positive().optional(),
});

const CinematicSetSchema = z
  .object({
    /** What the Cinematic's cameras and cast call this set: `"<id>/<camera name>"`. */
    id: slugId,
    /** The set's JSON (a Set, as `import-set` writes it), relative to the Mission's folder. */
    file: z.string().min(1),
    /** Where the set's 0,0,0 sits in the Cinematic. */
    offset: Vec3Schema.default([0, 0, 0]),
  })
  .strict();

/**
 * A facing in the model's own frame, as an author banks a ship: `heading` degrees about z, then
 * `pitch` nose up (+) or down about its own lateral axis, then `roll` about its nose (+ banks right,
 * − left). The engine applies an actor's (x, y, z) rotation about the world axes, z first, then y,
 * then x (R = Rx·Ry·Rz), so a bank is x only at heading 0 and y at 90; cutscene/turns' worldFacing converts.
 */
export type OwnFacing = { readonly heading: number; readonly pitch?: number | undefined; readonly roll?: number | undefined };

/**
 * Degrees about z, the Editor's own world-axis (x, y, z), or heading, pitch and roll in the model's
 * own frame, which the compile converts (worldFacing), so a later turn in degrees keeps the bank.
 */
const FacingSchema = z.union([finite, Vec3Schema, z.object({ heading: finite, pitch: finite.optional(), roll: finite.optional() }).strict()]);
export type Facing = z.infer<typeof FacingSchema>;

/**
 * A cast member turning its head to another from a line's start (`line`, a sound ID of the scene) or
 * `atMs` into the Cinematic (its start when it gives neither). `at` is a cast id or a set's mark, or
 * "ahead", which ends the look-at before it, so the head goes back to facing ahead: `type` is the Editor's look-at type
 * ("SlowHeadOnly", "InstantHeadOnly", "MedStanding" …; "SlowHeadOnly" when left out), `point` the
 * attach point it looks at ("Head" when left out).
 */
/** A look-at at this ends the one before it: the head faces ahead again. */
export const LOOK_AHEAD = "ahead";

const LookAtSchema = z
  .object({
    at: z.string().min(1),
    line: z.string().min(1).optional(),
    atMs: z.number().int().nonnegative().optional(),
    type: z.string().min(1).optional(),
    point: z.string().min(1).optional(),
  })
  .strict()
  .refine((look) => look.line === undefined || look.atMs === undefined, { message: "A look-at starts on a line or atMs into the Cinematic, not both", path: ["atMs"] });

/**
 * Where a cast member rides another: `to`, a cast id, at its model's attach point `point`
 * ("Ref_Damage 03", "Ref_Hardpoint 01"), offset and turned (the Editor's x, y, z) from it, so it
 * goes where the point goes, as Blizzard's blades ride a hand and a fire can ride a hull. In each
 * shot the member's copy rides the other's copy there.
 */
const AttachSchema = z
  .object({
    to: slugId,
    point: z.string().min(1),
    offset: Vec3Schema.optional(),
    rotation: Vec3Schema.optional(),
  })
  .strict();

/**
 * Where a shot's camera rides a cast member (its carrier), at `to`'s attach point `point`, `offset`
 * from it, so the camera goes where the point goes, while its distance, pitch, yaw, roll and lens
 * stay the shot camera's own. An Editor-made handheld camera: an invisible MarineXPR (opacity 0)
 * playing a slowed Stand, Walk or Flail, its Ref_Head carrying the camera. The camera's own target
 * is still written as its position, since Editor-made cameras on still rigs film from it: aim it at the
 * carrier's point, as theirs are.
 */
const CameraAttachSchema = z
  .object({
    to: slugId,
    point: z.string().min(1),
    offset: Vec3Schema.optional(),
  })
  .strict();

const CastSchema = z
  .object({
    id: slugId,
    model: z.string().min(1),
    /**
     * The set the member stands on: on one of its marks (hidden, as the source hid it, from the shots
     * through that set's cameras the mark wasn't seen in), or at a point of the set's own with a
     * facing (degrees about z). A member with both a mark and a point is the mark's character starting
     * at the point, as one who walks onto the mark: the mark's look-at, the lamps attached to it and
     * its hiding are theirs, and they start at `at`, facing `facing`.
     */
    set: slugId,
    mark: z.string().min(1).optional(),
    at: Vec3Schema.optional(),
    /** Degrees about z; or, for a ship banked or nose down, the Editor's own (x, y, z), or `{ heading, pitch, roll }` in its own frame. */
    facing: FacingSchema.optional(),
    /** The Screenplay speaker whose lines this member says, e.g. "RAYNOR". */
    speaker: z.string().min(1).optional(),
    /** Even, or (x, y, z) along the model's own axes (a ship stretched along its length). */
    scale: z.union([finite.positive(), Vec3Schema]).optional(),
    /** 0 (invisible) to 1; opaque when left out. A shot's `moves` fade it from here. */
    opacity: z.number().min(0).max(1).optional(),
    /** The looping animation it holds all through; "Stand" when left out. */
    anim: z.string().min(1).optional(),
    /** How fast its anims play (the anim's timeScale): 0.5 at half speed, 2 at double; their own speed when left out. */
    animSpeed: finite.positive().optional(),
    /** Team colours, 0-1 RGBA, as a Set's pieces take them: a ship's or a unit's paint. */
    teamColor: TeamColorSchema.optional(),
    /** Its colour multiplied by this, as a Set's pieces take it: red, green and blue, 1 each for none (a planet stand-in tinted blue). */
    tint: ColorSchema.optional(),
    /**
     * Where it looks, in time order, each until the next: at another cast member, by id or as
     * `"<set id>/<mark name>"` for the one cast on that mark. In place of its mark's look-at.
     */
    lookAts: z.array(LookAtSchema).min(1).optional(),
    /**
     * Rides another cast member's attach point in place of standing on a mark or at a point: it
     * shows only in the shots the other does, and exists only while the other does. Its anims,
     * opacity, scale, look-ats, enters and exits are still its own; a shot's moves may only scale and
     * fade it, since it goes and turns with the other.
     */
    attach: AttachSchema.optional(),
  })
  .strict()
  .superRefine((member, context) => {
    if (member.attach !== undefined) {
      for (const key of ["mark", "at", "facing"] as const) {
        if (member[key] !== undefined) context.addIssue({ code: "custom", path: [key], message: `${member.id} rides ${member.attach.to}'s ${member.attach.point}, so it has no ${key === "at" ? "point" : key} of its own: give its place as the attach's offset and rotation` });
      }
      return;
    }
    if (member.mark === undefined && member.at === undefined) context.addIssue({ code: "custom", path: ["mark"], message: "A cast member stands on a mark, at a point (at), or rides another (attach)" });
    if (member.mark !== undefined && member.at === undefined && member.facing !== undefined) context.addIssue({ code: "custom", path: ["facing"], message: "A mark gives its own facing" });
  });

/**
 * One step of a cast member's move through a shot: from where the step before left it (its own
 * point or mark before any) to `to`, in its set's frame. Steps run one after another from the
 * shot's cut. Steps to points fly it along a follow path through them, nose first, at the pace each
 * leg needs to take its step's time.
 */
const MoveStepSchema = z
  .object({
    /** Where it goes; it stays put when left out (a step may only turn, scale or fade it). */
    to: Vec3Schema.optional(),
    /**
     * With `to`, how it faces along its path from this leg on, until a later step gives another:
     * turned off the path's direction (heading 0 is nose first; a bank is a roll), in degrees off
     * its heading, its own frame's `{ heading, pitch, roll }`, or the Editor's (x, y, z) in its own
     * frame. It turns there at the leg's start. Without `to`, a turn on the spot to that facing in
     * the world, over the step.
     */
    facing: FacingSchema.optional(),
    /** Scales it to this: even, or (x, y, z) along the model's own axes. */
    scale: z.union([finite.positive(), Vec3Schema]).optional(),
    /** Fades it to this, 0 (invisible) to 1. */
    opacity: z.number().min(0).max(1).optional(),
    /** Holds this long after the step before ends (or the cut) before it moves. */
    afterMs: z.number().int().nonnegative().optional(),
    /** How long it takes; the rest of the shot when left out, which only the last step may. */
    ms: z.number().int().positive().optional(),
    /** "ease" (the default) leaves at speed and settles, as a warp-in arrives; "linear" keeps one speed, for a drift or a camera to keep pace with. */
    move: z.enum(["ease", "linear"]).optional(),
  })
  .strict()
  .refine((step) => step.to !== undefined || step.facing !== undefined || step.scale !== undefined || step.opacity !== undefined, { message: "A step moves (to), turns (facing), scales (scale) or fades (opacity) its member" });
export type MoveStep = z.infer<typeof MoveStepSchema>;

/**
 * An anim that starts `atMs` into the shot and, with `once`, plays a single time (a warp flash's
 * Birth). `fromMs` is its in-point, how far into the clip it starts (the Editor's startOffset), at
 * the clip's own pace: a prop's door that only opens 10 s into a long Dialogue clip plays
 * `{ "anim": "Dialogue 08", "fromMs": 10000 }`. Left out, the clip plays from its start. With
 * `once` it plays from there to the clip's end; looping, it comes back round to the clip's start.
 */
const TimedAnimSchema = z
  .object({
    anim: z.string().min(1),
    atMs: z.number().int().nonnegative().optional(),
    once: z.literal(true).optional(),
    fromMs: z.number().int().positive().optional(),
    /** How fast it plays: 0.5 at half speed, 2 at double; the member's animSpeed when left out. */
    speed: finite.positive().optional(),
    /**
     * Where it ranks against the member's other anims playing at once, as the Editor writes it: the
     * higher plays over the lower. A member's anims run one after another, so what it can play under
     * or over is a speaker's Talk, at 4: above 4 keeps it over the Talk. 3, a Stand's, when left out;
     * Blizzard writes a Walk at 5, a Birth or Fidget at 7, an Attack at 9 and a Death at 11.
     */
    priority: z.number().int().nonnegative().optional(),
  })
  .strict();
export type TimedAnim = z.infer<typeof TimedAnimSchema>;

/**
 * A shot's anim for a cast member: a looping one through the shot, a timed one, or a list of timed
 * ones in time order, each running until the next (a walker turning left, then right).
 */
const ShotAnimSchema = z.union([z.string().min(1), TimedAnimSchema, z.array(TimedAnimSchema).min(1)]);
export type ShotAnim = z.infer<typeof ShotAnimSchema>;

/** A shot's anim for a member as its timed anims, each with its path under the member's entry ("" for one not in a list). */
export function timedAnims(anim: ShotAnim): readonly { readonly at: string; readonly timed: TimedAnim }[] {
  if (typeof anim === "string") return [{ at: "", timed: { anim } }];
  return Array.isArray(anim) ? anim.map((timed, index) => ({ at: `.${index}`, timed })) : [{ at: "", timed: anim }];
}

/** A point light for one shot, tied to its camera (L5/L6): a key, a fill, a rim. Colour 0-1 per channel; full strength out to half its range. */
const ShotLightSchema = z
  .object({
    name: z.string().min(1),
    at: Vec3Schema,
    color: Vec3Schema,
    strength: finite,
    range: finite.positive(),
    /** Casts shadows; off when absent, so the base Light's key stays the one shadow-caster. */
    shadows: z.literal(true).optional(),
    /** A spot, aimed by `rotation` (the Editor's (x, y, z)), with its cone's hotspot and falloff as the Editor writes them (Blizzard's warp flash: 0.2 and 0.6); an omni when left out. */
    spot: z.object({ rotation: Vec3Schema, hotspot: z.number().min(0).optional(), falloff: z.number().min(0).optional() }).strict().optional(),
    /**
     * Its strength's changes through the shot, as a member's moves time theirs: each from the last
     * strength to `strength`, after holding `afterMs`, over `ms` (the last may take the rest of the
     * shot), eased or linear. A flash: `strength` 10, then a step to 0.
     */
    steps: z
      .array(
        z
          .object({
            strength: z.number().min(0),
            afterMs: z.number().int().nonnegative().optional(),
            ms: z.number().int().positive().optional(),
            move: z.enum(["ease", "linear"]).optional(),
          })
          .strict(),
      )
      .min(1)
      .optional(),
  })
  .strict();

const ShotSchema = z
  .object({
    /**
     * The camera: one of a set's named cameras, `"<set id>/<camera name>"`, or a camera of its own,
     * in its `set`'s frame (the Cinematic's without one).
     */
    camera: z.union([z.string().min(1), ShotCameraSchema.strict()]),
    /**
     * The set a shot through a camera of its own films: its camera, move and lights are in that set's
     * frame, and it sees the set's pieces and lamps. A shot through a set camera is on that camera's set.
     */
    set: slugId.optional(),
    /** Moves the camera over the whole shot to another camera of the shot's set, or one of its own in the set's frame. */
    to: z.union([z.string().min(1), ShotCameraSchema.strict()]).optional(),
    /**
     * In place of `to`, the cameras it moves through from the shot's own, each reached `atMs` after the
     * cut, in time order: cameras of the shot's set, or of its own in the set's frame. The last key may
     * leave out atMs: it's at the shot's end. Yaw and roll go the way the numbers do, not the short way
     * round: 350 to 10 swings 340° back, and 350 to 370 turns 20° on. A camera of its own keeps the
     * shot's camera's roll unless it gives one.
     */
    path: z
      .array(z.object({ camera: z.union([z.string().min(1), ShotCameraSchema.strict()]), atMs: z.number().int().positive().optional() }).strict())
      .min(1)
      .optional(),
    /**
     * How it moves: "ease" (`to`'s default) leaves each key at speed and settles onto the next;
     * "linear" keeps one speed, to keep pace with a subject; "smooth" (a path's default) flies through
     * every key with no kink in speed or turn, starting and ending at rest (the Editor's Auto tangent).
     */
    move: z.enum(["ease", "linear", "smooth"]).optional(),
    /**
     * Shakes the camera, `atMs` after the cut (0 when left out) for `ms` (the rest of the shot when left
     * out): its target jolts up to `amplitude` cells each way, `hz` times a second, and with `roll`, its
     * roll up to that many degrees. On top of a move or path, and still before and after.
     */
    shake: z
      .object({
        amplitude: finite.positive(),
        hz: z.number().positive().max(15),
        roll: finite.positive().optional(),
        atMs: z.number().int().nonnegative().optional(),
        ms: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    /**
     * Rides the camera on a cast member's attach point (its carrier, which must show in the shot): the
     * point carries it, and the camera keeps its own distance, pitch, yaw, roll and lens. A move
     * (`to`, `path`) still dollies, turns and zooms it, but no curve keys its target, so move the
     * carrier to travel; a `shake` would jolt that target, so shake the carrier (a Flail) instead.
     */
    cameraAttach: CameraAttachSchema.optional(),
    /** Lights of the shot's own, in its set's frame, seen only in it. */
    lights: z.array(ShotLightSchema).optional(),
    /** Switches the base Light on this shot's cut, with no blend (L3); it holds until another shot switches it. */
    light: z.string().min(1).optional(),
    /** The shot's name in the Cutscene Editor; the camera's name when left out. */
    name: z.string().min(1).optional(),
    /** The sound ID of the line it cuts on, at that line's start. The shot carries that line and every later one no shot names. */
    line: z.string().min(1).optional(),
    /** Cuts this far into its line instead of on its start: the shot before carries the line's start. */
    intoLineMs: z.number().int().positive().optional(),
    /**
     * Starts its line this long after its cut, not on it: a J cut's lead, the line heard over this
     * shot before a later shot cuts into it (intoLineMs). For the first shot, from the Cinematic's start.
     */
    lineAtMs: z.number().int().positive().optional(),
    /** A shot with no line: it cuts this long after the shot before it ends. */
    afterMs: z.number().int().nonnegative().optional(),
    /** Holds the shot this long after its lines end (or, for a shot with no line, after it starts) before the next line or shot. */
    pauseAfterMs: z.number().int().nonnegative().optional(),
    /**
     * Cast members hidden in this shot, by cast id. A camera of a shot's own shows every cast member,
     * so a character cast on two marks (two actors) would show twice without it.
     */
    hide: z.array(slugId).optional(),
    /**
     * Cast members' animations through this shot, by cast id: a looping one in place of their Stand
     * and Talk, or timed ones in place of their Stand, a speaker's Talk still playing over them on its lines.
     */
    anims: z.record(slugId, ShotAnimSchema).optional(),
    /**
     * Cast members moving through this shot, by cast id, and set pieces fading and scaling, by
     * `"<set id>/<piece id>"`: their steps, in order. Each stays where its last step ends.
     */
    moves: z.record(TimedId, z.array(MoveStepSchema).min(1)).optional(),
    /**
     * Cast members whose steps to points in this shot are keyed (position and rotation curves), not
     * flown along a follow path: each step's `facing` is then where the member faces in the set's
     * frame, as for a turn on the spot, and turns between steps along the true turn. For a member
     * that pitches and banks all the way, which a follow path can't show (its offset steps, one per
     * follow, and pitch and bank don't combine in it as expected).
     */
    keyed: z.array(slugId).optional(),
    /**
     * What the display shows through this shot, live, by render-to-texture: a set camera
     * (`"<set id>/<camera name>"`), whose set's pieces, cast and lamps are then copied into the shot
     * as if it were on that set too, or a cast member whose model carries a camera of its own (a
     * portrait), by cast id. A display is a model whose material reads an RTT channel (Blizzard's
     * Hyperion briefing holo reads 0 to 2); with no feed it shows its own fallback, static.
     */
    feed: z.union([FeedTarget, FeedSchema]).optional(),
    /** Cast members, by cast id, and set pieces, by `"<set id>/<piece id>"`, that come into being this far into this shot (a ship popping in); before it they don't exist. */
    enters: z.record(TimedId, z.number().int().nonnegative()).optional(),
    /** Cast members and set pieces that go this far into this shot, named as in `enters`; after it they don't exist. */
    exits: z.record(TimedId, z.number().int().nonnegative()).optional(),
  })
  .strict()
  .superRefine((shot, context) => {
    if ((shot.line === undefined) === (shot.afterMs === undefined)) context.addIssue({ code: "custom", path: ["line"], message: "A shot starts on a line or afterMs after the shot before, not both" });
    if (shot.intoLineMs !== undefined && shot.line === undefined) context.addIssue({ code: "custom", path: ["intoLineMs"], message: "intoLineMs cuts into the shot's line, so it needs one" });
    if (shot.lineAtMs !== undefined && shot.line === undefined) context.addIssue({ code: "custom", path: ["lineAtMs"], message: "lineAtMs starts the shot's line after its cut, so it needs one" });
    if (shot.lineAtMs !== undefined && shot.intoLineMs !== undefined) context.addIssue({ code: "custom", path: ["lineAtMs"], message: "A shot cuts into its line (intoLineMs) or starts it after its cut (lineAtMs), not both" });
    const lastOnly = (steps: readonly { ms?: number | undefined }[], path: readonly (string | number)[]): void =>
      steps.forEach((step, at) => {
        if (step.ms === undefined && at < steps.length - 1) context.addIssue({ code: "custom", path: [...path, at, "ms"], message: "Only a shot's last step may leave out ms: it takes the rest of the shot" });
      });
    for (const [id, steps] of Object.entries(shot.moves ?? {})) lastOnly(steps, ["moves", id]);
    if (shot.cameraAttach && shot.shake) context.addIssue({ code: "custom", path: ["shake"], message: `The camera rides ${shot.cameraAttach.to}, which holds its target, so a shake can't jolt it: shake ${shot.cameraAttach.to} instead (a looping Flail or Walk anim)` });
    if (shot.path && shot.to !== undefined) context.addIssue({ code: "custom", path: ["path"], message: "A shot's camera moves to one camera (to) or along a path, not both" });
    let before = 0;
    (shot.path ?? []).forEach((key, at, path) => {
      if (key.atMs === undefined) {
        if (at < path.length - 1) context.addIssue({ code: "custom", path: ["path", at, "atMs"], message: "Only a path's last key may leave out atMs: it's at the shot's end" });
        return;
      }
      if (key.atMs <= before) context.addIssue({ code: "custom", path: ["path", at, "atMs"], message: "A path's keys come in time order, each after the one before" });
      before = key.atMs;
    });
    (shot.lights ?? []).forEach((light, index) => light.steps && lastOnly(light.steps, ["lights", index, "steps"]));
  });

/**
 * A sound the Cinematic plays besides its lines: a music cue, a stinger, an ambience of its own. It
 * starts on a line's start (`line`, a sound ID of its scene) or `atMs` into the Cinematic (its start
 * when it gives neither), and plays once, or looping with `loop`, until its end: on a line's start
 * (`untilLine`) or `untilMs` into the Cinematic, else the Cinematic's end. `fadeOutMs` fades it to
 * silence over that long before its end, so two music cues hand over when one ends on the line the
 * other starts on. `fromMs` is its in-point, how far into its file it starts; `volume` scales it
 * (the Editor's volumeScale), 1 when left out.
 */
const CinematicSoundSchema = z
  .object({
    sound: z.string().min(1),
    line: z.string().min(1).optional(),
    atMs: z.number().int().nonnegative().optional(),
    untilLine: z.string().min(1).optional(),
    untilMs: z.number().int().positive().optional(),
    fadeOutMs: z.number().int().positive().optional(),
    fromMs: z.number().int().positive().optional(),
    volume: z.number().min(0).optional(),
    loop: z.literal(true).optional(),
  })
  .strict()
  .refine((sound) => sound.line === undefined || sound.atMs === undefined, { message: "A sound starts on a line or atMs into the Cinematic, not both", path: ["atMs"] })
  .refine((sound) => sound.untilLine === undefined || sound.untilMs === undefined, { message: "A sound ends on a line or untilMs into the Cinematic, not both", path: ["untilMs"] });
export type CinematicSound = z.infer<typeof CinematicSoundSchema>;

/**
 * A named point in the Cinematic that a Mission's `cinematicBookmark` cue can hang a scene on. It sits
 * on a line's start (`line`, a sound ID of the Cinematic's scene) or `atMs` into the Cinematic, as a
 * sound starts. The file holds it as `<Cinematic id>/<name>`, so two Cinematics may use one name.
 *
 * A bookmark is heard only as playback passes it: a skip, or a jump over it, doesn't play it, which
 * is why the cue chooses whether the skip fires it (docs/reference/editor-and-engine.md, "A
 * cutscene's events").
 */
const CinematicBookmarkSchema = z
  .object({
    name: z.string().trim().min(1),
    line: z.string().min(1).optional(),
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((bookmark) => (bookmark.line === undefined) !== (bookmark.atMs === undefined), { message: "A bookmark sits on a line or atMs into the Cinematic: name one of them", path: ["line"] });
export type CinematicBookmark = z.infer<typeof CinematicBookmarkSchema>;

/** A bookmark's name in the cutscene file, and so in the event a trigger listens for. */
export const bookmarkEventName = (cinematicId: string, name: string): string => `${cinematicId}/${name}`;

export const CinematicSchema = z
  .object({
    /**
     * What it is, for its length's norm (T4): a story cinematic runs about a minute, an insert inside
     * a mission about 15 s. A story cinematic when left out.
     */
    kind: z.enum(["story", "insert"]).optional(),
    sets: z.array(CinematicSetSchema).min(1),
    /** The base Light at t=0, unless the first shot switches it; the first set's first Light when both are left out. */
    light: z.string().min(1).optional(),
    cast: z.array(CastSchema).default([]),
    shots: z.array(ShotSchema).min(1),
    /** Sounds besides the lines, and besides its sets' ambience, which loops through each set's shots. */
    sounds: z.array(CinematicSoundSchema).optional(),
    /** Named points a Mission's cues can play scenes from (CinematicBookmarkSchema). */
    bookmarks: z.array(CinematicBookmarkSchema).optional(),
  })
  .strict()
  .superRefine((cinematic, context) => {
    const named = new Set<string>();
    (cinematic.bookmarks ?? []).forEach((bookmark, index) => {
      if (named.has(bookmark.name)) context.addIssue({ code: "custom", path: ["bookmarks", index, "name"], message: `Two bookmarks are called ${bookmark.name}` });
      named.add(bookmark.name);
    });
    cinematic.cast.forEach((member, index) => {
      if (member.id === LOOK_AHEAD) context.addIssue({ code: "custom", path: ["cast", index, "id"], message: `A cast member can't be called ${LOOK_AHEAD}: a look-at at "${LOOK_AHEAD}" ends the one before` });
    });
    for (const kind of ["sets", "cast"] as const) {
      const seen = new Set<string>();
      cinematic[kind].forEach((entry, index) => {
        if (seen.has(entry.id)) context.addIssue({ code: "custom", path: [kind, index, "id"], message: `Two ${kind} entries are called ${entry.id}` });
        seen.add(entry.id);
      });
    }
  });
export type Cinematic = z.infer<typeof CinematicSchema>;
export type CinematicShot = Cinematic["shots"][number];
