// Shots (spec #637): rectangles of a map, in cells, each framed whole in one in-game frame. Each
// Shot gets the nearest camera that frames its rectangle at its pitch and yaw (fitRect), and the
// Shots run as one camera tour, so the game starts once, on a capture copy of the map in the
// machine config's cache, through the Editor Broker and the Host Adapter's editor.captureTour, as
// capture-edit does. The copy's Camera Bounds are its Playable Area, and its own triggers are the
// tour's, so it shows the map as placed. Frames go to missions/<id>/output/shots/<name>/ for a
// Mission (git-ignored), else <cacheDir>/shots/<name>/, as <shot>[-<label>].jpg, with shots.json
// saying what each shows. A bulk job with no manual form, so a host without the capability gets a
// refusal.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { requireCapability, type Host } from "../host/host.js";
import { hostContext } from "../host/machine-config.js";
import { missionMapPackage } from "../map/mission-package.js";
import { coverageOf, FIRST_PACKAGE_STAGE } from "../session/evidence-coverage.js";
import { readMapInfo } from "../map/read-map-info.js";
import type { CaptureTourResult, GameProcess } from "../plugins/plugin-api.js";
import { CLOSE_DISTANCE, type FittedCamera, fitRect, HIGH_PITCH, PLAYER_CAMERA } from "./area-tour.js";
import { checkCaptureName, defaultName, nameFrames, refuseUsedFolder, runStopTour, tourSummary } from "./stop-tour.js";

/** The most Shots one capture takes: frames are numbered in two digits. */
const MAX_SHOTS = 99;

/**
 * A rectangle of the map that a frame must show: the least it shows, since the 16:9 frame shows
 * more on its long side. Pitch is degrees down from level, the high view's 75 by default; yaw is
 * degrees from the game camera's own (looking north), 0 by default.
 */
export const ShotSchema = z
  .object({
    rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).describe("[left, bottom, right, top], in cells"),
    // Below half the field of view the camera sees the horizon.
    pitch: z.number().gt(PLAYER_CAMERA.fov / 2).max(90).optional(),
    yaw: z.number().min(-360).max(360).optional(),
    label: z.string().min(1).optional(),
    close: z.boolean().optional().describe("Frame the rectangle as near as it needs, closer than the player's camera, which is otherwise the nearest a Shot comes: for judging a few cells of ground"),
  })
  .strict()
  .refine(({ rect: [left, bottom, right, top] }) => right > left && top > bottom, { message: "rect is [left, bottom, right, top], with right past left and top above bottom", path: ["rect"] });

export type Shot = z.input<typeof ShotSchema>;

/** Where a Shot's map comes from: a Mission's Map Package, by its Blueprint, or any Map Package. */
export type ShotsSource = { readonly blueprintPath: string } | { readonly mapPath: string };

export type CaptureShotsOptions = {
  readonly host: Host;
  /** The capture's folder; by default the time. */
  readonly name?: string;
  /** A lighting to set: the copy's triggers are the tour's, so the map's own lighting triggers don't run. */
  readonly lighting?: string;
  readonly log?: (line: string) => void;
  /** Called with the Editor Broker's id for the job once it is queued: its status lists the job by that id. */
  readonly onQueued?: (id: string) => void;
  /** Aborting cancels the capture: dropped from the queue, or stopped where it runs. */
  readonly signal?: AbortSignal;
};

/** A Shot as captured: what shots.json lists for each. */
export type CapturedShot = {
  /** The Shot, from 1. */
  readonly shot: number;
  /** Its frame's file name, or null when the game stopped first or it was captured late. */
  readonly frame: string | null;
  /** Its frame was captured after the tour's camera moved on, so it was dropped: retake it. */
  readonly late?: true;
  readonly rect: readonly [number, number, number, number];
  readonly pitch: number;
  readonly yaw: number;
  readonly label?: string;
  /** Framed as near as the rectangle needs (the Shot's `close`). */
  readonly close?: true;
  readonly camera: Omit<FittedCamera, "whole">;
  /** Whether the frame shows all of the rectangle: false when the distance cap or the Camera Bounds cut it short. */
  readonly whole: boolean;
};

export type CaptureShotsResult = {
  readonly summary: string;
  readonly end: CaptureTourResult["end"];
  readonly shots: readonly CapturedShot[];
  /** Absolute paths of the frames captured, in Shot order. */
  readonly frames: readonly string[];
  /** The Shots with no frame, by number and label, apart from the late ones. */
  readonly missing: readonly string[];
  /** The Shots whose frame was captured after the camera moved on and dropped, by number and label: retake them. */
  readonly late: readonly string[];
  /** The Shots whose frame shows only part of the rectangle, by number and label. */
  readonly partial: readonly string[];
  readonly outputDir: string;
  /** The capture copy the tour ran on. */
  readonly copy: string;
  /** The games the capture started, and when it began: what the run's GameLogs are found by (host/game-run-report.ts). */
  readonly run: { readonly games: readonly GameProcess[]; readonly startedAt?: string };
};

