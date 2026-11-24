// A Style Pack's exemplar captures (#26): its place and grid tours, planned from its Map Studies
// and places, captured through the Editor Broker, and the 1000px copies of their frames. What the
// capture_exemplar tool, `npm run capture-exemplars` and make-frames.sh all call.
//
// Tours and frames go to `exemplarCaptureDir`: the pack's Exemplar Maps folder, as
// `<id>/captures/<tour>/` and `<id>/frames/<tour>/` (git-ignored in a scaffolded pack), or the
// research archive when SC2_RESEARCH_DIR is set.

import { existsSync, readFileSync } from "node:fs";
import { appendFile, copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import type { Host } from "../host/host.js";
import type { Workspace } from "../plugins/workspace.js";
import { exemplarCaptureDir, type ExemplarOptions, mixturesFile, selectExemplars } from "../study/study-exemplars.js";
import { captureExemplarTours, type ExemplarEntry, type ExemplarMixtures, type ExemplarStudy, type ExemplarTour, type ExemplarTourOutcome, gridTours, placeTours } from "./exemplar-capture.js";

/** Place tours, a frame centred on each of the pack's places; or grid tours over each map's playable area. */
export type TourKind = "places" | "grid";

export type PlannedTours = {
  readonly tours: readonly ExemplarTour[];
  /** With place tours: the maps the pack's mixtures list no places of, which get no tour. */
  readonly withoutPlaces: readonly string[];
};

async function readJson<T>(file: string): Promise<T | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`${file} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The tours of each Exemplar Map `ids` names (every one when not given): with "places", one frame
 * centred on each place the pack's mixtures list (`placeTours`); with "grid", one tour per lighting
 * the map's study lists, or its captureLights (`gridTours`). Refused, before anything runs, for an
 * id the pack doesn't list, a missing source map, a map with no study where the plan reads it, or
 * place tours when the pack has no places yet.
 */
export async function planStylePackTours(workspace: Workspace, options: ExemplarOptions & { readonly tours: TourKind }): Promise<PlannedTours> {
  const exemplars = await selectExemplars(workspace, options);
  // Read only for the maps whose plan needs it: a grid tour with captureLights doesn't.
  const studyOf = (id: string): ExemplarStudy => {
    const file = path.join(exemplars.find((exemplar) => exemplar.id === id)!.studyDir, "study.json");
    if (!existsSync(file)) throw new Error(`No Map Study for ${id} (${file}): run study_exemplar on it first`);
    try {
      return JSON.parse(readFileSync(file, "utf8")) as ExemplarStudy;
    } catch (error) {
      throw new Error(`${file} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  // Each entry's capture settings (captureLights, placeLight, placeZones) are in its settings.
  const entries: ExemplarEntry[] = exemplars.map((exemplar) => ({ ...(exemplar.settings as Partial<ExemplarEntry>), id: exemplar.id, path: exemplar.source }));
  if (options.tours === "grid") return { tours: gridTours(entries, studyOf), withoutPlaces: [] };

  const file = mixturesFile(workspace);
  const mixtures = await readJson<Partial<ExemplarMixtures>>(file);
  if (!mixtures?.places) throw new Error(`The Style Pack has no places yet (${file}): run find_places first, or capture grid tours`);
  const ids = new Set(entries.map((entry) => entry.id));
  const chosen: ExemplarMixtures = { maps: entries.map((entry) => entry.id), places: mixtures.places.filter((place) => ids.has(place.map)) };
  const withoutPlaces = chosen.maps.filter((id) => !chosen.places.some((place) => place.map === id));
  return { tours: placeTours(entries, chosen, studyOf), withoutPlaces };
}

export type CaptureStylePackOptions = ExemplarOptions & {
  readonly tours: TourKind;
  /** Where the tours go; `exemplarCaptureDir` by default. */
  readonly captureDir?: string;
  readonly startOnInit?: boolean;
  readonly showErrors?: boolean;
  readonly log?: (line: string) => void;
  /** Hears the broker's id for each tour as it is queued. */
  readonly onQueued?: (id: string) => void;
  /** Cancels the tour running or waiting, and the tours after it. */
  readonly signal?: AbortSignal;
};

export type CaptureStylePackResult = PlannedTours & {
  readonly captureDir: string;
  readonly outcomes: readonly ExemplarTourOutcome[];
  readonly frames: MakeFramesResult;
};

/**
 * Plans the tours (`planStylePackTours`), captures each that has no frames yet, so a rerun
 * resumes, then makes their 1000px frames (`makeFrames`).
 */
