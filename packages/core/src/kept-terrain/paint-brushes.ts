// Paint brushes on Kept ground (spec #247): paint an area with one of the map's textures, swap
// one of its texture slots for another texture map-wide, and move blocks onto another texture set.
//
// - A map has up to 8 texture sets of 8 textures (#253, docs/reference/terrain-file-formats.md,
//   "Texture sets"). Set s owns slots 8s to 8s+7 of t3Terrain.xml's <textureList>, and each 8×8-cell
//   block draws on one set (<blockTextureSetList>). A map with one set uses slots 0-7.
// - t3TextureMasks holds 8 planar layers of 4-bit weights, 8 texels per cell, whatever the sets:
//   layer l of a texel means texture l of its block's set. The Editor's brush keeps every texel's 8
//   weights summing to 15 (all 4,194,304 texels of a 256×256 Kept map do).
// - A stroke feathers at the masks' own resolution: each texel's strength is 1 in a cell inside the
//   area and fades smoothly to 0 over the falloff's width, by its distance from the area. Its
//   weights move that far towards all 15 on the painted layer, rounded so they still sum to 15.
// - As in the Editor, a stroke paints only blocks whose set holds the texture, and leaves the
//   texels within 2 of a block of another set as they are. A texture in several sets paints each
//   set's blocks on its own layer there.
// - t3SyncTextureInfo gives each cell its dominant texture (the layer with the most weight over the
//   cell's 64 texels, the lower layer on a tie, all 65,536 cells of a 256×256 Kept map agree) and its
//   block's set. It is rewritten for each cell a stroke changes.
// - A slot swap changes only names: t3Terrain.xml's <texture> for the slot and the sync file's copy.
//   The masks stay as they are, so every cell painted with the slot changes look. It is shown first
//   (the slot's reach) and needs the author's yes.
// - Emptying a slot (clear-slot) writes its name as "" in the same two places, the Editor's own form
//   for an empty slot. It is refused while any cell of the slot's set has weight on its layer or has
//   it as its sync texture, so it changes no cell's look and needs no yes.
// - Moving blocks onto another set (the Editor's Texture Set brush) changes only their tileSet and
//   their cells' set in the sync file: each texel keeps its weights, so its textures swap slot for
//   slot. It is shown first and needs the author's yes.
// - Only the bytes of changed texels, cells and entries are rewritten; every other byte stays the
//   Editor's.

import { type Catalog, layerSource } from "../catalog/catalog-layer.js";
import { z } from "zod";

import { isKnownTexture } from "../catalog/tileset-textures.js";
import { readT3TerrainXml } from "../terrain/read-t3-terrain-xml.js";
import { readT3TextureMasks, type T3TextureMasks } from "../terrain/read-t3-texture-masks.js";
import { blockOf, blockOrigin, CELLS_PER_BLOCK, distanceToCell, feather, FULL_WEIGHT, LAYERS, SETS, TEXELS_PER_CELL } from "../terrain/texture-grid.js";
import { applyPaintRegions, ditherThreshold, quantizeDithered, type RasterisedRegion } from "../terrain/paint-regions.js";
import type { AreaMask, CellRect } from "./area.js";

const MASK_HEADER = 64;
/** t3SyncTextureInfo's header: magic, version, width, height and set_count, 4 bytes each. */
export const SYNC_HEADER = 20;
const TEXELS_PER_TILE = 64;
const BYTES_PER_TILE = (TEXELS_PER_TILE * TEXELS_PER_TILE) / 2;
const TEXELS_PER_BLOCK = CELLS_PER_BLOCK * TEXELS_PER_CELL;
const FULL = FULL_WEIGHT;
/** The Editor leaves this many texels unpainted on each side of a boundary between sets. */
const SET_BAND = 2;
/** How deep, in texels from a boundary between sets, a texture counts as meeting the other side. */
export const SEAM_DEPTH = SET_BAND + 2;
/** The most distinct textures a map may use, across all its sets (the Editor's limit). */
export const MAX_TEXTURES = 16;
/** A slot reaches a cell where it has at least this share of the cell's weight. */
export const REACH_SHARE = 0.1;

const SlotSchema = z.union([z.number().int().min(0).max(63), z.string().min(1)]);
const SetSchema = z.union([z.number().int().min(0).max(7), z.string().min(1)]);
export const PaintBrushSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("paint"), texture: SlotSchema.describe("One of the map's textures: its name, or its slot (0-7 in set 0, 8s to 8s+7 in set s)") }).strict(),
  z
    .object({
      op: z.literal("swap-slot"),
      slot: SlotSchema.describe("The slot to swap: 0-7 in set 0, 8s to 8s+7 in set s, or the name of the texture in it now"),
      texture: z.string().regex(/^[\w.-]+$/).describe("The texture to put in the slot, by its CTerrainTex id"),
    })
    .strict(),
  z.object({ op: z.literal("set-blocks"), set: SetSchema.describe("The texture set to move the area's 8×8-cell blocks onto: its index 0-7 or its name") }).strict(),
  z.object({ op: z.literal("clear-slot"), slot: SlotSchema.describe("The slot to empty, painted nowhere in its set's blocks: 0-7 in set 0, 8s to 8s+7 in set s, or the name of the texture in it") }).strict(),
]);
export type PaintBrush = z.input<typeof PaintBrushSchema>;
export type ParsedPaintBrush = z.output<typeof PaintBrushSchema>;

