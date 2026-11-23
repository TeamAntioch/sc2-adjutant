// Routes the generated terrain proves blocked, without running the game: a Connection between two
// Zones that touch on the map, where no cell on one side steps onto a cell on the other. A cell
// can't be stepped on when it lies under a cliff mesh (the levels of the two sides differ and
// nothing ramps between them) or when the author's `pathingPaint` cuts it out whole. The check is
// conservative: a Connection is reported only when every cell pair where the Zones meet is blocked.

import { isPlaced, type MissionBlueprint } from "../domain/mission-blueprint.js";
import { applyPathingPaint } from "../terrain/doodad-pathing.js";
import { CELL_FLAG_CLIFF, CELL_FLAG_GROUND, cliffCells } from "../terrain/cliffs.js";
import { cliffLayout, CLIFF_VARIATION_SEED } from "../terrain/rasterize.js";
import { stampRamp } from "../terrain/ramps.js";
import { stampCorners, stampedCells } from "../terrain/terrain-objects.js";
import { type LayoutModel } from "./layout-model.js";

/** How many blocked cells a finding names. */
const NAMED_CELLS = 4;

/**
 * The cells units can't step on, as the compile lays them out: cells under a cliff mesh, but not a
 * ramp's lane or the deck of a terrain object (a bridge), and cells the author's `pathingPaint`
 * covers whole. Rules relied on, read from the terrain code and not changed here:
 * - `cliffLayout` and `stampRamp` give the cliff mesh and the ramp lanes (terrain/rasterize.ts,
 *   terrain/ramps.ts), as `rasterizeTerrain` flags them (CELL_FLAG_CLIFF);
 * - a terrain object's stamped cells are flagged cliff too, but a bridge's deck is walked, so they count as open;
 * - a cell is cut out only when all 8 of its sub-cells are painted (255): a partly painted cell may be walked round.
 * Dug pools' paint and the doodads' are not read, which can only leave a route open.
 */
export function blockedCells(blueprint: MissionBlueprint): { readonly cliff: Uint8Array; readonly cut: Uint8Array } {
  const { width, height } = blueprint.mapSize;
  const layout = cliffLayout(blueprint, true);
  const corners = { ...layout.corners, levels: layout.corners.levels.slice() };
  stampCorners(layout.terrainObjects, corners);
  const flags = new Uint8Array(width * height).fill(CELL_FLAG_GROUND);
  const columns = width / 2;
  for (const cell of cliffCells(corners, CLIFF_VARIATION_SEED)) {
    const [x, y] = [(cell.index % columns) * 2, Math.floor(cell.index / columns) * 2];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) flags[(y + dy) * width + x + dx] = CELL_FLAG_GROUND | CELL_FLAG_CLIFF;
  }
  const stub = {
    width,
    height,
    cliffHeights: new Float32Array((width + 1) * (height + 1)),
    syncCliff: new Uint16Array(width * height),
    cellFlags: flags,
    cliffCellFlags: new Map<number, number>(),
  };
  for (const ramp of layout.ramps) stampRamp(ramp, stub);
  const cliff = Uint8Array.from(flags, (flag) => flag & CELL_FLAG_CLIFF);
  for (const cell of stampedCells(layout.terrainObjects, width)) cliff[cell] = 0;
  const painted = applyPathingPaint(new Uint8Array(width * height), (blueprint.pathingPaint ?? []).filter((entry) => entry.doodad === undefined), width, height, new Map()).cells;
  return { cliff, cut: Uint8Array.from(painted, (bits) => (bits === 255 ? 1 : 0)) };
}

const cellText = (cell: number, width: number): string => `(${cell % width}, ${Math.floor(cell / width)})`;

function listed(cells: readonly number[], width: number): string {
  const shown = [...cells].sort((a, b) => a - b).slice(0, NAMED_CELLS).map((cell) => cellText(cell, width));
  return `${cells.length} cell${cells.length === 1 ? "" : "s"}, ${shown.join(", ")}${cells.length > NAMED_CELLS ? ` and ${cells.length - NAMED_CELLS} more` : ""}`;
}

/**
 * A finding for each pair of Zones joined by a ground Connection (not air-only, and not a bridge,
 * whose deck the terrain objects lay) that touch on the map and whose cells where they meet are all
 * blocked: the Zones, the Connections' types, the cliff levels either side, and the cells.
 * Zones that don't touch are terrain-agreement's.
 */
