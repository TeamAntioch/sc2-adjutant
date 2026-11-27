// Paints the zones' textures into the 8 mask layers, at the masks' own resolution (8 texels per
// cell), the way the Editor's brush does: every texel's weights sum to 15, and a cell may vary
// inside (Blizzard's campaign maps: 50-89% of cells do).
//
// - Textures follow the cliffs: a cell takes the texture of a zone at its own cliff level, so a
//   plateau's texture runs to its cliff lip and the ground below keeps its own.
// - Ramps take the top's texture, as Blizzard's do about twice as often as the bottom's.
// - Seams between textures on flat ground wander (noise at three scales, so a sketch's straight
//   border doesn't show) and blend over a width that varies along them, as on Blizzard's
//   natural-ground maps: blends there run a median 3-6 cells, from about 1 to over 10.
// - With a texture palette (texturePlan), zones take their elevation band's texture, natural
//   ground gets washes of the variety textures where the Style Pack's rules ask for them (each
//   fades in, stays below full strength and may overlap another, so no patch is a solid shape), and
//   built zones get crisp, unwarped edges: a 2-3 texel fade, as on Blizzard's built maps (Media
//   Blitz, 3-2, 3-4: median 2-3 texels).
// - Which textures the wide blend joins, and the palette advice, are the Style Pack's rules too
//   (`StyleRuleSlots`). Without one, no variety patches, every seam may blend widely, and no advice.
// - On a melee map (#214) the noise keeps to the rotation (seams move and patches grow the same
//   on both sides, with no seam where they meet), and the source side's weights are then turned
//   onto the other, so the two match exactly whatever the blurs' rounding.

import { blueprintCatalog, layerSource } from "../catalog/catalog-layer.js";
import { isKnownTexture, textureStarkness, textureTone } from "../catalog/tileset-textures.js";
import { type MissionBlueprint, type PaletteBand, paletteBands, paletteTextures, type TexturePalette } from "../domain/mission-blueprint.js";
import { blueprintPlugins, type CliffTexturePair, type StyleRuleSlots } from "../plugins/plugin-api.js";
import { applyPaintRegions, ditherThreshold, quantizeDithered, rasterisePaintRegions, type RasterisedRegion } from "./paint-regions.js";
import { containsPoint } from "./rasterize.js";
import { type Rot180, sourceCell, symmetricNoise } from "./symmetry.js";
import { blockOf, blockOrigin, CELLS_PER_BLOCK, TEXELS_PER_CELL as GRID_TEXELS_PER_CELL } from "./texture-grid.js";

/** The blend group round a ramp: every texture at once. A symbol, so no group a rule names can be it. */
const ANY_GROUP = Symbol("any blend group");
/**
 * texture-grid.ts's, read once into a local: the per-texel loops below run millions of times a
 * compile, and Vitest's module transform turns each read of an imported binding into a getter call
 * (a melee compile ran half as slow again in the tests without this).
 */
const TEXELS_PER_CELL = GRID_TEXELS_PER_CELL;
const FULL = 15;
/** Noise moving seams: how far (cells) at each feature size (cells). */
const WARP_OCTAVES: readonly { readonly cells: number; readonly period: number }[] = [
  { cells: 6, period: 24 },
  { cells: 2, period: 8 },
  { cells: 0.6, period: 2.5 },
];
/** A narrow blend (box blur radius in texels) and a wide one (in cells), each applied twice, mixed along a seam by noise of this period (cells). */
const NARROW_BLUR_TEXELS = 3;
const WIDE_BLUR_CELLS = 2;
const BLEND_MIX_PERIOD = 12;
/** Box blur radius (texels, applied once) at a built zone's edge: a 2-texel fade. */
const CRISP_BLUR_TEXELS = 1;
/** How far (cells) from a built cell the crisp blend replaces the seams' blend: the wide blend's reach. */
const CRISP_REACH_CELLS = 2 * WIDE_BLUR_CELLS;
/** Cells round a ramp that always get the wide blend. */
const RAMP_BLEND_CELLS = 3;

/**
 * A variety patch is a wash, not a swap. Its texture fades in over PATCH_FEATHER of noise above
 * the threshold to a core at full strength, and a finer noise (MOTTLE_PERIOD cells) moves the
 * threshold by up to MOTTLE_DEPTH, so the edge is soft and broken while the core still reads in
 * dim light. Measured on the Antioch pack's natural-ground Exemplar Maps, half to nine tenths of
 * open cells hold two or more textures.
 *
 * A stark texture (pebbles, lumpy moss, pitted creep, roots: textureStarkness, from its picture's
 * contrast and the catalog's accent note) reads at full strength long before its weight gets
 * there, so it gets less ground and smaller spots. At full starkness its noise is STARK_SCALE times
 * finer, its threshold STARK_RARITY higher, its fade STARK_FEATHER and its core only STARK_STRENGTH
 * of a texel, so the zone's own texture shows through it; a texture part-way stark is part-way
 * there.
 *
 * Beside a block of another texture set every patch fades out over SET_EDGE_FADE cells: a set's
 * edge is a cut along the block line, and a wash cut there shows as a step in its own texture.
 */
const PATCH_FEATHER = 0.25;
const MOTTLE_PERIOD = 3;
const MOTTLE_DEPTH = 0.12;
const STARK_SCALE = 2;
const STARK_RARITY = 0.18;
const STARK_FEATHER = 0.12;
const STARK_STRENGTH = 0.5;
const SET_EDGE_FADE = 2;

/** Variety patched into a zone's ground: the patch noise's period (cells), and the noise it takes to start one. */
export type ZonePatches = { readonly layers: readonly number[]; readonly period: number; readonly threshold: number };

/** Which texture layer each zone paints, from the palette or zone order. */
export type TexturePlan = {
  readonly zoneLayers: readonly number[];
  /** Zones painted with crisp edges (surface "built"). */
  readonly builtZones: readonly boolean[];
  /** Each zone's variety patches, if it gets any: natural ground for play under the palette. */
  readonly zonePatches: readonly (ZonePatches | undefined)[];
  /** Each layer's blend group: the wide blend joins textures of one group (the Style Pack's rule). */
  readonly blendGroups: readonly string[];
  /** Each layer's texture name. */
  readonly layerNames: readonly string[];
  /** With a palette: the main level and how many low and high bands it lists, for advice. */
  readonly palette?: PaletteBandCounts;
  /** Each texture set's palette (generated-texture-sets.ts) as `palette` is the map's, by the set's index. */
  readonly setPalettes?: readonly (({ readonly id: string } & PaletteBandCounts) | undefined)[];
  /** With texture sets: each Zone's set index (0 for none), which a palette's cliff advice checks its cells against. */
  readonly zoneSets?: readonly number[];
  /** The Style Pack's rules the plan was made with, so the painter's advice uses the same ones. */
  readonly rules: StyleRuleSlots;
  /** With texture sets (generated-texture-sets.ts): the layers above are the map's textures, set 0's 8 first, and each cell paints them on its block's set's layers. */
  readonly sets?: PlanSets;
};

/** A palette's main level and how many low and high bands it lists, for the Style Pack's cliff advice. */
export type PaletteBandCounts = { readonly mainLevel: number; readonly lowBands: number; readonly highBands: number };

/** The map's texture sets as the painter reads them. */
export type PlanSets = {
  /** Each 8×8-cell block's set: [blockY * blocksPerRow + blockX]. */
  readonly blockSets: Uint8Array;
  readonly blocksPerRow: number;
  /** Each set's 8 textures, by layer. */
  readonly names: readonly (readonly string[])[];
  /** For each set, the layer each plan layer is on in it, or -1 when the set hasn't its texture. */
  readonly layerIn: readonly Int8Array[];
  /** Each set's id in the Blueprint's `textureSets`, by index; undefined for set 0 and a kept set. */
  readonly ids: readonly (string | undefined)[];
};

