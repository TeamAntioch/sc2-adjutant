// Adopting in-game card frames (issue #790): a card sheet made with --cards --pick-light films each
// set's card pictures in game, and capture-sets keeps each picture's frame nearest the target
// brightness, recording them in lighting.json. This writes those frames into the set looks as each
// picture's `game` counterpart (cutscene/set-looks.ts), leaving out the ones judged unusable, so
// set-cards copies them beside the pictures and the Set Finder shows both.

import path from "node:path";

import type { SetLook } from "../cutscene/set-looks.js";

/** capture-sets' lighting.json: by set, by card picture, the frame kept for it and its lighting. */
export type LightingRecord = {
  readonly sets: Readonly<Record<string, Readonly<Record<string, { readonly lighting: string; readonly file: string }>>>>;
};

export type AdoptedGameCards = {
  readonly looks: Record<string, SetLook>;
  /** `<set>/<card file>` of each picture given a counterpart. */
  readonly adopted: string[];
  /** Pictures with a frame that were left out, the same way. */
  readonly leftOut: string[];
  /** Frames whose set has no look or whose look has no such picture. */
  readonly unmatched: string[];
};

/**
 * The looks with each kept frame as its picture's `game`, but those `leaveOut` names: a set id
 * leaves out all its pictures, `<set>/<n>` its card picture n. Pictures with no frame keep what
 * they had.
 */
export function adoptGameCards(looks: Readonly<Record<string, SetLook>>, record: LightingRecord, leaveOut: readonly string[] = []): AdoptedGameCards {
  const left = new Set(leaveOut);
  const result: AdoptedGameCards = { looks: { ...looks }, adopted: [], leftOut: [], unmatched: [] };
  for (const [id, cards] of Object.entries(record.sets)) {
    const look = looks[id];
    for (const file of Object.keys(cards)) if (!look?.pictures?.some((picture) => picture.file === file)) result.unmatched.push(`${id}/${file}`);
    if (!look?.pictures) continue;
    const pictures = look.pictures.map((picture) => {
      const frame = cards[picture.file];
      if (!frame) return picture;
      const number = /^card\/(\d+)\.jpg$/.exec(picture.file)![1];
      const name = `${id}/${picture.file}`;
      if (left.has(id) || left.has(`${id}/${number}`)) {
        result.leftOut.push(name);
        const { game: _game, ...rest } = picture;
        return rest;
      }
      result.adopted.push(name);
      return { ...picture, game: { capture: path.basename(frame.file), lighting: frame.lighting } };
    });
    result.looks[id] = { ...look, pictures };
  }
  return result;
}
