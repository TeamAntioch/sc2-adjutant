// A Mission's own texture sets beside Kept ground (ADR-0016): each Blueprint `textureSets` entry
// becomes one of the map's 8 texture sets, and every 8×8-cell block holding a cell of its Zones
// moves onto it. The rules:
//
// - **Where it goes.** The index the compile record gives the set, else the first index the package
//   doesn't use (no name, no textures, no block on it).
// - **What it writes.** t3Terrain.xml's <textureSet> name and the set's 8 <texture> slots, each
//   moved block's tileSet, and t3SyncTextureInfo's names table (set_count sets of 8) and the moved
//   cells' set. Every other byte stays.
// - **Kept ground keeps its look.** A texel keeps its weights when its block changes set, and is
//   read in the new set layer for layer. So every layer a Kept texel in a changed block uses must
//   hold the same texture before and after, or the compile refuses, saying which texture goes in
//   which slot. A block the last compile moved that no set covers now goes back to set 0 under the
//   same rule.
// - **At most 16 textures** across the map's sets (MAX_MAP_TEXTURES).
//
// The Zones are painted afterwards, from the sets their blocks are on (generating-zones.ts).

import { type CompileRecordEntry, fingerprint } from "../domain/compile-record.js";
import { MAX_MAP_TEXTURES, type MissionBlueprint, type TextureSet, textureSetOfZone } from "../domain/mission-blueprint.js";
import { getStockTexture } from "../catalog/stock-catalog.js";
import { readT3TerrainXml } from "../terrain/read-t3-terrain-xml.js";
import { hasWeight, type KeptTextures, setTextures, SYNC_HEADER } from "./paint-brushes.js";
import { blockLabel, blockOf, blockOrigin, CELLS_PER_BLOCK, LAYERS, SETS } from "../terrain/texture-grid.js";

const FOOT = "Nothing was compiled";

export type TextureSetEntry = Extract<CompileRecordEntry, { kind: "texture-set" }>;
type Rect = [number, number, number, number];

export type TextureSetPlan = {
  /** The textures after the sets: slots, set names, set_count, block sets and the sync file (masks unchanged). */
  readonly textures: KeptTextures;
  /** Each Zone painted from a set of the Blueprint's, and its set's index. */
  readonly setOfZone: ReadonlyMap<string, number>;
  /** Each Blueprint set's index, kept ones too. */
  readonly indexOf: ReadonlyMap<string, number>;
  /** The tilesets of the sets the compile leaves alone (kept, or not yet decided), whose CTerrain overrides stay as the package has them. */
  readonly keptTilesets: readonly string[];
  /** The sets the compile writes (not kept), each with its index and blocks. */
  readonly written: readonly { readonly set: TextureSet; readonly index: number; readonly blocks: readonly number[] }[];
  /** Blocks whose set changed, slots whose texture changed, and sets whose name changed. */
  readonly movedBlocks: readonly number[];
  readonly changedSlots: readonly number[];
  readonly renamedSets: readonly number[];
  readonly warnings: readonly string[];
};

/**
 * The map's texture sets with the Blueprint's written in, as above. `owned` and `owner` are the
 * generating Zones' cells (generating-zones.ts ownedCells), `zones` the generating Zones `owner`
 * indexes. `previous` are the last compile's texture-set entries; `keptIds` the sets the author kept.
 */
