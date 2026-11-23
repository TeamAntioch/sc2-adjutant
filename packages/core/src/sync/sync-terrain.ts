// Syncs the author's terrain edits on a generated map back into its Blueprint: ground raised or
// lowered (t3HeightMap) as `terrainEdits.heights`, offsets over what the Zones generate, and water
// areas drawn, moved or deleted (t3Water) as `water` pools with their own `rect`. Cliff-level and
// texture-paint changes are found and listed, not synced: the compile still stops on them, for the
// author to keep or discard.
//
// The Editor rewrites the whole terrain on any terrain edit, at a quantization of its own, so heights
// are compared decoded, each file read with its own t3Terrain.xml's. What the compile wrote is the
// Blueprint's terrain generated again: the compile record's fingerprints say whether it still is.

import type { CompileRecord } from "../domain/compile-record.js";
import { fingerprint } from "../domain/compile-record.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { HEIGHT_EDIT_TOLERANCE, onRamp, terrainQuantization } from "../map/terrain-resave.js";
import { getStockWater, poolRects, poolWaterId, readT3Water, waterHeights } from "../map/write-water.js";
import { readT3HeightMap } from "../terrain/read-t3-height-map.js";
import { readT3TextureMasks } from "../terrain/read-t3-texture-masks.js";
import { rasterizeTerrain, type TerrainRasterizationResult } from "../terrain/rasterize.js";
import { heightQuantization, writeT3HeightMap } from "../terrain/write-t3-height-map.js";
import { writeT3SyncCliffLevel } from "../terrain/write-t3-sync-cliff-level.js";
import { writeT3TextureMasks } from "../terrain/write-t3-texture-masks.js";
import { clone, freshId, POSITION_TOLERANCE, round, slugOf, zoneAt } from "./sync-shared.js";

/** The package's terrain files sync reads, as bytes (WaterData.xml as text); each undefined when the package lacks it. */
export type EditorTerrainFiles = {
  readonly heightMap?: Uint8Array;
  readonly terrainXml?: string;
  readonly water?: Uint8Array;
  readonly waterData?: string;
  readonly textureMasks?: Uint8Array;
};

export type TerrainSyncReport = {
  /** Areas of ground raised or lowered, each "16 vertices at x 193-200, y 40-43". */
  readonly heightsChanged: string[];
  readonly waterAdded: string[];
  readonly waterChanged: string[];
  readonly waterRemoved: string[];
  /** What the Editor changed that sync leaves: cliffs, paint, or edits it couldn't tell from the Blueprint's. */
  readonly notSynced: string[];
};

/** A texel weight (0-15) moved by more than this is paint, not the Editor's rounding. */
const PAINT_TOLERANCE = 1;

type RawPool = Record<string, unknown> & { id: string; type: string; height: number; rects?: number[][] };

/**
 * The Blueprint (as written) with the Editor's terrain synced in. `parse` validates a Blueprint as
 * written; `record` is the Mission's compile record, when the package is its own: then a terrain
 * file that still has the compile's fingerprint wasn't saved by the Editor, and one the record
 * doesn't list (kept from the compile, or never written) is the package's, left alone.
 */
export function syncTerrain(
  raw: Record<string, unknown>,
  parse: (raw: Record<string, unknown>) => MissionBlueprint,
  files: EditorTerrainFiles,
  record: CompileRecord | undefined,
): { blueprint: Record<string, unknown>; report: TerrainSyncReport } {
  const blueprint = parse(raw);
  const report: TerrainSyncReport = { heightsChanged: [], waterAdded: [], waterChanged: [], waterRemoved: [], notSynced: [] };
  const recorded = (file: string): string | undefined | null => {
    if (!record) return null;
    const entry = record.entries.find((candidate) => candidate.kind === "file" && candidate.path === file);
    return entry && "fingerprint" in entry ? entry.fingerprint : undefined;
  };
  // Saved by the Editor since the compile: with no record, any file may have been.
  const edited = (file: string, bytes: Uint8Array | undefined): bytes is Uint8Array => {
    const print = recorded(file);
    return bytes !== undefined && print !== undefined && (print === null || fingerprint(bytes) !== print);
  };
  // The water first: a pool the author deleted takes its bank or bowl out of the generated ground,
  // which the Editor's ground still has, so the heights are compared with the Blueprint's after it.
  let out = edited("t3Water", files.water) ? syncWater(raw, blueprint, files.water, files.waterData, report) : raw;
  if (out !== raw || edited("t3HeightMap", files.heightMap) || edited("t3TextureMasks", files.textureMasks)) {
    out = syncGround(out, blueprint, out === raw ? blueprint : parse(out), files, recorded, report);
  }
  return { blueprint: out, report };
}

