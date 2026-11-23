// What a capture of planned stops shares, edited areas (edit-capture.ts) and Shots (shots.ts)
// alike: its folder's name, the refusal to reuse a folder, the one editor.captureTour run, through
// the Editor Broker, on a capture copy whose stops each get a planned frame name, and the
// summary's tail.

import { existsSync } from "node:fs";
import { readdir, rename } from "node:fs/promises";
import path from "node:path";

import type { Host } from "../host/host.js";
import type { CaptureTourResult } from "../plugins/plugin-api.js";
import type { CaptureCopyOptions } from "./capture-copy.js";
import { runBrokeredCapture } from "./editor-broker-client.js";

/** A prefix (`capture-` by default) and the time in UTC, as the renders' folders are named. */
export function defaultName(now = new Date(), prefix = "capture-"): string {
  return `${prefix}${now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-")}`;
}

/** Refuses a capture name that isn't a plain folder name. */
export function checkCaptureName(name: string): void {
  if (!/^[\w.-]+$/.test(name) || name.startsWith(".")) throw new Error(`A capture name is letters, digits, dots, dashes and underscores, not ${JSON.stringify(name)}`);
}

/**
 * Refuses a folder that holds an earlier capture: frames, its record (`record`), or stops.txt,
 * which is appended to, so a folder from a run that captured nothing isn't reused either.
 */
export async function refuseUsedFolder(outputDir: string, record: string, holds: string): Promise<void> {
  if (existsSync(outputDir) && (await readdir(outputDir)).some((file) => file.endsWith(".jpg") || file === "stops.txt" || file === record)) {
    throw new Error(`${outputDir} already holds ${holds}: name this capture something else, or move it first`);
  }
}

/**
 * Runs a camera tour of the copy's stops on a capture copy of `source`, through the Editor Broker:
 * the broker names the copy for `label` and the job, writes it, and removes it once the tour is
 * done. The result's `copy` is that copy.
 */
export async function runStopTour(
  host: Host,
  request: { readonly source: string; readonly label: string; readonly copy: Omit<CaptureCopyOptions, "name">; readonly outputDir: string; readonly log: (line: string) => void; readonly onQueued?: (id: string) => void; readonly signal?: AbortSignal },
): Promise<CaptureTourResult & { readonly copy: string }> {
  const result = await runBrokeredCapture(
    host,
    {
      kind: "tour",
      source: request.source,
      label: request.label,
      copy: request.copy,
      settings: { frameDigits: 2, recordKeys: ["x", "y"], width: 1600, quality: 85, startSeconds: 300, pressSpaceAfterSeconds: 30 },
      outputDir: request.outputDir,
    },
    { log: request.log, ...(request.onQueued ? { onQueued: request.onQueued } : {}), ...(request.signal ? { signal: request.signal } : {}) },
  );
  return { frames: result.frames, end: result.end, copy: result.copy! };
}

/** Gives each stop's frame (the host names them by stop) its planned name: the frames' paths, null for a stop with none. */
export async function nameFrames(outputDir: string, stops: readonly { readonly stop: number; readonly frame: string }[]): Promise<(string | null)[]> {
  const frames: (string | null)[] = [];
  for (const { stop, frame } of stops) {
    const raw = path.join(outputDir, `${String(stop).padStart(2, "0")}.jpg`);
    if (!existsSync(raw)) {
      frames.push(null);
      continue;
    }
    if (path.basename(raw) !== frame) await rename(raw, path.join(outputDir, frame));
    frames.push(path.join(outputDir, frame));
  }
  return frames;
}

/** A capture's summary: `head`, then how the tour ended early, the stops with no frame and those that show only part of what they frame. */
export function tourSummary(head: string, end: CaptureTourResult["end"], missing: readonly string[], partial: readonly string[], partialWhat: { readonly its: string; readonly why: string }): string {
  return [
    head,
    ...(end === "done" ? [] : [`: the tour ended early (${end})`]),
    ...(missing.length ? [`; no frame for ${missing.join(", ")}`] : []),
    ...(partial.length ? [`; ${partial.join(", ")} show${partial.length === 1 ? "s" : ""} only part of ${partial.length === 1 ? "its" : "their"} ${partialWhat.its} (${partialWhat.why})`] : []),
  ].join("");
}
