// A fully generated Mission's own texture sets (#533, ADR-0016). Its Blueprint's `textureSets` are
// written as beside Kept ground (kept-terrain/texture-sets.ts plans them, names them and writes
// their t3Terrain.xml lines, sync names and CTerrain overrides), onto a fresh map: one set of the
// Mission's 8 textures (`textures`, `texturePalette`), every block on it, nothing painted yet, so no
// ground's look is at stake. The Zones are painted afterwards from the sets their blocks are on
// (paint-textures.ts).
//
// - **Which set a block is on.** Each Zone covers the cells whose centre its polygon holds (the
//   last Zone listed wins a cell), and a Zone in no set counts for set 0. A block goes to the set
//   whose Zones cover most of its cells; a tie goes to set 0, then to the set listed first in
//   `textureSets`. A block no Zone covers stays on set 0.
// - **Snapped blocks.** A block shared by Zones of two sets draws on its set alone: the other Zones'
//   cells there are painted from it, with the texture most of the block's cells wear, and the
//   compile warns, listing the blocks (the author's call on #533: snap, don't refuse).

import { Buffer } from "node:buffer";

import { type MissionBlueprint, textureSetMapSizeMessage, textureSetOfZone } from "../domain/mission-blueprint.js";
import { type KeptTextures, SYNC_HEADER } from "../kept-terrain/paint-brushes.js";
import { blockLabel, blockOrigin, CELLS_PER_BLOCK, LAYERS, SETS, TEXELS_PER_CELL } from "./texture-grid.js";
import { planTextureSets, type TextureSetPlan } from "../kept-terrain/texture-sets.js";
import { writeT3SyncTextureInfo } from "./write-t3-sync-texture-info.js";

/** Snapped blocks a warning lists by name before it counts the rest. */
const BLOCKS_SHOWN = 12;

export type GeneratedTextureSets = {
  /** The sets as planned: each set's slots and name, each block's set, each Zone's set. */
  readonly plan: TextureSetPlan;
  /** The fresh map's textures the plan starts from: one set, every block on it, nothing painted. */
  readonly before: KeptTextures;
  readonly warnings: readonly string[];
};

/**
 * A fresh generated map's textures, as readKeptTextures reads them from its unpainted files: one
 * set of the Mission's 8 `textures`, named after its tileset, every block on it, every mask 0.
 */
export function freshTextures(tilesetId: string, width: number, height: number, textures: readonly string[]): KeptTextures {
  const cells = width * height;
  const [maskWidth, maskHeight] = [width * TEXELS_PER_CELL, height * TEXELS_PER_CELL];
  // t3TextureMasks' header (as writeT3TextureMasks writes it), then 8 layers of 4-bit weights, all 0.
  const masksFile = Buffer.alloc(64 + (LAYERS * maskWidth * maskHeight) / 2);
  masksFile.write("MASK", 0, "ascii");
  masksFile.writeUInt32LE(102, 4);
  masksFile.writeUInt32LE(maskWidth, 12);
  masksFile.writeUInt32LE(maskHeight, 16);
  const syncNames = Array.from({ length: LAYERS }, (_, layer) => textures[layer] ?? "");
  const syncFile = writeT3SyncTextureInfo({ width, height, textureSetCount: 1, textureNames: syncNames, dominantTextureIndices: new Uint32Array(cells), textureSetIndices: new Uint32Array(cells) });
  const blocksPerRow = width / CELLS_PER_BLOCK;
  return {
    width,
    height,
    slots: Array.from({ length: SETS * LAYERS }, (_, slot) => textures[slot] ?? ""),
    sets: Array.from({ length: SETS }, (_, set) => (set === 0 ? tilesetId : "")),
    setCount: 1,
    blockSets: new Uint8Array(blocksPerRow * (height / CELLS_PER_BLOCK)),
    blocksPerRow,
    masks: { maskWidth, maskHeight, layers: Array.from({ length: LAYERS }, () => new Uint8Array(maskWidth * maskHeight)) },
    masksFile,
    syncFile,
    syncNames,
    syncCells: SYNC_HEADER + syncNames.reduce((sum, name) => sum + name.length + 1, 0),
  };
}

