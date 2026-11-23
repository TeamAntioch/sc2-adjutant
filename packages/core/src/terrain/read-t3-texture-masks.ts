import { Buffer } from "node:buffer";

export type T3TextureMasks = {
  /** Mask size in texels: 8 per terrain cell. */
  readonly maskWidth: number;
  readonly maskHeight: number;
  /** [layer][texelY * maskWidth + texelX] -> 0..15, texel rows from y = 0. */
  readonly layers: readonly Uint8Array[];
};

const TEXELS_PER_TILE = 64;
const BYTES_PER_TILE = (TEXELS_PER_TILE * TEXELS_PER_TILE) / 2;

/** Reads t3TextureMasks (v102): 8 planar 4-bit layers tiled in 64x64-texel tiles, as writeT3TextureMasks writes. */
export function readT3TextureMasks(buffer: Buffer): T3TextureMasks {
  if (buffer.toString("ascii", 0, 4) !== "MASK") throw new Error("t3TextureMasks: missing MASK magic");
  const maskWidth = buffer.readUInt32LE(12);
  const maskHeight = buffer.readUInt32LE(16);
  const layerSize = (maskWidth * maskHeight) / 2;
  const tilesPerRow = Math.ceil(maskWidth / TEXELS_PER_TILE);

  const layers: Uint8Array[] = [];
  for (let layer = 0; layer < 8; layer++) {
    const out = new Uint8Array(maskWidth * maskHeight);
    const layerOffset = 64 + layer * layerSize;
    for (let y = 0; y < maskHeight; y++) {
      const tileRowOffset = Math.floor(y / TEXELS_PER_TILE) * tilesPerRow;
      const localY = y % TEXELS_PER_TILE;
      for (let x = 0; x < maskWidth; x++) {
        const tile = tileRowOffset + Math.floor(x / TEXELS_PER_TILE);
        const texelInTile = localY * TEXELS_PER_TILE + (x % TEXELS_PER_TILE);
        const byte = buffer[layerOffset + tile * BYTES_PER_TILE + (texelInTile >> 1)] ?? 0;
        // High nibble holds the even column.
        out[y * maskWidth + x] = x % 2 === 0 ? byte >> 4 : byte & 0x0f;
      }
    }
    layers.push(out);
  }
  return { maskWidth, maskHeight, layers };
}

/** Mean weight (0..15) of each layer over each terrain cell: [cellIndex * 8 + layer]. */
export function cellTextureWeights(masks: T3TextureMasks, width: number, height: number): Float32Array {
  const perCell = masks.maskWidth / width;
  const out = new Float32Array(width * height * 8);
  for (let layer = 0; layer < 8; layer++) {
    const texels = masks.layers[layer]!;
    for (let cy = 0; cy < height; cy++) {
      for (let cx = 0; cx < width; cx++) {
        let sum = 0;
        for (let ty = 0; ty < perCell; ty++) {
          const row = (cy * perCell + ty) * masks.maskWidth + cx * perCell;
          for (let tx = 0; tx < perCell; tx++) sum += texels[row + tx]!;
        }
        out[(cy * width + cx) * 8 + layer] = sum / (perCell * perCell);
      }
    }
  }
  return out;
}
