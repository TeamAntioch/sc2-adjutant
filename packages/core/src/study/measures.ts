// Lesson-neutral measures of a map's look: numbers any Style Pack's maps can be compared on, named by
// what they measure and carrying no rule or threshold of any pack's. The Antioch pack's lessons
// script reads them for its Design Lessons, the Blizzard baseline (data/blizzard-baseline.json)
// holds them for every campaign mission, and a pack's consistency report compares the two.
//
// Definitions: "visible" doodads leave out helpers (point and spot lights, curtains, blockers,
// placement markers). The main level is the whole cliff level with the most playable cells, ramps
// left out. A level's cells are its playable, non-ramp cells.

import { type Catalog, EMPTY_CATALOG } from "../catalog/catalog-layer.js";
import { getTilesetSky, SKY_TAGS, type TilesetSky } from "../catalog/tileset-sky.js";
import { xmlElement, xmlElements } from "../map/xml-elements.js";
import type { LoadedMapPackage } from "./load-map-package.js";
import { type StudiedDoodad, studyDoodads } from "./measure-doodads.js";
import { lightingCalls } from "./measure-lighting.js";
import { round } from "./stats.js";
import { buildTerrainGrid, cellIndexAt, type TerrainGrid } from "./terrain-grid.js";

const HELPER = /^LightOmni|^LightSpot|Curtain|Blocker|PlacementDoodad|^PathingBlocker|^SightBlocker/i;

/** Whether a doodad type is a helper a player doesn't see as dressing: a light, curtain, blocker or marker. */
export const isHelperDoodad = (type: string): boolean => HELPER.test(type);

/** The facts every measure reads, worked out once per map. */
export type MeasureInput = {
  readonly map: LoadedMapPackage;
  readonly grid: TerrainGrid;
  /** Every doodad, helpers included. */
  readonly doodads: readonly StudiedDoodad[];
  /** The doodads that aren't helpers. */
  readonly visible: readonly StudiedDoodad[];
  /** The texture with the largest share of each cell. */
  readonly dominant: readonly string[];
  /** The whole cliff levels with playable, non-ramp cells, lowest first. */
  readonly levels: readonly number[];
  /** Playable, non-ramp cells per level. */
  readonly levelCells: ReadonlyMap<number, number>;
  /** Playable, non-ramp cells in all. */
  readonly playable: number;
  readonly main: number;
};

/** `catalog`: whose doodads it knows, for their kinds; a map studied alone uses the game's. */
export function measureInput(map: LoadedMapPackage, catalog: Catalog = EMPTY_CATALOG): MeasureInput {
  const grid = buildTerrainGrid(map);
  const doodads = studyDoodads(map, catalog);
  const levelCells = new Map<number, number>();
  let playable = 0;
  for (let i = 0; i < grid.width * grid.height; i++) {
    if (!grid.isPlayable[i] || grid.isRamp[i]) continue;
    playable++;
    levelCells.set(grid.level[i]!, (levelCells.get(grid.level[i]!) ?? 0) + 1);
  }
  if (!playable) throw new Error(`${map.dir}: no playable ground to measure`);
  const levels = [...levelCells.keys()].sort((a, b) => a - b);
  const main = [...levelCells].sort((a, b) => b[1] - a[1])[0]![0];
  return { map, grid, doodads, visible: doodads.filter((d) => !isHelperDoodad(d.type)), dominant: dominantTextures(grid), levels, levelCells, playable, main };
}

/** The texture with the largest share of each cell (the first layer on a tie). */
export function dominantTextures(grid: TerrainGrid): string[] {
  const n = grid.width * grid.height;
  const out: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let best = -1;
    let name = "";
    for (let l = 0; l < 8; l++) {
      const s = grid.layerShare[i * 8 + l]!;
      if (s > best) [best, name] = [s, grid.layerTexture[i * 8 + l]!];
    }
    out[i] = name;
  }
  return out;
}

const cellOf = (input: MeasureInput, d: StudiedDoodad) => cellIndexAt(input.grid, d.position.x, d.position.y);

