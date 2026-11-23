import { z } from "zod";

/**
 * What a cinematic set looks like, written from its pictures (the set views of capture/set-views.ts,
 * more shots asked for with `set-shots`, and in-game captures) for whoever is choosing a set for a
 * scene. Kept in data/cinematic-sets/looks.json, keyed by set id; a correction is an edit there.
 */
const num = z.number().finite();
const vec3 = z.tuple([num, num, num]);
/**
 * How a shot was drawn (capture/set-views.ts, shootSet): `cut` the height everything above was cut
 * away at, `floor` the floor a compass height is measured from, `only` and `without` the pieces
 * chosen by model name. All are the values the shot was drawn with, so it draws the same again.
 */
const shotOptions = { fov: num.optional(), cut: num.optional(), floor: num.optional(), only: z.string().min(1).optional(), without: z.string().min(1).optional() };

/**
 * Where a card picture comes from, so it can be made again on another machine (capture/set-cards.ts):
 * one of the set's own views (its plan or overview, or the frame of one of its cameras, by name), an
 * in-game capture by its file name (which only a machine with the captures has), or a shot.
 */
export const pictureSourceSchema = z.union([
  z.strictObject({ view: z.enum(["plan", "overview"]) }),
  /** `frame` is the camera's place among the set's cameras, from 1 (its `cam-NN.jpg`), for a set with two cameras of one name. */
  z.strictObject({ camera: z.string().min(1), frame: z.number().int().positive().optional() }),
  z.strictObject({ capture: z.string().regex(/^[^/\\]+\.jpg$/) }),
  z.strictObject({ compass: num, at: z.tuple([num, num]).optional(), way: z.enum(["north", "east", "south", "west"]), ...shotOptions }),
  z.strictObject({ orbit: z.tuple([num, num]), ...shotOptions }),
  z.strictObject({ plan: z.literal(true), ...shotOptions }),
  z.strictObject({ eye: vec3, target: vec3, ...shotOptions }),
]);
export type PictureSource = z.infer<typeof pictureSourceSchema>;

/**
 * The same picture filmed in game (a card sheet made with --cards --pick-light, issue #790): the
 * frame capture-sets kept for it, by file name in the set's folder of the captures, and the lighting
 * it was filmed under. It is shown beside the picture, as `<file>` with `-game` before `.jpg`; only
 * a machine with the captures can make it.
 */
export const gamePictureSchema = z.strictObject({ capture: z.string().regex(/^[^/\\]+\.jpg$/), lighting: z.string().min(1) });
export type GamePicture = z.infer<typeof gamePictureSchema>;

/** The file a card picture's in-game counterpart is made as: `card/2.jpg` → `card/2-game.jpg`. */
export const gameFile = (file: string): string => file.replace(/\.jpg$/, "-game.jpg");

export const setLookSchema = z.strictObject({
  /** `props`: loose objects for map terrain, no room. `effects`: only particles, holograms or light. */
  kind: z.enum(["room", "exterior", "space", "props", "effects", "unclear"]),
  /** Plain sentences: what the place is, its shape and size in cells, its features and where, materials, and its mood in the game where a capture shows it. */
  look: z.string().min(40),
  /** Short lowercase search words. */
  facets: z.array(z.string().min(1)).min(3),
  /** The kinds of scene it could be used for; none for props and effects. */
  standsInFor: z.array(z.string().min(1)),
  /** Where one set holds more than one place: a line a place, naming the model-name pattern that picks it out. */
  rooms: z.array(z.string().min(1)).optional(),
  /** The pictures that show it best, the whole place first: files in the set's views folder, each with what it shows and where it comes from. */
  pictures: z.array(z.strictObject({ file: z.string().regex(/^card\/\d+\.jpg$/), shows: z.string().min(1), from: pictureSourceSchema.optional(), game: gamePictureSchema.optional() })).min(1).optional(),
  /** Which pictures the look rests on, and what was unusable. */
  basis: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
  /** What is wrong with the set's pictures. */
  problems: z.array(z.string().min(1)),
});

export type SetLook = z.infer<typeof setLookSchema>;

const setLooksSchema = z.record(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), setLookSchema);

/** The set looks file's contents, by set id; throws naming the first entry that isn't a look. */
export function parseSetLooks(json: unknown): Record<string, SetLook> {
  const parsed = setLooksSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]!;
  throw new Error(`Set looks: ${issue.path.join(".")}: ${issue.message}`);
}
