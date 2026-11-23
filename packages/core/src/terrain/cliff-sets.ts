// Which cliff set each cliff cell wears (DL-04: the cliff and the ground it borders are chosen as
// a pair). A cliff belongs to the ground on top of it: the zone owning its highest corner. The one
// exception is a wall of backdrop rock: where the top zone is a backdrop and a zone owning a lower
// corner isn't, the cliff is that floor's wall, and the floor's own choice wins if it names one
// (cliffCellZone, which the Kept seam shares).
// A zone's choice is its own `cliff`, else the `cliffSets` group listing it. Without one, with a cliff
// palette, a cliff dropping below the main level (a pit rim) takes `pit`, a cliff under built ground
// takes `built`, and the rest take `natural`. Without a palette every cliff wears the tileset's first set.

import { blueprintCatalog, layerSource } from "../catalog/catalog-layer.js";
import { getTilesetCliffSets, isKnownCliffSet } from "../catalog/tileset-cliff-sets.js";
import { listedZoneIds, MAX_MAP_CLIFF_SETS, type MissionBlueprint } from "../domain/mission-blueprint.js";
import { type CornerGrid, cornerLevel } from "./cliffs.js";
import type { Ramp } from "./ramps.js";
import { containsPoint } from "./rasterize.js";

export type CliffSetPlan = {
  /** Cliff set names in `<cliffSetList>` order; a cliff cell's or ramp's set is an index into it. */
  readonly sets: readonly string[];
  /** The set index for the 2×2 cliff cell at (cx, cy). */
  readonly setAt: (cx: number, cy: number) => number;
  /** The set index for a ramp: the cliff it cuts through, by its top corner. */
  readonly setForRamp: (ramp: Ramp) => number;
};

/** `owners`: the zone index owning each corner as the levels were drawn (ragged natural outlines); by default, the straight polygons'. */
export function cliffSetPlan(blueprint: MissionBlueprint, corners: CornerGrid, mainLevel: number, owners?: Int16Array): CliffSetPlan {
  const palette = blueprint.cliffPalette;
  const tilesetId = blueprint.tilesetId ?? "KorhalCityEx2";
  const catalog = blueprintCatalog(blueprint);
  const fallback = getTilesetCliffSets(catalog, tilesetId)[0];
  const choices = zoneCliffChoices(blueprint);
  const named = [palette?.natural, palette?.built, palette?.pit, ...choices].filter(
    (name): name is string => name !== undefined,
  );
  for (const name of named) {
    if (!isKnownCliffSet(catalog, name)) throw new Error(`Cliff set ${name} isn't a known cliff set (data/cliff-extracted.json${layerSource(catalog)})`);
  }
  const sets: string[] = [];
  const indexOf = (name: string): number => {
    const index = sets.indexOf(name);
    if (index >= 0) return index;
    sets.push(name);
    return sets.length - 1;
  };
  const natural = palette?.natural ?? fallback;
  if (!natural) throw new Error(`No cliff set known for tileset ${tilesetId}`);
  indexOf(natural);

  // The zone owning each corner (later zones win), as the corner grid was built.
  const owner = owners ?? new Int16Array(corners.columns * corners.rows).fill(-1);
  if (!owners) blueprint.zones.forEach((zone, index) => {
    for (let cy = 0; cy < corners.rows; cy++) {
      for (let cx = 0; cx < corners.columns; cx++) {
        if (containsPoint(zone.polygon, { x: cx * 2, y: cy * 2 })) owner[cy * corners.columns + cx] = index;
      }
    }
  });

  const setAt = (cx: number, cy: number): number => {
    const around = [
      [cx, cy],
      [cx + 1, cy],
      [cx, cy + 1],
      [cx + 1, cy + 1],
    ].filter(([x, y]) => x! < corners.columns && y! < corners.rows) as [number, number][];
    const levels = around.map(([x, y]) => cornerLevel(corners, x, y));
    const low = Math.min(...levels);
    const cell = around.map(([x, y], i) => ({ level: levels[i]!, zone: owner[y * corners.columns + x]! }));
    return choose(cliffCellZone(cell, blueprint.zones, choices), low);
  };
  /** The set for a cliff under `zoneIndex`'s ground whose foot is at `low`. */
  const choose = (zoneIndex: number, low: number): number => {
    const zone = blueprint.zones[zoneIndex];
    const choice = choices[zoneIndex];
    if (choice !== undefined) return indexOf(choice);
    if (!palette) return 0;
    if (low < mainLevel && palette.pit !== undefined) return indexOf(palette.pit);
    if (zone?.surface === "built" && palette.built !== undefined) return indexOf(palette.built);
    return 0;
  };
  const setForRamp = (ramp: Ramp): number => choose(owner[(ramp.edge.y / 2) * corners.columns + ramp.edge.x / 2]!, ramp.lowLevel);
  return { sets, setAt, setForRamp };
}

