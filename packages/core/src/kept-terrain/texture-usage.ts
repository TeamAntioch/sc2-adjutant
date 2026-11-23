// What a Map Package's texture slots paint, and where (ADR-0016): for choosing a texture set's
// textures so the map stays under the Editor's 16. For each slot of each set, the cells it is the
// dominant texture of, by Zone, and the cells with any weight of it; which slots are empty or
// painted nowhere; and, for a proposed set over some Zones, which of its textures the map has
// already, which layers it must match for the Kept ground in its blocks, and which slots of the
// other sets only those Zones use, so the move would free them. And each stretch of boundary between
// sets that needs cover (set-boundaries.ts).

import { MAX_MAP_TEXTURES } from "../domain/mission-blueprint.js";
import { containsPoint } from "../terrain/rasterize.js";
import { cellLayerBits, cellSet, dominantLayer, type KeptTextures, setTextures } from "./paint-brushes.js";
import { blockOf, blockOrigin, CELLS_PER_BLOCK, LAYERS } from "../terrain/texture-grid.js";
import { describeStretches, setBoundaryStretches, type SetBoundaries, stretchCells, stretchCount, underCliffNote } from "./set-boundaries.js";

type Zone = { readonly id: string; readonly polygon: readonly { readonly x: number; readonly y: number }[]; readonly terrain?: "generate" | "kept" | undefined };

export type SlotUsage = {
  readonly slot: number;
  readonly set: number;
  readonly texture: string;
  /** Cells it is the dominant texture of. */
  readonly dominant: number;
  /** Cells with any weight of it. */
  readonly any: number;
  /** Dominant cells by Zone, most first; cells in no Zone under "(no Zone)". */
  readonly byZone: readonly { readonly zone: string; readonly cells: number }[];
};

export type TextureUsage = {
  readonly sets: readonly { readonly index: number; readonly name: string; readonly blocks: number }[];
  readonly slots: readonly SlotUsage[];
  /** The different textures the map's sets hold, and how many more the Editor allows. */
  readonly distinct: readonly string[];
  readonly room: number;
  /** Slots holding a texture no cell has any weight of: emptying them frees it, unless another slot has it. */
  readonly unused: readonly number[];
  /** Empty slots in the map's sets. */
  readonly empty: readonly number[];
  /** The stretches of boundary between sets that need cover: hard cuts and artifacts, those under a cliff left out. */
  readonly boundaries: SetBoundaries;
};

export const NO_ZONE = "(no Zone)";

/**
 * Each cell's Zone: a generating Zone's own cells (`owner`, from ownedCells), else the first Kept
 * Zone whose polygon holds the cell's middle; undefined in no Zone.
 */
export function cellZones(width: number, height: number, zones: readonly Zone[], owned?: { readonly owned: Uint8Array; readonly owner: Int16Array; readonly generating: readonly Zone[] }): (string | undefined)[] {
  const out = new Array<string | undefined>(width * height).fill(undefined);
  const kept = zones.filter((zone) => zone.terrain !== "generate");
  for (const zone of kept) {
    const xs = zone.polygon.map((point) => point.x);
    const ys = zone.polygon.map((point) => point.y);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(height, Math.ceil(Math.max(...ys))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(width, Math.ceil(Math.max(...xs))); x++) {
        if (out[y * width + x] === undefined && containsPoint(zone.polygon, { x: x + 0.5, y: y + 0.5 })) out[y * width + x] = zone.id;
      }
    }
  }
  if (owned) for (let cell = 0; cell < out.length; cell++) if (owned.owned[cell]) out[cell] = owned.generating[owned.owner[cell]!]!.id;
  return out;
}

