import type { RgbImage } from "../map/read-tga.js";
import type { T3TextureMasks } from "../terrain/read-t3-texture-masks.js";
import { pathingBit } from "../terrain/write-cell-attribute.js";
import type { StudiedDoodad } from "./measure-doodads.js";
import { type TerrainGrid, vertexHeightAt } from "./terrain-grid.js";

/** Pixels per terrain cell in the layer renders. */
export const PX = 4;
/** The smallest width or height, in pixels, a crop is scaled up to. */
const VIEW = 512;

// Distinct colours for false-colour texture maps (Kelly's 20, minus white/black).
const PALETTE = [
  [255, 179, 0], [128, 62, 117], [255, 104, 0], [166, 189, 215], [193, 0, 32], [206, 162, 98], [129, 112, 102],
  [0, 125, 52], [246, 118, 142], [0, 83, 138], [255, 122, 92], [83, 55, 122], [255, 142, 0], [179, 40, 81],
  [244, 200, 0], [127, 24, 13], [147, 170, 0], [89, 51, 21], [241, 58, 19], [35, 44, 22],
] as const;

const KIND_COLOUR: Record<string, readonly [number, number, number]> = {};
function kindColour(kind: string): readonly [number, number, number] {
  KIND_COLOUR[kind] ??= PALETTE[Object.keys(KIND_COLOUR).length % PALETTE.length]!;
  return KIND_COLOUR[kind]!;
}

/** The map's size in cells: all the pixel helpers need of a grid. */
type Size = Pick<TerrainGrid, "width" | "height">;

function blank(grid: Size): RgbImage & { rgb: Uint8Array } {
  return { width: grid.width * PX, height: grid.height * PX, rgb: new Uint8Array(grid.width * grid.height * PX * PX * 3) };
}

/** Image rows run top-down, so world y is flipped (north up, as in the Editor). */
function fillCell(img: RgbImage & { rgb: Uint8Array }, grid: Size, cx: number, cy: number, c: readonly number[]) {
  const top = (grid.height - 1 - cy) * PX;
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      const o = ((top + y) * img.width + cx * PX + x) * 3;
      img.rgb[o] = c[0]!;
      img.rgb[o + 1] = c[1]!;
      img.rgb[o + 2] = c[2]!;
    }
  }
}

function dot(img: RgbImage & { rgb: Uint8Array }, grid: Size, wx: number, wy: number, r: number, c: readonly number[]) {
  const px = wx * PX;
  const py = (grid.height - wy) * PX;
  for (let y = Math.floor(py - r); y <= py + r; y++) {
    for (let x = Math.floor(px - r); x <= px + r; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height || (x - px) ** 2 + (y - py) ** 2 > r * r) continue;
      const o = (y * img.width + x) * 3;
      img.rgb[o] = c[0]!;
      img.rgb[o + 1] = c[1]!;
      img.rgb[o + 2] = c[2]!;
    }
  }
}

/** A grey per level, 70 at level 0 to 230: 40 a level up to level 4, closer steps on a map that goes higher. */
function shade(grid: TerrainGrid, i: number, top: number): number {
  if (grid.isCliffEdge[i]) return 40;
  const base = 70 + (Math.min(top, grid.level[i]!) * 160) / top;
  return grid.isPlayable[i] ? base : base * 0.45;
}

/** The level the greys run up to: 4, or the map's highest. */
function topLevel(grid: TerrainGrid): number {
  let top = 4;
  for (const level of grid.level) top = Math.max(top, Math.ceil(level));
  return top;
}

/** Dominant texture per cell in false colour; returns the image and its legend. */
export function renderTextures(grid: TerrainGrid) {
  const img = blank(grid);
  const legend: Record<string, string> = {};
  const colourOf = new Map<string, readonly number[]>();
  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      const i = cy * grid.width + cx;
      let best = 0;
      for (let l = 1; l < 8; l++) if (grid.layerShare[i * 8 + l]! > grid.layerShare[i * 8 + best]!) best = l;
      const name = grid.layerTexture[i * 8 + best] || "(none)";
      if (!colourOf.has(name)) {
        const c = PALETTE[colourOf.size % PALETTE.length]!;
        colourOf.set(name, c);
        legend[name] = `rgb(${c.join(",")})`;
      }
      const c = colourOf.get(name)!;
      const k = grid.isCliffEdge[i] ? 0.55 : grid.isPlayable[i] ? 1 : 0.5;
      fillCell(img, grid, cx, cy, c.map((v) => v * k));
    }
  }
  return { image: img, legend };
}

