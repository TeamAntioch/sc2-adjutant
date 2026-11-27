// The recolour step's .dds codec (catalog/dds.ts) and colour change (catalog/recolour.ts): a
// texture comes back in its own format, every level and face changed, its alpha as it was.
import { describe, expect, it } from "vitest";

import { ddsLayout, decodeDds, recolourDds, recolourDdsAt } from "../../src/catalog/dds.js";
import { meanChroma, recolourTexel } from "../../src/catalog/recolour.js";
import { BGRA, bgra, colourBlock, dds, rgb565 } from "../fixtures/dds.js";

const same = (rgb: [number, number, number]): [number, number, number] => rgb;
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) (out.set(part, at), (at += part.length));
  return out;
};
const texel = (image: { width: number; rgba: Uint8Array }, x: number, y: number) => [...image.rgba.subarray(4 * (y * image.width + x), 4 * (y * image.width + x) + 4)];

describe("an uncompressed texture", () => {
  // 4×4 with its 2×2 and 1×1 levels: purple texels, their alpha falling across the row.
  const levels = [4, 2, 1].map((size) => bgra(size, size, (x) => [128, 0, 255, 255 - 60 * x]));
  const purple = dds({ width: 4, height: 4, levels: 3, format: BGRA }, concat(...levels));

  it("reads each level as RGBA", () => {
    const images = decodeDds(purple);
    expect(images.map(({ width, height }) => [width, height])).toEqual([[4, 4], [2, 2], [1, 1]]);
    expect(texel(images[0]!, 3, 0)).toEqual([128, 0, 255, 75]);
  });

  it("turns each level's hue, keeping alpha and the header byte for byte", () => {
    const red = recolourDds(purple, recolourTexel({ hue: 90 }));
    expect(red.subarray(0, 128)).toEqual(purple.subarray(0, 128));
    for (const image of decodeDds(red)) {
      const [r, g, b] = texel(image, 0, 0);
      expect(r).toBeGreaterThan(200);
      expect(Math.max(g!, b!)).toBeLessThan(20);
    }
    expect(texel(decodeDds(red)[0]!, 3, 0)[3]).toBe(75);
  });

  it("shifts pure red by 120 degrees to pure green", () => {
    const red = dds({ width: 1, height: 1, format: BGRA }, bgra(1, 1, () => [255, 0, 0, 255]));
    expect(texel(decodeDds(recolourDds(red, recolourTexel({ hue: 120 })))[0]!, 0, 0)).toEqual([0, 255, 0, 255]);
  });

  it("maps greyscale onto a gradient from dark to light", () => {
    const grey = dds({ width: 3, height: 1, format: BGRA }, bgra(3, 1, (x) => [127.5 * x, 127.5 * x, 127.5 * x, 255].map(Math.round) as [number, number, number, number]));
    const tinted = decodeDds(recolourDds(grey, recolourTexel({ gradient: ["#200000", "#ff3010", "#fff0c0"] })))[0]!;
    expect(texel(tinted, 0, 0)).toEqual([0x20, 0, 0, 255]);
    // Grey 128 is a shade past the middle stop.
    texel(tinted, 1, 0).forEach((value, i) => expect(Math.abs(value - [255, 48, 16, 255][i]!)).toBeLessThanOrEqual(2));
    expect(texel(tinted, 2, 0)).toEqual([255, 240, 192, 255]);
  });

  it("reads 24-bit RGB with no alpha as opaque", () => {
    const rgb = dds({ width: 1, height: 1, format: { bits: 24, masks: [0xff0000, 0xff00, 0xff, 0] } }, new Uint8Array([30, 20, 10]));
    expect(texel(decodeDds(rgb)[0]!, 0, 0)).toEqual([10, 20, 30, 255]);
  });
});

