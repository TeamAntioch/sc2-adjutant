// The Editor's hidden cells back into the Blueprint (zone.hiddenCells, #598): t3CellFlags' hidden
// bit on the cells the compile writes it on, as each Zone's minimal rectangles. Beside Kept ground
// those are the generating Zones' own cells (ownedCells), on a generated map every cell, each to
// the last Zone holding its centre, as the Schema reads hiddenCells and the terrain paints them. A
// Zone's listed cells the compile doesn't write (at a generating Zone's edge) stay listed.

import { cellRects, cellsOfRects, ownedCells } from "../kept-terrain/generating-zones.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { containsPoint } from "../terrain/polygon.js";
import { CELL_FLAG_HIDDEN } from "../terrain/cliffs.js";
import { zoneOwners } from "../terrain/paint-textures.js";

type Rect = [number, number, number, number];
type RawZone = Record<string, unknown> & { readonly id?: unknown; readonly terrain?: "generate" | "kept"; readonly polygon: { x: number; y: number }[]; hiddenCells?: Rect[] };

/** `raw` with each Zone's hiddenCells as `flags` (the package's t3CellFlags cells) has them, and the ids of the Zones whose hidden cells changed. */
export function syncHiddenCells(raw: Record<string, unknown>, flags: Uint8Array): { readonly blueprint: Record<string, unknown>; readonly changed: string[] } {
  const { width, height } = raw.mapSize as { width: number; height: number };
  const zones = (Array.isArray(raw.zones) ? raw.zones : []) as RawZone[];
  const owner = hiddenBitZones(zones, width, height);

  const changed: string[] = [];
  const next = zones.map((zone, index) => {
    if (zone.terrain === "kept") return zone;
    const listed = cellsOfRects(zone.hiddenCells ?? [], width, height);
    const cells = Uint8Array.from(listed, (value, cell) => (owner[cell] === -1 ? value : owner[cell] === index && flags[cell]! & CELL_FLAG_HIDDEN ? 1 : 0));
    if (cells.every((value, cell) => value === listed[cell])) return zone;
    changed.push(String(zone.id));
    const { hiddenCells: _, ...rest } = zone;
    return cells.includes(1) ? { ...rest, hiddenCells: cellRects(cells, width, height) } : rest;
  });
  return { blueprint: changed.length ? { ...raw, zones: next } : raw, changed };
}

/**
 * Each cell's Zone (an index into `zones`) where the compile writes the hidden bit, -1 elsewhere:
 * beside Kept ground the generating Zones' own cells, each to the last generating Zone holding its
 * centre (as the Schema reads hiddenCells); on a generated map every cell in a Zone, the same way.
 */
export function hiddenBitZones(zones: readonly Pick<MissionBlueprint["zones"][number], "terrain" | "polygon">[], width: number, height: number): Int16Array {
  if (!zones.some((zone) => zone.terrain !== undefined)) return zoneOwners({ mapSize: { width, height }, zones } as never);
  const owner = new Int16Array(width * height).fill(-1);
  const { owned } = ownedCells({ zones } as never, width, height);
  for (let cell = 0; cell < owner.length; cell++) {
    if (!owned[cell]) continue;
    const centre = { x: (cell % width) + 0.5, y: Math.floor(cell / width) + 0.5 };
    zones.forEach((zone, index) => {
      if (zone.terrain === "generate" && containsPoint(zone.polygon, centre)) owner[cell] = index;
    });
  }
  return owner;
}
