// Measures each Exemplar Map against the ratified Design Lessons (the active Style Pack's LESSONS.md),
// one metric set per lesson, so new exemplars can be checked against the rules they were ratified from.
//
//   npm run build && node packages/core/scripts/exemplar-analysis/lessons.mjs [id ...] > lessons.json   (from the Workspace root)
//
// Definitions follow LESSONS.md and data-analysis.md: "visible" doodads exclude helpers (point lights,
// curtains, blockers, placement markers); the main level is the whole cliff level with the most playable cells.
import { readFileSync } from "node:fs";
import path from "node:path";

import { cliffSetNaming } from "@team-antioch/sc2-asset-catalog/catalog/cliff-catalog.js";

import { exemplarMapSources, loadWorkspace } from "../../dist/plugins/workspace.js";
import { loadMapPackage } from "../../dist/study/load-map-package.js";
import { buildTerrainGrid } from "../../dist/study/terrain-grid.js";
import { studyDoodads } from "../../dist/study/measure-doodads.js";
import { CORE_ROOT, workspaceRoot } from "../workspace-root.mjs";

const textureCatalog = JSON.parse(readFileSync(path.join(CORE_ROOT, "data/texture-extracted.json"), "utf8")).textures;

const HELPER = /^LightOmni|^LightSpot|Curtain|Blocker|PlacementDoodad|^PathingBlocker|^SightBlocker/i;
const NATURAL = new Set(["rock", "tree", "foliage"]);
const BUILT = new Set(["ruin", "other"]);
const BACK = Number(process.env.BACK ?? 2);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

function textureFamily(name) {
  const t = textureCatalog[name]?.tilesets?.[0] ?? name.replace(/\d.*$/, "");
  return t.replace(/Ex\d*$/, "").replace(/Temple$/, "");
}
function cliffFamily(name) {
  return cliffSetNaming(name).family ?? name.replace(/Cliff\d+$/, "");
}

/** Dominant texture per cell (index into the cell's 8 layers resolved to a name). */
function dominantTextures(grid) {
  const n = grid.width * grid.height;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let best = -1;
    let name = "";
    for (let l = 0; l < 8; l++) {
      const s = grid.layerShare[i * 8 + l];
      if (s > best) [best, name] = [s, grid.layerTexture[i * 8 + l]];
    }
    out[i] = name;
  }
  return out;
}

