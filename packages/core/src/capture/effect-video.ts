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

import type { EffectPlan, EffectShot, EffectShotLabel } from "./effect-tour.js";
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

/** What a kept span of a clip shows. */
export type ClipPart = "attach" | "move" | "destroy" | "death";

/** A span of the recording a clip keeps, in seconds into it, and what it shows (more than one part when their windows touch). */
export type ClipSpan = { readonly parts: readonly ClipPart[]; readonly from: number; readonly to: number };

/**
 * How one effect's clip is cut: the spans it keeps, in time order, joined into one clip; how far
 * into the recording its frames are searched (the kept spans up to there); and, for a missile or
 * a model with ribbons, the span of its move, where its trail is.
 */
export type EffectCut = { readonly spans: readonly ClipSpan[]; readonly searchEnd: number; readonly trail?: ClipSpan };

/** The whole segment as one span, searched to its searchEnd: the cut before phases. */
export const wholeCut = (segment: EffectSegment): EffectCut => ({ spans: [{ parts: ["attach", "move", "destroy", "death"], from: segment.base, to: segment.end }], searchEnd: segment.searchEnd });

/** The tour's wait before it saves a frame's stop (FxTour_Shot), in real seconds. */
const SHOT_WAIT = 0.25;
/** The effect is attached a second after its mark (FxTour_Reset), so this long after its base. */
const ATTACH_AFTER_BASE = 1 - BASE_AFTER_MARK;
/** How long after a plain Destroy the after-destroy frame is taken (FxTour_Film's wait), in game seconds. */
const DESTROY_WAIT = 0.5;
/** The death copy's wait after it is attached, past its Birth (FxTour_Film), in game seconds. */
const DEATH_SETTLE = 0.75;
/** The reset's wait on the bare pad when the tour is recorded (FxTour_Reset), in real seconds. */
const RESET_WAIT_VIDEO = 1;
/** How late the host notes a stop at most: a stop is the frame's moment plus up to this. */
const NOTED_LATE = 0.45;
/** How much of a looping Stand a clip keeps after Birth. */
const STAND_KEEP = 0.8;
/** How long a clip keeps before an event the stops place, past NOTED_LATE, and after one ends. */
const LEAD = 0.1;
const TAIL = 0.3;
/** How long a clip keeps after a plain Destroy: the after-destroy frame is 0.75 s in, lingering particles a little longer. */
const DESTROY_KEEP = 1.25;

/**
 * The phases of one effect's clip, from the tour's script (effectTourScript) and the stops it was
 * filmed at: the attach and Birth, then STAND_KEEP of a looping Stand (all of one that plays once);
 * the whole move; the Destroy and what lingers after it; the Death. The holds between, where the
 * stills are taken and little moves, are dropped. Each event's time is reckoned back from the stop
 * of the frame that follows it (the frame's wait, from `plan`), and a window opens NOTED_LATE early
 * since the host notes a stop late; a stop missing from the recording is reckoned on from the one
 * before. The attach window opens at the base, the frame known to show the bare pad. Windows that
 * touch are joined, and none leaves the segment or runs into the next reset. Game seconds are taken as real ones, as Test
 * Document runs them. A missile's or ribbon model's frames are searched through its move, where its
 * trail is; others' up to the stand frame, as before.
 */
