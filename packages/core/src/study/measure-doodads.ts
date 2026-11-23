import { type Catalog, EMPTY_CATALOG } from "../catalog/catalog-layer.js";
import { getDoodad } from "../catalog/stock-catalog.js";
import type { PlacedDoodad } from "../map/read-objects-xml.js";
import type { LoadedMapPackage } from "./load-map-package.js";
import { countBy, quantiles, round, topEntries } from "./stats.js";
import { cellIndexAt, terrainHeightAt, type TerrainGrid } from "./terrain-grid.js";

/** Doodads within this many cells of each other belong to one cluster. */
const CLUSTER_RADIUS = 2.5;
/** Neighbours within this many cells count as co-occurring. */
const NEIGHBOUR_RADIUS = 3;
const TILT = 0.05;
const NON_UNIFORM = 1.15;
const HEIGHT_SHIFT = 0.5;

export type Manipulation = "tilted" | "nonUniformScale" | "sunk" | "raised" | "tinted" | "extremeScale" | "noFootprint";

export type StudiedDoodad = PlacedDoodad & {
  readonly kind: string;
  /** Height above (or below, negative) the terrain surface at its position. */
  readonly aboveTerrain: number;
  readonly manipulations: readonly Manipulation[];
};

export function classifyManipulations(d: PlacedDoodad, aboveTerrain: number): Manipulation[] {
  const out: Manipulation[] = [];
  const { x, y, z } = d.scale;
  if (Math.abs(d.pitch) > TILT || Math.abs(d.roll) > TILT) out.push("tilted");
  if (Math.max(x, y, z) / Math.max(1e-6, Math.min(x, y, z)) > NON_UNIFORM) out.push("nonUniformScale");
  if (aboveTerrain < -HEIGHT_SHIFT) out.push("sunk");
  if (aboveTerrain > HEIGHT_SHIFT) out.push("raised");
  if (d.tintColor && d.tintColor !== "255,255,255,255") out.push("tinted");
  if (Math.max(x, y, z) >= 2 || Math.max(x, y, z) <= 0.5) out.push("extremeScale");
  if (d.flags.includes("NoDoodadFootprint")) out.push("noFootprint");
  return out;
}