/**
 * The map's texture sets for texturePlan: the slots (set s holds 8s to 8s+7), each block's set, each
 * set's Zone's set, and each Blueprint set's index.
 */
export type TextureSetLayout = {
  readonly slots: readonly string[];
  readonly blockSets: Uint8Array;
  readonly blocksPerRow: number;
  readonly setOfZone: ReadonlyMap<string, number>;
  readonly indexOf: ReadonlyMap<string, number>;
};

/** The main level: the cliff level with the most cells (ties go to the lower). */
export function mainLevelOf(syncCliff: Uint16Array): number {
  const cellsByLevel = new Map<number, number>();
  for (const value of syncCliff) {
    if (value % 64 === 0) cellsByLevel.set(value / 64, (cellsByLevel.get(value / 64) ?? 0) + 1);
  }
  return [...cellsByLevel].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

/**
 * Without a palette, each zone takes its own texture or the next layer in zone order. With one,
 * a zone takes its own texture, else the built texture if it's built, else its elevation band's:
 * `main` on the main level (the cliff level with the most cells), `low` and `high` below and
 * above it, one band per level away (the last repeats), each falling back to `main`.
 *
 * Where the Style Pack's rules set variety patches, natural ground for play takes them:
 * main-level zones the palette's variety at full strength, band zones their band's own variety,
 * or light touches of the palette's. Built and backdrop zones, and zones with their own texture,
 * get none.
 *
 * `owner` is each cell's Zone ({@link zoneOwners}), as paintTextures takes it: a texture set's
 * palette finds its main level from the cells its Zones paint.
 */
export function texturePlan(blueprint: MissionBlueprint, textures: readonly string[], syncCliff: Uint16Array, owner: Int16Array, sets?: TextureSetLayout): TexturePlan {
  const plan = setZeroPlan(blueprint, textures, syncCliff, (id) => (sets?.setOfZone.get(id) ?? 0) !== 0);
  return sets ? withSets(blueprint, plan, sets, syncCliff, owner) : plan;
}

/**
 * The plan with the map's other texture sets: their textures become layers after set 0's 8. A set's
 * Zone wears its own `texture`; else, under the set's palette, its band and variety patches as
 * setZeroPlan gives them under the map's, counting bands from the set's main level; else the set's
 * first, with no variety patches.
 */
function withSets(blueprint: MissionBlueprint, plan: TexturePlan, sets: TextureSetLayout, syncCliff: Uint16Array, owner: Int16Array): TexturePlan {
  if (plan.layerNames.length !== 8) throw new Error(`Texture sets need the Mission's 8 textures as set 0, not ${plan.layerNames.length}`);
  const names = Array.from({ length: 8 }, (_, set) => Array.from({ length: 8 }, (_, layer) => sets.slots[set * 8 + layer] ?? ""));
  const layerNames = [...plan.layerNames];
  for (const own of names.slice(1)) for (const name of own) if (name !== "" && !layerNames.includes(name)) layerNames.push(name);
  // Set 0's layers are its own; another set has a layer for each of its textures.
  const layerIn = names.map((own, set) => Int8Array.from(layerNames, (name, layer) => (set === 0 ? (layer < 8 ? layer : -1) : name === "" ? -1 : own.indexOf(name))));
  // Each set's palette, by its index, painting with the set's textures.
  const zoneSets = blueprint.zones.map((zone) => sets.setOfZone.get(zone.id) ?? 0);
  const palettes = new Map<number, { readonly id: string; readonly counts: PaletteBandCounts; readonly paint: ZonePainter }>();
  // The sets' own main levels, worked out only when a palette set leaves out mainLevel.
  const needsLevels = (blueprint.textureSets ?? []).some((set) => set.palette && set.palette.mainLevel === undefined && sets.indexOf.has(set.id));
  const setLevels = needsLevels ? setMainLevels(syncCliff, paintingZones(blueprint, syncCliff, owner), zoneSets) : new Map<number, number>();
  const mapMainLevel = plan.palette?.mainLevel ?? (needsLevels ? mainLevelOf(syncCliff) : 0);
  for (const set of blueprint.textureSets ?? []) {
    const index = sets.indexOf.get(set.id);
    if (!set.palette || index === undefined) continue;
    const own = names[index]!;
    const layerOf = (name: string, what: string): number => {
      if (!own.includes(name)) throw new Error(`Texture set ${set.id}'s ${what}: texture ${name} isn't one of its textures, ${own.filter(Boolean).join(", ")}`);
      return layerNames.indexOf(name);
    };
    const mainLevel = set.palette.mainLevel ?? setLevels.get(index) ?? mapMainLevel;
    const painter = paletteZonePainter(set.palette, mainLevel, layerOf, plan.rules, `texture set ${set.id}'s palette`);
    palettes.set(index, { id: set.id, counts: painter.counts, paint: painter.paint });
  }
  const painted = blueprint.zones.map((zone, index) => {
    const set = zoneSets[index]!;
    if (set === 0) return { layer: plan.zoneLayers[index]!, patches: plan.zonePatches[index] };
    const palette = palettes.get(set);
    if (palette && zone.texture === undefined) return palette.paint(zone);
    const name = zone.texture ?? names[set]!.find((texture) => texture !== "")!;
    if (!names[set]!.includes(name)) throw new Error(`Zone ${zone.id}: texture ${name} isn't one of its texture set's, ${names[set]!.filter(Boolean).join(", ")}`);
    return { layer: layerNames.indexOf(name), patches: undefined };
  });
  const blendGroups = layerNames.map((name, layer) => plan.blendGroups[layer] ?? plan.rules.blendGroup?.({ name, tone: name ? textureTone(name) : undefined }) ?? "");
  const setPalettes = palettes.size > 0 ? names.map((_, set) => palettes.get(set)).map((entry) => entry && { id: entry.id, ...entry.counts }) : undefined;
  return {
    ...plan,
    zoneLayers: painted.map((zone) => zone.layer),
    zonePatches: painted.map((zone) => zone.patches),
    blendGroups,
    layerNames,
    sets: { blockSets: sets.blockSets, blocksPerRow: sets.blocksPerRow, names, layerIn, ids: setIds(sets.indexOf, names.length) },
    zoneSets,
    ...(setPalettes ? { setPalettes } : {}),
  };
}

/** Each set's Blueprint id by its index, from the ids' indexes. */
function setIds(indexOf: ReadonlyMap<string, number>, count: number): (string | undefined)[] {
  const ids = new Array<string | undefined>(count).fill(undefined);
  for (const [id, index] of indexOf) ids[index] = id;
  return ids;
}

/**
 * Each texture set's main level, in one pass: the cliff level holding most of the flat cells its
 * Zones paint (`zone`, {@link paintingZones}; ties go to the lower). A set painting no flat cell has none.
 */
function setMainLevels(syncCliff: Uint16Array, zone: Int16Array, zoneSets: readonly number[]): Map<number, number> {
  const counts = new Map<number, Map<number, number>>();
  for (let cell = 0; cell < syncCliff.length; cell++) {
    const value = syncCliff[cell]!;
    if (value % 64 !== 0 || zone[cell]! < 0) continue;
    const set = zoneSets[zone[cell]!]!;
    if (set === 0) continue;
    const byLevel = counts.get(set) ?? new Map<number, number>();
    byLevel.set(value / 64, (byLevel.get(value / 64) ?? 0) + 1);
    counts.set(set, byLevel);
  }
  return new Map([...counts].map(([set, byLevel]) => [set, [...byLevel].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0]]));
}

/** A Zone's layer, crisp edges and variety patches under a palette. */
type ZonePaint = { readonly layer: number; readonly built?: boolean; readonly patches: ZonePatches | undefined };
type ZonePainter = (zone: MissionBlueprint["zones"][number]) => ZonePaint;

