// A trigger scene: a Screenplay scene staged on the Mission's own map in Cinematic Mode, with the
// Blueprint's camera Anchors and the scene's lines as Transmissions (the cinematography skill's
// RECIPES.md "Trigger scene"). Kept in the Workspace at missions/<id>/trigger-scenes/<id>.json and
// listed in the Blueprint's `screenplay.script.triggerScenes` with the scene it plays, or a victory
// outro with no scene by its outcome (ADR 0012).
// Its shots are timed to the scene's lines, as a Cinematic's are (ADR 0009).

import { z } from "zod";

import { slugId } from "./mission-blueprint.js";

/** Where a staged unit stands or goes: a point Anchor (or a Kept point) by id, or a position on the map. */
const PlaceSchema = z.union([slugId, z.object({ x: z.number().finite(), y: z.number().finite() }).strict()]);
export type TriggerScenePlace = z.infer<typeof PlaceSchema>;

/**
 * A unit (or a few of one type) created for the scene, so it never films or loses the live army
 * (O3): created under black in Setup, for the player it names, and removed in Cleanup on a skip and
 * the natural end alike.
 */
const CastSchema = z
  .object({
    /** The name shots order it by. */
    id: slugId,
    /** Its CUnit id, the game's or the Campaign Mod's. */
    unitType: z.string().min(1),
    player: z.number().int().min(0).max(15),
    /** How many of it, created together at `at`. */
    count: z.number().int().positive().optional(),
    at: PlaceSchema,
    /** Facing in degrees, as the Editor's (270, south, when left out). */
    facing: z.number().finite().optional(),
  })
  .strict();
export type TriggerSceneCast = z.infer<typeof CastSchema>;

/**
 * A live unit the scene films, by its unit Anchor (or a Kept unit): hidden or paused for the scene
 * and put back in Cleanup, unless the mission had already hidden or paused it.
 */
const LiveSchema = z
  .object({
    unit: slugId,
    hide: z.boolean().optional(),
    pause: z.boolean().optional(),
  })
  .strict()
  .refine((live) => live.hide || live.pause, { message: "A live unit is hidden, paused or both: give hide or pause" });
export type TriggerSceneLive = z.infer<typeof LiveSchema>;

/**
 * A live unit, by its unit Anchor (or a Kept unit), moved at once in Setup, under black, to a point
 * and faced: on its mark for the scene, and still there at the handback unless a shot walks it on.
 */
const MarkSchema = z
  .object({
    unit: slugId,
    at: PlaceSchema,
    /** Facing in degrees, as the Editor's; the unit keeps its own when left out. */
    facing: z.number().finite().optional(),
  })
  .strict();
export type TriggerSceneMark = z.infer<typeof MarkSchema>;

/**
 * An order given at the shot's cut, or `atMs` after it: a staged unit's group (`cast`), live units
 * by unit Anchor (`units`), or a player's units in a Zone (`player` and `inZone`: every unit of
 * theirs there that isn't a structure, gathered at the order, as a warp-out gathers an army) walk to
 * a place. With `withdraw`, each is removed on reaching it. Its final state is the same skipped or
 * watched: Cleanup puts each live unit walked there at once, and removes each that withdraws (and
 * the staged cast) wherever it is. A Zone's order settles last, once the scene's other orders, warps
 * and unit changes are in place: on a skip that came before it, Cleanup gathers the units in the
 * Zone then, leaving out what the scene brings there after the order.
 */