/** Each level's top texture by dominant cells, its share of the level, and the level's share of the playable ground. */
export function topTextureByLevel(input: MeasureInput): { level: number; texture: string; share: number; cellShare: number }[] {
  const { grid, dominant, levelCells, playable } = input;
  return input.levels.map((level) => {
    const counts = new Map<string, number>();
    for (let i = 0; i < grid.width * grid.height; i++) {
      if (grid.isPlayable[i] && !grid.isRamp[i] && grid.level[i] === level) counts.set(dominant[i]!, (counts.get(dominant[i]!) ?? 0) + 1);
    }
    const [texture, count] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
    return { level, texture, share: count / levelCells.get(level)!, cellShare: levelCells.get(level)! / playable };
  });
}

/** The visible doodads standing on playable ground. */
export function visibleOnPlayable(input: MeasureInput): StudiedDoodad[] {
  return input.visible.filter((d) => input.grid.isPlayable[cellOf(input, d)]);
}

/**
 * A level's share of the visible doodads against its share of the ground: 1 is as dense as the
 * map, below 1 sparser. NaN on a map with no visible doodads.
 */
export function doodadDensityRatio(input: MeasureInput, level: number): number {
  const { grid, visible, levelCells, playable } = input;
  const onLevel = visible.filter((d) => grid.level[cellOf(input, d)] === level && grid.isPlayable[cellOf(input, d)]).length;
  return onLevel / visible.length / (levelCells.get(level)! / playable);
}

/** An area the size of one capture frame, in cells. */
export const FRAME_AREA = { width: 18, height: 12 } as const;

/** Frame-sized areas on the main level, by how many textures they hold, with the doodads in each kind. */
export type FrameAreaTexturing = {
  /** Areas at least 80% on the main level's playable, non-ramp cells. */
  readonly areas: number;
  /** Those holding one texture. */
  readonly singleTexture: number;
  /** Per kind of area: [areas, non-decal visible doodads, decals]. */
  readonly doodads: { readonly single: [number, number, number]; readonly mixed: [number, number, number] };
};

/**
 * Tiles the map with frame-sized areas from its south-west corner, keeps those mostly on the main
 * level, and counts a texture as in an area once it gives 0.5% of the area's main-level cells.
 */
export function frameAreaTexturing(input: MeasureInput): FrameAreaTexturing {
  const { grid, main, visible } = input;
  const { width: W, height: H } = grid;
  const { width: FW, height: FH } = FRAME_AREA;
  let areas = 0;
  let singleTexture = 0;
  const doodads: FrameAreaTexturing["doodads"] = { single: [0, 0, 0], mixed: [0, 0, 0] };
  for (let y0 = 0; y0 + FH <= H; y0 += FH) {
    for (let x0 = 0; x0 + FW <= W; x0 += FW) {
      let onMain = 0;
      const share = new Map<string, number>();
      for (let y = y0; y < y0 + FH; y++) {
        for (let x = x0; x < x0 + FW; x++) {
          const i = y * W + x;
          if (!grid.isPlayable[i] || grid.isRamp[i] || grid.level[i] !== main) continue;
          onMain++;
          for (let l = 0; l < 8; l++) {
            const s = grid.layerShare[i * 8 + l]!;
            if (s > 0) share.set(grid.layerTexture[i * 8 + l]!, (share.get(grid.layerTexture[i * 8 + l]!) ?? 0) + s);
          }
        }
      }
      if (onMain < 0.8 * FW * FH) continue;
      areas++;
      const present = [...share.values()].filter((s) => s / onMain >= 0.005).length;
      const kind = present <= 1 ? "single" : "mixed";
      if (kind === "single") singleTexture++;
      const inArea = visible.filter(({ position: { x, y } }) => x >= x0 && x < x0 + FW && y >= y0 && y < y0 + FH);
      doodads[kind][0]++;
      doodads[kind][1] += inArea.filter((d) => d.kind !== "decal").length;
      doodads[kind][2] += inArea.filter((d) => d.kind === "decal").length;
    }
  }
  return { areas, singleTexture, doodads };
}

