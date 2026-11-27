// What capture-shots prints for a finished capture, and the exit code it sets: a line per Shot,
// saying which have no frame and which were captured late, after the camera moved on (#123), then
// the summary. Apart from the CLI, so it's tested without a game.

import type { CaptureShotsResult } from "../capture/shots.js";

/** The lines to print and the exit code: 1 when the tour ended early, or any Shot has no frame or was captured late. */
export function shotsReport(result: CaptureShotsResult): { readonly lines: readonly string[]; readonly exitCode: 0 | 1 } {
  const lines = result.shots.map((shot) => {
    const frame = shot.frame ?? (shot.late ? `(late: ${shot.shot} was captured after the camera moved on; retake it)` : `(no frame for ${shot.shot})`);
    return `${frame}: [${shot.rect.join(", ")}], ${shot.camera.distance.toFixed(0)} away, pitch ${shot.pitch}${shot.yaw ? `, turned ${shot.yaw}°` : ""}${shot.whole ? "" : ", partial"}`;
  });
  const failed = result.end !== "done" || result.missing.length > 0 || result.late.length > 0;
  return { lines: [...lines, result.summary], exitCode: failed ? 1 : 0 };
}
