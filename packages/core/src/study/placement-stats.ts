// Placement statistics over a folder of unpacked maps, as input to a Style Pack's knowledge (issue #747,
// part of #735): how densely doodads are placed in each tileset, which doodad types they are, and which
// ground texture the vegetation stands on. The numbers are ours, computed from the maps given; none are
// taken from another project, and no map data is kept: the results are counts and shares.
//
// A map folder is read lightly (t3Terrain.xml, MapInfo, Objects, and t3TextureMasks when it has one), so
// Blizzard's ladder extracts, which carry no texture masks, still give densities; they give no
// vegetation-to-texture pairs, which need the masks.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { dominantLayer } from "../kept-terrain/paint-brushes.js";
import { readMapInfo } from "../map/read-map-info.js";
import { readObjectsXml } from "../map/read-objects-xml.js";
import { readT3TerrainXml, textureAt } from "../terrain/read-t3-terrain-xml.js";
import { readT3TextureMasks } from "../terrain/read-t3-texture-masks.js";
import { round } from "./stats.js";

/** The words that make a doodad type vegetation, each as a whole name segment (an optional plural or `life` after it). */
const VEGETATION_WORD = /^(tree|bush|shrub|plant|grass|flower|fern|palm|vine|moss|weed|seaweed|kelp|cactus|cacti|reed|fungus|fungi|mushroom|brush|underbrush|bramble|foliage|sapling|stalk|bamboo|lily|vegetation|overgrowth)(s|es|life)?$/;

/** A type's name split into lower-case segments at underscores, case changes and digits: `Aiur_TreesRegular2` is aiur, trees, regular. */
export function nameSegments(type: string): string[] {
  return type
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
}

/**
 * A doodad type is vegetation when one of its name segments is a plant word. A name rule, not a catalogue
 * lookup: it misses a plant with a plain name, and a segment is matched whole, so `Breed` is not `reed`
 * and `Rock_Cliff_Jungle` is not a plant.
 */
export const isVegetationName = (type: string): boolean => nameSegments(type).some((segment) => VEGETATION_WORD.test(segment));

export type PlacedForStats = { readonly type: string; /** The dominant ground texture under it; absent when the map has no texture masks. */ readonly texture?: string };

/** What one map contributes: its tileset, its playable area, and each placed doodad. */
export type PlacementRecord = {
  readonly map: string;
  readonly tileset: string;
  /** Cells inside the playable bounds. */
  readonly playableCells: number;
  readonly hasTextures: boolean;
  readonly doodads: readonly PlacedForStats[];
};

/** A folder that is a map package: it holds Objects, t3Terrain.xml and MapInfo. */
export function isMapFolder(dir: string): boolean {
  return ["Objects", "t3Terrain.xml", "MapInfo"].every((name) => existsSync(path.join(dir, name)));
}

/** The map folders directly under `root` (or `root` itself when it is one), and the entries that are links pointing nowhere. */
export function mapFoldersUnder(root: string): { readonly folders: string[]; readonly dangling: string[] } {
  if (isMapFolder(root)) return { folders: [root], dangling: [] };
  const folders: string[] = [];
  const dangling: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const dir = path.join(root, name);
    let isDirectory: boolean;
    try {
      // statSync follows a link, so a folder of links to extracts reads too.
      isDirectory = statSync(dir).isDirectory();
    } catch {
      dangling.push(name);
      continue;
    }
    if (isDirectory && isMapFolder(dir)) folders.push(dir);
  }
  return { folders, dangling };
}

/** The map folders under `root`; see `mapFoldersUnder` for the dangling links it leaves out. */
export const findMapFolders = (root: string): string[] => mapFoldersUnder(root).folders;