const PAINT_OPS: ReadonlySet<string> = new Set(PaintBrushSchema.options.map((option) => option.shape.op.value));
export const isPaintBrush = (brush: { readonly op: string }): brush is ParsedPaintBrush => PAINT_OPS.has(brush.op);
export const isSlotSwap = (brush: { readonly op: string }): brush is Extract<ParsedPaintBrush, { op: "swap-slot" }> => brush.op === "swap-slot";
/** The brushes that change a slot map-wide, with no area: a slot swap and emptying a slot. */
export const isSlotEdit = (brush: { readonly op: string }): brush is Extract<ParsedPaintBrush, { op: "swap-slot" | "clear-slot" }> => brush.op === "swap-slot" || brush.op === "clear-slot";

/** The files a paint stroke writes, those a slot swap or emptying a slot writes, and those a block move writes. */
export const PAINT_FILES = ["t3TextureMasks", "t3SyncTextureInfo"] as const;
export const SWAP_FILES = ["t3Terrain.xml", "t3SyncTextureInfo"] as const;
export const SET_BLOCK_FILES = ["t3Terrain.xml", "t3SyncTextureInfo"] as const;

export type KeptTextures = {
  readonly width: number;
  readonly height: number;
  /** The map's 64 texture slots: set s holds slots 8s to 8s+7. */
  readonly slots: readonly string[];
  /** The 8 sets' names ("" for a set the map doesn't have). */
  readonly sets: readonly string[];
  /** The sets t3SyncTextureInfo holds names for (its set_count). */
  readonly setCount: number;
  /** Each 8×8-cell block's set: [blockY * blocksPerRow + blockX]. */
  readonly blockSets: Uint8Array;
  readonly blocksPerRow: number;
  readonly masks: T3TextureMasks;
  readonly masksFile: Buffer;
  readonly syncFile: Buffer;
  /** The sync file's own copy of the names, setCount × 8 of them. */
  readonly syncNames: readonly string[];
  /** Where the sync file's cells start, after its header and names. */
  readonly syncCells: number;
};

/** The set a cell's block draws on. */
export const cellSet = (textures: KeptTextures, cellX: number, cellY: number): number => textures.blockSets[blockOf(textures.blocksPerRow, cellX, cellY)]!;
/** Whether the map uses more than one texture set. */
export const usesSets = (textures: KeptTextures): boolean => textures.setCount > 1 || textures.blockSets.some((set) => set !== 0);
/** The texture each layer shows in a set. */
export const setTextures = (textures: KeptTextures, set: number): readonly string[] => textures.slots.slice(set * LAYERS, set * LAYERS + LAYERS);

/** Reads the package's textures from its t3Terrain.xml, t3TextureMasks and t3SyncTextureInfo, refusing what it can't edit. */
export function readKeptTextures(terrainXml: string, masksFile: Buffer, syncFile: Buffer): KeptTextures {
  const terrain = readT3TerrainXml(terrainXml);
  const { width, height } = terrain;
  if (masksFile.toString("ascii", 0, 4) !== "MASK" || masksFile.readUInt32LE(4) !== 102) throw new Error("t3TextureMasks isn't a MASK version 102 file, so it isn't edited");
  const maskWidth = width * TEXELS_PER_CELL;
  const maskHeight = height * TEXELS_PER_CELL;
  if (maskWidth % TEXELS_PER_TILE !== 0 || maskHeight % TEXELS_PER_TILE !== 0) throw new Error(`The map is ${width}×${height} cells, and t3TextureMasks needs a multiple of 8 each way, so it isn't edited`);
  if (masksFile.readUInt32LE(12) !== maskWidth || masksFile.readUInt32LE(16) !== maskHeight || masksFile.length !== MASK_HEADER + (LAYERS * maskWidth * maskHeight) / 2) {
    throw new Error(`t3TextureMasks isn't ${maskWidth}×${maskHeight} texels (8 per cell of the ${width}×${height} map t3Terrain.xml gives), so it isn't edited`);
  }
  if (syncFile.toString("ascii", 0, 4) !== "RTXT" || syncFile.readUInt32LE(4) !== 101) throw new Error("t3SyncTextureInfo isn't an RTXT version 101 file, so it isn't edited");
  const setCount = syncFile.readUInt32LE(16);
  if (syncFile.readUInt32LE(8) !== width || syncFile.readUInt32LE(12) !== height || setCount < 1 || setCount > SETS) {
    throw new Error(`t3SyncTextureInfo isn't 1-8 texture sets over ${width}×${height} cells, as t3Terrain.xml says, so it isn't edited`);
  }
  let syncCells = SYNC_HEADER;
  const syncNames: string[] = [];
  for (let name = 0; name < setCount * LAYERS; name++) {
    const end = syncFile.indexOf(0, syncCells);
    if (end < 0) throw new Error("t3SyncTextureInfo's texture names don't end, so it isn't edited");
    syncNames.push(syncFile.toString("ascii", syncCells, end));
    syncCells = end + 1;
  }
  if (syncFile.length !== syncCells + width * height * 8) throw new Error(`t3SyncTextureInfo isn't ${width}×${height} cells long, so it isn't edited`);

  const blocksPerRow = width / CELLS_PER_BLOCK;
  const blockSets = new Uint8Array(blocksPerRow * (height / CELLS_PER_BLOCK));
  for (let block = 0; block < blockSets.length; block++) {
    const set = terrain.blockTextureSets[block] ?? 0;
    if (!Number.isInteger(set) || set < 0 || set >= setCount) {
      throw new Error(`Block ${block} of t3Terrain.xml draws on texture set ${set}, which t3SyncTextureInfo has no names for (it holds ${setCount}), so the textures aren't edited`);
    }
    blockSets[block] = set;
  }
  const slots = Array.from({ length: SETS * LAYERS }, (_, slot) => terrain.textures[slot] ?? "");
  const textures: KeptTextures = { width, height, slots, sets: terrain.textureSets, setCount, blockSets, blocksPerRow, masks: readT3TextureMasks(masksFile), masksFile, syncFile, syncNames, syncCells };
  for (let cell = 0; cell < width * height; cell++) {
    const set = syncFile.readUInt32LE(syncCells + cell * 8 + 4);
    const block = cellSet(textures, cell % width, Math.floor(cell / width));
    if (set !== block) {
      throw new Error(`t3SyncTextureInfo puts cell (${cell % width}, ${Math.floor(cell / width)}) in texture set ${set}, but t3Terrain.xml puts its block in set ${block}, so the textures aren't edited. Open and save the map in the Editor to bring them back in step`);
    }
  }
  return textures;
}