export function routeFindings(model: LayoutModel): string[] {
  const { blueprint } = model;
  const { width, height } = blueprint.mapSize;
  const pairs = new Map<string, { a: number; b: number; types: string[] }>();
  const indexOf = new Map(blueprint.zones.map((zone, index) => [zone.id, index]));
  for (const zone of blueprint.zones) {
    for (const connection of zone.connections) {
      if (connection.type === "air-only" || connection.type === "bridge") continue;
      const [a, b] = [indexOf.get(zone.id), indexOf.get(connection.toZoneId)];
      if (a === undefined || b === undefined || a === b) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const entry = pairs.get(key) ?? { a: Math.min(a, b), b: Math.max(a, b), types: [] };
      if (!entry.types.includes(connection.type)) entry.types.push(connection.type);
      pairs.set(key, entry);
    }
  }
  if (pairs.size === 0) return [];
  const { cliff, cut } = blockedCells(blueprint);
  const findings: string[] = [];
  for (const { a, b, types } of pairs.values()) {
    // Every cell pair, a cell of each Zone one step apart (diagonals too, as a unit may cut a corner).
    let meeting = 0;
    let open = false;
    const byCliff = new Set<number>();
    const byCut = new Set<number>();
    for (let y = 0; y < height && !open; y++) {
      for (let x = 0; x < width && !open; x++) {
        const cell = y * width + x;
        if (model.owner[cell] !== a) continue;
        for (let dy = -1; dy <= 1 && !open; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const [nx, ny] = [x + dx, y + dy];
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const next = ny * width + nx;
            if (model.owner[next] !== b) continue;
            meeting++;
            if (!cliff[cell] && !cut[cell] && !cliff[next] && !cut[next]) {
              open = true;
              break;
            }
            for (const blocked of [cell, next]) {
              if (cliff[blocked]) byCliff.add(blocked);
              else if (cut[blocked]) byCut.add(blocked);
            }
          }
        }
      }
    }
    if (open || meeting === 0) continue;
    const nameA = blueprint.zones[a]!.name;
    const nameB = blueprint.zones[b]!.name;
    const reasons: string[] = [];
    if (byCliff.size > 0) {
      reasons.push(`cliff, ${nameA} at level ${blueprint.zones[a]!.elevation} against ${nameB} at level ${blueprint.zones[b]!.elevation} (${listed([...byCliff], width)})`);
    }
    if (byCut.size > 0) reasons.push(`cut out by pathingPaint (${listed([...byCut], width)})`);
    findings.push(
      `${nameA} and ${nameB} (${types.join(", ")}) are joined on the Blueprint but blocked on the terrain: no cell where they meet can be stepped across, ${reasons.join("; ")}. ${
        byCliff.size > 0 ? "Use a ramp, or put the Zones on one level there" : "Clear the paint along the edge"
      }`,
    );
  }
  return findings;
}

/** One route test's verdict. */
export type RouteTestResult = { readonly id: string; readonly passed: boolean; readonly message: string };

/**
 * Runs each of the Blueprint's `tests.routes` on the terrain the compile would generate: a walk
 * over the cells units can step on (the same blocked cells `routeFindings` reads), through cells
 * some Zone owns, a step to any of the 8 neighbours, a diagonal only when both cells beside it are
 * open. A Zone start or goal is any open cell of it; an Anchor's is its own cell. Like
 * `routeFindings` it reads no doodads' or dug pools' paint, so an "arrive" that passes may still be
 * blocked in the game by a doodad, while a "blocked" that fails is certain. Needs an in-game check.
 */
export function routeTestResults(model: LayoutModel): RouteTestResult[] {
  const { blueprint } = model;
  const tests = blueprint.tests?.routes ?? [];
  if (tests.length === 0) return [];
  const { width, height } = blueprint.mapSize;
  const { cliff, cut } = blockedCells(blueprint);
  const zoneIndex = new Map(blueprint.zones.map((zone, index) => [zone.id, index]));
  const anchors = new Map(blueprint.anchors.map((anchor) => [anchor.id, anchor]));
  const open = (cell: number): boolean => model.owner[cell]! >= 0 && !cliff[cell] && !cut[cell];
  const cellsOf = (place: string): { readonly cells: number[]; readonly error?: string } => {
    const zone = zoneIndex.get(place);
    if (zone !== undefined) {
      const cells: number[] = [];
      model.owner.forEach((owner, cell) => {
        if (owner === zone && open(cell)) cells.push(cell);
      });
      return cells.length > 0 ? { cells } : { cells, error: `no cell of Zone ${place} can be stood on` };
    }
    const anchor = anchors.get(place);
    if (anchor && isPlaced(anchor)) {
      const [x, y] = [Math.floor(anchor.position.x), Math.floor(anchor.position.y)];
      if (x < 0 || y < 0 || x >= width || y >= height) return { cells: [], error: `Anchor ${place} is off the map` };
      const cell = y * width + x;
      return open(cell) ? { cells: [cell] } : { cells: [], error: `Anchor ${place} stands on ground that can't be stepped on, at ${cellText(cell, width)}` };
    }
    return { cells: [], error: `${place} is neither a Zone nor a placed Anchor of this Blueprint` };
  };
  return tests.map((test) => {
    const [from, to] = [cellsOf(test.from), cellsOf(test.to)];
    const error = from.error ?? to.error;
    const why = test.note ? ` (${test.note})` : "";
    if (error) return { id: test.id, passed: false, message: `${test.id}: can't be run, ${error}` };
    const seen = new Uint8Array(width * height);
    const goal = new Set(to.cells);
    const queue = [...from.cells];
    for (const cell of queue) seen[cell] = 1;
    let arrived = from.cells.some((cell) => goal.has(cell));
    for (let head = 0; head < queue.length && !arrived; head++) {
      const cell = queue[head]!;
      const [x, y] = [cell % width, Math.floor(cell / width)];
      for (let dy = -1; dy <= 1 && !arrived; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const [nx, ny] = [x + dx, y + dy];
          if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next] || !open(next)) continue;
          if (dx !== 0 && dy !== 0 && (!open(y * width + nx) || !open(ny * width + x))) continue;
          seen[next] = 1;
          if (goal.has(next)) arrived = true;
          queue.push(next);
        }
      }
    }
    const wants = test.expect === "arrive";
    const pair = `${test.from} to ${test.to}`;
    if (arrived === wants) return { id: test.id, passed: true, message: `${test.id}: ${pair} ${arrived ? "arrives" : "is blocked"}, as expected` };
    return {
      id: test.id,
      passed: false,
      message: arrived
        ? `${test.id}: ${pair} should be blocked but a walk arrives${why}`
        : `${test.id}: ${pair} should arrive but every walk is stopped (cliff cells or pathingPaint) after ${queue.length} cell${queue.length === 1 ? "" : "s"}${why}`,
    };
  });
}