/** Each vertex's height and cliff level as a t3HeightMap holds them, with the map's own quantization. */
const readHeights = (bytes: Uint8Array, terrainXml: string | undefined) => readT3HeightMap(Buffer.from(bytes), terrainQuantization(terrainXml));

/**
 * The Editor's ground against what `synced` (the Blueprint with the water synced in) generates. Only
 * when `stored`, the Blueprint as it was, still generates what the compile wrote, or differs from it
 * only by the height edits an earlier sync wrote (its cliffs and paint as compiled): else the
 * Editor's edits can't be told from the Blueprint's own changes since the compile.
 */
function syncGround(
  raw: Record<string, unknown>,
  stored: MissionBlueprint,
  synced: MissionBlueprint,
  files: EditorTerrainFiles,
  recorded: (file: string) => string | undefined | null,
  report: TerrainSyncReport,
): Record<string, unknown> {
  const { width, height } = synced.mapSize;
  const before = rasterizeTerrain(stored);
  const terrain = synced === stored ? before : rasterizeTerrain(synced);
  // Whether a generated file is still what the compile wrote, so a difference from it is the Editor's.
  const asCompiled = (file: string, make: () => Uint8Array): boolean => {
    const print = recorded(file);
    return print === null || (print !== undefined && fingerprint(make()) === print);
  };
  const heightsAsCompiled = asCompiled("t3HeightMap", () => heightMapOf(stored, before));
  // The Blueprint's cliffs and paint as compiled: its ground laid out as it was, only its heights since moved, by the height edits a sync wrote.
  const layoutAsCompiled =
    asCompiled("t3SyncCliffLevel", () => writeT3SyncCliffLevel({ width, height, syncCliff: before.syncCliff })) &&
    asCompiled("t3TextureMasks", () => writeT3TextureMasks({ width, height, textureWeights: before.textureWeights, texelWeights: before.texelWeights }));
  const hasEdits = Object.keys(stored.terrainEdits?.heights ?? {}).length > 0;
  const comparable = heightsAsCompiled || (hasEdits && layoutAsCompiled);

  let out = raw;
  if (files.heightMap && recorded("t3HeightMap") !== undefined) {
    const editor = readHeights(files.heightMap, files.terrainXml);
    if (editor.vertexWidth !== width + 1 || editor.vertexHeight !== height + 1) {
      report.notSynced.push(`Ground heights: the package's t3HeightMap is ${editor.vertexWidth - 1}×${editor.vertexHeight - 1} cells, the Blueprint's map ${width}×${height}`);
    } else {
      const moved = new Map<number, number>();
      const cliffs = new Set<number>();
      for (let i = 0; i < editor.heights.length; i++) {
        // A ramp is worked out again by the Editor on every terrain save, and by the compile from the Zones.
        if (onRamp(terrain.cliffHeights, terrain.vertexCliffLevels, i)) continue;
        if (editor.cliffLevels[i] !== terrain.vertexCliffLevels[i]) cliffs.add(i);
        else if (Math.abs(editor.heights[i]! - terrain.heights[i]!) > HEIGHT_EDIT_TOLERANCE) moved.set(i, editor.heights[i]! - terrain.heights[i]!);
      }
      if (!comparable && (moved.size > 0 || cliffs.size > 0)) {
        report.notSynced.push(
          `Ground heights and cliffs: the Blueprint's terrain has changed since the last compile, so the Editor's edits can't be told from its own (${listed(areas([...moved.keys(), ...cliffs], width + 1, "vertices")).join("; ")}). Sync before changing the Blueprint's terrain`,
        );
      } else {
        if (cliffs.size > 0) report.notSynced.push(...listed(areas([...cliffs], width + 1, "vertices")).map((area) => `Cliff levels changed: ${area}`));
        if (moved.size > 0) {
          out = withHeightEdits(out, moved, width + 1);
          report.heightsChanged.push(...areas([...moved.keys()], width + 1, "vertices"));
        }
      }
    }
  }
  // Paint: only where the Blueprint still paints what the compile did, so a difference is the author's brush.
  const masksPrint = recorded("t3TextureMasks");
  if (files.textureMasks && masksPrint !== undefined && (masksPrint === null || fingerprint(files.textureMasks) !== masksPrint)) {
    const painted = layoutAsCompiled ? paintedCells(files.textureMasks, terrain, width, height) : undefined;
    if (!layoutAsCompiled) report.notSynced.push("Texture paint: the Blueprint's textures or cliffs have changed since the last compile, so the Editor's paint can't be told from them");
    else if (painted === undefined) report.notSynced.push(`Texture paint: the package's t3TextureMasks isn't ${width * 8}×${height * 8} texels`);
    else report.notSynced.push(...listed(areas(painted, width, "cells")).map((area) => `Textures painted: ${area}`));
  }
  return out;
}