/** Cliff levels as grey steps, cliff edges dark, ramps blue. */
export function renderElevation(grid: TerrainGrid): RgbImage {
  const img = blank(grid);
  const top = topLevel(grid);
  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      const i = cy * grid.width + cx;
      const g = shade(grid, i, top);
      fillCell(img, grid, cx, cy, grid.isRamp[i] ? [80, 140, 220] : [g, g, g]);
    }
  }
  return img;
}

/** Doodads over faint elevation: dot colour by kind, manipulated doodads in red with a white core. */
export function renderDoodads(grid: TerrainGrid, doodads: readonly StudiedDoodad[]) {
  const img = blank(grid);
  const top = topLevel(grid);
  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      const g = shade(grid, cy * grid.width + cx, top) * 0.6;
      fillCell(img, grid, cx, cy, [g, g, g]);
    }
  }
  const legend: Record<string, string> = {};
  for (const d of doodads) {
    const c = kindColour(d.kind);
    legend[d.kind] = `rgb(${c.join(",")})`;
    dot(img, grid, d.position.x, d.position.y, 1.6, c);
  }
  for (const d of doodads) {
    if (!d.manipulations.some((m) => m !== "noFootprint")) continue;
    dot(img, grid, d.position.x, d.position.y, 2.4, [230, 30, 30]);
    dot(img, grid, d.position.x, d.position.y, 0.9, [255, 255, 255]);
  }
  legend["manipulated (any)"] = "rgb(230,30,30) ring";
  return { image: img, legend };
}

/** t3VertCol kind-1 values per cell (corner mean): white untouched, darker where darkened; cliff edges in blue. */
export function renderVertexShading(grid: TerrainGrid, vertexValues: Uint8Array): RgbImage {
  const img = blank(grid);
  const vw = grid.width + 1;
  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      const i = cy * grid.width + cx;
      const v = (vertexValues[cy * vw + cx]! + vertexValues[cy * vw + cx + 1]! + vertexValues[(cy + 1) * vw + cx]! + vertexValues[(cy + 1) * vw + cx + 1]!) / 4;
      const k = grid.isPlayable[i] ? 1 : 0.6;
      fillCell(img, grid, cx, cy, grid.isCliffEdge[i] ? [60, 90, 160] : [v * k, v * k, v * k]);
    }
  }
  return img;
}

/** Contour spacing in the height layer, in height units. */
export const CONTOUR = 0.5;
/** How much the height layer's relief exaggerates slopes, so a fraction of a unit shows. */
const RELIEF = 6;

/**
 * Heights as shaded relief: lit from the north-west, slopes exaggerated, tinted from dark blue-grey
 * (low) to sand (high) over `range` (by default the heights' own), with a thin contour every
 * {@link CONTOUR} units. `heights` are per vertex ((width + 1) × (height + 1)). It shows what the
 * elevation layer can't: sculpted height within a cliff level.
 */
export function renderHeight(grid: Size, heights: Float32Array, range?: readonly [number, number]): RgbImage {
  const img = blank(grid);
  const columns = grid.width + 1;
  let [low, high] = range ?? [Infinity, -Infinity];
  if (!range) for (const h of heights) [low, high] = [Math.min(low, h), Math.max(high, h)];
  const span = Math.max(high - low, 1e-6);
  const at = (wx: number, wy: number) => vertexHeightAt(heights, columns, wx, wy);
  const step = 1 / PX;
  // Light from the north-west, 45 degrees up.
  const light = [-0.5, 0.5, Math.SQRT1_2];
  for (let py = 0; py < img.height; py++) {
    for (let px = 0; px < img.width; px++) {
      const wx = (px + 0.5) * step;
      const wy = grid.height - (py + 0.5) * step;
      const h = at(wx, wy);
      const dx = ((at(wx + step, wy) - at(wx - step, wy)) / (2 * step)) * RELIEF;
      const dy = ((at(wx, wy + step) - at(wx, wy - step)) / (2 * step)) * RELIEF;
      const length = Math.hypot(dx, dy, 1);
      const lit = Math.max(0, (-dx * light[0]! - dy * light[1]! + light[2]!) / length);
      const t = Math.min(1, Math.max(0, (h - low) / span));
      const tint = [70 + t * 160, 80 + t * 130, 100 + t * 60];
      const shadeBy = 0.35 + 0.65 * lit;
      const contour = Math.floor(h / CONTOUR) !== Math.floor(at(wx + step, wy) / CONTOUR) || Math.floor(h / CONTOUR) !== Math.floor(at(wx, wy - step) / CONTOUR);
      const o = (py * img.width + px) * 3;
      for (let c = 0; c < 3; c++) img.rgb[o + c] = Math.round(Math.min(255, tint[c]! * shadeBy * (contour ? 0.7 : 1)));
    }
  }
  return img;
}

