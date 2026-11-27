// Adds or edits a Paint Region (ADR-0028, #136): what `paint_region` and `npm run paint-region` run.
// The outline comes from one of:
// - a Zone: the region takes `zone`, so it follows the Zone's polygon;
// - a rectangle of cells, [left, bottom, right, top], as a Shot's `rect` is given;
// - a box on a Still Review frame, [left, top, right, bottom] as fractions of the frame from its
//   top-left corner, turned into cells through that Shot's `camera` in shots.json (frameToGround,
//   on flat ground at the camera target's height), clipped to the map.
// The mix is checked before anything is written: by the Catalog-aware schema (its texture sets), and
// beside Kept ground against the sets the Map Package has the region's blocks on, which the schema
// can't read for a generating Zone in no texture set.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { frameToGround } from "../capture/area-tour.js";
import type { CapturedShot } from "../capture/shots.js";
import { hasKeptTerrain, type MissionBlueprint, type PaintMix } from "../domain/mission-blueprint.js";
import { packageRegionGround } from "../kept-terrain/paint-region-usage.js";
import { readKeptTextures } from "../kept-terrain/paint-brushes.js";
import { missionMapPackage, readCompileRecord } from "../map/mission-package.js";
import { recordedKeptCells } from "../map/zones-beside-kept.js";
import type { BlueprintIssue, Workspace } from "../plugins/workspace.js";
import { rasterisePaintRegions } from "../terrain/paint-regions.js";
import type { Point } from "../terrain/rasterize.js";
import { type Edit, editMissionBlueprint, EditRefused, type EditResult } from "./edit-blueprint.js";

type Raw = Record<string, unknown>;
/** A rectangle of cells: [left, bottom, right, top], as a Shot's `rect`. */
type CellRect = readonly [number, number, number, number];
/** A box on a frame: [left, top, right, bottom], fractions of its width and height from its top-left corner. */
type FrameBox = readonly [number, number, number, number];

/** A box on a Still Review frame: the capture (its name under the Mission's output/shots, or a path to its shots.json), the Shot (its number or label) and the box. */
export type FrameMark = { readonly capture: string; readonly shot: number | string; readonly box: FrameBox };

export type PaintRegionRequest = {
  readonly id: string;
  /** One outline source at most; none keeps an existing region's. */
  readonly zone?: string | undefined;
  readonly rect?: CellRect | undefined;
  readonly frame?: FrameMark | undefined;
  readonly mix?: readonly PaintMix[] | undefined;
  /** null removes it, back to the default. */
  readonly falloff?: number | null | undefined;
  readonly levels?: readonly number[] | null | undefined;
};

/** A region's outline as the edit writes it, and how the notes name it. */
export type RegionOutline = { readonly zone: string } | { readonly polygon: readonly Point[]; readonly from: string };

/** Adds or edits the Paint Region, checked as above. */
export async function missionPaintRegion(workspace: Workspace, blueprintPath: string, request: PaintRegionRequest): Promise<EditResult> {
  const sources = (["zone", "rect", "frame"] as const).filter((key) => request[key] !== undefined);
  if (sources.length > 1) return { saved: false, issues: [{ path: sources.join(", "), message: "Give a Paint Region's outline one way: zone, rect or frame" }] };
  let outline: RegionOutline | undefined;
  try {
    if (request.zone !== undefined) outline = { zone: request.zone };
    else if (request.rect !== undefined) outline = rectOutline(request.rect);
    else if (request.frame !== undefined) outline = frameOutline(await readShot(blueprintPath, request.frame), request.frame, await mapSizeOf(blueprintPath));
  } catch (error) {
    return { saved: false, issues: [error instanceof EditRefused ? error.issue : { path: sources[0] ?? "(blueprint)", message: (error as Error).message }] };
  }
  return editMissionBlueprint(workspace, blueprintPath, paintRegionEdit(request, outline), { check: (blueprint) => packageMixIssues(blueprint, blueprintPath, request.id) });
}