/** The map's textures, slot by slot, set by set: for refusals ("the map's 8 are …", or "Its 8 are …"). */
export function listSlots(textures: KeptTextures, whose = "the map's"): string {
  const list = (set: number) =>
    setTextures(textures, set)
      .map((name, layer) => `${set * LAYERS + layer} ${name || "(empty)"}`)
      .join(", ");
  if (!usesSets(textures)) return `${whose} 8 are ${list(0)}`;
  return `${whose} sets are ${Array.from({ length: textures.setCount }, (_, set) => `set ${set} ${textures.sets[set] || "(unnamed)"}: ${list(set)}`).join("; ")}`;
}

/**
 * The slot a swap names (its number, or the name of the texture in it), or a refusal that names the
 * map's slots. A swap may fill an empty slot (`emptyOk`), but only in a set the map has.
 */
export function findSlot(textures: KeptTextures, texture: number | string, { emptyOk = false } = {}): number {
  if (typeof texture === "number") {
    const set = Math.floor(texture / LAYERS);
    if (set >= textures.setCount) {
      throw new Error(`Slot ${texture} is in texture set ${set}, which the map doesn't have: ${listSlots(textures)}. Add a set in the Editor (Map > Map Texture Sets) first`);
    }
    if (!emptyOk && textures.slots[texture] === "") {
      throw new Error(`Slot ${texture} is empty: ${listSlots(textures)}. Paint with one of those, or put a texture in slot ${texture} first with a slot swap ({ "op": "swap-slot", "slot": ${texture}, "texture" })`);
    }
    return texture;
  }
  const slots = inSets(textures, texture);
  if (slots.length === 1) return slots[0]!;
  if (slots.length > 1) throw new Error(`${texture} is in slots ${slots.join(" and ")}: name the slot by its number`);
  throw new Error(
    `The map has no texture ${texture}. ${listSlots(textures, "Its")}. Paint with one of those, or put ${texture} in a slot first with a slot swap ({ "op": "swap-slot", "slot", "texture": "${texture}" }), which changes every cell painted with that slot`,
  );
}

/** The slots holding a texture, in the sets the map has. */
const inSets = (textures: KeptTextures, texture: string) => textures.slots.flatMap((name, slot) => (name === texture && slot < textures.setCount * LAYERS ? [slot] : []));

/** What a stroke paints: a texture, and its layer in each set that holds it (−1 where none does). */
export type PaintTarget = {
  readonly texture: string;
  readonly slots: readonly number[];
  readonly layerBySet: readonly number[];
};

/** The target a paint names: a slot number paints that slot's set; a name, every set holding it. */
export function findTexture(textures: KeptTextures, texture: number | string): PaintTarget {
  const slots = typeof texture === "number" ? [findSlot(textures, texture)] : inSets(textures, texture);
  if (slots.length === 0) findSlot(textures, texture);
  const layerBySet = new Array<number>(SETS).fill(-1);
  for (const slot of slots) {
    const set = Math.floor(slot / LAYERS);
    if (layerBySet[set]! >= 0) throw new Error(`${texture} is in slots ${slots.filter((s) => Math.floor(s / LAYERS) === set).join(" and ")} of texture set ${set}: name the slot by its number`);
    layerBySet[set] = slot % LAYERS;
  }
  return { texture: textures.slots[slots[0]!]!, slots, layerBySet };
}

/** The target for one slot as it stands, empty or not (a generating Zone's surrounding texture). */
export const slotTarget = (textures: KeptTextures, slot: number): PaintTarget => ({
  texture: textures.slots[slot]!,
  slots: [slot],
  layerBySet: Array.from({ length: SETS }, (_, set) => (set === Math.floor(slot / LAYERS) ? slot % LAYERS : -1)),
});

/** A texture and its slots, for the report. */
export const slotLabel = (textures: KeptTextures, slot: number) => `${textures.slots[slot] || "(empty)"} (slot ${slot})`;
export const targetLabel = (target: PaintTarget) => `${target.texture} (slot${target.slots.length > 1 ? "s" : ""} ${target.slots.join(" and ")})`;

export type PaintStroke = {
  /** The masks after the stroke. */
  readonly masks: T3TextureMasks;
  /** 1 for each texel whose weights changed: [y * maskWidth + x]. */
  readonly changedTexels: Uint8Array;
  readonly texelCount: number;
  /** Cells with a changed texel, and those the stroke could reach (a texel of strength above 0). */
  readonly changedCells: Uint8Array;
  readonly touchedCells: Uint8Array;
  /** Each changed cell's dominant layer after the stroke. */
  readonly dominant: ReadonlyMap<number, number>;
  /** Cells whose dominant texture became the painted one. */
  readonly nowDominant: number;
  /** Blocks the stroke reached whose set doesn't hold the texture, so it left them as they were. */
  readonly offSetBlocks: readonly number[];
};

/**
 * Paints `target` over `mask`, feathered over its falloff, as above. `band: false` paints up to a
 * boundary between sets, as a generating Zone owns its cells whole (ADR-0016), where the Editor's
 * brush leaves 2 texels.
 */