/**
 * The change in height per cell (the mean of its corners'): red where it rose, blue where it fell,
 * white where it stayed, full colour at `scale` units (by default the largest change).
 */
export function renderHeightChange(grid: Size, before: Float32Array, after: Float32Array, scale?: number): RgbImage {
  const img = blank(grid);
  const columns = grid.width + 1;
  const change = new Float32Array(grid.width * grid.height);
  let largest = 0;
  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      let sum = 0;
      for (const v of [cy * columns + cx, cy * columns + cx + 1, (cy + 1) * columns + cx, (cy + 1) * columns + cx + 1]) sum += after[v]! - before[v]!;
      change[cy * grid.width + cx] = sum / 4;
      largest = Math.max(largest, Math.abs(sum / 4));
    }
  }
  const full = scale ?? Math.max(largest, 1e-6);
  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      const d = change[cy * grid.width + cx]!;
      const k = Math.min(1, Math.abs(d) / full);
      fillCell(img, grid, cx, cy, d >= 0 ? [255, 255 - 200 * k, 255 - 200 * k] : [255 - 200 * k, 255 - 200 * k, 255]);
    }
  }
  return img;
}

/** Draws the outline of the cells `mask` marks (1 per cell), one pixel inside their edge. */
export function outlineCells(image: RgbImage, grid: Size, mask: Uint8Array, colour: readonly number[]): RgbImage {
  const img = { ...image, rgb: Uint8Array.from(image.rgb) };
  const inMask = (x: number, y: number) => x >= 0 && y >= 0 && x < grid.width && y < grid.height && mask[y * grid.width + x] === 1;
  const paint = (px: number, py: number) => {
    const o = (py * img.width + px) * 3;
    img.rgb[o] = colour[0]!;
    img.rgb[o + 1] = colour[1]!;
    img.rgb[o + 2] = colour[2]!;
  };
  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      if (!inMask(cx, cy)) continue;
      const top = (grid.height - 1 - cy) * PX;
      const left = cx * PX;
      for (let i = 0; i < PX; i++) {
        if (!inMask(cx, cy + 1)) paint(left + i, top);
        if (!inMask(cx, cy - 1)) paint(left + i, top + PX - 1);
        if (!inMask(cx - 1, cy)) paint(left, top + i);
        if (!inMask(cx + 1, cy)) paint(left + PX - 1, top + i);
      }
    }
  }
  return img;
}

/** Dots at world positions (doodads), on a copy of `image`. */
export function markPositions(image: RgbImage, grid: Size, positions: readonly { readonly x: number; readonly y: number }[], colour: readonly number[]): RgbImage {
  const img = { ...image, rgb: Uint8Array.from(image.rgb) };
  for (const position of positions) dot(img, grid, position.x, position.y, 1.2, colour);
  return img;
}

/** Each layer's colour, or a function giving a cell's layer colours (by its block's texture set). */
export type LayerColours = readonly (readonly number[])[] | ((cellX: number, cellY: number) => readonly (readonly number[])[]);

/** A distinct colour for each texture name, in order (empty slots grey). */
export function textureColours(names: readonly string[]): Map<string, readonly number[]> {
  const colours = new Map<string, readonly number[]>([["", [128, 128, 128]]]);
  for (const name of names) if (!colours.has(name)) colours.set(name, PALETTE[(colours.size - 1) % PALETTE.length]!);
  return colours;
}

