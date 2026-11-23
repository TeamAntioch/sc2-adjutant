import { Buffer } from "node:buffer";

export type WriteMinimapTgaOptions = {
  readonly width: number;
  readonly height: number;
  /** Dominant texture layer (0-7) per cell, row-major from y = 0. */
  readonly dominantLayers: Uint32Array;
  /** [left, bottom, right, top] in cells; outside is drawn black as the Editor does. */
  readonly playableBounds: readonly [number, number, number, number];
};

// Editor 5.0.17 draws a BelShirEx2 map's base texture as this colour; the other
// layers are shaded from it so zones stay distinguishable.
const BASE_RGB = [0x50, 0x59, 0x4b] as const;
const LAYER_SHADE = [1, 0.7, 1.2, 0.85, 1.35, 0.55, 1.1, 0.95] as const;

// "TRUEVISION-XFILE." footer with no extension or developer area (TGA 2.0), as the Editor ends the minimap and the lighting mask.
export const TGA_FOOTER = Buffer.concat([Buffer.alloc(8), Buffer.from("TRUEVISION-XFILE.\0", "ascii")]);

/**
 * Writes Minimap.tga the way the Editor saves it: uncompressed 24-bit BGR,
 * top-left origin, one pixel per cell. The game shows it as the minimap.
 */
export function writeMinimapTga(options: WriteMinimapTgaOptions): Buffer {
  const { width, height, dominantLayers, playableBounds } = options;
  const [left, bottom, right, top] = playableBounds;

  const header = Buffer.alloc(18);
  header.writeUInt8(2, 2); // uncompressed true-colour
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header.writeUInt8(24, 16);
  header.writeUInt8(0x20, 17); // top-left origin

  const pixels = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row;
    for (let x = 0; x < width; x++) {
      if (x < left || x >= right || y < bottom || y >= top) continue;
      const shade = LAYER_SHADE[dominantLayers[y * width + x]! % 8]!;
      const offset = (row * width + x) * 3;
      const [r, g, b] = BASE_RGB.map((channel) => Math.min(255, Math.round(channel * shade)));
      pixels[offset] = b!;
      pixels[offset + 1] = g!;
      pixels[offset + 2] = r!;
    }
  }

  return Buffer.concat([header, pixels, TGA_FOOTER]);
}
