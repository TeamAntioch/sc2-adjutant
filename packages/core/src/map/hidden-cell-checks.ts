// Checks on a Mission's hidden cells (zone.hiddenCells, #599), read from its Map Package: each group
// of cells in a Zone that the compile writes the hidden bit on (a generated map's, or the generating
// Zones' own beside Kept ground) that the package hides. A hole shows the sky unless something
// stands under it, and hiding doesn't make a cell unpathable (docs/reference/terrain-file-formats.md).

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { hasKeptTerrain, type MissionBlueprint } from "../domain/mission-blueprint.js";
import { readCellFlagCells } from "../kept-terrain/kept-cliffs.js";
import { readKeptPathing } from "../kept-terrain/pathing-brush.js";
import { CELL_FLAG_CLIFF, CELL_FLAG_HIDDEN } from "../terrain/cliffs.js";
import { hiddenBitZones } from "../sync/sync-hidden-cells.js";
import { PATHING_FILE, WHOLE_CELL } from "../terrain/write-cell-attribute.js";
import { readObjectsXml } from "./read-objects-xml.js";

export type HiddenCellProblem = { readonly path: string; readonly message: string };

/** How near a doodad must stand to a hidden cell, in cells, to count as what's under it. */
const UNDER = 1;

/** Warnings for the package's hidden cells at `mapPackage`: a group with no doodad near it, and one units can still walk on. */
export async function hiddenCellProblems(blueprint: Pick<MissionBlueprint, "zones" | "mapSize">, mapPackage: string): Promise<HiddenCellProblem[]> {
  const { width, height } = blueprint.mapSize;
  const flags = await readCellFlagCells(mapPackage, width, height);
  if (!flags) return [];
  // Each cell's Zone, where the compile writes the hidden bit; -1 elsewhere.
  const owner = hiddenBitZones(blueprint.zones, width, height);
  const besideKept = hasKeptTerrain(blueprint);
  const hidden = Uint8Array.from(flags, (value, cell) => (owner[cell]! >= 0 && value & CELL_FLAG_HIDDEN ? 1 : 0));
  if (!hidden.includes(1)) return [];

  const pathingFile = path.join(mapPackage, PATHING_FILE);
  const pathing = readKeptPathing(existsSync(pathingFile) ? await readFile(pathingFile) : undefined, width, height);
  const objectsFile = path.join(mapPackage, "Objects");
  const doodads = existsSync(objectsFile) ? readObjectsXml(await readFile(objectsFile, "utf8")).doodads : [];

  const problems: HiddenCellProblem[] = [];
  for (const group of groups(hidden, width, height)) {
    const first = group[0]!;
    const [x, y] = [first % width, Math.floor(first / width)];
    const zone = blueprint.zones[owner[first]!]!;
    const at = `${group.length} hidden cell${group.length === 1 ? "" : "s"} of ${zone.id}, the first at (${x}, ${y}),`;
    const cells = new Set(group);
    const near = (dx: number, dy: number): boolean => {
      for (let cy = Math.max(0, Math.floor(dy - UNDER)); cy <= Math.min(height - 1, Math.floor(dy + UNDER)); cy++) {
        for (let cx = Math.max(0, Math.floor(dx - UNDER)); cx <= Math.min(width - 1, Math.floor(dx + UNDER)); cx++) if (cells.has(cy * width + cx)) return true;
      }
      return false;
    };
    if (!doodads.some((doodad) => near(doodad.position.x, doodad.position.y))) {
      problems.push({ path: `zones.${owner[first]}.hiddenCells`, message: `${at} ${group.length === 1 ? "has" : "have"} no doodad under or beside ${group.length === 1 ? "it" : "them"}, so the sky may show through: put one below the ground (a wall doodad, as under a hatch), or show ${group.length === 1 ? "it" : "them"} again` });
    }
    const pathable = group.filter((cell) => pathing[cell] !== WHOLE_CELL && !(flags[cell]! & CELL_FLAG_CLIFF));
    if (pathable.length > 0) {
      problems.push({
        path: `zones.${owner[first]}.hiddenCells`,
        message: `${at} ${pathable.length === group.length ? (group.length === 1 ? "is still pathable" : "are all still pathable") : `include ${pathable.length} still pathable`}, since hiding isn't pathing: units can stand over the hole unless a doodad's footprint blocks it. ${besideKept ? `Paint ${pathable.length === 1 ? "it" : "them"} unpathable (block-pathing)` : `Block ${pathable.length === 1 ? "it" : "them"} with a doodad's footprint or a pathing blocker`}, or leave ${pathable.length === 1 ? "it" : "them"} walkable on purpose`,
      });
    }
  }
  return problems;
}

/** The marked cells in groups that touch side to side, each in cell order. */
function groups(marked: Uint8Array, width: number, height: number): number[][] {
  const seen = new Uint8Array(marked.length);
  const out: number[][] = [];
  for (let start = 0; start < marked.length; start++) {
    if (!marked[start] || seen[start]) continue;
    const group: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cell = stack.pop()!;
      group.push(cell);
      const [x, y] = [cell % width, Math.floor(cell / width)];
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (marked[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    out.push(group.sort((a, b) => a - b));
  }
  return out;
}
