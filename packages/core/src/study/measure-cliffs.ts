import type { LoadedMapPackage } from "./load-map-package.js";
import { countBy, quantiles, round, topEntries } from "./stats.js";
import type { TerrainGrid } from "./terrain-grid.js";

// 0-3 per src/terrain/ramps.ts; the diagonal codes are not yet mapped to compass directions.
const RAMP_DIRS = ["south", "north", "west", "east", "diag4", "diag5", "diag6", "diag7"];

export function measureCliffs(map: LoadedMapPackage, grid: TerrainGrid) {
  let playable = 0;
  let edge = 0;
  let ramp = 0;
  const levels = new Map<string, number>();
  for (let i = 0; i < grid.width * grid.height; i++) {
    if (!grid.isPlayable[i]) continue;
    playable++;
    if (grid.isCliffEdge[i]) edge++;
    if (grid.isRamp[i]) ramp++;
    else levels.set(`level${grid.level[i]}`, (levels.get(`level${grid.level[i]}`) ?? 0) + 1);
  }
  const cliffSetUse = countBy(
    map.terrain.cliffCells.filter((cell) => cell.flags !== 0 || cell.cliffSet !== 0),
    (cell) => map.terrain.cliffSets[cell.cliffSet] ?? `#${cell.cliffSet}`,
  );
  return {
    cliffSets: map.terrain.cliffSets,
    cliffSetUse: topEntries(cliffSetUse, 8, map.terrain.cliffCells.length),
    levelShare: Object.fromEntries([...levels].sort().map(([k, v]) => [k, round(v / playable)])),
    distinctLevels: levels.size,
    cliffEdgeCellShare: round(edge / playable),
    rampCellShare: round(ramp / playable),
    ramps: {
      count: map.terrain.ramps.length,
      width: quantiles(map.terrain.ramps.map((r) => r.width)),
      directions: Object.fromEntries(countBy(map.terrain.ramps, (r) => RAMP_DIRS[r.dir] ?? String(r.dir))),
      levelPairs: Object.fromEntries(countBy(map.terrain.ramps, (r) => `${r.lo}->${r.hi}`)),
    },
    cliffDoodads: topEntries(countBy(map.terrain.cliffDoodads, (d) => d.name), 10),
  };
}
