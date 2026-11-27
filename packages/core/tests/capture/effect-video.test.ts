// The effect tour's video (capture/effect-video.ts): reading the recording's timeline, placing each
// effect in it, picking the frames that changed most, and cutting each effect's clip.
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { EffectShot } from "../../src/capture/effect-tour.js";
import { BASE_AFTER_MARK, brightScores, changeScores, cutEffect, effectCut, effectSegments, joinedPlace, parseVideoStops, pickPeaks, spansUntil } from "../../src/capture/effect-video.js";

const shot = (stop: number, effect: number, label: EffectShot["label"]): EffectShot => ({ stop, effect, file: `Assets/Effects/E${effect}.m3`, label });

describe("parseVideoStops", () => {
  it("reads stops and marks, keeping each one's first time and skipping lines it can't read", () => {
    const timeline = parseVideoStops("m1 2.000\n1 2.700\n2 4.100\n2 4.300\nm2 9.5\nnonsense\n\n");
    expect([...timeline.stops]).toEqual([
      [1, 2.7],
      [2, 4.1],
    ]);
    expect([...timeline.marks]).toEqual([
      [1, 2],
      [2, 9.5],
    ]);
  });
});

describe("effectSegments", () => {
  const shots = [shot(1, 0, "birth"), shot(2, 0, "stand"), shot(3, 0, "moving"), shot(4, 0, "after-destroy"), shot(5, 1, "stand"), shot(6, 1, "after-destroy")];

  it("bases each effect just after its mark, searches up to its stand frame, and clips to the next effect", () => {
    const timeline = parseVideoStops("m1 2\n1 3\n2 5\n3 8\n4 10\nm2 13\n5 14\n6 16\n");
    const [first, second] = effectSegments(shots, timeline, 1.5);
    expect(first).toEqual({ effect: 0, base: 2 + BASE_AFTER_MARK, searchEnd: 5, end: 13 + BASE_AFTER_MARK });
    // The last effect's clip runs past its last stop by the frame's hold.
    expect(second).toEqual({ effect: 1, base: 13 + BASE_AFTER_MARK, searchEnd: 14, end: 16 + 1.5 });
  });

  it("leaves out an effect none of whose stops were timed", () => {
    expect(effectSegments(shots, parseVideoStops("m1 2\nm2 13\n5 14\n"), 1.5).map((each) => each.effect)).toEqual([1]);
  });

  it("without marks, bases an effect in the reset after the previous one's last frame, and the first by its lead-in", () => {
    // Stops only: a recording made without marks.
    const timeline = parseVideoStops("1 10\n2 12\n3 15\n4 17\n5 22\n6 25\n");
    const [first, second] = effectSegments(shots, timeline, 1.5, () => 0.6);
    expect(first!.base).toBeCloseTo(10 - 0.6 - 0.25);
    expect(first!.searchEnd).toBe(12);
    // After stop 4's frame is held 1.5 s, half way through the 0.5 s reset.
    expect(second!.base).toBeCloseTo(17 + 1.5 + 0.25);
    expect(first!.end).toBeCloseTo(second!.base);
  });
});

describe("effectCut", () => {
  // A missile filmed as the tour films one (batch-04's PhoenixMissile): Birth 0.067 s, a looping
  // Stand, a 2 s fast move and a 0.667 s Death; the stops as the host noted them.
  const missile = { birth: 0.03, standShot: 0.5, standLoops: true, move: 2, death: 0.33, fast: true };
  const shots = [shot(70, 19, "birth"), shot(71, 19, "stand"), shot(72, 19, "moving"), shot(73, 19, "after-destroy"), shot(74, 19, "death")];
  const timeline = parseVideoStops("m20 238.132\n70 239.585\n71 241.766\n72 245.224\n73 247.482\n74 251.344\nm21 252.861\n");
  const [segment] = effectSegments(shots, timeline, 1.5);

  it("keeps the attach, the move, the Destroy and the Death, and drops the holds between", () => {
    const cut = effectCut(segment!, shots, missile, timeline, 1.5);
    expect(cut.spans.map((span) => span.parts)).toEqual([["attach"], ["move"], ["destroy"], ["death"]]);
    const [attach, move, destroy, death] = cut.spans;
    // From the bare pad to 0.8 s into Stand, the effect attached 0.8 s after the base.
    expect(attach!.from).toBeCloseTo(238.332);
    expect(attach!.to).toBeCloseTo(238.332 + 0.8 + 0.06 + 0.8);
    // The move ended a frame's wait before its stop; it began a hold after the stand frame or 2 s before it ended, whichever is earlier.
    expect(move!.to).toBeCloseTo(245.224 - 0.25 + 0.3);
    expect(move!.from).toBeCloseTo(245.224 - 0.25 - 2 - 0.55);
    expect(destroy!.from).toBeCloseTo(247.482 - 0.75 - 0.55);
    expect(destroy!.to).toBeCloseTo(247.482 - 0.75 + 1.25);
    expect(death!.from).toBeCloseTo(251.344 - 0.25 - 0.33 - 0.55);
    const seconds = cut.spans.reduce((sum, span) => sum + span.to - span.from, 0);
    expect(seconds).toBeLessThan((segment!.end - segment!.base) / 1.8);
    // A missile's frames are searched through its move, where its trail is.
    expect(cut.searchEnd).toBeCloseTo(move!.to);
    expect(cut.trail).toEqual(move);
  });

  it("searches the rest only up to the stand frame, with no trail", () => {
    const cut = effectCut(segment!, shots, { ...missile, fast: false }, timeline, 1.5);
    expect(cut.searchEnd).toBe(241.766);
    expect(cut.trail).toBeUndefined();
  });

  it("reckons a stop the recording missed on from the frame before", () => {
    const missing = parseVideoStops("m20 238.132\n70 239.585\n71 241.766\n73 247.482\n74 251.344\nm21 252.861\n");
    const cut = effectCut(effectSegments(shots, missing, 1.5)[0]!, shots, missile, missing, 1.5);
    // The moving stop, reckoned: the stand frame, its hold, the move and a frame's wait.
    expect(cut.spans[1]!.to).toBeCloseTo(241.766 + 1.5 + 2 + 0.25 - 0.25 + 0.3);
  });

  it("keeps all of a Stand that plays once, joins windows that touch, and ends a long Death before the next reset", () => {
    const once = { birth: 0, standShot: 1.5, standLoops: false, move: 0, death: 4, fast: false };
    const own = [shot(1, 0, "stand"), shot(2, 0, "after-destroy"), shot(3, 0, "death")];
    const stops = parseVideoStops("m1 10\n1 12.6\n2 14.9\n3 25\nm2 27\n");
    const cut = effectCut(effectSegments(own, stops, 1.5)[0]!, own, once, stops, 1.5);
    // The 3 s Stand runs into the Destroy's window: one span.
    expect(cut.spans.map((span) => span.parts)).toEqual([["attach", "destroy"], ["death"]]);
    expect(cut.spans[0]!.to).toBeCloseTo(14.9 - 0.75 + 1.25);
    // An 8 s Death is cut at its frame's hold, less the most the stop was noted late.
    expect(cut.spans[1]!.to).toBeCloseTo(25 + 1.5 - 0.45);
  });
});

