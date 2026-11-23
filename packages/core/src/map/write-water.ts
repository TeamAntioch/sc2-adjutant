// Water and lava pools (DL-13). A pool is a rectangle in t3Water naming a CWater; the CWater's
// states hold its heights and colours. Each pool gets its own CWater, a child of the stock type
// with the stock default state copied in full, so pools keep their own heights and rise apart.
//
// t3Water, as the Editor saved one Agria pool (2026-10-27): "WATR", version 110, count, zeros to
// 32 bytes; then per area a 40-byte null-padded CWater id and four float32s x0, y0, x1, y1. Water the
// author draws names the stock type (Agria), whose height the Editor writes into WaterData.xml as
// `<State index="0" Height="15.1"/>`, and the Editor keeps every area as tiles: 01-02's test save
// (2026-11-10) split one pool's rectangle in two where new water met it, and saved the new water as three.

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MissionBlueprint, WaterPool } from "../domain/mission-blueprint.js";
import { type TerrainRasterizationResult, terrainHeightAt } from "../terrain/rasterize.js";
import { canonicalXml } from "../util/xml.js";
import { catalogEntries } from "./catalog-entries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, "../../data/water-types.json");

type StockWater = { readonly package: string; readonly parent?: string; readonly state: Readonly<Record<string, string>> };
let catalog: Record<string, StockWater> | null = null;
const loadCatalog = () => (catalog ??= JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as Record<string, StockWater>);

/** A stock water type (data/water-types.json), or undefined. */
export function getStockWater(id: string): StockWater | undefined {
  return loadCatalog()[id];
}

/** The Mission's water types, which the Editor also saves once the author draws water. */
export const WATER_DATA = "Base.SC2Data/GameData/WaterData.xml";

const NAME_BYTES = 40;
const ENTRY_BYTES = NAME_BYTES + 16;

/** The pool's own CWater id: its type plus the pool id in TitleCase ("Agria_TemplePit"). */
export function poolWaterId(pool: WaterPool): string {
  const suffix = pool.id
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  const id = `${pool.type}_${suffix}`;
  if (id.length >= NAME_BYTES) throw new Error(`Water pool ${pool.id}: CWater id ${id} is longer than ${NAME_BYTES - 1} characters`);
  return id;
}

/** A pool's state as the triggers name it: "default" is the CWater's first state. */
export function poolStateValue(pool: WaterPool, state: string): string {
  return `${poolWaterId(pool)}|${state === "default" ? "[Default]" : state}`;
}

type Rect = [number, number, number, number];

/** The pool's areas: its own `rects` (water drawn in the Editor), else one, its zone's bounding box widened by the margin, inside the map. */
export function poolRects(blueprint: MissionBlueprint, pool: WaterPool): Rect[] {
  return pool.rects ? pool.rects.map((rect) => [...rect] as Rect) : [zoneRect(blueprint, pool)];
}

/** The box round the pool's areas. */
export function poolRect(blueprint: MissionBlueprint, pool: WaterPool): Rect {
  const rects = poolRects(blueprint, pool);
  return [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])), Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))];
}

/** Whether the cell centre (x, y) is under one of the pool's areas. */
export const inPool = (rects: readonly Rect[], x: number, y: number): boolean => rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);

function zoneRect(blueprint: MissionBlueprint, pool: WaterPool): Rect {
  const zone = blueprint.zones.find((candidate) => candidate.id === pool.zoneId);
  if (!zone) throw new Error(`Water pool ${pool.id}: no zone ${pool.zoneId}`);
  const xs = zone.polygon.map((point) => point.x);
  const ys = zone.polygon.map((point) => point.y);
  const { width, height } = blueprint.mapSize;
  return [
    Math.max(0, Math.min(...xs) - pool.margin),
    Math.max(0, Math.min(...ys) - pool.margin),
    Math.min(width, Math.max(...xs) + pool.margin),
    Math.min(height, Math.max(...ys) + pool.margin),
  ];
}

/** t3Water: one area per rectangle of each pool, each naming the pool's own CWater. */
export function t3WaterBuffer(blueprint: MissionBlueprint): Buffer {
  const areas = blueprint.water.flatMap((pool) => poolRects(blueprint, pool).map((rect) => ({ water: poolWaterId(pool), rect })));
  const buffer = Buffer.alloc(32 + ENTRY_BYTES * areas.length);
  buffer.write("WATR", 0, "ascii");
  buffer.writeUInt32LE(110, 4);
  buffer.writeUInt32LE(areas.length, 8);
  areas.forEach(({ water, rect }, index) => {
    const offset = 32 + index * ENTRY_BYTES;
    buffer.write(water, offset, "ascii");
    rect.forEach((value, k) => buffer.writeFloatLE(value, offset + NAME_BYTES + k * 4));
  });
  return buffer;
}