/** A layer counts as in a cell's blend once it gives this share of the cell. */
const BLEND_PRESENT = 0.1;

/** Playable cells by how many textures they blend, and where the blended ones sit. */
export type BlendPlacement = {
  readonly cells: number;
  /** Cells with one texture at 10% or more. */
  readonly singleTexture: number;
  /** Cells with two or more. */
  readonly blended: number;
  /** Blended cells within 2 cells (either way, diagonals too) of a border between dominant textures. */
  readonly blendedNearBorder: number;
  /** Cell sides between two playable cells of different dominant textures. */
  readonly borderEdges: number;
};

export function blendPlacement(input: MeasureInput): BlendPlacement {
  const { grid, dominant } = input;
  const { width: W, height: H } = grid;
  const border = new Uint8Array(W * H);
  let borderEdges = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]] as const) {
        if (nx >= W || ny >= H || dominant[ny * W + nx] === dominant[i]) continue;
        border[i] = border[ny * W + nx] = 1;
        if (grid.isPlayable[i] && grid.isPlayable[ny * W + nx]) borderEdges++;
      }
    }
  }
  let cells = 0;
  let singleTexture = 0;
  let blended = 0;
  let blendedNearBorder = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!grid.isPlayable[i]) continue;
      cells++;
      let present = 0;
      for (let l = 0; l < 8; l++) if (grid.layerShare[i * 8 + l]! >= BLEND_PRESENT) present++;
      if (present <= 1) {
        singleTexture++;
        continue;
      }
      blended++;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) {
        for (let dx = -2; dx <= 2 && !near; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && border[ny * W + nx]) near = true;
        }
      }
      if (near) blendedNearBorder++;
    }
  }
  return { cells, singleTexture, blended, blendedNearBorder, borderEdges };
}

/** Doodad kinds a yaw-snapping measure groups: natural props, built props and decals. */
export const PROP_KINDS = { natural: ["rock", "tree", "foliage"], built: ["ruin", "other"], decal: ["decal"] } as const;

/** Whether a yaw (radians) sits within a degree of a 45-degree step. */
export function isSnappedYaw(yaw: number): boolean {
  const deg = ((((yaw * 180) / Math.PI) % 45) + 45) % 45;
  return deg < 1 || deg > 44;
}

/** The share of `doodads` on a 45-degree step; null when there are none. */
export function snappedShare(doodads: readonly StudiedDoodad[]): number | null {
  return doodads.length ? doodads.filter((d) => isSnappedYaw(d.yaw)).length / doodads.length : null;
}

/** The visible doodads of one group of PROP_KINDS. */
export function propsOfKind(input: MeasureInput, group: keyof typeof PROP_KINDS): StudiedDoodad[] {
  const kinds: readonly string[] = PROP_KINDS[group];
  return input.visible.filter((d) => kinds.includes(d.kind));
}

/**
 * A sky field of the map's tileset: from its CTerrain in the map's TerrainData.xml and that
 * entry's parents there, the first that sets it; else the stock tileset's (data/tileset-sky.json)
 * the chain ends on, or the map's tileset id's own stock entry, which the map may override.
 */
function tilesetSkyField(map: LoadedMapPackage, field: keyof TilesetSky): string | undefined {
  const tag = SKY_TAGS.find(([, f]) => f === field)![0];
  const local = new Map(xmlElements(map.terrainData, "CTerrain").map((t) => [t.attrs.id, t]));
  const seen = new Set<string>();
  let id = map.terrain.tilesetId;
  for (let entry = local.get(id); entry && !seen.has(id); entry = local.get(id)) {
    seen.add(id);
    const set = xmlElement(entry.body, tag)?.attrs.value;
    if (set !== undefined) return set;
    if (!entry.attrs.parent) break;
    id = entry.attrs.parent;
  }
  return getTilesetSky(EMPTY_CATALOG, id)?.[field] ?? getTilesetSky(EMPTY_CATALOG, map.terrain.tilesetId)?.[field];
}

