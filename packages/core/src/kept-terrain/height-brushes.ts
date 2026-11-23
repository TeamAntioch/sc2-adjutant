// Height brushes on Kept ground (spec #247): raise, lower, flatten and smooth. Each works on the
// base layer of the height map (src/kept-terrain/kept-ground.ts), scaled at each vertex by the
// area's weight there, so it fades out over the falloff and cliffs keep their height.

import { z } from "zod";

import { type AreaMask, PointTargetSchema } from "./area.js";
import { vertexHeightAt } from "../study/terrain-grid.js";
import type { KeptGround } from "./kept-ground.js";


export const HeightBrushSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("raise"), by: z.number().positive().max(16).describe("Height units (a cliff level is 2)") }).strict(),
  z.object({ op: z.literal("lower"), by: z.number().positive().max(16).describe("Height units (a cliff level is 2)") }).strict(),
  z
    .object({
      op: z.literal("flatten"),
      to: z
        .union([z.literal("mean"), z.number().finite(), z.object({ at: PointTargetSchema }).strict()])
        .optional()
        .describe('"mean" (the default): the area\'s mean height; a height; or { at }: the height at a point (its Editor Id, Kept Reference id or name, or { x, y })'),
    })
    .strict(),
  z.object({ op: z.literal("smooth"), passes: z.number().int().min(1).max(10).optional().describe("How many times to average each vertex with its neighbours; 2 by default") }).strict(),
]);
export type HeightBrush = z.input<typeof HeightBrushSchema>;
export type ParsedHeightBrush = z.output<typeof HeightBrushSchema>;

/** Finds a point named by a flatten's `to: { at }`. */
export type PointFinder = (target: number | string | { x: number; y: number }) => { readonly x: number; readonly y: number; readonly name: string };

export type BrushResult = {
  /** The base layer after the brush. */
  readonly base: Float64Array;
  /** What the brush did, in words: "Raised … by 1.5", "Flattened … to 8.12 (their mean)". */
  readonly done: string;
  /** The same as a request: "Would raise … by 1.5". */
  readonly would: string;
};

/** Applies `brush` over `mask` to the ground's base layer. */
export function applyHeightBrush(ground: KeptGround, mask: AreaMask, brush: ParsedHeightBrush, findPoint: PointFinder): BrushResult {
  const base = Float64Array.from(ground.base);
  const weight = mask.vertexWeight;
  const area = mask.label;
  if (brush.op === "raise" || brush.op === "lower") {
    const by = brush.op === "raise" ? brush.by : -brush.by;
    for (let v = 0; v < base.length; v++) if (weight[v]! > 0) base[v] = base[v]! + weight[v]! * by;
    const [done, would] = brush.op === "raise" ? ["Raised", "raise"] : ["Lowered", "lower"];
    return { base, done: `${done} ${area} by ${fmt(brush.by)}`, would: `Would ${would} ${area} by ${fmt(brush.by)}` };
  }
  if (brush.op === "flatten") {
    const { total, cliff, why } = flattenTarget(ground, mask, brush.to ?? "mean", findPoint);
    // The base layer that gives the target height at the reference cliff level; other cliff levels keep their step.
    const target = total - cliff;
    for (let v = 0; v < base.length; v++) if (weight[v]! > 0) base[v] = base[v]! + weight[v]! * (target - base[v]!);
    return { base, done: `Flattened ${area} to ${total.toFixed(2)} (${why})`, would: `Would flatten ${area} to ${total.toFixed(2)} (${why})` };
  }
  const passes = brush.passes ?? 2;
  const { columns } = ground;
  const rows = base.length / columns;
  for (let pass = 0; pass < passes; pass++) {
    const from = Float64Array.from(base);
    for (let v = 0; v < base.length; v++) {
      if (weight[v]! <= 0) continue;
      const x = v % columns;
      const y = Math.floor(v / columns);
      let sum = 0;
      let count = 0;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(rows - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(columns - 1, x + 1); nx++) {
          sum += from[ny * columns + nx]!;
          count++;
        }
      }
      base[v] = from[v]! + weight[v]! * (sum / count - from[v]!);
    }
  }
  const times = passes === 1 ? "once" : passes === 2 ? "twice" : `${passes} times`;
  return { base, done: `Smoothed ${area} ${times}`, would: `Would smooth ${area} ${times}` };
}

/** The height to flatten to, and the cliff layer it is measured at. */
function flattenTarget(ground: KeptGround, mask: AreaMask, to: NonNullable<Extract<ParsedHeightBrush, { op: "flatten" }>["to"]>, findPoint: PointFinder): { total: number; cliff: number; why: string } {
  if (typeof to === "object") {
    const point = findPoint(to.at);
    const nearest = Math.min(ground.height, Math.max(0, Math.round(point.y))) * ground.columns + Math.min(ground.width, Math.max(0, Math.round(point.x)));
    return { total: vertexHeightAt(ground.heights, ground.columns, point.x, point.y), cliff: ground.cliff[nearest]!, why: `the height at ${point.name}` };
  }
  // The cliff layer most of the area is on: the mean and a given height are measured there.
  const counts = new Map<number, number>();
  for (let v = 0; v < ground.cliff.length; v++) if (mask.vertexWeight[v] === 1) counts.set(ground.cliff[v]!, (counts.get(ground.cliff[v]!) ?? 0) + 1);
  const cliff = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
  if (typeof to === "number") return { total: to, cliff, why: "as given" };
  let sum = 0;
  let count = 0;
  for (let v = 0; v < ground.cliff.length; v++) {
    if (mask.vertexWeight[v] !== 1 || ground.cliff[v] !== cliff) continue;
    sum += ground.heights[v]!;
    count++;
  }
  return { total: sum / count, cliff, why: "their mean" };
}

/** A height for the report: up to 3 decimals. */
export function fmt(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
