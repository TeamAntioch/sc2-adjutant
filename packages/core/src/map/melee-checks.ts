// The melee checks and the distance report (#216, spec #212 "Checks", author decision Q5).
//
// Errors stop the build before a file is written, each naming its rule and the object that
// breaks it. Warnings and the distance report come back with the map. The thresholds are the
// ones measured on 21 Blizzard ladder maps, for a two-spawn
// map of the Standard category; the distances are worker seconds at 3.9375 cells/s on the cell
// pathing measure.py uses (melee-distances.ts). The Mission checker (layout/checks.ts, 3.15 cells/s)
// is a separate clock, for Missions.

import { isResourceBase, type MeleeMapBlueprint, meleePlayableBounds } from "../domain/melee-map-blueprint.js";
import type { Point, TerrainRasterizationResult } from "../terrain/rasterize.js";
import { type Rot180, rotatePoint } from "../terrain/symmetry.js";
import { type PlacedUnit, townHallSpot } from "./expand-placements.js";
import { isGeyser, offCorner, type ResourceFootprint, resourceCells, resourceGap } from "./melee-bases.js";
import {
  groundDistances,
  isBlockingRock,
  isResource,
  type MeleeDistances,
  type MeleeGround,
  measureMeleeMap,
  meleePassable,
  nearestPassable,
  rockCells,
  roundSeconds,
  walkStart,
  WORKER_SPEED,
} from "./melee-distances.js";
import type { MeleeMain } from "./melee-mains.js";
import { formatFinding, type MeleeFinding, type MeleeRule } from "./melee-rules.js";

/** The distance report, with the warnings the author can choose to accept. */
export type MeleeReport = {
  readonly distances: MeleeDistances;
  readonly bases: number;
  readonly goldBases: number;
  readonly richGasBases: number;
  readonly warnings: readonly MeleeFinding[];
};

/** What the checks read: the whole map, its mains, and what the compiler drew and placed. */
export type MeleeMapFacts = {
  readonly blueprint: MeleeMapBlueprint;
  readonly mains: readonly MeleeMain[];
  readonly terrain: TerrainRasterizationResult;
  readonly units: readonly PlacedUnit[];
  /** Each spawn's town-hall centre, Player 1's first. */
  readonly starts: readonly Point[];
  readonly symmetry: Rot180;
};

/** The checks on a drawn melee map: its errors, and its distance report with the warnings. */
export function checkMeleeMap(facts: MeleeMapFacts): { readonly errors: readonly MeleeFinding[]; readonly report: MeleeReport } {
  const { blueprint, terrain, units, starts } = facts;
  const { width, height } = blueprint.mapSize;
  const ground: MeleeGround = { width, height, bounds: meleePlayableBounds(blueprint), syncCliff: terrain.syncCliff, noPathing: terrain.noPathing, units };

  const errors: MeleeFinding[] = [];
  const resourceBases = blueprint.placements.filter(isResourceBase);
  for (const id of blueprint.starts) {
    const placement = resourceBases.find((candidate) => candidate.id === id)!;
    const [x, y] = townHallSpot(placement.params.at);
    const pieces = units.filter((unit) => unit.id.startsWith(`${id}/`) && isResource(unit.unitType));
    errors.push(...startBaseFindings(id, { x, y }, pieces, placement.params));
  }
  errors.push(
    ...overlapFindings(units),
    ...symmetryFindings(
      [...units.map((unit) => ({ id: unit.id, kind: unit.unitType, x: unit.x, y: unit.y })), ...starts.map((start, index) => ({ id: `Start Location 00${index + 1}`, kind: "StartLoc", ...start }))],
      facts.symmetry.centre,
    ),
  );
  for (const main of facts.mains) {
    const ramp = terrain.ramps.find((candidate) => candidate.id === main.rampId);
    if (!ramp) continue; // placeMeleeUnits has already refused a main with no diagonal ramp.
    const slope = rampSlope(ground, ramp.edge);
    errors.push(...rampShapeFindings(main.zoneId, slope, ramp.lowLevel));
    const startBase = resourceBases.find((placement) => placement.zoneId === main.zoneId && blueprint.starts.includes(placement.id));
    if (startBase) {
      const [x, y] = townHallSpot(startBase.params.at);
      errors.push(...mainEntranceFindings(main.zoneId, ground, { x, y }, slope));
    }
  }

  const bases = resourceBases.map((placement) => {
    const [x, y] = townHallSpot(placement.params.at);
    return { id: placement.id, hall: { x, y } };
  });
  const distances = measureMeleeMap({ ...ground, starts, bases });
  const report: MeleeReport = {
    distances,
    bases: resourceBases.length,
    goldBases: resourceBases.filter((placement) => placement.params.minerals === "rich").length,
    richGasBases: resourceBases.filter((placement) => placement.params.gas !== "normal").length,
    warnings: [],
  };
  return { errors, report: { ...report, warnings: meleeWarnings(report) } };
}