/** A rectangle of cells as an outline, corners anticlockwise from its south-west one. */
export function rectOutline([left, bottom, right, top]: CellRect): RegionOutline {
  if (!(right > left && top > bottom)) throw new EditRefused({ path: "rect", message: "rect is [left, bottom, right, top], with right past left and top above bottom" });
  return { polygon: [{ x: left, y: bottom }, { x: right, y: bottom }, { x: right, y: top }, { x: left, y: top }], from: `cells [${left}, ${bottom}, ${right}, ${top}]` };
}

/**
 * A frame box as an outline: its four corners on the ground through the Shot's camera, clipped to
 * the map and rounded to a tenth of a cell.
 */
export function frameOutline(shot: Pick<CapturedShot, "shot" | "label" | "camera">, mark: Pick<FrameMark, "box">, mapSize: { readonly width: number; readonly height: number }): RegionOutline {
  const [left, top, right, bottom] = mark.box;
  if (!(right > left && bottom > top) || [left, top, right, bottom].some((value) => value < 0 || value > 1)) {
    throw new Error("box is [left, top, right, bottom], fractions of the frame from its top-left corner (0..1), with right past left and bottom below top");
  }
  const corners = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([u, v]) => frameToGround(shot.camera, u!, v!));
  const round = (value: number) => Math.round(value * 10) / 10;
  const polygon = dedupe(clipToMap(corners, mapSize).map(({ x, y }) => ({ x: round(x), y: round(y) })));
  const name = shot.label ? `shot ${shot.shot} (${shot.label})` : `shot ${shot.shot}`;
  if (polygon.length < 3) throw new Error(`The box on ${name}'s frame lands off the map`);
  return { polygon, from: `the box on ${name}'s frame, through its camera` };
}

/** The edit itself: the region added, or its outline, mix, falloff or levels replaced. */
export const paintRegionEdit =
  (request: PaintRegionRequest, outline: RegionOutline | undefined): Edit =>
  (raw) => {
    const regions = (Array.isArray(raw.paintRegions) ? raw.paintRegions : []) as Raw[];
    const index = regions.findIndex((region) => region.id === request.id);
    const adding = index < 0;
    if (adding && (!outline || !request.mix)) {
      const lacking = [!outline && "an outline (zone, rect or frame)", !request.mix && "a mix"].filter(Boolean).join(" and ");
      throw new EditRefused({ path: "paintRegions", message: `There's no Paint Region ${request.id} yet: give it ${lacking}` });
    }
    const old = adding ? { id: request.id } : regions[index]!;
    const where = outline ? ("zone" in outline ? { zone: outline.zone } : { polygon: outline.polygon.map(({ x, y }) => ({ x, y })) }) : old.zone !== undefined ? { zone: old.zone } : { polygon: old.polygon };
    const falloff = request.falloff === null ? undefined : (request.falloff ?? old.falloff);
    const levels = request.levels === null ? undefined : (request.levels ? [...request.levels] : old.levels);
    // In the schema's order, so a diff reads the same way every time.
    const region: Raw = {
      id: request.id,
      ...where,
      mix: request.mix ? request.mix.map((entry) => ({ ...entry })) : old.mix,
      ...(falloff === undefined ? {} : { falloff }),
      ...(levels === undefined ? {} : { levels }),
    };
    if (adding) regions.push(region);
    else regions[index] = region;
    raw.paintRegions = regions;
    const what = outline ? ("zone" in outline ? `Zone ${outline.zone}` : `${outline.from}: ${outline.polygon.map(({ x, y }) => `(${x}, ${y})`).join(", ")}`) : undefined;
    if (adding) return { raw, notes: [`Added Paint Region ${request.id} over ${what}.`] };
    const changed = [
      what && `its outline is ${what}`,
      request.mix && "its mix replaced",
      request.falloff !== undefined && (request.falloff === null ? "its falloff back to the default" : `its falloff ${request.falloff}`),
      request.levels !== undefined && (request.levels === null ? "every level" : `levels ${request.levels.join(", ")}`),
    ].filter(Boolean);
    return { raw, notes: [`Updated Paint Region ${request.id}: ${changed.join("; ") || "nothing changed"}.`] };
  };