/** A corner of a cliff cell: its cliff level and the Zone owning it (an index; -1 for none). */
export type CliffCellCorner = { readonly level: number; readonly zone: number };

/**
 * The Zone whose choice dresses a cliff cell: the Zone on top of it (its highest corner's). Where
 * that Zone is a backdrop, the cell is a wall of rock, and the lowest floor at its foot (a lower
 * corner's Zone that isn't a backdrop) naming a set in `choices` takes it instead. -1 for no Zone.
 */
export function cliffCellZone(corners: readonly CliffCellCorner[], zones: readonly { readonly backdrop?: boolean | undefined }[], choices: readonly (string | undefined)[]): number {
  const backdrop = (zone: number) => zones[zone]?.backdrop === true;
  let high = -Infinity;
  for (const corner of corners) high = Math.max(high, corner.level);
  // On top, ground that isn't a backdrop wins a tie with rock, whatever order the corners come in.
  let top = -1;
  for (const corner of corners) if (corner.level === high && (top === -1 || (backdrop(top) && !backdrop(corner.zone)))) top = corner.zone;
  if (!backdrop(top)) return top;
  let floor: CliffCellCorner | undefined;
  for (const corner of corners) {
    if (corner.level >= high || corner.zone < 0 || backdrop(corner.zone) || choices[corner.zone] === undefined) continue;
    if (!floor || corner.level < floor.level) floor = corner;
  }
  return floor?.zone ?? top;
}

/**
 * Each of `zones`' own choice of cliff set, in their order: its `cliff`, else the `cliffSets` group
 * listing it; undefined where it names none. `zones` defaults to all the Blueprint's.
 */
export function zoneCliffChoices(blueprint: Pick<MissionBlueprint, "zones" | "cliffSets">, zones: readonly MissionBlueprint["zones"][number][] = blueprint.zones): (string | undefined)[] {
  const byGroup = new Map<string, string>();
  for (const group of blueprint.cliffSets ?? []) for (const id of listedZoneIds(group, blueprint.zones)) if (!byGroup.has(id)) byGroup.set(id, group.cliffSet);
  return zones.map((zone) => zone.cliff ?? byGroup.get(zone.id));
}

/**
 * The sets a map writes: the plan's, less any only terrain-object cells (no cliff mesh) would wear,
 * with each cell's and ramp's index renumbered into them. The first, the default set, always stays.
 */
export function wornCliffSets<Cell extends { readonly flags: number; readonly cliffSet?: number | undefined }, R extends { readonly cliffSet?: number | undefined }>(
  sets: readonly string[],
  cells: readonly Cell[],
  ramps: readonly R[],
  meshless: (flags: number) => boolean,
): { sets: string[]; cells: Cell[]; ramps: R[] } {
  const worn = new Set([0, ...cells.filter((cell) => !meshless(cell.flags)).map((cell) => cell.cliffSet ?? 0), ...ramps.map((ramp) => ramp.cliffSet ?? 0)]);
  if (worn.size === sets.length) return { sets: [...sets], cells: [...cells], ramps: [...ramps] };
  const kept = sets.flatMap((_, index) => (worn.has(index) ? [index] : []));
  const renumber = new Map(kept.map((old, index) => [old, index]));
  const to = (index: number | undefined) => renumber.get(index ?? 0) ?? 0;
  return {
    sets: kept.map((index) => sets[index]!),
    cells: cells.map((cell) => ({ ...cell, cliffSet: to(cell.cliffSet) })),
    ramps: ramps.map((ramp) => {
      const { cliffSet: _old, ...rest } = ramp;
      const cliffSet = to(ramp.cliffSet);
      return (cliffSet === 0 ? rest : { ...rest, cliffSet }) as R;
    }),
  };
}

/** Throws if a map would use more cliff sets than the Editor allows. */
export function checkCliffSetCount(sets: readonly string[]): void {
  if (sets.length > MAX_MAP_CLIFF_SETS) {
    throw new Error(`The map would use ${sets.length} cliff sets (${sets.join(", ")}), and a map can use at most ${MAX_MAP_CLIFF_SETS}: drop one from cliffPalette, cliffSets or a Zone's cliff`);
  }
}
