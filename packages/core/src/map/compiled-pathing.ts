// What a generated map's CellAttribute_Pnp holds once compiled: the dug pools' paint, the paint
// under solid doodads (terrain/doodad-pathing.ts), then the author's `pathingPaint`. The compile
// writes it, and sync works it out without the author's paint to tell what they changed. Beside
// Kept ground the file is the package's, and none of this runs.

import type { Catalog } from "../catalog/catalog-layer.js";
import { isPlaced, type MissionBlueprint } from "../domain/mission-blueprint.js";
import type { PlacedDoodad } from "../dressing/expand-dressing.js";
import { CELL_FLAG_CLIFF } from "../terrain/cliffs.js";
import { applyPathingPaint, type DoodadPaint, hasSub, missingOutlineWarning, paintDoodads, type PathingDoodad, SUB_X, SUB_Y } from "../terrain/doodad-pathing.js";
import { cellOwners, type TerrainRasterizationResult, terrainHeightAt } from "../terrain/rasterize.js";
import { anchorDoodadDefaults } from "./anchor-doodad-defaults.js";

export type CompiledPathing = {
  /** What the compile paints before the author's paint: dug pools and doodads, a byte a cell. */
  readonly base: Uint8Array;
  /** What it writes: `base` with `pathingPaint` applied. */
  readonly cells: Uint8Array;
  /** The pools' paint with `pathingPaint` applied, but no doodad's: what the doodads cut is told from it. */
  readonly withoutDoodads: Uint8Array;
  /** Every placed doodad, as the paint reads them. */
  readonly doodads: readonly PathingDoodad[];
  readonly paint: DoodadPaint;
  readonly warnings: readonly string[];
};

/** The Blueprint's placed doodads, dressing and doodad Anchors, as the paint reads them, each with how high above the ground it stands. */
export function pathingDoodads(blueprint: Pick<MissionBlueprint, "anchors" | "mapSize">, dressing: readonly PlacedDoodad[], terrain: TerrainRasterizationResult): PathingDoodad[] {
  const raised = (x: number, y: number, z: number | undefined): { raised?: number } => {
    if (z === undefined) return {};
    const above = z - terrainHeightAt(terrain, blueprint.mapSize.width, x, y);
    return above > 0.01 ? { raised: above } : {};
  };
  return [
    ...dressing.map((doodad) => ({
      id: doodad.id,
      type: doodad.type,
      x: doodad.x,
      y: doodad.y,
      rotation: doodad.rotation,
      scale: doodad.scale,
      variation: doodad.variation,
      ...(doodad.ring ? { ring: doodad.ring } : {}),
      ...(doodad.pathing ? { pathing: doodad.pathing } : {}),
      ...raised(doodad.x, doodad.y, doodad.z),
    })),
    ...blueprint.anchors.filter(isPlaced).flatMap((anchor): PathingDoodad[] => {
      if (anchor.kind !== "doodad" || !anchor.doodadType) return [];
      const defaults = anchorDoodadDefaults(anchor.id);
      return [
        {
          id: anchor.id,
          type: anchor.doodadType,
          x: anchor.position.x,
          y: anchor.position.y,
          rotation: anchor.rotation ?? defaults.rotation,
          scale: anchor.scale ?? defaults.scale,
          variation: anchor.variation ?? 0,
          ring: "anchor-object",
          ...(anchor.pathing ? { pathing: anchor.pathing } : {}),
          ...raised(anchor.position.x, anchor.position.y, anchor.position.z),
        },
      ];
    }),
  ];
}

/**
 * The generated map's pathing paint (see the top of this file), with warnings for doodads it can't
 * paint and paint it can't place. Without `includeDoodads` (a package written without its objects,
 * such as generate_terrain's) no doodad stands on the map, so only the pools and the author's
 * absolute paint are painted.
 */
