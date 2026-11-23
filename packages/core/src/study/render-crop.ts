// The window a cropped render shows (the Kept terrain brushes' renders and texture_usage's boundary
// views): a rectangle of cells inside the map, and a map-wide layer of a byte per cell cut to it.

import { CELL_FLAG_CLIFF } from "../terrain/cliffs.js";

/** A rectangle of cells, x and y its south-west corner. */
export type CropRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
type MapSize = { readonly width: number; readonly height: number };

/** Cells of margin round what a cropped render shows. */
export const CROP_MARGIN = 8;

/** The cells from (x0, y0) up to, not including, (x1, y1), inside the map. */
export function clampCrop(x0: number, y0: number, x1: number, y1: number, map: MapSize): CropRect {
  const x = Math.max(0, x0);
  const y = Math.max(0, y0);
  return { x, y, width: Math.min(map.width, x1) - x, height: Math.min(map.height, y1) - y };
}

/** `rect` with {@link CROP_MARGIN} cells round it, inside the map. */
export const cropAround = (rect: CropRect, map: MapSize): CropRect => clampCrop(rect.x - CROP_MARGIN, rect.y - CROP_MARGIN, rect.x + rect.width + CROP_MARGIN, rect.y + rect.height + CROP_MARGIN, map);

/** The cells of `all` (a byte per map cell, [y * width + x]) inside `crop`. */
export function windowCells(all: Uint8Array, crop: CropRect, width: number): Uint8Array {
  const out = new Uint8Array(crop.width * crop.height);
  for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) out[y * crop.width + x] = all[(crop.y + y) * width + crop.x + x]!;
  return out;
}

/** The cells under a cliff mesh (t3CellFlags bit 0x01), from the map's cell flags; none without them. */
export const cliffMask = (cellFlags: Uint8Array | undefined, map: MapSize): Uint8Array => (cellFlags ? cellFlags.map((flag) => flag & CELL_FLAG_CLIFF) : new Uint8Array(map.width * map.height));