/**
 * How a palette paints a Zone with no texture of its own (texturePlan's rules): built ground its
 * built texture, other ground its elevation band's, counted from `mainLevel`, and natural ground
 * for play its variety patches. `layerOf` finds a texture's layer, `what` naming the field; `label`
 * names the palette in errors ("the texture palette", "texture set cave's palette").
 */
function paletteZonePainter(
  palette: TexturePalette,
  mainLevel: number,
  layerOf: (name: string, what: string) => number,
  rules: StyleRuleSlots,
  label: string,
): { readonly paint: ZonePainter; readonly counts: PaletteBandCounts } {
  const below = paletteBands(palette.low);
  const above = paletteBands(palette.high);
  /** The band for a level, or undefined on the main level or when the side has none. */
  const bandAt = (level: number): PaletteBand | undefined => {
    const side = level < mainLevel ? below : level > mainLevel ? above : [];
    return side[Math.min(Math.abs(level - mainLevel), side.length) - 1];
  };
  const mainVariety = palette.variety.map((name) => layerOf(name, "Palette variety"));
  const variety = rules.varietyPatches;
  const paint: ZonePainter = (zone) => {
    if (zone.surface === "built") {
      if (palette.built === undefined) throw new Error(`Zone ${zone.id} is built, but ${label} has no built texture`);
      return { layer: layerOf(palette.built, "Palette built"), built: true, patches: undefined };
    }
    const band = bandAt(zone.elevation);
    const layer = layerOf(band?.texture ?? palette.main, band ? "Palette band" : "Palette main");
    if (zone.backdrop || !variety) return { layer, built: false, patches: undefined };
    const own = band && band.variety.length > 0 ? band.variety.map((name) => layerOf(name, "Palette band variety")) : undefined;
    const patches: ZonePatches | undefined = own
      ? { layers: own, period: variety.period, threshold: variety.threshold }
      : mainVariety.length === 0
        ? undefined
        : // A zone wearing main (its side has no band) is patched like the main level.
          { layers: mainVariety, period: variety.period, threshold: band ? variety.touchThreshold : variety.threshold };
    return { layer, built: false, patches };
  };
  return { paint, counts: { mainLevel, lowBands: below.length, highBands: above.length } };
}

/** The plan over the Mission's own 8 textures (set 0), as above; a Zone `onOtherSet` gets layer 0 here, for withSets to give it its own. */
function setZeroPlan(blueprint: MissionBlueprint, textures: readonly string[], syncCliff: Uint16Array, onOtherSet: (id: string) => boolean): TexturePlan {
  const layerOf = (name: string, what: string): number => {
    const index = textures.indexOf(name);
    if (index < 0) throw new Error(`${what}: texture ${name} isn't one of ${textures.filter(Boolean).join(", ")}`);
    return index;
  };
  const palette = blueprint.texturePalette;
  const zones = blueprint.zones;
  // A Blueprint made in code has no Plugins bound: it gets core alone, so it is painted plainly.
  const rules = blueprintPlugins(blueprint).styleRules();
  // Every layer has a group, even one the mission names no texture for.
  const blendGroups = Array.from({ length: Math.max(8, textures.length) }, (_, layer) => textures[layer] ?? "").map(
    (name) => rules.blendGroup?.({ name, tone: name ? textureTone(name) : undefined }) ?? "",
  );
  if (!palette) {
    return {
      zoneLayers: zones.map((zone, index) => (onOtherSet(zone.id) ? 0 : zone.texture !== undefined ? layerOf(zone.texture, `Zone ${zone.id}`) : index % 8)),
      builtZones: zones.map((zone) => zone.surface === "built"),
      zonePatches: zones.map(() => undefined),
      blendGroups,
      layerNames: textures,
      rules,
    };
  }
  const catalog = blueprintCatalog(blueprint);
  for (const name of paletteTextures(palette)) {
    if (!isKnownTexture(catalog, name)) throw new Error(`Palette texture ${name} isn't a known texture (data/texture-extracted.json${layerSource(catalog)})`);
  }
  const painter = paletteZonePainter(palette, mainLevelOf(syncCliff), layerOf, rules, "the texture palette");
  const plan = zones.map((zone) => {
    if (onOtherSet(zone.id)) return { layer: 0, built: zone.surface === "built", patches: undefined };
    if (zone.texture !== undefined) return { layer: layerOf(zone.texture, `Zone ${zone.id}`), built: zone.surface === "built", patches: undefined };
    return painter.paint(zone);
  });

  return {
    zoneLayers: plan.map((zone) => zone.layer),
    builtZones: plan.map((zone) => zone.built ?? false),
    zonePatches: plan.map((zone) => zone.patches),
    blendGroups,
    layerNames: textures,
    palette: painter.counts,
    rules,
  };
}

/**
 * The Style Pack's palette advice from the textures worn across each cliff, as painted (zones'
 * own textures and built pads count). Each palette counts the cells it paints: those on its set's
 * blocks (set 0's for the map's palette) whose painting Zone (`zone`) is its set's. A cell snapped
 * onto another set's block is that block's set's textures, which no palette's band chose, so it
 * counts for none; the snap warning covers it.
 */
function cliffWarnings(blueprint: MissionBlueprint, plan: TexturePlan, layers: Int8Array, zone: Int16Array, syncCliff: Uint16Array): readonly string[] {
  const advise = plan.rules.cliffTextureWarnings;
  if (!advise) return [];
  const width = blueprint.mapSize.width;
  const sets = plan.sets;
  const setOf = (cell: number): number => {
    if (!sets) return 0;
    const block = sets.blockSets[blockOf(sets.blocksPerRow, cell % width, Math.floor(cell / width))]!;
    const own = zone[cell]! < 0 ? 0 : (plan.zoneSets?.[zone[cell]!] ?? 0);
    return own === block ? block : -1;
  };
  const palettes: { readonly set: number; readonly counts: PaletteBandCounts; readonly label?: string }[] = [
    ...(plan.palette ? [{ set: 0, counts: plan.palette }] : []),
    ...(plan.setPalettes ?? []).flatMap((entry, set) => (entry ? [{ set, counts: entry, label: `Texture set ${entry.id}'s palette` }] : [])),
  ];
  return palettes.flatMap(({ set, counts, label }) => {
    const advice = advise({ pairs: cliffPairs(blueprint, plan, layers, syncCliff, (cell) => setOf(cell) === set), ...counts });
    return label ? advice.map((text) => `${label}: ${text}`) : advice;
  });
}

/** The cell pairs across each cliff whose two cells `counts` takes, by the levels it joins, and how many of them share a texture. */
function cliffPairs(blueprint: MissionBlueprint, plan: TexturePlan, layers: Int8Array, syncCliff: Uint16Array, counts: (cell: number) => boolean): CliffTexturePair[] {
  const { width, height } = blueprint.mapSize;
  // "lower|upper" -> cell pairs across the cliff, and how many share a texture, by texture.
  const pairs = new Map<string, { total: number; same: Map<number, number> }>();
  const consider = (i: number, j: number): void => {
    if (syncCliff[i]! % 64 || syncCliff[j]! % 64 || syncCliff[i] === syncCliff[j]) return;
    if (!counts(i) || !counts(j)) return;
    const [a, b] = syncCliff[i]! < syncCliff[j]! ? [i, j] : [j, i];
    const key = `${syncCliff[a]! / 64}|${syncCliff[b]! / 64}`;
    const entry = pairs.get(key) ?? { total: 0, same: new Map<number, number>() };
    entry.total++;
    if (layers[a] === layers[b]) entry.same.set(layers[a]!, (entry.same.get(layers[a]!) ?? 0) + 1);
    pairs.set(key, entry);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x + 1 < width) consider(y * width + x, y * width + x + 1);
      if (y + 1 < height) consider(y * width + x, (y + 1) * width + x);
    }
  }
  return [...pairs]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { total, same }]) => {
      const [lower, upper] = key.split("|").map(Number) as [number, number];
      return { lower, upper, total, same: [...same].map(([layer, count]) => ({ texture: plan.layerNames[layer]!, pairs: count })) };
    });
}

