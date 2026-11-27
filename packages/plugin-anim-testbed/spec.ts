// A testbed spec: one test's units, their animations, the moments and the variations (README.md, "The spec").
import { z } from "zod";

const seconds = z.number().finite();
const ID = /^[A-Za-z_][\w]*$/;

/** An element's kinds: exactly one of these keys names what it is. `order` is kept for a unit's abilities (#96). */
export const ELEMENT_KINDS = ["anim", "sound", "effect", "actor", "kill", "order"] as const;

/**
 * One element of a moment's timeline, at an absolute time from Play. `at` may be a string only so the
 * build can tell `on <event>`, kept for actor events (#96), from a mistake.
 */
const ElementSchema = z
  .object({
    /** One of the unit's animations, by name. */
    anim: z.string().min(1).optional(),
    /** A CSound id. */
    sound: z.string().min(1).optional(),
    /** A CEffect id: from the unit, at the target (or the point in front of the unit). */
    effect: z.string().min(1).optional(),
    /** An actor message: `Create MyBurst`, `AnimPlay …`, `SetTintColor …`. */
    actor: z.string().min(1).optional(),
    /** Kills the unit; it comes back after its `respawn`. */
    kill: z.literal(true).optional(),
    order: z.string().optional(),
    /** Seconds from Play. */
    at: z.union([seconds.nonnegative(), z.string()]).default(0),
    /** Seconds from Play: a sound fades out, an animation is cleared. */
    stop: seconds.nonnegative().optional(),
    /** `unit` (the default), `target`, or a child actor in the unit's scope (an actor message only). */
    on: z.string().min(1).optional(),
    /** Left out of Play, kept in the spec. */
    muted: z.boolean().optional(),
  })
  .strict();

/** A variation: one whole timeline for a unit's moment. */
const VariationSchema = z
  .object({
    elements: z.array(ElementSchema).default([]),
    note: z.string().optional(),
    /** Its name in the dropdown; the start of the note by default. */
    label: z.string().optional(),
    /** The one the dropdown starts on, marked `*`. */
    pick: z.boolean().optional(),
  })
  .strict();

const AnimationSchema = z
  .object({
    /** The actor message that plays it: `AnimPlay Attack Spell,C NonLooping`. */
    play: z.string().min(1),
    /** When the swing or throw goes, in seconds from its start: shown on the timeline. */
    strike: seconds.default(0),
    /** When it lands on the target: shown on the timeline. The strike by default. */
    land: seconds.optional(),
    /** How long it runs; the model's own length when it can be read. */
    length: seconds.positive().optional(),
  })
  .strict();

/** A unit's part in a moment: the variations to compare. */
const UnitMomentSchema = z
  .object({
    variations: z.array(VariationSchema).default([]),
  })
  .strict();

const NewUnitSchema = z
  .object({
    /** The CUnit, CActorUnit and CModel id it gets. */
    id: z.string().regex(ID, "An id is letters, digits and underscores"),
    model: z.string().min(1),
    anims: z.array(z.string()).default([]),
    /** Folders holding the textures the model names. */
    textures: z.array(z.string()).default([]),
    scale: z.number().positive().default(1),
    alias: z.string().default("_UnitLarge"),
  })
  .strict();

const UnitSchema = z
  .object({
    /** Its name in the dropdown. */
    key: z.string().min(1),
    /** A CUnit the game or the Workspace has. */
    unit: z.string().regex(ID).optional(),
    /** A model of the spec's own, which the build adds as a unit. */
    new: NewUnitSchema.optional(),
    /** How far in front of it the target stands. */
    reach: z.number().nonnegative().default(1.5),
    /** The actor message of its idle, sent after it spawns. */
    idle: z.string().optional(),
    /** How long after a death it comes back. */
    respawn: z.number().nonnegative().default(4),
    /** Its animations by name, which its moments' elements play. */
    animations: z.record(z.string().min(1), AnimationSchema).default({}),
    /** Per moment, the variations to compare. */
    moments: z.record(z.string(), UnitMomentSchema).default({}),
  })
  .strict()
  .refine((unit) => (unit.unit === undefined) !== (unit.new === undefined), { message: 'Give a unit "unit" (a CUnit id) or "new" (a model), not both' });

