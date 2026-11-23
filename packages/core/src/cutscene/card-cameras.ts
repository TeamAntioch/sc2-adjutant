// The Set Finder's card pictures, filmed in the game: the camera each card's `from` record (set-looks.ts)
// was drawn from in Blender (blender/render-set.py), for the contact sheet's card mode. Blender puts
// the pieces where the .SC2Cutscene does, so a picture's eye and target are Cutscene Editor
// coordinates as they stand. Blender's lens is vertical on a 16:9 frame, as a target camera with
// `verticalFOV` is in the game's 16:9 capture.
//
// Only pictures the game can film from the set standing whole are translated: a free shot and a
// compass look, either with pieces left out (`only`/`without`). A cut (the game can't take a roof
// off), the set's views, a plan, an orbit (framed on Blender's measure of the cut set), an in-game
// capture and the set's own camera aren't.

import type { PictureSource, SetLook } from "./set-looks.js";

type Vec3 = readonly [number, number, number];

/** render-set.py's lens for a free shot and for a compass look, where the record names none. */
export const FREE_FOV = 40;
export const COMPASS_FOV = 60;

const WAYS = { north: [0, 1], east: [1, 0], south: [0, -1], west: [-1, 0] } as const;

export type CardCamera = { readonly eye: Vec3; readonly target: Vec3; readonly fov: number };
/** The pieces a picture leaves out, by model name (regular expressions, matched ignoring case, as set-cards draws them). */
export type PieceFilter = { readonly only?: string; readonly without?: string };
/**
 * What Blender measures of the pieces drawn (set-views.ts, shootSet with no shots): the x, y centre
 * of their bounds, where a compass look with no point stands, and the floor it guesses, which a
 * compass look recorded without one is measured from.
 */
export type Measure = { readonly centre: readonly [number, number]; readonly floor: number };

/** A compass look that stands where only Blender can tell: at the set's centre, or over a floor it didn't record. */
export const needsMeasure = (from: PictureSource): boolean => "compass" in from && (!from.at || from.floor === undefined);

/**
 * The game camera a card picture was drawn from, or undefined where the game can't film it (see
 * above). `measure` is Blender's of the pieces drawn, for a compass look that needs it.
 */
export function cardCamera(from: PictureSource, measure?: Measure): CardCamera | undefined {
  if ("cut" in from && from.cut !== undefined) return undefined;
  if ("eye" in from) return { eye: from.eye, target: from.target, fov: from.fov ?? FREE_FOV };
  if (!("compass" in from)) return undefined;
  const at = from.at ?? measure?.centre;
  const floor = from.floor ?? measure?.floor;
  if (!at || floor === undefined) return undefined;
  const [dx, dy] = WAYS[from.way];
  const height = floor + from.compass;
  return { eye: [at[0], at[1], height], target: [at[0] + dx, at[1] + dy, height], fov: from.fov ?? COMPASS_FOV };
}

/** Why cardCamera has none for a picture. */
function whyNot(from: PictureSource | undefined): string {
  if (!from) return "the look doesn't record where it comes from";
  if ("cut" in from && from.cut !== undefined) return "drawn with the roof cut away, which the game can't do";
  if ("view" in from) return `the set's ${from.view}, drawn with the roof cut away`;
  if ("capture" in from) return "already an in-game capture";
  if ("camera" in from) return "the set's own camera (contact-sheet --originals films those)";
  if ("orbit" in from) return "an orbit, framed on Blender's measure of the set";
  if ("plan" in from) return "a plan, drawn straight down without perspective";
  return "a compass look that needs the set measured, which wasn't";
}

export type CardShot = CardCamera & { readonly card: string };
export type CardShotGroup = PieceFilter & { readonly cameras: readonly CardShot[] };

/** The pieces a picture's record leaves out. */
export const filterOf = (from: PictureSource): PieceFilter => ({
  ...("only" in from && from.only ? { only: from.only } : {}),
  ...("without" in from && from.without ? { without: from.without } : {}),
});

/**
 * A set's card pictures as game cameras, grouped by the pieces they leave out (each group is one
 * sheet cutscene), in the look's order, and the pictures skipped with why. `measureOf` gives
 * Blender's measure of the pieces a filter keeps, where a compass look needs it.
 */
export function planCardShots(
  pictures: NonNullable<SetLook["pictures"]>,
  measureOf: (filter: PieceFilter) => Measure | undefined,
): { readonly groups: CardShotGroup[]; readonly skipped: { readonly card: string; readonly why: string }[] } {
  const groups = new Map<string, { filter: PieceFilter; cameras: CardShot[] }>();
  const skipped: { card: string; why: string }[] = [];
  for (const picture of pictures) {
    const from = picture.from;
    const filter = from ? filterOf(from) : {};
    const camera = from && cardCamera(from, needsMeasure(from) ? measureOf(filter) : undefined);
    if (!camera) {
      skipped.push({ card: picture.file, why: whyNot(from) });
      continue;
    }
    const key = JSON.stringify([filter.only ?? null, filter.without ?? null]);
    const group = groups.get(key) ?? { filter, cameras: [] };
    groups.set(key, group);
    group.cameras.push({ card: picture.file, ...camera });
  }
  return { groups: [...groups.values()].map(({ filter, cameras }) => ({ ...filter, cameras })), skipped };
}
