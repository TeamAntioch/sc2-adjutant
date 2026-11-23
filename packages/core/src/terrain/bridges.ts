// Bridges for `bridge` connections: a stock bridge terrain object across the gap between two zones
// on the same level, centred in the gap, with landings (bridgeheads) of the bridge's own width
// filling whatever the bridge doesn't span, so its stamp meets the ground at both ends.

import { getTerrainObject } from "../catalog/terrain-objects.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";

import type { CornerGrid } from "./cliffs.js";
import { containsPoint, type Point } from "./rasterize.js";
import { stampVertices } from "./terrain-objects.js";

type TerrainObjectPlacement = MissionBlueprint["terrainObjects"][number];
type BridgeOption = { readonly type: string; readonly rotation: number };

/**
 * Straight stock bridges by tileset family, shortest span first. Every one joins level-1 ground
 * over a level-0 chasm. Tilesets without bridges of their own borrow Castanar's.
 */
const BRIDGES: Record<string, { readonly eastWest: readonly BridgeOption[]; readonly northSouth: readonly BridgeOption[] }> = {
  Castanar: {
    eastWest: [
      { type: "TerrainObjectCastanarBridge10x6", rotation: 0 },
      { type: "TerrainObjectCastanarBridge14x6", rotation: 0 },
    ],
    northSouth: [
      { type: "TerrainObjectCastanarBridge6x10", rotation: 0 },
      { type: "TerrainObjectCastanarBridge6x14", rotation: 0 },
    ],
  },
  Monlyth: {
    eastWest: [{ type: "MonlythLightBridge", rotation: 0 }],
    northSouth: [{ type: "MonlythLightBridge", rotation: 1 }],
  },
};
const DECK_LEVEL = 1;
/** How far past the deck's ends a bridgehead row may reach to find the ground (ragged edges). */
const BRIDGEHEAD_SLACK = 4;

/** A bridge option's stamp size in vertices once turned: along its span and across it. */
function turnedSize(option: BridgeOption, eastWest: boolean): { along: number; across: number } {
  const object = getTerrainObject(option.type)!;
  const turned = option.rotation % 2 === 1;
  const x = turned ? object.size.down : object.size.across;
  const y = turned ? object.size.across : object.size.down;
  return eastWest ? { along: x, across: y } : { along: y, across: x };
}

/**
 * One bridge per `bridge` connection between zones that don't touch (from either side's listing,
 * at the connection's `at` or else where the zones come closest), as terrain object placements.
 * Sets the corners the bridge needs: its bridgeheads and its stamp's own corners. Throws where no
 * stock bridge fits: zones off level 1, no lower gap between them, or no straight line across.
 */