export function compiledPathing(blueprint: MissionBlueprint, terrain: TerrainRasterizationResult, dressing: readonly PlacedDoodad[], catalog: Catalog, { includeDoodads = true }: { readonly includeDoodads?: boolean } = {}): CompiledPathing {
  const { width, height } = blueprint.mapSize;
  const doodads = includeDoodads ? pathingDoodads(blueprint, dressing, terrain) : [];
  const paint = paintDoodads(doodads, width, height, catalog);
  const base = Uint8Array.from(terrain.noPathing, (pools, cell) => pools | paint.cells[cell]!);
  const author = includeDoodads ? (blueprint.pathingPaint ?? []) : (blueprint.pathingPaint ?? []).filter((entry) => entry.doodad === undefined);
  const placed = new Map(doodads.map((doodad) => [doodad.id, doodad]));
  const applied = applyPathingPaint(base, author, width, height, placed);
  const withoutDoodads = applyPathingPaint(terrain.noPathing, author, width, height, placed).cells;
  const missing = missingOutlineWarning(paint.missing);
  return { base, cells: applied.cells, withoutDoodads, doodads, paint, warnings: [...(missing ? [missing] : []), ...applied.warnings] };
}

/** Cells round a connection's crossing point searched for a way across. */
const WINDOW = 10;
/** Cells from the crossing point a side's start and goal sub-cells lie within. */
const SIDE = 3;

/**
 * A warning for each connection with a crossing point (`at`) the doodads' paint cuts: ground units
 * could cross from one Zone to the other near it with the pools' and the author's paint alone, and
 * can't once the doodads are painted too. A way the author's own paint closes isn't the doodads'.
 * The search keeps to WINDOW cells round the point, on the Editor's sub-cells, off cliff cells, and
 * a sub-cell from anything blocked, about a small unit's radius. A connection without `at` isn't checked.
 */
export function pathingCutWarnings(
  blueprint: MissionBlueprint,
  terrain: Pick<TerrainRasterizationResult, "cellFlags" | "noPathing">,
  pathing: Pick<CompiledPathing, "cells" | "withoutDoodads" | "paint">,
  /** Filled with each cut connection's crossingKey, for pathWidthWarnings to leave alone. */
  cut?: Set<string>,
): string[] {
  if (pathing.paint.byDoodad.size === 0) return [];
  const { width, height } = blueprint.mapSize;
  // Which Zone each cell is in, worked out for the first connection there is to check.
  let ownersOnce: Int32Array | undefined;
  const ownerAt = (cell: number): number => (ownersOnce ??= cellOwners(blueprint))[cell]!;
  const zoneIndex = new Map(blueprint.zones.map((zone, index) => [zone.id, index]));
  const rowWidth = width * SUB_X;
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const zone of blueprint.zones) {
    for (const connection of zone.connections) {
      if (!connection.at) continue;
      const key = crossingKey(zone.id, connection.toZoneId, connection.at);
      if (seen.has(key)) continue;
      seen.add(key);
      const [a, b] = [zoneIndex.get(zone.id), zoneIndex.get(connection.toZoneId)];
      if (a === undefined || b === undefined) continue;
      const { x, y } = connection.at;
      const sx0 = Math.max(0, Math.floor((x - WINDOW) * SUB_X));
      const sx1 = Math.min(rowWidth - 1, Math.floor((x + WINDOW) * SUB_X));
      const sy0 = Math.max(0, Math.floor((y - WINDOW) * SUB_Y));
      const sy1 = Math.min(height * SUB_Y - 1, Math.floor((y + WINDOW) * SUB_Y));
      const crosses = (painted: Uint8Array): boolean => {
        const w = sx1 - sx0 + 1;
        const h = sy1 - sy0 + 1;
        const blocked = new Uint8Array(w * h);
        for (let sy = sy0; sy <= sy1; sy++) {
          for (let sx = sx0; sx <= sx1; sx++) {
            const cell = Math.floor(sy / SUB_Y) * width + Math.floor(sx / SUB_X);
            if (terrain.cellFlags[cell]! & CELL_FLAG_CLIFF || hasSub(painted, sy * rowWidth + sx, width)) blocked[(sy - sy0) * w + sx - sx0] = 1;
          }
        }
        // A sub-cell's clearance: nothing blocked beside it.
        const open = Uint8Array.from(blocked, (_, i) => {
          const [px, py] = [i % w, Math.floor(i / w)];
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (px + dx >= 0 && py + dy >= 0 && px + dx < w && py + dy < h && blocked[(py + dy) * w + px + dx]) return 0;
          return 1;
        });
        const side = (i: number, zone: number): boolean => {
          const [sx, sy] = [sx0 + (i % w), sy0 + Math.floor(i / w)];
          return ownerAt(Math.floor(sy / SUB_Y) * width + Math.floor(sx / SUB_X)) === zone && Math.hypot((sx + 0.5) / SUB_X - x, (sy + 0.5) / SUB_Y - y) <= SIDE;
        };
        const reached = new Uint8Array(w * h);
        const stack: number[] = [];
        for (let i = 0; i < w * h; i++) if (open[i] && side(i, a)) (reached[i] = 1), stack.push(i);
        while (stack.length) {
          const i = stack.pop()!;
          if (side(i, b)) return true;
          const px = i % w;
          for (const next of [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1]) {
            if (next >= 0 && open[next] && !reached[next]) (reached[next] = 1), stack.push(next);
          }
        }
        return false;
      };
      if (!crosses(pathing.withoutDoodads) || crosses(pathing.cells)) continue;
      cut?.add(key);
      const near = [...pathing.paint.byDoodad].filter(([, subs]) => subs.some((index) => Math.abs((index % rowWidth) / SUB_X - x) <= WINDOW && Math.abs(Math.floor(index / rowWidth) / SUB_Y - y) <= WINDOW)).map(([id]) => id);
      warnings.push(
        `The no-pathing painted under doodads cuts ${zone.id}'s connection to ${connection.toZoneId} at (${x}, ${y}): ground units can't cross there${near.length ? `. Painted nearby: ${near.slice(0, 6).join(", ")}${near.length > 6 ? ` and ${near.length - 6} more` : ""}` : ""}. Move them, set pathing: "walk" on one, or erase the paint in the Editor and sync`,
      );
    }
  }
  return warnings;
}

