// Painted lighting regions (docs/reference/lighting-regions.md): up to three lights of their own in
// the map's Light (its `LightRegions` 1-3, regions 2-4), painted onto the ground by LightingMap.tga.
// The mask holds four weights a pixel, adding to 255: R region 1 (the Light as it is), G region 2,
// B region 3, A region 4. Every cell takes the region of its nearest walkable Zone, so rock between
// two Zones splits down the middle, and each edge is blurred into a blend.

import { Buffer } from "node:buffer";

import { blueprintCatalog } from "../catalog/catalog-layer.js";
import { getStockLight } from "../catalog/light-catalog.js";
import { missionFog } from "../catalog/tileset-sky.js";
import { missionLight } from "../catalog/tileset-lights.js";
import { hasKeptTerrain, type LightRegion, type MissionBlueprint } from "../domain/mission-blueprint.js";
import { blueprintPlugins } from "../plugins/plugin-api.js";
import { containsPoint, distanceToPolygon } from "../terrain/polygon.js";
import { TGA_FOOTER } from "./write-minimap-tga.js";
import { applyLightKnobs, formatColor, missionLightFields, parseColor } from "./write-lights.js";

/** The mask's file in the package: the game and the Editor find it by this name. */
export const LIGHTING_MAP = "LightingMap.tga";

/** Mask pixels per cell along each side, as the Editor paints it (1024 for a 256 map). */
const PIXELS_PER_CELL = 4;
/** Cells an edge blends over when `blend` is left out: a Gaussian of 3 cells' sigma, as 01-02's prototype. */
const DEFAULT_BLEND = 8;
const SIGMA_PER_BLEND_CELL = 3 / 8;

const REGION_KEYS = ["2", "3", "4"] as const;


/** A TGA's bytes ending in the TGA 2.0 footer the Editor saves, added when they lack it. */
export function withTgaFooter(tga: Buffer): Buffer {
  return tga.length >= TGA_FOOTER.length && tga.subarray(tga.length - TGA_FOOTER.length).equals(TGA_FOOTER) ? tga : Buffer.concat([tga, TGA_FOOTER]);
}

/** The regions the Blueprint declares, by number (2-4). */
function declaredRegions(blueprint: MissionBlueprint): Map<number, LightRegion> {
  const regions = blueprint.lightRegions?.regions ?? {};
  return new Map(REGION_KEYS.flatMap((key) => (regions[key] ? [[Number(key), regions[key]] as const] : [])));
}

/** A Zone's share of each region, 1-4 as indices 0-3: its `lightRegion`, undeclared regions read as region 1. */
function zoneWeights(lightRegion: number | readonly number[] | undefined, declared: ReadonlyMap<number, LightRegion>): [number, number, number, number] {
  const regions = lightRegion === undefined ? [1] : typeof lightRegion === "number" ? [lightRegion] : lightRegion;
  const weights: [number, number, number, number] = [0, 0, 0, 0];
  for (const region of regions) {
    const index = region === 1 || declared.has(region) ? region - 1 : 0;
    weights[index] = weights[index]! + 1 / regions.length;
  }
  return weights;
}

/** Whether the Blueprint paints any lighting region: it declares one, a walkable Zone names it, and its terrain is generated (not yet beside Kept terrain). */
export function paintsLightRegions(blueprint: MissionBlueprint): boolean {
  const declared = declaredRegions(blueprint);
  return declared.size > 0 && !hasKeptTerrain(blueprint) && blueprint.zones.some((zone) => !zone.backdrop && zoneWeights(zone.lightRegion, declared)[0] < 1);
}

/**
 * The region weights of every cell (4 a cell, row-major from y = 0, adding to 1): its nearest
 * walkable Zone's, inside one at distance 0, a later Zone winning a tie as it wins the ground.
 */