export type PaintedTextures = {
  /** 0..15 per layer per cell, [cell * 8 + layer], summing to 15: the cell's mean, for sync and minimap. */
  readonly textureWeights: Uint8Array;
  /** 0..15 per layer per texel (8×8 per cell, row-major from y = 0), [texel * 8 + layer], summing to 15. */
  readonly texelWeights: Uint8Array;
  /** The Style Pack's palette advice, such as cliffs whose two sides wear the same texture. */
  readonly warnings: readonly string[];
};

/** Each cell's Zone: the index of the last Zone whose polygon holds the cell's centre, -1 for none. */
export function zoneOwners(blueprint: Pick<MissionBlueprint, "mapSize" | "zones">): Int16Array {
  const { width, height } = blueprint.mapSize;
  const owner = new Int16Array(width * height).fill(-1);
  blueprint.zones.forEach((zone, index) => {
    const xs = zone.polygon.map((p) => p.x);
    const ys = zone.polygon.map((p) => p.y);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(height, Math.ceil(Math.max(...ys))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(width, Math.ceil(Math.max(...xs))); x++) {
        if (containsPoint(zone.polygon, { x: x + 0.5, y: y + 0.5 })) owner[y * width + x] = index;
      }
    }
  });
  return owner;
}

/**
 * Each cell's texture layer: its zone's (later zones win) when that zone is at the cell's cliff
 * level, otherwise the nearest same-level cell's that is. Ramp cells count as their top level.
 * Main-level cells wearing the palette's main texture take variety patches; `layers` is the texture
 * with the largest share of each cell and `shares[layer]` each texture's share of each cell (a
 * cell's shares sum to 1). `built` marks cells of built zones, and `zone` is each cell's painting
 * Zone ({@link paintingZones}). `owner` is each cell's zone ({@link zoneOwners}).
 */
export function cellTextureLayers(
  blueprint: MissionBlueprint,
  plan: TexturePlan,
  syncCliff: Uint16Array,
  owner: Int16Array,
  symmetry?: Rot180,
): { readonly layers: Int8Array; readonly built: Uint8Array; readonly zone: Int16Array; readonly shares: (Float32Array | undefined)[] } {
  const { width, height } = blueprint.mapSize;
  const cells = width * height;
  const source = paintingZones(blueprint, syncCliff, owner);
  const layers = new Int8Array(cells);
  const built = new Uint8Array(cells);
  const shares: (Float32Array | undefined)[] = new Array(Math.max(8, plan.layerNames.length)).fill(undefined);
  const sharesOf = (layer: number): Float32Array => (shares[layer] ??= new Float32Array(cells));
  const starkness = plan.layerNames.map((name) => textureStarkness(name));
  const edgeFade = plan.sets && setEdgeFade(plan.sets, width, height);
  for (let i = 0; i < cells; i++) {
    const zone = source[i]!;
    if (zone < 0) {
      sharesOf(0)[i] = 1;
      continue;
    }
    const base = plan.zoneLayers[zone]!;
    layers[i] = base;
    built[i] = plan.builtZones[zone] ? 1 : 0;
    const patches = plan.zonePatches[zone];
    let total = 0;
    if (patches) {
      const x = (i % width) + 0.5;
      const y = Math.floor(i / width) + 0.5;
      const fine = symmetricNoise((px, py) => valueNoise(px / MOTTLE_PERIOD, py / MOTTLE_PERIOD, 977), symmetry, 1)(x, y);
      const fade = edgeFade ? edgeFade[i]! : 1;
      // Each variety texture's wash, sharing the ground between them where they overlap.
      const own: { layer: number; share: number }[] = [];
      patches.layers.forEach((layer, index) => {
        if (layer === base || fade === 0) return;
        const stark = starkness[layer] ?? 0;
        const period = patches.period / (1 + (STARK_SCALE - 1) * stark);
        const n = symmetricNoise((px, py) => patchNoise(px, py, index, period), symmetry, 1)(x, y) + MOTTLE_DEPTH * fine;
        const threshold = patches.threshold + STARK_RARITY * stark;
        if (n <= threshold) return;
        const rise = Math.min(1, (n - threshold) / (PATCH_FEATHER + (STARK_FEATHER - PATCH_FEATHER) * stark));
        const share = fade * rise * rise * (3 - 2 * rise) * (1 - (1 - STARK_STRENGTH) * stark);
        total += share;
        own.push({ layer, share });
      });
      const scale = total > 1 ? 1 / total : 1;
      total = 0;
      let best = 0;
      for (const entry of own) {
        const share = entry.share * scale;
        sharesOf(entry.layer)[i]! += share;
        total += share;
        if (share > best) {
          best = share;
          layers[i] = entry.layer;
        }
      }
      total = Math.min(1, total);
      if (best < 1 - total) layers[i] = base;
    }
    sharesOf(base)[i]! += 1 - total;
  }
  return { layers, built, zone: source, shares };
}

/**
 * The Zone each cell takes its texture from: its own (`owner`, {@link zoneOwners}) when that Zone
 * is at the cell's cliff level, else the nearest same-level cell's that is, else its own; -1 for none.
 */
export function paintingZones(blueprint: Pick<MissionBlueprint, "mapSize" | "zones">, syncCliff: Uint16Array, owner: Int16Array): Int16Array {
  const { width, height } = blueprint.mapSize;
  const cells = width * height;
  const level = new Int8Array(cells);
  for (let i = 0; i < cells; i++) level[i] = Math.ceil(syncCliff[i]! / 64);

  const source = new Int16Array(cells).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < cells; i++) {
    const zone = owner[i]!;
    if (zone >= 0 && blueprint.zones[zone]!.elevation === level[i]) {
      source[i] = zone;
      queue.push(i);
    }
  }
  // Breadth-first across same-level ground from the cells that agree.
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % width;
    const y = Math.floor(i / width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (source[j] !== -1 || level[j] !== level[i]) continue;
      source[j] = source[i]!;
      queue.push(j);
    }
  }
  for (let i = 0; i < cells; i++) if (source[i]! < 0) source[i] = owner[i]!;
  return source;
}

/**
 * With texture sets, a block draws on one set: a cell whose texture its block's set hasn't (a Zone
 * of another set snapped into the block, or set 0's variety there) takes the texture most of the
 * block's other cells wear (the lower layer on a tie), else the set's first.
 */
function snapToSets(layers: Int8Array, plan: TexturePlan, width: number): void {
  const sets = plan.sets!;
  for (let block = 0; block < sets.blockSets.length; block++) {
    const set = sets.blockSets[block]!;
    const layerIn = sets.layerIn[set]!;
    const { x: bx, y: by } = blockOrigin(block, sets.blocksPerRow);
    const counts = new Map<number, number>();
    const off: number[] = [];
    for (let y = by; y < by + CELLS_PER_BLOCK; y++) {
      for (let x = bx; x < bx + CELLS_PER_BLOCK; x++) {
        const layer = layers[y * width + x]!;
        if (layerIn[layer]! >= 0) counts.set(layer, (counts.get(layer) ?? 0) + 1);
        else off.push(y * width + x);
      }
    }
    if (off.length === 0) continue;
    const most = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    const layer = most ?? plan.layerNames.indexOf(sets.names[set]!.find((name) => name !== "")!);
    for (const cell of off) layers[cell] = layer;
  }
}

