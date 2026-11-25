// .dds textures read to RGBA and written back in their own format, for an Asset Mod's `recolour`
// step (ADR-0027). It reads the formats SC2's colour textures are kept in: DXT1, DXT3, DXT5, and
// uncompressed 32- or 24-bit RGB(A) of any byte-aligned channel masks, with every mip level and,
// for a cube map, every face. Anything else (a DX10 header, BC4/BC5 normal maps, a volume texture)
// is refused by name.
//
// A recolour changes colour and keeps alpha, so a texture is written back with its alpha exactly
// as it was: a DXT3 or DXT5 block's alpha half is copied, and a DXT1 block keeps which texels are
// transparent. Only the colour half of a block is encoded again (encodeColourBlock), with plain
// arithmetic and no randomness, so the same input always gives the same bytes. The header, and
// anything after the last level, are copied as they are.

/** One image of a texture: a face's mip level, as RGBA bytes, 4 a texel, rows top first. */
export type DdsImage = { readonly width: number; readonly height: number; readonly rgba: Uint8Array };

/** A texture's layout: its format, size, levels and faces, and where its data starts. */
export type DdsLayout = {
  readonly format: "DXT1" | "DXT3" | "DXT5" | "RGB";
  readonly width: number;
  readonly height: number;
  readonly levels: number;
  readonly faces: number;
  /** Where the first image's data starts: after the 128-byte header. */
  readonly dataOffset: number;
  /** Uncompressed only: bytes a texel, and each channel's mask (0 when the channel isn't there). */
  readonly rgb?: { readonly bytes: 3 | 4; readonly masks: readonly [number, number, number, number] };
};

const HEADER = 128;
const DDPF_ALPHAPIXELS = 0x1;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDSD_MIPMAPCOUNT = 0x20000;
const DDSCAPS2_CUBEMAP = 0x200;
const DDSCAPS2_VOLUME = 0x200000;
/** Each face a cube map's caps2 can have. */
const CUBE_FACES = [0x400, 0x800, 0x1000, 0x2000, 0x4000, 0x8000];

/** The layout of the .dds `data`. Throws on a file this module doesn't read, naming why. */
export function ddsLayout(data: Uint8Array): DdsLayout {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < HEADER || String.fromCharCode(...data.subarray(0, 4)) !== "DDS " || view.getUint32(4, true) !== 124) throw new Error("not a .dds texture");
  const flags = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const levels = flags & DDSD_MIPMAPCOUNT ? Math.max(1, view.getUint32(28, true)) : 1;
  const pfFlags = view.getUint32(80, true);
  const fourCC = String.fromCharCode(...data.subarray(84, 88));
  const caps2 = view.getUint32(112, true);
  if (caps2 & DDSCAPS2_VOLUME) throw new Error("it's a volume texture, which recolour doesn't read");
  const faces = caps2 & DDSCAPS2_CUBEMAP ? CUBE_FACES.filter((face) => caps2 & face).length : 1;
  if (faces === 0) throw new Error("it's a cube map with no faces");
  if (width === 0 || height === 0) throw new Error("it has no texels");
  const most = Math.floor(Math.log2(Math.max(width, height))) + 1;
  if (levels > most) throw new Error(`it claims ${levels} mip levels, and a ${width}x${height} texture has at most ${most}`);
  let layout: DdsLayout;
  if (pfFlags & DDPF_FOURCC) {
    if (fourCC !== "DXT1" && fourCC !== "DXT3" && fourCC !== "DXT5") throw new Error(`it's ${fourCC.replace(/\0/g, "") || "an unnamed"} compressed, and recolour reads DXT1, DXT3, DXT5 and uncompressed RGB(A)`);
    layout = { format: fourCC, width, height, levels, faces, dataOffset: HEADER };
  } else if (pfFlags & DDPF_RGB) {
    const bits = view.getUint32(88, true);
    if (bits !== 32 && bits !== 24) throw new Error(`it's ${bits}-bit uncompressed, and recolour reads 24- and 32-bit RGB(A)`);
    const masks = [view.getUint32(92, true), view.getUint32(96, true), view.getUint32(100, true), pfFlags & DDPF_ALPHAPIXELS ? view.getUint32(104, true) : 0] as const;
    for (const mask of masks) if (mask !== 0 && byteOfMask(mask) === undefined) throw new Error(`its channel mask 0x${mask.toString(16)} isn't one byte, which recolour reads`);
    layout = { format: "RGB", width, height, levels, faces, dataOffset: HEADER, rgb: { bytes: bits === 32 ? 4 : 3, masks } };
  } else {
    throw new Error("it isn't RGB or block-compressed (a luminance or alpha-only texture), which recolour doesn't read");
  }
  const end = images(layout).at(-1)!;
  if (end.offset + end.size > data.length) throw new Error(`it's cut short: its ${layout.levels} level(s) need ${end.offset + end.size} bytes, and it has ${data.length}`);
  return layout;
}