function measure(entry) {
  const map = loadMapPackage(entry.source);
  const grid = buildTerrainGrid(map);
  const { width: W, height: H } = grid;
  const dom = dominantTextures(grid);
  const all = studyDoodads(map);
  const visible = all.filter((d) => !HELPER.test(d.type));
  const at = (d) => Math.min(H - 1, Math.max(0, Math.floor(d.position.y))) * W + Math.min(W - 1, Math.max(0, Math.floor(d.position.x)));

  // Levels.
  const levelCells = new Map();
  let playable = 0;
  for (let i = 0; i < W * H; i++) {
    if (!grid.isPlayable[i] || grid.isRamp[i]) continue;
    playable++;
    levelCells.set(grid.level[i], (levelCells.get(grid.level[i]) ?? 0) + 1);
  }
  const levels = [...levelCells.keys()].sort((a, b) => a - b);
  const main = [...levelCells].sort((a, b) => b[1] - a[1])[0][0];

  // DL-01: top texture per level; doodad density on the lowest level; single-texture frame-sized areas on main.
  const topByLevel = {};
  for (const lv of levels) {
    const counts = new Map();
    for (let i = 0; i < W * H; i++) if (grid.isPlayable[i] && !grid.isRamp[i] && grid.level[i] === lv) counts.set(dom[i], (counts.get(dom[i]) ?? 0) + 1);
    const [name, c] = [...counts].sort((a, b) => b[1] - a[1])[0];
    topByLevel[`L${lv}`] = { texture: name, share: r3(c / levelCells.get(lv)), cellShare: r3(levelCells.get(lv) / playable) };
  }
  const doodadsOnLevel = (lv) => visible.filter((d) => grid.level[at(d)] === lv && grid.isPlayable[at(d)]).length;
  const densityRatio = (lv) => r3(doodadsOnLevel(lv) / visible.length / (levelCells.get(lv) / playable));
  const lowest = levels[0];
  const highest = levels.at(-1);
  let areas = 0;
  let singleAreas = 0;
  const areaDood = { single: [0, 0, 0], mixed: [0, 0, 0] }; // areas, doodads, decals
  const cellArea = new Map();
  for (let y0 = 0; y0 + 12 <= H; y0 += 12) {
    for (let x0 = 0; x0 + 18 <= W; x0 += 18) {
      let onMain = 0;
      const share = new Map();
      for (let y = y0; y < y0 + 12; y++) {
        for (let x = x0; x < x0 + 18; x++) {
          const i = y * W + x;
          cellArea.set(i, `${x0},${y0}`);
          if (!grid.isPlayable[i] || grid.isRamp[i] || grid.level[i] !== main) continue;
          onMain++;
          for (let l = 0; l < 8; l++) {
            const s = grid.layerShare[i * 8 + l];
            if (s > 0) share.set(grid.layerTexture[i * 8 + l], (share.get(grid.layerTexture[i * 8 + l]) ?? 0) + s);
          }
        }
      }
      if (onMain < 0.8 * 216) continue;
      areas++;
      const present = [...share.values()].filter((s) => s / onMain >= 0.005).length;
      const kind = present <= 1 ? "single" : "mixed";
      if (kind === "single") singleAreas++;
      const inArea = visible.filter((d) => {
        const { x, y } = d.position;
        return x >= x0 && x < x0 + 18 && y >= y0 && y < y0 + 12;
      });
      areaDood[kind][0]++;
      areaDood[kind][1] += inArea.filter((d) => d.kind !== "decal").length;
      areaDood[kind][2] += inArea.filter((d) => d.kind === "decal").length;
    }
  }
  const perArea = (k) => (areaDood[k][0] ? [r3(areaDood[k][1] / areaDood[k][0]), r3(areaDood[k][2] / areaDood[k][0])] : null);

  // DL-02: dominant texture two cells back on each side of a cliff, split into crossings down into a pit
  // (low side below main) and up onto a height (high side above main).
  const cross = { down: [0, 0], up: [0, 0], other: [0, 0] };
  for (let y = 2; y < H - 3; y++) {
    for (let x = 2; x < W - 3; x++) {
      const i = y * W + x;
      if (!grid.isPlayable[i] || grid.isRamp[i]) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const j = (y + dy) * W + (x + dx);
        if (grid.isRamp[j] || grid.level[j] === grid.level[i]) continue;
        const a = (y - BACK * dy) * W + (x - BACK * dx); // BACK cells behind each edge cell
        const b = (y + (1 + BACK) * dy) * W + (x + (1 + BACK) * dx);
        if (a < 0 || b >= W * H) continue;
        const lo = Math.min(grid.level[i], grid.level[j]);
        const hi = Math.max(grid.level[i], grid.level[j]);
        const k = lo < main ? "down" : hi > main ? "up" : "other";
        cross[k][0]++;
        if (dom[a] !== dom[b]) cross[k][1]++;
      }
    }
  }
  const crossShare = (k) => (cross[k][0] ? r3(cross[k][1] / cross[k][0]) : null);

  // DL-03: blended cells (2+ textures at >= 10%) near a dominant-texture border; single-texture cells.
  let blended = 0;
  let blendedNear = 0;
  let single = 0;
  let cells = 0;
  const border = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) if (nx < W && ny < H && dom[ny * W + nx] !== dom[i]) border[i] = border[ny * W + nx] = 1;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!grid.isPlayable[i]) continue;
      cells++;
      let present = 0;
      for (let l = 0; l < 8; l++) if (grid.layerShare[i * 8 + l] >= 0.1) present++;
      if (present <= 1) single++;
      else {
        blended++;
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++)
          for (let dx = -2; dx <= 2 && !near; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && border[ny * W + nx]) near = true;
          }
        if (near) blendedNear++;
      }
    }

  // DL-04: real cliff cells (flags = 1) by set and family.
  const realCliffs = map.terrain.cliffCells.filter((c) => c.flags === 1);
  const bySet = new Map();
  for (const c of realCliffs) {
    const name = map.terrain.cliffSets[c.cliffSet] ?? `#${c.cliffSet}`;
    bySet.set(name, (bySet.get(name) ?? 0) + 1);
  }
  const byFamily = new Map();
  for (const [name, c] of bySet) byFamily.set(cliffFamily(name), (byFamily.get(cliffFamily(name)) ?? 0) + c);
  const famList = [...byFamily].sort((a, b) => b[1] - a[1]);

  // DL-05: visible doodads within one cell of a cliff edge, against the share of playable cells that are.
  let nearCells = 0;
  for (let i = 0; i < W * H; i++) if (grid.isPlayable[i] && !grid.isRamp[i] && grid.edgeDistance[i] <= 1) nearCells++;
  const onPlay = visible.filter((d) => grid.isPlayable[at(d)]);
  const nearDood = onPlay.filter((d) => grid.edgeDistance[at(d)] <= 1).length;
  const cliffModel = /Cliff|GapFiller|RockTower|Glacier/;
  const cliffModels = onPlay.filter((d) => cliffModel.test(d.type));

  // DL-06: 8x8 blocks over the playable area: empty share against Poisson expectation; densest tenth's share.
  const [bl, bb, br, bt] = map.mapInfo.playableBounds;
  const blocks = [];
  for (let y0 = bb; y0 + 8 <= bt; y0 += 8)
    for (let x0 = bl; x0 + 8 <= br; x0 += 8) blocks.push(onPlay.filter((d) => d.position.x >= x0 && d.position.x < x0 + 8 && d.position.y >= y0 && d.position.y < y0 + 8).length);
  const mean = blocks.reduce((a, b) => a + b, 0) / blocks.length;
  const sorted = [...blocks].sort((a, b) => b - a);
  const top10 = sorted.slice(0, Math.max(1, Math.round(blocks.length / 10))).reduce((a, b) => a + b, 0);

  // DL-07: manipulation shares among visible doodads.
  const manip = (m) => r3(visible.filter((d) => d.manipulations.includes(m)).length / visible.length);

  // DL-08: pair lift against a permutation baseline (types shuffled among the same positions), story props only.
  const story = visible.filter((d) => d.kind !== "decal" || true);
  const pairs = pairLift(story, 3, 30);

  // DL-09, DL-12, DL-13: from the study and the doodads.
  const study = JSON.parse(readFileSync(path.join(entry.studyDir, "study.json"), "utf8"));
  const blends = study.lighting.calls.map((c) => c.blendSeconds);
  const omni = all.filter((d) => /^LightOmni/.test(d.type));

  // DL-11: share of yaws on a 45-degree step, by kind; natural-prop scale.
  const snapped = (list) => (list.length ? r3(list.filter((d) => isSnapped(d.yaw ?? d.rotation ?? 0)).length / list.length) : null);
  const natural = visible.filter((d) => NATURAL.has(d.kind));
  const scales = natural.map((d) => d.scale.x).sort((a, b) => a - b);

  // DL-14: texture families covering >= 5% of the ground.
  const famCover = new Map();
  let coverTotal = 0;
  for (let i = 0; i < W * H; i++) {
    if (!grid.isPlayable[i]) continue;
    for (let l = 0; l < 8; l++) {
      const s = grid.layerShare[i * 8 + l];
      if (!s) continue;
      const f = textureFamily(grid.layerTexture[i * 8 + l]);
      famCover.set(f, (famCover.get(f) ?? 0) + s);
      coverTotal += s;
    }
  }
  const families = [...famCover].map(([f, c]) => [f, r3(c / coverTotal)]).sort((a, b) => b[1] - a[1]);

  return {
    id: entry.id,
    provenance: entry.provenance,
    size: [W, H],
    playableCells: playable,
    mainLevel: main,
    dl01: {
      topByLevel,
      lowestDensityRatio: lowest === main ? null : densityRatio(lowest),
      highestDensityRatio: highest === main ? null : densityRatio(highest),
      frameAreasOnMain: areas,
      singleTextureAreaShare: areas ? r3(singleAreas / areas) : null,
      perAreaSingle: perArea("single"),
      perAreaMixed: perArea("mixed"),
    },
    dl02: { downIntoPit: crossShare("down"), upOntoHeight: crossShare("up"), betweenOthers: crossShare("other"), crossings: cross },
    dl03: { blendedNearBorder: r3(blendedNear / Math.max(1, blended)), singleTextureCellShare: r3(single / cells) },
    dl04: { sets: Object.fromEntries([...bySet].sort((a, b) => b[1] - a[1])), families: famList.length, topFamilyShare: famList.length ? r3(famList[0][1] / realCliffs.length) : null },
    dl05: {
      nearCliffLift: r3(nearDood / onPlay.length / (nearCells / playable)),
      cliffModelShare: r3(cliffModels.length / Math.max(1, onPlay.length)),
      cliffModelsNearCliff: cliffModels.length ? r3(cliffModels.filter((d) => grid.edgeDistance[at(d)] <= 1).length / cliffModels.length) : null,
    },
    dl06: {
      visibleDoodads: visible.length,
      perHundredCells: r3((onPlay.length / playable) * 100),
      emptyBlockShare: r3(blocks.filter((b) => b === 0).length / blocks.length),
      emptyExpected: r3(Math.exp(-mean)),
      densestTenthShare: r3(top10 / Math.max(1, onPlay.length)),
    },
    dl07: { tilted: manip("tilted"), nonUniformScale: manip("nonUniformScale"), raised: manip("raised"), sunk: manip("sunk"), tinted: manip("tinted"), noFootprint: manip("noFootprint") },
    dl08: { topPairs: pairs.slice(0, 8) },
    dl09: { lights: study.lighting.lightsUsed, calls: blends.length, instant: blends.filter((b) => b === 0).length, longestBlend: blends.length ? Math.max(...blends) : null },
    dl11: { snappedNatural: snapped(natural), snappedBuilt: snapped(visible.filter((d) => BUILT.has(d.kind))), snappedDecal: snapped(visible.filter((d) => d.kind === "decal")), naturalScaleAtOne: natural.length ? r3(natural.filter((d) => Math.abs(d.scale.x - 1) < 0.01).length / natural.length) : null, naturalScaleP10P90: scales.length ? [r3(scales[Math.floor(scales.length * 0.1)]), r3(scales[Math.floor(scales.length * 0.9)])] : null },
    dl12: { pointLights: omni.length, pointLightShare: r3(omni.length / all.length) },
    dl13: { waterBodies: study.lighting.waterBodies },
    dl14: { families: families.filter(([, s]) => s >= 0.01), familiesOver5: families.filter(([, s]) => s >= 0.05).length, outsideDominant: r3(1 - (families[0]?.[1] ?? 0)) },
  };
}