/** What each slot of the map's sets paints, and where. `cellFlags` (t3CellFlags' cells) marks the cells under a cliff. */
export function textureUsage(textures: KeptTextures, zoneOf: readonly (string | undefined)[], cellFlags?: Uint8Array): TextureUsage {
  const { width, height, masks, setCount } = textures;
  const bits = cellLayerBits(masks, width, height);
  const dominant = new Array<number>(setCount * LAYERS).fill(0);
  const any = new Array<number>(setCount * LAYERS).fill(0);
  const byZone = Array.from({ length: setCount * LAYERS }, () => new Map<string, number>());
  const blocks = new Array<number>(setCount).fill(0);
  for (const set of textures.blockSets) if (set < setCount) blocks[set]!++;
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const cell = cy * width + cx;
      const set = cellSet(textures, cx, cy);
      const top = set * LAYERS + dominantLayer(masks, width, cell);
      dominant[top]!++;
      const zone = zoneOf[cell] ?? NO_ZONE;
      byZone[top]!.set(zone, (byZone[top]!.get(zone) ?? 0) + 1);
      for (let layer = 0; layer < LAYERS; layer++) if (bits[cell]! & (1 << layer)) any[set * LAYERS + layer]!++;
    }
  }
  const slots: SlotUsage[] = [];
  for (let slot = 0; slot < setCount * LAYERS; slot++) {
    const texture = textures.slots[slot] ?? "";
    // An empty slot's layer still has weight where nothing was painted: it shows as nothing, so it isn't reported as used.
    slots.push({
      slot,
      set: Math.floor(slot / LAYERS),
      texture,
      dominant: dominant[slot]!,
      any: any[slot]!,
      byZone: [...byZone[slot]!].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([zone, cells]) => ({ zone, cells })),
    });
  }
  const distinct = [...new Set(textures.slots.slice(0, setCount * LAYERS).filter((name) => name !== ""))];
  return {
    sets: Array.from({ length: setCount }, (_, index) => ({ index, name: textures.sets[index] ?? "", blocks: blocks[index]! })),
    slots,
    distinct,
    room: MAX_MAP_TEXTURES - distinct.length,
    unused: slots.filter((usage) => usage.texture !== "" && usage.any === 0).map((usage) => usage.slot),
    empty: slots.filter((usage) => usage.texture === "").map((usage) => usage.slot),
    boundaries: setBoundaryStretches(textures, { cellFlags }),
  };
}

export type SetProposal = {
  /** The proposal's textures the map has already (cost nothing towards the 16), with their slots. */
  readonly reused: readonly { readonly texture: string; readonly slots: readonly number[] }[];
  /** Those it doesn't. */
  readonly added: readonly string[];
  /** Different textures on the map after, and whether that fits the Editor's 16. */
  readonly distinctAfter: number;
  readonly fits: boolean;
  /** The blocks the set's Zones' cells are in. */
  readonly blocks: readonly number[];
  /** Layers the Kept ground in those blocks uses, each with its texture now: the set must hold that texture on that layer. */
  readonly required: readonly { readonly layer: number; readonly texture: string; readonly cells: number }[];
  /** Required textures missing from the proposal. */
  readonly missing: readonly string[];
  /** The proposal in an order that meets `required` (required textures at their layers, the rest in the order given), or undefined when it can't. */
  readonly order: readonly string[] | undefined;
  /** Slots of the map's sets whose texture the set doesn't hold and that only the set's Zones use, so moving them onto the set frees them (empty them after). */
  readonly freed: readonly number[];
  /** Textures in the set that a neighbouring block's set holds too: where they meet across the boundary, the Editor renders a glitch, on any layer. */
  readonly seamRisks: readonly string[];
};

/**
 * What a proposed set over some cells (`cells`: the Zones' own cells) would reuse, need and free.
 * `owned` marks every generating Zone's cells, which the compile repaints: the rest is Kept.
 */