/** The ground below the main level, and what covers it. */
export type Backdrop = {
  /** Playable, non-ramp cells below the main level. */
  readonly cells: number;
  /** Those under a t3Water area. */
  readonly underWater: number;
  /** Those on level 0 of a map that hides its lowest level, showing the sky. */
  readonly underSky: number;
  /** Those under either. */
  readonly covered: number;
  readonly hidesLowestLevel: boolean;
  /** The tileset's fog density; 0 when its fog is switched off, undefined when nothing sets it. */
  readonly fogDensity: number | undefined;
};

export function backdrop(input: MeasureInput): Backdrop {
  const { grid, main, map } = input;
  const hidesLowestLevel = tilesetSkyField(map, "hideLowestLevel") === "1";
  const fogEnabled = tilesetSkyField(map, "fogEnabled");
  const density = tilesetSkyField(map, "fogDensity");
  let cells = 0;
  let underWater = 0;
  let underSky = 0;
  let covered = 0;
  for (let i = 0; i < grid.width * grid.height; i++) {
    if (!grid.isPlayable[i] || grid.isRamp[i] || grid.level[i]! >= main) continue;
    cells++;
    const x = (i % grid.width) + 0.5;
    const y = Math.floor(i / grid.width) + 0.5;
    const water = map.waterAreas.some(({ rect: [x0, y0, x1, y1] }) => x >= x0 && x < x1 && y >= y0 && y < y1);
    const sky = hidesLowestLevel && grid.level[i] === 0;
    if (water) underWater++;
    if (sky) underSky++;
    if (water || sky) covered++;
  }
  const fogDensity = fogEnabled === "0" ? 0 : density !== undefined && Number.isFinite(Number(density)) ? Number(density) : undefined;
  return { cells, underWater, underSky, covered, hidesLowestLevel, fogDensity };
}

/** Whether a doodad type is a point light (an omni light doodad). */
export const isPointLight = (type: string): boolean => /^LightOmni/.test(type);

/** The lighting changes the map's triggers make (GameSetLighting in MapScript.galaxy), and its point lights. */
export type LightingChanges = {
  readonly lights: readonly string[];
  readonly changes: number;
  /** Changes with a blend time of 0. */
  readonly instant: number;
  /** The longest blend time given as a number; undefined with none. */
  readonly longestBlendSeconds: number | undefined;
  readonly pointLights: number;
};

export function lightingChanges(input: MeasureInput): LightingChanges {
  const calls = lightingCalls(input.map.mapScript);
  const blends = calls.map((c) => c.blendSeconds).filter((b): b is number => typeof b === "number");
  return {
    lights: [...new Set(calls.map((c) => c.light))],
    changes: calls.length,
    instant: blends.filter((b) => b === 0).length,
    longestBlendSeconds: blends.length ? Math.max(...blends) : undefined,
    pointLights: input.doodads.filter((d) => isPointLight(d.type)).length,
  };
}

/** Cliff crossings counted, and those whose dominant texture differs on the two sides: [crossings, changed]. */
export type CliffCrossings = { readonly down: [number, number]; readonly up: [number, number]; readonly other: [number, number] };

/**
 * Every 4-neighbour step between two whole levels, with whether the dominant texture differs
 * `back` cells behind the edge on each side. Split into crossings down into a pit (the low side
 * below the main level), up onto a height (the high side above it) and the others. Edges in the
 * map's outer two cells (three on the north and east) are left out, and so is a crossing whose
 * sample cells fall off the map. The measures sample 2 cells back; the Antioch pack's lessons
 * script lets its maintainer try others.
 */