export function planTextureSets(input: {
  readonly blueprint: Pick<MissionBlueprint, "textureSets" | "zones">;
  readonly textures: KeptTextures;
  readonly owned: Uint8Array;
  readonly owner: Int16Array;
  readonly zones: readonly { readonly id: string }[];
  /** The last compile's texture-set entries, and the kept sets' (each with its index and blocks). */
  readonly previous?: readonly TextureSetEntry[];
  /** The ids of the sets the compile leaves alone: kept, or changed in the Editor and not yet decided. */
  readonly keptIds?: ReadonlySet<string>;
  /** Tilesets the package's own TerrainData.xml overrides (Kept CTerrain entries): no set takes one as its name. */
  readonly keptTilesets?: ReadonlySet<string>;
}): TextureSetPlan {
  const { textures, owned, owner, zones } = input;
  const previous = input.previous ?? [];
  const keptIds = input.keptIds ?? new Set<string>();
  const sets = input.blueprint.textureSets ?? [];
  const { width, blocksPerRow } = textures;
  const warnings: string[] = [];

  // Indices: the record's, kept sets' too, then the first free.
  const indexOf = new Map<string, number>();
  const reserved = new Set<number>([0]);
  for (const entry of previous) {
    if (sets.some((set) => set.id === entry.id) || keptIds.has(entry.id)) {
      indexOf.set(entry.id, entry.set);
      reserved.add(entry.set);
    }
  }
  const used = (index: number) =>
    textures.sets[index] !== "" || textures.slots.slice(index * LAYERS, index * LAYERS + LAYERS).some((name) => name !== "") || textures.blockSets.includes(index);
  for (const set of sets) {
    if (indexOf.has(set.id)) continue;
    const free = Array.from({ length: SETS }, (_, index) => index).find((index) => !reserved.has(index) && !used(index) && !previous.some((entry) => entry.set === index));
    if (free === undefined) {
      throw new Error(`Texture set ${set.id} has nowhere to go: the map's 8 texture sets are all in use (${describeSets(textures)}). ${FOOT}`);
    }
    indexOf.set(set.id, free);
    reserved.add(free);
  }

  // The blocks each written set claims: those holding a cell of its Zones.
  const writtenSets = sets.filter((set) => !keptIds.has(set.id));
  // Each Zone's set among all the Blueprint's (a Zone named by a kept set's list isn't another's by level).
  const setIdOfZone = new Map<string, string>();
  const setOfZone = new Map<string, number>();
  for (const [zone, index] of textureSetOfZone(sets, input.blueprint.zones)) {
    const { id } = sets[index]!;
    if (keptIds.has(id)) continue;
    setIdOfZone.set(zone, id);
    setOfZone.set(zone, indexOf.get(id)!);
  }
  const claim = new Map<number, string>();
  const claimed = new Map<string, Set<number>>(writtenSets.map((set) => [set.id, new Set<number>()]));
  // Blocks an earlier compile put on a Blueprint set (not kept) may move to another of them.
  const compiledBlocks = new Set(previous.filter((entry) => !keptIds.has(entry.id)).flatMap((entry) => blocksOfRects(entry.blocks, blocksPerRow)));
  for (let cell = 0; cell < owned.length; cell++) {
    if (!owned[cell]) continue;
    const setId = setIdOfZone.get(zones[owner[cell]!]!.id);
    if (setId === undefined) continue;
    const block = blockOf(blocksPerRow, cell % width, Math.floor(cell / width));
    // A block on another set the map has (one made in the Editor, or a kept set's) isn't taken:
    // undoing the set could then only send it to set 0, not back where it was.
    const on = textures.blockSets[block]!;
    if (on !== 0 && on !== indexOf.get(setId) && !compiledBlocks.has(block)) {
      throw new Error(`Block ${block} (cells ${blockLabel(block, blocksPerRow)}) is on texture set ${on} (${textures.sets[on] || "unnamed"}), which isn't texture set ${setId}'s: move it back to set 0 in the Editor (Texture Set brush) first, or keep the set's Zones off it. ${FOOT}`);
    }
    const other = claim.get(block);
    if (other !== undefined && other !== setId) {
      throw new Error(`Block ${block} (cells ${blockLabel(block, blocksPerRow)}) holds cells of texture sets ${other} and ${setId}, and a block draws on one set: move the Zones apart, to different 8×8-cell blocks. ${FOOT}`);
    }
    claim.set(block, setId);
    claimed.get(setId)!.add(block);
  }

  // Slots, names and blocks after.
  const slots = [...textures.slots];
  const names = [...textures.sets];
  const blockSets = Uint8Array.from(textures.blockSets);
  const keptTilesets = input.keptTilesets ?? new Set<string>();
  const takenNames = new Set([...names.filter((name, index) => name !== "" && !writtenSets.some((set) => indexOf.get(set.id) === index)), ...keptTilesets]);
  // A set's name is the tileset its CTerrain override lists its textures under, so no two sets
  // share one, and none takes a tileset the package overrides already.
  for (const set of writtenSets) {
    if (set.name === undefined) continue;
    if (keptTilesets.has(set.name)) {
      throw new Error(
        `Texture set ${set.id} is named ${set.name}, whose CTerrain the package's TerrainData.xml overrides already as Kept Content, and the set's textures go in that override: name the set after another tileset. ${FOOT}`,
      );
    }
    if (takenNames.has(set.name)) {
      throw new Error(`Texture set ${set.id} is named ${set.name}, which another of the map's texture sets has: each set's textures go in its own tileset's CTerrain override, so name it after another tileset. ${FOOT}`);
    }
    takenNames.add(set.name);
  }
  for (const set of writtenSets) {
    const index = indexOf.get(set.id)!;
    for (let layer = 0; layer < LAYERS; layer++) slots[index * LAYERS + layer] = set.textures[layer] ?? "";
    const name = set.name ?? defaultSetName(set.textures, takenNames);
    if (name === undefined) {
      throw new Error(`Texture set ${set.id} has no name of its own, and every tileset listing its textures is another set's name or overridden already: give it a name, a tileset no other set has. ${FOOT}`);
    }
    names[index] = name;
    takenNames.add(name);
    for (const block of claimed.get(set.id)!) blockSets[block] = index;
  }
  // Blocks the last compile moved that no set claims now go back to set 0.
  const returned = new Set<number>();
  for (const entry of previous) {
    if (keptIds.has(entry.id)) continue;
    for (const block of blocksOfRects(entry.blocks, blocksPerRow)) {
      if (claim.has(block) || textures.blockSets[block] !== entry.set) continue;
      blockSets[block] = 0;
      returned.add(block);
    }
  }
  // A recorded set no block uses any more, and that the Blueprint no longer declares, is emptied.
  for (const entry of previous) {
    if (keptIds.has(entry.id) || sets.some((set) => set.id === entry.id) || blockSets.includes(entry.set)) continue;
    names[entry.set] = "";
    for (let layer = 0; layer < LAYERS; layer++) slots[entry.set * LAYERS + layer] = "";
  }

  const setCount = Math.max(1, ...Array.from({ length: SETS }, (_, index) => index).filter((index) => names[index] !== "" || slots.slice(index * LAYERS, index * LAYERS + LAYERS).some((name) => name !== "") || blockSets.includes(index)).map((index) => index + 1));
  const distinct = new Set(slots.slice(0, setCount * LAYERS).filter((name) => name !== ""));
  if (distinct.size > MAX_MAP_TEXTURES) {
    throw new Error(
      `The texture sets would put ${distinct.size} different textures on the map, and the Editor allows ${MAX_MAP_TEXTURES}: reuse textures the map has already (a copy in another set counts once), or free slots of set 0 that no ground uses (texture_usage lists them). ${FOOT}`,
    );
  }

  checkKeptTexels(textures, slots, blockSets, owned, returned, sets, indexOf);

  const movedBlocks = [...blockSets.keys()].filter((block) => blockSets[block] !== textures.blockSets[block]);
  const changedSlots = slots.flatMap((name, slot) => (name !== textures.slots[slot] ? [slot] : []));
  const renamedSets = names.flatMap((name, set) => (name !== textures.sets[set] ? [set] : []));
  const sync = writeSync(textures, slots, setCount, blockSets, movedBlocks);
  const after: KeptTextures = { ...textures, slots, sets: names, setCount, blockSets, syncFile: sync.file, syncNames: sync.names, syncCells: sync.cells };
  if (returned.size > 0) warnings.push(`${returned.size} block${returned.size === 1 ? "" : "s"} the last compile put on a texture set of the Blueprint's went back to set 0, as no set's Zone holds a cell there now`);
  return {
    textures: after,
    setOfZone,
    indexOf,
    keptTilesets: [...keptIds].flatMap((id) => (indexOf.has(id) && names[indexOf.get(id)!] ? [names[indexOf.get(id)!]!] : [])),
    written: writtenSets.map((set) => ({ set, index: indexOf.get(set.id)!, blocks: [...claimed.get(set.id)!].sort((a, b) => a - b) })),
    movedBlocks,
    changedSlots,
    renamedSets,
    warnings,
  };
}

