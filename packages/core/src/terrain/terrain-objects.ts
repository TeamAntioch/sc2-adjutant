// Terrain objects as the Editor places them (decoded from Editor 5.0.17 saves; see
// docs/reference/terrain-file-formats.md, "t3Terrain.xml cliffDoodadList").
//
// Each placement is a `<cliffDoodad>` in t3Terrain.xml plus its stamp: the object's HeightCodes set
// the cliff level of every vertex under it. The Editor doesn't apply the stamp from the list on
// load, so the compiler writes it into the vertex levels like any other cliff.

import { getTerrainObject, type TerrainObject } from "../catalog/terrain-objects.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";

import { CLIFF_HEIGHTS, type CornerGrid } from "./cliffs.js";

export type PlacedTerrainObject = {
  /** The blueprint placement's id. */
  readonly id: string;
  readonly type: string;
  /** The centre vertex. */
  readonly x: number;
  readonly y: number;
  /** The Editor's `pos` z: the cliff height of the stamp's lowest level. */
  readonly z: number;
  /** Quarter turns anticlockwise (`rot`). */
  readonly rotation: number;
  /** Stamped vertices and the level each gets. */
  readonly stamp: readonly { readonly x: number; readonly y: number; readonly level: number }[];
};

const LEVELS: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

/**
 * The vertices an object stamps at `rotation`. Row 0 of the HeightCodes is the north edge and a
 * row runs west to east (a stamp read like a map); each turn moves north to west. Characters past
 * the object's width (a few Blizzard rows carry one) are ignored.
 */
export function stampVertices(object: TerrainObject, x: number, y: number, rotation: number): PlacedTerrainObject["stamp"] {
  const halfAcross = (object.size.across - 1) / 2;
  const halfDown = (object.size.down - 1) / 2;
  const stamp: { x: number; y: number; level: number }[] = [];
  object.heightCodes.forEach((row, r) => {
    for (let c = 0; c < Math.min(row.length, object.size.across); c++) {
      const level = LEVELS[row[c]!];
      if (level === undefined) continue;
      let dx = c - halfAcross;
      let dy = halfDown - r;
      for (let turn = 0; turn < rotation; turn++) [dx, dy] = [-dy, dx];
      stamp.push({ x: x + dx, y: y + dy, level });
    }
  });
  return stamp;
}

/**
 * The blueprint's terrain objects and any `extra` (the bridges its connections need), with their
 * stamps; throws on an unknown type, one off the map or off the cliff grid, or a repeated id.
 */
export function placeTerrainObjects(blueprint: MissionBlueprint, extra: MissionBlueprint["terrainObjects"] = []): PlacedTerrainObject[] {
  const { width, height } = blueprint.mapSize;
  const ids = new Set(blueprint.terrainObjects.map((placement) => placement.id));
  for (const placement of extra) if (ids.has(placement.id)) throw new Error(`Terrain object ${placement.id}: the id is taken by a bridge connection's bridge`);
  return [...blueprint.terrainObjects, ...extra].map((placement) => {
    const object = getTerrainObject(placement.type);
    if (!object) throw new Error(`Terrain object ${placement.id}: unknown type ${placement.type}`);
    // The Editor snaps a stamp's edges to the 2×2 cliff grid; off it, cliff cells end half under
    // the stamp and draw cliff meshes over the object.
    const turned = placement.rotation % 2 === 1;
    const halfX = ((turned ? object.size.down : object.size.across) - 1) / 2;
    const halfY = ((turned ? object.size.across : object.size.down) - 1) / 2;
    const snap = (at: number, half: number): number => ((at - half) % 2 === 0 ? at : at - 1);
    if ((placement.at.x - halfX) % 2 !== 0 || (placement.at.y - halfY) % 2 !== 0) {
      throw new Error(
        `Terrain object ${placement.id}: at (${placement.at.x}, ${placement.at.y}) its stamp's edges miss the 2×2 cliff grid; ` +
          `centre it on a vertex ${halfX % 2 === 0 ? "even" : "odd"} in x and ${halfY % 2 === 0 ? "even" : "odd"} in y, e.g. (${snap(placement.at.x, halfX)}, ${snap(placement.at.y, halfY)})`,
      );
    }
    const stamp = stampVertices(object, placement.at.x, placement.at.y, placement.rotation);
    if (stamp.some((vertex) => vertex.x < 0 || vertex.y < 0 || vertex.x > width || vertex.y > height)) {
      throw new Error(`Terrain object ${placement.id}: its stamp runs off the map`);
    }
    const lowest = Math.min(...stamp.map((vertex) => vertex.level));
    return { id: placement.id, type: placement.type, x: placement.at.x, y: placement.at.y, z: CLIFF_HEIGHTS[lowest]!, rotation: placement.rotation, stamp };
  });
}

