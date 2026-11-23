// Area selection for brush edits on Kept ground (spec #247): a Kept region, a named point with a
// radius, a rectangle or a polygon, in cells. It resolves to the cells inside (those whose middles
// lie in it) and a weight per vertex for the falloff: 1 on the inside cells' corners, fading
// smoothly to 0 over the falloff's width in cells. Heights live on vertices, so a brush changes the
// inside cells and, through their shared corners, the cells round them out to the falloff's edge.

import { z } from "zod";

import type { KeptReference, RegionShape } from "../domain/mission-blueprint.js";
import { inRegion } from "../dressing/capture-composite.js";
import type { PlacedPoint } from "../map/read-objects-xml.js";
import type { EditorRegion } from "../map/read-regions-xml.js";
import { containsPoint } from "../terrain/rasterize.js";

/** The width of a soft falloff, in cells. */
export const SOFT_FALLOFF = 3;

const XYSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
/** A point: its Editor Id, Kept Reference id or name, or a position { x, y }. */
export const PointTargetSchema = z.union([z.number().int().nonnegative(), z.string().min(1), XYSchema]);
/** "soft" (the default, {@link SOFT_FALLOFF} cells), "sharp" (none), or a width in cells. */
export const FalloffSchema = z.union([z.literal("soft"), z.literal("sharp"), z.number().nonnegative().max(64)]);
const Falloff = { falloff: FalloffSchema.optional() };

export const AreaSchema = z.union([
  z.object({ region: z.union([z.number().int().nonnegative(), z.string().min(1)]).describe("A Kept region: its Editor id, Kept Reference id or name"), ...Falloff }).strict(),
  z
    .object({
      point: PointTargetSchema.describe("A point: its Editor Id, Kept Reference id or name, or a position { x, y }"),
      radius: z.number().positive(),
      ...Falloff,
    })
    .strict(),
  z
    .object({
      rect: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() }).strict().describe("Cells x..x+width-1, y..y+height-1"),
      ...Falloff,
    })
    .strict(),
  z.object({ polygon: z.array(XYSchema).min(3).describe("Corners in map coordinates"), ...Falloff }).strict(),
]);
export type Area = z.input<typeof AreaSchema>;

/** What an area is resolved against: the map's size, its Kept regions and points, and the Blueprint's Kept References. */
export type AreaContext = {
  readonly width: number;
  readonly height: number;
  readonly regions: readonly EditorRegion[];
  readonly points: readonly PlacedPoint[];
  readonly kept: readonly Pick<KeptReference, "id" | "kind" | "editorId">[];
};

/** A rectangle of cells. */
export type CellRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export type AreaMask = {
  readonly width: number;
  readonly height: number;
  /** 1 for each cell inside the area: [y * width + x]. */
  readonly inside: Uint8Array;
  readonly insideCount: number;
  /** The brush's strength at each vertex ((width + 1) × (height + 1)): 1 inside, 0 past the falloff. */
  readonly vertexWeight: Float32Array;
  /** The falloff's width in cells. */
  readonly falloff: number;
  /** The cells the edit may change: every cell with a corner of weight above 0. */
  readonly reach: CellRect;
  /** The area in words, for the report. */
  readonly label: string;
};

/** Resolves `area` to its cells and falloff, as above. */
export function resolveArea(area: Area, context: AreaContext): AreaMask {
  const parsed = AreaSchema.parse(area);
  const { width, height } = context;
  const falloff = parsed.falloff === undefined || parsed.falloff === "soft" ? SOFT_FALLOFF : parsed.falloff === "sharp" ? 0 : parsed.falloff;
  const { contains, label } = selector(parsed, context);
  const inside = new Uint8Array(width * height);
  let insideCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!contains(x + 0.5, y + 0.5)) continue;
      inside[y * width + x] = 1;
      insideCount++;
    }
  }
  if (insideCount === 0) throw new Error(`${label} covers no cell of the ${width}×${height} map`);
  const vertexWeight = weights(inside, width, height, falloff);
  return { width, height, inside, insideCount, vertexWeight, falloff, reach: reachOf(vertexWeight, width, height), label };
}

/** A sharp mask of the given cells (1 inside), as a brush applies it: what a generating Zone paints. */
export function cellsMask(inside: Uint8Array, width: number, height: number, label: string): AreaMask {
  let insideCount = 0;
  for (const cell of inside) insideCount += cell ? 1 : 0;
  const vertexWeight = weights(inside, width, height, 0);
  return { width, height, inside, insideCount, vertexWeight, falloff: 0, reach: reachOf(vertexWeight, width, height), label };
}

function selector(area: z.output<typeof AreaSchema>, context: AreaContext): { contains: (x: number, y: number) => boolean; label: string } {
  if ("rect" in area) {
    const { x, y, width, height } = area.rect;
    return { contains: (px, py) => px >= x && px < x + width && py >= y && py < y + height, label: `the ${width}×${height} cells at (${x}, ${y})` };
  }
  if ("polygon" in area) {
    return { contains: (x, y) => containsPoint(area.polygon, { x, y }), label: `the polygon of ${area.polygon.length} corners` };
  }
  if ("region" in area) {
    const region = findRegion(area.region, context);
    const shapes: readonly RegionShape[] = region.shapes;
    return { contains: (x, y) => inRegion(shapes, x, y), label: `region ${region.id} (${region.name})` };
  }
  const { centre, name } = findPoint(area.point, context);
  const r = area.radius;
  return { contains: (x, y) => Math.hypot(x - centre.x, y - centre.y) <= r, label: `${r} cells round ${name}` };
}