/**
 * Refuses when a Kept texel would change look: a texel of a cell no generating Zone owns, in a
 * block whose set or set's slots change, with weight on a layer whose texture changes.
 */
function checkKeptTexels(
  textures: KeptTextures,
  slots: readonly string[],
  blockSets: Uint8Array,
  owned: Uint8Array,
  returned: ReadonlySet<number>,
  sets: readonly TextureSet[],
  indexOf: ReadonlyMap<string, number>,
): void {
  const { width, blocksPerRow, masks } = textures;
  const problems = new Map<string, { layer: number; was: string; now: string; set: number; blocks: Set<number>; returned: boolean }>();
  for (let block = 0; block < blockSets.length; block++) {
    const before = textures.blockSets[block]!;
    const after = blockSets[block]!;
    const changes = Array.from({ length: LAYERS }, (_, layer) => textures.slots[before * LAYERS + layer] !== slots[after * LAYERS + layer]);
    if (!changes.includes(true)) continue;
    const { x: bx, y: by } = blockOrigin(block, blocksPerRow);
    for (let cy = by; cy < by + CELLS_PER_BLOCK; cy++) {
      for (let cx = bx; cx < bx + CELLS_PER_BLOCK; cx++) {
        if (owned[cy * width + cx]) continue;
        for (let layer = 0; layer < LAYERS; layer++) {
          if (!changes[layer] || !hasWeight(masks, cx, cy, layer)) continue;
          const was = textures.slots[before * LAYERS + layer]!;
          const now = slots[after * LAYERS + layer]!;
          const key = `${after}:${layer}:${was}`;
          const problem = problems.get(key) ?? { layer, was, now, set: after, blocks: new Set<number>(), returned: returned.has(block) };
          problem.blocks.add(block);
          problems.set(key, problem);
        }
      }
    }
  }
  if (problems.size === 0) return;
  const lines = [...problems.values()].map((problem) => {
    const blocks = [...problem.blocks].sort((a, b) => a - b);
    const where = `block${blocks.length === 1 ? "" : "s"} ${listBlocks(blocks, blocksPerRow)}`;
    const shows = `Kept ground there has weight on layer ${problem.layer}, which ${problem.was ? `shows ${problem.was}` : "is an empty slot"} now and set ${problem.set} would show as ${problem.now || "nothing (an empty slot)"}`;
    if (problem.returned) return `${where} go back to set 0, as no set's Zone holds a cell there now, but ${shows}: bring the cells back into a set's Zone, or repaint them in the Editor`;
    const setIndex = sets.findIndex((set) => indexOf.get(set.id) === problem.set);
    const fix =
      setIndex >= 0
        ? `fill the rest of those blocks with a generating Zone of the set, so no Kept ground is left in it; or ${problem.was ? `put ${problem.was} at position ${problem.layer + 1} of textureSets[${setIndex}].textures` : `leave position ${problem.layer + 1} of textureSets[${setIndex}].textures empty ("")`} (slot ${problem.set * LAYERS + problem.layer}), so the Kept ground keeps its look, though a shared texture then meets itself at the boundary, which the Editor renders with a glitch`
        : "fill the rest of those blocks with a generating Zone of the set, or keep the set's Zones off them";
    return `${where} move${blocks.length === 1 ? "s" : ""} onto texture set ${problem.set}, but ${shows}: ${fix}`;
  });
  throw new Error(`A texture set would change how Kept ground looks. ${lines.join(". ")}. ${FOOT}`);
}

