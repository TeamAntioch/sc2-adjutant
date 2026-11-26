// What capture-shots prints for a capture, and its exit code: a Shot captured late, after the
// camera moved on (#123), is listed apart from a missing one, and fails the run as one does.
import { describe, expect, it } from "vitest";

import type { CaptureShotsResult, CapturedShot } from "../../src/capture/shots.js";
import { shotsReport } from "../../src/cli/capture-shots-report.js";

const camera = { target: [50, 37] as const, distance: 31.6, pitch: 75, yawOffset: 0, fov: 45 };
const shot = (n: number, frame: string | null, extra: Partial<CapturedShot> = {}): CapturedShot => ({ shot: n, frame, rect: [40, 30, 60, 44], pitch: 75, yaw: 0, camera, whole: true, ...extra });

function result(shots: readonly CapturedShot[], extra: Partial<CaptureShotsResult> = {}): CaptureShotsResult {
  return { summary: "Captured", end: "done", shots, frames: [], missing: [], late: [], partial: [], outputDir: "/out", copy: "/copy", run: { games: [] }, ...extra };
}

describe("capture-shots' report", () => {
  it("lists each Shot's frame and the summary, and exits 0 when every Shot has one", () => {
    expect(shotsReport(result([shot(1, "01-gate.jpg", { label: "gate" })]))).toEqual({
      lines: ["01-gate.jpg: [40, 30, 60, 44], 32 away, pitch 75", "Captured"],
      exitCode: 0,
    });
  });

  it("says a late Shot was captured after the camera moved on, apart from a missing one, and exits 1", () => {
    const report = shotsReport(result([shot(1, null, { late: true, label: "tunnel" }), shot(2, null)], { missing: ["2"], late: ["1 (tunnel)"] }));
    expect(report.lines.slice(0, 2)).toEqual(["(late: 1 was captured after the camera moved on; retake it): [40, 30, 60, 44], 32 away, pitch 75", "(no frame for 2): [40, 30, 60, 44], 32 away, pitch 75"]);
    expect(report.exitCode).toBe(1);
    expect(shotsReport(result([shot(1, null, { late: true })], { late: ["1"] })).exitCode).toBe(1);
  });

  it("exits 1 when the tour ended early", () => {
    expect(shotsReport(result([], { end: "game exited" })).exitCode).toBe(1);
  });
});