export function proposeSet(textures: KeptTextures, usage: TextureUsage, proposal: readonly string[], cells: Uint8Array, owned: Uint8Array): SetProposal {
  const { width, height, blocksPerRow, masks } = textures;
  const bits = cellLayerBits(masks, width, height);
  const inMap = (texture: string) => usage.slots.filter((slot) => slot.texture === texture).map((slot) => slot.slot);
  const reused = proposal.flatMap((texture) => (inMap(texture).length ? [{ texture, slots: inMap(texture) }] : []));
  const added = proposal.filter((texture) => inMap(texture).length === 0);
  const distinctAfter = new Set([...usage.distinct, ...proposal]).size;

  const blockSet = new Set<number>();
  for (let cell = 0; cell < cells.length; cell++) if (cells[cell]) blockSet.add(blockOf(blocksPerRow, cell % width, Math.floor(cell / width)));
  const blocks = [...blockSet].sort((a, b) => a - b);
  const required = new Map<string, { layer: number; texture: string; cells: number }>();
  for (const block of blocks) {
    const { x: bx, y: by } = blockOrigin(block, blocksPerRow);
    const names = setTextures(textures, textures.blockSets[block]!);
    for (let cy = by; cy < by + CELLS_PER_BLOCK; cy++) {
      for (let cx = bx; cx < bx + CELLS_PER_BLOCK; cx++) {
        if (owned[cy * width + cx]) continue;
        for (let layer = 0; layer < LAYERS; layer++) {
          if (!(bits[cy * width + cx]! & (1 << layer))) continue;
          const texture = names[layer] ?? "";
          const key = `${layer}:${texture}`;
          const entry = required.get(key) ?? { layer, texture, cells: 0 };
          entry.cells++;
          required.set(key, entry);
        }
      }
    }
  }
  const needs = [...required.values()].sort((a, b) => a.layer - b.layer);
  // An empty slot with weight shows nothing: the set must leave that layer empty too, which isn't a texture to add.
  const missing = [...new Set(needs.map((need) => need.texture).filter((texture) => texture !== "" && !proposal.includes(texture)))];
  const order = arrange(proposal, needs);

  // A slot used only inside the set's Zones' cells is freed by the move, unless the set holds its texture too (then the count doesn't drop).
  const freed: number[] = [];
  for (const slot of usage.slots) {
    if (slot.texture === "" || slot.any === 0 || proposal.includes(slot.texture)) continue;
    let outside = false;
    for (let cy = 0; cy < height && !outside; cy++) {
      for (let cx = 0; cx < width && !outside; cx++) {
        if (cells[cy * width + cx] || cellSet(textures, cx, cy) !== slot.set) continue;
        if (bits[cy * width + cx]! & (1 << (slot.slot % LAYERS))) outside = true;
      }
    }
    if (!outside && !needs.some((need) => need.texture === slot.texture)) freed.push(slot.slot);
  }

  // A texture in the proposal and in a neighbouring block's set glitches where it meets itself at the boundary, on any layer.
  const seamRisks = new Set<string>();
  const finalOrder = order ?? proposal;
  for (const block of blocks) {
    const bx = block % blocksPerRow;
    const by = Math.floor(block / blocksPerRow);
    for (const [nx, ny] of [[bx + 1, by], [bx - 1, by], [bx, by + 1], [bx, by - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= blocksPerRow || ny >= textures.blockSets.length / blocksPerRow) continue;
      const neighbour = ny * blocksPerRow + nx;
      if (blockSet.has(neighbour)) continue;
      const names = setTextures(textures, textures.blockSets[neighbour]!);
      for (const texture of finalOrder) {
        const there = names.indexOf(texture);
        if (there >= 0) seamRisks.add(texture);
      }
    }
  }
  return { reused, added, distinctAfter, fits: distinctAfter <= MAX_MAP_TEXTURES, blocks, required: needs, missing, order, freed: freed.sort((a, b) => a - b), seamRisks: [...seamRisks] };
}

/** The proposal ordered so each required texture sits at its layer, or undefined when two need one layer or one is missing. */
function arrange(proposal: readonly string[], needs: readonly { readonly layer: number; readonly texture: string }[]): string[] | undefined {
  const out = new Array<string | undefined>(LAYERS).fill(undefined);
  for (const need of needs) {
    // "" is an empty slot the layer must stay.
    if (need.texture !== "" && !proposal.includes(need.texture)) return undefined;
    if (out[need.layer] !== undefined && out[need.layer] !== need.texture) return undefined;
    if (need.texture !== "" && out.includes(need.texture) && out[need.layer] !== need.texture) return undefined;
    out[need.layer] = need.texture;
  }
  const rest = proposal.filter((texture) => !out.includes(texture));
  for (let layer = 0; layer < LAYERS && rest.length; layer++) if (out[layer] === undefined) out[layer] = rest.shift();
  if (rest.length) return undefined;
  const last = out.findLastIndex((texture) => texture !== undefined);
  return out.slice(0, last + 1).map((texture) => texture ?? "");
}

/** The report as text, slot by slot, for the CLI and the MCP tool. */
export function describeUsage(usage: TextureUsage, proposal?: SetProposal, proposed?: readonly string[]): string {
  const lines: string[] = [];
  for (const set of usage.sets) {
    lines.push(`Set ${set.index} ${set.name || "(unnamed)"}: ${set.blocks} block${set.blocks === 1 ? "" : "s"} of 8×8 cells`);
    for (const slot of usage.slots.filter((s) => s.set === set.index)) {
      if (slot.texture === "") {
        lines.push(`  slot ${slot.slot}: (empty)`);
        continue;
      }
      const where = slot.byZone.slice(0, 6).map(({ zone, cells }) => `${zone} ${cells}`).join(", ");
      const more = slot.byZone.length > 6 ? `, and ${slot.byZone.length - 6} more Zones` : "";
      lines.push(`  slot ${slot.slot}: ${slot.texture}: dominant in ${slot.dominant} cells${where ? ` (${where}${more})` : ""}, any weight in ${slot.any}${slot.any === 0 ? ": painted nowhere" : ""}`);
    }
  }
  lines.push(`${usage.distinct.length} different textures; the Editor allows ${MAX_MAP_TEXTURES}, so ${usage.room} more fit.`);
  if (usage.unused.length) lines.push(`Painted nowhere: slot${usage.unused.length === 1 ? "" : "s"} ${usage.unused.join(", ")}. Emptying ${usage.unused.length === 1 ? "it" : "them"} frees room, unless another slot holds the same texture.`);
  lines.push(...describeBoundaries(usage.boundaries));
  if (proposal && proposed) {
    lines.push("", `Proposed set: ${proposed.join(", ")}`);
    lines.push(`  Reused (cost nothing): ${proposal.reused.map((r) => `${r.texture} (slot ${r.slots.join(", ")})`).join(", ") || "none"}`);
    lines.push(`  New: ${proposal.added.join(", ") || "none"}`);
    lines.push(`  ${proposal.distinctAfter} different textures after: ${proposal.fits ? "fits" : `over the Editor's ${MAX_MAP_TEXTURES}`}.`);
    lines.push(`  Blocks its Zones' cells are in: ${proposal.blocks.length}.`);
    if (proposal.required.length) {
      lines.push(`  Kept ground in those blocks shows ${proposal.required.map((r) => `${r.texture || "(empty slot)"} on layer ${r.layer} (${r.cells} cells)`).join(", ")}: the set must hold each on the same layer.`);
    } else lines.push("  No Kept ground in those blocks: any order works.");
    if (proposal.missing.length) lines.push(`  Missing: ${proposal.missing.join(", ")}. Add ${proposal.missing.length === 1 ? "it" : "them"}, or keep the Zones off those blocks.`);
    if (proposal.order) lines.push(`  Slot order that works: ${proposal.order.map((t, i) => `${i} ${t || "(empty)"}`).join(", ")}.`);
    else if (!proposal.missing.length) lines.push("  No order meets those layers: two textures need one layer.");
    if (proposal.freed.length) lines.push(`  Only these Zones use slot${proposal.freed.length === 1 ? "" : "s"} ${proposal.freed.join(", ")}: after the move, emptying ${proposal.freed.length === 1 ? "it" : "them"} frees room.`);
    if (proposal.seamRisks.length) lines.push(`  ${proposal.seamRisks.join(", ")} ${proposal.seamRisks.length === 1 ? "is" : "are"} in the set and next to it too: where ${proposal.seamRisks.length === 1 ? "it meets itself" : "one meets itself"} across the boundary the Editor renders a glitch, and different textures meet in a hard cut. Keep the boundary under a wall, a cliff or doodads, or out of sight.`);
  }
  return lines.join("\n");
}

/** The boundary section of the report: each stretch that needs cover, and the cells left out under a cliff. */
export function describeBoundaries({ stretches, underCliff }: SetBoundaries): string[] {
  const cliff = underCliffNote(underCliff);
  if (stretches.length === 0) return underCliff ? ["", `Set boundaries: every stretch is under a cliff.${cliff}`] : [];
  return [
    "",
    `Set boundaries: ${stretchCount(stretches.length)} need${stretches.length === 1 ? "s" : ""} cover (${stretchCells(stretches)} cells along block edges), under a wall, a cliff or doodads. Cells are given either side of the line.${cliff}`,
    ...describeStretches(stretches).map((line) => `  ${line}`),
  ];
}
