// Measures each Exemplar Map against the ratified Design Lessons (the active Style Pack's LESSONS.md),
// one metric set per lesson, so new exemplars can be checked against the rules they were ratified from.
//
//   npm run build && node packages/core/scripts/exemplar-analysis/lessons.mjs [id ...] > lessons.json   (from the Workspace root)
//
// The Antioch pack's lessons on top of core's lesson-neutral measures (src/study/measures.ts), which
// define "visible" doodads, the main level and the measures it shares with every pack; the cliff-set,
// set-piece, manipulation and pair metrics here are this pack's own.
import { readFileSync } from "node:fs";
import path from "node:path";

import { cliffSetNaming } from "@team-antioch/sc2-asset-catalog/catalog/cliff-catalog.js";

import { exemplarMapSources, loadWorkspace } from "../../dist/plugins/workspace.js";
import { loadMapPackage } from "../../dist/study/load-map-package.js";
import {
  blendPlacement,
  cliffCrossings,
  doodadDensityRatio,
  frameAreaTexturing,
  isPointLight,
  measureInput,
  propsOfKind,
  snappedShare,
  topTextureByLevel,
  visibleOnPlayable,
} from "../../dist/study/measures.js";
import { cellIndexAt } from "../../dist/study/terrain-grid.js";
import { CORE_ROOT, workspaceRoot } from "../workspace-root.mjs";

const textureCatalog = JSON.parse(readFileSync(path.join(CORE_ROOT, "data/texture-extracted.json"), "utf8")).textures;

const BACK = Number(process.env.BACK ?? 2);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

function textureFamily(name) {
  const t = textureCatalog[name]?.tilesets?.[0] ?? name.replace(/\d.*$/, "");
  return t.replace(/Ex\d*$/, "").replace(/Temple$/, "");
}
function cliffFamily(name) {
  return cliffSetNaming(name).family ?? name.replace(/Cliff\d+$/, "");
}

function measure(entry) {
  const map = loadMapPackage(entry.source);
  const input = measureInput(map);
  const { grid, visible, levels, playable, main } = input;
  const all = input.doodads;
  const { width: W, height: H } = grid;
  const at = (d) => cellIndexAt(grid, d.position.x, d.position.y);

  // DL-01: top texture per level; doodad density on the lowest level; single-texture frame-sized areas on main.
  const topByLevel = {};
  for (const t of topTextureByLevel(input)) topByLevel[`L${t.level}`] = { texture: t.texture, share: r3(t.share), cellShare: r3(t.cellShare) };
  const densityRatio = (lv) => r3(doodadDensityRatio(input, lv));
  const lowest = levels[0];
  const highest = levels.at(-1);
  const frames = frameAreaTexturing(input);
  const perArea = (k) => (frames.doodads[k][0] ? [r3(frames.doodads[k][1] / frames.doodads[k][0]), r3(frames.doodads[k][2] / frames.doodads[k][0])] : null);

  // DL-02: dominant texture BACK cells back on each side of a cliff, split into crossings down into a pit
  // (low side below main) and up onto a height (high side above main).
  const cross = cliffCrossings(input, BACK);
  const crossShare = (k) => (cross[k][0] ? r3(cross[k][1] / cross[k][0]) : null);

  // DL-03: blended cells (2+ textures at >= 10%) near a dominant-texture border; single-texture cells.
  const blend = blendPlacement(input);

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
  const onPlay = visibleOnPlayable(input);
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
  const pairs = pairLift(visible, 3, 30);

  // DL-09, DL-12, DL-13: from the study and the doodads.
  const study = JSON.parse(readFileSync(path.join(entry.studyDir, "study.json"), "utf8"));
  const blends = study.lighting.calls.map((c) => c.blendSeconds);
  const omni = all.filter((d) => isPointLight(d.type));

  // DL-11: share of yaws on a 45-degree step, by kind; natural-prop scale.
  const snapped = (list) => r3(snappedShare(list));
  const natural = propsOfKind(input, "natural");
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
      frameAreasOnMain: frames.areas,
      singleTextureAreaShare: frames.areas ? r3(frames.singleTexture / frames.areas) : null,
      perAreaSingle: perArea("single"),
      perAreaMixed: perArea("mixed"),
    },
    dl02: { downIntoPit: crossShare("down"), upOntoHeight: crossShare("up"), betweenOthers: crossShare("other"), crossings: cross },
    dl03: { blendedNearBorder: r3(blend.blendedNearBorder / Math.max(1, blend.blended)), singleTextureCellShare: r3(blend.singleTexture / blend.cells) },
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
    dl11: { snappedNatural: snapped(natural), snappedBuilt: snapped(propsOfKind(input, "built")), snappedDecal: snapped(propsOfKind(input, "decal")), naturalScaleAtOne: natural.length ? r3(natural.filter((d) => Math.abs(d.scale.x - 1) < 0.01).length / natural.length) : null, naturalScaleP10P90: scales.length ? [r3(scales[Math.floor(scales.length * 0.1)]), r3(scales[Math.floor(scales.length * 0.9)])] : null },
    dl12: { pointLights: omni.length, pointLightShare: r3(omni.length / all.length) },
    dl13: { waterBodies: study.lighting.waterBodies },
    dl14: { families: families.filter(([, s]) => s >= 0.01), familiesOver5: families.filter(([, s]) => s >= 0.05).length, outsideDominant: r3(1 - (families[0]?.[1] ?? 0)) },
  };
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