export async function captureStylePack(workspace: Workspace, host: Host, options: CaptureStylePackOptions): Promise<CaptureStylePackResult> {
  const planned = await planStylePackTours(workspace, options);
  const captureDir = options.captureDir ?? exemplarCaptureDir(workspace);
  // Into the pack's own folder, the screenshots must never be committed with it.
  if (captureDir === path.dirname(mixturesFile(workspace))) await ignoreCaptures(captureDir);
  const outcomes = await captureExemplarTours(host, planned.tours, {
    capturesRoot: captureDir,
    ...(options.startOnInit ? { startOnInit: true } : {}),
    ...(options.showErrors ? { showErrors: true } : {}),
    ...(options.log ? { log: options.log } : {}),
    ...(options.onQueued ? { onQueued: options.onQueued } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const frames = await makeFrames(captureDir, mixturesFile(workspace), { maps: [...new Set(planned.tours.map((tour) => tour.id))] });
  return { ...planned, captureDir, outcomes, frames };
}

const IGNORED = ["*/captures/", "*/frames/"];

/** Adds `*\/captures/` and `*\/frames/` to the .gitignore in `dir`, where it lacks them. */
export async function ignoreCaptures(dir: string): Promise<void> {
  const file = path.join(dir, ".gitignore");
  const text = existsSync(file) ? await readFile(file, "utf8") : "";
  const lines = new Set(text.split("\n").map((line) => line.trim()));
  const missing = IGNORED.filter((rule) => !lines.has(rule));
  if (!missing.length) return;
  const header = text ? "" : "# In-game tours and their 1000px frames (capture_exemplar): never committed.\n";
  await mkdir(dir, { recursive: true });
  await appendFile(file, `${text && !text.endsWith("\n") ? "\n" : ""}${header}${missing.join("\n")}\n`);
}

export type MakeFramesResult = {
  readonly made: number;
  readonly removed: number;
  /** The frames under `<id>/frames/` afterwards, of the maps it worked on. */
  readonly kept: number;
  /** Captures that couldn't be read as images, relative to the capture folder: a tour cut short, say. */
  readonly unreadable: readonly string[];
};

const FRAME_WIDTH = 1000;
const FRAME_QUALITY = 75;

const dirsIn = async (dir: string): Promise<string[]> => (existsSync(dir) ? (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() : []);
const jpgsIn = async (dir: string): Promise<string[]> => (existsSync(dir) ? (await readdir(dir)).filter((file) => file.endsWith(".jpg")).sort() : []);
/** `<id>/captures/<tour>/<file>` for `<id>/frames/<tour>/<file>`, and back. */
const toCaptures = (frame: string) => frame.replace(/^([^/]+)\/frames\//, "$1/captures/");
const toFrames = (capture: string) => capture.replace(/^([^/]+)\/captures\//, "$1/frames/");

/**
 * Makes the 1000px copies (JPEG quality 75) of the tours under `captureDir`, in
 * `<id>/frames/<tour>/`: every frame of a place tour (`captures/places-*`), and from grid tours only
 * the frames the mixtures file's places list. A frame older than its capture is made again, since a
 * rerun tour overwrites its captures. stops.txt is copied whole. Frames no place lists any more are
 * removed, and so are tours left without frames, but only where their captures are there to make
 * them again: a frame with no capture beside it may be the only copy. With `maps`, only those
 * maps' frames are made or removed.
 */
export async function makeFrames(captureDir: string, mixtures: string, { maps: only }: { readonly maps?: readonly string[] } = {}): Promise<MakeFramesResult> {
  const maps = (await dirsIn(captureDir)).filter((map) => !only || only.includes(map));
  const places = (await readJson<{ places?: readonly { frames?: readonly string[] }[] }>(mixtures))?.places ?? [];
  const wanted = new Set(places.flatMap((place) => place.frames ?? []).filter((frame) => maps.includes(frame.split("/")[0]!)));
  for (const map of maps) {
    for (const tour of (await dirsIn(path.join(captureDir, map, "captures"))).filter((name) => name.startsWith("places-"))) {
      for (const file of await jpgsIn(path.join(captureDir, map, "captures", tour))) wanted.add(`${map}/frames/${tour}/${file}`);
    }
  }

  let made = 0;
  const unreadable: string[] = [];
  for (const frame of [...wanted].sort()) {
    const capture = toCaptures(frame);
    const src = path.join(captureDir, capture);
    const dest = path.join(captureDir, frame);
    if (!existsSync(src)) continue;
    if (existsSync(dest) && (await stat(src)).mtimeMs <= (await stat(dest)).mtimeMs) continue;
    await mkdir(path.dirname(dest), { recursive: true });
    try {
      await sharp(src).resize(FRAME_WIDTH, FRAME_WIDTH, { fit: "inside" }).jpeg({ quality: FRAME_QUALITY }).toFile(dest);
      made++;
    } catch {
      unreadable.push(capture);
    }
  }

  let removed = 0;
  let kept = 0;
  for (const map of maps) {
    for (const tour of await dirsIn(path.join(captureDir, map, "captures"))) {
      const stops = path.join(captureDir, map, "captures", tour, "stops.txt");
      const frames = path.join(captureDir, toFrames(`${map}/captures/${tour}`));
      if (existsSync(stops) && existsSync(frames)) await copyFile(stops, path.join(frames, "stops.txt"));
    }
    for (const tour of await dirsIn(path.join(captureDir, map, "frames"))) {
      const dir = path.join(captureDir, map, "frames", tour);
      const rebuildable = existsSync(path.join(captureDir, map, "captures", tour));
      let left = 0;
      for (const file of await jpgsIn(dir)) {
        if (rebuildable && !wanted.has(`${map}/frames/${tour}/${file}`)) {
          await rm(path.join(dir, file));
          removed++;
        } else left++;
      }
      if (left === 0) await rm(dir, { recursive: true });
      kept += left;
    }
  }
  return { made, removed, kept, unreadable };
}