/** t3SyncTextureInfo after the sets: set_count, set_count × 8 names, and each moved block's cells' set. */
function writeSync(textures: KeptTextures, slots: readonly string[], setCount: number, blockSets: Uint8Array, movedBlocks: readonly number[]): { file: Buffer; names: string[]; cells: number } {
  // A set the file already names keeps its names as the file has them, unless its slots change.
  const names = Array.from({ length: setCount * LAYERS }, (_, slot) => (slot < textures.syncNames.length && slots[slot] === textures.slots[slot] ? textures.syncNames[slot]! : slots[slot]!));
  const header = Buffer.from(textures.syncFile.subarray(0, SYNC_HEADER));
  header.writeUInt32LE(setCount, 16);
  const cells = Buffer.from(textures.syncFile.subarray(textures.syncCells));
  const { width, blocksPerRow } = textures;
  for (const block of movedBlocks) {
    const { x: bx, y: by } = blockOrigin(block, blocksPerRow);
    for (let y = by; y < by + CELLS_PER_BLOCK; y++) for (let x = bx; x < bx + CELLS_PER_BLOCK; x++) cells.writeUInt32LE(blockSets[block]!, (y * width + x) * 8 + 4);
  }
  const nameBytes = names.map((name) => Buffer.from(`${name}\0`, "ascii"));
  const file = Buffer.concat([header, ...nameBytes, cells]);
  return { file, names, cells: SYNC_HEADER + nameBytes.reduce((sum, bytes) => sum + bytes.length, 0) };
}