/**
 * A start base against the ladder's (research §1, §6 "Start base"): 4 large and 4 small normal
 * patches and 2 normal geysers, every geyser 3 cells from the town hall's footprint and every
 * patch 3 or 4 (2 only off a corner). Our port of the town-hall rule runs as the base is placed.
 */
export function startBaseFindings(id: string, hall: Point, pieces: readonly ResourceFootprint[], variant: { readonly minerals?: string; readonly gas?: string } = {}): MeleeFinding[] {
  const findings: MeleeFinding[] = [];
  const finding = (message: string): void => void findings.push({ rule: "start-base", object: `start base ${id}`, message });
  if (variant.minerals === "rich") finding("it's a gold base: every ladder start has 8 normal patches. Drop `minerals: \"rich\"`");
  if (variant.gas !== undefined && variant.gas !== "normal") finding("it has rich gas: every ladder start has 2 normal geysers. Drop `gas`");
  const count = (type: string): number => pieces.filter((piece) => piece.unitType === type).length;
  const mix = { MineralField: count("MineralField"), MineralField750: count("MineralField750"), VespeneGeyser: count("VespeneGeyser") };
  if (findings.length === 0 && (mix.MineralField !== 4 || mix.MineralField750 !== 4 || mix.VespeneGeyser !== 2 || pieces.length !== 10)) {
    finding(`it has ${pieces.length} resources (${mix.MineralField} large, ${mix.MineralField750} small, ${mix.VespeneGeyser} geysers), not 4 large and 4 small patches and 2 geysers`);
  }
  for (const piece of pieces) {
    const gap = resourceGap(hall, piece);
    const at = `${piece.unitType} at (${piece.x}, ${piece.y})`;
    if (isGeyser(piece.unitType) && gap !== 3) finding(`${at} is ${gap} cells from the town hall, not 3`);
    else if (!isGeyser(piece.unitType) && !(gap === 3 || gap === 4 || (gap === 2 && offCorner(hall, piece)))) {
      finding(`${at} is ${gap} cells from the town hall: a patch sits 3 or 4 away, or 2 off a corner`);
    }
  }
  return findings;
}

/** What the symmetry check pairs: placed units and start locations, by type. */
export type MeleeObject = { readonly id: string; readonly kind: string; readonly x: number; readonly y: number };

/** Every object's partner under the 180° rotation: an object of its kind within 1 cell of its turned position (research §6 "Symmetry"). */
export function symmetryFindings(objects: readonly MeleeObject[], centre: Point): MeleeFinding[] {
  return objects.flatMap((object) => {
    const turned = rotatePoint({ centre }, object);
    const partner = objects.some((other) => other.kind === object.kind && Math.hypot(other.x - turned.x, other.y - turned.y) <= 1.01);
    if (partner) return [];
    return [{ rule: "symmetry", object: object.id, message: `${object.kind} at (${object.x}, ${object.y}) has no partner within 1 cell of (${turned.x}, ${turned.y}), its spot turned about the centre (${centre.x}, ${centre.y})` }];
  });
}

/**
 * Resources, rocks and plates standing on one another: a resource base near the centre lands on
 * its own turned copy (#222). Names each pair once.
 */
