// Minimal .dds files for the recolour tests: a 128-byte header and the data given, with the
// levels (and faces) the data is laid out as.

export type DdsFixture = {
  readonly width: number;
  readonly height: number;
  readonly levels?: number;
  /** DXT1/DXT3/DXT5 or another four-character code, or an uncompressed layout. */
  readonly format: string | { readonly bits: 24 | 32; readonly masks: readonly [number, number, number, number] };
  /** Cube map faces' caps2 bits; none for a flat texture. */
  readonly cube?: boolean;
  readonly volume?: boolean;
};

export function dds({ width, height, levels = 1, format, cube = false, volume = false }: DdsFixture, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);
  header.set(new TextEncoder().encode("DDS "), 0);
  view.setUint32(4, 124, true);
  view.setUint32(8, 0x1007 | (levels > 1 ? 0x20000 : 0), true);
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  view.setUint32(28, levels, true);
  view.setUint32(76, 32, true);
  if (typeof format === "string") {
    view.setUint32(80, 0x4, true);
    header.set(new TextEncoder().encode(format), 84);
  } else {
    view.setUint32(80, 0x40 | (format.masks[3] ? 0x1 : 0), true);
    view.setUint32(88, format.bits, true);
    format.masks.forEach((mask, i) => view.setUint32(92 + 4 * i, mask, true));
  }
  view.setUint32(108, 0x1000 | (levels > 1 ? 0x400008 : 0), true);
  view.setUint32(112, (cube ? 0x200 | 0xfc00 : 0) | (volume ? 0x200000 : 0), true);
  const out = new Uint8Array(128 + data.length);
  out.set(header);
  out.set(data, 128);
  return out;
}

/** BGRA's masks, as most uncompressed SC2 textures are kept. */
export const BGRA = { bits: 32, masks: [0xff0000, 0xff00, 0xff, 0xff000000] } as const;

/** `width`×`height` BGRA texels from an RGBA function. */
export function bgra(width: number, height: number, texel: (x: number, y: number) => readonly [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = texel(x, y);
      out.set([b, g, r, a], 4 * (y * width + x));
    }
  return out;
}

/** A 5:6:5 colour. */
export const rgb565 = (r: number, g: number, b: number): number => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);

/** A DXT1 colour block: its endpoints and each texel's 2-bit index. */
export function colourBlock(c0: number, c1: number, indices: readonly number[]): Uint8Array {
  let bits = 0;
  indices.forEach((index, t) => (bits |= index << (2 * t)));
  return new Uint8Array([c0 & 0xff, c0 >> 8, c1 & 0xff, c1 >> 8, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff]);
}