describe("spansUntil and joinedPlace", () => {
  const spans = [
    { parts: ["attach" as const], from: 10, to: 12 },
    { parts: ["move" as const], from: 15, to: 18 },
  ];
  it("cuts the spans at a time, and places a stretch of the recording in the joined clip", () => {
    expect(spansUntil(spans, 16)).toEqual([spans[0], { ...spans[1], to: 16 }]);
    expect(spansUntil(spans, 11)).toEqual([{ ...spans[0], to: 11 }]);
    expect(joinedPlace(spans, 15, 18)).toEqual([2, 5]);
    expect(joinedPlace(spans, 11, 16)).toEqual([1, 3]);
  });
});

describe("pickPeaks", () => {
  it("takes the highest frames, at least the gap apart, in time order, and none under the floor", () => {
    const scores = [0, 1, 9, 10, 8, 0, 0, 7, 0, 3];
    expect(pickPeaks(scores, 3, 3, 2)).toEqual([3, 7]);
    expect(pickPeaks(scores, 2, 1)).toEqual([2, 3]);
    expect(pickPeaks([0.5, 1, 0.2], 4, 1, 1.5)).toEqual([]);
  });
});

describe("changeScores", () => {
  it("scores each frame by the percentage of its pixels that changed past the threshold from the first", () => {
    const frames = new Uint8Array([10, 10, 10, 10, 20, 0, 10, 10, 60, 200, 10, 30]);
    expect(changeScores(frames, 2, 16)).toEqual([0, 0, 0, 0, 100, 50]);
  });
});

describe("brightScores", () => {
  it("scores the share of pixels brighter than the first frame's brightest, less the first frame's own", () => {
    // 1000 pixels a frame: the first frame's brightest is 50, so a pixel counts over 66.
    const frame = (bright: number) => Uint8Array.from({ length: 1000 }, (_, i) => (i < bright ? 200 : i === 999 ? 50 : 20));
    const frames = new Uint8Array([...frame(0), ...frame(0), ...frame(10)]);
    expect(brightScores(frames, 1000, 16)).toEqual([0, 0, 1]);
  });
});

// The clip is encoded with VideoToolbox, which only a Mac has.
const hasVideoToolbox = (() => {
  try {
    return process.platform === "darwin" && execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).includes("hevc_videotoolbox");
  } catch {
    return false;
  }
})();

describe("cutEffect", () => {
  it.skipIf(!hasVideoToolbox)("cuts the clip at the recording's size, as HEVC, from the base to the end", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cut-effect-"));
    try {
      const video = path.join(dir, "video.mp4");
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1600x900:rate=30", "-t", "4", "-c:v", "hevc_videotoolbox", "-tag:v", "hvc1", video]);
      const result = await cutEffect(video, { effect: 0, base: 1, searchEnd: 2, end: 3 }, dir, "0001");
      const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "default=nw=1", result.clip], { encoding: "utf8" });
      expect(probe).toMatch(/codec_name=hevc\nwidth=1600\nheight=900/);
      expect(Number(/duration=([0-9.]+)/.exec(probe)![1])).toBeCloseTo(2, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasVideoToolbox)("joins the cut's spans into one clip, and times each picked frame into it", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cut-effect-"));
    try {
      const video = path.join(dir, "video.mp4");
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1600x900:rate=30", "-t", "6", "-c:v", "hevc_videotoolbox", "-tag:v", "hvc1", video]);
      const spans = [
        { parts: ["attach" as const], from: 0.5, to: 1.5 },
        { parts: ["move" as const], from: 3, to: 4.5 },
      ];
      const result = await cutEffect(video, { effect: 0, base: 0.5, searchEnd: 1, end: 5.5 }, dir, "0001", { spans, searchEnd: 4.5, trail: spans[1] }, { nice: true });
      const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1", result.clip], { encoding: "utf8" });
      expect(Number(/duration=([0-9.]+)/.exec(probe)![1])).toBeCloseTo(2.5, 1);
      expect(result.spans).toEqual(spans);
      for (const peak of result.peaks) expect(peak.seconds).toBeLessThan(2.5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
