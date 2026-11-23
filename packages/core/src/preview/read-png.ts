import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";

export type RgbaImage = { readonly width: number; readonly height: number; readonly rgba: Uint8Array };

/**
 * Decodes an 8-bit, non-interlaced truecolour PNG (RGB or RGBA) to RGBA, as WhiteoutFlakes writes
 * them. Other formats throw.
 */
export function readPng(png: Uint8Array): RgbaImage {
  const data = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  for (let offset = 8; offset < data.length; ) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = body.subarray(8);
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) {
        throw new Error(`unsupported PNG (depth ${depth}, colour type ${colour}, interlace ${interlace})`);
      }
      channels = colour === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[out + x - channels]! : 0;
      const up = y > 0 ? pixels[out - stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? pixels[out - stride + x - channels]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[out + x] = (line[x]! + predictor) & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba.set(pixels.subarray(i * 3, i * 3 + 3), i * 4);
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}
