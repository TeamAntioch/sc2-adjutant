import { Buffer } from "node:buffer";

export type T3HeightMapOptions = {
  readonly width: number;
  readonly height: number;
  /** Total visible height per vertex. */
  readonly heights: Float32Array;
  /** Portion of each vertex height contributed by its cliff level; defaults to 0. */
  readonly cliffHeights?: Float32Array;
  /** Cliff level per vertex; defaults to 0. */
  readonly cliffLevels?: Uint8Array;
  /** The quantization to write with, which t3Terrain.xml must give too; defaults to {@link heightQuantization}'s. */
  readonly quantization?: HeightQuantization;
};

// Matches the quantization used by Editor-saved maps: each channel decodes to
// (r * scale - bias), giving a per-channel range of [-9, 9].
export const HEIGHT_QUANTIZE_BIAS = 9.0;
export const HEIGHT_QUANTIZE_SCALE = 2.746134e-4;

/** A height map's quantization, as t3Terrain.xml's <vertData> gives it. */
export type HeightQuantization = { readonly quantizeBias: number; readonly quantizeScale: number };

const DEFAULT_QUANTIZATION: HeightQuantization = { quantizeBias: HEIGHT_QUANTIZE_BIAS, quantizeScale: HEIGHT_QUANTIZE_SCALE };

/**
 * The quantization a generated map's heights need: ours (±9 a channel) when every base and cliff
 * layer value fits it, else a wider one, as the Editor saves a map with high cliffs. The Editor's
 * top is the highest value plus 1 (bias 9, scale 5.798428e-4 for a map up to level 15's 28, as an
 * Editor-saved map that uses every level has them). Both values are rounded to the 7 significant digits
 * t3Terrain.xml holds, so the binary and the XML agree.
 */
export function heightQuantization(heights: Float32Array, cliffHeights?: Float32Array): HeightQuantization {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const cliff = cliffHeights?.[i] ?? 0;
    const base = heights[i]! - cliff;
    low = Math.min(low, base, cliff);
    high = Math.max(high, base, cliff);
  }
  if (low === Infinity || (fits(low, DEFAULT_QUANTIZATION) && fits(high, DEFAULT_QUANTIZATION))) return DEFAULT_QUANTIZATION;
  const quantizeBias = Number(Math.max(HEIGHT_QUANTIZE_BIAS, Math.ceil(-low + 1)).toExponential(6));
  const quantizeScale = Math.max(HEIGHT_QUANTIZE_SCALE, roundUp((high + 1 + quantizeBias) / 0xffff));
  return { quantizeBias, quantizeScale };
}

/** `value` to 7 significant digits, rounded up, so a top of the highest value plus 1 isn't lost to rounding. */
function roundUp(value: number): number {
  const rounded = Number(value.toExponential(6));
  if (rounded >= value) return rounded;
  return Number((rounded + 10 ** (Math.floor(Math.log10(value)) - 6)).toExponential(6));
}

function fits(value: number, { quantizeBias, quantizeScale }: HeightQuantization): boolean {
  const raw = Math.round((value + quantizeBias) / quantizeScale);
  return raw >= 0 && raw <= 0xffff;
}

function quantize(value: number, { quantizeBias, quantizeScale }: HeightQuantization): number {
  const raw = Math.round((value + quantizeBias) / quantizeScale);
  if (raw < 0 || raw > 0xffff) throw new Error(`Height ${value} is outside t3HeightMap's quantization (bias ${quantizeBias}, scale ${quantizeScale})`);
  return raw;
}

export function writeT3HeightMap(options: T3HeightMapOptions): Buffer {
  const { width, height, heights, cliffHeights, cliffLevels } = options;
  const quantization = options.quantization ?? heightQuantization(heights, cliffHeights);
  const vertexWidth = width + 1;
  const vertexHeight = height + 1;
  const vertexCount = vertexWidth * vertexHeight;

  // Header: 32 bytes
  const header = Buffer.alloc(32);
  header.write("HMAP", 0, "ascii");
  header.writeUInt32LE(101, 4); // version
  header.writeUInt32LE(vertexWidth, 8);
  header.writeUInt32LE(vertexHeight, 12);
  // bytes 16..31 are zeros (already zeroed by alloc)

  // Payload: vertexCount * 6 bytes
  const payload = Buffer.alloc(vertexCount * 6);
  for (let i = 0; i < vertexCount; i++) {
    const h = heights[i] ?? 0.0;
    const cliff = cliffHeights?.[i] ?? 0.0;
    // The Editor renders height = decode(r0) + decode(r1).
    const r0 = quantize(h - cliff, quantization); // base terrain layer
    const r1 = quantize(cliff, quantization); // cliff layer
    const r2 = cliffLevels?.[i] ?? 0; // cliff level

    payload.writeUInt16LE(r0, i * 6);
    payload.writeUInt16LE(r1, i * 6 + 2);
    payload.writeUInt16LE(r2, i * 6 + 4);
  }

  return Buffer.concat([header, payload]);
}