const SoundSchema = z
  .object({
    parent: z.string().default("Combat"),
    /** The folder holding the files, searched with its subfolders. */
    from: z.string(),
    /** File names or globs (`death_0[1-9].wav`), matched without case. */
    files: z.array(z.string()).min(1),
    /** Other fields of the CSound, as `<Field value="…"/>`. */
    fields: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  })
  .strict();

const TourStopSchema = z
  .object({
    unit: z.string(),
    moment: z.string(),
    /** Its place from 1; the pick by default. */
    variation: z.number().int().positive().optional(),
    /** How long after Play the frame is taken. */
    hold: seconds.nonnegative(),
  })
  .strict();

export const SpecSchema = z
  .object({
    name: z.string().regex(/^[\w-]+$/, "A map name is letters, digits, hyphens and underscores").optional(),
    title: z.string().optional(),
    /** An Editor-saved .SC2Map folder. */
    base: z.string(),
    /** The map to write, inside an output/ folder; output/<name>.SC2Map beside the base map by default. */
    out: z.string().optional(),
    roots: z.record(z.string(), z.string()).default({}),
    stage: z
      .object({
        at: z.tuple([z.number(), z.number()]).default([64, 64]),
        gap: z.number().positive().default(4),
        facing: z.number().default(270),
        fog: z.boolean().default(false),
        player: z.number().int().min(0).max(15).default(0),
        /** A tour's camera: its distance from each stop's unit, and how far left of it it looks, so the unit shows right of the dialog. */
        cameraDistance: z.number().positive().default(22),
        cameraShift: z.number().default(7),
      })
      .strict()
      .default({ at: [64, 64], gap: 4, facing: 270, fog: false, player: 0, cameraDistance: 22, cameraShift: 7 }),
    target: z
      .object({ unit: z.string().regex(ID), player: z.number().int().min(0).max(15).default(1) })
      .strict()
      .nullable()
      .optional(),
    /** The moments' names in dropdown order; by default, in the order the units first name them. */
    moments: z.array(z.string().min(1)).optional(),
    sounds: z.record(z.string().regex(ID), SoundSchema).default({}),
    /** XML files of <Catalog> elements, each routed to its catalog. */
    data: z.array(z.string()).default([]),
    /** Other files the data names: copied to `to` in the map. */
    assets: z.array(z.object({ from: z.string(), to: z.string() }).strict()).default([]),
    units: z.array(UnitSchema).min(1),
    /** The stops a --capture build films. */
    tour: z.array(TourStopSchema).default([]),
  })
  .strict();

export type Spec = z.infer<typeof SpecSchema>;
export type SpecElement = SpecUnit["moments"][string]["variations"][number]["elements"][number];
export type SpecUnit = Spec["units"][number];

/** A spec's text as JSON, with // comments allowed on their own lines and after a value. */
export function parseSpecText(text: string): unknown {
  const stripped = text
    .split("\n")
    .map((line) => {
      let inString = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "\\" && inString) i++;
        else if (ch === '"') inString = !inString;
        else if (!inString && ch === "/" && line[i + 1] === "/") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
  return JSON.parse(stripped);
}

/** Where an old spelling went when a moment became a timeline (#138). */
const MOVED: Record<string, string> = {
  cues: 'cues are now "elements", each an object at an absolute time: { "sound": "Marine_Yes", "at": 0.1 }',
  anim: 'a moment\'s animation is now an element of each variation: { "anim": "attack", "at": 0 }',
  clear: 'an animation\'s clear is now the "stop" of the element that plays it',
};

function hint(issue: z.core.$ZodIssue): string {
  if (issue.code === "unrecognized_keys") {
    const moved = issue.keys.map((key) => MOVED[key]).filter(Boolean);
    return moved.length ? ` (${moved.join("; ")})` : "";
  }
  if (issue.path.length === 1 && issue.path[0] === "moments") return ' (moments are names only now, in order: "moments": ["attack", "death"]; what a moment does is in its variations\' elements)';
  return "";
}

/** A spec, or the problems that stop it, each with its path. */
export function readSpec(text: string): { spec?: Spec; problems: string[] } {
  let raw: unknown;
  try {
    raw = parseSpecText(text);
  } catch (error) {
    return { problems: [`not JSON: ${(error as Error).message}`] };
  }
  const parsed = SpecSchema.safeParse(raw);
  if (!parsed.success) return { problems: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(spec)"}: ${issue.message}${hint(issue)}`) };
  return { spec: parsed.data, problems: [] };
}