export function paintSlot(textures: KeptTextures, mask: AreaMask, target: PaintTarget, { band = true }: { readonly band?: boolean } = {}): PaintStroke {
  const { width, height, masks } = textures;
  const { layerBySet } = target;
  const { strength, reach } = texelStrength(mask);
  const layers = masks.layers.map((layer) => Uint8Array.from(layer));
  const changedTexels = new Uint8Array(masks.maskWidth * masks.maskHeight);
  const changedCells = new Uint8Array(width * height);
  const touchedCells = new Uint8Array(width * height);
  const offSet = new Set<number>();
  const banded = band && usesSets(textures);
  let texelCount = 0;
  const old = new Array<number>(LAYERS);
  for (let y = reach.y * TEXELS_PER_CELL; y < (reach.y + reach.height) * TEXELS_PER_CELL; y++) {
    for (let x = reach.x * TEXELS_PER_CELL; x < (reach.x + reach.width) * TEXELS_PER_CELL; x++) {
      const t = y * masks.maskWidth + x;
      const w = strength[t]!;
      if (w <= 0) continue;
      const cellX = Math.floor(x / TEXELS_PER_CELL);
      const cellY = Math.floor(y / TEXELS_PER_CELL);
      const cell = cellY * width + cellX;
      touchedCells[cell] = 1;
      const set = cellSet(textures, cellX, cellY);
      const layer = layerBySet[set]!;
      if (layer < 0) {
        offSet.add(blockOf(textures.blocksPerRow, cellX, cellY));
        continue;
      }
      if (banded && nearOtherSet(textures, x, y, set)) continue;
      for (let l = 0; l < LAYERS; l++) old[l] = layers[l]![t]!;
      const next = blend(old, layer, w);
      if (next.every((value, l) => value === old[l])) continue;
      for (let l = 0; l < LAYERS; l++) layers[l]![t] = next[l]!;
      changedTexels[t] = 1;
      changedCells[cell] = 1;
      texelCount++;
    }
  }
  const after = { ...masks, layers };
  const dominant = new Map<number, number>();
  let nowDominant = 0;
  for (let cell = 0; cell < width * height; cell++) {
    if (!changedCells[cell]) continue;
    const layer = layerBySet[cellSet(textures, cell % width, Math.floor(cell / width))]!;
    dominant.set(cell, dominantLayer(after, width, cell));
    // The sync file holds the dominant layer before the stroke.
    if (dominant.get(cell) === layer && textures.syncFile.readUInt32LE(textures.syncCells + cell * 8) !== layer) nowDominant++;
  }
  return { masks: after, changedTexels, texelCount, changedCells, touchedCells, dominant, nowDominant, offSetBlocks: [...offSet].sort((a, b) => a - b) };
}

/**
 * Paints a rasterised Paint Region (terrain/paint-regions.ts) over the masks: each texel it reaches
 * moved towards its mix on its block's set by its strength there, rounded to 15 by dithering. Its
 * cells are a generating Zone's own, so it paints up to a boundary between sets.
 */
export function paintRegionStroke(textures: KeptTextures, region: RasterisedRegion): PaintStroke {
  const { width, masks } = textures;
  const layers = masks.layers.map((layer) => Uint8Array.from(layer));
  const changedTexels = new Uint8Array(masks.maskWidth * masks.maskHeight);
  const changedCells = new Uint8Array(width * textures.height);
  const shares = new Float64Array(LAYERS);
  const next = new Uint8Array(LAYERS);
  const regions = [region];
  let texelCount = 0;
  for (let y = region.y * TEXELS_PER_CELL; y < (region.y + region.height) * TEXELS_PER_CELL; y++) {
    const cellY = Math.floor(y / TEXELS_PER_CELL);
    let set = -1;
    for (let x = region.x * TEXELS_PER_CELL; x < (region.x + region.width) * TEXELS_PER_CELL; x++) {
      const t = y * masks.maskWidth + x;
      const cellX = Math.floor(x / TEXELS_PER_CELL);
      // A cell's set, once per cell along the row.
      if (x % TEXELS_PER_CELL === 0 || set < 0) set = cellSet(textures, cellX, cellY);
      for (let l = 0; l < LAYERS; l++) shares[l] = layers[l]![t]! / FULL;
      if (!applyPaintRegions(regions, shares, x, y, set)) continue;
      quantizeDithered(shares, next, 0, ditherThreshold(x, y));
      let changed = false;
      for (let l = 0; l < LAYERS; l++) changed ||= next[l] !== layers[l]![t];
      if (!changed) continue;
      for (let l = 0; l < LAYERS; l++) layers[l]![t] = next[l]!;
      changedTexels[t] = 1;
      changedCells[cellY * width + cellX] = 1;
      texelCount++;
    }
  }
  const after = { ...masks, layers };
  const dominant = new Map<number, number>();
  for (let cell = 0; cell < changedCells.length; cell++) if (changedCells[cell]) dominant.set(cell, dominantLayer(after, width, cell));
  return { masks: after, changedTexels, texelCount, changedCells, touchedCells: Uint8Array.from(region.cells), dominant, nowDominant: 0, offSetBlocks: [] };
}

/** Whether a texel of a block of another set lies within {@link SET_BAND} texels of (x, y). */
function nearOtherSet(textures: KeptTextures, x: number, y: number, set: number): boolean {
  const inX = x % TEXELS_PER_BLOCK;
  const inY = y % TEXELS_PER_BLOCK;
  if (inX >= SET_BAND && inX < TEXELS_PER_BLOCK - SET_BAND && inY >= SET_BAND && inY < TEXELS_PER_BLOCK - SET_BAND) return false;
  const maxX = textures.width * TEXELS_PER_CELL - 1;
  const maxY = textures.height * TEXELS_PER_CELL - 1;
  for (const ny of [Math.max(0, y - SET_BAND), y, Math.min(maxY, y + SET_BAND)]) {
    for (const nx of [Math.max(0, x - SET_BAND), x, Math.min(maxX, x + SET_BAND)]) {
      if (cellSet(textures, Math.floor(nx / TEXELS_PER_CELL), Math.floor(ny / TEXELS_PER_CELL)) !== set) return true;
    }
  }
  return false;
}