/** How much of a patch each cell keeps beside a block of another texture set: 0 at the block line, 1 from SET_EDGE_FADE cells in. */
function setEdgeFade(sets: PlanSets, width: number, height: number): Float32Array {
  const fade = new Float32Array(width * height).fill(1);
  const rows = Math.ceil(height / CELLS_PER_BLOCK);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bx = Math.floor(x / CELLS_PER_BLOCK);
      const by = Math.floor(y / CELLS_PER_BLOCK);
      const set = sets.blockSets[by * sets.blocksPerRow + bx];
      let nearest = SET_EDGE_FADE;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx;
          const ny = by + dy;
          if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= sets.blocksPerRow || ny >= rows || sets.blockSets[ny * sets.blocksPerRow + nx] === set) continue;
          // The cell centre's distance to that block's nearest edge.
          const gapX = dx === 0 ? 0 : dx < 0 ? x + 0.5 - bx * CELLS_PER_BLOCK : (bx + 1) * CELLS_PER_BLOCK - (x + 0.5);
          const gapY = dy === 0 ? 0 : dy < 0 ? y + 0.5 - by * CELLS_PER_BLOCK : (by + 1) * CELLS_PER_BLOCK - (y + 0.5);
          nearest = Math.min(nearest, Math.max(gapX, gapY));
        }
      }
      fade[y * width + x] = Math.max(0, Math.min(1, (nearest - 0.5) / (SET_EDGE_FADE - 0.5)));
    }
  }
  return fade;
}

/**
 * Noise shaping variety patches: three scales, each on a lattice turned to its own angle, so the
 * patches' edges don't follow the square grid value noise is built on.
 */
function patchNoise(x: number, y: number, index: number, period: number): number {
  return PATCH_OCTAVES.reduce((sum, { weight, scale, angle }, octave) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const u = ((x * cos - y * sin) * scale) / period;
    const v = ((x * sin + y * cos) * scale) / period;
    return sum + weight * valueNoise(u, v, 300 + 10 * index + octave);
  }, 0);
}
const PATCH_OCTAVES = [
  { weight: 0.45, scale: 1, angle: 0.5 },
  { weight: 0.35, scale: 2.6, angle: 1.3 },
  { weight: 0.2, scale: 6, angle: 2.2 },
];

/** Turns the source side's weights (below the centre) onto the other side's cells and texels. */
function turnWeights(symmetry: Rot180, width: number, height: number, textureWeights: Uint8Array, texelWeights: Uint8Array): void {
  const texelWidth = width * TEXELS_PER_CELL;
  for (let y = symmetry.centre.y; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = sourceCell(symmetry, x, y, width, height);
      if (source.x === x && source.y === y) continue;
      textureWeights.copyWithin((y * width + x) * 8, (source.y * width + source.x) * 8, (source.y * width + source.x) * 8 + 8);
      for (let ty = 0; ty < TEXELS_PER_CELL; ty++) {
        for (let tx = 0; tx < TEXELS_PER_CELL; tx++) {
          const to = (y * TEXELS_PER_CELL + ty) * texelWidth + x * TEXELS_PER_CELL + tx;
          const from = (source.y * TEXELS_PER_CELL + TEXELS_PER_CELL - 1 - ty) * texelWidth + source.x * TEXELS_PER_CELL + TEXELS_PER_CELL - 1 - tx;
          texelWeights.copyWithin(to * 8, from * 8, from * 8 + 8);
        }
      }
    }
  }
}

/** Smooth value noise in [-1, 1]: bilinear between hashed lattice values, smoothstep-eased. */
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const salt = Math.imul(seed, 2147483647);
  const v00 = latticeValue(x0, y0, salt);
  const v01 = latticeValue(x0, y0 + 1, salt);
  const top = v00 + (latticeValue(x0 + 1, y0, salt) - v00) * sx;
  const bottom = v01 + (latticeValue(x0 + 1, y0 + 1, salt) - v01) * sx;
  return top + (bottom - top) * sy;
}

/** A lattice point's hashed value in [-1, 1]; `salt` is the seed, hashed (Math.imul(seed, 2147483647)). */
function latticeValue(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

/**
 * valueNoise(x / period, y / period, seed) across a grid, a row at a time, with symmetricNoise's
 * turn when there's a centre: the same arithmetic, but each column's lattice cell and easing are
 * worked out once, and the lattice is hashed once per row rather than four times per point.
 */
class GridNoise {
  private readonly direct: NoiseColumns;
  private readonly turned: NoiseColumns | undefined;
  private readonly scratch: Float64Array;
  private readonly centre: { readonly x: number; readonly y: number } | undefined;
  private readonly parity: 1 | -1;

  /** `xs` are the columns' x; with a centre, the noise is symmetricNoise's of that parity about it. */
  constructor(xs: Float64Array, period: number, seed: number, centre: { readonly x: number; readonly y: number } | undefined, parity: 1 | -1) {
    this.centre = centre;
    this.parity = parity;
    this.direct = new NoiseColumns(xs, period, seed);
    this.turned = centre && new NoiseColumns(xs.map((x) => 2 * centre.x - x), period, seed);
    this.scratch = new Float64Array(xs.length);
  }

  /** The noise at each column, at `y`, into `out`. */
  row(y: number, out: Float64Array): void {
    this.direct.row(y, out);
    if (!this.turned) return;
    const turned = this.scratch;
    this.turned.row(2 * this.centre!.y - y, turned);
    for (let i = 0; i < out.length; i++) out[i] = (out[i]! + this.parity * turned[i]!) * Math.SQRT1_2;
  }
}

/** valueNoise(x / period, y / period, seed) at fixed columns x, as valueNoise works it out, a row at a time. */
class NoiseColumns {
  /** Each column's lattice cell, counted from `first`, and its smoothstep easing. */
  private readonly cell: Int32Array;
  private readonly ease: Float64Array;
  private readonly first: number;
  /** The lattice values along the row's lower and upper lattice lines, from `first`. */
  private readonly lower: Float64Array;
  private readonly upper: Float64Array;
  private readonly salt: number;
  private readonly period: number;
  /** The lower lattice line `lower` and `upper` hold, NaN before the first row. */
  private y0 = Number.NaN;

  constructor(xs: Float64Array, period: number, seed: number) {
    this.period = period;
    const x0s = xs.map((x) => Math.floor(x / period));
    this.first = Math.min(...x0s);
    this.cell = Int32Array.from(x0s, (x0) => x0 - this.first);
    this.ease = xs.map((x, i) => {
      const fx = x / period - x0s[i]!;
      return fx * fx * (3 - 2 * fx);
    });
    const span = Math.max(...x0s) - this.first + 2;
    this.lower = new Float64Array(span);
    this.upper = new Float64Array(span);
    this.salt = Math.imul(seed, 2147483647);
  }

  row(y: number, out: Float64Array): void {
    const v = y / this.period;
    const y0 = Math.floor(v);
    const fy = v - y0;
    const sy = fy * fy * (3 - 2 * fy);
    const { lower, upper, cell, ease } = this;
    if (y0 !== this.y0) {
      for (let k = 0; k < lower.length; k++) {
        lower[k] = latticeValue(this.first + k, y0, this.salt);
        upper[k] = latticeValue(this.first + k, y0 + 1, this.salt);
      }
      this.y0 = y0;
    }
    for (let i = 0; i < out.length; i++) {
      const k = cell[i]!;
      const sx = ease[i]!;
      const v00 = lower[k]!;
      const v01 = upper[k]!;
      const top = v00 + (lower[k + 1]! - v00) * sx;
      const bottom = v01 + (upper[k + 1]! - v01) * sx;
      out[i] = top + (bottom - top) * sy;
    }
  }
}

/** Cells within `reach` (a square) of any marked cell. */
function dilate(marked: Uint8Array, width: number, height: number, reach: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let cell = 0; cell < width * height; cell++) {
    if (!marked[cell]) continue;
    const x = cell % width;
    const y = Math.floor(cell / width);
    for (let ny = Math.max(0, y - reach); ny <= Math.min(height - 1, y + reach); ny++) {
      for (let nx = Math.max(0, x - reach); nx <= Math.min(width - 1, x + reach); nx++) out[ny * width + nx] = 1;
    }
  }
  return out;
}