/**
 * Beside Kept ground, region `id`'s textures against the sets the Map Package has its cells' blocks
 * on, as the compile checks them (keptPaintRegions). Only that region, so one an earlier edit left
 * wrong doesn't block fixing another. Nothing to check before the package has terrain (the compile
 * checks then), or on a generated map, whose sets the schema works out from the Blueprint.
 */
export async function packageMixIssues(blueprint: MissionBlueprint, blueprintPath: string, id: string): Promise<BlueprintIssue[]> {
  if (!blueprint.paintRegions?.length || !hasKeptTerrain(blueprint)) return [];
  const mapPackage = await missionMapPackage(blueprintPath);
  const files = ["t3Terrain.xml", "t3TextureMasks", "t3SyncTextureInfo"].map((file) => path.join(mapPackage, file));
  if (!files.every((file) => existsSync(file))) return [];
  const [terrain, masks, sync] = await Promise.all(files.map((file) => readFile(file)));
  const textures = readKeptTextures(terrain!.toString("utf8"), masks!, sync!);
  const ground = packageRegionGround(blueprint, textures, recordedKeptCells(await readCompileRecord(blueprintPath), textures.width, textures.height));
  return blueprint.paintRegions.flatMap((region, index) => {
    if (region.id !== id) return [];
    try {
      rasterisePaintRegions([region], ground);
      return [];
    } catch (error) {
      return [{ path: `paintRegions.${index}.mix`, message: `${(error as Error).message}, as ${path.basename(mapPackage)} has its blocks` }];
    }
  });
}

/** The Shot a frame mark names, from its capture's shots.json. */
async function readShot(blueprintPath: string, mark: FrameMark): Promise<CapturedShot> {
  const file = mark.capture.endsWith(".json") ? path.resolve(path.dirname(blueprintPath), mark.capture) : path.join(path.dirname(blueprintPath), "output", "shots", mark.capture, "shots.json");
  if (!existsSync(file)) throw new Error(`No capture at ${file}: give a capture's name under the Mission's output/shots, or the path to its shots.json`);
  const { shots } = JSON.parse(await readFile(file, "utf8")) as { shots: CapturedShot[] };
  const shot = shots.find((candidate) => (typeof mark.shot === "number" ? candidate.shot === mark.shot : candidate.label === mark.shot));
  if (!shot) throw new Error(`${file} has no Shot ${mark.shot}: its Shots are ${shots.map((s) => (s.label ? `${s.shot} (${s.label})` : String(s.shot))).join(", ")}`);
  return shot;
}

async function mapSizeOf(blueprintPath: string): Promise<{ width: number; height: number }> {
  const raw = JSON.parse(await readFile(blueprintPath, "utf8")) as { mapSize?: { width: number; height: number } };
  if (!raw.mapSize) throw new Error(`${blueprintPath} has no mapSize`);
  return raw.mapSize;
}

/** A convex outline clipped to the map's rectangle (Sutherland-Hodgman, one edge at a time). */
function clipToMap(polygon: readonly Point[], { width, height }: { readonly width: number; readonly height: number }): Point[] {
  const edges: [(p: Point) => number][] = [[(p) => p.x], [(p) => width - p.x], [(p) => p.y], [(p) => height - p.y]];
  let out = [...polygon];
  for (const [inside] of edges) {
    const input = out;
    out = [];
    input.forEach((current, i) => {
      const previous = input[(i + input.length - 1) % input.length]!;
      const [a, b] = [inside(previous), inside(current)];
      if (b >= 0 !== a >= 0) {
        const t = a / (a - b);
        out.push({ x: previous.x + (current.x - previous.x) * t, y: previous.y + (current.y - previous.y) * t });
      }
      if (b >= 0) out.push(current);
    });
  }
  return out;
}

/** The outline without a corner repeating the one before it. */
const dedupe = (polygon: Point[]): Point[] => polygon.filter((point, i) => {
  const before = polygon[(i + polygon.length - 1) % polygon.length]!;
  return polygon.length === 1 || point.x !== before.x || point.y !== before.y;
});