/** The byte an 8-bit channel mask selects (0 the lowest), if it is one whole byte. */
function byteOfMask(mask: number): number | undefined {
  for (let k = 0; k < 4; k++) if (mask >>> 0 === (0xff << (8 * k)) >>> 0) return k;
  return undefined;
}

/** Where each image (each face's levels, a face at a time) is, its size in bytes and texels. */
function images(layout: DdsLayout): { readonly offset: number; readonly size: number; readonly width: number; readonly height: number }[] {
  const out: { offset: number; size: number; width: number; height: number }[] = [];
  let offset = layout.dataOffset;
  for (let face = 0; face < layout.faces; face++) {
    for (let level = 0; level < layout.levels; level++) {
      const width = Math.max(1, layout.width >> level);
      const height = Math.max(1, layout.height >> level);
      const blocks = Math.ceil(width / 4) * Math.ceil(height / 4);
      const size = layout.format === "RGB" ? width * height * layout.rgb!.bytes : blocks * (layout.format === "DXT1" ? 8 : 16);
      out.push({ offset, size, width, height });
      offset += size;
    }
  }
  return out;
}

/** Each image of the texture `data`, decoded to RGBA, a face's levels at a time. */
export function decodeDds(data: Uint8Array): DdsImage[] {
  const layout = ddsLayout(data);
  return images(layout).map(({ offset, size, width, height }) => ({ width, height, rgba: decodeImage(layout, data.subarray(offset, offset + size), width, height) }));
}

/**
 * The texture `data` with each texel's colour changed by `recolour` (its RGB, 0-255 each, in and
 * out), in its own format, its alpha kept as it was.
 */
export function recolourDds(data: Uint8Array, recolour: (rgb: [number, number, number]) => [number, number, number]): Uint8Array {
  const layout = ddsLayout(data);
  const out = new Uint8Array(data);
  const rgb: [number, number, number] = [0, 0, 0];
  const change = (pixels: Uint8Array, at: number): void => {
    rgb[0] = pixels[at]!;
    rgb[1] = pixels[at + 1]!;
    rgb[2] = pixels[at + 2]!;
    const [r, g, b] = recolour(rgb);
    pixels[at] = clampByte(r);
    pixels[at + 1] = clampByte(g);
    pixels[at + 2] = clampByte(b);
  };
  for (const { offset, size, width, height } of images(layout)) {
    const image = out.subarray(offset, offset + size);
    if (layout.format === "RGB") {
      const { bytes, masks } = layout.rgb!;
      const at = masks.map((mask) => (mask === 0 ? -1 : byteOfMask(mask)!));
      const texel = new Uint8Array(4);
      for (let i = 0; i < width * height; i++) {
        const base = i * bytes;
        for (let c = 0; c < 3; c++) texel[c] = at[c]! < 0 ? 0 : image[base + at[c]!]!;
        change(texel, 0);
        for (let c = 0; c < 3; c++) if (at[c]! >= 0) image[base + at[c]!] = texel[c]!;
      }
      continue;
    }
    const colourAt = layout.format === "DXT1" ? 0 : 8;
    const blockSize = layout.format === "DXT1" ? 8 : 16;
    const texels = new Uint8Array(64);
    for (let block = 0; block < size / blockSize; block++) {
      const colour = image.subarray(block * blockSize + colourAt, block * blockSize + colourAt + 8);
      const transparent = decodeColourBlock(colour, texels, layout.format === "DXT1");
      for (let t = 0; t < 16; t++) if (!(transparent & (1 << t))) change(texels, 4 * t);
      encodeColourBlock(texels, transparent, colour);
    }
  }
  return out;
}

const clampByte = (value: number): number => (value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value));

