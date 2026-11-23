// Finds Exemplar Maps that share content: for each pair, the one translation that maps the most
// same-type, same-yaw, same-scale doodads of one map onto the other, plus how much terrain agrees
// under that offset. Shared maps are not independent evidence for a Design Lesson.
//
//   npm run build && node packages/core/scripts/exemplar-analysis/overlap.mjs [id ...]   (from the Workspace root)
import { exemplarMapSources, loadWorkspace } from "../../dist/plugins/workspace.js";
import { loadMapPackage } from "../../dist/study/load-map-package.js";
import { buildTerrainGrid } from "../../dist/study/terrain-grid.js";
import { workspaceRoot } from "../workspace-root.mjs";

const only = new Set(process.argv.slice(2));
// The active Style Pack's Exemplar Maps, with source maps from the machine config's exemplarMaps folder.
const exemplars = await exemplarMapSources(await loadWorkspace(workspaceRoot()));

const maps = exemplars
  .filter((e) => !only.size || only.has(e.id))
  .map((e) => {
    const map = loadMapPackage(e.source);
    const grid = buildTerrainGrid(map);
    const key = (d) => `${d.type}|${d.yaw.toFixed(2)}|${d.scale.x.toFixed(2)}`;
    const byKey = new Map();
    for (const d of map.objects.doodads) {
      if (!byKey.has(key(d))) byKey.set(key(d), []);
      byKey.get(key(d)).push(d.position);
    }
    return { id: e.id, grid, count: map.objects.doodads.length, byKey };
  });

function dominant(grid, i) {
  let best = -1;
  let name = "";
  for (let l = 0; l < 8; l++) if (grid.layerShare[i * 8 + l] > best) [best, name] = [grid.layerShare[i * 8 + l], grid.layerTexture[i * 8 + l]];
  return name;
}

const rows = [];
for (let a = 0; a < maps.length; a++) {
  for (let b = a + 1; b < maps.length; b++) {
    const A = maps[a];
    const B = maps[b];
    const votes = new Map();
    for (const [k, pa] of A.byKey) {
      const pb = B.byKey.get(k);
      if (!pb || pa.length * pb.length > 4000) continue;
      for (const p of pa) for (const q of pb) {
        const off = `${Math.round(q.x - p.x)},${Math.round(q.y - p.y)}`;
        votes.set(off, (votes.get(off) ?? 0) + 1);
      }
    }
    const best = [...votes].sort((x, y) => y[1] - x[1])[0];
    if (!best || best[1] < 50) continue;
    const [dx, dy] = best[0].split(",").map(Number);
    let overlap = 0;
    let sameLevel = 0;
    let sameTex = 0;
    for (let y = 0; y < A.grid.height; y++)
      for (let x = 0; x < A.grid.width; x++) {
        const i = y * A.grid.width + x;
        const bx = x + dx;
        const by = y + dy;
        if (!A.grid.isPlayable[i] || bx < 0 || by < 0 || bx >= B.grid.width || by >= B.grid.height) continue;
        const j = by * B.grid.width + bx;
        if (!B.grid.isPlayable[j]) continue;
        overlap++;
        if (A.grid.level[i] === B.grid.level[j]) sameLevel++;
        if (dominant(A.grid, i) === dominant(B.grid, j)) sameTex++;
      }
    rows.push({
      pair: `${A.id} ~ ${B.id}`,
      offset: [dx, dy],
      shared: best[1],
      shareOfA: +(best[1] / A.count).toFixed(3),
      shareOfB: +(best[1] / B.count).toFixed(3),
      sameLevel: overlap ? +(sameLevel / overlap).toFixed(3) : null,
      sameTexture: overlap ? +(sameTex / overlap).toFixed(3) : null,
    });
  }
}
rows.sort((x, y) => y.shared - x.shared);
for (const r of rows) console.log(JSON.stringify(r));