function findRegion(target: number | string, context: AreaContext): EditorRegion {
  let id: number | undefined = typeof target === "number" ? target : undefined;
  if (typeof target === "string") {
    const kept = context.kept.find((reference) => reference.kind === "region" && reference.id === target);
    if (kept) id = Number(kept.editorId);
    else {
      const named = context.regions.filter((region) => region.name === target);
      if (named.length > 1) throw new Error(`${named.length} regions are named "${target}": name it by its Editor id (${named.map((region) => region.id).join(", ")})`);
      if (named.length === 0) throw new Error(`the package has no region named "${target}", and the Blueprint no Kept region with that id`);
      return named[0]!;
    }
  }
  const region = context.regions.find((candidate) => candidate.id === id);
  if (!region) throw new Error(`the package has no region ${id}`);
  return region;
}

/** A point by its Editor Id, Kept Reference id or name, or a position, with how the report names it. */
export function findPoint(target: number | string | { x: number; y: number }, context: AreaContext): { centre: { x: number; y: number }; name: string } {
  if (typeof target === "object") return { centre: target, name: `(${target.x}, ${target.y})` };
  let id: number | undefined = typeof target === "number" ? target : undefined;
  if (typeof target === "string") {
    const kept = context.kept.find((reference) => reference.kind === "point" && reference.id === target);
    if (kept) id = Number(kept.editorId);
    else {
      const named = context.points.filter((point) => point.name === target);
      if (named.length > 1) throw new Error(`${named.length} points are named "${target}": name it by its Editor Id (${named.map((point) => point.id).join(", ")})`);
      if (named.length === 0) throw new Error(`the package has no point named "${target}", and the Blueprint no Kept point with that id`);
      return { centre: named[0]!.position, name: `point ${named[0]!.id} (${target})` };
    }
  }
  const point = context.points.find((candidate) => candidate.id === id);
  if (!point) throw new Error(`the package has no point ${id}`);
  return { centre: point.position, name: `point ${point.id}${point.name ? ` (${point.name})` : ""}` };
}

/** 1 on the inside cells' corners, then 1 − smoothstep(d / (falloff + 1)) by distance d to the nearest of them. */
function weights(inside: Uint8Array, width: number, height: number, falloff: number): Float32Array {
  const columns = width + 1;
  const weight = new Float32Array(columns * (height + 1));
  const isCorner = new Uint8Array(weight.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside[y * width + x]) continue;
      for (const v of [y * columns + x, y * columns + x + 1, (y + 1) * columns + x, (y + 1) * columns + x + 1]) isCorner[v] = 1;
    }
  }
  // Only corners on the edge of the inside can be nearest to a vertex outside it.
  const edge: [number, number][] = [];
  for (let v = 0; v < weight.length; v++) {
    if (!isCorner[v]) continue;
    weight[v] = 1;
    const x = v % columns;
    const y = Math.floor(v / columns);
    const outer = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].some(([nx, ny]) => nx! < 0 || ny! < 0 || nx! > width || ny! > height || !isCorner[ny! * columns + nx!]);
    if (outer) edge.push([x, y]);
  }
  if (falloff === 0) return weight;
  const span = falloff + 1;
  // Bucket the edge corners so each vertex looks only at those within reach.
  const bucket = Math.ceil(span);
  const buckets = new Map<string, [number, number][]>();
  for (const corner of edge) {
    const key = `${Math.floor(corner[0] / bucket)},${Math.floor(corner[1] / bucket)}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(corner);
  }
  for (let v = 0; v < weight.length; v++) {
    if (isCorner[v]) continue;
    const x = v % columns;
    const y = Math.floor(v / columns);
    const bx = Math.floor(x / bucket);
    const by = Math.floor(y / bucket);
    let best = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const [cx, cy] of buckets.get(`${bx + dx},${by + dy}`) ?? []) best = Math.min(best, Math.hypot(x - cx, y - cy));
      }
    }
    if (best >= span) continue;
    const t = best / span;
    weight[v] = 1 - t * t * (3 - 2 * t);
  }
  return weight;
}

function reachOf(weight: Float32Array, width: number, height: number): CellRect {
  const columns = width + 1;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let v = 0; v < weight.length; v++) {
    if (weight[v]! <= 0) continue;
    const x = v % columns;
    const y = Math.floor(v / columns);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  // A vertex is a corner of the cells either side of it.
  const left = Math.max(0, x0 - 1);
  const bottom = Math.max(0, y0 - 1);
  const right = Math.min(width - 1, x1);
  const top = Math.min(height - 1, y1);
  return { x: left, y: bottom, width: right - left + 1, height: top - bottom + 1 };
}