const OrderSchema = z
  .object({
    cast: slugId.optional(),
    units: z.array(slugId).min(1).optional(),
    player: z.number().int().min(0).max(15).optional(),
    /** The Zone (or Kept region) whose units of `player`'s the order walks. */
    inZone: slugId.optional(),
    moveTo: PlaceSchema,
    atMs: z.number().int().nonnegative().optional(),
    withdraw: z.boolean().optional(),
  })
  .strict()
  .superRefine((order, context) => {
    if ([order.cast, order.units, order.player].filter((to) => to !== undefined).length !== 1)
      context.addIssue({ code: "custom", message: "An order is to a staged unit (cast), live units (units) or a player's units in a Zone (player and inZone): give one" });
    else if (order.player !== undefined && order.inZone === undefined) context.addIssue({ code: "custom", path: ["inZone"], message: "An order to a player's units names the Zone they're in: give inZone" });
    else if (order.inZone !== undefined && order.player === undefined) context.addIssue({ code: "custom", path: ["inZone"], message: "inZone is the Zone of an order to a player's units: give player with it, or leave it out" });
  });
export type TriggerSceneOrder = z.infer<typeof OrderSchema>;

/**
 * Units warped in for a player at the shot's cut, or `atMs` after it, round a place: created one by
 * one, evenly round it at `radius` cells (1.5 when left out; at the place itself for one), each with
 * the Protoss warp-in effect. They are the player's after the handback: a skip that comes first has
 * Cleanup create them, with no effect.
 */
