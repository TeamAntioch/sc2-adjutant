// Paint Regions read back from a Map Package (ADR-0028, #136): each region's cells as the compile
// rasterises them, on the sets the package has its blocks on, and what each texture of its mix shows
// there as painted, beside what the mix asked for.
//
// - **Cells.** As rasterisePaintRegions finds them: beside Kept ground, the generating Zones' own cells
//   (ownedCells); on a generated map, every cell, each in the last Zone listed whose polygon holds it.
// - **Blend weight.** A texture's mean layer weight (out of 15) over the region's full-strength
//   texels, past its falloff, and over all of its texels.
// - **Area share.** The fraction of the region's cells the texture is the dominant texture of.

import { generatingZones, hasKeptTerrain, type MissionBlueprint, type PaintMix } from "../domain/mission-blueprint.js";
import { type PaintRegionGround, rasterisePaintRegions, type RasterisedRegion } from "../terrain/paint-regions.js";
import { zoneOwners } from "../terrain/paint-textures.js";
import { FULL_WEIGHT, LAYERS, TEXELS_PER_CELL } from "../terrain/texture-grid.js";
import { ownedCells } from "./generating-zones.js";
import { cellSet, dominantLayer, type KeptTextures, setTextures } from "./paint-brushes.js";

/** The ground a package's Paint Regions are rasterised on, as the compile has it. */
export function packageRegionGround(blueprint: Pick<MissionBlueprint, "zones" | "mapSize">, textures: KeptTextures): PaintRegionGround {
  const { width, height } = textures;
  const base = {
    width,
    height,
    setOf: (x: number, y: number) => cellSet(textures, x, y),
    setTextures: (set: number) => setTextures(textures, set),
    setLabel: (set: number) => `texture set ${set} (${textures.sets[set] || "unnamed"})`,
  };
  if (!hasKeptTerrain(blueprint)) return { ...base, owner: zoneOwners({ ...blueprint, mapSize: { width, height } }), zones: blueprint.zones };
  const { owned, owner } = ownedCells(blueprint, width, height);
  return { ...base, owner, zones: generatingZones(blueprint), paints: (cell) => owned[cell] === 1 };
}

/** One texture of a region's mix, as asked and as painted. */
export type MixUsage = {
  readonly texture: string;
  /** What the mix asked: a blend weight, an area share, or the rest. */
  readonly target: { readonly weight: number } | { readonly share: number } | { readonly rest: true };
  /** Mean blend weight (0..1) over the full-strength texels, past the falloff; undefined when none is. */
  readonly coreWeight: number | undefined;
  /** Mean blend weight over all the region's texels. */
  readonly weight: number;
  /** The fraction of the region's cells it is the dominant texture of. */
  readonly share: number;
};

export type RegionUsage =
  | { readonly id: string; readonly cells: number; readonly coreCells: number; readonly mix: readonly MixUsage[] }
  /** A region the package can't show: it paints no cell, or a set its cells are on lacks a texture. */
  | { readonly id: string; readonly unmeasured: string };

/** Each of the Blueprint's Paint Regions measured on the package, in order. */
export function paintRegionUsage(blueprint: Pick<MissionBlueprint, "zones" | "mapSize" | "paintRegions">, textures: KeptTextures): RegionUsage[] {
  const ground = packageRegionGround(blueprint, textures);
  return (blueprint.paintRegions ?? []).map((region) => {
    let rasterised: RasterisedRegion | undefined;
    try {
      [rasterised] = rasterisePaintRegions([region], ground);
    } catch (error) {
      return { id: region.id, unmeasured: (error as Error).message };
    }
    if (!rasterised) return { id: region.id, unmeasured: `Paint Region ${region.id} paints no cell` };
    return measureRegion(rasterised, region.mix, textures, ground);
  });
}

function measureRegion(region: RasterisedRegion, mix: readonly PaintMix[], textures: KeptTextures, ground: PaintRegionGround): RegionUsage {
  const { width, masks } = textures;
  const strengthWidth = region.width * TEXELS_PER_CELL;
  const sums = mix.map(() => ({ core: 0, all: 0, dominant: 0 }));
  let [cells, coreTexels, texels] = [0, 0, 0];
  const coreCells = new Set<number>();
  for (let cy = region.y; cy < region.y + region.height; cy++) {
    for (let cx = region.x; cx < region.x + region.width; cx++) {
      const cell = cy * width + cx;
      if (!region.cells[cell]) continue;
      cells++;
      const names = ground.setTextures(ground.setOf(cx, cy));
      const layers = mix.map((entry) => names.indexOf(entry.texture));
      const top = dominantLayer(masks, width, cell);
      layers.forEach((layer, i) => {
        if (layer === top) sums[i]!.dominant++;
      });
      for (let ty = 0; ty < TEXELS_PER_CELL; ty++) {
        for (let tx = 0; tx < TEXELS_PER_CELL; tx++) {
          const t = (cy * TEXELS_PER_CELL + ty) * masks.maskWidth + cx * TEXELS_PER_CELL + tx;
          const full = region.strength[((cy - region.y) * TEXELS_PER_CELL + ty) * strengthWidth + (cx - region.x) * TEXELS_PER_CELL + tx]! >= 1 - 1e-6;
          texels++;
          if (full) {
            coreTexels++;
            coreCells.add(cell);
          }
          layers.forEach((layer, i) => {
            if (layer < 0 || layer >= LAYERS) return;
            const weight = masks.layers[layer]![t]! / FULL_WEIGHT;
            sums[i]!.all += weight;
            if (full) sums[i]!.core += weight;
          });
        }
      }
    }
  }
  return {
    id: region.id,
    cells,
    coreCells: coreCells.size,
    mix: mix.map((entry, i) => ({
      texture: entry.texture,
      target: entry.weight !== undefined ? { weight: entry.weight } : entry.share !== undefined ? { share: entry.share } : { rest: true as const },
      coreWeight: coreTexels ? sums[i]!.core / coreTexels : undefined,
      weight: sums[i]!.all / texels,
      share: sums[i]!.dominant / cells,
    })),
  };
}

const percent = (fraction: number) => `${Number((fraction * 100).toFixed(1))}%`;

/** The regions' section of texture_usage's report. */
export function describeRegionUsage(regions: readonly RegionUsage[]): string[] {
  if (regions.length === 0) return [];
  const lines = ["", "Paint Regions (blend weight: mean layer weight past the falloff, and over the whole region; area share: the cells it is the dominant texture of):"];
  for (const region of regions) {
    if ("unmeasured" in region) {
      lines.push(`  ${region.id}: not measured: ${region.unmeasured}`);
      continue;
    }
    lines.push(`  ${region.id}: ${region.cells} cell${region.cells === 1 ? "" : "s"}, ${region.coreCells} past the falloff`);
    for (const entry of region.mix) {
      const asked = "weight" in entry.target ? `weight ${entry.target.weight}` : "share" in entry.target ? `share ${entry.target.share}` : "the rest";
      const core = entry.coreWeight === undefined ? "no cell past the falloff" : `${percent(entry.coreWeight)} past the falloff`;
      lines.push(`    ${entry.texture}: asked ${asked}; painted weight ${core}, ${percent(entry.weight)} over the region; dominant in ${percent(entry.share)} of its cells`);
    }
  }
  return lines;
}