/**
 * Each texel's strength ([y * maskWidth + x], 0 where it doesn't reach) and the cells it may reach:
 * 1 in a cell inside the area, else 1 − smoothstep(d / falloff) by the distance d (cells) from the
 * texel's middle to the nearest inside cell.
 */
function texelStrength(mask: AreaMask): { strength: Float32Array; reach: CellRect } {
  const { width, height, inside, falloff } = mask;
  const maskWidth = width * TEXELS_PER_CELL;
  const isInside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && inside[y * width + x] === 1;
  // Only inside cells with an outside neighbour can be nearest to a texel outside the area.
  const bucket = Math.max(1, Math.ceil(falloff));
  const buckets = new Map<string, [number, number][]>();
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInside(x, y)) continue;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1 && !edge; dx++) edge = !isInside(x + dx, y + dy);
      if (!edge) continue;
      const key = `${Math.floor(x / bucket)},${Math.floor(y / bucket)}`;
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push([x, y]);
    }
  }
  const reach: CellRect = cellsWithin({ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }, Math.ceil(falloff), width, height);
  const out = new Float32Array(maskWidth * height * TEXELS_PER_CELL);
  for (let cy = reach.y; cy < reach.y + reach.height; cy++) {
    for (let cx = reach.x; cx < reach.x + reach.width; cx++) {
      const cellInside = isInside(cx, cy);
      if (!cellInside && falloff === 0) continue;
      const near = cellInside ? [] : [-1, 0, 1].flatMap((by) => [-1, 0, 1].flatMap((bx) => buckets.get(`${Math.floor(cx / bucket) + bx},${Math.floor(cy / bucket) + by}`) ?? []));
      for (let ty = 0; ty < TEXELS_PER_CELL; ty++) {
        for (let tx = 0; tx < TEXELS_PER_CELL; tx++) {
          const t = (cy * TEXELS_PER_CELL + ty) * maskWidth + cx * TEXELS_PER_CELL + tx;
          if (cellInside) {
            out[t] = 1;
            continue;
          }
          const px = cx + (tx + 0.5) / TEXELS_PER_CELL;
          const py = cy + (ty + 0.5) / TEXELS_PER_CELL;
          let d = Infinity;
          for (const [ix, iy] of near) d = Math.min(d, distanceToCell(px, py, ix, iy));
          out[t] = feather(d, falloff);
        }
      }
    }
  }
  return { strength: out, reach };
}

const cellsWithin = (rect: CellRect, by: number, width: number, height: number): CellRect => {
  const x = Math.max(0, rect.x - by);
  const y = Math.max(0, rect.y - by);
  return { x, y, width: Math.min(width, rect.x + rect.width + by) - x, height: Math.min(height, rect.y + rect.height + by) - y };
};

/** The weights moved `w` of the way to all 15 on `slot`, rounded to whole weights with their sum kept (largest remainders, the slot first). */
function blend(old: readonly number[], slot: number, w: number): number[] {
  const exact = old.map((value, l) => value * (1 - w) + (l === slot ? FULL * w : 0));
  const total = Math.round(exact.reduce((sum, value) => sum + value, 0));
  const out = exact.map(Math.floor);
  let left = total - out.reduce((sum, value) => sum + value, 0);
  const order = exact.map((_, l) => l).sort((a, b) => exact[b]! - Math.floor(exact[b]!) - (exact[a]! - Math.floor(exact[a]!)) || Number(b === slot) - Number(a === slot) || a - b);
  for (const l of order) {
    if (left <= 0) break;
    out[l]!++;
    left--;
  }
  return out;
}

/** Whether any of a cell's texels has weight on a layer. */
export function hasWeight(masks: T3TextureMasks, cx: number, cy: number, layer: number): boolean {
  const weights = masks.layers[layer]!;
  for (let ty = cy * TEXELS_PER_CELL; ty < (cy + 1) * TEXELS_PER_CELL; ty++) {
    const row = ty * masks.maskWidth;
    for (let tx = cx * TEXELS_PER_CELL; tx < (cx + 1) * TEXELS_PER_CELL; tx++) if (weights[row + tx]! > 0) return true;
  }
  return false;
}

/** Each cell's layers with any weight, one bit a layer: [y * width + x]. */
export function cellLayerBits(masks: T3TextureMasks, width: number, height: number): Uint8Array {
  const bits = new Uint8Array(width * height);
  for (let layer = 0; layer < LAYERS; layer++) {
    const weights = masks.layers[layer]!;
    for (let t = 0; t < weights.length; t++) {
      if (!weights[t]) continue;
      const x = Math.floor((t % masks.maskWidth) / TEXELS_PER_CELL);
      const y = Math.floor(Math.floor(t / masks.maskWidth) / TEXELS_PER_CELL);
      if (x < width && y < height) bits[y * width + x]! |= 1 << layer;
    }
  }
  return bits;
}