describe("a DXT texture", () => {
  const purple565 = rgb565(128, 0, 255);
  const dark565 = rgb565(32, 0, 64);

  it("keeps a DXT5 block's alpha half byte for byte, and encodes its colour again", () => {
    const alpha = new Uint8Array([255, 0, 0x49, 0x92, 0x24, 0x49, 0x92, 0x24]);
    const block = concat(alpha, colourBlock(purple565, dark565, [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]));
    const texture = dds({ width: 4, height: 4, format: "DXT5" }, block);

    const red = recolourDds(texture, recolourTexel({ hue: 90 }));

    expect(red.subarray(128, 136)).toEqual(alpha);
    expect(decodeDds(red)[0]!.rgba.filter((_, i) => i % 4 === 3)).toEqual(decodeDds(texture)[0]!.rgba.filter((_, i) => i % 4 === 3));
    const [r, g, b] = texel(decodeDds(red)[0]!, 0, 0);
    expect(r).toBeGreaterThan(200);
    expect(Math.max(g!, b!)).toBeLessThan(24);
  });

  it("comes back close to as it was from a recolour that changes nothing, and the same each time", () => {
    const blocks = concat(...Array.from({ length: 4 }, (_, k) => colourBlock(rgb565(200, 40 * k, 90), rgb565(20, 10 * k, 160), Array.from({ length: 16 }, (_, t) => (t + k) % 4))));
    const texture = dds({ width: 8, height: 8, format: "DXT1" }, blocks);

    const again = recolourDds(texture, same);

    expect(recolourDds(texture, same)).toEqual(again);
    const [before, after] = [decodeDds(texture)[0]!.rgba, decodeDds(again)[0]!.rgba];
    const worst = Math.max(...before.map((value, i) => Math.abs(value - after[i]!)));
    expect(worst).toBeLessThanOrEqual(8);
  });

  it("keeps a DXT1 block's transparent texels transparent", () => {
    // c0 <= c1: three colours and transparent black, the texels with index 3.
    const block = colourBlock(dark565, purple565, [0, 1, 2, 3, 3, 3, 0, 1, 2, 3, 0, 1, 2, 3, 3, 0]);
    const texture = dds({ width: 4, height: 4, format: "DXT1" }, block);

    const red = decodeDds(recolourDds(texture, recolourTexel({ hue: 90 })))[0]!;

    expect(red.rgba.filter((_, i) => i % 4 === 3)).toEqual(decodeDds(texture)[0]!.rgba.filter((_, i) => i % 4 === 3));
  });

  it("keeps a block's hues apart when they don't differ in R+G+B, as red beside green", () => {
    const red = rgb565(255, 0, 0);
    const green = rgb565(0, 255, 0);
    const texture = dds({ width: 4, height: 4, format: "DXT1" }, colourBlock(red, green, Array.from({ length: 16 }, (_, t) => t % 2)));

    const again = decodeDds(recolourDds(texture, same))[0]!;

    expect(texel(again, 0, 0).slice(0, 3)).toEqual([255, 0, 0]);
    expect(texel(again, 1, 0).slice(0, 3)).toEqual([0, 255, 0]);
  });

  it("recolours every face of a cube map", () => {
    const face = colourBlock(purple565, purple565, new Array(16).fill(0));
    const cube = dds({ width: 4, height: 4, format: "DXT1", cube: true }, concat(...new Array(6).fill(face)));
    expect(ddsLayout(cube).faces).toBe(6);
    for (const image of decodeDds(recolourDds(cube, recolourTexel({ hue: 90 })))) expect(texel(image, 0, 0)[0]).toBeGreaterThan(200);
  });
});

describe("recolourDdsAt", () => {
  it("gives each texel its place in its own level, so a height can be written into red at every mip", () => {
    // 8×8 DXT5 with its 4×4, 2×2 and 1×1 levels: a mid-grey green, alpha a ramp.
    const alpha = new Uint8Array([255, 0, 0x49, 0x92, 0x24, 0x49, 0x92, 0x24]);
    const block = concat(alpha, colourBlock(rgb565(0, 128, 0), rgb565(0, 120, 0), Array.from({ length: 16 }, () => 0)));
    const texture = dds({ width: 8, height: 8, levels: 4, format: "DXT5" }, concat(...Array.from({ length: 4 + 1 + 1 + 1 }, () => block)));
    const seen: string[] = [];
    const out = recolourDdsAt(texture, ([, g, b], x, y, width, height) => {
      if (x === width - 1 && y === height - 1) seen.push(`${width}x${height}`);
      return [x < width / 2 ? 0 : 255, g, b];
    });
    expect([...new Set(seen)]).toEqual(["8x8", "4x4", "2x2", "1x1"]);
    const [top, half] = decodeDds(out);
    expect([texel(top!, 0, 3)[0], texel(top!, 7, 3)[0]]).toEqual([0, 255]);
    expect([texel(half!, 1, 0)[0], texel(half!, 2, 0)[0]]).toEqual([0, 255]);
    // Green stays close, and every block's alpha half is the same bytes.
    expect(Math.abs(texel(top!, 0, 0)[1]! - texel(decodeDds(texture)[0]!, 0, 0)[1]!)).toBeLessThanOrEqual(4);
    for (let block = 0; block < 7; block++) expect(out.subarray(128 + 16 * block, 136 + 16 * block)).toEqual(alpha);
  });
});

describe("a texture recolour doesn't read", () => {
  it("is refused by its format", () => {
    expect(() => ddsLayout(dds({ width: 4, height: 4, format: "ATI2" }, new Uint8Array(16)))).toThrow(/it's ATI2 compressed, and recolour reads DXT1, DXT3, DXT5 and uncompressed RGB\(A\)/);
    expect(() => ddsLayout(dds({ width: 4, height: 4, format: "DX10" }, new Uint8Array(16)))).toThrow(/DX10/);
    expect(() => ddsLayout(dds({ width: 4, height: 4, format: "DXT1", volume: true }, new Uint8Array(8)))).toThrow(/volume texture/);
    expect(() => ddsLayout(new Uint8Array(200))).toThrow(/not a \.dds/);
  });

  it("is refused when its header is nonsense: a cube map with no faces, or more levels than its size has", () => {
    const noFaces = dds({ width: 4, height: 4, format: "DXT1", cube: true }, new Uint8Array(8));
    new DataView(noFaces.buffer).setUint32(112, 0x200, true);
    expect(() => ddsLayout(noFaces)).toThrow(/cube map with no faces/);
    expect(() => ddsLayout(dds({ width: 4, height: 4, levels: 0xffffffff, format: "DXT1" }, new Uint8Array(8)))).toThrow(/claims 4294967295 mip levels, and a 4x4 texture has at most 3/);
  });

  it("is refused when its levels run past its end", () => {
    expect(() => ddsLayout(dds({ width: 8, height: 8, levels: 4, format: "DXT1" }, new Uint8Array(32)))).toThrow(/cut short/);
  });
});

describe("meanChroma", () => {
  it("is 0 for grey and 1 for a fully saturated colour", () => {
    expect(meanChroma(new Uint8Array([90, 90, 90, 255]))).toBe(0);
    expect(meanChroma(new Uint8Array([255, 0, 0, 255]))).toBe(1);
  });
});