/** The texels under one pixel of a cell (8 texels per cell, {@link PX} pixels): [x0, y0, x1, y1), texel rows from y = 0. */
function texelsUnder(grid: Size, origin: { x: number; y: number }, px: number, py: number): readonly [number, number, number, number] {
  const perCell = 8;
  const per = perCell / PX;
  const cx = origin.x + Math.floor(px / PX);
  const cy = origin.y + grid.height - 1 - Math.floor(py / PX);
  const x0 = cx * perCell + (px % PX) * per;
  // Image rows run top-down, so within the cell the first pixel row is its top texels.
  const y0 = cy * perCell + (PX - 1 - (py % PX)) * per;
  return [x0, y0, x0 + per, y0 + per];
}

/**
 * The texture masks as a blend of the textures' colours: each pixel (2×2 texels) mixes the layer
 * colours by their weights, so a feathered edge shows as a gradient. `grid` is the window's size
 * in cells and `origin` its first cell. `colours` gives each layer's colour, or a cell's layer
 * colours where the map has several texture sets (a layer shows its block's set's texture).
 */
export function renderTextureBlend(grid: Size, masks: T3TextureMasks, origin: { x: number; y: number }, layerColours: LayerColours): RgbImage {
  const img = blank(grid);
  for (let py = 0; py < img.height; py++) {
    for (let px = 0; px < img.width; px++) {
      const [x0, y0, x1, y1] = texelsUnder(grid, origin, px, py);
      const colours = typeof layerColours === "function" ? layerColours(Math.floor(x0 / 8), Math.floor(y0 / 8)) : layerColours;
      const mix = [0, 0, 0];
      let total = 0;
      for (let l = 0; l < 8; l++) {
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const w = masks.layers[l]![y * masks.maskWidth + x]!;
            total += w;
            for (let c = 0; c < 3; c++) mix[c]! += w * colours[l]![c]!;
          }
        }
      }
      const o = (py * img.width + px) * 3;
      for (let c = 0; c < 3; c++) img.rgb[o + c] = total > 0 ? Math.round(mix[c]! / total) : 0;
    }
  }
  return img;
}

/** How much the masks changed under each pixel: white where nothing did, to full red where all the weight moved. */
export function renderTexelChange(grid: Size, before: T3TextureMasks, after: T3TextureMasks, origin: { x: number; y: number }): RgbImage {
  const img = blank(grid);
  for (let py = 0; py < img.height; py++) {
    for (let px = 0; px < img.width; px++) {
      const [x0, y0, x1, y1] = texelsUnder(grid, origin, px, py);
      let moved = 0;
      let texels = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          texels++;
          for (let l = 0; l < 8; l++) moved += Math.abs(after.layers[l]![y * before.maskWidth + x]! - before.layers[l]![y * before.maskWidth + x]!);
        }
      }
      // Moving all 15 of a texel's weight from one layer to another changes 30.
      const k = Math.min(1, moved / (30 * texels));
      const o = (py * img.width + px) * 3;
      img.rgb[o] = 255;
      img.rgb[o + 1] = Math.round(255 - 215 * k);
      img.rgb[o + 2] = Math.round(255 - 215 * k);
    }
  }
  return img;
}

/**
 * The share of one layer's weight under each pixel, in `colour`, over `base` greyed and dimmed (or
 * over white): where a texture slot is painted, and how strongly. `inSet` keeps the share to the
 * cells of the slot's texture set.
 */
export function renderSlotShare(
  base: RgbImage | undefined,
  grid: Size,
  masks: T3TextureMasks,
  origin: { x: number; y: number },
  layer: number,
  colour: readonly number[],
  inSet: (cellX: number, cellY: number) => boolean = () => true,
): RgbImage {
  const img = blank(grid);
  for (let py = 0; py < img.height; py++) {
    for (let px = 0; px < img.width; px++) {
      const [x0, y0, x1, y1] = texelsUnder(grid, origin, px, py);
      const counted = inSet(Math.floor(x0 / 8), Math.floor(y0 / 8));
      let mine = 0;
      let total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          mine += masks.layers[layer]![y * masks.maskWidth + x]!;
          for (let l = 0; l < 8; l++) total += masks.layers[l]![y * masks.maskWidth + x]!;
        }
      }
      const share = counted && total > 0 ? mine / total : 0;
      const o = (py * img.width + px) * 3;
      const grey = base ? 40 + 0.35 * ((base.rgb[o]! + base.rgb[o + 1]! + base.rgb[o + 2]!) / 3) : 255;
      for (let c = 0; c < 3; c++) img.rgb[o + c] = Math.round(grey + share * (colour[c]! - grey));
    }
  }
  return img;
}

