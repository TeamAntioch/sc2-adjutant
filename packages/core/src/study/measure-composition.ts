import type { LoadedMapPackage } from "./load-map-package.js";
import type { TerrainGrid } from "./terrain-grid.js";
import { countBy, round, topEntries } from "./stats.js";

/** Kind-1 t3VertCol values below this count as darkened. */
const DARKENED = 224;

function measureVertexShading(map: LoadedMapPackage, grid: TerrainGrid) {
  if (!map.vertexValues) return null;
  const vw = grid.width + 1;
  const counts = { cliffEdge: [0, 0], nearEdge: [0, 0], open: [0, 0], ramp: [0, 0] } as Record<string, [number, number]>;
  let darkened = 0;
  let playable = 0;
  for (let i = 0; i < grid.width * grid.height; i++) {
    if (!grid.isPlayable[i]) continue;
    playable++;
    const x = i % grid.width;
    const y = Math.floor(i / grid.width);
    const v = map.vertexValues;
    const mean = (v[y * vw + x]! + v[y * vw + x + 1]! + v[(y + 1) * vw + x]! + v[(y + 1) * vw + x + 1]!) / 4;
    const context = grid.isRamp[i] ? "ramp" : grid.isCliffEdge[i] ? "cliffEdge" : grid.edgeDistance[i]! <= 3 ? "nearEdge" : "open";
    counts[context]![1]++;
    if (mean < DARKENED) {
      darkened++;
      counts[context]![0]++;
    }
  }
  return {
    note: `t3VertCol kind-1 per-vertex values; a cell is darkened when its corner mean < ${DARKENED}. Painted or baked is unverified.`,
    darkenedCellShare: round(darkened / Math.max(1, playable)),
    darkenedShareByContext: Object.fromEntries(Object.entries(counts).map(([k, [d, n]]) => [k, round(d / Math.max(1, n))])),
  };
}

export function measureComposition(map: LoadedMapPackage, grid: TerrainGrid) {
  const { width, height } = map.terrain;
  const [left, bottom, right, top] = map.mapInfo.playableBounds;
  const playable = (right - left) * (top - bottom);
  const neutralUnits = map.objects.units.filter((u) => u.player === 0 || u.player === 15);
  return {
    size: [width, height],
    playableBounds: map.mapInfo.playableBounds,
    playableShare: round(playable / (width * height)),
    vertexColour: map.vertCol
      ? { entries: map.vertCol.entryCount, entriesPerThousandCells: round((map.vertCol.entryCount / (width * height)) * 1000), note: "Entry layout undecoded; count only." }
      : null,
    vertexShading: measureVertexShading(map, grid),
    fluffEntries: map.fluffCount,
    units: {
      count: map.objects.units.length,
      byPlayer: Object.fromEntries(countBy(map.objects.units, (u) => String(u.player))),
      neutralTopTypes: topEntries(countBy(neutralUnits, (u) => u.type), 15),
    },
    points: map.objects.points.length,
  };
}
