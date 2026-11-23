import { Buffer } from "node:buffer";

// CellAttribute_* files hold the Editor's painted cell attributes (Pnp: no pathing). A uint32 (LE)
// header counts the sub-cell bits, 8 a cell (00 00 02 00 on a 128×128 map, 00 00 08 00 on
// a 256×256 Kept map, and width × height × 8 on every ladder map checked), then one byte per
// cell, row by row from the bottom. A byte's bits are the cell's 8 sub-cells (see pathingBit): 255
// is a whole cell painted. The Editor writes a file only once an attribute is painted, and doesn't
// list it in ComponentList. Until 2026-11-01 our compile wrote 00 00 02 00 at every map size, so a
// file of the right length with that header is read too; writing it again gives the right header.

/** The Editor's painted pathing layer. */
export const PATHING_FILE = "CellAttribute_Pnp";
/** The bytes before the cells. */
export const CELL_ATTRIBUTE_HEADER = 4;
/** A cell painted whole. */
export const WHOLE_CELL = 0xff;

/**
 * The bit of a cell's byte for its sub-cell (column, row). Each cell is 2 sub-cells wide and 4 high
 * (0.5 × 0.25 cells), row 0 at the bottom, so the high nibble is the cell's bottom half. Read from
 * 1-8's painted ponds and the author's Editor test pit (2026-10-28).
 */
export const pathingBit = (column: number, row: number): number => 1 << ((row < 2 ? 4 : 0) + 2 * column + (row % 2));

export function writeCellAttribute(cells: Uint8Array): Buffer {
  const header = Buffer.alloc(CELL_ATTRIBUTE_HEADER);
  header.writeUInt32LE(cells.length * 8, 0);
  return Buffer.concat([header, Buffer.from(cells)]);
}

/** The header our compile wrote at every map size before it counted the sub-cells: 128×128's. */
const OLD_HEADER = 128 * 128 * 8;

/** Whether a CellAttribute_* file fits a map of `width` × `height` cells: its length, and the Editor's header or our compile's old one. */
export function cellAttributeFits(file: Buffer, width: number, height: number): boolean {
  const cells = width * height;
  return file.length === CELL_ATTRIBUTE_HEADER + cells && [cells * 8, OLD_HEADER].includes(file.readUInt32LE(0));
}

/** The cells of a CellAttribute_* file for a map of `width` × `height` cells, refusing one that doesn't fit ({@link cellAttributeFits}). */
export function readCellAttribute(file: Buffer, width: number, height: number, name = PATHING_FILE): Uint8Array {
  const cells = width * height;
  if (!cellAttributeFits(file, width, height)) {
    throw new Error(`${name} isn't a painted layer of ${width}×${height} cells (a header of ${cells * 8} sub-cells, then a byte a cell), so it isn't edited`);
  }
  return Uint8Array.from(file.subarray(CELL_ATTRIBUTE_HEADER));
}
