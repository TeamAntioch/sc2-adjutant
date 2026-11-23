// The effect tour's video: cuts a recording of a batch's tour (the Host Adapter's video.mp4 and
// video-stops.txt) into one short clip per effect, and picks the frames where most is on screen.
// A screenshot misses what's over before it's taken: Heroes impacts, and SC2's own, burst 30-100 ms
// into Birth, and their particles live a few tenths of a second (sc2-research
// docs/research/hots-effects/particles.md). The host notes stop times only to a tenth of a second
// or so, too coarse to aim at a burst, so the frames are picked by what they show: the most changed
// from a frame of the host on the pad just before the effect was attached.

import { copyFile, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { EffectShot } from "./effect-tour.js";
import { runBounded } from "../host/derive.js";

/** A recording's timeline, from video-stops.txt: each stop's time into the video, and each mark's (`m<n>`, saved once the pad is reset for effect n - 1, a second before it is attached). */
export type VideoTimeline = { readonly stops: ReadonlyMap<number, number>; readonly marks: ReadonlyMap<number, number> };

/** Reads video-stops.txt: `<stop> <seconds>` and `m<mark> <seconds>` lines; the first time of each wins. */
export function parseVideoStops(text: string): VideoTimeline {
  const stops = new Map<number, number>();
  const marks = new Map<number, number>();
  for (const line of text.split("\n")) {
    const match = /^(m?)(\d+)\s+([0-9.]+)$/.exec(line.trim());
    if (!match) continue;
    const into = match[1] ? marks : stops;
    const key = Number(match[2]);
    if (!into.has(key)) into.set(key, Number(match[3]));
  }
  return { stops, marks };
}

/**
 * One effect's place in the video, in seconds: `base` is a frame of the host on the pad before the
 * effect is attached; frames are searched from `base` to `searchEnd`, before the host moves; the
 * clip runs from `base` to `end`.
 */
export type EffectSegment = { readonly effect: number; readonly base: number; readonly searchEnd: number; readonly end: number };

/**
 * How long after its mark an effect's base frame is. The tour saves the mark once the pad is reset
 * and attaches the effect a second later; the host notices the mark a little late (a poll, more
 * when its loop stalls), so the base is a little after the noted time and still a bare pad as long
 * as the host is under 0.8 s late.
 */
export const BASE_AFTER_MARK = 0.2;

/** The tour's wait on the bare pad before each attach (FxTour_Reset), in real seconds. */
const RESET_WAIT = 0.5;

/**
 * Where each effect is in the video. Its mark (saved once its pad is reset) places it: the base
 * frame is BASE_AFTER_MARK later. A recording without marks places it by the previous effect's
 * last stop instead: after that frame's hold, the tour resets the pad and waits
 * RESET_WAIT, and the base is the middle of that wait. The first effect of such a recording has
 * no previous one: its base is `leadIn(effect)` seconds before its first stop, the time the tour
 * spends from the attach to that frame, plus half the reset wait. The search ends at its stand
 * frame's stop (the host moves only after it), else its last stop; the clip ends at the next
 * effect's base, or `hold` after its own last stop. An effect with no
 * timed stop has no segment.
 */
export function effectSegments(shots: readonly EffectShot[], timeline: VideoTimeline, hold: number, leadIn: (effect: number) => number = () => 4): EffectSegment[] {
  const effects = [...new Set(shots.map((shot) => shot.effect))].sort((a, b) => a - b);
  const placed: { effect: number; base: number; searchEnd: number; last: number }[] = [];
  let previousLast: number | undefined;
  for (const effect of effects) {
    const timed = shots.filter((shot) => shot.effect === effect && timeline.stops.has(shot.stop));
    if (timed.length === 0) {
      previousLast = undefined;
      continue;
    }
    const times = timed.map((shot) => timeline.stops.get(shot.stop)!);
    const first = Math.min(...times);
    const last = Math.max(...times);
    const mark = timeline.marks.get(effect + 1);
    const base =
      mark !== undefined
        ? mark + BASE_AFTER_MARK
        : previousLast !== undefined
          ? previousLast + hold + RESET_WAIT / 2
          : first - leadIn(effect) - RESET_WAIT / 2;
    const stand = timeline.stops.get(timed.find((shot) => shot.label === "stand")?.stop ?? -1);
    placed.push({ effect, base: Math.max(0, Math.min(base, first)), searchEnd: stand ?? last, last });
    previousLast = last;
  }
  return placed.map((each, n) => {
    const next = placed[n + 1];
    const end = next && next.effect === each.effect + 1 ? next.base : each.last + hold;
    return { effect: each.effect, base: each.base, searchEnd: Math.max(each.base, each.searchEnd), end: Math.max(each.searchEnd, end) };
  });
}

/**
 * The `count` frames that changed most, by `scores` (one per frame), at least `minGap` frames
 * apart so they don't all show the same instant; in time order. Frames scoring under `floor` are
 * never picked: a stretch where nothing happened gives none.
 */
export function pickPeaks(scores: readonly number[], count: number, minGap: number, floor = 0): number[] {
  const order = scores.map((score, frame) => ({ score, frame })).sort((a, b) => b.score - a.score || a.frame - b.frame);
  const picked: number[] = [];
  for (const { score, frame } of order) {
    if (picked.length >= count || score < floor) break;
    if (picked.every((other) => Math.abs(other - frame) >= minGap)) picked.push(frame);
  }
  return picked.sort((a, b) => a - b);
}

/** How much a grey pixel must change to count: past the video's compression noise. */
const PIXEL_CHANGE = 16;

/**
 * How far each frame is from the first: the percentage of its grey pixels that changed by more
 * than PIXEL_CHANGE. A share, not a mean difference, so a small effect seen from far off (a Psi
 * Storm filmed whole is about 1% of the frame) still stands out of the noise.
 */
export function changeScores(frames: Uint8Array, frameBytes: number, threshold = PIXEL_CHANGE): number[] {
  const count = Math.floor(frames.length / frameBytes);
  const scores: number[] = [];
  for (let n = 0; n < count; n++) {
    let changed = 0;
    for (let i = 0; i < frameBytes; i++) if (Math.abs(frames[n * frameBytes + i]! - frames[i]!) > threshold) changed++;
    scores.push((100 * changed) / frameBytes);
  }
  return scores;
}

/** The size the frames are compared at, and their rate. */
const PROBE_WIDTH = 320;
const PROBE_HEIGHT = 180;
const PROBE_FPS = 30;
/** How many peak frames an effect gets, and how far apart, in seconds. */
const PEAKS = 4;
const PEAK_GAP = 0.15;
/** Under this share of changed pixels (percent) a frame shows nothing new: noise, or the host's idle animation. */
const CHANGE_FLOOR = 0.05;

/** What one effect's clip and frames came to. */
export type EffectVideoResult = {
  readonly effect: number;
  readonly clip: string;
  /** The picked frames' files, and each one's seconds after the base frame. */
  readonly peaks: readonly { readonly file: string; readonly seconds: number }[];
};

const limits = (seconds: number, maxOutputBytes: number) => ({ timeoutMs: (60 + seconds * 4) * 1000, maxOutputBytes });

/**
 * Cuts `segment` of `video` into `<outDir>/clips/<name>.mp4` (HEVC, `clipWidth` wide) and writes its
 * peak frames as `<outDir>/peaks/<name>-<n>.jpg`. `name` is usually the effect's number.
 */
export async function cutEffect(video: string, segment: EffectSegment, outDir: string, name: string, clipWidth = 960): Promise<EffectVideoResult> {
  const seconds = Math.max(0.1, segment.end - segment.base);
  const searchSeconds = Math.max(0.1, segment.searchEnd - segment.base);
  const clips = path.join(outDir, "clips");
  const peaksDir = path.join(outDir, "peaks");
  await mkdir(clips, { recursive: true });
  await mkdir(peaksDir, { recursive: true });
  const clip = path.join(clips, `${name}.mp4`);
  const at = ["-ss", segment.base.toFixed(3), "-t", seconds.toFixed(3)];
  await runBounded("ffmpeg", ["-v", "error", "-y", ...at, "-i", video, "-an", "-vf", `scale=${clipWidth}:-2`, "-c:v", "hevc_videotoolbox", "-q:v", "50", "-tag:v", "hvc1", "-fs", String(20 * 1024 * 1024), clip], limits(seconds, 20 * 1024 * 1024));

  const scratch = await mkdtemp(path.join(os.tmpdir(), "effect-video-"));
  try {
    const raw = path.join(scratch, "frames.gray");
    const frameBytes = PROBE_WIDTH * PROBE_HEIGHT;
    const frameCount = Math.ceil(searchSeconds * PROBE_FPS + 2);
    // One decode for both: the small grey frames that are scored and the full frames to keep, from
    // the same resampled stream, so a picked frame is the one scored. Seeking for each picked frame
    // instead can land a frame off in a recording whose frames come unevenly, and a burst lasts three.
    await runBounded(
      "ffmpeg",
      [
        "-v", "error", "-y", "-ss", segment.base.toFixed(3), "-t", searchSeconds.toFixed(3), "-i", video, "-an",
        "-filter_complex", `fps=${PROBE_FPS},split=2[probe][full];[probe]scale=${PROBE_WIDTH}:${PROBE_HEIGHT},format=gray[grey]`,
        "-map", "[grey]", "-f", "rawvideo", raw,
        "-map", "[full]", "-q:v", "3", path.join(scratch, "%05d.jpg"),
      ],
      limits(searchSeconds, frameCount * (frameBytes + 2 * 1024 * 1024)),
    );
    const scores = changeScores(new Uint8Array(await readFile(raw)), frameBytes);
    const picked = pickPeaks(scores, PEAKS, Math.round(PEAK_GAP * PROBE_FPS), CHANGE_FLOOR);
    const peaks: { file: string; seconds: number }[] = [];
    for (const [n, frame] of picked.entries()) {
      const file = path.join(peaksDir, `${name}-${n + 1}.jpg`);
      await rename(path.join(scratch, `${String(frame + 1).padStart(5, "0")}.jpg`), file).catch(() => copyFile(path.join(scratch, `${String(frame + 1).padStart(5, "0")}.jpg`), file));
      peaks.push({ file, seconds: frame / PROBE_FPS });
    }
    return { effect: segment.effect, clip, peaks };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
