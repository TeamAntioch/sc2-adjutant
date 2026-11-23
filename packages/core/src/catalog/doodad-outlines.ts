// Doodad ground outlines: where a model stands solid at a unit's height, seen from above, so the
// compile can paint no-pathing under a doodad units would walk through, most having no footprint of
// their own (docs/reference/doodad-pathing.md). Each is worked out once per model variation
// from its .m3 (`npm run doodad-outlines`) and kept in data/doodad-outlines.json:
//
// - The model's opaque triangles (m3-mesh.ts) are cut by level planes at SLICES heights above its
//   origin, the ground it stands on. Below the first a floor inlay or a low rubble heap stays
//   walkable; above the last an arch's span or an overhang does.
// - Each cut's segments are drawn on a grid of STEP cells, closed by a pixel, and filled where the
//   grid's border can't reach (a wall's inside), then opened again by a pixel, so an open-backed
//   wall stays a thin band and a closed pillar fills. The slices are unioned.
// - The grid is kept as bits, row by row from the bottom, in base64.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { M3Mesh } from "./m3-mesh.js";

/** Cells a pixel of an outline. */
export const OUTLINE_STEP = 0.125;
/** Heights above the model's origin where it's cut: a unit's body, ankle to head. */
export const OUTLINE_SLICES = [0.25, 0.5, 0.75, 1] as const;
/** Pixels of empty border round the cut, so the fill reaches all the way round. */
const PAD = 2;

/** One variation's outline: `width` × `height` pixels of OUTLINE_STEP cells from (x, y) in the model's frame, 1 where it's solid. */
export type DoodadOutline = { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly bits: Uint8Array };
/** A doodad's outlines, by variation; null for a variation with nothing solid at a unit's height (a flat inlay, a light). */
export type DoodadOutlines = { readonly model: string; readonly variations: readonly (DoodadOutline | null)[] };

type Segment = readonly [number, number, number, number];

/** The segments where the mesh's triangles cross the level plane `h`. */
function cut(mesh: M3Mesh, h: number): Segment[] {
  const { positions: p, triangles: t } = mesh;
  const out: Segment[] = [];
  // A vertex exactly on the plane would count twice or not at all.
  const at = h + 1e-4;
  for (let i = 0; i + 2 < t.length; i += 3) {
    const v = [t[i]!, t[i + 1]!, t[i + 2]!];
    const points: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const a = v[k]! * 3;
      const b = v[(k + 1) % 3]! * 3;
      const za = p[a + 2]! - at;
      const zb = p[b + 2]! - at;
      if (za < 0 === zb < 0) continue;
      const s = za / (za - zb);
      points.push([p[a]! + (p[b]! - p[a]!) * s, p[a + 1]! + (p[b + 1]! - p[a + 1]!) * s]);
    }
    if (points.length === 2) out.push([points[0]![0], points[0]![1], points[1]![0], points[1]![1]]);
  }
  return out;
}

/** Each pixel within one pixel (8 ways) of a set one. */
function dilate(grid: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(grid.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) out[(y + dy) * w + x + dx] = 1;
    }
  }
  return out;
}

/** Each pixel whose 8 neighbours are all set, as itself. */
function erode(grid: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(grid.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!grid[(y + dy) * w + x + dx]) all = 0;
      out[y * w + x] = all;
    }
  }
  return out;
}

/** The pixels the border can't reach (4 ways) without crossing a set one, and the set ones. */
function fill(grid: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(grid.length);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (outside[i] || grid[i]) continue;
    outside[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  return Uint8Array.from(outside, (value) => 1 - value);
}

/** Where a model stands solid at a unit's height (see the top of this file); null for nowhere. */
export function groundOutline(mesh: M3Mesh): DoodadOutline | null {
  const slices = OUTLINE_SLICES.map((h) => cut(mesh, h));
  const all = slices.flat();
  if (all.length === 0) return null;
  // A loop, not Math.min(...): a big model's cuts have more ends than a call takes arguments.
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x0, y0, x1, y1] of all) [minX, minY, maxX, maxY] = [Math.min(minX, x0, x1), Math.min(minY, y0, y1), Math.max(maxX, x0, x1), Math.max(maxY, y0, y1)];
  const ox = Math.floor(minX / OUTLINE_STEP - PAD) * OUTLINE_STEP;
  const oy = Math.floor(minY / OUTLINE_STEP - PAD) * OUTLINE_STEP;
  const w = Math.ceil((maxX - ox) / OUTLINE_STEP) + PAD + 1;
  const h = Math.ceil((maxY - oy) / OUTLINE_STEP) + PAD + 1;
  const union = new Uint8Array(w * h);
  for (const segments of slices) {
    const lines = new Uint8Array(w * h);
    for (const [x0, y0, x1, y1] of segments) {
      const steps = Math.max(1, Math.ceil((Math.hypot(x1 - x0, y1 - y0) / OUTLINE_STEP) * 3));
      for (let k = 0; k <= steps; k++) {
        const px = Math.floor((x0 + ((x1 - x0) * k) / steps - ox) / OUTLINE_STEP);
        const py = Math.floor((y0 + ((y1 - y0) * k) / steps - oy) / OUTLINE_STEP);
        lines[py * w + px] = 1;
      }
    }
    const solid = erode(fill(dilate(lines, w, h), w, h), w, h);
    for (let i = 0; i < union.length; i++) union[i] ||= solid[i]!;
  }
  // Trimmed to what's set.
  let [left, bottom, right, top] = [w, h, -1, -1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!union[y * w + x]) continue;
      [left, bottom, right, top] = [Math.min(left, x), Math.min(bottom, y), Math.max(right, x), Math.max(top, y)];
    }
  }
  if (right < 0) return null;
  const width = right - left + 1;
  const height = top - bottom + 1;
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) bits[y * width + x] = union[(y + bottom) * w + x + left]!;
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return { x: round(ox + left * OUTLINE_STEP), y: round(oy + bottom * OUTLINE_STEP), width, height, bits };
}