function decodeImage(layout: DdsLayout, image: Uint8Array, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  if (layout.format === "RGB") {
    const { bytes, masks } = layout.rgb!;
    const at = masks.map((mask) => (mask === 0 ? -1 : byteOfMask(mask)!));
    for (let i = 0; i < width * height; i++) {
      for (let c = 0; c < 4; c++) rgba[4 * i + c] = at[c]! < 0 ? (c === 3 ? 255 : 0) : image[i * bytes + at[c]!]!;
    }
    return rgba;
  }
  const blockSize = layout.format === "DXT1" ? 8 : 16;
  const across = Math.ceil(width / 4);
  const texels = new Uint8Array(64);
  for (let block = 0; block < image.length / blockSize; block++) {
    const bytes = image.subarray(block * blockSize, (block + 1) * blockSize);
    const colour = layout.format === "DXT1" ? bytes : bytes.subarray(8);
    const transparent = decodeColourBlock(colour, texels, layout.format === "DXT1");
    for (let t = 0; t < 16; t++) texels[4 * t + 3] = transparent & (1 << t) ? 0 : 255;
    if (layout.format === "DXT3") for (let t = 0; t < 16; t++) texels[4 * t + 3] = ((bytes[t >> 1]! >> (4 * (t & 1))) & 0xf) * 17;
    if (layout.format === "DXT5") decodeAlphaBlock(bytes, texels);
    const bx = (block % across) * 4;
    const by = Math.floor(block / across) * 4;
    for (let t = 0; t < 16; t++) {
      const x = bx + (t & 3);
      const y = by + (t >> 2);
      if (x < width && y < height) rgba.set(texels.subarray(4 * t, 4 * t + 4), 4 * (y * width + x));
    }
  }
  return rgba;
}

/** A 5:6:5 colour's RGB, each widened to 8 bits as the hardware does. */
function expand565(value: number, out: number[], at: number): void {
  const r = (value >> 11) & 31;
  const g = (value >> 5) & 63;
  const b = value & 31;
  out[at] = (r << 3) | (r >> 2);
  out[at + 1] = (g << 2) | (g >> 4);
  out[at + 2] = (b << 3) | (b >> 2);
}

/** The four colours of a block whose endpoints are `c0`, `c1`: three and transparent black when c0 <= c1 in DXT1. */
function palette(c0: number, c1: number, threeColour: boolean): number[] {
  const p = new Array<number>(12).fill(0);
  expand565(c0, p, 0);
  expand565(c1, p, 3);
  for (let c = 0; c < 3; c++) {
    if (threeColour) {
      p[6 + c] = (p[c]! + p[3 + c]!) >> 1;
      p[9 + c] = 0;
    } else {
      p[6 + c] = Math.floor((2 * p[c]! + p[3 + c]!) / 3);
      p[9 + c] = Math.floor((p[c]! + 2 * p[3 + c]!) / 3);
    }
  }
  return p;
}

/**
 * A block's colour half (8 bytes) into `texels` (RGBA, 16 texels; alpha left alone), and which
 * texels are transparent (a bit each), which only a DXT1 block in its three-colour mode has.
 */
function decodeColourBlock(colour: Uint8Array, texels: Uint8Array, dxt1: boolean): number {
  const c0 = colour[0]! | (colour[1]! << 8);
  const c1 = colour[2]! | (colour[3]! << 8);
  const threeColour = dxt1 && c0 <= c1;
  const p = palette(c0, c1, threeColour);
  let transparent = 0;
  const bits = colour[4]! | (colour[5]! << 8) | (colour[6]! << 16) | (colour[7]! << 24);
  for (let t = 0; t < 16; t++) {
    const index = (bits >>> (2 * t)) & 3;
    texels[4 * t] = p[3 * index]!;
    texels[4 * t + 1] = p[3 * index + 1]!;
    texels[4 * t + 2] = p[3 * index + 2]!;
    if (threeColour && index === 3) transparent |= 1 << t;
  }
  return transparent;
}

/** A DXT5 block's alpha (its first 8 bytes) into `texels`' alpha. */
function decodeAlphaBlock(bytes: Uint8Array, texels: Uint8Array): void {
  const a0 = bytes[0]!;
  const a1 = bytes[1]!;
  const values = [a0, a1];
  if (a0 > a1) for (let k = 1; k <= 6; k++) values.push(Math.floor(((7 - k) * a0 + k * a1) / 7));
  else {
    for (let k = 1; k <= 4; k++) values.push(Math.floor(((5 - k) * a0 + k * a1) / 5));
    values.push(0, 255);
  }
  for (let t = 0; t < 16; t++) {
    const bit = 16 + 3 * t;
    const byte = bit >> 3;
    const word = bytes[byte]! | ((bytes[byte + 1] ?? 0) << 8);
    texels[4 * t + 3] = values[(word >> (bit & 7)) & 7]!;
  }
}

/** An RGB colour to 5:6:5, rounded. */
const to565 = (r: number, g: number, b: number): number => (Math.round((clampByte(r) * 31) / 255) << 11) | (Math.round((clampByte(g) * 63) / 255) << 5) | Math.round((clampByte(b) * 31) / 255);