/** Reads one map folder. A doodad outside the map's cells, or a map with no readable terrain, throws with the reason. */
export function readPlacementRecord(dir: string): PlacementRecord {
  const terrain = readT3TerrainXml(readFileSync(path.join(dir, "t3Terrain.xml"), "utf8"));
  const [left, bottom, right, top] = readMapInfo(readFileSync(path.join(dir, "MapInfo"))).playableBounds;
  const playableCells = Math.max(0, right - left) * Math.max(0, top - bottom);
  const masksFile = path.join(dir, "t3TextureMasks");
  const masks = existsSync(masksFile) ? readT3TextureMasks(readFileSync(masksFile)) : undefined;
  const placed = readObjectsXml(readFileSync(path.join(dir, "Objects"), "utf8")).doodads;
  const doodads = placed.map((doodad): PlacedForStats => {
    if (!masks) return { type: doodad.type };
    const x = Math.min(terrain.width - 1, Math.max(0, Math.floor(doodad.position.x)));
    const y = Math.min(terrain.height - 1, Math.max(0, Math.floor(doodad.position.y)));
    return { type: doodad.type, texture: textureAt(terrain, x, y, dominantLayer(masks, terrain.width, y * terrain.width + x)) };
  });
  return { map: path.basename(dir), tileset: terrain.tilesetId || "(none)", playableCells, hasTextures: masks !== undefined, doodads };
}

export type TypeStat = { readonly type: string; readonly count: number; /** Of the tileset's doodads. */ readonly share: number; readonly per1000Cells: number };
export type PairStat = { readonly type: string; readonly texture: string; readonly count: number; /** Of that type's placements. */ readonly share: number };

export type TilesetStats = {
  readonly tileset: string;
  readonly maps: readonly string[];
  readonly playableCells: number;
  readonly doodads: number;
  /** Doodads per 1,000 playable cells over the tileset's maps together, and the lowest and highest map. */
  readonly per1000Cells: number;
  readonly perMap: { readonly low: number; readonly high: number };
  readonly topTypes: readonly TypeStat[];
  readonly vegetation: {
    readonly count: number;
    readonly shareOfDoodads: number;
    readonly per1000Cells: number;
    /** Over the maps that have texture masks only; empty when none does. */
    readonly texturedMaps: number;
    readonly byTexture: readonly { readonly texture: string; readonly count: number; readonly share: number }[];
    readonly pairs: readonly PairStat[];
  };
};

export type PlacementStats = { readonly maps: number; readonly skipped: readonly { readonly map: string; readonly reason: string }[]; readonly tilesets: readonly TilesetStats[] };

export type AggregateOptions = { readonly topTypes?: number; readonly topPairs?: number; readonly isVegetation?: (type: string) => boolean; readonly minPlacements?: number };

const per1000 = (count: number, cells: number): number => (cells > 0 ? round((count / cells) * 1000, 2) : 0);

/** Groups the records by tileset and counts. */
export function aggregatePlacement(records: readonly PlacementRecord[], skipped: PlacementStats["skipped"] = [], options: AggregateOptions = {}): PlacementStats {
  const isVegetation = options.isVegetation ?? isVegetationName;
  const topTypes = options.topTypes ?? 15;
  const topPairs = options.topPairs ?? 20;
  const minPlacements = options.minPlacements ?? 5;
  const byTileset = new Map<string, PlacementRecord[]>();
  for (const record of records) byTileset.set(record.tileset, [...(byTileset.get(record.tileset) ?? []), record]);

  const tilesets = [...byTileset.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tileset, group]): TilesetStats => {
      const cells = group.reduce((sum, record) => sum + record.playableCells, 0);
      const all = group.flatMap((record) => record.doodads);
      const types = new Map<string, number>();
      for (const doodad of all) types.set(doodad.type, (types.get(doodad.type) ?? 0) + 1);
      const densities = group.map((record) => per1000(record.doodads.length, record.playableCells));
      const vegetation = all.filter((doodad) => isVegetation(doodad.type));
      const textured = vegetation.filter((doodad) => doodad.texture !== undefined && doodad.texture !== "");
      const byTexture = new Map<string, number>();
      const pairs = new Map<string, number>();
      const typeTotals = new Map<string, number>();
      for (const doodad of textured) {
        byTexture.set(doodad.texture!, (byTexture.get(doodad.texture!) ?? 0) + 1);
        pairs.set(`${doodad.type}\u0000${doodad.texture!}`, (pairs.get(`${doodad.type}\u0000${doodad.texture!}`) ?? 0) + 1);
        typeTotals.set(doodad.type, (typeTotals.get(doodad.type) ?? 0) + 1);
      }
      return {
        tileset,
        maps: group.map((record) => record.map).sort(),
        playableCells: cells,
        doodads: all.length,
        per1000Cells: per1000(all.length, cells),
        perMap: { low: Math.min(...densities), high: Math.max(...densities) },
        topTypes: [...types.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, topTypes)
          .map(([type, count]) => ({ type, count, share: round(count / Math.max(1, all.length)), per1000Cells: per1000(count, cells) })),
        vegetation: {
          count: vegetation.length,
          shareOfDoodads: round(vegetation.length / Math.max(1, all.length)),
          per1000Cells: per1000(vegetation.length, cells),
          texturedMaps: group.filter((record) => record.hasTextures).length,
          byTexture: [...byTexture.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([texture, count]) => ({ texture, count, share: round(count / Math.max(1, textured.length)) })),
          pairs: [...pairs.entries()]
            .map(([key, count]) => {
              const [type, texture] = key.split("\u0000") as [string, string];
              return { type, texture, count, share: round(count / typeTotals.get(type)!) };
            })
            .filter((pair) => typeTotals.get(pair.type)! >= minPlacements)
            .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type) || a.texture.localeCompare(b.texture))
            .slice(0, topPairs),
        },
      };
    });
  return { maps: records.length, skipped, tilesets };
}

