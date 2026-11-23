import type { LoadedMapPackage } from "./load-map-package.js";
import { round, topEntries } from "./stats.js";
import type { TerrainGrid } from "./terrain-grid.js";

/** A layer counts as present in a cell's blend once it supplies this share of the visible mix. */
const PRESENT = 0.1;

export function measureTexturing(map: LoadedMapPackage, grid: TerrainGrid) {
  const coverage = new Map<string, number>();
  const dominant = new Map<string, number>();
  const blendCounts = new Map<string, number>();
  const pairs = new Map<string, number>();
  const byContext: Record<string, Map<string, number>> = { cliffEdge: new Map(), nearEdge: new Map(), open: new Map(), ramp: new Map() };
  const byLevel = new Map<number, Map<string, number>>();
  const dominantName: string[] = new Array(grid.width * grid.height);
  let playable = 0;

  for (let i = 0; i < grid.width * grid.height; i++) {
    if (!grid.isPlayable[i]) continue;
    playable++;
    let best = 0;
    let bestShare = -1;
    let present = 0;
    for (let l = 0; l < 8; l++) {
      const share = grid.layerShare[i * 8 + l]!;
      const name = grid.layerTexture[i * 8 + l]!;
      coverage.set(name, (coverage.get(name) ?? 0) + share);
      if (share >= PRESENT) present++;
      if (share > bestShare) {
        bestShare = share;
        best = l;
      }
    }
    const name = grid.layerTexture[i * 8 + best]!;
    dominantName[i] = name;
    dominant.set(name, (dominant.get(name) ?? 0) + 1);
    blendCounts.set(String(present), (blendCounts.get(String(present)) ?? 0) + 1);

    const context = grid.isRamp[i] ? "ramp" : grid.isCliffEdge[i] ? "cliffEdge" : grid.edgeDistance[i]! <= 3 ? "nearEdge" : "open";
    byContext[context]!.set(name, (byContext[context]!.get(name) ?? 0) + 1);
    if (!grid.isRamp[i]) {
      const level = grid.level[i]!;
      if (!byLevel.has(level)) byLevel.set(level, new Map());
      byLevel.get(level)!.set(name, (byLevel.get(level)!.get(name) ?? 0) + 1);
    }
  }

  // Transition grammar: which dominant textures meet across cell borders.
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (!grid.isPlayable[i]) continue;
      for (const j of [x + 1 < grid.width ? i + 1 : -1, y + 1 < grid.height ? i + grid.width : -1]) {
        if (j < 0 || !grid.isPlayable[j]) continue;
        const a = dominantName[i]!;
        const b = dominantName[j]!;
        if (a === b) continue;
        const key = [a, b].sort().join(" | ");
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  // Where blends sit: share of mixed cells (2+ textures present) within 2 cells of a border
  // between different dominant textures, against the share of all cells that are that close.
  const nearBorder = new Uint8Array(grid.width * grid.height);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const a = dominantName[y * grid.width + x];
      if (a === undefined) continue;
      let border = false;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        const b = dominantName[(y + dy) * grid.width + (x + dx)];
        if (x + dx >= 0 && x + dx < grid.width && b !== undefined && b !== a) border = true;
      }
      if (!border) continue;
      for (let ny = Math.max(0, y - 2); ny <= Math.min(grid.height - 1, y + 2); ny++) {
        for (let nx = Math.max(0, x - 2); nx <= Math.min(grid.width - 1, x + 2); nx++) nearBorder[ny * grid.width + nx] = 1;
      }
    }
  }
  let mixed = 0;
  let mixedNear = 0;
  let near = 0;
  for (let i = 0; i < grid.width * grid.height; i++) {
    if (!grid.isPlayable[i]) continue;
    if (nearBorder[i]) near++;
    let present = 0;
    for (let l = 0; l < 8; l++) if (grid.layerShare[i * 8 + l]! >= PRESENT) present++;
    if (present >= 2) {
      mixed++;
      if (nearBorder[i]) mixedNear++;
    }
  }

  const contextTotal = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  return {
    tileset: map.terrain.tilesetId,
    textureSets: map.terrain.textureSets.filter(Boolean),
    note: "Shares normalise each cell's 8 mask weights to sum to 1; 'present' means >= 10% of a cell's mix.",
    coverage: topEntries(new Map([...coverage].map(([k, v]) => [k, round(v)])), 16, playable),
    dominant: topEntries(dominant, 16, playable),
    texturesPresentPerCell: Object.fromEntries([...blendCounts].sort().map(([k, v]) => [k, round(v / playable)])),
    transitions: topEntries(pairs, 20),
    blendPlacement: {
      note: "mixedNearBorder: share of mixed cells within 2 cells of a dominant-texture border; cellsNearBorder: share of all playable cells that close.",
      mixedNearBorder: round(mixedNear / Math.max(1, mixed)),
      cellsNearBorder: round(near / Math.max(1, playable)),
    },
    dominantByContext: Object.fromEntries(Object.entries(byContext).map(([k, m]) => [k, topEntries(m, 5, contextTotal(m))])),
    dominantByLevel: Object.fromEntries([...byLevel].sort((a, b) => a[0] - b[0]).map(([level, m]) => [`level${level}`, topEntries(m, 5, contextTotal(m))])),
  };
}