/** The layer with the most weight over a cell's texels; the lower layer on a tie. */
export function dominantLayer(masks: T3TextureMasks, width: number, cell: number): number {
  const cx = cell % width;
  const cy = Math.floor(cell / width);
  let best = 0;
  let bestSum = -1;
  for (let l = 0; l < LAYERS; l++) {
    const layer = masks.layers[l]!;
    let sum = 0;
    for (let ty = 0; ty < TEXELS_PER_CELL; ty++) {
      const row = (cy * TEXELS_PER_CELL + ty) * masks.maskWidth + cx * TEXELS_PER_CELL;
      for (let tx = 0; tx < TEXELS_PER_CELL; tx++) sum += layer[row + tx]!;
    }
    if (sum > bestSum) [best, bestSum] = [l, sum];
  }
  return best;
}

/** The stroke's t3TextureMasks and t3SyncTextureInfo: the Editor's files with the changed texels and cells rewritten. */
export function writePaint(textures: KeptTextures, stroke: PaintStroke): { readonly masks: Buffer; readonly sync: Buffer } {
  const masks = Buffer.from(textures.masksFile);
  const { maskWidth, maskHeight } = textures.masks;
  const layerSize = (maskWidth * maskHeight) / 2;
  const tilesPerRow = maskWidth / TEXELS_PER_TILE;
  for (let t = 0; t < stroke.changedTexels.length; t++) {
    if (!stroke.changedTexels[t]) continue;
    const x = t % maskWidth;
    const y = Math.floor(t / maskWidth);
    const tile = Math.floor(y / TEXELS_PER_TILE) * tilesPerRow + Math.floor(x / TEXELS_PER_TILE);
    const inTile = (y % TEXELS_PER_TILE) * TEXELS_PER_TILE + (x % TEXELS_PER_TILE);
    for (let l = 0; l < LAYERS; l++) {
      const at = MASK_HEADER + l * layerSize + tile * BYTES_PER_TILE + (inTile >> 1);
      const value = stroke.masks.layers[l]![t]!;
      // The high nibble holds the even column.
      masks[at] = x % 2 === 0 ? (masks[at]! & 0x0f) | (value << 4) : (masks[at]! & 0xf0) | value;
    }
  }
  // A cell's set is its block's, which a stroke doesn't change: only its texture is rewritten.
  const sync = Buffer.from(textures.syncFile);
  for (const [cell, layer] of stroke.dominant) sync.writeUInt32LE(layer, textures.syncCells + cell * 8);
  return { masks, sync };
}

export type SlotReach = {
  /** 1 for each cell where the slot has at least {@link REACH_SHARE} of the weight. */
  readonly cells: Uint8Array;
  readonly count: number;
  /** Cells where it is the dominant texture. */
  readonly dominant: number;
  /** Cells with any weight of it at all: those a swap changes the look of. */
  readonly any: number;
  readonly anyCells: Uint8Array;
};

/** The cells a slot covers: its layer's weight, in the blocks of its set. */
export function slotReach(textures: KeptTextures, slot: number): SlotReach {
  const { width, height, masks } = textures;
  const set = Math.floor(slot / LAYERS);
  const layerIndex = slot % LAYERS;
  const cells = new Uint8Array(width * height);
  const anyCells = new Uint8Array(width * height);
  let [count, dominant, any] = [0, 0, 0];
  const layer = masks.layers[layerIndex]!;
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      if (cellSet(textures, cx, cy) !== set) continue;
      let sum = 0;
      let all = 0;
      for (let ty = 0; ty < TEXELS_PER_CELL; ty++) {
        const row = (cy * TEXELS_PER_CELL + ty) * masks.maskWidth + cx * TEXELS_PER_CELL;
        for (let tx = 0; tx < TEXELS_PER_CELL; tx++) {
          sum += layer[row + tx]!;
          for (let l = 0; l < LAYERS; l++) all += masks.layers[l]![row + tx]!;
        }
      }
      const cell = cy * width + cx;
      if (sum > 0) {
        anyCells[cell] = 1;
        any++;
      }
      if (all > 0 && sum / all >= REACH_SHARE) {
        cells[cell] = 1;
        count++;
      }
      if (sum > 0 && textures.syncFile.readUInt32LE(textures.syncCells + cell * 8) === layerIndex) dominant++;
    }
  }
  return { cells, count, dominant, any, anyCells };
}

/** The distinct textures the map uses, across the sets it has. */
const usedTextures = (slots: readonly string[], setCount: number) => new Set(slots.slice(0, setCount * LAYERS).filter((name) => name !== ""));

/**
 * Checks a slot swap: the new texture is one the game has, isn't in another slot of the same set
 * already, and doesn't take the map past {@link MAX_TEXTURES} distinct textures.
 */
export function checkSwap(textures: KeptTextures, slot: number, texture: string, catalog: Catalog): void {
  if (textures.slots[slot] === texture) throw new Error(`Slot ${slot} is ${texture} already: nothing to swap`);
  const set = Math.floor(slot / LAYERS);
  const already = setTextures(textures, set).indexOf(texture);
  if (already >= 0) {
    const at = set * LAYERS + already;
    throw new Error(`${texture} is in slot ${at} already: paint with it there ({ "op": "paint", "texture": ${at} }) rather than swapping it into slot ${slot} too`);
  }
  if (!isKnownTexture(catalog, texture)) throw new Error(`${texture} isn't a terrain texture the game has (data/texture-extracted.json${layerSource(catalog)}): ${listSlots(textures)}. Nothing was written`);
  const after = texturesAfter(textures, slot, texture);
  if (after > MAX_TEXTURES) {
    throw new Error(`${texture} would make ${after} different textures on the map, and the Editor allows ${MAX_TEXTURES}: swap a slot whose texture is used nowhere else instead, or one of the sets' copies of a texture. ${listSlots(textures)}. Nothing was written`);
  }
}

/** Cells named one by one in a refusal before the rest are counted. */
const LISTED_CELLS = 10;