const WarpInSchema = z
  .object({
    /** The name a build names it by. */
    id: slugId,
    /** Its CUnit id, the game's or the Campaign Mod's. */
    unitType: z.string().min(1),
    player: z.number().int().min(0).max(15),
    count: z.number().int().positive().optional(),
    at: PlaceSchema,
    radius: z.number().finite().nonnegative().optional(),
    /** Facing in degrees, as the Editor's (270, south, when left out). */
    facing: z.number().finite().optional(),
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict();
export type TriggerSceneWarpIn = z.infer<typeof WarpInSchema>;

/**
 * A structure built at the shot's cut, or `atMs` after it, and finished at once: the builder (the
 * first unit of a warp-in, or a live unit Anchor) is ordered to build it at a point with its build
 * ability's first command, and once the builder is idle the structure is set to 100% (a Probe is
 * idle once it has placed it; an SCV stays to build it, so its structure is finished only in the
 * Cleanup). If a skip comes first, or nothing was placed, Cleanup cancels the order and creates the
 * structure finished, or finishes the one placed.
 */
const BuildSchema = z
  .object({
    warpIn: slugId.optional(),
    unit: slugId.optional(),
    /** The structure's CUnit id. */
    unitType: z.string().min(1),
    /** The builder's build ability (a CAbilBuild id, such as ProtossBuild), whose first command builds `unitType`. */
    ability: z.string().min(1),
    at: PlaceSchema,
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((build) => (build.warpIn === undefined) !== (build.unit === undefined), { message: "A build is by a warp-in's unit (warpIn) or a live unit (unit): give one" });
export type TriggerSceneBuild = z.infer<typeof BuildSchema>;

/**
 * Units warped out at the shot's cut, or `atMs` after it: live unit Anchors (`units`), or every
 * unit of a player's that isn't a structure (`player`, the army) but the unit Anchors in `except`,
 * each given the warp effect and removed once it has played. A skip that comes first has Cleanup
 * remove them, and leave those in `except` too.
 */
const WarpOutSchema = z
  .object({
    units: z.array(slugId).min(1).optional(),
    player: z.number().int().min(0).max(15).optional(),
    /** Unit Anchors kept out of a player's army: they stay, as heroes do while it's recalled. */
    except: z.array(slugId).min(1).optional(),
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((warp) => (warp.units === undefined) !== (warp.player === undefined), { message: "A warp-out is of live units (units) or a player's army (player): give one" })
  .refine((warp) => warp.except === undefined || warp.units === undefined, {
    message: "except keeps units out of a player's army (player); a warp-out of units lists only those it takes",
  });
export type TriggerSceneWarpOut = z.infer<typeof WarpOutSchema>;

/** An actor message as the Editor writes it, such as "Signal WarpBeaconOn": no quotes, backslashes or markup, which it would have to escape. */
const ActorMessageSchema = z
  .string()
  .regex(/^[^"\\<>&\r\n]+$/, { message: 'An actor message is one line with no ", \\, <, > or &' })
  .refine((message) => message.trim() === message, { message: "An actor message has no space at either end" });

/**
 * Actor messages sent at the shot's cut or `atMs` after it, as a model swaps, attachments come and
 * go or a light comes on: to a live unit's actor, by its unit Anchor (or a Kept unit), or to every
 * unit of a staged unit's group (`cast`). `messages` leave the state the unit keeps: a skip that
 * comes first has Cleanup send them. `effects` play once, as a flash does, and are never replayed.
 * Messages are sent before effects, each in turn. The staged cast is removed in the Cleanup, so
 * what it's sent is effects only.
 */
const ActorEventSchema = z
  .object({
    unit: slugId.optional(),
    cast: slugId.optional(),
    messages: z.array(ActorMessageSchema).min(1).optional(),
    effects: z.array(ActorMessageSchema).min(1).optional(),
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if ((event.unit === undefined) === (event.cast === undefined)) context.addIssue({ code: "custom", message: "An actor event is to a staged unit (cast) or a live unit (unit): give one" });
    if (event.messages === undefined && event.effects === undefined) context.addIssue({ code: "custom", message: "An actor event sends messages, effects or both: give one" });
    if (event.cast !== undefined && event.messages !== undefined) {
      context.addIssue({ code: "custom", path: ["messages"], message: "The staged cast is removed in the Cleanup, so its actor events send effects only: move these to effects" });
    }
  });
export type TriggerSceneActorEvent = z.infer<typeof ActorEventSchema>;

/**
 * A live unit, by its unit Anchor (or a Kept unit), changed at the shot's cut or `atMs` after it, as
 * a dormant device is switched on: given to `owner` (in that player's colour), its `removeBehaviors`
 * removed (one stack each) and its `addBehaviors` added (one stack each, the unit its own caster),
 * in that order. All of it is lasting state: a skip that comes first has Cleanup give it, to a unit
 * still alive. A shot gives its unit changes after its actor events at the same moment.
 */
const UnitChangeSchema = z
  .object({
    unit: slugId,
    owner: z.number().int({ message: "An owner is a player from 0 to 15" }).min(0, { message: "An owner is a player from 0 to 15" }).max(15, { message: "An owner is a player from 0 to 15" }).optional(),
    /** CBehavior ids, the game's or the Campaign Mod's. */
    removeBehaviors: z.array(z.string().min(1)).min(1).optional(),
    addBehaviors: z.array(z.string().min(1)).min(1).optional(),
    atMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((change) => change.owner !== undefined || change.removeBehaviors !== undefined || change.addBehaviors !== undefined, {
    message: "A unit change sets an owner, removes behaviours or adds them: give one",
  });
export type TriggerSceneUnitChange = z.infer<typeof UnitChangeSchema>;
/**
 * A unit a shot's camera is aimed at, in place of its camera Anchor's own target: "cue", the unit
 * the scene's cue keeps (the unit an anchorNears cue's Anchor came near, or the unit an effectStarts
 * cue's effect struck), or a unit Anchor's (or Kept unit's) by id. The
 * camera keeps its Anchor's values (distance, pitch, yaw, field of view) and pans to where the unit
 * is as it's aimed (the shot's cut or move); it doesn't follow the unit, so a later shot on the same
 * framing, which needs no cut, keeps that spot.
 */
const UnitAimSchema = z.union([z.literal("cue"), z.object({ anchorId: slugId }).strict()]);
export type TriggerSceneUnitAim = z.infer<typeof UnitAimSchema>;

const sameAim = (a: TriggerSceneUnitAim | undefined, b: TriggerSceneUnitAim | undefined): boolean =>
  a === b || (typeof a === "object" && typeof b === "object" && a.anchorId === b.anchorId);

/** Where a shot's camera is: a camera Anchor's values, aimed at its own target or at a unit. */
export type TriggerSceneFraming = { readonly camera: string; readonly unit?: TriggerSceneUnitAim };

/** The same camera Anchor aimed at the same thing, so a shot starting there needs no cut. */
export const sameFraming = (a: TriggerSceneFraming, b: TriggerSceneFraming): boolean => a.camera === b.camera && sameAim(a.unit, b.unit);

const ShotSchema = z
  .object({
    /** The camera Anchor the shot cuts to (no cut when the shot before ended on it, aimed at the same thing). */
    camera: slugId,
    /** Aims `camera` at a unit, with `camera`'s values. */
    unit: UnitAimSchema.optional(),
    /** Moves the camera over the whole shot from `camera` to this camera Anchor (`camera` itself when only `toUnit` is given). */
    to: slugId.optional(),
    /** Aims the move's end at a unit, with `to`'s values (or `camera`'s), so the camera eases to it as between Anchors. */
    toUnit: UnitAimSchema.optional(),
    /** How it moves: "ease" (the default) leaves at speed and settles, velocity −1 and decelerate 10 (C7); "linear" keeps one speed. */
    move: z.enum(["ease", "linear"]).optional(),
    /** The sound ID of the line it cuts on, at that line's start. The shot carries that line and every later one no shot names. */
    line: z.string().min(1).optional(),
    /** A shot with no line: it cuts this long after the shot before it ends (0 for the first shot). */
    afterMs: z.number().int().nonnegative().optional(),
    /** Holds the shot this long after its lines end (or, for a shot with no line, after it starts) before the next line or shot. */
    pauseAfterMs: z.number().int().nonnegative().optional(),
    /** Orders given to the staged cast or to live units at the shot's cut, or atMs after it. */
    orders: z.array(OrderSchema).optional(),
    /** Units warped in at the shot's cut, or atMs after it, the player's after the handback. */
    warpIns: z.array(WarpInSchema).optional(),
    /** Structures built at the shot's cut, or atMs after it, and finished at once. */
    builds: z.array(BuildSchema).optional(),
    /** Units warped out and removed at the shot's cut, or atMs after it. */
    warpOuts: z.array(WarpOutSchema).optional(),
    /** Actor messages sent to live units or the staged cast at the shot's cut, or atMs after it. */
    actorEvents: z.array(ActorEventSchema).optional(),
    /** Live units given an owner or behaviours at the shot's cut, or atMs after it, after its actor events. */
    unitChanges: z.array(UnitChangeSchema).optional(),
  })
  .strict()
  .superRefine((shot, context) => {
    if (shot.line !== undefined && shot.afterMs !== undefined) context.addIssue({ code: "custom", path: ["line"], message: "A shot starts on a line or afterMs after the shot before, not both" });
    if (shot.line === undefined && shot.afterMs === undefined) context.addIssue({ code: "custom", path: ["line"], message: "A shot starts on a line or afterMs after the shot before: give one (afterMs 0 to cut straight on)" });
    if (shot.move !== undefined && shot.to === undefined && shot.toUnit === undefined) context.addIssue({ code: "custom", path: ["move"], message: "move says how the camera moves to `to` or `toUnit`, so it needs one" });
    const end = shotEnd(shot);
    if ((shot.to !== undefined || shot.toUnit !== undefined) && sameFraming(shotStart(shot), end))
      context.addIssue({ code: "custom", path: [shot.to !== undefined ? "to" : "toUnit"], message: "A move goes to another camera Anchor or unit; hold the shot by leaving out `to` and `toUnit`" });
  });
export type TriggerSceneShot = z.infer<typeof ShotSchema>;

type ShotFramings = Pick<TriggerSceneShot, "camera" | "unit" | "to" | "toUnit">;

/** Where a shot cuts to: `camera`, aimed at `unit` when it names one. */
export function shotStart(shot: ShotFramings): TriggerSceneFraming {
  return { camera: shot.camera, ...(shot.unit !== undefined ? { unit: shot.unit } : {}) };
}

/** Where a shot ends: its move's end, or where it started. */
export function shotEnd(shot: ShotFramings): TriggerSceneFraming {
  if (shot.to === undefined && shot.toUnit === undefined) return shotStart(shot);
  return { camera: shot.to ?? shot.camera, ...(shot.toUnit !== undefined ? { unit: shot.toUnit } : {}) };
}
/**
 * A music cue: a Music Sound (a CSound id, not a Soundtrack's) played once, starting on a line's
 * start (`line`, a sound ID of the scene) or `atMs` into the scene (from its first cut; its start
 * when it gives neither), from `fromMs` into its file (its in-point), at `volume` (1 when left out).
 * It plays until its file ends, or fades from `untilMs` into the scene over `fadeOutMs` (the
 * engine's own fade when left out). The cleanup stops it with a fade either way.
 */
const MusicCueSchema = z
  .object({
    sound: z.string().min(1),
    line: z.string().min(1).optional(),
    atMs: z.number().int().nonnegative().optional(),
    fromMs: z.number().int().positive().optional(),
    untilMs: z.number().int().positive().optional(),
    fadeOutMs: z.number().int().positive().optional(),
    volume: z.number().min(0).max(1).optional(),
  })
  .strict()
  .superRefine((cue, context) => {
    if (cue.line !== undefined && cue.atMs !== undefined) context.addIssue({ code: "custom", path: ["atMs"], message: "A cue starts on a line or atMs into the scene, not both" });
    if (cue.fadeOutMs !== undefined && cue.untilMs === undefined) context.addIssue({ code: "custom", path: ["fadeOutMs"], message: "fadeOutMs is how long the fade from untilMs lasts, so it needs one" });
    if (cue.atMs !== undefined && cue.untilMs !== undefined && cue.untilMs <= cue.atMs) context.addIssue({ code: "custom", path: ["untilMs"], message: "A cue fades from untilMs after it starts at atMs" });
  });
export type TriggerSceneMusicCue = z.infer<typeof MusicCueSchema>;

/**
 * The scene's music (cinematography RECIPES.md "Music"). `mission`: what the mission music does,
 * "pause" (the default, as a Cinematic does: paused with a fade under black, unpaused in the
 * cleanup) or "keep" (it plays on, lowered under the lines in Speech mode, until a cue dips it).
 * `cues`: Music Sounds the scene plays, each stopped by the cleanup.
 */
const MusicSchema = z
  .object({
    mission: z.enum(["pause", "keep"]).optional(),
    cues: z.array(MusicCueSchema).optional(),
  })
  .strict();
export type TriggerSceneMusic = z.infer<typeof MusicSchema>;

/**
 * How the scene opens. `fade: false`: Setup goes to no black, so the scene opens in the player's
 * sight, as for a moment in a fight the player must keep watching. Cinematic Mode comes on over
 * the ease, the camera is locked and saved as for any scene, and the first shot's camera is reached
 * by an eased pan from the player's camera over `easeMs` (1000 when left out), in place of the cut
 * and the fade in: the shot's move and its lines start once the ease has ended. Setup's changes
 * made under black (a staged cast, marks, hidden live units, a Light, fog or mask change) would be
 * made in sight, and a scene played straight after another opens on that scene's black, so the
 * checks refuse each beside it. A skip during the ease skips to the cleanup as any skip does.
 */
const OpenSchema = z
  .object({
    fade: z.boolean().optional(),
    easeMs: z.number().int().positive().optional(),
  })
  .strict()
  .refine((open) => open.easeMs === undefined || open.fade === false, {
    path: ["easeMs"],
    message: "easeMs is how long a scene that opens with no fade eases from the player's camera to its first shot's, so it needs fade: false",
  });
export type TriggerSceneOpen = z.infer<typeof OpenSchema>;

/** How long a scene that opens with no fade eases to its first shot's camera when it gives no easeMs, in ms. */
export const OPEN_EASE_MS = 1000;

/** The ease a scene that opens with no fade (open.fade: false) makes to its first shot, in ms; none for one that opens from black. */
export const openEaseMs = (triggerScene: Pick<TriggerScene, "open">): number | undefined =>
  triggerScene.open?.fade === false ? (triggerScene.open.easeMs ?? OPEN_EASE_MS) : undefined;

export const TriggerSceneSchema = z
  .object({
    /** How the scene opens: from black (the default), or with no fade, easing from the player's camera. */
    open: OpenSchema.optional(),
    /** Units created for the scene, removed in its Cleanup. */
    cast: z.array(CastSchema).optional(),
    /**
     * Speakers who speak from a staged unit, by speaker (as the Blueprint's `speakerAnchors` name
     * them) to cast id: the speaker's lines in the shots play as Transmissions from the first unit
     * of that cast group, its flash on the unit, in place of the speaker's unit Anchor or character.
     */
    speakers: z.record(z.string().min(1), slugId).optional(),
    /** Live units the scene hides or pauses, put back in its Cleanup. */
    live: z.array(LiveSchema).optional(),
    /** Live units moved to marks in Setup, under black, whether or not the scene is skipped. */
    marks: z.array(MarkSchema).optional(),
    shots: z.array(ShotSchema).min(1),
    music: MusicSchema.optional(),
    /**
     * `"victory"`: a victory outro, played on a victory condition, last on its cue (or, listed by
     * `outcome: "victory"` with no Screenplay scene, last on every victory condition). It ends the game
     * instead of handing back: after its fade out (2.0 s, or 0.5 s after a skip) the screen stays
     * black with Cinematic Mode on, and the victory follows. So it has no `handback`.
     */
    outro: z.literal("victory").optional(),
    /**
     * How control comes back. `camera`: the camera Anchor the player lands on (H3), as a scene at
     * mission start names the start; the camera the player had before the scene (CameraRestore) when
     * left out. In a chain of scenes on one cue, only the last hands back, so only it has these.
     */
    handback: z
      .object({
        camera: slugId.optional(),
        /**
         * `false`: watched to the end, the scene hands back with no fade and leaves the camera where
         * its last shot left it, Cinematic Mode going off over the handback's 1.5 s (an intended H3
         * exception). After a skip it fades as any scene does, landing on the last shot's camera.
         */
        fade: z.boolean().optional(),
        /** Unit Anchors pinged on the minimap at the handback, such as the heroes after a handback with no fade. */
        ping: z.array(slugId).min(1).optional(),
        /** The objective issued at the handback (H3): created hidden at mission start, and shown straight after the handback. */
        objective: slugId.optional(),
        /**
         * The sound ID of the first line played after the handback: the scene's camera work ends
         * before it, and it and every later line of the scene play as Transmissions in play, one
         * after another, once control is back. Played after a skip too.
         */
        linesFrom: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    /** The Light the scene plays in, by its CLight id: switched to under black in Setup, and the mission Light set back in Cleanup (L2, L3). */
    light: z.string().min(1).optional(),
    /**
     * The fog the scene plays in: each knob given is set under black in Setup and set back to the
     * mission's (its Blueprint's `sky.fog`, else its tileset's) in Cleanup. Colour is 0-1 per channel.
     */
    fog: z
      .object({
        color: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
        density: z.number().min(0).optional(),
        falloff: z.number().min(0).optional(),
        startingHeight: z.number().finite().optional(),
      })
      .strict()
      .refine((fog) => Object.keys(fog).length > 0, "A fog change sets at least one of color, density, falloff and startingHeight")
      .optional(),
    /**
     * "off": the black mask and the fog of war are off for the scene, which films ground the player
     * hasn't explored, and back on in Cleanup, as they were before it (#409).
     */
    mask: z.literal("off").optional(),
  })
  .strict();
export type TriggerScene = z.infer<typeof TriggerSceneSchema>;