export function cliffCrossings(input: MeasureInput, back = 2): CliffCrossings {
  const { grid, dominant, main } = input;
  const { width: W, height: H } = grid;
  const cross: CliffCrossings = { down: [0, 0], up: [0, 0], other: [0, 0] };
  for (let y = 2; y < H - 3; y++) {
    for (let x = 2; x < W - 3; x++) {
      const i = y * W + x;
      if (!grid.isPlayable[i] || grid.isRamp[i]) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const j = (y + dy) * W + (x + dx);
        if (grid.isRamp[j] || grid.level[j] === grid.level[i]) continue;
        const [ax, ay] = [x - back * dx, y - back * dy];
        const [bx, by] = [x + (1 + back) * dx, y + (1 + back) * dy];
        if (ax < 0 || ay < 0 || bx >= W || by >= H) continue;
        const a = ay * W + ax;
        const b = by * W + bx;
        const lo = Math.min(grid.level[i]!, grid.level[j]!);
        const hi = Math.max(grid.level[i]!, grid.level[j]!);
        const k = lo < main ? "down" : hi > main ? "up" : "other";
        cross[k][0]++;
        if (dominant[a] !== dominant[b]) cross[k][1]++;
      }
    }
  }
  return cross;
}

/** What a lesson-neutral measure measures, for a report to say. */
export type MeasureDefinition = { readonly id: string; readonly description: string };

/** Every measure `measureMap` gives, in the order a report lists them. */
export const MEASURES = [
  { id: "topTextureShare.lowestLevel", description: "share of the lowest level's cells whose dominant texture is its top texture; none when the lowest level is the main level" },
  { id: "topTextureShare.mainLevel", description: "share of the main level's cells whose dominant texture is its top texture" },
  { id: "topTextureShare.highestLevel", description: "share of the highest level's cells whose dominant texture is its top texture; none when the highest level is the main level" },
  { id: "cliffTextureChange.downIntoPit", description: "share of cliff crossings down into a pit (below the main level) whose dominant texture differs 2 cells back on each side" },
  { id: "cliffTextureChange.upOntoHeight", description: "share of cliff crossings up onto a height (above the main level) whose dominant texture differs 2 cells back on each side" },
  { id: "doodadDensity.lowestLevel", description: "the lowest level's share of the visible doodads over its share of the ground (1 = as dense as the map); none when the lowest level is the main level" },
  { id: "doodadDensity.mainLevel", description: "the main level's share of the visible doodads over its share of the ground (1 = as dense as the map)" },
  { id: "doodadDensity.highestLevel", description: "the highest level's share of the visible doodads over its share of the ground (1 = as dense as the map); none when the highest level is the main level" },
  { id: "doodadDensity.perHundredCells", description: "visible doodads on playable ground per 100 playable, non-ramp cells" },
  { id: "frameAreas.singleTextureShare", description: "share of frame-sized areas (18x12 cells) on the main level holding one texture, a texture counting from 0.5% of an area" },
  { id: "blend.nearBorderShare", description: "share of blended cells (two or more textures each giving 10%) within 2 cells of a border between dominant textures" },
  { id: "blend.width", description: "blended cells within 2 cells of a border, per cell side of border between dominant textures on playable ground: roughly the blend band's mean width in cells, from thin seams (near 0) to wide soft blends (at most about 5)" },
  { id: "blend.singleTextureCellShare", description: "share of playable cells with only one texture giving 10% or more" },
  { id: "yawSnapping.natural", description: "share of visible natural props (rocks, trees, foliage) turned to within a degree of a 45-degree step" },
  { id: "yawSnapping.built", description: "share of visible built props (ruins and other structures) turned to within a degree of a 45-degree step" },
  { id: "yawSnapping.decal", description: "share of visible decals turned to within a degree of a 45-degree step" },
  { id: "backdrop.share", description: "share of the playable, non-ramp ground below the main level (the backdrop: pits, abyss floors, void)" },
  { id: "backdrop.waterShare", description: "share of the backdrop under a water or lava area" },
  { id: "backdrop.skyShare", description: "share of the backdrop on a hidden lowest level, showing the sky" },
  { id: "backdrop.coveredShare", description: "share of the backdrop under water or lava or showing the sky" },
  { id: "backdrop.fogDensity", description: "the map's tileset fog density, its own CTerrain's where it sets one; 0 with fog off" },
  { id: "lighting.lightsSet", description: "distinct lights the map's triggers set (GameSetLighting)" },
  { id: "lighting.changes", description: "GameSetLighting calls in the map's triggers" },
  { id: "lighting.instantShare", description: "share of the triggers' lighting changes that cut at once (a blend time of 0)" },
  { id: "lighting.longestBlendSeconds", description: "the longest blend time of a trigger's lighting change, in seconds" },
  { id: "lighting.pointLightShare", description: "share of all doodads that are point lights (LightOmni)" },
  { id: "lighting.pointLightsPerHundredCells", description: "point lights (LightOmni) per 100 playable, non-ramp cells" },
] as const satisfies readonly MeasureDefinition[];