/**
 * Checks emptying a slot: it holds a texture, and no cell of its set's blocks has any weight on its
 * layer or has it as its sync texture (t3SyncTextureInfo), or the refusal names the cells.
 * `returning` are Kept cells a compile could send back onto set 0 with that layer showing the same
 * texture there (ADR-0016): they count for a set-0 slot too, as they would show the empty slot.
 */
export function checkClearSlot(textures: KeptTextures, slot: number, returning?: Uint8Array): void {
  if (textures.slots[slot] === "") throw new Error(`Slot ${slot} is empty already: nothing to clear`);
  const { width, height, masks } = textures;
  const { anyCells } = slotReach(textures, slot);
  const layer = slot % LAYERS;
  const set = Math.floor(slot / LAYERS);
  const syncNames = (cell: number) => textures.syncFile.readUInt32LE(textures.syncCells + cell * 8) === layer;
  const weighted = Uint8Array.from(anyCells);
  const synced = new Uint8Array(width * height);
  let back = 0;
  for (let cell = 0; cell < width * height; cell++) {
    if (weighted[cell]) continue;
    const [x, y] = [cell % width, Math.floor(cell / width)];
    const onSet = cellSet(textures, x, y) === set;
    const returns = set === 0 && !onSet && returning?.[cell] === 1;
    if (!onSet && !returns) continue;
    if (returns && hasWeight(masks, x, y, layer)) {
      weighted[cell] = 1;
      back++;
    } else if (syncNames(cell)) synced[cell] = 1;
  }
  const weight = listCells(weighted, width);
  const sync = listCells(synced, width);
  if (weight.count === 0 && sync.count === 0) return;
  const label = slotLabel(textures, slot);
  const plural = (count: number) => `${count} cell${count === 1 ? "" : "s"}`;
  const returns = back
    ? ` ${back} of them are Kept ground in blocks a texture set of the Blueprint's took from set 0, with ${textures.slots[slot]} on that layer in both sets: a compile sends such a block back to set 0 once no Zone of the set holds a cell in it, and they would then show an empty slot.`
    : "";
  const parts = [
    ...(weight.count ? [`${label} has weight in ${plural(weight.count)}, so it isn't emptied: ${weight.text}.${returns}`] : []),
    ...(sync.count ? [`${weight.count ? "It" : label} is the sync texture (t3SyncTextureInfo) of ${plural(sync.count)} with no weight on it, which would then name an empty slot, so it isn't emptied: ${sync.text}.`] : []),
  ];
  throw new Error(`${parts.join(" ")} Paint them with another texture first. Nothing was written`);
}

/** The cells set in `cells`: their count, and the first {@link LISTED_CELLS} named, with the rest's count and bounds. */
function listCells(cells: Uint8Array, width: number): { readonly count: number; readonly text: string } {
  const listed: [number, number][] = [];
  let count = 0;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let cell = 0; cell < cells.length; cell++) {
    if (!cells[cell]) continue;
    const [x, y] = [cell % width, Math.floor(cell / width)];
    count++;
    if (listed.length < LISTED_CELLS) listed.push([x, y]);
    [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  }
  const more = count > listed.length ? ` and ${count - listed.length} more, in cells ${x0}-${x1} × ${y0}-${y1}` : "";
  return { count, text: `${listed.map(([x, y]) => `(${x}, ${y})`).join(", ")}${more}` };
}

/** The distinct textures the map uses after a slot change, across the sets it has. */
export const texturesAfter = (textures: KeptTextures, slot: number, texture: string): number => usedTextures(textures.slots.map((name, s) => (s === slot ? texture : name)), textures.setCount).size;

/** The swap's t3Terrain.xml and t3SyncTextureInfo: the slot's name changed in each, every other byte kept. */
export function writeSwap(textures: KeptTextures, terrainXml: string, slot: number, texture: string): { readonly terrainXml: string; readonly sync: Buffer } {
  const entry = new RegExp(`(<texture\\s+i="${slot}"\\s+name=")([^"]*)(")`, "g");
  const hits = [...terrainXml.matchAll(entry)];
  if (hits.length !== 1 || hits[0]![2] !== textures.slots[slot]) throw new Error(`t3Terrain.xml's <textureList> doesn't hold slot ${slot} as one <texture i="${slot}" name="…"/>, so it isn't edited`);
  // Only the slot's own name changes: the sync file's other names stay as it has them.
  const names = textures.syncNames.map((name, l) => (l === slot ? texture : name));
  const sync = Buffer.concat([textures.syncFile.subarray(0, SYNC_HEADER), ...names.map((name) => Buffer.from(`${name}\0`, "ascii")), textures.syncFile.subarray(textures.syncCells)]);
  return { terrainXml: terrainXml.replace(entry, `$1${texture}$3`), sync };
}

/** The set a block move names: its index or its name, among the sets the map has. */
export function findSet(textures: KeptTextures, set: number | string): number {
  const named = typeof set === "number" ? set : textures.sets.indexOf(set);
  const list = Array.from({ length: textures.setCount }, (_, s) => `${s} ${textures.sets[s] || "(unnamed)"}`).join(", ");
  if (named < 0 || named >= textures.setCount) {
    throw new Error(`The map has no texture set ${set}: its sets are ${list}. Add a set in the Editor (Map > Map Texture Sets) first`);
  }
  return named;
}

export type BlockMove = {
  readonly set: number;
  /** The blocks the area touches that aren't on the set yet. */
  readonly blocks: readonly number[];
  /** 1 for each cell of those blocks. */
  readonly cells: Uint8Array;
  /** The block sets after the move. */
  readonly blockSets: Uint8Array;
};