export function connectionBridges(blueprint: MissionBlueprint, corners: CornerGrid): TerrainObjectPlacement[] {
  const { columns, rows } = corners;
  const zoneById = new Map(blueprint.zones.map((zone) => [zone.id, zone]));
  const family = BRIDGES[Object.keys(BRIDGES).find((name) => blueprint.tilesetId?.startsWith(name)) ?? "Castanar"]!;
  // The zone owning each corner (later zones win, as for the corner levels), or -1.
  const owner = new Int32Array(columns * rows).fill(-1);
  blueprint.zones.forEach((zone, index) => {
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < columns; cx++) if (containsPoint(zone.polygon, { x: cx * 2, y: cy * 2 })) owner[cy * columns + cx] = index;
  });
  const level = (x: number, y: number): number | undefined =>
    x < 0 || y < 0 || x / 2 >= columns || y / 2 >= rows ? undefined : corners.levels[(y / 2) * columns + x / 2];
  const setLevel = (x: number, y: number, value: number) => (corners.levels[(y / 2) * columns + x / 2] = value);

  const bridges: TerrainObjectPlacement[] = [];
  const seen = new Set<string>();
  for (const zone of blueprint.zones) {
    for (const connection of zone.connections) {
      const other = zoneById.get(connection.toZoneId);
      const pair = [zone.id, connection.toZoneId].sort().join("|");
      if (connection.type !== "bridge" || !other || seen.has(pair)) continue;
      seen.add(pair);
      const id = `${zone.id}-${other.id}-bridge`;
      if (zone.elevation !== DECK_LEVEL || other.elevation !== DECK_LEVEL) {
        throw new Error(`Bridge ${id}: stock bridges join level-1 ground over a level-0 chasm; ${zone.id} is level ${zone.elevation} and ${other.id} level ${other.elevation}`);
      }
      const at = connection.at ?? other.connections.find((candidate) => candidate.toZoneId === zone.id)?.at;
      const ends = closestCorners(owner, columns, blueprint.zones.indexOf(zone), blueprint.zones.indexOf(other), at);
      if (!ends) throw new Error(`Bridge ${id}: ${zone.id} or ${other.id} owns no corners`);
      const [from, to] = ends;
      if (Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) <= 2) continue; // They touch: no gap to bridge.

      // Work in (along, across) coordinates: along the span, across the deck.
      const eastWest = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
      const options = eastWest ? family.eastWest : family.northSouth;
      const toMap = (along: number, across: number): Point => (eastWest ? { x: along, y: across } : { x: across, y: along });
      const levelAt = (along: number, across: number) => {
        const point = toMap(along, across);
        return level(point.x, point.y);
      };
      const target = at ?? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      const [targetAlong, targetAcross] = eastWest ? [target.x, target.y] : [target.y, target.x];
      // The stamp's edges sit on even vertices, so a deck with an odd half-width centres on an odd line.
      const halfAcross = (turnedSize(options[0]!, eastWest).across - 1) / 2;
      const across = halfAcross % 2 === 0 ? 2 * Math.round(targetAcross / 2) : 2 * Math.round((targetAcross - 1) / 2) + 1;
      const deckRows = halfAcross % 2 === 0 ? [across] : [across - 1, across + 1];
      const start = 2 * Math.round(targetAlong / 2);

      // The gap's ends on the deck rows: the nearest level-1 corners either way.
      let low = -Infinity;
      let high = Infinity;
      for (const row of deckRows) {
        const startLevel = levelAt(start, row);
        if (startLevel === undefined || startLevel >= DECK_LEVEL) {
          throw new Error(`Bridge ${id}: no chasm below level 1 between ${zone.id} and ${other.id} at (${toMap(start, row).x}, ${toMap(start, row).y})`);
        }
        const walk = (step: number): number => {
          let along = start;
          for (;;) {
            along += step;
            const value = levelAt(along, row);
            if (value === undefined) {
              throw new Error(`Bridge ${id}: the gap between ${zone.id} and ${other.id} runs off the map ${eastWest ? "east-west" : "north-south"} from (${toMap(start, row).x}, ${toMap(start, row).y})`);
            }
            if (value === DECK_LEVEL) return along;
            if (value > DECK_LEVEL) throw new Error(`Bridge ${id}: higher ground at (${toMap(along, row).x}, ${toMap(along, row).y}) in the way across the gap`);
          }
        };
        low = Math.max(low, walk(-2));
        high = Math.min(high, walk(2));
      }
      const gap = high - low;

      // The longest bridge the gap holds, else the shortest (its stamp then widens the chasm round it).
      const sized = options.map((option) => ({ option, span: turnedSize(option, eastWest).along - 1 }));
      const choice = sized.filter((candidate) => candidate.span <= gap).at(-1) ?? sized[0]!;
      const lowEdge = low + 2 * Math.floor((gap - choice.span) / 4);
      const highEdge = lowEdge + choice.span;
      const centre = toMap(lowEdge + choice.span / 2, across);
      const placement: TerrainObjectPlacement = { id, type: choice.option.type, at: { x: centre.x, y: centre.y }, rotation: choice.option.rotation };

      // Bridgeheads: raise the chasm between each end and the ground, over the deck's full width.
      const reachLow = low - BRIDGEHEAD_SLACK;
      const reachHigh = high + BRIDGEHEAD_SLACK;
      for (let row = across - halfAcross; row <= across + halfAcross; row += 2) {
        for (let along = lowEdge - 2; along >= reachLow; along -= 2) {
          const value = levelAt(along, row);
          if (value === undefined || value >= DECK_LEVEL) break;
          const point = toMap(along, row);
          setLevel(point.x, point.y, DECK_LEVEL);
        }
        for (let along = highEdge + 2; along <= reachHigh; along += 2) {
          const value = levelAt(along, row);
          if (value === undefined || value >= DECK_LEVEL) break;
          const point = toMap(along, row);
          setLevel(point.x, point.y, DECK_LEVEL);
        }
      }
      // The stamp's own corners, so the ground meets it even where the bridge outspans the gap.
      for (const vertex of stampVertices(getTerrainObject(placement.type)!, placement.at.x, placement.at.y, placement.rotation)) {
        if (vertex.x % 2 === 0 && vertex.y % 2 === 0 && level(vertex.x, vertex.y) !== undefined) setLevel(vertex.x, vertex.y, vertex.level);
      }
      bridges.push(placement);
    }
  }
  return bridges;
}

/**
 * The closest pair of corners owned by zones `a` and `b` (map coordinates): nearest `at` on each
 * side when given, else the closest pair overall, ties to the pair nearest the middle.
 */
function closestCorners(owner: Int32Array, columns: number, a: number, b: number, at: Point | undefined): [Point, Point] | undefined {
  // A zone's edge corners: those with a neighbour it doesn't own.
  const rows = owner.length / columns;
  const cornersOf = (zoneIndex: number): Point[] => {
    const points: Point[] = [];
    owner.forEach((cornerOwner, index) => {
      if (cornerOwner !== zoneIndex) return;
      const cx = index % columns;
      const cy = Math.floor(index / columns);
      const edge = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ].some(([nx, ny]) => nx! < 0 || ny! < 0 || nx! >= columns || ny! >= rows || owner[ny! * columns + nx!] !== zoneIndex);
      if (edge) points.push({ x: cx * 2, y: cy * 2 });
    });
    return points;
  };
  const pa = cornersOf(a);
  const pb = cornersOf(b);
  if (pa.length === 0 || pb.length === 0) return undefined;
  const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  if (at) {
    const nearest = (points: Point[]) => points.reduce((best, point) => (distance(point, at) < distance(best, at) ? point : best));
    return [nearest(pa), nearest(pb)];
  }
  const centroid = (points: Point[]) => ({ x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length });
  const ca = centroid(pa);
  const cb = centroid(pb);
  const middle = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
  let best: { pair: [Point, Point]; distance: number; offCentre: number } | undefined;
  for (const p of pa) {
    for (const q of pb) {
      const d = distance(p, q);
      if (best && d > best.distance + 1e-9) continue;
      const off = distance({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, middle);
      if (!best || d < best.distance - 1e-9 || off < best.offCentre) best = { pair: [p, q], distance: d, offCentre: off };
    }
  }
  return best!.pair;
}
