import { Buffer } from "node:buffer";

import type { T3TextureMasks } from "./read-t3-texture-masks.js";
import { TEXELS_PER_CELL as GRID_TEXELS_PER_CELL } from "./texture-grid.js";

export type T3TextureMasksOptions = {
  readonly width: number;
  readonly height: number;
  readonly textureWeights: Uint8Array; // [cellIndex * 8 + layerIndex] -> 0..15
  /** Per texel (8×8 per cell, row-major from y = 0), [texelIndex * 8 + layerIndex] -> 0..15; overrides textureWeights. */
  readonly texelWeights?: Uint8Array;
};

/**
 * texture-grid.ts's, read once into a local: the per-texel loops below run millions of times a
 * compile, and Vitest's module transform turns each read of an imported binding into a getter call
 * (a melee compile ran half as slow again in the tests without this).
 */
const TEXELS_PER_CELL = GRID_TEXELS_PER_CELL;
const CELLS_PER_TILE = 8;
const TEXELS_PER_TILE = TEXELS_PER_CELL * CELLS_PER_TILE;
const BYTES_PER_TILE = (TEXELS_PER_TILE * TEXELS_PER_TILE) / 2;

export function writeT3TextureMasks(options: T3TextureMasksOptions): Buffer {
  const { width, height, textureWeights, texelWeights } = options;
  const maskWidth = width * TEXELS_PER_CELL;
  const maskHeight = height * TEXELS_PER_CELL;
  const layerSize = (maskWidth * maskHeight) / 2;
  const tilesPerRow = Math.ceil(width / CELLS_PER_TILE);

  const header = Buffer.alloc(64);
  header.write("MASK", 0, "ascii");
  header.writeUInt32LE(102, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(maskWidth, 12);
  header.writeUInt32LE(maskHeight, 16);

  const payload = Buffer.alloc(8 * layerSize);

  // Each planar layer is divided into 64x64-texel tiles (8x8 terrain cells).
  // Tiles are row-major across the map; texels are row-major within each tile.
  for (let layer = 0; layer < 8; layer++) {
    const layerOffset = layer * layerSize;

    for (let cellY = 0; cellY < height; cellY++) {
      for (let cellX = 0; cellX < width; cellX++) {
        const cellIndex = cellY * width + cellX;
        const cellWeight = textureWeights[cellIndex * 8 + layer] ?? 0;

        const tileX = Math.floor(cellX / CELLS_PER_TILE);
        const tileY = Math.floor(cellY / CELLS_PER_TILE);
        const tileIndex = tileY * tilesPerRow + tileX;
        const tileOffset = layerOffset + tileIndex * BYTES_PER_TILE;
        const localCellX = cellX % CELLS_PER_TILE;
        const localCellY = cellY % CELLS_PER_TILE;

        for (let texelY = 0; texelY < TEXELS_PER_CELL; texelY++) {
          const localY = localCellY * TEXELS_PER_CELL + texelY;
          for (let texelX = 0; texelX < TEXELS_PER_CELL; texelX += 2) {
            const localX = localCellX * TEXELS_PER_CELL + texelX;
            const texelInTile = localY * TEXELS_PER_TILE + localX;
            const texel = (cellY * TEXELS_PER_CELL + texelY) * maskWidth + cellX * TEXELS_PER_CELL + texelX;
            const even = texelWeights ? texelWeights[texel * 8 + layer]! : cellWeight;
            const odd = texelWeights ? texelWeights[(texel + 1) * 8 + layer]! : cellWeight;
            payload[tileOffset + texelInTile / 2] = ((even & 0x0f) << 4) | (odd & 0x0f);
          }
        }
      }
    }
  }

  return Buffer.concat([header, payload]);
}

/** The masks writeT3TextureMasks writes from `texelWeights`, as readT3TextureMasks reads them back. */
export function texelMasks(width: number, height: number, texelWeights: Uint8Array): T3TextureMasks {
  const maskWidth = width * TEXELS_PER_CELL;
  const maskHeight = height * TEXELS_PER_CELL;
  const texels = maskWidth * maskHeight;
  const layers = Array.from({ length: 8 }, () => new Uint8Array(texels));
  for (let texel = 0; texel < texels; texel++) for (let layer = 0; layer < 8; layer++) layers[layer]![texel] = texelWeights[texel * 8 + layer]! & 0x0f;
  return { maskWidth, maskHeight, layers };
}