export function cellRegionWeights(blueprint: MissionBlueprint): Float32Array {
  const { width, height } = blueprint.mapSize;
  const declared = declaredRegions(blueprint);
  const zones = blueprint.zones
    .filter((zone) => !zone.backdrop)
    .map((zone) => {
      const xs = zone.polygon.map((point) => point.x);
      const ys = zone.polygon.map((point) => point.y);
      return { polygon: zone.polygon, weights: zoneWeights(zone.lightRegion, declared), box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const };
    });
  const weights = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const point = { x: x + 0.5, y: y + 0.5 };
      let best = Infinity;
      let nearest: (typeof zones)[number] | undefined;
      for (const zone of zones) {
        const [left, bottom, right, top] = zone.box;
        // Outside the box a Zone is at least this far: skip it when another is already nearer.
        const boxDistance = Math.hypot(Math.max(left - point.x, 0, point.x - right), Math.max(bottom - point.y, 0, point.y - top));
        if (boxDistance > best) continue;
        const distance = boxDistance === 0 && containsPoint(zone.polygon, point) ? 0 : distanceToPolygon(zone.polygon, point);
        if (distance <= best) {
          best = distance;
          nearest = zone;
        }
      }
      weights.set(nearest?.weights ?? [1, 0, 0, 0], (y * width + x) * 4);
    }
  }
  return weights;
}

/** Three box widths whose passes in turn blur as a Gaussian of `sigma` (Kovesi's approximation, as image libraries blur). */
function boxesForGauss(sigma: number): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let lower = Math.floor(ideal);
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const lowerCount = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  return [0, 1, 2].map((pass) => (pass < lowerCount ? lower : upper));
}

/** One box pass along `lines` lines of `length` pixels, a line `lineStride` apart and its pixels `stride` apart, edges clamped. */
function boxPass(source: Float32Array, target: Float32Array, lines: number, length: number, lineStride: number, stride: number, radius: number): void {
  const scale = 1 / (2 * radius + 1);
  for (let line = 0; line < lines; line++) {
    const base = line * lineStride;
    const at = (index: number): number => source[base + Math.min(length - 1, Math.max(0, index)) * stride]!;
    let sum = 0;
    for (let index = -radius; index <= radius; index++) sum += at(index);
    for (let index = 0; index < length; index++) {
      target[base + index * stride] = sum * scale;
      sum += at(index + radius + 1) - at(index - radius);
    }
  }
}

/** `image` (width × height, row-major) blurred in place as a Gaussian of `sigma` pixels. */
function gaussianBlur(image: Float32Array, width: number, height: number, sigma: number): void {
  if (sigma <= 0) return;
  const scratch = new Float32Array(image.length);
  for (const box of boxesForGauss(sigma)) {
    const radius = (box - 1) / 2;
    boxPass(image, scratch, height, width, width, 1, radius);
    boxPass(scratch, image, width, height, 1, width, radius);
  }
}

/**
 * LightingMap.tga for the Blueprint's regions, as the Editor saves it: uncompressed 32-bit BGRA,
 * 8 alpha bits and a top-left origin (descriptor 0x28), rows north first, 4 pixels a cell, with a
 * TGA 2.0 footer. Undefined when no walkable Zone is painted with a declared region.
 */
export function lightingMapTga(blueprint: MissionBlueprint): Buffer | undefined {
  if (!paintsLightRegions(blueprint)) return undefined;
  const { width, height } = blueprint.mapSize;
  const cells = cellRegionWeights(blueprint);
  const [pxWidth, pxHeight] = [width * PIXELS_PER_CELL, height * PIXELS_PER_CELL];
  const sigma = (blueprint.lightRegions?.blend ?? DEFAULT_BLEND) * SIGMA_PER_BLEND_CELL * PIXELS_PER_CELL;
  // Regions 2-4 blurred, those declared; region 1 is the rest, as the weights add to one before and after.
  const declared = declaredRegions(blueprint);
  const channels = [2, 3, 4].map((region) => {
    if (!declared.has(region)) return undefined;
    const image = new Float32Array(pxWidth * pxHeight);
    for (let py = 0; py < pxHeight; py++) {
      const cy = Math.floor(py / PIXELS_PER_CELL);
      for (let px = 0; px < pxWidth; px++) image[py * pxWidth + px] = cells[(cy * width + Math.floor(px / PIXELS_PER_CELL)) * 4 + region - 1]!;
    }
    gaussianBlur(image, pxWidth, pxHeight, sigma);
    return image;
  });

  const header = Buffer.alloc(18);
  header.writeUInt8(2, 2); // uncompressed true-colour
  header.writeUInt16LE(pxWidth, 12);
  header.writeUInt16LE(pxHeight, 14);
  header.writeUInt8(32, 16);
  header.writeUInt8(0x28, 17); // 8 alpha bits, top-left origin
  const pixels = Buffer.alloc(pxWidth * pxHeight * 4);
  for (let row = 0; row < pxHeight; row++) {
    const py = pxHeight - 1 - row;
    for (let px = 0; px < pxWidth; px++) {
      const at = py * pxWidth + px;
      const [g, b, a] = channels.map((image) => (image ? Math.max(0, Math.floor(image[at]! * 255 + 1e-4)) : 0));
      const offset = (row * pxWidth + px) * 4;
      pixels[offset] = b!;
      pixels[offset + 1] = g!;
      pixels[offset + 2] = Math.max(0, 255 - g! - b! - a!);
      pixels[offset + 3] = a!;
    }
  }
  return Buffer.concat([header, pixels, TGA_FOOTER]);
}