/**
 * t3Terrain.xml after the plan: the changed sets' names and slots, and the moved blocks' tileSet.
 * Every other byte stays, CRLF and spacing included.
 */
export function writeTextureSetXml(terrainXml: string, before: KeptTextures, plan: TextureSetPlan): string {
  let xml = terrainXml;
  const replaceOne = (pattern: RegExp, value: string, what: string) => {
    const hits = [...xml.matchAll(pattern)];
    if (hits.length !== 1) throw new Error(`t3Terrain.xml doesn't hold ${what} once, so its texture sets aren't edited. ${FOOT}`);
    xml = xml.replace(pattern, (_, start: string, _old: string, end: string) => `${start}${value}${end}`);
  };
  const after = plan.textures;
  for (let set = 0; set < SETS; set++) {
    if (after.sets[set] !== before.sets[set]) replaceOne(new RegExp(`(<textureSet\\s+i="${set}"\\s+name=")([^"]*)(")`, "g"), after.sets[set]!, `<textureSet i="${set}" name="…"/>`);
  }
  for (let slot = 0; slot < SETS * LAYERS; slot++) {
    if (after.slots[slot] !== before.slots[slot]) replaceOne(new RegExp(`(<texture\\s+i="${slot}"\\s+name=")([^"]*)(")`, "g"), after.slots[slot]!, `<texture i="${slot}" name="…"/>`);
  }
  for (const block of plan.movedBlocks) replaceOne(new RegExp(`(<blockTextureSet\\s+i="${block}"\\s+tileSet=")(\\d+)(")`, "g"), String(after.blockSets[block]), `<blockTextureSet i="${block}" tileSet="…"/>`);
  return xml;
}

