// The pathing brush on Kept ground (spec #247): paint an area unpathable, or clear its paint so it
// is pathable again, in the Editor's painted pathing layer, CellAttribute_Pnp
// (src/terrain/write-cell-attribute.ts).
//
// - The layer has a byte per cell, a bit for each of its 8 sub-cells. The brush paints whole cells:
//   every cell inside the area becomes 255 (blocked) or 0 (cleared), with no falloff, and every
//   other cell keeps its byte, including the Editor's part-painted edges.
// - Only the paint changes. Cliffs, doodad footprints and water still block where they do, and
//   t3CellFlags is left alone: no flag follows the paint (on a 256×256 Kept map the painted cells' flags
//   are 2 or 3, like any ground, and the hidden bit 0x04 is on none of them).
// - Like the Editor, a map with nothing painted has no file: the first stroke writes one, and
//   clearing the last paint removes it.

import { z } from "zod";

import { PATHING_FILE, readCellAttribute, WHOLE_CELL, writeCellAttribute } from "../terrain/write-cell-attribute.js";
import type { AreaMask } from "./area.js";

export { PATHING_FILE };

export const PathingBrushSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("block-pathing") }).strict().describe("Paint the area's cells unpathable"),
  z.object({ op: z.literal("clear-pathing") }).strict().describe("Clear the area's painted pathing, so it is pathable again"),
]);
export type PathingBrush = z.input<typeof PathingBrushSchema>;

const PATHING_OPS: ReadonlySet<string> = new Set(PathingBrushSchema.options.map((option) => option.shape.op.value));
export const isPathingBrush = (brush: { readonly op: string }): brush is PathingBrush => PATHING_OPS.has(brush.op);

/** The package's painted pathing: a byte per cell, all 0 when it has no file. */
export function readKeptPathing(file: Buffer | undefined, width: number, height: number): Uint8Array {
  return file ? readCellAttribute(file, width, height, PATHING_FILE) : new Uint8Array(width * height);
}

export type PathingStroke = {
  /** The layer after the stroke. */
  readonly cells: Uint8Array;
  /** 1 for each cell whose byte changed. */
  readonly changed: Uint8Array;
  readonly count: number;
  /** Changed cells that were painted in part before: the Editor's ragged edges, made whole or cleared. */
  readonly partial: number;
};

/** Blocks or clears every cell inside the area. */
export function applyPathingBrush(pathing: Uint8Array, mask: AreaMask, brush: PathingBrush): PathingStroke {
  const value = brush.op === "block-pathing" ? WHOLE_CELL : 0;
  const cells = Uint8Array.from(pathing);
  const changed = new Uint8Array(pathing.length);
  let count = 0;
  let partial = 0;
  for (let cell = 0; cell < cells.length; cell++) {
    if (!mask.inside[cell] || cells[cell] === value) continue;
    if (cells[cell] !== 0 && cells[cell] !== WHOLE_CELL) partial++;
    cells[cell] = value;
    changed[cell] = 1;
    count++;
  }
  return { cells, changed, count, partial };
}

/** The file for the layer, or undefined when nothing is painted (no file, as the Editor leaves it). */
export function writeKeptPathing(cells: Uint8Array): Buffer | undefined {
  return cells.some((value) => value !== 0) ? writeCellAttribute(cells) : undefined;
}
