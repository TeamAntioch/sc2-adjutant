// A set's card pictures, made again from what its look records of each (cutscene/set-looks.ts, a
// picture's `from`): the Set Finder's cards show these, and they are drawn files in the machine's
// cache, so a machine that didn't choose them has to make them. A picture from one of the set's own
// views is copied, an in-game capture is copied where this machine has the captures, and a shot is
// drawn in Blender (set-views.ts, shootSet). The set must have been drawn by render-set-views first.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { gameFile, type PictureSource, type SetLook } from "../cutscene/set-looks.js";
import { type SetShot, shootSet } from "./set-views.js";

/** What each card picture was made from, and the drawing of the set it was made from, kept beside them: a picture whose record and set haven't changed isn't made again. */
const CARDS_RECORD = "card/cards.json";

export type SetCardsRequest = {
  /** A drawn set's folder (`<views>/<set id>`). */
  readonly setDir: string;
  readonly look: Pick<SetLook, "pictures">;
  readonly blender: string;
  /** The folder holding this set's in-game captures (capture-sets), when the machine has them. */
  readonly capturesDir?: string;
  /** The folder holding this set's in-game card frames (capture-sets on a card sheet), when the machine has them. */
  readonly gameDir?: string;
  /** Make every picture again, whatever the record says. */
  readonly force?: boolean;
  /** For tests: draws shots in place of Blender. */
  readonly shoot?: typeof shootSet;
};

export type SetCardsResult = {
  readonly made: string[];
  readonly kept: string[];
  /** Pictures that couldn't be made, each with why; one made earlier stays as it is. */
  readonly missing: { readonly file: string; readonly why: string }[];
};

type Shot = Extract<PictureSource, { fov?: number | undefined }>;
const isShot = (from: PictureSource): from is Shot => !("view" in from) && !("camera" in from) && !("capture" in from);