/**
 * Objects whose stamp edge doesn't meet the ground: a corner on the stamp's edge (both coordinates
 * even, where the zones set levels) that the stamp sets to another level. A bridge over a chasm
 * wider than its span fills one end, as the Editor does; the fix is to fit the zones to the object.
 * The odd vertices between corners don't count: a stamp's low run is odd to odd (a bridge lowers
 * the ground beside each end) while the zones' is even to even. Call it before stamping.
 */
export function terrainObjectWarnings(objects: readonly PlacedTerrainObject[], levels: Uint8Array, width: number): string[] {
  const warnings: string[] = [];
  for (const object of objects) {
    const xs = object.stamp.map((vertex) => vertex.x);
    const ys = object.stamp.map((vertex) => vertex.y);
    const [west, east, south, north] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const edge = object.stamp.filter(
      (vertex) => (vertex.x === west || vertex.x === east || vertex.y === south || vertex.y === north) && vertex.x % 2 === 0 && vertex.y % 2 === 0,
    );
    const off = edge.filter((vertex) => levels[vertex.y * (width + 1) + vertex.x] !== vertex.level);
    if (off.length > 0) {
      warnings.push(
        `Terrain object ${object.id} (${object.type}) at (${object.x}, ${object.y}) doesn't meet the ground at ${off.length} of the ${edge.length} corners on its edge, e.g. (${off[0]!.x}, ${off[0]!.y}) is level ${levels[off[0]!.y * (width + 1) + off[0]!.x]} but its stamp sets ${off[0]!.level}; the zones around it don't fit its size, so reshape them (a bridge's chasm must end at its stamp's edges)`,
      );
    }
  }
  return warnings;
}

/** Sets the corners (both coordinates even) the objects stamp, so cliff cells around them follow. */
export function stampCorners(objects: readonly PlacedTerrainObject[], corners: CornerGrid): void {
  for (const object of objects) {
    for (const vertex of object.stamp) {
      if (vertex.x % 2 === 0 && vertex.y % 2 === 0) corners.levels[(vertex.y / 2) * corners.columns + vertex.x / 2] = vertex.level;
    }
  }
}

/** Sets every vertex the objects stamp, after the vertex levels are derived from the corners. */
export function stampVertexLevels(objects: readonly PlacedTerrainObject[], levels: Uint8Array, width: number): void {
  for (const object of objects) {
    for (const vertex of object.stamp) levels[vertex.y * (width + 1) + vertex.x] = vertex.level;
  }
}

/**
 * Cliff cells (2×2 cells, index cy·(width/2)+cx) lying wholly inside an object's stamp: the Editor
 * marks them `f` 4|8 and draws no cliff mesh there, since the object's model is the wall.
 */
export function coveredCliffCells(objects: readonly PlacedTerrainObject[], width: number): Set<number> {
  const covered = new Set<number>();
  for (const object of objects) {
    const stamped = new Set(object.stamp.map((vertex) => `${vertex.x},${vertex.y}`));
    const xs = object.stamp.map((vertex) => vertex.x);
    const ys = object.stamp.map((vertex) => vertex.y);
    for (let cy = Math.ceil(Math.min(...ys) / 2); cy * 2 + 2 <= Math.max(...ys); cy++) {
      for (let cx = Math.ceil(Math.min(...xs) / 2); cx * 2 + 2 <= Math.max(...xs); cx++) {
        let inside = true;
        for (let vy = 0; vy <= 2 && inside; vy++) for (let vx = 0; vx <= 2; vx++) if (!stamped.has(`${cx * 2 + vx},${cy * 2 + vy}`)) inside = false;
        if (inside) covered.add(cy * (width / 2) + cx);
      }
    }
  }
  return covered;
}

/** Cells (index y·width+x) whose four vertices an object stamps. */
export function stampedCells(objects: readonly PlacedTerrainObject[], width: number): Set<number> {
  const cells = new Set<number>();
  for (const object of objects) {
    const stamped = new Set(object.stamp.map((vertex) => vertex.y * (width + 1) + vertex.x));
    for (const vertex of object.stamp) {
      const at = vertex.y * (width + 1) + vertex.x;
      if (stamped.has(at + 1) && stamped.has(at + width + 1) && stamped.has(at + width + 2)) cells.add(vertex.y * width + vertex.x);
    }
  }
  return cells;
}

/** `<cliffDoodad>`, as the Editor writes it. */
export function cliffDoodadXml(object: PlacedTerrainObject): string {
  const f = (value: number): string => value.toFixed(6);
  return `<cliffDoodad name="${object.type}" pos="${f(object.x)} ${f(object.y)} ${f(object.z)} " rot="${object.rotation}"/>`;
}
