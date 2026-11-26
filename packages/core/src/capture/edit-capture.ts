// In-game capture of an edited area (spec #247, step 4 of a Brush Edit): when the author asks, or
// at the end of a batch of edits. Each area (src/kept-terrain/area.ts, as the brushes take it)
// gets a short camera tour (src/capture/area-tour.ts): one high view over it, then two or three at
// the player's angle. A batch runs as one tour, so the game starts once. The tour runs on a capture
// copy of the Mission's Map Package in the machine config's cache, through the Editor Broker and
// the Host Adapter's editor.captureTour, as capture-exemplars does; the package itself is only
// read. Frames go to the research archive under the Mission:
// <research dir>/missions/<id>/captures/<name>/, as <stop>-<view>.jpg, with views.json saying what
// each frame shows. A bulk job with no manual form,
// so a host without the capability gets a refusal.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { requireCapability, type Host } from "../host/host.js";
import { type Area, type AreaContext, type AreaMask, AreaSchema, type CellRect, resolveArea } from "../kept-terrain/area.js";
import { rampArea } from "../kept-terrain/cliff-brushes.js";
import { isSlotEdit, isSlotSwap } from "../kept-terrain/paint-brushes.js";
import { areaContext, editArea, type KeptTerrainEdit, KeptTerrainEditSchema } from "../map/edit-kept-terrain.js";
import { missionMapPackage } from "../map/mission-package.js";
import { coverageOf, FIRST_PACKAGE_STAGE } from "../session/evidence-coverage.js";
import { readMapInfo } from "../map/read-map-info.js";
import { readObjectsXml } from "../map/read-objects-xml.js";
import type { CaptureTourResult } from "../plugins/plugin-api.js";
import { parseMissionBlueprint, type Workspace } from "../plugins/workspace.js";
import { planAreaTour, type TourView } from "./area-tour.js";
import { checkCaptureName, defaultName, nameFrames, refuseUsedFolder, runStopTour, tourSummary } from "./stop-tour.js";

/** The most areas one capture tours: frames are numbered in two digits. */
const MAX_AREAS = 24;

export type CaptureKeptAreasOptions = {
  readonly host: Host;
  /** The research archive's root (sc2-research); frames go to missions/<id>/captures/<name>/ in it. */
  readonly researchDir: string;
  /** The capture's folder; by default `capture-` and the time. */
  readonly name?: string;
  /** A lighting to set: the copy's triggers are the tour's, so the map's own lighting triggers don't run. */
  readonly lighting?: string;
  readonly log?: (line: string) => void;
};

export type CapturedView = TourView & {
  /** The stop, from 1. */
  readonly stop: number;
  /** Which area it shows, from 1. */
  readonly area: number;
  /** Its frame's file name. */
  readonly frame: string;
  /** Its frame was captured after the tour's camera moved on, so it was dropped: capture again. */
  readonly late?: true;
};

export type CaptureKeptAreasResult = {
  readonly summary: string;
  readonly end: CaptureTourResult["end"];
  readonly views: readonly CapturedView[];
  /** Absolute paths of the frames captured, in tour order. */
  readonly frames: readonly string[];
  /** The views with no frame, by label: the game stopped first. */
  readonly missing: readonly string[];
  /** The views whose frame was captured after the camera moved on and dropped, by label. */
  readonly late: readonly string[];
  /** The views that show only part of their ground, by label (see `TourView.whole`). */
  readonly partial: readonly string[];
  readonly outputDir: string;
  /** The capture copy the tour ran on. */
  readonly copy: string;
};

/** What one area of a capture is: a bare area, or an edit as `edit-terrain` takes it, whose brush shapes it. */
export type CaptureTarget = Area | KeptTerrainEdit;

/** The targets in one edit file, as `capture-edit` takes them: an edit ({ area, brush }), a bare area, or a list of either. */
export function areasOf(file: string, content: unknown): CaptureTarget[] {
  const items = Array.isArray(content) ? content : [content];
  return items.map((item: unknown, i) => {
    const where = Array.isArray(content) ? `${file} [${i}]` : file;
    const problem = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) =>
      new Error(`${where}: ${issues.map((issue) => `${issue.path.map(String).join(".") || "area"}: ${issue.message}`).join("; ")}`);
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error(`${where} isn't an edit or an area`);
    if ("brush" in item) {
      const edit = KeptTerrainEditSchema.safeParse(item);
      if (!edit.success) throw problem(edit.error.issues);
      if (isSlotEdit(edit.data.brush)) throw new Error(`${where} is ${isSlotSwap(edit.data.brush) ? "a slot swap" : "emptying a slot"}, which changes the whole map: give the area to look at instead, as { "area": ... }`);
      return item as KeptTerrainEdit;
    }
    const area = AreaSchema.safeParse("area" in item ? item.area : item);
    if (!area.success) throw problem(area.error.issues);
    return ("area" in item ? item.area : item) as Area;
  });
}

