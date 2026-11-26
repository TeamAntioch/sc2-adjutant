// Shots from Zones (#124): one Shot per Zone, for a Still Review set. Each is a rect (30×17 cells
// by default) centred on the Zone's pole of inaccessibility, the point inside its polygon farthest
// from its outline: a concave Zone's centroid can fall outside it. The rect keeps its size inside
// the Playable Area where it fits there, moved in from the edge, and is cut to it where it doesn't.
// The set's Shots go to missions/<id>/output/stills/<set>/shots.json, which is never overwritten:
// every round of a set must frame the same places, so its frames compare.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { missionMapPackage } from "../map/mission-package.js";
import { readMapInfo } from "../map/read-map-info.js";
import { readRawBlueprint } from "../plugins/workspace.js";
import { containsPoint, distanceToPolygon, type Point } from "../terrain/polygon.js";
import type { Shot } from "./shots.js";
import { checkCaptureName } from "./stop-tour.js";

/** A Still Review Shot's size in cells, [width, height], by default: about a Zone, in a 16:9 frame. */
export const STILL_SHOT_SIZE = [30, 17] as const;

export type ShotsForZonesOptions = {
  /** The set's folder name under output/stills/. */
  readonly set: string;
  /** [width, height] in cells; STILL_SHOT_SIZE by default. */
  readonly size?: readonly [number, number];
  /** Degrees down from level, for every Shot; capture_shots's 75 by default. */
  readonly pitch?: number;
};

export type ShotsForZonesResult = {
  /** The set's shots.json. */
  readonly file: string;
  /** In the order the Zones were asked for, each labelled by its Zone's id. */
  readonly shots: readonly Shot[];
};

/** All a Zone needs here: the rest of the Blueprint isn't read, so a Blueprint mid-edit still gives its Shots. */
const ZonesSchema = z.object({ zones: z.array(z.object({ id: z.string(), polygon: z.array(z.object({ x: z.number(), y: z.number() })).min(3) }).passthrough()) }).passthrough();

/** A Mission's Still Review sets' folder: git-ignored, under its output/. */
export const missionStillsDir = (blueprintPath: string): string => path.join(path.dirname(blueprintPath), "output", "stills");

/** Writes the set's Shots, one per Zone in `zoneIds`, as above. */
export async function shotsForZones(blueprintPath: string, zoneIds: readonly string[], options: ShotsForZonesOptions): Promise<ShotsForZonesResult> {
  checkCaptureName(options.set);
  if (zoneIds.length === 0) throw new Error("A set needs at least one Zone");
  const [width, height] = options.size ?? STILL_SHOT_SIZE;
  if (!(width > 0 && height > 0)) throw new Error(`A Shot's size is [width, height] in cells, both above 0, not [${width}, ${height}]`);
  const file = path.join(missionStillsDir(blueprintPath), options.set, "shots.json");
  if (existsSync(file)) throw new Error(`The set ${options.set} already has its Shots (${file}): every round of a set uses the same Shots, so name a new set, or move that one first`);

  const parsed = ZonesSchema.safeParse(await readRawBlueprint(blueprintPath));
  if (!parsed.success) throw new Error(`${blueprintPath} has no readable zones: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  const { zones } = parsed.data;
  const mapPackage = await missionMapPackage(blueprintPath);
  const mapInfo = path.join(mapPackage, "MapInfo");
  if (!existsSync(mapInfo)) throw new Error(`${mapPackage} has no MapInfo: compile the Mission first`);
  const { playableBounds } = readMapInfo(await readFile(mapInfo));

  const shots = zoneIds.map((id): Shot => {
    const zone = zones.find((candidate) => candidate.id === id);
    if (!zone) throw new Error(`No Zone ${id} in ${blueprintPath} (its Zones: ${zones.map((candidate) => candidate.id).join(", ")})`);
    const rect = rectAround(zonePoint(zone.polygon), [width, height], playableBounds);
    return { rect, ...(options.pitch !== undefined ? { pitch: options.pitch } : {}), label: id };
  });

  // A retake is matched to its Shot by place, so no two Shots of a set may share one.
  const places = new Map<string, string>();
  for (const shot of shots) {
    const key = JSON.stringify([shot.rect, shot.pitch]);
    const twin = places.get(key);
    if (twin !== undefined) throw new Error(`Zones ${twin} and ${shot.label} give the same Shot [${shot.rect.join(", ")}]: leave one out, or give a smaller size`);
    places.set(key, shot.label!);
  }

  await mkdir(path.dirname(file), { recursive: true });
  const mission = path.basename(path.dirname(blueprintPath));
  await writeFile(file, `${JSON.stringify({ mission, set: options.set, shots }, null, 2)}\n`, { flag: "wx" });
  return { file, shots };
}

/**
 * The Zone's pole of inaccessibility, on a half-cell grid: of the points as far from its outline as
 * any, the nearest its bounds' middle, so a long Zone's Shot sits midway along it. For a Zone with
 * no half-cell point inside, its vertices' mean.
 */
function zonePoint(polygon: readonly Point[]): Point {
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const [left, right, bottom, top] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const middle = { x: (left + right) / 2, y: (bottom + top) / 2 };
  let best: { point: Point; clearance: number; off: number } | undefined;
  for (let y = Math.ceil(bottom * 2) / 2; y <= top; y += 0.5) {
    for (let x = Math.ceil(left * 2) / 2; x <= right; x += 0.5) {
      const point = { x, y };
      if (!containsPoint(polygon, point)) continue;
      const clearance = distanceToPolygon(polygon, point);
      const off = Math.hypot(x - middle.x, y - middle.y);
      if (!best || clearance > best.clearance + 1e-9 || (Math.abs(clearance - best.clearance) <= 1e-9 && off < best.off)) best = { point, clearance, off };
    }
  }
  return best?.point ?? { x: xs.reduce((sum, x) => sum + x, 0) / xs.length, y: ys.reduce((sum, y) => sum + y, 0) / ys.length };
}

/** A rect of `size` centred on `point`, moved in to lie inside `bounds` where it fits, and cut to them. */
function rectAround(point: Point, [width, height]: readonly [number, number], [left, bottom, right, top]: readonly [number, number, number, number]): [number, number, number, number] {
  const span = (middle: number, length: number, low: number, high: number): [number, number] => {
    const start = Math.min(Math.max(middle - length / 2, low), high - length);
    return [Math.max(start, low), Math.min(start + length, high)];
  };
  const [x0, x1] = span(point.x, width, left, right);
  const [y0, y1] = span(point.y, height, bottom, top);
  return [x0, y0, x1, y1];
}