/** t3HeightMap as the compile writes it from `terrain` (write-map-package.ts). */
function heightMapOf(blueprint: MissionBlueprint, terrain: TerrainRasterizationResult): Uint8Array {
  const { width, height } = blueprint.mapSize;
  return writeT3HeightMap({ width, height, heights: terrain.heights, cliffHeights: terrain.cliffHeights, cliffLevels: terrain.vertexCliffLevels, quantization: heightQuantization(terrain.heights, terrain.cliffHeights) });
}

/** `raw` with each moved vertex's difference added to its height edit; an edit that comes back to nothing goes. */
function withHeightEdits(raw: Record<string, unknown>, moved: ReadonlyMap<number, number>, row: number): Record<string, unknown> {
  const out = clone(raw);
  const terrainEdits = { ...((out.terrainEdits as Record<string, unknown> | undefined) ?? {}) };
  const heights = { ...((terrainEdits.heights as Record<string, number> | undefined) ?? {}) };
  for (const [index, difference] of moved) {
    const key = `${index % row},${Math.floor(index / row)}`;
    const offset = round((heights[key] ?? 0) + difference);
    if (Math.abs(offset) < HEIGHT_EDIT_TOLERANCE) delete heights[key];
    else heights[key] = offset;
  }
  // In vertex order, row by row, so a sync's diff reads as the ground it changed.
  const sorted = Object.fromEntries(Object.entries(heights).sort(([a], [b]) => vertexOrder(a, row) - vertexOrder(b, row)));
  terrainEdits.heights = sorted;
  if (Object.keys(sorted).length === 0) delete terrainEdits.heights;
  if (Object.keys(terrainEdits).length === 0) delete out.terrainEdits;
  else out.terrainEdits = terrainEdits;
  return out;
}

const vertexOrder = (key: string, row: number): number => {
  const [x, y] = key.split(",").map(Number) as [number, number];
  return y * row + x;
};

/** The cells whose texels the Editor painted away from what the Blueprint paints, or undefined for masks of another size. */
function paintedCells(bytes: Uint8Array, terrain: TerrainRasterizationResult, width: number, height: number): number[] | undefined {
  const masks = readT3TextureMasks(Buffer.from(bytes));
  if (masks.maskWidth !== width * 8 || masks.maskHeight !== height * 8) return undefined;
  const cells = new Set<number>();
  for (let layer = 0; layer < 8; layer++) {
    const texels = masks.layers[layer]!;
    for (let texel = 0; texel < texels.length; texel++) {
      if (Math.abs(texels[texel]! - terrain.texelWeights[texel * 8 + layer]!) <= PAINT_TOLERANCE) continue;
      const tx = texel % masks.maskWidth;
      const ty = Math.floor(texel / masks.maskWidth);
      cells.add(Math.floor(ty / 8) * width + Math.floor(tx / 8));
    }
  }
  return [...cells];
}

/** The first patches of a long list, and how many more: a cliff pass can touch hundreds. */
const MOST_LISTED = 8;
const listed = (patches: readonly string[]): string[] =>
  patches.length <= MOST_LISTED ? [...patches] : [...patches.slice(0, MOST_LISTED), `${patches.length - MOST_LISTED} smaller patches besides`];

/**
 * Each patch of `indices` (on a grid `row` wide), touching ones together, largest first:
 * "16 vertices at x 193-200, y 40-43".
 */
export function areas(indices: readonly number[], row: number, noun: "vertices" | "cells"): string[] {
  const left = new Set(indices);
  const patches: { count: number; x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const start of indices) {
    if (!left.delete(start)) continue;
    const patch = { count: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    const stack = [start];
    while (stack.length > 0) {
      const index = stack.pop()!;
      const [x, y] = [index % row, Math.floor(index / row)];
      patch.count++;
      patch.x0 = Math.min(patch.x0, x);
      patch.x1 = Math.max(patch.x1, x);
      patch.y0 = Math.min(patch.y0, y);
      patch.y1 = Math.max(patch.y1, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const next = (y + dy) * row + x + dx;
          if (x + dx >= 0 && x + dx < row && left.delete(next)) stack.push(next);
        }
      }
    }
    patches.push(patch);
  }
  const span = (a: number, b: number): string => (a === b ? `${a}` : `${a}-${b}`);
  return patches.sort((a, b) => b.count - a.count).map(({ count, x0, x1, y0, y1 }) => `${count} ${count > 1 ? noun : noun === "vertices" ? "vertex" : "cell"} at x ${span(x0, x1)}, y ${span(y0, y1)}`);
}

