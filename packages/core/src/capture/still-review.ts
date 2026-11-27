// The Still Review builder (#124): one round of a set's review, made from capture_shots folders.
// Each version (a change to the map, in order) is one or more capture folders of the set's Shots;
// a later folder, a retake, fills the Shots the earlier ones lack (no frame, or a wrong one),
// matched by place (rect, pitch and yaw), since a retake numbers its own Shots from 1. Every frame
// is checked against a reference capture (frame-check.ts). The round's folder,
// missions/<id>/output/stills/<set>/<round>/ for a Mission, gets:
//
// - review.json: every Shot's frames with their status, the problems, the retakes to make and the summary;
// - frames/: the frames the page shows, at most 1600 px wide, as <version's number>-<shot>.jpg;
// - index.html: the page (still-review-page.ts), published as an artifact with them beside it.
//
// The author's choices on the page are kept in the artifact's db; recordStillFeedback writes the
// rows an agent read from it as feedback.json and feedback.md, which the next round shows.

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { z } from "zod";

import { checkFrames, type FrameCheck } from "./frame-check.js";
import { checkCaptureName } from "./stop-tour.js";
import { missionStillsDir } from "./zone-shots.js";
import { stillReviewPage } from "./still-review-page.js";

/** The widest frame the page gets. */
const FRAME_WIDTH = 1600;

/** The best pick that says no version is better than the first. */
export const NO_CHANGE = "no-change";
/** The quick tags the page offers. */
export const STILL_TAGS = ["too-busy", "too-flat", "seams", "wrong-colour", "good"] as const;

export type FrameStatus = "ok" | "missing" | "late" | "wrong" | "unconfirmed";

export type StillVersion = {
  readonly label: string;
  readonly note?: string;
  /** capture_shots folders, the first a full capture of the set's Shots, the rest retakes. */
  readonly captures: readonly string[];
};

export type BuildStillReviewOptions = {
  /** A Mission (its round goes in its output/stills/), or a folder of sets for any Map Package. */
  readonly target: { readonly blueprintPath: string } | { readonly folder: string };
  readonly set: string;
  readonly round: string;
  readonly versions: readonly StillVersion[];
  /** The capture the frames are checked against: by default the first version's first. */
  readonly reference?: string;
  /** The previous round's folder, whose feedback the page shows beside each Shot. */
  readonly previous?: string;
  /** The lighting the frames were captured in, for the header. */
  readonly lighting?: string;
};

/** A Shot as capture_shots places it: what matches a retake's Shot to the set's. */
export type StillShotSpec = { readonly rect: readonly number[]; readonly pitch: number; readonly yaw: number; readonly label?: string; readonly close?: true };

export type StillFrame = {
  readonly version: string;
  readonly status: FrameStatus;
  /** The copy the page shows, relative to the round's folder, or null when it is left off. */
  readonly frame: string | null;
  /** The capture folder it came from, or that was found lacking. */
  readonly capture: string;
  /** Its frame check's scores, for a checked frame. */
  readonly own?: number;
  readonly match?: { readonly shot: number; readonly score: number };
};

export type ShotFeedback = { readonly best: string; readonly tags: readonly string[]; readonly note: string };

export type StillReviewShot = StillShotSpec & {
  readonly shot: number;
  readonly frames: readonly StillFrame[];
  /** The previous round's feedback on it. */
  readonly previous?: ShotFeedback;
};

export type StillProblem = { readonly shot: number; readonly label?: string; readonly version: string; readonly status: "missing" | "late" | "wrong"; readonly shows?: number };

export type StillReview = {
  readonly mission?: string;
  readonly map: string;
  readonly set: string;
  readonly round: string;
  readonly lighting?: string;
  readonly versions: readonly { readonly label: string; readonly note?: string; readonly captures: readonly string[] }[];
  readonly reference: string;
  readonly previous?: { readonly round: string; readonly overall?: string };
  readonly shots: readonly StillReviewShot[];
  /** The frames left off the page, by Shot and version. */
  readonly problems: readonly StillProblem[];
  /** The frames shown with a badge: the check couldn't confirm their place. */
  readonly unconfirmed: readonly { readonly shot: number; readonly label?: string; readonly version: string }[];
  /** For each version with problems, the capture_shots call that retakes exactly those Shots: on its map, these Shots. */
  readonly retakes: readonly { readonly version: string; readonly map: string; readonly shots: readonly StillShotSpec[] }[];
  readonly summary: string;
};