/** The blocks an area touches (any inside cell), moved onto `set`. */
export function moveBlocks(textures: KeptTextures, mask: AreaMask, set: number): BlockMove {
  const { width, height, blocksPerRow } = textures;
  const blocks = new Set<number>();
  for (let cell = 0; cell < width * height; cell++) {
    if (!mask.inside[cell]) continue;
    const block = blockOf(blocksPerRow, cell % width, Math.floor(cell / width));
    if (textures.blockSets[block] !== set) blocks.add(block);
  }
  const blockSets = Uint8Array.from(textures.blockSets);
  const cells = new Uint8Array(width * height);
  for (const block of blocks) {
    blockSets[block] = set;
    const { x: bx, y: by } = blockOrigin(block, blocksPerRow);
    for (let y = by; y < by + CELLS_PER_BLOCK; y++) for (let x = bx; x < bx + CELLS_PER_BLOCK; x++) cells[y * width + x] = 1;
  }
  return { set, blocks: [...blocks].sort((a, b) => a - b), cells, blockSets };
}

/** The move's t3Terrain.xml and t3SyncTextureInfo: the moved blocks' tileSet and their cells' set changed, every other byte kept. */
export function writeBlockMove(textures: KeptTextures, terrainXml: string, move: BlockMove): { readonly terrainXml: string; readonly sync: Buffer } {
  let xml = terrainXml;
  for (const block of move.blocks) {
    const entry = new RegExp(`(<blockTextureSet\\s+i="${block}"\\s+tileSet=")(\\d+)(")`, "g");
    const hits = [...xml.matchAll(entry)];
    if (hits.length !== 1) throw new Error(`t3Terrain.xml's <blockTextureSetList> doesn't hold block ${block} as one <blockTextureSet i="${block}" tileSet="…"/>, so it isn't edited`);
    xml = xml.replace(entry, `$1${move.set}$3`);
  }
  const sync = Buffer.from(textures.syncFile);
  for (let cell = 0; cell < move.cells.length; cell++) if (move.cells[cell]) sync.writeUInt32LE(move.set, textures.syncCells + cell * 8 + 4);
  return { terrainXml: xml, sync };
}

/** The textures after a block move: the same slots, the blocks on their new sets. */
export const withBlockSets = (textures: KeptTextures, blockSets: Uint8Array): KeptTextures => ({ ...textures, blockSets });

export type Seam = {
  readonly texture: string;
  /** Block edges where the texture lies on both sides of a boundary between sets. */
  readonly edges: number;
  /** A cell beside the first such edge. */
  readonly first: { readonly x: number; readonly y: number };
};

/**
 * Where a texture touches itself across a boundary between sets, which the Editor renders with
 * glitches: block edges whose texels nearest the boundary, a few deep, hold the texture on both
 * sides. Only edges of blocks holding a cell of `near` (the edit's cells) count. `masks` defaults
 * to the package's own.
 */
export function findSeams(textures: KeptTextures, texture: string, near: Uint8Array, masks: T3TextureMasks = textures.masks): Seam | undefined {
  const { blockSets, blocksPerRow, width } = textures;
  // Only edges of blocks holding a cell the edit changed or reached.
  const touched = new Uint8Array(blockSets.length);
  for (let cell = 0; cell < near.length; cell++) if (near[cell]) touched[blockOf(blocksPerRow, cell % width, Math.floor(cell / width))] = 1;
  const blockRows = blockSets.length / blocksPerRow;
  const weight = (set: number, x: number, y: number) => {
    const layer = setTextures(textures, set).indexOf(texture);
    return layer < 0 ? 0 : masks.layers[layer]![y * masks.maskWidth + x]!;
  };
  let edges = 0;
  let first: { x: number; y: number } | undefined;
  for (let by = 0; by < blockRows; by++) {
    for (let bx = 0; bx < blocksPerRow; bx++) {
      const a = blockSets[by * blocksPerRow + bx]!;
      // The east and south neighbours, so each edge is seen once.
      for (const [nx, ny] of [
        [bx + 1, by],
        [bx, by + 1],
      ] as const) {
        if (nx >= blocksPerRow || ny >= blockRows) continue;
        const b = blockSets[ny * blocksPerRow + nx]!;
        if (a === b || !(touched[by * blocksPerRow + bx] || touched[ny * blocksPerRow + nx])) continue;
        let both = false;
        for (let i = 0; i < TEXELS_PER_BLOCK && !both; i++) {
          let mine = 0;
          let theirs = 0;
          for (let d = 0; d < SEAM_DEPTH; d++) {
            if (nx !== bx) {
              const edgeX = nx * TEXELS_PER_BLOCK;
              mine += weight(a, edgeX - 1 - d, by * TEXELS_PER_BLOCK + i);
              theirs += weight(b, edgeX + d, by * TEXELS_PER_BLOCK + i);
            } else {
              const edgeY = ny * TEXELS_PER_BLOCK;
              mine += weight(a, bx * TEXELS_PER_BLOCK + i, edgeY - 1 - d);
              theirs += weight(b, bx * TEXELS_PER_BLOCK + i, edgeY + d);
            }
          }
          both = mine > 0 && theirs > 0;
        }
        if (!both) continue;
        edges++;
        first ??= { x: nx * CELLS_PER_BLOCK, y: ny * CELLS_PER_BLOCK };
      }
    }
  }
  return first ? { texture, edges, first } : undefined;
}

/** The seam warning for the report. */
export const seamWarning = (seam: Seam) =>
  `${seam.texture} touches itself across a boundary between texture sets at ${seam.edges} block edge${seam.edges === 1 ? "" : "s"}, the first by cell (${seam.first.x}, ${seam.first.y}): the Editor renders that with glitches. Keep it off one side, or move those blocks onto one set (set-blocks)`;