export type MeasureId = (typeof MEASURES)[number]["id"];

/** One map's value of every measure; null where the map has nothing to measure (no pit, no props of a kind). */
export type MapMeasures = Record<MeasureId, number | null>;

const value = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : round(v));

/** Every lesson-neutral measure of one map. */
export function measureMap(map: LoadedMapPackage, catalog: Catalog = EMPTY_CATALOG): MapMeasures {
  const input = measureInput(map, catalog);
  const { main } = input;
  const lowest = input.levels[0]!;
  const highest = input.levels.at(-1)!;
  const top = new Map(topTextureByLevel(input).map((t) => [t.level, t.share]));
  const cross = cliffCrossings(input);
  const frames = frameAreaTexturing(input);
  const blends = blendPlacement(input);
  const back = backdrop(input);
  const light = lightingChanges(input);
  const changed = ([n, c]: readonly [number, number]) => (n ? c / n : null);
  return {
    "topTextureShare.lowestLevel": lowest === main ? null : value(top.get(lowest)),
    "topTextureShare.mainLevel": value(top.get(main)),
    "topTextureShare.highestLevel": highest === main ? null : value(top.get(highest)),
    "cliffTextureChange.downIntoPit": value(changed(cross.down)),
    "cliffTextureChange.upOntoHeight": value(changed(cross.up)),
    "doodadDensity.lowestLevel": lowest === main ? null : value(doodadDensityRatio(input, lowest)),
    "doodadDensity.mainLevel": value(doodadDensityRatio(input, main)),
    "doodadDensity.highestLevel": highest === main ? null : value(doodadDensityRatio(input, highest)),
    "doodadDensity.perHundredCells": value((visibleOnPlayable(input).length / input.playable) * 100),
    "frameAreas.singleTextureShare": value(frames.areas ? frames.singleTexture / frames.areas : null),
    "blend.nearBorderShare": value(blends.blended ? blends.blendedNearBorder / blends.blended : null),
    "blend.width": value(blends.borderEdges ? blends.blendedNearBorder / blends.borderEdges : null),
    "blend.singleTextureCellShare": value(blends.singleTexture / blends.cells),
    "yawSnapping.natural": value(snappedShare(propsOfKind(input, "natural"))),
    "yawSnapping.built": value(snappedShare(propsOfKind(input, "built"))),
    "yawSnapping.decal": value(snappedShare(propsOfKind(input, "decal"))),
    "backdrop.share": value(back.cells / input.playable),
    "backdrop.waterShare": value(back.cells ? back.underWater / back.cells : null),
    "backdrop.skyShare": value(back.cells ? back.underSky / back.cells : null),
    "backdrop.coveredShare": value(back.cells ? back.covered / back.cells : null),
    "backdrop.fogDensity": value(back.fogDensity),
    "lighting.lightsSet": light.lights.length,
    "lighting.changes": light.changes,
    "lighting.instantShare": value(light.changes ? light.instant / light.changes : null),
    "lighting.longestBlendSeconds": value(light.longestBlendSeconds),
    "lighting.pointLightShare": value(input.doodads.length ? light.pointLights / input.doodads.length : null),
    "lighting.pointLightsPerHundredCells": value((light.pointLights / input.playable) * 100),
  };
}
