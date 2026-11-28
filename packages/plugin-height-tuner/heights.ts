// The heights the tuner writes into a normal map's red channel (docs/reference/height-blending.md).
// A layer's height is the red channel of its CTerrainTex Normalmap, 0..1, so a variant is a new red
// channel for the test texture's own normal map: its green (Y) and alpha (X) stay the normal.
//
// Every height here is a square image of values 0..1, row-major from the top left, and treated as
// tiling: blurs wrap round its edges, as the texture does on the ground.

/** A square height image, 0 the lowest, 1 the highest. */
export type Height = { readonly size: number; readonly values: Float32Array };

/** What a normal map's red channel holds, as the research measured all 699 stock textures. */
export type RedKind =
  /** A real height: the LotV layout, R uncorrelated with the normal. */
  | "height"
  /** The same value everywhere (nearly always 255): no height at all. */
  | "flat"
  /** A copy of the normal's Y (the WoL layout, R = G = B): shaped like the lighting, not a height. */
  | "normal-copy";

export type RedReading = { readonly kind: RedKind; readonly mean: number; readonly sd: number; readonly min: number; readonly max: number; readonly corrRG: number };

/** The thresholds the research's classification of every stock texture used. */
const FLAT_SD = 3;
const NORMAL_COPY_CORR = 0.85;

/** The red channel of an RGBA image, classified. */
export function readRed(rgba: Uint8Array): RedReading {
  const n = rgba.length / 4;
  let [sumR, sumG, min, max] = [0, 0, 255, 0];
  for (let i = 0; i < n; i++) {
    const r = rgba[4 * i]!;
    sumR += r;
    sumG += rgba[4 * i + 1]!;
    if (r < min) min = r;
    if (r > max) max = r;
  }
  const [meanR, meanG] = [sumR / n, sumG / n];
  let [varR, varG, cov] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const [r, g] = [rgba[4 * i]! - meanR, rgba[4 * i + 1]! - meanG];
    varR += r * r;
    varG += g * g;
    cov += r * g;
  }
  const sd = Math.sqrt(varR / n);
  const corrRG = varR > 0 && varG > 0 ? cov / Math.sqrt(varR * varG) : 0;
  const kind: RedKind = sd <= FLAT_SD ? "flat" : Math.abs(corrRG) > NORMAL_COPY_CORR ? "normal-copy" : "height";
  return { kind, mean: meanR, sd, min, max, corrRG };
}

/** The red channel of a square RGBA image as a height. */
export function redHeight(rgba: Uint8Array, size: number): Height {
  const values = new Float32Array(size * size);
  for (let i = 0; i < values.length; i++) values[i] = rgba[4 * i]! / 255;
  return { size, values };
}

/**
 * A height recovered from a tangent-space normal map's slopes (X in alpha, Y in green, as SC2's
 * DXT5 terrain normals keep them), integrated in the frequency domain (Frankot-Chellappa) with
 * periodic edges, since the texture tiles. Levelled to 0..1. For a texture whose red channel holds
 * no height. On ShakurasCity2, whose red channel is a real height, this agrees with it at 0.93,
 * without flipping Y. The size must be a power of two.
 */
export function integrateNormal(rgba: Uint8Array, size: number): Height {
  if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`integrating a normal map needs a power-of-two size, and this one is ${size}`);
  const n = size * size;
  const [pr, pi, qr, qi] = [new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  for (let i = 0; i < n; i++) {
    const nx = rgba[4 * i + 3]! / 127.5 - 1;
    const ny = rgba[4 * i + 1]! / 127.5 - 1;
    const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
    pr[i] = -nx / nz;
    qr[i] = -ny / nz;
  }
  fft2(pr, pi, size, false);
  fft2(qr, qi, size, false);
  const [hr, hi] = [new Float64Array(n), new Float64Array(n)];
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const i = v * size + u;
      if (i === 0) continue;
      const wu = (2 * Math.PI * (u <= size / 2 ? u : u - size)) / size;
      const wv = (2 * Math.PI * (v <= size / 2 ? v : v - size)) / size;
      const d = wu * wu + wv * wv;
      // H = -i (wu P + wv Q) / d
      const sr = wu * pr[i]! + wv * qr[i]!;
      const si = wu * pi[i]! + wv * qi[i]!;
      hr[i] = si / d;
      hi[i] = -sr / d;
    }
  }
  fft2(hr, hi, size, true);
  return levelled({ size, values: Float32Array.from(hr) });
}

/** In-place radix-2 FFT of a complex row (re, im). */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((2 * Math.PI) / len) * (inverse ? 1 : -1);
    const [wr, wi] = [Math.cos(angle), Math.sin(angle)];
    for (let i = 0; i < n; i += len) {
      let [cr, ci] = [1, 0];
      for (let k = 0; k < len / 2; k++) {
        const [a, b] = [i + k, i + k + len / 2];
        const ar = re[b]! * cr - im[b]! * ci;
        const ai = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - ar;
        im[b] = im[a]! - ai;
        re[a] = re[a]! + ar;
        im[a] = im[a]! + ai;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] = re[i]! / n), (im[i] = im[i]! / n);
}