/** A label as a file name's tail: lower case, runs of anything else as one dash. */
const slug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Captures each Shot in game, as above. */
export async function captureShots(source: ShotsSource, shots: readonly Shot[], options: CaptureShotsOptions): Promise<CaptureShotsResult> {
  requireCapability(options.host, "editor.captureTour", "Capturing Shots in game");
  if (shots.length === 0) throw new Error("A capture needs at least one Shot");
  if (shots.length > MAX_SHOTS) throw new Error(`A capture takes at most ${MAX_SHOTS} Shots; this one has ${shots.length}`);
  const parsed = shots.map((shot, i) => {
    const result = ShotSchema.safeParse(shot);
    if (!result.success) throw new Error(`Shot ${i + 1}: ${result.error.issues.map((issue) => `${issue.path.map(String).join(".") || "shot"}: ${issue.message}`).join("; ")}`);
    return result.data;
  });
  const name = options.name ?? defaultName(new Date(), "");
  checkCaptureName(name);

  const mission = "blueprintPath" in source ? path.basename(path.dirname(source.blueprintPath)) : undefined;
  const mapPackage = "blueprintPath" in source ? await missionMapPackage(source.blueprintPath) : path.resolve(source.mapPath);
  if (!existsSync(path.join(mapPackage, "MapInfo"))) throw new Error(`${mapPackage} has no MapInfo: compile the Mission, or give a Map Package, first`);
  const { playableBounds } = readMapInfo(await readFile(path.join(mapPackage, "MapInfo")));
  const cacheDir = hostContext(options.host.machine).requirePath("cacheDir");
  const outputDir = "blueprintPath" in source ? path.join(path.dirname(source.blueprintPath), "output", "shots", name) : path.join(cacheDir, "shots", name);
  await refuseUsedFolder(outputDir, "shots.json", "Shots");

  // The copy's Camera Bounds are its Playable Area, so the cameras are fitted to that.
  const planned = parsed.map((shot, i) => {
    const [left, bottom, right, top] = shot.rect;
    const pitch = shot.pitch ?? HIGH_PITCH;
    const yaw = shot.yaw ?? 0;
    const nearest = shot.close ? CLOSE_DISTANCE : PLAYER_CAMERA.distance;
    const { whole, ...camera } = fitRect({ x: left, y: bottom, width: right - left, height: top - bottom }, { pitch, yawOffset: yaw }, playableBounds, nearest);
    const tail = shot.label ? slug(shot.label) : "";
    const frame = `${String(i + 1).padStart(2, "0")}${tail ? `-${tail}` : ""}.jpg`;
    return { shot: i + 1, frame, rect: shot.rect, pitch, yaw, ...(shot.label ? { label: shot.label } : {}), ...(shot.close ? { close: true as const } : {}), camera, whole };
  });
  const named = (shot: { shot: number; label?: string }) => (shot.label ? `${shot.shot} (${shot.label})` : String(shot.shot));

  const log = options.log ?? (() => undefined);

  // Through the Editor Broker, which names the copy for the job and removes it once the tour is
  // done; one that stopped early stays, to open and debug.
  const result = await runStopTour(options.host, {
    source: mapPackage,
    label: `shots-${name}`,
    copy: {
      stops: planned.map((shot) => shot.camera.target),
      cameras: planned.map(({ camera: { distance, pitch, yawOffset } }) => ({ distance, pitch, yawOffset })),
      playableCameraBounds: true,
      ...(options.lighting ? { lighting: options.lighting } : {}),
    },
    outputDir,
    log,
    ...(options.onQueued ? { onQueued: options.onQueued } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const { copy } = result;
  // What the frames vouch for (#748): a Mission's Blueprint and Map Package as they stand now, after the tour.
  const coveredBy = "blueprintPath" in source ? await coverageOf(source.blueprintPath, FIRST_PACKAGE_STAGE) : undefined;

  const paths = await nameFrames(outputDir, planned.map((shot) => ({ stop: shot.shot, frame: shot.frame })));
  const lateShots = new Set(result.late);
  const captured: CapturedShot[] = planned.map((shot, i) => (paths[i] !== null ? shot : lateShots.has(shot.shot) ? { ...shot, frame: null, late: true } : { ...shot, frame: null }));
  const frames = paths.filter((frame) => frame !== null);
  const missing = captured.filter((shot) => shot.frame === null && !shot.late).map(named);
  const late = captured.filter((shot) => shot.late).map(named);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "shots.json"), `${JSON.stringify({ ...(mission ? { mission } : {}), map: mapPackage, copy, end: result.end, ...(coveredBy ? { covers: coveredBy } : {}), shots: captured }, null, 2)}\n`);

  const partial = planned.filter((shot) => !shot.whole).map(named);
  const summary = tourSummary(`Captured ${frames.length} Shot${frames.length === 1 ? "" : "s"} in ${outputDir}`, result.end, missing, partial, { its: "rectangle", why: "too big for the camera, or at the map's edge" }, { names: late, noun: "Shot" });
  log(summary);
  return { summary, end: result.end, shots: captured, frames, missing, late, partial, outputDir, copy, run: { games: result.games, ...(result.startedAt ? { startedAt: result.startedAt } : {}) } };
}