/**
 * The Blueprint's texture sets on a fresh generated map, as above; undefined when it has none.
 * `owner` is each cell's Zone (paint-textures.ts's zoneOwners).
 */
export function generatedTextureSets(blueprint: MissionBlueprint, textures: readonly string[], owner: Int16Array): GeneratedTextureSets | undefined {
  const sets = blueprint.textureSets ?? [];
  if (sets.length === 0) return undefined;
  const { width, height } = blueprint.mapSize;
  // The schema refuses this; kept for a Blueprint built without it.
  if (width % CELLS_PER_BLOCK !== 0 || height % CELLS_PER_BLOCK !== 0) throw new Error(textureSetMapSizeMessage(width, height));
  const cells = width * height;
  const before = freshTextures(blueprint.tilesetId ?? "KorhalCityEx2", width, height, textures);

  // Each Zone's set, by its place in textureSets (1 the first), 0 for none.
  const setOfZone = new Map([...textureSetOfZone(sets, blueprint.zones)].map(([id, index]) => [id, index + 1]));
  const ownSet = (cell: number) => setOfZone.get(blueprint.zones[owner[cell]!]!.id) ?? 0;
  // Each block's winner; a cell of a set's Zone in a block another set wins isn't the set's to claim.
  const owned = new Uint8Array(cells);
  const blocksPerRow = width / CELLS_PER_BLOCK;
  const snapped: { block: number; winner: number; over: Map<string, number> }[] = [];
  for (let block = 0; block < before.blockSets.length; block++) {
    const { x: bx, y: by } = blockOrigin(block, blocksPerRow);
    const blockCells: number[] = [];
    for (let y = by; y < by + CELLS_PER_BLOCK; y++) for (let x = bx; x < bx + CELLS_PER_BLOCK; x++) if (owner[y * width + x]! >= 0) blockCells.push(y * width + x);
    const counts = new Array<number>(sets.length + 1).fill(0);
    for (const cell of blockCells) counts[ownSet(cell)]!++;
    // The first set with the most cells: set 0, then textureSets' order, on a tie.
    const winner = counts.indexOf(Math.max(...counts));
    const over = new Map<string, number>();
    for (const cell of blockCells) {
      if (ownSet(cell) === winner) {
        owned[cell] = 1;
        continue;
      }
      const id = blueprint.zones[owner[cell]!]!.id;
      over.set(id, (over.get(id) ?? 0) + 1);
    }
    if (over.size > 0) snapped.push({ block, winner, over });
  }

  const plan = planTextureSets({ blueprint, textures: before, owned, owner, zones: blueprint.zones });
  const warnings = [...plan.warnings];
  if (snapped.length > 0) {
    const label = (winner: number) => (winner === 0 ? "set 0 (the Zones in no set)" : `texture set ${sets[winner - 1]!.id} (set ${plan.indexOf.get(sets[winner - 1]!.id)})`);
    const listed = snapped.slice(0, BLOCKS_SHOWN).map(({ block, winner, over }) => {
      const zones = [...over].map(([id, count]) => `${id}'s ${count} cell${count === 1 ? "" : "s"}`).join(" and ");
      return `block ${block} (cells ${blockLabel(block, blocksPerRow)}) went to ${label(winner)}, over Zone ${zones}`;
    });
    const more = snapped.length > BLOCKS_SHOWN ? `; and ${snapped.length - BLOCKS_SHOWN} more` : "";
    warnings.push(
      `${snapped.length} block${snapped.length === 1 ? " holds" : "s hold"} Zones of two texture sets, and a block draws on one set: each went to the set whose Zones cover most of its cells (a tie to set 0, then the set listed first), and the other Zones' cells there are painted from that set's textures. Line the Zones' edges up with the 8-cell blocks to keep their own: ${listed.join("; ")}${more}`,
    );
  }
  return { plan, before, warnings };
}