export function effectCut(segment: EffectSegment, shots: readonly EffectShot[], plan: Pick<EffectPlan, "birth" | "standShot" | "standLoops" | "move" | "death" | "fast">, timeline: VideoTimeline, hold: number): EffectCut {
  const own = shots.filter((shot) => shot.effect === segment.effect).sort((a, b) => a.stop - b.stop);
  const attach = segment.base + ATTACH_AFTER_BASE;
  // Each frame's stop: as noted, else reckoned on from the frame before.
  const at = new Map<EffectShotLabel, number>();
  let previous: { label: EffectShotLabel; time: number } | undefined;
  for (const shot of own) {
    const gap = (from: EffectShotLabel | undefined): number => {
      if (shot.label === "birth") return plan.birth + SHOT_WAIT;
      if (shot.label === "stand") return from === "birth" ? hold + plan.birth + plan.standShot + SHOT_WAIT : plan.standShot + SHOT_WAIT;
      if (shot.label === "moving") return hold + plan.move + SHOT_WAIT;
      if (shot.label === "after-destroy") return hold + DESTROY_WAIT + SHOT_WAIT;
      return hold + RESET_WAIT_VIDEO + 2 * plan.birth + DEATH_SETTLE + plan.death + SHOT_WAIT;
    };
    const time = timeline.stops.get(shot.stop) ?? (previous ? previous.time : attach) + gap(previous?.label);
    at.set(shot.label, time);
    previous = { label: shot.label, time };
  }
  const windows: ClipSpan[] = [];
  const keep = plan.standLoops ? STAND_KEEP : Math.max(STAND_KEEP, 2 * plan.standShot + TAIL);
  windows.push({ parts: ["attach"], from: segment.base, to: attach + 2 * plan.birth + keep });
  const stand = at.get("stand");
  const moving = at.get("moving");
  let trail: ClipSpan | undefined;
  if (plan.move > 0 && moving !== undefined) {
    const stopped = moving - SHOT_WAIT;
    const started = Math.min(stopped - plan.move, stand !== undefined ? stand + hold : Infinity);
    trail = { parts: ["move"], from: started - NOTED_LATE - LEAD, to: stopped + TAIL };
    windows.push(trail);
  }
  const afterDestroy = at.get("after-destroy");
  if (afterDestroy !== undefined) {
    const destroyed = afterDestroy - SHOT_WAIT - DESTROY_WAIT;
    windows.push({ parts: ["destroy"], from: destroyed - NOTED_LATE - LEAD, to: destroyed + DESTROY_KEEP });
  }
  const death = at.get("death");
  if (plan.death > 0 && death !== undefined) {
    const dies = death - SHOT_WAIT - plan.death;
    // The copy is removed and the pad reset (the camera with it) a hold after the death frame, a
    // long Death cut short: the window ends before then, however late the stop was noted.
    windows.push({ parts: ["death"], from: dies - NOTED_LATE - LEAD, to: Math.min(dies + 2 * plan.death + TAIL, death + hold - NOTED_LATE) });
  }
  const spans: ClipSpan[] = [];
  for (const window of windows
    .map((each) => ({ ...each, from: Math.max(segment.base, each.from), to: Math.min(segment.end, each.to) }))
    .filter((each) => each.to > each.from)
    .sort((a, b) => a.from - b.from)) {
    const last = spans[spans.length - 1];
    if (last && window.from <= last.to) spans[spans.length - 1] = { parts: [...last.parts, ...window.parts], from: last.from, to: Math.max(last.to, window.to) };
    else spans.push(window);
  }
  const attachEnd = spans[0]?.to ?? segment.searchEnd;
  const fastTrail = plan.fast && trail ? spans.find((span) => span.parts.includes("move")) : undefined;
  return {
    spans,
    searchEnd: fastTrail ? fastTrail.to : Math.max(attachEnd, segment.searchEnd),
    ...(fastTrail ? { trail: { parts: ["move"], from: Math.max(fastTrail.from, trail!.from), to: Math.min(fastTrail.to, trail!.to) } } : {}),
  };
}

/** The spans of `spans` up to `end`, in time order. */
export function spansUntil(spans: readonly ClipSpan[], end: number): ClipSpan[] {
  return spans.filter((span) => span.from < end).map((span) => (span.to > end ? { ...span, to: end } : span));
}

