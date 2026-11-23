// Hidden cells (zone.hiddenCells, #595): cells whose ground doesn't draw, as the Editor's Hide
// Terrain brush leaves them, t3CellFlags bit 0x4. The compile writes the bit on the cells it owns
// (a generated map's every cell, a generating Zone's own beside Kept ground) from the Zones' rects,
// and leaves every other bit it doesn't work out (all but cliff and ground) as the package has it.

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { CELL_FLAG_HIDDEN } from "./cliffs.js";

type Rect = readonly [number, number, number, number];

/** The cells the Zones' hiddenCells list (a Kept Zone's aren't the compile's), 1 per hidden cell. */
export function hiddenCellMask(blueprint: Pick<MissionBlueprint, "zones">, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const zone of blueprint.zones) {
    if (zone.terrain === "kept") continue;
    for (const rect of zone.hiddenCells ?? []) markRect(mask, rect, width, height);
  }
  return mask;
}

/** Marks the rectangle's cells inside the map. */
export function markRect(mask: Uint8Array, [x0, y0, w, h]: Rect, width: number, height: number): void {
  for (let y = y0; y < Math.min(height, y0 + h); y++) for (let x = x0; x < Math.min(width, x0 + w); x++) mask[y * width + x] = 1;
}

/** `flags` with the hidden bit as `hidden` has it on the cells `writable` marks (every cell when it's undefined), and as `flags` has it elsewhere. */
export function writeHiddenBit(flags: Uint8Array, hidden: Uint8Array, writable?: Uint8Array): Uint8Array {
  const out = Uint8Array.from(flags);
  for (let cell = 0; cell < out.length; cell++) {
    if (writable && !writable[cell]) continue;
    out[cell] = hidden[cell] ? out[cell]! | CELL_FLAG_HIDDEN : out[cell]! & ~CELL_FLAG_HIDDEN;
  }
  return out;
}

/**
 * A warning for the hidden cells the compile doesn't own beside Kept ground (a cell of a part 2×2
 * cliff cell at a Zone's edge), whose ground stays as the package has it; undefined for none.
 */
export function unownedHiddenWarning(hidden: Uint8Array, owned: Uint8Array, width: number): string | undefined {
  let skipped = 0;
  let first = -1;
  for (let cell = 0; cell < hidden.length; cell++) {
    if (!hidden[cell] || owned[cell]) continue;
    skipped++;
    if (first < 0) first = cell;
  }
  if (skipped === 0) return undefined;
  return `${skipped} hidden cell${skipped === 1 ? "" : "s"}, the first at (${first % width}, ${Math.floor(first / width)}), ${skipped === 1 ? "isn't" : "aren't"} a generating Zone's to write (only whole 2×2 cliff cells inside it are), so the package's ground there stays as it is: hide ${skipped === 1 ? "it" : "them"} in the Editor, or grow the Zone`;
}
