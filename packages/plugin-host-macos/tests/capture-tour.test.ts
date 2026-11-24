// The capture watch loop's clock for time without a stop. A tour longer than startSeconds used to
// end as "never started" at the first poll that read no stop (say, the bank caught mid-save),
// since the clock counted from the start of the tour (2026-11-23, an effect-tour batch at 7.5 min).
import { describe, expect, it } from "vitest";

import { type StopWatch, watchStop } from "../capture-tour.ts";

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