/** Whether the outline is solid at (x, y) in the model's frame. */
export function outlineCovers(outline: DoodadOutline, x: number, y: number): boolean {
  const px = Math.floor((x - outline.x) / OUTLINE_STEP);
  const py = Math.floor((y - outline.y) / OUTLINE_STEP);
  return px >= 0 && py >= 0 && px < outline.width && py < outline.height && outline.bits[py * outline.width + px] === 1;
}

/** An outline as the data file keeps it: its bits packed 8 a byte, low bit first, in base64. */
export type StoredOutline = { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly bits: string };
export type StoredDoodadOutlines = { readonly model: string; readonly variations: readonly (StoredOutline | null)[] };

export function storeOutline(outline: DoodadOutline): StoredOutline {
  const packed = new Uint8Array(Math.ceil(outline.bits.length / 8));
  outline.bits.forEach((bit, i) => {
    if (bit) packed[i >> 3]! |= 1 << (i & 7);
  });
  return { x: outline.x, y: outline.y, width: outline.width, height: outline.height, bits: Buffer.from(packed).toString("base64") };
}

export function loadOutline(stored: StoredOutline): DoodadOutline {
  const packed = Buffer.from(stored.bits, "base64");
  const bits = Uint8Array.from({ length: stored.width * stored.height }, (_, i) => ((packed[i >> 3] ?? 0) >> (i & 7)) & 1);
  return { x: stored.x, y: stored.y, width: stored.width, height: stored.height, bits };
}

/** The data file: how the outlines were made, then each doodad's, by id. */
export type DoodadOutlinesFile = { readonly about: string; readonly step: number; readonly slices: readonly number[]; readonly doodads: Readonly<Record<string, StoredDoodadOutlines>> };

/** Where core keeps the outlines `doodad-outlines` records. */
export const DOODAD_OUTLINES_PATH = fileURLToPath(new URL("../../data/doodad-outlines.json", import.meta.url));

export const OUTLINES_ABOUT =
  "Where each doodad's model stands solid at a unit's height, seen from above, by variation: written by `npm run doodad-outlines` (src/catalog/doodad-outlines.ts). The compile paints no-pathing under a solid set-piece doodad from these (src/terrain/doodad-pathing.ts).";

let bundled: Map<string, DoodadOutlines> | undefined;

/** Core's outlines, data/doodad-outlines.json, read once, by doodad id. */
export function bundledDoodadOutlines(): ReadonlyMap<string, DoodadOutlines> {
  if (!bundled) {
    const file = JSON.parse(readFileSync(DOODAD_OUTLINES_PATH, "utf8")) as DoodadOutlinesFile;
    // Outlines made at another step or other cuts would be read at the wrong scale: they're recorded again.
    if (file.step !== OUTLINE_STEP || JSON.stringify(file.slices) !== JSON.stringify(OUTLINE_SLICES)) {
      throw new Error(`${DOODAD_OUTLINES_PATH} was made at step ${file.step}, slices ${JSON.stringify(file.slices)}, not ${OUTLINE_STEP} and ${JSON.stringify(OUTLINE_SLICES)}: record its doodads again with npm run doodad-outlines`);
    }
    bundled = new Map(Object.entries(file.doodads).map(([id, entry]) => [id, { model: entry.model, variations: entry.variations.map((stored) => (stored ? loadOutline(stored) : null)) }]));
  }
  return bundled;
}

/** The data file's text: one doodad a line, sorted by id, so a diff shows which changed. */
export function formatDoodadOutlines(doodads: Readonly<Record<string, StoredDoodadOutlines>>): string {
  const ids = Object.keys(doodads).sort();
  const lines = ids.map((id, index) => `    ${JSON.stringify(id)}: ${JSON.stringify(doodads[id])}${index < ids.length - 1 ? "," : ""}`);
  const body = lines.length ? `{\n${lines.join("\n")}\n  }` : "{}";
  return `{\n  "about": ${JSON.stringify(OUTLINES_ABOUT)},\n  "step": ${OUTLINE_STEP},\n  "slices": ${JSON.stringify(OUTLINE_SLICES)},\n  "doodads": ${body}\n}\n`;
}
