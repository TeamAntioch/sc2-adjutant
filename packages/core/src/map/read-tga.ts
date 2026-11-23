import { Buffer } from "node:buffer";

export type RgbImage = {
  readonly width: number;
  readonly height: number;
  /** RGB bytes, rows top to bottom. */
  readonly rgb: Uint8Array;
};

/** Reads an uncompressed 24- or 32-bit TGA (type 2), such as the Editor's Minimap.tga. */
export function readTga(buffer: Buffer): RgbImage {
  const idLength = buffer[0]!;
  const imageType = buffer[2]!;
  if (imageType !== 2) throw new Error(`TGA: unsupported image type ${imageType}`);
  const width = buffer.readUInt16LE(12);
  const height = buffer.readUInt16LE(14);
  const bytesPerPixel = buffer[16]! / 8;
  const topOrigin = (buffer[17]! & 0x20) !== 0;
  const start = 18 + idLength;
  const rgb = new Uint8Array(width * height * 3);
  for (let row = 0; row < height; row++) {
    const srcRow = topOrigin ? row : height - 1 - row;
    for (let x = 0; x < width; x++) {
      const src = start + (srcRow * width + x) * bytesPerPixel;
      const dst = (row * width + x) * 3;
      rgb[dst] = buffer[src + 2]!;
      rgb[dst + 1] = buffer[src + 1]!;
      rgb[dst + 2] = buffer[src]!;
    }
  }
  return { width, height, rgb };
}