/** One water area of t3Water: the CWater it names and its rectangle, x0, y0, x1, y1 in cells. */
export type WaterArea = { readonly water: string; readonly rect: readonly [number, number, number, number] };

/** The water areas of a t3Water, as t3WaterBuffer writes them and the Editor saves them. */
export function readT3Water(buffer: Uint8Array): WaterArea[] {
  const bytes = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (bytes.toString("ascii", 0, 4) !== "WATR") throw new Error("t3Water: missing WATR magic");
  const count = bytes.readUInt32LE(8);
  if (bytes.length < 32 + count * ENTRY_BYTES) throw new Error(`t3Water: truncated (${bytes.length} B for ${count} areas)`);
  return Array.from({ length: count }, (_, index) => {
    const offset = 32 + index * ENTRY_BYTES;
    const name = bytes.toString("latin1", offset, offset + NAME_BYTES);
    const end = name.indexOf("\0");
    const rect = [0, 1, 2, 3].map((k) => bytes.readFloatLE(offset + NAME_BYTES + k * 4)) as [number, number, number, number];
    return { water: end < 0 ? name : name.slice(0, end), rect };
  });
}

/**
 * Whether a package's t3Water shows what a compile's `next` would: the same rectangles (within
 * `tolerance` cells), each naming the same CWater or, where the Editor has the stock type, the
 * pool's own copy of it (`Agria` for `Agria_Pool`), which shows the same water once sync has
 * brought its height back.
 */
export function sameWaterAreas(now: Uint8Array, next: Uint8Array, tolerance: number): boolean {
  const [a, b] = [readT3Water(now), readT3Water(next)];
  if (a.length !== b.length) return false;
  // In any order: the Editor lists the tiles of its areas as it keeps them.
  const left = [...b];
  return a.every((area) => {
    const at = left.findIndex((other) => (area.water === other.water || other.water.startsWith(`${area.water}_`)) && area.rect.every((value, k) => Math.abs(value - other.rect[k]!) <= tolerance));
    return at >= 0 && left.splice(at, 1).length === 1;
  });
}

/**
 * Each CWater's default height in a WaterData.xml, by id: its first state's Height, as the Editor
 * writes it when the author sets a water type's height (stock types too, overriding them).
 */
export function waterHeights(waterDataXml: string): Map<string, number> {
  const heights = new Map<string, number>();
  for (const entry of catalogEntries(waterDataXml)) {
    if (entry.className !== "CWater" || entry.id === undefined) continue;
    // The first state, its fields as children (ours) or as attributes (`<State index="0" Height="15.1"/>`, the Editor's for a stock type).
    const state = /<State\b[^>]*\bindex="0"[^>]*?(?:\/>|>[\s\S]*?<\/State>)/.exec(entry.text)?.[0] ?? /<State\b[^>]*?(?:\/>|>[\s\S]*?<\/State>)/.exec(entry.text)?.[0];
    const height = state && (/<Height\s+value="([^"]+)"/.exec(state)?.[1] ?? /^<State\b[^>]*\bHeight="([^"]+)"/.exec(state)?.[1]);
    if (typeof height === "string" && Number.isFinite(Number(height))) heights.set(entry.id, Number(height));
  }
  return heights;
}

/**
 * Whether a WaterData.xml holds only the Editor's own entries for stock water types (`<CWater
 * id="Agria">`, no parent): what the Editor saves once the author has drawn water. Nothing of the
 * Mission's is in it, so a compile that writes the Mission's pools may write over it.
 */
export function onlyStockWater(waterDataXml: string): boolean {
  const entries = catalogEntries(waterDataXml);
  return entries.every((entry) => entry.className === "CWater" && entry.id !== undefined && getStockWater(entry.id) !== undefined && !/^<CWater\b[^>]*\bparent=/.test(entry.text.trimStart()));
}

/**
 * Whether a package's WaterData.xml holds nothing the compile's `next` would lose: each CWater in
 * both says the same (in the Editor's layout or ours), and the package's others are CWaters no area
 * the compile writes names, the Editor's entries for stock types (their heights synced into the
 * pools drawn with them) or a deleted area's. A CWater only `next` has is a pool sync brought back.
 */
export function sameWaterData(now: string, next: string): boolean {
  const ours = new Map(catalogEntries(next).map((entry) => [entry.key, entry.text]));
  return catalogEntries(now).every((entry) => entry.className === "CWater" && (!ours.has(entry.key) || canonicalXml(ours.get(entry.key)!) === canonicalXml(entry.text)));
}