/** A Light's resolved fields: one of the Blueprint's `lights`, a Plugin's, or a stock one; undefined when it's none (a Campaign Mod's). */
function lightFields(blueprint: MissionBlueprint, id: string): Readonly<Record<string, string>> | undefined {
  const own = blueprint.lights.find((light) => light.id === id);
  if (own) return missionLightFields(own);
  const contributed = blueprintPlugins(blueprint).light(id);
  if (contributed) return missionLightFields(contributed.light);
  return getStockLight(id)?.fields;
}

const TOD = "ToDInfoArray/0/";
const luminance = ([r, g, b]: readonly number[]): number => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;

/** The mission's fog colour, 0-1 (missionFog's, a tileset's "A,R,G,B" or "R,G,B" 0-255), if it has one. */
function missionFogColor(blueprint: MissionBlueprint): number[] | undefined {
  const parts = missionFog(blueprintCatalog(blueprint), blueprint).color?.split(",").map(Number);
  return parts && parts.length >= 3 ? parts.slice(-3).map((channel) => channel / 255) : undefined;
}

/**
 * One region's `LightRegions` fields, relative paths under its index: the ambient and directional
 * colours of its `from` (else `base`) with its knobs turned; specular from the key's; environment
 * (the base Light's own multiplier, 1 when it has none) and fog (the mission's) dimmed as the
 * ambient is against the base's.
 */
export function regionFields(region: LightRegion, from: Readonly<Record<string, string>>, base: Readonly<Record<string, string>>, fog: readonly number[] | undefined): Record<string, string> {
  const fields = applyLightKnobs(from, { ambient: region.ambient, key: region.key, fill: region.fill, back: region.back });
  const ambient = parseColor(fields[`${TOD}AmbientColor`]);
  const baseAmbient = luminance(parseColor(base[`${TOD}AmbientColor`]));
  const dim = baseAmbient > 0 ? Math.round(Math.min(1, luminance(ambient) / baseAmbient) * 1000) / 1000 : 1;
  const light = (part: "Key" | "Fill" | "Back") => `${TOD}DirectionalLight/${part}/`;
  const multiplier = (part: "Key" | "Fill" | "Back"): number => Number(fields[`${light(part)}ColorMultiplier`] ?? 1);
  const keyColor = region.key?.color ? [...region.key.color] : parseColor(fields[`${light("Key")}SpecularColor`] ?? fields[`${light("Key")}Color`]);
  const specularMultiplier = multiplier("Key") * Number(fields[`${light("Key")}SpecColorMultiplier`] ?? 1) * (region.specular?.scale ?? 1);
  const fogColor = region.fog ? [...region.fog] : fog?.map((channel) => channel * dim);
  return {
    UseDefault: "0",
    AmbientColor: formatColor(ambient),
    AmbientEnvironmentMultiplier: (region.environment ?? Number(base[`${TOD}AmbientEnvironmentMultiplier`] ?? 1) * dim).toFixed(6),
    SpecularColor: formatColor(region.specular?.color ?? keyColor),
    SpecularMultiplier: specularMultiplier.toFixed(6),
    ...(fogColor ? { FogColor: formatColor(fogColor) } : {}),
    ...Object.fromEntries((["Key", "Fill", "Back"] as const).map((part) => [`DiffuseColor/${part}`, formatColor(parseColor(fields[`${light(part)}Color`]))])),
    ...Object.fromEntries((["Key", "Fill", "Back"] as const).map((part) => [`DiffuseMultiplier/${part}`, multiplier(part).toFixed(6)])),
  };
}