/** A crossing between two Zones, the same from either side. */
function crossingKey(a: string, b: string, at: { readonly x: number; readonly y: number } | undefined): string {
  return [a, b].sort().join("|") + (at ? `@${at.x},${at.y}` : "");
}

/** The narrowest, in cells, doodads may squeeze a way through a Zone between two of its crossings: two heroes abreast, with a margin. */
export const PATH_WIDTH = 3;

/**
 * A warning for each Zone whose doodads squeeze a way between two of its crossings narrower than
 * PATH_WIDTH cells, where it was that wide with the pools' and the author's paint alone. A Zone's
 * crossings are its connections either way round (not air-only): the sub-cells within SIDE cells of
 * the crossing point, or without one, along the edge the two Zones share. The way keeps to the Zone's
 * own cells, off cliff cells, and is as wide as the circle that fits along it: a way that was already
 * narrow (a `narrow` connection, a squeeze in the terrain) isn't the doodads'. A crossing the doodads
 * cut outright (`cut`, from pathingCutWarnings) has its own warning and is left out here.
 */
export function pathWidthWarnings(
  blueprint: MissionBlueprint,
  terrain: Pick<TerrainRasterizationResult, "cellFlags">,
  pathing: Pick<CompiledPathing, "cells" | "withoutDoodads" | "paint">,
  cut: ReadonlySet<string> = new Set(),
): string[] {
  if (pathing.paint.byDoodad.size === 0) return [];
  const { width, height } = blueprint.mapSize;
  const owners = cellOwners(blueprint);
  const zoneIndex = new Map(blueprint.zones.map((zone, index) => [zone.id, index]));
  const rowWidth = width * SUB_X;
  // Each Zone's cells' bounds.
  const bounds = blueprint.zones.map(() => ({ x0: width, y0: height, x1: -1, y1: -1 }));
  for (let cell = 0; cell < owners.length; cell++) {
    const box = bounds[owners[cell]!];
    if (!box) continue;
    const [x, y] = [cell % width, Math.floor(cell / width)];
    box.x0 = Math.min(box.x0, x);
    box.y0 = Math.min(box.y0, y);
    box.x1 = Math.max(box.x1, x);
    box.y1 = Math.max(box.y1, y);
  }
  // The sub-cells a PATH_WIDTH circle centred on a sub-cell covers, as (dx, dy) in sub-cells.
  const radius = PATH_WIDTH / 2;
  const disk: [number, number][] = [];
  for (let dy = -Math.ceil(radius * SUB_Y); dy <= Math.ceil(radius * SUB_Y); dy++) {
    for (let dx = -Math.ceil(radius * SUB_X); dx <= Math.ceil(radius * SUB_X); dx++) if (Math.hypot(dx / SUB_X, dy / SUB_Y) < radius) disk.push([dx, dy]);
  }
  const warnings: string[] = [];
  blueprint.zones.forEach((zone, zi) => {
    const box = bounds[zi]!;
    if (box.x1 < 0) return;
    // Its crossings, from its own connections and the other Zones' to it.
    const crossings = new Map<string, { readonly toZoneId: string; readonly at: { readonly x: number; readonly y: number } | undefined }>();
    const add = (toZoneId: string, type: string, at: { readonly x: number; readonly y: number } | undefined): void => {
      const key = crossingKey(zone.id, toZoneId, at);
      if (type !== "air-only" && !cut.has(key) && zoneIndex.has(toZoneId)) crossings.set(key, { toZoneId, at });
    };
    for (const connection of zone.connections) add(connection.toZoneId, connection.type, connection.at);
    for (const other of blueprint.zones) for (const connection of other.connections) if (connection.toZoneId === zone.id) add(other.id, connection.type, connection.at);
    if (crossings.size < 2) return;
    const [sx0, sy0] = [box.x0 * SUB_X, box.y0 * SUB_Y];
    const [w, h] = [(box.x1 - box.x0 + 1) * SUB_X, (box.y1 - box.y0 + 1) * SUB_Y];
    const global = (i: number): number => (sy0 + Math.floor(i / w)) * rowWidth + sx0 + (i % w);
    const cellOf = (i: number): number => (box.y0 + Math.floor(Math.floor(i / w) / SUB_Y)) * width + box.x0 + Math.floor((i % w) / SUB_X);
    const squeezed = Array.from({ length: w * h }, (_, i) => hasSub(pathing.cells, global(i), width) && !hasSub(pathing.withoutDoodads, global(i), width));
    if (!squeezed.some(Boolean)) return;
    // Where a PATH_WIDTH circle fits, on a layer: in the Zone, with nothing blocked under it (cells off the bounds count as clear).
    const fits = (painted: Uint8Array): Uint8Array => {
      const open = Uint8Array.from({ length: w * h }, (_, i) => (owners[cellOf(i)] === zi ? 1 : 0));
      for (let i = 0; i < w * h; i++) {
        if (!(terrain.cellFlags[cellOf(i)]! & CELL_FLAG_CLIFF) && !hasSub(painted, global(i), width)) continue;
        const [px, py] = [i % w, Math.floor(i / w)];
        for (const [dx, dy] of disk) if (px + dx >= 0 && py + dy >= 0 && px + dx < w && py + dy < h) open[(py + dy) * w + px + dx] = 0;
      }
      return open;
    };
    // The open sub-cells' regions: each sub-cell's region number, 0 where closed.
    const regions = (open: Uint8Array): Int32Array => {
      const region = new Int32Array(w * h);
      let next = 0;
      for (let start = 0; start < w * h; start++) {
        if (!open[start] || region[start]) continue;
        region[start] = ++next;
        const stack = [start];
        while (stack.length) {
          const i = stack.pop()!;
          const px = i % w;
          for (const n of [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1]) {
            if (n >= 0 && open[n] && !region[n]) (region[n] = next), stack.push(n);
          }
        }
      }
      return region;
    };
    // Each crossing's sub-cells in this Zone.
    const ends = [...crossings.values()].map((crossing) => {
      const other = zoneIndex.get(crossing.toZoneId)!;
      const near = (i: number): boolean => {
        const [px, py] = [i % w, Math.floor(i / w)];
        return Math.hypot(box.x0 + (px + 0.5) / SUB_X - crossing.at!.x, box.y0 + (py + 0.5) / SUB_Y - crossing.at!.y) <= SIDE;
      };
      const beside = (i: number): boolean => {
        const cell = cellOf(i);
        const [x, y] = [cell % width, Math.floor(cell / width)];
        return [x > 0 ? cell - 1 : -1, x < width - 1 ? cell + 1 : -1, y > 0 ? cell - width : -1, y < height - 1 ? cell + width : -1].some((n) => n >= 0 && owners[n] === other);
      };
      const mine = (test: (i: number) => boolean): number[] => [...Array(w * h).keys()].filter((i) => owners[cellOf(i)] === zi && test(i));
      const subs = crossing.at ? mine(near) : [];
      return { ...crossing, subs: subs.length ? subs : mine(beside) };
    });
    const before = regions(fits(pathing.withoutDoodads));
    const after = regions(fits(pathing.cells));
    const joined = (region: Int32Array, a: readonly number[], b: readonly number[]): boolean => {
      const reached = new Set(a.map((i) => region[i]!).filter(Boolean));
      return b.some((i) => reached.has(region[i]!));
    };
    const pairs: string[] = [];
    const pinch = new Set<number>();
    const label = (end: (typeof ends)[number]): string => `${end.toZoneId}${end.at ? ` (${end.at.x}, ${end.at.y})` : ""}`;
    for (let a = 0; a < ends.length; a++) {
      for (let b = a + 1; b < ends.length; b++) {
        const [from, to] = [ends[a]!, ends[b]!];
        if (!joined(before, from.subs, to.subs) || joined(after, from.subs, to.subs)) continue;
        pairs.push(`${label(from)} and ${label(to)}`);
        // Where the wide way stops: sub-cells it had before and lost to the doodads, beside where it
        // still reaches from either crossing, or at a crossing the doodads close.
        const whole = new Set(from.subs.map((i) => before[i]!).filter(Boolean));
        const reached = new Set([...from.subs, ...to.subs].map((i) => after[i]!).filter(Boolean));
        const atEnd = new Set([...from.subs, ...to.subs]);
        for (let i = 0; i < w * h; i++) {
          if (after[i] || !whole.has(before[i]!)) continue;
          const px = i % w;
          if (atEnd.has(i) || [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1].some((n) => n >= 0 && reached.has(after[n]!))) pinch.add(i);
        }
      }
    }
    if (!pairs.length) return;
    // The places it stops: the pinch's sub-cells in clumps, biggest first. A clump takes in what's within a circle's width, so the stops either side of a gap make one place.
    const points = [...pinch].map((i) => ({ x: box.x0 + ((i % w) + 0.5) / SUB_X, y: box.y0 + (Math.floor(i / w) + 0.5) / SUB_Y }));
    const clumps: (typeof points)[] = [];
    const left = new Set(points);
    for (const seed of points) {
      if (!left.has(seed)) continue;
      left.delete(seed);
      const clump = [seed];
      for (let k = 0; k < clump.length; k++) {
        for (const other of left) if (Math.hypot(other.x - clump[k]!.x, other.y - clump[k]!.y) <= PATH_WIDTH) left.delete(other), clump.push(other);
      }
      clumps.push(clump);
    }
    clumps.sort((a, b) => b.length - a.length);
    const places = clumps.slice(0, 3).map((clump) => `(${Math.round(clump.reduce((sum, p) => sum + p.x, 0) / clump.length)}, ${Math.round(clump.reduce((sum, p) => sum + p.y, 0) / clump.length)})`);
    // The doodads whose paint stands within a circle's radius of where the way stops, the one with most paint there first.
    const near = [...pathing.paint.byDoodad]
      .map(([id, subs]) => ({
        id,
        count: subs.filter((index) => {
          const [x, y] = [((index % rowWidth) + 0.5) / SUB_X, (Math.floor(index / rowWidth) + 0.5) / SUB_Y];
          return points.some((p) => Math.hypot(p.x - x, p.y - y) <= radius + 0.5);
        }).length,
      }))
      .filter(({ count }) => count > 0)
      .sort((a, b) => b.count - a.count)
      .map(({ id }) => id);
    warnings.push(
      `The no-pathing painted under doodads squeezes the way through ${zone.id} narrower than ${PATH_WIDTH} cells between ${pairs.slice(0, 3).join("; ")}${pairs.length > 3 ? ` and ${pairs.length - 3} more pairs` : ""}${places.length ? `, near ${places.join(", ")}` : ""}: heroes bunch up or file through there${near.length ? `. Painted nearby: ${near.slice(0, 6).join(", ")}${near.length > 6 ? ` and ${near.length - 6} more` : ""}` : ""}. Move or remove one, set pathing: "walk" on one, or erase the paint in the Editor and sync`,
    );
  });
  return warnings;
}