/** Grid-bucketed neighbour search. */
function neighbourIndex(doodads: readonly StudiedDoodad[], radius: number) {
  const buckets = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / radius)},${Math.floor(y / radius)}`;
  doodads.forEach((d, i) => {
    const k = key(d.position.x, d.position.y);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(i);
  });
  return (i: number): number[] => {
    const { x, y } = doodads[i]!.position;
    const bx = Math.floor(x / radius);
    const by = Math.floor(y / radius);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
          if (j === i) continue;
          const p = doodads[j]!.position;
          if ((p.x - x) ** 2 + (p.y - y) ** 2 <= radius * radius) out.push(j);
        }
      }
    }
    return out;
  };
}

function clusters(doodads: readonly StudiedDoodad[]): number[][] {
  const near = neighbourIndex(doodads, CLUSTER_RADIUS);
  const seen = new Uint8Array(doodads.length);
  const out: number[][] = [];
  for (let start = 0; start < doodads.length; start++) {
    if (seen[start]) continue;
    const members = [start];
    seen[start] = 1;
    for (let head = 0; head < members.length; head++) {
      for (const j of near(members[head]!)) {
        if (!seen[j]) {
          seen[j] = 1;
          members.push(j);
        }
      }
    }
    out.push(members);
  }
  return out;
}

const r2 = (v: number) => round(v, 2);

function describeMember(d: StudiedDoodad, cx: number, cy: number) {
  return {
    type: d.type,
    offset: [r2(d.position.x - cx), r2(d.position.y - cy), r2(d.aboveTerrain)],
    yawPitchRoll: [r2(d.yaw), r2(d.pitch), r2(d.roll)],
    scale: [r2(d.scale.x), r2(d.scale.y), r2(d.scale.z)],
    ...(d.tintColor ? { tint: d.tintColor } : {}),
    ...(d.manipulations.length ? { manipulations: d.manipulations } : {}),
  };
}

/** `catalog`: whose doodads it knows; an Exemplar Map uses the game's alone. */
export function studyDoodads(map: LoadedMapPackage, catalog: Catalog = EMPTY_CATALOG): StudiedDoodad[] {
  return map.objects.doodads.map((d) => {
    const aboveTerrain = d.position.z - terrainHeightAt(map, d.position.x, d.position.y);
    return { ...d, kind: getDoodad(catalog, d.type)?.kind ?? "unknown", aboveTerrain, manipulations: classifyManipulations(d, aboveTerrain) };
  });
}

export function measureDoodads(map: LoadedMapPackage, grid: TerrainGrid, doodads: readonly StudiedDoodad[]) {
  const total = doodads.length;
  const [left, bottom, right, top] = map.mapInfo.playableBounds;
  const playableArea = (right - left) * (top - bottom);

  // Density per 8x8 block of the playable area.
  const blocks = new Map<string, number>();
  for (let y = bottom; y < top; y += 8) for (let x = left; x < right; x += 8) blocks.set(`${x / 8 | 0},${y / 8 | 0}`, 0);
  for (const d of doodads) {
    const k = `${(d.position.x / 8) | 0},${(d.position.y / 8) | 0}`;
    if (blocks.has(k)) blocks.set(k, blocks.get(k)! + 1);
  }
  const blockCounts = [...blocks.values()];

  // Placement context.
  const context = countBy(doodads, (d) => {
    const i = cellIndexAt(grid, d.position.x, d.position.y);
    if (!grid.isPlayable[i]) return "outsidePlayable";
    if (grid.isRamp[i]) return "ramp";
    return grid.edgeDistance[i]! <= 1 ? "cliffEdge" : grid.edgeDistance[i]! <= 4 ? "nearEdge" : "open";
  });

  // Co-occurrence of types within NEIGHBOUR_RADIUS.
  const near = neighbourIndex(doodads, NEIGHBOUR_RADIUS);
  const pairs = new Map<string, number>();
  doodads.forEach((d, i) => {
    for (const j of near(i)) {
      if (j < i) continue;
      const other = doodads[j]!;
      if (other.type === d.type) continue;
      const key = [d.type, other.type].sort().join(" + ");
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
  });

  const groups = clusters(doodads);
  const sizes = groups.map((g) => g.length);

  // Composites: clusters holding at least two manipulated doodads.
  const isManipulated = (d: StudiedDoodad) => d.manipulations.some((m) => m !== "noFootprint");
  const composites = groups
    .filter((g) => g.filter((i) => isManipulated(doodads[i]!)).length >= 2)
    .map((g) => {
      const members = g.map((i) => doodads[i]!);
      const cx = members.reduce((a, d) => a + d.position.x, 0) / members.length;
      const cy = members.reduce((a, d) => a + d.position.y, 0) / members.length;
      const xs = members.map((d) => d.position.x);
      const ys = members.map((d) => d.position.y);
      return {
        center: [r2(cx), r2(cy)],
        bounds: [r2(Math.min(...xs)), r2(Math.min(...ys)), r2(Math.max(...xs)), r2(Math.max(...ys))],
        size: members.length,
        manipulated: members.filter(isManipulated).length,
        types: topEntries(countBy(members, (d) => d.type), 6),
        members: members.slice(0, 40).map((d) => describeMember(d, cx, cy)),
      };
    })
    .sort((a, b) => b.manipulated - a.manipulated);

  // Per-type manipulation profile.
  const byType = new Map<string, StudiedDoodad[]>();
  for (const d of doodads) {
    if (!byType.has(d.type)) byType.set(d.type, []);
    byType.get(d.type)!.push(d);
  }
  const typeProfiles = [...byType]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 40)
    .map(([type, list]) => ({
      type,
      kind: list[0]!.kind,
      count: list.length,
      scale: quantiles(list.map((d) => Math.max(d.scale.x, d.scale.y, d.scale.z))),
      aboveTerrain: quantiles(list.map((d) => d.aboveTerrain)),
      tiltedShare: round(list.filter((d) => d.manipulations.includes("tilted")).length / list.length),
      nonUniformShare: round(list.filter((d) => d.manipulations.includes("nonUniformScale")).length / list.length),
      yawSpread: round(new Set(list.map((d) => Math.round((((d.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 8)))).size / 16),
    }));

  const manipulationCounts = new Map<string, number>();
  for (const d of doodads) for (const m of d.manipulations) manipulationCounts.set(m, (manipulationCounts.get(m) ?? 0) + 1);

  // Landmarks: the largest doodads, and types placed exactly once.
  const landmarks = [...doodads]
    .sort((a, b) => Math.max(b.scale.x, b.scale.y, b.scale.z) - Math.max(a.scale.x, a.scale.y, a.scale.z))
    .slice(0, 12)
    .map((d) => ({ type: d.type, position: [r2(d.position.x), r2(d.position.y)], scale: r2(Math.max(d.scale.x, d.scale.y, d.scale.z)) }));
  const singletons = [...byType].filter(([, list]) => list.length === 1).map(([type]) => type);

  return {
    count: total,
    perHundredCells: round((total / Math.max(1, playableArea)) * 100),
    distinctTypes: byType.size,
    kinds: topEntries(countBy(doodads, (d) => d.kind), 12, total),
    topTypes: topEntries(countBy(doodads, (d) => d.type), 25, total),
    blockDensity: { ...quantiles(blockCounts), emptyShare: round(blockCounts.filter((c) => c === 0).length / Math.max(1, blockCounts.length)) },
    placement: topEntries(context, 6, total),
    clusters: { count: groups.length, size: quantiles(sizes), singletonShare: round(sizes.filter((s) => s === 1).length / Math.max(1, sizes.length)) },
    coOccurrence: topEntries(pairs, 30),
    manipulation: {
      note: `tilted: |pitch| or |roll| > ${TILT} rad; nonUniformScale: axis ratio > ${NON_UNIFORM}; sunk/raised: > ${HEIGHT_SHIFT} below/above terrain; extremeScale: >= 2 or <= 0.5.`,
      counts: topEntries(manipulationCounts, 10, total),
      flags: topEntries(countBy(doodads.flatMap((d) => d.flags), (f) => f), 12, total),
      typeProfiles,
    },
    composites: { count: composites.length, top: composites.slice(0, 25) },
    landmarks,
    singletonTypes: singletons.slice(0, 60),
  };
}
