// A Style Pack's Map Studies and places, built from its Exemplar Maps' source maps: what the
// study_exemplar and find_places tools, `npm run study` and the pack's exemplar scripts all call.
//
// Source maps resolve as `exemplarMapSources` says: in the folder the machine config's
// `exemplarMaps` names, else the Workspace config's.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { researchArchiveDirIfSet } from "../capture/research-archive.js";
import type { MachineConfig } from "../host/machine-config.js";
import { writePng } from "../preview/write-png.js";
import { exemplarMapSources, type ExemplarMapSource, stylePackFiles, type Workspace } from "../plugins/workspace.js";
import { replaceFile } from "../util/replace-file.js";
import { buildMixtures, findPlaces, moodRuleOf, type Place, readCaptureStops, type RecordedMood } from "./find-places.js";
import { loadMapPackage } from "./load-map-package.js";
import { buildMapStudy } from "./map-study.js";
import { studyDoodads } from "./measure-doodads.js";

/** Where the source maps come from, when not from the machine config read from its file. */
export type ExemplarOptions = {
  /** The Exemplar Maps to work on, by id; every one the pack lists when not given. */
  readonly ids?: readonly string[];
  readonly machine?: Pick<MachineConfig, "file" | "exemplarMaps">;
};

/**
 * The pack's Exemplar Maps named by `ids` (every one when not given), each with its source map.
 * Refused, before anything is written, for an id the pack doesn't list or a source map that isn't
 * there, naming them and the setting the folder came from.
 */
export async function selectExemplars(workspace: Workspace, { ids, machine }: ExemplarOptions = {}): Promise<ExemplarMapSource[]> {
  const exemplars = await exemplarMapSources(workspace, machine);
  const only = ids === undefined ? undefined : [...new Set(ids)];
  const unknown = (only ?? []).filter((id) => !exemplars.some((exemplar) => exemplar.id === id));
  if (unknown.length) {
    const listed = exemplars.length ? exemplars.map((exemplar) => exemplar.id).join(", ") : "none";
    throw new Error(`The Style Pack has no Exemplar Map ${unknown.join(", ")} (its Exemplar Maps: ${listed})`);
  }
  const chosen = only ? only.map((id) => exemplars.find((exemplar) => exemplar.id === id)!) : exemplars;
  const missing = chosen.filter((exemplar) => !existsSync(exemplar.source));
  if (missing.length) {
    const folder = path.dirname(missing[0]!.source);
    throw new Error(
      `No source map for Exemplar Map ${missing.map((exemplar) => `${exemplar.id} (${exemplar.source})`).join(", ")}. Put the map in ${folder}, or set exemplarMaps (in the machine config, or the Workspace config for a folder that travels with the Workspace) to the folder that holds it`,
    );
  }
  return chosen;
}

/** One Exemplar Map's study as written: its folder and the layer images in it. */
export type StudiedExemplar = { readonly id: string; readonly studyDir: string; readonly images: readonly string[]; readonly seconds: number };

/**
 * Builds the Map Study of each Exemplar Map `ids` names (every one when not given): `study.json`
 * and the layer images, in the pack's folder for that map. `onStudied` hears of each as it is written.
 */
export async function studyExemplars(workspace: Workspace, options: ExemplarOptions & { readonly onStudied?: (studied: StudiedExemplar) => void } = {}): Promise<StudiedExemplar[]> {
  const studied: StudiedExemplar[] = [];
  for (const exemplar of await selectExemplars(workspace, options)) {
    const started = Date.now();
    const { study, images } = buildMapStudy(exemplar, loadMapPackage(exemplar.source));
    await mkdir(exemplar.studyDir, { recursive: true });
    await writeFile(path.join(exemplar.studyDir, "study.json"), `${JSON.stringify(study, null, 2)}\n`);
    for (const [name, image] of Object.entries(images)) await writeFile(path.join(exemplar.studyDir, name), writePng(image));
    const done = { id: exemplar.id, studyDir: exemplar.studyDir, images: Object.keys(images), seconds: (Date.now() - started) / 1000 };
    studied.push(done);
    options.onStudied?.(done);
  }
  return studied;
}