/** Reads every map folder under `root` and aggregates; a folder that can't be read is listed as skipped with the reason. */
export function placementStatsFor(root: string, options: AggregateOptions = {}): PlacementStats {
  const records: PlacementRecord[] = [];
  const skipped: { map: string; reason: string }[] = [];
  const { folders, dangling } = mapFoldersUnder(root);
  for (const name of dangling) skipped.push({ map: name, reason: "a link that points nowhere" });
  for (const dir of folders) {
    try {
      records.push(readPlacementRecord(dir));
    } catch (error) {
      skipped.push({ map: path.basename(dir), reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return aggregatePlacement(records, skipped, options);
}

/** The statistics as Markdown tables, one section a tileset. */
export function formatPlacementStats(stats: PlacementStats): string {
  const out: string[] = [`${stats.maps} maps read, ${stats.tilesets.length} tilesets.`];
  if (stats.skipped.length) out.push("", `Skipped: ${stats.skipped.map((entry) => `${entry.map} (${entry.reason})`).join("; ")}.`);
  out.push("", "| Tileset | Maps | Playable cells | Doodads | Per 1,000 cells | Lowest and highest map | Vegetation share |", "|---|---|---|---|---|---|---|");
  for (const t of stats.tilesets) out.push(`| ${t.tileset} | ${t.maps.length} | ${t.playableCells} | ${t.doodads} | ${t.per1000Cells} | ${t.perMap.low} to ${t.perMap.high} | ${Math.round(t.vegetation.shareOfDoodads * 100)}% (${t.vegetation.per1000Cells} per 1,000) |`);
  for (const t of stats.tilesets) {
    out.push("", `### ${t.tileset}`, "", `Maps: ${t.maps.join(", ")}.`, "", "| Doodad type | Count | Share | Per 1,000 cells |", "|---|---|---|---|");
    for (const type of t.topTypes) out.push(`| ${type.type} | ${type.count} | ${Math.round(type.share * 100)}% | ${type.per1000Cells} |`);
    if (t.vegetation.texturedMaps > 0 && t.vegetation.pairs.length > 0) {
      out.push("", `Vegetation on its ground texture (${t.vegetation.texturedMaps} of ${t.maps.length} maps have texture masks; types placed at least 5 times):`, "", "| Vegetation type | Dominant texture under it | Count | Share of the type |", "|---|---|---|---|");
      for (const pair of t.vegetation.pairs) out.push(`| ${pair.type} | ${pair.texture} | ${pair.count} | ${Math.round(pair.share * 100)}% |`);
    } else out.push("", "No vegetation-to-texture pairs: none of these maps has texture masks.");
  }
  return out.join("\n");
}