/** The Light that holds the regions (the map's: `lighting`, else the tileset's) and its regions' fields, flattened as a Light's are; undefined when none is painted. */
export function lightRegionOverride(blueprint: MissionBlueprint): { readonly light: string; readonly fields: Record<string, string> } | undefined {
  if (!paintsLightRegions(blueprint)) return undefined;
  const light = missionLight(blueprintCatalog(blueprint), blueprint);
  const base = lightFields(blueprint, light) ?? {};
  const fog = missionFogColor(blueprint);
  const fields: Record<string, string> = {};
  for (const [number, region] of declaredRegions(blueprint)) {
    const from = region.from === undefined ? base : lightFields(blueprint, region.from);
    // A `from` that can't be read is warned of (lightRegionWarnings): the region is the base Light's until it's fixed.
    for (const [key, value] of Object.entries(regionFields(region, from ?? base, base, fog))) fields[`${TOD}LightRegions/${number - 1}/${key}`] = value;
  }
  return { light, fields };
}

/** Advice on the Blueprint's lighting regions: what names a region it doesn't declare, a region no Zone paints, and Lights that would hide them. */
export function lightRegionWarnings(blueprint: MissionBlueprint): string[] {
  const declared = declaredRegions(blueprint);
  const named = blueprint.zones.filter((zone) => zone.lightRegion !== undefined);
  if (declared.size === 0 && named.length === 0) return [];
  const warnings: string[] = [];
  if (hasKeptTerrain(blueprint)) {
    warnings.push("lightRegions aren't painted beside Kept terrain yet: the package's own LightingMap.tga and LightData are left as they are.");
    return warnings;
  }
  const painted = new Set<number>();
  for (const zone of named) {
    const regions = typeof zone.lightRegion === "number" ? [zone.lightRegion] : zone.lightRegion!;
    if (zone.backdrop) {
      warnings.push(`Zone ${zone.id} is a backdrop: its lightRegion isn't painted, and it takes its nearest walkable Zone's.`);
      continue;
    }
    for (const region of regions) {
      if (region !== 1 && !declared.has(region)) warnings.push(`Zone ${zone.id} names lighting region ${region}, which lightRegions.regions doesn't declare: it's painted as region 1.`);
      else painted.add(region);
    }
  }
  for (const number of declared.keys()) {
    if (!painted.has(number)) warnings.push(`Lighting region ${number} is declared, but no walkable Zone names it in its lightRegion.`);
  }
  if (!paintsLightRegions(blueprint)) return warnings;
  const light = missionLight(blueprintCatalog(blueprint), blueprint);
  if (!lightFields(blueprint, light)) {
    warnings.push(`The map's Light ${light} isn't one of lights, a Plugin's or stock: its regions are written over it, but those without their own from start from no colours.`);
  }
  for (const [number, region] of declared) {
    if (region.from !== undefined && !lightFields(blueprint, region.from)) {
      warnings.push(`Lighting region ${number} copies ${region.from}, which is none of lights, a Plugin's Lights or data/light-catalog.json: it's written as ${light} until that's fixed.`);
    }
  }
  const switched = new Set(blueprint.transitions.flatMap((transition) => (transition.light ? [transition.light.to, ...(transition.light.back?.to ? [transition.light.back.to] : [])] : [])));
  switched.delete(light);
  for (const id of switched) warnings.push(`A transition switches to Light ${id}, which holds no lighting regions: they're ${light}'s, and don't show while ${id} is on.`);
  return warnings;
}