function fft2(re: Float64Array, im: Float64Array, size: number, inverse: boolean): void {
  const [r, m] = [new Float64Array(size), new Float64Array(size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) (r[x] = re[y * size + x]!), (m[x] = im[y * size + x]!);
    fft(r, m, inverse);
    for (let x = 0; x < size; x++) (re[y * size + x] = r[x]!), (im[y * size + x] = m[x]!);
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) (r[y] = re[y * size + x]!), (m[y] = im[y * size + x]!);
    fft(r, m, inverse);
    for (let y = 0; y < size; y++) (re[y * size + x] = r[y]!), (im[y * size + x] = m[y]!);
  }
}

/** `height` stretched so its lowest value is 0 and its highest 1 (ImageMagick's -auto-level). */
export function levelled({ size, values }: Height): Height {
  let [low, high] = [Infinity, -Infinity];
  for (const value of values) (low = Math.min(low, value)), (high = Math.max(high, value));
  const span = high - low;
  return { size, values: values.map((value) => (span > 0 ? (value - low) / span : 0.5)) };
}

/**
 * A Gaussian blur of `sigma` texels, wrapping round the edges: three box blurs each way, which
 * approach a Gaussian closely enough for flattening broad bands.
 */
export function wrapBlur({ size, values }: Height, sigma: number): Height {
  // Three boxes of width w have a variance of 3(w² - 1)/12.
  const radius = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  let current = Float32Array.from(values);
  const next = new Float32Array(values.length);
  const width = 2 * radius + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (const across of [true, false]) {
      for (let line = 0; line < size; line++) {
        const at = (k: number): number => {
          const wrapped = ((k % size) + size) % size;
          return across ? line * size + wrapped : wrapped * size + line;
        };
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += current[at(k)]!;
        for (let k = 0; k < size; k++) {
          next[at(k)] = sum / width;
          sum += current[at(k + radius + 1)]! - current[at(k - radius)]!;
        }
      }
      current.set(next);
    }
  }
  return { size, values: current };
}

/** How wide the flattening blur is on a 1024-texel tile: the tile's broad bands are about 500 texels wide, its stones 40-160. */
export const BAND_SIGMA_AT_1024 = 120;

/**
 * `height` with the tile's broad light and dark bands taken out and its stones kept: the height
 * minus a wide wrapped blur of it, levelled to 0..1. On ShakurasCity2 this correlates 0.99 with
 * the stock height.
 */
export function flattenBands(height: Height, sigma = (BAND_SIGMA_AT_1024 * height.size) / 1024): Height {
  const blurred = wrapBlur(height, sigma);
  return levelled({ size: height.size, values: height.values.map((value, i) => value - blurred.values[i]! + 0.5) });
}

/**
 * `height` crushed: everything at or below `black` goes to 0, the rest is stretched to 0..`top`,
 * its highest texel at `top` (on a levelled height, ImageMagick's -level black,100% then × top).
 * Under a texture painted over a base texture, the zeroed part is where the base shows through.
 */
export function crush({ size, values }: Height, black: number, top: number): Height {
  let high = -Infinity;
  for (const value of values) high = Math.max(high, value);
  const span = high - black;
  return { size, values: values.map((value) => (value <= black || span <= 0 ? 0 : (top * (value - black)) / span)) };
}

/**
 * The level below which `share` (0..1) of the height's texels lie: the black point that crushes
 * that share of the tile to 0, whatever the height's spread.
 */
export function levelAtShare({ values }: Height, share: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(share * sorted.length)))]!;
}

/** `height` with `share` of its texels (the lowest) crushed to 0, the rest stretched to 0..`top`. */
export const crushShare = (height: Height, share: number, top: number): Height => crush(height, levelAtShare(height, share), top);

/** `height` upside down: its highs low and its lows high. */
export const inverted = ({ size, values }: Height): Height => ({ size, values: values.map((value) => 1 - value) });

/** `height` scaled by `top`: its highest point at `top`. */
export const scaled = ({ size, values }: Height, top: number): Height => ({ size, values: values.map((value) => value * top) });

/** The share of a height's texels at 0: how much of the tile the base texture can take. */
export function zeroShare({ values }: Height): number {
  let zero = 0;
  for (const value of values) if (value <= 1 / 510) zero++;
  return zero / values.length;
}

export const meanOf = ({ values }: Height): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Pearson's correlation of two heights of one size: how to check a derived height's sign against another source. */
export function correlation(a: Height, b: Height): number {
  const [ma, mb] = [meanOf(a), meanOf(b)];
  let [va, vb, cov] = [0, 0, 0];
  for (let i = 0; i < a.values.length; i++) {
    const [x, y] = [a.values[i]! - ma, b.values[i]! - mb];
    va += x * x;
    vb += y * y;
    cov += x * y;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/**
 * `height` at a mip level's size: each texel the mean of the block of texels it covers, as a mip
 * chain is built. The size must divide the height's.
 */
export function downsampled(height: Height, size: number): Height {
  if (size === height.size) return height;
  const step = height.size / size;
  if (!Number.isInteger(step)) throw new Error(`a ${height.size}-texel height can't be taken down to ${size} texels`);
  const values = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) sum += height.values[(y * step + dy) * height.size + x * step + dx]!;
      values[y * size + x] = sum / (step * step);
    }
  }
  return { size, values };
}