const formatColor = (rgba: readonly number[]): string => rgba.map((c) => c.toFixed(6)).join(",");

function stateXml(index: number, fields: Readonly<Record<string, string>>): string[] {
  return [
    `        <State index="${index}">`,
    ...Object.entries(fields).map(([field, value]) => `            <${field} value="${value}"/>`),
    "        </State>",
  ];
}

/** WaterData.xml with each pool's CWater, or undefined when the mission has no pools. */
export function waterDataXml(blueprint: MissionBlueprint): string | undefined {
  if (blueprint.water.length === 0) return undefined;
  const body = blueprint.water.flatMap((pool) => {
    // An unknown type (a dependency's own) gets only the fields the pool sets.
    const stock = getStockWater(pool.type)?.state ?? {};
    const state = (name: string, height: number, color: readonly number[] | undefined) => ({
      ...stock,
      Name: name,
      Height: height.toFixed(6),
      ...(color ? { Color: formatColor(color) } : {}),
    });
    return [
      `    <CWater id="${poolWaterId(pool)}" parent="${pool.type}">`,
      ...stateXml(0, state("[Default]", pool.height, pool.color)),
      ...pool.states.flatMap((extra, index) => stateXml(index + 1, state(extra.name, extra.height, extra.color ?? pool.color))),
      "    </CWater>",
    ];
  });
  return ['<?xml version="1.0" encoding="utf-8"?>', "<Catalog>", ...body, "</Catalog>", ""].join("\r\n");
}

/** Cells under a pool's surface at its default height, which dressing leaves bare. */
export function underWater(blueprint: MissionBlueprint, terrain: TerrainRasterizationResult): Uint8Array {
  const { width, height } = blueprint.mapSize;
  const mask = new Uint8Array(width * height);
  for (const pool of blueprint.water) {
    const rects = poolRects(blueprint, pool);
    const [x0, y0, x1, y1] = poolRect(blueprint, pool);
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        if ((!pool.rects || inPool(rects, x + 0.5, y + 0.5)) && terrainHeightAt(terrain, width, x + 0.5, y + 0.5) < pool.height) mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * Notes on pools: a type that isn't stock (a dependency may have it), a height at or under the
 * zone's floor (nothing shows), and a height over the ground at the rectangle's edge (it spills
 * out as a flat sheet over that ground).
 */
export function waterWarnings(blueprint: MissionBlueprint, terrain: TerrainRasterizationResult): string[] {
  const { width } = blueprint.mapSize;
  const warnings: string[] = [];
  for (const pool of blueprint.water) {
    if (!getStockWater(pool.type)) {
      warnings.push(`Water pool ${pool.id}: ${pool.type} isn't a stock water type (data/water-types.json); check a dependency has it.`);
    }
    const [x0, y0, x1, y1] = poolRect(blueprint, pool);
    // The floor under the pool's middle: its rectangle's when it has its own, else its zone's.
    const zone = blueprint.zones.find((candidate) => candidate.id === pool.zoneId)!;
    const first = poolRects(blueprint, pool)[0]!;
    const cx = pool.rects ? (first[0] + first[2]) / 2 : zone.polygon.reduce((sum, point) => sum + point.x, 0) / zone.polygon.length;
    const cy = pool.rects ? (first[1] + first[3]) / 2 : zone.polygon.reduce((sum, point) => sum + point.y, 0) / zone.polygon.length;
    const floor = terrainHeightAt(terrain, width, cx, cy);
    let rim = Infinity;
    for (let x = x0; x < x1; x++) rim = Math.min(rim, terrainHeightAt(terrain, width, x + 0.5, y0 + 0.5), terrainHeightAt(terrain, width, x + 0.5, y1 - 0.5));
    for (let y = y0; y < y1; y++) rim = Math.min(rim, terrainHeightAt(terrain, width, x0 + 0.5, y + 0.5), terrainHeightAt(terrain, width, x1 - 0.5, y + 0.5));
    for (const [name, level] of [["default", pool.height], ...pool.states.map((state) => [state.name, state.height] as const)] as const) {
      if (level <= floor) warnings.push(`Water pool ${pool.id} (${name}): height ${level} is at or under the zone's floor (${floor.toFixed(1)}), so it doesn't show.`);
      else if (level > rim) warnings.push(`Water pool ${pool.id} (${name}): height ${level} is over the ground at its edge (${rim.toFixed(1)}), so it spills over it.`);
    }
  }
  return warnings;
}
