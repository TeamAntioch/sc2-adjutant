// A Set: a location for Cinematics, kept as data in the Workspace at missions/<id>/sets/<slug>.json.
// Imported from a Cutscene Editor file by catalog name (`import-set`), so a Cinematic compiles
// without the source file and a change to the set is reviewed as a diff. Everything is in the set's
// own frame: a Cinematic places the set at an offset.

import { z } from "zod";

import { slugId } from "./mission-blueprint.js";

const finite = z.number().finite();
const Vec3Schema = z.tuple([finite, finite, finite]);
/** Red, green and blue, 0-1 each, or above 1 to brighten (Blizzard tints up to about 1.6). */
export const ColorSchema = z.tuple([finite, finite, finite]);
/** Degrees: a number turns about z; a triple is the Editor's own (x, y, z). */
const RotationSchema = z.union([finite, Vec3Schema]);
/** The camera names of a source file's shots an object is tied to (ActiveShot): seen, or lit, only in those. Absent: in every shot. */
const ShotsSchema = z.array(z.string().min(1)).min(1);

/** Team colours, 0-1 RGBA, as the Editor writes them on a cutscene actor. */
export const TeamColorSchema = z.object({ diffuse: z.tuple([finite, finite, finite, finite]).optional(), emissive: z.tuple([finite, finite, finite, finite]).optional() }).strict();

export const SetPieceSchema = z
  .object({
    /** What a Cinematic's shots call it, as `"<set id>/<piece id>"`, to bring it in, take it away, fade or scale it (`enters`, `exits`, `moves`). */
    id: slugId.optional(),
    model: z.string().min(1),
    /** The model's file in the game's data ("Assets/.../Room_01.m3"), where its source named the file and not a model entry; `model` is then the file's name. */
    modelPath: z.string().regex(/\.m3$/i).optional(),
    at: Vec3Schema,
    rotation: RotationSchema.optional(),
    /** A number scales evenly; a triple is (x, y, z). Negative mirrors, as the Editor allows. */
    scale: z.union([finite, Vec3Schema]).optional(),
    variation: z.number().int().nonnegative().optional(),
    /** 0-1 per channel. */
    tint: ColorSchema.optional(),
    teamColor: TeamColorSchema.optional(),
    /** 0-1; opaque when absent. */
    opacity: finite.optional(),
    /** The animation it loops all through; when absent its model's Stand ("Stand", else its first numbered one, as "Stand 01"). Played at its recorded length when data/model-anims.json has the model. */
    anim: z.string().min(1).optional(),
    /** How fast it plays (the anim's timeScale): 0.5 at half speed, 2 at double (a planet spinning too fast on its Stand); its own speed when left out. */
    animSpeed: finite.positive().optional(),
    /** Switched off in the source file (enabled or visible off). */
    hidden: z.literal(true).optional(),
    shots: ShotsSchema.optional(),
  })
  .strict();
export type SetPiece = z.infer<typeof SetPieceSchema>;

/**
 * Where a character stands, by the name the source file gives it. Facing is degrees about z. `shots`:
 * the source showed its character only through these cameras, as a Campaign may hide a character in a shot
 * filmed from where they stand; empty when through none of the set's.
 */
export const SetMarkSchema = z
  .object({
    name: z.string().min(1),
    model: z.string().min(1),
    at: Vec3Schema,
    facing: finite,
    shots: z.array(z.string().min(1)).optional(),
    /**
     * The animation its character loops in the Set cutscene, the room the Editor opens, when not the
     * Stand of its Model Guide's default family: one no default can give, as a pilot's "Ride" at a
     * helm. A Cinematic's cast member on the mark still gives its own anim.
     */
    anim: z.string().min(1).optional(),
    /**
     * The character here looks at the one on another mark, all through (as the source's actor turned
     * its head to the other's): `type` is the Editor's look-at type ("SlowHeadOnly" when left out),
     * `point` the attach point it looks at ("Head" when left out).
     */
    lookAt: z.object({ mark: z.string().min(1), type: z.string().min(1).optional(), point: z.string().min(1).optional() }).strict().optional(),
  })
  .strict();
export type SetMark = z.infer<typeof SetMarkSchema>;

/**
 * A named orbit camera, in the values the Cutscene Editor writes and `write-shot-cutscene`'s
 * ShotCamera takes: `target` is the camera's own position (a still rig it's tied to doesn't move
 * it), the eye `distance` back against `yaw`, raised by `heightOffset` and `pitch` (`cameraEye`).
 * An imported target camera (an eye and a point it looks at) arrives in these values, with no `heightOffset`.
 */
