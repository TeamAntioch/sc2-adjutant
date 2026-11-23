import type { LoadedMapPackage } from "./load-map-package.js";

/** Per-cell terrain facts derived once and shared by every measure. */
export type TerrainGrid = {
  readonly width: number;
  readonly height: number;
  /** Cliff level per cell (sync value / 64); fractional on ramps. */
  readonly level: Float32Array;
  readonly isRamp: Uint8Array;
  /** Cells whose 4-neighbour has a different whole level (and neither is a ramp). */
  readonly isCliffEdge: Uint8Array;
  /** Steps (4-neighbour) to the nearest cliff-edge cell, capped at 255. */
  readonly edgeDistance: Uint8Array;
  readonly isPlayable: Uint8Array;
  /** Texture name per mask layer per cell: [cellIndex * 8 + layer]. */
  readonly layerTexture: readonly string[];
  /** Visible share (0..1) of each layer per cell, weights normalised to sum to 1. */
  readonly layerShare: Float32Array;
};

export function buildTerrainGrid(map: LoadedMapPackage): TerrainGrid {
  const { width, height } = map.terrain;
  const cells = width * height;
  const level = new Float32Array(cells);
  const isRamp = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) {
    level[i] = (map.syncCliff.syncCliff[i] ?? 0) / 64;
    isRamp[i] = Number.isInteger(level[i]) ? 0 : 1;
  }

  const isCliffEdge = new Uint8Array(cells);
  const queue: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (isRamp[i]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (!isRamp[j] && level[j] !== level[i]) {
          isCliffEdge[i] = 1;
          break;
        }
      }
      if (isCliffEdge[i]) queue.push(i);
    }
  }

  const edgeDistance = new Uint8Array(cells).fill(255);
  for (const i of queue) edgeDistance[i] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % width;
    const y = Math.floor(i / width);
    const d = edgeDistance[i]! + 1;
    if (d >= 255) continue;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (edgeDistance[j]! > d) {
        edgeDistance[j] = d;
        queue.push(j);
      }
    }
  }

  const [left, bottom, right, top] = map.mapInfo.playableBounds;
  const isPlayable = new Uint8Array(cells);
  for (let y = bottom; y < top; y++) for (let x = left; x < right; x++) isPlayable[y * width + x] = 1;

  const blocksPerRow = Math.floor(width / 8);
  const layerTexture: string[] = new Array(cells * 8);
  const layerShare = new Float32Array(cells * 8);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const set = map.terrain.blockTextureSets[Math.floor(y / 8) * blocksPerRow + Math.floor(x / 8)] ?? 0;
      let sum = 0;
      for (let l = 0; l < 8; l++) sum += map.cellWeights[i * 8 + l]!;
      for (let l = 0; l < 8; l++) {
        layerTexture[i * 8 + l] = map.terrain.textures[set * 8 + l] ?? "";
        layerShare[i * 8 + l] = sum > 0 ? map.cellWeights[i * 8 + l]! / sum : 0;
      }
    }
  }
  return { width, height, level, isRamp, isCliffEdge, edgeDistance, isPlayable, layerTexture, layerShare };
}

/** Terrain height at a world point, bilinear over the height map's vertices. */
export function terrainHeightAt(map: LoadedMapPackage, x: number, y: number): number {
  const { vertexWidth, vertexHeight, heights } = map.heightMap;
  const fx = Math.min(Math.max(x, 0), vertexWidth - 1.001);
  const fy = Math.min(Math.max(y, 0), vertexHeight - 1.001);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const h = (vx: number, vy: number) => heights[vy * vertexWidth + vx]!;
  return (
    h(x0, y0) * (1 - tx) * (1 - ty) + h(x0 + 1, y0) * tx * (1 - ty) + h(x0, y0 + 1) * (1 - tx) * ty + h(x0 + 1, y0 + 1) * tx * ty
  );
}

export function cellIndexAt(grid: TerrainGrid, x: number, y: number): number {
  const cx = Math.min(grid.width - 1, Math.max(0, Math.floor(x)));
  const cy = Math.min(grid.height - 1, Math.max(0, Math.floor(y)));
  return cy * grid.width + cx;
}

/** The height at a point from per-vertex heights (`columns` per row), bilinear, clamped to the map. */
export function vertexHeightAt(heights: Float32Array, columns: number, x: number, y: number): number {
  const rows = heights.length / columns;
  const fx = Math.min(Math.max(x, 0), columns - 1.000001);
  const fy = Math.min(Math.max(y, 0), rows - 1.000001);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const h = (vx: number, vy: number) => heights[vy * columns + vx]!;
  return h(x0, y0) * (1 - tx) * (1 - ty) + h(x0 + 1, y0) * tx * (1 - ty) + h(x0, y0 + 1) * (1 - tx) * ty + h(x0 + 1, y0 + 1) * tx * ty;
}