/** The colour of painted pathing (CellAttribute_Pnp): blocked sub-cells. */
export const PATHING_COLOUR = [220, 30, 60] as const;
/** In a pathing change: sub-cells newly blocked, and those opened. */
const BLOCKED_COLOUR = PATHING_COLOUR;
const OPENED_COLOUR = [30, 110, 230] as const;

/**
 * Calls `each` for every pixel of a cell's sub-cell: 8 a cell, 2 wide and 4 high, row 0 at the
 * bottom (the bit layout of src/terrain/write-cell-attribute.ts's pathingBit).
 */
function forSubCellPixels(img: RgbImage, grid: Size, each: (offset: number, cell: number, column: number, row: number) => void) {
  for (let py = 0; py < img.height; py++) {
    for (let px = 0; px < img.width; px++) {
      const cx = Math.floor(px / PX);
      const cy = grid.height - 1 - Math.floor(py / PX);
      const column = Math.floor(((px % PX) * 2) / PX);
      const row = Math.floor(((PX - 1 - (py % PX)) * 4) / PX);
      each((py * img.width + px) * 3, cy * grid.width + cx, column, row);
    }
  }
}

/**
 * Painted pathing over `base` (or white): each blocked sub-cell tinted {@link PATHING_COLOUR}.
 * `cells` is a byte per cell of the window, as CellAttribute_Pnp holds them.
 */
export function renderPathing(grid: Size, cells: ArrayLike<number>, base?: RgbImage): RgbImage {
  const img = base ? { ...base, rgb: Uint8Array.from(base.rgb) } : blank(grid);
  if (!base) img.rgb.fill(255);
  forSubCellPixels(img, grid, (o, cell, column, row) => {
    if (!(cells[cell]! & pathingBit(column, row))) return;
    for (let c = 0; c < 3; c++) img.rgb[o + c] = Math.round(0.3 * img.rgb[o + c]! + 0.7 * PATHING_COLOUR[c]!);
  });
  return img;
}

/** Where painted pathing changed, on white: sub-cells newly blocked in red, those opened in blue. */
export function renderPathingChange(grid: Size, before: ArrayLike<number>, after: ArrayLike<number>): RgbImage {
  const img = blank(grid);
  img.rgb.fill(255);
  forSubCellPixels(img, grid, (o, cell, column, row) => {
    const bit = pathingBit(column, row);
    const [was, is] = [before[cell]! & bit, after[cell]! & bit];
    if (was === is) return;
    const colour = is ? BLOCKED_COLOUR : OPENED_COLOUR;
    for (let c = 0; c < 3; c++) img.rgb[o + c] = colour[c]!;
  });
  return img;
}

/** Small crops scaled up, pixel for pixel, to at least {@link VIEW} px across. */
export function enlarge(image: RgbImage): RgbImage {
  const k = Math.max(1, Math.floor(VIEW / Math.max(image.width, image.height)));
  if (k === 1) return image;
  const width = image.width * k;
  const rgb = new Uint8Array(width * image.height * k * 3);
  for (let y = 0; y < image.height * k; y++) {
    for (let x = 0; x < width; x++) {
      const from = (Math.floor(y / k) * image.width + Math.floor(x / k)) * 3;
      rgb.set(image.rgb.subarray(from, from + 3), (y * width + x) * 3);
    }
  }
  return { width, height: image.height * k, rgb };
}

/** A copy of `image` with the cells `mask` marks darkened (cliff edges). */
export function darkenCells(image: RgbImage, size: { width: number; height: number }, mask: Uint8Array) {
  const rgb = Uint8Array.from(image.rgb);
  const px = image.width / size.width;
  for (let cy = 0; cy < size.height; cy++) {
    for (let cx = 0; cx < size.width; cx++) {
      if (!mask[cy * size.width + cx]) continue;
      for (let y = 0; y < px; y++) {
        for (let x = 0; x < px; x++) {
          const o = (((size.height - 1 - cy) * px + y) * image.width + cx * px + x) * 3;
          for (let c = 0; c < 3; c++) rgb[o + c] = Math.round(rgb[o + c]! * 0.45);
        }
      }
    }
  }
  return { ...image, rgb };
}