/**
 * The area a target shows, resolved as its brush resolves it (editArea): a ramp's footprint, and
 * cliffs and pathing sharp. The capture comes after the edit, so a removed ramp is gone: the square
 * remove-ramp searched round its point stands for it.
 */
function resolveTarget(target: CaptureTarget, context: AreaContext): AreaMask {
  if (!("brush" in target)) return resolveArea(target, context);
  return resolveArea(editArea(KeptTerrainEditSchema.parse(target), (ramp) => rampArea(ramp, undefined)), context);
}

/** Captures each area in game, as above. */
export async function captureKeptAreas(workspace: Workspace, blueprintPath: string, areas: readonly CaptureTarget[], options: CaptureKeptAreasOptions): Promise<CaptureKeptAreasResult> {
  requireCapability(options.host, "editor.captureTour", "Capturing an edited area in game");
  if (areas.length === 0) throw new Error("A capture needs at least one area");
  if (areas.length > MAX_AREAS) throw new Error(`A capture tours at most ${MAX_AREAS} areas; this one has ${areas.length}`);
  const name = options.name ?? defaultName();
  checkCaptureName(name);

  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const mapPackage = await missionMapPackage(blueprintPath);
  if (!existsSync(path.join(mapPackage, "MapInfo"))) throw new Error(`${mapPackage} has no MapInfo: compile the Mission, or import a map for it, first`);
  const info = readMapInfo(await readFile(path.join(mapPackage, "MapInfo")));
  const objectsFile = path.join(mapPackage, "Objects");
  const points = existsSync(objectsFile) ? readObjectsXml(await readFile(objectsFile, "utf8")).points : [];
  const context = await areaContext(mapPackage, info, blueprint, points);
  const masks: AreaMask[] = [];
  for (const target of areas) masks.push(resolveTarget(target, context));

  const prefix = (n: number) => (masks.length > 1 ? `a${n}-` : "");
  const planned: CapturedView[] = masks.flatMap((mask, i) => planAreaTour(insideBounds(mask), info.playableBounds, mask.reach).map((view) => ({ ...view, area: i + 1 })))
    .map((view, i) => ({ ...view, stop: i + 1, frame: `${String(i + 1).padStart(2, "0")}-${prefix(view.area)}${view.label}.jpg` }));

  const missionId = path.basename(path.dirname(blueprintPath));
  const outputDir = path.join(options.researchDir, "missions", missionId, "captures", name);
  await refuseUsedFolder(outputDir, "views.json", "a capture");
  const log = options.log ?? (() => undefined);

  // Through the Editor Broker, which names the copy for the job and removes it once the tour is
  // done; one that stopped early stays, to open and debug.
  const result = await runStopTour(options.host, {
    source: mapPackage,
    label: name,
    copy: {
      stops: planned.map((view) => view.target),
      cameras: planned.map(({ distance, pitch, yawOffset }) => ({ distance, pitch, yawOffset })),
      ...(options.lighting ? { lighting: options.lighting } : {}),
    },
    outputDir,
    log,
  });
  const { copy } = result;

  const named = await nameFrames(outputDir, planned);
  const frames = named.filter((frame) => frame !== null);
  const lateStops = new Set(result.late);
  const views = planned.map((view, i) => (named[i] === null && lateStops.has(view.stop) ? { ...view, late: true as const } : view));
  const missing = views.filter((view, i) => named[i] === null && !view.late).map((view) => `${prefix(view.area)}${view.label}`);
  const late = views.filter((view) => view.late).map((view) => `${prefix(view.area)}${view.label}`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "views.json"),
    `${JSON.stringify({ mission: missionId, mapPackage, copy, end: result.end, covers: await coverageOf(blueprintPath, FIRST_PACKAGE_STAGE), areas: masks.map((mask, i) => ({ area: i + 1, label: mask.label, reach: mask.reach })), views }, null, 2)}\n`,
  );

  const partial = views.filter((view) => !view.whole).map((view) => `${prefix(view.area)}${view.label}`);
  const what = masks.length > 1 ? `${masks.length} areas` : masks[0]!.label;
  const summary = tourSummary(`Captured ${frames.length} view${frames.length === 1 ? "" : "s"} of ${what} in ${outputDir}`, result.end, missing, partial, { its: "ground", why: "too big for the views, or at the map's edge" }, { names: late, noun: "view" });
  log(summary);
  return { summary, end: result.end, views, frames, missing, late, partial, outputDir, copy };
}

/** The bounding rectangle of the cells inside the area. */
function insideBounds(mask: AreaMask): CellRect {
  let [left, bottom, right, top] = [mask.width, mask.height, -1, -1];
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!mask.inside[y * mask.width + x]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      bottom = Math.min(bottom, y);
      top = Math.max(top, y);
    }
  }
  return { x: left, y: bottom, width: right - left + 1, height: top - bottom + 1 };
}