export const SetCameraSchema = z
  .object({
    name: z.string().min(1),
    target: Vec3Schema,
    distance: finite,
    pitch: finite,
    yaw: finite,
    fov: finite,
    /** The Editor's verticalFOV flag was off, so `fov` may be horizontal; absent means vertical. */
    verticalFov: z.literal(false).optional(),
    /** The Editor's heightOffset, kept as written: the game adds it to the target's and eye's height. */
    heightOffset: finite.optional(),
    roll: finite.optional(),
    /** Depth of field as a blur amount, 0-1 (doftype 0), with its focus and falloffs. */
    blur: finite.optional(),
    focalDepth: finite.optional(),
    falloff: z.object({ far: finite, near: finite }).strict().optional(),
    /** Property curves or a moving rig animate it: these are its values before they do. */
    moves: z.literal(true).optional(),
    /** How far from the eye shadows are drawn (the camera's shadowClip), in cells; 75, Blizzard's usual, when left out. */
    shadowDistance: finite.positive().optional(),
  })
  .strict();
export type SetCamera = z.infer<typeof SetCameraSchema>;

/** A light node of the set's own (a key, a fill, a practical). Colour 0-1 per channel; strength is colorMultiplier. */
export const SetLampSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(["omni", "spot"]),
    at: Vec3Schema,
    rotation: Vec3Schema.optional(),
    color: ColorSchema,
    strength: finite,
    attenuationStart: finite.optional(),
    range: finite.optional(),
    hotspot: finite.optional(),
    falloff: finite.optional(),
    shadows: z.literal(false).optional(),
    shots: ShotsSchema.optional(),
    /**
     * Attached to the character on a mark, so it follows them (a fill riding a walker's overhead): at
     * the attach point `point` of the one cast on `mark`, offset by `offset` and turned by `rotation`,
     * the Editor's (x, y, z), in that point's frame. Where the set puts it when no one is cast there.
     */
    attach: z.object({ mark: z.string().min(1), point: z.string().min(1), offset: Vec3Schema.optional(), rotation: Vec3Schema.optional() }).strict().optional(),
  })
  .strict();
export type SetLamp = z.infer<typeof SetLampSchema>;

/**
 * A sound the set plays, looping, through a Cinematic's shots on it: its ambience (a room's hum, a
 * bridge's walla). It starts on each cut to the set and fades out briefly on the cut away; a run of
 * shots on the set plays one loop, and a set in every shot loops it all through. `volume` scales it
 * (the Editor's volumeScale): 1, its own level, when left out.
 */
export const SetSoundSchema = z.object({ sound: z.string().min(1), volume: z.number().min(0).optional() }).strict();
export type SetSound = z.infer<typeof SetSoundSchema>;

export const SetSchema = z
  .object({
    name: z.string().min(1),
    /** Where an imported set came from: its catalog entry, the source file, and the file's point at the set's 0,0,0. */
    provenance: z
      .object({
        setId: slugId,
        catalogName: z.string().min(1),
        /** The source kind (`blizzard`, or a Campaign's own), and the file's path in that source. */
        kind: z.string().min(1),
        file: z.string().min(1),
        origin: Vec3Schema,
      })
      .strict()
      .optional(),
    /** Base Lights the source file switches to (Active Light), in its order. */
    lights: z.array(z.string().min(1)),
    pieces: z.array(SetPieceSchema),
    marks: z.array(SetMarkSchema),
    cameras: z.array(SetCameraSchema),
    lamps: z.array(SetLampSchema),
    /** Its ambience, looping through its shots in every Cinematic on it. */
    sounds: z.array(SetSoundSchema).optional(),
  })
  .strict()
  .superRefine((set, context) => {
    // Cinematics name a set's cameras and marks, and its pieces by id, so each name is one of them.
    for (const kind of ["cameras", "marks"] as const) {
      const seen = new Set<string>();
      set[kind].forEach((entry, index) => {
        if (seen.has(entry.name)) context.addIssue({ code: "custom", path: [kind, index, "name"], message: `Two ${kind} are called ${entry.name}` });
        seen.add(entry.name);
      });
    }
    // A mark's look-at and an attached lamp name a mark of the set.
    const marks = new Set(set.marks.map((mark) => mark.name));
    set.marks.forEach((mark, index) => {
      if (!mark.lookAt) return;
      const path = ["marks", index, "lookAt", "mark"];
      if (!marks.has(mark.lookAt.mark)) context.addIssue({ code: "custom", path, message: `No mark ${mark.lookAt.mark} in the set` });
      else if (mark.lookAt.mark === mark.name) context.addIssue({ code: "custom", path, message: "A mark's character can't look at itself" });
    });
    set.lamps.forEach((lamp, index) => {
      if (lamp.attach && !marks.has(lamp.attach.mark)) context.addIssue({ code: "custom", path: ["lamps", index, "attach", "mark"], message: `No mark ${lamp.attach.mark} in the set` });
    });
    const ids = new Set<string>();
    set.pieces.forEach((piece, index) => {
      if (piece.id === undefined) return;
      if (ids.has(piece.id)) context.addIssue({ code: "custom", path: ["pieces", index, "id"], message: `Two pieces are called ${piece.id}` });
      ids.add(piece.id);
    });
  });
export type SetData = z.infer<typeof SetSchema>;