/**
 * The Editor's water areas as the Blueprint's pools. The Editor keeps water as tiles, so the areas
 * naming one CWater are one pool's: a pool's own CWater updates that pool's rectangles and height
 * where they moved; anything else (the stock type the author drew) is a new pool over those
 * rectangles, in the Zone at the centre of the largest, at the height the Editor gives its type,
 * with no bank (the author shaped the ground). A pool with no area left is removed, unless
 * something names it.
 */
function syncWater(raw: Record<string, unknown>, blueprint: MissionBlueprint, water: Uint8Array, waterData: string | undefined, report: TerrainSyncReport): Record<string, unknown> {
  let areas: ReturnType<typeof readT3Water>;
  try {
    areas = readT3Water(water);
  } catch (error) {
    report.notSynced.push(`Water, as t3Water couldn't be read (${error instanceof Error ? error.message : String(error)})`);
    return raw;
  }
  const heights = waterData !== undefined ? waterHeights(waterData) : new Map<string, number>();
  const out = clone(raw);
  const pools = ((out.water as RawPool[] | undefined) ?? []).slice();
  const byWater = new Map(blueprint.water.map((pool, index) => [poolWaterId(pool), index]));
  const seen = new Set<number>();
  // Rounded, bottom row first, so a sync's diff is stable whatever order the Editor lists its tiles in.
  const rectsOf = (rects: readonly (readonly number[])[]): number[][] => rects.map((rect) => rect.map((value) => round(value))).sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!);
  const describe = (rects: readonly (readonly number[])[]): string => rectsOf(rects).map((rect) => `[${rect.join(", ")}]`).join(" ");
  const sameRects = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]): boolean => {
    const [x, y] = [rectsOf(a), rectsOf(b)];
    return x.length === y.length && x.every((rect, i) => rect.every((value, k) => Math.abs(value - y[i]![k]!) <= POSITION_TOLERANCE));
  };
  const groups = new Map<string, number[][]>();
  for (const area of areas) groups.set(area.water, [...(groups.get(area.water) ?? []), [...area.rect]]);

  for (const [name, rects] of groups) {
    const index = byWater.get(name);
    if (index !== undefined) {
      seen.add(index);
      const pool = blueprint.water[index]!;
      const changed: string[] = [];
      if (!sameRects(rects, poolRects(blueprint, pool))) {
        pools[index] = { ...pools[index]!, rects: rectsOf(rects) };
        changed.push(`rects ${describe(rects)}`);
      }
      const level = heights.get(name);
      if (level !== undefined && Math.abs(level - pool.height) > HEIGHT_EDIT_TOLERANCE) {
        pools[index] = { ...pools[index]!, height: round(level) };
        changed.push(`height ${round(level)}`);
      }
      if (changed.length > 0) report.waterChanged.push(`${pool.id} (${changed.join(", ")})`);
      continue;
    }
    // A stock type, or a dependency's: the pool gets its own copy of it, as every pool does.
    const stock = getStockWater(name);
    const level = heights.get(name) ?? (stock ? Number(stock.state.Height) : undefined);
    if (level === undefined || !Number.isFinite(level)) {
      report.notSynced.push(`Water ${name} at ${describe(rects)}: no height for it in WaterData.xml, and it isn't a stock type`);
      continue;
    }
    const id = freshId(slugOf(name), (taken) => pools.some((pool) => pool.id === taken));
    const largest = [...rects].sort((a, b) => (b[2]! - b[0]!) * (b[3]! - b[1]!) - (a[2]! - a[0]!) * (a[3]! - a[1]!))[0]!;
    pools.push({ id, zoneId: zoneAt(blueprint, (largest[0]! + largest[2]!) / 2, (largest[1]! + largest[3]!) / 2), type: name, height: round(level), rects: rectsOf(rects), bank: false });
    report.waterAdded.push(`${id} (${name} at ${round(level)}, ${describe(rects)})`);
  }
  // Removed in the Editor: gone from the Blueprint, unless a transition or another part names the pool.
  const removed = new Set<number>();
  blueprint.water.forEach((pool, index) => {
    if (seen.has(index)) return;
    const rest = { ...out, water: pools.filter((_, other) => other !== index) };
    if (JSON.stringify(rest).includes(`"${pool.id}"`)) {
      report.notSynced.push(`Water pool ${pool.id} was deleted in the Editor, but the Blueprint names it, so it stays`);
      return;
    }
    removed.add(index);
    report.waterRemoved.push(pool.id);
  });
  if (report.waterAdded.length + report.waterChanged.length + report.waterRemoved.length === 0) return raw;
  return { ...out, water: pools.filter((_, index) => !removed.has(index)) };
}