function isSnapped(yaw) {
  const deg = (((yaw * 180) / Math.PI) % 45 + 45) % 45;
  return deg < 1 || deg > 44;
}

/** Pairs of types co-occurring within `radius`, as a multiple of the count with types shuffled. */
function pairLift(doodads, radius, runs) {
  const pos = doodads.map((d) => [d.position.x, d.position.y]);
  const neighbours = pos.map(() => []);
  const buckets = new Map();
  pos.forEach(([x, y], i) => {
    const k = `${Math.floor(x / radius)},${Math.floor(y / radius)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  });
  pos.forEach(([x, y], i) => {
    const bx = Math.floor(x / radius);
    const by = Math.floor(y / radius);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of buckets.get(`${bx + dx},${by + dy}`) ?? []) if (j > i && (pos[j][0] - x) ** 2 + (pos[j][1] - y) ** 2 <= radius * radius) neighbours[i].push(j);
  });
  const count = (types) => {
    const m = new Map();
    neighbours.forEach((list, i) => {
      for (const j of list) {
        if (types[i] === types[j]) continue;
        const k = types[i] < types[j] ? `${types[i]} + ${types[j]}` : `${types[j]} + ${types[i]}`;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    });
    return m;
  };
  const types = doodads.map((d) => d.type);
  const observed = count(types);
  const baseline = new Map();
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < runs; r++) {
    const shuffled = [...types];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (const [k, v] of count(shuffled)) baseline.set(k, (baseline.get(k) ?? 0) + v / runs);
  }
  return [...observed]
    .filter(([, v]) => v >= 8)
    .map(([k, v]) => ({ pair: k, count: v, lift: r3(v / Math.max(0.5, baseline.get(k) ?? 0)) }))
    .sort((a, b) => b.lift - a.lift);
}

const only = new Set(process.argv.slice(2));
// The active Style Pack's Exemplar Maps, with source maps from the machine config's exemplarMaps folder.
const exemplars = await exemplarMapSources(await loadWorkspace(workspaceRoot()));
const out = [];
for (const e of exemplars) {
  if (only.size && !only.has(e.id)) continue;
  out.push(measure(e));
  process.stderr.write(`${e.id} `);
}
process.stderr.write("\n");
console.log(JSON.stringify(out, null, 1));