/** Box blur in place along rows then columns, clamped at the edges; `scratch`, if given, is a spare array of the values' size. */
function boxBlur(values: Float32Array, width: number, height: number, radius: number, scratch?: Float32Array): void {
  const span = 2 * radius + 1;
  // A row with its edge values repeated `radius` (and one more) past each end, so the window needs no clamping.
  const line = new Float32Array(width + 2 * radius + 1);
  for (let start = 0; start < width * height; start += width) {
    for (let i = 0; i < line.length; i++) line[i] = values[start + Math.min(width - 1, Math.max(0, i - radius))]!;
    let sum = 0;
    for (let k = 0; k <= 2 * radius; k++) sum += line[k]!;
    for (let b = 0; b < width; b++) {
      values[start + b] = sum / span;
      sum += line[b + 2 * radius + 1]! - line[b]!;
    }
  }
  // The columns side by side, a row at a time (each column's sum adds up in the same order as
  // blurring it alone would), so the pass reads memory in order.
  const rows = scratch ?? new Float32Array(values.length);
  rows.set(values);
  const sums = new Float64Array(width);
  for (let k = -radius; k <= radius; k++) {
    const from = Math.min(height - 1, Math.max(0, k)) * width;
    for (let x = 0; x < width; x++) sums[x]! += rows[from + x]!;
  }
  for (let b = 0; b < height; b++) {
    const to = b * width;
    const ahead = Math.min(height - 1, b + radius + 1) * width;
    const behind = Math.max(0, b - radius) * width;
    for (let x = 0; x < width; x++) {
      values[to + x] = sums[x]! / span;
      sums[x]! += rows[ahead + x]! - rows[behind + x]!;
    }
  }
}

/** Weights summing to 15 from shares summing to 1: floors, then the largest remainders (the lower layer on a tie). */
function quantize(shares: ArrayLike<number>, out: Uint8Array, offset: number): void {
  const floors = QUANTIZE_FLOORS;
  const rests = QUANTIZE_RESTS;
  let left = FULL;
  for (let layer = 0; layer < 8; layer++) {
    const scaled = shares[layer]! * FULL;
    floors[layer] = Math.floor(scaled);
    rests[layer] = scaled - floors[layer]!;
    left -= floors[layer]!;
  }
  // The largest remainders first, as a stable sort by remainder would take them.
  let taken = 0;
  for (let step = 0; step < 8 && left > 0; step++, left--) {
    let best = -1;
    for (let layer = 0; layer < 8; layer++) {
      if (taken & (1 << layer)) continue;
      if (best < 0 || rests[layer]! > rests[best]!) best = layer;
    }
    taken |= 1 << best;
    floors[best]!++;
  }
  for (let layer = 0; layer < 8; layer++) out[offset + layer] = floors[layer]!;
}
/** quantize's scratch: its 8 floors and remainders. */
const QUANTIZE_FLOORS = new Int32Array(8);
const QUANTIZE_RESTS = new Float64Array(8);

/** A cell-resolution grid sampled bilinearly from cell `c`: `dx`, `dy` its offsets, `ax`, `ay` one less them. */
function bilinear(grid: Float32Array, c: number, width: number, dx: number, ax: number, dy: number, ay: number): number {
  return (grid[c]! * ax + grid[c + 1]! * dx) * ay + (grid[c + width]! * ax + grid[c + width + 1]! * dx) * dy;
}

/** The Blueprint's Paint Regions rasterised over a generated map: each cell on its block's set, set 0 the map's textures. */
function paintRegionsOver(blueprint: MissionBlueprint, plan: TexturePlan, owner: Int16Array, symmetric: boolean): RasterisedRegion[] {
  if (!blueprint.paintRegions?.length) return [];
  // A melee map's two halves are one paint turned (turnWeights), so a region on one side would be copied onto the other.
  if (symmetric) throw new Error("A melee map has no Paint Regions: its two halves are painted alike");
  const sets = plan.sets;
  return rasterisePaintRegions(blueprint.paintRegions, {
    width: blueprint.mapSize.width,
    height: blueprint.mapSize.height,
    owner,
    zones: blueprint.zones,
    setOf: (x, y) => (sets ? sets.blockSets[blockOf(sets.blocksPerRow, x, y)]! : 0),
    setTextures: (set) => (sets ? sets.names[set]! : plan.layerNames.slice(0, 8)),
    setLabel: (set) => (set === 0 ? "the map's textures (set 0)" : `texture set ${sets?.ids[set] ?? set}`),
  });
}

