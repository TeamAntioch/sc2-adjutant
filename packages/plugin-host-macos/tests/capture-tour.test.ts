// The capture watch loop's clock for time without a stop. A tour longer than startSeconds used to
// end as "never started" at the first poll that read no stop (say, the bank caught mid-save),
// since the clock counted from the start of the tour (2026-11-23, an effect-tour batch at 7.5 min).
// And a stop's screenshot timed against the stop's hold, on the same kind of clock.
import { describe, expect, it } from "vitest";

import { shootStop, type StopShooter, type StopWatch, watchStop } from "../capture-tour.ts";

const limits = { pressSpaceAfterSeconds: 60, startSeconds: 450 };
const s = (seconds: number) => seconds * 1000;

/** Polls every half second until `seconds`, reading the stop `read` gives; when the tour ended as never started, if it did. */
function run(seconds: number, read: (at: number) => string | undefined): { neverStartedAt?: number; presses: number } {
  let watch: StopWatch = { since: 0, lastPress: 0 };
  let presses = 0;
  for (let at = 0.5; at <= seconds; at += 0.5) {
    const step = watchStop(watch, read(at), s(at), limits);
    watch = step.watch;
    if (step.pressSpace) presses++;
    if (step.neverStarted) return { neverStartedAt: at, presses };
  }
  return { presses };
}

describe("watchStop", () => {
  it("keeps a tour that sends stops past startSeconds going through a poll that reads no stop", () => {
    // A new stop every 3 s for 15 minutes; the bank reads empty once, at 7.5 min.
    const result = run(900, (at) => (at === 450 ? undefined : String(Math.floor(at / 3) + 1)));
    expect(result).toEqual({ presses: 0 });
  });

  it("counts the time without a stop from the last stop seen, so a long gap late in the tour still ends it", () => {
    const result = run(2000, (at) => (at <= 600 ? String(Math.floor(at / 3) + 1) : undefined));
    expect(result.neverStartedAt).toBe(600 + 450.5);
  });

  it("still ends a tour that never sends a stop as never started, once past startSeconds", () => {
    const result = run(1000, () => undefined);
    expect(result.neverStartedAt).toBe(450.5);
  });

  it("presses Space after pressSpaceAfterSeconds without a stop, then at most every 10 s", () => {
    expect(watchStop({ since: 0, lastPress: 0 }, undefined, s(59.5), limits).pressSpace).toBe(false);
    const first = watchStop({ since: 0, lastPress: 0 }, undefined, s(60), limits);
    expect(first).toMatchObject({ pressSpace: true, watch: { lastPress: s(60) } });
    expect(watchStop(first.watch, undefined, s(65), limits).pressSpace).toBe(false);
    expect(watchStop(first.watch, undefined, s(70), limits).pressSpace).toBe(true);
  });

  it("restarts the clock at a stop it has already captured", () => {
    expect(watchStop({ since: 0, lastPress: 0 }, "7", s(500), limits).watch.since).toBe(s(500));
  });
});

/** A screenshot that takes `seconds` of a fake clock starting at `start` (seconds), and the files it removed. */
function slowScreen(start: number, seconds: number, fails = false) {
  let now = s(start);
  const removed: string[] = [];
  const shooter: StopShooter = {
    screenshot: async () => {
      now += s(seconds);
      if (fails) throw new Error("could not create image from window");
    },
    now: () => now,
    remove: async (file) => {
      removed.push(file);
    },
  };
  return { shooter, removed };
}

// On a loaded machine the screenshot can finish after the tour has moved on: the frame then shows
// the next Shot's place under this one's name (spec #122: 6 of 9 frames of one capture).
describe("shootStop", () => {
  it("keeps a screenshot that finishes inside the stop's hold, timed from the bank's save", async () => {
    // Saved at 10 s, held 2.5 s: read at 10.5 s, done at 12 s.
    const screen = slowScreen(10.5, 1.5);
    expect(await shootStop("01.jpg.capture.png", s(10), 2.5, screen.shooter)).toEqual({ taken: "kept" });
    expect(screen.removed).toEqual([]);
  });

  it("removes a screenshot that finishes after the hold, and says how late it was", async () => {
    // Saved at 10 s, held 2.5 s: read at 11 s, done at 13 s, half a second after the camera moved on.
    const screen = slowScreen(11, 2);
    expect(await shootStop("01.jpg.capture.png", s(10), 2.5, screen.shooter)).toEqual({ taken: "late", by: 0.5 });
    expect(screen.removed).toEqual(["01.jpg.capture.png"]);
  });

  it("says a failed screenshot failed, for the next poll to try again", async () => {
    const screen = slowScreen(10.5, 0.5, true);
    expect(await shootStop("01.jpg.capture.png", s(10), 2.5, screen.shooter)).toEqual({ taken: "failed" });
  });

  it("keeps every screenshot when the request gives no hold", async () => {
    const screen = slowScreen(11, 30);
    expect(await shootStop("01.jpg.capture.png", s(10), undefined, screen.shooter)).toEqual({ taken: "kept" });
  });
});
