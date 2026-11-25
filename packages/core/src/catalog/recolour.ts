// A recolour of a texture's texels (an Asset Mod's `recolour` step, domain/asset-source.ts):
//
//   hue        turns each texel's hue (HSL) by `hue` degrees, scaling its saturation and lightness
//              by `saturation` and `lightness` (1 keeps them): purple to red, a hue shift of about
//              +60. A grey texel has no hue, so a greyscale texture doesn't change.
//   gradient   maps each texel's brightness (Rec. 709 luma, 0 to 1) onto colours spaced evenly from
//              dark to light, blended between neighbours: how a greyscale effect texture is tinted.
//
// Alpha is kept as the texture has it (catalog/dds.ts).

import type { Recolour } from "../domain/asset-source.js";

type Rgb = [number, number, number];

/** The texel change `recolour` makes, RGB 0-255 in and out. */
export function recolourTexel(recolour: Recolour): (rgb: Rgb) => Rgb {
  if (recolour.gradient) {
    const stops = recolour.gradient.map((hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb);
    const spans = stops.length - 1;
    return ([r, g, b]) => {
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const along = Math.min(Math.max(luma, 0), 1) * spans;
      const k = Math.min(Math.floor(along), spans - 1);
      const f = along - k;
      const [from, to] = [stops[k]!, stops[k + 1]!];
      return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f];
    };
  }
  const turn = (((recolour.hue ?? 0) % 360) + 360) % 360;
  const saturation = recolour.saturation ?? 1;
  const lightness = recolour.lightness ?? 1;
  return (rgb) => {
    const [h, s, l] = toHsl(rgb);
    return fromHsl((h + turn) % 360, Math.min(s * saturation, 1), Math.min(l * lightness, 1));
  };
}

/** How much colour a texture's texels have: their mean chroma (the spread of R, G and B, 0 to 1), 0 for greyscale. */
export function meanChroma(rgba: Uint8Array): number {
  let total = 0;
  const texels = rgba.length / 4;
  for (let i = 0; i < texels; i++) {
    const r = rgba[4 * i]!;
    const g = rgba[4 * i + 1]!;
    const b = rgba[4 * i + 2]!;
    total += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  }
  return texels === 0 ? 0 : total / texels;
}

/** RGB 0-255 to hue (degrees), saturation and lightness (0-1). */
function toHsl([r, g, b]: Rgb): Rgb {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

/** Hue (degrees), saturation and lightness (0-1) to RGB 0-255. */
function fromHsl(h: number, s: number, l: number): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - chroma / 2;
  const sector = Math.floor(h / 60) % 6;
  const [r, g, bl] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][sector]!;
  return [(r! + m) * 255, (g! + m) * 255, (bl! + m) * 255];
}