export function overlapFindings(units: readonly (ResourceFootprint & { readonly id: string })[]): MeleeFinding[] {
  const owner = new Map<string, string>();
  const pairs = new Set<string>();
  const findings: MeleeFinding[] = [];
  for (const unit of units) {
    for (const [x, y] of footprint(unit)) {
      const key = `${x},${y}`;
      const other = owner.get(key);
      if (other === undefined) owner.set(key, unit.id);
      else if (other !== unit.id && !pairs.has(`${other}|${unit.id}`)) {
        pairs.add(`${other}|${unit.id}`);
        const source = (id: string): string => id.split("/")[0]!;
        const hint = source(other).replace(/-rot$/, "") === source(unit.id).replace(/-rot$/, "") ? ": its base lands on its own turned copy, so move it further from the centre" : "";
        findings.push({ rule: "symmetry", object: unit.id, message: `${unit.unitType} at (${unit.x}, ${unit.y}) stands on ${other} (cell ${key})${hint}` });
      }
    }
  }
  return findings;
}

function footprint(unit: ResourceFootprint): [number, number][] {
  if (isResource(unit.unitType)) return resourceCells(unit);
  if (isBlockingRock(unit.unitType)) return rockCells(unit);
  // A plate's 2×2, round its whole-coordinate centre.
  return [
    [unit.x - 1, unit.y - 1],
    [unit.x, unit.y - 1],
    [unit.x - 1, unit.y],
    [unit.x, unit.y],
  ];
}

/** A cell of a ramp's slope: its sync cliff level between two levels'. */
export type SlopeCell = { readonly x: number; readonly y: number; readonly value: number };

/** The ramp's slope cells, flood-filled from those within 3 cells of its top. */
export function rampSlope(ground: Pick<MeleeGround, "width" | "height" | "syncCliff">, top: Point): SlopeCell[] {
  const { width, height, syncCliff } = ground;
  const sloped = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && syncCliff[y * width + x]! % 64 !== 0;
  const seen = new Set<number>();
  const stack: [number, number][] = [];
  for (let y = top.y - 3; y < top.y + 3; y++) for (let x = top.x - 3; x < top.x + 3; x++) if (sloped(x, y)) stack.push([x, y]);
  const cells: SlopeCell[] = [];
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const index = y * width + x;
    if (seen.has(index) || !sloped(x, y)) continue;
    seen.add(index);
    cells.push({ x, y, value: syncCliff[index]! });
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return cells;
}

/**
 * The main's ramp against the ladder's (research §2 "Main ramp"): on all 19 two-player ladder
 * maps, 15 cells of slope in a 5×5 box, one level down, stepping 8 a cell.
 */
export function rampShapeFindings(main: string, slope: readonly SlopeCell[], lowLevel: number): MeleeFinding[] {
  const xs = slope.map((cell) => cell.x);
  const ys = slope.map((cell) => cell.y);
  const box = slope.length > 0 ? [Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1] : [0, 0];
  const oneLevel = slope.every((cell) => cell.value > 64 * lowLevel && cell.value < 64 * (lowLevel + 1) && cell.value % 8 === 0);
  if (slope.length === 15 && box[0] === 5 && box[1] === 5 && oneLevel) return [];
  return [
    {
      rule: "main-ramp",
      object: `main ${main}`,
      message: `its ramp has ${slope.length} cells of slope in a ${box[0]}×${box[1]} box${oneLevel ? "" : ", not one level down"}: the ladder main ramp has 15 in a 5×5, one level down`,
    },
  ];
}

/**
 * A main whose plateau reaches lower ground other than down its ramp (research §6 "Main"): its
 * ramp's slope blocked, the rocks standing, a worker from the start mustn't get off the top
 * level. Names the nearest cell where it does.
 */
export function mainEntranceFindings(main: string, ground: MeleeGround, start: Point, slope: readonly SlopeCell[]): MeleeFinding[] {
  const passable = meleePassable(ground, true);
  for (const cell of slope) passable[cell.y * ground.width + cell.x] = 0;
  const from = nearestPassable(ground.width, passable, walkStart(start));
  if (!from) return [];
  const level = ground.syncCliff[from.y * ground.width + from.x]!;
  const distances = groundDistances(ground, passable, from);
  let leak: { cells: number; index: number } | undefined;
  distances.forEach((cells, index) => {
    if (Number.isFinite(cells) && ground.syncCliff[index]! < level && (!leak || cells < leak.cells)) leak = { cells, index };
  });
  if (!leak) return [];
  const x = leak.index % ground.width;
  const y = (leak.index - x) / ground.width;
  return [
    {
      rule: "main-entrance",
      object: `main ${main}`,
      message: `a worker walks off it at cell (${x}, ${y}), ${roundSeconds(leak.cells / WORKER_SPEED)} s from the town hall, without its ramp: close that way with a cliff, or block it with a \`rocks\` placement`,
    },
  ];
}