const MoodConditionSchema = z.object({ motifs: z.array(z.string().min(1)).min(1), atLeast: z.number() }).strict();
const RecordedMoodSchema = z.object({ name: z.string().min(1), when: z.array(z.array(MoodConditionSchema).min(1)).min(1).optional() }).strict();
/** As much of a mixtures file as find_places reads back: the pack's moods. */
const MixturesFileSchema = z.object({ moodRules: z.array(RecordedMoodSchema).optional() }).passthrough();

/** The pack's mixtures file: `mixtures.json` beside its Exemplar Maps list. */
export function mixturesFile(workspace: Workspace): string {
  const { exemplarDir } = stylePackFiles(workspace);
  if (!exemplarDir) throw new Error("The Workspace's Style Pack lists no Exemplar Maps (contributions.exemplarMaps in its sc2-adjutant-plugin.json)");
  return path.join(exemplarDir, "mixtures.json");
}

/**
 * Where a pack's tours and their frames are, as `<id>/captures/<tour>/` and `<id>/frames/<tour>/`:
 * the research archive's `docs/research/exemplar-maps/` when SC2_RESEARCH_DIR is set, else the
 * pack's Exemplar Maps folder (git-ignored there).
 */
export function exemplarCaptureDir(workspace: Workspace, env: NodeJS.ProcessEnv = process.env): string {
  const archive = researchArchiveDirIfSet(env);
  return archive ? path.join(archive, "docs/research/exemplar-maps") : path.dirname(mixturesFile(workspace));
}

/** The moods the pack's mixtures file records, none when it has no file or no `moodRules`. */
export async function recordedMoods(file: string): Promise<RecordedMood[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = MixturesFileSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${file}: its moodRules aren't valid: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  return (parsed.data.moodRules ?? []).map(({ name, when }) => (when ? { name, when } : { name }));
}

export type FindPlacesResult = {
  readonly file: string;
  readonly maps: readonly string[];
  readonly places: number;
  /** Places per mood, in the pack's mood order; a mood no place has is left out. */
  readonly moods: Readonly<Record<string, number>>;
  /** The maps with no tours in the capture folder, whose places list no frames. */
  readonly withoutFrames: readonly string[];
};

export type FindStylePackPlacesOptions = ExemplarOptions & {
  /** Where the tours are (`readCaptureStops`); `exemplarCaptureDir` by default. */
  readonly captureDir?: string;
  /** The day recorded as `generated`, today by default. */
  readonly generated?: string;
};

/**
 * Finds the places of each Exemplar Map `ids` names (every one when not given) and writes them to
 * the pack's mixtures file, replacing what it held: each place with the frames near it and the
 * first of the pack's recorded moods (`moodRules`, kept) it passes, or no mood.
 */
export async function findStylePackPlaces(workspace: Workspace, options: FindStylePackPlacesOptions = {}): Promise<FindPlacesResult> {
  const exemplars = await selectExemplars(workspace, options);
  const file = mixturesFile(workspace);
  const moodRules = await recordedMoods(file);
  const moods = moodRules.map(moodRuleOf);
  const captureDir = options.captureDir ?? exemplarCaptureDir(workspace);
  const all: Place[] = [];
  const withoutFrames: string[] = [];
  for (const exemplar of exemplars) {
    const stops = readCaptureStops(captureDir, exemplar.id);
    if (!stops) withoutFrames.push(exemplar.id);
    all.push(...findPlaces(exemplar.id, studyDoodads(loadMapPackage(exemplar.source)), { moods, ...(stops ? { stops } : {}) }));
  }
  const maps = exemplars.map((exemplar) => exemplar.id);
  const library = buildMixtures(all, moodRules.map((mood) => mood.name));
  const generated = options.generated ?? new Date().toISOString().slice(0, 10);
  await replaceFile(file, `${JSON.stringify({ generated, maps, moodRules, ...library }, null, 1)}\n`);
  return { file, maps, places: all.length, moods: Object.fromEntries(Object.entries(library.moods).map(([mood, mixture]) => [mood, mixture.places])), withoutFrames };
}