/** Makes the look's card pictures in `<setDir>/card`, the ones whose record changed or whose file is gone. */
export async function drawSetCards(request: SetCardsRequest): Promise<SetCardsResult> {
  const { setDir, look, blender, capturesDir } = request;
  const shoot = request.shoot ?? shootSet;
  const recordFile = path.join(setDir, CARDS_RECORD);
  const record: Record<string, string> = existsSync(recordFile) ? (JSON.parse(await readFile(recordFile, "utf8")) as Record<string, string>) : {};
  const result: SetCardsResult = { made: [], kept: [], missing: [] };
  // The set as drawn: its pieces and cameras, and the views' version. A set drawn again has its cards made again.
  const drawing = createHash("sha1");
  for (const name of ["spec.json", "views.json"]) drawing.update(existsSync(path.join(setDir, name)) ? await readFile(path.join(setDir, name)) : "");
  const set = drawing.digest("hex").slice(0, 12);
  const todo: { file: string; from: PictureSource; key: string }[] = [];
  for (const picture of look.pictures ?? []) {
    if (!picture.from) {
      if (!existsSync(path.join(setDir, picture.file))) result.missing.push({ file: picture.file, why: "the look doesn't record where it comes from" });
      continue;
    }
    const key = `${set} ${JSON.stringify(picture.from)}`;
    if (!request.force && record[picture.file] === key && existsSync(path.join(setDir, picture.file))) result.kept.push(picture.file);
    else todo.push({ file: picture.file, from: picture.from, key });
  }
  await drawGamePictures(request, record, recordFile, result);
  if (todo.length === 0) return result;
  await mkdir(path.join(setDir, "card"), { recursive: true });
  /** A picture that can't be made: one made from another record is taken away, since it isn't the picture the look names now; one from before records were kept stays. */
  const failed = async (file: string, why: string): Promise<void> => {
    result.missing.push({ file, why });
    if (record[file] === undefined) return;
    delete record[file];
    await rm(path.join(setDir, file), { force: true });
    await writeFile(recordFile, JSON.stringify(record));
  };
  const done = async (file: string, key: string): Promise<void> => {
    record[file] = key;
    result.made.push(file);
    await writeFile(recordFile, JSON.stringify(record));
  };

  const cameras = existsSync(path.join(setDir, "views.json")) ? (JSON.parse(await readFile(path.join(setDir, "views.json"), "utf8")) as { cameras?: string[] }).cameras ?? [] : [];
  for (const { file, from, key } of todo) {
    if (isShot(from)) continue;
    let source: string;
    let absent: string;
    if ("view" in from) {
      source = path.join(setDir, `${from.view}.jpg`);
      absent = `the set's ${from.view} isn't drawn`;
    } else if ("camera" in from) {
      const at = from.frame !== undefined ? (cameras[from.frame - 1] === from.camera ? from.frame - 1 : -1) : cameras.indexOf(from.camera);
      source = path.join(setDir, `cam-${String(at + 1).padStart(2, "0")}.jpg`);
      absent = at < 0 ? `the set has no camera called ${from.camera}${from.frame !== undefined ? ` at frame ${from.frame}` : ""}` : `the frame of ${from.camera} isn't drawn`;
    } else {
      source = path.join(capturesDir ?? "", from.capture);
      absent = "an in-game capture, which this machine doesn't have (capture-sets makes them)";
    }
    if (("capture" in from && !capturesDir) || !existsSync(source) || path.basename(source) === "cam-00.jpg") {
      await failed(file, absent);
      continue;
    }
    await copyFile(source, path.join(setDir, file));
    await done(file, key);
  }

  // Shots drawn with the same pieces, cut and floor go to Blender together.
  const groups = new Map<string, { file: string; from: Shot; key: string }[]>();
  for (const entry of todo) {
    if (!isShot(entry.from)) continue;
    const { cut, floor, only, without } = entry.from;
    const group = JSON.stringify([cut ?? null, floor ?? null, only ?? null, without ?? null]);
    groups.set(group, [...(groups.get(group) ?? []), { ...entry, from: entry.from }]);
  }
  const scratch = path.join(setDir, "card", ".drawing");
  try {
    for (const entries of groups.values()) {
      const { cut, floor, only, without } = entries[0]!.from;
      const shots: SetShot[] = [];
      const written: string[] = [];
      entries.forEach(({ from }, index) => {
        const name = `card-${index}`;
        const common = { name, ...(from.fov !== undefined ? { fov: from.fov } : {}), ...(cut !== undefined ? { cut: true } : {}) };
        if ("compass" in from) {
          shots.push({ ...common, compass: from.compass, ...(from.at ? { at: from.at } : {}) });
          written.push(`${name}-${from.way}`);
        } else if ("orbit" in from) {
          shots.push({ ...common, orbit: from.orbit });
          written.push(name);
        } else if ("plan" in from) {
          shots.push({ ...common, plan: true });
          written.push(name);
        } else {
          shots.push({ ...common, eye: from.eye, target: from.target });
          written.push(name);
        }
      });
      try {
        await shoot({
          setDir,
          blender,
          shots,
          outDir: scratch,
          ...(cut !== undefined ? { cutZ: cut } : {}),
          ...(floor !== undefined ? { floor } : {}),
          ...(only ? { only: new RegExp(only, "i") } : {}),
          ...(without ? { without: new RegExp(without, "i") } : {}),
        });
      } catch (error) {
        for (const { file } of entries) await failed(file, `the shot couldn't be drawn: ${(error as Error).message.split("\n")[0]}`);
        continue;
      }
      for (const [index, { file, key }] of entries.entries()) {
        const drawn = path.join(scratch, `${written[index]}.jpg`);
        if (!existsSync(drawn)) {
          await failed(file, "the shot drew no picture");
          continue;
        }
        await rename(drawn, path.join(setDir, file));
        await done(file, key);
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return result;
}

/**
 * Copies each picture's in-game counterpart (its look's `game`) from the set's game frames, as
 * `card/<n>-game.jpg`; one the look no longer names is taken away. A counterpart the machine
 * doesn't have is listed missing, and one copied earlier stays.
 */
async function drawGamePictures(request: SetCardsRequest, record: Record<string, string>, recordFile: string, result: SetCardsResult): Promise<void> {
  const { setDir, look, gameDir } = request;
  const named = new Set<string>();
  for (const picture of look.pictures ?? []) {
    if (!picture.game) continue;
    const file = gameFile(picture.file);
    named.add(file);
    const key = `game ${JSON.stringify(picture.game)}`;
    const target = path.join(setDir, file);
    if (!request.force && record[file] === key && existsSync(target)) {
      result.kept.push(file);
      continue;
    }
    const source = path.join(gameDir ?? "", picture.game.capture);
    if (!gameDir || !existsSync(source)) {
      result.missing.push({ file, why: "an in-game card frame, which this machine doesn't have (capture-sets on a card sheet makes them)" });
      continue;
    }
    await mkdir(path.join(setDir, "card"), { recursive: true });
    await copyFile(source, target);
    record[file] = key;
    result.made.push(file);
    await writeFile(recordFile, JSON.stringify(record));
  }
  for (const file of Object.keys(record)) {
    if (!file.endsWith("-game.jpg") || named.has(file)) continue;
    delete record[file];
    await rm(path.join(setDir, file), { force: true });
    await writeFile(recordFile, JSON.stringify(record));
  }
}