/** The report's numbers against the Standard bands (research §2, §6). */
export function meleeWarnings(report: Omit<MeleeReport, "warnings">): MeleeFinding[] {
  const { distances: d } = report;
  const warnings: MeleeFinding[] = [];
  const band = (rule: MeleeRule, object: string, seconds: number | undefined, low: number, high: number, what: string): void => {
    if (seconds !== undefined && (seconds < low || seconds > high)) warnings.push({ rule, object, message: `${what} is ${seconds} s, outside ${low}-${high} s` });
  };
  if (d.rampToRamp) band("ramp-to-ramp", "the main ramps", d.rampToRamp.seconds, 33, 38, "ramp to ramp");
  else warnings.push({ rule: "ramp-to-ramp", object: "the main ramps", message: "no ground path from one main ramp to the other" });
  if (d.mainToNatural) band("main-to-natural", d.mainToNatural.base, d.mainToNatural.ground.seconds, 6, 10, "main to natural");
  else warnings.push({ rule: "main-to-natural", object: "the main", message: "no natural reachable by ground" });
  if (d.mainToThird) band("main-to-third", d.mainToThird.base, d.mainToThird.ground.seconds, 10, 20, "main to third");
  else warnings.push({ rule: "main-to-third", object: "the main", message: "no third base reachable by ground" });
  if (d.mainToThird) {
    const second = d.secondThird;
    if (!second) warnings.push({ rule: "second-third", object: d.mainToThird.base, message: "it's the only third: no other base to take instead" });
    else if (second.ground.seconds - d.mainToThird.ground.seconds > 4) {
      warnings.push({ rule: "second-third", object: second.base, message: `the next base is ${roundSeconds(second.ground.seconds - d.mainToThird.ground.seconds)} s past the third (${d.mainToThird.base}), more than about 4 s` });
    }
  }
  if (report.bases < 14 || report.bases > 16) warnings.push({ rule: "base-count", object: "the map", message: `${report.bases} bases, outside 14-16` });
  for (const entry of d.airVsGround) {
    if (entry.ratio < 0.6) warnings.push({ rule: "air-vs-ground", object: entry.base, message: `by air ${entry.air} s from the other main, ${Math.round(entry.ratio * 100)}% of its ${entry.ground} s by ground` });
  }
  return warnings;
}

/** The report as the CLI prints it and the MCP tool returns it. */
export function formatMeleeReport(report: MeleeReport): string {
  const d = report.distances;
  const time = (value: { readonly seconds: number; readonly rocksDown?: number } | undefined): string =>
    value === undefined ? "none" : `${value.seconds.toFixed(1)} s${value.rocksDown !== undefined ? ` (rocks down ${value.rocksDown.toFixed(1)} s)` : ""}`;
  const base = (entry: { readonly base: string; readonly ground: { readonly seconds: number; readonly rocksDown?: number } } | undefined): string => (entry ? `${time(entry.ground)}, to ${entry.base}` : "none");
  const lines = [
    `Distance report: worker seconds at ${WORKER_SPEED} cells/s on cell pathing, from Player 1's side`,
    `  Ramp to ramp        ${time(d.rampToRamp)}`,
    `  Main to main        ${time(d.mainToMain.ground)}; by air ${d.mainToMain.air.toFixed(1)} s`,
    `  Natural to natural  ${time(d.naturalToNatural)}`,
    `  Main to natural     ${base(d.mainToNatural)}`,
    `  Main to third       ${base(d.mainToThird)}`,
    `  Second third        ${base(d.secondThird)}`,
    `  Air vs ground, from the other main:`,
    ...d.airVsGround.map((entry) => `    ${entry.base.padEnd(20)} air ${entry.air.toFixed(1)} s, ground ${entry.ground.toFixed(1)} s (${Math.round(entry.ratio * 100)}%)`),
    `  Bases               ${report.bases} (${report.goldBases} gold, ${report.richGasBases} rich gas)`,
  ];
  lines.push(report.warnings.length === 0 ? "No warnings." : `Warnings (${report.warnings.length}):`);
  for (const warning of report.warnings) lines.push(`  ${formatFinding(warning)}`);
  return lines.join("\n");
}