/**
 * Encodes 16 texels' colour (RGBA, alpha ignored) into a block's colour half, `out`. The texels
 * marked in `transparent` (DXT1's three-colour mode) stay transparent: the block is then written in
 * that mode. The endpoints are the ends of the texels along their principal axis, found by power
 * iteration from a fixed start, each tried rounded either way to the nearer palette.
 */
export function encodeColourBlock(texels: Uint8Array, transparent: number, out: Uint8Array): void {
  const opaque: number[] = [];
  for (let t = 0; t < 16; t++) if (!(transparent & (1 << t))) opaque.push(t);
  const threeColour = transparent !== 0;
  let c0: number;
  let c1: number;
  if (opaque.length === 0) {
    c0 = 0;
    c1 = 0;
  } else {
    const mean = [0, 0, 0];
    for (const t of opaque) for (let c = 0; c < 3; c++) mean[c]! += texels[4 * t + c]!;
    for (let c = 0; c < 3; c++) mean[c]! /= opaque.length;
    const cov = [0, 0, 0, 0, 0, 0];
    for (const t of opaque) {
      const r = texels[4 * t]! - mean[0]!;
      const g = texels[4 * t + 1]! - mean[1]!;
      const b = texels[4 * t + 2]! - mean[2]!;
      cov[0]! += r * r;
      cov[1]! += r * g;
      cov[2]! += r * b;
      cov[3]! += g * g;
      cov[4]! += g * b;
      cov[5]! += b * b;
    }
    const times = (v: number[]): number[] => [cov[0]! * v[0]! + cov[1]! * v[1]! + cov[2]! * v[2]!, cov[1]! * v[0]! + cov[3]! * v[1]! + cov[4]! * v[2]!, cov[2]! * v[0]! + cov[4]! * v[1]! + cov[5]! * v[2]!];
    const size = (v: number[]): number => Math.max(Math.abs(v[0]!), Math.abs(v[1]!), Math.abs(v[2]!));
    // The first start the covariance doesn't send to zero: from [1, 1, 1] alone, texels that
    // differ in hue but not in R+G+B (red beside green) would all project to one point.
    let axis = [[1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1]].find((start) => size(times(start)) > 0) ?? [1, 1, 1];
    for (let k = 0; k < 8; k++) {
      const next = times(axis);
      const length = size(next);
      if (length === 0) break;
      axis = next.map((value) => value / length);
    }
    let low = Infinity;
    let high = -Infinity;
    let lowT = opaque[0]!;
    let highT = opaque[0]!;
    for (const t of opaque) {
      const along = (texels[4 * t]! - mean[0]!) * axis[0]! + (texels[4 * t + 1]! - mean[1]!) * axis[1]! + (texels[4 * t + 2]! - mean[2]!) * axis[2]!;
      if (along < low) [low, lowT] = [along, t];
      if (along > high) [high, highT] = [along, t];
    }
    c0 = to565(texels[4 * highT]!, texels[4 * highT + 1]!, texels[4 * highT + 2]!);
    c1 = to565(texels[4 * lowT]!, texels[4 * lowT + 1]!, texels[4 * lowT + 2]!);
  }
  // The mode is the endpoints' order: c0 > c1 for four colours, c0 <= c1 for three and transparent.
  if (threeColour ? c0 > c1 : c0 < c1) [c0, c1] = [c1, c0];
  if (!threeColour && c0 === c1) {
    // One colour: four-colour mode needs c0 > c1, so one endpoint moves a step, and every texel takes c0.
    if (c1 > 0) c1 -= 1;
    else c0 += 1;
  }
  const p = palette(c0, c1, threeColour);
  let bits = 0;
  for (let t = 0; t < 16; t++) {
    let index = 3;
    if (!(transparent & (1 << t))) {
      let best = Infinity;
      for (let k = 0; k < (threeColour ? 3 : 4); k++) {
        const dr = texels[4 * t]! - p[3 * k]!;
        const dg = texels[4 * t + 1]! - p[3 * k + 1]!;
        const db = texels[4 * t + 2]! - p[3 * k + 2]!;
        const distance = dr * dr + dg * dg + db * db;
        if (distance < best) [best, index] = [distance, k];
      }
    }
    bits |= index << (2 * t);
  }
  out[0] = c0 & 0xff;
  out[1] = c0 >> 8;
  out[2] = c1 & 0xff;
  out[3] = c1 >> 8;
  out[4] = bits & 0xff;
  out[5] = (bits >>> 8) & 0xff;
  out[6] = (bits >>> 16) & 0xff;
  out[7] = (bits >>> 24) & 0xff;
}
