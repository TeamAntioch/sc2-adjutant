// The candidate heights a test map compares, one strip each. A variant is written as a word:
//
//   <kind>[:<% at 0>][*<HeightMapScale>][+<HeightMapOffset>]
//
// stock                     the texture as the game has it (always the first strip)
// stock*2                   its own height at HeightMapScale 2
// crush:25                  the stones kept, the lowest 25% of the tile at 0: the base texture grows in the gaps
// inverted-crush:25         the same upside down: the highest 25% (the stone tops) at 0, so the base texture sits on
//                           them and the stone reads as sunken
//
// A crush's number is the share of the tile that goes to 0, where the base shows through, found
// for each texture from its own height (a quantile), so it means the same on any texture. On
// ShakurasCity2, crush:25 is the research's level 28% (scrush, the author's pick) and crush:43 its
// level 34% (scrush2).
// flat                      only the tile's broad bands taken out
// relevel                   the stock height stretched to 0..1
//
// Each variant but a stock one with no scale or offset is a CTerrainTex copy of its own.

import { crushShare, type Height, inverted, levelled, scaled } from "./heights.ts";

export const VARIANT_KINDS = ["stock", "crush", "inverted-crush", "flat", "relevel"] as const;
export type VariantKind = (typeof VARIANT_KINDS)[number];

export type Variant = {
  readonly kind: VariantKind;
  /** crush and inverted-crush: the share of the tile, 0..1, that goes to 0. */
  readonly share?: number;
  readonly scale?: number;
  readonly offset?: number;
};

/** The variants a test map shows unless told otherwise: the author's pick for ShakurasCity2 (a quarter of the tile crushed) between a lighter and a heavier one, and the inverted crush at the same three. */
export const DEFAULT_VARIANTS = "stock,crush:15,crush:25,crush:40,inverted-crush:15,inverted-crush:25,inverted-crush:40";

/** A test map's set holds 8 textures: the base, then a strip each. */
export const MAX_VARIANTS = 7;

const WORD = /^(stock|crush|inverted-crush|flat|relevel)(?::(\d+(?:\.\d+)?))?(?:\*(\d+(?:\.\d+)?))?(?:\+(-?\d+(?:\.\d+)?))?$/;

/** The variants of a comma-separated list, stock first whether it's named or not. Throws on a word it can't read. */
export function parseVariants(list: string): Variant[] {
  const variants = list
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean)
    .map(parseVariant);
  if (!variants.some((variant) => variant.kind === "stock" && variant.scale === undefined && variant.offset === undefined)) variants.unshift({ kind: "stock" });
  else variants.sort((a, b) => Number(isPlainStock(b)) - Number(isPlainStock(a)));
  const names = variants.map(variantName);
  const twice = names.find((name, i) => names.indexOf(name) !== i);
  if (twice) throw new Error(`The variant ${twice} is listed twice`);
  if (variants.length > MAX_VARIANTS) throw new Error(`A test map holds ${MAX_VARIANTS} strips (its texture set's 8 textures, less the base), and this list makes ${variants.length}, stock included: split it over two runs`);
  return variants;
}

function parseVariant(word: string): Variant {
  const match = WORD.exec(word);
  if (!match) throw new Error(`${JSON.stringify(word)} isn't a variant: write <kind>[:<% at 0>][*<scale>][+<offset>], with a kind of ${VARIANT_KINDS.join(", ")}`);
  const [, kind, share, scale, offset] = match as unknown as [string, VariantKind, string?, string?, string?];
  const crushing = kind === "crush" || kind === "inverted-crush";
  if (crushing && share === undefined) throw new Error(`${word}: a ${kind} needs the % of the tile that goes to 0 (as crush:25)`);
  if (!crushing && share !== undefined) throw new Error(`${word}: only crush and inverted-crush take a %`);
  if (share !== undefined && !(Number(share) > 0 && Number(share) < 100)) throw new Error(`${word}: the share at 0 is a % between 0 and 100`);
  return {
    kind,
    ...(share !== undefined ? { share: Number(share) / 100 } : {}),
    ...(scale !== undefined ? { scale: Number(scale) } : {}),
    ...(offset !== undefined ? { offset: Number(offset) } : {}),
  };
}

const isPlainStock = (variant: Variant): boolean => variant.kind === "stock" && variant.scale === undefined && variant.offset === undefined;

/** Whether a variant needs a normal map of its own: every kind but stock. */
export const needsNormalMap = (variant: Variant): boolean => variant.kind !== "stock";

/** The variant as its word: `crush:28*2`. */
export function variantName(variant: Variant): string {
  const share = variant.share !== undefined ? `:${round(variant.share * 100)}` : "";
  const scale = variant.scale !== undefined ? `*${variant.scale}` : "";
  const offset = variant.offset !== undefined ? `+${variant.offset}` : "";
  return `${variant.kind}${share}${scale}${offset}`;
}

/** The variant for a person: `crush 28%, scale 2`. */
export function variantLabel(variant: Variant): string {
  const parts = [`${variant.kind.replace("-", " ")}${variant.share !== undefined ? ` ${round(variant.share * 100)}%` : ""}`];
  if (variant.scale !== undefined) parts.push(`scale ${variant.scale}`);
  if (variant.offset !== undefined) parts.push(`offset ${variant.offset}`);
  return parts.join(", ");
}

/** The variant in a CTerrainTex id or file name: `Crush28S2`. */
export function variantSuffix(variant: Variant): string {
  const kind = variant.kind.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
  const share = variant.share !== undefined ? String(round(variant.share * 100)).replace(".", "p") : "";
  const scale = variant.scale !== undefined ? `S${String(variant.scale).replace(".", "p")}` : "";
  const offset = variant.offset !== undefined ? `O${String(variant.offset).replace(".", "p").replace("-", "m")}` : "";
  return `${kind}${share}${scale}${offset}`;
}

/** What a variant does, in a line, for the report and the Shot's label. */
export function variantRecipe(variant: Variant): string {
  switch (variant.kind) {
    case "stock":
      return "the texture's own height";
    case "crush":
      return `the stones kept; the lowest ${round(variant.share! * 100)}% of the tile at 0, where the base texture grows in the gaps`;
    case "inverted-crush":
      return `the height upside down; the highest ${round(variant.share! * 100)}% of the tile (the stone tops) at 0, so the base sits on them and the stone reads as sunken`;
    case "flat":
      return "the tile's broad light and dark bands taken out, the stones kept";
    case "relevel":
      return "the height stretched to the full 0..1";
  }
}

/**
 * The red channel a variant gives the texture, from its source height (0..1: the stock red
 * channel, or a height integrated from the normal), that height with its broad bands flattened
 * (flattenBands, made once for every variant), and `top`, the level the highest stones keep.
 * Undefined for stock, which keeps the texture's own normal map.
 */
export function variantHeight(variant: Variant, source: Height, flattened: Height, top: number): Height | undefined {
  switch (variant.kind) {
    case "stock":
      return undefined;
    case "relevel":
      return levelled(source);
    case "flat":
      return scaled(flattened, top);
    case "crush":
      return crushShare(flattened, variant.share!, top);
    case "inverted-crush":
      return crushShare(inverted(flattened), variant.share!, top);
  }
}

const round = (value: number): number => Math.round(value * 100) / 100;