/**
 * The map-local CTerrain override for each set the compile writes, as TerrainData.xml catalog
 * entries: the set's tileset with its BlendTextures in slot order. The Editor keeps a slot's texture
 * only if the set's tileset lists it, and on loading swaps any other for one of the tileset's own
 * (seen on a 256×256 Kept map, 2026-11-08), so the set's textures must be in that list.
 */
export function textureSetTerrainEntries(plan: TextureSetPlan): string[] {
  return plan.written.flatMap(({ index }) => {
    const name = plan.textures.sets[index]!;
    const slots = setTextures(plan.textures, index);
    return [`    <CTerrain id="${name}">`, ...slots.flatMap((texture, layer) => (texture ? [`        <BlendTextures index="${layer}" value="${texture}"/>`] : [])), "    </CTerrain>"];
  });
}

/** The record's entry for each set the compile wrote, fingerprinted from the t3Terrain.xml it wrote. */
export function textureSetEntries(plan: TextureSetPlan, terrainXml: string): TextureSetEntry[] {
  return plan.written.map(({ set, index, blocks }) => ({
    kind: "texture-set" as const,
    id: set.id,
    set: index,
    blocks: blockRects(blocks, plan.textures.blocksPerRow),
    fingerprint: textureSetFingerprint(terrainXml, index, blocks),
  }));
}

/** A fingerprint of a set's name, its 8 slots and some blocks' tileSet, as t3Terrain.xml has them. */
export function textureSetFingerprint(terrainXml: string, set: number, blocks: readonly number[]): string {
  const terrain = readT3TerrainXml(terrainXml);
  const slots = terrain.textures.slice(set * LAYERS, set * LAYERS + LAYERS);
  return fingerprint(JSON.stringify({ name: terrain.textureSets[set] ?? "", slots, blocks: blocks.map((block) => [block, terrain.blockTextureSets[block] ?? 0]) }));
}

/** The blocks a texture-set entry lists. */
export function blocksOfRects(rects: readonly (readonly [number, number, number, number])[], blocksPerRow: number): number[] {
  const blocks = new Set<number>();
  for (const [x, y, w, h] of rects) {
    for (let cy = y; cy < y + h; cy += CELLS_PER_BLOCK) for (let cx = x; cx < x + w; cx += CELLS_PER_BLOCK) blocks.add(blockOf(blocksPerRow, cx, cy));
  }
  return [...blocks].sort((a, b) => a - b);
}

/** Blocks as cell rectangles, a run of blocks along a row each. */
export function blockRects(blocks: readonly number[], blocksPerRow: number): Rect[] {
  const rects: Rect[] = [];
  const sorted = [...blocks].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1 && sorted[j + 1]! % blocksPerRow !== 0) j++;
    const { x, y } = blockOrigin(sorted[i]!, blocksPerRow);
    rects.push([x, y, (j - i + 1) * CELLS_PER_BLOCK, CELLS_PER_BLOCK]);
    i = j + 1;
  }
  return rects;
}

/** The tileset listing most of the textures (fewest tilesets first on a tie, then by name), not one of `taken`; undefined when every one is. */
export function defaultSetName(textures: readonly string[], taken: ReadonlySet<string>): string | undefined {
  const counts = new Map<string, number>();
  for (const texture of textures) for (const tileset of getStockTexture(texture)?.tilesets ?? []) counts.set(tileset, (counts.get(tileset) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0])).map(([tileset]) => tileset);
  return ranked.find((tileset) => !taken.has(tileset));
}

const listBlocks = (blocks: readonly number[], blocksPerRow: number) => {
  const shown = blocks.slice(0, 4).map((block) => `${block} (cells ${blockLabel(block, blocksPerRow)})`);
  return `${shown.join(", ")}${blocks.length > 4 ? ` and ${blocks.length - 4} more` : ""}`;
};

/** The map's sets, for a refusal. */
function describeSets(textures: KeptTextures): string {
  return Array.from({ length: SETS }, (_, set) => `${set} ${textures.sets[set] || "(unnamed)"}`).join(", ");
}