export type BuildStillReviewResult = { readonly roundDir: string; readonly review: StillReview; readonly summary: string };

const CapturedSchema = z
  .object({
    map: z.string().optional(),
    shots: z.array(
      z
        .object({
          shot: z.number().int(),
          frame: z.string().nullable(),
          late: z.literal(true).optional(),
          rect: z.array(z.number()).length(4),
          pitch: z.number(),
          yaw: z.number(),
          label: z.string().optional(),
          close: z.literal(true).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
type Captured = z.infer<typeof CapturedSchema>;

const FeedbackSchema = z.object({
  round: z.string(),
  done: z.boolean(),
  overall: z.string(),
  shots: z.array(z.object({ shot: z.number().int(), label: z.string().optional(), best: z.string(), tags: z.array(z.string()), note: z.string() })),
});
export type StillFeedback = z.infer<typeof FeedbackSchema>;

/** The folder a target's sets go in. */
const stillsDirOf = (target: BuildStillReviewOptions["target"]): string => ("blueprintPath" in target ? missionStillsDir(target.blueprintPath) : path.resolve(target.folder));

const placeKey = (shot: Pick<StillShotSpec, "rect" | "pitch" | "yaw">): string => JSON.stringify([shot.rect, shot.pitch, shot.yaw]);
const named = (shot: { shot: number; label?: string | undefined }): string => (shot.label ? `Shot ${shot.shot} (${shot.label})` : `Shot ${shot.shot}`);

async function readCapture(folder: string): Promise<Captured> {
  const file = path.join(folder, "shots.json");
  if (!existsSync(file)) throw new Error(`${folder} has no shots.json: give a capture_shots folder`);
  const parsed = CapturedSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) throw new Error(`${file} isn't a capture_shots record: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  return parsed.data;
}

async function readFeedback(roundDir: string): Promise<StillFeedback> {
  const file = path.join(roundDir, "feedback.json");
  if (!existsSync(file)) throw new Error(`${roundDir} has no feedback.json: record that round's feedback (record_still_feedback) first`);
  return FeedbackSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

/** Builds a round's folder, as above. */
export async function buildStillReview(options: BuildStillReviewOptions): Promise<BuildStillReviewResult> {
  checkCaptureName(options.set);
  checkCaptureName(options.round);
  const { versions } = options;
  if (versions.length === 0) throw new Error("A round needs at least one version");
  const labels = new Set<string>();
  for (const version of versions) {
    if (!version.label.trim()) throw new Error("Each version needs a label");
    if (version.label === NO_CHANGE) throw new Error(`${NO_CHANGE} is the page's own pick, so it can't be a version's label`);
    if (labels.has(version.label)) throw new Error(`Two versions are labelled ${version.label}: each needs its own`);
    labels.add(version.label);
    if (version.captures.length === 0) throw new Error(`Version ${version.label} has no capture folders`);
  }
  const roundDir = path.join(stillsDirOf(options.target), options.set, options.round);
  if (existsSync(path.join(roundDir, "feedback.json"))) throw new Error(`${roundDir} already has the author's feedback: build the next round in a new folder`);

  const captures = new Map<string, Captured>();
  for (const folder of [...versions.flatMap((version) => version.captures), ...(options.reference ? [options.reference] : [])]) {
    const resolved = path.resolve(folder);
    if (!captures.has(resolved)) captures.set(resolved, await readCapture(resolved));
  }
  const capture = (folder: string): Captured => captures.get(path.resolve(folder))!;

  // The set's Shots are the first capture's: every other capture's Shots must be among them.
  const first = capture(versions[0]!.captures[0]!);
  const setShots = first.shots.map(({ shot, rect, pitch, yaw, label, close }) => ({ shot, rect, pitch, yaw, ...(label !== undefined ? { label } : {}), ...(close ? { close } : {}) }));
  const byPlace = new Map<string, number>();
  for (const shot of setShots) {
    const twin = byPlace.get(placeKey(shot));
    if (twin !== undefined) throw new Error(`${versions[0]!.captures[0]}'s Shots ${twin} and ${shot.shot} frame the same place, so a retake can't tell them apart: give each Shot its own rect`);
    byPlace.set(placeKey(shot), shot.shot);
  }
  /** A capture's frames by set Shot: its file, or why it has none. */
  const framesOf = (folder: string): Map<number, { file: string } | { lacks: "missing" | "late" }> => {
    const frames = new Map<number, { file: string } | { lacks: "missing" | "late" }>();
    for (const shot of capture(folder).shots) {
      const setShot = byPlace.get(placeKey(shot));
      if (setShot === undefined) throw new Error(`${folder}'s ${named(shot)} isn't one of the set's Shots (those of ${versions[0]!.captures[0]}): a retake must frame the same places`);
      frames.set(setShot, shot.frame ? { file: path.join(path.resolve(folder), shot.frame) } : { lacks: shot.late ? "late" : "missing" });
    }
    return frames;
  };

  const referenceFolder = path.resolve(options.reference ?? versions[0]!.captures[0]!);
  const reference = new Map([...framesOf(referenceFolder)].flatMap(([shot, entry]) => ("file" in entry ? [[shot, entry.file] as const] : [])));

  const previous = options.previous ? await readFeedback(path.resolve(options.previous)) : undefined;

  await rm(path.join(roundDir, "frames"), { recursive: true, force: true });
  await mkdir(path.join(roundDir, "frames"), { recursive: true });

  // Each version's frame for each Shot: the first capture's that the check passes, else its worst lack.
  const RANK = { wrong: 3, late: 2, missing: 1 } as const;
  const chosen: StillFrame[][] = setShots.map(() => []);
  for (const [v, version] of versions.entries()) {
    const found = new Map<number, StillFrame>();
    for (const folder of version.captures) {
      const frames = framesOf(folder);
      const toCheck = [...frames].flatMap(([shot, entry]) => ("file" in entry && !(found.get(shot)?.frame) ? [{ shot, file: entry.file }] : []));
      const checks = new Map((await checkFrames(reference, toCheck)).map((check) => [check.shot, check]));
      for (const [shot, entry] of frames) {
        const sofar = found.get(shot);
        if (sofar?.frame) continue;
        const check: FrameCheck | undefined = checks.get(shot);
        if ("file" in entry && !check) throw new Error(`${folder}'s frame of Shot ${shot} wasn't checked`);
        const status: FrameStatus = check ? check.status : (entry as { lacks: "missing" | "late" }).lacks;
        const scores = check ? { ...(check.own !== undefined ? { own: check.own } : {}), ...(check.match ? { match: check.match } : {}) } : {};
        if (status === "ok" || status === "unconfirmed") {
          const copy = `frames/${v + 1}-${String(shot).padStart(2, "0")}.jpg`;
          await sharp((entry as { file: string }).file).resize({ width: FRAME_WIDTH, withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(path.join(roundDir, copy));
          found.set(shot, { version: version.label, status, frame: copy, capture: path.resolve(folder), ...scores });
        } else if (!sofar || RANK[status] > RANK[sofar.status as keyof typeof RANK]) {
          found.set(shot, { version: version.label, status, frame: null, capture: path.resolve(folder), ...scores });
        }
      }
    }
    for (const [i, shot] of setShots.entries()) chosen[i]!.push(found.get(shot.shot) ?? { version: version.label, status: "missing", frame: null, capture: path.resolve(version.captures[0]!) });
  }

  const previousShots = new Map(previous?.shots.map((shot) => [shot.shot, { best: shot.best, tags: shot.tags, note: shot.note }]));
  const shots: StillReviewShot[] = setShots.map((shot, i) => {
    const before = previousShots.get(shot.shot);
    return { ...shot, frames: chosen[i]!, ...(before ? { previous: before } : {}) };
  });
  const problems: StillProblem[] = [];
  const unconfirmed: StillReview["unconfirmed"][number][] = [];
  for (const version of versions) {
    for (const shot of shots) {
      const entry = shot.frames.find((candidate) => candidate.version === version.label)!;
      const label = shot.label !== undefined ? { label: shot.label } : {};
      if (entry.status === "unconfirmed") unconfirmed.push({ shot: shot.shot, ...label, version: version.label });
      if (entry.status === "missing" || entry.status === "late" || entry.status === "wrong") {
        problems.push({ shot: shot.shot, ...label, version: version.label, status: entry.status, ...(entry.status === "wrong" && entry.match ? { shows: entry.match.shot } : {}) });
      }
    }
  }
  const retakes = versions.flatMap((version) => {
    const lacking = new Set(problems.filter((problem) => problem.version === version.label).map((problem) => problem.shot));
    if (lacking.size === 0) return [];
    const map = capture(version.captures[0]!).map ?? "";
    return [{ version: version.label, map, shots: setShots.filter((shot) => lacking.has(shot.shot)).map(({ rect, pitch, yaw, label, close }) => ({ rect, pitch, yaw, ...(label !== undefined ? { label } : {}), ...(close ? { close } : {}) })) }];
  });

  const mapName = path.basename(first.map ?? "map", ".SC2Map");
  const summary = summarise({ set: options.set, round: options.round, roundDir, shots, versions, problems, unconfirmed, retakes });
  const review: StillReview = {
    ...("blueprintPath" in options.target ? { mission: path.basename(path.dirname(options.target.blueprintPath)) } : {}),
    map: mapName,
    set: options.set,
    round: options.round,
    ...(options.lighting ? { lighting: options.lighting } : {}),
    versions: versions.map((version) => ({ label: version.label, ...(version.note ? { note: version.note } : {}), captures: version.captures.map((folder) => path.resolve(folder)) })),
    reference: referenceFolder,
    ...(previous ? { previous: { round: previous.round, ...(previous.overall ? { overall: previous.overall } : {}) } } : {}),
    shots,
    problems,
    unconfirmed,
    retakes,
    summary,
  };
  await writeFile(path.join(roundDir, "review.json"), `${JSON.stringify(review, null, 2)}\n`);
  await writeFile(path.join(roundDir, "index.html"), stillReviewPage(pageDataOf(review)));
  return { roundDir, review, summary };
}

/** What the page carries: the review without this machine's paths, which a published page mustn't show. */
export type StillPageData = Omit<StillReview, "versions" | "reference" | "shots" | "retakes" | "summary"> & {
  readonly versions: readonly { readonly label: string; readonly note?: string }[];
  readonly shots: readonly (Omit<StillReviewShot, "frames"> & { readonly frames: readonly Omit<StillFrame, "capture">[] })[];
  readonly tags: readonly string[];
  /** The best pick that says no version is better. */
  readonly noChange: string;
};

function pageDataOf(review: StillReview): StillPageData {
  const { versions, reference: _reference, shots, retakes: _retakes, summary: _summary, ...rest } = review;
  return {
    ...rest,
    versions: versions.map(({ captures: _captures, ...version }) => version),
    shots: shots.map((shot) => ({ ...shot, frames: shot.frames.map(({ capture: _capture, ...entry }) => entry) })),
    tags: STILL_TAGS,
    noChange: NO_CHANGE,
  };
}

function summarise(review: Pick<StillReview, "set" | "round" | "shots" | "problems" | "unconfirmed" | "retakes"> & { roundDir: string; versions: readonly StillVersion[] }): string {
  const lines = [`Built round ${review.round} of set ${review.set} in ${review.roundDir}: ${review.shots.length} Shot(s), ${review.versions.length} version(s).`];
  const byShot = new Map(review.shots.map((shot) => [shot.shot, shot]));
  const why = (problem: StillProblem): string =>
    problem.status === "wrong" ? `shows ${problem.shows !== undefined ? `${named(byShot.get(problem.shows)!)}'s place` : "another Shot's place"}` : problem.status === "late" ? "was captured late" : "has no frame";
  if (review.problems.length) {
    lines.push("Left off the page:");
    for (const problem of review.problems) lines.push(`- ${problem.version}: ${named(problem)} ${why(problem)}`);
  }
  if (review.unconfirmed.length) lines.push(`Shown with a badge, since nothing in the reference matches them well (a big repaint does that; look before trusting them): ${review.unconfirmed.map((entry) => `${entry.version} ${named(entry)}`).join(", ")}.`);
  for (const retake of review.retakes) {
    const numbers = review.problems.filter((problem) => problem.version === retake.version).map((problem) => problem.shot);
    lines.push(`Retake for ${retake.version}: Shots ${numbers.join(", ")}, with capture_shots on ${retake.map || "its map"} (review.json's retakes has them), then build the round again with the new folder after that version's.`);
  }
  if (!review.problems.length) lines.push("Every frame is on the page.");
  return lines.join("\n");
}

/** A row the agent read from the page's db: its document path and body. */
export type StillDbRow = { readonly path: string; readonly data: Record<string, unknown> };

const ShotRowSchema = z.object({ best: z.string().default(""), tags: z.array(z.string()).default([]), note: z.string().default("") }).passthrough();

/**
 * Writes the author's feedback for a round, from the page's db rows: shots/<n> { best, tags, note },
 * review/overall { note } and review/status { done }. A Shot with no row has no feedback.
 */
export async function recordStillFeedback(roundDir: string, rows: readonly StillDbRow[]): Promise<StillFeedback & { readonly files: readonly string[] }> {
  const reviewFile = path.join(roundDir, "review.json");
  if (!existsSync(reviewFile)) throw new Error(`${roundDir} has no review.json: give a round's folder from build_still_review`);
  const review = JSON.parse(await readFile(reviewFile, "utf8")) as StillReview;
  const shotsByNumber = new Map(review.shots.map((shot) => [shot.shot, shot]));
  const picks = new Set([NO_CHANGE, ...review.versions.map((version) => version.label)]);
  let overall = "";
  let done = false;
  const shots = new Map<number, StillFeedback["shots"][number]>();
  for (const row of rows) {
    const shotPath = /^shots\/(\d+)$/.exec(row.path);
    if (shotPath) {
      const number = Number(shotPath[1]);
      const shot = shotsByNumber.get(number);
      if (!shot) throw new Error(`Row ${row.path}: round ${review.round} has no Shot ${number}`);
      const { best, tags, note } = ShotRowSchema.parse(row.data);
      if (best && !picks.has(best)) throw new Error(`Row ${row.path}: best is ${best}, not one of ${[...picks].join(", ")}`);
      const unknown = tags.filter((tag) => !(STILL_TAGS as readonly string[]).includes(tag));
      if (unknown.length) throw new Error(`Row ${row.path}: tags ${unknown.join(", ")} aren't the page's (${STILL_TAGS.join(", ")})`);
      shots.set(number, { shot: number, ...(shot.label !== undefined ? { label: shot.label } : {}), best, tags, note });
    } else if (row.path === "review/overall") {
      overall = typeof row.data.note === "string" ? row.data.note : "";
    } else if (row.path === "review/status") {
      done = row.data.done === true;
    } else {
      throw new Error(`Row ${row.path} isn't one of the page's: shots/<n>, review/overall or review/status`);
    }
  }
  const feedback: StillFeedback = { round: review.round, done, overall, shots: [...shots.values()].sort((a, b) => a.shot - b.shot) };
  const json = path.join(roundDir, "feedback.json");
  const markdown = path.join(roundDir, "feedback.md");
  await writeFile(json, `${JSON.stringify(feedback, null, 2)}\n`);
  await writeFile(markdown, feedbackMarkdown(review, feedback));
  return { ...feedback, files: [json, markdown] };
}

function feedbackMarkdown(review: StillReview, feedback: StillFeedback): string {
  const lines = [`# Still Review: ${review.map}, set ${review.set}, round ${review.round}`, "", feedback.done ? "The author marked the round done." : "The author hasn't marked the round done.", ""];
  lines.push(`Versions: ${review.versions.map((version) => (version.note ? `${version.label} (${version.note})` : version.label)).join("; ")}.`, "");
  if (feedback.overall) lines.push("## Overall", "", feedback.overall, "");
  lines.push("## Shots", "");
  for (const shot of review.shots) {
    const entry = feedback.shots.find((candidate) => candidate.shot === shot.shot);
    if (!entry) {
      lines.push(`- ${named(shot)}: no feedback`);
      continue;
    }
    const parts = [entry.best ? `best: ${entry.best === NO_CHANGE ? "no change" : entry.best}` : "", entry.tags.length ? `tags: ${entry.tags.join(", ")}` : "", entry.note ? `note: ${entry.note}` : ""].filter(Boolean);
    lines.push(`- ${named(shot)}: ${parts.join("; ") || "no feedback"}`);
  }
  return `${lines.join("\n")}\n`;
}