/** A span's place once the spans are joined: seconds into the joined clip where it starts and ends. */
export function joinedPlace(spans: readonly ClipSpan[], from: number, to: number): [number, number] {
  let offset = 0;
  let start = Infinity;
  let end = -Infinity;
  for (const span of spans) {
    const a = Math.max(span.from, from);
    const b = Math.min(span.to, to);
    if (b > a) {
      start = Math.min(start, offset + a - span.from);
      end = Math.max(end, offset + b - span.from);
    }
    offset += span.to - span.from;
  }
  return [start, end];
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

/**
 * How much bright that the first frame hasn't each frame shows: the percentage of its grey pixels
 * brighter than all but the first frame's brightest 0.1%, by more than `threshold`, less the first
 * frame's own. Unlike changeScores it hardly moves when the camera does, since the ground is the
 * same dark whichever patch of it is in view, so it finds a trail while the camera follows the host.
 */
export function brightScores(frames: Uint8Array, frameBytes: number, threshold = PIXEL_CHANGE): number[] {
  const count = Math.floor(frames.length / frameBytes);
  if (count === 0) return [];
  const sorted = Uint8Array.from(frames.subarray(0, frameBytes)).sort();
  const level = sorted[Math.min(frameBytes - 1, Math.floor(frameBytes * 0.999))]! + threshold;
  const bright = (n: number): number => {
    let over = 0;
    for (let i = 0; i < frameBytes; i++) if (frames[n * frameBytes + i]! > level) over++;
    return over;
  };
  const first = bright(0);
  const scores: number[] = [];
  for (let n = 0; n < count; n++) scores.push((100 * (bright(n) - first)) / frameBytes);
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
/** How many of a missile's peak frames are kept for its move, and the share of new bright pixels (percent) under which a moving frame shows no trail. */
const TRAIL_PEAKS = 2;
const TRAIL_FLOOR = 0.05;

/** What one effect's clip and frames came to. */
export type EffectVideoResult = {
  readonly effect: number;
  readonly clip: string;
  /** The spans of the recording the clip keeps, joined in this order. */
  readonly spans: readonly ClipSpan[];
  /** The picked frames' files, and each one's seconds into the clip. */
  readonly peaks: readonly { readonly file: string; readonly seconds: number }[];
};

/** How cutEffect runs ffmpeg: `nice` runs it at a lower priority, for a machine busy with something else. */
export type CutOptions = { readonly nice?: boolean };

/** The filter that trims `spans` out of a stream seeked to `start` and joins them, ending in [joined]. */
function joinFilter(spans: readonly ClipSpan[], start: number): string {
  const trims = spans.map((span, n) => `[0:v]trim=start=${(span.from - start).toFixed(3)}:end=${(span.to - start).toFixed(3)},setpts=PTS-STARTPTS[s${n}]`);
  return `${trims.join(";")};${spans.map((_, n) => `[s${n}]`).join("")}concat=n=${spans.length}:v=1:a=0[joined]`;
}

const limits = (seconds: number, maxOutputBytes: number) => ({ timeoutMs: (60 + seconds * 4) * 1000, maxOutputBytes });

/**
 * A clip's HEVC quality (hevc_videotoolbox's -q:v, 0-100): as high as the recording's, so the
 * second encode loses next to nothing more. The clips are masters, which a gallery encodes for the
 * web itself.
 */
export const CLIP_QUALITY = 90;

/** The largest clip written, in bytes: a clip of an effect is seconds long, a few MB at CLIP_QUALITY. */
const CLIP_MAX_BYTES = 200 * 1024 * 1024;

/**
 * Cuts `segment` of `video` into `<outDir>/clips/<name>.mp4`, keeping `cut`'s spans joined in
 * order (the whole segment by default), and writes its peak frames as `<outDir>/peaks/<name>-<n>.jpg`.
 * `name` is usually the effect's number. The clip is HEVC at the recording's size and CLIP_QUALITY.
 * It is encoded again, not copied: a copy can only start at a keyframe, the recorder's come about a
 * second apart, and the bare pad before an attach can be as short as 0.3 s, so a copied clip would
 * start on the previous effect. The peaks are searched in the clip's spans up to `cut.searchEnd`,
 * so each one's seconds are into the clip; a cut with a `trail` keeps TRAIL_PEAKS of them for the
 * frames of the move with the most new bright on screen, where the camera moves too.
 */
export async function cutEffect(video: string, segment: EffectSegment, outDir: string, name: string, cut: EffectCut = wholeCut(segment), options: CutOptions = {}): Promise<EffectVideoResult> {
  const spans = cut.spans.length ? cut.spans : wholeCut(segment).spans;
  const start = spans[0]!.from;
  const reach = spans[spans.length - 1]!.to - start;
  const searched = spansUntil(spans, cut.searchEnd);
  const search = searched.length ? searched : [{ ...spans[0]!, to: Math.min(spans[0]!.to, start + 0.1) }];
  const searchReach = search[search.length - 1]!.to - start;
  const searchSeconds = Math.max(0.1, search.reduce((sum, span) => sum + span.to - span.from, 0));
  const run = (args: string[], limit: ReturnType<typeof limits>) => (options.nice ? runBounded("nice", ["-n", "10", "ffmpeg", ...args], limit) : runBounded("ffmpeg", args, limit));
  const clips = path.join(outDir, "clips");
  const peaksDir = path.join(outDir, "peaks");
  await mkdir(clips, { recursive: true });
  await mkdir(peaksDir, { recursive: true });
  const clip = path.join(clips, `${name}.mp4`);
  const at = ["-ss", start.toFixed(3), "-t", reach.toFixed(3)];
  await run(["-v", "error", "-y", ...at, "-i", video, "-an", "-filter_complex", joinFilter(spans, start), "-map", "[joined]", "-c:v", "hevc_videotoolbox", "-q:v", String(CLIP_QUALITY), "-tag:v", "hvc1", "-fs", String(CLIP_MAX_BYTES), clip], limits(reach, CLIP_MAX_BYTES));

  const scratch = await mkdtemp(path.join(os.tmpdir(), "effect-video-"));
  try {
    const raw = path.join(scratch, "frames.gray");
    const frameBytes = PROBE_WIDTH * PROBE_HEIGHT;
    const frameCount = Math.ceil(searchSeconds * PROBE_FPS + 2);
    // One decode for both: the small grey frames that are scored and the full frames to keep, from
    // the same resampled stream, so a picked frame is the one scored. Seeking for each picked frame
    // instead can land a frame off in a recording whose frames come unevenly, and a burst lasts three.
    await run(
      [
        "-v", "error", "-y", "-ss", start.toFixed(3), "-t", searchReach.toFixed(3), "-i", video, "-an",
        "-filter_complex", `${joinFilter(search, start)};[joined]fps=${PROBE_FPS},split=2[probe][full];[probe]scale=${PROBE_WIDTH}:${PROBE_HEIGHT},format=gray[grey]`,
        "-map", "[grey]", "-f", "rawvideo", raw,
        "-map", "[full]", "-q:v", "3", path.join(scratch, "%05d.jpg"),
      ],
      limits(searchReach, frameCount * (frameBytes + 2 * 1024 * 1024)),
    );
    const frames = new Uint8Array(await readFile(raw));
    const scores = changeScores(frames, frameBytes);
    const gap = Math.round(PEAK_GAP * PROBE_FPS);
    let picked: number[];
    if (cut.trail) {
      const [from, to] = joinedPlace(search, cut.trail.from, cut.trail.to);
      const moving = (frame: number) => frame / PROBE_FPS >= from && frame / PROBE_FPS < to;
      const bright = brightScores(frames, frameBytes);
      const trailFrames = pickPeaks(bright.map((score, frame) => (moving(frame) ? score : -1)), TRAIL_PEAKS, gap, TRAIL_FLOOR);
      const others = pickPeaks(scores.map((score, frame) => (moving(frame) ? -1 : score)), PEAKS - trailFrames.length, gap, CHANGE_FLOOR);
      picked = [...trailFrames, ...others].sort((a, b) => a - b);
    } else {
      picked = pickPeaks(scores, PEAKS, gap, CHANGE_FLOOR);
    }
    const peaks: { file: string; seconds: number }[] = [];
    for (const [n, frame] of picked.entries()) {
      const file = path.join(peaksDir, `${name}-${n + 1}.jpg`);
      await rename(path.join(scratch, `${String(frame + 1).padStart(5, "0")}.jpg`), file).catch(() => copyFile(path.join(scratch, `${String(frame + 1).padStart(5, "0")}.jpg`), file));
      peaks.push({ file, seconds: frame / PROBE_FPS });
    }
    return { effect: segment.effect, clip, spans, peaks };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