/** The Zones' textures, blended, then the Paint Regions over them; `owner` is each cell's Zone ({@link zoneOwners}). */
export function paintTextures(blueprint: MissionBlueprint, plan: TexturePlan, syncCliff: Uint16Array, owner: Int16Array, symmetry?: Rot180): PaintedTextures {
  const { width, height } = blueprint.mapSize;
  const { layers, built, zone, shares: layerShares } = cellTextureLayers(blueprint, plan, syncCliff, owner, symmetry);
  if (plan.sets) {
    if (symmetry) throw new Error("A melee map has one texture set: its textures are `textures` and `texturePalette`");
    snapToSets(layers, plan, width);
    // A cell with a texture its block's set lacks wears the snapped texture alone.
    const sets = plan.sets;
    for (let cell = 0; cell < layers.length; cell++) {
      const layerIn = sets.layerIn[sets.blockSets[blockOf(sets.blocksPerRow, cell % width, Math.floor(cell / width))]!]!;
      let dominant = -1;
      let most = 0;
      let off = false;
      layerShares.forEach((share, layer) => {
        const value = share?.[cell] ?? 0;
        if (value > 0 && layerIn[layer]! < 0) off = true;
        if (value > most) {
          most = value;
          dominant = layer;
        }
      });
      if (!off && dominant === layers[cell]) continue;
      for (const share of layerShares) if (share) share[cell] = 0;
      (layerShares[layers[cell]!] ??= new Float32Array(layers.length))[cell] = 1;
    }
  }
  // The per-texel loops below run millions of times a compile, so they call no closures and
  // allocate nothing: what they need per texel is worked out per cell or per row first.
  const centre = symmetry?.centre;
  const texelWidth = width * TEXELS_PER_CELL;
  const texelHeight = height * TEXELS_PER_CELL;
  const texels = texelWidth * texelHeight;
  /** Each texel's cell. */
  const texelCell = new Int32Array(texels);
  for (let ty = 0, t = 0; ty < texelHeight; ty++) {
    const row = Math.floor(ty / TEXELS_PER_CELL) * width;
    for (let tx = 0; tx < texelWidth; tx++, t++) texelCell[t] = row + Math.floor(tx / TEXELS_PER_CELL);
  }
  const cellLevel = Int8Array.from(syncCliff, (value) => Math.ceil(value / 64));

  // What each texel shows before softening: the shares of the cell under a noise-warped position.
  const used = layerShares.flatMap((share, layer) => (share ? [layer] : []));
  const fields: (Float32Array | undefined)[] = new Array(Math.max(8, plan.layerNames.length)).fill(undefined);
  for (const layer of used) fields[layer] = new Float32Array(texels);
  /** fields[used[index]], by index. */
  const usedFields = used.map((layer) => fields[layer]!);
  const usedShares = used.map((layer) => layerShares[layer]!);
  /** Each texel column's x, in cells. */
  const xs = Float64Array.from({ length: texelWidth }, (_, tx) => (tx + 0.5) / TEXELS_PER_CELL);
  const warpNoise = WARP_OCTAVES.map(({ period }, octave) => [1 + 2 * octave, 2 + 2 * octave].map((seed) => new GridNoise(xs, period, seed, centre, -1)) as [GridNoise, GridNoise]);
  const wxs = new Float64Array(texelWidth);
  const wys = new Float64Array(texelWidth);
  const noiseX = new Float64Array(texelWidth);
  const noiseY = new Float64Array(texelWidth);
  for (let ty = 0; ty < texelHeight; ty++) {
    const y = (ty + 0.5) / TEXELS_PER_CELL;
    wxs.set(xs);
    wys.fill(y);
    for (let octave = 0; octave < WARP_OCTAVES.length; octave++) {
      const { cells } = WARP_OCTAVES[octave]!;
      warpNoise[octave]![0].row(y, noiseX);
      warpNoise[octave]![1].row(y, noiseY);
      for (let tx = 0; tx < texelWidth; tx++) {
        wxs[tx]! += cells * noiseX[tx]!;
        wys[tx]! += cells * noiseY[tx]!;
      }
    }
    for (let tx = 0, t = ty * texelWidth; tx < texelWidth; tx++, t++) {
      const cx = Math.min(width - 1, Math.max(0, Math.floor(wxs[tx]!)));
      const cy = Math.min(height - 1, Math.max(0, Math.floor(wys[tx]!)));
      // Seams wander across flat ground only: across a cliff, or at a built zone's edge, the texel
      // keeps its own cell.
      const own = texelCell[t]!;
      const warped = cy * width + cx;
      const wander = cellLevel[warped] === cellLevel[own] && !built[own] && !built[warped];
      const cell = wander ? warped : own;
      for (let index = 0; index < usedShares.length; index++) usedFields[index]![t] = usedShares[index]![cell]!;
    }
  }
  // Built zones' edges stay crisp: texels within reach of a built cell (as far as the wide blend
  // spreads) take a short blend of their texture instead of the seams' wide one.
  const crisp = dilate(built, width, height, CRISP_REACH_CELLS);
  const blurScratch = new Float32Array(texels);
  const unblended = crisp.some(Boolean)
    ? usedFields.map((source) => {
        const field = Float32Array.from(source);
        boxBlur(field, texelWidth, texelHeight, CRISP_BLUR_TEXELS, blurScratch);
        return field;
      })
    : undefined;
  if (used.length > 1) {
    // How wide the blend is at each texel: 0 narrow, 1 wide.
    const mix = new Float32Array(texels);
    // Sampled at the texel's lower-left corner, by texel index: in those units the centre that turns
    // each texel onto its partner sits half a texel below and left of the map's centre.
    const texelCentre = centre && { x: centre.x * TEXELS_PER_CELL - 0.5, y: centre.y * TEXELS_PER_CELL - 0.5 };
    // A period of BLEND_MIX_PERIOD cells, in texels (dividing by TEXELS_PER_CELL first, a power of
    // two, is exact, so this is the same noise).
    const mixNoise = new GridNoise(
      Float64Array.from({ length: texelWidth }, (_, tx) => tx),
      TEXELS_PER_CELL * BLEND_MIX_PERIOD,
      99,
      texelCentre,
      1,
    );
    const noise = new Float64Array(texelWidth);
    for (let ty = 0, t = 0; ty < texelHeight; ty++) {
      mixNoise.row(ty, noise);
      for (let tx = 0; tx < texelWidth; tx++, t++) mix[t] = Math.min(1, Math.max(0, 0.75 + noise[tx]!));
    }
    // The wide blend stays on its own cliff level, or plateau and ground textures would halo each
    // other's rims: per level, it's a blur of that level's cells only, renormalised (a normalised
    // convolution), at cell resolution and sampled bilinearly. The narrow blend may cross a cliff,
    // softening the lip as before.
    // A ramp joins its bottom level too, so its texture and the ground at its foot blend into each
    // other (the usual practice); its texels look up the bottom level's blend.
    const isRamp = Uint8Array.from(syncCliff, (value) => (value % 64 === 0 ? 0 : 1));
    const blendLevel = Int8Array.from(syncCliff, (value, cell) => (isRamp[cell] ? Math.floor(value / 64) : cellLevel[cell]!));
    // Near a ramp the blend is always the wide one.
    const nearRamp = dilate(isRamp, width, height, RAMP_BLEND_CELLS);
    // The wide blend joins textures of one blend group (the Style Pack's rule): each (level, group)
    // is blurred on its own and renormalised, and replaces only the narrow blend's same-group share,
    // so different groups keep the narrow seam between them. Round a ramp every texture is one
    // group (ANY_GROUP, which no rule's group name can be), so a ramp still fades into the ground at its foot.
    // A stark variety texture keeps to its dabs: on its own in a group, the wide blend doesn't spread
    // it, since even a thin spread of it reads as the texture itself.
    const starkVariety = new Set<number>();
    for (const patches of plan.zonePatches) for (const layer of patches?.layers ?? []) if (textureStarkness(plan.layerNames[layer]!) >= 0.5) starkVariety.add(layer);
    const groupOf = (layer: number): string => (starkVariety.has(layer) ? `stark variety ${layer}` : plan.blendGroups[layer]!);
    const cellGroup: (string | typeof ANY_GROUP)[] = Array.from(layers, (layer, cell) => (nearRamp[cell] ? ANY_GROUP : groupOf(layer)));
    const cellScratch = new Float32Array(width * height);
    /** The wide blend's blur, in place. */
    const cellBlur = (values: Float32Array): Float32Array => {
      boxBlur(values, width, height, WIDE_BLUR_CELLS, cellScratch);
      boxBlur(values, width, height, WIDE_BLUR_CELLS, cellScratch);
      return values;
    };
    // A cell at a time, adding its texels in texel order (rounded to a float each time, as a
    // Float32Array's += is), so each cell's mean is the same as adding in texel order across the map.
    const cellMean = usedFields.map((field) => {
      const mean = new Float32Array(width * height);
      for (let cell = 0; cell < width * height; cell++) {
        const first = Math.floor(cell / width) * TEXELS_PER_CELL * texelWidth + (cell % width) * TEXELS_PER_CELL;
        let sum = 0;
        for (let ty = 0; ty < TEXELS_PER_CELL; ty++) {
          for (let tx = 0, t = first + ty * texelWidth; tx < TEXELS_PER_CELL; tx++, t++) sum = Math.fround(sum + field[t]! / (TEXELS_PER_CELL * TEXELS_PER_CELL));
        }
        mean[cell] = sum;
      }
      return mean;
    });
    // wide.get(level).get(group)[index]: the wide share of layer used[index] around each cell,
    // among that level's cells of that group.
    const wide = new Map<number, Map<string | typeof ANY_GROUP, Float32Array[]>>();
    for (const level of new Set(cellLevel)) {
      for (const group of new Set(cellGroup)) {
        const mask = new Float32Array(width * height);
        let any = false;
        for (let cell = 0; cell < width * height; cell++) {
          if ((cellLevel[cell] === level || blendLevel[cell] === level) && cellGroup[cell] === group) {
            mask[cell] = 1;
            any = true;
          }
        }
        if (!any) continue;
        const maskBlur = cellBlur(Float32Array.from(mask));
        if (!wide.has(level)) wide.set(level, new Map());
        wide.get(level)!.set(
          group,
          cellMean.map((mean) => {
            const share = new Float32Array(width * height);
            for (let cell = 0; cell < width * height; cell++) share[cell] = mean[cell]! * mask[cell]!;
            cellBlur(share);
            for (let cell = 0; cell < width * height; cell++) share[cell] = maskBlur[cell]! > 1e-6 ? share[cell]! / maskBlur[cell]! : 0;
            return share;
          }),
        );
      }
    }
    // Per cell, the wide shares its texels read (its level's and, on a ramp, its bottom level's),
    // and which of the used layers are in its group (1) or not (0).
    const membersOf = new Map<string | typeof ANY_GROUP, Uint8Array>();
    for (const group of new Set(cellGroup)) membersOf.set(group, Uint8Array.from(used, (layer) => (group === ANY_GROUP || groupOf(layer) === group ? 1 : 0)));
    const cellTop: Float32Array[][] = [];
    const cellBottom: Float32Array[][] = [];
    const cellMembers: Uint8Array[] = [];
    for (let cell = 0; cell < width * height; cell++) {
      const group = cellGroup[cell]!;
      const top = wide.get(cellLevel[cell]!)!.get(group)!;
      cellTop.push(top);
      cellBottom.push(wide.get(blendLevel[cell]!)?.get(group) ?? top);
      cellMembers.push(membersOf.get(group)!);
    }
    for (const field of usedFields) {
      boxBlur(field, texelWidth, texelHeight, NARROW_BLUR_TEXELS, blurScratch);
      boxBlur(field, texelWidth, texelHeight, NARROW_BLUR_TEXELS, blurScratch);
    }
    // Bilinear between cell centres: each texel column's cell and offset.
    const columnX0 = new Int32Array(texelWidth);
    const columnDx = new Float64Array(texelWidth);
    for (let tx = 0; tx < texelWidth; tx++) {
      const fx = Math.min(width - 1, Math.max(0, (tx + 0.5) / TEXELS_PER_CELL - 0.5));
      columnX0[tx] = Math.min(width - 2, Math.floor(fx));
      columnDx[tx] = fx - columnX0[tx]!;
    }
    const count = used.length;
    const values = new Float64Array(count);
    for (let ty = 0; ty < texelHeight; ty++) {
      const fy = Math.min(height - 1, Math.max(0, (ty + 0.5) / TEXELS_PER_CELL - 0.5));
      const y0 = Math.min(height - 2, Math.floor(fy));
      const dy = fy - y0;
      const ay = 1 - dy;
      for (let tx = 0; tx < texelWidth; tx++) {
        const t = ty * texelWidth + tx;
        const own = texelCell[t]!;
        // On a ramp, the bottom level's blend at its foot, the top's at its top.
        const up = isRamp[own] ? (syncCliff[own]! % 64) / 64 : 1;
        const m = nearRamp[own] ? 1 : mix[t]!;
        if (m === 0) continue;
        const top = cellTop[own]!;
        const bottom = cellBottom[own]!;
        const members = cellMembers[own]!;
        const x0 = columnX0[tx]!;
        const dx = columnDx[tx]!;
        const ax = 1 - dx;
        const c = y0 * width + x0;
        // The narrow blend's share of this cell's group, spread wide among that group's textures.
        // (The wide values are renormalised over the group's textures: warped texels of another
        // group can sit in a group's cells.)
        let same = 0;
        let wideTotal = 0;
        for (let index = 0; index < count; index++) {
          if (!members[index]) continue;
          same += usedFields[index]![t]!;
          const value =
            up === 1
              ? bilinear(top[index]!, c, width, dx, ax, dy, ay)
              : bilinear(bottom[index]!, c, width, dx, ax, dy, ay) * (1 - up) + bilinear(top[index]!, c, width, dx, ax, dy, ay) * up;
          wideTotal += value;
          values[index] = value;
        }
        if (wideTotal <= 1e-6) continue;
        for (let index = 0; index < count; index++) {
          if (!members[index]) continue;
          const field = usedFields[index]!;
          field[t] = field[t]! + m * ((same * values[index]!) / wideTotal - field[t]!);
        }
      }
    }
  }

  if (unblended) {
    for (let t = 0; t < texels; t++) {
      if (!crisp[texelCell[t]!]) continue;
      for (let index = 0; index < used.length; index++) usedFields[index]![t] = unblended[index]![t]!;
    }
  }

  const texelWeights = new Uint8Array(texels * 8);
  const cellShares = new Float32Array(width * height * 8);
  const shares = new Float64Array(8);
  const sets = plan.sets;
  // With texture sets, each cell's set, its layers, and the layer its own texture is on there.
  const cellSet = new Uint8Array(sets ? width * height : 0);
  const cellLayerIn: Int8Array[] = [];
  const cellOwnLayer = new Int8Array(sets ? width * height : 0);
  if (sets) {
    for (let cell = 0; cell < width * height; cell++) {
      cellSet[cell] = sets.blockSets[blockOf(sets.blocksPerRow, cell % width, Math.floor(cell / width))]!;
      const layerIn = sets.layerIn[cellSet[cell]!]!;
      cellLayerIn.push(layerIn);
      cellOwnLayer[cell] = layerIn[layers[cell]!]!;
    }
  }
  // The Paint Regions over the Zones' paint (ADR-0028), on each cell's set's layers.
  const regions = paintRegionsOver(blueprint, plan, owner, symmetry !== undefined);
  const regionCells = new Uint8Array(regions.length > 0 ? width * height : 0);
  for (const region of regions) for (let cell = 0; cell < regionCells.length; cell++) regionCells[cell] ||= region.cells[cell]!;
  for (let t = 0; t < texels; t++) {
    for (let layer = 0; layer < 8; layer++) shares[layer] = 0;
    const cell = texelCell[t]!;
    if (regionCells[cell]) {
      // A painted texel's weights come from its shares on every layer, dithered (paint-regions.ts).
      const layerIn = sets ? cellLayerIn[cell]! : undefined;
      const ownLayer = sets ? cellOwnLayer[cell]! : 0;
      for (let index = 0; index < used.length; index++) {
        const setLayer = layerIn ? layerIn[used[index]!]! : used[index]!;
        shares[setLayer >= 0 ? setLayer : ownLayer]! += usedFields[index]![t]!;
      }
      const tx = t % texelWidth;
      const ty = (t - tx) / texelWidth;
      applyPaintRegions(regions, shares, tx, ty, sets ? cellSet[cell]! : 0);
      quantizeDithered(shares, texelWeights, t * 8, ditherThreshold(tx, ty));
      for (let layer = 0; layer < 8; layer++) cellShares[cell * 8 + layer]! += shares[layer]! / (TEXELS_PER_CELL * TEXELS_PER_CELL);
      continue;
    }
    let pure = -1;
    if (sets) {
      // Each texture's share goes on its layer in the cell's block's set; one the set hasn't (blended
      // in from a block of another set) goes to the cell's own texture, so a set's edge is a clean cut.
      const layerIn = cellLayerIn[cell]!;
      const ownLayer = cellOwnLayer[cell]!;
      for (let index = 0; index < used.length; index++) {
        const setLayer = layerIn[used[index]!]!;
        shares[setLayer >= 0 ? setLayer : ownLayer]! += usedFields[index]![t]!;
      }
      for (let layer = 0; layer < 8; layer++) if (shares[layer]! > 0.9999) pure = layer;
    } else {
      for (let index = 0; index < used.length; index++) {
        const layer = used[index]!;
        const share = usedFields[index]![t]!;
        shares[layer] = share;
        if (share > 0.9999) pure = layer;
      }
    }
    // Most texels show one texture; only seams need sharing out.
    if (pure >= 0) texelWeights[t * 8 + pure] = FULL;
    else quantize(shares, texelWeights, t * 8);
    if (sets) for (let layer = 0; layer < 8; layer++) cellShares[cell * 8 + layer]! += shares[layer]! / (TEXELS_PER_CELL * TEXELS_PER_CELL);
    else for (let index = 0; index < used.length; index++) cellShares[cell * 8 + used[index]!]! += shares[used[index]!]! / (TEXELS_PER_CELL * TEXELS_PER_CELL);
  }
  const textureWeights = new Uint8Array(width * height * 8);
  for (let cell = 0; cell < width * height; cell++) quantize(cellShares.subarray(cell * 8, cell * 8 + 8), textureWeights, cell * 8);
  if (symmetry) turnWeights(symmetry, width, height, textureWeights, texelWeights);
  return { textureWeights, texelWeights, warnings: cliffWarnings(blueprint, plan, layers, zone, syncCliff) };
}
